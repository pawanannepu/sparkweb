# packages/sandbox

## Overview

Sandbox execution layer for sparkweb. Orchestrates StackBlitz WebContainers inside an isolated preview runner and handles host to runner messaging.

## Key files

| File           | Owns                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| `src/index.ts` | Entry point exporting sandbox runner utilities and types                   |
| `src/types.ts` | Type definitions for sandbox configuration, runner state, and event bridge |

## Commands

```bash
# Type check
pnpm --filter @spark/sandbox check-types
```

## Conventions

- Strictly typed bridge messages between host window and preview runner
- Isolated execution boundary with credentialless headers
- Pure types with named exports only

## Related specs

- [0001-stack-and-architecture](../../docs/specs/0001-stack-and-architecture/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
