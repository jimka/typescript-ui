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
| `src/mount.ts` | Mounts a panel through `Body.init` and collects its targets. |
| `src/harness/` | The harness: frame loop, drivers, counters, ablations, probes, the run. It imports nothing from the library; the page hands it `Body` and `DOM`. |
| `vite.config.ts`, `vite/plugins.ts` | The app's own Vite config: the report endpoint, the library-build alias and the build's own `/assets/`. |
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

**The same plugin serves the arm's `dist/lib/assets/` at `/assets/`.** Imports
are not the library's only way to reach its own files. Its store runs filtering
and sorting in a Web Worker, and the built library starts that worker with
`new Worker('/assets/StoreWorker-<hash>.js')` — an absolute path from the site
root, which the app serving the page has to answer; the file ships inside the
build, under `dist/lib/assets`. The plugin answers it from the arm's own build,
matched by directory, never by the build-specific hashed name, so a `wt` run
gets that arm's worker and not the main tree's. Unserved, the request does not
even fail visibly: Vite answers a path it does not know with the page's own
HTML, so the worker is handed that instead of a script, and nothing watches for
a worker that never replies — a panel whose store holds 1,000 records or more
silently stays empty, which reads as a broken panel. A build with no
`dist/lib/assets` stops the server at startup, naming the arm, rather than
letting that happen.

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
| `step=<px>` | pixels per unit for `drag` and `resize` | 3 |
| `count=1` | native write counters and the forced-layout detector | off |
| `deepwrites=1` | also count camelCase style assignments (needs `count=1`) | off |
| `work=1` | per-class work counters | off |
| `seam=1` | DOM seam counters | off |
| `geom=1` | geometry probe, every unit | off |
| `abl=<a>[,<b>…]` | ablations to apply | none |
| `css=<css>` | extra stylesheet injected before measuring | none |
| `host=<host>` | recorded in the report; the runner sets it | none |

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
  default drive names needs a target.
- `afterMount(tools)` — optional; runs once the root has painted and settled,
  and returns more targets, merged over `targets`. Elements that layout creates,
  such as `Split`'s gutters, exist only then.
- `geometry` — optional; label → a CSS selector or a component, sampled under
  `geom=1`.
- `describe()` — optional; host fields, stored under `before.host`.
- `installWork(tools)` — optional; the panel's own work counters, installed
  under `work=1` after the harness's (`tools.countMethod` wraps a method).

To add a panel, add its file; the lazy registry finds it, and the page loads
only the measured panel's modules.

**The import rule.** A panel imports `@jimka/typescript-ui/*` and files inside
`packages/qa/src`, nothing else — never a docs demo or a lib demo-app panel. A
baseline must move only when the library moves, and a demo changes for
documentation reasons. Shared panel code, such as a data generator, lives in
`src/`. `tests/panels.test.ts` checks every panel's imports.

**The symptom rule.** When a behaviour spotted in another app is rebuilt as a
panel, its `description` names the source and the symptom, and the table below
records it as reproduced only after a run shows that symptom — the same count,
the same failure or the same geometry. A panel built to look like another
app's screen can easily exercise a different code path.

| Panel | Builds | Reproduces | Validated |
|---|---|---|---|
| `chart-line` | A 3-series `LineChart`, legend and point markers on, `n` points per series (default 50). | Slice 26 F26.1: a chart rebuilds every SVG mark per layout pass — at `n = 50`, 1,081 sink calls (`apply` 241, `createElementNS`, `appendChild`, `removeChild` and `release` 210 each) and 12 `measureText` calls per unchanged pass. | `minibrowser`: not yet — fill in the date, the library commit, the census and the frame time after the first authorised sweep.<br>`tauri`: not yet — the same, from a sweep that runs both hosts. |

## Built-in drivers

| Driver | Target | Per unit |
|---|---|---|
| `drag` | `{ element, axis: 'x' \| 'y' }` | a `mousemove` on `document`, moving `step` px along `axis` — out for the first half of the units, back for the second; a `mousedown` at the element's centre first and a `mouseup` last |
| `wheel` | an element | a `wheel` event at its centre, `deltaY` +40 for the first half, −40 for the second |
| `resize` | a component with `getWidth()`, `setWidth(w)`, `doLayout()` | width −`step` for the first half, +`step` for the second, then `doLayout()`; the original width is restored at the end |
| `passes` | a component with `doLayout()` | one synchronous `doLayout()`; the sample is its duration |

A driver whose target is missing or the wrong shape fails the run with
`<driver>: <what is wrong>`.

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
- **Give every arm the same instrument flags** (`count`, `work`, `seam`,
  `geom`): the instruments cost time.
- **Geometry equality is the soundness gate.** An arm whose `geom` column reads
  `DIFF` laid the page out differently, and its timing is void
  ([97-wave2-measurement.md](../../plans/research/render-review-2026-09-15/97-wave2-measurement.md#L62)).
- **Check a deep panel and a shallow one.** A change can hold geometry on one
  and break it on the other. Never bound a document-wide cost on the small
  panel ([00-baseline.md](../../plans/research/render-review-2026-09-15/00-baseline.md#L339)).
- **An ablation bounds only the code it reaches in the panel it runs in.**
  Confirm it engaged through its own counters
  ([97-wave2-measurement.md](../../plans/research/render-review-2026-09-15/97-wave2-measurement.md#L157)).
- **Score work avoided as well as milliseconds** (the `work/u` column).
- **A green test suite is not evidence of unchanged geometry**
  ([97-wave2-measurement.md](../../plans/research/render-review-2026-09-15/97-wave2-measurement.md#L177)).
- **Fail loudly.** An error result or a run with no result exits 1; a sweep
  stops on the first (`|| exit 1` after each run); `qa-table.py` prints
  `ERROR` rows.
- **`forced.*` counts corroborate, never lead.** They under-count reads dirtied
  by inline-style writes, and `geom=1` adds the probe's own reads.
- **Measure in WebKitGTK.** Chromium can miss paint-bound costs entirely.
- **A panel reproduces an outside behaviour only when a run shows the same
  symptom.**
