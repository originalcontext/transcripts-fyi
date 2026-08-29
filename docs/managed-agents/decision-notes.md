# Decision notes for transcripts.fyi

Opinionated, project-specific. Everything here is grounded in the sources listed in [`README.md` → Source & freshness](./README.md#source--freshness). Where the docs are silent it says so rather than guessing.

**The project:** an agentic longitudinal document explainer. Given a stock ticker, fetch the last N quarterly earnings-call transcripts, analyze each one (**map**), synthesize a cross-quarter explainer (**reduce**), with an open-ended depth loop that re-reads specific quarters.
**The stack:** Next.js 16 / React 19 on Vercel, Neon Postgres, Upstash Redis.

---

## 1. What Managed Agents actually offloads

### 1.1 Long-running work surviving serverless

This is the load-bearing reason to consider it. From the official overview:

> Claude Managed Agents is stateful by design: sessions are long-running, resume cleanly after pauses, and store conversation history, sandbox state, and outputs server-side.

Concretely: a Vercel function creates the session and returns. The agent keeps running on Anthropic's infrastructure. Later — a different invocation, a webhook, a polling route — you reconnect via `sessions.events.stream()` and cover the gap with `sessions.events.list()`. Nothing about your function's lifetime bounds the agent's.

Compare the alternatives, all of which put the loop **in your process**: Messages API + hand-rolled loop, the SDK Tool Runner (`client.beta.messages.tool_runner`), and the Claude Agent SDK. On Vercel, any of those means a map-reduce over ~8 transcripts has to fit inside one function invocation, or you build your own durable job runner (queue + state machine in Neon/Redis + a worker). **Managed Agents is that durable job runner.**

Caveat: **the SSE stream itself has no replay.** Durability lives in the *event history*, not the stream. See §3.1.

### 1.2 Hosted sandbox

`agent_toolset_20260401` gives `bash`, `read`, `write`, `edit`, `glob`, `grep`, `web_fetch`, `web_search` inside a per-session container. For this project that means: fetch/parse transcripts, write per-quarter JSON to disk, grep back across them, and emit the final explainer to `/mnt/session/outputs/` — none of which you have to sandbox yourself. Vercel functions cannot run a persistent scratch filesystem across invocations; the container can.

Two mechanics that matter here specifically:
- **Tool output over 100,000 characters (~25,000 tokens) is automatically written to a file in the sandbox**, and the model gets a truncated preview plus the path. Earnings transcripts routinely exceed this. No configuration required.
- Threads in a multiagent session **share the container filesystem**, so per-quarter JSON written by one worker is readable by the coordinator. That is the map→reduce handoff.

### 1.3 Scheduled deployments replace Vercel Cron for refresh jobs

`POST /v1/deployments` with a cron `expression` + IANA `timezone` fires a session per occurrence. Each attempt writes a **deployment run** record (`drun_`) carrying either `session_id` or a typed `error` — an audit trail Vercel Cron does not give you. `pause` / `unpause` / manual `run` (works while paused) make it operable. **Max 1,000 deployments per org.**

Good fit: a nightly/weekly "check for new transcripts for tracked tickers" job.

### 1.4 Session budgets are a real spend cap

This is the single most useful control for a consumer-facing "analyze this ticker" button.

```json
{ "type": "limit", "max_list_cost": { "amount": "2500", "currency": "USD" } }
```

- Hard, platform-enforced, **pre-request gate**. The session **pauses** (`stop_reason: budget_reached`) rather than terminating — history and sandbox preserved.
- Priced at **public list rates**: model tokens at each served model's list price, **web searches at $10 per 1,000**, **session running time at $0.08/hour**.
- Deployments carry the same object; the cap is **copied onto each fired session**, bounding each run separately.

You would otherwise build this yourself out of token accounting and a kill switch, and you would not get a pre-request gate.

### 1.5 Multiagent = the map-reduce, with no orchestration code

See [`multiagent.md` → Mapping onto map-reduce](./multiagent.md#mapping-onto-map-reduce-over-many-documents) for the full mapping. The shape the docs literally describe:

> a fast document extractor (for example on Claude Haiku 4.5) that writes one JSON file per input document, a verifier that checks each file against its source, and a lead that applies the corrections and writes the final table to `/mnt/session/outputs/`.

Two properties earn their keep here:
- **Context isolation.** Each quarter is read in its own thread with a fresh context window; only the worker's short report returns to the coordinator. A single-threaded read of 8 full transcripts would hit compaction and lose fidelity.
- **Persistent threads.** The depth loop ("re-read Q3, focus on the segment margin commentary") can `send_to_agent` a follow-up to the thread that **already read Q3** — it retains its prior turns, so no re-read cost.
- **Cost mix.** Workers are billed at their own model's rates. Reading is cheap on Haiku 4.5; the Opus coordinator only pays for planning and synthesis.

### 1.6 Webhooks instead of holding a connection open

`session.status_idled` / `session.status_terminated` webhooks, HMAC-verified with `client.beta.webhooks.unwrap()`, let a Next.js Route Handler react to completion without a long-lived function. On serverless this is a better default than polling. But see §3.2 — webhooks are lossy and unordered.

### 1.7 Outcomes give you a quality gate for free

`user.define_outcome` + a rubric runs an iterate→grade→revise loop with an **independent grader context**, up to `max_iterations` (default 3, max 20). If "a good cross-quarter explainer" can be written as checkable criteria ("names every quarter covered", "every claim carries a quarter + speaker attribution", "flags every metric whose definition changed"), the harness does the revision loop. You'd otherwise build an LLM-judge loop yourself.

### 1.8 Secrets never enter the sandbox

If transcripts come from a paid API, a vault **`environment_variable`** credential puts an **opaque placeholder** in the sandbox and substitutes the real key **at egress**, scoped by `networking.allowed_hosts`. Prompt injection in a transcript cannot exfiltrate a key the sandbox never held. Restrict to `injection_location: {header: true}` unless the provider needs a body secret.

---

## 2. What you still have to build

| Concern | Why it isn't covered |
|---|---|
| **Getting transcripts in** | Either the agent fetches them (`web_fetch`, domain-restricted) or you fetch host-side and mount as `file` resources. Both are your code. Mounted files are **read-only**, max **999 per session**. |
| **Ticker → session mapping** | Nothing in Managed Agents indexes by ticker. You need Neon rows keyed to `session.id`. Session `metadata` holds **max 8 keys** — enough for `{ticker, run_id}`, not for a payload. |
| **Idempotency / "already analyzed Q3 2025"** | Deployment runs record *trigger attempts*, not business-level dedup. Yours. |
| **Streaming to the browser** | Managed Agents streams to **your server**. Proxying SSE (or live previews) to a React client, plus browser-side reconnect, is yours. |
| **Reconnect bookkeeping on stateless functions** | The `seen event ids` set for the dedupe-on-reconnect pattern has to live somewhere across invocations — this is a natural Upstash Redis job. |
| **Citations / source links** | **`citations` is not available on the Managed Agents web tools** (unlike the Messages API server tools). If you want linkable citations, instruct the worker agents to report a source URL or file path for every claim, and parse that — as the bundled worker prompt does. |
| **Cost accounting** | `usage.list_cost` is **list price**, not your contracted price. Real billing reconciliation is yours. |
| **Auth, per-user isolation, quotas** | Entirely yours. Vaults are workspace-scoped, not user-scoped, unless you create one per user. |
| **Deterministic fan-out** | The **coordinator decides** how many subagents to spawn, from its system prompt. If you need exactly-one-thread-per-quarter guaranteed, run separate sessions and orchestrate them yourself. |
| **Retry policy for your own API calls** | The SDK retries 429s using `retry-after`; everything above that is yours. |

---

## 3. Pitfalls that bite *this* architecture

### 3.1 SSE has no replay — and can deadlock

**The single biggest serverless trap.** If a function holding the stream is killed, events emitted in the gap are gone *from the stream*. Worse:

> if the stream drops while an `agent.tool_use`, `agent.mcp_tool_use`, or `agent.custom_tool_use` is pending resolution, the session **deadlocks** (client disconnects → session idles → reconnect happens → no client resolution happens).

Mitigations, in order of preference for this project:
1. **Avoid `always_ask` permission policies and custom tools on any unattended path.** Both make the session block on *your* client. On serverless that's a liveness dependency you don't want. Prefer `always_allow` + a domain allowlist + a session budget as the safety envelope.
2. Always run the consolidation pattern on (re)connect: open the stream, then `events.list()`, dedupe by event id, then tail. **And do not `continue` past the terminal checks for deduped events** — a terminal event that was already in the history response would otherwise never break the loop.
3. Prefer **webhooks + `events.list()`** over holding a stream at all, for the unattended cron path.

### 3.2 Webhooks are lossy and unordered

Three delivery attempts, jittered 5–120s backoff; **after the last attempt the event is dropped, not queued, with no signal.** No ordering guarantee. Auto-disable on a single `3xx` (Next.js redirects — including a trailing-slash redirect — will disable your endpoint on the first attempt). An event emitted while nothing was subscribed is **never** delivered and subscribing later does not backfill. Endpoint registration is **Console-only; there is no management API yet.**

⇒ Treat webhooks as a *latency optimization on top of* reconciliation, never as the system of record. Drive state from the resource you fetch.

### 3.3 `agents.create()` in the request path

Trivial to do by accident at the module scope of a Route Handler. It accumulates orphaned agents, pays create latency per invocation, defeats versioning, and eats the **300 create-requests-per-minute** org limit. Create the agent from version-controlled YAML via `ant beta:agents create` in CI, store the ID in an env var.

### 3.4 Output artifacts have an indexing lag

**~1–3 s** between `session.status_idle` and outputs appearing in `files.list`. A function that breaks on idle and immediately lists will get an empty array. Retry once or twice. Also: `scope_id` requires **both** beta headers and `@anthropic-ai/sdk >= 0.88.0`, and the **uploaded `file_id` ≠ the mounted resource's `file_id`**.

### 3.5 The web tools will surprise you on transcript sources

- **`max_content_tokens` caps fetched *text* only — binary content such as PDFs is not capped.** Earnings transcripts are very often PDFs. Your context-blowup guard does not apply to exactly the case you care about most.
- **`web_search` silently omits** results outside its allowlist — a too-tight list looks like "nothing found", not an error. `web_fetch` at least errors with `url_not_allowed`.
- **`web_fetch` domains cannot carry a path.** You cannot scope to `example.com/transcripts` — it's the whole host or nothing.
- **64 domains max per list**, and a listed domain covers its subdomains but not its parent (`www.example.com` does **not** cover `example.com`).
- **The environment's `networking` policy does not govern the web tools** — they run on Anthropic's servers in both cloud and self-hosted environments. Locking down `allowed_hosts` does nothing to `web_fetch`.
- The session **re-checks the web config when it first initializes the tool**; a setting that has since become invalid produces `session.error` and an idle **with no retry**.
- **In multiagent sessions allow-lists intersect and block-lists union.** A worker with an allow-list disjoint from the coordinator's keeps the tool but every call fails `url_not_allowed`. Keep worker lists inside the coordinator's.

### 3.6 Budget mechanics that will trip you

- **Create-only.** You cannot add a budget to a running session (400). Decide at create time — for a consumer app, always set one.
- **Removal is one-way.** A removed budget can never be re-added. To keep a cap, *change* it, never remove it.
- **`amount` is an integer string in cents.** `2500` (number) and `"25.00"` are both rejected. `USD` only.
- **Overshoot is per running thread.** "The final figure can exceed the cap by at most one model request per running thread." A 10-thread fan-out can overshoot by up to 10 model requests. **Multiagent amplifies overshoot** — size the cap accordingly.
- **Raising the cap must exceed the *consumed* cost, not the old cap** — and the reported `usage.list_cost` is rounded, so add a cent or more of margin.
- **A pending tool ask outranks the cap** at session level: one thread on `requires_action` + one on `budget_reached` reports `requires_action`.
- Session **running time is billed into the cap at $0.08/hour** based on `active_seconds` (time with ≥1 thread running; concurrent-thread overlap counted **once**). A wide fan-out is cheaper on wall-clock cost than a long serial run.
- **Web search costs $10 per 1,000 requests** against the cap. A research-heavy prompt burns budget on search, not just tokens.
- **A model with no public list price cannot be budgeted** — a budgeted create referencing one is a 400.

### 3.7 The idle/terminated break gate

Sessions go idle **transiently** — between parallel tool executions and while awaiting client input. Breaking on `session.status_idle` alone truncates the run. The correct gate:

```ts
if (event.type === 'session.status_terminated') break
if (event.type === 'session.status_idle') {
  if (event.stop_reason.type === 'requires_action') continue
  break // end_turn | retries_exhausted | budget_reached
}
```

And **an interrupted turn reports `stop_reason: end_turn`, identical to natural completion** — there is no interruption-specific stop reason. Track interrupts yourself.

### 3.8 The post-idle status-write race

The stream emits `session.status_idle` **before** the queryable status reflects it. Breaking on idle and immediately calling `archive()`/`delete()` intermittently 400s with "cannot delete/archive while running". Poll `sessions.retrieve()` until `status !== 'running'` first.

### 3.9 Prompt injection through the transcripts themselves

Earnings transcripts are third-party text of arbitrary provenance, and the agent has `bash` and `web_fetch`. Three specific amplifiers:
- **Memory stores default to `read_write`.** The docs are explicit: a successful injection could write malicious content into the store, and later sessions read it back **as trusted memory**. Use `read_only` for anything the agent doesn't need to write.
- **Repository skills load with no review step.** If you ever mount a repo, anyone who can commit to `.claude/skills/` is writing agent instructions.
- **Vaults are the correct mitigation for secrets** — they are never in the sandbox — but they do not mitigate *behavioral* injection.

### 3.10 Cron scheduling gotchas

- **Jitter of up to 15% of the interval, floored at 5 s and capped at 9 minutes.** Don't chain a downstream deadline to `upcoming_runs_at`.
- **DST:** wall-clock times that don't exist on spring-forward are **skipped**; times occurring twice on fall-back **fire twice**. Schedule outside 1–3 AM local, or use UTC.
- **Archiving the agent auto-archives the deployment — terminally, with no run recorded.** A CI cleanup job that archives agents will silently and permanently kill your schedules. [live 2026-08-29] Archiving a *subagent*, environment, or vault instead records a failed run and **auto-pauses** the deployment (recoverable).
- **Rate-limited firings are recorded and not retried** — the schedule just tries again next occurrence.
- **Unpause does not backfill** missed triggers.

### 3.11 Lifecycle irreversibility

**Archive is permanent on agents, environments, memory stores, vaults, credentials, and sessions** — read-only, no unarchive, and for agents/environments/memory stores, unreferenceable by new sessions. Agents and session threads have **no delete at all**. Do not wire archive into automated cleanup.

### 3.12 Update semantics that surprise

- `POST /v1/agents/{id}` **with** `version` returns 409 **even when the fields you send already equal the stored values**. A CI apply loop should **omit** `version`.
- Array fields (`tools`, `mcp_servers`, `skills`) are **replaced wholesale**, never merged — including on a mid-session `sessions.update()`. To add one tool you must GET, modify, POST back.
- **`vault_ids` is create-only** and rejected on update.
- Supplying `model` on an agent update **without** `inference_geo` **clears the pin**.
- A per-session `model` override **drops the agent's `effort`** — the session runs at the model's default effort. [live 2026-08-29]

### 3.13 Rate limits under bursty consumer traffic

**300 create requests/minute org-wide** covers agents + sessions + environments together. A traffic spike of "analyze this ticker" clicks contends with itself. Environments are additionally limited (bundled figure: **60 RPM, max 5 concurrent**) — another reason to create one environment in setup and reuse it forever. Model inference inside sessions draws from your **standard org ITPM/OTPM limits**, which the session count multiplies.

---

## 4. Hard limits, quotas, and availability

| Limit | Value |
|---|---|
| `tools` per agent | 128 |
| `mcp_servers` per agent | 20 (unique names) |
| `skills` per agent | 20 (prebuilt + custom combined) |
| `system` prompt | 100,000 chars |
| Agent `metadata` | 16 pairs, keys ≤64, values ≤512 |
| Session `metadata` | **8 keys** |
| `initial_events` | 50 events; ≤100 file-sourced `document` blocks; body ≤ **32 MB** (413 above) |
| File resources per session | **999** (read-only mounts) |
| Memory stores per session | **8** |
| Memories per store | **10,000** [live] |
| Memory size | 100 kB (~25k tokens) each |
| Memory version retention | **30 days** [live] |
| Multiagent roster | **1–20** unique agents; **one level of delegation** (enforced) |
| Concurrent threads per session | **25** (advisor threads exempt) |
| Credentials per vault | 20 |
| Scheduled deployments per org | **1,000** |
| Outcome `max_iterations` | default 3, max **20** |
| Tool output auto-offload threshold | 100,000 characters |
| Web domain lists | 1–64 domains, 1–255 chars each |
| Rate limits | create 300 RPM; read 1,200 RPM [live]. Environments (bundled): 60 RPM, 5 concurrent. |
| Budget currency | **USD only** |

### Platform availability

**Managed Agents does not exist on Amazon Bedrock, Google Cloud Vertex AI, or Microsoft Foundry** — first-party Claude API and Claude Platform on AWS only, both in beta. If this project ever needs to run through a cloud marketplace, Managed Agents is not portable and the fallback is the Messages API + your own loop.

On Claude Platform on AWS there are further differences: sessions on self-hosted environments **cannot attach memory stores**, and the `ant` CLI **has no SigV4 mode** (use the SDK for setup).

### Data retention — the compliance blocker

> **Managed Agents is not currently eligible for Zero Data Retention (ZDR) or HIPAA Business Associate Agreement (BAA) coverage.** [live 2026-08-29]

Because sessions store conversation history, sandbox state, and outputs server-side. You *can* delete sessions and uploaded files at any time through the API, but you cannot run under ZDR. For public earnings transcripts this is likely fine; it becomes a blocker the moment a user uploads their own confidential document into the same pipeline. **Decide this before building an upload path.**

`inference_geo` (`"us"` / `"global"`) pins where **model inference** is served. It is nested inside `model`, validated on every turn, and a narrowed workspace allowlist makes **running sessions refuse further turns**. It says nothing about where session state is stored — storage residency is **not covered in the source docs**.

### Beta status

Managed Agents is in beta and **enabled by default for all API accounts**. "Behaviors may be refined between releases to improve outputs." **MCP tunnels** and **dreaming** are a more limited research preview requiring an access request.

### Branding (if this ships publicly)

Allowed: "Claude Agent", "Claude" (inside a menu already labeled "Agents"), "{YourAgentName} Powered by Claude". **Not permitted:** "Claude Code" / "Claude Code Agent", "Claude Cowork", or Claude Code-branded ASCII art / visual elements that mimic Claude Code.

---

## 5. Not covered in the source docs

Things this project will need to determine empirically or by asking Anthropic:

- **Maximum session wall-clock duration**, and whether a cloud sandbox is evicted after some idle period. (The `--max-idle` default of `60s` documented for the *self-hosted* `ant beta:worker` is a worker-side setting, not a cloud sandbox lifetime.)
- **Container CPU / memory / disk sizing**, and whether any of it is configurable.
- **Whether the sandbox filesystem survives archiving** a session (only `delete` is documented as removing "session, event history, container, and checkpoints").
- **Any concurrent-session cap per organization.** Only environments have a documented concurrency figure.
- **Where session state is stored geographically**, and any storage-residency controls beyond `inference_geo`.
- **The `purpose` enum on `files.upload`** — the bundled docs show both `"agent"` and `"agent_resource"` in different examples.
- **The `deny_message` vs `message` field name on `user.tool_confirmation`** — the client-patterns doc uses `deny_message`, the tools doc's raw JSON uses `message`.
- **Whether the $0.08/hour running-time figure is also the billed price** or only the list-cost figure used for budget enforcement.
- **SLA / availability targets** for sessions or deployments.
- Anything about Vercel, Neon, or Upstash integration — obviously out of scope for Anthropic's docs.

---

## 6. If we adopt it — the shape I'd build

Grounded in the patterns above; the specific composition is a recommendation, the constraints it respects are all sourced.

**Control plane (CI, once):**
- `env.yaml` → one cloud environment, `networking: {type: "unrestricted"}` unless there's a reason to lock it down (remember it doesn't restrict the web tools anyway).
- `extractor.agent.yaml` → cheap model, read-only toolset (`read`, `glob`, `grep`, `web_fetch`), `web_fetch.allowed_domains` pinned to the transcript sources.
- `lead.agent.yaml` → strong model, full toolset, `multiagent: {type: "coordinator", agents: [<extractor id>, {"type": "self"}]}`.
- Applied with `ant beta:agents create|update`; IDs into env vars. Omit `version` on update in CI.

**Data plane (per run):**
1. Route Handler creates **one session** per (ticker, run) with a `budget`, `metadata: {ticker, run_id}`, and `initial_events` carrying the task + explicit input/output paths. Persist `session.id` in Neon.
2. Return immediately. Do **not** hold the stream in the request.
3. A webhook Route Handler on `session.status_idled` / `session.status_terminated` (raw body → `webhooks.unwrap`, dedupe on `event.id`) marks the run and triggers collection.
4. Collection: `sessions.events.list()` for the transcript of record, then `files.list({scope_id, betas:[...]})` with a retry for the ~1–3 s indexing lag.
5. A reconciliation cron (`sessions.list()` filtered by your Neon rows) catches anything the lossy webhooks dropped.
6. Live UI: a separate SSE proxy route that opens the stream + `events.list()`, dedupes via a Redis-backed seen-set, and streams to the browser. Opt into `event_deltas: ["agent.message"]` if you want token-level rendering — remembering previews are best-effort and the buffered `agent.message` is authoritative.

**Deliberately not used at first:** custom tools and `always_ask` policies (liveness dependency on a serverless client, §3.1); memory stores (`read_write` injection surface, §3.9 — revisit with `read_only` reference stores); MCP (nothing here needs it yet).
