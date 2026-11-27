# 0009. One click publishing and isolated live hosting

**Date**: 2026-11-26
**Status**: Accepted

## Summary

This specification defines one click publishing and isolated live hosting for sparkweb generated applications. When a creator clicks Publish, an isolated server side build runner strips builder only editor scripts, compiles the saved snapshot into a static Vite and React bundle with client side PGlite (in browser WebAssembly PostgreSQL), and stores the compiled files in object storage. Publishing updates a live hostname route atomically so public visitors see a stable release while ongoing workspace edits stay safely inside the builder preview, with support for custom domains, automatic SSL certificates, rollback, and unpublish.

## Requirements

**User stories**:
- As a creator, I want to publish my application with one click from the builder top bar so that anyone can visit a persistent live web address.
- As a creator, I want my workspace edits and AI prompts to stay inside the preview until I click Publish again so that unfinished changes never break my live site.
- As a creator, I want to connect my own custom domain with clear DNS instructions and automatic SSL so that my published app runs under my own brand.
- As a creator, I want to roll back my live site to an earlier release or unpublish it anytime so that I can recover quickly from unwanted releases.
- As an operator, I want every published application built in a hardened sandbox and served from an isolated origin so that untrusted generated packages cannot leak secrets or builder session cookies.

**Acceptance criteria**:
- **AC-1**: Database schema migration adds `project_domains`, adds `projects.activeDeploymentId`, removes unique constraints from `deployments.subdomain` and `deployments.customDomain`, switches `deployments.snapshotId` to nullable with `on delete set null`, adds `artifactKey`, `buildDurationMs`, `errorMessage`, `trigger`, `promotedFromDeploymentId`, and `retiredAt` to `deployments`, and enforces single active deployment per project inside transactions.
- **AC-2**: Triggering `POST /api/projects/[id]/deployments` requires an authenticated owner session via `getCurrentUser` matching `projects.userId`, blocks concurrent builds for the same project (`409` Conflict), rejects projects with no saved snapshot (`422`), verifies server side via `checkActiveGeneration` and `snapshots.status !== 'exhausted'` (plus client `previewClean`) that no AI stream or unhealed error is active, auto seeds a unique platform subdomain from `projects.slug` on first publish, and returns `202` Accepted with the queued deployment record.
- **AC-3**: The server side isolated build runner writes the target snapshot files into an ephemeral temporary directory, strips builder only files (`plugins/spark-inspector.js`, `src/spark-inspector-client.ts`, `src/spark-db-bridge.ts`, and their imports and plugin registration), ensures `worker: { format: "es" }` and `base: "/"` so PGlite WebAssembly (`pglite.wasm`, `pglite.data`) and SPA routes bundle cleanly, runs `npm install --ignore-scripts` (backed by a shared local npm cache) and `vite build` inside a sanitized environment allowlist with a 120 second timeout and 50 MB compiled output limit, and captures stdout and stderr into `deployments.buildLogs`.
- **AC-4**: Compiled static bundle files (including PGlite WebAssembly assets) upload to the configured artifact store (`S3` compatible R2 storage or local filesystem in development) under `deployments/<projectId>/<deploymentId>/`, after which the deployment transitions atomically to `active`, marks any prior active deployment `retired`, updates `projects.activeDeploymentId`, and leaves the previous release live if the build fails.
- **AC-5**: Live routing updates push active hostname to `artifactKey` mappings to the configured hosting adapter (Cloudflare KV for production edge Workers, or local store for development) on publish, rollback, subdomain rename, custom domain verification, and unpublish, keeping subsequent workspace edits strictly isolated to the builder preview until published again.
- **AC-6**: Creators can manage subdomains and up to one custom domain (subdomain CNAME or apex A record) via `PATCH /api/projects/[id]/domain`, `POST /api/projects/[id]/domain/verify`, and `DELETE /api/projects/[id]/domain/custom`, with server side DNS TXT ownership pre checks (`dns/promises`), Cloudflare for SaaS custom hostname registration and automatic SSL status polling, and a 5 requests per minute rate limit on verify calls.
- **AC-7**: Creators can roll back the live URL to any prior successful deployment (`POST /api/projects/[id]/deployments/[deploymentId]/rollback`) by pointing the project's current `project_domains` hostnames in the hosting adapter to that deployment's stored `artifactKey` without rebuilding, or take the site offline (`POST /api/projects/[id]/deployments/unpublish`) so both subdomain and custom domain return `404` immediately.
- **AC-8**: Every live hosted response (both the Cloudflare Worker edge router and local `<subdomain>.localhost:3000` requests rewritten via Next.js middleware to the internal `/live/[subdomain]/[[...path]]` handler) serves assets from a separate origin isolated from `sparkweb` auth cookies, sets `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `X-Frame-Options: SAMEORIGIN`, and falls back to `index.html` for client side routes.
- **AC-9**: Deleting a project cleans up stored bundle artifacts and custom hostnames in the hosting provider before cascading database records, while `deleteSnapshot` rejects deletion (`409`) for any snapshot backing a `queued`, `building`, or `active` deployment.
- **AC-10**: The builder header (`BuilderShell`) provides a `Publish` button opening a compact popover with live status, copyable live URL, one click publish trigger, 1.5 second polling build progress and collapsible failure logs, recent deployment rollback and unpublish controls, and a custom domain setup and DNS verification dialog.

## Decision

**Chosen option**: Option 1: Isolated server side Vite build runner with object storage and Cloudflare for SaaS edge routing

We run production Vite builds inside an isolated server side temporary directory with lifecycle scripts disabled, upload compiled static bundles (including client side PGlite) to S3 compatible R2 object storage (with local disk fallback in development), and route platform subdomains plus verified custom domains through a Cloudflare Worker and Cloudflare for SaaS behind a pluggable `HostingAdapter` interface.

**Implementation skills**: `cloudflare` (`cloudflare/skills`, `.agents/skills/cloudflare/`) · `drizzle-orm-patterns` (`giuseppe-trisciuoglio/developer-kit`, `.agents/skills/drizzle-orm-patterns/`) · `next-dev-loop` (`vercel/next.js`, `.agents/skills/next-dev-loop/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md)

