# Orchestration — running this handoff across several agents

Yes, this is meant to be parallelized. The work is split into **ten packages** so each agent reads a small slice of the codebase and one design file, instead of one agent holding the whole redesign in context.

## Dependency order

```
Wave 1 (serial, one agent)      00-foundation -> 01-app-shell
Wave 2 (parallel, 6 agents)     02-dashboard  03-todo  04-habits
                                06-settings   07-auth  08-admin
Wave 3 (parallel, 2 agents)     05-add-modal  09-mobile
Wave 4 (serial, one agent)      integration pass
```

**Wave 1 must land and be merged before Wave 2 starts.** Every other package consumes the tokens and the shell it produces; running them concurrently guarantees six conflicting versions of the sidebar.

Wave 3 is separate only because the Add Modal is launched from Dashboard, To-Do and Habits, and the Mobile Dashboard mirrors the desktop one — both are cheaper to build once their parents exist.

## Ground rules for every agent

1. Read **only** your package file, the one design file it names, and the source files it lists. Do not read the other packages or the other designs.
2. Do not touch shared files outside your package's "Files you own" list. If you need a change in the foundation, note it in your report — do not edit it.
3. Import tokens and the shell from Wave 1. Never redeclare a color, a font, or the sidebar.
4. Radius is `0` everywhere. No exceptions.
5. Finish with a short report: files changed, anything you could not match, anything the foundation is missing.

## Branch + merge

One branch per package, named `redesign/<package-id>` (e.g. `redesign/03-todo`). Wave 1 merges to `main` first. Wave 2 and 3 branch off the merged foundation. Because each package owns a disjoint file set, merges should be conflict-free apart from the route table — assign that to the integration agent.

## Keeping each agent's context small

- Each package file is written to be self-sufficient — an agent should not need this file or the other packages.
- Give the agent the design file **path**, not its contents; let it open and read the parts it needs.
- Name the specific source files to read (each package lists them). Discourage repo-wide search.
- One package per session. Start a fresh session for the next one rather than continuing.

## Prompt template

```
You are implementing one package of the Albas UI redesign.

Read design_handoff_albas_redesign/packages/<PACKAGE FILE> and do exactly what it
specifies. The visual source of truth is the design file it names in designs/ —
open it and match it precisely.

Constraints:
- Only modify the files listed under "Files you own".
- Use the tokens and shell components from packages 00 and 01; do not redefine them.
- Border radius is 0 everywhere in this redesign.
- Do not read other package files or other design files.

When done, report: files changed, anything you could not match, anything missing
from the foundation.
```

## Integration pass (Wave 4)

One agent, after everything merges: wire the route table, verify sidebar active states across all pages, check the 768px breakpoint on every screen, confirm focus rings, and delete any duplicated token or shell code that slipped through.

## Back to design

After the code lands, run a repo sync in the design project so the designs pick up what actually shipped and the next round starts from reality rather than the mock.
