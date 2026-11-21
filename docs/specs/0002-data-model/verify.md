# Verify: data model · spec 0002 · updated 2026-11-22
_Steps derived from spec 0002 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## Commands
- [x] `pnpm --filter @spark/db check-types` → TypeScript compilation succeeds with zero errors → AC-1
- [x] `pnpm --filter @spark/db test` → all schema, crypto, and PGlite database integration test suites pass → AC-1, AC-2, AC-3, AC-4, AC-5, AC-6
- [x] `pnpm --filter @spark/db lint` → Biome lint and format checks run clean → AC-1
- [x] `pnpm --filter @spark/db db:generate` → Drizzle Kit detects clean schema and creates migration scripts without syntax errors → AC-6

## Behavioral and Value Sourcing Checks
- [x] Save user API key: verify keyHint derives from vendor prefix and last four characters without leaking raw secret → AC-2
- [x] Save user API key: verify encryptedKey, iv, and authTag are computed using AES 256 GCM, and tampered authTag rejects decryption → AC-2
- [x] Save snapshot: verify treeHash is computed deterministically via SHA 256 over canonically sorted file paths and UTF 8 contents → AC-3
- [x] Save snapshot: verify projects currentSnapshotId pointer advances to the newly created snapshot id in the same transaction → AC-3
- [x] Record prompt message: verify message sequence number seq increments strictly as COALESCE(MAX(seq), 0) + 1 per thread → AC-1
- [x] Create project: verify project slug derives from name in clean URL format and appends collision suffix when slug already exists for user → AC-5
- [x] Create deployment: verify deploymentUrl is constructed cleanly from subdomain and PLATFORM_DOMAIN environment variable → AC-1
- [x] Teardown protection: verify deleting a snapshot that backs an active deployment throws SnapshotInActiveDeploymentError conflict → AC-4
- [x] Cascading deletion: verify deleting a user or project cleanly cascades deletion to prompt threads, messages, snapshots, and deployments without foreign key deadlocks → AC-4
- [x] Projection performance: verify getProjectSnapshots history listing query omits the heavy files JSONB column to prevent memory exhaustion → AC-3

## Acceptance criteria coverage
- AC-1 (Relational schema tables and types): covered by check-types command, vitest schema suite, and record prompt message sequence check
- AC-2 (Encrypted provider keys and key hints): covered by crypto unit tests and saveUserApiKey value sourcing test
- AC-3 (Content addressable tree hash and snapshot lineage): covered by computeSnapshotTreeHash tests and saveSnapshot verification
- AC-4 (Cascading teardown and active deployment snapshot protection): covered by deleteSnapshot conflict check and project removal cascade test
- AC-5 (Project slug derivation and collision handling): covered by createProject tests with duplicate names
- AC-6 (Database migrations on PostgreSQL and PGlite): covered by db:generate check and PGlite migration runner test suite
