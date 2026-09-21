# typescript-ui QA app

**Every run opens a full-screen window on the desktop and holds it until the
run ends. Never start a run, and never leave an agent to start one, without
the user's go-ahead.** Only `runqa.sh` and the host it starts open a window;
the tests, the typecheck and the dev server do not.

## What it is

A private workspace package that measures the library's render performance in
WebKitGTK, the engine Tauri ships on Linux. It mounts one *panel* — a component
built from the library alone — at full viewport, drives it frame by frame or
pass by pass, and records frame times, DOM writes, forced layouts, per-class
work, DOM seam calls and geometry. The page POSTs one JSON report per run to
its own dev server, which writes it under `results/`.

| Path | What it holds |
|---|---|
| `index.html`, `src/main.ts` | The page: runs a measurement under `qa=`, or shows a panel under `panel=` alone. |
| `src/panels.ts`, `src/panels/` | The panel contract and the panels, one file each. |
| `src/builders/` | Shared panel code: data generators, chrome, the shell and form builders, element lookups, the store-view wait and per-instance work counters. |
| `src/mount.ts` | Mounts a panel through `Body.init` and collects its targets. |
| `src/pageTargets.ts` | The `idle`, `theme` and `viewport` targets every panel gets. |
| `src/harness/` | The harness: frame loop, drivers, counters, ablations, probes, the run. It imports nothing from the library; the page hands it `Body` and `DOM`. |
| `vite.config.ts`, `vite/plugins.ts` | The app's own Vite config: the report endpoint and the library-build alias. |
| `runqa.sh` | Runs one measurement end to end. |
| `src-tauri/` | The Tauri host, a minimal Tauri shell that opens the page (see *Tauri host*). |
| `bin/` | `qa-verdict.py`, `qa-table.py`, `qa-forced.py`. |
| `results/`, `logs/` | Run output; created on first run, not committed. |

## Running

Build the library first — the page, the typecheck and the tests all read the
build, not the source:

```sh
npm run build:lib
```

Then, from the repository root:

```sh
packages/qa/runqa.sh [--host <host>] <name> <main|wt> '<query params>'
```

`--host` picks what opens the page; `minibrowser` (the default) is WebKitGTK's
MiniBrowser, found at `QA_MINIBROWSER` (default
`/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser`), and `tauri` is the
app's own Tauri shell (see *Tauri host*). The runner checks the
arguments, the arm's build and the host before it starts anything, so a typo or
a missing program fails at once and leaves nothing running.

The second argument is the *arm* — the library build under test:

- `main` measures `QA_MAIN_LIB`, by default this checkout's `packages/lib`.
- `wt` measures `QA_WT_LIB`, another build to compare against it, such as a
  worktree's `packages/lib`. It is required for this arm.

The runner starts the app's Vite server on port 5190 with `QA_LIB` set to the
arm, opens `http://localhost:5190/?qa=<name>&host=<host>&<query params>`, and
waits for the result — not for a timeout. As soon as a result appears, or the
host exits, it stops the host and Vite and hands the result to
`bin/qa-verdict.py`. `QA_TIMEOUT` (default 120 s) bounds the wait.

| Exit | Meaning |
|---|---|
| 0 | A result without an error; prints its path. |
| 1 | An error result (prints the error), or no result at all (prints `NO RESULT` and the Vite log path in `logs/`). |
| 2 | Bad arguments, no build for the arm, or a host that cannot start; nothing was started. |

**There is no symlink step.** A worktree's `node_modules` is usually a link to
the main tree's, and there `@jimka/typescript-ui` resolves to the main tree's
build, whichever arm you meant. So the app never imports the library through
`node_modules`: its Vite config aliases every exported subpath of the package
to the arm's own `dist/lib` file, derived from that build's `package.json`
`exports`, and fails any import of the package no alias covers. The page, and
every panel on it, hold one instance of the arm's library.

**There is no file-serving step either.** The library's store runs filtering
and sorting in a Web Worker, and each build now carries that worker's source
inside its own chunks and starts it from a `blob:` URL — nothing is requested
from the app serving the page. A two-arm comparison therefore gets each arm's
own worker through the same aliases as the rest of that arm's code, with no
files to serve and no startup check on the build.

