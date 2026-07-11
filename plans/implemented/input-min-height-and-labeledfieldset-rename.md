# Single-line input min-height & `FormFieldSet` → `LabeledFieldSet` — Implementation Plan

## Overview

Two related fixes in the field/input layout area, done together because they both touch the field-container surface (`FieldSet`, the renamed container, the gallery, the barrel, the tests).

**Part 1 — single-line inputs must not be vertically squishable.** Every single-line input's `updateHeight()` pins *preferred* and *max* height to the one-line box height `h` but never sets a *minimum*, so the leaf reports a min-height of ~0. A container that aggregates pure child minimums — `VBox.getMinSize` ([layout/VBox.ts:167](src/typescript/lib/layout/VBox.ts#L167) sums `component.getMinSize().height`) — therefore collapses to just spacing + perimeter and clips its fields. The fix pins the **min height** (Y-axis only) to `h` in each single-line input so `min-Y == preferred-Y`; the field can't be compressed below one line, but stays horizontally flexible.

**Part 2 — rename `FormFieldSet` → `LabeledFieldSet`.** A new sibling `Form` component (renders the `<form>` element) is arriving separately, which makes "FormFieldSet" ambiguous. `LabeledFieldSet` names what it adds over a bare [`FieldSet`](src/typescript/lib/component/container/FieldSet.ts): labels + a baseline grid. This is a breaking public-API rename of the file, class, callable pair, options interface, and the two descriptor types, plus every call site and doc.

