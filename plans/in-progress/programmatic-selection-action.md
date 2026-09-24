---
depends-on: []
touches-shared:
  - ARCHITECTURE.md
  - packages/lib/docs/concepts/events.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
  - plans/research/render-review-2026-09-15/00-post-campaign-agenda.md
  - plans/research/render-review-2026-09-15/01-phase2-status-pass.md
---

# Programmatic Selection Stops Announcing `"action"` — Implementation Plan

## Overview

`List`, `MultiSelectList` and `ComboBox` are the last three controls whose `"action"` event fires for a programmatic write. `AbstractSelectableList.setSelectedIndex(idx, fireEvent = true)` ends in `fireChange()` ([`AbstractSelectableList.ts:1481`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1481)), which dispatches the DOM `change` that `on("action", fn)` listens for. `ComboBox.setSelectedIndex(idx, fireEvent = true)` ends in `notifyChange` ([`ComboBox.ts:1207`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1207)), and `ComboBox.on("action", fn)` is a plain alias of that same listener-bag `"change"` ([`ComboBox.ts:1131`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1131)).

`plans/implemented/checkbox-action-activation.md` made `"action"` mean *the user's own activation* for `Checkbox` and `Slider`, and recorded these two as the one known exception. [ARCHITECTURE.md:21](ARCHITECTURE.md#L21) states the rule and names them as a deviation "to be brought in line by their own change". This plan is that change.

