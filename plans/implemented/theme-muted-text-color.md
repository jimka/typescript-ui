---
touches-shared:
  - packages/lib/src/typescript/lib/core/Theme.ts
  - packages/lib/src/typescript/lib/core/themes/ModernTheme.ts
  - packages/lib/src/typescript/lib/core/themes/ClassicTheme.ts
  - packages/lib/src/typescript/lib/core/themes/DarkTheme.ts
  - packages/lib/docs/concepts/theming.md
  - packages/lib/docs/reference/changelog/next.md
---

# Theme Muted Text Colour — Implementation Plan

## Overview

`Theme` has one text colour, [`text.color`](../packages/lib/src/typescript/lib/core/Theme.ts#L96). It has no theme-wide colour for de-emphasised text: a file path beside a file name, a hint line, a count, an inactive label, placeholder-like secondary text. Loom, a consumer app, hard-codes `rgb(140, 140, 140)` for three such labels. That grey reads 3.08 : 1 on the light toolbar, below WCAG AA's 4.5 : 1 for normal text. Inside the library, the `List` / `MultiSelectList` empty-state placeholder borrows the *disabled* row colour for the same purpose and reads 2.32 : 1.

This plan adds one palette token, **`text.mutedColor`**, emitted as **`--ts-ui-text-muted-color`**, with a value in each built-in theme that clears 4.5 : 1 on every surface background of that theme. It switches exactly one library consumer to it: the list empty-state placeholder in [`AbstractSelectableList.buildEmptyPlaceholder`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1175). Every other site that paints secondary text is listed under `## Non-Goals` as a follow-up.

Touched: the `Theme` interface and `themeToVars` in [`core/Theme.ts`](../packages/lib/src/typescript/lib/core/Theme.ts), the three theme literals under [`core/themes/`](../packages/lib/src/typescript/lib/core/themes/), `AbstractSelectableList.ts`, two test files, the Theming and List doc pages, and the changelog staging page.

---

## Architecture Decisions

### Add the token the way `gutter.hoverBackground` was added

The most recent theme-token addition is `gutter.hoverBackground` (commits `32d2455f3` code, `065e9746f` docs). That addition established the path this plan follows:

1. A required field on the `Theme` interface, with a one-line JSDoc — [`Theme.ts:240`](../packages/lib/src/typescript/lib/core/Theme.ts#L240).
2. One row in `themeToVars`, placed next to its sibling — [`Theme.ts:1054`](../packages/lib/src/typescript/lib/core/Theme.ts#L1054).
3. A literal value in each of `ModernTheme`, `ClassicTheme` and `DarkTheme`. Nothing goes in `BaseTheme`, which holds only scheme-invariant structural tokens.
4. A row in the *Theme keys* table of [`theming.md`](../packages/lib/docs/concepts/theming.md#L36), plus a mention on the consuming component's page.

This plan adds what that precedent lacked: tests, and a changelog entry.[^precedent-gaps]

### Name: `text.mutedColor` → `--ts-ui-text-muted-color`

The token lives in the existing `text` bucket beside `text.color`. It follows the `<role>Color` leaf pattern that every other secondary text colour in `Theme` already uses.[^naming]

| Existing leaf | CSS variable |
|---|---|
| `form.disabledColor` | `--ts-ui-form-disabled-color` |
| `menuBar.item.shortcutColor` | `--ts-ui-menu-bar-item-shortcut-color` |
| **`text.mutedColor`** (new) | **`--ts-ui-text-muted-color`** |

### A new global token, not a promoted component token

No theme-wide muted colour exists under another name. The nearby values are each scoped to one component, tuned for that component's surface, and different from one another, so none can be promoted.[^no-internal-value]

| Existing token | Modern / Classic | Dark | Why it isn't the muted token |
|---|---|---|---|
| `button.description.foreground` | `rgb(110, 110, 110)` | `rgb(160, 160, 160)` | A `Button`'s second line; sits on the button fill |
| `menuBar.item.shortcutColor` | `rgb(140, 140, 140)` | `rgb(140, 140, 140)` | Menu shortcut hint; same in both schemes; 3.36 : 1 on white |
| `chart.label` | `rgb(85, 85, 85)` / `rgb(80, 80, 80)` | `rgb(192, 192, 192)` | SVG axis labels |
| `statusBar.color` | `rgb(60, 60, 60)` | `rgb(200, 200, 200)` | The status bar's primary text, not secondary |
| `*.disabledColor` | `rgb(170, 170, 170)` | `rgb(100, 100, 100)` – `rgb(120, 120, 120)` | Means "not interactive"; 2.32 : 1 on white by design |

The existing component tokens keep their current values. This plan does not re-point them at the new token (see `## Non-Goals`).

### Values: `rgb(100, 100, 100)` light, `rgb(160, 160, 160)` dark

| Theme | `text.mutedColor` |
|---|---|
| `ModernTheme` | `'rgb(100, 100, 100)'` |
| `ClassicTheme` | `'rgb(100, 100, 100)'` |
| `DarkTheme` | `'rgb(160, 160, 160)'` |

Both values already appear in the palettes: `rgb(100,100,100)` is the light themes' `collapse.button.color` and `accordion.indicator.color`, and `rgb(160, 160, 160)` is Dark's `button.description.foreground` and `collapse.button.color`.[^value-choice]

Measured contrast (WCAG 2.x relative luminance; a translucent row fill is composited over the list background first):

| Theme | Surface (token) | Background | Ratio |
|---|---|---|---|
| Modern, Classic | `body`, `input`, `list`, `popover`, `contextMenu`, `autoComplete` | `rgb(255, 255, 255)` | **5.92** |
| Modern, Classic | `toolBar`, `statusBar`, `menuBar` | `rgb(245, 245, 245)` | **5.43** |
| Modern, Classic | `tab.toolbar`, `window.header` | `#eee` | **5.10** |
| Modern, Classic | selected list row (`rgba(30, 100, 200, 0.18)` on white) | — | 4.56 |
| Dark | `body` | `rgb(30, 30, 30)` | **6.38** |
| Dark | `input`, `list` | `rgb(40, 40, 40)` | **5.64** |
| Dark | `tab.toolbar`, `window.header` | `#2a2a2a` | **5.49** |
| Dark | `toolBar`, `statusBar`, `menuBar`, `contextMenu`, `autoComplete` | `rgb(45, 45, 45)` | **5.27** |
| Dark | `popover` | `rgb(50, 50, 55)` | **4.88** |
| Dark | selected list row (`rgba(100, 140, 220, 0.28)` on `rgb(40, 40, 40)`) | — | 3.76 |

Every **bold** row is a plain surface background and is checked by a unit test (see `## Expected Behaviour`). The two selected-row figures are for information only. A dark selected row falls short of 4.5 : 1, and that is accepted.[^dark-selected-row]

Against its own theme's `text.color`, the muted colour is 3.55 : 1 (light) and 1.91 : 1 (dark), so it still reads as a step down from normal text.

### Required field, no fallback in `themeToVars`

`text.mutedColor` is a required `string`, like every other palette token. `themeToVars` emits `theme.text.mutedColor` directly, with no `??` fallback.[^required-no-fallback] What a custom theme sees:

| How the custom theme is built | Result |
|---|---|
| `defineTheme(ModernTheme \| ClassicTheme \| DarkTheme, { … })` without the key | Inherits the base theme's value |
| `defineTheme(BaseTheme, { … })` without the key | `--ts-ui-text-muted-color` holds the literal `undefined`, as for any palette token it forgets ([theming.md:213](../packages/lib/docs/concepts/theming.md#L213)). A `color: var(--ts-ui-text-muted-color, …)` then falls back to the inherited text colour, not the `var()` fallback |
| A full `const t: Theme = { … }` object literal | Compile error until `text.mutedColor` is added |

The changelog entry tells the last two groups to add the key.

### Switch the list empty-state placeholder in this plan; nothing else

`buildEmptyPlaceholder` changes from `var(--ts-ui-list-row-disabled-color, rgb(170, 170, 170))` to `var(--ts-ui-text-muted-color, rgb(100, 100, 100))`. The disabled-row rule at [`AbstractSelectableList.ts:277-283`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L277) keeps the disabled token.[^switch-list-only]

The `var()` fallback is `ModernTheme`'s value, as at every other consumer site (e.g. [`StatusBar.ts:62`](../packages/lib/src/typescript/lib/component/container/StatusBar.ts#L62)).

---

## Public API

```typescript
// packages/lib/src/typescript/lib/core/Theme.ts — inside `export interface Theme`
text: {
    color: string;
    /**
     * De-emphasised text colour for secondary text that must stay readable:
     * a path beside a name, a hint, a count, an inactive label, an
     * empty-state placeholder. Not a disabled colour; the built-in values
     * meet 4.5 : 1 against every surface background of their theme.
     */
    mutedColor: string;
};
```

CSS custom property written by `ThemeManager.setTheme` on `:root`: `--ts-ui-text-muted-color`. No new export, no new class, no new option.

---

## Internal Structure

The contrast check in `Theme.test.ts` needs a small colour parser and the WCAG 2.x luminance formula. Use this shape; it handles the only two colour forms the surface tokens use (`rgb(r, g, b)` and `#rgb` / `#rrggbb`):

```typescript
// WCAG 2.x AA minimum contrast for normal-size text.
const AA_NORMAL_TEXT = 4.5;

/** Parses `rgb(r, g, b)`, `#rgb` or `#rrggbb` into 0–255 channels. */
function parseColor(value: string): [number, number, number] {
    const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(value);

    if (rgb) {
        return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    }

    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);

    if (!hex) {
        throw new Error(`unsupported colour form: ${value}`);
    }

    const digits = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];

    return [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2.x relative luminance of an sRGB colour. */
function luminance([r, g, b]: [number, number, number]): number {
    // sRGB linearisation and channel weights are the constants WCAG 2.x defines.
    const lin = (c: number): number => {
        const s = c / 255;

        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };

    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours, always >= 1. */
function contrast(a: string, b: string): number {
    const la = luminance(parseColor(a));
    const lb = luminance(parseColor(b));

    // 0.05 is WCAG's flare term, added to both luminances.
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The plain surface backgrounds muted text is expected to sit on. */
const SURFACES: ReadonlyArray<[string, (t: Theme) => string]> = [
    ['body.background',         t => t.body.background],
    ['input.background',        t => t.input.background],
    ['list.background',         t => t.list.background],
    ['popover.background',      t => t.popover.background],
    ['contextMenu.background',  t => t.contextMenu.background],
    ['autoComplete.background', t => t.autoComplete.background],
    ['toolBar.background',      t => t.toolBar.background],
    ['statusBar.background',    t => t.statusBar.background],
    ['menuBar.background',      t => t.menuBar.background],
    ['tab.toolbar.background',  t => t.tab.toolbar.background],
    ['window.header.background', t => t.window.header.background],
];
```

The `setTheme` case reads the recording sink. `ThemeManager.setTheme` writes every variable in one `apply` on the document element, so the test takes the last such write that carries the key:

```typescript
const root = DOM.source.getDocumentElement();
const writes = (DOM.sink as RecordingDOMSink).writes
    .filter(w => w.op === 'apply' && w.args[0] === root)
    .map(w => (w.args[1] as { style?: Record<string, string | null> }).style ?? {})
    .filter(style => '--ts-ui-text-muted-color' in style);

expect(writes.at(-1)?.['--ts-ui-text-muted-color']).toBe(expected);
```

---

## Ordered Implementation Steps

All paths are relative to `packages/lib/`. Run commands from `packages/lib/` unless noted.

1. **Tests first — `tests/unit/core/Theme.test.ts`.**
   - Update the header comment (lines 1–7): name the new `setTheme` block as a second exception that installs a test DOM, beside the glyph block.
   - Add `type RecordingDOMSink` to the existing `../../dom/TestDOM` import.
   - Add the helpers and `SURFACES` from `## Internal Structure` below the imports.
   - Add `describe('text.mutedColor', …)` with the DOM-free cases M1–M4 from `## Expected Behaviour`, after the `'shipped theme objects are well-formed'` block.
   - Add `describe('text.mutedColor reaches :root', …)` with case M5. Copy the glyph block's `beforeEach(() => installTestDOM(DOM_CONFIG))` and its `afterEach` (`ThemeManager.setTheme(ModernTheme); DOM.reset();`).
   - Check: `npx vitest run tests/unit/core/Theme.test.ts` → M1, M2, M3 and M5 fail (`undefined`). M4 already passes and stays a guard. `npm run typecheck:test` fails on `text.mutedColor` until step 3. That failure is expected.

2. **Tests first — `tests/component/list/EmptyState.test.ts`.** Add case L1 after the `'emptyText on an empty list adds one filling Text placeholder…'` case. Check: `npx vitest run tests/component/list/EmptyState.test.ts` → L1 fails with the disabled-token string; the other cases pass.

3. **`src/typescript/lib/core/Theme.ts` — interface.** In `export interface Theme`, replace the `text` block at lines 96–98 with the `## Public API` block (adds `mutedColor` and its JSDoc after `color`).

4. **`src/typescript/lib/core/Theme.ts` — `themeToVars`.** Directly after the `'--ts-ui-text-color'` row (line 999), add:
   ```typescript
   '--ts-ui-text-muted-color'                 : theme.text.mutedColor,
   ```
   Pad the key column to line up with its neighbours.
   Check: `npm run typecheck` passes. The theme literals go through `defineTheme`'s `DeepPartial` input, so the missing values are not a compile error.

5. **`src/typescript/lib/core/themes/ModernTheme.ts` line 21.** Change to `text       : { color: 'rgb(0, 0, 0)', mutedColor: 'rgb(100, 100, 100)' },`.

6. **`src/typescript/lib/core/themes/ClassicTheme.ts` line 21.** Same edit as step 5.

7. **`src/typescript/lib/core/themes/DarkTheme.ts` line 19.** Change to `text       : { color: 'rgb(220, 220, 220)', mutedColor: 'rgb(160, 160, 160)' },`.
   Check: `npx vitest run tests/unit/core/Theme.test.ts` → all green.

8. **`src/typescript/lib/component/list/AbstractSelectableList.ts`.**
   - Line 1182: change the argument to `"var(--ts-ui-text-muted-color, rgb(100, 100, 100))"`.
   - Line 1171, the `buildEmptyPlaceholder` JSDoc: change "using the list-scoped disabled token" to "painted in the theme's muted text colour".
   - Leave the `.SelectableListRow.disabled` rule (lines 277–283) unchanged.
   - Check: `npx vitest run tests/component/list/EmptyState.test.ts` → all green. `grep -n "list-row-disabled-color" src/typescript/lib/component/list/AbstractSelectableList.ts` → exactly one match (the disabled-row rule).

9. **Code checks.** `npm run typecheck`, `npm run typecheck:test`, `npm run lint` — all clean.

10. **`docs/concepts/theming.md`.**
    - After the `text.color` row (line 36), add:
      `` | `text.mutedColor` | `--ts-ui-text-muted-color` | De-emphasised text that must stay readable — a path beside a name, a hint, a count, an inactive label, a [`List`](/api/component/list/classes/List)'s empty-state placeholder. Built-in values meet WCAG AA (4.5 : 1) on every surface background of their theme. Not a disabled colour | ``
    - After the `::: info Blue is the single accent colour` block (ends line 119), add a tip block:
      ````markdown
      ::: tip Muted text for secondary labels
      Paint secondary text with `--ts-ui-text-muted-color` rather than a hard-coded grey or a `disabledColor` token, so it follows the theme and stays readable:

      ```typescript
      import { Text } from '@jimka/typescript-ui/component/input';

      const path = Text('src/shell', { foregroundColor: 'var(--ts-ui-text-muted-color)' });
      ```
      :::
      ````

11. **`docs/components/List.md` line 224.** Replace the last sentence ("`--ts-ui-list-row-disabled-color` colours both the empty-state placeholder and a [disabled row](#disabled-rows)'s label and glyph.") with:
    "`--ts-ui-list-row-disabled-color` colours a [disabled row](#disabled-rows)'s label and glyph. The empty-state placeholder uses the theme-wide muted text colour, `--ts-ui-text-muted-color` (see [Theming](/concepts/theming#theme-keys))."

12. **`docs/reference/changelog/next.md`.** Below the intro paragraph, add the two sections and entries in `## Documentation Impact`, in the order `## Changed` → `### Components`, then `## Added` → `### Core` (the order `0.11.0.md` uses).

13. **Docs build.** From the repo root: `npm run docs:api` → 0 errors, 0 warnings. Then `npm run docs:llms:check` → passes, then `npm run docs:llms` → `git diff --exit-code packages/lib/llms.txt` shows no change.

14. **Full suite.** From the repo root: `npm test` → green (run after step 13, because `links.test.ts` reads the regenerated `docs/api`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Theme.ts` |
| Modify | `packages/lib/src/typescript/lib/core/themes/ModernTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/core/themes/ClassicTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/core/themes/DarkTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Modify | `packages/lib/tests/unit/core/Theme.test.ts` |
| Modify | `packages/lib/tests/component/list/EmptyState.test.ts` |
| Modify | `packages/lib/docs/concepts/theming.md` |
| Modify | `packages/lib/docs/components/List.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases below are unit-testable offline.

| # | Case | Expected |
|---|---|---|
| M1 | `ModernTheme.text.mutedColor`, `ClassicTheme.text.mutedColor`, `DarkTheme.text.mutedColor` | `'rgb(100, 100, 100)'`, `'rgb(100, 100, 100)'`, `'rgb(160, 160, 160)'` |
| M2 | For each built-in theme and each entry of `SURFACES`: `contrast(theme.text.mutedColor, surface(theme))` | `>= 4.5`. Name the theme and surface in the test title (`it.each`) so a failure points at the pair |
| M3 | `defineTheme(DarkTheme, { text: { color: 'rgb(255, 255, 255)' } }).text.mutedColor` | `'rgb(160, 160, 160)'` — overriding a sibling leaf keeps the inherited muted value |
| M4 | `BaseTheme.text` | `undefined` — `BaseTheme` carries no palette, so a theme built on it must supply `text.mutedColor` itself |
| M5 | After `ThemeManager.setTheme(theme)` for each of `ModernTheme`, `ClassicTheme`, `DarkTheme` | The last recorded `apply` on the document element that carries `--ts-ui-text-muted-color` holds that theme's `text.mutedColor` |
| L1 | `new TestList({ emptyText: 'None' })`, then `(list.innerChildren()[0] as _Text).getForegroundColor()` | `'var(--ts-ui-text-muted-color, rgb(100, 100, 100))'` |

Unchanged behaviour the existing suites already cover: the `EmptyState.test.ts` cases for placeholder presence, toggling and `emptyComponent` precedence, and the `.SelectableListRow.disabled` rule still painting `--ts-ui-list-row-disabled-color`.

**Manual check** (the computed colour is not visible offline): start the dev app (`npm run dev`, `localhost:8015`; check which tree the running server serves before trusting it). Open the Misc demo and use its theme-cycle button ([`MiscPanel.ts:900`](../packages/lib/src/typescript/MiscPanel.ts#L900)). After each theme switch, run `getComputedStyle(document.documentElement).getPropertyValue('--ts-ui-text-muted-color')` in DevTools. Expect `rgb(100, 100, 100)` for Modern and Classic and `rgb(160, 160, 160)` for Dark.

---

## Verification

- `npm run typecheck` and `npm run typecheck:test` (from `packages/lib/`) — clean.
- `npm run lint` — clean.
- `npx vitest run tests/unit/core/Theme.test.ts tests/component/list/EmptyState.test.ts` — M1–M5 and L1 green.
- `grep -rn "mutedColor" packages/lib/src/typescript/lib/core` → the interface field, the `themeToVars` row, and one line in each of the three theme files.
- `grep -n "list-row-disabled-color" packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` → one match (the disabled-row rule).
- `npm run docs:api` → 0 errors, 0 warnings. `npm run docs:llms:check` passes. `npm run docs:llms` leaves `packages/lib/llms.txt` unchanged.
- `npm test` (repo root, after `docs:api`) — green.
- The manual DevTools check in `## Expected Behaviour`.

---

## Documentation Impact

- **API reference.** `Theme` is already exported from the `core` barrel and documented. The new field's JSDoc renders on `/api/core/interfaces/Theme` with no further work. The JSDoc links nothing, so it cannot add a TypeDoc warning.
- **`docs/concepts/theming.md`.** One *Theme keys* row and one tip block (step 10).
- **`docs/components/List.md`.** The *Theme tokens* sentence about the placeholder (step 11).
- **`llms.txt`.** No change expected: the manifest carries `Theme`'s one-line summary, and this plan does not change it. Step 13's commands confirm it.
- **`docs/reference/changelog/next.md`.** Add, below the intro paragraph:

  ```markdown
  ## Changed

  ### Components

  - **A `List` or `MultiSelectList` empty-state placeholder is painted in
    the theme's new muted text colour.** It borrowed the disabled-row colour,
    `list.row.disabledColor`, which reads 2.32 : 1 against the light themes'
    list background and 2.49 : 1 against the dark one. It now uses
    `text.mutedColor` (see *Added*), at 5.92 : 1 and 5.64 : 1. A theme that
    recoloured the placeholder through `list.row.disabledColor` now does so
    through `text.mutedColor`; disabled rows still use
    `list.row.disabledColor`.

  ## Added

  ### Core

  - **`Theme.text.mutedColor`, written to `:root` as
    `--ts-ui-text-muted-color`** — a theme-wide colour for de-emphasised
    text that must stay readable, such as a path beside a name, a hint, a
    count or an inactive label. It is `rgb(100, 100, 100)` in `ModernTheme`
    and `ClassicTheme` and `rgb(160, 160, 160)` in `DarkTheme`, and each
    meets WCAG AA's 4.5 : 1 against every surface background of its theme.
    A theme made with `defineTheme` from a built-in theme inherits it. A
    theme made from `BaseTheme`, or written as a full `Theme` object, must
    add `text.mutedColor`: a full object no longer typechecks without it.
  ```

- **Migration.** No `docs/reference/migration/next.md` note.[^no-migration-note]

---

## Potential Challenges

- **`typecheck:test` is red between steps 1 and 3.** The new tests read `text.mutedColor` before the interface declares it. Proceed to step 3; do not cast around it.
- **`ThemeManager` is a process-wide singleton.** A failing M5 assertion could leave Dark active for later tests. The copied `afterEach` restores `ModernTheme` whatever happens.
- **The last-write lookup in M5.** Other code may `apply` to the document element (for example `colorScheme`, `fontSize`). Filter by the key, as in `## Internal Structure`, and do not index by position.
- **`docs/api` is gitignored and goes stale.** A stale local build makes `links.test.ts` report false dangling links. Run `npm run docs:api` before `npm test`.
- **The dev server may serve another worktree.** Check `readlink /proc/<pid>/cwd` before the manual check. Start a second server rather than stopping someone else's.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Theme.ts`](../packages/lib/src/typescript/lib/core/Theme.ts) — the `Theme` interface (`text` at line 96, `gutter` precedent at line 237) and `themeToVars` (line 990).
- [`packages/lib/src/typescript/lib/core/themes/ModernTheme.ts`](../packages/lib/src/typescript/lib/core/themes/ModernTheme.ts), [`ClassicTheme.ts`](../packages/lib/src/typescript/lib/core/themes/ClassicTheme.ts), [`DarkTheme.ts`](../packages/lib/src/typescript/lib/core/themes/DarkTheme.ts) — the three palettes; the surface tokens the contrast test reads.
- [`packages/lib/src/typescript/lib/core/themes/BaseTheme.ts`](../packages/lib/src/typescript/lib/core/themes/BaseTheme.ts) — confirms palette tokens do not belong here.
- Commits `32d2455f3` and `065e9746f` (`git show`) — the precedent addition, code and docs.
- [`packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1168) — `buildEmptyPlaceholder`, and the disabled-row rule at line 277 that must not change.
- [`packages/lib/tests/unit/core/Theme.test.ts`](../packages/lib/tests/unit/core/Theme.test.ts) — the glyph block (line 99) is the model for the DOM-tier block.
- [`packages/lib/tests/component/list/EmptyState.test.ts`](../packages/lib/tests/component/list/EmptyState.test.ts) — `TestList.innerChildren()` seam.
- [`packages/lib/tests/dom/TestDOM.ts`](../packages/lib/tests/dom/TestDOM.ts#L540) — `RecordingDOMSink.writes` shape.
- [`packages/lib/docs/concepts/theming.md`](../packages/lib/docs/concepts/theming.md) and [`packages/lib/docs/reference/changelog/0.11.0.md`](../packages/lib/docs/reference/changelog/0.11.0.md) — table format and changelog entry style.

---

## Non-Goals

- **Re-pointing other secondary-text sites at the new token.** These are follow-ups, each with its own surface and contrast check:
  - `CodeEditor`'s `.cm-placeholder`, `.cm-diagnosticSource`, `.cm-completionDetail` and `.cm-completionIcon` read `--ts-ui-autocomplete-item-disabled-color` ([`editor/theme.ts:206, 290, 318, 321`](../packages/lib/src/typescript/lib/component/editor/theme.ts#L206)). They sit on the editor and completion-popup surfaces.
  - `button.description.foreground` ([`Button.ts:1397`](../packages/lib/src/typescript/lib/component/button/Button.ts#L1397)) and `menuBar.item.shortcutColor` / `contextMenu` shortcut text ([`MenuItem.ts:293`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L293)) keep their own tokens and values. Re-valuing them as `var(--ts-ui-text-muted-color)` in the built-in themes would change their look.
- **Changing any `disabledColor` token.** Disabled text is meant to recede below AA; it is a different role.
- **A `muted` option or setter on `Text` / `Label`.** Consumers use `foregroundColor: 'var(--ts-ui-text-muted-color)'`, the same way they use every other token.
- **Meeting 4.5 : 1 on a dark selected row.** Muted text there reaches 3.76 : 1 (see the contrast table under *Values*).
- **Loom's own labels.** Loom switches its three hard-coded greys after it upgrades to a release that carries this token.
- **`--ts-ui-form-text`.** [`FileField.ts:254`](../packages/lib/src/typescript/lib/component/input/FileField.ts#L254) and [`FileDropZone.ts:80`](../packages/lib/src/typescript/lib/component/input/FileDropZone.ts#L80) reference a variable no theme emits (the emitted one is `--ts-ui-form-color`), so both always fall back to `inherit`. Unrelated to this plan; reported here, not fixed.

---

## Notes

[^precedent-gaps]: `32d2455f3` added no theme test and `065e9746f` added no changelog entry: `gutter.hoverBackground` appears in no released changelog page. No test anywhere asserts what `themeToVars` emits for any token. This plan adds tests because the project works test-first and a contrast claim is only worth stating if a test keeps it true. It adds a changelog entry because `next.md` is now the staging page for every consumer-visible change.

[^naming]: Alternatives considered: `text.muted` (the name Loom's TODO used informally), `text.secondary`, `text.subtle`. `text.muted` would be a bare-adjective leaf, which `Theme` uses for background states (`table.row.selected`) but not for text colours. "Secondary" already means the right mouse button in this codebase (`resolveContextMenuTarget.ts`) and reads like a "secondary button" style. "Muted" is the word the code already uses for this role: `AbstractSelectableList`'s `emptyText` JSDoc says "Muted placeholder text", and Loom's `WelcomeScreen.ts` calls its hint "a muted grey".

[^no-internal-value]: Searched: every `*Color` / `foreground` / `label` leaf in `Theme`; every `setForegroundColor(...)` and `color:` literal under `packages/lib/src/typescript/lib`; `::placeholder` (none — inputs use the browser's own placeholder colour); `Markdown` (quote and rule use `--ts-ui-border-color` only, no muted text); `Tree` (no secondary text styling). The closest semantic match, `button.description.foreground`, has different light values from the chosen token and belongs to `Button`'s two-line layout. Promoting it would make a button-specific name the theme-wide answer.

[^value-choice]: The light value had to clear 4.5 : 1 on the darkest light surface, `#eee` (`tab.toolbar`, `window.header`). Measured candidates on `#eee`: `rgb(110, 110, 110)` 4.39, `rgb(105, 105, 105)` 4.73, `rgb(100, 100, 100)` 5.10. `rgb(100, 100, 100)` also clears the light selected list row (4.56), where `rgb(105, 105, 105)` does not (4.23), and it is already a light-palette value. The dark value had to clear 4.5 : 1 on the lightest dark surface, `popover` `rgb(50, 50, 55)`. Measured there: `rgb(150, 150, 150)` 4.31, `rgb(155, 155, 155)` 4.59, `rgb(160, 160, 160)` 4.88. `rgb(160, 160, 160)` gives margin and is already a dark-palette value. For reference, Loom's current `rgb(140, 140, 140)` measures 3.36 on white, 3.08 on `rgb(245, 245, 245)` and 2.90 on `#eee` in the light themes, and 3.79 on the dark popover.

[^dark-selected-row]: A muted label inside a selected `DarkTheme` list row sits on `rgba(100, 140, 220, 0.28)` over `rgb(40, 40, 40)`, about `rgb(57, 68, 90)`. Clearing 4.5 : 1 there needs at least `rgb(176, 176, 176)`, which narrows the gap to the dark `text.color` `rgb(220, 220, 220)` to about 1.5 : 1, so muted text would stop reading as muted on every other surface. A consumer that keeps secondary text inside selected rows can switch it to the row's selected colour while selected. The light themes' selected row passes (4.56).

[^required-no-fallback]: Every palette token in `Theme` is required, and `defineTheme`'s JSDoc (`Theme.ts:830`) says completeness is the theme author's job. The only `??` fallbacks in `themeToVars` serve fields the interface marks optional (`font.size`, the per-side tab borders). Making `mutedColor` optional with a derived fallback (for example `color-mix(in srgb, var(--ts-ui-text-color) 60%, transparent)`) was considered. It was rejected: it would be the first optional palette token, it would make `ThemeManager.getTheme().text.mutedColor` possibly `undefined` for JS readers, and the built-in themes would still need explicit values to guarantee the measured contrast.

[^switch-list-only]: The list placeholder is switched here because its own JSDoc already calls it "muted placeholder text", it fails AA by a wide margin today (2.32 : 1 light, 2.49 : 1 dark), and it gives the new token a real consumer inside the library that a test can pin. The `CodeEditor` sites are left as follow-ups because they live in the CodeMirror theme, sit on different surfaces (editor body, completion popup) that need their own contrast pass, and Loom sees them directly, so a change there deserves its own visual check. Re-valuing `button.description.foreground` and the menu shortcut colour would change how existing apps look with no reported problem.

[^no-migration-note]: Earlier required palette tokens (`gutter.hoverBackground`, `table.filterRow.background`, `table.cell.rangeSelectedBackground`) were added with no migration note. The documented and recommended way to build a theme is `defineTheme`, whose `DeepPartial` input does not fail to compile. The rare full-object case is covered by one sentence in the *Added* entry. The 0.8.0 migration note on theme tokens was written for a removal (`titleGlyph` / `tabCloseGlyph`), which breaks every theme that set them; an addition does not.

---

## Implementation Notes

- **M5 pins the document-element handle.** The plan's lookup filtered recorded writes by `w.args[0] === root`, which assumes a stable handle. The offline `DOMSource.getDocumentElement()` mints a fresh handle on every call (`tests/dom/TestDOM.ts`, `_table.mint('html')`), so the filter matched nothing. The test now pins one handle with `vi.spyOn(DOM.source, 'getDocumentElement').mockReturnValue(root)` before `setTheme`, which is the precedent in `SpatialNavigation.test.ts`, `FocusTraversal.test.ts` and `RevealInScrollingPage.test.ts`. The `afterEach` adds `vi.restoreAllMocks()`. M5 also compares against literal expected values rather than `theme.text.mutedColor`: before the implementation, both sides were `undefined` and the case passed vacuously. A mutation check (deleting the `themeToVars` row) turns all three M5 cases red.
- **`text.mutedColor` is optional, falling back to `text.color` (user decision in audit).** As first built the token was required, which broke a consumer's full `Theme` object (TS2741), so the branch carried a Breaking entry and a migration note. The user chose an optional token instead, following the `font.size ?? '14px'` and `borderBottom ?? border` fallbacks already in `themeToVars`: the field is `mutedColor?: string` and the variable gets `theme.text.mutedColor ?? theme.text.color`, so nothing breaks and the Breaking entry and migration note are gone. M5 gained a case for a hand-written theme without the key (it writes the text colour, and it is the type-level check that the key is optional).
- **Built-in values changed to meet the documented contrast on every surface (audit, user decision).** The audit found the plan's `SURFACES` list was a subset: DarkTheme's `rgb(160, 160, 160)` fell below 4.5 : 1 on its tooltip, tab buttons, accordion header and table header, while the docs claimed every surface. The list now adds `tooltip`, `tab.button` (and its hover), `accordion.header` and `table.header`, and checks each colour stop of a gradient. Widening it showed ClassicTheme's `rgb(100, 100, 100)` also failing on its gradient tab and header surfaces (down to 3.04 : 1). The user chose `rgb(180, 180, 180)` for DarkTheme (lowest 4.55 : 1, table header) and `rgb(74, 74, 74)` for ClassicTheme (lowest about 4.56 : 1, the tab button's bottom stop); ModernTheme keeps `rgb(100, 100, 100)` (lowest 4.68 : 1). The cost is less separation from normal text: 1.51 : 1 against DarkTheme's text and 2.37 : 1 against ClassicTheme's black, versus 1.91 and 3.55 before. The placeholder figures in the changelog are now 5.92, 8.86 and 7.11 : 1.
- **Changelog placement.** `next.md` already held `## Breaking changes`, `## Changed`, `## Added` and `## Fixed` sections from the branches below this one in the stack. The plan's step 12 assumed it would add fresh `## Changed` / `## Added` sections below the intro paragraph. Instead, the entries went into the existing sections: the placeholder entry is the last item under `## Changed` → `### Components`, and a new `### Core` subsection sits under `## Added` between `### Components` and `### Layouts`, following 0.11.0.md's order.
- **The contrast claim names its surfaces (audit round 2).** Even the widened `SURFACES` list is not every background: with the shipped values, fills such as `button.hover` / `button.pressed`, `notification.*`, `table.sortBadge`, `table.filterRow`, `toggle.selected`, `drag.ghost` and the validation-error tooltip fall below 4.5 : 1 (down to 3.33 : 1 on DarkTheme's button-hover stop). No muted grey that still reads as muted clears them all, so the JSDoc, theming.md and the changelog now name the surfaces the test covers (page, inputs, lists, menus and popovers, bars, tab strips and tabs, window / accordion / table headers, tooltips) and say fills are not covered, instead of claiming every surface. Round 3 added `menuBar.panel.background` (the panel of a menu opened from a menu bar), so the "menus" claim covers both menu kinds. With `rgb(180, 180, 180)` the dark selected-row case the plan listed as a non-goal now passes (4.71 : 1); the plan body's figures for it predate the value change.
- **Test helpers carry full JSDoc** (`@param` / `@returns` / `@throws`), per CODE_CONVENTIONS. The plan's sketch had one-line summaries.
- **No demo was added.** The plan names none, and the token has no visual surface beyond the list placeholder that the existing List demos already show.
- **Rebase-clean checkpoint.** This branch is stacked on `feature/dock-reveal-panel-without-focus`, so it was not rebased onto master.
- **Manual check — run.** A private dev server was started on port 8028 from this worktree (cwd verified) and stopped afterwards. The page was opened in Chrome DevTools MCP, and `ThemeManager.setTheme` was driven through the dev server's own `Theme.ts` module, not through the Misc demo's theme-cycle button. `getComputedStyle(document.documentElement).getPropertyValue('--ts-ui-text-muted-color')` read `rgb(100, 100, 100)` initially, `rgb(100, 100, 100)` after `ClassicTheme`, `rgb(160, 160, 160)` after `DarkTheme`, and `rgb(100, 100, 100)` after `ModernTheme`. That run used the first values; the audit's value changes are pinned offline by M5's literal expectations.
- **Verification run.** `typecheck` and `typecheck:test` are clean. `lint` is clean. `docs:api` emits 0 warnings. `docs:llms:check` passes, and `docs:llms` leaves `llms.txt` unchanged. `npm test` passes: 639 files and 28102 tests. The `packages/docs` tests pass against a fresh `build:lib`: 13 files and 2617 tests. `list-row-disabled-color` has exactly one match in `AbstractSelectableList.ts`, and `mutedColor` appears in the five expected places under `core/`.
