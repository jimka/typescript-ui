# DOM Seam — Scroll, Box-Model, Focus & Input Reads/Writes — Implementation Plan

## Overview

Extend the merged `DOMSink` / `DOMSource` seam ([core/DOM.ts](../src/typescript/lib/core/DOM.ts), documented in [docs/concepts/dom-seams.md](../docs/concepts/dom-seams.md)) to cover the remaining direct-element-access leak sites in two buckets that ship as **one** plan:

- **Bucket A — scroll position + box-model dimensions.** Native `scrollLeft`/`scrollTop` reads and writes, `scrollWidth`/`scrollHeight`/`clientWidth`/`clientHeight` reads, and `offsetTop`/`offsetHeight`/`isConnected` reads — concentrated in [Component.ts](../src/typescript/lib/core/Component.ts)'s scroll model, plus [Panel.ts](../src/typescript/lib/core/Panel.ts), [PickerColumn.ts](../src/typescript/lib/component/input/PickerColumn.ts), [AbstractCustomList.ts](../src/typescript/lib/component/list/AbstractCustomList.ts), and [FieldSet.ts](../src/typescript/lib/component/container/FieldSet.ts).
- **Bucket B — focus + input state.** Raw native `focus`/`blur` on elements that are *not* `Component`s, the `Component.focus()`/`Component.unfocus()` wrappers themselves (which become seam targets), and genuine `element.value` / `setSelectionRange` reads/writes in the input and table-cell-editor components.

