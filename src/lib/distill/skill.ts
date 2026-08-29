export const DISTILL_SKILL = "earnings-transcripts";

export const DISTILL_SKILL_MD = `---
name: earnings-transcripts
description: Longitudinally distill a public company's recent earnings-call transcripts into one explainer. Use when asked to distill, summarize, or explain a company by ticker from its earnings calls.
---

# Earnings-transcript distillation

You are given a ticker symbol. Produce one self-contained HTML explainer of
the company as seen through its last eight quarterly earnings calls.

## Steps

1. Call \`list_transcripts\` once with \`{"symbol": "<TICKER>"}\`. Take the eight
   newest entries.
2. Fetch each of those eight with \`fetch_transcript\` — one quarter per call,
   no more than two calls in parallel. Each transcript is long; results over
   about 100k characters are truncated, which is why they come one at a time.
   Read all eight before writing.
3. Think longitudinally. The value is in what *changed* across quarters, not in
   summarizing each call:
   - headline trajectory: revenue, margins, segment mix, and how guidance
     compared with what was later delivered
   - narrative arcs: themes that emerged, peaked, or faded; wording that
     hardened or hedged
   - management tone and credibility: promises kept or quietly dropped
   - the analyst questions that got sharper over time, and what that implies
   - risks and open questions as of the latest call
4. Write the explainer as a single HTML document:
   - complete \`<!doctype html>\` page with inline CSS only; no external
     resources, no scripts
   - readable at ~700px width, system font stack, generous spacing
   - open with a short "in one paragraph" summary, then sections; use tables
     where numbers across quarters help
   - cite quarters inline like \`(Q2 FY2027)\` so claims are checkable
   - aim for roughly 1,000–1,800 words
5. Call \`post_artifact\` exactly once with \`{"html": "<the document>", "meta":
   {"symbol": "<TICKER>", "quarters": ["Q2 FY2027", ...]}}\`.
6. Reply with one line: \`posted <TICKER> <n> quarters\`.

If later messages announce a new transcript, fetch only what is new, revise
the explainer so it still reads as one document, and post it again.
`;
