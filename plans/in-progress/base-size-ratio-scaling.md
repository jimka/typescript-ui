# Base Size → Ratio Scaling — Implementation Plan

## Overview

Establish ONE root base size as the framework's global scale knob, exposed two
ways from a single source of truth: as a **CSS custom property** (so CSS sizes
*could* be written `calc`-relative to it) and as a **JS number** (so layout math
and SVG glyph boxes can compute `px = round(base × ratio)`). This delivers the
"Phase 2 numeric theme-token surface" that
[`tab-font-relative-sizing.md`](implemented/tab-font-relative-sizing.md#L134)
explicitly sketched and deferred — that plan shipped the measured-button strip
thickness (Phase 1) and named "insets, close-button, close-glyph need a numeric
token surface" as the blocked follow-on
([tab-font-relative-sizing.md:134-191](implemented/tab-font-relative-sizing.md#L134)).

The base already half-exists. `theme.font.size` is a CSS length string
([Theme.ts:47](../src/typescript/lib/core/Theme.ts#L47)), `themeToVars` emits it
as `--ts-ui-font-size`
([Theme.ts:703](../src/typescript/lib/core/Theme.ts#L703)), and the module-level
free function `readThemeFontSizePx` inside `ProgressSpinner` already parses that
var back to a JS number
([ProgressSpinner.ts:29-35](../src/typescript/lib/component/display/ProgressSpinner.ts#L29)).
What is missing is (1) a *named, framework-owned* base var distinct from the
control font-size so the scale root is explicit and the app needn't own
`:root { font-size }`, (2) a **shared exported** JS reader other code can call
(today's reader is a private module-level copy inside `ProgressSpinner.ts`), and
(3) **ratio-derived tokens** for the font-coupled px constants that currently
can't follow the scale — the window title glyph pinned to
`LEAD_GLYPH_INK_SIZE = 14`
([WindowHeader.ts:30](../src/typescript/lib/component/container/WindowHeader.ts#L30))
and the tab close-button / close-glyph / insets in `TabBar`
([TabBar.ts:43-56](../src/typescript/lib/component/container/TabBar.ts#L43)).

Scope: [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts)
(the base var + a shared reader + ratio block + token resolver), the two
motivating consumers
[`WindowHeader.ts`](../src/typescript/lib/component/container/WindowHeader.ts)
and [`TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts), the
shared base values in
[`themes/BaseTheme.ts`](../src/typescript/lib/core/themes/BaseTheme.ts), and the
core barrel/docs for the new exported symbols. Migration is phased: a cheap
CSS-var formalization layer (Phase A) ships and verifies first, then the numeric
layer for SVG glyph boxes and JS constants (Phase B).

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
([Glyph.ts:337](../src/typescript/lib/component/display/Glyph.ts#L337)).
Therefore `rem`/`em` in CSS does **not** reach SVG glyph boxes — they need a px
**number** derived from the base. This is exactly why dual exposure (not CSS
alone) is the core primitive: char-mode glyphs and text scale through the CSS
font var; SVG glyph boxes and JS layout constants must read the base as a number
and multiply by a ratio. This crux is the load-bearing justification for the
whole plan.

### One base, two views — a framework-owned `--ts-ui-base-size` plus a shared `readBaseSizePx()`

The single source of truth is the theme's base size, declared once. Both the CSS
view and the JS view derive from the same theme token:

- **CSS view:** a new framework-owned custom property `--ts-ui-base-size`,
  emitted by `themeToVars` from the base token. Keeping it distinct from
  `--ts-ui-font-size` (the *control* font-size) means the scale root is named
  explicitly and the framework does not depend on the app owning
  `:root { font-size }`. A consumer wanting a CSS-side scaled size would write
  `calc(<ratio> * var(--ts-ui-base-size))`. **In this plan no component CSS
  consumes the var yet** — Phase A merely *publishes* the knob (see *Phase A is a
  no-op CSS formalization* below). For the first pass the base value equals
  `theme.font.size` (`14px`), so nothing visually shifts.
- **JS view:** a new **exported** `readBaseSizePx(): number` in `Theme.ts` that
  parses `--ts-ui-base-size` off the document root, mirroring the proven
  `readThemeFontSizePx` module-level free function in `ProgressSpinner.ts`
  ([ProgressSpinner.ts:29-35](../src/typescript/lib/component/display/ProgressSpinner.ts#L29))
  with the same `parseFloat` + `NaN`→`14` fallback guard. This gives
  `TabBar`/`WindowHeader` one reader.

Both views read the same custom property, so there is exactly one source of
truth at runtime; the theme object's `scale.base` is the source of truth at
config time.

### Phase A is a no-op CSS formalization — text keeps following `--ts-ui-font-size`

Honest framing of the CSS layer: emitting `--ts-ui-base-size` adds a *published*
knob, but **no existing component CSS references it**, and this plan does not
rewrite any CSS to consume it. Text and char-mode glyphs continue to size off
`--ts-ui-font-size` / the `:root` font exactly as today; they do **not** start
tracking `--ts-ui-base-size`. Because `scale.base === font.size` in the first
pass, the two vars carry the same value, so there is no visible difference — but
the implementer must not expect text to suddenly "scale for free" off the new
var. The CSS-side scaling story (`calc(<ratio> * var(--ts-ui-base-size))` in
component stylesheets) is deliberately a **Non-Goal** here; this plan ships the
JS numeric path that the motivating bug (SVG glyph boxes that ignore CSS) needs.
The base var is published now so a later CSS-consuming plan has a stable root to
build on.

### Use the explicit base var, NOT raw CSS `rem`

The settled decision is "root-relative, not em" — achieved through the
framework's own `--ts-ui-base-size`, not the CSS `rem` unit. `rem` resolves
against `:root`'s `font-size`, which `ThemeManager.setTheme` *does* currently
write ([Theme.ts:1033](../src/typescript/lib/core/Theme.ts#L1033)) — but tying
the framework scale to `document.documentElement.style.fontSize` couples it to a
property the host app may legitimately own and override. A named
`--ts-ui-base-size` is root-relative, predictable (no `em`-style compounding
through nesting), and decoupled from the app's font-size choices. The JS reader
parses this var. (`em` is rejected per the settled decisions — it compounds
through nesting; a single root knob with explicit per-token ratios stays
predictable.)

### Ratios live in the theme as a numeric block; px is derived at read time

Add a numeric `scale` block to the `Theme` interface holding the base plus the
font-coupled ratios — the first **numbers** in a theme surface that has been
almost all-strings to date (every `themeToVars` entry stringifies a string
token, and even `--ts-ui-table-cell-height`
([Theme.ts:796](../src/typescript/lib/core/Theme.ts#L796)) is emitted as a CSS
var, never parsed in JS). `table.cell.padding: number`
([Theme.ts:312](../src/typescript/lib/core/Theme.ts#L312)) is the lone existing
numeric token, consumed as a JS number and never emitted as a var — precedent
that numbers can live in `Theme`, not a counter-example. The `scale` block:

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

Each non-`base` token is a `ScaleToken`: `{ scale: n }` is a **ratio of the
base** (scales with it) and `{ fixed: px }` is an **absolute size** that opts out
of scaling — the theme-level escape hatch (see *Theme-level px override*). For
the ratio case, px is `round(base × n)`, never stored pre-multiplied, so
re-resolving on a base change is one multiply. `scale.base` is the config-time
declaration `themeToVars` emits the var from; the live runtime read goes through
`readBaseSizePx()` (the CSS var) so JS and CSS never diverge mid-session.

The compact inset keeps its existing relationship to the non-compact inset
(`TAB_BUTTON_INSET_COMPACT = 2` is half of `4`
[TabBar.ts:53-56](../src/typescript/lib/component/container/TabBar.ts#L53)),
derived as `round(resolveScaleToken(tabButtonInset, base) / 2)` rather than a
second ratio token — fewer knobs, same result, correct whether the inset token
is a `{ scale }` ratio or a `{ fixed }` px.

Ratios are **not** emitted through `themeToVars` (they are JS-only multipliers);
only `--ts-ui-base-size` is emitted.

### `DeepPartial` weakens `ScaleToken` — `resolveScaleToken` must be runtime-robust, and the type guarantee is stated honestly

**This is the load-bearing correction over the prior draft.** `BaseTheme` is
typed `DeepPartial<Theme>`
([themes/BaseTheme.ts:16](../src/typescript/lib/core/themes/BaseTheme.ts#L16)),
and `DeepPartial<T>` recurses into *every* object-typed property
([Theme.ts:609-611](../src/typescript/lib/core/Theme.ts#L609)):

```ts
export type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
```

`ScaleToken = { scale: number } | { fixed: number }` is an object type, so
`DeepPartial` distributes over the union and makes **both arms optional**:
`{ scale?: number } | { fixed?: number }`. Authored inside the `BaseTheme`
literal, `{}`, a both-present blend (via `defineTheme`'s merge), and a missing
key are therefore **NOT compile errors**. The "exactly-one, compile-time
guarantee, no runtime validation, no NaN footgun" claim the prior draft repeated
is **false at the authoring site** — it only holds for code that constructs a
`ScaleToken` against the *bare* (non-`DeepPartial`) type.

Two concrete resolutions, both applied:

1. **Make `resolveScaleToken` robust to the weakened shape.** It must handle
   both-present, scale-only, fixed-only, and neither-present **explicitly**, with
   a deterministic fallback rather than silently returning `undefined`/`NaN`:

   ```ts
   export function resolveScaleToken(token: ScaleToken, base: number): number {
       // DeepPartial<Theme> can weaken the union to {scale?}|{fixed?}, so guard
       // every arm. `scale` wins when both are somehow present; a token missing
       // both falls back to the base so a malformed theme degrades visibly (base
       // px) rather than crashing or producing NaN.
       const t = token as { scale?: number; fixed?: number };
       if (typeof t.scale === 'number') return Math.round(base * t.scale);
       if (typeof t.fixed === 'number') return t.fixed;
       return base;
   }
   ```

   This removes the NaN/`undefined` footgun the naive
   `'scale' in token ? token.scale : token.fixed` carried.

2. **State the honest guarantee.** The `ScaleToken` union *does* document intent,
   *does* self-document the call site (`{ scale: 1 }` vs `{ fixed: 20 }`), and
   *does* enforce exactly-one **when a value is typed against `ScaleToken`
   directly** (e.g. `resolveScaleToken`'s own parameter). It does **not** enforce
   exactly-one inside a `DeepPartial<Theme>` literal. The plan claims only the
   former; the runtime guard in `resolveScaleToken` covers the latter. We
   deliberately do **not** rework `DeepPartial` to special-case unions (e.g.
   `T[K] extends ScaleToken ? T[K] : …`) — that would entangle a generic theme
   utility with one token shape for a guarantee the cheap runtime guard already
   delivers, and `defineTheme`'s merge can still produce a partial token. The
   robust resolver is the single chokepoint; route every read through it.

### Scaled-vs-fixed token split (settled — enforce it)

**Scales with the base** (migrate): SVG glyph boxes and the font-coupled JS
layout constants — the window title glyph `LEAD_GLYPH_INK_SIZE`
([WindowHeader.ts:30](../src/typescript/lib/component/container/WindowHeader.ts#L30)),
and tab `CLOSE_BUTTON_SIZE` / `CLOSE_GLYPH_SIZE` / `TAB_BUTTON_INSET`(`_COMPACT`)
([TabBar.ts:43-56](../src/typescript/lib/component/container/TabBar.ts#L43)).
Text and char-mode glyphs already inherit the font var and are **not** touched by
this plan (see *Phase A is a no-op CSS formalization*).

**Stays fixed px** (do NOT migrate): hairlines and borders, the 2px
`TabReorderBar.THICKNESS`
([TabBar.ts:337](../src/typescript/lib/component/container/TabBar.ts#L337), fixed
by design), focus rings (the framework pins focus indicators at `2px solid`
[Theme.ts:131-137](../src/typescript/lib/core/Theme.ts#L131)), the indicator
thickness, and any device-pixel detail. Do not add cosmetic breathing room while
migrating (project no-cosmetic-padding rule). `SCROLL_ARROW_SIZE` and
`STRIP_THICKNESS`/`SCROLL_ARROW_STEP` are out of scope — settled by the
implemented tab plan (strip thickness is measured from the button, arrow gutter
stays fixed
[tab-font-relative-sizing.md:120-132](implemented/tab-font-relative-sizing.md#L120)).

### Theme-level px override — a `ScaleToken` union, exactly-one enforced *where the bare type applies*

A theme author must be able to pin a token to a fixed px *that does not scale
with the base*. So every non-`base` `scale` token is a `ScaleToken`:
`{ scale: 1 }` is a **ratio** of the base (grows with it) and `{ fixed: 20 }` is
**absolute px** (stays put). At a call site typed against the bare `ScaleToken`,
"exactly one of scale/fixed" is a compile-time guarantee and self-documenting
(`{ scale: 1 }` vs `{ fixed: 20 }`). Inside the `BaseTheme` literal the guarantee
is weakened by `DeepPartial` (see above), which is why `resolveScaleToken` guards
every arm.

The tokens stay **required** in the `Theme` interface (every theme provides each
via `BaseTheme`); they are not optional-with-base-fallback, because the non-unit
defaults (close button `16/14`, close glyph `8/14`, inset `4/14`) have no
sensible "fall back to 1× base" meaning. All resolution goes through one exported
helper (the robust body above) so both arms are handled identically everywhere a
token is read. `{ scale: 1 }` and `{ fixed: 14 }` both yield `14` at the default
base, but the first grows with the base and the second stays pinned — that is the
theme-level escape hatch.

### Consumer-level explicit-px escape hatch also stays

Independently of the theme tokens, the migration only changes *defaults*: every
touched setter remains explicit-px capable. `Glyph.setPreferredSize(w, h)` still
accepts literal px, `Button.pinGlyphSize(px)`
([Button.ts:1030](../src/typescript/lib/component/button/Button.ts#L1030)) still
takes a px number, and `WindowHeader.setGlyph` still pins a concrete size. Two
layers of opt-out: the **theme** pins a token via a `{ fixed: px }` form; a
**call site** bypasses the token entirely by passing literal px.

### Reads happen at layout/render time, re-resolve on theme change

Per the implemented `defer-construction-time-theme-reads` rule
([defer-construction-time-theme-reads.md:10-22](implemented/defer-construction-time-theme-reads.md#L10)),
`readBaseSizePx()` calls `getComputedStyle` and must run at-or-after first
attach — never in a constructor. `TabBar` already reads sizes at `doLayout` /
`composeSize` and re-runs on the owner's `onThemeChange → scheduleLayout`
listener ([Tab.ts:317-318](../src/typescript/lib/layout/Tab.ts#L317), cited by
[tab-font-relative-sizing.md:38-39](implemented/tab-font-relative-sizing.md#L38)),
so the close-button/inset reads slot into the existing layout pass with no new
invalidation wiring.

`WindowHeader.setGlyph` currently pins the size eagerly at the
`glyph.setPreferredSize(LEAD_GLYPH_INK_SIZE, LEAD_GLYPH_INK_SIZE)` call
([WindowHeader.ts:241](../src/typescript/lib/component/container/WindowHeader.ts#L241),
inside `setGlyph` ~228-248); because `setGlyph` runs after construction (public
API / post-attach, and the constructor's default `setGlyph("window-maximize")`
call at [WindowHeader.ts:153](../src/typescript/lib/component/container/WindowHeader.ts#L153)
also runs after `super()`), the read is safe there. See the next decision for the
re-pin-on-theme-change lifecycle.

### WindowHeader re-pin uses the existing `updatePreferredSize` theme hook — no new listener

`WindowHeader` has **no** `destroy`/`dispose`/`_themeCleanup` — verified:
`grep -nE 'destroy|dispose|_themeCleanup' src/.../WindowHeader.ts` returns
nothing. So a freshly-registered `ThemeManager.onThemeChange` closure that pins
the glyph would have no unsubscribe site and would leak per re-theme. We avoid
adding a listener entirely.

WindowHeader's parent `Header` **already** registers a theme listener in its
constructor that calls `this.updatePreferredSize()` on every theme change
([Header.ts:80-82](../src/typescript/lib/component/display/Header.ts#L80)), and
`WindowHeader` **overrides** `updatePreferredSize`
([WindowHeader.ts:174-182](../src/typescript/lib/component/container/WindowHeader.ts#L174)).
The re-pin therefore goes **inside that override** — re-resolving the title-glyph
px and calling `this._titleGlyph.setPreferredSize(px, px)` whenever
`updatePreferredSize` runs (construction + every theme change). No new
subscription, no cleanup field, no teardown hook to invent.

Two safety requirements the implementer must honour:

- **Guard the subclass field.** `updatePreferredSize` can run via `super()`
  before `WindowHeader`'s fields initialize (its own JSDoc warns it must read
  "no subclass field" so it is `super()`-safe). `_titleGlyph` is a subclass field
  (`private _titleGlyph: Glyph | null = null`
  [WindowHeader.ts:69](../src/typescript/lib/component/container/WindowHeader.ts#L69)),
  so during the super-cascade it is `undefined`. Gate the re-pin behind
  `if (this._titleGlyph)` so the super()-time call is a no-op and only post-init
  runs touch it (the class-field super-cascade trap).
- **`readBaseSizePx()` is safe here** because `updatePreferredSize` runs on the
  Header theme listener (post-attach) and on construction *after* `super()`; both
  are at-or-after first attach, satisfying the defer-construction-time-reads rule.

`Header`'s own no-cleanup listener is the established precedent for this class —
the majority of framework components register `onThemeChange` fire-and-forget
(`NumberSpinner`, `TextField`, `ComboBox`, `ProgressSpinner`, `Header` itself);
only `Tab`/`TabBar`/`Text`, which have a real `detach`/destroy seam, store a
`_themeCleanup`. Reusing Header's hook keeps WindowHeader in the fire-and-forget
majority while adding **zero** new listeners.

### Scope to the two motivating consumers, not a framework-wide retrofit

The same px-constant pattern is widespread — Menu `PANEL_WIDTH`, Split
`GUTTER_SIZE`, Border `TRACK_SIZE`, Table `CHAR_WIDTH`/`HEADER_PAD` (enumerated
in [tab-font-relative-sizing.md:193-206](implemented/tab-font-relative-sizing.md#L193)).
Migrating all in one change is the scope blow-up CODE_CONVENTIONS' "surgical
changes" warns against. This plan builds the surface and migrates **only** the
two consumers the motivating bug names; the rest are Non-Goals.

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

// Theme.ts — new exported shared reader (mirrors ProgressSpinner's readThemeFontSizePx)
/**
 * Reads the framework base size (`--ts-ui-base-size`) off the document root as
 * a px number. Returns the parsed value, or a 14 fallback when the var is
 * unset / unparseable. Must be called at layout/render time, not construction.
 */
export function readBaseSizePx(): number;

// Theme.ts — new exported scale-token resolver (runtime-robust against DeepPartial weakening)
/**
 * Resolves a `scale` token to px: `{ scale }` is a ratio of `base`
 * (`round(base * scale)`, grows with it); `{ fixed }` is absolute px. Guards
 * every arm because DeepPartial<Theme> can weaken the union at the authoring
 * site; a token missing both fields falls back to `base`. Call at
 * layout/render time with the live base.
 */
export function resolveScaleToken(token: ScaleToken, base: number): number;
```

No new typed setter / `XOptions` field: the migration changes default *values*
fed into existing setters (`Glyph.setPreferredSize`, `Button.pinGlyphSize`, the
inset math), not the setter signatures. The new exported symbols are
`ScaleToken`, `readBaseSizePx`, and `resolveScaleToken`.

---

## Theme Tokens

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-base-size` | `14px` | `14px` | Framework scale root; JS reads it via `readBaseSizePx()`. Published for a future CSS-consuming plan; no component CSS consumes it in this plan. |

`Theme.ts` blocks to touch: add `scale` to the `Theme` interface
([Theme.ts:42](../src/typescript/lib/core/Theme.ts#L42)); add the
`--ts-ui-base-size` line to `themeToVars`
([Theme.ts:700-704](../src/typescript/lib/core/Theme.ts#L700),
`String(theme.scale.base) + 'px'`). The base value and ratios are
scheme-invariant, so they belong in
[`themes/BaseTheme.ts`](../src/typescript/lib/core/themes/BaseTheme.ts) (the
structural scaffold all built-in themes wrap), not in each scheme's palette file
— mirroring how `tab.indicator.thickness` and the form sizes already live there
([themes/BaseTheme.ts:33-42](../src/typescript/lib/core/themes/BaseTheme.ts#L33)).
`ModernTheme` / `DarkTheme` / `ClassicTheme` need no `scale` entry. The
`scale.<ratio>` numbers are JS-only and are NOT emitted as vars.

---

## Ordered Implementation Steps

### Phase A — Base var + JS surface (low risk, ship/verify first)

1. **Add the exported `ScaleToken` type and the `scale` block to the `Theme`
   interface** ([Theme.ts:42](../src/typescript/lib/core/Theme.ts#L42)) per the
   Public API block, with JSDoc on each field. — verify: `npm run typecheck`
   passes.

2. **Provide the values in `BaseTheme`**
   ([themes/BaseTheme.ts:16](../src/typescript/lib/core/themes/BaseTheme.ts#L16)):
   `scale: { base: 14, titleGlyph: { scale: 1 }, tabClose: { scale: 16/14 },
   tabCloseGlyph: { scale: 8/14 }, tabButtonInset: { scale: 4/14 } }`. Document
   each ratio as "current-px ÷ base". — verify: `npm run typecheck` passes.
   (Note: `BaseTheme` is `DeepPartial<Theme>`, so a missing or malformed `scale`
   arm will **not** be caught by the type — see the next check.)

3. **Manually confirm every `scale` token is present and well-formed in
   `BaseTheme`** (the type cannot enforce it under `DeepPartial`, and there is no
   test runner). — verify:
   `grep -nE 'base:|titleGlyph:|tabClose:|tabCloseGlyph:|tabButtonInset:' src/typescript/lib/core/themes/BaseTheme.ts`
   shows all five keys, each with a single well-formed `scale:`/`fixed:`/number
   value.

4. **Emit `--ts-ui-base-size`** in `themeToVars`
   ([Theme.ts:700-704](../src/typescript/lib/core/Theme.ts#L700)), next to
   `--ts-ui-font-size` ([Theme.ts:703](../src/typescript/lib/core/Theme.ts#L703)):
   `'--ts-ui-base-size': String(theme.scale.base) + 'px'`. — verify:
   `npm run typecheck`; in the running app
   `getComputedStyle(document.documentElement).getPropertyValue('--ts-ui-base-size')`
   returns `"14px"`.

5. **Add the exported `readBaseSizePx()` and `resolveScaleToken()`** to
   `Theme.ts`. `readBaseSizePx` mirrors the `readThemeFontSizePx` free function
   ([ProgressSpinner.ts:29-35](../src/typescript/lib/component/display/ProgressSpinner.ts#L29))
   but reads `--ts-ui-base-size`. `resolveScaleToken` uses the **runtime-robust
   body** from the *DeepPartial* decision (guard `scale`, then `fixed`, else fall
   back to `base`). — verify: `npm run typecheck`.

6. **Export `ScaleToken`, `readBaseSizePx`, and `resolveScaleToken` from the core
   barrel** (`src/typescript/lib/core/index.ts`) — `ScaleToken` as a `type`
   export, alongside the existing `export type { Theme, DeepPartial }`
   ([index.ts:45-46](../src/typescript/lib/core/index.ts#L45)). — verify:
   `grep -nE 'ScaleToken|readBaseSizePx|resolveScaleToken' src/typescript/lib/core/index.ts`
   → 3 hits.

   *(Phase A end-state: the base knob exists in both views and is verifiable,
   with no behavioural change — `scale.base` equals the old implicit 14, the new
   var is published but consumed only by JS, and no CSS reads it. Ship and
   smoke-test before Phase B.)*

### Phase B — Numeric layer (SVG glyph boxes + JS constants)

7. **Window title glyph** in
   [`WindowHeader.ts`](../src/typescript/lib/component/container/WindowHeader.ts):
   replace the `LEAD_GLYPH_INK_SIZE = 14` constant
   ([WindowHeader.ts:30](../src/typescript/lib/component/container/WindowHeader.ts#L30))
   with a resolved value at the `setGlyph` pin site
   ([WindowHeader.ts:241](../src/typescript/lib/component/container/WindowHeader.ts#L241)):
   `const ink = resolveScaleToken(ThemeManager.getTheme().scale.titleGlyph, readBaseSizePx());`
   then `glyph.setPreferredSize(ink, ink)`. Re-pin on theme change by re-resolving
   the same value **inside the existing `updatePreferredSize` override**
   ([WindowHeader.ts:174-182](../src/typescript/lib/component/container/WindowHeader.ts#L174))
   — guarded `if (this._titleGlyph) { const ink = …; this._titleGlyph.setPreferredSize(ink, ink); }`
   — which `Header` already re-runs on every theme change
   ([Header.ts:80-82](../src/typescript/lib/component/display/Header.ts#L80)), so
   **no new listener and no teardown hook**. The `if (this._titleGlyph)` guard
   keeps the super()-time call a no-op (subclass field undefined during
   super-cascade). **Update the `updatePreferredSize` `@remarks` JSDoc**
   ([WindowHeader.ts:171-172](../src/typescript/lib/component/container/WindowHeader.ts#L171)),
   which currently advertises "no subclass field … safe when called via `super()`":
   it now reads `this._titleGlyph` behind the guard, so reword the remark to say it
   touches the guarded subclass field (still `super()`-safe via the `if`), or the
   comment becomes stale. The title glyph is and stays a **plain `Glyph`**
   ([WindowHeader.ts:240-241](../src/typescript/lib/component/container/WindowHeader.ts#L240);
   the comment at 234-239 says it was "Kept a plain Glyph rather than a
   control-peer button") — there is **no** 24×24 control-peer box on this path;
   only the glyph ink scales. — verify: `npm run typecheck`; title glyph grows
   when the base var is raised (smoke test).

8. **Tab close-button + close-glyph** in
   [`TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts): replace the
   `CLOSE_BUTTON_SIZE = 16` and `CLOSE_GLYPH_SIZE = 8`
   ([TabBar.ts:43-46](../src/typescript/lib/component/container/TabBar.ts#L43))
   reads with `resolveScaleToken(theme.scale.tabClose, base)` /
   `resolveScaleToken(theme.scale.tabCloseGlyph, base)` resolved at layout time.
   The consumers are:
   - `pinGlyphSize(CLOSE_GLYPH_SIZE)`
     ([TabBar.ts:1517](../src/typescript/lib/component/container/TabBar.ts#L1517)),
   - the close-button reservation in `computeTabButtonInsets`
     ([TabBar.ts:1772](../src/typescript/lib/component/container/TabBar.ts#L1772),
     `closeReserve = constraints?.closeable ? CLOSE_BUTTON_SIZE : 0`) — **the
     third `CLOSE_BUTTON_SIZE` consumer the prior draft missed**,
   - the close-button width/height
     ([TabBar.ts:2436-2437](../src/typescript/lib/component/container/TabBar.ts#L2436)),
   - and the centring math
     ([TabBar.ts:2443-2449](../src/typescript/lib/component/container/TabBar.ts#L2443)).

   Route each through a single resolved-px local per layout pass so one read
   feeds all uses. — verify: `npm run typecheck`.

9. **Tab button insets** in `TabBar.ts`: replace `TAB_BUTTON_INSET = 4` /
   `TAB_BUTTON_INSET_COMPACT = 2`
   ([TabBar.ts:53-56](../src/typescript/lib/component/container/TabBar.ts#L53))
   reads in `computeTabButtonInsets`
   ([TabBar.ts:1771](../src/typescript/lib/component/container/TabBar.ts#L1771))
   and the two other inset reads
   ([TabBar.ts:1804](../src/typescript/lib/component/container/TabBar.ts#L1804),
   [1943](../src/typescript/lib/component/container/TabBar.ts#L1943)) with
   `resolveScaleToken(theme.scale.tabButtonInset, base)` (compact = that result
   `round`ed `/2`), resolved per layout pass. When `tabButtonInset` is the
   `{ fixed }` form the compact half still derives from the resolved px, so the
   compact relationship holds for both token forms. The owner's existing
   `onThemeChange → scheduleLayout`
   ([Tab.ts:317-318](../src/typescript/lib/layout/Tab.ts#L317)) re-resolves them
   on theme/base change — no new wiring. — verify: `npm run typecheck`.

10. **Leave `ProgressSpinner.ts`'s `readThemeFontSizePx` unchanged.** It is a
    module-level free function
    ([ProgressSpinner.ts:29](../src/typescript/lib/component/display/ProgressSpinner.ts#L29))
    that reads `--ts-ui-font-size` — the *control* font size, not the framework
    base. Migrating it to `readBaseSizePx()` would be a semantic change (spinner
    starts tracking the base var) for zero visible benefit while base ==
    font-size. The two readers share a body shape but read different vars by
    design; note this in the commit. — verify:
    `grep -n 'readThemeFontSizePx' src/typescript/lib/component/display/ProgressSpinner.ts`
    still present, unchanged.

11. **Typecheck + grep invariants + smoke test** (see Verification).

### Regression checkpoints

- `grep -rn "LEAD_GLYPH_INK_SIZE" src/typescript/lib` — expect 0 after step 7.
- `grep -rnE "CLOSE_BUTTON_SIZE|CLOSE_GLYPH_SIZE|TAB_BUTTON_INSET" src/typescript/lib/component/container/TabBar.ts`
  — the literal px **reads** in `TabBar` are gone, including the
  `computeTabButtonInsets` `closeReserve` read at line 1772; the names may
  survive only as documented fallback definitions if any are kept.
- `grep -rnE "TabReorderBar.THICKNESS|indicator.thickness" src/typescript/lib`
  — unchanged (fixed-by-design tokens stay).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Theme.ts` (`ScaleToken` type, `scale` block on `Theme`, `--ts-ui-base-size` in `themeToVars`, exported `readBaseSizePx` + `resolveScaleToken`) |
| Modify | `src/typescript/lib/core/themes/BaseTheme.ts` (`scale` values as `{ scale: … }` tokens) |
| Modify | `src/typescript/lib/core/index.ts` (export `ScaleToken`, `readBaseSizePx`, `resolveScaleToken`) |
| Modify | `src/typescript/lib/component/container/WindowHeader.ts` (title-glyph ratio at `setGlyph` + re-pin in `updatePreferredSize`) |
| Modify | `src/typescript/lib/component/container/TabBar.ts` (close-button/glyph + inset ratios at layout time, incl. `computeTabButtonInsets` `closeReserve`) |

No files created or deleted.

---

## Verification

There is **no test runner** in this project — `package.json` has `dev`,
`typecheck`, `build`, `docs:*`, `lint`, and `test:lint` (two eslint-rule node
scripts) only; no `.test.ts`/`.spec.ts` and no `test` script. Every check below
is a typecheck, a grep invariant, or a manual smoke test. (The `defineTheme`
JSDoc references a "theme regression test"
[Theme.ts:660](../src/typescript/lib/core/Theme.ts#L660) that does **not** exist
in the tree — do not rely on it; theme completeness is checked here by the grep
in step 3 plus the typecheck.)

- **Typecheck:** `npm run typecheck` — 0 errors.
- **Theme completeness (manual):** the step-3 grep confirms all five `scale`
  keys are present in `BaseTheme` with a single well-formed arm each (the type
  cannot enforce this under `DeepPartial`).
- **Base var present:** in the running app (`npm run dev`,
  http://localhost:8015), confirm
  `getComputedStyle(document.documentElement).getPropertyValue('--ts-ui-base-size')`
  is `"14px"` and `readBaseSizePx()` returns `14`.
- **No behavioural drift at default base:** open the **`TabDemoPanel`**
  ([src/typescript/TabDemoPanel.ts](../src/typescript/TabDemoPanel.ts)) and a
  `Window`/`TabWindow` with a title glyph — tab close buttons, insets, and the
  title icon look identical to pre-change at the default base (`base == 14`).
- **Scaling smoke test (load-bearing):** raise the base — set the active theme's
  `scale.base` to e.g. `28` (or override `--ts-ui-base-size` in DevTools and call
  `ThemeManager.setTheme(ThemeManager.getTheme())` to re-run the layout pass) —
  and confirm the **SVG glyphs now follow**: the window title glyph grows from
  ~14px toward ~28px, and the tab close glyph / close button / insets scale up so
  the close ✕ no longer looks tiny against a large tab label. This is the
  motivating bug resolving. Scope DevTools queries to `.TabDemoPanel .TabPanel`
  so you measure the visible instance, not a hidden sibling (per the project
  DevTools-scope note).
- **Theme-level px override:** set a token to the fixed form (e.g.
  `scale.titleGlyph: { fixed: 20 }`) and confirm the title glyph renders at 20px
  and **stays 20px when the base is raised** — the `{ scale }` form grows, the
  `{ fixed }` form does not.
- **Malformed-token robustness:** temporarily author a `scale` token as `{}` and
  confirm `resolveScaleToken` returns `base` (no NaN, no crash, glyph renders at
  base px) — proving the `DeepPartial`-robust resolver. Revert afterwards.
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
- **Curated page:** the Theme system page under `docs/core/` (covering `Theme` /
  `ThemeManager` / `defineTheme`) gains a short "Base size & scaling" note
  documenting `--ts-ui-base-size`, the `scale` block (including the
  ratio-vs-absolute-px token form **and the `DeepPartial` caveat** — exactly-one
  is not enforced inside a theme literal, so `resolveScaleToken` guards it),
  `readBaseSizePx`, and `resolveScaleToken`. Update that group's catalog
  `index.md` and the sidebar in `docs/.vitepress/config.mts` if a new
  heading/anchor is added.
- **JSDoc:** `ScaleToken`, `readBaseSizePx`, `resolveScaleToken`, and the `scale`
  block carry full TSDoc. Cross-bucket references to `Theme`/`ThemeManager` use
  markdown links, not `{@link}`, per `_shared/docs-conventions.md`.

---

## Potential Challenges

- **`DeepPartial` weakens `ScaleToken` at the authoring site.** Exactly-one is
  *not* compile-enforced inside `BaseTheme` — route every read through
  `resolveScaleToken` (which guards `scale`, then `fixed`, else `base`), and rely
  on the step-3 grep + the malformed-token smoke test, not the type, for
  completeness.
- **Subclass-field super-cascade.** `_titleGlyph` is `undefined` while
  `updatePreferredSize` runs during `super()`; the `if (this._titleGlyph)` guard
  makes the re-pin a no-op then and only fires post-init (the class-field
  super-cascade trap).
- **`onThemeChange` does not fire on subscribe.** The first pin happens at
  `setGlyph` time (construction default or explicit call); the
  `updatePreferredSize` re-pin only covers *subsequent* theme changes (the defer
  plan's one-shot first-read seam,
  [defer-construction-time-theme-reads.md:18-20](implemented/defer-construction-time-theme-reads.md#L18)).
- **Rounding drift.** `round(14 × 8/14) = 8` and `round(14 × 16/14) = 16` recover
  the exact current px at the default base — confirm each ratio round-trips so
  Phase A/B introduce zero pixel drift before scaling is exercised.
- **No new listener on WindowHeader.** Re-pin inside the inherited-and-overridden
  `updatePreferredSize`, which `Header` already drives on theme change. Do **not**
  add a fresh `ThemeManager.onThemeChange` closure — WindowHeader has no teardown
  hook to unsubscribe it.
- **Char-mode glyphs and text already size off the font var.** This plan does not
  rewire them to `--ts-ui-base-size`; the numeric ratio path is for SVG boxes and
  JS constants only. Don't double-apply a ratio to char-mode glyphs.

---

## Critical Files

- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) —
  the `Theme` interface ([42](../src/typescript/lib/core/Theme.ts#L42)),
  `font.size` ([47](../src/typescript/lib/core/Theme.ts#L47)), `DeepPartial`
  ([609-611](../src/typescript/lib/core/Theme.ts#L609)), `defineTheme` +
  completeness note ([654-671](../src/typescript/lib/core/Theme.ts#L654)),
  `themeToVars` ([700](../src/typescript/lib/core/Theme.ts#L700)),
  `--ts-ui-font-size` emit ([703](../src/typescript/lib/core/Theme.ts#L703)),
  `--ts-ui-table-cell-height` ([796](../src/typescript/lib/core/Theme.ts#L796)),
  `table.cell.padding` ([312](../src/typescript/lib/core/Theme.ts#L312)),
  `onThemeChange` ([1002](../src/typescript/lib/core/Theme.ts#L1002)),
  `setTheme`'s root-font write ([1033](../src/typescript/lib/core/Theme.ts#L1033)).
- [`src/typescript/lib/core/themes/BaseTheme.ts`](../src/typescript/lib/core/themes/BaseTheme.ts) —
  `DeepPartial<Theme>`-typed scaffold ([16](../src/typescript/lib/core/themes/BaseTheme.ts#L16));
  `font.size` and structural sizes live here
  ([17-48](../src/typescript/lib/core/themes/BaseTheme.ts#L17)).
- [`src/typescript/lib/component/display/Glyph.ts`](../src/typescript/lib/component/display/Glyph.ts) —
  the crux: `setPreferredSize` pins min/pref/max
  ([280-286](../src/typescript/lib/component/display/Glyph.ts#L280)),
  `setFontSize` SVG no-op ([337](../src/typescript/lib/component/display/Glyph.ts#L337)),
  SVG `<use>` render path ([633-647](../src/typescript/lib/component/display/Glyph.ts#L633)).
- [`src/typescript/lib/component/display/ProgressSpinner.ts:29-35`](../src/typescript/lib/component/display/ProgressSpinner.ts#L29) —
  `readThemeFontSizePx`, the proven module-level free function to mirror in
  `readBaseSizePx` (reads `--ts-ui-font-size`; stays unchanged).
- [`src/typescript/lib/component/display/Header.ts:80-82`](../src/typescript/lib/component/display/Header.ts#L80) —
  the no-cleanup `onThemeChange → updatePreferredSize` listener WindowHeader
  inherits and reuses for the glyph re-pin.
- [`src/typescript/lib/component/container/WindowHeader.ts`](../src/typescript/lib/component/container/WindowHeader.ts) —
  `LEAD_GLYPH_INK_SIZE` ([30](../src/typescript/lib/component/container/WindowHeader.ts#L30)),
  `_titleGlyph` field ([69](../src/typescript/lib/component/container/WindowHeader.ts#L69)),
  `updatePreferredSize` override ([174-182](../src/typescript/lib/component/container/WindowHeader.ts#L174)),
  `setGlyph` pin ([228-248](../src/typescript/lib/component/container/WindowHeader.ts#L228),
  the `setPreferredSize` call at [241](../src/typescript/lib/component/container/WindowHeader.ts#L241));
  no `destroy`/`dispose`/`_themeCleanup` exists.
- [`src/typescript/lib/component/container/TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts) —
  the close/inset constants ([43-56](../src/typescript/lib/component/container/TabBar.ts#L43)),
  `pinGlyphSize` call ([1517](../src/typescript/lib/component/container/TabBar.ts#L1517)),
  `computeTabButtonInsets` ([1770-1772](../src/typescript/lib/component/container/TabBar.ts#L1770),
  incl. the `CLOSE_BUTTON_SIZE` `closeReserve` read at 1772), the other inset
  reads ([1804](../src/typescript/lib/component/container/TabBar.ts#L1804),
  [1943](../src/typescript/lib/component/container/TabBar.ts#L1943)), close-button
  placement ([2436-2449](../src/typescript/lib/component/container/TabBar.ts#L2436)).
- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) —
  the `onThemeChange → scheduleLayout` seam that re-resolves `TabBar`'s reads
  ([317-318](../src/typescript/lib/layout/Tab.ts#L317)); cleanup stored in
  `_themeCleanup` ([304](../src/typescript/lib/layout/Tab.ts#L304)), invoked in
  `detach` ([864-866](../src/typescript/lib/layout/Tab.ts#L864)).
- [`src/typescript/lib/component/button/Button.ts:1030`](../src/typescript/lib/component/button/Button.ts#L1030) —
  `pinGlyphSize(px)`, the explicit-px escape hatch the ratio path feeds.
- [`src/typescript/lib/core/index.ts:45-46`](../src/typescript/lib/core/index.ts#L45) —
  the core barrel; new symbols join the existing `Theme`/`DeepPartial` exports.
- [`plans/implemented/tab-font-relative-sizing.md`](implemented/tab-font-relative-sizing.md) —
  the Phase 2 sketch this plan delivers; mirror its reasoning.
- [`plans/implemented/defer-construction-time-theme-reads.md`](implemented/defer-construction-time-theme-reads.md) —
  the render-time-read rule the numeric reads must follow.

---

## Non-Goals

- **No CSS-side scaling.** No component stylesheet is rewritten to consume
  `--ts-ui-base-size`; Phase A only *publishes* the var. Text and char-mode
  glyphs keep sizing off `--ts-ui-font-size` / the `:root` font. CSS-side
  `calc(<ratio> * var(--ts-ui-base-size))` is a future plan.
- **No framework-wide constant retrofit.** Menu `PANEL_WIDTH`, Split
  `GUTTER_SIZE`, Border `TRACK_SIZE`, Table `CHAR_WIDTH`/`HEADER_PAD` keep their
  fixed px — unblocked for follow-up plans, not migrated here (per
  [tab-font-relative-sizing.md:193-206](implemented/tab-font-relative-sizing.md#L193)).
- **No migration of fixed-by-design tokens.** Hairlines/borders,
  `TabReorderBar.THICKNESS` (2px), the `2px solid` focus indicators, and
  `tab.indicator.thickness` stay fixed px — the settled scaled-vs-fixed split.
- **No change to `ProgressSpinner`'s reader.** It keeps reading
  `--ts-ui-font-size` by design.
- **No cosmetic padding.** Migration preserves existing visual sizes at the
  default base; no breathing room added.
- **No change to `STRIP_THICKNESS` / `SCROLL_ARROW_SIZE` / `SCROLL_ARROW_STEP`.**
  Already settled by the implemented tab plan.
- **No coupling to the app's `:root { font-size }`.** The scale root is the
  framework-owned `--ts-ui-base-size`, not CSS `rem` / the host's root font.
- **No `scale.base` ≠ `font.size` reconfiguration in the first pass.** They are
  valued equal; decoupling them for a distinct "chrome scale vs text scale" is a
  future plan.
- **No `DeepPartial` rework.** We do not special-case the `ScaleToken` union in
  the generic `DeepPartial` utility; the runtime guard in `resolveScaleToken`
  carries that weight instead.
