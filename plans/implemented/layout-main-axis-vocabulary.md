---
touches-shared:
  - src/typescript/lib/layout/index.ts
---

# Shared Axis Alignment Vocabulary — Implementation Plan

## Overview

The single-line box layouts, the wrapping flow layouts, and the Tab layout each declare their own bespoke string-literal unions for the *same* two axis concepts: positioning a content block along an axis (the "align" concept), and spreading leftover slack into inter-item gaps (the "justify"/distribute concept). Today these appear as five independent unions — `BoxJustify` in [BoxLayout.ts:62](../src/typescript/lib/layout/BoxLayout.ts#L62), `FlowAlign`/`FlowJustify` in [FlowLayout.ts:40](../src/typescript/lib/layout/FlowLayout.ts#L40)/[FlowLayout.ts:81](../src/typescript/lib/layout/FlowLayout.ts#L81), and `TabAlign`/`TabTextAlign` in [Tab.ts:96](../src/typescript/lib/layout/Tab.ts#L96)/[Tab.ts:125](../src/typescript/lib/layout/Tab.ts#L125).

This plan extracts two shared union types into a new standalone file `src/typescript/lib/layout/AxisAlign.ts`:

```ts
export type AxisPosition = "start" | "center" | "end";   // positions a block along an axis (the "align" concept)
export type AxisSpread   = "start" | "between" | "around"; // distributes slack into gaps (the "justify"/distribute concept)
```

The vocabulary is then consolidated three ways:

- **Two named aliases are kept** because the union/subset they name is a real, reusable "thing": `BoxJustify = AxisPosition | AxisSpread` (stays in `BoxLayout.ts`) and `TabAlign = Exclude<AxisPosition, "center">` (stays in `Tab.ts`).
- **Three redundant aliases are hard-deleted** — `FlowAlign`, `FlowJustify` (both `FlowLayout.ts`), and `TabTextAlign` (`Tab.ts`). Their fields/options/setters/getters are retyped to the shared `AxisPosition`/`AxisSpread` directly, because the field name (`align`, `justify`, `textAlign`) already carries the role and the per-layout alias added nothing.

This is a **type-only refactor**. Every runtime string value is byte-identical and no value set changes, so `doLayout`/`justifyOffsets`/`alignLead`/the `TabBar` `_align === "end"` branches are untouched. The library is **prerelease** and **all consumers are in-repo**, so the three dropped names are *hard-deleted, not deprecated* — there are no `@deprecated` re-export shims. The shared barrel [index.ts](../src/typescript/lib/layout/index.ts) loses the three dropped exports and gains the two new ones; `BoxJustify`/`TabAlign` keep flowing through it unchanged.

---

## Architecture Decisions

### Naming: `AxisPosition` / `AxisSpread`, no "Main" prefix

The earlier draft of this plan named the shared types `MainAxisPosition`/`MainAxisSpread`. That prefix is now inaccurate: the position vocabulary is reused for **tab-label justification within a cell** (`textAlign` on `Tab`/`TabBar`), which is a *within-cell* concern, not a layout's main axis. Dropping "Main" keeps the names honest about every site that draws from them. The two halves read as the two distinct concepts: `AxisPosition` *positions a block along an axis* (start/center/end), `AxisSpread` *distributes slack into the gaps* (start/between/around).

### One file `AxisAlign.ts` (not two)

The layout package houses single-purpose vocabulary types as standalone files: [FillType.ts](../src/typescript/lib/layout/FillType.ts) and [AnchorType.ts](../src/typescript/lib/layout/AnchorType.ts) each hold one exported type plus the SPDX header `// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0` and a `@category Layouts` JSDoc block. The convention is one *concept* per file, and `AxisPosition`/`AxisSpread` form one cohesive concept pair (the two complementary halves of axis slack handling — position vs. spread, sharing `"start"` as the do-nothing identity). They are imported together by every consumer, so they belong in one neutral shared file `src/typescript/lib/layout/AxisAlign.ts` (SPDX header + a `@category Layouts` JSDoc on each type). Two files (`AxisPosition.ts`/`AxisSpread.ts`) would also satisfy the standalone-type convention and are an acceptable fallback if the one-type-per-file rule turns out to be strict during implementation — but the default is the single `AxisAlign.ts`, because the pair is the unit of reuse and the filename names the shared concept. The import site reads `import type { AxisPosition, AxisSpread } from "~/layout/AxisAlign.js";`.

### Keep `BoxJustify` — a single-line box fuses position + spread

`justifyOffsets` at [BoxLayout.ts:408](../src/typescript/lib/layout/BoxLayout.ts#L408) partitions the five `BoxJustify` values cleanly into the two roles: `"start"`/`"center"`/`"end"` produce a leading offset (`lead`, `gap: 0`) — exactly `AxisPosition` — and `"between"`/`"around"` produce inter-child spread (`gap`) — the non-`start` half of `AxisSpread`. A single line has exactly one main-axis slack decision, so position and spread are *mutually exclusive* and fuse into one field. The union `AxisPosition | AxisSpread` is therefore a genuine "thing" worth naming, and it stays defined in `BoxLayout.ts` as `export type BoxJustify = AxisPosition | AxisSpread;`. `"start"` is shared by both halves (the identity for each), so the union collapses to the same five distinct values with no duplication. The JSDoc keeps explaining the fusion, now referencing `AxisPosition`/`AxisSpread`.

### Keep `TabAlign` — `Exclude<AxisPosition, "center">`, not a fourth literal

`TabAlign` ([Tab.ts:96](../src/typescript/lib/layout/Tab.ts#L96)) positions the whole tab-button group on the strip and is a *binary* `"start" | "end"` — the strict no-`center` subset of `AxisPosition`. It stays defined in `Tab.ts` as `export type TabAlign = Exclude<AxisPosition, "center">`, which resolves to exactly `"start" | "end"`. Deriving it from the shared type (rather than inlining `Exclude<AxisPosition, "center">` at every site, which would be unreadable, or leaving a bare literal, which would lose the cross-link) makes the "subset of position" relationship explicit while the compiler still rejects `"center"` everywhere `TabAlign` is used.

**Why `Exclude`, not adding `"center"`.** Adding `"center"` would be a *behavior* change, not a type refactor. The `TabBar` implementation is hard-branched on the binary distinction `this._align === "end"` at [TabBar.ts:2224](../src/typescript/lib/component/container/TabBar.ts#L2224), [:2305](../src/typescript/lib/component/container/TabBar.ts#L2305), and [:2552](../src/typescript/lib/component/container/TabBar.ts#L2552) — anything not `"end"` is treated as `"start"`. A `"center"` value would silently fall into the start branch with no centring logic. Widening the type would therefore be a no-op lie or demand new runtime code; both are out of scope for a type-only refactor. Adding genuine centre alignment is a separate behavioral feature (see Non-Goals).

### Drop `FlowAlign` / `FlowJustify` / `TabTextAlign` — the field name already carries the role

These three aliases were one-to-one renames of the shared vocabulary with no added meaning:

- `FlowAlign` was exactly `AxisPosition`; the field is `FlowLayout.align`. → retype `align?`/`_align`/`setAlign`/`getAlign` to `AxisPosition` directly.
- `FlowJustify` was exactly `AxisSpread`; the field is `FlowLayout.justify`. → retype `justify?`/`_justify`/`setJustify`/`getJustify` to `AxisSpread` directly.
- `TabTextAlign` was exactly `AxisPosition`; the field is `Tab.textAlign` (and `TabBar.textAlign`). → retype `textAlign?`/`_textAlign`/`setTextAlign`/`getTextAlign` to `AxisPosition` directly.

The `align`/`justify`/`textAlign` option name already states the role, so the per-layout alias was redundant indirection. With the shared type in place it earns nothing, so it is hard-deleted. `FlowLayout.itemAlign` is a **different** concept (`FlowItemAlign`, a cross-axis type that includes `baseline`) and is **left untouched** — only the main-axis `align` becomes `AxisPosition`.

### Hard-delete, not deprecate

The library is prerelease and every consumer of the three dropped names lives in this repo (enumerated below). There is no external API-stability obligation, so the names are removed outright — no `@deprecated` type aliases, no re-export shims in the barrel. Every in-repo usage is rewritten in the same change.

### No value, behavior, or backing-field changes

The refactor changes only *declared* types. `BoxJustify`'s value set, the `_justify`/`_align`/`_textAlign` backing fields (now typed by the shared union/`AxisPosition`), every setter/getter signature's *runtime* behavior, the options-bag fields, and the runtime branches in `justifyOffsets`/`alignLead`/the `TabBar` `_align === "end"` checks all stay as written. CODE_CONVENTIONS.md is respected — the new file carries SPDX + JSDoc per the existing standalone-type files; no new setters/fields/`declare` rules are introduced.

---

## Public API (TypeScript Signatures)

New file `src/typescript/lib/layout/AxisAlign.ts`:

```ts
export type AxisPosition = "start" | "center" | "end";
export type AxisSpread   = "start" | "between" | "around";
```

Kept aliases (definitions stay in their current files, retargeted at the shared types):

```ts
// BoxLayout.ts — was: "start" | "center" | "end" | "between" | "around"
export type BoxJustify = AxisPosition | AxisSpread;

// Tab.ts — was: "start" | "end"
export type TabAlign = Exclude<AxisPosition, "center">;
```

Retyped option-bag fields and setter/getter signatures for the three dropped names (values unchanged):

```ts
// FlowLayout.ts — FlowAlign deleted
interface FlowLayoutOptions { align?: AxisPosition; /* … */ }
protected _align: AxisPosition = "start";
getAlign(): AxisPosition;
setAlign(align: AxisPosition): this;

// FlowLayout.ts — FlowJustify deleted
interface FlowLayoutOptions { justify?: AxisSpread; /* … */ }
protected _justify: AxisSpread = "start";
getJustify(): AxisSpread;
setJustify(justify: AxisSpread): this;

// Tab.ts — TabTextAlign deleted
interface TabOptions { textAlign?: AxisPosition; /* … */ }
setTextAlign(align: AxisPosition): this;
getTextAlign(): AxisPosition;

// TabBar.ts — TabTextAlign deleted (consumer)
textAlign?: AxisPosition;          // TabBarOptions
private _textAlign: AxisPosition = "center";
setTextAlign(align: AxisPosition): this;
getTextAlign(): AxisPosition;
```

`BoxLayout.ts`, `FlowLayout.ts`, `Tab.ts`, and `TabBar.ts` each gain `import type { … } from "~/layout/AxisAlign.js";` for the names they reference (`BoxLayout.ts` needs both; `FlowLayout.ts` needs both; `Tab.ts` and `TabBar.ts` need only `AxisPosition`). The barrel re-exports `AxisPosition`/`AxisSpread` and removes `FlowAlign`/`FlowJustify`/`TabTextAlign`; `BoxJustify` and `TabAlign` stay.

---

## Ordered Implementation Steps

1. **Create `src/typescript/lib/layout/AxisAlign.ts`.** SPDX header line, then the two exported types, each with a `@category Layouts` JSDoc block. `AxisPosition` documents the three position values (start = leading edge / do-nothing identity, center = block centred, end = trailing edge) and frames them as "positions a content block along an axis (the align concept)". `AxisSpread` documents start (no spread / identity), between, and around, and frames them as "distributes leftover slack into the inter-item gaps (the justify/distribute concept)". Note in each JSDoc that `"start"` is the shared identity value, so their union is the five-value `BoxJustify` set.

2. **Keep `BoxJustify` in `BoxLayout.ts`, retarget at the shared types.** Add `import type { AxisPosition, AxisSpread } from "~/layout/AxisAlign.js";` near the existing imports. Replace the union literal at [line 62](../src/typescript/lib/layout/BoxLayout.ts#L62) with `export type BoxJustify = AxisPosition | AxisSpread;`. Update the surrounding JSDoc (lines 41–62) to reference the two shared types and keep explaining *why a box fuses them* — one line has exactly one slack decision, so position and spread collapse into one field; cite that `justifyOffsets` partitions start/center/end → `lead` (position) and between/around → `gap` (spread). Keep the per-value descriptions. The `justify?`/`_justify`/`getJustify`/`setJustify` members stay typed `BoxJustify`.

3. **Drop `FlowAlign`/`FlowJustify` in `FlowLayout.ts`, retype `align`/`justify`.** Add `import type { AxisPosition, AxisSpread } from "~/layout/AxisAlign.js";`. **Delete** the `export type FlowAlign = …;` ([line 40](../src/typescript/lib/layout/FlowLayout.ts#L40)) and `export type FlowJustify = …;` ([line 81](../src/typescript/lib/layout/FlowLayout.ts#L81)) declarations outright. Retype every member that referenced them: `FlowLayoutOptions.align?` ([:92](../src/typescript/lib/layout/FlowLayout.ts#L92)) → `AxisPosition`; `_align` ([:120](../src/typescript/lib/layout/FlowLayout.ts#L120)) → `AxisPosition`; `getAlign()` ([:248](../src/typescript/lib/layout/FlowLayout.ts#L248)) → `AxisPosition`; `setAlign(align: …)` ([:262](../src/typescript/lib/layout/FlowLayout.ts#L262)) → `AxisPosition`; `FlowLayoutOptions.justify?` ([:94](../src/typescript/lib/layout/FlowLayout.ts#L94)) → `AxisSpread`; `_justify` ([:122](../src/typescript/lib/layout/FlowLayout.ts#L122)) → `AxisSpread`; `getJustify()` ([:300](../src/typescript/lib/layout/FlowLayout.ts#L300)) → `AxisSpread`; `setJustify(justify: …)` ([:320](../src/typescript/lib/layout/FlowLayout.ts#L320)) → `AxisSpread`. Rewrite the JSDoc `{@link FlowAlign}` references (lines 68, 258, 316) and `{@link FlowJustify}` references (lines 311, 474) to `{@link AxisPosition}` / `{@link AxisSpread}`, framing them as the shared vocabulary. **Do not** touch `FlowItemAlign` or the `itemAlign` field — it is a cross-axis type with `baseline` and is out of scope.

4. **Drop `TabTextAlign` in `Tab.ts`, keep `TabAlign` (now `Exclude`), retype `textAlign`.** Add `import type { AxisPosition } from "~/layout/AxisAlign.js";` near the existing imports. Replace `export type TabAlign = "start" | "end";` ([line 96](../src/typescript/lib/layout/Tab.ts#L96)) with `export type TabAlign = Exclude<AxisPosition, "center">;`, keeping the existing `"start"`/`"end"` per-value JSDoc (lines 83–95) and noting it is the no-centre subset of `AxisPosition`. **Delete** `export type TabTextAlign = "start" | "center" | "end";` ([line 125](../src/typescript/lib/layout/Tab.ts#L125)) outright and retype its members to `AxisPosition`: `TabOptions.textAlign?` ([:207](../src/typescript/lib/layout/Tab.ts#L207)); `setTextAlign(align: …)` ([:596](../src/typescript/lib/layout/Tab.ts#L596)); `getTextAlign()` ([:609](../src/typescript/lib/layout/Tab.ts#L609)). Rewrite the `{@link TabTextAlign}` JSDoc references (lines 118, 592, 607) to `{@link AxisPosition}`. **Do not** touch `TabOrientation` ([:112](../src/typescript/lib/layout/Tab.ts#L112)) — it is a text-rotation type, not an axis concept.

5. **Retype the `TabBar.ts` `TabTextAlign` consumer.** In [TabBar.ts](../src/typescript/lib/component/container/TabBar.ts): drop `TabTextAlign` from the `import type { … } from "~/layout/Tab.js";` at [:31](../src/typescript/lib/component/container/TabBar.ts#L31) and add `AxisPosition` from `"~/layout/AxisAlign.js"` (keep `TabAlign` imported from `Tab.js`). Retype `TabBarOptions.textAlign?` ([:169](../src/typescript/lib/component/container/TabBar.ts#L169)) → `AxisPosition`; `private _textAlign` ([:490](../src/typescript/lib/component/container/TabBar.ts#L490)) → `AxisPosition` (default stays `"center"`); `setTextAlign(align: …)` ([:997](../src/typescript/lib/component/container/TabBar.ts#L997)) → `AxisPosition`; `getTextAlign()` ([:1010](../src/typescript/lib/component/container/TabBar.ts#L1010)) → `AxisPosition`. Update the `[\`TabTextAlign\`]` JSDoc references (lines 993, 1008) to point at `AxisPosition`. `_align: TabAlign` ([:486](../src/typescript/lib/component/container/TabBar.ts#L486)) and the `_align === "end"` branches stay unchanged.

6. **Update the `TabDemoPanel.ts` consumer.** In [TabDemoPanel.ts:5](../src/typescript/TabDemoPanel.ts#L5), drop `TabTextAlign` from the `@jimka/typescript-ui/layout` import and add `AxisPosition`. Retype the typed array at [:93](../src/typescript/TabDemoPanel.ts#L93): `const alignTextModes: AxisPosition[] = ["start", "center", "end"];`. `TabAlign` stays imported and used at [:83](../src/typescript/TabDemoPanel.ts#L83) (`const alignModes: TabAlign[] = ["start", "end"]`). (The `HFlowPanel.ts`/`VFlowPanel.ts` flow demos pass `justify`/`align` as inline string literals and never import `FlowAlign`/`FlowJustify`, so they need no source change.)

7. **Fix the barrel `index.ts`.** In [index.ts:19](../src/typescript/lib/layout/index.ts#L19), remove `TabTextAlign` from the `~/layout/Tab.js` re-export (keep `TabAlign`). In [:31](../src/typescript/lib/layout/index.ts#L31), remove `FlowAlign` and `FlowJustify` from the `~/layout/FlowLayout.js` re-export (keep `FlowLayoutOptions`, `FlowUniformity`, `FlowItemAlign`). Add a new line near the `BoxLayout`/`FlowLayout` type re-exports: `export type { AxisPosition, AxisSpread } from '~/layout/AxisAlign.js';`. `BoxJustify` ([:25](../src/typescript/lib/layout/index.ts#L25)) and `TabAlign` ([:19](../src/typescript/lib/layout/index.ts#L19)) stay exported.

8. **Typecheck.** Run `tsc` (or `npm run build`) — expect zero errors. Structural equality of `BoxJustify` to its old literal union, of the retyped flow/tab members to their old value sets, and of `Exclude<AxisPosition, "center">` to `"start" | "end"` is the load-bearing check. If `TabAlign` drifted (e.g. included `"center"`), the `TabBar` `_align` default and `TabDemoPanel`'s typed array would fail to compile.

9. **Regression checkpoints.**
   - `grep -rn 'FlowAlign\|FlowJustify\|TabTextAlign' src/typescript --include='*.ts'` — expect **zero** matches (all three names hard-deleted from source).
   - `grep -rn 'AxisPosition\|AxisSpread' src/typescript/lib/layout/index.ts` — expect the new barrel export line.
   - `grep -n 'export type BoxJustify' src/typescript/lib/layout/BoxLayout.ts` — expect `BoxJustify = AxisPosition | AxisSpread`.
   - `grep -nE 'export type TabAlign' src/typescript/lib/layout/Tab.ts` — expect `TabAlign = Exclude<AxisPosition, "center">`.
   - [BoxJustifyPanel.ts:9](../src/typescript/BoxJustifyPanel.ts#L9) (`const JUSTIFY_MODES: BoxJustify[] = ["start", "center", "end", "between", "around"]`) still compiles — proves `BoxJustify` still accepts all five values.
   - [TabDemoPanel.ts:83](../src/typescript/TabDemoPanel.ts#L83) (`TabAlign[] = ["start", "end"]`) and the retyped [:93](../src/typescript/TabDemoPanel.ts#L93) (`AxisPosition[] = ["start", "center", "end"]`) still compile.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/layout/AxisAlign.ts` (`AxisPosition` + `AxisSpread`) |
| Modify | `src/typescript/lib/layout/BoxLayout.ts` (import; `BoxJustify = AxisPosition \| AxisSpread`; JSDoc) |
| Modify | `src/typescript/lib/layout/FlowLayout.ts` (import; **delete** `FlowAlign`/`FlowJustify`; retype `align`→`AxisPosition`, `justify`→`AxisSpread`; JSDoc) |
| Modify | `src/typescript/lib/layout/Tab.ts` (import; `TabAlign = Exclude<AxisPosition, "center">`; **delete** `TabTextAlign`; retype `textAlign`→`AxisPosition`; JSDoc) |
| Modify | `src/typescript/lib/component/container/TabBar.ts` (import swap; retype `_textAlign`/`textAlign`/`setTextAlign`/`getTextAlign`→`AxisPosition`; JSDoc) |
| Modify | `src/typescript/lib/layout/index.ts` (remove `FlowAlign`/`FlowJustify`/`TabTextAlign`; add `AxisPosition`/`AxisSpread`; keep `BoxJustify`/`TabAlign`) |
| Modify | `src/typescript/TabDemoPanel.ts` (import swap; retype `alignTextModes`→`AxisPosition[]`) |

---

## Verification

- **Typecheck is the primary gate.** `tsc` clean. Because the change is type-only, a clean compile proves `BoxJustify` resolves to the identical five-value set (`AxisPosition | AxisSpread`), the retyped flow `align`/`justify` to their three values each, `Tab`/`TabBar` `textAlign` to its three values, and `TabAlign` to exactly `"start" | "end"`. Any union drift makes a demo panel's typed array or a `_justify`/`_align`/`_textAlign` assignment fail.
- **Dropped names are gone from source.** `grep -rn 'FlowAlign\|FlowJustify\|TabTextAlign' src/typescript --include='*.ts'` returns **zero** matches — the hard-delete invariant.
- **`TabBar.ts` compiles against the redefined `Tab.ts`.** `_align: TabAlign = "start"` and the three `_align === "end"` branches remain valid, confirming `Exclude<AxisPosition, "center">` is structurally `"start" | "end"`.
- **Demo panels still compile.** [BoxJustifyPanel.ts](../src/typescript/BoxJustifyPanel.ts) asserts the full five-value `BoxJustify[]`; [TabDemoPanel.ts](../src/typescript/TabDemoPanel.ts) asserts `TabAlign[] = ["start", "end"]` and the retyped `AxisPosition[] = ["start", "center", "end"]`. The flow demos ([HFlowPanel.ts](../src/typescript/HFlowPanel.ts)/[VFlowPanel.ts](../src/typescript/VFlowPanel.ts)) use inline string literals and assert the retyped `align`/`justify` accept them.
- **`npm run docs:build` clean** — 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is the only acceptable warning). Confirms the new `AxisPosition`/`AxisSpread` pages generate, the removed `FlowAlign`/`FlowJustify`/`TabTextAlign` pages leave no dangling links, and the curated catalog links resolve.
- **Runtime smoke (optional):** the app's "Justify" tab ([main.ts:48](../src/typescript/main.ts#L48)) and the Tab/Flow demo screens render unchanged — no runtime branch was touched.

---

## Documentation Impact

The change adds two public symbols, removes three, and retargets two kept ones, so the doc pipeline must move with it. The `document` skill runs after implementation to finalise these — but the moving parts are:

- **Barrel export:** `src/typescript/lib/layout/index.ts` now re-exports `AxisPosition`/`AxisSpread` and no longer re-exports `FlowAlign`/`FlowJustify`/`TabTextAlign`. TypeDoc regeneration produces `/api/layout/type-aliases/AxisPosition` and `/api/layout/type-aliases/AxisSpread` and drops the three old type-alias pages.
- **Remove the three dropped type-alias pages and catalog entries.** Delete the generated pages [docs/api/layout/type-aliases/FlowAlign.md](../docs/api/layout/type-aliases/FlowAlign.md), [FlowJustify.md](../docs/api/layout/type-aliases/FlowJustify.md), and [TabTextAlign.md](../docs/api/layout/type-aliases/TabTextAlign.md), and remove their entries from the generated API catalog [docs/api/layout/index.md](../docs/api/layout/index.md) (`- [FlowAlign]` at line 59, `- [FlowJustify]` at line 61, `- [TabTextAlign]` at line 72). These are TypeDoc-generated, so the regeneration step handles them; verify no page still links the removed names. The API sidebar is auto-built from `docs/api/typedoc-sidebar.json` (regenerated by typedoc), so there are no hand-maintained sidebar entries to edit in [docs/.vitepress/config.mts](../docs/.vitepress/config.mts).
- **Add the two new type-alias pages.** `AxisPosition`/`AxisSpread` get TypeDoc-generated pages and catalog entries on regeneration.
- **Retarget curated link references in `docs/layouts/`.** The curated prose links the dropped names and must be repointed to the shared types: [docs/layouts/HFlow.md:76](../docs/layouts/HFlow.md#L76)/[:122](../docs/layouts/HFlow.md#L122)/[:184](../docs/layouts/HFlow.md#L184) and [docs/layouts/VFlow.md:71](../docs/layouts/VFlow.md#L71)/[:104](../docs/layouts/VFlow.md#L104)/[:158](../docs/layouts/VFlow.md#L158)/[:161](../docs/layouts/VFlow.md#L161) reference `FlowAlign`/`FlowJustify` → point at `AxisPosition`/`AxisSpread`; the [docs/layouts/index.md:20–21](../docs/layouts/index.md#L20) catalog rows link `[\`justify\`](…/FlowJustify)` → `AxisSpread`; [docs/layouts/Tab.md:126](../docs/layouts/Tab.md#L126) references `TabTextAlign` → `AxisPosition`.
- **`BoxJustify`/`TabAlign` pages stay, now referencing the shared types.** Their regenerated JSDoc cross-links `AxisPosition`/`AxisSpread`; the curated [docs/layouts/Tab.md](../docs/layouts/Tab.md) and the box/flow layout pages keep referencing `BoxJustify`/`TabAlign` by their preserved names.
- **Surface the new vocabulary in the catalog.** Extend the "constraint enums" line at [docs/layouts/index.md:75](../docs/layouts/index.md#L75) (the `AnchorType`/`FillType`/`Placement` "See also" bullet) with `AxisPosition`/`AxisSpread`, framed as the shared axis position/spread vocabulary that `BoxJustify` and the flow/tab `align`/`justify`/`textAlign` fields draw from.
- **Cross-bucket JSDoc:** `AxisPosition`/`AxisSpread` and all consumers in the `layout` bucket resolve `{@link …}` in-bucket. `TabBar.ts` lives in the `component/container` bucket and references `AxisPosition` (layout bucket) — its JSDoc must use a markdown link, not `{@link}`, per `_shared/docs-conventions.md` (it already uses the markdown-link form for `TabTextAlign`, so swap the target).

---

## Critical Files

- [src/typescript/lib/layout/FillType.ts](../src/typescript/lib/layout/FillType.ts), [AnchorType.ts](../src/typescript/lib/layout/AnchorType.ts) — the standalone-type-file convention to mirror (SPDX header + single `@category Layouts` JSDoc).
- [src/typescript/lib/layout/BoxLayout.ts](../src/typescript/lib/layout/BoxLayout.ts) — `BoxJustify` (line 62) and `justifyOffsets` (line 408, the lead/gap partition proof).
- [src/typescript/lib/layout/FlowLayout.ts](../src/typescript/lib/layout/FlowLayout.ts) — `FlowAlign` (40), `FlowJustify` (81), the `align`/`justify` members (92/94, 120/122, 248, 262, 300, 320), and `FlowItemAlign` (the out-of-scope cross-axis type to leave alone).
- [src/typescript/lib/layout/Tab.ts](../src/typescript/lib/layout/Tab.ts) — `TabAlign` (96, JSDoc 83–95), `TabTextAlign` (125), the `textAlign` members (207, 596, 609), and `TabOrientation` (112, out-of-scope rotation type).
- [src/typescript/lib/component/container/TabBar.ts](../src/typescript/lib/component/container/TabBar.ts) — the `TabTextAlign` consumer (import 31, `_textAlign` 490, `textAlign?` 169, setter/getter 997/1010) plus `_align: TabAlign` (486) and the binary `_align === "end"` branches (2224/2305/2552, unchanged).
- [src/typescript/lib/layout/index.ts](../src/typescript/lib/layout/index.ts) — the layout barrel (`TabAlign`/`TabTextAlign` re-export line 19; `BoxJustify` line 25; `FlowAlign`/`FlowJustify` line 31).
- [src/typescript/BoxJustifyPanel.ts](../src/typescript/BoxJustifyPanel.ts) — the `BoxJustify` compile-time value-set assertion.
- [src/typescript/TabDemoPanel.ts](../src/typescript/TabDemoPanel.ts) — the `TabAlign`/`TabTextAlign` consumer (import 5, typed arrays 83/93) needing the `TabTextAlign`→`AxisPosition` swap.
- [docs/layouts/index.md](../docs/layouts/index.md) — catalog rows (20–21) and "See also" line (75).

---

## Non-Goals

- **No `"center"` added to `TabAlign`.** It stays binary (`Exclude<AxisPosition, "center">` = `"start" | "end"`). Centre alignment would require new `TabBar` layout branches (only `_align === "end"` vs. everything-else exists) and is a behavioral feature out of scope for this type-only refactor.
- **`TabOrientation` is out of scope.** It is a text-rotation type (`"horizontal" | "vertical-cw" | "vertical-ccw"`, CSS `writing-mode`), not an axis position/spread concept, so it does not draw from `AxisAlign.ts`.
- **`FlowItemAlign` is untouched.** The flow cross-axis `itemAlign` type includes `baseline` and is a different concept from main-axis `align`; only `align` becomes `AxisPosition`.
- **No `@deprecated` shims or re-export aliases.** Prerelease + all-in-repo consumers means the three dropped names are hard-deleted, not soft-deprecated.
- **No value, field, or setter consolidation.** `BoxLayout` keeps its single `_justify` field, `FlowLayout` keeps separate `_align`/`_justify`, and `TabBar` keeps `_align`/`_textAlign` — the extraction does not merge or split runtime state.
- **No Border / Accordion / Split / Card changes.** Their alignment-option consistency is owned by the separate `layout-options-consistency.md` plan.
