# DOM-Access Optimization Pass — Implementation Plan

## Context

The TypeScript UI library at [src/typescript/](src/typescript/) touches the DOM more often than necessary, costing render frames in three observable scenarios: (1) scrolling large virtualized tables/trees, (2) initial render of many components, and (3) theme switching. Investigation of the codebase confirmed concrete inefficiencies in each area:

- **Hot-path layout thrashing** in [Body.ts:243-282](src/typescript/Base/component/table/Body.ts#L243-L282) (per-row/per-cell setX/setY/setWidth/setHeight + cell.doLayout() called every renderWindow even when geometry is unchanged) and the parallel pattern in [Tree.ts:485-536](src/typescript/Base/component/tree/Tree.ts#L485-L536). [AutoCompleteDropdown.ts:82-84](src/typescript/Base/component/AutoCompleteDropdown.ts#L82-L84) reads both `getBoundingClientRect()` and `offsetWidth` on the same element.
- **Component setters lack equality short-circuits** — `setWidth/setHeight/setX/setY/setDisplayed/setZIndex/...` in [Component.ts](src/typescript/Base/Component.ts) always write to the DOM even when the value is unchanged. These setters are invoked thousands of times per frame in the table virtual-scroll loop.
- **Unbatched style writes** — [Text.applyStyle](src/typescript/Base/component/Text.ts#L407-L423) emits 10 sequential writes to a CSSStyleRule's style on every `applyStyle` call (theme change touches every Text).

The intended outcome is faster scroll/init/theme paths with no behavior changes, validated by a small in-browser perf harness. Existing batching primitives (`setElementCSSRules`, `pauseLayout/resumeLayout`, `dirtyStyle`) are reused — we are not introducing a new abstraction layer.

---

## Phase 1 — Hot-path local fixes

### 1.1 `Body.ts` virtual scroll geometry caching — [Body.ts:243-282](src/typescript/Base/component/table/Body.ts#L243-L282)
- Add two parallel arrays alongside `rowPool`/`boundIndices`: `rowGeom: Array<{x:number,y:number,w:number,h:number}|null>` and `cellGeom: Array<Array<{x:number,w:number}|null>>`.
- In the row loop: skip `setX/setY/setWidth/setHeight` when prior `rowGeom[i]` matches target; skip `setDisplayed(true)` when already displayed.
- In the cell loop: skip `setX/setWidth/setHeight` when unchanged. **Skip `cell.doLayout()`** unless the row was just rebound (`boundIndices[i] !== dataIndex`) OR a cell width/height changed — this is the largest win since `doLayout()` recurses into children.
- Keep the existing `setAutoCommitStyle(false/true)` brackets.
- **Invalidate** `rowGeom` and `cellGeom` wherever `lastColumnWidths`, `lastBodyWidth`, `hiddenColumns`, or the store reference is reassigned. Grep for `lastColumnWidths` / `lastBodyWidth` assignments to find all sites.
- **Risk:** stale geometry after column resize / hide-column / sort. Verification: `ComplexUIPanel` — scroll, sort, hide columns, resize columns.

### 1.2 `Body.ts` ensureVisible read/write/read — [Body.ts:660-668](src/typescript/Base/component/table/Body.ts#L660-L668)
- Cache `el.scrollTop` and `this.getHeight()` to locals before the comparisons.
- Only assign `el.scrollTop` when the new value differs from the cached read.

### 1.3 `AutoCompleteDropdown.ts` rect-vs-offsetWidth dedup — [AutoCompleteDropdown.ts:82-84](src/typescript/Base/component/AutoCompleteDropdown.ts#L82-L84)
- Replace `this.setWidth(anchorEl.offsetWidth)` with `this.setWidth(rect.width)` (`setWidth` accepts a number → `width + "px"`, fractional is fine).
- Removes one forced layout per dropdown open.

### 1.4 `Tree.ts._renderWindow` mirror of 1.1 — [Tree.ts:485-536](src/typescript/Base/component/tree/Tree.ts#L485-L536)
- Add `_rowGeom: Array<{y:number,w:number,h:number}|null>` parallel to `_rowPool`.
- Skip `setX/setY/setWidth/setHeight` when unchanged; conditionally skip `row.layoutChildren(rowWidth, ROW_HEIGHT, INDENT_PX)` when `rowWidth` is unchanged AND the row was not rebound this pass.
- Invalidate `_rowGeom` whenever `_flatRows` is rebuilt (expand/collapse).

### 1.5 `Util.ts.calculateScrollBarWidth` eager warm-up — [Util.ts:172-216](src/typescript/Base/Util.ts#L172-L216)
- Already cached on first call. Add an explicit eager call from app init (e.g., end of [main.ts](src/typescript/main.ts)) so the read/write/read pattern never fires during a hot frame.

---

## Phase 2 — Setter equality short-circuits in [Component.ts](src/typescript/Base/Component.ts)

Add a guard at the entry of each setter. **Pattern**: short-circuit only when the new value equals the cached scalar AND `this.getElement()` exists — first-render writes must still propagate when the field already has the default value.

For setters that target `cssRule` exclusively (no element gating in current code), simple value equality suffices.

| Setter | Location | Guard |
|---|---|---|
| `setWidth` | line 1116 | `if (this.width === width && this.getElement()) return;` |
| `setHeight` | line 1146 | `if (this.height === height && this.getElement()) return;` |
| `setX` | line 1171 | `if (this.left === x && this.getElement()) return;` |
| `setY` | line 1196 | `if (this.top === y && this.getElement()) return;` |
| `setZIndex` | line 478 | `if (this.zIndex === value) return;` |
| `setDisplayed` | line 501 | `const v = !!value; if (this.displayed === v && this.getElement()) return;` |
| `setMinSize` | line 891 | guard on both width and height equality (read existing `this.minSize`) |
| `setMaxSize` | line 949 | same; ensure the `setAttribute("maxSize", ...)` side-effect is also gated |
| `setPadding` | line 554 | compare all 4 Insets fields (introduce a private `insetsEqual(a,b)` helper) |
| `setBackgroundColor` | line 573 | `if (this.backgroundColor === backgroundColor) return;` |
| `setForegroundColor` | line 621 | same |
| `setBorderRadius` | line 715 | same |
| `setCursor` | line 696 | same |

**Do NOT** guard `setSize` (line 1080) — it calls `doLayout()` unconditionally and children rely on this. Add a one-line comment noting why.

**Risk:** missing a side effect that callers rely on (e.g., a setter that also fires an event). Audit each setter's body before the equality return — only short-circuit when the body is purely "cache field + write to DOM".

**Verify:** type-check; demo-panel sweep with attention to panel resize, tab switch, MenuPanel reopen at same coords, AccordionPanel collapse/expand.

---

## Phase 3 — `Text.applyStyle` batching

### [Text.ts:407-423](src/typescript/Base/component/Text.ts#L407-L423)
Replace 10 individual `rule.style.X = ...` assignments with a single `this.setElementCSSRules({...})` call (existing primitive at [Component.ts:341](src/typescript/Base/Component.ts#L341)). The downstream `Object.assign(rule.style, dirtyCSSRule)` in `commitCSSRule` writes all 10 properties in one statement.

Use camelCase keys throughout (`fontFamily`, `fontSize`, `textAlign`, `textShadow`, `fontKerning`, `fontSizeAdjust`, `fontStretch`, `fontStyle`, `fontVariant`, `fontWeight`). Camelcase equivalence with kebab-case `setProperty` is precedented in this file at line 1046 (`setElementCSSRule("verticalAlign", ...)`).

Empty-string sentinel preserved verbatim for unset values.

**Verify:** theme switch, font changes in panels containing Labels.

---

## Phase 4 — Theme variable batching

### [CSS.ts:157-162](src/typescript/Base/CSS.ts#L157-L162) — `setRootVariables`
**Constraint:** `cssText` clobbers all root inline styles. Audit first with `grep -rn "documentElement.style" src/typescript`. If the audit finds writes outside the theme system, do **not** use `cssText`.

Default action (safe):
- Capture `const style = root.style;` to avoid repeated lookup.
- Add a per-property short-circuit: skip `style.setProperty(name, value)` when `style.getPropertyValue(name) === value`.

Optional (only if audit comes back clean): build a single `--name:value;` string and assign via `root.style.cssText`.

### [MenuPanel.ts:103-149](src/typescript/Base/component/menubar/MenuPanel.ts#L103-L149) — deferred sub-item
Wrap the `setX`/`setY` pair in `this.pauseLayout(); ... ; this.resumeLayout();` so the two style writes coalesce. Low-priority polish.

---

## Phase 5 — Perf harness (NEW additive file)

### New: `src/typescript/perf/Benchmark.ts`
Single class `Benchmark` exposing three static methods:
- `benchTableScroll(rowCount = 10000)` — build a Table with N rows in a hidden offscreen container, drive `body.element.scrollTop` through a sequence via `requestAnimationFrame`, log mean frame time and total via `performance.now()`.
- `benchComponentInit(count = 1000)` — construct N Component instances (no parent); log delta.
- `benchThemeSwitch(iterations = 10)` — toggle `ThemeManager.setTheme(...)` between light/dark; log totals.

Wire into [main.ts](src/typescript/main.ts):
```
(window as any).bench = Benchmark;
```
**Gate auto-run:** never auto-run — only register the global handle, devtools-invoked.

**Verify:** Open the app, run `bench.benchTableScroll()`, `bench.benchComponentInit()`, `bench.benchThemeSwitch()` from devtools. Capture numbers before each phase to attribute wins.

---

## Phase 6 — Measure `CSS.insertRule` cost

### [CSS.ts:115-128](src/typescript/Base/CSS.ts#L115-L128) — `createComponentRule`
Per CLAUDE.md the historic O(N²) was already fixed (`insertRule` at `cssRules.length` is O(1) append in modern engines). Verify before changing anything:
- Run `bench.benchComponentInit(5000)` after Phase 5 lands.
- Compare against a control branch that no-ops `createComponentRule` on a throwaway local commit.
- If the delta is < 5% of init time, **leave alone**. Sharding across multiple `<style>` elements would be the next step but only with measured justification.

---

## Critical files to modify

- [src/typescript/Base/Component.ts](src/typescript/Base/Component.ts) — Phase 2
- [src/typescript/Base/component/table/Body.ts](src/typescript/Base/component/table/Body.ts) — Phase 1.1, 1.2
- [src/typescript/Base/component/tree/Tree.ts](src/typescript/Base/component/tree/Tree.ts) — Phase 1.4
- [src/typescript/Base/component/Text.ts](src/typescript/Base/component/Text.ts) — Phase 3
- [src/typescript/Base/CSS.ts](src/typescript/Base/CSS.ts) — Phase 4
- [src/typescript/Base/component/AutoCompleteDropdown.ts](src/typescript/Base/component/AutoCompleteDropdown.ts) — Phase 1.3
- [src/typescript/Base/component/menubar/MenuPanel.ts](src/typescript/Base/component/menubar/MenuPanel.ts) — Phase 4 (deferred)
- [src/typescript/Base/Util.ts](src/typescript/Base/Util.ts) — Phase 1.5
- [src/typescript/main.ts](src/typescript/main.ts) — Phase 1.5, Phase 5
- **NEW** `src/typescript/perf/Benchmark.ts` — Phase 5

## Existing primitives to reuse (do NOT reinvent)

- `setElementStyle` / `setElementStyles` / `commitElementStyle` ([Component.ts:269-332](src/typescript/Base/Component.ts#L269-L332))
- `setElementCSSRule` / `setElementCSSRules` / `commitCSSRule` ([Component.ts:341-368](src/typescript/Base/Component.ts#L341-L368))
- `setAutoCommitStyle(false/true)` brackets ([Component.ts:306](src/typescript/Base/Component.ts#L306))
- `pauseLayout` / `resumeLayout`
- `Util.getScrollBarWidth` cached lookup ([Util.ts:223](src/typescript/Base/Util.ts#L223))

---

## End-to-end verification

1. **Type-check**: `npx tsc --noEmit` passes (or the project's configured equivalent).
2. **Capture baseline**: before any change, run `bench.benchTableScroll()`, `bench.benchComponentInit()`, `bench.benchThemeSwitch()` and record numbers.
3. **Demo-panel sweep** in `npm run dev`:
   - **[ComplexUIPanel.ts](src/typescript/ComplexUIPanel.ts)** — virtual-scroll Table, sort, hide columns, keyboard navigation. Watch for stale row positions, missing cell layout.
   - **[MultiSelectListPanel.ts](src/typescript/MultiSelectListPanel.ts)** — selection visuals (validates `setBackgroundColor`/`setDisplayed` guards).
   - **[MenuBarPanel.ts](src/typescript/MenuBarPanel.ts)** — open/close menus, submenu at viewport edges.
   - **[AccordionPanel.ts](src/typescript/AccordionPanel.ts)** — collapse/expand (validates `setHeight`/`setDisplayed` guards).
   - **[MiscPanel.ts](src/typescript/MiscPanel.ts)** — autocomplete dropdown width matches anchor.
4. **Re-run perf harness**, compare against baseline. Expectation: scroll mean frame time drops measurably; theme switch time drops; init time roughly unchanged unless Phase 6 finds a real cost.
5. Per [CLAUDE.md](CLAUDE.md): run `graphify update .` after implementation lands.

## Order of execution (lowest-risk first)

1. Phase 5 (perf harness) — additive, lets us capture baselines.
2. Phase 1 (hot-path local fixes) — purely local logic.
3. Phase 2 (setter equality guards) — touches Component.ts but each guard is isolated.
4. Phase 3 (Text.applyStyle batching) — uses existing batching API.
5. Phase 4 (theme variable batching) — depends on the cssText safety audit.
6. Phase 6 (CSS.insertRule investigation) — measure-first; act only if justified.
