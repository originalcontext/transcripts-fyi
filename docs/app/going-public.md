# Going public — checklist

2026-08-29. The repo is private. This is what to do (and what was already checked) before flipping it, so nobody has to re-derive it under time pressure.

## Already clean (verified 2026-08-29)

Scanned the working tree **and full git history** for secret shapes (`sk-ant-`, `whsec_`, `ghp_`/`gho_`, AWS keys, private-key blocks, Postgres URLs with passwords, Upstash hosts, every `*_KEY=`/`*_SECRET=` from `.env.example`). Hits were only the Playwright dummies in `playwright.config.ts` (a fake `whsec_` and `postgresql://u:p@localhost`) — not secrets, safe to keep.

- No `.env*` file has ever been committed; `.env.example` holds names only.
- No Anthropic resource ids (`sesn_`, `agent_`, `env_`, `skill_`), no ngrok hostname, no Vercel preview hostnames, no absolute home paths in tracked files.
- Git author is the GitHub noreply address on every commit.
- The captured test fixture (`src/lib/cma/__fixtures__/distill-session-events.json`) has payload strings trimmed to ~120 chars and no session id.
- GitHub Actions: `permissions: contents: read`, no repository secrets, e2e runs against dummy env.

## Do before flipping

1. **Rotate nothing by reflex — but rotate `INVITE_CODE` if it was ever pasted anywhere public.** It is both the gate and the cookie secret; rotating it logs everyone out (intended).
2. **`src/data/tickers.json`** is derived from FMP's screener. Check FMP's terms on redistributing derived data; if in doubt, delete the file from the tree (and history if you care) and have `npm run tickers` regenerate it locally / at build time. The wordwheel degrades gracefully without it (raw ticker input still works).
3. **`docs/managed-agents/`** is a local reference partly copied from Anthropic's bundled skill and docs. Fine for a private repo; for a public one, either keep it out (add to `.gitignore` and purge from history) or reduce it to our own notes with links.
4. **Commit trailers** carry `Claude-Session: https://claude.ai/code/session_…` links. They are private to the account and harmless, but they advertise tooling and will be visible forever. If you'd rather not, they can be stripped with a history rewrite before the flip (only do this while nobody else has cloned).
5. **GitHub settings**: keep "Require approval for first-time contributors" for Actions (default); consider branch protection on `main` (none today, by decision); the `pull_request` workflows run with no secrets, so fork PRs are safe.
6. **Public surface that a reader now learns about**: the webhook path (signature-verified — fine), the cron paths (`CRON_SECRET` fail-closed — fine), the invite mechanism (HMAC of the code — knowing it doesn't help without the code). None need changing; they were designed to be readable.
7. **Email in docs**: one occurrence in `docs/ideas/zero-friction-universes.md` was replaced with `you@example.com` on 2026-08-29. Re-run the scan below before flipping.

## Re-run the scan

```sh
# secrets in history (patterns; prints counts, never values)
for pat in 'sk-ant-[A-Za-z0-9_-]{20,}' 'whsec_[A-Za-z0-9+/=]{20,}' 'ghp_[A-Za-z0-9]{30,}' 'AKIA[0-9A-Z]{16}' \
           'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY' 'postgres(ql)?://[^:]+:[^@]+@' 'https://[a-z0-9-]+\.upstash\.io' \
           'KV_REST_API_TOKEN=.{10,}' 'FMP_API_KEY=.{10,}' 'MASSIVE_API_KEY=.{10,}' 'INVITE_CODE=.{4,}' 'CRON_SECRET=.{6,}'; do
  printf '%-45s %s\n' "$pat" "$(git log -p --all | grep -cE "$pat")"
done
# identifiers and paths in the tree
git ls-files | xargs grep -lE "(sesn|agent|env|skill|skver|vlt)_01[A-Za-z0-9]{20,}|ngrok-free|/Users/" 2>/dev/null
git ls-files | xargs grep -ohE "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}" 2>/dev/null | grep -vE "noreply|example" | sort -u
```

A dedicated scanner (`gitleaks detect --source .`) is a good second opinion; the patterns above are the ones specific to this stack.
