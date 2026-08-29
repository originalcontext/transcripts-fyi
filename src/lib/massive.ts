/**
 * Minimal Massive (ex-Polygon.io) client — Fair Market Value only.
 * Docs: https://massive.com/docs/rest/stocks/snapshots/unified-snapshot
 * FMV is returned as `results[].fmv` on GET /v3/snapshot (Business plans only).
 */

const BASE_URL = "https://api.massive.com";
const MAX_BATCH = 250; // documented cap for ticker.any_of

export class MassiveError extends Error {
  status: number;
  url: string; // key redacted (key is sent via header, never in the URL)
  body: string; // first 300 chars of the response body

  constructor(status: number, url: string, body: string) {
    super(`Massive API ${status}: ${body.slice(0, 300) || "(empty body)"}`);
    this.name = "MassiveError";
    this.status = status;
    this.url = url;
    this.body = body.slice(0, 300);
  }
}

export type MassiveFmv = {
  ticker: string;
  fmv: number;
  timestamp: string; // ISO 8601, from fmv_last_updated (epoch ns)
  raw?: unknown;
};

/** One entry of `results[]` from GET /v3/snapshot (fields we use). */
export type MassiveSnapshotResult = {
  ticker: string;
  type?: string;
  fmv?: number | null;
  fmv_last_updated?: number;
  error?: string;
  message?: string;
};

export type MassiveSnapshotResponse = {
  status: string;
  request_id?: string;
  results?: MassiveSnapshotResult[];
};

function apiKey(): string {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) throw new Error("MASSIVE_API_KEY is not set (see .env.local)");
  return key;
}

/** Epoch ns / µs / ms / s → ISO string. */
export function epochToIso(t: number): string {
  let ms = t;
  if (t > 1e17) ms = t / 1e6; // nanoseconds
  else if (t > 1e14) ms = t / 1e3; // microseconds
  else if (t < 1e11) ms = t * 1e3; // seconds
  return new Date(Math.round(ms)).toISOString();
}

async function snapshot(params: Record<string, string>): Promise<MassiveSnapshotResult[]> {
  const url = `${BASE_URL}/v3/snapshot?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey()}`, Accept: "application/json" },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new MassiveError(res.status, url, text);
  const json = JSON.parse(text) as MassiveSnapshotResponse;
  return json.results ?? [];
}

function toFmv(r: MassiveSnapshotResult, url: string): MassiveFmv {
  if (r.error) throw new MassiveError(404, url, `${r.ticker}: ${r.error} ${r.message ?? ""}`);
  if (typeof r.fmv !== "number") {
    throw new MassiveError(403, url, `${r.ticker}: fmv missing (FMV requires a Business plan)`);
  }
  return {
    ticker: r.ticker,
    fmv: r.fmv,
    timestamp: r.fmv_last_updated ? epochToIso(r.fmv_last_updated) : new Date().toISOString(),
    raw: r,
  };
}

/** Real-time FMV estimate for one ticker. */
export async function massiveFmv(ticker: string): Promise<MassiveFmv> {
  const t = ticker.trim().toUpperCase();
  const url = `${BASE_URL}/v3/snapshot?ticker=${t}`;
  const [r] = await snapshot({ ticker: t });
  if (!r) throw new MassiveError(404, url, `${t}: no snapshot result`);
  return toFmv(r, url);
}

/** FMV for many tickers via the batch `ticker.any_of` param (chunks of 250). */
export async function massiveFmvMany(tickers: string[]): Promise<MassiveFmv[]> {
  const list = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  const out: MassiveFmv[] = [];
  for (let i = 0; i < list.length; i += MAX_BATCH) {
    const chunk = list.slice(i, i + MAX_BATCH);
    const url = `${BASE_URL}/v3/snapshot?ticker.any_of=${chunk.join(",")}`;
    const results = await snapshot({ "ticker.any_of": chunk.join(","), limit: String(MAX_BATCH) });
    const byTicker = new Map(results.map((r) => [r.ticker, r]));
    for (const t of chunk) {
      const r = byTicker.get(t);
      if (!r) throw new MassiveError(404, url, `${t}: no snapshot result`);
      out.push(toFmv(r, url));
    }
  }
  return out;
}
