---
depends-on: [qa-app, qa-app-panels]
touches-shared:
  - packages/qa/src/harness/types.ts
  - packages/qa/src/harness/drivers.ts
  - packages/qa/src/panels.ts
  - packages/qa/src/mount.ts
  - packages/qa/src/pageTargets.ts
  - packages/qa/src/builders/data.ts
  - packages/qa/src/builders/dom.ts
  - packages/qa/tests/drivers.test.ts
  - packages/qa/tests/drivers.dom.test.ts
  - packages/qa/tests/builders.test.ts
  - packages/qa/tests/pageTargets.test.ts
  - packages/qa/tests/mount.test.ts
  - packages/qa/README.md
---

# QA App Panels: Editors and Overlays — Implementation Plan

## Overview

This is the second half of the QA app's panel catalogue. Two plans come before it:

- `qa-app` (the QA app plan) built `packages/qa`: a standalone app with its harness, panel contract and runner.
- `qa-app-panels` (the first panels plan) added ten drivers and nine panels. They cover layouts, tables, trees, lists, charts, Markdown viewing and canvases, and include two shells that stand in for Loom's S1 and S3 scenarios.

This plan covers the rest of what wave 3 needs measured: the diagram, a large code document, the Markdown editor, floating windows and dialogs, forms, menus and a wide table. Wave 3's candidates are in [`00-post-campaign-agenda.md`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L110) (Phase 3) and [`99-synthesis.md`](plans/research/render-review-2026-09-15/99-synthesis.md#L1227). There, G-numbers are plan groups, F-numbers are slice-report findings and C-numbers are correctness bugs.

This plan delivers:

1. **Three new drivers** in the harness's `DRIVERS` table:
   - `pan`, a pointer-event drag;
   - `viewport`, a window `resize` event;
   - `hwheel`, a horizontal wheel.
2. **One contract addition**: a panel's `afterMount` may return a promise, which `mountPanel` awaits. `viewport` also joins the page-wide targets.
3. **Eight panels**: `diagram-graph`, `code-document`, `markdown-editor`, `windows`, `form-flat`, `form-nested`, `menus` and `table-wide`.
4. **A coverage map** for the wave-3 candidates and correctness bugs these panels take over from the first panels plan.
5. **A validation figure for each panel that has one.** Most were re-measured offline on today's `master`. The rest are marked "from the report" or "none recorded".

Only `packages/qa` changes.

---

## Architecture Decisions

### Drivers follow the first panels plan's rules

The new drivers follow the rules of the first panels plan (`qa-app-panels.md`):

- A driver joins `DRIVERS` and imports nothing from the library.
- Setup and teardown run inside `tools.suspendCounting`, so only the measured units are counted.
- Each pointer/mouse pair goes through the private `firePair`: `firePointer` sends the pointer event, then `tools.fireMouse(…, { buttons, relatedTarget })` sends the mouse event.
- Nothing assumes the host. The same page runs in MiniBrowser and, after `qa-app-tauri`, in a Tauri webview.[^driver-rules]

### `pan` is `drag` for pointer events, with every event on the pressed element

