# 0002. Data model

**Date**: 2026-11-22
**Status**: In Progress

## Summary

This specification defines the foundational relational data model for sparkweb in PostgreSQL using Drizzle ORM. We implement a hybrid relational schema with Auth.js identity tables, encrypted personal provider API keys with authentication tags, project workspaces, prompt generation threads with sequentially ordered messages, immutable content addressable code snapshots storing virtual file trees as JSONB, and published deployment targets. Foreign key constraints enforce clean cascading deletion for workspaces while domain logic protects snapshots backing active live deployments.

## Requirements

**User stories**:
- As a creator, I want my projects, prompt conversation history, and code snapshots preserved reliably so that I can resume building, review previous steps, and roll back changes without losing work.
- As a developer, I want to securely configure my own provider API keys (OpenAI, Anthropic, Gemini, Groq) so that my credentials remain encrypted at rest and never leak to client code.
- As an operator, I want immutable snapshot file trees and deployment states recorded with referential integrity so that live published web applications never break when drafts are edited.

**Acceptance criteria**:
- **AC-1**: PostgreSQL database schema declares relational tables for users, accounts, sessions, verification tokens, personal api keys, projects, prompt threads, prompt messages, snapshots, and deployments using Drizzle ORM pgTable declarations with strict TypeScript types and named exports.
- **AC-2**: Personal API keys table enforces a unique constraint on user identifier and provider, and stores provider keys as AES 256 GCM encrypted ciphertext with initialization vectors and authentication tags, never exposing plain secrets in database records.
- **AC-3**: Snapshots table records an immutable content addressable tree hash, parent snapshot identifier for lineage and rollback, branch name defaulting to main, and a JSONB virtual file system map of relative file paths to content objects.
- **AC-4**: Foreign key constraints enforce clean cascading deletion when a user or project is removed, while application domain logic prevents deleting snapshots that back an active live deployment.
- **AC-5**: Projects table enforces uniqueness on user identifier and project slug, supports automatic slug derivation with collision suffixing, and includes template cloning flags (isTemplate boolean and forkedFromProjectId pointer) to support starter templates and project remixing.
- **AC-6**: Automated database migration files generated through drizzle-kit apply cleanly against PostgreSQL and local PGlite without schema drift or broken foreign key constraints.

## Decision

**Chosen option**: Option 1: Hybrid relational schema with JSONB virtual file trees, AES 256 GCM encrypted personal API keys with authentication tags, and directed snapshot lineage

We establish a comprehensive relational database schema in packages/db using Drizzle ORM that pairs strict relational foreign keys for identity, workspaces, prompt threads, and deployments with a high performance JSONB virtual file tree for code snapshots.

**Implementation skills**: `drizzle-orm-patterns` (`giuseppe-trisciuoglio/developer-kit`, `.agents/skills/drizzle-orm-patterns/`)

## Rationale

Reasoning and options: see rationale.md

## Feature design

**Data model sketch**:

```
users (Auth.js)
  id: uuid (PK, default random)
  name: text (nullable)
  email: text (not null, unique)
  emailVerified: timestamp (nullable)
  image: text (nullable)
  createdAt: timestamp (not null, default now)
  updatedAt: timestamp (not null, default now)

accounts (Auth.js standard composite key)
  userId: uuid (not null, FK -> users.id on delete cascade)
  type: text (not null)
  provider: text (not null)
  providerAccountId: text (not null)
  refresh_token: text (nullable)
  access_token: text (nullable)
  expires_at: integer (nullable)
  token_type: text (nullable)
  scope: text (nullable)
  id_token: text (nullable)
  session_state: text (nullable)
  PRIMARY KEY (provider, providerAccountId)

sessions (Auth.js)
  sessionToken: text (PK, not null)
  userId: uuid (not null, FK -> users.id on delete cascade)
  expires: timestamp (not null)

verification_tokens (Auth.js)
  identifier: text (not null)
  token: text (not null)
  expires: timestamp (not null)
  PRIMARY KEY (identifier, token)

api_keys
  id: uuid (PK, default random)
  userId: uuid (not null, FK -> users.id on delete cascade)
  provider: text (not null)  -- 'openai', 'anthropic', 'gemini', 'groq'
  encryptedKey: text (not null)  -- AES 256 GCM ciphertext (hex)
  keyHint: text (not null)  -- e.g. 'sk-...1234'
  iv: text (not null)  -- 12 byte initialization vector (hex)
  authTag: text (not null)  -- 16 byte authentication tag (hex)
  createdAt: timestamp (not null, default now)
  updatedAt: timestamp (not null, default now)
  CONSTRAINT: unique (userId, provider)

projects
  id: uuid (PK, default random)
  userId: uuid (not null, FK -> users.id on delete cascade)
  name: text (not null)
  description: text (nullable)
  slug: text (not null)
  isTemplate: boolean (not null, default false)
  forkedFromProjectId: uuid (nullable, FK -> projects.id on delete set null)
  currentSnapshotId: uuid (nullable, FK -> snapshots.id on delete set null)
  createdAt: timestamp (not null, default now)
  updatedAt: timestamp (not null, default now)
  CONSTRAINT: unique (userId, slug)

prompt_threads
  id: uuid (PK, default random)
  projectId: uuid (not null, FK -> projects.id on delete cascade)
  title: text (not null, default 'Main thread')
  createdAt: timestamp (not null, default now)
  updatedAt: timestamp (not null, default now)

prompt_messages
  id: uuid (PK, default random)
  threadId: uuid (not null, FK -> prompt_threads.id on delete cascade)
  seq: integer (not null)  -- strictly increasing message sequence order per thread
  role: text (not null)  -- 'user', 'assistant', 'system'
  content: text (not null)
  toolCalls: jsonb (nullable)  -- planner steps, file modifications, error repairs
  snapshotId: uuid (nullable, FK -> snapshots.id on delete set null)
  status: text (not null, default 'completed')  -- 'pending', 'streaming', 'completed', 'failed'
  createdAt: timestamp (not null, default now)
  CONSTRAINT: unique (threadId, seq)

snapshots
  id: uuid (PK, default random)
  projectId: uuid (not null, FK -> projects.id on delete cascade)
  parentId: uuid (nullable, FK -> snapshots.id on delete set null)
  branchName: text (not null, default 'main')
  treeHash: text (not null)  -- SHA 256 of sorted paths and contents
  files: jsonb (not null)  -- Record<string, { content: string, isBinary?: boolean }>
  message: text (nullable)  -- generation prompt summary or edit description
  createdAt: timestamp (not null, default now)

deployments
  id: uuid (PK, default random)
  projectId: uuid (not null, FK -> projects.id on delete cascade)
  snapshotId: uuid (not null, FK -> snapshots.id on delete cascade)
  subdomain: text (not null, unique)
  customDomain: text (nullable, unique)
  status: text (not null, default 'queued')  -- 'queued', 'building', 'active', 'failed', 'retired'
  deploymentUrl: text (not null)
  buildLogs: text (nullable)
  createdAt: timestamp (not null, default now)
  updatedAt: timestamp (not null, default now)
```

