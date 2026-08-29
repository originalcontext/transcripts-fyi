# transcripts.fyi — a guided tour of the code

2026-08-29. For a new engineer or a coding agent starting cold. This is *how to read the code and in what order*; the architecture index is [`../app/README.md`](../app/README.md), operations are [`../app/runbook.md`](../app/runbook.md), decisions and TODOs are the root `README.md`. Every claim below cites the file it comes from; when they disagree, the code wins.

## 1. Start here

- The product: a shared universe of tickers. Each ticker gets one long-lived Claude Managed Agents (CMA) session that reads the company's last twenty earnings-call transcripts and posts one interactive HTML explainer; the app shows the latest explainer and lets admins peek at the run.
- The one architectural rule: **the mainline reads Postgres only.** The server render (`/`, `/s/[key]`) never calls CMA. CMA is reached from exactly two places: the webhook seam (`src/app/webhook/route.ts` → `settleDistillSession`, plus the reconciler cron that re-runs the same settle) and the admin trace (`/api/runs/[id]/trace` → `sessionTrace`), which is fetched by the browser after the page has rendered.
- Everything is serverless and connectionless: Neon over HTTP, Upstash over REST, CMA over webhooks + polling. No sockets, no queues, no transactions.
- Two deployments (dev laptop via ngrok, prod on Vercel) share one Anthropic workspace, so every handler checks `metadata.target === deployTarget()` before acting.
- Read the files in §2 in order; then trace §3 and §4 with the code open.

## 2. Reading order

1. `src/lib/anthropic.ts` — the single SDK client and `deployTarget()` (`SMOKE_TARGET` else `VERCEL_ENV`). Every CMA-touching file imports from here; learn the two-target model first.
2. `src/lib/db/schema.ts` — four tables: `webhook_events`, `subjects`, `runs`, `artifacts`. The `runs.status` comment is the mainline's whole contract with CMA.
3. `src/lib/cma/events.ts` (+ `events.test.ts`, `__fixtures__/`) — the pure idempotency core: `unansweredToolUses`, `latestStopReason`, `deriveRunStatus`. No I/O; tested against a captured real session log. Understand this and the webhook is obvious.
4. `src/lib/cma/stack.ts` (+ `errors.ts`) — generic find-or-create of environment + skill + agent in Anthropic's resources, with hash-drift versioning (`skill_hash`, `config_hash` stamped in agent metadata). `errors.ts` is one function: only a 404 means "gone".
5. `src/lib/distill/skill.ts` — `DISTILL_SKILL_MD`, the instructions the agent actually follows (map with notes files → reduce → build → `post_artifact`). Changing it changes the product.
6. `src/lib/distill/tools.ts` — the three custom tools, definitions and implementations side by side, and the 100k-char truncation that shaped them.
7. `src/lib/distill/stack.ts` — the distiller's `StackSpec`: model (`claude-opus-5`, effort high), system prompt, `NOTES_TOOLSET` (built-in read/write/edit), the custom tools.
8. `src/lib/distill/add.ts` — the run lifecycle: `addSubject` → `startRun` (session create, then `runs` insert), `regenerateSubject`; the three ceilings (`RUN_BUDGET_CENTS = 1500`, `MAX_SUBJECTS = 100`, `MAX_REGENERATIONS = 10`).
9. `src/lib/distill/settle.ts` — `settleDistillSession`, the seam. Read every early return; each is a deliberate idempotency guard.
10. `src/lib/distill/queries.ts` — the hot-path reads (`listUniverse`, `getSubject`, `latestArtifact`, `activeRun`) and the one live read, `sessionTrace`.
11. `src/app/webhook/route.ts` — verify, dedupe, settle, release-and-500 on failure. Seventy lines; it is the only place CMA pushes into the app.
12. `src/app/s/[key]/page.tsx` + `src/components/app/*` — `loadHotPath` (Postgres only, timed), `ArtifactFrame` (sandboxed iframe), `AutoRefresh`, the admin-only `RequestUpdate` and `Sausage` drawer inside `SausageLayout`; `shell.tsx` + `universe-nav.tsx` are server components.
13. `src/lib/ops/*` + `src/app/api/cron/*` + `vercel.json` — reconciler (5 min) and GC (daily) behind bearer `CRON_SECRET`; both reuse settle/archive rather than inventing a second code path.
14. `src/lib/smoke/*` + `src/app/smoke/*` — the ping-pong smoke: the first thing that ever worked, kept as the canary for stack creation, webhook routing and storage. `listAllEvents` still lives here and is imported by distill/ops.
15. `scripts/*` — CLI twins of the buttons and crons (`distill`, `reconcile`, `gc`, `tickers`, `smoke/run`, `smoke/storage`), all `tsx --env-file`.

