# Cooperative review — 2026-08-29

Scope: `src/`, `scripts/`, `docs/app/*`, `README.md`, judged against the five principles (mainline reads Postgres only; webhook is the single idempotent seam; serverless only; simplest thing; secrets never reach the browser, `/webhook` and `/api/cron/*` outside the cookie). Five lenses (correctness, principles, composition, security, docs), every finding adversarially verified against the code. Duplicate findings from different lenses are merged below; the original count is noted in brackets. Nothing that spends money or mutates state was run; `npm run typecheck` clean, `npx vitest run` 6/6.

## 1. Verdict

**Not ready to hand to friends until three cost-safety fixes land — the admin gate fails open (`src/lib/auth.ts:63`), "Add to universe" has no ceiling (`src/app/s/actions.ts:23`), and the reconciler ends every live run on any transient CMA error (`src/lib/ops/reconcile.ts:47`) — but the architecture the principles describe is real in code: the mainline genuinely reads Postgres only, the idempotency core is pure and fixture-tested, the webhook verifies, dedupes and derives state from the event log, crons fail closed, and no secret reaches the browser.** The remaining fix-now items are a cluster of terminal-state bugs in settle/reconcile (a terminated or wrongly-ended run can be re-run, resurrected, or wedge the reconciler), the dedupe-before-settle ordering that neutralises Anthropic's retries, an admin-only "Request update" link shown to everyone, and docs/copy that still describe the 8-quarter/$10 product with no crons.

## 2. Findings table

Ranked by severity, then fix-now > fix-later. Severity is the skeptic's corrected severity where it differed.

