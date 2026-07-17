# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Albas is a Tauri v2 desktop app — an all-in-one to-do list, calendar, and habit tracker. The frontend is React + TypeScript + Tailwind CSS v4 (custom calendar grid, no calendar library), built with Vite. The backend is Rust via Tauri.

## Commands

```bash
# Run in development (standard)
npm run tauri dev

# Run on Hyprland (Wayland compositor workaround)
WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 GDK_BACKEND=x11 npm run tauri dev

# Build for production
npm run build          # frontend only (tsc + vite)
npm run tauri build    # full app bundle

## TODO LIST
1. The habit tracker should have a color wheel or at least more color options
2. Instead of just every N days, it should also have options for every N weeks, N times per week, N times per month, etc. 
3. The Week and Day view doesn't seem to work.
4. Reminder should show options for how long before the event takes place to remind the user, as well as an option for multiple reminders (1 week prior, 1 day prior)

# Frontend dev server only (no Tauri)
npm run dev
```

## Architecture

The app has two distinct layers that communicate via Tauri's IPC bridge:

- **Frontend** (`src/`): React app rendered in a WebView. Entry point is `src/main.tsx`, which mounts `AppShell` inside `AppProvider` (`src/context/AppContext.tsx`) — the single source of truth for tasks, habits, selected date, and active view. State persists to `localStorage` (key `albas-data-v1`); swap the load/save in `AppContext` for Tauri commands when moving persistence to Rust. UI components live in `src/components/`, shared date helpers in `src/dates.ts`, and Tailwind v4 design tokens in `src/App.css` under `@theme`.
- **Backend** (`src-tauri/src/`): Rust. `lib.rs` defines Tauri commands registered with `invoke_handler`; `main.rs` calls `run()`. To expose a new Rust function to the frontend, annotate it with `#[tauri::command]` and add it to `generate_handler![]` in `lib.rs`.

Frontend calls Rust via `invoke()` from `@tauri-apps/api`. Tauri capabilities (permissions) are configured in `src-tauri/capabilities/default.json`.

I'm building a React-based Tauri productivity app called "Albas" with integrated calendar, to-do list, and habit tracker. I have a design from Google Stitch that I'll paste below.

## Requirements:
1. **Convert to React Components** - Transform the HTML/CSS into proper, reusable React components (not a single file)
2. **Component Structure**:
   - Calendar component (month view, clickable dates)
   - To-Do list with add/edit/delete functionality
   - Habit tracker with streak tracking
   - Sidebar navigation
   - Main layout shell

3. **Interconnected Features**:
   - To-dos can be assigned to calendar dates
   - Habits appear on calendar when due
   - Clicking a date shows tasks and habits for that day
   - State management (use React hooks) to sync all three

4. **Tauri Ready**:
   - Use standard React hooks (useState, useContext for shared state)
   - No external state libraries yet (keep it simple)
   - Structure so it's easy to add Tauri commands later

5. **Keep the Design**:
   - Use the Stitch color scheme and styling
   - Maintain the glassmorphism cards
   - Keep the dark mode aesthetic
   - Material Symbols icons (as they appear in the design)

6. **Add Interactivity**:
   - Add button should open a modal/form to create items
   - Click habit checkboxes to mark complete
   - Click tasks to toggle complete
   - Date clicks show daily view

