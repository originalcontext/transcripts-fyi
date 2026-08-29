# Sprint 1 — "2 hours" (2026-08-29)

Tag: `2-hours`. Prod: https://transcripts.fyi.

## Goal

Get a functioning product out the door on a production-shaped foundation: a longitudinal earnings-call explainer per ticker, with the long-horizon agent work offloaded to Claude Managed Agents and the app kept strictly request/response on Vercel. Prove every layer in dev *and* prod before building on it.

## What we focused on

1. **De-risk before product.** Every dependency got a smoke test in both environments before it carried product weight: Managed Agents webhook + custom-tool round trip, then the same with a real transcript fetch and summary, then Neon/Upstash, then auth. The product page was the last thing written.
2. **No connections.** Neon over HTTP, Upstash over REST, CMA over webhooks. Nothing is held open across serverless invocations; nothing to leak or babysit.
3. **Lean on the primitives.** Agent/environment/skill live in Anthropic's resources (found by metadata); process history lives in the CMA session log; only product state lives in Postgres. Three tables.
4. **Idempotent by construction.** The webhook drives state from the session's own event log, and the artifact write is unique on the tool-use id — so duplicate, reordered, or dropped deliveries are harmless without a transaction.

## Where we landed

- Universe (left) · latest explainer in a sandboxed iframe (middle) · live session trace with budget bump (right).
- Add a ticker → subject → distiller stack found-or-created → $10-capped session → 8 per-quarter fetches → HTML posted → rendered. NVDA: ~3 min, ~$1.40.
- Invite-code auth (`?invite=` links), shadcn/Radix UI, migrations on deploy.

## What we learned (worth remembering)

- **Custom tool results truncate near 100k chars.** Undocumented; built-in tools spill to a file, custom tools don't. Shaped the tool design: list refs, then fetch one transcript per call.
- `session.requires_action` exists in the SDK types but never fired; `session.status_idled` is the event that matters.
- The bundled Managed Agents docs had 11 deltas vs. live — the memory-store beta header and ZDR/HIPAA ineligibility being the ones that bite.
- Vercel marks prod secrets sensitive and won't pull them, which quietly enforces "migrate on deploy, never from a laptop."
- Dev and prod share one Anthropic workspace, so both receive every webhook; sessions carry `metadata.target` and each deployment answers only its own.

## Deliberately deferred

See README → *Below the line*: resiliency, skills & prompts, versioning of skills/agents/environments, persistence at the CMA layer for ongoing synthesis, caching, genUI hardening, simplification pass.

## If we do this again

- Start the docs pull and the dependency smoke tests in parallel with scaffolding — they were the critical path.
- Assume undocumented size ceilings on anything that crosses the platform boundary; test with a real-sized payload first.
- The find-or-create-by-metadata pattern for CMA resources paid for itself twice (smoke, then product); keep it.
