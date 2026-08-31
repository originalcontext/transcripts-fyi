@AGENTS.md

## Project docs — read in this order

1. `docs/codebase/README.md` — guided tour of the code (reading order, one request and one webhook traced end to end, conventions, glossary)
2. `docs/app/README.md` — architecture index (mental model, request flow, directory map, data model, invariants)
3. `docs/app/runbook.md` — operations (env vars, local dev + ngrok, migrations, crons, smoke, sharp edges)
4. `README.md` — quick orientation; `docs/app/decisions.md` — decision log; `docs/app/changelog.md` / `docs/app/todo.md` — what shipped, what's next

## Hard rules

- Never move, delete, or rebuild `.next/`, and never restart or interfere with the dev server as a side effect — the owner is testing on `localhost:3000` in parallel.
- Never run anything that spends money unless explicitly asked: `npm run distill`, `npm run smoke:run`, `npm run reconcile -- --apply`, `npm run gc -- --apply`, or any CMA session create/update. Dry runs (`npm run reconcile`, `npm run gc`), `npm run typecheck`, `npm run check`, and `npx vitest run` are fine.