After it, both classes fire `"action"` only from their user paths, and a programmatic `setSelectedIndex(idx)` keeps firing the committed-value `"change"` and `"binding"` exactly as today. `ComboBox.on("action", fn)` stops being a listener-bag alias and becomes a DOM `change` shorthand like every sibling's, which changes what its listener receives — the one breaking change. Its only in-repo consumer is the demo app's toolbar combo ([`ToolBarPanel.ts:83`](packages/lib/src/typescript/ToolBarPanel.ts#L83)); Loom and SQLAdmin need no edit at all.[^migration-cost]

---

## Architecture Decisions

### The `"action"` contract is extended, not re-decided

This plan applies the rule [ARCHITECTURE.md:21](ARCHITECTURE.md#L21) already states to the two classes that paragraph names as its outstanding deviation. No new contract is invented and no separate approval is needed: the merged `checkbox-action-activation` plan settled the question and wrote the deviation down as a debt to clear.[^contract-settled]

### `setSelectedIndex` keeps its `fireEvent` flag — only the DOM dispatch leaves

`AbstractSelectableList.setSelectedIndex(idx, fireEvent = true)` calls `this.notifyChange(this.getValue())` in place of `this.fireChange()`. The committed-value `"change"`, the `"binding"` event and the dirty-state update all keep firing on the default path; only the DOM `change` that carries `"action"` stops. `fireChange()` survives as the user path's dispatcher, reached solely through `notifyUserChange()`.

This is the same "setter mutates and notifies, activation path dispatches" split that [`Slider.setValueFromUser`](packages/lib/src/typescript/lib/component/input/Slider.ts#L630) established, with `fireChange` in the role of `setValueFromUser`. `ComboBox.setSelectedIndex` already has exactly this shape and needs no change at all.[^flag-name]

### `ComboBox.on("action", fn)` becomes a DOM `change` shorthand — a breaking change

`ComboBox.on("action", fn)` registers `Event.addListener(this, "change", …)` and `off` removes it, mirroring [`AbstractSelectableList.on:1549`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1549). `ComboBox.onRowSelected` — the user's row click, Enter, Space or arrow commit — fires `Event.fireEvent(this, "change")` after committing the value.

**What breaks:** an `"action"` listener used to be called with the new value as its first argument, because it was the listener-bag `"change"` under another name. It is now called with a DOM `CustomEvent`. A listener that used the value reads `combo.getValue()` instead.

```typescript
// Before
combo.on("action", (value: string) => status("Zoom " + value));

// After
combo.on("action", () => status("Zoom " + combo.getValue()));
```

The declared overload changes from `listener: Function` to `listener: Event.Listener`, so the compiler flags every call site that typed a value parameter.[^combobox-dom]

### `ComboBox.onRowSelected` guards the dispatch on a realised element

The new `Event.fireEvent(this, "change")` call sits behind an `if (this.getElement())` check, copying [`AbstractSelectableList.fireChange:1765-1769`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1765). `Event.fireEvent` throws when the component has no element, and a listener that disposes the combo box mid-dispatch would otherwise abort the rest of the fan-out.[^dispose-guard]

### `ComboBox.setValue` stays silent, and `List` keeps its listener order

Two existing behaviours around the changed code are left exactly as they are. `ComboBox.setValue(value)` fires no `"change"`, no `"binding"` and no `"action"`, which is what a consumer already relies on.[^setvalue-silent] And on a user commit `List` keeps firing `"action"` before `"change"`, the order it has today, while `ComboBox` fires `"change"` then `"action"`.[^listener-order]

### The delivery tests get their own files

The mounted cases that assert `"action"` delivery go into two new test files rather than into `List.test.ts` or `ComboBox.test.ts`. `Event` installs one window-level listener per DOM event type and remembers it across `installTestDOM` calls, so a case in a file that left an earlier instance undisposed dispatches into a dead window and every "zero actions" assertion passes for the wrong reason. [`ComboBoxDropdownClose.test.ts:1-10`](packages/lib/tests/component/input/ComboBoxDropdownClose.test.ts#L1) exists for precisely this reason and documents it.[^event-window]

---

## Public API

```typescript
class AbstractSelectableList<TValue, TOptions> extends AbstractInput<TValue, TOptions> {
    /**
     * Signature unchanged. `fireEvent` now gates only the committed-value
     * `"change"` / `"binding"` notification; the DOM `change` behind
     * `"action"` is no longer dispatched from here at all.
     */
    setSelectedIndex(idx: number, fireEvent?: boolean): this;

    /** Signatures unchanged. `"action"` now fires from user gestures only. */
    on(event: "action", listener: Event.Listener): this;
    off(event: "action" | "change" | "binding" | "contextmenu" | "dblclick", listener: Function): this;

    /** Unchanged body; now reached only from `notifyUserChange()`. */
    protected fireChange(): void;
}

class ComboBox<TOptions extends ComboBoxOptions = ComboBoxOptions> extends AbstractInput<string, TOptions> {
    /** Signature and body unchanged. */
    setSelectedIndex(idx: number, fireEvent?: boolean): this;

    /**
     * BREAKING: was `on(event: "action", listener: Function)`, an alias of the
     * listener-bag `"change"` that passed the listener the new value. `"action"`
     * is now a shorthand over `Event.addListener(this, "change", …)`, fired once
     * per user commit, and its listener receives a DOM `CustomEvent`.
     */
    on(event: "action",  listener: Event.Listener): this;
    on(event: "change",  listener: (value: string) => void): this;
    on(event: "binding", listener: () => void): this;
    off(event: "action" | "change" | "binding", listener: Function): this;
}
```

`ComboBoxOptions.listeners.action` and `AbstractSelectableListOptions.listeners.action` stay `() => void`, which is assignable to `Event.Listener` and already promises no argument. No options field is added or removed, so [`tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts) needs no row.

---

## Internal Structure

### What delivers `"action"`, before and after

"Mounted" means the component's element is realised; `Event.fireEvent` needs one.

| Trigger | `List` today | `List` after | `ComboBox` today | `ComboBox` after |
|---|---|---|---|---|
| Row click, Enter, Space, or an arrow key that moves the selection | 1 | 1 | 1 | 1 |
| Enter on the already-selected row | 1 | 1 | 1 | 1 |
| An arrow key clamped at the end of the list | 0 | 0 | 0 | 0 |
| `setSelectedIndex(idx)` | **1** | 0 | **1** | 0 |
| `setSelectedIndex(idx, false)` | 0 | 0 | 0 | 0 |
| `setValue(v)` / `setValues(vs)` | 0 | 0 | 0 | 0 |
| `"change"` / `"binding"` from `setSelectedIndex(idx)` | 1 each | 1 each | 1 each | 1 each |
| Event object an `"action"` listener receives | `CustomEvent` of type `change` | unchanged | the new value, as `string` | **`CustomEvent` of type `change`** |

### `AbstractSelectableList.setSelectedIndex`, final shape

```typescript
    if (fireEvent) {
        // The committed-value notification only. A programmatic write never
        // announces "action", which reports the user's own row gestures —
        // those route through `notifyUserChange` → `fireChange`.
        this.notifyChange(this.getValue());
    }
```

### `ComboBox.onRowSelected`, final shape

```typescript
private onRowSelected(index: number, keepOpen: boolean): void {
    this.setSelectedIndex(index, true);

    // The user's own commit, and the only place the combo box announces
    // "action". Guarded like `AbstractSelectableList.fireChange`: `fireEvent`
    // throws without an element, and a listener may dispose the combo box.
    if (this.getElement()) {
        Event.fireEvent(this, "change");
    }

    if (!keepOpen) {
        this.closeDropdown();
    }
}
```

### `ComboBox.on` / `off`, final shape

```typescript
on(event: "action" | "change" | "binding", listener: Function): this {
    if (event === "action") {
        Event.addListener(this, "change", listener as Event.Listener);

        return this;
    }

    return super.on(event as "change", listener as (value: string) => void);
}

off(event: "action" | "change" | "binding", listener: Function): this {
    if (event === "action") {
        Event.removeListener(this, "change", listener as Event.Listener);

        return this;
    }

    return super.off(event, listener);
}
```

---

## Ordered Implementation Steps

Paths under `packages/lib/src/typescript/lib/` are written `lib/…`. Each phase is test-first: write its tests, see the listed ones fail, then change the code.

### Phase 1 — `List` and `MultiSelectList` (code commit 1)

1. **Create `packages/lib/tests/component/list/ListActionDelivery.test.ts`.** Copy the mount, disposal and counting scaffolding from [`RowStateEconomy.test.ts:205-292`](packages/lib/tests/component/list/RowStateEconomy.test.ts#L205): the `CONFIG` + `installTestDOM` `beforeEach`, the `track()` / `afterEach` disposal list, the `countEvents(list)` helper returning `{ change, action }`, and `makeList` / `makeMultiSelectList` (`getElement(true)`, `setWidth`, `setHeight`, `doLayout()`). Add a `key(name)` helper shaped like [`List.test.ts:39-41`](packages/lib/tests/component/list/List.test.ts#L39). Write cases 1–7 of `## Expected Behaviour` as `it`s. Drive the user path with the public `list.handleKey(key('ArrowDown'))` — never `handleRowClick`, which also pulls DOM focus.
2. **Check** — `npx vitest run tests/component/list/ListActionDelivery.test.ts` from `packages/lib`: cases 2 and 5's zero-action halves fail; case 1's positive control passes.
3. **`lib/component/list/AbstractSelectableList.ts`** — replace `this.fireChange();` at [`:1482`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1482) with the `## Internal Structure` version (`this.notifyChange(this.getValue());` plus its comment).
4. **`AbstractSelectableList.ts`** — rewrite `setSelectedIndex`'s TSDoc ([`:1454-1465`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1454)). Drop "Optionally fires the `change` event so binding listeners run". Say instead: this is a programmatic write, so it never announces `"action"`; when `fireEvent` is `true` (the default) it fires the committed-value `"change"` and `"binding"` and updates the dirty state, and `false` makes it silent.
5. **`AbstractSelectableList.ts`** — rewrite `fireChange`'s TSDoc ([`:1759-1763`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1759)): it is the user path's dispatcher, reached only from a subclass's `notifyUserChange` after the click or keyboard reducer commits, and it fires both the DOM `change` behind `on("action", fn)` and the committed-value notification.
6. **`AbstractSelectableList.ts`** — rewrite the `on` TSDoc's first sentence ([`:1525-1531`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1525)). `"action"` is a typed semantic shorthand over {@link Event.addListener} for the DOM `change` the list fires once per user-driven selection gesture — a row click, Enter, Space, or a navigation key that moves the selection. It never fires for a programmatic write: `setSelectedIndex`, `setValue` or `setValues`. `"change"` and `"binding"` are the inherited {@link AbstractInput} listener-bag events and fire for programmatic writes too. Leave the `"contextmenu"` / `"dblclick"` paragraph as it is. Link only to public symbols, per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md).
7. **`lib/component/list/List.ts`** — rewrite `notifyUserChange`'s TSDoc ([`:143-148`](packages/lib/src/typescript/lib/component/list/List.ts#L143)) so it no longer says the split is "not from programmatic `setValue` / `setSelectedIndex(idx, false)`": every programmatic write is now silent on `"action"`, `setSelectedIndex(idx)` included.
8. **`lib/component/list/MultiSelectList.ts`** — rewrite `notifyUserChange`'s TSDoc ([`:243-247`](packages/lib/src/typescript/lib/component/list/MultiSelectList.ts#L243)) the same way.
9. **Check** — `npm test` all green; `npm run typecheck` 0 errors. Then `grep -rn 'fireChange()' packages/lib/src/typescript/lib/component/list/` — exactly three matches: the definition, `List.notifyUserChange`, `MultiSelectList.notifyUserChange`.

### Phase 2 — `ComboBox` (code commit 2)

10. **Create `packages/lib/tests/component/input/ComboBoxActionDelivery.test.ts`.** Copy the whole file header, `CONFIG`, `key()` helper, `combos[]` disposal list and `afterEach` from [`ComboBoxDropdownClose.test.ts:1-45`](packages/lib/tests/component/input/ComboBoxDropdownClose.test.ts#L1), adapting the header comment to this file's subject. Reach the dropdown through the same `(combo as unknown as { _dropdown: … })._dropdown` cast it uses. Realise the combo's element with `combo.getElement(true)` before the assertions in every case but case 14, which deliberately skips it. Write cases 8–14 as `it`s.
11. **`packages/lib/tests/component/input/ComboBox.test.ts`** — edit before the code:
    - Rename the test at [`:78`](packages/lib/tests/component/input/ComboBox.test.ts#L78) to `'setSelectedIndex fires the change bag listener with the new value by default'`, delete its `actionCount` counter and `on('action')` registration, and replace the comment at [`:83-86`](packages/lib/tests/component/input/ComboBox.test.ts#L83) with one saying `"action"` is no longer a `"change"` alias and its delivery is covered in `ComboBoxActionDelivery.test.ts`.
    - Rename the test at [`:100`](packages/lib/tests/component/input/ComboBox.test.ts#L100) to `'setSelectedIndex with fireEvent=false fires no change'` and delete its `on('action')` registration.

    Both `"action"` assertions must leave this file: its many undisposed combos make a DOM-routed zero meaningless here.[^event-window]
12. **Check** — `npx vitest run tests/component/input/ComboBoxActionDelivery.test.ts`: cases 8 and 10 fail — 8 because the listener is handed the new value instead of a DOM event, 10 because the alias still fires. Case 9 passes on both sides, since the alias also fires for an explicit commit.
13. **`lib/component/input/ComboBox.ts`** — replace `onRowSelected`'s body ([`:1081-1087`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1081)) with the `## Internal Structure` version. Extend its TSDoc ([`:1069-1080`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1069)) with a sentence saying this is the combo box's single `"action"` announcement.
14. **`ComboBox.ts`** — replace the `on` overload at [`:1128`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1128) with `on(event: "action", listener: Event.Listener): this;` and replace the `on` / `off` bodies at [`:1131-1136`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1131) and [`:1147-1149`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1147) with the `## Internal Structure` versions.
15. **`ComboBox.ts`** — rewrite the `on` TSDoc ([`:1117-1127`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1117)). `"action"` is a typed semantic shorthand over {@link Event.addListener} for the DOM `change` the combo box fires once per user commit — a row click, or Enter, Space or an arrow key on the open dropdown. It never fires for a programmatic {@link setSelectedIndex} or {@link setValue}. `"change"` and `"binding"` are the inherited {@link AbstractInput} listener-bag events; `"change"` carries the new value and fires for `setSelectedIndex` too.
16. **`ComboBox.ts`** — rewrite `setSelectedIndex`'s TSDoc ([`:1192-1197`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1192)): a programmatic write that fires the committed-value `"change"` and `"binding"` when `fireEvent` is `true` (the default), and never `"action"`. Update the `listeners` bag's `action` comment ([`:81-84`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L81)) only if it claims the alias; leave the field's type alone.
17. **`packages/lib/src/typescript/ToolBarPanel.ts`** — replace [`:83`](packages/lib/src/typescript/ToolBarPanel.ts#L83) with `zoom.on("action", () => { status("Zoom " + zoom.getValue()); });`. This is the only in-repo call site the signature change breaks.
18. **Check** — `npm test` all green; `npm run typecheck` 0 errors. Then:
    - `grep -n '"action" ? "change"' packages/lib/src/typescript/lib/component/input/ComboBox.ts` — zero matches.
    - `grep -rn 'on("action", (' packages/lib/src/typescript/ToolBarPanel.ts` — zero matches.

### Phase 3 — documentation and records

19. Apply every change listed in `## Documentation Impact`.
20. **Check** — `npm run docs:api` shows no warning beyond `master`'s pre-existing set, and none naming `List`, `MultiSelectList`, `AbstractSelectableList` or `ComboBox`. `npm run docs:llms:check` passes. `npm run lint` 0 errors.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/List.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/MultiSelectList.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `packages/lib/src/typescript/ToolBarPanel.ts` |
| Create | `packages/lib/tests/component/list/ListActionDelivery.test.ts` |
| Create | `packages/lib/tests/component/input/ComboBoxActionDelivery.test.ts` |
| Modify | `packages/lib/tests/component/input/ComboBox.test.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/concepts/events.md` |
| Modify | `packages/lib/docs/components/List.md` |
| Modify | `packages/lib/docs/components/MultiSelectList.md` |
| Modify | `packages/lib/docs/components/ComboBox.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |
| Modify | `plans/research/render-review-2026-09-15/00-post-campaign-agenda.md` |
| Modify | `plans/research/render-review-2026-09-15/01-phase2-status-pass.md` |

---

## Expected Behaviour

Cases 1–14 are unit-testable offline in `packages/lib`; case 15 is a compile-time check. "Mounted" means the element is realised and the instance is disposed in `afterEach`, so `Event`'s window listener belongs to the current case's window.[^event-window] "An action" means one call of a listener registered with `on("action", …)`.

**`List` and `MultiSelectList` (Phase 1, new file)**

1. On a mounted `List` of six rows with nothing selected, `list.handleKey(key('ArrowDown'))` selects row 0 and delivers one action and one `"change"`. *(Positive control: it must read 1, or every zero below is meaningless.)*
2. On the same list, `list.setSelectedIndex(2)` delivers **zero** actions, one `"change"` carrying the row-2 key, and one `"binding"`.
3. `list.setSelectedIndex(2, false)` delivers zero actions, zero `"change"` and zero `"binding"`.
4. `list.setValue(<row-3 key>)` delivers zero actions, zero `"change"` and zero `"binding"`.
5. On a mounted `MultiSelectList`, `handleKey(key('ArrowDown'))` delivers one action; `setSelectedIndex(1)` delivers zero actions and one `"change"`; `setValues([])` delivers zero of both.
6. After `list.markClean()`, `list.setSelectedIndex(2)` leaves `list.isDirty()` true — `notifyChange` still runs, so dirty tracking is untouched.
7. On an **unmounted** `List`, `setSelectedIndex(1)` does not throw, fires one `"change"`, and delivers zero actions.

**`ComboBox` (Phase 2, new file)**

8. On a mounted combo box with items `[{ key: 'x', label: 'X' }, { key: 'y', label: 'Y' }]`, `combo.openDropdown()` then `dropdown.handleKey(key('ArrowDown'))` delivers exactly one action. The listener's argument has `type === "change"`, and `combo.getValue()` inside the listener already returns `'y'`. *(Positive control.)*
9. A following `dropdown.handleKey(key('Enter'))` on the already-selected row delivers one more action — an explicit commit always announces. This passes before and after the change; it pins that the fix does not silence a re-commit.
10. `combo.setSelectedIndex(1)` delivers **zero** actions, one `"change"` carrying `'y'`, and one `"binding"`.
11. `combo.setSelectedIndex(1, false)` delivers zero actions and zero `"change"`.
12. `combo.setValue('y')` delivers zero actions, zero `"change"` and zero `"binding"`, and `combo.getValue()` returns `'y'`.
13. After `combo.off("action", first)`, a row commit delivers zero to `first` while a second, still-registered listener reads 1.
14. On a combo box built under an installed TestDOM but with no call to `getElement(true)` — the shape [`ComboBox.test.ts:78`](packages/lib/tests/component/input/ComboBox.test.ts#L78) already uses — `setSelectedIndex(1)` does not throw and fires one `"change"`.

**Compile-time**

15. `combo.on("action", (value: string) => …)` no longer type-checks, since `Event.Listener` takes an event. `npm run typecheck` is the check; [`ToolBarPanel.ts:83`](packages/lib/src/typescript/ToolBarPanel.ts#L83) is the only site it flags.

---

## Verification

- `npm run typecheck` — 0 errors, after each phase.
- `npm test` — all green, after each phase; cases 1–14 are the new coverage.
- `npm run lint` — 0 errors.
- The grep checks in steps 9 and 18.
- `npm run docs:api` — no warning beyond `master`'s pre-existing set. The bar is "no new warning", not zero.
- `npm run docs:llms:check` — passes. No class summary line changes, so `llms.txt` needs no regeneration.
- No manual verification is required: every behaviour this plan changes is reachable offline through `handleKey` and the dropdown's `handleKey`.

---

## Documentation Impact

**TSDoc.** Four public members' docs change and render through TypeDoc: `AbstractSelectableList.setSelectedIndex` (step 4), `AbstractSelectableList.on` (step 6), `ComboBox.on` (step 15) and `ComboBox.setSelectedIndex` (step 16). Four internal ones change too and do not render: `AbstractSelectableList.fireChange` (step 5), `List.notifyUserChange` (step 7), `MultiSelectList.notifyUserChange` (step 8) and `ComboBox.onRowSelected` (step 13). No new symbol is exported, so no barrel or catalogue entry changes.

**ARCHITECTURE.md**

- [Line 19](ARCHITECTURE.md#L19), in the list of `"action"` shorthands: `ComboBox.on("action", fn)` becomes "(DOM `change`)", replacing "(an alias of its `ListenerBag` `"change"`)".
- [Line 21](ARCHITECTURE.md#L21): delete the closing sentence naming `List.setSelectedIndex` and `ComboBox.setSelectedIndex` as a known deviation. In the same paragraph's list of activation paths, add `List`'s and `MultiSelectList`'s click and keyboard reducers beside `Checkbox.activate` and `Slider`'s handlers. The paragraph then states the rule with no exception left.

**Doc pages**

- [`docs/concepts/events.md:23-46`](packages/lib/docs/concepts/events.md#L23):
  - At `:27`, `ComboBox.on("action", fn)` wraps a DOM `change`, not an alias of its `"change"`.
  - Delete the whole exception paragraph at `:43-46`.
  - Add one sentence to the `:32-41` paragraph instead: a list's or combo box's `setSelectedIndex` is a programmatic write like any other — it fires `"change"` and `"binding"`, never `"action"`, and its second argument `false` suppresses those two as well.
- [`docs/components/List.md`](packages/lib/docs/components/List.md):
  - Replace the `Event.addListener(fruits, 'change', …)` call in the usage example (`:14`, `:22-24`) with `fruits.on('action', …)`, and drop the now-unused `Event` import from that block. Reaching for the `Event` API against another component is what [ARCHITECTURE.md](ARCHITECTURE.md) forbids, and `on("action", fn)` is the surface the class exposes for it.
  - Add a short **Selection events** section after *Keyboard*: `on("action", fn)` fires once per user-driven selection — a row click, Enter, Space, or an arrow key that moves the selection — and never for `setSelectedIndex` or `setValue`; `on("change", fn)` carries the committed value and fires for the user's gestures **and** your own `setSelectedIndex` calls. Give it this example, and cross-link [`Checkbox`](/components/Checkbox) and [`Slider`](/components/Slider) as following the same contract:

    ```typescript
    fruits.on("action", () => console.log("user picked:", fruits.getValue()));
    fruits.on("change", value => console.log("now:", value));

    fruits.setSelectedIndex(1);        // "change" and "binding" only
    fruits.setSelectedIndex(1, false); // nothing at all
    ```
  - At `:45`, the sentence about navigation keys firing no `change` stays correct; add that a clamped key announces no `"action"` either.
- [`docs/components/MultiSelectList.md`](packages/lib/docs/components/MultiSelectList.md) — apply the same two edits: rewrite the `Event.addListener(tags, 'change', …)` usage example (`:20`) as `tags.on('action', …)`, and add the `setValues` / `setSelectedIndex` half of the rule to the `:49` method-table row.
- [`docs/components/ComboBox.md`](packages/lib/docs/components/ComboBox.md):
  - Replace the `Event.addListener(role, 'change', …)` call in the *Static items* example (`:18`, `:23-29`) with `role.on('action', …)`, dropping the `Event` import. The call being replaced never fired at all: `ComboBox` dispatched no DOM `change`, so that listener was dead on the page. `on("action", fn)` is the surface that does fire.
  - Add a **Selection events** section after *Common methods*, in the same shape as `List.md`'s: `on("action", fn)` for the user's own commits, `on("change", fn)` for those plus `setSelectedIndex`, and a note that `setValue` fires neither.
  - In the *Common methods* table (`:94`), the `setSelectedIndex(i)` row gains "fires `"change"`, never `"action"`; pass `false` as a second argument for a silent write".
- `docs/reference/changelog/next.md` — add under `## Breaking changes` → `### Components`, after the `Checkbox` and `Slider` bullet ([`:65-76`](packages/lib/docs/reference/changelog/next.md#L65)): **`List`, `MultiSelectList` and `ComboBox` fire `"action"` for the user's own selections only.** State the old behaviour (`setSelectedIndex(idx)` announced `"action"` on its default path), the new one (it fires `"change"` and `"binding"` as before, and nothing else), and that a `ComboBox` `"action"` listener now receives a DOM `change` event instead of the new value as a `string`. Link [Migration](/reference/migration/next).
- `docs/reference/migration/next.md` — append a section **`List` and `ComboBox` fire `"action"` for user selections only**, directly after the `Checkbox` and `Slider` section ([`:114-143`](packages/lib/docs/reference/migration/next.md#L114)) and in the same *What changed and why* / *Who needs to act* shape:
  - *What changed and why:* these were the last two controls whose `"action"` announced a programmatic write. `ComboBox`'s `"action"` was also not a DOM shorthand at all but an alias of its listener-bag `"change"`, so it was the one control of the family whose listener received a value.
  - *Who needs to act:* a consumer that relied on `"action"` after its own `setSelectedIndex` subscribes to `"change"`. A `ComboBox` `"action"` listener that used its argument reads `combo.getValue()` instead. Give the before/after block from `## Architecture Decisions`.

**Records**

- `plans/research/render-review-2026-09-15/01-phase2-status-pass.md` — the `List.setSelectedIndex` / `ComboBox.setSelectedIndex` bullet at [`:408-414`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md#L408): append a bold **Fixed by `plans/implemented/programmatic-selection-action.md`**, dated the day it lands, in the style of the `Slider.setValue` bullet above it. Say that the `fireEvent` flag was kept, now gating the committed-value notification alone, and that `ComboBox`'s `"action"` became a DOM `change` shorthand whose listener argument changed.
- `plans/research/render-review-2026-09-15/00-post-campaign-agenda.md` — the bullet at [`:224-228`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L224): replace "— open." with "— fixed by `plans/implemented/programmatic-selection-action.md`." and keep the rest of the text.

---

## Potential Challenges

- **A zero can pass for the wrong reason.** `Event` keeps each DOM event type's window listener bound to the window of the first case that registered it, so a later case can dispatch into nothing.[^event-window] Both new files dispose every instance in `afterEach`, and each contains a positive control (cases 1 and 8) that must read 1.
- **`ComboBox.test.ts` cannot hold an `"action"` assertion at all.** Its combos are never disposed, and its own sibling file's header documents the consequence. Step 11 moves both assertions out rather than trying to make them reliable in place.
- **`ComboBox`'s inner list is already driven silently.** Every internal `getList().setSelectedIndex(…)` call passes `false` ([`:276`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L276), [`:1202`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1202), [`:1407`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1407)), so the Phase 1 change cannot make the dropdown's own `_list.on("action")` wiring fire more or less often. Do not "simplify" any of those `false` arguments away.
- **`refreshLabel` must keep running on a programmatic write.** It sits outside the `fireEvent` branch in `ComboBox.setSelectedIndex` and stays there; only `onRowSelected` gains a line.
- **The `zoom` combo's status line already prints a positional key, and step 17 keeps it that way.** `ToolBarPanel`'s items are plain strings, so their keys are array indices and `getValue()` returns `"2"` for `"100%"` — which is exactly what the deleted `(value: string)` parameter carried. Substituting `zoom.getValue()` therefore preserves the demo's current output. Do not "fix" it to print the label; that is a separate demo change this plan does not make.

---

## Critical Files

| File | Why |
|---|---|
| [`plans/implemented/checkbox-action-activation.md`](plans/implemented/checkbox-action-activation.md) | The contract this plan extends, and the precedent for every decision in it. |
| [`lib/component/list/AbstractSelectableList.ts:1454-1486`, `:1525-1587`, `:1759-1772`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1454) | `setSelectedIndex`, the `on` / `off` pair, and `fireChange` — the one line to change and the shorthand to leave alone. |
| [`lib/component/input/Slider.ts:622-638`](packages/lib/src/typescript/lib/component/input/Slider.ts#L622) | `setValueFromUser`: the "setter mutates, activation path dispatches" split this plan mirrors. |
| [`lib/component/input/ComboBox.ts:1069-1150`, `:1191-1211`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1069) | `onRowSelected`, the `on` / `off` pair and `setSelectedIndex`. |
| [`lib/component/input/ComboBox.ts:200-228`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L200) | `ComboBoxDropdown`'s own `_list.on("action")` wiring — the in-library consumer of the Phase 1 change. |
| [`lib/component/input/AutoCompleteDropdown.ts:110-136`](packages/lib/src/typescript/lib/component/input/AutoCompleteDropdown.ts#L110) | The second in-library `List` `"action"` consumer; its comment already describes the contract this plan makes true. |
| [`lib/core/Event.ts:248-300`, `:386-411`](packages/lib/src/typescript/lib/core/Event.ts#L248) | Exact-target matching, and `fireEvent`'s throw on a missing element. |
| [`tests/component/list/RowStateEconomy.test.ts:205-292`](packages/lib/tests/component/list/RowStateEconomy.test.ts#L205) | The mount, disposal and `countEvents` scaffolding Phase 1's new file copies. |
| [`tests/component/input/ComboBoxDropdownClose.test.ts:1-100`](packages/lib/tests/component/input/ComboBoxDropdownClose.test.ts#L1) | The file-isolation ritual and the `openDropdown` + `dropdown.handleKey` harness Phase 2's new file copies. |
| [`ARCHITECTURE.md:19-21`](ARCHITECTURE.md#L19) | The `"action"` shorthand rule and the deviation sentence this plan deletes. |

---

## Non-Goals

- **Changing what `ComboBox.setValue` fires.** It stays silent on all three events.[^setvalue-silent]
- **Harmonising the order `"action"` and `"change"` fire in.** `List` keeps announcing `"action"` first on a user commit; nothing depends on the relative order and changing it is a behaviour change nobody asked for.[^listener-order]
- **Renaming or removing `setSelectedIndex`'s `fireEvent` parameter.** It still has a job, and both classes now mean the same thing by it.[^flag-name]
- **F16.2, the combo box's duplicated row-class pass.** `ComboBox.setSelectedIndex` re-commits a selection the inner list just made ([`16-inputs-combo-spinner-file.md:115-180`](plans/research/render-review-2026-09-15/16-inputs-combo-spinner-file.md#L115)). It is a write-economy defect with its own proposed fix, and this plan's one added line does not touch it.
- **Re-checking the element in `Checkbox.activate`, `Slider`, `RadioButton` and `ToggleButton`.** The post-merge audit recorded those four as one change of their own; `ComboBox.onRowSelected` is written guarded here only because it is new code in a family whose guarded precedent sits two files away.
- **A QA-app witness.** Every behaviour is covered offline, and `packages/qa`'s `form-flat` has no `"action"` listener on its combo box, so nothing there changes.
- **Touching Loom or SQLAdmin.** Neither needs an edit.[^migration-cost]

---

## Notes

[^contract-settled]: `plans/implemented/checkbox-action-activation.md`'s first decision — "`"action"` reports user activations only" — was flagged there as needing the user's approval, and it was approved and merged. Its `## Non-Goals` records `List` / `ComboBox` as deferred rather than exempt, `ARCHITECTURE.md:21` writes the deferral into the binding rule doc ("to be brought in line by their own change"), and `01-phase2-status-pass.md:408` and `00-post-campaign-agenda.md:224` both carry it as an open item. That plan's stated reason for deferring was mechanical, not a doubt about the rule: the `fireEvent` flag also gates `"change"`, which live callers rely on, and `ComboBox`'s listener argument would change. This plan resolves both — the flag keeps its `"change"` half, and the argument change is the declared breaking change.

[^flag-name]: `fireEvent` reads as if it gated a DOM `Event`, and after this change it gates only the listener-bag notification. Renaming it to `fireChange` was considered and rejected on three grounds. First, the existing TSDoc on both classes already describes it as firing "the `change` event", meaning the semantic one, so the name is accurate for what survives. Second, `ComboBox.setSelectedIndex(idx, fireEvent)` already had exactly this meaning and this name, so keeping it makes the two classes agree instead of splitting them. Third, a rename would churn every call site in the repo and in SQLAdmin (`QueriesView.ts:258`, `:311`) for no behaviour gain, against the repo's surgical-change rule. The default stays `true` for the same reason: SQLAdmin passes it explicitly, and every in-repo programmatic call already passes `false`.

[^combobox-dom]: `ComboBox` was the only control in the `"action"` family whose shorthand was not a DOM shorthand at all. `ARCHITECTURE.md:19` requires `"action"` to be "sugar over the DOM surface, not the custom-event machinery", and `Checkbox`, `RadioButton`, `ToggleButton` and `List` all wrap a DOM `change`. Keeping the alias and adding a second listener-bag event named `"action"` was the alternative: it would preserve the value argument, but it would need a `ComboBoxEvent` union, an `emit` and a `ListenerBag` entry for an event the rule says must not have one, and it would leave `ComboBox` the family's odd one out for a second reason after fixing the first. The value argument is recoverable in one call (`combo.getValue()`), and the compiler names every site that used it, so the migration is mechanical.

[^dispose-guard]: `Event.fireEvent` throws when the component has no element ([`core/Event.ts:399-404`](packages/lib/src/typescript/lib/core/Event.ts#L399)). The post-merge audit of `checkbox-action-activation` recorded four unguarded activation dispatches (`Checkbox.activate`, `Slider`'s user path, `RadioButton.ts:334`, `ToggleButton.ts:284`) where a `"change"` listener that disposes the control makes the throw abort the rest of the fan-out, and named `AbstractSelectableList.fireChange` as the guarded precedent to copy. `ComboBox.onRowSelected` runs after `setSelectedIndex` has already notified `"change"` and `"binding"`, so a listener disposing the combo box there is the exact exposure. Writing the new dispatch guarded costs one `if` and keeps `ComboBox` out of the follow-up that fixes the other four.

[^setvalue-silent]: `ComboBox.setValue` delegates to the inner list's `setValue`, which calls `setSelectedIndex(idx, false)`, and never calls `notifyChange` itself. `List.setValue` and `MultiSelectList.setValues` are silent the same way. So the whole family treats a value write as silent and an index write as notifying, which is a coherent existing contract, and SQLAdmin depends on it: `diagramShell.ts:294` documents in a comment that a programmatic `ComboBox.setValue` fires no `"change"` and relies on that to avoid re-entering `chooseRoot`. Whether a `Binding` write through `setValue` should notify at all is a separate question about `Bindable` conformance, not about `"action"`.

[^listener-order]: On a user commit `List` runs `fireChange()`, which dispatches the DOM `change` before calling `notifyChange`, so `"action"` listeners run before `"change"` ones. Every other control in the family is the other way round: `Checkbox.activate`, `Slider.setValueFromUser` and `RadioButton.activate` all write the value (firing `"change"` and `"binding"`) and then dispatch. `ComboBox.onRowSelected` lands on the second shape naturally, since `setSelectedIndex` notifies first. Swapping the two lines inside `fireChange` would align `List` too, and is behaviourally safe — the selection set is already committed before either fires, so every listener reads the same value either way. It is left undone because it changes observable behaviour no consumer asked about: the repo's surgical-change rule puts an unrequested reorder outside this plan.

[^migration-cost]: A type-aware survey of both sibling checkouts found no edit needed in either. **Loom** (`/home/jika/typescript/loom/src`) has one `List` `"action"` subscriber, `CommandPalette.ts:78` (`this._resultsList.on('action', () => this.handleCommit())`), which wants user commits only; it drives the list with `setItemsArray`, `setFocusedIndex` and `handleKey` and never calls `setSelectedIndex`. Loom uses no `ComboBox` and no `MultiSelectList`. **SQLAdmin** (`/home/jika/typescript/sqladmin/frontend/src`) has no `List` or `ComboBox` `"action"` subscriber at all — every `on("action")` there is on a `Button`, `ToggleButton` or `Link`. Its two programmatic selections, `QueriesView.ts:258` and `:311`, pass `fireEvent: true` to arm the header tools through `list.on("change", syncTools)` at `:222`; that listener is the listener-bag `"change"`, which this plan leaves firing. Its combo boxes all subscribe with `on("change", (v: string) => …)`. Inside this repo the only affected call site is `ToolBarPanel.ts:83`; the docs demos (`list-selection.ts`, `multiselectlist-selection.ts`, `combobox-store.ts`) and the `packages/qa` panels use `"change"` or no listener at all.

[^event-window]: `Event` installs one window-level listener per DOM event type on first registration and remembers it in module state that survives `DOM.reset()`. A file whose earlier cases leave instances undisposed keeps `"change"` marked installed against a dead window, so every later case in that file dispatches into nothing and each "zero actions" assertion passes vacuously. `ComboBoxDropdownClose.test.ts` was split out of `ComboBox.test.ts` for exactly this reason and says so in its header; `RowStateEconomy.test.ts:256-262` and `Link.test.ts` document the same trap. Disposing every instance in `afterEach` purges the registrations and uninstalls the base listener with them.