Every new method mirrors the existing seam shape: production implementations are thin one-line pass-throughs ([ProductionDOMSink](../src/typescript/lib/core/DOM.ts#L241) / [ProductionDOMSource](../src/typescript/lib/core/DOM.ts#L332)), reads are synchronous and return plain data, writes are one-way (worker-forwardable). The test seam ([tests/dom/TestDOM.ts](../tests/dom/TestDOM.ts)) gains recording for the new writes and modelled answers for the new reads.

This is a **migration plus seam-API extension**, not a behavioural change: each production method does bit-for-bit what the inline access did today.

---

## Architecture Decisions

### The new reads and writes are **element-keyed**, not component-keyed

The existing seam splits geometry on ownership: `getViewportRect(component)` is derivable from committed component state (the oracle), so it is component-keyed; `getElementRect(element)` is the escape hatch for raw nodes that have no model. **Every read and write in this plan operates on a raw element that is either (a) the component's own root accessed *by element* inside a low-level primitive, or (b) a child/descendant element with no committed-geometry model** (`panelEl = _cellList.getElement()`, a `<legend>` box, a focusable descendant found by `querySelectorAll`). None of these are reproducible from the oracle: native scroll offset, scrollable overflow size, offset box, connection state, input value and selection are all live DOM facts, not layout-derivable. So they follow the `getElementRect(element)` precedent and take an `Element`/`HTMLElement`, not a `Component`. This keeps the production side a one-liner (`element.scrollLeft`) and lets the modelled source answer from recorded/zero state without reverse-mapping an element back to a component.

### The scroll-write read-back clamp is a **source read**, not baked into the sink

`setScrollLeft`/`setScrollTop`/`writeNativeScroll` today write then immediately read the browser-clamped result back into the cache:

```typescript
element.scrollLeft = value;
this._scrollLeft = element.scrollLeft;   // read back the clamped value
```

The sink method `setScrollLeft(element, value)` must stay **one-way** (no return value — it is the worker-forwardable write). So the read-back becomes a *separate* source read: `DOM.source.getScrollLeft(element)`. The migrated call site is:

```typescript
DOM.sink.setScrollLeft(element, value);
this._scrollLeft = DOM.source.getScrollLeft(element);
```

This preserves the exact clamp semantics: production `getScrollLeft(element)` returns `element.scrollLeft` (the clamped value the browser just settled on); the modelled sink records the requested write and the modelled source returns the *recorded* (unclamped) value, which is correct offline because there is no native clamp to model. The save/restore-around-reparent pattern in `setContentFrame`/`clearContentFrame` ([Component.ts:788-789/808-809](../src/typescript/lib/core/Component.ts#L788), [837-838/850-851](../src/typescript/lib/core/Component.ts#L837)) follows the same read-then-write shape — read via `getScrollLeft`/`getScrollTop`, write via `setScrollLeft`/`setScrollTop`.

### Grouped box-model reads return a **plain-data struct**, mirroring `Rect`

`getMaxScrollLeft`/`getMaxScrollTop` need `scrollWidth - clientWidth`; `Panel`'s overflow-reserve needs `scrollHeight > clientHeight`; `Panel.updateScrollShadows` destructures all six of `{scrollTop, scrollLeft, scrollWidth, scrollHeight, clientWidth, clientHeight}` off one element ([Panel.ts:615](../src/typescript/lib/core/Panel.ts#L615)). Rather than six single-property getters (six DOM round-trips, six sink/source methods), expose **one** `getScrollMetrics(element): ScrollMetrics` returning all six as plain numbers — matching how `Rect` boxes a `DOMRect`'s edges in one call. Production reads them off the element in one shot; the modelled source returns zeros (committed-geometry tests don't assert native overflow). `getOffsetSize(element)` likewise returns `{offsetTop, offsetHeight}` as plain data for the `PickerColumn` cell-centring read. `isConnected(element): boolean` is a standalone source predicate.

`PickerColumn.scrollSelectedIntoView` mixes both: it reads `cellEl.offsetTop`/`offsetHeight` (→ `getOffsetSize`) and `panelEl.clientHeight`/`scrollHeight` (→ `getScrollMetrics`) then writes `panelEl.scrollTop` (→ `setScrollTop`). All three route through the seam.

### `Component.focus()` / `Component.unfocus()` **become** the seam wrappers

The brief lists many `.focus()` call sites (`AutoCompleteField`, `DateField`, `AbstractPickerField`, the table cell editors, `Accordion`, `RovingTabIndex`, `Slider`, …). **Investigation shows these are NOT raw native focus** — their receivers are `Component`s (`_input: PickerInput`, `_textField: TextField`, `_headers: AccordionHeader[]`, `editor` a cell editor, `next` a roving item, `this`), so they already go through the `Component.focus(preventScroll)` wrapper ([Component.ts:3698](../src/typescript/lib/core/Component.ts#L3698)) / `Component.unfocus()` ([Component.ts:3715](../src/typescript/lib/core/Component.ts#L3715)). The single change those call sites need is **none** — they ride the seam automatically once the wrapper routes through it. The wrapper itself is the seam target: `element.focus({ preventScroll })` → `DOM.sink.focus(element, { preventScroll })`, `element.blur()` → `DOM.sink.blur(element)`. `RovingTabIndex.ts:126`'s `next.focus(this._preventScroll)` is a Component-wrapper call that forwards `preventScroll`; that flag flows through the wrapper into `DOM.sink.focus(element, { preventScroll })` unchanged — no `RovingTabIndex` edit.

The **only genuine raw-element focus/blur sites** are:
- [Dialog.ts:708/752/757/792](../src/typescript/lib/core/Dialog.ts#L708) — `focusable[0].focus()` / `last.focus()` / `first.focus()` / `(this._previousFocus as HTMLElement).focus()`, all on raw `HTMLElement`s found via `querySelectorAll` or `document.activeElement`.
- [table/cell/editor/Date.ts:198](../src/typescript/lib/component/table/cell/editor/Date.ts#L198) — `this.getElement()?.blur()`, a raw element blur (the only raw `.blur()` outside the `Component.unfocus()` wrapper).

These four Dialog calls and the one Date blur route through `DOM.sink.focus(element)` / `DOM.sink.blur(element)` directly.

### `setValue(element, v)` is a sink write; reads route through `getValue(element)`

`element.value` reads ([TextField.ts:87](../src/typescript/lib/component/input/TextField.ts#L87), [TextArea.ts:257](../src/typescript/lib/component/input/TextArea.ts#L257)) → `DOM.source.getValue(element)`. `element.value = …` writes ([FileField.ts:139](../src/typescript/lib/component/input/FileField.ts#L139), [TextInput.ts:450/663](../src/typescript/lib/component/input/TextInput.ts#L450), [table/cell/editor/Date.ts:87](../src/typescript/lib/component/table/cell/editor/Date.ts#L87), [DateTime.ts:104](../src/typescript/lib/component/table/cell/editor/DateTime.ts#L104), [Time.ts:89](../src/typescript/lib/component/table/cell/editor/Time.ts#L89)) → `DOM.sink.setValue(element, value)`. **`TextInput.ts:450` and `663` are extra value-write sites the brief did not enumerate** (verified live); both migrate. `setSelectionRange` ([TextInput.ts:578](../src/typescript/lib/component/input/TextInput.ts#L578)) → `DOM.sink.setSelectionRange(element, start, end)`.

### No `getSelectionStart` / `getSelectionEnd` — there are no callers

The brief floated `getSelectionStart/End` source methods. A full sweep (`grep selectionStart|selectionEnd`) finds **zero** read sites — only the one `setSelectionRange` write. Per Simplicity First, those two source methods are **not** added; adding them would be speculative API for no call site.

### `FieldSet.legendClearance` stays a documented holdout, now reading through the seam

[FieldSet.ts:209-210](../src/typescript/lib/component/container/FieldSet.ts#L209) already short-circuits on `DOM.source.isModelled()` ([FieldSet.ts:203](../src/typescript/lib/component/container/FieldSet.ts#L203)) and falls back to `LEGEND_CLEARANCE_FALLBACK` offline — so it is *already* offline-safe. The remaining inline reads (`element.isConnected`, `element.offsetHeight`) run only on the production (non-modelled) path. The brief lists this site for routing; route it through `DOM.source.isConnected(element)` and `DOM.source.getOffsetSize(element)` so **all** raw element reads funnel through the seam uniformly (the grep stays clean), while the existing `isModelled()` short-circuit remains the documented holdout that spares the modelled source from inventing a legend box. This is the lone Bucket-A site where the production-only nature is already handled by an upstream guard rather than the seam method itself.

`Component.getBorderSize`'s `element.isConnected` read ([Component.ts:2333](../src/typescript/lib/core/Component.ts#L2333)) is **excluded** — it sits inside the already-documented `getComputedStyle(element)` production-only holdout from the prior plan (dom-seams.md "Documented production-only holdouts"), and routing only its `isConnected` while leaving the adjacent `getComputedStyle` raw would split one holdout across two regimes. It stays raw, noted in Non-Goals.

### Production stays a thin pass-through; the JIT-sensitive scroll path is unchanged shape

Each new `ProductionDOMSink`/`ProductionDOMSource` method is a one-liner — `setScrollLeft(e,v)` is `e.scrollLeft = v`, `getScrollLeft(e)` is `return e.scrollLeft`, `focus(e,o)` is `e.focus(o)`, `setValue(e,v)` is `(e as HTMLInputElement).value = v`. The MiscPanel slow-table perf path touches `setScrollLeft`/`getScrollMetrics` on the wheel/scroll loop; because the methods are monomorphic singletons (same as the existing `setStyle`/`getViewportRect`), the JIT inlines them and the indirection is free. The grouped `getScrollMetrics` actually *reduces* round-trips at `Panel.updateScrollShadows` (one call vs six property reads).

### Convention compliance: `~/` alias, `.js` extensions, plain-data returns

All new imports use the `~/core/DOM.js` alias form already in the cell-editor and input files. Return shapes (`ScrollMetrics`, `OffsetSize`) are plain interfaces of `number`s exported from `core/DOM.ts` alongside `Rect` — no live DOM node ever leaves a source method (worker constraint). Sink methods return `void` (one-way).

---

## Public API (TypeScript Signatures)

Added to [core/DOM.ts](../src/typescript/lib/core/DOM.ts), exported from the core barrel ([core/index.ts:11-12](../src/typescript/lib/core/index.ts#L11)).

```typescript
/** Plain box-model snapshot — the native scroll/overflow/viewport sizes of an
 *  element, read in one shot. Never a live element. */
export interface ScrollMetrics {
    scrollTop:    number;
    scrollLeft:   number;
    scrollWidth:  number;
    scrollHeight: number;
    clientWidth:  number;
    clientHeight: number;
}

/** Plain offset-box snapshot — an element's position/size within its
 *  offsetParent. */
export interface OffsetSize {
    offsetTop:    number;
    offsetHeight: number;
}

export interface DOMSink {
    // …existing…
    /** Sets the element's native horizontal scroll offset (one-way; read the
     *  browser-clamped result back via DOMSource.getScrollLeft). */
    setScrollLeft(element: Element, value: number): void;
    /** Sets the element's native vertical scroll offset. */
    setScrollTop(element: Element, value: number): void;
    /** Moves browser focus to the element. */
    focus(element: HTMLElement, options?: { preventScroll?: boolean }): void;
    /** Removes browser focus from the element. */
    blur(element: HTMLElement): void;
    /** Writes the value of a form control. */
    setValue(element: HTMLElement, value: string): void;
    /** Sets the text-selection range of a form control. */
    setSelectionRange(element: HTMLElement, start: number, end: number): void;
}

export interface DOMSource {
    // …existing…
    /** Reads the element's native horizontal scroll offset (browser-clamped). */
    getScrollLeft(element: Element): number;
    /** Reads the element's native vertical scroll offset (browser-clamped). */
    getScrollTop(element: Element): number;
    /** Reads the element's scroll/overflow/viewport box sizes in one shot. */
    getScrollMetrics(element: Element): ScrollMetrics;
    /** Reads the element's offset-box position and height. */
    getOffsetSize(element: Element): OffsetSize;
    /** Whether the element is attached to a document. */
    isConnected(element: Element): boolean;
    /** Reads the value of a form control. */
    getValue(element: HTMLElement): string;
}
```

`ProductionDOMSink` / `ProductionDOMSource` implement each as the verbatim inline access. The form-control methods cast through `HTMLInputElement` where `.value` requires it (`(element as HTMLInputElement).value`), matching the existing `as HTMLInputElement` casts at the call sites.

Test seam ([tests/dom/TestDOM.ts](../tests/dom/TestDOM.ts)):

```typescript
export class RecordingDOMSink implements DOMSink {
    // …existing record() calls… plus:
    setScrollLeft(element, value)      { this.record('setScrollLeft', value); /* also update stub.scrollLeft */ }
    setScrollTop(element, value)       { this.record('setScrollTop', value); }
    focus(element, options)            { this.record('focus', options); }
    blur(element)                      { this.record('blur'); }
    setValue(element, value)           { this.record('setValue', value); }
    setSelectionRange(element, s, e)   { this.record('setSelectionRange', s, e); }
}

export class ModelledDOMSource implements DOMSource {
    // …existing… plus reads answered from cache/zero:
    getScrollLeft(element): number     { return (element as any).scrollLeft ?? 0; }   // recorded stub value or 0
    getScrollTop(element): number      { return (element as any).scrollTop ?? 0; }
    getScrollMetrics(element)           { return { scrollTop:0, scrollLeft:0, scrollWidth:0, scrollHeight:0, clientWidth:0, clientHeight:0 }; }
    getOffsetSize(element)              { return { offsetTop: 0, offsetHeight: 0 }; }
    isConnected(element): boolean       { return false; }
    getValue(element): string           { return (element as any).value ?? ''; }
}
```

The `makeStubElement` stub already carries `scrollLeft: 0`, `scrollTop: 0`, `isConnected: false` ([TestDOM.ts:54-64](../tests/dom/TestDOM.ts#L54)); add a `value: ''` field so `getValue`/`setValue` round-trip on the stub. The modelled source reading the recorded write back off the stub keeps the scroll read-back clamp consistent offline (the recorded value, since there is no native clamp).

---

## Ordered Implementation Steps

1. **Extend `core/DOM.ts` interfaces.** Add `ScrollMetrics` and `OffsetSize` interfaces, the six `DOMSource` methods and six `DOMSink` methods above (with JSDoc mirroring the existing entries' style). → verify: `npm run typecheck` flags every unimplemented production method.

2. **Implement `ProductionDOMSink` / `ProductionDOMSource` methods** as one-line pass-throughs (`e.scrollLeft = v`; `return e.scrollLeft`; `e.focus(options)`; `e.blur()`; `(e as HTMLInputElement).value = v`; `return (e as HTMLInputElement).value`; `e.setSelectionRange(s,e)`; the six-field `getScrollMetrics` destructure; `{offsetTop, offsetHeight}`; `e.isConnected`). → verify: `npm run typecheck` clean.

3. **Export new types from the core barrel.** Add `ScrollMetrics`, `OffsetSize` to the `export type { … } from '~/core/DOM.js'` line ([core/index.ts:12](../src/typescript/lib/core/index.ts#L12)). → verify: typecheck.

4. **Migrate Component.ts scroll model.** Route through the seam:
   - `setScrollLeft` ([2836-2837](../src/typescript/lib/core/Component.ts#L2836)) / `setScrollTop` ([2859-2860](../src/typescript/lib/core/Component.ts#L2859)) — `DOM.sink.setScroll{Left,Top}` then read back via `DOM.source.getScroll{Left,Top}`.
   - `syncScrollOffsets` ([2885-2886](../src/typescript/lib/core/Component.ts#L2885)) — reads via `DOM.source.getScroll{Left,Top}`.
   - cached scroll API `read` callback ([3177](../src/typescript/lib/core/Component.ts#L3177)) — `DOM.source.getScroll{Left,Top}` (preserve the `?? 0` null-element guard around `getElement()`).
   - `writeNativeScroll` ([3210-3214](../src/typescript/lib/core/Component.ts#L3210)) — sink write + source read-back per axis.
   - save/restore around reparent in `setContentFrame` ([788-789/808-809](../src/typescript/lib/core/Component.ts#L788)) and `clearContentFrame` ([837-838/850-851](../src/typescript/lib/core/Component.ts#L837)) — read via source, write via sink.
   - `getMaxScrollLeft` ([2901](../src/typescript/lib/core/Component.ts#L2901)) / `getMaxScrollTop` ([2913](../src/typescript/lib/core/Component.ts#L2913)) — `DOM.source.getScrollMetrics(element)` then `m.scrollWidth - m.clientWidth` / `m.scrollHeight - m.clientHeight`.
   - `Component.focus` ([3705](../src/typescript/lib/core/Component.ts#L3705)) → `DOM.sink.focus(element, { preventScroll })`; `Component.unfocus` ([3722](../src/typescript/lib/core/Component.ts#L3722)) → `DOM.sink.blur(element)`.
   → verify: typecheck; app scrolls/focuses identically; MiscPanel table wheel-scroll smooth.

5. **Migrate Panel.ts.** `overflow-reserve` ([469-470](../src/typescript/lib/core/Panel.ts#L469)) and `updateScrollShadows` destructure ([615](../src/typescript/lib/core/Panel.ts#L615)) both via one `DOM.source.getScrollMetrics(el)` call, reading the needed fields off the returned struct. → verify: scroll shadows + gutter reservation render correctly on an `autoScroll` panel.

6. **Migrate PickerColumn.ts** ([349-356](../src/typescript/lib/component/input/PickerColumn.ts#L349)) — `cellEl` offset via `DOM.source.getOffsetSize`, `panelEl` sizes via `DOM.source.getScrollMetrics`, write `panelEl.scrollTop` via `DOM.sink.setScrollTop`. → verify: picker centres the selected cell.

7. **Migrate AbstractCustomList.ts** ([1374-1380](../src/typescript/lib/component/list/AbstractCustomList.ts#L1374)) — `panelEl.scrollTop`/`clientHeight` reads via `getScrollMetrics`, `scrollTop` writes via `setScrollTop`. → verify: list scroll-index-into-view works.

8. **Migrate FieldSet.ts** ([209-210](../src/typescript/lib/component/container/FieldSet.ts#L209)) — `element.isConnected` → `DOM.source.isConnected(element)`, `element.offsetHeight` → `DOM.source.getOffsetSize(element).offsetHeight`. Leave the upstream `isModelled()` short-circuit untouched. → verify: fieldset legend clearance renders; offline path still returns the fallback.

9. **Migrate Dialog.ts focus** ([708/752/757/792](../src/typescript/lib/core/Dialog.ts#L708)) — each raw `HTMLElement.focus()` → `DOM.sink.focus(el)`. → verify: dialog focus-trap (Tab/Shift-Tab wrap, focus-first, focus-restore on close) works.

10. **Migrate input value/selection sites.** `TextField`/`TextArea` `element.value` read → `DOM.source.getValue` (add `~/core/DOM.js` import). `FileField.ts:139`, `TextInput.ts:450/663` `value=` writes → `DOM.sink.setValue`. `TextInput.ts:578` → `DOM.sink.setSelectionRange`. → verify: typing syncs, file-clear works, programmatic text set + caret placement work.

11. **Migrate table cell editors.** `editor/Date.ts:87`, `DateTime.ts:104`, `Time.ts:89` `el.value = text` → `DOM.sink.setValue` (add DOM import to each); `editor/Date.ts:198` `getElement()?.blur()` → `DOM.sink.blur`. → verify: date/time/datetime cell editors populate and commit-on-blur.

12. **Verification greps** (see Verification). → expect the scroll/focus/value/offset patterns to return zero outside `core/DOM.ts` and the documented exclusions.

13. **Test seam — RecordingDOMSink.** Add the six write methods recording `{op,args}`; have `setScrollLeft`/`setScrollTop` also write the value onto the stub (`(element as any).scrollLeft = value`) and `setValue` onto `stub.value` so the modelled read-back matches. Add `value: ''` to `makeStubElement` ([TestDOM.ts:54](../tests/dom/TestDOM.ts#L54)). → verify: smoke test asserts a recorded `setScrollLeft` / `setValue`.

14. **Test seam — ModelledDOMSource.** Add the six read methods: `getScroll{Left,Top}` read off the stub (recorded value) defaulting 0; `getScrollMetrics`/`getOffsetSize` return zeros; `isConnected` returns false; `getValue` reads the stub value. → verify: an offline test sets scroll via the recording sink and reads it back through the modelled source.

15. **Docs.** Update [docs/concepts/dom-seams.md](../docs/concepts/dom-seams.md) (new method list + the focus-wrapper / read-back-clamp notes) and the verification-grep inventory in the style of [plans/implemented/dom-sink-source.md](implemented/dom-sink-source.md). Optionally add the Non-Goals boundary note to [ARCHITECTURE.md](../ARCHITECTURE.md). → verify: `npm run docs:build` 0 errors / 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/DOM.ts` (new interfaces + sink/source methods + production impls) |
| Modify | `src/typescript/lib/core/index.ts` (export `ScrollMetrics`, `OffsetSize`) |
| Modify | `src/typescript/lib/core/Component.ts` (scroll model + focus/unfocus wrappers) |
| Modify | `src/typescript/lib/core/Panel.ts` (overflow-reserve + scroll shadows via `getScrollMetrics`) |
| Modify | `src/typescript/lib/core/Dialog.ts` (4 raw focus sites) |
| Modify | `src/typescript/lib/component/input/PickerColumn.ts` (offset/metrics/scrollTop) |
| Modify | `src/typescript/lib/component/list/AbstractCustomList.ts` (scrollTop/clientHeight) |
| Modify | `src/typescript/lib/component/container/FieldSet.ts` (isConnected/offsetHeight) |
| Modify | `src/typescript/lib/component/input/TextField.ts` (value read; add DOM import) |
| Modify | `src/typescript/lib/component/input/TextArea.ts` (value read) |
| Modify | `src/typescript/lib/component/input/TextInput.ts` (value writes 450/663 + setSelectionRange) |
| Modify | `src/typescript/lib/component/input/FileField.ts` (value clear write) |
| Modify | `src/typescript/lib/component/table/cell/editor/Date.ts` (value write + raw blur; add DOM import) |
| Modify | `src/typescript/lib/component/table/cell/editor/DateTime.ts` (value write; add DOM import) |
| Modify | `src/typescript/lib/component/table/cell/editor/Time.ts` (value write; add DOM import) |
| Modify | `tests/dom/TestDOM.ts` (record new writes; model new reads; stub `value` field) |
| Modify | `docs/concepts/dom-seams.md` (new methods + notes) |
| Modify | `ARCHITECTURE.md` (optional Non-Goals boundary note) |

---

## Verification

- `npm run typecheck` — clean.
- **Scroll discipline.** `grep -rnE '\.(scrollLeft|scrollTop|scrollWidth|scrollHeight|clientWidth|clientHeight)\b' src/typescript/lib --include=*.ts | grep -v 'core/DOM.ts\|core/Util.ts' | grep -vE ':[0-9]+:[[:space:]]*(//|\*)' | grep -vE '_scrollLeft|_scrollTop'` — zero. (`core/DOM.ts` holds the production pass-throughs; `core/Util.ts:451-452` is the already-seamed viewport read inside `getViewportSize`; the `_scroll*` exclusion drops the private cache fields.)
- **Offset / connection discipline.** `grep -rnE '\.(offsetTop|offsetHeight|isConnected)\b' src/typescript/lib --include=*.ts | grep -v 'core/DOM.ts' | grep -vE ':[0-9]+:[[:space:]]*(//|\*)'` — only the documented holdout `Component.getBorderSize`'s `element.isConnected` at [Component.ts:2333](../src/typescript/lib/core/Component.ts#L2333) (inside the existing `getComputedStyle` holdout) and the `Util.getScrollBarWidth` bootstrap's `inn.offsetWidth` at Util.ts:498/504 (already-seamed `getScrollBarWidth`).
- **Focus / blur discipline.** `grep -rnE '\.(focus|blur)\(' src/typescript/lib --include=*.ts | grep -v 'core/DOM.ts\|DOM\.sink\.' | grep -vE ':[0-9]+:[[:space:]]*(//|\*)'` — only `Component.focus`/`unfocus` wrappers route through `DOM.sink.focus`/`blur` (dropped by `DOM\.sink\.`); the remaining hits are **Component-wrapper** calls (`this.focus()`, `x.focus()` where `x` is a `Component`), which are the sanctioned typed layer above the seam, not raw element writes. No raw `element.focus(`/`element.blur(` survives. (`ComboBox.ts:163` is a JSDoc-prose match, dropped by the comment filter.)
- **Value / selection discipline.** `grep -rnE '\b(element|el|input|node)\.value\b\s*=|\.setSelectionRange\(' src/typescript/lib --include=*.ts | grep -v 'core/DOM.ts\|DOM\.sink\.' | grep -vE ':[0-9]+:[[:space:]]*(//|\*)'` — zero raw value writes / selection sets; reads via `DOM.source.getValue`. (`descriptor.value` / `track.value` / `opts.value` are not `element`/`el`/`input`/`node` receivers, so they never match.)
- `npm run test:lint` — existing ESLint-rule tests still pass.
- App renders/behaves identically across demo screens; focus, scroll, and input on the picker, date/time cell editors, file field, dialog focus-trap, and accordion all work.
- MiscPanel slow table: wheel/scroll benchmark unmoved with DevTools open (the perf-sensitive path).
- `npm run docs:build` — 0 errors, 0 link warnings (typedoc TS-version notice excepted).
- Offline (test seam): a check sets `setScrollLeft` via the recording sink and reads it back through the modelled source; a `setValue`/`getValue` round-trip on the stub; `DOM.reset()` restores production.

---

## Documentation Impact

- `ScrollMetrics` and `OffsetSize` are new exported core interfaces from [core/index.ts](../src/typescript/lib/core/index.ts); the new `DOMSink`/`DOMSource` methods extend already-exported interfaces (no new top-level symbols beyond the two interfaces).
- [docs/concepts/dom-seams.md](../docs/concepts/dom-seams.md) gains: the new method list under the `DOM.sink` / `DOM.source` bullets; a note that `Component.focus()`/`unfocus()` are the focus seam wrappers (so component-level focus rides the seam); the read-back-clamp note (scroll write is one-way, the clamped value is re-read via `getScrollLeft`); and the extended verification-grep inventory.
- Update the curated concept page's catalog entry if the method summary changes; no new sidebar page (extends an existing concept page).
- No JSDoc cross-bucket `{@link}` issues — all new symbols live in `core`.

---

## Potential Challenges

- **Read-back-clamp fidelity offline** — the modelled source must return the *recorded* scroll value (no native clamp); mitigation: the recording sink writes the value onto the stub and the modelled `getScrollLeft` reads it back, so write-then-read is consistent.
- **`getScrollMetrics` over-fetch** — returning six fields where a caller needs two is a micro-cost; mitigation: it is one DOM round-trip either way, and `Panel.updateScrollShadows` already reads all six, so the grouped read is a net win.
- **Form-control casts** — `.value` requires an `HTMLInputElement`/`HTMLTextAreaElement` cast that the call sites already do; mitigation: the production method casts internally (`element as HTMLInputElement`), keeping the cast out of call sites where it isn't already present.
- **Brief mis-classification of focus sites** — the brief lists Component-wrapper `.focus()` calls as raw native; mitigation: only the wrapper + the 4 Dialog + 1 Date-blur raw sites are migrated, and the focus-discipline grep proves no raw `element.focus(` remains.

---

## Critical Files

- [core/DOM.ts](../src/typescript/lib/core/DOM.ts) — the seam to extend; existing `DOMSink`/`DOMSource`/`Rect`/`Production*` shape and JSDoc to mirror exactly.
- [core/Component.ts](../src/typescript/lib/core/Component.ts) — scroll model (`setScrollLeft` 2830, `setScrollTop` 2853, `syncScrollOffsets` 2879, `getMaxScrollLeft/Top` 2898/2910, cached scroll API 3175-3216, content-frame reparent 788/837), focus wrappers (`focus` 3698, `unfocus` 3715), and the `getBorderSize` `isConnected` holdout (2333).
- [tests/dom/TestDOM.ts](../tests/dom/TestDOM.ts) — `RecordingDOMSink`/`ModelledDOMSource`/`makeStubElement`/`installTestDOM` structure to extend; the stub already carries `scrollLeft`/`scrollTop`/`isConnected`.
- [docs/concepts/dom-seams.md](../docs/concepts/dom-seams.md) and [plans/implemented/dom-sink-source.md](implemented/dom-sink-source.md) — the documentation + verification-grep style to match.
- [core/Panel.ts](../src/typescript/lib/core/Panel.ts) — `updateScrollShadows` (609) is the one site that needs all six `ScrollMetrics` fields.

---

## Non-Goals

- **Re-seaming `Component.getBorderSize`'s `isConnected`/`getComputedStyle` read** — it is part of the prior plan's documented production-only computed-style holdout; splitting one of its reads onto the new seam while the adjacent `getComputedStyle` stays raw would fracture a single holdout. Left raw, grep-excluded.
- **`getSelectionStart` / `getSelectionEnd` source methods** — no call sites exist; not added (speculative API).
- **`addEventListener` / `removeEventListener`** — the `Event` system and the legit low-level native hooks in `Tooltip`/`Popover`/`Animation`/`Glyph`/`Event` stay outside the seam (deliberate, not oversight).
- **DOM traversal** — `querySelector`/`querySelectorAll`/`contains`/`closest`/`matches`/`parentElement`/`parentNode` are read-only structural navigation, not measurement or mutation; deliberately un-seamed (e.g. `Dialog.getFocusable`'s `querySelectorAll` stays raw; only the resulting elements' `.focus()` is seamed).
- **`getComputedStyle` holdouts** — the 8 documented holdouts from the prior plan are unchanged.
- **`scrollIntoView` / `scrollTo`** — native imperative scroll-into-view helpers are not part of the cached scroll model; deliberately un-seamed.
- **Worker transport** — the seam stays *shaped* for it (one-way writes, plain-data reads, no live-node returns) but no transport is built.
