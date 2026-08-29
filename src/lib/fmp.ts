/**
 * Minimal, dependency-free client for the Financial Modeling Prep "stable" API.
 * Scope: earnings-call transcripts, SEC filings, core financial statements.
 * See docs/apis/fmp.md for endpoint details and verification notes.
 */

const BASE_URL = "https://financialmodelingprep.com/stable";

export class FmpError extends Error {
  status: number;
  /** Request URL with the API key redacted. */
  url: string;
  /** First 300 chars of the response body. */
  body: string;

  constructor(status: number, url: string, body: string) {
    super(`FMP request failed (${status}) ${url}: ${body}`);
    this.name = "FmpError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export type FmpTranscript = {
  symbol: string;
  /** Fiscal year as reported by FMP (may differ from the calendar year of `date`). */
  year: number;
  quarter: number;
  date: string;
  content: string;
};

export type FmpTranscriptRef = {
  symbol: string;
  year: number;
  quarter: number;
  date: string;
};

export type FmpFiling = {
  symbol: string;
  type: string;
  filingDate: string;
  acceptedDate?: string;
  link: string;
  finalLink?: string;
  cik?: string;
};

export type FmpPeriod = "annual" | "quarter";

type Raw = Record<string, unknown>;

function apiKey(): string {
  const key = process.env.FMP_API_KEY;
  if (!key) {
    throw new Error("FMP_API_KEY is not set (add it to .env.local)");
  }
  return key;
}

function redact(url: string, key: string): string {
  return url.split(key).join("REDACTED");
}

async function fmpGet(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<Raw[]> {
  const key = apiKey();
  const url = new URL(`${BASE_URL}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  url.searchParams.set("apikey", key);

  const res = await fetch(url, { headers: { accept: "application/json" } });
  const safeUrl = redact(url.toString(), key);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new FmpError(res.status, safeUrl, redact(text, key).slice(0, 300));
  }
  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    // FMP returns arrays for every endpoint used here; anything else is an
    // in-band error such as {"Error Message": "..."}.
    throw new FmpError(res.status, safeUrl, JSON.stringify(data).slice(0, 300));
  }
  return data as Raw[];
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** FMP reports the quarter as either a number (2) or a string ("Q2"). */
function quarterOf(raw: Raw): number {
  if (raw.quarter != null) return num(raw.quarter);
  const m = /(\d)/.exec(str(raw.period));
  return m ? Number(m[1]) : NaN;
}

/** FMP reports the year as `fiscalYear` on some endpoints and `year` on others. */
function yearOf(raw: Raw): number {
  return num(raw.fiscalYear ?? raw.year);
}

function toTranscript(symbol: string, raw: Raw): FmpTranscript {
  return {
    symbol: str(raw.symbol) || symbol,
    year: yearOf(raw),
    quarter: quarterOf(raw),
    date: str(raw.date),
    content: str(raw.content),
  };
}

/** All available transcript dates for a symbol, newest first (by call date). */
export async function fmpTranscriptList(symbol: string): Promise<FmpTranscriptRef[]> {
  const sym = symbol.toUpperCase();
  const rows = await fmpGet("earning-call-transcript-dates", { symbol: sym });
  return rows
    .map((r) => ({
      symbol: sym,
      year: yearOf(r),
      quarter: quarterOf(r),
      date: str(r.date),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** One transcript by fiscal year + quarter. Returns null when FMP has none. */
export async function fmpTranscript(
  symbol: string,
  year: number,
  quarter: number,
): Promise<FmpTranscript | null> {
  const sym = symbol.toUpperCase();
  const rows = await fmpGet("earning-call-transcript", { symbol: sym, year, quarter });
  const row = rows[0];
  if (!row || !str(row.content)) return null;
  return toTranscript(sym, row);
}

/**
 * Newest transcript for a symbol: list dates, take the newest, fetch it.
 * (FMP's `earning-call-transcript-latest` endpoint ignores `symbol`, so it is
 * not used here.)
 */
export async function fmpLatestTranscript(symbol: string): Promise<FmpTranscript | null> {
  const refs = await fmpTranscriptList(symbol);
  const newest = refs[0];
  if (!newest) return null;
  return fmpTranscript(newest.symbol, newest.year, newest.quarter);
}

/**
 * SEC filings for a symbol, newest first. `type` filters by form type
 * (e.g. "10-K") client-side, since the endpoint has no form-type param.
 * FMP requires a date window; we use 2000-01-01 through today.
 */
export async function fmpFilings(
  symbol: string,
  opts: { type?: string; limit?: number } = {},
): Promise<FmpFiling[]> {
  const sym = symbol.toUpperCase();
  const limit = opts.limit ?? 20;
  const today = new Date().toISOString().slice(0, 10);
  const rows = await fmpGet("sec-filings-search/symbol", {
    symbol: sym,
    from: "2000-01-01",
    to: today,
    // Server caps limit at 1000; over-fetch when filtering client-side (NVDA
    // has ~9 10-Ks within its newest 1000 filings, back to ~2017).
    limit: opts.type ? 1000 : limit,
  });
  const wanted = opts.type?.toUpperCase();
  const filings: FmpFiling[] = [];
  for (const r of rows) {
    const type = str(r.formType ?? r.type);
    if (wanted && type.toUpperCase() !== wanted) continue;
    filings.push({
      symbol: str(r.symbol) || sym,
      type,
      filingDate: str(r.filingDate ?? r.fillingDate).slice(0, 10),
      acceptedDate: r.acceptedDate != null ? str(r.acceptedDate) : undefined,
      link: str(r.link),
      finalLink: r.finalLink != null ? str(r.finalLink) : undefined,
      cik: r.cik != null ? str(r.cik) : undefined,
    });
    if (filings.length >= limit) break;
  }
  return filings;
}

type StatementOpts = { period?: FmpPeriod; limit?: number };

function statement(path: string, symbol: string, opts: StatementOpts): Promise<Raw[]> {
  return fmpGet(path, {
    symbol: symbol.toUpperCase(),
    period: opts.period ?? "annual",
    limit: opts.limit ?? 5,
  });
}

/** Raw income-statement rows, newest first. */
export function fmpIncomeStatement(symbol: string, opts: StatementOpts = {}): Promise<Raw[]> {
  return statement("income-statement", symbol, opts);
}

/** Raw balance-sheet rows, newest first. */
export function fmpBalanceSheet(symbol: string, opts: StatementOpts = {}): Promise<Raw[]> {
  return statement("balance-sheet-statement", symbol, opts);
}

/** Raw cash-flow rows, newest first. */
export function fmpCashFlow(symbol: string, opts: StatementOpts = {}): Promise<Raw[]> {
  return statement("cash-flow-statement", symbol, opts);
}
