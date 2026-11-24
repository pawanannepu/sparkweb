# Verify: Version history snapshots and time travel rollback · spec 0007 · updated 2026-11-24

_Steps derived from spec 0007 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [x] Open version history drawer -> confirm chronological timeline grouped by relative date with trigger badges, tags, file counts, and messages -> AC-2, AC-5
- [x] Scroll to bottom of history drawer -> verify opaque cursor pagination fetches next batch without loading full file trees -> AC-2, AC-5
- [x] Click diff button on historical snapshot -> confirm code diff viewer displays added, modified, deleted file counters and syntax highlighted hunks, skipping binary assets -> AC-3, AC-6
- [x] Toggle diff view mode -> verify clean switching between inline unified view and side by side split view -> AC-3, AC-6
- [x] Click inspect on historical snapshot -> confirm alert banner displayed above preview, historical files dispatched to sandbox via PREVIEW_WRITE_FILES without DB mutation, and prompt and canvas inputs locked -> AC-6
- [x] Click exit inspect mode -> confirm alert banner dismissed, workbench inputs unlocked, and active branch files restored to preview sandbox -> AC-6
- [x] Click rollback on historical snapshot -> confirm non destructive forward commit created with restoredFromSnapshotId, branch head and project pointers advanced atomically, and preview reloaded -> AC-1, AC-7
- [x] Rollback snapshot with changed dependencies -> verify package.json dependency diff triggers clean PREVIEW_BOOT instead of plain PREVIEW_WRITE_FILES -> AC-7
- [x] Attempt rollback while generation is streaming -> confirm HTTP 409 Conflict rejection and error toast notification -> AC-8
- [x] Modify canvas element styles and attempt branch or version navigation before save -> confirm confirmation dialog prompts to save checkpoint or discard changes -> AC-8
- [x] Click branch switcher dropdown in toolbar -> confirm active branch marked, click create branch, enter name and source checkpoint -> confirm new branch created and head isolated -> AC-4
- [x] Attempt to delete main branch or active branch -> confirm forbidden rejection with validation error -> AC-1, AC-8

## Commands

- [x] `pnpm check-types` -> expect clean TypeScript compile across monorepo packages -> AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8
- [x] `pnpm lint` -> expect clean Biome check across all workspaces -> AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8
- [x] `pnpm vitest run packages/db/src/queries.test.ts` -> expect all branch lifecycle, pagination, and rollback tests to pass -> AC-1, AC-2, AC-4, AC-7, AC-8
- [x] `pnpm vitest run packages/db/src/schema/index.test.ts` -> expect schema tables, relations, and columns to pass -> AC-1
- [x] `pnpm vitest run packages/shared/src/index.test.ts` -> expect shared type contracts and schemas to pass -> AC-1, AC-2, AC-3
- [x] `pnpm vitest run apps/web/src/lib/diff.test.ts` -> expect file diffing and patch hunk calculations to pass -> AC-3
- [x] `pnpm vitest run apps/web/src/hooks/useVersionHistory.test.ts` -> expect drawer, pagination, inspect mode, and rollback hook logic to pass -> AC-2, AC-4, AC-5, AC-6
- [x] `pnpm vitest run apps/web/src/components/history/history.test.tsx` -> expect branch switcher, drawer, and diff components to render and interact -> AC-3, AC-4, AC-5, AC-6
- [x] `pnpm vitest run apps/web/src/app/api/projects/[id]/snapshots/route.test.ts` -> expect cursor pagination and manual checkpoint API tests to pass -> AC-2, AC-5
- [x] `pnpm vitest run apps/web/src/app/api/projects/[id]/snapshots/[snapshotId]/diff/route.test.ts` -> expect snapshot diff calculation API tests to pass -> AC-3
- [x] `pnpm vitest run apps/web/src/app/api/projects/[id]/snapshots/rollback/route.test.ts` -> expect non destructive forward rollback and conflict guard to pass -> AC-7, AC-8
- [x] `pnpm vitest run apps/web/src/app/api/projects/[id]/branches/route.test.ts` -> expect branch listing, creation, and deletion guard to pass -> AC-4, AC-8
- [x] `pnpm vitest run apps/web/src/app/page.test.tsx` -> expect full builder shell integration with branch switcher and inspect banner to pass -> AC-4, AC-5, AC-6
- [x] `pnpm build` -> expect full Next.js production build to succeed -> AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8

## Value sourcing verification

- [x] Snapshot list -> verify query on snapshots table using stored fileCount column -> AC-2, AC-5
- [x] View snapshot diff -> verify computed by server jsdiff between base files and target files -> AC-3, AC-6
- [x] Enter inspect mode -> verify read only preview files and alert banner dispatched via PREVIEW_WRITE_FILES -> AC-6
- [x] Exit inspect mode -> verify restored active preview files and unlocked UI via PREVIEW_WRITE_FILES from useProjectFiles -> AC-6
- [x] Check generation conflict -> verify HTTP 409 rejection if streaming message in prompt_messages -> AC-8
- [x] Detect dirty canvas -> verify hasUnsavedCanvasChanges boolean tracking pending debounces -> AC-8
- [x] Execute rollback -> verify new forward snapshot and updated project pointer -> AC-1, AC-7
- [x] Create branch -> verify new branch record and head snapshot pointer -> AC-4
- [x] Switch branch -> verify updated active branch and workspace file tree -> AC-4

## Acceptance criteria coverage

- AC-1: covered by database schema, queries, migrations, and branch deletion tests
- AC-2: covered by cursor pagination API tests, useVersionHistory tests, and history drawer UI tests
- AC-3: covered by diff calculation tests, diff API route tests, and code diff viewer component tests
- AC-4: covered by branch queries, branch API routes, branch switcher component, and shell integration tests
- AC-5: covered by version history drawer component tests, relative time grouping, and search filter tests
- AC-6: covered by inspect mode hook tests, inspect banner component, and preview bridge sync tests
- AC-7: covered by rollback query, rollback route tests, forward commit creation, and dependency boot check tests
- AC-8: covered by active generation conflict tests, branch protection tests, and unsaved canvas change guards
