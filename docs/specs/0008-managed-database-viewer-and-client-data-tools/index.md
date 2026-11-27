# 0008. Managed database viewer and client data tools

**Date**: 2026-11-25
**Status**: Accepted

## Summary

This specification establishes a managed database viewer and client data toolkit inside the sparkweb builder workspace. Creators can browse tables and inspect live records generated for their application, edit cell values directly, insert or delete records with safety confirmation modals, and run custom queries in an interactive SQL console. The host workbench communicates with the in browser PGlite instance running inside the preview iframe through a typed postMessage bridge compatible with the sparkweb envelope protocol. The preview frame remains mounted continuously in the DOM to preserve in memory WebAssembly database state across tab switches. Creators can save reusable query snippets in the host database, export live records to project seed files, and request schema migrations in plain words through dual conversational entry points.

## Requirements

**User stories**:
- As a creator, I want an intuitive visual table browser inside the workbench, so that I can see the data stored in my application database without leaving the builder.
- As a creator, I want to edit cell values, insert test records, and delete rows directly in the table view, so that I can seed and test my application quickly.
- As a creator, I want live updates between the visual data viewer and my running application, so that data created in the preview reflects in the viewer immediately and vice versa.
- As a creator, I want to ask spark to add columns or tables in plain words from both the main chat and the database panel, so that schema updates happen safely through code migrations.
- As a developer, I want an interactive SQL console with syntax highlighting, autocomplete, and execution timing, so that I can run custom queries against PGlite directly.
- As a developer, I want to save common SQL queries as project snippets, so that I can run them again across sessions.
- As a creator, I want to save my current test data into a project seed file, so that subsequent sandbox boots initialize with realistic sample data.
- As a developer, I want destructive SQL operations protected by confirmation dialogs and active AI generations protected by an engine level read only lock, so that database integrity remains safe.

**Acceptance criteria**:
- **AC-1**: Database schema in `packages/db` introduces the `project_queries` table with columns `id`, `projectId`, `title`, `sql`, `description`, `isFavorite`, `createdAt`, `updatedAt` (using timestamp with date mode), foreign key referencing `projects.id` with cascade delete, and a btree index on `(projectId, createdAt desc)`.
- **AC-2**: Server routes under `/api/projects/[id]/queries` provide REST CRUD endpoints: `GET` to list saved queries with optional `favorite` query filter, `POST` to create a query snippet with Zod validation, `PATCH /api/projects/[id]/queries/[queryId]` to update title, SQL, description, or favorite status, and `DELETE /api/projects/[id]/queries/[queryId]` to remove a query, restricting operations to the authenticated project owner with UUID validation and HTTP 404 on missing records.
- **AC-3**: Sandbox bridge contracts in `@spark/shared` and preview runner in `@spark/sandbox` implement typed request response messaging conforming to `BridgeMessage` envelope protocol with unique correlation IDs: `DB_INTROSPECT_REQUEST` returning table metadata, columns, types, nullability, default values, identity flags, and primary keys from PGlite with optional error; `DB_QUERY_REQUEST` executing read queries with structured limit, offset, and sort parameters plus a ten second execution timeout; and `DB_MUTATE_REQUEST` executing parameterized INSERT, UPDATE, and DELETE queries.
- **AC-4**: Workspace right workbench pane adds a dedicated Database tab alongside Preview and Code, keeping `PreviewFrame` permanently mounted in the DOM via CSS hidden to preserve in memory PGlite state, featuring a table selector sidebar, record count badges, and a data grid powered by TanStack Table v8 configured with manual server pagination, column sorting, and search filtering.
- **AC-5**: Visual table grid supports direct CRUD interactions: inline cell editing with type validation, an Add Record sheet dialog for inserting new rows respecting identity columns, and a Delete Row confirmation modal, executing parameterized mutations against PGlite, marking keyless tables as read only, and automatically invalidating cached table data.
- **AC-6**: Preview runner listens to PGlite write queries and emits `DB_MUTATED_EVENT` with origin tag to the host window, while viewer mutations dispatch the same notification, ensuring both the running preview application and the database viewer stay synchronized without manual page reloads.
- **AC-7**: Database viewer toolbar provides an interactive SQL Console tab powered by CodeMirror 6 with SQL language syntax highlighting, autocompletion, query execution timing in milliseconds, execution results table, save query snippet action, and warning confirmation modals before running destructive DROP, TRUNCATE, or bulk DELETE statements.
- **AC-8**: Database viewer toolbar provides a Save As Seed Data action that prompts the preview runner to serialize all current PGlite table rows into SQL insert statements with topological foreign key ordering and sequence resets, writing or updating `seed.sql` in the project file tree (capped at 500KB) and persisting a new project snapshot with trigger `manual` and tag `database_seed`.
- **AC-9**: When an AI generation or self healing repair pass is actively streaming, the database viewer enters read only lock mode with an alert banner and enforces `SET TRANSACTION READ ONLY` inside PGlite, disabling visual mutations and DDL execution while allowing query inspection. When PGlite boots, the runner emits `DB_READY_EVENT` to transition viewer from `BOOTING` to `READY` or `EMPTY` (when zero user tables exist), displaying a guided empty state with prompt action shortcuts.

