---
touches-shared:
  - packages/lib/src/typescript/lib/core/Theme.ts
  - packages/lib/src/typescript/lib/core/themes/BaseTheme.ts
  - packages/lib/src/typescript/lib/component/display/Glyph.ts
  - packages/lib/docs/concepts/theming.md
  - packages/lib/docs/reference/changelog/next.md
---

# Glyph Icon Size Scale — Implementation Plan

## Overview

Icon sizes are decided independently at every site that sets one. Ten sites hardcode a pixel literal (`16`, `12`, `20`, `8`), several more agree on a value only by coincidence, and two theme tokens (`titleGlyph`, `tabCloseGlyph`) each serve exactly one owner. Nothing states that a menu item's icon and a list row's icon are meant to be the same size, so nothing keeps them that way — and under a theme that raises the framework's base size, every hardcoded icon stays at its old pixel size while the text and chrome around it grow.

This plan defines **five named icon-size steps in the theme's existing `scale` block** ([core/Theme.ts:744-755](packages/lib/src/typescript/lib/core/Theme.ts#L744)) and points every site that makes a free icon-size decision at one of them. Each step is a `ScaleToken` ratio of `scale.base`, so no step is a fixed pixel literal and all five grow together when a theme raises the base. `titleGlyph` and `tabCloseGlyph` are folded into the new steps and removed. Five icons keep their existing derivation on purpose — four whose size is a fit against a host graphic of fixed pixel size, and a `Button`'s leading icon, which already tracks its own label.

