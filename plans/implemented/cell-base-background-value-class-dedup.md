---
touches-shared: [packages/lib/src/typescript/lib/core/Component.ts]
---

# Cell base-background value-class dedup — Implementation Plan

## Overview

A live Style Audit scan ([packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts:108](packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts#L108)) reports the framework's largest duplicate-CSS-rule group: roughly 90 table cells each carrying their own per-instance stylesheet rule whose entire body is one identical `background-color` declaration. Those cells are the three `groupColor`-tinted columns of the demo table ([packages/lib/src/typescript/MiscPanel.ts:679](packages/lib/src/typescript/MiscPanel.ts#L679)), rendered across the body row pool and the header.

`Cell.setBaseBackground` ([packages/lib/src/typescript/lib/component/table/cell/Cell.ts:443](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L443)) already calls the framework's value-class sharing mechanism, `Component.setValueStyleState` ([packages/lib/src/typescript/lib/core/Component.ts:5704](packages/lib/src/typescript/lib/core/Component.ts#L5704)), and that shared `.Cell.bg<color>` rule really is created — exactly once. The per-instance rules are written *in addition to it*, by the render-time flush, and win on specificity. So the shared rule is dead weight and the duplication it exists to prevent happens anyway.

The cause is a gap in the layered style bag: `setValueStyleState` publishes CSS on a tier that no `StyleLayer` models, so `flushStyleBag` ([packages/lib/src/typescript/lib/core/Component.ts:5348](packages/lib/src/typescript/lib/core/Component.ts#L5348)) cannot see that the value is already delivered and writes it per instance. This plan closes that gap in `core/Component.ts`. `Cell.ts` needs no behavioural change.

---

## The defect

### What happens today

`setBaseBackground` does two things. It calls `cacheStyleValue("backgroundColor", background)` so `getBackgroundColor()` keeps answering the group colour, and it calls `setValueStyleState("bg", color, { backgroundColor: color })` so the paint comes from a shared class-tier rule. `cacheStyleValue` ([packages/lib/src/typescript/lib/core/Component.ts:5103](packages/lib/src/typescript/lib/core/Component.ts#L5103)) deliberately queues no CSS write and no flush, which is why the call site looks correct.

The flush still finds the value. `applyStyle` seeds the pending key set from **every** layer's resolved keys, including the instance layer ([packages/lib/src/typescript/lib/core/Component.ts:5819](packages/lib/src/typescript/lib/core/Component.ts#L5819)). So at first render `backgroundColor` is pending, `flushStyleBag` sees it declared on the instance layer with the group colour, compares it against `layersBelowInstance()` — group tier, then class tier — finds `.Cell`'s theme token instead, calls that a deviation, and writes the group colour to this cell's own rule.

`layersBelowInstance()` ([packages/lib/src/typescript/lib/core/Component.ts:5007](packages/lib/src/typescript/lib/core/Component.ts#L5007)) is documented as answering "does a tier *other than this instance's own* already supply this value". The value class is such a tier. It is simply not in the list.[^probe]

### Why ordering hides it from the existing test

The regression test that pins "a rebind never re-materialises the `#id` rule" ([packages/lib/tests/component/table/cell/Cell.test.ts:203](packages/lib/tests/component/table/cell/Cell.test.ts#L203)) renders the cell **first** and calls `setBaseBackground` after. Production runs the opposite order: `Row` and `Header` build a cell, set its base background, and only then let it render ([packages/lib/src/typescript/lib/component/table/Row.ts:618](packages/lib/src/typescript/lib/component/table/Row.ts#L618), [Row.ts:750](packages/lib/src/typescript/lib/component/table/Row.ts#L750), [Header.ts:903](packages/lib/src/typescript/lib/component/table/Header.ts#L903), [Header.ts:993](packages/lib/src/typescript/lib/component/table/Header.ts#L993)). The test's ordering is the one case where the instance layer holds the plain theme token at render, which matches the class tier and produces the harmless removal the test asserts.

### The stale-declaration defect this drags along

Once that per-instance declaration exists, nothing rewrites it. A later `setBaseBackground` on a rendered cell goes through `cacheStyleValue`, which schedules no flush, and through `setValueStyleState`, which only swaps a DOM class token. The per-instance declaration keeps its original colour and keeps outranking the new value class. A pooled cell recycled onto a different column therefore paints the colour of whichever column it first rendered in.[^stale]

---

## Architecture Decisions

### The value class becomes a real layer below the instance layer

`setValueStyleState` records the `StyleLayer` its shared rule publishes, and `layersBelowInstance()` returns those layers ahead of the group and class layers. `flushStyleBag`'s existing per-key comparison then reports a match and queues a removal instead of a real write — no new branch in the flush.[^layer-not-branch]

This mirrors the resting tier's own contract, which `Text` already depends on: a value class only works while the instance tier carries no competing declaration for the same key, which is why `Text.setLineHeight` explicitly clears `font.lineHeight` off the instance layer before pointing at a `.Text.lh<px>` rule ([packages/lib/src/typescript/lib/component/input/Text.ts:1174](packages/lib/src/typescript/lib/component/input/Text.ts#L1174)). `Cell` cannot copy that move, because its getter reads the style bag while `Text`'s reads `_options` — so the mechanism learns the tier instead.[^why-not-clear]

### `styleLayers()` and the getters are left alone

Only `layersBelowInstance()` gains the value layers. `styleLayers()`, `resolveStyleValue`, and every typed getter built on it keep their current behaviour, and `_resolvedCache` needs no new invalidation.[^scope-below-instance]

### A value class serving a resting-isolation key carries the resting guard

When a value class's declarations touch a key in `restingIsolationKeys()` ([packages/lib/src/typescript/lib/core/Component.ts:5572](packages/lib/src/typescript/lib/core/Component.ts#L5572)), its shared rule's selector gets `restingGuardSuffix(this.constructor)` appended — the same suffix the per-instance resting rule uses. The DOM class token is unchanged; only the rule's selector grows.

Without the guard the shared rule ties on specificity with `Cell`'s own `.rangeSelected` state rule, and source order — which depends on which cell happens to render first — decides which one paints:

| Selector | Specificity | Applies when |
|---|---|---|
| `#c17:not(.rangeSelected):not(.readOnly):not(.requiredEmpty)` — today, one per cell | `(1,3,0)` | no state active |
| `.Cell.bgrgba_30__100__200__0_06_` — today, shared but outranked | `(0,2,0)` | always |
| `.Cell.rangeSelected` | `(0,2,0)` | range-selected |
| `.Cell` | `(0,1,0)` | always |
| `.Cell.bgrgba_30__100__200__0_06_:not(.rangeSelected):not(.readOnly):not(.requiredEmpty)` — after this change | `(0,5,0)` | no state active |

The guarded form can never match at the same moment as a state rule, so nothing is left to arbitrate. `Text`'s `lh` value class declares `lineHeight`, which is in no isolation set, so it stays unguarded and its selector does not change.[^guard-condition]

---

## Internal Structure

`_valueStyleTokens` ([packages/lib/src/typescript/lib/core/Component.ts:598](packages/lib/src/typescript/lib/core/Component.ts#L598)) becomes one map holding both halves, so the token and the layer can never drift apart:

```typescript
// Per-prefix value-class state: the DOM class token this instance currently
// carries, and the StyleLayer the shared rule behind it publishes.
private _valueStyleTokens: Map<string, { token: string; layer: StyleLayer }> = new Map();
```

`setValueStyleState` gains the guard and the layer record:

```typescript
protected setValueStyleState(prefix: string, cssValue: string, patch: StyleBag): void {
    const token        = prefix + cssValue.replace(/[^a-zA-Z0-9]/g, "_");
    const declarations = resolvePartialDeclarations(patch);
    const guard        = this.valueClassGuardSuffix(declarations);

    this.ensureSharedStateRule("." + token + guard, declarations);

    const element  = this.getElement();
    const previous = this._valueStyleTokens.get(prefix)?.token;
    if (element) {
        const removeClass = (previous && previous !== token) ? [previous] : [];
        DOM.sink.apply(element, { removeClass, addClass: [token] });
    }

    this._valueStyleTokens.set(prefix, { token, layer: { authored: patch, resolved: declarations } });
}
```

The guard helper — empty unless this instance isolates its resting chrome *and* the declarations touch an isolated key:

```typescript
private valueClassGuardSuffix(declarations: Record<string, string | null>): string {
    if (!this.isRestingChromeIsolated()) {
        return "";
    }

    const isolated = this.restingIsolationKeys();

    return Object.keys(declarations).some((key) => isolated.has(key))
        ? restingGuardSuffix(this.constructor)
        : "";
}
```

`layersBelowInstance` prepends the recorded layers:

```typescript
protected layersBelowInstance(): ReadonlyArray<StyleLayer> {
    const layers: StyleLayer[] = [];

    for (const entry of this._valueStyleTokens.values()) {
        layers.push(entry.layer);
    }

    if (this._groupLayer) layers.push(this._groupLayer);

    layers.push(this._classLayer ?? { authored: this.getClassStyleDefaults(), resolved: {} });

    return layers;
}
```

---

## Ordered Implementation Steps

1. **[packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts)** — change the `_valueStyleTokens` field (line 598) to `Map<string, { token: string; layer: StyleLayer }>` and update its comment to say it holds both the DOM class token and the layer the shared rule publishes. Keep the plain initializer and the field name.

2. **Same file** — update the three existing readers of that map so they compile against the new value shape:
   - `setValueStyleState` (line 5704): read `?.token` for the previous token; write `{ token, layer: { authored: patch, resolved: declarations } }`.
   - `getValueStyleToken` (line 5731): `return this._valueStyleTokens.get(prefix)?.token ?? null;`
   - `clearValueStyleState` (line 5741): read `?.token` for the previous token; `delete` is unchanged.

   Check: `npm run typecheck` in `packages/lib` reports no error mentioning `_valueStyleTokens`.

3. **Same file** — add the private `valueClassGuardSuffix(declarations)` helper next to `setValueStyleState`, exactly as in `## Internal Structure`. It needs no new import: `restingGuardSuffix` is already imported at line 25 and used by `isRestingChromeIsolated` at line 5561.

4. **Same file** — in `setValueStyleState`, append the helper's result to the suffix passed to `ensureSharedStateRule`. The `addClass` / `removeClass` token stays the bare `token`.

5. **Same file** — in `layersBelowInstance` (line 5007), push every `_valueStyleTokens` entry's `layer` before the group layer, as in `## Internal Structure`. Extend that method's doc comment: the value-class tier is a real lower tier for dedup purposes, ranked above group and class because its `.ClassName.<token>` selector outranks both.

6. **Same file** — extend `setValueStyleState`'s doc comment: replace the paragraph starting "Bypasses the instance layer entirely" (line 5693) with a statement that the shared rule is recorded as a layer below the instance layer, so `flushStyleBag` recognises the value as already delivered and writes a removal rather than a per-instance declaration.

7. **[packages/lib/src/typescript/lib/component/table/cell/Cell.ts](packages/lib/src/typescript/lib/component/table/cell/Cell.ts)** — update only the comment above the `cacheStyleValue` call (lines 452–460). It currently claims the value class means cells "share one rule rather than each materialising its own `#id` declaration"; state instead that the cached instance-layer value is deduped against the recorded value-class layer at flush time, which is what keeps `#id` clear. No code change in this file.

8. **[packages/lib/tests/component/table/cell/Cell.test.ts](packages/lib/tests/component/table/cell/Cell.test.ts)** — update the two `_ruleCacheHas` assertions at lines 251–252 to the guarded selectors (`.Cell.bgrgb_1_2_3_:not(.rangeSelected):not(.readOnly):not(.requiredEmpty)` and the `bgrgb_4_5_6_` equivalent), then add the new cases from `## Expected Behaviour`.

9. Run `npm run test` in `packages/lib` and confirm the whole suite is green, paying particular attention to `tests/component/input/Text.test.ts` (the other `setValueStyleState` caller) and `tests/component/table/`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Cell.ts` (comment only) |
| Modify | `packages/lib/tests/component/table/cell/Cell.test.ts` |

---

## Expected Behaviour

All cases below are unit-testable offline through `RecordingDOMSink`: the shared stylesheet is written via recorded `ensureStyleRule` / `setRuleStyles` operations, and `_ruleCacheHas` reports which selectors exist.

1. **A group-coloured cell rendered after `setBaseBackground` writes no per-instance background.** Construct a `Cell`, call `setBaseBackground('rgb(1,2,3)')`, then `getElement(true)`. No recorded `setRuleStyles` whose selector starts with `#<cell id>` carries a non-null `backgroundColor`. *(This is the case that fails today.)*

2. **The shared rule is created once and is guarded.** After case 1, `_ruleCacheHas('.Cell.bgrgb_1_2_3_:not(.rangeSelected):not(.readOnly):not(.requiredEmpty)')` is `true`, and the unguarded `'.Cell.bgrgb_1_2_3_'` is `false`.

3. **Two cells sharing a colour share the rule.** Render two cells that both call `setBaseBackground('rgb(1,2,3)')` before rendering. Exactly one `ensureStyleRule` for that selector is recorded across both.

4. **A post-render rebind changes the painted colour.** Render a cell with `setBaseBackground('rgb(1,2,3)')` set beforehand, then call `setBaseBackground('rgb(4,5,6)')`. The DOM class token swaps from `bgrgb_1_2_3_` to `bgrgb_4_5_6_`, and no `#<cell id>` rule holds a `backgroundColor` declaration for either colour.

5. **`setBaseBackground(null)` returns the cell to the class default.** After case 4, `setBaseBackground(null)` removes the `bgrgb_4_5_6_` token, adds none, and still writes no `#<cell id>` background declaration. `getBackgroundColor()` returns `'var(--ts-ui-table-cell-bg, transparent)'`.

6. **Getter precedence is unchanged.** With a base background set: `getBackgroundColor()` returns the base colour at rest, the read-only token while `setReadOnly(true)`, and the base colour again once read-only clears. The existing precedence tests at [Cell.test.ts:130](packages/lib/tests/component/table/cell/Cell.test.ts#L130) and [Cell.test.ts:145](packages/lib/tests/component/table/cell/Cell.test.ts#L145) must pass unmodified.

7. **A genuine per-instance deviation still reaches `#id`.** A `FilterCell`, whose constructor calls `setBackgroundColor` and which has no value class, still writes its own background declaration onto its instance rule.

8. **`Text`'s line-height value class is untouched.** `new Text().setLineHeight(18)` still produces the unguarded `.Text.lh18px` selector — no `:not(.invisible)` suffix — and every existing `Text` line-height test passes unmodified.

Manual verification (not offline-testable): open the demo table's grouped columns ([packages/lib/src/typescript/MiscPanel.ts:679](packages/lib/src/typescript/MiscPanel.ts#L679)), scroll horizontally so pooled cells recycle across grouped and ungrouped columns, and confirm the tint follows the column rather than the cell. Then range-select and hover a read-only cell inside a grouped column and confirm the range and read-only tints still win over the group tint. Re-run the Style Audit and confirm the ~90-row group is gone.

---

## Verification

- `npm run typecheck` in `packages/lib` — clean.
- `npm run test` in `packages/lib` — the full suite green, including `tests/component/input/Text.test.ts`, `tests/component/table/Body.test.ts`, and `tests/component/table/HeaderColumnWindow.test.ts`.
- `grep -n "ypasses the instance layer entirely" packages/lib/src/typescript/lib/core/Component.ts` — expect zero matches (step 6 replaced that paragraph).
- Manual: the demo app (`npm run dev`, `localhost:8015`) — the grouped-column checks and the Style Audit re-run described in `## Expected Behaviour`.

---

## Potential Challenges

- **`matchesLowerTier` also gains the value layers.** Its two callers are `Text.applySubclassStyles` (`textOverflow`) and `clearShadow` (`shadow`); no value class today declares either key, so neither changes. Re-check this if a future value class declares one of them.
- **`flushStyleBag`'s no-instance-declaration branch also reads `layersBelowInstance`.** It only runs for `FRAMEWORK_BASELINE_KEYS`, which contains neither `backgroundColor` nor `lineHeight`, so a value layer can never become the source of that branch's write today.
- **A component using two value-class prefixes that declare the same CSS key** would see whichever prefix was recorded first win the dedup comparison. No component does this today; keep prefixes property-disjoint.
- **The guarded selector is longer than the unguarded one.** One shared rule per distinct colour absorbs that, against ~90 per-instance rules removed.

---

## Critical Files

- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) — `layersBelowInstance` (5007), `matchesLowerTier` (5031), `cacheStyleValue` (5103), `flushStyleBag` (5348), `restingIsolationKeys` (5572), `isRestingChromeIsolated` (5561), `setValueStyleState` (5704), `clearValueStyleState` (5741), `applyStyle`'s pending seed (5819).
- [packages/lib/src/typescript/lib/component/input/Text.ts:1174](packages/lib/src/typescript/lib/component/input/Text.ts#L1174) — `setLineHeight`, the precedent value-class caller and the source of the "keep the instance tier clear" rule.
- [packages/lib/src/typescript/lib/core/ClassStyleRules.ts:864](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L864) — `restingGuardSuffix`, and `ensureClassStateRule` at line 1045, which builds the shared rule's selector from the suffix.
- [packages/lib/src/typescript/lib/component/table/cell/Cell.ts:78](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L78) — `ownStyleStates`, the three states the guard must exclude.
- [packages/lib/tests/component/table/cell/Cell.test.ts:203](packages/lib/tests/component/table/cell/Cell.test.ts#L203) — the rebind test whose ordering hid the defect.
- [plans/implemented/layered-style-bag.md](plans/implemented/layered-style-bag.md) — the layer model this change extends by one tier.

---

## Non-Goals

- **Removing `Cell`'s constructor `setBackgroundColor` seed** ([Cell.ts:135](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L135)). Its stated justification is stale — `_applyStateTint` no longer has the equality guard it mentions — but the write is harmless once the flush dedups correctly, and removing it changes `getBackgroundColor()`'s resolution path for every cell subclass.
- **`FilterCell` / `ParentHeaderCell` / `GroupSeparatorCell` per-instance backgrounds.** Each writes a genuine instance-layer deviation from its own constructor; hoisting those to class defaults or value classes is separate work with its own smaller duplicate rows.
- **Widening value classes to other properties or components.** This change makes the mechanism correct; it opts nothing new into it.
- **Any change to `styleLayers()`, `resolveStyleValue`, or the typed getters.**

---

## Notes

[^probe]: Confirmed by instrumenting the render of a single `Cell` whose base background was set before `getElement(true)`: the recorded sink writes contain `ensureStyleRule ["#<uuid>:not(.rangeSelected):not(.readOnly):not(.requiredEmpty)"]` followed by `setRuleStyles [..., {"backgroundColor":"rgba(30, 100, 200, 0.06)"}]`, alongside a single `.Cell.bgrgba_30__100__200__0_06_` rule created earlier by `setValueStyleState`. Both rules exist; the id-scoped one wins at `(1,3,0)` against `(0,2,0)`. Multiply by the group's three columns across the body row pool and header and the audit's ~90-instance row falls out.

[^stale]: Also confirmed with the recording sink: after a cell rendered with one base background, calling `setBaseBackground` with a second colour and then with `null` produced no rule write against the cell's own selector at all — only the new shared `.Cell.bg<colour>` rule and the class-token swap. The first colour's per-instance declaration survives untouched and keeps winning. The fix removes the defect at its source: with the dedup working, that declaration is never written, so there is nothing left to go stale.

[^layer-not-branch]: The alternative was a special-case branch inside `flushStyleBag` — a `(key -> served value)` registry consulted before the lower-layer walk. It fixes the same symptom with about the same amount of code, but it adds a second, parallel notion of "a tier that already supplies this value" beside the layer list that already means exactly that. Recording a `StyleLayer` reuses the comparison the flush already performs and leaves `flushStyleBag` unedited.

[^why-not-clear]: `Text.getLineHeight()` reads `this._options.lineHeight`, so `Text` can clear the key off the instance layer and still answer correctly. `Cell.getBackgroundColor()` is `Component`'s, which resolves through the style bag, so clearing the key would make the getter return the class default instead of the group colour — breaking the precedence cases at [Cell.test.ts:130](packages/lib/tests/component/table/cell/Cell.test.ts#L130). Writing an explicit `null` instead is worse: a `null` on the instance layer suppresses every lower layer by design, so the getter would return `null`, and each rebind would schedule a flush — the per-recycle cost `cacheStyleValue` exists to avoid.

[^scope-below-instance]: A fuller version of this change would also insert the value layers into `styleLayers()`, which would let `Cell.setBaseBackground` drop its `cacheStyleValue` call entirely and let the getter resolve through the value tier. That version reaches every typed getter on every component, requires `_resolvedCache` invalidation on each token swap, and changes what `Text`'s font getters resolve for `lineHeight` in numeric mode. `layersBelowInstance()` is read only by `matchesLowerTier` and `flushStyleBag`, so confining the change there fixes the CSS duplication with no getter-visible effect anywhere in the framework.

[^guard-condition]: Guarding unconditionally would be simpler but wrong for `Text`: `restingGuardSuffix(Text)` resolves to `:not(.invisible)` through `Component`'s own declared state, so an unconditional guard would stop an invisible `Text` from resolving its line height — a property `.invisible` has no opinion on. Conditioning on `restingIsolationKeys()` is the same test `flushStyleBag` already uses to decide whether a key belongs on the guarded resting rule or the bare one, so the value tier and the resting tier route identically. For `Cell` the union of its three states' keys is `backgroundColor`, `cursor`, `boxShadow`; for `Text` it is `visibility`.
