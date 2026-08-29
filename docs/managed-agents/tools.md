# Tools, skills, MCP, and vault credentials

Read when choosing what the agent can do and how it authenticates.

## Server tools vs client tools

| Type | Who runs it | How it works |
|---|---|---|
| **Prebuilt Claude Agent tools** (`agent_toolset_20260401`) | Anthropic, on the session's container (cloud). For `self_hosted`, **your** worker supplies and runs the file/bash tools. `web_search` / `web_fetch` **always** run on Anthropic's servers, in both environment types. | File ops, bash, web search/fetch. Enable all at once or configure individually. |
| **MCP tools** (`mcp_toolset`) | Anthropic's orchestration layer | Capabilities from connected MCP servers. Grant access per-server. |
| **Custom tools** (`custom`) | **You** — your application handles the call | Agent emits `agent.custom_tool_use`, session goes `idle`, you send `user.custom_tool_result`. |

**Recommendation:** enable the whole prebuilt toolset, then disable individually as needed.

**Versioning:** the toolset is a versioned static resource; when underlying tools change a new version is created (hence `_20260401`).

## Agent toolset

`agent_toolset_20260401` provides:

| Tool | Description |
|---|---|
| `bash` | Execute bash commands in a shell session |
| `read` | Read a file from the sandbox filesystem (text, images, PDFs, Jupyter notebooks) |
| `write` | Write a file to the sandbox filesystem |
| `edit` | Perform string replacement in a file |
| `glob` | Fast file pattern matching using glob patterns |
| `grep` | Text search using regex patterns |
| `web_fetch` | Fetch content from a URL |
| `web_search` | Search the web for information |

There is **no separate hosted "code execution" tool** in the Managed Agents toolset — code execution is `bash` inside the sandbox. (`code_execution_20250825` is a Messages-API server tool; it is not part of `agent_toolset_20260401`.)

Enable everything:

```json
{ "tools": [ { "type": "agent_toolset_20260401" } ] }
```

Everything except bash:

```json
{
  "tools": [
    {
      "type": "agent_toolset_20260401",
      "default_config": { "enabled": true },
      "configs": [ { "name": "bash", "enabled": false } ]
    }
  ]
}
```

Only specific tools (default off, opt in):

```json
{
  "tools": [
    {
      "type": "agent_toolset_20260401",
      "default_config": { "enabled": false },
      "configs": [
        { "name": "bash", "enabled": true },
        { "name": "read", "enabled": true }
      ]
    }
  ]
}
```

| Field | Required | Description |
|---|---|---|
| `type` | Yes | `"agent_toolset_20260401"` |
| `default_config` | No | Applied to all tools: `{ "enabled": bool, "permission_policy": {...} }` |
| `configs` | No | Per-tool overrides: `[{ "name", "type"?, "enabled", "permission_policy" }]`. `name` identifies the tool; `type` is optional in requests (server infers from `name`) and always present in responses. |

> **Typed SDKs:** each `configs` entry is a union member with one type per built-in tool (`BetaManagedAgentsWebFetchToolConfigParams`, `...WebSearchToolConfigParams`, `...BashToolConfigParams`, …), discriminated by `type`. In TypeScript/Python/Ruby, plain objects with `name` + `enabled` + `permission_policy` still work. In Go/Java/C#/PHP you must build each entry from its per-tool type.

**Large tool outputs:** if a tool returns more than **100,000 characters (~25,000 tokens)**, the output is automatically written to a file in the sandbox — the agent gets a truncated preview plus the file path and can `read` the full content. No configuration required. Threshold is in *characters*. Applies to built-in tools and MCP tools.

## Permission policies

Control when **server-executed** tools (agent toolset + MCP) run automatically vs. wait for approval. Does **not** apply to custom tools.

| Policy | Behavior |
|---|---|
| `always_allow` | Tool executes automatically (default) |
| `always_ask` | Session emits `session.status_idle` and pauses until you send a `user.tool_confirmation` |

```json
{
  "type": "agent_toolset_20260401",
  "default_config": {
    "enabled": true,
    "permission_policy": { "type": "always_allow" }
  },
  "configs": [
    { "name": "bash", "permission_policy": { "type": "always_ask" } }
  ]
}
```

