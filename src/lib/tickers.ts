export type TickerEntry = readonly [ticker: string, name: string];

/** Narrow the JSON module's `string[][]` to entries; drops anything malformed rather than trusting the file. */
export function asTickerEntries(rows: unknown): TickerEntry[] {
  return Array.isArray(rows) ? rows.filter((r): r is [string, string] => Array.isArray(r) && typeof r[0] === "string" && typeof r[1] === "string") : [];
}

/** Rank: exact ticker, then ticker prefix, then company-name substring. At most 8. */
export function searchTickers(list: readonly TickerEntry[], raw: string): TickerEntry[] {
  const q = raw.trim().toUpperCase();
  if (!q) return [];
  const ql = raw.trim().toLowerCase();
  const exact: TickerEntry[] = [], prefix: TickerEntry[] = [], name: TickerEntry[] = [];
  for (const e of list) {
    if (e[0] === q) exact.push(e);
    else if (e[0].startsWith(q)) prefix.push(e);
    else if (e[1].toLowerCase().includes(ql)) name.push(e);
    if (exact.length + prefix.length + name.length > 40) break;
  }
  return [...exact, ...prefix, ...name].slice(0, 8);
}
