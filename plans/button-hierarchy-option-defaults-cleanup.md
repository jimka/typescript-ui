# Button Hierarchy Option Defaults Cleanup — Implementation Plan

## Overview

[`plans/implemented/background-token-cleanup.md`](plans/implemented/background-token-cleanup.md) and [`plans/implemented/option-setter-clobbering-audit.md`](plans/implemented/option-setter-clobbering-audit.md) swept the codebase for one bug shape: a constructor (or a helper it calls) makes an imperative `this.setX(...)` call with a hardcoded literal for a documented `ComponentOptions` field, after `super()` already applied the caller's value — silently discarding it. Both fixed it by moving the literal into a `_default<Class>Options` bag consulted as a pure fallback. Neither reached inside `Button`'s own chrome machinery, which is where the last instances live.

Sweeping every class in the Button hierarchy — `Button`, `ToggleButton`, `TabButton`, `TabCloseButton`, `SplitButton`, `MenuButton`, `NotificationHistoryButton`, `MenuBarButton`, `SpinButton`, `PickerButton`, `RailHandle` — finds the bug at **three classes**. The root is one field: `Button`'s resting `backgroundColor`. [`Button.ts:702-704`](packages/lib/src/typescript/lib/component/button/Button.ts#L702-L704) paints it from a private module constant `BUTTON_RESTING_BACKGROUND`, gated on the *raw caller bag* (`options.backgroundColor === undefined`), instead of folding `this._defaultOptions.backgroundColor` the way its siblings `border` / `borderRadius` / `shadow` / `backgroundImage` do. Any subclass that defaults a fill is therefore repainted over. [`TabButton.ts:166`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L166) exists only to undo that repaint. The fix makes `backgroundColor` a real entry in `_defaultButtonOptions`, deletes the imperative repaint, and retargets the three places that recognise the resting background by identity. `TabButton` then loses its reassert, plus four more clobbered hover fields; `MenuBarButton` loses an imperative `setInsets` and a forced `chromeless`.

Every button keeps its current look when nobody customises anything, with one deliberate exception called out in `## Expected Behaviour`: a button built with `flat: true` now paints `transparent` at rest, which today it fails to do because of an unreachable `=== undefined` comparison.

---

## Architecture Decisions

### The fix mechanism, re-verified against current code

