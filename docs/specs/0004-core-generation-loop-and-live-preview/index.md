# 0004. Core generation loop and live preview

**Date**: 2026-11-22
**Status**: In Progress

## Summary

This specification establishes the end to end generation loop and live preview pipeline for sparkweb. Creators enter natural language prompts in the chat panel, a two stage server pipeline plans execution milestones and streams full stack code modifications using Vercel AI SDK Core, an in browser WebContainer mounts the virtual files incrementally, and a live Vite preview boots in under one minute. The server handles prompt context ingestion, securely decrypts provider API keys, streams plan steps and file operations via Server Sent Events, and commits immutable content addressable snapshots directly to PostgreSQL upon completion.

## Requirements

**User stories**:
- As a creator, I want to type a prompt describing an application or feature, watch visible task milestones and file changes stream in real time, and see my live working application running in the preview frame beside the chat in under one minute.
- As a creator, I want rapid subsequent prompt iterations that update existing files in place through hot module replacement, so that my preview application retains its runtime state without a full container reboot.
- As a developer using my own provider keys, I want my API credentials decrypted securely on the server and used to invoke the planner and generator models without exposing plain secret values to the browser.
- As a creator, I want clear visual indicators for syntax or runtime errors occurring inside the preview sandbox, along with actionable recovery hints in the chat panel.
- As an operator, I want generated file snapshots committed directly by the server with strict exclusion of build artifacts and node_modules, ensuring database records stay lean and resilient against client tab closures.

**Acceptance criteria**:
- **AC-1**: Generation route accepts a natural language prompt, verifies project ownership against the authenticated session, resolves or creates the prompt thread, decrypts the requested provider API key on the server, and returns a Server Sent Events stream using the Vercel AI SDK data stream protocol.
- **AC-2**: The generation pipeline executes in two structured stages: an initial planning phase emitting an array of human readable task milestones, followed by a code generation phase that streams tool calls for writing and deleting files with relative paths and contents.
- **AC-3**: Starter projects without existing snapshots boot from a pre bundled Vite React Tailwind TypeScript template embedded in packages/sandbox, initializing client side PGlite for in browser database queries with zero npm install latency.
- **AC-4**: Incremental virtual file system synchronization writes file modifications directly into the running WebContainer file system via typed PREVIEW_WRITE_FILES bridge messages, triggering Vite hot module replacement without terminating running processes.
- **AC-5**: Chat panel displays an interactive progress widget that renders live planning checklist milestones, active file badges with status indicators (creating, updating, complete), and expandable code diff previews while streaming.
- **AC-6**: User cancellation via an abort button halts the active generation stream immediately using an AbortController, marks the prompt message status as failed with a cancellation reason, preserves all applied file updates in the sandbox, and re enables the prompt composer.
- **AC-7**: Preview runner iframe and parent host workbench enforce cross origin isolation headers (COOP same-origin and COEP credentialless), enabling WebAssembly SharedArrayBuffer execution inside the iframe while Auth.js uses standard full page redirects.
- **AC-8**: Preview runner iframe intercepts Vite compiler diagnostics, unhandled promise rejections, and window runtime errors, transmitting typed PREVIEW_ERROR bridge messages with line and column metadata to the host workbench for instant error display.
- **AC-9**: Upon generation stream completion, the server automatically computes an immutable SHA256 content addressable tree hash with strict exclusion of node_modules and cache folders, commits a new snapshot record to PostgreSQL via Drizzle ORM, updates the assistant message with snapshot association and tool execution metadata, and emits a final SSE finish event with the new snapshot identifier.

## Decision

**Chosen option**: Option 1: Two stage streaming generation pipeline with in browser WebContainers, incremental Vite hot module synchronization, and server side snapshot persistence

We establish an end to end generation loop pairing a two stage server generation route (planner phase then file generator phase) with client side WebContainer execution. Server Sent Events stream structured task milestones and file operations to the builder workbench. File updates synchronize directly into an isolated iframe sandbox runner using postMessage RPC, triggering Vite hot module updates in real time. The server commits immutable snapshots directly to PostgreSQL upon turn completion, guaranteeing persistence even if the client disconnects. Both the host workbench and runner iframe enforce cross origin isolation headers, with Auth.js using standard full page redirects to preserve complete authentication compatibility.

