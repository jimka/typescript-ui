# Embedded Glyph — Component Implementation Plan

## Overview

Add a self-contained `Glyph` component that renders an icon from a small, hand-curated registry. The registry is a tagged union: an entry can be either inlined SVG path data (rendered as `<svg><path/></svg>`) or a single Unicode character (rendered as `<span>`). Both render forms follow `currentColor`, so glyphs integrate with the existing `--ts-ui-*` theme tokens without a new token.

This plan covers **the component only**. The existing FontAwesome dependency, the `WindowHeader` close-icon call site, and other adoption sites (buttons, menu items, tree arrows, table cells, icon-with-label) are addressed in a separate plan ([glyph-adoption.md](glyph-adoption.md)).

After this plan ships, `Glyph` exists and is exported, but no library code uses it yet. FontAwesome remains in place. That is intentional: keeping introduction and adoption separate makes each pass reviewable on its own.

---

## Architecture Decisions

### Curated registry

A single TypeScript file (`Glyphs.ts`) holds a frozen object literal mapping glyph name → `GlyphDef`. New glyphs are added by hand. No build-time tooling, no metadata parsing, no plugin. The cost of adding a glyph is one object property.

### Tagged-union `GlyphDef`

```ts
type GlyphDef =
    | { kind: "svg",  viewBox: string; path: string }
    | { kind: "char", char: string };
```

Callers always write `new Glyph("expand-arrow")` regardless of whether the entry is SVG or Unicode. The component looks at `def.kind` and dispatches accordingly. This keeps one API surface and lets a Unicode entry be upgraded to SVG later without touching any call site.

### Two DOM tags, one component

- `kind: "svg"` → root element is `<svg>` with a child `<path>`, both in the SVG namespace.
- `kind: "char"` → root element is `<span>` containing the character text.

The choice happens once at construction time. The component does **not** support changing the registry name after construction — switching the underlying tag mid-life would require tearing down and rebuilding the DOM element, which is more complexity than the use case warrants. If a future caller needs to swap the glyph, they discard the `Glyph` and create a new one.

### Sizing contract

Both render modes honour `setPreferredSize(16, 16)` set in the constructor (matches the prior `FontAwesomeIcon` default).

- SVG mode: the `<svg>` scales naturally to whatever box the layout gives it via `viewBox`.
- Char mode: the character renders at the component's current `font-size`. To make a Unicode glyph occupy the box visually like an SVG does, the component sets `font-size` and `line-height` to the component's height when the size is known. For the default 16×16, this means a 16px font-size.

### `currentColor` for theming

- SVG mode: the `<path>` is rendered with `fill="currentColor"`, and the component's foreground colour (CSS `color`) drives it.
- Char mode: text colour already follows `color` natively.

A glyph placed inside any text-coloured context (button label, menu item, tree row) inherits the surrounding colour for free. No glyph-specific theme token.

### Throw on unknown glyph names

If the name is not in the registry, throw at construction with a descriptive error. Silent fallbacks (empty SVG, placeholder character) hide developer typos.

### Callable export pattern

Match the project convention used by `Button`, `FontAwesomeIcon`, `MenuBarButton`, etc.: a class `_Glyph` plus a `callable(_Glyph)` re-export named `Glyph`. Consumers use the callable form.

---

## Public API (TypeScript Signatures)

### `Glyph` — `src/typescript/lib/component/display/Glyph.ts`

```typescript
export interface GlyphOptions extends ComponentOptions {
    // No glyph-specific options yet. Reserved for future use (e.g. setName).
}

export class Glyph extends Component {
    constructor(name: string, options?: GlyphOptions);

    /** Returns the registry name this Glyph was constructed with. */
    getName(): string;
}
```

### `Glyphs.ts` — `src/typescript/lib/component/display/Glyphs.ts` (internal registry)

```typescript
export type GlyphDef =
    | { kind: "svg",  viewBox: string; path: string }
    | { kind: "char", char: string };

export const Glyphs: Readonly<Record<string, GlyphDef>>;
```

Initial registry contents:

```ts
{
    // SVG entries
    times:        { kind: "svg", viewBox: "0 0 352 512", path: "<from svgs/solid/times.svg>" },

    // Unicode entries — covers Tree arrows and other ad-hoc Unicode glyphs already in the codebase
    "arrow-right": { kind: "char", char: "▶" },
    "arrow-down":  { kind: "char", char: "▼" },
}
```

