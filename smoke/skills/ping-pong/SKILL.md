---
name: ping-pong
description: Protocol for answering a "ping" message. Use whenever a user message consists of the word "ping" followed by a nonce token.
---

# Ping-pong protocol

A ping message looks like `ping <nonce>` — for example `ping 7f3a9c`.

1. Take the nonce verbatim from the message. Do not alter, trim, or re-case it.
2. Call the `pong` tool exactly once with `{"nonce": "<nonce>"}`.
3. The tool returns JSON with `reply`, `nonce`, `handled_by`, and `handled_at`.
4. Reply to the user with exactly one line and nothing else:

   `pong <nonce> via <handled_by>`

   where `<nonce>` and `<handled_by>` come from the tool result.

Do not use bash, write files, or call any other tool. If the tool returns an
error, reply with `pong failed: <error text>` on one line.
