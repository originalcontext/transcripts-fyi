# TypeScript examples

Runnable snippets for `@anthropic-ai/sdk`. Requires **>= 0.88.0** for `scope_id` on `files.list`.

> **Bindings not shown here:** if you need a class, method, namespace, field, or behavior that isn't shown, fetch the TypeScript SDK repo or the relevant docs page rather than guessing. Do not extrapolate from cURL shapes or another language's SDK.

## Install and client

```bash
npm install @anthropic-ai/sdk
```

```typescript
import Anthropic from "@anthropic-ai/sdk";

// Default - resolves credentials from the environment:
// ANTHROPIC_API_KEY, or ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile.
const client = new Anthropic();

// Explicit API key (only when you must inject a specific key)
// const client = new Anthropic({ apiKey: "your-api-key" });
```

## 1. Create an environment (setup, once)

```typescript
const environment = await client.beta.environments.create({
  name: "my-dev-env",
  config: {
    type: "cloud",
    networking: { type: "unrestricted" },
  },
});
console.log(environment.id); // env_...
```

## 2. Create an agent (setup, once)

> **There is no inline agent config.** `model`/`system`/`tools` live on the agent object, not the session. Always start with `agents.create()` — the session takes a pointer only. In production this belongs in a setup script or version-controlled YAML applied with `ant`, not in the request path.

```typescript
const agent = await client.beta.agents.create({
  name: "Coding Assistant",
  model: "claude-opus-5",
  system: "You are a helpful coding agent.",
  tools: [{ type: "agent_toolset_20260401", default_config: { enabled: true } }],
});

// Persist BOTH of these.
console.log(agent.id, agent.version);
```

With a custom tool and per-tool config:

```typescript
const agent = await client.beta.agents.create({
  name: "Code Reviewer",
  model: "claude-opus-5",
  system: "You are a senior code reviewer.",
  tools: [
    {
      type: "agent_toolset_20260401",
      default_config: { enabled: true },
      configs: [
        { name: "bash", permission_policy: { type: "always_ask" } },
        {
          name: "web_fetch",
          allowed_domains: ["docs.example.com"],
          max_content_tokens: 50_000,
        },
      ],
    },
    {
      type: "custom",
      name: "run_tests",
      description:
        "Run the project's test suite for a given path and return pass/fail plus failing test output. Use this after editing source files; do not use it to run arbitrary shell commands.",
      input_schema: {
        type: "object",
        properties: {
          test_path: { type: "string", description: "Path to test file" },
        },
        required: ["test_path"],
      },
    },
  ],
});
```

## 3. Create a session (every run)

```typescript
const session = await client.beta.sessions.create({
  agent: { type: "agent", id: agent.id, version: agent.version }, // or just agent.id for latest
  environment_id: environment.id,
  title: "Code review session",
});

console.log(session.id, session.status);
// swap 'default' for your workspace ID if the API key is not in the Default workspace
console.log(`Trace: https://platform.claude.com/workspaces/default/sessions/${session.id}`);
```

Create + kick off in one call, with a spend cap:

```typescript
const session = await client.beta.sessions.create({
  agent: agent.id,
  environment_id: environment.id,
  budget: { type: "limit", max_list_cost: { amount: "2500", currency: "USD" } }, // $25.00
  initial_events: [
    {
      type: "user.message",
      content: [{ type: "text", text: "Review the auth module." }],
    },
  ],
});
// NOTE: with a non-empty initial_events the session is created directly in `running`.
// It never passes through `idle` first, and initial_events are NOT echoed on this response.
```

With a mounted file and a vault:

```typescript
import fs from "fs";

const file = await client.beta.files.upload({
  file: fs.createReadStream("data.csv"),
  purpose: "agent",
});

const session = await client.beta.sessions.create({
  agent: agent.id,
  environment_id: environment.id,
  vault_ids: [vault.id], // create-only; cannot be set via update
  resources: [
    { type: "file", file_id: file.id, mount_path: "/workspace/data.csv" },
  ],
});
```

## 4. Send a message

```typescript
await client.beta.sessions.events.send(session.id, {
  events: [
    { type: "user.message", content: [{ type: "text", text: "Review the auth module" }] },
  ],
});
```

## 5. Stream events (stream-first)

```typescript
// Open the stream BEFORE sending the kickoff.
const stream = await client.beta.sessions.events.stream(session.id);