**Implementation skills**: `next-dev-loop` (`vercel/next.js`, `.agents/skills/next-dev-loop/`) · `turborepo` (`vercel/turborepo`, `.agents/skills/turborepo/`) · `drizzle-orm-patterns` (`giuseppe-trisciuoglio/developer-kit`, `.agents/skills/drizzle-orm-patterns/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:
Reuses and populates the schema established in Spec 0002 without requiring breaking database migrations:

```
prompt_threads
  id: uuid (PK)
  projectId: uuid (FK -> projects.id on delete cascade)
  title: text
  createdAt: timestamp
  updatedAt: timestamp

prompt_messages
  id: uuid (PK)
  threadId: uuid (FK -> prompt_threads.id on delete cascade)
  seq: integer (unique with threadId)
  role: 'user' | 'assistant' | 'system'
  content: text
  toolCalls: jsonb (stores plan milestones, file operations, model id, and token usage)
  snapshotId: uuid (nullable FK -> snapshots.id on delete set null)
  status: 'pending' | 'streaming' | 'completed' | 'failed'
  createdAt: timestamp

snapshots
  id: uuid (PK)
  projectId: uuid (FK -> projects.id on delete cascade)
  parentId: uuid (nullable FK -> snapshots.id on delete set null)
  branchName: text (default 'main')
  treeHash: text (SHA256 content addressable hash)
  files: jsonb (map of relative file path to { content: string, isBinary?: boolean })
  message: text (turn summary)
  createdAt: timestamp

projects
  id: uuid (PK)
  currentSnapshotId: uuid (nullable FK -> snapshots.id on delete set null)
```

Structure of `prompt_messages.toolCalls` jsonb:
```json
{
  "plan": [
    { "id": "step-1", "title": "Scaffold data table component", "status": "completed" },
    { "id": "step-2", "title": "Wire PGlite client query hook", "status": "completed" }
  ],
  "fileOperations": [
    { "path": "src/components/DataTable.tsx", "op": "write", "status": "completed" },
    { "path": "src/App.tsx", "op": "write", "status": "completed" }
  ],
  "model": "claude-3-7-sonnet",
  "provider": "anthropic",
  "totalTokens": 1842
}
```

**Model registry and provider resolution**:
The generation route maps requested model identifiers to their provider keys in `api_keys`:
- `claude-3-7-sonnet`: provider `anthropic` (default model)
- `gpt-4o`: provider `openai`
- `gemini-2.0-flash`: provider `gemini`

If no model is specified in the request, `claude-3-7-sonnet` is used. If the user has not configured a valid key for the resolved provider in `api_keys`, the route aborts before invoking the LLM and returns HTTP 400 Bad Request with:
```json
{
  "error": "PROVIDER_KEY_MISSING",
  "provider": "anthropic",
  "message": "Please add your Anthropic API key in workspace settings before generating code."
}
```

**Context ingestion and file tree resolution**:
When `/api/projects/[id]/generate` executes:
1. Thread resolution: If `threadId` is omitted, the route queries `prompt_threads` for `projectId = [id]` ordered by `createdAt ASC` limit 1. If none exists, it creates a new thread titled `"Main thread"`.
2. Existing file resolution: The route checks `projects.currentSnapshotId`. If set, it loads `snapshots.files`. If `currentSnapshotId` is null, it imports the starter template file tree exported by `@spark/sandbox`.
3. Context filtering: Only source files matching allowed patterns are provided to the LLM prompt (`src/**`, `public/**`, `index.html`, `package.json`, `vite.config.ts`, `tailwind.config.js`). Large binaries or generated artifacts are never passed into context.
4. Conversation history: The route fetches the last 10 messages from `prompt_messages` for the thread, formatting them into system, user, and assistant turns.

**Tool call contracts for code generator**:
The code generator LLM is provided two tools:
```typescript
interface WriteFileToolArgs {
  path: string; // e.g. "src/components/Card.tsx"
  content: string; // full updated file contents
  description?: string; // brief human readable summary of change
}

interface DeleteFileToolArgs {
  path: string; // e.g. "src/components/OldCard.tsx"
}
```
As `write_file` streams, the client computes an in memory diff comparing incoming content with the existing file in WebContainer, rendering live visual diff hunks in `GenerationProgressCard`.

**Snapshot exclusion rules**:
When computing tree hashes and committing snapshots to PostgreSQL, a strict exclusion filter drops all non source files:
- Excluded paths: `node_modules/**`, `.vite/**`, `dist/**`, `.next/**`, `*.log`, `coverage/**`
- Enforced limits: Maximum 500KB per individual file, maximum 10MB total virtual tree size.

**Extended postMessage bridge protocol**:
The communication bridge in `@spark/shared` and `apps/web/src/hooks/usePreviewBridge.ts` expands to support these typed messages:
- `PREVIEW_BOOT`: Payload `{ files: SnapshotFilesMap }` sent by host to initialize or wipe the virtual file system.
- `PREVIEW_WRITE_FILES`: Payload `{ files: ProjectFile[] }` sent by host to write or update files in WebContainer without restarting the dev server.
- `PREVIEW_ERROR`: Payload `{ message: string, filename?: string, line?: number, column?: number, stack?: string }` sent by sandbox to host upon compile or runtime errors.
- `PREVIEW_READY`: Payload `{ url: string }` sent by sandbox when Vite starts listening on its local port.
- `PREVIEW_RELOAD`: Sent by host to trigger hard page refresh inside the preview.

**State transitions**:
Generation stream and workbench preview state machine:
- `idle`: Workbench ready, prompt composer active, preview displaying current snapshot.
- `planning`: Prompt submitted, composer disabled, user and assistant messages inserted with status streaming, planner model emitting task milestones.
- `streaming`: Code generator invoking write_file and delete_file tools, progress card displaying active file pills and live diffs, WebContainer virtual file system receiving file writes via PREVIEW_WRITE_FILES.
- `verifying`: Generation stream finished, WebContainer verifying Vite compilation status.
- `ready`: Verification passed, server commits snapshot to PostgreSQL, updates assistant message to completed, emits SSE finish event, composer re enabled.
- `error`: Pipeline or sandbox error encountered, assistant message updated to status failed, error banner displayed with retry option, composer re enabled.
- `cancelled`: User triggered abort via AbortController, assistant message marked failed with cancellation reason, partial files preserved in sandbox, composer re enabled.

**API surface**:
| Endpoint / Interface | Method / Type | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/projects/[id]/generate` | POST | `prompt`: string, `threadId`?: string, `model`?: string, `activeFiles`?: string[] | Server Sent Events stream (AI SDK data protocol: plan, tool_call, text, finish with snapshotId) | Session required (project owner) | 400 Bad Request (empty prompt, missing key), 401 Unauthorized, 404 Not Found, 429 Rate Limit, 500 Model Failure |
| `/projects/[id]` | GET | Route parameter `id` | Next.js builder workbench page with headers: `Cross-Origin-Embedder-Policy: credentialless` and `Cross-Origin-Opener-Policy: same-origin` | Session required | 401 Unauthorized, 404 Not Found |
| `/sandbox/runner` | GET | None (loads HTML shell) | HTML runner document with headers: `Cross-Origin-Embedder-Policy: credentialless` and `Cross-Origin-Opener-Policy: same-origin` | Public (sandboxed iframe) | None |
| `useGenerationLoop` | React Hook | `projectId`: string, `threadId`: string, `onFileChange`: (path: string, content: string) => void | `submitPrompt`: (p: string) => Promise<void>, `cancelGeneration`: () => void, `isStreaming`: boolean, `planSteps`: PlanStep[], `activeFiles`: FileOp[], `error`: string \| null | Client hook | Network disconnect, model timeout |
| `useSandboxRunner` | React Hook | `iframeRef`: RefObject<HTMLIFrameElement>, `onStatusChange`: (s: PreviewStatus) => void | `bootSandbox`: (templateFiles: SnapshotFilesMap) => Promise<void>, `applyFileUpdates`: (files: ProjectFile[]) => Promise<void>, `runnerStatus`: PreviewStatus, `previewUrl`: string \| null, `errors`: string[] | Client hook | WebContainer boot failure, port listen timeout |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Submit prompt | Planning milestones checklist | Generated by planner LLM step in `/api/projects/[id]/generate` from user prompt and file tree context |
| Stream file modification | File path and file diff contents | Emitted by generator LLM tool calls in `/api/projects/[id]/generate`, streamed via SSE |
| Display active model badge | Model name label (e.g. Claude 3.7 Sonnet) | User model selection in `PromptComposer`, resolved to stored provider in `api_keys` |
| Authorize generation request | Decrypted provider API key | Decrypted on server using `ENCRYPTION_KEY` from `api_keys` record matching `session.user.id` |
| Mount sandbox starter | Pre bundled starter file tree | Statically compiled in `@spark/sandbox` package asset bundle |
| Refresh preview on file change | Hot module reload without page refresh | In memory file write via WebContainer `fs.writeFile`, picked up by running Vite dev server |
| Surface compilation failure | Error notification and log trace | Emitted by Vite server stderr inside WebContainer, forwarded via `PREVIEW_ERROR` bridge message |
| Abort running generation | Stream termination and partial preservation | Client `AbortController.abort()` cancels fetch request; server marks message failed; sandbox keeps partial files |
| Commit generation snapshot | Snapshot record with tree hash | Computed server side via SHA256 of filtered canonical file map, stored in PostgreSQL `snapshots` table upon stream completion |

**Key invariants**:
- Both the parent builder window (`/projects/[id]`) and the runner iframe (`/sandbox/runner`) must send `Cross-Origin-Embedder-Policy: credentialless` and `Cross-Origin-Opener-Policy: same-origin`, with the iframe bearing `allow="cross-origin-isolated"`, so WebAssembly SharedArrayBuffer executes reliably.
- Auth.js must use standard full page OAuth redirects, avoiding popup windows that would be blocked by `COOP: same-origin`.
- The builder prompt composer must remain disabled while a generation stream is actively running to prevent race conditions and interleaved file writes.
- Provider API keys must never be returned to the client browser in plain text; all decryption occurs strictly in server route handlers.
- Snapshot persistence is transactional and server driven: the server computes the tree hash and writes the snapshot to PostgreSQL at the end of the generation stream, guaranteeing persistence even if the client disconnects prematurely.
- File system updates inside WebContainer must maintain strict path safety, rejecting paths that attempt parent directory traversal (`../`) outside the sandbox root.
- The snapshot filter must strictly exclude `node_modules/`, `.vite/`, and build artifacts from entering PostgreSQL JSONB records.

**Security model**:
- Route `/api/projects/[id]/generate` requires an active Auth.js session and verifies that `project.userId === session.user.id`. Requests for projects owned by other users return HTTP 404 to avoid leaking project existence.
- User provider API keys are read from the `api_keys` table, decrypted using AES 256 GCM with stored IV and authentication tags, and passed directly into the AI SDK provider instance in memory for that request only.
- The preview iframe operates under sandbox attributes `allow-scripts allow-same-origin allow-forms allow-popups`, preventing generated applications from accessing host local storage, host session cookies, or parent window DOM.
- Communication between the host and preview sandbox is restricted to verified `sparkweb:bridge:v1` postMessage protocols with strict origin matching.

**Configuration required**:
- `ENCRYPTION_KEY`: 32 byte hex string used to decrypt stored provider API keys (already defined in Spec 0002).
- `NEXT_PUBLIC_SANDBOX_URL`: Optional origin override for the sandbox runner iframe (defaults to window.location.origin).

**Critical test scenarios**:
- Happy path: User enters prompt "Create a counter with increment and decrement buttons", planner returns 2 milestones, generator streams `src/components/Counter.tsx` and `src/App.tsx`, WebContainer writes files in place, Vite applies hot reload in under 15 seconds, and a snapshot commits to PostgreSQL. Verifies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-9**.
- User abort: User clicks Stop button halfway through a multi file generation stream, AbortController cancels the network request, files written up to the abort point remain intact in WebContainer, server updates prompt message status to failed, and the prompt composer re enables immediately. Verifies **AC-6**.
- Syntax failure detection: Generator writes invalid JSX syntax, Vite dev server emits error on stderr, sandbox bridge sends `PREVIEW_ERROR` event with line and column numbers, and the chat panel highlights the failing file with a recovery hint. Verifies **AC-8**.
- Cross origin isolation verification: Workbench loads on `/projects/[id]`, `window.crossOriginIsolated` evaluates to true, iframe initializes WebContainer without SharedArrayBuffer security exceptions. Verifies **AC-7**.
- Unauthorized project access: User attempts to call generation route for a project belonging to a different user, server returns HTTP 404, no LLM tokens or API keys are consumed. Verifies **AC-1**.

## Build plan

Ordered build tasks derived from the requirements, structured as a thin end to end Tracer Bullet vertical slice:

- [x] 1. Configure cross origin isolation headers (COOP same-origin, COEP credentialless) across Next.js config for `/projects/:path*` and `/sandbox/:path*`, satisfies **AC-7**.
- [x] 2. Expand `@spark/shared` bridge message contracts to include `PREVIEW_BOOT`, `PREVIEW_WRITE_FILES`, and `PREVIEW_ERROR` with structured payloads, satisfies **AC-4**, **AC-8**.
- [x] 3. Create starter template package bundle and virtual file system definitions in `packages/sandbox`, satisfies **AC-3**.
- [x] 4. Implement WebContainer runtime boot, file synchronization manager, and dev server lifecycle hooks in `packages/sandbox`, satisfies **AC-3**, **AC-4**.
- [x] 5. Create sandbox runner route at `apps/web/src/app/sandbox/runner/page.tsx` with `allow="cross-origin-isolated"` iframe container and postMessage bridge listener, satisfies **AC-4**, **AC-7**, **AC-8**.
- [x] 6. Build server side generation route at `apps/web/src/app/api/projects/[id]/generate/route.ts` with session authorization, provider key decryption, model registry resolution, context ingestion, AI SDK two stage streaming, and transactional snapshot persistence, satisfies **AC-1**, **AC-2**, **AC-9**.
- [x] 7. Implement client side generation hook `useGenerationLoop` with AbortController cancellation, Server Sent Events stream consumption, and live diff calculation, satisfies **AC-1**, **AC-2**, **AC-5**, **AC-6**.
- [x] 8. Build interactive generation UI components in `apps/web/src/components/generation/`: `PromptComposer`, `GenerationProgressCard` with milestone checklist, active file pills, and diff viewer, satisfies **AC-5**, **AC-6**.
- [x] 9. Connect preview error listener in `PreviewFrame` to capture `PREVIEW_ERROR` bridge events and display non blocking error banners, satisfies **AC-8**.

## Consequences

**Positive**:
- Creators receive instant visible progress through task milestones and active file badges, making long code generations understandable and transparent.
- In browser WebContainers eliminate all server side execution costs and container hosting infrastructure during interactive app generation.
- Incremental Vite file synchronization enables sub second preview updates without losing client side form state or counter values.
- Server driven snapshot creation guarantees that generated code and file trees are persisted reliably even if client network connections drop.
- Server side API key decryption protects creator credentials while supporting bring your own key flexibility across Anthropic, OpenAI, and Gemini.

**Negative / tradeoffs**:
- WebContainer runs in browser WebAssembly and is subject to client tab memory limits, especially on mobile or constrained devices.
- Enabling cross origin isolation headers on the builder route requires Auth.js to use full page redirects instead of popup windows.
- Packages with native C++ dependencies cannot compile inside WebContainer unless pre compiled WebAssembly builds are supplied.

**Neutral**:
- The planner prompt and code generation prompts require careful versioned maintenance to ensure reliable tool call formatting across different LLM providers.
- Future multi file visual inspection will build directly on top of the Vite plugin AST injection hooks established in this sandbox architecture.

## Follow-up

- [ ] Add token usage metering to `prompt_messages.toolCalls` to track consumption per model provider.
- [ ] Connect the Slice 3 self healing verification loop to intercept `PREVIEW_ERROR` events and trigger automatic repair passes.
- [ ] Implement export to zip in Slice 9 using the canonical virtual file system map.
