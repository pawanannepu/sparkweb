# Rationale: 0004. Core generation loop and live preview

## Context

sparkweb empowers creators to build full stack applications by expressing their intent in plain words. The core generation loop and live preview form the central engine of the entire product. If the generation experience feels slow, opaque, or disconnected from the preview, creator trust collapses immediately.

Several competing technical and operational forces govern this architecture:
First, generation latency and perceived progress. Generating a multi file application can take 30 to 60 seconds depending on LLM output speed. A single opaque spinner produces anxiety and leads to premature tab abandonment. Creators need to understand what the AI is planning to do, which files are being altered, and see incremental progress stream in real time.

Second, preview execution cost, cross origin isolation, and browser security. Running arbitrary generated full stack code on server infrastructure creates enormous operational expense, resource scaling challenges, and severe security risks around multi tenant isolation. Running code entirely in the user browser using WebContainers eliminates server compute bills. However, WebContainers rely on WebAssembly SharedArrayBuffer, which modern browsers restrict under strict cross origin isolation requirements. Under W3C browser security rules, an iframe cannot achieve cross origin isolation unless the parent host window is also cross origin isolated with COOP same-origin and COEP credentialless headers. This necessitates using full page redirects for Auth.js authentication rather than popup windows.

Third, iteration cycle speed. Once an initial application is generated, subsequent creator prompts typically tweak styling, add components, or modify queries. If every prompt requires a cold container restart and full dependency re installation, the creative flow is destroyed. The system must support hot module replacement inside the virtual file system so edits reflect in under one second while preserving browser state.

Fourth, persistence resilience and database health. Having the client browser calculate tree hashes and trigger snapshot saves risks data loss if a user closes the tab immediately after code generation finishes. Making snapshot persistence transactional and server driven guarantees database integrity. Furthermore, WebContainer contains extensive virtual folders including node_modules and Vite compiler caches. Without explicit exclusion filters, snapshots would write tens of megabytes of binary junk into PostgreSQL JSONB columns.

Fifth, credential security. In a self hosted or open source model where creators provide their own API keys for Anthropic, OpenAI, or Gemini, those keys must never be exposed to the client browser or third party scripts. Decryption must occur on demand on the server for each generation stream.

## Options considered

### Option 1: Two stage streaming generation pipeline with in browser WebContainers, incremental Vite hot module synchronization, and server side snapshot persistence

A server side route uses Vercel AI SDK Core to orchestrate a two stage generation stream. An initial planning pass emits structured task milestones, followed by a generator pass streaming tool calls for writing and deleting files. The client workbench displays an interactive checklist and live diff viewer. Files synchronize directly into an isolated WebContainer runner iframe using a typed postMessage bridge, triggering Vite hot module replacement in place. The server commits immutable snapshots directly to PostgreSQL upon turn completion with strict exclusion of node_modules and cache directories. Both the host workbench and runner iframe enforce cross origin isolation headers.

**Pros**:
- Zero server compute expenses during code execution, scaling to unlimited concurrent users without server infrastructure cost.
- Instant feedback through visible task planning and real time file modification progress.
- Sub second preview iteration because Vite hot module replacement updates virtual files without rebooting the container or losing form state.
- Resilient snapshot persistence that does not rely on client tab longevity.
- Protection against database bloat by strictly excluding build artifacts and node_modules from snapshot JSONB records.
- Provider API keys remain strictly on the server and are never exposed to browser memory.

**Cons**:
- WebContainer browser execution requires WebAssembly and SharedArrayBuffer support, limiting compatibility in older browsers or constrained mobile environments.
- Enabling cross origin isolation on the host page requires full page redirects for Auth.js instead of popup windows.

### Option 2: Single stage direct file streaming with cold container reboot and client driven persistence

A single LLM prompt pass writes files directly into a virtual file tree stream without a separate planning stage. On stream completion, the client browser computes hashes and posts files back to a snapshot endpoint. The preview iframe terminates its existing WebContainer process, wipes the virtual file system, and boots the container from scratch.

**Pros**:
- Slightly lower time to first token because no planning model turn precedes code generation.
- Complete state isolation on every turn, avoiding residual memory leaks from stale module state.

**Cons**:
- Opaque user experience where creators cannot see what changes are planned until files begin streaming.
- Painful 10 to 20 second reload delay on every minor prompt tweak due to cold container reboots.
- Loss of all client side runtime state on every prompt turn.
- Fragile persistence vulnerable to tab closing races and database bloat from unconstrained file serialization.

### Option 3: Server side remote container execution over WebSockets

Code generation streams to the client, but the application executes inside remote container microVMs on cloud servers (such as Docker or Firecracker). WebSockets stream terminal logs, file diffs, and preview rendering to the client browser.

**Pros**:
- Eliminates browser WebAssembly memory constraints and supports native C++ binaries.
- Avoids cross origin isolation headers on the host website.

**Cons**:
- Enormous ongoing server compute costs for idle containers during interactive editing sessions.
- Significant infrastructure complexity managing container lifecycles, pooling, and multi tenant security boundaries.
- Network latency degrades the responsiveness of local interactive testing.

## Rationale

We choose Option 1: Two stage streaming generation pipeline with in browser WebContainers, incremental Vite hot module synchronization, and server side snapshot persistence.

This choice aligns directly with the architectural foundations established in Spec 0001 and the project scope. By running the preview runtime inside the browser via WebContainers, sparkweb incurs zero cloud compute expense while creators experiment and build. This enables a sustainable, scalable open source and bring your own keys business model.

Addressing the cross origin isolation requirement by applying COOP same-origin and COEP credentialless to both `/projects/:id` and `/sandbox/:id` guarantees that WebContainer SharedArrayBuffer transfers succeed without runtime security errors. Standardizing Auth.js on full page redirects rather than popups keeps authentication robust and seamless.

The two stage generation approach solves the opacity problem of automated coding agents. By breaking the synthesis into an explicit planning milestone phase followed by targeted file operations, creators gain immediate clarity on what is changing and why.

Server driven snapshot persistence eliminates network disconnect vulnerabilities, while explicit exclusion filters protect PostgreSQL from node_modules bloat. Incremental Vite synchronization keeps updates instantaneous, and server side key decryption maintains uncompromising credential security.
