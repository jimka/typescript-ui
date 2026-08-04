---
depends-on: [markdown-code-editor-highlighting]
---

# CodeEditor Auto-Height for Markdown Fenced Code Blocks — Implementation Plan

## Overview

[`Markdown`](../packages/lib/src/typescript/lib/component/display/Markdown.ts) upgrades a fenced code block with a supported language to a live [`CodeEditor`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts), sized once at upgrade time from the placeholder `<pre>`'s measured `scrollHeight` ([`applyCodeEditorUpgrade`, Markdown.ts:798](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L798)). That measurement is a snapshot of the *plain-text* rendering, never revisited once CodeMirror mounts and renders the real, syntax-highlighted content, whose height can differ from the guess. Two bugs follow from this fixed-and-forgotten height:

1. **No autogrow.** A fenced block never grows or shrinks with its actual rendered content; there is no cap-then-scroll behaviour for a long block.
2. **Horizontal-scrollbar clipping.** When a line is wider than the box, CodeMirror's own horizontal scrollbar appears inside the already-fixed height and eats into the content area instead of the box growing to fit both the content and the bar — a real, currently-reachable bug, independent of autogrow.

This plan gives `CodeEditor` an opt-in auto-height mode — grow to fit content, capped at a row count, native vertical scrollbar beyond the cap — and has `Markdown` opt every upgraded fenced block into it with a 20-row cap. The horizontal-scrollbar fix rides the same mechanism: reserve the scrollbar's measured thickness in the height whenever one is showing. `CodeEditor`'s own contract for every other caller (`MarkdownEditor.ts`, the `CodeEditorPanel` demo) is unaffected — the new option defaults to unset, which is today's exact fixed-height, fill-parent behaviour.

This plan builds directly on top of `markdown-code-editor-highlighting`'s `applyCodeEditorUpgrade`/`_codeEditors`/wrapper machinery, which is not yet in `plans/implemented/` on this branch — the `depends-on` frontmatter above blocks `/implement` from starting this plan until that one has landed there.

---

## Architecture Decisions

### `CodeEditor` gains an opt-in `autoHeightMaxRows` option — reopening the shipped plan's own Non-Goal

[`markdown-code-editor-highlighting.md`](implemented/markdown-code-editor-highlighting.md)'s `## Non-Goals` explicitly deferred this: *"No auto-height mode added to `CodeEditor`... a `CodeEditor`-level feature with its own design surface... out of scope for wiring it into `Markdown`."* This plan is that follow-up. `CodeEditorOptions` gains `autoHeightMaxRows?: number`; unset (the default for every existing caller) leaves `CodeEditor` byte-for-byte unchanged.[^opt-in-not-flag]

### Height is driven by CodeMirror's own measurement, not a fixed CSS `max-height`

`@codemirror/view`'s `EditorView` exposes `contentHeight` (total rendered content height, including `.cm-content`'s own padding), `defaultLineHeight`, and `documentPadding` as live getters, and fires its `updateListener` extension — already used at [CodeEditor.ts:569](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L569) for the `"change"` event — on every `ViewUpdate`, including a transaction-less *remeasure-only* update whenever the view's own `ResizeObserver` detects a geometry change (its own container resizing, in particular). `ViewUpdate.heightChanged` and `ViewUpdate.geometryChanged` flag exactly that case.[^cm6-resize-observer] This plan reads `contentHeight` to size `CodeEditor`'s own root element and relies on the update listener plus CodeMirror's internal `ResizeObserver` to re-settle after every `setHeight()` this plan makes — no polling, no `requestMeasure` scheduling of its own.

The alternative — a static CSS `max-height` on `.cm-editor` (CodeMirror's own documented "only limit height" recipe: drop the fixed `height: 100%`, cap with `max-height`, let `.cm-scroller`'s existing `overflow: auto` take over past the cap) — does not fit here. `CodeEditor`'s own root element (the `Component`'s box, one level *above* `.cm-editor`) is what `Markdown` positions absolutely per [ARCHITECTURE.md](../ARCHITECTURE.md)'s *Positioning is always absolute*; a `Component`'s box is sized explicitly via `setWidth`/`setHeight`, never left to CSS auto-sizing. Driving `setHeight()` from measured content keeps `CodeEditor` inside that discipline and needs no change to [theme.ts](../packages/lib/src/typescript/lib/component/editor/theme.ts)'s unconditional `"&": { height: "100%" }` — `.cm-editor` keeps filling whatever height the root box now has, fixed or self-computed.[^double-fire-safe]