await client.beta.sessions.events.send(session.id, {
  events: [{ type: "user.message", content: [{ type: "text", text: "..." }] }],
});

for await (const event of stream) {
  switch (event.type) {
    case "agent.message":
      for (const block of event.content) {
        if (block.type === "text") process.stdout.write(block.text);
      }
      break;
    case "agent.custom_tool_use":
      console.log(`\nCustom tool call: ${event.name}`, event.input);
      break;
    case "span.model_request_end":
      console.log("\nusage:", event.model_usage);
      break;
    case "session.status_idle":
      console.log("\n--- Agent idle ---", event.stop_reason);
      break;
    case "session.status_terminated":
      console.log("\n--- Session terminated ---");
      break;
  }
}
```

With live previews:

```typescript
const stream = await client.beta.sessions.events.stream(session.id, {
  event_deltas: ["agent.message"],
});
// event_start / event_delta are previews only; the buffered agent.message is authoritative.
```

## 6. Lossless reconnect + correct break gate

```typescript
async function drain(client: Anthropic, sessionId: string) {
  const seen = new Set<string>();
  const stream = await client.beta.sessions.events.stream(sessionId);

  // Stream is open and buffering server-side. Read history first to cover the gap.
  for await (const event of client.beta.sessions.events.list(sessionId)) {
    seen.add(event.id);
    handle(event);
  }

  for await (const event of stream) {
    if (!seen.has(event.id)) {
      seen.add(event.id);
      handle(event);
    }
    // Terminal checks must run even for already-seen events.
    if (event.type === "session.status_terminated") break;
    if (event.type === "session.status_idle") {
      if (event.stop_reason.type === "requires_action") continue;
      break; // end_turn | retries_exhausted | budget_reached
    }
  }
}
```

## 7. Handle tool results (custom tools)

```typescript
function runCustomTool(toolName: string, toolInput: unknown): string {
  if (toolName === "run_tests") {
    // Your tool implementation here
    return "All tests passed.";
  }
  return `Unknown tool: ${toolName}`;
}

async function runSession(client: Anthropic, sessionId: string) {
  while (true) {
    const stream = await client.beta.sessions.events.stream(sessionId);

    const toolCalls: Anthropic.Beta.Sessions.BetaManagedAgentsAgentCustomToolUseEvent[] = [];

    for await (const event of stream) {
      if (event.type === "agent.message") {
        for (const block of event.content) {
          if (block.type === "text") process.stdout.write(block.text);
        }
      } else if (event.type === "agent.custom_tool_use") {
        toolCalls.push(event);
      } else if (event.type === "session.status_idle") {
        break;
      } else if (event.type === "session.status_terminated") {
        return;
      }
    }

    if (toolCalls.length === 0) break;

    const results = toolCalls.map((call) => ({
      type: "user.custom_tool_result" as const,
      custom_tool_use_id: call.id,
      content: [{ type: "text" as const, text: runCustomTool(call.name, call.input) }],
    }));

    await client.beta.sessions.events.send(sessionId, { events: results });
  }
}
```

## 8. Handle tool confirmations (`always_ask`)

```typescript
for await (const event of stream) {
  if (event.type === "agent.tool_use" && event.evaluated_permission === "ask") {
    await client.beta.sessions.events.send(session.id, {
      events: [
        {
          type: "user.tool_confirmation",
          tool_use_id: event.id,   // the EVENT id (sevt_...), not a toolu_ id
          result: "allow",         // or 'deny'
          // deny_message: 'Read .env.example instead',
          // In multiagent sessions, echo the originating thread:
          // session_thread_id: event.session_thread_id,
        },
      ],
    });
  }
}
```

## 9. Interrupt

```typescript
await client.beta.sessions.events.send(session.id, {
  events: [{ type: "user.interrupt" }],
});

// Drain to a true stop. NOTE: the interrupted turn reports stop_reason `end_turn`,
// identical to natural completion - track that you sent the interrupt yourself.
for await (const event of stream) {
  if (event.type === "session.status_terminated") break;
  if (
    event.type === "session.status_idle" &&
    event.stop_reason.type !== "requires_action"
  ) break;
}

