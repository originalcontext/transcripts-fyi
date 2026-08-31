# TODO

What's next, in rough priority. (Until 2026-08-31 this lived in the root README as "Below the line".)

## Webhook consistency & resiliency sprint (first)

The webhook is the single seam between CMA and product state — artifacts, run status, cost all cross there. Make it boringly correct. The crons (reconciler every 5 min, GC daily — see [changelog.md](./changelog.md)) already repair drift, stuck `requires_action`, gone sessions, and orphan sessions. Remaining:

- FMP retries/timeouts inside the handler.
- Handler runtime vs. Vercel function limits.
- Measure how often the reconciler actually finds anything.

## Skills & system prompts sprint

The distiller skill and system prompt are deliberately plain right now; make them effective (longitudinal structure, citations, tone) as a dedicated pass.

## Versioning, later

Roll-forward policy for long-lived runs (lazy on next view / new transcript, or reconciler cron), `ant` YAML in CI if wanted, prompt A/B via `agent_with_overrides`. Environment changes still manual.

## Persistence at the CMA layer for ongoing synthesis

Long-lived session vs. memory store vs. re-run from artifacts when a new transcript arrives.

## Sources of truth vs. cache layers

Transcripts (FMP) are refetched per run. Redis now holds one thing: resolved CMA stack ids keyed by config hash (30-day TTL, forgotten on a 404), so "add a company" is one REST read + `sessions.create`. Anything further only when measurably slow.

## GenUI hardening

The explainer is agent-authored HTML in a `sandbox="allow-scripts"` iframe (unique origin, no same-origin access) with a pinned library set injected from jsDelivr (`src/lib/artifact/imports.ts`). Deliberately punted: CSP on the iframe, SRI hashes on the CDN tags, size limits, what the agent may emit.

## Fix-later from the cooperative review (2026-08-29, `docs/reviews/`)

In rough priority: concurrent add/regenerate can start two live runs for one subject (#14); reconciler's "stuck" predicate races in-flight webhooks — needs per-session serialization (#15); bump-budget has no ceiling (#16); invite login has no brute-force protection (#17); both settlers duplicate the answer-tools block (#18); `listAllEvents` lives in `lib/smoke` but product code depends on it (#22); `latestStopReason` re-derived in two places (#23); bump leaves `runs.status='budget_reached'` until next idle (#24); orphan sweep pre-empts GC's 7-day grace (#25); reconciler pages the whole workspace session list every 5 min under a 60 s cap (#26); raw SDK/Neon error strings reach the browser (#27); `RunStatus` declared twice (#28); `add.ts` holds the whole run lifecycle (#29); GC dry-run counts client-side (#30).

## Second review pass (lenses not yet run)

Cost & spend control; hot-path scaling — every webhook and trace call reads the session's full `events.list`, O(events) per delivery; operability at 2am (logs, alerting, incident runbook); test adequacy vs. claimed invariants.
