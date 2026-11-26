import { ForbiddenError, NotFoundError } from "@spark/db";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetProjectWithCurrentSnapshot } = vi.hoisted(() => ({
  mockGetProjectWithCurrentSnapshot: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    db: {},
    getProjectWithCurrentSnapshot: mockGetProjectWithCurrentSnapshot,
  };
});

import { getCurrentUser } from "@/lib/auth";
import { GET } from "./route";

const VALID_PROJECT_ID = "00000000-0000-0000-0000-000000000001";

describe("/api/projects/[id]/snapshots/current route", () => {
  const mockUser = { id: "user-1", email: "user@example.com", name: "User" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const res = await GET(
      new NextRequest(`http://localhost:3000/api/projects/${VALID_PROJECT_ID}/snapshots/current`),
      { params: Promise.resolve({ id: VALID_PROJECT_ID }) }
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid project UUID", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    const res = await GET(
      new NextRequest("http://localhost:3000/api/projects/bad-id/snapshots/current"),
      { params: Promise.resolve({ id: "bad-id" }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when project is missing and 403 when forbidden", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
    mockGetProjectWithCurrentSnapshot.mockRejectedValueOnce(new NotFoundError("Not found"));
    const res404 = await GET(
      new NextRequest(`http://localhost:3000/api/projects/${VALID_PROJECT_ID}/snapshots/current`),
      { params: Promise.resolve({ id: VALID_PROJECT_ID }) }
    );
    expect(res404.status).toBe(404);

    mockGetProjectWithCurrentSnapshot.mockRejectedValueOnce(new ForbiddenError("Forbidden"));
    const res403 = await GET(
      new NextRequest(`http://localhost:3000/api/projects/${VALID_PROJECT_ID}/snapshots/current`),
      { params: Promise.resolve({ id: VALID_PROJECT_ID }) }
    );
    expect(res403.status).toBe(403);
  });

  it("returns current snapshot files including seed.sql when present", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockGetProjectWithCurrentSnapshot.mockResolvedValueOnce({
      project: { id: VALID_PROJECT_ID },
      currentSnapshot: {
        id: "snap-seed-1",
        treeHash: "hash-123",
        tag: "database_seed",
        files: {
          "seed.sql": { content: "INSERT INTO demo_items VALUES (1, 'Row');" },
          "src/App.tsx": { content: "export default function App() {}" },
        },
      },
      threadCount: 0,
    });

    const res = await GET(
      new NextRequest(`http://localhost:3000/api/projects/${VALID_PROJECT_ID}/snapshots/current`),
      { params: Promise.resolve({ id: VALID_PROJECT_ID }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshotId).toBe("snap-seed-1");
    expect(body.tag).toBe("database_seed");
    expect(body.files["seed.sql"].content).toContain("INSERT INTO demo_items");
  });
});
