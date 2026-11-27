# apps/web/src/lib/multimodal

## Overview

Server side multimodal design extraction pipeline for Sparkweb: image upload normalization, SSRF guarded URL inspection, AI outline extraction, route error serialization, and stale pending attachment cleanup.

## Key files

| File                   | Owns                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `image-pipeline.ts`    | Magic byte validation, pixel bomb guard, EXIF orientation and metadata stripping, and 1568px resize via `sharp`  |
| `url-extractor.ts`     | IP pinned HTTP transport, CIDR SSRF guards, redirect revalidation, and `cheerio` HTML and CSS token extraction   |
| `outline-extractor.ts` | Multimodal prompt assembly with escaped untrusted XML delimiters, AI SDK extraction, and mock mode fixture       |
| `cleanup.ts`           | Bounded orphan sweep removing unattached pending uploads older than 24 hours from `ArtifactStore` and PostgreSQL |
| `serializers.ts`       | DTO serialization and domain error to HTTP status mapping for multimodal routes                                  |

## Commands

```bash
# Run multimodal unit tests
pnpm exec vitest run apps/web/src/lib/multimodal
```

## Conventions

- `sharp` must remain listed in `serverExternalPackages` in `apps/web/next.config.ts` so native binaries load outside the Next.js bundle.
- Keep `transport` and `dnsLookup` injectable in `extractDesignFromUrl` so unit tests stay deterministic without live network calls.
- Run URL SSRF validation, external fetches, and AI outline extraction before mutating `prompt_messages` or linking `design_attachments`, so failures leave pending uploads intact.
- Wrap all scraped website fields in escaped `<untrusted-website-reference>` delimiters and validate AI output strictly with `DesignOutlinePayloadSchema`.
- Delete `ArtifactStore` objects before deleting corresponding `design_attachments` rows during cleanup and project teardown.

## Agent skills

- [cheerio-parsing](../../../../.agents/skills/cheerio-parsing/): `Mindrally/skills`, HTML and XML parsing and DOM extraction with Cheerio
- [sharp](../../../../.agents/skills/sharp/): `clasen/skills`, Node.js image resizing, format conversion, and metadata handling with Sharp
- [image-ops](../../../../.agents/skills/image-ops/): `langchain-ai/design-agent`, deterministic image resize, rotation, and format operations with Sharp

## Related specs

- [0010-multi-modal-generation](../../../../docs/specs/0010-multi-modal-generation/index.md)

_Drafted by /sync from the introducing change, worth a quick human pass._
