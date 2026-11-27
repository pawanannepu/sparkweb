# 0010. Multi modal generation rationale

## Context

sparkweb currently accepts text prompts inside `PromptComposer` and runs a two stage generation pipeline in `POST /api/projects/[id]/generate` that writes React and Tailwind code into an in browser WebContainer preview. Creators frequently start from visual references such as screenshots, rough paper sketches, exported design frames, or live websites they want to adapt. Translating a visual design into text by hand is slow and loses spatial hierarchy, color palette accuracy, and typography cues.

Three constraints in the existing codebase shape how this capability must fit. First, sparkweb supports bring your own API keys across OpenRouter, Anthropic, OpenAI, and Google Gemini, including many free text only coding models on OpenRouter that reject image inputs. Second, `ArtifactStore` already exists in `apps/web` for local disk and S3 compatible object storage, while PostgreSQL stores relational prompt threads and snapshots. Third, accepting external URLs and user uploaded images on a multi tenant Next.js server introduces SSRF, malicious image payload, and prompt injection risks that must be handled before invoking any language model.

Without a clear architectural design, multi modal inputs risk bloating PostgreSQL rows with base64 blobs, failing cryptically on text only models, wasting tokens generating the wrong layout when an image is misinterpreted, or exposing internal network endpoints through unguarded URL fetches.

## Options considered

### Option 1: Two step design outline with ArtifactStore image storage, cheerio URL parsing, and shared generation pipeline

Upload images eagerly to `ArtifactStore` after magic byte verification and `sharp` normalization, parse submitted URLs through an SSRF guarded `cheerio` extractor, synthesize a structured editable outline in `design_outlines`, and pass the confirmed outline into the existing `POST /api/projects/[id]/generate` pipeline.

**Pros**:
- Keeps PostgreSQL lean by storing image bytes in `ArtifactStore` rather than large base64 strings in `prompt_messages`.
- Gives creators an editable visual checkpoint (sections, hex palette, typography, notes) before running expensive multi file code generation.
- Reuses existing SSE streaming, snapshot creation, and self healing preview verification in `/generate`.
- Fast URL token extraction with zero headless browser memory overhead.

**Cons**:
- Adds `sharp` (native binary) and `cheerio` dependencies to `apps/web`.
- Cannot render JavaScript only single page applications when extracting from a URL without a screenshot fallback.
- Adds one user confirmation click between submitting a reference and streaming code.

### Option 2: Direct inline generation with JSONB base64 attachments on prompt_messages

Encode uploaded images as base64 data URLs inside `prompt_messages.toolCalls` JSONB and stream code immediately inside `POST /api/projects/[id]/generate` without an intermediate outline step.

**Pros**:
- Zero new database tables or object storage writes.
- Fewer clicks from prompt submission to preview update.

**Cons**:
- Bloats PostgreSQL `prompt_messages` rows and thread history payloads with multi megabyte base64 strings.
- Cannot steer or fix misread color tokens or missing sections before generating full project files.
- Forces creators to re upload or re transcribe large payloads on retries.

### Option 3: Server side headless Chromium rendering with automatic model fallback

Run Playwright Chromium on the Next.js server to render every submitted URL to a full page screenshot, and silently route visual extraction to another configured provider key whenever the user's selected model is text only.

**Pros**:
- Captures rendered layouts for client side JavaScript only web applications.
- Works seamlessly even when a creator picks a text only coding model.

**Cons**:
- Heavy server RAM and CPU cost per request plus Chromium deployment complexity in Next.js hosting.
- Silently billing a second API key without user consent violates transparent bring your own key expectations.

## Rationale

Option 1 fits every constraint in sparkweb with the smallest operational footprint. Reusing `ArtifactStore` (from Spec 0009) avoids database bloat and keeps uploaded thumbnails available across page reloads without introducing a new storage service. Requiring a two step editable outline matches the slice goal in [scope.md](../../scope/scope.md) and prevents wasted generation turns when an uploaded sketch or URL contains ambiguous sections. Blocking image submission on text only models with a one click model switch respects bring your own key billing transparency.

Several implementation calls were settled alongside this design:
- **Image normalization target**: Auto orient with `.rotate()`, resize uploaded images to a maximum 1568px longest edge, guard `limitInputPixels`, and strip EXIF metadata with `sharp` (matches common vision provider tiling caps while cutting upload bandwidth; runner up: browser canvas downscaling, which duplicates format validation logic across client and server).
- **Extraction call pattern**: Use AI SDK `generateText` with strict Zod validation over JSON output matching `/generate` rather than streaming partial JSON objects (keeps extraction logic uniform across OpenRouter and direct providers; runner up: AI SDK `streamObject`, which varies in reliability across smaller OpenRouter models).
- **Concurrency and orphan cleanup**: Use a 60 second `outlineLockExpiresAt` lease on `prompt_threads` cleared in `finally` rather than persistent `extracting` outline rows (prevents thread deadlocks on crashes; runner up: Postgres advisory locks tied to pooled connections). Run a lazy SQL sweep capped at 25 unattached `design_attachments` older than 24 hours on new uploads and purge project attachment keys before cascading `deleteProject` (avoids standing cron infrastructure; runner up: scheduled background worker job).
- **SSRF enforcement and CSS fetching**: Resolve DNS via `dns/promises` and pin the resolved IP on the connection dispatcher across up to 5 redirects, blocking private and special IPv4/IPv6 ranges with an 8 second total deadline and 2 MB combined cap across HTML and up to 3 linked `<link rel="stylesheet">` files (captures Tailwind/Vite CSS tokens while stopping DNS rebinding; runner up: inline style parsing only, which misses external stylesheet tokens).
