# transcripts.fyi — application index

2026-08-29. Start here, then open one file from the map. The code under `src/` is the truth; this page says where to look. Operations live in [`runbook.md`](./runbook.md); a guided tour of the code in [`../codebase/README.md`](../codebase/README.md).

## Mental model

A shared "universe" of stock tickers, capped at 100. Adding one creates a `subjects` row and a `runs` row, and starts a long-lived Claude Managed Agents (CMA) session pinned to a specific agent version with a `$25` list-cost budget (`RUN_BUDGET_CENTS`, `src/lib/distill/add.ts`). The agent follows the `earnings-transcripts` skill: it lists the ticker's earnings-call transcripts, fetches the newest twenty one at a time, writes per-quarter notes into its sandbox (`/workspace/notes/`), reads them back, and posts one self-contained interactive dark-mode HTML explainer. The app never holds a connection to CMA: every custom tool the agent calls parks the session, Anthropic POSTs a thin event to `/webhook`, and the handler answers the tool from the session's own event log and syncs the run's status and cost into Postgres. A reconciler cron repairs anything a dropped delivery leaves behind. The product page renders from Postgres only. Dev and prod share one Anthropic workspace, so both receive every webhook; sessions carry `metadata.target` and each deployment answers only its own (`deployTarget()` in `src/lib/anthropic.ts`).

## Request flow: "Add to universe"

1. `AddSubject` form (wordwheel over the static `src/data/tickers.json`) → `addSubjectAction` (`src/app/s/actions.ts`): ticker must match `^[A-Z.\-]{1,10}$`; calls `addSubject(key, deployTarget())`; returns `{error}` or `{key}`.
2. `addSubject` (`src/lib/distill/add.ts`): find-or-insert `subjects` (`kind='ticker'`, `onConflictDoNothing`; refuses when `count(subjects) >= MAX_SUBJECTS = 100`); if no non-`ended` run exists for skill `earnings-transcripts`, `startRun`.
3. `startRun` → `ensureDistillStack(target)` (`src/lib/distill/stack.ts` → `src/lib/cma/stack.ts`): find-or-create environment `transcripts-fyi-distill-<target>` (cloud, limited networking), skill `earnings-transcripts` (by display name, shared across targets), agent by metadata `{app:'tfyi', role:'distiller', target}`. `config_hash` = sha256 of system prompt + model/effort + tool defs + skill markdown, stamped in agent metadata; a mismatch publishes a new skill version (if the skill hash moved) and a new immutable agent version via `agents.update`.
4. `sessions.create` with `agent: {id, version}` pinned, `environment_id`, `budget.max_list_cost = 1500` cents, `metadata {app, target, run_id, subject, skill}`, one initial user message. Then `runs` is inserted (status default `working`) with all `cma_*` ids.
5. The agent reads the skill (built-in `read`; `write`/`edit` are enabled too for the notes files — `NOTES_TOOLSET` in `src/lib/distill/stack.ts`), calls `list_transcripts`, then `fetch_transcript` ×20 (≤2 in parallel, writing a notes file after each), reads the notes back, then `post_artifact`. Built-in tools run in the sandbox and never touch the app; each *custom*-tool call idles the session with `stop_reason: requires_action` and Anthropic webhooks `session.status_idled` to `/webhook`.
6. `/webhook` (`src/app/webhook/route.ts`): `webhooks.unwrap` verifies the signature on the raw body; insert into `webhook_events` (duplicate event id → 204 and stop); for any `session.*` type except `session.deleted`, run `settleDistillSession` and `settlePingPongSession` in parallel inside a try/catch. If settle throws, the dedupe row is deleted and the route returns 500 so Anthropic retries. Routing is by prefix, not exact event type.
7. `settleDistillSession` (`src/lib/distill/settle.ts`): `sessions.retrieve` → skip unless `metadata.app === 'tfyi'`, `run_id` set, `target` matches → load the run (skip `unknown-run`; skip `run-ended` so a late delivery cannot resurrect a run; a `terminated`/archived session is written `ended` and skipped as `session-terminal`) → `events.list` (whole log) → answer every `agent.custom_tool_use` lacking a `user.custom_tool_result` via `runDistillTool` (FMP fetches; `post_artifact` inserts; tool failures become `is_error` results) → one `events.send` with all results → derive `runs.status` from `session.status` plus the last `session.status_idle.stop_reason`, write `list_cost_cents` and `last_activity_at`.
8. `/s/[key]` (`src/app/s/[key]/page.tsx`) reads `latestArtifact` (max `created_at`) and `activeRun` from Postgres and renders the HTML through `injectArtifactHead` (dark first-paint style + pinned Chart.js / Alpine / lucide tags from jsDelivr, `src/lib/artifact/imports.ts`) in an `<iframe sandbox="allow-scripts" srcDoc=…>` (`ArtifactFrame`). `AutoRefresh` re-renders every 5 s while `status === 'working'`. Admins also get the "Request update" link when the run is idle (or there is none) and the `<Sausage/>` drawer, which fetches `/api/runs/[id]/trace` after mount and repolls every 5 s while live.
9. `/api/cron/reconcile` every 5 minutes (`vercel.json`, `src/lib/ops/reconcile.ts`): for every non-`ended` run, re-derive status from the session and re-run the same settle on drift / stuck / stale; end runs whose session 404s; archive orphan sessions older than an hour. `/api/cron/gc` daily archives sessions of runs ended > 7 days and prunes `webhook_events` > 30 days.

