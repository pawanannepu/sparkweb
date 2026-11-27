# 0005. Visual canvas inspector and direct styling

**Date**: 2026-11-22
**Status**: Accepted

## Summary

This specification establishes a visual canvas inspector and direct styling workflow for sparkweb. Creators click an inspector toggle in the preview toolbar, hover elements to see live bounding boxes, and select any element to inspect its styles. An in app client script injected via a Vite plugin handles canvas element selection and communicates across the postMessage bridge. A right docked inspector panel lets creators adjust text, typography, spacing, layout, colors, and borders using visual controls or direct inline text editing on leaf nodes. Style updates apply to the preview instantly with zero latency, while an in browser AST engine using recast and tailwind-merge updates JSX classes in a centralized client file store and debounces writes to the WebContainer file system, automatically saving snapshots to PostgreSQL.

## Requirements

**User stories**:
- As a creator, I want to click any element in the live preview to inspect its styling and layout, so that I understand how the visual interface is constructed.
- As a creator, I want to edit text labels, typography, colors, padding, and layout visually using simple controls, seeing updates appear instantly on the canvas.
- As a creator, I want double clicking a static text element to allow inline editing directly on the preview canvas, so that I can fix copy quickly without prompt round trips.
- As a creator, I want visual styling changes to cleanly update Tailwind CSS classes in the real JSX source files without reformatting existing indentation or deleting comments.
- As a creator, I want to undo and redo visual adjustments with standard keyboard shortcuts, so that I can experiment freely without fear of breaking my application.
- As a developer, I want direct canvas adjustments restricted to workspace source files, preventing unintended modifications to external dependencies.
- As an operator, I want canvas modifications automatically committed as snapshots to PostgreSQL after three seconds of user inactivity, ensuring full project file trees and snapshot lineage are preserved.

**Acceptance criteria**:
- **AC-1**: Inspector toggle button in the preview toolbar enables canvas inspection mode, transmitting typed `PREVIEW_INSPECT_MODE` bridge messages to activate overlay listeners inside an in app client script injected by the sandbox Vite development plugin.
- **AC-2**: Hovering any DOM element inside the preview iframe renders an animated bounding box outline displaying element tag name, class preview, and pixel dimensions, without obstructing page scrolling.
- **AC-3**: Clicking an element locks selection, reads the `data-source-loc` attribute injected by the Vite Babel JSX compilation plugin, and emits a `PREVIEW_ELEMENT_SELECT` bridge message with file path, line, column, tag name, Tailwind classes, computed styles, text content, and editable status.
- **AC-4**: Collapsible inspector panel docked on the right side of the workbench opens on element selection, providing accessible visual controls for text content, typography, spacing (margin and padding), layout (flex and grid), background colors, and borders.
- **AC-5**: Changing visual controls immediately updates element styles in the preview DOM via `PREVIEW_INJECT_STYLES` for zero latency feedback, while an in browser AST engine using `recast` and `tailwind-merge` replaces conflicting utility classes in the component JSX file from the centralized client file store, writing debounced (300ms) updates to the WebContainer virtual file system.
- **AC-6**: Double clicking an element inside the preview iframe enables inline content editable text editing strictly on leaf DOM elements containing a single static string literal, committing string updates directly to JSX text nodes in the source file on blur or Enter key press while ignoring elements with dynamic JSX expressions or icon children.
- **AC-7**: Direct code modifications verify that source file paths reside within project workspace folders (such as `src/`), displaying an informative read only badge and disabling direct edits for elements originating from external packages or unmapped wrappers.
- **AC-8**: Visual adjustments maintain an in memory client undo redo stack in the workbench supporting Command+Z and Command+Shift+Z, automatically lock during active AI generation streams, and an idle duration of three seconds triggers an auto save snapshot to PostgreSQL via `POST /api/projects/[id]/snapshots` passing the full project file map, linking `parentId` and updating `projects.currentSnapshotId`.

## Decision

**Chosen option**: Option 1: Live DOM inspector overlay via Vite plugin injection with client AST Tailwind manipulation and dual bridge synchronization

