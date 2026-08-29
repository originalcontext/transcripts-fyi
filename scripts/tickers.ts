/**
 * Regenerate src/data/tickers.json — the wordwheel's static list.
 *   npm run tickers
 *
 * Russell 3000 ≈ the 3000 largest US-listed companies, so we take FMP's
 * company screener sorted by market cap (NYSE/NASDAQ/AMEX, common stock,
 * actively trading) and keep the top 3000. Snapshot, not live; re-run
 * quarterly or whenever it feels stale.
 */
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(import.meta.dirname, "../src/data/tickers.json");
const N = 3000;

async function main() {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error("FMP_API_KEY is not set");
  const url = new URL("https://financialmodelingprep.com/stable/company-screener");
  Object.entries({
    marketCapMoreThan: "50000000",
    isEtf: "false",
    isFund: "false",
    isActivelyTrading: "true",
    country: "US",
    exchange: "NYSE,NASDAQ,AMEX",
    limit: "4000",
    apikey: key,
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`screener ${res.status}`);
  const rows = (await res.json()) as { symbol: string; companyName: string; marketCap: number }[];

  const seen = new Set<string>();
  const list = rows
    .filter((r) => r.symbol && r.companyName && /^[A-Z][A-Z.\-]{0,9}$/.test(r.symbol) && !seen.has(r.symbol) && seen.add(r.symbol))
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, N)
    .map((r) => [r.symbol, r.companyName.replace(/\s+/g, " ").trim()] as const);

  fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), source: "FMP company-screener, top 3000 US by market cap", tickers: list }));
  console.log(`wrote ${list.length} tickers → ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
  console.log("first:", list.slice(0, 3), "last:", list.at(-1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
