# 0006. Self healing verification engine

**Date**: 2026-11-23
**Status**: Accepted

## Summary

This specification establishes an automated self healing verification engine for sparkweb. When code generation produces compilation errors, missing imports, syntax issues, or runtime exceptions inside the preview runner, the system intercepts the error logs and extracts structured diagnostics. A dedicated server repair route sends targeted file patches containing both the failing file and any referenced sibling modules to the WebContainer sandbox. Verification triggers directly off Vite hot module replacement completion events with a four second fallback, checking runner error state and DOM overlay status. Snapshot commitment is deferred until verification confirms preview health, committing clean states to PostgreSQL while preserving exhausted attempts with an error flag so creator code is never lost on refresh. A strict budget of three repair attempts per turn and error fingerprint hashing stripped of line number noise prevents infinite circular edits.

## Requirements

**User stories**:
- As a creator, I want compilation errors, missing imports, and runtime crashes automatically repaired during generation, so that my preview application stays working without manual debugging.
- As a creator, I want clear visual progress showing the error diagnosis, the patch being applied, and verification confirmation, so that I understand why generation took extra time.
- As a creator, I want a manual repair button on the preview error banner, so that I can trigger a targeted fix pass whenever an unexpected runtime issue surfaces during testing.
- As a developer, I want repair attempts bounded by strict loop detection, so that broken code never triggers runaway token consumption or infinite edit cycles.
- As an operator, I want project snapshots committed to PostgreSQL only after the application passes health verification, while ensuring unhealed code is saved with an alert state rather than discarded.

**Acceptance criteria**:
- **AC-1**: Preview runner intercepts Vite compilation errors, TypeScript syntax issues, unresolved module imports, and window runtime exceptions, parsing raw error logs into typed `PreviewErrorPayload` diagnostics with `category` and a deterministic SHA256 `errorFingerprint` computed from normalized file path and error text with line numbers stripped.
- **AC-2**: Server generation route `POST /api/projects/[id]/generate` emits `messageId` in Server Sent Events streams, and defers PostgreSQL snapshot persistence until the client workbench completes preview health verification.
- **AC-3**: Dedicated server route `POST /api/projects/[id]/repair` verifies project ownership, decrypts provider credentials, accepts `messageId`, `error`, the failing file, and any referenced sibling import files, streaming targeted patches via Server Sent Events without re-planning the full prompt.
- **AC-4**: Host workbench applies received repair patches to the running WebContainer via `PREVIEW_WRITE_FILES` and dispatches `PREVIEW_HEALTH_CHECK` to the runner, which verifies health by monitoring Vite `PREVIEW_HMR_COMPLETE` events, runner exception states, and the absence of `<vite-error-overlay>` elements within a four second timeout window before returning `PREVIEW_HEALTH_STATUS`.
- **AC-5**: Generation progress card in the chat panel displays an expandable healing status card showing the diagnostic summary, patch file badges, retry counter, and verification outcome in real time.
- **AC-6**: Repair loop stops immediately if a newly generated error matches an error fingerprint seen earlier in the same turn, or when three repair attempts fail to resolve the issue, setting healing status to exhausted.
- **AC-7**: Upon verification success, the client calls `POST /api/projects/[id]/snapshots` passing the verified file tree, `messageId`, and `healingTelemetry` to commit the clean snapshot and update `prompt_messages.toolCalls`. If healing exhausts all three attempts, a snapshot marked with `status: "exhausted"` is still committed so local file progress is preserved on page reload.
- **AC-8**: Preview error banner displays an interactive repair action with remaining retry counter, allowing creators to trigger on demand healing passes for errors occurring outside active generation turns by creating a new assistant message and allocating a fresh three attempt budget.

## Decision

**Chosen option**: Option 1: Client side error interception with regex diagnostic parser, dedicated server repair streaming route, and event driven health handshake

We implement a closed loop self healing verification engine that bridges preview sandbox diagnostics with a server repair pipeline. The WebContainer runner intercepts Vite compiler diagnostics, syntax errors, and uncaught window exceptions, extracting file locations and computing an error fingerprint hash stripped of line number shifts. The host workbench orchestrates the repair loop, calling `POST /api/projects/[id]/repair` with focused context including the failing file and referenced sibling imports. The server uses Vercel AI SDK Core to stream targeted file patches without re-planning the full prompt. Patches write directly to the WebContainer virtual file system, triggering Vite hot module replacement. A `PREVIEW_HEALTH_CHECK` handshake monitors the preview frame for `PREVIEW_HMR_COMPLETE` and confirms the absence of error overlays. Loop detection caps repairs at three attempts and aborts on duplicate fingerprints. Database snapshots commit via `POST /api/projects/[id]/snapshots` only after verification succeeds, and healing telemetry is recorded directly in `prompt_messages.toolCalls`.

