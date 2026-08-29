# Anthropic Claude Managed Agents — local reference

Progressive-disclosure reference for this repo. Read this page first, then open **one** topical file.

## What Managed Agents is (and what it is not)

Managed Agents is Anthropic's **hosted agent harness**. You register a persisted `Agent` config (model, system prompt, tools, MCP servers, skills), then start `Session`s against it. Anthropic runs the agent loop on its own orchestration layer and provisions **one sandbox container per session** where the agent's tools (bash, file ops, code) actually execute. The session streams events back over SSE; you send user messages, tool results, and interrupts in. Conversation history, sandbox filesystem state, and outputs are persisted server-side, so a session survives your process dying and can be resumed later.

The distinction that matters — **harness vs. deployment**:

| Surface | Who writes the agent loop | Who runs the loop | Who runs the tools | State |
|---|---|---|---|---|
| **Messages API + tool use** | You | You (your process) | You | Stateless; you resend the whole message list every turn |
| **SDK Tool Runner** (`client.beta.messages.tool_runner`) | Anthropic's SDK, in your process | You (your process) | You (your functions) | In-memory in your process; dies with your process |
| **Claude Agent SDK** | Anthropic's SDK, in your process | You (your process/host) | You / your host machine | Local; your infrastructure, your sandbox, your lifecycle |
| **Managed Agents** | Anthropic | **Anthropic's servers** | **Anthropic's per-session container** (or your own worker, with a `self_hosted` environment) | **Server-side and durable**: event history, sandbox filesystem, checkpoints |

The official framing (from `platform.claude.com/docs/en/managed-agents/overview`):

> | | Messages API | Claude Managed Agents |
> |---|---|---|
> | **What it is** | Direct model prompting access | Pre-built, configurable agent harness that runs in managed infrastructure |
> | **Best for** | Custom agent loops and fine-grained control | Long-running tasks and asynchronous work |

The Agent SDK and the Tool Runner are *harnesses you host*. Managed Agents is *a harness Anthropic hosts and deploys for you*. If your process is killed mid-run — a Vercel function timing out, a container restart — a Tool Runner / Agent SDK run is gone; a Managed Agents session keeps running and you reconnect to its stream.

## The mandatory flow: Agent (once) → Session (every run)

| Step | Call | Frequency | Fields that live here |
|---|---|---|---|
| 1 | `POST /v1/agents` | **ONCE** (setup / CI). Store `agent.id` **and** `agent.version`. | `name`, `model`, `system`, `tools`, `mcp_servers`, `skills`, `description`, `multiagent`, `metadata` |
| 2 | `POST /v1/sessions` | **Every run** | `agent` (pointer only), `environment_id`, `title`, `resources`, `initial_events`, `vault_ids`, `budget`, `metadata` |

`model` / `system` / `tools` / `mcp_servers` / `skills` are **never** top-level on `sessions.create()`. The session's `agent` field accepts exactly three forms:

- `"agent_abc123"` — string shorthand, latest version
- `{type: "agent", id, version}` — pinned
- `{type: "agent_with_overrides", id, version?, model?, system?, tools?, mcp_servers?, skills?}` — session-local overrides

To change agent behavior, `POST /v1/agents/{id}` (creates a new immutable version). Do **not** call `agents.create()` per request — that accumulates orphaned agents and defeats versioning.

## Files in this folder

