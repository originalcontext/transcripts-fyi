# API reference: endpoints, SDK namespaces, limits, and the `ant` CLI

All endpoints require `x-api-key` and `anthropic-version: 2023-06-01`, plus the `anthropic-beta` header.

## Beta headers

```
anthropic-beta: managed-agents-2026-04-01
```

The SDK adds this automatically for all `client.beta.{agents,environments,sessions,vaults,deployments,deployment_runs}.*` calls.

| Surface | Header |
|---|---|
| Agents, Environments, Sessions, Events, Threads, Resources, Outcomes, Multiagent, Vaults, Credentials, Deployments, Deployment Runs | `managed-agents-2026-04-01` |
| **Memory store endpoints** | **`agent-memory-2026-07-22`** [live 2026-08-29] — sending it together with `managed-agents-2026-04-01` returns 400 |
| Skills endpoints | `skills-2025-10-02` |
| Files endpoints | `files-api-2025-04-14` |
| Session-scoped file listing (`files.list({scope_id})`) | **both** `files-api-2025-04-14` (SDK adds) **and** `managed-agents-2026-04-01` (you add) |
| OAuth bearer tokens (raw HTTP) | additionally `oauth-2025-04-20` |

On raw HTTP the Managed Agents header **grants Files API access on its own**.

---

## SDK method reference

All resources are under the `beta` namespace. **Python and TypeScript share identical method names** (TS camelCases multi-word namespaces: `memoryStores`, `memoryVersions`, `deploymentRuns`).

| Resource | Python / TypeScript (`client.beta.*`) | Go (`client.Beta.*`) |
|---|---|---|
| Agents | `agents.create` / `retrieve` / `update` / `list` / `archive` | `Agents.New` / `Get` / `Update` / `List` / `Archive` |
| Agent Versions | `agents.versions.list` | `Agents.Versions.List` |
| Environments | `environments.create` / `retrieve` / `update` / `list` / `delete` / `archive` | `Environments.New` / `Get` / `Update` / `List` / `Delete` / `Archive` |
| Environment Work (self-hosted) | `environments.work.poller` / `stats` / `stop` | — |
| Sessions | `sessions.create` / `retrieve` / `update` / `list` / `delete` / `archive` | `Sessions.New` / `Get` / `Update` / `List` / `Delete` / `Archive` |
| Session Events | `sessions.events.list` / `send` / `stream` | `Sessions.Events.List` / `Send` / `StreamEvents` |
| Session Threads | `sessions.threads.list` / `retrieve` / `archive`; `sessions.threads.events.list` / `stream` | `Sessions.Threads.List` / `Get` / `Archive`; `Sessions.Threads.Events.List` / `StreamEvents` |
| Session Resources | `sessions.resources.add` / `retrieve` / `update` / `list` / `delete` | `Sessions.Resources.Add` / `Get` / `Update` / `List` / `Delete` |
| Deployments | `deployments.create` / `update` / `pause` / `unpause` / `archive` / `run` | not documented in available sources |
| Deployment Runs | `deployment_runs.list` / `retrieve` (TS: `deploymentRuns.*`) | not documented in available sources |
| Vaults | `vaults.create` / `retrieve` / `update` / `list` / `delete` / `archive` | `Vaults.New` / `Get` / `Update` / `List` / `Delete` / `Archive` |
| Credentials | `vaults.credentials.create` / `retrieve` / `update` / `list` / `delete` / `archive` / `mcp_oauth_validate` | `Vaults.Credentials.New` / … / `McpOauthValidate` |
| Memory Stores | `memory_stores.create` / `retrieve` / `update` / `list` / `delete` / `archive` | `MemoryStores.New` / … |
| Memories | `memory_stores.memories.create` / `retrieve` / `update` / `list` / `delete` | `MemoryStores.Memories.*` |
| Memory Versions | `memory_stores.memory_versions.list` / `retrieve` / `redact` | `MemoryStores.MemoryVersions.*` |
| Webhooks | `webhooks.unwrap` | — |
| Files | `files.upload` / `list` / `retrieveMetadata` / `download` / `delete` | — |

**Naming quirks:**
- Agents and Session Threads have **no delete** — only `archive`, which is **permanent**. Environments, Sessions, Vaults, Credentials, and Memory Stores have both `delete` and `archive`. Session Resources, Files, Skills, and Memories are `delete`-only. Memory Versions have neither — only `redact`.
- Session resources use `add`, not `create`.
- Go's event stream is `StreamEvents`, not `Stream`.
- The self-hosted worker class is `EnvironmentWorker` from `@anthropic-ai/sdk/helpers/beta/environments` (TS) / `anthropic.lib.environments` (Python).

