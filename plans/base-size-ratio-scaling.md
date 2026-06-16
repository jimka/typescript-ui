# Base Size → Ratio Scaling — Implementation Plan

## Overview

Establish ONE root base size as the framework's global scale knob, exposed two
ways from a single source of truth: as a **CSS custom property** (so CSS sizes
can be written `rem`/`calc`-relative to it) and as a **JS number** (so layout
math and SVG glyph boxes can compute `px = round(base × ratio)`). This delivers
the "Phase 2 numeric theme-token surface" that
[`tab-font-relative-sizing.md`](implemented/tab-font-relative-sizing.md#L134)
explicitly sketched and deferred — that plan shipped the measured-button strip
thickness (Phase 1) and named "insets, close-button, close-glyph need a numeric
token surface" as the blocked follow-on
([tab-font-relative-sizing.md:134-191](implemented/tab-font-relative-sizing.md#L134)).

The base already half-exists. `theme.font.size` is a CSS length string
([Theme.ts:47](../src/typescript/lib/core/Theme.ts#L47)), `themeToVars` emits it
as `--ts-ui-font-size`
([Theme.ts:702](../src/typescript/lib/core/Theme.ts#L702)), and
`ProgressSpinner.readThemeFontSizePx()` already parses that var back to a JS
number ([ProgressSpinner.ts:29-35](../src/typescript/lib/component/display/ProgressSpinner.ts#L29)).
What is missing is (1) a *named, framework-owned* base var distinct from the
control font-size so the scale root is explicit and the app needn't own
`:root { font-size }`, (2) a **shared** JS reader other code can call (today's
reader is a private copy inside `ProgressSpinner`), and (3) **ratio-derived
tokens** for the font-coupled px constants that currently can't follow the scale
— the window title glyph pinned to `LEAD_GLYPH_INK_SIZE = 14`
([WindowHeader.ts:29](../src/typescript/lib/component/container/WindowHeader.ts#L29))
and the tab close-button / close-glyph / insets in `TabBar`
([TabBar.ts:43-56](../src/typescript/lib/component/container/TabBar.ts#L43)).

Scope: [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts)
(the base var + a shared reader + ratio block), the two motivating consumers
[`WindowHeader.ts`](../src/typescript/lib/component/container/WindowHeader.ts)
and [`TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts), the
shared base values in
[`BaseTheme.ts`](../src/typescript/lib/core/themes/BaseTheme.ts), and the core
barrel/docs for the new exported reader. Migration is phased: a cheap CSS-only
layer (text + char-mode glyphs already inherit the var; formalize the base var)
ships and verifies first, then the numeric layer for SVG glyph boxes and JS
constants.

---

## Architecture Decisions

### The crux — SVG glyphs ignore CSS `font-size`, so the JS number is mandatory

Almost every framework glyph is SVG (`glyphs/solid/*`), rendered as
`<svg><use href="#…"/></svg>`
([Glyph.ts:633-647](../src/typescript/lib/component/display/Glyph.ts#L633)). An
SVG glyph is **not** sized by CSS `font-size`; it is sized by its px
`preferredSize` box — `Glyph.setPreferredSize(w, h)` pins min/pref/max
([Glyph.ts:280-286](../src/typescript/lib/component/display/Glyph.ts#L280)), and
the laid-out box scales the `viewBox`. `Glyph.setFontSize` is explicitly a
char-mode-only affordance and a documented no-op for SVG
([Glyph.ts:327-342](../src/typescript/lib/component/display/Glyph.ts#L327)).
Therefore `rem`/`em` in CSS does **not** reach SVG glyph boxes — they need a px
**number** derived from the base. This is exactly why dual exposure (not CSS
alone) is the core primitive: char-mode glyphs and text scale through the CSS
var for free; SVG glyph boxes and JS layout constants must read the base as a
number and multiply by a ratio. This crux is the load-bearing justification for
the whole plan.

### One base, two views — a framework-owned `--ts-ui-base-size` plus a shared `readBaseSizePx()`

The single source of truth is the theme's base size, declared once. To keep the
CSS view and the JS view from diverging, both derive from the same theme token:

- **CSS view:** a new framework-owned custom property `--ts-ui-base-size`,
  emitted by `themeToVars` from the base token. Keeping it distinct from
  `--ts-ui-font-size` (the *control* font-size) means the scale root is named
  explicitly and the framework does not depend on the app owning
  `:root { font-size }` — components reference `--ts-ui-base-size` directly via
  `calc(N * var(--ts-ui-base-size))`, not the ambiguous `rem` unit (see next
  decision). For the first pass the base value equals `theme.font.size`
  (`14px`), so nothing visually shifts; the var simply formalizes today's
  implicit knob.
- **JS view:** a new **exported** `readBaseSizePx(): number` in `Theme.ts` that
  parses `--ts-ui-base-size` off the document root, mirroring the proven
  `ProgressSpinner.readThemeFontSizePx` body
  ([ProgressSpinner.ts:29-35](../src/typescript/lib/component/display/ProgressSpinner.ts#L29))
  with the same `parseFloat` + `NaN`→fallback guard. This replaces the private
  per-component copy and gives `TabBar`/`WindowHeader` one reader.

Both views read the same custom property, so there is exactly one source of
truth at runtime; the theme object's base token is the source of truth at
config time.

### Use the explicit base var, NOT raw CSS `rem`

The settled decision is "root-relative, not em" — but root-relative is achieved
through the framework's own `--ts-ui-base-size`, not the CSS `rem` unit. `rem`
resolves against `:root`'s `font-size`, which `ThemeManager.setTheme` *does*
currently write
([Theme.ts:1031](../src/typescript/lib/core/Theme.ts#L1031)) — but tying the
framework scale to `document.documentElement.style.fontSize` couples it to a
property the host app may legitimately own and override. A named
`--ts-ui-base-size` is root-relative (it lives on `:root`), predictable (no
`em`-style compounding through nesting), and decoupled from the app's font-size
choices. CSS sizes scale via `calc(<ratio> * var(--ts-ui-base-size))`; the JS
reader parses the same var. (`em` is rejected per the settled decisions —
it compounds through nesting; a single root knob with explicit per-token ratios
stays predictable.)

### Ratios live in the theme as a numeric block; px is derived at read time

Add a numeric `scale` block to the `Theme` interface holding the base plus the
font-coupled ratios — the first **numbers** in a theme surface that has been
all-strings to date (verified: every `themeToVars` entry stringifies a string
token, and even `--ts-ui-table-cell-height`
([Theme.ts:794](../src/typescript/lib/core/Theme.ts#L794)) is emitted as a CSS
var, never parsed in JS). `table.cell.padding: number`
([Theme.ts:311](../src/typescript/lib/core/Theme.ts#L311)) is the lone existing
numeric token, but it is consumed as a JS number and never emitted as a var — so
it is precedent that numbers can live in `Theme`, not a counter-example. The
`scale` block:

```ts
/** A scaled size: `{ scale }` is a ratio of the base (grows with it); `{ fixed }` is absolute px. */
type ScaleToken = { scale: number } | { fixed: number };

scale: {
    /** Root base size in px; the global scale knob. Mirror of --ts-ui-base-size. */
    base:           number;       // 14
    /** Window/tab title-glyph ink. */
    titleGlyph:     ScaleToken;   // { scale: 1 }      (or { fixed: 20 } to pin)
    /** Tab close-button box. */
    tabClose:       ScaleToken;   // { scale: 16/14 }
    /** Tab close-glyph ink. */
    tabCloseGlyph:  ScaleToken;   // { scale: 8/14 }
    /** Tab-button inset (compact derives from this). */
    tabButtonInset: ScaleToken;   // { scale: 4/14 }
}
```

Each non-`base` token is a `ScaleToken` discriminated union: `{ scale: n }` is a
**ratio of the base** (scales with it) and `{ fixed: px }` is an **absolute
size** that opts out of scaling — the theme-level escape hatch (see *Theme-level
px override*). Exactly one form is present, enforced by the type — no runtime
guard, no string parsing. For the ratio case, px is `round(scale.base ×
n)`, never stored pre-multiplied, so re-resolving on a base change is one
multiply. `scale.base` is the JS mirror of
`--ts-ui-base-size`; the live runtime read still goes through `readBaseSizePx()`
(the CSS var) so JS and CSS never diverge mid-session, while `scale.base` is the
config-time declaration `themeToVars` emits the var from. The compact inset
keeps its existing relationship to the non-compact inset
(`TAB_BUTTON_INSET_COMPACT = 2` is half of `4`
[TabBar.ts:53-56](../src/typescript/lib/component/container/TabBar.ts#L53)),
derived as `round(resolveScaleToken(tabButtonInset, base) / 2)` rather than a
second ratio token — fewer knobs, same result, and correct whether the inset
token is a `{ scale }` ratio or a `{ fixed }` px.

Ratios are **not** emitted through `themeToVars` (they are JS-only multipliers);
only `--ts-ui-base-size` is emitted. A consumer wanting a CSS-side scaled size
writes `calc(<ratio> * var(--ts-ui-base-size))` with a literal ratio.

### Scaled-vs-fixed token split (settled — enforce it)

**Scales with the base** (migrate): text and char-mode glyphs (already inherit
the font var — formalized via `--ts-ui-base-size` in the CSS layer), SVG glyph
boxes, and the font-coupled JS layout constants — the window title glyph
`LEAD_GLYPH_INK_SIZE`
([WindowHeader.ts:29](../src/typescript/lib/component/container/WindowHeader.ts#L29)),
and tab `CLOSE_BUTTON_SIZE` / `CLOSE_GLYPH_SIZE` / `TAB_BUTTON_INSET`(`_COMPACT`)
([TabBar.ts:43-56](../src/typescript/lib/component/container/TabBar.ts#L43)).

**Stays fixed px** (do NOT migrate): hairlines and borders, the 2px
`TabReorderBar.THICKNESS`
([TabBar.ts:337](../src/typescript/lib/component/container/TabBar.ts#L337), 2px
reorder bar, fixed by design), focus rings (the framework pins focus indicators
at `2px solid`
[Theme.ts:131-137](../src/typescript/lib/core/Theme.ts#L131)), the indicator
thickness, and any device-pixel detail. Do not add cosmetic breathing room while
migrating (project no-cosmetic-padding rule). `SCROLL_ARROW_SIZE` and
`STRIP_THICKNESS`/`SCROLL_ARROW_STEP` are out of scope — they were settled by
the implemented tab plan (the strip thickness is now measured from the button,
the arrow gutter stays fixed
[tab-font-relative-sizing.md:120-132](implemented/tab-font-relative-sizing.md#L120)).

### Theme-level px override — a `ScaleToken` union, exactly-one enforced by the type

A theme author must be able to pin a token to a fixed px *that does not scale
with the base* — not just express ratios. So every non-`base` `scale` token is a
`ScaleToken = { scale: number } | { fixed: number }`: `{ scale: 1 }` is a **ratio**
of the base (grows with it) and `{ fixed: 20 }` is **absolute px** (stays put).

A discriminated union is chosen over a `number | string` overload and over two
optional sibling fields (`*Scale?` / `*Fixed?`) deliberately: the union makes
"exactly one of scale/fixed" a **compile-time** guarantee — you cannot construct
both, and you cannot omit both — so there is no runtime validation to write and
no NaN-on-wrong-form footgun. It is also self-documenting at the call site
(`{ scale: 1 }` vs `{ fixed: 20 }`) where `1` vs `"14px"` was implicit. The
tokens stay **required** (every theme provides each via `BaseTheme`, per the
`defineTheme` completeness contract); they are not optional-with-base-fallback,
because the non-unit defaults (close button `16/14`, close glyph `8/14`, inset
`4/14`) have no sensible "fall back to 1× base" meaning — a wrapping scheme that
wants a different value overrides the token, and inherits `BaseTheme`'s default
otherwise.

All resolution goes through one exported helper so both arms are handled
identically everywhere a token is read:

```ts
/**
 * Resolves a scale token to px: `{ scale }` is a ratio of `base`
 * (`round(base * scale)`, grows with it); `{ fixed }` is absolute px. Call at
 * layout/render time with the live base.
 */
export function resolveScaleToken(token: ScaleToken, base: number): number;
// 'scale' in token ? Math.round(base * token.scale) : token.fixed
```

`{ scale: 1 }` and `{ fixed: 14 }` both yield `14` at the default base, but the
first grows with the base and the second stays pinned — that is the theme-level
escape hatch.

### Consumer-level explicit-px escape hatch also stays

Independently of the theme tokens, the migration only changes *defaults*: every
touched setter remains explicit-px capable. `Glyph.setPreferredSize(w, h)` still
accepts literal px, `Button.pinGlyphSize(px)`
([Button.ts:1030](../src/typescript/lib/component/button/Button.ts#L1030)) still
takes a px number, and `WindowHeader.setGlyph` still pins a concrete size. A
call site that wants a fixed glyph passes a literal; the ratio path is the
default, not a mandate. Two layers of opt-out: the **theme** pins a token via a
`{ fixed: px }` form; a **call site** bypasses the token entirely by passing
literal px.

### Reads happen at layout/render time, re-resolve on theme change

Per the implemented `defer-construction-time-theme-reads` rule
([defer-construction-time-theme-reads.md:10-22](implemented/defer-construction-time-theme-reads.md#L10)),
`readBaseSizePx()` calls `getComputedStyle` and must run at-or-after first
attach — never in a constructor. `TabBar` already reads sizes at `doLayout`/
`composeSize` and re-runs on the owner's `onThemeChange → scheduleLayout`
listener ([Tab.ts:317-318](../src/typescript/lib/layout/Tab.ts#L317), cited by
[tab-font-relative-sizing.md:38-39](implemented/tab-font-relative-sizing.md#L38)),
so the close-button/inset reads slot into the existing layout pass with no new
invalidation wiring. `WindowHeader.setGlyph` currently pins the size eagerly at
[WindowHeader.ts:192](../src/typescript/lib/component/container/WindowHeader.ts#L192);
because that method runs after construction (public API / post-attach), the
read is safe there, and a `ThemeManager.onThemeChange` listener re-pins the
glyph on a base change (mirroring the one-shot-first-read seam the defer plan
established, since `onThemeChange` does not fire on subscribe
[defer-construction-time-theme-reads.md:18-20](implemented/defer-construction-time-theme-reads.md#L18)).

### Scope to the two motivating consumers, not a framework-wide retrofit

The same px-constant pattern is widespread — Menu `PANEL_WIDTH`, Split
`GUTTER_SIZE`, Border `TRACK_SIZE`, Table `CHAR_WIDTH`/`HEADER_PAD` (enumerated
in [tab-font-relative-sizing.md:193-206](implemented/tab-font-relative-sizing.md#L193)).
Migrating all of them in one change is the scope blow-up CODE_CONVENTIONS'
"surgical changes" warns against and the tab plan explicitly cautions against
retrofitting Menu/Split/Table/Border at once. This plan builds the surface and
migrates **only** the two consumers the motivating bug names; the rest are
Non-Goals, unblocked for follow-up plans once the surface exists.

---

## Public API (TypeScript Signatures)

```ts
// Theme.ts — new exported token type + scale block on the Theme interface
/** A scaled size: `{ scale }` is a ratio of the base; `{ fixed }` is absolute px. */
export type ScaleToken = { scale: number } | { fixed: number };

interface Theme {
    // …existing blocks…
    scale: {
        base:           number;       // px; the scale knob
        titleGlyph:     ScaleToken;
        tabClose:       ScaleToken;
        tabCloseGlyph:  ScaleToken;
        tabButtonInset: ScaleToken;
    };
}

// Theme.ts — new exported shared reader (replaces ProgressSpinner's private copy)
/**
 * Reads the framework base size (`--ts-ui-base-size`) off the document root as
 * a px number. Returns the parsed value, or a 14 fallback when the var is
 * unset / unparseable. Must be called at layout/render time, not construction.
 */
export function readBaseSizePx(): number;

// Theme.ts — new exported scale-token resolver
/**
 * Resolves a `scale` token to px: `{ scale }` is a ratio of `base`
 * (`round(base * scale)`, grows with it); `{ fixed }` is absolute px. Call at
 * layout/render time.
 */
export function resolveScaleToken(token: ScaleToken, base: number): number;
```

No new typed setter / `XOptions` field: the migration changes default
*values* fed into existing setters (`Glyph.setPreferredSize`,
`Button.pinGlyphSize`, the inset math), not the setter signatures. The new
exported symbols are `readBaseSizePx` and `resolveScaleToken`.

---

## Theme Tokens

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-base-size` | `14px` | `14px` | Framework scale root; CSS sizes scale via `calc(<ratio> * var(--ts-ui-base-size))`, JS reads it via `readBaseSizePx()`. |

`Theme.ts` blocks to touch: add `scale` to the `Theme` interface; add the
`--ts-ui-base-size` line to `themeToVars` (`String(theme.scale.base) + 'px'`).
The base value and ratios are scheme-invariant, so they belong in
[`BaseTheme.ts`](../src/typescript/lib/core/themes/BaseTheme.ts) (the structural
scaffold all four built-in themes wrap), not in each scheme's palette file —
mirroring how `tab.indicator.thickness` and the form sizes already live there
([BaseTheme.ts:33-41](../src/typescript/lib/core/themes/BaseTheme.ts#L33)).
`ModernTheme` / `DarkTheme` / `ClassicTheme` need no `scale` entry. The
`scale.<ratio>` numbers are JS-only and are NOT emitted as vars.

---

## Ordered Implementation Steps

### Phase A — CSS-only base var (low risk, ship/verify first)

1. **Add the exported `ScaleToken` type and the `scale` block to the `Theme`
   interface** ([Theme.ts:42](../src/typescript/lib/core/Theme.ts#L42)) per the
   Public API block, with JSDoc on each field. — verify: typecheck.

2. **Provide the values in `BaseTheme`**
   ([BaseTheme.ts:16](../src/typescript/lib/core/themes/BaseTheme.ts#L16)):
   `scale: { base: 14, titleGlyph: { scale: 1 }, tabClose: { scale: 16/14 },
   tabCloseGlyph: { scale: 8/14 }, tabButtonInset: { scale: 4/14 } }`. Document
   each ratio as "current-px ÷ base". — verify: the theme regression test still
   passes (it enforces every `Theme` key is covered — `defineTheme` completeness
   [Theme.ts:658-660](../src/typescript/lib/core/Theme.ts#L658)).

3. **Emit `--ts-ui-base-size`** in `themeToVars`
   ([Theme.ts:699](../src/typescript/lib/core/Theme.ts#L699)), next to
   `--ts-ui-font-size`: `'--ts-ui-base-size': String(theme.scale.base) + 'px'`.
   — verify: typecheck; in the running app `getComputedStyle(document.documentElement).getPropertyValue('--ts-ui-base-size')`
   returns `"14px"`.

4. **Add the exported `readBaseSizePx()` and `resolveScaleToken()`** to
   `Theme.ts`. `readBaseSizePx` mirrors `ProgressSpinner.readThemeFontSizePx`
   ([ProgressSpinner.ts:29-35](../src/typescript/lib/component/display/ProgressSpinner.ts#L29))
   but reads `--ts-ui-base-size`. `resolveScaleToken(token, base)` returns
   `'scale' in token ? Math.round(base * token.scale) : token.fixed`
   (per the *Theme-level px override* decision). — verify: typecheck.

5. **Export `ScaleToken`, `readBaseSizePx`, and `resolveScaleToken` from the
   core barrel** (`src/typescript/lib/core/index.ts`) so consumers and docs
   resolve them (`ScaleToken` as a `type` export). — verify:
   `grep -nE 'ScaleToken|readBaseSizePx|resolveScaleToken' src/typescript/lib/core/index.ts` → 3 hits.

   *(Phase A end-state: the base knob exists in both views and is verifiable,
   with no behavioural change — `scale.base` equals the old implicit 14, so text
   and char-mode glyphs render identically. Ship and smoke-test before Phase B.)*

### Phase B — Numeric layer (SVG glyph boxes + JS constants)

6. **Window title glyph** in
   [`WindowHeader.ts`](../src/typescript/lib/component/container/WindowHeader.ts):
   replace the `LEAD_GLYPH_INK_SIZE = 14` constant
   ([WindowHeader.ts:29](../src/typescript/lib/component/container/WindowHeader.ts#L29))
   with `resolveScaleToken(ThemeManager.getTheme().scale.titleGlyph, readBaseSizePx())`
   at the `setGlyph` pin site
   ([WindowHeader.ts:192](../src/typescript/lib/component/container/WindowHeader.ts#L192)).
   Add a `ThemeManager.onThemeChange` listener (registered once in the
   constructor, unsubscribe on destroy if the class has a teardown hook) that
   re-pins `this._titleGlyph` to the recomputed size and re-lays-out. Keep the
   24×24 control-peer box logic ([WindowHeader.ts:104-113](../src/typescript/lib/component/container/WindowHeader.ts#L104))
   unchanged — only the inner glyph ink scales. — verify: typecheck; title glyph
   grows when the base var is raised (smoke test).

7. **Tab close-button + close-glyph** in
   [`TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts): replace
   `CLOSE_BUTTON_SIZE = 16` and `CLOSE_GLYPH_SIZE = 8`
   ([TabBar.ts:43-46](../src/typescript/lib/component/container/TabBar.ts#L43))
   reads with `resolveScaleToken(scale.tabClose, base)` /
   `resolveScaleToken(scale.tabCloseGlyph, base)` resolved at `doLayout` time.
   The consumers are `pinGlyphSize(CLOSE_GLYPH_SIZE)`
   ([TabBar.ts:1517](../src/typescript/lib/component/container/TabBar.ts#L1517)),
   the close-button width/height
   ([TabBar.ts:2436-2437](../src/typescript/lib/component/container/TabBar.ts#L2436)),
   and the centring math
   ([TabBar.ts:2443-2449](../src/typescript/lib/component/container/TabBar.ts#L2443))
   — route them through a single resolved-px local per pass so one read feeds
   all uses. — verify: typecheck.

8. **Tab button insets** in `TabBar.ts`: replace `TAB_BUTTON_INSET = 4` /
   `TAB_BUTTON_INSET_COMPACT = 2`
   ([TabBar.ts:53-56](../src/typescript/lib/component/container/TabBar.ts#L53))
   reads in `computeTabButtonInsets`
   ([TabBar.ts:1771](../src/typescript/lib/component/container/TabBar.ts#L1771))
   and the two other inset reads
   ([TabBar.ts:1804](../src/typescript/lib/component/container/TabBar.ts#L1804),
   [1943](../src/typescript/lib/component/container/TabBar.ts#L1943)) with
   `resolveScaleToken(scale.tabButtonInset, base)` (compact = that result
   `round`ed `/2`), resolved per layout pass. Note: when `tabButtonInset` is the
   `{ fixed }` form the compact half still derives from the resolved px, so the
   compact relationship holds for both token forms. The owner's existing `onThemeChange → scheduleLayout`
   ([Tab.ts:317-318](../src/typescript/lib/layout/Tab.ts#L317)) re-resolves them
   on theme/base change — no new wiring. — verify: typecheck.

9. **Redirect `ProgressSpinner`'s private reader to the shared one** (optional
   tidy, in-scope because it removes the now-duplicated body): have
   `ProgressSpinner.readThemeFontSizePx` delegate to `readBaseSizePx()` *only if*
   the spinner is meant to track the base rather than the control font-size.
   **Decision: leave `ProgressSpinner` reading `--ts-ui-font-size`** — its size
   is font-coupled to the *control* font, not the framework base, and base ==
   font-size in the first pass so behaviour is identical either way. Migrating it
   risks a semantic change for zero visible benefit. Note in the commit that the
   two readers now share a body shape but read different vars by design. —
   verify: `grep -n 'readThemeFontSizePx' src/typescript/lib/component/display/ProgressSpinner.ts`
   still present, unchanged.

10. **Typecheck + theme regression test + smoke test** (see Verification).

### Regression checkpoints

- `grep -rn "LEAD_GLYPH_INK_SIZE" src/typescript/lib` — expect 0 after step 6.
- `grep -rnE "CLOSE_BUTTON_SIZE|CLOSE_GLYPH_SIZE|TAB_BUTTON_INSET" src/typescript/lib/component/container/TabBar.ts`
  — the constants may remain as ratio *definitions* in `BaseTheme`, but the
  literal px reads in `TabBar` are gone (or demoted to documented fallbacks).
- `grep -rn "TabReorderBar.THICKNESS\|indicator.thickness" src/typescript/lib`
  — unchanged (fixed-by-design tokens stay).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Theme.ts` (`ScaleToken` type, `scale` block on `Theme`, `--ts-ui-base-size` in `themeToVars`, exported `readBaseSizePx` + `resolveScaleToken`) |
| Modify | `src/typescript/lib/core/themes/BaseTheme.ts` (`scale` values as `{ scale: … }` tokens) |
| Modify | `src/typescript/lib/core/index.ts` (export `ScaleToken`, `readBaseSizePx`, `resolveScaleToken`) |
| Modify | `src/typescript/lib/component/container/WindowHeader.ts` (title-glyph ratio + onThemeChange re-pin) |
| Modify | `src/typescript/lib/component/container/TabBar.ts` (close-button/glyph + inset ratios at layout time) |

No files created or deleted.

---

## Verification

- **Typecheck:** `npm run typecheck` — 0 errors.
- **Theme completeness:** the theme regression test passes (every `Theme` key,
  including the new `scale` block, covered by `BaseTheme` + each scheme).
- **Base var present:** in the running app
  (`npm run dev`, http://localhost:8015), confirm
  `getComputedStyle(document.documentElement).getPropertyValue('--ts-ui-base-size')`
  is `"14px"` and `readBaseSizePx()` returns `14`.
- **No behavioural drift at default base:** open the **`TabDemoPanel`**
  ([src/typescript/TabDemoPanel.ts](../src/typescript/TabDemoPanel.ts)) and a
  `TabWindow`/`Window` with a title glyph — tab close buttons, insets, and the
  title icon look identical to pre-change at the default base (since `base == 14`).
- **Scaling smoke test (load-bearing):** raise the base — set the active theme's
  `scale.base` to e.g. `28` (or override `--ts-ui-base-size` in DevTools and
  call `ThemeManager.setTheme(getTheme())` to re-run the layout pass) — and
  confirm the **SVG glyphs now follow**: the window title glyph grows from ~14px
  toward ~28px, and the tab close glyph / close button / insets scale up so the
  close ✕ no longer looks tiny against a large tab label. This is the concrete
  motivating bug resolving. Scope DevTools queries to
  `.TabDemoPanel .TabPanel` so you measure the visible instance, not a hidden
  sibling (per the project DevTools-scope note).
- **Theme-level px override:** set a token to the fixed form (e.g.
  `scale.titleGlyph: { fixed: 20 }`) and confirm the title glyph renders at 20px
  and **stays 20px when the base is raised** — the `{ scale }` form grows, the
  `{ fixed }` form does not. Confirms the theme escape hatch works both ways.
- **Theme toggle:** switch Modern ↔ Dark ↔ Classic — glyph sizes stay stable
  (ratios are scheme-invariant), confirming the `scale` block lives correctly in
  `BaseTheme`.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's
  "unsupported TypeScript version" notice is the lone acceptable warning),
  required because `ScaleToken`, `readBaseSizePx`, and `resolveScaleToken` are
  newly exported.

---

## Documentation Impact

- **Barrel:** `ScaleToken` (a `type` export), `readBaseSizePx`, and
  `resolveScaleToken` are exported from `src/typescript/lib/core/index.ts` (the
  core group barrel — there is no root barrel). `ScaleToken` surfaces under
  `docs/api/core/type-aliases`; the `scale` block itself is internal to the
  already-exported `Theme` interface.
- **Curated page:** the Theme system page under `docs/core/` (the page covering
  `Theme` / `ThemeManager` / `defineTheme`) gains a short "Base size & scaling"
  note documenting `--ts-ui-base-size`, the `scale` block (including the
  ratio-vs-absolute-px token form), `readBaseSizePx`, and `resolveScaleToken`.
  Update that group's catalog `index.md` and the sidebar in
  `docs/.vitepress/config.mts` if a new heading/anchor is added.
- **JSDoc:** `ScaleToken`, `readBaseSizePx`, `resolveScaleToken`, and the `scale`
  block carry full TSDoc (typedoc surfaces them). Cross-bucket references to
  `Theme`/`ThemeManager` use markdown links, not `{@link}`, per
  `_shared/docs-conventions.md`.

---

## Potential Challenges

- **`onThemeChange` does not fire on subscribe.** A `WindowHeader` that
  registers a listener still needs its first pin at `setGlyph` time; the
  listener only covers *subsequent* base changes (the defer plan's one-shot
  first-read seam, [defer-construction-time-theme-reads.md:18-20](implemented/defer-construction-time-theme-reads.md#L18)).
- **Listener leak on `WindowHeader`.** Register the `onThemeChange` listener
  once and unsubscribe via the returned closure on the component's teardown hook;
  verify `WindowHeader` has one (mirror how `Text`/`ProgressSpinner` manage
  their theme listeners) or the closure accumulates per re-theme.
- **Rounding drift.** `round(14 × 8/14) = 8` and `round(14 × 16/14) = 16` recover
  the exact current px at the default base — confirm each ratio round-trips so
  Phase A/B introduce zero pixel drift before scaling is exercised.
- **Always resolve through the helper.** A `scale` token is `{ scale }` or
  `{ fixed }`, so `resolveScaleToken` is the only place that branches — a bare
  `theme.scale.tabClose * base` won't even typecheck (the union has no numeric
  arm), which is the point: the type prevents the wrong-form footgun the
  `number | string` overload risked. Route every read through the helper.
- **`base` vs `font.size` divergence.** Keeping `--ts-ui-base-size` a separate
  token from `--ts-ui-font-size` means a theme could set them unequal; document
  that the first pass values them equal and that only `readBaseSizePx` (the base
  var) drives ratio math, so the two stay independent by design.
- **Char-mode glyphs already scale via inheritance.** Don't double-apply a ratio
  to char-mode glyphs — they inherit font-size through CSS already; the numeric
  ratio path is for SVG boxes and JS constants only.

---

## Critical Files

- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) —
  the `Theme` interface ([42](../src/typescript/lib/core/Theme.ts#L42)),
  `font.size` ([47](../src/typescript/lib/core/Theme.ts#L47)), `themeToVars`
  ([699](../src/typescript/lib/core/Theme.ts#L699)), `--ts-ui-font-size` emit
  ([702](../src/typescript/lib/core/Theme.ts#L702)), `setTheme`'s root-font write
  ([1031](../src/typescript/lib/core/Theme.ts#L1031)), `onThemeChange`
  ([1000-1005](../src/typescript/lib/core/Theme.ts#L1000)), `defineTheme`
  completeness contract ([658-660](../src/typescript/lib/core/Theme.ts#L658)).
- [`src/typescript/lib/core/themes/BaseTheme.ts`](../src/typescript/lib/core/themes/BaseTheme.ts) —
  the scheme-invariant scaffold; `font.size` and structural sizes live here
  ([16-48](../src/typescript/lib/core/themes/BaseTheme.ts#L16)).
- [`src/typescript/lib/component/display/Glyph.ts`](../src/typescript/lib/component/display/Glyph.ts) —
  the crux: `setPreferredSize` pins min/pref/max
  ([280-286](../src/typescript/lib/component/display/Glyph.ts#L280)),
  `setFontSize` SVG no-op ([327-342](../src/typescript/lib/component/display/Glyph.ts#L327)),
  SVG `<use>` render path ([633-647](../src/typescript/lib/component/display/Glyph.ts#L633)).
- [`src/typescript/lib/component/display/ProgressSpinner.ts:29-35`](../src/typescript/lib/component/display/ProgressSpinner.ts#L29) —
  the proven JS-number theme read to mirror in `readBaseSizePx`.
- [`src/typescript/lib/component/container/WindowHeader.ts`](../src/typescript/lib/component/container/WindowHeader.ts) —
  `LEAD_GLYPH_INK_SIZE` ([29](../src/typescript/lib/component/container/WindowHeader.ts#L29)),
  the 24×24 control-peer box ([104-113](../src/typescript/lib/component/container/WindowHeader.ts#L104)),
  `setGlyph` pin ([179-194](../src/typescript/lib/component/container/WindowHeader.ts#L179)).
- [`src/typescript/lib/component/container/TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts) —
  the close/inset constants ([43-56](../src/typescript/lib/component/container/TabBar.ts#L43)),
  `pinGlyphSize` call ([1517](../src/typescript/lib/component/container/TabBar.ts#L1517)),
  `computeTabButtonInsets` ([1771](../src/typescript/lib/component/container/TabBar.ts#L1771)),
  close-button placement ([2436-2449](../src/typescript/lib/component/container/TabBar.ts#L2436)).
- [`src/typescript/lib/layout/Tab.ts:317-318`](../src/typescript/lib/layout/Tab.ts#L317) —
  the `onThemeChange → scheduleLayout` seam that re-resolves `TabBar`'s reads.
- [`src/typescript/lib/component/button/Button.ts:1030`](../src/typescript/lib/component/button/Button.ts#L1030) —
  `pinGlyphSize(px)`, the explicit-px escape hatch the ratio path feeds.
- [`plans/implemented/tab-font-relative-sizing.md`](implemented/tab-font-relative-sizing.md) —
  the Phase 2 sketch this plan delivers; mirror its reasoning.
- [`plans/implemented/defer-construction-time-theme-reads.md`](implemented/defer-construction-time-theme-reads.md) —
  the render-time-read rule the numeric reads must follow.

---

## Non-Goals

- **No framework-wide constant retrofit.** Menu `PANEL_WIDTH`, Split
  `GUTTER_SIZE`, Border `TRACK_SIZE`, Table `CHAR_WIDTH`/`HEADER_PAD` keep their
  fixed px — unblocked for follow-up plans, not migrated here (per
  [tab-font-relative-sizing.md:193-206](implemented/tab-font-relative-sizing.md#L193)).
- **No migration of fixed-by-design tokens.** Hairlines/borders, `TabReorderBar.THICKNESS`
  (2px), the `2px solid` focus indicators, and `tab.indicator.thickness` stay
  fixed px — the settled scaled-vs-fixed split.
- **No cosmetic padding.** Migration preserves existing visual sizes at the
  default base; no breathing room added.
- **No change to `STRIP_THICKNESS` / `SCROLL_ARROW_SIZE` / `SCROLL_ARROW_STEP`.**
  Already settled by the implemented tab plan (measured thickness, fixed arrow
  gutter).
- **No coupling to the app's `:root { font-size }`.** The scale root is the
  framework-owned `--ts-ui-base-size`, not CSS `rem` / the host's root font.
- **No `scale.base` ≠ `font.size` reconfiguration in the first pass.** They are
  valued equal; decoupling them for a distinct "chrome scale vs text scale" is a
  future plan.
