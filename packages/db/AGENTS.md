# packages/db

## Overview

Database layer for sparkweb. Manages PostgreSQL database schemas, connection pooling, and migrations using Drizzle ORM.

## Key files

| File                  | Owns                                                           |
| --------------------- | -------------------------------------------------------------- |
| `src/index.ts`        | Entry point exporting client and schema definitions            |
| `src/client.ts`       | Singleton database connection using postgres.js and Drizzle    |
| `src/schema/index.ts` | Relational table definitions and relations                     |
| `drizzle.config.ts`   | Configuration for Drizzle Kit schema generation and migrations |

## Commands

```bash
# Type check
pnpm --filter @spark/db check-types

# Generate migrations
pnpm --filter @spark/db db:generate

# Apply migrations
pnpm --filter @spark/db db:migrate
```

## Conventions

- Connection pooling singleton via globalThis to prevent pool exhaustion in dev reload
- Pure schema declarations with exported TypeScript types
- Named exports only; no default exports

## Agent skills

- [drizzle-orm-patterns](.agents/skills/drizzle-orm-patterns/): `giuseppe-trisciuoglio/developer-kit`, Drizzle ORM conventions
  MCP servers: @modelcontextprotocol/server-postgres (recommended)

## Related specs

- [0001-stack-and-architecture](../../docs/specs/0001-stack-and-architecture/index.md)
- [0008-managed-database-viewer-and-client-data-tools](../../docs/specs/0008-managed-database-viewer-and-client-data-tools/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
