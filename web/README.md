# Albas web portal

The small public site at `albas.danni-dev.com/` (the `/api` sync endpoint lives on the
same origin, proxied by nginx to `sync-server/`). It is the app's **browser-side auth
surface**, not a dashboard: there is no calendar or to-do view here.

## What it serves

- `/` — splash, with links to sign in, register, or read about offline use.
- `/login`, `/register` — username + password, and the secondary passkey / Google paths.
  All WebAuthn happens here, in the system browser; the app itself holds no WebAuthn code.
- `/offline` — what "local-first" means and how to add sync later.
- Signed-in page — add a passkey, manage two-factor (TOTP + recovery codes), sessions,
  log out. Reached from the app via the nonce handoff (`#app_session=` in the URL fragment).

The former `/admin` console is gone; server administration is `sync-server/scripts/admin.sh`
(see `sync-server/README.md`, "Admin CLI").

## Stack

React 19 + TypeScript, bundled and served by **Bun** (`build.ts`, `src/index.ts`). Plain
CSS in `src/index.css` — no Tailwind, no component library. Fonts are self-hosted from
`src/fonts/` (the CSP is `style-src 'self'`, `font-src 'self' data:`). No inline styles.

```sh
bun install
bun run dev      # http://localhost:3000, proxies /api to a local sync-server on :8787
bun run build    # dist/, deployed by sync-server/scripts/publish.sh
```

Details for contributors are in `CLAUDE.md` next to this file.
