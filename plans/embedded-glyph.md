# Embedded Glyph — FontAwesome Replacement Plan

## Overview

Replace the project's dependency on FontAwesome with a self-contained `Glyph` component that inlines SVG path data from a small, hand-curated registry. The library currently uses FontAwesome to render exactly **one** icon — the close button in [WindowHeader.ts:30](../src/typescript/Base/component/WindowHeader.ts#L30) (`fas times`). To support that single glyph the project carries a full FontAwesome 5.9 asset tree, a blocking `<script>` tag in two HTML entry points, an optional peer dependency, and a thin wrapper class. This plan removes all of that and ships a standalone `Glyph` component instead.

The `MenuItemConfig.icon` field is **not** functionally affected: [MenuItem.ts:129](../src/typescript/Base/component/menubar/MenuItem.ts#L129) renders `config.icon` as plain `Label` text (Unicode characters such as `▶`). Its only tie to FontAwesome is a misleading comment, which this plan also corrects.

---

## Architecture Decisions

### Curated registry, not auto-extraction

A single TypeScript file (`Glyphs.ts`) holds a frozen object literal mapping glyph name → `{ viewBox, path }`. New glyphs are added on demand by hand. No build-time tooling, no metadata parsing, no plugin. Today the registry has one entry (`times`); the cost of adding more is a single object property.

### Inline `<svg>`, not `<img>` or background-image

Inlining the SVG lets `fill="currentColor"` make the glyph follow the inherited foreground colour, so it integrates with the existing `--ts-ui-*` theme tokens for free. No new theme token is required.

### Component element is `<svg>` directly

The previous `FontAwesomeIcon` used `<i>` because FontAwesome required it. With embedded path data there is no reason to nest an `<svg>` inside another element — `Glyph` extends `Component` and passes `"svg"` to `super()`. Keeps the DOM flat.

### Throw on unknown glyph names

If a name is not in the registry, fail at construction with a descriptive error rather than rendering an empty SVG. Silent fallbacks hide bugs; a developer typo should be loud.

### Clean removal of `FontAwesomeIcon`

The class is internal to the library and has a single call site (`WindowHeader`). Per CLAUDE.md "Surgical Changes" / "Simplicity First", a clean removal is preferred over a deprecated shim.

---

## Public API (TypeScript Signatures)

### `Glyph`

```typescript
export class Glyph extends Component {
    constructor(name: string);
}
```

### `Glyphs.ts` (registry module — internal)

```typescript
export interface GlyphDef {
    viewBox: string;   // e.g. "0 0 352 512"
    path: string;      // SVG path "d" attribute
}

export const Glyphs: Readonly<Record<string, GlyphDef>>;
```

Initial registry contents: `{ times: { viewBox: "0 0 352 512", path: "<extracted from svgs/solid/times.svg>" } }`.

---

## Ordered Implementation Steps

### Step 1 — Extract the `times` path data

Before deleting any FontAwesome assets, read [src/resources/Base/script/fontawesome/svgs/solid/times.svg](../src/resources/Base/script/fontawesome/svgs/solid/times.svg) and capture its `viewBox` (`"0 0 352 512"`) and `<path d="...">`.

### Step 2 — Create `Glyphs.ts`

`src/typescript/Base/component/Glyphs.ts`

```typescript
export interface GlyphDef {
    viewBox: string;
    path: string;
}

export const Glyphs: Readonly<Record<string, GlyphDef>> = Object.freeze({
    times: {
        viewBox: "0 0 352 512",
        path: "...",  // from Step 1
    },
});
```

### Step 3 — Create `Glyph.ts`

`src/typescript/Base/component/Glyph.ts`

1. `constructor(name: string)`: call `super("svg")`; look up the def in `Glyphs`; throw `Error("Unknown glyph: " + name)` if missing; store the def; call `setPreferredSize(16, 16)` (matches prior `FontAwesomeIcon` default).
2. `render()`:
   - `let element = super.render()` (SVG element).
   - Set namespace-aware attributes: `setAttribute("viewBox", def.viewBox)`, `setAttribute("fill", "currentColor")`, `setAttribute("xmlns", "http://www.w3.org/2000/svg")`.
   - Create child `<path>` via `document.createElementNS("http://www.w3.org/2000/svg", "path")`, set `d` attribute, append to element.
   - Return element.

Note: SVG elements require the SVG namespace. If `super.render()` uses `document.createElement("svg")` (HTML namespace), the SVG will not render correctly. Verify Component's `render()` and either (a) override to use `createElementNS` for the root, or (b) confirm Component already handles `svg` tag specially. **This is the one verification step that must happen during implementation, not planning.**

### Step 4 — Update `WindowHeader.ts`

[src/typescript/Base/component/WindowHeader.ts](../src/typescript/Base/component/WindowHeader.ts)

- Line 5: `import { FontAwesomeIcon } from "./FontAwesomeIcon.js";` → `import { Glyph } from "./Glyph.js";`
- Line 12 docstring: "Font Awesome 'times' exit button" → "embedded glyph close button".
- Lines 30-32: rename local variable and switch construction:
  ```typescript
  let glyph = new Glyph("times");
  glyph.setPointerEvents("none");
  this.exitButton.addComponent(glyph, { fill: FillType.NONE });
  ```

### Step 5 — Update `index.ts` exports

[src/typescript/Base/index.ts:86](../src/typescript/Base/index.ts#L86)

- Remove: `export { FontAwesomeIcon } from './component/FontAwesomeIcon.js';`
- Add (same "Components — display" section): `export { Glyph } from './component/Glyph.js';`

### Step 6 — Fix the `MenuItem` doc comment

[src/typescript/Base/component/menubar/MenuItem.ts:23](../src/typescript/Base/component/menubar/MenuItem.ts#L23)

```
/** Icon or glyph displayed on the left (e.g. a Unicode character or FontAwesome code). */
```
→
```
/** Icon or glyph displayed on the left (e.g. a Unicode character such as "▶"). */
```

No code change.

### Step 7 — Remove the FontAwesome script tags

- [index.html:4](../index.html#L4) — delete `<script src="/Base/script/fontawesome/js/all.js"></script>`.
- [src/resources/index.html:3](../src/resources/index.html#L3) — delete `<script src="Base/script/fontawesome/js/all.js"></script>`.

### Step 8 — Drop the peer dependency

[package.json:28-35](../package.json#L28-L35) — delete the `peerDependencies` and `peerDependenciesMeta` blocks (both exist solely for FontAwesome).

### Step 9 — Delete `FontAwesomeIcon.ts`

Delete [src/typescript/Base/component/FontAwesomeIcon.ts](../src/typescript/Base/component/FontAwesomeIcon.ts). After Step 5 it has no remaining importers.

### Step 10 — Delete the FontAwesome asset tree

Delete the directory [src/resources/Base/script/fontawesome/](../src/resources/Base/script/fontawesome/) (CSS, JS, SVGs, sprites, webfonts, metadata, scss).

Before deleting, confirm Step 1 captured the `times` path data and run:
```
grep -rn "fontawesome\|font-awesome\|FontAwesome\|fa-" src/ index.html package.json
```
Expected: zero matches.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/Base/component/Glyph.ts` |
| Create | `src/typescript/Base/component/Glyphs.ts` |
| Modify | `src/typescript/Base/component/WindowHeader.ts` |
| Modify | `src/typescript/Base/index.ts` |
| Modify | `src/typescript/Base/component/menubar/MenuItem.ts` (comment only) |
| Modify | `index.html` |
| Modify | `src/resources/index.html` |
| Modify | `package.json` |
| Delete | `src/typescript/Base/component/FontAwesomeIcon.ts` |
| Delete | `src/resources/Base/script/fontawesome/` (directory) |

---

## Verification

1. **Type check:**
   ```
   npm run typecheck
   ```

2. **Grep is clean:**
   ```
   grep -rn "FontAwesome\|fontawesome\|fa-" src/ index.html package.json
   ```
   Expected: zero matches outside of `graphify-out/` cache (which refreshes on `graphify update .`).

3. **Dev-server smoke test:**
   ```
   npm run dev
   ```
   Open the demo, find a window that uses `WindowHeader`, confirm the X close button renders and clicking it still triggers `addExitButtonListener`.

4. **Library build:**
   ```
   npm run build:lib
   ```
   Inspect `dist/lib/typescript-ui.es.js` — should contain no FontAwesome strings.

5. **Theme integration:** Toggle the theme (or change `--ts-ui-text-color` in devtools). The X glyph fill should follow `currentColor` and recolour with the rest of the button text.

6. **Layout regression check** (per CLAUDE.md): the close button bounds must be unchanged. `Glyph` keeps `setPreferredSize(16, 16)`; verify by comparing screenshots before and after, or by checking the exit button's measured width is unchanged.

7. **Refresh the knowledge graph:**
   ```
   graphify update .
   ```

---

## Critical Files

- `src/typescript/Base/Component.ts` — verify how `super("svg")` is rendered (HTML vs SVG namespace); may require adjusting Component or overriding `render()` in `Glyph`.
- `src/typescript/Base/component/WindowHeader.ts` — sole call site.
- `src/typescript/Base/component/FontAwesomeIcon.ts` — model for the new component's structure; deleted at the end.
- `src/typescript/Base/index.ts` — public export surface.
- `src/resources/Base/script/fontawesome/svgs/solid/times.svg` — source of the initial glyph path data.

---

## Non-Goals

- Not adding a glyph colour theme token. `currentColor` is sufficient; add a token later if a glyph ever needs to differ from surrounding text.
- Not migrating `MenuItemConfig.icon` to the registry. Menus today render raw text; converting them is a separate, larger change with no current driver.
- Not building per-icon imports for tree-shaking. The registry is one object today because there is one glyph; revisit only when its size starts to matter.
- Not preserving `FontAwesomeIcon` as a deprecated alias. Single internal call site, optional peer dep — clean removal is preferred.
