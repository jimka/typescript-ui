# Structural Base Theme — Implementation Plan

## Overview

The three built-in themes — [`ClassicTheme`](../src/typescript/lib/core/themes/ClassicTheme.ts), [`ModernTheme`](../src/typescript/lib/core/themes/ModernTheme.ts), [`DarkTheme`](../src/typescript/lib/core/themes/DarkTheme.ts) — each re-declare the *entire* `Theme` object (~40 nested buckets, 300+ lines each), even though the bulk of the structure is identical. `ModernTheme`'s doc comment ([ModernTheme.ts:6-9](../src/typescript/lib/core/themes/ModernTheme.ts#L6)) even claims it "Reuses ClassicTheme values everywhere except the `button` and `table.header` buckets," but the object literally copies everything — so the themes silently drift (e.g. they share dozens of identical palette colours by hand-copy, not by reuse).

This plan introduces a **shared structural base** — `BaseTheme` — holding the scheme-invariant tokens (dimensions, sizes, paddings, radii, gaps, thicknesses, durations, font sizes), plus a deep-merge helper `defineTheme(base, overrides)` and a `DeepPartial<Theme>` type. Each concrete theme is rewritten as `defineTheme(BaseTheme, { …its palette + structural tweaks… })`, declaring only the tokens it actually differs on. The runtime theme shape, [`themeToVars`](../src/typescript/lib/core/Theme.ts#L566), [`ThemeManager`](../src/typescript/lib/core/Theme.ts#L788), and every resolved token value stay byte-for-byte identical — this is an authoring/dedup refactor, not a behaviour change.

The helper and type live in [`Theme.ts`](../src/typescript/lib/core/Theme.ts); the structural object lives in a new `themes/BaseTheme.ts`. The work is independent of any in-flight branch and should land on its own branch.

---

## Architecture Decisions

### Type-safety of completeness — choose (a): `DeepPartial` parts + cast + runtime/test completeness guard

The core question is whether TypeScript can *prove* that `BaseTheme` + each theme's overrides together cover every required `Theme` key. Two options were evaluated:

- **(a)** `defineTheme(base: DeepPartial<Theme>, overrides: DeepPartial<Theme>): Theme` returning via a cast, backed by a completeness guard (a test that asserts every exported theme deep-equals a fully-populated reference / has every leaf).
- **(b)** Split `Theme` into `ThemeStructure & ThemePalette` so the intersection recurses and `BaseTheme: ThemeStructure` / each-theme-overrides`: ThemePalette` give compile-time completeness.

**Recommendation: (a).** Reading the interface, the split required by (b) is **leaf-level, not bucket-level**, and several buckets are genuinely mixed *and* divergent in ways that defeat a clean two-interface partition:

- `button` mixes structural (`padding`, `font.size`, `description.fontSize`, `description.weight`) with palette (`background`, `border`, `shadow`, all `pressed.*`/`hover.*` colours).
- `header` mixes `font.size` (structural, identical everywhere) with `padding` which **is not invariant** — Classic/Modern use `5`, Dark uses `4` ([DarkTheme.ts:111](../src/typescript/lib/core/themes/DarkTheme.ts#L111) vs [ClassicTheme.ts:113](../src/typescript/lib/core/themes/ClassicTheme.ts#L113)).
- `tab.underBorderFullWidth` is a structural-shaped boolean that **also varies**: `true` for Classic/Dark, `false` for Modern ([ModernTheme.ts:99](../src/typescript/lib/core/themes/ModernTheme.ts#L99)).
- `table.cell` mixes `height`/`padding` (structural) with `background`/`color`/`border`/`readonlyBackground`/`editorBorderColor` (palette).
- `form.toggle`/`form.slider`/`form.checkbox`/`form.radio` each mix sizes (structural) with colours (palette).
- `popover` mixes `radius`/`padding`/`arrowSize` (structural) with `background`/`color`/`border`/`shadow` (palette).
- `progressBar.track` mixes `borderRadius` (structural) with `background` (palette).

Under (b) each of these buckets must be authored *twice* — once in `ThemeStructure`, once in `ThemePalette` — with the optional/required flags lining up so the recursive intersection reconstructs the original bucket exactly. That is fragile to author and to read, and the two tokens that *look* structural but *aren't* invariant (`header.padding`, `tab.underBorderFullWidth`) would have to be assigned to the palette half anyway — so (b) does not even buy "all structure in one place." The "intricate leaf-level split" cost called out in the brief is real and high here.

(a) keeps a single `Theme` interface (no consumer churn, `themeToVars` untouched), and the completeness risk it introduces is fully retired by a **deep value-equivalence regression test** that already has to exist for this refactor (see `## Verification`): if a theme is missing a leaf after merge, the merged object won't deep-equal the captured baseline, and the test fails loudly. The cast lives in exactly one place (`defineTheme`'s return), is documented, and is the only spot a reviewer must trust.

### `header.padding` and `tab.underBorderFullWidth` live in `BaseTheme` with per-theme overrides

`BaseTheme` carries the **majority value** for every structural leaf, including `header.padding: 5` and `tab.underBorderFullWidth: true` (the Classic/Dark majority). `DarkTheme` then overrides `header: { padding: 4 }` and `ModernTheme` overrides `tab: { underBorderFullWidth: false }` in its overrides bag. The deep-merge means a one-leaf override (`header.padding`) does **not** force re-declaring `header.font.size`. This keeps "structural" defined as *invariant-by-default, override-when-it-genuinely-differs*, rather than *provably invariant* — the pragmatic reading that matches the data.

### No concrete theme depends on another concrete theme

`ClassicTheme`, `ModernTheme`, `DarkTheme` ALL derive from `BaseTheme`, never from each other. The stale `ModernTheme` "reuses ClassicTheme" doc comment is replaced with one describing the `defineTheme(BaseTheme, …)` authoring model. Modern must NOT import or spread `ClassicTheme`.

### Cross-theme derivation is sanctioned but must be named as such

`defineTheme`'s `base` parameter is typed `DeepPartial<Theme>`, which a *complete* `Theme` satisfies — so `defineTheme(ClassicTheme, { …dark palette… })` is legal and is the **explicit, opt-in** pattern for deriving one full theme from another (e.g. a future `DarkClassicTheme`). This is documented as distinct from the default path (everything from `BaseTheme`). The default for the three built-ins is `defineTheme(BaseTheme, …)`; deriving from a concrete theme is reserved for deliberate "same structure, swapped scheme" cases and is called out in the docs so it isn't reached for by habit.

### Deep merge semantics — recurse plain objects, replace leaves, arrays replace wholesale

`defineTheme` recurses into plain objects and replaces primitive leaves (`string` / `number` / `boolean`). **Confirmed by reading the full `Theme` interface ([Theme.ts:25-535](../src/typescript/lib/core/Theme.ts#L25)): there are no array-typed tokens and no class-instance tokens anywhere** — every leaf is `string`, `number`, or `boolean`, and every non-leaf is a plain object literal. So the merge needs only two cases: plain-object → recurse, everything-else → replace. The "arrays replace wholesale" rule is locked as the contract anyway (future-proofing), but no current token exercises it. `undefined` override values are skipped (an absent override key must not blank a base value). Optional per-side tab-border fields (`borderTop?` etc.) merge naturally: present in an override → set; absent → inherit base/uniform.

### `BaseTheme` is exported publicly

Consumers writing custom themes will want `defineTheme(BaseTheme, …)` as the recommended authoring path, so `BaseTheme` and `defineTheme` and `DeepPartial` are re-exported from the `core` barrel ([core/index.ts:37](../src/typescript/lib/core/index.ts#L37)) alongside the existing theme exports. `BaseTheme` is `@category Theme` and documented as "an incomplete scaffold — not a usable theme on its own; always wrap with `defineTheme`."

---

## Public API (TypeScript Signatures)

In [`Theme.ts`](../src/typescript/lib/core/Theme.ts):

```typescript
/**
 * Recursively-optional view of a type: every property optional at every depth,
 * recursing into plain object properties. Used for the partial overrides bag
 * passed to {@link defineTheme}.
 */
export type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Produces a fully-resolved {@link Theme} by deep-merging `overrides` onto `base`.
 *
 * `base` is typically {@link BaseTheme} (the structural scaffold), but may be any
 * full `Theme` to deliberately derive one theme from another (e.g.
 * `defineTheme(ClassicTheme, { …dark palette… })`). The caller is responsible for
 * `base` + `overrides` together covering every `Theme` key; completeness is
 * enforced by the theme regression test, not the type system.
 *
 * Merge rule: recurse into plain objects, replace primitive/array leaves wholesale,
 * skip `undefined` override values.
 *
 * @param base - The scaffold or full theme to layer onto.
 * @param overrides - Tokens that differ from `base`.
 * @returns A complete, resolved `Theme`.
 */
export function defineTheme(base: DeepPartial<Theme>, overrides: DeepPartial<Theme>): Theme;
```

In new [`themes/BaseTheme.ts`](../src/typescript/lib/core/themes/BaseTheme.ts):

```typescript
/**
 * Scheme-invariant structural tokens shared by every built-in theme — sizes,
 * paddings, radii, gaps, thicknesses, durations, and font sizes. Not a usable
 * theme on its own (palette tokens are absent); wrap it with {@link defineTheme}.
 *
 * @category Theme
 */
export const BaseTheme: DeepPartial<Theme>;
```

`defineTheme`, `DeepPartial`, and `BaseTheme` are added to the re-export line in [core/index.ts:37](../src/typescript/lib/core/index.ts#L37); `DeepPartial` joins the `export type` line at [core/index.ts:38](../src/typescript/lib/core/index.ts#L38).

---

## Theme Tokens — Structural vs Palette Classification

**Classification principle.** A leaf is **structural** if its value is a layout/timing/typography quantity that does not encode the light/dark/flat *look* — sizes, paddings, radii, gaps, thicknesses, durations, font sizes, and the boolean/numeric layout switches. It is **palette** if it encodes appearance — colours, gradients, shadows, borders (which carry colour), opacities. Verified against all three theme literals: structural leaves below are byte-identical across Classic/Modern/Dark **except** the two flagged `†` (structural-shaped but divergent — they live in `BaseTheme` with the majority value and are overridden per theme).

### Structural leaves → live in `BaseTheme`

| Token path | Base value | Notes |
| --- | --- | --- |
| `font.family` | `'system-ui, sans-serif'` | identical all 3 |
| `font.size` | `'14px'` | identical |
| `font.linePadding` | `'2px'` | identical |
| `border.radius` | `'4px'` | identical (`border.color` is palette) |
| `button.padding` | `'0'` | identical |
| `button.font.size` | `'12px'` | identical |
| `button.description.fontSize` | `'11px'` | identical |
| `button.description.weight` | `'normal'` | identical — see Ambiguous below |
| `form.toggle.width` / `.height` | `'36px'` / `'20px'` | identical |
| `form.slider.thumbSize` / `.trackThickness` | `'16px'` / `'4px'` | identical |
| `form.checkbox.size` / `.radius` | `'16px'` / `'3px'` | identical |
| `form.radio.size` | `'16px'` | identical |
| `tab.underBorderFullWidth` `†` | `true` | Modern overrides to `false` |
| `tab.indicator.thickness` | `'2px'` | identical |
| `window.minDockWidth` | `'200px'` | identical |
| `header.font.size` | `'12px'` | identical |
| `header.padding` `†` | `5` | Dark overrides to `4` |
| `table.header.font.size` | `'13px'` | identical |
| `table.header.glyph.gap` | `'4px'` | identical (`glyph.color` is palette but `'currentColor'` is also invariant — see Ambiguous) |
| `table.cell.height` | `'22px'` | identical |
| `table.cell.padding` | `2` | identical |
| `table.resizeHandle.width` / `.cursor` | `'5px'` / `'ew-resize'` | identical (`.color` is palette) |
| `table.sortBadge.fontSize` | `'10px'` | identical |
| `menuBar.panel.minWidth` | `'160px'` | identical |
| `statusBar.height` / `.padding` | `'22px'` / `'6px'` | identical |
| `toolBar.padding` / `.gap` | `'4px'` / `'4px'` | identical |
| `popover.radius` / `.padding` / `.arrowSize` | `'6px'` / `'12px'` / `'8px'` | identical |
| `dropdown.fade.duration` / `.translate` | `'120ms'` / `'4px'` | identical |
| `spinner.buttonWidth` | `'18px'` | identical (`.dividerColor` is palette) |
| `progressBar.track.borderRadius` | `'4px'` | identical (`.background` is palette) |
| `progressSpinner.size` | `'32px'` | identical |
| `glyph.spinDuration` / `.pulseDuration` / `.beatDuration` | `'2000ms'` / `'1000ms'` / `'1000ms'` | identical |
| `drag.ghost.opacity` | `'0.85'` | identical — opacity is a quantity, not a colour |

### Palette leaves → each theme supplies in its overrides bag

Everything not listed above: all `*.background`, `*.color`/`*.foreground`, `*.shadow`, `*.border`/`*.borderHover`/`*.borderTop`/etc., gradient strings, `text.color`, `body.background`, `border.color`, every `notification.*`/`dialog.*`/`drag.feedback.*` colour, `toggle.selected.*`, `input.*` (border shorthands carry colour), `indicator.focus`/`indicator.selection`, `picker.*`, `list.*`/`autoComplete.*` colours, `accordion.*` colours, `tab.toolbar.*` and `tab.button.*` colours, `table.header.background`/`.border`, `table.row.*`, `table.cell` colour leaves, `scroll.shadowColor`, `gutter.background`, `progressBar.fill`/`.indeterminate`, `progressSpinner.color`/`.backdrop`.

### Ambiguous leaves — assigned with reasoning

- **`colorScheme`** (`'light'`/`'light'`/`'dark'`) → **palette** (theme-supplied). It is the literal light/dark switch and differs across themes; it belongs with the appearance each theme owns.
- **`button.description.weight`** (`'normal'` everywhere) → **structural**. It is a typography quantity (font-weight), invariant across all three, and reads naturally beside `description.fontSize`. If a future theme wants bold descriptions it overrides one leaf — same as any structural default.
- **`table.header.glyph.color`** (`'currentColor'` everywhere) → **palette**, even though invariant. It is a colour keyword; keeping it in the palette half preserves the "all colour in the theme's bag" mental model and avoids a lone colour leaf in `BaseTheme`. (`glyph.gap` beside it is structural.) Cost: one invariant colour is repeated in three bags — acceptable, and the regression test catches drift.
- **`table.cell.color`/`.border`** (`'inherit'`/`'none'` everywhere) → **palette**. Same reasoning: appearance keywords stay with the palette even when currently invariant.
- **`drag.ghost.opacity`** → **structural** (a numeric quantity, listed above).

This classification is the substance of the work; the implementer must reproduce it exactly so the merged values are unchanged.

---

## Internal Structure — the deep merge

`defineTheme` does a recursive merge. Plain-object detection must exclude arrays (none exist in `Theme` today, but the rule is locked):

```typescript
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(base: unknown, overrides: unknown): unknown {
    if (!isPlainObject(base) || !isPlainObject(overrides)) {
        return overrides;            // leaf or array → replace wholesale
    }

    const result: Record<string, unknown> = { ...base };

    for (const key of Object.keys(overrides)) {
        const ov = overrides[key];

        if (ov === undefined) {
            continue;                // absent override must not blank a base value
        }

        result[key] = key in base ? deepMerge(base[key], ov) : ov;
    }

    return result;
}
```

`defineTheme` calls `deepMerge(base, overrides)` and casts the result to `Theme` (the single documented cast). Magic-number-free; the only literals are in the data, not the merge. Follows `CODE_CONVENTIONS.md` blank-line and explicit-return-type rules.

---

## Ordered Implementation Steps

1. **Add `DeepPartial`, `defineTheme`, and the private `deepMerge`/`isPlainObject` helpers to [`Theme.ts`](../src/typescript/lib/core/Theme.ts).** Place the type + exported helper near the top (after the `Theme` interface, before `themeToVars`); keep `deepMerge`/`isPlainObject` as file-private functions. Do not touch `themeToVars`, `tabButtonSideVars`, or `ThemeManager`.
   → verify: `npx tsc -p tsconfig.lib.json --noEmit` clean.

2. **Capture the baseline (regression guard scaffolding) BEFORE rewriting any theme.** Write a throwaway script (run with `tsx`) that imports the current `ClassicTheme`/`ModernTheme`/`DarkTheme` and `themeToVars`, and writes `JSON.stringify` snapshots of all three resolved objects **and** their `themeToVars` outputs to `/tmp/theme-baseline.json`. This freezes the current resolved values.
   → verify: `/tmp/theme-baseline.json` exists and contains 6 entries (3 themes + 3 var maps).

3. **Create [`themes/BaseTheme.ts`](../src/typescript/lib/core/themes/BaseTheme.ts)** exporting `BaseTheme: DeepPartial<Theme>` containing exactly the structural leaves from the classification table (majority values: `header.padding: 5`, `tab.underBorderFullWidth: true`). Import `DeepPartial`/`Theme` from `~/core/Theme.js`.
   → verify: `npx tsc -p tsconfig.lib.json --noEmit` clean.

4. **Rewrite [`ClassicTheme.ts`](../src/typescript/lib/core/themes/ClassicTheme.ts)** as `export const ClassicTheme: Theme = defineTheme(BaseTheme, { …palette + colorScheme… });`. Include `colorScheme: 'light'` and every palette leaf; omit every structural leaf already in `BaseTheme`. Classic needs **no** structural override (`header.padding` 5 and `underBorderFullWidth` true match the base).
   → verify: typecheck clean; re-run the baseline script comparing `ClassicTheme` to the snapshot — deep-equal.

5. **Rewrite [`ModernTheme.ts`](../src/typescript/lib/core/themes/ModernTheme.ts)** likewise, with `colorScheme: 'light'`, its palette, and the one structural tweak `tab: { underBorderFullWidth: false, …palette tab leaves… }`. Replace the stale "reuses ClassicTheme" JSDoc with a `defineTheme(BaseTheme, …)` description. Must NOT import `ClassicTheme`.
   → verify: typecheck clean; deep-equal vs snapshot; `grep -n ClassicTheme src/typescript/lib/core/themes/ModernTheme.ts` → zero matches.

6. **Rewrite [`DarkTheme.ts`](../src/typescript/lib/core/themes/DarkTheme.ts)** with `colorScheme: 'dark'`, its palette, and the one structural tweak `header: { padding: 4 }`.
   → verify: typecheck clean; deep-equal vs snapshot.

7. **Update the `core` barrel [`core/index.ts:37-38`](../src/typescript/lib/core/index.ts#L37):** add `defineTheme` and `BaseTheme` to the value re-export from `~/core/Theme.js` (BaseTheme re-exported through `Theme.ts` or directly from `~/core/themes/BaseTheme.js` — match the existing pattern where `Theme.ts` re-exports the theme consts at [Theme.ts:537](../src/typescript/lib/core/Theme.ts#L537)); add `DeepPartial` to the `export type` line.
   → verify: `import { defineTheme, BaseTheme, DeepPartial } from '@jimka/typescript-ui/core'` resolves; typecheck clean.

8. **Run the full value-equivalence regression** (step 2's script, now asserting deep-equality for all 3 themes and all 3 var maps).
   → verify: all 6 comparisons equal; delete `/tmp/theme-baseline.json` and the throwaway script (do not commit them — see Verification for the optional permanent-test alternative).

9. **Update docs** (`docs/concepts/theming.md`, `docs/recipes/custom-theme.md`) per `## Documentation Impact`.
   → verify: `npm run docs:build` → 0 errors, 0 new link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) — add `DeepPartial`, `defineTheme`, private `deepMerge`/`isPlainObject`; re-export `BaseTheme`/`defineTheme` |
| Create | `src/typescript/lib/core/themes/BaseTheme.ts` — structural scaffold |
| Modify | [`src/typescript/lib/core/themes/ClassicTheme.ts`](../src/typescript/lib/core/themes/ClassicTheme.ts) — rewrite as `defineTheme(BaseTheme, …)` |
| Modify | [`src/typescript/lib/core/themes/ModernTheme.ts`](../src/typescript/lib/core/themes/ModernTheme.ts) — rewrite; fix stale JSDoc; drop ClassicTheme implication |
| Modify | [`src/typescript/lib/core/themes/DarkTheme.ts`](../src/typescript/lib/core/themes/DarkTheme.ts) — rewrite as `defineTheme(BaseTheme, …)` |
| Modify | [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts) — export `defineTheme`, `BaseTheme`, `DeepPartial` |
| Modify | [`docs/concepts/theming.md`](../docs/concepts/theming.md) — rewrite "Custom themes" to the `defineTheme(BaseTheme, …)` story |
| Modify | [`docs/recipes/custom-theme.md`](../docs/recipes/custom-theme.md) — migrate spread examples to `defineTheme` |

No deletions. No `themeToVars` / `ThemeManager` changes.

---

## Verification

- **Value-equivalence regression (the load-bearing check).** Capture the current resolved `ClassicTheme`/`ModernTheme`/`DarkTheme` *and* their `themeToVars(...)` maps (step 2), then after the rewrite assert `deepEqual` for all six. No token value may change. Run via `tsx`. Because the repo has **no test runner installed yet** (Vitest is a planned future addition — see [plans/test-suite.md](test-suite.md)), this is a throwaway `tsx` script, mirroring the existing standalone-script pattern in `scripts/`. **Optional, recommended:** if/when Vitest lands, promote it to a permanent `themes.test.ts` that asserts each exported theme has every leaf `themeToVars` reads (a non-`undefined` value for all ~190 vars) — that is the standing "completeness guard" backing decision (a). Until then the one-shot script is the gate.
- **`npx tsc -p tsconfig.lib.json --noEmit`** clean (the project's `typecheck` script).
- **`npm run docs:build`** → 0 errors, 0 new link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
- **Grep invariants:** `grep -n ClassicTheme src/typescript/lib/core/themes/ModernTheme.ts` and `…/DarkTheme.ts` → zero matches (no cross-theme dependency).
- **Manual smoke:** `npm run dev` (app on http://localhost:8015), toggle ModernTheme/ClassicTheme/DarkTheme on the demo screen (e.g. MiscPanel) — buttons, table headers, tabs, accordions, dialogs, dark scheme all render identically to pre-refactor.

---

## Documentation Impact

Public API changes: two new exported symbols (`defineTheme`, `BaseTheme`) and one new exported type (`DeepPartial`) on the `core` subpath.

- **Barrel:** re-exported from [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts) (the `core` per-subpath barrel — there is no root barrel). All three carry `@category Theme`. After `docs:build`, confirm `defineTheme` lands under `docs/api/core/functions/`, `BaseTheme` under `docs/api/core/variables/`, `DeepPartial` under `docs/api/core/type-aliases/`.
- **Concepts page [`docs/concepts/theming.md`](../docs/concepts/theming.md):** rewrite the **Custom themes** section ([theming.md:96-115](../docs/concepts/theming.md#L96)). New authoring story: `defineTheme(BaseTheme, { …palette… })` is the recommended path; deep-merge means a single nested leaf override (e.g. `table: { header: { background: … } }`) no longer requires spreading the whole bucket — call out that this is the win over the old `...ModernTheme` spread. Document the sanctioned cross-theme derivation (`defineTheme(ClassicTheme, { …dark palette… })`) as a deliberate, named alternative. Update the line at [theming.md:14](../docs/concepts/theming.md#L14) and [theming.md:26](../docs/concepts/theming.md#L26) that say "spread one of them / spread `DefaultTheme`" — note `DefaultTheme` is already a stale name (no such export exists; the default is `ModernTheme`), so fix it to the `defineTheme` model while here.
- **Recipe [`docs/recipes/custom-theme.md`](../docs/recipes/custom-theme.md):** migrate the spread-and-override examples ([custom-theme.md:11-36](../docs/recipes/custom-theme.md#L11)) to `defineTheme(BaseTheme, …)` (and show the cross-theme `defineTheme(ClassicTheme, …)` form for the "blue variant of Classic" goal). The nested `button.pressed` override shrinks because deep-merge removes the manual `...ClassicTheme.button` / `...ClassicTheme.button.pressed` spreads.
- **Sidebar / catalogs:** no new pages, so `docs/.vitepress/config.mts` and the `recipes`/`concepts` `index.md` catalogs need no new entries. Cross-bucket JSDoc references in the new symbols use markdown links per `_shared/docs-conventions.md` (all targets are same-bucket `core`, so `{@link Theme}` / `{@link defineTheme}` / `{@link BaseTheme}` resolve directly).

---

## Potential Challenges

- **Missing a palette leaf in a rewritten bag** silently falls back to a `BaseTheme` structural value or `undefined` → the var emits as the wrong value or `"undefined"`. *Mitigation:* the value-equivalence regression (step 2/8) catches any drift before the change is declared done; do not skip it.
- **`header.padding` / `tab.underBorderFullWidth` divergence** is the easiest thing to fumble — putting the wrong majority in `BaseTheme` or forgetting Dark/Modern's override flips a value. *Mitigation:* the table fixes base = `5`/`true`; the regression asserts Dark=4 and Modern=false post-merge.
- **`undefined`-skipping in the merge** matters for the optional per-side tab borders: a theme that sets `tab.button.borderLeft` but not `borderRight` must keep the base/uniform fallback. *Mitigation:* the `if (ov === undefined) continue;` branch plus `tabButtonSideVars`' existing `?? side.border` fallback together preserve current output; verified by the `themeToVars` half of the regression.
- **Plain-object detection vs future arrays:** `Theme` has none today (confirmed), so `isPlainObject` excluding arrays is currently untested by data. *Mitigation:* the rule is locked and documented; if a future array token is added, the replace-wholesale branch already handles it.
- **Barrel export ordering:** `BaseTheme` is defined in `themes/BaseTheme.ts` and imported by all three theme files **and** by `Theme.ts` (for re-export). Keep the import direction one-way (`Theme.ts` → no import from theme files except the existing three const re-exports) to avoid a cycle; `BaseTheme.ts` imports only the `DeepPartial`/`Theme` *types* from `Theme.ts`, which is erasable and cycle-safe.

---

## Critical Files

- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) — the `Theme` interface (the source of the structural/palette classification), `themeToVars` (the resolved-output contract the regression locks), `ThemeManager` (untouched).
- [`src/typescript/lib/core/themes/ClassicTheme.ts`](../src/typescript/lib/core/themes/ClassicTheme.ts) / [`ModernTheme.ts`](../src/typescript/lib/core/themes/ModernTheme.ts) / [`DarkTheme.ts`](../src/typescript/lib/core/themes/DarkTheme.ts) — the three literals to rewrite; the diff between them *is* the palette/structural boundary.
- [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts) — the `core` export surface.
- [`docs/concepts/theming.md`](../docs/concepts/theming.md), [`docs/recipes/custom-theme.md`](../docs/recipes/custom-theme.md) — the authoring story that changes.
- `CODE_CONVENTIONS.md` — blank-line rules, explicit return types, documented literals (the `BaseTheme` values mirror existing token literals; no new magic numbers introduced).

---

## Non-Goals

- **No change to any resolved token value, the `Theme` interface shape, `themeToVars`, or `ThemeManager`.** This is authoring dedup only; runtime output is byte-identical.
- **No splitting of `Theme` into Structure/Palette interfaces** — rejected in `## Architecture Decisions` (decision (a)).
- **No new themes** (`DarkClassicTheme` etc.). The cross-theme-derivation path is *documented and enabled*, not exercised here.
- **No Vitest/test-runner introduction.** The regression is a throwaway `tsx` script; promoting it to a permanent test waits on [plans/test-suite.md](test-suite.md).
- **No reconciliation of currently-invariant palette keywords** (`table.header.glyph.color: 'currentColor'`, `table.cell.color: 'inherit'`) into `BaseTheme` — deliberately left in each theme's palette bag for mental-model clarity (see classification Ambiguous notes).