`Component`'s constructor doc comment ([`Component.ts:507-523`](packages/lib/src/typescript/lib/core/Component.ts#L507-L523)) still states the contract both precedents relied on: `_defaultOptions` is a pure fallback consulted by getters and `applyStyle` when the caller omitted a field, never dispatched into `_options`. The constructor at [`:524`](packages/lib/src/typescript/lib/core/Component.ts#L524) resolves it via `resolveClassDefaults(this.constructor, subclassDefaults)` at [`:553`](packages/lib/src/typescript/lib/core/Component.ts#L553), implemented at [`ComponentDefaults.ts:78`](packages/lib/src/typescript/lib/core/ComponentDefaults.ts#L78); layering happens at each `super()` call site, so `Button`'s `{ ..._defaultButtonOptions, ...(subclassDefaults ?? {}) }` ([`Button.ts:450`](packages/lib/src/typescript/lib/component/button/Button.ts#L450)) lets a deeper class win. `backgroundColor` is a **getter-read fold**, not a dispatch fold: `getBackgroundColor()` ([`Component.ts:2100-2102`](packages/lib/src/typescript/lib/core/Component.ts#L2100-L2102)) resolves `_defaultOptions` when the key is absent from `_options`, and `applyStyle`'s `applyBoxAndVisibilityStyles` phase reads that getter to write the declaration ([`Component.ts:4671-4673`](packages/lib/src/typescript/lib/core/Component.ts#L4671-L4673)). Seeding the bag is therefore sufficient — nothing needs to dispatch it.

### `Button`'s resting background becomes a class default

`backgroundColor: BUTTON_RESTING_BACKGROUND` moves into `_defaultButtonOptions` ([`Button.ts:220-238`](packages/lib/src/typescript/lib/component/button/Button.ts#L220-L238)), beside the `backgroundImage` entry that carries the same `--ts-ui-button-bg` token, and the imperative repaint at [`Button.ts:700-704`](packages/lib/src/typescript/lib/component/button/Button.ts#L700-L704) is deleted.[^why-bag-not-fold] The constant stays — it is the bag entry's seed value, and the chromeless check below still names it.

### The three identity checks ask two different questions

Three places recognise the resting background by identity, each with its own proxy for "nobody pinned a colour": `applyChromeOptions`'s chromeless branch tests `getBackgroundColor() === null`, `_applyFlatChrome` tests the literal `BUTTON_RESTING_BACKGROUND`, and `_restoreChrome` tests `_defaultOptions.backgroundColor === undefined`. Every one of those proxies works only while `Button` has no `backgroundColor` default, so all three have to be retargeted. They do not all ask the same question, so they do not all get the same comparison:

- **Chromeless** asks *"is anything at all painting over the browser's own default `<button>` background — the UA face?"* — it compares against `BUTTON_RESTING_BACKGROUND`, so a subclass's own fill survives.
- **Flat** asks *"is the painted colour the framework's, or the consumer's?"* — it compares against `this._defaultOptions.backgroundColor`, so a class-level fill is flattened and only a consumer colour survives. `_restoreChrome` is its inverse and restores the same value.[^two-comparisons]

| Instance | `_defaultOptions.backgroundColor` | `getBackgroundColor()` | chromeless branch | `_applyFlatChrome` | `_restoreChrome` on un-flatten |
|---|---|---|---|---|---|
| `new Button('x')` | `var(--ts-ui-button-bg, transparent)` | the button token | writes `transparent` | writes `transparent` | restores the button token |
| `new Button('x', { backgroundColor: 'red' })` | the button token | `red` | leaves `red` | leaves `red` | no change |
| `new MenuBarButton(…)` | `var(--ts-ui-menu-bar-btn-bg, transparent)` | the menu-bar token | leaves the menu-bar token | not reachable (chromeless refuses flat) | no change |
| `new TabButton('x')` | `var(--ts-ui-tab-button-bg, #b8b8c3)` | the tab token | leaves the tab token | writes `transparent` | restores the tab token |

Row 3 is why chromeless keeps the constant: comparing against `_defaultOptions` there would overwrite `MenuBarButton`'s themeable resting token with a literal `transparent`. Row 4 is why flat uses `_defaultOptions`: a class-level fill is not a consumer choice, and flat means no resting fill.[^tabbutton-flat-change]

### `TabButton` loses four reasserts; its hover *border* keeps one

Once `Button` folds the default, [`TabButton.ts:166`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L166)'s `setBackgroundColor` reassert is redundant and is deleted. The same method also unconditionally overwrites `hoverBackgroundColor`, `hoverBackgroundImage`, `hoverShadow`, and `hoverBorder` — all four are documented `ButtonOptions` fields, all four run *after* the tail `applyOptions(options)`, so all four are live instances of the same bug. The first three move into `_defaultTabButtonOptions`; `hoverBorder` cannot, because `getHoverBorder()` returns a private field and never folds `_defaultOptions`, so a bag entry for it would be dead data.[^which-button-fields-fold] It keeps an imperative call made options-aware — the variant [`TabBar.applyUnderBorder`](packages/lib/src/typescript/lib/component/container/TabBar.ts) and `applyTabStyling` itself already use.

### `MenuBarButton`: `insets` and `chromeless` move into the defaults bag

[`MenuBarButton.ts:114`](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts#L114) calls `this.setInsets(...)` after `super()`, discarding a caller's `insets`; `insets` folds through `getInsets()` ([`Component.ts`](packages/lib/src/typescript/lib/core/Component.ts)), so it moves into `_defaultMenuBarButtonOptions`.[^insets-in-bag] [`MenuBarButton.ts:80-103`](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts#L80-L103) forces `chromeless: true` into the *options* spread, which overrides a caller's `chromeless: false`; it moves into the same defaults bag, mirroring [`RailHandle.ts:60`](packages/lib/src/typescript/lib/overlay/RailHandle.ts#L60), which already passes `{ chromeless: true }` as `subclassDefaults`. `isChromeless()` folds `_defaultOptions.chromeless`, and `applyChromeOptions` reads `options.chromeless ?? this.isChromeless()`, so the gate still fires.

### Every other class in the hierarchy, read in full

- **`ToggleButton`** — its constructor writes only `selectedStyleRule` entries, and `applyOptions`'s `if (this.isFlat())` branch writes the same rule. `ToggleButtonOptions` adds only `selected`; there is no `selectedBackgroundColor` option to clobber.
- **`SplitButton`** — every post-`super()` call is on `this._chevron`, a child `Glyph` with no options bag.
- **`MenuButton`**, **`NotificationHistoryButton`**, **`TabCloseButton`** — no imperative `this.setX` at all; all three already seed everything through `subclassDefaults`.
- **`PickerButton`** — `constructor()` takes no arguments, so its `super({ chromeless: true, insets: … })` has no caller value to discard.
- **`RailHandle`** — the two post-`super()` writes go to raw `StyleRule` objects (`.selected`, `:hover:not(.selected)`), which have no options counterpart.
- **`SpinButton`** — its `clearShadow()` / `clearPressedShadow()` calls are already gated on the consumer bag. Its `updateSize()` is a real bug of a different shape — see `## Non-Goals`.
- **`CollapseButton`** — named as a candidate, but it extends `Component`, not `Button` ([`CollapseButton.ts:127`](packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L127)), so it is outside this hierarchy. Its `super({ tag: "span", cursor: "pointer", ...(options ?? {}) })` spreads the caller last, so a caller-supplied `cursor` already wins.

---

## Public API

No exported signature changes, no new symbol. What changes is which already-documented option fields are honoured instead of discarded:

| Class | Fields now honoured |
|---|---|
| `Button` (and every subclass) | `backgroundColor` supplied through a subclass's `_default<Class>Options` bag |
| `TabButton` | `hoverBackgroundColor`, `hoverBackgroundImage`, `hoverShadow`, `hoverBorder` |
| `MenuBarButton` | `insets`, `chromeless` |

---

## Clobbering-Bug Fix Sites

| File | Site | Field(s) clobbered | Fix |
|---|---|---|---|
| `component/button/Button.ts` | `applyChromeOptions`, lines 700-704 | `backgroundColor` (a subclass default) | Add to `_defaultButtonOptions`; delete the write; retarget three identity checks |
| `component/button/TabButton.ts` | `applyTabStyling`, line 166 | `backgroundColor` | Delete — Step 1 makes it redundant |
| `component/button/TabButton.ts` | `applyTabStyling`, lines 169-171 | `hoverBackgroundColor`, `hoverBackgroundImage`, `hoverShadow` | Add to `_defaultTabButtonOptions`; delete the writes |
| `component/button/TabButton.ts` | `applyTabStyling`, lines 172-177 | `hoverBorder` | Fold `options?.hoverBorder ?? { …tokens… }` (no `_defaultOptions` fold exists) |
| `component/menubar/MenuBarButton.ts` | Constructor, line 114 | `insets` | Add to `_defaultMenuBarButtonOptions`; delete the call |
| `component/menubar/MenuBarButton.ts` | Constructor, lines 82-101 | `chromeless` | Move from the forced options spread into `_defaultMenuBarButtonOptions` |

---

## Ordered Implementation Steps

The `implement` skill works test-first: add the `## Expected Behaviour` cases as failing tests before each step's edits, then make them pass.

### Step 1 — `Button.ts` (four edits; they must land together)

[`Button.ts`](packages/lib/src/typescript/lib/component/button/Button.ts). Edits 1.2-1.4 depend on 1.1 having seeded the default; do not typecheck or run tests between them.

**1.1 — seed the default and delete the repaint.**

In `_defaultButtonOptions` (line 220), add the entry immediately above `backgroundImage` so the two channels of the same token sit together:

```typescript
backgroundColor:        BUTTON_RESTING_BACKGROUND,
```

Then delete lines 700-704 — the `const isFlat = …` declaration and the whole `if (!isFlat && options.backgroundColor === undefined) { this.setBackgroundColor(BUTTON_RESTING_BACKGROUND); }` block. `isFlat` has no other reader; the flat branch at line 728 recomputes the same expression for itself. Rewrite the comment above them (lines 692-699) to say the resting colour is now a class default resolved by `getBackgroundColor()` / `applyStyle`, keeping the existing explanation of *why* the token is applied as both a colour and an image.

Update `BUTTON_RESTING_BACKGROUND`'s own doc comment (lines 202-210) — it currently says the constant is "shared between `applyChromeOptions` and `_applyFlatChrome`". It is now the seed value of `_defaultButtonOptions.backgroundColor`, and is compared by identity in the chromeless branch only.

**1.2 — chromeless branch.** Replace lines 684-686:

```typescript
const resting = this.getBackgroundColor();

if (resting === null || resting === BUTTON_RESTING_BACKGROUND) {
    this._options.backgroundColor = "transparent";
}
```

The old `this.getBackgroundColor() === null` test meant "nobody pinned a colour". Once Button seeds the field it can never be `null` for a plain Button, so the framework token joins `null` as the second "nobody pinned one" answer. A subclass fill (`MenuBarButton`, `TabButton`) matches neither and survives, exactly as today. Extend the existing comment block with one sentence saying so.

**1.3 — `_applyFlatChrome`.** Replace lines 1775-1779:

```typescript
const restingBackground = this.getBackgroundColor();
const classDefault      = this._defaultOptions.backgroundColor ?? null;

if (restingBackground === null || restingBackground === classDefault) {
    this.setBackgroundColor("transparent");
}
```

Update the comment above it (lines 1766-1774): the chromeful path no longer writes the token into `_options`, so the value read here now comes from `_defaultOptions` at construction and from `_options` only after a consumer set one (or after a previous flat pass wrote `"transparent"`, which matches neither arm and is left alone — the method stays idempotent). Note that the comparison is against the *class* default, so a subclass that defaults its own fill is flattened too, while a consumer colour is preserved.

**1.4 — `_restoreChrome`.** Replace lines 1617-1619:

```typescript
if (this._options.backgroundColor === "transparent" && d.backgroundColor !== undefined) {
    this.setBackgroundColor(d.backgroundColor);
}
```

This is 1.3's inverse: flat (or chromeless) wrote the `"transparent"` sentinel only when the painted colour was the class default, so restoring that default is exactly right. The `d.backgroundColor !== undefined` arm covers a subclass that suppresses Button's default with an explicit `backgroundColor: undefined` key — nothing to restore, so the sentinel stays. Update the comment above it accordingly.

**Verification checkpoint:** `grep -n "BUTTON_RESTING_BACKGROUND" packages/lib/src/typescript/lib/component/button/Button.ts` — exactly four matches: the constant's doc comment, its `const` declaration, the `_defaultButtonOptions` entry, and the chromeless comparison from 1.2. No match inside `_applyFlatChrome` or `_restoreChrome` — both now compare against `_defaultOptions.backgroundColor`. Then `npm run typecheck` and `npm test` in `packages/lib`.

### Step 2 — `TabButton.ts`

[`TabButton.ts`](packages/lib/src/typescript/lib/component/button/TabButton.ts):

1. In `_defaultTabButtonOptions` (line 27), add the three foldable hover fields below the existing `borderRadius` / `shadow` entries:
   ```typescript
   hoverBackgroundColor: "var(--ts-ui-tab-button-hover-bg, #c4c4cf)",
   hoverBackgroundImage: "var(--ts-ui-tab-button-hover-bg, #c4c4cf)",
   hoverShadow:          "none",
   ```
2. In `applyTabStyling` (line 165), delete line 166 (`this.setBackgroundColor(...)`) and lines 169-171 (`setHoverBackgroundColor`, `setHoverBackgroundImage`, `setHoverShadow`), together with the now-orphaned `// Hover state.` comment.
3. Make the surviving hover-border call options-aware. Change its opening line (172) so the existing four-side object literal becomes the fallback operand; the closing `});` on line 177 is unchanged:
   ```typescript
   this.setHoverBorder(options?.hoverBorder ?? {
       borderTop:    "var(--ts-ui-tab-button-hover-border-top,    var(--ts-ui-tab-button-hover-border, none))",
       // …the other three sides, verbatim…
   });
   ```
4. Leave every `setSelectedX` call (lines 179-188) exactly as it is — `ToggleButtonOptions` declares no matching fields, so there is nothing for them to clobber.
5. Rewrite `applyTabStyling`'s JSDoc (lines 143-164). The paragraph explaining why `backgroundColor` needs an explicit options-aware reassert is now false and must go; replace it with one sentence saying the resting fill, border, radius, shadow, and the three hover colour/shadow fields all resolve from `_defaultTabButtonOptions`, and that only `hoverBorder` is reasserted here because `getHoverBorder()` has no `_defaultOptions` fold. Keep the `@param options` line — it is still read, by the hover-border fold.

**Verification checkpoint:** `grep -n "this.setBackgroundColor\|this.setHoverBackgroundColor\|this.setHoverBackgroundImage\|this.setHoverShadow" packages/lib/src/typescript/lib/component/button/TabButton.ts` — zero matches (the `closeButton.set*` calls in `buildCloseButton` are on a child component and stay). `grep -n "setHoverBorder" …/TabButton.ts` — one match, passing `options?.hoverBorder ?? {`.

### Step 3 — `MenuBarButton.ts`

[`MenuBarButton.ts`](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts):

1. In `_defaultMenuBarButtonOptions` (line 23), add:
   ```typescript
   chromeless:      true,
   insets:          new Insets(0, HORIZONTAL_PAD, 0, HORIZONTAL_PAD),
   ```
   `HORIZONTAL_PAD` is declared at line 33, below the bag — move the `const` above the bag so it is initialised first.
2. Delete `chromeless: true,` and its comment (lines 84-87) from the forced options spread in the `super(...)` call. The `styleRules` entry stays exactly as it is — it already merges the caller's array.
3. Delete line 114 (`this.setInsets(new Insets(0, HORIZONTAL_PAD, 0, HORIZONTAL_PAD));`) and move its explanatory comment (lines 109-113) above the bag's new `insets` entry, dropping the sentence about `setInsets` auto-firing `recomputePreferredSize` — that no longer happens on this path, and Button's own constructor-tail `recomputePreferredSize()` covers it.
4. Leave `setActive`'s `setBackgroundColor` calls untouched — a runtime state toggle, not a construction default.

**Verification checkpoint:** `grep -n "this.setInsets\|chromeless" packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts` — `setInsets` zero matches; `chromeless` only in the defaults bag and the class doc comment.

### Step 4 — Registry rows and tests

[`tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts) is the mechanical guard ARCHITECTURE.md requires for every class-defaulted field.

1. Add registry rows beside the existing `TabButton` rows (around line 263) for: `Button backgroundColor`, `TabButton hoverBackgroundColor` / `hoverBackgroundImage` / `hoverShadow`, `MenuBarButton chromeless` (via `isChromeless()`), `MenuBarButton insets`.
2. Fix the stale comment at lines 265-268 and the whole comment block inside `it('ToggleButton forwards subclassDefaults through to Button')` (lines 413-426) — both describe the bypass this plan removes. The test body itself should now also assert `backgroundColor`, not only `backgroundImage`: `expect(new ToggleButton('x', undefined, { backgroundColor: 'blue' }).getBackgroundColor()).toBe('blue')`.
3. Add `Button` to the purity test at line 386 (`default-resolved fields do not pollute the explicit bag`): `expect((new Button('x') as any)._options.backgroundColor).toBeUndefined()`.
4. Add every `## Expected Behaviour` case from 1 to 7 not already covered by a registry row from 4.1, as tests in `tests/component/button/Button.test.ts`, `tests/component/button/TabButton.test.ts`, and `tests/component/menubar/MenuBarButton.test.ts`. Cases 5 and 6 (flat) belong in `Button.test.ts` beside the existing `round-trips setFlat` test.

**Verification checkpoint:** `npm test` in `packages/lib` — full suite green.

### Step 5 — Documentation

1. [`docs/components/MenuBarButton.md`](packages/lib/docs/components/MenuBarButton.md) line 5 — change "Extends `Button` with `chromeless: true`" to say it *defaults* to `chromeless: true` (a caller can now pass `chromeless: false`), and note the 10px insets are now a default a caller can override.
2. [`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) — extend the existing `### Component defaults` block under `## Fixed`, or add a sibling block if that heading has moved; text in `## Documentation Impact`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/TabButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/tests/component/button/Button.test.ts` |
| Modify | `packages/lib/tests/component/button/TabButton.test.ts` |
| Modify | `packages/lib/tests/component/menubar/MenuBarButton.test.ts` |
| Modify | `packages/lib/docs/components/MenuBarButton.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

No files are created or deleted.

---

## Expected Behaviour

All cases are unit-testable **(U)** through the offline harness already used by `tests/component/button/*.test.ts` (`installTestDOM` + getters + a cast to `any` for `_options`), except case 8.

1. **Defaults unchanged (U).** `new Button('x').getBackgroundColor()` is `'var(--ts-ui-button-bg, transparent)'`; `new TabButton('x').getBackgroundColor()` is `'var(--ts-ui-tab-button-bg, #b8b8c3)'`; `new TabButton('x').getHoverBackgroundColor()` is `'var(--ts-ui-tab-button-hover-bg, #c4c4cf)'`; `new MenuBarButton('File', noop, noop).isChromeless()` is `true` and `getInsets()` is `(0, 10, 0, 10)`.
2. **The default no longer pollutes the bag (U).** `(new Button('x') as any)._options.backgroundColor` is `undefined` — today it holds the token.
3. **A subclass default now reaches `Button` unaided (U).** `new ToggleButton('x', undefined, { backgroundColor: 'blue' }).getBackgroundColor()` is `'blue'`. This is the case the existing test comment records as not working.
4. **Caller overrides win (U).** `new Button('x', { backgroundColor: 'red' }).getBackgroundColor()` is `'red'`; `new TabButton('x', { hoverBackgroundColor: 'red' }).getHoverBackgroundColor()` is `'red'`; `new TabButton('x', { hoverBorder: '1px solid red' }).getHoverBorder()` is `{ border: '1px solid red' }`; `new MenuBarButton('File', noop, noop, { insets: new Insets(1, 2, 3, 4) }).getInsets()` is `(1, 2, 3, 4)`; `new MenuBarButton('File', noop, noop, { chromeless: false }).isChromeless()` is `false`.
5. **Flat at construction paints transparent (U — behaviour change).** `(new Button('x', { flat: true }) as any)._options.backgroundColor` is `'transparent'`. Today it is `undefined`, because the check compares `getBackgroundColor()` against `undefined` while the getter returns `null`.[^flat-dead-branch]
6. **Flat round-trips (U).** `const b = new Button('x'); b.setFlat(true);` → `getBackgroundColor()` is `'transparent'`; `b.setFlat(false)` → `getBackgroundColor()` is back to `'var(--ts-ui-button-bg, transparent)'`. With `new Button('x', { backgroundColor: 'red' })` the colour stays `'red'` across both flips.
7. **Chromeless still neutralises the UA face, and still yields to a subclass fill (U).** `new Button('x', { chromeless: true }).getBackgroundColor()` is `'transparent'`; `new MenuBarButton('File', noop, noop).getBackgroundColor()` is `'var(--ts-ui-menu-bar-btn-bg, transparent)'` — the menu-bar token, *not* `'transparent'`.
8. **No visual change anywhere else (manual).** Under Modern, Dark, and Classic: a plain `Button`, a `ToolBar` of flat buttons, a `MenuBar`, a `TabBar` with hovered and selected tabs, a `SplitButton`, a `MenuButton`, a `NumberSpinner`'s `SpinButton`s, a `Rail`, and a picker field's trigger button all look exactly as before — except a flat button's resting fill, which loses the UA `<button>` face if it was showing one (case 5).

---

## Verification

- `npm run typecheck` in `packages/lib` — no signature changes, so this is a pure regression check.
- `npm test` in `packages/lib` — full suite green, including the pre-existing `MenuBarButton chromeless contract` test (`setFlat(true)` must still be refused, which now resolves `chromeless` through `_defaultOptions`) and the `TabButton` / `ToggleButton` registry rows.
- Grep invariants: the three per-step checkpoints above, re-run together as a final pass.
- Manual smoke (`npm run dev`, app on `localhost:8015`): `## Expected Behaviour` case 8. The docs shell's own header buttons ([`packages/docs/src/shell/DocsShell.ts:89,92`](packages/docs/src/shell/DocsShell.ts#L89)) are `flat: true, compact: true` glyph buttons — the clearest place to see case 5.
- `npm run docs:api` in `packages/lib` — unchanged from the existing baseline (0 errors, 1 warning); no JSDoc `@param` is added or removed by this plan, only comment bodies change.

---

## Documentation Impact

- No export, barrel, or catalog entry changes — every field touched is already documented on `ComponentOptions` or `ButtonOptions`.
- [`docs/components/MenuBarButton.md`](packages/lib/docs/components/MenuBarButton.md) is the one page making a claim this plan changes (see Step 5.1). [`docs/components/Button.md`](packages/lib/docs/components/Button.md)'s `chromeless` and `flat` sections stay accurate — `flat` already documents "no resting border, shadow, or gradient", which case 5 makes true rather than aspirational.
- Changelog entry for [`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md), under the existing `## Fixed` heading:

  ```markdown
  ### Button defaults

  `Button` painted its resting background with a hardcoded token instead of a
  class default, so a subclass that defaulted its own fill was repainted over.
  The token is now an entry in Button's defaults bag. As a result `TabButton`
  honours a caller-supplied `hoverBackgroundColor`, `hoverBackgroundImage`,
  `hoverShadow`, and `hoverBorder`, and `MenuBarButton` honours `insets` and
  `chromeless`, where all six were previously discarded. Every button's default
  appearance is unchanged, with one exception: a button built with
  `flat: true` now correctly renders a transparent resting background instead
  of falling through to the browser's default `<button>` face.
  ```

---

## Potential Challenges

- **The four `Button.ts` edits are one change, not four.** Seeding the default without retargeting the chromeless check leaves every chromeless button painting the UA face; retargeting `_applyFlatChrome` without `_restoreChrome` leaves an un-flattened button stuck transparent. Step 1 says to land all four before typechecking, for this reason.
- **`_defaultOptions` is frozen and shared per class.** The new `insets` entry in `_defaultMenuBarButtonOptions` is a shared `Insets` instance; that is already the established shape (`_defaultButtonOptions.insets`, `_defaultTabCloseButtonOptions.insets`, `_defaultSpinButtonOptions.insets`) and `Insets` is treated as a value throughout.
- **`_resolveInsets` can still overwrite `MenuBarButton`'s insets** if a consumer calls `setCompact` / `setFlat` on one. That is pre-existing (it overwrites the imperative `setInsets` result today just the same) and is deferred — see `## Non-Goals`. `MenuBarButton` is chromeless, so `setFlat` is refused; only `setCompact` reaches it.
- **Case 5 is a rendering change no unit test sees directly.** The test asserts `_options.backgroundColor`, not pixels. Confirm it visually against the docs-shell header buttons before considering the plan done.

---

## Critical Files

- [`plans/implemented/option-setter-clobbering-audit.md`](plans/implemented/option-setter-clobbering-audit.md) and [`plans/implemented/background-token-cleanup.md`](plans/implemented/background-token-cleanup.md) — the two precedents this plan finishes. The latter's `## Architecture Decisions` records why `TabButton` needed the options-aware fold Step 2.3 keeps for `hoverBorder`.
- [`packages/lib/src/typescript/lib/core/Component.ts:507-523`](packages/lib/src/typescript/lib/core/Component.ts#L507-L523) (constructor contract), [`:593`](packages/lib/src/typescript/lib/core/Component.ts#L593) (`applyOptions`), [`:679-689`](packages/lib/src/typescript/lib/core/Component.ts#L679-L689) (`applyChromeOptions`), [`:2100-2102`](packages/lib/src/typescript/lib/core/Component.ts#L2100-L2102) (`getBackgroundColor`), [`:4671-4673`](packages/lib/src/typescript/lib/core/Component.ts#L4671-L4673) (the `applyStyle` read) — the mechanism every edit relies on.
- [`packages/lib/src/typescript/lib/core/ComponentDefaults.ts:78`](packages/lib/src/typescript/lib/core/ComponentDefaults.ts#L78) (`resolveClassDefaults`) — the layering guarantee that lets `TabButton`'s fill beat `Button`'s.
- [`packages/lib/src/typescript/lib/component/button/Button.ts:663-732`](packages/lib/src/typescript/lib/component/button/Button.ts#L663-L732) (`applyChromeOptions`), [`:1609-1641`](packages/lib/src/typescript/lib/component/button/Button.ts#L1609-L1641) (`_restoreChrome`), [`:1745-1800`](packages/lib/src/typescript/lib/component/button/Button.ts#L1745-L1800) (`_applyFlatChrome`) — read all three in full before editing; they are one state machine.
- [`packages/lib/src/typescript/lib/overlay/RailHandle.ts:60`](packages/lib/src/typescript/lib/overlay/RailHandle.ts#L60) — the in-hierarchy precedent for `chromeless` as a subclass default, which Step 3 mirrors.
- [`packages/lib/tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts) — the registry ARCHITECTURE.md requires a row in for every class-defaulted field, and the file carrying two comments that describe the bug this plan removes.
- [`ARCHITECTURE.md`](ARCHITECTURE.md), *Class-level defaults must survive the getter* — the fold-vs-always-dispatch rule that decides which fields can move into a bag.

---

## Non-Goals

- **Not fixing `SpinButton.updateSize()`** ([`SpinButton.ts:133-156`](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L133-L156)). It hardcodes `preferredSize` / `minSize` / `maxSize` at construction and re-runs on every theme change, so the literal cannot be pre-baked into a bag. This is a seventh member of the `updateHeight()` / `updateSize()` family `option-setter-clobbering-audit` already deferred (`TextField`, `PasswordField`, `UsernameField`, `ComboBox`, `NumberSpinner`, `AbstractPickerField`); it belongs to that follow-up, not this one.
- **Not fixing `Button._resolveInsets()`** ([`Button.ts:1817-1837`](packages/lib/src/typescript/lib/component/button/Button.ts#L1817-L1837)). Its `else` branch writes `BUTTON_DEFAULT_INSETS` unconditionally, so `new Button('x', { flat: true, insets: … })` loses the caller's insets, and so does any later `setCompact` / `setFlat` flip. A bag entry cannot fix it: `setInsets` writes `_options.insets`, so the method's own previous call poisons the value it would need to read back. It needs the same options-preserving rewrite as the sizing family above.
- **Not extending `applyChromeOptions` to dispatch defaulted `hoverBorder` / `pressedBorder` / `hoverBorderRadius` / `pressedBorderRadius`.** `_restoreChrome` already reads all four from `_defaultOptions` ([`Button.ts:1630-1640`](packages/lib/src/typescript/lib/component/button/Button.ts#L1630-L1640)) while `applyChromeOptions` only ever dispatches a caller value, so a class default for any of them appears only after a flat or chromeless round-trip. Closing that gap is a change to Button's shared chrome dispatch for four fields, three of which nothing in the tree defaults; this plan needs only `hoverBorder`, and gets it with the established options-aware fold instead.
- **Not adding the missing `subclassDefaults` parameter** to `SplitButton`, `RailHandle`, `NotificationHistoryButton`, or `PickerButton`. ARCHITECTURE.md's *Constructors forward `subclassDefaults`* rule does ask for it, but none of this plan's fixes needs one, and adding four dead parameters is a mechanical sweep of its own.
- **Not touching `TabButton`'s `setSelectedX` calls, `ToggleButton`'s `selectedStyleRule` writes, or `MenuBarButton.setActive`.** The first two have no matching option field to clobber (exposing one is new public API); the third is a runtime state toggle, which this plan's construction-time scope excludes by design.
- **Not changing `_applyFlatChrome`'s unconditional `clearBorder` / `clearBorderRadius` / `clearShadow` / `clearBackgroundImage`.** Those discard a *consumer's* chrome as well as the framework's — asymmetric with the `backgroundColor` handling this plan tidies, but a documented tradeoff (`setFlat`'s own `@remarks`) that is out of scope.
- **No component's default appearance changes** except case 5 (a flat button's resting fill) and the flat-`TabButton` case in the identity-check table, neither of which any shipped code path exercises differently.

---

## Notes

[^why-bag-not-fold]: The alternative was to keep the imperative call and make it fold — `this.setBackgroundColor(this._defaultOptions.backgroundColor ?? BUTTON_RESTING_BACKGROUND)` — which would also unblock `TabButton`. It was rejected on three counts. It keeps a construction-time imperative setter, which is the thing this plan exists to remove. It keeps writing a default value into `_options`, breaking the "a default is never dispatched into `_options`" contract the constructor doc comment states and the registry test's purity case asserts for other classes. And it leaves `backgroundColor` the odd one out in `_defaultButtonOptions`, where its own sibling `backgroundImage` — the other channel of the identical `--ts-ui-button-bg` token — is already a plain bag entry. The bag route also costs one line rather than one line plus a permanent explanation of why this field is special.

[^two-comparisons]: Using `this._defaultOptions.backgroundColor` in the chromeless branch as well was tried on paper and regresses `MenuBarButton`. Its resting fill is `var(--ts-ui-menu-bar-btn-bg, transparent)`, which *is* its class default, so the branch would overwrite `_options.backgroundColor` with the literal `"transparent"` and a consumer who themed `--ts-ui-menu-bar-btn-bg` to a real colour would see it only after `setActive(true)` then `setActive(false)` wrote the token back. The shipped themes all set that token to `transparent`, so the regression is invisible in-tree — which is exactly why it is worth pinning here rather than discovering later. Conversely, using `BUTTON_RESTING_BACKGROUND` in `_applyFlatChrome` would leave a flat subclass keeping its class fill, contradicting `flat`'s documented "no resting border, shadow, or gradient" contract and `_restoreChrome`'s documented "only defaults round-trip" contract.

[^tabbutton-flat-change]: A flat `TabButton` therefore goes transparent at rest where today it keeps the tab token. No shipped path reaches it: `grep -rn "setFlat(\|flat: true"` over `packages/lib/src` and `packages/docs/src` finds five flattening call sites — `TabBar.buildDescriptorTool` (a plain `Button` tool, not a tab), `Tab.addTool`, `AccordionHeader`, `ToolBar.setFlat` / `ToolBar`'s overflow trigger, and the docs shell's header buttons — none of which constructs or receives a `TabButton`. Reaching the changed path requires a consumer passing a `TabButton` as a `ToolBar` child or a `Tab` tool, which nothing does.

[^which-button-fields-fold]: Reading every `Button` chrome getter splits the twelve `pressedX` / `hoverX` fields in two. `getPressedForegroundColor`, `getPressedBackgroundColor`, `getPressedBackgroundImage`, `getPressedShadow`, `getHoverBackgroundColor`, `getHoverBackgroundImage`, and `getHoverShadow` all read `this._options.X ?? this._defaultOptions.X ?? null`, and `applyChromeOptions` always-dispatches each as `options.X ?? this.getX()!` — a bag entry works. `getHoverForegroundColor`, `getHoverBorderRadius`, and `getPressedBorderRadius` read `this._options.X ?? null`, and `getHoverBorder` / `getPressedBorder` return the private `_hoverBorder` / `_pressedBorder` fields; `applyChromeOptions` dispatches all five only when the caller supplied them. A bag entry for any of those five would be dead data — the same right-column finding `option-setter-clobbering-audit` recorded for `transition` and `opacity` at the `Component` level. `applyChromeOptions`'s own comment states the split ("The pressed/hover border fields are not defaulted, so they stay caller-gated").

[^insets-in-bag]: `getInsets()` returns `(this._options.insets ?? this._defaultOptions.insets)`, and `insets` is not one of the thirteen declarations `ClassStyleRules.ts` hoists into a shared `.ClassName` rule, so nothing about the class-rule tier changes. Losing the `setInsets` dispatch loses its `recomputePreferredSize()` side effect, but `Button`'s constructor calls `recomputePreferredSize()` itself once the content row is built ([`Button.ts:513`](packages/lib/src/typescript/lib/component/button/Button.ts#L513)), and that call now reads the bag value — where today it runs first and the imperative `setInsets` triggers a second recompute afterwards. `MenuBarButton`'s `computePreferredSize` override pins the height regardless, so only the content-derived width depends on the insets, and it resolves from the same getter either way.

[^flat-dead-branch]: `_applyFlatChrome`'s current guard is `restingBackground === undefined || restingBackground === BUTTON_RESTING_BACKGROUND`, but `getBackgroundColor()` is typed `string | null` and both of its arms end in `?? null` — it cannot return `undefined`. For `new Button('x', { flat: true })` the chromeful resting write is skipped (the `!isFlat` gate), `_options` is empty, and `_defaultOptions.backgroundColor` is unset, so the getter returns `null` and neither arm matches: no `transparent` is written, and the UA `<button>` background-color is left to paint. The runtime path (`setFlat(true)` on an already-rendered chromeful button) does work, because the imperative repaint had put the token in `_options` — which is why the defect survived. Seeding the default makes the construction-time read return the token, so the second arm matches and the write lands; the new `restingBackground === null` arm keeps a subclass that suppresses the default with an explicit `backgroundColor: undefined` key working too.
