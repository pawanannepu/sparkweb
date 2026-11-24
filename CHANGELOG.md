# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Relational database schema in PostgreSQL and PGlite using Drizzle ORM for identity, workspaces, prompt threads, code snapshots, and deployments (see spec 0002)
- AES 256 GCM envelope encryption for personal provider API keys with initialization vectors, authentication tags, and non sensitive key hints (see spec 0002)
- Immutable virtual file system snapshots with deterministic SHA 256 content addressable tree hashing (see spec 0002)
- Typed domain queries and mutations for workspaces, thread sequencing, snapshot lineage, and deployment records (see spec 0002)
- Database migration runner and initial SQL migration script supporting PostgreSQL and local PGlite (see spec 0002)
- Studio visual design system with dark mode first palette, Geist typography, and flash prevention head script (see spec 0003)
- Accessible base UI component primitives built with Radix UI including buttons, inputs, textareas, tooltips, dialogs, dropdown menus, tabs, badges, scroll areas, and separators (see spec 0003)
- Resizable split pane builder workbench with smooth drag resizing, pointer capture shield, and keyboard collapse toggle via Cmd+B and Ctrl+B shortcuts (see spec 0003)
- Workspace layout state hook with debounced local storage persistence and schema fallback validation (see spec 0003)
- Responsive mobile workbench layout with persistent bottom switcher bar for screen viewports under 768px (see spec 0003)
- Live preview container with isolated iframe sandbox attributes, device viewport presets for desktop, tablet, and mobile with auto scale down, and URL address navigation bar (see spec 0003)
- Typed cross context postMessage bridge connecting host builder window and sandbox iframe with origin verification and handshake message buffering (see spec 0003)
- Server generation route streaming task milestones, tool calls, and file operations over Server Sent Events (see spec 0004)
- In browser WebContainer runtime runner mounting virtual file trees and executing client side Vite preview with WebAssembly PGlite database (see spec 0004)
- Incremental file synchronization writing modified files into the active WebContainer file system via typed bridge messages to trigger Vite hot module replacement (see spec 0004)
- Prompt composer component with model selection dropdown supporting Anthropic Claude, OpenAI GPT-4o, and Google Gemini models (see spec 0004)
- Generation progress card displaying real time task planning milestones, active file status badges, and expandable code diff previews (see spec 0004)
- Client generation loop hook orchestrating streaming event consumption, local diff tracking, and user abort cancellation (see spec 0004)
- Preview compilation error banner capturing compiler diagnostics and runtime errors from the runner iframe (see spec 0004)
- Automated snapshot persistence computing SHA 256 tree hashes and recording immutable turn checkpoints to PostgreSQL upon stream completion (see spec 0004)
- Visual canvas inspector mode toggle in preview toolbar activating hover bounding box outlines and pixel dimensions inside the live preview (see spec 0005)
- In app canvas overlay client script with click selection, hover outlines, and data source location attribute detection (see spec 0005)
- Right docked visual inspector panel providing visual controls for text content, typography, spacing, background colors, and borders (see spec 0005)
- In browser AST modifier using recast and tailwind-merge to update JSX Tailwind utility classes while preserving formatting, indentation, and comments (see spec 0005)
- Direct inline content editable text editing for static leaf JSX text nodes with instant preview updates and Enter key commit (see spec 0005)
- In memory undo and redo history stack supporting Command+Z and Command+Shift+Z keyboard shortcuts for visual adjustments (see spec 0005)
- Automated snapshot persistence endpoint committing full project file maps to PostgreSQL after three seconds of user inactivity with parent snapshot lineage tracking (see spec 0005)
- Structured diagnostic parser categorizing compiler errors, syntax issues, unresolved imports, and runtime exceptions with line shift invariant SHA256 error fingerprints (see spec 0006)
- Dedicated server repair streaming endpoint using AI SDK to stream targeted file patches with sibling import context without full prompt regeneration (see spec 0006)
- Health check handshake bridge between host builder and preview runner verifying Vite hot module replacement completion and absence of error overlays (see spec 0006)
- Client verification loop with error fingerprint history loop detection capping automatic repairs at three attempts per generation turn (see spec 0006)
- Expandable healing progress card component in generation panel displaying error diagnosis, patch file badges, retry counts, and resolution status (see spec 0006)
- Interactive manual repair button on preview error banner allowing creators to trigger on demand repair passes with a fresh retry budget (see spec 0006)
- Deferred snapshot persistence committing project snapshots and healing telemetry to PostgreSQL only after preview health verification succeeds (see spec 0006)

### Changed
- Builder workbench default preview target points to the active WebContainer sandbox runner route (see spec 0004)
- Preview toolbar and builder workbench accommodate right docked inspector panel with responsive layout and mobile tab integration (see spec 0005)
- Sandbox starter template bundles custom Vite inspector plugin and client runtime script for source location tagging (see spec 0005)
- Server generation route defers snapshot persistence and returns message identifiers in event streams for client verification orchestration (see spec 0006)
- Preview runner listens for hot module replacement events and responds to health verification probes (see spec 0006)

### Security
- Encrypted storage for personal provider credentials at rest with authentication tag tamper verification (see spec 0002)
- Domain level teardown protection preventing deletion of snapshots backing active live deployments (see spec 0002)
- Dedicated origin isolation and restricted iframe sandbox flags preventing untrusted preview applications from accessing parent workspace state, cookies, or storage (see spec 0003)
- Cross origin isolation headers across builder workbench and sandbox runner enabling WebAssembly SharedArrayBuffer execution (see spec 0004)
- Workspace source boundary enforcement in client AST modifier rejecting modifications to external node_modules or path traversal attempts (see spec 0005)
- Read only warning badges and disabled editing controls for unmapped or third party components (see spec 0005)
- Fingerprint loop detection preventing infinite circular repair passes and runaway token consumption (see spec 0006)