## 3. Follow one request end to end — "Add NVDA"

App side = this codebase (Vercel function or `next dev`); CMA side = Anthropic's sandbox running the agent. Money is spent only on the CMA side.

1. **Browser.** `AddSubject` (`src/components/app/add-subject.tsx`, client) loads `src/data/tickers.json` on first focus, the user picks NVDA, the form submits `addSubjectAction` via `useActionState`.
2. **App, server action.** `addSubjectAction` (`src/app/s/actions.ts`): key must match `^[A-Z.\-]{1,10}$`; `target = deployTarget()`; `await addSubject(key, target)` inside try/catch → returns `{error}` or `{key}`; `revalidatePath("/", "layout")`.
3. **App → Postgres.** `addSubject` (`src/lib/distill/add.ts`): `getSubject` → if new, `count(subjects) < 100` else throw → insert `onConflictDoNothing` → `activeRun(subject.id, 'earnings-transcripts')` (any run with `status ≠ 'ended'`) → none, so `startRun`.
4. **App → CMA (reads).** `startRun` → `ensureDistillStack(target)` (`src/lib/distill/stack.ts` → `ensureStack`, `src/lib/cma/stack.ts`): paginate environments/skills/agents, find by name / display name / metadata `{app:'tfyi', role:'distiller', target}`; if the agent's `config_hash` differs from the code's, publish a new skill version (if the skill changed) and a new agent version. Nothing is stored in Postgres for these.
5. **App → CMA (write; money starts).** `anthropic.beta.sessions.create` (`add.ts`): `agent: {id, version}` pinned, `environment_id`, title `NVDA · earnings-transcripts · <target>`, **`metadata: {app:'tfyi', target, run_id, subject:'NVDA', skill}`** — this is what routes every later webhook back to the run — `budget.max_list_cost = 1500` cents, one initial `user.message`: "Distill NVDA using the earnings-transcripts skill." From here the session runs on Anthropic's side and `session.usage.list_cost` accrues.
6. **App → Postgres.** `db.insert(runs)` with `id = run_id`, `subject_id`, `skill`, `target`, `cma_session_id`, `cma_agent_id`, `cma_agent_version`, `cma_environment_id`, `cma_skill_version`; `status` defaults to `working`. (If this insert fails the session is an orphan; the reconciler archives it after an hour.)
7. **Browser.** The action returns `{key}`; the toast fires and `router.push('/s/NVDA')`. `SubjectPage` (`src/app/s/[key]/page.tsx`) runs `loadHotPath`: `latestArtifact` → null, `activeRun` → `working`, `isAdmin`; renders "Reading the last twenty calls…" and mounts `AutoRefresh` (`router.refresh()` every 5 s). No CMA call.
8. **CMA side.** The agent reads the skill (built-in `read`), calls the custom tool `list_transcripts` → the session idles with `stop_reason: requires_action` → Anthropic POSTs `session.status_idled` to every registered endpoint (dev **and** prod).
9. **App, webhook.** `POST /webhook` → `settleDistillSession(sessionId)` (§4): retrieves the session, matches `metadata.app/target/run_id`, loads the run, lists all events, finds the unanswered call, runs `fmpTranscriptList` (`src/lib/fmp.ts`, `FMP_API_KEY` server-side), `events.send` the result, `deriveRunStatus(...) → 'working'`, writes **`runs.status`, `runs.list_cost_cents` (from `session.usage.list_cost`), `runs.last_activity_at`** — the only place cost and status are materialized, besides the reconciler re-running the same function.
10. **Repeat.** Twenty `fetch_transcript` calls (≤2 in parallel), each a webhook round trip; between them the agent writes `/workspace/notes/<FY>-Q<n>.md` with built-in `write` — sandbox-local, no webhook. Then it reads the notes back and calls `post_artifact` → `runDistillTool` inserts an `artifacts` row (`cma_tool_use_id` unique, `onConflictDoNothing`). The next `AutoRefresh` tick renders it through `injectArtifactHead` in the iframe.
11. **Finish.** The agent replies `posted NVDA 20 quarters — <shape>` → `end_turn` idle → one more webhook → no pending tools, `deriveRunStatus('idle', events) → 'idle'` → header shows "Updated just now" and, for admins, "Request update".
12. **Belt and suspenders.** `/api/cron/reconcile` (every 5 min) re-derives every non-ended run from the session; anything a dropped delivery left behind gets the same settle.

