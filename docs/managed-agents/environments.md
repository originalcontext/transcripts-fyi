# Environments, the sandbox, and file I/O

Read when configuring where a session runs, what it can reach on the network, and how data gets in and out.

## Environments

Creating a session requires an `environment_id`. Environments are **reusable configuration templates** for container provisioning — different environments for different use cases (package sets, networking). Anthropic handles scaling, container lifecycle, and work orchestration.

**Environment names must be unique.** Creating one with an existing name returns 409.

`config.type` is `"cloud"` or `"self_hosted"`:
- `cloud` — container runs on Anthropic's infrastructure.
- `self_hosted` — tool execution moves to your own infra via an outbound-polling worker; the agent loop stays on Anthropic's side. `networking` and `packages` do not apply (`config` is the bare `{"type": "self_hosted"}`). Self-hosted environments accept **only** `memory_store` resources; `file` and `github_repository` are rejected there. See the bundled `shared/managed-agents-self-hosted-sandboxes.md` for the worker.

```ts
const env = await client.beta.environments.create({
  name: "my_env",
  config: {
    type: "cloud",
    networking: { type: "unrestricted" },
  },
});
```

### Networking

| Policy | Description |
|---|---|
| `unrestricted` | Full egress (except legal blocklist) |
| `limited` | Deny-by-default; opt in via `allowed_hosts` / `allow_package_managers` / `allow_mcp_servers` |

```json
{
  "networking": {
    "type": "limited",
    "allow_package_managers": true,
    "allow_mcp_servers": true,
    "allowed_hosts": ["api.example.com"]
  }
}
```

All three `limited` fields are optional. `allow_package_managers` (default `false`) permits PyPI/npm/etc. `allow_mcp_servers` (default `false`) permits the agent's configured MCP endpoints without listing them in `allowed_hosts`.

- **MCP caveat:** under `limited`, either set `allow_mcp_servers: true` or add each MCP server domain to `allowed_hosts` — otherwise the container can't reach them and tools **silently fail**.
- **Packages caveat:** under `limited`, `packages` requires `allow_package_managers: true`, else 400. Listing the registry in `allowed_hosts` is not enough.
- **`networking` does not govern `web_search` / `web_fetch`.** Those run on Anthropic's servers (in cloud *and* self-hosted environments). Restrict them with `allowed_domains` / `blocked_domains` on the toolset `configs` entry — see [`tools.md`](./tools.md#web-search--web-fetch-settings).

### Environment CRUD

| Operation | Method | Path | Notes |
|---|---|---|---|
| Create | `POST` | `/v1/environments` | |
| List | `GET` | `/v1/environments` | Paginated (`limit`, `after_id`, `before_id`) |
| Get | `GET` | `/v1/environments/{id}` | |
| Update | `POST` | `/v1/environments/{id}` | Changes apply only to **new** containers; existing sessions keep their original config |
| Delete | `DELETE` | `/v1/environments/{id}` | Returns 204 |
| Archive | `POST` | `/v1/environments/{id}/archive` | **Read-only**; existing sessions continue, new sessions cannot reference it. No unarchive. |

Also (self-hosted only): `GET /v1/environments/{id}/work/stats`, `POST /v1/environments/{id}/work/{work_id}/stop`.

---

## Resources

Attach files, GitHub repositories, and memory stores to a session. Resources are **resolved during session creation**, so a bad `file_id` or unreachable repo surfaces on the create call rather than mid-run.

- **Max 999 file resources per session.**
- Multiple GitHub repositories per session are supported.
- **Max 8 memory stores per session**, attachable at **session create only** (`sessions.resources.add()` does not accept `memory_store`) — see [`memory.md`](./memory.md).

### File uploads (host → agent)

```ts
// 1. Upload
const file = await client.beta.files.upload({
  file: fs.createReadStream("data.csv"),
  purpose: "agent",
});

// 2. Attach as a session resource
const session = await client.beta.sessions.create({
  agent: agent.id,
  environment_id: envId,
  resources: [
    { type: "file", file_id: file.id, mount_path: "/workspace/data.csv" }
  ],
});
```

- **`mount_path` is required** and must be absolute. Parent directories are created automatically.
- Agent working directory defaults to `/workspace`.
- **Files are mounted read-only** — the agent writes modified versions to new paths.
- **The mounted resource has a different `file_id` than the file you uploaded.** Session creation makes a session-scoped copy: `session.resources[0].file_id !== uploaded.id`. Delete the original via `files.delete(uploaded.id)`; the session-scoped copy is garbage-collected with the session.

> Note: the bundled docs show `purpose: 'agent'` in one example and `purpose: 'agent_resource'` in another. If one is rejected, try the other; the exact enum is not consistently documented in available sources.

### Session outputs (agent → host)

The agent writes files to `/mnt/session/outputs/`. They are automatically captured by the Files API and can be listed/downloaded afterwards:

