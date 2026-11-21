# 0002. Data model (Rationale)

## Context

sparkweb is a web application builder where users describe an application in plain words and receive a working, full stack application with live interactive preview in browser. The system must support rapid prompt iterations, instant WebContainer virtual file system loading, time travel rollback to earlier versions, and one click publishing to live hosting URLs.

The data layer must resolve several competing forces:
1. WebContainers execute applications entirely in browser from a virtual file system. When a user opens a project or restores a snapshot, the complete file tree must load immediately without hundreds of round trip database queries.
2. In the open source bring your own keys model, users supply personal API keys for LLM providers (OpenAI, Anthropic, Gemini, Groq). Storing plain keys in database columns is a severe security vulnerability, while keeping keys only in browser session memory degrades user experience across reloads and devices.
3. Iterative prompt synthesis generates frequent incremental snapshots. The data model must support branching experiments and time travel rollback while maintaining strict referential integrity for published live releases.
4. Developers retain complete code ownership, requiring clear project structure, exportable file trees, and eventual GitHub repository synchronization.

Without a well structured foundational data model, subsequent development slices would face breaking schema migrations, orphaned deployment records, and security vulnerabilities around API credentials.

## Options considered

### Option 1: Hybrid relational schema with JSONB virtual file trees and encrypted personal API keys (Chosen)

This option models users, authentication accounts, projects, prompt threads, and deployments as standard relational tables in PostgreSQL, while representing each snapshot's generated file tree as a structured JSONB object containing relative paths and file contents. Personal API keys are stored in a dedicated table using AES 256 GCM authenticated encryption with unique initialization vectors.

**Pros**:
- Single query snapshot hydration delivers entire project file trees to WebContainers in sub millisecond time.
- Standard relational foreign keys enforce project ownership, prompt thread continuity, and deployment stability.
- Authenticated AES 256 GCM encryption provides strong security for user provider keys with zero client leakage.
- Direct parent snapshot pointers form a directed acyclic graph for natural branching and time travel rollback.
- Simple operational model using standard PostgreSQL and Drizzle ORM without external graph or document databases.

**Cons**:
- Storing full file trees in JSONB per snapshot duplicates unchanged files across successive snapshots within a project.
- Very large projects with heavy static media assets can increase database row size.

### Option 2: Fully normalized relational file tree (one row per file per snapshot)

This option normalizes the virtual file system into relational tables: a `files` table where every file in every snapshot is an independent database row with path, content, and metadata foreign keyed to `snapshots`.

**Pros**:
- Strict relational constraints and indexes on individual file paths and extensions.
- Allows SQL level querying for specific files across snapshots.

**Cons**:
- Loading a project with 150 files requires reading 150 individual rows or performing heavy joins, increasing query latency.
- Writing a new snapshot requires inserting hundreds of database rows inside a transaction, creating database write contention during rapid generation loops.
- Significant metadata overhead per file row in PostgreSQL storage.

### Option 3: Git style content addressable blob and tree storage

This option mirrors Git internal architecture: individual files are hashed and stored once in a `blobs` table, directories and file lists are stored in a `trees` table, and snapshots point to root tree identifiers.

**Pros**:
- Maximum deduplication: identical files across snapshots and across different user projects are stored only once.
- Minimal storage growth over thousands of incremental prompt modifications.

**Cons**:
- Reconstructing a complete virtual file tree requires multi level recursive joins or graph traversal queries.
- Increased query complexity in Drizzle ORM and higher latency when feeding the in browser WebContainer runtime.
- Premature optimization for initial product slices where project file trees average under 2 megabytes.

## Rationale

We choose Option 1 because it directly optimizes for the primary performance bottleneck of the builder workspace: instantaneous preview boot time.

In sparkweb, WebContainers run in the user's browser. Every time a user opens a project, switches branches, or restores a past snapshot, the client requires the complete virtual file tree to mount the in browser file system. Option 1 delivers the entire project file tree in a single fast query. PostgreSQL handles multi megabyte JSONB documents with high efficiency, and modern compression keeps on disk storage compact.

For personal API keys, Option 1 establishes a dedicated table with AES 256 GCM authenticated envelope encryption. This provides defense in depth: even in the event of a raw database read leak, personal provider keys cannot be decrypted without the host master encryption key.

Option 2 introduces severe write and read amplification during generation loops. Option 3 adds significant architectural and query complexity before real world storage metrics justify blob deduplication. If storage growth becomes a concern after thousands of user projects, the schema can evolve to content addressable blobs behind the existing snapshot abstraction without breaking external APIs.