## Design Code:
<!-- Annotated Mobile Dashboard Refined -->
<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>FocusFlow | Dashboard</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&amp;family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            "colors": {
                    "surface-tint": "#0053db",
                    "on-secondary-container": "#00714d",
                    "primary-fixed-dim": "#b4c5ff",
                    "on-error-container": "#93000a",
                    "surface-variant": "#d3e4fe",
                    "on-secondary-fixed": "#002113",
                    "primary": "#004ac6",
                    "on-primary-fixed-variant": "#003ea8",
                    "tertiary": "#ad0033",
                    "error-container": "#ffdad6",
                    "on-tertiary-container": "#ffecec",
                    "on-tertiary-fixed-variant": "#92002a",
                    "on-primary-fixed": "#00174b",
                    "inverse-surface": "#213145",
                    "on-tertiary": "#ffffff",
                    "surface-container-high": "#dce9ff",
                    "on-error": "#ffffff",
                    "inverse-on-surface": "#eaf1ff",
                    "surface-dim": "#cbdbf5",
                    "outline-variant": "#c3c6d7",
                    "outline": "#737686",
                    "primary-container": "#2563eb",
                    "inverse-primary": "#b4c5ff",
                    "tertiary-container": "#d22348",
                    "on-tertiary-fixed": "#40000d",
                    "on-secondary": "#ffffff",
                    "surface": "#f8f9ff",
                    "secondary": "#006c49",
                    "on-secondary-fixed-variant": "#005236",
                    "secondary-container": "#6cf8bb",
                    "on-primary": "#ffffff",
                    "surface-container-low": "#eff4ff",
                    "error": "#ba1a1a",
                    "primary-fixed": "#dbe1ff",
                    "secondary-fixed-dim": "#4edea3",
                    "surface-container": "#e5eeff",
                    "on-surface": "#0b1c30",
                    "surface-container-lowest": "#ffffff",
                    "surface-bright": "#f8f9ff",
                    "on-surface-variant": "#434655",
                    "secondary-fixed": "#6ffbbe",
                    "tertiary-fixed-dim": "#ffb2b7",
                    "background": "#f8f9ff",
                    "on-primary-container": "#eeefff",
                    "surface-container-highest": "#d3e4fe",
                    "tertiary-fixed": "#ffdadb",
                    "on-background": "#0b1c30"
            },
            "borderRadius": {
                    "DEFAULT": "0.25rem",
                    "lg": "0.5rem",
                    "xl": "0.75rem",
                    "full": "9999px"
            },
            "spacing": {
                    "xs": "4px",
                    "base": "8px",
                    "md": "24px",
                    "sm": "12px",
                    "gutter": "24px",
                    "margin": "32px",
                    "lg": "40px",
                    "xl": "64px"
            },
            "fontFamily": {
                    "body-md": ["Inter", "sans-serif"],
                    "label-md": ["Inter", "sans-serif"],
                    "body-sm": ["Inter", "sans-serif"],
                    "headline-lg-mobile": ["Inter", "sans-serif"],
                    "headline-lg": ["Inter", "sans-serif"],
                    "headline-xl": ["Inter", "sans-serif"]
            },
            "fontSize": {
                    "body-md": ["16px", {"lineHeight": "24px", "fontWeight": "400"}],
                    "label-md": ["12px", {"lineHeight": "16px", "letterSpacing": "0.05em", "fontWeight": "600"}],
                    "body-sm": ["14px", {"lineHeight": "20px", "fontWeight": "400"}],
                    "headline-lg-mobile": ["20px", {"lineHeight": "28px", "fontWeight": "600"}],
                    "headline-lg": ["24px", {"lineHeight": "32px", "letterSpacing": "-0.01em", "fontWeight": "600"}],
                    "headline-xl": ["36px", {"lineHeight": "44px", "letterSpacing": "-0.02em", "fontWeight": "700"}]
            }
          },
        },
      }
    </script>
<style>
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20;
        }
        .glass-card {
            backdrop-filter: blur(16px);
            background: rgba(11, 28, 48, 0.4);
            border: 1px solid rgba(195, 198, 215, 0.08);
        }
        body {
            background-color: #0b1c30;
            overscroll-behavior-y: contain;
        }
        .multi-day-event {
            position: relative;
            z-index: 5;
        }
        .multi-day-event::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 0;
            right: 0;
            height: 24px;
            transform: translateY(-50%);
            background: rgba(37, 99, 235, 0.2);
            z-index: -1;
        }
        .multi-day-start::before {
            border-top-left-radius: 9999px;
            border-bottom-left-radius: 9999px;
            background: rgba(37, 99, 235, 0.6) !important;
            left: 4px;
        }
        .multi-day-end::before {
            border-top-right-radius: 9999px;
            border-bottom-right-radius: 9999px;
            background: rgba(37, 99, 235, 0.6) !important;
            right: 4px;
        }
        .multi-day-mid::before {
            left: 0;
            right: 0;
        }
    </style>
