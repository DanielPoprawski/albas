// Vanilla WebAuthn ceremony helpers.
//
// sync-server's challenge/credential JSON is produced/consumed by
// webauthn-rs-proto (verified against the vendored crate source, v0.5.5):
// every binary field (challenge, user.id, credential ids, attestationObject,
// clientDataJSON, authenticatorData, signature, userHandle) is a plain
// URL-safe, non-padded Base64 *string* (`Base64UrlSafeData`'s `Serialize`
// impl) — never an object, never a byte array. The browser's WebAuthn API
// wants those same fields as ArrayBuffers, so every ceremony needs one
// decode pass going in and one encode pass coming out.

function base64urlToBuffer(b64url: string): ArrayBuffer {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

function bufferToBase64url(buf: ArrayBuffer | Uint8Array | null | undefined): string {
  if (!buf) return "";
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The `{regId, options}` body of `POST /register/start` or `/passkeys/start`. */
export interface RegistrationChallenge {
  regId: string;
  options: { publicKey: Record<string, unknown> };
}

/** The `{authId, options}` body of `POST /login/start`. */
export interface AuthenticationChallenge {
  authId: string;
  options: { publicKey: Record<string, unknown> };
}

/** Decodes a `PublicKeyCredentialCreationOptions` JSON payload into the shape `navigator.credentials.create()` expects. */
export function prepareCreationOptions(publicKey: Record<string, unknown>): CredentialCreationOptions {
  const pk = { ...publicKey } as Record<string, unknown>;
  pk.challenge = base64urlToBuffer(publicKey.challenge as string);

  const user = publicKey.user as Record<string, unknown>;
  pk.user = { ...user, id: base64urlToBuffer(user.id as string) };

  const exclude = publicKey.excludeCredentials as Array<Record<string, unknown>> | undefined;
  if (exclude) {
    pk.excludeCredentials = exclude.map((c) => ({ ...c, id: base64urlToBuffer(c.id as string) }));
  }

  // webauthn-rs only *prefers* a resident key by default (server sends
  // "discouraged"); login here is discoverable/usernameless, so a
  // non-resident credential would silently break sign-in later. Insist, same
  // as src/auth.ts does for the Tauri app's passkey ceremonies.
  pk.authenticatorSelection = {
    ...((pk.authenticatorSelection as object) ?? {}),
    residentKey: "required",
    requireResidentKey: true,
  };

  return { publicKey: pk as unknown as PublicKeyCredentialCreationOptions };
}

/** Decodes a `PublicKeyCredentialRequestOptions` JSON payload into the shape `navigator.credentials.get()` expects. */
export function prepareRequestOptions(publicKey: Record<string, unknown>): CredentialRequestOptions {
  const pk = { ...publicKey } as Record<string, unknown>;
  pk.challenge = base64urlToBuffer(publicKey.challenge as string);

  const allow = publicKey.allowCredentials as Array<Record<string, unknown>> | undefined;
  if (allow) {
    pk.allowCredentials = allow.map((c) => ({ ...c, id: base64urlToBuffer(c.id as string) }));
  }

  return { publicKey: pk as unknown as PublicKeyCredentialRequestOptions };
}

/** Serializes a freshly-created credential for `POST /register/finish` (or `/passkeys/finish`)'s `credential` field. */
export function serializeCreatedCredential(cred: PublicKeyCredential): Record<string, unknown> {
  const response = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    response: {
      attestationObject: bufferToBase64url(response.attestationObject),
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
    },
  };
}

/** Serializes an assertion result for `POST /login/finish`'s `credential` field. */
export function serializeAssertedCredential(cred: PublicKeyCredential): Record<string, unknown> {
  const response = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    response: {
      authenticatorData: bufferToBase64url(response.authenticatorData),
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null,
    },
  };
}

export function webauthnSupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}
