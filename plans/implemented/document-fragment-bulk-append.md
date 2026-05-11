# DocumentFragment for Bulk-Append Hot Paths

## Context

The layout framework builds component subtrees detached and attaches them to a live parent in one append — a pattern that already avoids most per-iteration layout thrash and gets the same benefit `DocumentFragment` would otherwise provide. A repo-wide search confirms zero existing `DocumentFragment` usage in `src/typescript`, and most candidate loops are running while their parent is still detached (so a fragment swap would add complexity for no win).

Three sites are different: they loop `appendChild` into a parent that is **already in the live DOM**. Each per-iteration append on a live parent can force a layout/style-recalc opportunity. The hot path here is the virtual-scroll row pool growth in Table and Tree, which runs on first mount and on viewport resize and dominates first-paint cost when the visible window is large. ComboBox's `refreshFromStore` loops into a live `<select>` on every store change.

Batching N appends through a single `DocumentFragment` flush turns N live-parent mutations into one. No public API changes, no behavioral change — just a structural swap at three call sites.

**Outcome:** Reduce the cost of Body / Tree row-pool growth and ComboBox option refresh, with a measurable win surfaced through an extended micro-benchmark.

---

## Audit findings

`grep -rn "appendChild" src/typescript --include="*.ts"` returns 51 sites. Each was inspected for two conditions: (a) the call is inside a loop, and (b) the parent element is in the live DOM when the loop runs.

### Sites that qualify (parent is live, loop is bulk-append)