| # | Severity | Accept | file:line | Title |
|---|---|---|---|---|
| 1 | high | fix-now | `src/lib/auth.ts:63` | Admin gate fails open: `ADMIN_INVITE_CODE` unset makes every invitee an admin |
| 2 | high | fix-now | `src/app/s/actions.ts:23` | No spend ceiling on Add to universe: any invitee can start unlimited $15-capped sessions |
| 3 | high | fix-now | `src/lib/ops/reconcile.ts:47` | Any `sessions.retrieve` error is treated as "session gone" and ends the run [2 lenses] |
| 4 | high | fix-now | `src/app/webhook/route.ts:40` | Dedupe row is written before settle, so a failed settle is never retried [2 lenses] |
| 5 | high | fix-now | `src/lib/distill/settle.ts:32` | Settle answers tools on terminated/archived sessions, then 409s and aborts the reconciler |
| 6 | medium | fix-now | `src/lib/distill/settle.ts:27` | Settle ignores `run.status='ended'` and resurrects ended runs on a late delivery |
| 7 | medium | fix-now | `src/app/s/[key]/page.tsx:58` | "Request update" is rendered for every viewer but submits an admin-only, cost-bearing action with no confirm [4 lenses] |
| 8 | medium | fix-now | `src/app/s/actions.ts:32` | `bumpBudgetAction` has no `requireAdmin()` (+$5 per call from any invite-cookie holder) |
| 9 | medium | fix-now | `docs/app/README.md:7` | Docs, runbook, UI copy say 8 quarters / $10; code is 20 quarters / $15 [2 lenses] |
| 10 | medium | fix-now | `docs/app/runbook.md:106` | Runbook says the reconciler and GC crons do not exist; they are built and scheduled; `CRON_SECRET` missing from env table |
| 11 | low | fix-now | `src/app/api/smoke/[sessionId]/route.ts:7` | `/smoke`, `/api/smoke/*` and the smoke actions are invite-gated, not admin-gated, contrary to "The line" [2 lenses] |
| 12 | low | fix-now | `src/app/login/actions.ts:23` | Post-login `next` allows backslash open redirect (`/\evil.com`) |
| 13 | low | fix-now | `docs/app/README.md:89` | Invariant says every `/api/*` is behind the cookie; `/api/cron/*` is deliberately not |
| 14 | medium | fix-later | `src/lib/distill/add.ts:77` | Concurrent `addSubject`/`regenerateSubject` can start two live runs for one subject; nothing dedupes [2 lenses] |
| 15 | medium | fix-later | `src/lib/distill/settle.ts:47` | No per-session serialization: reconciler's `stuck` predicate races every healthy in-flight webhook |
| 16 | medium | fix-later | `src/app/s/actions.ts:32` | `bumpBudgetAction` has no ceiling: +$5 per POST, forever |
| 17 | medium | fix-later | `src/app/login/actions.ts:11` | Invite login has no brute-force protection; no documented entropy requirement for the codes |
| 18 | medium | fix-later | `src/lib/distill/settle.ts:32` | Both settlers duplicate the answer-pending-tools → `events.send` block |
| 19 | medium | fix-later | `docs/app/README.md:18` | Architecture doc says `sandbox=""`, no scripts; code is `allow-scripts` + injected CDN libs |
| 20 | medium | fix-later | `docs/app/README.md:15` | Doc says `read` is the only built-in tool; distiller enables read/write/edit and a notes step |
| 21 | medium | fix-later | `docs/app/README.md:57` | Directory map omits `src/lib/ops`, `/api/cron`, `scripts/{reconcile,gc,tickers}`, `src/data`, 5 of 9 components |
| 22 | low | fix-later | `src/lib/smoke/ping-pong.ts:19` | `listAllEvents` is a CMA primitive living in `lib/smoke`; product code depends on smoke; `sessionTrace` re-implements it |
| 23 | low | fix-later | `src/lib/distill/queries.ts:58` | `latestStopReason` re-derived inline in `sessionTrace` and `inspectSmokeSession` |
| 24 | low | fix-later | `src/app/s/actions.ts:39` | `bumpBudgetAction` resumes the session but leaves `runs.status='budget_reached'` until next idle/reconcile |
| 25 | low | fix-later | `src/lib/ops/reconcile.ts:81` | Orphan sweep archives ended runs' sessions after ~1h, making GC's 7-day grace dead and the findings noisy |
| 26 | low | fix-later | `src/lib/ops/reconcile.ts:79` | Reconciler pages the whole workspace session list every 5 min under a 60 s cap; no `elapsedMs` |
| 27 | low | fix-later | `src/app/s/actions.ts:26` | `addSubjectAction` returns raw Anthropic SDK / Neon error messages to the browser |
| 28 | low | fix-later | `src/lib/db/schema.ts:50` | `RunStatus` declared twice; the schema copy is unused; mid-file import at `:17` |
| 29 | low | fix-later | `src/lib/distill/add.ts:1` | `add.ts` holds the whole run lifecycle; `src/app/actions.ts` is smoke-only at the app root |
| 30 | low | fix-later | `src/lib/ops/gc.ts:46` | GC dry-run "count" selects every expired id and counts client-side |
| 31 | low | fix-later | `docs/app/README.md:70` | Data-model table omits the reconciler as a writer of `runs.status`; runbook `:121` says "only the webhook" |
| 32 | low | fix-later | `README.md:38` | "Fold smoke/stack.ts and distill/stack.ts" is listed as future work but already done |
| 33 | low | fix-later | `src/lib/distill/tools.ts:50` | `post_artifact` description says "no scripts"; the skill mandates one `<script>` and Alpine/Chart.js |

Counts: 13 fix-now, 20 fix-later, 0 won't-fix, 2 refuted.

## 3. Fix-now findings

