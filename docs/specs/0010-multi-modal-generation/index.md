# 0010. Multi modal generation from images and design links

**Date**: 2026-11-27
**Status**: In Progress

## Summary

This specification defines multi modal prompt generation from uploaded design images and public website URLs in sparkweb. Creators can attach up to 4 screenshots or sketches and 1 website link inside the prompt composer to extract layout structure, color tokens, typography, and component hierarchy into an editable outline card before code generation starts. Separating visual extraction into a lightweight editable outline avoids wasted generation runs on misread designs and reuses the existing streaming build and self healing preview pipeline.

## Requirements

**User stories**:
- As a creator, I want to upload screenshots, paper sketches, or design exports alongside my prompt so that sparkweb seeds an application matching my visual layout and palette.
- As a creator, I want to paste a public website URL so that sparkweb inspects its structure and theme tokens to propose a starting application outline.
- As a creator, I want to review and tweak the extracted layout sections, hex colors, typography, and notes before building so that I can steer the design before spending generation tokens.
- As a creator, I want clear guidance when my chosen model cannot read images or when a target website blocks automated fetching so that I know how to recover right away.

**Acceptance criteria**:
- **AC-1**: Database schema migration in `packages/db` adds `design_attachments`, adds `design_outlines` linked to `projects`, `prompt_threads`, and `prompt_messages` (with nullable `source_message_id` and `cloned_from_outline_id` so cloning never synthesizes user messages), adds `outline_lock_expires_at` on `prompt_threads`, and cascades deletion from parent projects and threads.
- **AC-2**: `AiModelOption` in `packages/shared` includes a `supportsVision` capability flag populated from OpenRouter modality metadata (`architecture.modality` containing `"image->"` or `input_modalities` containing `"image"`, defaulting `false` when unknown) and direct provider definitions, and `PromptComposer` lets creators attach up to 4 images (`PNG`, `JPEG`, `WebP`, max 5 MB each via file picker, drag and drop, or clipboard paste) and up to 1 public website URL, allowing submission even when the text prompt is empty (defaulting to a standard build instruction).
- **AC-3**: Selecting a model with `supportsVision === false` while one or more images are attached disables submission in `PromptComposer` and displays an inline banner offering one click switches to configured vision capable models (or an "Add a vision provider key" link if none are configured), plus an explicit `visionOverride` toggle when a user enters a custom model ID; URL only requests remain allowed on text models.
- **AC-4**: `POST /api/projects/[id]/attachments` authenticates project ownership, resolves or creates the default thread when `threadId` is omitted, validates image magic bytes, auto orients with `.rotate()` before stripping EXIF metadata, guards against pixel bombs (`limitInputPixels`), resizes images to at most 1568px on the longest side using `sharp` (configured in `serverExternalPackages`), stores normalized bytes via `getArtifactStore()` under `attachments/<projectId>/<attachmentId>`, and persists a pending `design_attachments` row (`messageId = null`) with post normalization dimensions and byte size (rolling back the stored blob on DB failure); `GET /api/projects/[id]/attachments/[attachmentId]` streams stored bytes to the project owner, `DELETE /api/projects/[id]/attachments/[attachmentId]` removes pending unattached uploads, and `GET /api/projects/[id]/threads/[threadId]/state` hydrates messages, attached media, pending uploads, and outlines on reload.
- **AC-5**: Server side URL inspection (`POST /api/projects/[id]/outlines`) enforces strict SSRF protection on `sourceUrl` and up to `3` linked `<link rel="stylesheet">` assets (allowing only `http` and `https` on ports `80` and `443` without credentials, resolving DNS and pinning the resolved IP on the connection dispatcher to block `127.0.0.0/8`, `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::`, `::1`, `::ffff:0:0/96`, `fe80::/10`, `fc00::/7`, and `ff00::/8`, re checking up to `5` redirects, allowing `text/html` or `application/xhtml+xml` for the page, and capping total time at `8` seconds and combined downloads at `2` MB), parses HTML and CSS with `cheerio` while stripping `<script>`, comments, and hidden elements, and wraps extracted tokens inside escaped untrusted data delimiters before model inference.
- **AC-6**: `POST /api/projects/[id]/outlines` acquires a timed lease (`outlineLockExpiresAt = now + 60s`, cleared in `finally`) on `prompt_threads` to prevent concurrent extractions (`409` Conflict) without deadlocking on crashes, performs URL inspection and AI extraction (or deterministic mock output when `MOCK_AI === "true"` or `NODE_ENV === "test"` with an injectable URL fetcher seam) before mutating thread history, validates the response against `DesignOutlinePayload` Zod schema, marks any prior `ready` outlines in that thread as `superseded`, creates the user and assistant `prompt_messages` rows, links pending attachments to the new user message, and saves the `design_outlines` record in status `ready`.
- **AC-7**: When a target URL blocks automated requests (`403` or `429`), times out (`504`), fails SSRF/MIME validation (`422`), or returns an empty JavaScript only shell (under `120` visible characters inside a root mount node), `POST /api/projects/[id]/outlines` returns an actionable structured error before creating `prompt_messages` or linking `design_attachments`, preserving the user typed prompt and pending images so the creator can paste a screenshot instead.
- **AC-8**: The chat thread renders `DesignOutlineCard` for each outline message, allowing creators to edit `appSummary`, tweak hex palette swatches, edit typography fonts, toggle `enabled` flags or edit notes on `layoutSections` and `componentHierarchy`, add `additionalNotes`, reset `editedOutline` back to `extractedOutline`, and persist full payload edits via debounced `PATCH /api/projects/[id]/outlines/[outlineId]` (`500ms`, rejecting non `ready` outlines with `409`).
- **AC-9**: Clicking Build on a `ready` outline cancels any pending `PATCH` debounce timer, calls `POST /api/projects/[id]/generate` with `outlineId`, latest `editedOutline`, and the currently selected composer model (allowing vision extraction followed by a text coding model build), atomically persists edits and locks the outline to `confirmed` before streaming (read only in history, cloneable to a new `ready` draft via `POST /api/projects/[id]/outlines/[outlineId]/clone` which supersedes any prior `ready` draft), injects only confirmed text tokens and `enabled` sections into Stage 2 generation without duplicating the user prompt message, sets `buildMessageId`, and executes the existing SSE generation and self healing preview pipeline.
- **AC-10**: Deleting a project collects `design_attachments.storageKey` values and deletes stored objects from `ArtifactStore` before cascading PostgreSQL rows, and a lazy cleanup sweep triggered on `POST /attachments` removes up to `25` unattached pending `design_attachments` older than 24 hours globally (deleting each DB row after removing its stored blob).

