---
depends-on: [qa-app]
touches-shared:
  - packages/qa/src/harness/types.ts
  - packages/qa/src/harness/dom.ts
  - packages/qa/src/harness/frames.ts
  - packages/qa/src/harness/counters.ts
  - packages/qa/src/harness/drivers.ts
  - packages/qa/src/harness/run.ts
  - packages/qa/src/mount.ts
  - packages/qa/src/panels/chart-line.ts
  - packages/qa/tests/counters.test.ts
  - packages/qa/tests/panels.test.ts
  - packages/qa/README.md
---

# QA App Panels — Implementation Plan

## Overview

`qa-app` (the QA app plan) builds `packages/qa`, a standalone app that measures the library in WebKitGTK. It includes the harness, the panel contract and one validation panel, `chart-line`. This plan adds what wave 3 of the render-review campaign needs before any of it is planned: panels at application scale, and the drivers those panels need. Wave 3's candidates are listed in [`00-post-campaign-agenda.md`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L110) (Phase 3), and their scope is in [`99-synthesis.md`](plans/research/render-review-2026-09-15/99-synthesis.md#L1227) ("Proposed plan groups"). In those files, G-numbers are plan groups, F-numbers are slice-report findings, and C-numbers are correctness bugs. Paths to Loom are relative to this repo's root, as in the QA app plan.

The work is too large for one reviewable plan, so it is split in two.[^split] This plan delivers:

1. **Ten new drivers** in the harness's one `DRIVERS` table: `idle`, `call`, `update`, `toggle`, `hover`, `park`, `click`, `key`, `type` and `theme`. The harness also gains two tools, `suspendCounting` and `waitFrames`, and a `countCssRules` helper. Every harness change is an addition.
2. **Page-wide `idle` and `theme` targets**, which `mountPanel` merges under every panel's own targets.
3. **Nine panels**:
   - `shell-deep` and `shell-shallow`, which stand in for Loom's S1 and S3 scenarios;
   - `table-rows`, `treetable-rows`, `tree-nodes`, `list-items`, `chart-dashboard`, `markdown-doc` and `canvas-idle`.

   `chart-line` also gains `update` and `hover` targets.
4. **A coverage map.** Every wave-3 candidate, and every correctness bug with a runtime signal, is mapped to a panel and a driver.
5. **A validation figure for every panel.** Each was re-measured offline, or confirmed in the code, on today's `master`.

The follow-up plan `qa-app-panels-editors-overlays` adds the diagram, code-document, Markdown-editor, window, form, menu and wide-table panels (see *Non-Goals*). Only `packages/qa` changes.

---

## Architecture Decisions

### Two plans; this one is the drivers, the Loom stand-ins and the agenda's "first scenes"

This plan builds the scenes the agenda names first: a line chart, a Split drag that parks against its clamp, table scroll and column resize, tree expand and collapse, and a Markdown viewer resize. It adds two more:

- the list panel, the smallest reproduction of a recorded census (a per-pass count of DOM seam calls, F18.2);
- the canvas panel, because the correctness phase needs C35 and C36 confirmed in the engine.

The shells are here because they are the panels Loom's harness will later be measured against. The coverage map names the follow-up plan's panel wherever a candidate needs one.[^split]

### Every driver is in the one table; the harness stays free of the library

All ten drivers join `DRIVERS` in `src/harness/drivers.ts`. `update` and `toggle` are named copies of `call`, made by `makeCallDriver(<name>)`.

`theme` needs the library to switch themes, and the harness imports nothing from it. So `theme`'s target is a `ThemeTarget` object, `{ cycle(index), restore() }`, built on the page side by `themeTarget(themes)` in the new `src/pageTargets.ts`. The driver itself only calls the target and counts CSS rules.[^driver-home]

| Driver | Target |
|---|---|
| `idle` | any defined value; ignored |
| `call`, `update`, `toggle` | `(index) => void` |
| `hover` | `{ element, axis }` |
| `park` | `{ element, axis, direction, leadPx }` |
| `click` | `{ elements }` |
| `key` | `{ element, keys }` |
| `type` | `{ element, text }` |
| `theme` | `ThemeTarget` |

### The harness changes only by addition

The existing drivers, URL parameters, run order and report format stay as the QA app plan has them. Besides the ten drivers, the harness gains `makeCallDriver`, the target types, `countCssRules` in `dom.ts`, and two `HarnessTools` members: `suspendCounting` and `waitFrames`.

### Drivers keep their setup and teardown out of the counters

The counting window is the span between `startCounting` and `stopCounting`, in which every counter tallies. A driver's own setup stays out of it: reading rectangles, focusing, a `park` lead-in and restore drag, a `type` clean-up. `suspendCounting(work)` pauses every counter family while `work` runs, and restores the previous state afterwards, even if `work` throws.[^suspend]

### Pointer drivers dispatch pointer and mouse events, with the buttons state a real mouse has

`hover` and `click` dispatch both event families, in the order a browser does:

- `hover` sends `pointerout`/`mouseout`, then `pointerover`/`mouseover`, when the element under the pointer changes. It then sends `pointermove` and `mousemove` for the unit's position.
- `click` sends `pointerdown`, `mousedown`, `pointerup`, `mouseup` and `click`.

Every event bubbles and carries `buttons: 0`, except the two presses (`buttons: 1`).[^pointer-events]

Each pointer/mouse pair goes through one private helper, `firePair(tools, kind, target, x, y, init)`. It dispatches `pointer<kind>` through the private `firePointer`, then `mouse<kind>` through `tools.fireMouse(…, init)`, the QA app plan's helper with its optional `{ buttons, relatedTarget }`. `click` has no pointer twin, so it goes through `tools.fireMouse` alone. `park` calls `tools.fireMouse` with no `init`, because a drag does hold the button.

| Call | Events, in order |
|---|---|
| `firePair(tools, 'over', b, x, y, { buttons: 0, relatedTarget: a })` | `pointerover` on `b`, then `mouseover` on `b`; both with `buttons` 0 and `relatedTarget` `a` |
| `firePair(tools, 'down', b, x, y, { buttons: 1 })` | `pointerdown`, then `mousedown`; both with `buttons` 1 and `relatedTarget` `null` |
| `tools.fireMouse('click', b, x, y, { buttons: 0 })` | `click` only |

### `hover` hit-tests against rectangles read once, before the first unit

At phase start, `hover` reads the rectangles of the target element and all its descendants. For each unit, the hit is the last element in document order whose rectangle contains the pointer and which is still connected to the document. The same panel therefore gets the same event sequence in every arm of a comparison, an arm being one build or ablation under test.[^hover-rects]

### `park` measures only parked frames, and fails when it did not park

`park` is a gutter drag in three stages:

1. **Lead-in, unmeasured.** It presses the gutter and moves `leadPx` in `direction`. That drives the pane past its clamp, the minimum size the pane cannot shrink below.
2. **Measured units.** The pointer keeps moving past the clamp: out by `step` px per unit for the first half, back for the second, never returning closer than `leadPx`.
3. **Release and restore, unmeasured.** It releases, then drags the gutter back to where it started.

If the element's rectangle changed between the start and the end of the measured units, `park` throws after restoring: the panel's `leadPx` never reached the clamp.[^park-lead] This is the drag F06.3 needs, and Loom's out-and-back drag never produces it.

### `type` inserts text the way an editing command does

`type` focuses its element and places the caret at the end. Each unit calls `document.execCommand('insertText', false, ch)` with the next character of its text. Afterwards it deletes what it typed. `insertText` makes the engine fire its own trusted `beforeinput` and `input` events, which `TextField`, CodeMirror and Lexical all handle. A synthetic `KeyboardEvent` inserts nothing.

`type` rejects before any unit when the engine has no `execCommand`, or when the element does not take focus. A unit whose insert returns `false` throws. The QA app plan's frame loop turns that throw into an error result with the phase named.[^type]

### Every panel gets page-wide `idle` and `theme` targets

The QA app plan's `mountPanel` merges targets as `{ ...build.targets, ...mounted }`. This plan puts `pageTargets(build.root)` first, so the merge becomes `{ ...pageTargets(build.root), ...build.targets, ...mounted }`. A panel's own `idle` or `theme` entry therefore wins.[^page-targets]

| `pageTargets` | `build.targets` | `afterMount` returns | Merged targets |
|---|---|---|---|
| `{ idle: root, theme: T }` | `{ passes: t }` | `{ drag: g }` | `{ idle: root, theme: T, passes: t, drag: g }` |
| same | `{ theme: T2 }` | `{}` | `{ idle: root, theme: T2 }` |
| same | `{ drag: a }` | `{ drag: b }` | `{ idle: root, theme: T, drag: b }` |

`T` is `themeTarget(THEME_CYCLE)`; `T2` is a panel's own `themeTarget([...])`.

### A panel id fixes the component tree; URL parameters only choose targets

Two variants with different trees get two panel ids, built by one shared builder: `shell-deep` and `shell-shallow` are the example. Parameters such as `grip=` or `update=` only choose which element or which mutation a driver gets. A comparison between runs of one panel id is therefore always a comparison of the same tree.[^params]

| URL | Panel | What changes |
|---|---|---|
| `panel=shell-deep&drive=drag` | 2×2 dock grid | the Dock's horizontal gutter is dragged (default `grip=dock-h`, as S1) |
| `panel=shell-deep&drive=drag&grip=sidebar` | same tree | the explorer gutter is dragged |
| `panel=shell-shallow&drive=drag&grip=dock-h` | one editor | error: `shell-shallow: unknown grip "dock-h" (expected sidebar, section)` |

### The shells stand in for Loom's S1 and S3; they do not replicate them

`shell-deep` and `shell-shallow` are shaped after the two Loom scenarios the campaign measured:

- S1: `mode=filetree&tabs=4&grid=2x2&gutter=dock-h`, a 2×2 dock grid of code editors beside an explorer tree, with the dock's horizontal gutter dragged;
- S3: `mode=filetree&tabs=1&gutter=explorer`, one editor, with the explorer gutter dragged.

Each shell has:

- an explorer `Accordion` (an open file tree, an open outline list, a closed history tree);
- a menu bar, a toolbar and a status bar;
- a `Dock` of editor pages, each a `Border` around a `CodeEditor`.

