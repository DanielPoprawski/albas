Here is a comprehensive scrutiny and architectural analysis of Albas, covering your UI/UX, authentication flows,
  offline-first data model, sync engine, and project roadmap.
  ──────
   1. Executive Summary & Assessment 

  You have built a remarkably solid foundation. The decision to use local-first SQLite in Rust via Tauri with a dumb
  row-store sync server in Axum puts Albas in the exact same architectural tier as high-performance modern apps like
  Linear, Obsidian, and Superhuman.

  Your key instincts are spot-on:

  1. Dropping invite codes for open signups removes massive onboarding friction.
  2. Delegating complex registration/login to the web browser solves the vast majority of Tauri/WebView WebAuthn and
  OAuth compatibility headaches.
  3. Keeping SQLite on the client is significantly superior to SurrealDB, Redis, or JS storage for your goals.
  4. The local-first + optional paid sync model is user-friendly and well-aligned with self-hosting power users.

  Below is a detailed breakdown of where things stand, what conflicts exist, and how to resolve them.
  ──────
   2. Auth & Registration: Web vs In-App & Multi-Method Security 

    flowchart TD
        subgraph Desktop / Mobile App
            A["Splash Screen / Settings"] -->|"Click 'Sign In' / 'Register'"| B["Open Default Browser"]
            E["App Deep Link Listener (albas://auth/callback)"] -->|"Extract Session Token"| F["Store in SQLite
  settings & Start Sync"]
        end
        subgraph System Web Browser (albas.danni-dev.com)
            B --> C["Web Auth Portal (/login or /register)"]
            C -->|"Passkey / Windows Hello / Touch ID / Face ID"| D["WebAuthn Ceremony"]
            C -->|"OAuth (Google / Apple / GitHub)"| D
            C -->|"Password + TOTP 2FA"| D
            C -->|"Passwordless Magic Link"| D
            D -->|"Success"| E
        end

  ### Should you drop invite codes?

  Yes, completely.

  • Currently, Welcome.tsx:320-334 still shows an "Invite Code (Optional)" input during registration, even though
  signups are open by default.
  • For standard users, an invite field creates hesitation ("Do I need an invite? Am I missing something?"). Removing
  it streamlines registration to a single action: picking an account name / signing in.
  • If you ever need gated beta access or restricted deployments, manage that via a server environment variable
  (ALBAS_SYNC_SIGNUPS=closed|open) or a direct subscription checkout hook.

  ### Webpage Auth vs In-App Tauri Auth

  Your intuition to use the webpage for registration and login is the right architectural move.

   Authentication Method           | Inside Tauri WebView (Linux WebKitGTK… | In System Browser (albas.danni-dev.com)
  ---------------------------------|----------------------------------------|-----------------------------------------
   Passkeys / WebAuthn             | Brittle; requires OS-specific Rust     | Native & Flawless. Leverages 1Password,
                                   | plugins (Cargo.toml:28), custom PIN    | Bitwarden, Apple Keychain, Windows
                                   | dialogs (PinDialog.tsx), and breaks on | Hello, and Android Credential Manager
                                   | unsupported OSes (macOS/iOS).          | directly.
   OAuth (Google / GitHub / Apple) | Blocked by Google. Google explicitly   | Standard & Secure. Full PKCE OAuth
                                   | blocks OAuth from embedded web views   | flow.
                                   | (disallowed_useragent).                |
   Passwordless Magic Links        | Difficult (requires switching apps and | Instant 1-click login from browser
                                   | manual code copying).                  | email tabs.
   2FA / Authenticator App         | Requires custom client form state.     | Standard web UI forms with auto-fill
                                   |                                        | support.

  #### Recommended Implementation:

  • The Web Auth Flow (Deep Link / Loopback):
      1. In Albas desktop/mobile, clicking "Sign In" or "Register" invokes the system default browser opening
      https://albas.danni-dev.com/login?source=app.
      2. The user authenticates using whichever method they configured (Passkey, Google OAuth, Password + TOTP, or
      Magic Link).
      3. Once authenticated, the web page redirects to a deep link URI:
      albas://auth/callback?token=<SESSION_TOKEN>&account=<ACCOUNT_NAME>.
      4. Tauri intercepts the URI, writes __sync_token and __sync_account to SQLite, and triggers the initial sync.
  • Self-Hosters Fallback:
      • For power users running their own server locally without public HTTPS/WebAuthn, keep a simple "Advanced:
      Connect with Sync Token" form in Settings.tsx:350-370.

  ──────
   3. Splash Screen, Onboarding & The Logout Loop 

  ### The Current Logout UX Bug

  In Settings.tsx:94-105, clicking Sign Out calls sync_sign_out in Rust. This clears the token and shared rows, but
  leaves __welcome_done = 1 intact.

  Because AppShell.tsx:299 only shows Welcome.tsx when !welcomeDone, signing out leaves the user trapped in the
  Settings view labeled as Local (offline) without returning them to the splash screen.

  ### The Ideal Onboarding & Splash UX Structure

                             ┌────────────────────────┐
                             │   Albas Splash Screen  │
                             │   (Full bleed intro)   │
                             └───────────┬────────────┘
                                         │
                ┌────────────────────────┼────────────────────────┐
                ▼                        ▼                        ▼
        ┌───────────────┐        ┌───────────────┐        ┌───────────────┐
        │    Sign In    │        │ Create Account│        │  Use Offline  │
        │ (Web/DeepLink)│        │ (Web/DeepLink)│        │ (Instant App) │
        └───────┬───────┘        └───────┬───────┘        └───────┬───────┘
                │                        │                        │
                └────────────────────────┼────────────────────────┘
                                         ▼
                          ┌─────────────────────────────┐
                          │    Main App Dashboard       │
                          │ (Syncing or Offline banner) │
                          └──────────────┬──────────────┘
                                         │ (Sign Out clicked)
                                         ▼
                          ┌─────────────────────────────┐
                          │ Confirm Sign Out & Wipe/Keep│
                          │  -> Returns to Splash Screen│
                          └─────────────────────────────┘

  1. First-Class 3-Way Choice on Splash:
      • Sign In: Connect existing cloud account.
      • Create Account: Register new account.
      • Use Offline: No account needed, 100% functionality on this device.
  2. Gentle Offline Promotion:
      • When using Offline Mode, show a small, subtle status pill in the bottom bar: ● Local Only — Sign in to sync
      across devices.
      • When the user eventually signs in from offline mode, their local data should not be wiped. Because
      sync.rs:7-10 collects all local rows with updated_at > push_watermark, their existing offline tasks and events
      will seamlessly push to their new cloud account on first sync!
  3. Sign Out Flow:
      • Clicking Sign Out prompts: "Sign out of [Account]? Your local items will remain on this device, but syncing
      will stop until you sign in again."
      • Reset __welcome_done to '0' and return the user immediately to the Splash Screen.

  ──────
   4. Data Architecture: SQLite vs Redis vs SurrealDB vs JS Storage 

    ┌────────────────────────────────────────────────────────────────────────┐
    │                          Albas Architecture                            │
    │                                                                        │
    │  [ Tauri Client (Desktop / Android) ]                                  │
    │  ┌──────────────────────────────────────────────────────────────────┐  │
    │  │ React UI  <──IPC──>  Rust Backend                                │  │
    │  │                      ├── rusqlite (Local-First Source of Truth)  │  │
    │  │                      └── sync.rs Engine                          │  │
    │  └───────────────────────────────┬──────────────────────────────────┘  │
    │                                  │ (HTTPS JSON Sync Protocol)          │
    │                                  ▼                                     │
    │  [ Sync Server (Axum / Rust) ]                                         │
    │  ┌──────────────────────────────────────────────────────────────────┐  │
    │  │ Axum HTTP API  <───> SQLite Database (WAL mode)                  │  │
    │  │                      └── Opaque Rows: (account, tbl, pk)         │  │
    │  └──────────────────────────────────────────────────────────────────┘  │
    └────────────────────────────────────────────────────────────────────────┘

  ### Why Local SQLite (rusqlite) in Rust is the Gold Standard

  • Immunity to WebView Eviction: Browser-based storage (IndexedDB, LocalStorage, OPFS) inside Tauri can be cleared by
  the OS when disk space is low or when WebKit cache resets. A Rust-managed SQLite file in the app data directory is
  permanent and secure.
  • Zero-Latency Offline Reads/Writes: SQLite executes in microseconds directly in process memory.
  • True Portability: Backing up data is as simple as copying albas.db. Exporting to .ics or JSON is trivial.

  ### Why You Should NOT Switch to SurrealDB or Redis

   Technology                         | Evaluation for Albas                                         | Recommendation
  ------------------------------------|--------------------------------------------------------------|----------------
   SurrealDB                          | Overkill. SurrealDB is designed for complex graph/document   | Avoid.
                                      | queries in cloud environments. Embedding it in client        |
                                      | binaries bloats size, increases memory overhead, and makes   |
                                      | self-hosting significantly harder.                           |
   Redis                              | Unnecessary dependency. Your server is a dumb row store      | Avoid.
                                      | (account, table, pk -> payload). SQLite in WAL mode on a     |
                                      | modest VPS handles tens of thousands of sync requests per    |
                                      | second with single-file zero-config backups. Redis adds RAM  |
                                      | costs, data persistence configuration hassles, and ruins     |
                                      | single-container Docker setups for self-hosters.             |
   JS Native Storage (IndexedDB/OPFS) | WebKitGTK on Linux and Android WebView have notorious        | Keep in Rust.
                                      | storage quota limits and unpredictable garbage collection.   |

  ### Key Improvements to Make to Your Sync Engine

  1. Add Real-time SSE (Server-Sent Events) or WebSockets:
      • Currently, sync triggers on startup or manual button click.
      • By keeping an open SSE stream (GET /api/sync/events) when online, when Device A checks off a habit, the server
      broadcasts an invalidation notice, and Device B pulls the change within 100ms.
  2. Tombstone Garbage Collection (GC):
      • Deleted items currently persist as deleted = 1 indefinitely in both client and server databases.
      • Add a server GC routine: permanently purge tombstones older than 90 days if all registered devices for that
      account have synced past that sequence number.
  3. Restore User-Configurable Server URL in Settings:
      • Currently, CLAUDE.md:76 notes that the server field was removed from the UI.
      • For self-hosters, restore an editable "Sync Server URL" under Advanced Settings so they can point to
      https://my-nas.lan:8787 without rebuilding the app from source.

  ──────
   5. Monetization & Self-Hosting Strategy 

    ┌────────────────────────────────────────┬────────────────────────────────────────┐
    │         Free / Self-Hosted Tier        │          Albas Cloud ($ / mo)          │
    ├────────────────────────────────────────┼────────────────────────────────────────┤
    │ • 100% features unlocked locally       │ • All Free features                    │
    │ • Unlimited offline calendars & habits │ • Hosted sync server (zero maintenance)│
    │ • Unlimited self-hosted sync instances │ • Multi-device automatic sync          │
    │ • Local export / import (.ics, SQLite) │ • Read-only calendar & habit sharing   │
    │ • Free forever                         │ • Web view of calendar & habits (future│
    └────────────────────────────────────────┴────────────────────────────────────────┘

  ### Why this business model works:

  • The "Obsidian / Bitwarden" Playbook: Free offline app + free self-hosting creates immense developer and community
  goodwill.
  • The Conversion: The "average joe" will happily pay $3–$5/month because they don't want to manage Docker, reverse
  proxies, and SSL certs on a VPS. Power users will self-host and advocate for your app.
  • Gating the Paid Service:
      • Your app binary remains 100% open and unencumbered by DRM or license keys.
      • The only gate is access to albas.danni-dev.com/api (the server checks if the account has an active Stripe
      subscription token). If someone points the app to their own server, it syncs for free.

  ──────
   6. Comprehensive UI/UX & Workflow Scrutiny 

  Looking closely at your UI components and interactions:

  ### 1. Unified Terminology Across Desktop and Mobile

  • In desktop AppShell.tsx:94, the navigation item is called "To-Do".
  • In mobile HomeView.tsx:120, the bottom tab is called "Tasks".
  • Recommendation: Standardize on "Tasks" or "To-Do" across both platforms for consistency.

  ### 2. Modernizing WeightPanel.tsx

  • WeightPanel.tsx is currently using legacy CSS variables and classes, causing it to look mismatched compared to the
  sleek new TodoViewRedesign and Calendar views.
  • Recommendation: Update WeightPanel with the modern --t-* semantic theme tokens.

  ### 3. Add Modal: Category Creation on the Fly

  • In AddModal.tsx:44, creating a task provides a fixed preset palette of categories, but TodoForm.tsx treats
  category as free text.
  • Recommendation: Allow users to either select an existing category from their personal list or type a brand new
  category directly in the creation modal.

  ### 4. Local Profile Customization for Offline Users

  • In Settings.tsx:188-200, the profile section is completely read-only and displays Local (offline) with a static
  avatar.
  • Recommendation: Allow offline users to set a local Display Name (stored in the SQLite settings table), giving them
  a personalized feel even without cloud sync.

  ### 5. Habit vs Task Creation Mental Model

  • A Todo item in Albas smartly represents Tasks (schedule: 'once'), Habits (cadence-based), and Chores (fromDone:
  true).
  • Ensure that when clicking "+ Add" from the Habits view, the modal defaults to the Habit tab; when clicking "+ Add"
  from the Tasks view, it defaults to Task.
  ──────
   7. Actionable Roadmap & Priority Checklist 

   Priority | Area            | Action Item
  ----------|-----------------|---------------------------------------------------------------------------------------
    🟢 P0   | UX Fix          | Fix the Logout Loop: When signing out in Settings.tsx:94, reset __welcome_done = '0'
            |                 | and route back to the Splash Screen.
    🟢 P0   | UX / Onboarding | Drop Invites from UI: Remove the Invite Code field from Welcome.tsx:320-334 and
            |                 | simplify the Splash choices to Sign In, Create Account, and Use Offline.
    🟡 P1   | Auth Flow       | Adopt Web Browser Auth: Open system browser for login/registration (albas.danni-
            |                 | dev.com), complete Passkeys/OAuth/Passwordless there, and redirect to the desktop app
            |                 | via albas://auth/callback?token=....
    🟡 P1   | Self-Hosting    | Restore Server URL in Settings: Add an Advanced Server URL input so self-hosters can
            |                 | enter custom endpoints easily.
    🔵 P2   | Sync Engine     | Add Real-time Invalidation (SSE): Implement a lightweight Server-Sent Events endpoint
            |                 | in Axum so multi-device sync happens instantly when online.
    🔵 P2   | Visual Polish   | Theme WeightPanel.tsx: Migrate WeightPanel to modern --t-* tokens to match the rest
            |                 | of the application.

────────────────────────────────────────────────────────────

Keep everything in a single GitHub repository (Monorepo), but organize it into clean,
  dedicated subfolders.

  You should strongly avoid splitting this into 4 separate Git repositories.

  Here is why your current layout feels messy, why 4 separate repos would create massive friction, and the ideal
  directory structure to organize everything cleanly.
  ──────
  ### 1. Why Your Current Layout Feels Confusing

  The reason you are feeling friction right now is that the current project structure is asymmetrical:

    albas/ (Root is the Desktop App!)
    ├── src/           <-- Desktop React UI
    ├── src-tauri/     <-- Desktop Rust Backend
    ├── package.json   <-- Desktop Dependencies & Build Scripts
    ├── sync-server/   <-- Subproject 1 (Axum backend)
    └── web/           <-- Subproject 2 (Splash + Auth + Admin Console)

  Because the desktop app lives directly in the root, it feels like sync-server and web are "second-class citizens"
  awkwardly shoved inside the desktop app's folder.
  ──────
  ### 2. Why 4 Separate Git Repositories (Polyrepo) is a Trap

  If you create 4 separate GitHub repositories (albas-app, albas-sync, albas-web, albas-admin), you will run into
  severe maintenance overhead:

    flowchart LR
        subgraph Polyrepo Friction
            R1[albas-app repo] -.->|Coordination Hell| R2[albas-sync repo]
            R2 -.->|Separate Commits & PRs| R3[albas-web repo]
            R3 -.->|Broken Types & Out-of-sync APIs| R4[albas-admin repo]
        end

  1. Schema & Protocol Changes:
      • When you add a new field (e.g., location or a new habit schedule type), in a single repo you update sync.rs,
      the React UI, and the main.rs in one single commit/branch.
      • With 4 repos, you have to open 4 pull requests, juggle 4 version tags, and risk breaking compatibility across
      mismatched client/server versions.
  2. Shared Nginx & WebAuthn Security Boundary:
      • Your server, admin console, and web splash all deploy to the exact same origin: https://albas.danni-dev.com.
      • WebAuthn / Passkey Relying Party ID is strictly tied to this domain.
      • In a single repository, your docker-compose.yml and Nginx reverse proxy configs build and deploy the sync
      server and web bundle together with one command.
  3. Single Issue Tracker & Project Board:
      • As an independent developer, managing 4 different issue trackers, 4 PR queues, and 4 dependency update
      notifications is exhausting and unnecessary.

  ──────
  ### 3. The Ideal Clean Structure (Single Repo, Symmetrical Folders)

  Here is how high-performance open-source projects (like Cal.com, Infisical, and Supabase) structure this in a single
  Git repository:

    albas/                             <-- Single GitHub Repository & Local Folder
    ├── apps/
    │   ├── desktop/ (or app/)         <-- 1. Main Tauri App (Desktop & Android)
    │   │   ├── src/                   <-- React frontend UI
    │   │   ├── src-tauri/             <-- Rust backend (rusqlite, Tauri commands)
    │   │   └── package.json
    │   │
    │   └── web/                       <-- 2. Public Web Portal & 3. Admin Console
    │       ├── src/
    │       │   ├── App.tsx            <-- Splash, /login, /register, /offline
    │       │   ├── AdminConsole.tsx   <-- /admin Staff Console (Token-gated)
    │       │   └── index.ts           <-- Bun HTTP server
    │       └── package.json
    │
    ├── server/
    │   └── sync-server/               <-- 4. Axum Sync Server (Rust row-store)
    │       ├── src/
    │       ├── Cargo.toml
    │       ├── Dockerfile
    │       └── nginx/                 <-- Shared Nginx proxy configs
    │
    ├── scripts/                       <-- Global build / release / versioning scripts
    ├── README.md
    └── package.json                   <-- Root workspace / convenience scripts
  ──────
  ### 4. What About the Web Splash vs Admin Console?

  Should the Admin Console be in a separate folder from the Web Splash?

  Recommendation: Keep them inside the web/ folder as two routes (/ and /admin).

  Here is why:

  • In index.ts, Bun already routes:
      • /, /login, /register, /offline → index.html (Splash & Auth)
      • /admin → admin.html (Admin Console, gated by ALBAS_SYNC_ADMIN_TOKEN)
  • Both live on albas.danni-dev.com behind the same Nginx proxy.
  • Merging them into one web service means you only have to run 1 Bun container and 1 Axum container in production,
  keeping your server RAM footprint under 50 MB total!
  ──────
  ### Summary Checklist

   Structure        | Recommendation				| Why
  ------------------|-------------------------------------------|-----------------------------------------------------
   GitHub Repos     | 1 Repository				| Atomic commits, single issue tracker, zero cross-
                    | (github.com/DanielPoprawski/albas)        | repo dependency friction.
   Local Folder     | 1 Root Folder (~/Code/albas)		| Clean, single IDE workspace; easy to search across
                    |                                           | frontend, backend, and server with one grep/find.
   Subfolder Layout | Symmetrical Folders (app/, web/, sync-    | Separates concerns cleanly without nesting
                    | server/)                                  | subprojects inside the desktop app.
   Admin Console    | Nested in web/ (/admin route)             | Single web build, single Bun runtime in Docker,
                    |                                           | zero deployment overhead.
