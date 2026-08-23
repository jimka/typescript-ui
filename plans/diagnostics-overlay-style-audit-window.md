---
depends-on: [debug-diagnostics-overlay, diagnostics-overlay-row-explanations]
---

# Diagnostics Overlay Style Audit Window — Implementation Plan

## Overview

[`StyleAuditPanel`](packages/lib/src/typescript/StyleAuditPanel.ts) is the demo app's stylesheet-dedup audit — a permanent "Style Audit" tab that scans the framework's shared `<style id="Base">` stylesheet for per-instance (`#id`-scoped) rules whose declaration body duplicates another instance's, and lists the worst offenders by bytes wasted. It lives in demo-app code (`src/typescript/*.ts`), not the published library (`src/typescript/lib/**`), and it reads the stylesheet by raw DOM (`document.getElementById("Base")`, `element.classList`, `CSS.escape`) — calls the library itself is not allowed to make outside `core/DOM.ts` (`local/no-raw-dom`, [`eslint.config.js:96-115`](packages/lib/eslint.config.js#L96)).

This plan gives [`DiagnosticsOverlay`](packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts) a button that opens a second floating window showing the same audit, and extracts the audit's computation and rendering into two new library modules under `lib/diagnostics/`, so both the demo tab and the new window run one shared implementation instead of two. The extraction replaces every raw DOM call with the existing `DOM.source` seam plus one new seam member, and replaces the panel's own CSSOM scan with [`StyleTarget`](packages/lib/src/typescript/lib/core/StyleTarget.ts)'s already-existing `_ruleCache` — the same cache [`styleRuleCounts()`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L270) reads for the overlay's own "Stylesheet rules" row, so the two views end up reading the same source of truth for the first time.

---

## Architecture Decisions

### The audit's logic moves to `lib/diagnostics/`; `StyleAuditPanel.ts` becomes a thin wrapper

`StyleAuditPanel.ts`'s current content splits cleanly into two kinds: the audit itself (stylesheet scan, dedup grouping, summary text, the results table) is view-only logic that belongs in the library; the "Shared Instance Style Groups" section (eight demo buttons that manufacture grouped/ungrouped style rules to give the audit something to show) exists only to make the demo tab interesting and stays in the demo file.[^scaffolding-split] After the split, `StyleAuditPanel.ts` keeps its page title, the demo-buttons section, and embeds one instance of the new library view — the same relationship [`MiscPanel.ts:236`](packages/lib/src/typescript/MiscPanel.ts#L236) already has with `DiagnosticsOverlay`: a demo file that wires to library logic rather than containing it.[^miscpanel-precedent]

### Three new files, following the `DiagnosticsSampler` / `DiagnosticsOverlay` split

The audit becomes three files, mirroring how the existing pair in this directory already separates computation from UI: a pure computation module (`StyleAudit.ts`, mirroring `DiagnosticsSampler.ts`'s `readFrameworkCounts()`), a reusable `Panel` component (`StyleAuditView.ts`), and a static-singleton `Window` (`StyleAuditOverlay.ts`, mirroring `DiagnosticsOverlay.ts` itself). The three-way split (rather than the existing pair's two-way one) exists because this view, unlike `DiagnosticsOverlay`, is embedded in two different hosts — the demo tab and the new window — so the embeddable piece (`StyleAuditView`) has to be separable from the window chrome that wraps it in one of those two hosts.

### The stylesheet scan reads `StyleTarget`'s rule cache, not raw CSSOM

`StyleAuditPanel.auditBaseStylesheet()` today re-derives what `_ruleCache` already tracks by scanning `document.getElementById("Base").sheet.cssRules` directly. The extracted version reads the cache instead, through one new export, `styleRuleEntries()`, added beside `styleRuleCounts()` in `StyleTarget.ts`.[^rule-cache-not-cssom] This does not touch `styleRuleCounts()` or the cache itself — it is a second, additive reader of the same `_ruleCache`.

### One new seam member: `DOMSource.getRuleCssText()`

`local/no-raw-dom` flags member access on a `CSSStyleRule` receiver everywhere outside `core/DOM.ts` — including `.cssText`, which the dedup scan needs to compare declaration bodies. `styleRuleEntries()` gets each cached rule's text through one new read-only seam member, `DOM.source.getRuleCssText(rule)`, following the same shape as `countElements()`: a `DOMSource` read, added for this diagnostics feature, degrading to `''` offline.[^getrulecsstext-source-not-sink] No other new seam surface is needed — matching a live `#id` selector to the component class name that produced it uses seam members that already exist: `DOM.source.querySelectorAll()`, `getId()`, `getAttribute()`, and `escapeSelector()`, rooted at `DOM.source.getBody()`.[^component-index-seam]

### The window is a static-only singleton, mirroring `DiagnosticsOverlay`

`StyleAuditOverlay` extends `Window`, has a private constructor, a `private static instance`, and `open()` / `close()` / `toggle()` / `isOpen()` — `DiagnosticsOverlay`'s own shape, one directory over. Nothing about auditing one global rule cache benefits from more than one instance.

### The button lives in the body `Panel`, below the metrics grid — not as a grid row

