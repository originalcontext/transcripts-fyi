# Scheduled deployments (cron)

Read when you want an agent to start sessions on a recurring schedule without your infrastructure holding the trigger.

A **scheduled deployment** runs an agent on a cron schedule — **each firing creates a session autonomously**. Requires `managed-agents-2026-04-01` (the SDK sets it for `client.beta.deployments.*` / `client.beta.deploymentRuns.*`).

## Create a deployment

A deployment bundles everything a session needs (agent, environment, optional files / GitHub / memory stores / vaults) plus a `schedule` and the `initial_events` that kick off each run.

- `agent` and `environment_id` are **required** — same shapes as `sessions.create`.
- `initial_events` must contain **at least one** starting event: a `user.message` **or** a `user.define_outcome`. A deployment's `initial_events` **also accepts `system.message`**, which a session's does not.
- `schedule` takes a cron `expression` and an IANA `timezone`. **Minute-level granularity is the maximum.**
- A deployment targeting a **self-hosted** environment can attach `memory_store` resources; `file` and `github_repository` resources need a **cloud** environment. The Console deployment form doesn't offer memory stores for self-hosted environments — attach via API/SDK.

```ts
const deployment = await client.beta.deployments.create({
  name: "Weekly compliance scan",
  agent: agent.id,
  environment_id: environment.id,
  initial_events: [
    {
      type: "user.message",
      content: [{ type: "text", text: "Run the weekly compliance scan." }],
    },
  ],
  schedule: {
    type: "cron",
    expression: "0 20 * * 5",
    timezone: "America/New_York",
  },
});
```

Response (`depl_` prefix). Check `schedule.upcoming_runs_at` to confirm the schedule parses as intended:

```json
{
  "id": "depl_01xyz",
  "status": "active",
  "paused_reason": null,
  "schedule": {
    "type": "cron",
    "expression": "0 20 * * 5",
    "timezone": "America/New_York",
    "last_run_at": null,
    "upcoming_runs_at": ["2026-05-09T00:00:00Z", "2026-05-16T00:00:00Z", "2026-05-23T00:00:00Z"]
  }
}
```

> **Jitter.** `upcoming_runs_at` reflects the exact configured schedule, but **execution is jittered to distribute load: up to 15% of the interval between runs, floored at 5 seconds and capped at 9 minutes.** An hourly deployment can fire up to 9 minutes late — don't build a downstream deadline assuming the listed timestamp.

**Maximum 1,000 scheduled deployments per organization** (contact Anthropic support for more).

### Cron and timezone semantics

- **Expression:** standard POSIX cron (`minute hour day-of-month month day-of-week`). Generate/validate in the Console.
- **Timezone:** IANA identifier (e.g. `"America/Los_Angeles"`).
- **DST:** literal wall-clock matching — `"0 20 * * *"` in `America/New_York` fires at 8:00 PM local regardless of EST/EDT.

> **DST edge:** wall-clock times that don't exist on a spring-forward day (e.g. 2 AM) are **skipped**; times occurring twice on a fall-back day **fire twice**. Schedule outside the 1–3 AM local window, or use UTC, when missed or duplicate executions are unacceptable.

## Deployment budgets

A deployment accepts the same `budget` object as a session (`{type: "limit", max_list_cost: {amount, currency}}`, cents string, `USD` only). **The cap is copied onto each session at fire time**, so it bounds each run separately rather than cumulative spend across runs.

Update semantics differ from a session's:

| | Session budget | Deployment budget |
|---|---|---|
| Settable on create | Yes | Yes |
| Settable on update | **No** (create-only) | **Yes** |
| Clearable with `null` | Yes | Yes |
| Re-addable after clearing | **No** (one-way) | **Yes** |
| Effect of a change | Immediate on that session | **From the next fired session**; already-running sessions keep their cap (change those via their own session update) |

## Deployment runs

Every trigger attempt — successful or not — writes a **deployment run** record (`drun_` prefix), so you can audit failures independently of the session lifecycle. A successful run carries the created `session_id`; a failed run carries an `error` whose `type` explains why session creation was rejected.