Responding:

```json
{ "type": "user.tool_confirmation", "tool_use_id": "sevt_abc123", "result": "allow" }
{ "type": "user.tool_confirmation", "tool_use_id": "sevt_def456", "result": "deny", "message": "Read .env.example instead" }
```

The optional `message` on a deny is delivered to the agent so it can adjust. See [`client-patterns.md`](./client-patterns.md#4-tool_confirmation-round-trip) for the exact round-trip — in particular, `tool_use_id` is the **event id** (`sevt_...`), not a `toolu_...` id.

## Web search & web fetch settings

`web_search` and `web_fetch` run on **Anthropic's servers regardless of environment type**, so an environment's `networking` policy does **not** govern them. Set `allowed_domains` (only these hosts) **or** `blocked_domains` (never these hosts) — never both on one entry — on the tool's `configs` entry. Each tool carries its own list. Organization-level Console web settings apply to the Messages API only, **not** to Managed Agents sessions.

```json
{
  "type": "agent_toolset_20260401",
  "configs": [
    {
      "type": "web_search",
      "name": "web_search",
      "allowed_domains": ["docs.example.com", "arxiv.org"],
      "user_location": { "type": "approximate", "country": "US", "timezone": "America/Los_Angeles" }
    },
    {
      "type": "web_fetch",
      "name": "web_fetch",
      "blocked_domains": ["ads.example.com"],
      "max_content_tokens": 50000
    }
  ]
}
```

| Setting | Applies to | Description |
|---|---|---|
| `allowed_domains` | `web_search`, `web_fetch` | Only hosts the tool can reach. Mutually exclusive with `blocked_domains` on the same entry. |
| `blocked_domains` | `web_search`, `web_fetch` | Hosts the tool cannot reach. |
| `max_content_tokens` | `web_fetch` | Positive integer cap on fetched **text** content entering context (binary content such as PDFs is **not** capped). |
| `user_location` | `web_search` | `{ "type": "approximate", city?, region?, country? (2-letter uppercase ISO 3166-1), timezone? (IANA) }` — at least one optional field. |

**Runtime behavior:** a `web_fetch` call outside its list returns an error result to the agent (`is_error: true` on `agent.tool_result`, content names `url_not_allowed`); `web_search` **silently omits** results outside its list.

### Domain list rules

Violations → 400 `invalid_request_error` on agent create/update and on session create/update supplying `tools`. Messages name the list and zero-based index (e.g. `allowed_domains.0: IP addresses are not supported...`).

- **1–64 domains per list**, each 1–255 chars. Empty list rejected — omit the field or send `null` for "no restriction". Duplicates within a list rejected.
- Plain hostname only: `example.com`, not `https://example.com`, `example.com:443`, or `*.example.com`. Case-insensitive; a single trailing `/` ignored.
- A listed domain covers **itself and its subdomains** (`example.com` covers `docs.example.com`; `docs.example.com` does **not** cover `example.com` or `api.example.com`). `www.` is an ordinary subdomain — list the bare domain to cover both.
- Rejected: IP addresses in any form (including `127.1`); bare TLDs/registry suffixes (`com`, `co.uk`, `gov.uk`); single-label names (`intranet`); `localhost` and hosts ending in `.localhost`, `.local`, `.internal`, `.localdomain`, `.invalid`; non-ASCII (use `xn--` Punycode).
- `web_fetch` domains **cannot carry a path**. `web_search` domains may carry a path suffix (`example.com/blog`, no spaces / `?` / `#` / `$ , | ^ !`), matched as a URL pattern — prefer plain hostnames.
- Provider-dependent rejections: a domain Anthropic's crawler may not access; an unsupported `user_location.country` (message ends `not a country the search provider supports`); an invalid IANA `timezone`.

The session **re-checks the config when it first initializes the tool**; if a previously accepted setting is no longer valid it emits `session.error` and goes `idle` **without retrying**. Fix via a session tools update, update the agent too, then send a new `user.message`.

**Multiagent layering:** every list on the path to a thread applies at once — a roster agent is bound by its own lists, by those of every agent that called it, and by the coordinator's *current* lists. **Allow-lists intersect, block-lists union**, so a roster agent can narrow but never widen. Disjoint allow-lists leave the tool available but every call fails `url_not_allowed`. `max_content_tokens` and `user_location` are **not** combined: own value → caller's → coordinator's. `{"type": "self"}` entries follow the coordinator. **The outcome grader runs without the web tools.**

**vs. the Messages API `web_search_20260209` / `web_fetch_20260209`:** same vocabulary, but 64-entry cap, no path on `web_fetch` domains, and **no `max_uses`, `citations`, or `cache_control`**. Settings move from per-request to once-on-the-agent.

## Custom tools (client-side)

Executed by **your application**. Flow:

1. Agent decides to use it → session emits `agent.custom_tool_use` with inputs
2. Session goes `idle`
3. Your application executes the tool
4. You send `user.custom_tool_result`
5. Session resumes `running`

No permission policy needed — you're the one executing.

```json
{
  "tools": [
    {
      "type": "custom",
      "name": "get_weather",
      "description": "Fetch current weather for a city.",
      "input_schema": {
        "type": "object",
        "properties": {
          "city": { "type": "string", "description": "City name" }
        },
        "required": ["city"]
      }
    }
  ]
}
```

Best practices (from the live docs): extremely detailed descriptions (3–4 sentences minimum); consolidate related operations into fewer tools with an `action` parameter rather than one tool per action; namespace tool names by resource (`db_query`, `storage_read`); return only high-signal, stable identifiers.

## MCP servers

Configuration is **split across agent and vault**:

1. **Agent** declares which servers to connect to — `type`, `name`, `url`, **no auth**.
2. **Vault** stores the credentials. Attach via `vault_ids` on session create.

| Field | Required | Description |
|---|---|---|
| `type` | Yes | `"url"` |
| `name` | Yes | Unique; referenced by `mcp_toolset.mcp_server_name` |
| `url` | Yes | Endpoint URL (Streamable HTTP transport; servers that only support the deprecated SSE transport still work via automatic fallback) |

```json
{
  "mcp_servers": [
    { "type": "url", "name": "linear", "url": "https://mcp.linear.app/mcp" }
  ],
  "tools": [
    { "type": "mcp_toolset", "mcp_server_name": "linear" }
  ]
}
```

Session side: `{ "agent": "agent_abc123", "environment_id": "env_abc123", "vault_ids": ["vlt_abc123"] }`

- **Per-tool enablement:** `mcp_toolset` accepts `default_config: {enabled: false}` + `configs: [{name, enabled: true}]`. MCP `configs` entries take **only** `name` (the bare tool name as the server reports it), `enabled`, and `permission_policy` — no `type`, none of the web settings.
- **Invalid vault credentials don't block session creation.** The session creates; a `session.error` event describes the MCP auth failure; auth retries on the next `session.status_idle → session.status_running` transition.
- **MCP auth tokens ≠ REST API tokens.** Hosted MCP servers typically require **OAuth bearer tokens**, not the service's native API keys. A Notion `ntn_` integration token will **not** work as a vault credential for the Notion MCP server.

## Vaults — the credential store

Two credential categories:

- **MCP credentials** (`mcp_oauth`, `static_bearer`) — keyed by `mcp_server_url`. Injected automatically when the agent connects to that URL. **Matching is normalized, not byte-exact:** scheme and host lowercased, default ports and trailing slashes stripped. A different path, subdomain, or *non-default* port breaks the match; if nothing matches, the connection is attempted **unauthenticated**. `mcp_oauth` tokens are auto-refreshed via the standard OAuth 2.0 `refresh_token` grant. This is the only way to authenticate MCP servers.
- **Environment variables** (`environment_variable`) — keyed by `secret_name` (the env var name). **The sandbox sees only an opaque placeholder; the real secret is substituted into the outbound request at egress.** Use for any service authenticating via an env var: CLIs (`aws`, `gcloud`, `stripe`), SDKs, or direct `curl` from `bash`.

Secret fields you supply (`token`, `access_token`, `refresh_token`, `client_secret`, `secret_value`) are **write-only** — never returned in API responses.

### Credentials never enter the sandbox

A deliberate security boundary: code in the sandbox (including anything the agent writes) cannot read or exfiltrate a vaulted credential, even under prompt injection. Credentials are injected by Anthropic-side proxies **after** a request leaves the sandbox:

- **MCP tool calls** — routed through a proxy that adds the credential.
- **Git operations on attached GitHub repositories** — routed through a git proxy injecting the resource's `authorization_token`.
- **Environment-variable credentials** — placeholder in the sandbox; real value replaces it at egress, on requests to the credential's allowed hosts only. **Substitution covers request headers and body only** — a secret embedded in the **URL path is never substituted**, so path-secret endpoints (e.g. Slack incoming-webhook URLs) can't be vaulted; use header-based auth instead.

**Do not put API keys in the system prompt or user messages as a workaround** — they persist in the session's event history, are returned by `events.list()`, and are included in compaction summaries.

**When vault credentials don't fit** (self-hosted sandboxes — `environment_variable` is not supported there; clients that reject the placeholder via local format validation; secrets that must never leave your infra; calls needing host-side binaries): register a **custom tool** and keep the secret host-side. See [`client-patterns.md`](./client-patterns.md#9-secrets-for-non-mcp-apis--keep-them-host-side).

### Flow

1. `client.beta.vaults.create(...)` — one per tenant/user, or one shared
2. `client.beta.vaults.credentials.create(...)`
3. `vault_ids: ["vlt_..."]` on session create
4. Anthropic auto-refreshes OAuth tokens and substitutes secrets at runtime

### MCP OAuth credential shape

```json
{
  "display_name": "Notion (workspace-foo)",
  "auth": {
    "type": "mcp_oauth",
    "mcp_server_url": "https://mcp.notion.com/mcp",
    "access_token": "<current access token>",
    "expires_at": "2026-04-02T14:00:00Z",
    "refresh": {
      "refresh_token": "<refresh token>",
      "client_id": "<your OAuth client_id>",
      "token_endpoint": "https://api.notion.com/v1/oauth/token",
      "token_endpoint_auth": { "type": "none" }
    }
  }
}
```

`token_endpoint_auth` is a discriminated union:

| `type` | Shape | Use when |
|---|---|---|
| `"none"` | `{type: "none"}` | Public OAuth client (no secret) |
| `"client_secret_basic"` | `{type: "client_secret_basic", client_secret: "..."}` | Confidential client, HTTP Basic |
| `"client_secret_post"` | `{type: "client_secret_post", client_secret: "..."}` | Confidential client, secret in body |

Omit `refresh` entirely if you only have an access token — it works until it expires, then the agent loses access.

### Environment-variable credential shape

```json
{
  "display_name": "Twilio API key for sandbox",
  "auth": {
    "type": "environment_variable",
    "secret_name": "TWILIO_API_KEY",
    "secret_value": "sk-your-secret-here",
    "networking": {
      "type": "limited",
      "allowed_hosts": ["api.twilio.com", "*.twilio.com"]
    }
  }
}
```

`networking.allowed_hosts` controls which outbound hosts the secret can be substituted for — `{"type": "limited", "allowed_hosts": [...]}` or `{"type": "unrestricted"}`. Limiting is strongly recommended.

**`injection_location`** (optional, sibling of `networking`) controls **where** in the outbound request the secret is substituted: `{header: bool, body: bool}`. `allowed_hosts` scopes *which hosts*; `injection_location` scopes *which parts of the request*. Most services read an API key from a header, so `{"header": true}` is narrower. **A placeholder in a disabled location is neither substituted nor stripped** — the literal placeholder string is sent to the third party.

| Operation | `injection_location` semantics |
|---|---|
| Create | Omit entirely → both locations enabled. Provide the object → any omitted field defaults to `false`. |
| Update | Fields **merge individually** — `{"body": false}` disables body and leaves `header` unchanged. Takes effect on the session's next operation. |

A credential must have at least one location enabled; disabling both → 400, as does explicit `null` for the object or either field.

Three warnings:
- **Credentials created in the Console are header-only by default** — unlike the API, where omitting the field enables both. If your client sends the secret in the body (a form-encoded token request), the placeholder passes through literally and the service rejects it.
- **Two networking layers, both required.** `networking.allowed_hosts` on the credential controls which requests *use the secret*, not which are *allowed*. The agent must also reach the domain at the **environment level** (`unrestricted`, or the host in the environment's `allowed_hosts`). Missing from either layer → the request fails.
- **Client-side validation caveat.** Substitution happens at egress. A client that validates the credential *format* locally (e.g. checks the key starts with `sk-`) will see the opaque placeholder and may fail at startup.

### Constraints (all credential types)

- **Unique key per vault.** `mcp_server_url` / `secret_name` must be unique among active credentials; duplicates → 409.
- **Keys are immutable.** Secret values, `display_name`, and `injection_location` can be updated; to change `mcp_server_url`, `secret_name`, `token_endpoint`, or `client_id`, archive and create a new one. Archiving purges the secret and frees the key.
- **Maximum 20 credentials per vault.**
- Credentials are **not validated until session runtime**.
- Vaults are **workspace-scoped**. `vault_ids` is settable at session **create** only.

---

## Skills

Filesystem-based reusable expertise. Two ways in: **attached** via the agent's `skills` array, or **loaded from a mounted GitHub repository**.

| Type | What it is |
|---|---|
| **Pre-built Anthropic skills** | Common document tasks (`xlsx`, `docx`, `pptx`, `pdf`). Reference by name. |
| **Custom skills** | Created via the Skills API. Reference by `skill_id` + optional `version`. |

**Max 20 skills per agent** (prebuilt + custom combined). Agent creation uses `managed-agents-2026-04-01`; the separate Skills API uses `skills-2025-10-02`.

```ts
const agent = await client.beta.agents.create({
  name: "Financial Agent",
  model: "claude-opus-5",
  system: "You are a financial analysis agent.",
  skills: [
    { type: "anthropic", skill_id: "xlsx" },
    { type: "custom", skill_id: "skill_abc123", version: "latest" },
  ],
});
```

| Field | Anthropic skill | Custom skill |
|---|---|---|
| `type` | `"anthropic"` | `"custom"` |
| `skill_id` | Skill name (`"xlsx"`, `"docx"`, `"pptx"`, `"pdf"`) | Skill ID (`"skill_abc123"`) |
| `version` | `"latest"` or a version number | `"latest"` or a version number |

`version` is optional on **both** kinds, defaults to `"latest"`.

### Skills from a GitHub repository

When a session mounts a repo, the repository's root `.claude/skills` directory is scanned at session start; each skill found becomes available (name, description, sandbox path), and the agent reads its `SKILL.md` when a task matches.

- Discoverable: `.claude/skills/<skill-name>/`, **one directory level deep at the repository root**. Not discoverable: a bare `.claude/skills/SKILL.md`, anything nested deeper, a `skills/` directory outside `.claude`, or a `.claude/skills` inside a package subdirectory.
- **Cloud sandboxes only.**
- **Scanned once, at session start**, from the checked-out state. Mid-session commits are not picked up; repos added to a *running* session are not scanned.
- Coexists with attached skills; same-named skills are both available, each announced with its own path.

> **Repository skills are agent instructions — treat them as part of your trust boundary.** Anyone who can commit to a mounted repo (a merged external PR, a compromised dependency) can add or edit `.claude/skills/` content, and the platform loads it at session start **with no review step**, where `bash` and `web_fetch` give injected instructions real capability. Only mount repositories you trust.

### Skills API endpoints

| Operation | Method | Path |
|---|---|---|
| Create Skill | `POST` | `/v1/skills` |
| List Skills | `GET` | `/v1/skills` |
| Get Skill | `GET` | `/v1/skills/{id}` |
| Delete Skill | `DELETE` | `/v1/skills/{id}` |
| Create Version | `POST` | `/v1/skills/{id}/versions` |
| List Versions | `GET` | `/v1/skills/{id}/versions` |
| Get Version | `GET` | `/v1/skills/{id}/versions/{version}` |
| Delete Version | `DELETE` | `/v1/skills/{id}/versions/{version}` |