### 1. Admin gate fails open — `src/lib/auth.ts:63`
- **Claim:** `isAdmin` returns true whenever `ADMIN_INVITE_CODE` is unset, which is the documented current state in every environment; every invite-cookie holder is admin, sees Regenerate / Regenerate all in the sausage pane, and can start one fresh $15-capped Opus session per subject per click.
- **Evidence:** `src/lib/auth.ts:63` `if (!process.env.ADMIN_INVITE_CODE) return true;`; `src/app/s/actions.ts:48-61` `requireAdmin()` → `isAdmin()`; `src/lib/distill/add.ts:11,25` `max_list_cost = 1500`; `docs/app/runbook.md:16` "not set today".
- **Scenario:** A friend with the forwarded link clicks "Regenerate all": every live session is archived and N new sessions start, repeatable.
- **Smallest fix:** `if (!code) return false;` (fail closed), set `ADMIN_INVITE_CODE` in Vercel prod before sharing the link, update runbook §1. Do together with #8 or budget bumps stay open.
- **Skeptic:** Documented by design in three places, but not a "Below the line" TODO, and it is the single largest cost exposure for the demo; one line to close.

### 2. No spend ceiling on Add to universe — `src/app/s/actions.ts:23`
- **Claim:** `addSubjectAction` validates only `/^[A-Z.\-]{1,10}$/`, never checks `tickers.json` server-side, has no rate limit and no cap on universe size or runs per hour; each distinct key starts a `claude-opus-5` session capped at $15. Combined with #8/#16, the per-run cap is also bypassable, so exposure per invitee is unbounded.
- **Evidence:** `src/app/s/actions.ts:18-23`; `src/lib/distill/add.ts:75-89` (`activeRun` null → `startRun`); `src/data/tickers.json` only imported client-side (`add-subject.tsx:18`, `universe-nav.tsx:9`); Redis used only by smoke storage; auth is one shared HMAC cookie (README #14).
- **Scenario:** A script loops `AAA, AAB, …`; 100 adds = 100 concurrent Opus sessions, up to $1,500, plus `ensureDistillStack` paginating the workspace per add.
- **Smallest fix:** In `addSubject`, reject when `count(subjects) >= UNIVERSE_CAP` or runs created in the last hour ≥ N; require the key to be in `tickers.json` (one import). Set a workspace spend limit in the Anthropic Console as the backstop no code path can bypass.
- **Skeptic:** Forwardable link is a deliberate decision (README #14); what is missing is the cheap ceiling behind it. Confirmed no limiter exists anywhere.

### 3. Reconciler ends a run on any `sessions.retrieve` error — `src/lib/ops/reconcile.ts:47`
- **Claim:** The bare `catch` around `sessions.retrieve` treats every error (429 after SDK retries, 5xx, network) as "missing" and, with `apply=true` (the cron default), sets `runs.status='ended'` for a live, spending session. `activeRun` then returns null, the page offers "Request update", `addSubject` starts a second session, and the original session's next webhook resurrects the old row (#6) → two live runs per subject.
- **Evidence:** `src/lib/ops/reconcile.ts:45-54`; `src/app/api/cron/reconcile/route.ts:10` `reconcile({ apply: !dry })`; `src/lib/distill/queries.ts:38-46`; `src/lib/distill/add.ts:77`; `src/lib/distill/settle.ts:53-57` unconditional status write; no `NotFoundError` check anywhere in `src/`. README `:32` says "ends runs whose session is gone" — the code contradicts the intent.
- **Scenario:** Anthropic returns 503 for 30 s at 12:05; the pass ends all 8 live runs; a friend re-adds NVDA; a duplicate session starts while the original keeps spending.
- **Smallest fix:** `if (err instanceof Anthropic.NotFoundError || err?.status === 404)` → end; otherwise push a finding and `continue` without the update.
- **Skeptic:** Certain. SDK absorbs sub-second blips (2 retries, ~1.5 s), so the trigger is "outage longer than a couple of seconds during the pass" — trivially met.

### 4. Dedupe row is written before settle — `src/app/webhook/route.ts:40`
- **Claim:** The `webhook_events` row is committed (`onConflictDoNothing`, 204 on conflict) before `settleDistillSession`/`settlePingPongSession` run, with no try/catch and no compensating delete. Any unguarded throw in settle (`sessions.retrieve`, `listAllEvents`, `events.send` after SDK retries, the `runs` UPDATE, Vercel function timeout) returns 500 with the row committed, so Anthropic's 3 retries of the same event id are answered 204 "duplicate" and do nothing. Tool-execution failures (FMP, artifact insert) are *not* in this class: `settle.ts:35` converts them to `is_error` results.
- **Evidence:** `src/app/webhook/route.ts:40-57`; grep: nothing in `src/` or `scripts/` deletes from `webhook_events`; `src/lib/distill/settle.ts:21,29,47,51` unguarded.
- **Scenario:** CMA 502 on `events.send` after the agent's `post_artifact`; route 500s; retries 5–120 s later all 204; run sits at `requires_action` ("Updating…") until the 5-minute reconciler — on every such transient, not only after 3 dropped deliveries; indefinitely if the reconciler is wedged by #5.
- **Smallest fix:** Insert the dedupe row after a successful settle (settle is idempotent, so a slipped duplicate is harmless), or wrap settle in try/catch that best-effort deletes the row and rethrows.
- **Skeptic:** Impact bounded to ~5 min by the reconciler (README row 24 already accepts that for dropped deliveries), but the ordering converts every handler failure into a dropped delivery and makes the platform retries the README relies on worthless; not a declared TODO.

### 5. Settle runs tools on terminated/archived sessions and can wedge the reconciler — `src/lib/distill/settle.ts:32`
- **Claim:** `settleDistillSession` never checks `session.status === 'terminated'` / `archived_at`. A terminated session with an unanswered `custom_tool_use` gets its tools re-executed (FMP fetch or artifact insert), then `events.send` rejects (409 for archived per `docs/managed-agents/api-reference.md:242`), the function throws, and the `runs.status` write at `:51-54` never happens. After Regenerate this costs one 500 and possibly a redundant tool run (the run is already `ended` via `add.ts:54`, retries deduped). The serious case is a terminated session with pending tools whose runs row is still live (archive succeeded but the DB update failed, or platform termination at `requires_action`): every 5-minute pass sees drift, calls settle, throws, and `reconcile()` aborts before the remaining runs and the orphan sweep — permanently, since the status write is never reached.
- **Evidence:** `src/lib/distill/settle.ts:21-56` no guard; `src/lib/ops/reconcile.ts:72-75` no per-run try/catch (only `sessions.retrieve` is guarded, `:44-53`); `src/lib/distill/add.ts:53` archives mid-run; `core.md:180,283`, `events.md:87`.
- **Scenario:** As above; also a reordered/late `session.status_idled` arriving after termination hits the same throw.
- **Smallest fix:** In settle, when `session.status === 'terminated'` skip tool execution and write the derived `'ended'`. In reconcile, wrap the per-run settle in try/catch and record the error as a finding.
- **Skeptic:** Likely (409 taken from the project's own docs, not exercised live). Narrower than claimed for the Regenerate path, but the wedge case has no recovery path when it occurs; runbook `:77`'s "harmless" covers only unknown-run, not archived-with-row.

### 6. Settle resurrects ended runs — `src/lib/distill/settle.ts:27`
- **Claim:** Settle checks only that the run exists, never `run.status === 'ended'`, then answers pending tools against the old run and overwrites `status` with whatever `deriveRunStatus` says. Two triggers: (a) `regenerateSubject` swallows archive errors (`add.ts:53` `.catch(() => {})`) and marks `ended` anyway; (b) #3's `missing` branch. The next webhook flips the row back to `working` → two live runs per subject, artifacts race on `created_at`, and the orphan sweep skips running sessions (`reconcile.ts:83`).
- **Evidence:** `src/lib/distill/settle.ts:26-27,48-53`; `src/lib/distill/add.ts:53-54`; `src/lib/ops/reconcile.ts:44-52`; `typescript-examples.md:381-392` says poll until not running before archiving, so Regenerate on a working run is the likeliest archive failure.
- **Scenario:** Admin clicks Regenerate while CMA archive returns 5xx; old session keeps running, row says `ended`; its next tool call resurrects it.
- **Smallest fix:** Early-return `{ action: 'skipped', reason: 'ended-run' }` when `run.status === 'ended'` (optionally archive if session not terminated); log archive failures in `add.ts`; do #3.
- **Skeptic:** Likely; code path is unconditional, so one failed archive/retrieve is enough. Not in "Below the line" (the webhook sprint lists orphans/dropped deliveries/FMP retries, not resurrection).

### 7. "Request update" for every viewer, no confirm, throws for non-admins — `src/app/s/[key]/page.tsx:58`
- **Claim:** `<RequestUpdate/>` renders in the idle branch for all viewers (the page already computes `admin` at `:24` and uses it only for `panel`), submitting `regenerateSubjectAction` via a bare `<form action>` with no confirm (the pane's button at `sausage.tsx:90` has one). Today (everyone admin) any invitee ends and archives the live session and starts a ~$1.50 re-distill with one click; once `ADMIN_INVITE_CODE` is set, `requireAdmin()` throws `Error('admin only')` uncaught, and with no `error.tsx` under `src/app` the friend gets Next's default error UI. README `:26` and runbook §6 document Regenerate as pane-only; this link is undocumented.
- **Evidence:** `src/app/s/[key]/page.tsx:47-58,62`; `src/components/app/request-update.tsx:20`; `src/app/s/actions.ts:48-56`; `src/lib/auth.ts:63`.
- **Scenario:** Friend sees "Request update" beside an up-to-date ticker and clicks it.
- **Smallest fix:** `admin ? <RequestUpdate .../> : null`; add the same `confirm()` as the pane; have the action return `{ error }` instead of throwing. Mention it in runbook §6.
- **Skeptic:** Certain. Commit 1adb950 says "(no dialog)" so the missing confirm is deliberate, but the non-admin rendering is not; cost is the ~$1.50 expected spend, not the $15 cap.

### 8. `bumpBudgetAction` has no `requireAdmin()` — `src/app/s/actions.ts:32`
- **Claim:** The only admin-pane server action without the gate; the UI hides the button but the action is callable by any invite-cookie holder (`src/proxy.ts` checks only `tfyi_session`) and raises a session's `max_list_cost` by $5 per call via a live `sessions.update`. Moot today (everyone admin); a real hole the moment #1 lands.
- **Evidence:** `src/app/s/actions.ts:32-46` vs `:52,:58`; `docs/app/runbook.md:109` already lists it as a sharp edge.
- **Scenario:** After `ADMIN_INVITE_CODE` is set, any invitee POSTs `runId` repeatedly.
- **Smallest fix:** `await requireAdmin()` at the top (one line). Optionally move the CMA calls to `lib/distill` as `bumpRunBudget` — tidiness only.
- **Skeptic:** Known sharp edge but not in "Below the line"; must ship with #1 or #1 is incomplete. The ceiling is a separate item (#16).

### 9. Docs, runbook and UI copy say 8 quarters / $10 — `docs/app/README.md:7`
- **Claim:** `docs/app/README.md:7,14,15`, `docs/app/runbook.md:50,51`, `README.md:27`, `src/app/s/[key]/page.tsx:69` ("Reading the last eight calls…"), `src/components/app/add-subject.tsx:55` ("last 8 earnings calls") all describe the pre-decision-25 product; only README decision 25 matches `src/lib/distill/add.ts:11` (`1500`) and `skill.ts:15,22,64` ("twenty").
- **Evidence:** As listed; verified by grep.
- **Scenario:** Operator budgets Regenerate-all at $1.50/subject per runbook §6 while a run may spend up to $15 and take well over 3 min; user reports a bug when the explainer covers 20 quarters.
- **Smallest fix:** One `DISTILL_QUARTERS = 20` constant interpolated into the skill, page copy and toast; update the four doc sites; re-measure NVDA cost/wall.
- **Skeptic:** Certain, medium: copy/doc drift, no code failure — but the docs index is dated today and claims to be current.

### 10. Runbook says the crons do not exist; `CRON_SECRET` missing from env table — `docs/app/runbook.md:106`
- **Claim:** §9 says "The reconciler cron is not built yet" (`:106`) and "`webhook_events` grows unbounded until the GC cron exists" (`:112`); §1 (`:3` promises every `process.env` read is listed) has no `CRON_SECRET` row. `vercel.json` schedules both crons; `src/lib/ops/{reconcile,gc,cron-auth}.ts`, `src/app/api/cron/*`, `npm run reconcile|gc` exist; `cron-auth.ts:8` reads `CRON_SECRET` and fails closed. Also `:121` "only written by the webhook" is false (see #31).
- **Evidence:** As listed; grep of `process.env` across `src/` and `scripts/` confirms `CRON_SECRET` is the only unlisted read.
- **Scenario:** 2am operator manually settles what the cron is about to settle (harmless, wasted); a new environment never sets `CRON_SECRET` and every cron 401s silently.
- **Smallest fix:** Rewrite §9 lines 106/112 to point at the crons and CLIs; add a `CRON_SECRET` row (dev unset; preview/prod set; fail-closed); update §10's `requires_action` row to "wait up to 5 min".
- **Skeptic:** Certain; medium not high — the manual settle is idempotent, so the harm is time and dead crons on a fresh env.

### 11. Smoke surface is invite-gated, not admin-gated — `src/app/api/smoke/[sessionId]/route.ts:7`
- **Claim:** `/smoke` (server-renders `findSmokeStack` + `listSmokeSessions` against live CMA), `/api/smoke/[sessionId]` (full `events.list` of any session id, no `metadata.smoke`/target filter) and `createStackAction`/`runSmokeAction` (`src/app/actions.ts:13-38`) have no `isAdmin` check, unlike the trace route and regenerate actions. `docs/app/README.md:24-27` lists `/smoke` under Sausage with "Who: Admin cookie".
- **Evidence:** `src/app/smoke/page.tsx:15-21`; `src/lib/smoke/session.ts:54-58`; `src/proxy.ts:22`.
- **Scenario:** Once `ADMIN_INVITE_CODE` is set, an invitee who types the URL runs smoke (~$0.17 each, $2 cap) or polls any session id they hold. Today moot; link is only in the admin-only drawer.
- **Smallest fix:** Same `isAdmin(cookie)` check → `notFound()` at the top of `smoke/page.tsx`, `requireAdmin()` in both actions and the route. Two lines each.
- **Skeptic:** Certain, low: `createStackAction` is idempotent found-or-create; distiller ids are only visible to admins. Contradicts README decision 22 rather than a TODO.

### 12. Backslash open redirect after login — `src/app/login/actions.ts:23`
- **Claim:** `next.startsWith("/") && !next.startsWith("//")` admits `/\evil.com`; `new URL("/\\evil.com", origin).href === "https://evil.com/"`. Traced Next 16.3.3's action redirect (`action-handler.js:261,906`, `assign-location.js`, `server-action-reducer.js:248-253`): the client resolves it as external and hard-navigates.
- **Evidence:** `src/app/login/actions.ts:23`; `src/app/login/login-form.tsx:15` hidden `next` input; `/login` excluded from the proxy matcher.
- **Scenario:** `https://transcripts.fyi/login?next=/\evil.com&invite=<real code>` — victim logs in on the real page, lands on a lookalike asking to re-enter the code.
- **Smallest fix:** Also reject `next.startsWith("/\\")`, or any backslash.
- **Skeptic:** Certain; low because only the invite code is at stake and it needs a social-engineered link. One-token fix.

### 13. Invariant omits `/api/cron/*` — `docs/app/README.md:89`
- **Claim:** "Everything else, including `/api/*`, is [behind auth]" — but `src/proxy.ts:22` excludes `api/cron`, gated instead by `CRON_SECRET` bearer (`src/lib/ops/cron-auth.ts`). Root README `:32,:75` and `e2e/app.spec.ts:79` are correct.
- **Smallest fix:** "`/webhook`, `/login`, and `/api/cron/*` are never behind the cookie; crons are gated by `CRON_SECRET`. Everything else, including the rest of `/api/*`, is."
- **Skeptic:** Certain, low, doc-only; the code matches principle 5. Fix-now because it is one sentence in an "Invariants" list an auditor trusts.

## 4. Fix-later (paste into README "Below the line")

- `src/lib/distill/add.ts:77` — no partial unique index on live `(subject_id, skill)` runs; two clients (or a double-submit on the unguarded `request-update.tsx` form) can start two live sessions; nothing dedupes. Cost only.
- `src/lib/distill/settle.ts:47` / `reconcile.ts:63` — no per-session serialization; the reconciler's `stuck` predicate (idle + pending) matches every healthy in-flight webhook, so each 5-min pass can double-run tools and double-send a `custom_tool_result`. Cheapest: treat "already answered" on a 4xx from `events.send` as success; gate `stuck` on pending age > ~3 min; per-run try/catch in reconcile.
- `src/app/s/actions.ts:32` — `bumpBudgetAction` has no upper bound: clamp at a `HARD_CAP_CENTS`.
- `src/app/login/actions.ts:11` — no brute-force protection on login; document that `INVITE_CODE`/`ADMIN_INVITE_CODE` must be long and random (.env.example, runbook); optional per-IP `INCR`+`EXPIRE` in Upstash.
- `src/lib/distill/settle.ts:32` / `src/lib/smoke/ping-pong.ts:38` — identical answer-pending-tools → `events.send` block in both settlers; extract `answerPendingToolUses` next to `cma/events.ts` during the smoke/distill fold.
- `src/lib/smoke/ping-pong.ts:19` — `listAllEvents` is a CMA primitive imported by `settle.ts:8` and `reconcile.ts:8`; `queries.ts:52-55` re-implements it. Move to `src/lib/cma/`.
- `src/lib/distill/queries.ts:58` / `src/lib/smoke/session.ts:60` — import the tested `latestStopReason` instead of inline copies (keep smoke's `idle` gating).
- `src/app/s/actions.ts:39` — after a budget bump, call `settleDistillSession(run.cmaSessionId)` so the header stops saying "Paused (budget)" until the next idle/reconcile.
- `src/lib/ops/reconcile.ts:39` — build `known` from all runs, not only non-ended, so ended runs' sessions stop showing as "orphan" every pass and GC's 7-day grace applies.
- `src/lib/ops/reconcile.ts:79` — add `elapsedMs` to the report; pass `agent_id`/`statuses`/`created_at[gte]` to `sessions.list`; README "~2 CMA reads per live run" undercounts events pagination and the sweep. `STALE_MIN = 20` was tuned for 8 quarters and will fire on most healthy 20-quarter passes.
- `src/app/s/actions.ts:26` — return a fixed message instead of raw Anthropic/Neon error text to invitees.
- `src/lib/db/schema.ts:50` — delete the unused `RunStatus` copy (or `text().$type<RunStatus>()` from `cma/events`); hoist the `:17` import.
- `src/lib/distill/add.ts` → `runs.ts`; `src/app/actions.ts` → `src/app/smoke/actions.ts`; fix the stray indent at `add.ts:68-74`.
- `src/lib/ops/gc.ts:46` — use `count()` (as `smoke/storage.ts:11` does) instead of selecting every id; the apply branch's `.returning({ id })` has the same shape.
- `docs/app/README.md:18` — iframe is `sandbox="allow-scripts"` + `injectArtifactHead` (Chart.js/Alpine/lucide from jsDelivr, `src/lib/artifact/imports.ts`); note the punted CSP/SRI items.
- `docs/app/README.md:15,7` — distiller toolset is read/write/edit with per-quarter notes under `/workspace/notes/`, twenty fetches, read-back, then `post_artifact`.
- `docs/app/README.md:36-65` — directory map: add `src/lib/ops/*`, `src/app/api/cron/*`, `src/lib/artifact/imports.ts`, `src/data/tickers.json`, `scripts/{reconcile,gc,tickers}.ts`, and the five missing components.
- `docs/app/README.md:70` / `runbook.md:121` — reconciler also writes `runs.status='ended'` (no webhook_events row) and re-settles from the cron; mention `cron:reconcile`/`cron:gc` log lines in §10.
- `README.md:38` — the smoke/distill stack fold is done (`cma/stack.ts` generic + two thin specs); reword to "drop smoke's `shape()`/`SmokeStack` and use `Stack`" or delete.
- `src/lib/distill/tools.ts:50` — `post_artifact` description says "no scripts"; reword to "inline CSS and one inline `<script>`; no `<script src>`/`<link>`", batched with the next skill change (changes `config_hash` → new agent version).

## 5. Won't-fix / taste

No verified finding was classed won't-fix. Taste nits from the notes, not counted: Console session URL built in three places (`distill/queries.ts:99`, `smoke/session.ts:129`, `smoke/page.tsx:90`); `err instanceof Error ? err.message : String(err)` ×10; `Sausage`'s hand-copied `Trace` type could be `Awaited<ReturnType<typeof sessionTrace>>`; drawer open/closed default encoded in three files (deliberate for pre-paint — add a cross-referencing comment); `READ_ONLY_TOOLSET` comment "shared by every stack" no longer true; `regenerateAll` in one server action multiplies the orphan window by N and can hit the function timeout — already covered by "Below the line".

## 6. Appendix: refuted

- `src/lib/distill/stack.ts:6` "APP constant duplicated in smoke" — the only writer of session `metadata.app` (`add.ts:24`) and both readers import the same `APP`; smoke sessions carry `metadata.smoke`, never `app`; `smoke/stack.ts:7`'s literal is stack metadata compared against itself. No failure mode.
- `src/proxy.ts:22` "money-spending actions rely solely on the proxy; a cross-route action forward could bypass it" — traced Next 16.3.3: `/login`'s module graph lacks the actions, so a spoofed `Next-Action` POST goes through `createForwardedActionResponse`, which re-enters via the public origin with the original (cookie-less) headers, hits the proxy, gets a 302 (non-RSC) and never executes. Matcher prefix looseness (`/loginX`) hits `/_not-found`, same path.

## 7. What is solid

- Mainline: `/` and `/s/[key]` await only `listUniverse`/`getSubject`/`latestArtifact`/`activeRun` plus the cookie; the trace is client-fetched from an admin-gated route that 502s on CMA failure without touching the page.
- Webhook: Standard-Webhooks signature on the raw body (timestamp tolerance bounds replay), 400 on bad signature, 500 when the key is unset, event-id dedupe, prefix routing; `unansweredToolUses`/`deriveRunStatus` are pure, fixture-tested against a real capture including parallel tool-call batches; artifacts unique on `cma_tool_use_id`; `deployTarget` filtered in every settler and the orphan sweep; FMP-down inside a tool becomes `is_error`, never an owed answer.
- Crons: `timingSafeEqual`, fail closed on missing `CRON_SECRET`, outside the proxy, e2e covers 401; reconcile and GC reuse `settleDistillSession` rather than re-implementing repairs.
- Secrets/GenUI: no `NEXT_PUBLIC_`; all env reads server-side; `sandbox="allow-scripts"` via `srcDoc` with no `allow-same-origin`/forms/top-navigation/popups; CDN tags pinned with `crossorigin="anonymous"`. Residual for the hardening pass: transcript text is a prompt-injection channel into HTML every viewer sees; a `<meta http-equiv="Content-Security-Policy">` injected by `injectArtifactHead` (`connect-src 'none'`) closes most of it cheaply.
- `cma/stack.ts` is a clean generic with two thin specs; typecheck, vitest (6/6) and knip clean; root README's cron and GenUI paragraphs match the code — the staleness is concentrated in `docs/app/*`.
