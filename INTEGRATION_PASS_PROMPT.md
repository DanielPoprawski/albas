# Wave 4 integration pass — prompt for Opus 5

Paste everything below the `---` into a fresh chat with Opus 5. This file is a one-time
handoff artifact — delete it once the integration pass is running (the prompt itself
instructs deletion of `design_handoff_albas_redesign/` at the end, but not this file,
since it lives outside that folder).

## Background (for whoever pastes this in — not part of the prompt itself)

Waves 1–3 of the Albas UI redesign landed via isolated subagents, each of which only read
its own package file and design, then self-reported "done." Nothing was checked end-to-end.
Exploration before writing this prompt confirmed real gaps: `AddModal.tsx` is fully stubbed
(no call site wires `onSubmit`), `Settings.tsx` hardcodes a fake name and a fake sign-in
methods table, the calendar's square-corner styling has a bug outside the obvious file, and
auth is passkey-only with no self-service way to add a second credential. The user has
scoped the auth-method work explicitly: build self-service "add another passkey" as part of
the main pass; delegate password auth and TOTP/2FA to their own smaller, focused agents
using existing libraries rather than hand-rolled crypto.

---

You are running the Wave 4 integration pass for the Albas UI redesign (`design_handoff_albas_redesign/`). Waves 1–3 landed via isolated subagents that never checked their work against each other or against real data — your job is to make it all actually true: visually correct, functionally wired to real data, and free of the coordination gaps that isolation produces.

Read `design_handoff_albas_redesign/ORCHESTRATION.md` first for the ground rules (radius 0 everywhere, etc.) and the original Wave 4 scope. Then read `CLAUDE.md` at the repo root — it documents real architectural decisions (passkey-only auth and why, the sync protocol, theming tokens, the routing pattern) that you must not contradict without a good reason.

**Source-of-truth priority when anything is ambiguous or looks wrong:** the `.dc.html` files in `design_handoff_albas_redesign/designs/` and the PNGs in `design_handoff_albas_redesign/screenshots/` outrank any package `.md` file or any previous agent's self-report. Previous agents' "Done" claims are unverified — trust what you see rendered, not what a report says.

**Ground truth about the account:** the user's real display name is "Daniel Park" — but it must come from real account/session state, not a hardcoded string. If a placeholder happens to already read "Daniel Park," verify it's wired to actual data, not coincidentally correct.The user's ACTUAL name is "Daniel Poprawski" scrutinize anything that says otherwise.

### Use subagents — split by style first, then functionality

Run this in stages so later agents don't fight earlier ones over the same files. Use the model most appropriate for the task, small tasks should be run using Haiku. If a task can be compartmentalized and parallelized, do so with an appropriate agent. The goal is to save on tokens and context. Use appropriate bash tools like 'tree', 'ripgrep', 'zoxide' to find files and save on context. At the end of the run, try to find anything that you've discovered that can save on context, and things that can be brought to the user's attention that will save on context going forward in both the project, and on the user's machine:

**Stage 1 — Style pass (one agent, alone first).**
Launch the app (`bun run tauri dev`, or `bun run dev` for a browser-only check) and use browser automation to visually compare every redesigned screen against its `.dc.html`/screenshot pair at both desktop and the 768px breakpoint: Dashboard, To-Do, Habits, Settings, Splash/Auth, Add Modal. Fix any visual mismatch you find — the calendar event chips not being square is a known one (confirmed: `MonthViewDesktop.tsx` itself has no `rounded` classes or radius styling, so check `src/components/ui/*` shadcn primitives and any global CSS for a default `border-radius` leaking in). Also verify: sidebar active states on every page, focus rings on interactive elements, and no duplicated token/shell code across the packages. Use your own judgment for anything else that looks off compared to the design files — fix it if the fix is obvious, otherwise flag it clearly in your final report rather than guessing.

**Stage 2 — Wiring / real-data pass (one agent, after Stage 1 lands).**
This is the bulk of the work. Confirmed gaps to fix:

