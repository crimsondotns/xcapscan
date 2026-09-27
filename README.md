# XCap Scan

Static, browser-only transaction list for many wallets. No server, no account, no keys. Wallet list and settings stay in this browser's `localStorage`.

## Pages

| Path | Page |
|---|---|
| `/` | Dashboard — wallet groups in the left rail, net flow of the selected group, then Wallets / Recent transactions as tabs |
| `/group/<group>` | Dashboard filtered to one tag or chain group |
| `/wallet/<address>` | One wallet — net flow, then Tokens / Transactions as tabs; the wallet's tag is edited here |
| `/token/<symbol>` | One token across every loaded wallet |
| `/wallet/<address>/token/<symbol>` | One token inside one wallet |
| `/settings`, `/import` | Settings / Import dialog over the dashboard |
| `/verify/<code>` | Slip verification (opens over the dashboard) |

Every figure comes from transactions already loaded in this browser, and only from moves the source priced — no estimates, no invented history.

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:5174/xcapscan/
pnpm typecheck
pnpm check
pnpm test
pnpm build        # dist/
```

Deployed to GitHub Pages from the `xcap-scan` branch by `.github/workflows/pages.yml`.