```ts
for await (const f of client.beta.files.list({
  scope_id: session.id,
  betas: ["managed-agents-2026-04-01"],
})) {
  console.log(f.filename, f.size_bytes);
  const resp = await client.beta.files.download(f.id);
  const text = await resp.text();
}
```

Requirements and gotchas:
- The `write` tool (or `bash`) must be enabled for the agent to create output files.
- The filter parameter is **`scope_id`** (REST: `?scope_id=<session_id>`). The SDK's files resource auto-adds only `files-api-2025-04-14`, so pass `betas: ["managed-agents-2026-04-01"]` explicitly — without it the API may reject `scope_id` as an unknown field.
- Requires `@anthropic-ai/sdk` **>= 0.88.0** (Python `anthropic` >= 0.92.0). Older versions don't type `scope_id`.
- Pass the session ID **verbatim** (e.g. `sesn_011CZx...`) — the API validates the prefix.
- **Indexing lag ~1–3s** between `session.status_idle` and outputs appearing in `files.list`. Retry once or twice if empty.
- The `ant` CLI does **not** expose this flag yet; use the SDK or curl.
- **Fallback** when `scope_id` filtering is unavailable: send a follow-up `user.message` asking the agent to `read` each file under `/mnt/session/outputs/` and return the contents. Text files only, costs output tokens — use to unblock, not as the primary path.

### GitHub repositories

Clones a repo into the container during initialization, before the agent begins. The agent can read, edit, commit, and push via `bash` (`git`). Repos are cached, so later sessions on the same repo start faster.

| Field | Required | Notes |
|---|---|---|
| `type` | Yes | `"github_repository"` |
| `url` | Yes | Repository URL |
| `authorization_token` | Yes | GitHub PAT with repository access. **Never echoed in API responses.** |
| `mount_path` | No | Defaults to `/workspace/<repo-name>` |
| `checkout` | No | `{type: "branch", name: "..."}` or `{type: "commit", sha: "..."}`. Defaults to the repo's default branch. |

Fine-grained PAT permission levels: `Contents: Read` (clone only), `Contents: Read and write` (push + create PRs).

**How auth works:** `authorization_token` is **never placed inside the container**. `git pull`/`git push` and GitHub REST calls against the attached repo are routed through an Anthropic-side git proxy that injects the token after the request leaves the sandbox. Code in the container — including anything the agent writes — cannot read or exfiltrate it.

- Repositories are attached for the lifetime of the session; to change which are mounted, create a new session. You **can** rotate a token on a running session: `client.beta.sessions.resources.update(resource_id, { session_id, authorization_token })`.
- **To generate pull requests you also need the GitHub MCP server.** The `github_repository` resource gives filesystem + git only. PR workflow: edit in the mount → push branch via `bash` (git proxy auth) → create PR via the MCP `create_pull_request` tool (vault auth).
- Mounting a repo also loads skills from its root `.claude/skills` directory — see [`tools.md`](./tools.md#skills-from-a-github-repository).

```ts
const agent = await client.beta.agents.create({
  name: 'GitHub Agent',
  model: 'claude-opus-5',
  mcp_servers: [
    { type: 'url', name: 'github', url: 'https://api.githubcopilot.com/mcp/' },
  ],
  tools: [
    { type: 'agent_toolset_20260401', default_config: { enabled: true } },
    { type: 'mcp_toolset', mcp_server_name: 'github' },
  ],
});

const session = await client.beta.sessions.create({
  agent: agent.id,
  environment_id: envId,
  vault_ids: [vaultId],  // vault contains the GitHub MCP OAuth credential
  resources: [
    {
      type: 'github_repository',
      url: 'https://github.com/owner/repo',
      authorization_token: process.env.GITHUB_TOKEN,  // repo clone token (!= MCP auth)
      checkout: { type: 'branch', name: 'main' },
    },
  ],
});
```

---

## Files API surface

| Operation | Method | Path | SDK |
|---|---|---|---|
| Upload | `POST` | `/v1/files` | `client.beta.files.upload({ file })` |
| List | `GET` | `/v1/files?scope_id=...` | `client.beta.files.list({ scope_id, betas: ["managed-agents-2026-04-01"] })` |
| Get metadata | `GET` | `/v1/files/{id}` | `client.beta.files.retrieveMetadata(id)` |
| Download | `GET` | `/v1/files/{id}/content` | `client.beta.files.download(id)` → `Response` |
| Delete | `DELETE` | `/v1/files/{id}` | `client.beta.files.delete(id)` |

Without the `scope_id` filter, List returns all files uploaded to your account.

## Not documented in available sources

- Container CPU / memory / disk sizing, and whether it is configurable.
- Maximum session wall-clock duration or container idle-eviction timeout for **cloud** environments. (The `--max-idle` flag documented for the self-hosted `ant beta:worker` defaults to `60s`, but that is a worker-side setting, not a cloud sandbox lifetime.)
- Whether the sandbox filesystem persists after a session is archived (only `delete` is documented as removing "session, event history, container, and checkpoints").