`pan` presses an element, moves out and back along one axis, and releases. Its target has the same shape as the `drag` target: `{ element, axis }`. `DiagramView` and `Slider` listen for pointer events on themselves ([DiagramView.ts:1812-1817](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1812), [Slider.ts:531-580](packages/lib/src/typescript/lib/component/input/Slider.ts#L531)), so every event goes to the pressed element. A real browser delivers the events to the same place: the pointer stays over the element, or the element holds pointer capture.

| Stage | Events (`firePair` unless stated) | Counted |
|---|---|---|
| setup | `down` at the element's centre, `buttons: 1` | no |
| unit `i` | `move` to centre + `parkOffset(i, units, step, 0)` along `axis`, `buttons: 1` | yes |
| after | `up` at the last position, `buttons: 0` | no |

`parkOffset(i, units, step, 0)` is the first panels plan's out-and-back walk with no lead.[^pan]

### `viewport` fires the window's `resize` event without changing the viewport

`viewport` dispatches `new Event('resize')` on `window` once per unit. Every viewport listener runs: `Body`, open windows, the minimized-window stack and dialogs. It runs against an unchanged viewport size, which is the case F09.7's repeat probe and F03.2 measure. A real window resize also changes the size, and no page script can resize the top-level window of either host.[^viewport]

### `hwheel` is `wheel` on the horizontal axis

`hwheel` sends `deltaX` ±40 instead of `deltaY`, with the same out-and-back halves and the same `WHEEL_DELTA_PX` constant as the QA app plan's `wheel`.

### A panel's `afterMount` may return a promise

`PanelBuild.afterMount` may return `Promise<Record<string, unknown>>`, and `mountPanel`'s step 5 becomes `mounted = await (build.afterMount?.(tools) ?? {})`. `DiagramView` lays its graph out asynchronously, so a click census taken before `whenLaidOut()` settles would measure an empty view. A synchronous `afterMount` still works unchanged.[^async-mount]

### Every page gets a `viewport` target

The first panels plan's `pageTargets(root)` becomes `{ idle: root, theme: themeTarget(THEME_CYCLE), viewport: root }`. Every page has viewport listeners (`Body`, at least), so any panel can be driven with `drive=viewport`.

### Panel content is built here; the demo-app panels are mirrored, never imported

The QA app plan's import rule forbids importing demo-app panels. Where the library's demo app already arranges a component well, the panel copies that arrangement and generates its own data:

| Panel | Mirrors | Copied from the demo |
|---|---|---|
| `diagram-graph` | `DiagramPanel` | a toolbar of zoom buttons above the view |
| `code-document` | `CodeEditorPanel` | an editor toolbar, and a status line updated on every cursor change |
| `markdown-editor` | `MarkdownEditorPanel` | an editor beside a live `Markdown` preview |
| `form-nested` | `PropertyGridPanel` | its inspector: a `Table` with a cell type per row |

The menu bar and the toolbar come from the first panels plan's `src/builders/chrome.ts`.[^mirror]

### Panel ids fix the tree; parameters choose targets

The first panels plan's rule holds: a panel id fixes the tree, and URL parameters (`grip=`, `passes=`, `type=`, `click=`) only choose targets. Where depth matters there are two panel ids. `form-flat` and `form-nested`, built by one builder, put the same fields in one grid, and in fieldsets beside an inspector.

The other panels have one variant each, because their cost grows with `n`, not with depth. The first panels plan's two shells are the deep and shallow partners of `code-document`.[^variants]

### A geometry probe for an element that exists only after mount

A geometry target may be any object with `getId()`, which the probe resolves at sample time. `lateId()` in `src/builders/dom.ts` returns such an object together with a setter, and `afterMount` sets the id once it has found the element.

`windows` probes the south resize strip of its C25 window this way. The strip is a private component with no class of its own to select on.

### Validation figures are re-measured offline where the slice's fixture can be rebuilt

As in the first panels plan, each figure is a count, not a time. On 2026-09-19, at `master` `72916718`, the window, menu, form-field and diagram figures were re-measured under the modelled DOM with this plan's fixtures. Several differ from the slice reports, because waves 1 and 2 changed the code, and the plan uses today's values.

The Markdown-editor and zoom figures come from the reports: their probes need a Lexical view or the real wheel handler, which the modelled DOM does not provide. `code-document` and `table-wide` have no recorded figure.[^offline]

---

## Coverage

This table maps the wave-3 candidates and correctness bugs this plan takes over from the first panels plan's *(plan 2)* rows. `seam:` names `DOM.sink`/`DOM.source` calls under `seam=1`, and `work:` names method-call counters under `work=1`. `form-*` means both form panels.

| Candidate | Hot path | Panel · driver (param) | Read |
|---|---|---|---|
| G05 / G11 (the form half) | size-report fan-out in labelled grids and fieldsets | `form-*` · `passes` (`passes=header`, `form`), `resize` | work: size-hint calls, flat against nested |
| G08 `environment-read-caching` | viewport reads per resize event; window show before mount; dialog open; theme-var reads | `windows` · `viewport`, `toggle` (dialog); any panel · `viewport` | seam: `getViewportSize`, `getThemeVar` |
| G09 more opt-ins (overlay half) | a settled window re-laid out and rewritten every pass | `windows` · `passes` | seam: `apply`; work: `doLayout@<class>` |
| G16 (editor and form scroll) | per-wheel scroll-metric reads | `code-document` · `wheel`; `form-*` · `wheel` | seam: `getScrollMetrics`, `getScrollTop` |
| G18 `text-measurement-without-reflow` | menu row text; a status `Text` updated per keystroke; field tooltips | `menus` · `toggle`; `code-document` · `type`, `key`; `form-flat` · `type` (`type=text`) | seam: `measureText`, `measureTexts` |
| G19 `tooltip-hover-path` (form half) | `FieldDecorator` error tooltip, attached and detached per keystroke | `form-*` · `type` (`type=text`) | seam: `setRuleStyles`, `addListener`, `removeListener` |
| G20 `event-dispatch-and-registrants` | subtree listeners on the menu bar, toolbar and diagram | `menus` · `hover`; `diagram-graph` · `hover` | seam: `getId`, `getParentElement` |
| G24 (the `ComboBox` half) | a combo dropdown opened with 20 items | `form-*` · `click` (`click=combo`) | seam: `apply`, `measureText` |
| G26 (the lexer half) | the live preview re-lexes the document per keystroke | `markdown-editor` · `type`, `update` | frame time; seam: `apply` |
| G28 `continuous-motion-pattern` | diagram pan; slider drag; window header move; table header translate | `diagram-graph` · `pan`; `form-*` · `pan`; `windows` · `drag` (`grip=header`); `table-wide` · `hwheel` | seam: `setRuleStyles`, `apply`, `getViewportRect`; frame time |
| F24.1 `MarkdownEditor` re-serialisation | one full export per commit, caret moves included | `markdown-editor` · `call`, `type` | work: `handleChange@MarkdownEditor` |
| F27.x `DiagramView` | lookups per click; a rule write per pan move; residency per zoom notch | `diagram-graph` · `click`, `pan`, `wheel` | seam: `getElementById`, `contains`, `setRuleStyles`; work: `setResidency@DiagramEdgeLayer` |
| F09.2 and the `resizeMode` flag | window-edge resize | `windows` · `drag` (`grip=edge`) | frame time |

G24's `ArrowDown` half (F16.2: class writes per `ArrowDown` in an open dropdown) is not covered. It needs the dropdown kept open across a `key` phase, which no panel here does.

### Correctness signals

| Bug | Panel · driver | Signal today | After the fix |
|---|---|---|---|
| C23 `DateField` accepts partial dates and flashes its border while typing | `form-*` · `type` (`type=date`) | seam: `setRuleStyles` > 0 over the ten characters of `2026-09-19` (six, by slice 17) | 0 |
| C24 `MenuBar` ignores its 1 px border | `menus` · any driver with `geom=1` | `geometry.menubarButton` reaches the bar's bottom border | a fix arm shows `menubarButton` 1 px shorter, with `geom` `DIFF` on that label only |
| C25 the window's south strip takes the right inset | `windows` · any driver with `geom=1` | `geometry.southStrip` height is 12 (the right inset) | 4 (the bottom inset) |

C30, C31 and C33 have no signal a panel can read. The harness takes its snapshot of the page before the phases only, and a synthetic `resize` leaves the viewport size unchanged.

---

## Public API

This is internal tooling: nothing is exported from `@jimka/typescript-ui`.

### Harness types — `src/harness/types.ts` (addition)

```ts
/** `pan`: presses `element`, moves out and back along `axis` (`step` px per unit), releases; every event on `element`. */
export interface PanTarget { element: Element; axis: 'x' | 'y'; }
```

### New drivers in `DRIVERS`

| Driver | Target | Setup, suspended | Per unit | After, suspended |
|---|---|---|---|---|
| `pan` | `PanTarget` | read the element's centre; `firePair` `down` there, `buttons: 1` | `firePair` `move` on the element, at centre + `parkOffset(index, units, step, 0)` along `axis`, `buttons: 1` | `firePair` `up` at the last position, `buttons: 0`; `waitFrames(SETTLE_FRAMES)` |
| `viewport` | any defined value | — | `window.dispatchEvent(new Event('resize'))` | — |
| `hwheel` | `Element` | — | a bubbling, cancelable `WheelEvent` at the element's centre: `deltaX` +`WHEEL_DELTA_PX` for the first half, −`WHEEL_DELTA_PX` for the second, `deltaY` 0 | — |

| Driver | Rejects when | Message |
|---|---|---|
| `pan` | no element, or axis not `'x'`/`'y'` | `pan: target must be { element, axis: "x" \| "y" }` |
| `hwheel` | target is not an element | `hwheel: target must be an Element` |

"An element" means an object with `getBoundingClientRect` and `dispatchEvent` functions, as in the first panels plan.

### The panel contract — `src/panels.ts` (one widened member)

```ts
afterMount?(tools: HarnessTools): Record<string, unknown> | Promise<Record<string, unknown>>;
```

### The page side — `src/pageTargets.ts` (one change)

`pageTargets(root)` returns `{ idle: root, theme: themeTarget(THEME_CYCLE), viewport: root }`.

### Panel parameters

| Panel | Parameter | Values (first is the default) |
|---|---|---|
| `windows` | `grip` | `header`, `edge` |
| `form-*` | `passes` | `form`, `header`, `date`, `combo` |
| `form-*` | `type` | `text`, `date` |
| `form-*` | `click` | `toggle`, `combo` |

Every parameter is read with the first panels plan's `choice`. An unknown value throws `<panel>: unknown <name> "<value>" (expected …)`.

---

## Internal Structure

### Harness: `pan` in outline

```ts
async function pan(ctx: DriveContext): Promise<number[]> {
    const target = requirePanTarget(ctx.target);
    const origin = await ctx.tools.suspendCounting(async () => pressAtCentre(ctx.tools, target.element));   // firePair 'down', buttons 1
    let point = origin;

    const samples = await ctx.tools.runFrames(ctx.units, (index) => {
        point = offsetAlong(origin, target.axis, parkOffset(index, ctx.units, ctx.stepPx, 0));
        firePair(ctx.tools, 'move', target.element, point.x, point.y, { buttons: 1 });
    });

    await ctx.tools.suspendCounting(async () => releaseAndSettle(ctx.tools, target.element, point));   // firePair 'up', buttons 0

    return samples;
}
```

`viewport` and `hwheel` are single `runFrames` loops, like the QA app plan's `wheel`. `pan` reuses the first panels plan's `SETTLE_FRAMES`, and `hwheel` the QA app plan's `WHEEL_DELTA_PX`. No new constant is needed.

### Page: `src/mount.ts`

`mountPanel`'s step 5 becomes:

```ts
const mounted = await (build.afterMount?.(tools) ?? {});
```

Everything else is unchanged: `await waits.settled()` still follows whenever `afterMount` exists, and the default and stand-in `waits` both work with it.

### Builder additions

`src/builders/data.ts` gains three pure generators. Each numeric literal becomes a named constant with its reason.

| Generator | Output |
|---|---|
| `diagramTree(n)` | nodes `n0`…`n<n−1>`, labelled `Node <i>`; edges `e<i>` from `n⌊(i − 1) / 3⌋` to `n<i>` for `1 ≤ i < n` (a three-way tree with `n − 1` edges) |
| `editorDocument(sections)` | `# Editor document`, then per section `i`: `## Part <i+1>` and one 120-character paragraph beginning `Part <i+1>`; then a pipe table with header `\| Name \| Owner \| State \| Size \|`, a separator row, and `sections` rows |
| `wideRows(n, columns)` | row `i`: `id` i+1, and `c1`…`c<columns>` with `c<k> = (i × 7 + k × 13) mod 1000` |

`code-document` uses the first panels plan's `codeDocument(lines)`.

`src/builders/dom.ts` gains two helpers:

- `lateId(): { target: { getId(): string }; set(id: string): void }`. `getId()` returns `''` until `set` is called; the probe then finds no element and records `null`.
- `pickStrip(rects, side)`. It is pure. Its input is the rectangles of the `.WindowBorder` elements inside one window, and it returns an index.

| `side` | Rule | Example (rects as left, top, width, height) | Result |
|---|---|---|---|
| `east` | greatest `left`; ties go to the greatest `height` | NE `396,0,4,4`, E `396,4,4,292`, SE `396,296,4,4` | E |
| `south` | greatest `top`; ties go to the greatest `width` | SW `0,288,4,12`, S `4,288,392,12`, SE `396,288,12,12` | S |

`src/builders/form.ts` is new. It holds three functions:

- `buildForm(n, depth, params, panel)` builds both form panels;
- `formField(kind, index, store)` makes one field;
- `inspectorTable()` builds the `form-nested` inspector.

### Panels

Every panel builds at any `n ≥ 1`, and an index taken from `n` is clamped. Element lookups go through the first panels plan's `requireElement`, `childGutter` and `firstPainted`. Each `description` names what the panel builds, and for a reproduced figure its source and symptom.

**`diagram-graph`**: n = nodes, default 400. `defaultDrive: 'click'`.

- **Components.** The root is `Panel(Border)`:
  - NORTH: a `ToolBar` of four `Button`s (Zoom In, Zoom Out, Fit, Reset). Each has a named handler that calls the view's `zoomIn`, `zoomOut`, `zoomToFit` or `resetView`.
  - CENTER: `DiagramView({ data: diagramTree(n), fitOnLoad: false, zoom: 1, layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' } })`.
- **Build targets.** `resize`: root. `passes`: the view.
- **afterMount (async).** First `await view.whenLaidOut()`. Then let `layer` be the `.DiagramNodeLayer` element inside the view: the empty canvas behind the nodes. Targets:
  - `click`: `{ elements: [layer] }`;
  - `pan`: `{ element: layer, axis: 'x' }`;
  - `wheel`: `layer`;
  - `hover`: `{ element: the view's element, axis: 'x' }`.
- **Geometry, describe, installWork.** Geometry: `view`. `describe()`: `{ nodes: n, nodeElements: <.DiagramNode elements under the view> }`. `installWork`: `tools.countMethod(tools.findComponent('DiagramEdgeLayer'), 'setResidency')`.

**`code-document`**: n = lines, default 2,000. `defaultDrive: 'wheel'`.

- **Components.** The root is `Panel(Split horizontal)`:
  - left (`weight: 0`): `Header('Outline', { preferredSize: { width: SIDE_WIDTH_PX, height: 40 } })`;
  - right (`weight: 1`): `Panel(Border)`.
    - NORTH: a `ToolBar` of ten text `Button`s (Format, Read-only, Wrap, Lint, Tab size, Line numbers, Spellcheck, Save, Reveal, Preview), each wired to the named no-op `noCommand`, as `CodeEditorPanel`'s upper toolbar is laid out.
    - CENTER: `CodeEditor(codeDocument(n), { language: 'javascript' })`.
    - SOUTH: a status `Text`, which a named handler updates from the editor's `cursorchange`, as `CodeEditorPanel` does.
- **Build targets.** `passes`: the editor. `resize`: root.
- **afterMount.** Targets:
  - `drag`: `{ childGutter(root), 'x' }`;
  - `wheel`: the `.cm-scroller`;
  - `type`: `{ .cm-content, TYPE_TEXT }`;
  - `key`: `{ .cm-content, ['ArrowDown', 'ArrowUp'] }`.
- **Geometry, describe.** Geometry: `editor`, `status`. `describe()`: `{ lines: n }`.

**`markdown-editor`**: n = sections, default 60. That is about 9 KB, the size of F24.1's largest document. `defaultDrive: 'call'`.

- **Components.** The root is `Panel(Split horizontal)`, arranged as `MarkdownEditorPanel` is:
  - left: `Panel(Border)`. CENTER is `MarkdownDocumentPanel({ value: docA })`; SOUTH is a status `Text`.
  - right: `Panel(Fit, autoScroll: 'y')`, holding `Markdown(docA)`.

  `panel.on('change', syncViewer)`, where `syncViewer` calls `viewer.setMarkdown(panel.getValue())`. `docA` is `editorDocument(n)`. `docB` is the same document with ` (revised)` appended to its first heading. Both strings are built once.
- **Build targets.** `resize`, `passes`: root. `update`: `panel.setValue(index even ? docB : docA)`.
- **afterMount.** Let `editable` be the `[contenteditable="true"]` element inside the panel. Targets:
  - `type`: `{ editable, TYPE_TEXT }`;
  - `call`: the named function `moveCaret(index)`. It collapses the document selection inside the first text node of the first `p` in `editable`, at offset `CARET_START + parkOffset(index mod CARET_SPAN, CARET_SPAN, 1, 0)`, clamped to the node's length (`CARET_START = 5`, `CARET_SPAN = 40`). This produces a commit that changes only the selection;
  - `drag`: `{ childGutter(root), 'x' }`;
  - `wheel`: `editable`.
- **Geometry, describe, installWork.** Geometry: `editor`, `viewer`. `describe()`: `{ sections: n, chars: docA.length }`. `installWork`: `tools.countMethod(panel.getEditor(), 'handleChange')`.

**`windows`**: n = windows, default 8. `defaultDrive: 'viewport'`.

- **Components.** The root is `Panel(Border)`: NORTH is `appToolBar()`; CENTER is a `Header('Desktop')`. These are built but not shown yet:
  - `n` windows, each `Window('Window <i+1>', { x: 40 + 32i, y: 60 + 24i, width: 420, height: 300, contentFactory: fourFieldForm })`. `fourFieldForm` is a named factory returning a `LabeledGrid({ columns: 1 })` of four `TextField`s;
  - `bare`: `Window('Bare')`, with no content;
  - `c25`: `Window('Insets', { insets: new Insets(4, 12, 4, 4) })`.
- **Build targets.** `toggle` acts when `index mod DIALOG_PERIOD_UNITS = 0`, with `DIALOG_PERIOD_UNITS = 30`:
  - with no dialog open, it builds `Dialog({ title: 'Edit', contentComponent: sixFieldForm(), buttons: [{ text: 'Cancel', result: 'cancel' }, { text: 'OK', result: 'confirm', primary: true }] })` and calls `void dialog.show()`. `sixFieldForm` is a named factory like `fourFieldForm`, with six `TextField`s;
  - otherwise it calls `dialog.hide('close')`.
- **afterMount.** Call `show()` on the `n` windows, `bare` and `c25`. Then call `minimize()` on the last `⌊n / 2⌋` of the `n` windows. Pass the rectangles of the `.WindowBorder` elements inside `c25`'s element to `pickStrip(…, 'south')`, and set `southStrip`'s late id to the picked element's id. Targets:
  - `drag`: with `grip=header`, `{ element: window 0's header element (getHeader()), axis: 'x' }`; with `edge`, `{ element: window 0's .WindowBorder picked by pickStrip(…, 'east'), axis: 'x' }`;
  - `click`: `{ elements: the header elements of the n − ⌊n/2⌋ normal windows }`, each click raising a window;
  - `passes`: `bare`;
  - `hover`: `{ window 0's element, 'x' }`.
- **Geometry, describe.** Geometry: `win0` (window 0), `bare` and `southStrip` (the late id). `describe()`: `{ windows: n, minimized: ⌊n / 2⌋ }`.

**`form-flat` and `form-nested`**: n = fields, default 64. `defaultDrive: 'passes'`.

- **Fields.** `formField(kind, i, store)` cycles eight kinds:
  1. `TextField`, wrapped in a `FieldDecorator`. A named `change` handler calls `showError('Required, 20 characters at most')` when the value is empty or longer than 20 characters, and `clearError()` otherwise.
  2. `ComboBox({ store, displayField: 'name', valueField: 'id' })`, over one shared store of 20 options.
  3. `DateField()`.
  4. `TimeField()`.
  5. `NumberSpinner()`.
  6. `Checkbox()`.
  7. `Toggle()`.
  8. `Slider({ min: 0, max: 100, value: 50 })`.
- **Header grid.** Both panels start with `header`: a `LabeledGrid({ columns: 1 })` of eight plain `TextField`s, which is F28.10's fixture.
- **`form-flat` components.** `Panel({ autoScroll: 'y', layoutManager: VBox({ stretching: true }) })`, holding `header`, then one `LabeledGrid({ columns: 2 })` of the `n` fields, titled `Field <i+1>`.
- **`form-nested` components.** `Panel(Split horizontal)`:
  - left (`weight: 1`): the same scrolling `VBox`, holding `header`, then `⌈n / 8⌉` `LabeledFieldSet('Group <g+1>', { columns: 2 })` of eight fields each;
  - right (`weight: 0`, preferred width `INSPECTOR_WIDTH_PX = 320`): `inspectorTable()`.

  `inspectorTable()` is a `Table` over a `Model` of `property` (string), `value` (`auto`) and `kind` (string). Its `INSPECTOR_ROWS = 12` rows cycle the kinds `boolean`, `combo`, `number` and `string`. The `value` column has `cellType: (r) => r.get('kind')` and `cellValues` from two fixed option lists, as `PropertyGridPanel` does; `kind` is hidden.
- **Build targets.** `passes`: `form` → root; `header` → the header grid; `date` → the first `DateField`; `combo` → the first `ComboBox`. `resize`: root.
- **afterMount.** Targets:
  - `type`: with `type=text`, `{ the first decorated TextField's <input>, TYPE_TEXT }`; with `date`, `{ the first DateField's <input>, '2026-09-19' }`;
  - `click`: with `click=toggle`, `{ elements: [first Toggle, first Checkbox] }`; with `combo`, `{ elements: [first ComboBox] }`, which opens and closes its dropdown on alternate units;
  - `pan`: `{ the first Slider's element, 'x' }`;
  - `hover`: `{ header's element, 'y' }`;
  - `wheel`: the scrolling panel's element.
- **Geometry, describe.** Geometry: `header` and `form`, plus `inspector` in `form-nested`. `describe()`: `{ fields: n }`.

**`menus`**: n = rows in the context menu, default 12. `defaultDrive: 'toggle'`.

- **Components.** The root is `Panel(Border)`. NORTH is `appMenuBar()`, SOUTH is `appToolBar()`, and CENTER is a `Header('Canvas')`. `menu` is `new Menu()` (rebuild mode). `rows` is `n` configs `{ text: 'Command <i+1>', action: noCommand }`.
- **Build targets.** `toggle`: on an even unit, `menu.show(CONTEXT_X, CONTEXT_Y, rows)`; on an odd unit, `menu.hide()`. `CONTEXT_X = 240` and `CONTEXT_Y = 160` place the menu clear of the bars.
- **afterMount.** One `show` and then one `hide`, so that every measured open is a re-open. Targets:
  - `hover`: `{ the .MenuBar element, 'x' }`;
  - `click`: `{ elements: [the first .MenuBarButton] }`, which opens and closes that menu on alternate units.
- **Geometry, describe.** Geometry: `menubar` → `.MenuBar`, `menubarButton` → `.MenuBarButton`. Both are selectors, and the probe takes the first match. `describe()`: `{ rows: n }`.

**`table-wide`**: n = rows, default 2,000, with 40 value columns. `defaultDrive: 'hwheel'`.

- **Components.** A `MemoryStore` over `id` plus `c1`…`c40` (numbers), loaded with `wideRows(n, WIDE_COLUMNS = 40)`. The root is `Table(store, { columns })`, with every `c<k>` at `minWidth: WIDE_MIN_WIDTH_PX = 120`, so that the columns overflow any screen.
- **Build targets.** `passes`, `resize`: the table.
- **afterMount.** `selectRecord(row min(3, n − 1))`. Targets:
  - `hwheel`: the body's element;
  - `wheel`: the body's element;
  - `key`: `{ the body's element, ['ArrowRight', 'ArrowLeft'] }`.
- **Geometry, describe.** Geometry: `header`, `body`. `describe()`: `{ rows: n, columns: 41 }`.

`TYPE_TEXT` and `SIDE_WIDTH_PX` come from the first panels plan's `src/builders/shared.ts`, and `noCommand` from its `chrome.ts`.

---

## Ordered Implementation Steps

Where a step names tests, write them first (they fail), then the code.

1. **Check the prerequisites.** `plans/implemented/qa-app.md` and `plans/implemented/qa-app-panels.md` exist, and so does `packages/qa/src/builders/chrome.ts`. Prepare the worktree as the QA app plan's step 1 does.
2. **`src/harness/types.ts`** — add `PanTarget`.
3. **Tests E22–E25, then `src/harness/drivers.ts`** — add `pan`, `viewport` and `hwheel` to `DRIVERS`, with a private `requirePanTarget`. E22, E24 and E25 go in `tests/drivers.dom.test.ts`, and E23 in `tests/drivers.test.ts`.
4. **Checkpoint.** `grep -rn "@jimka/typescript-ui" packages/qa/src/harness` finds nothing. `npm -w packages/qa run typecheck` and `npm -w packages/qa run test` pass.
5. **`src/panels.ts`** — widen `afterMount`'s return type.
6. **`src/mount.ts`** — await `afterMount` in step 5 of `mountPanel`.
7. **`tests/mount.test.ts`** — no change for P7: it calls `mountPanel`, which now awaits `afterMount` itself.
8. **`src/pageTargets.ts`** — add `viewport: root`. In `tests/pageTargets.test.ts`, P11's keys assertion becomes `['idle', 'theme', 'viewport']`.
9. **Tests P12 and P13, then `src/builders/data.ts` and `src/builders/dom.ts`** — the three generators, `lateId` and `pickStrip`. Test file: `tests/builders.test.ts`.
10. **`src/builders/form.ts`.**
11. **The eight panel files** in `src/panels/`.
12. **Test P14**, in `tests/mount.test.ts`.
13. **`packages/qa/README.md`**:
    - add the three drivers to the drivers table;
    - add the eight panels to the panel table, with their validation figures (M16–M26) and a `Validated:` entry each;
    - add the `afterMount` promise rule.
14. **Checkpoint.** Run everything under *Verification → Automated*, then the dev-server smoke.
15. **Stop.** Do not run `runqa.sh` with a real host. Report that the validation sweep and the shakedown need the user's go-ahead.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/qa/src/harness/types.ts` |
| Modify | `packages/qa/src/harness/drivers.ts` |
| Modify | `packages/qa/src/panels.ts` |
| Modify | `packages/qa/src/mount.ts` |
| Modify | `packages/qa/src/pageTargets.ts` |
| Modify | `packages/qa/src/builders/data.ts` |
| Modify | `packages/qa/src/builders/dom.ts` |
| Create | `packages/qa/src/builders/form.ts` |
| Create | `packages/qa/src/panels/diagram-graph.ts` |
| Create | `packages/qa/src/panels/code-document.ts` |
| Create | `packages/qa/src/panels/markdown-editor.ts` |
| Create | `packages/qa/src/panels/windows.ts` |
| Create | `packages/qa/src/panels/form-flat.ts` |
| Create | `packages/qa/src/panels/form-nested.ts` |
| Create | `packages/qa/src/panels/menus.ts` |
| Create | `packages/qa/src/panels/table-wide.ts` |
| Modify | `packages/qa/tests/drivers.test.ts` |
| Modify | `packages/qa/tests/drivers.dom.test.ts` |
| Modify | `packages/qa/tests/builders.test.ts` |
| Modify | `packages/qa/tests/pageTargets.test.ts` |
| Modify | `packages/qa/tests/mount.test.ts` |
| Modify | `packages/qa/README.md` |

---

## Expected Behaviour

### Harness, unit-testable (`packages/qa/tests`)

Numbering continues after the first panels plan's E21. The jsdom tests reuse that plan's E19 setup: a parent `P`, appended to `document.body`, with its rectangle stubbed to `{0,0,100,20}` and a recording listener on it. The fake `tools` there has a synchronous `runFrames`, a `suspendCounting` that runs its work, a `waitFrames` that resolves, and the real `fireMouse`.

- **E22 `pan` sequence** (jsdom). `{ element: P, axis: 'x' }`, 4 units, step 10:

  | Stage | Events on `P` | `clientX` | `buttons` |
  |---|---|---|---|
  | setup | `pointerdown`, `mousedown` | 50 | 1 |
  | units 0–3 | `pointermove`, `mousemove` | 60, 70, 60, 50 | 1 |
  | after | `pointerup`, `mouseup` | 50 | 0 |

  Every event has `clientY` 10.
- **E23 target validation** (node). `pan` with `axis: 'z'` rejects with the `pan` message, and `hwheel` with target `{}` rejects with the `hwheel` message.
- **E24 `hwheel`** (jsdom). Target `P`, 4 units: four `wheel` events on `P` at (50, 10), with `deltaX` 40, 40, −40, −40 and `deltaY` 0.
- **E25 `viewport`** (jsdom). With a `resize` listener on `window`, 3 units give 3 calls.

### Panels, unit-testable (`packages/qa/tests`)

- **P7 (the first panels plan's mount smoke).** It needs no change: it goes through `mountPanel`, which now awaits `afterMount`, and it covers the eight panels here because it walks `getPanelIds()`. A panel may be left out only under the first panels plan's rule: a comment that quotes the thrown error and names the jsdom gap. The likeliest to need it is `code-document`, if CodeMirror's measuring hits jsdom's missing layout.
- **P12 data** (node).
  - `diagramTree(5)` has nodes `n0`–`n4`, and edges `e1: n0→n1`, `e2: n0→n2`, `e3: n0→n3` and `e4: n1→n4`.
  - `editorDocument(3)` has 3 lines starting `## `, and a table of 3 body rows after its header and separator.
  - `wideRows(2, 40)[1]` has `id` 2 and `c40` = (7 + 520) mod 1000 = 527.
  - Two calls to each generator give deep-equal output.
- **P13 `pickStrip` and `lateId`** (node). Both example rows of the `pickStrip` table. A `lateId()` target returns `''` before `set('w7')`, and `'w7'` after.
- **P14 panel parameters** (jsdom, in `tests/mount.test.ts`, with that file's `tools` and `SMOKE_WAITS` from the first panels plan's P7).
  - `mountPanel('form-flat', new URLSearchParams('n=3&passes=nope'), tools, SMOKE_WAITS)` rejects with `form-flat: unknown passes "nope" (expected form, header, date, combo)`, thrown in `build` before any wait.
  - `mountPanel('windows', new URLSearchParams('n=3&grip=nope'), tools, SMOKE_WAITS)` rejects with `windows: unknown grip "nope" (expected header, edge)`, thrown in `afterMount`.
  - `mountPanel('diagram-graph', new URLSearchParams('n=3'), tools, SMOKE_WAITS)` resolves (after `whenLaidOut`) with `targets.click.elements[0]` carrying the class `DiagramNodeLayer`.

### Manual only (a real host; needs the user's go-ahead)

Figures are per unit, from one run of each panel at its default `n` unless stated.

- **M16 `diagram-graph` click (F27.2).** `click` with `seam=1`: `seam.source.getElementById + seam.source.contains` = 802 (2n + 2). The split follows the nodes whose element has ever been rendered, not the nodes mounted now: `contains` = 2 × that count + 2, and `getElementById` = 2 × the rest, the nodes that have never rendered one. `before.host.nodeElements` counts the nodes attached at census time, which is a lower bound on the first and predicts neither exactly.[^census]
- **M17 `diagram-graph` pan (F27.1).** `pan` with `seam=1`: `seam.sink.setRuleStyles` = 1.00.
- **M18 `diagram-graph` zoom (F27.3).** `wheel:10` with `work=1`: `setResidency@DiagramEdgeLayer` = 1.00. From the report; not re-measured.
- **M19 `markdown-editor` (F24.1).** `call` and `type`, each with `work=1`: `handleChange@MarkdownEditor` = 1.00. From the report.
- **M20 `windows` header move (F09.11).** The `drag` driver counts its own press and release inside the phase. The per-move cost is therefore a difference between two phases of one run, `drive=drag:40,drag:80&grip=header&seam=1`. For `seam.sink.apply` and for `seam.source.getViewportSize`, (80 × the second phase's value − 40 × the first's) / 40 = 1.00.
- **M21 `windows` settled pass (F09.4).** `passes` with `seam=1`: `seam.sink.apply` = 38.00, and no `setRuleStyles`.
- **M22 `windows` resize event (F09.6).** `viewport` with `seam=1`: `seam.source.getViewportSize` is at least 16, which is `minimized`². The remainder comes from the page's other viewport listeners; the first validated run records it.
- **M23 labelled grid (F28.10), both form panels.** `passes` with `passes=header&work=1`: the `getPreferredSize@…`, `getMinSize@…` and `getMaxSize@…` values sum to 160.
- **M24 `DateField` pass (F17.1).** `passes` with `passes=date&work=1&seam=1`:
  - `seam.sink.apply` = **12**, measured 2026-09-20 in MiniBrowser (`val-form-date`). This supersedes the 8 of the offline census below. Slice 17 recorded 11, so the engine sits nearer the slice's own figure than the modelled DOM does; the two other figures of the same pass are exact, so what did not transfer is the offline re-measure of `apply`, not the panel;
  - the `doLayout@…` values sum to 10;
  - the three size-hint families sum to 125.
- **M25 `ComboBox` pass (F16.3).** `passes` with `passes=combo&seam=1`: `seam.sink.apply` = 7.
- **M26 `menus` (F12.3).** `toggle` with `seam=1`, per unit:
  - sink total (`sink/u`) **456.68**, measured 2026-09-20 in MiniBrowser (`val-menus`). This supersedes the 412 derived from the offline census below (half of a re-open's 812 plus a hide's 12): every other counter in the phase lands where the census put it, so the whole 44.68 is in `apply`, measured 338.2 — writes the modelled DOM does not make;
  - `ensureStyleRule` 6, `setRuleStyles` 7.03, `deleteStyleRule` 6 — the census's rule figures, exactly;
  - `measureTexts` 0.5, and no `measureText` — the batched measure, exactly.
- **C25.** Any `windows` run with `geom=1`: every `geometry.southStrip` sample has height 12.
- **M27 shakedown.** Every panel runs once with every driver it declares (the runs are under *Verification*):
  - no report carries `error`;
  - every `type` note is present;
  - every phase with `geom=1` has non-null geometry for every label.

If a figure differs, compare it with the offline census in [^offline] before concluding anything.

---

## Verification

### Automated (the implementer runs these; none opens a window)

1. `npm -w packages/qa run typecheck` and `npm -w packages/qa run test` — E1–E25 and P1–P14, with the lib built.
2. `grep -rn "@jimka/typescript-ui" packages/qa/src/harness` — no matches.
3. `grep -rn "Math.random\|Date.now()" packages/qa/src/builders packages/qa/src/panels` — no matches.
4. `git diff --stat master -- packages/lib packages/docs` — empty.

### Dev-server smoke (no window, no browser)

The first panels plan's loop fetches every file under `src/panels/` and `src/builders/`, so it covers this plan's files unchanged.

### Manual sweeps (only with the user's go-ahead)

**Every command below opens a full-screen window on the user's desktop for about a minute. An implementer or agent must not run it.** The default host is MiniBrowser. Once `qa-app-tauri` lands, the same lines run with `--host tauri`.

```sh
Q=packages/qa/runqa.sh
$Q val-diagram    main 'panel=diagram-graph&drive=click:20,pan:40,wheel:10&seam=1&work=1'           || exit 1
$Q val-mdedit     main 'panel=markdown-editor&drive=call:40,type:16&work=1'                          || exit 1
$Q val-win        main 'panel=windows&drive=drag:40,drag:80,passes:10,viewport:20&grip=header&seam=1&geom=1' || exit 1
$Q val-form-flat  main 'panel=form-flat&drive=passes:10&passes=header&work=1'                         || exit 1
$Q val-form-nest  main 'panel=form-nested&drive=passes:10&passes=header&work=1'                       || exit 1
$Q val-form-date  main 'panel=form-flat&drive=passes:10&passes=date&work=1&seam=1'                    || exit 1
$Q val-form-combo main 'panel=form-flat&drive=passes:10&passes=combo&seam=1'                          || exit 1
$Q val-menus      main 'panel=menus&drive=toggle:40&seam=1&geom=1'                                    || exit 1
python3 packages/qa/bin/qa-table.py packages/qa/results val- --seam --before host.nodeElements,host.minimized
```

Shakedown (M27): one run per panel with every driver it declares, then each non-default parameter:

```sh
$Q shk-diagram    main 'panel=diagram-graph&drive=resize:30,passes:10,hover:60,wheel:10,pan:30,click:10&geom=1'          || exit 1
$Q shk-codedoc    main 'panel=code-document&drive=resize:30,passes:10,wheel:30,key:20,drag:30,type:16&geom=1'             || exit 1
$Q shk-mdedit     main 'panel=markdown-editor&drive=resize:30,passes:10,wheel:30,drag:30,call:30,type:16,update:4&geom=1' || exit 1
$Q shk-windows    main 'panel=windows&drive=passes:10,hover:60,viewport:20,drag:30,click:10,toggle:60&geom=1'             || exit 1
$Q shk-formflat   main 'panel=form-flat&drive=resize:30,passes:10,hover:60,wheel:30,pan:30,click:10,type:16&geom=1'      || exit 1
$Q shk-formnest   main 'panel=form-nested&drive=resize:30,passes:10,hover:60,wheel:30,pan:30,click:10,type:16&geom=1'    || exit 1
$Q shk-menus      main 'panel=menus&drive=hover:60,click:10,toggle:20,viewport:20&geom=1'                                || exit 1
$Q shk-wide       main 'panel=table-wide&drive=hwheel:30,wheel:30,key:20,passes:10,resize:30&geom=1'                     || exit 1
$Q shk-win-edge   main 'panel=windows&drive=drag:30&grip=edge&geom=1'                                                    || exit 1
$Q shk-form-date  main 'panel=form-flat&drive=type:10&type=date&seam=1'                                                  || exit 1
$Q shk-form-combo main 'panel=form-nested&drive=click:10&click=combo&seam=1'                                             || exit 1
python3 packages/qa/bin/qa-table.py packages/qa/results shk- --seam
```

Accept when M16–M27 and C25 hold. Then fill in each panel's `Validated:` entry in the README's panel table.

---

## Documentation Impact

- **No public API change.** Nothing is exported from `@jimka/typescript-ui`.
- **`packages/qa/README.md`**:
  - add the three drivers to the drivers table;
  - add the eight panels to the panel table;
  - add the `afterMount` promise rule;
  - add a measurement rule: a frame driver's timing is the gap between animation frames, so a cost well under one frame, such as a 1–3 ms commit, shows up in the counts and not in `avg`.

---

## Potential Challenges

- **ELK lays out 400 nodes on the main thread.** That can take seconds in software-rendered WebKitGTK. `afterMount` awaits it, and the runner's `QA_TIMEOUT` still bounds a run that never finishes laying out.
- **A caret move commits on `selectionchange`, a task after the unit.** Per-unit averages over a phase still hold. A single unit's counts may land in the next unit.
- **`type` changes the document it types into.** It deletes what it typed afterwards, but the undo history grows, so put `type` after count-sensitive phases in a `drive=` list.
- **`click=combo` leaves the dropdown open after an odd unit count.** Use an even count.
- **A synthetic `resize` does not change the viewport.** The `viewport` counts are those of an event at an unchanged size (F09.7's repeat case), not those of a real drag of the window frame.
- **`Slider` calls `setPointerCapture` on `pointerdown`.** WebKit keeps the mouse pointer (id 1) registered at all times, so the call returns without capturing and without throwing. `pan` must keep `POINTER_ID = 1`.

---

## Critical Files

- [`plans/qa-app.md`](plans/qa-app.md) and [`plans/qa-app-panels.md`](plans/qa-app-panels.md) — read both whole. This plan extends their contract, drivers and builders.
- [`packages/lib/src/typescript/DiagramPanel.ts`](packages/lib/src/typescript/DiagramPanel.ts#L75), [`CodeEditorPanel.ts`](packages/lib/src/typescript/CodeEditorPanel.ts#L100), [`MarkdownEditorPanel.ts`](packages/lib/src/typescript/MarkdownEditorPanel.ts#L60), [`PropertyGridPanel.ts`](packages/lib/src/typescript/PropertyGridPanel.ts#L19) — the arrangements the panels mirror; read them, never import them.
- [`packages/lib/src/typescript/lib/component/diagram/DiagramView.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1805) — the subtree listeners; `whenLaidOut` :827; `_handleClick` :1834; `_handlePointerMove` :2172.
- [`packages/lib/src/typescript/lib/component/input/Slider.ts`](packages/lib/src/typescript/lib/component/input/Slider.ts#L531) — the pointer handlers and capture.
- [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L812) — `show`; the south strip's height :2466 (C25).
- [`packages/lib/src/typescript/lib/overlay/Menu.ts`](packages/lib/src/typescript/lib/overlay/Menu.ts#L297) — `show` in rebuild mode; `hide` :496.
- [`packages/lib/src/typescript/lib/validation/FieldDecorator.ts`](packages/lib/src/typescript/lib/validation/FieldDecorator.ts#L69) — `showError` and `clearError`.
- [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2889) — `handleChange`, registered per commit at :2294.
- Slice reports 09, 12, 15, 16, 17, 24, 27 and 28 in `plans/research/render-review-2026-09-15/`.

---

## Non-Goals

- **Ablations for these candidates.** They belong to the W3.0 bounding sweep, as the first panels plan's do.
- **A per-method timer.** It is what reproducing F24.1's time share (68–86 % of a commit, measured in Node) would need.
- **Rail and Drawer panels.** F10.11 is a compositing cost with no count to validate, and nothing else in wave 3 runs through them.
- **Importing docs demos or demo-app panels.**
- **Starting a real host from any automated check.**

---

## Notes

[^driver-rules]: The rules are restated here so this plan reads on its own. Their reasons are in the first panels plan's footnotes `driver-home`, `suspend` and `pointer-events`. The QA app plan's `fireMouse` table fixes the `buttons` defaults both plans rely on.

[^pan]: The `drag` driver sends `mousemove` to `document`, because `SplitGutter` and `WindowBorder` listen on the viewport once pressed. `DiagramView` registers subtree `pointerdown`, `pointermove` and `pointerup`, and `Slider` registers exact-target pointer listeners and captures the pointer; an event sent to `document` reaches neither. The press is kept outside the counts so that `pan` measures the moves only. `DiagramView`'s press alone does the 400-node lookups that `click` measures, and counting it would mix two findings in one phase. Reusing `parkOffset` with a zero lead keeps one out-and-back walk in the harness, not two.

[^viewport]: `window.resizeTo` works only on windows a script opened. Neither MiniBrowser's full-screen window nor a Tauri app window is one, and a Tauri API that could resize it is off limits to the page. The unchanged-size case is still the one the synthesis measures, for two findings:
    - F09.7: "the same on a repeat with an unchanged viewport";
    - F03.2: the read cost is forced whether or not the size changed.

[^async-mount]: The QA app plan made `afterMount` synchronous and left promise support to the plan that needs it; this is that plan. Two alternatives were rejected:
    - A separate `ready()` hook would split waiting and target resolution into two members for no benefit, because the targets are valid only once the wait is over.
    - Polling inside a synchronous `afterMount` is impossible, because `waitFor` returns a promise.

    `await` on a plain object returns it unchanged, so every existing `afterMount` works as before. `mountPanel` is the only caller; the page, `previewPanel` and the first panels plan's P7 all go through it, so none of them changes.

[^mirror]: The QA app plan's import rule keeps a baseline from moving when a demo is edited. The four demo-app panels were still the best evidence of how an application arranges these components, so their layouts are copied:
    - `DiagramPanel`: a `Border` with a zoom toolbar above the view.
    - `CodeEditorPanel`: a toolbar, the editor, and a status line that calls `setText` on every cursor change.
    - `MarkdownEditorPanel`: an editor whose `change` handler feeds a live `Markdown` preview.
    - `PropertyGridPanel`: a `Table` whose `value` column takes a cell type per row.

    The data is generated at scale, which none of the demos offers: `DiagramPanel` builds a six-node graph from a module constant, and the editor demos load fixed samples.

[^variants]: Depth decides cost for the size-report groups (G05, G11), and the form pair covers them. For a single large editor, the first panels plan's shells already provide the deep case (up to sixteen editors in a `Dock`) against `code-document`'s one. The remaining costs grow with `n`, not with nesting: a diagram click scans every node, a menu open is linear in its rows, and a window resize event is quadratic in minimized windows. For those, the `n=` sweep described in the first panels plan's README is the matching check.

[^offline]: Re-measured on 2026-09-19 at `master` `72916718` under `installTestDOM` (1280 × 800 modelled viewport), with a throwaway probe that was not committed:
    - **Bare `Window` settled pass:** `apply` 38, no `setRuleStyles`. Slice 09 recorded 43 and 1. The clip-path rule write is gone since G07's `setClipPath` guard.
    - **Window header move:** `apply` 1 and `getViewportSize` 1 per `mousemove`, as recorded (F09.11).
    - **One resize event with 4 minimized windows and 1 normal one:** `getViewportSize` 17. That is 4² plus the normal window's own read, which matches slice 09's 16 for the minimized stack.
    - **12-row context menu:**
      - first open: 727 sink ops, with `ensureStyleRule` 25, `setRuleStyles` 28 and `measureTexts` 1;
      - re-open: 812 sink ops, with `ensureStyleRule` 12, `setRuleStyles` 14, `deleteStyleRule` 12 and `measureTexts` 1;
      - hide: 12 sink ops.

      Slice 12 recorded 827–873 writes and 18 one-at-a-time `measureText` calls; the menu now measures its rows in one batch.
    - **`DateField` settled pass:** `apply` 8, `doLayout` 10, size hints 125. Slice 17 recorded 11, 10 and 161. The engine then measured `apply` 12, with `doLayout` and the size hints exactly as here; M24 records 12.
    - **`ComboBox` settled pass:** `apply` 7. Slice 16 recorded 8.
    - **`LabeledGrid` of 8 `TextField`s, one pass:** 48 + 64 + 48 = 160 size queries, exactly slice 28's figure.
    - **400-node `diagramTree`, zoom 1, one `pointerdown` + `pointerup` + `click` on the node layer:** `getElementById` 616 + `contains` 186 = 802, with 92 node elements. Slice 27 recorded 380 + 422 = 802 at 210 resident nodes. The total is 2n + 2 whatever the viewport. Both censuses were taken where the resident set had only ever grown, so the mounted count and the ever-rendered count were the same number and the split looked like a function of `nodeElements`; see [^census] for what the engine showed.

    Not re-measured:
    - F24.1 needs a live Lexical view, which the modelled DOM does not mount.
    - F27.3's residency count needs zoom notches driven through the real wheel handler.

    The size-hint figures come from counters on `Component.prototype`, the same prototype the harness's work counters wrap (`rootOwnerProto`), so the engine run counts the same calls.

[^census]: What the engine showed, and why `nodeElements` is not the number `contains` follows. `val-diagram`'s `click` phase counts `contains` 478 and `getElementById` 324 per unit — whole numbers over 20 units, so the set they scan did not move while the phase ran. They resolve to 238 and 162 nodes, which is exactly the 400 of `diagramTree(400)`. The census recorded 135, and the same snapshot's `scan.allClassCounts.DiagramNode` recorded 135 too, so the census counts what it names; it is also taken after `mountPanel`'s second 1-second settle, so it is not an early reading.

    [`nodeIdAt`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1897) walks every entry of `_nodeComponents` and calls `component.getElement()`: a node that has an element costs a `contains`, a node that has none costs the failed `getElementById` inside [`getElement`](packages/lib/src/typescript/lib/core/Component.ts#L1412). That call caches the handle on `_element` at its first hit and never clears it, and [`unmountNode`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1122) is detach-only — so a node that leaves the residency rect keeps its cached element and keeps costing a `contains`, while `querySelectorAll('.DiagramNode')` stops seeing it. The 103 nodes between 238 and 135 are ones the mount mounted and residency then dropped: [`computeResidentIds`](packages/lib/src/typescript/lib/component/diagram/DiagramResidency.ts#L87) holds an id with no box resident, so every node is resident until ELK has placed it, and the set shrinks once the boxes land.

    So the census is right, the clause was wrong, and the invariant M16 can check is the total: one lookup per node per pass, 2n + 2 whatever the screen and whatever residency has done. A check on the split would need the count of ever-rendered nodes, which no panel can read — `_nodeComponents` is private, and nothing in the view's public surface reports it.

## Implementation Notes

Where the implementation departs from the plan, or fills a gap it left, and what verified it.

- **P7 excludes `form-flat` and `form-nested` for the jsdom gap `table-rows` has.** Both throw `Cannot set properties of null (setting 'font')` under jsdom: their labelled grids align title and field on a baseline, and `TextInput.getBaseline` measures it through a canvas 2D context (`ProductionDOMSource.measureFontMetrics`), which jsdom does not implement. They join `JSDOM_GAPS` with that error, so the existing "fails under jsdom only for the gap" case pins it. P14's `form-flat` case still runs, since `passes=nope` throws in `build`, before any layout.
- **`tests/mount.test.ts` disposes every open window after each test.** A `Window` mounts outside `Body`, so the `afterEach` that unmounts `Body`'s children never reached the `windows` panel's windows, and `show()` builds a window's content two animation frames later (`Animation.materialize`). Under jsdom that content, a `LabeledGrid` of text fields, then hit the same canvas gap in a frame that fired during a later test, as an uncaught error. The `afterEach` now disposes each window in `AbstractWindow.getOpenWindows()` before that frame, so P7 still mounts `windows` and checks its targets. In the engine the mount's 1-second settle covers the two frames.
- **A form target whose field kind is absent is left out.** The kinds cycle, so the first slider is field 8, the first toggle field 7, the first checkbox field 6, the first date field field 3 and the first combo box field 2. Below those scales the matching `pan`, `click`, `type`, or `passes=date`/`combo` target is omitted, and a phase that names it fails the run's target check with `panel "form-flat" gives no target for driver "pan"`; `click=toggle` with a checkbox but no toggle clicks the checkbox alone. P7's scale of 3 would otherwise have made every form panel throw. The README's panel table says so.
- **The form panels read `type=` and `click=` in `build`,** beside `passes=`, so any bad value fails before mounting, as P14 requires of `passes=`.
- **`formField(kind, store)` has no index parameter.** The plan's signature carries one, but no field needs it: the caller cycles the kinds and titles each field.
- **Where the listeners live.** The diagram toolbar's four handlers, `code-document`'s status handler and `markdown-editor`'s `syncViewer` are module-level named functions writing through module-level state set by `build`, the shells' `showCursor` precedent ("a page mounts one panel"). Each decorated text field needs its own decorator, so its `change` handler is the named function `checkShortText` returned per field by `requireShortText(decorator)`. The fields start empty, so typing runs `clearError` with no error showing, the case the synthesis records for Loom (one rule write per keystroke).
- **Unspecified details, filled in.** `editorDocument`'s paragraph is `Part <i>` and a filler cut to 119 characters plus a full stop, so it is exactly 120 characters and never ends in a space; its table rows are `| Part <r> | <department> | <state> | <file size> |`, reusing `DEPARTMENTS` and the file-size rule. `code-document`'s status reads `Ln <line>, Col <column>`, as the shells' does. `markdown-editor`'s status `Text` is a static `Ready`, since the plan gives it no handler. The inspector's combo rows are named `Owner <i>` or `Data type <i>` in turn and take `PropertyGridPanel`'s two option lists by that name. `DIALOG_PERIOD_UNITS = 30` is documented from `Dialog`'s 150 ms animations, about 9 frames. `pickStrip` returns −1 for no rectangles, and `windows` then throws naming the window.
- **Tests beyond the plan's list.** E22 has a second case pinning the order: the press before the frames, the release and a suspended `SETTLE_FRAMES` wait after them. E23 also rejects a `pan` target with no element, before dispatching anything. E24 also checks that each wheel event bubbles, is cancelable and is in pixels. P11 checks that `viewport` is the root. P12 checks each paragraph's length and `wideRows`' keys. P14's first two cases record the waits, so they show that `form-flat` fails before any wait and `windows` after `painted` and `settled`.
- **The README says a little more than step 13 lists:** the path table, the `step=` and panel-parameter rows of the URL parameters table, the page-wide targets paragraph, the tree rule's and the deep-and-shallow rule's form pair, and a pointer to this plan's *Coverage*.
- **`table-wide` read its store before its view existed.** Its `afterMount` called `store.getAt(3)!` and looked the body up straight away, and at its default scale of 2,000 rows `AbstractStore.applyView` builds the view on a worker, so right after the mount the record is `undefined` and the body has no rows. That is the root cause the first panels plan records under *A store-backed panel must wait for its view*, which the first authorised sweep in WebKitGTK found in the phase-3 panels — `table-rows` crashed there, and a run that "passed" measured a table of 252 elements with no body. `table-wide` is the one panel of this plan that carries the same defect: the fix that plan brought in was simply not applied to it. Its `afterMount` now awaits `awaitStoreView(tools, store, 'table-wide')` before it selects a record or looks an element up, exactly as `table-rows` does, and so returns a promise.
- **No other panel of this plan is affected.** `code-document`, `markdown-editor`, `menus`, `windows` and `diagram-graph` build no store at all, and `diagram-graph`'s wait is ELK's, not a store's. The form builder's two stores hold `COMBO_OPTIONS` = 20 and `INSPECTOR_ROWS` = 12 records, below `WORKER_THRESHOLD` = 1,000, and neither is read after the mount: `mountedTargets` names the components `build` made, never a row. P13 now pins both sides — `table-wide` joins the four panels that await the view, and a second case holds `form-flat` and `form-nested` to an `afterMount` that waits for nothing, so a store read added to either has to move it to the first list. jsdom still has no worker and so still cannot prove the worker path itself; the file's header says so. `npm -w packages/qa run typecheck` passes and `npm -w packages/qa run test` passes 243 tests in 12 files; the new `table-wide` case failed before the fix, `table-wide: no element matches` coming straight out of `afterMount` with no wait before it.

**Verification run.** `npm -w packages/qa run typecheck` passes, and `npm -w packages/qa run test` passes 232 tests in 11 files (E1–E25, P1–P14 and the cases above), three runs in a row with no unhandled error; each new test failed before its code existed. `grep -rn "@jimka/typescript-ui" packages/qa/src/harness` and `grep -rn "Math.random\|Date.now()" packages/qa/src/builders packages/qa/src/panels` find nothing, and `git diff --stat master -- packages/lib packages/docs` is empty. The dev-server smoke passed: with `QA_LIB` set to this checkout's `packages/lib`, Vite served every file under `src/panels/`, `src/builders/` and `src/harness/`, and `src/pageTargets.ts`, `src/mount.ts` and `src/panels.ts`, with no `FAIL` line, and port 5190 was free afterwards.

**`shk-wide` has to be re-run after the `table-wide` store-view fix.** Any run of `table-wide` made before it is void: one that errored measured nothing, and one that passed measured an empty body, so neither its figure nor its `geom` reference can be kept. The other panels' runs stand — none of them reads a store, and awaiting a non-promise `afterMount` costs one microtask.

**The first authorised sweep: what ran.** On 2026-09-20 the user ran this plan's whole validation block (M16–M26 and C25) and its whole shakedown (M27) in MiniBrowser, against a library build unchanged from `master` `608544c9` — the same build, and the same day, as the phase-3 sweep. It was the first run in the engine of the two form panels' mount, which P7 excludes, and of every new driver on a real page. `shk-wide` is the post-fix re-run the paragraph above asks for, made in the same block as the phase-3 panels' four. The reports are in `packages/qa/results/`; the newest file per run name is the valid one, and `bin/qa-table.py <dir> val- --seam --before …` is the reading of them this section quotes. No run opened from here: every figure below was read back from a report.

**What passed.** M17 (`setRuleStyles` 1.00 per `pan` unit) and M18 (`setResidency@DiagramEdgeLayer` 1.00 per `wheel` unit, which stood "from the report" until now); M19 (`handleChange@MarkdownEditor` 1.00 per `type` unit exactly, and 0.97 per `call` unit — the fortieth caret move's commit landing after the phase, which is the `selectionchange` lag *Potential Challenges* predicts); M20 (1.01 and 1.00 from the two-phase difference), M21 exactly (`apply` 38.00, no `setRuleStyles`) and M22 (`getViewportSize` 23, the 16 of `minimized`² plus 7 from the page's other viewport listeners); M23 exactly in both form panels (48 + 64 + 48 = 160); M25 exactly (`apply` 7); C25 in all 11 geometry phases of `val-win`, `shk-windows` and `shk-win-edge`, `southStrip` 12 px in every unit; and M27 across all 11 shakedown runs — no report carries `error`, every `geom=1` phase has a rectangle for every label in every unit, every `type` note is present, and every `hover` note gives at least one crossing. C23 and C24 show their symptoms too: 4 `setRuleStyles` over the ten characters of `2026-09-19`, where slice 17 recorded six, and a `menubarButton` of 4,4,39,28 inside a `menubar` of 4,4,5112,28 — the same bottom edge.

**What the sweep changed here.** Two figures, one of them only a derived clause:
- M16's headline is exact and its sub-clause was wrong. `getElementById` 324 + `contains` 478 = 802, which is 2n + 2 at `n=400` to the unit. But 478 is 2 × 238 + 2 against a census of 135 mounted node elements, so the clause deriving `contains` from `before.host.nodeElements` cannot hold. The census is right — the same snapshot's `scan.allClassCounts.DiagramNode` agrees, and it is taken after the mount's second settle, not early. What `contains` follows is the nodes that have ever rendered an element, which residency detaching a node does not reduce; [^census] works it through, and M16 now checks the total alone. The panel's `describe()` keeps its figure and says in a comment what it does and does not bound.
- M24's `apply` is 12, not 8. `doLayout` 10 and the 125 size hints are both exact in the same phase, so the panel builds what the plan says; slice 17 recorded 11, so the engine sits nearer the slice's own figure than the offline re-measure does. 12 is recorded as measured, as phase 3 did for its M11 and M26.
- M26 was corrected in the phase-3 worker's pass, and reads correctly here after the rebase: 456.68 sink ops per unit against the 412 derived offline, the whole difference in `apply` (338.2), with the rule counters and `measureTexts` exactly where the census put them.

**A thin spot in `shk-diagram`'s hover coverage, worth a note rather than a fix.** It records 1 crossing over 60 units among 281 elements, where the other four hover runs record 4 to 11. That passes M27's "> 0", and the run is otherwise clean, but one crossing is thin cover for the tooltip and event-dispatch candidates (G19, G20) that panel's `hover` target exists to serve. Whoever next measures those groups through `diagram-graph` should read the crossing count before trusting the phase.

**The Tauri sweep.** The user then ran this plan's validation shapes a second time in the Tauri host, `ta-*` beside the `val-*` and `shk-*` runs, against the same `608544c9` build: `ta-diagram`, `ta-codedoc`, `ta-mdedit`, `ta-win`, `ta-form-flat`, `ta-form-nest`, `ta-form-date`, `ta-form-combo`, `ta-menus` and `ta-wide`. Each came back at the same viewport (5120 × 2075), the same `before.elements` and the same `describe()` census as its MiniBrowser counterpart, and all ten carry byte-identical `seam`, `work` and `geometry` — so M16 through M26 and C25 pass in Tauri at the figures they pass at in MiniBrowser, C24's two rectangles included. Neither of the two panels the phase-3 sweep found differing is one of this plan's. Not re-run in Tauri, and so MiniBrowser-only: C23's `type=date` phase, the shakedown's `click=combo` phase, `shk-windows` and `shk-win-edge`; the README's entries say so.

Frame times are recorded per host and not compared: the two sweeps ran in different sessions, where the *Measurement rules*' 8–14% drift applies, so a ratio between the columns would measure the sessions rather than the hosts. Counts, rule totals and rectangles are deterministic, and those did agree.

**What is still open.** Nothing in this plan's own checks: both halves of every `Validated:` entry are now filled in. A later sweep that re-measures any of these figures must say which build it ran, since `608544c9` is no longer `master`.
