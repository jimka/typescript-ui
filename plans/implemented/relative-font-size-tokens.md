# Relative Font-Size Tokens — Implementation Plan

## Overview

Extend the theme's base-size/scaling system to **font sizes**, mirroring the
reasoning of the already-merged glyph-scale work
([`plans/implemented/base-size-ratio-scaling.md`](implemented/base-size-ratio-scaling.md))
— one base anchor, per-token sizes expressed *relative* to it — but routed
through CSS `calc()` instead of the JS `ResolvedScale` snapshot. A theme author
can omit a font token (inherit the base), write an offset (`'+2px'` / `'-2px'`),
write a ratio (`{ scale: 1.2 }`), or keep a plain absolute length (`'13px'` /
`'1.2rem'`) exactly as today.

The base anchor already exists: `theme.font.size` is a CSS length string
([Theme.ts:63](../src/typescript/lib/core/Theme.ts#L63)), emitted as
`--ts-ui-font-size` by `themeToVars`
([Theme.ts:792](../src/typescript/lib/core/Theme.ts#L792)). The five non-base
font tokens — `button.font.size`
([Theme.ts:95](../src/typescript/lib/core/Theme.ts#L95)),
`button.description.fontSize`
([Theme.ts:98](../src/typescript/lib/core/Theme.ts#L98)), `header.font.size`
([Theme.ts:302](../src/typescript/lib/core/Theme.ts#L302)),
`table.header.font.size`
([Theme.ts:312](../src/typescript/lib/core/Theme.ts#L312)), and
`table.sortBadge.fontSize`
([Theme.ts:343](../src/typescript/lib/core/Theme.ts#L343)) — are currently
required `string`s emitted verbatim as CSS vars
([Theme.ts:803-804](../src/typescript/lib/core/Theme.ts#L803),
[875](../src/typescript/lib/core/Theme.ts#L875),
[878](../src/typescript/lib/core/Theme.ts#L878),
[897](../src/typescript/lib/core/Theme.ts#L897)). Their `BaseTheme` values are
clean negative offsets from the `14px` base
([BaseTheme.ts:19,27,29,47,51,63](../src/typescript/lib/core/themes/BaseTheme.ts#L19)):
button `12`, description `11`, header `12`, table.header `13`, sortBadge `10`.

Scope: a new `FontSizeToken` type + a `themeToVars`-side resolver in
[`Theme.ts`](../src/typescript/lib/core/Theme.ts), making the six font tokens
optional, re-expressing the five built-ins as offset strings in
[`BaseTheme.ts`](../src/typescript/lib/core/themes/BaseTheme.ts), rewiring the
consumption sites (CSS-`var()` fallbacks **and** the one inline-JS reader in
[`Text.ts`](../src/typescript/lib/component/input/Text.ts)), the core barrel
export, and docs.

---

## Architecture Decisions

### CSS `calc()` in `themeToVars`, NOT the JS `ResolvedScale` snapshot

This is the load-bearing decision. Fonts are sized by CSS `font-size`, so they
ride the cascade for free — a `calc(var(--ts-ui-font-size) + 2px)` emitted as a
custom property resolves to px on every element that consumes it, and re-resolves
automatically when the base var changes. The glyph snapshot
(`getResolvedScale` / `resolveScaleToken`
[Theme.ts:735-742](../src/typescript/lib/core/Theme.ts#L735) / `ResolvedScale`
[Theme.ts:711-721](../src/typescript/lib/core/Theme.ts#L711)) exists **only**
because an SVG glyph box is sized by its px `preferredSize`, not by CSS
`font-size`, so it cannot ride the cascade and must be frozen to a JS number once
per `setTheme`. Text has no such problem. Routing fonts through the snapshot would
px-freeze them at theme-apply time and throw the cascade away — and it is exactly
the CSS-side scaling the glyph plan deferred as a **Non-Goal** ("No CSS-side
scaling … CSS-side `calc(<ratio> * var(--ts-ui-base-size))` is a future plan"
[base-size-ratio-scaling.md Non-Goals](implemented/base-size-ratio-scaling.md)).
This plan delivers that CSS-side scaling for fonts. Confirmed against the merged
plan's Non-Goals.

So the work is a pure-string transformation inside `themeToVars`: a
`FontSizeToken` (or its absence) maps to the CSS string emitted for its var. No
new JS reader, no snapshot, no layout-pass resolution.

### Fonts anchor on `--ts-ui-font-size`, the text base — not `--ts-ui-base-size`

The relative tokens resolve against `var(--ts-ui-font-size)` (the control font
base), **not** `var(--ts-ui-base-size)` (the glyph/chrome base from the glyph
plan). The two carry the same `14px` value today, but they are conceptually
distinct scales: `--ts-ui-base-size` moves SVG/layout chrome, `--ts-ui-font-size`
moves the type scale. A relative *font* token belongs on the text scale.

### A distinct `FontSizeToken` type — not the glyph `ScaleToken`

`ScaleToken` ([Theme.ts:45](../src/typescript/lib/core/Theme.ts#L45)) resolves to
a **JS px number**; `FontSizeToken` resolves to a **CSS string** (often a
`calc()`). The output domains differ, so they are different types — reusing
`ScaleToken` would conflate the snapshot path with the cascade path. Shape:

```ts
type FontSizeToken =
    | string                 // absolute CSS length ('13px', '1.2rem') OR an offset ('+2px' / '-2px')
    | { scale: number };     // ratio of the base → calc(var(--ts-ui-font-size) * n)
```

The string arm carries two cases distinguished by a leading-sign regex: a bare
length passes through unchanged; a `+Npx`/`-Npx` offset becomes a `calc()`. Both
absence (optional token omitted) and a malformed token degrade to the base var.
`font.size` itself is the base anchor and stays a plain length — never relative
to itself, and is **not** a `FontSizeToken`.

### The resolver — `resolveFontSizeToken(token): string`

A module-level free function in `Theme.ts`, called by `themeToVars` per font
token. Exact behaviour per arm:

```ts
// Matches a signed pixel offset: '+2px', '-2px', '+0.5px'. Whole/decimal, px only.
const FONT_SIZE_OFFSET = /^([+-])(\d+(?:\.\d+)?)px$/;

/**
 * Resolves a FontSizeToken to the CSS string themeToVars emits for it.
 * `undefined` (optional token omitted) and any unrecognised shape fall back to
 * the base var, so a malformed theme degrades to the base font size — visibly,
 * never NaN/crash.
 */
function resolveFontSizeToken(token: FontSizeToken | undefined): string {
    if (token === undefined) return 'var(--ts-ui-font-size)';

    if (typeof token === 'object' && typeof token.scale === 'number') {
        return `calc(var(--ts-ui-font-size) * ${token.scale})`;
    }

    if (typeof token === 'string') {
        const m = FONT_SIZE_OFFSET.exec(token.trim());
        if (m) {
            const op = m[1];                 // '+' | '-'
            return `calc(var(--ts-ui-font-size) ${op} ${m[2]}px)`;
        }
        return token;                        // plain absolute length, unchanged
    }

    return 'var(--ts-ui-font-size)';         // malformed → base
}
```

Notes on the chosen rules:

- **Offset unit is `px` only.** The regex restricts the offset to `px`. A theme
  author who wants a `rem`/`em` offset can write the full `calc()` themselves as a
  plain string (it passes through the string arm verbatim). Restricting the parsed
  form to `px` keeps the regex tight and the intent unambiguous; mixing units in a
  bare-`calc()` against a `px` base is the author's call, not the resolver's.
- **A plain `'+2px'` is treated as an offset, not a length** — a leading sign is
  the disambiguator. Bare lengths (`'13px'`, `'1.2rem'`, `'90%'`) have no leading
  sign and fall through unchanged.
- **No `op` flip needed** — the matched sign is emitted directly into the
  `calc()`, so `'+2px'` → `calc(var(--ts-ui-font-size) + 2px)` and `'-2px'` →
  `calc(var(--ts-ui-font-size) - 2px)`.
- **Whitespace inside the `calc()` around the operator is required** — CSS
  `calc()` rejects `1px-2px` but accepts `1px - 2px`; the template literal spaces
  them.

### `DeepPartial` weakens the `{ scale }` arm — the resolver is the single robust chokepoint

`BaseTheme` is typed `DeepPartial<Theme>`
([BaseTheme.ts:16](../src/typescript/lib/core/themes/BaseTheme.ts#L16)), and
`DeepPartial` recurses into every object property
([Theme.ts:647-649](../src/typescript/lib/core/Theme.ts#L647)). So inside a theme
literal the `{ scale: number }` arm weakens to `{ scale?: number }` — `{}` and a
`scale`-missing object are **not** compile errors, exactly the lesson the glyph
plan recorded. The string arm is unaffected (strings aren't object types). The
resolver therefore guards the object arm explicitly (`typeof token.scale ===
'number'`) and falls back to the base var for `{}` / both-missing / any
unrecognised shape, rather than emitting `calc(... * undefined)` (which would be a
broken CSS string the cascade silently drops, leaving text at the browser
default). The runtime guard is the single chokepoint; we do **not** rework
`DeepPartial` to special-case the union — same call the glyph plan made.

### Making the six tokens optional means absence === base

`font.size?` and the five non-base tokens become optional (`size?:
FontSizeToken`, `fontSize?: FontSizeToken`). An omitted token resolves to
`var(--ts-ui-font-size)` in `themeToVars`, so the CSS var is always emitted with a
sensible value and downstream consumers never see a missing var. `font.size`
stays a `string` (not `FontSizeToken`) but is made optional too — when omitted,
`themeToVars` must still emit `--ts-ui-font-size` with a concrete fallback (`14px`,
which mirrors `BaseTheme.font.size` and must carry a comment saying so per the
CODE_CONVENTIONS magic-number rule — see step 5) so the base anchor every other
token references is never undefined. (In practice `BaseTheme` always provides
`font.size`, but the optionality must not leave the anchor var unemitted.)

### Built-in non-base tokens become fixed offset strings — zero drift at base 14

The five built-ins migrate from absolute px to offset strings: button `'-2px'`,
header `'-2px'`, table.header `'-1px'`, description `'-3px'`, sortBadge `'-4px'`.
At the default base these reproduce the current px **exactly** via
`calc(14px - Npx)`: `14-2=12`, `14-2=12`, `14-1=13`, `14-3=11`, `14-4=10`. This is
a theme-builder convenience: the offset stays constant when the base is raised
(button stays "2px below the base"), it does **not** scale proportionally — that
is the author's opt-in via `{ scale }`. The migration is a behaviour-preserving
re-expression, not a visual change.

### Consumption sites: CSS `var()` fallbacks rewire to the base var; one inline-JS reader needs a real fix

Two consumption styles exist, verified by grepping each var name and each
`theme.<path>` read across `src/`:

1. **CSS `var(--ts-ui-…-font-size, <hardcoded-px>)`** — pure cascade. These
   resolve a `calc()` correctly (proven below). Their hardcoded px fallbacks are
   rewired to `var(--ts-ui-font-size)` so an omitted token still inherits the base:
   - `MenuItem.ts:175` — `var(--ts-ui-button-font-size, 12px)` (a `setElementCSSRule`).
   - `SortPriorityBadge.ts:39` — `var(--ts-ui-sort-badge-font-size,10px)` (a `StyleRule`).
   - `Table.ts:467` — `var(--ts-ui-table-header-font-size, 13px)` passed as a CSS
     string into `Util.measureTextWidth`, which sets it on a real probe element
     ([Util.ts:110,133](../src/typescript/lib/core/Util.ts#L110)) — the cascade
     resolves the `calc()` on the probe, so this is calc-safe; only the `13px`
     fallback rewires.

2. **Inline-JS reader (`Text.setFontSize(varName)`)** — the load-bearing
   complication. `Button` / `Header` / table `Header` / `ParentHeader` size their
   label `Text` by binding a var name:
   `Button.ts:356` (`--ts-ui-button-font-size`),
   `Button.ts:649` (`--ts-ui-button-description-font-size`),
   `Header.ts:66` (`--ts-ui-header-font-size`),
   `cell/Header.ts:112` and `cell/ParentHeader.ts:54`
   (`--ts-ui-table-header-font-size`). `Text.setFontSize(string)`
   ([Text.ts:698-722](../src/typescript/lib/component/input/Text.ts#L698)) does
   **two** things with that var:
   (a) builds a CSS rule `var(name, <resolved>px)` into `_fontSizeCSSRule` and
   applies it to the element — fine, the cascade resolves it on the element;
   (b) reads the var off `:root` via
   `getComputedStyle(documentElement).getPropertyValue(name)` and `parseFloat`s it
   into a **JS number** stored in `_options.fontSize`
   ([Text.ts:705-709](../src/typescript/lib/component/input/Text.ts#L705)), and
   re-reads the same way on theme change
   ([Text.ts:140-152](../src/typescript/lib/component/input/Text.ts#L140)).

   **Where that JS number is — and is *not* — consumed.** Text WIDTH measurement
   does **not** use the `parseFloat`'d number: `calculateSize` passes
   `_fontSizeCSSRule` (the `var(name, <resolved>px)` string) straight to
   `Util.measureTextMetrics`
   ([Text.ts:354](../src/typescript/lib/component/input/Text.ts#L354)), which sets
   it as `font-size` on a real off-screen **probe** element
   ([Util.ts:97-116](../src/typescript/lib/core/Util.ts#L97)) where the cascade
   resolves the `calc()` correctly. **The width/probe path was always calc-safe.**
   The ONLY JS consumer of the `parseFloat`'d `_options.fontSize` number is
   `readThemeLineHeightPx`
   ([Text.ts:268-282](../src/typescript/lib/component/input/Text.ts#L268)), which
   feeds it into `Util.lineHeightPx({ fontSizePx })` to derive the
   **line-box-height / baseline floor** (`calculateSize` line 344, the
   `minLineHeight` ceiling and the `_measuredMinSize.height` floor at lines
   345/377). That floor — not the width — is the metric that regresses under
   `calc()`.

   **Verified in the running app:** `getPropertyValue` on a custom property
   holding a `calc()` returns the *unevaluated* string `"calc(14px - 2px)"`
   (var substituted, calc **not** computed), so `parseFloat` yields `NaN` — while a
   real element with that var as `font-size` computes to `"12px"`. So if these
   vars become `calc()`, the `if (!isNaN(parsed))` guard at
   [Text.ts:708](../src/typescript/lib/component/input/Text.ts#L708) is skipped,
   `_options.fontSize` is **left at its default `14`**
   ([Text.ts:63](../src/typescript/lib/component/input/Text.ts#L63)), and the
   line-box floor for a 12px button label computes as `round(14 + padding)` instead
   of `round(12 + padding)` — one px too tall — while the glyphs themselves render
   at the correct 12px (the cascade resolved them on the element). **This is the one
   site that needs a behavioural fix, not just a fallback rewire** (see _Internal
   Structure_). The fix must cover every post-attach derivation of that floor, not
   only `setFontSize` and the theme-change closure — see the next decision.

`TextInput.ts:93`, `Util.ts:88`, `Util.ts:350`, and `ProgressSpinner.ts:31` read
`--ts-ui-font-size` (the **base** anchor), which stays a plain length — they are
unaffected and not touched.

### Why fix `Text`'s reader by element-resolution, not by keeping fonts px

Keeping the five built-ins as plain `12px`/`13px`/… (so `parseFloat` keeps
working) would forfeit the whole feature — `{ scale }` and offset tokens would
break the same `parseFloat`. The correct fix is to make `Text`'s JS line-box
floor resolve the var the way the cascade does: read the **computed `font-size` of
an element** that has the var applied, not the raw custom-property string. `Text`
applies `font-size: var(name, …)` to its own element via the `#<id>`-scoped
stylesheet rule
([Text.ts:354,715,1105](../src/typescript/lib/component/input/Text.ts#L354)), so
once the element is attached and its style rule is flushed, the element's own
computed `font-size` is the resolved px. Resolve from `this.getElement()`'s
computed `font-size` instead of from the root custom property. This is a
self-contained change inside `Text` and matches how `Util.measureTextMetrics`
already resolves font CSS (probe element, not `parseFloat` of a var string).

### The element-resolution must cover `calculateSize`, not just `setFontSize` / theme-change

This is the correction that makes the fix complete. The **first** post-attach
measurement of a freshly-rendered label is **not** driven by `setFontSize` or a
theme change — it is `getPreferredSize` / `getBaseline` → `calculateSize` during
the initial `doLayout`
([Text.ts:433-436,415-418](../src/typescript/lib/component/input/Text.ts#L433)).
`setFontSize` already ran pre-attach during `applyOptions`, where its
`parseFloat` of the `calc()`-valued var yielded `NaN`, leaving `_options.fontSize`
at the default `14`. `calculateSize` → `readThemeLineHeightPx`
([Text.ts:268-282](../src/typescript/lib/component/input/Text.ts#L268)) then reads
that stale `14` straight from `_options.fontSize`/`_defaultOptions.fontSize` and
**never re-resolves it from the element**. So a 12px button label's line box is
computed off `14` on the very first paint and only self-heals after an unrelated
theme toggle re-runs the closure. Scoping the fix to `setFontSize`'s post-attach
branch and the theme closure alone (as the prior draft did) leaves this initial
render regressed.

The fix: a single `resolveBoundFontSizePx()` helper (below) is the authoritative
post-attach reader, and **`readThemeLineHeightPx` calls it** to obtain the
font-size it feeds to `Util.lineHeightPx`, falling back to the cached
`_options.fontSize`/`_defaultOptions.fontSize`/`14` only when the element isn't
resolvable yet. With the floor derived through the helper, the line box is correct
on the first `calculateSize` (initial paint), on every `setFontSize`, and on every
theme change — the three post-attach entry points — with no reliance on a later
theme toggle to correct it.

Pre-attach safety: `getElement()` is `null` before the element exists / before its
style rule is flushed, so `resolveBoundFontSizePx()` returns `null` and the cached
number is used. That degrades to exactly today's behaviour (correct for
plain-length tokens; the stale-`14` case only ever surfaces post-attach, where the
helper now resolves it), and `calculateSize` is itself deferred until post-attach
via `_measurementDirty`, so the helper's first *consumed* call already has a live
styled element. Only a `calc()`/`{ scale }` token needs the element read; a bare
length still resolves via `parseFloat` of the var as before.

### Pre-existing deviation this plan touches but does not introduce

`MenuItem.ts:175` sets its label font size with a raw
`setElementCSSRule("fontSize", "var(--ts-ui-button-font-size, 12px)")` — a font
CSS rule written inline rather than through a typed `Text.setFontSize` setter,
which is a deviation from the CODE_CONVENTIONS "DOM via typed setters" rule. This
plan rewires that line's hardcoded `12px` fallback to the base var (step 8) but
**does not introduce** the deviation and **does not** undertake to convert
`MenuItem` to a typed setter — that is out of scope here. Flagged so the
implementer doesn't mistake the touch for endorsement; converting it is a separate,
unrelated refactor.

---

## Public API (TypeScript Signatures)

```ts
// Theme.ts — new exported token type (sibling to ScaleToken)
/**
 * A theme font-size token, resolved to a CSS string by `themeToVars`. A bare
 * length string (`'13px'`, `'1.2rem'`) passes through unchanged; a signed pixel
 * offset string (`'+2px'`, `'-2px'`) becomes `calc(var(--ts-ui-font-size) ± Npx)`;
 * a `{ scale: n }` object becomes `calc(var(--ts-ui-font-size) * n)`. Omitting an
 * optional token inherits the base font size.
 */
export type FontSizeToken = string | { scale: number };
```

The six font tokens become optional on `Theme`:

```ts
interface Theme {
    font: { family: string; size?: string; linePadding: string };          // size now optional (base anchor)
    button: {
        font: { size?: FontSizeToken };
        description: { fontSize?: FontSizeToken; foreground: string; weight: string };
        // …
    };
    header: { font: { size?: FontSizeToken } };
    table: {
        header: { font: { size?: FontSizeToken }; /* … */ };
        sortBadge: { background: string; color: string; fontSize?: FontSizeToken };
    };
}
```

No new typed setter or `XOptions` field — no new DOM property is added; the change
is to theme tokens and the `themeToVars` emit. The new exported symbol is
`FontSizeToken`. `resolveFontSizeToken` stays a module-private free function
(internal to `themeToVars`, mirroring how the existing `themeToVars` /
`deepMerge` helpers are not exported).

---

## Theme Tokens

No **new** CSS custom properties. The six existing font vars change only in *how
their value is computed* inside `themeToVars` (from a verbatim string to a
resolved string):

| CSS Custom Property | Light/Dark Default (base 14) | Source token | Resolved value |
|---|---|---|---|
| `--ts-ui-font-size` | `14px` | `font.size` (plain length, or `14px` if omitted) | `14px` |
| `--ts-ui-button-font-size` | `12px` | `button.font.size` `'-2px'` | `calc(var(--ts-ui-font-size) - 2px)` |
| `--ts-ui-button-description-font-size` | `11px` | `button.description.fontSize` `'-3px'` | `calc(var(--ts-ui-font-size) - 3px)` |
| `--ts-ui-header-font-size` | `12px` | `header.font.size` `'-2px'` | `calc(var(--ts-ui-font-size) - 2px)` |
| `--ts-ui-table-header-font-size` | `13px` | `table.header.font.size` `'-1px'` | `calc(var(--ts-ui-font-size) - 1px)` |
| `--ts-ui-sort-badge-font-size` | `10px` | `table.sortBadge.fontSize` `'-4px'` | `calc(var(--ts-ui-font-size) - 4px)` |

`Theme.ts` blocks to touch: the `Theme` interface (make the six tokens optional,
type the five non-base ones `FontSizeToken`); `themeToVars` (wrap each of the six
emit lines in `resolveFontSizeToken(...)`). `BaseTheme.ts` carries the offset
strings; `ModernTheme` / `DarkTheme` / `ClassicTheme` inherit them via
`defineTheme` and need no change (they don't override font sizes — confirm with
the step-1 grep).

---

## Internal Structure

`Text`'s line-box-floor reader, resolved from the element instead of the raw var.
A single helper is the authoritative post-attach reader, and **all three
post-attach floor derivations route through it** — `setFontSize`, the
`onThemeChange` closure, and (the correction) `readThemeLineHeightPx` (reached by
the initial `calculateSize`). Add:

```ts
// Resolves the bound font-size var to px the way the cascade renders it: read
// the element's computed font-size (the var/calc is already applied via the
// #<id>-scoped style rule), not the raw custom-property string —
// getPropertyValue returns an unevaluated 'calc(...)' for calc-valued vars,
// which parseFloat cannot read. Returns null pre-attach / before the style rule
// is flushed, so callers fall back to the cached number.
private resolveBoundFontSizePx(): number | null {
    if (!this._fontSizeCSSVar) return null;   // explicit numeric size — no var bound
    const el = this.getElement();             // null-safe: only resolves post-attach
    if (!el) return null;
    const parsed = parseFloat(getComputedStyle(el).fontSize);
    return isNaN(parsed) ? null : parsed;
}
```

- **`readThemeLineHeightPx` (the load-bearing add — fixes initial render).** Before
  computing the floor, prefer the element-resolved size:
  `const fs = this.resolveBoundFontSizePx() ?? (this._options.fontSize …) ?? (this._defaultOptions.fontSize …) ?? 14;`
  then feed `fs` to `Util.lineHeightPx`
  ([Text.ts:268-282](../src/typescript/lib/component/input/Text.ts#L268)). This is
  the path the first `calculateSize` (during initial `doLayout`) takes, so the line
  box is correct on first paint instead of stale-`14`. Pre-attach, the helper
  returns `null` and the existing cached-number fallback is used — but
  `calculateSize` is deferred until post-attach via `_measurementDirty`, so the
  first *consumed* call already has a live styled element.
- **In `setFontSize(string)`:** after `setElementCSSRule("fontSize", rule)`, if the
  helper resolves (element attached), store its result into `_options.fontSize`; if
  not, keep the existing `parseFloat` of the var **as the pre-attach fallback** (it
  still works for plain-length tokens). The element-read is the authoritative path.
- **In the `onThemeChange` closure:** this fires post-attach (a theme change on a
  live component), so resolve via the helper. This keeps `_options.fontSize` in sync
  for any other reader, though with the `readThemeLineHeightPx` add above the floor
  no longer *depends* on this closure for correctness.
- **Re-resolution on a base change is automatic for CSS** (the `calc()` re-resolves
  in the cascade), and **for JS measurement** it rides the existing
  `onThemeChange → calculateSize` re-measure
  ([Text.ts:138-160](../src/typescript/lib/component/input/Text.ts#L138)) — no new
  wiring. A `setTheme` that only raises `font.size` is a theme change, so the
  closure runs and re-measures; and because the floor now reads the element, the
  re-measure picks up the new px directly.

Guard: `getComputedStyle` must run post-attach
([defer-construction-time-theme-reads.md](implemented/defer-construction-time-theme-reads.md));
`setFontSize` can run during `applyOptions` before attach, which is why the helper
is null-gated and the var-`parseFloat` is kept as the pre-attach fallback.
`readThemeLineHeightPx` is only ever reached from `calculateSize`, which is itself
post-attach-deferred, so its helper call resolves on first use.

---

## Ordered Implementation Steps

1. **Confirm no built-in theme overrides a font token** (so re-expressing the
   five built-ins in `BaseTheme` is the only value change). — verify:
   `grep -rnE "font *: *\{ *size|fontSize *:" src/typescript/lib/core/themes/*.ts`
   shows the five only in `BaseTheme.ts`.

2. **Add the exported `FontSizeToken` type** in `Theme.ts`, next to `ScaleToken`
   ([Theme.ts:45](../src/typescript/lib/core/Theme.ts#L45)), with the JSDoc from
   the Public API block. — verify: `npm run typecheck`.

3. **Make the six font tokens optional and type the five non-base ones
   `FontSizeToken`** on the `Theme` interface: `font.size?` stays `string`
   ([Theme.ts:63](../src/typescript/lib/core/Theme.ts#L63)); `button.font.size?`
   ([95](../src/typescript/lib/core/Theme.ts#L95)),
   `button.description.fontSize?` ([98](../src/typescript/lib/core/Theme.ts#L98)),
   `header.font.size?` ([302](../src/typescript/lib/core/Theme.ts#L302)),
   `table.header.font.size?` ([312](../src/typescript/lib/core/Theme.ts#L312)),
   `table.sortBadge.fontSize?` ([343](../src/typescript/lib/core/Theme.ts#L343))
   become `FontSizeToken`. — verify: `npm run typecheck`.

4. **Add the module-private `resolveFontSizeToken` + the `FONT_SIZE_OFFSET`
   regex** in `Theme.ts` (body from _Architecture Decisions_), above
   `themeToVars`. — verify: `npm run typecheck`.

5. **Wrap the six emit lines in `themeToVars`** through the resolver
   ([Theme.ts:792](../src/typescript/lib/core/Theme.ts#L792),
   [803-804](../src/typescript/lib/core/Theme.ts#L803),
   [875](../src/typescript/lib/core/Theme.ts#L875),
   [878](../src/typescript/lib/core/Theme.ts#L878),
   [897](../src/typescript/lib/core/Theme.ts#L897)). For the base anchor:
   `'--ts-ui-font-size': theme.font.size ?? '14px'`. The `'14px'` literal
   **duplicates `BaseTheme.font.size`**
   ([BaseTheme.ts:19](../src/typescript/lib/core/themes/BaseTheme.ts#L19)) — per the
   CODE_CONVENTIONS magic-number rule, add an inline comment noting it mirrors
   `BaseTheme.font.size` and only applies when a theme omits `font.size` entirely
   (which the built-ins never do; the fallback exists so the anchor var every other
   token references is never unemitted). For the other five:
   `resolveFontSizeToken(theme.button.font.size)` etc. — verify: `npm run typecheck`.

6. **Re-express the five built-ins as offset strings in `BaseTheme.ts`**:
   `button.font.size: '-2px'` ([27](../src/typescript/lib/core/themes/BaseTheme.ts#L27)),
   `button.description.fontSize: '-3px'` ([29](../src/typescript/lib/core/themes/BaseTheme.ts#L29)),
   `header.font.size: '-2px'` ([47](../src/typescript/lib/core/themes/BaseTheme.ts#L47)),
   `table.header.font.size: '-1px'` ([51](../src/typescript/lib/core/themes/BaseTheme.ts#L51)),
   `table.sortBadge.fontSize: '-4px'` ([63](../src/typescript/lib/core/themes/BaseTheme.ts#L63)).
   Leave `font.size: '14px'` ([19](../src/typescript/lib/core/themes/BaseTheme.ts#L19))
   as the plain base. Comment each offset as "base − N". — verify: `npm run typecheck`.

7. **Export `FontSizeToken` from the core barrel**
   ([index.ts:48](../src/typescript/lib/core/index.ts#L48)), alongside
   `ScaleToken` in the existing `export type { Theme, DeepPartial, ScaleToken,
   ResolvedScale }`. — verify:
   `grep -n "FontSizeToken" src/typescript/lib/core/index.ts` → 1 hit.

8. **Rewire the three CSS-`var()` fallbacks to the base var** (so an omitted token
   inherits the base, not a stale px constant):
   - `MenuItem.ts:175` → `var(--ts-ui-button-font-size, var(--ts-ui-font-size))`.
   - `SortPriorityBadge.ts:39` → `var(--ts-ui-sort-badge-font-size, var(--ts-ui-font-size))`.
   - `Table.ts:467` → `var(--ts-ui-table-header-font-size, var(--ts-ui-font-size))`.
   — verify: `npm run typecheck`;
   `grep -rnE "font-size, *1[0-3]px\)" src/` → 0 hits.

9. **Fix `Text`'s line-box-floor reader** per _Internal Structure_: add
   `resolveBoundFontSizePx()`, and route **`readThemeLineHeightPx`**
   ([Text.ts:268-282](../src/typescript/lib/component/input/Text.ts#L268)) (the path
   the initial `calculateSize` takes — this is the fix that corrects first paint),
   the `onThemeChange` re-read
   ([Text.ts:140-152](../src/typescript/lib/component/input/Text.ts#L140)), and the
   `setFontSize(string)` post-attach branch
   ([Text.ts:705-715](../src/typescript/lib/component/input/Text.ts#L705)) through
   it, keeping the var-`parseFloat` only as the pre-attach fallback. — verify:
   `npm run typecheck`; smoke test (step below) confirms a button/header label's
   **line-box height / baseline** is correct at INITIAL render (before any theme
   toggle) at base 14, and grows when the base is raised.

10. **Typecheck + grep invariants + smoke + docs build** (see Verification).

### Regression checkpoints

- `grep -rnE "font-size, *1[0-3]px\)|font-size,1[0-3]px\)" src/` — 0 hits (all
  hardcoded px font fallbacks rewired to the base var).
- `grep -rn "getPropertyValue" src/typescript/lib/component/input/Text.ts` — the
  two font-size root reads (the `onThemeChange` closure ~141 and `setFontSize` ~705)
  are gone or behind the pre-attach fallback only; the authoritative read is the
  element-computed `getComputedStyle(el).fontSize` in `resolveBoundFontSizePx`. (The
  `_lineHeightCSSVar` read ~273 is unrelated and stays.)
- `grep -n "resolveBoundFontSizePx" src/typescript/lib/component/input/Text.ts` —
  defined once and called from `readThemeLineHeightPx`, `setFontSize`, and the
  `onThemeChange` closure (≥4 hits: the definition plus three call sites).
- `grep -rn "FontSizeToken" src/typescript/lib/core/` — type defined in `Theme.ts`
  and exported from `index.ts`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Theme.ts` (`FontSizeToken` type, `resolveFontSizeToken` + regex, six tokens optional, `themeToVars` routes the six emits through the resolver / base fallback) |
| Modify | `src/typescript/lib/core/themes/BaseTheme.ts` (five built-ins re-expressed as offset strings) |
| Modify | `src/typescript/lib/core/index.ts` (export `FontSizeToken`) |
| Modify | `src/typescript/lib/component/input/Text.ts` (add `resolveBoundFontSizePx`; route `readThemeLineHeightPx`, `setFontSize`, and the `onThemeChange` closure through it so the line-box floor reads the element's computed font-size on first paint) |
| Modify | `src/typescript/lib/component/container/MenuItem.ts` (fallback → base var) |
| Modify | `src/typescript/lib/component/table/cell/SortPriorityBadge.ts` (fallback → base var) |
| Modify | `src/typescript/lib/component/table/Table.ts` (fallback → base var) |
| Modify | `docs/concepts/theming.md` (token-table rows + "Relative font sizes" note) |

No files created or deleted. `Button.ts`, `Header.ts`, `cell/Header.ts`,
`cell/ParentHeader.ts` are **not** edited — they call `Text.setFontSize(varName)`,
and the fix lives inside `Text`.

---

## Verification

There is **no test runner** — `package.json` has `dev`, `typecheck`, `build`,
`docs:*`, `lint`, `test:lint` only; no `.test.ts`/`.spec.ts`, no `test` script.
Every check is a typecheck, grep invariant, or manual smoke.

- **Typecheck:** `npm run typecheck` — 0 errors.
- **Zero-drift at base 14 (no behavioural change):** open a screen with buttons
  ([`ToolBarPanel`](../src/typescript/ToolBarPanel.ts) /
  [`ComplexUIPanel`](../src/typescript/ComplexUIPanel.ts)), a window/panel header
  (any [`Window`](../src/typescript/lib/core/Window.ts) /
  [`WindowHeader`](../src/typescript/lib/component/container/WindowHeader.ts)), a
  table header + sort badge ([`MiscPanel`](../src/typescript/MiscPanel.ts), which
  has the stress table). Confirm the four font sizes look identical to pre-change.
  In DevTools, scoped to the visible instance:
  `getComputedStyle(document.documentElement).getPropertyValue('--ts-ui-button-font-size')`
  returns `"calc(14px - 2px)"`, and a button label's computed `font-size` is `12px`.
- **Line-box height correct at INITIAL render (the metric that actually regresses
  — load-bearing):** this is the check that catches the floor bug; it must be taken
  on a **freshly rendered** button/header label **before any theme toggle**. Width
  is *not* the metric — the probe/width path is calc-safe (the `_fontSizeCSSRule`
  `var(name, …)` string is set on the probe element, where the cascade resolves the
  `calc()`). The regressing metric is the line-box-height / baseline floor derived
  in `readThemeLineHeightPx` from the JS font-size number. Concretely: do a hard
  reload (no theme toggle), DevTools-scope to a visible button's label `Text`
  element, and confirm its rendered **row height / line box** matches the 12px-floor
  value (`round(12 + linePadding)`), **not** the 14px-floor value
  (`round(14 + linePadding)`). Equivalently, read the label's `getBaseline()` /
  bounding-rect height and confirm it equals the pre-change value. If the fix were
  scoped only to `setFontSize`/the theme closure (omitting `readThemeLineHeightPx`),
  this would show the 14-floor on first paint and self-correct only after a theme
  toggle — so explicitly verify it is correct **without** toggling.
- **Offset tracks the base (load-bearing):** raise the base — set the active
  theme's `font.size` to e.g. `'28px'` and `setTheme(it)` — and confirm every
  offset token tracks it: button label `28-2=26px`, table header `28-1=27px`, sort
  badge `28-4=24px`, all read off real elements' computed `font-size`. Confirm the
  **JS line-box floor** kept up: the labels' row heights / baselines grew to the new
  font's line box (no clipped or vertically-cramped labels) — this is the `Text`
  reader fix proving out on the line-box metric, not just the width.
- **Omitted token inherits the base:** author a `defineTheme` override that omits
  `button.font.size` (e.g. `{ button: { font: {} } }`), apply it, and confirm
  button labels render at the full base size (the `calc` is replaced by the bare
  `var(--ts-ui-font-size)` fallback) — no NaN, no browser-default font.
- **`{ scale }` is proportional:** set `table.sortBadge.fontSize: { scale: 1.2 }`,
  confirm the badge computes to `round(14 * 1.2) ≈ 16.8px` and to `33.6px` when the
  base is `28px`.
- **Malformed token degrades:** set a token to `{}` (allowed under `DeepPartial`)
  and confirm the consumer renders at the base font size (resolver fell back to
  `var(--ts-ui-font-size)`), no NaN/crash. Revert after.
- **Theme toggle:** Modern ↔ Dark ↔ Classic — font sizes stay stable (tokens live
  in `BaseTheme`, scheme-invariant).
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's
  "unsupported TypeScript version" notice is the lone acceptable warning), required
  because `FontSizeToken` is newly exported.

---

## Documentation Impact

- **Barrel:** `FontSizeToken` is exported from
  `src/typescript/lib/core/index.ts` (the core group barrel; there is no root
  barrel), surfacing under `docs/api/core/type-aliases`.
- **Curated page:** [`docs/concepts/theming.md`](../docs/concepts/theming.md) —
  the existing token-table rows for the font tokens
  ([33,44,75,78](../docs/concepts/theming.md#L33)) note that the five non-base
  tokens accept a `FontSizeToken` (absolute length / offset string / `{ scale }`)
  and inherit the base when omitted. **Two of the six font tokens are currently
  absent from the table and must get new rows** so all six font vars are
  documented: `button.description.fontSize`
  (`--ts-ui-button-description-font-size`) and `table.sortBadge.fontSize`
  (`--ts-ui-sort-badge-font-size`). Add a short **"Relative
  font sizes"** subsection (sibling to the existing "Base size & scaling" at
  [theming.md:111](../docs/concepts/theming.md#L111)) explaining the three forms,
  the `calc(var(--ts-ui-font-size) …)` resolution, that offsets stay constant while
  `{ scale }` is proportional, and the `DeepPartial` caveat (a theme literal can
  weaken `{ scale }`, so the resolver falls back to the base — mirroring the
  ScaleToken caveat already documented at
  [theming.md:130](../docs/concepts/theming.md#L130)).
- **`docs/recipes/custom-theme.md`** doesn't currently override a font size
  ([custom-theme.md:15](../docs/recipes/custom-theme.md#L15)); no change required,
  but a one-line "you can write `button: { font: { size: '+2px' } }`" aside is
  optional and low-value — leave it unless the author wants an example.
- **JSDoc:** `FontSizeToken` carries full TSDoc; cross-references to `Theme` use
  markdown links per `_shared/docs-conventions.md`.

---

## Potential Challenges

- **`getPropertyValue` returns unevaluated `calc()`** — proven in-app; the `Text`
  line-box-floor reader must resolve from a real element's computed `font-size`,
  not the root custom property. This is the single behavioural fix; everything else
  is string/fallback rewiring. Only the line-box-height / baseline floor regresses
  — the text-WIDTH path is calc-safe because it goes through the probe element in
  `Util.measureTextMetrics`, never through the `parseFloat`'d number.
- **The floor regresses on FIRST paint, not just on theme change** — the initial
  `getPreferredSize`/`getBaseline` → `calculateSize` → `readThemeLineHeightPx`
  reads the stale default `14` (pre-attach `setFontSize` couldn't `parseFloat` the
  `calc()`). The fix must therefore route `readThemeLineHeightPx` through the
  element-resolving helper, not only `setFontSize` and the theme closure; otherwise
  first paint shows a 14-floor and self-heals only after an unrelated theme toggle.
- **`DeepPartial` weakens `{ scale }`** — `{}` / `{ scale?: }` is not a compile
  error in a theme literal; the resolver guards `typeof token.scale === 'number'`
  and falls back to the base var. Don't rework `DeepPartial`.
- **CSS `calc()` whitespace** — `calc(var(--ts-ui-font-size) - 2px)` needs spaces
  around the operator; the template literal supplies them. A unitless or
  mismatched-unit offset is rejected by the regex and falls through (a bare unknown
  string is passed verbatim — author's responsibility).
- **Pre-attach `setFontSize`** — `setFontSize` runs during `applyOptions` before
  attach; the element-computed read is null-gated behind `getElement()` and the
  var-`parseFloat` stays as the pre-attach fallback. Correctness on first paint
  comes from `readThemeLineHeightPx` re-resolving through the helper at
  `calculateSize` time (which is post-attach-deferred), not from `setFontSize`.
- **`+`/`-` sign vs. bare length** — a leading sign is the only disambiguator;
  `'+2px'`/`'-2px'` are offsets, `'13px'`/`'1.2rem'`/`'90%'` are passed through.

---

## Critical Files

- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) —
  `ScaleToken` ([45](../src/typescript/lib/core/Theme.ts#L45)), the six font tokens
  on the `Theme` interface ([63](../src/typescript/lib/core/Theme.ts#L63),
  [95](../src/typescript/lib/core/Theme.ts#L95),
  [98](../src/typescript/lib/core/Theme.ts#L98),
  [302](../src/typescript/lib/core/Theme.ts#L302),
  [312](../src/typescript/lib/core/Theme.ts#L312),
  [343](../src/typescript/lib/core/Theme.ts#L343)), `DeepPartial`
  ([647-649](../src/typescript/lib/core/Theme.ts#L647)), `themeToVars` font emits
  ([792,803-804,875,878,897](../src/typescript/lib/core/Theme.ts#L792)),
  `ResolvedScale` ([711-721](../src/typescript/lib/core/Theme.ts#L711)) /
  `resolveScaleToken` ([735-742](../src/typescript/lib/core/Theme.ts#L735)) /
  `getResolvedScale` (the JS-snapshot path this plan deliberately does **not** use).
- [`src/typescript/lib/core/themes/BaseTheme.ts`](../src/typescript/lib/core/themes/BaseTheme.ts) —
  `DeepPartial<Theme>` scaffold ([16](../src/typescript/lib/core/themes/BaseTheme.ts#L16));
  the five font values ([19,27,29,47,51,63](../src/typescript/lib/core/themes/BaseTheme.ts#L19)).
- [`src/typescript/lib/component/input/Text.ts`](../src/typescript/lib/component/input/Text.ts) —
  `setFontSize` ([698-722](../src/typescript/lib/component/input/Text.ts#L698)),
  the `onThemeChange` re-read closure
  ([138-160](../src/typescript/lib/component/input/Text.ts#L138)),
  **`readThemeLineHeightPx`** (the line-box-floor reader the fix routes through —
  [268-282](../src/typescript/lib/component/input/Text.ts#L268)), `calculateSize`
  and its `readThemeLineHeightPx` calls
  ([324-345](../src/typescript/lib/component/input/Text.ts#L324)),
  `getPreferredSize`/`getBaseline` (the first post-attach entry into `calculateSize`
  — [415-436](../src/typescript/lib/component/input/Text.ts#L415)), the width-probe
  call passing `_fontSizeCSSRule`
  ([352-360](../src/typescript/lib/component/input/Text.ts#L352)), the default
  `_options.fontSize: 14` ([63](../src/typescript/lib/component/input/Text.ts#L63)),
  `_fontSizeCSSVar` / `_fontSizeCSSRule`
  ([100-101](../src/typescript/lib/component/input/Text.ts#L100)), the CSS-rule emit
  ([354,715,1105](../src/typescript/lib/component/input/Text.ts#L354)).
- [`src/typescript/lib/core/Util.ts`](../src/typescript/lib/core/Util.ts) —
  `measureTextMetrics` probe-element font resolution
  ([85-145](../src/typescript/lib/core/Util.ts#L85); the probe `font-size` is set at
  [110](../src/typescript/lib/core/Util.ts#L110), where the cascade resolves a
  `calc()` — this is why the width path is calc-safe) — the precedent for
  resolving font CSS via an element, and `--ts-ui-font-size`-only readers
  ([88,194,350](../src/typescript/lib/core/Util.ts#L88)) that stay untouched.
- The CSS-fallback consumers:
  [`MenuItem.ts:175`](../src/typescript/lib/component/container/MenuItem.ts#L175),
  [`SortPriorityBadge.ts:39`](../src/typescript/lib/component/table/cell/SortPriorityBadge.ts#L39),
  [`Table.ts:467`](../src/typescript/lib/component/table/Table.ts#L467).
- The inline-JS callers that bind a font var (no edit needed; fix is in `Text`):
  [`Button.ts:356,649`](../src/typescript/lib/component/button/Button.ts#L356),
  [`Header.ts:66`](../src/typescript/lib/component/display/Header.ts#L66),
  [`cell/Header.ts:112`](../src/typescript/lib/component/table/cell/Header.ts#L112),
  [`cell/ParentHeader.ts:54`](../src/typescript/lib/component/table/cell/ParentHeader.ts#L54).
- [`src/typescript/lib/core/index.ts:48`](../src/typescript/lib/core/index.ts#L48) —
  the core barrel; `FontSizeToken` joins the existing
  `Theme`/`DeepPartial`/`ScaleToken`/`ResolvedScale` type exports.
- [`plans/implemented/base-size-ratio-scaling.md`](implemented/base-size-ratio-scaling.md) —
  the glyph-scale sibling: mirror its `--ts-ui-…` base story and `DeepPartial`
  lesson; its Non-Goals confirm CSS-side scaling was deferred — this plan delivers
  it for fonts.

---

## Non-Goals

- **No JS `ResolvedScale` snapshot for fonts.** Fonts ride the CSS cascade via
  `calc()`; the `getResolvedScale`/`resolveScaleToken` snapshot stays glyph-only.
  Routing fonts through it would px-freeze text and discard the cascade.
- **No anchoring fonts on `--ts-ui-base-size`.** Relative font tokens resolve
  against `--ts-ui-font-size` (the text scale), not the glyph/chrome base.
- **No proportional scaling of the built-in offsets.** The five built-ins are
  fixed offsets (`'-Npx'`) by design — they stay a constant px below the base when
  it is raised. Proportional growth is the author's opt-in via `{ scale }`.
- **No non-`px` parsed offsets.** The offset regex accepts `px` only; a `rem`/`em`
  relative size is expressed as a full author-written `calc()` string (passes
  through the string arm) or a `{ scale }` ratio.
- **No new CSS custom properties.** The six existing font vars keep their names;
  only their computed value changes.
- **No retrofit of other size tokens.** Only the six font-size tokens become
  relative; cell heights, paddings, radii, and the glyph `scale` block are out of
  scope.
- **No edits to the font-var callers (`Button`/`Header`/table cells).** The
  line-box-floor resolution fix lives entirely inside `Text` (the new
  `resolveBoundFontSizePx` helper and the three call sites that route through it).
- **No conversion of `MenuItem`'s raw `setElementCSSRule("fontSize", …)` to a typed
  setter.** That pre-existing CODE_CONVENTIONS deviation is touched (its `12px`
  fallback rewires) but not fixed here — see _Architecture Decisions_.
