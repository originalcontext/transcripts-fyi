# CMA loop resilience review — 2026-08-29

Question under test: when a user adds a company or requests an update, does the run eventually complete — or land in a clearly-paused state the UI shows — no matter which single thing fails? Scope: `src/app/webhook/route.ts`, `src/lib/distill/{settle,tools,add}.ts`, `src/lib/cma/events.ts`, `src/lib/fmp.ts`, `src/lib/ops/{reconcile,gc}.ts`, `src/app/api/cron/*`, `src/lib/anthropic.ts`, `vercel.json`, the SDK (`@anthropic-ai/sdk` 0.122.0) and `docs/managed-agents/*`. Read-only; `npm run typecheck` clean, `npx vitest run` 7/7. Nothing that spends or mutates was run. Builds on the fixes already landed from `docs/reviews/2026-08-29-cooperative-review.md` (reconciler ends only on 404, settle skips ended runs and terminal sessions, webhook releases its dedupe row and 500s on a failed settle).

Facts that shape everything below:

- SDK defaults: `maxRetries = 2` (`client.js:113`), backoff 0.5 s → 1 s, capped 8 s, honours `retry-after` (`client.js:744-782`); per-attempt `timeout = 10 min` (`client.js:903`); retries 408/409/429/5xx (`client.js:729-741`), never 400/404. Not overridden anywhere (`src/lib/anthropic.ts:7` is `new Anthropic()`).
- Vercel (Fluid compute, default for new projects): `maxDuration` default 300 s on every plan, max 300 s Hobby / 800 s Pro. `/webhook` sets none → 300 s. Crons set 60 (`src/app/api/cron/reconcile/route.ts:4`, `gc/route.ts:4`).
- Node `fetch` has no overall timeout; `src/lib/fmp.ts:78` passes no signal, so a hung FMP holds the function until undici's 300 s headers timeout.
- Anthropic webhook retries: 3 attempts, 5–120 s jittered, then dropped silently (`docs/managed-agents/webhooks.md:128`); endpoint auto-disables on *sustained* failure, a single 2xx resets the window (`webhooks.md:133`).
- `events.list` default page 1000 (`docs/managed-agents/events.md:8`); a 20-quarter run is ~300 events (fixture: 79 events for 10 tool calls, `src/lib/cma/__fixtures__/`), so `listAllEvents` (`src/lib/smoke/ping-pong.ts:19-23`) is one request of ~1–1.5 MB (twenty ~50 KB transcript results plus the artifact HTML).
- `session.status_idle{requires_action}` carries `stop_reason.event_ids` = exactly the still-unresolved tool-use ids; partial answers re-emit the idle with the remainder (`events.d.ts:714-721`, fixture confirms).
- The partial unique index `runs_one_live_per_subject_skill` is declared in `src/lib/db/schema.ts:52` but **no migration in `drizzle/` creates it** (`0000`–`0003` and `meta/*` have no such index). It is not enforced in any environment until `npm run db:generate` runs and the file is committed.

## (a) Failure-mode table