## Feature design

**Data model sketch**:

```
projects (updated)
  ...existing columns...
  activeDeploymentId: uuid (nullable, FK -> deployments.id on delete set null)

project_domains (new, 1:1 with projects)
  id: uuid (PK, default random)
  projectId: uuid (not null, unique, FK -> projects.id on delete cascade)
  subdomain: text (not null, unique)
  customDomain: text (nullable, unique)
  recordType: text (nullable) -- 'cname' | 'apex'
  verificationToken: text (nullable) -- e.g. 'spark-verify=<32-hex>'
  verificationStatus: text (not null, default 'unconfigured') -- 'unconfigured' | 'pending' | 'verified' | 'failed'
  sslStatus: text (not null, default 'unconfigured') -- 'unconfigured' | 'pending' | 'active' | 'failed'
  providerHostnameId: text (nullable) -- Cloudflare custom hostname ID
  failureReason: text (nullable)
  lastCheckedAt: timestamp (nullable)
  verifiedAt: timestamp (nullable)
  createdAt: timestamp (not null, default now)
  updatedAt: timestamp (not null, default now)

deployments (updated, 1:N with projects)
  id: uuid (PK, default random)
  projectId: uuid (not null, FK -> projects.id on delete cascade)
  snapshotId: uuid (nullable, FK -> snapshots.id on delete set null)
  subdomain: text (not null) -- non unique snapshot copy of subdomain at deploy time
  customDomain: text (nullable) -- non unique snapshot copy of customDomain at deploy time
  status: text (not null, default 'queued') -- 'queued' | 'building' | 'active' | 'failed' | 'retired'
  deploymentUrl: text (not null)
  artifactKey: text (nullable) -- e.g. 'deployments/<projectId>/<deploymentId>'
  buildLogs: text (nullable)
  buildDurationMs: integer (nullable)
  errorMessage: text (nullable)
  trigger: text (not null, default 'manual') -- 'manual' | 'rollback'
  promotedFromDeploymentId: uuid (nullable, FK -> deployments.id on delete set null)
  retiredAt: timestamp (nullable)
  createdAt: timestamp (not null, default now)
  updatedAt: timestamp (not null, default now)
```

