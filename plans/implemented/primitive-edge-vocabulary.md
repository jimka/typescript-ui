---
touches-shared:
  - src/typescript/lib/component/container/Scrollbar.ts
  - src/typescript/lib/primitive/index.ts
---

# Primitive Edge Vocabulary — Implementation Plan

## Overview

A type-only terminology-unification refactor. Today three scattered string-literal unions each re-spell the physical box edges (`"top"`, `"bottom"`, `"left"`, `"right"`) inline. This plan defines those edge literals **once** as shared primitives in [`src/typescript/lib/primitive/`](../src/typescript/lib/primitive/) — beside [`Placement.ts`](../src/typescript/lib/primitive/Placement.ts) — and rewrites the three existing unions to **compose** from them. Every runtime string value is preserved byte-for-byte; this is purely about sourcing the literals from one canonical place. **No behaviour changes whatsoever.**

The new primitives:
- `HorizontalSide = "left" | "right"`
- `VerticalSide   = "top"  | "bottom"`
- `Edge           = HorizontalSide | VerticalSide`

These describe **physical** edges that do **not** flip under RTL (arrow glyph directions, drop zones, popover placement). The logical, RTL-flipping axis-relative vocabulary (`AxisOrientation`/`AxisPosition`/`AxisEnd`/`AxisSpread`, and the `chevronSide` / ToolBar `overflowSide` callers) is owned by the sibling plan `primitive-axis-vocabulary.md` and is explicitly out of scope here (see [Non-Goals](#non-goals)).

The compositions:
1. [`DropZoneOverlay.ts:15`](../src/typescript/lib/core/component/DropZoneOverlay.ts#L15) — `DropZone = "top" | "bottom" | "left" | "right" | "center"` → `Edge | "center"`.
2. [`Popover.ts:52`](../src/typescript/lib/core/Popover.ts#L52) — `PopoverPlacement = "top" | "bottom" | "left" | "right" | "auto"` → `Edge | "auto"`.
3. [`Scrollbar.ts:105`](../src/typescript/lib/component/container/Scrollbar.ts#L105) — `ArrowDirection = "up" | "down" | "left" | "right"` → `HorizontalSide | "up" | "down"` (**partial** — `up`/`down` stay, see [Architecture Decisions](#architecture-decisions)).

---

## Architecture Decisions

### File name and shape — one file `Edge.ts`, three exported type aliases

All three primitives live in a single new file [`src/typescript/lib/primitive/Edge.ts`](../src/typescript/lib/primitive/Edge.ts), exported as `export type` aliases (not `enum`s). They are byte-for-byte composable string-literal unions, and the call sites consume bare string literals (`"top"`, CSS class fragments, glyph-name fragments) — an `enum` would change the runtime representation and break that, so a `type` is mandatory. The existing primitives are split between `enum`s ([`Placement.ts`](../src/typescript/lib/primitive/Placement.ts), `BorderStyle.ts`) and `type`s ([`Size.ts`](../src/typescript/lib/primitive/Size.ts)); the type-alias form here matches `Size.ts`. Grouping the three into one `Edge.ts` (rather than `HorizontalSide.ts` + `VerticalSide.ts` + `Edge.ts`) keeps the tightly-coupled trio in one place; `Edge` is the umbrella name and the natural file name.

The file follows the established `primitive/` header convention: SPDX line first, then a JSDoc block per export carrying `@category Util` (matching `Placement.ts`, `Position.ts`, `Size.ts`, all `@category Util`).

### `ArrowDirection` only **partially** composes — `up`/`down` are load-bearing glyph keys

`ArrowDirection`'s four literals are **string keys**, not just type members:

- [`Scrollbar.ts:148`](../src/typescript/lib/component/container/Scrollbar.ts#L148) builds the glyph name by concatenation: `new Glyph("unicode-arrow-" + direction)`.
- The registered glyph names are exactly [`Glyphs.ts:43-46`](../src/typescript/lib/component/display/Glyphs.ts#L43): `"unicode-arrow-up"`, `"unicode-arrow-down"`, `"unicode-arrow-left"`, `"unicode-arrow-right"`.
- [`Scrollbar.ts:423-424`](../src/typescript/lib/component/container/Scrollbar.ts#L423) selects `"up"`/`"down"` for the vertical bar and `"left"`/`"right"` for the horizontal bar.

So `"left"`/`"right"` can safely be sourced from `HorizontalSide`, but `"up"`/`"down"` **must not** be normalized to `"top"`/`"bottom"` — doing so would require renaming the registered glyphs (`unicode-arrow-up` → `unicode-arrow-top`) and every other consumer of those keys. That is a rename, not a composition, and is out of scope. `ArrowDirection` therefore composes only its horizontal half: `HorizontalSide | "up" | "down"`. This is the deliberate, documented reason it is partial.

### Compositions preserve every literal — no value renamed

`Edge` expands to exactly `"left" | "right" | "top" | "bottom"`, which is the same **set** of literals as each old union's edge portion (member order in a string-literal union is semantically irrelevant to TypeScript). Therefore:
- `DropZone` stays `"top" | "bottom" | "left" | "right" | "center"` (now spelled `Edge | "center"`).
- `PopoverPlacement` stays `"top" | "bottom" | "left" | "right" | "auto"` (now `Edge | "auto"`).
- `ArrowDirection` stays `"up" | "down" | "left" | "right"` (now `HorizontalSide | "up" | "down"`).

No CSS class name, positioning branch, or glyph key changes, because no literal value changes. The structural equality of each composed alias to its old literal union is the load-bearing invariant; `tsc` is the verifier ([Verification](#verification)).

### No new barrel wiring needed — the `primitive` subpath already resolves

This project requires a directory subpath to be declared in **tsconfig + vite + package.json** before it resolves, but `primitive` is an **existing**, already-wired subpath:
- `tsconfig.json:14` — `"@jimka/typescript-ui/primitive": ["./src/typescript/lib/primitive/index.ts"]`
- `package.json:12` — `"./primitive"` export → `dist/lib/primitive.es.js` + types.
- `vite.lib.config.ts:26` and `vite.config.ts:19` — `primitive/index.ts` entry / alias.
- `typedoc.json:5` — `primitive/index.ts` is a TypeDoc entry point.

The new types only need to be **re-exported from the existing barrel** [`src/typescript/lib/primitive/index.ts`](../src/typescript/lib/primitive/index.ts). No tsconfig/vite/package.json edits are required.

---

## Public API (TypeScript Signatures)

New file `src/typescript/lib/primitive/Edge.ts`:

```ts
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * The two horizontal (left/right) physical box edges. Physical, not logical:
 * these do not flip under right-to-left layout.
 *
 * @category Util
 */
export type HorizontalSide = "left" | "right";

/**
 * The two vertical (top/bottom) physical box edges.
 *
 * @category Util
 */
export type VerticalSide = "top" | "bottom";

/**
 * Any of the four physical box edges.
 *
 * @category Util
 */
export type Edge = HorizontalSide | VerticalSide;
```

Barrel addition in `src/typescript/lib/primitive/index.ts`:

```ts
export type { Edge, HorizontalSide, VerticalSide } from '~/primitive/Edge.js';
```

Rewritten unions (values identical):

```ts
// DropZoneOverlay.ts
import type { Edge } from "~/primitive/Edge.js";
export type DropZone = Edge | "center";

// Popover.ts
import type { Edge } from "~/primitive/Edge.js";
export type PopoverPlacement = Edge | "auto";

// Scrollbar.ts — file-local type, not exported
import type { HorizontalSide } from "~/primitive/Edge.js";
type ArrowDirection = HorizontalSide | "up" | "down";
```

The existing JSDoc blocks on `DropZone`, `PopoverPlacement`, and `ArrowDirection` are kept verbatim (they describe behaviour that is unchanged).

---

## Ordered Implementation Steps

1. **Create [`src/typescript/lib/primitive/Edge.ts`](../src/typescript/lib/primitive/Edge.ts)** with the three `export type` aliases and the SPDX + `@category Util` JSDoc shown above.
2. **Export from the primitive barrel** — add `export type { Edge, HorizontalSide, VerticalSide } from '~/primitive/Edge.js';` to [`src/typescript/lib/primitive/index.ts`](../src/typescript/lib/primitive/index.ts).
3. **`DropZoneOverlay.ts`** — add `import type { Edge } from "~/primitive/Edge.js";`, change line 15 to `export type DropZone = Edge | "center";`. Keep the JSDoc.
4. **`Popover.ts`** — add `import type { Edge } from "~/primitive/Edge.js";`, change line 52 to `export type PopoverPlacement = Edge | "auto";`. Keep the JSDoc.
5. **`Scrollbar.ts`** — add `import type { HorizontalSide } from "~/primitive/Edge.js";`, change line 105 to `type ArrowDirection = HorizontalSide | "up" | "down";`. **Make this the only change to the file** (it is shared with the sibling axis plan — see [Potential Challenges](#potential-challenges)). Keep the JSDoc.
6. **Typecheck** — `npx tsc -p tsconfig.lib.json --noEmit` → expect 0 errors. (This is the structural-equality check; any literal mismatch in a composition surfaces here.)
7. **Grep the value invariant** — confirm no literal changed (see [Verification](#verification)).
8. **Docs build** — `npm run docs:build` → 0 errors, 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/primitive/Edge.ts` |
| Modify | `src/typescript/lib/primitive/index.ts` (add `export type` line) |
| Modify | `src/typescript/lib/core/component/DropZoneOverlay.ts` (import + line 15) |
| Modify | `src/typescript/lib/core/Popover.ts` (import + line 52) |
| Modify | `src/typescript/lib/component/container/Scrollbar.ts` (import + line 105 only) |

---

## Verification

- **Typecheck (load-bearing):** `npx tsc -p tsconfig.lib.json --noEmit` → **0 errors**. The composed aliases must be structurally identical to the old literal unions; any drift (e.g. a missing or extra literal) fails compilation at every consumer.
- **No literal value changed (grep invariant):**
  - `grep -n '"unicode-arrow-' src/typescript/lib/component/display/Glyphs.ts` → still the four `up/down/left/right` registrations, untouched.
  - `grep -n '"center"\|"auto"' src/typescript/lib/core/component/DropZoneOverlay.ts src/typescript/lib/core/Popover.ts` → the standalone literals (`center`, `auto`) remain spelled out in the composed aliases.
  - Confirm `Edge` resolves to exactly `"left" | "right" | "top" | "bottom"` (read `Edge.ts`) — same set as each old union's edge portion.
- **Docs build:** `npm run docs:build` → **0 errors and 0 link warnings** (the typedoc "unsupported TypeScript version" notice is the only acceptable warning). Confirm `Edge`, `HorizontalSide`, `VerticalSide` land under `docs/api/primitive/type-aliases/`.
- **No runtime/behaviour test needed** — this is a type-only refactor with byte-identical emitted JS. (Spot-check: `npm run build` emits the same Scrollbar glyph names; the typecheck already guarantees the union sets.)

---

## Documentation Impact

`primitive/index.ts` is a TypeDoc entry point (`typedoc.json:5`), so the three new exported type aliases auto-generate API pages under `docs/api/primitive/type-aliases/` on the next `docs:build` — no manual page authoring. There is **no curated `docs/primitive/` directory** (the sibling primitives `Placement`, `Position`, `Insets`, `Size` have no hand-written catalog pages either), and `primitive` is not a sidebar section in `docs/.vitepress/config.mts`, so **no sidebar or catalog `index.md` edit is required** for the new primitives themselves.

`DropZone` (exported via `layout/index.ts:44`) and `PopoverPlacement` (exported via `core/index.ts:39`) keep their existing auto-generated API pages — their public surface is unchanged. Optionally, their JSDoc may add a cross-bucket markdown link to the new primitive (`[\`Edge\`](/api/primitive/type-aliases/Edge)`) per `_shared/docs-conventions.md`, since `{@link}` does not resolve across buckets; this is a nicety, not required, and is the only doc-content change worth considering. `ArrowDirection` is file-local (not exported), so it has no doc page.

---

## Potential Challenges

- **Shared file `Scrollbar.ts` (merge hazard):** the sibling `primitive-axis-vocabulary.md` plan also edits `Scrollbar.ts` — it drops `ScrollbarOrientation` (≈ line 58) into the logical axis vocabulary, while this plan only touches `ArrowDirection` (≈ line 105) and adds one `import type` line. Keep this plan's edit minimal and atomic (one import + one type line, no reformatting of surrounding code) so the two changes merge cleanly. The two edits are at different, non-adjacent lines and add separate imports, so a clean merge is expected.
- **Shared primitive barrel:** both plans append `export type` lines to `src/typescript/lib/primitive/index.ts`. Appended exports on distinct lines merge without conflict; if both land, order is irrelevant.
- **Tempting over-normalization of `up`/`down`:** the obvious-looking "finish the job" move — renaming `up`/`down` to `top`/`bottom` so `ArrowDirection` fully composes from `Edge` — would silently break the `"unicode-arrow-" + direction` glyph lookup (`Glyphs.ts:43-46`). Do **not** do it; partial composition is correct here.

---

## Critical Files

- [`src/typescript/lib/primitive/Placement.ts`](../src/typescript/lib/primitive/Placement.ts) — the convention to mirror (SPDX header, `@category Util`, location).
- [`src/typescript/lib/primitive/Size.ts`](../src/typescript/lib/primitive/Size.ts) — the `export type` (non-enum) primitive shape to match.
- [`src/typescript/lib/primitive/index.ts`](../src/typescript/lib/primitive/index.ts) — barrel to extend.
- [`src/typescript/lib/component/display/Glyphs.ts:43`](../src/typescript/lib/component/display/Glyphs.ts#L43) — the `unicode-arrow-{up,down,left,right}` registrations that make `ArrowDirection`'s literals load-bearing.
- [`src/typescript/lib/component/container/Scrollbar.ts:148`](../src/typescript/lib/component/container/Scrollbar.ts#L148) and [`:423`](../src/typescript/lib/component/container/Scrollbar.ts#L423) — the glyph-name concatenation and direction selection that constrain `up`/`down`.

---

## Non-Goals

- **No logical / RTL-flipping vocabulary.** `AxisOrientation` / `AxisPosition` / `AxisEnd` / `AxisSpread`, and the `chevronSide` / ToolBar `overflowSide` callers, belong to the sibling `primitive-axis-vocabulary.md` plan and are not touched here. Those edges should flip under future RTL; the edges in this plan are physical and do not.
- **No compass-vocabulary merge.** `Placement` (north/south/east/west), `TabSide`, and `CollapseDirection` are not unified with `Edge`/`HorizontalSide`/`VerticalSide`. Overlapping the physical-edge and compass vocabularies is a deliberately deferred, riskier merge.
- **No renaming of `up`/`down` to `top`/`bottom`** in `ArrowDirection` — load-bearing glyph keys (see Architecture Decisions).
- **No behaviour change of any kind.** Emitted JS is byte-identical; this is a type-only sourcing change.
