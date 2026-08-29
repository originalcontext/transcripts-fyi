# transcripts.fyi — runbook

2026-08-29. Operations only; the map of the code is in [`README.md`](./README.md). Every env-var claim below is from `.env.example` and the `process.env.*` reads in `src/` and `scripts/`.

## 1. Environment variables

| Name | dev (`.env.local`) | preview | prod | Who sets it | Notes |
|---|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | yes | yes | you, in Vercel; pulled | One workspace for dev and prod. Read by the SDK client (`src/lib/anthropic.ts`) |
| `ANTHROPIC_WEBHOOK_SIGNING_KEY` | dev endpoint's `whsec_` | verify | prod endpoint's `whsec_` | you, from Console → Manage → Webhooks (shown once) | Per endpoint, so dev and prod differ. `/webhook` returns 500 if unset |
| `FMP_API_KEY` | yes | yes | yes | you | Required: `list_transcripts`/`fetch_transcript` and the smoke fetch call FMP |
| `MASSIVE_API_KEY` | optional | optional | optional | you | Nothing on the product path calls `src/lib/massive.ts` today |
| `DATABASE_URL` | dev Neon | verify (Neon integration) | prod Neon | Vercel Neon integration | Pooled HTTP URL; the app (`neon-http`) and `drizzle-kit` both read it. Neon is per environment |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | yes | yes | yes | Vercel Upstash integration | One Redis shared by all targets; every key goes through `key()` for a `<target>:` prefix |
| `INVITE_CODE` | yes | yes | yes | you | Gate *and* cookie HMAC secret; rotate to log everyone out. Dev and prod share one code today (per sprint notes; verify in Vercel) |
| `ADMIN_INVITE_CODE` | not set today | verify | verify | you | Optional. Logging in with it mints `tfyi_admin`. **Unset = everyone is admin** (`isAdmin` returns true) |
| `SMOKE_TARGET` | `dev` | never | never | you, local only | Forces `deployTarget()`. On Vercel leave unset: `VERCEL_ENV === 'production'` → `prod`, anything else → `dev` |
| `VERCEL_ENV`, `NODE_ENV` | — | auto | auto | Vercel / Next | `NODE_ENV=production` sets the cookie `secure` flag |
| `ENV_FILE` | — | — | — | you, on the CLI | npm scripts read `--env-file=${ENV_FILE:-.env.local}`; e.g. `ENV_FILE=.env.prod.local` |

Vercel marks prod secrets *sensitive*, so `vercel env pull` for production returns `[SENSITIVE]` placeholders (sprint notes). That is what makes "never migrate prod from a laptop" hard to violate by accident. `vercel env pull` also drops extra integration vars (`POSTGRES_*`, `PG*`, `KV_URL`, …) into `.env.local`; the app ignores them.

## 2. Local dev

```sh
nvm use                         # Node 24 (.nvmrc); engines >= 22.13
vercel env pull                 # writes .env.local from the development environment
# add/confirm in .env.local: SMOKE_TARGET=dev, INVITE_CODE, FMP_API_KEY,
#   ANTHROPIC_WEBHOOK_SIGNING_KEY (the *dev* endpoint's secret, see below)
npm run dev                     # http://localhost:3000
ngrok http 3000                 # separate terminal; note the https host
```

Webhook registration is Console-only (Console → Manage → Webhooks; no API). Register the dev endpoint as exactly `https://<ngrok-host>/webhook` — https, no trailing slash; any 3xx (a redirect to a slash, an auth redirect) auto-disables the endpoint and events emitted while disabled are not replayed. Paste its `whsec_` into `.env.local`. Subscribe to the session events: `session.status_idled` is the one that matters (every custom-tool call and every finish arrives as it); `session.status_terminated` keeps `runs.status` honest on errors. `session.requires_action` exists in the SDK types but never fired in practice. The handler routes any `session.*` type by prefix, so subscribing to more session types is harmless but costs one settle (several API calls) per delivery. Which types are currently subscribed lives only in the Console — verify there. Because a new ngrok host means a new URL, update the endpoint whenever the tunnel changes.

## 3. Migrations

```sh
npm run db:generate            # drizzle-kit generate → drizzle/000N_*.sql + meta snapshot
npm run db:migrate             # dev only: applies to DATABASE_URL from .env.local
```