**State transitions**:

Deployment lifecycle:
```
[queued] -> [building] -> [active] -> [retired] (on newer cutover, rollback, or unpublish)
                       -> [failed]  (prior active deployment remains live)
```

Custom domain verification lifecycle:
```
[unconfigured] -> [pending] -> [verified]
                            -> [failed] (user retries verify -> [pending])
```

Custom domain SSL lifecycle (begins once TXT ownership passes):
```
[unconfigured] -> [pending] -> [active]
                            -> [failed]
```

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/projects/[id]/deployments` | GET | `limit?: number`, `cursor?: string` | `{ domain, activeDeployment, items, nextCursor }` | Owner | `401`, `403`, `404` |
| `/api/projects/[id]/deployments` | POST | `snapshotId?: uuid`, `previewClean: boolean (req)`, `isStreaming: boolean (req)` | `202` `{ deployment, domain }` | Owner | `401`, `403`, `404`, `409` build in progress or unhealed preview, `422` no snapshot |
| `/api/projects/[id]/deployments/[deploymentId]` | GET | path params | `{ deployment }` (status, logs, duration, errorMessage) | Owner | `401`, `403`, `404` |
| `/api/projects/[id]/deployments/[deploymentId]/rollback` | POST | path params | `{ deployment, activeDeploymentId }` | Owner | `401`, `403`, `404`, `409` build running, `422` missing artifactKey |
| `/api/projects/[id]/deployments/unpublish` | POST | path param `id` | `{ unpublished: true }` | Owner | `401`, `403`, `404`, `409` build running |
| `/api/projects/[id]/domain` | PATCH | `subdomain?: string`, `customDomain?: string` | `{ domain, dnsInstructions }` | Owner | `401`, `403`, `409` taken, `422` invalid or reserved host |
| `/api/projects/[id]/domain/verify` | POST | path param `id` | `{ domain }` (updated verification and SSL state) | Owner | `401`, `403`, `404`, `429` rate limited (5 per min) |
| `/api/projects/[id]/domain/custom` | DELETE | path param `id` | `{ domain }` (custom domain cleared) | Owner | `401`, `403`, `404` |
| `/live/[subdomain]/[[...path]]` | GET | path params (internal Next.js middleware rewrite target for `*.localhost:3000`; direct non subdomain hits redirect to `http://<subdomain>.localhost:3000`) | Static bundle asset or `index.html` SPA fallback | Public | `404` site not found or unpublished |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Trigger publish | `snapshotId` | Input param `snapshotId` if provided, else `projects.currentSnapshotId` |
| Trigger publish | `subdomain` | Existing `project_domains.subdomain`, or auto seeded from `projects.slug` with random suffix on conflict |
| Trigger publish | `deploymentUrl` | Derived from `project_domains.customDomain` when `verificationStatus === 'verified'` and `sslStatus === 'active'`, else `https://${subdomain}.${PLATFORM_DOMAIN}` (or `http://${subdomain}.localhost:3000` in dev) |
| Trigger publish | Generation and health guard | Server side `checkActiveGeneration(db, { projectId })` and `snapshots.status !== 'exhausted'`, combined with client `previewClean` and `isStreaming` inputs |
| Rollback deployment | `deploymentUrl`, `subdomain`, `customDomain` | Read from the project's current `project_domains` row so domain renames remain intact when promoting an older `artifactKey` |
| Build runner | `buildLogs`, `buildDurationMs`, `errorMessage` | Captured stdout and stderr, elapsed `Date.now()` delta, and sanitized failure message from isolated `vite build` subprocess |
| Build upload | `artifactKey` | Deterministic object key `deployments/${projectId}/${deploymentId}` computed before upload |
| Cutover and rollback | `activeDeploymentId` and KV route entry | Set inside PostgreSQL transaction and pushed to `HostingAdapter.putRoute(hostname, { deploymentId, projectId, artifactKey })` |
| Save custom domain | `recordType` | Derived from hostname label count (`split('.').length === 2` or apex flag -> `'apex'`, else `'cname'`) |
| Save custom domain | `verificationToken` | Generated server side via `crypto.randomBytes(16).toString("hex")` prefixed with `spark-verify=` |
| Save custom domain | `dnsInstructions` | Computed from `recordType`, `verificationToken`, `PLATFORM_CNAME_TARGET`, and `PLATFORM_APEX_IP` |
| Verify custom domain | `verificationStatus`, `sslStatus`, `failureReason`, `lastCheckedAt`, `verifiedAt` | Server side `dns/promises` TXT + CNAME/A lookup combined with `HostingAdapter.syncCustomHostname()` |