| Site | Line | Parent live when looping? | Loop appends |
| --- | --- | --- | --- |
| `Body.renderWindow` pool grow | [Body.ts:282-304](src/typescript/Base/component/table/Body.ts#L282-L304) | Yes — body element is mounted during scroll/render | New `Row` elements until pool ≥ windowSize |
| `Tree._renderWindow` pool grow | [Tree.ts:514-526](src/typescript/Base/component/tree/Tree.ts#L514-L526) | Yes — tree element is mounted during scroll/render | New `TreeRow` elements until pool ≥ windowSize |
| `ComboBox.refreshFromStore` | [ComboBox.ts:370-374](src/typescript/Base/component/ComboBox.ts#L370-L374) | Yes — `<select>` is mounted; loop runs after `innerHTML = ""` | One `<option>` per item |

### Sites that do NOT qualify (parent detached during the loop)

| Site | Line | Why excluded |
| --- | --- | --- |
| `Component.init` child append | [Component.ts:2014-2020](src/typescript/Base/Component.ts#L2014-L2020) | Runs during `init()` before the element is inserted into its parent. |
| `ComboBox.render` items append | [ComboBox.ts:382-392](src/typescript/Base/component/ComboBox.ts#L382-L392) | `render()` returns the element before any caller attaches it. |
| `Window.render` border appends | [Window.ts:415-422](src/typescript/Base/Window.ts#L415-L422) | Same — eight appends to a still-detached root. |
| `FieldSet` legend, `TreeRow` content, `Header` handle/badge, `Split` gutter, `Accordion.attach` header/wrapper | [FieldSet.ts:82](src/typescript/Base/component/FieldSet.ts#L82), [TreeRow.ts:157-158](src/typescript/Base/component/tree/TreeRow.ts#L157-L158), [Header.ts:90,101](src/typescript/Base/component/table/cell/Header.ts#L90), [Split.ts:166](src/typescript/Base/layout/Split.ts#L166), [Accordion.ts:386-390](src/typescript/Base/layout/Accordion.ts#L386-L390) | Small fixed-count appends during init; parent typically still detached or count is too small to matter. |
| Single-shot `document.documentElement.appendChild` in Tooltip, Menu, Notification, Dialog, AutoCompleteDropdown, Window | various | One append, not a loop. Fragments do nothing. |

### Out-of-scope but flagged

[Accordion.ts:265-285](src/typescript/Base/layout/Accordion.ts#L265-L285) interleaves `appendChild` and `.remove()` in `detach()` on live parents. Not a fragment case — it's live-DOM thrash of a different shape. Mentioned for awareness; not changed by this plan.

---

## Implementation

### [src/typescript/Base/component/table/Body.ts](src/typescript/Base/component/table/Body.ts)

Replace the `while (this.rowPool.length < windowSize)` block at [Body.ts:282-304](src/typescript/Base/component/table/Body.ts#L282-L304) so the per-iteration `appendChild` goes to a `DocumentFragment` and the fragment is flushed once after the loop:

```
const fragment = document.createDocumentFragment();
while (this.rowPool.length < windowSize) {
    const row = new Row(
        this.store.model,
        undefined,
        this.hiddenColumns,
        this.columnConfigs,
        (record) => this.store.notifyRecordChanged(record),
    );
    const rowEl = row.getElement(true);

    fragment.appendChild(rowEl);

    rowEl.addEventListener('click', (e: MouseEvent) => this.onRowClick(row, e));
    row.setY(0);

    this.rowPool.push(row);
    this.boundIndices.push(-1);
    this.rowGeom.push(null);
    this.cellGeom.push([]);
}
if (fragment.childNodes.length > 0) {
    element.appendChild(fragment);
}
```

Notes:
- Listeners on detached nodes are valid — the click handler binding before the parent attach is correct.
- The pool-state pushes happen on the still-detached `rowEl`; nothing downstream reads the live-parent ancestry.
- The `if (fragment.childNodes.length > 0)` guard avoids a noop append when the pool was already large enough.

### [src/typescript/Base/component/tree/Tree.ts](src/typescript/Base/component/tree/Tree.ts)

Same pattern at [Tree.ts:514-526](src/typescript/Base/component/tree/Tree.ts#L514-L526):

```
const fragment = document.createDocumentFragment();
while (this._rowPool.length < windowSize) {
    const row = new TreeRow();
    const rowEl = row.getElement(true);

    fragment.appendChild(rowEl);
    row.setY(0);

    this._rowPool.push(row);
    this._boundIndices.push(-1);
    this._rowGeom.push(null);
}
if (fragment.childNodes.length > 0) {
    element.appendChild(fragment);
}
```

The two-pass bind/measure logic that follows the grow loop reads from `this._rowPool` and `rowEl` references, both populated and valid; deferring the parent attach to the end of the grow loop is invisible to that logic.

### [src/typescript/Base/component/ComboBox.ts](src/typescript/Base/component/ComboBox.ts)

Modify only `refreshFromStore` at [ComboBox.ts:370-374](src/typescript/Base/component/ComboBox.ts#L370-L374). Keep the `innerHTML = ""` clear; route the loop through a fragment:

```
element.innerHTML = "";

const fragment = document.createDocumentFragment();
for (let i = 0; i < this.items.length; i++) {
    fragment.appendChild(this.items[i].getElement(true));
}
element.appendChild(fragment);
```

**Do not modify** the `render()` loop at [ComboBox.ts:382-392](src/typescript/Base/component/ComboBox.ts#L382-L392) — its parent is detached.

### [src/typescript/perf/Benchmark.ts](src/typescript/perf/Benchmark.ts)

The existing [benchTableScroll](src/typescript/perf/Benchmark.ts#L43-L106) bundles pool-grow cost into "total" because the first `tick()` after `setSize` is the one that grows the pool. To make the fragment win directly measurable, add a separate benchmark that isolates the first `renderWindow`:

Add a static method `benchTablePoolGrow(rowCount = 10000, iterations = 20)`:
- Reuse [`buildPersonStore`](src/typescript/perf/Benchmark.ts#L15) to build the store once.
- For each iteration: create a fresh `Table`, mount into a `600×400` offscreen host (same shape as existing benchTableScroll setup at [Benchmark.ts:48-57](src/typescript/perf/Benchmark.ts#L48-L57)), call `performance.now()` immediately before and after `table.setSize({ width: 600, height: 400 })` (which forces the first `renderWindow` / pool grow synchronously via the existing layout scheduling path). Detach the host between iterations so the next iteration starts with an empty pool.
- Log mean / max / total in the same format as the existing benchmarks: `console.log("[bench:tablePoolGrow]", "rows=" + rowCount, "iterations=" + iterations, "total=...", "mean=...", "max=...")`.

Wire it into [`benchAll()`](src/typescript/perf/Benchmark.ts#L147-L151) after `benchTableScroll`:

```
static async benchAll(): Promise<void> {
    Benchmark.benchComponentInit();
    Benchmark.benchThemeSwitch();
    await Benchmark.benchTableScroll();
    await Benchmark.benchTablePoolGrow();
}
```

---

## Critical files to modify

- [src/typescript/Base/component/table/Body.ts](src/typescript/Base/component/table/Body.ts) — fragment swap at lines 282-304.
- [src/typescript/Base/component/tree/Tree.ts](src/typescript/Base/component/tree/Tree.ts) — fragment swap at lines 514-526.
- [src/typescript/Base/component/ComboBox.ts](src/typescript/Base/component/ComboBox.ts) — fragment swap at lines 370-374 only.
- [src/typescript/perf/Benchmark.ts](src/typescript/perf/Benchmark.ts) — add `benchTablePoolGrow`, wire into `benchAll`.

No other files change. No public API change. No new exports.

## Existing primitives to reuse

- `document.createDocumentFragment()` — DOM standard; available in every supported browser.
- [`Benchmark.buildPersonStore`](src/typescript/perf/Benchmark.ts#L15) — reuse for the new pool-grow benchmark.
- [`Benchmark.benchTableScroll`](src/typescript/perf/Benchmark.ts#L43) offscreen-host pattern — copy the `host.style.left = "-10000px"` + 600×400 setup.

## Risks

- **Pool-grow runs inside scroll handler.** Adding a fragment doesn't change synchronicity — the grow still completes before `renderWindow` returns. No risk of partial-render flicker.
- **Click listener attached before parent attach.** Standard DOM behavior — listeners on detached nodes are retained and fire after attach. The codebase already relies on this elsewhere (every `render()` attaches listeners on still-detached elements).
- **ComboBox `<select>` semantics.** Browsers expose live `<option>` children to the form-value layer. Building options inside a fragment and appending once is equivalent to appending one-by-one for the `<select>`'s value model. No behavioral change.
- **Empty pool case.** The `if (fragment.childNodes.length > 0)` guard prevents a no-op `appendChild(fragment)` when the pool was already at or above `windowSize`. Cheap insurance.

## Verification

1. **Type-check**: `npx tsc --noEmit` produces no new errors above the existing baseline.
2. **Build**: `npx vite build` succeeds.
3. **Benchmark — before**: on `master` pre-change, run `window.bench.benchTablePoolGrow()` in devtools; record mean/max/total. Also run `window.bench.benchTableScroll()` as a regression baseline.
4. **Apply changes.**
5. **Benchmark — after**: rerun both. Expectation: `benchTablePoolGrow` mean drops measurably; `benchTableScroll` is unchanged (pool is fully populated after the first window and reused thereafter).
6. **Demo-panel sweep** in `npm run dev`:
   - **ComplexUIPanel / TablePanel** — scroll the table, resize the viewport so the visible window grows, confirm no missing or duplicated rows; click rows to confirm the click listener still fires.
   - **Tree panel** — same: scroll + resize + click; expand/collapse nodes.
   - **BindingPanel** (or any ComboBox demo) — open the ComboBox, confirm options are present and selectable; mutate the bound store, confirm the option list refreshes with the new items.
7. **graphify**: run `graphify update .` after edits, per project [CLAUDE.md](CLAUDE.md).