## Decision

**Chosen option**: Option 1: Two step design outline with ArtifactStore image storage, cheerio URL parsing, and shared generation pipeline

We upload reference images eagerly into `ArtifactStore` (normalized with `sharp`), extract design structure from images and SSRF guarded `cheerio` URL parses into a persistent editable `design_outlines` record, and then feed the confirmed outline into `POST /api/projects/[id]/generate` to build the application.

**Implementation skills**: `cheerio-parsing` (`mindrally/skills`, `.agents/skills/cheerio-parsing/`)

## Feature design

**Data model sketch**:
- `prompt_threads` (`packages/db/src/schema/prompt-threads.ts` extension):
  - `outlineLockExpiresAt`: `timestamp` nullable (60 second lease preventing concurrent extractions on the same thread)
- `design_attachments` (`packages/db/src/schema/design-inputs.ts`):
  - `id`: `uuid` PK
  - `projectId`: `uuid` FK to `projects.id` (`onDelete: "cascade"`), not null
  - `threadId`: `uuid` FK to `prompt_threads.id` (`onDelete: "cascade"`), not null
  - `messageId`: `uuid` nullable FK to `prompt_messages.id` (`onDelete: "cascade"`)
  - `kind`: `text` (`"image" | "url"`), not null
  - `storageKey`: `text` nullable (object key in `ArtifactStore` for images)
  - `sourceUrl`: `text` nullable (normalized `http` or `https` URL for links)
  - `fileName`: `text` nullable
  - `mimeType`: `text` nullable (post normalization MIME type)
  - `sizeBytes`: `integer` nullable (post normalization byte size)
  - `width`: `integer` nullable (post normalization width)
  - `height`: `integer` nullable (post normalization height)
  - `urlSnapshot`: `jsonb` nullable (`{ title: string, description?: string, headings: string[], colors: string[], fonts: string[], landmarkCount: number }`, capped at 20 headings, 16 colors, 8 fonts)
  - `createdAt`: `timestamp` default now, not null
  - Indexes: `(threadId, createdAt)` and `(messageId)`
