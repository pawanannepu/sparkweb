# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Relational database schema in PostgreSQL and PGlite using Drizzle ORM for identity, workspaces, prompt threads, code snapshots, and deployments (see spec 0002)
- AES 256 GCM envelope encryption for personal provider API keys with initialization vectors, authentication tags, and non sensitive key hints (see spec 0002)
- Immutable virtual file system snapshots with deterministic SHA 256 content addressable tree hashing (see spec 0002)
- Typed domain queries and mutations for workspaces, thread sequencing, snapshot lineage, and deployment records (see spec 0002)
- Database migration runner and initial SQL migration script supporting PostgreSQL and local PGlite (see spec 0002)

### Security
- Encrypted storage for personal provider credentials at rest with authentication tag tamper verification (see spec 0002)
- Domain level teardown protection preventing deletion of snapshots backing active live deployments (see spec 0002)
