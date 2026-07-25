# Overlay Scrollbars for Non-`Panel` Components — Implementation Plan

## Overview

The framework's custom overlay scrollbars — a hidden native bar plus two synced [`Scrollbar`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L324) widgets — are reachable only from [`Panel`](packages/lib/src/typescript/lib/core/Panel.ts#L1051) today. This plan makes them reachable from two components that are not `Panel`s and whose scroll happens on an element they do not own: [`CodeEditor`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L138) (CodeMirror's `.cm-scroller`) and [`TextArea`](packages/lib/src/typescript/lib/component/input/TextArea.ts#L53) (a native `<textarea>`).

The work is a new composed helper, `core/OverlayScrollbars.ts`, plus a `scrollbarStyle` option on each of the two components. The helper owns the two bars, the native-`"scroll"` listener, the native-bar hiding, and the per-pass metric push. It learns *which element scrolls* and *where the bars attach* through two callbacks the owner supplies, so it works equally over an element the component owns and one a foreign widget owns.

`Panel` and [`VirtualScroller`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L47) keep their existing implementations unchanged. The only edits to `Panel.ts` are moving two pieces this plan turns into shared ones (the `ScrollbarStyle` type and the hide-the-native-bar class rule) into the new module and importing them back.

---

## Architecture Decisions

### A composed helper class in `core/`, driven by a callback seam

The machinery lives in a new `core/OverlayScrollbars.ts` as a plain (non-`Component`) class that an owning component constructs and holds in a field. It learns the scroll element and the bar host through an `OverlayScrollbarTarget` seam of two callbacks.[^helper-shape]

This mirrors [`core/SmoothScroller.ts:50`](packages/lib/src/typescript/lib/core/SmoothScroller.ts#L50), whose `SmoothScrollTarget` `{ read, write, clamp }` seam lets one easing loop serve both `Component`'s native-overflow scrolling and `VirtualScroller`'s transform scrolling, and [`VirtualScroller`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L72), the existing example of a non-`Component` scroll helper that takes its owner plus a callback and is constructed from the owner's lifecycle.

### `scrollbarStyle` on each component, defaulting to `"overlay"`

`CodeEditorOptions` and `TextAreaOptions` each gain `scrollbarStyle?: ScrollbarStyle`, with a `setScrollbarStyle` / `getScrollbarStyle` pair and a class-level default of `"overlay"` — the same option name, type, values, and default `Panel` already uses.[^same-option-name]

The `ScrollbarStyle` type definition moves from `Panel.ts` to `core/OverlayScrollbars.ts`; `Panel.ts` re-exports it, so `core/index.ts` and every existing import path keep working unchanged.

### `TextArea`'s bars are spliced in as **siblings** of the `<textarea>` — no wrapper

A `<textarea>` renders no element children, so the bars cannot go inside it. They are appended to the textarea's own DOM parent, next to it, and positioned in that parent's coordinate space using the component's laid-out rect (`getX()`, `getY()`, `getWidth()`, `getHeight()`). No wrapper element is created.

Splicing a raw node into your own parent's child list is already an established move in `Component`: [`setClipFrame`](packages/lib/src/typescript/lib/core/Component.ts#L1029) reads `getParentNode(element)` and inserts its frame there. What is *not* reusable is the clip frame itself — layout managers own it and clear it — nor a wrapper of the same shape.[^textarea-wrapper]

The bars and the textarea always agree on coordinates because they share one parent, and therefore one containing block, whatever that parent turns out to be (the container element, a content frame, or a layout manager's clip frame).

### Bars overlay the trailing edge; the scroll viewport is not inset

`Panel` physically insets its inner scroll element by the track width so content clips before the bar band. Neither new client can do that: `.cm-scroller` and the `<textarea>`'s scroll box belong to CodeMirror and the browser. So for these two components the bars are true overlays — content passes under them at the trailing edge.[^no-inset]

Overlaying rather than insetting is a deliberate divergence from `Panel`, which is unchanged and keeps its inset model.

### `Panel` and `VirtualScroller` are not migrated onto the helper

Both keep their current implementations. `VirtualScroller` cannot use the helper at all — it has no native scroll element, keeping scroll position in JS fields and writing a `translate3d` transform. `Panel` could, but its version additionally owns and insets an inner scroll element, re-parents children onto it, and reserves a gutter that feeds `getInnerSize` and `scheduleLayout`; none of that applies to a foreign scroller.[^no-migration]

What the three genuinely share is already shared: the `Scrollbar` widget, and — after this plan — the class rule that hides a native bar on an element the framework does not address by `#id`.

### The native `"scroll"` event reaches the owner through `Event.addSubtreeListener`

`Event` installs one **capture-phase** window listener per event type ([`Event.ts:60`](packages/lib/src/typescript/lib/core/Event.ts#L60) returns `{ capture: true, … }`), then walks from `event.target` up the parent chain matching component ids ([`Event.ts:167`](packages/lib/src/typescript/lib/core/Event.ts#L167)). `scroll` does not bubble, but a non-bubbling event still runs the capture phase from the window down to its target, so the window listener fires and the upward walk finds the owner.

For `CodeEditor` the walk is `.cm-scroller` → `.cm-editor` → the editor element (which carries the component id); the id-less intermediate nodes are skipped by the `if (id)` guard. `Panel` already depends on exactly this for its id-less inner scroll div ([`Panel.ts:1116`](packages/lib/src/typescript/lib/core/Panel.ts#L1116)).

---

## Public API

```typescript
// core/OverlayScrollbars.ts

/**
 * Selects how a scrolling component renders its scrollbar.
 * (Moved verbatim from Panel.ts; Panel re-exports it.)
 */
export type ScrollbarStyle = "native" | "overlay";

/** Class applied to a scroll element whose native bar the overlay hides. */
export const OVERLAY_SCROLLER_CLASS = "OverlayScroller";

/** Registers the shared hide-the-native-bar class rules once. */
export function ensureOverlayScrollerClassRule(): void;

/** The two lookups an owner supplies so the helper can find its elements. */
export interface OverlayScrollbarTarget {
    /** The node the two bar elements are appended to; undefined before render. */
    barHost(): Handle | undefined;
    /** The element whose native scroll the bars mirror; undefined before render. */
    scrollElement(): Handle | undefined;
}

export class OverlayScrollbars {
    constructor(owner: Component, target: OverlayScrollbarTarget, zIndex?: number);

    /** Positions both bars in the band `(x, y, width, height)` (bar-host coordinates) and pushes metrics. */
    layout(x: number, y: number, width: number, height: number): void;

    /** Re-runs `layout` against the last band, for content changes that trigger no layout pass. */
    sync(): void;

    /** Unwires the listeners, detaches both bars, and un-hides the native bar. */
    dispose(): void;
}
```

```typescript
// core/Panel.ts — re-export only; the definition moves out
export type { ScrollbarStyle } from "~/core/OverlayScrollbars.js";
```

```typescript
// component/editor/CodeEditor.ts
export interface CodeEditorOptions extends ComponentOptions {
    // …existing fields…
    /** Scrollbar rendering. Defaults to `"overlay"`. */
    scrollbarStyle?: ScrollbarStyle;
}

class CodeEditor extends Component<CodeEditorOptions> {
    setScrollbarStyle(style: ScrollbarStyle): this;   // caches into _options.scrollbarStyle
    getScrollbarStyle(): ScrollbarStyle;              // _options.scrollbarStyle ?? _defaultOptions.scrollbarStyle!
    doLayout(): this;                                 // new override
}
```

```typescript
// component/input/TextArea.ts
export interface TextAreaOptions extends TextInputOptions {
    // …existing fields…
    /** Scrollbar rendering. Defaults to `"overlay"`. */
    scrollbarStyle?: ScrollbarStyle;
}

class TextArea extends TextInput<TextAreaOptions> {
    setScrollbarStyle(style: ScrollbarStyle): this;
    getScrollbarStyle(): ScrollbarStyle;
    doLayout(): this;                                 // new override
    removeElement(): this;                            // new override — disposes the sibling bars
    protected onInput(): void;                        // new override — calls super, then bars.sync()
    protected destructor(): void;                     // new override
}
```

Backing state on each owner is a single private field, `private _overlayBars: OverlayScrollbars | null = null;`. It is runtime bookkeeping, not consumer configuration, so it stays off the options bag. A plain initialiser is correct here — nothing writes the field during the `super()` cascade, because `applyOptions` only *caches* `scrollbarStyle` and the helper is built from the constructor body afterwards.[^cascade-safe]

---

## Internal Structure

### The helper's private state and the one code path

```typescript
export class OverlayScrollbars {
    private _owner   : Component;
    private _target  : OverlayScrollbarTarget;
    private _zIndex  : number | undefined;
    private _barV    : Scrollbar | null = new Scrollbar("vertical");
    private _barH    : Scrollbar | null = new Scrollbar("horizontal");
    private _host    : Handle | null    = null;   // where the bars are currently appended
    private _hiddenOn: Handle | null    = null;   // element currently carrying OVERLAY_SCROLLER_CLASS
    private _band    : { x: number; y: number; width: number; height: number } | null = null;

    // Named class fields, per ARCHITECTURE.md "Listeners must reference a named function".
    private _onNativeScroll = (): void => { this.sync(); };
    private _onBarV = (position: number): void => { this._owner.setScrollTop(position); };
    private _onBarH = (position: number): void => { this._owner.setScrollLeft(position); };
}
```

`layout(x, y, width, height)` caches the band and calls the private `apply()`; `sync()` calls `apply()` with the cached band and no-ops when there is none. `apply()` is the only place that reads or writes anything:

1. Resolve `host = target.barHost()` and `scroller = target.scrollElement()`. Return when either is missing or `width <= 0 || height <= 0`.
2. When `host !== this._host`, append both bar elements to `host` (`DOM.sink.appendChild(host, bar.getElement(true)!)`) and record it. This is also the first-append path.
3. When `scroller !== this._hiddenOn`, remove `OVERLAY_SCROLLER_CLASS` from the old element and add it to `scroller`, then record it. This is what re-homes the hidden bar when `CodeEditor`'s view mounts and `getScrollElement()` starts answering `.cm-scroller`.
4. Read `m = DOM.source.getScrollMetrics(scroller)` once.
5. Compute the band split and push it (table below).

`dispose()` nulls `_barV` / `_barH`, and `apply()` returns early when either is already null, so a disposed helper is inert rather than throwing.

### Band split — worked cases

`trackW` is `Scrollbar.getTrackWidth()` (12). A bar shows when the scroller overflows on its axis; each bar's track is shortened by the other bar's width so the two do not fight over the shared corner. `setMetrics` receives the scroller's **real** `clientWidth` / `clientHeight`, not the shortened track, because the scroll viewport is not inset.

| `scrollHeight > clientHeight` | `scrollWidth > clientWidth` | `barW` | `barH` | V bar rect | H bar rect |
|---|---|---|---|---|---|
| no | no | `width` | `height` | hidden by `setMetrics` | hidden by `setMetrics` |
| yes | no | `width - 12` | `height` | `(x + width - 12, y, 12, height)` | hidden |
| no | yes | `width` | `height - 12` | hidden | `(x, y + height - 12, width, 12)` |
| yes | yes | `width - 12` | `height - 12` | `(x + width - 12, y, 12, height - 12)` | `(x, y + height - 12, width - 12, 12)` |

Writes, in order: `_barV.setX(x + barW).setY(y).setHeight(barH)` then `_barV.setMetrics(m.clientHeight, m.scrollHeight, m.scrollTop)`; `_barH.setX(x).setY(y + barH).setWidth(barW)` then `_barH.setMetrics(m.clientWidth, m.scrollWidth, m.scrollLeft)`. `Scrollbar.setMetrics` ([`Scrollbar.ts:569`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L569)) hides the bar itself when content fits, so no extra visibility handling is needed — and it emits nothing, so a bar-driven scroll cannot loop back through the native handler.

### Owner-side wiring, both clients

```typescript
// CodeEditor's version; TextArea's differs only in `barHost` and drops the z-index argument.
private refreshOverlayScrollbars(): void {
    if (this.getScrollbarStyle() === "overlay") {
        this._overlayBars ??= new OverlayScrollbars(
            this,
            { barHost: () => this.getElement(), scrollElement: () => this.getScrollElement() },
            CM_OVERLAY_BAR_Z_INDEX,
        );
    } else {
        this._overlayBars?.dispose();
        this._overlayBars = null;
    }
}
```

Called from the owner's **constructor body** (after `super()` returns) and from `setScrollbarStyle`. It is never called from `applyOptions`. The class default still reaches it because `getScrollbarStyle()` folds the default in — the first of the two options ARCHITECTURE.md's *Class-level defaults must survive the getter* allows.

---

## Ordered Implementation Steps

1. **Create `packages/lib/src/typescript/lib/core/OverlayScrollbars.ts`.** Move the `ScrollbarStyle` type (with its JSDoc) out of [`Panel.ts:58`](packages/lib/src/typescript/lib/core/Panel.ts#L58), and `OVERLAY_SCROLLER_CLASS` + `_scrollerClassRules` + `ensureOverlayScrollerClassRule` out of [`Panel.ts:126-158`](packages/lib/src/typescript/lib/core/Panel.ts#L126). Change the class-name literal from `"PanelOverlayScroller"` to `"OverlayScroller"` and update its JSDoc to stop naming `Panel` as the only user. Add the `OverlayScrollbarTarget` interface and the `OverlayScrollbars` class per *Internal Structure*. The constructor creates both `Scrollbar`s, applies `setZIndex(zIndex)` when given, wires `bar.on("scroll", …)` on each, and registers `Event.addSubtreeListener(owner, "scroll", this._onNativeScroll)`. It appends nothing — the first `layout()` does that.
   *Check:* `npm run typecheck` compiles the new file.

2. **`Panel.ts` — import the moved pieces.** Replace the deleted definitions with `import { ensureOverlayScrollerClassRule, OVERLAY_SCROLLER_CLASS } from "~/core/OverlayScrollbars.js";` and `import type { ScrollbarStyle } from "~/core/OverlayScrollbars.js";`, plus `export type { ScrollbarStyle };` so `core/index.ts:22` and existing consumer imports keep resolving. No other line of `Panel.ts` changes.
   *Check:* `grep -rn 'PanelOverlayScroller' packages/lib/src packages/lib/tests` — expect zero matches. `npm test` — `PanelOverlayScrollbar.test.ts` stays green with no edits.

3. **`CodeEditor.ts` — add the option, the setter pair, and the field.** Add `scrollbarStyle?: ScrollbarStyle` to `CodeEditorOptions`, `scrollbarStyle: "overlay"` to `_defaultCodeEditorOptions` ([L58](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L58)), `private _overlayBars: OverlayScrollbars | null = null;`, and the `setScrollbarStyle` / `getScrollbarStyle` pair, where the getter folds in the class default (`this._options.scrollbarStyle ?? this._defaultOptions.scrollbarStyle!`). Declare `const CM_OVERLAY_BAR_Z_INDEX = 250;` next to the other module constants, with a comment that it sits above CodeMirror's sticky gutter (`z-index: 200`) and below the read-only flash overlay (`z-index: 300`, [L627](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L627)).

4. **`CodeEditor.ts` — cache in `applyOptions`, build in the constructor body.** In `applyOptions` ([L204](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L204)), add a fourth pure cache line beside the existing three: `if (options.scrollbarStyle !== undefined) this._options.scrollbarStyle = options.scrollbarStyle;`. Do **not** dispatch the setter from there. In the constructor body, after the existing `this.onFirstLayout(…)` call, add `this.refreshOverlayScrollbars();`. That private method reads `getScrollbarStyle()` and either constructs the helper or disposes it, per the *Internal Structure* snippet. The target it passes is `{ barHost: () => this.getElement(), scrollElement: () => this.getScrollElement() }`, and the z-index argument is `CM_OVERLAY_BAR_Z_INDEX`. `setScrollbarStyle` caches into `_options` and then calls the same `refreshOverlayScrollbars()`.

5. **`CodeEditor.ts` — drive it.** Add a `doLayout(): this` override that calls `super.doLayout()`, then `this.commitElementStyle()`, then `this._overlayBars?.layout(0, 0, this.getWidth(), this.getHeight())`. The `commitElementStyle()` call is mandatory: `LayoutManager.commitBounds` ([L471](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L471)) runs `doLayout` with `autoCommitStyle === false`, so the freshly assigned size is still queued and `getScrollMetrics` would read the previous frame's box. `Panel.doLayout` does the same at [Panel.ts:551](packages/lib/src/typescript/lib/core/Panel.ts#L551).

6. **`CodeEditor.ts` — refresh on content and geometry changes.** In the `EditorView.updateListener` inside `mount()` ([L566](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L566)), after the existing `docChanged` branch, add `if (update.docChanged || update.geometryChanged) { this._overlayBars?.sync(); }`. Typing changes `scrollHeight` without triggering a framework layout pass, so without this the thumb goes stale.

7. **`CodeEditor.ts` — teardown.** In `destructor()` ([L483](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L483)), before `this._scrollElement = null;`, add `this._overlayBars?.dispose(); this._overlayBars = null;` — the dispose must run while `getScrollElement()` still resolves to `.cm-scroller` so the class is removed from the right element.

8. **`TextArea.ts` — add the option, the setter pair, and the field.** Same shape as step 3: `scrollbarStyle?: ScrollbarStyle` on `TextAreaOptions`, `scrollbarStyle: "overlay"` in `_defaultTextAreaOptions` ([L26](packages/lib/src/typescript/lib/component/input/TextArea.ts#L26)), `private _overlayBars: OverlayScrollbars | null = null;`, and the setter plus default-folding getter. No z-index argument — the bars are siblings, so DOM order alone puts them above the textarea.

9. **`TextArea.ts` — cache in `applyOptions`, build in the constructor body.** In `applyOptions` ([L79](packages/lib/src/typescript/lib/component/input/TextArea.ts#L79)), add `if (options.scrollbarStyle !== undefined) this._options.scrollbarStyle = options.scrollbarStyle;` — a pure cache, no setter dispatch. In the constructor body, after the existing `this.setElementCSSRules({ resize: "none" })`, add `this.refreshOverlayScrollbars();`. The target is `{ barHost: () => { const el = this.getElement(); return el ? (DOM.source.getParentNode(el) ?? undefined) : undefined; }, scrollElement: () => this.getScrollElement() }`.

10. **`TextArea.ts` — drive it.** Add `doLayout(): this` calling `super.doLayout()`, then `this.commitElementStyle()`, then `this._overlayBars?.layout(this.getX(), this.getY(), this.getWidth(), this.getHeight())`. The band origin is the component's own laid-out position because the bars are siblings of the textarea, sharing its containing block.

11. **`TextArea.ts` — refresh on typing.** Override `protected onInput(): void` to call `super.onInput()` then `this._overlayBars?.sync()`. `TextInput` documents that subclasses must not wire a second `"input"` listener ([TextInput.ts:131](packages/lib/src/typescript/lib/component/input/TextInput.ts#L131)), so the override is the only correct route.

12. **`TextArea.ts` — teardown on both paths.** Override `protected destructor()` to dispose the helper before `super.destructor()`, **and** override `removeElement()` to do the same before `super.removeElement()`. The second override is required only here: the bars are siblings of the textarea rather than its children, so detaching the element alone would strand them in the parent.

13. **Register the new class defaults.** Add two rows to the registry in [`packages/lib/tests/component/default-options-fallback.test.ts:207`](packages/lib/tests/component/default-options-fallback.test.ts#L207): `{ label: 'TextArea scrollbarStyle', resolve: () => new TextArea().getScrollbarStyle(), expected: 'overlay' }` and the `CodeEditor` twin. ARCHITECTURE.md requires a row for every class-defaulted field.

14. **Write `packages/lib/tests/core/OverlayScrollbars.test.ts`**, covering the unit-testable cases in *Expected Behaviour*. Mirror the harness of [`PanelOverlayScrollbar.test.ts`](packages/lib/tests/core/PanelOverlayScrollbar.test.ts): `installTestDOM(CONFIG)` in `beforeEach`, `vi.spyOn(DOM.source, 'getScrollMetrics')` to stage geometry, and a narrow cast type to reach private fields without `any`.

15. **Extend the two component test files.** Add the option-plumbing and teardown cases to [`packages/lib/tests/component/input/TextArea.test.ts`](packages/lib/tests/component/input/TextArea.test.ts) and [`packages/lib/tests/component/code-editor.test.ts`](packages/lib/tests/component/code-editor.test.ts).

16. **Docs.** Add a short "Scrollbars" subsection to `packages/lib/docs/components/TextArea.md` and `packages/lib/docs/components/CodeEditor.md` stating the `"overlay"` default and the `"native"` opt-out.
    *Check:* `npm run docs:api` finishes with zero new warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/OverlayScrollbars.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Panel.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TextArea.ts` |
| Create | `packages/lib/tests/core/OverlayScrollbars.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/tests/component/input/TextArea.test.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/docs/components/TextArea.md` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |

---

## Expected Behaviour

### Unit-testable offline

The recording DOM sink models geometry and records writes but delivers no events, so everything below is driven by calling methods directly and stubbing `DOM.source.getScrollMetrics`.

1. **Neither axis overflows** — `layout(0, 0, 400, 300)` with `scrollWidth = clientWidth = 400`, `scrollHeight = clientHeight = 300`: both bars report `isDisplayed() === false`.
2. **Vertical only** — `scrollHeight 900 / clientHeight 300`: V bar at `x = 388`, `y = 0`, `height = 300`, displayed; H bar not displayed.
3. **Horizontal only** — `scrollWidth 900 / clientWidth 400`: H bar at `x = 0`, `y = 288`, `width = 400`, displayed; V bar not displayed.
4. **Both axes** — V bar `height = 288`, H bar `width = 388`, both displayed, neither overlapping the corner.
5. **Metrics use the real viewport** — with `clientHeight 300`, `scrollHeight 900`, `scrollTop 150`, the V bar receives `setMetrics(300, 900, 150)`, i.e. the scroller's own client size, not the shortened track length.
6. **Non-positive band is a no-op** — `layout(0, 0, 0, 0)` performs no `getScrollMetrics` read and leaves both bars untouched.
7. **Native bar hidden on the scroll element** — after the first `layout`, the scroll element's handle received `addClass: ["OverlayScroller"]`.
8. **The hidden-bar class follows a changing scroll element** — when `scrollElement()` starts answering a different handle, the next `layout` records `removeClass` on the old handle and `addClass` on the new one.
9. **The bars follow a changing bar host** — when `barHost()` answers a different handle, the next `layout` re-appends both bar elements to it.
10. **`sync()` before any `layout()` is a no-op**; after a `layout`, `sync()` re-reads metrics and re-pushes them without changing the cached band.
11. **A bar's `"scroll"` drives the owner** — invoking the vertical bar's registered listener with `150` results in `owner.getScrollTop() === 150`.
12. **`dispose()` is complete** — both bar elements are detached, the `OverlayScroller` class is removed from the scroll element, and the subtree `"scroll"` listener is unregistered.
13. **`TextArea` option plumbing** — `new TextArea().getScrollbarStyle() === "overlay"`; `new TextArea('', { scrollbarStyle: 'native' }).getScrollbarStyle() === "native"`; the `"native"` instance holds no helper.
14. **`TextArea` teardown on both paths** — `removeElement()` and `destructor()` each detach the bar elements from the parent node.
15. **`TextArea.onInput` refreshes** — calling the protected `onInput` re-reads scroll metrics (spy call count increases) and still fans the change out to `on("change")` listeners.
16. **`CodeEditor` option plumbing** — same three assertions as case 13, with `new CodeEditor('')`.
17. **`CodeEditor` offline stays inert** — with no mounted view, `getScrollElement()` falls back to the editor element, so a layout pass measures the editor's own box, finds no overflow, and leaves both bars undisplayed. Constructing and disposing the editor throws nothing.

### Manual verification in the browser

CodeMirror never mounts under the recording sink, and the harness delivers no wheel, scroll, or pointer events, so these must be checked live. Run `npm run dev` (app on `localhost:8015`) — but start a second server on a spare port if one is already running, and symlink `<worktree>/node_modules/@jimka/typescript-ui -> ../../packages/lib` first, or the page will load the main tree's library instead of this branch.

- **`CodeEditor` (Code Editor demo panel, `CodeEditorPanel.ts`)** — paste enough code to overflow vertically: the OS bar is gone and a framework bar appears at the right edge, above the line-number gutter. Wheel-scrolling moves the thumb; dragging the thumb moves the text; clicking the track pages. Typing extra lines grows the thumb's range without a layout pass. A long unwrapped line brings up the horizontal bar, and the two bars stop short of the shared corner. Toggling to `scrollbarStyle: "native"` restores the OS bar and removes both widgets.
- **`TextArea` (Fit demo panel, `FitPanel.ts`)** — type past the bottom of the box: the OS bar is gone and a framework bar sits at the textarea's right edge. Caret-driven scrolling (holding the down arrow to the last line) moves the thumb. Resize the window and confirm the bar tracks the textarea's new rect. Place a `TextArea` in a `Grid` cell small enough to clip it and confirm the bars still land on the textarea's edges.
- **Read-only flash still paints over the bars** on a read-only `CodeEditor` (the flash overlay's `z-index: 300` beats the bars' `250`).
- **`Panel` is unaffected** — the Misc demo panel's `autoScroll` window still shows its inset overlay bars exactly as before.

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — full suite green, including the untouched `PanelOverlayScrollbar.test.ts`, `PanelScrollChaining.test.ts`, and `PanelGutterSettle.test.ts`.
- `grep -rn 'PanelOverlayScroller' packages/lib/src packages/lib/tests` — zero matches.
- `grep -rn 'ScrollbarStyle' packages/lib/src/typescript/lib/core/index.ts` — still exported (the re-export chain holds).
- `npm run lint` — clean, in particular the `local/no-raw-dom` rule over the new module.
- `npm run docs:api` — zero new warnings.
- The manual browser list above.

---

## Documentation Impact

- `ScrollbarStyle` keeps its exported name and its `core` barrel entry ([`core/index.ts:22`](packages/lib/src/typescript/lib/core/index.ts#L22)); only its defining file changes, so no doc page needs a rename sweep.
- `OverlayScrollbars` and `OverlayScrollbarTarget` are internal machinery, not barrel exports — matching `core/ScrollShadow.ts`, which is likewise unexported. They get JSDoc but no doc page and no `llms.txt` entry.
- `packages/lib/docs/components/TextArea.md` and `packages/lib/docs/components/CodeEditor.md` each gain a short subsection for the new option and its default.
- Per CODE_CONVENTIONS.md, the new public JSDoc must not `{@link}` any `private` / `protected` / unexported symbol — describe the helper in prose from the two components' JSDoc rather than linking to it.

---

## Potential Challenges

- **`Handle` identity comparison.** The host and scroller re-home checks inside `apply()` compare handles with `!==`. `DOM.source.intern` returns a stable interned handle per node ([`DOM.ts:212`](packages/lib/src/typescript/lib/core/DOM.ts#L212)), so repeat lookups of the same node compare equal; a changed node compares unequal, which is exactly the trigger wanted.
- **`CodeEditor` mounts during the first layout pass.** `runFirstLayoutCallbacks` runs inside `Component.doLayout` ([L5178](packages/lib/src/typescript/lib/core/Component.ts#L5178)), so calling `super.doLayout()` *before* `layout(...)` in the override means the very first pass already sees `.cm-scroller`.
- **Two `"scroll"` subtree listeners can coexist** on one component (`Panel` already registers a shadow listener and an overlay listener). Nothing here stacks a duplicate, because each helper registers exactly once in its constructor and unregisters in `dispose`.
- **A `TextArea` whose parent element is replaced** (dock tear-off, content-frame install) leaves the bars behind for one frame; the `barHost()` re-home check in `apply()` corrects it on the next layout pass.
- **The `"overlay"` default changes every existing `TextArea`'s appearance.** Hiding the OS bar widens the text box by the native track width, so wrapped text reflows. Expected, and the reason the manual list includes a plain textarea.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/SmoothScroller.ts`](packages/lib/src/typescript/lib/core/SmoothScroller.ts) — the precedent this plan mirrors: a `core/` helper class driven by a small callback seam (`SmoothScrollTarget`, L50) so one implementation serves two unrelated scroll models.
- [`packages/lib/src/typescript/lib/component/container/VirtualScroller.ts`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts) — the second precedent: a non-`Component` scroll helper owned by a component, taking the owner plus a callback (L72), registering subtree listeners on its owner (L146), and pushing bar geometry from the owner's render pass (L382).
- [`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts) — the existing overlay implementation, to read for the bar-geometry and teardown idioms but otherwise not to modify: `installOverlayScrollbars` (L1051), `layoutOverlayScrollbars` (L1224), `syncOverlayScrollbars` (L1311), `removeOverlayScrollbars` (L1141). Note that Panel's `declare`-plus-seed cascade pattern in `applyOptions` (L271) is deliberately **not** copied here — see the constructor-body decision in `## Internal Structure`.
- [`packages/lib/src/typescript/lib/core/ScrollShadow.ts`](packages/lib/src/typescript/lib/core/ScrollShadow.ts) — the codebase's stated rule for what to share between two scroll systems and what to leave with each owner.
- [`packages/lib/src/typescript/lib/component/container/Scrollbar.ts`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts) — `setMetrics` (L569), `getTrackWidth` (L624), the `"scroll"` event (L524).
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `getScrollElement` (L975), `setClipFrame`'s parent-splice move (L1029), `commitElementStyle` (L1431), `setScrollTop` / `setScrollLeft` (L3436, L3459), `doLayout` (L5178).
- [`packages/lib/src/typescript/lib/core/Event.ts`](packages/lib/src/typescript/lib/core/Event.ts) — `captureOpts` (L60) and the id-matching ancestor walk (L162-L187), which is why a non-bubbling `scroll` reaches the owner.
- [`plans/implemented/overlay-synced-scrollbar.md`](plans/implemented/overlay-synced-scrollbar.md) — the original plan; its line 347 non-goal is the one this plan reverses.
- [`plans/implemented/overlay-scrollbar-cross-axis-overlap.md`](plans/implemented/overlay-scrollbar-cross-axis-overlap.md) — why `Panel` insets its scroller, and why that reasoning does not transfer to a foreign scroller.
- [`packages/lib/tests/core/PanelOverlayScrollbar.test.ts`](packages/lib/tests/core/PanelOverlayScrollbar.test.ts) — the offline harness the new test file mirrors.

---

## Non-Goals

- **Do not change `VirtualScroller`.** It has no native scroll element to mirror; the helper cannot serve it.
- **Do not migrate `Panel` onto the helper.** Its gutter, inner-scroller, and content-re-parenting machinery are specific to owning the scroller, and rewriting a heavily-tested implementation buys nothing visible.
- **Do not inset the scroll viewport** of `.cm-scroller` or the `<textarea>`, by CSS padding, a CodeMirror theme rule, or otherwise. The bars overlay the trailing edge.
- **Do not add scroll-edge shadows** to either component. Shadows are a separate feature with its own overlay element and per-edge cache; adding them is not needed to reach parity on bars.
- **Do not add `scrollbarStyle` to `Component`** or to any other component. Two clients, two typed setters.
- **Do not add per-component theming or arrow configuration** beyond `Scrollbar`'s existing defaults.
- **Do not change how either component scrolls.** Native scrolling, caret reveal, find-in-page, keyboard, and assistive-tech behaviour are untouched; only the bar's painting changes.

---

## Notes

[^helper-shape]: Three shapes were weighed. A module of free functions (the `ScrollShadow.ts` shape) does not fit, because this machinery is stateful — two `Scrollbar` instances, a registered listener, and three cached handles per owner — whereas `ScrollShadow.ts` shares only stateless visual maths and says so in its own header comment. A `protected` method set on `Component` would put two `Scrollbar` fields on every component in the framework and would collide with `Panel`'s own implementation. A composed helper class holds the state where it is used, keeps `Component` untouched, and is the shape `VirtualScroller` already establishes for scroll machinery owned by a component.
    The seam is two callbacks rather than two handles because both lookups change after construction: `CodeEditor`'s scroll element becomes `.cm-scroller` only once CodeMirror mounts, and `TextArea`'s bar host changes if its element is re-parented. Re-resolving per layout pass costs one property read and removes a whole class of stale-handle bugs.

[^cascade-safe]: The alternative — dispatching `setScrollbarStyle` from `applyOptions`, the way `Panel` does — would build the helper (and therefore two `Scrollbar` child components) from inside `super()`, before the owner's own fields exist, and would then need `_overlayBars` declared with `declare` and re-seeded at the top of `applyOptions` to survive the cascade. Building from the constructor body instead is the same fix ARCHITECTURE.md prescribes for the `listeners` bag: defer the dispatch rather than bare the field. It costs nothing, because the default-folding getter already makes the class default reach the constructor-body call. `CodeEditor.applyOptions` ([L204](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L204)) already caches its other three options this way and does its real work from the constructor body.

[^same-option-name]: Reusing `scrollbarStyle` / `ScrollbarStyle` rather than inventing a per-component name means a consumer learns one word for the whole framework, and a "make everything native" sweep is one option key. The `"overlay"` default matches `Panel`, which flipped to it in `plans/implemented/overlay-synced-scrollbar.md`. Defaulting these two to `"native"` instead would leave a form showing framework bars on its panels and OS bars on its textarea — the inconsistency is more visible than either style on its own, and `"native"` remains a one-word opt-out per instance.

[^textarea-wrapper]: Three wrapper designs were investigated and rejected before settling on siblings.
    *Reusing the clip frame* ([`Component.setClipFrame`](packages/lib/src/typescript/lib/core/Component.ts#L1022)) is disqualified because layout managers own that frame: `Grid` calls `clearClipFrame()` on its non-clipping branch ([Grid.ts:1015](packages/lib/src/typescript/lib/layout/Grid.ts#L1015)) and `Border` does the same for every unframed region ([Border.ts:861](packages/lib/src/typescript/lib/layout/Border.ts#L861)), so a self-installed clip frame would be torn down by the next layout pass.
    *A new absolutely-positioned wrapper of the same shape* would have to mirror the component's whole rect, since the wrapper would become the containing block for the element parked inside it — meaning every `setX` / `setY` / `setWidth` / `setHeight` would need forwarding. That is invasive `Component` surgery for one component's benefit.
    *A `display: contents` or statically-positioned wrapper* avoids the geometry problem but breaks `getAttachNode()` ([Component.ts:1235](packages/lib/src/typescript/lib/core/Component.ts#L1235)): `setContentFrame` re-parents children by their attach node, which would move the textarea out of the wrapper and strand the bars — fixable only by widening `getAttachNode`, again a `Component` change.
    Siblings need no `Component` change at all. Their one cost is that `removeElement()` no longer takes the bars with it, which step 12 handles with a four-line override.

[^no-inset]: `Panel` can inset because it creates the element that scrolls. Insetting `.cm-scroller` would mean writing geometry into CodeMirror's own DOM (or shrinking the editor element with padding, which fights the consumer-facing `setPadding`), and a `<textarea>`'s scroll box cannot be inset at all without a padding hack that reserves space only at the trailing edge of the scroll range, not alongside the bar at every scroll offset. Overlaying is what native overlay scrollbars and every code editor with a floating bar already do, and the affected strip is 12px at the trailing edge. If insetting turns out to matter later it is a separate change to those two components, not to the shared helper.

[^no-migration]: The three implementations were compared line by line before this call. `VirtualScroller` keeps `_scrollX` / `_scrollY` as JS state, writes a `translate3d` transform, and solves bar visibility with a two-iteration loop over the owner's `getWidth()` / `getHeight()` — it never reads `getScrollMetrics` and has no element the helper could listen to for `"scroll"`. `Panel` is native-scroll like the new clients, but roughly two-thirds of its overlay code is about *owning* the scroller: creating the inner element, re-parenting children or the content frame onto it, re-asserting per-axis overflow across `setAutoScroll` transitions, sizing the inner element to the post-gutter viewport, and feeding `_scrollbarGutter` into `getInnerSize` and `scheduleLayout`. A single abstraction covering both would carry all of that as configuration two of its four clients would switch off. Migrating `Panel` is also risk the request did not ask for: it is the framework's most-used container, and its overlay path is covered by three dedicated test files.