**Implementation skills**: `next-dev-loop` (`vercel/next.js`, `.agents/skills/next-dev-loop/`) · `turborepo` (`vercel/turborepo`, `.agents/skills/turborepo/`) · `drizzle-orm-patterns` (`giuseppe-trisciuoglio/developer-kit`, `.agents/skills/drizzle-orm-patterns/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:
The feature reuses the core persistence schema established in Spec 0002 and populated in Spec 0004 without requiring new database migrations.

Database storage in `prompt_messages.toolCalls` jsonb:
```json
{
  "plan": [
    { "id": "step-1", "title": "Scaffold component", "status": "completed" }
  ],
  "fileOperations": [
    { "path": "src/App.tsx", "op": "write", "status": "completed" }
  ],
  "model": "claude-3-7-sonnet",
  "provider": "anthropic",
  "totalTokens": 2450,
  "healing": {
    "status": "healed",
    "totalRepairs": 1,
    "attempts": [
      {
        "attemptIndex": 1,
        "errorFingerprint": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "category": "import",
        "message": "Failed to resolve import lucide-react/icons/missing from src/App.tsx",
        "filePath": "src/App.tsx",
        "line": 4,
        "column": 8,
        "patchFiles": ["src/App.tsx"],
        "status": "resolved",
        "timestamp": 1732387200000
      }
    ]
  }
}
```

Database storage in `snapshots`:
- Committed by client call to `POST /api/projects/[id]/snapshots` after verification completes
- `message`: contains turn summary with repair notation (example: "Generated dashboard with 1 self healing repair")
- `treeHash`: SHA256 of clean verified files map
- If healing exhausted, message carries warning tag and files reflect latest attempt state so refresh does not discard work

Shared TypeScript interfaces in `packages/shared`:
```typescript
export type HealingCategory = "compiler" | "runtime" | "import" | "syntax";
export type HealingAttemptStatus = "analyzing" | "patching" | "verifying" | "resolved" | "unfixable";
export type HealingOverallStatus = "none" | "in_progress" | "healed" | "exhausted";

export interface PreviewErrorPayload {
  message: string;
  filename?: string;
  line?: number;
  column?: number;
  stack?: string;
  category?: HealingCategory;
  errorFingerprint?: string;
}

export interface HealingAttempt {
  attemptIndex: number;
  errorFingerprint: string;
  category: HealingCategory;
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
  patchFiles: string[];
  status: HealingAttemptStatus;
  timestamp: number;
}

export interface HealingTelemetry {
  status: HealingOverallStatus;
  totalRepairs: number;
  attempts: HealingAttempt[];
}

export interface PreviewHealthCheckPayload {
  timeoutMs: number;
}

export interface PreviewHealthStatusPayload {
  healthy: boolean;
  error?: PreviewErrorPayload;
}
```

Added Bridge Message Types:
`PREVIEW_HEALTH_CHECK` and `PREVIEW_HEALTH_STATUS` are registered in `BridgeMessageType`.

Error Fingerprint Normalization Formula:
```typescript
// Sanitizes error text by removing volatile line, column numbers, and memory pointers
const sanitizedMessage = error.message
  .replace(/:\d+:\d+/g, "")
  .replace(/\b\d+:\d+\b/g, "")
  .replace(/0x[a-fA-F0-9]+/g, "")
  .trim()
  .toLowerCase();

const normalizedPath = (error.filename || "").trim().toLowerCase();
const errorFingerprint = sha256(`${category}:${normalizedPath}:${sanitizedMessage}`);
```

**State transitions**:
Verification and healing lifecycle states:
- `idle`: normal state, runner healthy
- `generating`: code generation streaming in progress
- `verifying`: files written, waiting for HMR complete and health check response
- `analyzing`: error detected, parsing diagnostics and computing sanitized fingerprint
- `patching`: server streaming repair patches for failing file and sibling imports
- `healed`: health check passed, updating telemetry and committing snapshot
- `exhausted`: three attempts reached or duplicate fingerprint detected, halted with user warning and saved state

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/projects/[id]/repair | POST | messageId: string, error: PreviewErrorPayload, failingFile: ProjectFile, importedSiblingFiles: ProjectFile[], model?: string | Server Sent Events stream (healing_status, file_op, finish, error) | Session cookie (project member) | 401 unauthorized, 403 forbidden, 404 not found, 429 rate limit |
| /api/projects/[id]/snapshots | POST | files: Record<string, string>, messageId?: string, healingTelemetry?: HealingTelemetry, message?: string | id, treeHash, createdAt | Session cookie (project member) | 401 unauthorized, 403 forbidden, 400 invalid |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Stream /generate | messageId | Server generated assistant prompt message identifier emitted in SSE plan and finish events |
| Intercept error | errorFingerprint | SHA256 hash of normalized error message and file location computed without line numbers in packages/sandbox |
| Intercept error | category | Regex classifier matching Vite compiler, Rollup import, or window error patterns |
| Call /repair | failingFile | Matched ProjectFile from in memory file store matching error filename |
| Call /repair | importedSiblingFiles | Resolved relative import ProjectFiles from in memory file store referenced in failing file |
| Call /repair | providerApiKey | Decrypted on server from api_keys table using project owner session |
| Stream repair | patch file operations | Generated by AI SDK Core tool calls using targeted repair prompt |
| Verify health | healthy boolean | Runner inspection of PREVIEW_HMR_COMPLETE, runner error queue, and DOM overlay elements |
| Commit snapshot | snapshotId, treeHash | Returned from POST /api/projects/[id]/snapshots called by client after verification completes |

**Key invariants**:
- Maximum of three repair attempts per prompt turn.
- An error fingerprint matching any prior attempt in the same turn aborts the loop immediately.
- Line numbers and column positions are excluded from error fingerprint calculation to prevent edits from bypassing loop detection.
- Snapshots are committed to PostgreSQL only when the application is verified healthy, or with an exhausted notation if the budget runs out.
- Repair endpoint is rate limited to ten calls per minute per project.
- Active generation cancellation via AbortController terminates any running repair pass immediately.

**Security model**:
- All repair requests authenticate via existing IronSession cookies.
- Users can only trigger repairs on projects they own or collaborate on.
- Provider API keys are decrypted on the server within the route handler, never exposed to the client.
- WebContainer runs in an isolated iframe with credentialless cross origin headers.

**Configuration required**:
- None: reuses existing encrypted provider credentials (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`) from Spec 0002.