The Unicode entries are seeded now so the adoption plan can convert [TreeRow.ts:98](../src/typescript/lib/component/tree/TreeRow.ts#L98) without further registry edits.

---

## Ordered Implementation Steps

### Step 1 — Extract the `times` path data

Read [src/resources/Base/script/fontawesome/svgs/solid/times.svg](../src/resources/Base/script/fontawesome/svgs/solid/times.svg) and capture its `viewBox` (expected `"0 0 352 512"`) and `<path d="...">` string. Both values go into the `times` registry entry verbatim.

### Step 2 — Create `Glyphs.ts`

`src/typescript/lib/component/display/Glyphs.ts`

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

export type GlyphDef =
    | { kind: "svg",  viewBox: string; path: string }
    | { kind: "char", char: string };

export const Glyphs: Readonly<Record<string, GlyphDef>> = Object.freeze({
    times:         { kind: "svg",  viewBox: "0 0 352 512", path: "..." /* from Step 1 */ },
    "arrow-right": { kind: "char", char: "▶" },
    "arrow-down":  { kind: "char", char: "▼" },
});
```

Use the escape form (`▶`, `▼`) rather than raw Unicode so the source file stays ASCII-clean.

### Step 3 — Create `Glyph.ts`

`src/typescript/lib/component/display/Glyph.ts`

Behaviour:

1. Constructor `(name: string, options?: GlyphOptions)`:
   - Look up `def = Glyphs[name]`; if missing, throw `Error("Unknown glyph: " + name)`.
   - Call `super({ tag: def.kind === "svg" ? "svg" : "span" })`.
   - Store `this._name = name`, `this._def = def`.
   - Call `setPreferredSize(16, 16)`.
   - If the constructor invocation is `this.constructor === _Glyph` and `options` is provided, call `this.applyOptions(options)` (mirrors `Button`).

2. `render()`:
   - **SVG mode**: override the root element creation. `super.render()` uses `document.createElement(this.tag)` (see [Component.ts:2279](../src/typescript/lib/core/Component.ts#L2279)), which creates an HTML-namespaced `<svg>` and does **not** render. The Glyph class must override `render()` to construct the root via `document.createElementNS("http://www.w3.org/2000/svg", "svg")` instead, then run the rest of Component's render pipeline (attributes, classes, listeners). Confirm the exact override surface during implementation — either expose a hook on `Component` for "give me the root element", or copy the small bit of post-create logic needed. Set attributes: `viewBox` = `def.viewBox`, `fill` = `"currentColor"`, `xmlns` = `"http://www.w3.org/2000/svg"`. Create `<path>` via `createElementNS`, set its `d` attribute to `def.path`, append.
   - **Char mode**: `super.render()` is fine — `<span>` is HTML-namespaced. Set the element's `textContent` to `def.char`. Set inline CSS `line-height: 1` and `text-align: center` so the character sits visually centred in its preferred-size box. The component's `font-size` follows the inherited cascade by default; callers wanting non-default size set it via the normal `setFontSize`/`setElementCSSRule` on the Glyph instance.

3. `getName()`: returns `this._name`.

**This is the one structural unknown.** Component currently has no documented hook for swapping `document.createElement` for `createElementNS`. The first implementation task is to read [Component.ts](../src/typescript/lib/core/Component.ts) around line 2279 and decide between:

- **(a)** Adding a small protected method like `createRootElement(): Element` that `render()` calls, which `Glyph` overrides for SVG mode. Cleanest, but touches the base class.
- **(b)** Overriding `render()` wholesale in `Glyph` for SVG mode, duplicating whatever post-create logic Component performs.

Pick (a) if it's a one-line addition; pick (b) if Component's `render()` does enough work that an override has to copy too much. Either is acceptable; document the choice in the `Glyph.ts` file header comment.

### Step 4 — Export `Glyph` from `component/display`

[src/typescript/lib/component/display/index.ts](../src/typescript/lib/component/display/index.ts) — add (keep the `FontAwesomeIcon` exports — those go away in the adoption plan):

```typescript
export { Glyph } from '~/component/display/Glyph.js';
export type { GlyphOptions } from '~/component/display/Glyph.js';
```

The subpath bundle `@jimka/typescript-ui/component/display` already exists in [package.json](../package.json#L15), so no exports map change is needed.

### Step 5 — JSDoc the public symbols

Per the project's documentation conventions ([CLAUDE.md](../CLAUDE.md)):

- `Glyph` class: JSDoc with `@category Components`, a usage example showing both SVG and Unicode registry lookup, and a note that the underlying tag is fixed at construction.
- `GlyphDef` union and `Glyphs` const: brief JSDoc; mark `Glyphs` itself as internal (no `@category`) so it stays out of the public API page.
- Same-bucket links (`{@link Glyph}` inside other `component/display` files) use the `@link` form. Cross-bucket references — `Window`, `Button` — use the markdown link form per [CLAUDE.md](../CLAUDE.md). No cross-bucket links are likely in this plan since `Glyph` doesn't reference anything outside `display`.

### Step 6 — Verify SVG namespace renders correctly

Run a one-off verification in the dev server (or a temporary demo route):

```ts
panel.addComponent(new Glyph("times"));
panel.addComponent(new Glyph("arrow-right"));
```

Confirm visually that the `times` SVG renders (filled X) and the `arrow-right` character renders. Toggle `--ts-ui-text-color` in devtools and verify both follow it.

This step exists because Step 3 has a known structural unknown (namespace handling in `Component.render()`); skipping verification would defer discovery to the adoption plan.

---

## Files to Create / Modify

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/display/Glyph.ts` |
| Create | `src/typescript/lib/component/display/Glyphs.ts` |
| Modify | `src/typescript/lib/component/display/index.ts` |
| Modify (possibly) | `src/typescript/lib/core/Component.ts` — only if Step 3 chooses option (a) and a small protected hook is the cleanest path |

No files are deleted. No call sites change. FontAwesome stays in place.

---

## Verification

1. **Type check:**
   ```
   npm run typecheck
   ```

2. **Library build:**
   ```
   npm run build:lib
   ```
   Confirm `dist/lib/component/display.es.js` exports `Glyph` and `GlyphOptions`.

3. **Docs build is clean** (per [CLAUDE.md](../CLAUDE.md)):
   ```
   npm run docs:build
   ```
   Zero errors, zero new link warnings.

4. **Smoke render** (Step 6 above): both `new Glyph("times")` and `new Glyph("arrow-right")` render correctly and follow `currentColor`.

5. **Throw on unknown name:** `new Glyph("nope")` throws `Error("Unknown glyph: nope")`.

6. **Refresh the knowledge graph:**
   ```
   graphify update . --directed
   ```

---

## Critical Files

- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — verify how `tag` becomes a DOM element ([line 2279](../src/typescript/lib/core/Component.ts#L2279)); namespace handling decision lives here.
- [src/typescript/lib/component/display/FontAwesomeIcon.ts](../src/typescript/lib/component/display/FontAwesomeIcon.ts) — reference structure for the callable export pattern and constructor shape. Not deleted by this plan.
- [src/typescript/lib/component/display/index.ts](../src/typescript/lib/component/display/index.ts) — public export surface.
- [src/resources/Base/script/fontawesome/svgs/solid/times.svg](../src/resources/Base/script/fontawesome/svgs/solid/times.svg) — source of the initial `times` path data.

---

## Non-Goals

- **No call-site changes.** `WindowHeader`, `TreeRow`, buttons, etc. continue using whatever they use today. The adoption pass is [glyph-adoption.md](glyph-adoption.md).
- **No FontAwesome removal.** Removing the script tags, peer dependency, and asset tree is part of the adoption plan (after the last FA call site is migrated).
- **No mutable name.** `setName(...)` is intentionally not provided. The underlying tag is fixed at construction; supporting a name change would force DOM re-creation. Revisit only when a real call site needs it.
- **No size-aware char rendering yet.** The `kind: "char"` branch sets `line-height: 1` and lets the cascade pick `font-size`. If a future site needs the character to scale to the box like an SVG does, add an override at that site or extend `Glyph` then. Keep this iteration minimal.
- **No tree-shakable per-glyph imports.** The registry is one frozen object. Revisit when its size starts to matter.
- **No new theme token.** `currentColor` is sufficient. Add a `--ts-ui-glyph-color` only when a real call site needs a glyph that diverges from surrounding text colour.
