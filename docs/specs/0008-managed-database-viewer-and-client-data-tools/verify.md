# Verify: managed database viewer & client data tools · spec 0008 · updated 2026-11-25
_Steps derived from spec 0008 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [x] Open the builder workspace, switch to the `Database` tab in the right workbench pane, and verify the preview iframe stays mounted in the DOM with CSS hidden so in browser PGlite state persists when switching back to `Preview` → AC-4
- [x] While PGlite is booting on initial load or after a preview reload, open the `Database` tab and verify the animated booting skeleton renders until `DB_READY_EVENT` arrives → AC-9
- [ ] With zero user tables in PGlite, verify the `EMPTY` state displays guided prompt chips (clicking one submits a schema prompt to chat) and a shortcut to open the SQL Console → AC-9
- [x] Select a table from the table sidebar, confirm column metadata (`type`, `PK` badges, record count badges) renders, and page, sort, and search across rows in the TanStack Table data grid → AC-3, AC-4
- [ ] Click a cell to edit its value inline (test valid and invalid typed inputs), submit an `Add Record` sheet respecting identity and defaulted columns, and delete a row through the `Delete Row` confirmation modal; verify a keyless table displays as read only → AC-5
- [x] Add a record inside the live preview app (for example `Add Demo Record` in the starter app) and switch to `Database` (or mutate from the viewer and switch to `Preview`); verify `DB_MUTATED_EVENT` updates both views without a page reload → AC-6
- [x] Open `SQL Console`, write a PostgreSQL query with schema autocomplete, run it with `Cmd/Ctrl + Enter` or `Run Query`, verify timing in `ms` and rows render, then save it as a snippet, filter by pinned favorites, edit, and delete it → AC-1, AC-2, AC-7
- [x] Enter `DROP TABLE demo_items;` or `DELETE FROM demo_items;` without a `WHERE` clause in `SQL Console` and verify the destructive SQL confirmation modal blocks immediate execution → AC-7
- [ ] Click `Save As Seed Data` in the `Database` toolbar and verify `seed.sql` is added to the project files and persisted as a new snapshot with trigger `manual` and tag `database_seed`, then verify reloading boots PGlite with those seeded rows → AC-8
- [ ] Start an AI generation pass in chat, switch to `Database`, and verify the `Read Only Lock Active` banner appears, visual edit and insert controls are disabled, and mutating SQL fails under `SET TRANSACTION READ ONLY` → AC-9

## Commands
- [x] `psql "${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/sparkweb}" -c "\d project_queries"` → confirms `project_queries` table, cascade FK to `projects(id)`, and `(project_id, created_at DESC)` plus `(project_id, is_favorite)` indexes exist live → AC-1
- [x] `curl -s http://localhost:3000/api/projects/invalid-uuid/queries` → returns HTTP 400 invalid project ID; valid project UUID `POST` / `GET` / `PATCH` / `DELETE` under `/api/projects/[id]/queries` persist and return 404 on missing snippets → AC-2
- [ ] `curl -s -X POST http://localhost:3000/api/projects/00000000-0000-0000-0000-000000000001/database/seed -H "Content-Type: application/json" -d '{"sql":"SELECT 1;"}'` → returns HTTP 200 with `snapshotId` and `tag: "database_seed"` (or HTTP 400 when payload exceeds 500KB) → AC-8
- [x] `pnpm check-types && pnpm lint && pnpm test` → passes all workspace typechecks, Biome checks, and unit tests including `packages/sandbox/src/db-bridge.test.ts` (10s timeout, READ ONLY transaction, parameterized CRUD, FK seed export) → AC-1, AC-3, AC-5, AC-7, AC-8, AC-9

## Acceptance-criteria coverage
- AC-1 covered by `psql` live schema check and `packages/db/src/queries.test.ts` · AC-2 covered by `/api/projects/[id]/queries` curl check and `queries.test.ts` · AC-3 covered by `db-bridge.test.ts` and table introspection UI check · AC-4 covered by `Database` tab DOM persistence and TanStack Table pagination/sort/search UI check · AC-5 covered by inline edit, `Add Record` sheet, `Delete Row` modal, and keyless read only check · AC-6 covered by bidirectional `DB_MUTATED_EVENT` UI check · AC-7 covered by CodeMirror SQL Console, timing, snippet CRUD, and destructive SQL modal check · AC-8 covered by `Save As Seed Data` UI check and `/api/projects/[id]/database/seed` command check · AC-9 covered by booting skeleton, empty state prompt chips, and `STREAMING_LOCKED` read only transaction check