`DiagnosticsOverlay`'s body is `Panel(autoScroll: "y") → LabeledGrid`. A `Button` does not belong inside `LabeledGrid`'s row list: every row in that grid is a labelled metric, the row-explanations plan wires a hover tooltip onto exactly that pattern, and a navigation action is neither. The button is a second child of the body `Panel`, added directly after the grid, so it renders as a footer action below the thirteen metric rows and scrolls with them — no new container, no change to `LabeledGrid`.

### No periodic auto-refresh

`StyleAuditPanel.refresh()` today runs once at construction and once per click of its own "Refresh" button — never on a timer. `StyleAuditView` keeps that: it computes once when constructed and again only on an explicit "Refresh" click, the same as the source panel. `StyleAuditOverlay.open()` mirrors `DiagnosticsOverlay.open()`'s idempotency exactly — it builds and audits once, and a second `open()` while already open only raises the window.[^no-auto-refresh]

### `styleRuleEntries()` reuses `COMPONENT_CLASS`, not a re-declared literal

`StyleAuditPanel.ts` today re-declares `COMPONENT_MARKER_CLASS = "ts-ui-component"` as its own local constant. The library already exports this exact string as `COMPONENT_CLASS` from [`core/ClassStyleRules.ts:26`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L26) — `Component.ts:25` imports it the same way. The extracted `StyleAudit.ts` imports the shared constant instead of re-declaring it, removing one of the two places this marker string could drift apart.

---

## Public API

### `core/DOM.ts`

```typescript
interface DOMSource {
    /**
     * Returns a materialised style rule's full CSS text (selector plus
     * declaration body), e.g. `"#a3f2.pressed { color: red; }"`.
     *
     * @param rule - A `CSSStyleRule` obtained from `StyleTarget`'s rule cache.
     * @returns The rule's `cssText`. Empty string when no selector engine is
     *   available (the modelled source — matches `countElements()`'s stance).
     */
    getRuleCssText(rule: CSSStyleRule): string;
}
```

### `core/StyleTarget.ts`

```typescript
export interface StyleRuleEntry {
    /** The cached selector — the `_ruleCache` map key. */
    selector: string;
    /** The rule's full CSS text (selector + declaration body). */
    cssText:  string;
}

/**
 * Snapshots every currently-materialised rule in the module cache as its
 * selector and full CSS text — the per-rule detail `styleRuleCounts()`
 * intentionally does not expose. Feeds the diagnostics style-audit view.
 */
export function styleRuleEntries(): StyleRuleEntry[];
```

Exported from `core/index.ts` alongside the existing `StyleTarget` exports.

### `diagnostics/StyleAudit.ts` — new

```typescript
export interface StyleAuditSummary {
    totalRules:         number;
    totalSizeKB:        string;
    componentRuleCount: number;
    uniqueBodyCount:    number;
    wastedKB:           string;
}

export interface DuplicateRuleRow {
    count:     number;
    wastedKB:  string;
    component: string;
    scope:     string;
    body:      string;
}

export interface StyleAuditResult {
    summary:    StyleAuditSummary;
    duplicates: DuplicateRuleRow[];
}

/**
 * Audits the framework's shared stylesheet for per-instance (`#id`-scoped)
 * rules whose declaration body duplicates another instance's. Ranks the
 * worst offenders by bytes wasted, capped to the top 25.
 */
export function auditStyleRules(): StyleAuditResult;
```

### `diagnostics/StyleAuditView.ts` — new

```typescript
class StyleAuditView extends Panel {
    constructor();
}
```

`callable()`-wrapped, following the same pattern as every other public `lib/` component (e.g. [`LabeledGrid`](packages/lib/src/typescript/lib/component/container/LabeledGrid.ts#L261)).

### `diagnostics/StyleAuditOverlay.ts` — new

```typescript
export class StyleAuditOverlay extends Window {
    private constructor();

    static open(): void;
    static close(): void;
    static toggle(): void;
    static isOpen(): boolean;
}
```

Not `callable()`-wrapped — same documented exemption as `DiagnosticsOverlay` (private constructor, static-only surface).

### `diagnostics/DiagnosticsOverlay.ts` — modified

No signature changes. One new private field (`_styleAuditButton: Button`) and one new bound handler field (`_boundOnOpenStyleAudit: () => void`), both internal.

---

## Internal Structure

### `styleRuleEntries()`

Placed immediately after `styleRuleCounts()` ([`StyleTarget.ts:282`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L282)):

```typescript
export function styleRuleEntries(): StyleRuleEntry[] {
    const entries: StyleRuleEntry[] = [];

    for (const [selector, rule] of _ruleCache) {
        entries.push({ selector, cssText: DOM.source.getRuleCssText(rule) });
    }

    return entries;
}
```

### `DOM.source.getRuleCssText()`

Production ([`DOM.ts:2400`](packages/lib/src/typescript/lib/core/DOM.ts#L2400), immediately after `countElements()`):

```typescript
/** @inheritDoc */
getRuleCssText(rule: CSSStyleRule): string {
    return rule.cssText;
}
```

Modelled ([`TestDOM.ts:1194`](packages/lib/tests/dom/TestDOM.ts#L1194), immediately after `countElements()`):

```typescript
/** No live stylesheet offline; nothing to read. */
getRuleCssText(_rule: CSSStyleRule): string {
    return '';
}
```

### `StyleAudit.ts` — ported logic

`formatKB`, `classifySelector`, and the `componentNameForSelector` matching logic move verbatim (pure string operations, no DOM access). Two functions change to route through the seam:

```typescript
function buildComponentIndex(): Map<string, string> {
    const index = new Map<string, string>();

    for (const handle of DOM.source.querySelectorAll(DOM.source.getBody(), `.${COMPONENT_CLASS}`)) {
        const id = DOM.source.getId(handle);
        if (!id) continue;

        const classAttr = DOM.source.getAttribute(handle, "class") ?? "";
        const name = classAttr.split(/\s+/).find((cls) => cls !== "" && cls !== COMPONENT_CLASS);

        if (name) {
            index.set("#" + DOM.source.escapeSelector(id), name);
        }
    }

    return index;
}