</head>
<body class="font-body-md text-on-surface bg-on-background selection:bg-primary-container/30">
<!-- Collapsed Side Navigation (Icon Only) -->
<aside class="fixed left-0 top-0 w-14 backdrop-blur-md border-r border-outline-variant/10 flex flex-col items-center py-md gap-lg z-50 bg-on-background h-[calc(100%-64px)]">
<div class="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center mb-base">
<span class="material-symbols-outlined text-on-primary-container" style="font-variation-settings: 'FILL' 1;">bolt</span>
</div>
<div class="flex flex-col gap-md">
<button class="w-10 h-10 flex items-center justify-center rounded-xl text-primary-fixed-dim bg-primary-container/20">
<span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">calendar_today</span>
</button>
<button class="w-10 h-10 flex items-center justify-center rounded-xl text-on-surface-variant hover:bg-surface-variant/20 transition-colors">
<span class="material-symbols-outlined">check_circle</span>
</button>
<button class="w-10 h-10 flex items-center justify-center rounded-xl text-on-surface-variant hover:bg-surface-variant/20 transition-colors">
<span class="material-symbols-outlined">repeat</span>
</button>
<button class="w-10 h-10 flex items-center justify-center rounded-xl text-on-surface-variant hover:bg-surface-variant/20 transition-colors">
<span class="material-symbols-outlined">insights</span>
</button>
</div>
</aside>
<!-- Main Content -->
<main class="ml-14 pb-32 min-h-screen relative z-10 px-gutter">
<!-- Header -->
<header class="pt-lg pb-md">
<div class="flex justify-between items-end">
<div>
<h1 class="text-headline-lg text-on-background font-bold tracking-tight">October 2023</h1>
<p class="text-body-sm text-on-surface-variant/80">Tuesday, Oct 17</p>
</div>
<div class="flex gap-xs"><button class="p-xs text-on-surface-variant/40 hover:text-on-surface-variant transition-colors"><span class="material-symbols-outlined text-[20px]">chevron_left</span></button><button class="p-xs text-on-surface-variant/40 hover:text-on-surface-variant transition-colors"><span class="material-symbols-outlined text-[20px]">chevron_right</span></button></div>
</div>
</header>
<!-- Calendar View -->
<section class="mb-lg">
<div class="glass-card rounded-2xl p-md">
<div class="grid grid-cols-7 text-center mb-sm">
<span class="text-[10px] font-bold text-on-surface-variant/60 tracking-widest">S</span>
<span class="text-[10px] font-bold text-on-surface-variant/60 tracking-widest">M</span>
<span class="text-[10px] font-bold text-on-surface-variant/60 tracking-widest">T</span>
<span class="text-[10px] font-bold text-on-surface-variant/60 tracking-widest">W</span>
<span class="text-[10px] font-bold text-on-surface-variant/60 tracking-widest">T</span>
<span class="text-[10px] font-bold text-on-surface-variant/60 tracking-widest">F</span>
<span class="text-[10px] font-bold text-on-surface-variant/60 tracking-widest">S</span>
</div>
<div class="grid grid-cols-7 text-center gap-y-sm"><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant/20 text-body-md">30</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">1</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md relative">2<div class="absolute bottom-2 w-1.5 h-1.5 rounded-full bg-secondary"></div></div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">3</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">4</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">5</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md relative">6<div class="absolute bottom-2 flex gap-[2px]"><div class="w-1.5 h-1.5 rounded-full bg-primary-container"></div><div class="w-1.5 h-1.5 rounded-full bg-tertiary"></div></div></div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md multi-day-event multi-day-start">8</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md multi-day-event multi-day-mid">9</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md multi-day-event multi-day-end">10</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">11</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">12</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">13</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">14</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">15</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">16</div><div class="h-16 flex flex-col items-center justify-center relative"><span class="w-10 h-10 flex items-center justify-center bg-primary text-white rounded-full font-bold text-body-md shadow-lg shadow-primary/20">17</span></div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md bg-secondary-container/10 rounded-lg">18</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">19</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md bg-tertiary-container/10 rounded-lg">20</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">21</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">22</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">23</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">24</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">25</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">26</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">27</div><div class="h-16 flex flex-col items-center justify-center text-on-surface-variant text-body-md">28</div></div>
</div>
</section>
<!-- Habit Tracker (Refined to match Desktop style) -->
<section>
<div class="flex justify-between items-baseline mb-md">
<h3 class="text-[10px] font-bold text-on-surface-variant uppercase tracking-[0.2em]">Habit Tracking</h3>
<button class="text-primary-fixed-dim text-[10px] font-bold uppercase tracking-wider">Analysis</button>
</div>
<div class="glass-card rounded-2xl p-md space-y-lg"><div><div class="flex items-center gap-xs mb-sm"><span class="w-1.5 h-1.5 rounded-full bg-secondary"></span><span class="text-[10px] font-bold text-secondary uppercase tracking-[0.15em]">Hydration</span></div><div class="flex justify-between items-center"><div class="flex flex-col"><span class="text-headline-lg-mobile font-bold text-on-background">2.5L</span><span class="text-[10px] text-on-surface-variant/60 font-medium">Daily Goal: 3L</span></div><div class="flex gap-4"><span class="material-symbols-outlined text-secondary text-[20px]">check</span><span class="material-symbols-outlined text-secondary text-[20px]">check</span><span class="material-symbols-outlined text-on-surface-variant/20 text-[20px]">close</span><span class="material-symbols-outlined text-on-surface-variant/20 text-[20px]">close</span><span class="material-symbols-outlined text-on-surface-variant/20 text-[20px]">close</span></div></div></div><div><div class="flex items-center gap-xs mb-sm"><span class="w-1.5 h-1.5 rounded-full bg-primary-container"></span><span class="text-[10px] font-bold text-primary-container uppercase tracking-[0.15em]">Deep Work</span></div><div class="flex justify-between items-center"><div class="flex flex-col"><span class="text-headline-lg-mobile font-bold text-on-background">4.0h</span><span class="text-[10px] text-on-surface-variant/60 font-medium">Daily Goal: 4h</span></div><div class="flex gap-4"><span class="material-symbols-outlined text-primary-container text-[20px]">check</span><span class="material-symbols-outlined text-primary-container text-[20px]">check</span><span class="material-symbols-outlined text-primary-container text-[20px]">check</span><span class="material-symbols-outlined text-primary-container text-[20px]">check</span></div></div></div><div><div class="flex items-center gap-xs mb-sm"><span class="w-1.5 h-1.5 rounded-full bg-tertiary"></span><span class="text-[10px] font-bold text-tertiary uppercase tracking-[0.15em]">Meditation</span></div><div class="flex justify-between items-center"><div class="flex flex-col"><span class="text-headline-lg-mobile font-bold text-on-background">10m</span><span class="text-[10px] text-on-surface-variant/60 font-medium">Daily Goal: 15m</span></div><div class="flex gap-4"><span class="material-symbols-outlined text-tertiary text-[20px]">check</span><span class="material-symbols-outlined text-on-surface-variant/20 text-[20px]">close</span><span class="material-symbols-outlined text-on-surface-variant/20 text-[20px]">close</span></div></div></div></div>
</section>
</main>
<!-- Refined Floating Action Button -->
<button class="fixed bottom-24 right-6 w-12 h-12 bg-primary text-on-primary rounded-full shadow-xl z-50 flex items-center justify-center active:scale-90 transition-transform">
<span class="material-symbols-outlined text-[24px]">add</span>
</button>
<!-- Refined Subtle Bottom Navigation -->
<nav class="fixed bottom-0 left-0 w-full h-16 bg-surface-dim/40 backdrop-blur-xl border-t border-outline-variant/5 z-40 flex justify-around items-center px-lg">
<button class="flex flex-col items-center gap-0.5 text-primary-fixed-dim transition-opacity opacity-100">
<span class="material-symbols-outlined text-[20px]" style="font-variation-settings: 'FILL' 1;">calendar_today</span>
<span class="text-[9px] font-bold uppercase tracking-widest">Plan</span>
</button>
<button class="flex flex-col items-center gap-0.5 text-on-surface-variant transition-opacity opacity-40 hover:opacity-100">
<span class="material-symbols-outlined text-[20px]">check_circle</span>
<span class="text-[9px] font-bold uppercase tracking-widest">Tasks</span>
</button>
<button class="flex flex-col items-center gap-0.5 text-on-surface-variant transition-opacity opacity-40 hover:opacity-100">
<span class="material-symbols-outlined text-[20px]">repeat</span>
<span class="text-[9px] font-bold uppercase tracking-widest">Habits</span>
</button>
<button class="flex flex-col items-center gap-0.5 text-on-surface-variant transition-opacity opacity-40 hover:opacity-100">
<span class="material-symbols-outlined text-[20px]">settings</span>
<span class="text-[9px] font-bold uppercase tracking-widest">Setup</span>
</button>
</nav>
<script>
    // Subtle interactions
    document.querySelectorAll('.glass-card').forEach(card => {
        card.addEventListener('touchstart', () => {
            card.style.background = 'rgba(11, 28, 48, 0.5)';
        });
        card.addEventListener('touchend', () => {
            card.style.background = 'rgba(11, 28, 48, 0.4)';
        });
    });