## 4. Follow one webhook end to end

`src/app/webhook/route.ts` — outside the cookie gate (`src/proxy.ts` matcher).

1. **Key check.** `anthropic.webhookKey` unset → 500 "webhook signing key not configured".
2. **Signature.** Raw `request.text()` (re-serialising would break it) → `anthropic.beta.webhooks.unwrap(body, {headers})` → 400 "invalid signature" on failure. Covered by `e2e/app.spec.ts`.
3. **Dedupe row.** Insert `webhook_events {id: event.id, type, resource, target}` with `onConflictDoNothing().returning()`; empty result → duplicate → 204. Retries reuse the event id, so this is per event, not per delivery.
4. **Route by prefix.** Only `session.*` types other than `session.deleted` settle; everything else logs and returns 204. Both settlers run in parallel; each retrieves the session and bails if the metadata is not its own (`settlePingPongSession` wants `metadata.smoke`, `settleDistillSession` wants `metadata.app === 'tfyi'` + `run_id`).
5. **Settle** (`src/lib/distill/settle.ts`), in order:
   - `sessions.retrieve` → `not-ours` / `other-target` skips.
   - Load the run by `metadata.run_id` → `unknown-run` skip.
   - `run.status === 'ended'` → `run-ended` skip (a late delivery must not resurrect a regenerated run).
   - `session.status === 'terminated' || session.archived_at` → write `runs.status = 'ended'`, `session-terminal` skip (answering would 409).
   - `listAllEvents` → `unansweredToolUses` → `runDistillTool` per call, in parallel; a tool exception becomes an `is_error` result, never a throw.
   - One `events.send` with every result (the agent may have issued parallel calls).
   - `deriveRunStatus(session.status, events, answeredNow)` → update `status`, `list_cost_cents`, `last_activity_at`. Return `{action:'synced', status, tools}`.
6. **Success.** `console.log("webhook", {id, type, resource, distill, smoke})` → 204.
7. **Failure.** Any throw from retrieve / events.list / events.send / Postgres is caught in the route: the dedupe row is deleted (best effort), `webhook settle failed` is logged, and the route returns **500** so Anthropic's three retries (5–120 s jittered) hit a fresh dedupe slot. Settle is idempotent, so a retry after a partial success is harmless.
8. **Reconciler's role** (`src/lib/ops/reconcile.ts`). If every retry is lost, the run sits at `requires_action` until the next 5-minute pass: for each non-ended run it retrieves the session (404 → mark `ended`; other errors → `unreachable`, skip), lists events, and on `drift` / `stuck` / `stale` calls the *same* `settleDistillSession`. It then sweeps sessions with `metadata.app='tfyi'` for this target that no live run knows about and archives those older than 60 min that are not running. `gc.ts` (daily) archives sessions of runs ended > 7 days and prunes `webhook_events` > 30 days.

## 5. Conventions

