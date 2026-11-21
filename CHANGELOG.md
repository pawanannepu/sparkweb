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

### Security
- Encrypted storage for personal provider credentials at rest with authentication tag tamper verification (see spec 0002)
- Domain level teardown protection preventing deletion of snapshots backing active live deployments (see spec 0002)
- Dedicated origin isolation and restricted iframe sandbox flags preventing untrusted preview applications from accessing parent workspace state, cookies, or storage (see spec 0003)
