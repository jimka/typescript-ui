---
depends-on: [element-attribute-replay-buffer]
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/Aria.ts
  - packages/lib/src/typescript/lib/core/ElementAttributes.ts
  - packages/lib/src/typescript/lib/core/index.ts
  - packages/lib/tests/core/ElementAttributeReplay.test.ts
  - packages/lib/tests/core/Aria.test.ts
  - packages/lib/docs/reference/changelog.md
  - packages/lib/docs/reference/migration.md
  - ARCHITECTURE.md
---

# Element-Attribute Commit Channel — Implementation Plan

## Overview

Inline styles reach the DOM through a buffer object. `Component` holds an `InlineStyle` ([packages/lib/src/typescript/lib/core/StyleTarget.ts:339](packages/lib/src/typescript/lib/core/StyleTarget.ts#L339)) in `_inlineStyle` ([Component.ts:406](packages/lib/src/typescript/lib/core/Component.ts#L406)), binds it to the element with one `attach(handle)` call in `init()` ([Component.ts:5324](packages/lib/src/typescript/lib/core/Component.ts#L5324)), and writes through it afterwards. A batching window (`setAutoCommitStyle(false)` … `commitElementStyle()`, [Component.ts:1399](packages/lib/src/typescript/lib/core/Component.ts#L1399) and [Component.ts:1413](packages/lib/src/typescript/lib/core/Component.ts#L1413)) lets a caller collapse many writes into one.

Attributes do not. `init()` builds one `setAttr` record by merging **four** hand-rolled stores ([Component.ts:5331-5353](packages/lib/src/typescript/lib/core/Component.ts#L5331-L5353)): the `data-*` map `_attributes` ([Component.ts:338](packages/lib/src/typescript/lib/core/Component.ts#L338)), the `_disabledAttribute` flag ([Component.ts:392](packages/lib/src/typescript/lib/core/Component.ts#L392)), the stashed options bag `_options.attributes` ([Component.ts:596](packages/lib/src/typescript/lib/core/Component.ts#L596)), and `_elementAttributes` ([Component.ts:343](packages/lib/src/typescript/lib/core/Component.ts#L343)). A fifth writer, `Aria.applyToElement` ([Aria.ts:789](packages/lib/src/typescript/lib/core/Aria.ts#L789)), emits its own patch a line later. Each store has its own cache and its own write path, and the four agree only because the merge order in `init()` happens to rank them.

This plan replaces all four with one buffer: `ElementAttributes`, a new class in `packages/lib/src/typescript/lib/core/ElementAttributes.ts` with the same three hooks `InlineStyle` has — `attach`, write-through, batched flush. `Component._elementAttributes` keeps its name and changes type; `_attributes` and the `_options.attributes` stash are deleted; the `_disabledAttribute` and `Aria` replays are deleted. `init()`'s attribute work becomes a single `attach(element)` call. The public methods that fed the deleted stores — `setDataAttribute` / `getDataAttribute` / `delDataAttribute` and the `attributes` options field — keep their signatures and seed the channel instead of owning a store.

This is not a throughput optimisation.[^not-perf] Attributes are not written per frame, so batching them saves almost nothing on the default path. The two things it buys are: one mechanism where there were five, and a rebuild path — a component that releases its element and renders a new one gets its attributes back from `attach(newHandle)`, the same single line the inline-style channel already uses.

The work targets library release **0.3.0**; `packages/lib/package.json` reads `0.2.0` today. Bumping that version is a release task and is out of scope here — this plan files its consumer-visible changes under a new `## 0.3.0` changelog heading.

---

## Architecture Decisions

### The channel is a new sibling class, not a `StyleTarget` subclass

Add `class ElementAttributes` in a new module `core/ElementAttributes.ts`, mirroring `InlineStyle`'s shape (attach, write-through, one batched `DOM.sink.apply` on flush) without extending `StyleTarget`.[^why-sibling] `StyleTarget` keeps its name, its exports, and its two subclasses; nothing in `StyleTarget.ts` changes.

### `attach` writes the whole attribute set, not a pending diff

`ElementAttributes` keeps two pieces of state: `_state`, every attribute the component currently intends the element to carry, and `_pending`, the keys whose DOM write has not happened yet. `flush()` drains `_pending`; `attach(handle)` writes all of `_state` and clears `_pending`.

This is the deliberate difference from `StyleTarget`, whose dirty bag is emptied at materialise. Retaining `_state` is what makes a second `attach` to a fresh handle rebuild the element's attributes rather than write nothing.[^retained-state]

### Auto-commit is on by default; the batching window is opt-in

`Component._autoCommitAttributes` starts `true`, so every `setElementAttribute` call reaches the DOM immediately, exactly as today. A caller that wants a batch calls `setAutoCommitAttributes(false)`, writes, then `setAutoCommitAttributes(true)` (which flushes).

The default differs from nothing in the style channel — that one also defaults to `true` — but it matters more here, because attributes have effects that styles do not: `disabled`, `readonly`, `contenteditable`, `src`, and the ARIA set change focus eligibility, media loading, and the accessibility tree. Deferring those reorders behaviour a caller can observe, so deferral is never the default.[^why-immediate]

The two switches are independent. `setAutoCommitStyle(false)` — which `AbstractWindow` opens around border positioning — does not batch attributes, and `setAutoCommitAttributes(false)` does not batch styles.

### A caller inside an open window must commit before reading or acting

Inside an open batching window the element's attributes are stale until `commitElementAttributes()` runs. A caller in that window must commit before it does any of:

- reads an attribute back off the element (`getElementAttribute`, which reads the live DOM through `DOM.source.getAttribute` — [Component.ts:1287](packages/lib/src/typescript/lib/core/Component.ts#L1287));
- calls anything whose result depends on an attribute it just wrote — focusing an element after clearing `disabled`, measuring after changing `src`, or handing the element to a screen reader after an ARIA change.

This is the attribute twin of the rule the style channel already has (a DOM read inside a `doLayout` override needs `commitElementStyle()` first), and it is worse in kind: a stale style gives a wrong measurement, a stale attribute gives wrong behaviour.

`getDataAttribute` is exempt: it reads the channel's retained state, not the element, so it stays correct with the window open.

No existing call site needs a commit inserted. The window ships with no callers — every current attribute write runs under the default `true`, unbatched.[^no-callers]

### `Aria`'s DOM writes fold into the channel; its typed cache stays

Delete `Aria.applyToElement` ([Aria.ts:789-805](packages/lib/src/typescript/lib/core/Aria.ts#L789-L805)) and its call in `init()` ([Component.ts:5356](packages/lib/src/typescript/lib/core/Component.ts#L5356)). Every `Aria` mutator already routes its DOM write through `Component.applyAriaAttribute` ([Component.ts:4029](packages/lib/src/typescript/lib/core/Component.ts#L4029)) → `setElementAttribute`, so the channel already holds `role`, `tabindex`, and every `aria-*` value, and replays them.[^aria-fold] `Aria` keeps its own `_role` / `_tabIndex` / `_attributes` fields — they are the cache its typed getters read (`getRole`, `getSelected`, …), not a second write path.

### The `_disabledAttribute` replay in `init()` goes away for the same reason

`setDisabledAttribute` ([Component.ts:4002](packages/lib/src/typescript/lib/core/Component.ts#L4002)) writes `disabled` through `setElementAttribute` / `removeElementAttribute`, so the `if (this._disabledAttribute) setAttr.disabled = "";` block at [Component.ts:5339](packages/lib/src/typescript/lib/core/Component.ts#L5339) re-states what the channel holds. Delete the block; keep the field (`getDisabledAttribute` reads it) and keep the setter unchanged.

### The `data-*` map folds into the channel behind its three public methods

Delete the `_attributes` field ([Component.ts:338](packages/lib/src/typescript/lib/core/Component.ts#L338)) and its constructor assignment ([Component.ts:481](packages/lib/src/typescript/lib/core/Component.ts#L481)). `setDataAttribute` and `delDataAttribute` keep their `data-` key normalisation and then call `setElementAttribute` / `removeElementAttribute`; `getDataAttribute` reads the normalised key back out of the channel. All three keep their signatures, their normalisation, and their return types, so consumer code is untouched.[^data-read-merge]

`getDataAttribute` therefore still answers from memory rather than from the DOM, and still returns `undefined` for a key that was never set — the property it had when it read `_attributes`.

### The `attributes` options bag is dispatched through the typed setter

Replace the stash-and-replay branch at [Component.ts:589-602](packages/lib/src/typescript/lib/core/Component.ts#L589-L602) with a loop that calls `this.setElementAttribute(key, value)` per entry. The `attributes` field stays on `ComponentOptions` ([Component.ts:151](packages/lib/src/typescript/lib/core/Component.ts#L151)) with its type unchanged; only where its values are stored moves. The branch's own `getElement()` write-through disappears — `setElementAttribute` already writes through when the element exists and buffers when it does not.

Dispatching from `applyOptions` is safe even though `applyOptions` runs inside `super()`: `Component`'s constructor assigns `this._elementAttributes` in its **body** at [Component.ts:482](packages/lib/src/typescript/lib/core/Component.ts#L482) and only calls `this.applyOptions(...)` afterwards at [Component.ts:538](packages/lib/src/typescript/lib/core/Component.ts#L538). The channel object exists before any setter the cascade dispatches can reach it. Keeping that assignment in the constructor body — never as a field initializer — is what makes this hold.[^cascade]

### Precedence is the order the writes happen in

All four paths now write one channel keyed by attribute name, so **the last write to a key wins**. `init()` then writes the whole retained set onto the new element, and adds the framework class name after it.

At construction the write order reproduces today's ranking exactly, because every `setDataAttribute` call `applyOptions` dispatches — from `layoutManager` ([Component.ts:563](packages/lib/src/typescript/lib/core/Component.ts#L563)), `insets`, `preferredSize`, `minSize`, and `maxSize` ([Component.ts:567-578](packages/lib/src/typescript/lib/core/Component.ts#L567-L578)) — runs before the `attributes` branch at [Component.ts:589](packages/lib/src/typescript/lib/core/Component.ts#L589), and every subclass setter runs after it. What changes is what a **post-construction** write does across a re-render: today `init()` re-reads the `data-*` map and the options bag on every render, so a later write through a lower-ranked source is undone; through one channel it sticks.[^absorb-bag]

| Sequence | On the element | Same as today? |
|---|---|---|
| `new P({ attributes: { title: "a" } })` | `title="a"` | yes |
| `new P({ attributes: { title: "a" } })`, then `setElementAttribute("title", "b")` | `title="b"` | yes |
| `new P({ attributes: { "data-layout": "X" }, layoutManager: new VBox() })` | `data-layout="X"` — the bag is dispatched after `setLayoutManager` | yes |
| `new P({ attributes: { "data-layout": "X" } })`, then `setLayoutManager(new VBox())`, then re-render | `data-layout="VBox"` | **no** — today the re-render restores `X` |
| `new P({ attributes: { title: "a" } })`, then `removeElementAttribute("title")`, then re-render | `title` absent | **no** — today the re-render restores `a` |
| `setElementAttribute("class", "Row selected")` | `class="Row selected"` **and** the framework class name — `addClass` runs after the attach | yes |
| `setElementAttribute("x", "1")` then `removeElementAttribute("x")`, both detached | `x` absent, and no `removeAttr` patch is emitted | yes |

### The six subclass `init()` replays stay

`TextInput`, `TextArea`, `Video`, `FileField`, `MarkdownEditor`'s `WysiwygSurface`, and `TextInputCellEditor` each re-apply their own attributes from their `init()` override. They stay. At least one of them is not redundant: `TextInput.applyOptions` never dispatches `options.type` to `setType`, so `TextInput.init` ([TextInput.ts:651](packages/lib/src/typescript/lib/component/input/TextInput.ts#L651)) is the only code that puts a construction-time `type` on the element.[^six-replays]

---

## Public API

New exported class, from the `core` barrel:

```typescript
// packages/lib/src/typescript/lib/core/ElementAttributes.ts
class ElementAttributes {
    set(key: string, value: string): void;
    remove(key: string): void;
    queue(key: string, value: string): void;
    queueRemove(key: string): void;
    get(key: string): string | undefined;
    flush(): void;
    attach(handle: Handle): void;
    isMaterialized(): boolean;
}
```

New public methods on `Component`, mirroring `getAutoCommitStyle` / `setAutoCommitStyle` / `commitElementStyle`:

```typescript
getAutoCommitAttributes(): boolean;
setAutoCommitAttributes(value: boolean): this;   // true flushes pending writes
protected commitElementAttributes(): this;
```

Backing field: `private _autoCommitAttributes: boolean = true;` — a plain initializer, matching `_autoCommitStyle` ([Component.ts:396](packages/lib/src/typescript/lib/core/Component.ts#L396)). **No `ComponentOptions` field.** The switch is a runtime batching window, not consumer configuration, so per ARCHITECTURE.md's third DOM-write rule it stays off the options bag — and an options field would drag it into the `super()` cascade, where the plain initializer would revert it.

Unchanged signatures, new backing store — these three now read and write the channel instead of `_attributes`:

```typescript
getDataAttribute(key: string): string | undefined;
setDataAttribute(key: string, value: string): this;
delDataAttribute(key: string): this;
```

Unchanged options field, new backing store — `ComponentOptions.attributes?: Record<string, string>` keeps its type and its meaning; `applyOptions` dispatches it to `setElementAttribute` instead of stashing it.

Removed public method: `Aria.applyToElement(element: Handle): void`.

Removed private field on `Component` (not API): `_attributes: Map<string, string>`.

Changed field type on `Component` (private, not API): `_elementAttributes` becomes `ElementAttributes` instead of `Map<string, string>`.

---

## Internal Structure

`ElementAttributes` — the whole class body:

```typescript
class ElementAttributes {
    private _handle:  Handle | null       = null;
    private _state:   Map<string, string> = new Map();
    private _pending: Set<string>         = new Set();

    set(key: string, value: string): void {
        this._state.set(key, value);

        if (this._handle) {
            DOM.sink.apply(this._handle, { setAttr: { [key]: value } });
        } else {
            this._pending.add(key);
        }
    }

    remove(key: string): void {
        this._state.delete(key);

        if (this._handle) {
            DOM.sink.apply(this._handle, { removeAttr: [key] });
        } else {
            this._pending.add(key);
        }
    }

    queue(key: string, value: string): void {
        this._state.set(key, value);
        this._pending.add(key);
    }

    queueRemove(key: string): void {
        this._state.delete(key);
        this._pending.add(key);
    }

    get(key: string): string | undefined {
        return this._state.get(key);
    }

    flush(): void {
        if (!this._handle || this._pending.size === 0) return;

        const setAttr:    Record<string, string> = {};
        const removeAttr: string[]               = [];

        for (const key of this._pending) {
            const value = this._state.get(key);

            if (value === undefined) removeAttr.push(key);
            else                     setAttr[key] = value;
        }

        this._pending.clear();
        DOM.sink.apply(this._handle, { removeAttr, setAttr });
    }

    attach(handle: Handle): void {
        this._handle = handle;
        this._pending.clear();

        if (this._state.size === 0) return;

        const setAttr: Record<string, string> = {};

        for (const [key, value] of this._state) setAttr[key] = value;

        DOM.sink.apply(handle, { setAttr });
    }

    isMaterialized(): boolean {
        return this._handle !== null;
    }
}
```

A key is in `_state` or removed, never both, so one `ElementPatch` carries both halves of a flush safely — `removeAttr` is applied before `setAttr` ([DOM.ts:133](packages/lib/src/typescript/lib/core/DOM.ts#L133)).

`Component`'s two low-level setters:

```typescript
protected setElementAttribute(key: string, value: Object | null | undefined): this {
    if (value === null || value === undefined) {
        return this.removeElementAttribute(key);
    }

    const stringValue = String(value);

    if (this._autoCommitAttributes) this._elementAttributes.set(key, stringValue);
    else                            this._elementAttributes.queue(key, stringValue);

    return this;
}

protected removeElementAttribute(key: string): this {
    if (this._autoCommitAttributes) this._elementAttributes.remove(key);
    else                            this._elementAttributes.queueRemove(key);

    return this;
}
```

The three `data-*` methods — normalisation unchanged, store replaced:

```typescript
getDataAttribute(key: string): string | undefined {
    const dataKey = key.startsWith("data-") ? key : `data-${key}`;

    return this._elementAttributes.get(dataKey);
}

setDataAttribute(key: string, value: string): this {
    if (value === null) {
        return this.delDataAttribute(key);
    }

    const dataKey = key.startsWith("data-") ? key : `data-${key}`;

    return this.setElementAttribute(dataKey, value);
}

delDataAttribute(key: string): this {
    const dataKey = key.startsWith("data-") ? key : `data-${key}`;

    return this.removeElementAttribute(dataKey);
}
```

The `attributes` branch in `applyOptions`:

```typescript
if (options.attributes !== undefined) {
    // The options bag's `attributes` is a raw-HTML-attribute escape hatch —
    // callers pass arbitrary attribute names (`placeholder`, `data-foo`,
    // `aria-bar`) and expect a literal write. Route each entry through the
    // typed seam so the channel is the only store: it writes through when the
    // element already exists and replays at render when it does not.
    for (const key of Object.keys(options.attributes)) {
        this.setElementAttribute(key, options.attributes[key]);
    }
}
```

`init()`, after the change — the merge record is gone entirely:

```typescript
DOM.sink.setId(element, this.getId());

this._inlineStyle.attach(element);
this._elementAttributes.attach(element);

DOM.sink.apply(element, { addClass: [this.constructor.name] });

this.applyStyle(element);
```

---

## Ordered Implementation Steps

1. **Add the new cases to the existing test file, red first.** `packages/lib/tests/core/ElementAttributeReplay.test.ts` already holds the 13 replay cases and the `attrsOf` fold helper. Add a second `describe` block, `'Component element-attribute commit channel'`, covering cases 14-27 in `## Expected Behaviour`. Extend the `Probe` subclass with the batching surface:

   ```typescript
   class Probe extends _Component {
       setAttr(key: string, value: Object | null): this { return this.setElementAttribute(key, value); }
       delAttr(key: string): this { return this.removeElementAttribute(key); }
       commitAttrs(): this { return this.commitElementAttributes(); }
       rerender(): Handle { return this.render(); }
   }
   ```

   Count applies per handle with a filter over `sink.writes`, not just the folded state — cases 17, 18, 20, 26, and 27 are about *how many* patches were emitted. Verify: `npm test -- ElementAttributeReplay` fails on the new block (the methods do not exist yet) and passes the existing 13.

2. **Create `packages/lib/src/typescript/lib/core/ElementAttributes.ts`** with the class body from `## Internal Structure`, the SPDX header every `core/` file carries, and `@category Core` on the class. JSDoc every public method. The class JSDoc says what the buffer is and states the rebuild property (a second `attach` re-writes the whole retained set). Import `DOM` and `type Handle` from `~/core/DOM.js`, as `StyleTarget.ts` does.

3. **Export it.** In [packages/lib/src/typescript/lib/core/index.ts:39](packages/lib/src/typescript/lib/core/index.ts#L39), add `export { ElementAttributes } from '~/core/ElementAttributes.js';` next to the `StyleTarget` export line.

4. **Change the field.** [Component.ts:343](packages/lib/src/typescript/lib/core/Component.ts#L343): `private _elementAttributes: ElementAttributes;`. Rewrite its comment to say it holds every attribute the component intends its element to carry, from all four write paths, and keep the note that it is assigned in the constructor body because `applyOptions` dispatches setters from inside `super()`. Add the import at the top of `Component.ts`.

5. **Change the constructor assignment.** [Component.ts:482](packages/lib/src/typescript/lib/core/Component.ts#L482): `this._elementAttributes = new ElementAttributes();`. It must stay above the `applyOptions` dispatch at [Component.ts:538](packages/lib/src/typescript/lib/core/Component.ts#L538).

6. **Add the batching switch.** Declare `private _autoCommitAttributes: boolean = true;` immediately after `_autoCommitStyle` ([Component.ts:396](packages/lib/src/typescript/lib/core/Component.ts#L396)). Add `getAutoCommitAttributes`, `setAutoCommitAttributes`, and `protected commitElementAttributes` immediately after `commitElementStyle` ([Component.ts:1413](packages/lib/src/typescript/lib/core/Component.ts#L1413)), worded like their style twins. `setAutoCommitAttributes(true)` calls `this.commitElementAttributes()`; `commitElementAttributes` calls `this._elementAttributes.flush()` and returns `this`.

   The JSDoc on `setAutoCommitAttributes` must **not** `{@link}` `commitElementAttributes` — a protected member is excluded from the docs build, and a link from a public symbol to an excluded one is a docs-build warning. Describe the flush in prose, as `setAutoCommitStyle` does.

7. **Rewrite the two low-level setters** at [Component.ts:1310](packages/lib/src/typescript/lib/core/Component.ts#L1310) and [Component.ts:1337](packages/lib/src/typescript/lib/core/Component.ts#L1337) to the bodies in `## Internal Structure`. Both lose their `getElement()` call. Update the `@remarks` on each: the value is held by a buffer that binds to the element at render and writes through afterwards; a write made after the element exists reaches it immediately unless a batching window is open.

8. **Reroute the three `data-*` methods** at [Component.ts:1561](packages/lib/src/typescript/lib/core/Component.ts#L1561), [Component.ts:1580](packages/lib/src/typescript/lib/core/Component.ts#L1580), and [Component.ts:1605](packages/lib/src/typescript/lib/core/Component.ts#L1605) to the bodies in `## Internal Structure`. Signatures, key normalisation, and the `value === null` delegation stay exactly as they are. Each method loses its own `getElement()` write-through, which `setElementAttribute` / `removeElementAttribute` now perform. Update `getDataAttribute`'s `@remarks` to say it reads the component's attribute buffer — prose only, since the field is private and cannot be `{@link}`ed from public JSDoc.

9. **Reroute the `attributes` options branch.** Replace [Component.ts:589-602](packages/lib/src/typescript/lib/core/Component.ts#L589-L602) with the loop in `## Internal Structure`. The `this._options.attributes = options.attributes;` stash goes away with it; `ComponentOptions.attributes` at [Component.ts:151](packages/lib/src/typescript/lib/core/Component.ts#L151) is untouched.

10. **Rewire `init()`.** In [Component.ts:5313-5358](packages/lib/src/typescript/lib/core/Component.ts#L5313-L5358), replace the whole four-source merge with the version in `## Internal Structure`: delete the `setAttr` record and its `_attributes` loop ([:5331-5337](packages/lib/src/typescript/lib/core/Component.ts#L5331-L5337)) together with the stale `for…in` comment above it, the `_disabledAttribute` block ([:5339](packages/lib/src/typescript/lib/core/Component.ts#L5339)), the `_options.attributes` block ([:5343](packages/lib/src/typescript/lib/core/Component.ts#L5343)), the `_elementAttributes` loop ([:5349](packages/lib/src/typescript/lib/core/Component.ts#L5349)), the `DOM.sink.apply(element, { setAttr })` call ([:5353](packages/lib/src/typescript/lib/core/Component.ts#L5353)), and `this._aria?.applyToElement(element);` ([:5356](packages/lib/src/typescript/lib/core/Component.ts#L5356)). Insert `this._elementAttributes.attach(element);` between the `_inlineStyle.attach` call and the `addClass` apply. Leave `DOM.sink.setId`, `applyStyle`, and the child-append loop where they are. Update `init()`'s summary JSDoc line ([:5305](packages/lib/src/typescript/lib/core/Component.ts#L5305)), which says "mirrors attributes": say it attaches the style and attribute buffers.

    Verify: `grep -n "applyToElement\|_disabledAttribute" packages/lib/src/typescript/lib/core/Component.ts` — the only remaining `_disabledAttribute` hits are the field, its getter, and its setter; no `applyToElement` hit.

11. **Delete the `_attributes` field** ([Component.ts:338](packages/lib/src/typescript/lib/core/Component.ts#L338)) and its constructor assignment ([Component.ts:481](packages/lib/src/typescript/lib/core/Component.ts#L481)). Steps 8 and 10 removed its last two readers, so this deletion is the point at which the `data-*` map is gone.

    Verify: `grep -n "_attributes" packages/lib/src/typescript/lib/core/Component.ts` — only `_elementAttributes` hits remain. `grep -n "_options.attributes" packages/lib/src/typescript/lib/core/Component.ts` — zero matches, with `attributes?:` still present once in `ComponentOptions`.

12. **Delete `Aria.applyToElement`** ([Aria.ts:789-805](packages/lib/src/typescript/lib/core/Aria.ts#L789-L805)), its JSDoc block, and the `DOM` / `Handle` imports it was the only user of — check with `grep -n "DOM\.\|Handle" packages/lib/src/typescript/lib/core/Aria.ts` before removing them. Update the class JSDoc at [Aria.ts:73-74](packages/lib/src/typescript/lib/core/Aria.ts#L73-L74), which currently says state is "flushed to the DOM element by `applyToElement`": say instead that each setter writes through the component's attribute channel, which replays the value onto a freshly created element.

    Verify: `npm run lint` — `local/no-raw-dom` stays clean and no unused import survives.

13. **Fix the ARIA tests.** In `packages/lib/tests/core/Aria.test.ts`, delete the `describe('Aria — applyToElement flush')` block ([Aria.test.ts:136-157](packages/lib/tests/core/Aria.test.ts#L136)) and the header comment sentence naming `applyToElement` as the single seam-touching case ([Aria.test.ts:7](packages/lib/tests/core/Aria.test.ts#L7)); drop the now-unused `vi` and `DOM` imports. Case 21 in the new channel block replaces that coverage, in the file that has the `installTestDOM` harness `Aria.test.ts` lacks.

14. **Rename the two stale test names** in `ElementAttributeReplay.test.ts`: case 12 `'ARIA is unaffected: role appears exactly once and applyToElement still runs'` drops the `applyToElement` clause and tightens its assertion from "at least one `role` write" to exactly one; case 13 `'data-* is unaffected: the existing _attributes replay still works'` gets a name that no longer claims an `_attributes` replay — its assertion stands unchanged, since `setDataAttribute` before render still lands on the created element.

15. **Apply the documentation changes** listed in `## Documentation Impact`: the `ARCHITECTURE.md` buffer-table row, the `docs/concepts/dom-seams.md` sentence, the new `## 0.3.0` changelog section, the new migration section, and the one appended sentence in `plans/dom-only-state-inventory.md`.

16. **Run the full verification** in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/ElementAttributes.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Aria.ts` |
| Modify | `packages/lib/src/typescript/lib/core/index.ts` |
| Modify | `packages/lib/tests/core/ElementAttributeReplay.test.ts` |
| Modify | `packages/lib/tests/core/Aria.test.ts` |
| Modify | `packages/lib/docs/concepts/dom-seams.md` |
| Modify | `packages/lib/docs/reference/changelog.md` |
| Modify | `packages/lib/docs/reference/migration.md` |
| Modify | `ARCHITECTURE.md` |
| Modify | `plans/dom-only-state-inventory.md` (one appended sentence) |

---

## Expected Behaviour

Every case is unit-testable offline against the recording sink. Assert element state through the `attrsOf` fold over `sink.writes`, never through `getElementAttribute` — the modelled read source's `getAttribute` is a null stub offline. `getDataAttribute` is asserted directly, since it reads the channel rather than the DOM.

Cases 1-13 are the existing tests in `ElementAttributeReplay.test.ts` and must stay green unchanged, except the two renames in step 14. Cases 14-27 are new.

| # | Case | Expected |
|---|---|---|
| 14 | **Write while detached, then render.** `p.setAttr("contenteditable", "true")` with no element, then `p.getElement(true)`. | The created element carries `contenteditable="true"`, written by the `attach` patch. No apply targets the handle before it exists. |
| 15 | **Write while live.** `p.getElement(true)`, then `p.setAttr("x", "1")`. | One `apply` with `setAttr: { x: "1" }` on that handle, emitted during the `setAttr` call — not deferred. |
| 16 | **Remove while detached.** `p.setAttr("x", "1")`, `p.delAttr("x")`, then `p.getElement(true)`. | The element is created without `x`, and **no** `removeAttr` patch is ever emitted — a key removed before the element existed is simply absent from the attached state. |
| 17 | **Batching window collapses writes.** `p.getElement(true)`, `p.setAutoCommitAttributes(false)`, `p.setAttr("a", "1")`, `p.setAttr("b", "2")`, `p.delAttr("c")`. | No apply carrying `a`, `b`, or `c` reaches the handle while the window is open. |
| 18 | **Closing the window flushes once.** Continue case 17 with `p.setAutoCommitAttributes(true)`. | Exactly one further `apply` on that handle, carrying `setAttr: { a: "1", b: "2" }` and `removeAttr: ["c"]`; folded state has `a="1"`, `b="2"`, no `c`. |
| 19 | **Batched writes survive a render.** `p.setAutoCommitAttributes(false)` before any element, `p.setAttr("a", "1")`, then `p.getElement(true)`. | `a="1"` is on the created element — `attach` writes the retained state regardless of the open window. |
| 20 | **Double flush is a no-op.** After case 18, call `p.commitAttrs()` twice. | No additional `apply` on that handle — the pending set is empty. |
| 21 | **Re-attach to a fresh handle rebuilds everything.** `p.setAttr("x", "1")`, `p.getAria().setRole("grid")`, `p.getAria().setTabIndex(0)`, `p.getAria().setSelected(true)`, `p.setDisabledAttribute(true)`, `p.getElement(true)`, then `p.rerender()`. | The second element carries `x="1"`, `role="grid"`, `tabindex="0"`, `aria-selected="true"`, and `disabled=""` — all five from the single `attach` patch. |
| 22 | **`data-*` write while detached, then render.** `p.setDataAttribute("marker", "1")` with no element, then `p.getElement(true)`. | The created element carries `data-marker="1"`, written by the `attach` patch — the normalised key, not the bare one. |
| 23 | **`getDataAttribute` read-back before and after render.** `p.setDataAttribute("marker", "1")`; read `p.getDataAttribute("marker")` and `p.getDataAttribute("data-marker")`; then `p.getElement(true)` and read both again. | `"1"` in all four reads. `p.getDataAttribute("absent")` is `undefined` in both phases. |
| 24 | **`getDataAttribute` sees an options-bag `data-*` key.** `new Probe({ attributes: { "data-marker": "1" } })`, then `p.getDataAttribute("marker")`. | `"1"` — the bag and the `data-*` API share one store. This read returned `undefined` before the channel; the change is deliberate. |
| 25 | **Options-bag key plus a later conflicting write, across a render.** `new Probe({ attributes: { title: "a" } })`, `p.setAttr("title", "b")`, `p.getElement(true)`, then `p.rerender()`. | Both elements carry `title="b"`, and the second element's `attach` patch carries no `title="a"`. |
| 26 | **Remove an options-bag-seeded key.** `new Probe({ attributes: { title: "a" } })`, `p.getElement(true)`, `p.delAttr("title")`, then `p.rerender()`. | The first element gets `title="a"` then a `removeAttr: ["title"]`; the second element's `attach` patch carries no `title` at all, and folded state on it has no `title`. |
| 27 | **`delDataAttribute` while detached.** `p.setDataAttribute("marker", "1")`, `p.delDataAttribute("marker")`, then `p.getElement(true)`. | `p.getDataAttribute("marker")` is `undefined`, the created element has no `data-marker`, and no `removeAttr` patch is emitted. |

Nothing here needs manual verification in a browser — detached construction, render, and re-render all run offline. One live smoke test is still listed in `## Verification` because the ARIA and `disabled` replays now have exactly one writer instead of two, and the offline sink cannot tell a real accessibility tree from a recorded patch.

---

## Verification

1. `npm test` — must report **0 failed and 0 errors**, and exit `0`. Check the `Errors` line explicitly: an unhandled async or GC-callback exception fails the run without failing a test, so `Tests N passed` alone does not mean green. Run with `--no-file-parallelism`; the `Animation.ts` unhandled-timer warning is a known pre-existing flake that only appears under parallel files.
2. `npm run typecheck` — exactly the **7 known pre-existing errors**, no new ones.
3. `npm run lint` — clean. `local/no-raw-dom` has an empty baseline; every write in the new module goes through `DOM.sink.apply`.
4. `grep -rn "applyToElement" packages/lib/src/ packages/lib/tests/` — zero matches.
5. `grep -n "_attributes" packages/lib/src/typescript/lib/core/Component.ts` — only `_elementAttributes` hits; the `data-*` map is gone.
6. `grep -n "_options.attributes" packages/lib/src/typescript/lib/core/Component.ts` — zero matches. `attributes?:` still appears once, in `ComponentOptions`.
7. `grep -n "getElement()" packages/lib/src/typescript/lib/core/Component.ts` around lines 1300-1620 — zero matches inside the two low-level setters and the three `data-*` methods.
8. `grep -n "_elementAttributes" packages/lib/src/typescript/lib/core/Component.ts` — the field, the constructor assignment, the two low-level setters, `getDataAttribute`, and the `attach` call in `init()`; nothing iterates it as a `Map`.
9. `npm run docs:build` — 0 errors and 0 link warnings. Needs ~5GB heap; the script pins it, but free memory first on a loaded machine or the OS kills it with exit 137. Confirm `ElementAttributes` appears in `docs/api/core/index.md` and `Aria.applyToElement` no longer appears in `docs/api/core/classes/Aria.md`.
10. Manual smoke, `npm run dev` on http://localhost:8015: open a `Table` demo and sort a column — the header's `aria-sort` must update in DevTools' element inspector, since `Aria` now has a single write path. Confirm the demo components still carry their `data-layout` / `data-insets` / `data-preferredSize` attributes in the inspector, since the `data-*` path changed stores. Open the Markdown editor demo and type in the WYSIWYG pane (`contenteditable` through the channel). Disable a button and confirm it is both greyed and unfocusable by keyboard (`disabled`, which lost its second replay).

---

## Documentation Impact

- **Consumer-visible surface, checked path by path.** Four write paths move into the channel. Three are non-breaking and one is a break:

  | Absorbed path | Public surface | Breaking? |
  |---|---|---|
  | `_disabledAttribute` replay | `setDisabledAttribute` / `getDisabledAttribute` | No — signatures and behaviour identical. |
  | `Aria.applyToElement` | the method itself | **Yes** — a public method is removed. |
  | `data-*` map | `setDataAttribute` / `getDataAttribute` / `delDataAttribute` | No signature change; two behaviour changes, both narrow (below). |
  | `attributes` options bag | `ComponentOptions.attributes` | No type change; one behaviour change (below). |

  The two `data-*` behaviour changes: `getDataAttribute` now also answers for a `data-`-prefixed key written through the `attributes` bag or through `setElementAttribute` (it returned `undefined` for those before), and a post-construction `setDataAttribute` is no longer undone by a later re-render when the same key was also in the `attributes` bag. The bag change: a value passed in `attributes` is applied once at construction rather than re-applied at every render, so a later `removeElementAttribute` of that key sticks. `removeElementAttribute` is `protected`, so only a subclass author can observe that one. None of the three is a compile break, and each needs the same key to travel through two APIs before it shows — but they are behaviour changes, not transparency, and the changelog says so rather than claiming the move is invisible.
- **Changelog.** `packages/lib/docs/reference/changelog.md` has `## 0.2.0` at the top. Add a new `## 0.3.0` section above it with: a **Breaking** bullet for the removal of `Aria.applyToElement` (a component's ARIA state now reaches the element through the attribute channel; no consumer replacement is needed because no consumer had a reason to call it), a **Changed** bullet covering the three behaviour changes above, and an **Added** bullet for the `ElementAttributes` export. Do **not** edit the `StyleTarget, StyleRule, InlineStyle` core-primitives line at [changelog.md:69](packages/lib/docs/reference/changelog.md#L69) — it records what `0.1.0` shipped, and `ElementAttributes` was not part of it.
- **Migration.** `packages/lib/docs/reference/migration.md` documents each break under a `## Upgrading from X to Y` heading, most recently `## Upgrading from 0.1.x to 0.2.0` ([migration.md:7](packages/lib/docs/reference/migration.md#L7)). Add `## Upgrading from 0.2.x to 0.3.0` immediately before `## Versioning policy` ([migration.md:219](packages/lib/docs/reference/migration.md#L219)), with one `### Aria.applyToElement was removed` subsection: delete the call, nothing replaces it. Do not add subsections for the three non-breaking behaviour changes — the changelog carries those.
- **New exported symbol.** `ElementAttributes` is re-exported from the `core` subpath barrel (`core/index.ts`) and carries `@category Core`, so it lands in `docs/api/core/index.md` and gets a generated `docs/api/core/classes/ElementAttributes.md` at build. No curated page is needed — it is a primitive behind the typed setters, like `InlineStyle`, which has none either.
- **Cross-bucket link forms.** `Component` and `ElementAttributes` are both in the `core` bucket, so `{@link ElementAttributes}` resolves from `Component`'s JSDoc and `{@link DOMSink.apply}` resolves from the new module's. A link from public JSDoc to `commitElementAttributes` (protected) or to `Component._elementAttributes` (private) is a docs-build warning — describe those in prose instead. This constrains `getDataAttribute`'s updated `@remarks`, which must say "the component's attribute buffer" rather than naming the field.
- **Concept page.** `packages/lib/docs/concepts/dom-seams.md:21` says the per-frame inline-style flush in `StyleTarget` batches its dirty bag into a single `apply`. Add one sentence: attributes have the same batching shape behind `setAutoCommitAttributes`, off by default because attribute writes change behaviour and not only appearance.
- **ARCHITECTURE.md.** The "CSS writes go through `StyleRule` / `InlineStyle`" table lists the framework's deferred-write buffers. Add a row: target `HTMLElement` attributes, class `ElementAttributes`, used by `setElementAttribute` / `removeElementAttribute` / `setDataAttribute` / the `attributes` option. Do not restate the batching rule there — the concept page owns it. Leave the rest of the document alone; its `Component.setAttribute` / `getAttribute` naming drift is pre-existing and out of scope.
- **No change to `packages/lib/llms.txt`** — it indexes components and layouts, and mentions none of the style buffers (`grep -n "StyleTarget\|InlineStyle" packages/lib/llms.txt` returns nothing).
- **`plans/dom-only-state-inventory.md`** records the attribute class as CLOSED by the replay buffer. The row stays accurate — this plan changes the mechanism, not the verdict — but its sentence "the sibling plan `element-attribute-replay-buffer` … gave the seam a cache that `init()` replays" now describes a `Map` that no longer exists. Append one sentence naming `ElementAttributes` as the mechanism that superseded it, and noting that the `data-*` map and the options bag now share it. Do not restructure the inventory.

---

## Potential Challenges

- **The `super()` cascade.** `applyOptions` runs inside `super()` and dispatches setters that call `setElementAttribute` — including, now, the `attributes` bag itself. A field initializer (`private _elementAttributes = new ElementAttributes()`) would run afterwards and discard every construction-time attribute. Step 5 assigns in the constructor body, as the `Map` already did.
- **Order dependence at construction.** With one store, which value survives is decided by dispatch order rather than by a merge rank. Moving the `attributes` branch earlier or later inside `applyOptions` would silently change the outcome for a key two paths write. Leave the branch where it is, at [Component.ts:589](packages/lib/src/typescript/lib/core/Component.ts#L589).
- **Patch order around `class`.** `AbstractSelectableList` writes a whole `class` attribute through `setElementAttribute` ([AbstractSelectableList.ts:564](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L564)), which replaces the class list. The `attach` call must sit **before** the `addClass` apply, or the framework class name is wiped on every render. Case 10 of the existing test guards it.
- **Patch count changes.** `init()` now emits one apply for the channel where it emitted a merged `setAttr` record plus an ARIA apply, and emits none at all for a component that carries no attributes. Any test asserting on the *index* or *count* of recorded applies may shift; fix such a test by asserting on content, not position.
- **A resurrected element bypasses `attach`.** `getElement()` falls back to `getElementById` before it falls back to `render()` ([Component.ts:927-940](packages/lib/src/typescript/lib/core/Component.ts#L927-L940)), so a component whose `_element` was cleared while its node stayed in the document would resolve an element the channel is not attached to, and attribute writes would buffer instead of landing. The inline-style channel has the identical exposure today, and no current code clears `_element` without removing the node — the future release feature must remove the node, which the DOM-only-state inventory already flags as its central constraint.
- **A destroyed component's channel keeps its handle.** `destructor` removes the element but does not detach `_inlineStyle`, and this plan does not add a detach either. Writing attributes to a destroyed component is a caller error with or without this change; do not add a `detach()` speculatively.

---

## Critical Files

- [packages/lib/src/typescript/lib/core/StyleTarget.ts:339-364](packages/lib/src/typescript/lib/core/StyleTarget.ts#L339-L364) — `InlineStyle`, the precedent the new class mirrors: `attach` materialises, `writeStyle` writes through, `flushDirty` collapses the bag into one `DOM.sink.apply`.
- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) — `ComponentOptions.attributes` (151), `_attributes` (338), `_elementAttributes` (343), `_disabledAttribute` (392), `_autoCommitStyle` (396), `_aria` (398), `_inlineStyle` (406), constructor assignments (480-483), the `applyOptions` dispatch (538), the option branches that call `setDataAttribute` (563-578), the `attributes` options branch (589-602), `getElementAttribute` (1287), `setElementAttribute` (1310), `removeElementAttribute` (1337), `getAutoCommitStyle` / `setAutoCommitStyle` / `commitElementStyle` (1390 / 1399 / 1413) — the surface being mirrored — `getDataAttribute` (1561), `setDataAttribute` (1580), `delDataAttribute` (1605), `setDisabledAttribute` (4002), `applyAriaAttribute` (4029), `init` (5313), `render` (5391) — which calls `init(element)` unconditionally, the guarantee the attach relies on.
- [packages/lib/src/typescript/lib/core/Aria.ts:789-816](packages/lib/src/typescript/lib/core/Aria.ts#L789-L816) — `applyToElement` and the private `setAttribute` that proves every ARIA mutation already goes through `applyAriaAttribute`.
- [packages/lib/src/typescript/lib/core/DOM.ts:130-140](packages/lib/src/typescript/lib/core/DOM.ts#L130-L140) — `ElementPatch.removeAttr` / `setAttr`, and the documented rule that removals apply first.
- [packages/lib/tests/core/ElementAttributeReplay.test.ts](packages/lib/tests/core/ElementAttributeReplay.test.ts) — the 13 existing cases, the `attrsOf` fold, and the `Probe` subclass the new block extends.
- [plans/implemented/element-attribute-replay-buffer.md](plans/implemented/element-attribute-replay-buffer.md) — the plan whose `Map` this one replaces; its class-ordering decision carries over unchanged.

---

## Non-Goals

- **A shared base class across the style and attribute channels.** `ElementAttributes` and `StyleTarget` stay separate classes with no common ancestor. Extracting a base is deferred until both concrete channels exist and their shared shape can be read off two working implementations rather than designed up front from one.[^why-sibling]
- **Anything beyond attributes.** Inline style and `applyStyle` are untouched. `StyleTarget`'s bag is a pending diff emptied at materialise, and `applyStyle` rebuilds style from typed private fields rather than from a keyed bag, so folding either into this channel would need a mode flag to tell the two behaviours apart.
- **Releasing and rebuilding the element.** The `component-element-release` feature is not built here. This plan only makes the attribute half of a rebuild a single `attach` call.
- **Deleting the six subclass `init()` replays.** They stay for the reason in `## Architecture Decisions`; absorbing them needs `applyOptions` to dispatch every attribute-backed option through its setter first, which is a separate change.
- **Teaching `getElementAttribute` to read the channel.** It keeps reading the live DOM and keeps returning `undefined` while detached. The channel now holds a complete cache of what the framework wrote, so the change is possible — but callers that read attributes the framework did not write (a value Lexical or the browser set) would silently start getting a different answer.
- **Renaming `setDataAttribute` / `getDataAttribute`.** Sharing a store with `setElementAttribute` makes the two name pairs read as near-synonyms. Renaming either is a consumer break with no behavioural gain and belongs in an API-naming pass.
- **Renaming or generalising `StyleTarget`.** It is exported from the `core` barrel, so a rename is a consumer break, and this plan does not need one.
- **A `detach()` on the channel.** Nothing calls it today; the release feature can add it when it has a caller.
- **Bumping `packages/lib/package.json` to `0.3.0`.** Version bumps and publishing are a release task; this plan only files changelog and migration entries under the `0.3.0` heading.

---

## Implementation Notes

- **`Body.ts` needed a fix outside the plan's file list.** The full test suite
  surfaced a regression in `Body.test.ts` that the plan didn't anticipate:
  `Body` is a module-level singleton constructed once, and its
  `getElement()` override always resolves the *live* document body afresh
  (`DOM.source.getBody()`) rather than a cached `_element` field. The old
  `setDataAttribute`/`setElementAttribute` wrote through that fresh lookup
  on every call, so they never cared which DOM seam was currently installed.
  `ElementAttributes.attach()` caches a `_handle` the way `InlineStyle`
  already does, and once `setDataAttribute` started routing through
  `setElementAttribute` (this plan's whole point), it inherited that cached
  handle too — so a `Body` write issued after the global test harness
  reinstalls a fresh DOM (`tests/setup/node-setup.ts`'s per-test
  `installTestDOM`) tried to `apply` a handle number the *new* sink's
  registry had never seen. This is the identical "resurrected element"
  exposure `## Potential Challenges` already names for `_inlineStyle` — just
  newly exercised because `setDataAttribute` no longer dodges it. Fixed with
  a new `protected Component.reattachElementBuffers()` (re-binds
  `_inlineStyle` and `_elementAttributes` to the component's current
  `getElement()` without re-running the rest of `init()` — no class list, no
  `applyStyle`, no child re-append, so it doesn't double-register `Body`'s
  viewport/theme listeners the way calling `init()` again would), called
  from `Body.static init()` before dispatching options. In production this
  is a harmless no-op re-bind (the DOM seam never swaps after construction);
  it only matters under the test harness's per-test DOM swap. `Body.ts` is
  therefore an added file beyond the plan's `## Files to Create / Modify /
  Delete` table.
- **Case 21's test assertion was loosened from "exactly one `setAttr` apply"
  to "exactly one `setAttr` apply carrying the `x` key."** `applyStyle`
  (called from `init()` right after the `attach` call) unconditionally
  re-asserts `data-maxSize` / `data-insets` constraint attributes on every
  render via `setDataAttribute`, as pre-existing behaviour unrelated to this
  plan. Those land as separate `apply` patches on the same handle, so a
  strict "only one `setAttr`-bearing apply total" assertion fails for
  reasons orthogonal to the case (rebuild-in-one-attach-patch). The loosened
  assertion still proves the thing the case is about: all five ARIA/
  disabled/plain-attribute values land together in the single `attach`
  patch, identified by the `x` key rather than by being the only write.

## Notes

[^not-perf]: Two things were checked before making the throughput claim, and both argue against it. First, where attributes get written: the sweep in `plans/dom-only-state-inventory.md` counts 26 `setElementAttribute` and 14 `removeElementAttribute` call sites across 8 files, and they are input configuration (`type`, `placeholder`, `readonly`, `maxlength`), media configuration (`src`, `poster`, `preload`), ARIA state, and one whole-`class` write in `AbstractSelectableList`. None is in `doLayout` or a per-frame commit — unlike inline style, whose per-frame geometry flush is exactly why `InlineStyle.flushDirty` collapses the bag into one `apply`. The `data-*` writes folded in by this plan sit on the same cold paths: `setLayoutManager`, `setInsets`, and the three size setters. Second, what the batching would save: one `apply` per attribute versus one per batch, where `apply` is a handle-registry lookup plus a `setAttribute` loop. With auto-commit on by default (the decision above), even that saving is not on the default path. The honest gains are the two named in `## Overview`.

[^why-sibling]: Three options were weighed. **Reuse `StyleTarget` as-is** — rejected on semantics: its `_dirty` bag is emptied inside `materialize` and inside `flush`, so it holds a pending diff, not the element's state; an `ElementAttributes` built on it would need a second, retained map alongside the inherited bag, giving every key two homes. **Rename or generalise `StyleTarget`** (to something like `CommitTarget`, with `writeStyle` → `writeEntry`) — rejected on cost: `StyleTarget` is exported from `core/index.ts:39` and named in ARCHITECTURE.md's buffer table and in `docs/reference/changelog.md`, so the rename is a consumer-visible break bought for no behavioural gain, and this plan already spends one break on `Aria.applyToElement`. **A sibling class** — chosen. What the base would have contributed is `set`/`setMany`/`queue`/`queueMany`/`flush`/`isMaterialized`, about 40 lines of trivial bag bookkeeping, of which `ElementAttributes` would override or shadow most: its `set` has to record `_state`, its removal path has to *delete* a key rather than write a null, and its flush has to split one bag into `setAttr` plus `removeAttr`. A base designed now would be designed from one implementation plus a guess; once both channels are in the tree, whatever they genuinely share can be lifted out of working code. The precedent the new class does follow is `InlineStyle`'s three-hook shape and its one-`apply`-per-flush discipline — structural conformance, which is what pattern conformance asks for, rather than a shared base class.

[^retained-state]: This is also why `_inlineStyle.attach(newHandle)` alone would not rebuild a component's inline style: by the time an element is re-rendered the style bag has long been flushed and emptied, and it is `applyStyle` that rebuilds the style from `Component`'s private fields. The attribute channel has no `applyStyle` equivalent and needs none, because it retains `_state` itself.

[^why-immediate]: Concretely: `setDisabledAttribute(false)` followed by a focus call is correct today and would silently fail inside a deferred window, because the element is still `disabled` when focus is attempted. `Video.setSrc` followed by `play()` has the same shape, and an ARIA change deferred past the moment a screen reader reads the node is announced wrong with no visible symptom. Styles have no equivalent: a deferred style produces a stale measurement, which the existing `commitElementStyle()` rule already covers.

[^no-callers]: Checked by reading every current call site of the two low-level setters (26 + 14, in `Video`, `MarkdownEditor`, `FileField`, `TextArea`, `TextInput`, `AbstractSelectableList`, `TextInputCellEditor`, and `Component` itself). All of them write and return; none opens a window, and none reads an attribute back after writing it. `AbstractWindow`'s `setAutoCommitStyle(false)` window is the only batching window in the library and it touches styles only. The `data-*` and options-bag paths absorbed by this plan add no window callers either — every `setDataAttribute` site writes and returns.

[^aria-fold]: Verified by reading every mutator on `Aria`: `setRole` and `setTabIndex` call `applyAriaAttribute` directly; every other setter goes through the private `setAttribute`, which also calls `applyAriaAttribute`; the clearing paths (`clearRole`, `clearLabel`, `setExpanded(null)`, `setActiveDescendant("")`, `setValueMin(null)`, `setValueMax(null)`) pass `null`, which `applyAriaAttribute` routes to `removeElementAttribute`. So `applyToElement` writes a strict subset of what the channel already holds, and the replay-buffer plan's `[^aria]` footnote — which accepted the duplicate write as harmless — no longer needs to: the duplicate is now removable rather than merely tolerable. The alternative, keeping `applyToElement` and having it delegate to the channel, was rejected as a wrapper around one line.

[^cascade]: This is the trap the replay-buffer work already hit with the `Map`: a `private _elementAttributes = new Map()` field initializer runs *after* `super()` returns, so it wiped every attribute a cascade-dispatched setter had written during construction. CODE_CONVENTIONS.md's rule for a plain cached field is `declare`, but a field that must hold a real instance cannot be left unconstructed — so the instance is built in the constructor body before the `applyOptions` dispatch, the same shape the `ListenerBag` rule in ARCHITECTURE.md prescribes. Routing the `attributes` bag through `setElementAttribute` raises the number of cascade-time writers into that object from a handful of subclass setters to the bag as well, which makes the ordering constraint in step 5 load-bearing rather than incidental.

[^absorb-bag]: The observable cost of absorbing the bag and the `data-*` map is that `init()` no longer re-reads either at render, so a value a consumer passed in `attributes` is no longer restored after a `removeElementAttribute` and a re-render, and a `data-*` key that also appears in the bag is no longer restored to the bag's value after a later `setDataAttribute`. Both were artefacts of a replay that re-ran the merge from scratch, not designed behaviour: they mean a component silently reverts a runtime change on re-render, which is the opposite of what every other setter on `Component` does. Two ways to preserve them were considered and rejected. Keeping the bag's own store and re-applying it after `attach` restores the old outcome but keeps two stores, which is the thing this plan exists to remove. Making `removeElementAttribute` write a tombstone that a bag replay would respect adds a third state per key (present / absent / suppressed) to defend a behaviour nobody asked for. Re-renders are rare in practice — `render()` runs once per element unless a caller re-renders explicitly — so the exposure is small, and the changelog names the change rather than claiming transparency.

[^data-read-merge]: Sharing one store means `getDataAttribute` can now see a `data-`-prefixed key that arrived through the `attributes` options bag or through `setElementAttribute`, where it previously returned `undefined`. The reverse direction was checked too and does not change: `getElementAttribute` reads the live DOM, and `setDataAttribute` already wrote the DOM. Keeping the two stores separate purely to preserve the old `undefined` was rejected — it would mean `getDataAttribute` deliberately denying an attribute that is on the element, and a consumer depending on the old answer would have to be passing the same `data-` key through two different APIs while relying on one of them not seeing it. Both names normalise into the same key space, so one store is the honest model; what makes this look odd is the naming, which `## Non-Goals` leaves to an API-naming pass.

[^six-replays]: `TextInput.applyOptions` ([TextInput.ts](packages/lib/src/typescript/lib/component/input/TextInput.ts)) dispatches `text`, `textAlign`, `placeholder`, `readOnly`, `enabled`, `maxLength`, `inputMode`, and `autoComplete` — but not `type`, which only ever reaches the element from `TextInput.init`'s own `DOM.sink.apply`. Deleting that override would drop `new TextField({ type: "password" })` on the floor. `Video.replayMediaOptions` is likewise not fully redundant: `volume`, `playbackRate`, and `muted`-as-a-live-property have no reflecting attribute and are therefore never in the channel. The remaining four are genuinely redundant, but splitting the six is worse than leaving them: their comments already say which parts are redundant and why (corrected on the replay-buffer branch), and each deletion carries a live-only regression risk — `getElement()` returns nothing during `init()`, so a naive replacement that calls a setter instead of writing the passed handle silently no-ops. One good thing does follow from this plan for a later cleanup: once the channel is attached inside `super.init()`, a setter called from a subclass `init()` *does* reach the element, which is the timing trap those comments describe.