Rendered pixel values do not change under any shipped theme: every ratio is chosen to recover its current px at the default base of 14, the same technique [core/themes/BaseTheme.ts:126-137](packages/lib/src/typescript/lib/core/themes/BaseTheme.ts#L126) already uses for the existing tokens.

---

## Architecture Decisions

### The scale lives in `Theme.scale`, not in a new `Util` accessor family

The five steps are added to the theme's `scale` block as `ScaleToken` values, resolved into the numeric `ResolvedScale` snapshot by `resolveScale` ([core/Theme.ts:868-878](packages/lib/src/typescript/lib/core/Theme.ts#L868)) and read at call sites through `ThemeManager.getResolvedScale()` ([core/Theme.ts:1444](packages/lib/src/typescript/lib/core/Theme.ts#L1444)).

That block already exists for exactly this purpose — its own doc comment says "SVG glyph boxes and JS layout constants size off it (CSS `font-size` does not reach an SVG glyph)" — and two of the five steps are already in it under one-owner names. No new mechanism, no new cache, no new invalidation hook.[^why-not-util]

### Five steps, `glyph`-prefixed, T-shirt-suffixed

| Step | Ratio | px at base 14 | What it sizes |
|---|---|---|---|
| `glyphXs` | `8 / 14` | 8 | Ink inside a compact interactive control — a spin arrow, a tab close ✕ |
| `glyphSm` | `12 / 14` | 12 | A small icon inside a larger click target — a calendar nav chevron |
| `glyphMd` | `1` | 14 | An icon matched to bare text with no leading — a combo-box caret, a window title icon |
| `glyphLg` | `16 / 14` | 16 | The default icon: an icon on a full text line box — menu item, dialog title, list / tree / table-cell icons |
| `glyphXl` | `20 / 14` | 20 | A standalone icon read on its own, not beside text — a notification severity badge |

The shared `glyph` prefix groups them in the block and at call sites (`scale.glyphLg`); the T-shirt suffix makes the ordering readable, which a purpose name cannot do.[^why-tshirt] Ratios between steps are theme-invariant, because every step is a ratio of the same base — `glyphSm` is 0.75 × `glyphLg` at any base.

### A site reads a step when its size is a free icon-size choice

Not every number that sizes a glyph is an icon-size decision. Some are a *fit* against a host graphic of fixed pixel size, where the glyph must stay inside a box that does not itself grow with the theme.

| The size is… | Example | Action |
|---|---|---|
| A pixel literal or file constant chosen for the icon itself | `MenuItem`'s `{width: 16, height: 16}` | Read a step |
| Ink fitted inside a host box that already grows with the theme | `SpinButton`'s `8` inside a button whose height is `Util.lineHeightPx() + 6` | Read a step |
| Ink fitted inside a host graphic of fixed pixel size | `Checkbox`'s `12` inside a hardcoded 16×16 box | Leave as-is |
| Already derived per instance from the exact text it must match | `Button`'s leading icon, tracking its own label's line box | Leave as-is |

Row 3 is the one that costs sites: putting the ink on a step while its host stays fixed is what would break it — a 12px check glyph on `glyphSm` inside a 16×16 checkbox box would overflow and clip the moment a theme raises the base.[^fixed-host] Row 4 keeps `Button`'s per-instance proportionality, which a shared step cannot express.[^why-button-stays]

### `titleGlyph` and `tabCloseGlyph` are renamed into the scale, not kept alongside it

`titleGlyph` (`{ scale: 1 }`, 14px) and `tabCloseGlyph` (`{ scale: 8 / 14 }`, 8px) are numerically identical to `glyphMd` and `glyphXs`. Keeping both would leave two names for one size — the duplication this plan removes. Both are deleted from `Theme["scale"]`, `resolveScale`, and `BaseTheme`, and their two consumers read the new steps.[^breaking-tokens] `tabClose` (the close *button box*, not its ink) is unaffected and stays.

### `Glyph`'s own default size resolves per construction

`GLYPH_DEFAULT_SIZE` ([component/display/Glyph.ts:174](packages/lib/src/typescript/lib/component/display/Glyph.ts#L174)) is a module-level literal, frozen when the module loads. It becomes a small function reading `glyphLg`, called from the constructor before `super()`. That fixes the whole tail of sites which never resize their glyph — the tree-row and tree-cell toggles, the table `GlyphCell` / `GlyphRenderer`, `IconText`, `IconLabel` — with no edit at any of them.[^per-construction]

### Each migrated file replaces its constant with a file-local function

A site that reads a step through a module-level `const` would freeze the value at module load, defeating the point. Every migrated file instead gets a file-local function returning the step, named for what it sizes, and the call sites change from `ICON_SIZE` to `iconSizePx()`.

---

## Public API

`Theme["scale"]` ([core/Theme.ts:744-755](packages/lib/src/typescript/lib/core/Theme.ts#L744)) — two members removed, five added:

```typescript
scale: {
    /** Root base size in px; the global scale knob. Mirror of `--ts-ui-base-size`. */
    base          : number;
    /** Icon step — ink inside a compact interactive control (spin arrow, tab close ✕). */
    glyphXs       : ScaleToken;
    /** Icon step — a small icon inside a larger click target (calendar nav chevron). */
    glyphSm       : ScaleToken;
    /** Icon step — an icon matched to bare text with no leading (combo-box caret, window title icon). */
    glyphMd       : ScaleToken;
    /** Icon step — the default icon size: an icon on a full text line box. */
    glyphLg       : ScaleToken;
    /** Icon step — a standalone icon read on its own, not beside text (notification severity badge). */
    glyphXl       : ScaleToken;
    /** Tab close-button box. */
    tabClose      : ScaleToken;
    /** Tab-button inset (the compact inset derives as half of this). */
    tabButtonInset: ScaleToken;
};
```

`ResolvedScale` ([core/Theme.ts:839](packages/lib/src/typescript/lib/core/Theme.ts#L839)) is `{ readonly [K in keyof Theme["scale"]]: number }` and needs no edit of its own — it follows the interface. `resolveScale` ([core/Theme.ts:868-878](packages/lib/src/typescript/lib/core/Theme.ts#L868)) gains one `resolveScaleToken` line per new step and loses the two removed ones.

No component's public constructor, options bag, or getter/setter signature changes.

---

## Internal Structure

### The file-local accessor shape

Every migrated file follows this shape. `component/list/renderer/Glyph.ts` shown; the others differ only in the function name and the step:

```typescript
import { ThemeManager } from "~/core/Theme.js";

/**
 * Square edge length used for the icon glyph — the theme's `glyphLg` icon
 * step (16px at the shipped base). Read per call, not frozen in a module
 * constant, so a theme that raises `scale.base` moves the icon with it.
 */
function iconSizePx(): number {
    return ThemeManager.getResolvedScale().glyphLg;
}
```

Old constant → new function, per file:

| File | Old | New function | Step |
|---|---|---|---|
| `component/list/renderer/Glyph.ts` | `ICON_SIZE` (19) | `iconSizePx()` | `glyphLg` |
| `component/tree/renderer/IconLabel.ts` | `ICON_SIZE` (17) | `iconSizePx()` | `glyphLg` |
| `component/button/SplitButton.ts` | `CHEVRON_SIZE` (26) | `chevronSizePx()` | `glyphLg` |
| `component/table/cell/Header.ts` | `GLYPH_W` / `GLYPH_H` (35, 40) | `headerGlyphPx()` | `glyphLg` |
| `component/container/MenuItem.ts` | inline `16` (280, 644) | `menuIconPx()` | `glyphLg` |
| `overlay/Dialog.ts` | inline `16` (296, 355) | `titleGlyphPx()` | `glyphLg` |
| `component/input/AbstractCalendarDropdown.ts` | `GLYPH_PX` (45) | `navGlyphPx()` | `glyphSm` |
| `overlay/Notification.ts` | `Notification.BADGE_SIZE` (99) | `badgeSizePx()` | `glyphXl` |

`GLYPH_PX` is listed in `AbstractCalendarDropdown.ts`'s trailing `export { … }` block (line 1618) and has no consumer anywhere in the repo; export `navGlyphPx` in its place.

`Notification.BADGE_SIZE` is a `private static readonly` with four uses (189, 621, 627, 628). Delete the field and call `badgeSizePx()` at each; in `doLayout` read it once into a local, since three of the uses are in that one method.

### Sites that read the step directly

Four sites already read the resolved scale, or sit next to a call that does, and need no file-local function:

| File | Line | Change |
|---|---|---|
| `component/button/TabButton.ts` | 342 | `closeScale.tabCloseGlyph` → `closeScale.glyphXs` |
| `component/container/TabBar.ts` | 2536 | `scale.tabCloseGlyph` → `scale.glyphXs` |
| `component/container/WindowHeader.ts` | 234 | `getResolvedScale().titleGlyph` → `.glyphMd` |
| `component/input/SpinButton.ts` | 137 | `this.pinGlyphSize(8)` → `this.pinGlyphSize(ThemeManager.getResolvedScale().glyphXs)`; add the `ThemeManager` import |

### Three `Glyph` subclass default bags become per-construction

`Glyph` itself and two of its subclasses hold their default size in a module-level literal spread into `subclassDefaults`. Each becomes a function called from the constructor. `Glyph` shown:

```typescript
/**
 * The square size an unsized Glyph takes — the theme's `glyphLg` icon step
 * (16×16 at the shipped base). Resolved per construction rather than frozen
 * at module load, so a `setTheme` that runs before the glyph is built is
 * honoured. Used for preferredSize/minSize/maxSize together so the three can
 * never drift apart.
 */
function glyphDefaultSize(): { width: number; height: number } {
    const px = ThemeManager.getResolvedScale().glyphLg;

    return { width: px, height: px };
}

const _defaultGlyphOptions: Partial<GlyphOptions> = {
    tag: "span",
};
```

and in the constructor, after the existing `lookupGlyph` guard and before `super()` (both legal — neither statement touches `this`):

```typescript
const defaultSize = glyphDefaultSize();

super(options, {
    ..._defaultGlyphOptions,
    preferredSize: defaultSize as GlyphOptions["preferredSize"],
    minSize:       defaultSize as GlyphOptions["minSize"],
    maxSize:       defaultSize as GlyphOptions["maxSize"],
    ...(subclassDefaults ?? {}),
});
```

The `subclassDefaults` spread stays last, so a subclass's own size still wins. The class JSDoc's "The default preferred size is 16×16" ([Glyph.ts:203](packages/lib/src/typescript/lib/component/display/Glyph.ts#L203)) becomes "The default preferred size is the theme's `glyphLg` icon step — 16×16 at the shipped base."

The same conversion applies to:

- `COMBOBOX_CARET_GLYPH_SIZE` / `_defaultComboBoxCaretGlyphOptions` ([component/input/ComboBox.ts:583-587](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L583)) → `glyphMd`. `ComboBoxCaret`'s constructor also replaces `Util.lineHeightPx({ linePadding: false })` (line 620) with the same step, which is what sizes both the caret box and `getCaretSize()`.
- `WINDOW_HEADER_TITLE_GLYPH_SIZE` / `_defaultWindowHeaderTitleGlyphOptions` ([component/container/WindowHeader.ts:55-59](packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L55)) → `glyphMd`.

`BUTTON_ICON_GLYPH_SIZE` ([component/button/Button.ts:322](packages/lib/src/typescript/lib/component/button/Button.ts#L322)) is **not** converted — `Button`'s icon is not migrating, so its class-default hint keeps mirroring `_syncGlyphSize`'s own result.

---

## Ordered Implementation Steps

Steps 2-5 must land together: the theme change in step 2 breaks the two token consumers, and `npm run typecheck` is expected to fail from step 2 until step 5 completes.

1. **`packages/lib/tests/unit/core/Theme.test.ts`** — add a `describe('glyph icon-size scale', …)` block with two tests: (a) `ThemeManager.getResolvedScale()` returns `glyphXs: 8`, `glyphSm: 12`, `glyphMd: 14`, `glyphLg: 16`, `glyphXl: 20` under the default theme; (b) the same five keys read 16 / 24 / 28 / 32 / 40 after `ThemeManager.setTheme(defineTheme(BaseTheme, { scale: { base: 28 } }))`, restoring `ModernTheme` in an `afterEach` (the file's existing `shipped theme objects are well-formed` block shows the import shape); and (c) `## Expected Behaviour` row 3 — a theme with `{ scale: { base: 28, glyphXl: { fixed: 20 } } }` leaves `glyphXl` at `20` while the other four still scale.
   *Check:* `npx vitest run tests/unit/core/Theme.test.ts` from `packages/lib` — all three fail (keys don't exist).

2. **`packages/lib/src/typescript/lib/core/Theme.ts`** — in the `scale` interface (744-755) delete `titleGlyph` and `tabCloseGlyph` and add the five `glyph*` members with the doc comments from `## Public API`; in `resolveScale` (868-878) make the matching swap, one `resolveScaleToken(theme.scale.glyphXx, base)` line per step.

3. **`packages/lib/src/typescript/lib/core/themes/BaseTheme.ts`** — in the `scale` block (131-137) delete the `titleGlyph` and `tabCloseGlyph` lines and add the five ratios, keeping the existing `current-px ÷ base` comment style:
   ```typescript
   glyphXs       : { scale:  8 / 14 },  // compact control ink was 8px
   glyphSm       : { scale: 12 / 14 },  // small icon in a larger target was 12px
   glyphMd       : { scale: 1 },        // 14 ÷ 14 — text-matched icon == base
   glyphLg       : { scale: 16 / 14 },  // default icon was 16px
   glyphXl       : { scale: 20 / 14 },  // standalone badge icon was 20px
   ```
   Update the block's leading comment (126-130) so its `titleGlyph is { scale: 1 }` sentence names `glyphMd` instead.
   *Check:* `npx vitest run tests/unit/core/Theme.test.ts` — all three step 1 tests green.

4. **`packages/lib/src/typescript/lib/component/container/WindowHeader.ts`** — `resolveTitleGlyphInk` (234) reads `.glyphMd`; its JSDoc and the comment at 48-54 lose the `titleGlyph` name; `WINDOW_HEADER_TITLE_GLYPH_SIZE` becomes the per-construction function from `## Internal Structure`.

5. **`packages/lib/src/typescript/lib/component/button/TabButton.ts` (342) and `packages/lib/src/typescript/lib/component/container/TabBar.ts` (2536)** — read `.glyphXs`.
   *Check:* `npm run typecheck` — green again. `grep -rn 'titleGlyph\|tabCloseGlyph' packages/lib/src/typescript/` → zero matches (`_titleGlyph`, a private field in `WindowHeader` and `Dialog`, is a different identifier and will not match the whole-word pattern; use `grep -rnw`).

6. **`packages/lib/tests/component/display/Glyph.test.ts`** — add one test: under `defineTheme(BaseTheme, { scale: { base: 28 } })` applied via `setTheme`, a newly constructed `new Glyph('unicode-arrow-up').getPreferredSize()` is `{width: 32, height: 32}`; restore `ModernTheme` afterwards.
   *Check:* fails (still 16×16).

7. **`packages/lib/src/typescript/lib/component/display/Glyph.ts`** — apply the `glyphDefaultSize()` conversion and the JSDoc edit from `## Internal Structure`.
   *Check:* `npm run typecheck`; step 6's test green; `npx vitest run tests/component/default-options-fallback.test.ts` — the existing `Glyph minSize` row still reads `{width:16,height:16}` (the default theme is unchanged).

8. **Create `packages/lib/tests/component/GlyphIconScale.test.ts`** — one file covering `## Expected Behaviour` rows 6-9. Shape: install the test DOM, then a `describe` per base (default, and `base: 28` applied via `setTheme` in `beforeEach` with `ModernTheme` restored in `afterEach`). Assert `new SpinButton('▲').getGlyph()!.getPreferredSize()`, `(new ComboBox() as any)._caret.getCaretSize()`, `new WindowHeader('Title').getGlyph()!.getPreferredSize()`, and `new TabButton('A', { closeable: true }).getCloseButton()!.getGlyph()!.getPreferredSize()` against the row 6-8 values. Add row 9's guards in the same file: at base 28, `(new Checkbox() as any)._check`, `(new RadioButton() as any)._dot`, and `(new Scrollbar('vertical', { arrowsEnabled: true }).getComponents()[1] as any)._glyph` still report `12` / `8` / `12` (the same access paths `tests/component/default-options-fallback.test.ts` uses at lines 349 and nearby), and a `TableHeader`'s `getMenuButton().getGlyph()` still reports `8` (build the table the way `tests/component/table/HeaderMenuButton.test.ts` does). Copy the harness setup from `tests/component/input/SpinButton.test.ts` and the `setTheme` / `afterEach(() => ThemeManager.setTheme(ModernTheme))` pattern from `tests/component/table/HeaderThemeReflow.test.ts` (lines 29, 54).
   *Check:* the base-28 `SpinButton` and `ComboBox` cases fail; the `WindowHeader` and `TabButton` cases already pass (steps 4-5 landed them); every row 9 guard already passes.

9. **`packages/lib/src/typescript/lib/component/input/SpinButton.ts`** — `pinGlyphSize(ThemeManager.getResolvedScale().glyphXs)`, plus the import. Reword the comment above the call (129-136) so it no longer states a literal 8.
   *Check:* `npx vitest run tests/component/input/SpinButton.test.ts`; step 8's SpinButton cases green.

10. **`packages/lib/src/typescript/lib/component/input/ComboBox.ts`** — convert `COMBOBOX_CARET_GLYPH_SIZE` and replace `ComboBoxCaret`'s `Util.lineHeightPx({ linePadding: false })` (620) with `glyphMd`, per `## Internal Structure`. Remove the `Util` import only if nothing else in the file uses it.
    *Check:* `npm run typecheck`; `npx vitest run tests/component/input/ComboBox.test.ts`; step 8's ComboBox cases green.

11. **`packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts`** — `GLYPH_PX` → `navGlyphPx()` (`glyphSm`), including the trailing `export { … }` block at 1618.

12. **The six `glyphLg` files** — `component/container/MenuItem.ts`, `overlay/Dialog.ts`, `component/button/SplitButton.ts`, `component/table/cell/Header.ts`, `component/list/renderer/Glyph.ts`, `component/tree/renderer/IconLabel.ts`. One file-local function each, per `## Internal Structure`'s table. In `table/cell/Header.ts` the single function replaces both `GLYPH_W` and `GLYPH_H` (they are the same number), including the `offset = GLYPH_W + GLYPH_GAP + themePad` arithmetic at 378. `SplitButton`'s `CHEVRON_SIZE` doc comment (20-25) claims the size is "Pinned … so the dropdown affordance stays a constant … size across themes" — that is now false; reword it to say the chevron sits on the theme's default icon step.
    *Check:* `npm run typecheck`; `npx vitest run --no-file-parallelism` for the touched areas.

13. **`packages/lib/src/typescript/lib/overlay/Notification.ts`** — delete the `BADGE_SIZE` static and route its four uses through `badgeSizePx()`, reading it into a local at the top of `doLayout` (615).

14. **Regression greps.**
    ```
    grep -rnw 'titleGlyph\|tabCloseGlyph' packages/lib/src packages/lib/tests   # zero
    grep -rn 'ICON_SIZE\|CHEVRON_SIZE\|GLYPH_W\|GLYPH_H\|GLYPH_PX\|BADGE_SIZE' packages/lib/src/typescript/lib   # zero
    grep -rn 'width: 16, height: 16' packages/lib/src/typescript/lib/component/container/MenuItem.ts packages/lib/src/typescript/lib/overlay/Dialog.ts   # zero
    ```

15. **Run the full suite.** `npx vitest run --no-file-parallelism` from `packages/lib`. Every existing size assertion should still pass unchanged — the default theme resolves every step to the value the site hardcoded before.

16. **Docs and changelog.** See `## Documentation Impact`.

17. **Manual browser verification.** Non-negotiable — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Theme.ts` |
| Modify | `packages/lib/src/typescript/lib/core/themes/BaseTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Glyph.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/WindowHeader.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/TabButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/SpinButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/MenuItem.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/SplitButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/renderer/Glyph.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/renderer/IconLabel.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Notification.ts` |
| Modify | `packages/lib/tests/unit/core/Theme.test.ts` |
| Modify | `packages/lib/tests/component/display/Glyph.test.ts` |
| Create | `packages/lib/tests/component/GlyphIconScale.test.ts` |
| Modify | `packages/lib/docs/concepts/theming.md` |
| Modify | `packages/lib/docs/components/StatusBar.md` |
| Create | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-9 are unit-testable offline: `ThemeManager.getResolvedScale()` reads a snapshot resolved from a plain object at module load, so it needs no DOM, and `setTheme` works against the recording sink the way the existing theme-reflow tests use it. Rows 10-11 need a live browser.

| # | Case | Expected |
|---|---|---|
| 1 | `ThemeManager.getResolvedScale()` under the shipped default theme | `glyphXs: 8`, `glyphSm: 12`, `glyphMd: 14`, `glyphLg: 16`, `glyphXl: 20` |
| 2 | Same, after `setTheme(defineTheme(BaseTheme, { scale: { base: 28 } }))` | `16`, `24`, `28`, `32`, `40` — each `round(28 × ratio)` |
| 3 | Same, for a theme pinning one step: `{ scale: { base: 28, glyphXl: { fixed: 20 } } }` | `glyphXl: 20`; the other four still scale to `16` / `24` / `28` / `32` |
| 4 | `new Glyph('unicode-arrow-up').getPreferredSize()` at the default base | `{width: 16, height: 16}` — unchanged from before this plan |
| 5 | Same, constructed after the base-28 theme is set | `{width: 32, height: 32}` |
| 6 | `new SpinButton('▲').getGlyph()!.getPreferredSize()` | `8×8` at the default base; `16×16` at base 28 |
| 7 | `(new ComboBox() as any)._caret.getCaretSize()` | `14` at the default base; `28` at base 28 |
| 8 | `new WindowHeader('Title').getGlyph()!.getPreferredSize()` | `14×14` at the default base; `28×28` at base 28 |
| 9 | At base 28: a `Checkbox`'s check glyph, a `RadioButton`'s dot, a `Scrollbar` arrow glyph, a `TableHeader` menu-button glyph, a `Button`'s leading icon | Unchanged sizing rules — `12` / `8` / `12` / `8`, and the `Button` icon still equal to `round(its own label's line height)`. None of the five is on a step; see `## Non-Goals` |
| 10 | Manual — live app under the shipped theme: menu items, dialog title bars, split-button chevrons, table column-header glyphs, glyph list rows, tree icon rows, calendar pickers, notifications, spinners, combo boxes, window title bars, closeable tabs | Every icon renders at exactly its pre-change size and position |
| 11 | Manual — same screens after `setTheme` with `scale.base: 28` | Every migrated icon has grown proportionally; nothing clips, overlaps its neighbour, or spills out of its container |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariants — step 14's three greps, each expecting zero matches.

**Manual browser verification (rows 10-11) is required.** The offline harness records writes; it does not run a CSS cascade, so nothing in it can show a clipped or overlapping icon.

- Start a dev server on a spare port from *this worktree* (symlink `node_modules` to the repo root first if this worktree has none), and confirm what it serves with `readlink /proc/<pid>/cwd` before trusting anything the browser shows.
- Row 10: visit `#/misc` and open a window with a table, a tree table, and a title glyph; then the `Tab` tab (closeable tabs), a screen with a `NumberSpinner` and a `ComboBox`, a date picker, a context menu, and a `SplitButton`; fire a notification. Read computed `width`/`height` on one icon of each kind and confirm each matches the pre-change value from `## Architecture Decisions`' step table.
- Row 11: from the browser console, `ThemeManager.setTheme(defineTheme(BaseTheme, { scale: { base: 28 } }))`, then re-walk the same screens. Components constructed *before* the call keep their old size unless their owner re-pins (`WindowHeader` and `TabBar` do; see `## Potential Challenges`) — so reopen each window and re-render each screen after the theme change rather than judging stale instances.

---

## Documentation Impact

No exported symbol is added or removed except the `Theme["scale"]` members, which are part of the public `Theme` interface and therefore appear in the generated API docs automatically. The five new members carry the doc comments from `## Public API`; `npm run docs:api` must still finish with zero warnings.

`packages/lib/docs/concepts/theming.md` needs three edits:

- Line 144 lists the built-in ratio tokens as "(`titleGlyph`, `tabClose`, `tabCloseGlyph`, `tabButtonInset`)" — replace with the new set, and add one sentence naming the five `glyph*` members as an ordered icon-size scale with the px-at-base-14 table from `## Architecture Decisions`.
- Line 151's example reads `ThemeManager.getResolvedScale().titleGlyph` — change to `.glyphMd` and keep the surrounding "ink === 14 … base 28 → 28" commentary, which stays correct.
- The "Raise `scale.base` … to scale the chrome that follows it — window and tab title glyphs, tab close buttons, and tab insets" sentence understates the new coverage; extend the list to "every framework icon, window and tab title glyphs, tab close buttons, and tab insets".

`packages/lib/docs/components/StatusBar.md` line 33 tells consumers to "call `pinGlyphSize(14)`" — add "or `pinGlyphSize(ThemeManager.getResolvedScale().glyphMd)` to track the theme" so the consumer-facing advice matches the framework's own.

**Create `packages/lib/docs/reference/changelog/next.md`** — the file was folded into `0.7.0.md` at release, but `packages/docs/src/content/pages.ts:353` and `packages/lib/docs/reference/changelog/index.md:7` both still link to it, so it is currently a dead link. Follow `0.7.0.md`'s heading shape (`# Next`, then `## Breaking changes` / `## Changed`, each with `### Core` / `### Components` subsections) and add:

> **Breaking — Core.** The theme `scale` block's `titleGlyph` and `tabCloseGlyph` tokens are gone, replaced by a five-step icon scale: `glyphXs` (8px at the default base), `glyphSm` (12px), `glyphMd` (14px, the old `titleGlyph`), `glyphLg` (16px, the default icon size), and `glyphXl` (20px). A custom theme that set either removed token should set `glyphMd` / `glyphXs` instead; a theme that set neither needs no change.
>
> **Changed — Components.** Every framework icon that previously hardcoded its pixel size now reads one of the five named icon steps, so raising `scale.base` scales icons along with the rest of the chrome. Sizes under the shipped themes are unchanged. The icons still sized against a fixed host graphic — a checkbox's check, a radio button's dot, a scrollbar arrow, a table header's menu icon — and a `Button`'s leading icon, which tracks its own label's line box, are deliberately not on the scale.

---

## Potential Challenges

- **Whether an existing glyph follows a theme change depends on where its step is read.** A step read inside `doLayout` — `MenuItem`, `Dialog`, `Notification`, `table/cell/Header`, and the list and tree renderers — re-resolves on the next layout pass, so those icons follow a theme change for free. A step read once at construction — `Glyph`'s own default, `SpinButton`, `ComboBoxCaret`, `AbstractCalendarDropdown`, `SplitButton` — does not, unless the owner re-pins (`WindowHeader.updatePreferredSize` and `TabBar.positionCloseButtons` already do). This plan does not add re-pinning where it is absent (see `## Non-Goals`). Mitigation for the manual check: re-render a screen after switching themes rather than reading a stale instance.
- **Steps 2-5 leave the build red in between.** Deleting the two theme tokens breaks their consumers by construction. The step list says so explicitly; do not "fix" the intermediate typecheck failure by re-adding a token.
- **`styleGroup` rule content is seeded by whichever instance renders first in a process.** `SpinButton`, `TabButton`'s ✕ and `TableHeader`'s menu icon each own a `styleGroup` token from `plans/implemented/glyph-icon-size-dedup.md`. After a mid-session theme change, later instances whose resolved value no longer matches the cached group content fall back to a real per-instance `#id` write — correct output, slightly less dedup. Pre-existing behaviour of that mechanism, not introduced here.
- **The notification toast box is not on the scale.** `Notification`'s 320×64 body, its paddings, and its 12px `badgeY` stay fixed pixels, so a large base grows the badge inside a box that does not grow. At base 28 the badge is 40px in a 64px-tall toast with a 12px top offset — it fits, but the margin is thin. Sizing the whole toast is out of scope; row 11's manual check covers a notification specifically.
- **`Glyph.applyOptions` re-pins `minSize`/`maxSize` from `getPreferredSizeConstraint()`.** A `subclassDefaults`-supplied size does not survive construction as-is; this is why `default-options-fallback.test.ts`'s `ButtonIconGlyph minSize` row reads `{16,16}` rather than `{14,14}`. That row still reads `{16,16}` after this plan, because `glyphLg` is 16 at the default base — do not "correct" it.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/core/Theme.ts` | `ScaleToken` (47), the `scale` block (744-755), `resolveScaleToken` (853-860), `resolveScale` (868-878), `getResolvedScale` (1444) — the whole mechanism this plan extends |
| `packages/lib/src/typescript/lib/core/themes/BaseTheme.ts` | The `scale` block (126-137) and its `current-px ÷ base` comment convention — the only place any shipped theme authors these ratios |
| `packages/lib/src/typescript/lib/component/container/WindowHeader.ts` | `resolveTitleGlyphInk` (225-235) and the `updatePreferredSize` re-pin (219-222) — the model for a site that reads the scale *and* follows a theme change |
| `packages/lib/src/typescript/lib/component/container/TabBar.ts` | `positionCloseButtons`' per-layout re-pin (2528-2547) — the other such model, and one of the two `tabCloseGlyph` consumers |
| `packages/lib/src/typescript/lib/component/display/Glyph.ts` | `GLYPH_DEFAULT_SIZE` / `_defaultGlyphOptions` (171-186), the constructor (256-286), `applyOptions`' size re-pin (652-666) — read before converting the default |
| `packages/lib/src/typescript/lib/core/Util.ts` | `linePaddingPx` / `rootFontSizePx` / `lineHeightPx` (114-186) — the *other* theme-quantity pattern, rejected here; read to see why its cache/invalidation discipline is not needed for a scale token |
| `packages/lib/src/typescript/lib/component/input/Checkbox.ts` | `CHECKBOX_CHECK_SIZE` (120-128) and the constructor's hardcoded 16×16 box plus `setX(1)`/`setY(1)` centring (226-234) — the clearest instance of the fixed-host case this plan leaves alone |
| `packages/lib/src/typescript/lib/component/button/Button.ts` | `_syncGlyphSize` (1666-1716) and `pinGlyphSize` (1835) — why the leading icon stays on its own per-instance derivation, and the escape hatch every migrated `Button`-hosted site uses |
| `plans/implemented/glyph-icon-size-dedup.md` | The direct precedent over the same call sites, including the Non-Goal this plan deliberately reverses |
| `packages/lib/docs/concepts/theming.md` | "Base size & scaling" (138-152) — the consumer-facing contract the new steps join |

---

## Non-Goals

- **The CSS-rule dedup that these newly-shared sizes make possible.** Once several sites compute from one named step, they become good candidates for the `StyleTrait` mechanism in `plans/cross-class-style-groups.md` — one declared style bag shared across unrelated classes as a single CSS rule — because they would finally share real design intent rather than a coincidentally equal number. That plan is unimplemented, this plan does not need it, and neither blocks the other: this one changes *what number* each icon computes, that one changes *how* a number reaches the stylesheet. Deferred deliberately, not forgotten.
- **Icons fitted inside a fixed-pixel host graphic.** `Checkbox`'s check (12 inside a hardcoded 16×16 box with a hardcoded 1px centring offset), `RadioButton`'s dot (8 inside the same box), `Scrollbar`'s arrow glyph (`TRACK_WIDTH`, 12), and `TableHeader`'s menu-button glyph (`TRACK_WIDTH − MENU_BUTTON_CHROME_PX`, 8). Moving the ink onto a step while the host stays fixed is what would break them. The follow-up that unblocks all four is putting the *hosts* on the same scale — the checkbox/radio box on `glyphLg`, `TRACK_WIDTH` (31 uses across four files) on `glyphSm` — after which each ink joins its step for free, because step-to-step ratios are theme-invariant.
- **`Button`'s leading icon.** It already tracks its own label's line box per instance, which is strictly more specific than a global step and is what makes a button with a custom font size get a proportionate icon. Its `pinGlyphSize` escape hatch is how a caller opts a specific button onto a fixed size, and three migrated sites use exactly that.
- **Re-pinning existing instances on a theme change.** A step is read when a size is written. Adding a theme listener to every icon owner is a separate change with its own listener-teardown cost.
- **A `Util`-namespace accessor per step.** Rejected in `## Architecture Decisions`; the resolved-scale snapshot is the accessor.
- **Theming the notification toast box, the `Notification` paddings, or `SpinButton`'s hardcoded 18px width.** Adjacent fixed pixels, none of them a glyph size.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^why-not-util]: The alternative was a `Util` family mirroring `lineHeightPx` / `rootFontSizePx` / `linePaddingPx` ([core/Util.ts:114-186](packages/lib/src/typescript/lib/core/Util.ts#L114)) — one exported function per step, reading `--ts-ui-base-size` through `DOM.source.getThemeVar`, caching the parse, and clearing on `invalidateTextMetricsCache`. Rejected on three counts. It would be a second path to a number `ThemeManager` already holds resolved, so the two could disagree after a theme change if the invalidation hook were ever missed. Those `Util` functions exist because a *text metric* genuinely has to be measured or parsed out of the cascade — a glyph box does not; `resolveScale` multiplies it out of a plain object at `setTheme` time with no probe and no cache to invalidate. And the `scale` block is already where two glyph sizes live, so putting three more of them somewhere else would split one concept across two modules. The `Util` pattern is still the right one for anything font-derived; this is not.

[^why-tshirt]: Purpose names (`glyphCompact`, `glyphDense`, `glyphStandalone`) were considered, matching the block's existing `titleGlyph` / `tabClose` / `tabButtonInset` style. They lose on ordering: nothing in `glyphCompact` versus `glyphDense` says which is larger, and a five-member ramp is read as a ramp. The existing names describe one-off purposes with no sibling to compare against, which is why they read fine and these would not. Numeric names (`glyph8`, `glyph16`) were rejected outright — a name that states a pixel value is exactly the fixed-pixel thinking this plan removes, and would be a lie the moment a theme raises the base.

[^fixed-host]: `Checkbox`'s box is `this._box.setSize({ width: 16, height: 16 })` with the check glyph placed at `setX(1)`/`setY(1)`, an offset derived from `(14 − 12) / 2` against the 14×14 padding edge inside the box's 1px border ([component/input/Checkbox.ts:226-234](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L226)). `RadioButton`'s ring is the same 16×16. `Scrollbar`'s arrow glyph is `setPreferredSize({ width: TRACK_WIDTH, height: TRACK_WIDTH })` inside a `TRACK_WIDTH`-square button ([component/container/Scrollbar.ts:213-234](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L213)), and `TableHeader`'s menu button fills the vertical-scrollbar reservation band of exactly `TRACK_WIDTH` ([component/table/Header.ts:39-45](packages/lib/src/typescript/lib/component/table/Header.ts#L39)). In all four the host is a fixed pixel constant, so a theme-relative ink would grow past a host that does not — a clipped check mark, an arrow overflowing its track, a menu button wider than the band it must not overlap. The four are not a permanent exclusion: because every step is a ratio of one base, `glyphSm / glyphLg` is 0.75 at any base, so putting the hosts on the scale later lets each ink join its step with the fit ratio preserved exactly.

[^why-button-stays]: `Button._syncGlyphSize` ([component/button/Button.ts:1689-1716](packages/lib/src/typescript/lib/component/button/Button.ts#L1689)) sizes the leading icon to `round(this._text.getLineHeight())` — the button's *own* label line box, re-run from `recomputePreferredSize` on every theme change. Under the shipped themes that resolves to 14 (button font `base − 2` = 12, plus `linePadding` 2), identical to `glyphMd`, but the two are equal by arithmetic coincidence of two theme tokens rather than by design: a theme with `linePadding: 4px` would put the button icon at `base + 2` while `glyphMd` stays at `base`. Replacing the sync with a step read would be a real regression for a button carrying a per-instance font size, whose icon would stop matching its own text — and would delete the `_glyphSyncedSize` / `_glyphSizePinned` bookkeeping that lets `pinGlyphSize` opt a specific button out. The site's formula is not ad hoc; it is the same design intent ("the icon matches the text beside it") resolved per instance instead of per theme.

[^per-construction]: `GLYPH_DEFAULT_SIZE` feeds `preferredSize` / `minSize` / `maxSize` in `_defaultGlyphOptions`, which the constructor spreads into `super`'s `subclassDefaults` argument. The object is re-read on every construction but its *contents* are fixed when the module loads — before any application `setTheme` has run — so a module constant reading the scale would pin every glyph in the process to the default theme's 16. Resolving inside the constructor costs one property read on an already-resolved snapshot. Statements before `super()` are legal in a derived constructor as long as they do not touch `this`, which the existing `const def = lookupGlyph(name)` guard already relies on. The sites this fixes without touching them are the ones that never set a size at all: `TreeRow`'s and `TreeCell`'s expand toggles (both read `this._toggle.getPreferredSize()`), the table `GlyphCell` / `GlyphRenderer`, `IconText`, and `IconLabel`.

[^breaking-tokens]: Removing a member from `Theme["scale"]` is a breaking change for a custom theme that set it: a theme literal is a `DeepPartial<Theme>`, so `scale: { titleGlyph: { fixed: 20 } }` becomes an excess-property error rather than a silent no-op. Keeping the two as aliases was considered and rejected — two names resolving to one size is the precise duplication this plan exists to remove, and an alias would have to be kept in sync by hand in `resolveScale` forever. No test, no app screen, and no doc page other than `theming.md` references either name, so the blast radius is one docs edit plus a changelog entry. The library is pre-1.0 (0.7.0), and the changelog's `## Breaking changes` section is the established channel for exactly this.
