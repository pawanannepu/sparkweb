import {
  type DatabaseClient,
  db,
  deleteUnattachedAttachmentRow,
  listStalePendingAttachments,
} from "@spark/db";
import { getArtifactStore } from "@/lib/publishing/deploy-service";
import type { ArtifactStore } from "@/lib/publishing/types";

const STALE_PENDING_ATTACHMENT_MS = 24 * 60 * 60 * 1000;
const STALE_SWEEP_BATCH_LIMIT = 25;

/**
 * Deletes up to 25 unattached pending design attachments older than 24 hours globally.
 * Always deletes the stored blob before removing its PostgreSQL row.
 */
export async function sweepStalePendingAttachments(params?: {
  database?: DatabaseClient;
  artifactStore?: ArtifactStore;
  olderThanMs?: number;
  limit?: number;
}): Promise<number> {
  const database = params?.database ?? db;
  const artifactStore = params?.artifactStore ?? getArtifactStore();
  const staleRows = await listStalePendingAttachments(database, {
    olderThanMs: params?.olderThanMs ?? STALE_PENDING_ATTACHMENT_MS,
    limit: params?.limit ?? STALE_SWEEP_BATCH_LIMIT,
  });

  let deletedCount = 0;
  for (const row of staleRows) {
    try {
      if (row.storageKey) {
        if (artifactStore.deleteObject) {
          await artifactStore.deleteObject(row.storageKey);
        } else {
          await artifactStore.deletePrefix(row.storageKey);
        }
      }
      const deleted = await deleteUnattachedAttachmentRow(database, row.id);
      if (deleted) {
        deletedCount += 1;
      }
    } catch {
      // Leave row intact if blob deletion failed so a future sweep can retry cleanly
    }
  }

  return deletedCount;
}