| # | Mode | Today | Completes? | Recovery | Mitigation (one line) |
|---|---|---|---|---|---|
| 1 | Webhook dropped after 3 retries | Session idles `requires_action`; `runs.status` stays `working`; reconciler `stuck` (`reconcile.ts:74-77`) → settle answers | Yes | ≤ 5 min (+ pass time); user sees "Updating…" / "Distilling — report coming soon" (`page.tsx:51-52`) with 5 s auto-refresh | Already right; tighten `stuck` with a quiet gate (P7) |
| 2 | Handler exceeds function timeout | No `maxDuration` on `/webhook` → 300 s; normal work ≈ 3–5 s; a hung FMP is the only way to 300 s. On kill the dedupe row survives (delete at `route.ts:64` never runs) → retries 204 → reconciler | Yes | ≤ 5 min; sustained hangs risk endpoint auto-disable | `maxDuration = 60`, `AbortSignal.timeout(15_000)` + one retry on FMP, SDK `timeout: 20_000` (P1) |
| 3 | FMP down / slow / plan lapsed | `FmpError` → `settle.ts:42-45` → `is_error` result; skill has no error guidance; agent retries at will, each retry = a model turn + webhook round trip | Usually not; ends `budget_reached` with no artifact after ~$15 | Never on its own; shows "Paused (budget)" | Retry once server-side; after ≥ 3 consecutive error results send a trailing `system.message` "stop"; add an error rule to the skill (P1, P5) |
| 4 | Anthropic 429/5xx on retrieve / list / send | SDK 3 attempts (~1.5 s) → settle throws → row released, 500 (`route.ts:61-67`) → Anthropic retries 3× (each re-runs settle) → reconciler | Yes | Outage end + ≤ 5 min. Gap: `listAllEvents` (`reconcile.ts:64`) and settle (`:83`) are unguarded, one throw aborts the pass and the orphan sweep | Per-run try/catch + elapsed guard (P2); client `timeout: 20_000` so a hung TCP fails in 20 s not 10 min (P1) |
| 5 | Full `events.list` per delivery | One request, ~1–1.5 MB, parsed in ~20 ms; admin trace pane does the same every 5 s per viewer (`queries.ts:49-56`) | Yes | n/a | Leave for the webhook; bounded window (`order:'desc', limit, types`) is a 10-line option if p95 matters (P8) |
| 6 | Session hangs in `running` | `stale` = `working` and `runs.lastActivityAt` > 20 min (`reconcile.ts:33,78`); settle then rewrites `lastActivityAt` (`settle.ts:60`), resetting the clock; no nudge ever sent | No — "Updating…" forever; spend only sandbox time ($0.08/h) | Never | Quiet-time from events' `processed_at`; interrupt → "continue from notes" → end, counted in session metadata (P6) |
| 7 | `budget_reached` | `events.ts:36-37` → "Paused (budget)" for everyone (`page.tsx:53-54`); admin bumps +$5 (`actions.ts:32-47`), no ceiling; `runs.status` flips back on the next `session.status_idled` or reconcile (`session.status_run_started` is not subscribed, `runbook.md:35`) | Paused, visible | Manual | Keep manual (README #18/#25); add `HARD_CAP_CENTS` and call settle after the bump (P9) |
| 8 | `retries_exhausted` / `terminated` | `ended` via `events.ts:38-39` / `settle.ts:31-34`; `activeRun` excludes ended → admin sees "Request update" (`page.tsx:57-58`); the "Ended" branch at `:55` is unreachable; non-admins see nothing | Ends cleanly; regenerate works | Immediate | Header copy for a failed last run (P9) |
| 9a | Regenerate: archive fails non-404 | `add.ts:58` swallows; row marked `ended`; old session keeps running until its next custom tool, then blocks (`settle.ts:29` skips `run-ended`); orphan sweep archives after 60 min (`reconcile.ts:93`) | New run completes; old spends ≤ 1 turn | 60 min to archive | Interrupt → poll idle → archive, abort unless 404/already-archived, mark ended only after (P4) |
| 9b | Concurrent add/regenerate | Both pass `activeRun` (`add.ts:78`), both `sessions.create` (`:22`), both insert (`:32`); index not migrated → two live runs; once migrated → second insert throws after the session exists → orphan (blocks at first tool, archived ≤ 60 min) | Yes, with a stray | 60 min | Generate the migration; create idle → insert → kick, archive on conflict (P3) |
| 10 | Two deliveries, two instances, same session | Both list, both run FMP (2× cost), artifact insert safe (`tools.ts:97-108`, unique `cma_tool_use_id`), both `events.send` the same id — docs don't say; a 400 is not retried and makes the loser 500, a 409 is retried twice then thrown (`client.js:733`). Loser releases its row, Anthropic redelivers, next pass finds nothing pending | Yes | ≤ 120 s of noise | On 4xx from `send`, re-list; if none of ours pending → success (P7) |
| 11 | Reconciler at 100 live runs | ≥ 2 CMA calls per run (+ 3 on settle) + unfiltered `sessions.list` over the whole workspace, under 60 s, runs unordered (`reconcile.ts:41`) → 504 mid-pass, same tail starves, orphan sweep never runs | Not for the tail | Never for starved runs | Order by `lastActivityAt asc`, `limit 40`, 45 s elapsed guard, filtered `sessions.list` (P2) |
| 12 | Orphan session from a failed `runs` insert | Runs `initial_events` → first turn → `list_transcripts` → webhook `unknown-run` (`settle.ts:27`) → never answered → blocks; sweep archives at 60 min | n/a | 60 min, cost ≈ one turn | Covered by P3 ordering; sweep should interrupt running orphans (P2) |

Column "Completes?" answers the goal: today every mode completes or pauses visibly except #3 (FMP outage burns the budget) and #6 (hung `running` is invisible and unbounded in time), plus the starvation in #11 at scale.

## (b) Patch list — smallest first

### P1 — bound every outbound call in the handler (certain)

Files: `src/app/webhook/route.ts`, `src/lib/fmp.ts`, `src/lib/anthropic.ts`.

```ts
// src/app/webhook/route.ts — fail fast so Anthropic's 5–120 s retries do the work, not the 5-min cron
export const maxDuration = 60;

// src/lib/anthropic.ts — 20 s per attempt × 3 attempts + 1.5 s backoff ≈ 62 s worst case
export const anthropic = new Anthropic({ timeout: 20_000 });

// src/lib/fmp.ts — replace the bare fetch at :78
const FMP_TIMEOUT_MS = 15_000;
const retryable = (status: number) => status === 429 || status >= 500;
async function fmpFetch(url: URL, attempt = 0): Promise<Response> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(FMP_TIMEOUT_MS) });
    if (retryable(res.status) && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1_000));
      return fmpFetch(url, 1);
    }
    return res;
  } catch (err) {
    // AbortError / network: one retry, then surface
    if (attempt === 0) return fmpFetch(url, 1);
    throw err;
  }
}
```

Why these numbers: two FMP calls run in parallel (`settle.ts:39`), so worst FMP time is 2 × 15 s + 1 s; CMA calls are sequential (retrieve → list → send). 60 s covers a slow-but-alive path and turns a hung one into a 500 within Anthropic's retry window instead of a 300 s function that Anthropic already gave up on. 401/402/403 from FMP are not retried — a lapsed plan should fail once and go to P5.

### P2 — reconciler: never abort a pass, never starve, bound the sweep (certain)

File: `src/lib/ops/reconcile.ts`; optionally `src/app/api/cron/reconcile/route.ts` (`maxDuration = 120`).

```ts
const PASS_BUDGET_MS = 45_000;
const PASS_LIMIT = 40;
const t0 = Date.now();
const runs = await db.select().from(schema.runs).where(ne(schema.runs.status, "ended"))
  .orderBy(asc(schema.runs.lastActivityAt)).limit(PASS_LIMIT);

for (const run of runs) {
  if (Date.now() - t0 > PASS_BUDGET_MS) { findings.push({ kind: "deferred", runId: run.id }); continue; }
  try {
    /* existing body: retrieve → list → findings → settle */
  } catch (err) {
    findings.push({ kind: "error", runId: run.id, error: msg(err) }); // one bad run no longer kills the pass
  }
}

// Orphan sweep: only what could be spending, only recent, and stop running ones instead of waiting
for await (const s of anthropic.beta.sessions.list({
  statuses: ["running", "rescheduling", "idle"],
  "created_at[gte]": new Date(Date.now() - 7 * 86_400_000).toISOString(),
})) {
  if (Date.now() - t0 > PASS_BUDGET_MS) break;
  /* existing filter */
  if (apply && ageMinutes > ORPHAN_MIN_AGE_MIN) {
    if (s.status === "running") await anthropic.beta.sessions.events.send(s.id, { events: [{ type: "user.interrupt" }] });
    else await anthropic.beta.sessions.archive(s.id);
  }
}
```

`known` should be built from *all* runs (ended included) so ended runs' sessions stop reading as orphans and GC's 7-day grace applies (review #25). Report `elapsedMs` so "how often does the reconciler find anything" becomes a log line.

### P3 — one live run per subject, enforced (certain)

Files: `drizzle/` (new migration via `npm run db:generate`), `src/lib/distill/add.ts`.

The index is already in `schema.ts:52`; generate and commit the migration so `vercel-build` applies it. Then make `startRun` conflict-safe by registering the session idle first (no `initial_events` → no work, no model spend; `core.md:173`), inserting the row, and kicking only after the insert succeeded:

```ts
async function startRun(subject: Subject, target: DeployTarget) {
  const stack = await ensureDistillStack(target);
  const runId = crypto.randomUUID();
  const session = await anthropic.beta.sessions.create({ /* as today, minus initial_events */ });
  try {
    await db.insert(schema.runs).values({ /* as today */ });
  } catch (err) {
    await anthropic.beta.sessions.archive(session.id).catch(() => {}); // idle, never ran: free to drop
    if (isUniqueViolation(err)) return (await activeRun(subject.id, DISTILL_SKILL))!.id; // someone else won; that run is the answer
    throw err;
  }
  try {
    await anthropic.beta.sessions.events.send(session.id, {
      events: [{ type: "user.message", content: [{ type: "text", text: `Distill ${subject.key} using the ${DISTILL_SKILL} skill.` }] }],
    });
  } catch (err) {
    await db.delete(schema.runs).where(eq(schema.runs.id, runId)).catch(() => {});
    await anthropic.beta.sessions.archive(session.id).catch(() => {});
    throw err;
  }
  return runId;
}
const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
```

`addSubjectAction` / `regenerateSubjectAction` need no change: a conflict now returns the existing run instead of throwing. Neon's HTTP driver surfaces Postgres `code` on the error object; confirm the property path once in dev.

### P4 — regenerate stops the old session or does not proceed (certain)

File: `src/lib/distill/add.ts:53-61`.

```ts
async function stopSession(id: string) {
  let s = await anthropic.beta.sessions.retrieve(id).catch((err) => { if (isNotFound(err)) return null; throw err; });
  if (!s || s.archived_at || s.status === "terminated") return;
  if (s.status === "running" || s.status === "rescheduling") {
    await anthropic.beta.sessions.events.send(id, { events: [{ type: "user.interrupt" }] }); // events.md:230 — forces idle
    for (let i = 0; i < 10 && s.status !== "idle"; i++) {
      await new Promise((r) => setTimeout(r, 500));
      s = await anthropic.beta.sessions.retrieve(id);
    }
  }
  try {
    await anthropic.beta.sessions.archive(id);
  } catch (err) {
    if (isNotFound(err)) return;
    throw new Error("Could not stop the current run — try again in a minute.");
  }
}

for (const r of live) {
  await stopSession(r.cmaSessionId);                                   // throws → nothing marked ended, no new run
  await db.update(schema.runs).set({ status: "ended", lastActivityAt: new Date() }).where(eq(schema.runs.id, r.id));
}
```

Archive on a `running` session is what fails in practice (`client-patterns.md:140`; the SDK example polls to idle first, `typescript-examples.md:381-392`). Interrupt costs nothing at `requires_action` (no-op on idle, `events.md:234`) and is accepted-and-ignored at the budget (`events.md:237`). The "Regenerate" button in the pane renders while `working` (`sausage.tsx:91`), so this path is common.

### P5 — FMP outage must not burn the budget (likely)

Files: `src/lib/distill/settle.ts`, `src/lib/distill/skill.ts`.

The agent's only signal today is the error text. Two cheap layers:

1. Skill rule (new agent version — batch with the next skill change):
   ```
   ## If a tool errors
   Retry a failed `fetch_transcript` once. If it fails again, skip that quarter and record the gap in your notes.
   If `list_transcripts` fails twice, or three fetches in a row fail, stop: reply with one line
   `unavailable: <error>` and do not call tools again.
   ```
2. Server-side breaker in settle: the event log is already in memory. Count consecutive trailing `user.custom_tool_result` events with `is_error`; at ≥ 3 append a `system.message` after the results in the same `send` — accepted at `requires_action` only when it trails a tool result in the same request (`events.md:58`), and the agent model (`claude-opus-5`, `stack.ts:30`) supports it (`events.md:56`).
   ```ts
   const trailingErrors = (() => { let n = 0; for (const e of [...events].reverse()) { if (e.type !== "user.custom_tool_result") continue; if (!e.is_error) break; n++; } return n; })();
   const halt = results.every((r) => r.is_error) && trailingErrors + results.length >= 3;
   await anthropic.beta.sessions.events.send(sessionId, {
     events: halt
       ? [...results, { type: "system.message", content: [{ type: "text", text: "The transcript source is unavailable. Stop now, reply with one line `unavailable: <reason>`, and do not call tools again." }] }]
       : results,
   });
   ```
   The run then idles `end_turn` with no artifact; the state machine's rule 5/6 (below) turns that into `ended` rather than an endless nudge. Cost of a full FMP outage drops from ~$15 to ~$0.30.

### P6 — detect a hung `running` session and nudge it (likely)

Files: `src/lib/ops/reconcile.ts`, `src/lib/cma/events.ts` (one helper).

Replace the `runs.lastActivityAt` clock with the session's own: `quietMin = (now − max(processed_at)) / 60_000`. Track nudges in session metadata (`sessions.update({ metadata })` is allowed on any status, `core.md:179`) so no schema change is needed.

```ts
const RUNNING_QUIET_MIN = 20;   // longest healthy gap is the final HTML-writing turn, ~8–10 min on Opus high
const MAX_NUDGES = 2;
const nudges = Number(session.metadata?.nudges ?? 0);
const lastAt = Math.max(...events.map((e) => (e.processed_at ? Date.parse(e.processed_at) : 0)), Date.parse(session.created_at));
const quietMin = (Date.now() - lastAt) / 60_000;

if (session.status === "running" && quietMin > RUNNING_QUIET_MIN) {
  if (nudges >= MAX_NUDGES) { end(run); tryArchive(session.id); }
  else {
    await anthropic.beta.sessions.events.send(session.id, { events: [{ type: "user.interrupt" }] });
    await anthropic.beta.sessions.update(session.id, { metadata: { nudges: String(nudges + 1) } });
  }
}
// next pass: idle/end_turn, no artifact for this run, nudges > 0 → "continue" message
if (session.status === "idle" && stop === "end_turn" && !(await hasArtifact(run.id))) {
  if (nudges >= MAX_NUDGES) end(run);
  else {
    await anthropic.beta.sessions.events.send(session.id, { events: [{ type: "user.message", content: [{ type: "text", text: "You were interrupted. Read /workspace/notes and continue the earnings-transcripts skill from where the notes end; post_artifact when done." }] }] });
    await anthropic.beta.sessions.update(session.id, { metadata: { nudges: String(nudges + 1) } });
  }
}
```

Why 20 min: a healthy 20-quarter run is ~18 min *total* but no single gap approaches that — the largest is one model request (≤ 10 min by the platform's own non-streaming ceiling). Interrupt semantics: jumps the queue, forces `idle`, the turn reports `end_turn` (`events.md:230-232`), the agent does not see it as a message — hence the follow-up `user.message`. Notes files in the sandbox (`skill.ts:25-28`) make "continue" actually work. Do not nudge `rescheduling` (CMA is already retrying); apply the same clock with a 30-min bar and go straight to `ended`.

### P7 — tolerate the double answer (likely)

Files: `src/lib/distill/settle.ts`, `src/lib/ops/reconcile.ts`.

```ts
// settle.ts — after building `results`
try {
  if (results.length > 0) await anthropic.beta.sessions.events.send(sessionId, { events: results });
} catch (err) {
  const status = (err as { status?: number }).status;
  if (status !== 400 && status !== 409) throw err;
  const still = unansweredToolUses(await listAllEvents(sessionId)).map((c) => c.id);
  if (results.some((r) => still.includes(r.custom_tool_use_id))) throw err; // genuinely rejected
  // someone else answered first — fine
}

// reconcile.ts — the `stuck` predicate should not race a webhook that is mid-settle
if (session.status === "idle" && pending.length > 0 && quietMin > 2) { /* stuck */ }
```

What CMA returns for a duplicate `user.custom_tool_result` is not documented (`api-reference.md:242` covers only archived sessions); the re-list makes the outcome irrelevant. The artifact insert is already safe (`tools.ts:96-108`). The only other double-apply is a second FMP fetch and a second identical `runs` update — cost, not correctness.

### P8 — bounded event read (optional)

Files: `src/lib/smoke/ping-pong.ts` (move to `src/lib/cma/`), `src/lib/distill/settle.ts`, `src/lib/ops/reconcile.ts`.

Today's read is one request; leaving it is defensible. If p95 handler time or the 1,200 RPM read limit (`api-reference.md:274`) starts to matter — the trace pane polls the same full list every 5 s per admin (`queries.ts:52-56`) — the smallest bounded read that keeps `unansweredToolUses` and `latestStopReason` correct is:

```ts
export async function recentEvents(sessionId: string, limit = 20): Promise<SessionEvent[]> {
  const page = await anthropic.beta.sessions.events.list(sessionId, {
    order: "desc", limit,
    types: ["session.status_idle", "agent.custom_tool_use", "user.custom_tool_result"],
  });
  return page.data.reverse(); // chronological, as the pure functions expect
}
```

Correctness argument: a tool-use inside a newest-first window has its result (which is newer) inside the same window unless it is genuinely unanswered; the latest idle and the tool-uses it names are adjacent. Twenty events ≈ six round trips ≈ 300 KB instead of 1.5 MB. Keep the full list for the trace pane and for P6's quiet-time (or fetch `limit: 1, order: 'desc'` for that).

### P9 — make the paused states honest (optional)

Files: `src/app/s/actions.ts`, `src/app/s/[key]/page.tsx`.

- `bumpBudgetAction`: clamp at `HARD_CAP_CENTS = 3000` and call `settleDistillSession(run.cmaSessionId)` after the update so the header stops saying "Paused (budget)" without waiting for the next idle (`session.status_run_started` is not subscribed, `runbook.md:35`).
- Page header: fetch the latest run regardless of status; when it is `ended` and has no artifact, show "Last attempt failed" to everyone (admins also get "Request update"). Today non-admins see "Nothing here yet." with no explanation (`page.tsx:69`) and the `Ended` branch (`page.tsx:55-56`) is dead because `activeRun` excludes ended runs (`queries.ts:42`).

Order of landing: P1, P3, P4 are one sitting each and remove the only unbounded-spend paths (FMP hang → auto-disable; two live runs; old session after a failed regenerate). P2 makes the belt actually hold at scale. P5 and P6 close the two modes that never complete today. P7–P9 are polish.

## (c) Reconciler state machine

Inputs per live run: `R` = `runs.status`, `S` = `session.status`, `stop` = latest `session.status_idle.stop_reason`, `pending` = unanswered custom tool uses, `quiet` = minutes since the newest `processed_at`, `nudges` = `session.metadata.nudges`, `artifact` = a row in `artifacts` for this run. Rules are evaluated top-down; first match acts.

```
 1. retrieve 404 | S terminated | archived_at                      → R = ended
 2. S idle, stop requires_action, pending > 0, quiet > 2          → settle (answer tools)            [P7 quiet gate]
 3. S idle, stop requires_action, pending = 0, quiet > 5          → user.interrupt (re-queue; client-patterns.md:134)
 4. S idle, stop budget_reached                                   → R = budget_reached (manual bump)
 5. S idle, stop retries_exhausted                                → R = ended
 6. S idle, stop end_turn, artifact                               → R = idle
 7. S idle, stop end_turn, no artifact, nudges < 2                → user.message "continue from notes", nudges++
 8. S idle, stop end_turn, no artifact, nudges ≥ 2                → R = ended (header shows failure / Request update)
 9. S rescheduling, quiet ≤ 30                                    → R = working (CMA is retrying; leave it)
10. S running, quiet ≤ 20                                         → R = working
11. S running|rescheduling, quiet over bar, nudges < 2            → user.interrupt, nudges++  (lands in 7 next pass)
12. S running|rescheduling, quiet over bar, nudges ≥ 2            → R = ended; archive best-effort
13. derived R' ≠ R (any rule that did not write)                  → write R', list_cost_cents
14. orphan (no run row), age > 60: running → interrupt; else      → archive
15. elapsed > 45 s                                                → stop; report deferred count
```

Every action is idempotent on re-run: answering re-lists first, interrupt on idle is a no-op, `nudges` is monotone, `ended` is sticky (`settle.ts:29`).

## (d) What is already right

- The idempotency core is pure and fixture-tested: `unansweredToolUses` and `deriveRunStatus` (`src/lib/cma/events.ts:16-45`) read the session's own log, so duplicates, reordering and replays converge (`events.test.ts:27-34`).
- Terminal states are handled where they must be: ended runs are never resurrected (`settle.ts:29`), terminated/archived sessions are never answered (`settle.ts:31-34`), and only a 404 ends a run from the cron (`reconcile.ts:53-56`, `cma/errors.ts:2`).
- A failed settle releases its dedupe row and 500s (`route.ts:61-67`), so Anthropic's three retries are real retries; dedupe is on the per-event id as the docs require (`webhooks.md:77`).
- Tool failures never leave a tool owed: every thrown tool error becomes an `is_error` result (`settle.ts:42-45`), so the session cannot deadlock on an FMP outage — it can only overspend (P5).
- The artifact write is idempotent without a transaction (`tools.ts:96-108`, unique `cma_tool_use_id` in `schema.ts:65`), which is what makes concurrent deliveries and reconciler races safe.
- The mainline reads Postgres only (`page.tsx:19-26`); CMA outages degrade the admin trace to "trace unavailable" (`sausage.tsx:57`, `trace/route.ts:16-18`), never the page.
- Orphan sessions are cheap by construction: with no `runs` row the first custom tool is never answered (`settle.ts:27`), so an orphan spends about one turn before blocking, and the sweep archives it (`reconcile.ts:88-96`).
- Crons fail closed on `CRON_SECRET` with a constant-time compare (`cron-auth.ts:7-14`); every repair reuses the same settle the webhook runs, so over-running the reconciler is waste, not harm.
- The 5-minute cadence is well chosen: it is just past Anthropic's last retry (3 × ≤ 120 s), so a dropped delivery costs at most one pass (README decision 24).
