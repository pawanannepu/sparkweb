# 0001. Stack and architecture rationale

## Context

sparkweb is an application creation platform where creators describe applications in natural language and receive working, full stack software. The platform balances several demanding architectural forces:

First, preview execution must feel instantaneous to keep the creative loop interactive. Running remote cloud container virtual machines for every transient user preview incurs heavy hosting costs, introduces cold boot delays of two to ten seconds, and creates complex server lifecycle management.

Second, in browser WebContainers execute Node.js inside WebAssembly with virtual file systems and virtual HTTP networking, but they have no raw TCP sockets and cannot run native Linux PostgreSQL daemons or native C++ binaries. In browser full stack applications require an embedded WebAssembly database (PGlite) that provides true PostgreSQL compatibility entirely in memory.

Third, cross origin isolation headers (Cross-Origin-Embedder-Policy and Cross-Origin-Opener-Policy) required by WebContainers break OAuth popups (such as GitHub and Google sign in via Auth.js) and block third party avatar images when applied globally to the main builder application. The preview runtime must reside in a dedicated sandbox runner route with credentialless embedder policies, keeping the host workspace unconstrained.

Fourth, development workflows in Next.js App Router re-execute server code on hot module reloading, which exhausts PostgreSQL connections unless client connections are managed through a global singleton pattern in a dedicated database package.

Fifth, component generation stability requires pinning proven styling dependencies. Tailwind CSS v4 introduces breaking configuration shifts that create compatibility friction with standard shadcn/ui component CLI patterns and Radix primitives; pinning Tailwind CSS v3.4 ensures consistent code generation across all builder slices.

Consequences of not settling these boundaries include broken authentication flows, frequent preview crashes from missing TCP sockets, connection pool exhaustion during development, and inconsistent component generation.

## Options considered

### Option 1: Next.js Turborepo monorepo with in browser WebContainers, PGlite, and Drizzle ORM

A structured monorepo separating the web workspace (apps/web), preview runtime abstractions (packages/sandbox), database schemas and client singleton (packages/db), and shared protocol contracts (packages/shared). The host application uses Next.js App Router with React 19, Tailwind CSS v3.4, and shadcn/ui. The live preview executes inside an isolated sandbox runner using WebContainers, with PGlite providing client side WebAssembly PostgreSQL persistence. Data persists in PostgreSQL via Drizzle ORM, with Auth.js managing self hosted authentication and content addressable trees tracking file versions.

**Pros**:
- Zero server execution cost for live previews because Node.js, Vite, and PGlite execute client side in browser WebAssembly
- Instant sub second boot times with local virtual file system read and write speeds
- Dedicated sandbox runner isolates cross origin headers, protecting Auth.js OAuth popups and external avatar images
- PGlite delivers authentic PostgreSQL syntax and relational capabilities inside the browser without remote database servers
- Clean package boundaries prevent connection leaks and isolate database migrations within packages/db

**Cons**:
- WebContainers remain subject to browser tab memory caps on mobile devices
- Native C++ compiled packages require pure JavaScript or WebAssembly replacements
- Requires initial setup of Turborepo workspace pipelines and shared configuration packages

### Option 2: Standalone Next.js application with cloud container sandboxes and Prisma ORM

A single application directory running all builder pages and API routes together, delegating user application previews to remote cloud container microVMs (such as E2B or isolated Docker instances) coordinated via server side APIs, with Prisma ORM for data persistence.

**Pros**:
- Unrestricted Linux container capability supporting native binaries, Python, Go, and real system services
- Familiar single directory structure with minimal initial repository setup
- Standard browser compatibility without requiring strict cross origin isolation headers

**Cons**:
- High ongoing cloud infrastructure bills for running idle or active preview VMs per user
- Noticeable cold start delays (two to ten seconds) whenever a user boots or resumes a preview
- Complex server side session management, proxy routing, and zombie container reclamation

### Option 3: Decoupled Vite SPA with separate Fastify API and Sandpack client bundler

A client only React single page application built with Vite, communicating over REST and WebSockets with an independent Node.js Fastify backend service, using CodeSandbox Sandpack for in browser code bundling.

**Pros**:
- Fast local frontend development with zero server side rendering complexity
- Lightweight client bundling through browser memory modules
- Independent scaling of backend API workers from frontend static asset hosting

**Cons**:
- Sandpack lacks a complete in browser Node.js runtime and cannot execute backend Express or database servers
- Two independent services increase deployment and local coordination complexity
- Client side single page applications lose initial server render performance and SEO for landing surfaces

## Rationale

Option 1 provides the optimal foundation for sparkweb. Running the execution sandbox client side in WebContainers (basis: StackBlitz WebContainers) completely eliminates cloud compute costs for transient generation previews while achieving sub second boot times that cloud VMs cannot match.

Hosting the WebContainer preview within an isolated runner route using credentialless embedder policies resolves the cross origin dilemma: the preview gains WebAssembly SharedArrayBuffer capabilities while the main builder UI preserves standard window openers for Auth.js OAuth popups and unrestricted external image loading (basis: defense in depth and browser origin isolation).

PGlite solves the in browser full stack database dilemma (basis: relational integrity in client runtimes). Because WebContainers lack raw TCP networking, standard PostgreSQL daemons cannot run; PGlite compiles PostgreSQL into WebAssembly and runs it directly within the client preview tab, giving generated applications authentic relational tables, SQL queries, and ACID guarantees without remote database dependencies.

In packages/db, wrapping Drizzle ORM and postgres.js in a globalThis singleton prevents connection pool leaks during Next.js App Router hot module reloading. Pinning Tailwind CSS v3.4 guarantees seamless integration with shadcn/ui components and Radix primitives during automated code generation.

## References

**Project sources**:
- `docs/scope/scope.md`: sparkweb vision, Tracer Bullet delivery approach, and WebContainers runtime reference
- `.agents/skills/turborepo/`: Turborepo monorepo task pipelines and caching conventions
- `.agents/skills/next-dev-loop/`: Next.js App Router and dev loop best practices

**Practices & standards**:
- `Tracer Bullet development`: vertical slice delivery proving all architectural boundaries end to end
- `Boring technology principle`: choosing mature, proven tools with clear operational boundaries
- `Content addressable storage`: Git style file hashing for efficient version diffing and snapshot rollback
- `Credentialless embedder isolation`: modern web standard for WebAssembly execution without subresource CORS breakage
- `Database connection singleton`: preserving connection limits across serverless and hot reloading runtimes

**Links**:
- StackBlitz WebContainers Documentation: https://webcontainers.io
- Vercel AI SDK Documentation: https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQF8Fs6hlND3TbKxYc4ehKNLdUaCRLQOK6XXqnL3-9u9kx_8RyyPWUMRgwfUvQzPYmnoqeWE7XHmEAFEnBSiQN2_CIl99xLHabCKaRSS7uBMuM6CEqlCoQ==
- Turborepo Documentation: https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEpsMyXLv7r01nu718mXwSy09dPiYgIYNs5haAKNf0fnnSbe_43i2GX5e3QC5PFt8upO38u_v_hfH4i5stVuihqZ3-jHlOxfoDsNyZiLN3tDDX4LCAksDyeSiEFA5GLxohBnRMb4lfMTMXfh76-gBtqlw==
