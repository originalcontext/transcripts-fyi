import type Anthropic from "@anthropic-ai/sdk";
import { deployTarget } from "@/lib/anthropic";
import { fmpLatestTranscript } from "@/lib/fmp";

/**
 * Custom tools the smoke agent can call. Definitions go on the agent;
 * implementations run here, host-side, when the webhook hands us the call.
 * Secrets (FMP key) never leave this process.
 */

type CustomTool = Anthropic.Beta.Agents.BetaManagedAgentsCustomToolParams;

export const PONG_TOOL = "pong";
export const FETCH_TRANSCRIPT_TOOL = "fetch_transcript";
export const RENDER_SUMMARY_TOOL = "render_summary";

export const SMOKE_TOOLS: CustomTool[] = [
  {
    type: "custom",
    name: PONG_TOOL,
    description:
      "Echo service for the ping-pong protocol. Call it exactly once when the user sends `ping <nonce>`, passing the nonce verbatim. It returns JSON containing `reply`, the same `nonce`, and `handled_by` (which deployment answered). It has no other purpose and must not be called otherwise.",
    input_schema: {
      type: "object",
      properties: {
        nonce: { type: "string", description: "The nonce token from the ping message, verbatim." },
      },
      required: ["nonce"],
    },
  },
  {
    type: "custom",
    name: FETCH_TRANSCRIPT_TOOL,
    description:
      "Fetch the most recent quarterly earnings-call transcript for a public company by ticker symbol. Returns JSON with `symbol`, `year`, `quarter`, `date`, and the full `content` text of the call (prepared remarks and Q&A). Call it once per company; the content is long, so read it once and do not re-fetch. Returns `error` if no transcript exists.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker symbol, e.g. NVDA." },
      },
      required: ["symbol"],
    },
  },
  {
    type: "custom",
    name: RENDER_SUMMARY_TOOL,
    description:
      "Hand a finished earnings-call summary back to the application for display. Call it exactly once, after you have read the transcript and written the summary. `summary` is markdown. The application stores it; the return value only acknowledges receipt.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker symbol the summary is for." },
        period: { type: "string", description: "Fiscal period label from the transcript, e.g. Q2 FY2027." },
        summary: { type: "string", description: "The summary, in markdown." },
      },
      required: ["symbol", "period", "summary"],
    },
  },
];

const str = (input: unknown, key: string) =>
  typeof input === "object" && input !== null && key in input
    ? String((input as Record<string, unknown>)[key])
    : null;

/** Run one tool call. Returns the JSON-able result and whether it is an error. */
export async function runTool(name: string, input: unknown): Promise<{ result: unknown; isError: boolean }> {
  switch (name) {
    case PONG_TOOL:
      return {
        isError: false,
        result: {
          reply: "pong",
          nonce: str(input, "nonce"),
          handled_by: deployTarget(),
          handled_at: new Date().toISOString(),
        },
      };

    case FETCH_TRANSCRIPT_TOOL: {
      const symbol = str(input, "symbol");
      if (!symbol) return { isError: true, result: { error: "symbol is required" } };
      const t = await fmpLatestTranscript(symbol);
      if (!t) return { isError: true, result: { error: `no transcript found for ${symbol}` } };
      return { isError: false, result: t };
    }

    case RENDER_SUMMARY_TOOL: {
      const summary = str(input, "summary") ?? "";
      // Nothing to persist yet — the summary lives in the session's own event
      // log (agent.custom_tool_use.input) and is read back from there.
      return { isError: false, result: { ok: true, received_chars: summary.length } };
    }

    default:
      return { isError: true, result: { error: `unknown tool: ${name}` } };
  }
}