## Decision

**Chosen option**: Option 1: In browser PGlite inspection via typed postMessage bridge, TanStack visual data grid, CodeMirror SQL console, host query snippets, and snapshot seed export

We implement a managed database viewer and client data tools suite tailored to sparkweb's in browser architecture. The database viewer lives as a dedicated top level tab in the right workbench pane. The preview runner iframe remains mounted in the DOM continuously to prevent WebAssembly memory loss across tab navigation. Host components communicate with the preview runner's embedded PGlite instance via a strictly typed, correlation ID based postMessage bridge conforming to the standard `BridgeMessage` envelope protocol. Visual record browsing and editing use TanStack Table v8 with manual server pagination, inline editing, and confirmation modals for destructive changes. An interactive SQL console powered by CodeMirror 6 allows direct query execution with execution timing, snippet saving, and engine level read only transaction safety during active generations. Saved queries persist in a new host PostgreSQL table `project_queries`. Natural language schema migrations trigger code first Drizzle schema updates through the builder generation loop, and creators can commit current preview data into `seed.sql` snapshots with a single click.

**Implementation skills**: `next-dev-loop` (`vercel/next.js`, `.agents/skills/next-dev-loop/`) · `turborepo` (`vercel/turborepo`, `.agents/skills/turborepo/`) · `drizzle-orm-patterns` (`giuseppe-trisciuoglio/developer-kit`, `.agents/skills/drizzle-orm-patterns/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:

Table: `project_queries` (new table in `packages/db`)
- `id`: uuid, primary key, default random, not null
- `projectId`: uuid, foreign key references `projects.id` (on delete cascade), not null
- `title`: text, not null (display name for the query snippet)
- `sql`: text, not null (raw SQL query text)
- `description`: text, nullable (optional documentation or purpose)
- `isFavorite`: boolean, default false, not null (pinned favorite flag)
- `createdAt`: timestamp (mode date), default now, not null
- `updatedAt`: timestamp (mode date), default now, not null

Indexes and constraints:
- Foreign key `(projectId)` referencing `projects.id` with cascade delete
- Btree index on `(projectId, createdAt desc)` for fast query listing
- Btree index on `(projectId, isFavorite)` for filtered favorite queries

Project file tree additions (in generated application snapshots):
- `seed.sql`: optional SQL seed file generated on demand when creator clicks Save As Seed Data, replayed idempotently on sandbox boot

**State transitions**:
Database viewer UI mode transitions:
- `BOOTING`: PGlite in runner is starting up. Displays animated skeleton loader. Transitions to `READY` on `DB_READY_EVENT` (with tableCount > 0) or `EMPTY` if 0 user tables exist.
- `EMPTY`: PGlite is ready but schema has no user tables. Displays guided empty state with prompt action chips to generate tables. Transitions to `READY` when tables appear.
- `READY`: Tables exist. User can switch between `TABLE_VIEW` (grid) and `SQL_CONSOLE` (CodeMirror editor).
- `STREAMING_LOCKED`: Generation or self healing is active. UI displays lock badge and banner; queries execute in `READ ONLY` transactions; cell edits, row inserts, and DDL are disabled. Transitions back to `READY` when generation completes.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/projects/[id]/queries | GET | id: uuid (path), favorite: boolean (query, opt) | queries: Array<ProjectQuery> | session | 400 invalid uuid, 401 unauthorized, 404 not found |
| /api/projects/[id]/queries | POST | id: uuid (path), title: string (req), sql: string (req), description: string (opt) | query: ProjectQuery | session | 400 invalid input, 401 unauthorized, 404 not found |
| /api/projects/[id]/queries/[queryId] | PATCH | id: uuid (path), queryId: uuid (path), title: string (opt), sql: string (opt), description: string (opt), isFavorite: boolean (opt) | query: ProjectQuery | session | 400 invalid input, 401 unauthorized, 404 not found |
| /api/projects/[id]/queries/[queryId] | DELETE | id: uuid (path), queryId: uuid (path) | success: true | session | 400 invalid uuid, 401 unauthorized, 404 not found |
| /api/projects/[id]/database/seed | POST | id: uuid (path), sql: string (req, max 500KB) | snapshotId: string | session | 400 invalid input, 401 unauthorized, 404 not found, 409 conflict |

Sandbox PostMessage bridge contracts conforming to `BridgeMessage` envelope (`protocol: "sparkweb:bridge:v1"`, `source: "sparkweb:host" | "sparkweb:sandbox"`, `type`, `payload`, `timestamp`):
- `DB_READY_EVENT`: payload `{ tableCount: number }`, emitted by runner when app PGlite instance mounts and finishes initial DDL.
- `DB_INTROSPECT_REQUEST`: payload `{ id: string }`
- `DB_INTROSPECT_RESPONSE`: payload `{ id: string, tables: Array<{ name: string, isReadOnly: boolean, rowCount: number, columns: Array<{ name: string, type: string, nullable: boolean, isPrimaryKey: boolean, isIdentity: boolean, defaultValue: string | null, enumValues?: string[] }> }>, error?: string }`
- `DB_QUERY_REQUEST`: payload `{ id: string, table?: string, page?: number, pageSize?: number, sortColumn?: string, sortDirection?: "asc" | "desc", search?: string, rawSql?: string }`
- `DB_QUERY_RESPONSE`: payload `{ id: string, rows: Record<string, unknown>[], totalCount: number, executionTimeMs: number, columns?: string[], affectedRows?: number, error?: string }`
- `DB_MUTATE_REQUEST`: payload `{ id: string, action: "insert" | "update" | "delete", table: string, record?: Record<string, unknown>, where?: Record<string, unknown> }`
- `DB_MUTATE_RESPONSE`: payload `{ id: string, success: boolean, affectedRows: number, error?: string }`
- `DB_MUTATED_EVENT`: payload `{ origin: "app" | "viewer", table?: string }`
- `DB_EXPORT_SEED_REQUEST`: payload `{ id: string }`
- `DB_EXPORT_SEED_RESPONSE`: payload `{ id: string, sql: string, tableCount: number, rowCount: number, error?: string }`

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Load tables in viewer | Table names, column types, primary keys, identity flags | PGlite information_schema and pg_catalog via DB_INTROSPECT |
| Display table rows | Row records, pagination count, column values | PGlite SELECT query with limit and offset via DB_QUERY |
| Edit cell value | Updated cell value | User inline input param in TanStack cell editor |
| Insert table record | New row record | User form inputs in Add Record sheet dialog |
| Delete table row | Deleted row confirmation | User selected row primary key values |
| Run custom SQL | Query rows, affected rows, and execution duration | PGlite execution results and performance.now delta via DB_QUERY |
| Save query snippet | Saved query record | User inputs (title, sql, description) sent to POST /api/projects/[id]/queries |
| Export seed data | seed.sql file content | PGlite table serialization with sequence resets via DB_EXPORT_SEED |
| Commit seed snapshot | New project snapshot record | POST /api/projects/[id]/database/seed, authoring projectFiles with seed.sql |

**Key invariants**:
- All visual CRUD mutations executed against PGlite use parameterized SQL queries (`$1, $2`) and identifier quoting to prevent SQL injection.
- Visual updates and deletes require explicit non empty `where` clauses matching primary key values. Tables without primary keys are marked read only.
- Destructive operations including DROP TABLE, TRUNCATE, and DELETE without a WHERE clause trigger a mandatory confirmation modal before execution.
- During active generation streaming or self healing passes, queries execute under `SET TRANSACTION READ ONLY` and visual mutation buttons are disabled.
- Visual cell mutations trigger a `DB_MUTATED_EVENT` broadcast across the postMessage bridge, causing preview components and viewer caches to revalidate.
- PGlite query execution has a client timeout of ten seconds paired with `statement_timeout = '10s'` to prevent runaway queries from hanging the browser tab.
- Saved query snippets in `project_queries` are strictly isolated by `projectId`, accessible only by authenticated project owners.
- The `PreviewFrame` container remains continuously mounted in the DOM, using CSS hidden classes when switching tabs to prevent destroying in memory WebContainer and PGlite state.

**Security model**:
- Host API routes authenticate requests using the active user session via Auth.js. Users can only query, modify, or delete query snippets belonging to their own projects.
- Sandbox postMessage bridge enforces window origin validation, ignoring messages from unauthorized frames.
- PGlite runs in WebAssembly entirely inside the creator's browser, eliminating raw TCP networking and remote database attack surfaces.
- Parameterized query bindings guarantee that user supplied cell values are treated as data, not executable SQL syntax.

**Configuration required**:
- None. This feature uses the existing PostgreSQL host database, local browser PGlite WebAssembly runtime, and existing Auth.js session configuration.

**Critical test scenarios**:
- Happy path (Introspect and visual CRUD): Opening the Database tab introspects PGlite schema, displays table columns, renders paginated rows in TanStack Table, allows inline cell editing, and reflects edits in PGlite, verifies **AC-3**, **AC-4**, **AC-5**.
- Happy path (Reactivity): When the preview app writes a record or the viewer modifies a row, `DB_MUTATED_EVENT` fires and both surfaces update their displayed data without a full page reload, verifies **AC-6**.
- Happy path (SQL console and saved snippets): Entering a SQL query in CodeMirror, clicking run returns timed query results, and clicking save persists the snippet to `project_queries` via REST API, verifies **AC-1**, **AC-2**, **AC-7**.
- Happy path (Seed data export): Clicking Save As Seed Data extracts all PGlite tables into SQL insert statements with sequence resets, saves `seed.sql`, and commits a new project snapshot tagged `database_seed`, verifies **AC-8**.
- Failure case (Query timeout and destructive warning): Executing a runaway query times out gracefully at ten seconds with an informative error toast, while executing a DROP or bulk DELETE displays a confirmation modal, verifies **AC-3**, **AC-7**.
- Failure case (Booting skeleton and empty state): Navigating to the database tab before PGlite completes boot displays an animated skeleton, and opening an app with zero tables displays a guided prompt empty state, verifies **AC-9**.
- Auth and locking guard: Unauthenticated users are rejected with HTTP 401 on query API routes, and active generation passes lock visual mutations into read only mode with engine level read only transactions, verifies **AC-2**, **AC-9**.

## Build plan

Following the project's Tracer Bullet delivery approach, the build plan establishes a thin end to end thread connecting the host UI to in browser PGlite first, then thickens with visual CRUD, reactivity, saved query persistence, SQL tooling, and seed snapshots.

1. **Bridge contracts and PGlite runner introspection**: Define typed bridge contracts in `packages/shared` (`DB_READY_EVENT`, `DB_INTROSPECT_REQUEST`, `DB_QUERY_REQUEST`, `DB_MUTATE_REQUEST`, `DB_MUTATED_EVENT`, `DB_EXPORT_SEED_REQUEST`) conforming to `BridgeMessage` envelope protocol, and implement two hop message forwarding and PGlite introspection in `packages/sandbox`, satisfies **AC-3**.
2. **Workbench database tab and visual data grid**: Add the Database tab to the right workbench pane in `apps/web` while keeping `PreviewFrame` permanently mounted with CSS hidden, implement table selector sidebar, and build the records grid using TanStack Table v8 with manual server pagination, column sorting, and search filtering, satisfies **AC-4**.
3. **Visual CRUD mutations and bridge invalidation**: Implement parameterized inline cell editing, Add Record sheet dialog respecting identity columns, Delete Row confirmation modal, and bidirectional `DB_MUTATED_EVENT` synchronization between preview runner and viewer, satisfies **AC-5**, **AC-6**.
4. **Host query snippets schema and REST API**: Create `project_queries` table declaration (using date mode timestamps) and relations in `packages/db`, generate and verify Drizzle migration, and build REST API routes under `/api/projects/[id]/queries` with Zod UUID validation and owner authorization, satisfies **AC-1**, **AC-2**.
5. **Interactive SQL console and saved query drawer**: Build the SQL Console tab in `apps/web` using CodeMirror 6 with SQL language extension, execution timer, query results grid, snippet bookmarking, engine level read only transaction enforcement during generation, and destructive statement confirmation modals, satisfies **AC-7**.
6. **Seed data export and snapshot commitment**: Implement `POST /api/projects/[id]/database/seed` route, preview PGlite SQL serialization handler with sequence resets, and workbench toolbar button to commit `seed.sql` into project snapshots tagged `database_seed`, satisfies **AC-8**.
7. **Lifecycle skeletons, empty states, and conversational schema prompts**: Implement boot reconnecting skeletons triggered by `DB_READY_EVENT`, zero table empty state with prompt chips, ten second query timeout handling, quick schema prompt bar routing to builder chat, and read only generation lock banner during active streaming, satisfies **AC-9**.

## Consequences

**Positive**:
- Creators gain immediate visibility into their application's real database tables without needing external database clients or terminal commands.
- Visual cell editing and record insertion allow rapid prototyping and test data setup directly in the builder interface.
- Direct synchronization via typed bridge events ensures that application actions and database inspections stay consistent without page refreshes.
- Developers retain full SQL power through the CodeMirror console with saved snippet management.
- Snapshot seed export ensures that valuable test data can be preserved across sandbox resets.
- Continuous DOM mounting preserves WebAssembly and in memory PGlite state across workbench tab navigation.

**Negative / tradeoffs**:
- Large tables in PGlite with tens of thousands of rows require strict pagination over the postMessage bridge to avoid browser memory pressure.
- Code first Drizzle schema updates require an AI generation pass to update TypeScript files rather than instant live DDL execution.
- Complex PostgreSQL types such as custom enums, bytea, or geometric types require specialized JSON serialization when crossing the postMessage bridge.

**Neutral**:
- Adds one new table `project_queries` to the host PostgreSQL database.
- Introduces TanStack Table v8 and CodeMirror 6 dependencies in `apps/web`.

## Follow-up

- [ ] Ensure that Drizzle Kit migration runners in the preview sandbox automatically trigger `DB_MUTATED_EVENT` after applying migrations.
- [ ] Add pre built quick queries (e.g. table count, foreign key map) to the SQL console drawer for developer convenience.