### The row cap converts to pixels from CodeMirror's own measured metrics, not a theme token

`BaseTheme.ts` has no "N rows" / "max lines" structural token anywhere (`markdown.lineHeight` and `markdown.maxMeasure` are the only `markdown`-namespaced tokens, and neither is a row count); grepping the theme tree for `maxRows`/`maxLines`/`rowCap` returns nothing. Adding a themed token for a value only one call site uses would be new, unrequested configurability. The cap is a plain constant, `CODE_BLOCK_MAX_AUTO_ROWS = 20`, defined in `Markdown.ts` next to `FENCE_LANG_ALIASES`. It converts to pixels at measurement time via `view.defaultLineHeight * rows + view.documentPadding.top + view.documentPadding.bottom` — the real measured font metrics, not a guessed CSS `em` calculation that could drift from the actual rendered line height.

### `CodeEditor` self-drives its own height; `Markdown` reacts to a new `"heightchange"` event

`CodeEditor` is raw-DOM-appended by `Markdown`, not wired through `addComponent` (per the shipped plan's own `insertComponent`-can't-place-at-an-arbitrary-descendant reasoning), so `notifyIntrinsicSizeChanged()`'s automatic upward relay — installed only by `wireChild` — never reaches `Markdown`.[^notify-intrinsic-doesnt-apply] `CodeEditor` instead computes its own desired height (content height, row-capped, scrollbar-reserved) and calls its own `setHeight()`, then fires a new `"heightchange"` event carrying the value. `Markdown` widens its per-editor wiring in `applyCodeEditorUpgrade` to listen for it and re-pin the `ts-ui-md-code-host` wrapper's CSS height to match — the same pattern `Table.ts`/`Header.ts` already use for cross-component custom events (`this._header.on("columnresizestart", (i, clientX) => this.onColumnResizeStart(i, clientX))`, [Table.ts:225](../packages/lib/src/typescript/lib/component/table/Table.ts#L225)): an inline arrow closure calling a named handler, not the DOM-routed `Event` API's named-function-reference rule (that rule is scoped to `Event.addListener`/`addSubtreeListener`/`addViewportListener`, not the custom `on`/`off`/`emit` surface — the codebase's own `.on()` call sites are inline closures throughout `Table.ts`, `Header.ts`, `Row.ts`, `Body.ts`).

### One combined routine, one combined step sequence — not two

Both bugs are read from the same `EditorView` state at the same moment: content height and horizontal-overflow are both only knowable *after* CodeMirror has laid out at the current width, and both feed the same `setHeight()` call. Splitting them into two mechanisms would mean measuring `.cm-scroller` twice and reconciling two independent height proposals into one `setHeight()` call for no benefit. A single private method, `CodeEditor.syncAutoHeight()`, computes the final capped, scrollbar-aware height in one pass; the Ordered Implementation Steps below build it as one sequence rather than a "task 1 steps" / "task 2 steps" split.

### Horizontal-scrollbar detection follows `Panel.measureScrollbarGutter`'s detect-then-reserve pattern

[`Panel.measureScrollbarGutter`](../packages/lib/src/typescript/lib/core/Panel.ts#L734) is the established precedent for "read post-layout `DOM.source.getScrollMetrics`, compare `scrollWidth`/`scrollHeight` against `clientWidth`/`clientHeight` to detect which native scrollbar the browser actually rendered this frame, and reserve `DOM.source.getScrollBarWidth()` px" (also used in [Table.ts:238](../packages/lib/src/typescript/lib/layout/Table.ts#L238) and [Menu.ts:334](../packages/lib/src/typescript/lib/overlay/Menu.ts#L334)). `syncAutoHeight` applies the same test to `.cm-scroller` (`CodeEditor`'s own `_scrollElement` handle, already resolved at [CodeEditor.ts:599](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L599)): `scrollWidth > clientWidth` means a horizontal scrollbar is showing, so its measured thickness is added to the desired height before the row cap is applied. This closes the actual reported bug — the editor's height was computed once, before CodeMirror ever decided a horizontal scrollbar was needed, so the bar's own track ate into space the last content row was already using — without over-reaching into a general "every `CodeEditor` reserves scrollbar space" change: the fix lives inside `syncAutoHeight`, which only runs when `autoHeightMaxRows` is set, i.e. only for `Markdown`'s upgraded fenced blocks today.

---

## Public API

```typescript
// CodeEditor.ts

export interface CodeEditorOptions extends ComponentOptions {
    value?: string;
    language?: string;
    readOnly?: boolean;
    /**
     * Row count the editor grows to fit before its own vertical scrollbar
     * takes over. Unset (the default): today's behaviour — a fixed height
     * the caller controls via `setHeight`/`preferredSize`, filling its host.
     */
    autoHeightMaxRows?: number;
    listeners?: { change?: (payload: CodeEditorChange) => void; readonlyedit?: () => void; heightchange?: (payload: CodeEditorHeightChange) => void };
}

/** Payload of `CodeEditor`'s `"heightchange"` event: the editor's new height in pixels. */
export interface CodeEditorHeightChange {
    height: number;
}

type CodeEditorEvent = "change" | "readonlyedit" | "heightchange";

class CodeEditor {
    getAutoHeightMaxRows(): number | null;

    on(event: "heightchange", listener: (payload: CodeEditorHeightChange) => void): this;
    off(event: "heightchange", listener: (payload: CodeEditorHeightChange) => void): this;
}
```

No setter (`setAutoHeightMaxRows`) is added — construction-time only, matching `CodeEditorOptions.value`'s positional-argument pattern rather than `readOnly`/`language`'s runtime-toggle pattern, because nothing requests a runtime toggle.[^construction-only]

`Markdown.ts` widens the hand-rolled constructor type it already carries for the dynamically-imported `CodeEditor` class:

```typescript
// Markdown.ts — PendingCodeUpgrade
interface PendingCodeUpgrade extends CodeUpgradeIdentity {
    CodeEditorClass: new (
        value: string,
        options: { readOnly: true; language: string; autoHeightMaxRows?: number },
    ) => CodeEditor;
}
```

No other exported symbol changes.

---

## Internal Structure

### `CodeEditor.ts` — `syncAutoHeight`

```typescript
/**
 * Computes this editor's desired height when {@link CodeEditorOptions.autoHeightMaxRows}
 * is set — the real rendered content height, plus the horizontal scrollbar's
 * measured thickness when `.cm-scroller` is showing one, capped at the row
 * limit converted to pixels via CodeMirror's own measured line height and
 * content padding — and applies it via `setHeight()`, emitting `"heightchange"`
 * when the value actually moves. No-op offline (no `_view`) and when
 * `autoHeightMaxRows` is unset (today's fixed-height contract).
 */
private syncAutoHeight(): void {
    const maxRows = this.getAutoHeightMaxRows();

    if (!this._view || maxRows === null) {
        return;
    }

    let desired = this._view.contentHeight;

    if (this._scrollElement) {
        const metrics = DOM.source.getScrollMetrics(this._scrollElement);

        if (metrics.scrollWidth > metrics.clientWidth) {
            desired += DOM.source.getScrollBarWidth();
        }
    }

    const capPx = maxRows * this._view.defaultLineHeight
                + this._view.documentPadding.top + this._view.documentPadding.bottom;

    desired = Math.min(desired, capPx);

    if (desired === this.getHeight()) {
        return;
    }

    this.setHeight(desired);
    this.emit("heightchange", { height: desired });
}
```

Called once synchronously at the end of `mount()` (CodeMirror's constructor-time initial update is not documented to reliably invoke `updateListener`, so this seeds the first measurement rather than assuming it does) and from the existing `updateListener` extension whenever `update.heightChanged || update.geometryChanged`:

```typescript
// CodeEditor.ts — mount(), inside the existing EditorView.updateListener.of(...) extension
EditorView.updateListener.of((update) => {
    if (update.docChanged) {
        this._options.value = update.state.doc.toString();
        this.emit("change", { value: this._options.value });
    }

    if (update.heightChanged || update.geometryChanged) {
        this.syncAutoHeight();
    }
}),
```

(`syncAutoHeight`'s own `maxRows === null` guard makes this call a no-op for every caller that never sets `autoHeightMaxRows` — no behaviour change for `MarkdownEditor`/`CodeEditorPanel`.)

### `Markdown.ts` — the row cap constant and the height-change handler

```typescript
/**
 * Cap on how many rows a fenced block's upgraded CodeEditor grows to before
 * its own vertical scrollbar takes over, rather than the wrapper continuing
 * to grow — keeps one long fenced block from pushing the rest of the prose
 * far down the page. Not a theme token: this is the only call site that
 * needs it, and BaseTheme.ts has no existing "row count" token shape to
 * extend (see Architecture Decisions).
 */
const CODE_BLOCK_MAX_AUTO_ROWS = 20;
```

```typescript
/**
 * Re-pins the `ts-ui-md-code-host` wrapper's height to a live CodeEditor's
 * own auto-grown height, then re-measures Markdown's own content height so
 * the taller/shorter block folds into the reported size. Wired in
 * `applyCodeEditorUpgrade` onto each editor's `"heightchange"` event.
 *
 * @param wrapper - The wrapper the fired editor sits in.
 * @param height - The editor's new height in pixels.
 */
private handleCodeEditorHeightChange(wrapper: Handle, height: number): void {
    DOM.sink.apply(wrapper, { style: { height: height + "px" } });
    this.measureContentHeight();
}
```

`applyCodeEditorUpgrade` passes `autoHeightMaxRows: CODE_BLOCK_MAX_AUTO_ROWS` in the constructor options and wires the listener right after construction:

```typescript
const editor = new CodeEditorClass(text, {
    readOnly: true,
    language: languageId,
    autoHeightMaxRows: CODE_BLOCK_MAX_AUTO_ROWS,
});

editor.setX(0).setY(0).setWidth(width).setHeight(height);
editor.on("heightchange", (payload) => this.handleCodeEditorHeightChange(wrapper, payload.height));
DOM.sink.appendChild(wrapper, editor.getElement(true)!);
DOM.sink.apply(wrapper, { style: { height: height + "px" } });

this._codeEditors.push({ editor, wrapper });
```

The initial `setHeight(height)` / wrapper pin (from the placeholder `<pre>`'s measured `scrollHeight`, unchanged from today) stays as the first paint's best guess, avoiding a flash of the wrong size before CodeMirror mounts; `syncAutoHeight`'s first pass (inside `mount()`, which runs on the next layout flush after this) then corrects it to CodeMirror's real content height, and `handleCodeEditorHeightChange` propagates that correction to the wrapper.

---

## Ordered Implementation Steps

1. **CodeEditor.ts — add `autoHeightMaxRows` to `CodeEditorOptions`.** Add the field per **Public API**, between `readOnly` and `listeners`. Add `if (options.autoHeightMaxRows !== undefined) this._options.autoHeightMaxRows = options.autoHeightMaxRows;` to `applyOptions` ([CodeEditor.ts:207](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L207)), matching the direct-cache style already used for `value`/`language`/`readOnly` on the lines above it (not routed through a setter — mirrors the existing pattern, since no view exists yet at cascade time). Add `getAutoHeightMaxRows(): number | null { return this._options.autoHeightMaxRows ?? null; }` near `getReadOnly()`. Check: `grep -n "autoHeightMaxRows" CodeEditor.ts` shows the option field, the `applyOptions` line, and the getter.

2. **CodeEditor.ts — widen `CodeEditorEvent`, add `CodeEditorHeightChange`, and widen the `listeners` bag.** Add the interface and widen the union per **Public API**. Add the `on(event: "heightchange", ...)` / `off(event: "heightchange", ...)` overload pairs, following the existing `"readonlyedit"` overloads' shape exactly (no payload becomes `{ height: number }` payload). Add the matching `protected emit(event: "heightchange", payload: CodeEditorHeightChange): void;` overload. Add `heightchange?: (payload: CodeEditorHeightChange) => void` to `CodeEditorOptions.listeners`'s inline type per **Public API** — `Component.applyListeners` ([Component.ts:701](../packages/lib/src/typescript/lib/core/Component.ts#L701)) dispatches any bag key to `this.on(key, fn)` generically via `Object.keys`, so no other wiring code is needed once the type admits the new key. Check: `npm run typecheck` (packages/lib) compiles clean — the overload set must line up with `_listeners.fire`/`.add`/`.remove`'s generic signature the same way the existing two events already do.

3. **CodeEditor.ts — implement `syncAutoHeight`.** Add the private method per **Internal Structure**, placed after `mount()`. Check: called directly against a `CodeEditor` with `_view` stubbed to a fake object exposing `contentHeight`/`defaultLineHeight`/`documentPadding` and `autoHeightMaxRows` set, `setHeight` is called with the expected capped value and `"heightchange"` fires; with `_view` left `null`, or `autoHeightMaxRows` unset, neither happens.

4. **CodeEditor.ts — wire `syncAutoHeight` into `mount()`.** Add the `update.heightChanged || update.geometryChanged` branch to the existing `EditorView.updateListener.of(...)` extension (CodeEditor.ts:569) per **Internal Structure**. Add one explicit `this.syncAutoHeight();` call at the end of `mount()`, after the `_scrollElement` resolution and the `setLanguage` call. Check: `grep -n "syncAutoHeight" CodeEditor.ts` shows the method, the updateListener call, and the post-mount call — three sites.

5. **Markdown.ts — add `CODE_BLOCK_MAX_AUTO_ROWS`.** Add the constant per **Internal Structure**, next to `FENCE_LANG_ALIASES` ([Markdown.ts:59](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L59)).

6. **Markdown.ts — widen `PendingCodeUpgrade["CodeEditorClass"]`.** Add `autoHeightMaxRows?: number` to the hand-rolled constructor options type per **Public API** ([Markdown.ts:370](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L370)).

7. **Markdown.ts — add `handleCodeEditorHeightChange`.** Add the private method per **Internal Structure**, placed after `applyCodeEditorUpgrade`.

8. **Markdown.ts — update `applyCodeEditorUpgrade`.** Pass `autoHeightMaxRows: CODE_BLOCK_MAX_AUTO_ROWS` in the constructor call and add the `editor.on("heightchange", ...)` wiring line, per **Internal Structure**. The initial `setHeight`/wrapper-pin lines stay unchanged. Check: `grep -n "CODE_BLOCK_MAX_AUTO_ROWS\|heightchange" Markdown.ts` shows both new call sites in `applyCodeEditorUpgrade`.

9. **Tests — `code-editor.test.ts`.** Add a `describe('CodeEditor autoHeightMaxRows')` block: `getAutoHeightMaxRows()` defaults to `null`; round-trips through `applyOptions`; `syncAutoHeight` (invoked directly, `as any`) is a no-op with no `_view` (offline default — assert `getHeight()` unchanged and no `"heightchange"` listener firing) and a no-op with `_view` set but `autoHeightMaxRows` unset. Add a case driving `syncAutoHeight` with a stubbed `_view` (per step 3) that exercises the row cap (`contentHeight` above `capPx` clamps to `capPx`) and the horizontal-scrollbar reserve (`_scrollElement` stubbed via `DOM.source.getScrollMetrics` mock returning `scrollWidth > clientWidth`, asserting the reserved `DOM.source.getScrollBarWidth()` is added before the cap). Add a `heightchange` case to the existing `'CodeEditor listeners bag'` `describe` block, mirroring the `'change'` cases at [code-editor.test.ts:124](../packages/lib/tests/component/code-editor.test.ts#L124).

10. **Tests — `Markdown.test.ts`.** Add a no-op `on(): this { return this; }` method to `FakeCodeEditor` ([Markdown.test.ts:779](../packages/lib/tests/component/display/Markdown.test.ts#L779)) so `applyCodeEditorUpgrade`'s new `.on("heightchange", ...)` call doesn't throw against the stand-in. Extend `FakeCodeEditor` to record the registered listener (e.g. `heightChangeListener: ((payload: { height: number }) => void) | null = null;` set inside `on()`). Add a test in the `'Markdown.applyCodeEditorUpgrade'` `describe` block: after calling `applyCodeEditorUpgrade`, invoke the captured `heightChangeListener` with a height, and assert (a) the wrapper's applied style height matches (spy on `DOM.sink.apply`, or read back via the recording sink's writes) and (b) `measureContentHeight` was called (spy on the private method). Check: full existing `Markdown.test.ts` suite stays green — the `FakeCodeEditor` change is additive.

11. **Manual verification.** Run the docs app (`npm run docs:dev`) and confirm, in a real browser, against a `Markdown` instance with fenced blocks covering: a short (2-3 line) block settles at its real content height with no scrollbar; a block with more than 20 lines caps at the 20-row height and shows CodeMirror's own vertical scrollbar; a block with one line wider than the column shows a horizontal scrollbar with the last content row fully visible above it (no overlap) and the box measurably taller than the no-scrollbar case; a block combining both (over 20 rows *and* a long line) stays capped at the 20-row height with both scrollbars working inside it. Resize the browser window (or toggle a side panel that changes `Markdown`'s width) and confirm a block's height re-settles correctly when a horizontal scrollbar appears or disappears as a result.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |

No changes to `theme.ts`, `languages.ts`, `LanguageRegistry.ts`, `MarkdownEditor.ts`, or `CodeEditorPanel.ts`.

---

## Expected Behaviour

- `new CodeEditor(...)` with no `autoHeightMaxRows`: `getAutoHeightMaxRows()` returns `null`; `syncAutoHeight()` (called directly) never calls `setHeight` or emits `"heightchange"`, matching every existing caller's fixed-height/fill-parent contract unchanged. **Unit-testable.**
- `autoHeightMaxRows` set, `_view` unset (the real offline contract — CodeMirror never mounts under the modelled DOM sink): `syncAutoHeight()` no-ops. **Unit-testable.**
- `autoHeightMaxRows` set, `_view` stubbed with `contentHeight` below the row cap and no horizontal overflow: `setHeight(contentHeight)` and `"heightchange"` fires with that value. **Unit-testable** (stubbed `_view`).
- Same, but `contentHeight` above the row cap: `setHeight` is called with the capped value (`maxRows * defaultLineHeight + documentPadding.top + documentPadding.bottom`), not the raw `contentHeight`. **Unit-testable.**
- `_scrollElement`'s `DOM.source.getScrollMetrics` reports `scrollWidth > clientWidth` (horizontal scrollbar showing): the desired height includes `DOM.source.getScrollBarWidth()` before the cap is applied. **Unit-testable.**
- Calling `syncAutoHeight()` twice with no change in any measured input is idempotent — the second call makes no further `setHeight`/`emit` calls (the `desired === this.getHeight()` guard). **Unit-testable.**
- `Markdown.applyCodeEditorUpgrade` constructs the editor with `autoHeightMaxRows: 20` and wires its `"heightchange"` to resize the wrapper and re-measure. **Unit-testable** via `FakeCodeEditor`'s captured listener (step 10).
- Real CodeMirror content-height measurement, the row cap's actual on-screen pixel behaviour, the horizontal-scrollbar-appears-without-clipping fix, and re-settling on a width change (a horizontal scrollbar appearing or disappearing after a resize): all **manual-verify only** — `CodeEditor` is live-only ([CodeEditor.ts:103-114](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L103)) and CodeMirror's own `ResizeObserver`-driven remeasure cannot be modelled offline.
- A fenced block with an unmapped language, or a `CodeEditor` built by any other caller (`MarkdownEditor`, `CodeEditorPanel`), is byte-for-byte unaffected — `autoHeightMaxRows` stays unset for both. **Unit-testable** (existing suites for both stay green with no changes to their construction call sites).

---

## Verification

- `npm run typecheck` (packages/lib) — zero errors, in particular the widened `CodeEditorEvent` overload set.
- `npm test` (packages/lib) — the new `code-editor.test.ts` and `Markdown.test.ts` cases from **Expected Behaviour**, plus the full existing suite green.
- `npm run docs:api` — zero warnings (the new exported `CodeEditorHeightChange` interface and `autoHeightMaxRows` field need JSDoc that satisfies the project's `{@link}`-to-public-symbols-only rule per [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md)).
- Manual smoke test per **Ordered Implementation Steps**, step 11.

---

## Documentation Impact

`CodeEditorOptions.autoHeightMaxRows`, `getAutoHeightMaxRows()`, and the `"heightchange"` event are new public API on an exported, documented class. Update [`packages/lib/docs/components/CodeEditor.md`](../packages/lib/docs/components/CodeEditor.md): add a row to the `## Construction` table (alongside `language`/`readOnly`) and a row to `## Common methods`. The changelog entry goes under `## Added` in [`packages/lib/docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md), in the existing `### Display` section (the fenced-code-highlighting entry already there is the natural place to extend, or a new entry immediately after it).

---

## Potential Challenges

- **CM6's initial constructor-time update is not documented to reliably invoke `updateListener`.** Mitigated by the explicit synchronous `syncAutoHeight()` call at the end of `mount()` (step 4) rather than relying on it.
- **A `setHeight()` this plan makes could, in principle, re-trigger CodeMirror's own `ResizeObserver`-driven remeasure indefinitely.** It converges in practice: `contentHeight` and the horizontal-overflow check both depend only on the document's content and the box's *width* (set independently by `Markdown`'s existing width-sync), not its height, so recomputing after a height-only change yields the same `desired` value and the `desired === this.getHeight()` guard stops the loop on the next pass.
- **A stray `"heightchange"` firing after the editor is disposed** could try to resize an already-released wrapper handle. Checked against `EditorView.destroy()`'s own implementation: it synchronously disconnects its `ResizeObserver` and cancels any pending scheduled remeasure frame before returning, and neither emits an `updateListener` call during teardown — so no post-`dispose()` emit is reachable. No extra guard added.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) — read in full before starting; `mount()` and the existing `EditorView.updateListener` extension are what this plan extends.
- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](../packages/lib/src/typescript/lib/component/display/Markdown.ts) — `applyCodeEditorUpgrade`, `syncCodeEditors`, `measureContentHeight`, and `clearContent` are the existing wrapper/lifecycle machinery this plan hooks into.
- [`plans/implemented/markdown-code-editor-highlighting.md`](implemented/markdown-code-editor-highlighting.md) — the plan that shipped the current wrapper/CodeEditor sizing this plan revises, including its own Non-Goal this plan reopens and the `onEffectiveVisibilityChange`/generation-token machinery that stays untouched.
- [`packages/lib/src/typescript/lib/core/Panel.ts`](../packages/lib/src/typescript/lib/core/Panel.ts) — `measureScrollbarGutter` ([Panel.ts:734](../packages/lib/src/typescript/lib/core/Panel.ts#L734)), the precedent this plan's horizontal-scrollbar detection mirrors.
- [`packages/lib/src/typescript/lib/core/themes/BaseTheme.ts`](../packages/lib/src/typescript/lib/core/themes/BaseTheme.ts) and [`packages/lib/src/typescript/lib/core/Theme.ts`](../packages/lib/src/typescript/lib/core/Theme.ts) — checked for an existing "row count" token shape (none found); the `markdown` namespace here is the only themed surface `Markdown.ts` already reads.
- [`packages/lib/tests/component/code-editor.test.ts`](../packages/lib/tests/component/code-editor.test.ts) — the offline-contract test file (`CodeEditor` mounts nothing under the modelled DOM sink); read its top-of-file comment before adding cases.
- [`packages/lib/tests/component/display/Markdown.test.ts`](../packages/lib/tests/component/display/Markdown.test.ts) — `FakeCodeEditor` ([Markdown.test.ts:779](../packages/lib/tests/component/display/Markdown.test.ts#L779)) is the structural stand-in this plan's tests extend.

---

## Non-Goals

- **No width reservation for CodeMirror's own vertical scrollbar.**[^no-vertical-width-reserve] A native scrollbar reserves its own track inside `.cm-scroller`'s normal `overflow` handling automatically — the reported bug is specifically that the *height* was fixed before a horizontal scrollbar was known to be needed, which has no width analogue here since `Markdown` never computes the wrapper's width as a tight content-fit snapshot the way it does height.
- **No runtime `setAutoHeightMaxRows()`.** Construction-time only; nothing requests toggling it after construction.
- **No auto-height for any other `CodeEditor` caller.** `MarkdownEditor` and the `CodeEditorPanel` demo keep their existing fixed-height, fill-parent contract; `autoHeightMaxRows` stays unset for both.
- **No horizontal-scrollbar reservation for a plain (non-auto-height) `CodeEditor`.** The fix lives inside `syncAutoHeight`, gated on `autoHeightMaxRows`; a fixed-height caller with the same theoretical clipping risk is a separate, unreported concern.
- **No change to which five languages are registered, or to CodeMirror's line-wrapping (still off — lines never wrap; this is what makes a horizontal scrollbar possible at all).**

---

## Notes

[^opt-in-not-flag]: This is a genuine, requested knob (the feature explicitly asks for a 20-row cap with scroll-over behaviour, which only `Markdown`'s fenced blocks need), unlike the `highlightCode` opt-out flag the shipped plan considered and declined for having no requester — see that plan's own `[^opt-in-rejected]` footnote. The two situations are different: that flag would have added configurability nobody asked for; this option is the mechanism the request is made of.

[^cm6-resize-observer]: Confirmed by reading `@codemirror/view`'s bundled source (`node_modules/@codemirror/view/dist/index.js`): `EditorView` constructs an internal `ResizeObserver` (`this.resizeObserver = ... measureSoon()`) that watches its own DOM for size changes, and the internal `measure()` pass this triggers calls every registered `updateListener` when the resulting `ViewUpdate` is non-empty — the same dispatch site a real transaction's update goes through. This is what lets `syncAutoHeight`'s own `setHeight()` calls be picked up and re-settled without any custom polling: resizing `CodeEditor`'s root triggers CodeMirror's own observer, which re-fires the update listener.

[^double-fire-safe]: `codeEditorTheme`'s chrome ([theme.ts:39](../packages/lib/src/typescript/lib/component/editor/theme.ts#L39)) is unconditional and shared by every `CodeEditor` instance regardless of `autoHeightMaxRows`; nothing in this plan reconfigures a theme compartment or touches `theme.ts`.

[^notify-intrinsic-doesnt-apply]: `Component.notifyIntrinsicSizeChanged()` ([Component.ts:5518](../packages/lib/src/typescript/lib/core/Component.ts#L5518)) relays through `_onPreferredSizeChange`/`_onConstraintSizeChange`, callbacks a parent installs in `wireChild` when a child is added via `addComponent`/`insertComponent`. `Markdown` never adds its `CodeEditor` children that way (see the shipped plan's own `[^why-not-addcomponent]` footnote on why `insertComponent` can't place a child at an arbitrary token-tree position), so those callbacks are never installed and calling `notifyIntrinsicSizeChanged()` from `CodeEditor` would be a silent no-op. The `"heightchange"` custom event is the correct substitute for an unwired raw-DOM child.

[^construction-only]: `CodeEditorOptions.value` is the closest existing precedent for a construction-oriented field: it has both a positional-argument shorthand and `setValue`, because live editors are genuinely re-set at runtime. `autoHeightMaxRows` has no analogous runtime use case in either caller this plan touches (`Markdown` always sets it once at construction; nothing reads or changes it afterward), so a setter is deferred until something asks for it, per CODE_CONVENTIONS.md's "no flexibility that wasn't requested."

[^no-vertical-width-reserve]: The width `Markdown` assigns a fenced block already comes from its prose column (`syncCodeEditors`' `wrapper.clientWidth` resync), which is sized generously relative to a monospace line, not fit tightly to it the way the row cap fits height. A vertical scrollbar's few reserved pixels have no established "content overlap" complaint anywhere in this codebase (every other scrolling container — `Panel`, `Table`, `Menu` — reserves it silently via the same `DOM.source.getScrollBarWidth()` seam this plan already uses for the horizontal case), so there is nothing to fix here beyond what `syncAutoHeight` already does.