We implement an in app DOM inspector overlay injected directly into the preview application using a dedicated Vite development plugin (`vite-plugin-spark-inspector`), paired with a right docked visual inspector panel in the host workbench. The Vite plugin tags JSX elements with source locations (`data-source-loc`) and runs inside the preview origin, eliminating cross origin DOM access barriers. Clicking an element transmits its location, classes, and styles across the postMessage bridge. The host workbench executes client side AST transformations using `recast` (to preserve code formatting) and `tailwind-merge` (to resolve class utility collisions) on a centralized in memory project file store. Changes inject instant CSS overrides into the preview DOM for zero latency interaction while debouncing writes to the WebContainer file system. Edits automatically persist full project snapshots to PostgreSQL via a dedicated project snapshots endpoint after three seconds of inactivity, maintaining exact snapshot parent lineage.

**Implementation skills**: `next-dev-loop` (`vercel/next.js`, `.agents/skills/next-dev-loop/`) · `turborepo` (`vercel/turborepo`, `.agents/skills/turborepo/`) · `drizzle-orm-patterns` (`giuseppe-trisciuoglio/developer-kit`, `.agents/skills/drizzle-orm-patterns/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:
The feature reuses the core persistence schema established in Spec 0002 without requiring database migrations:

```
snapshots
  id: uuid (PK)
  projectId: uuid (FK -> projects.id on delete cascade)
  parentId: uuid (nullable FK -> snapshots.id on delete set null)
  branchName: text (default 'main')
  treeHash: text (SHA256 content addressable hash)
  files: jsonb (map of relative file path to { content: string, isBinary?: boolean })
  message: text (turn summary e.g. 'Visual styling update')
  createdAt: timestamp

projects
  id: uuid (PK)
  currentSnapshotId: uuid (nullable FK -> snapshots.id on delete set null)
  updatedAt: timestamp
```

Centralized client store in workbench memory (`useProjectFilesStore`):

```typescript
export interface ElementSourceLocation {
  file: string;
  line: number;
  column: number;
  componentName?: string;
}

export interface ElementRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface SelectedElementState {
  selector: string;
  tagName: string;
  source?: ElementSourceLocation;
  classes: string[];
  styles: Record<string, string>;
  textContent: string;
  rect: ElementRect;
  isEditable: boolean;
  isLeafTextOnly: boolean;
}

export interface CanvasHistoryEntry {
  id: string;
  timestamp: number;
  files: Record<string, string>;
  description: string;
}

export interface CanvasHistoryStack {
  past: CanvasHistoryEntry[];
  present: Record<string, string>;
  future: CanvasHistoryEntry[];
}

export interface ProjectFilesStoreState {
  files: Record<string, { content: string; isBinary?: boolean }>;
  isStreaming: boolean;
  selectedElement: SelectedElementState | null;
  history: CanvasHistoryStack;
  setFiles: (files: Record<string, { content: string; isBinary?: boolean }>) => void;
  updateFileContent: (path: string, content: string) => void;
  setSelectedElement: (element: SelectedElementState | null) => void;
}
```

Bridge protocol additions in `@spark/shared`:

```typescript
export type BridgeMessageType =
  | "PREVIEW_BOOT"
  | "PREVIEW_WRITE_FILES"
  | "PREVIEW_READY"
  | "PREVIEW_NAVIGATE"
  | "PREVIEW_RELOAD"
  | "PREVIEW_ERROR"
  | "PREVIEW_RESIZE"
  | "PREVIEW_HEARTBEAT"
  | "PREVIEW_INSPECT_MODE"
  | "PREVIEW_ELEMENT_HOVER"
  | "PREVIEW_ELEMENT_SELECT"
  | "PREVIEW_INJECT_STYLES"
  | "PREVIEW_UPDATE_TEXT"
  | "PREVIEW_HMR_COMPLETE";

export interface PreviewInspectModePayload {
  enabled: boolean;
}

export interface PreviewElementHoverPayload {
  rect: ElementRect;
  tagName: string;
  classes: string[];
}

export interface PreviewElementSelectPayload {
  selector: string;
  tagName: string;
  rect: ElementRect;
  source?: ElementSourceLocation;
  classes: string[];
  styles: Record<string, string>;
  textContent: string;
  isEditable: boolean;
  isLeafTextOnly: boolean;
}

export interface PreviewInjectStylesPayload {
  selector: string;
  styles: Record<string, string>;
}

export interface PreviewUpdateTextPayload {
  selector: string;
  text: string;
}

export interface PreviewHmrCompletePayload {
  timestamp: number;
}
```

**State transitions**:
Canvas inspector lifecycle states:

```
[Inspector Inactive]
       |
  (Toggle ON)
       v
[Inspector Active: Idle] <-------------------------------+
       |                                                 |
  (Hover Element)                                        |
       v                                                 |
[Element Hovered: Outline Rendered]                      |
       |                                                 |
  (Click Element)                                        |
       v                                                 |
[Element Selected: Controls Docked]                      |
       |                                                 |
  +----+--------------------------------+                |
  |                                     |                |
(Edit Styles)             (Double Click Leaf Text Node)  |
  v                                     v                |
[Instant Style Injection]        [Inline Text Editing]   |
  |                                     |                |
(Debounced 300ms AST Write)      (Blur or Enter Press)   |
  v                                     v                |
[Virtual Filesystem Updated] ----> [Sync Source AST]     |
  |                                                      |
  v                                                      |
(Vite HMR Completes -> Clear Temp Inline Style)          |
  |                                                      |
(Idle 3s and Not Streaming)                              |
  v                                                      |
[Commit Full Snapshot to PostgreSQL via API]            |
  |                                                      |
  +------------------------------------------------------+
  |
(Toggle OFF or Unmount or AI Stream Starts)
  v
[Inspector Inactive]
```

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/projects/[id]/snapshots | POST | files: SnapshotFilesMap (req), message: string (opt) | id: string, treeHash: string, createdAt: string | Session cookie | 401 unauthorized, 404 project not found, 400 invalid files |

Behavior of `POST /api/projects/[id]/snapshots`:
- Validates that the authenticated user owns the project.
- Queries `projects.currentSnapshotId` to set as `parentId` on the new snapshot record.
- Computes canonical SHA256 tree hash across all files, excluding `node_modules` and caches.
- Inserts new snapshot into `snapshots` table.
- Updates `projects.currentSnapshotId` to point to the newly created snapshot ID.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Toggle canvas inspection | Active inspector state and toolbar indicator | Client toggle state stored in useWorkspaceLayout hook |
| Hover canvas element | Bounding box dimensions and element badge | getBoundingClientRect() and computed CSS classes in Vite injected client script |
| Select canvas element | Source file path, line, and column numbers | data-source-loc attribute injected by Vite Babel JSX transform plugin |
| Display inspector controls | Current Tailwind tokens, spacing, and colors | Parsed className tokens from selected element AST and computed styles |
| Component source retrieval | Component raw JSX code for AST modification | In memory centralized client store useProjectFilesStore |
| Direct style adjustment | Instant visual feedback on preview canvas | Inline style rule overrides sent via PREVIEW_INJECT_STYLES bridge message |
| Direct style file commit | Updated JSX className string in component file | In browser recast AST engine and tailwind-merge resolving class collisions |
| Inline text editing | Updated text node literal in JSX component | ContentEditable event payload received via PREVIEW_UPDATE_TEXT message |
| Snapshot parent lineage | parentId on new snapshot record | projects.currentSnapshotId read from database before inserting snapshot |
| Auto save snapshot | Immutable snapshot ID and SHA256 tree hash | POST /api/projects/[id]/snapshots computing tree hash across full files map |

**Key invariants**:
- The in app inspector script must run inside the preview application origin, communicating with the parent workbench exclusively via typed postMessage contracts.
- Direct canvas modifications must never alter files outside the project workspace `src/` directory.
- AST manipulations must use `recast` to preserve existing indentation, quotes, and comments, and `tailwind-merge` to resolve utility class conflicts without duplicating CSS properties.
- Inline text editing is permitted only on leaf DOM nodes whose sole child is a static `JSXText` string, preventing damage to dynamic bindings, state expressions, or nested icon components.
- Instant inline style injections must be cleared upon receiving `PREVIEW_HMR_COMPLETE` from Vite, preventing specificity conflicts with compiled Tailwind classes.
- Inspector controls must be disabled and any pending auto save timers cancelled while an AI generation stream is active, preventing concurrent snapshot collisions.
- Auto save requests must be debounced by three seconds of user inactivity, passing the complete `SnapshotFilesMap` from the client file store to prevent file tree truncation.

**Security model**:
- Project snapshots endpoint verifies authenticated user session and project ownership in PostgreSQL before accepting file updates.
- Source file writes are restricted to relative paths within the project workspace, rejecting any path containing directory traversal tokens (such as `../`).
- The preview runner iframe runs under cross origin isolation headers, communicating solely through strictly typed postMessage contracts validated by protocol headers.

**Critical test scenarios**:
- Happy path: User clicks inspector toggle in toolbar, hovers a button in preview to view dimensions, clicks the button to open right inspector panel, modifies padding and background color, observes instant preview changes, and verifies that the component file receives updated Tailwind classes with preserved formatting, verifying **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**.
- Inline text editing: User double clicks a plain text heading on canvas, types updated copy, presses Enter, and verifies that the string literal updates in the JSX source file without reloading the page, verifying **AC-6**.
- Dynamic child protection: User attempts to double click an element containing nested icons or dynamic template expressions, observing that inline text editing is disabled while style controls remain active, verifying **AC-6**.
- Dependency protection: User clicks an element originating from external node_modules or unmapped third party wrapper, observing a read only badge and disabled styling inputs, verifying **AC-7**.
- Undo redo stack: User modifies three styling properties in sequence, presses Command+Z twice, and verifies that both the preview canvas and component source files revert accurately to previous states, verifying **AC-8**.
- Auto save persistence: User makes visual styling adjustments, waits three seconds without additional input, and verifies that a new snapshot is committed to PostgreSQL containing all project files and linking the parent snapshot ID, verifying **AC-8**.
- Concurrency lock: User starts an AI prompt generation while inspector is open, observing that the inspector disables immediately and any pending auto save timer is safely cancelled, verifying **AC-8**.

## Build plan

**Approach**: Tracer Bullet (thin vertical slice linking toolbar toggle, in app Vite inspector plugin, client AST writer, inspector property controls, and snapshot persistence end to end).

- [x] **Task 1: Shared bridge message contracts and Vite inspector plugin**
  Extend `@spark/shared` with inspector bridge message types (`PREVIEW_INSPECT_MODE`, `PREVIEW_ELEMENT_HOVER`, `PREVIEW_ELEMENT_SELECT`, `PREVIEW_INJECT_STYLES`, `PREVIEW_UPDATE_TEXT`, `PREVIEW_HMR_COMPLETE`) and build `vite-plugin-spark-inspector` in `packages/sandbox/src/template.ts` to inject `data-source-loc` attributes into compiled JSX nodes and bundle the in app inspector client script.
  Satisfies: **AC-1**, **AC-2**, **AC-3**

- [x] **Task 2: In app canvas inspector overlay client script and DOM listeners**
  Implement the canvas inspector client script inside the sandbox template bundle, attaching hover bounding box graphics, click selection listeners, leaf node contentEditable text editing, temporary style injection handlers, and HMR completion notifications.
  Satisfies: **AC-1**, **AC-2**, **AC-3**, **AC-6**

- [x] **Task 3: Client project file store and AST modifier with recast and tailwind-merge**
  Create a centralized project file store in `apps/web/src/hooks/useProjectFiles.ts` and build an AST manipulation utility in `apps/web/src/lib/ast-modifier.ts` using `recast` and `tailwind-merge` to resolve class collisions, preserve code formatting, and safely update JSX text nodes.
  Satisfies: **AC-5**, **AC-6**, **AC-7**

- [x] **Task 4: Right docked visual inspector panel and style controls**
  Create accessible inspector UI components in `apps/web/src/components/inspector/` (typography controls, color pickers, padding and margin boxes, layout flex grid switchers, text inputs) and integrate with the workbench layout in `apps/web/src/components/layout/BuilderWorkbench.tsx`.
  Satisfies: **AC-4**, **AC-5**, **AC-7**

- [x] **Task 5: Dedicated snapshot persistence API route, concurrency lock, and client history stack**
  Create `apps/web/src/app/api/projects/[id]/snapshots/route.ts` with session authentication and snapshot lineage tracking, implement three second debounced auto save in the workbench with AI generation stream locking, and add in memory undo redo history with Command+Z keyboard shortcuts.
  Satisfies: **AC-8**

## Consequences

- Direct visual editing provides instant tactile feedback for creators, reducing reliance on chat prompt round trips for simple cosmetic tweaks.
- In app inspector injection via a Vite dev plugin respects browser cross origin boundaries, allowing reliable element inspection without security exceptions.
- Using `recast` and `tailwind-merge` prevents file reformatting churn and utility class duplication, keeping git diffs minimal and readable.
- Restricting inline editing to leaf static text nodes protects dynamic React expressions and icon components from accidental corruption.
- Centralizing the project file store prevents partial snapshot truncation and eliminates concurrency races between visual styling and AI generation streams.

## Follow-up

- [ ] Connect selected element context into the prompt composer so creators can optionally pair visual selection with natural language instructions.
- [ ] Add visual drag handles for interactive margin and padding resizing directly on the canvas overlay box in a future enhancement.
