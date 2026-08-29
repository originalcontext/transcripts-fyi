# Hot-path audit — 2026-08-29

Rule under test: every page a non-admin renders and every server action they can trigger is Postgres-only and ~100 ms; nothing on it awaits CMA, FMP, Upstash or any third party. Admin surfaces (`/api/runs/[id]/trace`, the trace pane, `/smoke`, `bumpBudgetAction`, `regenerateSubjectAction`) are allowed to be slow. Caching is out of scope; fixes below remove or move work, they don't memoize it.

Method: read-only trace of `src/`, `drizzle/`, the SDK types in `node_modules/@anthropic-ai/sdk`, and the Next 16 docs in `node_modules/next/dist/docs`. Nothing that spends money or touches `.next/` was run. The one measurement is the HMAC micro-benchmark in §3.

Latency assumptions (not measured here): Neon HTTP ≈ 20–60 ms per round trip warm, +50–100 ms TLS on a cold function (`src/lib/db/index.ts:17`, one fetch per query); Anthropic REST ≈ 150–500 ms per call, `sessions.create` ≈ 300–800 ms. "Round" below = one sequential wait on Postgres; queries inside a `Promise.all` count as one round.

**Verdict in one line:** the two page renders are Postgres-only as claimed, but cost 3–4 *sequential* rounds where 1 would do; `addSubjectAction` — a non-admin action — makes three avoidable CMA list calls (auto-paginating, sequential) before the one unavoidable `sessions.create`, then re-renders the page inside the same response; and because `ADMIN_INVITE_CODE` is unset in every environment, every viewer currently polls CMA from the browser every 5 s.

---

## (a) Mainline entry points