</script>
</body></html>

<!-- Refined FocusFlow Dashboard -->
<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>FocusFlow | Productivity Dashboard</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            "colors": {
                    "surface-tint": "#0053db",
                    "on-secondary-container": "#00714d",
                    "primary-fixed-dim": "#b4c5ff",
                    "on-error-container": "#93000a",
                    "surface-variant": "#d3e4fe",
                    "on-secondary-fixed": "#002113",
                    "primary": "#004ac6",
                    "on-primary-fixed-variant": "#003ea8",
                    "tertiary": "#ad0033",
                    "error-container": "#ffdad6",
                    "on-tertiary-container": "#ffecec",
                    "on-tertiary-fixed-variant": "#92002a",
                    "on-primary-fixed": "#00174b",
                    "inverse-surface": "#213145",
                    "on-tertiary": "#ffffff",
                    "surface-container-high": "#dce9ff",
                    "on-error": "#ffffff",
                    "inverse-on-surface": "#eaf1ff",
                    "surface-dim": "#cbdbf5",
                    "outline-variant": "#c3c6d7",
                    "outline": "#737686",
                    "primary-container": "#2563eb",
                    "inverse-primary": "#b4c5ff",
                    "tertiary-container": "#d22348",
                    "on-tertiary-fixed": "#40000d",
                    "on-secondary": "#ffffff",
                    "surface": "#f8f9ff",
                    "secondary": "#006c49",
                    "on-secondary-fixed-variant": "#005236",
                    "secondary-container": "#6cf8bb",
                    "on-primary": "#ffffff",
                    "surface-container-low": "#eff4ff",
                    "error": "#ba1a1a",
                    "primary-fixed": "#dbe1ff",
                    "secondary-fixed-dim": "#4edea3",
                    "surface-container": "#e5eeff",
                    "on-surface": "#0b1c30",
                    "surface-container-lowest": "#ffffff",
                    "surface-bright": "#f8f9ff",
                    "on-surface-variant": "#434655",
                    "secondary-fixed": "#6ffbbe",
                    "tertiary-fixed-dim": "#ffb2b7",
                    "background": "#f8f9ff",
                    "on-primary-container": "#eeefff",
                    "surface-container-highest": "#d3e4fe",
                    "tertiary-fixed": "#ffdadb",
                    "on-background": "#0b1c30",
                    "deep-navy": "#0a121e"
            },
            "borderRadius": {
                    "DEFAULT": "0.25rem",
                    "lg": "0.5rem",
                    "xl": "0.75rem",
                    "full": "9999px"
            },
            "spacing": {
                    "xs": "4px",
                    "base": "8px",
                    "md": "24px",
                    "sm": "12px",
                    "gutter": "24px",
                    "margin": "32px",
                    "lg": "40px",
                    "xl": "64px"
            },
            "fontFamily": {
                    "body-md": ["Inter"],
                    "label-md": ["Inter"],
                    "body-sm": ["Inter"],
                    "headline-lg-mobile": ["Inter"],
                    "headline-lg": ["Inter"],
                    "headline-xl": ["Inter"]
            },
            "fontSize": {
                    "body-md": ["16px", {"lineHeight": "24px", "fontWeight": "400"}],
                    "label-md": ["12px", {"lineHeight": "16px", "letterSpacing": "0.05em", "fontWeight": "600"}],
                    "body-sm": ["14px", {"lineHeight": "20px", "fontWeight": "400"}],
                    "headline-lg-mobile": ["20px", {"lineHeight": "28px", "fontWeight": "600"}],
                    "headline-lg": ["24px", {"lineHeight": "32px", "letterSpacing": "-0.01em", "fontWeight": "600"}],
                    "headline-xl": ["36px", {"lineHeight": "44px", "letterSpacing": "-0.02em", "fontWeight": "700"}]
            }
          },
        },
      }
    </script>