**State transitions**:

Deployments lifecycle:
```
[queued] -> [building] -> [active]
                       -> [failed]
[active] -> [retired]
```

Prompt message execution lifecycle:
```
[pending] -> [streaming] -> [completed]
                         -> [failed]
```

**API surface**:

Domain query and mutation functions exported from packages/db:

| Function | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| createProject | Mutation | userId: uuid, name: text, slug?: text, isTemplate?: boolean, forkedFromProjectId?: uuid | Project record | Owner | 404 template not found |
| getProjectWithCurrentSnapshot | Query | projectId: uuid, userId: uuid | Project, active snapshot with files, thread count | Owner | 404 not found, 403 denied |
| getProjectSnapshots | Query | projectId: uuid, userId: uuid | Array<{ id, parentId, branchName, treeHash, message, createdAt }> | Owner | 404 not found, 403 denied |
| saveSnapshot | Mutation | projectId: uuid, parentId?: uuid, files: jsonb, message?: text, branchName?: text | Snapshot record, treeHash | Owner | 404 not found, 422 invalid files |
| recordPromptMessage | Mutation | threadId: uuid, role: text, content: text, status?: text, toolCalls?: jsonb, snapshotId?: uuid | PromptMessage record with next seq | Owner | 404 not found |
| updatePromptMessage | Mutation | id: uuid, status: text, toolCalls?: jsonb, snapshotId?: uuid | PromptMessage record | Owner | 404 not found |
| saveUserApiKey | Mutation | userId: uuid, provider: text, rawKey: text | { provider, keyHint } | Owner | 422 invalid key format |
| getUserApiKeys | Query | userId: uuid | Array<{ provider, keyHint, updatedAt }> | Owner | 401 unauthenticated |
| getDecryptedApiKey | Internal | userId: uuid, provider: text | rawKey string | Internal server only | 404 not found |
| createDeployment | Mutation | projectId: uuid, snapshotId: uuid, subdomain: text | Deployment record | Owner | 409 subdomain taken, 404 snapshot not found |
| deleteSnapshot | Mutation | id: uuid, userId: uuid | { success: true } | Owner | 409 snapshot has active deployment |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Save user API key | keyHint (e.g. 'sk-...1234') | Derived from prefix and last 4 characters of rawKey |
| Save user API key | encryptedKey, iv, authTag | Computed via AES 256 GCM using SPARK_ENCRYPTION_KEY, crypto randomBytes, and cipher.getAuthTag() |
| Save snapshot | treeHash | Computed via SHA 256 over canonical sorted relative file paths and UTF 8 contents |
| Save snapshot | projects.currentSnapshotId | Updated to newly created snapshot id in the same database transaction |
| Record prompt message | seq | Computed as COALESCE(MAX(seq), 0) + 1 for the target threadId |
| Create project | slug | Supplied by caller or derived from name via kebab case formatting with random suffix on conflict |
| Create deployment | deploymentUrl | Derived from subdomain and PLATFORM_DOMAIN environment variable |

