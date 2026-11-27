# 0007. Version history snapshots and time travel rollback

**Date**: 2026-11-24
**Status**: Accepted

## Summary

This specification establishes version history snapshots, time travel inspection, and rollback capabilities for sparkweb. As creators generate code, adjust styles in the visual canvas, or run self healing repairs, the platform records immutable snapshots with structured triggers and metadata. A dedicated version history drawer lets creators browse chronological checkpoints, inspect side by side code diffs, and test past application states in a temporary read only preview mode without altering project state. Rolling back performs a non destructive forward commit that restores past files while preserving complete audit history, while in project branching enables risk free experimentation with instant workspace switching.

## Requirements

**User stories**:
- As a creator, I want an automatic timeline of every generation step and manual edit, so that I never lose work and can review how my application evolved.
- As a creator, I want to inspect side by side code diffs between any two versions, so that I clearly understand what files and lines changed.
- As a creator, I want to preview historical checkpoints in the live runner before deciding to restore them, so that I can verify past behavior with confidence.
- As a creator, I want to roll back to any past version without erasing history, so that I can undo unwanted changes safely.
- As a creator, I want to branch my project into alternate experiments, so that I can try new directions without risking the main working version.
- As a developer, I want rollback blocked during active generation runs and protected snapshots shielded from deletion, so that project integrity remains rock solid.

**Acceptance criteria**:
- **AC-1**: Database schema introduces the `project_branches` table with unique constraint on `(projectId, name)`, adds `activeBranchId` to `projects`, and extends `snapshots` with `fileCount` integer column, `branchId`, `trigger` enum (`generation`, `canvas`, `repair`, `manual`, `rollback`), `tag`, and `restoredFromSnapshotId` foreign key.
- **AC-2**: Server route `GET /api/projects/[id]/snapshots` supports opaque cursor based pagination filtered by `branchId`, returning lightweight snapshot metadata including trigger, tag, file count, and message without transferring full file trees over the wire.
- **AC-3**: Server route `GET /api/projects/[id]/snapshots/[snapshotId]/diff` compares a target snapshot against a base snapshot (defaulting to its parent snapshot, or empty file map for root) using jsdiff, returning structured file status lists (`added`, `modified`, `deleted`) and formatted patch hunks, skipping text diffing for binary assets.
- **AC-4**: Workspace toolbar provides a branch switcher dropdown allowing creators to browse branches, create a new branch from any historical checkpoint, and switch active branch, returning the new head file tree in the response to eliminate fetch waterfalls.
- **AC-5**: Left sliding version history drawer displays a chronological timeline of snapshots grouped by relative date with trigger badges, tags, and message previews, with instant search and filter controls plus manual checkpoint tagging.
- **AC-6**: Selecting a historical snapshot enters temporary read only inspect mode, rendering a side by side or unified code diff viewer, displaying an inspection alert banner above the preview, locking prompt and canvas inputs, and dispatching `PREVIEW_WRITE_FILES` to the sandbox without mutating project database records. Exiting inspect mode restores active branch files to the sandbox.
- **AC-7**: Rolling back to a selected snapshot executes a non destructive forward commit via `POST /api/projects/[id]/snapshots/rollback`, creating a new snapshot with historical files, setting `restoredFromSnapshotId`, advancing branch head and project current snapshot within an atomic transaction, and reloading the preview sandbox via `PREVIEW_WRITE_FILES` (or `PREVIEW_BOOT` if `package.json` dependencies differ).
- **AC-8**: Security and integrity guards block rollback attempts with HTTP 409 Conflict when `prompt_messages` indicates an active streaming generation, prevent deleting the default main branch or active deployment snapshots, and prompt creators to save or discard uncommitted canvas adjustments before navigating away.

## Decision

**Chosen option**: Option 1: Dedicated relational branch tracking, non destructive forward commit rollback, server side diff computation, and temporary preview sandbox inspection mode

We implement complete version history and time travel rollback backed by PostgreSQL and Drizzle ORM. A dedicated `project_branches` table maintains branch heads and active branch references. Snapshots capture an explicit `trigger` enum, integer `fileCount`, and optional creator tags. When a creator rolls back, the system performs a non destructive forward commit: a new snapshot is created carrying the past file tree, referencing the source via `restoredFromSnapshotId` while advancing the branch head. Code diffs are computed server side via jsdiff to minimize client network transfer and memory overhead. The client workbench manages history and timeline inspection through a dedicated `useVersionHistory` store. Historical preview inspection operates as a temporary read only sandbox overlay with a visual banner, enabling creators to test past versions before committing a rollback.

