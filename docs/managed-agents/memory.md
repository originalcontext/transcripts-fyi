# Memory stores

Read when you want agent state to persist **across** sessions.

> **Different beta header.** [live 2026-08-29] Memory store endpoints use **`agent-memory-2026-07-22`**, not `managed-agents-2026-04-01`. **Do not send both** — a memory-store request carrying both returns a `400`. Attaching a memory store *to a session* is a session endpoint and still uses `managed-agents-2026-04-01`. The SDK sets the correct header automatically. (The bundled skill copy 2.1.251 still says memory stores ship under `managed-agents-2026-04-01`; the live docs supersede it.)

Sessions are ephemeral by default. A **memory store** is a **workspace-scoped** collection of small text documents that persists across sessions. Attached to a session via `resources[]`, it is mounted into the container as a filesystem directory; the agent reads and writes it with the ordinary file tools (`bash`, `read`, `write`, `edit`, `glob`, `grep`) — **there are no dedicated memory tools** — and a system-prompt note tells it the mount is there. The agent toolset is therefore **required** for memory to be usable.

Every mutation produces an immutable **memory version** (`memver_...`) — audit trail and point-in-time rollback/redact.

> **Never store credentials, API keys, or tokens in memory stores.** Memories persist and are returned verbatim into future contexts — a key written once is replayed into every later session that mounts the store. Use vault `environment_variable` credentials instead. If a secret has been written, delete the memory **and redact the affected versions**.

## Object model

| Object | ID prefix | Scope | Notes |
|---|---|---|---|
| Memory store | `memstore_...` | Workspace | Attach to sessions via `resources[]` |
| Memory | `mem_...` | Store | One text file addressed by `path` |
| Memory version | `memver_...` | Store (not the memory) | Immutable snapshot per mutation; `operation` in `created` / `modified` / `deleted` |

## Limits

| Limit | Value |
|---|---|
| Memory size | **100 kB (~25k tokens) each** — prefer many small files |
| Memories per store | **10,000** [live 2026-08-29] |
| Memory stores per session | **8** |
| `instructions` per attachment | ≤ 4,096 chars |
| Version retention | [live 2026-08-29] **30 days after write**; recent versions of a *live* memory are always kept regardless of age. Export via the API to preserve longer. |

When a store hits 10,000 memories, **writes to new memories fail** — both direct `memories.create` and the agent's file writes to unmapped paths. Existing memories stay readable and editable.

## Create a store

`description` is passed to the agent — write it for the model, not for humans.

```ts
const store = await client.beta.memoryStores.create({
  name: "User Preferences",
  description: "Per-user preferences and project context."
});
console.log(store.id); // memstore_01Hx...
```

Stores support `retrieve` / `update` / `list` (with `include_archived`, `created_at_{gte,lte}` filters) / `delete` / `archive`. **Archive** makes the store read-only — existing session attachments continue, new sessions cannot reference it; **no unarchive**.

### Seed with content (optional)

```ts
await client.beta.memoryStores.memories.create(store.id, {
  path: "/formatting_standards.md",
  content: "All reports use GAAP formatting. Dates are ISO-8601..."
});
```

`memories.create` returns `409` (`memory_path_conflict_error`, with `conflicting_memory_id`) if the path is occupied. Create does **not** overwrite — use `memories.update` to change an existing memory.

## Attach to a session

**Session-create time only** — `sessions.resources.add()` does not accept `memory_store`, and adding/removing one from a running session is not supported.

```ts
const session = await client.beta.sessions.create({
  agent: agent.id,
  environment_id: environment.id,
  resources: [
    {
      type: "memory_store",
      memory_store_id: store.id,
      access: "read_write",
      instructions: "User preferences and project context. Check before starting any task."
    }
  ]
});
```

| Field | Required | Notes |
|---|---|---|
| `type` | Yes | `"memory_store"` |
| `memory_store_id` | Yes | `memstore_...` |
| `access` | No | `"read_write"` (default) or `"read_only"` — enforced at the **filesystem level** on the cloud mount |
| `instructions` | No | Session-specific guidance, ≤ 4,096 chars |

> **`read_write` is the default and it is a prompt-injection surface.** If the agent processes untrusted input (user prompts, fetched web content, third-party tool output), a successful injection could write malicious content into the store, and later sessions read it back as **trusted memory**. Use `read_only` for reference material and any store the agent doesn't need to modify.

## How the agent sees it

Each attached store is mounted at **`/mnt/memory/<store-name>/`**. [live 2026-08-29] The directory name is the store's display name **sanitized to a filesystem-safe slug** (lowercased; non-alphanumeric runs become a single hyphen), so "Demo Memory" mounts at `/mnt/memory/demo-memory/`. **The exact path is returned in the `mount_path` field on the session's memory-store resource — read it from there rather than constructing it yourself.**

- Writes under the mount are persisted back to the store and produce memory versions attributed to the session.
- **Writes to any other path under `/mnt/memory/` fail** — the sandbox mounts that parent directory read-only.
- A short description of each mount (display name, mount path, access mode, store `description`, `instructions`) is automatically added to the system prompt.
- The agent's reads/writes appear in the event stream as ordinary `agent.tool_use` / `agent.tool_result` events.

