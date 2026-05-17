# Font Awesome Free Registry Import — Implementation Plan

## Overview

Pull the entire **Font Awesome Free** glyph corpus (~2,000 icons across the `solid`, `regular`, and `brands` styles) from the **latest published FA Free release** into the project as tree-shakable per-icon TypeScript modules so consumers can register only the icons they actually use. The current curated registry at [src/typescript/lib/component/display/Glyphs.ts](../src/typescript/lib/component/display/Glyphs.ts) holds 19 hand-extracted entries; this plan replaces that single frozen object with a **uniformly opt-in** library mounted via a new `Glyph.register(...)` static, and **replaces each curated entry with its latest-FA-Free counterpart** — no separate curated track, no auto-registration.

Tree-shaking is the load-bearing constraint. The `Glyph(name)` constructor at [src/typescript/lib/component/display/Glyph.ts:76](../src/typescript/lib/component/display/Glyph.ts#L76) currently looks the name up in the static `Glyphs` table — so every glyph referenced from the lookup table is reachable from every `Glyph` instantiation, and a bulk-import barrel would defeat the bundler. The fix is **explicit registration**: per-icon modules under `src/typescript/lib/glyphs/<style>/<name>.ts`, exported via a new `./glyphs/*` subpath, registered by the consumer (or by the library component that needs them) with one `Glyph.register(times, edit, plus)` call. **Every** glyph must be registered before `new Glyph(name)` will resolve it; the runtime registry starts empty.

A one-shot codegen script `scripts/import-fontawesome.ts` produces the per-icon files from the upstream FA Free SVG tree; the generated files are committed to source so the build does not depend on the FA distribution at runtime. Licensing is **CC BY 4.0** for the icon path data (attribution to Fonticons, Inc.), which composes cleanly with the project's PolyForm Noncommercial 1.0.0 license — see the dedicated section below.

---

## Licensing — CC BY 4.0 × PolyForm Noncommercial 1.0.0

### Font Awesome Free terms

Font Awesome Free is licensed under three licenses depending on the file type ([https://fontawesome.com/license/free](https://fontawesome.com/license/free)):

| Component | License | Applies to |
|---|---|---|
| Icons (SVGs, raster, path data) | **CC BY 4.0** | The path data this plan embeds in `.ts` files |
| Web fonts | **SIL OFL 1.1** | Not used — this plan ships SVG only, no font files |
| CSS/JS code | **MIT** | Not used — no FA CSS/JS shipped |

Only **CC BY 4.0** is engaged by this plan, because the project embeds path data as TypeScript constants, not font files or FA's runtime code.

### CC BY 4.0 obligations the project must satisfy

CC BY 4.0 ([https://creativecommons.org/licenses/by/4.0/legalcode](https://creativecommons.org/licenses/by/4.0/legalcode), §3(a)) requires that downstream distribution preserve attribution. Concretely:

1. **Identify the creator** — *Fonticons, Inc.*
2. **Link to the license** — *https://creativecommons.org/licenses/by/4.0/*
3. **Identify the work** — *Font Awesome Free* (and the version imported)
4. **Indicate modifications** — if any path data is altered. This plan does **not** modify path data, but does extract it from `.svg` wrappers into TypeScript string literals; declare that transformation in the NOTICE as "reformatted from upstream SVG sources, path data unchanged."
5. **Pass on the license URL** to anyone who receives the work.

**Where attribution must appear in the distribution:**

- **`NOTICE` at the repository root** — already present at [NOTICE](../NOTICE) and references the prior hand-extracted entries. This plan **extends** that file with a new section listing the full FA Free corpus (or, more practically, a one-liner stating "all icons under `dist/lib/glyphs/<style>/` derive from Font Awesome Free vN.M.K, CC BY 4.0, © Fonticons, Inc., https://fontawesome.com/license/free").
- **`LICENSE-FONTAWESOME.md` at the repository root** — new file, holds the full CC BY 4.0 legal code plus the FA-specific attribution text. The codegen script writes it; do not hand-author.
- **`dist/lib/LICENSE-FONTAWESOME.md`** — Vite config must copy `LICENSE-FONTAWESOME.md` and `NOTICE` into `dist/lib/` so the npm tarball carries them. Add both filenames to the `files` array in [package.json](../package.json#L25).
- **File-header SPDX comment** in every generated icon `.ts` file: `// SPDX-License-Identifier: CC-BY-4.0` plus `// Source: Font Awesome Free <version>, https://fontawesome.com/license/free` plus `// © Fonticons, Inc.`. This is belt-and-braces — even if a downstream consumer copy-pastes a single icon file out of the npm package, the attribution travels with it.
- **`package.json` `license` field stays `LicenseRef-PolyForm-Noncommercial-1.0.0`** (the *project* license), but add a new `licenses` array (deprecated SPDX field, but npm still surfaces it on the registry page) **or** prefer the modern approach: ship the NOTICE and LICENSE-FONTAWESOME files in the tarball and rely on package metadata pointing to them. The latter is correct per [npm docs](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#license); SPDX expressions in `license` can only carry one effective license.

### Compatibility with PolyForm Noncommercial 1.0.0

The project itself is licensed under **PolyForm Noncommercial 1.0.0** ([LICENSE](../LICENSE)), which restricts *use* of the library to non-commercial purposes (PolyForm NC §"Permitted Purposes" / §"Commercial Purposes"). The compatibility question is whether bundling CC BY 4.0 path data into a PolyForm-NC-licensed library creates any conflict — for both **commercial** and **non-commercial** consumers.

**CC BY 4.0 does not propagate restrictions to combined works.** CC BY 4.0 §2(a)(5) explicitly states: *"No downstream restrictions. You may not offer or impose any additional or different terms or conditions on, or apply any Effective Technological Measures to, the Licensed Material if doing so restricts exercise of the Licensed Rights by any recipient of the Licensed Material."* Crucially, this restricts what licensors of the *FA assets* can do — it does **not** force the surrounding work to adopt CC BY. CC BY 4.0 is also not a copyleft / "share-alike" license (unlike CC BY-SA), so a permissive surrounding license is not required; a restrictive one is allowed too.

**PolyForm NC's restrictions bind the project, not the FA assets.** PolyForm NC §"Permitted Purposes" limits what licensees of *this project* can do with the project. The CC BY 4.0 assets remain independently licensed under CC BY 4.0 to every recipient — i.e. a downstream consumer who, for any reason, extracts just the FA icon files from the npm tarball gets them under CC BY 4.0, not under PolyForm NC. This is normal multi-license aggregation, and PolyForm NC §"Notices" anticipates it by requiring redistribution of all `Required Notice:` lines the licensor provided alongside the project (which is where the bundled FA notices come in).

**Verdict for the user's commercial / non-commercial question:**

- **Non-commercial use of the project** — fully permitted: PolyForm NC allows it, CC BY 4.0 allows it (CC BY 4.0 has no non-commercial restriction at all), the combination is sound.
- **Commercial use of the project** — *blocked by PolyForm NC*, not by CC BY 4.0. The FA-Free icons themselves are commercially usable under CC BY 4.0. If the project is later re-licensed to a commercial-permitting license (MIT, Apache-2.0, BSD, ...), the FA Free bundle remains fully compatible with that new license without any re-extraction or re-attribution work beyond updating the project license file. The attribution obligations (NOTICE / LICENSE-FONTAWESOME / SPDX headers) are unchanged across licenses.

**Pro icons are excluded.** Font Awesome Pro variants — *Light*, *Thin*, *Duotone*, *Sharp Solid*, *Sharp Regular*, *Sharp Light*, *Sharp Thin*, *Sharp Duotone* — are **not** licensed under CC BY 4.0 and are not redistributable. The codegen script must hard-fail if pointed at a Pro tree, and the import scope is limited to exactly `solid`, `regular`, `brands` (the three Free styles).

---

## Architecture Decisions

### Explicit registration — option C from the brief

`Glyph(name: string)` keeps its current lookup-by-name ergonomics. Consumers opt their icons in at module init:

```ts
import { Glyph } from '@jimka/typescript-ui/component/display';
import { times, edit, plus } from '@jimka/typescript-ui/glyphs';
Glyph.register(times, edit, plus);
```

Tree-shaker drops every icon module not imported. The bundle for a 3-icon consumer ships 3 path strings, not 2,000.

Rejected alternatives:

- **(A) Bulk-import named consts plus name-lookup helper.** The bundler cannot prove the lookup site only uses three names; the entire barrel stays reachable. Out.
- **(B) Lazy on-demand JSON fetch.** Forces async into the `Glyph` constructor and ships per-icon `.json` files in `dist/`. Unnecessary network round-trip, breaks the "Glyph is synchronously usable" invariant established by [embedded-glyph.md](implemented/embedded-glyph.md). Out.

### Per-icon module shape — self-describing object

Each generated file exports a single object that knows its own name:

```ts
// src/typescript/lib/glyphs/solid/times.ts
// SPDX-License-Identifier: CC-BY-4.0
// Source: Font Awesome Free <version>, https://fontawesome.com/license/free
// © Fonticons, Inc.
import type { NamedGlyphDef } from "~/component/display/Glyphs.js";

export const times: NamedGlyphDef = {
    name:    "times",
    kind:    "svg",
    viewBox: "0 0 352 512",
    path:    "M242.72 256l100.07-100.07c12.28-12.28..."
};
```

The `{name, def}` tuple shape sketched in the brief is rejected — it adds a second indirection at every call site (`Glyph.register({name: "times", def: times})`) and forces the consumer to repeat the name string. A self-describing object lets `Glyph.register(times)` work without a tuple.

`NamedGlyphDef` is `GlyphDef & { name: string }` — a new exported type in [Glyphs.ts](../src/typescript/lib/component/display/Glyphs.ts) alongside the existing `GlyphDef`.

### Curated entries are replaced by their latest-FA counterparts — no auto-registration, no separate curated track

The 19 hand-curated entries currently in [Glyphs.ts:53-151](../src/typescript/lib/component/display/Glyphs.ts#L53) are **deleted outright**. Each one has a same-named (or near-named) counterpart in the latest FA Free release — `times`, `chevron-down`, `xmark`, `plus`, etc. The codegen script produces those as per-icon modules in `src/typescript/lib/glyphs/{solid,regular,brands}/<name>.ts`; library call sites import directly from there. There is **no** `curated/` folder and no parallel hand-authored track to maintain across FA upgrades.

A one-time mapping table (built during step 6 below) records, for each of the 19 previously-curated names, which FA style + name to import. Where FA renamed an icon between versions (e.g. FA5 `times` → FA6 `xmark`), the mapping picks the latest name and the affected call sites switch to that name. The decision is intentional: the project tracks upstream nomenclature rather than freezing legacy aliases.

Nothing is loaded into the runtime registry until an explicit `Glyph.register(...)` call runs. The runtime Map starts empty.

**Library components that use glyphs must register them at module load.** Concretely, every `.ts` file in `src/typescript/lib/component/**` that calls `new Glyph("xmark")` (or any other name) gets a top-of-file:

```ts
import { xmark } from "~/glyphs/solid/xmark.js";
Glyph.register(xmark);
```

This keeps the lib internally tree-shakable: a consumer who imports only `Window` pulls in `xmark` (because `Window.ts` imports and registers it), but does not pull in `chevron-down` unless they also import `Tree`. Each component is self-contained for its glyph needs.

Name collisions: `register` overwrites silently (last-write-wins). A consumer who wants a different style of a same-named icon (e.g. `regular/heart` over `solid/heart`) can register that one after — the order at the consumer's bootstrap is the source of truth.

### Single mutable registry, starts empty

The current `Glyphs` const is `Object.freeze`d. To support `Glyph.register(...)` it must become mutable. Replace the frozen literal with a mutable `Map<string, GlyphDef>` private to `Glyphs.ts`, **initialized empty** — no curated seeding. `Glyph` reads through `lookupGlyph(name)` (new internal helper) instead of `Glyphs[name]`. Every name the consumer or a library component constructs must have been registered first; otherwise the existing throw at [Glyph.ts:78-80](../src/typescript/lib/component/display/Glyph.ts#L78) fires.

The sprite mount logic at [Glyphs.ts:178-211](../src/typescript/lib/component/display/Glyphs.ts#L178) must change too — it currently iterates the frozen object once on first SVG glyph use. After registration becomes dynamic, the sprite must mount-or-extend each time a previously-unseen SVG glyph is constructed. Simplest approach: `ensureGlyphSpriteFor(name)` appends a single `<symbol>` for that name to the sprite, idempotent per name. Discussed in **Internal Structure** below.

### Codegen script is a one-shot, output committed to source

`scripts/import-fontawesome.ts` runs on demand (when the user imports / re-imports the latest FA Free release), not on every build. Output files are committed. This keeps the runtime build path free of network calls and the FA dependency, and lets the implementer review the generated diff before shipping. The script accepts a path argument pointing at the extracted FA Free `svgs/` tree of the **latest** release:

```
node scripts/import-fontawesome.ts ./vendor/Font-Awesome-<latest>/svgs/
```

It writes:

- `src/typescript/lib/glyphs/solid/<name>.ts` for every solid icon
- `src/typescript/lib/glyphs/regular/<name>.ts` for every regular icon
- `src/typescript/lib/glyphs/brands/<name>.ts` for every brands icon
- `src/typescript/lib/glyphs/index.ts` — re-exports every per-icon module
- `src/typescript/lib/glyphs/solid/index.ts`, `regular/index.ts`, `brands/index.ts` — per-style barrels
- `LICENSE-FONTAWESOME.md` at repo root
- Updates `NOTICE` with the FA Free corpus reference (idempotent — script detects an existing FA section by marker comment and rewrites between markers)

The script aborts (non-zero exit) if it encounters any subdirectory under the *input* path (i.e. the FA `svgs/` tree) other than `solid/`, `regular/`, `brands/`, or if any `.svg` file has more than one `<path>` element (FA Free icons are single-path; multi-path is a Pro Duotone signal and must not be redistributed).

### New `./glyphs/*` exports subpath

`package.json` adds:

```json
"./glyphs": { "import": "./dist/lib/glyphs/index.es.js", "types": "./dist/lib/types/glyphs/index.d.ts" },
"./glyphs/*": { "import": "./dist/lib/glyphs/*.es.js", "types": "./dist/lib/types/glyphs/*.d.ts" }
```

This gives consumers two import styles:

- Bulk: `import { times, edit, plus } from '@jimka/typescript-ui/glyphs'` — relies on tree-shaking
- Per-style: `import { times } from '@jimka/typescript-ui/glyphs/solid/times'` — guarantees one path string in bundle

Both must work; `vite.lib.config.ts` ([vite.lib.config.ts](../vite.lib.config.ts)) needs glob inputs for the per-icon files, similar to how the existing component subpaths are wired. The new entry-point fan-out (potentially ~2,000 files) needs verification that Vite/Rollup handles it without per-file overhead exploding the build time — see **Potential Challenges**.

### `Glyph.register` and `Glyph.unregister` are static methods

Static methods on `Glyph` keep the registration call site away from any instance:

```ts
class Glyph extends Component {
    static register(...defs: NamedGlyphDef[]): void;
    static unregister(name: string): void;
}
```

`unregister` is included for symmetry but is a low-value affordance — list it in JSDoc and don't document it on the README. Its primary use is unit tests that need to reset the registry between cases.

`register` overwrites silently if the name is already present. No throw on collision — explicit overwrite is the intended path for swapping a curated icon for its FA counterpart (or vice versa) at consumer bootstrap.

---

## Public API (TypeScript Signatures)

### `Glyph` additions — `src/typescript/lib/component/display/Glyph.ts`

```typescript
export class Glyph extends Component<GlyphOptions> {
    // ... existing constructor, getName, getLineHeight, setLineHeight, ...

    /**
     * Adds one or more glyph definitions to the runtime registry.
     * Overwrites silently when a name collides with a curated or
     * previously-registered entry.
     */
    static register(...defs: NamedGlyphDef[]): void;

    /**
     * Removes a glyph from the runtime registry. No-op if the name is unknown.
     * Removes the corresponding `<symbol>` from the shared sprite if present.
     */
    static unregister(name: string): void;
}
```

### `Glyphs.ts` additions — `src/typescript/lib/component/display/Glyphs.ts`

```typescript
export type NamedGlyphDef = GlyphDef & { name: string };

// Internal — not re-exported through component/display/index.ts
export function registerGlyph(def: NamedGlyphDef): void;
export function unregisterGlyph(name: string): void;
export function lookupGlyph(name: string): GlyphDef | undefined;
```

The existing `Glyphs` const-export is **replaced** by `lookupGlyph(name)`. The const becomes a private mutable Map, initialized empty. This is a breaking change to the internal-only `Glyphs` export, but inspection of [Glyph.ts:5](../src/typescript/lib/component/display/Glyph.ts#L5) shows it has exactly one consumer (`Glyph` itself), which the plan updates.

### Per-icon module shape — `src/typescript/lib/glyphs/<style>/<name>.ts`

```typescript
// SPDX-License-Identifier: CC-BY-4.0
// Source: Font Awesome Free <version>, https://fontawesome.com/license/free
// © Fonticons, Inc.
import type { NamedGlyphDef } from "~/component/display/Glyphs.js";
export const <name>: NamedGlyphDef = { name: "<name>", kind: "svg", viewBox: "...", path: "..." };
```

Names that are not valid JS identifiers (e.g. icons starting with a digit like `0`, `1`, ... `9`, or hyphenated names like `arrow-right`) are exported under a sanitised identifier. Mapping rule:

- Replace `-` with `_`
- Prefix names starting with a digit with `_`
- Document the mapping in a generated `src/typescript/lib/glyphs/README.md` and as JSDoc on the per-style barrel

The registry **name** (the string passed to `new Glyph(name)`) stays the original FA name (`"arrow-right"`, `"500px"`, etc.) — only the JS export identifier is sanitised.

### Subpath exports — `package.json`

```json
{
    "exports": {
        "./glyphs":   { "import": "./dist/lib/glyphs/index.es.js",   "types": "./dist/lib/types/glyphs/index.d.ts" },
        "./glyphs/*": { "import": "./dist/lib/glyphs/*.es.js",       "types": "./dist/lib/types/glyphs/*.d.ts" }
    }
}
```

---

## Internal Structure

### Mutable registry replacement

```ts
// Glyphs.ts (sketch)
const _glyphs: Map<string, GlyphDef> = new Map();   // starts empty — no seeding

export function lookupGlyph(name: string): GlyphDef | undefined {
    return _glyphs.get(name);
}

export function registerGlyph(def: NamedGlyphDef): void {
    _glyphs.set(def.name, def);
    if (def.kind === "svg" && spriteMounted) {
        addSymbolToSprite(def.name, def);  // see below
    }
}

export function unregisterGlyph(name: string): void {
    const def = _glyphs.get(name);
    if (!def) return;
    _glyphs.delete(name);
    if (def.kind === "svg" && spriteMounted) {
        removeSymbolFromSprite(name);
    }
}
```

### Sprite mount becomes incremental

The current `ensureGlyphSprite()` mounts the entire sprite once. After this change there are two cases:

- **First SVG glyph constructed** — mount the sprite element, populate with all currently-registered SVG entries (which by this point includes whatever the caller and its imported library components have registered).
- **Subsequent register() of a new SVG name** — append one `<symbol>` to the already-mounted sprite (if the registration happens after first sprite mount).

Add `addSymbolToSprite(name, def)` and `removeSymbolFromSprite(name)` helpers in `Glyphs.ts`. Both are idempotent.

---

## Codegen Script — `scripts/import-fontawesome.ts`

Behaviour (pseudo-code):

```
1. Parse argv[2] as the path to the FA `svgs/` directory.
2. Verify only `solid/`, `regular/`, `brands/` children exist; abort on anything else.
3. Read FA's package.json from the parent of svgs/ to capture the version string.
4. For each style:
   a. For each .svg file:
      - Parse out the single <path d="..."> and <svg viewBox="...">. Abort on any file with !=1 path.
      - Sanitise the icon name to a valid JS identifier; preserve the original as the `name` string field.
      - Write src/typescript/lib/glyphs/<style>/<name>.ts with the SPDX/attribution header and the const export.
   b. Write src/typescript/lib/glyphs/<style>/index.ts as `export * from './<name>.js'` for every file.
5. Write src/typescript/lib/glyphs/index.ts re-exporting all three style barrels.
6. Write LICENSE-FONTAWESOME.md at the repo root (full CC BY 4.0 legal code + FA-specific attribution).
7. Update NOTICE between marker comments (`<!-- BEGIN: font-awesome-free -->` / `<!-- END: font-awesome-free -->`).
8. Print summary: "<N> icons generated across solid/regular/brands, FA version <version>".
```

The script is invoked manually against whatever the user has extracted:

```
npx tsx scripts/import-fontawesome.ts ./vendor/Font-Awesome-<latest>/svgs/
```

It does **not** download the FA tarball — that is a manual step the user performs (e.g. `npm pack @fortawesome/fontawesome-free@latest` then extract). This avoids tying the build to a network fetch and keeps version selection in the user's hands; pinning to "latest at import time" is enforced by procedure (the user fetches `@latest`), not by the script.

Add `tsx` to `devDependencies` if not already present (it isn't — see [package.json:31-40](../package.json#L31)).

---

## Ordered Implementation Steps

1. **Fetch the latest FA Free release** — `npm pack @fortawesome/fontawesome-free@latest`, extract under `vendor/`. Record the resolved version string for the NOTICE update. → verify: `vendor/Font-Awesome-<v>/svgs/{solid,regular,brands}/` exists; no `light`, `thin`, `duotone`, or `sharp` directories present.
2. **License audit** — Confirm CC BY 4.0 attribution requirements are met by the **NOTICE** update and `LICENSE-FONTAWESOME.md`. Cross-check that no FA Pro icon styles are present in the input tree. → verify: `grep -i 'light\|duotone\|sharp' <fa-tree>/ -r` returns only the inert mention in FA's own README, not directory names.
3. **Write `LICENSE-FONTAWESOME.md`** at the repository root with the full CC BY 4.0 legal text and the FA-specific attribution lines. → verify: file exists, contains both the CC BY 4.0 license URL and "© Fonticons, Inc."
4. **Update [NOTICE](../NOTICE)** — add marker comments around the existing FA Free section so future codegen runs are idempotent, and broaden the section to state that **all** files under `dist/lib/glyphs/` derive from FA Free `<resolved version>`. → verify: diff is minimal.
5. **Write `scripts/import-fontawesome.ts`** — per the **Codegen Script** section. Add `tsx` to devDependencies. → verify: `npx tsx scripts/import-fontawesome.ts --help` prints usage; running against a synthetic 2-file fixture produces the expected outputs.
6. **Generate all FA icons** — run the script against the fetched latest svgs/ tree. Commit the entire `src/typescript/lib/glyphs/{solid,regular,brands}/` output. → verify: those three directories exist, plus an `index.ts`; spot-check that each of the 19 currently-curated names resolves to an FA file (or its renamed successor — `times` → `xmark`, etc.) and matches the upstream path data.
7. **Build the curated→latest mapping** — for each of the 19 names in the current [Glyphs.ts](../src/typescript/lib/component/display/Glyphs.ts), record `{ oldName, newStyle, newName }`. Most will be `{ "close", "solid", "xmark" }`-shaped (a style + possible rename); same-name entries are `{ "plus", "solid", "plus" }`. Keep this mapping inline in the PR description (not committed as a permanent file — it's a one-shot migration record). → verify: every old name has exactly one mapping row; the chosen style/name pair exists under `src/typescript/lib/glyphs/`.
8. **Refactor [Glyphs.ts](../src/typescript/lib/component/display/Glyphs.ts)** — replace the frozen `Glyphs` const with an empty mutable Map plus `registerGlyph`/`unregisterGlyph`/`lookupGlyph` helpers and the incremental sprite helpers. Export the new `NamedGlyphDef` type. **Delete the inline 19-entry literal entirely** — the latest FA modules replace it. → verify: `npm run typecheck` clean; no remaining `Object.freeze` of the registry; the 19 hardcoded path strings are gone from the file.
9. **Refactor [Glyph.ts](../src/typescript/lib/component/display/Glyph.ts)** — swap `Glyphs[name]` for `lookupGlyph(name)`; add the `static register` and `static unregister` methods that delegate to the Glyphs helpers. → verify: `Glyph.register({name: "x", kind: "char", char: "x"})` followed by `new Glyph("x")` works; `new Glyph("notyetregistered")` throws.
10. **Migrate library call sites using the mapping** — every `.ts` file under `src/typescript/lib/component/**` that constructs a `Glyph` by name (e.g. [component/window](../src/typescript/lib/component/window) close button, [TreeRow.ts](../src/typescript/lib/component/tree/TreeRow.ts) chevrons) is updated in two steps: (a) the `new Glyph("oldName")` string switches to the mapped `newName` (e.g. `"close"` → `"xmark"`); (b) the file gains a top-of-file `import { <newName> } from "~/glyphs/<newStyle>/<newName>.js"; Glyph.register(<newName>);`. Each component becomes self-contained for its glyph dependencies. → verify: `grep -rn 'new Glyph(' src/typescript/lib/component/` enumerates every call site; for each, the same file contains a matching `Glyph.register(...)` at top level and the name passed to `new Glyph(...)` matches the registered name exactly; manual smoke at `http://localhost:8015` shows no missing-glyph throws on the existing demos (Window close, Tree chevron, etc.).
11. **Add subpath exports** to [package.json](../package.json) — `./glyphs` and `./glyphs/*`. → verify: `npm pack --dry-run` shows the new subpaths in the manifest, including a per-icon path like `./glyphs/solid/xmark`.
12. **Wire `vite.lib.config.ts`** — add glob-based entry points for `src/typescript/lib/glyphs/**/*.ts`. → verify: `npm run build:lib` emits one `.es.js` per icon under `dist/lib/glyphs/`.
13. **Export the `Glyph.register`/`Glyph.unregister` surface** through [component/display/index.ts](../src/typescript/lib/component/display/index.ts). No new line — they live on the existing `Glyph` export. Also re-export `NamedGlyphDef` as a public type. → verify: `import type { NamedGlyphDef } from '@jimka/typescript-ui/component/display'` resolves.
14. **README update** — add a "Glyphs" section showing the explicit-registration usage example: `import { times } from '@jimka/typescript-ui/glyphs/solid/times'; Glyph.register(times);`. Document that **no glyphs are auto-registered** — every name must be explicitly registered. Note that library components register their own internal glyphs at module load, so a consumer who imports `Window` does not need to register the close icon themselves. Call out the renames in a small migration table for users upgrading from the previous curated names.
15. **Bundle-size demo** — temporary demo file that imports exactly three icons and registers them. Build, inspect `dist/`, confirm only those three icon modules are pulled into the demo bundle. Delete demo file after verification. → verify: bundle contains `xmark`, `pen`, `plus` (or whichever three were imported) path strings; does **not** contain `triangle-exclamation` or any other unimported FA icon path.
16. **`graphify update .`** to refresh the knowledge graph after the source changes.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `scripts/import-fontawesome.ts` |
| Create | `LICENSE-FONTAWESOME.md` |
| Create | `src/typescript/lib/glyphs/index.ts` (codegen output) |
| Create | `src/typescript/lib/glyphs/solid/index.ts` (codegen output) |
| Create | `src/typescript/lib/glyphs/regular/index.ts` (codegen output) |
| Create | `src/typescript/lib/glyphs/brands/index.ts` (codegen output) |
| Create | `src/typescript/lib/glyphs/solid/<icon>.ts` × ~1,400 (codegen output) |
| Create | `src/typescript/lib/glyphs/regular/<icon>.ts` × ~165 (codegen output) |
| Create | `src/typescript/lib/glyphs/brands/<icon>.ts` × ~490 (codegen output) |
| Create | `src/typescript/lib/glyphs/README.md` (codegen output, identifier-mapping reference) |
| Modify | `src/typescript/lib/component/display/Glyphs.ts` — empty mutable registry, add `registerGlyph`/`unregisterGlyph`/`lookupGlyph`, `NamedGlyphDef`; delete the 19-entry frozen literal entirely |
| Modify | `src/typescript/lib/component/display/Glyph.ts` — use `lookupGlyph`, add `static register`/`unregister` |
| Modify | `src/typescript/lib/component/display/index.ts` — re-export `NamedGlyphDef` type |
| Modify | Every file under `src/typescript/lib/component/**` that constructs a `Glyph` by name — rename to its latest-FA counterpart per the migration mapping, add top-of-file `import` + `Glyph.register(...)` |
| Modify | [package.json](../package.json) — add `./glyphs` and `./glyphs/*` exports; add `tsx` to `devDependencies`; ensure `LICENSE-FONTAWESOME.md` and `NOTICE` are in `files`/copied to `dist/lib/` |
| Modify | [vite.lib.config.ts](../vite.lib.config.ts) — glob-based entry points for per-icon files (covers `solid`, `regular`, `brands`) |
| Modify | [NOTICE](../NOTICE) — broaden FA Free section, add marker comments, record imported FA version |
| Modify | [README.md](../README.md) — add Glyphs usage section, including a small migration table of legacy→latest names |
| Delete | (none) |

Approximate counts taken from Font Awesome Free 6.x; exact numbers depend on the imported version.

---

## Verification

1. **License/NOTICE present in tarball** — `npm pack --dry-run` output lists `LICENSE-FONTAWESOME.md` and `NOTICE` at the package root.
2. **Type check** — `npm run typecheck` clean.
3. **Library build** — `npm run build:lib` clean; `dist/lib/glyphs/solid/times.es.js` exists.
4. **Docs build** — `npm run docs:build` reports **0 errors and 0 link warnings** (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning per [CLAUDE.md](../CLAUDE.md)).
5. **Bundle-size proof** — temporary demo at [src/typescript/demo](../src/typescript/demo) imports 3 icons and registers them; build output shows ~3 path strings in the demo bundle, not 2,000. Inspect via `grep -c 'kind:' dist/demo/*.js` or similar.
6. **Runtime smoke** at `http://localhost:8015` — `new Glyph("xmark")` works only after `Glyph.register(xmark)`; same for every other name. Confirm `new Glyph("xmark")` *before* any registration throws `Error("Unknown glyph: xmark")` (the existing throw at [Glyph.ts:78-80](../src/typescript/lib/component/display/Glyph.ts#L78)) — i.e. confirm there is no leftover auto-registration path.
7. **Existing call sites still render after migration** — every pre-existing `new Glyph("...")` call site uses its mapped latest-FA name and has a matching `Glyph.register(...)` registration in the same file (step 10). Walk the **MiscPanel** stress test, the Window close button, and the Tree demo to confirm no missing-icon regression.
8. **Re-import workflow** — re-run `scripts/import-fontawesome.ts` against the same FA version; git diff is empty (script is deterministic).
9. **Graph refresh** — `graphify update .` succeeds.

---

## Documentation Impact

- The new `Glyph.register` / `Glyph.unregister` static methods and the `NamedGlyphDef` type are public; document them on the **Glyph** page under `docs/component/display/`. Update its `index.md` catalog and the sidebar in [docs/.vitepress/config.mts](../docs/.vitepress/config.mts).
- The per-icon modules under `@jimka/typescript-ui/glyphs` are not individually documented — add a single curated page `docs/component/display/glyphs.md` (or similar) explaining the registration pattern, the legacy→latest migration table for callers upgrading from the previously-curated names, and a link to FA's icon browser for the catalog. Auto-generating ~2,000 typedoc pages is rejected — they would drown the sidebar.
- Same-bucket `{@link Glyph}` references inside `component/display` JSDoc continue to work. Any cross-bucket reference uses the markdown-link form per [CLAUDE.md](../CLAUDE.md).
- README "Glyphs" section per step 12.

---

## Potential Challenges

- **Vite/Rollup with 2,000+ entry points.** A glob input fan-out at this scale may explode build time or hit per-file overhead. Mitigation: measure on a 100-icon subset first; if `npm run build:lib` regresses meaningfully, switch the bulk barrel to a single Rollup entry that re-exports everything (the per-icon files stay as separate source files for tree-shaking on the consumer's bundler, but the library build itself emits one chunk per style instead of one per icon). The deep-import path `@jimka/typescript-ui/glyphs/solid/times` would then resolve via tsc-emitted `.d.ts` plus a stub re-export rather than its own Vite chunk.
- **Tree-shaking fragility.** Modern bundlers (esbuild, Rollup, Vite) tree-shake `export const` reliably **only when** there are no side effects in the importing chain. `"sideEffects": false` is already set in [package.json:24](../package.json#L24); confirm the codegen-generated icon files contain no top-level statements other than the `export const`. The SPDX comment is fine.
- **`Glyph.register` ordering matters for first paint.** A call site that does `new Glyph("xmark")` at module top level **before** `Glyph.register(xmark)` runs will throw. With no auto-registration safety net, this is true for *every* glyph. Mitigation: every library component that uses a glyph imports + registers it at the top of its own file (step 10), so import order = registration order. Consumers follow the same pattern in their bootstrap module.
- **FA renames between versions.** The latest FA Free release renames some FA5/early-FA6 icons (e.g. `times` → `xmark`, `edit` → `pen-to-square`). The mapping built in step 7 must surface every legacy curated name to its latest counterpart. Mitigation: the README migration table lists the renames so external consumers upgrading from the previously-shipped curated names know which names to switch to.
- **Style ambiguity.** Some legacy curated names exist in more than one FA style (e.g. `heart` is in both `solid/` and `regular/`). The mapping must commit to one style per legacy name — the choice should match the *visual* of the previously-curated entry (compare path data). Mitigation: when in doubt during step 7, render both side-by-side and pick the closer match; document the choice in the migration table.
- **Future FA-version upgrades.** When a later FA release renames an icon that lib internals currently register, those internal call sites must be updated in lock-step with the codegen re-run. Mitigation: add a step to the codegen-rerun workflow that greps `src/typescript/lib/component/**` for any `new Glyph("<name>")` whose name no longer exists in the freshly-generated tree, and fails loudly. Out of scope for this plan to automate fully — call it out in the README's "Upgrading FA" section.
- **NOTICE/LICENSE file copying into dist.** Vite library mode does not copy files outside the entry-input set by default. Use a small Vite plugin or `vite-plugin-static-copy` (or a post-build `cp` in the `build:lib` script) to drop `NOTICE` and `LICENSE-FONTAWESOME.md` into `dist/lib/`. Verify the npm `files` field includes both.
- **Sanitised export identifiers.** Some FA icons start with digits (`500px`, `42-group`, etc.). The generated export identifier must be valid JS; document the mapping rule both in the generated README and in JSDoc on the per-style barrel.
- **Sprite mount race during async registration.** If a consumer awaits an async import before calling `Glyph.register`, the first `new Glyph(...)` may construct the sprite with only the synchronously-registered entries; later `register` calls need to extend the live sprite. The incremental sprite helpers cover this, but it's worth a unit test: register an SVG glyph, construct it, register a second SVG glyph, construct it — confirm both `<symbol>` elements are in the DOM.

---

## Critical Files

- [src/typescript/lib/component/display/Glyph.ts](../src/typescript/lib/component/display/Glyph.ts) — the constructor and rendering pipeline that `register`/`unregister` plug into.
- [src/typescript/lib/component/display/Glyphs.ts](../src/typescript/lib/component/display/Glyphs.ts) — the curated registry and sprite helper this plan refactors.
- [plans/implemented/embedded-glyph.md](implemented/embedded-glyph.md) — the original design decisions for `Glyph` (tagged-union, `currentColor`, throw-on-unknown). This plan preserves all of them.
- [plans/implemented/glyph-adoption.md](implemented/glyph-adoption.md) — the adoption pass that moved call sites onto the curated names. Confirms which icon names this plan must keep auto-registered.
- [NOTICE](../NOTICE) — existing FA Free attribution; this plan broadens it.
- [LICENSE](../LICENSE) — PolyForm Noncommercial 1.0.0, the project license whose compatibility with CC BY 4.0 is established above.
- [package.json](../package.json) — `exports` map, `files`, `sideEffects`, `license`.
- [vite.lib.config.ts](../vite.lib.config.ts) — multi-entry-point library build that needs new glob inputs.

---

## Non-Goals

- **No FA Pro icons.** Light, Thin, Duotone, Sharp variants are not redistributable under CC BY 4.0 and stay out of scope. The codegen script hard-fails if it encounters them.
- **No FA web fonts.** This plan ships SVG path data only; no `.woff2`, no `@font-face` CSS, no SIL OFL licensing engagement.
- **No FA runtime CSS or JS.** The MIT-licensed code portion of FA Free is not bundled.
- **No auto-registration at all.** Neither the 2,000 FA icons nor the 19 curated entries are auto-registered. Every glyph must be explicitly registered before it can be constructed by name. This is a uniform rule with no exceptions.
- **No per-icon typedoc pages.** Auto-generating 2,000 doc pages would drown the sidebar; a single curated `glyphs.md` page covers the registration pattern, with a link to FA's browser for the icon list.
- **No CC BY-SA, GPL, or other copyleft icon sets bundled alongside.** Cross-license aggregation is harder than CC BY 4.0; out of scope for this plan.
- **No async glyph loading.** Option B from the brief (lazy on-demand JSON fetch) is rejected; `Glyph` stays synchronous.
- **No new `new Glyph(...)` call-site behaviour.** The constructor signature, throw-on-unknown semantics, and rendering pipeline are unchanged; the only call-site delta is renaming each lib-internal `new Glyph("oldName")` to its latest-FA counterpart and adding a `Glyph.register(...)` next to it. Consumer call sites are not migrated by this plan — consumers update their bootstrap (and any legacy name strings) as part of upgrading; the README migration table tells them which names changed.
- **No FA version pinning.** This plan imports whatever is `@fortawesome/fontawesome-free@latest` at the time the codegen script is run; it does not encode the version in a config file. The resolved version is captured in NOTICE for attribution but is not enforced on subsequent runs.
- **No CI step for the codegen script.** It runs manually when re-importing a new FA Free release.