export function auditStyleRules(): StyleAuditResult {
    const componentIndex = buildComponentIndex();
    const entries        = styleRuleEntries();

    let totalBytes         = 0;
    let componentRuleCount = 0;

    const bodies = new Map<string, { count: number; scope: string; componentNames: Set<string> }>();

    for (const entry of entries) {
        totalBytes += entry.cssText.length;

        if (!entry.selector.startsWith("#")) {
            continue;
        }

        componentRuleCount++;

        const body          = entry.cssText.slice(entry.cssText.indexOf("{"));
        const scope          = classifySelector(entry.selector);
        const componentName  = componentNameForSelector(entry.selector, componentIndex);
        const existing       = bodies.get(body);

        if (existing) {
            existing.count++;
            if (componentName) existing.componentNames.add(componentName);
        } else {
            const componentNames = new Set<string>();
            if (componentName) componentNames.add(componentName);
            bodies.set(body, { count: 1, scope, componentNames });
        }
    }

    // dupeStats build + sort + slice(0, MAX_ROWS) + map to DuplicateRuleRow:
    // unchanged from StyleAuditPanel.auditBaseStylesheet — see that function
    // for the exact loop. wastedBytes and totalWastedBytes are computed the
    // same way, over `bodies` instead of the old DOM-scanned map.

    return {
        summary: {
            totalRules: entries.length,
            totalSizeKB: formatKB(totalBytes),
            componentRuleCount,
            uniqueBodyCount: bodies.size,
            wastedKB: formatKB(totalWastedBytes),
        },
        duplicates,
    };
}
```

No `!sheet` guard is needed: `_ruleCache` is always a `Map`, never absent, unlike `document.getElementById("Base")`.

`totalRules` / `totalSizeKB` no longer include `@keyframes` blocks. The original DOM scan counted every rule on the `#Base` sheet, including ones inserted by `DOM.sink.ensureKeyframes()` ([`DOM.ts:1654`](packages/lib/src/typescript/lib/core/DOM.ts#L1654)) — a `CSSKeyframesRule`, not a `CSSStyleRule`, and never added to `_ruleCache`. `styleRuleEntries()` only ever sees cache entries, so a page with keyframes now reports a slightly smaller `totalRules` than before, and that number now agrees with `styleRuleCounts().total`, which was already cache-based. This is a deliberate, small behaviour change: both numbers describing "how many style rules are on the shared sheet" now mean the same thing.[^keyframes-delta]

### `StyleAuditView`'s tree

```
StyleAuditView (Panel, VBox{spacing: 8})
├─ Text(audit explanation — moved verbatim from StyleAuditPanel)
├─ Button("Refresh")
├─ Text (summary line)
└─ Table(MemoryStore, spec)   { weight: 1 }
```

No `autoScroll` on `StyleAuditView` itself — whichever container embeds it owns scrolling, the same relationship `DiagnosticsOverlay`'s body `Panel` already has with its `LabeledGrid`. The demo tab's own `Panel` (`autoScroll: "auto"`) already provides this; `StyleAuditOverlay`'s body `Panel` provides it for the window.

The refresh button is wired via `button.on("action", this._boundRefresh)` with `private readonly _boundRefresh: () => void = () => this.refresh();` — a named field per [ARCHITECTURE.md](ARCHITECTURE.md)'s *"A component must not listen to another component's events through `Event`"* rule (a component wires its own children through their typed `on()` surface, not raw `Event.addListener`), and per the bound-field idiom `DiagnosticsOverlay._boundOnSample` already uses in the same directory.

### `StyleAuditOverlay`'s tree

```
StyleAuditOverlay (Window, header "Style Audit", 760 × 520 at 360,24)
└─ Panel { autoScroll: "y", layoutManager: VBox({ stretching: true }) }   placement: CENTER
   └─ StyleAuditView
```

`WINDOW_X = 360` sits to the right of `DiagnosticsOverlay`'s own window (`OVERLAY_X = 24`, `OVERLAY_WIDTH = 320`, so `24 + 320 = 344`), so the two windows do not fully overlap when both are open. `teardown()` clears the static instance slot only — unlike `DiagnosticsOverlay`, there is no sampler to stop.

### `DiagnosticsOverlay`'s new button

Added to the constructor, directly after the existing `body.addComponent(new LabeledGrid({ columns: 1, rows }));`:

```typescript
private readonly _styleAuditButton: Button = new Button("Show style audit");
private readonly _boundOnOpenStyleAudit: () => void = () => StyleAuditOverlay.open();

// ...in the constructor, after the LabeledGrid is added to `body`:
this._styleAuditButton.on("action", this._boundOnOpenStyleAudit);
body.addComponent(this._styleAuditButton);
```

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/core/DOM.ts`** — add `getRuleCssText(rule: CSSStyleRule): string;` to the `DOMSource` interface, immediately after `countElements()` ([:1230](packages/lib/src/typescript/lib/core/DOM.ts#L1230)). Implement in `ProductionDOMSource`, immediately after its `countElements()` ([:2400](packages/lib/src/typescript/lib/core/DOM.ts#L2400)), per *Internal Structure*.

2. **`packages/lib/tests/dom/TestDOM.ts`** — implement `getRuleCssText` in `ModelledDOMSource`, immediately after its `countElements()` ([:1194](packages/lib/tests/dom/TestDOM.ts#L1194)), per *Internal Structure*. Check: `npm run typecheck:test` — a missing implementation on either `DOMSource` implementer is a compile error.

3. **`packages/lib/src/typescript/lib/core/StyleTarget.ts`** — add `StyleRuleEntry` and `styleRuleEntries()` immediately after `styleRuleCounts()` ([:282](packages/lib/src/typescript/lib/core/StyleTarget.ts#L282)), per *Internal Structure*.

4. **`packages/lib/src/typescript/lib/core/index.ts`** — add `styleRuleEntries` to the existing `export { StyleTarget, StyleRule, InlineStyle, styleRuleCounts }` line ([:43](packages/lib/src/typescript/lib/core/index.ts#L43)), and `StyleRuleEntry` to the existing `export type { StyleRuleScope, StyleRuleSpec, StyleRuleCounts }` line ([:44](packages/lib/src/typescript/lib/core/index.ts#L44)).

5. **Create `packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts`.** Import `COMPONENT_CLASS` from `~/core/ClassStyleRules.js`, `DOM` from `~/core/DOM.js`, `styleRuleEntries` from `~/core/StyleTarget.js`. Port `formatKB`, `classifySelector`, `componentNameForSelector`, `MAX_ROWS` from [`StyleAuditPanel.ts`](packages/lib/src/typescript/StyleAuditPanel.ts) unchanged. Write `buildComponentIndex()` and `auditStyleRules()` per *Internal Structure*, including the `dupeStats` build/sort/slice/map block, ported unchanged from `StyleAuditPanel.auditBaseStylesheet()`. Check: `grep -n 'document\.' packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts` — expect zero matches.

6. **Create `packages/lib/src/typescript/lib/diagnostics/StyleAuditView.ts`.** A `Panel` subclass per *Internal Structure*'s tree. Constructor: `super({ layoutManager: new VBox({ spacing: 8 }) })`, then add the explanation `Text` (copy the exact string from `StyleAuditPanel.ts`'s constructor, the one starting "Scans the framework's shared #Base stylesheet…"), the refresh `Button` wired via the bound-field idiom, the summary `Text`, and the `Table` + `MemoryStore` + `Model` + `ColumnSpec` — ported unchanged from `StyleAuditPanel.ts` (same field list, same column widths). Call `this.refresh()` once at the end of the constructor. `refresh()` calls `auditStyleRules()` and writes the summary text + `_store.loadData(duplicates)`, same shape as `StyleAuditPanel.refresh()` today. Wrap with `callable()` and export both names, per *Public API*.

7. **Create `packages/lib/src/typescript/lib/diagnostics/StyleAuditOverlay.ts`.** Copy `DiagnosticsOverlay.ts`'s structure: private constructor calling `super("Style Audit")`, `setX(360) / setY(24) / setWidth(760) / setHeight(520)`, a body `Panel({ autoScroll: "y", layoutManager: new VBox({ stretching: true }) })` holding one `new StyleAuditView()`, added with `{ placement: Placement.CENTER }`. `open()` / `close()` / `toggle()` / `isOpen()` / `teardown()` / `onExitAction()` / `destructor()` exactly as `DiagnosticsOverlay.ts`'s, minus the sampler calls (there is no sampler). Carry the `callable()`-exemption comment, reworded.

8. **`packages/lib/src/typescript/lib/diagnostics/index.ts`** — add:
   ```typescript
   export { StyleAuditOverlay } from '~/diagnostics/StyleAuditOverlay.js';
   export { StyleAuditView } from '~/diagnostics/StyleAuditView.js';
   export { auditStyleRules } from '~/diagnostics/StyleAudit.js';
   export type { StyleAuditSummary, DuplicateRuleRow, StyleAuditResult } from '~/diagnostics/StyleAudit.js';
   ```
   No subpath-registry changes are needed — `@jimka/typescript-ui/diagnostics` already resolves to this barrel.

9. **`packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts`** — add `import { Button } from "~/component/button/Button.js";` and `import { StyleAuditOverlay } from "~/diagnostics/StyleAuditOverlay.js";`. Add the two new fields and the two wiring/append lines from *Internal Structure*, directly after the existing `body.addComponent(new LabeledGrid({ columns: 1, rows }));` line.

10. **`packages/lib/src/typescript/StyleAuditPanel.ts`** — remove `auditBaseStylesheet`, `buildComponentIndex`, `componentNameForSelector`, `componentClassName`, `classifySelector`, `formatKB`, `MAX_ROWS`, `COMPONENT_MARKER_CLASS`, the `DuplicateRuleRow` / `StyleAuditSummary` interfaces, the `_summary` field, the `_store` field, the `refresh()` method, the explanation `Text`, the refresh `Button`, and the `Table` + `Model` + `MemoryStore` construction. In their place, after the `styleGroupDemoRow` block, add `this.addComponent(new StyleAuditView());`. Remove the now-unused imports (`Event`, `MemoryStore`, `Model`, `Table`, `ColumnSpec`) and add `import { StyleAuditView } from '@jimka/typescript-ui/diagnostics';`. Update the class doc comment to say it wraps `StyleAuditView`. Check: `npm run typecheck` — no unused-import errors.

11. **Tests:**
    - `packages/lib/tests/dom/getRuleCssText.test.ts` (new, `@vitest-environment jsdom`) — cases 3-4, following `packages/lib/tests/dom/countElements.test.ts`'s `ProductionDOMSource` / `ModelledDOMSource` structure.
    - `packages/lib/tests/core/StyleTarget.test.ts` (modify) — add a `describe('styleRuleEntries', …)` block beside the existing `styleRuleCounts` one, covering cases 1-2.
    - `packages/lib/tests/diagnostics/StyleAudit.test.ts` (new, `@vitest-environment jsdom`) — cases 5-9, constructing real `StyleRule`s (and, for case 6, real elements with `class="ts-ui-component <Name>"` and a matching `id`) against a real `document`, following `packages/lib/tests/dom/style-rule-index.test.ts`'s shape.
    - `packages/lib/tests/diagnostics/StyleAuditView.test.ts` (new, `@vitest-environment jsdom`) — cases 10-12.
    - `packages/lib/tests/diagnostics/StyleAuditOverlay.test.ts` (new) — cases 13-18, reusing `DiagnosticsOverlay.test.ts`'s `CONFIG` / `currentInstance()` / `afterEach` shape.
    - `packages/lib/tests/diagnostics/DiagnosticsOverlay.test.ts` (modify) — add case 19.

12. **Documentation** — the four changes in *Documentation Impact*: the new `StyleAuditOverlay.md` page, the `DiagnosticsOverlay.md` addition, the `pages.ts` registration, the `manifest.data.mjs` row, and the `next.md` entries.

13. Run the full *Verification* list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Modify | `packages/lib/src/typescript/lib/core/StyleTarget.ts` |
| Modify | `packages/lib/src/typescript/lib/core/index.ts` |
| Create | `packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts` |
| Create | `packages/lib/src/typescript/lib/diagnostics/StyleAuditView.ts` |
| Create | `packages/lib/src/typescript/lib/diagnostics/StyleAuditOverlay.ts` |
| Modify | `packages/lib/src/typescript/lib/diagnostics/index.ts` |
| Modify | `packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts` |
| Modify | `packages/lib/src/typescript/StyleAuditPanel.ts` |
| Create | `packages/lib/tests/dom/getRuleCssText.test.ts` |
| Modify | `packages/lib/tests/core/StyleTarget.test.ts` |
| Create | `packages/lib/tests/diagnostics/StyleAudit.test.ts` |
| Create | `packages/lib/tests/diagnostics/StyleAuditView.test.ts` |
| Create | `packages/lib/tests/diagnostics/StyleAuditOverlay.test.ts` |
| Modify | `packages/lib/tests/diagnostics/DiagnosticsOverlay.test.ts` |
| Create | `packages/lib/docs/components/StyleAuditOverlay.md` |
| Modify | `packages/lib/docs/components/DiagnosticsOverlay.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/scripts/llms/manifest.data.mjs` |
| Modify | `packages/lib/llms.txt` (regenerated, not hand-edited) |
| Modify | `packages/docs/src/content/pages.ts` |

---

## Expected Behaviour

### `styleRuleEntries()` / `getRuleCssText()` — unit-testable

1. **Empty cache returns an empty array.** After `Diagnostics`-style reset of the module (no rules materialised), `styleRuleEntries()` returns `[]`.
2. **One entry per cached selector.** Materialising three distinct `StyleRule`s leaves `styleRuleEntries().length === 3`, each `selector` matching one of the three cache keys.
3. **`getRuleCssText` returns `''` under the modelled source.**
4. **`getRuleCssText` returns real `cssText` under `ProductionDOMSource`** (`@vitest-environment jsdom`, mirroring `countElements.test.ts`): a rule with declarations set via `setMany` reads back a `cssText` containing the selector and the declaration text.

### `auditStyleRules()` — jsdom-only (needs real `cssText`)

5. **Two `#id` rules with byte-identical declaration bodies produce one duplicate row with `count: 2`.**
6. **A component whose live element carries `class="ts-ui-component Button"` and an id matching a cached `#id` rule's selector resolves `component: "Button"` for that rule's duplicate row.** An unmatched selector (no live element with that id) resolves `component: "—"`.
7. **`totalRules` equals `styleRuleEntries().length`, not the raw stylesheet's `cssRules.length`** — a rule materialised via `ensureKeyframes` is absent from both.
8. **Duplicates are sorted by wasted bytes descending, capped to 25 rows,** even when more than 25 duplicate bodies exist.
9. **A selector not starting with `#` (a `.class` or verbatim rule) is excluded from `componentRuleCount` and from dedup grouping**, but its `cssText.length` still contributes to `totalSizeKB`.

