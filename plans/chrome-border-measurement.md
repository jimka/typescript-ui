# Chrome Border Measurement — Implementation Plan

## Overview

Three chrome components report their own geometry wrongly. `MenuBar` and
`MenuSeparator` paint a border through the raw CSS escape hatch, so
`getBorderSize()` reports `{0,0,0,0}` and the bar hands its buttons one pixel
more room than its content box has. `AbstractWindow.doLayout` sizes and places
its south and east resize strips from the wrong inset side. `WindowBorder`'s
constructor guards an enum value that is `0`, so an explicit `Direction.NORTH`
reads as "not supplied".

The fixes touch four source files:
[packages/lib/src/typescript/lib/component/menubar/MenuBar.ts:88](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L88),
[packages/lib/src/typescript/lib/component/container/MenuSeparator.ts:53](packages/lib/src/typescript/lib/component/container/MenuSeparator.ts#L53),
[packages/lib/src/typescript/lib/overlay/AbstractWindow.ts:2412](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2412),
and
[packages/lib/src/typescript/lib/component/container/WindowBorder.ts:113](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L113).
A fifth, `MenuBarButton.ts`, gets a corrected doc comment. One public method,
`WindowBorder.setDirection`, is deleted.

Only the `MenuBar` fix changes what is on screen: the bar grows from 28 px to
29 px and everything below it in a `Border` NORTH region moves down one pixel.
That is the point of the fix — its buttons currently overflow the bar's content
box and lose their bottom row to `overflow: hidden`.

---

## Scope

The three fixes ship as one plan and as separate commits.[^one-plan]

They share one diagnosis — a component's own measurement of its chrome
disagrees with what it paints or where it sits — and one reviewer's context:
`Component.getBorderSize()`, the path an options bag takes to `setBorder`, and
the outer-box-to-content-box arithmetic every one of them gets wrong. Splitting
them into three plans would repeat that background three times for changes of a
handful of lines each.

They are still independent. No step depends on another fix, the files do not
overlap, and each carries its own tests. The `WindowBorder.setDirection`
deletion is a public-API removal and gets its own commit, as this repo's
pre-1.0 policy requires.

---

## Architecture Decisions

### C24 — the border moves onto the class defaults bag

`MenuBar` and `MenuSeparator` stop calling `setElementCSSRule` for their
border and declare it as a `border` field on the class defaults bag they pass
to `super()`, the way
[AbstractSelectableList.ts:314](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L314)
and
[StatusBar.ts:63](packages/lib/src/typescript/lib/component/container/StatusBar.ts#L63)
already do.[^why-defaults-bag]

`Component.applyChromeOptions`
([Component.ts:1036-1041](packages/lib/src/typescript/lib/core/Component.ts#L1036))
resolves `options.border ?? this._defaultOptions.border` and dispatches
`setBorder`, so the declared border reaches `_border`, `getBorderSize()` can
measure it, and a caller-supplied `border` option still wins.

`cacheBorderSpec` is the wrong tool here.[^not-cache-border-spec]

### `MenuBar`'s minimum height grows by the border

`_defaultMenuBarOptions.minSize.height` becomes
`MENU_BAR_BUTTON_HEIGHT + MENU_BAR_BORDER_BOTTOM_WIDTH` (29), and a new
module-level `MENU_BAR_BORDER_BOTTOM_WIDTH` constant supplies the `1px` in the
border string as well, so the two cannot drift apart. `StatusBar` pins the same
pair the same way
([StatusBar.ts:27](packages/lib/src/typescript/lib/component/container/StatusBar.ts#L27)).[^minsize-bump]

### C25 — three expressions, not one

`AbstractWindow.doLayout` gets three corrections, not just the south strip's
height. The two locals that place the east and south *bands* carry the same
wrong-side assumption and are rewritten too.[^three-not-one]

| Write | Today | After |
|---|---|---|
| `south.setHeight(…)` ([:2466](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2466)) | `insets.getRight()` | `insets.getBottom()` |
| east / northeast / southeast `setX(…)` ([:2412](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2412)) | `size.width − borders − insets.getLeft()` | `size.width − borders − insets.getRight()` |
| south / southeast / southwest `setY(…)` ([:2413](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2413)) | `size.height − borders − insets.getTop()` | `size.height − borders − insets.getBottom()` |

"borders" is the component's own CSS border on that axis (`left + right`, or
`top + bottom`). A child is absolutely positioned against its parent's padding
box, so the far edge of that box sits `borders` in from the window's outer
edge; the trailing strip starts one more inset — its own — before it.

### C26 — `setDirection` is deleted, the constructor is fixed

`WindowBorder.setDirection` is removed. It has no callers anywhere, and it
cannot be made correct by fixing its guard: it changes `_direction` without
re-applying the hover cursor, which the class documents as shared with the drag
cursor "so the two can never disagree"
([WindowBorder.ts:288](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L288)).[^delete-setdirection]

With the setter gone, `_direction` becomes `private readonly _direction: Direction;`
with no initializer, assigned unconditionally in the constructor —
[ToolBarSeparator.ts:52](packages/lib/src/typescript/lib/component/menubar/ToolBarSeparator.ts#L52)
is the same shape in the same slice. The `if (direction)` guard disappears with
the initializer it was compensating for.

### Ordering — the geometry change lands last

Steps run C26, then C25, then C24. The first two change no rendered geometry
and need no manual pass; C24 moves boxes and is the only one a human has to
look at. Putting it last keeps the manual pass at the end of the branch rather
than in the middle.

---

## Public API

One removal. Nothing is added.

```typescript
// packages/lib/src/typescript/lib/component/container/WindowBorder.ts
// DELETED — no callers anywhere in the repo, in packages/qa, or in Loom.
setDirection(direction: Direction): this;
```

`getDirection()`, `Direction`, `WindowBorderOptions` and `WindowBorderEvent`
are unchanged and stay exported from
[component/container/index.ts:36-37](packages/lib/src/typescript/lib/component/container/index.ts#L36).

---

## Internal Structure

`MenuBar`'s new constant and the two bag fields it feeds:

```typescript
// Above _defaultMenuBarOptions.
const MENU_BAR_BORDER_BOTTOM_WIDTH: number = 1;

const _defaultMenuBarOptions: Partial<MenuBarOptions> = {
    backgroundColor: "var(--ts-ui-menu-bar-bg, rgb(245, 245, 245))",
    border:  { borderBottom: `${MENU_BAR_BORDER_BOTTOM_WIDTH}px solid var(--ts-ui-menu-bar-border, rgb(220, 220, 220))` },
    minSize: { width: 0, height: MENU_BAR_BUTTON_HEIGHT + MENU_BAR_BORDER_BOTTOM_WIDTH },
    navigationTarget: true,
};
```

`MenuSeparator`'s border colour varies with its `cssVarPrefix` constructor
argument, so the two specs are module-level constants selected by that
argument. Module-level keeps each object's identity stable, which is what the
defaults-bag cache compares
([ComponentDefaults.ts:60-65](packages/lib/src/typescript/lib/core/ComponentDefaults.ts#L60)):

```typescript
import type { BorderOptions } from "~/primitive/Border.js";

const SEPARATOR_BORDERS: Readonly<Record<MenuItemCSSVarPrefix, BorderOptions>> = Object.freeze({
    "menu-bar":     { borderTop: "1px solid var(--ts-ui-menu-bar-separator-color, rgb(220, 220, 220))" },
    "context-menu": { borderTop: "1px solid var(--ts-ui-context-menu-separator-color, rgb(220, 220, 220))" },
});

// In the constructor, replacing the plain `{ ..._defaultMenuSeparatorOptions, ... }` spread:
super(options, {
    ..._defaultMenuSeparatorOptions,
    border: SEPARATOR_BORDERS[cssVarPrefix],
    ...(subclassDefaults ?? {}),
});
```

`AbstractWindow.doLayout`'s two replacement locals:

```typescript
// A child is positioned against this window's padding box, so the box's far
// edge sits `border.left + border.right` (or top + bottom) in from the outer
// edge; the trailing band starts its own inset before that.
const eastStripX  = size.width  - (Number(borderSize.left) || 0) - (Number(borderSize.right)  || 0) - insets.getRight();
const southStripY = size.height - (Number(borderSize.top)  || 0) - (Number(borderSize.bottom) || 0) - insets.getBottom();
```

---

## Ordered Implementation Steps

### C26 — `WindowBorder`

1. Extend
   [packages/lib/tests/component/container/WindowBorder.resizeCursor.test.ts](packages/lib/tests/component/container/WindowBorder.resizeCursor.test.ts)
   first: add a case that walks all eight `Direction` members and asserts each one's `getDirection()` round-trip
   and `getCursor()` value (`NORTH`/`SOUTH` → `ns-resize`, `WEST`/`EAST` →
   `ew-resize`, `NORTHWEST`/`SOUTHEAST` → `nwse-resize`,
   `SOUTHWEST`/`NORTHEAST` → `nesw-resize`). It passes before the change; it is
   the guard that makes steps 3 and 4 safe. Copy the file's existing
   `installTestDOM(CONFIG)` + `afterEach(() => DOM.reset())` shape.
2. Delete `setDirection` ([:149-162](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L149),
   the JSDoc block and the method). Check: `grep -rn 'setDirection' packages/lib/src/typescript/lib/component/container/WindowBorder.ts` — expect zero matches.
3. Change the field at [:92](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L92)
   from `private _direction: Direction = Direction.NORTH;` to
   `private readonly _direction: Direction;`.
4. Replace the constructor guard at [:113-115](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L113)
   — `if (direction) { this._direction = direction; }` — with the bare
   assignment `this._direction = direction;`. It must stay above the
   `this.dragCursor()` call at [:126](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L126),
   which reads the field.
5. Run `npm -w packages/lib run typecheck` and the new test.

### C25 — `AbstractWindow`

6. Add `packages/lib/tests/overlay/AbstractWindow.borderStrips.test.ts`, red
   before step 7. It builds `new Window('W', { insets: new Insets(2, 8, 6, 4) })`,
   calls `win.show()` (which runs `doLayout()` itself,
   [AbstractWindow.ts:824](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L824)),
   and asserts all eight strips' rectangles against the table in
   `## Expected Behaviour`. Reach the strips the way
   [AbstractWindow.resizable.test.ts:25](packages/lib/tests/overlay/AbstractWindow.resizable.test.ts#L25)
   does, through the private `_borderComponents` record.
7. In
   [AbstractWindow.ts:2412-2413](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2412),
   replace `horisontallBorderWidth` and `verticalBorderWidth` with the
   `eastStripX` / `southStripY` locals from `## Internal Structure`, comment
   included.
8. Rewrite the six `setX` / `setY` writes that consumed the old locals —
   [:2448](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2448),
   [:2453](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2453),
   [:2458](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2458)
   to `setX(eastStripX)`, and
   [:2459](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2459),
   [:2464](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2464),
   [:2469](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2469)
   to `setY(southStripY)`.
9. Change [:2466](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2466)
   from `south.setHeight(insets.getRight())` to
   `south.setHeight(insets.getBottom())`.
10. Check: `grep -n 'horisontallBorderWidth\|verticalBorderWidth' packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`
    — expect zero matches. Do not touch `chromeMinSize`
    ([:716-726](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L716));
    see `## Non-Goals`.
11. Run the new test — it goes green here.

### C24 — `MenuBar` and `MenuSeparator`

12. Add the `MenuBar` and `MenuSeparator` cases to
    [packages/lib/tests/component/content-box-containment.test.ts](packages/lib/tests/component/content-box-containment.test.ts),
    from `## Expected Behaviour` cases 6-12. Put the `MenuBar` block next to
    the `SelectableListRow reserves its separator` block at
    [:684](packages/lib/tests/component/content-box-containment.test.ts#L684),
    which is the same fix one release earlier; put the `MenuSeparator` cases
    beside the existing bordered-separator case at
    [:545](packages/lib/tests/component/content-box-containment.test.ts#L545).
    They are red.
13. In [MenuBar.ts](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts):
    add `MENU_BAR_BORDER_BOTTOM_WIDTH` above `_defaultMenuBarOptions`, add the
    `border` field to the bag, and change `minSize.height` from
    `MENU_BAR_BUTTON_HEIGHT` to `MENU_BAR_BUTTON_HEIGHT + MENU_BAR_BORDER_BOTTOM_WIDTH`
    ([:28](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L28)).
14. Delete the `setElementCSSRule("borderBottom", …)` call in `MenuBar`'s
    constructor ([:88-91](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L88)).
15. Update the JSDoc on `MENU_BAR_BUTTON_HEIGHT`
    ([MenuBarButton.ts:66-71](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts#L66)):
    it says the bar's `setMinSize` is the same value; it is now that value plus
    the bar's bottom border.
16. In [MenuSeparator.ts](packages/lib/src/typescript/lib/component/container/MenuSeparator.ts):
    add the `BorderOptions` type import and the `SEPARATOR_BORDERS` map, pass
    `border: SEPARATOR_BORDERS[cssVarPrefix]` in the `super()` defaults bag, and
    delete the `setElementCSSRule("borderTop", …)` call
    ([:53-56](packages/lib/src/typescript/lib/component/container/MenuSeparator.ts#L53)).
    Leave the `setElementCSSRule("margin", "4px 0")` line at
    [:57](packages/lib/src/typescript/lib/component/container/MenuSeparator.ts#L57)
    alone.
17. Add one sentence to `MenuSeparator`'s class JSDoc: the rule is a real
    border rather than a raw CSS write, so it is measurable — mirroring
    `SelectableListRow`'s own note at
    [AbstractSelectableList.ts:323-324](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L323).
18. Check: `grep -n 'setElementCSSRule' packages/lib/src/typescript/lib/component/menubar/MenuBar.ts packages/lib/src/typescript/lib/component/container/MenuSeparator.ts`
    — expect exactly one match, `MenuSeparator`'s `margin`.
19. Update
    [packages/lib/tests/component/default-options-fallback.test.ts](packages/lib/tests/component/default-options-fallback.test.ts):
    change the `MenuBar minSize` row at
    [:474](packages/lib/tests/component/default-options-fallback.test.ts#L474)
    to `{ width: 0, height: 29 }`, and add three rows — `MenuBar border`,
    `MenuSeparator border`, and `MenuSeparator border (context-menu)` — in the
    shape of the `StatusBar border` row at
    [:457](packages/lib/tests/component/default-options-fallback.test.ts#L457).
20. Run the full suite; step 12's cases go green here.

### Documentation

21. Add the three changelog entries and the one migration note described in
    `## Documentation Impact`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/WindowBorder.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/MenuBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/MenuSeparator.ts` |
| Modify | `packages/lib/tests/component/container/WindowBorder.resizeCursor.test.ts` |
| Create | `packages/lib/tests/overlay/AbstractWindow.borderStrips.test.ts` |
| Modify | `packages/lib/tests/component/content-box-containment.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |

---

## Expected Behaviour

Cases 1-2 and 4-12 are unit-testable under the offline harness; case 3 is
proved by the typecheck alone. Under that harness a border width resolves
through the pre-attach estimate path
([Component.ts:4083-4088](packages/lib/src/typescript/lib/core/Component.ts#L4083)),
which reads the leading `1px` out of the spec string, so `getBorderSize()`
returns real numbers without a live document.[^offline-widths] One
manual-verification step follows the cases.

### C26 — `WindowBorder`

1. `new WindowBorder(Direction.NORTH).getDirection()` is `Direction.NORTH`, and
   `getCursor()` is `"ns-resize"`. Passes today; guards step 3's removal of the
   field initializer.
2. The same round-trip holds for the other seven members, each with its own
   cursor: `SOUTH` → `ns-resize`, `WEST`/`EAST` → `ew-resize`,
   `NORTHWEST`/`SOUTHEAST` → `nwse-resize`, `SOUTHWEST`/`NORTHEAST` →
   `nesw-resize`.
3. `windowBorder.setDirection` is `undefined` — the method is gone. Enforced by
   the typecheck rather than a runtime assertion; no test needed.

### C25 — `AbstractWindow`

4. `new Window('W', { insets: new Insets(2, 8, 6, 4) })` — `Insets` takes CSS
   order, so top 2, right 8, bottom 6, left 4 — shown at its default 400 × 300,
   places its eight strips at exactly these rectangles. The window's own border
   is 1 px on every side, so the padding box is 398 × 298.

   | Strip | x | y | width | height |
   |---|---|---|---|---|
   | northwest | 0 | 0 | 4 | 2 |
   | north | 4 | 0 | 386 | 2 |
   | northeast | 390 | 0 | 8 | 2 |
   | west | 0 | 2 | 4 | 290 |
   | east | 390 | 2 | 8 | 290 |
   | southwest | 0 | 292 | 4 | 6 |
   | south | 4 | 292 | 386 | 6 |
   | southeast | 390 | 292 | 8 | 6 |

   Today the south strip is 8 px tall instead of 6, the three eastern strips
   sit at x 394 instead of 390 (four pixels past the padding box's right edge),
   and the three southern strips sit at y 296 instead of 292.

5. `new Window('W')` — uniform 4 px insets — is unchanged by the fix: every
   strip keeps the rectangle it has today. This is the no-op case that proves
   the change is confined to asymmetric insets.

### C24 — `MenuBar` and `MenuSeparator`

6. `new MenuBar().getBorderSize()` is `{ top: 0, right: 0, bottom: 1, left: 0 }`.
   Today it is all zeros.
7. `new MenuBar().getBorder()` is
   `{ borderBottom: '1px solid var(--ts-ui-menu-bar-border, rgb(220, 220, 220))' }`.
   Today it is `null`.
8. `new MenuBar().getMinSizeConstraint()` is `{ width: 0, height: 29 }`. Today
   it is `{ width: 0, height: 28 }`.
9. A `MenuBar` populated with two menus reports `getPreferredSize()!.height`
   of 29 — its tallest button's 28 plus the bottom border, which
   `HBox.getPreferredSize` folds in at
   [HBox.ts:124](packages/lib/src/typescript/lib/layout/HBox.ts#L124). Today it
   is 28.
10. That same bar, laid out at 400 × 29, gives every `MenuBarButton` child a
    height of exactly 28 and a rectangle inside `getContentBounds()`. Today each
    button is 29 tall and its last row falls outside the content box.
11. `new MenuSeparator().getBorderSize()` is
    `{ top: 1, right: 0, bottom: 0, left: 0 }`, and
    `new MenuSeparator('context-menu').getBorder()` is
    `{ borderTop: '1px solid var(--ts-ui-context-menu-separator-color, rgb(220, 220, 220))' }`.
    Both are zero / `null` today.
12. Nothing about a separator moves: `new MenuSeparator().getPreferredSize()!.height`
    stays 9, and `new MenuSeparator('menu-bar', { border: '2px solid black' }).getBorderSize().top`
    stays 2 — a caller-supplied border still overrides the class default. Both
    pass today; they are the regression guards for case 11.

### Manual verification

The one thing the offline harness cannot show is the pixel. In the QA app's
`menus` panel, a `MenuBarButton`'s bottom edge currently coincides with the
bar's bottom border and is clipped; after the fix the button ends one pixel
above the rule and the whole button paints. Check it against
`geometry.menubarButton` and `geometry.menubar`
([packages/qa/src/panels/menus.ts:72](packages/qa/src/panels/menus.ts#L72)) —
the button's height must read 28 while the bar's reads 29.

**Do not run a QA panel without asking first.** Every run opens a full-screen
window on the user's desktop.

---

## Verification

1. `npm -w packages/lib run typecheck` — clean. This is also where the
   `setDirection` removal is proved: any surviving caller fails to compile.
2. `npm -w packages/lib run test` — the full suite, including
   `typecheck:test` over the test tree.
3. `npm -w packages/lib run lint` — clean. Neither `local/no-element-style` nor
   the two baselined rules
   (`no-raw-dom.baseline.json`, `require-content-bounds.baseline.json`) name any
   of these files, so no baseline needs regenerating.
4. `npm -w packages/lib run docs:api` — zero warnings. `setDirection`'s JSDoc
   is deleted with the method and no other JSDoc `{@link}`s it.
5. Grep invariants from the steps:
   `grep -rn 'setDirection' packages/lib/src packages/lib/tests packages/qa` —
   only `CollapseButton` and `SplitGutter` hits remain;
   `grep -n 'horisontallBorderWidth\|verticalBorderWidth' packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`
   — zero.
6. Specifically re-run
   `packages/lib/tests/diagnostics/StyleAudit.regression.test.ts`. Its gallery
   builds a `MenuBar` and a `MenuSeparator`
   ([:136](packages/lib/tests/diagnostics/StyleAudit.regression.test.ts#L136),
   [:148](packages/lib/tests/diagnostics/StyleAudit.regression.test.ts#L148)),
   and each now writes four border longhands to its own `#id` rule instead of
   one raw declaration. The duplicate ceiling is 69
   ([:125](packages/lib/tests/diagnostics/StyleAudit.regression.test.ts#L125));
   the count must still sit under it.
7. The manual pass in `## Expected Behaviour`, on the user's go-ahead.

---

## Documentation Impact

`packages/lib/docs/reference/changelog/next.md`:

- **`## Breaking changes` → `### Components`** — `WindowBorder.setDirection` is
  removed. Follow the `Slider`'s `showTicks` entry at
  [:12-17](packages/lib/docs/reference/changelog/next.md#L12): say it had no
  callers, that a strip's direction is fixed at construction, and point at the
  migration page.
- **`## Fixed` → `### Components`** — one entry for `MenuBar` and
  `MenuSeparator`: their borders are now real borders, so the bar reserves the
  pixel its rule occupies and its buttons keep their full 28 px row. State the
  consumer-visible consequence plainly: a `MenuBar` reports a preferred and
  minimum height of 29 rather than 28, so a layout that hosts one gains a pixel
  of chrome. A second entry for `WindowBorder`'s constructor: an explicit
  `Direction.NORTH` is no longer treated as absent.
- **`## Fixed` → `### Overlay`** — `AbstractWindow`'s resize strips now take
  each edge's own inset. Note that windows using the default uniform insets are
  unaffected.

`packages/lib/docs/reference/migration/next.md`: one `## WindowBorder.setDirection is removed`
section in the shape of the `Slider` note already on the page — what changed
and why, who needs to act, and a before/after block showing that a direction is
chosen at construction (`new WindowBorder(Direction.EAST)`) and not changed
afterwards.

No API page needs editing by hand: TypeDoc generates them from source.
`packages/lib/llms.txt` indexes classes, not methods, so it is untouched — but
run `npm -w packages/lib run docs:llms:check` with the rest of the doc build to
confirm.

`packages/lib/docs/components/MenuBar.md` and `MenuSeparator.md` document
neither the bar's height nor the separator's border width, so neither page
changes.

---

## Potential Challenges

- **The `MenuBar` pixel is load-bearing downstream.** Any consumer that pins a
  menu bar's height to 28 — rather than letting `Border` NORTH take its
  preferred size — will now clip the buttons exactly as the bar does today. The
  changelog entry must say the bar reports 29, not merely that a bug was fixed.
- **`MenuSeparator`'s defaults bag misses the shared-bag cache for the
  non-dominant prefix.** `resolveClassDefaults` caches one bag per class and
  compares supplied values by identity
  ([ComponentDefaults.ts:92-106](packages/lib/src/typescript/lib/core/ComponentDefaults.ts#L92)),
  so whichever prefix constructs first gets the cached bag and the other
  allocates a fresh frozen bag per instance. That is the documented behaviour
  for a class whose defaults vary per instance, and both specs are module-level
  constants so neither allocates the border object itself.
- **The eight-strip test is brittle against a `Window` default change.** It
  hardcodes the default 400 × 300 and the default 1 px window border. If either
  moves, the expected table moves with it — a comment naming both defaults, and
  the uniform-insets no-op case, keep the failure legible.
- **`readonly _direction` and the class-field cascade.** The field has no
  initializer, so it is assigned only in the constructor body after `super()`.
  Nothing in the `super()` cascade reads it — no option dispatches to a setter
  that touches it — so the `declare` rule in `CODE_CONVENTIONS.md` does not
  apply here.

---

## Critical Files

- [packages/lib/src/typescript/lib/core/Component.ts:1005-1044](packages/lib/src/typescript/lib/core/Component.ts#L1005)
  — `applyChromeOptions`. Its JSDoc states why `border` stays on the dispatch
  path: `_border` feeds the layout border-width path. That is C24's fix,
  described by the framework itself.
- [packages/lib/src/typescript/lib/core/Component.ts:4042-4089](packages/lib/src/typescript/lib/core/Component.ts#L4042)
  — `getBorderSize`, including the `if (!this._border) return {0,0,0,0}`
  short-circuit that is the whole of C24, and the pre-attach estimate path the
  tests rely on.
- [packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts:295-330](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L295)
  — `SelectableListRow`. The precedent C24 follows: a one-sided separator
  deliberately kept off the shared class rule so it is measurable.
- [packages/lib/src/typescript/lib/component/container/StatusBar.ts:10-65](packages/lib/src/typescript/lib/component/container/StatusBar.ts#L10)
  — the border-width constant, the defaults-bag `border`, and a `minSize` that
  counts the border. The template for `MenuBar`'s three edits.
- [packages/lib/src/typescript/lib/component/menubar/ToolBar.ts:150-152](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L150)
  — the same defaults-bag border on `MenuBar`'s closest sibling.
- [packages/lib/src/typescript/lib/component/menubar/ToolBarSeparator.ts:52](packages/lib/src/typescript/lib/component/menubar/ToolBarSeparator.ts#L52)
  and [:69](packages/lib/src/typescript/lib/component/menubar/ToolBarSeparator.ts#L69)
  — a `private readonly` field with no initializer, assigned from the
  constructor body. The shape C26 gives `_direction`.
- [packages/lib/src/typescript/lib/core/ComponentDefaults.ts:52-109](packages/lib/src/typescript/lib/core/ComponentDefaults.ts#L52)
  — how a per-instance defaults bag behaves against the shared-bag cache.
- [packages/lib/tests/component/content-box-containment.test.ts:1-15](packages/lib/tests/component/content-box-containment.test.ts#L1)
  and [:684-700](packages/lib/tests/component/content-box-containment.test.ts#L684)
  — the file's two oracles and the `SelectableListRow` block C24's tests sit
  beside.
- [packages/lib/tests/component/container/WindowBorder.resizeCursor.test.ts:15-24](packages/lib/tests/component/container/WindowBorder.resizeCursor.test.ts#L15)
  — the house style for documenting a test that cannot be red before its fix.
- [ARCHITECTURE.md](ARCHITECTURE.md), *Three non-negotiable rules for every DOM
  write* and *`setElement*` is the low-level seam* — why a cached, typed border
  beats a raw rule write.

---

## Non-Goals

- **`AbstractWindow.chromeMinSize`
  ([:716-726](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L716))
  keeps its single-side inset fold.** It adds only `insets.getLeft()` /
  `insets.getTop()` to the chrome minimum, so it under-states the floor for a
  window with asymmetric insets. It is a resize floor, not a placement:
  widening it to both sides raises every window's minimum size by an inset per
  axis even at the default insets, which is a behaviour change with its own
  risk and its own decision to make.
- **`WindowBorder.isSnapTarget()`
  ([:225](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L225))
  stays.** It also has zero callers and is a deletion candidate under the same
  pre-1.0 policy, but it is correct as written and outside C26. Recorded here
  rather than folded in.
- **`MenuSeparator`'s `margin` write
  ([:57](packages/lib/src/typescript/lib/component/container/MenuSeparator.ts#L57))
  stays.** A raw `margin` on an absolutely positioned component is a separate
  finding with a separate fix; touching it here would mix a visual change into a
  measurement fix.
- **Neither class gains `ownClassStyleDefaults`.** `ToolBar` mirrors its whole
  defaults bag into a class-tier rule on top of writing the border per instance
  ([ToolBar.ts:139-152](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L139)).
  That is a CSS-dedup optimisation with its own rule — the mirror must carry the
  *whole* bag or fields silently drop out of the class rule — and it is not what
  makes a border measurable. `StatusBar` and `SelectableListRow`, the two
  closest precedents, declare no class-tier border at all.
- **`MenuBarButton.computePreferredSize` is untouched.** Its discarded height
  recursion is a separate finding in the same slice report.

---

## Notes

[^one-plan]: The alternative was three plans. It was rejected because the
    shared context — `getBorderSize`'s `_border` short-circuit, the chrome
    dispatch path, and the outer-to-content-box arithmetic — is most of what a
    reader needs for any one of them, and would have to be written three times.
    The counter-argument, that C24 changes rendered geometry while C25 and C26
    are latent, is handled by ordering rather than by splitting: C24 runs last,
    so the single manual pass sits at the end of the branch and covers only the
    change that needs one. Commits stay separate regardless — the repo's commit
    convention is one functionality per code commit, and the `setDirection`
    deletion additionally requires its own.

[^why-defaults-bag]: Three routes were available. A constructor `setBorder`
    call is architecture-compliant but silently overrides a caller-supplied
    `border` option, because the constructor body runs after the `super()`
    cascade has already dispatched the caller's value — `MenuSeparator` has
    exactly such a caller in
    [content-box-containment.test.ts:545](packages/lib/tests/component/content-box-containment.test.ts#L545).
    Keeping `setElementCSSRule` and adding `cacheBorderSpec` is the smallest
    diff but misuses that method (see the next footnote) and leaves `border`,
    a `StyleBag` layering property, outside `_instanceStyle` — the thing
    ARCHITECTURE.md's second DOM-write rule exists to prevent. The defaults bag
    is what the framework built for this: `applyChromeOptions`'s own JSDoc says
    the chrome group is kept on the dispatch path precisely because `_border`
    feeds the layout border-width path, and two shipped classes —
    `SelectableListRow` and `StatusBar` — already declare a one-sided chrome
    border that way.

[^not-cache-border-spec]: `cacheBorderSpec` updates `_border` without writing
    any CSS, for a component whose border is painted by a *shared class-tier*
    rule that no instance write may duplicate. Its three callers are all that
    case: `Menu.applyPersistentChrome` (`.persistent`),
    `SplitGutter.setOpaque` (`.opaque`) and `Button._applyFlatChrome`
    (`.flat`), and all three carry the same comment saying a real `setBorder`
    "would defeat the hoisting". `MenuBar` and `MenuSeparator` paint through
    `setElementCSSRule`, which queues into the instance's own `#id` rule — there
    is no hoisting to defeat, so the reason `cacheBorderSpec` exists does not
    apply, and using it would leave the raw write in place as well.

[^minsize-bump]: `MENU_BAR_BUTTON_HEIGHT` and the bar's `minSize` are
    documented as kept in lockstep so the bar can never grow taller than its
    buttons. Once the border is measured, the relationship inverts: a floor of
    28 leaves a 27 px content box, so the buttons lose the pixel instead. The
    floor rarely binds — `HBox.getPreferredSize` already reports 29 for a
    populated bar — but it binds exactly when space is tight, which is when a
    clipped button is most visible. The `+ MENU_BAR_BORDER_BOTTOM_WIDTH` term
    is also what makes the lockstep survive a future change to either number.

[^three-not-one]: The bug register names one line, the south strip's height.
    The two locals it does not name carry the same single-side assumption, and
    the strips they place are the same strips. Fixing the height alone leaves
    the south strip correctly 6 px tall at a y computed from the *top* inset,
    which is a fix whose correctness depends on the top and bottom insets
    happening to match. The east band is worse: at the QA `windows` panel's own
    `(4, 12, 4, 4)` window
    ([packages/qa/src/panels/windows.ts:39-44](packages/qa/src/panels/windows.ts#L39))
    the three eastern strips already start 8 px past where they should and run
    outside the padding box, so `overflow: hidden` clips the 12 px grab band
    down to 4. The panel's designed witness, `geometry.southStrip`, proves the
    height; the unit test's asymmetric `Insets(2, 8, 6, 4)` is what proves the
    placement, and it cannot pass with only the height fixed.

[^delete-setdirection]: The question was whether to fix `setDirection`'s guard
    or remove the method. Three things decide it. It has zero callers — in
    `packages/lib` source and tests, in `packages/docs`, in `packages/qa`, and
    in Loom; every other `setDirection` hit in the repo belongs to
    `CollapseButton` or `SplitGutter`. It cannot be made correct by fixing the
    guard alone: the hover cursor is written once, from the constructor
    ([WindowBorder.ts:126-129](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L126)),
    while `onDragStart` re-reads `dragCursor()` live, so a post-construction
    direction change leaves the two disagreeing — which is the one thing
    `dragCursor`'s JSDoc promises cannot happen. And a strip's direction is
    structural to its owner: `AbstractWindow` holds its eight strips in a named
    record and switches on `border.getDirection()` at
    [AbstractWindow.ts:2213](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2213),
    so re-pointing one strip would desynchronise its name from its behaviour.
    Under the pre-1.0 policy that public API with no callers is deleted rather
    than kept, and with no external value to preserve, the method goes. The
    constructor's identical guard is fixed rather than deleted, because the
    constructor is the sole remaining writer of the field.

[^offline-widths]: `ModelledDOMSource.isConnected`
    ([TestDOM.ts:1221-1222](packages/lib/tests/dom/TestDOM.ts#L1221)) reads a
    per-handle table that defaults to `false` for any handle no test has seeded
    with `setConnected` ([:302](packages/lib/tests/dom/TestDOM.ts#L302)), so
    `getBorderSize()` never reaches `measureBorderWidths` under the harness and
    falls through to `estimateBorderSideWidth`, which parses the leading `1px`
    out of the spec string and resolves a leading `var()` against the seeded
    theme vars. The existing `SelectableListRow` case at
    [content-box-containment.test.ts:696](packages/lib/tests/component/content-box-containment.test.ts#L696)
    asserts a themed 1 px border this way already. The consequence for the
    `MenuBar` cases is that each side is estimated independently: `borderBottom`
    resolves to 1 and the other three sides, which have no spec, to 0.
