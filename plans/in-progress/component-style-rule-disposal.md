# Component Style-Rule Disposal — Implementation Plan

## Overview

Every `Component` allocates a per-instance `CSSStyleRule` on the shared `<style id="Base">` sheet: `_styleRule = new StyleRule({ scope: "component", name: this.getId() })` ([Component.ts:336](src/typescript/lib/core/Component.ts#L336)), plus a `_deferredStyleRules: Map<string, StyleRule>` of state rules (`:hover` / `:active` / `.selected` / border / transition), each keyed `#<uuid><suffix>`. On first render these materialise via `StyleRule.ensure()` → `_ruleFor` ([StyleTarget.ts:180](src/typescript/lib/core/StyleTarget.ts#L180)) → `DOM.sink.ensureStyleRule` ([DOM.ts:1345](src/typescript/lib/core/DOM.ts#L1345)), which inserts the rule into the sheet **and** caches it in the module-level `_ruleCache` ([StyleTarget.ts:161](src/typescript/lib/core/StyleTarget.ts#L161)).

`Component.destructor()` ([Component.ts:615](src/typescript/lib/core/Component.ts#L615)) releases DOM handles and unregisters the GC finalizer (`_componentFinalizer`, [Component.ts:253](src/typescript/lib/core/Component.ts#L253)) but does **nothing** about `_styleRule` / `_deferredStyleRules`. There is no rule-removal path anywhere in the library (`grep -rn deleteRule src` = 0 hits), so rules leak forever — held alive by both the live stylesheet and `_ruleCache`. The finalizer's held value is only the `readonly Handle[]` owned-handle array, so GC reclamation releases handles but cannot touch stylesheet rules. This matters because the common removal path — `removeComponent` / `removeAllComponents` ([Component.ts:4462](src/typescript/lib/core/Component.ts#L4462), [Component.ts:4484](src/typescript/lib/core/Component.ts#L4484)) — only detaches and nulls `_parent`; it never calls `destructor()`, leaving all teardown to GC finalization.

Live measurement (dev app, localhost:8015): the shared `Base` sheet grew 816 → 1041 → 1266 rules across two bursts of 25 notifications (~9 rules/notification), and the rules were **not** reclaimed after the notifications auto-dismissed and the screen returned to empty — monotonic and unbounded.

This plan adds a `deleteStyleRule` seam to `DOMSink`, a `StyleRule.dispose()`, and drives disposal of each component's own `#<uuid>`-scoped rules from **both** the eager `destructor()` path and the lazy GC-finalizer path (the dominant real-world path, since `removeComponent` relies on GC).

---

## Architecture Decisions

### Mirror `ensureStyleRule` for the new `deleteStyleRule` seam

The removal seam is the exact inverse of the existing insert seam and mirrors it one-for-one. `DOMSink.ensureStyleRule(selector)` scans `sheet.cssRules` for a matching `selectorText` and `insertRule`s on miss ([DOM.ts:1345](src/typescript/lib/core/DOM.ts#L1345)); `deleteStyleRule(selector)` scans the same `cssRules` for the matching `selectorText` and calls `sheet.deleteRule(index)` on hit. It is added to the `DOMSink` interface ([DOM.ts:465](src/typescript/lib/core/DOM.ts#L465), directly after `ensureStyleRule` at line 515), implemented on `ProductionDOMSink` (using the same private `mainSheet()` helper), and mirrored on `RecordingDOMSink` ([tests/dom/TestDOM.ts:292](tests/dom/TestDOM.ts#L292)) which — exactly like its `ensureStyleRule` ([TestDOM.ts:367](tests/dom/TestDOM.ts#L367)) — only records the op into `writes`. This follows the established sink-pairing pattern (`ensureStyleRule` / `setRuleStyle` / `ensureKeyframes` are each declared on the interface and implemented on both sinks).

### `StyleRule` owns its selector and disposes itself; a module fn does the sink+cache delete

`StyleRule` currently keeps only a `_factory: () => CSSStyleRule` closure over the selector ([StyleTarget.ts:215](src/typescript/lib/core/StyleTarget.ts#L215)). Disposal needs the selector string, so `StyleRule` gains a `private _selector: string` field (computed once in the constructor via the existing `_selectorOf(spec)`), a `getSelector(): string` accessor, and a `dispose()` method. The actual sink-delete + cache-evict is a module-level function `disposeStyleRule(selector)` (sibling to `_ruleFor`), so the same logic serves both the `StyleRule.dispose()` object path and the finalizer's selector-list path (which has no `StyleRule` object):

```typescript
export function disposeStyleRule(selector: string): void {
    if (!_ruleCache.has(selector)) return;   // never materialised — nothing on the sheet
    DOM.sink.deleteStyleRule(selector);
    _ruleCache.delete(selector);
}
```

The `_ruleCache.has(selector)` guard is the materialisation signal: a selector enters `_ruleCache` in `_ruleFor` exactly when its rule is inserted, so an unmaterialised rule (never rendered) is a clean no-op with no wasted `cssRules` scan. This makes `disposeStyleRule` idempotent — a second call after eviction is a cache-miss no-op.

**Post-dispose state (decision):** `StyleRule.dispose()` resets `this._target = null` and `this._dirty = {}`, returning the buffer to its pre-`ensure()` state. Dispose is therefore *not* terminal — a later `ensure()` would re-materialise and re-insert the rule safely. This is the safe choice (matches the existing `_target === null` "unmaterialised" contract) and costs nothing; disposal for a live component is simply never followed by a re-`ensure()`.

### Only `#<uuid>`-scoped rules are ever deleted — shared `.class` rules are never touched

`_ruleCache` mixes per-instance component-scope selectors (`#<uuid>`, `#<uuid>:hover`, …) with **shared** rules — `scope:"class"` (`.Foo`), `scope:"selector"`, and `@keyframes` — that many live components and static DOM share and which must never be deleted on one component's teardown. Every per-instance rule flows through exactly two allocation paths, both `scope:"component"` keyed on this component's own id: `_styleRule` ([Component.ts:336](src/typescript/lib/core/Component.ts#L336), and its `setId` re-point at [Component.ts:1284](src/typescript/lib/core/Component.ts#L1284)) and `createStyleRule(suffix)` ([Component.ts:741](src/typescript/lib/core/Component.ts#L741)). Verified: **all** `createStyleRule` call sites (Button `:active`/`:hover`, ToggleButton `.selected:not(:hover)`, WindowBorder `.snap-target`, CollapseButton `""`, DiagramNode `.selected`, Header `:active`, RailHandle, AccordionIndicator `.expanded`) pass suffixes that `_selectorOf` prepends with `#<escaped-id>` — every resulting selector is `#<uuid>`-prefixed. The module-level `new StyleRule({ scope: "class", … })` singletons (Glyph, ComboBox, Markdown, editorTheme, AbstractSelectableList, focusRing, …) are never fed into per-instance disposal because a component records selectors only from those two component-scope paths. Disposal is naturally scoped; no component can delete a shared rule.

### Dual disposal: eager `destructor()` via `StyleRule` objects, lazy finalizer via a held selector snapshot

Disposal must fire on both paths. The eager path (`destructor()`) has the live `StyleRule` objects and calls `_styleRule.dispose()` + `dispose()` on each `_deferredStyleRules` value. The lazy path (GC finalization) is the dominant real path — `removeComponent` detaches without destroying, so a discarded component is reclaimed by GC — and it **cannot** reference the `Component` or its `StyleRule` objects (a back-reference in the `FinalizationRegistry` held value would keep the `Component` alive and defeat the finalizer). It therefore drives off a GC-safe snapshot: a mutable `_ownedSelectors: string[]` (strings only, no `Component` back-reference), populated as component-scope rules are allocated, and included in the finalizer's held value alongside `_ownedHandles`. This mirrors the existing `_ownedHandles` mechanism exactly — a mutable array held by the registry, so entries pushed after the finalizer arms are still seen at GC time ([Component.ts:248](src/typescript/lib/core/Component.ts#L248), [Component.ts:654](src/typescript/lib/core/Component.ts#L654)). Selectors (not `StyleRule` objects) are held because `setId` reassigns the `_styleRule` field ([Component.ts:1284](src/typescript/lib/core/Component.ts#L1284)) — every component constructed with an explicit `{ id }` re-points it during `applyOptions` — so a captured object reference would go stale, whereas a selector snapshot records both the old and new selectors and disposes each idempotently.

**Timing is safe:** `_ownedSelectors` is populated at rule *allocation* (construction / `applyOptions` cascade / `createStyleRule`), all of which precede first render. `render()` calls `trackHandle(root)` ([Component.ts:5000](src/typescript/lib/core/Component.ts#L5000)) — which arms the finalizer — *before* `init()` → `applyStyle()` materialises any rule ([Component.ts:4964](src/typescript/lib/core/Component.ts#L4964), [Component.ts:4004](src/typescript/lib/core/Component.ts#L4004)). So by the time a rule is on the sheet, the finalizer already holds the `_ownedSelectors` array. A component that allocates rules but never renders never materialises them and never leaks (`disposeStyleRule` no-ops via the cache guard).

### Rejected: destroying children in `removeComponent` / `removeAllComponents`

Making `removeComponent` call `destructor()` would be a **behavioural change that breaks `moveComponent`**. `moveComponent` ([Component.ts:4432](src/typescript/lib/core/Component.ts#L4432)) is built on `removeComponent` (it calls `oldParent.removeComponent(child)` then re-inserts the same instance, [Component.ts:4444](src/typescript/lib/core/Component.ts#L4444)); destroying on remove would release the child's handles and rules mid-move and corrupt the reparent. The whole reason release is keyed on GC (not on `removeComponent`) is that reachability is the move-vs-discard signal ([Component.ts:243](src/typescript/lib/core/Component.ts#L243)). The finalizer path is precisely what covers discarded-via-`removeComponent` components; that is why it is the primary mechanism here, not a `removeComponent`-destroys change.

### The `ensureStyleRule` `cssRules` scan is left as-is — Non-Goal

`ProductionDOMSink.ensureStyleRule` scans `cssRules` linearly before every insert ([DOM.ts:1348](src/typescript/lib/core/DOM.ts#L1348)). Since `_ruleFor` only calls it on a `_ruleCache` miss (a genuinely new selector), the scan is mostly redundant, but dropping it is unsafe without a broader cache-lifecycle change: `_ruleCache` is module state that persists across `DOM.reset()` (which rebuilds only the sink/source/registry, [DOM.ts:2091](src/typescript/lib/core/DOM.ts#L2091)), while the production sheet does not, so cache and sheet can legitimately desync. Removing the scan risks duplicate inserts on that desync. This is left out of scope — see [Non-Goals](#non-goals).

---

## Public API

New seam method on the `DOMSink` interface, implemented by both sinks:

```typescript
/**
 * Removes the shared-stylesheet CSSStyleRule for a selector, if present. The
 * inverse of ensureStyleRule; scans cssRules for the matching selectorText and
 * deleteRule()s it. A no-op when no rule matches.
 *
 * @param selector - The CSS selector text of the rule to remove.
 */
deleteStyleRule(selector: string): void;
```

New surface on `StyleRule` (StyleTarget.ts):

```typescript
/** Returns this rule's CSS selector text. */
getSelector(): string;

/**
 * Deletes the materialised CSSStyleRule from the shared stylesheet and evicts
 * it from the module cache, then resets to the unmaterialised state so a later
 * ensure() re-materialises. No-op if never materialised. Idempotent.
 */
dispose(): void;
```

New module-level function (StyleTarget.ts), exported for the Component finalizer:

```typescript
export function disposeStyleRule(selector: string): void;
```

Test-only exports (StyleTarget.ts), mirroring `_handleRegistrySize` in DOM.ts:

```typescript
/** Whether the module rule cache holds a rule for the selector; for tests only. @internal */
export function _ruleCacheHas(selector: string): boolean;

/** Snapshot of the module rule cache's selectors; for tests only. @internal */
export function _ruleCacheKeys(): readonly string[];
```

New private surface on `Component`:

```typescript
// Component-scope selectors (#<uuid>[<suffix>]) this component allocated, for
// teardown deletion. Strings only (no back-reference to Component) so the GC
// finalizer can hold it without pinning the instance. Mirror of _ownedHandles.
private readonly _ownedSelectors: string[] = [];

/** Records a component-scope selector so both teardown paths delete it. */
private trackSelector(selector: string): void;
```

Finalizer held-value type changes from `readonly Handle[]` to:

```typescript
type OwnedResources = {
    readonly handles:   readonly Handle[];
    readonly selectors: readonly string[];
};
```

---

## Internal Structure

**Finalizer** ([Component.ts:253](src/typescript/lib/core/Component.ts#L253)) — held value carries both arrays; callback releases handles and disposes selectors:

```typescript
const _componentFinalizer = new FinalizationRegistry<OwnedResources>(({ handles, selectors }) => {
    for (const handle of handles) {
        DOM.sink.release(handle);
    }

    for (const selector of selectors) {
        disposeStyleRule(selector);
    }
});
```

**Registration** in `trackHandle` ([Component.ts:656](src/typescript/lib/core/Component.ts#L656)) builds the record from the two live arrays:

```typescript
_componentFinalizer.register(this, { handles: this._ownedHandles, selectors: this._ownedSelectors }, this);
```

**`destructor()`** ([Component.ts:615](src/typescript/lib/core/Component.ts#L615)) — dispose the live rule objects before the existing handle-release/unregister block:

```typescript
this._styleRule.dispose();

for (const rule of this._deferredStyleRules.values()) {
    rule.dispose();
}
```

---

## Ordered Implementation Steps

1. **`DOMSink` interface — declare `deleteStyleRule`.** In [DOM.ts:465](src/typescript/lib/core/DOM.ts#L465), add the `deleteStyleRule(selector: string): void` declaration with JSDoc directly after `ensureStyleRule` (line 515). → verify: `grep -n deleteStyleRule src/typescript/lib/core/DOM.ts` shows the interface entry.

2. **`ProductionDOMSink.deleteStyleRule`.** In [DOM.ts:1345](src/typescript/lib/core/DOM.ts#L1345), directly after `ensureStyleRule`, add the implementation: `const sheet = this.mainSheet();` then scan `sheet.cssRules` for `(rule as CSSStyleRule).selectorText === selector` and `sheet.deleteRule(idx); return;` on match (mirror the `ensureStyleRule` scan loop). → verify: `npx tsc --noEmit` clean.

3. **`RecordingDOMSink.deleteStyleRule`.** In [tests/dom/TestDOM.ts:367](tests/dom/TestDOM.ts#L367), directly after `ensureStyleRule`, add `deleteStyleRule(selector: string): void { this.record('deleteStyleRule', selector); }`. → verify: implements-clause has no missing-member error.

4. **`StyleRule` — store selector, add `getSelector` / `dispose`; add `disposeStyleRule` + test exports.** In [StyleTarget.ts](src/typescript/lib/core/StyleTarget.ts):
   - Add module fn `disposeStyleRule(selector)` (exported) after `_ruleFor` (line 191), per the [Architecture Decisions](#stylerule-owns-its-selector-and-disposes-itself-a-module-fn-does-the-sinkcache-delete) snippet.
   - In the `StyleRule` constructor (line 234), add `private _selector: string;` field and set `this._selector = selector;` (reuse the already-computed `const selector = _selectorOf(spec)`).
   - Add `getSelector(): string { return this._selector; }`.
   - Add `dispose(): void { disposeStyleRule(this._selector); this._target = null; this._dirty = {}; }`.
   - Add exported test-only `_ruleCacheHas(selector)` and `_ruleCacheKeys()` reading `_ruleCache`.
   → verify: `npx tsc --noEmit` clean.

5. **`Component` — `_ownedSelectors` field + `trackSelector` + import.** In [Component.ts](src/typescript/lib/core/Component.ts):
   - Add `import { StyleRule, InlineStyle, disposeStyleRule } from "~/core/StyleTarget.js";` (widen the existing import at [line 18](src/typescript/lib/core/Component.ts#L18)).
   - Declare `private readonly _ownedSelectors: string[] = [];` beside `_ownedHandles` ([line 278](src/typescript/lib/core/Component.ts#L278)).
   - Add the private `trackSelector(selector: string): void { this._ownedSelectors.push(selector); }` helper (place near `trackHandle`).

6. **`Component` — finalizer held value + registration.** In [Component.ts](src/typescript/lib/core/Component.ts):
   - Define `type OwnedResources = { readonly handles: readonly Handle[]; readonly selectors: readonly string[]; };` above the finalizer.
   - Change `_componentFinalizer` ([line 253](src/typescript/lib/core/Component.ts#L253)) to `FinalizationRegistry<OwnedResources>` with the callback from [Internal Structure](#internal-structure).
   - Change the registration in `trackHandle` ([line 656](src/typescript/lib/core/Component.ts#L656)) to pass `{ handles: this._ownedHandles, selectors: this._ownedSelectors }`.
   → verify: `npx tsc --noEmit` clean.

7. **`Component` — record selectors at the three allocation sites.**
   - Constructor body: after `this._deferredStyleRules = new Map(...)` ([line 413](src/typescript/lib/core/Component.ts#L413)) and before `applyOptions` runs (line 467), add `this.trackSelector(this._styleRule.getSelector());`.
   - `setId`: after the `this._styleRule = new StyleRule(...)` re-point ([line 1284](src/typescript/lib/core/Component.ts#L1284)), add `this.trackSelector(this._styleRule.getSelector());`.
   - `createStyleRule`: after `this._deferredStyleRules.set(selectorSuffix, rule);` ([line 745](src/typescript/lib/core/Component.ts#L745)), add `this.trackSelector(rule.getSelector());`.

8. **`Component.destructor()` — dispose the rule objects.** In [destructor](src/typescript/lib/core/Component.ts#L615), before the `_componentFinalizer.unregister(this)` block, add the `_styleRule.dispose()` + `_deferredStyleRules` loop from [Internal Structure](#internal-structure). → verify: `npx tsc --noEmit` clean.

9. **Low-level test — `StyleRule.dispose` deletes + evicts.** Append to [tests/core/StyleTarget.test.ts](tests/core/StyleTarget.test.ts) (node env, recording sink installed by the baseline setup). Use a **unique** selector name per test (e.g. include a fresh suffix) since `_ruleCache` persists across `DOM.reset()`. Capture the sink via `DOM.sink as RecordingDOMSink`. Assert: after `ensure()`, `_ruleCacheHas("#<name>")` is true and `writes` contains an `ensureStyleRule` op; after `dispose()`, `_ruleCacheHas("#<name>")` is false and `writes` contains a `deleteStyleRule` op for that selector. Add a second case asserting `dispose()` on a never-`ensure()`d rule records no `deleteStyleRule` op (cache-guard no-op).

10. **Component-surface test — `destructor` disposes all component rules.** Append to [tests/component/Component.test.ts](tests/component/Component.test.ts) in its **own** `describe` block with `beforeEach(() => installTestDOM(DOM_CONFIG))` and `afterEach(() => DOM.reset())` (do not rely on the nested block's hooks); add `import { RecordingDOMSink } from '../dom/TestDOM'` and `import { Button } from '~/component/button/Button'`, and import `_ruleCacheHas` / `_ruleCacheKeys` from `~/core/StyleTarget`. Construct a `Component({})`, call `getElement(true)` to render (materialises `_styleRule`), assert `_ruleCacheHas("#" + c.getId())` is true; call `(c as unknown as { destructor(): void }).destructor()`, assert `_ruleCacheHas("#" + id)` is false and `_ruleCacheKeys()` contains no key starting with `"#" + id` (covers any deferred rules too). Add a second case constructing a `Button` (which allocates `:hover` / `:active` deferred rules), render, destructor, and assert no `_ruleCacheKeys()` entry starts with `"#" + button.getId()`.

11. **Full verification.** Run `npx tsc --noEmit`, `npm test`, and the manual localhost repro ([Verification](#verification)).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [src/typescript/lib/core/DOM.ts](src/typescript/lib/core/DOM.ts) — `DOMSink.deleteStyleRule` decl + `ProductionDOMSink` impl |
| Modify | [src/typescript/lib/core/StyleTarget.ts](src/typescript/lib/core/StyleTarget.ts) — `_selector` field, `getSelector`, `dispose`, `disposeStyleRule`, test exports |
| Modify | [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts) — `_ownedSelectors`, `trackSelector`, finalizer held value + callback, registration, selector recording, destructor disposal |
| Modify | [tests/dom/TestDOM.ts](tests/dom/TestDOM.ts) — `RecordingDOMSink.deleteStyleRule` |
| Modify | [tests/core/StyleTarget.test.ts](tests/core/StyleTarget.test.ts) — `StyleRule.dispose` cases |
| Modify | [tests/component/Component.test.ts](tests/component/Component.test.ts) — destructor-disposal cases |

---

## Expected Behaviour

Unit-testable (offline via `RecordingDOMSink`):

- `StyleRule.dispose()` on a materialised rule records a `deleteStyleRule` op for its selector on the sink and evicts the selector from `_ruleCache` (`_ruleCacheHas` → false).
- `StyleRule.dispose()` on a never-materialised rule (no `ensure()`) records **no** `deleteStyleRule` op and touches no cache entry (cache-guard no-op).
- `StyleRule.dispose()` is idempotent — a second call records no further `deleteStyleRule` op.
- After `dispose()`, calling `ensure()` again re-materialises (records a fresh `ensureStyleRule` op and re-caches) — dispose is not terminal.
- `Component.destructor()` on a rendered component evicts `#<uuid>` from `_ruleCache` and records a `deleteStyleRule` op; no `_ruleCacheKeys()` entry remains with the `#<uuid>` prefix.
- A rendered `Button` (deferred `:hover` / `:active` rules) leaves no `#<uuid>`-prefixed selector in `_ruleCache` after `destructor()`.
- `disposeStyleRule` never removes a shared `scope:"class"` / `scope:"selector"` selector, because a component records only its own `#<uuid>`-scoped selectors.

Manual / documented verification (the GC-finalizer path is not deterministically unit-testable):

- **Notification-churn repro (localhost:8015):** record the `Base` sheet's `cssRules.length` at baseline (empty screen); fire 25 notifications; wait for auto-dismiss back to empty; the rule count returns toward baseline (net growth per burst near zero) instead of staying elevated. Before this change the count is monotonic (816 → 1041 → 1266); after, each burst's rules are reclaimed on GC of the discarded `Notification` components.

The existing `--expose-gc`-gated finalizer test in [tests/dom/handle-registry.test.ts:127](tests/dom/handle-registry.test.ts#L127) demonstrates the pattern for exercising the GC path (it self-skips without `--expose-gc`); the notification repro is the primary manual check because the standard suite cannot force GC.

---

## Verification

- `npx tsc --noEmit` — clean (finalizer generic + `OwnedResources` type, new seam member on both sinks).
- `npm test` — the new `StyleTarget` and `Component` cases pass; no existing test regresses. The handle-registry destructor test ([tests/dom/handle-registry.test.ts:100](tests/dom/handle-registry.test.ts#L100)) must still pass (destructor now also disposes rules but the registry-size assertion is unaffected).
- `grep -rn "deleteStyleRule" src/ tests/` — present on interface, `ProductionDOMSink`, `RecordingDOMSink`, and the finalizer/dispose paths.
- Manual: the localhost:8015 notification-churn repro under [Expected Behaviour](#expected-behaviour), read via `document.getElementById('Base').sheet.cssRules.length` in DevTools.

---

## Potential Challenges

- **`_ruleCache` persistence across `DOM.reset()`.** The cache is StyleTarget module state and survives `DOM.reset()` (which rebuilds only the DOM.ts sink/source). Tests must use unique selector names so a leftover cache entry from a prior test doesn't mask an `ensureStyleRule` op (a cache hit skips the sink call). Component-surface tests are naturally safe (UUID ids).
- **`setId` on an already-rendered component leaves the old `#<oldid>` rule materialised.** The old selector *is* recorded in `_ownedSelectors` (setId records the new one; the constructor recorded the initial one), so the **finalizer** cleans it. The eager `destructor()` path disposes only the current `_styleRule` object, so a post-render `setId` + explicit `destructor()` leaves the old rule until GC — a rare, pre-existing latent leak, out of scope (see [Non-Goals](#non-goals)).
- **Duplicate selector recording** (initial `#<uuid>` + `setId` re-point; CollapseButton's `createStyleRule("")` sharing `#<uuid>` with `_styleRule`) is harmless: `disposeStyleRule` is idempotent via the cache-`has` guard.

---

## Critical Files

- [src/typescript/lib/core/StyleTarget.ts](src/typescript/lib/core/StyleTarget.ts) — `StyleRule`, `_ruleCache`, `_ruleFor`, `_selectorOf`; the `ensureStyleRule` seam call the dispose path inverts.
- [src/typescript/lib/core/DOM.ts](src/typescript/lib/core/DOM.ts) — `DOMSink` interface, `ProductionDOMSink.ensureStyleRule` / `mainSheet` (the precedent to mirror), `_handleRegistrySize` (the test-export precedent to mirror at [DOM.ts:285](src/typescript/lib/core/DOM.ts#L285)).
- [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts) — `_componentFinalizer` + held-value pattern ([line 253](src/typescript/lib/core/Component.ts#L253)), `trackHandle` ([line 654](src/typescript/lib/core/Component.ts#L654)), `destructor` ([line 615](src/typescript/lib/core/Component.ts#L615)), `_styleRule` / `_deferredStyleRules` / `createStyleRule`, `setId` ([line 1268](src/typescript/lib/core/Component.ts#L1268)), `render` ([line 4997](src/typescript/lib/core/Component.ts#L4997)).
- [tests/dom/TestDOM.ts](tests/dom/TestDOM.ts) — `RecordingDOMSink` (the sink to extend, [line 292](tests/dom/TestDOM.ts#L292)); `installTestDOM` returns the sink instance ([line 1164](tests/dom/TestDOM.ts#L1164)).
- [tests/dom/handle-registry.test.ts](tests/dom/handle-registry.test.ts) — the teardown-test precedent (destructor cast, `--expose-gc`-gated GC test).

---

## Non-Goals

- **Removing the `ensureStyleRule` `cssRules` scan.** Unsafe without a cache/sheet-lifecycle change (cache persists across `DOM.reset()`, sheet does not); the leak fix is the goal, not this perf tweak.
- **The `InlineStyle` buffers** (`_inlineStyle`, `_clipFrameStyle`, `_contentFrameStyle`) need no rule disposal: `InlineStyle` writes `element.style` via `DOM.sink.apply` ([StyleTarget.ts:305](src/typescript/lib/core/StyleTarget.ts#L305)), never the shared sheet. Their wrapper elements are already released through the handle path (`clearClipFrame` / `clearContentFrame`, `trackHandle` / `untrackHandle`). Confirmed: no shared-sheet rule is involved.
- **Fully cleaning the post-render `setId` orphan on the eager `destructor()` path.** A pre-existing latent leak (the finalizer path already handles it via `_ownedSelectors`); fixing the eager path would require the destructor to also sweep `_ownedSelectors`, which is out of scope for this leak fix.
- **Clearing `_ruleCache` on `DOM.reset()`.** A separate cache-lifecycle concern; unrelated to per-component teardown.
