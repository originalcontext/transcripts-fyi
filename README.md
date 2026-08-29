# transcripts.fyi

Understand a company quickly through its earnings-call transcripts over the past quarters: analyze each call (map), synthesize an explainer across them (reduce), and keep digging on an open-ended, long-horizon agent run.

Also an exercise in building a rapid prototype that is production-ready for success — one person or a small team can react to traction and scale without rewriting, by offloading risk and avoiding patterns that are hard to secure, debug, or sleep next to.

Prod: https://transcripts.fyi · Dev: `npm run dev` + ngrok → `/webhook`

---

## Above the line (done, smoke-tested in dev and prod)

- **Scaffold** — Next 16 / React 19 / Tailwind 4 / TypeScript, Node 24, Vercel.
- **Managed Agents plumbing** — `/webhook` receiver (signature-verified, event-id deduped), custom-tool round trip answered from the webhook, no long-lived connections anywhere.
- **Smoke stack** — per-target environment + skill + agent, found-or-created from Anthropic's own resources by metadata; agent auto-versions when the tool set drifts. Home page: create/update agent, run smoke, watch checks, see recent sessions.
- **Smoke run** — ping/pong via skill + custom tool, then fetch NVDA's latest transcript (FMP) and hand back a summary via a second tool. 8 checks, ~25s, ~$0.17.
- **Data libs** — `src/lib/fmp.ts` (transcripts, SEC filings, statements), `src/lib/massive.ts` (FMV via snapshot). Quick refs in `docs/apis/`.
- **Storage** — Neon over HTTP (drizzle), Upstash over REST. Migrations in `drizzle/`, applied by `vercel-build` per environment.
- **Auth** — invite code in `INVITE_CODE`, checked in `proxy.ts`, stateless HMAC session cookie. Root `/` is the splash; `?invite=` prefills.
- **UI kit** — shadcn (Radix primitives, nova preset, neutral, CSS vars), lucide icons, next-themes (class strategy, system default), sonner toasts. Components live in `src/components/ui/`; add more with `npx shadcn add <name>`.
- **Hot path + CMA loop hardening** (`docs/reviews/2026-08-29-hot-path-audit.md`, `…-cma-loop-resilience.md`) — `/s/[key]` is one Postgres round (~80ms); status polling hits a tiny route and re-renders only on change; the trace mounts only while the drawer is open. Sessions are created idle → run row → kick, so nothing spends before it is recorded; regenerate interrupts before archiving; the reconciler is capped, per-run fault-isolated, and detects hung runs by session quiet time (interrupt → "continue from notes" → give up); SDK/FMP calls carry real timeouts; the skill retries a failing tool once then posts what it has.
- **Cooperative review** — five fresh-context lenses, every finding adversarially verified; 13 fix-now items landed (reconciler ended runs on any CMA error; webhook dedupe row written before settle; settle answering tools into terminated sessions and resurrecting ended runs; gates; open redirect; doc drift). Report: `docs/reviews/2026-08-29-cooperative-review.md`.
- **Quality gate** — `npm run check` = typecheck + eslint (import order, unused imports) + vitest + knip; runs on `git push` via `.githooks/pre-push` (`prepare` sets `core.hooksPath`) and in GitHub Actions (`ci.yml`). Nine test files (25 tests, no network) defend the seams the principles rest on: the idempotency core against a captured real session log, `answerPendingTools` under duplicate/reordered logs and a throwing runner, the hung-run state machine, the redirect guard, cron auth failing closed, artifact head injection with pinned CDN versions, ticker ranking, and config-hash stability. `npm run e2e` = 8 Playwright tests (auth gate, login, `/webhook` signature rejection, cron 401s) against a built app on :3100 with dummy backend env — no secrets; runs in `e2e.yml`. No branch protection yet; Vercel still auto-deploys `main`.
- **Docs** — `docs/managed-agents/` local reference, verified against live docs 2026-08-29. Sprint notes in `docs/sprints/`. **Start at `docs/app/README.md`** (index) and `docs/app/runbook.md` (operations).