1. **`AddModal.tsx` is fully stubbed** — none of its 7 call sites (`HomeView.tsx`, `TodoPanel.tsx`, `TodoViewRedesign.tsx`, `calendar/DayView.tsx`, `calendar/MonthView.tsx`, `calendar/WeekView.tsx`) pass `onSubmit`. Wire real create/edit for events, tasks, and habits through the existing `AppContext` — do not invent a new persistence path when one already exists.
2. **`Settings.tsx`**: replace the hardcoded `useState('Daniel Park')` display name and the fully-mocked `accountRows` array (Account & Sign-in table) with real data — real account name/session state, and real sign-in methods actually attached to the account (today: just passkeys). Do not leave any fabricated row (no fake "Google," "iCloud Keychain," etc. unless that method is real). If the design's "4 ways to sign in · Passkey, Password, OAuth, 2FA" copy on the auth screen no longer matches what's real, fix the copy to reflect only working methods rather than shipping aspirational/false text.
3. **Self-service "add a passkey" flow**: build a real authenticated endpoint on `sync-server` that lets an already-signed-in user (identified by their bearer token, same as `/sync`) register an additional passkey to their own account — reusing the existing `resolve_registration`/`complete_registration` ceremony in `passkey.rs`, but with `account_id` already known from the token instead of requiring an admin-minted invite. Wire the client side the same way passkey registration already works (`src/auth.ts`, the Tauri commands, `usePasskeyAuth.ts`) — this one *does* need to go through the Tauri plugin, since it needs the OS authenticator.
4. **To make Stage 3's job conflict-free**, create a small, explicit extension point for additional sign-in methods rather than leaving password/TOTP agents to edit `Settings.tsx` directly — e.g. an `authMethodRegistry`-style module that Settings renders buttons/rows from, that other files can append to without touching the same lines you're touching. Use your judgment on the exact shape; the goal is that Stage 3 agents each only add new files plus one clean registration call.
5. **Route/shell audit** (the original Wave 4 scope from `ORCHESTRATION.md`): audit the routing block in `AppShell.tsx` (`routeOf()`, the `NAV` array, the conditional render around lines 279–291) — confirm every redesigned view is reachable, sidebar active-state matches the current route on every page, and delete any duplicated token/shell/CSS that slipped through multiple packages defining the same thing.
6. Leave `web/src/AdminConsole.tsx` and its mock data alone unless you determine it's genuinely in scope — per `CLAUDE.md` it's a separate, restricted deployment target, not part of this app's route table. If you think it should be touched, say so in your report rather than doing it.

**Stage 3 — Two new auth methods, in parallel, after Stage 2's extension point exists.** Each of these is a self-contained feature. Keep them out of each other's way and out of Stage 2's files — new files only, plus the single registration call into the extension point Stage 2 built. Neither needs a Tauri command; both are plain HTTP against `sync-server`, unlike passkeys.

- **Password auth** — hand this to a smaller/cheaper model (e.g. Haiku) as its own agent; it's a contained, well-documented feature that doesn't need a large model. Use the `argon2` crate (RustCrypto) for hashing — do not hand-roll it. Add a `password_hash` column to the `accounts` table in `sync-server`'s `init_db`, following whatever idempotent-migration pattern already exists there (check how existing columns were added before writing a new `ALTER`). Add a self-service "set/change password" endpoint (authenticated via bearer token, same pattern as `/sync`) and a `POST /login/password` endpoint that mints a token the same way passkey login does (`mint_token`). Client side: a plain fetch-based hook, no Tauri involvement.
- **TOTP / 2FA with QR enrollment** — a separate agent. Use the `totp-rs` crate server-side for secret generation, `otpauth://` URI construction, and code verification — do not hand-roll TOTP math. Render the QR code **client-side** from the `otpauth://` URI (e.g. the `qrcode.react` npm package) rather than generating an image in Rust — simpler, fewer dependencies, less code. Add an authenticated enroll endpoint (generate + return secret/URI), a confirm endpoint (verify the first code and mark TOTP active), and store whatever's needed on the `accounts` table following the existing migration pattern. Whether TOTP becomes a *required* second factor on every login or just an *additional listed method* is your call — if genuinely ambiguous after reading the design and the existing login flow, note the decision and reasoning in your report rather than guessing silently.

Before either of these agents starts, confirm there isn't already a suitable crate/pattern in `sync-server/Cargo.toml` — don't add a second library that does the same job as one already present.

### After everything lands

1. Run the frontend build (`bun run build`) and, if you touched `src-tauri/`, `cargo build` in `src-tauri/` — both must pass clean.
2. Do a final visual + functional smoke pass yourself: launch the app, create an event/task/habit through the Add Modal and confirm it persists and appears on the calendar/list, open Settings and confirm the name and sign-in methods shown are real, add a second passkey if you have a way to test it, and re-check the 768px breakpoint on every screen one more time now that wiring is done.
3. **Delete `design_handoff_albas_redesign/` entirely.** Its job — landing this redesign — is finished; per its own `ORCHESTRATION.md`, the next step after code lands is a *design-side* repo sync (in the separate design project, not this repo), so nothing here still depends on these files.
4. Write a final report: files changed per stage, anything you couldn't match to the design and why, anything you decided ambiguously and why (especially the TOTP-as-second-factor call), and anything the original foundation (packages 00/01) was missing that you had to work around.
