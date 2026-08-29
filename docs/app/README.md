# transcripts.fyi — application index

2026-08-29. Start here, then open one file from the map. The code under `src/` is the truth; this page says where to look. Operations live in [`runbook.md`](./runbook.md).

## Mental model

A shared "universe" of stock tickers. Adding one creates a `subjects` row and a `runs` row, and starts a long-lived Claude Managed Agents (CMA) session pinned to a specific agent version and a `$10` list-cost budget. The agent follows the `earnings-transcripts` skill: it lists the ticker's earnings-call transcripts, fetches the newest eight one at a time, and posts one self-contained dark-mode HTML explainer. The app never holds a connection to CMA: every custom tool the agent calls parks the session, Anthropic POSTs a thin event to `/webhook`, and the handler answers the tool from the session's own event log and syncs the run's status and cost into Postgres. The product page renders from Postgres only. Dev and prod share one Anthropic workspace, so both receive every webhook; sessions carry `metadata.target` and each deployment answers only its own (`deployTarget()` in `src/lib/anthropic.ts`).

## Request flow: "Add to universe"

1. `AddSubject` form → `addSubjectAction` (`src/app/s/actions.ts`): ticker must match `^[A-Z.\-]{1,10}$`; calls `addSubject(key, deployTarget())`.
2. `addSubject` (`src/lib/distill/add.ts`): find-or-insert `subjects` (`kind='ticker'`, `onConflictDoNothing`); if no non-`ended` run exists for skill `earnings-transcripts`, `startRun`.
3. `startRun` → `ensureDistillStack(target)` (`src/lib/distill/stack.ts`): find-or-create environment `transcripts-fyi-distill-<target>` (cloud, limited networking), skill `earnings-transcripts` (by display name, shared across targets), agent by metadata `{app:'tfyi', role:'distiller', target}`. `config_hash` = sha256 of system prompt + model/effort + tool defs + skill markdown, stamped in agent metadata; a mismatch publishes a new skill version (if the skill hash moved) and a new immutable agent version via `agents.update`.
4. `sessions.create` with `agent: {id, version}` pinned, `environment_id`, `budget.max_list_cost = 1000` cents, `metadata {app, target, run_id, subject, skill}`, one initial user message. Then `runs` is inserted (status default `working`) with all `cma_*` ids.
5. The agent reads the skill (`read` is the only built-in tool enabled), calls `list_transcripts`, then `fetch_transcript` ×8 (≤2 in parallel), then `post_artifact`. Each custom-tool call idles the session with `stop_reason: requires_action`; Anthropic webhooks `session.status_idled` to `/webhook`.
6. `/webhook` (`src/app/webhook/route.ts`): `webhooks.unwrap` verifies the signature on the raw body; insert into `webhook_events` (duplicate event id → 204 and stop); for any `session.*` type except `session.deleted`, run `settleDistillSession` and `settlePingPongSession` in parallel. Routing is by prefix, not exact event type.
7. `settleDistillSession` (`src/lib/distill/settle.ts`): `sessions.retrieve` → skip unless `metadata.app === 'tfyi'`, `run_id` set, `target` matches → load the run → `events.list` (whole log) → answer every `agent.custom_tool_use` lacking a `user.custom_tool_result` via `runDistillTool` (FMP fetches; `post_artifact` inserts) → one `events.send` with all results → derive `runs.status` from `session.status` plus the last `session.status_idle.stop_reason`, write `list_cost_cents` and `last_activity_at`.
8. `/s/[key]` (`src/app/s/[key]/page.tsx`) reads `latestArtifact` (max `created_at`) and `activeRun` from Postgres and renders the HTML in a `sandbox=""` iframe via `srcDoc`; `AutoRefresh` re-renders every 5 s while `status === 'working'`. Admins also mount `<Sausage/>`, which fetches `/api/runs/[id]/trace` after mount and repolls every 5 s while live.

## The line

| | Hot path | Sausage |
|---|---|---|
| What | `/`, `/s/[key]`, sidebar | Right-hand "How the sausage was made" pane, `/api/runs/[id]/trace`, `/smoke` |
| Reads | Postgres only (`listUniverse`, `latestArtifact`, `activeRun`) — badge shows `hot path · postgres · Nms · $0/view` | Live CMA (`sessions.retrieve` + full `events.list`) |
| Who | Everyone | Admin cookie (`ADMIN_INVITE_CODE`; unset = everyone) |
| When | Server render | Client fetch after mount; never on the render path |