**Key invariants**:
- At most one deployment per project has `status = 'active'`, kept consistent with `projects.activeDeploymentId` inside a single PostgreSQL transaction.
- Only one deployment per project may be in `queued` or `building` state at any moment; concurrent publish requests return `409` Conflict.
- Failed builds never alter `projects.activeDeploymentId` or live KV route mappings; the previous active release continues serving uninterrupted.
- Production builds strip `plugins/spark-inspector.js`, `src/spark-inspector-client.ts`, and `src/spark-db-bridge.ts` (plus their imports in `src/main.tsx` and plugin hook in `vite.config.ts`) and ensure `worker: { format: "es" }` and `base: "/"` before running `vite build`.
- `npm install --ignore-scripts` runs inside an isolated temp directory (using a shared read through npm cache directory) with a stripped environment allowlist (`PATH`, `HOME`, `NODE_ENV=production`), a 120 second hard timeout, and a 50 MB compiled output limit (accommodating the ~15 MB PGlite WASM and data assets).
- Rollback never mutates workspace snapshots or branches; it promotes a previous `artifactKey` directly in `HostingAdapter` under the project's current `project_domains` hostnames and records a new `active` deployment with `trigger = 'rollback'` and `promotedFromDeploymentId`.
- Custom domain hostnames reject platform owned suffixes (`*.${PLATFORM_DOMAIN}`), `localhost`, private IP literals, and already claimed domains (`409` Conflict).
- Deleting a project removes stored artifacts and Cloudflare custom hostnames before deleting PostgreSQL rows, while `deleteSnapshot` blocks deleting any snapshot referenced by a `queued`, `building`, or `active` deployment.

**Security model**:
- **Tenant ownership**: Every `/api/projects/[id]/deployments*` and `/api/projects/[id]/domain*` handler resolves `getCurrentUser(req)` (`401` if unauthenticated) and enforces `projects.userId === user.id` (`403` if mismatched). Note that `apps/web/src/lib/auth.ts` currently includes a local development demo user fallback and `x-user-id` header override, which must be replaced with strict Auth.js session validation before multi tenant production launch.
- **Origin isolation**: Live published applications run on distinct subdomains (`<subdomain>.sparkapps.dev` or `<subdomain>.localhost:3000`) or custom domains, never on the `sparkweb` builder origin, isolating Auth.js session cookies, `localStorage`, and visitor PGlite IndexedDB storage per origin.
- **HTTP security headers**: Live responses always include `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`, and immutable cache headers on hashed `/assets/*` files (`Cache-Control: public, max-age=31536000, immutable`) with `no-cache` on `index.html`.
- **Build sandbox hardening**: Build processes forbid lifecycle scripts (`--ignore-scripts`), strip host secrets from `process.env`, sanitize file paths against directory traversal (`..`) when writing snapshot files to temp disk, and remove the temp directory in a `finally` block.
- **Domain hijacking prevention**: Custom domains require a valid TXT record at `_sparkweb-verify.<customDomain>` matching `project_domains.verificationToken` before registering or routing live traffic.
- **Abuse controls**: DNS verification endpoints enforce a 5 requests per minute per project limit (`429` Too Many Requests).

