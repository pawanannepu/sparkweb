# Verify: Stack and architecture · spec 0001 · updated 2026-11-21
_Steps derived from spec 0001 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [x] Visit `http://localhost:3000/` → sparkweb scaffold landing page renders with React 19 and Tailwind CSS styling → AC-1
- [x] Visit `http://localhost:3000/sandbox` → isolated preview runner renders with credentialless embedder policies → AC-2

## Commands
- [x] `pnpm run check-types` → all workspace packages (@spark/db, @spark/sandbox, @spark/shared, @spark/typescript-config, web) pass TypeScript check with zero errors → AC-1
- [x] `pnpm run build` → Turborepo builds production Next.js bundle cleanly in apps/web → AC-1
- [x] `curl -s -I http://localhost:3000/sandbox` → Cross-Origin-Embedder-Policy: credentialless and Cross-Origin-Opener-Policy: same-origin headers are present → AC-2

## Acceptance criteria coverage
- Empty scaffold boots locally and passes basic build checks: covered by check-types, build, and home page render
- Dedicated sandbox runner route with credentialless embedder policies: covered by sandbox route and header checks
