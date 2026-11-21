# packages/shared

## Overview

Shared TypeScript domain contracts, schemas, and event definitions consumed across the builder UI, runner, and database.

## Key files

| File           | Owns                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| `src/index.ts` | Core data interfaces for ProjectFile, ProjectSnapshot, and PreviewEvent |

## Commands

```bash
# Type check
pnpm --filter @spark/shared check-types
```

## Conventions

- Zero external runtime dependencies
- Immutable data structures and deterministic type exports
- Named exports only

## Related specs

- [0001-stack-and-architecture](../../docs/specs/0001-stack-and-architecture/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
