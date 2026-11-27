# Verify: one click publishing and isolated live hosting · spec 0009 · updated 2026-11-27

_Steps derived from spec 0009 acceptance criteria and value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [x] Open the builder workspace, click `Publish` in the top bar, confirm the popover shows status, and click `Publish Site` on a clean snapshot to receive a live URL and watch 1.5 second polling move from `Building` to `Live` → AC-2, AC-10
- [x] Copy the live URL and open it on `<subdomain>.localhost:3000`, verify the published app renders without `spark-inspector-client` or `spark-db-bridge`, and confirm navigating to `/settings/profile` falls back to `index.html` → AC-3, AC-8, AC-10
- [ ] Edit a component in the builder preview after publishing and confirm `<subdomain>.localhost:3000` still serves the prior published release until you click `Publish Update` → AC-5
- [x] Open `http://localhost:3000/live/<subdomain>` on the builder origin and confirm it redirects to `http://<subdomain>.localhost:3000/` with no `sparkweb` auth cookies → AC-8
- [x] Publish a snapshot containing a deliberate syntax error, expand the collapsible failure logs in `PublishPopover`, and confirm the previous active release remains live → AC-3, AC-4, AC-10
- [x] Click `Rollback` on a retired deployment in `PublishPopover` and confirm the live URL switches immediately to the older artifact without running a build → AC-7, AC-10
- [x] Click `Unpublish` in `PublishPopover` and confirm `<subdomain>.localhost:3000` returns `404` immediately → AC-5, AC-7, AC-10
- [x] Open `Domains` (`CustomDomainDialog`), rename the subdomain, save a custom domain (`app.example.com`), verify DNS instructions show `_sparkweb-verify.app.example.com` TXT and CNAME (or `@` A record for apex `example.com`), click `Verify DNS` six times within one minute to observe `429`, and remove the custom domain → AC-6, AC-10

## Commands

- [x] `psql -U postgres -d sparkweb -c "\d project_domains" -c "\d deployments" -c "\d projects"` → confirm `project_domains` table, `projects.active_deployment_id`, nullable `deployments.snapshot_id`, non unique `deployments.subdomain`, and `deployments_one_active_per_project_idx` partial unique index exist → AC-1
- [x] `pnpm --filter @spark/db test` → confirm transactional activation, concurrent build `409`, snapshot delete guard (`409` on `queued`/`building`/`active`), and exhausted snapshot checks pass → AC-1, AC-2, AC-4, AC-9
- [x] `curl -i -s http://<subdomain>.localhost:3000/` → confirm `200 OK`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`, `Cache-Control: no-cache`, and no `Set-Cookie` header → AC-8
- [ ] `curl -i -s -X POST http://localhost:3000/api/projects/<id>/deployments -H "Content-Type: application/json" -d '{"previewClean":false,"isStreaming":false}'` → confirm `409` Conflict; test `previewClean:true` on a project with no snapshot for `422`; test unauthenticated for `401` and non owner `x-user-id` for `403` → AC-2
- [x] `pnpm check-types && pnpm lint && pnpm test && pnpm build` → confirm all 6 packages typecheck, Biome passes, all tests pass, and Next.js builds cleanly → AC-1 through AC-10

## Value sourcing checks

- [x] Trigger publish with explicit `snapshotId` vs omitted `snapshotId` (falling back to `projects.currentSnapshotId`) and verify the built bundle matches the selected snapshot → AC-2
- [x] Trigger first publish on a project with no `project_domains` row and on a second project sharing the same `projects.slug` to verify automatic unique subdomain seeding → AC-2
- [x] Rename a subdomain while an earlier release exists and roll back to that older release, confirming `deploymentUrl` and routes use the current `project_domains` hostname rather than the stale historical subdomain → AC-5, AC-7
- [x] Save both a subdomain (`app.example.com`) and an apex domain (`example.com`) in `PATCH /api/projects/[id]/domain` and verify `recordType` resolves to `cname` vs `apex` with matching `CNAME` or `A` DNS instructions → AC-6
- [x] Verify `DELETE /api/projects/[id]` removes stored artifact prefixes and provider hostnames before cascading database records → AC-9

## Acceptance-criteria coverage

- AC-1 covered by DB schema and `pnpm --filter @spark/db test` · AC-2 covered by `POST /api/projects/[id]/deployments` checks and `PublishPopover` flow · AC-3 covered by isolated Vite build stripping and failure log checks · AC-4 covered by atomic promotion and failed build preservation · AC-5 covered by preview vs live isolation and subdomain rename checks · AC-6 covered by `CustomDomainDialog`, DNS instructions, and `429` rate limit checks · AC-7 covered by rollback and unpublish checks · AC-8 covered by `*.localhost:3000` origin isolation and header checks · AC-9 covered by `deleteSnapshot` `409` guard and `DELETE /api/projects/[id]` cleanup · AC-10 covered by `PublishPopover` and `CustomDomainDialog` UI checks
