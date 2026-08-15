# Albas

All in one to-do list, calendar, and habit tracker.

## Installation:

`git clone {url}`

`cd albas`

`npm run tauri dev`

or the command for linux if you're having issues with Hyprland
`WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 GDK_BACKEND=x11 npm run tauri dev`

---

## ⚠️ TODO once the server exists: replace the domain placeholders

Sync and passkeys are built but **not usable until a real domain is filled in
two places**. Both currently say `sync.example.com`. Until then the app still
works fully offline — passkey endpoints just return 503.

- [ ] **`sync-server/.env`** — add `ALBAS_SYNC_ORIGIN=https://sync.yourdomain.com`
      (and uncomment `ALBAS_SYNC_ADMIN_TOKEN` if you want to mint invites).
      Without `ALBAS_SYNC_ORIGIN` there are no passkeys at all: WebAuthn needs
      it to derive the relying-party identity.
- [ ] **`src-tauri/gen/android/app/src/main/res/values/strings.xml`** — the
      `asset_statements` string. Android only. Desktop passkeys work without it.
- [ ] **Android also needs** `ALBAS_SYNC_ASSETLINKS` and
      `ALBAS_SYNC_ANDROID_ORIGIN` on the server — see "Android passkeys" below.

Everything else (`ALBAS_SYNC_TOKEN`, existing devices, existing data) keeps
working untouched; the server migrates its own database on first start.

## Running the sync server on Docker

On the box that owns the domain:

```bash
mkdir albas-sync && cd albas-sync
curl -O https://raw.githubusercontent.com/DanielPoprawski/albas/main/sync-server/docker-compose.yml

cat > .env <<EOF
ALBAS_SYNC_TOKEN=$(openssl rand -hex 32)
ALBAS_SYNC_ADMIN_TOKEN=$(openssl rand -hex 32)
ALBAS_SYNC_ORIGIN=https://sync.yourdomain.com
EOF

docker compose up -d
docker compose logs -f          # should print "albas-sync listening on ..."
```

Later updates are `docker compose pull && docker compose up -d`. Data lives in
the `albas-sync-data` volume — **that's the thing to back up.**

The container listens on `127.0.0.1:8787` only, so it needs a TLS reverse proxy
in front. Passkeys *require* real HTTPS (browsers and Android both refuse
otherwise), so this isn't optional any more. With Caddy that's one line in the
Caddyfile:

```
sync.yourdomain.com {
    reverse_proxy 127.0.0.1:8787
}
```

Then in the app: **Settings → Account & sync**, enter `https://sync.yourdomain.com`,
and hit "Create account" (or "Sign in with passkey" once an account exists).

To enroll your security key on the `owner` account that `ALBAS_SYNC_TOKEN`
created, mint an invite naming it — that's the only way to attach a passkey to
an account that already exists:

```bash
curl -X POST https://sync.yourdomain.com/invites \
  -H "Authorization: Bearer $ALBAS_SYNC_ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"name": "owner"}'
```

Paste the returned code into the app's Create-account screen with the name `owner`.

### Android passkeys

Android's Credential Manager will only run a ceremony for a domain that
explicitly vouches for the app, and it asserts an `android:apk-key-hash:` origin
instead of the https one. Two extra values, both derived from your release
signing key:

```bash
# 1. the colon-hex fingerprint, for assetlinks.json
keytool -list -v -keystore ~/.android/albas-release.jks -alias albas | grep 'SHA256:'

# 2. the same bytes as base64url, for ALBAS_SYNC_ANDROID_ORIGIN
keytool -list -v -keystore ~/.android/albas-release.jks -alias albas \
  | grep 'SHA256:' | cut -d' ' -f3 \
  | python3 -c "import base64,sys; print(base64.urlsafe_b64encode(bytes.fromhex(sys.stdin.read().strip().replace(':',''))).decode().rstrip('='))"
```

Add to the server's `.env` (note the app id uses an **underscore**):

```bash
ALBAS_SYNC_ANDROID_ORIGIN=android:apk-key-hash:<the base64url value>
ALBAS_SYNC_ASSETLINKS='[{"relation":["delegate_permission/common.get_login_creds"],"target":{"namespace":"android_app","package_name":"dev.daniel_p.albas","sha256_cert_fingerprints":["<the colon-hex value>"]}}]'
```

The server then serves that at `/.well-known/assetlinks.json`, which is exactly
what the `asset_statements` string in `strings.xml` points at. Verify with
`curl https://sync.yourdomain.com/.well-known/assetlinks.json`.

Debug builds install as `dev.daniel_p.albas.dev` signed with the Android debug
key, so testing passkeys on a debug build needs a second entry in that JSON with
that package name and the debug key's fingerprint (`~/.android/debug.keystore`,
password `android`).

> Heads up: `tauri-plugin-webauthn` is young and pinned in `Cargo.lock` to
> `webauthn-rs-proto` 0.5.1 — a blanket `cargo update` breaks the build until
> upstream fixes it. Test the ceremony on desktop with the real key before
> trusting it on a phone.

Full server docs, protocol and sharing details: [`sync-server/README.md`](sync-server/README.md).


