# Verify: Self healing verification engine (spec 0006, updated 2026-11-24)

Steps derived from spec 0006 acceptance criteria. /check verify runs these; /test locks the durable ones.

## UI / manual

- [ ] Enter a prompt that produces an unresolved import in App.tsx -> verify preview runner intercepts the error log, extracts category import, and computes a sanitized error fingerprint without line numbers -> AC-1
- [ ] Enter a prompt that produces a syntax error with line shifts -> confirm identical sanitized fingerprint is generated, preventing circular edit loops -> AC-1, AC-6
- [ ] Submit prompt via composer -> observe Server Sent Events emit messageId in plan and finish events while PostgreSQL snapshot commit is deferred until preview health passes -> AC-2
- [ ] Inspect network activity during automated repair -> confirm POST /api/projects/[id]/repair streams targeted file operations without re-planning the full prompt -> AC-3
- [ ] Deliver a failing file with missing sibling export -> verify repair route provides both importer and sibling file, patching export cleanly -> AC-3
- [ ] Observe patch application in live preview -> verify WebContainer applies updates via PREVIEW_WRITE_FILES and runner responds to PREVIEW_HEALTH_CHECK within four seconds -> AC-4
- [ ] Inspect chat generation card during healing pass -> verify expandable status card renders diagnostic summary, retry count, and patch file badges in real time -> AC-5
- [ ] Trigger an intentional repeat error -> verify loop halts immediately upon duplicate fingerprint detection, setting healing status to exhausted -> AC-6
- [ ] Force three consecutive failed repairs -> confirm loop terminates safely at three attempts and persists an exhausted snapshot to prevent work loss on page reload -> AC-6, AC-7
- [ ] Verify clean healing completion -> confirm POST /api/projects/[id]/snapshots commits verified file tree and updates prompt message toolCalls with healing telemetry -> AC-7
- [ ] Trigger an error outside active generation turns -> confirm preview error banner displays remaining retry count and repair button initiates fresh healing pass -> AC-8

## Commands

- [x] `pnpm vitest run packages/sandbox/src/diagnostics.test.ts` -> all 6 sandbox diagnostics tests pass -> AC-1, AC-6
- [x] `pnpm vitest run apps/web/src/app/api/projects/[id]/repair/route.test.ts` -> 5 server repair endpoint tests pass -> AC-3
- [x] `pnpm vitest run apps/web/src/app/api/projects/[id]/snapshots/route.test.ts` -> 8 snapshot commitment with healing telemetry tests pass -> AC-7
- [x] `pnpm vitest run apps/web/src/hooks/useGenerationLoop.test.ts` -> 5 loop detection, sibling import resolution, and verification tests pass -> AC-2, AC-4, AC-6, AC-7
- [x] `pnpm vitest run apps/web/src/components/generation/generation.test.tsx` -> 9 healing progress card and manual repair banner tests pass -> AC-5, AC-8
- [x] `pnpm check-types && pnpm lint && pnpm test` -> whole monorepo compiles clean (4/4 tasks) and passes all 179 tests across 28 test suites -> AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8

## Acceptance criteria coverage

- AC-1: covered by error interception manual steps and sandbox diagnostics tests
- AC-2: covered by deferred snapshot verification manual steps and generate route tests
- AC-3: covered by repair streaming manual steps and repair route tests
- AC-4: covered by runner health check handshake manual steps and usePreviewBridge tests
- AC-5: covered by generation progress card manual steps and generation components tests
- AC-6: covered by loop limit duplicate fingerprint manual steps and useGenerationLoop tests
- AC-7: covered by snapshot commitment manual steps and snapshots route tests
- AC-8: covered by manual error banner repair manual steps and PreviewErrorBanner tests