- `vercel-build` is `drizzle-kit migrate && next build`, so every deploy migrates its own environment with its own `DATABASE_URL`. Never run `db:migrate` against prod.
- `drizzle-kit` uses `@neondatabase/serverless` over WebSocket at CLI time (`node_modules/drizzle-kit/api.js` sets `neonConfig.webSocketConstructor`); the app itself only ever uses the HTTP driver.
- `drizzle.config.ts` is CLI-only; the app never imports it.

## 4. Adding a subject

- UI: "Add to universe" in the header (any logged-in user). CLI twin: `npm run distill -- NVDA` (uses `.env.local`, so `SMOKE_TARGET` decides the target).
- Expect: NVDA ≈ 3 min wall, ≈ $1.40–1.50 list cost, 1 `list_transcripts` + 8 `fetch_transcript` + 1 `post_artifact`. If a non-`ended` run already exists for the subject, nothing new starts.
- Watch: sidebar entry is greyed/italic until the first artifact lands (`working && !hasArtifact`); the page auto-refreshes every 5 s while `working` and shows "Reading the last eight calls…"; the status line shows `distilling → up to date` and the run's cost; admins see the trace pane; the Console session URL is the `session` link in the pane (`https://platform.claude.com/workspaces/default/sessions/<id>`).

## 5. Resetting a subject — dev only

There is no UI for this. Never run against prod. Delete in FK order (artifacts → runs → subject) and archive the CMA sessions so they stop receiving events:

```ts
// scratch/reset.ts (uncommitted). Run: npx tsx --env-file=.env.local scratch/reset.ts NVDA
import { eq } from "drizzle-orm";
import { anthropic } from "@/lib/anthropic";
import { db, schema } from "@/lib/db";
import { getSubject } from "@/lib/distill/queries";

async function main() {
  const subject = await getSubject("ticker", String(process.argv[2]).toUpperCase());
  if (!subject) throw new Error("no such subject");
  const runs = await db.select().from(schema.runs).where(eq(schema.runs.subjectId, subject.id));
  for (const r of runs) await anthropic.beta.sessions.archive(r.cmaSessionId).catch(() => {});
  await db.delete(schema.artifacts).where(eq(schema.artifacts.subjectId, subject.id));
  await db.delete(schema.runs).where(eq(schema.runs.subjectId, subject.id));
  await db.delete(schema.subjects).where(eq(schema.subjects.id, subject.id));
  console.log("reset", subject.key, runs.length, "runs");
}
main().then(() => process.exit(0));
```

Note: `webhook_events` rows are not tied to a subject and are left alone; a late webhook for an archived session settles as `unknown-run` and is harmless.

## 6. Regenerate / Regenerate all

Admin pane buttons → `regenerateSubjectAction` / `regenerateAllAction` (server-side `requireAdmin()`). For each subject: every run with `status ≠ 'ended'` gets its CMA session archived (errors ignored) and `status='ended'`, then `startRun` creates a fresh session on the *current* stack (`ensureDistillStack` runs first, so code drift publishes new skill/agent versions right there). Artifacts are kept; the old explainer stays on screen until the new `post_artifact` lands. Cost ≈ $1.50 per subject; "Regenerate all" multiplies that by the universe and runs subjects sequentially in one server action.

## 7. Reading the trace pane

Data comes from `sessionTrace` (`src/lib/distill/queries.ts`): one `sessions.retrieve` plus the full `events.list`, fetched client-side after mount, repolled every 5 s while the run is `working`.

- Strip line 1: `cma live · <fetch ms> · <event count>` — how long the live fetch took and how many events the session log holds.
- Strip line 2: `<wall> · <model calls> · $<cost>` — wall = last `processed_at` minus `created_at`; model calls = `span.model_request_end` count; cost = `usage.list_cost`.
- Strip line 3: tokens in / cached (cache reads) / out, summed over model requests.
- `session` links to the Console viewer; `status` shows `session.status` plus the last idle `stop_reason`; `cost` is `x of budget`; `agent`/`skill` are the versions this run is pinned to (`runs.cma_*`).
- Rows: `+elapsed` since session creation · event type (amber = `agent.custom_tool_use`, normal = other `agent.*`, muted = user/session events) · detail (tool name + first 80 chars of input; first 120 chars of a message; `<n> chars` or `error` for tool results; stop reason for idles; error JSON for `session.error`). `span.*` and `agent.thinking` are hidden; only the last 80 rows are shown.
- Stop reasons: `requires_action` = waiting on our tool result — normal for a few seconds; lingering means a dropped or unanswered webhook (see §9). `end_turn` = the agent finished; `runs.status` becomes `idle` ("up to date"). `budget_reached` = paused at the cap, history intact; `runs.status` becomes `budget_reached`. `retries_exhausted` or a `terminated` session → `ended`.
- Bump budget: `bumpBudgetAction` sets `max_list_cost` to `max(current, consumed + 1) + 500` cents (+$5) and the session resumes. The button turns solid when `stop === 'budget_reached'`.

