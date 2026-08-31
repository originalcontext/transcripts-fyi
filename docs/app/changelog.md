# Changelog

What has shipped, newest first. Each item was smoke-tested in dev and prod when it landed. (Until 2026-08-31 this lived in the root README as "Above the line".)

## 2026-08-30 — polish

- Explainer skill: charts render inside a dedicated fixed-height wrapper (stops a runaway canvas); general polish pass.

## 2026-08-29 — fresh repo to hardened v0

### Scaffold and plumbing

- **Scaffold** — Next 16 / React 19 / Tailwind 4 / TypeScript, Node 24, Vercel.
- **Managed Agents plumbing** — `/webhook` receiver (signature-verified, event-id deduped), custom-tool round trip answered from the webhook, no long-lived connections anywhere.
- **Smoke stack** — per-target environment + skill + agent, found-or-created from Anthropic's own resources by metadata; agent auto-versions when the tool set drifts. Home page: create/update agent, run smoke, watch checks, see recent sessions.
- **Smoke run** — ping/pong via skill + custom tool, then fetch NVDA's latest transcript (FMP) and hand back a summary via a second tool. 8 checks, ~25s, ~$0.17.
- **Data libs** — `src/lib/fmp.ts` (transcripts, SEC filings, statements), `src/lib/massive.ts` (FMV via snapshot). Quick refs in `docs/apis/`.
- **Storage** — Neon over HTTP (drizzle), Upstash over REST. Migrations in `drizzle/`, applied by `vercel-build` per environment.
- **Auth** — invite code in `INVITE_CODE`, checked in `proxy.ts`, stateless HMAC session cookie. Root `/` is the splash; `?invite=` prefills.
- **UI kit** — shadcn (Radix primitives, nova preset, neutral, CSS vars), lucide icons, next-themes (class strategy, forced dark — light never held up on mobile, and the explainers, share cards and favicon are all #0a0a0a), sonner toasts. Components live in `src/components/ui/`; add more with `npx shadcn add <name>`.

### Product v0

- **Three panes** — universe (left), latest explainer rendered in a sandboxed iframe (middle), "how the sausage was made" live from the CMA session with a budget-bump button (right). "Add to universe" creates the subject, finds-or-creates the distiller stack, starts a $25-capped long-lived session; the webhook answers `list_transcripts` / `fetch_transcript` (FMP) and `post_artifact` (Postgres). NVDA at 20 quarters: ~18 min, ~$9.50.
- **Data model** — `subjects` (kind + key), `runs` (subject × skill → one CMA session), `artifacts` (append-only, unique on tool-use id).
- **Mainline behind the line** — the server render touches Postgres only; `runs.status` / `list_cost_cents` are maintained by the webhook. The CMA-backed trace pane is admin-gated (`ADMIN_INVITE_CODE`) and fetched client-side after mount, so admins and non-admins get the same TTFB and a CMA outage can't slow or break a page.
- **Versioning, the simple scheme** — `ensureStack` hashes skill markdown + system prompt + model/effort + tool defs and stamps it on the agent; a mismatch publishes a new skill version and agent version. New sessions get "latest"; running ones are frozen. **Regenerate / Request update** (admin) ends the live run, archives its session, and starts a fresh one on the current version — at most ten per subject. `runs` records agent + skill versions; artifacts keep history.
- **Responsive shell** — below `md` the universe is a left sheet and the sausage a right sheet; at `md`+ the sausage is a retractable panel (state remembered per viewer via `useSyncExternalStore` over localStorage). No data or action changes.
- **Share surface** — favicon from the hero mark, OG/Twitter share cards, apple icon, page titles and descriptions.

### Hardening

- **Hot path + CMA loop hardening** (`docs/reviews/2026-08-29-hot-path-audit.md`, `…-cma-loop-resilience.md`) — `/s/[key]` is one Postgres round (~80ms); status polling hits a tiny route and re-renders only on change; the trace mounts only while the drawer is open. Sessions are created idle → run row → kick, so nothing spends before it is recorded; regenerate interrupts before archiving; the reconciler is capped, per-run fault-isolated, and detects hung runs by session quiet time (interrupt → "continue from notes" → give up); SDK/FMP calls carry real timeouts; the skill retries a failing tool once then posts what it has.
- **Cooperative review** — five fresh-context lenses, every finding adversarially verified; 13 fix-now items landed (reconciler ended runs on any CMA error; webhook dedupe row written before settle; settle answering tools into terminated sessions and resurrecting ended runs; gates; open redirect; doc drift). Report: `docs/reviews/2026-08-29-cooperative-review.md`.
- **Crons** (`vercel.json`, `src/lib/ops/*`, `/api/cron/*` behind `CRON_SECRET`) — the *reconciler* every 5 minutes re-derives every live run from the session resource and re-settles drift / stuck `requires_action` / stale working, ends runs whose session is gone, and archives orphan sessions older than an hour; *GC* daily archives sessions of runs ended > 7 days and prunes `webhook_events` > 30 days. Every repair is the same idempotent settle the webhook runs. `npm run reconcile` / `npm run gc` are dry-run CLIs (`--apply` to act).

### Quality gate and docs

- **Quality gate** — `npm run check` = typecheck + eslint (import order, unused imports) + vitest + knip; runs on `git push` via `.githooks/pre-push` (`prepare` sets `core.hooksPath`) and in GitHub Actions (`ci.yml`). Nine test files (25 tests, no network) defend the seams the principles rest on: the idempotency core against a captured real session log, `answerPendingTools` under duplicate/reordered logs and a throwing runner, the hung-run state machine, the redirect guard, cron auth failing closed, artifact head injection with pinned CDN versions, ticker ranking, and config-hash stability. `npm run e2e` = 8 Playwright tests (auth gate, login, `/webhook` signature rejection, cron 401s) against a built app on :3100 with dummy backend env — no secrets; runs in `e2e.yml`. No branch protection yet; Vercel still auto-deploys `main`.
- **Docs** — architecture index and runbook (`docs/app/`), guided code tour (`docs/codebase/`), sprint notes (`docs/sprints/`). A pre-publication scan of the working tree and full git history for secret shapes came back clean (2026-08-29); the one stray email in a doc was scrubbed.
