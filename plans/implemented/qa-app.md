---
touches-shared:
  - package.json
  - package-lock.json
  - .gitignore
  - README.md
---

# QA App — Implementation Plan

## Overview

This plan adds `packages/qa`, a standalone app that measures the library's render performance in WebKitGTK. Everything a run needs lives in the package:

- its own page (`index.html`, `src/main.ts`) and Vite config;
- a report endpoint and a plugin that picks which library build to measure;
- the harness, ported from the generic half of Loom's 2,233-line [`qa-harness.ts`](../loom/qa/qa-harness.ts#L1) (Loom paths in this plan are relative to this repo's root, i.e. the sibling checkout): frame loop, drivers, write/forced-layout/work counters, a new DOM-seam counter, ablations, a geometry probe and the result report;
- its own **panels** — the components a run measures, each built from the library alone;
- a runner with a host switch (`--host minibrowser` now), and the Python analysers.

It ships one panel, `chart-line`, a 3-series × 50-point `LineChart` that must reproduce slice 26's F26.1 record in WebKitGTK: 1,081 sink calls and 210 SVG elements rebuilt per unchanged layout pass. It also makes a frame-loop throw end the run with an error result instead of a hang.

Nothing outside `packages/qa` changes except the workspace list, the lockfile, `.gitignore`, the root README and one CI workflow. The docs site and Loom are untouched. The follow-up plans are `qa-app-panels` (more panels and drivers, against the panel contract here) and `qa-app-tauri` (a Tauri host for the same page).

---

## Architecture Decisions

### The QA app is a private workspace package, `packages/qa`

