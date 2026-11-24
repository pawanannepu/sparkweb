# 0006. Self healing verification engine (Rationale)

**Date**: 2026-11-23

## Context

AI code generation models frequently make minor compilation mistakes, hallucinate non existent icon imports, write syntax typos, or introduce runtime exceptions when referencing undefined variables. In a natural language web application builder, these errors break the live preview frame, leaving creators staring at red compiler overlays or blank white screens.

Without automated self healing, creators must manually read the error message, formulate a corrective prompt, wait for a full generation turn, and hope the model resolves the issue. This manual repair cycle creates frustration, wastes tokens, and breaks the magic of prompt to application creation.

However, an automated repair loop introduces serious architectural risks if not carefully bounded. If a repair pass introduces a different error, or if the model oscillates between two conflicting fixes, the engine can enter an infinite circular loop. This drains creator API tokens, exhausts rate limits, and freezes the builder interface.

Furthermore, client and server state synchronization presents subtle challenges. In the initial generation pipeline, server routes commit snapshots upon stream completion. However, in an in browser WebContainer environment, code execution and compilation occur entirely on the client. The server cannot know whether the generated code will compile cleanly in Vite or crash on component mount. Committing snapshots before client verification risks corrupting project history with broken states. Conversely, failing to save unhealed code when repairs exhaust causes client file trees to desynchronize from the database, losing user progress on page reload.

Therefore, sparkweb requires a verification engine that intercepts sandbox errors automatically, diagnoses root causes with line independent fingerprints, invokes a focused repair pass with sibling module context, verifies recovery via Vite hot update events, and defers snapshot commitment until client health is confirmed.

## Options considered

### Option 1: Client side error interception with regex diagnostic parser, dedicated server repair streaming route, and event driven health handshake

This option implements a closed loop repair pipeline. The sandbox runner intercepts Vite compile errors, syntax exceptions, and unhandled window rejections. A lightweight regex parser extracts file locations and generates a SHA256 error fingerprint hash stripped of line numbers. The host workbench detects the error, pauses snapshot commitment, and calls a dedicated server endpoint `POST /api/projects/[id]/repair`.

The server route uses Vercel AI SDK Core with a specialized repair prompt and provides the failing file, referenced sibling imports, and parsed error diagnostics. Patches stream directly to the WebContainer via postMessage, triggering Vite hot module replacement. The workbench runs a `PREVIEW_HEALTH_CHECK` listening for `PREVIEW_HMR_COMPLETE` from Vite and checks for the absence of error overlays. Loop detection caps repairs at three attempts and halts immediately if an error fingerprint repeats. Upon verification success, the client calls `POST /api/projects/[id]/snapshots` to commit the verified files and attach healing telemetry to `prompt_messages.toolCalls`. If healing exhausts all attempts, a snapshot is still committed with an error flag so local work is preserved.

**Pros**:
- Minimal token consumption because repair prompts include only the failing file and referenced sibling modules.
- Avoids context blindness on export mismatches by including imported sibling files when import errors occur.
- Fast turnaround because repairs skip the initial project planning phase.
- Prevents infinite loops by combining a three attempt hard cap with line independent error fingerprint matching.
- Protects database history by committing snapshots only after client health verification confirms the application works.
- Prevents file loss on page reload by saving exhausted states with an explicit warning note.
- Event driven health checks react immediately upon Vite compilation without arbitrary sleep delays.

**Cons**:
- Adds slight verification latency (under one second normally, up to four seconds on slow compiles) before generation completes.
- Requires updating the snapshot persistence flow so the client triggers the final commit after verification.

### Option 2: Full prompt replay through the primary generation route

This option intercepts preview errors and simply re invokes the existing `POST /api/projects/[id]/generate` route, passing the previous user prompt concatenated with the error log.

**Pros**:
- Requires no new API endpoints or specialized repair streaming routes.
- Gives the model full license to re plan the entire feature from scratch.

**Cons**:
- Consumes massive token budgets by re sending all project files and running both planning and code generation stages.
- Much higher latency, requiring thirty to sixty seconds per repair attempt.
- High risk of discarding valid working code generated during the initial turn.
- Lacks fine grained loop detection, making circular edits more likely.

### Option 3: Passive error banner with manual creator repair only

This option does not automatically trigger repair passes during generation. Instead, errors are displayed on an enhanced banner with a manual repair button that the creator must explicitly click.

**Pros**:
- Zero unexpected token spend because the creator retains manual control over every repair call.
- Simplest implementation with no automated loop orchestration.

**Cons**:
- Forces creators to manually supervise every build and click buttons to fix trivial syntax mistakes.
- Breaks the automated prompt to working application experience.
- Leaves broken intermediate states in preview until the creator notices and reacts.

## Rationale

Option 1 is selected because it strikes the right balance between automated creator convenience, token efficiency, and operational safety.

Replaying the full prompt through Option 2 is unacceptable for production use because re planning an entire project to fix a missing import wastes thousands of tokens and takes up to a minute. Passive error banners in Option 3 force creators to act as manual debuggers, defeating the core value proposition of an autonomous application builder.

Option 1 isolates the repair pass to a dedicated endpoint that receives only the failing file and any referenced sibling imports. Stripping line and column numbers from the SHA256 error fingerprint ensures that code edits shifting error lines do not trick the loop detector. Capping attempts at three guarantees that difficult bugs will never consume uncontrolled token budgets.

Tying verification to Vite `PREVIEW_HMR_COMPLETE` events gives immediate feedback when compilation succeeds, while the four second fallback protects against hung processes. Finally, deferring snapshot commitment to a client call upon verification success guarantees that project history in PostgreSQL remains clean, reliable, and deployable, while preserving exhausted states so no creator work is lost.