The deep shell's dock is two rows of two regions, as Loom's `grid=2x2` arranges it ([qa-harness.ts:2044-2075](../loom/qa/qa-harness.ts#L2044)). The shallow shell's dock is a single region.

Their default drive is `drag,wheel:120`, the two phases Loom runs for those query strings ([qa-harness.ts:2200-2223](../loom/qa/qa-harness.ts#L2200)). The wheel goes to the file tree, as Loom's does.

They are stand-ins, not replicas:

- the content is generated files, not Loom's repository;
- the components are the library's own, not Loom's shell classes;
- there is no Tauri API behind them.

Their numbers will not match Loom's history. They exist so that a later Loom plan can take their own baselines and retire Loom's harness; Loom is not touched now.[^stand-in]

### Panel content is owned by the QA app

Panels import only the library and files inside `packages/qa/src`, as the QA app plan's import rule requires. Shared content lives in `packages/qa/src/builders/`:

- the deterministic data generators;
- the chrome builders `appMenuBar`, `appToolBar` and `appStatusBar`;
- the shell builder;
- small DOM-lookup and counter helpers.

No panel stages a docs demo or a demo-app panel.[^content]

### Panel data is deterministic

Every generator in `src/builders/data.ts` is a pure function of its arguments. None uses `Math.random` or the clock. Two arms of a comparison therefore render identical data, and the generators are unit-tested in node.[^deterministic]

### Panels count their own hot methods per instance

`countInstance(tools, component, method, label)` wraps one instance's method under a fixed label, such as `sidebar.doLayout`. It mirrors Loom's `countMethod` ([qa-harness.ts:997](../loom/qa/qa-harness.ts#L997)), which counts a whole class by receiver. Panels use it where a figure names one component rather than a class.[^instance]

### Element lookups mirror Loom's `pickGutter`

A gutter a panel owns is found as the `.SplitGutter` that is a direct child of the container's element: `Split` and `Accordion` append their gutters straight onto it ([Split.ts:1949](packages/lib/src/typescript/lib/layout/Split.ts#L1949), [Accordion.ts:1839](packages/lib/src/typescript/lib/layout/Accordion.ts#L1839)). A gutter inside the `Dock` is picked by shape, as Loom's [`pickGutter`](../loom/qa/qa-harness.ts#L135) does:

- `dock-v` is the tallest bar that is taller than wide;
- `dock-h` is the first bar, in document order, that is wider than tall.

### Every panel is validated against a recorded figure, re-measured offline for this plan

Each panel names one or two figures from the slice reports that its drivers reproduce, as counts rather than times. Each figure was re-measured offline under the modelled DOM, or confirmed by reading the code path, on 2026-09-19 at `master` `72916718`. Two exceptions:

- the shells' theme figure comes from slice 23's report;
- the chart census comes from the QA app plan.

All still hold.[^offline] Under the QA app plan's symptom rule, the README's panel table records a panel as reproduced only after a real run shows its figure. The shells are recorded as stand-ins instead.

### Automated checks mount every panel without opening a window

A jsdom test calls the QA app plan's `mountPanel` for every panel at `SMOKE_SCALE = 3`, with stand-in `waits`: `painted` flushes layout, and `settled` resolves at once. It runs the real mount sequence, `afterMount` and the target merge included, then checks the merged targets. Clean-up follows the docs site's [DocsSidebar.test.ts:53-60](packages/docs/tests/DocsSidebar.test.ts#L53), whose idiom is copied and not imported. The dev-server smoke fetches every panel module through Vite. Nothing automated starts a host.[^smoke]

### No panel or driver assumes its host

A run may happen in a MiniBrowser window or, after `qa-app-tauri`, in a Tauri webview. The drivers use only DOM events and `document.execCommand`, which WebKit implements for both hosts. The panels use only the library. Nothing reads a host setting or a window size the host fixes.

---

## Coverage

This table maps each wave-3 candidate to the panel and driver that run its hot path. The columns:

- **Read** is what to compare between arms. `seam:` names `DOM.sink`/`DOM.source` calls counted under `seam=1`; `work:` names method-call counters under `work=1`.
- **Loom** names the Loom scenario that already runs the path: S1 and S3 as above, and S6, the campaign's typing scenario with the status bar measuring on every keystroke. The shells stand in for S1 and S3.

`shell-*` means both shells. Panels marked *(plan 2)* belong to `qa-app-panels-editors-overlays`.

| Candidate | Hot path | Panel · driver (param) | Read | Loom |
|---|---|---|---|---|
| G05 `resolve-bounds-lazy-size-reads` | discarded size reads per child, every pass | `shell-*` · `passes`, `resize`; `form-*` · `passes` *(plan 2)* | work: `getPreferredSize`, `getMinSize`, `getMaxSize` per unit | S1, S3 |
| G08 `environment-read-caching` | theme-var reads; viewport reads; window show; dialog and backdrop resize | any panel · `theme`; `windows` · `viewport`, `toggle` *(plan 2)* | seam: `getThemeVar`, `getViewportSize`; `forced.*` | — |
| G09 more opt-ins | unchanged sibling subtrees re-laid out during a drag | `shell-*` · `drag` (every `grip`), `resize` | work: `doLayout@<class>` per unit; the classes still laid out on unchanged panes are the audit list | S1, S3 |
| G11 `box-layout-per-pass-gather` | size-report fan-out in box, grid, flow and border managers | `shell-*` · `passes`, `resize`; `form-*` · `passes` *(plan 2)* | work: size-hint calls per unit, deep against shallow | S1, S3 |
| G12 F06.3 | a gutter drag parked at a pane's minimum | `shell-*` · `park` | work: `sidebar.doLayout`, `main.doLayout` | never parks |
| G12 F06.4 | `Split.recalculateSizes` every pass | `shell-*` · `drag`, `resize`, `passes` | work: `split.recalculateSizes`; the QA app's ablation `split.recalc-gate` | S1 |
| G12 F06.9 | the collapse animation re-lays out panes that do not move | `shell-*` · `toggle` (`toggle=pane`) | work: `doLayout@<class>`; seam: `apply` | — |
| G14 `accordion-closed-section-render-tree` | a closed section measured and laid out every pass | `shell-*` · `drag` (`grip=sidebar`), `park` | work: `history.doLayout`, `history.getPreferredSize` | S3 |
| G16 `panel-settled-pass-and-scroll-reads` | a settled `Panel` handed its own rectangle; `Panel` scroll reads; `SmoothScroller`; the editor's wheel reads (F23.10) | `shell-*` · `resize`, `wheel` (`wheel=tree`, `editor`); `code-document`, `form-*` · `wheel` *(plan 2)* | seam: `getScrollMetrics`, `getScrollTop`, `getScrollLeft`, `apply` | S1, S3 |
| G17 `glyph-name-setter` | caret and icon `Glyph` rebuilt on expand, collapse and scroll | `tree-nodes` · `key`, `wheel`; `treetable-rows` · `toggle` | seam: `ensureStyleRule`, `setRuleStyles`, `deleteStyleRule`, `createElementNS` | S3 |
| G18 `text-measurement-without-reflow` | per-`Text` measurement in tree rows, chart axes, tooltips and the status bar | `tree-nodes` · `wheel`, `key`; `chart-*` · `passes`, `hover`; `shell-*` · `type` (status bar per keystroke), `hover` with `step=1`; `menus`, `form-flat` *(plan 2)* | seam: `measureText`, `measureTexts` | S6 |
| G19 `tooltip-hover-path` | tooltip hide and attach on every crossing | `shell-*` · `hover` (default step: every hide is a stray hide, one with no tooltip showing; `step=1`: tooltips show and hide); `chart-*` · `hover`; `form-*` · `type` *(plan 2)* | seam: `addListener`, `removeListener`, `apply`, `setTimeout` | — |
| G20 `event-dispatch-and-registrants` | the per-event ancestor walk | `shell-deep` against `shell-shallow` · `hover`; `chart-*` · `hover`; `menus`, `diagram-graph` · `hover` *(plan 2)* | seam: `getId`, `getParentElement` per unit | — |
| G21 `table-render-pass-economy` | unchanged pass; `ArrowDown`; a one-record change | `table-rows` · `passes`, `key`, `update` (`update=record`), `wheel`; `treetable-rows` · `update`, `key`, `click` | work: `getVisibleRecords@TableBody`, `@TreeBody`; seam: `apply` | — |
| G22 `table-resize-settle-relay` | a width burst re-lays out every cell every frame | `table-rows`, `treetable-rows` · `resize`; `table-rows` · `drag` (column edge) | work: `doLayout@<cell class>` | — |
| G23 `table-header-and-cell-write-economy` | filter commit; sort sweep; renderer rewrites; temporal formatter | `table-rows` · `update` (`update=filter`), `click` (sort), `update` (`update=record`), `wheel` | seam: `ensureStyleRule`, `setRuleStyles`, `deleteStyleRule`, `apply` | — |
| G24 `list-and-tree-row-economy` | list class rewrites; tree window re-render; combo dropdown | `list-items` · `key`, `passes`, `resize`; `tree-nodes` · `passes`; `form-*` · `click` (`click=combo`) *(plan 2)* | seam: `apply`; work: `setStyleState@TreeRow` | — |
| G25 `codemirror-theme-singleton` | CodeMirror theme rules per editor per theme switch, hidden editors included | `shell-*` · `theme`; `markdown-doc` · `theme` (fenced blocks) | the `theme` note's CSS rule totals | S1 (mount only) |
| G26 `markdown-viewer-resize-and-lexer` | width re-measure per drag frame; `placeNextTo`; lexer | `markdown-doc` · `drag`, `passes`, `update`; `markdown-editor` *(plan 2)* | seam: `apply`, `getScrollMetrics`, `getElementRect`; timing for `update` | — |
| G27 `markdown-heading-scroll-cache` | active-heading lookup per scroll | `markdown-doc` · `wheel` | seam: `getElementRect`, `getElementById`, `contains` | — |
| G28 `continuous-motion-pattern` | drag ghost; diagram pan; slider; header translate; window move | `shell-deep` · `drag` (`grip=tab`); `diagram-graph`, `form-*` · `pan`, `windows` · `drag`, `table-wide` · `hwheel` *(plan 2)*. Drawer and rail are not covered (plan 2's Non-Goals). | seam: `apply`, `setRuleStyles`; frame time | — |
| G29 `dead-surface-and-docs-sweep` | none: dead code and doc fixes, no runtime cost | — | — | — |
| F26.1 / F26.2 `AbstractChart` rebuild | every SVG mark rebuilt and 12 text measures, every pass | `chart-line` · `passes`, `resize`, `update`; `chart-dashboard` · `passes`, `resize`, `drag`, `update` | seam: `createElementNS`, `removeChild`, `release`, `apply`, `measureText` | — |
| `resizeMode` flag (not built) | every gutter and window-edge drag | `shell-*` · `drag` (every `grip`); `windows` · `drag` (edge) *(plan 2)* | frame time; work | S1, S3 |

`chart-*` means `chart-line` and `chart-dashboard`; `form-*` means plan 2's two form panels.

### Correctness signals

These are the correctness bugs a panel here can show at run time. Phase 2 of the agenda fixes them before wave 3, and these runs confirm each fix in the engine.

| Bug | Panel · driver | Signal today | After the fix |
|---|---|---|---|
| C7 `codeEditorTheme()` leaks 51 rules per editor per call | `shell-*` · `theme`; `markdown-doc` · `theme` | the `theme` note's rule total grows by about 51 × `before.host.editorViews` per switch, hidden tabs included | flat |
| C10 `TreeCellRenderer` drops the old caret `Glyph` undisposed | `treetable-rows` · `toggle` | seam: `ensureStyleRule` > 0 per unit with no `deleteStyleRule` in the same path; the deletes a long phase shows are the collector, not the swap [^c10] | `deleteStyleRule` = `ensureStyleRule`, per toggle |
| C15 `Animation.play` never removes its two listeners | `shell-*` · `hover` | seam: `addListener` exceeds `removeListener` by about 2 per crossing out of a labelled button (the `hover` note gives the crossings) | equal |
| C34 a boolean-cell rebind dispatches a synthetic click | `table-rows` · `wheel` | seam: `dispatchEvent` > 0 per unit | 0 once the rebind opts out |
| C35 a context-less `WebGLCanvas` animates forever | `canvas-idle` · `idle` | `before.host.webglAnimating` = n while `webglContexts` = 0; one `requestAnimationFrame` per such canvas per unit. The panel has to construct the context-less surface ([^canvas]); this engine does not produce one on its own | those loops stop |
| C36 a canvas moved under a hidden parent keeps animating | `canvas-idle` · `idle` | `before.host.hiddenStarted` = `hiddenAnimating` = n; one `requestAnimationFrame` per hidden canvas per unit | 0 |

C24 and C25 are covered by the follow-up plan's `menus` and `windows` panels. C18, C19, C21, C22, C30 and C33 have no counter or geometry signal in any panel, so their offline tests remain the check.

---

## Public API

Internal tooling. Nothing is exported from `@jimka/typescript-ui`, and nothing outside `packages/qa` imports it.

### Harness types — `src/harness/types.ts` (additions)

```ts
/** `hover`: sweeps the pointer across `element` along `axis`, `step` px per unit, bouncing between its edges. */
export interface HoverTarget { element: Element; axis: 'x' | 'y'; }

/** `park`: drags `element` `leadPx` in `direction` (unmeasured), then measures units that keep pushing past the clamp. */
export interface ParkTarget { element: Element; axis: 'x' | 'y'; direction: 1 | -1; leadPx: number; }

/** `click`: one press and release per unit at the centre of `elements[index % elements.length]`. */
export interface ClickTarget { elements: Element[]; }

/** `key`: one keydown and keyup per unit on `element`, with key `keys[index % keys.length]`. */
export interface KeyTarget { element: Element; keys: string[]; }

/** `type`: types `text[index % text.length]` into `element` (an input, a textarea or a contenteditable), one character per unit. */
export interface TypeTarget { element: Element; text: string; }

/** `call`, `update`, `toggle`: called once per unit, in order, with the unit's index. */
export type CallTarget = (index: number) => void;

/** `theme`: `cycle(i)` applies unit `i`'s theme; `restore()` puts back the theme the page had before. */
export interface ThemeTarget { cycle(index: number): void; restore(): void; }

export interface HarnessTools {
    // … every existing member unchanged …
    /** Runs `work` with every counter family paused; restores the previous counting state afterwards, also on a throw. */
    suspendCounting<T>(work: () => Promise<T>): Promise<T>;
    /** Resolves after `frames` animation frames. Counts no frame and samples no geometry. */
    waitFrames(frames: number): Promise<void>;
}
```

### Harness helpers

```ts
// src/harness/drivers.ts
/** A driver that calls its target once per unit; `name` prefixes its errors. */
export function makeCallDriver(name: string): Driver;
// Pure helpers, exported for tests.
export function sweepOffset(index: number, stepPx: number, spanPx: number): number;
export function hitIndex(rects: ReadonlyArray<{ left: number; top: number; width: number; height: number }>, x: number, y: number, usable?: (index: number) => boolean): number;
export function parkOffset(index: number, units: number, stepPx: number, leadPx: number): number;

// src/harness/dom.ts
/** Total CSS rules across `document.styleSheets` and, when the document has them, `document.adoptedStyleSheets`; an unreadable sheet counts 0. */
export function countCssRules(): number;
```

### New drivers in `DRIVERS`

| Driver | Target | Setup, suspended | Per unit | After, suspended |
|---|---|---|---|---|
| `idle` | any defined value | — | nothing | — |
| `call`, `update`, `toggle` | `CallTarget` | — | `target(index)` | — |
| `hover` | `HoverTarget` | read the rectangles of the element and all its descendants | move the pointer to `origin + sweepOffset(index, step, span)` on the centre line. On a new hit, `firePair` `out` on the old hit (when there is one) and `over` on the new, each with the other as `relatedTarget`. Then `firePair` `move` on the hit. All with `buttons: 0` | `firePair` `out` on the last hit (`relatedTarget: null`); `waitFrames(SETTLE_FRAMES)`; note `hover: <c> crossings over <u> units among <e> elements` |
| `park` | `ParkTarget` | `tools.fireMouse('mousedown', …)` at the centre; `LEAD_FRAMES` `mousemove`s on `document` reaching `leadPx`, one per frame; `waitFrames(SETTLE_FRAMES)`; record the rectangle | `mousemove` on `document` to `parkOffset(index, units, step, leadPx)` along `axis` × `direction` | compare the rectangle; `mouseup`; drag back to the start over `RESTORE_FRAMES`; throw if the rectangle moved; note `park: lead <leadPx>px, element held at <rect> for <u> units` |
| `click` | `ClickTarget` | read each element's centre | at the next centre: `firePair` `down` (`buttons: 1`), `firePair` `up` (`buttons: 0`), then `tools.fireMouse('click', …, { buttons: 0 })` | — |
| `key` | `KeyTarget` | `element.focus({ preventScroll: true })` | `keydown` then `keyup` with `keys[index % keys.length]` | — |
| `type` | `TypeTarget` | focus; caret to the end | `document.execCommand('insertText', false, text[index % text.length])`; throw if it returns `false` | `document.execCommand('delete')` once per unit; `waitFrames(SETTLE_FRAMES)`; note `type: <units> characters into <tag>` |
| `theme` | `ThemeTarget` | record `countCssRules()` | `target.cycle(index)` | `waitFrames(1)`; record `countCssRules()`; `target.restore()`; `waitFrames(THEME_SETTLE_FRAMES)`; note `theme: CSS rules <before> → <after> over <units> switches` |

`type`'s caret goes to the end of its element:

- an `<input>` or `<textarea>` gets `setSelectionRange(value.length, value.length)`;
- any other element is treated as contenteditable, and gets `getSelection().selectAllChildren(element)` followed by `collapseToEnd()`.

Every new driver is `async`. It checks its target before it dispatches anything, in the order of this table, and rejects with `<driver>: <problem>`:

| Driver | Rejects when | Message |
|---|---|---|
| `call`, `update`, `toggle` | target is not a function | `<name>: target must be a function (index) => void` |
| `hover` | no element, or axis not `'x'`/`'y'` | `hover: target must be { element, axis: "x" \| "y" }` |
| `hover` | extent along `axis` minus two insets is below 1 | `hover: element has no extent along <axis>` |
| `park` | any field wrong (`leadPx` must be a positive number) | `park: target must be { element, axis: "x" \| "y", direction: 1 \| -1, leadPx > 0 }` |
| `park` | the rectangle moved during the measured units | `park: the element moved during the measured units (<before> → <after>); leadPx does not reach the clamp` |
| `click` | `elements` missing, empty, or holding a non-element | `click: target must be { elements: [Element, …] } with at least one element` |
| `key` | no element, or `keys` empty or not all strings | `key: target must be { element, keys: [string, …] } with at least one key` |
| `type` | no element with `focus`, or `text` empty or not a string | `type: target must be { element, text } with a non-empty text` |
| `type` | `document.execCommand` is not a function | `type: this engine has no document.execCommand; cannot type into <tag>` |
| `type` | the element (or a descendant) does not hold focus after `focus()` | `type: <tag> did not take focus` |
| `type` | a unit's insert returns `false` | `type: document.execCommand("insertText") returned false for <tag>` |
| `theme` | target has no `cycle` or `restore` function | `theme: target must be { cycle(index), restore() }` |

"An element" means an object with `getBoundingClientRect` and `dispatchEvent` functions, so these checks run in node tests. `<tag>` is the element's lower-case tag name.

### The page side — `src/pageTargets.ts` (new)

```ts
import type { Component, Theme } from '@jimka/typescript-ui/core';
import type { ThemeTarget } from './harness/types.js';

/** The themes a page cycles through by default: dark, then the library's default. */
export const THEME_CYCLE: readonly Theme[];
/** `cycle(i)` sets `themes[i % themes.length]` through `ThemeManager.setTheme`; `restore()` sets the theme that was current when the target was built. */
export function themeTarget(themes: readonly Theme[]): ThemeTarget;
/** `{ idle: root, theme: themeTarget(THEME_CYCLE) }`, merged under every panel's targets. */
export function pageTargets(root: Component): Record<string, unknown>;
```

`themeTarget([])` throws `themeTarget: expected at least one theme`.

### Panel parameters

| Panel | Parameter | Values (first is the default) |
|---|---|---|
| `shell-deep` | `grip` | `dock-h`, `dock-v`, `sidebar`, `section`, `tab` |
| `shell-shallow` | `grip` | `sidebar`, `section` |
| `shell-deep` | `hover` | `toolbar`, `menubar`, `tabs` |
| `shell-shallow` | `hover` | `toolbar`, `menubar` |
| `shell-*` | `wheel` | `tree`, `editor` |
| `shell-*` | `toggle` | `section`, `pane` |
| `table-rows` | `update` | `record`, `filter` |

`choice(params, name, allowed, panel)` in `src/builders/params.ts` resolves every parameter:

| Query | `allowed` | Result |
|---|---|---|
| `grip=tab` | `dock-h, dock-v, sidebar, section, tab` | `'tab'` |
| absent, or `grip=` | same | `'dock-h'` |
| `grip=nope` (panel `shell-deep`) | same | throws `shell-deep: unknown grip "nope" (expected dock-h, dock-v, sidebar, section, tab)` |

---

## Internal Structure

### Harness: counters and frames

```ts
// src/harness/counters.ts
export async function suspendCounting<T>(work: () => Promise<T>): Promise<T> {
    const wasCounting = counting;

    counting = false;

    try {
        return await work();
    } finally {
        counting = wasCounting;
    }
}

// src/harness/frames.ts
export async function waitFrames(frames: number): Promise<void> {
    for (let i = 0; i < frames; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
}
```

`createTools` adds both to `tools`.

### Harness: the pure helpers, with worked cases

- **`sweepOffset(index, stepPx, spanPx)`** is the distance `(index + 1) × stepPx`, reflected between `0` and `spanPx`. Let `t = ((index + 1) × stepPx) mod (2 × spanPx)`. The result is `t` when `t ≤ spanPx`, else `2 × spanPx − t`. With step 3 and span 10: index 0 → 3, 2 → 9, 3 → 8, 6 → 1, 9 → 10.
- **`hitIndex(rects, x, y, usable)`** is the last index whose rectangle contains the point and for which `usable(index)` is true, or −1. Left and top edges are inclusive; right and bottom edges are exclusive. With A `{0,0,100,20}`, B `{10,0,30,20}`, C `{50,0,30,20}`:

  | Point | `usable` | Result | Why |
  |---|---|---|---|
  | (15, 5) | all | 1 | A and B contain it; B is later |
  | (60, 5) | all | 2 | A and C contain it; C is later |
  | (45, 5) | all | 0 | only A |
  | (100, 5) | all | −1 | A's right edge is exclusive |
  | (0, 0) | all | 0 | edges inclusive |
  | (15, 5) | excludes 1 | 0 | B skipped |

- **`parkOffset(index, units, stepPx, leadPx)`** is `leadPx + stepPx × (index < units / 2 ? index + 1 : units − index − 1)`. It is never below `leadPx`. With step 3 and lead 100:
  - at 4 units: 0 → 103, 1 → 106, 2 → 103, 3 → 100;
  - at 3 units: 0 → 103, 1 → 106, 2 → 100.

### Harness: `hover` in outline

```ts
async function hover(ctx: DriveContext): Promise<number[]> {
    const target = requireHoverTarget(ctx.target);
    const frame = await ctx.tools.suspendCounting(async () => readSweepFrame(target));   // candidates, rects, origin, span, line
    const state = { current: null as Element | null, crossings: 0, point: frame.start };

    const samples = await ctx.tools.runFrames(ctx.units, (index) => {
        state.point = frame.pointAt(sweepOffset(index, ctx.stepPx, frame.span));
        const hit = frame.candidates[hitIndex(frame.rects, state.point.x, state.point.y, (k) => frame.candidates[k].isConnected)] ?? target.element;

        if (hit !== state.current) {
            state.crossings++;
            crossBoundary(ctx.tools, state.current, hit, state.point);   // firePair 'out' (if any), then firePair 'over'
            state.current = hit;
        }

        firePair(ctx.tools, 'move', hit, state.point.x, state.point.y, { buttons: 0 });
    });

    await ctx.tools.suspendCounting(async () => leaveAndSettle(ctx.tools, state));
    ctx.notes.push(`hover: ${state.crossings} crossings over ${ctx.units} units among ${frame.candidates.length} elements`);

    return samples;
}
```

`park` follows the three stages in its decision above. Its rectangle key is the rounded `left,top,width,height` of `getBoundingClientRect()`. The restore drag presses at the element's current centre and moves back to the original centre over `RESTORE_FRAMES`. `type` has the same shape: `focusAtEnd` in setup, the inserts in `runFrames`, and `deleteTyped(units)` in teardown. Every DOM read, lead-in, restore and clean-up runs inside `suspendCounting`; the measured units run in `runFrames`.

`firePointer(type, target, x, y, init)` dispatches a bubbling, cancelable `PointerEvent`. It carries `pointerId: POINTER_ID`, `pointerType: 'mouse'`, `isPrimary: true`, `button: 0`, `clientX`/`clientY`, and `init`'s `buttons` and `relatedTarget` (defaults 0 and `null`).

Constants in `drivers.ts`, each commented with its reason:

- `LEAD_FRAMES = 10`: ten moves, so the `Split` sees a gradual drag, as it would from a user, rather than one jump.
- `SETTLE_FRAMES = 3`: one frame for `Split.scheduleDrag`'s coalesced flush ([Split.ts:1412](packages/lib/src/typescript/lib/layout/Split.ts#L1412)), one for the layout flush it schedules, and one spare.
- `RESTORE_FRAMES = 10`: the same reason as `LEAD_FRAMES`.
- `EDGE_INSET_PX = 1`: keeps the sweep one pixel inside the element, so it never leaves it.
- `POINTER_ID = 1`: the pointer id WebKit gives the mouse.
- `THEME_SETTLE_FRAMES = 3`: the restyle, and the relayout it schedules, land before the phase ends.

### Page: `src/mount.ts`

One change, in `mountPanel`'s step 6: the returned targets become `{ ...pageTargets(build.root), ...build.targets, ...mounted }`.

### Builders — `packages/qa/src/builders/`

| File | Exports | Notes |
|---|---|---|
| `data.ts` | `lineSeriesPoints`, `barSeries`, `tableRows`, `folderRows`, `folderNodes`, `listItems`, `outlineLabels`, `markdownDocument`, `codeDocument` | pure; type-only imports from the library, so node tests can import it |
| `params.ts` | `choice` | pure |
| `work.ts` | `countInstance` | returns `counting <label>`, or `NOT FOUND <method> on <class>` like Loom's `countMethod` |
| `dom.ts` | `requireElement(root, selector, label)`, `childGutter(tools, container, label)`, `dockGutter(dockElement, kind, label)`, `firstPainted(tools, root, selector, label)` | throw `<label>: no element matches <selector>`, `<label>: no <kind> gutter` or `<label>: no painted <selector>` |
| `chrome.ts` | `appMenuBar()`, `appToolBar()`, `appStatusBar()`, `fileTreeRenderer`, `noCommand` | registers the toolbar and file glyphs at module load |
| `shared.ts` | `TYPE_TEXT`, `SIDE_WIDTH_PX` | constants more than one panel uses |
| `shell.ts` | `buildShell(n, depth, params, panel)` | used by both shells |

`countInstance`:

```ts
export function countInstance(tools: HarnessTools, component: object, method: string, label: string): string {
    const host = component as Record<string, unknown>;
    const original = host[method];

    if (typeof original !== 'function') {
        return `NOT FOUND ${method} on ${tools.className(component)}`;
    }

    host[method] = function countedInstanceCall(this: unknown, ...args: unknown[]): unknown {
        tools.bumpWork(label);

        return (original as (...a: unknown[]) => unknown).apply(this, args);
    };

    return `counting ${label}`;
}
```

Data rules. Each numeric literal becomes a named constant with its reason.

| Generator | Output |
|---|---|
| `lineSeriesPoints(s, n)` | `{ x: i, y: (i × 37 + s × 23) mod 100 }` for `i < n`; moved unchanged from `chart-line` |
| `barSeries(chart)` | 3 series × 12 categories: `{ x: c + 1, y: (c × 13 + s × 29 + chart × 7) mod 50 + 10 }` |
| `tableRows(n)` | see below |
| `folderRows(roots)` | per root `r`: a folder row, then 3 subfolders, each followed by 3 files; 13 rows per root; ids sequential from 1; fields `id, parentId, name, size, modified, kind` |
| `folderNodes(folders)` | `Folder <i>`, each with 5 children `file <i>.<j>.ts` |
| `listItems(n)` | `{ id: i, name: 'Item <i>' }` |
| `outlineLabels(count)` | `Outline entry <i+1>` |
| `markdownDocument(sections, variant)` | see below |
| `codeDocument(lines)` | `lines` lines of JavaScript: a repeating 10-line function block, numbered by block (`function block<k>(value) {` … `}`) |

`tableRows(n)`, row `i`:

| Field | Value |
|---|---|
| `id` | i + 1 |
| `name` | `Person <i+1>` |
| `email` | `person<i+1>@example.com` |
| `department` | `DEPARTMENTS[i mod 6]` |
| `title` | `TITLES[i mod 5]` |
| `salary` | 40000 + (i × 7919) mod 90000 |
| `hired` | UTC 2010-01-01 + ((i × 97) mod 5000) days |
| `lastLogin` | UTC 2026-01-01 + ((i × 7) mod 240) hours |
| `shiftStart` | UTC 1970-01-01 at (8 + i mod 4) hours, (i × 15 mod 60) minutes |
| `active` | i mod 3 ≠ 0 |
| `score` | (i × 31) mod 101 |
| `notes` | `''` when i mod 4 = 0, else `Note <i+1>` |

`markdownDocument(sections, variant)` starts with `# QA document`. Section `i` then has:

- `## Section <i+1>`;
- a one-line paragraph beginning `Section <i+1> draft` (variant 0) or `Section <i+1> revised` (variant 1), followed by three fixed sentences;
- a 4-item bullet list when i mod 3 = 2;
- a 6-line ` ```ts ` fence when i mod 4 = 3;
- a 4-column, 6-row table when i mod 5 = 4.

### Chrome builders — `src/builders/chrome.ts`

- **`appMenuBar()`** is `MenuBar({ menus })` with four menus, File, Edit, View and Help, of six items each. Each item's `action` is the named no-op `noCommand`.
- **`appToolBar()`** is a `ToolBar` of twelve glyph-only `Button`s (`showText: false`), so each button's text becomes its hover tooltip. The glyphs are `file`, `folder_open`, `floppy_disk`, `magnifying_glass`, `gear`, `star`, `house`, `trash`, `code_branch`, `database`, `gears` and `flag_checkered`, each imported from `@jimka/typescript-ui/glyphs/solid/<name>` and registered with `Glyph.register` at module load, as [DiagramPanel.ts:20](packages/lib/src/typescript/DiagramPanel.ts#L20) registers its glyphs.
- **`appStatusBar()`** is `StatusBar({ defaultMessage: 'Ready' })`.
- **`fileTreeRenderer()`** is a named factory returning `new IconLabelTreeNodeRenderer(fileIcon)`. `fileIcon` returns `folder-open` for an expanded branch, `folder` for a collapsed one and `file` otherwise; `folder`, `folder_open` and `file` are registered at module load too.

### The shells — `buildShell(n, depth, params, panel)`

`shell-deep` and `shell-shallow`: n = tabs per Dock region, default 1. That gives 4 editors in the deep shell, as S1 has, and 1 in the shallow shell, as S3 has. `n=4` gives the deep shell 16 editors, 12 of them hidden. `defaultDrive: 'drag,wheel:120'`. Each panel's `build(n, params)` returns `buildShell(n, '<deep|shallow>', params, '<panel id>')`.

```text
root  Panel(Border)
├─ NORTH   appMenuBar()
├─ CENTER  Panel(Split horizontal)
│   ├─ sidebar  Panel(Accordion { resizable: true, fillHeight: true })   constraint { weight: 0 }
│   │           minSize { width: SIDEBAR_MIN_PX = 160 }, preferredSize { width: SIDEBAR_PREFERRED_PX = 280, height: SIDEBAR_PREFERRED_HEIGHT_PX = 600 }
│   │   ├─ files    Tree, setRendererFactory(fileTreeRenderer), folderNodes(FILE_TREE_FOLDERS = 40), expandAll   AccordionConstraints('Files', true)
│   │   ├─ outline  List({ items: outlineLabels(OUTLINE_ITEMS = 60) })                                         AccordionConstraints('Outline', true)
│   │   └─ history  Tree, folderNodes(HISTORY_FOLDERS = 20), nodes collapsed                                    AccordionConstraints('History', false)
│   └─ main  Panel(Border)                                                                  constraint { weight: 1 }
│       ├─ NORTH   appToolBar()
│       └─ CENTER  Dock({ layout })
│                  deep:    { split: 'vertical', children: [row, row] }, row = { split: 'horizontal', children: [{ tabs }, { tabs }] }
│                  shallow: { tabs }
│                  each { tabs }: n panels { id: 'file-<r>-<t>', title: 'file<r>.<t>.ts', closeable: false, disposeOnClose: false, content: page(r, t) }
└─ SOUTH   status = appStatusBar()

page(r, t)   Panel(Border)
├─ NORTH   Header('src/file<r>.<t>.ts')
└─ CENTER  CodeEditor(codeDocument(EDITOR_LINES = 300), { language: 'javascript' })
           on('cursorchange', showCursor): status.setMessage('Ln <line>, Col <column>')
```

`showCursor` is one named module function. Every editor registers it. The status line then updates on every cursor move, as Loom's status readouts do.

Targets:

| Driver | When | Target |
|---|---|---|
| `resize`, `passes` | build | `root` |
| `toggle` | build | the named function `toggleEvery`. When `index mod TOGGLE_PERIOD_UNITS = 0` (`TOGGLE_PERIOD_UNITS = 30`): with `toggle=section`, `accordion.openSection(2)` if that section is closed, else `closeSection(2)`; with `toggle=pane`, `split.setPaneCollapsed(0, !split.isPaneCollapsed(0))`[^toggle-period] |
| `drag` | afterMount | `grip=dock-h`: `{ dockGutter(dock, 'dock-h'), 'y' }`; `dock-v`: `{ dockGutter(dock, 'dock-v'), 'x' }`; `sidebar`: `{ childGutter(the Split's container), 'x' }`; `section`: `{ childGutter(sidebar), 'y' }`; `tab`: `{ first .TabButton in the dock, 'x' }` |
| `park` | afterMount | `{ element: the sidebar gutter, axis: 'x', direction: -1, leadPx: SIDEBAR_PREFERRED_PX − SIDEBAR_MIN_PX + PARK_OVERSHOOT_PX }`, with `PARK_OVERSHOOT_PX = 40` |
| `hover` | afterMount | `hover=toolbar`: `{ the toolbar element, 'x' }`; `menubar`: `{ the menu bar element, 'x' }`; `tabs`: `{ first .TabBar in the dock, 'x' }` |
| `wheel` | afterMount | `wheel=tree`: the files tree's element (Loom's wheel target); `editor`: `firstPainted(…, '.cm-scroller')` |
| `type` | afterMount | `{ element: firstPainted(…, '.cm-content'), text: TYPE_TEXT }` |

`TYPE_TEXT = 'measure '` (in `shared.ts`): eight ordinary characters, cycled, which every text target accepts.

- **Geometry.** Both shells: `sidebar`, `files`, `outline`, `history`, `main`, `dock`, `editor0`. `editor0` is the first page of the first region; the deep shell adds `editor1`–`editor3`, the first page of each other region.
- **`describe()`.** `{ regions, editors: regions × n, editorViews: <.cm-editor elements in the document>, fileNodes, outlineItems }`.
- **`installWork`.** `countInstance` for `sidebar.doLayout`, `main.doLayout`, `history.doLayout` and `history.getPreferredSize`.

### The other panels

Every panel builds at any `n ≥ 1`, and an index taken from `n` is clamped to `n − 1`.

**`table-rows`**: n = rows, default 10,000. `defaultDrive: 'wheel'`.

- **Components.** A `MemoryStore` over a 12-field `Model`: `id` (number), `name`, `email`, `department`, `title` (strings), `salary` (number), `hired` (date), `lastLogin` (datetime), `shiftStart` (time), `active` (boolean), `score` (number) and `notes` (string). It is loaded with `store.loadData(tableRows(n))`. The root is `Table(store, { columns })`, where `department` has `values: DEPARTMENTS` and `notes` has `filterable: false`. Then `table.setFilterRowVisible(true)`.
- **Build targets.** `resize`, `passes`: the table. `update` depends on the `update=` parameter:
  - `record`: `store.getAt(index mod min(UPDATE_ROW_SPAN, n))!.set('score', SCORE_BASE + index)`. `UPDATE_ROW_SPAN = 10`, the rows that start visible. `SCORE_BASE = 1000` sits above the generator's 0–100 range, so every write changes the value.
  - `filter`: `store.setFilter('department', { type: 'eq', field: 'department', value: DEPARTMENTS[index mod 6] })`.
- **afterMount.** `table.selectRecord(store.getAt(min(KEY_START_ROW, n − 1))!)`, with `KEY_START_ROW = 3`. Targets:
  - `wheel`: the body's element (`table.getBody()`);
  - `key`: `{ the body's element, ['ArrowDown', 'ArrowUp'] }`;
  - `drag`: `{ the first .ResizeHandle in the header element, 'x' }`;
  - `click`: `{ elements: [the .HeaderCell at SORT_COLUMN_INDEX = 1 (name)] }`. The first columns are always inside the header's column window.
- **Geometry, describe, installWork.** Geometry: `table`, `header` (`getHeader()`), `body` (`getBody()`). `describe()`: `{ rows: n, columns: 12 }`. `installWork`: `tools.countMethod(table.getBody(), 'getVisibleRecords')`.

**`treetable-rows`**: n = root folders, default 200 (2,600 rows). `defaultDrive: 'toggle'`.

- **Components.** A `MemoryStore` loaded with `folderRows(n)`. The root is `TreeTable(store, { idField: 'id', parentField: 'parentId', treeColumn: 'name', columns: [name (minWidth 200), size, modified, kind] })`.
- **Build targets.** `resize`, `passes`: the tree table. `toggle`: `collapseAll()` on even `index`, `expandAll()` on odd. `update`: `store.getAt(index mod min(UPDATE_ROW_SPAN, 13n))!.set('size', SIZE_BASE + index)`, where `SIZE_BASE = 100000` sits above every generated size.
- **afterMount.** `expandAll()`, then select the row at `min(3, 13n − 1)`. Targets:
  - `wheel`: the body's element;
  - `key`: `{ the body's element, ['ArrowDown', 'ArrowUp'] }`;
  - `click`: `{ elements: [the first .NumberCell in the body] }`, a cell that is not a toggle.
- **Geometry, describe, installWork.** Geometry: `table`, `header`, `body`. `describe()`: `{ roots: n, rows: 13n }`. `installWork`: `tools.countMethod(treeTable.getBody(), 'getVisibleRecords')`.

**`tree-nodes`**: n = folders of 5 files each, default 300 (1,800 nodes). `defaultDrive: 'key'`.

- **Components.** The root is a `Tree()`. Call `setRendererFactory(fileTreeRenderer)`, then `setNodes(folderNodes(n))` and `expandAll()`.
- **Build targets.** `passes`, `resize`: the tree.
- **afterMount.** `tree.selectNode(nodes[0])`. Targets:
  - `key`: `{ the tree element, ['ArrowLeft', 'ArrowRight'] }`, which collapses and then expands node 0 ([Tree.ts:1083-1130](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1083));
  - `wheel`: the tree element.
- **Geometry, describe, installWork.** Geometry: `tree`. `describe()`: `{ nodes: 6n, treeRows: <.TreeRow elements under the tree element> }`. `installWork`: `tools.countMethod(tree, 'setStyleState', 'setStyleState', true)`.

**`list-items`**: n = items, default 300. `defaultDrive: 'key'`.

- **Components.** A `MemoryStore` loaded with `listItems(n)`. The root is `List({ store, displayField: 'name', valueField: 'id', selectedIndex: min(LIST_START_INDEX = 5, n − 1) })`.
- **Build targets.** `passes`, `resize`: the list.
- **afterMount.** `key`: `{ the list element, ['ArrowDown', 'ArrowUp'] }`.
- **Geometry, describe.** Geometry: `list`. `describe()`: `{ items: n }`.

**`chart-dashboard`**: n = points per line series, default 200. `defaultDrive: 'resize'`.

- **Components.** The root is `Panel(Split horizontal)`:
  - left (`weight: 1`): `Panel(Grid({ rows: 2, columns: 2 }))` holding four `LineChart({ store, xField: 'x', yField: 'y', seriesField: 'series', showLegend: true, showPoints: true })`. Each chart has its own `MemoryStore` over a `Model` of `x`, `y` (numbers) and `series` (string). The store holds `lineSeriesPoints(s, n)` for s = 0, 1, 2, each record with `series: 'Series <s+1>'`.
  - right (`weight: 1`): `Panel(VBox({ stretching: true }))` holding two `BarChart({ series: barSeries(k), grouped: true })`.
- **Build targets.** `passes`: the left grid panel. `resize`: root. `update`: in store `index mod 4`, take record `(index × 7) mod count`, and set its `y` to `(y + 13) mod 100`.
- **afterMount.** Targets:
  - `drag`: `{ childGutter(root), 'x' }`;
  - `hover`: `{ the first line chart's element, 'x' }`.
- **Geometry, describe.** Geometry: `grid`, `chart0`–`chart3`, `bars`. `describe()`: `{ lineCharts: 4, barCharts: 2, pointsPerSeries: n }`.

**`chart-line`** (changed). It imports `lineSeriesPoints` in place of its inline rule, and gains two targets:

- `update`: `setSeries(index even ? seriesB : seriesA)`, where `seriesB` is `seriesA` with every `y` replaced by `(y + 1) mod 100`;
- `hover`: `{ chart element, 'x' }`, returned from a new `afterMount`.

Its `defaultScale`, `defaultDrive`, geometry and census are unchanged.

**`markdown-doc`**: n = sections (headings), default 60. `defaultDrive: 'drag'`.

- **Components.** The root is `Panel(Split horizontal)` of two panes:
  - `Header('Documents', { preferredSize: { width: SIDE_WIDTH_PX, height: 40 } })`, `weight: 0`. `SIDE_WIDTH_PX = 240` lives in `shared.ts`: a side pane wide enough for a heading, and narrow enough to leave the viewer most of the screen;
  - `MarkdownViewer({ markdown: markdownDocument(n, 0) })`, `weight: 1`.
- **Build targets.** `passes`: the viewer. `resize`: root. `update`: `viewer.setMarkdown(markdownDocument(n, index even ? 1 : 0))`, with both strings built once.
- **afterMount.** Targets:
  - `drag`: `{ childGutter(root), 'x' }`;
  - `wheel`: the first `p` element inside the viewer's element.
- **Geometry, describe.** Geometry: `side`, `viewer`. `describe()`: `{ headings: n, fences: ⌊n / 4⌋, editorViews: <.cm-editor elements under the viewer element> }`. Fences upgrade to editors lazily, near the viewport ([Markdown.ts:136](packages/lib/src/typescript/lib/component/display/Markdown.ts#L136)), so `editorViews` depends on the screen.

**`canvas-idle`**: n = surfaces per group, default 4. `defaultDrive: 'idle'`.

- **Components.** The root is `Panel(VBox({ spacing: 8 }))` holding two panels:
  - `shown`: `Panel(HBox)` holding n `WebGLCanvas({ preferredSize: { width: 160, height: 120 }, onFrame: drawNoGlFrame })` and n `Canvas({ preferredSize: same, onDraw: drawNoCanvasFrame })`;
  - `hidden`: `Panel(HBox, displayed: false)`, empty at build.
- **Build.** Take each `WebGLCanvas`'s 2D context before it is mounted — `DOM.sink.getContext(surface.getElement(true)!, '2d')` — so the engine refuses it a WebGL2 one. That is C35's precondition, `webglContexts` = 0, which this engine does not reach on its own ([^canvas]).
- **afterMount.** Call `startAnimation()` on the n `Canvas`es while they are still in `shown`, record how many are animating as `hiddenStarted`, then `hidden.moveComponent(…)` each of them. This is C36's shape: a canvas that is animating on screen, reparented under a parent that is already hidden. It returns `{}`.
- **Geometry, describe.** Geometry: `shown`. `describe()`: `{ surfaces: n, webglContexts, webglAnimating, hiddenStarted, hiddenAnimating }`, counted with `getContext() !== null` and `isAnimating()`.
- **Callbacks.** `drawNoGlFrame` and `drawNoCanvasFrame` are named module functions that draw nothing.

Each panel's `description` names what it builds. A panel that reproduces a figure also names the figure's source and symptom, per the QA app plan's symptom rule. For example: `list-items: 300-item List. Reproduces slice 18 F18.2 (lists are not virtualised): 908 applies per unchanged pass.`

---

## Ordered Implementation Steps

Where a step names tests, write them first (they fail), then the code.

1. **Check the prerequisite and prepare the worktree.** Confirm that `plans/implemented/qa-app.md`, `packages/qa/src/harness/drivers.ts` and `packages/qa/src/mount.ts` exist. Then run the QA app plan's step 1.
2. **Test E18, then `src/harness/counters.ts`** — `suspendCounting`. Test file `tests/counters.test.ts`.
3. **`src/harness/frames.ts`** — `waitFrames`.
4. **`src/harness/types.ts`** — the target types and the two `HarnessTools` members under *Public API*.
5. **`src/harness/run.ts`** — `createTools` adds `suspendCounting` and `waitFrames`.
6. **Test E20's `countCssRules` half, then `src/harness/dom.ts`** — `countCssRules`.
7. **Tests E13–E17 and E19–E21, then `src/harness/drivers.ts`**:
   - `sweepOffset`, `hitIndex`, `parkOffset` and `makeCallDriver`;
   - the ten drivers, with private `firePointer`, `firePair`, `fireKey`, `centreOf`, `focusAtEnd` and `deleteTyped` helpers;
   - `DRIVERS` gains `idle`, `call`, `update`, `toggle` (the last three from `makeCallDriver`), `hover`, `park`, `click`, `key`, `type` and `theme`.

   Test files: `tests/drivers.test.ts` (node, fake `tools`) and `tests/drivers.dom.test.ts` (jsdom, with the pragma, as the QA app plan's `dom.test.ts` has it). Check: `grep -n "new MouseEvent" packages/qa/src/harness/drivers.ts` finds nothing, because every mouse event goes through `tools.fireMouse`.
8. **Checkpoint.** `grep -rn "@jimka/typescript-ui" packages/qa/src/harness` finds nothing. `npm -w packages/qa run typecheck` and `npm -w packages/qa run test` pass.
9. **Tests P9 and P10, then `src/builders/params.ts` and `src/builders/data.ts`.** Test file `tests/builders.test.ts`, node.
10. **Test P11, then `src/pageTargets.ts`.** Test file `tests/pageTargets.test.ts`, jsdom (it imports `@jimka/typescript-ui/core`).
11. **`tests/panels.test.ts`** — amend P1 as under *Expected Behaviour*.
12. **`src/mount.ts`** — the merge under *Internal Structure*.
13. **`src/panels/chart-line.ts`** — import `lineSeriesPoints`; add `update` and an `afterMount` returning `hover`. Check: P2 and P3 still pass.
14. **`src/builders/work.ts`, `dom.ts`, `shared.ts`, `chrome.ts`, `shell.ts`.**
15. **The nine panel files** in `src/panels/`:
    - `shell-deep.ts` and `shell-shallow.ts`, each a thin call to `buildShell`;
    - `table-rows.ts`, `treetable-rows.ts`, `tree-nodes.ts`, `list-items.ts`, `chart-dashboard.ts`, `markdown-doc.ts` and `canvas-idle.ts`.

    Each `description` follows the rule under *The other panels*. The shells' descriptions say they stand in for S1 and S3.
16. **Tests P7 and P8** — `tests/mount.test.ts`, jsdom.
17. **`packages/qa/README.md`**:
    - the new drivers in the drivers table;
    - the page-wide targets, and how a panel overrides them;
    - the panel table: one row per panel, with `n`'s meaning and default, drivers, parameters, geometry labels, the validation figure (M5–M14), and a `Validated:` entry;
    - the shells' rows marked as S1 and S3 stand-ins;
    - two measurement rules, under *Documentation Impact*.
18. **Checkpoint.** Everything under *Verification → Automated*, then the dev-server smoke.
19. **Stop.** Do not run `runqa.sh` with a real host. Report that the validation sweep and the shakedown need the user's go-ahead.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/qa/src/harness/types.ts` |
| Modify | `packages/qa/src/harness/dom.ts` |
| Modify | `packages/qa/src/harness/frames.ts` |
| Modify | `packages/qa/src/harness/counters.ts` |
| Modify | `packages/qa/src/harness/drivers.ts` |
| Modify | `packages/qa/src/harness/run.ts` |
| Create | `packages/qa/src/pageTargets.ts` |
| Modify | `packages/qa/src/mount.ts` |
| Create | `packages/qa/src/builders/data.ts` |
| Create | `packages/qa/src/builders/params.ts` |
| Create | `packages/qa/src/builders/work.ts` |
| Create | `packages/qa/src/builders/dom.ts` |
| Create | `packages/qa/src/builders/shared.ts` |
| Create | `packages/qa/src/builders/chrome.ts` |
| Create | `packages/qa/src/builders/shell.ts` |
| Modify | `packages/qa/src/panels/chart-line.ts` |
| Create | `packages/qa/src/panels/shell-deep.ts` |
| Create | `packages/qa/src/panels/shell-shallow.ts` |
| Create | `packages/qa/src/panels/table-rows.ts` |
| Create | `packages/qa/src/panels/treetable-rows.ts` |
| Create | `packages/qa/src/panels/tree-nodes.ts` |
| Create | `packages/qa/src/panels/list-items.ts` |
| Create | `packages/qa/src/panels/chart-dashboard.ts` |
| Create | `packages/qa/src/panels/markdown-doc.ts` |
| Create | `packages/qa/src/panels/canvas-idle.ts` |
| Modify | `packages/qa/tests/counters.test.ts` |
| Create | `packages/qa/tests/drivers.test.ts` |
| Create | `packages/qa/tests/drivers.dom.test.ts` |
| Create | `packages/qa/tests/builders.test.ts` |
| Create | `packages/qa/tests/pageTargets.test.ts` |
| Create | `packages/qa/tests/mount.test.ts` |
| Modify | `packages/qa/tests/panels.test.ts` |
| Modify | `packages/qa/README.md` |

---

## Expected Behaviour

### Harness, unit-testable (`packages/qa/tests`)

Numbering continues after the QA app plan's E12. E13–E18 run in node; E19–E21 run in jsdom.

- **E13 `sweepOffset`.** Every case under *Internal Structure*.
- **E14 `hitIndex`.** Every row of its table.
- **E15 `parkOffset`.** Both unit counts under *Internal Structure*. Also, with 150 units, step 3 and lead 160, no index gives less than 160.
- **E16 `call` and `idle`.** Use a fake `tools` whose `runFrames(units, step)` calls `step(0 … units − 1)` synchronously and returns `[1, 2, 3]`.
  - `makeCallDriver('update')` with a recording target and 3 units calls the target with 0, 1, 2 in order, and resolves to `[1, 2, 3]`.
  - With target `42`, it rejects with `update: target must be a function (index) => void`.
  - `idle` with target `{}` resolves, having called `runFrames` once with the unit count.
- **E17 target validation.** Each row of the rejection table under *Public API* that needs no layout or engine. Use fake elements `{ getBoundingClientRect() {…}, dispatchEvent() {…}, focus() {…} }`. For example:
  - `park` with `leadPx: 0` rejects with the `park: target must be …` message;
  - `key` with `keys: []` rejects;
  - `click` with `elements: []` rejects;
  - `type` with `text: ''` rejects;
  - `theme` with target `{ cycle() {} }` rejects.
- **E18 `suspendCounting`.** Over the QA app plan's E4 fake `dom`, with seam counters installed:
  - `startCounting()`; `apply` ×1; `await suspendCounting(async () => { apply ×3 })`; `apply` ×1. Then `stopCounting(1).seam.sink` equals `{ apply: 2 }`.
  - A throwing `work` leaves counting on (a later `apply` is tallied) and rethrows.
  - `suspendCounting` called while counting is off leaves it off.
- **E19 pointer event sequences** (jsdom). Set up a parent `div` P, appended to `document.body`, holding children A and B. Stub their `getBoundingClientRect` with `vi.spyOn`, as the docs site's [DocsContent.test.ts:168](packages/docs/tests/DocsContent.test.ts#L168) does: P `{0,0,100,20}`, A `{0,0,50,20}`, B `{50,0,50,20}`. A listener on P records `type`, target, `buttons` and `relatedTarget` for every pointer and mouse type. `tools` is fake: `runFrames` calls `step` synchronously, `suspendCounting` runs its work, `waitFrames` resolves, and `fireMouse` is the QA app plan's real `dom.ts` function.
  - `hover` over `{ element: P, axis: 'x' }`, 4 units, step 30. Span is 98 and origin 1, so the points are x = 31, 61, 91 and 77 at y = 10, and the hits are A, B, B, B. Recorded, in order:

    | Unit | Events |
    |---|---|
    | 0 | `pointerover` A (rel `null`), `mouseover` A (rel `null`), `pointermove` A, `mousemove` A |
    | 1 | `pointerout` A (rel B), `mouseout` A (rel B), `pointerover` B (rel A), `mouseover` B (rel A), `pointermove` B, `mousemove` B |
    | 2, 3 | `pointermove` B, `mousemove` B |
    | after | `pointerout` B (rel `null`), `mouseout` B (rel `null`) |

    Every event has `buttons` 0. The note is `hover: 2 crossings over 4 units among 3 elements`.
  - `click` over `{ elements: [A, B] }`, 3 units: at (25, 10) on A, then (75, 10) on B, then on A again. Each unit records `pointerdown` (1), `mousedown` (1), `pointerup` (0), `mouseup` (0) and `click` (0), where the number is `buttons`.
- **E20 `theme` and `countCssRules`** (jsdom).
  - Appending `<style>a{} b{}</style>` raises `countCssRules()` by 2.
  - With the fake `tools` above and a recording `ThemeTarget`, `theme` over 3 units calls `cycle(0)`, `cycle(1)`, `cycle(2)`, then `restore()` once. It pushes one note starting `theme: CSS rules `.
- **E21 `type` without `execCommand`** (jsdom). jsdom has no `document.execCommand`. `type` over `{ element: an <input> in the body, text: 'ab' }` rejects with `type: this engine has no document.execCommand; cannot type into input`, and dispatches nothing.

### Panels, unit-testable (`packages/qa/tests`)

- **P1 contract (amended).** The QA app plan's P1 is unchanged, except in one place. A driver of the default drive also counts as present when it is a key of `pageTargets(build.root)`. For example, a panel with no `afterMount`, `defaultDrive: 'theme:4'` and `targets: {}` would pass.
- **P7 mount smoke** (jsdom, `tests/mount.test.ts`). The file defines `tools = createTools({ Body, DOM })` and `SMOKE_WAITS`, a `MountWaits` of two named functions: `flushOnPaint` calls `Body.getInstance().flushLayout()` and resolves, and `settleAtOnce` resolves. For every id in `getPanelIds()`:
  - `mounted = await mountPanel(id, new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS)`;
  - `mounted.targets` contains every driver of `parseDrive(null, mounted.module.defaultDrive, 1)`, plus `idle` and `theme`, and every value is defined;
  - every `element` field is connected, and every `elements` array is non-empty with every entry connected;
  - then `Body.getInstance().removeComponent(mounted.build.root)` and `mounted.build.root.dispose()`, as [DocsSidebar.test.ts:53-60](packages/docs/tests/DocsSidebar.test.ts#L53) does.
- **P8 panel parameters** (jsdom, same file, same waits).
  - `mountPanel('shell-shallow', new URLSearchParams('n=3&grip=dock-h'), tools, SMOKE_WAITS)` rejects with `shell-shallow: unknown grip "dock-h" (expected sidebar, section)`; the error is thrown in `afterMount`.
  - `mountPanel('table-rows', new URLSearchParams('n=3&update=nope'), tools, SMOKE_WAITS)` rejects with `table-rows: unknown update "nope" (expected record, filter)` before any wait; the error is thrown in `build`.
  - `mountPanel('shell-deep', new URLSearchParams('n=3&grip=tab'), tools, SMOKE_WAITS)` resolves with `targets.drag.element` a `.TabButton`.

  `dock-v` and `dock-h` pick by rectangle, which jsdom does not lay out, so they are checked only in the shakedown.
- **P9 `choice`.** The three rows of its table.
- **P10 data** (node).
  - Each generator returns deep-equal output on two calls.
  - `lineSeriesPoints(1, 3)` → `[{x:0,y:23},{x:1,y:60},{x:2,y:97}]`.
  - `tableRows(3)[0]` has `id` 1, `name` `'Person 1'`, `department` `DEPARTMENTS[0]` and `active` false. `tableRows(3)[2].notes` is `'Note 3'`.
  - `folderRows(2)` has 26 rows. Row 0's `parentId` is null, and row 1's `parentId` is row 0's `id`.
  - `folderNodes(2)` has 2 folders of 5 children.
  - `markdownDocument(8, 0)` has 8 lines starting `## `, 2 fences, 1 table and 2 bullet lists. `markdownDocument(8, 1)` differs from it in exactly the 8 paragraph lines.
  - `codeDocument(20)` has 20 lines; the first is `function block0(value) {`.
- **P11 `pageTargets`** (jsdom).
  - `Object.keys(pageTargets(root))` is `['idle', 'theme']`.
  - `themeTarget([DarkTheme])` sets `DarkTheme` on `cycle(0)`, and `restore()` brings back the theme that was current when the target was built.
  - `themeTarget([])` throws.

### Manual only (a real host; needs the user's go-ahead)

Figures are per unit, from one run of each panel at its default `n` unless stated. "±0.02" allows for the one-frame lag of the `Split`'s coalesced drag flush.

- **M5 park (F06.3), both shells.** `park` with `work=1&geom=1`:
  - `work["sidebar.doLayout"]` and `work["main.doLayout"]` are each 1.00 ±0.02;
  - `geometry.sidebar` is identical in every unit;
  - no error.
- **M6 closed section (F08.3), both shells.** `drag` with `grip=sidebar&work=1`: `work["history.doLayout"]` is 1.00 ±0.02, and `work["history.getPreferredSize"]` is at least 1.00.
- **M7 editor theme rules (F23.1, C7), both shells.** `theme:4`: the note's rule total grows by about 51 × 4 × `before.host.editorViews`. From slice 23's report; not re-measured.
- **M8 `table-rows` (F19.2, P16).** `key` with `work=1`: `getVisibleRecords@TableBody` = 6.00.
- **M9 `treetable-rows` (F22.5 D7; F22.3 D8; C10).**
  - `key` with `work=1`: `getVisibleRecords@TreeBody` = 6.00.
  - `toggle` with `seam=1`: `ensureStyleRule`, `setRuleStyles`, `createElement` and `removeElement` are equal — one caret `Glyph` minted and one detached per visible branch row — and no `deleteStyleRule` belongs to that path. **Measured 2026-09-20: 70.5 each in `val-treetable` (20 units) and 71, 71, 70.5, 70.5 in `c10-probe`'s 2-unit phase, where `deleteStyleRule` is absent.** A longer phase does show deletes (47.95 over 20 units, 55.7 over `c10-probe`'s 20), but they follow elapsed time, not units: they are the collector reaching the glyphs the swap dropped, not the swap releasing them. So C10 is unfixed and its leak is GC-bounded — see [^c10], which names the run that shows it.
- **M10 `tree-nodes` (F18.6; F18.4).**
  - `passes` with `work=1`: `setStyleState@TreeRow` = 2 × `before.host.treeRows`.
  - `key` with `seam=1`: `ensureStyleRule`, `setRuleStyles` and `deleteStyleRule` are each 1.50.
- **M11 `list-items`, n = 300 (F18.2; F18.1).**
  - `passes` with `seam=1`: `seam.sink.apply` = **908**, measured 2026-09-20 (`val-list`). This supersedes the offline census's 906: the modelled DOM has no overlay scroller, and the engine's writes two more applies per pass — the same pass reads `getScrollMetrics` twice, which the offline pass does not. The 906 rows are unchanged.
  - `key` with `seam=1`: `apply` = 603 and `dispatchCustomEvent` = 1. The seam member is `dispatchCustomEvent`; this plan called it `dispatchEvent`, which no counter is keyed under.
- **M12 `chart-dashboard`, `n=50` (F26.1; F26.2).** `passes` with `seam=1`: `seam.sink.createElementNS` = 840 (4 × 210) and `seam.source.measureText` = 48 (4 × 12).
- **M13 `markdown-doc` (F25.3; C7).**
  - `passes` with `seam=1`: `seam.source.getElementRect` = 2.00.
  - `theme:4`: the note's rule total grows by about 51 × `before.host.editorViews` × 4.
- **M14 `canvas-idle` (F26.7; F26.8).** `before.host.webglContexts` = 0 with `webglAnimating` = 4, and `hiddenStarted` = `hiddenAnimating` = 4. `idle` with `seam=1`: `seam.sink.requestAnimationFrame` = `webglAnimating + hiddenAnimating` ±0.05. **Measured 2026-09-20: 0, 4, 4, 4 and 8 — met exactly**, by the rebuilt panel; the first sweep met neither half, which is what rebuilt it (see [^canvas]).
- **M15 shakedown.** Every panel runs once with every driver it declares (the runs are under *Verification*):
  - no report carries `error`;
  - every phase with `geom=1` has non-null geometry for every label;
  - each `hover` note gives more than 0 crossings;
  - each `theme` and `type` note is present.

If a figure differs, compare it with the offline census in [^offline] before concluding anything. The panel is not validated until the difference is explained. A plausible explanation for M11 is the real engine's overlay scroller, which slice 18's probe Q did not model — and that is what the first sweep found (M11 above).

---

## Verification

### Automated (the implementer runs these; none opens a window)

1. `npm -w packages/qa run typecheck` and `npm -w packages/qa run test` — E1–E21 and P1–P11, with the lib built.
2. `grep -rn "@jimka/typescript-ui" packages/qa/src/harness` — no matches.
3. `grep -rn "Math.random\|Date.now()" packages/qa/src/builders packages/qa/src/panels` — no matches.
4. `git diff --stat master -- packages/lib packages/docs` — empty.

### Dev-server smoke (no window, no browser)

This extends the QA app plan's smoke:

```sh
cd packages/qa
QA_LIB="$(realpath ../lib)" npx vite > /tmp/qa-smoke.log 2>&1 &
for _ in $(seq 1 80); do curl -sf -o /dev/null http://localhost:5190/ && break; sleep 0.5; done
for f in src/panels/*.ts src/builders/*.ts src/pageTargets.ts; do
  curl -sf -o /dev/null "http://localhost:5190/$f" || echo "FAIL $f"             # no FAIL lines
done
for pid in $(ss -ltnp | awk '/:5190 /' | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do kill "$pid"; done
```

### Manual sweeps (only with the user's go-ahead)

**Every command below opens a full-screen window on the user's desktop for about a minute. An implementer or agent must not run it.** Run from the repository root, with the library built. The default host is MiniBrowser; the same lines run in Tauri with `--host tauri`, which is how the `ta-*` runs beside these were made — one name prefix per host, as the measurement rules require.

Validation (M5–M14):

```sh
Q=packages/qa/runqa.sh
$Q val-sdeep-park   main 'panel=shell-deep&drive=park&work=1&geom=1'                 || exit 1
$Q val-sshal-park   main 'panel=shell-shallow&drive=park&work=1&geom=1'              || exit 1
$Q val-sdeep-drag   main 'panel=shell-deep&drive=drag&grip=sidebar&work=1'           || exit 1
$Q val-sshal-drag   main 'panel=shell-shallow&drive=drag&grip=sidebar&work=1'        || exit 1
$Q val-sdeep-theme  main 'panel=shell-deep&drive=theme:4'                            || exit 1
$Q val-sshal-theme  main 'panel=shell-shallow&drive=theme:4'                         || exit 1
$Q val-table        main 'panel=table-rows&drive=key:40&work=1'                       || exit 1
$Q val-treetable    main 'panel=treetable-rows&drive=key:40,toggle:20&work=1&seam=1'  || exit 1
$Q val-tree         main 'panel=tree-nodes&drive=passes:10,key:40&work=1&seam=1'      || exit 1
$Q val-list         main 'panel=list-items&drive=passes:10,key:40&seam=1'             || exit 1
$Q val-charts       main 'panel=chart-dashboard&n=50&drive=passes:10&seam=1'          || exit 1
$Q val-markdown     main 'panel=markdown-doc&drive=passes:10,theme:4&seam=1'          || exit 1
$Q val-canvas       main 'panel=canvas-idle&drive=idle:120&seam=1'                    || exit 1
python3 packages/qa/bin/qa-table.py packages/qa/results val- --seam \
  --before host.editorViews,host.treeRows,host.webglContexts,host.webglAnimating,host.hiddenStarted,host.hiddenAnimating
```

C10's deletes (one report, so both phases share a page and its collector):

```sh
$Q c10-probe main 'panel=treetable-rows&drive=toggle:2,toggle:20&seam=1' || exit 1
python3 packages/qa/bin/qa-table.py packages/qa/results c10-probe --seam
```

The swap counters are flat across the two phases and `deleteStyleRule` is absent from the short one, which is how M9 tells a per-toggle cost from the collector's ([^c10]).

Shakedown (M15): one run per panel with every driver it declares, then the non-default parameters of `shell-deep`, `shell-shallow` and `table-rows`:

```sh
$Q shk-sdeep   main 'panel=shell-deep&drive=resize:30,passes:10,hover:60,wheel:30,drag:30,park:30,idle:30,type:16,theme:4,toggle:60&seam=1&geom=1' || exit 1
$Q shk-sshal   main 'panel=shell-shallow&drive=resize:30,passes:10,hover:60,wheel:30,drag:30,park:30,idle:30,type:16,theme:4,toggle:60&seam=1&geom=1' || exit 1
$Q shk-table   main 'panel=table-rows&drive=wheel:30,resize:30,passes:10,key:20,update:30,click:10,drag:30&seam=1&geom=1' || exit 1
$Q shk-ttable  main 'panel=treetable-rows&drive=wheel:30,resize:30,passes:10,key:20,update:30,click:10,toggle:10&seam=1&geom=1' || exit 1
$Q shk-tree    main 'panel=tree-nodes&drive=wheel:30,resize:30,passes:10,key:20&seam=1&geom=1'   || exit 1
$Q shk-list    main 'panel=list-items&drive=resize:30,passes:10,key:20&seam=1&geom=1'            || exit 1
$Q shk-charts  main 'panel=chart-dashboard&drive=resize:30,passes:10,drag:30,hover:60,update:30&seam=1&geom=1' || exit 1
$Q shk-line    main 'panel=chart-line&drive=update:30,hover:60&seam=1&geom=1'                    || exit 1
$Q shk-md      main 'panel=markdown-doc&drive=drag:30,passes:10,wheel:30,resize:30,update:6&seam=1&geom=1' || exit 1
$Q shk-canvas  main 'panel=canvas-idle&drive=idle:60&seam=1&geom=1'                               || exit 1
for p in 'grip=dock-v' 'grip=sidebar' 'grip=section' 'grip=tab' 'hover=menubar' 'hover=tabs' 'wheel=editor' 'toggle=pane'; do
  d=drag:30; case "$p" in hover=*) d=hover:60;; wheel=*) d=wheel:30;; toggle=*) d=toggle:60;; esac
  $Q "shk-sdeep-${p/=/-}" main "panel=shell-deep&drive=$d&$p&geom=1" || exit 1
done
$Q shk-sshal-section main 'panel=shell-shallow&drive=drag:30&grip=section&geom=1' || exit 1
$Q shk-table-filter  main 'panel=table-rows&drive=update:30&update=filter&seam=1'  || exit 1
python3 packages/qa/bin/qa-table.py packages/qa/results shk- --seam
```

Accept when M5–M15 hold. Then fill in each panel's `Validated:` entry in the README's panel table, with the date, the library commit and the numbers. The shells' entries record their baselines as S1 and S3 stand-ins.

---

## Documentation Impact

- **No public API change.** Nothing is exported from `@jimka/typescript-ui`; TypeDoc, `llms.txt` and the changelog are untouched.
- **`packages/qa/README.md`**:
  - the new drivers, the page-wide targets and the panel table;
  - under the measurement rules: put `toggle`, `theme`, `type` and `drag` with `grip=tab` last in a `drive=` list, because they leave the page changed;
  - under the measurement rules: scale a panel with `n=`. For example, sweep `shell-deep` at `n=1` and `n=12` before bounding a document-wide cost;
  - the deep and shallow pairs: `shell-deep`/`shell-shallow` and `chart-dashboard`/`chart-line`;
  - a paragraph saying the shells stand in for Loom's S1 and S3, why their numbers differ from Loom's history, and that a later Loom plan will baseline against them.

---

## Potential Challenges

- **`grip=tab` can reorder or tear off a tab.** The drag returns to its start before releasing. Treat any later phase in the same run as running on a possibly reordered strip, and run it last.
- **`theme` is slow at scale.** Each unit restyles the whole page, so give it few units (`theme:4` to `theme:20`), never the default 150.
- **Stores of 1,000 rows or more rebuild their view in a worker** ([AbstractStore.ts:16](packages/lib/src/typescript/lib/data/AbstractStore.ts#L16)). A sort click or `update=filter` then lands a frame or more later. Per-unit averages over a phase still hold; jsdom has no worker.
- **Chart marks are rebuilt on every pass,** so `hover`'s candidate elements go stale. The driver skips disconnected candidates and falls back to the target element.
- **`editorViews` in `markdown-doc` depends on the screen height,** because fences upgrade near the viewport. M13 uses the counted value, not a constant.
- **CodeMirror may not mount under jsdom,** and P7 covers the shells. If `mountPanel` rejects for want of layout, exclude those panels from P7. The exclusion needs a comment that quotes the thrown error and names the jsdom gap; a panel bug is fixed instead.
- **Instance counters shadow a prototype method.** An ablation that patched the prototype after `installWork` would be bypassed for that one instance. Ablations run before `installWork` (run order step 7 before step 8), so this cannot happen within a run.

---

## Critical Files

- [`plans/qa-app.md`](plans/qa-app.md) — the app, panel contract, harness, run order and runner this plan extends; read it whole.
- [`../loom/qa/qa-harness.ts`](../loom/qa/qa-harness.ts#L100):
  - `fireMouse` :100, `pickGutter` :135, `runDrag` :210, `runWheelScroll` :261, `countMethod` :997, `split.noop-drag` :1268;
  - the S1/S3 setup: `tabs` :2011–2035, `grid=2x2` :2044–2075, the phases :2200–2223.
- [`packages/lib/src/typescript/DiagramPanel.ts`](packages/lib/src/typescript/DiagramPanel.ts#L20) — module-load `Glyph.register`, the precedent for `chrome.ts`.
- [`packages/docs/tests/DocsSidebar.test.ts`](packages/docs/tests/DocsSidebar.test.ts#L53) — the jsdom clean-up idiom P7 copies. [`DocsContent.test.ts`](packages/docs/tests/DocsContent.test.ts#L168) — the rectangle stub E19 copies.
- [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts#L1334):
  - `onDrag`'s unconditional `doLayout` (:1386, :1390);
  - `scheduleDrag` :1412;
  - gutter creation :1924–1949;
  - `setPaneCollapsed` :453.
- [`packages/lib/src/typescript/lib/layout/Accordion.ts`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1659):
  - the full pass: `reflowAll` true, the closed section's preferred height at :1675, `doLayout` at :1790;
  - `openSection` :913, `closeSection` :943;
  - resize gutters :1832.
- [`packages/lib/src/typescript/lib/overlay/Dock.ts`](packages/lib/src/typescript/lib/overlay/Dock.ts#L26) — `DockPanelSpec` and `DockLayoutSpec` :67.
- [`packages/lib/src/typescript/lib/component/tree/Tree.ts`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1083) — keyboard toggles; `selectNode` :391; `expandAll` :304.
- [`packages/lib/src/typescript/lib/component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts#L302):
  - the constructor; `setFilterRowVisible` :940; `getBody` :957; `selectRecord` :1055;
  - `TreeTable.ts`: `collapseAll` :231, `expandAll` :242.
- [`packages/lib/src/typescript/lib/component/chart/AbstractChart.ts`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts#L246) — `setSeries`; `setStore` :281; store events :29.
- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L94) — fence languages and the lazy upgrade (:136). `MarkdownViewer.ts`: `setMarkdown` :269.
- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2637) — `onThemeChange`, guarded only on `_view`.
- [`packages/lib/src/typescript/lib/component/display/AbstractCanvasSurface.ts`](packages/lib/src/typescript/lib/component/display/AbstractCanvasSurface.ts#L182) — `startAnimation`; `shouldAnimate` :386; `animationStep` :419.
- [`packages/lib/src/typescript/lib/core/Theme.ts`](packages/lib/src/typescript/lib/core/Theme.ts#L1366) — `ThemeManager.setTheme`; `getTheme` :1457.
- [`packages/lib/src/typescript/lib/core/Animation.ts`](packages/lib/src/typescript/lib/core/Animation.ts#L211) — the two `{ once: true }` listeners behind C15.
- [`plans/research/render-review-2026-09-15/99-synthesis.md`](plans/research/render-review-2026-09-15/99-synthesis.md#L846) — the correctness bugs; the groups from :1227.
- Slice reports 06, 08, 18, 19, 22, 23, 25 and 26, in the same directory — the probes behind M5–M14.

---

## Non-Goals

- **The follow-up plan's panels and drivers.** `qa-app-panels-editors-overlays` covers:
  - `diagram-graph`: F27's 802 lookups per `pointerdown` + `click` on 400 nodes, pan and zoom;
  - `code-document`: one editor at `n` lines;
  - `markdown-editor`: F24.1;
  - `windows`: G08, F09, C25 and the window-edge drag;
  - `form-flat` and `form-nested`: F15–F17, F28.10, C23, and the slider half of G28;
  - `menus`: F12.3, C24;
  - `table-wide`: the horizontal-scroll half of G28;
  - the drivers `pan` (a pointer-event drag), `viewport` (a window `resize` event) and `hwheel` (a horizontal wheel);
  - an `afterMount` that may return a promise.
- **Ablations for the wave-3 candidates.** Bounding each candidate is the work of the W3.0 sweep, the bounding sweep the agenda runs before wave 3 is planned; its ablations are written against these panels.
- **Changing Loom,** or retiring its harness. A later Loom plan does that, against the shells' baselines.
- **Starting a real host from any automated check,** or a headless-browser substitute for the WebKitGTK run.
- **Changing the harness's existing drivers, parameters, run order or report format.**
- **Importing docs demos or demo-app panels.**

---

## Notes

[^split]: The full catalogue is seventeen panels and thirteen new drivers, too much to review as one plan. The split follows the agenda's own "first scenes" list and adds four things:
    - the Loom stand-ins, whose baselines unblock a later Loom plan;
    - the list and canvas panels, which carry the plan's smallest census and the correctness phase's two named examples;
    - `type`, because the shells' status bar needs it;
    - `theme`, because the shells' editors need it.

    The follow-up's panels all need a driver this plan does not add (`pan`, `viewport`, `hwheel`) or an asynchronous `afterMount`. They form a coherent second plan that depends on this one.

[^driver-home]: The QA app plan keeps every driver in one table so that a new gesture is written once and every panel can name it. The table sits in the library-free harness, so a driver that needs the library must take the library's part as its target. `theme`'s target is therefore two plain functions built on the page side, and the driver keeps what is generic: the frame loop, the CSS rule counts and the restore. `update` and `toggle` are named copies of `call` because targets are keyed by driver name. A panel that offers both a data refresh and an expand/collapse needs two names, and each report phase then says which mutation ran. The generic driver is named `call` rather than `step`, because `step=` is already the URL parameter for pixels per unit.

[^suspend]: Without it, `park`'s lead-in and restore drags, around 25 frames of real layout, would land in the counting window and be divided across the measured units. That would blur the per-frame figure F06.3 turns on. The same holds, on a smaller scale, for `hover`'s rectangle reads, `key`'s focus and `type`'s clean-up. Two alternatives were rejected. Measuring the lead-in as a separate phase leaves the page parked between phases, and the harness resets and reports per phase. A driver-private flag would miss the native write counters and the seam counter, which share the harness's single `counting` flag.

[^pointer-events]: Each family reaches only its own listeners:
    - `Button` registers subtree `pointerover`, `pointerout` and `pointerdown` (slice 13 :222–229);
    - `Tooltip` registers exact-target `mouseover`, `mousemove` and `mouseout` (slice 13);
    - `AbstractChart` registers subtree `mousemove` and `mouseout` (slice 26 :241–243);
    - `DiagramView` pans on `pointermove` (slice 27 :326).

    A hover that sends only one family leaves half the hot path unexercised. A `mousemove` with `buttons: 1` reads as a drag to any handler that checks the button state, so a hover must send `buttons: 0`, which `fireMouse` now takes through its `init`. `PointerEvent` is a separate event class, with fields `fireMouse` does not carry (`pointerId`, `pointerType`), so it keeps its own helper.

[^hover-rects]: `document.elementFromPoint` per unit would follow layout changes, such as a tooltip appearing. But the event sequence would then differ between arms whenever an ablation moved something, which is exactly when the comparison matters. Rectangles read once make the sequence a function of the panel and the step. The sweep stays one pixel inside the element. At the default 3 px per unit, the pointer spends 20–27 frames (about 330–450 ms) on a toolbar button, under `Tooltip`'s 500 ms show delay ([Tooltip.ts:378](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L378)). Every hide is therefore the stray hide F11.1 measures, as in a real fast sweep. At `step=1` the pointer dwells about a second per button, so each tooltip shows and hides: the path G18's tooltip half and G19's `attach` half need.

[^park-lead]: An adaptive lead-in, moving until the element stops, would read layout every frame during the lead-in, and it could stop early on a coalesced frame that simply had not flushed yet. The panel knows its pane's preferred and minimum widths, so it can state a lead that overshoots by a fixed margin. Throwing when the element moved fails loudly, as the measurement rules require: a run that did not park measured the wrong thing, and its numbers must not reach a table.

[^type]: A script-built `InputEvent` is untrusted:
    - `TextField` would read the unchanged `value`;
    - CodeMirror inserts only on DOM mutations or trusted input;
    - Lexical's `beforeinput` path expects a real edit.

    `execCommand('insertText')` is deprecated, but WebKit still implements it for `<input>`, `<textarea>` and contenteditable elements, in MiniBrowser and in a Tauri webview alike, and it produces the same trusted `beforeinput`/`input` pair a keystroke does. The two up-front checks cost nothing and give a clear message. A failing insert needs no probe of its own: the QA app plan's frame loop now rejects on a throw from a unit, and the run reports the error at once.

[^page-targets]: `idle` and `theme` act on the whole page, not on one component, so every panel can offer them. Declaring them in every panel would repeat the same two entries in all nine, and a new panel could forget them. Putting `pageTargets` first in the merge keeps a panel able to replace either one, for example with a shorter theme list. The QA app plan's P1 checks a panel's default drive against `build.targets` only, so P1's amendment adds the page-wide keys.

[^params]: Loom chooses its gutter with `gutter=` on one app. The QA app has a tree per panel, so the same idea applies within a tree. Making depth a parameter instead would let two runs with the same panel id lay out different trees, and the analyser's `panel` column would no longer identify what was compared.

[^stand-in]: The user asked for these two panels to be shaped after S1 and S3, so their baselines can replace Loom's harness later. Four differences keep the numbers apart from Loom's:
    - the editors hold `codeDocument(300)` instead of Loom's source files;
    - the explorer is a library `Tree` over generated folders instead of Loom's `FileTree` over the repository;
    - the shell is built from library components instead of Loom's `EditorShell`, `FileEditor` and Tauri stubs;
    - Loom opens its tabs by double-clicking tree rows, where these declare them in the `Dock` layout.

    The shape that decides the campaign's figures is kept:
    - a `Split` beside a resizable `Accordion` with one closed section;
    - a `Dock` of `Border`-wrapped CodeMirror editors, 2×2 or single;
    - the gutter each scenario drags;
    - the drag-then-wheel phases.

    `n` counts tabs per region, and its defaults give S1's four editors and S3's one.

[^content]: The QA app plan's import rule: a baseline moves only when the library moves, so a panel never imports a docs demo or a demo-app panel. Shared chrome — the menu bar, toolbar and status bar — therefore lives in `src/builders/chrome.ts`, and every panel that needs chrome uses the same builders. A change to that chrome is then a change to the QA app, reviewed as one.

[^deterministic]: A/B comparisons require both arms to render the same content. Random data would also make M9–M12 non-reproducible, because the tick counts behind the chart census and the rows behind the list census come from the data.

[^instance]: M5 needs the sidebar pane's `doLayout` and the main pane's separately. Both are `Panel`s, and the class counter `doLayout@Panel` includes every other panel on the page. The label is fixed (`sidebar.doLayout`, not `doLayout@Panel`), so `qa-table.py`'s `work/u` sums it like any work key. None of these labels starts with `memo.`, `skipped.` or `stubbed.`.

[^offline]: Re-measured 2026-09-19 on `master` `72916718` under `installTestDOM` (1280 × 800 modelled viewport), with a throwaway probe that was not committed:
    - **List, 300 items:** an unchanged pass costs `apply` 906. One `ArrowDown` costs `apply` 603 plus `dispatchEvent` 1, and `ArrowUp` the same. A 3 px width change costs `apply` 907.
    - **Tree:** an unchanged pass costs `setStyleState@TreeRow` 62 at a pool of 31 rows, which is 2 × pool.
    - **Tree keyboard toggles:** a collapse costs `ensureStyleRule` 2, `setRuleStyles` 2 and `deleteStyleRule` 1; an expand costs 1, 1 and 2. This holds with the label renderer and with the icon renderer.
    - **Table:** `getVisibleRecords` is 6 per `ArrowDown`, 6 per `ArrowUp`, and 2 per unchanged pass with a row selected.
    - **TreeTable** (its own `getVisibleRecords` override): 6 and 6.
    - **TreeTable, 200 × 3 × 3:** `collapseAll` from fully expanded costs `ensureStyleRule` 37, `setRuleStyles` 37 and `createElement` 37 at 37 visible root rows, with no `deleteStyleRule`. `expandAll` costs 12, 12 and 0.
    - **MarkdownViewer:** an unchanged pass costs `getElementRect` 2.

    Confirmed by reading the code:
    - F06.3: `Split.onDrag` calls both panes' `doLayout` unconditionally (Split.ts:1386/1390).
    - F08.3: `Accordion.doLayout` runs `layoutSections` with `reflowAll` true, so a closed section gets `getPreferredSize` and `doLayout` every pass (Accordion.ts:1675/1790).
    - F23.1: `CodeEditor.onThemeChange` is guarded only on `_view` (CodeEditor.ts:2637), so every mounted editor, hidden or not, mints the 51 rules slice 23's probe counted per `codeEditorTheme()` call.

    From the QA app plan: the chart census, 210 marks and 12 `measureText` per 3 × 50 chart.

    Each matches its slice report's figure or rule.

[^smoke]: `SMOKE_SCALE = 3` keeps `markdown-doc` below its first fence (fences start at section 4), so jsdom never builds a CodeMirror view there. The fence path is exercised in the engine run. Every panel builds at any `n ≥ 1`, so 3 needs no special case. P7 checks that each panel builds, mounts through the real `mountPanel` and resolves its targets. `flushOnPaint` is what lets `afterMount` find the elements layout creates, such as gutters. It cannot check a driver on a mounted panel, because jsdom has no layout; E19 checks the drivers' event sequences on stubbed rectangles instead.

[^toggle-period]: Both animations last 200 ms, about 12 frames at 60 Hz: `Accordion`'s `_animationDuration` (Accordion.ts:169) and `CollapseSupport`'s `COLLAPSE_DURATION` (CollapseSupport.ts:19). A 30-unit period lets each toggle's animation and settle finish before the next toggle, so a phase measures whole animations, with idle frames between them.

[^c10]: What the two runs settle about C10. The signature the *Correctness signals* table gave — ensures with no deletes — is the offline census's shape ([^offline]), where a collapse over a 1280 × 800 modelled viewport touched 37 root rows and deleted nothing. `val-treetable`, over the engine's ~141 visible rows, did delete: 47.95 per unit against 70.5 ensures, which is neither the recorded bug state nor a fixed one.

    The caret swap is the four counters that move together. `refreshToggle` detaches the outgoing `Glyph` and appends a fresh one per visible branch row, which is one `removeElement`, one `createElement`, one `ensureStyleRule` and one `setRuleStyles` each (plus two `createElementNS` for the SVG, measured 141). C10's own code is unchanged on this build: `TreeCell.refreshToggle` still calls `removeComponent` on the outgoing `Glyph` and never disposes it ([TreeCell.ts:221](packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts#L221)).

    The deletes are not part of that path. `c10-probe` (2026-09-20, `panel=treetable-rows&drive=toggle:2,toggle:20&seam=1`, one report so both phases share a page) puts a short phase beside a long one: over 2 units the swap counters read 71, 71, 70.5 and 70.5 and `deleteStyleRule` is **absent**; over 20 units the same four hold at 70.5 and `deleteStyleRule` is **55.7**. A per-toggle cost would be flat across the two; this one follows elapsed time, which is `Component`'s `FinalizationRegistry` deleting an unreachable component's rule when the collector reaches it ([Component.ts:466](packages/lib/src/typescript/lib/core/Component.ts#L466)) — an orphaned caret is exactly that.

    So C10 is real and unfixed, and its leak is GC-bounded rather than permanent: every toggle mints a rule per visible branch row and releases none, and the rules go back only when the collector gets to the glyphs the swap dropped. That is the per-toggle signature M9 now checks, and it is a weaker report than the synthesis's "leaks 18 `Glyph`s with their `#id` rules", which reads as permanent. The correctness phase's status pass owns the wording and the fix; this plan owns the measurement, and `c10-probe` is the run that repeats it.

[^canvas]: What the first authorised sweep found about C35 and C36, what the panel does about it, and what the re-run showed. The first `val-canvas` measured `hiddenAnimating` 0 and `webglContexts` 4 of 4 surfaces: neither symptom, and the four `requestAnimationFrame` calls per idle frame it did count were four legitimate loops. The rebuilt panel's `val-canvas` (2026-09-20, `drive=idle:120&seam=1`) measured `surfaces` 4, `webglContexts` 0, `webglAnimating` 4, `hiddenStarted` 4, `hiddenAnimating` 4 and `requestAnimationFrame` 8 per idle unit — both symptoms, and M14 met exactly. `shk-canvas` ran clean beside it.

    C36 was the panel's own fault. It added each `Canvas` to the already-hidden group and only then called `startAnimation`, and `startAnimation` reconciles against `isEffectivelyVisible()` directly, so the loop was never scheduled. The bug is the reparent: a canvas that is *already* animating and is then moved under a hidden parent keeps its loop, because a move fires no `setVisible`/`setDisplayed` edge and nothing else reconciles it (`AbstractCanvasSurface` reconciles only from `startAnimation`, `stopAnimation`, `setAnimateWhenHidden` and `onEffectiveVisibilityChange`). The panel now builds the 2D canvases in the shown group, starts them there, records `hiddenStarted`, and then `moveComponent`s them into the hidden panel. `tests/mount.test.ts` pins that order under jsdom, where the visibility walk is plain component state.

    C35 was the environment. F26.7 says a context-less `WebGLCanvas` is the normal case in software-rendered WebKitGTK; in MiniBrowser under WSLg it is not the case at all — every surface got a real WebGL2 context. The mechanism it names is still there (`shouldAnimate()` consults visibility, never `hasRenderingContext()`), so the panel now constructs the precondition instead of assuming it: it takes each surface's 2D context through the seam before first layout, and a canvas element refuses every later context of another type. The re-run confirms that this engine does refuse it (`webglContexts` 0 with `webglAnimating` 4), so C35's mechanism reproduces here while its impact claim does not: a `WebGLCanvas` that cannot paint still schedules a frame for every browser frame, but nothing in this engine makes that the normal case.

---

## Implementation Notes

Where the implementation departs from the plan, or fills a gap it left, and what verified it.

- **P6 is amended too, not only P1.** `chart-line` now has an `afterMount` (its `hover` target), so `mountPanel` waits `settled` a second time. The QA app plan's P6 expected `painted, settled`; it now expects `painted, settled, settled`, and also checks the merged targets: `hover` is `{ chart element, 'x' }`, `idle` is the root, and `theme` has `cycle` and `restore`.
- **P1's amendment is a helper with its own test.** `untargetedDrivers(defaultDrive, build)` in `tests/panels.test.ts` counts a driver as present when `build.targets` or `pageTargets(build.root)` has it, and a separate case pins the plan's example: `theme:4` with `targets: {}` passes, `idle,passes` reports `passes`.
- **P7 and P8 replace `isPainted` in their tools.** The plan's P7 uses `createTools({ Body, DOM })` as is. Under jsdom every rectangle is empty, so the real `isPainted` is false everywhere, and the shells' `type` target (`firstPainted(…, '.cm-content')`) threw `no painted .cm-content`; P8's `shell-deep&grip=tab` case could not resolve. `tests/mount.test.ts` spreads `createTools` and treats a connected element as painted, as `SMOKE_WAITS` stands in for the paint wait. CodeMirror does mount under jsdom.
- **P7 excludes two panels for jsdom gaps**, as *Potential Challenges* allows, each with the error quoted in `JSDOM_GAPS`:
  - `shell-deep`: `shell-deep: no dock-h gutter`. Its default `grip=dock-h` picks the gutter by shape, and jsdom lays nothing out. P8's `grip=tab` case mounts it and runs the same target checks as P7.
  - `table-rows`: `Cannot set properties of null (setting 'font')`. The filter row's text fields measure font metrics through a canvas 2D context (`ProductionDOMSource.measureFontMetrics`), and jsdom's `getContext('2d')` returns `null`. Neither is a panel bug. An extra case asserts that each excluded panel still fails under jsdom with exactly that error, so a library or jsdom change that closes the gap shows up as a failing test rather than a silent exclusion.
- **`waitFrames` has a test** in `tests/frames.test.ts`, which the *Files* table does not list: it requests the given frames and advances no frame counter.
- **`drivers.dom.test.ts` pins three more `type` rows** beyond E21, with `document.execCommand` stubbed: a `<div>` that does not take focus rejects with `type: div did not take focus`; an insert returning `false` rejects with the `insertText` message; and a successful run inserts one character per unit, cycling the text, deletes as many, and notes `type: 3 characters into input`.
- **`hover` leaves out the descendants the engine's hit test passes through.** The plan's hit is the last rectangle in document order that contains the pointer, over the element and all its descendants. That lands on elements a real pointer never targets: `Button` and `TabButton` make their content `pointer-events: none` so the whole face hits the button, and the button's tooltip listens on the button alone. Hit that way, a sweep across a toolbar would send a stray `mouseout` to the button on entering its label, cancel the tooltip's show timer, and inflate the crossing count. `readSweepFrame` now drops, once, before the first unit, every descendant whose computed `pointer-events` is `none` or whose `visibility` is `hidden`; the rectangles are still read once, so the sequence stays the same in every arm. `tests/drivers.dom.test.ts` pins both cases with a label laid over B.
- **`key` and `type` settle inside their suspended setup.** The plan's table gives their setup no wait. But moving `type`'s caret queues a `selectionchange` task that fires after `suspendCounting` returns; a CodeMirror target answers it with a selection update, which fires the shells' `cursorchange`, sets the status bar's message and relays it out, all counted in unit 0. Both drivers now wait `SETTLE_FRAMES` inside the suspension after focusing, as `park`'s lead-in does; `tests/drivers.dom.test.ts` pins the order (a suspended wait, then the measured frames).
- **`park` needs at least two units.** Its moved check reads the rectangle before the last unit's move lands (see below), and with one unit that is the lead-in's own rectangle, so `park:1` could never fail. The driver rejects fewer than two units with `park: needs at least 2 units, got <n>` before dispatching anything. `tests/drivers.dom.test.ts` also pins `park`'s whole sequence on stubbed rectangles — the press and ten lead-in moves, the measured moves, the release, the drag back — its note, and the throw after restoring when the element moved.
- **`park` settles after its restore drag.** The plan's teardown ends with the drag back; the driver then waits `SETTLE_FRAMES`, as `hover` and `type` do, so the restored layout lands before the next phase starts counting.
- **`park`'s moved check relies on the gutter's one-frame lag.** The last measured unit returns the pointer to `leadPx`, where the lead-in left it, so a gutter that followed the pointer would read the same rectangle at both ends if it applied moves at once. The teardown reads the rectangle before that last move lands: `Split.scheduleDrag` applies a move in the frame after it arrives, so an element that did not park reads one unit further out and the check throws. This holds for every `park` target in this plan (the explorer gutter); a future target that applies moves synchronously would need a different check. The code comment on `releaseAndRestore` says so.
- **`table-rows` lists all twelve fields in `columns`, in model order.** The plan names only `department`'s `values` and `notes`' `filterable: false`. Listed columns come first and unlisted ones are appended after, so listing only those two would have moved them to the front and broken `SORT_COLUMN_INDEX = 1` (`name`).
- **`treetable-rows` sets `appendUnlisted: false`**, so the table shows the four columns the plan lists; otherwise the library appends `id` and `parentId` as columns.
- **Small exports beyond the builders table:** `data.ts` also exports `DEPARTMENTS` (the table's `values` and P10), `Y_SPAN` (moved from `chart-line`, which its `update` needs) and `FOLDER_ROWS_PER_ROOT` (13, which `treetable-rows` needs); `builders/dom.ts` also exports `elementFor(tools, component, label)`, the component-element lookup the other helpers and several panels share.
- **The shells wire `showCursor` through `CodeEditor`'s `listeners` option** instead of calling `on('cursorchange', showCursor)` after construction: the same listener, through the construction-time idiom the code conventions prefer. `showCursor` writes to a module-level `cursorStatus`, set by `buildShell`, since a page mounts one panel.
- **Where the shells read their parameters:** `toggle=` in `build`, and `grip=`, `hover=` and `wheel=` in `afterMount`, as P8 requires for `grip=`.
- **A store-backed panel must wait for its view** (found by the first authorised sweep in WebKitGTK). `AbstractStore.applyView` builds the view on a worker once the store holds `WORKER_THRESHOLD` = 1,000 records, a worker is available and no sorter is custom ([AbstractStore.ts:1905](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1905)), and `loadData` then holds its `load` event until the worker answers ([:446](packages/lib/src/typescript/lib/data/AbstractStore.ts#L446)). A panel that read its store at build or mount time therefore read an empty view: `table-rows`' `update` threw on `store.getAt(…)!` at n = 10,000, and `treetable-rows` threw `no element matches .NumberCell` in `afterMount`, its body having no rows. Worse, `table-rows`' `afterMount` selected nothing and its `key` phase then measured an empty table, a wrong figure rather than an error.

  `src/builders/store.ts` adds `awaitStoreView(tools, store, label)`. It resolves at once when the view already holds records; otherwise it resolves on the store's own `load` — never by polling — and then waits three frames for the rows to render, so a lookup or a selection that follows sees them. When no view arrives it rejects with `<panel>: the store's view is still empty 10000ms after loadData` instead of hanging until the runner's timeout. `table-rows`, `treetable-rows`, `list-items` and `chart-dashboard` now await it in `afterMount` before they touch their store or the tree; `list-items` re-applies its `selectedIndex` there, because `List`'s construction-time option cannot select from a view that does not exist yet. `PanelBuild.afterMount` may now return a promise, and `mountPanel` awaits it.

  Affected at their default scale: `table-rows` (10,000 rows) and `treetable-rows` (200 roots = 2,600 rows). Affected only above it: `list-items` from `n=1000`, and `chart-dashboard` from `n=334`, where its three series per store first reach 1,000 records. Not affected: `tree-nodes` and the shells' trees (a `Tree` holds nodes, not a store), the shells' outline `List` (60 items), `chart-line` (its series are data, not a store), `markdown-doc` and `canvas-idle`.
- **Why every offline check missed it, and what the new test pins.** jsdom has no `Worker`, so `StoreWorkerClient.isAvailable()` is false and every store in every test builds its view synchronously — P1 builds `table-rows` at its full 10,000 rows and finds a populated view, and P7 mounts each panel at `n=3`. No test under `tests/` can reproduce the worker path, so mounting a panel proves nothing here. `tests/store.test.ts` pins the contract instead: P12 drives `awaitStoreView` over a store filled by hand (it waits for the render frames when the view is already there; it holds until a `load` fills the view, ignoring one that leaves it empty; it stops listening either way; and it fails with the panel's name when no `load` arrives), and P13 checks that each of the four panels' `afterMount` stays pending while the wait is held and only then reaches its element lookups. The file's header says exactly that, and that it does not prove the worker path itself works.

**Verification run.** `npm -w packages/qa run typecheck` passes, and `npm -w packages/qa run test` passes 197 tests in 12 files (E1–E21, P1–P13 and the cases above). `grep -rn "@jimka/typescript-ui" packages/qa/src/harness`, `grep -rn "Math.random\|Date.now()" packages/qa/src/builders packages/qa/src/panels` and `grep -n "new MouseEvent" packages/qa/src/harness/drivers.ts` find nothing, and `git diff --stat master -- packages/lib packages/docs` is empty. The dev-server smoke passed: with `QA_LIB` set to this checkout's `packages/lib`, Vite served every file under `src/panels/`, `src/builders/`, `src/harness/`, `src/pageTargets.ts` and `src/mount.ts` with no `FAIL` line, and port 5190 was free afterwards.

**Runs to re-run after the store-view fix.** Every run of a store-backed panel made before it is void: `val-table`, `val-treetable`, `val-list` and `val-charts` from the validation sweep, and `shk-table`, `shk-ttable`, `shk-list`, `shk-charts` and `shk-table-filter` from the shakedown. A run that errored measured nothing; one that passed may have measured an empty component, so neither its figure nor its `geom` reference can be kept. Runs of the other panels stand: the mount sequence is unchanged for them, since awaiting a non-promise `afterMount` costs one microtask.

**The first authorised sweep: what ran.** On 2026-09-20 the user ran the whole validation block (M5–M14) and the whole shakedown (M15) in MiniBrowser, against a library build unchanged from `master` `608544c9`, including re-runs of the four store-backed panels voided above. The reports are in `packages/qa/results/`; the newest file per run name is the valid one, and `bin/qa-table.py <dir> val- --seam --before …` is the reading of them this section quotes. No run opened from here: every figure below was read back from a report.

**What passed.** M5 both shells (`sidebar.doLayout` and `main.doLayout` 0.99, the sidebar's rectangle identical in all 150 units, no error), M6 both shells (`history.doLayout` and `history.getPreferredSize` 1.00), M7 both shells exactly (517 → 1,333 rules at 4 editor views, 325 → 529 at 1, both 51 × views × 4), M8 (6.00), M9's first half (6.00), M10 exactly (`setStyleState@TreeRow` 186 at 93 rows; `ensureStyleRule`, `setRuleStyles` and `deleteStyleRule` 1.50 each), M12 exactly (840 and 48), M13 exactly (`getElementRect` 2.00; 494 → 1,514 at 5 editor views) and M15 (no report carries `error`, every `geom=1` phase has a rectangle for every label in every unit, every `hover` note gives 1–11 crossings, and every `theme` and `type` note is present). The QA app plan's `chart-line` census also reproduced exactly (1,081 sink calls, `measureText` 12).

**What the sweep changed here.** Three figures the engine disagreed with, and one panel:
- M11's `passes` figure is now 908, not the offline 906, and its seam counter is `dispatchCustomEvent`, not `dispatchEvent`. Both are recorded in M11, in the panel's `description` and in the README row.
- M9's second half no longer reads the leak off a phase total. It says what the swap counters do (70.5 each) and that the deletes a long phase also shows are no part of that path — which the probe below then proved, and [^c10] records.
- M14 failed, and `canvas-idle` was rebuilt for both of its halves ([^canvas]): the 2D canvases are started in the shown group and then moved under the hidden panel, and the WebGL surfaces have their 2D context taken first so the engine refuses them a WebGL2 one. `tests/mount.test.ts` gained a case pinning the reparent order under jsdom; `npm -w packages/qa run test` now passes 209 tests in 12 files, and the typecheck stays clean.
- The follow-up plan's M26 (`menus`) is corrected in the same pass: the sink total is 456.68 per unit, not 412, all of the difference in `apply`.

**The two runs that followed, and what they settled.** The user then ran the rebuilt `canvas-idle` and the C10 probe, both on 2026-09-20 against the same build:
- `val-canvas` met M14 exactly — `webglContexts` 0, `webglAnimating` 4, `hiddenStarted` 4, `hiddenAnimating` 4, and `requestAnimationFrame` 8 per idle unit, their sum — with `shk-canvas` clean beside it. Both halves of the panel now do what they exist for, so `canvas-idle`'s README entry is filled in like the rest.
- `c10-probe` (`drive=toggle:2,toggle:20`, one report) settled C10. The swap counters are flat across the two phases (71/71/70.5/70.5 over 2 units, 70.5 each over 20) while `deleteStyleRule` is absent from the short phase and 55.7 in the long one: the deletes follow elapsed time, not toggles, so they are the collector reaching the dropped glyphs and not the swap releasing them. C10 is unfixed, and its leak is GC-bounded rather than permanent; M9, [^c10] and the *Correctness signals* row say that, and the run is in *Verification* so a reader can repeat it.

**The Tauri sweep.** The user then ran every validation shape a second time in the Tauri host, `ta-*` beside the `val-*` runs, against the same library build. Every run came back at the same viewport (5120 × 2075) and the same `before.elements` as its MiniBrowser counterpart, and 21 of the 23 reports carry byte-identical `seam`, `work` and `geometry`, so every M-check that passed in MiniBrowser passes in Tauri — M5 through M15, at the same figures. Two panels differ, both in read counters only and neither in a checked figure: `markdown-doc`'s `theme` phase reads `getElementRect` 2.25 against 1.50 and `getScrollMetrics` 7.75 against 7.50, and adds `getOffsetSize` 0.25 and `querySelector` 0.50 that MiniBrowser does not record (its `passes` phase, which M13 checks, is identical, as is the rule growth); and `canvas-idle` reads `getContext` 1.8 per unit against 1.9, with `requestAnimationFrame` identical at 8. The README's panel table now carries both halves.

Frame times are recorded per host and not compared: the two sweeps ran in different sessions, where the *Measurement rules*' 8–14% drift applies, so a ratio between the columns would measure the sessions. Counts, rule totals and rectangles are deterministic, and those did agree. Both sweeps measured `608544c9`; `master` has moved on since, and its `packages/lib` is not that build, which is why every entry names the commit.

**The tree panels, re-verified against current `master`.** The rebase onto `2df6a50d` brought in the `feature/tree-reveal-structural-races` merge, which rewrote `component/tree/Tree.ts` and `TreeNode.ts` (899 insertions) — the code behind `tree-nodes` and both shells' explorers. A same-session A/B (`tr-*`, each query old-new-old so the drift shows in the bracket) put `608544c9` against `2df6a50d`: for `tree-nodes`, `shell-deep` and `shell-shallow` the `before.elements`, the host census (`nodes` 1,800 / `treeRows` 93; `fileNodes` 240 / `outlineItems` 60), every `seam` and `work` counter and every geometry sample are identical, and the times sit inside the old arm's own bracket (tree `key` 89.9 / 88.6 / 88.4; sdeep `park` 8.9 / 11.5 / 10.8 and `drag` 67.6 / 66.7 / 67.6; sshal `park` 9.3 / 9.1 / 9.6 and `drag` 59.0 / 60.2 / 58.8). The entries still name `608544c9`, the build their numbers were taken on, and now say they were re-verified: the tree work changed structure, not per-frame cost on these paths.

**A rule that A/B earned: `deleteStyleRule` and `release` are not deterministic.** The control pair was `treetable-rows`, whose `TreeTable` does not use the `Tree` component and so cannot have changed; every counter matched across the two arms except `deleteStyleRule` (43.65 against 47.95) and `release` (130.95 against 143.85). Both also fire from `Component`'s `FinalizationRegistry`, so they follow elapsed time rather than work — which is what `c10-probe` showed within one report, and what M9 is written around. A run-to-run difference in those two is not evidence of a change, and an A/B must be read on the deterministic counters. The README's *Measurement rules* now say so, with the control as the evidence.

**What is still open.** Nothing in this plan's own checks. C10's *wording and fix* belong to the correctness phase's status pass — the measurement is done, the report the synthesis carries is stronger than what the engine shows. A later sweep that re-measures any of these figures must say which build it ran, since `608544c9` is no longer `master`.
