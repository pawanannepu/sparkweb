# Scope: sparkweb

sparkweb is a web application builder where anyone can describe an application in plain words and receive a working, full stack application they can use, edit, and publish without writing code, while developers retain full code ownership.

**Build approach:** Tracer Bullet (vertical slices where each feature is built end to end through every layer, working).
**Workflow:** GA (after /develop, run /check verify, /test, a fresh model /check review, then /document). The project default level of rigor. /architect is the recommended first stop for a feature with a real decision, but skippable when you already know the build. Any feature can carry its own tag to do more or less.

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use /develop and skip /architect. You decide when a feature is done._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | Stack and architecture | Foundation | in-progress |
| 2 | Coding standards and tooling | Foundation | in-progress |
| 3 | Data model | Foundation | in-progress |
| 4 | Design system and UI foundation | Foundation | in-progress |
| 5 | Core generation loop and live preview | Slice 1 | planned |
| 6 | Visual canvas inspector and direct styling | Slice 2 | planned |
| 7 | Self healing verification engine | Slice 3 | planned |
| 8 | Version history snapshots and time travel rollback | Slice 4 | planned |
| 9 | Managed database viewer and client data tools | Slice 5 | planned |
| 10 | One click publishing and isolated live hosting | Slice 6 | planned |
| 11 | Multi modal generation from images and design links | Slice 7 | planned |
| 12 | Template library and starter project remixing | Slice 8 | planned |
| 13 | GitHub sync and full code export | Slice 9 | planned |

## Foundations

### 1. Stack and architecture
Select the application stack, determine runtime boundaries, and scaffold a runnable full stack project so every future slice builds on real code.
**Done when:** the stack is recorded in a spec, the empty scaffold boots locally, and dev servers pass basic build checks.
spec [0001](../specs/0001-stack-and-architecture/index.md)
code in `apps/web`, `packages/db`, `packages/sandbox`, `packages/shared`
- [x] Decide the stack (spec): `/architect stack & architecture`
- [x] Scaffold from the decision: `/develop stack & architecture`
- [x] Smoke check it runs: `/test`
(basis: foundations before features, stack decision sets directory layout and core dependencies)

### 2. Coding standards and tooling
Capture project conventions into root AGENTS.md, then install lint, format, typecheck, and pre-commit checks from the real scaffolded project.
**Done when:** root AGENTS.md reflects the real stack, and lint, format, and typecheck commands run clean.
code in `biome.json`, `.husky`, `.github/workflows`
- [x] Capture conventions and tooling choices: `/audit`
- [x] Install the tooling: `/develop tooling`
- [x] Check it runs clean: `/test`
(basis: code quality tooling must enforce standards across every generated and host file)

### 3. Data model
Define core persistence models for user accounts, personal API keys, project metadata, prompt threads, generated file trees, and deployment states.
**Done when:** schema and relational constraints support the core generation loop, snapshot branches, and published deployments without breaking changes.
spec [0002](../specs/0002-data-model/index.md) · code in `packages/db`
- [x] Design it (spec): `/architect data model`
- [x] Build it: `/develop data model`
  - [x] Schema declarations and relations for auth, keys, projects, threads, snapshots, deployments (AC-1, AC-4, AC-5)
  - [x] Encryption and tree hash cryptographic helpers (AC-2, AC-3)
  - [x] Migration generation and runner verification (AC-6)
  - [x] Typed domain queries, mutations, and projection helpers (AC-1, AC-2, AC-3, AC-5)
- [x] Verify it: `/check verify data model`
- [x] Test it: `/test data model`
- [x] Review it (fresh model): `/check review data model`
- [x] Document it: `/document data model`
(basis: data model is the costliest thing to redo)

### 4. Design system and UI foundation
Establish the visual system, accessible component library, responsive split pane builder layout, and live preview iframe container.
**Done when:** design system specification defines typography, color tokens, responsive layout rules, keyboard navigation, and accessible base controls.
spec [0003](../specs/0003-design-system-and-ui-foundation/index.md) · code in `apps/web/src/components`, `apps/web/src/hooks`
- [x] Design it (spec): `/architect design system & UI foundation`
- [x] Build it: `/develop design system & UI foundation`
  - [x] Design tokens, typography, and flash prevention script (AC-1)
  - [x] Accessible base UI component primitives (AC-2)
  - [x] Workspace layout hook with debounced local storage persistence (AC-4)
  - [x] Resizable workbench, collapsible chat panel, and mobile switcher (AC-3, AC-5)
  - [x] Live preview container, device presets, and postMessage bridge (AC-6, AC-7)
