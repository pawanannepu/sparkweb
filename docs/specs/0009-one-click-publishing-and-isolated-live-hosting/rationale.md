# 0009. Rationale: One click publishing and isolated live hosting

## Context

> ⚠️ Premise note: Spec 0001 sketched Fly.io or Railway container hosting for live publishing, whereas the implemented starter template generates client side Vite, React, and PGlite WebAssembly applications with no backend server process. This spec therefore targets static bundle compilation and isolated edge hosting for the current client side architecture, keeping a pluggable `HostingAdapter` boundary if server side Node apps are introduced later.

Creators using sparkweb iterate rapidly inside an in browser WebContainer preview where the visual canvas inspector, database viewer bridge, and AI streaming pipeline interact directly with live code. Exposing that preview directly to public visitors would break live sites whenever the creator prompts a new change or triggers a compile error, and would risk leaking builder tooling onto public URLs.

The platform also needs every published application to run on its own persistent web address with custom domain support and automatic SSL certificates, while protecting the `sparkweb` host origin from untrusted user or AI generated JavaScript. Any solution must work cleanly both in self hosted or local development setups and in production multi tenant hosting, without incurring idle container bills for every published hobby project.

Finally, the existing `deployments` table from spec 0002 stored unique `subdomain` and `customDomain` columns directly on every deployment row, which blocks keeping release history for rollback or performing zero downtime cutovers across multiple publishes.

## Options considered

### Option 1: Isolated server side Vite build runner with object storage and Cloudflare for SaaS edge routing

Run `vite build` on the server from the target snapshot in an ephemeral temp directory (stripping builder only plugins and disabling npm lifecycle scripts), upload the compiled `dist` files to S3 compatible R2 storage, and serve wildcard subdomains plus verified custom domains through a Cloudflare Worker reading route mappings from Workers KV, backed by Cloudflare for SaaS for automatic SSL certificates.

**Pros**:
- Zero idle server cost per published application and fast global static delivery from edge object storage
- Atomic zero downtime cutovers and instant non destructive rollbacks by updating a single KV route pointer
- Handles subdomain CNAMEs, apex domains, TXT verification, and automated SSL issuance natively through Cloudflare for SaaS
- Local `LocalDevHostingAdapter` and `LocalFsArtifactStore` let developers build and verify the entire flow on `localhost` without cloud credentials

**Cons**:
- Supports static client side Vite and PGlite apps only; full stack Node backends would need a separate container adapter later
- Requires configuring Cloudflare for SaaS, an R2 bucket, and a KV namespace in production
- Server side `npm install` shares the host OS kernel until moved into a dedicated container or microVM build worker

### Option 2: Self hosted Caddy reverse proxy with on demand TLS and S3 storage

Run the same server side Vite build runner and S3 object storage, but terminate wildcard subdomains and custom domain ACME SSL certificates inside a self hosted Caddy proxy querying a Next.js domain verification endpoint.

**Pros**:
- Fully open source with zero dependency on Cloudflare for SaaS pricing or account tiers
- Simple single origin operational model when deploying sparkweb onto a dedicated VPS or Kubernetes cluster

**Cons**:
- Requires operating and scaling a stateful Caddy proxy cluster with shared certificate storage across instances
- Lacks global CDN caching and DDoS absorption out of the box compared to an edge Worker

### Option 3: Dedicated container per published app on Fly.io or Railway

Package every published snapshot into an isolated Docker container running Vite preview or a static server on Fly.io Machines or Railway, using their platform domain APIs for custom hostnames and SSL.

**Pros**:
- Strong OS level isolation per published application and ready out of the box if backend Node servers are added later

**Cons**:
- Charges ongoing compute or cold start latency for static React and PGlite bundles that need no server runtime
- Slower deploy and rollback cycles caused by container image builds and machine provisioning

### Option 4: Client side WebContainer production build uploaded from the browser

Execute `vite build` inside the creator's already booted browser WebContainer and upload the resulting `dist` archive from the client to object storage.

**Pros**:
- Offloads build CPU and dependency installation entirely onto the creator's browser

**Cons**:
- Fails if the user closes their browser tab mid publish, cannot run server verified builds for rollbacks or automated checks, and lets a modified client upload arbitrary unverified files

## Rationale

Option 1 fits both the current generated application runtime and sparkweb's operational constraints. Because generated apps today are Vite, React, Tailwind, and browser local PGlite bundles, packaging them into static assets rather than long lived containers eliminates per app idle compute costs while making rollbacks instantaneous by swapping an `artifactKey` pointer.

Running the build on the server instead of inside the creator's WebContainer ensures deterministic `buildLogs`, prevents client bundle tampering, and isolates untrusted `package.json` dependencies via `--ignore-scripts` and a stripped environment. Separating `project_domains` from `deployments` fixes the existing unique constraint conflict in spec 0002 so projects maintain clean release history and atomic cutovers, while Cloudflare for SaaS paired with Workers KV keeps live hosted sites online and completely isolated from `sparkweb` application restarts or user cookies.
