import type Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import { db, schema } from "@/lib/db";
import { fmpTranscript, fmpTranscriptList } from "@/lib/fmp";

/** Tools for the `earnings-transcripts` skill. Definitions on the agent, impls here. */

type CustomTool = Anthropic.Beta.Agents.BetaManagedAgentsCustomToolParams;

export const LIST_TRANSCRIPTS_TOOL = "list_transcripts";
export const FETCH_TRANSCRIPT_TOOL = "fetch_transcript";
export const POST_ARTIFACT_TOOL = "post_artifact";

// A custom tool result is truncated by the platform somewhere around 100k
// characters (observed: a 385k-char batch lost everything past ~3
// transcripts). One transcript is ~40-60k, so: list once, fetch one at a time.
export const DISTILL_TOOLS: CustomTool[] = [
  {
    type: "custom",
    name: LIST_TRANSCRIPTS_TOOL,
    description:
      "List the quarterly earnings-call transcripts available for a ticker, newest first. Returns JSON `{symbol, transcripts: [{year, quarter, date}]}` — references only, no text. Call once, then use fetch_transcript for each quarter you need.",
    input_schema: {
      type: "object",
      properties: { symbol: { type: "string", description: "Ticker symbol, e.g. NVDA." } },
      required: ["symbol"],
    },
  },
  {
    type: "custom",
    name: FETCH_TRANSCRIPT_TOOL,
    description:
      "Fetch one quarterly earnings-call transcript. Returns JSON `{symbol, year, quarter, date, content}` where content is the full call text (prepared remarks and Q&A, roughly 40-60k characters). Results larger than about 100k characters are truncated, so fetch one quarter per call and at most two calls in parallel. Use the year and quarter exactly as given by list_transcripts (year is the fiscal year).",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker symbol." },
        year: { type: "integer", description: "Fiscal year from list_transcripts." },
        quarter: { type: "integer", description: "Quarter 1-4 from list_transcripts." },
      },
      required: ["symbol", "year", "quarter"],
    },
  },
  {
    type: "custom",
    name: POST_ARTIFACT_TOOL,
    description:
      "Publish the finished explainer to the application. `html` is a complete self-contained HTML document (inline CSS, no scripts, no external resources). `meta` carries small structured facts about it, at minimum `symbol` and the list of `quarters` covered. Call exactly once per distillation; the return value only acknowledges receipt.",
    input_schema: {
      type: "object",
      properties: {
        html: { type: "string", description: "Complete HTML document." },
        meta: { type: "object", description: "Small JSON facts: symbol, quarters covered, etc." },
      },
      required: ["html", "meta"],
    },
  },
];

const get = (input: unknown, key: string): unknown =>
  typeof input === "object" && input !== null ? (input as Record<string, unknown>)[key] : undefined;

export type ToolContext = { runId: string; subjectId: string; toolUseId: string };

export async function runDistillTool(
  ctx: ToolContext,
  name: string,
  input: unknown,
): Promise<{ result: unknown; isError: boolean }> {
  switch (name) {
    case LIST_TRANSCRIPTS_TOOL: {
      const symbol = String(get(input, "symbol") ?? "").toUpperCase();
      if (!symbol) return { isError: true, result: { error: "symbol is required" } };
      const refs = (await fmpTranscriptList(symbol)).map(({ year, quarter, date }) => ({ year, quarter, date }));
      if (refs.length === 0) return { isError: true, result: { error: `no transcripts for ${symbol}` } };
      return { isError: false, result: { symbol, transcripts: refs.slice(0, 40) } };
    }

    case FETCH_TRANSCRIPT_TOOL: {
      const symbol = String(get(input, "symbol") ?? "").toUpperCase();
      const year = Number(get(input, "year"));
      const quarter = Number(get(input, "quarter"));
      if (!symbol || !year || !quarter) return { isError: true, result: { error: "symbol, year, quarter are required" } };
      const t = await fmpTranscript(symbol, year, quarter);
      if (!t) return { isError: true, result: { error: `no transcript for ${symbol} FY${year} Q${quarter}` } };
      return { isError: false, result: t };
    }

    case POST_ARTIFACT_TOOL: {
      const html = get(input, "html");
      if (typeof html !== "string" || html.length < 200)
        return { isError: true, result: { error: "html must be a complete document" } };
      const meta = (get(input, "meta") ?? {}) as Record<string, unknown>;
      // Idempotent on the tool-use id: a redelivered webhook re-inserts nothing.
      await db
        .insert(schema.artifacts)
        .values({
          id: crypto.randomUUID(),
          runId: ctx.runId,
          subjectId: ctx.subjectId,
          kind: "html",
          content: html,
          meta,
          cmaToolUseId: ctx.toolUseId,
        })
        .onConflictDoNothing();
      return { isError: false, result: { ok: true, chars: html.length } };
    }

    default:
      return { isError: true, result: { error: `unknown tool: ${name}` } };
  }
}