To measure a change against its base in one session, build the base as a
comparison arm in a worktree — the recipe in
[00-baseline.md](../../plans/research/render-review-2026-09-15/00-baseline.md#L188).
That recipe also links `packages/lib/node_modules`; with today's hoisted
install the main tree's holds only Vite's cache, so link it only if it holds
packages:

```sh
git worktree add .worktrees/_arm <base-sha> --detach
ln -sfn "$PWD/node_modules" .worktrees/_arm/node_modules
(cd .worktrees/_arm/packages/lib && npm run build:lib)
export QA_WT_LIB="$PWD/.worktrees/_arm/packages/lib"
```

Rebuild every arm before a sweep: the alias serves whatever `dist/lib` holds,
and the report's `build` names a path, not a commit.

If a run ends in `NO RESULT`, look in `logs/vite-<name>.log` for
`optimized dependencies changed. reloading` — Vite found a dependency after the
page loaded and reloaded it mid-run — and run it again.

## Tauri host

`src-tauri/` is a minimal Tauri 2 shell, `qa-host`, that lets every panel be
measured in a Tauri window as well as in MiniBrowser. It opens one full-screen
window on the URL given as its only argument and adds nothing of its own: no
plugins, no commands, no capabilities, no frontend. The window loads the same
dev-server URL MiniBrowser loads, so the page, the harness, the panels and the
report are the same under both hosts. It exits 2 without opening a window
unless given exactly one http or https URL.

Tauri still injects its own init scripts into the page. They define
`window.isTauri`, `window.__TAURI_INTERNALS__` (with an `invoke` function) and
wry's `window.ipc`, and add two listeners on `document`: a `mousedown`
listener that acts only on `data-tauri-drag-region` elements, which the
library never marks, and, in the debug build the runner uses, a `keydown`
listener for the devtools shortcut, Ctrl+Shift+I. There is no
`window.__TAURI__`, since `withGlobalTauri` is off. The page comes from the
dev server rather than from Tauri, so Tauri treats it as remote content, and
with no capability granted it refuses every command the page could invoke.
None of this writes to the DOM, so it leaves a panel's census alone, but it is
one more way the two hosts differ.

Build it once, from the repository root:

```sh
cargo build --manifest-path packages/qa/src-tauri/Cargo.toml
```

This needs Rust and the WebKitGTK development package (`webkit2gtk-4.1`). The
first build compiles Tauri and its GTK bindings, several minutes; building
opens no window. Rebuild only after editing `src-tauri/`, never for a page or
panel change: the page loads from the dev server at run time. The Tauri CLI is
not needed; a plain `cargo build` embeds no frontend and needs none.

Then run with `--host tauri`:

```sh
packages/qa/runqa.sh --host tauri <name> <main|wt> '<query params>'
```

The runner starts `QA_TAURI_BIN` (default
`packages/qa/src-tauri/target/debug/qa-host`) on the run's URL and stops it as
it stops MiniBrowser; everything else about the run is the same. A missing
binary exits 2 before anything starts, with the build command. Starting
`qa-host` yourself opens a full-screen window too.

The build lives in the checkout's own `src-tauri/target/`, about 2.9 GB, so
each worktree that runs `--host tauri` needs its own build, unless
`QA_TAURI_BIN` points at an existing binary, such as the main tree's. The
binary holds nothing specific to a checkout; the page it loads is the arm's.

The host is Linux only, like the runner. There Tauri renders through
WebKitGTK, the same `webkit2gtk-4.1` library MiniBrowser uses; on Windows the
same shell would run WebView2 (Chromium), and on macOS WKWebView, so it would
measure a different engine.

The runner sets no `WEBKIT_*` environment variable for either host. A variable
that changes WebKit's rendering path changes what is measured, so if one is
ever needed to get a window, every arm of a comparison must carry it, and the
sweep's notes must say so.

## Looking at a panel

```sh
npm -w packages/qa run dev
```

then open `http://localhost:5190/?panel=<id>` (add `n=<scale>` for another
scale). The page mounts the panel and measures nothing. This opens no window by
itself; the browser is yours.

The package's own checks need the built library too:

```sh
npm -w packages/qa run typecheck
npm -w packages/qa run test
```

## URL parameters

| Parameter | Meaning | Default |
|---|---|---|
| `qa=<name>` | run, and report under this name; without it no measurement runs | — |
| `panel=<id>` | panel to mount | the only panel; an error when there are several |
| `n=<scale>` | the panel's scale | the panel's `defaultScale` |
| `drive=<driver>[:<units>][,…]` | phases, in order | the panel's `defaultDrive`, read with the same grammar |
| `frames=<n>` | units for a phase given without `:<units>` | 150 |
| `step=<px>` | pixels per unit for `drag`, `resize`, `hover`, `park` and `pan` | 3 |
| `count=1` | native write counters and the forced-layout detector | off |
| `deepwrites=1` | also count camelCase style assignments (needs `count=1`) | off |
| `work=1` | per-class work counters | off |
| `seam=1` | DOM seam counters | off |
| `geom=1` | geometry probe, every unit | off |
| `abl=<a>[,<b>…]` | ablations to apply | none |
| `css=<css>` | extra stylesheet injected before measuring | none |
| `host=<host>` | recorded in the report; the runner sets it | none |
| `grip=`, `hover=`, `wheel=`, `toggle=`, `update=`, `passes=`, `type=`, `click=` | which element or which mutation a panel gives a driver (see the panel table); a value the panel does not list fails the run | the panel's first listed value |

A *phase* is one driver run over a number of *units*: one animation frame for a
frame driver, one layout pass for `passes`. A `:<units>` count must be a
positive integer written in digits. The counters reset for every phase.

A run mounts the panel, checks the phases (an unknown driver or a missing
target fails here, before anything is instrumented), installs the requested
instruments — write counters, stylesheet, ablations, work counters, seam
counters, in that order — snapshots the page into `before`, measures 60 idle
frames, drives each phase, measures 30 idle frames, and POSTs the report. A
failure anywhere, a throw inside the frame loop included, posts an error report
instead.

## Panels

A panel is a file `src/panels/<id>.ts`; the file is its registration and its
basename is its id. It exports exactly these four names:

| Export | What it is |
|---|---|
| `description` | What the panel builds; for a rebuilt outside behaviour, the source and the symptom. |
| `defaultScale` | A positive integer, used when the URL has no `n=`. |
| `defaultDrive` | The `drive=` value used when the URL has none, e.g. `resize` or `drag,wheel:120`; `''` runs no phase. |
| `build(n, params)` | Builds the panel at scale `n`; `params` is the page's URL parameters, for choosing among targets. A panel that reads none declares `build(n)`. |

`build` returns a `PanelBuild` (see `src/panels.ts`):

- `root` — mounted alone at full viewport through `Body.init` and `Fit`.
- `targets` — driver name → what that driver acts on. Every driver the panel's
  default drive names needs a target, here, from `afterMount` or from the
  page-wide targets.
- `afterMount(tools)` — optional; runs once the root has painted and settled,
  and returns more targets, merged over `targets`. Elements that layout creates,
  such as `Split`'s gutters, exist only then. It may return a promise of the
  targets instead, which the mount awaits before it settles again: a
  store-backed panel waits there for its view (see *A store-backed panel waits
  for its view*), and `diagram-graph` waits for ELK to lay the graph out, since
  a census taken before either would measure an empty view.
- `geometry` — optional; label → a CSS selector or a component, sampled under
  `geom=1`.
- `describe()` — optional; host fields, stored under `before.host`.
- `installWork(tools)` — optional; the panel's own work counters, installed
  under `work=1` after the harness's (`tools.countMethod` wraps a method).

To add a panel, add its file; the lazy registry finds it, and the page loads
only the measured panel's modules.

**Page-wide targets.** Every panel also gets an `idle`, a `theme` and a
`viewport` target: `mountPanel` merges `pageTargets(root)` from
`src/pageTargets.ts` under the panel's own targets, so the merge is the
page-wide targets, then `targets`, then `afterMount`'s. The target of `idle`
and of `viewport` is the root, which both drivers ignore; every page has
viewport listeners, `Body`'s at least, so any panel can be driven with
`viewport`. `theme`'s is `themeTarget(THEME_CYCLE)`, which switches between
`DarkTheme` and `ModernTheme` and restores the theme the page started with. A
panel replaces any of them by giving its own entry, such as
`theme: themeTarget([DarkTheme])` for a shorter cycle.

**A store-backed panel waits for its view.** A store of 1,000 records or more
builds its filtered, sorted view on a worker, and holds its `load` event until
the worker answers, so right after `build()` the view is empty and the table,
tree table or list over it has no rows. A panel that reads its store, selects a
record or looks up a cell therefore does so in `afterMount`, after
`await awaitStoreView(tools, store, '<panel>')` from `src/builders/store.ts`;
the wait resolves on the store's `load`, waits three frames for the rows to
render, and fails with the panel's name rather than hanging if no view arrives.
Without it a panel is measured on an empty component and says nothing — and
jsdom has no worker, so no test in `tests/` can catch that; `tests/store.test.ts`
pins the contract instead.

**A panel id fixes the component tree.** URL parameters such as `grip=` only
choose which element or which mutation a driver gets, so every run of one
panel id lays out the same tree, and the `panel` column says what was
compared. Two trees are two panel ids, built by one shared builder, as
`shell-deep` and `shell-shallow` are, and `form-flat` and `form-nested`.

**The import rule.** A panel imports `@jimka/typescript-ui/*` and files inside
`packages/qa/src`, nothing else — never a docs demo or a lib demo-app panel. A
baseline must move only when the library moves, and a demo changes for
documentation reasons. Shared panel code lives in `src/builders/`: the data
generators, the chrome (menu bar, toolbar, status bar and file-tree renderer),
the shell and form builders, element lookups, the store-view wait and
per-instance work counters.
`tests/panels.test.ts` checks every panel's imports.

**Panel data is deterministic.** Every generator in `src/builders/data.ts` is
a pure function of its arguments, with no random numbers and no clock, so two
arms of a comparison render the same content, and a census that depends on the
data, such as a chart's tick count, can be reproduced.

**The symptom rule.** When a behaviour spotted in another app is rebuilt as a
panel, its `description` names the source and the symptom, and the table below
records it as reproduced only after a run shows that symptom — the same count,
the same failure or the same geometry. A panel built to look like another
app's screen can easily exercise a different code path.

Every panel also has the page-wide `idle`, `theme` and `viewport` targets.
The *Reproduces* column gives the figure a run must show — M5–M14 in the
panels plan, M16–M26 in the editors and overlays plan — before the *Validated*
entry is filled in. A figure marked *from the report* comes from the slice
report and was not re-measured before the panel was built.

| Panel | Builds | Drivers and parameters | Geometry | Reproduces | Validated |
|---|---|---|---|---|---|
| `chart-line` | A 3-series `LineChart`, legend and point markers on. `n`: points per series (default 50). | `resize` (default), `passes`, `update` (swaps two data sets), `hover` (the chart) | `chart` | Slice 26 F26.1: a chart rebuilds every SVG mark per layout pass — at `n = 50`, 1,081 sink calls (`apply` 241, `createElementNS`, `appendChild`, `removeChild` and `release` 210 each) and 12 `measureText` calls per unchanged pass. | `minibrowser`: 2026-09-20, lib `608544c9` (`val-pass-main`) — the census exactly, at 8.0 ms per pass over 236 elements.<br>`tauri`: 2026-09-20, lib `608544c9` (`ta-pass`, `ta-resize-a`) — the same census exactly, at 8.6 ms per pass (p90 12) and 73.7 ms per resize unit (p90 92). |
| `chart-dashboard` | A `Split` of a 2×2 grid of store-backed `LineChart`s, 3 series each, beside two grouped `BarChart`s. `n`: points per line series (default 200). | `resize` (default), `passes` (the grid), `drag` (the split's gutter), `update` (moves one point), `hover` (the first line chart) | `grid`, `chart0`–`chart3`, `bars` | M12, slice 26 F26.1 and F26.2: at `n=50`, `passes` with `seam=1` gives `seam.sink.createElementNS` 840 (4 × 210) and `seam.source.measureText` 48 (4 × 12). | `minibrowser`: 2026-09-20, lib `608544c9` (`val-charts`) — M12 exactly: `createElementNS` 840 and `measureText` 48, in 4,329 sink calls at 25.1 ms per pass over 1,112 elements.<br>`tauri`: 2026-09-20, lib `608544c9` (`ta-charts`) — M12 exactly, the same 4,329 sink calls, at 26.5 ms per pass (p90 34). |
| `shell-deep` | **S1 stand-in.** A menu bar; an explorer `Accordion` (open file tree, open outline, closed history) beside a `Dock` of 2×2 regions of `CodeEditor`s under a toolbar; a status bar. `n`: tabs per region (default 1, four editors). | `drag,wheel:120` (default), `resize`, `passes`, `hover`, `park` (the explorer gutter), `type` (the first painted editor), `toggle`. `grip=` `dock-h`, `dock-v`, `sidebar`, `section`, `tab`; `hover=` `toolbar`, `menubar`, `tabs`; `wheel=` `tree`, `editor`; `toggle=` `section` (the closed History section), `pane` (the explorer pane's collapse) | `sidebar`, `files`, `outline`, `history`, `main`, `dock`, `editor0`–`editor3` | M5, slice 06 F06.3: `park` with `work=1&geom=1` gives `sidebar.doLayout` and `main.doLayout` 1.00 ±0.02 per unit, `geometry.sidebar` the same in every unit. M6, slice 08 F08.3: `drag` with `grip=sidebar&work=1` gives `history.doLayout` 1.00 ±0.02 and `history.getPreferredSize` at least 1.00. M7, slice 23 F23.1 (C7): `theme:4` grows the note's rule total by about 51 × 4 × `before.host.editorViews`. | `minibrowser`: 2026-09-20, lib `608544c9` — **S1 stand-in baseline**, at `n=1` over 2,484 elements: `park` (`val-sdeep-park`) 20.5 ms per unit, `sidebar.doLayout` and `main.doLayout` 0.99, the sidebar at 8,41,160,1999 in all 150 units; `drag` with `grip=sidebar` (`val-sdeep-drag`) 84.6 ms per unit, `history.doLayout` and `history.getPreferredSize` 1.00; `theme:4` (`val-sdeep-theme`) 206.0 ms per switch, 517 → 1,333 rules, which is 51 × 4 editor views × 4 switches exactly. Re-verified on 2026-09-20 against lib `2df6a50d`, current `master`, in a same-session A/B (`tr-*`, old-new-old): census, counters and rectangles identical and the times inside the old arm's own bracket, so these numbers still describe `master` after the tree-reveal merge rewrote `Tree`.<br>`tauri`: 2026-09-20, lib `608544c9` — **S1 stand-in baseline**, the same counters, rectangles and rule growth as MiniBrowser to the digit: `park` 9.4 ms per unit (p90 14), `drag` with `grip=sidebar` 64.5 ms (p90 71), `theme:4` 179.7 ms per switch (p90 197). |
| `shell-shallow` | **S3 stand-in.** `shell-deep`'s chrome and explorer around a `Dock` of one region. `n`: tabs (default 1, one editor). | As `shell-deep`, but `grip=` `sidebar`, `section` and `hover=` `toolbar`, `menubar` | As `shell-deep`, with `editor0` only | M5–M7, as for `shell-deep`. | `minibrowser`: 2026-09-20, lib `608544c9` — **S3 stand-in baseline**, at `n=1` over 1,618 elements: `park` (`val-sshal-park`) 9.2 ms per unit, `sidebar.doLayout` and `main.doLayout` 0.99, the sidebar at 8,41,160,1999 in all 150 units; `drag` with `grip=sidebar` (`val-sshal-drag`) 67.3 ms per unit, `history.doLayout` and `history.getPreferredSize` 1.00; `theme:4` (`val-sshal-theme`) 147.7 ms per switch, 325 → 529 rules, which is 51 × 1 editor view × 4 switches exactly. Re-verified on 2026-09-20 against lib `2df6a50d`, current `master`, in a same-session A/B (`tr-*`, old-new-old): census, counters and rectangles identical and the times inside the old arm's own bracket, so these numbers still describe `master` after the tree-reveal merge rewrote `Tree`.<br>`tauri`: 2026-09-20, lib `608544c9` — **S3 stand-in baseline**, likewise identical in counters, rectangles and rule growth: `park` 10.3 ms per unit (p90 17), `drag` with `grip=sidebar` 57.9 ms (p90 67), `theme:4` 132.0 ms per switch (p90 144). |
| `table-rows` | A `Table` over a 12-field model with every cell type, the filter row shown. `n`: rows (default 10,000). | `wheel` (default), `resize`, `passes`, `key` (ArrowDown and ArrowUp on the body), `update`, `drag` (the first column's edge), `click` (sorts by `name`). `update=` `record` (one visible row's score), `filter` (the department filter) | `table`, `header`, `body` | M8, slice 19 F19.2: `key` with `work=1` gives `getVisibleRecords@TableBody` 6.00 per unit. | `minibrowser`: 2026-09-20, lib `608544c9` (`val-table`) — M8 exactly: `getVisibleRecords@TableBody` 6.00 per `key` unit at 10,000 rows, 21.4 ms per unit over 4,766 elements.<br>`tauri`: 2026-09-20, lib `608544c9` (`ta-table`) — M8 exactly, `getVisibleRecords@TableBody` 6.00, at 20.8 ms per `key` unit (p90 23).<br>**Store-worker fix confirmed in-engine**: 2026-09-20, `master` `5a46ff52` (`store-worker-verify`, MiniBrowser) — the panel mounts and scrolls with the same 4,766-element census as the baseline above, so the inlined `blob:` worker boots and the 10,000-record store builds its view. This is the one claim in `store-worker-fail-safe` that no offline test could settle. |
| `treetable-rows` | A `TreeTable` of folders, each with 3 subfolders of 3 files: 13 rows per root. `n`: root folders (default 200, 2,600 rows). | `toggle` (default: collapse all, then expand all), `resize`, `passes`, `wheel`, `key` (ArrowDown and ArrowUp), `update` (one row's size), `click` (a size cell) | `table`, `header`, `body` | M9, slice 22 F22.5: `key` with `work=1` gives `getVisibleRecords@TreeBody` 6.00. F22.3 (C10): `toggle` with `seam=1` gives `ensureStyleRule`, `setRuleStyles`, `createElement` and `removeElement` equal — one caret minted and one detached per visible branch row — and no `deleteStyleRule` in that path; the deletes a long phase shows follow elapsed time, not toggles. | `minibrowser`: 2026-09-20, lib `608544c9` (`val-treetable`, `c10-probe`) — M9 exactly: `getVisibleRecords@TreeBody` 6.00 per `key` unit at 200 roots, 16.6 ms per unit over 1,699 elements; `toggle`'s four glyph-swap counters 70.5 each at 201.2 ms per unit, with `deleteStyleRule` absent over 2 units and 55.7 over 20 — the collector, not the swap. C10 is unfixed and its leak is GC-bounded; see the panels plan's M9.<br>`tauri`: 2026-09-20, lib `608544c9` (`ta-treetable`) — M9 exactly, the same 6.00 and the same four swap counters at 70.5, at 17.0 ms per `key` unit (p90 17) and 196.1 ms per `toggle` (p90 227). The C10 probe was run under MiniBrowser only. |
| `tree-nodes` | A fully expanded `Tree` of folders of 5 files each, with the explorer's icon renderer. `n`: folders (default 300, 1,800 nodes). | `key` (default: ArrowLeft and ArrowRight collapse and expand the first folder), `passes`, `resize`, `wheel` | `tree` | M10, slice 18 F18.6: `passes` with `work=1` gives `setStyleState@TreeRow` = 2 × `before.host.treeRows`. F18.4: `key` with `seam=1` gives `ensureStyleRule`, `setRuleStyles` and `deleteStyleRule` 1.50 each. | `minibrowser`: 2026-09-20, lib `608544c9` (`val-tree`) — M10 exactly: `setStyleState@TreeRow` 186 per pass at 93 tree rows, and `ensureStyleRule`, `setRuleStyles` and `deleteStyleRule` 1.50 each per `key` unit, at 96.0 ms per unit over 632 elements. Re-verified on 2026-09-20 against lib `2df6a50d`, current `master`, in a same-session A/B (`tr-*`, old-new-old): census, counters and rectangles identical and the times inside the old arm's own bracket, so these numbers still describe `master` after the tree-reveal merge rewrote `Tree`.<br>`tauri`: 2026-09-20, lib `608544c9` (`ta-tree`) — M10 exactly, the same 186 and 1.50s, at 0.3 ms per pass and 91.9 ms per `key` unit (p90 96). |
| `list-items` | A `List` over a store. `n`: items (default 300). | `key` (default: ArrowDown and ArrowUp), `passes`, `resize` | `list` | M11, slice 18 F18.2: `passes` with `seam=1` gives `seam.sink.apply` 908 — the 906 rows of the offline census plus the engine's overlay scroller. F18.1: `key` with `seam=1` gives `apply` 603 and `dispatchCustomEvent` 1. | `minibrowser`: 2026-09-20, lib `608544c9` (`val-list`) — M11 with `passes` at 908 instead of 906 (see the panels plan's M11): `apply` 908 per pass at 3.1 ms, and `apply` 603 with `dispatchCustomEvent` 1 per `key` unit at 16.9 ms, over 932 elements.<br>`tauri`: 2026-09-20, lib `608544c9` (`ta-list`) — M11 exactly, the same 908 and 603 with `dispatchCustomEvent` 1, at 3.1 ms per pass and 16.9 ms per `key` unit (p90 17). |
| `markdown-doc` | A `MarkdownViewer` of a document with bullet lists, TypeScript fences and tables, beside a side header in a `Split`. `n`: sections (default 60). | `drag` (default: the split's gutter), `passes` (the viewer), `resize`, `update` (swaps two versions of the document), `wheel` (the first paragraph) | `side`, `viewer` | M13, slice 25 F25.3: `passes` with `seam=1` gives `seam.source.getElementRect` 2.00. F23.1 (C7): `theme:4` grows the note's rule total by about 51 × 4 × `before.host.editorViews`; fences become editors only near the viewport, so that count depends on the screen. | `minibrowser`: 2026-09-20, lib `608544c9` (`val-markdown`) — M13 exactly: `getElementRect` 2.00 per pass at 1.5 ms, and `theme:4` 494 → 1,514 rules, which is 51 × the 5 editor views the screen upgraded × 4 switches, at 157.0 ms per switch over 1,189 elements.<br>`tauri`: 2026-09-20, lib `608544c9` (`ta-markdown`) — M13 exactly, the same `getElementRect` 2.00 per pass and 494 → 1,514 rules, at 1.0 ms per pass and 108.3 ms per switch (p90 111). Its `theme` phase reads a little more than MiniBrowser's (`getElementRect` 2.25 against 1.50, `getScrollMetrics` 7.75 against 7.50, plus `getOffsetSize` 0.25 and `querySelector` 0.50 MiniBrowser never records); no checked figure is among them. |
| `canvas-idle` | `WebGLCanvas`es whose 2D context is taken before they ask for a WebGL2 one, so the engine refuses it, and 2D `Canvas`es started while shown and then moved under an already-hidden panel; none of them drawing anything. `n`: surfaces per group (default 4). | `idle` (default) | `shown` | M14, slice 26 F26.7 (C35) and F26.8 (C36), both fixed: `before.host.webglContexts` = 0 with `webglAnimating` = 0, and `hiddenStarted` = 4 with `hiddenAnimating` = 0; `idle` with `seam=1` gives `seam.sink.requestAnimationFrame` = `webglAnimating` + `hiddenAnimating` ±0.05, so 0 per idle unit. | pre-fix: `minibrowser`: 2026-09-20, lib `608544c9` (`val-canvas`) — M14 exactly: `webglContexts` 0 with `webglAnimating` 4, `hiddenStarted` and `hiddenAnimating` 4, and `requestAnimationFrame` 8 per idle unit, their sum. The sweep's first run showed neither symptom, and rebuilding the panel for both is what this run confirms; see the panels plan's M14.<br>pre-fix: `tauri`: 2026-09-20, lib `608544c9` (`ta-canvas`) — M14 exactly: 0, 4, 4, 4 and `requestAnimationFrame` 8, at 16.9 ms per idle frame (p90 17). Its `getContext` reads 1.8 per unit against MiniBrowser's 1.9, a read counter no check names. |
| `diagram-graph` | A `DiagramView` of an ELK-layered three-way tree at zoom 1, under a toolbar of zoom buttons. `n`: nodes (default 400). | `click` (default: the empty node layer behind the nodes), `resize`, `passes` (the view), `pan` (the node layer, along x), `wheel` (the node layer), `hover` (the view). Its `afterMount` waits for the layout. | `view` | M16, slice 27 F27.2: `click` with `seam=1` gives `seam.source.getElementById` + `seam.source.contains` = 802 (2n + 2) — one lookup per node per pass, whatever the screen. The split follows the nodes that have ever rendered an element, which `before.host.nodeElements` (the nodes attached now) only bounds from below, so the total is what this checks. M17, F27.1: `pan` with `seam=1` gives `seam.sink.setRuleStyles` 1.00. M18, F27.3: `wheel:10` with `work=1` gives `setResidency@DiagramEdgeLayer` 1.00. | `minibrowser`: 2026-09-20, lib `608544c9` (`val-diagram`) — M16's total exactly: `getElementById` 324 + `contains` 478 = 802 per click at `n=400`, 58.4 ms per unit. The split resolves to 238 scanned nodes against the census's 135 attached ones, and the clause deriving it from `nodeElements` was wrong, not the census; see the editors and overlays plan's M16. M17 exactly: `setRuleStyles` 1.00 per `pan` unit at 56.6 ms. M18 exactly: `setResidency@DiagramEdgeLayer` 1.00 per `wheel` unit at 66.1 ms. Over 633 elements.<br>`tauri`: 2026-09-20, lib `608544c9` (`ta-diagram`) — M16, M17 and M18 again, the same 324 + 478 = 802, the same `setRuleStyles` 1.00 and the same `setResidency@DiagramEdgeLayer` 1.00, at 55.9 ms per click (p90 84), 56.7 ms per `pan` unit (p90 82) and 63.4 ms per `wheel` unit (p90 91). |
| `code-document` | One `CodeEditor` of JavaScript under a toolbar of ten buttons, over a status `Text` updated on every cursor change, beside an outline header in a `Split`. `n`: lines (default 2,000). | `wheel` (default: the editor's scroller), `resize`, `passes` (the editor), `drag` (the split's gutter), `type` and `key` (ArrowDown and ArrowUp) on the editor's content | `editor`, `status` | None recorded: the single-editor partner of the shells. | `minibrowser`: 2026-09-20, lib `608544c9` (`shk-codedoc`) — **baseline**, at `n=2,000` over 644 elements, per unit: `passes` 0.0 ms, `type` 55.0 ms, `drag` 56.0 ms, `resize` 57.1 ms, `wheel` 53.4 ms and `key` 57.5 ms, against 9.3 ms idle frames. No error, and a rectangle for `editor` and `status` in every unit.<br>`tauri`: 2026-09-20, lib `608544c9` (`ta-codedoc`) — **baseline**, the same rectangles in every unit, per unit: `passes` 0.0 ms, `type` 56.0 ms (p90 71), `drag` 49.1 ms (p90 54), `resize` 55.2 ms (p90 69), `wheel` 56.7 ms (p90 83) and `key` 60.1 ms (p90 84), against 9.8 ms idle frames. |
| `markdown-editor` | A `MarkdownDocumentPanel` over a status line, beside a `Markdown` preview re-rendered on every change, in a `Split`. `n`: sections (default 60, about 9 KB). | `call` (default: moves the caret in the first paragraph, a commit that changes only the selection), `resize`, `passes`, `update` (swaps two versions of the document), `type` and `wheel` (the editable element), `drag` (the split's gutter) | `editor`, `viewer` | M19, slice 24 F24.1: `call` and `type`, each with `work=1`, give `handleChange@MarkdownEditor` 1.00. A caret move commits on `selectionchange`, a task after its unit, so read the phase's average, not one unit. | `minibrowser`: 2026-09-20, lib `608544c9` (`val-mdedit`) — M19: `handleChange@MarkdownEditor` 1.00 per `type` unit exactly, and 0.97 per `call` unit — 39 commits over 40 caret moves, the fortieth landing after the phase, which is the `selectionchange` lag this row names. 68.0 ms per typed character and 15.3 ms per caret move, over 1,617 elements at `n=60` (10,459 characters).<br>`tauri`: 2026-09-20, lib `608544c9` (`ta-mdedit`) — M19 again, the same `handleChange@MarkdownEditor` 1.00 per `type` unit and 0.97 per `call` unit, at 64.4 ms per typed character (p90 108) and 15.5 ms per caret move (p90 34). |
| `windows` | `n` floating `Window`s of a four-field form, the last ⌊n/2⌋ minimized, a bare `Window`, one with insets (4, 12, 4, 4) and an always-on-top one overlapping the cascade, over a toolbar, with one persistent toast. `n`: windows (default 8). | `viewport` (default), `passes` (the bare window), `hover` (window 0), `drag` (window 0), `click` (the open windows' headers, raising each), `toggle` (opens a six-field `Dialog`, then closes it, every 30 units). `grip=` `header` (a move), `edge` (the east strip, a resize) | `win0`, `bare`, `pinned` (the always-on-top window), `southStrip` (the insets window's south strip) | M20, slice 09 F09.11: `drag` counts its own press and release, so run `drive=drag:40,drag:80&grip=header&seam=1`; for `seam.sink.apply` and `seam.source.getViewportSize`, (80 × the second phase's value − 40 × the first's) / 40 = 1.00. M21, F09.4: `passes` with `seam=1` gives `seam.sink.apply` 38.00 and no `setRuleStyles`. M22, F09.6: `viewport` with `seam=1` gives `seam.source.getViewportSize` at least 16 (`before.host.minimized`²); the rest comes from the page's other viewport listeners. C25 (fixed): with `geom=1`, every `geometry.southStrip` sample is 4 px tall, the bottom inset; it was 12, the right inset, before the fix. | `minibrowser`: 2026-09-20, lib `608544c9` (`val-win`, `shk-windows`, `shk-win-edge`) — M20: the two-phase difference gives `seam.sink.apply` 1.01 and `seam.source.getViewportSize` 1.00 per header move, at 27.7 and 27.1 ms per unit. M21 exactly: `apply` 38.00 per settled pass at 0.4 ms, and no `setRuleStyles`. M22: `getViewportSize` 23 per resize event — the 16 of `minimized`² plus 7 from the page's other listeners — beside `getThemeVar` 16 and `apply` 1,118, at 18.3 ms. C25 holds: `geometry.southStrip` is 12 px tall in every unit of all 11 geometry phases of the three runs. Over 583 elements at `n=8`.<br>`tauri`: 2026-09-20, lib `608544c9` (`ta-win`) — M20, M21 and M22 again, every counter where MiniBrowser put it, and C25's `southStrip` 12 px in every unit of all four geometry phases, at 28.9 and 27.7 ms per header-move unit (p90 33 and 32), 0.4 ms per settled pass (p90 1) and 17.3 ms per resize event (p90 17). `shk-windows` and `shk-win-edge` were run under MiniBrowser only. |
| `form-flat` | `n` fields cycling eight kinds — a `TextField` in a `FieldDecorator` that checks it on every change, a `ComboBox` over 20 options, `DateField`, `TimeField`, `NumberSpinner`, `Checkbox`, `Toggle` and `Slider` — in one two-column `LabeledGrid`, under a one-column `LabeledGrid` of eight `TextField`s, in a scrolling panel. `n`: fields (default 64). | `passes` (default), `resize`, `hover` (the header grid, along y), `wheel` (the scrolling panel), `pan` (the first slider), `click`, `type`. `passes=` `form`, `header`, `date` (the first `DateField`), `combo` (the first `ComboBox`); `type=` `text` (the first decorated field), `date` (types `2026-09-19` into the first `DateField`); `click=` `toggle` (the first toggle and checkbox), `combo` (opens and closes the first combo box on alternate units; give it an even count). A kind the first `n` fields lack gives its target none: a slider needs `n` ≥ 8. | `header`, `form` | M23, slice 28 F28.10: `passes` with `passes=header&work=1` gives `getPreferredSize@…`, `getMinSize@…` and `getMaxSize@…` summing to 160. M24, slice 17 F17.1: `passes` with `passes=date&work=1&seam=1` gives `seam.sink.apply` 12, `doLayout@…` summing to 10 and the three size-hint families to 125. M25, slice 16 F16.3: `passes` with `passes=combo&seam=1` gives `seam.sink.apply` 7. C23: `type` with `type=date&seam=1` gives `seam.sink.setRuleStyles` above 0, and 0 once fixed. | `minibrowser`: 2026-09-20, lib `608544c9` (`val-form-flat`, `val-form-date`, `val-form-combo`, `shk-form-date`) — M23 exactly: 48 preferred + 64 min + 48 max = 160 size queries per header pass, at 0.2 ms. M24 with `apply` 12 instead of the 8 re-measured offline (see the editors and overlays plan's M24), `doLayout` 10 and the size hints 125 both exact, at 0.3 ms per `DateField` pass. M25 exactly: `apply` 7 per `ComboBox` pass at 0.1 ms. C23 shows: 4 `setRuleStyles` over the ten characters of `2026-09-19`, where slice 17 recorded six. Over 556 elements at `n=64`.<br>`tauri`: 2026-09-20, lib `608544c9` (`ta-form-flat`, `ta-form-date`, `ta-form-combo`) — M23, M24 and M25 again, the same 160 size queries, the same `apply` 12 with `doLayout` 10 and the size hints 125, and the same `apply` 7, at 0.2, 0.3 and 0.1 ms per pass (p90 1 each). C23's `type=date` run was made under MiniBrowser only. |
| `form-nested` | `form-flat`'s header and fields, the fields in two-column `LabeledFieldSet`s of eight in the scrolling panel, beside an inspector `Table` whose value column takes a cell type per row, in a `Split`. `n`: fields (default 64). | As `form-flat` | `header`, `form`, `inspector` | M23–M25 and C23, as for `form-flat`; M23's header grid is the same in both, so its sum is 160 in both. | `minibrowser`: 2026-09-20, lib `608544c9` (`val-form-nest`, `shk-formnest`, `shk-form-combo`) — M23 exactly, the same 160 per header pass as `form-flat`, at 0.2 ms. M24, M25 and C23 were measured on `form-flat`, which builds the same fields, and were not run here. Over 744 elements at `n=64`; the shakedown's `click=combo` costs `apply` 210.7 and `measureText` 10 per open-and-close unit at 70.2 ms.<br>`tauri`: 2026-09-20, lib `608544c9` (`ta-form-nest`) — M23 again, the same 160 per header pass, at 0.2 ms (p90 1). M24, M25 and C23 were measured on `form-flat` here too, and the shakedown's `click=combo` under MiniBrowser only. |
| `menus` | A menu bar and a toolbar around a header, and a rebuild-mode context `Menu` of `n` rows, opened once and closed after mounting, so every measured open is a re-open. `n`: rows (default 12). | `toggle` (default: opens the menu on even units, closes it on odd ones), `hover` (the menu bar), `click` (the first menu-bar button, opening and closing its menu) | `menubar`, `menubarButton` (selectors; the first match) | M26, slice 12 F12.3: `toggle` with `seam=1` gives, per unit, `sink/u` 456.68, `ensureStyleRule` 6, `setRuleStyles` 7, `deleteStyleRule` 6, `measureTexts` 0.5 and no `measureText`. C24 (fixed): with `geom=1`, `geometry.menubarButton` stops 1 px above the bar's bottom edge, on the border the bar now reserves; against a pre-fix arm, `geom` `DIFF` on that label only. | `minibrowser`: 2026-09-20, lib `608544c9` (`val-menus`, `shk-menus`) — M26 with `sink/u` 456.68 instead of the 412 derived offline (see the panels plan's M26): `ensureStyleRule` 6, `setRuleStyles` 7.03, `deleteStyleRule` 6, `measureTexts` 0.5 and no `measureText`, every one where the census put it, so the whole 44.68 sits in `apply`, measured 338.2. 35.8 ms per open-or-close unit over 133 elements at `n=12`. C24 shows: `menubarButton` is 4,4,39,28 inside a `menubar` of 4,4,5112,28 — the same bottom edge, the bar's border included.<br>`tauri`: 2026-09-20, lib `608544c9` (`ta-menus`) — M26 again, the same `sink/u` 456.68 with `apply` 338.2, the same rule counters 6, 7.03 and 6, `measureTexts` 0.5 and no `measureText`, and C24's same two rectangles, at 36.8 ms per open-or-close unit (p90 69). |
| `table-wide` | A `Table` over an id and 40 numeric columns, each at least 120 px wide, so it scrolls sideways. `n`: rows (default 2,000). | `hwheel` (default), `wheel`, `key` (ArrowRight and ArrowLeft on the body), `passes`, `resize` | `header`, `body` | None recorded: the horizontal counterpart of `table-rows`. | `minibrowser`: 2026-09-20, lib `608544c9` (`shk-wide`) — **baseline**, at `n=2,000` over 41 columns and 13,768 elements, per unit: `hwheel` 17.2 ms, `passes` 2.4 ms, `wheel` 119.8 ms, `resize` 183.5 ms and `key` 324.6 ms, against 17.2 ms idle frames. This is the run made after the store-view fix; every `table-wide` run before it is void.<br>`tauri`: 2026-09-20, lib `608544c9` (`ta-wide`) — **baseline**, the same rectangles in every unit, per unit: `hwheel` 17.0 ms (p90 17), `passes` 2.3 ms (p90 4), `wheel` 117.8 ms (p90 121), `resize` 177.0 ms (p90 181) and `key` 311.1 ms (p90 322), against 16.9 ms idle frames. |

A parameter's first value is its default.

**Both halves of every entry measure the library build they name,**
`608544c9`, and not whatever `master` holds now — it has moved on since, and
its `packages/lib` differs. A figure belongs to the build beside it.

**What the two halves share, and what they do not.** Every panel was run at
the same viewport under both hosts, and their counters, rule totals and
rectangles came back the same, which is the census agreement *Measurement
rules* requires; the two exceptions are noted in the entries themselves, and
neither is a figure a check names. The frame times are each host's own: the
sweeps ran in different sessions, where absolutes drift 8–14%, so the two
columns are not a comparison of hosts.

**The shells are Loom stand-ins.** `shell-deep` and `shell-shallow` are shaped
after the two Loom scenarios the render review measured: S1
(`mode=filetree&tabs=4&grid=2x2&gutter=dock-h`), a 2×2 dock grid of code
editors whose horizontal dock gutter is dragged, and S3
(`mode=filetree&tabs=1&gutter=explorer`), one editor with the explorer gutter
dragged. Their default drive is Loom's two phases for those scenarios, the
drag and then 120 units of wheel on the file tree. They keep the shape that
decides the review's figures — a `Split` beside a resizable `Accordion` with
one closed section, a `Dock` of `Border`-wrapped `CodeEditor`s, and the gutter
each scenario drags — but they are not replicas: the editors hold generated
code instead of Loom's source files, the explorer is the library's `Tree` over
generated folders instead of Loom's file tree over the repository, the shell
is built from library components instead of Loom's shell classes with no
Tauri API behind it, and the tabs are declared in the `Dock` layout instead of
opened from the tree. So their numbers will not match Loom's history. They
exist so that a later Loom plan can take their baselines and retire Loom's
harness; their `Validated` entries record those baselines.

Which panel and driver run each wave-3 candidate's hot path, and which
correctness bugs a panel shows at run time, is mapped under *Coverage* in
[qa-app-panels.md](../../plans/implemented/qa-app-panels.md#coverage) and
[qa-app-panels-editors-overlays.md](../../plans/implemented/qa-app-panels-editors-overlays.md#coverage).

## Built-in drivers

| Driver | Target | Per unit |
|---|---|---|
| `drag` | `{ element, axis: 'x' \| 'y' }` | a `mousemove` on `document`, moving `step` px along `axis` — out for the first half of the units, back for the second; a `mousedown` at the element's centre first and a `mouseup` last |
| `wheel` | an element | a `wheel` event at its centre, `deltaY` +40 for the first half, −40 for the second |
| `resize` | a component with `getWidth()`, `setWidth(w)`, `doLayout()` | width −`step` for the first half, +`step` for the second, then `doLayout()`; the original width is restored at the end |
| `passes` | a component with `doLayout()` | one synchronous `doLayout()`; the sample is its duration |
| `idle` | any defined value; ignored | nothing: the frame holds only what the page does on its own, such as an animation loop |
| `call`, `update`, `toggle` | a function `(index) => void` | calls it with the unit's index. Three names for one driver, so a panel can offer a data change and an expand or collapse side by side, and each report phase says which ran |
| `hover` | `{ element, axis: 'x' \| 'y' }` | moves the pointer `step` px along the element's centre line, bouncing between its edges one pixel inside them, with no button held: `pointermove` and `mousemove` to the element under the pointer, preceded by `pointerout`/`mouseout` and `pointerover`/`mouseover` when that element changed. The element's and its descendants' rectangles are read once, before the first unit, so every arm of a comparison gets the same events; a descendant the engine's hit test passes through, one whose computed `pointer-events` is `none` or whose `visibility` is `hidden`, is left out, as it is from a real pointer's |
| `park` | `{ element, axis, direction: 1 \| -1, leadPx }` | a `mousemove` on `document` to `leadPx` + `step` × k past the start in `direction`, k rising to half the units and falling back to 0, so the pointer never comes back closer than `leadPx`. Before the units, a press and a 10-frame drag of `leadPx`, past the pane's clamp; after them, a release and a drag back to the start. Needs at least 2 units |
| `click` | `{ elements: [element, …] }` | a press and release at the centre of the next element in turn: `pointerdown`, `mousedown`, `pointerup`, `mouseup`, `click` |
| `key` | `{ element, keys: [key, …] }` | a `keydown` and a `keyup` with the next key in turn; the element is focused, and the page left to settle, first |
| `type` | `{ element, text }` | inserts the next character of `text` with `document.execCommand('insertText')`, which makes the engine fire its own trusted `beforeinput` and `input` events, as a keystroke does; a synthetic `KeyboardEvent` would insert nothing. The element is focused with the caret at its end first, and what was typed is deleted after |
| `theme` | `{ cycle(index), restore() }` | `cycle(index)`; the page's theme is restored after the last unit |
| `pan` | `{ element, axis: 'x' \| 'y' }` | a `pointermove` and a `mousemove` on the element itself, `step` × k px from its centre along `axis`, k rising to half the units and falling back to 0, the primary button held. Before the units, a `pointerdown` and a `mousedown` at the centre; after them, a `pointerup` and a `mouseup` where the pointer is. For a component that listens on itself or captures the pointer, such as `DiagramView` or `Slider`, which `drag`'s moves on `document` never reach |
| `viewport` | any defined value; ignored | a `resize` event on `window`, so every viewport listener runs. The viewport keeps its size: no page script can resize either host's window, so this is a resize event at an unchanged size, not a drag of the window frame |
| `hwheel` | an element | a `wheel` event at its centre, `deltaX` +40 for the first half, −40 for the second, `deltaY` 0 |

A driver whose target is missing or the wrong shape fails the run with
`<driver>: <what is wrong>`. `type` also fails before its first unit when the
engine has no `document.execCommand` or the element does not take focus, and
`park` fails before anything with fewer than 2 units, and after restoring when
the element moved during the measured units: its `leadPx` did not reach the
clamp, and the run measured the wrong thing.

The drivers from `idle` on keep their own setup and teardown out of the
counters: reading rectangles, focusing, `park`'s lead-in and restore drags,
`pan`'s press and release,
`type`'s clean-up and `theme`'s restore run inside `tools.suspendCounting`,
which pauses every counter family, and where that work changed the page — a
focus, a caret move, a drag, a restyle — they wait a few frames
(`tools.waitFrames`) inside the suspension for it to settle. Only the measured
units land in a phase's counts. `hover`, `park`, `type` and `theme` each add a note: the
crossings, the rectangle the element was held at, the characters typed, and
the page's CSS rule total before the first switch and after the last, which is
where a leak of per-switch rules shows.

## Built-in ablations

Each patches the live page to remove one piece of work, so a same-session A/B
against a run without it bounds what that change could save. An ablation's
own counters (`skipped.*`, `skip*`) land in `work` or `writes` and are reported
even when that family's counters are not installed.

| Ablation | What it removes |
|---|---|
| `split.noop-drag` | A `Split` drag with a zero or repeated delta early-returns instead of re-laying out (G12 / F06.3). |
| `split.recalc-gate` | `Split.recalculateSizes` runs once per argument signature instead of every pass (G12 / F06.4). |
| `sync.scroll` | `Component.syncScrollOffsets` becomes a no-op: no live scroll-offset read during layout. |
| `cm.measure` | CodeMirror's per-frame measure cycle becomes a no-op for every editor. |
| `cm.observers` | CodeMirror's resize and intersection observers are disconnected for every editor. |
| `editor.doLayout` | `CodeEditor` stops laying itself out. |
| `norules` | Every stylesheet-rule write is dropped; inline writes are kept. |
| `nosameattr` | Same-value attribute writes are dropped. |
| `nosamewrites` | Same-value camelCase style writes are dropped, each attributed. |
| `noaria` | `aria-hidden` attribute writes are dropped. |
| `novisible` | `Component.setVisible` becomes a no-op. |
| `tab.doLayout` | The first `Tab` layout stops laying out. |
| `tree.renderWindow` | `Tree` stops re-rendering its row window. |
| `tree.doLayout` | `Tree` ignores layout entirely. |
| `scroller.layoutScrollbars` | `Tree`'s virtual scroller stops updating scrollbar metrics. |
| `accordion.doLayout` | The first `Accordion` layout stops laying out its sections. |
| `card.doLayout` | The first `Card` layout stops laying out its visible page. |

An ablation whose target the panel does not contain says so in its note and
patches nothing.

## Report format

One JSON object per run, `results/<name>-<epoch ms>.json`:

| Field | What it holds |
|---|---|
| `schema` | Always `1`, so a later format can be told apart. |
| `name`, `panel`, `host`, `build` | The run name, the panel id, the `host=` value and the library build's path. |
| `params`, `ua`, `notes` | Every URL parameter, the engine's user agent, and what the run did, in order. |
| `before` | `viewport`, `elements`, `svgPainted`, `textPainted`, `invisible`, `undisplayed`, `clampTally`, `scan` (paint features and scroll containers) and `host` (the panel's `describe()`). |
| `idle`, `idleAfter` | Idle-frame timing before and after the phases. |
| `phases[]` | Per phase: `driver`, `units`, `timing` (`n`, `avgMs`, `p50Ms`, `p90Ms`, `maxMs`, `over16`), and per unit `writes` and `forcedStacks` (`count=1`), `work` (`work=1`), `seam.sink` and `seam.source` (`seam=1`), and `geometry` (`geom=1`: one rounded `[x, y, width, height]` per unit and label). |
| `error`, `stack` | Instead of the measurements, when the run failed. |

## Analysers

```sh
python3 packages/qa/bin/qa-table.py packages/qa/results <prefix> [--writes] [--seam] [--before <path>[,<path>…]]
python3 packages/qa/bin/qa-forced.py packages/qa/results <prefix>
python3 packages/qa/bin/qa-verdict.py <result.json>
```

`qa-table.py` prints one row per phase, oldest file first: `run`, `panel`,
`host`, `phase`, `units`, `elems`, `idle`, `avg` and `p90`, `work/u` (the
phase's work per unit, the ablations' `memo.*`, `skipped.*` and `stubbed.*`
bookkeeping left out), `sink/u` (seam sink calls per unit) and `geom`, then one
column per `--before` path (a dotted path into `before`, such as
`host.treeRowsTotal`; `-` when missing or not a scalar), then the notes.
`geom` compares each phase's geometry with the same phase of the reference,
the first successful report listed: `base` for the reference itself, `=` or
`DIFF` against it, `?` when the reference phase has none, `-` when this phase
has none. `--writes` lists each write counter of at least 0.05 per unit under
the row; `--seam` lists the seam counters. An error report prints an `ERROR`
row, and a file in an older format prints `old format, skipped`.

`qa-forced.py` prints, per file and phase, the forced reads per unit, the
attributed class and attribute toggles, the top mutations and the stored
stacks.

`qa-verdict.py` is the runner's last step: it prints the path and exits 0 for a
successful report, and exits 1 printing `ERROR <error>` and the notes, `OLD
FORMAT <path>` or `UNREADABLE <path>: <reason>` otherwise.

## Measurement rules

- **Compare only runs from one session.** Absolute frame times drift 8–14%
  between sessions on the same build
  ([00-baseline.md](../../plans/research/render-review-2026-09-15/00-baseline.md#L176)).
- **Interleave the arms in one sweep, and run the baseline arm at both ends**,
  so drift shows
  ([00-baseline.md](../../plans/research/render-review-2026-09-15/00-baseline.md#L186),
  [97-wave2-measurement.md](../../plans/research/render-review-2026-09-15/97-wave2-measurement.md#L3)).
- **Work counts must match across hosts at the same viewport; frame times
  and geometry are compared only within one host** (the `host` column). Seam,
  work and native mutation counts come from the library and the engine's DOM,
  so at the same `before.viewport` a panel's per-pass census is the same under
  MiniBrowser and Tauri; a difference there means the hosts ran different
  code. At different viewports it can differ legitimately — a panel whose work
  depends on its size, such as a virtualised list, does more or less of it —
  and a window manager that refuses full screen gives one host a smaller
  viewport. A MiniBrowser window and a Tauri webview embed the engine
  differently — window chrome, scrollbars, WebKit settings, Tauri's init
  scripts — so their frame times and rectangles differ for reasons that are
  not the library's. Give each host's runs their own name prefix, so
  `qa-table.py`'s `geom` reference is always a run of the same host.
- **`deleteStyleRule` and `release` are not deterministic; compare the other
  counters.** Both also fire from `Component`'s `FinalizationRegistry`, which
  frees an unreachable component's rule and handles when the collector
  reaches it, so they follow elapsed time rather than work. `c10-probe`
  showed it inside one report — `deleteStyleRule` absent over 2 `toggle`
  units of `treetable-rows` and 55.7 over 20 — and an A/B of that same panel
  against a library change it cannot have seen showed it across reports:
  every counter matched except `deleteStyleRule` (43.65 against 47.95) and
  `release` (130.95 against 143.85). A run-to-run difference in those two is
  not evidence that anything changed, and a leak's signature has to be read
  per unit of work, not off a phase total.
- **Give every arm the same instrument flags** (`count`, `work`, `seam`,
  `geom`): the instruments cost time.
- **Geometry equality is the soundness gate.** An arm whose `geom` column reads
  `DIFF` laid the page out differently, and its timing is void
  ([97-wave2-measurement.md](../../plans/research/render-review-2026-09-15/97-wave2-measurement.md#L62)).
- **Check a deep panel and a shallow one** — `shell-deep` and
  `shell-shallow`, `chart-dashboard` and `chart-line`, or `form-nested` and
  `form-flat`. A change can hold
  geometry on one and break it on the other. Never bound a document-wide cost
  on the small panel ([00-baseline.md](../../plans/research/render-review-2026-09-15/00-baseline.md#L339)).
- **Scale a panel with `n=` before bounding a document-wide cost.** A cost that
  grows with the page, such as one per mounted editor, hidden ones included,
  shows only when there is more of the page: sweep `shell-deep` at `n=1` and
  `n=12`, say, before saying what a change saves.
- **Put `toggle`, `theme`, `type`, and `drag` with `grip=tab`, last in a
  `drive=` list.** They leave the page changed for any phase after them: a
  section or pane flipped, the theme's restyle, an editor's edit history, a
  tab strip possibly reordered. Give `theme` few units, `theme:4` to
  `theme:20`: each unit restyles the whole page.
- **An ablation bounds only the code it reaches in the panel it runs in.**
  Confirm it engaged through its own counters
  ([97-wave2-measurement.md](../../plans/research/render-review-2026-09-15/97-wave2-measurement.md#L157)).
- **Score work avoided as well as milliseconds** (the `work/u` column).
- **A green test suite is not evidence of unchanged geometry**
  ([97-wave2-measurement.md](../../plans/research/render-review-2026-09-15/97-wave2-measurement.md#L177)).
- **Fail loudly.** An error result or a run with no result exits 1; a sweep
  stops on the first (`|| exit 1` after each run); `qa-table.py` prints
  `ERROR` rows.
- **A cost well under one frame shows in the counts, not in `avg`.** A frame
  driver's timing is the gap between animation frames, so a 1–3 ms commit, say
  a Markdown editor's re-serialisation, barely moves it; read the work and
  seam counts for such a cost.
- **`forced.*` counts corroborate, never lead.** They under-count reads dirtied
  by inline-style writes, and `geom=1` adds the probe's own reads.
- **Measure in WebKitGTK.** Chromium can miss paint-bound costs entirely.
- **A panel reproduces an outside behaviour only when a run shows the same
  symptom.**