- `design_outlines` (`packages/db/src/schema/design-inputs.ts`):
  - `id`: `uuid` PK
  - `projectId`: `uuid` FK to `projects.id` (`onDelete: "cascade"`), not null
  - `threadId`: `uuid` FK to `prompt_threads.id` (`onDelete: "cascade"`), not null
  - `sourceMessageId`: `uuid` nullable FK to `prompt_messages.id` (`onDelete: "cascade"`)
  - `clonedFromOutlineId`: `uuid` nullable self reference to `design_outlines.id` (`onDelete: "set null"`)
  - `outlineMessageId`: `uuid` nullable FK to `prompt_messages.id` (`onDelete: "set null"`)
  - `buildMessageId`: `uuid` nullable FK to `prompt_messages.id` (`onDelete: "set null"`)
  - `status`: `text` (`"ready" | "confirmed" | "superseded"`), not null
  - `modelId`: `text` not null
  - `extractedOutline`: `jsonb` not null (`DesignOutlinePayload`: `{ appSummary: string, palette: Array<{ id: string, role: string, hex: string, usage: string }>, typography: { headingFont: string, bodyFont: string, monoFont?: string, scaleNotes: string }, layoutSections: Array<{ id: string, name: string, description: string, enabled: boolean }>, componentHierarchy: Array<{ id: string, name: string, role: string, parentId?: string, enabled: boolean }>, additionalNotes: string }`)
  - `editedOutline`: `jsonb` nullable (full `DesignOutlinePayload` copy when customized)
  - `createdAt`: `timestamp` default now, not null
  - `updatedAt`: `timestamp` default now, not null
  - Indexes: `(threadId, createdAt)` and partial unique index on `(sourceMessageId)` where `sourceMessageId IS NOT NULL AND clonedFromOutlineId IS NULL`

**State transitions**:
- `design_attachments`: `pending` (`messageId === null`) → `attached` (`messageId` assigned when `POST /outlines` succeeds) → `deleted` (on explicit delete, 24 hour orphan sweep, or project deletion).
- `design_outlines`: created in `ready` (only after extraction succeeds) → `confirmed` (atomically locked before SSE stream starts in `POST /generate`) | `superseded` (when another outline becomes `ready` in the same thread); `confirmed` → cloned into a new `ready` draft via `/clone` (which marks prior `ready` outlines in that thread as `superseded`).

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/projects/[id]/threads/[threadId]/state` | `GET` | path params (`id`, `threadId`) | `{ messages, attachmentsByMessageId, pendingAttachments, outlines }` | owner session | `401`/`404` |
| `/api/projects/[id]/attachments` | `POST` | `multipart/form-data` (`file`, `threadId?`) | `{ id, threadId, kind, fileName, mimeType, sizeBytes, width, height, previewUrl, createdAt }` | owner session | `400` bad file or magic bytes, `413` > 5 MB, `401`/`404` |
| `/api/projects/[id]/attachments/[attachmentId]` | `GET` | path params (`id`, `attachmentId`) | raw image stream with `Content-Type`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, max-age=3600` | owner session | `401`/`404` |
| `/api/projects/[id]/attachments/[attachmentId]` | `DELETE` | path params (`id`, `attachmentId`) | `{ deleted: true }` | owner session | `409` already attached to message, `401`/`404` |
| `/api/projects/[id]/outlines` | `POST` | `{ prompt?, threadId?, model?, provider?, visionOverride?, attachmentIds?, sourceUrl? }` | `{ outline, userMessage, outlineMessage, attachments }` | owner session | `400` non vision model or invalid payload, `409` active extraction lease, `422` SSRF, bad MIME, or JS shell, `502`/`504` blocked or timed out URL |
| `/api/projects/[id]/outlines/[outlineId]` | `PATCH` | `{ editedOutline?: DesignOutlinePayload, reset?: boolean }` | `{ outline }` | owner session | `409` outline not `ready`, `400` invalid schema |
| `/api/projects/[id]/outlines/[outlineId]/clone` | `POST` | path params (`id`, `outlineId`) | `{ outline, outlineMessage }` (`status: "ready"`) | owner session | `404` outline not found |
| `/api/projects/[id]/generate` | `POST` | existing fields plus optional `{ outlineId?, editedOutline? }` | existing SSE stream (`plan`, `file_op`, `done`, `error`) | owner session | `409` outline locked, superseded, or concurrent generation |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Composer model vision check | `supportsVision` boolean and configured switcher options | `AiModelOption.supportsVision` in `packages/shared/src/ai-models.ts` filtered by `configuredProviders` from `/api/ai/models`, plus `visionOverride` checkbox for custom typed IDs |
| Image attachment chip | Thumbnail URL, dimensions, byte size, `threadId` | `GET /api/projects/[id]/attachments/[attachmentId]`, post normalization `width`, `height`, `sizeBytes`, and resolved `threadId` returned by `POST /attachments` |
| Extracted URL card & tokens | Title, semantic headings, palette hexes, fonts | Server side `cheerio` fetch across HTML and up to 3 `<link rel="stylesheet">` files saved to `design_attachments.urlSnapshot` and synthesized into `design_outlines.extractedOutline` |
| Editable outline card | Displayed tokens, toggles, typography, notes, Reset | Merged view of `design_outlines.editedOutline ?? design_outlines.extractedOutline` (`reset: true` clears `editedOutline` to `null`) and `design_outlines.status` |
| Prompt when text box is blank | Fallback build instruction text | Constant `"Build an application matching the attached design reference and extracted outline."` applied in `PromptComposer` and `POST /outlines` (stored on `sourceMessageId`) |
| Code generation context | Final design spec injected into Stage 2 prompt | Confirmed `design_outlines.editedOutline ?? design_outlines.extractedOutline` filtering only `enabled === true` sections/components, using currently selected composer model |