### `StyleAuditView` — unit-testable, `@vitest-environment jsdom`

10. **Constructing `StyleAuditView` runs one audit immediately** — the summary `Text` is non-empty right after construction, with no click needed.
11. **Clicking Refresh re-runs the audit** — `_store`'s row count reflects a change in the underlying rule cache made between construction and the click (add a `StyleRule` after construction, click Refresh, assert the new duplicate appears if applicable).
12. **Disposing a `StyleAuditView` leaves no stylesheet rules from its own `Button`/`Table` chrome behind** — same assertion shape as `tests/overlay/Notification.styleRuleDisposal.test.ts`.

### `StyleAuditOverlay` — unit-testable except the rendered table

13. **`open()` is idempotent** — two calls leave exactly one window in `AbstractWindow.getOpenWindows()` matching the overlay.
14. **`isOpen()` tracks the lifecycle** — `false` initially, `true` after `open()`, `false` immediately after `close()`.
15. **`toggle()` alternates** between the two states.
16. **Open-then-close leaks no stylesheet rules** — same assertion shape as `DiagnosticsOverlay`'s equivalent case (`plans/implemented/debug-diagnostics-overlay.md`, case 24).
17. **A direct `dispose()` on the instance also clears the static slot**, so a following `open()` builds a fresh window.
18. **Opening `StyleAuditOverlay` does not close or otherwise affect an already-open `DiagnosticsOverlay`, and vice versa** — the two windows are independent `LayerManager` roots.