---

## Endpoints

### Agents

| Method | Path | Notes |
|---|---|---|
| `GET` | `/v1/agents` | List |
| `POST` | `/v1/agents` | Create |
| `GET` | `/v1/agents/{agent_id}` | Get |
| `POST` | `/v1/agents/{agent_id}` | Update. `version` **optional**: supply (≥1) for optimistic concurrency (mismatch → 409), or omit for last-write-wins. |
| `POST` | `/v1/agents/{agent_id}/archive` | **Permanent.** Read-only; new sessions cannot reference it. |
| `GET` | `/v1/agents/{agent_id}/versions` | List versions |

### Sessions

| Method | Path | Notes |
|---|---|---|
| `GET` | `/v1/sessions` | List (paginated; **the only endpoint supporting `prev_page`**) |
| `POST` | `/v1/sessions` | Create |
| `GET` | `/v1/sessions/{session_id}` | Get |
| `POST` | `/v1/sessions/{session_id}` | Update `metadata`/`title`, `agent.tools`/`agent.mcp_servers` (session must be `idle`), or `budget` (change/remove only). `vault_ids` rejected. |
| `DELETE` | `/v1/sessions/{session_id}` | Delete session, event history, container, checkpoints |
| `POST` | `/v1/sessions/{session_id}/archive` | Archive |

### Events / Threads / Resources

| Method | Path |
|---|---|
| `GET` | `/v1/sessions/{session_id}/events` |
| `POST` | `/v1/sessions/{session_id}/events` |
| `GET` | `/v1/sessions/{session_id}/events/stream` (optional `event_deltas[]=agent.message` / `agent.thinking`) |
| `GET` | `/v1/sessions/{session_id}/threads` |
| `GET` | `/v1/sessions/{session_id}/threads/{thread_id}` |
| `POST` | `/v1/sessions/{session_id}/threads/{thread_id}/archive` |
| `GET` | `/v1/sessions/{session_id}/threads/{thread_id}/events` |
| `GET` | `/v1/sessions/{session_id}/threads/{thread_id}/stream` |
| `GET` | `/v1/sessions/{session_id}/resources` |
| `POST` | `/v1/sessions/{session_id}/resources` — attach `file` or `github_repository` (`memory_store` is create-time only; self-hosted accepts **only** `memory_store`) |
| `GET` | `/v1/sessions/{session_id}/resources/{resource_id}` |
| `POST` | `/v1/sessions/{session_id}/resources/{resource_id}` |
| `DELETE` | `/v1/sessions/{session_id}/resources/{resource_id}` |

### Environments

`POST|GET /v1/environments`, `GET|POST /v1/environments/{id}`, `DELETE /v1/environments/{id}` (204), `POST /v1/environments/{id}/archive`, `GET /v1/environments/{id}/work/stats`, `POST /v1/environments/{id}/work/{work_id}/stop`.

### Deployments / Deployment Runs

`POST /v1/deployments`, `POST /v1/deployments/{id}`, `/pause`, `/unpause`, `/archive`, `/run`.
`GET /v1/deployment_runs?deployment_id=...&has_error=true`, `GET /v1/deployment_runs/{deployment_run_id}`.

### Vaults / Credentials

`POST|GET /v1/vaults`, `GET|POST|DELETE /v1/vaults/{vault_id}`, `POST /v1/vaults/{vault_id}/archive`.
`POST|GET /v1/vaults/{vault_id}/credentials`, `GET|POST|DELETE /v1/vaults/{vault_id}/credentials/{credential_id}`, `POST .../archive`, `POST .../mcp_oauth_validate`.

### Memory stores / Files / Skills