**Key invariants**:
- Personal API keys never store plaintext secrets in database columns. The application decrypts keys strictly in memory on the server using the stored initialization vector and authentication tag during LLM dispatch.
- Every snapshot tree hash is deterministic: two snapshots with identical file paths and identical contents produce identical tree hashes.
- Sibling cascading deletes in PostgreSQL operate cleanly on project removal without foreign key deadlocks. Deleting an individual snapshot directly through deleteSnapshot is blocked if any deployment referencing it has status 'active'.
- Saving a snapshot advances projects.currentSnapshotId automatically inside the same database transaction.
- Querying snapshot history through getProjectSnapshots omits the heavy files JSONB column, protecting server memory from TOAST de-serialization spikes.
- Project slugs are unique per user, allowing clean URL routing such as `/@user/project-slug`.

**Security model**:
- All operations enforce tenant ownership: user identifier from the validated Auth.js session must match the target resource's userId.
- Encrypted provider API keys use AES 256 GCM with a unique 12 byte initialization vector and a 16 byte authentication tag per record, guaranteeing data confidentiality and integrity.
- Client endpoints return key hints only; raw decrypted keys are never serialized in API responses or sent to client browsers.

**Configuration required**:
- `SPARK_ENCRYPTION_KEY`: 32 byte hex string (64 characters) used as the master key for AES 256 GCM envelope encryption of user provider keys.
- `AUTH_SECRET`: Secret token used by Auth.js to sign session cookies and JSON Web Tokens.
- `PLATFORM_DOMAIN`: Base wildcard domain string (e.g. 'sparkapps.dev' or 'localhost:3000') used to construct deployment URLs.

**Critical test scenarios**:
- Happy path: User creates a project, generates code, saves a snapshot advancing currentSnapshotId, and records prompt messages with sequential seq values, verifies **AC-1**, **AC-3**, **AC-5**
- Personal key encryption and integrity: User saves an Anthropic key; database stores encryptedKey, iv, and authTag; decryption succeeds with matching tag and rejects tampered ciphertext, verifies **AC-2**
- Active deployment snapshot protection: deleteSnapshot rejects deleting a snapshot linked to an active deployment with a 409 conflict, verifies **AC-4**
- Cascading teardown: Deleting a project removes its prompt threads, prompt messages, snapshots, and deployments cleanly without foreign key deadlocks, verifies **AC-4**
- Automatic slug derivation: Creating projects with identical names produces clean unique slugs with collision suffixes, verifies **AC-5**
- Projection performance: getProjectSnapshots returns history records without de-serializing files JSONB, verifies **AC-3**
- Migration verification: Running drizzle-kit generate and migration apply succeeds on PostgreSQL and local PGlite, verifies **AC-6**

## Build plan

- [x] 1. Create modular Drizzle schema definitions for auth, api keys, projects, prompt threads, snapshots, and deployments in packages/db/src/schema/, satisfies **AC-1**, **AC-2**, **AC-5**
- [x] 2. Declare Drizzle relations and constraints including foreign key cascades, unique constraints, and composite primary keys, satisfies **AC-1**, **AC-4**
- [x] 3. Implement cryptographic helpers in packages/db/src/crypto.ts for AES 256 GCM key encryption, authentication tag handling, key hint extraction, and SHA 256 snapshot tree hashing, satisfies **AC-2**, **AC-3**
- [x] 4. Generate versioned SQL migration scripts using drizzle-kit and configure migration execution runner for both PostgreSQL and PGlite, satisfies **AC-4**, **AC-6**
- [x] 5. Implement and export type safe domain query and mutation functions with column projection and explicit Result types from packages/db/src/index.ts, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**
- [x] 6. Write integration test suite verifying schema constraints, key encryption, authentication tag verification, snapshot tree hash calculation, and cascading deletes, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**

## Consequences

**Positive**:
- Complete data sovereignty with self hosted authentication and relational database persistence in PostgreSQL.
- Fast sub millisecond loading of full snapshot file trees into in browser WebContainers via single query JSONB reads.
- Robust security for user provided LLM provider keys with AES 256 GCM authenticated encryption at rest.
- Time travel rollback, branching, and diff comparisons enabled by immutable parent snapshot lineage.
- High memory efficiency achieved by projecting snapshot metadata separately from heavy file trees in list queries.
- Clean cascading project teardown without foreign key ordering conflicts in PostgreSQL.

**Negative / tradeoffs**:
- Storing full file trees in JSONB per snapshot duplicates unchanged files across successive snapshots within a project.
- Very large repositories with tens of megabytes of binary assets could strain PostgreSQL row limits; mitigations like asset upload offloading may be required later.

**Neutral**:
- Requires managing the master encryption key environment variable `SPARK_ENCRYPTION_KEY` and `PLATFORM_DOMAIN` across development and deployment environments.

## Follow-up

- [ ] Add `SPARK_ENCRYPTION_KEY` and `PLATFORM_DOMAIN` to packages/shared environment variable validation schema.
- [ ] Implement asset storage strategy (S3 or R2 object storage) in Slice 6 if projects exceed 10 megabytes of static media.