Primary files: [component/input/TextField.ts:57](src/typescript/lib/component/input/TextField.ts#L57), [PasswordField.ts](src/typescript/lib/component/input/PasswordField.ts), [UsernameField.ts](src/typescript/lib/component/input/UsernameField.ts), [ComboBox.ts:733](src/typescript/lib/component/input/ComboBox.ts#L733), [AbstractPickerField.ts:239](src/typescript/lib/component/input/AbstractPickerField.ts#L239), [NumberSpinner.ts:192](src/typescript/lib/component/input/NumberSpinner.ts#L192), [AutoCompleteField.ts:194](src/typescript/lib/component/input/AutoCompleteField.ts#L194), and [component/container/FormFieldSet.ts](src/typescript/lib/component/container/FormFieldSet.ts).

---

## Architecture Decisions

### Fix at the leaf, not the container — the leaf is the one reporting a wrong minimum

Per [ARCHITECTURE.md](ARCHITECTURE.md) *Size constraints*: a component must report accurate min/preferred/max, and an inaccurate report is "a bug — fixed at the source, never papered over downstream." The single-line inputs are the source: they know their height is exactly `h` yet report min-height 0. Fixing the container (e.g. flooring in `VBox`) would violate rule 3. So the min-height is pinned in each leaf's `updateHeight()`, exactly where `preferred` and `max` are already pinned to `h`.

### Y-axis only — pin min height, leave min width flexible

The row height of a form must not shrink below one line, but fields must still stretch and shrink horizontally to fill their column (a `weight`-sized grid track, an `HBox` fill). There is **no `setMinHeight` API** — only `setMinSize(width, height)` ([Component.ts:2440](src/typescript/lib/core/Component.ts#L2440), writes both `minWidth`/`minHeight` CSS). So the call is `this.setMinSize(0, h)`: **min-width `0`** preserves full horizontal flex (identical to today's behaviour — these inputs currently carry no min-width constraint, so `getMinSizeConstraint()` returns `null` ≈ 0), while **min-height `h`** pins the vertical floor. `min-width: 0` is the CSS no-op for an absolutely-positioned framework component, so no horizontal regression.

### Per-subclass pin, not centralized in `TextInput`

`TextField` / `PasswordField` / `UsernameField` each carry a byte-identical `updateHeight()`; `ComboBox` / `AbstractPickerField` / `NumberSpinner` carry their own variants. The pin is added as one line to each existing `updateHeight()` body — **not** hoisted into their shared base `TextInput`. Reason: `TextInput` is also the base of `TextArea` (multi-line, deliberately Y-resizable, **no** single-line height model) and `PickerInput` (the inner input of the picker composite, whose height is driven by its wrapper). A `TextInput`-level pin auto-invoked at construction would wrongly bind those two. The existing design already duplicates the preferred/max pin per subclass; matching it with a per-subclass min keeps the pattern and holds the blast radius to the classes that genuinely have a single-line box.

### Include / exclude list

**Include** (each has a single-line `updateHeight()`/size-sync using `Util.singleLineBoxHeight`, and is a standalone field a consumer places in a form):

| Component | Method / lines | Call to add |
|---|---|---|
| `TextField` | `updateHeight` [L57–62](src/typescript/lib/component/input/TextField.ts#L57) | `this.setMinSize(0, h)` |
| `PasswordField` | `updateHeight` (L70–74) | `this.setMinSize(0, h)` |
| `UsernameField` | `updateHeight` (L69–73) | `this.setMinSize(0, h)` |
| `ComboBox` | `updateHeight` [L733–738](src/typescript/lib/component/input/ComboBox.ts#L733) | `this.setMinSize(0, h)` |
| `AbstractPickerField` | `updateHeight` [L239–243](src/typescript/lib/component/input/AbstractPickerField.ts#L239) — backs `DateField`/`TimeField`/`DateTimeField` (all `extends AbstractPickerField`) | `this.setMinSize(0, h)` |
| `NumberSpinner` | `updateHeight` [L192–198](src/typescript/lib/component/input/NumberSpinner.ts#L192) | `this.setMinSize(0, h)` |
| `AutoCompleteField` | `syncSizeFromTextField` [L194–205](src/typescript/lib/component/input/AutoCompleteField.ts#L194) — mirrors inner `TextField`'s preferred+max but **omits min** | mirror min: `const min = this._textField.getMinSize(); if (min) { this.setMinSize(min.width, min.height); }` |

`AutoCompleteField` is a discovered addition beyond the brief's enumerated list (the brief said "at least"): it is a standalone single-line input that syncs size from an inner `TextField` and has the same squish. Because it mirrors, once `TextField` pins its min the natural fix is to mirror min too (min-width comes through as `0`, height as `h`).

**Exclude**, with reason:
- **`TextArea`** — multi-line; has **no** `updateHeight` and never pins max height to one line ([TextArea.ts](src/typescript/lib/component/input/TextArea.ts) only pins `resize:none`), so it stays legitimately Y-resizable. Pinning a one-line min would break it. This is the key exclusion.
- **`PickerInput`** — inner input of the picker composite; not standalone, no `updateHeight`; its height is governed by `AbstractPickerField` (which *is* pinned).
- **`SpinButton`** — internal up/down button of `NumberSpinner`; fixed-size chrome (`setMaxSize(18, halfHeight)`), not a form field.
- **`Slider` / `Checkbox` / `RadioButton` / `Toggle`** — graphical controls with their own fixed-size boxes; not the `singleLineBoxHeight` family this fix targets. Out of scope.

### Container non-squish falls out of the leaf fix — no container change needed except the `LabeledFieldSet` min-default

Once the leaves report min-height `h`:
- **`VBox`/`HBox`** (`computeTotalMinSize` and `getMinSize` sum pure child `getMinSize`) now report a content-derived min instead of 0 — the direct, testable effect of the pin.
- **`Grid`** (which backs `LabeledFieldSet`) was **already** robust on the height axis: `measureContent` uses `Math.max(preferred, min)` per cell ([Grid.ts:866](src/typescript/lib/layout/Grid.ts#L866)) and content-mode row tracks sum those in `getMinSize` ([Grid.ts:394](src/typescript/lib/layout/Grid.ts#L394)), so the grid min already folded in `preferred == h`. The leaf min pin makes it consistent but doesn't change the grid's height report.

### Clear the fixed `minSize` default on `LabeledFieldSet` (mirror the already-cleared `preferredSize`)

[`FieldSet`](src/typescript/lib/component/container/FieldSet.ts#L35) defaults `minSize: {100, 100}`. Because `Component.getMinSize` merges constraint and manager-min with `Math.max` ([Component.ts:2429](src/typescript/lib/core/Component.ts#L2429)), the 100 is a **floor, not a cap** — taller grid content still wins, so it never clips. But it forces a ≥100px min even for a tiny one-field form. `_defaultFormFieldSetOptions` already clears `preferredSize: undefined` for exactly this "a form is as large as its content" reason. **Decision: also clear `minSize: undefined`** in the renamed `_defaultLabeledFieldSetOptions`, so the container's min purely tracks the grid content (which, via `FieldSet.getPerimeterSize`, already includes legend clearance + insets, so an empty fieldset still has a sane non-zero min). Not strictly required to avoid clipping, but symmetric with the preferred clear and removes dead min space. (Alternative — keep the 100 floor — is also non-clipping; rejected for asymmetry with `preferredSize`.)

### The rename & descriptor scheme

`FormFieldSet` → `LabeledFieldSet` everywhere: file, class, callable/export pair (`_FormFieldSet`/`FormFieldSet` → `_LabeledFieldSet`/`LabeledFieldSet`), options interface (`FormFieldSetOptions` → `LabeledFieldSetOptions`), and the defaults const (`_defaultFormFieldSetOptions` → `_defaultLabeledFieldSetOptions`).

Descriptor types: `FormFieldDescriptor` → **`LabeledFieldDescriptor`**, `FormRowDescriptor` → **`LabeledRowDescriptor`**. Chosen over bare `FieldDescriptor`/`RowDescriptor` because the incoming `Form` component may well introduce its own `FieldDescriptor`/`RowDescriptor`; the `Labeled`-prefixed names stay collision-safe, coherent with the `LabeledFieldSet` container, and greppable. (Verified: no existing `FieldDescriptor`/`RowDescriptor`/`LabeledField*` symbols in `src`/`tests`/`docs`.)

### Default behaviour unchanged except the intended min

No behaviour changes beyond (a) the new min-height floor on the listed inputs and their non-squishable containers, and (b) the `LabeledFieldSet` min tracking content instead of the 100px floor. Preferred sizes, max sizes, widths, baselines, and every other input behaviour are untouched.

---

## Public API

Renamed exports (barrel `component/container` and the module). Signatures unchanged; only names change:

```typescript
// component/container/LabeledFieldSet.ts
export interface LabeledFieldDescriptor { title: string; component: Component; }
export type LabeledRowDescriptor =
    | LabeledFieldDescriptor[]
    | { component: Component; fullWidth: true };
export interface LabeledFieldSetOptions extends FieldSetOptions {
    columns?: number;
    fieldSpacing?: number;
    rows?: LabeledRowDescriptor[];
}
class LabeledFieldSet extends _FieldSet { /* body unchanged except renamed types */ }
export { LabeledFieldSet as _LabeledFieldSet, LabeledFieldSetCallable as LabeledFieldSet };
```

No new API for Part 1 — `setMinSize` already exists; the pins are internal `updateHeight` additions.

---

## Ordered Implementation Steps

Do the **rename first** (Phase A), then the **min-height pins** (Phase B), then the **`LabeledFieldSet` min-default clear + tests** (Phase C). The only file both parts touch is the container file, and Phase C edits it after it's already renamed, so there's no collision.

### Phase A — rename `FormFieldSet` → `LabeledFieldSet`

1. **Rename the file** `src/typescript/lib/component/container/FormFieldSet.ts` → `LabeledFieldSet.ts` (`git mv`).
2. **Inside the file**, rename all identifiers: class `FormFieldSet`→`LabeledFieldSet`; `FormFieldSetOptions`→`LabeledFieldSetOptions`; `FormFieldDescriptor`→`LabeledFieldDescriptor`; `FormRowDescriptor`→`LabeledRowDescriptor`; const `_defaultFormFieldSetOptions`→`_defaultLabeledFieldSetOptions`; callable locals `FormFieldSetCallable`→`LabeledFieldSetCallable`; export pair `_FormFieldSet`/`FormFieldSet`→`_LabeledFieldSet`/`LabeledFieldSet`. Update every `{@link FormFieldSet}` in JSDoc and the `FIELD_SPACING_DEFAULT` comment that names `FormFieldSet`.
3. **Barrel** `src/typescript/lib/component/container/index.ts` (L5–6): update the `export {...} from '~/component/container/LabeledFieldSet.js'` path and rename `FormFieldSet` and the three types.
4. **Gallery** `src/typescript/BindingPanel.ts`: rename the import (L9) and all three usages (L153, L175, L206) `new FormFieldSet(...)` → `new LabeledFieldSet(...)`; update comment mentions (L150, L169).
5. **Rename the test file** `tests/component/container/FormFieldSet.test.ts` → `LabeledFieldSet.test.ts` (`git mv`); update its import (L3), `describe` names, and every `new FormFieldSet(...)`.
6. **Docs page** `git mv docs/components/FormFieldSet.md docs/components/LabeledFieldSet.md`; inside, rename the heading, prose, code samples (`FormFieldSet(...)`→`LabeledFieldSet(...)`), and the two `/api/component/container/classes/FormFieldSet` cross-reference links → `.../classes/LabeledFieldSet`.
7. **Docs index** `docs/components/index.md` (L85): rename label, link `/components/FormFieldSet`→`/components/LabeledFieldSet`, and the description if it names the old symbol.
8. **Sidebar** `docs/.vitepress/config.mts` (L120): `{ text: 'LabeledFieldSet', link: '/components/LabeledFieldSet' }`.
9. **llms manifest** `scripts/llms/manifest.data.mjs` (L43): `symbol: "FormFieldSet"` → `"LabeledFieldSet"` (and refresh the `task` prose if it names the old term).
10. **Checkpoint:** `grep -rn 'FormFieldSet\|FormFieldDescriptor\|FormRowDescriptor' src tests docs scripts` → **expect zero**. Do **not** touch `plans/implemented/*` (historical records).
11. **Regenerate llms.txt:** `npm run docs:api && npm run docs:llms` (generator reads the manifest + TypeDoc model + `docs/components/LabeledFieldSet.md`), then `grep -n 'FormFieldSet' llms.txt` → expect zero, and confirm a `LabeledFieldSet` row is present. `tests/unit/llms-generate.test.ts` uses a synthetic model (Button/VBox/TabPanel) and does **not** reference this symbol, so it needs no edit — but run it to confirm green.

### Phase B — pin single-line min-height on the input leaves

12. `TextField.updateHeight` — add `this.setMinSize(0, h);` after the `setMaxSize` line, with a one-line comment: min-height pinned to the single-line box `h` so the field can't be vertically compressed below one line; min-width `0` keeps it horizontally flexible.
13. `PasswordField.updateHeight` — same addition.
14. `UsernameField.updateHeight` — same addition.
15. `ComboBox.updateHeight` — same addition (`this.setMinSize(0, h);`).
16. `AbstractPickerField.updateHeight` — same addition (covers `DateField`/`TimeField`/`DateTimeField`).
17. `NumberSpinner.updateHeight` — same addition (its max-width is `UNBOUNDED`; min-width stays `0`).
18. `AutoCompleteField.syncSizeFromTextField` — after the preferred/max mirror, add the min mirror: `const min = this._textField.getMinSize(); if (min) { this.setMinSize(min.width, min.height); }` with a comment that it mirrors the inner field's min so the composite is non-squishable like a bare `TextField`.
19. **Checkpoint:** typecheck (`npm run build` or `tsc --noEmit`) passes.

### Phase C — `LabeledFieldSet` min-default clear + tests

20. In `LabeledFieldSet.ts`, extend `_defaultLabeledFieldSetOptions` to also clear the base floor: add `minSize: undefined,` next to `preferredSize: undefined,`, updating the JSDoc to explain both clears (a labeled fieldset is exactly its computed grid content; the 100px min floor would only pad a tiny form).
21. Add the new tests (see **Verification**).
22. **Checkpoint:** `npm run test` green; `npm run build` clean; `npm run docs:build` finishes with zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Rename+modify | `src/typescript/lib/component/container/FormFieldSet.ts` → `LabeledFieldSet.ts` |
| Modify | `src/typescript/lib/component/container/index.ts` (barrel) |
| Modify | `src/typescript/BindingPanel.ts` (gallery) |
| Rename+modify | `tests/component/container/FormFieldSet.test.ts` → `LabeledFieldSet.test.ts` |
| Rename+modify | `docs/components/FormFieldSet.md` → `LabeledFieldSet.md` |
| Modify | `docs/components/index.md` |
| Modify | `docs/.vitepress/config.mts` |
| Modify | `scripts/llms/manifest.data.mjs` |
| Regenerate | `llms.txt` (via `npm run docs:llms`) |
| Modify | `src/typescript/lib/component/input/TextField.ts` |
| Modify | `src/typescript/lib/component/input/PasswordField.ts` |
| Modify | `src/typescript/lib/component/input/UsernameField.ts` |
| Modify | `src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `src/typescript/lib/component/input/AbstractPickerField.ts` |
| Modify | `src/typescript/lib/component/input/NumberSpinner.ts` |
| Modify | `src/typescript/lib/component/input/AutoCompleteField.ts` |
| Create | test(s) for the min-height pin + container non-squish (see Verification) |

---

## Expected Behaviour

Concrete, mostly unit-testable via `installTestDOM` + `font-metrics.test-font.json` (offline measurement works — see existing `FormFieldSet.test.ts`).

1. **A single-line input's min-height equals its box height** *(unit-testable)*: for each of `TextField`, `PasswordField`, `UsernameField`, `ComboBox`, `NumberSpinner`, `DateField` (via `AbstractPickerField`), `AutoCompleteField` — `input.getMinSize()!.height === input.getPreferredSize()!.height` (both `== h`), and that value is `> 0`.
2. **Min width stays flexible** *(unit-testable)*: `input.getMinSize()!.width === 0` for the above — the field can still shrink/stretch horizontally.
3. **A stacked container of fields no longer collapses** *(unit-testable)*: a `Panel` with a `VBox` layout containing N `TextField`s reports `container.getMinSize()!.height >= N * h` (plus spacing) — before the fix it was ~0 (spacing/perimeter only). This directly exercises `VBox.computeTotalMinSize`/`getMinSize` summing the new leaf minimums.
4. **A labeled fieldset reports content-derived min and doesn't clip** *(unit-testable)*: a `LabeledFieldSet` with several stacked fields has `getMinSize()!.height >= ` the summed field content — never below one row of fields. With the min-default cleared, a one-field `LabeledFieldSet` reports a min near its grid content (legend + insets + one row), not a hard 100px.
5. **`TextArea` stays Y-resizable** *(unit-testable)*: `new TextArea().getMinSize()!.height` is **not** pinned to one line — its min-height is `< ` its preferred/expanded height (it has no single-line max pin), confirming the exclusion. (Assert it is not equal to `Util.singleLineBoxHeight(...)`, i.e. TextArea did not gain a one-line floor.)
6. **All old-name references are gone** *(unit-testable via grep, see Verification)*: `grep -rn 'FormFieldSet' src tests docs scripts llms.txt` → zero; the barrel exports `LabeledFieldSet` and the three `Labeled*` types.
7. **Gallery still compiles and shows the renamed container** *(manual-verify)*: `BindingPanel` builds and the Binding demo renders the three `LabeledFieldSet`s (`Information`, `Address (2-column demo)`, `File inputs`) with fields that do not visually squish when the panel is short.
8. **Focus/typing/dropdown behaviour unchanged** *(manual-verify)*: the pinned inputs still accept input, open dropdowns/pickers, and align on the shared baseline as before.

---

## Verification

- **Typecheck/build:** `npm run build` (or `tsc --noEmit`) clean.
- **Grep invariants:** `grep -rn 'FormFieldSet\|FormFieldDescriptor\|FormRowDescriptor' src tests docs scripts` → zero; `grep -n 'FormFieldSet' llms.txt` → zero after regen.
- **Unit tests:** the renamed `tests/component/container/LabeledFieldSet.test.ts` (existing cases, renamed) plus new cases for Expected Behaviour #1–5. Put the input min-height + VBox non-squish cases in a new `tests/component/input/single-line-min-height.test.ts` (or extend an existing input test), and the labeled-fieldset min case in `LabeledFieldSet.test.ts`.
- **Docs:** `npm run docs:build` finishes with **zero warnings** (per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)); confirm the API page renders as `LabeledFieldSet` and `docs/components/LabeledFieldSet.md` cross-links resolve.
- **llms regen:** `npm run docs:llms` then eyeball the `LabeledFieldSet` row in `llms.txt`.
- **Manual smoke:** run the gallery/demo (BindingPanel screen), verify the three labeled fieldsets render and their fields keep one-line height in a shortened container.

---

## Documentation Impact

- **Export/barrel:** `component/container/index.ts` exposes `LabeledFieldSet` + `LabeledFieldSetOptions`/`LabeledFieldDescriptor`/`LabeledRowDescriptor`.
- **Doc page:** `docs/components/LabeledFieldSet.md` (renamed); catalog row in `docs/components/index.md`; sidebar entry in `docs/.vitepress/config.mts`.
- **Cross-reference link form:** `/api/component/container/classes/LabeledFieldSet` and `/components/LabeledFieldSet` (TypeDoc regenerates the API page from the renamed source).
- **llms:** `scripts/llms/manifest.data.mjs` symbol + regenerated `llms.txt`.
- **Old-name sweep:** `grep -rln '\bFormFieldSet\b' docs/ src/ tests/ scripts/` → zero (excluding `plans/implemented/`, which is historical and left as-is).
- **JSDoc `{@link}` rule:** the min-height comments must not `{@link}` any private/protected symbol (e.g. don't link `updateHeight`); describe behaviour in prose per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md).

---

## Potential Challenges

- **`setMinSize` writes `minWidth` too** — passing `0` is required (not omitted), since there's no height-only setter; `min-width: 0px` is a no-op for absolute components, so no horizontal regression. Mitigation: assert min-width `0` in a test (Expected Behaviour #2).
- **Composite inputs already report a manager-derived min** — for `NumberSpinner`/`AbstractPickerField`/`AutoCompleteField` the pinned constraint merges via `Math.max` with their layout-manager min; the pin acts as a floor and never lowers an already-larger min. No conflict.
- **llms.txt regeneration needs the TypeDoc build** — `docs:llms` follows `docs:api`; run both. If the build is heavy, the one changed `llms.txt` line may be hand-verified, but regeneration is the source of truth.
- **`TextArea` accidental inclusion** — the single biggest risk is centralizing the pin in `TextInput`; the plan explicitly keeps it per-subclass to avoid binding `TextArea`/`PickerInput`. Expected Behaviour #5 guards it.

---

## Critical Files

- [src/typescript/lib/core/Component.ts:2428](src/typescript/lib/core/Component.ts#L2428) — `getMinSize`/`setMinSize`/`getMinSizeConstraint`, the merge (`Math.max`) contract.
- [src/typescript/lib/layout/VBox.ts:137](src/typescript/lib/layout/VBox.ts#L137) — the pure-min aggregation that collapses today; the fix's testable target.
- [src/typescript/lib/layout/Grid.ts:394](src/typescript/lib/layout/Grid.ts#L394), [:854](src/typescript/lib/layout/Grid.ts#L854) — grid min uses `max(preferred, min)`; explains why `LabeledFieldSet` didn't clip on height even before the fix.
- [src/typescript/lib/component/input/TextInput.ts](src/typescript/lib/component/input/TextInput.ts) — shared base of `TextField`/`PasswordField`/`UsernameField`/`TextArea`/`PickerInput`; the "don't centralize" boundary.
- [src/typescript/lib/component/container/FieldSet.ts:25](src/typescript/lib/component/container/FieldSet.ts#L25) — base `minSize:{100,100}` default and the `getMinSize`/`getPerimeterSize` (legend clearance) overrides.
- [src/typescript/lib/component/container/FormFieldSet.ts](src/typescript/lib/component/container/FormFieldSet.ts) — the file being renamed; `_defaultFormFieldSetOptions` clears `preferredSize`.
- [ARCHITECTURE.md](ARCHITECTURE.md) *Size constraints* — the report-at-the-source rule the leaf fix follows.

---

## Non-Goals

- **The `Form` sibling component** (renders `<form>`) and `Dialog.dismissable` — separate plan `form-component-and-dialog-dismissable.md`. This plan only does the rename that unblocks it; it does not add `Form`.
- **The downstream sqladmin app rewrite** — different repo/concern.
- **Refactoring the duplicated `updateHeight` bodies** into a shared helper — out of scope; surgical per-subclass edits only.
- **Min-height for graphical controls** (`Slider`/`Checkbox`/`RadioButton`/`Toggle`) — not the single-line-box family; not addressed.
- **Editing `plans/implemented/*`** historical plan records.
