# Verify: multi modal generation · spec 0010 · updated 2026-11-28
_Steps derived from spec 0010 acceptance criteria and value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [x] Attach up to 4 PNG/JPEG/WebP images via file picker, drag and drop, or clipboard paste in `PromptComposer`, and confirm each chip displays its preview thumbnail from `GET /api/projects/[id]/attachments/[attachmentId]` with post normalization dimensions and byte size (Value sourcing: Image attachment chip) → AC-2, AC-4
- [x] Attach an image while a model with `supportsVision: false` is selected, confirm submit is disabled and the inline banner shows one click vision model switch buttons (or "Add a vision provider key" when none are configured), switch to a vision model or enter a custom model ID with `visionOverride`, and confirm submission unlocks (Value sourcing: Composer model vision check) → AC-3
- [x] Submit a public website URL with a text model and blank prompt text box, confirm the fallback instruction `"Build an application matching the attached design reference and extracted outline."` is stored on `sourceMessageId`, and confirm the extracted `DesignOutlineCard` displays palette hexes, fonts, headings, and layout sections derived from `urlSnapshot` and `extractedOutline` (Value sourcing: Extracted URL card & tokens; Prompt when text box is blank) → AC-2, AC-3, AC-5, AC-6
- [x] Edit `appSummary`, tweak a hex swatch, update typography fonts, toggle a layout section `enabled` flag off, add `additionalNotes`, reload the page, confirm `GET /api/projects/[id]/threads/[threadId]/state` restores the `editedOutline`, and click Reset to verify `editedOutline` clears back to `extractedOutline` (Value sourcing: Editable outline card) → AC-4, AC-8
- [x] Click `Build App` on a `ready` outline before the 500ms `PATCH` debounce completes, confirm the outline locks to `confirmed`, only enabled sections and components are injected into Stage 2 generation without duplicating the user message, and clicking `Clone to New Draft` on the confirmed outline creates a new `ready` draft with no synthetic user message (Value sourcing: Code generation context) → AC-9
- [x] Submit a private IP URL (`http://127.0.0.1:3000`, `http://[::ffff:127.0.0.1]/`, `http://169.254.169.254/latest/meta-data/`), a `403` blocked URL, and an empty JS shell (`<div id="root"></div>`), and confirm `POST /api/projects/[id]/outlines` returns `422` or `502` before mutating thread history while keeping the typed prompt and pending image chips intact → AC-5, AC-7

## Commands
- [x] `psql "${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/sparkweb}" -c "\d design_attachments" -c "\d design_outlines" -c "\d prompt_threads"` → tables `design_attachments`, `design_outlines`, partial unique index `design_outlines_source_message_unique_idx`, and `prompt_threads.outline_lock_expires_at` exist with cascade constraints → AC-1
- [x] `pnpm check-types && pnpm lint && pnpm test && pnpm build` → all 5 packages typecheck, Biome lint passes clean, unit tests pass, and `next build` bundles `sharp` via `serverExternalPackages` → AC-4
- [x] Exercise `POST /api/projects/[id]/outlines` concurrently on the same `threadId` while the 60s lease is active → second request returns `409` Conflict and succeeds after lease release or expiry → AC-6
- [x] Delete a pending attachment via `DELETE /api/projects/[id]/attachments/[attachmentId]` (and verify `409` on an already attached image), delete a project with stored attachments, and run `POST /api/projects/[id]/attachments` when unattached attachments older than 24 hours exist → `ArtifactStore` objects are deleted before cascading DB rows and stale pending attachments are swept in bounded batches of up to 25 → AC-4, AC-10

## Acceptance-criteria coverage
- AC-1 schema, nullable `source_message_id` / `cloned_from_outline_id`, `outline_lock_expires_at`, cascade delete: covered by DB introspection command and clone check
- AC-2 `supportsVision` metadata and composer up to 4 images + 1 URL + blank prompt support: covered by composer UI and URL submission checks
- AC-3 vision gating banner, one click switcher, `visionOverride`, and URL on text model: covered by vision gating UI check
- AC-4 `sharp` magic bytes, `.rotate()`, EXIF strip, 1568px resize, `ArtifactStore`, `GET`/`DELETE`, and thread state hydration: covered by upload/reload/cleanup checks and build command
- AC-5 SSRF CIDR blocking, IP pinning, redirects, 8s/2MB limits, `cheerio` sanitization, and untrusted delimiters: covered by SSRF rejection and URL extraction checks
- AC-6 60s extraction lease, pre mutation extraction, Zod validation, `superseded` transition, and `ready` save: covered by concurrency and URL submission checks
- AC-7 `403`/`429`/`504`/`422`/JS shell structured error recovery keeping prompt and pending images intact: covered by URL error recovery check
- AC-8 `DesignOutlineCard` inline edits, debounced `PATCH`, `409` on non `ready`, and Reset: covered by outline edit/reload/reset check
- AC-9 Build button debounce cancel, atomic `ready` to `confirmed`, Stage 2 context injection without duplicate user prompt, and `/clone`: covered by Build and Clone UI check
- AC-10 project deletion `ArtifactStore` cleanup and bounded 24 hour orphan sweep: covered by deletion and cleanup command check
