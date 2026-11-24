# 0007. Version history snapshots and time travel rollback (Rationale)

## Context

In an autonomous web application builder like sparkweb, users rapidly iterate across generative prompts, automated self healing passes, and direct canvas styling adjustments. Each iteration produces alterations to the underlying project file tree. When a prompt generates unexpected code, breaks application layouts, or introduces subtle regressions, creators need an intuitive way to understand what changed, test previous application checkpoints, and restore known good states without fear of losing their progress.

Without structured version history snapshots and time travel rollback, any undesirable generation step or erroneous visual edit poses a risk of permanent code degradation. Creators would be forced to craft manual reversal prompts, consuming extra model tokens and risking further drift from their intended application behavior. Furthermore, creators wanting to test radical design changes or feature variations currently have no mechanism to branch experiments safely without duplicating full projects.

Several technical forces shape this problem. First, storage efficiency versus query responsiveness: snapshot file trees contain complete source files, meaning naive full tree transfers over the wire would degrade mobile performance and waste client memory. Second, lineage integrity versus rollback semantics: destructive rollbacks that overwrite history or reset pointers discard valuable audit history and break previous deployment associations, while non destructive forward commits preserve the complete evolutionary record. Third, preview runtime synchronization: inspecting a historical version requires loading past files into the in browser WebContainer sandbox for verification while strictly preventing accidental persistence or mutation until the creator explicitly commits a rollback.

## Options considered

### Option 1: Dedicated relational branch tracking, non destructive forward commit rollback, server side diff computation, and temporary preview sandbox inspection mode

This option introduces a dedicated `project_branches` table to manage branch heads and active pointers, while extending the existing `snapshots` table with trigger classifications, optional tags, and explicit rollback ancestry links. When a creator rolls back, the system creates a new forward snapshot containing the restored file tree, preserving an unbroken chronological record. File tree diffs are computed server side using jsdiff to keep network transfers under twenty kilobytes. In the client workbench, selecting a past version activates a temporary read only inspect mode that loads historical files into the running WebContainer sandbox with a prominent inspection banner, allowing interactive testing before confirming rollback.

**Pros**:
- Non destructive forward commit model guarantees that no historical state is ever lost or overwritten.
- Server side diff computation drastically reduces client network payload and memory footprint during timeline browsing.
- Temporary inspect mode enables full interactive testing of past versions in the live preview sandbox without mutating database records.
- Dedicated branch records provide clean isolation for experimental workflows with instant workspace switching.

**Cons**:
- Storing full file trees on every forward snapshot causes database storage to grow proportionally with generation frequency.
- Switching between versions with differing package dependencies incurs a brief sandbox reboot delay.

### Option 2: Git style commit pointer resets on linear snapshot history without dedicated branch tables

This option treats the existing `snapshots` table as a flat linear commit log where branches are represented solely by string names on each snapshot record. Rolling back simply moves the `projects.currentSnapshotId` pointer backward to a historical snapshot. If subsequent edits occur from an earlier snapshot, intermediate snapshots are either overwritten or orphaned. Diffs are calculated entirely on the client side by downloading both snapshot file maps and running comparisons in the browser.

**Pros**:
- Requires minimal database schema alterations since snapshots already possess a branch name column.
- Rolling back is instantaneous on the database layer because it only updates a single foreign key pointer.

**Cons**:
- Moving pointers backward risks orphaning or overwriting previous generation steps, violating the core promise of risk free iteration.
- Downloading two complete JSON file maps to compute diffs in browser wastes client bandwidth and induces noticeable lag on large projects.
- Lacks first class branch management, making it difficult to list, rename, or switch between distinct experimental tracks.

### Option 3: Client only history undo stack backed by IndexedDB with manual cloud checkpoints

This option manages fine grained version history and undo operations exclusively inside the creator's browser using IndexedDB or local storage. Full database snapshots are created only when creators explicitly click a manual save checkpoint button in the toolbar. Code diffs and preview time travel occur entirely in browser memory.

**Pros**:
- Drastically reduces database write volume and backend storage costs by keeping intermediate revisions on the client.
- Extremely fast undo and redo transitions for rapid local canvas adjustments.

**Cons**:
- Unsaved browser history is lost if the creator clears site cache, switches devices, or reloads in another browser window.
- Inconsistent with the platform architecture where autonomous generation steps run server side and require reliable cloud persistence.
- Precludes sharing specific historical snapshot links or diffs across different client sessions.

## Rationale

Option 1 is selected because it directly aligns with sparkweb's foundational goals: providing a resilient, risk free creation environment while maintaining complete developer grade code ownership. 

A non destructive forward commit model is essential for creative confidence. When creators know that every action is preserved in an immutable audit trail, they are empowered to experiment freely. Pointer resets (Option 2) or client only local history (Option 3) introduce unacceptable risks of accidental data loss when switching branches or clearing browser cache. By recording `restoredFromSnapshotId` on a new forward snapshot, the platform maintains clear lineage while guaranteeing that past deployments remain connected to their exact immutable code states.

Furthermore, computing diffs on the server side using jsdiff resolves the bandwidth and performance bottleneck of downloading multiple full file trees. Combining lightweight cursor paginated timeline metadata with a temporary inspect mode gives creators the best of both worlds: fast browsing through version history and the ability to interactively test any historical application state before confirming a rollback.
