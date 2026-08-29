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
- **Docs** — `docs/managed-agents/` local reference, verified against live docs 2026-08-29. Sprint notes in `docs/sprints/`.

- **Product v0** — three panes: universe (left), latest explainer rendered in a sandboxed iframe (middle), "how the sausage was made" live from the CMA session with a budget-bump button (right). "Add to universe" creates the subject, finds-or-creates the distiller stack, starts a $10-capped long-lived session; the webhook answers `list_transcripts` / `fetch_transcript` (FMP) and `post_artifact` (Postgres). NVDA: 8 quarters, ~3 min, ~$1.40.
- **Data model** — `subjects` (kind + key), `runs` (subject × skill → one CMA session), `artifacts` (append-only, unique on tool-use id). `docs/` and `README` carry the rationale.

## Below the line (next)

- **Resiliency sprint** — orphaned sessions if the run insert fails after session create; run status vs. live session status; retries on FMP; what "working" means in the sidebar beyond "no artifact yet".
- **Skills & system prompts sprint** — the distiller skill and system prompt are deliberately plain right now; make them effective (longitudinal structure, citations, tone) as a dedicated pass.
- **Versioning of skills, agents, environments** — today: skill found by name (edits need a manual new version), agent auto-versions on tool drift, environment never changes. Think through implications: pinning runs to versions, migrating long-lived sessions, rollback.
- **Persistence at the CMA layer for ongoing synthesis** — long-lived session vs. memory store vs. re-run from artifacts when a new transcript arrives.
- **Sources of truth vs. cache layers** — transcripts (FMP) are refetched per run; Redis is idle. Add caching only when something is measurably slow.
- **GenUI hardening** — the explainer is agent-authored HTML in a `sandbox=""` iframe; revisit CSP, size limits, and what the agent may emit.
- Simplification pass: fold `smoke/stack.ts` and `distill/stack.ts` once there are two real skills.

## Future ideas

- **Other universes.** Earnings transcripts were the first demo, not necessarily the best. Explore transcript/document universes in science and healthcare (trial readouts, FDA advisory-committee transcripts, grand rounds, conference Q&A) — each is a skill plus a skill-specific toolset on the same `subjects` / `runs` / `artifacts` model.

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

## Running it

```sh
npm run dev                      # http://localhost:3000 (needs .env.local via `vercel env pull`)
npm run distill -- NVDA           # CLI twin of "Add to universe"
npm run smoke:run -- --target dev # /smoke page, CLI twin
npm run smoke:storage
npm run db:generate && npm run db:migrate   # dev only
```