- **Responsive shell** — below `md` the universe is a left sheet and the sausage a right sheet; at `md`+ the sausage is a retractable panel (state remembered per viewer via `useSyncExternalStore` over localStorage). No data or action changes.
- **Mainline behind the line** — the server render touches Postgres only; `runs.status` / `list_cost_cents` are maintained by the webhook. The CMA-backed trace pane is admin-gated (`ADMIN_INVITE_CODE`) and fetched client-side after mount, so admins and non-admins get the same TTFB and a CMA outage can't slow or break a page.
- **Versioning, the simple scheme** — `ensureStack` hashes skill markdown + system prompt + model/effort + tool defs and stamps it on the agent; a mismatch publishes a new skill version and agent version. New sessions get "latest"; running ones are frozen. **Regenerate / Request update** (admin) ends the live run, archives its session, and starts a fresh one on the current version — at most ten per subject. `runs` records agent + skill versions; artifacts keep history.
- **Product v0** — three panes: universe (left), latest explainer rendered in a sandboxed iframe (middle), "how the sausage was made" live from the CMA session with a budget-bump button (right). "Add to universe" creates the subject, finds-or-creates the distiller stack, starts a $25-capped long-lived session; the webhook answers `list_transcripts` / `fetch_transcript` (FMP) and `post_artifact` (Postgres). NVDA at 20 quarters: ~18 min, ~$9.50.
- **Data model** — `subjects` (kind + key), `runs` (subject × skill → one CMA session), `artifacts` (append-only, unique on tool-use id). `docs/` and `README` carry the rationale.

## Below the line (next)

