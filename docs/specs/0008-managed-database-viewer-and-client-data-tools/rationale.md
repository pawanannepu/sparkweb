# 0008. Managed database viewer and client data tools: Rationale

## Context

sparkweb generates full stack web applications that execute entirely in browser using StackBlitz WebContainers and PGlite (a WebAssembly build of PostgreSQL). In Slice 1 through Slice 4, creators gained prompt based generation, live preview rendering, visual canvas styling, self healing builds, and snapshot version history. However, generated applications remain a black box regarding their persistent state: creators cannot inspect what tables were created, what rows are stored, or whether their application forms and actions successfully mutated the database.

Debugging and iterating on data driven applications without a visual database viewer forces creators to guess or write custom UI components just to verify record creation. Furthermore, adding new columns or tables requires manual prompt rounds with no immediate visual feedback verifying that schema migrations applied cleanly. Developers also need direct SQL querying tools to inspect complex queries, verify relational joins, and debug application logic without leaving the builder interface.

A visual database viewer must operate under several architectural constraints:
First, PGlite runs directly inside the isolated preview runner iframe in browser WebAssembly. There are no raw TCP network connections or remote database servers to connect to with standard database GUI tools. All schema introspection and data querying must travel across the browser postMessage bridge conforming to the standard `BridgeMessage` envelope protocol.
Second, the preview frame must remain mounted continuously in the host DOM (using CSS hidden when inactive) because unmounting Radix tabs would destroy the WebContainer iframe and reset all in memory PGlite database state.
Third, visual mutations like editing a cell or inserting a row must execute safely with parameterized queries and identifier quoting so that user input cannot cause SQL injection or corrupt application state.
Fourth, data changes made in the viewer must synchronize reactively with the running application in the preview iframe, and changes made by the application must update the viewer without manual browser reloads.
Finally, test data created during development is lost whenever the sandbox reboots unless an explicit seed export mechanism persists records into project snapshots.

## Options considered

### Option 1: In browser PGlite inspection via typed postMessage bridge, TanStack visual data grid, CodeMirror SQL console, host query snippets, and snapshot seed export

The host workbench introduces a dedicated Database tab alongside Preview and Code in the right workbench pane. The preview frame remains permanently mounted in the DOM to preserve in memory WebAssembly database state. The host communicates with the preview runner's embedded PGlite instance through a typed postMessage bridge with correlation IDs conforming to the `BridgeMessage` protocol for introspection, queries, and mutations. The visual records viewer uses TanStack Table v8 for manual server pagination, column sorting, and inline cell editing. An interactive SQL console powered by CodeMirror 6 provides syntax highlighting, autocompletion, query execution timing, and saved snippet management, with engine level read only transactions during active generation passes. Saved queries persist in a new host PostgreSQL table `project_queries`. Schema modifications operate code first via Drizzle schema updates in generation passes, and creators can export current PGlite records into `seed.sql` snapshots with a single click.

**Pros**:
- Zero server execution cost and instant query responses because queries execute against local WebAssembly PGlite in the browser.
- Full parity with standard PostgreSQL capabilities, including relational joins, JSONB queries, and constraints.
- Clean separation between ephemeral test records and durable project seed files via the snapshot export flow.
- Reuses established workspace bridge patterns and component primitives from TanStack Table and CodeMirror.
- Continuous DOM mounting guarantees that database tables and rows survive workbench tab navigation.

**Cons**:
- Large tables in PGlite with tens of thousands of rows require strict pagination over the postMessage bridge to avoid browser memory pressure.
- Requires maintaining bidirectional invalidation events between the preview runner and the host workbench.

### Option 2: Server side proxy database with remote PostgreSQL container per project

Spin up an isolated cloud PostgreSQL container or serverless database branch for each active project, proxying all preview queries and viewer requests through host Next.js server actions.

**Pros**:
- Allows external GUI tools such as psql, DBeaver, or TablePlus to connect to the database directly via standard TCP sockets.
- Offloads database memory and execution from the client browser.

**Cons**:
- Substantial infrastructure operational cost and maintenance overhead per active user session.
- Substantial network latency for every local application interaction in the preview runner.
- Contradicts the sparkweb architectural foundation of zero cost in browser WebContainers and client side PGlite.

### Option 3: Read only schema viewer with prompt based mutations only

Provide a basic read only table list and record viewer in the workbench, disallowing direct cell edits, record insertions, and raw SQL execution. All modifications must be requested through natural language chat prompts.

**Pros**:
- Simpler implementation with fewer bridge message types and zero mutation safety risks.
- Avoids building inline table editing controls and SQL console tooling.

**Cons**:
- Frustrating developer experience for simple data fixes, requiring repeated prompt round trips just to change a single test record.
- Prevents creators from quickly testing edge cases or manually inserting custom test rows.

## Rationale

We selected Option 1 because it fits sparkweb's zero cost in browser execution architecture while delivering a professional grade data management experience.

Because PGlite compiles authentic PostgreSQL into WebAssembly and runs inside the preview runner, querying and mutating data locally introduces negligible latency and zero server operational costs. Connecting the host workbench to PGlite through a typed postMessage bridge follows the same proven message passing patterns established in Slice 1 (core generation loop), Slice 2 (visual canvas inspector), and Slice 3 (self healing engine).

Using TanStack Table v8 provides lightweight, accessible data grid capabilities that align with our existing shadcn/ui component system. CodeMirror 6 delivers a responsive, modular SQL editing environment with syntax highlighting and autocomplete while keeping bundle sizes small compared to heavy alternatives like Monaco Editor.

Persisting saved query snippets in the host PostgreSQL database (`project_queries`) gives creators a permanent repository of useful queries that survive sandbox restarts, while the Save As Seed Data action closes the loop between manual testing and durable version control by writing `seed.sql` directly into project snapshots.
