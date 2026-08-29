---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/ClassStyleRules.ts
  - packages/lib/src/typescript/lib/core/OverlayPosition.ts
  - packages/lib/src/typescript/lib/core/ScrollShadow.ts
  - packages/lib/src/typescript/lib/data/AbstractStore.ts
  - packages/lib/src/typescript/lib/component/chart/ChartAxis.ts
  - packages/lib/src/typescript/lib/component/input/Slider.ts
  - packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts
  - packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts
  - packages/lib/src/typescript/lib/component/tree/TreeRow.ts
  - packages/lib/src/typescript/lib/router/Router.ts
  - packages/lib/src/typescript/lib/router/RoutePattern.ts
  - packages/lib/package.json
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
---

# Dead Code & Orphaned Export Cleanup, Round 2 — Implementation Plan

## Overview

A second sweep of the same kind as [dead-code-and-orphaned-export-cleanup](plans/implemented/dead-code-and-orphaned-export-cleanup.md), over code added since that plan ran on 2026-07-05, plus a handful of older dead members that sweep never claimed. Every removal below was checked by grepping `packages/` for the symbol; the counts quoted are what the current tree returns.

Five groups, in the order the steps run:

1. **Orphaned exports** — nine symbols carrying an `export` that reaches no importer. The `export` keyword goes; the declaration stays, because each is still used inside its own file.
2. **The `AxisOrientation` collision** — the repo has two exported types called `AxisOrientation` with incompatible unions, plus a third name for a union identical to the first. This group is a rename and a consolidation, not a removal.
3. **A dead npm script** — `"doc"` in [packages/lib/package.json:139](packages/lib/package.json#L139).
4. **Pre-window dead code** — zero-caller members on `Component`, `AbstractStore`, and `SelectableListRow`; three export blocks that publish names nothing imports; two duplicated `TOGGLE_WIDTH` constants; and `Slider`'s `@deprecated` min/max alias family. All predate the round-1 sweep's window.
5. **Router follow-ups** — five small fixes in `router/`, found while checking group 1's `RoutePattern.ts` entries.

Nothing here changes rendered output. Two removals do narrow the published API: `AbstractStore.getActiveSorter()` and `Slider`'s `@deprecated` min/max alias family (four accessors plus two option fields). Both get a changelog and a migration note.

---

## Architecture Decisions

### Orphaned exports lose the keyword, not the declaration

For a symbol used only inside its own file, whose owner is not re-exported by any barrel, the `export` is inert — drop it and leave the declaration alone.[^round-one] Where such a symbol sits in a trailing `export { … }` list, remove its entry from that list.

Two of the leaked symbols are concrete `Component` subclasses exported without `callable()` wrapping, which [ARCHITECTURE.md](ARCHITECTURE.md)'s *Components are exported through `callable()`* rule forbids. De-exporting them resolves that too: the rule binds exported components, and these stop being exported.[^callable-fix]

### One name per meaning — `primitive/` owns the axis vocabulary

`primitive/Axis.ts`'s `AxisOrientation` is the repo's single orientation vocabulary, established by [primitive-axis-vocabulary](plans/implemented/primitive-axis-vocabulary.md) on 2026-06-22, which dropped seven bespoke orientation aliases in its favour. Two later plans re-introduced axis names without justifying the new pattern in their own `## Architecture Decisions`, which the shared pattern-conformance standard treats as a defect rather than a divergence.[^axis-precedent] This plan folds both back:

| Declaration | Union | What it means | After |
|---|---|---|---|
| [primitive/Axis.ts:13](packages/lib/src/typescript/lib/primitive/Axis.ts#L13) `AxisOrientation` | `"horizontal" \| "vertical"` | which way an axis runs | unchanged — the one owner, used by 7 modules |
| [core/OverlayPosition.ts:12](packages/lib/src/typescript/lib/core/OverlayPosition.ts#L12) `AnchorAxis` | `"vertical" \| "horizontal"` | an overlay's growth axis — the same meaning | deleted; `AnchorOptions.axis` types as `AxisOrientation` |
| [component/chart/ChartAxis.ts:14](packages/lib/src/typescript/lib/component/chart/ChartAxis.ts#L14) `AxisOrientation` | `"bottom" \| "left"` | which plot edge an axis is drawn on — a different meaning | renamed `ChartAxisEdge`, defined from `primitive/Edge.ts` |

### The chart's edge type derives from `primitive/Edge.ts`

`ChartAxisEdge` is `Extract<Edge, "bottom" | "left">`, mirroring [primitive/Axis.ts:44](packages/lib/src/typescript/lib/primitive/Axis.ts#L44)'s `AxisEnd = Exclude<AxisPosition, "center">` — the repo's existing way of narrowing a primitive vocabulary type.[^chart-edge-shape] It carries no `export`, since nothing outside `ChartAxis.ts` names it.

### A `@deprecated` member with no reference and a live replacement is removed

The rule this plan applies: remove a `@deprecated` symbol when it has **zero references anywhere in `packages/` outside its own deprecation test** and its replacement is live. It reaches two of the nine `@deprecated` symbol families the repo carries — `AbstractStore.getActiveSorter()` and `Slider`'s min/max aliases — and no others, because every remaining family still has a caller or is an advertised type alias.[^deprecation-rule] `Slider`'s own JSDoc already authorises its removal in as many words.[^slider-authorised]

Round 1 declined to retire test-pinned symbols. That carve-out was about guards with no deprecation marker and no replacement, where deleting the code meant deleting the only statement of intent; it does not cover an alias whose replacement is documented and whose JSDoc names the follow-up cleanup.

### `parseQuery` keeps every key, including `__proto__`

[RoutePattern.ts:115](packages/lib/src/typescript/lib/router/RoutePattern.ts#L115) writes each pair with `result[key] = …`, which silently discards a pair whose key is `__proto__`.[^proto-drop] The write becomes an `Object.defineProperty` call, so every key survives:

| Input | Today | After |
|---|---|---|
| `a=1&b=2` | `{ a: "1", b: "2" }` | unchanged |
| `=5` | `{}` — empty key skipped, as documented | unchanged |
| `__proto__=x` | `{}` — the pair vanishes, undocumented | `{ __proto__: "x" }` as an own key |

### Hash-mode `navigate` lets `getHref` do the parsing

[Router.ts:198-200](packages/lib/src/typescript/lib/router/Router.ts#L198) splits `path` into fragment, query, and path, then hands the original `path` to `getHref`, which splits it again at [Router.ts:254-256](packages/lib/src/typescript/lib/router/Router.ts#L254). In hash mode the first split is redundant: passing `options?.query` straight through produces exactly the value `getHref` would derive on its own.[^navigate-equivalence] The split moves below the hash branch, where History mode still needs it.

### Router's construction listener bag dispatches through `on()`

[Router.ts:446](packages/lib/src/typescript/lib/router/Router.ts#L446) writes into the `ListenerBag` directly. Every other class in the repo reserves `_listeners.add` for the body of its own `on()` forwarder and routes a construction-time bag through `on()` — [AbstractStore.ts:258](packages/lib/src/typescript/lib/data/AbstractStore.ts#L258) is the class `Router`'s own doc comment says it follows, and [ARCHITECTURE.md](ARCHITECTURE.md) states the rule for `Component.applyListeners`. `Router` is the outlier; it dispatches its two events explicitly rather than through a loop.[^listener-dispatch]

---

## Public API

Two removals from barrel-exported classes. Nothing is added.

```typescript
// packages/lib/src/typescript/lib/data/AbstractStore.ts — REMOVED
getActiveSorter(): { property: string; direction: 'asc' | 'desc' } | null;
// Replacement, unchanged:
getActiveSorters(): SortDescriptor[];
```

```typescript
// packages/lib/src/typescript/lib/component/input/Slider.ts — REMOVED
setMinValue(value: number): this;
getMinValue(): number;
setMaxValue(value: number): this;
getMaxValue(): number;

interface SliderOptions {
    minValue?: number;   // REMOVED
    maxValue?: number;   // REMOVED
}
// Replacements, unchanged: setMin / getMin / setMax / getMax, and the
// `min` / `max` option fields.
```

Everything else this plan touches is internal: none of it is re-exported from a per-group `index.ts`, which is what [Migration](packages/lib/docs/reference/migration/index.md) defines as the public surface.[^public-surface]

---

## Ordered Implementation Steps

### Group 1 — orphaned exports

1. **[core/ScrollShadow.ts](packages/lib/src/typescript/lib/core/ScrollShadow.ts)** — drop `export` from `SCROLL_SHADOW_EXTENT_PX` (line 25) and `SCROLL_SHADOW_RAMP_PX` (line 35). Both stay live in-file (lines 47 and 62).

2. **[router/RoutePattern.ts](packages/lib/src/typescript/lib/router/RoutePattern.ts)** — drop `export` from `SegmentKind` (line 9) and `RouteSegment` (line 12). Both stay live in-file. Leave every other `export` in this module alone; `CompiledPattern` and the functions are imported by `Router.ts` and the test.

3. **[core/ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts)** — drop `export` from `ResolvedStyleBag` (line 124) and `ResolvedStyleState` (line 648). Both appear in the signatures of exported functions (`ensureClassStateRule`, `resolveStyleStates`); that is fine, because `tsc` emits a non-exported declaration for each into the `.d.ts` alongside the function that names it.[^dts-emit] This restores the stated intent of the comment at [core/index.ts:19-24](packages/lib/src/typescript/lib/core/index.ts#L19), which says only `StyleTrait` / `StyleBag` / `TextStyleBag` leave this module.

4. **[core/OverlayPosition.ts](packages/lib/src/typescript/lib/core/OverlayPosition.ts)** — drop `export` from `AnchorOptions` (line 20) and `FlexiblePlacement` (line 140). Leave `AnchoredFlexiblePlacement` (line 197) exported — [overlay/PopupPanel.ts:6](packages/lib/src/typescript/lib/overlay/PopupPanel.ts#L6) imports it. `AnchorAxis` (line 12) is handled in group 2, not here.
   - Verify: `grep -rn "AnchorOptions" packages/lib/src --include=*.ts` — the only remaining exported `AnchorOptions` is `layout/Anchor.ts`'s, which is a different type and *is* barrel-exported. The two no longer collide.

5. **[component/list/AbstractSelectableList.ts:2062](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2062)** — change `export { AbstractSelectableList, SelectableListRow };` to `export { AbstractSelectableList };`. The class stays declared and used in-file (lines 689, 741, 1582); its own JSDoc at lines 280-281 already calls it internal.
   - Verify: `grep -rn "\bSelectableListRow\b" packages/ --include=*.ts | grep import` — expect zero matches.

### Group 2 — the `AxisOrientation` consolidation

6. **[component/chart/ChartAxis.ts:14](packages/lib/src/typescript/lib/component/chart/ChartAxis.ts#L14)** — replace

   ```typescript
   export type AxisOrientation = "bottom" | "left";
   ```

   with

   ```typescript
   type ChartAxisEdge = Extract<Edge, "bottom" | "left">;
   ```

   Add `import type { Edge } from "~/primitive/Edge.js";` beside the existing imports. Keep the existing JSDoc text ("Which edge an axis is drawn on…") and drop its `@category Components` tag, since the type is no longer exported. Retype the two uses: `measureAxisMargin`'s `orientation` parameter (line 66) and `drawAxis`'s (line 105).
   - Verify: `grep -rn "AxisOrientation" packages/lib/src/typescript/lib/component/chart/` — expect zero matches.
   - Verify: `grep -rn "export type AxisOrientation" packages/lib/src --include=*.ts` — expect exactly one match, `primitive/Axis.ts:13`.

7. **[core/OverlayPosition.ts:12](packages/lib/src/typescript/lib/core/OverlayPosition.ts#L12)** — delete the `AnchorAxis` declaration and its JSDoc block. Add `import type { AxisOrientation } from "~/primitive/Axis.js";` beside the existing `~/primitive/Size.js` import, and retype `AnchorOptions.axis` (line 22) to `AxisOrientation`. The union is the same two members, so no call site changes.
   - Verify: `grep -rn "AnchorAxis" packages/` — expect zero matches.

### Group 3 — the dead script

8. **[packages/lib/package.json:139](packages/lib/package.json#L139)** — delete the `"doc": "typedoc --out dist/docs src/typescript"` line. Nothing in either `package.json`, any workflow, or any script invokes it; the live script is `"docs:api"` on the next line, which runs TypeDoc against [typedoc.json](packages/lib/typedoc.json)'s 19 explicit `entryPoints`. The dead script would have overridden all 19 with a bare directory.
   - Verify: `grep -rn "run doc\b" packages/ .github/` — expect zero matches (the only mentions anywhere are prose in two archived plans under `plans/implemented/`, which stay as they are).

### Group 4 — pre-window dead code

9. **[core/Component.ts:1166](packages/lib/src/typescript/lib/core/Component.ts#L1166)** — delete `getCSSRule()` together with its JSDoc block, **and** the now-orphaned `private ensureCSSRule()` at line 1181 with its JSDoc block. `getCSSRule` is `ensureCSSRule`'s only caller; rule materialisation runs through `materialiseWhenNeeded` ([Component.ts:6185](packages/lib/src/typescript/lib/core/Component.ts#L6185)) instead, so both are dead.[^ensure-css-orphan] Then fix the two comments left dangling:
   - line 686, `// … See \`ensureCSSRule\`.` → `// … See \`materialiseWhenNeeded\`.`
   - line 1843, `{@link ensureCSSRule} call (typically driven by \`render()\`)` → `` `materialiseWhenNeeded` call (typically driven by `render()`) `` — plain code text, not a `{@link}`, per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s rule against linking excluded symbols.
   - Do **not** touch the `Position` import: `getPosition` / `setPosition` still use it.
   - Verify: `grep -rn "getCSSRule\|ensureCSSRule" packages/` — expect zero matches.

10. **[core/Component.ts:4295](packages/lib/src/typescript/lib/core/Component.ts#L4295)** — delete `clearPosition()` with its JSDoc block. Zero callers. Leave `getPosition` (line 4256, pinned by [tests/component/container/Legend.classStyleDefaults.test.ts:88](packages/lib/tests/component/container/Legend.classStyleDefaults.test.ts#L88)) and `setPosition` (line 4281) alone.
    - Verify: `grep -rn "clearPosition" packages/` — expect zero matches.

11. **[data/AbstractStore.ts:1471](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1471)** — delete `getActiveSorter()` with its JSDoc block (lines 1464-1475). `getActiveSorters()` at line 1451 is the live plural form and has seven callers.
    - Verify: `grep -rn "getActiveSorter\b" packages/` — expect zero matches (the plural form has a trailing `s`, so `\b` excludes it).

12. **[component/list/AbstractSelectableList.ts:458](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L458)** — delete `SelectableListRow.getIndex()` with its JSDoc block. Zero references repo-wide. Leave `setIndex` (line 447) and the `_index` field alone — `setIndex` is called on pool reconcile.
    - Verify: `grep -rn "\bgetIndex\b" packages/` — expect zero matches. The word boundaries matter: a bare `getIndex` also matches `targetIndex` and `gutterIndex` elsewhere in the tree.

13. **[component/input/AbstractCalendarDropdown.ts:1613](packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L1613)** — reduce the 17-name export block to the two names that have importers:

    ```typescript
    export {
        AbstractCalendarDropdown,
        ROOT_GAP,
    };
    ```

    The other fifteen — `PickerDay`, `PickerBlankCell`, `PickerNavButton`, `PickerMonthLabel`, `PickerDayHeader`, `dayStart`, `dayEnd`, `MONTH_HEIGHT`, `NAV_BTN_WIDTH`, `HEADER_HEIGHT`, `CELL_HEIGHT`, `DAY_GRID_HEIGHT`, `navGlyphPx`, `DAY_GRID_INDEX`, `DEFAULT_YEAR_SPAN_BACK`, `DEFAULT_YEAR_SPAN_FORWARD`, `YEAR_TYPE_IDLE_MS` — all stay declared and are all used in-file. `AbstractCalendarDropdownOptions` is exported separately at line 455 and is untouched.
    - The only hits for `HEADER_HEIGHT` / `CELL_HEIGHT` outside this file are `PickerColumn.ts`'s own same-named local constants (lines 17 and 20), not imports.
    - Verify: `grep -rn "AbstractCalendarDropdown.js\"" packages/lib/src --include=*.ts` — the two importers must name only `AbstractCalendarDropdown`, `AbstractCalendarDropdownOptions`, and (in `DateTimePickerDropdown.ts`) `ROOT_GAP`.

14. **[component/input/PickerColumn.ts:422](packages/lib/src/typescript/lib/component/input/PickerColumn.ts#L422)** — remove the `HEADER_HEIGHT as PICKER_HEADER_HEIGHT,` line from the export block. Keep `CELL_HEIGHT as PICKER_CELL_HEIGHT` on line 421 — [tests/component/input/TimePickerDropdown.test.ts:14](packages/lib/tests/component/input/TimePickerDropdown.test.ts#L14) imports it. Keep `PickerCell` / `PickerCellList` / `PickerColumn`, all barrel-exported from [component/input/index.ts:33](packages/lib/src/typescript/lib/component/input/index.ts#L33). `PickerColumnHeader` is out of scope for this plan.

15. **[component/input/TimeColumns.ts:190-194](packages/lib/src/typescript/lib/component/input/TimeColumns.ts#L190)** — reduce the export block to `export { TimeColumns };` and delete the `export type { TimeColumnsOptions };` line. `TIME_COLUMNS_HEIGHT` (line 14) and `TimeColumnsOptions` (line 19) both stay declared and stay used in-file (lines 57 and 55).

16. **[component/tree/TreeRow.ts:19](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L19)** and **[component/table/cell/renderer/TreeCell.ts:14](packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts#L14)** — drop `export` from both `TOGGLE_WIDTH` constants; both are used only inside their own file. Do **not** move the value into a shared module. Instead extend each JSDoc to name its twin, matching how the repo already handles the same 22px row height duplicated across three files:[^toggle-width-precedent]
    - `TreeRow.ts`: `/** Width in pixels reserved for the expand/collapse toggle icon. Matches \`TreeCell.ts\`'s \`TOGGLE_WIDTH\`; keep the two in lockstep so a \`Tree\` and a \`TreeTable\` indent identically. */`
    - `TreeCell.ts`: the same sentence, naming `TreeRow.ts`.
    - Leave `DEFAULT_INDENT_PX` (TreeCell.ts line 17) exported — `Row.ts`, `Table.ts`, and a test import it.

17. **[component/input/Slider.ts](packages/lib/src/typescript/lib/component/input/Slider.ts)** — retire the deprecated min/max alias family, in this order:
    - Delete the four alias methods with their JSDoc blocks, lines 320-367 (`setMinValue`, `getMinValue`, `setMaxValue`, `getMaxValue`).
    - Delete the `minValue` / `maxValue` option fields and their `@deprecated` comments, lines 26-29.
    - Delete the constructor's fallback mapping, lines 168-175 (both `if` blocks and the blank line between them). The `if (this._options.min !== undefined)` block at line 176 stays.
    - Delete the two `applyOptions` forwards, lines 223-224.
    - Verify: `grep -rn "minValue\|maxValue" packages/lib/src` — expect zero matches.

18. **[tests/component/input/Slider.test.ts](packages/lib/tests/component/input/Slider.test.ts)** — delete the two tests that exist only to pin the removed aliases: `'maps deprecated minValue/maxValue to min/max only when the canonical key is absent'` (lines 95-104) and `'aliases the deprecated value setters/getters onto the canonical ones'` (lines 106-115). Every other test in the file stays.

### Group 5 — router follow-ups

19. **[router/RoutePattern.ts:115](packages/lib/src/typescript/lib/router/RoutePattern.ts#L115)** — replace the plain assignment with a defining write, and say why:

    ```typescript
    // `Object.defineProperty`, not `result[key] = …`: assigning to the key
    // "__proto__" hits Object.prototype's accessor, which ignores a string
    // value, so the pair would vanish. Defining an own data property keeps
    // every key the query carried.
    Object.defineProperty(result, key, { value: decodeSegment(rawValue), writable: true, enumerable: true, configurable: true });
    ```

20. **[tests/unit/router/RoutePattern.test.ts](packages/lib/tests/unit/router/RoutePattern.test.ts)** — add a `parseQuery` case for `'__proto__=x'` to the `it.each` table at line 59. **The expected value must be built with `Object.fromEntries([['__proto__', 'x']])`** — an object literal written `{ __proto__: 'x' }` sets the prototype instead of an own key and would make the test pass against the unfixed code.

21. **[router/RoutePattern.ts:268](packages/lib/src/typescript/lib/router/RoutePattern.ts#L268)** — keep the `else if (patternSegment.kind === "param")` branch and add one comment above it explaining why it can never be false for a `compilePattern` result: `compilePattern` throws when `"*"` is anywhere but the last segment, and the loop stops before a trailing `catchAll`, so only `"static"` and `"param"` reach here. The check stays because `matchPattern` is exported and takes a `CompiledPattern` a caller could build by hand.[^param-guard]

22. **[router/RoutePattern.ts:157](packages/lib/src/typescript/lib/router/RoutePattern.ts#L157)** — add one sentence to `normalizeBase`'s JSDoc: *"Idempotent: `normalizeBase(normalizeBase(x))` equals `normalizeBase(x)`, which is what lets `stripBase` and `joinBase` normalize an already-normalized base without harm."* No code change — the double normalization `Router.ts` performs is safe, and the sentence records that so the next reader does not re-open it.[^base-idempotent]

23. **[router/Router.ts:197-232](packages/lib/src/typescript/lib/router/Router.ts#L197)** — move the three parsing locals below the hash branch, so hash mode parses once:

    ```typescript
    navigate(path: string, options?: { replace?: boolean; query?: RouteQuery }): this {
        if (this._mode === "hash") {
            // `getHref` derives the query from `path` itself when `options.query`
            // is absent, so this branch needs no parse of its own.
            const hash = this.getHref(path, options?.query);

            if (options?.replace === true) {
                DOM.sink.replaceLocationHash(hash);
            } else {
                DOM.sink.setLocationHash(hash);
            }

            return this;
        }

        const split        = splitFragment(path);
        const withoutQuery = splitQuery(split.path);
        const query        = options?.query ?? parseQuery(withoutQuery.query);
        const target       = normalizePath(withoutQuery.path);
        const fragment     = split.fragment;

        // … unchanged from the existing line 217 onward
    }
    ```

24. **[router/Router.ts:441-449](packages/lib/src/typescript/lib/router/Router.ts#L441)** — replace the loop over `Object.keys(options.listeners)` with an explicit two-event dispatch through `on()`:

    ```typescript
    if (options.listeners !== undefined) {
        const { navigate, nomatch } = options.listeners;

        if (navigate !== undefined) {
            this.on("navigate", navigate);
        }

        if (nomatch !== undefined) {
            this.on("nomatch", nomatch);
        }
    }
    ```

    The `RouterEvent` cast the loop would otherwise need disappears, because each name is a literal that matches one `on` overload.[^listener-dispatch]

### Documentation and verification

25. **[docs/data/store.md:141](packages/lib/docs/data/store.md#L141)** — delete the sentence *"The legacy `getActiveSorter()` accessor still works…"*.

26. **[docs/components/Slider.md:54](packages/lib/docs/components/Slider.md#L54)** — rewrite the bullet to drop the alias sentence, keeping the event guidance: *"Subscribe to committed value changes with `on("change", fn)`, or to the raw per-step drag stream with `on("action", fn)`."*

27. **[docs/reference/changelog/next.md](packages/lib/docs/reference/changelog/next.md)** and **[docs/reference/migration/next.md](packages/lib/docs/reference/migration/next.md)** — add the two public removals to each, following the heading shape of [0.8.0.md](packages/lib/docs/reference/changelog/0.8.0.md) (`## Breaking changes` → `### Core` / `### Components`). Content: `AbstractStore.getActiveSorter()` is removed, use `getActiveSorters()[0]` and read `field` / `dir` instead of `property` / `direction`; `Slider`'s `setMinValue` / `getMinValue` / `setMaxValue` / `getMaxValue` and the `minValue` / `maxValue` options are removed, use `setMin` / `getMin` / `setMax` / `getMax` and the `min` / `max` options.

28. Run the full verification suite below.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/ScrollShadow.ts` (drop 2 `export`) |
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` (drop 2 `export`) |
| Modify | `packages/lib/src/typescript/lib/core/OverlayPosition.ts` (drop 2 `export`; delete `AnchorAxis`; import `AxisOrientation`) |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` (delete `getCSSRule`, `ensureCSSRule`, `clearPosition`; fix 2 comments) |
| Modify | `packages/lib/src/typescript/lib/component/chart/ChartAxis.ts` (rename `AxisOrientation` → `ChartAxisEdge`; import `Edge`) |
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` (drop `SelectableListRow` export; delete `getIndex`) |
| Modify | `packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts` (trim export block to 2 names) |
| Modify | `packages/lib/src/typescript/lib/component/input/PickerColumn.ts` (drop `PICKER_HEADER_HEIGHT` export) |
| Modify | `packages/lib/src/typescript/lib/component/input/TimeColumns.ts` (drop 2 exports) |
| Modify | `packages/lib/src/typescript/lib/component/input/Slider.ts` (delete 4 alias methods, 2 option fields, mapping, forwards) |
| Modify | `packages/lib/src/typescript/lib/component/tree/TreeRow.ts` (drop `export`; extend JSDoc) |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts` (drop `export`; extend JSDoc) |
| Modify | `packages/lib/src/typescript/lib/data/AbstractStore.ts` (delete `getActiveSorter`) |
| Modify | `packages/lib/src/typescript/lib/router/RoutePattern.ts` (drop 2 `export`; `defineProperty` write; 2 comments) |
| Modify | `packages/lib/src/typescript/lib/router/Router.ts` (hash-branch dedup; `on()` dispatch) |
| Modify | `packages/lib/package.json` (delete the `doc` script) |
| Modify | `packages/lib/tests/component/input/Slider.test.ts` (delete 2 deprecation tests) |
| Modify | `packages/lib/tests/unit/router/RoutePattern.test.ts` (add the `__proto__` case) |
| Modify | `packages/lib/docs/data/store.md` (drop the `getActiveSorter` sentence) |
| Modify | `packages/lib/docs/components/Slider.md` (rewrite the alias bullet) |
| Modify | `packages/lib/docs/reference/changelog/next.md` (2 breaking-change entries) |
| Modify | `packages/lib/docs/reference/migration/next.md` (2 migration entries) |

---

## Expected Behaviour

Most of this plan is deletion, where the contract is that the toolchain still passes. Three items do have logic to pin, and all three are unit-testable offline — none needs manual UI verification.

**`parseQuery` keeps every key** ([RoutePattern.test.ts](packages/lib/tests/unit/router/RoutePattern.test.ts), `describe('parseQuery')`):

| Input | Result |
|---|---|
| `'__proto__=x'` | one own key `__proto__` with value `'x'` — build the expectation as `Object.fromEntries([['__proto__', 'x']])` |
| `'=5'` | `{}` — unchanged, empty keys are still skipped |
| `'a=1&b=2'` | `{ a: '1', b: '2' }` — unchanged |

**Hash-mode `navigate` writes the same hash as before** ([Router.test.ts](packages/lib/tests/unit/router/Router.test.ts), `describe('navigate')`, lines 754-800). These four cases already exist and must stay green unchanged:

| Call | Hash written |
|---|---|
| `navigate('/x', { query: { a: '1' } })` | `#/x?a=1` via `setLocationHash` |
| `navigate('/x?a=1', { replace: true })` | `#/x?a=1` via `replaceLocationHash`, and no `setLocationHash` write |
| `navigate('/guide?a=1#intro')` | `#/guide?a=1` — the fragment is still dropped |
| `navigate('/settings')` | `#/settings` — no trailing `?` |

**The `RouterOptions.listeners` bag still registers exactly one listener per event**, firing in registration order — pinned by the existing test at [Router.test.ts:261](packages/lib/tests/unit/router/Router.test.ts#L261), which must stay green unchanged.

Everything else is contract-by-toolchain:

- `npm run typecheck` and `npm run build:lib` pass — no dangling reference to a removed symbol, and every de-exported type still resolves inside its own module and inside the emitted `.d.ts`.
- `npm run lint` passes — every de-exported constant, type, and class retains an in-file use, so nothing becomes an unused local.
- `npm run test` passes with only the two deleted `Slider` deprecation tests missing and the one added `parseQuery` case present.
- `npm run docs:api` finishes with zero warnings — the `{@link ensureCSSRule}` reference is gone, and no public JSDoc names a symbol this plan de-exported.

---

## Verification

```bash
# 1. Every removed symbol is gone repo-wide.
grep -rn "AnchorAxis\|getCSSRule\|ensureCSSRule\|clearPosition" packages/     # expect: zero
grep -rn "getActiveSorter\b" packages/                                        # expect: zero (the live plural form ends in "s")
grep -rn "\bgetIndex\b\|PICKER_HEADER_HEIGHT" packages/                       # expect: zero
grep -rn "minValue\|maxValue" packages/lib/src packages/docs/src              # expect: zero

# 1b. SelectableListRow survives as a declaration but is imported nowhere.
grep -rn "SelectableListRow" packages/ --include=*.ts | grep "import"         # expect: zero

# 2. Exactly one AxisOrientation declaration survives, in primitive/.
grep -rn "export type AxisOrientation" packages/lib/src --include=*.ts      # expect: primitive/Axis.ts:13 only
grep -rn "AxisOrientation" packages/lib/src/typescript/lib/component/chart/ # expect: zero

# 3. The dead script has no caller and is gone.
grep -rn "\"doc\":" packages/lib/package.json                                # expect: zero

# 4. Types, build, declarations, lint.
npm run typecheck
npm run lint
npm run build:lib

# 5. Tests, including the added parseQuery case.
npm run test

# 6. Docs build clean (the removed {@link ensureCSSRule} closed a latent warning).
npm run docs:api            # expect: zero warnings
npm run build:docs
```

No manual smoke test is required: nothing here reaches rendered output, and the three behavioural items are covered by the offline test harness.

---

## Documentation Impact

- **`AbstractStore.getActiveSorter()`** is public. Remove its sentence from [docs/data/store.md:141](packages/lib/docs/data/store.md#L141) and add a breaking-change note to both `next.md` staging pages. The surrounding `getActiveSorters()` prose and code block need no edit.
- **`Slider`'s min/max aliases** are public. Rewrite the bullet at [docs/components/Slider.md:54](packages/lib/docs/components/Slider.md#L54) and add the matching `next.md` entries. The *Common methods* table at line 31 already lists only `setMin` / `setMax`, so it needs no edit.
- **Nothing else needs a doc page touched.** Every other symbol in this plan is absent from all 19 `typedoc.json` entry points, and `typedoc.json` sets `excludeProtected: true`, so `getCSSRule` and `clearPosition` never rendered. `grep -rln '\bSelectableListRow\b' packages/lib/docs/` returns only changelog prose describing past releases, which must not be rewritten.
- Run `npm run docs:api` after the JSDoc edits in steps 9, 16, and 22 — the rule in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) is that it finishes with zero warnings.

---

## Potential Challenges

- **A de-exported type used in an exported function's signature.** `ResolvedStyleState`, `ResolvedStyleBag`, and `FlexiblePlacement` all appear in exported signatures. `tsc` emits each as a non-exported declaration in the same `.d.ts`, which is valid — but `npm run build:lib` is the step that proves it, so run it before assuming the whole group is safe.
- **A symbol that looks unimported but is reached through a barrel re-export.** Mitigation: before each de-export, `grep -rn "from .*<ModuleName>" packages/` and read every named-import list it returns, rather than trusting a bare symbol grep.
- **The `__proto__` test can pass against unfixed code.** An object literal `{ __proto__: 'x' }` sets the prototype, not an own key, so `toEqual` would compare `{}` against `{}`. Build the expectation with `Object.fromEntries`.
- **`Slider`'s deletions are ordered.** Remove the accessor methods before the option fields; removing the fields first leaves `applyOptions` and the constructor referring to keys that no longer exist on `SliderOptions`, which is a wall of type errors rather than one.
- **Index lag after editing.** Do not re-query CodeGraph in the same turn as an edit — the watcher debounces about 500 ms behind writes. Use `grep` and `tsc` for post-edit confirmation.

---

## Critical Files

- [plans/implemented/dead-code-and-orphaned-export-cleanup.md](plans/implemented/dead-code-and-orphaned-export-cleanup.md) — round 1. Read its *Orphaned exports* decisions; this plan follows the same drop-the-keyword rule and the same "remove the orphans your change creates" cascade.
- [plans/implemented/primitive-axis-vocabulary.md](plans/implemented/primitive-axis-vocabulary.md) — establishes `primitive/Axis.ts` as the sole orientation vocabulary and lists the seven aliases it retired. The precedent group 2 restores.
- [packages/lib/src/typescript/lib/primitive/Axis.ts](packages/lib/src/typescript/lib/primitive/Axis.ts) and [packages/lib/src/typescript/lib/primitive/Edge.ts](packages/lib/src/typescript/lib/primitive/Edge.ts) — the vocabulary types both group-2 edits consume; `AxisEnd`'s `Exclude<…>` shape is the model for `ChartAxisEdge`.
- [packages/lib/src/typescript/lib/core/index.ts](packages/lib/src/typescript/lib/core/index.ts) lines 19-24 — the comment stating that only three names leave `ClassStyleRules.ts`, which step 3 restores.
- [packages/lib/src/typescript/lib/data/AbstractStore.ts](packages/lib/src/typescript/lib/data/AbstractStore.ts) lines 252-261 — the `applyOptions` listener dispatch step 24 mirrors.
- [ARCHITECTURE.md](ARCHITECTURE.md) — the `callable()` export rule and the `on` / `off` / `emit` listener-bag rule that steps 5, 13, and 24 answer to.
- [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) — the rule against `{@link}`-ing an excluded symbol from public JSDoc, which step 9's comment fix follows.

---

## Non-Goals

- **Splitting `getQuery`'s hash branch on `#`.** Verified and rejected: in hash mode the leading `#` *is* the route marker, so `splitFragment` would empty the path for both the no-argument reading and an explicit href. The existing test at [Router.test.ts:626-632](packages/lib/tests/unit/router/Router.test.ts#L626) pins the explicit-href case and would fail.[^getquery-asymmetry]
- **Re-tagging `Router`'s `@category Core`.** Verified and rejected: `overlay/` (59 sites) and `diagnostics/` (10 sites) both label themselves `Core` too, so `router/` is consistent, not an outlier.[^category-core]
- **Retiring the seven `@deprecated` symbol families this plan leaves behind.** Each either has a live caller (`BoxLayout`'s `stretching` trio, `AjaxStore`'s positional constructor) or is a barrel-exported type alias with its own doc-page sentence (`FieldConfig`, `AjaxProxyConfig`, `MemoryProxyConfig`, `WebStorageProxyConfig`, `AutoCompleteFieldConfig`). Retiring those is a coordinated deprecation pass with its own migration page, not a dead-code sweep.
- **Moving `TOGGLE_WIDTH` into a shared module.** A new module for one number would add a cross-subsystem import where the repo's own answer is a documented local constant.[^toggle-width-precedent]
- **`PickerColumnHeader`, `Component.getPosition`, and any other symbol not enumerated above.** `PickerColumnHeader` is exported from `PickerColumn.ts` with no importer, but it was not in this sweep's audit and a wider unused-export hunt would collide with the sibling round-2 plans in flight. `getPosition` is test-pinned.
- **Any behaviour change to rendered output.** If a step appears to require one, stop — the step is wrong.

---

## Notes

[^round-one]: [plans/implemented/dead-code-and-orphaned-export-cleanup.md](plans/implemented/dead-code-and-orphaned-export-cleanup.md), *Orphaned exports — drop the keyword when the owning symbol is module-internal*, did exactly this for nine symbols across `AbstractWindow.ts`, `windowControls.ts`, `CollapseSupport.ts`, `layout/Table.ts`, `ResizeHandle.ts`, `AutoCompleteDropdown.ts`, `DialogBackdrop.ts`, and `SortPriorityBadge.ts`. That plan's other branch — promoting a leaked type into its barrel — does not apply to anything here: none of these nine symbols belongs to a publicly exported component's surface, so there is no consumer who would need to name one.

[^callable-fix]: `SelectableListRow` ([AbstractSelectableList.ts:283](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L283)) and the five `Picker*` classes in `AbstractCalendarDropdown.ts` (lines 145, 163, 175, 230, 278) are all concrete `Component` subclasses exported raw. The carve-out comment at [AbstractSelectableList.ts:725](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L725) covers only the *abstract* class above it, and the identical comment in `AbstractCalendarDropdown.ts` at line 488 covers only `AbstractCalendarDropdown`. Wrapping the six in `callable()` was the alternative; it was rejected because nothing imports them, so wrapping would publish six new public components to fix a rule violation that de-exporting removes outright.

[^axis-precedent]: `primitive-axis-vocabulary` landed 2026-06-22 and states its purpose as consolidating "the scattered `"horizontal" | "vertical"` orientation unions" into one place. `overlay-positioning-and-event-consolidation` (landed 2026-07-05) introduced `AnchorAxis` and `svg-charting` (landed 2026-07-07) introduced the colliding `AxisOrientation`; in both plans the type appears only inside a `## Public API` code block, with no `### {Decision}` subsection anywhere in the file discussing axis naming. Per `pattern-conformance.md`, "A new pattern needs a justification… An unexplained new pattern is a defect" — so these are defects to fix, not divergences to preserve.

[^chart-edge-shape]: `Extract<Edge, "bottom" | "left">` rather than a bare `"bottom" | "left"` literal union, because [primitive/Axis.ts:44](packages/lib/src/typescript/lib/primitive/Axis.ts#L44) already derives `AxisEnd` from `AxisPosition` the same way. Deriving makes a typo (`"botom"`) an error at the alias rather than a silently unreachable branch, and it ties the chart's edge names to the same four-edge vocabulary `Insets`, `Border`, and the drag subsystem use. The name `ChartAxisEdge` was chosen over `AxisEdge` because `Edge.ts` already owns the unqualified edge vocabulary and a second `AxisEdge` would re-create the ambiguity this group exists to remove.

[^deprecation-rule]: The repo carries sixteen `@deprecated` markers across nine symbol families. `getActiveSorter` (one marker) and `Slider`'s four accessors plus two option fields (six markers) are the only families whose sole references are their own declaration, one docs sentence, and a deprecation test. `BoxLayout`'s `stretching` option, `getStretching`, and `setStretching` have six callers in `src/` and more in `packages/docs`; `AjaxStore`'s positional constructor overload, `FieldConfig`, `AjaxProxyConfig`, `MemoryProxyConfig`, `WebStorageProxyConfig`, and `AutoCompleteFieldConfig` are all re-exported from their barrels and named on doc pages as still-supported aliases. So the rule reaches two families and stops, with no judgement call left to the implementer.

[^slider-authorised]: [Slider.ts:321-322](packages/lib/src/typescript/lib/component/input/Slider.ts#L321) reads: *"Deprecated alias for {@link setMin}. Kept so existing demos compile; remove in a follow-up cleanup once all consumers are migrated."* No consumer remains: `grep -rn "setMinValue\|getMinValue\|setMaxValue\|getMaxValue" packages/` returns only the declarations, the deprecation test, and the docs sentence. The four accessors and the two option fields are one alias family introduced together — the constructor's fallback mapping at lines 168-175 exists solely to serve the two option fields — so they retire together rather than leaving a half-surface where `new Slider({ minValue: 5 })` works but `slider.setMinValue(5)` does not.

[^proto-drop]: `result` is a plain `{}`, so it inherits `Object.prototype`'s `__proto__` accessor. `result["__proto__"] = "x"` invokes that setter, which ignores a non-object value and stores nothing — the pair disappears with no error. This is not a prototype-pollution hole (every value here is a string, so nothing is ever installed as a prototype); it is an undocumented drop that contradicts the function's own JSDoc, which lists only empty pairs and empty keys as skipped. `Object.create(null)` was the alternative: it would also preserve the key, but it changes the returned object's prototype, and `getQuery` hands that object to consumers who may reasonably call `hasOwnProperty` on it. `Object.defineProperty` keeps an ordinary object and fixes only the one key that misbehaves. `Object.keys` still enumerates the defined key, so `formatQuery` round-trips it.

[^navigate-equivalence]: With the current code, hash mode computes `query = options?.query ?? parseQuery(splitQuery(splitFragment(path).path).query)` and calls `getHref(path, query)`. `query` is never `undefined` — the `??` fallback returns a record — so `getHref`'s own `effective = query ?? parseQuery(…)` always resolves to the passed value and its `parseQuery` call is dead. Passing `options?.query` directly instead makes `getHref`'s fallback live again, and its fallback derives the same value from the same `path` by the same three calls. The two forms are therefore equal on every input, including `options.query === {}`, which is a record and so still wins over the embedded query. `getHref` needs its own `splitFragment` / `splitQuery` regardless, for the encoded path and the History-mode fragment, so the saving is the caller's duplicate pair.

[^listener-dispatch]: `Router.on` has two overload declarations plus an implementation signature. TypeScript does not expose an implementation signature to callers — not even `this.on(…)` inside the class — so a loop over `Object.keys(options.listeners)` yields a `RouterEvent` union key and a union listener that match neither overload, which is why the original code reached past `on()` into the bag. [Component.applyListeners:864](packages/lib/src/typescript/lib/core/Component.ts#L864) solves the same problem with `(this as any).on(event, fn)`, because a base class cannot know its subclass's event set. `Router` does know its own — two events — so destructuring the bag and calling `on` with each literal name typechecks with no cast at all. That is the same rule (dispatch through `on()`) reached by a shorter route, not a different rule.

[^ensure-css-orphan]: `getCSSRule` is a one-line forwarder with zero callers since 2026-06-19. Deleting it leaves `private ensureCSSRule()` with no caller either — the four other `ensureCSSRule` mentions in `Component.ts` (lines 686, 1157, 1174, 1843) are all comments or JSDoc. Per CLAUDE.md §3, orphans a change creates are removed with it. Nothing about rule materialisation is lost: `commitCSSRule` ([Component.ts:1849](packages/lib/src/typescript/lib/core/Component.ts#L1849)) and `materialiseStyleRule` ([Component.ts:6203](packages/lib/src/typescript/lib/core/Component.ts#L6203), the last `applyStyle` phase) both go through `materialiseWhenNeeded` and `_styleRule.flush()`, never through `ensureCSSRule`. Removing the pair also drops both of `Component.ts`'s executable `CSSStyleRule` references, which is a small step toward keeping that DOM type inside `core/DOM.ts` — though `core/StyleTarget.ts` still names it, so this is a side benefit rather than the reason.

[^toggle-width-precedent]: `AbstractSelectableList.ts` line 71, `AutoCompleteDropdown.ts` line 13, and `ComboBox.ts` line 103 each declare an unexported local constant with the value `22` for the same row height, each documented as matching the others — `AbstractSelectableList.ts`'s comment says *"Keep these three values in lockstep if the row chrome changes."* That is this repo's established answer for a small dimension shared across subsystems: a local constant plus a cross-reference comment, not a shared module. `core/ScrollShadow.ts` is the counter-example that shows where the line is — it was extracted because the duplication was drift-prone arithmetic across three functions, not a single literal.

[^param-guard]: For any `CompiledPattern` that `compilePattern` produced, the branch condition is always true: `compilePattern` throws when `"*"` is not the final segment, and `matchPattern`'s loop bound `staticLength` excludes a trailing `catchAll`, so `patternSegments[i].kind` inside the loop is only ever `"static"` or `"param"`. Changing `else if (…)` to a bare `else` was the alternative. It was rejected because `matchPattern` is exported and its `CompiledPattern` parameter is a plain interface a caller can build by hand — [RoutePattern.test.ts:229](packages/lib/tests/unit/router/RoutePattern.test.ts#L229) already constructs one directly — and under a bare `else` a hand-built mid-pattern `catchAll` would write a `""`-keyed param instead of being skipped. The comment costs one line and removes the finding permanently.

[^base-idempotent]: `normalizeBase` runs `splitPath` (which drops empty segments) and rebuilds `"/" + segments.join("/") + "/"`, so `"/x/"` → `["x"]` → `"/x/"` and `"/"` → `[]` → `"/"`. Feeding it its own output changes nothing. `Router.applyOptions` normalizes into `_base` at line 433, and `stripBase` / `joinBase` normalize again at lines 173 and 193; both functions' JSDoc already documents the parameter as *"the site base, in any shape `normalizeBase` accepts"*, so the second pass is the documented contract, not an oversight. No code change — only the sentence, so the redundancy reads as deliberate next time.

[^getquery-asymmetry]: In hash mode a URL's only `#` is the route marker: `getHref` returns `"#/x?a=1"`, and `location.hash` reads back the same shape. `splitFragment("#/x?a=1")` returns `{ path: "", fragment: "/x?a=1" }`, so `splitQuery("")` would yield `""` and `getQuery` would answer `{}` for a hash that plainly carries `a=1`. That breaks the no-argument path and the explicit-href path alike, so "split only the explicit-href case" is not a smaller fix — it is the same failure. History mode differs because there a `#fragment` is a real, separate URL part that must come off before the `?` is located. The asymmetry is required by the two modes' URL shapes.

[^category-core]: `@category` is a TypeDoc grouping label, not a per-barrel identity. Counting the tag across the subpath directories: `core/` uses `Core` 89 times, `overlay/` uses `Core` 59 times, `diagnostics/` uses `Core` 10 times, and `router/` uses it once. `primitive/` uses `Util`, `layout/` uses `Layouts`, `data/` uses `Data`, `validation/` uses `Validation`. So three directories already group under `Core`, and `router/` joining them is the majority behaviour for a non-component subsystem.

[^public-surface]: [docs/reference/migration/index.md](packages/lib/docs/reference/migration/index.md) defines it in as many words: *"The 'public API' means everything re-exported from the per-group barrels at `src/typescript/lib/<group>/index.ts`… Internal modules — even those exported as side-effect of a class hierarchy — are subject to change without notice."* Checked against that line, only `AbstractStore` and `Slider` among this plan's targets are reachable from a barrel. `ScrollShadow.ts`, `RoutePattern.ts`, `OverlayPosition.ts`, `ChartAxis.ts`, `AbstractCalendarDropdown.ts`, `PickerColumn.ts`'s constants, `TimeColumns.ts`, `TreeRow.ts`'s and `TreeCell.ts`'s `TOGGLE_WIDTH`, and `SelectableListRow` are all absent from every `index.ts`; `Component.getCSSRule` and `Component.clearPosition` are `protected`, which `typedoc.json`'s `excludeProtected: true` already keeps out of the rendered docs.

[^dts-emit]: Confirmed by compiling a minimal case with the repo's own `tsc` under `--declaration --strict`: an exported function returning a non-exported same-file interface emits `interface Hidden { … }` followed by `export declare function f(): Hidden;` with no error. The restriction that produces TS4023 applies to a type that is not declared at the top level of the emitted file, which is not the case for any of the three types here.