### `DiagnosticsOverlay`'s new button — unit-testable

19. **Clicking "Show style audit" calls `StyleAuditOverlay.open()`.** Assert via `StyleAuditOverlay.isOpen()` before and after a simulated click on the button.

### Manual verification

20. **Both windows can be open and dragged independently.** `npm run dev`, `localhost:8015`, **Misc.** tab → click *Show diagnostics overlay* → in the window that opens, click *Show style audit* → both windows are now open; drag each and confirm the other is unaffected.
21. **The demo app's own "Style Audit" tab and the new window show the same summary numbers and the same duplicate rows** when opened back to back with nothing else changed in between.
22. **The rendered table's column widths and row content are visually correct** inside the 760×520 window (not clipped, not overflowing awkwardly).

---

## Verification

- `npm --workspace packages/lib run typecheck` and `npm --workspace packages/lib run typecheck:test` — both clean.
- `npm --workspace packages/lib run lint` — clean. `grep -rn 'document\.' packages/lib/src/typescript/lib/diagnostics/` — expect zero matches.
- `npm --workspace packages/lib test` — the new/modified test files plus the existing suite green.
- `npm --workspace packages/lib run build:lib` — `dist/lib/diagnostics.es.js` still builds (same subpath, larger bundle).
- `npm --workspace packages/lib run docs:api` — zero warnings.
- `npm --workspace packages/lib run docs:llms` — regenerates `llms.txt`; commit the diff.
- **Manual smoke test** — cases 20-22 above.

---

## Documentation Impact

