// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  listStalePendingAttachments: vi.fn(),
  deleteUnattachedAttachmentRow: vi.fn(),
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    db: {},
    listStalePendingAttachments: dbMocks.listStalePendingAttachments,
    deleteUnattachedAttachmentRow: dbMocks.deleteUnattachedAttachmentRow,
  };
});

import type { ArtifactStore } from "@/lib/publishing/types";
import { sweepStalePendingAttachments } from "./cleanup";

describe("sweepStalePendingAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // covers: AC-10
  it("deletes ArtifactStore blobs before removing DB rows and skips failed blob deletions", async () => {
    dbMocks.listStalePendingAttachments.mockResolvedValueOnce([
      { id: "att-1", storageKey: "attachments/p1/att-1" },
      { id: "att-2", storageKey: "attachments/p1/att-2" },
      { id: "att-3", storageKey: null },
    ]);

    const deleteObject = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("S3 transient failure"));

    dbMocks.deleteUnattachedAttachmentRow.mockResolvedValue(true);

    const artifactStore: ArtifactStore = {
      putObject: vi.fn(),
      uploadDirectory: vi.fn(),
      getObject: vi.fn(),
      deleteObject,
      deletePrefix: vi.fn(),
    };

    const count = await sweepStalePendingAttachments({
      database: {} as never,
      artifactStore,
      olderThanMs: 86_400_000,
      limit: 25,
    });

    expect(count).toBe(2);
    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(dbMocks.deleteUnattachedAttachmentRow).toHaveBeenCalledWith(expect.anything(), "att-1");
    expect(dbMocks.deleteUnattachedAttachmentRow).not.toHaveBeenCalledWith(
      expect.anything(),
      "att-2"
    );
    expect(dbMocks.deleteUnattachedAttachmentRow).toHaveBeenCalledWith(expect.anything(), "att-3");
  });

  // covers: AC-10
  it("falls back to deletePrefix when artifactStore lacks deleteObject", async () => {
    dbMocks.listStalePendingAttachments.mockResolvedValueOnce([
      { id: "att-1", storageKey: "attachments/p1/att-1" },
    ]);
    dbMocks.deleteUnattachedAttachmentRow.mockResolvedValueOnce(true);

    const deletePrefix = vi.fn().mockResolvedValue(undefined);
    const artifactStore: ArtifactStore = {
      putObject: vi.fn(),
      uploadDirectory: vi.fn(),
      getObject: vi.fn(),
      deletePrefix,
    };

    const count = await sweepStalePendingAttachments({
      database: {} as never,
      artifactStore,
    });

    expect(count).toBe(1);
    expect(deletePrefix).toHaveBeenCalledWith("attachments/p1/att-1");
  });
});
