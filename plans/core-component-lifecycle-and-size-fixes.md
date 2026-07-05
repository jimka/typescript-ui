# Core Component Lifecycle & Size Fixes — Implementation Plan

## Overview

A cluster of correctness bugs and hygiene defects, all in [`src/typescript/lib/core/Component.ts`](src/typescript/lib/core/Component.ts). Three are behavioural: a copy-paste error in the `data-*` size serialisation that reflects the *width's* unbounded flag onto the *height* term; `removeAllComponents` leaving a live closure and leaked layout constraints on every removed child; and `removeComponent`'s numeric-index branch being dead. The rest are structural hygiene: an unnecessary duplication between `addComponent`/`insertComponent`, a mirror-pair duplication between `getMinSize`/`getMaxSize` (with a dead guard), a ~195-line `applyStyle`, and a batch of boxed-primitive annotations plus missing return types.

The serialisation bug appears at **four** sites, not three — the audit named `setMinSize` ([2379](src/typescript/lib/core/Component.ts#L2379)), `setMaxSize` ([2454](src/typescript/lib/core/Component.ts#L2454)), and `applyStyle` ([4022](src/typescript/lib/core/Component.ts#L4022)); investigation found the identical idiom and identical bug in `setPreferredSize` ([2286](src/typescript/lib/core/Component.ts#L2286), `data-preferredSize`). All four are folded into one extracted helper.

Confirmed by investigation: **no code reads** `data-minSize` / `data-maxSize` / `data-preferredSize` (grep over `src/` and `tests/` finds only `setDataAttribute` writers and the generic `getDataAttribute` accessor — no key-specific reader). These attributes are DevTools-only debug reflections, so the serialisation bug has never surfaced at runtime; it is still wrong and must be fixed. **No caller** passes a numeric index to `removeComponent` (every one of ~50 call sites passes a `Component`); the one subclass override, [`AbstractListComponent.removeComponent`](src/typescript/lib/component/list/AbstractListComponent.ts#L197), mirrors the `ListItem | Number` signature and simply delegates to `super`.

---

## Architecture Decisions

### `formatSizeAttr` — one serialiser for all four `data-*` size attributes

The bug is a symptom of a triplicated (actually quadruplicated) inline idiom: `(isUnbounded(x) ? "inf" : Math.round(x)+"px") + " " + (isUnbounded(x) ? "inf" : …)` — where the second term re-tests the *first* value. Rather than patch four `.width`→`.height` typos and leave the idiom to be copy-pasted wrong again, extract a single module-level helper `formatSizeAttr(width, height)` (paired with a per-term `formatSizeTerm`) and route all four `setDataAttribute` calls through it. This is the module-level-function pattern already used in `Component.ts` (e.g. `borderToStyle`). Including `setPreferredSize` is in-scope because it is the *same idiom with the same bug*; excluding it would leave the defect the helper exists to kill.

### `removeComponent` numeric-index branch — remove it (Simplicity First)

The `component: Component | Number` signature invites an index argument, but the branch is doubly broken: a primitive `number` fails `instanceof Number` (only a boxed `new Number(i)` matches), so it silently hits `else { return; }` and no-ops — worse than throwing. No caller in `src/` or `tests/` passes an index. Per Simplicity-First, delete the dead flexibility: narrow the signature to `removeComponent(component: Component)`, drop the `instanceof Number` / boxed-`Number` branch, and drop the terminal `else { return; }`. This forces a matching narrowing of the sole override, [`AbstractListComponent.removeComponent`](src/typescript/lib/component/list/AbstractListComponent.ts#L197), to `(component: ListItem)`.

### `wireChild` / `unwireChild` — one wiring definition, one teardown definition

`addComponent` and `insertComponent` are ~90% identical (parent-guard, the two callback-closure wirings, DOM attach, `scheduleLayout`, up-notify). Collapse the duplication two ways:

1. **`addComponent` delegates to `insertComponent`** at the append index — `return this.insertComponent(component, this._components.length, constraints)`. `insertComponent`'s own JSDoc already declares add is the append shortcut, and its `nextSibling` computation degrades to an append when the index equals the length (`clampedIndex + 1 < length` is false → `insertBefore(host, el, null)` = append), matching `addComponent`'s `appendChild` exactly.
2. **`wireChild(component)`** owns the `_parent` + the two `_on*Change` closure assignments; **`unwireChild(component)`** is its teardown counterpart (`delLayoutConstraints`, null both closures, null `_parent`, `removeElement`), used by *both* `removeComponent` and `removeAllComponents`.

After delegation, `wireChild` has a single caller (`insertComponent`), so its dedup value is symmetry with `unwireChild` plus isolating the closure-wiring in one named, documented place rather than call-count — a deliberate, minor readability call, not speculative abstraction. `unwireChild` genuinely dedups (two callers) and is the mechanism that fixes the `removeAllComponents` leak.

The `_on*Change` fields are plain internal callback slots, not `Event`/`ListenerBag` listeners, so the ARCHITECTURE "listeners must reference a named function" rule does not apply; the existing arrow-closure form is kept inside `wireChild` (each closure captures the parent `this` and relays to the parent's own hook — a shape a shared named method cannot express without per-instance binding).

### `removeAllComponents` keeps its documented "no layout" contract

`removeAllComponents`'s JSDoc says *"without triggering layout"*, and its callers (Button content rebuild, MenuBar/Menu clear, Header row rebuild, calendar/picker refills) all clear-then-rebuild, so a per-child `scheduleLayout` + up-notify would thrash. The fix is scoped to the **per-child teardown leak** only: route each child through `unwireChild` so both `_on*Change` closures are nulled and `delLayoutConstraints` runs. The container-level `scheduleLayout` + up-notify stay exclusive to `removeComponent`; they are not part of "the teardown a child needs" and adding them would silently change a documented contract.

### `getMinSize` / `getMaxSize` — one merge helper, dead guard dropped

The two methods differ only by `Math.max`↔`Math.min` and `0`↔`UNBOUNDED` fallback. Unify the body into one private `mergeConstraintSize(constraint, managerSize, merge, fallback)` and have each method pass its op + identity. The `if (!layoutManager) return …` guard ([2324](src/typescript/lib/core/Component.ts#L2324), [2399](src/typescript/lib/core/Component.ts#L2399)) is unreachable: `getLayoutManager()` is typed `(): LayoutManager` (non-null) and lazily attaches the class-default manager, so it never returns null — drop the guard. The helper always yields a `Size`, but the public return type **stays `Size | null`**: subclass overrides (`FieldSet`, `Text`, `PickerColumn`, `Image`) are declared `getMinSize(): Size | null`, and narrowing the base to `Size` would make those overrides type-incompatible. The helper returns a *fresh* object in every branch (spread constraint/manager sizes), preserving the current code's behaviour of never handing out an internal `_options.minSize` reference.

### `applyStyle` — split into named phase methods

The ~195-line body ([3925–4119](src/typescript/lib/core/Component.ts#L3925)) violates the function-decomposition convention. Split into private, parameterless, `void` phase methods called in sequence (they write the buffered `_styleRule` / `_inlineStyle`, which flush later, so they need no `Handle`). `applyStyle` keeps the leading `removeAttr(["style"])` + `ensureCSSRule()` and becomes a short orchestrator. Proposed phases (order preserved exactly):

- `applyBoxAndVisibilityStyles()` — `boxSizing`, `position`, `visibility`, `display`, `cursor`, foreground/background colour, `backgroundImage`.
- `replayGeometryStyles()` — the NaN-guarded `width` / `top` / `left` / `height` replay + the cached `transform` replay.
- `applySizeConstraintStyles()` — the min/max CSS writes + the (now-helper-routed) `data-maxSize`.
- `applyOverflowStyles()` — `overflowX` / `overflowY` + `refreshWheelScrolling()`.
- `applyChromeStyles()` — `border`, `outline`, `borderRadius`, `boxShadow`.
- `applyMiscInlineStyles()` — `whiteSpace`, `pointerEvents`, `writingMode`, `zIndex`, `transition`, `opacity`, `userSelect`, `padding`, `data-insets`, `margin`.
- `materialiseDeferredRules()` — the `_deferredStyleRules` `ensure()` loop.

### Hygiene — boxed primitives, missing return types, `var`, `Size` alias

Replace boxed-primitive annotations with their lowercase primitives; add explicit return types; `var`→`let`; use the `Size` alias. `setVisible(value: Boolean)` accepts a falsy non-boolean ("null/falsy = inherit"), so its parameter narrows to `boolean | null`, **not** `boolean` (a bare `boolean` would compile-reject the documented inherit call). `isVisible` narrows to `boolean | null`. These are pure annotation edits — no behavioural change, no public rename (the `getPerimiterSize` misspelling stays untouched; it is owned by `api-naming-harmonization`).

---

## Public API

No new exported symbols; no renames. Signature narrowings only (all source-compatible with existing callers, verified):

```typescript
// Component.ts
removeComponent(component: Component): LayoutConstraints | undefined   // was (component: Component | Number)
isVisible(): boolean | null                                           // was (): Boolean | null
setVisible(value: boolean | null): this                              // was (value: Boolean)
getMinSize(): Size | null                                            // unchanged signature, unified body
getMaxSize(): Size | null                                            // unchanged signature, unified body
getInnerSize(): Size | null                                          // was (): { width: number, height: number } | null

// return types added (bodies unchanged), inferred from current bodies:
hasElementAttribute(key: string): boolean | undefined
getElementAttribute(key: string): string | null | undefined
getAutoCommitStyle(): boolean
getDataAttribute(key: string): string | undefined
getWidth(): number
getHeight(): number
getX(): number
getY(): number
getTranslateX(): number
getTranslateY(): number

// AbstractListComponent.ts (matching override narrowing)
removeComponent(component: ListItem): LayoutConstraints | undefined   // was (component: ListItem | Number)
```

New private members on `Component`:

```typescript
private wireChild(component: Component): void
private unwireChild(component: Component): LayoutConstraints | undefined
private mergeConstraintSize(
    constraint: Size | null,
    managerSize: Size | null,
    merge: (a: number, b: number) => number,
    fallback: number,
): Size
// plus the seven applyStyle phase methods above (all `private … (): void`)
```

New module-level functions in `Component.ts`:

```typescript
/** Serialises a width/height pair for a debug `data-*` size attribute. */
function formatSizeAttr(width: number, height: number): string
/** Serialises one size term: "inf" when unbounded, else a rounded px string. */
function formatSizeTerm(value: number): string
```

Field annotation:

```typescript
private _attributes: Map<string, string>   // was Map<String, String>
```

---

## Internal Structure

`formatSizeAttr` (module-level, near `borderToStyle`):

```typescript
function formatSizeTerm(value: number): string {
    return isUnbounded(value) ? "inf" : Math.round(value) + "px";
}

function formatSizeAttr(width: number, height: number): string {
    return formatSizeTerm(width) + " " + formatSizeTerm(height);
}
```

All four call sites collapse to, e.g.:

```typescript
this.setDataAttribute("minSize", formatSizeAttr(next.width, next.height));
```

`mergeConstraintSize` (fresh object in every branch):

```typescript
private mergeConstraintSize(
    constraint: Size | null,
    managerSize: Size | null,
    merge: (a: number, b: number) => number,
    fallback: number,
): Size {
    if (constraint && managerSize) {
        return {
            width:  merge(constraint.width,  managerSize.width),
            height: merge(constraint.height, managerSize.height),
        };
    }

    if (constraint) {
        return { width: constraint.width, height: constraint.height };
    }

    if (managerSize) {
        return { width: managerSize.width, height: managerSize.height };
    }

    return { width: fallback, height: fallback };
}

getMinSize(): Size | null {
    return this.mergeConstraintSize(this.getMinSizeConstraint(), this.getLayoutManager().getMinSize(), Math.max, 0);
}

getMaxSize(): Size | null {
    return this.mergeConstraintSize(this.getMaxSizeConstraint(), this.getLayoutManager().getMaxSize(), Math.min, UNBOUNDED);
}
```

`wireChild` / `unwireChild`:

```typescript
private wireChild(component: Component): void {
    component._parent = this;
    component._onPreferredSizeChange = () => {
        this.scheduleLayout();

        this._onPreferredSizeChange?.();
    };
    component._onConstraintSizeChange = () => {
        this.scheduleLayout();

        this._onConstraintSizeChange?.();
    };
}

private unwireChild(component: Component): LayoutConstraints | undefined {
    const constraints = this.delLayoutConstraints(component);

    component._parent = null;
    component._onPreferredSizeChange = null;
    component._onConstraintSizeChange = null;
    component.removeElement();

    return constraints;
}
```

`removeComponent` after refactor: `indexOf` → splice → `const constraints = this.unwireChild(component)` → `scheduleLayout()` → up-notify → `return constraints`.

`removeAllComponents` after refactor: `for (const component of this._components) this.unwireChild(component);` → `this._components = []` → `return this`. (Use `for…of`, not the existing `for…in` over the array — `for…in` iterates string keys; `unwireChild` needs the element, and `for…of` is the correct array iteration.)

`insertComponent` after refactor: parent-guard → `splice` → `setLayoutConstraints` → `this.wireChild(component)` → element/attach → `scheduleLayout` → up-notify.

---

## Ordered Implementation Steps

1. **`formatSizeAttr` / `formatSizeTerm`** — add the two module-level functions to `Component.ts`. Route all four `setDataAttribute` size calls ([2286](src/typescript/lib/core/Component.ts#L2286), [2379](src/typescript/lib/core/Component.ts#L2379), [2454](src/typescript/lib/core/Component.ts#L2454), [4022](src/typescript/lib/core/Component.ts#L4022)) through `formatSizeAttr`. Checkpoint: `grep -n 'isUnbounded(next.width)\|isUnbounded(maxSize.width)' src/typescript/lib/core/Component.ts` — expect zero matches inside `setDataAttribute` calls.
2. **`removeComponent` index branch** — narrow signature to `(component: Component): LayoutConstraints | undefined`; delete the `instanceof Number` branch, the boxed-`Number` path, and the terminal `else { return; }`; `var index`→`let`. Narrow `AbstractListComponent.removeComponent` to `(component: ListItem)`.
3. **`wireChild` / `unwireChild`** — add both private helpers.
4. **`insertComponent`** — replace its inline `_parent` + closure block with `this.wireChild(component)`.
5. **`addComponent`** — replace its body with `return this.insertComponent(component, this._components.length, constraints)` (keep the JSDoc). Checkpoint: `grep -c '_onConstraintSizeChange = () =>' src/typescript/lib/core/Component.ts` — expect **1** (only inside `wireChild`).
6. **`removeComponent`** — replace its teardown lines with `const constraints = this.unwireChild(component)` (after the splice), keep `scheduleLayout` + up-notify + `return constraints`.
7. **`removeAllComponents`** — loop `unwireChild` over each child via `for…of`, then clear the array.
8. **`getMinSize` / `getMaxSize` + `mergeConstraintSize`** — add the helper; rewrite both methods to delegate; drop the dead `if (!layoutManager)` guards.
9. **`applyStyle` decomposition** — extract the seven phase methods; reduce `applyStyle` to the wipe + `ensureCSSRule()` + ordered phase calls + `return this`.
10. **Hygiene** — `_attributes: Map<string, string>`; `isVisible(): boolean | null`; `setVisible(value: boolean | null)`; add the ten missing return types; `getInnerSize(): Size | null`. Checkpoint: `grep -nE ': (Boolean|String|Number)\b' src/typescript/lib/core/Component.ts` — expect zero matches.
11. **Verify** — `npx tsc --noEmit`, `npm run lint`, the new + existing tests (below).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Component.ts` |
| Modify | `src/typescript/lib/component/list/AbstractListComponent.ts` (override signature narrowing) |
| Modify | `tests/component/Component.test.ts` (add size-negotiation + child-lifecycle coverage) |
| Modify | `tests/core/StructureMutationPropagation.test.ts` (add teardown-completeness cases — or add to `Component.test.ts`; see below) |

---

## Expected Behaviour

All cases below are **unit-testable offline** with the existing `installTestDOM` harness (see `tests/core/StructureMutationPropagation.test.ts` for the pattern: materialise elements with `getElement(true)`, spy/read private hooks via a cast). None require a browser — no geometry, focus, or visual output is asserted, only cached JS state and serialised attribute strings.

### `formatSizeAttr` serialisation (the copy-paste fix)

- `setMinSize(w, h)` reflects `data-minSize` = `"<w>px <h>px"` with **height rounded from `h`, not `w`**. Regression-pinning case: `setMinSize(10, 20)` → `data-minSize === "10px 20px"` (pre-fix produced `"10px 10px"`). Read via `getDataAttribute("minSize")`.
- `setMaxSize(w, h)` → `data-maxSize` = `"<w>px <h>px"`; `setMaxSize(10, 20)` → `"10px 20px"`.
- `setPreferredSize(w, h)` → `data-preferredSize` = `"<w>px <h>px"`; `setPreferredSize(10, 20)` → `"10px 20px"`.
- Unbounded terms serialise per-axis independently: `setMaxSize(UNBOUNDED, 20)` → `"inf 20px"`; `setMaxSize(20, UNBOUNDED)` → `"20px inf"` (pre-fix the second produced `"20px 20px"` because the height term tested width).
- Rounding: `setMinSize(10.4, 20.6)` → `"10px 21px"`.
- `applyStyle` reflects `data-maxSize` consistently when a max constraint is set: render a component with `maxSize: { width: 20, height: UNBOUNDED }`, force render, assert `getDataAttribute("maxSize") === "20px inf"`.

### Child lifecycle — wiring & teardown

- **`addComponent` still appends.** `parent.addComponent(a); parent.addComponent(b)` leaves `getChildren()` order `[a, b]`; `addComponent` returns `this`.
- **`addComponent` delegating to `insertComponent` preserves the parent guards.** Re-adding a child already parented here is a no-op returning `this`; adding a child owned by another parent throws `"already has a parent"`.
- **Removed child is fully unwired.** After `parent.addComponent(child); parent.removeComponent(child)`: `child.getParentComponent()` is `null`, **both** `_onPreferredSizeChange` and `_onConstraintSizeChange` are `null` (read via cast), and the child is spliced out of `getChildren()`.
- **No dead-tree re-entry after remove.** After removing `child`, calling `child.setMinSize(5, 5)` / `child.setMaxSize(5, 5)` must **not** invoke the ex-parent's `scheduleLayout` (spy the ex-parent's `scheduleLayout`; expect zero calls). This is the concrete symptom the `_onConstraintSizeChange` null-out prevents.
- **Constraints returned & released on remove.** `removeComponent` returns the constraints registered for the child; a subsequent internal constraint lookup for that child yields none (constraint leak closed).
- **`removeAllComponents` fully unwires every child.** After adding several children and calling `removeAllComponents()`: `getChildren()` is empty; **each** removed child has `null` parent and `null` for **both** `_on*Change` hooks; and `child.setMinSize(...)` on any removed child does not reach the ex-parent's `scheduleLayout`. (Pre-fix: `_onConstraintSizeChange` stayed a live closure.)
- **`removeAllComponents` does not schedule a layout.** Spy the container's `scheduleLayout`; `removeAllComponents()` invokes it zero times (documented "without triggering layout" contract preserved).
- **Existing `StructureMutationPropagation` cases still pass** — add/insert/remove up-notify to the ancestor is unchanged (the up-notify stays in `removeComponent` and in `insert`/`add`).

### `getMinSize` / `getMaxSize` unification

- **Merge is the tighter bound.** With a component constraint of `min {40,40}` and a layout-manager min of `{30,50}`, `getMinSize()` returns `{40,50}` (per-axis `Math.max`). With max constraint `{100,100}` and manager max `{120,80}`, `getMaxSize()` returns `{100,80}` (per-axis `Math.min`).
- **Fallbacks.** A component with no min constraint and a manager reporting no min → `getMinSize()` returns `{0,0}`. No max constraint and no manager max → `getMaxSize()` returns `{UNBOUNDED, UNBOUNDED}`.
- **Constraint-only / manager-only** each return that source's values (as a fresh object, not the stored reference — mutating the returned object must not corrupt `getMinSizeConstraint()`).
- **Subclass overrides unaffected.** A `FieldSet` / `Text` instance's `getMinSize()` still returns its widened value (these call `super.getMinSize()`); type-check must pass with the base still declared `Size | null`.

### Hygiene (compile-time / no runtime assertion)

- `setVisible(null)` compiles and sets inherit (no `boolean`-only rejection); `setVisible(true)`/`setVisible(false)` unchanged; `setVisible("x" as unknown as boolean)`-style truthy non-boolean still throws at runtime.
- `tsc --noEmit` passes with the added return types and the narrowed `_attributes` map.

---

## Verification

- `npx tsc --noEmit` — clean (catches the `Size | null` override compatibility, the `removeComponent`/override narrowing, and every added return type).
- `npm run lint` — clean (`local/no-raw-dom` unaffected; confirms no boxed-primitive lint rule trips).
- New unit tests in `tests/component/Component.test.ts` covering every **Expected Behaviour** bullet marked offline-testable (all of them). Run `npx vitest run tests/component/Component.test.ts tests/core/StructureMutationPropagation.test.ts`.
- Grep invariants (all expect zero / the stated count):
  - `grep -nE ': (Boolean|String|Number)\b' src/typescript/lib/core/Component.ts` → 0
  - `grep -c '_onConstraintSizeChange = () =>' src/typescript/lib/core/Component.ts` → 1
  - `grep -n 'instanceof Number' src/typescript/lib/core/Component.ts` → 0
  - `grep -n 'isUnbounded([a-zA-Z.]*\.width)[^)]*isUnbounded([a-zA-Z.]*\.width)' src/typescript/lib/core/Component.ts` → 0 (the duplicated-width idiom is gone)
- No manual/browser verification required: all touched surfaces are cached JS state or debug attributes with no runtime consumer (the `data-*` attributes are DevTools-only). `applyStyle`'s decomposition is a pure extraction — the existing render tests (e.g. `tests/component/default-options-fallback.test.ts`, `tests/core/Body.test.ts`) exercise it and must stay green.

---

## Potential Challenges

- **`getMinSize`/`getMaxSize` return type must stay `Size | null`.** Narrowing the base to `Size` breaks the `FieldSet`/`Text`/`PickerColumn`/`Image` overrides that declare `Size | null`. Mitigation: keep the annotation; only the *body* changes. `tsc` will catch a mistake here.
- **`applyStyle` phase ordering is load-bearing.** The leading `removeAttr(["style"])` wipes inline styles that later phases replay (width/top/left/height, transform, transition, opacity); reordering phases would drop a replay. Mitigation: extract in-place, preserving exact statement order; diff the concatenated phase bodies against the original block.
- **`for…in` → `for…of` in `removeAllComponents`.** The original iterated with `for…in` (string keys); `unwireChild` needs the element. Mitigation: use `for…of this._components`.
- **`addComponent` delegation must keep the `getElement()`-not-yet-rendered early return.** `insertComponent` already returns `this` before the DOM attach when the container has no element, matching `addComponent`'s current behaviour — no separate handling needed, but a test should assert `addComponent` on an unrendered container still wires `_parent` (the wiring precedes the early return in `insertComponent`).

---

## Critical Files

- [`src/typescript/lib/core/Component.ts`](src/typescript/lib/core/Component.ts) — every change lands here; read `getLayoutManager` ([4490](src/typescript/lib/core/Component.ts#L4490)) to confirm the non-null contract, and `moveComponent` ([4323](src/typescript/lib/core/Component.ts#L4323)) which consumes `removeComponent`'s return value.
- [`src/typescript/lib/component/list/AbstractListComponent.ts`](src/typescript/lib/component/list/AbstractListComponent.ts#L197) — the sole `removeComponent` override; its signature must track the base narrowing.
- [`src/typescript/lib/primitive/Size.ts`](src/typescript/lib/primitive/Size.ts) — `Size`, `UNBOUNDED`, `isUnbounded` (already imported into `Component.ts`).
- [`tests/core/StructureMutationPropagation.test.ts`](tests/core/StructureMutationPropagation.test.ts) — the private-hook spy pattern to reuse for teardown tests.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) "Size constraints: who is responsible for what" — the min/preferred/max contract `getMinSize`/`getMaxSize` implement.

---

## Non-Goals

- **No public rename.** The `getPerimiterSize` misspelling stays as-is (owned by `api-naming-harmonization`); `getInnerSize` continues to call it.
- **No `Util.clamp` introduction/migration** (owned by `shared-clamp-timer-size-sentinel-utils`) — `Math.max`/`Math.min` in `mergeConstraintSize` are passed as-is.
- **No behavioural change to `removeAllComponents`'s layout scheduling** — it stays "without triggering layout"; only the per-child leak is fixed.
- **No change to the `data-*` attribute contract** beyond fixing the serialisation — they remain DevTools-only debug reflections with no code reader.
