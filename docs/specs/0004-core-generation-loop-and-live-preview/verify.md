# Verify: Core generation loop and live preview · spec 0004 · updated 2026-11-22

_Steps derived from spec 0004 acceptance criteria and Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [x] Visit `http://localhost:3000` with dev server running → workbench loads with prompt composer, model selector defaulting to Claude 3.7 Sonnet, device toggle buttons, and preview iframe container → AC-1, AC-5
- [x] Select Claude 3.7 Sonnet in prompt composer and submit prompt "Build an interactive task tracker" → prompt composer disables, active planning checklist card appears, and stream status becomes active → AC-1, AC-2, AC-5
- [x] Observe live streaming in GenerationProgressCard → planning steps transition from pending to in progress to completed, active file badges display status indicators, and expandable diff viewer renders file modifications → AC-2, AC-5
- [x] Inspect preview iframe upon completion → Vite preview boots in under one minute, displays starter template and new task tracker components, and client side PGlite executes without browser console errors → AC-3, AC-4, AC-7
- [ ] Submit follow up prompt "Add priority flags and sort buttons" → virtual files update incrementally via hot module replacement, retaining preview state without full container reboot → AC-4
- [x] Submit prompt and immediately click Abort button → generation halts immediately, prompt composer re enables, partial files remain mounted in sandbox, and assistant message records cancellation → AC-6
- [x] Trigger an intentional compilation error in preview code → runner iframe intercepts error and workbench displays PreviewErrorBanner with filename, line number, and recovery guidance → AC-8
- [x] Open browser DevTools Network tab and inspect headers for `/projects/demo-project` and `/sandbox/runner` → headers include `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` → AC-7
- [x] Check PostgreSQL database records after turn completion → new record exists in `snapshots` table containing filtered file map and SHA256 tree hash excluding `node_modules` and `.vite`, and assistant message in `prompt_messages` links to the new `snapshotId` → AC-9

## Commands

- [x] `pnpm check-types` → all 5 workspaces pass with 0 errors → AC-1, AC-4, AC-9
- [x] `pnpm lint` → Biome check passes across all files with 0 errors and 0 warnings → AC-5, AC-8
- [x] `pnpm test` → all 18 test suites pass across packages and apps → AC-1, AC-3, AC-4, AC-9
- [x] `pnpm build` → Next.js Turbopack production build succeeds with static and dynamic routes compiled → AC-1, AC-7

## Behavioral checks (Value sourcing)

- [x] Planning milestones generation → submit prompt with empty database state → planner stage produces structured JSON plan array before code generation begins → AC-2
- [x] File operations streaming → verify tool call stream produces valid file path and content pairs with relative paths only → AC-2, AC-4
- [x] Provider key decryption → submit generation request with Anthropic provider → server retrieves encrypted key from `api_keys`, decrypts with `ENCRYPTION_KEY`, and authenticates request without exposing key to browser → AC-1
- [x] Missing provider key handling → submit prompt with unconfigured provider → endpoint returns HTTP 400 Bad Request with `PROVIDER_KEY_MISSING` and guidance message → AC-1
- [x] Starter template bundling → request generation for fresh project with null snapshot → `@spark/sandbox` supplies complete Vite React Tailwind starter files with zero npm install latency → AC-3
- [x] Incremental hot module updates → send `PREVIEW_WRITE_FILES` bridge message → WebContainer dev server updates component without restarting → AC-4
- [x] Diagnostic reporting → emitted Vite error creates `PREVIEW_ERROR` message with accurate line and column numbers → AC-8
- [x] Stream cancellation → trigger AbortController signal → fetch closes cleanly and server terminates generation → AC-6
- [x] Snapshot exclusion filter → commit snapshot with virtual files containing `.vite` and `node_modules` dummy paths → persisted snapshot JSONB strictly excludes them → AC-9

## Acceptance-criteria coverage

- AC-1 (Generation route auth, key decryption, SSE stream) covered by UI step 1, UI step 2, Commands check 1, Commands check 3, Commands check 4, Behavioral check 3, Behavioral check 4
- AC-2 (Two stage planning and code generator pipeline) covered by UI step 2, UI step 3, Behavioral check 1, Behavioral check 2
- AC-3 (Pre bundled starter template and in browser PGlite) covered by UI step 4, Commands check 3, Behavioral check 5
- AC-4 (Incremental file synchronization and Vite HMR) covered by UI step 4, UI step 5, Commands check 1, Commands check 3, Behavioral check 2, Behavioral check 6
- AC-5 (Workbench progress card, badges, and diff viewer) covered by UI step 1, UI step 2, UI step 3, Commands check 2
- AC-6 (Stream cancellation and partial preservation) covered by UI step 6, Behavioral check 8
- AC-7 (Cross origin isolation headers and iframe execution) covered by UI step 4, UI step 8, Commands check 4
- AC-8 (Error interception and error banner display) covered by UI step 7, Commands check 2, Behavioral check 7
- AC-9 (Server side snapshot persistence and tree hash) covered by UI step 9, Commands check 1, Commands check 3, Behavioral check 9
