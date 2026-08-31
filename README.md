# transcripts.fyi

Understand a company quickly through its earnings-call transcripts: an agent analyzes each of the past twenty calls (map), synthesizes one interactive explainer across them (reduce), and the run stays open to dig further.

Live at [transcripts.fyi](https://transcripts.fyi) (invite-gated).

## How it works

Adding a ticker creates a subject and starts a long-lived, budget-capped Claude Managed Agents session. The agent lists the company's earnings calls, fetches the newest twenty one at a time, writes per-quarter notes in its sandbox, then posts a single self-contained HTML explainer. The app never holds a connection to the agent: each custom tool call arrives as a webhook, is answered from the session's own event log, and syncs run status and cost into Postgres. The product page renders from Postgres only, and a reconciler cron repairs whatever a dropped delivery leaves behind.

## Design notes

- **Serverless end to end.** Next 16 / React 19 / TypeScript on Vercel; Neon over HTTP; Upstash over REST. No connections, no transactions, no job queues, no SSE.
- **One idempotent seam.** Webhooks are the only channel from the agent runtime into the app. State is re-derived from the session's event log, so any event, any number of times, in any order, is safe — and crons repair drift by re-running the same settle.
- **The hot path reads Postgres only.** One query per view; live agent reads exist only in an admin-gated trace pane, fetched client-side, off the render path.
- **Ceilings, not quotas.** $25 per run, 100 subjects, 10 regenerations per subject.

The full decision log is in [docs/app/decisions.md](docs/app/decisions.md).

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

Local dev needs an ngrok tunnel for the webhook — see the [runbook](docs/app/runbook.md).

## Docs

- [docs/app/README.md](docs/app/README.md) — architecture index: mental model, request flow, directory map, data model, invariants
- [docs/app/runbook.md](docs/app/runbook.md) — operations: env vars, local dev, migrations, crons, smoke tests
- [docs/codebase/README.md](docs/codebase/README.md) — guided tour of the code
- [docs/app/decisions.md](docs/app/decisions.md) — decision log with rationale
- [docs/app/changelog.md](docs/app/changelog.md) — what has shipped
- [docs/app/todo.md](docs/app/todo.md) — what's next
- [docs/ideas/](docs/ideas/README.md) — other transcript universes