```typescript
for await (const run of client.beta.deploymentRuns.list({
  deployment_id: deployment.id,
  has_error: true,
})) {
  console.log(run.created_at, run.error?.type, run.error?.message);
}
```

Raw HTTP: `GET /v1/deployment_runs?deployment_id=...&has_error=true`. Single run: `GET /v1/deployment_runs/{deployment_run_id}` — a `deployment_run.*` webhook event carries the run ID as its `data.id`.

```json
{
  "type": "deployment_run",
  "id": "drun_01abc124",
  "deployment_id": "depl_01xyz",
  "trigger_context": { "type": "schedule", "scheduled_at": "2026-05-09T00:00:00Z" },
  "session_id": null,
  "error": {
    "type": "environment_archived_error",
    "message": "environment `env_01abc` is archived"
  },
  "agent": { "type": "agent", "id": "agent_01ghi789", "version": 3 },
  "created_at": "2026-05-09T00:00:01Z"
}
```

**Error types.** [live 2026-08-29] The live docs use an `_error` suffix — `environment_archived_error`, `agent_archived_error`, `session_rate_limited_error`. The bundled skill copy lists them without the suffix (`environment_archived`, `agent_archived`, `vault_not_found`, `session_rate_limited`, `service_unavailable`). **Match on a prefix or check both forms** rather than hard-coding one spelling.

Manual runs do **not** emit `deployment_run.*` webhook events.

## Lifecycle: pause / unpause / archive

| Operation | SDK | Effect |
|---|---|---|
| Pause | `client.beta.deployments.pause(id)` | Suppresses scheduled triggers go-forward. Sessions already running continue. **Manual runs are still permitted while paused.** Sets `paused_reason: {"type": "manual"}`. |
| Unpause | `client.beta.deployments.unpause(id)` | Resumes from the next scheduled occurrence. **Missed triggers are not backfilled.** Clears `paused_reason`. |
| Archive | `client.beta.deployments.archive(id)` | **Terminal** — the schedule stops and the deployment can no longer be modified. Use pause for anything reversible. |

Raw HTTP: `POST /v1/deployments/{deployment_id}/pause` (likewise `/unpause`, `/archive`).

## Failure behavior

- **Rate-limited:** recorded immediately as a `session_rate_limited_error` run, **no retry** — the schedule tries again at the next occurrence. (Rate limits on API calls *inside* a session are handled by the session itself.)
- **Agent archived:** the deployment is automatically **archived** (terminal) in the same operation. **Agent deleted:** the next scheduled trigger detects the missing agent and archives the deployment then. Either way **no deployment run is recorded** and no further sessions are created.
- [live 2026-08-29] **Archived subagent:** the next trigger records a failed run with `error.type: "agent_archived_error"` and the deployment is **automatically paused** so you can fix the agent and resume.
- [live 2026-08-29] **Other unrecoverable session-creation errors** (archived environment or vault) behave the same way: failed run recorded and the deployment **auto-paused**. `paused_reason.error.type` mirrors the failed run's `error.type`.
- The `deployment.paused` webhook fires for auto-pauses too. Recoverable failures, **including rate limits, do not auto-pause**.

## Manual runs

`POST /v1/deployments/{deployment_id}/run` (SDK: `client.beta.deployments.run(id)`) creates a session immediately and writes a run with `trigger_context.type: "manual"`. Use it to **test a deployment before committing to the schedule** — and it works even while the deployment is paused.

## Webhook coverage

The outcome of each **scheduled** run (`deployment_run.started` / `.succeeded` / `.failed`) and each lifecycle change (`deployment.created` / `.updated` / `.paused` / `.unpaused` / `.archived` / `.deleted`) is delivered as a webhook event — see [`webhooks.md`](./webhooks.md).

## Emitting deployment code — version check

Deployments are newer than the rest of the Managed Agents surface. Before writing `client.beta.deployments` / `client.beta.deploymentRuns` calls, verify the installed SDK exposes them (`ant beta:deployments --help`; in TS, check the property exists). If not, use raw HTTP against `POST /v1/deployments` with the `managed-agents-2026-04-01` beta header.