Why: the user-facing product must stay predictable and free per view even if CMA is slow or down; the webhook materializes everything the mainline needs, and the show-and-tell pane is allowed to cheat because it can't block a page.

## Directory map

| Path | What lives there | Read this when… |
|---|---|---|
| `src/proxy.ts` | Auth gate (Next 16 `proxy`, not middleware); matcher excludes `/webhook`, `/login`, static | changing what is public |
| `src/app/page.tsx` | `/` → redirect to the first subject (alphabetical) or "Add a ticker" | |
| `src/app/s/[key]/page.tsx` | The product page: hot-path loads, iframe, admin pane mount | changing the render |
| `src/app/s/actions.ts` | Server actions: add subject, bump budget (+$5), regenerate, regenerate all | changing what buttons do |
| `src/app/webhook/route.ts` | Anthropic webhook receiver: verify, dedupe, settle | anything crossing CMA → app |
| `src/app/api/runs/[id]/trace/route.ts` | Admin-only live trace JSON (`sessionTrace`) | the sausage pane |
| `src/app/smoke/*`, `src/app/actions.ts`, `src/app/api/smoke/[sessionId]/route.ts` | Smoke page, its actions, session inspector | verifying plumbing in a new env |
| `src/app/login/*` | Invite form, cookie mint (`loginAction`), `logoutAction` | auth UX |
| `src/app/layout.tsx`, `globals.css` | Geist fonts, next-themes, sonner, shadcn tokens | theming |
| `src/lib/auth.ts` | HMAC session/admin cookies, invite checks | auth logic |
| `src/lib/anthropic.ts` | One SDK client; `deployTarget()` (`SMOKE_TARGET` else `VERCEL_ENV`) | target routing |
| `src/lib/db/{schema,index}.ts` | drizzle schema; Neon HTTP client (no pool, no transactions) | data model |
| `src/lib/redis.ts` | Upstash REST + `key()` target prefix; idle on the product path | adding a cache |
| `src/lib/distill/skill.ts` | `DISTILL_SKILL_MD` — the skill the agent follows (steps, style, HTML rules) | changing what the agent produces |
| `src/lib/distill/tools.ts` | Custom tool defs (`DISTILL_TOOLS`) + impls (`runDistillTool`) | changing the tools contract |
| `src/lib/distill/stack.ts` | `ensureDistillStack`: find-or-create env/skill/agent, hash-drift versioning | versioning, model, system prompt |
| `src/lib/distill/add.ts` | `addSubject`, `startRun`, `regenerateSubject`, `regenerateAll` | run lifecycle |
| `src/lib/distill/settle.ts` | `settleDistillSession`: the webhook's product half | status/cost sync, idempotency |
| `src/lib/distill/queries.ts` | Hot-path queries + `sessionTrace` (the one live-CMA read) | page data |
| `src/lib/smoke/*` | Ping-pong smoke: stack, tools, session inspector, storage checks; `listAllEvents`/`unansweredToolUses` are reused by distill | smoke tests |
| `src/lib/fmp.ts`, `src/lib/massive.ts` | FMP transcripts/filings/statements; Massive FMV (unused on the product path) | data sources |
| `src/components/app/*` | `shell` (header + universe sidebar), `add-subject`, `auto-refresh`, `sausage` | UI |
| `src/components/ui/*` | shadcn primitives (`npx shadcn add <name>`) | UI kit |
| `scripts/` | `distill.ts` (CLI add), `smoke/run.ts`, `smoke/storage.ts` | CLI twins |
| `drizzle/`, `drizzle.config.ts` | SQL migrations `0000`–`0003` + snapshots; CLI-only config | schema changes |
| `docs/managed-agents/` | Local CMA reference (verified against live docs 2026-08-29) | CMA API questions |
| `docs/apis/` | FMP and Massive quick refs | data-source questions |
| `docs/sprints/` | Sprint notes and lessons | history and rationale |
| `docs/ideas/` | Other document universes (researched shortlist) | what's next |

## Data model