**Key invariants**:
- Every image stored in `ArtifactStore` is validated by magic bytes, auto oriented with `.rotate()`, checked against `limitInputPixels`, resized to max 1568px longest edge, and stripped of EXIF via `sharp` (`PNG`, `JPEG`, `WebP`, max 5 MB input); if DB insert fails, the stored object is deleted.
- At most 4 image attachments (owned by `(projectId, threadId)` with `messageId IS NULL`) and 1 URL attachment per outline extraction turn; requests with 0 text, 0 images, and 0 URLs return `400`.
- `POST /outlines` executes SSRF checks, URL fetching, and AI extraction before inserting `prompt_messages` or linking `design_attachments`, so extraction errors never consume pending attachments.
- A `design_outlines` row in status `confirmed` or `superseded` is immutable; `PATCH` returns `409` and `POST /generate` locks `ready` to `confirmed` atomically before streaming.
- At most one active extraction lease (`outlineLockExpiresAt > now`) may run per `threadId`, and `useGenerationLoop` blocks concurrent extraction and generation runs on the client.
- Uploaded images are design references only and are never copied into generated `snapshots.files`.

**Security model**:
- All endpoints verify `getCurrentUser(req)` and match `projects.userId` (plus verifying `threadId` belongs to `projectId` and every `attachmentId` belongs to `(projectId, threadId)`).
- `GET` attachment responses set `X-Content-Type-Options: nosniff` and `Cache-Control: private, max-age=3600`.
- External URL fetching resolves hostnames via `dns/promises` and pins the resolved IP on the HTTP dispatcher to stop DNS rebinding, allows only `http` and `https` on ports `80` and `443` with no URL credentials, blocks `127.0.0.0/8`, `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::`, `::1`, `::ffff:0:0/96`, `fe80::/10`, `fc00::/7`, and `ff00::/8`, re validates up to `5` redirects, restricts page MIME to `text/html` and `application/xhtml+xml`, and caps total time at `8` seconds and combined HTML plus stylesheet streaming bytes at `2` MB.
- Fetched HTML is sanitized with `cheerio` (removing `<script>`, `<noscript>`, HTML comments, and `display:none` elements), wrapped in escaped untrusted data delimiters inside the extraction prompt, and parsed strictly through `DesignOutlinePayload` Zod schemas.

**Configuration required**:
- None beyond existing AI provider API keys and `ArtifactStore` configuration (`ARTIFACT_STORAGE_DRIVER`, `LOCAL_ARTIFACTS_DIR`, or `S3_*`) defined in Spec 0009, plus adding `sharp` to `serverExternalPackages` in `apps/web/next.config.ts`.