**Implementation skills**: `next-dev-loop` (`vercel/next.js`, `.agents/skills/next-dev-loop/`) · `turborepo` (`vercel/turborepo`, `.agents/skills/turborepo/`) · `drizzle-orm-patterns` (`giuseppe-trisciuoglio/developer-kit`, `.agents/skills/drizzle-orm-patterns/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:
The data model extends the schema established in Spec 0002 with dedicated branch tracking and snapshot lineage columns.

Table: `project_branches` (new)
- `id`: uuid, primary key, default random
- `projectId`: uuid, foreign key references `projects.id`, on delete cascade, not null
- `name`: text, not null (e.g. `main`, `experiment-auth`)
- `headSnapshotId`: uuid, foreign key references `snapshots.id`, on delete set null, nullable (initially null on brand new empty project until first snapshot)
- `createdAt`: timestamp, default now, not null
- `updatedAt`: timestamp, default now, not null
- Unique constraint: `(projectId, name)`

Table: `snapshots` (extended)
- `id`: uuid, primary key, default random
- `projectId`: uuid, foreign key references `projects.id`, on delete cascade, not null
- `parentId`: uuid, foreign key references `snapshots.id`, on delete set null, nullable
- `branchId`: uuid, foreign key references `project_branches.id`, on delete set null, nullable
- `branchName`: text, default `main`, not null
- `treeHash`: text, not null
- `files`: jsonb (`SnapshotFilesMap`), not null
- `fileCount`: integer, default 0, not null (stored at write time to enable fast paginated listing without TOAST jsonb decompression)
- `message`: text, nullable
- `trigger`: text enum (`generation`, `canvas`, `repair`, `manual`, `rollback`), default `generation`, not null
- `tag`: text, nullable (for creator named checkpoints, e.g. `v1.0-alpha`)
- `restoredFromSnapshotId`: uuid, foreign key references `snapshots.id`, on delete set null, nullable
- `createdAt`: timestamp, default now, not null

Table: `projects` (extended)
- `activeBranchId`: uuid, foreign key references `project_branches.id`, on delete set null, nullable

Relationships:
- `projects` 1:N `project_branches` (`project_branches.projectId` -> `projects.id`)
- `projects` 1:1 active `project_branches` (`projects.activeBranchId` -> `project_branches.id`)
- `project_branches` 1:1 head `snapshots` (`project_branches.headSnapshotId` -> `snapshots.id`)
- `project_branches` 1:N `snapshots` (`snapshots.branchId` -> `project_branches.id`)
- `snapshots` 1:1 self `parentId` (`snapshots.parentId` -> `snapshots.id`)
- `snapshots` 1:1 self `restoredFromSnapshotId` (`snapshots.restoredFromSnapshotId` -> `snapshots.id`)

**State transitions**:
Branch and rollback lifecycle:
- Branch: created with head snapshot (or null if empty project) -> new commits advance head snapshot -> branch switched -> deleted (only if not main and not currently active).
- Rollback: historical snapshot selected -> temporary inspect mode active with prompt and canvas inputs locked -> rollback confirmed -> new forward snapshot committed -> branch head and project pointers advanced within single transaction -> preview sandbox hot reloaded.
- Inspect mode exit: creator clicks exit inspection banner -> workbench dispatches `PREVIEW_WRITE_FILES` using current active snapshot files held in `useProjectFiles` -> controls unlock.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/projects/[id]/snapshots | GET | branchId:uuid (opt), cursor:string (opt, base64 timestamp and id), limit:number (opt, default 30, max 100) | items:SnapshotSummary[], nextCursor:string or null | session owner | 401 unauthorized, 404 not found |
| /api/projects/[id]/snapshots | POST | files:SnapshotFilesMap (opt), message:string (opt), tag:string (opt), trigger:text (opt, default manual), branchId:uuid (opt) | snapshot:SnapshotSummary | session owner | 400 invalid payload, 401 unauthorized, 404 not found |
| /api/projects/[id]/snapshots/[snapshotId] | GET | none | snapshot:FullSnapshotDetails | session owner | 401 unauthorized, 404 not found |
| /api/projects/[id]/snapshots/[snapshotId]/diff | GET | baseId:uuid (opt, defaults to parentId or empty map if root) | baseSnapshotId, targetSnapshotId, summary, fileDiffs | session owner | 401 unauthorized, 404 not found |
| /api/projects/[id]/snapshots/rollback | POST | snapshotId:uuid (req), message:string (opt) | snapshot:SnapshotSummary, activeBranch:BranchSummary | session owner | 401 unauthorized, 404 not found, 409 conflict during generation |
| /api/projects/[id]/branches | GET | none | branches:BranchSummary[], activeBranchId:string | session owner | 401 unauthorized, 404 not found |
| /api/projects/[id]/branches | POST | name:string (req), fromSnapshotId:uuid (opt), switchActive:boolean (opt) | branch:BranchSummary | session owner | 401 unauthorized, 409 name taken, 422 invalid name |
| /api/projects/[id]/branches/[branchId]/switch | POST | none | activeBranch:BranchSummary, currentSnapshotId:string, files:SnapshotFilesMap | session owner | 401 unauthorized, 404 not found |
| /api/projects/[id]/branches/[branchId] | DELETE | none | success:boolean | session owner | 400 cannot delete main or active, 401 unauthorized, 404 not found |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| List snapshots | snapshot list, triggers, tags, fileCount, relative dates | DB query on `snapshots` filtered by `projectId` and `branchId`, using stored `fileCount` column |
| View snapshot diff | summary of added, modified, deleted files and diff hunks | Computed by server jsdiff between `baseSnapshot.files` (or empty map if root) and `targetSnapshot.files` |
| Enter inspect mode | read only preview files and alert banner | Fetched via `GET /api/projects/[id]/snapshots/[snapshotId]` and dispatched to sandbox via `PREVIEW_WRITE_FILES` |
| Exit inspect mode | restored active preview files and unlocked UI | Dispatched to sandbox via `PREVIEW_WRITE_FILES` using active files stored in `useProjectFiles` |
| Check generation conflict | HTTP 409 Conflict rejection if streaming | DB query on `prompt_messages` checking for any message with `status = 'streaming'` for the project |
| Detect dirty canvas | unsaved changes confirmation dialog | Boolean `hasUnsavedCanvasChanges` exposed by `useProjectFiles` tracking pending auto save debounces |
| Execute rollback | new forward snapshot and updated project pointer | Restored file tree from target snapshot, parent pointer from current branch head, trigger set to `rollback` |
| Create branch | new branch record and head snapshot pointer | User input name sanitized via slugify, `headSnapshotId` from specified snapshot or current snapshot |
| Switch branch | updated active branch and workspace file tree | DB update on `projects.activeBranchId` and `projects.currentSnapshotId`, returning `files` directly to client |

**Key invariants**:
- The default branch named `main` is created automatically on project creation and cannot be deleted or renamed.
- The currently active branch cannot be deleted; creators must switch to another branch before deleting.
- `projects.currentSnapshotId` is a fast pointer to the head of `projects.activeBranchId`. All mutations that advance a branch head (`saveSnapshot`, rollback, or branch switch) update both pointers atomically within the same database transaction using `SELECT ... FOR UPDATE` on `project_branches`.
- Branch names must be unique within a project and conform to lowercase slug format (alphanumeric characters and hyphens only, max 50 characters).
- Snapshots linked to active deployments (`deployments.status = 'active'`) cannot be deleted.
- Rollback mutations are non destructive forward commits: past snapshot records and their parent child links remain completely immutable.
- Rollback actions are rejected with HTTP 409 Conflict if an AI generation stream or healing repair pass is actively running.
- In temporary inspect mode, prompt submission, canvas element direct styling, and deployment buttons are disabled to prevent mutating active project state against historical code.
- Preview reload optimization on rollback: if `dependencies` or `devDependencies` in `package.json` differ between active and restored states, the workbench triggers `PREVIEW_BOOT`; otherwise it dispatches `PREVIEW_WRITE_FILES` for fast hot module reload.

**Security model**:
- All snapshot, branch, diff, and rollback endpoints enforce strict session user authentication via `getCurrentUser`.
- Every operation verifies that `projects.userId` matches the authenticated user ID, returning 404 Not Found for non existent or unauthorized projects.
- Sandbox inspection messages pass through existing postMessage protocol validation using `sparkweb:bridge:v1` origin validation.

**Configuration required**:
None. This feature utilizes existing PostgreSQL database connections and WebContainer runtime bridges without requiring new external environment variables or third party service credentials.

**Critical test scenarios**:
- Happy path: creator selects a past snapshot from the history drawer, enters read only inspect mode, reviews side by side code diffs, confirms rollback, and verifies that a new forward snapshot is created with the restored files and hot reloaded in the preview, verifies **AC-1**, **AC-2**, **AC-3**, **AC-6**, **AC-7**.
- Branching workflow: creator creates a new branch from a historical snapshot, verifies that the workspace switches to the new branch with the historical file tree loaded, makes edits, and switches back to main with files preserving their respective branch states, verifies **AC-4**, **AC-7**.
- Concurrency and conflict protection: creator attempts to trigger a rollback while an AI generation stream is running, verifying that the request is rejected with HTTP 409 Conflict and a clear toast notification, verifies **AC-8**.
- Deletion protection: creator attempts to delete the main branch, active branch, or a snapshot linked to an active deployment, verifying that the domain layer throws a forbidden error, verifies **AC-1**, **AC-8**.
- Unsaved canvas edits guard: creator adjusts styles in the visual canvas and attempts to switch versions or branches without saving, verifying that a confirmation dialog prompts to save a checkpoint or discard changes, verifies **AC-8**.

## Build plan

Following the Tracer Bullet build approach, each task establishes a complete, working vertical slice from database persistence to client UI interaction.

- [x] 1. Create database migration and schema definitions for `project_branches`, project active branch pointer, and extended snapshot columns (`fileCount`, `trigger`, `tag`, `branchId`, `restoredFromSnapshotId`), satisfies **AC-1**.
- [x] 2. Implement typed domain queries, mutations, and unit tests in `packages/db` for branch creation, branch switching, snapshot list pagination, and non destructive forward rollback, satisfies **AC-1**, **AC-2**, **AC-7**, **AC-8**.
- [x] 3. Create server API routes in `apps/web` for `GET /api/projects/[id]/snapshots`, `POST /api/projects/[id]/snapshots`, `GET /api/projects/[id]/snapshots/[snapshotId]`, `GET /api/projects/[id]/snapshots/[snapshotId]/diff`, `POST /api/projects/[id]/snapshots/rollback`, and `/api/projects/[id]/branches` endpoints, satisfies **AC-2**, **AC-3**, **AC-7**, **AC-8**.
- [x] 4. Build client state management in `apps/web/src/hooks/useVersionHistory.ts` supporting timeline pagination, active branch selection, optimistic rollback, and temporary inspect mode state with input locking, satisfies **AC-4**, **AC-5**, **AC-6**.
- [x] 5. Build the version history sliding drawer and timeline UI components in `apps/web/src/components/history` with relative time grouping, trigger badges, search filters, and manual checkpoint creation dialog, satisfies **AC-4**, **AC-5**.
- [x] 6. Build side by side and unified code diff viewer components in `apps/web/src/components/history` using jsdiff and Tailwind design tokens, satisfies **AC-3**, **AC-6**.
- [x] 7. Integrate the branch switcher dropdown into `apps/web/src/components/layout/BuilderShell.tsx` and `PreviewToolbar.tsx` with branch creation dialog and instant preview switching, satisfies **AC-4**.
- [x] 8. Implement temporary inspect mode preview banner and sandbox file bridge synchronization, linking `usePreviewBridge` with fallback hot module reload or clean boot on dependency changes, satisfies **AC-6**, **AC-7**, **AC-8**.

## Consequences

**Positive**:
- Risk free iteration: creators can explore bold prompts or styling experiments knowing they can return to any prior working state with one click.
- Complete audit trail: forward commit rollback preserves every historical step rather than truncating history.
- Lightweight network payloads: stored file counts, cursor pagination, and server side diff computation prevent large JSON file tree transfers during timeline browsing.
- Isolated experimentation: in project branching allows testing major architectural or design variations without duplicating entire projects.

**Negative / tradeoffs**:
- Database storage growth: preserving full snapshot file trees on every forward rollback and generation step increases database table size over time.
- Sandbox reload latency: rolling back to a snapshot with differing dependencies requires a clean container boot, introducing a two to three second reload delay.

**Neutral**:
- Project creation logic must be updated to create the initial default `main` branch automatically.
- Existing projects without branch records will require a backfill migration to populate `main` branch entries pointing to their current snapshots.

## Follow-up

- [ ] Run migration backfill script for existing database records to assign current snapshots to default `main` branch entries.
- [ ] Monitor snapshot table disk consumption and consider future chunk based file deduplication if projects accumulate hundreds of snapshots.