## The line

| | Hot path | Sausage |
|---|---|---|
| What | `/`, `/s/[key]`, sidebar | Right-hand "How the sausage was made" drawer, `/api/runs/[id]/trace`, `/smoke` |
| Reads | Postgres only (`listUniverse`, `latestArtifact`, `activeRun`) — badge shows `hot path · Nms · $0/view` | Live CMA (`sessions.retrieve` + full `events.list`) |
| Who | Everyone with the invite cookie | Admin cookie (`ADMIN_INVITE_CODE`; unset = everyone is admin, deliberate — root README decision 26). Exception: `/smoke`, `/api/smoke/*` and the smoke actions check only the invite cookie today (review #11, open) |
| When | Server render | Client fetch after mount; never on the render path |

Why: the user-facing product must stay predictable and free per view even if CMA is slow or down; the webhook materializes everything the mainline needs, and the show-and-tell pane is allowed to cheat because it can't block a page.

## Directory map

| Path | What lives there | Read this when… |
|---|---|---|
| `src/proxy.ts` | Auth gate (Next 16 `proxy`, not middleware); matcher excludes `/webhook`, `/api/cron`, `/login`, static | changing what is public |
| `src/app/page.tsx` | `/` → redirect to the first subject (alphabetical) or "Add a ticker" | |
| `src/app/s/[key]/page.tsx` | The product page: hot-path loads, iframe, admin-only "Request update" + drawer mount | changing the render |
| `src/app/s/actions.ts` | Server actions: add subject, bump budget (+$5, admin), regenerate (admin) | changing what buttons do |
| `src/app/webhook/route.ts` | Anthropic webhook receiver: verify, dedupe, settle, release-and-500 on failure | anything crossing CMA → app |
| `src/app/api/cron/{reconcile,gc}/route.ts` | Vercel Cron entry points; bearer `CRON_SECRET`; `?dry=1` to report only; `maxDuration = 60` | crons |
| `src/app/api/runs/[id]/trace/route.ts` | Admin-only live trace JSON (`sessionTrace`) | the sausage drawer |
| `src/app/smoke/*`, `src/app/actions.ts`, `src/app/api/smoke/[sessionId]/route.ts` | Smoke page, its actions, session inspector | verifying plumbing in a new env |
| `src/app/login/*` | Invite form, cookie mint (`loginAction`), `logoutAction` | auth UX |
| `src/app/layout.tsx`, `globals.css` | Geist fonts, next-themes, sonner, shadcn tokens, pre-paint drawer script | theming |
| `src/lib/auth.ts` | HMAC session/admin cookies, invite checks | auth logic |
| `src/lib/anthropic.ts` | One SDK client; `deployTarget()` (`SMOKE_TARGET` else `VERCEL_ENV`) | target routing |
| `src/lib/db/{schema,index}.ts` | drizzle schema; Neon HTTP client (no pool, no transactions) | data model |
| `src/lib/redis.ts` | Upstash REST + `key()` target prefix; idle on the product path | adding a cache |
| `src/lib/cma/events.ts` | Pure, unit-tested idempotency core: `unansweredToolUses`, `latestStopReason`, `deriveRunStatus` | status derivation |
| `src/lib/cma/stack.ts` | Generic find-or-create env/skill/agent with hash-drift versioning (`ensureStack` / `findStack`) | versioning, how drift is detected |
| `src/lib/cma/errors.ts` | `isNotFound` — only a 404 means "gone" | error classification |
| `src/lib/distill/skill.ts` | `DISTILL_SKILL_MD` — the skill the agent follows (map/notes/reduce, style, allowed libraries) | changing what the agent produces |
| `src/lib/distill/tools.ts` | Custom tool defs (`DISTILL_TOOLS`) + impls (`runDistillTool`) | changing the tools contract |
| `src/lib/distill/stack.ts` | The distiller's `StackSpec` (model, system prompt, `NOTES_TOOLSET`, tools) → `ensureDistillStack` | model, system prompt |
| `src/lib/distill/add.ts` | `addSubject`, `startRun`, `regenerateSubject`; the three ceilings (`RUN_BUDGET_CENTS`, `MAX_SUBJECTS`, `MAX_REGENERATIONS`) | run lifecycle |
| `src/lib/distill/settle.ts` | `settleDistillSession`: the webhook's product half, also called by the reconciler | status/cost sync, idempotency |
| `src/lib/distill/queries.ts` | Hot-path queries + `sessionTrace` (the one live-CMA read) | page data |
| `src/lib/ops/{reconcile,gc,cron-auth}.ts` | Reconciler, GC, `isCronAuthorized` (fail closed) | crons, repairs |
| `src/lib/artifact/imports.ts` | `ARTIFACT_LIBS` (pinned jsDelivr set) + `injectArtifactHead` | what the explainer may load |
| `src/lib/smoke/*` | Ping-pong smoke: stack, tools, session inspector, storage checks; `listAllEvents` still lives here and is imported by distill/ops | smoke tests |
| `src/lib/fmp.ts`, `src/lib/massive.ts` | FMP transcripts/filings/statements; Massive FMV (unused on the product path) | data sources |
| `src/data/tickers.json` | Top-3000 US tickers by market cap (`npm run tickers` regenerates) | the wordwheel, sidebar names |
| `src/components/app/*` | `shell` (header + sidebar, server), `universe-nav` (server), `add-subject`, `artifact-frame`, `auto-refresh`, `mobile-nav`, `request-update`, `sausage-layout` (drawer + rail), `sausage` (trace) | UI |
| `src/components/ui/*` | shadcn primitives (`npx shadcn add <name>`) | UI kit |
| `scripts/` | `distill.ts` (CLI add), `reconcile.ts`, `gc.ts` (dry-run; `--apply`), `tickers.ts`, `smoke/run.ts`, `smoke/storage.ts` | CLI twins |
| `vercel.json` | Cron schedules (`*/5 * * * *`, `17 4 * * *`) | cron cadence |
| `drizzle/`, `drizzle.config.ts` | SQL migrations `0000`–`0003` + snapshots; CLI-only config | schema changes |
| `e2e/`, `.githooks/pre-push`, `.github/workflows/` | Playwright (no secrets, :3100); `npm run check` on push and in CI | quality gate |
| `docs/managed-agents/` | Local CMA reference (verified against live docs 2026-08-29) | CMA API questions |
| `docs/apis/` | FMP and Massive quick refs | data-source questions |
| `docs/reviews/`, `docs/sprints/`, `docs/ideas/` | Cooperative review; sprint notes; other document universes | history and rationale |

## Data model

| Table | Columns that matter | Written by | Notes |
|---|---|---|---|
| `subjects` | `id`, `kind`, `key`, `display_name`, `created_at`; unique `(kind, key)` | `addSubject` | Today `kind='ticker'`, `key` = upper-cased ticker |
| `runs` | `id`, `subject_id`, `skill`, `target`, `cma_session_id`, `cma_agent_id`, `cma_agent_version`, `cma_environment_id`, `cma_skill_version` (nullable), `status`, `list_cost_cents`, `created_at`, `last_activity_at` | insert: `startRun`; `status`/`list_cost_cents`/`last_activity_at`: `settleDistillSession` (from the webhook **and** the reconciler cron); `status='ended'` directly: `regenerateSubject`, settle's `session-terminal` branch, reconciler when the session 404s | `status` ∈ `working` (default; also "we just answered tools" or session running) · `idle` (`end_turn`) · `budget_reached` · `ended` (`terminated`, `retries_exhausted`, regenerated, or session gone). Legacy `active` exists on early rows (default before migration `0002`); `activeRun` treats anything ≠ `ended` as live |
| `artifacts` | `id`, `run_id`, `subject_id`, `kind='html'`, `content`, `meta` jsonb, `cma_tool_use_id` UNIQUE, `created_at` | `post_artifact` inside settle, `onConflictDoNothing` | Append-only; latest = max `created_at` per subject; history kept across regenerations |
| `webhook_events` | `id` (Anthropic event id, PK), `type`, `resource`, `target`, `received_at` | `/webhook` (insert; deleted again if settle throws); pruned after 30 days by GC | Dedupe; Postgres is per environment so each deployment has its own copy |

## The tools contract

Definitions live on the agent (`DISTILL_TOOLS`), implementations in `runDistillTool`; results are sent as `user.custom_tool_result` with JSON text and `is_error`.

- `list_transcripts {symbol}` → `{symbol, transcripts: [{year, quarter, date}]}` newest first, capped at 40 refs (FMP `earning-call-transcript-dates`); error if none.
- `fetch_transcript {symbol, year, quarter}` → `{symbol, year, quarter, date, content}` (~40–60k chars; FMP `earning-call-transcript`); `year` is the fiscal year exactly as listed; error if none.
- `post_artifact {html, meta}` → `{ok, chars}`; inserts an `artifacts` row keyed on the tool-use id; `html` shorter than 200 chars is rejected; inline CSS and one inline `<script>`, no `<script src>`/`<link>` of its own (the host injects the allowed libraries); `meta` should carry `symbol`, `quarters`, `period`, `shape`.
- Built-in `read`/`write`/`edit` are enabled for the notes files; they run in the sandbox and never reach the app.
- Ceiling that shaped them: a custom-tool result is truncated around 100k chars (observed: a 385k-char batch lost everything past ~3 transcripts; built-in tools spill to a file, custom tools don't). Hence list once, fetch one transcript per call, ≤2 in parallel, plain HTML rather than base64 in `post_artifact`.

## Invariants (don't break these)

- The mainline reads Postgres only. Nothing user-facing derives from a live CMA call; `sessionTrace` is the single exception and is admin-gated, client-fetched, and off the render path.
- `/webhook` is the single seam between CMA and product state and must stay idempotent: state is derived from the session's event log (`unansweredToolUses`, last `session.status_idle`), never from which webhook arrived or in what order; artifacts are unique on `cma_tool_use_id`; deliveries are deduped on event id. Any `session.*` event, any number of times, in any order, must be safe. The reconciler and GC only ever call that same settle or archive sessions; they add no second code path for run state.
- Every settler checks `metadata.target === deployTarget()` before acting — dev and prod both receive every event.
- `/webhook`, `/login`, and `/api/cron/*` are never behind the cookie (`proxy.ts` matcher); crons are gated by bearer `CRON_SECRET` and fail closed when it is unset. Everything else, including the rest of `/api/*`, is behind the invite cookie.
- No `NEXT_PUBLIC_` secrets. `INVITE_CODE` doubles as the cookie HMAC secret; it must never reach the browser.
- Prod is never migrated from a laptop; `vercel-build` runs `drizzle-kit migrate` per environment on deploy.
- No connections, no transactions: Neon over HTTP, Upstash over REST, CMA over webhooks. Writes are shaped so they don't need a transaction (append-only, `onConflictDoNothing`).
- Sessions are pinned to an agent version at creation and never move. Code drift publishes new versions for *new* sessions only; "Regenerate" / "Request update" is how an existing run catches up. `runs.cma_*` records exactly what a run ran on.
- Agent/environment/skill live in Anthropic's resources, found by metadata/name; there are no DB rows for them.
- Spend is bounded by ceilings, not quotas: $25 per session, 100 subjects, 10 regenerations per subject. Everyone is admin until `ADMIN_INVITE_CODE` is set (small trusted set, deliberate).

## Further reading

- [`../codebase/README.md`](../codebase/README.md) — guided tour: reading order, one request and one webhook traced end to end, conventions, glossary.
- [`runbook.md`](./runbook.md) — env vars, local dev + ngrok, migrations, adding/resetting/regenerating subjects, the trace drawer, crons, smoke tests, sharp edges, where to look.
- [`../managed-agents/README.md`](../managed-agents/README.md) — CMA reference; `webhooks.md`, `core.md` (stop reasons, budgets), `tools.md` are the ones this app leans on.
- [`../apis/fmp.md`](../apis/fmp.md), [`../apis/massive.md`](../apis/massive.md) — data-source quick refs.
- [`../reviews/2026-08-29-cooperative-review.md`](../reviews/2026-08-29-cooperative-review.md) — what was found, what landed, what is still open.
- [`../sprints/2-hours.md`](../sprints/2-hours.md) — how v0 was built and what was learned; root `README.md` has the decisions table and above/below the line.
- [`../ideas/transcript-universes.md`](../ideas/transcript-universes.md) — candidate universes beyond earnings calls.
