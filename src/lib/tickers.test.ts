import { describe, expect, it } from "vitest";

import { searchTickers, type TickerEntry } from "./tickers";

const list: TickerEntry[] = [
  ["NVDA", "NVIDIA Corporation"],
  ["NVAX", "Novavax Inc."],
  ["AAPL", "Apple Inc."],
  ["MSFT", "Microsoft Corporation"],
  ["NET", "Cloudflare Inc."],
];

describe("searchTickers", () => {
  it("ranks exact ticker, then ticker prefix, then name substring", () => {
    expect(searchTickers(list, "nv").map((e) => e[0])).toEqual(["NVDA", "NVAX"]);
    expect(searchTickers(list, "NVDA").map((e) => e[0])).toEqual(["NVDA"]);
    expect(searchTickers(list, "corp").map((e) => e[0])).toEqual(["NVDA", "MSFT"]);
    expect(searchTickers(list, "apple").map((e) => e[0])).toEqual(["AAPL"]);
  });
  it("returns nothing for blank input and at most 8 results", () => {
    expect(searchTickers(list, "  ")).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => [`T${i}`, `Thing ${i}`] as const);
    expect(searchTickers(many, "T").length).toBe(8);
  });
});