- [x] Verify it: `/check verify design system & UI foundation`
- [x] Test it: `/test design system & UI foundation`
- [x] Review it (fresh model): `/check review design system & UI foundation`
- [x] Document it: `/document design system & UI foundation`
(basis: WCAG 2.1 accessible base components and consistent responsive design)

## Slice 1: Core generation loop and live preview

### 5. Core generation loop and live preview · needs a decision
Connect the full path end to end: user types a prompt, the planner breaks it down, the code generator writes the full stack files, a client side sandbox executes them, and the live preview boots beside the chat.
**Done when:** a creator can enter a prompt, watch code generate in real time, view the booted application in the preview frame under one minute, and verify basic interactions work.
- [ ] Design it (spec): `/architect core generation loop & live preview`
(basis: tracer bullets prove the full integration pipe through every layer from day one)

## Slice 2: Visual canvas inspector and direct styling

### 6. Visual canvas inspector and direct styling · needs a decision
Enable point and click selection of any element inside the live preview to inspect its properties, describe adjustments in natural language, or edit text, colors, and layout directly with visual controls.
**Done when:** clicking an element highlights its corresponding code boundary, visual controls apply updates instantly, and changes synchronize cleanly into the project code tree.
- [ ] Design it (spec): `/architect visual canvas inspector & direct styling`
(basis: visual point and click editing lets creators polish applications without manual prompt round trips)

## Slice 3: Self healing verification engine

### 7. Self healing verification engine · needs a decision
Intercept runtime errors and build failures in the preview sandbox, parse error logs automatically, invoke a targeted repair pass, and verify that the application recovers before concluding the build.
**Done when:** broken preview code triggers automated log analysis, the repair loop patches the error, and generations halt safely if an unfixable loop occurs.
(basis: automated self checks and loop detection prevent broken apps and wasted token runs)
- [ ] Design it (spec): `/architect self healing verification engine`

## Slice 4: Version history snapshots and time travel rollback

### 8. Version history snapshots and time travel rollback · needs a decision
Record immutable snapshots at every generation step or manual adjustment, allowing creators to view visual and code diffs, undo actions, roll back to prior states, and safely branch experiments.
**Done when:** creators can browse chronological versions, inspect side by side visual and code diffs, restore any past checkpoint, and fork into a separate branch.
- [ ] Design it (spec): `/architect version history snapshots & time travel rollback`
(basis: immutable snapshot history allows risk free iteration and rollback)

## Slice 5: Managed database viewer and client data tools

### 9. Managed database viewer and client data tools · needs a decision
Provide an intuitive visual data browser inside the builder workspace where creators can view tables, inspect rows, insert or edit records, and request schema migrations in plain words.
**Done when:** creators can view tables and records generated for their app, edit row values directly, and ask spark to add columns or tables safely.
- [ ] Design it (spec): `/architect managed database viewer & client data tools`
(basis: applications require visual database inspection and state management)

## Slice 6: One click publishing and isolated live hosting

### 10. One click publishing and isolated live hosting · needs a decision
Publish generated applications to persistent live web addresses with custom domains, automatic SSL certificates, and strict isolation between preview drafts and public live releases.
**Done when:** clicking publish deploys the current snapshot to a public secure URL, custom domain routing succeeds, and subsequent workspace edits remain in preview until published again.
- [ ] Design it (spec): `/architect one click publishing & isolated live hosting`
(basis: separate preview and live environments prevent accidental staging leaks)

## Slice 7: Multi modal generation from images and design links

### 11. Multi modal generation from images and design links · needs a decision
Accept screenshots, paper sketches, design exports, or external website URLs to seed layout structure, visual color palettes, and component hierarchy for prompt generation.
**Done when:** uploading an image or entering an existing website address extracts layout structure and visual style tokens, creating a planned application outline ready to build.
- [ ] Design it (spec): `/architect multi modal generation`
(basis: multi modal inputs accelerate creator onboarding from existing designs)

## Slice 8: Template library and starter project remixing

### 12. Template library and starter project remixing · needs a decision
Curate high quality starter templates across common archetypes (landing pages, administrative dashboards, booking systems, internal tools) that creators can browse, preview, clone, and remix instantly.
**Done when:** visitors can browse a template gallery, run live interactive previews, duplicate any template into their workspace with one click, and continue customizing by chat.
- [ ] Design it (spec): `/architect template library & starter project remixing`
(basis: templates provide immediate time to value for common product archetypes)