| Entry point | Postgres round-trips | External calls | Est. ms (warm) | Verdict |
|---|---|---|---|---|
| `GET /` (universe non-empty) | 1 round: `listUniverse` (`src/app/page.tsx:9`) → 307 `redirect` (`:10`) → browser refetches `/s/[key]` (+1 HTTP RTT, +3 rounds below) | none | 40–60 + redirect RTT + `/s/[key]` ≈ 200–350 end to end | clean, slow: 4 sequential rounds + an extra request |
| `GET /` (universe empty) | 2 sequential rounds: `listUniverse` at `page.tsx:9` **and again** in `Shell` (`src/components/app/shell.tsx:18`) — no dedupe | none | 40–120 | clean; duplicate query |
| `GET /s/[key]` | 4 queries in **3 sequential rounds**: `getSubject` (`src/app/s/[key]/page.tsx:31`) → `latestArtifact` ∥ `activeRun` (`:21–25`) → `listUniverse` inside `Shell`, which React renders only after the page function resolves (`:38`, `shell.tsx:23`) | none on the server. Client: iframe loads 3 jsDelivr scripts (`src/lib/artifact/imports.ts:10,16,22`) | 60–180 | clean (Postgres-only); 3× the necessary rounds; ships ~50 KB `artifacts.content` per render |
| `AutoRefresh` tick (every 5 s while `run.status='working'`, `src/components/app/auto-refresh.tsx:7,11`) | full `/s/[key]` re-render: 4 queries / 3 rounds, plus proxy HMAC | none | same as above, ×12/min per viewer | clean per request; 48 queries/min/viewer and ~55 KB/tick when an artifact already exists ("Updating…", `page.tsx:52`) |
| `addSubjectAction` (`src/app/s/actions.ts:14`) | happy path, new ticker, no drift: `getSubject` (`src/lib/distill/add.ts:66`) → `count(subjects)` (`:68`) → `insert … onConflictDoNothing` (`:70–73`) → `getSubject` again (`:74`) → `activeRun` (`:78`) → `insert runs` (`:32–42`) = **6 sequential rounds**; then `revalidatePath("/", "layout")` (`actions.ts:28`) re-renders the current route in the same response (+3 rounds); then the client `router.push` (`src/components/app/add-subject.tsx:56`) renders `/s/[key]` (+3 rounds) | **CMA ×4, sequential**: `environments.list` (`src/lib/cma/stack.ts:57`, `:97–98`), `skills.list` (`:64`, `:106–107`), `agents.list` (`:72`, `:110`; iterates every agent in the workspace, no early exit `:72–77`), `sessions.create` (`add.ts:22–31`) | 1,500–4,000 | **violates** — 3 avoidable CMA calls; environments read is rate-limited to 60 RPM / 5 concurrent (`docs/managed-agents/api-reference.md:278`) |
| `loginAction` (`src/app/login/actions.ts:8`) | 0 | 0; 1–2 WebCrypto HMACs (`:21–22`, ~32 µs each) then `redirect` (`:24`) → client navigates to `/` (1 round + redirect + 3 rounds) | <1 for the action | clean |
| `logoutAction` (`login/actions.ts:27–32`) | 0 | 0 | <1 | clean |
| `GET /login` (`src/app/login/page.tsx`) | 0 | 0; outside the proxy matcher (`src/proxy.ts:22`) | ~0 | clean |
| `proxy.ts` (every matched request incl. RSC refreshes and action POSTs) | 0 | 0; `isValidSession` → `sessionToken()` = importKey + sign + hex per request (`src/lib/auth.ts:19–29,31,40–42`) | **0.032 ms measured** (§3) | clean |
| `/api/runs/[id]/trace` (`src/app/api/runs/[id]/trace/route.ts`) | 1 (`:12`) | `sessions.retrieve` + full `events.list` (`src/lib/distill/queries.ts:50–57`) | 500–3,000+ (O(events); event log embeds every ~50 KB tool result) | admin — allowed. **But** `isAdmin` returns `true` when `ADMIN_INVITE_CODE` is unset (`auth.ts:63`), which is every environment today (`docs/app/runbook.md:17`), so every viewer's `<Sausage/>` polls it every 5 s (`src/components/app/sausage.tsx:39,48`) — and keeps polling with the drawer closed (`src/components/app/sausage-layout.tsx:106` renders `panel` regardless of `open`) |
| `bumpBudgetAction`, `regenerateSubjectAction` (`actions.ts:32,53`) | 1–4 | CMA (`:37,40`; `add.ts:58` + `startRun`) | 500–4,000 | admin — allowed; reachable by everyone today for the same reason |
| `/smoke`, `/api/smoke/[sessionId]`, `createStackAction`, `runSmokeAction` | 2 (`src/lib/smoke/storage.ts:10–11`) | 3 parallel CMA lists (`src/app/smoke/page.tsx:17` → `findStack` `stack.ts:82`), `sessions.list` (`:19`), Upstash `INCR` (`storage.ts:22`), `sessions.retrieve` + `events.list` (`src/app/api/smoke/[sessionId]/route.ts:7`), and `sessions.create` ($0.17) from `src/app/actions.ts:28` | 500–2,000 | invite-gated only — known gap (cooperative review #11, `docs/app/README.md:27`) |

Data sizes: `latestArtifact` is `select *` (`queries.ts:29–35`), so `content` (~50 KB) and `meta` ride every render — necessary, the page renders it (`page.tsx:66`). `ArtifactFrame` returns a placeholder during SSR (`src/components/app/artifact-frame.tsx:26`), so the HTML carries the artifact once, as the `srcDoc` prop inside the Flight payload (~55 KB escaped), not twice. `injectArtifactHead` is one regex over the string (`imports.ts:38–43`) — negligible.

Scans: the only non-PK indexes are `subjects(kind,key)` (`src/lib/db/schema.ts:29`, `drizzle/0001_talented_starfox.sql:38`) and the `artifacts.cma_tool_use_id` unique (`schema.ts:60`). `listUniverse`'s two correlated `exists` (`queries.ts:13–14`), `latestArtifact`'s `where subject_id … order by created_at` (`:32–33`) and `activeRun`'s `where subject_id, skill, status<>'ended'` (`:42`) all seq-scan `artifacts` / `runs`. At the ceilings (100 subjects × ≤11 runs, `add.ts:12–13`) that is ≤1,100 rows per scan with `content` TOASTed out of line — sub-millisecond; network RTT dominates. Listed as hygiene in §b6, not as a latency fix.

Client bundle: the wordwheel's `import("@/data/tickers.json")` (`add-subject.tsx:17–20`) is 105 KB raw / 36 KB gzipped, loaded on first focus (`:78`), never in the initial bundle; `search` is a linear pass with an early break at 40 hits (`:22–34`). `universe-nav.tsx:3,9` imports the same JSON server-side into a Map at module load — once per cold start. `SausageLayout` reads `localStorage` + `matchMedia` synchronously in `useSyncExternalStore` (`sausage-layout.tsx:20–30,63`) — microseconds; the pre-paint script in `src/app/layout.tsx:24–28` is the same read. None make network calls. The one third-party dependency in the browser is the three pinned jsDelivr scripts inside the sandboxed iframe (Chart.js, Alpine, lucide — several hundred KB on first view, browser-cached after); it is client-side and cannot delay TTFB, but a jsDelivr outage blanks every explainer's charts. Already noted as the punted SRI/CSP item (README "GenUI hardening").

---

## (b) Fixes, by impact

### b1. `addSubjectAction`: resolve the stack from Postgres; CMA only for `sessions.create`

**Today** (`src/lib/cma/stack.ts:93–146`): three sequential auto-paginating list calls on every add, even when nothing drifted, to rediscover ids that never change until the code does. `findAgent` walks the entire workspace agent list (`:72–77`). Plus the environments endpoint's 60 RPM / 5-concurrent cap means six friends clicking Add at once trips SDK retries.

**Change**: persist the resolved stack keyed by `(app, role, target, config_hash)`. `config_hash` (`stack.ts:52`) already encodes everything drift-relevant, so a code change is a miss *by construction* — no verification read is needed on a hit. This is a materialization in the same sense `runs.status` is (the webhook writes it, the mainline reads it), not a cache; it does revisit README decision 10 ("no DB rows for agent/environment/skill … unless it's problematic (raise)") — this is the raise.

Schema (`src/lib/db/schema.ts`, then `npm run db:generate` → `drizzle/0004_*.sql`):

```ts
import { primaryKey } from "drizzle-orm/pg-core";

/** Resolved CMA stack per (app, role, target, config_hash). A code change changes the hash → a new row. */
export const cmaStacks = pgTable(
  "cma_stacks",
  {
    app: text("app").notNull(),
    role: text("role").notNull(),
    target: text("target").notNull(),
    configHash: text("config_hash").notNull(),
    environmentId: text("environment_id").notNull(),
    skillId: text("skill_id").notNull(),
    skillVersion: text("skill_version").notNull(),
    agentId: text("agent_id").notNull(),
    agentVersion: integer("agent_version").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.app, t.role, t.target, t.configHash] })],
);
```

Code (`src/lib/cma/stack.ts`): rename today's body to `resolveStack(spec)` (unchanged, lines 94–145) and wrap it:

```ts
export async function ensureStack(spec: StackSpec): Promise<Stack> {
  const { config_hash } = hashes(spec);
  const k = { app: spec.app, role: spec.role, target: spec.target, configHash: config_hash };
  const [hit] = await db.select().from(schema.cmaStacks)
    .where(and(eq(schema.cmaStacks.app, k.app), eq(schema.cmaStacks.role, k.role), eq(schema.cmaStacks.target, k.target), eq(schema.cmaStacks.configHash, k.configHash)));
  if (hit) return { environmentId: hit.environmentId, skillId: hit.skillId, skillVersion: hit.skillVersion, agentId: hit.agentId, agentVersion: hit.agentVersion, agentCurrent: true };

  const stack = await resolveStack(spec); // today's find-or-create + drift versioning, unchanged
  await db.insert(schema.cmaStacks)
    .values({ ...k, environmentId: stack.environmentId, skillId: stack.skillId, skillVersion: stack.skillVersion, agentId: stack.agentId, agentVersion: stack.agentVersion })
    .onConflictDoUpdate({ target: [schema.cmaStacks.app, schema.cmaStacks.role, schema.cmaStacks.target, schema.cmaStacks.configHash], set: { environmentId: stack.environmentId, skillId: stack.skillId, skillVersion: stack.skillVersion, agentId: stack.agentId, agentVersion: stack.agentVersion, resolvedAt: new Date() } });
  return stack;
}

/** Drop a materialized stack (used when sessions.create says its ids are gone). */
export async function forgetStack(spec: StackSpec) { /* delete where pk = (app, role, target, hashes(spec).config_hash) */ }
```

`startRun` (`src/lib/distill/add.ts:18–44`) grows one retry:

```ts
let stack = await ensureDistillStack(target);
let session;
try {
  session = await createSession(stack);                       // today's sessions.create block, lines 22–31
} catch (err) {
  if (!isNotFound(err)) throw err;                            // src/lib/cma/errors.ts:2 — only a 404 means "gone"
  await forgetDistillStack(target);                           // stale row: someone archived the agent/env in the Console
  stack = await ensureDistillStack(target);                   // slow path once, re-materializes
  session = await createSession(stack);
}
```

Behaviour:
- **Hit** (every add after the first per deploy): 1 indexed PG read (~30 ms) instead of 3 CMA lists (~0.5–1.5 s). Action becomes 7 PG rounds + 1 `sessions.create` ≈ 0.5–1.2 s, of which everything but `sessions.create` is Postgres.
- **Miss** (first add after a deploy whose skill/system/model/tools changed, or a fresh database): today's path runs exactly once (`resolveStack` publishes the new skill/agent versions, `stack.ts:114–136`), then the row is written. Same cost as today, once.
- **Drift**: is a miss — the hash is in the key. Old rows stay; they are harmless (runs pin their own versions, `runs.cma_*`, `add.ts:38–41`) and can be pruned by GC later or never.
- **Stale row** (agent/environment archived out of band; `agent_archived_error` / 404 on `sessions.create`): caught, row deleted, one slow-path retry. A 429/5xx is not a 404 and surfaces as today.
- **Race** (two adds on a cold row): both run `resolveStack`; `onConflictDoUpdate` makes the second write a no-op update. Same "best-effort singleton" as today (`stack.ts:19–20`).
- Postgres is per environment (README decision 7), so dev and prod each hold their own row for their own target — consistent with `metadata.target` routing.

`findStack` (`stack.ts:81–91`, used by `/smoke`) is unaffected. Beyond this, `/smoke`'s "create/update agent" button and the reconciler are the places drift now gets *noticed*; the add path only learns of it via the hash.

**Also in the same action, two zero-risk trims:**

- `add.ts:70–74`: `insert … onConflictDoNothing().returning()` and fall back to `getSubject` only when the insert returned nothing (the conflict case). Saves one round on the common path.
- `actions.ts:28`: drop `revalidatePath("/", "layout")`. Both pages are `force-dynamic` (`page.tsx:6`, `s/[key]/page.tsx:16`) and the client router's dynamic stale time is 0 by default since Next 15 (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/staleTimes.md:42`), so the subsequent `router.push` (`add-subject.tsx:56`) fetches fresh anyway. What `revalidatePath` buys today is a full server re-render of the *current* route inside the action response (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md:36,150`) — 3 rounds of Postgres that are thrown away when the push lands. The toast still works: `state.key` still flows.

**Next step, optional** (moves the last non-Postgres call off the response): call `sessions.create` inside `after()` from `next/server` (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md:6` — runs after the response is sent, within the function's `maxDuration`). This needs a `runs.status = 'pending'` value and nullable `cma_*` columns (they are `notNull`, `schema.ts:38–42`), and the reconciler would need to pick up `pending` rows older than a minute — it already has the "orphan session" sweep (`src/lib/ops/reconcile.ts:36`) and the same idempotent settle. Not the smallest change; the stack table is.

### b2. `/s/[key]`: one round instead of three

The three sequential waits are structural, not query cost: `getSubject` must finish before `latestArtifact`/`activeRun` (they take `subject.id`, `page.tsx:22–23`), and `Shell`'s `listUniverse` cannot start until the page function returns (`page.tsx:38`, `shell.tsx:23`). Neither dependency is real: the artifact and run can be looked up by `(kind, key)` through a subquery, and the universe never depended on the subject.

`src/lib/distill/queries.ts`:

```ts
const subjectId = (kind: string, key: string) =>
  sql`(select id from ${schema.subjects} where kind = ${kind} and key = ${key})`;

export async function latestArtifactByKey(kind: string, key: string) {
  const [a] = await db.select().from(schema.artifacts)
    .where(eq(schema.artifacts.subjectId, subjectId(kind, key)))
    .orderBy(desc(schema.artifacts.createdAt)).limit(1);
  return a ?? null;
}

export async function activeRunByKey(kind: string, key: string, skill: string) {
  const [r] = await db.select().from(schema.runs)
    .where(and(eq(schema.runs.subjectId, subjectId(kind, key)), eq(schema.runs.skill, skill), ne(schema.runs.status, "ended")))
    .orderBy(desc(schema.runs.createdAt)).limit(1);
  return r ?? null;
}
```

`src/app/s/[key]/page.tsx`:

```ts
const t0 = performance.now();
const [subject, artifact, run, universe, admin] = await Promise.all([
  getSubject("ticker", key),
  latestArtifactByKey("ticker", key),
  activeRunByKey("ticker", key, DISTILL_SKILL),
  listUniverse(),
  isAdmin((await cookies()).get(ADMIN_COOKIE)?.value),
]);
if (!subject) notFound();
const hotPathMs = Math.round(performance.now() - t0);
// …
<Shell universe={universe} current={subject.key} hotPathMs={hotPathMs}>
```

`Shell` takes `universe` as a prop and stops querying (`shell.tsx:16–23` go away); `page.tsx:9` passes its own result. That also removes the duplicate `listUniverse` on the empty-universe `/` render. Four parallel Neon HTTP fetches ≈ one RTT: 60–180 ms → 30–70 ms. If one statement is preferred later, the same four reads fold into a single `select … lateral` — but four parallel fetches is the smaller diff and Neon HTTP has no connection to contend for.

### b3. `AutoRefresh`: poll a status row, re-render only on change

Every 5 s per viewer per working run, `router.refresh()` (`auto-refresh.tsx:11`) re-runs the whole page (4 queries, ~55 KB when an artifact exists). Only two facts can change: `runs.status` and "is there a newer artifact". Poll those from a route handler and refresh when they move.

`src/app/api/subjects/[id]/status/route.ts`:

```ts
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { rows: [row] } = await db.execute<{ working: boolean; latest: string | null }>(sql`
    select exists (select 1 from runs where subject_id = ${id} and skill = ${DISTILL_SKILL} and status = 'working') as working,
           (select max(created_at)::text from artifacts where subject_id = ${id}) as latest`);
  return Response.json(row);
}
```

`src/components/app/auto-refresh.tsx`:

```tsx
export function AutoRefresh({ subjectId, active, ms = 5000 }: { subjectId: string; active: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let last: string | null = null;
    const t = setInterval(async () => {
      const res = await fetch(`/api/subjects/${subjectId}/status`, { cache: "no-store" });
      if (!res.ok) return;
      const now = JSON.stringify(await res.json());
      if (last !== null && now !== last) router.refresh(); // status flipped or a new artifact landed
      last = now;
    }, ms);
    return () => clearInterval(t);
  }, [subjectId, active, ms, router]);
  return null;
}
```

Per tick: 1 query and ~60 bytes instead of 4 queries and ~55 KB; the full render happens once when `post_artifact` lands or the run goes idle, after which `active` flips false and polling stops. The route sits behind the invite cookie like the rest of `/api/*` (`proxy.ts:22`). If even that is more than wanted right now, the one-character alternative is `ms = 10000`, which halves the load and costs at most 5 s of staleness on a 3–18 min run.

### b4. The sausage is polling CMA from every browser

Two facts combine: `isAdmin` returns `true` when `ADMIN_INVITE_CODE` is unset (`auth.ts:63`), and it is unset everywhere (`docs/app/runbook.md:17`); so `page.tsx:63` mounts `<Sausage/>` for everyone, and `sausage.tsx:35–53` fetches `/api/runs/[id]/trace` on mount and every 5 s while `working`. Each fetch is `sessions.retrieve` + the whole event log (`queries.ts:50–57`; ~20 tool results of ~50 KB each in flight by the end of a run). Five viewers on one working subject = 120 CMA reads/min against the 1,200 RPM org-wide read limit (`docs/managed-agents/api-reference.md:277`), shared with the webhook and reconciler. TTFB is untouched (the design holds), but the "admin-only" load is currently everyone's.

Two one-liners, independent of each other:

- `src/components/app/sausage-layout.tsx:106`: `{open && panel}` instead of `{panel}`. Closing the drawer then unmounts `<Sausage/>`, whose effect cleanup clears the interval (`sausage.tsx:49–52`). Today a closed drawer keeps polling forever.
- Set `ADMIN_INVITE_CODE` in Vercel prod (already the cooperative review's fix-now #1; `runbook.md:17` says "set it before the audience grows"). Zero code.

### b5. `GET /`: ask only for the first key

`page.tsx:9` runs the full `listUniverse` (100 rows × two correlated `exists`) to use `universe[0].key`. Replace with `select key from subjects order by key limit 1`; fall through to `<Shell universe={[]}>` (with b2, Shell no longer re-queries). Saves a few ms of query work per landing, not a round; the redirect RTT stays because the URL is meant to change.

### b6. Index hygiene (sub-millisecond today; write it down before it matters)

`artifacts` is append-only and never pruned (GC prunes `webhook_events` only, README "Crons are in"); every regeneration adds a row. Two indexes keep the mainline's plans index-driven as it grows, and both are one `npm run db:generate` away:

```ts
// src/lib/db/schema.ts
import { index } from "drizzle-orm/pg-core";
export const runs = pgTable("runs", { /* … */ }, (t) => [index("runs_subject_skill").on(t.subjectId, t.skill)]);
export const artifacts = pgTable("artifacts", { /* … */ }, (t) => [index("artifacts_subject_created").on(t.subjectId, t.createdAt)]);
```

They serve `latestArtifact` (`queries.ts:32–33`), `activeRun` (`:42`), both `exists` in `listUniverse` (`:13–14`), the b3 status query, and the reconciler's/`regenerateSubject`'s `where subject_id` reads (`add.ts:50,56`).

---

## (c) Already right

- The two renders never await CMA, FMP or Upstash: the only `anthropic` use in `queries.ts` is `sessionTrace` (`:49`), reached solely from the admin route; `redis.ts` is imported only by `src/lib/smoke/storage.ts:4`; `fmp.ts` only by `distill/tools.ts` and `smoke/tools.ts` (webhook side). The cooperative review's mainline claim (`docs/reviews/2026-08-29-cooperative-review.md:176`) still holds in code.
- The trace is client-fetched after mount (`sausage.tsx:35`), 403s render nothing (`:55`), 502s render "trace unavailable" (`:57`) — a CMA outage cannot alter TTFB or break the page.
- `proxy` runs on the Node runtime (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:255`), touches no store, and its per-request cost is one HMAC: **31.7 µs/op** for importKey + sign + hex over 5,000 iterations (Node 23.11, Apple silicon; `auth.ts:19–29`). Not worth memoizing.
- `listUniverse` is one statement with correlated `exists` (`queries.ts:6–18`) rather than N+1; the sidebar's greyed/working state costs nothing extra.
- `latestArtifact`/`activeRun` already run in parallel (`page.tsx:21–25`); both pages declare `dynamic = "force-dynamic"` so nothing is accidentally cached or accidentally static.
- The wordwheel list never rides in the initial bundle (`add-subject.tsx:16–20`), and the server-side name map is built once per cold start (`universe-nav.tsx:9`).
- The iframe is created client-side with `sandbox="allow-scripts"` and no `allow-same-origin` (`artifact-frame.tsx:28–34`); the dark first-paint style is injected before any CDN tag (`imports.ts:34–35`), so a slow jsDelivr shows a dark pane, not a white flash.
- The `AutoRefresh` mechanism is the right shape for serverless — short requests, no sockets (`auto-refresh.tsx:6`); b3 only shrinks what each tick asks for.
- Spend on the mainline is zero: no action a non-admin can trigger spends money except the one `sessions.create` per new ticker, bounded by `MAX_SUBJECTS` (`add.ts:12,69`).
