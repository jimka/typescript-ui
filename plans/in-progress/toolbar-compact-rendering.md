# ToolBar Compact Rendering — Implementation Plan

## Overview

Today `ToolBar` "compact" mode does two things at once: it tightens the bar's own panel insets (4 → 2) **and** collapses the inter-child gap to 0 by toggling the layout manager's `componentSpacing`. The gap toggle is the wrong axis — compact should mean the *child buttons render tighter*, not that the bar squeezes the space between them. This plan removes the gap axis from compact and adds a real button-level compact concept that drives tighter button insets.

Two files carry the behaviour change. [`ToolBar.ts`](../src/typescript/lib/component/menubar/ToolBar.ts) keeps its panel-inset tightening (4 → 2) but stops touching `componentSpacing`, defaults the layout-manager spacing to 0, and drives `setCompact` per `Button` child the same way `setFlat` already iterates children ([ToolBar.ts:456](../src/typescript/lib/component/menubar/ToolBar.ts#L456), [ToolBar.ts:494](../src/typescript/lib/component/menubar/ToolBar.ts#L494)). [`Button.ts`](../src/typescript/lib/component/button/Button.ts) gains a public `setCompact(value)` / `isCompact()` plus a `ButtonOptions.compact` field, generalizing the private `_applyFlatCompactInsets` ([Button.ts:1407](../src/typescript/lib/component/button/Button.ts#L1407)) so compact insets apply to both text and glyph-only buttons.

The interaction between the existing **flat glyph-only** compact-square path and the **new general** compact concept is the crux of the design — it is resolved explicitly below so the two paths neither double-apply nor fight.

---

## Architecture Decisions

### Gap is removed from compact; layout spacing defaults to 0

`setCompact` stops reading/writing `componentSpacing`. The `HBox`/`VBox` the bar builds in `setOrientation` defaults its spacing to `0` (today it seeds from `TOOLBAR_GAP_DEFAULT = 4`). `setComponentSpacing` stays available on the layout manager, so a consumer can still opt into a gap by reaching the manager — we are not removing the capability, only ceasing to drive it from compact.

`TOOLBAR_COMPACT_GAP` ([ToolBar.ts:90](../src/typescript/lib/component/menubar/ToolBar.ts#L90)) is deleted (it was only the value `0`). `TOOLBAR_GAP_DEFAULT` ([ToolBar.ts:85](../src/typescript/lib/component/menubar/ToolBar.ts#L85)) is retained **only** as the fallback inside `_reflowOverflow` / `_computeOverflowed` ([ToolBar.ts:549](../src/typescript/lib/component/menubar/ToolBar.ts#L549), [ToolBar.ts:592](../src/typescript/lib/component/menubar/ToolBar.ts#L592)) — those read `lm.getComponentSpacing()` and only fall back to the constant when the LM isn't an HBox; with the new default-0 the live read returns 0 anyway, but the constant stays as the typed fallback so the overflow math is unchanged in shape. Its JSDoc is reworded: it no longer "matches the default gap the bar applies" — it is now only the overflow-fallback constant. (Alternative: delete it and pass a literal `0` fallback. Rejected — keeping a named, documented constant for the reserve math reads better and is a smaller diff.)

`setOrientation` ([ToolBar.ts:224](../src/typescript/lib/component/menubar/ToolBar.ts#L224)) reads the old LM's spacing to preserve it across an orientation swap. That stays correct: it copies whatever spacing is live (0 by default, or a consumer-set value), so a consumer who opted into a gap keeps it across a swap, and the default-0 case stays 0. The only change is the initial-build seed: `setOrientation`'s fallback when there's no prior HBox/VBox LM becomes `0` instead of `TOOLBAR_GAP_DEFAULT`.

### Button compact is a general inset concept, distinct from flat-compact-square

`Button` gets a `_compact` flag and a `setCompact` that picks the button's inset perimeter from two axes — *is there a glyph-only label?* and *is compact on?*:

| State | glyph-only (empty text) | has text |
| --- | --- | --- |
| `compact = false` | `(4, 4, 4, 4)` square *(when flat — see below)* / default otherwise | `(5, 10, 5, 10)` default |
| `compact = true` | `(2, 2, 2, 2)` | `(2, 6, 2, 6)` |

Values chosen per the brief's suggestion (text `5/10 → 2/6`, glyph-only `4/4 → 2/2`), expressed as named module constants (`BUTTON_COMPACT_INSETS_TEXT`, `BUTTON_COMPACT_INSETS_GLYPH`, and the existing default `new Insets(5, 10, 5, 10)`), each documented with the "what + why" per CODE_CONVENTIONS. **No theme tokens** — the existing button insets (`new Insets(5, 10, 5, 10)` at [Button.ts:145](../src/typescript/lib/component/button/Button.ts#L145), the flat-compact `new Insets(4, 4, 4, 4)` at [Button.ts:1409](../src/typescript/lib/component/button/Button.ts#L1409)) are raw `Insets` literals in code, not tokens. Matching that precedent (and per "don't over-engineer") keeps insets as documented constants. Flag this token-abstention in the plan, not as a violation — there is no existing inset token to mirror.

### Flat-compact-square vs general compact: one inset resolver, flat-square folded in

The existing `_applyFlatCompactInsets` exists *only* to give flat **glyph-only** buttons a `(4,4,4,4)` square so toolbar icons read tight. That is really "flat collapses a glyph-only button's asymmetric default to a square," and it is orthogonal-but-adjacent to the new compact axis. To avoid two methods fighting over `insets`, replace `_applyFlatCompactInsets` with a single private resolver `_resolveInsets()` that computes the correct perimeter from the three live inputs — `_compact`, `_flat`, and glyph-only-ness — and calls `this.setInsets(...)` once. Both `setCompact` and `_applyFlatChrome` (and the constructor's late re-evaluation at [Button.ts:397](../src/typescript/lib/component/button/Button.ts#L397)) call `_resolveInsets()`. Resolution order inside it:

1. `compact && glyph-only` → `(2, 2, 2, 2)`
2. `compact && has-text` → `(2, 6, 2, 6)`
3. `!compact && flat && glyph-only` → `(4, 4, 4, 4)` *(the existing flat-square behaviour, preserved exactly)*
4. otherwise → the default `(5, 10, 5, 10)`

This means compact subsumes and overrides the flat-square case (a compact flat glyph button is `2/2`, not `4/4`), which is the desired tighter rendering. The non-compact flat glyph-only square is preserved byte-for-byte by case 3. Because `_resolveInsets` is idempotent (it computes an absolute target each time, never deltas), the construction-time double-call (`_applyFlatChrome` during cascade with no `_glyph`/`_text`, then the constructor re-eval once the row exists) cannot double-apply or drift — it just re-derives the same answer.

**Restore-on-un-flatten gap (pre-existing):** `_restoreChrome` ([Button.ts:1272](../src/typescript/lib/component/button/Button.ts#L1272)) does not touch insets, so today `setFlat(false)` leaves a flat glyph button stuck at `(4,4,4,4)`. Routing through `_resolveInsets` *fixes* this incidentally: `setFlat(false)` should call `_resolveInsets()` after `_restoreChrome()` so the insets fall back to case 4. This is a strict improvement and within scope (it's the same machinery), but it is called out so the implementer adds the `_resolveInsets()` call in the `setFlat(false)` branch deliberately, not by accident.

### Default compact state: bare Button `false`, ToolBar child driven by the bar

A bare `new Button(...)` is **not compact** (`_compact` defaults to `false`). Compact is opt-in, exactly like `flat`. The `ToolBar` default config is `compact: true, flat: true` ([ToolBar.ts:102](../src/typescript/lib/component/menubar/ToolBar.ts#L102)), so the bar drives `setCompact(true)` onto each `Button` child — both in `ToolBar.setCompact` (iterating children, mirroring `setFlat` at [ToolBar.ts:456](../src/typescript/lib/component/menubar/ToolBar.ts#L456)) and in `addComponent` for children added later (mirroring [ToolBar.ts:494](../src/typescript/lib/component/menubar/ToolBar.ts#L494)). A button placed in a default toolbar therefore renders compact; the same button standalone does not.

### `_compact` must use `declare`; `compact` threads through `applyOptions` like `flat`

`Button.setCompact` can fire during the `super()` cascade (via `applyOptions` dispatching the `compact` option). Per CODE_CONVENTIONS' class-field-cascade rule and matching `_flat` ([Button.ts:310](../src/typescript/lib/component/button/Button.ts#L310)), the backing field is `private declare _compact?: boolean;` — no initializer. In `applyOptions`, `compact` is dispatched through `this.setCompact(...)` (it must mutate insets, unlike the pure-write `flat`/`anchor` fields). But note: at cascade time `_glyph`/`_text` don't exist, so `_resolveInsets` reading them would throw. `setCompact` therefore caches `_compact` and calls `_resolveInsets()`, and `_resolveInsets` must guard on `this._text` existing (mirroring how `_applyFlatCompactInsets` is only safely callable post-row-build, and why the constructor re-invokes it at [Button.ts:397](../src/typescript/lib/component/button/Button.ts#L397)). The constructor's late re-evaluation block is extended to call `_resolveInsets()` (replacing the `_applyFlatCompactInsets()` call) so the compact insets land once the content row is built.

### ToggleButton inherits cleanly — no `setCompact` override

`ToggleButton.setFlat` overrides because flat changes the *selected-state chrome* (it re-points the `.selected` rule's shadow/background — [ToggleButton.ts:217](../src/typescript/lib/component/button/ToggleButton.ts#L217)). Compact only changes insets, which `ToggleButton` neither overrides nor cares about for its selected styling. So `ToggleButton` inherits `Button.setCompact`/`isCompact` with no override. (The bar's `setCompact`/`addComponent` iteration tests `instanceof Button`, which `ToggleButton` satisfies — same as the flat path.)

---

## Public API (TypeScript Signatures)

```typescript
// Button.ts
interface ButtonOptions extends ComponentOptions {
    // …existing fields…
    /**
     * Compact rendering: tighter symmetric insets so the button reads denser
     * (e.g. inside a ToolBar). Text buttons go (5,10,5,10) → (2,6,2,6);
     * glyph-only buttons go to (2,2,2,2). Defaults to `false`. Runtime
     * counterpart `setCompact`; read with `isCompact`.
     */
    compact?: boolean;
}

class Button<TOptions extends ButtonOptions = ButtonOptions> extends Component<TOptions> {
    setCompact(value: boolean): this;   // caches _compact, re-resolves insets
    isCompact(): boolean;               // returns this._compact ?? false
    // _applyFlatCompactInsets (private) is REPLACED by:
    // private _resolveInsets(): void;  // single inset resolver, see Architecture
}
```

- New backing field: `private declare _compact?: boolean;` ([Button.ts] near the `_flat` declaration at line 310).
- `setInsets` ([Button.ts:1422](../src/typescript/lib/component/button/Button.ts#L1422)) is unchanged — `_resolveInsets` calls through it so the preferred-size re-sync still fires.

```typescript
// ToolBar.ts — no signature changes; behaviour-only.
setCompact(value: boolean): this;   // panel insets 4↔2 + drive child Button.setCompact; NO gap toggle
isCompact(): boolean;               // unchanged
```

---

## Internal Structure

`Button._resolveInsets` (replaces `_applyFlatCompactInsets`):

```typescript
private _resolveInsets(): void {
    // Guard: callable only after the content row is built (the super-cascade
    // and the construction-time flat path invoke flat/compact setters before
    // _text/_glyph exist; the constructor re-invokes this once the row is up).
    if (this._text === undefined) {
        return;
    }

    const glyphOnly = this._glyph !== null && this._text.getText().valueOf() === "";

    let insets: Insets;
    if (this._compact && glyphOnly) {
        insets = BUTTON_COMPACT_INSETS_GLYPH;          // (2,2,2,2)
    } else if (this._compact) {
        insets = BUTTON_COMPACT_INSETS_TEXT;           // (2,6,2,6)
    } else if (this._flat && glyphOnly) {
        insets = BUTTON_FLAT_GLYPH_INSETS;             // (4,4,4,4) — preserved
    } else {
        insets = BUTTON_DEFAULT_INSETS;                // (5,10,5,10)
    }

    this.setInsets(insets);
}
```

(`Insets` is immutable in use here; sharing a module-const instance per case is fine since `setInsets` stores the reference and reads it. Confirm `Insets` isn't mutated downstream — if any code mutates the stored insets, construct fresh each call instead.)

---

## Ordered Implementation Steps

1. **Button constants.** Add documented module consts near [Button.ts:137](../src/typescript/lib/component/button/Button.ts#L137): `BUTTON_DEFAULT_INSETS = new Insets(5,10,5,10)` (reuse for the `_defaultButtonOptions.insets` at line 145 too, or leave that literal and just reference the value — implementer's call, keep the diff minimal), `BUTTON_COMPACT_INSETS_TEXT = new Insets(2,6,2,6)`, `BUTTON_COMPACT_INSETS_GLYPH = new Insets(2,2,2,2)`, `BUTTON_FLAT_GLYPH_INSETS = new Insets(4,4,4,4)`. Each with a "what + why" comment.
2. **Button field + option.** Add `private declare _compact?: boolean;` beside `_flat` ([Button.ts:310](../src/typescript/lib/component/button/Button.ts#L310)). Add `compact?: boolean` to `ButtonOptions` with JSDoc.
3. **Button applyOptions.** In `applyOptions` ([Button.ts:451](../src/typescript/lib/component/button/Button.ts#L451)), add `if (opts.compact !== undefined) this.setCompact(opts.compact);` (dispatched setter, not a pure write — it must resolve insets). → verify: cascade-safe because `_resolveInsets` guards on `_text`.
4. **Replace `_applyFlatCompactInsets` with `_resolveInsets`** ([Button.ts:1407](../src/typescript/lib/component/button/Button.ts#L1407)) per Internal Structure. Update its two existing call sites: `_applyFlatChrome` ([Button.ts:1395](../src/typescript/lib/component/button/Button.ts#L1395)) and the constructor ([Button.ts:398](../src/typescript/lib/component/button/Button.ts#L398)) now call `_resolveInsets()`.
5. **Button setCompact/isCompact.** Add `setCompact(value)` (early-return on unchanged; cache `_compact` and `_options.compact`; call `_resolveInsets()`) and `isCompact()`. Place beside `setFlat`/`isFlat` ([Button.ts:1304](../src/typescript/lib/component/button/Button.ts#L1304)).
6. **setFlat(false) restores insets.** In `setFlat`'s `false` branch ([Button.ts:1342](../src/typescript/lib/component/button/Button.ts#L1342)), add `this._resolveInsets();` after `this._restoreChrome();` so un-flattening a glyph button falls back to default insets. → verify: a flat glyph button flipped to raised regains `(5,10,5,10)`.
7. **ToolBar: drop gap from setCompact.** In `ToolBar.setCompact` ([ToolBar.ts:271](../src/typescript/lib/component/menubar/ToolBar.ts#L271)) remove the `gap` local and the `lm.setComponentSpacing(gap)` block; keep the panel-inset `4↔2` tightening. Add a child-iteration loop driving `setCompact(value)` onto each `instanceof Button` child (mirror the `setFlat` loop at [ToolBar.ts:456](../src/typescript/lib/component/menubar/ToolBar.ts#L456)). Keep the trailing `this.doLayout()`.
8. **ToolBar: drive compact on add.** In `addComponent` ([ToolBar.ts:494](../src/typescript/lib/component/menubar/ToolBar.ts#L494)), alongside the `this._flat && instanceof Button` flatten, add `if (this._compact && component instanceof Button) component.setCompact(true);`.
9. **ToolBar: default spacing 0.** In `setOrientation` ([ToolBar.ts:230](../src/typescript/lib/component/menubar/ToolBar.ts#L230)), change the no-prior-LM fallback from `TOOLBAR_GAP_DEFAULT` to `0`. (The existing-LM branch still copies the live spacing, so a consumer-set gap is preserved across swaps.) → verify: a fresh `new ToolBar()` reports `getLayoutManager().getComponentSpacing() === 0`.
10. **ToolBar: prune gap constant.** Delete `TOOLBAR_COMPACT_GAP` ([ToolBar.ts:90](../src/typescript/lib/component/menubar/ToolBar.ts#L90)). Keep `TOOLBAR_GAP_DEFAULT` but reword its JSDoc to "overflow-math fallback only" (used at [ToolBar.ts:549](../src/typescript/lib/component/menubar/ToolBar.ts#L549), [ToolBar.ts:592](../src/typescript/lib/component/menubar/ToolBar.ts#L592)). → verify: `grep -n TOOLBAR_COMPACT_GAP src/` returns zero matches.
11. **JSDoc fixes.** Update `ToolBar.setCompact`'s JSDoc ([ToolBar.ts:263](../src/typescript/lib/component/menubar/ToolBar.ts#L263)) — drop "child spacing collapses to 0," state it tightens panel insets and drives compact rendering on child buttons. Update the class-level JSDoc line that says compact "tightens them to 2 pixels" if it implies the gap.
12. **Typecheck + smoke + docs** per Verification.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `src/typescript/lib/component/button/Button.ts` |
| Modify | `src/typescript/lib/component/menubar/ToolBar.ts` |
| Modify | `docs/components/Button.md` |
| Modify | `docs/components/ToolBar.md` |

(No `ToggleButton.ts` change — it inherits. No barrel change — `Button`/`ButtonOptions`/`ToolBar` are already exported; `compact`/`setCompact` ride the existing exports.)

---

## Verification

- **Typecheck:** `npm run build` (or the project's `tsc`) — 0 errors.
- **Grep invariants:**
  - `grep -n 'TOOLBAR_COMPACT_GAP' src/` → zero matches.
  - `grep -n '_applyFlatCompactInsets' src/` → zero matches (renamed to `_resolveInsets`).
  - `grep -n 'setComponentSpacing' src/typescript/lib/component/menubar/ToolBar.ts` → only inside `setOrientation` (the preserve-across-swap path), not `setCompact`.
- **Manual smoke — `ToolBarPanel` demo** ([src/typescript/ToolBarPanel.ts](../src/typescript/ToolBarPanel.ts), app at http://localhost:8015, `npm run dev`):
  - Default bar's text-bearing children (the SplitButton "Save", the B/I/U toggles) render with tighter `2/6` insets and read denser than before; glyph-only Cut/Copy/Paste stay tight squares (now `2/2`).
  - Children sit flush (spacing 0) by default — same visual as the old compact-gap-0, confirming the gap removal didn't open a gap.
  - The `raisedBar` (`flat: false`) — its plain text buttons should still be compact (bar default `compact:true`) but raised; confirm insets tightened, chrome raised.
  - Scope DevTools queries to `.ToolBarPanel .ToolBar` (multiple bars on the page).
- **Theme toggle:** flip light/dark — insets are geometry, not color, so no visual regression expected; confirm the flat hover/pressed frames still paint (we didn't touch chrome).
- **Docs build:** `npm run docs:build` → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).

---

## Documentation Impact

`compact`/`setCompact`/`isCompact` on `Button` are new public API; `ToolBar.setCompact` changes behaviour. Both `Button` and `ToolBar` are already barrel-exported from `src/typescript/lib/component/button/index.ts` and `src/typescript/lib/component/menubar/index.ts` — no barrel edit needed (the new method/field ride the existing class/interface exports).

- **`docs/components/Button.md`:** add a "compact" row/setter note. Today [Button.md:111](../docs/components/Button.md#L111) only describes the flat glyph-only square — extend it: compact gives text buttons `2/6` and glyph-only `2/2`, opt-in via `compact` / `setCompact`, default `false`.
- **`docs/components/ToolBar.md`:** fix the `compact` Options row ([ToolBar.md:37](../docs/components/ToolBar.md#L37)) — it currently claims default `false` (wrong — the bar default is `true`) **and** describes the now-removed "child spacing collapses to 0." Reword to: default `true`; tightens the bar's panel insets `(4)→(2)` and renders child `Button`/`ToggleButton` compact (tighter insets). Update the `setCompact` setter bullet ([ToolBar.md:45](../docs/components/ToolBar.md#L45)) the same way (drop the `/ 0` gap claim).
- **JSDoc cross-bucket:** all references are within the same bucket (Button ↔ Button, ToolBar's links to Button already use the `/api/component/button/...` markdown-link form) — no new cross-bucket links introduced.
- No new curated page, sidebar entry, recipe, or `@category` needed (existing classes).

---

## Potential Challenges

- **Cascade-time `_resolveInsets` crash:** `setCompact` fires during `super()` before `_text` exists — the `if (this._text === undefined) return;` guard is mandatory; the constructor's late re-eval ([Button.ts:397](../src/typescript/lib/component/button/Button.ts#L397)) does the real work. Mitigation: the guard plus the existing constructor re-invocation point.
- **Shared `Insets` instance mutation:** module-const `Insets` are reused across buttons; if any downstream code mutates a stored `Insets`, buttons would alias. Mitigation: confirm `Insets` is treated immutably (it is, in the current flat-square path which shares no instance only because it `new`s each call) — if unsure, `new Insets(...)` per call inside `_resolveInsets` (cheap, eliminates aliasing risk).
- **Overflow math reads spacing:** `_computeOverflowed` reserves `gap` between children; with default spacing now 0 the reserve shrinks, which is correct (buttons are flush) — but re-confirm the overflow demo (third bar) still hides/restores the trailing buttons on resize.
- **ToolBar default `compact:true` now visibly tightens text buttons** where before compact only closed the gap — this is the intended behaviour change; the raised-bar demo is the place it's most visible.

---

## Critical Files

- [`src/typescript/lib/component/button/Button.ts`](../src/typescript/lib/component/button/Button.ts) — default insets ([:145](../src/typescript/lib/component/button/Button.ts#L145)), `_flat` declare ([:310](../src/typescript/lib/component/button/Button.ts#L310)), constructor late re-eval ([:397](../src/typescript/lib/component/button/Button.ts#L397)), `applyOptions` flag-threading ([:425](../src/typescript/lib/component/button/Button.ts#L425)), `setFlat`/`_applyFlatChrome`/`_applyFlatCompactInsets`/`setInsets`/`_restoreChrome` ([:1326](../src/typescript/lib/component/button/Button.ts#L1326)–[:1427](../src/typescript/lib/component/button/Button.ts#L1427)).
- [`src/typescript/lib/component/menubar/ToolBar.ts`](../src/typescript/lib/component/menubar/ToolBar.ts) — gap constants ([:85](../src/typescript/lib/component/menubar/ToolBar.ts#L85)), `setOrientation` spacing-preserve ([:224](../src/typescript/lib/component/menubar/ToolBar.ts#L224)), `setCompact` ([:271](../src/typescript/lib/component/menubar/ToolBar.ts#L271)), `setFlat` child-iteration ([:449](../src/typescript/lib/component/menubar/ToolBar.ts#L449)), `addComponent` ([:483](../src/typescript/lib/component/menubar/ToolBar.ts#L483)), overflow math ([:544](../src/typescript/lib/component/menubar/ToolBar.ts#L544)).
- [`src/typescript/lib/component/button/ToggleButton.ts`](../src/typescript/lib/component/button/ToggleButton.ts) — `setFlat` override ([:217](../src/typescript/lib/component/button/ToggleButton.ts#L217)) confirming why no `setCompact` override is needed.
- [`CODE_CONVENTIONS.md`](../CODE_CONVENTIONS.md) — class-field-cascade `declare` rule; magic-number documentation rule.

---

## Non-Goals

- **No theme tokens for button insets.** Existing insets are raw code literals; matching precedent. Adding inset tokens is out of scope and unrequested.
- **No removal of `setComponentSpacing`.** Consumers keep the explicit opt-in gap; only compact stops driving it.
- **No auto-flip of separators / non-Button children for compact.** Compact only touches `Button` children, same scope as `setFlat`.
- **No `clearPreferredSize` / auto-size rework.** `setInsets` already re-syncs preferred size; nothing new needed.