**Critical test scenarios**:
- Happy path: Compilation error in generated code triggers diagnostic parsing, server streams patch, preview recovers within settling window, and snapshot commits, verifies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-7**.
- Loop prevention with line shifts: Repeating syntax error with shifted line numbers produces identical sanitized fingerprint, aborting after attempt one with exhausted status and actionable warning, verifies **AC-1**, **AC-6**.
- Import cascade repair: Unresolved import provides both importer and sibling export file to repair prompt, fixing export statement successfully, verifies **AC-3**, **AC-4**.
- Max retry exhaustion: Three distinct errors fail consecutively, loop terminates cleanly without losing generated files, commits snapshot with exhausted flag, and error banner shows manual retry, verifies **AC-5**, **AC-6**, **AC-7**, **AC-8**.
- Runner crash timeout: Unresponsive preview runner times out after four seconds during health check, triggers clean sandbox reboot, and marks as unverified, verifies **AC-4**.
- Auth permission check: Unauthenticated user or non owner receives 401 or 403 error on repair endpoint, verifies **AC-3**.

## Build plan

- [x] 1. Define `PREVIEW_HEALTH_CHECK` and `PREVIEW_HEALTH_STATUS` bridge messages, error categories, and `PreviewErrorPayload` extensions in `packages/shared`, satisfies **AC-1**, **AC-4**.
- [x] 2. Implement regex error diagnostic parser and sanitized fingerprint generator in `packages/sandbox`, satisfies **AC-1**, **AC-6**.
- [x] 3. Add `PREVIEW_HMR_COMPLETE` listener, error overlay inspector, and health check handler to preview runner in `packages/sandbox`, satisfies **AC-1**, **AC-4**.
- [x] 4. Update `POST /api/projects/[id]/generate` to emit `messageId` and defer inline snapshot commits, satisfies **AC-2**.
- [x] 5. Create server side repair route `POST /api/projects/[id]/repair` with sibling import resolution, focused system prompt, and AI SDK Core streaming in `apps/web`, satisfies **AC-2**, **AC-3**, **AC-7**.
- [x] 6. Update `POST /api/projects/[id]/snapshots` to accept `messageId` and `healingTelemetry` for atomic verification commits, satisfies **AC-7**.
- [x] 7. Integrate loop detection, fingerprint tracking, and verification settling window into `useGenerationLoop` in `apps/web`, satisfies **AC-2**, **AC-4**, **AC-6**, **AC-7**.
- [x] 8. Build healing progress UI inside `GenerationProgressCard` and wire manual repair button into `PreviewErrorBanner` with fresh message creation in `apps/web`, satisfies **AC-5**, **AC-8**.
- [x] 9. Write unit and integration tests for diagnostic parsing, loop limit guards, and repair route handlers, satisfies **AC-1**, **AC-3**, **AC-6**.

## Consequences

**Positive**:
- Broken code syntax, missing package imports, and simple runtime crashes are repaired automatically without user intervention.
- Hard loop limits and fingerprint comparison prevent runaway token spend and circular edits.
- Snapshots in PostgreSQL remain clean and bootable because unverified broken states are not committed blindly, while unhealed code is saved with warning tags rather than lost.
- Event driven verification via Vite HMR eliminates unnecessary sleep delays while avoiding false positive checks.
- Creators gain visibility into self healing actions via transparent progress cards.

**Negative / tradeoffs**:
- Repairs consume additional model tokens and extend total generation time by five to fifteen seconds per attempt.
- The four second fallback timeout for health verification adds latency when Vite encounters slow initial compiles.
- Complex multi component logical bugs may exceed the three attempt budget and still require creator guidance.

**Neutral**:
- Reuses existing database tables and jsonb fields without requiring database schema migrations.
- Works entirely within existing WebContainer sandboxes and postMessage communication boundaries.

## Follow-up

- [ ] Monitor token spend across repair attempts in production to optimize the repair system prompt.
- [ ] Explore automated visual screenshot diffing for blank screen detection in Slice 7.
