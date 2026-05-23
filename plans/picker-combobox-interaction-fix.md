# Picker / ComboBox Interaction Fix — Implementation Plan

## Overview

When a `ComboBox` is hosted inside a `TimePickerDropdown`, `DatePickerDropdown`, or `DateTimePickerDropdown`, opening the combo dismisses **both** dropdowns: the picker's viewport-level `pointerdown` handler considers the click "outside" because the `ComboBoxDropdown` element is appended to `document.documentElement`, not to the picker's own DOM subtree. The picker hides, which destroys the combo with it, so the user never gets to pick a value.

The bug lives in three identical handlers: [component/input/TimeField.ts:260](../src/typescript/lib/component/input/TimeField.ts#L260), [component/input/DateField.ts:254](../src/typescript/lib/component/input/DateField.ts#L254), and [component/input/DateTimeField.ts:258](../src/typescript/lib/component/input/DateTimeField.ts#L258). Each checks only two ancestors — the field's own root and `this._dropdown.getElement()` — and closes the dropdown otherwise. `Popover._onViewportMouseDown` at [core/Popover.ts:183](../src/typescript/lib/core/Popover.ts#L183) has the same shape and the same latent bug.

`ComboBoxDropdown` and the picker dropdowns both extend [core/AnimatedDropdown.ts:187](../src/typescript/lib/core/AnimatedDropdown.ts#L187), which mounts the panel via `document.documentElement.appendChild(el)` at line 193–195. Body-mounted floating panels are an architectural choice (z-index isolation, no overflow clipping) and won't change. The fix is to teach the picker's "outside" check that a body-mounted descendant dropdown counts as inside.

---

## Architecture Decisions

### Solution shape: a transient-layer parent/child registry

Three candidate fixes were considered:

| Option | Verdict |
|---|---|
| **A. Re-parent the `ComboBoxDropdown` element into the picker's dropdown subtree** when shown from inside another `AnimatedDropdown`. | **Rejected.** Breaks `position: fixed` clipping semantics when the picker dropdown lives inside a transformed/contain:layout ancestor, and forces every picker-internal subdropdown to know it might be nested. Also runs against the framework's "one DOM element per class" boundary — the dropdown would have two valid parents depending on context. |
| **B. DOM ancestor walk in each picker's `onViewportPointerDown`.** Add a third check: walk the click target's ancestor chain looking for any element belonging to an `AnimatedDropdown` instance whose owner descends from `this`. | **Rejected.** Requires a `data-*` attribute or `WeakMap<Element, AnimatedDropdown>` lookup at every viewport pointerdown, plus per-call-site copy of the same walk in three picker fields and the Popover. Brittle when a fourth host adopts the pattern. |
| **C. A small `TransientLayerStack` registry in `core/AnimatedDropdown.ts`** with parent/child links. `showAnimated` pushes itself onto the stack with its parent (the currently-topmost layer at show-time, if any). Hosts query "does this DOM target belong to me or any of my descendant layers?" before dismissing. | **Chosen.** One module owns the rule; every `AnimatedDropdown` subclass and every host benefits without duplication; the registry is the natural seam for any future "nested transient layers" rule (e.g. menu opening a confirmation popover). |

Option C also matches the auth memory's `addSubtreeListener` note ("listeners on a parent that catch events from children"): conceptually, the picker wants a subtree-aware check at the *layer* level, not the DOM level. The DOM subtree is split across two `document.documentElement` children; the *layer* tree is a single chain.

### The registry lives on `AnimatedDropdown`, not on a new module

Every layer involved (`ComboBoxDropdown`, `TimePickerDropdown`, `DatePickerDropdown`, `DateTimePickerDropdown`, future `AutoCompleteDropdown` etc.) already extends `AnimatedDropdown`. The `Popover` class does not — it has its own dismiss path at [core/Popover.ts:183](../src/typescript/lib/core/Popover.ts#L183) and its own lifecycle. **Decision:** the registry lives as a private module-level `WeakMap` and a small public surface inside [core/AnimatedDropdown.ts](../src/typescript/lib/core/AnimatedDropdown.ts). Popover migration is **out of scope** (see `## Non-Goals`); the same bug exists there in principle but no caller hits it today.

A separate `core/TransientLayerStack.ts` module was considered and rejected: the registry is six fields and four methods, and every caller already imports `AnimatedDropdown`. Splitting it across a new file would add an import without sharpening any boundary.

### Parent inference is "topmost open layer at show-time"

When `AnimatedDropdown.showAnimated()` runs, the dropdown's *parent layer* is whichever `AnimatedDropdown` is currently the topmost open one (i.e. the last one pushed onto the stack that's still open). This is exactly the layer whose `onViewportPointerDown` would otherwise mis-fire, so it's the layer that needs to see the new dropdown as a descendant.

A more principled alternative — walking the *host* component's ancestor chain looking for an `AnimatedDropdown` — was considered but rejected. The host is the `ComboBox` instance, which lives inside the *content* of the `TimePickerDropdown`, but it's not a structural child of the dropdown in the Component tree (or only is when the picker dropdown's body lays it out — fragile to query). The stack discipline is simpler and exactly matches the call order: the picker dropdown opens first, then the combo opens while the picker is the current top.

This is correct as long as nested dropdowns open strictly LIFO, which they do — every opener (`onButtonClick`, `toggleDropdown`) only fires from inside its host's listeners while that host is open. If a future call site violates LIFO, the registry will need an explicit `parent` parameter; that's a small, local change and is called out in `## Potential Challenges`.

### The check goes inside the host, not inside `AnimatedDropdown`

Each picker field continues to own its `onViewportPointerDown`. Pushing the dismiss decision *into* `AnimatedDropdown` would require AnimatedDropdown to know its host's "self element" (the field root), which it does not today and shouldn't, because each host wires its own viewport listener with its own escape criteria (e.g. the field root, the input, the trigger button). The clean surface is a single helper — `AnimatedDropdown.isTargetInsideLayer(layer, target)` — that the host calls in addition to its existing two checks.

### `Event.addSubtreeListener` is not the right tool here

The dispatch architecture already maps a real DOM subtree (a Component's element tree). The combo's dropdown lives in a *different* subtree (`document.documentElement` ← combo dropdown ← ...), so `addSubtreeListener` registered on the picker dropdown wouldn't catch it either. The layer registry is what bridges the two subtrees logically without re-parenting them physically.

---

## Public API (TypeScript Signatures)

### New surface on `core/AnimatedDropdown.ts`

```typescript
class AnimatedDropdown<TOptions extends AnimatedDropdownOptions = AnimatedDropdownOptions> extends Component<TOptions> {
    // …existing members…

    /**
     * Returns true when `target` is a descendant of `layer`'s element or any
     * descendant layer's element. Used by hosts that wire a viewport
     * pointerdown listener to dismiss themselves when the click lands outside —
     * a click inside a child layer (e.g. a ComboBox dropdown opened from inside
     * a TimePickerDropdown) must count as inside.
     *
     * @param layer  - The layer to test containment for.
     * @param target - The DOM node receiving the click.
     */
    static isTargetInsideLayer(layer: AnimatedDropdown, target: Node): boolean;

    /**
     * Returns the topmost currently-open AnimatedDropdown, or null when no
     * layer is open. Test seam; the bug fix does not consume it directly.
     */
    static getTopLayer(): AnimatedDropdown | null;
}
```

Both are `static` rather than instance methods because callers don't always hold an instance reference — the helper is "stack-level," not "this-layer-level."

### Host changes (private, no exported API drift)

`TimeField.onViewportPointerDown`, `DateField.onViewportPointerDown`, `DateTimeField.onViewportPointerDown` each grow one extra branch:

```typescript
// inside onViewportPointerDown, after the existing two checks
if (this._dropdown && AnimatedDropdown.isTargetInsideLayer(this._dropdown, target)) {
    return;
}
this.closeDropdown();
```

The two existing `dropEl.contains(target)` and `this.getElement()?.contains(target)` checks become redundant in the picker dropdown case (the new helper subsumes them for the layer) but stay in place for the field root, which is *not* a layer. The cleanest restatement: the new branch *replaces* the old `dropEl.contains(target)` check; the field-root check remains.

---

## Internal Structure

### Registry shape

```typescript
// module-level inside core/AnimatedDropdown.ts

interface LayerEntry {
    layer:    AnimatedDropdown;
    children: AnimatedDropdown[];
}

// Stack of currently-open layers in open order (LIFO).
const _openLayers: LayerEntry[] = [];

// Reverse index for O(1) lookup when an arbitrary layer asks "am I open?".
const _entryByLayer: WeakMap<AnimatedDropdown, LayerEntry> = new WeakMap();
```

`showAnimated` pushes; `hideAnimated`'s `finalize` pops. The `_dismissing` re-entrancy already in place at [core/AnimatedDropdown.ts:241](../src/typescript/lib/core/AnimatedDropdown.ts#L241) is unaffected — the push/pop happens around the same lifecycle boundaries.

### Push/pop logic

```typescript
// At the top of showAnimated, before the existing _dismissing reset:
if (!_entryByLayer.has(this)) {
    const parent = _openLayers[_openLayers.length - 1];
    const entry: LayerEntry = { layer: this, children: [] };
    _openLayers.push(entry);
    _entryByLayer.set(this, entry);
    if (parent) {
        parent.children.push(this);
    }
}

// Inside the existing `finalize` closure in hideAnimated, after removeElement():
const entry = _entryByLayer.get(this);
if (entry) {
    _entryByLayer.delete(this);
    // Remove from the parent's child list, if there is one.
    const parentIdx = _openLayers.indexOf(entry) - 1;
    if (parentIdx >= 0) {
        const parent = _openLayers[parentIdx];
        const ci = parent.children.indexOf(this);
        if (ci >= 0) parent.children.splice(ci, 1);
    }
    // Remove this entry.
    const idx = _openLayers.indexOf(entry);
    if (idx >= 0) _openLayers.splice(idx, 1);
}
```

The `_dismissing` early-return at line 249 means a re-show during fade-out cancels the detach but **does not** re-push (the entry is still present). That's correct.

### `isTargetInsideLayer` body

```typescript
static isTargetInsideLayer(layer: AnimatedDropdown, target: Node): boolean {
    const el = layer.getElement();
    if (el && el.contains(target)) {
        return true;
    }
    const entry = _entryByLayer.get(layer);
    if (!entry) {
        return false;
    }
    for (const child of entry.children) {
        if (AnimatedDropdown.isTargetInsideLayer(child, target)) {
            return true;
        }
    }
    return false;
}
```

Recursive on `children`; depth is bounded by nesting (in practice ≤ 2). No allocation on the hot path.

---

## Ordered Implementation Steps

1. **Extend `core/AnimatedDropdown.ts` with the registry.**
   - Add module-level `_openLayers` and `_entryByLayer` declarations next to the existing `_dismissingByComponent` `WeakMap` at [core/AnimatedDropdown.ts:19](../src/typescript/lib/core/AnimatedDropdown.ts#L19).
   - Insert the push logic at the top of `showAnimated` (before `this._dismissing = false`).
   - Insert the pop logic inside the existing `finalize` closure in `hideAnimated`, after `this.removeElement()`.
   - Add the `static isTargetInsideLayer` and `static getTopLayer` methods on the class.
   - **Verify:** `npm run typecheck` passes; no other class depends on AnimatedDropdown's internal shape.

2. **Update `component/input/TimeField.ts`'s `onViewportPointerDown` ([component/input/TimeField.ts:260](../src/typescript/lib/component/input/TimeField.ts#L260)).**
   - Import `AnimatedDropdown` from `~/core/AnimatedDropdown.js`.
   - Replace `if (dropEl?.contains(target)) { return; }` with `if (this._dropdown && AnimatedDropdown.isTargetInsideLayer(this._dropdown, target)) { return; }`.
   - Keep the field-root check unchanged.
   - **Verify:** open the time picker, click an in-picker control — picker stays open (regression check, since the layer helper subsumes the old self-contains check).

3. **Update `component/input/DateField.ts`'s `onViewportPointerDown` ([component/input/DateField.ts:254](../src/typescript/lib/component/input/DateField.ts#L254)).** Same edit as step 2.

4. **Update `component/input/DateTimeField.ts`'s `onViewportPointerDown` ([component/input/DateTimeField.ts:258](../src/typescript/lib/component/input/DateTimeField.ts#L258)).** Same edit as step 2.

5. **Add a demo screen exercising the bug fix** to `src/typescript/MiscPanel.ts`, just after the existing AnimatedDropdown picker demo block at line 738. Place a `DateTimeField` next to a `ComboBox` that hosts a small set (e.g. `["UTC", "Europe/Stockholm", "America/New_York"]`), arranged so the ComboBox is reachable from inside the picker dropdown body. **Important:** the goal is to verify the *combination*, so the demo must put the ComboBox **inside the picker dropdown's content** — the cleanest path is to extend `DateTimePickerDropdown` with an optional trailing-row ComboBox slot wired through the demo only, or to construct a one-off subclass in the demo file. Pick the lighter option after reading the dropdown's constructor.
   - **Verify:** open the picker, click the ComboBox surface — *the combo opens; the picker stays open*. Pick a combo option — combo closes, picker stays open. Click outside both — both close.

6. **Run `npm run typecheck`** and **`graphify update .`** to refresh the knowledge graph (Communities 14 / 24 / 29 / 31 / 35–37 should pick up the new edge into Community 11 via `AnimatedDropdown.isTargetInsideLayer`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [core/AnimatedDropdown.ts](../src/typescript/lib/core/AnimatedDropdown.ts) |
| Modify | [component/input/TimeField.ts](../src/typescript/lib/component/input/TimeField.ts) |
| Modify | [component/input/DateField.ts](../src/typescript/lib/component/input/DateField.ts) |
| Modify | [component/input/DateTimeField.ts](../src/typescript/lib/component/input/DateTimeField.ts) |
| Modify | [MiscPanel.ts](../src/typescript/MiscPanel.ts) (demo screen) |

No new files, no deletions, no backwards-compat shims.

---

## Verification

- **Typecheck:** `npm run typecheck` — 0 errors.
- **Manual smoke (MiscPanel):**
  1. Click the date-time field button → picker dropdown opens.
  2. Click the embedded ComboBox surface → combo dropdown opens **and picker dropdown stays open**.
  3. Click a row inside the combo dropdown → combo closes; picker still open; combo value updated.
  4. Click outside both → both close.
  5. Click outside while only the picker is open (no combo opened first) → picker closes (regression).
  6. Open picker, open combo, click in the picker's body but outside the combo → combo closes (its own viewport listener fires and the picker dropdown is *its* parent layer, so the picker-body click is inside the parent only, not inside the combo). Picker stays open.
- **Theme toggle:** open both layers, toggle light/dark — no visual artifacts; both layers re-render correctly.
- **Docs:** `npm run docs:build` — 0 errors, 0 link warnings (only acceptable warning: typedoc's "unsupported TypeScript version" notice).
- **Graph refresh:** `graphify update --directed .` — the new `AnimatedDropdown.isTargetInsideLayer` edges show up from the three picker fields.

---

## Potential Challenges

- **LIFO assumption.** The "current top is the parent" inference holds only if dropdowns open strictly nested. A future caller that opens layer B while layer A is open but expects A to be unrelated to B will get an incorrect parent link. **Mitigation:** if/when that case appears, extend `showAnimated` to accept an optional `parent: AnimatedDropdown | null` argument that overrides the inference.
- **Mid-fade re-show.** `showAnimated` during an in-flight fade-out cancels the detach via `_dismissing = false` ([core/AnimatedDropdown.ts:249](../src/typescript/lib/core/AnimatedDropdown.ts#L249)). The registry entry is still present from the original push, so the proposed `if (!_entryByLayer.has(this))` guard correctly skips a duplicate push.
- **`onHideComplete` overrides.** Any subclass overriding `onHideComplete` already runs *after* `finalize`; the pop happens inside `finalize` *before* `onHideComplete`, so a subclass that consults the registry from `onHideComplete` will see itself as already-popped. That's the correct order — the layer is no longer "open" at that point.
- **Popover parity.** [core/Popover.ts:183](../src/typescript/lib/core/Popover.ts#L183) has the same logical shape but does not extend `AnimatedDropdown`. No reachable user-visible bug exists today (nothing nests a layer inside a Popover), so the migration is deferred. If a future Popover hosts a ComboBox, the same `isTargetInsideLayer` call can be added once `Popover` either extends `AnimatedDropdown` or registers itself manually.

---

## Critical Files

- [core/AnimatedDropdown.ts](../src/typescript/lib/core/AnimatedDropdown.ts) — the lifecycle owner; read the existing `_dismissing` flag pattern at lines 95–96 and 241–256 before adding the registry, to keep the new logic aligned with the same re-entrancy guard.
- [component/input/ComboBox.ts:537](../src/typescript/lib/component/input/ComboBox.ts#L537) — the combo's own viewport listener. It also calls `dropdown.getElement().contains(target)`; verify the new helper is **not** needed here (the combo never hosts another layer in the current design, so its check stays correct).
- [component/input/TimePickerDropdown.ts:275](../src/typescript/lib/component/input/TimePickerDropdown.ts#L275) — the picker dropdown's `showAt`. Useful when adding the demo to confirm where in-dropdown content (e.g. a tail-row ComboBox) would be slotted.
- [core/Popover.ts:183](../src/typescript/lib/core/Popover.ts#L183) — same-shape bug; informational, out of scope.

---

## Non-Goals

- **Popover migration.** No reachable bug today; deferred until a real consumer appears.
- **Re-parenting picker dropdowns into the field's DOM tree.** Architectural shift; not warranted by the bug.
- **Cross-host dismiss APIs** (e.g. "dismiss all open layers"). Out of scope; not requested.
- **Refactoring the three duplicated `onViewportPointerDown` methods into a shared base.** A `PickerField` base class would be the right home, but that refactor predates this bug and is a separate plan.
