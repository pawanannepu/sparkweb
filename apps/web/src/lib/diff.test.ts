import { describe, expect, it } from "vitest";
import { computeSnapshotDiff } from "./diff";

describe("computeSnapshotDiff", () => {
  it("computes added, modified, and deleted files with line statistics", () => {
    const baseFiles = {
      "deleted.txt": { content: "line 1\nline 2" },
      "modified.txt": { content: "unchanged\nold line\nend" },
      "same.txt": { content: "never changes" },
    };

    const targetFiles = {
      "modified.txt": { content: "unchanged\nnew line\nend" },
      "same.txt": { content: "never changes" },
      "added.txt": { content: "brand new\ncontent here" },
    };

    const diff = computeSnapshotDiff(baseFiles, targetFiles, "base-1", "target-2");

    expect(diff.baseSnapshotId).toBe("base-1");
    expect(diff.targetSnapshotId).toBe("target-2");
    expect(diff.summary.addedFiles).toBe(1);
    expect(diff.summary.modifiedFiles).toBe(1);
    expect(diff.summary.deletedFiles).toBe(1);
    expect(diff.summary.totalFiles).toBe(3);

    const added = diff.fileDiffs.find((f) => f.path === "added.txt");
    expect(added?.status).toBe("added");
    expect(added?.additions).toBeGreaterThan(0);

    const deleted = diff.fileDiffs.find((f) => f.path === "deleted.txt");
    expect(deleted?.status).toBe("deleted");
    expect(deleted?.deletions).toBeGreaterThan(0);

    const modified = diff.fileDiffs.find((f) => f.path === "modified.txt");
    expect(modified?.status).toBe("modified");
    expect(modified?.additions).toBe(1);
    expect(modified?.deletions).toBe(1);
  });

  it("handles empty base for initial snapshot comparison", () => {
    const targetFiles = {
      "src/index.ts": { content: "console.log('hi');" },
    };

    const diff = computeSnapshotDiff({}, targetFiles, null, "initial-snap");

    expect(diff.baseSnapshotId).toBeNull();
    expect(diff.summary.addedFiles).toBe(1);
    expect(diff.summary.modifiedFiles).toBe(0);
    expect(diff.summary.deletedFiles).toBe(0);
    expect(diff.fileDiffs[0]?.path).toBe("src/index.ts");
    expect(diff.fileDiffs[0]?.status).toBe("added");
  });

  it("skips line diffing for binary assets", () => {
    const baseFiles = {
      "image.png": { content: "base64data1", isBinary: true },
    };
    const targetFiles = {
      "image.png": { content: "base64data2", isBinary: true },
    };

    const diff = computeSnapshotDiff(baseFiles, targetFiles, "base", "target");

    expect(diff.summary.modifiedFiles).toBe(1);
    expect(diff.fileDiffs[0]?.isBinary).toBe(true);
    expect(diff.fileDiffs[0]?.hunks).toEqual([]);
    expect(diff.fileDiffs[0]?.additions).toBe(0);
    expect(diff.fileDiffs[0]?.deletions).toBe(0);
  });

  it("excludes files with identical contents from diff", () => {
    const baseFiles = {
      "same.txt": { content: "identical text\nline 2" },
    };
    const targetFiles = {
      "same.txt": { content: "identical text\nline 2" },
    };

    const diff = computeSnapshotDiff(baseFiles, targetFiles, "base", "target");

    expect(diff.summary.totalFiles).toBe(0);
    expect(diff.summary.modifiedFiles).toBe(0);
    expect(diff.fileDiffs).toHaveLength(0);
  });

  it("handles binary files with isBinary flag", () => {
    const baseFiles = {
      "model.wasm": { content: "bytes1", isBinary: true },
    };
    const targetFiles = {
      "model.wasm": { content: "bytes2", isBinary: true },
    };

    const diff = computeSnapshotDiff(baseFiles, targetFiles, "base", "target");

    expect(diff.summary.modifiedFiles).toBe(1);
    expect(diff.fileDiffs[0]?.isBinary).toBe(true);
    expect(diff.fileDiffs[0]?.hunks).toHaveLength(0);
  });
});
