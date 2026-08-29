# Massive (ex-Polygon.io) — Fair Market Value quick reference

Massive is the 2025 rebrand of Polygon.io. `polygon.io/docs/*` 301-redirects to
`massive.com/docs/*`; `api.polygon.io` and `api.massive.com` both answer (verified 2026-08-29).
Wrapper: `src/lib/massive.ts` (`massiveFmv`, `massiveFmvMany`, `MassiveError`, `MassiveFmv`).

## Base URL / auth
- Base: `https://api.massive.com`
- Key: `MASSIVE_API_KEY` in `.env.local`. Sent as `Authorization: Bearer <key>`.
  `?apiKey=<key>` also works (verified), but the wrapper uses the header so the key never lands in URLs/logs.
- Rate limits: not stated on the endpoint docs; per plan (individual plans are limited; Business is unlimited).

## FMV endpoints
FMV has no dedicated REST endpoint. It is a field on the snapshot endpoints
and a WebSocket channel:

### 1. Unified Snapshot (what the wrapper uses)
`GET /v3/snapshot` — https://massive.com/docs/rest/stocks/snapshots/unified-snapshot
- `ticker=NVDA` (single) or `ticker.any_of=NVDA,AAPL` (comma list, max 250)
- `type` (stocks|options|fx|crypto|indices), `limit` (default 10, max 250), `sort`, `order`
- Response: `{ status, request_id, results: [ { ticker, type, name, market_status,
  fmv: number, fmv_last_updated: <epoch ns>, session{...}, last_quote{...}, last_trade{...}, last_minute{...} } ] }`
- Unknown ticker yields an inline `{ ticker, error: "NOT_FOUND", message }` entry (HTTP still 200).

### 2. Full Market Snapshot
`GET /v2/snapshot/locale/us/markets/stocks/tickers?tickers=NVDA,AAPL` — every ticker also carries
`fmv` (null when not entitled) and `updated` (epoch ns). Not wrapped; `/v3/snapshot` covers both cases.

### 3. WebSocket (streaming)
`wss://business.massive.com/stocks`, subscribe `FMV.<ticker>` (or `FMV.*`).
Message: `{ ev:"FMV", sym:"AAPL", fmv:189.22, t:<ns> }`. Not wrapped.

## Plan / entitlement
Docs: "Fair Market Value is only available on Business plans." On lower plans the snapshot
endpoint still returns 200 but `fmv` is absent/null — the wrapper throws `MassiveError(403)` in that case.
Snapshot itself needs Stocks Starter+ (Basic excluded); 15-min delayed on Starter/Developer.

## Verification (2026-08-29, this key)
- `GET /v3/snapshot?ticker.any_of=NVDA,AAPL` -> 200 with `fmv` + `fmv_last_updated` present
  => **FMV is entitled on this key.**
- `massiveFmv("NVDA")` and `massiveFmvMany(["NVDA","AAPL"])` returned live values
  (see scratch script output in session). `tsc --noEmit` and `eslint` clean.
