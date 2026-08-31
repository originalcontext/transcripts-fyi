/**
 * Regenerate src/data/tickers.json — the wordwheel's static list.
 *   npm run tickers
 *
 * Russell 3000 ≈ the 3000 largest US-listed companies. Sourced from the SEC's
 * public-domain EDGAR files: company_tickers.json is ordered roughly largest
 * first, company_tickers_exchange.json supplies the listing venue. Filtered to
 * NYSE/Nasdaq, obvious closed-end funds dropped by name (no fund flag in the
 * data; stragglers are harmless — they just have no transcripts), top 3000
 * kept. Snapshot, not live; re-run quarterly or whenever it feels stale.
 *
 * SEC fair access wants a descriptive User-Agent with a contact address
 * (override via SEC_USER_AGENT); without one the request is throttled/blocked.
 */
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.TICKERS_OUT ?? path.resolve(import.meta.dirname, "../src/data/tickers.json");
const N = 3000;
const UA = process.env.SEC_USER_AGENT ?? "transcripts.fyi tickers script (admin@transcripts.fyi)";

const NON_COMPANY = /\bfunds?\b|\bmunicipal|\broyalty trust\b/i;
// EDGAR titles are often shouty legal names ("NVIDIA CORP"). Sentence-case
// all-caps words; initialisms that must stay caps go here.
const KEEP_CAPS = new Set(["LLC", "PLC", "REIT", "USA", "ETF", "III", "VII", "VIII"]);

function prettify(name: string) {
  return name
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[A-Z]{3,}\b/g, (w) => (KEEP_CAPS.has(w) ? w : w[0] + w.slice(1).toLowerCase()))
    .replace(/\bCO\b/g, "Co");
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function main() {
  const [byRank, exchange] = await Promise.all([
    fetchJson<Record<string, { cik_str: number; ticker: string; title: string }>>("https://www.sec.gov/files/company_tickers.json"),
    fetchJson<{ fields: string[]; data: [number, string, string, string | null][] }>(
      "https://www.sec.gov/files/company_tickers_exchange.json",
    ),
  ]);
  const venue = new Map(exchange.data.map((r) => [r[2], r[3]]));

  // The rank file lists the primary share class at the company's rank and
  // pushes secondary classes (GOOG, BRK-A) to the unranked tail; deduping by
  // CIK keeps exactly one ticker per company.
  const seen = new Set<number>();
  const list = Object.values(byRank)
    .filter(
      (r) =>
        r.ticker &&
        r.title &&
        /^[A-Z][A-Z.\-]{0,9}$/.test(r.ticker) &&
        (venue.get(r.ticker) === "NYSE" || venue.get(r.ticker) === "Nasdaq") &&
        !NON_COMPANY.test(r.title) &&
        !seen.has(r.cik_str) &&
        seen.add(r.cik_str),
    )
    .slice(0, N)
    .map((r) => [r.ticker, prettify(r.title)] as const);

  fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), source: "SEC EDGAR company_tickers.json (public domain), top 3000 NYSE/Nasdaq", tickers: list }));
  console.log(`wrote ${list.length} tickers → ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
  console.log("first:", list.slice(0, 3), "last:", list.at(-1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
