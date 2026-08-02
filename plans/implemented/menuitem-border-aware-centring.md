# Border-aware label centring for `MenuItem` — Implementation Plan

## Overview

A bordered `MenuItem` clips its own labels. `MenuItem.doLayout` was already made
content-box correct ([packages/lib/src/typescript/lib/component/container/MenuItem.ts:476](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L476)),
but the labels still overrun, because the constructor pins them to the wrong
number. Each of the four labels is centred with
`centerInHeight(MenuItem.HEIGHT)` ([MenuItem.ts:229](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L229),
[:236](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L236),
[:245](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L245),
[:256](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L256)).
`MenuItem.HEIGHT` is the item's **outer** height, and `centerInHeight` pins the
label's *minimum* height to whatever it is given, so a label refuses to shrink
into the smaller content box a border leaves and `overflow: hidden` cuts it.

This plan changes what the labels are pinned to — the item's **content** height,
`MenuItem.HEIGHT` less that item's own vertical chrome — and re-derives it when
the border changes, mirroring what `TextField` already does for its one-line
box ([TextField.ts:93](packages/lib/src/typescript/lib/component/input/TextField.ts#L93)).
It touches `MenuItem`, the `local/require-content-bounds` lint rule and its
baseline, the Content Box demo panel, and the offline containment suite. No new
exported symbols; the two overridden methods keep their inherited signatures.

---

## Architecture Decisions

### The re-derivation hangs on a `setBorder` override

`MenuItem` gets a `setBorder` override that calls `super.setBorder(...)` and
then re-pins the four labels, exactly as `TextField.setBorder` re-derives its
one-line box ([TextField.ts:93-114](packages/lib/src/typescript/lib/component/input/TextField.ts#L93)).
A `clearBorder` override does the same, so removing a border is not a one-way
door.[^seam]

### The labels are pinned to `MenuItem.HEIGHT` minus the item's own vertical chrome

`updateLabelHeights()` computes `MenuItem.HEIGHT - perimeter.top -
perimeter.bottom` from `this.getPerimeterSize()` — the framework's own
"insets + border + padding per side" accessor
([Component.ts:3068](packages/lib/src/typescript/lib/core/Component.ts#L3068)) —
and hands that to `centerInHeight` on each label. That is the same content
height `doLayout` already assigns via `getContentBounds()`, so the pin and the
placement agree.[^chrome]

| Item chrome | Content height | `centerInHeight` gets | Label height after `doLayout` |
|---|---|---|---|
| none (today's menus) | 24 | 24 | 24 — unchanged |
| `2px` border | 20 | 20 | 20 (today: 24, overruns by 4) |
| `4px` border (demo panel) | 16 | 16 | 16 (today: 24, overruns by 8) |
| `2px` border + `2px` vertical padding | 16 | 16 | 16 |

### `MenuItem.HEIGHT` stays the item's own preferred height

The constant keeps meaning "one menu row is 24 pixels tall, outside edge to
outside edge". A bordered item stays 24 tall and gives its labels less; it does
not grow to 24 + border.[^height-constant] Every reader of the constant:

| Site | Reads it as | Change |
|---|---|---|
| [MenuItem.ts:202](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L202) `setHeight` | outer height | none |
| [MenuItem.ts:203](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L203) `setPreferredSize` | outer height | none |
| [Menu.ts:537](packages/lib/src/typescript/lib/overlay/Menu.ts#L537) `items.length * HEIGHT + 8` | outer height per row | none |
| [MenuItem.ts:229/236/245/256](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L229) `centerInHeight` | *content* height — wrong | replaced by `updateLabelHeights()` |
| [ContentBoxPanel.ts:195](packages/lib/src/typescript/ContentBoxPanel.ts#L195) demo comment + `preferredSize.height: 24` | outer height | comment reworded |

### `getPerimeterSize` joins the lint rule's border-aware reads

`local/require-content-bounds` excuses a method that reads `getContentBounds()`
or `getBorderSize()` on its own receiver
([require-content-bounds.js:110](packages/lib/scripts/eslint/require-content-bounds.js#L110)).
`getPerimeterSize()` is added to that set: it is defined as insets + border +
padding and cannot be computed without the border, so it proves the same
awareness.[^lint-set]

---

## Internal Structure

New private method and the two overrides on `MenuItem`. `BorderOptions` is
imported from `~/primitive/Border.js`.

```typescript
/**
 * Re-pins the four labels' line boxes to the item's CONTENT height —
 * `MenuItem.HEIGHT` less this item's own vertical chrome. `centerInHeight`
 * pins a label's minimum height as well as its line box, so a label pinned to
 * the outer height cannot shrink into a bordered item's content box and is
 * clipped. Called from the constructor tail and whenever the border changes.
 */
private updateLabelHeights(): void {
    const perimeter = this.getPerimeterSize();
    // Floor of 1: chrome at or past the row height leaves nothing to centre
    // in, and a zero or negative line-height is not a value CSS should see.
    // The label clips in that case either way — the floor only keeps the
    // written value sane.
    const height = Math.max(1, MenuItem.HEIGHT - perimeter.top - perimeter.bottom);

    // Optional chaining, not null checks: a separator has none of these, and a
    // border arriving through the options bag could in principle reach here
    // before the field initializers have run.
    this._iconText?.centerInHeight(height);
    this._titleText?.centerInHeight(height);
    this._shortcutText?.centerInHeight(height);
    this._chevronText?.centerInHeight(height);
}
```

```typescript
setBorder(options: BorderOptions | string): this {
    super.setBorder(options);
    this.updateLabelHeights();

    return this;
}

clearBorder(): this {
    super.clearBorder();
    this.updateLabelHeights();

    return this;
}
```

Constructor tail, replacing [MenuItem.ts:300-302](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L300):

```typescript
if (options) {
    this.applyOptions(options);
}

this.updateLabelHeights();
```

The tail call is unconditional and comes last. An options bag carrying a border
already re-pins through the `setBorder` override that `applyOptions` dispatches
([Component.ts:670](packages/lib/src/typescript/lib/core/Component.ts#L670)),
and the second call is a no-op because `Text.setLineHeight` returns early on an
unchanged numeric value ([Text.ts:1005](packages/lib/src/typescript/lib/component/input/Text.ts#L1005)).
The tail call is what covers an item with no options at all, and an item given
`insets` or `padding` but no border.[^tail]

---

## Ordered Implementation Steps

1. **Write the failing tests first** in
   [packages/lib/tests/component/content-box-containment.test.ts](packages/lib/tests/component/content-box-containment.test.ts),
   in a new `describe('MenuItem labels track the border', …)` block placed
   directly after the existing `overlays and menus` block (which ends at
   line 407). Cover every case in `## Expected Behaviour` marked *offline*.
   Follow the file's house style: detached components, `layOut(…)`, an explicit
   literal border, and literal expected geometry.
   → verify: `npx vitest run tests/component/content-box-containment.test.ts`
   inside `packages/lib` — the bordered cases fail, the borderless case passes.
2. **Add `updateLabelHeights()`** to
   [MenuItem.ts](packages/lib/src/typescript/lib/component/container/MenuItem.ts),
   placed just above `doLayout`. Import `BorderOptions` from
   `~/primitive/Border.js`.
3. **Delete the four `centerInHeight(MenuItem.HEIGHT)` calls** at
   [MenuItem.ts:229](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L229),
   [:236](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L236),
   [:245](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L245),
   and [:256](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L256).
   Add `this.updateLabelHeights();` after the tail `applyOptions` block.
   → verify: the constructor body contains no `centerInHeight` call.
4. **Add the `setBorder` and `clearBorder` overrides**, placed next to
   `updateLabelHeights`. Their JSDoc must describe the re-derivation in prose
   without `{@link}`-ing `updateLabelHeights` — it is private, and TypeDoc warns
   on a public symbol linking to an excluded one.
5. **Rewrite the stale comment** in `doLayout` at
   [MenuItem.ts:482-488](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L482).
   The "correcting that needs a border-change hook and is out of scope here"
   sentence is now false. Keep the first sentence (heights come from the content
   box, not the constant) and replace the rest with a pointer to
   `updateLabelHeights`.
   → verify: in `packages/lib/src/typescript/lib/component/container/MenuItem.ts`,
   `grep -c 'out of scope'` is zero and `grep -c 'centerInHeight'` is one — the
   call inside `updateLabelHeights`.
6. **Add `"getPerimeterSize"`** to `BORDER_AWARE_READS` at
   [require-content-bounds.js:110](packages/lib/scripts/eslint/require-content-bounds.js#L110)
   and extend that constant's JSDoc with one sentence saying why it belongs
   (insets + border + padding; it cannot be computed without the border).
7. **Add a `valid` case** to
   [require-content-bounds.test.mjs](packages/lib/scripts/eslint/require-content-bounds.test.mjs)
   for the new shape, with a comment naming `MenuItem.updateLabelHeights` as the
   real site:
   `"class C extends B { pin() { const p = this.getPerimeterSize(); this._label.centerInHeight(C.HEIGHT - p.top - p.bottom); } }"`
   → verify: `npm run test:lint` in `packages/lib`.
8. **Remove the baseline key** `"src/typescript/lib/component/container/MenuItem.ts:MenuItem.constructor"`
   from [require-content-bounds.baseline.json](packages/lib/scripts/eslint/require-content-bounds.baseline.json).
   → verify: `npm run lint` in `packages/lib` is clean, and
   `REQUIRE_CONTENT_BOUNDS_IGNORE_BASELINE=1 npx eslint src` reports the eleven
   remaining baselined sites with no `MenuItem` entry among them.
9. **Update the demo panel**
   [ContentBoxPanel.ts](packages/lib/src/typescript/ContentBoxPanel.ts):
   - Split `buildBaselinedRow()` ([:176](packages/lib/src/typescript/ContentBoxPanel.ts#L176))
     into two `FieldSet`s inside the same row — one titled `"Bordered menu
     item"` holding the `MenuItem`, one keeping the title `"Still on the
     baseline"` and holding only the notification trigger — and rename the
     method to `buildMenuAndNotificationRow()`, updating its call at
     [:167](packages/lib/src/typescript/ContentBoxPanel.ts#L167) and its JSDoc.
   - Reword the comment above the `MenuItem`
     ([:181-186](packages/lib/src/typescript/ContentBoxPanel.ts#L181)) from a
     description of the defect to a description of the check: a 4px border
     leaves a 16px content box, which is exactly the natural line box at the
     default font, so the label and shortcut must render whole.
   - Update `MENU_ITEM_BORDER`'s JSDoc ([:42-48](packages/lib/src/typescript/ContentBoxPanel.ts#L42)):
     keep 4px, and say it is the thickness at which the old defect took a
     visible bite, retained so the fix stays visible.
   - Update the intro `Text` ([:155-159](packages/lib/src/typescript/ContentBoxPanel.ts#L155)) —
     drop "the menu item's descenders are clipped on purpose".
   - Update the third-row paragraph of the class JSDoc
     ([:132-138](packages/lib/src/typescript/ContentBoxPanel.ts#L132)) — the row
     now holds one fixed case and one still-baselined case.
   → verify: `grep -n 'on purpose' packages/lib/src/typescript/ContentBoxPanel.ts`
   — zero matches; the phrase `Still on the baseline` survives only as the
   notification `FieldSet`'s title.
10. **Update the stale test comments** in
    [content-box-containment.test.ts:378-392](packages/lib/tests/component/content-box-containment.test.ts#L378).
    The "Vertical placement is deliberately not asserted" paragraph is now
    wrong; the new describe block asserts it. Keep the surviving reason the
    origin test exists (padding is the observable difference) and delete the
    out-of-scope paragraph.
11. **Add the changelog entry** under `## 0.4.0` → `### Fixed` in
    [packages/lib/docs/reference/changelog.md](packages/lib/docs/reference/changelog.md),
    immediately after the existing "Size hints that depend on a border are
    re-derived when it changes" entry at line 252, which it extends.
12. **Run the full verification set** in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/MenuItem.ts` |
| Modify | `packages/lib/scripts/eslint/require-content-bounds.js` |
| Modify | `packages/lib/scripts/eslint/require-content-bounds.test.mjs` |
| Modify | `packages/lib/scripts/eslint/require-content-bounds.baseline.json` |
| Modify | `packages/lib/src/typescript/ContentBoxPanel.ts` |
| Modify | `packages/lib/tests/component/content-box-containment.test.ts` |
| Modify | `packages/lib/docs/reference/changelog.md` |

---

## Blast Radius

`MenuItem` backs every menu surface in the framework, so the change has to be a
no-op wherever no border is set — which is everywhere in the shipped code. With
zero chrome the pin is `24 - 0 = 24`, byte-for-byte today's value.

Every site that constructs one:

| Site | Reaches the user as | Border set? | Re-check |
|---|---|---|---|
| [Menu.ts:920](packages/lib/src/typescript/lib/overlay/Menu.ts#L920) `buildPersistentItems` | `MenuBar`'s dropdown panels — the only persistent-mode `new Menu(items, onClose)` ([MenuBar.ts:184](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L184)) | no | open every menu in the **MenuBar** tab, including a submenu and a separator-bearing menu |
| [Menu.ts:293](packages/lib/src/typescript/lib/overlay/Menu.ts#L293) in `showAnchored` | every rebuild-mode `new Menu()` — `SplitButton`, `MenuButton`, `ToolBar`'s overflow menu, `TabBar`'s tab menu, `Table`'s column menu | no | right-click a tab in the **Tab** demo; open a `Table` column menu; open a `SplitButton` or `MenuButton` dropdown |
| [ContentBoxPanel.ts:187](packages/lib/src/typescript/ContentBoxPanel.ts#L187) | the **Content Box** demo | yes, `4px` | the before/after capture |
| Consumer code | `MenuItem` is exported through `callable()` from `component/container` | consumer's choice | covered by the offline cases |

Tests that construct one and must stay green:
[leaves.smoke.test.ts:98-128](packages/lib/tests/component/container/leaves.smoke.test.ts#L98),
[dispose-full-teardown.test.ts:93](packages/lib/tests/component/dispose-full-teardown.test.ts#L93),
[Menu.test.ts:179-180](packages/lib/tests/overlay/Menu.test.ts#L179) (which
measures title widths through `titleTextWidth()`, a width the line-height change
does not move),
[content-box-containment.test.ts:393](packages/lib/tests/component/content-box-containment.test.ts#L393).

Not touched: `MenuSeparator`, `MenuItem.SEPARATOR_HEIGHT`, and the separator
branch of the constructor, which builds no labels.

---

## Expected Behaviour

Every case below builds a detached `MenuItem` with `getElement(true)`, then uses
the suite's `layOut(item, 200, 24)` helper. `noop = () => {}`. Content-box
heights: no border 24, `2px` border 20, `2px` border + `Insets(2, 4, 2, 4)`
padding 16.

**Offline — the borderless case is unchanged.**
`new MenuItem({ text: 'File', shortcut: 'Ctrl+F' }, noop, noop)` laid out at
200×24: `_iconText`, `_titleText` and `_shortcutText` each report
`getY() === 0` and `getHeight() === 24`. These are today's numbers and must not
move.

**Offline — a runtime border shrinks the labels.** The same item, with
`item.setBorder('2px solid black')` called before `layOut`: `getBorderSize().left`
is 2, the content box is `{ x: 0, y: 0, width: 196, height: 20 }`, each of the
three labels reports `getHeight() === 20`, and
`expectChildrenInsideContentBox(item, item.getComponents())` passes. Today each
label reports 24 and overruns by 4.

**Offline — a border from the options bag shrinks them too.**
`new MenuItem({ text: 'File' }, noop, noop, 'menu-bar', { border: '2px solid black' })`
laid out at 200×24: `_titleText.getHeight() === 20`.

**Offline — the chevron is pinned like the rest.**
`new MenuItem({ text: 'More', submenu: { label: 'More', items: [] } }, noop, noop)`
with a `2px` border: `_chevronText.getHeight() === 20`.

**Offline — clearing the border restores 24.** Item with `setBorder('2px solid
black')`, then `clearBorder()`, then `layOut`: `_titleText.getHeight() === 24`.

**Offline — padding counts as chrome.**
`new MenuItem({ text: 'File' }, noop, noop, 'menu-bar', { padding: new Insets(2, 4, 2, 4), border: '2px solid black' })`
laid out at 200×24: content box height 16, `_titleText.getHeight() === 16`.

**Offline — a bordered separator has nothing to pin.**
`new MenuItem({ separator: true }, noop, noop, 'menu-bar', { border: '2px solid black' })`
constructs and reports `item.getComponents()` empty. A separator builds none of
the four labels, so `updateLabelHeights` runs against four null fields on both
the options-bag path and the constructor tail; an empty child list is the
assertion that says it ran and found nothing, rather than a bare
"did not throw".

**Offline — the existing origin assertion still holds.** The
`'MenuItem places its texts from the content-box origin'` case at
[content-box-containment.test.ts:393](packages/lib/tests/component/content-box-containment.test.ts#L393)
passes unchanged: it sets `Insets(0, 4, 0, 4)`, whose vertical terms are zero,
so the labels stay at 24 and only the x-origin is under test.

**Manual — the Content Box demo.** `npm run dev`, `http://localhost:8015`,
**Content Box** tab. Before the change the bordered `MenuItem`'s label
`"Paging, gapping"` has the descenders of `g`, `p` and `g` cut off by the frame.
After it, the label and the `Ctrl+G` shortcut render whole, vertically centred
inside the 4px frame. Capture both.

**Manual — no visible change anywhere a menu is unbordered.** In the **MenuBar**
tab, open each top-level menu: row height, label baseline, shortcut column,
chevron and icon positions must be pixel-identical to before. Open a submenu and
a separator-bearing menu. Then exercise one context menu (right-click a tab in
the **Tab** demo) and one dropdown (**SplitButton** or **MenuButton**) — all
unbordered, so all must be unchanged.

---

## Verification

Run from `packages/lib` unless stated.

- `npm run typecheck` and `npm run typecheck:test`.
- `npx vitest run tests/component/content-box-containment.test.ts` — the new
  block green.
- `npm test` — the whole suite, in particular
  `tests/component/container/leaves.smoke.test.ts`,
  `tests/overlay/Menu.test.ts`, and
  `tests/component/dispose-full-teardown.test.ts`, which all construct
  `MenuItem`s.
- `npm run lint` — clean.
- `REQUIRE_CONTENT_BOUNDS_IGNORE_BASELINE=1 npx eslint src` — eleven reports,
  none in `MenuItem.ts`.
- `npm run test:lint` — the rule suites, including the new valid case.
- `grep -c 'centerInHeight' src/typescript/lib/component/container/MenuItem.ts`
  — one.
- `npm run docs:api` — must finish with no new warnings over the current
  baseline (zero errors, one warning), since the two overrides carry public
  JSDoc.
- The two manual checks above.

---

## Documentation Impact

No exported symbol is added, removed, or renamed, so no doc page or catalog
entry changes. Two things still need updating:

- **The changelog** — `## 0.4.0` → `### Fixed`, immediately after the existing
  "Size hints that depend on a border are re-derived when it changes" entry at
  [changelog.md:252](packages/lib/docs/reference/changelog.md#L252). Say that a
  `MenuItem`'s labels are pinned to the item's content height rather than its
  outer height, that a bordered item therefore stops clipping them, and that an
  unbordered item — every menu the framework ships — is unchanged.
- **The two overrides' JSDoc**, per the point in step 4 about not linking a
  private symbol.

---

## Potential Challenges

- **The dev server may be serving another worktree.** A running server started
  from `.worktrees/<other>` serves that branch's code, and a worktree server
  resolves `@jimka/typescript-ui` through the alias table in its *own*
  `vite.config.ts`, which points at its own `src`. Check
  `readlink /proc/<pid>/cwd` before trusting what the browser shows, and start a
  second server on a spare port rather than killing the user's.
- **No `build:lib` is needed.** The demo app aliases every
  `@jimka/typescript-ui/*` subpath straight to `packages/lib/src`
  ([vite.config.ts:8-32](packages/lib/vite.config.ts#L8)), so the Content Box
  tab picks the change up from source.
- **`updateLabelHeights` now runs after the labels are added as children**,
  where today's `centerInHeight` calls run before. `Text.setLineHeight` ends with
  `(this.getParentComponent() ?? this).scheduleLayout()`
  ([Text.ts:1021](packages/lib/src/typescript/lib/component/input/Text.ts#L1021)),
  so the scheduled component changes from the label to the item. Both are
  detached and unrendered at that point, and `Menu` brackets item construction
  with `pauseLayout()` / `resumeLayout()`
  ([Menu.ts:912-925](packages/lib/src/typescript/lib/overlay/Menu.ts#L912)), so
  the queued pass is absorbed. If a stray relayout does surface, it will show as
  an extra layout in the Menu tests, not as a visual defect.
- **A single wrong sign flips the whole fix into a regression.** The pin is
  `HEIGHT - chrome`, not `HEIGHT + chrome`; adding would make every bordered
  item's labels *taller* and clip worse. The borderless expected-behaviour case
  cannot catch a sign error (chrome is 0), which is why the `2px` cases assert
  literal 20 rather than "less than 24".

---

## Critical Files

- [packages/lib/src/typescript/lib/component/input/TextField.ts](packages/lib/src/typescript/lib/component/input/TextField.ts) —
  the precedent. `updateHeight` (line 64) is the shared derivation; `setBorder`
  (line 93) is the re-derivation hook, and its `@remarks` explains what it
  deliberately leaves alone.
- [packages/lib/src/typescript/lib/component/input/Text.ts](packages/lib/src/typescript/lib/component/input/Text.ts) —
  `centerInHeight` (line 1042) delegates to `setLineHeight` (line 994);
  `calculateSize` (line 359) turns the line height into
  `_measuredMinSize.height`, and `getMinSize` (line 595) folds that into the
  hard minimum. This chain is why pinning to the outer height clips.
- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) —
  `getPerimeterSize` (line 3068), `getContentBounds` (line 2953), `setBorder`
  (line 2262), `clearBorder` (line 2243), and `applyChromeOptions` (line 664),
  which is what dispatches an options-bag border into the override.
- [packages/lib/src/typescript/lib/overlay/Menu.ts](packages/lib/src/typescript/lib/overlay/Menu.ts) —
  the only production constructor of `MenuItem` (`showAnchored`, line 293, and
  `buildPersistentItems`, line 920) and the owner of the shared column geometry
  (`layOutColumns`, line 199).
- [packages/lib/scripts/eslint/require-content-bounds.js](packages/lib/scripts/eslint/require-content-bounds.js) —
  the header comment states the rule's known gaps and its baseline policy;
  `BORDER_AWARE_READS` is at line 110.
- [packages/lib/tests/component/content-box-containment.test.ts](packages/lib/tests/component/content-box-containment.test.ts) —
  the house style for the new tests; the `TextField one-line box tracks its
  border` block (line 249) is the closest existing analogue.

---

## Non-Goals

- **No theme listener.** `TextField` re-derives on theme change because its
  quantity contains `Util.lineHeightPx()`, which tracks the theme font size.
  `MenuItem.HEIGHT - chrome` contains no font term. A theme whose swap changes a
  *border width* on a menu item would leave the pin stale; no shipped theme does
  that, and adding a subscription to every menu item to cover it is not worth
  the cost.[^no-theme-listener]
- **`setInsets` and `setPadding` get no override.** A border set or changed at
  runtime re-derives; insets or padding changed at runtime do not. This matches
  `TextField`, whose `updateHeight` also reads all three and whose only hook is
  `setBorder`. Insets and padding supplied through the options bag *are* handled,
  by the constructor's tail call.
- **`MenuItem`'s outer height is not changed.** A bordered item stays 24 tall.
  Growing it to 24 + border would break the menu's vertical rhythm and `Menu`'s
  height estimate ([Menu.ts:537](packages/lib/src/typescript/lib/overlay/Menu.ts#L537)).
- **`TextField.clearBorder` is not given the same override.** `MenuItem` gets
  one; `TextField` has the same untaken gap and no caller that reaches it.
  Fixing it is unrelated to this change — noted, not done.
- **The other eleven baselined sites stay baselined.** Only the `MenuItem`
  constructor key comes out.

---

## Notes

[^seam]: Three seams were considered. A **`setBorder` override** wins because
    the changelog entry the precedent ships under is literally *"Size hints that
    depend on a border are re-derived when it changes"* — this is the same
    failure (a border-derived value cached at construction) on a different
    component, so it takes the same hook. A **theme listener** is rejected under
    `## Non-Goals`. A **first-layout hook** — re-pinning from `box.height`
    inside `doLayout` — is rejected for two reasons. It would be the only
    border-derived size hint in the framework that is not re-derived by the
    setter that invalidates it, and it puts a `setLineHeight` call on the layout
    path, which is the exact shape of a previously shipped CPU-pinning relayout
    loop: `CellRenderer.doLayout` synced a `Text` child's line-height every pass,
    and `setLineHeight`'s unconditional `scheduleLayout()` re-dirtied the
    renderer each frame. The idempotence guard added at
    [Text.ts:1005](packages/lib/src/typescript/lib/component/input/Text.ts#L1005)
    would stop it spinning today, but re-creating the shape and relying on that
    guard is a worse trade than a setter override. `clearBorder` is included
    even though `TextField` does not override it: it is the same seam, it costs
    four lines, and `clearBorder` is public on a published library.

[^chrome]: `getPerimeterSize()` is used rather than a hand-rolled sum because it
    is what `Text`, `VideoPlayer`, `AbstractChart` and
    `AbstractCalendarDropdown` already call for their own chrome, and because
    `doLayout`'s `getContentBounds()` is built from the same accessor — so pin
    and placement cannot drift apart. Using only `getBorderSize()` would have
    avoided the lint-rule change but would silently ignore padding, and the demo
    panel and the offline suite both exercise a padded item. `Util.singleLineBoxHeight`
    ([Util.ts:230](packages/lib/src/typescript/lib/core/Util.ts#L230)) is the
    same chrome sum in the opposite direction (line box *plus* chrome, for a
    component sizing itself around one line of text); it does not fit here,
    because `MenuItem`'s row height is fixed by a constant and the content is
    what gives way.

[^height-constant]: `TextField` resolves the same tension the other way — its
    outer height *grows* to `lineHeightPx() + chrome` so the text keeps its
    natural line box. `MenuItem` cannot, because its height is a shared row
    rhythm: a bordered item that grew to 26 would sit taller than its
    unbordered siblings in the same panel, and `Menu`'s pre-measure height
    estimate multiplies one constant by the item count. The consequence is that
    chrome eats into the text's room, and a border thick enough will clip
    regardless — the fix removes the *pinned* overrun, it does not manufacture
    space. At the demo panel's 4px the content box is 16, which is exactly the
    natural line box at the default 14px font plus 2px leading, so it fits with
    nothing to spare.

[^lint-set]: The escape set's own docstring calls its members *"reads that prove
    the method knows a component has a perimeter"*. `getPerimeterSize` is that
    read under that name. The change can only stop reports, never create them,
    and no currently-baselined site calls it — its existing callers are layout
    managers (out of the rule's scope by construction) plus `Text`,
    `AutoCompleteDropdown`, `VideoPlayer`, `AbstractCalendarDropdown` and
    `AbstractChart`, none of them baselined. The alternative — splitting the
    derivation into one method that names `MenuItem.HEIGHT` and another that
    places the labels, so neither trips the rule — was rejected: it games the
    guard, which the rule's own header warns about ("the green it produces means
    nothing").

[^tail]: The ordering inside `Component.applyOptions` makes the tail call
    sufficient rather than merely convenient: `insets` (line 589) and `padding`
    (line 590) are dispatched before `applyChromeOptions` (line 595), so a
    `setBorder` arriving from the bag already sees the final insets and padding.
    `MenuItem`'s constructor passes nothing to `super()`
    ([MenuItem.ts:171](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L171),
    with a `local/forward-super-options` suppression) and applies its options at
    the tail instead, so no setter runs during the `super()` cascade and the
    label fields are always initialised before `updateLabelHeights` can read
    them. The optional chaining guards the case anyway, so a future change that
    starts forwarding options to `super()` degrades to a no-op rather than a
    crash.

[^no-theme-listener]: This is a stated deviation from the precedent, not an
    oversight. `TextField`'s `subscribeTheme(() => this.updateHeight())`
    ([TextField.ts:49](packages/lib/src/typescript/lib/component/input/TextField.ts#L49))
    exists for the `Util.lineHeightPx()` term, which moves with the theme's font
    size; it incidentally also refreshes the chrome. `MenuItem`'s formula has no
    font term, so the only theme-sensitive input left is a `var()`-valued border
    width — and `Component.setBorder` already invalidates the cached widths on a
    theme change ([Component.ts:2266-2269](packages/lib/src/typescript/lib/core/Component.ts#L2266)),
    so the *placement* stays correct even when the pin does not move. A
    subscription per menu item, firing a no-op for every unbordered item in
    every menu, buys only the pin for a case no shipped theme produces.

---

## Implementation Notes

- **The `grep -c 'centerInHeight'` verify criterion in step 5 and in
  `## Verification` says "one." Implemented as designed instead, and the count
  came out at five, not one.** The `## Internal Structure` code block itself —
  the canonical implementation this plan hands down — writes four separate
  optional-chained `centerInHeight` calls inside `updateLabelHeights` (one per
  label field), plus its own JSDoc prose sentence that names `centerInHeight`
  to explain why the re-pin is needed. That is 5 occurrences of the substring
  by construction of the plan's own sample code, not 1 — the two verify
  criteria were inconsistent with the code sample they were meant to check
  against. `updateLabelHeights` was implemented verbatim from `## Internal
  Structure` (four calls, matching the four independent nullable label fields
  and the "Offline — the chevron is pinned like the rest" acceptance case,
  which needs the chevron's own call). The `grep -c 'out of scope'` half of
  step 5's verify — the only half load-bearing for the actual defect — passes
  as specified (zero).

- **Both manual checks in `## Expected Behaviour` were performed, three times
  over.** The implementer ran them against a dev server started from this
  worktree (`node_modules` symlinked first, spare port, so the package
  self-reference resolves to this worktree's `packages/lib` rather than the
  main tree's), and two independent reviewers re-ran them from their own
  servers. *Content Box demo:* the bordered item measures 24px outer with 4px
  borders; the title and shortcut sit in a 16px box with `line-height: 16px`,
  fully inside the frame, descenders whole at 5x zoom. *No visible change where
  a menu is unbordered:* every MenuBar item still reports child `y: 0`,
  `height: 24`, `line-height: 24px`, with icons, shortcuts, submenu chevrons
  and disabled items unchanged. No before/after image was captured; the
  measurements above are the record.

- **Step 8's verify criterion, "`npm run lint` in `packages/lib` is clean," was
  never satisfiable.** A pre-existing `local/forward-super-options` error at
  `component/table/cell/renderer/Link.ts:57` makes that script exit non-zero on
  the base commit too. Checked instead that `npx eslint src` reports that one
  error and nothing else.
