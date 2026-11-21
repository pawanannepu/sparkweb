# 0001. Stack and architecture

**Date**: 2026-11-21
**Status**: In Progress

## Summary

This specification establishes the foundational technology stack for sparkweb. We adopt a Next.js Turborepo monorepo with React 19, TypeScript, Tailwind CSS v3.4, and shadcn/ui for the builder workspace. Live application execution and preview run in browser through StackBlitz WebContainers inside an isolated preview runner, using PGlite for in browser WebAssembly PostgreSQL persistence. Application data, user identities, and content addressable snapshot trees persist in PostgreSQL using Drizzle ORM and Auth.js.

## Decision

**Chosen option**: Option 1: Next.js Turborepo monorepo with in browser WebContainers, PGlite, and Drizzle ORM

We adopt a modular Turborepo monorepo hosting a Next.js App Router workspace, in browser StackBlitz WebContainers inside a dedicated sandbox runner, PGlite for in browser WebAssembly PostgreSQL persistence, PostgreSQL with postgres.js and Drizzle ORM in packages/db with connection pooling singletons, Auth.js for self hosted authentication, Tailwind CSS v3.4 with shadcn/ui for stable component generation, and Vercel AI SDK Core for streaming synthesis.

**Implementation skills**: `turborepo` (`vercel/turborepo`, `.agents/skills/turborepo/`) · `next-dev-loop` (`vercel/next.js`, `.agents/skills/next-dev-loop/`)

## Proposed stack

| Layer | Choice | Reason |
|---|---|---|
| Monorepo & Tooling | Turborepo with pnpm | Fast workspace orchestration, shared TypeScript configurations, and remote caching |
| Language & Runtime | TypeScript with Node.js 22 | Strict type safety across client UI, shared protocols, and server endpoints |
| Frontend Framework | Next.js 15 (App Router, React 19) | Server components, streaming responses, route handlers, and unified SSR |
| UI & Styling | Tailwind CSS v3.4 with shadcn/ui | Proven utility first styling and accessible Radix UI primitives with stable generator output |
| Live Preview Sandbox | StackBlitz WebContainers (@webcontainer/api) | In browser WebAssembly Node.js runtime with virtual file system and zero server compute cost |
| Preview Runner Boundary | Dedicated sandbox runner route (credentialless) | Isolates cross origin headers to protect host Auth.js OAuth popups and external avatar images |
| Preview Database | PGlite (WASM PostgreSQL) | Authentic in browser PostgreSQL relational database without requiring raw TCP sockets |
| Host Database | PostgreSQL with postgres.js driver | Proven ACID relational database supporting structured metadata and JSONB trees |
| ORM & Migrations | Drizzle ORM in packages/db | High performance, type safe TypeScript SQL schema declarations and light migrations |
| Connection Pooling | globalThis singleton pattern | Prevents database connection exhaustion during development hot module reload cycles |
| Authentication | Auth.js (NextAuth v5) | Open source, self hosted session management directly in PostgreSQL |
| AI Synthesis Pipeline | Vercel AI SDK Core (ai 7.x) and @ai-sdk/react | Native streaming UI hooks, structured Zod output validation, and multi step tool execution |
| Preview Communication | Typed postMessage RPC Bridge | Structured bi directional event bus for logs, errors, file updates, and inspector clicks |
| Code Inspector | AST attribute injection (Vite plugin) | Injects file and line coordinates into JSX during dev compilation inside the preview |
| Live Publishing | Container deployment API (Fly.io or Railway) | Packages production snapshots into lightweight isolated containers with custom domains |
| Template Cache | Pre bundled virtual templates & Browser Cache | Warm virtual file system starter templates and tarball caching to prevent memory crashes |

## Consequences

**Positive**:
- Zero server compute expense incurred during code generation, interactive editing, and preview testing
- Sub second preview boot times deliver an instantaneous, responsive creative feedback loop
- Full stack generated applications run real PostgreSQL queries via PGlite entirely in the browser
- Host application preserves full compatibility with OAuth popups and third party avatar images
- Developers can export clean, standard Vite and React code trees that run anywhere without proprietary runtimes
- Complete data sovereignty with self hosted authentication and relational database persistence

**Negative / tradeoffs**:
- WebContainers remain subject to browser tab memory limits on mobile devices
- Native C++ compiled binaries cannot execute in WebContainer unless WebAssembly ports exist
- Initial repository setup requires configuring Turborepo workspace pipelines, pnpm hoisting, and shared tsconfig packages

**Neutral**:
- Team members and agents must follow monorepo import boundaries between packages and apps
- Upgrading to Tailwind CSS v4 is deferred until shadcn/ui CLI templates officially support CSS-first configuration

## Follow-up

- [ ] Connect the PostgreSQL MCP server (@modelcontextprotocol/server-postgres) to enable live database inspection for development agents
- [x] Configure the isolated sandbox preview runner route with credentialless embedder policies in Next.js configuration
- [x] Implement the database client singleton in packages/db to prevent development connection exhaustion
- [x] Scaffold the Turborepo monorepo layout in feature 1 execution (/develop stack & architecture)
- [x] Capture project wide conventions into root AGENTS.md during feature 2 (/audit)
