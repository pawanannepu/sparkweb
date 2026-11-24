import type { DiffHunk, FileDiff, SnapshotDiffResult, SnapshotFilesMap } from "@spark/shared";
import { structuredPatch } from "diff";

export function computeSnapshotDiff(
  baseFiles: SnapshotFilesMap,
  targetFiles: SnapshotFilesMap,
  baseSnapshotId: string | null,
  targetSnapshotId: string
): SnapshotDiffResult {
  const allPaths = new Set([...Object.keys(baseFiles), ...Object.keys(targetFiles)]);
  const sortedPaths = Array.from(allPaths).sort();

  const fileDiffs: FileDiff[] = [];
  let addedFiles = 0;
  let modifiedFiles = 0;
  let deletedFiles = 0;
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const path of sortedPaths) {
    const baseEntry = baseFiles[path];
    const targetEntry = targetFiles[path];

    if (!baseEntry && targetEntry) {
      // File added
      addedFiles++;
      const isBinary = Boolean(targetEntry.isBinary);
      if (isBinary) {
        fileDiffs.push({
          path,
          status: "added",
          isBinary: true,
          additions: 0,
          deletions: 0,
          hunks: [],
        });
      } else {
        const patch = structuredPatch(path, path, "", targetEntry.content, "", "");
        const hunks: DiffHunk[] = patch.hunks.map((h) => ({
          oldStart: h.oldStart,
          oldLines: h.oldLines,
          newStart: h.newStart,
          newLines: h.newLines,
          lines: h.lines,
        }));
        const fileAdditions = hunks.reduce(
          (sum, h) => sum + h.lines.filter((l) => l.startsWith("+")).length,
          0
        );
        totalAdditions += fileAdditions;

        fileDiffs.push({
          path,
          status: "added",
          isBinary: false,
          additions: fileAdditions,
          deletions: 0,
          hunks,
        });
      }
    } else if (baseEntry && !targetEntry) {
      // File deleted
      deletedFiles++;
      const isBinary = Boolean(baseEntry.isBinary);
      if (isBinary) {
        fileDiffs.push({
          path,
          status: "deleted",
          isBinary: true,
          additions: 0,
          deletions: 0,
          hunks: [],
        });
      } else {
        const patch = structuredPatch(path, path, baseEntry.content, "", "", "");
        const hunks: DiffHunk[] = patch.hunks.map((h) => ({
          oldStart: h.oldStart,
          oldLines: h.oldLines,
          newStart: h.newStart,
          newLines: h.newLines,
          lines: h.lines,
        }));
        const fileDeletions = hunks.reduce(
          (sum, h) => sum + h.lines.filter((l) => l.startsWith("-")).length,
          0
        );
        totalDeletions += fileDeletions;

        fileDiffs.push({
          path,
          status: "deleted",
          isBinary: false,
          additions: 0,
          deletions: fileDeletions,
          hunks,
        });
      }
    } else if (baseEntry && targetEntry) {
      // File potentially modified
      if (baseEntry.content !== targetEntry.content) {
        modifiedFiles++;
        const isBinary = Boolean(baseEntry.isBinary || targetEntry.isBinary);
        if (isBinary) {
          fileDiffs.push({
            path,
            status: "modified",
            isBinary: true,
            additions: 0,
            deletions: 0,
            hunks: [],
          });
        } else {
          const patch = structuredPatch(path, path, baseEntry.content, targetEntry.content, "", "");
          const hunks: DiffHunk[] = patch.hunks.map((h) => ({
            oldStart: h.oldStart,
            oldLines: h.oldLines,
            newStart: h.newStart,
            newLines: h.newLines,
            lines: h.lines,
          }));

          let fileAdditions = 0;
          let fileDeletions = 0;
          for (const hunk of hunks) {
            for (const line of hunk.lines) {
              if (line.startsWith("+")) fileAdditions++;
              else if (line.startsWith("-")) fileDeletions++;
            }
          }

          totalAdditions += fileAdditions;
          totalDeletions += fileDeletions;

          fileDiffs.push({
            path,
            status: "modified",
            isBinary: false,
            additions: fileAdditions,
            deletions: fileDeletions,
            hunks,
          });
        }
      }
    }
  }

  return {
    baseSnapshotId,
    targetSnapshotId,
    summary: {
      totalFiles: fileDiffs.length,
      addedFiles,
      modifiedFiles,
      deletedFiles,
      totalAdditions,
      totalDeletions,
    },
    fileDiffs,
  };
}