| File | Read this when… |
|---|---|
| [`core.md`](./core.md) | You need the agent/session object shapes, versioning rules, session statuses and `stop_reason`s, session budgets, or mid-session config overrides. |
| [`environments.md`](./environments.md) | You're configuring the sandbox: networking policy, file mounts, GitHub repo mounts, or getting artifacts back out of `/mnt/session/outputs/`. |
| [`tools.md`](./tools.md) | You're picking tools, restricting `web_search`/`web_fetch` domains, wiring MCP servers, defining custom tools, or storing secrets in a Vault. |
| [`events.md`](./events.md) | You're consuming the SSE stream: event type catalog, live previews (`event_deltas[]`), interrupts, and the budget-pause event order. |
| [`client-patterns.md`](./client-patterns.md) | You're writing the client loop: lossless reconnect, `processed_at` gating, the correct idle/terminated break gate, the post-idle status race. **Read this before writing any streaming code.** |
| [`multiagent.md`](./multiagent.md) | You want fan-out/fan-in (map-reduce) inside one session: rosters, `{"type":"self"}`, cheaper worker agents, threads, and the 25-thread cap. |
| [`outcomes.md`](./outcomes.md) | You want a rubric-graded iterate→grade→revise loop instead of a plain conversational turn. |
| [`scheduled-deployments.md`](./scheduled-deployments.md) | You want cron-triggered runs, per-firing run records, and pause/unpause/archive. |
| [`memory.md`](./memory.md) | You want state to persist across sessions (memory stores, memories, versions, redaction). **Different beta header.** |
| [`webhooks.md`](./webhooks.md) | You want push notifications of session state instead of holding a stream open. |
| [`api-reference.md`](./api-reference.md) | You need the endpoint/method table, SDK namespace names, rate limits, pagination, or the `ant` CLI YAML control-plane flow. |
| [`typescript-examples.md`](./typescript-examples.md) | You want copy-pasteable TypeScript: create agent, create session, stream, custom tool results, interrupts. |
| [`decision-notes.md`](./decision-notes.md) | You're deciding whether to use Managed Agents for **this** project (agentic longitudinal earnings-transcript explainer on Next.js/Vercel). Opinionated, project-specific. |

## Beta headers

| Header | Date | Covers |
|---|---|---|
| `managed-agents-2026-04-01` | 2026-04-01 | Agents, Environments, Sessions, Events, Session Resources, Session Threads, Outcomes, Multiagent, Vaults, Credentials, Deployments, Deployment Runs |
| `agent-memory-2026-07-22` | 2026-07-22 | **Memory store endpoints only** (`/v1/memory_stores/...`). *Newer than the bundled skill copy — see below.* |
| `skills-2025-10-02` | 2025-10-02 | Skills API (`/v1/skills`) — managing custom skill definitions |
| `files-api-2025-04-14` | 2025-04-14 | Files API uploads/downloads |

Notes:
- The SDK sets the correct header automatically per namespace. You rarely set these by hand.
- **Do not combine** `agent-memory-2026-07-22` with `managed-agents-2026-04-01` on a memory-store request — sending both returns a `400`. Attaching a memory store *to a session* still uses `managed-agents-2026-04-01`.
- On raw HTTP the Managed Agents header **grants Files API access on its own**. The one exception is session-scoped file listing (`files.list({scope_id: session.id})`), which needs **both** the Files header (SDK adds it) and `betas: ["managed-agents-2026-04-01"]` (you add it).

## Source & freshness

- **Primary (source of record):** bundled `claude-api` skill, version **2.1.251**, at
  `/private/tmp/claude-501/bundled-skills/2.1.251/722873db563436dc95748f8ef885502a/claude-api/`
  (`shared/managed-agents-*.md`, `shared/platform-availability.md`, `shared/anthropic-cli.md`, `typescript/managed-agents/README.md`).
- **Compiled:** 2026-08-29.
- **WebFetch: succeeded.** Live pages fetched from `platform.claude.com` on 2026-08-29:
  `managed-agents/overview.md`, `managed-agents/reference.md`, `managed-agents/sessions.md`,
  `managed-agents/budgets.md`, `managed-agents/tools.md`, `managed-agents/memory.md`,
  `managed-agents/multiagent-orchestration.md`, `managed-agents/scheduled-deployments.md`.
- Where the live docs differ from the bundled copy, the live value is used and the difference is called out inline as **[live 2026-08-29]**. The known deltas are collected in [`api-reference.md` → Bundled-vs-live deltas](./api-reference.md#bundled-vs-live-deltas).
- Pages **not** re-fetched (bundled copy is the source of record for them): events-and-streaming, webhooks, define-outcomes, environments, files, permission-policies, vaults, mcp-connector, skills, github, self-hosted-sandboxes, observability, quickstart, agent-setup, cloud-containers, migration.
- Anything marked "not documented in available sources" was genuinely absent from both.