See [`memory.md`](./memory.md#endpoints), [`environments.md`](./environments.md#files-api-surface), [`tools.md`](./tools.md#skills-api-endpoints).

---

## Request body quick reference

### CreateAgent

```json
{
  "name": "string (required, 1-256 chars)",
  "model": "claude-opus-5 (required - bare string, or {id, speed?, effort?, inference_geo?} object)",
  "description": "string (optional, up to 2048 chars)",
  "system": "string (optional, up to 100,000 chars)",
  "tools": [ { "type": "agent_toolset_20260401" } ],
  "skills": [
    { "type": "anthropic", "skill_id": "xlsx" },
    { "type": "custom", "skill_id": "skill_abc123", "version": "1" }
  ],
  "mcp_servers": [
    { "type": "url", "name": "github", "url": "https://api.githubcopilot.com/mcp/" }
  ],
  "multiagent": {
    "type": "coordinator",
    "agents": [
      "agent_abc123",
      { "type": "agent", "id": "agent_def456", "version": 4 },
      { "type": "self" }
    ]
  },
  "metadata": { "key": "value (max 16 pairs, keys <=64 chars, values <=512 chars)" }
}
```

Limits: `tools` max **128**, `skills` max **20**, `mcp_servers` max **20** (unique names), `multiagent.agents` **1–20**.

### CreateSession

```json
{
  "agent": "agent_abc123 (required - string shorthand for latest version, or {type: \"agent\", id, version} object)",
  "environment_id": "env_abc123 (required)",
  "title": "string (optional)",
  "resources": [
    {
      "type": "github_repository",
      "url": "https://github.com/owner/repo (required)",
      "authorization_token": "ghp_... (required)",
      "mount_path": "/workspace/repo (optional - defaults to /workspace/<repo-name>)",
      "checkout": { "type": "branch", "name": "main" }
    }
  ],
  "initial_events": [
    { "type": "user.message", "content": [{ "type": "text", "text": "Review the auth module." }] }
  ],
  "vault_ids": ["vlt_abc123 (optional)"],
  "budget": {
    "type": "limit",
    "max_list_cost": { "amount": "2500", "currency": "USD" }
  },
  "metadata": { "key": "value" }
}
```

### CreateEnvironment

```json
{
  "name": "string (required)",
  "description": "string (optional)",
  "config": {
    "type": "cloud | self_hosted",
    "networking": { "type": "unrestricted | limited (union - see SDK types)" },
    "packages": { }
  },
  "metadata": { "key": "value" }
}
```

### CreateDeployment

```json
{
  "name": "Weekly compliance scan",
  "agent": "agent_abc123 (required - same shapes as CreateSession)",
  "environment_id": "env_abc123 (required)",
  "initial_events": [
    { "type": "user.message", "content": [{ "type": "text", "text": "Run the weekly compliance scan." }] }
  ],
  "schedule": { "type": "cron", "expression": "0 20 * * 5", "timezone": "America/New_York" }
}
```

### SendEvents / tool result

```json
{ "events": [ { "type": "user.message", "content": [ { "type": "text", "text": "Hello" } ] } ] }
```

```json
{
  "type": "user.custom_tool_result",
  "custom_tool_use_id": "sevt_abc123",
  "content": [{ "type": "text", "text": "Result data" }],
  "is_error": false
}
```

---

## Errors

```json
{
  "type": "error",
  "error": { "type": "invalid_request_error", "message": "Description of what went wrong" },
  "request_id": "req_011CRv1W3XQ8XpFikNYG7RnE"
}
```

| Status | `error.type` | Description |
|---|---|---|
| 400 | `invalid_request_error` | Malformed or missing required parameters |
| 401 | `authentication_error` | Invalid or missing API key |
| 403 | `permission_error` | Key lacks permission |
| 404 | `not_found_error` | Resource doesn't exist |
| 409 | `invalid_request_error` | Conflicts with current state (e.g. sending to an archived session). **There is no separate `conflict_error` type** — inspect status + message. |
| 413 | `request_too_large` | Body exceeds the max size (32 MB on session create) |
| 429 | `rate_limit_error` | Check `retry-after` |
| 500 | `api_error` | Internal error |
| 529 | `overloaded_error` | Retry with backoff |

Include `request_id` when reporting issues.

---

## Pagination

Most Managed Agents list endpoints use the `page` / `next_page` cursor scheme:

| Field | Where | Notes |
|---|---|---|
| `limit` | query | Max items per page |
| `page` | query | Opaque cursor from a previous response |
| `order` | query | `asc` / `desc` where supported. A cursor encodes the `order` of the request that produced it — reusing it with a different `order` returns 400. |
| `next_page` | response | `null` when no more results |
| `prev_page` | response | **Only `GET /v1/sessions`** supports backward pagination. On endpoints that don't, the field is **absent**, not `null`. |

Every SDK exposes an auto-paginating iterator following `next_page`. In Python and TypeScript, iterate the list result directly. **SDK auto-pagination is forward-only.**

> Message Batches, Files, Models, and several Admin API endpoints use a **different** scheme: `after_id`/`before_id` with `has_more`/`first_id`/`last_id`.

---

## Rate limits

[live 2026-08-29] The live reference gives:

| Operation | Limit |
|---|---|
| Create endpoints (agents, sessions, environments) | **300 requests/minute** |
| Read endpoints (retrieve, list, stream) | **1,200 requests/minute** |

The bundled skill copy gives a slightly different breakdown (create 300 RPM; other Agents/Sessions/Vaults operations 600 RPM; **all** Environments operations 60 RPM with **max 5 concurrent**). The Environments constraint is not contradicted by the live page — treat **60 RPM / 5 concurrent for Environments** as still applicable and the live figures as authoritative for the rest.

Organization-level spend limits and usage-tier rate limits also apply. **Model inference inside a session draws from your organization's standard ITPM/OTPM limits.** Files and Skills endpoints use the standard tier-based rate limits.

On 429 the API returns `rate_limit_error` and a `retry-after` header (seconds). The Anthropic SDK reads it and retries automatically.

---

## Platform availability

From `shared/platform-availability.md` (1P = first-party Claude API, P-AWS = Claude Platform on AWS):

| Feature | 1P | P-AWS | Bedrock | Vertex | Foundry |
|---|---|---|---|---|---|
| **Managed Agents** | beta | beta | **No** | **No** | **No** (inferred; not in Foundry docs either way) |
| Self-hosted sandboxes | beta | beta | No | No | No |
| MCP connector | beta | beta | No | No | beta |
| Web search | Yes | Yes | No | Yes | beta |
| Web fetch | Yes | Yes | No | No | beta |
| Fast mode (`speed: "fast"`) | beta | No | No | No | No |
| `inference_geo` | Yes | Yes | No | No | No |

**Managed Agents does not exist on Amazon Bedrock, Google Vertex AI, or Microsoft Foundry.** On Claude Platform on AWS it exists with differences: the self-hosted worker authenticates with IAM/SigV4 or an AWS-Console API key (Console environment keys don't work there); **sessions on self-hosted environments cannot attach memory stores**; the `GET /v1/environments/{id}/work` list endpoint is unsupported; and the `ant` CLI has **no SigV4 mode**, so use the SDK for setup there.

---

## Data retention

[live 2026-08-29] From the official overview:

> Claude Managed Agents is stateful by design: sessions are long-running, resume cleanly after pauses, and store conversation history, sandbox state, and outputs server-side. Because of this, **Managed Agents is not currently eligible for Zero Data Retention (ZDR) or HIPAA Business Associate Agreement (BAA) coverage.** You retain control over this data: you can delete sessions, and separately delete any files you uploaded, at any time through the API.

## Beta access

Managed Agents is **enabled by default for all API accounts**. Within the beta, **MCP tunnels** and **dreaming** are in a more limited research preview requiring a request for access.

## Branding guidelines (partners)

Allowed: "Claude Agent" (preferred in dropdowns), "Claude" (inside a menu already labeled "Agents"), "{YourAgentName} Powered by Claude". **Not permitted:** "Claude Code" / "Claude Code Agent", "Claude Cowork" / "Claude Cowork Agent", Claude Code-branded ASCII art or visual elements that mimic Claude Code.

---

## `ant` CLI control plane

**CLI for the control plane, SDK for the data plane.** Agents and environments are relatively static resources you manage with `ant` (version-controlled YAML, applied from CI); sessions are dynamic and driven by your application through the SDK.

| | Control plane → `ant` | Data plane → SDK |
|---|---|---|
| Resources | agents, environments, skills, vaults, files | sessions, events |
| Cadence | Once per deploy / ad-hoc | Every task / every turn |
| Lives in | `*.yaml` in your repo + CI + terminal | Application code |
| Typical calls | `create < agent.yaml`, `update --version N`, `list`, `retrieve`, `archive`, `--debug` | `sessions.create()`, `events.stream()`, `events.send()` |

### Install and auth

```sh
# macOS
brew install anthropics/tap/ant
xattr -d com.apple.quarantine "$(brew --prefix)/bin/ant"
```

Credential resolution (first match wins): explicit flags → `ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN` → the `ANTHROPIC_PROFILE`-selected or active profile → Workload Identity Federation env vars → the default profile on disk.

> **The #1 auth trap:** profiles are only consulted when **no API key is set**. A stale exported `ANTHROPIC_API_KEY` silently overrides every profile. An *empty* `ANTHROPIC_API_KEY=""` still wins its slot and authenticates with an empty key. `ant auth status` shows which source won; truly `unset` the key (or use `env -u ANTHROPIC_API_KEY ant ...`).

Interactive login (`ant auth login`) is for development on your own machine. **For CI/servers/containers use Workload Identity Federation**, not interactive login.

An interactive-login token is bound to a **single org+workspace**, and the API only shows resources belonging to it — if an agent, session, or file "disappears", the usual cause is a token scoped to a different workspace. Use one profile per workspace: `ant auth login --profile <name> [--workspace-id wrkspc_01...]`, `ant profile activate <name>`, `ant --profile <name> ...`.

### Version-controlled resources

```yaml
# summarizer.agent.yaml
name: Summarizer
model: claude-sonnet-5
system: |
  You are a helpful assistant that writes concise summaries.
tools:
  - type: agent_toolset_20260401
```

```sh
# Create (once) - capture the ID
AGENT_ID=$(ant beta:agents create < summarizer.agent.yaml --transform id -r)

# Update (CI) - needs ID + current version (optimistic lock)
ant beta:agents update --agent-id "$AGENT_ID" --version 1 < summarizer.agent.yaml
```

Same for environments (`ant beta:environments create|update < env.yaml`). Then:

```sh
ant beta:sessions create --agent "$AGENT_ID" --environment-id "$ENV_ID" --title "Task"
ant beta:sessions:events send --session-id "$SID" \
  --event '{type: user.message, content: [{type: text, text: "Summarize X"}]}'
ant beta:sessions:events stream --session-id "$SID"   # live event stream
ant beta:sessions list --transform '{id,title,status,created_at}' --format jsonl
ant beta:sessions retrieve --session-id "$SID"
ant beta:sessions archive  --session-id "$SID"
ant beta:sessions delete   --session-id "$SID"
```

### Useful global flags

| Flag | Purpose |
|---|---|
| `--format` | `auto`, `json`, `jsonl`, `yaml`, `pretty`, `raw`, `explore` (interactive TUI) |
| `--transform` | GJSON path applied to the response (**per-item** on list endpoints) |
| `-r`, `--raw-output` | Print a transformed string unquoted (jq semantics) |
| `--max-items` | Cap total results from auto-paginating list endpoints (distinct from `--limit`, the server page size) |
| `--format-error` / `--transform-error` | Same, applied to error responses (`-r` does **not** apply to the error path) |
| `--debug` | Print full HTTP request + response to stderr (key redacted) |

`@file` references inline a file's contents into any string-valued field (`--system @./prompts/researcher.txt`). Binary files are auto-base64'd.

The `beta:` prefix auto-sets the right `anthropic-beta` header — don't pass it yourself unless overriding with `--beta <header>`.

---

## Bundled-vs-live deltas

Differences found between the bundled skill copy (2.1.251) and the live docs fetched 2026-08-29. **The live value is used throughout this reference.**

| Topic | Bundled 2.1.251 | Live 2026-08-29 |
|---|---|---|
| Memory store beta header | `managed-agents-2026-04-01` | **`agent-memory-2026-07-22`**; sending both → 400 |
| `effort` inside a session `model` override | "the session runs at the agent's effort" | The agent's effort is **not carried over**; the session runs at the **model's default** effort |
| Sandbox provisioning | "the sandbox comes up when the session first needs it" | "the environment's sandbox begins provisioning as soon as the session is created, so the first tool call does not wait on it" |
| Deployment run error types | `environment_archived`, `agent_archived`, `vault_not_found`, `session_rate_limited`, `service_unavailable` | `environment_archived_error`, `agent_archived_error`, `session_rate_limited_error` (`_error` suffix) |
| Deployment auto-pause | Only "non-recoverable error (archived agent, missing environment)" | Also: archived **subagent** → failed run + auto-pause; archived environment/vault → failed run + auto-pause; `paused_reason.error.type` mirrors the run's `error.type` |
| Rate limits | create 300 RPM; other 600 RPM; environments 60 RPM / 5 concurrent | create 300 RPM; read **1,200 RPM** (environments figure not restated) |
| Memory store capacity | per-memory ≤ 100 KB | plus **10,000 memories per store**, **30-day version retention**, head-version cannot be redacted |
| Memory mount path | `/mnt/memory/<store-name>/` | Same, but name is **slugified**; read `mount_path` off the resource |
| `system.message` model support | Opus 5, Opus 4.8, **Sonnet 5**, Fable 5, Mythos 5 | Opus 4.8, Fable 5, Mythos 5, Opus 5 (**Sonnet 5 not listed**) |
| ZDR / HIPAA | not stated | **Managed Agents is not eligible for ZDR or HIPAA BAA coverage** |
| Research-preview features | not stated | **MCP tunnels** and **dreaming** require requesting access within the beta |
