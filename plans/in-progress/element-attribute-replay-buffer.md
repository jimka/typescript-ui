# Element-Attribute Replay Buffer — Implementation Plan

## Overview

`Component.setElementAttribute` ([packages/lib/src/typescript/lib/core/Component.ts:1247](packages/lib/src/typescript/lib/core/Component.ts#L1247)) writes straight to the DOM element and returns early when there is no element yet. An attribute set while the component is detached — during construction, before `init()` / `render()` — is silently dropped. `removeElementAttribute` ([Component.ts:1269](packages/lib/src/typescript/lib/core/Component.ts#L1269)) has the same shape.

This plan gives both methods a cached `Map` that `init()` replays onto the element, mirroring what `Component` already does for `data-*` attributes through `_attributes` ([Component.ts:338](packages/lib/src/typescript/lib/core/Component.ts#L338), replayed at [Component.ts:5266](packages/lib/src/typescript/lib/core/Component.ts#L5266)). Because `init()` runs on every `render()`, the cache also makes attributes survive an element being released and rebuilt.

The change is confined to `Component.ts` plus one new test file. `setElementAttribute` is `protected`, so no public API moves.

---

## Architecture Decisions

### The buffer mirrors the existing `_attributes` map

`setElementAttribute` gets a private `Map<string, string>` named `_elementAttributes`, assigned in the constructor body next to `_attributes` ([Component.ts:476](packages/lib/src/typescript/lib/core/Component.ts#L476)), and drained into the `setAttr` record `init()` already builds ([Component.ts:5264](packages/lib/src/typescript/lib/core/Component.ts#L5264)). This is the same mechanism `setDataAttribute` / `delDataAttribute` ([Component.ts:1512](packages/lib/src/typescript/lib/core/Component.ts#L1512), [Component.ts:1537](packages/lib/src/typescript/lib/core/Component.ts#L1537)) already uses: write the map, then write the element if it exists.[^precedent]

The constructor-body assignment is required, not stylistic: `applyOptions` runs inside `super()` and dispatches setters that call `setElementAttribute` (`TextInput.setType`, `Video.setSrc`), so a class-field initializer would run afterwards and wipe the map.[^cascade]

### The buffer is never cleared at render

`init()` reads the map and leaves it in place, so a second `render()` replays the same entries onto the new element. Nothing else is needed for the release-and-rebuild case: `getElement(true)` re-materialises through `render()` → `init()` whenever `_element` is unset ([Component.ts:863](packages/lib/src/typescript/lib/core/Component.ts#L863)).

### The buffer owns exactly the keys written through `setElementAttribute`

No key is excluded and no other write path is captured. `setDataAttribute` keeps its own `_attributes` map, `Aria` keeps its own cache and its own `applyToElement` replay ([Component.ts:5284](packages/lib/src/typescript/lib/core/Component.ts#L5284)), and the `attributes` options bag keeps being replayed from `_options.attributes` ([Component.ts:5276](packages/lib/src/typescript/lib/core/Component.ts#L5276)). ARIA writes reach the element through `applyAriaAttribute` → `setElementAttribute` ([Component.ts:3961](packages/lib/src/typescript/lib/core/Component.ts#L3961)), so they land in the buffer *as well as* in `Aria`'s map; both replays write the same value, so the duplication is harmless and no de-duplication is added.[^aria]

### Buffer entries win over the other attribute sources

`init()` merges the four sources into one `setAttr` record in this order: `_attributes` (data-`*`), `_disabledAttribute`, `_options.attributes`, then `_elementAttributes`. Last write wins, so a runtime typed-setter call beats a construction-time `attributes` bag entry for the same key.[^precedence]

| Sequence | Sources holding the key | Value after render |
|---|---|---|
| `setDataAttribute("insets", "0,0,0,0")` | `_attributes` | `data-insets="0,0,0,0"` |
| `new TextInput({ attributes: { placeholder: "a" } })`, then `setPlaceholder("b")`, then re-render | `_options.attributes` = `a`, buffer = `b` | `placeholder="b"` |
| `setDisabledAttribute(true)` | `_disabledAttribute` and buffer, both `""` | `disabled=""` |
| `setPlaceholder("x")` then `clearPlaceholder()` while detached | buffer entry added then deleted | attribute absent |

### `init()` adds the framework class name after the attribute replay

The `addClass` call at [Component.ts:5252](packages/lib/src/typescript/lib/core/Component.ts#L5252) moves to just after the `DOM.sink.apply(element, { setAttr })` call. `AbstractSelectableList` writes a whole `class` attribute through `setElementAttribute` ([AbstractSelectableList.ts:564](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L564)); replaying that buffered `class` after `addClass` would overwrite the class name `init()` just added. Reordering makes the framework class name survive any `class` replay, from the buffer or from the `attributes` bag.[^classorder]

---

## Public API

None. `setElementAttribute` and `removeElementAttribute` are `protected` and keep their signatures. No new option, no new exported symbol.

---

## Internal Structure

Field declaration, beside `_attributes` at [Component.ts:338](packages/lib/src/typescript/lib/core/Component.ts#L338):

```typescript
// Every attribute written through setElementAttribute, cached so init() can
// replay it onto a freshly created element. Assigned in the constructor body
// (not a field initializer) because applyOptions dispatches setters that write
// it from inside super().
private _elementAttributes: Map<string, string>;
```

Setter bodies:

```typescript
protected setElementAttribute(key: string, value: Object | null | undefined): this {
    if (value === null || value === undefined) {
        return this.removeElementAttribute(key);
    }

    const stringValue = String(value);

    this._elementAttributes.set(key, stringValue);

    let element = this.getElement();
    if (element) {
        DOM.sink.apply(element, { setAttr: { [key]: stringValue } });
    }

    return this;
}

protected removeElementAttribute(key: string): this {
    this._elementAttributes.delete(key);

    let element = this.getElement();
    if (element) {
        DOM.sink.apply(element, { removeAttr: [key] });
    }

    return this;
}
```

Replay, appended to the record `init()` builds so buffer entries overwrite the earlier sources:

```typescript
for (const [key, value] of this._elementAttributes) {
    setAttr[key] = value;
}
```

---

## Ordered Implementation Steps

1. **Write the failing tests first.** New file `packages/lib/tests/core/ElementAttributeReplay.test.ts`, covering every case in `## Expected Behaviour`. Follow the harness shape of [packages/lib/tests/component/display/Video.test.ts:1-36](packages/lib/tests/component/display/Video.test.ts#L1) — `installTestDOM(CONFIG)` in `beforeEach`, `DOM.reset()` in `afterEach`, and a fold over `sink.writes` for the assertions. Extend that file's `lastAttr` helper ([Video.test.ts:22](packages/lib/tests/component/display/Video.test.ts#L22)) so it also honours `removeAttr`, and scope it to one handle:

   ```typescript
   /** Folds every apply patch for `handle` into the attribute state it produces. */
   const attrsOf = (recorder: Recorder, handle: unknown): Record<string, string> => {
       const attrs: Record<string, string> = {};

       for (const w of recorder.writes) {
           if (w.op !== 'apply' || w.args[0] !== handle) continue;

           const patch = w.args[1] as { setAttr?: Record<string, string>; removeAttr?: string[] };

           for (const key of patch.removeAttr ?? []) delete attrs[key];
           for (const key of Object.keys(patch.setAttr ?? {})) attrs[key] = patch.setAttr![key];
       }

       return attrs;
   };
   ```

   Reach `setElementAttribute` from the test through a local subclass that re-exposes the protected methods and `render()`:

   ```typescript
   class Probe extends _Component {
       setAttr(key: string, value: Object | null): this { return this.setElementAttribute(key, value); }
       delAttr(key: string): this { return this.removeElementAttribute(key); }
       rerender(): Handle { return this.render(); }
   }
   ```

   Import the unwrapped class as `_Component` from `~/core/Component` — the callable export routes construction through a Proxy and is not the right base for a subclass that only exists in a test.

   Verify: `npm test -- ElementAttributeReplay` — the detached-write and re-render tests fail, the after-render tests pass.

2. **Declare the field.** Add `private _elementAttributes: Map<string, string>;` immediately after `private _attributes: Map<string, string>;` ([Component.ts:338](packages/lib/src/typescript/lib/core/Component.ts#L338)), with the comment from `## Internal Structure`. No initializer.

3. **Assign it in the constructor body.** Add `this._elementAttributes = new Map<string, string>();` immediately after [Component.ts:476](packages/lib/src/typescript/lib/core/Component.ts#L476). Verify: the assignment sits above the `this.applyOptions(...)` call at the end of the constructor.

4. **Buffer the writes.** Replace the bodies of `setElementAttribute` ([Component.ts:1247](packages/lib/src/typescript/lib/core/Component.ts#L1247)) and `removeElementAttribute` ([Component.ts:1269](packages/lib/src/typescript/lib/core/Component.ts#L1269)) with the versions in `## Internal Structure`. The early `return this` on a missing element goes away in both — only the DOM write is conditional now.

5. **Rewrite the `@remarks` on `setElementAttribute`.** The current text ([Component.ts:1241-1246](packages/lib/src/typescript/lib/core/Component.ts#L1241)) states the method is write-through with no internal cache and tells subclasses to cache and replay themselves. Replace it with a statement that the value is cached and replayed by `init()` on every render, and that `removeElementAttribute` drops the cached entry. Add a matching one-line `@remarks` to `removeElementAttribute`.

6. **Replay in `init()`.** In [Component.ts:5245](packages/lib/src/typescript/lib/core/Component.ts#L5245), after the `_options.attributes` loop and before `DOM.sink.apply(element, { setAttr })`, append the `_elementAttributes` loop from `## Internal Structure`. Do not clear the map.

7. **Move the `addClass` call.** Cut `DOM.sink.apply(element, { addClass: [this.constructor.name] });` from [Component.ts:5252](packages/lib/src/typescript/lib/core/Component.ts#L5252) and paste it directly after `DOM.sink.apply(element, { setAttr });`. Leave `DOM.sink.setId` and `this._inlineStyle.attach(element)` where they are. Verify: `npm test` — the whole suite, since class names drive CSS class rules across many tests.

8. **Correct the now-false comments in the six classes that hand-roll a replay.** `grep -rn "write-through\|no-op before the element exists\|is a no-op on the DOM" packages/lib/src/typescript/lib/` returns comment text in `TextInput.ts`, `TextArea.ts`, `Video.ts`, `FileField.ts`, `MarkdownEditor.ts`, and `TextInputCellEditor.ts` asserting that `setElementAttribute` drops detached writes. Fix only those sentences — say the base class now caches and replays, and that the local `init()` replay is redundant but retained. **Do not delete any subclass `init()` override or backing field** (see `## Non-Goals`).

9. **Full verification.** Run the `## Verification` checks.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/core/ElementAttributeReplay.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TextInput.ts` (comment only) |
| Modify | `packages/lib/src/typescript/lib/component/input/TextArea.ts` (comment only) |
| Modify | `packages/lib/src/typescript/lib/component/input/FileField.ts` (comment only) |
| Modify | `packages/lib/src/typescript/lib/component/display/Video.ts` (comment only) |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` (comment only) |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/TextInputCellEditor.ts` (comment only) |

---

## Expected Behaviour

All cases are unit-testable offline against the recording sink — detached construction and re-render both run with no browser. Assert through the `attrsOf` fold over `sink.writes`, never through `getElementAttribute`: the modelled read source's `getAttribute` is a null stub offline ([packages/lib/tests/dom/TestDOM.ts:1056](packages/lib/tests/dom/TestDOM.ts#L1056)).

| # | Case | Expected |
|---|---|---|
| 1 | **Set before render.** `p.setAttr("contenteditable", "true")` on a component with no element, then `p.getElement(true)`. | The element is created with `contenteditable="true"`. |
| 2 | **Set after render.** `p.getElement(true)`, then `p.setAttr("contenteditable", "true")`. | The attribute is written to the live element immediately. |
| 3 | **Remove before render.** `p.delAttr("contenteditable")` on a component with no element, then `p.getElement(true)`. | No `contenteditable` attribute; no error thrown. |
| 4 | **Remove after render.** `p.setAttr("x", "1")`, `p.getElement(true)`, `p.delAttr("x")`. | A `removeAttr` patch reaches the live element; folded state has no `x`. |
| 5 | **Set, remove, then render.** `p.setAttr("x", "1")`, `p.delAttr("x")`, then `p.getElement(true)`. | The element is created **without** `x` — the stale value is not resurrected. |
| 6 | **Set, then re-render.** `p.setAttr("x", "1")`, `p.getElement(true)`, then `p.rerender()`. | The second element also carries `x="1"`. |
| 7 | **Null value removes.** `p.setAttr("autoplay", null)` after `p.setAttr("autoplay", "")`. | Same outcome as case 4 — `setElementAttribute(key, null)` still delegates to `removeElementAttribute`. |
| 8 | **Non-string values are stringified.** `p.setAttr("maxlength", 5)`. | `maxlength="5"` — the cached entry is the string, matching what the DOM receives. |
| 9 | **Buffer beats the `attributes` bag.** `new Probe({ attributes: { title: "a" } })`, `p.setAttr("title", "b")`, then `p.getElement(true)`. | `title="b"`. |
| 10 | **Framework class name survives a buffered `class`.** `p.setAttr("class", "Row selected")`, then `p.getElement(true)`. | The element carries `class="Row selected"` *and* an `addClass` of the constructor name — the `addClass` patch is recorded after the `setAttr` patch. |
| 11 | **`setDisabledAttribute` round-trips across a render.** `p.setDisabledAttribute(true)` detached, then `p.getElement(true)`, then `setDisabledAttribute(false)`. | `disabled=""` after render; absent after the `false` call. |
| 12 | **ARIA is unaffected.** `p.getAria().setRole("grid")` detached, then `p.getElement(true)`. | `role="grid"` exactly once in the folded state; `Aria.applyToElement` still runs. |
| 13 | **`data-*` is unaffected.** `p.setDataAttribute("insets", "0,0,0,0")` detached, then `p.getElement(true)`. | `data-insets="0,0,0,0"` — the existing `_attributes` replay still works. |

---

## Verification

1. `npm test` — must report **0 failed and 0 errors**, and exit `0`. Check the `Errors` line explicitly: an unhandled async or GC-callback exception fails the run without failing a test, so `Tests N passed` alone does not mean green. Re-run with `--no-file-parallelism` only to isolate a suspected pre-existing flake (`Animation.ts` timer warnings are a known one).
2. `npm run typecheck` — clean.
3. `npm run lint` — clean. The `local/no-raw-dom` rule has an empty baseline; every new DOM touch in this change goes through `DOM.sink.apply`.
4. `grep -n "return this;" packages/lib/src/typescript/lib/core/Component.ts` around lines 1247-1280 — confirm neither method still has an early return before the cache write.
5. `grep -rn "write-through" packages/lib/src/typescript/lib/` — expect zero matches describing `setElementAttribute`.
6. Manual smoke, `npm run dev` on http://localhost:8015: open the Markdown editor demo and type into the WYSIWYG pane. It must accept input — that pane is the original bug this fix generalises. Open a `TextInput` demo and confirm `placeholder` and `readonly` still render.

---

## Documentation Impact

None. `setElementAttribute` and `removeElementAttribute` are `protected`, so they are excluded from the TypeDoc build and appear on no docs page; no export, barrel, or catalog entry changes. The only prose that changes is JSDoc `@remarks` on excluded members and inline comments in six implementation files. `npm run docs:build` is not required by this change.

---

## Potential Challenges

- **The `super()` cascade.** A field initializer (`private _elementAttributes = new Map()`) would run after `applyOptions` has already written the map from inside `super()`, silently discarding construction-time attributes. Step 3 assigns in the constructor body instead — the same treatment `_attributes` gets.
- **The finalizer must stay headless-safe.** Anything reachable from the `FinalizationRegistry` callback at [Component.ts:296](packages/lib/src/typescript/lib/core/Component.ts#L296) that touches `document` needs a `typeof document === "undefined"` guard. This change adds nothing to that path — the buffer is plain JS state and `destructor` is untouched. Do not add a buffer clear to `destructor`.
- **Reordering `addClass` shifts patch order in existing tests.** Any test asserting on the *index* of a recorded `apply` write may move. Fix such a test by asserting on content rather than position; do not revert the reorder.
- **Double-write on ARIA keys.** ARIA attributes now appear in both the buffer replay and `Aria.applyToElement`. Both write the same value, so the folded result is identical — do not "fix" this by filtering `aria-` / `role` / `tabindex` out of the buffer, which would reintroduce a special case with no behavioural benefit.

---

## Critical Files

- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) — `_attributes` declaration (338), constructor assignment (476), `setElementAttribute` (1247), `removeElementAttribute` (1269), `setDataAttribute` / `delDataAttribute` (1512 / 1537) — the precedent this change mirrors — `applyAriaAttribute` (3961), `applyStyle` (4268), `init` (5245), `render` (5319).
- [packages/lib/tests/component/display/Video.test.ts](packages/lib/tests/component/display/Video.test.ts) — the `lastAttr` fold over `sink.writes` the new test extends.
- [packages/lib/tests/dom/TestDOM.ts](packages/lib/tests/dom/TestDOM.ts) — `RecordingDOMSink.writes` (312), `apply` (327), the null-stub `getAttribute` (1056).
- [packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts:553](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L553) — the one caller that writes a whole `class` attribute through the seam.
- [packages/lib/src/typescript/lib/component/input/TextInput.ts:651](packages/lib/src/typescript/lib/component/input/TextInput.ts#L651) and [packages/lib/src/typescript/lib/component/input/FileField.ts:160](packages/lib/src/typescript/lib/component/input/FileField.ts#L160) — two of the six hand-rolled `init()` replays this change makes redundant.

---

## Non-Goals

- **Removing the six subclass `init()` replays** (`TextInput`, `TextArea`, `Video`, `FileField`, `MarkdownEditor`'s `WysiwygSurface`, `TextInputCellEditor`). They become redundant, not wrong — each writes the same value the buffer replays, from its own `init()` after `super.init()`. Deleting them is a separate, larger change with its own regression surface.
- **Teaching `getElementAttribute` / `hasElementAttribute` to read the buffer.** They keep returning `undefined` while detached. Changing them widens the blast radius to every reader for no benefit this bug needs.
- **Releasing and rebuilding the element.** The follow-up feature that lets a component drop its element and handle is not built here. This plan only removes the blocker: a rebuilt element comes back with its runtime attributes.
- **`_options.attributes` semantics.** The consumer-facing `attributes` bag keeps its current replay and its current meaning; only its precedence relative to the new buffer is specified.

---

## Notes

[^precedent]: The search for precedent found four cached-state channels on `Component` that already survive detached construction: `_inlineStyle` (an `InlineStyle` buffer that queues until `attach()` at [Component.ts:5257](packages/lib/src/typescript/lib/core/Component.ts#L5257)), `_styleRule` (a `StyleRule` buffer flushed by `applyStyle`), the private fields `applyStyle` replays after wiping inline style ([Component.ts:4268](packages/lib/src/typescript/lib/core/Component.ts#L4268) — geometry at 4346, cursor at 4321), and the `_attributes` map replayed in `init()`. The attribute case matches `_attributes` structurally, not the style buffers: `applyStyle` exists because the element's `style` attribute is wiped and must be rebuilt from fields, whereas attributes are never wiped — they just need to be written once the element appears. So the map-plus-`init()`-replay shape is the right one, and it is already in the same method the new replay lands in.

[^cascade]: `CODE_CONVENTIONS.md` documents this as the `super()`-cascade field trap and offers `declare` as one fix. `declare` does not work here: the map needs a real instance before the first setter runs. The constructor-body assignment is the other documented fix and is exactly what `_attributes` uses at [Component.ts:476](packages/lib/src/typescript/lib/core/Component.ts#L476), which sits above the `applyOptions` dispatch at the end of the constructor.

[^aria]: Filtering ARIA keys out of the buffer was considered and rejected. `Aria` mutates only through `applyAriaAttribute`, so its map and the buffer can never disagree — every set writes both, every clear deletes from both. A filter would add a name-prefix special case to the seam to prevent a write that produces the identical result. The one visible artefact is a duplicated `setAttr` entry in the recorded patch stream, which the `attrsOf` fold collapses.

[^precedence]: The alternative — buffer first, `_options.attributes` last — was rejected because `_options.attributes` is a construction-time snapshot that `init()` re-reads on every render, while the buffer holds the most recent write. With the bag last, a runtime `setPlaceholder("b")` over a constructed `attributes: { placeholder: "a" }` would revert to `"a"` on the next render. Ordering by recency is what a consumer expects and what the current (unbuffered) code effectively does while the element is live.

[^classorder]: `addClass` maps to `classList.add`, which is additive and de-duplicating, whereas a `class` entry in `setAttr` maps to `setAttribute("class", …)`, which replaces the whole list. Order therefore decides: `setAttr` then `addClass` keeps both; `addClass` then `setAttr` loses the framework class name. `AbstractSelectableList`'s row happens to include its own class name in the string it writes, so it survives either way today — but the `attributes` bag has the same exposure with no such luck, and the reorder costs one moved line. Nothing between the two calls reads the class list: `setId`, the inline-style attach, and the attribute apply are all writes.