- **New page `packages/lib/docs/components/StyleAuditOverlay.md`**, following the shape of `docs/components/DiagnosticsOverlay.md`: what it shows (duplicate `#id` rules by wasted bytes), how it relates to `DiagnosticsOverlay`'s own "Stylesheet rules" row (same `_ruleCache`, different granularity), the `open()`/`close()`/`toggle()`/`isOpen()` surface, and a note that it is a manual snapshot with a Refresh button, not a live sampler. Register it in `packages/docs/src/content/pages.ts`, in the `componentsCore` list, after the `DiagnosticsOverlay` entry ([:170](packages/docs/src/content/pages.ts#L170)).
- **`packages/lib/docs/components/DiagnosticsOverlay.md`** — add one sentence to the *API surface* section noting the "Show style audit" button and linking `/components/StyleAuditOverlay`.
- **`packages/lib/scripts/llms/manifest.data.mjs`** — one new row in the *Overlays* group, after the `DiagnosticsOverlay` row ([:117](packages/lib/scripts/llms/manifest.data.mjs#L117)): `{ task: "Stylesheet duplicate-rule audit window (per-instance rule dedup by wasted bytes)", symbol: "StyleAuditOverlay" }`.
- **`packages/lib/docs/reference/changelog/next.md`** — an `## Added` entry under `### Components` for `StyleAuditOverlay` (mirroring the existing `DiagnosticsOverlay` entry's shape), and a `## Breaking changes` → `### Core` bullet: `DOMSource` gains one required member, `getRuleCssText()`, affecting only a consumer implementing its own `DOMSource` — same shape as the existing `countElements()` bullet there.

---

## Potential Challenges

- **The audit window counts itself.** Its own `Button`, `Table`, and row components add `#id` rules to the very cache it audits, so opening it and clicking Refresh includes its own chrome in the results. Mitigation: none needed — this is correct, not a bug; the doc page states it, matching how `DiagnosticsOverlay.md` already states the equivalent for its own numbers.
- **Opening the window is a real layout burst.** Constructing a `Table` row per duplicate (up to 25) while `DiagnosticsOverlay` is also open will show a momentary spike in `DiagnosticsOverlay`'s own *Layout flush* row. Mitigation: document it as expected activity, not a regression — the overlay's own doc page already frames spikes this way.
- **`auditStyleRules()`'s dedup math is only meaningful under a real `cssText`.** The modelled `getRuleCssText()` returns `''` offline, so every cached rule collapses into one degenerate "duplicate" group in an offline test. Mitigation: cases 5-9 require `@vitest-environment jsdom`, per *Expected Behaviour* — same constraint `countElements()` and `styleRuleCounts()`'s own precedent tests already work under.
- **`StyleAuditPanel.ts` loses several now-unused imports.** `Event`, `MemoryStore`, `Model`, `Table`, `ColumnSpec` are only used by the code being removed. Mitigation: step 10 explicitly lists them; `npm run typecheck` fails loudly on an unused import left behind.

---

## Critical Files

| File | Why the implementer must read it |
|---|---|
| [`packages/lib/src/typescript/StyleAuditPanel.ts`](packages/lib/src/typescript/StyleAuditPanel.ts) | Every function and the full component tree being ported — read it in full before starting step 5. |
| [`packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts`](packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts) | **The precedent** for the static-singleton `Window`, the bound-field event idiom, and the exact spot the new button is added. |
| [`packages/lib/src/typescript/lib/diagnostics/DiagnosticsSampler.ts`](packages/lib/src/typescript/lib/diagnostics/DiagnosticsSampler.ts) | The precedent for splitting pure computation from the `Window` that renders it. |
| [`packages/lib/src/typescript/lib/core/StyleTarget.ts:184-282`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L184) | `_ruleCache` and `styleRuleCounts()` — what `styleRuleEntries()` sits beside and must not disturb. |
| [`packages/lib/src/typescript/lib/core/DOM.ts:1219-1230`](packages/lib/src/typescript/lib/core/DOM.ts#L1219), [`:2394-2402`](packages/lib/src/typescript/lib/core/DOM.ts#L2394) | `querySelectorAll`, `countElements` — the seam members `getRuleCssText` sits beside and the exact "offline degrades gracefully" precedent it follows. |
| [`packages/lib/scripts/eslint/no-raw-dom.js`](packages/lib/scripts/eslint/no-raw-dom.js) | Why `CSSStyleRule` member access (not just `document`) is flagged outside `core/DOM.ts` — the reason `getRuleCssText` exists at all. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) *"A component must not listen to another component's events through `Event`"* | Why the Refresh button and the new `DiagnosticsOverlay` button are wired via `on("action", …)`, never `Event.addListener(button, …)`. |
| [`packages/lib/src/typescript/MiscPanel.ts:236-240`](packages/lib/src/typescript/MiscPanel.ts#L236) | The precedent for a demo file wiring a button to a library `Window`'s static `open()` rather than containing its logic. |
| [`packages/lib/tests/dom/countElements.test.ts`](packages/lib/tests/dom/countElements.test.ts), [`packages/lib/tests/dom/style-rule-index.test.ts`](packages/lib/tests/dom/style-rule-index.test.ts) | The `@vitest-environment jsdom` + `ProductionDOMSource`/`ModelledDOMSource` test shape `getRuleCssText.test.ts` and `StyleAudit.test.ts` follow. |
| [`packages/lib/tests/diagnostics/DiagnosticsOverlay.test.ts`](packages/lib/tests/diagnostics/DiagnosticsOverlay.test.ts) | `CONFIG`, `currentInstance()`, and the `afterEach` teardown that `StyleAuditOverlay.test.ts` and the new button case reuse. |
| [`plans/implemented/debug-diagnostics-overlay.md`](plans/implemented/debug-diagnostics-overlay.md) | The overlay's own design reasoning (singleton shape, seam rules, rule-leak test shape) this plan follows throughout. |
| [`plans/diagnostics-overlay-row-explanations.md`](plans/diagnostics-overlay-row-explanations.md) | Confirms the metric-row tooltip wiring this plan's button deliberately stays out of — read before touching `DiagnosticsOverlay.ts`'s row list or `LabeledGrid`. |

---

## Non-Goals

- **A periodic auto-refresh for the style audit.** The source panel never had one; see *No periodic auto-refresh*.
- **Removing or restructuring the "Shared Instance Style Groups" demo section.** It is demo scaffolding, not audit logic, and stays in `StyleAuditPanel.ts` unchanged.
- **Redesigning `_ruleCache`, `styleRuleCounts()`, or any part of `StyleTarget`'s existing rule-lifecycle contract.** `styleRuleEntries()` is a second, additive reader.
- **A doc page for `StyleAuditView` or `auditStyleRules()` separate from `StyleAuditOverlay.md`.** `DiagnosticsSampler` and `readFrameworkCounts()` get the same treatment — folded into the window's own page, not a page apiece.
- **A keyboard shortcut for the new window.** Same reasoning `DiagnosticsOverlay.md`'s *Notes* section already gives for its own `toggle()`.
- **Making `StyleAuditView`'s `MAX_ROWS` or column widths configurable.** Not requested; the source panel hard-codes both today.
- **Reconciling the previous plan's "Retiring StyleAuditPanel" non-goal.** `plans/implemented/debug-diagnostics-overlay.md` decided *not* to retire `StyleAuditPanel` — that panel still exists and still shows the audit after this plan; only its internal implementation moves. This plan does not contradict that decision.[^non-retirement]

---

## Notes

[^scaffolding-split]: Read against `StyleAuditPanel.ts` line by line: the `Header("Stylesheet Dedup Audit")` title, the audit's explanation `Text`, the Refresh `Button`, the summary `Text`, and the `Table`/`MemoryStore`/`Model` are all either the audit's own output or the controls that drive it — view logic. The `Header("Shared Instance Style Groups")`, its explanation `Text`, and the eight-button `styleGroupDemoRow` exist solely to manufacture the grouped-vs-ungrouped rules the audit then displays — a fixture for the demo, not part of what "auditing the stylesheet" means. Removing them would remove the audit's only interesting input in a fresh page load; keeping them out of the library keeps the library from shipping demo fixtures.

[^miscpanel-precedent]: `MiscPanel.ts:236-240` constructs one `Button`, wires its `"action"` to `DiagnosticsOverlay.open()`, and contains no diagnostics logic at all — the overlay's entire tree and behaviour live in `lib/diagnostics/`. `StyleAuditPanel.ts` cannot follow that shape exactly, because unlike `MiscPanel`, its tab is expected to keep showing the audit results inline (that expectation is untouched scope — see *Non-Goals*), not just a button that opens a window. The parallel this plan draws is narrower: `MiscPanel.ts` demonstrates that a demo file's job is to *wire to* library logic, not *contain* it — which is exactly what `StyleAuditPanel.ts` does after extraction, via one `new StyleAuditView()` line instead of the audit's implementation.

[^rule-cache-not-cssom]: The DOM scan and the cache should already agree — every rule on the shared `#Base` stylesheet is inserted through `DOM.sink.ensureStyleRule()` ([`DOM.ts:1596`](packages/lib/src/typescript/lib/core/DOM.ts#L1596)), which is also what populates `_ruleCache` (via `_ruleFor`). Reading the cache instead of re-scanning the sheet removes a second, independent way of arriving at the same set of rules, which is one fewer thing that can silently disagree — see *`totalRules` / `totalSizeKB` no longer include `@keyframes` blocks* in *Internal Structure* for the one case where they already didn't.

[^getrulecsstext-source-not-sink]: `setRuleStyles` / `ensureStyleRule` / `deleteStyleRule` all live on `DOMSink`, because each either writes a rule's declarations or inserts/removes one. `getRuleCssText` only reads an already-materialised rule's text, so it follows the read/write split the seam already uses elsewhere (`getViewportRect`, `getId`, `getAttribute`, `countElements`, all reads, all on `DOMSource`) rather than joining the `CSSStyleRule`-typed methods on `DOMSink` by receiver type alone.

[^component-index-seam]: `querySelectorAll(root, selector)`, `getId(handle)`, `getAttribute(handle, key)`, and `escapeSelector(value)` already exist on `DOMSource` ([`DOM.ts:1219`](packages/lib/src/typescript/lib/core/DOM.ts#L1219), [`:1373`](packages/lib/src/typescript/lib/core/DOM.ts#L1373), [`:1408`](packages/lib/src/typescript/lib/core/DOM.ts#L1408), [`:975`](packages/lib/src/typescript/lib/core/DOM.ts#L975)) and are used elsewhere in `lib/` (e.g. `Dialog.ts`'s focus-trap queries). `DOM.source.getBody()` ([`:1308`](packages/lib/src/typescript/lib/core/DOM.ts#L1308)) returns the `<body>` handle directly — `Body.getElement()` is defined as exactly this call, so using it directly avoids an unneeded `Body` import. Every rendered component, including `Window` overlays, is a DOM descendant of `<body>` (nothing legitimately renders outside it), so this root has the same reach as `document.querySelectorAll(".ts-ui-component")` did.

[^no-auto-refresh]: A `DiagnosticsSampler`-style 2 Hz timer was considered and rejected. The audit scans every cached rule, string-compares declaration bodies, and sorts — real work, unlike `DiagnosticsOverlay`'s thirteen `setText` calls — and running it unconditionally every half second while the window is open would itself perturb `DiagnosticsOverlay`'s own *Layout flush* row when both are open, the exact kind of self-measurement distortion `plans/implemented/debug-diagnostics-overlay.md` deliberately designed around (`## Architecture Decisions` → *Layout time is measured once per flush, never per component*). A duplicate-rule audit is also not the kind of number that benefits from sub-second liveness the way FPS or heap does — it is inspected after a deliberate action ("switch tabs to populate more components, then refresh"), which the existing manual Refresh button already serves.

[^keyframes-delta]: Confirmed by reading `DOM.ts` for every path that mutates the `#Base` stylesheet: `ensureStyleRule` (tracked in `_ruleCache`) and `ensureKeyframes` (not tracked — a `CSSKeyframesRule`, which the original `auditBaseStylesheet()` already excluded from `componentRuleCount` and dedup grouping via its `!selector` guard, but still counted toward `totalRules`/`totalSizeKB` since that guard ran after the byte-count line). No other call site inserts into `#Base`.

[^non-retirement]: The prior plan's non-goal was about *removing* `StyleAuditPanel.ts` or dropping the stylesheet-dedup audit from the demo app — neither happens here. `StyleAuditPanel.ts` still exists, is still registered as the "Style Audit" tab, and still shows the same audit; only where its computation and rendering live changes.