## 8. Smoke tests

- `/smoke` (linked from the header): storage round trip (Neon `select now()`, Upstash `INCR <target>:smoke:hits`), find-or-create the smoke stack, run the ping-pong + NVDA-transcript smoke, list recent sessions. 8 checks, ≈ 25 s, ≈ $0.17.
- `npm run smoke:run -- --target dev|prod` — CLI twin; polls `inspectSmokeSession` until done, exit 0 on pass. The running webhook for that target must be reachable or the tool call never gets answered.
- `npm run smoke:storage` — Neon + Upstash only. Prod: `ENV_FILE=.env.prod.local SMOKE_TARGET=prod npm run smoke:storage` (needs a prod env file you assembled yourself; `vercel env pull` won't give you the sensitive values).

## 9. Known sharp edges

- Custom-tool results truncate around 100k chars, silently. Keep one transcript per `fetch_transcript`; don't batch.
- `runs.status` legacy value `active` exists on early rows (default before migration `0002`). `activeRun` treats it as live (≠ `ended`), `listUniverse.working` does not (`= 'working'`), and the page shows it verbatim.
- Orphaned CMA session: `startRun` calls `sessions.create` before inserting `runs`; if the insert fails the session runs (and spends) with no row, and its webhooks settle as `unknown-run`. Resiliency sprint item; until then find it in the Console by title `<TICKER> · earnings-transcripts · <target>` and archive it.
- Dropped deliveries: Anthropic retries three times then drops the event with no signal. A run stuck at `requires_action` needs any later `session.*` event, or a manual `settleDistillSession(sessionId)` (e.g. via `tsx`), to catch up. The reconciler cron is not built yet.
- Dev and prod share the invite code today (verify in Vercel); rotating it logs both out.
- The handler does several upstream calls per delivery: two `sessions.retrieve` (distill + smoke settlers run in parallel), a full paginated `events.list` per matching settler, up to two FMP fetches, one `events.send`, plus Postgres. Handler runtime vs. the Vercel function limit for this plan is unmeasured — verify before long runs.
- `bumpBudgetAction` has no server-side admin check (only the regenerate actions call `requireAdmin()`); any logged-in user who can reach the action can bump a run's budget.
- `ensureDistillStack` paginates every environment, skill, and agent in the workspace on each add/regenerate; fine now, slow as the workspace grows.
- The skill is looked up by display name and shared across targets, but the drift check is per agent, so dev and prod can each publish a skill version with identical content.
- `webhook_events` grows unbounded until the GC cron exists.

## 10. Where to look when something's wrong

| Symptom | Look at |
|---|---|
| Ticker stays "distilling" | `vercel logs` (or the `next dev` terminal): each delivery logs `webhook {id, type, resource, distill, smoke}` — `distill.action` is `synced` with `status`/`tools`, or `skipped` with `not-ours` / `other-target` / `unknown-run`. No log lines at all → endpoint disabled or wrong secret (check Console → Webhooks; 400 = bad signature, 500 = key unset) |
| Trace pane shows `requires_action` for minutes | Console session viewer (link in the pane): is the tool call unanswered? Then a delivery was dropped — see §9 |
| Explainer missing but session finished | `artifacts` for the subject; if empty, the `post_artifact` call errored (`html` < 200 chars, or a DB error) — the trace row shows `error … chars` |
| Cost or status looks stale | `runs.status`, `list_cost_cents`, `last_activity_at` are only written by the webhook; compare with the Console session |
| Duplicate/odd deliveries | `select * from webhook_events order by received_at desc` (per-environment table; `target` column says which deployment recorded it) |
| Nothing from FMP | `FmpError` in logs carries status + key-redacted URL + 300 chars of body; 401 = key, 400 = params |
| Login loops | `INVITE_CODE` unset throws in `auth.ts`; cookie is `tfyi_session` (30 days, httpOnly); admin is `tfyi_admin` |
