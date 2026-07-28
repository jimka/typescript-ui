# Default Favicon — Implementation Plan

## Overview

The library ships no favicon today. `packages/docs/index.html`, `packages/lib/index.html` and `packages/create-app/template/index.html` all have a bare `<head>`, so every page 404s `/favicon.ico` and shows the browser's blank-page placeholder in the tab.

This plan adds a built-in mark — a rounded square split into a north bar, a west sidebar and a centre pane, the framework's `Border` layout drawn literally ([layout/Border.ts:45](packages/lib/src/typescript/lib/layout/Border.ts#L45)) — as an inline SVG baked into a `data:` URI. A new core module, `core/Favicon.ts`, appends a `<link rel="icon">` to `<head>` through the DOM seam. `Body.init` ([core/Body.ts:56](packages/lib/src/typescript/lib/core/Body.ts#L56)) triggers the injection, and a new `favicon` field on a new `BodyOptions` bag lets an app point at its own file or turn injection off.

Injection is skipped whenever the document already declares an icon link, so an app's own `<link rel="icon">` in its `index.html` keeps working untouched. No static asset files are added and no build step changes.[^no-static-assets]

---

## Architecture Decisions

### A dedicated `core/Favicon.ts` module, not a private method on `Body`

The injection lives in a new static-only class, `Favicon`, in `packages/lib/src/typescript/lib/core/Favicon.ts`, exported from the `core` barrel. `Favicon` mirrors `ThemeManager` ([core/Theme.ts:1269](packages/lib/src/typescript/lib/core/Theme.ts#L1269)) — the codebase's existing pattern for "the library writes to a document-level element at runtime through the seam". `ThemeManager.setTheme` ([core/Theme.ts:1304](packages/lib/src/typescript/lib/core/Theme.ts#L1304)) writes `<html>` and `<body>` with `DOM.sink.apply` the same way this module writes `<head>`.[^module-not-body]

`Favicon` is public, so an app that builds its own mount path instead of calling `Body.init` can still call `Favicon.install()` directly.

### Fixed palette, not baked from the active theme

The SVG carries four hard-coded hex colours and its own `prefers-color-scheme` rule. It is **not** regenerated when `ThemeManager.setTheme` runs.[^fixed-palette]

| Role | Light | Dark | Source |
|---|---|---|---|
| Field (the gutters between regions) | `#FFFFFF` | `#505050` | dark from `DarkTheme.button.border` = `rgb(80, 80, 80)` |
| Regions (bar, sidebar, centre) | `#000000` | `#78AAF0` | dark from `DarkTheme.input.focusRing` = `rgb(120, 170, 240)` |

Light mode is plain black on white — maximum contrast, which is what survives being drawn at 16px on a pale tab strip. Dark mode uses the two `DarkTheme` tokens, so the mark reads as the framework's own blue against dark chrome.[^light-mode-monochrome]

### The document's existing icon link always wins

`Favicon.install` first asks whether `<head>` already matches `link[rel~="icon"]`. If it does, `install` returns `false` and writes nothing — and that holds even when the caller passed an explicit `favicon: '/brand.svg'`.[^html-wins]

### The built-in default is dispatched from `Body.init`, not from `Body.applyOptions`

`Body.applyOptions` forwards a *supplied* `favicon` to `setFavicon` in the usual gated form. The *default* injection — the case where the caller omitted the field entirely — is dispatched from the static `Body.init` instead.[^init-not-applyoptions]

### The data URI is produced with `encodeURIComponent`

The `href` is `` `data:image/svg+xml,${encodeURIComponent(MARK_SVG)}` ``. A hand-rolled list of characters to escape is not used.[^encode-uri-component]

---

## The mark

### SVG source

Authored as one module-level string constant, `MARK_SVG`, in `core/Favicon.ts`. Broken across lines here so it can be read:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <style>
  .pane{fill:#FFFFFF}.region{fill:#000000}@media(prefers-color-scheme:dark){.pane{fill:#505050}.region{fill:#78AAF0}}
  </style>
  <clipPath id="plate">
    <rect width="32" height="32" rx="6"/>
  </clipPath>
  <g clip-path="url(#plate)">
    <rect class="pane" width="32" height="32"/>
    <rect class="region" width="32" height="10"/>
    <rect class="region" y="12" width="10" height="20"/>
    <rect class="region" x="12" y="12" width="20" height="20"/>
  </g>
</svg>
```

**The constant in the source is the same thing with the whitespace between tags removed** — one 495-character string, no newlines and no indentation. Copy it verbatim:

```
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>.pane{fill:#FFFFFF}.region{fill:#000000}@media(prefers-color-scheme:dark){.pane{fill:#505050}.region{fill:#78AAF0}}</style><clipPath id="plate"><rect width="32" height="32" rx="6"/></clipPath><g clip-path="url(#plate)"><rect class="pane" width="32" height="32"/><rect class="region" width="32" height="10"/><rect class="region" y="12" width="10" height="20"/><rect class="region" x="12" y="12" width="20" height="20"/></g></svg>
```

Because the string contains `"` throughout, declare it with single quotes or backticks, not double quotes.

### Geometry decisions

A 32-unit viewBox, so every dimension is a whole number and each unit renders as half a pixel in a 16px browser tab.

| Element | Rect | At 16px | Why |
|---|---|---|---|
| Plate (clip) | `0,0 32×32`, `rx="6"` | 16×16, 3px radius | Rounded square; the clip is what gives the three regions their outer corners |
| Field | `0,0 32×32` | 16×16 | Fills the plate; what stays visible is the 2-unit gap between regions |
| North bar | `0,0 32×10` | 16×5 | Spans the full width — `Border` docks north and south full-width and flanks the centre with west and east ([Border.ts:45](packages/lib/src/typescript/lib/layout/Border.ts#L45)) |
| West sidebar | `0,12 10×20` | 5×10 | Starts *below* the bar, for the same reason |
| Centre pane | `12,12 20×20` | 10×10 | Fills the remaining corner, flush with the right and bottom edges |

No strokes: the regions are separated by the field showing through, not by drawn lines. Every region is at least 10 units — 5px at 16px, comfortably above the 2px legibility floor. The separating gaps are 2 units, so **1px at 16px**, which is the one part of the mark that needs checking by eye rather than by arithmetic (see *Verification*).

All four shapes are plain rectangles inside `<g clip-path="url(#plate)">` rather than corner-rounded paths, so the geometry stays four `<rect>`s anyone can read.

### Data URI

`DEFAULT_FAVICON` is computed at module load, not pasted as a literal:

```typescript
export const DEFAULT_FAVICON = `data:image/svg+xml,${encodeURIComponent(MARK_SVG)}`;
```

The resulting 818-character value, for reference when checking the browser tab by hand:

```
data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2032%2032%22%3E%3Cstyle%3E.pane%7Bfill%3A%23FFFFFF%7D.region%7Bfill%3A%23000000%7D%40media(prefers-color-scheme%3Adark)%7B.pane%7Bfill%3A%23505050%7D.region%7Bfill%3A%2378AAF0%7D%7D%3C%2Fstyle%3E%3CclipPath%20id%3D%22plate%22%3E%3Crect%20width%3D%2232%22%20height%3D%2232%22%20rx%3D%226%22%2F%3E%3C%2FclipPath%3E%3Cg%20clip-path%3D%22url(%23plate)%22%3E%3Crect%20class%3D%22pane%22%20width%3D%2232%22%20height%3D%2232%22%2F%3E%3Crect%20class%3D%22region%22%20width%3D%2232%22%20height%3D%2210%22%2F%3E%3Crect%20class%3D%22region%22%20y%3D%2212%22%20width%3D%2210%22%20height%3D%2220%22%2F%3E%3Crect%20class%3D%22region%22%20x%3D%2212%22%20y%3D%2212%22%20width%3D%2220%22%20height%3D%2220%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E
```

Characters that **must** be escaped, and what `encodeURIComponent` produces for each:

| Character | Encoded | Why it breaks unescaped |
|---|---|---|
| `#` | `%23` | Starts the URI fragment — an unescaped `url(#plate)` truncates the SVG at that point and the icon renders as an empty box |
| `<` `>` | `%3C` `%3E` | Not valid in a URI; browsers vary on whether they repair them |
| `"` | `%22` | Terminates the surrounding HTML attribute value |
| `%` | `%25` | Would otherwise be read as the start of an escape sequence |

`encodeURIComponent` also encodes spaces as `%20` and `/` as `%2F`, which is harmless.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/core/Favicon.ts

/** The library's built-in mark as a ready-to-use `data:` URI. */
export const DEFAULT_FAVICON: string;

export class Favicon {
    /**
     * Appends a `<link rel="icon">` to `<head>`, unless the document already
     * declares one. Calling it again replaces the href on the link this class
     * previously injected rather than appending a second one.
     */
    static install(href?: string): boolean;

    /** @internal Test-only: forgets the injected link so a suite can re-run install. */
    static _reset(): void;
}
```

```typescript
// packages/lib/src/typescript/lib/core/Body.ts

export interface BodyOptions extends ComponentOptions {
    /**
     * Browser-tab icon. A URL or `data:` URI installs that icon; `false`
     * suppresses injection entirely. Omitted, the library's built-in mark is
     * used. In every case a `<link rel="icon">` already present in the page's
     * HTML wins and nothing is injected.
     */
    favicon?: string | false;
}

export class Body extends Component<BodyOptions> {
    static init(options?: BodyOptions): Body;

    setFavicon(favicon: string | false): this;
    getFavicon(): string | false;
}
```

Backing store for `favicon` is the options bag (`this._options.favicon`), per ARCHITECTURE.md's *Always cache in memory* rule — no private field, because the setter stores the value unchanged.

---

## Internal Structure

### `Favicon.install`

```typescript
/** Matches `rel="icon"` and `rel="shortcut icon"`; not `apple-touch-icon` or `mask-icon`. */
const ICON_LINK_SELECTOR = 'link[rel~="icon"]';

private static _link: Handle | null = null;

static install(href: string = DEFAULT_FAVICON): boolean {
    // Re-installing through the link this class already created, so a runtime
    // `setFavicon` swaps the href instead of stacking a second <link>.
    if (Favicon._link !== null) {
        DOM.sink.apply(Favicon._link, { setAttr: { href } });

        return true;
    }

    const head = DOM.source.getHead();

    if (DOM.source.querySelector(head, ICON_LINK_SELECTOR) !== null) {
        return false;
    }

    const link = DOM.sink.createElement("link");

    DOM.sink.apply(link, { setAttr: { rel: "icon", href } });
    DOM.sink.appendChild(head, link);
    Favicon._link = link;

    return true;
}
```

### Selector coverage

`link[rel~="icon"]` uses the whitespace-separated-word match, so:

| Markup already in `index.html` | Matched? | Effect |
|---|---|---|
| `<link rel="icon" href="/app.svg">` | yes | no injection |
| `<link rel="shortcut icon" href="/favicon.ico">` | yes — `rel` contains the word `icon` | no injection |
| `<link rel="apple-touch-icon" href="/touch.png">` | no — `apple-touch-icon` is one word | injection proceeds |
| `<link rel="mask-icon" href="/mask.svg">` | no — one word | injection proceeds |

`apple-touch-icon` and `mask-icon` are deliberately not matched: neither sets the browser-tab icon, so a page carrying only one of them still has no tab icon to preserve.

Timing is not a concern: `<script type="module">` is deferred by definition, so it runs after the HTML document has been parsed. Any `<link>` written in `index.html` is already in `document.head` by the time `Body.init` runs.

### `Body` wiring

```typescript
static init(options: BodyOptions = {}): Body {
    this.INSTANCE.reattachElementBuffers();
    this.INSTANCE.applyOptions(options);

    // The library default, dispatched here rather than from applyOptions —
    // see the plan's Architecture Decisions.
    if (options.favicon === undefined) {
        this.INSTANCE.setFavicon(DEFAULT_FAVICON);
    }

    return this.INSTANCE;
}

protected applyOptions(options: BodyOptions): this {
    super.applyOptions(options);

    if (options.favicon !== undefined) this.setFavicon(options.favicon);

    return this;
}

setFavicon(favicon: string | false): this {
    this._options.favicon = favicon;

    if (favicon !== false) {
        Favicon.install(favicon);
    }

    return this;
}

getFavicon(): string | false {
    return this._options.favicon ?? DEFAULT_FAVICON;
}
```

---

## Ordered Implementation Steps

1. **Create `packages/lib/src/typescript/lib/core/Favicon.ts`.** SPDX header, `import { DOM, type Handle } from "~/core/DOM.js";`, the `MARK_SVG` single-line constant, `ICON_LINK_SELECTOR`, the exported `DEFAULT_FAVICON`, and the `Favicon` class from *Internal Structure*. Tag the class `@category Core`. Document `MARK_SVG`'s geometry and where its two dark-mode colours come from in the constant's JSDoc, per CODE_CONVENTIONS' magic-number rule.
   *Check:* `npm -w packages/lib run typecheck` passes.

2. **Export from the core barrel.** In `packages/lib/src/typescript/lib/core/index.ts`, next to the existing `export { Body } from '~/core/Body.js';` line, add `export { Favicon, DEFAULT_FAVICON } from '~/core/Favicon.js';`.

3. **Add `BodyOptions` and the favicon plumbing to `packages/lib/src/typescript/lib/core/Body.ts`.** Import `{ Favicon, DEFAULT_FAVICON } from "~/core/Favicon.js"`. Declare and export `BodyOptions extends ComponentOptions` with the `favicon` field (JSDoc as in *Public API*, `@category Core`). Change `class Body extends Component` to `class Body extends Component<BodyOptions>`. Change `init`'s parameter type to `BodyOptions` and add the `options.favicon === undefined` default dispatch after `applyOptions`. Add the `applyOptions` override, `setFavicon`, and `getFavicon`, all as written in *Internal Structure*.
   *Check:* `npm -w packages/lib run typecheck` passes.

4. **Export the options type.** In `packages/lib/src/typescript/lib/core/index.ts` add `export type { BodyOptions } from '~/core/Body.js';` beside the `Body` export.

5. **Teach the offline source about seeded selector matches.** In `packages/lib/tests/dom/TestDOM.ts`: add a `Map<string, Handle>` to `TestHandleTable` with `setSelectorResult(selector, handle)` / `selectorResult(selector)` accessors; change `ModelledDOMSource.querySelector` (currently at line 1089, returns `null` unconditionally) to `return _table.selectorResult(selector);` and update its JSDoc to say matches are found only when seeded; export a `setQuerySelectorResult(selector: string, handle: Handle): void` helper alongside the existing `setNaturalSize` / `setConnected` / `setMediaState` / `setBorderInset` seeders at the end of the file.
   *Check:* `npm -w packages/lib run test` — the whole existing suite must still pass, since unseeded lookups still return `null`.

6. **Write `packages/lib/tests/core/Favicon.test.ts`** covering every case in *Expected Behaviour*. Mirror `packages/lib/tests/core/Body.test.ts` for the `installTestDOM` + `CONFIG` setup; teardown is `afterEach(() => { Favicon._reset(); DOM.reset(); })`.
   *Check:* `npm -w packages/lib run test -- Favicon` is green.

7. **Add the override recipe to the scaffolder template.** In `packages/create-app/template/index.html`, inside `<head>` below the `<title>`, add:
   ```html
   <!-- @jimka/typescript-ui injects its own tab icon. Uncomment to use your own: -->
   <!-- <link rel="icon" href="/favicon.svg" /> -->
   ```
   *Check:* `npm -w packages/create-app test` still passes.

8. **Document the option in `packages/lib/docs/components/Body.md`.** Add a `## Favicon` section between `## Mounting` and `## Notes` — see *Documentation Impact* for what it must say.

9. **Add the capability row.** In `packages/lib/scripts/llms/manifest.data.mjs`, append to the `App shell` group (line 124):
   ```javascript
   { task: "Give the app a browser-tab icon", symbol: "Favicon", doc: "docs/components/Body.md" },
   ```
   Then regenerate: `npm run docs:api && npm run docs:llms`, and commit the changed `packages/lib/llms.txt`.
   *Check:* `grep -n 'Favicon' packages/lib/llms.txt` — expect one row naming `@jimka/typescript-ui/core`.

10. **Full verification pass.** Run everything in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/Favicon.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/core/index.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Create | `packages/lib/tests/core/Favicon.test.ts` |
| Modify | `packages/create-app/template/index.html` |
| Modify | `packages/lib/docs/components/Body.md` |
| Modify | `packages/lib/scripts/llms/manifest.data.mjs` |
| Modify | `packages/lib/llms.txt` (regenerated, not hand-edited) |

`packages/docs/index.html` and `packages/lib/index.html` are **not** modified: both apps call `Body.init`, so both pick the mark up for free.

---

## Expected Behaviour

All cases below are unit-testable through the recording sink. Assert on `sink.writes` — never on `expect(...).not.toThrow()`, which passes vacuously in this harness.[^assert-on-writes]

The full option → result table:

| Call | `<head>` when `Body.init` runs | Resulting tab icon |
|---|---|---|
| `Body.init({})` | no icon link | `<link rel="icon" href="data:image/svg+xml,%3Csvg…">` injected |
| `Body.init({})` | `<link rel="icon" href="/app.png">` | `/app.png`, nothing injected |
| `Body.init({ favicon: '/brand.svg' })` | no icon link | `<link rel="icon" href="/brand.svg">` injected |
| `Body.init({ favicon: '/brand.svg' })` | `<link rel="icon" href="/app.png">` | `/app.png`, nothing injected |
| `Body.init({ favicon: false })` | no icon link | no icon at all, nothing injected |
| `Body.init({ favicon: false })` | `<link rel="icon" href="/app.png">` | `/app.png`, nothing injected |

Written out as the tests to build:

1. **Injects the built-in mark into an empty head.** After `Body.init({})`, `sink.writes` contains a `createElement` of `link`, then an `apply` whose patch `setAttr` is exactly `{ rel: 'icon', href: DEFAULT_FAVICON }`, then an `appendChild`.
2. **Does not inject when the document already declares an icon link.** Seed `setQuerySelectorResult('link[rel~="icon"]', DOM.sink.createElement('link'))`, then `Body.init({})`: no `apply` in `sink.writes` carries a `setAttr.rel` of `'icon'`. A direct `Favicon.install()` in the same state returns `false`.
3. **Honours a URL override.** After `Body.init({ favicon: '/brand.svg' })`, the injected link's `setAttr.href` is `'/brand.svg'`, and `Body.getInstance().getFavicon()` returns `'/brand.svg'`.
4. **Honours the suppress value.** After `Body.init({ favicon: false })`, no `apply` in `sink.writes` carries a `setAttr.rel` of `'icon'`, and `getFavicon()` returns `false`.
5. **The explicit override still loses to an existing link.** Seed as in case 2, then `Body.init({ favicon: '/brand.svg' })`. No `rel: 'icon'` write is recorded.
6. **The built-in href is correctly encoded.** `DEFAULT_FAVICON` starts with `data:image/svg+xml,`; the remainder contains none of `#`, `<`, `>`, `"`; `decodeURIComponent` of the remainder round-trips to `MARK_SVG` and contains the literal `url(#plate)`.
7. **A second install swaps the href instead of adding a link.** Call `Favicon.install('/a.svg')` then `Favicon.install('/b.svg')`; exactly one `createElement('link')` is recorded, and the last `setAttr.href` is `'/b.svg'`.

**Manual verification only** (the harness cannot render):

- The mark is legible at 16px in a real browser tab.
- The `prefers-color-scheme` rule flips the palette when the OS theme changes.

---

## Verification

- `npm -w packages/lib run typecheck` and `npm -w packages/lib run typecheck:test` — both clean.
- `npm -w packages/lib run test` — full suite green, including the new `tests/core/Favicon.test.ts` and the untouched `tests/dom/*` suites (step 5 changes a shared harness).
- `npm -w packages/lib run lint` — the `local/no-raw-dom` rule has an empty baseline; `Favicon.ts` must add nothing to it. It only touches `DOM.sink` / `DOM.source` and names elements with `Handle`.
- `npm -w packages/create-app test` — scaffolder tests still pass after the template edit.
- `npm run docs:api` — zero warnings (CODE_CONVENTIONS requires it after any public-JSDoc change).
- `npm run docs:llms` then `git diff packages/lib/llms.txt` — one new `Favicon` row, and the generator's token-budget check passes.
- **Manual, library demo app:** `npm run dev`, open `http://localhost:8015`, confirm the tab shows the black-on-white layout mark. Switch the OS to dark mode and hard-reload; the mark should turn light blue on dark grey.
- **Manual, docs app:** `npm run docs:dev`, open `http://localhost:5173`, same check.
- **Manual, gap legibility:** in the same tab, confirm the three regions still read as separate blocks. The gaps between them are 2 units — 1px at a 16px tab — and are the only feature below the 2px floor, so they are the part arithmetic cannot confirm. If they smear shut, widen the gaps to 3 units (bar `height="10"` unchanged, lower row `y="13"`, sidebar `width="10"`, centre `x="13" width="19"`) rather than changing the colours.
- **Manual, opt-out:** temporarily add `<link rel="icon" href="data:,">` to `packages/lib/index.html`, reload `http://localhost:8015`, confirm the tab icon is blank (nothing injected), then revert the file.

---

## Documentation Impact

- **`packages/lib/src/typescript/lib/core/index.ts`** — the `core` subpath barrel is where `Favicon`, `DEFAULT_FAVICON` and the `BodyOptions` type become public. There is no root barrel.
- **API reference** — generated. `Favicon` gets `@category Core` and lands at `/api/core/classes/Favicon`; `BodyOptions` at `/api/core/interfaces/BodyOptions`. The docs app's API nav is derived from the generated file list (`packages/docs/src/content/api.ts` reads `virtual:typedoc-api`), so no catalog entry is written by hand.
- **`packages/lib/docs/components/Body.md`** — add a `## Favicon` section covering: that `Body.init` installs the built-in mark; the `favicon: '/brand.svg'` and `favicon: false` forms; and the rule that a `<link rel="icon">` in the page's HTML always wins. Add `[API: Favicon](/api/core/classes/Favicon)` to the existing `## See also` list. This page is already registered in the docs nav (`packages/docs/src/content/pages.ts`, `componentsCore`, `{ path: '/components/Body', label: 'Body' }`), so **no** nav or catalog edit is needed.
- **`packages/lib/scripts/llms/manifest.data.mjs`** — one row in the `App shell` group, as in step 9. `packages/lib/llms.txt` is generated from it and must be regenerated, never hand-edited (its first line says so).
- **JSDoc link forms** — `Favicon` and `Body` are both in the `core` bucket, so `{@link Favicon}` resolves from `Body`'s JSDoc and vice versa. `Body` is a name-collision symbol (`core/Body` vs `component/table/Body`), so any markdown link to it from another bucket must spell out `/api/core/classes/Body`.

---

## Potential Challenges

- **`Favicon._link` outlives `DOM.reset()`.** Left set, the next `install` takes the swap-the-href branch and writes to a handle minted against the discarded registry — so the following test sees no `createElement` at all, and in production the registry's `resolve` throws. `Favicon._reset()` exists for exactly this and must run in the test file's `afterEach`, alongside `DOM.reset()`.
- **`Body` is constructed at module import.** `private static readonly INSTANCE = new Body()` runs the constructor — and therefore `applyOptions({ tag: "body" })` — the moment `Body.ts` is first imported, before any test harness is installed. The gated `if (options.favicon !== undefined)` form makes that pass a no-op; do not change it to an always-dispatch form.
- **Safari ignores `prefers-color-scheme` inside an SVG favicon.** It renders the light palette in both modes. Black on white is the highest-contrast pairing available, so it stays legible against Safari's dark tab strip — this degrades rather than breaks.
- **`ICON_LINK_SELECTOR` is duplicated in the test.** The test asserts against the literal `'link[rel~="icon"]'` when seeding. If the constant is ever changed, the seed string must change with it — there is no compile-time link between them.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/core/Theme.ts` (`ThemeManager`, line 1269; `setTheme`, line 1304) | The precedent this plan mirrors: a static-only core class writing document-level elements through `DOM.sink.apply` |
| `packages/lib/src/typescript/lib/core/Body.ts` | The file being extended; read `init` and the constructor before editing |
| `packages/lib/src/typescript/lib/core/DOM.ts` | `getHead` (interface line 1265, production impl line 2300), `querySelector` (line 1171), `createElement` / `appendChild` / `apply` on `DOMSink` |
| `packages/lib/tests/dom/TestDOM.ts` | `RecordingDOMSink.writes` (line 333), `ModelledDOMSource.querySelector` (line 1089), and the existing seeder helpers at the end of the file that `setQuerySelectorResult` must match |
| `packages/lib/tests/core/Body.test.ts` | The `installTestDOM` + `CONFIG` + `afterEach(() => DOM.reset())` shape the new test file copies |
| `packages/lib/scripts/llms/generate.mjs` | Explains that `llms.txt` is generated and that a curated symbol is resolved against the TypeDoc model |
| `ARCHITECTURE.md`, *All attributes and styles go through typed setters* | The three rules `setFavicon` follows: typed setter, cached in the options bag, exposed on `BodyOptions` |

---

## Non-Goals

- **No static `favicon.svg` files** in any package, and no asset-pipeline change.[^no-static-assets]
- **No re-injection on theme change.** The mark's palette is fixed.[^fixed-palette]
- **No `apple-touch-icon`, `mask-icon`, or web-app-manifest handling.** Those are separate platform surfaces; this plan covers the browser tab only.
- **No row in `packages/lib/tests/component/default-options-fallback.test.ts`.** That registry guards fields seeded into a `_defaultOptions` / `subclassDefaults` bag. The favicon default is not in that bag — it lives in `Body.init` — so the trap the registry guards does not apply.
- **No removal of an already-injected link.** `setFavicon(false)` means "do not inject"; it is not an uninstall. The library injects at most one link per page, and `Body.init` is the one call that decides whether it happens.

---

## Implementation Notes

Three things differ from the plan as written. None changes the design.

**`MARK_SVG` is exported.** The plan's *Public API* listed only `DEFAULT_FAVICON` and `Favicon`, but *Expected Behaviour* case 6 asserts that the decoded data URI round-trips to `MARK_SVG`, which needs the test to reach it. It is exported from `core/Favicon.ts` and tagged `@internal`, and the `core` barrel does **not** re-export it — so it stays out of the public API and out of the generated docs, exactly as the plan intended.

**Test 1 identifies `<head>` by tag, not by handle.** The plan implied comparing the `appendChild` parent against `DOM.source.getHead()`. That cannot work: the offline source mints a *fresh* handle on every `getHead()` call — as it does for `getBody` and `getDocumentElement` — so the handle a test fetches is never the one the code under test used. The test reads `DOM.source.getTagName(parent)` and asserts `'HEAD'` instead. The harness was left alone; minting fresh handles is its deliberate, consistent design.

**The gap-legibility fallback was not needed.** *Verification* said to widen the 2-unit gaps to 3 units if they smear shut at 16px. Rasterising the mark at 16px and inspecting it magnified shows the gutters render as clean, fully white one-pixel lines, and the three regions stay separate. Widening the gaps to 3, 4 or 5 units changes the 16px result barely at all. The geometry ships as specified.

---

## Notes

[^no-static-assets]: A data URI rather than a shipped `favicon.svg`. `build:lib` emits ES modules only, and `packages/lib/package.json`'s `files` array is `dist/lib` plus `llms.txt` and two licence files — an asset would need a copy step in the library build, an export map entry, and a documented path for consumers to reference. A data URI needs none of that and works identically for a plain npm consumer with no bundler asset handling. Shipping static `favicon.svg` files in the three `index.html` templates was considered and rejected: it would put three copies of the mark in the repo, would not help npm consumers at all, and gives no opt-out mechanism beyond editing the file.

[^module-not-body]: Folding the injection into a private `Body` method was the alternative. It is rejected on two counts. First, precedent: every other document-level concern in this codebase already has its own `core/` module with a static-only class — `ThemeManager` (`<html>` / `<body>` styles), `LayerManager` (overlay stacking), `FocusHistory`. Second, reach: an app that mounts without `Body.init` — building its own root and calling `Component` APIs directly — would have no way to opt in if the code were private to `Body`.

[^fixed-palette]: A theme-derived mark was the alternative: read `ThemeManager.getTheme().input.focusRing`, rebuild the SVG, and re-inject from a `ThemeManager.onThemeChange` subscription. It is rejected. The cost is a permanent subscription plus a re-encode and a DOM write on every theme switch; the benefit is a tab icon that tracks the app's theme — which browsers already undercut, because a favicon is cached per URL and several engines do not re-rasterise a `<link href>` swap promptly. The fixed palette also decouples the mark from an app that ships a custom theme with a non-blue accent: the library's mark stays the library's mark, and an app that wants its own brand passes `favicon: '/brand.svg'`. The internal `prefers-color-scheme` rule already handles the one contrast problem that actually matters — light versus dark browser chrome — without any framework wiring.

[^light-mode-monochrome]: Light mode does not use a theme token, unlike dark mode. Pulling `ModernTheme.input.focusRing` (`rgb(30, 100, 200)`) over `ModernTheme.button.border` (`rgb(214, 217, 222)`) was the alternative, and it makes a mark that matches the framework's accent. It is rejected because the regions here are separated by 1px gaps at tab size, and blue-on-pale-grey does not hold that separation once the browser downsamples — black on white does. Dark mode has no equivalent problem: a dark tab strip needs the mark to be *lighter* than its surroundings, so the `DarkTheme` blue over `DarkTheme.button.border` is both accent-correct and high-contrast.

[^html-wins]: The alternative is letting an explicit `favicon` option override an `index.html` link. It is rejected in favour of one rule with no exceptions: *the library never replaces an icon the document already declares*. That rule is a single line to state, a single branch to implement, and a single case to test. Letting the option win would mean `install` carries two modes, and would let a library option silently replace markup the app author wrote by hand — the more surprising of the two directions. An app that wants the option to take effect deletes its HTML link, which is a one-line, obvious fix; an app confused about why its hand-written link stopped working has a much harder debugging session.

[^encode-uri-component]: A targeted `replace` chain over just `%`, `#`, `<`, `>` and `"` produces a shorter URI (spaces and slashes stay literal, saving roughly 60 characters) but has to be exactly right, and the failure mode of getting it wrong — an unescaped `#` truncating the SVG at `url(#plate)` — produces a blank icon with no error anywhere. `encodeURIComponent` is correct by construction and runs once at module load. The extra bytes are paid once in the bundle, never over the network.

[^init-not-applyoptions]: ARCHITECTURE.md's *Class-level defaults must survive the getter* section offers "always-dispatch" — `applyOptions` calling `this.setX(options.foo ?? this.getX())` — for a field whose effect is construction-time. That form cannot be used here. `Body` holds itself as `private static readonly INSTANCE: Body = new Body()`, so the constructor, and therefore `applyOptions({ tag: "body" })`, runs the moment `Body.ts` is imported. An always-dispatch `applyOptions` would inject the favicon at import time — before any caller has had the chance to pass `favicon: false`, defeating the opt-out entirely, and in tests before `installTestDOM` has swapped the seams. Putting the default in the static `init` puts it exactly where the consumer's intent is first known. The gated dispatch stays in `applyOptions` so a supplied field still routes through the typed setter, as the *All attributes and styles go through typed setters* rules require.

[^assert-on-writes]: `RecordingDOMSink.release()` records the release but never evicts the handle's stub, so a write through a released handle does not throw offline. A teardown test written as `expect(() => …).not.toThrow()` therefore passes whether or not the code under test is correct. Every assertion in this plan's tests reads `sink.writes` directly.
