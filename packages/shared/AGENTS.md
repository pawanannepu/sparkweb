# packages/shared

## Overview

Shared TypeScript domain contracts, schemas, and event definitions consumed across the builder UI, runner, and database.

## Key files

| File                | Owns                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `src/index.ts`      | Core data interfaces for ProjectFile, ProjectSnapshot, and PreviewEvent  |
| `src/ai-models.ts`  | Provider model resolution, live catalog formatters, and vision flags     |
| `src/multimodal.ts` | Multimodal attachment DTOs, `DesignOutlinePayloadSchema`, and formatters |

## Commands

```bash
# Type check
pnpm --filter @spark/shared check-types
```

## Conventions

- Runtime dependency: `zod` for shared DTO schemas (avoid adding Node only or browser only dependencies)
- Immutable data structures and deterministic type exports
- Named exports only

## Related specs

- [0001-stack-and-architecture](../../docs/specs/0001-stack-and-architecture/index.md)
- [0006-self-healing-verification-engine](../../docs/specs/0006-self-healing-verification-engine/index.md)
- [0008-managed-database-viewer-and-client-data-tools](../../docs/specs/0008-managed-database-viewer-and-client-data-tools/index.md)
- [0010-multi-modal-generation](../../docs/specs/0010-multi-modal-generation/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