## Slice 9: GitHub sync and full code export

### 13. GitHub sync and full code export · needs a decision
Allow developers to download the complete generated project as a clean, standard zip archive and connect GitHub repositories for two way commit synchronization.
**Done when:** users can download a zip file containing standard readable source code that runs independently, or connect a GitHub repository to push commits and pull remote updates.
- [ ] Design it (spec): `/architect github sync & full code export`
(basis: full code export and git synchronization prevent platform lock in)

## Deferred
Out of scope for the current build pass, kept so the plan stays honest.
- **Team collaboration and shared workspaces**: multi user editing, comments, and role based project permissions · needs a decision
- **Credit billing and token metering**: payment tiers and credit tracking, deferred for the open source bring your own keys release · needs a decision
- **Third party live service connectors**: live production integrations for external payment gateways, email providers, and calendar sync beyond local sandbox mocks · needs a decision

## References

### Project sources
- `your description`: web application builder, prompt to full stack app, live preview, visual editing, self healing builds, publishing, and code ownership.
- `Tracer Bullet approach`: Andrew Hunt and David Thomas, The Pragmatic Programmer (tracer bullets prove architectural connections end to end).
- `StackBlitz WebContainers`: in browser Node.js and WebAssembly container runtime for instant, zero cost client execution.
- `The Twelve Factor App`: Factor III Config, separating secrets from code via environment variables.
- `OWASP GenAI Security Project`: Top 10 for Large Language Model Applications (preventing prompt injection, unsafe output handling, and unauthorized execution).
- `W3C Web Content Accessibility Guidelines (WCAG) 2.1`: accessibility standards for builder interface and generated outputs.

### Links
- [The Pragmatic Programmer Tracer Bullets](https://artima.com)
- [StackBlitz WebContainers Documentation](https://webcontainers.io)
- [The Twelve Factor App Config](https://12factor.net/config)
- [OWASP GenAI Security Project Top 10](https://genai.owasp.org/llm-top-10/)
- [W3C Web Content Accessibility Guidelines 2.1](https://www.w3.org/TR/WCAG21/)

## Legend

**The decision box.** Every feature carries exactly one, the sub task whose label ends with `(spec)`. Its wording varies (`Design it (spec)` normally, `Decide the stack (spec)` on Stack and architecture), so skills locate it by that `(spec)` suffix, never by an exact label. Every other box is an execution box and /architect never ticks one.

**Feature lifecycle**: the scope updates as a feature moves; each row is what it shows and who sets it:

| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/scope` | one box: `Design it (spec): /architect <feature>` |
| `in-progress` (designed) | **`/architect` at spec capture** | `Design it` ticked; spec linked; `Build it: /develop <feature>` + **2 to 5 milestones**; the tier's closing boxes (`Verify it` Alpha+, `Test it` Beta+, `Review it` + `Document it` GA); any surfaced follow up enrolled |
| `in-progress` (building) | `/develop` | milestone sub boxes tick one by one; code pointer filled |
| `in-progress` (verified) | `/check verify` | `Build it` + milestones ticked; `Verify it` ticked |
| `done` | **you, when you decide it is** (any skill sets it when you say so); `/sync` reconciles | boxes you ran ticked, skipped ones marked skipped; the tier's last stage (`Prototype` → after `/develop`; `Alpha` → after `/check verify`; `Beta`/`GA` → after `/test`) is the suggested point to call it done; `/sync` captures conventions |

- **Next step** = the first unticked box (always a command or a tracked milestone).
- **needs a decision** = run `/architect` first; otherwise straight to `/develop` (or `/audit` for standards and tooling). The tag drops once the spec is captured.
- **Atomic build tasks live in the spec's ## Build plan, not here**: the scope carries only the milestone rollup.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (pre workflow) and `dropped` (de scoped, kept for history).
- **Approach tag** beside a heading overrides the project default for that feature; no tag = inherits it.
- **Workflow tier tag** beside a heading sets that one feature's rigor above or below the project default; no tag inherits the default. It decides the feature's check boxes and each skill's next suggestion.
- **Workflow** (header line) is the project default, what runs after `/develop`: **Prototype** = nothing (trust develop's own build time self check); **Alpha** = `/check verify`; **Beta** = `/check verify` then `/test`; **GA** = adds a fresh model `/check review` then `/document`. A feature built on an unratified decision (an `Assumed` spec) stays flagged, but that never blocks `done`.
- **Pointer line** (`spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.
