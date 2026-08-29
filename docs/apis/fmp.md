# Financial Modeling Prep (FMP) quick reference

Wrapper: `src/lib/fmp.ts` (plain `fetch`, no deps). Scope: earnings-call
transcripts, SEC filings, income / balance-sheet / cash-flow statements.

## Base URL and auth

- Base: `https://financialmodelingprep.com/stable` (the current surface;
  `/api/v3` is legacy and not used).
- Auth: query param `apikey=<FMP_API_KEY>`; the key is read lazily from
  `process.env.FMP_API_KEY` (set in `.env.local`).
- Bad key -> HTTP 401 `{"Error Message": "Invalid API KEY. ..."}`.
- Bad/missing param -> HTTP 400 plain text, e.g. `Query Error: Invalid or
  missing query parameter - from`.
- Every endpoint below returns a JSON array; non-2xx or non-array -> `FmpError`
  (`status`, key-redacted `url`, first 300 chars of `body`).

Note: the docs site (`site.financialmodelingprep.com/developer/docs/stable`)
returned HTTP 403 to automated fetches on 2026-08-29, so endpoint paths were
taken from the stable surface and proven against the live API instead.

## Endpoints used

| Function | Endpoint | Query params |
|---|---|---|
| `fmpTranscriptList` | `GET /earning-call-transcript-dates` | `symbol` |
| `fmpTranscript` | `GET /earning-call-transcript` | `symbol`, `year` (fiscal), `quarter` (1-4) |
| `fmpLatestTranscript` | list -> newest ref -> `fmpTranscript` | - |
| `fmpFilings` | `GET /sec-filings-search/symbol` | `symbol`, `from`, `to` (both **required**, `YYYY-MM-DD`), `limit` (server cap 1000) |
| `fmpIncomeStatement` | `GET /income-statement` | `symbol`, `period` (`annual`\|`quarter`), `limit` |
| `fmpBalanceSheet` | `GET /balance-sheet-statement` | same |
| `fmpCashFlow` | `GET /cash-flow-statement` | same |

Not used, and why:

- `/earning-call-transcript-latest?symbol=` ignores `symbol` (returned
  `7011.T` for NVDA) - it is a global feed. Latest is derived via the list.
- `/sec-filings-search/form-type?formType=10-K&symbol=` ignores `symbol` too
  (global feed). Type filtering is done client-side.

## Raw -> normalized field mapping

Transcript dates (`FmpTranscriptRef`): `fiscalYear` -> `year`; `quarter`
(number) -> `quarter`; `date` passthrough; `symbol` injected (raw rows have
none). List is re-sorted by `date` desc because FMP's order has a few
misfiled rows (e.g. fiscalYear 2023 dated 2013-04-11).

Transcript (`FmpTranscript`): `year` -> `year` (fiscal: NVDA FY2025 Q2 is
dated 2024-08-28); `period: "Q2"` -> `quarter: 2` (digit parsed; numeric
`quarter` preferred when present); `date`, `content`, `symbol` passthrough.
Empty array or empty `content` -> `null`.

Filings (`FmpFiling`): `formType` -> `type` (falls back to `type`);
`filingDate` (falls back to legacy typo `fillingDate`) trimmed to
`YYYY-MM-DD` (raw is `"2026-08-26 00:00:00"`); `acceptedDate`, `link`,
`finalLink`, `cik` passthrough. `opts.type` compared case-insensitively;
when set, 1000 rows are fetched and filtered. Date window is fixed at
`2000-01-01`..today.

Statements: raw rows passed through unchanged (`Record<string, unknown>[]`,
newest first). Note `fiscalYear` is a string (`"2027"`), `period` is `"Q2"` /
`"FY"`. Defaults: `period: "annual"`, `limit: 5`.

Symbols are upper-cased in every function.

## Rate limits / plan notes

- Docs were unreachable (403), so limits could not be copied from them. No
  plan-gating (402/403) was hit on any endpoint above with this key.
- Filings `limit` is silently capped at 1000 rows; no `page` param was tested.
- Free-tier keys are documented by FMP as rate-limited per minute and
  restricted on some endpoints; nothing here tripped that on 2026-08-29.

## Verification (NVDA, 2026-08-29, this key)

1. `fmpTranscriptList("NVDA")` -> 82 refs; first 3: FY2027 Q2 (2026-08-26),
   FY2027 Q1 (2026-05-20), FY2026 Q4 (2026-02-25).
2. `fmpLatestTranscript("NVDA")` -> FY2027 Q2, 2026-08-26, `content.length`
   46335, begins "Operator: Good afternoon. My name is Tiffany, ...".
   `fmpTranscript("nvda", 1999, 1)` -> `null`.
3. `fmpFilings("NVDA", { type: "10-K", limit: 3 })` -> 3 rows (10-K filed
   2026-02-25, 2025-02-26, 2024-02-21) with index + final links and CIK
   0001045810. NVDA's newest 1000 filings reach back to 2017-10 and contain 9
   10-Ks.
4. `fmpIncomeStatement("NVDA", { period: "quarter", limit: 2 })` -> 2 rows,
   40 keys (`date`, `symbol`, ..., `revenue`, ..., `epsDiluted`,
   `weightedAverageShsOutDil`); row 0 `revenue` = 96221000000 (FY2027 Q2).
   Balance sheet and cash flow verified with the same params (HTTP 200).
- `npx tsc --noEmit -p .` and `npx eslint src/lib/fmp.ts`: clean.
