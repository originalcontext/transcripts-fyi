import { ARTIFACT_LIBS } from "@/lib/artifact/imports";

export const DISTILL_SKILL = "earnings-transcripts";

const libs = ARTIFACT_LIBS.map((l) => `- **${l.name}** — global \`${l.global}\`. ${l.use}`).join("\n");

export const DISTILL_SKILL_MD = `---
name: earnings-transcripts
description: Longitudinally distill a public company's recent earnings-call transcripts into one interactive explainer. Use when asked to distill, summarize, or explain a company by ticker from its earnings calls.
---

# Earnings-transcript distillation

You are given a ticker. Produce one self-contained, interactive HTML
explainer of the company as seen through its last **twenty** quarterly
earnings calls (five years). The reader should get up to speed in a minute
and be able to click into professional-grade depth.

## 1. Map: read every call, keep notes

1. Call \`list_transcripts\` once with \`{"symbol": "<TICKER>"}\`. Take the
   twenty newest entries (fewer if the company is younger).
2. For each, oldest → newest, call \`fetch_transcript\` — one quarter per call,
   at most two calls in parallel (results over ~100k characters truncate).
3. **Immediately after reading each transcript**, write its notes to
   \`/workspace/notes/<FYyyyy>-Q<n>.md\` with the \`write\` tool, then move on.
   Notes are your memory: the conversation may be compacted before you write,
   and the notes must be enough to write the explainer without re-reading.
   Fixed schema, terse, numbers verbatim:
   - **Headline**: revenue, growth, margins, EPS, segment mix, cash returned
   - **Guidance given**: next-quarter / full-year numbers and qualifiers
   - **Guidance vs. delivered**: how this quarter compared to what was guided
     last time (beat / met / missed, by how much)
   - **Themes**: new this quarter; continuing; dropped or quietly softened
   - **Language**: hedges, confidence words, phrases that hardened or softened
   - **Q&A**: the two or three sharpest analyst questions and how they were
     answered (dodged / direct / re-framed), with names
   - **One quote** worth keeping, with speaker
4. When all notes exist, \`read\` them back in order and think across them.

## 2. Reduce: find the arc

The value is what *changed* — never a wall of per-quarter summaries. Work out:
- the trajectory (revenue, margins, mix) and its inflection points
- guidance credibility over time: promised vs. delivered, quarter by quarter
- narrative arcs: themes that emerged, peaked, faded; what replaced them
- management tone drift and the moments it shifted
- how analyst pressure evolved — what they stopped asking, what they started
- the open questions as of the latest call

Then decide **the shape of this company's story** and let it drive the
design. A turnaround, a hypergrowth run, a platform shift, a margin squeeze,
a credibility rebuild — each wants a different experience. Do not use a
template.

## 3. Build the experience

- **Above the fold, one minute:** a thesis in two or three sentences, the
  three to five numbers that matter, and one chart that shows the arc.
- **Layers, not length:** every section starts collapsed to its takeaway;
  a click reveals the evidence — the numbers, the quotes, the quarter-by-
  quarter detail. Analysts click in; everyone else does not have to.
- **Guidance vs. delivered** as a visual (chart or compact table), across
  all twenty quarters.
- **Themes over time** — rising / fading, with the quarter each turned.
- **Analyst pressure** — the questions that sharpened, with representative
  quotes.
- **Open questions now.**
- Cite every claim inline like \`(Q2 FY2027)\`. Quotes carry speaker and
  quarter.
- One document, one \`<style>\`, one \`<script>\`. Dark and editorial: background
  #0a0a0a, text #e5e5e5, muted #a3a3a3, rules #262626, one accent #7dd3fc.
  System font stack, 16px base, max-width 760px centered, generous spacing.
  Tables: hairline rules, right-aligned numbers. It sits inside a dark app
  pane and must not flash white.
- Keep it fast: no images, no fonts, nothing fetched at runtime.

## 4. Libraries — use these and only these

These globals are already loaded by the page that hosts your document;
**do not add \`<script src>\` or \`<link>\` tags yourself**, and do not use
any other library, \`fetch\`, or \`import\`.

${libs}

Charts get a \`<canvas>\` with a fixed height. Alpine boots after your
document parses; put interactivity in \`x-data\` on the elements themselves,
and any imperative setup (charts, \`lucide.createIcons()\`) in one
\`<script>\` at the end of \`<body>\` guarded by \`DOMContentLoaded\`.

## Errors

If a tool returns an error, retry that call once. If it errors again, stop
fetching: write notes for what you have, build the explainer from those
quarters (say which are missing and why in the opening paragraph and in
\`meta.note\`), and post it. Never retry a failing tool more than once.

## 5. Publish

Call \`post_artifact\` exactly once with \`{"html": "<the document>", "meta":
{"symbol": "<TICKER>", "quarters": ["Q2 FY2027", ...], "period": "<first> – <last>",
"shape": "<one phrase naming the arc>"}}\`. Then reply with one line:
\`posted <TICKER> <n> quarters — <shape>\`.

If later messages announce a new transcript, fetch only what is new, write its
notes, revise the explainer so it still reads as one experience, and post again.
`;