**Critical test scenarios**:
- Happy path: creator drops 2 PNG mockups and pastes a public URL with empty text, views the extracted outline card, toggles a section and edits a primary hex swatch, reloads the page to confirm hydration, clicks Build, and receives a booted Vite preview matching the generation stream, verifies **AC-2**, **AC-4**, **AC-5**, **AC-6**, **AC-8**, **AC-9**.
- Vision gating: creator selects a text only OpenRouter model (`supportsVision: false`) with an attached image, sees the disabled submit state and inline vision model switcher, switches models, and submits cleanly; submitting only a URL with a text model succeeds, verifies **AC-2**, **AC-3**.
- URL security and failure recovery: submitting `http://127.0.0.1:3000`, `http://[::ffff:127.0.0.1]/`, or `http://169.254.169.254/latest/meta-data/` is rejected (`422`), and submitting a URL returning `403` or an empty `<div id="root"></div>` returns an actionable recovery error while leaving pending composer images intact for retry, verifies **AC-5**, **AC-7**.
- Concurrency, clone, and lifecycle cleanup: concurrent `POST /outlines` returns `409` while the lease is active and recovers after expiry; cloning a `confirmed` outline creates a new `ready` draft without duplicate user messages; deleting a project purges `attachments/<projectId>/` blobs before cascading DB rows, verifies **AC-1**, **AC-4**, **AC-6**, **AC-9**, **AC-10**.

## Build plan

1. Add `supportsVision` capability metadata across `AiModelOption`, direct models, and OpenRouter model mapping in `packages/shared`, plus shared Zod types for attachments, URL snapshots, and `DesignOutlinePayload`, satisfies **AC-2**, **AC-3**.
2. Define `design_attachments`, `design_outlines`, and `prompt_threads.outlineLockExpiresAt` Drizzle schemas, relations, queries, and single PostgreSQL migration in `packages/db`, plus attachment storage cleanup hooks on project deletion and bounded 24 hour orphan sweep, satisfies **AC-1**, **AC-10**.
3. Build server attachment pipeline (`POST`, `GET`, `DELETE /api/projects/[id]/attachments`) and thread hydration route (`GET /api/projects/[id]/threads/[threadId]/state`) with magic byte validation, `sharp` auto rotation, EXIF stripping, and `getArtifactStore()` persistence (`serverExternalPackages: ["sharp"]`), satisfies **AC-4**, **AC-10**.
4. Build SSRF guarded IP pinned URL fetcher and `cheerio` HTML plus external stylesheet token extractor (`apps/web/src/lib/multimodal/url-extractor.ts` with injectable test transport), outline extraction route (`POST /api/projects/[id]/outlines`), edit route (`PATCH /api/projects/[id]/outlines/[outlineId]`), clone route (`POST /api/projects/[id]/outlines/[outlineId]/clone`), and extend `POST /api/projects/[id]/generate` with atomic `outlineId` confirmation and prompt injection, satisfies **AC-5**, **AC-6**, **AC-7**, **AC-9**.
5. Build `PromptComposer` multi modal upload, drag and drop, paste, URL input, and vision warning UI, `DesignOutlineCard` editable outline component in chat history, and wire hydration plus the two step outline then build flow into `useGenerationLoop` and `BuilderWorkbench` (including deterministic mock extraction for tests), satisfies **AC-2**, **AC-3**, **AC-4**, **AC-7**, **AC-8**, **AC-9**.

## Consequences

**Positive**:
- Creators can start projects from screenshots, hand sketches, or live inspiration sites with an editable preview outline before burning code generation tokens.
- Reusing `ArtifactStore` and `POST /api/projects/[id]/generate` avoids duplicating SSE streaming, snapshot commits, and self healing preview verification.
- Timed extraction leases, IP pinned SSRF checks, `sharp` re encoding, and `cheerio` sanitization close common upload, deadlock, and URL fetching failure modes upfront.

**Negative / tradeoffs**:
- Adding `sharp` introduces a native binary dependency in `apps/web` (`serverExternalPackages`) that must match the Linux container architecture in production builds.
- Static HTML and CSS parsing via `cheerio` cannot extract designs from client side JavaScript only single page applications; users on those sites must paste a screenshot instead.
- Two step outline confirmation adds one extra click before code streaming starts.

**Neutral**:
- Confirmed outlines stay locked in thread history as an immutable record of what produced a build, while cloning creates a fresh editable draft without duplicating user messages.

## Follow-up

- [ ] `cheerio-parsing` conventions are installed in `.agents/skills/cheerio-parsing/` and not yet referenced in `apps/web/AGENTS.md`; capture a pointer in the nested `apps/web/src/lib/multimodal/AGENTS.md` (and link from `apps/web/AGENTS.md`) once the directory is created rather than adding area specific rules to root `AGENTS.md`.
- [ ] Evaluate adding optional Playwright screenshot rendering for JavaScript only SPAs behind a feature flag if user feedback shows frequent empty shell errors on target URLs.
- [ ] Evaluate adding authenticated Figma REST API / MCP token support in a later slice if creators ask for direct Figma frame import beyond exported PNGs.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
