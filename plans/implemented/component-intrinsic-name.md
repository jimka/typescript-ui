---
touches-shared:
  - src/typescript/lib/core/Component.ts
  - src/typescript/lib/layout/Tab.ts
---

# Intrinsic Component Name — Implementation Plan

## Overview

A panel's title ("Console", "Settings") is intrinsic to the component, but today the only title `Tab` can read is [`LayoutConstraints.name`](../src/typescript/lib/layout/LayoutConstraints.ts#L15) (`name?: string | null = null`) — a *per-placement* hint a parent's layout manager uses. A component that was never given a constraint name therefore shows its UUID once tabbed: [`Tab.createTab`](../src/typescript/lib/layout/Tab.ts#L1907) falls back to `component.getId()`. `Component` has no name concept of its own (only `getId()` from [`BaseObject`](../src/typescript/lib/core/BaseObject.ts#L24), returning a UUID).

This plan gives `Component` an intrinsic, option-backed `name` and rewires `Tab` to resolve its displayed label as `constraints?.name ?? component.getName() ?? component.getId()`. The intrinsic name travels with the component through `moveComponent`/tear-off with zero plumbing, `constraints.name` stays as an explicit per-placement override (every existing call still works), and the UUID becomes the last resort. The change touches [`Component.ts`](../src/typescript/lib/core/Component.ts) (new state + setter + option), [`Tab.ts`](../src/typescript/lib/layout/Tab.ts#L1907) (resolution), and [`TabDemoPanel.ts`](../src/typescript/TabDemoPanel.ts) (demonstrate the fix). Serialization and `DockRegion` are deliberately left untouched — see decisions.

---

## Architecture Decisions

### `name` lives in the `_options` bag, not a standalone `_name` field

This codebase backs option-mapped state in `this._options`, not in private `_field`s (see the bag comment at [Component.ts:283](../src/typescript/lib/core/Component.ts#L283); `visible`, `zIndex`, `insets`, … all live there). `name` is an option-mapped value, so it follows suit: store on `this._options.name`, read via `this._options.name ?? null`. The plan's brief mentioned a cached `_name` field — that idiom belongs to DOM-backed setters; here the bag *is* the cache, and using it keeps `name` consistent with every other `ComponentOptions` field and with the subclass-default merge machinery.

### `setName` is a trivial non-DOM setter — no super-trap

`name` never writes to the element; it is a plain string read by `Tab` and (potentially) consumers. So `setName(name)` is just `this._options.name = name; return this;` — no `getElement()`, no render-time deferral, no style replay. Because it only mutates the bag, it is safe to dispatch from `applyOptions` exactly like `setId` ([Component.ts:389](../src/typescript/lib/core/Component.ts#L389)): bag-mutating setters cannot be clobbered by subclass field initializers, which is precisely why the constructor runs the whole cascade through `applyOptions` ([Component.ts:368](../src/typescript/lib/core/Component.ts#L368)) rather than the constructor body. None of the three documented construction hazards apply:

- *Class-field super-cascade trap* — irrelevant: there is no class field to declare; state is the bag, allocated in the constructor body before `applyOptions`.
- *`options.listeners` super-trap* — irrelevant: `name` is not a listener and dispatches through the normal `applyOptions` per-field gate, which is `!== undefined`-guarded.
- *Setters that defer DOM work* — irrelevant: `setName` does no DOM work.

`applyOptions` ([Component.ts:386](../src/typescript/lib/core/Component.ts#L386)) is the confirmed dispatch site; the options interface is `ComponentOptions` ([Component.ts:105](../src/typescript/lib/core/Component.ts#L105)), exported from the `core` barrel ([core/index.ts:12](../src/typescript/lib/core/index.ts#L12)). The callable construction path is a `Proxy` that forwards `[[Construct]]` via `Reflect.construct` ([Callable.ts:37](../src/typescript/lib/core/Callable.ts#L37)), so the new option flows through `Component(...)` automatically — nothing to wire there.

### Tab resolution: `constraints?.name ?? component.getName() ?? component.getId()`

The three-way fallback lives in one place — `createTab` ([Tab.ts:1907](../src/typescript/lib/layout/Tab.ts#L1907)), which currently does `constraints?.name → getId()`. Inserting `component.getName()` in the middle is fully backward-compatible (existing `constraints.name` callers are unaffected) and gives every named component a sensible default. The resolved string is stored on `entry.name` ([Tab.ts:301](../src/typescript/lib/layout/Tab.ts#L301)) and is *already* the single source for the two downstream consumers — the tab-drag label ([Tab.ts:2862](../src/typescript/lib/layout/Tab.ts#L2862)) and the tear-off `Window` title ([Tab.ts:3028](../src/typescript/lib/layout/Tab.ts#L3028)) both read `entry.name`. So fixing `createTab` fixes the button label, the drag label, and the torn-off window title in one edit; no change is needed at those sites.

`addLazyTab` ([Tab.ts:1965](../src/typescript/lib/layout/Tab.ts#L1965)) takes an explicit `name` argument and has no component instance at registration time, so it is left unchanged.

### Serialization stays on `constraints.name` as panel identity — out of scope

At [LayoutSerialization.ts:158](../src/typescript/lib/layout/LayoutSerialization.ts#L158) `panelIdOf` reads `constraints.name` as a **stable serialization ID / restore key**, and at [LayoutSerialization.ts:344](../src/typescript/lib/layout/LayoutSerialization.ts#L344) `constraintsFor` writes `constraints.name = node.panelId` so a restored tree re-serializes identically; on restore, `materializeNode` ([LayoutSerialization.ts:361](../src/typescript/lib/layout/LayoutSerialization.ts#L361)) re-resolves a panel from a factory keyed on that `panelId`. That is **identity**, not display title. Routing `component.getName()` into serialization would conflate the two and risk breaking round-trip restore (a human-readable name is not guaranteed unique or stable as a factory key). Decision: serialization keeps using `constraints.name` verbatim; intrinsic name is a separate, additive display concern and does **not** participate in serialization. No serialization file is edited.

### DockRegion needs no change

The displayed title now rides on the component (via `getName()`) and travels through `moveComponent` automatically. `DockRegion` already moves the component; it never reads or writes a title. Explicitly: no `DockRegion` edit.

### `TabPanel.addTab` keeps writing `constraints.name = label`; does not touch intrinsic name

`addTab` / `addLazyTab` ([TabPanel.ts:106](../src/typescript/lib/component/container/TabPanel.ts#L106), [TabPanel.ts:128](../src/typescript/lib/component/container/TabPanel.ts#L128)) set `constraints.name = label`. This is the explicit per-placement override and preserves exact current behaviour (it also feeds serialization identity), so it stays. Recommendation: do **not** also call `component.setName(label)` here. Reasons: (1) `constraints.name` already wins the resolution, so setting the intrinsic name would have no visible effect for `TabPanel` tabs; (2) silently mutating a caller-owned component's intrinsic name is a surprising side effect — a consumer may have set `name` deliberately for use elsewhere. Intrinsic naming stays the caller's choice via the options bag.

### `TextInput` unifies onto `Component.name` rather than keeping a parallel `name`

**Correction to an earlier assumption:** `name` was *not* wholly new. [`TextInput`](../src/typescript/lib/component/input/TextInput.ts#L43) already owned a `name` option, `getName()`, and `setName()` — its meaning is the HTML form-field `name` attribute (form submission / radio grouping; written via `setElementAttribute("name", …)`), the idiomatic term for an `<input>`. Adding `Component.name` (the same `_options.name` storage) therefore *collided* with it, and the prior clash-sweep claim ("no subclass declares `name`") was wrong.

**Decision: unify, don't split.** Rather than rename the new concept to `title`, `TextInput` adopts `Component`'s intrinsic name as its single source: it **deletes** its duplicate `name` option (inherits `ComponentOptions.name`), its `getName()` (inherits `Component.getName()`), and its `applyOptions` name dispatch (the base `applyOptions` already dispatches `setName`). It **keeps only** the input-specific specialization — a `setName(name: string | null)` override that calls `super.setName(name)` then mirrors the value to (or removes it from) the DOM `name` attribute — plus `clearName()` and the render-time attribute write (now null-guarded). The resulting model: **`name` is the component's human identifier; an input additionally reflects it to the HTML `name` attribute.** Tradeoff accepted: a form field's submission key and its component name become the same string — fine here because inputs are rarely the tabbed unit, their visible label comes from a `FieldDecorator`, and the `constraints.name` override covers exceptions. `RadioButton`'s group name (`_options.radioName`, a distinct key) and `Glyph.getName()` (returns its registry key; covariant `string` return) are separate concerns and untouched.

---

## Public API (TypeScript Signatures)

```typescript
// ComponentOptions — add one field (Component.ts ~line 133, near `id`)
export interface ComponentOptions {
    // ...
    name?:            string | null;   // human-readable title; read by Tab for the tab/window label
    id?:              string;
    // ...
}

// Component — new getter + typed setter (mirrors getId/setId shape; NON-DOM)
getName(): string | null;              // returns this._options.name ?? null
setName(name: string | null): this;    // this._options.name = name; return this; (no DOM work)
```

No backing `_name` field, no `_defaultOptions` entry (default is "unset" → getter returns `null`).

---

## Ordered Implementation Steps

1. **`ComponentOptions`** ([Component.ts:105](../src/typescript/lib/core/Component.ts#L105)): add `name?: string | null;` adjacent to `id?: string;`. JSDoc one-liner describing it as the component's human title read by `Tab`.

2. **`Component` getter/setter**: add `getName()` and `setName()` next to `setId` ([Component.ts:1074](../src/typescript/lib/core/Component.ts#L1074)). `getName` returns `this._options.name ?? null`; `setName` sets `this._options.name = name` and returns `this`. Full JSDoc per `CODE_CONVENTIONS.md` (description, `@param`, `@returns`), explicit return types.

3. **`applyOptions` dispatch** ([Component.ts:389](../src/typescript/lib/core/Component.ts#L389)): add `if (opts.name !== undefined) this.setName(opts.name);` alongside the `setId` line.

4. **`Tab.createTab` resolution** ([Tab.ts:1907](../src/typescript/lib/layout/Tab.ts#L1907)): replace the `if (constraints && constraints.name) … else getId()` block with `name = constraints?.name ?? component.getName() ?? component.getId();`. Update the method's `@remarks` ([Tab.ts:1903](../src/typescript/lib/layout/Tab.ts#L1903)) and the class-level label note ([Tab.ts:496](../src/typescript/lib/layout/Tab.ts#L496)) to state the new priority order.

5. **Demo** ([TabDemoPanel.ts](../src/typescript/TabDemoPanel.ts)): give `buildContent` ([TabDemoPanel.ts:290](../src/typescript/TabDemoPanel.ts#L290)) an intrinsic name (`new Component({ insets: …, name: title })`) — names every dragged/dropped content panel. **Also name the `splitRegion` container itself** ([TabDemoPanel.ts:199](../src/typescript/TabDemoPanel.ts#L199)) `name: "Workspace"`: a *centre*-drop on a non-`Tab` region runs `DockRegion.dockAsTab`'s wrap path, which moves **the region container** into a new `Tab` — so it is `splitRegion`, not its `buildContent` child, that becomes the UUID-labelled tab in the user's reported scenario. Naming the container fixes that; naming `buildContent` fixes the dragged-panel-as-tab cases. (No `constraints.name` is set on these demo panels today, which is exactly why they regress to UUIDs without this change.)

6. **Regression check**: `grep -n "constraints.name" src/typescript/lib/layout/LayoutSerialization.ts` — expect the two existing hits unchanged (158, 344); confirm no serialization edit crept in.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Component.ts` (option field, `getName`/`setName`, `applyOptions` dispatch) |
| Modify | `src/typescript/lib/layout/Tab.ts` (`createTab` resolution + JSDoc notes) |
| Modify | `src/typescript/lib/component/input/TextInput.ts` (unify onto `Component.name`: drop duplicate option/getter/dispatch; `setName` override mirrors to the DOM `name` attribute) |
| Modify | `src/typescript/TabDemoPanel.ts` (`name: title` in `buildContent`; `name` on `splitRegion`) |
| Modify | `docs/recipes/component-options.md` (document the `name` option) |
| Modify | `docs/layouts/Tab.md` (title now sourced from component) |
| Modify | `docs/layouts/DockRegion.md` (note titles travel with the component) |

---

## Verification

- **Typecheck**: project build / `tsc` passes — `setName` typed `string | null`, getter returns `string | null`.
- **Grep invariants**:
  - `grep -n "name" src/typescript/lib/layout/Tab.ts | grep -E "constraints\?\.name \?\? .*getName"` — expect one hit (the new resolution).
  - `grep -rn "getName\|setName" src/typescript/lib/core/Component.ts` — expect the new getter/setter only.
  - `git diff --stat src/typescript/lib/layout/LayoutSerialization.ts` — expect empty (serialization untouched).
- **Manual smoke test (Tab demo screen, `TabDemoPanel`)**: load the app (`npm run dev`, http://localhost:8015). Tear off the lower "Drop tabs on my edges" region (or drag its tab into a window). Before: window/tab title is a UUID. After: it reads "Drop tabs on my edges". Existing `TabPanel.addTab(…, label)` tabs still show their `label` unchanged (constraint override still wins).
- **Docs**: `npm run docs:build` — 0 errors, 0 link warnings (typedoc "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

`Component` and `ComponentOptions` are exported from the `core` barrel ([core/index.ts:11-12](../src/typescript/lib/core/index.ts#L11)); the new `getName`/`setName` and `name` option surface in the generated `docs/api/core/` bundle automatically via JSDoc. There is **no curated `docs/core/Component.md`** page — the curated surface for component options is the recipe:

- **`docs/recipes/component-options.md`** — add `name` to the options discussion (a one-line mention in the options layering / examples area). This is where consumer-facing `ComponentOptions` fields are explained.
- **`docs/layouts/Tab.md`** — note that a tab's label now resolves `constraints.name ?? component.getName() ?? component.getId()`, so an intrinsic component name shows automatically.
- **`docs/layouts/DockRegion.md`** — add a sentence that a docked/torn-off panel's title comes from the component's intrinsic `name` (travelling with it through moves), falling back to the constraint name or UUID.

JSDoc on `getName`/`setName` is same-bucket (Core), so plain `{@link}` is fine. The `Tab.createTab` JSDoc references `Component.getName` across the `layout`→`core` bucket boundary — use a markdown link `[\`Component.getName\`](/api/core/classes/Component#getname)`, not `{@link}` (per `_shared/docs-conventions.md`).

---

## Critical Files

- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — options-bag pattern (`_options` at line 283), `applyOptions` (386), `setId` (1074) as the mimic template.
- [`src/typescript/lib/core/BaseObject.ts`](../src/typescript/lib/core/BaseObject.ts) — `getId`/`setId`/`_id` (the UUID source `getName` fronts).
- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — `TabEntry.name` (301), `createTab` (1907), drag label (2862), tear-off Window (3028).
- [`src/typescript/lib/layout/LayoutSerialization.ts`](../src/typescript/lib/layout/LayoutSerialization.ts) — `panelIdOf` (158) / `constraintsFor` (344): the identity-vs-title boundary to NOT cross.
- [`src/typescript/lib/layout/LayoutConstraints.ts`](../src/typescript/lib/layout/LayoutConstraints.ts) — `name` field (15), the per-placement override that remains.

---

## Non-Goals

- **Serialization of the intrinsic name.** `constraints.name`/`panelId` is identity, not display title; threading `getName()` through it would risk breaking round-trip restore. Deliberately out.
- **`TabPanel.addTab` setting the intrinsic name.** It would be invisible (constraint wins) and a surprising mutation of caller-owned state.
- **DockRegion changes.** Titles ride the component; no edit required.
- **DOM rendering of the name.** `name` is metadata read by `Tab`; it does not render to the component's own element.
- **`addLazyTab` rewiring.** It has an explicit `name` arg and no component at registration time.