- **Server components by default.** `"use client"` only where a hook or browser API is needed: `add-subject`, `artifact-frame`, `auto-refresh`, `mobile-nav`, `request-update`, `sausage`, `sausage-layout`, `smoke-runner`, `login-form`. `shell.tsx` and `universe-nav.tsx` are server components (`universe-nav` imports `tickers.json` on the server so the 3000-row list never ships to the client).
- **Browser-only state via `useSyncExternalStore`, not setState-in-effect.** `artifact-frame.tsx` (`useMounted`), `sausage-layout.tsx` (localStorage + `matchMedia`, with a pre-paint inline script in `layout.tsx`). `mobile-nav.tsx` adjusts state during render to close on navigation.
- **Server actions return `{error}`** for user-facing failures and are consumed with `useActionState`: `addSubjectAction`, `regenerateSubjectAction`, `runSmokeAction`. `requireAdmin()` throws — it is defense in depth behind UI that only admins see. `createStackAction` throws deliberately (nothing to persist).
- **`deployTarget()` wherever CMA or shared storage is touched**: session metadata (`add.ts`, `smoke/session.ts`), every settler, the reconciler's orphan sweep, the `webhook_events.target` column, `key()` in `redis.ts`, the `dev` badge in `shell.tsx`, the smoke `handled_by`.
- **Redis keys go through `key(...)`** (`src/lib/redis.ts`) for the `<target>:` prefix; the only caller today is `smoke/storage.ts`.
- **drizzle `sql` template gotcha**: inside a correlated subquery, qualify the outer table's column by interpolating the table object — `listUniverse` (`src/lib/distill/queries.ts`) writes `${schema.subjects}.id`, not `subjects.id` or a bare `id`, so it resolves against the outer `subjects` rather than the aliased `artifacts a` / `runs r`.
- **Path alias** `@/*` → `src/*` (`tsconfig.json`, mirrored in `vitest.config.ts`). Scripts use it too via `tsx`.
- **Lint + dead code**: `eslint-plugin-simple-import-sort` and `unused-imports` are errors (`eslint.config.mjs`); `knip.json` treats `scripts/**` and `vitest.config.ts` as entries and ignores `components/ui`, `fmp.ts`, `massive.ts`. Export something nobody imports and knip fails.
- **The gate**: `npm run check` = `typecheck` + `lint` + `test` (vitest, `src/**/*.test.ts`) + `knip`. It runs on `git push` (`.githooks/pre-push`; `npm run prepare` sets `core.hooksPath`) and in `.github/workflows/ci.yml`. `npm run e2e` is Playwright against a built app on :3100 with dummy env (`e2e.yml`).
- **Migrations**: edit `schema.ts` → `npm run db:generate` → commit `drizzle/`; `vercel-build` migrates each environment on deploy. Never `db:migrate` against prod.
- **Env reads** are all server-side and listed in the runbook; adding one means adding a row there and to `.env.example`.

## 6. Where things are NOT

- **No ORM transactions.** `src/lib/db/index.ts` is `drizzle-orm/neon-http`, one fetch per query; writes are append-only or `onConflictDoNothing` so they don't need one.
- **No Redis on the product path.** `src/lib/redis.ts` exists and `smoke/storage.ts` INCRs a counter; nothing else reads or writes it. Transcripts are refetched from FMP per run.
- **No queue or worker.** The long-running work *is* the CMA session; the app is request/response + webhook + two crons.
- **No user table, no sessions table.** Auth is `HMAC(INVITE_CODE, "session-v1")` in a cookie (`src/lib/auth.ts`); admin is a second cookie keyed on `ADMIN_INVITE_CODE`. Rotating the code logs everyone out.
- **No DB rows for agent / environment / skill.** Found by name and metadata in Anthropic's resources (`src/lib/cma/stack.ts`); `runs.cma_*` records what a run was pinned to.
- **No CSP or SRI on the explainer iframe.** `sandbox="allow-scripts"` and pinned `crossorigin="anonymous"` CDN tags only (`artifact-frame.tsx`, `artifact/imports.ts`); hardening is a listed TODO in the root README.
- **No long-lived connections.** No SSE, no WebSocket; the page polls with `router.refresh()` and the drawer with `setInterval` + `fetch`. `drizzle-kit` opens a WebSocket at CLI time only.
- **No `middleware.ts`.** Next 16 uses `src/proxy.ts`.
- **No `error.tsx` boundaries.** A thrown server action (e.g. `requireAdmin`) shows Next's default error UI.
- **No tests beyond** `src/lib/cma/*.test.ts` and `e2e/app.spec.ts`; the settle and reconcile paths are exercised live, not mocked.