`packages/qa` (package name `@jimka/typescript-ui-qa`, `"private": true`, version `0.0.0`) joins the root `workspaces` list ([package.json:6](package.json#L6)). It is a Vite app like [`packages/docs`](packages/docs/package.json#L1): its own `index.html`, `src/main.ts`, `vite.config.ts` and `tsconfig.json`, mounting its UI with `Body.init({ layoutManager: Fit(), components })` as [docs' `main.ts:22`](packages/docs/src/main.ts#L22) does. Nothing is injected into another app.[^home][^version]

### The harness is library-free; the page hands it `Body` and `DOM`

`src/harness/` imports nothing from `@jimka/typescript-ui`, not even types. `src/main.ts` imports `Body` and `DOM` from `@jimka/typescript-ui/core` and passes them in as `lib`. The rest of the app — `src/main.ts`, `src/mount.ts`, `src/panels.ts` and the panels — imports the library directly. No module in `src/harness/` touches `document`, `window` or a DOM prototype at import time, so node tests can import all of them.[^inject]

### Library builds are switched by an exports-derived alias with a guard

Each library build in a comparison is an *arm*: usually this checkout's own build (`main`) against another build, such as a worktree's (`wt`). `qaLibraryPlugin({ libDir })` aliases each `@jimka/typescript-ui/<subpath>` import to the file that the arm's `<libDir>/package.json` `exports` map names for it, and fails any import of the package that no alias covers. The app's Vite config reads the arm from `QA_LIB`, defaulting to this checkout's own `packages/lib` — never the `node_modules` symlink, which in a worktree points at the main tree's build. Every import of the library on the page goes through the same aliases, so the page holds a single instance of the arm's library.[^alias]

The aliases are built by this rule. Every exports key becomes one alias; exact keys come first, then `*` keys ordered by the length of the text before the `*`, longest first; the first alias that matches wins.

| Import | Alias that matches | Resolves to |
|---|---|---|
| `@jimka/typescript-ui/core` | exact `./core` | `<libDir>/dist/lib/core.es.js` |
| `@jimka/typescript-ui/component/chart` | exact `./component/chart` | `<libDir>/dist/lib/component/chart.es.js` |
| `@jimka/typescript-ui/glyphs/solid` | exact `./glyphs/solid` (before `./glyphs/*`) | `<libDir>/dist/lib/glyphs/solid/index.es.js` |
| `@jimka/typescript-ui/glyphs/solid/star` | `./glyphs/solid/*` (longer prefix than `./glyphs/*`) | `<libDir>/dist/lib/glyphs/solid/star.es.js` |
| `@jimka/typescript-ui/nope` | none | the guard fails the import: `@jimka/typescript-ui/nope is not exported by the library build at <libDir>` |

### The app's Vite config is its own

`packages/qa/vite.config.ts` is a plain `defineConfig`, not an extension of the docs config. It installs `qaLibraryPlugin` and `qaReportPlugin`, fixes `server.port` at 5190 with `strictPort`, allows the workspace root and the arm's library directory in `server.fs.allow`, and defines `__QA_LIB__`. Vitest reads the same file, so tests resolve the library exactly as the page does.[^port-number][^fs-allow]

### Vite and Vitest see only the app's own source

The app's surface is `src/` (the page), `tests/` and `bin/`; everything else in `packages/qa` is run output or tooling. So the Vite server watches only `index.html`, `src/` and `tests/`, through `server.watch.ignored: outsideAppSource(ROOT)`; its dependency scan starts only from `index.html` (`optimizeDeps.entries: ['index.html']`); and the test script is `vitest run --dir tests`. The tsconfig's `include` is already such a list. A directory added to the package later reaches none of the three unless it is added to its list.[^own-source]

| Path | Watched by the dev server |
|---|---|
| `packages/qa` (the root itself) | yes, so the walk can reach its children |
| `packages/qa/index.html` | yes |
| `packages/qa/src/panels/chart-line.ts` | yes |
| `packages/qa/results/val-pass-main-1758300000000.json` | no |
| `packages/qa/logs/vite-val-pass-main.log` | no |
| `packages/qa/tests/run.test.ts` | yes (Vitest's watch mode reuses this watcher) |
| `packages/qa/bin/qa-table.py` | no |
| `packages/lib/dist/lib/core.es.js` (outside the root) | no |

### The page never assumes its host

The page reports by a same-origin `POST` to `/__qa/report` and uses nothing specific to one host: no MiniBrowser setting and no Tauri API. A MiniBrowser window and a Tauri webview that load the same dev-server URL run the same page. Only the runner knows the host: it passes `host=<host>` in the URL, and the report records it.[^tauri-ready]

### Panels are named-export modules found by a lazy glob

Each `packages/qa/src/panels/<id>.ts` exports exactly `description`, `defaultScale`, `defaultDrive` and `build(n, params)`. `packages/qa/src/panels.ts` finds them with a lazy `import.meta.glob`, keyed by file basename, like [`src/content/demos.ts:29`](packages/docs/src/content/demos.ts#L29) does for the docs demos. The page loads only the measured panel's modules.[^lazy]

### A panel imports the library and its own package, nothing else

A panel's imports are `@jimka/typescript-ui/*` and files inside `packages/qa/src`. It never imports a docs demo or a lib demo-app panel, so editing a demo cannot shift a baseline. A test checks every panel's import lines.[^panel-imports]

### A panel reproduces an outside behaviour only when it shows the same symptom

When a behaviour is spotted in another app, it is rebuilt as a panel. The panel's `description` names the source and the symptom, and the README's panel table records it as reproduced only after a run shows that symptom — the same count, the same failure or the same geometry. `chart-line` is the first entry: F26.1's 1,081 / 210.[^symptom]

### A panel names its drivers, targets and probes in `build` and `afterMount`

`build(n, params)` receives the page's `URLSearchParams`, so one panel can choose among several targets for one driver. It returns the panel's root, its `targets` (driver name → the thing that driver acts on), its geometry probes, a `describe()` for host fields and an `installWork` for its own work counters. `afterMount(tools)` runs once the root has painted and returns more targets, merged over `targets`; elements that layout creates, such as gutters, exist only then. Drivers themselves live in one table in `src/harness/drivers.ts`; a panel only names them.[^panel-hooks]

### One run: set up, instrument, snapshot, drive the phases, report

`runQa()` generalises Loom's [`run()`](../loom/qa/qa-harness.ts#L1980). A *phase* is one driver run over a number of *units*; a unit is one animation frame for a frame driver and one layout pass for the `passes` driver. The panel is mounted; the harness installs the requested instruments, takes a `before` snapshot of the page, measures idle frames, drives each phase with the counters reset per phase, measures idle again, and POSTs one report. The exact order is under *Internal Structure*.[^run-order][^per-phase]

### A default drive is a full `drive=` value

A panel's `defaultDrive` is the `drive=` value used when the URL has none. `parseDrive` reads it with the same grammar, so `drag,wheel:120` gives two phases and a single driver name gives one. An empty default gives no phases: the run still reports its `before` snapshot and idle frames, with `phases: []`.[^default-drive]

### A throw inside the frame loop ends the run with an error result

`runFrames` catches a throw from its per-frame work, requests no further frame and rejects with the error. The run's error path then posts a report carrying `error` and `stack`, with a note naming the failed phase. The runner stops the host as soon as any result appears, and exits 1 at once with the error when the result carries one.[^frame-throw]

### The runner has a host switch

`packages/qa/runqa.sh [--host <host>] <name> <main|wt> [query-params]` takes `--host`, default `minibrowser`. `HOSTS` lists the supported names, and three functions each hold one `case` on the host name: `check_host` checks the host can start (its program exists) before Vite starts, `start_host` starts it on the run's URL, and `stop_host` stops it. The runner rejects an unknown host, or one whose check fails, before it starts anything. Adding a host adds one name to `HOSTS` and one branch to each of the three functions.[^host-switch]

### The runner waits for the result, not for a timeout

The runner polls the results directory while the host runs. As soon as a result appears, or the host exits, it stops the host and hands the result to `bin/qa-verdict.py`, which prints the error and exits 1 for an error result. `QA_TIMEOUT` (default 120 s) bounds the wait; a run that writes nothing ends as `NO RESULT`. `qaReportPlugin` writes each result under a temporary name and renames it, so the runner never reads half a file.[^verdict]

### A seam counter counts what the recording sink counts

`seam=1` installs counting proxies over `DOM.sink` and `DOM.source` through `DOM.install`, the library's documented seam swap point ([core/DOM.ts:2900](packages/lib/src/typescript/lib/core/DOM.ts#L2900)). Each call is tallied under its method name — the names [`RecordingDOMSink`](packages/lib/tests/dom/TestDOM.ts#L450) logs. This is what makes the F26.1 comparison like-for-like: slice 26 counted sink calls under the recording sink, not DOM mutations. The proxy calls each real method with the real object as `this`.[^seam]

### Geometry is sampled every unit from DOM rectangles, and only on request

`geom=1` records the rounded `getBoundingClientRect()` of each geometry target the panel names, once per driven unit. Geometry equality between arms is the soundness gate for any comparison; each sample forces a layout, so every arm of a comparison must carry the same flag.[^geom]

### The mouse helper takes the buttons state

`tools.fireMouse(type, target, x, y, init?)` takes an optional `{ buttons, relatedTarget }`. Without `init.buttons` it keeps Loom's rule: `1` for every type except `mouseup`. A driver that needs no pressed button, such as a hover, passes `{ buttons: 0 }` instead of building its own `MouseEvent`.[^fire-mouse]

| Call | `buttons` on the event | `relatedTarget` |
|---|---|---|
| `fireMouse('mousedown', el, x, y)` | 1 | `null` |
| `fireMouse('mousemove', document, x, y)` | 1 | `null` |
| `fireMouse('mouseup', document, x, y)` | 0 | `null` |
| `fireMouse('mousemove', el, x, y, { buttons: 0 })` | 0 | `null` |
| `fireMouse('mouseout', a, x, y, { buttons: 0, relatedTarget: b })` | 0 | `b` |

### Validation reproduces F26.1 with a `passes` driver

The built-in `passes` driver calls a component's `doLayout()` once per unit, synchronously — the probe's "one unchanged pass". A pass's *census* is its count of seam calls per method name. The `chart-line` panel builds a chart that draws the same 210 marks per pass as the probe's chart, so its census should equal the record. The manual validation run must count exactly the record per pass. What differs from the original probe is in [*Addendum: F26.1 like-for-like*](#addendum-f261-like-for-like).[^fixture][^census]

### The built-in ablations are Loom's table minus six

The harness ships Loom's [`ABLATIONS`](../loom/qa/qa-harness.ts#L1098) except `size.memo`, `skip.unchanged`, `border.region-memo` and `accordion.seed` (their changes are in the library now) and `clamp.rows` and `clamp.once` (the G10 change, which the campaign dropped).[^ablations]

### Porting rule: copy the logic, then bring it to the conventions

Code moved from Loom keeps its logic unchanged except where the port map under *Internal Structure* says otherwise. It then gets what CODE_CONVENTIONS requires and Loom's file lacks: a JSDoc block on every function, every numeric literal named and its reason stated, and long functions split into named steps. TypeScript files follow `packages/docs/src` style (4-space indent, single quotes, semicolons); `vite.config.ts` follows `packages/docs/vite.config.ts` (2-space indent, no semicolons).[^port]

### Raw DOM and prototype patching are outside ARCHITECTURE.md's scope

The harness patches browser and library prototypes and touches the DOM directly. ARCHITECTURE.md's DOM rules bind the library's own code, and `local/no-raw-dom` lints only `packages/lib/src`. Panels, `src/main.ts` and `src/mount.ts` still build UI the library's way: callable components, options bags at construction, `Body.init` to mount.[^raw-dom]

### Prior art checked, not reused

The lib's [`perf/Benchmark.ts`](packages/lib/src/typescript/perf/Benchmark.ts#L1) and its demo app ([`main.ts`](packages/lib/src/typescript/main.ts#L1), 32 panels in one `Tab`) were checked and are not reused. The diagnostics counters (`readFrameworkCounts`) are left for `qa-app-panels`.[^prior-art]

---

## Public API

Nothing here is exported from `@jimka/typescript-ui`, and nothing outside `packages/qa` imports it. The *panel contract* is the surface `qa-app-panels` builds on; the rest is the app's internal contract, pinned so the steps and tests agree.

### The panel contract — `packages/qa/src/panels.ts`

```ts
import type { Component } from '@jimka/typescript-ui/core';
import type { AnyObj, GeometryTarget, HarnessTools } from './harness/types.js';

/** What a panel module's `build(n, params)` returns. */
export interface PanelBuild {
    /** Mounted alone at full viewport through `Body.init` + `Fit`. */
    root: Component;
    /** Driver name → target, for targets that exist before mounting. */
    targets: Record<string, unknown>;
    /** Called once after the root has painted and settled; its entries are merged over `targets`. */
    afterMount?(tools: HarnessTools): Record<string, unknown>;
    /** Label → geometry probe target, sampled under `geom=1`. */
    geometry?: Record<string, GeometryTarget>;
    /** Host fields, stored under `before.host`. */
    describe?(): AnyObj;
    /** Extra work counters, installed under `work=1` after the harness's own; returns notes. */
    installWork?(tools: HarnessTools): string[];
}

/** The named exports of every `packages/qa/src/panels/<id>.ts`, and nothing else. */
export interface PanelModule {
    /** What the panel builds; for a rebuilt outside behaviour, the source and the symptom. */
    description: string;
    /** Positive integer used when the URL has no `n=`. */
    defaultScale: number;
    /** The `drive=` value used when the URL has none, e.g. `resize` or `drag,wheel:120`; `''` means no phases. */
    defaultDrive: string;
    /** `params` is the page's URL parameters, for choosing among targets; a module may declare `build(n)` alone. */
    build(n: number, params: URLSearchParams): PanelBuild;
}

/** Every panel id (file basename), sorted. */
export function getPanelIds(): string[];
/** The panel's module, or `null` when no file has that id. */
export function loadPanel(id: string): Promise<PanelModule | null>;
/** `raw` as a positive integer, or `fallback` when `raw` is null or empty; throws `n: expected a positive integer, got "<raw>"` otherwise. */
export function parseScale(raw: string | null, fallback: number): number;
```

A panel is registered by existing: its file in `src/panels/` is its registration and its basename is its id. It names drivers by the keys of `targets` and of what `afterMount` returns, and each key must be a driver in the harness's table. It names probes through `geometry` (rectangles), `describe` (host fields) and `installWork` (work counters).

### Mounting — `packages/qa/src/mount.ts`

```ts
import type { Component } from '@jimka/typescript-ui/core';
import type { HarnessTools, SetupContext, Subject } from './harness/types.js';
import type { PanelBuild, PanelModule } from './panels.js';

/** The two waits in the mount sequence. */
export interface MountWaits {
    /** Resolves once `root` has painted. */
    painted(root: Component, id: string): Promise<void>;
    /** Resolves once a change to the tree has settled. */
    settled(): Promise<void>;
}

/** A mounted panel: its module, scale, build and merged targets. */
export interface MountedPanel {
    module: PanelModule;
    n: number;
    build: PanelBuild;
    targets: Record<string, unknown>;
}

/** The real waits: `painted` polls `elementOf(root)` + `isPainted` (10 s cap); `settled` sleeps 1 s. */
export function defaultMountWaits(tools: HarnessTools): MountWaits;
/** Loads, builds and mounts panel `id`, runs its `afterMount`, and merges the targets. */
export function mountPanel(id: string, params: URLSearchParams, tools: HarnessTools, waits?: MountWaits): Promise<MountedPanel>;
/** `mountPanel` with the default waits, as the harness's `PanelHost.setup`. */
export function setupPanel(id: string, ctx: SetupContext): Promise<Subject>;
/** `mountPanel` with the default waits, for a person to look at; errors go to `console.error`. */
export function previewPanel(id: string, params: URLSearchParams, tools: HarnessTools): Promise<void>;
```

### Harness types — `packages/qa/src/harness/types.ts`

```ts
export type AnyObj = Record<string, unknown>;

/** The two library objects the page passes in, from its own `@jimka/typescript-ui/core` import. */
export interface HarnessLibrary {
    Body: { getInstance(): object };
    DOM: { sink: object; source: object; install(impls: { sink?: object; source?: object }): void };
}

/** What a mounted panel gives the harness. */
export interface Subject {
    defaultDrive: string;
    targets: Record<string, unknown>;
    geometry?: Record<string, GeometryTarget>;
    describe?(): AnyObj;
    installWork?(tools: HarnessTools): string[];
}

export interface SetupContext {
    params: URLSearchParams;
    notes: string[];
    tools: HarnessTools;
}

/** How `runQa` finds and mounts panels; `src/mount.ts` provides the real one. */
export interface PanelHost {
    ids(): string[];
    setup(id: string, ctx: SetupContext): Promise<Subject>;
}

export interface RunOptions {
    lib: HarnessLibrary;
    /** Names the library build under test in the report (the page passes `__QA_LIB__`). */
    build: string | null;
    panels: PanelHost;
}

/** A CSS selector, or a component (resolved through its id). */
export type GeometryTarget = string | { getId(): string };

/** Drives `ctx.units` units and returns one timing sample (ms) per measured unit. */
export type Driver = (ctx: DriveContext) => Promise<number[]>;

export interface DriveContext {
    target: unknown;
    units: number;
    stepPx: number;
    params: URLSearchParams;
    notes: string[];
    tools: HarnessTools;
}

/** Patches the page at runtime and returns a one-line note saying what it did. */
export type Ablation = (tools: HarnessTools) => string;

export interface HarnessTools {
    sleep(ms: number): Promise<void>;
    waitFor<T>(probe: () => T | null | undefined | false, timeoutMs: number, label: string): Promise<T>;
    /** Dispatches a bubbling, cancelable `MouseEvent` with `button: 0`; `init.buttons` defaults to `type === 'mouseup' ? 0 : 1`, `init.relatedTarget` to `null`. */
    fireMouse(type: string, target: EventTarget, x: number, y: number, init?: { buttons?: number; relatedTarget?: EventTarget | null }): void;
    isPainted(el: Element): boolean;
    countPainted(selector: string): number;
    findButtonByText(text: string): HTMLElement;
    /** `document.getElementById(component.getId())` — a component's element id is its component id. */
    elementOf(component: { getId(): string }): HTMLElement | null;
    walkComponents(): AnyObj[];
    className(obj: object): string;
    isA(obj: object, name: string): boolean;
    findComponent(name: string): AnyObj | null;
    findLayoutManager(name: string): AnyObj | null;
    ownerProto(obj: object, method: string): AnyObj | null;
    rootOwnerProto(obj: object, method: string): AnyObj | null;
    noopOnOwningProto(obj: object, method: string): string;
    countMethod(obj: object, method: string, label?: string, root?: boolean): string;
    bumpWork(kind: string): void;
    bumpWrite(kind: string): void;
    /** Increments once per driven unit; per-pass memo ablations key on it. */
    currentFrame(): number;
    /** rAF loop: per frame, records the gap, advances the frame counter, runs `step`, samples geometry; rejects if that work throws. */
    runFrames(units: number, step: (index: number) => void): Promise<number[]>;
    /** Synchronous loop with the same bookkeeping; each sample is `step`'s own duration. */
    runPasses(units: number, step: (index: number) => void): Promise<number[]>;
}

export interface FrameSummary {
    n: number;
    avgMs: number;
    p50Ms: number;
    p90Ms: number;
    maxMs: number;
    over16: number;
}

export interface PhaseReport {
    driver: string;
    units: number;
    timing: FrameSummary;
    /** `count=1`: native write/mutation/forced-read counters, per unit. */
    writes?: Record<string, number>;
    /** `count=1`: first distinct stacks per forced-read API. */
    forcedStacks?: Record<string, string[]>;
    /** `work=1`: per-class method-call counters, per unit. */
    work?: Record<string, number>;
    /** `seam=1`: DOM seam calls by method name, per unit. */
    seam?: { sink: Record<string, number>; source: Record<string, number> };
    /** `geom=1`: one `[x, y, width, height]` (rounded) per unit and label; `null` when the target has no element. */
    geometry?: Record<string, Array<[number, number, number, number] | null>>;
}

export interface QaReport {
    schema: 1;
    name: string;
    panel: string;
    host: string | null;
    build: string | null;
    params: Record<string, string>;
    ua: string;
    notes: string[];
    before?: AnyObj;
    idle?: FrameSummary;
    phases?: PhaseReport[];
    idleAfter?: FrameSummary;
    error?: string;
    stack?: string;
}
```

`QaReport.schema` is always `1`, so a later format change can be told apart.[^schema] `host` is the `host=` URL value, or `null`. `before` holds `{ viewport: { w, h, dpr }, elements, svgPainted, textPainted, invisible, undisplayed, clampTally, scan, host }`.

### Harness entry points — `packages/qa/src/harness/run.ts`

```ts
/** Runs one measurement when the URL carries `qa=<name>`; resolves at once otherwise. */
export function runQa(options: RunOptions): Promise<void>;
/** The tools, with `lib.Body` bound into the tree helpers. */
export function createTools(lib: HarnessLibrary): HarnessTools;
/** Exported for tests. */
export function parseDrive(value: string | null, fallback: string, defaultUnits: number): Array<{ driver: string; units: number }>;
```

### Node surface — `packages/qa/vite/plugins.ts`

```ts
import type { Plugin } from 'vite';

/** Accepts `POST /__qa/report?name=<name>`; writes the body to `<resultsDir>/<name>-<epoch ms>.json.tmp`, then renames it to `.json`. */
export function qaReportPlugin(options: { resultsDir: string }): Plugin;

/** Aliases every exported subpath of the package at `libDir` to that build's file, and fails any other import of the package. `enforce: 'pre'`. */
export function qaLibraryPlugin(options: { libDir: string }): Plugin;

/** The alias list `qaLibraryPlugin` installs, in match order (rule and examples under Architecture Decisions). */
export function libraryAliases(libDir: string): Array<{ find: RegExp; replacement: string }>;

/** A `server.watch.ignored` matcher that ignores every path except `root` itself, `<root>/index.html`, `<root>/src/**` and `<root>/tests/**` (table under Architecture Decisions). */
export function outsideAppSource(root: string): (file: string) => boolean;
```

### URL parameters

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

Without `qa=` but with `panel=`, the page mounts the panel for a person to look at and measures nothing.

`drive=` parsing: a `:<units>` count must be a positive integer written in digits (`/^[1-9]\d*$/`); `frames=` and `step=` keep Loom's `parseInt` reading. When the URL value is absent or blank, `defaultDrive` is parsed instead; the URL's value always wins.

| `drive=` | `defaultDrive` | Phases (`driver × units`), with `frames` = 150 |
|---|---|---|
| absent or empty | `resize` | `resize × 150` |
| absent | `drag,wheel:120` | `drag × 150`, `wheel × 120` |
| absent | `drag,resize:120,wheel:120` | `drag × 150`, `resize × 120`, `wheel × 120` |
| absent | `''` | none |
| `passes:10` | `drag,wheel:120` | `passes × 10` |
| `drag,wheel:120` | `resize` | `drag × 150`, `wheel × 120` |
| ` drag , wheel ` | `resize` | `drag × 150`, `wheel × 150` (entries trimmed) |
| `resize:0`, `resize:abc`, `resize:2.5` | any | error `drive: bad unit count in "resize:0"` (the entry as given) |
| absent | `resize:0` | error `drive: bad unit count in "resize:0"` |

### Built-in drivers — `packages/qa/src/harness/drivers.ts` (`DRIVERS`)

| Driver | Target | Per unit |
|---|---|---|
| `drag` | `{ element: Element; axis: 'x' \| 'y' }` | `mousemove` on `document`, moving `step` px along `axis` — out for the first half of the units, back for the second. A `mousedown` at the element's centre comes first and a `mouseup` last. |
| `wheel` | `Element` | a `wheel` event at the element's centre, `deltaY` +40 for the first half, −40 for the second |
| `resize` | component with `getWidth()`, `setWidth(w)`, `doLayout()` | width −`step` for the first half, +`step` for the second, then `doLayout()`; the original width is restored at the end |
| `passes` | component with `doLayout()` | one synchronous `doLayout()`; the sample is its duration |

A driver whose target is missing or the wrong shape throws `<driver>: <what is wrong>`, which the run reports as an error.

### Runner — `packages/qa/runqa.sh`

```text
usage: packages/qa/runqa.sh [--host <host>] <name> <main|wt> [query-params]
  --host   minibrowser (default)
  main     QA_MAIN_LIB, default this checkout's packages/lib
  wt       QA_WT_LIB, required
exit 0   result written, no error        (prints the result path)
exit 1   error result, or NO RESULT       (prints the error, or NO RESULT and the Vite log path)
exit 2   bad arguments, no build, or a host that cannot start   (before anything starts)
```

### Verdict — `packages/qa/bin/qa-verdict.py <result.json>`

| Result file | Prints | Exit |
|---|---|---|
| `schema: 1`, no `error` | the path | 0 |
| `schema: 1`, `error: 'unknown driver "nope"'` | `ERROR unknown driver "nope"`, then the notes on one line | 1 |
| no `schema` field | `OLD FORMAT <path>` | 1 |
| not valid JSON | `UNREADABLE <path>: <reason>` | 1 |

---

## Internal Structure

### Package layout

```text
packages/qa/
  package.json  tsconfig.json  vite.config.ts  index.html  runqa.sh  README.md
  vite/plugins.ts                  node: qaReportPlugin, qaLibraryPlugin, libraryAliases
  bin/qa-table.py  bin/qa-forced.py  bin/qa-verdict.py
  src/main.ts                      page entry
  src/mount.ts                     mountPanel, defaultMountWaits, setupPanel, previewPanel (imports the library)
  src/panels.ts                    panel contract and lazy registry
  src/panels/chart-line.ts         the validation panel
  src/harness/                     library-free: types, dom, tree, frames, probes, counters, ablations, drivers, run
  tests/                           node tests, plus jsdom tests where noted
  results/  logs/                  run output, git-ignored
```

### Where Loom's code goes

Line numbers are in [`../loom/qa/qa-harness.ts`](../loom/qa/qa-harness.ts#L1); every destination is under `packages/qa/src/harness/`.

| Loom symbol | Harness file | Treatment |
|---|---|---|
| `AnyObj` :37 | `types.ts` | exported |
| `sleep` :39, `waitFor` :43, `isPainted` :59, `countPainted` :85, `findButtonByText` :89 | `dom.ts` | unchanged |
| `fireMouse` :100 | `dom.ts` | gains the optional `init` (`buttons`, `relatedTarget`); with no `init` it builds the same event as Loom's |
| — | `dom.ts` `elementOf` | new; the id lookup Loom does inline at :306–309 |
| `measureRaf` :104 | `frames.ts` `runFrames`, `measureIdle` | the rAF loop gains, per frame and in this order: record the gap, `currentFrame++`, `step(i)`, `sampleGeometry()`, all inside `try`; a throw rejects the promise and requests no further frame. `measureIdle(n)` is `runFrames(n, () => {})` |
| — | `frames.ts` `runPasses` | new; a synchronous loop with the same per-unit order, each sample `performance.now()` around `step(i)`; a throw propagates |
| `currentFrame` :208 | `frames.ts` | module state plus the `currentFrame()` accessor |
| `summarize` :368 | `frames.ts` | unchanged |
| `runDrag` :210 | `drivers.ts` `drag` | the target replaces `pickGutter`; the loop uses `runFrames`; the `widthProbe` branch goes (the geometry probe replaces it) |
| `runWheelScroll` :261 | `drivers.ts` `wheel` | the target replaces the `.TreeRow` / `.FileTree` lookup; loop via `runFrames` |
| `runResize` :326 | `drivers.ts` `resize` | the target replaces `findExplorerSplit()`; loop via `runFrames` |
| `report` :383 | `run.ts` `postReport` | unchanged: a relative `fetch('/__qa/report?name=…')` |
| `walkComponents` :393, `findComponent` :954, `findLayoutManager` :959 | `tree.ts` | take `Body` as their first parameter |
| `className` :420, `protoChainNames` :424, `isA` :436, `noopOnOwningProto` :441, `ownerProto` :919, `rootOwnerProto` :938 | `tree.ts` | unchanged |
| `counting`, `bump`, `resetWriteCounts`, `perFrameWriteCounts` :463–495 and `workCounting`, `bumpWork`, `perFrameWorkCounts` :972–989 | `counters.ts` | one `counting` flag for every family; `startCounting()` resets every tally and `forcedStacks` and sets the flag; `stopCounting(units)` clears it and returns the per-unit tallies of the installed families; `perUnit(counts, units)` replaces both per-frame helpers |
| forced-layout detector :497–579 | `counters.ts` | unchanged, except the stack clean-up: Loom's `https?:\/\/localhost:1420\/@fs\/[^ ]*\/dist\/lib\/` becomes the same pattern built from the escaped `location.origin` |
| `installWriteCounters` :581–744 | `counters.ts` | split into `installMutationCounter`, `installDeclarationCounters`, `installSheetCounters`, `installAttributeCounters` and `installClassListCounters`, called in Loom's order after `installForcedLayoutDetector` |
| `cssAccessorHost` :760, `installDeepStyleCounters` :807 | `counters.ts` | unchanged |
| `countMethod` :997, `installWorkCounters` :1022 | `counters.ts` | unchanged; `installWorkCounters` takes `tools` for the tree helpers |
| — | `counters.ts` `installSeamCounters` | new (below) |
| `dropRuleWrites` :832, `codeMirrorViews` :893 | `ablations.ts` | unchanged; `codeMirrorViews` takes `tools`; `cssAccessorHost` is imported from `counters.ts` |
| `ABLATIONS` :1098–1652 | `ablations.ts` `ABLATIONS` | each entry becomes `(tools) => string` and reaches the tree helpers, `bumpWork` and `bumpWrite` (Loom's `bump`) through `tools`; `size.memo` :1112, `skip.unchanged` :1160, `clamp.rows` :1201, `clamp.once` :1223, `border.region-memo` :1347 and `accordion.seed` :1394 are not ported |
| `clampTally` :1070 | `probes.ts` | takes `tools` |
| `EXPENSIVE` :1656, `scanPaintFeatures` :1708 | `probes.ts` | drop `treeDump: dumpTree()`; split into `countPaintFeatures` and `findScrollContainers` |
| the `before` block :2164–2180 | `probes.ts` `snapshotBefore(tools, host)` | generic fields only (listed under *Public API*); `host` is stored as given |
| `run` :1980–2229 | `run.ts` `runQa` | generic steps only, in the order below |
| `LIB_DIST` import :26–35; `pickGutter` :135; `widthProbe`, `widthRange`, `widthSeries`, `sampleWidths` :177–201; `findExplorerSplit` :301; `paneWidths` :1686; `DUMP_PROPS`, `describe`, `dumpTree` :1765–1824; `applyInjection` :1828–1978; `run`'s handling of `mode`, `tabs`, `grid`, `expand`, `collapse`, `q`, `inject`, `widthprobe`, `resize`, `scroll` and `gutter` | — | not ported: the library is passed in, and the rest is Loom's app |

`createTools(lib)` builds the tools once, binding `lib.Body` into `walkComponents`, `findComponent` and `findLayoutManager`; every other tool is the module function as is.

Geometry lives in `probes.ts`: `setGeometryTargets(targets | null)` switches the probe on for one phase (or leaves it off for `null`), `sampleGeometry()` appends one rounded `[left, top, width, height]` per label (a no-op while the probe is off), and `takeGeometry()` returns the series and switches the probe off, or returns `null` when it was off. A string target resolves through `document.querySelector`, a component through `elementOf`.

### The order of one run (`runQa`)

1. Return at once if the URL has no `qa=`.
2. Resolve the panel. `panel=` names it; if absent, use the only id `panels.ids()` returns. Errors: `unknown panel "<id>" (registered: <a, b>)`, `several panels registered (<a, b>); name one with panel=`, `no panel registered`.
3. `subject = await panels.setup(id, { params, notes, tools })`.
4. `phases = parseDrive(params.get('drive'), subject.defaultDrive, frames)`, where `frames` is the `frames=` value or `DEFAULT_UNITS`. For each phase, check the driver is in `DRIVERS` (`unknown driver "<name>"`) and `subject.targets` has its target (`panel "<id>" gives no target for driver "<driver>"`). Nothing is instrumented yet. An empty phase list is not an error; step 13 then runs no phase.
5. `count=1` → `installWriteCounters()`; with `deepwrites=1` also `installDeepStyleCounters()`. Notes as Loom's.
6. `css=` → append a `<style>` element, then `sleep(SETTLE_MS)`.
7. `abl=` → run each named ablation; note `<name>: <returned note>`, or `<name>: unknown ablation` (not an error, as in Loom).
8. `work=1` → `installWorkCounters(tools)`, then `subject.installWork?.(tools)`; each returned string becomes a note prefixed `work: `.
9. `seam=1` → `installSeamCounters(lib.DOM)`.
10. If any ablation ran → `sleep(SETTLE_MS)`.
11. `before = snapshotBefore(tools, subject.describe?.() ?? {})`.
12. `idle = summarize(await measureIdle(IDLE_BEFORE_FRAMES))`.
13. For each phase `k`: `setGeometryTargets(geom ? subject.geometry ?? null : null)`; `startCounting()`; `samples = await DRIVERS[driver](ctx)`; `counts = stopCounting(units)`; push `{ driver, units, timing: summarize(samples), ...counts, geometry: takeGeometry() ?? undefined }`. With `geom=1` and no `subject.geometry`, note `geom=1: panel declares no geometry targets` once. If the driver rejects, note `phase <k> (<driver>) failed` and go to the error path.
14. `idleAfter = summarize(await measureIdle(IDLE_AFTER_FRAMES))`.
15. `postReport(report)`.

A throw or rejection anywhere in steps 2–14 posts `{ schema: 1, name, panel, host, build, params, ua, notes, error: String(error), stack }` instead; `panel` is the requested or resolved id, or `''`.

Constants, each in the module that uses it and each with a comment giving its reason: `DEFAULT_UNITS = 150` and `DEFAULT_STEP_PX = 3` (Loom's defaults, so the app's phases match the campaign's), `IDLE_BEFORE_FRAMES = 60` and `IDLE_AFTER_FRAMES = 30` (Loom's), `SETTLE_MS = 800` (Loom's wait for a restyle and one layout flush), `FRAME_BUDGET_MS = 16.7` (one 60 Hz frame, `summarize`'s `over16`), `WHEEL_DELTA_PX = 40` (Loom's per-notch delta).

### The frame loop

```ts
// frames.ts — the rAF loop's shape
export function runFrames(units: number, step: (index: number) => void): Promise<number[]> {
    return new Promise<number[]>((resolve, reject) => {
        const gaps: number[] = [];
        let last = performance.now();
        let index = 0;

        function frame(now: number): void {
            try {
                gaps.push(now - last);
                last = now;
                frameCounter++;
                step(index);
                sampleGeometry();
            } catch (error) {
                reject(error);   // no further frame is requested

                return;
            }

            index++;

            if (index < units) {
                requestAnimationFrame(frame);
            } else {
                resolve(gaps.slice(1));
            }
        }

        requestAnimationFrame(frame);
    });
}
```

### The seam counter

```ts
// counters.ts — module state shared with the other counter families
let counting = false;
const seamCounts: { sink: Record<string, number>; source: Record<string, number> } = { sink: {}, source: {} };

function countingProxy(target: object, family: 'sink' | 'source'): object {
    const wrappers = new Map<PropertyKey, (...args: unknown[]) => unknown>();

    return new Proxy(target, {
        get(obj: object, key: PropertyKey): unknown {
            const value = Reflect.get(obj, key);

            if (typeof value !== 'function' || key === 'constructor') {
                return value;
            }

            let wrapper = wrappers.get(key);

            if (!wrapper) {
                const name = String(key);

                wrapper = function countedCall(...args: unknown[]): unknown {
                    if (counting) {
                        seamCounts[family][name] = (seamCounts[family][name] ?? 0) + 1;
                    }

                    // `this` is the real object, so its field writes and its calls to its
                    // own methods bypass the proxy and are neither redirected nor counted.
                    return (Reflect.get(obj, key) as (...a: unknown[]) => unknown).apply(obj, args);
                };
                wrappers.set(key, wrapper);
            }

            return wrapper;
        },
    });
}

export function installSeamCounters(dom: HarnessLibrary['DOM']): string {
    dom.install({ sink: countingProxy(dom.sink, 'sink'), source: countingProxy(dom.source, 'source') });

    return 'seam counters on DOM.sink and DOM.source';
}
```

`startCounting()` empties both `seamCounts` maps; `stopCounting(units)` returns `seam: { sink: perUnit(seamCounts.sink, units), source: perUnit(seamCounts.source, units) }` when the seam counter is installed. `perUnit` keeps Loom's arithmetic: `+(value / units).toFixed(2)`, keys ordered by value, largest first.

### `qaLibraryPlugin`

```ts
// vite/plugins.ts — shape only
export function qaLibraryPlugin(options: { libDir: string }): Plugin {
    const name = readPackage(options.libDir).name;
    const aliases = libraryAliases(options.libDir);
    const ownImport = new RegExp(`^${escapeRegExp(name)}(/|$)`);

    return {
        name: 'qa-library-arm',
        enforce: 'pre',
        config: () => ({ resolve: { alias: aliases } }),
        resolveId(id: string): null {
            // Runs after aliasing: an id still in bare form had no alias.
            if (ownImport.test(id)) {
                this.error(`${id} is not exported by the library build at ${options.libDir}`);
            }

            return null;
        },
    };
}
```

`libraryAliases(libDir)` reads `<libDir>/package.json` and, for every `exports` entry whose value has a string `import`:

- key `.` → `find: /^<name>$/`; any other key without `*` → `find: /^<name>\/<subpath>$/` (subpath without the leading `./`); `replacement` is `path.resolve(libDir, import)`.
- key with one `*` → `find: /^<name>\/<prefix>(.+)<suffix>$/`; `replacement` is `path.join(path.resolve(libDir), importPrefix) + '$1' + importSuffix`, where the import target is split at its `*` (`path.join` keeps the prefix's trailing `/`).
- Every literal part is regex-escaped. Exact entries first, then `*` entries by prefix length, longest first.

`outsideAppSource(root)` returns `(file) => file !== root && !isUnder(file, <root>/index.html) && !isUnder(file, <root>/src) && !isUnder(file, <root>/tests)`, where `isUnder(file, p)` is `file === p || file.startsWith(p + path.sep)`. Chokidar asks it about the root first and skips every ignored directory's contents, so ignored trees are never walked.

`qaReportPlugin` is the `/__qa/report` branch of Loom's `configureServer` middleware ([vite.config.qa.ts:28–47](../loom/qa/vite.config.qa.ts#L28)), unchanged except that it writes `<file>.tmp` and then `fs.renameSync`s it to `<file>`; every other request goes to `next()`.

### `packages/qa/vite.config.ts`

```ts
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import { outsideAppSource, qaLibraryPlugin, qaReportPlugin } from './vite/plugins.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const LIB_DIR = path.resolve(process.env.QA_LIB ?? path.join(ROOT, '../lib'))
const QA_PORT = 5190

export default defineConfig({
  plugins: [qaLibraryPlugin({ libDir: LIB_DIR }), qaReportPlugin({ resultsDir: path.join(ROOT, 'results') })],
  define: { __QA_LIB__: JSON.stringify(LIB_DIR) },
  optimizeDeps: { entries: ['index.html'] },
  server: {
    port: QA_PORT,
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(ROOT), LIB_DIR] },
    watch: { ignored: outsideAppSource(ROOT) },
  },
})
```

Every constant gets a comment in the file (reasons in the footnotes of the matching decisions).

### The page: `src/main.ts` and `src/mount.ts`

```ts
// src/main.ts
import { Body, DOM } from '@jimka/typescript-ui/core';
import { createTools, runQa } from './harness/run.js';
import { getPanelIds } from './panels.js';
import { previewPanel, setupPanel } from './mount.js';

declare const __QA_LIB__: string;

const lib = { Body, DOM };
const params = new URLSearchParams(location.search);

if (params.has('qa')) {
    void runQa({ lib, build: __QA_LIB__, panels: { ids: getPanelIds, setup: setupPanel } });
} else if (params.has('panel')) {
    void previewPanel(params.get('panel')!, params, createTools(lib));
}
```

`mountPanel(id, params, tools, waits = defaultMountWaits(tools))` in `src/mount.ts`, in order:

1. `module = await loadPanel(id)`; throw `panel module <id> not found` on `null`.
2. `n = parseScale(params.get('n'), module.defaultScale)`; `build = module.build(n, params)`.
3. `Body.init({ layoutManager: Fit(), components: [build.root] })`.
4. `await waits.painted(build.root, id)`, then `await waits.settled()`.
5. `mounted = build.afterMount?.(tools) ?? {}`; when `afterMount` exists, `await waits.settled()` again, since it may have changed the tree.
6. Return `{ module, n, build, targets: { ...build.targets, ...mounted } }`.

`defaultMountWaits(tools)` is the real wait. `painted` is `tools.waitFor` until `elementOf(root)` exists and `isPainted`, labelled `panel <id>` (`MOUNT_TIMEOUT_MS = 10_000`: generous for a cold dev-server module graph; the wait ends as soon as the root paints). `settled` is `tools.sleep(PANEL_SETTLE_MS)` (`1000`: Loom's post-setup settle, letting the first layout flushes finish). A test passes its own `waits` — for example `painted` that flushes layout synchronously and `settled` that resolves at once — and so runs the real mount sequence where the default wait cannot finish, as in jsdom, where nothing paints.[^mount-waits]

`setupPanel(id, ctx)` calls `mountPanel(id, ctx.params, ctx.tools)`, notes `panel <id> n=<n>` and returns `{ defaultDrive: module.defaultDrive, targets, geometry: build.geometry, describe: build.describe, installWork: build.installWork }`. `previewPanel(id, params, tools)` calls `mountPanel` and logs any error with `console.error`.

The merge lets `afterMount` replace a `build` target: with `build.targets` `{ resize: chart, drag: a }` and `afterMount` returning `{ drag: b, hover: c }`, the targets are `{ resize: chart, drag: b, hover: c }`.

### The `chart-line` panel

```ts
// packages/qa/src/panels/chart-line.ts — the data rule, which fixes the census
const SERIES_COUNT = 3;     // F26.1's chart had 3 series
const Y_SPAN = 100;         // y ∈ [0, 99]; with a 99 present the y axis nices to [0, 100] → 11 ticks
const POINT_STRIDE = 37;    // scatters consecutive points across [0, Y_SPAN)
const SERIES_OFFSET = 23;   // shifts each series so the three lines differ

export const description = 'Three-series LineChart with legend and point markers, n points per series. Reproduces slice 26 F26.1 (a chart rebuilds every SVG mark per layout pass): at n = 50, 1,081 sink calls and 210 elements rebuilt per unchanged pass.';
export const defaultScale = 50;
export const defaultDrive = 'resize';

export function build(n: number): PanelBuild {
    const series = Array.from({ length: SERIES_COUNT }, (_, s) => ({
        name: `Series ${s + 1}`,
        data: Array.from({ length: n }, (_, i) => ({ x: i, y: (i * POINT_STRIDE + s * SERIES_OFFSET) % Y_SPAN })),
    }));

    // Legend and markers pinned on, axis titles left off: each changes the mark census.
    const chart = LineChart({ series, showLegend: true, showPoints: true });

    return { root: chart, targets: { resize: chart, passes: chart }, geometry: { chart } };
}
```

At `n = 50` the per-pass mark census is 3 paths + 150 point circles + 57 axis marks = 210.[^fixture] `chart-line` declares `build(n)` alone: it reads no URL parameter, and an unused `params` would fail `noUnusedParameters`. It needs no `afterMount` or `installWork`.

### `packages/qa/runqa.sh`

Loom's [`runqa.sh`](../loom/qa/runqa.sh#L1), changed as follows:

- Arguments: an optional leading `--host <host>` (default `minibrowser`), then `<name> <main|wt> [query-params]`. `HOSTS="minibrowser"`. Before anything else, in this order: an unknown host exits 2 with `unknown host "<host>" (supported: minibrowser)`; a `wt` arm without `QA_WT_LIB` exits 2; a missing arm build exits 2; then `check_host "$host"` runs.
- `check_host`'s `case` has one branch, `minibrowser)`: if `"$MINIBROWSER"` is not executable, print `[<name>] no MiniBrowser at <path> — set QA_MINIBROWSER` and exit 2. It starts nothing.
- `QA` is the script's directory (`packages/qa`); `main` is `QA_MAIN_LIB`, default `$QA/../lib`; `wt` is `QA_WT_LIB`. The build check is `[ -f "$lib/dist/lib/core.es.js" ]`.
- No symlink handling and no `lib=` parameter. `cleanup` (on `EXIT`) calls `stop_host`, kills Vite and removes the marker.
- `PORT=5190`, with a comment that it must match `QA_PORT` in `vite.config.ts`; `kill_vite` greps `:$PORT `. Vite starts as `(cd "$QA" && QA_LIB="$lib" npx vite > "$QA/logs/vite-$name.log" 2>&1 &)`.
- The URL is `http://localhost:$PORT/?qa=$name&host=$host${extra:+&$extra}`.
- `MINIBROWSER` comes from `QA_MINIBROWSER`, default `/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser`.
- `start_host "$host" "$url"` is a `case` on the host that sets `HOST_PID`; its `minibrowser)` branch runs `"$MINIBROWSER" --full-screen "$url" > "$QA/logs/host-$name.log" 2>&1 &` and records `$!`.
- `stop_host "$host"` is a `case` on the host; its `minibrowser)` branch kills `HOST_PID` if it is set, then clears it. `cleanup` calls it, so it must be safe to call when no host started.
- The wait replaces Loom's `timeout … MiniBrowser`: every `POLL_S = 0.5` s, look for the newest `$name-*.json` newer than the marker; stop when one exists, when `kill -0 "$HOST_PID"` fails, or after `QA_TIMEOUT` (default `120` s). Then `stop_host`.
- No result → print `[<name>] NO RESULT — see <vite log>` and exit 1. Otherwise run `python3 "$QA/bin/qa-verdict.py" "$result"`, print its output prefixed `[<name>] `, and exit with its code.
- The header comment's first line after the usage says every run opens a full-screen window on the desktop.

### The analysers

`bin/qa-table.py <results-dir> <name-prefix> [--writes] [--seam] [--before <path>[,<path>…]]` and `bin/qa-forced.py <results-dir> <name-prefix>`, both parsing arguments with `argparse`. Both read `<results-dir>/<prefix>*.json`, oldest first. A file without `"schema": 1` prints `<run> old format, skipped`; a file with `error` prints `<run> ERROR <error>  <notes>`. Each is structured as functions with docstrings and a `main()`, per the global conventions' Python section; so is `qa-verdict.py`.

`qa-table.py` prints one row per phase: `run`, `panel`, `host`, `phase` (driver), `units`, `elems` (`before.elements`), `idle` (`idle.avgMs`), `avg` and `p90` (from `timing`), `work/u`, `sink/u` (sum of `seam.sink`), `geom`, then one column per `--before` path, then the notes. A report with no phases prints one row with `-` in every phase column. `--writes` adds each `writes` entry ≥ 0.05 under the row, as Loom's did; `--seam` adds the `seam.sink` and `seam.source` maps.

`work/u` sums a phase's `work` values, leaving out keys that start `memo.`, `skipped.` or `stubbed.`.[^work-sum] For `work: { "doLayout@LineChart": 1, "getPreferredSize@Text": 3, "memo.getPreferredSize@Text": 2 }` it is `4`.

`geom` compares each phase's `geometry` with the same-index phase of the first file listed (the reference):

| File (oldest first) | Phase 0 geometry | `geom` |
|---|---|---|
| `ab-base-r1` | G | `base` |
| `ab-change-r1` | G | `=` |
| `ab-other-r1` | G′ ≠ G | `DIFF` |
| `ab-plain-r1` | none | `-` |
| any file, when the reference phase has no geometry | G | `?` |

`--before` takes dotted paths into the report's `before` object, and each path becomes a column headed by the path itself. A number or string prints as it is; a missing path or a non-scalar value prints `-`.[^before-cols]

| `--before` | `before` in the report | Columns |
|---|---|---|
| `invisible,host.treeRowsTotal` | `{ invisible: 16, host: { treeRowsTotal: 88 } }` | `invisible` 16, `host.treeRowsTotal` 88 |
| `viewport.w` | `{ viewport: { w: 1920, h: 1080, dpr: 1 } }` | `viewport.w` 1920 |
| `viewport` | same | `viewport` `-` (not a scalar) |
| `host.nope` | `{ host: {} }` | `host.nope` `-` |

`qa-forced.py` prints, per file and phase, the forced reads per unit (`writes` keys starting `forced.`), attributed toggles (keys containing `@`), the top mutations (keys starting `mut.`) and the stacks in `forcedStacks` — Loom's [`qa-forced.py`](../loom/qa/qa-forced.py#L1) moved from the top-level `drag`/`dragWrites` keys to `phases[]`.

---

## Ordered Implementation Steps

Where a step names tests, write them first (they fail), then the code.

1. **Prepare the worktree.** From the worktree root: `ln -sfn <repo>/node_modules node_modules`, `ln -sfn <repo>/packages/lib/node_modules packages/lib/node_modules` (the recipe in `00-baseline.md`), then `npm run build:lib`. Check: `ls packages/lib/dist/lib/core.es.js`.
2. **Package skeleton.** Create `packages/qa/package.json`: `"name": "@jimka/typescript-ui-qa"`, `"version": "0.0.0"`, `"private": true`, `"type": "module"`; scripts `"dev": "vite"`, `"typecheck": "tsc -p tsconfig.json --noEmit"`, `"test": "vitest run --dir tests"`; dependency `"@jimka/typescript-ui": "*"`; devDependencies `typescript ^6.0.3`, `vite ^8.0.16`, `vitest ^4.1.9`, `@types/node ^26.1.2`, `jsdom ^29.1.1` (the docs package's ranges). Create `packages/qa/tsconfig.json` as a copy of [`packages/docs/tsconfig.json`](packages/docs/tsconfig.json#L10) with `include: ["src", "tests", "vite", "vite.config.ts"]`. Add `"packages/qa"` to the root `workspaces` array and run `npm install --package-lock-only`. Check: `grep -c '"packages/qa"' package-lock.json` is at least 1.
3. **`src/harness/types.ts`** — the harness types under *Public API*, each with a JSDoc line.
4. **Test E11, then `src/harness/dom.ts`** — the page helpers from the port map, `fireMouse` with its optional `init`, and `elementOf`. Test file `tests/dom.test.ts`, with the `// @vitest-environment jsdom` pragma (node has no `MouseEvent`).
5. **`src/harness/tree.ts`** — per the port map; `walkComponents`, `findComponent` and `findLayoutManager` take `Body` first.
6. **`src/harness/probes.ts`** — geometry (`setGeometryTargets`, `sampleGeometry`, `takeGeometry`), `snapshotBefore`, `countPaintFeatures`, `findScrollContainers`, `clampTally`.
7. **Tests E1 and E5, then `src/harness/frames.ts`** — `summarize`, `runFrames` (with the `try`), `runPasses`, `measureIdle`, `currentFrame`. Test file `tests/frames.test.ts` (stub `requestAnimationFrame` with `vi.stubGlobal`).
8. **Tests E2 and E4, then `src/harness/counters.ts`** — the write, deep-style, work and seam families, `startCounting`, `stopCounting`, `perUnit`, `bumpWrite`, `bumpWork`, `countMethod`. Test file `tests/counters.test.ts`. Check: `grep -rn "localhost:1420" packages/qa/src` — no matches.
9. **`src/harness/ablations.ts`** — `ABLATIONS` and `dropRuleWrites`. Check: `grep -rnE "'(size\.memo|skip\.unchanged|clamp\.rows|clamp\.once|border\.region-memo|accordion\.seed)'" packages/qa/src` — no matches.
10. **`src/harness/drivers.ts`** — `DRIVERS` with `drag`, `wheel`, `resize`, `passes`.
11. **Tests E3 and E6–E9, then `src/harness/run.ts`** — `runQa`, `createTools`, `parseDrive`, `postReport`, the run order above. Test file `tests/run.test.ts` (stub `location` and `fetch` with `vi.stubGlobal`; a fake `PanelHost`).
12. **Checkpoint.** `grep -rn "@jimka/typescript-ui" packages/qa/src/harness` — no matches. `grep -rlnE "from '(node:|vite)" packages/qa/src` — no matches.
13. **Tests E10 and E12, then `vite/plugins.ts`** — `qaReportPlugin`, `qaLibraryPlugin`, `libraryAliases`, `outsideAppSource`. Fixture `tests/fixtures/lib/package.json` with `name` `@jimka/typescript-ui` and the exports `./core`, `./component/chart`, `./glyphs`, `./glyphs/solid`, `./glyphs/solid/*`, `./glyphs/*`, copied from [`packages/lib/package.json`](packages/lib/package.json#L32). Test file `tests/plugins.test.ts`.
14. **`vite.config.ts`** as under *Internal Structure*.
15. **Tests P1–P5, then `src/panels.ts` and `src/panels/chart-line.ts`.** `panels.ts`: the panel contract under *Public API*, `const LOADERS = import.meta.glob('./panels/*.ts')` (lazy), ids by basename as `idFor` in `demos.ts` does, `getPanelIds()` sorted, `loadPanel(id)`, `parseScale`. Test file `tests/panels.test.ts` with the `// @vitest-environment jsdom` pragma and a top comment explaining it, as docs' `demos.test.ts` has.
16. **Test P6, then `src/mount.ts`, `src/main.ts` and `index.html`** as under *Internal Structure* (P6 goes in `tests/panels.test.ts`). `index.html` is a copy of [`packages/docs/index.html`](packages/docs/index.html#L1) with the title `typescript-ui QA` and the script `/src/main.ts`. Check: `npm -w packages/qa run typecheck` passes.
17. **Checkpoint.** `npm -w packages/qa run test` passes (E1–E12, P1–P6).
18. **`bin/qa-verdict.py`, `bin/qa-table.py`, `bin/qa-forced.py`** (executable), with fixtures `tests/fixtures/report.json` — a `schema: 1` report for panel `chart-line`, `host: 'minibrowser'`, `before` `{ elements: 1200, host: {} }` and one `passes` phase of 10 units carrying `timing`, `seam` (the F26.1 census) and `geometry` for `chart` — and `tests/fixtures/report-error.json` — the same header with `error: 'unknown driver "nope"'` and no phases. Check: `python3 -m py_compile packages/qa/bin/*.py`.
19. **`runqa.sh`** (executable) as under *Internal Structure*. Check: `bash -n packages/qa/runqa.sh`.
20. **`README.md`** (package) — sections: the full-screen-window warning (first, bold); what the app is; running (build the lib first; the runner, its `--host` switch, the `main`/`wt` arms; why there is no symlink step: a worktree's `node_modules` resolves the main tree's build, so the app aliases instead; building a comparison arm with the worktree recipe from `00-baseline.md`); looking at a panel (`npm -w packages/qa run dev`, then `?panel=<id>`); URL parameters; panels (the contract, adding one, the import rule, the symptom rule, and a panel table with `chart-line`'s row and a `Validated:` entry to fill in after the first authorised sweep); built-in drivers; built-in ablations (name and one line each, from Loom's comments); report format; analysers and `qa-verdict.py`; measurement rules (under *Documentation Impact*).
21. **`.github/workflows/qa-tests.yml`** — a copy of [`create-app-tests.yml`](.github/workflows/create-app-tests.yml#L1) named `Test packages/qa`, whose steps after `npm ci` are `npm run build:lib`, `npm -w packages/qa run typecheck` and `npm -w packages/qa run test`.
22. **`.gitignore`** — add `packages/qa/results/` and `packages/qa/logs/` under a `# QA app output (packages/qa/README.md)` comment.
23. **`README.md`** (root, [README.md:78](README.md#L78)) — in the sentence listing the workspace packages, add that `packages/qa` is the private QA app that measures render performance in WebKitGTK.
24. **Automated verification and smoke check** — everything under *Verification* except the manual sweep.
25. **Stop.** Do not run `runqa.sh` with a real host. Report that the manual validation sweep needs the user's go-ahead.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/qa/package.json` |
| Create | `packages/qa/tsconfig.json` |
| Create | `packages/qa/vite.config.ts` |
| Create | `packages/qa/index.html` |
| Create | `packages/qa/runqa.sh` |
| Create | `packages/qa/README.md` |
| Create | `packages/qa/vite/plugins.ts` |
| Create | `packages/qa/bin/qa-table.py` |
| Create | `packages/qa/bin/qa-forced.py` |
| Create | `packages/qa/bin/qa-verdict.py` |
| Create | `packages/qa/src/main.ts` |
| Create | `packages/qa/src/mount.ts` |
| Create | `packages/qa/src/panels.ts` |
| Create | `packages/qa/src/panels/chart-line.ts` |
| Create | `packages/qa/src/harness/types.ts` |
| Create | `packages/qa/src/harness/dom.ts` |
| Create | `packages/qa/src/harness/tree.ts` |
| Create | `packages/qa/src/harness/frames.ts` |
| Create | `packages/qa/src/harness/probes.ts` |
| Create | `packages/qa/src/harness/counters.ts` |
| Create | `packages/qa/src/harness/ablations.ts` |
| Create | `packages/qa/src/harness/drivers.ts` |
| Create | `packages/qa/src/harness/run.ts` |
| Create | `packages/qa/tests/dom.test.ts` |
| Create | `packages/qa/tests/frames.test.ts` |
| Create | `packages/qa/tests/counters.test.ts` |
| Create | `packages/qa/tests/run.test.ts` |
| Create | `packages/qa/tests/plugins.test.ts` |
| Create | `packages/qa/tests/panels.test.ts` |
| Create | `packages/qa/tests/fixtures/lib/package.json` |
| Create | `packages/qa/tests/fixtures/report.json` |
| Create | `packages/qa/tests/fixtures/report-error.json` |
| Create | `.github/workflows/qa-tests.yml` |
| Modify | `package.json` |
| Modify | `package-lock.json` |
| Modify | `.gitignore` |
| Modify | `README.md` |

---

## Expected Behaviour

### Harness, unit-testable (`packages/qa/tests`, node unless noted)

- **E1 `summarize`.** `[10, 20, 30, 40]` → `{ n: 4, avgMs: 25, p50Ms: 30, p90Ms: 40, maxMs: 40, over16: 3 }`. `[]` → every field `0`.
- **E2 `perUnit`.** `perUnit({ apply: 2410, release: 2100, x: 1 }, 10)` → `{ apply: 241, release: 210, x: 0.1 }`, with keys in that order.
- **E3 `parseDrive`.** Every row of the `drive=` table under *Public API*, including the rows that parse `defaultDrive`.
- **E4 seam counter**, over a fake `dom` whose `sink` is an instance of a small class with `apply()` (increments an own field `applied`), `createElementNS()`, and `edit(h)` returning `{ commit: () => this.apply() }`, and whose `source` has `measureText()` calling `this.font()`; `dom.install` assigns what it is given.
  - After `installSeamCounters(dom)`, `dom.sink` and `dom.source` are no longer the original objects.
  - Calls made before `startCounting()` are not tallied.
  - Between `startCounting()` and `stopCounting(1)`: `apply` ×3 and `createElementNS` ×2 → `seam.sink` equals `{ apply: 3, createElementNS: 2 }`.
  - `dom.sink.edit(1).commit()` → `seam.sink` equals `{ edit: 1 }`, and the original sink's `applied` field went up by one.
  - `dom.source.measureText()` → `seam.source` equals `{ measureText: 1 }` (`font` not tallied).
  - `apply` ×4 then `stopCounting(2)` → `apply: 2`.
  - A second `startCounting()` starts from empty tallies.
  - With only the seam counter installed, `stopCounting` returns `seam` and no `writes`, `forcedStacks` or `work`.
- **E5 frame loop.** With `requestAnimationFrame` stubbed to call its callback on a timer: `runFrames(5, i => { if (i === 2) throw new Error('boom'); })` rejects with that error, and the stub is called 3 times in total (no frame after the throw). `runFrames(4, () => {})` resolves with 3 gaps. `runPasses(3, i => { if (i === 1) throw new Error('boom'); })` rejects with it.
- **E6** `runQa` with `location.search` `''` resolves and never calls `fetch` or `panels.setup`.
- **E7** With panel `a` registered, `?qa=t&panel=nope&host=minibrowser` → exactly one `fetch` to `/__qa/report?name=t`, whose JSON body has `schema: 1`, `name: 't'`, `host: 'minibrowser'`, `error: 'unknown panel "nope" (registered: a)'` and no `phases`.
- **E8** With panels `a` and `b` registered, `?qa=t` → error `several panels registered (a, b); name one with panel=`.
- **E9** With panel `a` whose `setup` resolves to `{ defaultDrive: 'passes', targets: {} }`: `?qa=t&drive=nope` → error `unknown driver "nope"`; `?qa=t` → error `panel "a" gives no target for driver "passes"`.
- **E10 `libraryAliases`**, applied first-match-wins by a test helper that mirrors Vite: every row of the alias table under *Architecture Decisions*, against the fixture package (the last row: no alias matches). Against the real `packages/lib`: one alias per `exports` key, and every `replacement` starts with `<packages/lib>/dist/lib/`.
- **E11 `fireMouse`** (jsdom). A listener on a `div` sees each row of the `fireMouse` table under *Architecture Decisions*: the event is a `MouseEvent` with the given `type`, `bubbles` and `cancelable` true, `button` 0, `clientX`/`clientY` as passed, and the row's `buttons` and `relatedTarget`.
- **E12 `outsideAppSource`.** With `root` = `/r/packages/qa`, the matcher returns `false` (watched) for `/r/packages/qa`, `/r/packages/qa/index.html`, `/r/packages/qa/src/panels/chart-line.ts` and `/r/packages/qa/tests/run.test.ts`, and `true` (ignored) for `/r/packages/qa/results/x.json`, `/r/packages/qa/logs/vite-x.log`, `/r/packages/qa/bin/qa-table.py`, `/r/packages/qa/srcx/a.ts` and `/r/packages/lib/dist/lib/core.es.js` — the table under *Architecture Decisions*, plus a sibling whose name only starts with `src`.

### Panels, unit-testable (`packages/qa/tests/panels.test.ts`, jsdom, built library)

- **P1 contract.** For every id in `getPanelIds()`: `loadPanel(id)` resolves to a module whose export names are exactly `build`, `defaultDrive`, `defaultScale`, `description`; `description` is a non-empty string; `defaultScale` is a positive integer; `parseDrive(null, defaultDrive, 1)` does not throw. Let `build = module.build(defaultScale, new URLSearchParams())`. Unless `build.afterMount` exists, `build.targets` has a defined entry for every driver of that parse, and every such driver is a key of `DRIVERS`. `loadPanel('nope')` resolves to `null`.
- **P2 fixture.** `getPanelIds()` contains `chart-line`. Its `build(50, new URLSearchParams()).root` has `getSeries()` of 3 series of 50 points each, with x = 0…49; every y is an integer in [0, 99]; the largest y is 99.
- **P3 first-pass census.** `build(50, new URLSearchParams()).root`: `getElement(true)`, `setWidth(400)`, `setHeight(300)`; `installSeamCounters(DOM)` with `DOM` from `@jimka/typescript-ui/core`; `startCounting()`; `doLayout()`; `stopCounting(1).seam.sink.createElementNS` is `210`. (400 × 300 as in `Chart.test.ts`'s `layout()` helper; the census does not depend on size.)
- **P4 `parseScale`.** `(null, 50)` → 50; `('', 50)` → 50; `('200', 50)` → 200; `'0'`, `'-1'`, `'2.5'` and `'x'` each throw `n: expected a positive integer, got "<raw>"`.
- **P5 import rule.** Over every panel's raw source (a `?raw` glob of `../src/panels/*.ts`), every `from '<specifier>'` either starts with `@jimka/typescript-ui/` or is relative and resolves, from the panel's own directory, to a path inside `packages/qa/src`. `import { x } from '../../../docs/src/demos/foo.js'` would fail.
- **P6 mount sequence.** `mountPanel('chart-line', new URLSearchParams('n=20'), createTools({ Body, DOM }), waits)`, where `waits` records each call and resolves at once, resolves to `n` 20, `targets` with `resize` and `passes` both the root, and a root whose element is in the document. The recorded calls are `painted(root, 'chart-line')` then `settled()`, and nothing more (`chart-line` has no `afterMount`). `mountPanel('nope', …)` rejects with `panel module nope not found` before any wait.

### Typecheck and smoke only

- **`setupPanel`'s forwarding.** The typecheck pins that `installWork` and `defaultDrive` are forwarded into the `Subject`. The `afterMount` merge follows the example under *Internal Structure*; `qa-app-panels` tests it through `mountPanel` once a panel has an `afterMount`.
- **`qa-verdict.py`.** Every row of the verdict table under *Public API*, checked by the smoke script against the two fixtures.
- **Runner arguments.** `runqa.sh --host bogus x main` exits 2 with `unknown host "bogus" (supported: minibrowser)`, and `QA_MINIBROWSER=/nonexistent runqa.sh x main` exits 2 with `[x] no MiniBrowser at /nonexistent — set QA_MINIBROWSER`; neither starts Vite or any window.

### Manual only (a real host; needs the user's go-ahead)

- **M1 per-pass census, in WebKitGTK.** `passes` with `seam=1&count=1` reports, per pass: `seam.sink` = `{ apply: 241, createElementNS: 210, appendChild: 210, removeChild: 210, release: 210 }` (1,081 in total) and `seam.source.measureText` = 12; `writes` has `mut.g.addedNodes` = 210 and `mut.g.removedNodes` = 210.
- **M2 frame pipeline.** `resize` with `seam=1&work=1&geom=1` writes a result; `seam.sink.createElementNS` per frame equals 210 × `work["doLayout@LineChart"]` per frame; `geometry.chart` widths fall for the first 75 frames and rise for the last 75.
- **M3 arms.** A comparison build of the same commit, run as `wt` between two `main` runs, gives the same `seam` and `work` numbers, `geom` `=` against the first run, a different `build` path, and a frame time inside the spread of the two `main` runs.
- **M4 fast failure.** `drive=nope` ends within seconds of the page loading: the runner stops the window and exits 1 printing `ERROR unknown driver "nope"`, instead of waiting for `QA_TIMEOUT`.

---

## Verification

### Automated (the implementer runs these; none opens a window)

1. `npm -w packages/qa run typecheck` and `npm -w packages/qa run test` — E1–E12 and P1–P6. Both need the lib built (step 1).
2. `python3 -m py_compile packages/qa/bin/*.py` and `bash -n packages/qa/runqa.sh`.
3. `packages/qa/runqa.sh --host bogus x main; echo "exit $?"` and `QA_MINIBROWSER=/nonexistent packages/qa/runqa.sh x main; echo "exit $?"` — exit 2 and each message; afterwards `ss -ltn | grep -c ':5190 '` is `0`, so no Vite started.
4. `git diff --stat master -- packages/lib packages/docs` — empty.
5. `grep -rn "@jimka/typescript-ui" packages/qa/src/harness` — no matches.

### Dev-server smoke check (no window, no browser at all)

```sh
cd packages/qa
QA_LIB="$(realpath ../lib)" npx vite > /tmp/qa-smoke.log 2>&1 &
for _ in $(seq 1 80); do curl -sf -o /dev/null http://localhost:5190/ && break; sleep 0.5; done
curl -sf http://localhost:5190/ | grep -c '/src/main.ts'                                       # 1
curl -sf http://localhost:5190/src/main.ts | grep -o '/@fs/[^"]*/dist/lib/core.es.js'          # a path under $(realpath ../lib)
curl -sf -X POST -H 'content-type: application/json' \
  --data-binary @tests/fixtures/report.json 'http://localhost:5190/__qa/report?name=smoke'     # ok
ls results/ | grep -c '\.tmp$'                                                                  # 0
python3 bin/qa-table.py results smoke                                                           # one row, host minibrowser, geom "base"
python3 bin/qa-table.py results smoke --before elements,host.nope                               # adds columns: 1200 and -
python3 bin/qa-forced.py results smoke                                                          # runs without error
python3 bin/qa-verdict.py results/smoke-*.json; echo "exit $?"                                  # the path, exit 0
python3 bin/qa-verdict.py tests/fixtures/report-error.json; echo "exit $?"                      # ERROR unknown driver "nope", exit 1
for pid in $(ss -ltnp | awk '/:5190 /' | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do kill "$pid"; done
rm -f results/smoke-*.json
QA_LIB=/nonexistent timeout 60 npx vite; echo "exit $?"                                         # non-zero, names the missing package.json
```

### Manual measurement sweep (only with the user's go-ahead)

**Every command below opens a full-screen window on the user's desktop. An implementer or agent must not run it.** Prepare a comparison arm of the same commit first (`git worktree add .worktrees/_arm-same HEAD --detach`, symlink `node_modules` and `packages/lib/node_modules` as in step 1, `npm run build:lib` in it). Then, from the repository root:

```sh
export QA_WT_LIB="$PWD/.worktrees/_arm-same/packages/lib"
Q=packages/qa/runqa.sh
$Q val-pass-main   main 'panel=chart-line&drive=passes:10&seam=1&count=1'      || exit 1
$Q val-resize-a    main 'panel=chart-line&drive=resize&seam=1&work=1&geom=1'   || exit 1
$Q val-resize-wt   wt   'panel=chart-line&drive=resize&seam=1&work=1&geom=1'   || exit 1
$Q val-resize-b    main 'panel=chart-line&drive=resize&seam=1&work=1&geom=1'   || exit 1
$Q val-pass-wt     wt   'panel=chart-line&drive=passes:10&seam=1&count=1'      || exit 1
python3 packages/qa/bin/qa-table.py packages/qa/results val- --seam
$Q val-fail        main 'panel=chart-line&drive=nope'; echo "exit $?"           # M4: exit 1, within seconds
```

Accept when M1 holds for both `val-pass-*` runs, M2 and M3 hold for the three `val-resize-*` runs, and M4 holds. Then record the date, the library commit and the numbers in the README's panel table. If M1's numbers differ, compare them with the offline census in the *Addendum* before concluding anything: a mismatch means the app or the library changed, and the panel is not validated until it is explained.

---

## Documentation Impact

- **No public API change.** Nothing is exported from `@jimka/typescript-ui`; TypeDoc, `llms.txt` and the changelog are untouched.
- **`README.md`** (root) — the workspace-packages sentence ([README.md:78](README.md#L78)) names `packages/qa`.
- **`packages/qa/README.md`** carries the measurement rules. It must state each of these, with its source:
  - Compare only runs from one session: absolutes drift 8–14% between sessions on the same build ([00-baseline.md:176](plans/research/render-review-2026-09-15/00-baseline.md#L176)).
  - Interleave the arms in one sweep, and run the baseline arm at both ends so drift shows ([00-baseline.md:186](plans/research/render-review-2026-09-15/00-baseline.md#L186), [97-wave2-measurement.md:3](plans/research/render-review-2026-09-15/97-wave2-measurement.md#L3)).
  - Compare only runs from the same host (`host` column); a MiniBrowser window and a Tauri webview embed the engine differently.
  - Give every arm the same instrument flags (`count`, `work`, `seam`, `geom`); the instruments cost time.
  - Geometry equality is the soundness gate: an arm whose `geom` column reads `DIFF` laid the page out differently, and its timing is void ([97-wave2-measurement.md:62](plans/research/render-review-2026-09-15/97-wave2-measurement.md#L62)).
  - Check a deep panel and a shallow one; a change can hold geometry on one and break it on the other. Never bound a document-wide cost on the small panel ([00-baseline.md:339](plans/research/render-review-2026-09-15/00-baseline.md#L339)).
  - An ablation bounds only the code it reaches in the panel it runs in; confirm it engaged through its own counters ([97-wave2-measurement.md:157](plans/research/render-review-2026-09-15/97-wave2-measurement.md#L157)).
  - Score work avoided as well as milliseconds (`work/u` column).
  - A green test suite is not evidence of unchanged geometry ([97-wave2-measurement.md:177](plans/research/render-review-2026-09-15/97-wave2-measurement.md#L177)).
  - Fail loudly: an error result or a run with no result exits 1, a sweep stops on the first (`|| exit 1`), and `qa-table.py` prints `ERROR` rows.
  - `forced.*` counts under-count reads dirtied by inline-style writes, and `geom=1` adds the probe's own reads; they corroborate, never lead.
  - Measure in WebKitGTK; Chromium can miss paint-bound costs entirely.
  - A panel reproduces an outside behaviour only when a run shows the same symptom.

---

## Potential Challenges

- **A dependency discovered after page load makes Vite reload the page mid-run.** Vite's startup scan covers `index.html` and follows the lazy panel glob; if a run ends in `NO RESULT`, look for `optimized dependencies changed. reloading` in `packages/qa/logs/vite-<name>.log` and re-run.
- **A stale arm.** The alias serves whatever `dist/lib` holds, and `build` in the report names a path, not a commit. Rebuild every arm (`npm run build:lib`) before a sweep.
- **The guard never fires if it is not `enforce: 'pre'`.** Vite's own resolver would answer first. E10 cannot catch this; the smoke check's `grep` for the aliased `core.es.js` path covers the alias half.
- **A throw outside the frame loop but inside the library's own rAF callbacks** is caught by the library's layout flush, not by the harness; it shows as a wrong count or geometry, not as an error result.
- **MutationObserver records arrive in a microtask.** The records of a unit are delivered before the driver's promise continues, so they land inside the counting window; a new driver must end on a resolved promise, not a timer.
- **The proxy sink adds a function call to every seam call.** Give every arm `seam=1` or none.
- **Typecheck and panel tests read the built library.** Build the lib first; the CI workflow builds it before them.
- **jsdom has no reliable `requestAnimationFrame`.** P3 lays the chart out by direct calls instead of mounting it in `Body`; E5 stubs the frame callback.

---

## Critical Files

- [`../loom/qa/qa-harness.ts`](../loom/qa/qa-harness.ts#L1) — the source of the port; read it whole.
- [`../loom/qa/vite.config.qa.ts`](../loom/qa/vite.config.qa.ts#L28), [`../loom/qa/runqa.sh`](../loom/qa/runqa.sh#L1), [`../loom/qa/qa-table.py`](../loom/qa/qa-table.py#L1), [`../loom/qa/qa-forced.py`](../loom/qa/qa-forced.py#L1), [`../loom/qa/README.md`](../loom/qa/README.md#L1).
- [`packages/docs/package.json`](packages/docs/package.json#L1), [`packages/docs/tsconfig.json`](packages/docs/tsconfig.json#L10), [`packages/docs/index.html`](packages/docs/index.html#L1), [`packages/docs/src/main.ts`](packages/docs/src/main.ts#L22) — the standalone Vite app precedent.
- [`packages/docs/src/content/demos.ts`](packages/docs/src/content/demos.ts#L29) — the glob-registry precedent.
- [`packages/docs/tests/demos.test.ts`](packages/docs/tests/demos.test.ts#L1) and [`demo-catalogue.test.ts`](packages/docs/tests/demo-catalogue.test.ts#L1) — jsdom and raw-source contract-test precedents.
- [`packages/lib/package.json`](packages/lib/package.json#L32) — the `exports` map the aliases derive from.
- [`packages/lib/vite.config.ts`](packages/lib/vite.config.ts#L9) — the ordered alias-array precedent.
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts#L2873) — `DOMSeams`, `DOM.install`, and `ProductionDOMSink.edit` at :1734.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts#L450) — `RecordingDOMSink`, whose `op` names the seam counter mirrors.
- [`packages/lib/src/typescript/lib/component/chart/AbstractChart.ts`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts#L574), [`ChartAxis.ts`](packages/lib/src/typescript/lib/component/chart/ChartAxis.ts#L102), [`Scale.ts`](packages/lib/src/typescript/lib/component/chart/Scale.ts#L38) — what the census counts.
- [`packages/lib/tests/component/chart/Chart.test.ts`](packages/lib/tests/component/chart/Chart.test.ts#L1) — the `layout()` helper P3 mirrors.
- [`plans/research/render-review-2026-09-15/26-charts-canvas-video.md`](plans/research/render-review-2026-09-15/26-charts-canvas-video.md#L40) — F26.1 and F26.2.
- [`00-baseline.md`](plans/research/render-review-2026-09-15/00-baseline.md#L176) and [`97-wave2-measurement.md`](plans/research/render-review-2026-09-15/97-wave2-measurement.md#L1) — the measurement rules.
- [`.github/workflows/create-app-tests.yml`](.github/workflows/create-app-tests.yml#L1) — the CI precedent.

---

## Non-Goals

- **Touching Loom.** Loom's `qa/` stays as it is. A later Loom plan removes Loom's harness once the QA app's Loom-like panels have their own baselines.
- **Touching the docs site.** Panels do not import docs demos, and nothing is added to `packages/docs`.
- **More panels and new drivers** (store update, hover, click, key, a drag parked against a clamp) and `suspendCounting` — `qa-app-panels`.
- **The Tauri host** — `qa-app-tauri`, which adds a `tauri` name to `HOSTS` and a branch to each of `check_host`, `start_host` and `stop_host`, and loads the same page.
- **Running a real host from automated checks**, or any headless-browser substitute for the WebKitGTK run.
- **A production build of the app**, or publishing `packages/qa`.
- **Framework counters from `readFrameworkCounts()`, empty-apply counts, and stale-build detection** — added when a panel needs them.

---

## Addendum: F26.1 like-for-like

**What the record counted.** Slice 26's probe `chart-pass.probe.test.ts` laid out a 3-series × 50-point `LineChart` (legend on) under Vitest with the modelled DOM, cleared the `RecordingDOMSink` log, called `doLayout()` once more with unchanged bounds and data, and counted log entries by `op`: `{apply: 241, removeChild: 210, release: 210, createElementNS: 210, appendChild: 210}` = 1,081 ([26-charts-canvas-video.md:65](plans/research/render-review-2026-09-15/26-charts-canvas-video.md#L65)). The 210 marks are 3 paths, 150 point circles and 57 axis marks. F26.2 adds 12 `DOM.source.measureText` calls per pass.

**What the app counts.** The `passes` driver makes the same call — `doLayout()` on an unchanged chart — inside a counting window, and the seam counter tallies `DOM.sink` and `DOM.source` calls by method name, the recording sink's own `op` names. `count=1` adds an independent view from the engine itself: its MutationObserver sees 210 nodes added and 210 removed under the chart's unclassed `<g>` groups per pass.

**Re-measured offline for this plan.** On 2026-09-19, master `72916718`, with the panel's fixture under the modelled DOM, one unchanged pass counted exactly the record's split — 1,081 in total — and 12 `measureText` calls, at both 400 × 300 and 1280 × 800; an empty chart counted 289, also as recorded.[^census] The record still holds on today's library, and the fixture reproduces it.

**What differs, and why the comparison still holds:**

| | Record | App | Effect on the count |
|---|---|---|---|
| Sink behind the seam | `RecordingDOMSink`, which logs and touches nothing | `ProductionDOMSink`, which writes the real DOM | none; the one self-call (`edit` → `apply`) is not on a layout pass |
| Fixture | lost with `.worktrees/_probes/` | new, chosen for the same census | agreement shows the chart has the same shape, not that the data is the same |
| Library | source, run by Vitest | the built `dist/lib`, run by WebKitGTK | this difference is what the validation run tests |
| Size | not recorded | full screen | none: tick counts come from the data domain, not the pixel range |
| Unit | one layout pass | one pass (`passes`) and one frame (`resize`) | only the per-pass figure has a record; per-frame figures are the first real-engine chart numbers |

---

## Notes

[^home]: The user decided that the QA app is standalone: it holds its own page, config, endpoint, alias, harness, runner, analysers and panels, and nothing is injected into another app. A workspace package is where this repo keeps a separately owned app with its own tests and scripts (`packages/docs`, `packages/create-app`), and its tests then run under `npm -w packages/qa run test` and release-steps' `npm test --workspaces --if-present`. A top-level directory like `build/` holds one shared constant with no tests; inside `packages/lib` the harness's raw DOM would break `local/no-raw-dom`, and none of it ships.

[^version]: `0.0.0` because it is never released. `packages/docs` carries the library's version because the site documents it; nothing reads the QA app's version, so it stays out of `release-steps.md`'s bump list.

[^inject]: The harness could import `Body` and `DOM` itself now that the app is its only user, since every import goes through the same aliases. Passing them in keeps `src/harness/` free of the library, and `core` is the one entry point that touches the DOM on import (`Body`'s singleton, the known exception in `import-without-dom.test.ts`). So the harness's counters, frame loop, drive parser and error paths can be tested in plain node with fakes, as E1–E9 do.

[^alias]: The first recommendation on record (post-campaign agenda, Phase 1, item 2) was to alias `@jimka/typescript-ui` to the arm's `dist/lib`. Vite's alias matching (`matches()` in `node_modules/vite/dist/node/chunks/node.js`) treats a string `find` as matching the id itself or `id/…` and swaps the prefix. So `@jimka/typescript-ui/core` would become `<dist>/core`, but the file is `core.es.js`; `component/chart` needs `component/chart.es.js`; `glyphs/solid` needs `glyphs/solid/index.es.js`. Each subpath needs its own entry. Deriving them from the arm's own `exports` keeps them exact and lets a newer arm resolve an entry point the main tree lacks. Exact keys become anchored regexes because a string `find` would also capture deeper subpaths. The guard exists because an unaliased import would silently fall through to normal resolution — the `node_modules` symlink, the main tree's build, and a second module instance whose prototypes the counters never see. It must be `enforce: 'pre'` because `resolveId` is first-wins and Vite's own resolver runs before normal-order plugins; aliasing runs before both. The lib's [vite.config.ts:9–33](packages/lib/vite.config.ts#L9) is the in-repo precedent for an ordered alias array with regex entries, most specific first.

[^port-number]: 5190 is fixed so the runner can kill a stale QA server by port without touching anything else, and it is none of the ports already in use: 8015 (the lib's demo app), 5173 (Vite's default, used by the docs dev server), 5174 and up (Vite's fallbacks when 5173 is busy), 4173 (`vite preview`), and 1420 (Loom). A Tauri shell will load the same URL, so the port is also the address that host is given.

[^fs-allow]: Setting `server.fs.allow` replaces Vite's default, which is the workspace root. `searchForWorkspaceRoot(ROOT)` puts that default back, covering the app, the root `node_modules` and any worktree inside the repo; `LIB_DIR` adds an arm that lives in another clone.

[^tauri-ready]: The user wants every panel measurable in Tauri as well as in a browser, added later by `qa-app-tauri` without changing this plan's code. A Tauri app can point its webview at a dev-server URL; if the page reports through the same Vite endpoint and calls no host API, that shell only has to open the URL and be stoppable, which is what the runner's host functions already require of MiniBrowser. Recording `host` lets the analysers keep the two engines' numbers apart.

[^lazy]: `demos.ts` globs eagerly because it must resolve a demo synchronously and show its source text. The QA page needs neither. An eager glob would put every panel's modules — and their load-time stylesheet writes — on every panel's page, so adding a panel would change the page every other panel is measured on.

[^panel-imports]: The user's rule: a baseline must move only when the library moves. A panel that imported a docs demo would change whenever someone edits the demo for documentation reasons. The same holds for the lib's demo-app panels (`packages/lib/src/typescript/*Panel.ts`), which are demos too. Shared panel code, such as data generators, lives in `packages/qa/src` where the import rule allows it.

[^symptom]: The user's rule. A panel built to look like another app's screen can easily exercise a different code path; only the same symptom — a count, a failure, a geometry — shows that it reaches the same code. Recording the evidence in the README's table keeps "which panels are trusted" visible in one place.

[^mount-waits]: The panels plan found that `mountPanel`'s default wait cannot finish in jsdom: nothing paints there, so `isPainted` stays false until the 10 s cap, and each settle is a real one-second sleep. A mount test would then have to copy `mountPanel`'s steps, and the copy could drift from the real sequence. Passing the two waits in keeps one sequence for the page and for tests. Two hooks rather than one, because the sequence waits at two different points — first paint, then after each change — and a test usually wants to flush layout at the first (so `afterMount` finds the elements layout creates) and do nothing at the second. The defaults are today's waits unchanged, so `setupPanel`, `previewPanel` and every run behave as before.

[^panel-hooks]: `build(n)` runs before `Body.init`, so no element exists yet — not the panel's own, and not the `SplitGutter`s that `Split.doLayout` creates; hence `afterMount`. A single target per driver cannot express a choice like Loom's `gutter=`, and a new panel id per choice would multiply ids without changing the tree; hence `params`. `installWork` lets a panel count its own hot methods, which the harness's class-level counters cannot single out. `afterMount` is synchronous and followed by a second settle, the shape the reworked panels plan expects. Keeping drivers in one table, rather than per panel, means a new kind of gesture is written once and every panel can name it. TypeScript accepts a `build(n)` implementation for the `build(n, params)` member, so a panel that reads no parameter declares none.

[^run-order]: Kept from Loom. Write counters are installed before ablations, so an ablation that replaces a prototype method the counters also wrap still has its DOM writes counted. Work counters come after ablations, because a count taken under an ablation must reflect the ablated code ([qa-harness.ts:2145](../loom/qa/qa-harness.ts#L2145)); the seam counter follows them for the same reason. Checking the drive list before instrumenting makes a typo fail in a second rather than after a minute.

[^per-phase]: Loom counts only during its drag, because each of its runs has one counted gesture. With `drive=` listing several phases, per-phase counts keep one phase's work out of another's figures.

[^default-drive]: Panels that rebuild Loom's scenarios need several default phases: Loom's recorded query strings carry no `drive=`, yet its harness ran up to three phases for them — a drag, a resize when `resize=<n>` was given, and a 120-frame wheel scroll — and S4's headline number is its resize phase. A single-name default would drop phases silently. Reading the default with the `drive=` grammar keeps one parser and one error message. An empty default is legal because Loom's harness ran `collapse=1` with no `resize=` as idle frames only.

[^frame-throw]: In Loom's loop a throw inside the `requestAnimationFrame` callback escapes to the browser: the promise never settles, the run never reports, and the runner waits out its timeout and prints `NO RESULT`, which hides the cause. Rejecting sends the throw down the path every other failure already takes, so it reaches the result, the analysers and the runner's exit code. `runPasses` needs no change, because its loop runs inside the driver's own promise chain.

[^host-switch]: The user asked for a host switch now so that `qa-app-tauri` only adds code. Everything host-specific is in `check_host`, `start_host` and `stop_host`; the arm, Vite, the URL, the wait and the verdict are shared. Checking the host before Vite starts means a typo or a missing program fails in a second and never leaves a server or a window behind. Giving `stop_host` a `case` too, even though its one branch only kills a process, keeps "one branch per function" true for a host that needs a gentler stop.

[^own-source]: Two of the directories the app itself writes are live during every run: `results/` gets each report, and `logs/` gets the host's output and the Vite server's own log, which the server writes to continuously while it runs. A watcher on them wakes the server during a measurement for files the page never loads. A list of what to watch, rather than a list of what to skip, also keeps out anything later added to the package — build output, scratch files — without naming it. The dependency scan's default, every `.html` file under the root, would treat a stray HTML file there as a page; Vitest's default, every `*.test.ts` under the root, would walk those trees on every run. Config files are not watched either, so a config change needs a server restart, which the runner does on every run anyway. Loom's `vitest.config.ts` scopes its tests the same way (`include: ['tests/**/*.test.ts']`, [vitest.config.ts:8](../loom/vitest.config.ts#L8)).

[^verdict]: Loom's runner runs `timeout 55 MiniBrowser …`, so every run lasts the full 55 s whatever the page does, and an error result looks like a success until someone reads the file. Watching for the result ends a run as soon as it has one and lets a failing run fail at once. The check lives in `qa-verdict.py` so the smoke script can test it against fixtures without a window. 120 s is about twice the longest Loom-shaped run on record (S1, ~110 ms per frame over some 360 measured frames plus setup): room for a cold dev-server start, while a hang still ends within two minutes. The rename in `qaReportPlugin` makes the file appear only when complete, so the runner never parses half of it.

[^seam]: The native counters count DOM mutations, not sink calls: `createElementNS` and `release` never reach a MutationObserver, and one `apply` can be several attribute and style writes. Counting at the seam gives the recording sink's taxonomy on the production sink. Calling each method with the real object as `this` keeps the sink's own field writes (`ProductionDOMSink` assigns `_indexedSheet`, for example) on the real object, and keeps its calls to its own methods uncounted — the recording sink's methods do not call each other either. The one difference: `ProductionDOMSink.edit()` returns a builder that commits through the sink's own `apply`, which the proxy never sees, so `edit(...).commit()` counts as one `edit` where the recording sink logs one `apply`. The library has two `edit` call sites (`core/Component.ts:1557`, `core/SpatialNavigation.ts:627`), neither on a layout pass. No library code keeps `DOM.sink` in a variable or checks its identity (no `= DOM.sink`, no `instanceof ProductionDOMSink`), so a swapped sink is seen everywhere.

[^geom]: DOM rectangles rather than the components' cached bounds, because an ablation can change what is painted without changing what a component believes its size is. Every unit rather than a few fixed frames, because a pane that only catches up at the end of a drag looks right at the extremes and wrong in between — the reason Loom added `widthSeries` ([qa-harness.ts:185](../loom/qa/qa-harness.ts#L185)). Each sample forces a layout, which is why the probe is opt-in and why the arms of a comparison must all carry it or all omit it.

[^fire-mouse]: A hover or click driver needs `mouse*` events with `buttons: 0`, because a handler that checks the button state reads a `mousemove` with `buttons: 1` as a drag, and it needs `relatedTarget` on out and over events. With this `init` such a driver builds every `MouseEvent` through the one tool; without it, it would need a second `MouseEvent` builder. Pointer events still need their own small helper, because a `PointerEvent` is a different event class with fields `fireMouse` does not carry (`pointerId`, `pointerType`); one helper for both families would have to switch on the type prefix and grow a union of options. The default keeps Loom's rule, so `drag` calls it unchanged.

[^fixture]: The chart asks d3 for 8 ticks per axis ([ChartAxis.ts:34](packages/lib/src/typescript/lib/component/chart/ChartAxis.ts#L34)) on a `nice()`d linear domain ([Scale.ts:38](packages/lib/src/typescript/lib/component/chart/Scale.ts#L38)). With x = 0…49 the x domain nices to [0, 50], giving 11 ticks; with y in [0, 99] and 99 present, the y domain nices to [0, 100], giving 11 ticks. Axis marks are 2 axis lines, plus 3 per left tick (gridline, tick, label), plus 2 per bottom tick: 2 + 33 + 22 = 57. Axis titles would add one mark each, so the panel sets none. Series marks are 3 paths plus 3 × 50 point circles: 153. The same arithmetic gives 57 for an empty chart (both domains [0, 1]), matching the record's 289-op empty pass. Because the tick counts come from the data domain, the census is the same at any size.

[^census]: A throwaway probe for this plan (not committed) built the fixture with `_LineChart`, laid it out under `installTestDOM` the way `Chart.test.ts`'s `layout()` helper does, and counted the second pass: `{apply: 241, removeChild: 210, release: 210, createElementNS: 210, appendChild: 210}` and 12 `measureText` source calls, at 400 × 300 and 1280 × 800. The first pass created 210 elements; the `<svg>` and its three groups are created at render, before any pass ([AbstractChart.ts:533](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts#L533)), which is what P3 relies on.

[^ablations]: `size.memo`, `border.region-memo` and `accordion.seed` bound changes wave 2 implemented (`size-hint-per-pass-memo`, `border-region-size-memo`, `accordion-seed-pass-economy`), and `skip.unchanged` bounds G09, implemented staged as `unchanged-commit-skip-staged`. On today's library each would stack a second memo or skip on top of the real one. `clamp.rows` and `clamp.once` bound G10, dropped in `97-wave2-measurement.md`. Every other entry still bounds code that exists unchanged; `split.noop-drag` (F06.3) and `split.recalc-gate` (F06.4) are wave-3 candidates the agenda names.

[^port]: The implementer is a smaller model, and "move this function, change only this" is safer than "rewrite this idea". Loom's file predates the conventions: most helpers have no JSDoc; literals such as `16.7`, `40`, the 4 stored stacks and `slice(2, 12)` are unexplained; and `installWriteCounters` (164 lines) and `run` (250 lines) break the decomposition rule.

[^raw-dom]: The harness must see what the engine sees: it counts native DOM writes, wraps `CSSStyleDeclaration` accessors and replaces library methods on their prototypes. Routing that through the library's seam would hide the calls it counts. `packages/lib/eslint.config.js` applies `local/no-raw-dom` to `src/**/*.ts` of `packages/lib`, which `packages/qa` is not part of.

[^prior-art]: `perf/Benchmark.ts` (605 lines) is a set of in-browser micro-benchmarks for the lib's demo app, reached through `window.bench`: it mounts a `Table` into a hand-made off-screen `<div>` and compares against a committed baseline with a 15% threshold. It has no frame driver, counters or report, and a committed baseline is exactly what the campaign found invalid, since absolutes drift 8–14% between sessions. The demo app puts a tab bar in every frame and has no scale parameter, and under the import rule its panels are demos a QA panel must not import. `readFrameworkCounts()` (`@jimka/typescript-ui/diagnostics`) exposes layout-pass and stylesheet-rule counters that would fit as an optional `HarnessLibrary` field; this plan's validation needs none of them, and adding an optional field later breaks nothing.

[^schema]: A results directory outlives the format that wrote it. With a version field, a later format change can be told apart and old files skipped instead of misread.

[^before-cols]: Loom's old table printed tree rows, editors, invisible, undisplayed and tree height, and the campaign used those columns to confirm that two sessions measured the same scene (`00-baseline.md`, *The run validated itself*). Panel-specific fields live under `before.host`, whose keys the analyser cannot know, so the columns are chosen per call rather than fixed.

[^work-sum]: Wave 2's sweep compared total work per frame "with the ablation's own memo/skip/stub counters excluded, so this is real work removed, not bookkeeping" ([97-wave2-measurement.md](plans/research/render-review-2026-09-15/97-wave2-measurement.md#L1), *Re-scored on work avoided*). Loom's ablations name those counters `memo.*`, `skipped.*` and `stubbed.*`.

---

## Implementation Notes

Where the implementation departs from the plan, and what verified it.

- **An error report's `error` is the thrown message, not `String(error)`.** *Internal Structure* says the error path posts `error: String(error)`, which for an `Error` reads `Error: unknown driver "nope"`. E7, E9, the verdict table and M4 all expect the bare message, so `runQa` posts `error.message` for an `Error` (and `String(error)` for anything else thrown), and `stack` only for an `Error`.
- **`stopCounting` also reports a family that recorded something.** The plan returns the tallies of the *installed* families. An ablation's own counters (`skipped.split.onDrag`, `skipattr@…`, `skip@…`) tally into `work` or `writes` through `tools.bumpWork` and `tools.bumpWrite`, and Loom always reported them; returning installed families only would drop them on a run without `work=1` or `count=1`. So a family is reported when it is installed or when anything tallied into it during the window. E4 is unaffected: with only the seam counter installed and nothing else tallied, `stopCounting` returns `seam` alone. `tests/counters.test.ts` pins the extra rule (a fresh module, `bumpWork` and `bumpWrite` with no family installed), and the README's ablation section says so.
- **`types.ts`'s `HarnessLibrary` comment is reworded.** The plan's own comment names `` `@jimka/typescript-ui/core` ``, which step 12's checkpoint (`grep -rn "@jimka/typescript-ui" packages/qa/src/harness` — no matches) and Verification 5 would then fail on. It now says "the library's `core` entry point".
- **Step 1 links only the root `node_modules`.** The main tree's install is hoisted: its `packages/lib/node_modules` holds only Vite's `.vite` and `.vite-temp` caches, no packages, so the second link of the `00-baseline.md` recipe would add nothing. The build and every check ran with the root link alone, and the README's arm recipe says when the second link is needed.
- **`qa-table.py`'s reference is the first *successful* report listed.** An error or old-format file has no phases to compare against, so taking the literal first file would turn every `geom` cell into `?`. With a successful first file the two rules agree.
- **`qa-verdict.py` treats any `schema` other than `1` as `OLD FORMAT`**, matching `qa-table.py`'s "without `"schema": 1`" rule; the plan's table names only the missing-field case.
- **`runqa.sh` looks for the result once more after stopping the host**, so a result written between the last poll and the host's exit is not reported as `NO RESULT`.
- **The library-build plugin also serves the arm's `dist/lib/assets` at `/assets/`.** The plan gives the plugin the aliases alone, which covers what the page *imports* but not what the built library fetches by URL at runtime: its store starts a worker with `new Worker('/assets/StoreWorker-<hash>.js')`, an absolute path from the site root that the app serving the page has to answer. The first authorised WebKitGTK sweep found a panel whose store holds 1,000 records or more (`WORKER_THRESHOLD`) never getting a view — the store-backed panels are downstream, on `feature/qa-app-panels`, but the plugin they need is here. The request was not even a visible failure: Vite answers an unknown path with the page's own HTML, so the worker was handed that instead of a script, and `StoreWorkerClient` sets only `onmessage`, so the request never settled. The plugin now maps that prefix onto the arm's own build by directory, never by the build-specific hashed name, so a `wt` run gets that arm's worker; it refuses a path that climbs out of the directory or carries a malformed escape; and a build with no `dist/lib/assets` stops the server at startup naming the arm, rather than failing later in a way that looks like a panel bug. jsdom has no `Worker` that loads a URL, so `tests/plugins.test.ts` pins the file mapping and the startup refusal, not the store behaviour that needs them; a dev-server check served the worker at `/assets/<name>.js` as `text/javascript` and confirmed that an unserved `/assets/` path answers `200 text/html`. **The library defect underneath — a published build asking for a site-root path, and a store that stays silent when nothing answers — is recorded separately and is not fixed here.**

**Verification run.** `npm -w packages/qa run typecheck` and `npm -w packages/qa run test` (E1–E12, P1–P6, the `stopCounting` rule above and the `/assets/` mapping below: 80 tests, P3 counting exactly 210 `createElementNS` in one first pass under jsdom) pass; `python3 -m py_compile` and `bash -n` pass; `runqa.sh --host bogus x main` and `QA_MINIBROWSER=/nonexistent runqa.sh x main` exit 2 with their messages and leave port 5190 free; `git diff --stat master -- packages/lib packages/docs` is empty. The dev-server smoke check passed in full: the page serves `/src/main.ts`, `core.es.js` resolves under this checkout's `packages/lib`, the fixture POST writes one file and no `.tmp`, the analysers print the expected rows (`base`, the `--before` columns `1200` and `-`), `qa-verdict.py` exits 0 and 1 on the two fixtures, and `QA_LIB=/nonexistent npx vite` exits 1 naming `/nonexistent/package.json`. Beyond the plan's list, a throwaway module importing `@jimka/typescript-ui/nope` confirmed the guard fails it with `… is not exported by the library build at …`.

**Still to do: the manual sweep (M1–M4).** None of the runs under *Manual measurement sweep* has been made: each opens a full-screen window, and only the user authorises them. `chart-line`'s README row reads "Not yet" until the first authorised sweep fills in the date, the library commit and the numbers. Two things to allow for when reading it: the `resize` driver's width restore (one more `doLayout()` after the last frame) falls inside the phase's counting window, so M2's per-frame figures include 151 passes over 150 frames, and the check `createElementNS` = 210 × `doLayout@LineChart` holds on the raw counts but not exactly after both are rounded to hundredths; and `qa-table.py`'s reference is the first successful report listed, so the sweep's `qa-table.py … val- --seam` takes `val-pass-main` (no geometry) as reference and prints `?` in every `val-resize-*` row — read M3's `geom` column with the prefix `val-resize`.