**Self-hosted sandboxes: a synced local copy, not a live mount.** The SDK worker (`EnvironmentWorker` — Python, TypeScript, Go; **the `ant` CLI worker does not mount stores at all**) downloads each attached store to the same path and reconciles it on an interval (**15 seconds by default**, plus once when the session ends). Writes are visible to other sessions only after sync; conflicts resolve in favor of the store; `read_only` is enforced by the worker's `write`/`edit` tools rather than the filesystem (`bash` can still alter the local copy). Not available on self-hosted environments on Claude Platform on AWS.

## Managing memories host-side

### List

Returns `Memory | MemoryPrefix` entries — a `MemoryPrefix` (`type: "memory_prefix"`, just a `path`) is a directory-like node.

- `path_prefix` scopes the list; **must end with `/`** and matches whole path segments (`/notes/` returns `/notes/todo.md` but not `/notes-archive/todo.md`).
- `depth` — omit or pass `0` for the whole subtree, `1` for immediate children only. **Other values return 400.**
- `view="full"` includes `content`; default `"basic"` is metadata only.

```ts
const page = await client.beta.memoryStores.memories.list(store.id, { path_prefix: "/" });
for (const item of page.data) console.log(item.type, item.path);
```

### Read / create / update / delete

```ts
const retrieved = await client.beta.memoryStores.memories.retrieve(mem.id, { memory_store_id: store.id });

const mem = await client.beta.memoryStores.memories.create(store.id, {
  path: "/preferences/formatting.md",
  content: "Always use tabs, not spaces."
});

await client.beta.memoryStores.memories.update(mem.id, {
  memory_store_id: store.id,
  path: "/archive/2026_q1_formatting.md"   // rename; content and path both changeable
});

await client.beta.memoryStores.memories.delete(mem.id, { memory_store_id: store.id });
```

| Operation | Addressed by | Semantics |
|---|---|---|
| `memories.create(store_id, {path, content})` | **Path** | Create at `path`; `409 memory_path_conflict_error` if occupied |
| `memories.update(mem_id, {memory_store_id, path?, content?})` | **`mem_...` ID** | Change `content`, `path` (rename), or both. Renaming onto an occupied path → same 409. |

`retrieve` defaults to `view="full"`; `delete` accepts `expected_content_sha256` for a conditional delete.

### Optimistic concurrency

`memories.update` accepts a `precondition`. The only supported type is `content_sha256`. On mismatch → `409` (`memory_precondition_failed_error`) — re-read and retry.

```ts
await client.beta.memoryStores.memories.update(mem.id, {
  memory_store_id: store.id,
  content: "CORRECTED: Always use 2-space indentation.",
  precondition: { type: "content_sha256", content_sha256: mem.content_sha256 }
});
```

## Audit and rollback — memory versions

| Trigger | `operation` |
|---|---|
| `memories.create` at a new path | `"created"` |
| `memories.update` changing content/path, **or an agent-side write to the mount** | `"modified"` |
| `memories.delete` | `"deleted"` |

Each version records `created_by` — an actor object with `type` in `session_actor` / `api_actor` / `user_actor` — and, after redaction, `redacted_at` + `redacted_by`.

- **Versions belong to the store, not the memory**, and are **not** deleted when the memory is deleted — the audit trail covers deleted memories too (subject to the 30-day retention).
- `memory_versions.list(store.id, {...})` is newest-first, paginated; filter by `memory_id`, `operation`, `session_id`, `api_key_id`, `created_at_gte`/`_lte`. `view="full"` includes `content`.
- **There is no restore endpoint.** To roll back: retrieve the version and write its `content` back with `memories.update` (or `memories.create` if the parent memory was deleted).
- **Redact** scrubs content from a historical version while preserving the audit trail: clears `content`, `content_sha256`, `content_size_bytes`, and `path`. [live 2026-08-29] **A version that is the current head of a live memory cannot be redacted** — write a new version (or delete the memory) first.

```ts
await client.beta.memoryStores.memoryVersions.redact(versionId, { memory_store_id: store.id });
```

## Endpoints

```
POST   /v1/memory_stores
GET    /v1/memory_stores
GET    /v1/memory_stores/{memory_store_id}
POST   /v1/memory_stores/{memory_store_id}
DELETE /v1/memory_stores/{memory_store_id}
POST   /v1/memory_stores/{memory_store_id}/archive
GET    /v1/memory_stores/{memory_store_id}/memories
POST   /v1/memory_stores/{memory_store_id}/memories
GET    /v1/memory_stores/{memory_store_id}/memories/{memory_id}
PATCH  /v1/memory_stores/{memory_store_id}/memories/{memory_id}
DELETE /v1/memory_stores/{memory_store_id}/memories/{memory_id}
GET    /v1/memory_stores/{memory_store_id}/memory_versions
GET    /v1/memory_stores/{memory_store_id}/memory_versions/{version_id}
POST   /v1/memory_stores/{memory_store_id}/memory_versions/{version_id}/redact
```

SDK namespaces: `client.beta.memoryStores.*`, `client.beta.memoryStores.memories.*`, `client.beta.memoryStores.memoryVersions.*` (TypeScript; Python uses `memory_stores` / `memory_versions`).

## Best practices (from the live docs)

- **Use focused stores** — one per user, one for shared domain knowledge, one for project context. Each store has its own 10,000-memory limit.
- **Condense or prune before the store fills up.** Delete stale memories; a "dreaming session" (research preview) can consolidate fragmented content into a **new** output store rather than modifying the original.
- **Attach a new store when a store outgrows its scope** and attach the original `read_only`.
- **Limit write access** — sessions that only read shared reference material don't need `read_write`.