**Configuration required**:
- `PLATFORM_DOMAIN`: Base wildcard domain for published apps (default `sparkapps.dev`; `localhost:3000` in local dev)
- `PLATFORM_CNAME_TARGET`: Target hostname creators point custom CNAME records to (e.g., `edge.sparkapps.dev`)
- `PLATFORM_APEX_IP`: Fallback IPv4 address for apex custom domains (e.g., Cloudflare for SaaS Anycast IP)
- `ARTIFACT_STORAGE_DRIVER`: Storage backend selector (`local` | `s3`, defaults to `local` in development)
- `S3_ENDPOINT`: S3 compatible object storage endpoint (Cloudflare R2 endpoint)
- `S3_BUCKET`: Bucket name storing compiled static deployment bundles
- `S3_ACCESS_KEY_ID`: Object storage access key
- `S3_SECRET_ACCESS_KEY`: Object storage secret key
- `HOSTING_DRIVER`: Edge routing driver (`local` | `cloudflare`, defaults to `local` in development)
- `CLOUDFLARE_API_TOKEN`: Cloudflare API token scoped to Zone Custom Hostnames and Workers KV Write
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID for KV operations
- `CLOUDFLARE_ZONE_ID`: Cloudflare zone ID owning `PLATFORM_DOMAIN` for Custom Hostnames API
- `CLOUDFLARE_KV_NAMESPACE_ID`: Workers KV namespace ID storing `host:<hostname>` route pointers

**Critical test scenarios**:
- Happy path: Clicking Publish on a project with a clean snapshot triggers an isolated build stripping `spark-inspector-client` and `spark-db-bridge`, uploads `dist/` to artifact storage, promotes the deployment to `active`, updates the host route, and serves the app over the live URL while later preview edits remain unpublished, verifies **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-8**, **AC-10**
- Concurrent publish lock: Firing a second `POST /api/projects/[id]/deployments` while status is `queued` or `building` returns `409` Conflict without starting a duplicate build, verifies **AC-2**
- Failed build preservation: Publishing code with a TypeScript or Vite syntax error marks the new deployment `failed` with captured `buildLogs` while keeping the previous active deployment live, verifies **AC-3**, **AC-4**
- Rollback and unpublish: Rolling back to a prior retired deployment updates the live route mapping to the old `artifactKey` without running a build, and unpublishing removes the route mapping so requests return `404`, verifies **AC-5**, **AC-7**
- Subdomain rename while live: Renaming a project subdomain atomically swaps the active route mapping to the new subdomain and causes the old subdomain to return `404`, verifies **AC-5**, **AC-6**
- Custom domain hijacking and rate limit: Attempting to verify a custom domain without the matching TXT record fails cleanly with instructions, and exceeding 5 verify calls in one minute returns `429`, verifies **AC-6**
- Auth and tenant isolation: Unauthenticated requests receive `401`, non owner requests receive `403`, and live app responses carry no `sparkweb` session cookies plus strict security headers, verifies **AC-2**, **AC-8**
- Project delete and snapshot guard: Deleting a project clears its stored artifacts and provider custom hostname, while `deleteSnapshot` returns `409` if the snapshot backs an active deployment, verifies **AC-9**

## Build plan

