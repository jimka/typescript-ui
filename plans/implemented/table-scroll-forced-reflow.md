# Shared Border-Width Measurement — Implementation Plan

## Overview

Horizontally scrolling a wide table stalls the main thread for hundreds of milliseconds on every frame that slides the column window. The cause is not the table: it is that [`Component.getBorderSize()`](packages/lib/src/typescript/lib/core/Component.ts#L2990) measures each component's border with its own `getComputedStyle` call, and that read lands in the middle of a frame that is already writing stylesheet rules.

**A style or layout read that follows a stylesheet-rule write, in the same task, makes every later rule write in that task about 85× dearer** — 0.014 ms becomes ~1.2 ms, scaling with the number of rules on the shared sheet. Call it the *read-after-write penalty*. A column-window slide builds a fresh cell in every rendered row, issues ~30 border reads, and then pays that penalty on ~600 rule writes.[^measurements]

The fix is to measure a given border specification **once**, not once per component. A new internal module `core/BorderWidths.ts` owns a map from border spec to measured per-side widths, cleared on theme change; [`Component.getBorderSize`](packages/lib/src/typescript/lib/core/Component.ts#L2990) calls into it instead of reading the seam directly. A 45-column table has exactly one distinct cell-border spec, so a slide goes from ~30 reads to zero. Measured on the library's own 45-column demo: **45 scroll frames drop from 8.0–9.9 s (9–10 frames over 100 ms, worst 1337 ms) to 1.08–1.18 s (no frame over 100 ms, worst 60 ms).**[^ab-test]

Nothing about the content-box behaviour changes. The widths are still browser-measured through `DOM.source.getBorderWidths`; the measurement is simply shared instead of repeated.

---

## Architecture Decisions

### Share one measurement per border spec, in a module beside `ClassStyleRules`

`core/BorderWidths.ts` holds the spec → widths map, the theme subscription, and the key derivation. It mirrors [`core/ClassStyleRules.ts:137`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L137), the existing internal module that caches per-class style state on `Component`'s behalf: not exported from `core/index.ts`, typed structurally so it never imports `core/Component.ts`, and documented with a pointer back to this plan.[^why-module]

### The cache key is the four resolved side strings

[`borderToStyle`](packages/lib/src/typescript/lib/primitive/Border.ts#L34) already resolves a `BorderOptions` bag into its four per-side CSS values, applying the `side ?? border ?? "none"` fallback. The key is those four values joined by `|`, so two specs that resolve to the same four sides share one entry.

| `BorderOptions` | Key | Entry |
|---|---|---|
| `{ border: "var(--ts-ui-table-cell-border, none)" }` | `var(…)\|var(…)\|var(…)\|var(…)` | every table cell — one measurement for the whole table |
| `{ borderBottom: "1px solid var(--ts-ui-table-header-border, black)" }` | `none\|none\|1px solid var(…)\|none` | `TableHeader`, its own entry |
| `{ border: "none" }` (from `clearBorder`) | `none\|none\|none\|none` | every cleared component |

### Only the connected branch reads or fills the cache

`getBorderSize` has two branches: a browser measurement once the element is in the document, and a pre-attach estimate parsed from the spec strings. The shared cache is consulted and written **only on the measurement branch**. The estimate branch is left exactly as it is.[^estimate-branch]

### Theme invalidation is one module-level subscription, registered at import

`core/BorderWidths.ts` calls `ThemeManager.onThemeChange` once at module scope to clear the whole map. Registering at import — rather than lazily on first use — puts this listener ahead of every per-component listener in `ThemeManager`'s registration-ordered fan-out, so no component can observe a stale shared entry while a theme change is still being delivered.[^listener-order]

### A font-relative side spec opts out of sharing

A side value whose width is a font-relative length (`em`, `ex`, `ch`, `lh`) resolves against the element's own font size, so two components with the same spec can measure differently. Such a spec is measured per component and never cached.

| Side value | Shared? | Why |
|---|---|---|
| `1px solid black` | yes | absolute length |
| `var(--ts-ui-table-cell-border, none)` | yes | resolves against `:root` |
| `0.125rem solid black` | yes | `rem` is root-relative |
| `0.1em solid black` | no | depends on the element's font size |

---

## Internal Structure

`core/BorderWidths.ts`:

```typescript
/** Per-side pixel widths. Structural twin of `Component`'s `PerimeterSize`. */
interface SideWidths {
    top:    number;
    right:  number;
    bottom: number;
    left:   number;
}

// Resolved-side-string key -> measured widths. Cleared on theme change.
const _widths: Map<string, SideWidths> = new Map();

ThemeManager.onThemeChange(clearBorderWidths);

/**
 * Returns the browser-measured per-side border widths for `spec`, measuring
 * `element` only when this spec has not been measured under the active theme.
 */
export function measureBorderWidths(spec: BorderOptions, element: Handle): SideWidths;

/** Drops every entry. Called on theme change and by the test harness. @internal */
export function clearBorderWidths(): void;

/** Number of cached entries; for tests only. @internal */
export function _borderWidthCacheSize(): number;
```

The measurement body is the four `borderSideWidth(cs.<side>)` conversions lifted verbatim out of `Component.getBorderSize`.

---

## Ordered Implementation Steps

1. **Create `packages/lib/src/typescript/lib/core/BorderWidths.ts`** with the shape above. Import `DOM` and `type Handle` from `~/core/DOM.js`, `BorderOptions` / `borderToStyle` / `borderSideWidth` from `~/primitive/Border.js`, and `ThemeManager` from `~/core/Theme.js`. Do **not** import `~/core/Component.js` — declare `SideWidths` structurally, with a comment saying why, mirroring `ClassStyleRules.ts`'s own note.

2. **Implement key derivation** in a private `cacheKey(spec: BorderOptions): string | null`. Call `borderToStyle(spec)`, join `borderTop`, `borderRight`, `borderBottom`, `borderLeft` with `"|"`, and return `null` when any of the four matches the font-relative pattern `/[\d.](?:em|ex|ch|lh)\b/i` — a digit immediately before the unit, so `rem` does not match. A `null` key means "measure, don't cache".

3. **Implement `measureBorderWidths(spec, element)`**: derive the key; return a hit if present; otherwise call `DOM.source.getBorderWidths(element)`, convert each side with `borderSideWidth`, store under a non-`null` key, and return. Never store under a `null` key.

4. **Implement `clearBorderWidths()` and `_borderWidthCacheSize()`**, and register `ThemeManager.onThemeChange(clearBorderWidths)` at module scope.

5. **Rewrite the measurement branch of `Component.getBorderSize`** ([`Component.ts:2990-3026`](packages/lib/src/typescript/lib/core/Component.ts#L2990)). Replace the `DOM.source.getBorderWidths(element)` call and the four `borderSideWidth(...)` conversions with:

   ```typescript
   this._borderWidths = measureBorderWidths(this._border, element);

   return this._borderWidths;
   ```

   Leave the `!this._border` early return, the `this._borderWidths` hit, the `isConnected` guard, and the whole pre-attach estimate branch untouched. Add the `measureBorderWidths` import.

6. **Checkpoint.** `grep -n 'borderSideWidth' packages/lib/src/typescript/lib/core/Component.ts` — expect two matches — the import and the single use inside `estimateBorderSideWidth` ([`Component.ts:3039`](packages/lib/src/typescript/lib/core/Component.ts#L3039)) — and the four `cs.<side>` uses to be gone. The `borderSideWidth` import stays in `Component.ts`, because the estimate branch still needs it.

7. **Update `getBorderSize`'s JSDoc.** It currently says the widths are "cached until the next `setBorder`/`clearBorder` or theme change". Say instead that a measurement is shared by every component carrying the same border specification and is discarded on theme change, and that a font-relative spec is measured per component.

8. **Clear the cache from the test harness.** In [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts), have `installTestDOM` call `clearBorderWidths()` before `DOM.install`, so a test file's cases cannot inherit widths measured against a previously installed source. Mirrors the `_ruleCacheHas` precedent of an underscore-prefixed internal export consumed by tests.

9. **Add `packages/lib/tests/core/BorderWidths.test.ts`** covering the unit-testable rows in `## Expected Behaviour`. Follow the shape of [`tests/core/ClassStyleRules.test.ts`](packages/lib/tests/core/ClassStyleRules.test.ts): `installTestDOM` in `beforeEach`, `DOM.reset()` in `afterEach`. To exercise the measurement branch, wrap the installed source — `DOM.install({ source: Object.create(DOM.source, { … }) })` — with `isConnected` forced `true` and a counting `getBorderWidths` that returns a chosen width.

10. **Extend the "Avoiding layout thrash" section of [`packages/lib/docs/concepts/performance.md`](packages/lib/docs/concepts/performance.md#L107)** with a bullet on the read-after-write penalty: within one task, a style or layout read issued after a stylesheet-rule write makes every later rule write cost roughly O(rules on the shared sheet); batch reads ahead of the frame's first rule write, or serve them from a cache.

11. **Run the verification checks** in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/BorderWidths.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Create | `packages/lib/tests/core/BorderWidths.test.ts` |
| Modify | `packages/lib/docs/concepts/performance.md` |

---

## Expected Behaviour

Unit-testable (offline, `installTestDOM` plus a wrapped source):

1. Two components carrying the identical border spec, both connected, produce **one** `DOM.source.getBorderWidths` call between them, and both report the measured widths.
2. Two components carrying different specs produce **two** calls.
3. `{ border: "1px solid black" }` and `{ borderTop: "1px solid black", borderRight: "1px solid black", borderBottom: "1px solid black", borderLeft: "1px solid black" }` share one entry — they resolve to the same four sides.
4. `{ borderBottom: "2px solid black" }` and `{ borderTop: "2px solid black" }` do **not** share an entry.
5. A `ThemeManager` theme change empties the cache: `_borderWidthCacheSize()` returns `0`, and the next `getBorderSize` on a connected component measures again.
6. `{ border: "0.1em solid black" }` is measured on every call — two components with that spec produce two calls, and `_borderWidthCacheSize()` stays `0` for it.
7. `{ border: "0.125rem solid black" }` **is** cached — `rem` is root-relative.
8. A component whose element is not connected still takes the estimate branch: `getBorderSize()` on an unrendered component with `3px solid red` reports `3` without any `getBorderWidths` call, and adds no cache entry.
9. After `setBorder`, the component's own `getBorderSize()` reflects the new spec — the per-instance `_borderWidths` field is still invalidated by the setter.
10. `clearBorder()` reports zero widths on every side.

Manual verification (browser only — this is a frame-timing and forced-style-recalc effect the offline harness cannot model):

11. The 45-column demo table scrolls horizontally with no frame over 100 ms (see `## Verification` for the harness and thresholds).
12. Cell, header and table borders render at the same widths as before, in both the default and classic themes, and still shrink the content box rather than moving its origin — the demo's **Content Box** section is unchanged.
13. Toggling the theme with a bordered table on screen re-renders borders at the new theme's widths.

---

## Verification

```bash
cd packages/lib
npm run typecheck
npm run test          # includes tests/component/content-box-containment.test.ts
npm run lint          # local/require-content-bounds and local/no-raw-dom must pass unchanged
npm run test:lint
npm run docs:api      # must finish with zero warnings
grep -n 'DOM.source.getBorderWidths' src/typescript/lib/core/Component.ts   # expect zero matches
grep -rn 'getBorderWidths' src/typescript/lib/                              # expect only core/DOM.ts and core/BorderWidths.ts
```

`npm run lint` covers the `local/require-content-bounds` baseline; no baseline entry may be added.

**Scroll benchmark.** `npm run dev` in `packages/lib`, open the demo, go to the **Misc** section, and click *"Show window with wide table (45 columns)!"* ([`src/typescript/MiscPanel.ts:346`](packages/lib/src/typescript/MiscPanel.ts#L346)). In the console:

```javascript
const sweep = async (dir) => {
    const f = [];

    for (let i = 0; i < 45; i++) {
        const td = document.querySelector('td');
        const s  = performance.now();

        td.dispatchEvent(new WheelEvent('wheel', { deltaX: dir * 120, bubbles: true, cancelable: true }));
        await new Promise(r => requestAnimationFrame(r));
        f.push(performance.now() - s);
    }

    return { total: Math.round(f.reduce((a, b) => a + b, 0)), over100: f.filter(x => x > 100).length, worst: Math.round(Math.max(...f)) };
};

await sweep(1);   // scroll right
await sweep(-1);  // scroll back
```

**Counts as fixed:** `over100 === 0` and `total < 2000` on both sweeps. Today's numbers on the same harness are `total` 7994–9891, `over100` 9–10, `worst` 1015–1337.

**Production bundle.** Re-measure the same way against `npm run build && npm run preview` (the demo app is served from `packages/lib/index.html`, no API proxy needed). Expect the *same* verdict, not merely a smaller number: the penalty this plan removes is browser style work, not JavaScript, so minification does not shrink it — the dev build only inflates the JS around it. If a production run shows `over100 > 0`, a second read is still landing after a rule write and the fix is incomplete.

---

## Documentation Impact

`core/BorderWidths.ts` is internal and is **not** added to `core/index.ts`, matching `core/ClassStyleRules.ts`. No public symbol is added, renamed or removed, so no API doc page or catalog entry changes.

`getBorderSize`'s JSDoc is public and is rewritten (step 7); per this repo's conventions it must not `{@link}` the new internal module — describe the sharing in prose. [`docs/concepts/performance.md`](packages/lib/docs/concepts/performance.md) gains one bullet (step 10).

---

## Potential Challenges

- **A consumer rule could give two same-spec components different widths** (an `!important` declaration, or a `--ts-ui-*` custom property redefined on a subtree rather than `:root`). The `#id` rule the framework writes normally wins, and the framework defines its border variables on `:root` only. Mitigation: the behaviour is documented in `getBorderSize`'s JSDoc, so a consumer hitting it knows why.
- **Listener ordering on theme change.** If the module-level clear were registered lazily it could run after a component's own theme listener. Mitigation: register it at module scope (step 4) and keep it there.
- **Module state outlives `DOM.reset()`.** Vitest isolates modules per file, but not per test. Mitigation: `installTestDOM` clears the cache (step 8), so every `beforeEach` starts clean.
- **The offline suite cannot see the win.** `ModelledDOMSource.getBorderWidths` returns `0px` and `isConnected` defaults to `false`, so existing tests take the estimate branch and are untouched. Mitigation: the new test wraps the source (step 9); the frame-timing claim is verified in the browser.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Component.ts:2990-3062`](packages/lib/src/typescript/lib/core/Component.ts#L2990) — `getBorderSize`, `estimateBorderSideWidth`; the only call site.
- [`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) — the precedent the new module mirrors: internal module, structural typing, module-level cache on `Component`'s behalf.
- [`packages/lib/src/typescript/lib/primitive/Border.ts:34-70`](packages/lib/src/typescript/lib/primitive/Border.ts#L34) — `borderToStyle` (key derivation) and `borderSideWidth` (px parsing).
- [`packages/lib/src/typescript/lib/core/Theme.ts:1280`](packages/lib/src/typescript/lib/core/Theme.ts#L1280) — `ThemeManager.onThemeChange`.
- [`packages/lib/src/typescript/lib/core/DOM.ts:2256`](packages/lib/src/typescript/lib/core/DOM.ts#L2256) — `ProductionDOMSource.getBorderWidths`, the read being shared.
- [`packages/lib/tests/core/ClassStyleRules.test.ts`](packages/lib/tests/core/ClassStyleRules.test.ts) — test shape for a module-level cache.
- [`packages/lib/tests/component/content-box-containment.test.ts:127`](packages/lib/tests/component/content-box-containment.test.ts#L127) — `expectBorderOnlyShrinks`, the content-box guard that must stay green.
- [`packages/lib/src/typescript/lib/component/table/cell/Cell.ts:64`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L64) — the one border spec every table cell carries.

---

## Non-Goals

- **Rebuilding fewer cells per slide.** A one-column slide currently discards ~30 cells and builds ~30 fresh ones because [`Row.setColumnWindow`](packages/lib/src/typescript/lib/component/table/Row.ts#L273) only recycles a cell whose reuse key matches, and neighbouring columns often differ in type. That is real work, but with the read gone it is cheap work.[^why-not-recycle]
- **Restructuring the render pass into read-all-then-write-all.** Measured as unable to hold the guarantee it needs.[^why-not-hoist]
- **Reducing the number of stylesheet rules, or the per-instance rules a closed tab leaks.** The leak is a separate defect with its own plan (`plans/dock-disposes-tab-content.md`); it multiplies this one, because the penalty scales with sheet size, but neither fix depends on the other.
- **The diagram's slow first render.** A separate defect with its own signature — ~29,000 `doLayout` and ~100,000 `getPreferredSize` calls for ~10,000 components — that is a redundant-pass problem, not a read-after-write one. This fix removes one read from that pass and should help; it will not account for tens of seconds.[^diagram]

---

## Addendum: What Was Measured

All figures from the library's own demo (`packages/lib`, `npm run dev`), 45-column table in a 900×600 window, 29 rendered rows, ~2100 rules on the shared sheet, wheel-driven horizontal scroll at 120 px/frame.

**Where the time goes on a slide frame.** Seam-level attribution of one ~820 ms frame:

| Seam call | ms | calls |
|---|---|---|
| `DOM.sink.setRuleStyles` | 655 | 548 |
| `DOM.sink.ensureStyleRule` (`insertRule`) | 111 | 93 |
| `DOM.source.getBorderWidths` | 12 | 30 |
| everything else | < 10 | — |

The read Chrome's ForcedReflow insight names is 1.5% of the frame. The writes it triggers are 80%.

**The read-after-write penalty.** 600 `setRuleStyles` calls, timed after one preceding rule write plus one read of the given kind, against a 2119-rule sheet:

| Preceded by | 600 writes cost |
|---|---|
| a rule write only (control) | 7.5 ms |
| write + `getComputedStyle(td).borderTopWidth` | 648 ms |
| write + `getComputedStyle(:root).getPropertyValue('--x')` | 576 ms |
| write + `getComputedStyle(td).overflow` | 586 ms |
| write + `td.getBoundingClientRect()` | 664 ms |
| write + `td.offsetWidth` | 582 ms |
| write + `el.scrollLeft` | 667 ms |

Every read kind triggers it; a read that precedes the task's first rule write does not (8.2 ms). The penalty persists for the rest of the task — a second burst of 600 writes after the first still cost 704 ms — and clears at the next animation frame (8.7 ms). It scales with sheet size: 1.22 ms per write at 2392 rules, 2.84 ms at 8392.

**Before / after.** `Component.prototype.getBorderSize` patched in the page with the spec-keyed cache this plan specifies, two 45-frame sweeps each way:

| | total | frames > 100 ms | worst |
|---|---|---|---|
| unpatched | 9891 ms / 7994 ms | 10 / 9 | 1337 ms / 1015 ms |
| patched | 1081 ms / 1180 ms | 0 / 0 | 60 ms / 47 ms |

The warm cache held **one** entry for the whole table.

---

## Notes

[^measurements]: Full numbers in `## Addendum: What Was Measured`. The short version: on a slide frame the library issues ~600 stylesheet-rule writes and ~30 `getComputedStyle` reads, interleaved. Without the reads the writes cost ~8 ms in total; with them, ~660 ms. Chrome's ForcedReflow insight attributes the trace to `getBorderWidths` because that is the read that trips the penalty, but the read's own duration is ~12 ms of an ~820 ms frame — which is why the insight's totals looked too small to explain the trace.

[^ab-test]: The A/B was run by patching `Component.prototype.getBorderSize` in the live page with exactly the spec-keyed cache this plan specifies — same measurement source, same values, only shared — and re-running the same wheel sweep. Nothing else was changed.

[^why-module]: The alternative was a `private static` map on `Component`. `core/Component.ts` is already 5,600 lines, and the cache needs three things that do not belong in it: a key derivation with an opt-out rule, a module-level theme subscription, and a test-visible reset. `ClassStyleRules.ts` solved the same shape of problem the same way and even documents the import-cycle reason for typing structurally rather than importing `Component`'s own types, which is why `SideWidths` is declared locally instead of importing `PerimeterSize`.

[^estimate-branch]: The estimate branch resolves a leading `var(--name)` against `:root` and is deliberately not cached, because it is provisional — the element re-measures authoritatively once connected. It is also the branch the whole offline suite runs on, since `ModelledDOMSource.isConnected` defaults to `false`: `tests/component/content-box-containment.test.ts` asserts `bordered.getBorderSize().left === border` from spec strings alone. Consulting the shared cache there would change what those tests observe for no gain, since the estimate branch issues no `getComputedStyle` and so cannot trip the penalty.

[^listener-order]: `ThemeManager.onThemeChange` appends to an array and `applyTheme` walks it in order. `Component.setBorder` subscribes each bordered component to null its own `_borderWidths`. If a component's listener ran first and something downstream of it re-read `getBorderSize` before the shared map was cleared, the component would re-adopt a pre-theme measurement. Subscribing at module import puts the clear ahead of every component listener, because no component can exist before `core/BorderWidths.ts` has been imported by `core/Component.ts`.

[^why-not-recycle]: A one-column slide was measured building ~90 components (cells plus their renderers and editors) and disposing ~30. Extending `Row.setColumnWindow`'s recycling — a per-row idle pool keyed on the reuse key, so a `date` cell leaving the window is kept for the next `date` column instead of disposed — would cut that. It is not what this plan does, for two reasons. It narrows one component's symptom rather than removing the mechanism: any component realised mid-frame after a rule write pays the same penalty. And it is unnecessary once the read is gone — the same ~600 rule writes cost ~8 ms with no read among them, which is why the patched sweeps show no frame over 100 ms despite still building every one of those cells.

[^why-not-hoist]: Reordering a render pass into read-all-then-write-all does work in principle: a read issued before the task's first rule write costs nothing and poisons nothing (8.2 ms for the following 600 writes, versus 648 ms when one rule write precedes the read). It fails in practice because the guarantee it needs is "no rule write anywhere earlier in the task", and a render pass writes as it goes — `addComponent` renders a child, which materialises that child's rule, long before any layout read. Holding the invariant would mean restructuring `Body`, `Row`, `Cell` and `LayoutManager` into an explicit measure phase and a mutate phase, and it would still not cover a read issued by consumer code inside the same task. Removing the read is smaller and strictly stronger.

[^diagram]: sqladmin's `TODO.md` records a 156-card diagram whose first render blocks for 42 s with ~29,000 `Component.doLayout` and ~100,000 `getPreferredSize` calls for ~10,000 components. Those counts are ~3 layout passes and ~10 size reports per component, which is a redundant-pass defect and not this one. The two do interact: that render inserts ~10,000 rules and writes many more declarations, so any style read landing among them makes every later write cost O(sheet size) — and the sheet is by then very large. Removing the per-component border read takes one such read out of that pass, so the fix should help it; it does not explain it.

---

## Implementation Notes

- **Production-bundle re-check (`## Verification`, "Production bundle") could not be completed.** `npm run build` itself succeeds with zero errors (typecheck clean, `vite build` completes), confirming the change compiles and tree-shakes cleanly for production. But `npm run preview` fails to mount the app at all: every route throws `Uncaught ReferenceError: Prism is not defined` at module-evaluation time, before any app code runs — `take_snapshot` on the preview page returns an empty `RootWebArea` and `document.body.innerHTML.length` is `5`. This is a pre-existing, unrelated defect: `@lexical/code` (pulled in by `MarkdownEditor.ts`/`editorNodes.ts`, neither touched by this branch) bundles PrismJS, whose per-language component modules assume a global `Prism` — a known Rollup/Vite production chunk-splitting failure mode, orthogonal to border-width caching. The error reproduces identically on every route (including `/`), which rules out anything route-specific to this plan's own demo entry point (`MiscPanel.ts`'s wide-table button). Confirmed via a fresh-context audit reviewer's independent reproduction of the same failure and independent tracing to the same `@lexical/code`/PrismJS cause.
- **What substituted.** The scroll benchmark from `## Verification` was run instead against `npm run dev` (real browser, via chrome-devtools MCP driving the actual demo), which the plan's own "Manual verification" list treats as the primary path. Both sweeps came back on-target and consistent with the plan's own patched reference numbers: scrolling right gave `{ total: 1129, over100: 0, worst: 52 }`, scrolling back gave `{ total: 1185, over100: 0, worst: 55 }` (plan's own patched sweeps: 1081/1180 ms total, 0 frames over 100 ms, worst 60/47 ms). Cell/header/table borders were confirmed visually unchanged in both the default and classic themes (screenshots taken before/after `ThemeManager`'s theme-toggle button), the Content Box demo tab rendered with no regressions, and no console errors appeared at any point. The one check genuinely not performed is confirming the *specific numeric* scroll-benchmark verdict survives a minified/production bundle — the plan's own reasoning for why that additional check matters (the penalty is browser style-recalc work, not JS, so minification doesn't change it structurally) still applies; only the empirical re-confirmation is missing, blocked by the unrelated Prism failure.