## 7. Glossary

- **subject** — a `subjects` row: `kind` + `key` (today `ticker` + upper-cased symbol). The unit of the universe.
- **run** — a `runs` row: one CMA session bound to subject × skill × target, pinned to `cma_agent_version` / `cma_skill_version`, with the materialized `status` and `list_cost_cents`. A subject has at most one live (non-`ended`) run by intent.
- **artifact** — an `artifacts` row: the HTML the agent handed back through `post_artifact`, unique on `cma_tool_use_id`, append-only; "latest" is max `created_at`.
- **target** — `DeployTarget = 'prod' | 'dev'` from `deployTarget()`; stamped into session metadata, `runs.target`, `webhook_events.target`, and Redis key prefixes so two deployments can share one workspace and one Redis.
- **stack** — environment + skill + agent for one target (`Stack` / `StackSpec` in `src/lib/cma/stack.ts`); `ensureStack` finds or creates it and publishes new versions on hash drift; `findStack` is the read-only twin.
- **settle** — `settleDistillSession` / `settlePingPongSession`: take a session id, answer whatever the agent is waiting on, write the derived run state. Idempotent; called by the webhook and the reconciler.
- **sausage** — "How the sausage was made": the admin drawer (`sausage-layout.tsx`, `sausage.tsx`) that reads live CMA through `/api/runs/[id]/trace` → `sessionTrace`. Allowed to cheat because it is off the render path.
- **hot path** — the server render's Postgres-only reads (`loadHotPath` in `page.tsx`, `timedUniverse` in `shell.tsx`), shown as `hot path · Nms · $0/view` in the green bar.
- **skill version / agent version** — CMA resources are immutable and versioned; `ensureStack` publishes a new skill version when `DISTILL_SKILL_MD` changes and a new agent version when `config_hash` (system + model + tools + skill hash) changes. Running sessions keep their version; "Regenerate" / "Request update" starts a fresh run on the current one.
- **reconciler / GC** — the two crons (`src/lib/ops/*`); reconciler repairs live runs every 5 min, GC archives old sessions and prunes dedupe rows daily. Both dry-run from the CLI.

## 8. Common changes — where to touch

- **Change what the agent produces** → `src/lib/distill/skill.ts` (and `src/lib/artifact/imports.ts` if the allowed libraries change; the skill interpolates `ARTIFACT_LIBS`). The next `addSubject` / regenerate publishes a new skill + agent version automatically; existing runs stay on theirs.
- **Change the model, effort, or system prompt** → `src/lib/distill/stack.ts`. Same versioning consequence; `config_hash` key names must stay stable or every agent re-versions.
- **Add a custom tool** → definition + implementation in `src/lib/distill/tools.ts`, mention it in the skill; results over ~100k chars truncate. Built-in tools (bash, web, …) are toggled in `NOTES_TOOLSET`.
- **Add a column** → `src/lib/db/schema.ts` → `npm run db:generate` → commit `drizzle/`; the deploy migrates. Keep writes append-only or `onConflictDoNothing`.
- **Change what the page shows** → `src/app/s/[key]/page.tsx` for the hot path (Postgres only — if you need a CMA field, materialize it in `settle.ts` first), `src/components/app/sausage.tsx` for the admin drawer (allowed to read live).
- **Change a ceiling** → `src/lib/distill/add.ts` (`RUN_BUDGET_CENTS`, `MAX_SUBJECTS`, `MAX_REGENERATIONS`), `BUMP_CENTS` in `src/app/s/actions.ts`, `STALE_MIN` / `ORPHAN_MIN_AGE_MIN` in `src/lib/ops/reconcile.ts`, grace/TTL days in `src/lib/ops/gc.ts`.
- **Change what is public** → `src/proxy.ts` matcher; crons stay on `CRON_SECRET`, `/webhook` stays open.
- **Add an env var** → read it server-side only, add it to `.env.example` and the runbook table, set it in Vercel for each environment.
- **Before pushing** → `npm run check`; the pre-push hook runs it anyway.