// Multiagent: omitting session_thread_id interrupts EVERY thread including the primary.
// await client.beta.sessions.events.send(session.id, {
//   events: [{ type: "user.interrupt", session_thread_id: threadId }],
// });
```

## 10. Resume a session paused at its budget

```typescript
const s = await client.beta.sessions.retrieve(session.id);
// Base the new cap on consumed cost, not on the old max_list_cost, and add margin
// (the reported figure is rounded to the nearest cent).
const consumed = Number(s.usage.list_cost.amount);

await client.beta.sessions.update(session.id, {
  budget: { type: "limit", max_list_cost: { amount: String(consumed + 500), currency: "USD" } },
});
// The paused work resumes automatically. `budget: null` removes the cap - one-way, never re-addable.
```

## 11. List and download session outputs

```typescript
import fs from "fs";

// ~1-3s indexing lag after session.status_idle; retry once or twice if empty.
const files = await client.beta.files.list({
  scope_id: session.id,
  betas: ["managed-agents-2026-04-01"], // required alongside the SDK's Files header
});

for (const f of files.data) {
  console.log(f.filename, f.size_bytes);
  const resp = await client.beta.files.download(f.id);
  fs.writeFileSync(f.filename, Buffer.from(await resp.arrayBuffer()));
}
```

## 12. Multiagent coordinator

```typescript
const coordinator = await client.beta.agents.create({
  name: "Engineering Lead",
  model: "claude-opus-5",
  system:
    "You coordinate engineering work. Delegate code review to the reviewer agent and test writing to the test agent.",
  tools: [{ type: "agent_toolset_20260401" }],
  multiagent: {
    type: "coordinator",
    agents: [
      { type: "agent", id: reviewerAgent.id },
      { type: "agent", id: testWriterAgent.id },
      { type: "self" },
    ],
  },
});

// Nothing changes on sessions.create() - the roster is resolved from the coordinator's config.
const session = await client.beta.sessions.create({
  agent: coordinator.id,
  environment_id: environment.id,
});

// Drill into a subagent thread:
const threads = await client.beta.sessions.threads.list(session.id);
const childStream = await client.beta.sessions.threads.events.stream(threads.data[1].id, {
  session_id: session.id,
});
```

## 13. Session management and safe cleanup

```typescript
const s = await client.beta.sessions.retrieve("sesn_011CZxAbc123Def456");
console.log(s.status, s.usage);

const sessions = await client.beta.sessions.list();

// Post-idle status-write race: the stream emits status_idle slightly before the
// queryable status reflects it. Poll before archiving or deleting.
let cur;
for (let i = 0; i < 10; i++) {
  cur = await client.beta.sessions.retrieve(session.id);
  if (cur.status !== "running") break;
  await new Promise((r) => setTimeout(r, 200));
}
if (cur?.status !== "running") {
  await client.beta.sessions.archive(session.id);
}
```

## 14. Update tools mid-session

```typescript
// Session must be idle. Arrays are FULL replacements, not merges.
await client.beta.sessions.update(session.id, {
  agent: {
    tools: [
      { type: "agent_toolset_20260401" },
      { type: "mcp_toolset", mcp_server_name: "linear" },
    ],
    mcp_servers: [{ type: "url", name: "linear", url: "https://mcp.linear.app/sse" }],
  },
});
```

## 15. Webhook handler (Next.js Route Handler shape)

```typescript
// app/api/anthropic-webhook/route.ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_WEBHOOK_SIGNING_KEY from env

export async function POST(request: Request) {
  // MUST be the raw body - re-serializing JSON breaks the MAC.
  const body = await request.text();
  const headers = Object.fromEntries(request.headers.entries());

  let event;
  try {
    event = client.beta.webhooks.unwrap(body, { headers });
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  // Dedupe on event.id - it is per-event, not per-delivery, and retries reuse it.
  if (await alreadySeen(event.id)) return new Response(null, { status: 204 });
  await markSeen(event.id);

  if (event.data.type === "session.status_idled") {
    // Thin payload: fetch the resource for real state.
    const session = await client.beta.sessions.retrieve(event.data.id);
    await onSessionIdle(session);
  }

  return new Response(null, { status: 204 });
}
```