<style>
        body {
            background-color: #0b1c30;
            font-family: 'Inter', sans-serif;
            color: #eaf1ff;
        }
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
        .glass-card {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .calendar-grid {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            height: calc(100vh - 120px);
        }
        .calendar-cell {
            border-right: 1px solid rgba(0, 0, 0, 0.05);
            border-bottom: 1px solid rgba(0, 0, 0, 0.05);
            transition: background-color 0.2s;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }
        .calendar-cell:hover {
            background: rgba(0, 0, 0, 0.02);
        }
        .scrollbar-hide::-webkit-scrollbar {
            display: none;
        }
    </style>
</head>
<body class="overflow-hidden bg-on-background">
<!-- Top Navigation (Shell Implementation) -->
<header class="bg-deep-navy w-full h-16 fixed top-0 left-0 z-40 border-b border-outline-variant/10 shadow-sm flex justify-between items-center px-margin w-full max-w-[1440px] mx-auto">
<div class="flex items-center gap-md ml-xl">
<span class="font-headline-lg text-headline-lg font-bold text-primary-fixed-dim">Albas</span>
<div class="hidden md:flex gap-sm ml-xl">
<span class="font-body-md text-body-md text-primary-fixed-dim font-bold border-b-2 border-primary pb-1 cursor-pointer">Calendar</span>
<span class="font-body-md text-body-md text-outline-variant font-medium hover:bg-white/5 transition-colors cursor-pointer active:scale-95 px-2 rounded">Projects</span>
<span class="font-body-md text-body-md text-outline-variant font-medium hover:bg-white/5 transition-colors cursor-pointer active:scale-95 px-2 rounded">Analytics</span>
</div>
</div>
<div class="flex items-center gap-md"></div>
</header>
<div class="flex pt-16 h-screen">
<!-- Left Sidebar (SideNavBar Implementation) - Updated to Deep Navy -->
<aside class="fixed left-0 top-0 h-full w-16 z-50 bg-deep-navy border-r border-outline-variant/10 flex flex-col p-base space-y-xs items-center pt-2">
<div class="px-md py-md mb-md hidden">
<h1 class="font-headline-lg text-headline-lg font-bold text-primary">FocusFlow</h1>
<p class="font-label-md text-label-md text-on-surface-variant">Productivity Suite</p>
</div>
<nav class="space-y-xs mt-4">
<div class="bg-primary text-white rounded-lg font-semibold flex items-center gap-sm px-md py-sm cursor-pointer hover:translate-x-1 duration-200 shadow-lg">
<span class="material-symbols-outlined">calendar_today</span>
<span class="font-label-md text-label-md hidden">Calendar</span>
</div>
<div class="text-outline-variant hover:bg-white/10 flex items-center gap-sm px-md py-sm rounded-lg cursor-pointer transition-all hover:translate-x-1 duration-200">
<span class="material-symbols-outlined">check_circle</span>
<span class="font-label-md text-label-md hidden">Tasks</span>
</div>
<div class="text-outline-variant hover:bg-white/10 flex items-center gap-sm px-md py-sm rounded-lg cursor-pointer transition-all hover:translate-x-1 duration-200">
<span class="material-symbols-outlined">repeat</span>
<span class="font-label-md text-label-md hidden">Habits</span>
</div>
<div class="text-outline-variant hover:bg-white/10 flex items-center gap-sm px-md py-sm rounded-lg cursor-pointer transition-all hover:translate-x-1 duration-200">
<span class="material-symbols-outlined">settings</span>
<span class="font-label-md text-label-md hidden">Settings</span>
</div>
</nav>
</aside>
<!-- Main Content (Central Calendar Workspace) -->
<main class="ml-16 mr-[280px] flex-1 bg-on-background p-md overflow-hidden">
<div class="max-w-[1440px] mx-auto h-full flex flex-col">
<!-- Calendar Header -->
<div class="flex items-center justify-between mb-md">
<div class="flex items-center gap-md">
<h2 class="font-headline-xl text-headline-xl text-on-primary">October 2024</h2>
<div class="flex bg-white/10 rounded-lg p-xs">
<button class="p-xs hover:bg-white/20 rounded transition-colors">
<span class="material-symbols-outlined text-outline-variant">chevron_left</span>
</button>
<button class="px-sm text-label-md font-label-md text-on-primary">Today</button>
<button class="p-xs hover:bg-white/20 rounded transition-colors">
<span class="material-symbols-outlined text-outline-variant">chevron_right</span>
</button>
</div>
</div>
<div class="flex items-center gap-sm bg-white/10 p-xs rounded-lg">
<button class="px-md py-xs rounded bg-surface-bright text-primary font-semibold text-label-md shadow-sm">Month</button>
<button class="px-md py-xs rounded text-outline-variant font-medium text-label-md hover:text-on-primary">Week</button>
<button class="px-md py-xs rounded text-outline-variant font-medium text-label-md hover:text-on-primary">Day</button>
</div>
</div>
<!-- Calendar Content - High Contrast Light Background -->
<div class="flex-1 bg-surface-bright rounded-xl border border-outline-variant/30 overflow-hidden shadow-2xl">
<!-- Weekdays Row -->
<div class="grid grid-cols-7 bg-surface-container/50 border-b border-outline-variant/30">
<div class="py-sm text-center font-label-md text-label-md text-outline">MON</div>
<div class="py-sm text-center font-label-md text-label-md text-outline">TUE</div>
<div class="py-sm text-center font-label-md text-label-md text-outline">WED</div>
<div class="py-sm text-center font-label-md text-label-md text-outline">THU</div>
<div class="py-sm text-center font-label-md text-label-md text-outline">FRI</div>
<div class="py-sm text-center font-label-md text-label-md text-on-surface font-bold">SAT</div>
<div class="py-sm text-center font-label-md text-label-md text-on-surface font-bold">SUN</div>
</div>
<!-- Days Grid -->
<div class="calendar-grid scrollbar-hide overflow-y-auto bg-white text-on-surface">
<div class="calendar-cell p-sm opacity-40"><div>30</div></div>
<div class="calendar-cell p-sm"><div>1</div></div>
<div class="calendar-cell p-sm">
<div>2</div>
<div class="mt-auto p-xs bg-secondary/10 border-l-4 border-secondary rounded text-[10px] text-on-secondary-fixed-variant font-bold">
<span class="block opacity-60 font-normal mb-1">09:00 AM</span>
            Team Sync
        </div>
</div>
<div class="calendar-cell p-sm"><div>3</div></div>
<div class="calendar-cell p-sm">
<div>4</div>
<div class="mt-auto p-xs bg-primary/10 border-l-4 border-primary rounded text-[10px] text-on-primary-fixed-variant font-bold">
<span class="block opacity-60 font-normal mb-1">02:00 PM</span>
            Project Review
        </div>
</div>
<div class="calendar-cell p-sm font-bold"><div>5</div></div>
<div class="calendar-cell p-sm font-bold"><div>6</div></div>
<div class="calendar-cell p-sm"><div>7</div></div>
<div class="calendar-cell p-sm"><div>8</div></div>
<div class="calendar-cell p-sm">
<div>9</div>
<div class="mt-auto p-xs bg-tertiary/10 border-l-4 border-tertiary rounded text-[10px] text-on-tertiary-fixed-variant font-bold">
<span class="block opacity-60 font-normal mb-1">08:00 AM</span>
            Meditation
        </div>
</div>
<div class="calendar-cell p-sm"><div>10</div></div>
<div class="calendar-cell p-sm"><div>11</div></div>
<div class="calendar-cell p-sm font-bold"><div>12</div></div>
<div class="calendar-cell p-sm font-bold"><div>13</div></div>
<div class="calendar-cell p-sm"><div>14</div></div>
<div class="calendar-cell p-sm bg-primary-container/5">
<div>15</div>
<div class="mt-auto p-xs bg-primary/20 border-l-4 border-primary rounded text-[10px] text-primary font-bold">Today</div>
</div>
<!-- Multi-day Event Row Start -->
<div class="calendar-cell p-sm bg-secondary/10 relative border-t-2 border-on-surface border-b-2">
<div class="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-on-surface"></div>
<div class="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-on-surface"></div>
<div class="text-[10px] font-bold text-on-secondary-fixed-variant bg-white px-1 absolute top-[-7px] left-2">Product Launch</div>
<div>16</div>
</div>
<div class="calendar-cell p-sm bg-secondary/10 border-t-2 border-on-surface border-b-2">
<div>17</div>
</div>
<div class="calendar-cell p-sm bg-secondary/10 relative border-t-2 border-on-surface border-b-2">
<div class="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-on-surface"></div>
<div class="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-on-surface"></div>
<div>18</div>
</div>
<!-- Multi-day Event Row End -->
<div class="calendar-cell p-sm font-bold"><div>19</div></div>
<div class="calendar-cell p-sm font-bold"><div>20</div></div>
<div class="calendar-cell p-sm"><div>21</div></div>
<div class="calendar-cell p-sm"><div>22</div></div>
<div class="calendar-cell p-sm"><div>23</div></div>
<div class="calendar-cell p-sm"><div>24</div></div>
<div class="calendar-cell p-sm"><div>25</div></div>
<div class="calendar-cell p-sm font-bold"><div>26</div></div>
<div class="calendar-cell p-sm font-bold"><div>27</div></div>
<div class="calendar-cell p-sm"><div>28</div></div>
<div class="calendar-cell p-sm"><div>29</div></div>
<div class="calendar-cell p-sm"><div>30</div></div>
<div class="calendar-cell p-sm"><div>31</div></div>
<div class="calendar-cell p-sm opacity-40"><div>1</div></div>
<div class="calendar-cell p-sm opacity-40 font-bold"><div>2</div></div>
<div class="calendar-cell p-sm opacity-40 font-bold"><div>3</div></div>
</div>
</div>
</div>
</main>
<!-- Right Utility Sidebar - Updated to Deep Navy -->
<aside class="fixed right-0 top-16 h-[calc(100%-64px)] w-[280px] z-30 bg-deep-navy border-l border-outline-variant/10 flex flex-col py-md px-sm">
<!-- Habit Tracker Section -->
<div class="mb-lg px-xs">
<div class="flex items-center justify-between mb-md">
<h3 class="font-label-md text-label-md text-outline-variant uppercase tracking-wider">Habit Tracker</h3>
<span class="material-symbols-outlined text-outline-variant text-[18px] cursor-pointer">more_horiz</span>
</div>
<div class="space-y-md">
<div>
<div class="flex items-center justify-between mb-xs"><span class="text-[10px] font-bold uppercase tracking-wider text-secondary opacity-70">Deep Work</span></div>
<div class="flex justify-between">
<div class="w-6 h-6 flex items-center justify-center text-secondary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-secondary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-secondary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-secondary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-secondary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
</div>
</div>
<div>
<div class="flex items-center justify-between mb-xs"><span class="text-[10px] font-bold uppercase tracking-wider text-tertiary opacity-70">Meditation</span></div>
<div class="flex justify-between">
<div class="w-6 h-6 flex items-center justify-center text-tertiary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
<div class="w-6 h-6 flex items-center justify-center text-tertiary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
<div class="w-6 h-6 flex items-center justify-center text-tertiary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
</div>
</div>
<div>
<div class="flex items-center justify-between mb-xs"><span class="text-[10px] font-bold uppercase tracking-wider text-primary opacity-70">Reading</span></div>
<div class="flex justify-between">
<div class="w-6 h-6 flex items-center justify-center text-primary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-primary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
<div class="w-6 h-6 flex items-center justify-center text-primary opacity-40"><span class="material-symbols-outlined text-[16px] font-bold">check</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
<div class="w-6 h-6 flex items-center justify-center text-white/20"><span class="material-symbols-outlined text-[16px]">close</span></div>
</div>
</div>
</div>
</div>
<!-- To-Do List -->
<div class="px-xs">
<h3 class="font-label-md text-label-md text-outline-variant mb-md uppercase tracking-wider">Tasks</h3>
<div class="space-y-xs">
<div class="group flex items-start gap-sm p-sm rounded-lg hover:bg-white/5 transition-all cursor-pointer">
<div class="mt-xs h-5 w-5 border-2 border-primary-fixed-dim rounded flex items-center justify-center">
<span class="material-symbols-outlined text-primary-fixed-dim text-[14px] font-bold opacity-0 group-hover:opacity-100">check</span>
</div>
<div>
<p class="font-body-sm text-body-sm text-inverse-on-surface">Finalize Q4 roadmap</p>
<p class="font-label-md text-[10px] text-outline-variant">FocusFlow Project</p>
</div>
</div>
<div class="group flex items-start gap-sm p-sm rounded-lg hover:bg-white/5 transition-all cursor-pointer">
<div class="mt-xs h-5 w-5 border-2 border-outline-variant/30 rounded flex items-center justify-center"></div>
<div>
<p class="font-body-sm text-body-sm text-inverse-on-surface">Client meeting prep</p>
<p class="font-label-md text-[10px] text-outline-variant">Marketing</p>
</div>
</div>
<div class="group flex items-start gap-sm p-sm rounded-lg hover:bg-white/5 transition-all cursor-pointer">
<div class="mt-xs h-5 w-5 border-2 border-primary rounded flex items-center justify-center bg-primary">
<span class="material-symbols-outlined text-on-primary text-[14px] font-bold">check</span>
</div>
<div>
<p class="font-body-sm text-body-sm text-outline-variant line-through opacity-60">Inbox Zero</p>
<p class="font-label-md text-[10px] text-outline-variant">General</p>
</div>
</div>
</div>
</div>
</aside>
</div>
<!-- Floating Action Button -->
<button class="fixed bottom-md right-[300px] w-14 h-14 bg-primary text-on-primary rounded-full shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all z-50">
<span class="material-symbols-outlined text-[32px]">add</span>
</button>
<script>
    // Simple check functionality toggle (visual only)
    document.querySelectorAll('.group .h-5').forEach(checkbox => {
        checkbox.addEventListener('click', function(e) {
            e.stopPropagation();
            const icon = this.querySelector('.material-symbols-outlined');
            if (this.classList.contains('bg-primary')) {
                this.classList.remove('bg-primary');
                if (icon) icon.classList.add('opacity-0');
                this.nextElementSibling.querySelector('p').classList.remove('line-through', 'opacity-60');
            } else {
                this.classList.add('bg-primary');
                if (icon) icon.classList.remove('opacity-0');
                this.nextElementSibling.querySelector('p').classList.add('line-through', 'opacity-60');
            }
        });
    });
</script>
</body></html>

Please structure this as a properly organized React project with clear component separation, prop interfaces, and shared state management.

This should be made with Tauri, React, Tailwind, TSX, 
