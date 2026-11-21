# sparkweb

## Stack

- **Language / Runtime**: TypeScript 5.7, Node.js 22
- **Framework**: Next.js 16 (App Router, React 19) in `apps/web`
- **Database**: PostgreSQL, Drizzle ORM, PGlite
- **Monorepo & Package manager**: Turborepo, pnpm 10

## Build approach

Tracer Bullet (vertical slices where each feature is built end to end through every layer, working).

## Commands

```bash
# Dev server
pnpm dev

# Build
pnpm build

# Test
pnpm test

# E2E test
pnpm test:e2e

# Type check
pnpm check-types

# Lint
pnpm lint
```

## Tooling

- Linter and formatter: Biome across all workspaces
- Pre commit: lint, format, and typecheck before commit
- CI: GitHub Actions check on push (lint, typecheck, test)

## Git

- integration: on
- branch prefix: feat/
- commit: per-milestone

## Specs

Stored in `docs/specs/`. Format: `docs/specs/NNNN-title.md`.

## Rules

- Pure functions by default; data structures are immutable (no mutation in place).
- Side effects isolated at edges; prefer function composition over class inheritance.
- Strict types enabled (no any); strict null checks across all packages.
- Folder by feature organization; colocate components, hooks, actions, and tests.
- Explicit Result types or domain errors; validate env vars at startup with Zod.
- Named exports only; consistent naming (camelCase vars, PascalCase components).
- Accessibility baseline on UI components (WCAG AA compliance).

## Agent skills

- [next-dev-loop](.agents/skills/next-dev-loop/): `vercel/next.js`, Next.js runtime loop
- [turborepo](.agents/skills/turborepo/): `vercel/turborepo`, monorepo task orchestration
- [drizzle-orm-patterns](.agents/skills/drizzle-orm-patterns/): `giuseppe-trisciuoglio/developer-kit`, Drizzle ORM patterns
- [playwright-test-generator](.agents/skills/playwright-test-generator/): `voidmatcha/e2e-skills`, browser test generation
MCP servers: @modelcontextprotocol/server-postgres (recommended)

## Context files

- [apps/web/AGENTS.md](apps/web/AGENTS.md): Next.js web application and builder workspace
- [packages/db/AGENTS.md](packages/db/AGENTS.md): PostgreSQL database schema, Drizzle client, migrations
- [packages/sandbox/AGENTS.md](packages/sandbox/AGENTS.md): WebContainers runner and sandbox execution
- [packages/shared/AGENTS.md](packages/shared/AGENTS.md): Shared TypeScript contracts, schemas, and utilities

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