| Table | Columns that matter | Written by | Notes |
|---|---|---|---|
| `subjects` | `id`, `kind`, `key`, `display_name`, `created_at`; unique `(kind, key)` | `addSubject` | Today `kind='ticker'`, `key` = upper-cased ticker |
| `runs` | `id`, `subject_id`, `skill`, `target`, `cma_session_id`, `cma_agent_id`, `cma_agent_version`, `cma_environment_id`, `cma_skill_version` (nullable), `status`, `list_cost_cents`, `created_at`, `last_activity_at` | insert: `startRun`; `status`/`list_cost_cents`/`last_activity_at`: `settleDistillSession`; `status='ended'`: `regenerateSubject` | `status` ∈ `working` (default; also "we just answered tools" or session running) · `idle` (`end_turn`) · `budget_reached` · `ended` (`terminated`, `retries_exhausted`, or regenerated). Legacy `active` exists on early rows (default before migration `0002`); `activeRun` treats anything ≠ `ended` as live |
| `artifacts` | `id`, `run_id`, `subject_id`, `kind='html'`, `content`, `meta` jsonb, `cma_tool_use_id` UNIQUE, `created_at` | `post_artifact` inside the webhook, `onConflictDoNothing` | Append-only; latest = max `created_at` per subject; history kept across regenerations |
| `webhook_events` | `id` (Anthropic event id, PK), `type`, `resource`, `target`, `received_at` | `/webhook` | Dedupe; Postgres is per environment so each deployment has its own copy |

## The tools contract

Definitions live on the agent (`DISTILL_TOOLS`), implementations in `runDistillTool`; results are sent as `user.custom_tool_result` with JSON text and `is_error`.

- `list_transcripts {symbol}` → `{symbol, transcripts: [{year, quarter, date}]}` newest first, capped at 40 refs (FMP `earning-call-transcript-dates`); error if none.
- `fetch_transcript {symbol, year, quarter}` → `{symbol, year, quarter, date, content}` (~40–60k chars; FMP `earning-call-transcript`); `year` is the fiscal year exactly as listed; error if none.
- `post_artifact {html, meta}` → `{ok, chars}`; inserts an `artifacts` row keyed on the tool-use id; `html` shorter than 200 chars is rejected; `meta` should carry `symbol` and `quarters`.
- Ceiling that shaped them: a custom-tool result is truncated around 100k chars (observed: a 385k-char batch lost everything past ~3 transcripts; built-in tools spill to a file, custom tools don't). Hence list once, fetch one transcript per call, ≤2 in parallel, plain HTML rather than base64 in `post_artifact`.

## Invariants (don't break these)

- The mainline reads Postgres only. Nothing user-facing derives from a live CMA call; `sessionTrace` is the single exception and is admin-gated, client-fetched, and off the render path.
- `/webhook` is the single seam between CMA and product state and must stay idempotent: state is derived from the session's event log (`unansweredToolUses`, last `session.status_idle`), never from which webhook arrived or in what order; artifacts are unique on `cma_tool_use_id`; deliveries are deduped on event id. Any `session.*` event, any number of times, in any order, must be safe.
- Every settler checks `metadata.target === deployTarget()` before acting — dev and prod both receive every event.
- `/webhook` and `/login` are never behind auth (`proxy.ts` matcher). Everything else, including `/api/*`, is.
- No `NEXT_PUBLIC_` secrets. `INVITE_CODE` doubles as the cookie HMAC secret; it must never reach the browser.
- Prod is never migrated from a laptop; `vercel-build` runs `drizzle-kit migrate` per environment on deploy.
- No connections, no transactions: Neon over HTTP, Upstash over REST, CMA over webhooks. Writes are shaped so they don't need a transaction (append-only, `onConflictDoNothing`).
- Sessions are pinned to an agent version at creation and never move. Code drift publishes new versions for *new* sessions only; "Regenerate" is how an existing run catches up. `runs.cma_*` records exactly what a run ran on.
- Agent/environment/skill live in Anthropic's resources, found by metadata/name; there are no DB rows for them.

## Further reading

- [`runbook.md`](./runbook.md) — env vars, local dev + ngrok, migrations, adding/resetting/regenerating subjects, the trace pane, smoke tests, sharp edges, where to look.
- [`../managed-agents/README.md`](../managed-agents/README.md) — CMA reference; `webhooks.md`, `core.md` (stop reasons, budgets), `tools.md` are the ones this app leans on.
- [`../apis/fmp.md`](../apis/fmp.md), [`../apis/massive.md`](../apis/massive.md) — data-source quick refs.
- [`../sprints/2-hours.md`](../sprints/2-hours.md) — how v0 was built and what was learned; root `README.md` has the decisions table and above/below the line.
- [`../ideas/transcript-universes.md`](../ideas/transcript-universes.md) — candidate universes beyond earnings calls.