1. Update Drizzle schema in `packages/db/src/schema/` (`project-domains.ts`, `deployments.ts`, `projects.ts`), generate migration, and implement transactional deployment, domain, and active deployment queries with unit tests, satisfies **AC-1**, **AC-9**
2. Build shared publishing contracts in `packages/shared` and implement the isolated server side Vite build runner (builder script stripping, `worker: { format: "es" }`, `base: "/"`, `--ignore-scripts`, shared npm cache, sanitized env, 120s timeout, 50 MB cap) plus `ArtifactStore` (`LocalFsArtifactStore` and `S3ArtifactStore` for R2) in a dedicated publishing service module, satisfies **AC-3**, **AC-4**
3. Implement `HostingAdapter` (`LocalDevHostingAdapter` and `CloudflareSaasHostingAdapter`), Next.js `*.localhost:3000` host middleware plus `/live/[subdomain]/[[...path]]` static handler with security headers, and the Cloudflare Worker edge router package, satisfies **AC-5**, **AC-8**
4. Implement deployment API routes (`GET/POST /api/projects/[id]/deployments`, `GET .../deployments/[deploymentId]`, `POST .../rollback`, `POST .../unpublish`) with Auth.js ownership checks, streaming/error guards, concurrency lock, and async build execution, satisfies **AC-2**, **AC-4**, **AC-7**
5. Implement domain management and verification API routes (`PATCH /api/projects/[id]/domain`, `POST .../verify`, `DELETE .../custom`) with DNS TXT pre checks (`dns/promises`), Cloudflare Custom Hostname sync, 5/min rate limiter, and project deletion cleanup hooks, satisfies **AC-6**, **AC-9**
6. Build the `Publish` top bar trigger in `BuilderShell`, `PublishPopover` (1.5s polling status, live URL copy, build logs, history rollback, and unpublish), and `CustomDomainDialog` (subdomain editor, CNAME/apex DNS setup instructions, and verify trigger) with component and Playwright tests, satisfies **AC-10**

## Consequences

**Positive**:
- Live sites serve static bundles directly from edge storage and Workers KV with zero ongoing compute cost per published application and instant atomic cutover or rollback
- Visitor databases remain isolated per browser via client side PGlite, matching the existing starter template with zero server database provisioning overhead
- Builder drafts, visual inspector overlays, and PGlite debug bridges never leak onto public live URLs
- Pluggable `ArtifactStore` and `HostingAdapter` interfaces make full end to end publishing testable locally on `*.localhost:3000` with zero external cloud accounts

**Negative / tradeoffs**:
- Server side `npm install --ignore-scripts` and `vite build` run in an ephemeral OS temp directory, so high traffic multi tenant scale will later require moving builds into isolated microVMs or containers (for example Docker or gVisor workers)
- Generated applications that add custom Node.js backend API routes cannot run on pure static asset hosting until a follow on container runtime adapter is added
- Production custom domain SSL requires configuring a Cloudflare for SaaS zone, R2 bucket, and KV namespace ahead of launch

**Neutral**:
- Existing `createDeployment` helper and tests in `packages/db` must update to match the new `project_domains` separation and non unique `deployments.subdomain` column

## Follow-up

- [ ] Replace the local development demo user fallback and `x-user-id` header override in `apps/web/src/lib/auth.ts` with strict Auth.js session enforcement before multi tenant production launch
- [ ] Provision production Cloudflare resources (`PLATFORM_DOMAIN` zone with Cloudflare for SaaS enabled, R2 bucket, Workers KV namespace, and edge router Worker deployment) before enabling `HOSTING_DRIVER=cloudflare`
- [ ] Capture `cloudflare` skill (`cloudflare/skills`, `.agents/skills/cloudflare/`) conventions in a nested publishing area `AGENTS.md` once the publishing module directory is created during build
- [ ] Optional MCP server skipped during design (`cloudflare-mcp` or the Cloudflare Marketplace plugin `antigravity-plugins-partners/plugin/cloudflare`) can be connected later for live Cloudflare Workers, KV, and R2 inspection
- [ ] Update the `Live Publishing` row in `docs/specs/0001-stack-and-architecture/index.md` to note static Cloudflare Workers plus R2 hosting alongside future container support