- **Webhook consistency & resiliency sprint (first).** The webhook is the single seam between CMA and product state — artifacts, run status, cost all cross there. Make it boringly correct: orphaned sessions when the `runs` insert fails after `sessions.create`; stuck `requires_action` if a delivery is dropped after three retries; FMP retries/timeouts inside the handler; handler runtime vs. Vercel function limits. **Crons are in** (`vercel.json`, `src/lib/ops/*`, `/api/cron/*` behind `CRON_SECRET`): the *reconciler* every 5 minutes re-derives every live run from the session resource and re-settles drift / stuck `requires_action` / stale working, ends runs whose session is gone, and archives orphan sessions older than an hour; *GC* daily archives sessions of runs ended > 7 days and prunes `webhook_events` > 30 days. Every repair is the same idempotent settle the webhook runs. `npm run reconcile` / `npm run gc` are dry-run CLIs (`--apply` to act). Remaining for the sprint: FMP retries/timeouts in the handler, handler runtime vs. function limits, and measuring how often the reconciler actually finds anything.
- **Skills & system prompts sprint** — the distiller skill and system prompt are deliberately plain right now; make them effective (longitudinal structure, citations, tone) as a dedicated pass.
- **Versioning, later** — roll-forward policy for long-lived runs (lazy on next view / new transcript, or reconciler cron), `ant` YAML in CI if wanted, prompt A/B via `agent_with_overrides`. Environment changes still manual.
- **Persistence at the CMA layer for ongoing synthesis** — long-lived session vs. memory store vs. re-run from artifacts when a new transcript arrives.
- **Sources of truth vs. cache layers** — transcripts (FMP) are refetched per run. Redis now holds one thing: resolved CMA stack ids keyed by config hash (30-day TTL, forgotten on a 404), so "add a company" is one REST read + `sessions.create`. Anything further only when measurably slow.
- **GenUI hardening** — the explainer is agent-authored HTML in a `sandbox="allow-scripts"` iframe (unique origin, no same-origin access) with a pinned library set injected from jsDelivr (`src/lib/artifact/imports.ts`). Deliberately punted: CSP on the iframe, SRI hashes on the CDN tags, size limits, what the agent may emit.
- **From the cooperative review (2026-08-29, `docs/reviews/`)** — fix-later, in rough priority: concurrent add/regenerate can start two live runs for one subject (#14); reconciler's "stuck" predicate races in-flight webhooks — needs per-session serialization (#15); bump-budget has no ceiling (#16); invite login has no brute-force protection (#17); both settlers duplicate the answer-tools block (#18); `listAllEvents` lives in `lib/smoke` but product code depends on it (#22); `latestStopReason` re-derived in two places (#23); bump leaves `runs.status='budget_reached'` until next idle (#24); orphan sweep pre-empts GC's 7-day grace (#25); reconciler pages the whole workspace session list every 5 min under a 60 s cap (#26); raw SDK/Neon error strings reach the browser (#27); `RunStatus` declared twice (#28); `add.ts` holds the whole run lifecycle (#29); GC dry-run counts client-side (#30).
- **Second review pass** (lenses not yet run): cost & spend control; hot-path scaling — every webhook and trace call reads the session's full `events.list`, O(events) per delivery; operability at 2am (logs, alerting, incident runbook); test adequacy vs. claimed invariants.

## Future ideas

- **Other universes.** Earnings transcripts were the first demo, not necessarily the best. Explore transcript/document universes in science and healthcare (trial readouts, FDA advisory-committee transcripts, grand rounds, conference Q&A) — each is a skill plus a skill-specific toolset on the same `subjects` / `runs` / `artifacts` model. Researched shortlist with obtainability checks: `docs/ideas/transcript-universes.md`; zero-friction candidates actually probed with `curl`: `docs/ideas/zero-friction-universes.md` (ECB/Fed HTML, ClinicalTrials.gov history JSON, IETF minutes).

---

## Decisions and rationale

Quoted where Eddie said it; *implied* where it followed from the conversation.

| # | Decision | Rationale |
|---|---|---|
| 1 | Rapid prototype that is production-ready for success | "a one man or small team can react to traction and scale it rapidly, easy to reason about by offloading risk and avoiding patterns that are hard to confidently secure, debug, feel good about when you sleep" |
| 2 | Vercel · React 19 · Next 16 · Neon · Upstash | Chosen up front; everything through Vercel integrations where possible |
| 3 | Managed Agents for the async, long-horizon work; app stays request/response | "separating OLTP user experience from the async CMA work — scales to the moon if CMA, vercel, neon, upstash don't fall over (assumed)" |
| 4 | Webhook-driven agent interaction; custom tools answered from the webhook; no SSE held open | *Implied:* the only shape that survives serverless timeouts; also what got smoke-tested first |
| 5 | Serverless libraries only — HTTP/REST drivers, no connections | "make sure to use the serverless libraries for all of this — no connections" |
| 6 | No database transactions | "the no transactions is by design" — Neon HTTP driver has none; revisit only when a real need appears |
| 7 | Neon per environment; Redis shared, keys prefixed by target | "pg is per environment dev/prod and redis is shared (until it causes complexity)" |
| 8 | Prod migrates on Vercel deploy, never from a laptop | "dont migrate production, vercel deploy will do that" — Vercel also marks prod secrets sensitive, so it can't happen by accident |
| 9 | Smoke-test every layer in dev *and* prod before product work | "need to have this smoke tested in prod and dev before we continue" |
| 10 | Anthropic's resources are the store for agent/environment/skill — find-or-create by metadata, no DB rows | "no db persistence etc for now lets just lean on the direct primitives unless it's problematic (raise)" |
| 11 | Sessions carry `metadata.target`; each deployment answers only its own | *Implied:* dev and prod share one workspace and both receive every webhook |
| 12 | Agent tool set drift → new agent version automatically | *Implied:* agents are versioned and immutable; code is the source of truth for tools |
| 13 | Massive: FMV only for now | "for massive, perhaps we just pull current FMV api, keep it simple, want it handy for later" |
| 14 | Auth = invite code env var + proxy check + cookie session | "whats the simplest thing that can work.. demo with a handful of friends". Code doubles as the cookie secret; rotating it logs everyone out. **No `NEXT_PUBLIC_` prefix** — that would ship the secret to the browser |
| 15 | Simplest thing that can work; harden later | "we will do some rounds of simplification, hardening, etc later so don't go overboard" |
| 16 | Eddie drives; discuss decision points as they come | "this is part of an exercise to demonstrate judgement so we'll discuss decision points as we go" |
| 17 | `subjects` / `runs` / `artifacts`, artifacts append-only, latest derived | "proposed data model looks good". Append-only makes the webhook write idempotent (unique on tool-use id) without a transaction, and keeps history for free |
| 18 | Shared universe, $10 per run, bump button in the sausage pane | "shared universe is fine for now… budget cap of $10 is fine, bump button can be under the how the sausage is made section" |
| 19 | One transcript per custom-tool call | *Finding:* a custom tool result truncates around 100k chars (a 385k batch lost everything past ~3 transcripts). Built-in tools spill to a file; custom tools don't. So `list_transcripts` + `fetch_transcript`, ≤2 in parallel |
| 20 | Plain HTML in the tool call, not base64 | Recommended and unopposed: JSON escaping handles it, base64 costs 33% more output tokens and hides the content in the trace |
| 21 | Skills and system prompts stay simple for now | "keep the skills and system instructions simple but effective for now, that's a whole sprint later" |
| 23 | Versioning = hash-drift + "Regenerate all"; style stays in the skill | "the versioning is a bit of a rabbit hole… a 'regenerate all' button… simply creates and reruns fresh sessions… picking up any skill differences including style (dont want to split the style and markup, I see issues with that + constrains the agent)" |
| 27 | Stack ids cached in Redis, not a new Postgres table | "but no new additions to the postgres schema?" — the ids are a cache of Anthropic's resources, not product state; Redis is the layer for that (decision 7), keyed by config hash so drift is a miss by construction |
| 26 | Everyone is admin for now; universe capped at 100; 10 regenerations per subject; no "Regenerate all" | "It's ok everyone is admin.. small trustworthy set.. limit the universe to 100, remove regenerate all button, limit regenerations per ticker to 10" — ceilings, not quotas: they bound the worst case a trusted friend can cause by accident |
| 25 | Explainer = 20 quarters, map/reduce via sandbox notes, interactive with a pinned library set | "bump it from 8 quarters to 20… not wall of text but intuitive bespoke experiences… click-in for deeper context for professional analysts… fixed key set of jsdelivr'ed imports in the shell and a 'use these and only these' in the skill… punt on sandboxing for now". Notes files make the run resilient to context compaction at ~230k transcript tokens; budget $25/run |
| 24 | Reconciler every 5 min, GC daily; crons fail closed without `CRON_SECRET` | "Perhaps vercel crons for reconcilers and GC as belt and suspenders?" — 5 min ≈ one run's length and just past Anthropic's last webhook retry (3 × ≤120s), so a dropped delivery costs at most ~5 min; each pass is ~2 CMA reads per live run. GC at 04:17 UTC. Requires a Vercel plan with sub-daily cron |
| 22 | Mainline reads Postgres only; the sausage may cheat, behind an admin flag, off the render path | "the main-line product is predictable and risk free eventually even if the show and tell parts cheat" — nothing user-facing derives from a live CMA call; the webhook materializes what the mainline needs |

## Running it

```sh
npm run dev                      # http://localhost:3000 (needs .env.local via `vercel env pull`)
npm run distill -- NVDA           # CLI twin of "Add to universe"
npm run smoke:run -- --target dev # /smoke page, CLI twin
npm run smoke:storage
npm run check                    # typecheck + lint + test + knip (also the pre-push hook and CI)
npm run e2e                      # Playwright, builds + starts on :3100, no secrets needed
npm run reconcile                # dry-run reconciler (--apply to repair); cron does this every 5 min
npm run gc                       # dry-run GC (--apply); cron does this daily
npm run db:generate && npm run db:migrate   # dev only
```
