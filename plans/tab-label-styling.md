---
touches-shared:
  - packages/lib/src/typescript/lib/component/input/Text.ts
  - packages/lib/src/typescript/lib/component/button/Button.ts
  - packages/lib/src/typescript/lib/component/container/TabBar.ts
  - packages/lib/src/typescript/lib/layout/Tab.ts
---

# Per-tab label italics — Implementation Plan

## Overview

`Tab` can relabel a live tab ([`Tab.setTabName`](packages/lib/src/typescript/lib/layout/Tab.ts#L1228)) and re-icon one ([`Tab.setTabGlyph`](packages/lib/src/typescript/lib/layout/Tab.ts#L1254)), but nothing styles the label itself. A consumer that wants VS Code's preview-tab treatment — the label in italics, nothing else changed — has no API to reach for, because `Tab` keeps its [`TabBar`](packages/lib/src/typescript/lib/layout/Tab.ts#L312) and the per-tab `TabButton`s private.

This plan adds an italic toggle at each of the three layers the existing glyph pair already runs through: `Tab.setTabItalic(content, italic)` → `TabBar.setEntryItalic(id, italic)` → `Button.setFontStyle(value)`, each with a matching read. `Button.setFontStyle` is the one genuinely new mechanism — a forwarder onto the button's private title label, mirroring the existing [`Button.setTextAlign`](packages/lib/src/typescript/lib/component/button/Button.ts#L1221). No `TabButton` change is needed at all.

One existing method is repaired on the way: [`Text.setFontStyle`](packages/lib/src/typescript/lib/component/input/Text.ts#L1086) writes the CSS but does not invalidate the cached text measurement, so an italicised label would keep its upright width and clip.[^measure-gap] Its sibling font setters — `setFontFamily`, `setFontWeight`, `setFontSize` — already do.

---

## Architecture Decisions

### Three-layer delegation, mirroring `setTabGlyph` / `setEntryGlyph`

`Tab.setTabItalic` resolves the tab by content component and delegates to a new `TabBar.setEntryItalic`, which resolves the cell by its owner-minted id and writes to that cell's `TabButton`. That is the shape [`Tab.setTabGlyph`](packages/lib/src/typescript/lib/layout/Tab.ts#L1254) / [`TabBar.setEntryGlyph`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1489) already establish for "change one visual aspect of a built tab after construction", including the return conventions: `boolean` found/not-found at the `Tab` layer, chainable `this` at the `TabBar` layer.

### A boolean `italic` toggle, not a font-style string or a class hook

`setTabItalic(content, italic: boolean)` / `setEntryItalic(id, italic: boolean)` take a boolean, and the CSS value is derived one layer lower.[^why-boolean] The table below maps each call to what it writes and what the two reads then report. Two framework facts drive its first and third rows: every button label already inherits a shared class-level rule declaring `font-style: normal`, and a per-instance write whose value matches that shared rule is flushed as a removal rather than a duplicate declaration.

| Call | Written to the label | `Button.getFontStyle()` | `TabBar.isEntryItalic(id)` |
|---|---|---|---|
| *(fresh tab, no call)* | nothing — the shared class rule already says `normal` | `"normal"` | `false` |
| `setEntryItalic(id, true)` | `font-style: italic` on the label's `#id` rule | `"italic"` | `true` |
| `setEntryItalic(id, false)` | `"normal"`, which flushes as a removal of the `#id` declaration | `"normal"` | `false` |
| `setEntryItalic("unknown", true)` | nothing — unknown id is a no-op | *n/a* | `false` |

### The label's own `Text` is the only cache

None of the six new methods keeps state. `Button.setFontStyle` writes through the label's inherited `Text.setFontStyle`, whose `writeStyle` caches the value in the label's own instance style layer; every read walks back down the same path. So no `fontStyle` field is added to `ButtonOptions`, no `italic` field to `BarEntry`, and no backing field to `Button`, `TabBar`, or `Tab`.[^no-new-cache]

### View-only: no `LayoutConstraints` field, no serialization

The italic flag lives on the live tab button only. Unlike `setTabGlyph`, which writes back to `LayoutConstraints.glyph`, nothing here is captured in a saved layout, and a tear-off or re-dock rebuilds the tab button upright.[^view-only] `Tab.setTabName` is the in-tree precedent for a view-only per-tab setter.

### `Text.setFontStyle` gains the measurement invalidation its siblings have

`Text.setFontStyle` gets the same two lines [`Text.setFontWeight`](packages/lib/src/typescript/lib/component/input/Text.ts#L1130) ends with — mark the measurement stale, then schedule a layout on the parent. The measurement probe already passes `fontStyle` through ([`Text.measureOptions`](packages/lib/src/typescript/lib/component/input/Text.ts#L602)), so nothing else has to change for an italic run to measure at its real width.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/input/Text.ts — modified body, unchanged signature
setFontStyle(value: string): this;
```

```typescript
// packages/lib/src/typescript/lib/component/button/Button.ts — new
setFontStyle(value: string): this;
getFontStyle(): string | null;
```

```typescript
// packages/lib/src/typescript/lib/component/container/TabBar.ts — new
setEntryItalic(id: string, italic: boolean): this;
isEntryItalic(id: string): boolean;
```

```typescript
// packages/lib/src/typescript/lib/layout/Tab.ts — new
setTabItalic(content: Component, italic: boolean): boolean;
isTabItalic(content: Component): boolean;
```

No new options-bag field, no new backing field, and no new export: all four classes are already exported from their entry points.

---

## Implementation

`Button.setFontStyle` / `getFontStyle`, guarded on `this._text` exactly as `setTextAlign` and `setWritingMode` are, because [`Button._text`](packages/lib/src/typescript/lib/component/button/Button.ts#L431) does not exist until after `super()` returns:

```typescript
setFontStyle(value: string): this {
    if (this._text) {
        this._text.setFontStyle(value);
        this.recomputePreferredSize();
    }

    return this;
}

getFontStyle(): string | null {
    return this._text ? this._text.getFontStyle() : null;
}
```

`TabBar.setEntryItalic` / `isEntryItalic`, mirroring `setEntryGlyph`'s resolve-then-mutate and `isEntryBusy`'s read-through:

```typescript
setEntryItalic(id: string, italic: boolean): this {
    const entry = this.entryById(id);

    if (entry) {
        entry.button.setFontStyle(italic ? "italic" : "normal");
        this.scheduleLayout();
    }

    return this;
}

isEntryItalic(id: string): boolean {
    return this.entryById(id)?.button.getFontStyle() === "italic";
}
```

`Tab.setTabItalic` / `isTabItalic`, mirroring `setTabName`'s delegation and `isTabBusy`'s read:

```typescript
setTabItalic(content: Component, italic: boolean): boolean {
    const entry = this._contents.find(e => e.component === content);

    if (!entry) {
        return false;
    }

    this._bar.setEntryItalic(entry.id, italic);
    this.getContainer()?.scheduleLayout();

    return true;
}

isTabItalic(content: Component): boolean {
    const entry = this._contents.find(e => e.component === content);

    return entry ? this._bar.isEntryItalic(entry.id) : false;
}
```

---

## Ordered Implementation Steps

Tests come first only where a red is actually observable. `npm run test` runs `typecheck:test` before vitest, so a test naming a method that does not exist yet fails as a type error rather than a failed assertion — for each of the six new methods, write the method and its test together.[^test-first]

1. **`packages/lib/tests/component/TextBatchMeasure.test.ts`** — append a new `describe('Text — font-style re-measure', …)` block after the existing `describe` (which closes at line 247), reusing that file's `installCountingMeasureSource` helper ([line 43](packages/lib/tests/component/TextBatchMeasure.test.ts#L43)) and modelled on its case 7 ([line 169](packages/lib/tests/component/TextBatchMeasure.test.ts#L169)). Three cases, covering rows 1-3 of `## Expected Behaviour`: (a) build two `Text`s, measure them once so both are clean, install the counter, call `setFontStyle('italic')` on one and `setFontStyle('oblique')` on the other, then `getPreferredSize()` on the first — expect one batch call whose requests carry `fontStyle` `['italic', 'oblique']`; (b) a `Text` inside a `Container` (import it from `~/core/Container`) laid out clean reports `isLayoutDirty()` `false`, and `true` after `setFontStyle('italic')`; (c) `getFontStyle()` is `'normal'` on an untouched `Text` and `'italic'` after the call.
   *Check:* from `packages/lib`, `npx vitest run tests/component/TextBatchMeasure.test.ts` — cases (a) and (b) fail (an empty `batchCalls`, a still-clean container), because nothing re-stales the measurement or schedules the layout; case (c) passes already, since the CSS write was never the missing part. Every pre-existing case still passes.
2. **`packages/lib/src/typescript/lib/component/input/Text.ts`** — in `setFontStyle` ([line 1086](packages/lib/src/typescript/lib/component/input/Text.ts#L1086)), after the `writeStyle` call, add `this._measurementDirty = true;` and `(this.getParentComponent() ?? this).scheduleLayout();`, copying `setFontWeight`'s body ([line 1130](packages/lib/src/typescript/lib/component/input/Text.ts#L1130)) verbatim. Change the JSDoc summary line to *"Sets the CSS font-style, updates the rule, and recalculates preferred size."*, matching `setFontFamily`'s and `setFontWeight`'s wording. Leave the `@param` / `@returns` lines as they are.
   *Check:* step 1's cases (a) and (b) now pass. `grep -n -A 6 'setFontStyle(value: string)' packages/lib/src/typescript/lib/component/input/Text.ts` shows both new lines.
3. **`packages/lib/src/typescript/lib/component/button/Button.ts`** — insert `setFontStyle` and `getFontStyle` (bodies in `## Implementation`) between `clearWritingMode`'s closing brace ([line 1299](packages/lib/src/typescript/lib/component/button/Button.ts#L1299)) and `setDescription`'s JSDoc ([line 1301](packages/lib/src/typescript/lib/component/button/Button.ts#L1301)). Document that both address the **title label only**, not the optional description subtitle, and that the label is a `Text` — written as a Markdown link to `/api/component/input/classes/Text`, the way `setTextAlign`'s JSDoc does, never a `{@link}` to the internal label class.[^no-internal-link]
4. **`packages/lib/tests/component/button/Button.test.ts`** — add a `describe('Button label font style', …)` block between the existing `describe('Button text', …)`'s close ([line 78](packages/lib/tests/component/button/Button.test.ts#L78)) and `describe('Button glyph', …)` ([line 80](packages/lib/tests/component/button/Button.test.ts#L80)), covering rows 5-6 of `## Expected Behaviour`: `setFontStyle('italic')` then `getFontStyle()` is `'italic'`, `setFontStyle('normal')` returns it to `'normal'`, and `setFontStyle` returns the button itself.
   *Check:* from `packages/lib`, `npx vitest run tests/component/button/Button.test.ts`.
5. **`packages/lib/tests/component/default-options-fallback.test.ts`** — add one row to the `DEFAULT_RESOLUTION` array ([line 277](packages/lib/tests/component/default-options-fallback.test.ts#L277)), directly after the existing `Button _text fontWeight` row ([line 302](packages/lib/tests/component/default-options-fallback.test.ts#L302)): `{ label: 'Button fontStyle', resolve: () => new Button().getFontStyle(), expected: 'normal' }`. This is row 4 of `## Expected Behaviour` — it pins that the new public getter resolves `Text`'s class-tier default rather than `null`.
   *Check:* from `packages/lib`, `npx vitest run tests/component/default-options-fallback.test.ts`.
6. **`packages/lib/src/typescript/lib/component/container/TabBar.ts`** — insert `setEntryItalic` and `isEntryItalic` (bodies in `## Implementation`) between `getEntryGlyph`'s closing brace ([line 1534](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1534)) and `setEntryContentId`'s JSDoc ([line 1536](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1536)). Give `setEntryItalic` the same view-only `@remarks` shape `setEntryGlyph` carries, pointing at `Tab.setTabItalic` as the owner-facing entry point.
7. **`packages/lib/tests/component/container/TabBar.test.ts`** — add cases to the entry-glyph `describe` that already holds the numbered glyph cases (cases 7-14, around [line 271](packages/lib/tests/component/container/TabBar.test.ts#L271)), using that file's existing `barEntries` / `closeable()` / `glyphed()` helpers, and covering rows 7-12 of `## Expected Behaviour`: (a) `isEntryItalic('a')` is `false` before any call, `true` after `setEntryItalic('a', true)`, and `false` again after `setEntryItalic('a', false)`; (b) `setEntryItalic` on an unknown id returns the bar and `isEntryItalic('nope')` is `false`; (c) italicising the active entry leaves it active and selected; (d) italicising a closeable entry leaves its `getCloseButton()` instance identical; (e) `removeBarEntry` returns `isEntryItalic` to `false`; (f) a busy entry stays busy across `setEntryItalic`, and an italic entry stays italic across `setEntryBusy` and `setEntryGlyph`.
   *Check:* from `packages/lib`, `npx vitest run tests/component/container/TabBar.test.ts`.
8. **`packages/lib/src/typescript/lib/layout/Tab.ts`** — insert `setTabItalic` and `isTabItalic` (bodies in `## Implementation`) between `applyTabGlyph`'s closing brace ([line 1311](packages/lib/src/typescript/lib/layout/Tab.ts#L1311)) and `setTabBusy`'s JSDoc ([line 1313](packages/lib/src/typescript/lib/layout/Tab.ts#L1313)), so the label-facing methods stay grouped ahead of the busy pair. `setTabItalic`'s JSDoc states two things: the same lazy-tab limitation `setTabGlyph`'s `@remarks` states (a tab whose factory has not run has no content component to key on, so it returns `false`; `TabBar.setEntryItalic` reaches such a cell by id), and that the flag is view-only — it is not written to the tab's `LayoutConstraints`, so it does not survive a tear-off, a re-dock, or a saved layout.
9. **`packages/lib/tests/layout/Tab.tabItalic.test.ts`** *(new)* — copy `packages/lib/tests/layout/Tab.tabGlyph.test.ts`'s scaffolding (`CONFIG`, `hostTab`, `barEntries`, the `afterEach` teardown minus the two `Glyph.unregister` calls, which are only needed by the glyph cases) and cover rows 13-18 of `## Expected Behaviour`, one `it` per row.
   *Check:* from `packages/lib`, `npx vitest run tests/layout/Tab.tabItalic.test.ts`.
10. **`packages/lib/src/typescript/TabDemoPanel.ts`** — add a `const toggleItalicBtn = new Button("Toggle Italic");` plus `toolbar.addComponent(toggleItalicBtn);` immediately after the existing `toggleBusyBtn` pair ([line 51](packages/lib/src/typescript/TabDemoPanel.ts#L51)), and wire it beside that button's handler ([line 323](packages/lib/src/typescript/TabDemoPanel.ts#L323)) as the exact analogue: read `getActiveContent()`, and when non-null call `setTabItalic(content, !isTabItalic(content))`. This is the surface the manual rows in `## Expected Behaviour` use.
11. **Documentation** — the four file edits in `## Documentation Impact`.
12. **Whole-repo checks** — `npm run typecheck`, `npm run test`, `npm run lint`, `npm run docs:api` (must finish with zero warnings). Then `grep -rn 'setEntryItalic\|setTabItalic\|isEntryItalic\|isTabItalic' packages/lib/src packages/lib/tests packages/lib/docs` and confirm every hit is one this plan asked for — no stray spelling variant such as `setTabLabelItalic`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/Text.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Tab.ts` |
| Modify | `packages/lib/src/typescript/TabDemoPanel.ts` |
| Create | `packages/lib/tests/layout/Tab.tabItalic.test.ts` |
| Modify | `packages/lib/tests/component/container/TabBar.test.ts` |
| Modify | `packages/lib/tests/component/button/Button.test.ts` |
| Modify | `packages/lib/tests/component/TextBatchMeasure.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/layouts/Tab.md` |
| Modify | `packages/lib/docs/components/TabBar.md` |
| Modify | `packages/lib/docs/components/Button.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Unit-testable — `Text`:

1. `setFontStyle('italic')` on an already-measured `Text` re-stales its measurement: the next `getPreferredSize()` issues a fresh probe, and that probe's options carry `fontStyle: 'italic'`.
2. `setFontStyle` schedules a layout on the `Text`'s parent (its own, when it has no parent) — the same effect `setFontWeight` has.
3. `getFontStyle()` returns `'italic'` after the call, `'normal'` on an untouched `Text`.

Unit-testable — `Button`:

4. `new Button().getFontStyle()` is `'normal'`, resolved from the class tier, not `null`.
5. `button.setFontStyle('italic')` then `getFontStyle()` is `'italic'`; `setFontStyle('normal')` returns it to `'normal'`.
6. `setFontStyle` returns the button, for chaining.

Unit-testable — `TabBar`:

7. `setEntryItalic(id, true)` makes `isEntryItalic(id)` `true`; `setEntryItalic(id, false)` makes it `false` again.
8. `setEntryItalic` on an unknown id is a no-op, returns the bar, and `isEntryItalic` on that id is `false`.
9. `isEntryItalic` is `false` for a cell that was never italicised, and `false` again after `removeBarEntry`.
10. Italicising the active cell leaves it active (`getActiveEntryId()` unchanged) and its button selected.
11. Italicising a closeable cell leaves its `getCloseButton()` instance identical — the button is mutated, not rebuilt.
12. A busy cell stays busy across `setEntryItalic`, and an italic cell stays italic across both `setEntryBusy` and `setEntryGlyph` — the per-cell busy, glyph and italic flags are independent.

Unit-testable — `Tab`:

13. `setTabItalic(content, true)` returns `true` for a tab-hosted content component, and `isTabItalic(content)` is then `true`.
14. `setTabItalic(content, false)` returns `true` and `isTabItalic(content)` returns to `false`.
15. `setTabItalic` on a component that was never added returns `false`, `isTabItalic` on it is `false`, and no existing tab changes.
16. `setTabItalic` marks the owning container's layout dirty (`host.isLayoutDirty()` is `true` afterward), matching case 6 of `Tab.tabGlyph.test.ts`.
17. `setTabItalic` leaves the tab's `LayoutConstraints` untouched — for a tab added with no constraints, `getLayoutConstraints(content)` is still `undefined` afterward. This is the deliberate difference from `setTabGlyph`.
18. `setTabName` after `setTabItalic` keeps the tab italic: the relabel writes text, not style.

Manual verification — the demo panel's *Toggle Italic* button (the offline test harness models one font metrics table for every font style, so no test can observe an italic width or the rendered slant):

19. The active tab's label renders slanted, and nothing else about the tab changes — same fill, same leading glyph, same close ✕, same position.
20. The tab does not clip its label: set the demo's width-mode combo to `"content"`, so each tab is sized to its own label, and the italicised tab grows to fit the slanted run.
21. Toggling off restores an upright label with no leftover slant.
22. Italics survive a strip re-layout — resize the window, and toggle *Toggle Compact* and the orientation controls, all of which re-run the per-pass button styling.
23. Both themes render the slant identically (no theme token is involved).

---

## Verification

- `npm run typecheck` and `npm run test` from the repo root — the latter runs `typecheck:test` plus the whole vitest suite.
- `npm run lint` — no new findings, and no baseline change (nothing here touches raw DOM or places children).
- `npm run docs:api` — must finish with zero warnings; a `{@link}` to the internal label class is the one way this step can fail.
- Single-file runs while iterating, from `packages/lib`: `npx vitest run tests/layout/Tab.tabItalic.test.ts`, `npx vitest run tests/component/container/TabBar.test.ts`, `npx vitest run tests/component/button/Button.test.ts`, `npx vitest run tests/component/TextBatchMeasure.test.ts`, `npx vitest run tests/component/default-options-fallback.test.ts`.
- Manual: `npm run dev`, open the **Tab** demo panel, add two or three tabs, and walk rows 19-23 above with *Toggle Italic*.

---

## Documentation Impact

- **`packages/lib/docs/layouts/Tab.md`** — extend the *Renaming and re-iconing a tab* section (its prose starts at [line 76](packages/lib/docs/layouts/Tab.md#L76)) with a paragraph and snippet for `setTabItalic(content, italic)` / `isTabItalic(content)`, and rename the heading to *Renaming, re-iconing and italicising a tab*. State plainly that the italic flag is view-only — it is not a constraint, so a tear-off, a re-dock, or a restored layout brings the tab back upright — which is the opposite of the sentence already there about `setTabGlyph`. Add no row to the *Per-child constraints* table: no constraint is added.
- **`packages/lib/docs/components/TabBar.md`** — add one row to the *Cell lifecycle* table, directly under the `setEntryGlyph` row ([line 62](packages/lib/docs/components/TabBar.md#L62)): `` | `setEntryItalic(id, italic)` / `isEntryItalic(id)` | Italicise a cell's label (VS Code-style preview tab), or read the flag back. View-only, like `setEntryGlyph`. | ``.
- **`packages/lib/docs/components/Button.md`** — add one bullet to `## Notes`, beside the existing *"`setText(text)` updates the label"* bullet ([line 187](packages/lib/docs/components/Button.md#L187)): `setFontStyle(value)` / `getFontStyle()` style the title label only, not the description subtitle.
- **`packages/lib/docs/reference/changelog/next.md`** — three bullets, each appended to a section that already exists:
  - `## Added` › `### Components`, after the existing `TabBar` glyph bullet ([line 97](packages/lib/docs/reference/changelog/next.md#L97)) — `TabBar.setEntryItalic(id, italic)` / `isEntryItalic(id)`, and `Button.setFontStyle(value)` / `getFontStyle()` as the label-level mechanism they run through.
  - `## Added` › `### Layouts`, after the existing `Tab.setTabGlyph` bullet ([line 117](packages/lib/docs/reference/changelog/next.md#L117)) — `Tab.setTabItalic(content, italic)` / `isTabItalic(content)`, stating that the flag is view-only where `setTabGlyph` persists.
  - `## Fixed` › `### Components` ([line 198](packages/lib/docs/reference/changelog/next.md#L198)) — `Text.setFontStyle` now re-measures the text and re-lays out its parent, so a label switched to italics no longer keeps its upright width and clip. No consumer action is needed.
- No page is added, so `packages/docs/src/content/pages.ts` needs no edit — `/layouts/Tab` and the `TabBar` page are already registered.
- `packages/lib/llms.txt` is generated (`npm run docs:llms`) and indexes components, not methods — do not hand-edit it.

---

## Potential Challenges

- **The per-layout button styling pass could have clobbered the instance write.** [`TabBar.applyTabButtonStyles`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2447) re-applies insets, writing mode and text-align to every tab button on each pass; it touches no font property, so an instance `font-style` survives. Manual row 22 checks this rather than assuming it.
- **Toggling off must remove the declaration, not merely re-state it.** `setEntryItalic(id, false)` writes `"normal"`, which equals the label's class-tier value; the style flush queues an explicit removal for a key that matches the class tier, so the `#id` declaration goes away instead of lingering. Rows 5, 7 and 21 pin the result at three layers.
- **A lazy tab has no content component**, so `setTabItalic` returns `false` for one whose factory has not run. `TabBar.setEntryItalic` addresses such a cell by id — the same escape hatch `setEntryGlyph` documents. Row 15 covers only the never-added case; the lazy case is documented, not tested, matching how `Tab.tabGlyph.test.ts` handles it.
- **`Button.getFontStyle()` on a partly-built button.** `_text` is assigned in the constructor body, so both new methods guard on it, as `setTextAlign` and `setWritingMode` already do; the getter returns `null` in that window, which is why row 4 asserts `'normal'` on a fully-constructed button rather than trusting the guard.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/Tab.ts`](packages/lib/src/typescript/lib/layout/Tab.ts) — `setTabName` (1228), `setTabGlyph` (1254), `applyTabGlyph` (1286), `setTabBusy` (1325), `isTabBusy` (1344). The precedent pair and the insertion point.
- [`packages/lib/src/typescript/lib/component/container/TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts) — `BarEntry` (196), `setEntryName` (1460), `setEntryGlyph` (1489), `getEntryGlyph` (1532), `setEntryBusy` (1568), `isEntryBusy` (1581), `entryById` (1604), `applyTabButtonStyles` (2447).
- [`packages/lib/src/typescript/lib/component/button/Button.ts`](packages/lib/src/typescript/lib/component/button/Button.ts) — `ButtonLabelText` (300), `_text` (431), `setWritingMode` (1182), `setTextAlign` (1221), `clearWritingMode` (1280), `recomputePreferredSize` (2351).
- [`packages/lib/src/typescript/lib/component/input/Text.ts`](packages/lib/src/typescript/lib/component/input/Text.ts) — `ownClassStyleDefaults` (126), `measureOptions` (602), `setFontFamily` (938), `setFontStyle` (1086), `setFontWeight` (1130).
- [`packages/lib/tests/layout/Tab.tabGlyph.test.ts`](packages/lib/tests/layout/Tab.tabGlyph.test.ts) — the scaffolding the new `Tab` test copies.
- [`packages/lib/tests/component/TextBatchMeasure.test.ts`](packages/lib/tests/component/TextBatchMeasure.test.ts) — `installCountingMeasureSource` (43) and case 7 (169), the model for the re-measure test.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *All attributes and styles go through typed setters* and *Three non-negotiable rules for every DOM write*, which the no-new-cache decision answers to.
- [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md) — *Don't `{@link}` internal symbols from public JSDoc*, which step 3's JSDoc must respect.

---

## Non-Goals

- **A general label-styling surface on `Tab` or `TabBar`** — no font weight, size, colour, or free-form CSS class per tab. Italics is the one treatment the use case needs, and each extra knob would need its own read-back and its own layer of translation.
- **Persisting the flag** — no `LayoutConstraints` field, no `LayoutNode` field, no capture/restore in `LayoutSerialization.ts`.
- **A construction-time option** — no `fontStyle` on `ButtonOptions`. `Button.setFontStyle` is runtime-only, exactly like `setTextAlign`.
- **Touching the glyph or tab-name APIs** — `setTabGlyph`, `clearTabGlyph`, `setTabName`, `setEntryGlyph`, `clearEntryGlyph` and `setEntryName` keep their current signatures and behaviour.
- **`Text.setFontStretch` / `setFontVariant`** — both also affect measured width and also skip the invalidation, so both carry the same latent staleness. Neither is on this plan's path; leave them, and mention them when reporting the work.
- **The consumer-side switch** — replacing Loom's `~` label prefix with a `setTabItalic` call is a change in that repo, made once this API ships.
- **A `TabButton`-level italic method** — the label belongs to `Button`, and `TabBar` calls `Button.setFontStyle` on the `TabButton` it holds. `TabButton.ts` is not edited.

---

## Notes

[^measure-gap]: `Text` caches its measured natural size and re-probes only when `_measurementDirty` is set or the theme's text-metrics generation moves on. `setFontFamily` ([Text.ts:938](packages/lib/src/typescript/lib/component/input/Text.ts#L938)), `setFontWeight` ([Text.ts:1130](packages/lib/src/typescript/lib/component/input/Text.ts#L1130)), `setFontSize` and `setLineHeight` each set that flag; `setFontStyle` writes the CSS and stops. So italicising an already-measured label would leave the tab sized for the upright run — narrower or wider than the slanted one, depending on the face — and the strip would clip or over-reserve. The probe itself needs no change: `measureOptions` ([Text.ts:602](packages/lib/src/typescript/lib/component/input/Text.ts#L602)) already sends `fontStyle: this.getFontStyle()`, so the value was being collected and simply never re-read.

[^why-boolean]: A pass-through `setEntryFontStyle(id, style: string)` would mirror `setEntryGlyph`'s value-flows-through shape more literally, and was the other candidate. It was rejected on two counts. It would need a `clearEntryFontStyle` / `clearTabFontStyle` pair to get back to the resting style, and `Text` has no `clearFontStyle` to build that on, so the change would grow a fourth new method at the `Text` layer for a case nobody has. And the `Tab` / `TabBar` per-cell surface already speaks in booleans and semantic names, not CSS: `setEntryBusy` / `isEntryBusy`, `isEntryCloseable`, `setSelected`. A boolean toggle with the CSS derived one layer down is what that surface looks like. A tab-level enum or free-form class-name hook was rejected for the same reason plus scope: the known requirement is one treatment, and `CLAUDE.md`'s *Simplicity First* rules out configurability nobody asked for.

[^no-new-cache]: `ARCHITECTURE.md`'s second non-negotiable rule for DOM writes — always cache in memory, never re-read the DOM — is satisfied by delegation rather than by a new field. `Text.setFontStyle` routes through `writeStyle`, which stores the authored value in the instance style layer; `Text.getFontStyle` reads it back through `resolveFontValue`, which walks the instance layer and then the class layer. That walk is why an untouched button reports `'normal'`: `Text`'s own class defaults declare `fontStyle: "normal"`, which `Button`'s label class inherits. Adding a `BarEntry.italic` field or a `ButtonOptions.fontStyle` entry would create a second copy of a value the label already holds correctly, with nothing to keep the two in step. The third rule — expose consumer-configurable properties on the options bag — is met the same way `setTextAlign` meets it: `ButtonOptions` carries no `textAlign` either, because the tab strip drives that setter at runtime and no caller sets it at construction. A consumer building their own label still gets `fontStyle` at construction through `TextOptions`.

[^view-only]: Persisting the flag would mean a new `LayoutConstraints` field, a new `LayoutNode` field in `LayoutSerialization.ts`, capture and restore wiring on both sides, and a read in `TabBar.createBarEntry` — a much larger surface than the label-style mechanism this plan is scoped to. It would also be wrong for the use case. A preview tab is transient app state: the app decides, per session, which tab is the recycled preview, and VS Code's own treatment promotes a preview tab to a permanent one the moment it is dragged elsewhere. A restored layout that resurrected a stale italic flag would be a bug, not a feature. `Tab.setTabName` already behaves this way, so a view-only per-tab setter is not a new idea in this class — and `TabBar.setEntryGlyph`'s own `@remarks` describes exactly this "live button only, not the constraint" property for the bar-level half of the glyph pair.

[^test-first]: The `implement` skill works test-first, and step 1 is a real red-green: `Text.setFontStyle` already exists, so a test for its missing invalidation compiles and fails on the assertion. The six new methods cannot produce that kind of red — `npm run test` runs `typecheck:test` first, so a test calling a method that does not exist fails to compile, which tells the implementer nothing about behaviour. Hence the pairing in steps 3-9: add the method, then its test, then run the file.

[^no-internal-link]: `Button`'s label is an internal class, not exported and not in the API docs, so a `{@link}` to it from a public method's JSDoc makes `npm run docs:api` emit a *"links to X which was resolved but is not included in the documentation"* warning — the failure `CODE_CONVENTIONS.md`'s *Don't `{@link}` internal symbols from public JSDoc* rule exists to prevent. `setTextAlign`'s JSDoc shows the way around it: link the public `Text` page with a Markdown link and describe the label in prose.
