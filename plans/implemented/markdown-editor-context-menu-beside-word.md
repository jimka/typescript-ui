---
depends-on: [markdown-task-lists]
touches-shared:
  - packages/lib/src/typescript/lib/core/DOM.ts
  - packages/lib/tests/dom/TestDOM.ts
  - packages/lib/src/typescript/lib/overlay/Menu.ts
  - packages/lib/tests/overlay/Menu.test.ts
  - packages/lib/tests/overlay/Menu.keyboardSession.test.ts
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-editor-context-menu-mounted.test.ts
  - packages/lib/docs/components/Menu.md
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/concepts/dom-seams.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
---

# MarkdownEditor Context Menu Beside the Word — Implementation Plan

## Overview

`MarkdownEditor`'s right-click menu opens at the pointer and grows down and
to the right from it
([MarkdownEditor.ts:12128](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L12128),
[Menu.ts:374](../packages/lib/src/typescript/lib/overlay/Menu.ts#L374)), so it
covers the rest of the word the user right-clicked and the lines below it.
While the user picks a format or a text style, they cannot see what it does
to the word. The Text style presets (Colour, Font, Size) also close the menu
after one pick
([MarkdownEditor.ts:12308](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L12308)).

This plan does three things:

1. `Menu` gains a public method, `showClearOf(x, y, keepClear, items, onClose?, excludeEl?)`.
   It opens a context menu near the pointer but above or below a rectangle it
   must not cover, which this plan calls the **kept-clear area**. Its
   submenus stay on the menu's side of that area where they fit.
2. `MarkdownEditor` measures the text its format and style commands would
   act on and passes it as the kept-clear area: the selection, else the word
   or formatted run a caret widens to, else the caret's line. The
   measurement goes through a new read on the DOM seam,
   `DOM.source.readRangeRects(build)`.
3. The Colour, Font and Size presets become radio rows that keep the menu
   open, show the current choice, and update as the user picks.

This is branch 57 of the Markdown chain. It is written against
`feature/markdown-task-lists` at `09663fdb0`; line numbers are from that
commit. Every other context menu (`CodeEditor`, text inputs, the viewer's
copy menu, tables, trees) keeps opening at the pointer.

---

## Architecture Decisions

### Only the editor's own context menu changes

**Before:** every context menu in the library opens at the pointer.
**After:** `MarkdownEditor`'s WYSIWYG context menu opens clear of the text it
acts on; every other menu, the source-mode menu included, is unchanged.
**Consequence:** no other component's tests or docs move.
**Decided** (the user's call).

### `Menu` gains a separate method, `showClearOf`, rather than a new `show` parameter

**Before:** `menu.show(e.clientX, e.clientY, items)`.
**After:** `menu.showClearOf(e.clientX, e.clientY, wordRect, items)`; `show`
is untouched.
**Consequences:** `show`'s signature and every caller stay as they are,
including every test that spies on `show`. `showClearOf` keeps `show`'s
guarantees: the pointer is clamped into the viewport, a menu opened after a
key press takes keyboard focus, `onClose` fires once, and `excludeEl` is
exempt from the outside-click check.
**Decided:** a new public method, in the positional style of `show` and
`toggleFor`.[^new-method]

The method follows the existing rect-anchored placement: it builds an anchor
rectangle and hands it to the private `showAnchored`
([Menu.ts:409](../packages/lib/src/typescript/lib/overlay/Menu.ts#L409)), which
places the menu with `positionAnchoredFlexible`
([OverlayPosition.ts:217](../packages/lib/src/typescript/lib/core/OverlayPosition.ts#L217))
exactly as `toggleFor` does
([Menu.ts:551](../packages/lib/src/typescript/lib/overlay/Menu.ts#L551)).

### How `showClearOf` places the menu

The anchor rectangle is the pointer's x (zero width) and a vertical span
covering both the kept-clear area and the pointer's y. `positionAnchoredFlexible`
then puts the menu below that span, flips it above when the room below is
short and the room above is larger, aligns its left edge to the pointer, and
flips it to end at the pointer when it would overflow the right edge. A menu
taller than the room on its side is capped and scrolls, as today.

The kept-clear area is first cut to the viewport's height. An area with no
part on screen is ignored: the menu opens as `show(x, y, …)` would.

Worked cases, viewport 1280 × 800, a two-row menu:

| Pointer | Kept-clear area (left, top, right, bottom) | Menu | Why |
|---|---|---|---|
| (300, 110) | (250, 100, 350, 120) | left 300, top 120 | room below |
| (300, 130) | (250, 100, 350, 120) | top 130 | the pointer is below the area, and is not covered either |
| (300, 770) | (250, 760, 350, 780) | bottom at 760 | short room below: flipped above |
| (1270, 110) | (1200, 100, 1275, 120) | right edge at 1270, top 120 | right-edge flip, as `show` |
| (300, 5) | (250, −10, 350, 10) | top 10 | the area is cut to the viewport |
| (300, 770) | (250, 900, 350, 920) | as `show(300, 770)` | no part of the area on screen |

**Consequence:** the menu never covers the area or the pointer, and it moves
away from the pointer only vertically, by at most the area's height.
**Decided.**[^union-with-pointer]

### Submenus stay on the menu's side of the kept-clear area where they fit

Submenus are separate persistent-mode panels opened by
`handleItemOpenSubmenu`
([Menu.ts:1811](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1811)),
placed by `open(anchorEl, parentPanel)`: beside the parent panel, growing
down from the item's top and flipping up against it
([Menu.ts:727](../packages/lib/src/typescript/lib/overlay/Menu.ts#L727)).
When the root menu sits **above** the area, a submenu opened from a row near
its bottom grows down over the word.

`showAnchored` records a **submenu band** on the root menu: the vertical
range of the viewport on the menu's side of the area — from the area's bottom
to the viewport's bottom when the menu landed below, from the viewport's top
to the area's top when it landed above. `show` and `toggleFor` record none.
A submenu reads the band from its root menu (`rootMenu()`,
[Menu.ts:1494](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1494)) and
runs the same vertical placement inside the band instead of the viewport. If
the submenu does not fit in the band at its full height, it is placed as
today.

| Band (top–bottom) | Item top | Submenu height | Submenu top | Why |
|---|---|---|---|---|
| 0–400 (menu above the area) | 380 | 100 | 280 | would grow down over the area; flips up to end at its item |
| 0–400 | 380 | 500 | 380 | does not fit in the band: today's placement |
| 320–800 (menu below the area) | 400 | 200 | 400 | grows down as today |
| none (`show`, `toggleFor`, `MenuBar`) | 380 | 100 | 380 | today's placement |

**Consequence:** a submenu never scrolls because of the band, and a menu
below the area places its submenus exactly as today.[^band-below-noop]
**Decided.**[^band-fit-rule]

### The DOM seam gains `readRangeRects(build)`

Nothing in `DOM.source` measures a text range today. Its selection reads
(`getDocumentSelection`, `getDocumentSelectionText`, `readDocumentSelection`,
[DOM.ts:1583-1613](../packages/lib/src/typescript/lib/core/DOM.ts#L1583)) give
nodes, text, or the live `Selection` to a reader, never geometry.

**After:** `DOMSource.readRangeRects(build: () => Range | null): Rect[]`.
The production source calls `build`, takes the returned range's client
rectangles and gives them back as plain `Rect`s; the live `Range` never leaves
the call. The modelled source returns `[]` without calling `build`.
`MarkdownEditor` passes a `build` that calls Lexical's own
`createDOMRange(editor, anchorNode, anchorOffset, focusNode, focusOffset)`
from `@lexical/selection`, which turns a range of Lexical nodes into a DOM
range over the elements Lexical rendered.

**Consequences:** `DOMSource` gains a required member, a breaking change for a
consumer that implements its own source, with a migration note (as
`readDocumentSelection` had). No module outside `core/DOM.ts` touches the
range's geometry.
**Decided**, mirroring `readDocumentSelection`
([DOM.ts:1613](../packages/lib/src/typescript/lib/core/DOM.ts#L1613),
[TestDOM.ts:1517](../packages/lib/tests/dom/TestDOM.ts#L1517)): the same
shape — the live object exists only inside the call, for a foreign live
widget that resolves it against the DOM it owns — and the same offline
answer.[^seam-read]

The production read guards for a `Range` without `getClientRects` and
returns `[]`, as `decodeImage` guards for a missing `decode()`
([DOM.ts:2526](../packages/lib/src/typescript/lib/core/DOM.ts#L2526)). jsdom,
which the mounted editor tests run in, has no `Range.getClientRects`.

### What the editor keeps clear

The editor keeps clear the text its format and style commands would act on,
read from the Lexical selection after the right-click's selection has been
adopted ([MarkdownEditor.ts:12111](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L12111)):

| Selection | Range measured |
|---|---|
| a range selection | the selection, from its anchor to its focus |
| a caret in a plain word (`he‸llo world`, ‸ the caret) | the word: `hello` |
| a caret in a bold, italic, strikethrough or code run (`**bo‸ld text**`) | the whole run: `bold text` |
| a caret between two spaces, or on punctuation (`a ‸ b`) | the caret itself: its line |
| a caret in an empty paragraph | the paragraph's line break: its line |
| a table selection, an image or rule selected, no selection | nothing: the menu opens at the pointer, as today |

The word and run rule is the editor's own `$computeWordExpansion`
([MarkdownEditor.ts:6971](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L6971)),
the read-only twin of what a format or style command widens a caret to.
**Consequence:** the area is exactly what a pick will change.
**Decided.**[^table-selection]

### A large selection keeps clear only the line under the pointer

A selection is kept clear whole when both hold:

- its height is at most **5 times the height of the line under the
  pointer** — three lines of text at the editor's default line height;
- its height is at most **one third of the viewport's height**.

Otherwise only the line under the pointer is kept clear.[^thresholds]

The **line under the pointer** is the measured rectangle whose vertical span
holds the pointer's y, the shortest one when several do; when none does, the
one nearest to it vertically, the earlier one on a tie. A rectangle that holds
another measured rectangle and is larger than it is an element's box, not a
line of text, and is left out first; a rectangle of zero width (a caret) is never counted as held.[^element-boxes]

Worked cases, viewport height 800, text 20 px high on a 36 px line pitch:

| Measured rectangles (top–bottom) | Pointer y | Kept clear (before growth) | Why |
|---|---|---|---|
| 100–120 | 110 | 100–120 | one line |
| 100–120, 136–156, 172–192 | 150 | 100–192 | 92 ≤ 5 × 20: whole selection |
| 100–120, 136–156, 172–192, 208–228 | 150 | 136–156 | 128 > 100: the pointer's line |
| 100–120, 136–156, 172–192, 208–228 | 126 | 100–120 | between two lines: the nearer one (6 against 10) |
| a paragraph box 96–232 plus the four lines above | 150 | 136–156 | the box holds lines, so it is left out |
| 100–120, 136–156, 172–192, in a viewport 240 high | 150 | 136–156 | 92 > 240 / 3 |
| none | — | nothing: opens at the pointer | |

**Decided.**

### Room for the word to grow

The kept-clear area is grown by `(1.2 − 1) ×` the height of the line under
the pointer, above and below. 1.2 is the Large size preset (`1.2em`). In the
first worked case of the previous table, 100–120 becomes 96–124.

**Consequence:** picking Large on a word with the menu open below it does not
push the word's lower edge under the menu.[^growth]
**Decided.**

### A menu opened from the keyboard is placed under the caret

Shift+F10 and the ContextMenu key raise a `contextmenu` on the editor's root
element, which the editor already resolves to the caret
([MarkdownEditor.ts:8146](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L8146)).
It is a keyboard open when the event's target resolves to the root node and
`Menu.lastInputWasKeyPress()` is `true`
([Menu.ts:1350](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1350)).

**Before:** the menu opens at the point the browser reports.
**After:** the kept-clear area is chosen as for a right-click, and the point
handed to `showClearOf` is the bottom-left corner of the caret at the
selection's focus, measured with `readRangeRects`. When the caret cannot be
measured, the browser's point is used.
**Consequence:** the same rule in every browser, the large-selection fallback
keeping clear the caret's line.
**Decided**, mirroring `resolveContextMenuTarget`
([resolveContextMenuTarget.ts:76](../packages/lib/src/typescript/lib/component/shared/resolveContextMenuTarget.ts#L76)),
which places a keyboard-opened `Tree`, `List` or `Table` menu under the
current item's bottom-left corner with the same keyboard test.[^keyboard-point]

### The Text style presets are radio rows that keep the menu open

**Before:** Colour ▸ Red is a plain item; picking it styles the word and
closes the whole menu.
**After:** each preset is a `RadioMenuRow`. Picking Red styles the word, Red's
radio turns on and the others off, and the menu stays open; Blue then
restyles the same word. Each submenu shows the current value when it opens:
`Default` when the text carries none.
**Consequences:** the presets look like radio buttons. Escape, an outside
click and window blur still close the menu, through `LayerManager` as today.
**Decided**, following `Split`'s gutter menu
([Split.ts:1766-1850](../packages/lib/src/typescript/lib/layout/Split.ts#L1766)):
radio rows built by factories, each `"action"` listener re-reading the live
state and writing every row's checked state.[^radio-rows]

The current value is read with Lexical's
`$getSelectionStyleValueForProperty(selection, property, "")` from
`@lexical/selection`: the value every selected text node carries, or `""`.
A preset is checked when its value equals that reading; `Default` stands for
`""`.

| Text under the caret | Colour submenu shows |
|---|---|
| `word` | Default |
| `[word]{color=#2563eb}` | Blue |
| `[word]{color=orange}` | nothing checked |
| a selection over `[red]{color=#cc0000} plain` | Default |

The last row is a known limit: Lexical reports a mixed value as `""`.
**Decided.**[^mixed-value]

The first pick on a caret widens it to the word (the commands' existing
`$selectEnclosingWordIfCollapsed`), so every later pick in the same open
menu restyles the same word.

### Each preset pick is its own undo step

**Before / after:** unchanged — picking Red then Blue and pressing Ctrl+Z
once gives the red word; a second Ctrl+Z gives the plain word.
**Consequence:** no history change; a test pins the behaviour.
**Decided**, following the editor's history rule that no command is merged
into the step before it
([markdownHistory.ts:43-74](../packages/lib/src/typescript/lib/component/editor/markdownHistory.ts#L43)).[^undo]

### Source mode keeps its own menu at the pointer

In source mode the menu on the surface is `CodeEditor`'s own clipboard menu
([CodeEditor.ts:3023](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L3023)),
with no format or style item. It keeps opening at the pointer.
**Decided:** it is `CodeEditor`'s menu, which the scope leaves unchanged, and
it has no style to watch.

---

## Public API

```typescript
// overlay/Menu.ts — rebuild mode only, like show() and toggleFor().
class Menu extends Component implements DismissableLayer {
    showClearOf(
        x: number,
        y: number,
        keepClear: Rect,
        configs: MenuItemConfig[],
        onClose?: () => void,
        excludeEl?: Handle | null,
    ): this;
}
```

```typescript
// core/DOM.ts
interface DOMSource {
    readRangeRects(build: () => Range | null): Rect[];
}
```

Both are new. No option-bag field: neither is component state.

---

## Internal Structure

### `Menu.ts`

```typescript
/** A zero-width anchor at the pointer's x spanning `top`–`bottom`; see showClearOf. */
function pointerSpanRect(x: number, top: number, bottom: number): Rect {
    return { x, y: top, left: x, top, right: x, bottom, width: 0, height: bottom - top };
}

// Field, beside _parentMenu (Menu.ts:216):
// The vertical range of the viewport a submenu of this rebuild-mode menu is
// placed in, on the menu's side of the area showClearOf kept clear; null when
// the menu was opened by show() or toggleFor(), or is a persistent menu.
private _submenuBand: { top: number; bottom: number } | null = null;

showClearOf(x, y, keepClear, configs, onClose?, excludeEl?): this {
    this.assertRebuildMode("showClearOf");

    const vp = DOM.source.getViewportSize();
    const px = Util.clamp(x, 0, vp.width);
    const py = Util.clamp(y, 0, vp.height);
    const top = Math.max(keepClear.top, 0);
    const bottom = Math.min(keepClear.bottom, vp.height);
    const onScreen = bottom >= top;
    const anchor = onScreen ? pointerSpanRect(px, Math.min(top, py), Math.max(bottom, py)) : pointRect(px, py);

    this.showAnchored(anchor, configs, onClose ?? null, excludeEl ?? null, onScreen);

    if (Menu.lastInputWasKey) {
        this.takeKeyboardFocus();
    }

    return this;
}
```

`showAnchored` gains a last parameter `confinesSubmenus: boolean`. Right after
`const placement = positionAnchoredFlexible(…)`
([Menu.ts:484](../packages/lib/src/typescript/lib/overlay/Menu.ts#L484)):

```typescript
const landedBelow = placement.y >= anchorRect.bottom;

this._submenuBand = !confinesSubmenus ? null
    : landedBelow ? { top: anchorRect.bottom, bottom: vp.height }
    : { top: 0, bottom: anchorRect.top };
```

`show` and `toggleFor` pass `false`.

In `open()`'s submenu branch, `const y = this.placeVertically(anchorRect.top, anchorRect.top, totalHeight, vp.height);`
([Menu.ts:736](../packages/lib/src/typescript/lib/overlay/Menu.ts#L736))
becomes `const y = this.placeSubmenuVertically(anchorRect.top, totalHeight, vp.height);`:

```typescript
private placeSubmenuVertically(itemTop: number, totalHeight: number, viewportHeight: number): number {
    const band = this.rootMenu()._submenuBand;

    if (band !== null) {
        const inBand = positionFlexibleAnchored(
            itemTop - band.top, itemTop - band.top, totalHeight, band.bottom - band.top, VIEWPORT_MARGIN,
        );

        if (totalHeight <= inBand.available) {
            this.applyScrollbarGutterWidth(false);
            this.applyViewportHeightClamp(inBand.available, totalHeight);

            return inBand.start + band.top;
        }
    }

    return this.placeVertically(itemTop, itemTop, totalHeight, viewportHeight);
}
```

`handleItemOpenSubmenu` sets `submenuPanel._parentMenu` before it calls
`open` ([Menu.ts:1836](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1836),
[:1854](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1854)), so
`rootMenu()` reaches the context menu from every depth. A `MenuBar`
dropdown's root is a persistent menu whose band is always `null`.

### `DOM.ts` and `TestDOM.ts`

```typescript
// ProductionDOMSource, beside readDocumentSelection (DOM.ts:3001):
readRangeRects(build: () => Range | null): Rect[] {
    const range = build();

    // No Range geometry in this environment (jsdom): nothing to measure, as decodeImage's guard.
    if (range === null || typeof range.getClientRects !== "function") {
        return [];
    }

    return Array.from(range.getClientRects(), toRect);
}

// ModelledDOMSource, beside readDocumentSelection (TestDOM.ts:1517):
/** No live DOM offline; `build` is never called, mirroring readDocumentSelection. */
readRangeRects(_build: () => Range | null): Rect[] {
    return [];
}
```

### `MarkdownEditor.ts` — the kept-clear area

Module level, beside `$contextMenuNodeFor`
([MarkdownEditor.ts:8146](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L8146)):

```typescript
/** The Large size preset's scale, in `em`; also the growth the kept-clear area leaves room for. */
const LARGE_TEXT_SCALE = 1.2;

/** Tallest selection kept clear whole, in heights of the pointer's line: three lines at line height 1.8 measure 4.6. */
const KEPT_CLEAR_MAX_TEXT_HEIGHTS = 5;

/** Largest share of the viewport's height a selection kept clear whole may take. */
const KEPT_CLEAR_MAX_VIEWPORT_SHARE = 1 / 3;

/** One end of the range the context menu keeps clear. */
interface KeptClearPoint { node: LexicalNode; offset: number }

/** Exported for tests. The range a format or style command acts on: the selection, the word or run a caret widens to, or the caret; null otherwise. */
export function $keptClearPoints(): { anchor: KeptClearPoint; focus: KeptClearPoint } | null;

/** Exported for tests. The area to keep clear from the measured rectangles, grown; null when there are none. */
export function contextMenuKeptClearArea(rects: readonly Rect[], pointerY: number, viewportHeight: number): Rect | null;
```

`contextMenuKeptClearArea` runs, in order: drop the rectangles with no height
or that hold a smaller measured rectangle of non-zero width; return `null` when none is left;
pick the line under the pointer; take the bounding rectangle of all of them;
keep it when it passes both limits, else keep the line; grow it by
`(LARGE_TEXT_SCALE - 1) * line.height` above and below. Each step is a
module-private function named for what it does (`withoutElementBoxes`,
`lineUnderPointer`, `boundingRect`, `grownVertically`), per the decomposition
rule.

`$keptClearPoints` returns `null` unless the selection is a range selection.
For a range it returns the selection's anchor and focus, backward or not
(`createDOMRange` reverses a backward pair). For a caret with a
`$computeWordExpansion` it returns `(expansion.node, expansion.start)` and
`(expansion.node, expansion.end)`; otherwise the caret's own point twice.

The handler, after `context` is resolved
([MarkdownEditor.ts:12124](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L12124)):

```typescript
const items = this.buildContextMenuItems(context);
const placement = this.contextMenuPlacement(event, isRootTarget);

if (placement.keepClear === null) {
    this._contextMenu.show(placement.x, placement.y, items);

    return;
}

this._contextMenu.showClearOf(placement.x, placement.y, placement.keepClear, items);
```

`isRootTarget` is `$isRootNode(node)`, read in the handler's existing
`editor.read` beside the classification. `contextMenuPlacement(event, isRootTarget)`
(private) returns `{ x: number; y: number; keepClear: Rect | null }`:

1. Inside `editor.read`: `points = $keptClearPoints()`; when not `null`,
   `rects = DOM.source.readRangeRects(() => createDOMRange(editor, points.anchor.node, points.anchor.offset, points.focus.node, points.focus.offset))`;
   when `null`, `rects` is `[]` and `readRangeRects` is not called.
2. In the same `editor.read`, when `isRootTarget && Menu.lastInputWasKeyPress()`
   and the selection is a range selection: a second `readRangeRects` over the collapsed range at
   `selection.focus`; its first rectangle, if any, gives the point
   `(rect.left, rect.bottom)`. Always after step 1.
3. Otherwise the point is `(event.clientX, event.clientY)`.
4. `keepClear = contextMenuKeptClearArea(rects, point.y, DOM.source.getViewportSize().height)`.

The `build` arrows name no DOM type, so `no-raw-dom` stays green.

### `MarkdownEditor.ts` — the presets

```typescript
/** One preset of the Text style submenus: its label and the value it applies (`null` clears it). */
interface TextStylePreset { text: string; value: string | null }

const TEXT_COLOUR_PRESETS: readonly TextStylePreset[] = [
    { text: "Red", value: "#cc0000" }, { text: "Green", value: "#008000" },
    { text: "Blue", value: "#2563eb" }, { text: "Default", value: null },
];
const FONT_FAMILY_PRESETS: readonly TextStylePreset[] = [
    { text: "Serif", value: "Georgia, serif" }, { text: "Monospace", value: "monospace" }, { text: "Default", value: null },
];
const FONT_SIZE_PRESETS: readonly TextStylePreset[] = [
    { text: "Small", value: "0.8em" }, { text: "Large", value: `${LARGE_TEXT_SCALE}em` }, { text: "Default", value: null },
];

private buildStylePresetItems(
    property: "color" | "font-family" | "font-size",
    presets: readonly TextStylePreset[],
    apply: (value: string | null) => void,
): MenuItemConfig[] {
    // Reassigned each time the submenu opens: a submenu panel calls every factory again.
    const rows: Array<RadioMenuRow | null> = presets.map(() => null);
    const isCurrent = (preset: TextStylePreset, current: string): boolean => (preset.value ?? "") === current;
    const syncRows = (): void => {
        const current = this.readSelectionStyleValue(property);

        presets.forEach((preset, index) => { rows[index]?.setChecked(isCurrent(preset, current)); });
    };

    return presets.map((preset, index) => ({
        row: () => {
            const row = new RadioMenuRow({ text: preset.text, checked: isCurrent(preset, this.readSelectionStyleValue(property)) });
            const applyPreset = (): void => {
                apply(preset.value);
                syncRows();
            };

            row.on("action", applyPreset);
            rows[index] = row;

            return row;
        },
    }));
}

/** The style value every text node a style command would act on carries, or "". */
private readSelectionStyleValue(property: string): string {
    return this.ensureEditor().read(() => {
        const selection = $getSelection();

        return selection === null ? "" : $getSelectionStyleValueForProperty(selection, property, "");
    });
}
```

`buildTextStyleMenuItem` keeps its shape and labels; its three `items` arrays
become `this.buildStylePresetItems("color", TEXT_COLOUR_PRESETS, (value) => this.setTextColor(value))`,
`… ("font-family", FONT_FAMILY_PRESETS, (value) => this.setFontFamily(value))`
and `… ("font-size", FONT_SIZE_PRESETS, (value) => this.setFontSize(value))`.
The `presetItem` helper goes.

---

## Ordered Implementation Steps

Each step writes its tests first (see *Expected Behaviour*), then the code.

1. **Seam read.** In `core/DOM.ts` add `readRangeRects` to the `DOMSource`
   interface after `readDocumentSelection`
   ([DOM.ts:1613](../packages/lib/src/typescript/lib/core/DOM.ts#L1613)), with
   JSDoc in the same shape (named escape, the range lives only for the call,
   `[]` offline, `build`'s return deliberately unannotated at call sites).
   Implement it in `ProductionDOMSource` and in `ModelledDOMSource`
   (`tests/dom/TestDOM.ts`) as in *Internal Structure*. Create
   `tests/dom/read-range-rects.test.ts` modelled on
   `tests/dom/read-document-selection.test.ts`. Check:
   `npx vitest run tests/dom/read-range-rects.test.ts tests/dom/read-document-selection.test.ts`.
2. **`Menu.showClearOf`.** In `overlay/Menu.ts`: add `pointerSpanRect` beside
   `pointRect` ([Menu.ts:48](../packages/lib/src/typescript/lib/overlay/Menu.ts#L48)),
   the `_submenuBand` field, the `confinesSubmenus` parameter of
   `showAnchored` (`show` and `toggleFor` pass `false`), the band assignment,
   and `showClearOf` after `show` (`Util` is already imported). JSDoc on
   `showClearOf` states the placement, the band, and `show`'s keyboard and
   dismissal guarantees; it may link `show`, `toggleFor` and `Rect` only.
   Update the class JSDoc's rebuild-mode bullet and the "valid only in
   rebuild mode" list to name `showClearOf`. Check: the new
   `Menu.test.ts` groups and the whole `tests/overlay` folder pass.
3. **Submenu band.** Add `placeSubmenuVertically` next to `placeVertically`
   ([Menu.ts:1115](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1115))
   and call it from `open()`'s submenu branch. Check:
   `grep -n "placeVertically(anchorRect.top" src/typescript/lib/overlay/Menu.ts`
   — expect zero matches; `tests/overlay` passes.
4. **Keyboard focus.** Add the two keyboard rows to
   `tests/overlay/Menu.keyboardSession.test.ts`; they pass with step 2's code.
5. **Editor: kept-clear area.** In `MarkdownEditor.ts` add `LARGE_TEXT_SCALE`,
   `KEPT_CLEAR_MAX_TEXT_HEIGHTS`, `KEPT_CLEAR_MAX_VIEWPORT_SHARE`, `KeptClearPoint`, `$keptClearPoints`,
   `contextMenuKeptClearArea` and its four helpers (each with JSDoc carrying
   the `@remarks Exported … so it can be tested directly` note where
   exported), and `contextMenuPlacement`. Change `handleWysiwygContextMenu`
   as in *Internal Structure* and rewrite its JSDoc: the menu opens clear of
   the text its items act on; a keyboard open is placed under the caret.
   Update `_contextMenu`'s JSDoc ([MarkdownEditor.ts:9064](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L9064))
   to say it is rebuilt on every `show` or `showClearOf`. Add `createDOMRange`
   and `$getSelectionStyleValueForProperty` to the `@lexical/selection`
   import ([MarkdownEditor.ts:66](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L66)),
   `Rect` to the `~/core/DOM.js` type import. Check: every existing
   `markdown-editor*.test.ts` passes unchanged (offline the modelled source
   measures nothing, so `show` is still called), plus the new rows.
6. **Editor: presets.** Add `TextStylePreset`, the three preset constants,
   `buildStylePresetItems` and `readSelectionStyleValue`; rewrite
   `buildTextStyleMenuItem`'s items and JSDoc (each preset is a radio row
   that keeps the menu open and shows the current value); import
   `RadioMenuRow` from `~/component/container/RadioMenuRow.js`. Restate the
   test at [markdown-editor.test.ts:5077](../packages/lib/tests/component/markdown-editor.test.ts#L5077)
   (see *Tests that are restated*). Check:
   `grep -n "presetItem" src/typescript/lib/component/editor/MarkdownEditor.ts`
   — expect zero matches.
7. **Panel comment.** In `MarkdownDocumentPanel.ts`
   ([:394](../packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L394))
   replace "verbatim from MarkdownEditor's own buildTextStyleMenuItem" with
   "the same presets as MarkdownEditor's context menu, as plain items that
   close the dropdown". No code change.
8. **Mounted test.** Add the jsdom row to
   `markdown-editor-context-menu-mounted.test.ts`.
9. **Docs.** Per *Documentation Impact*.
10. **Verify.** Per *Verification*, then the manual browser checks.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Create | `packages/lib/tests/dom/read-range-rects.test.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Menu.ts` |
| Modify | `packages/lib/tests/overlay/Menu.test.ts` |
| Modify | `packages/lib/tests/overlay/Menu.keyboardSession.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts` (comment only) |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-context-menu-mounted.test.ts` |
| Modify | `packages/lib/docs/components/Menu.md` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/concepts/dom-seams.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |

---

## Expected Behaviour

Everything below is offline (modelled DOM) unless marked jsdom or manual.
The Menu rows use `Menu.test.ts`'s `CONFIG` (viewport 1280 × 800,
`VIEWPORT_MARGIN` 4) and its `rect(left, top, right, bottom)` helper.

### The seam (`tests/dom/read-range-rects.test.ts`)

Production rows run under the `@vitest-environment jsdom` pragma, like
`read-document-selection.test.ts`.

1. **Measures what `build` returns:** `build` returns an object whose
   `getClientRects()` gives two rectangle-like values; the result is two
   plain `Rect`s with every edge copied.
2. **No range:** `build` returns `null` → `[]`.
3. **A range without geometry:** `build` returns `document.createRange()`
   (jsdom has no `getClientRects`) → `[]`, no throw.
4. **Offline:** `ModelledDOMSource.readRangeRects(build)` → `[]`, and `build`
   is never called.

### `showClearOf` placement (`Menu.test.ts`, a new group *Menu showClearOf — placement*)

Menu of two items `[{ text: 'A' }, { text: 'B' }]` unless stated.

1. **Room below:** `showClearOf(300, 110, rect(250, 100, 350, 120), items)` → `getX()` 300, `getY()` 120.
2. **Pointer below the area:** `showClearOf(300, 130, rect(250, 100, 350, 120), items)` → `getY()` 130.
3. **Near the bottom edge:** `showClearOf(300, 770, rect(250, 760, 350, 780), items)` → `getY() + getHeight()` is 760.
4. **Near the right edge:** `showClearOf(1270, 110, rect(1200, 100, 1275, 120), items)` → `getX() + getWidth()` is 1270, `getY()` 120.
5. **Near the left edge:** `showClearOf(0, 110, rect(0, 100, 50, 120), items)` → `getX()` is `VIEWPORT_MARGIN`, as `show(0, 110, items)` gives; `getY()` 120.
6. **Area running off the top:** `showClearOf(300, 5, rect(250, -10, 350, 10), items)` → `getY()` 10.
7. **Area off-screen:** `showClearOf(300, 770, rect(250, 900, 350, 920), items)` → `getX()` and `getY()` equal what `show(300, 770, items)` gives on a second menu.
8. **Long menu, area in the middle:** 60 items, `showClearOf(300, 400, rect(250, 380, 350, 420), items)` → `getY()` 420, `getMaxSize().height` 376.
9. **Long menu, area low:** 60 items, `showClearOf(300, 610, rect(250, 600, 350, 620), items)` → `getY()` is `VIEWPORT_MARGIN`, `getMaxSize().height` 596, `getY() + getHeight()` 600.
10. **Rebuild mode only:** a persistent menu (`new Menu([{ text: 'A' }], () => {})`) throws on `showClearOf`.
11. **`onClose` and `excludeEl`:** `showClearOf(…, onClose, excluded)` registers with `LayerManager`; `getAnchorElement()` is `excluded`; `hide()` fires `onClose` once and unregisters.

### The submenu band (`Menu.test.ts`, a new group *Menu showClearOf — submenus*)

Bracket access, as the existing `placeVertically` helper does
([Menu.test.ts:61](../packages/lib/tests/overlay/Menu.test.ts#L61)).

1. **Band recorded below:** after row 1 of *showClearOf placement*, `_submenuBand` is `{ top: 120, bottom: 800 }`.
2. **Band recorded above:** after row 3 of *showClearOf placement*, `_submenuBand` is `{ top: 0, bottom: 760 }`.
3. **No band from `show` or `toggleFor`:** after `show(…)`, and after `toggleFor(…)`, `_submenuBand` is `null`, also when the same menu carried a band from an earlier `showClearOf`.
4. **Flips up inside a band above the area:** a persistent menu with `_submenuBand = { top: 0, bottom: 400 }`; `placeSubmenuVertically(380, 100, 800)` → 280, `getMaxSize().height` 376.
5. **Does not fit the band:** same band, `placeSubmenuVertically(380, 500, 800)` → 380.
6. **Band below the area:** `_submenuBand = { top: 320, bottom: 800 }`, `placeSubmenuVertically(400, 200, 800)` → 400.
7. **No band:** `placeSubmenuVertically(380, 100, 800)` → 380, as `placeVertically(380, 380, 100, 800)`.
8. **Reached from a submenu:** a rebuild menu opened with `showClearOf` and an `Export` submenu item; after `_onOpenSubmenu`, the child panel's `rootMenu()` is the rebuild menu (its band is the one read).

### Keyboard (`Menu.keyboardSession.test.ts`, group *session start*)

1. **Key press then `showClearOf`:** after `keyInput()`, `showClearOf(…)` focuses the panel and highlights the first enabled row, as `showFromKeyboard` does with `show`.
2. **Pointer press then `showClearOf`:** after `pointerInput()`, focus stays on the opener.

### The kept-clear rule (`markdown-editor.test.ts`, a new group *contextMenuKeptClearArea*)

Rows are the worked table of *A large selection keeps clear only the line
under the pointer*, viewport height 800 unless stated, with growth applied
(4 for 20-px lines):

1. **One line:** `[rect(30, 100, 80, 120)]`, pointer y 110 → `(30, 96, 80, 124)`.
2. **Three lines kept whole:** three line rectangles 100–120, 136–156, 172–192 (left 30, right 300), pointer 150 → top 96, bottom 196, left 30, right 300.
3. **Four lines, pointer's line:** four lines, pointer 150 → top 132, bottom 160.
4. **Between two lines:** four lines, pointer 126 → top 96, bottom 124.
5. **Element box left out:** a box `rect(0, 96, 600, 232)` plus the four lines, pointer 150 → top 132, bottom 160.
6. **Viewport share:** three lines, viewport height 240, pointer 150 → top 132, bottom 160.
7. **Zero-width caret:** `[rect(40, 100, 40, 120)]`, pointer 110 → `(40, 96, 40, 124)`.
8. **Nothing measured:** `[]` → `null`; a rectangle of height 0 only → `null`.

### What is measured (`markdown-editor.test.ts`, group *$keptClearPoints*)

Read inside `lexicalOf(editor).read`, the selection set by an update as the
existing `$classifyContextMenuTarget` tests do:

1. **Plain word:** `hello world`, caret at 2 → the text node at 0 and at 5.
2. **Formatted run:** `**bold text** end`, caret at 3 in `bold text` → that node at 0 and at 9.
3. **No word:** `a  b`, caret at 2 → the caret's point twice.
4. **Range selection:** a backward selection over `ell` → its anchor and focus as they are.
5. **Empty paragraph:** caret in an empty paragraph → the paragraph's element point twice.
6. **Table selection:** two cells selected → `null`.
7. **No selection:** `null`.

### The wiring (`markdown-editor.test.ts`, group *MarkdownEditor context menu — caret and availability*)

Uses the group's `contextMenuEventOn` and `browserCaretIs` helpers, with
spies on `DOM.source.readRangeRects` and on the editor's `_contextMenu`
`show` and `showClearOf`:

1. **A word is kept clear:** caret at 2 in `hello`, `readRangeRects` returns `[rect(30, 40, 80, 60)]`, event at (40, 50) → `showClearOf(40, 50, rect(30, 36, 80, 64), items)`; `show` not called.
2. **Nothing measured:** `readRangeRects` returns `[]` → `show(40, 50, items)`; `showClearOf` not called.
3. **Keyboard open:** the last input a key press (a `keydown` dispatched through `DOM.sink.dispatchEvent`, as `Menu.keyboardSession.test.ts`'s `keyInput` does; a `pointerdown` in the test's teardown resets it), `browserCaretIs('hello', 2)`, event on `'root'` at (5, 5), `readRangeRects` returning `[rect(200, 100, 260, 120)]` then `[rect(230, 100, 230, 120)]` → `showClearOf(230, 120, rect(200, 96, 260, 124), items)`.
4. **Keyboard open, caret not measured:** as row 3 with the second call returning `[]` → `showClearOf(5, 5, rect(200, 96, 260, 124), items)`.
5. **A right-click on the root is not a keyboard open:** `browserCaretIs('hello', 2)`, event on `'root'` after a pointer press → `readRangeRects` called once.
6. **Table selection:** two cells selected → `readRangeRects` not called; `show` at the event's point.

### The presets (`markdown-editor.test.ts`, group *MarkdownEditor context menu*)

The Colour, Font and Size items are row factories in a fixed order (Colour:
Red, Green, Blue, Default; Font: Serif, Monospace, Default; Size: Small,
Large, Default). A row is built with `item.row()` and picked with
`row.activate()`.

1. **Radio rows:** every Colour item builds a `RadioMenuRow`; with the caret in `word`, only Default is checked.
2. **Current value shown:** caret in `[word]{color=#2563eb}` → only Blue is checked; caret in `[word]{color=orange}` → none is checked.
3. **A pick styles the word and moves the check:** caret in `word`, build all four Colour rows, activate Red → value `[word]{color=#cc0000}`; Red checked, Green, Blue and Default unchecked.
4. **A second pick restyles the same word:** then activate Blue → `[word]{color=#2563eb}`; only Blue checked.
5. **Default clears:** Red, then Default → `word`; only Default checked.
6. **Font and Size:** Serif → `[word]{font="Georgia, serif"}`, Serif checked; Large → `[word]{size=1.2em}`, Large checked.
7. **Reopening reads the live value:** after Red, calling the Colour factories again builds rows with only Red checked.
8. **One undo step per pick:** Red then Blue; `UNDO_COMMAND` once → `[word]{color=#cc0000}`; once more → `word`. If this fails, stop and report: the history is not to be changed by this plan.
9. **The menu stays open:** on a fresh `new Menu()`, `show` the items of a `"text"` context, open Text style then Colour with `_onOpenSubmenu`, activate the Colour panel's first row → the Text style panel's `_openSubmenuPanel` is still the Colour panel, and `LayerManager.getTopLayer()` is the Colour panel.
10. **Dismissal still closes it:** continuing row 9, `menu.requestClose()` (what `LayerManager` calls on Escape, an outside press and window blur) → the root's `_openSubmenuPanel` is `null` and the menu is no longer registered.

### Mounted (`markdown-editor-context-menu-mounted.test.ts`, jsdom)

1. **No range geometry:** a right-click in prose under jsdom opens with `show` at (40, 50); `showClearOf` is not called; nothing throws.

### Tests that are restated

- [markdown-editor.test.ts:5077](../packages/lib/tests/component/markdown-editor.test.ts#L5077),
  *the "Text style" submenu's Colour ▸ Red item reaches setTextColor, and
  Colour ▸ Default clears it*: the items have no `text` or `action` any more.
  Build the rows with `item.row()` and activate index 0 (Red) and index 3
  (Default); the two expected values are unchanged.

Every other existing test passes unchanged.

### Manual (browser) checks

Run the demo's Markdown editor (`npm run dev` at the repo root, the Markdown
document panel), in Chromium and WebKitGTK, light and dark:

1. Right-click a word in the middle of a paragraph: the menu opens just below
   the word's line, its left edge at the pointer, and the whole word stays
   visible.
2. Same near the bottom of the editor and of the window: the menu opens above
   the word, its bottom just above the word.
3. Same near the right edge: the menu ends at the pointer and still clears the
   word.
4. Select two lines and right-click on the second: the menu opens below both.
   Select a whole long paragraph and right-click: the menu opens below the
   line under the pointer.
5. Right-click a word, Text style ▸ Colour: the radios show Default; pick
   Red, then Blue, then Green — the word changes each time, the radio follows,
   and the menu stays open. Same for Font and Size; with Large the word grows
   and stays clear of the menu.
6. With the menu above a word, open Text style from a row near the menu's
   bottom: the submenus stay above the word.
7. Escape closes the whole menu; a click outside closes it; after either,
   Ctrl+Z steps back through the picks one at a time.
8. Shift+F10 with the caret in a word: the menu opens under the word with the
   first row highlighted; ↓, → and Enter pick a colour and the menu stays
   open.
9. Right-click a word in a table cell: the menu clears the word. Select two
   cells, or select an image, and right-click: the menu opens at the pointer
   as before.
10. Source mode: the clipboard menu still opens at the pointer.

---

## Verification

- `npm run typecheck` and `npm run lint` (repo root): clean; the editor's
  `build` arrows name no DOM type (`no-raw-dom`).
- The suites of the steps, then `npx vitest run --maxWorkers=2` in
  `packages/lib` and `npm run typecheck:test`.
- `packages/lib/tests/unit/import-without-dom.test.ts` passes: the new
  constants touch no DOM at load.
- `npm run docs:api` (repo root): zero warnings. `showClearOf`'s and
  `readRangeRects`'s JSDoc link only public symbols.
- The grep checkpoints of steps 3 and 6.
- *Manual (browser) checks*.

---

## Documentation Impact

- `docs/components/Menu.md`:
  - The intro's rebuild-mode bullet and the "valid only in rebuild mode"
    sentence name `showClearOf()`.
  - *Rebuild mode*: a new paragraph and example after the `toggleFor`
    paragraph — **Keeping an area clear.** `showClearOf(x, y, keepClear, items, onClose?, excludeEl?)`
    opens like `show()` at the pointer, but below or above `keepClear` (a
    viewport rectangle, e.g. the text the menu's items will change), so the
    menu covers neither; it stays aligned to the pointer horizontally, flips
    above when the room below is short, and an off-screen `keepClear` is
    ignored. Its submenus stay on the menu's side of `keepClear` when they
    fit there. Keyboard focus, `onClose` and `excludeEl` behave as in
    `show()`. Example:
    `menu.showClearOf(e.clientX, e.clientY, DOM.source.getViewportRect(label), items);`
  - *Keyboard › Context menus*: the first sentence says that `showClearOf()`
    takes focus and handles keys exactly as `show()` does.
- `docs/components/MarkdownEditor.md`, *Formatting* › right-click bullet
  ([MarkdownEditor.md:124](../packages/lib/docs/components/MarkdownEditor.md#L124)):
  - After "No consumer wiring needed …": the menu opens below the text its
    items act on — the selection, the word or formatted run under the caret,
    or the caret's line — and above it when the room below is short, staying
    level with the pointer horizontally; for a selection taller than three
    lines or a third of the window it keeps clear only the line under the
    pointer; its submenus stay on the same side.
  - "positioned there" for Shift+F10 becomes "positioned under the caret's
    text, the same way".
  - The Text style sentence: each preset is a radio row showing the current
    value (Default when none, nothing when the text carries a value no preset
    has, Default for a selection whose parts differ), and picking one applies
    it and leaves the menu open, so several can be tried on the same word;
    each pick is one undo step.
- `docs/concepts/dom-seams.md`
  ([:65](../packages/lib/docs/concepts/dom-seams.md#L65)): after the
  `readDocumentSelection(reader)` sentence, one on `readRangeRects(build)` —
  the second read-side named escape: it calls `build`, measures the range it
  returns, and gives the client rectangles back as plain `Rect`s
  (`MarkdownEditor` has Lexical build a range over the text a context menu
  must keep clear); a modelled source returns `[]` without calling `build`.
- `docs/reference/changelog/next.md`:
  - **Breaking changes › Core**, after the `readDocumentSelection` entry:
    *`DOMSource` gains one required member: `readRangeRects()`*, with the
    migration link.
  - **Added › Overlay**: *`Menu.showClearOf(x, y, keepClear, items, onClose?, excludeEl?)`*
    opens a context menu at the pointer but clear of a rectangle, with its
    submenus kept on the same side where they fit. Links
    [Menu](/components/Menu).
  - **Changed › Components**: *`MarkdownEditor`'s context menu opens clear of
    the text it acts on, and its Text style presets keep it open.* The
    placement rule, the keyboard open under the caret, the radio rows with
    the current value, one undo step per pick. No consumer action is needed.
- `docs/reference/migration/next.md`: a section *`DOMSource` gains
  `readRangeRects`* right after *`DOMSource` gains `readDocumentSelection`*
  ([:165](../packages/lib/docs/reference/migration/next.md#L165)), in the
  same three parts (what changed and why; who needs to act — only a custom
  `DOMSource`; the code: `readRangeRects(_build: () => Range | null): Rect[] { return []; }`).
- `MarkdownDocumentPanel.md` is unchanged: its toolbar dropdown keeps
  closing on a pick.

---

## Potential Challenges

- **The menu does not follow the word after it opens.** The area is measured
  once, at open; growth headroom covers Large. Keep it so: moving an open
  menu is out of scope.
- **Selection highlight over the colour.** After the first pick the word is
  selected, so its colour shows through the browser's selection highlight;
  check it in manual check 5 and report rather than restyle the selection.
- **A word whose parts have different sizes.** Its run is measured as one
  range, so its rectangles cover the tallest part; nothing to do.
- **`Menu.lastInputWasKey` is static.** A test that records a key press
  must record a pointer press in its teardown, or later tests open as if
  from the keyboard.
- **`createDOMRange` needs the editor's rendered DOM.** Offline it is never
  called (the modelled source does not call `build`); under jsdom it runs
  and the guard returns `[]`. Do not call it outside `readRangeRects`.
- **jsdom tests that open a real menu.** `rightClickIn` in the mounted file
  mocks only `show`; if a mounted test ever measured rectangles it would need
  `showClearOf` mocked too.

---

## Critical Files

- [overlay/Menu.ts](../packages/lib/src/typescript/lib/overlay/Menu.ts) — `show`, `showAnchored`, `toggleFor`, `open`, `placeVertically`, `handleItemOpenSubmenu`, `rootMenu`.
- [core/OverlayPosition.ts](../packages/lib/src/typescript/lib/core/OverlayPosition.ts) — `positionFlexibleAnchored`, `positionAnchoredFlexible`.
- [core/DOM.ts](../packages/lib/src/typescript/lib/core/DOM.ts) — `readDocumentSelection` (interface and production), `decodeImage`'s guard, `toRect`.
- [tests/dom/TestDOM.ts](../packages/lib/tests/dom/TestDOM.ts) — `ModelledDOMSource.readDocumentSelection`.
- [tests/dom/read-document-selection.test.ts](../packages/lib/tests/dom/read-document-selection.test.ts) — the model for the seam test.
- [component/editor/MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) — `handleWysiwygContextMenu`, `$contextMenuNodeFor`, `$computeWordExpansion`, `patchSelectionStyle`, `buildTextStyleMenuItem`, `buildFormatToggleItems`.
- [layout/Split.ts:1766-1850](../packages/lib/src/typescript/lib/layout/Split.ts#L1766) — the radio-row group precedent.
- [component/container/RadioMenuRow.ts](../packages/lib/src/typescript/lib/component/container/RadioMenuRow.ts) and [AbstractBooleanMenuRow.ts](../packages/lib/src/typescript/lib/component/container/AbstractBooleanMenuRow.ts).
- [component/shared/resolveContextMenuTarget.ts](../packages/lib/src/typescript/lib/component/shared/resolveContextMenuTarget.ts) — the keyboard-open precedent.
- [component/editor/markdownHistory.ts](../packages/lib/src/typescript/lib/component/editor/markdownHistory.ts) — why each pick is its own step.
- [tests/overlay/Menu.test.ts](../packages/lib/tests/overlay/Menu.test.ts) — the placement test groups at :570, :1237, :1511, :1594.
- `node_modules/@lexical/selection/dist/utils.d.ts` — `createDOMRange`; `range-selection.d.ts` — `$getSelectionStyleValueForProperty`.

---

## Non-Goals

- **Other context menus**, `CodeEditor`'s (and so source mode's) included —
  the scope decision.
- **`MarkdownDocumentPanel`'s Text style dropdown** — a toolbar dropdown,
  not the context menu; it keeps closing on a pick.
- **Moving the menu once open** — see *Potential Challenges*.
- **Refreshing other rows after a pick.** A style pick changes no other
  row's availability: Clear formatting follows the format bits only. A
  format toggle's effect on Clear formatting while the menu stays open is
  today's behaviour and stays.
- **New fields on `MarkdownEditorSelectionState`** for the colour, font or
  size — the menu reads them privately.
- **A colour picker or more presets.**

---

## Notes

[^new-method]: A sixth optional parameter on `show` would make every caller
    that wants it pass `undefined` for `onClose` and `excludeEl`, and an
    options-object overload would be the only one of its kind on `Menu`.
    A separate method also keeps the many tests that spy on `show` (for
    example `spyOnMenuShow` in `markdown-editor.test.ts`) unchanged, since
    offline the editor still calls `show`. The name says what the method
    guarantees: the menu stays clear of the rectangle.

[^union-with-pointer]: Folding the pointer's y into the anchor keeps the
    guarantee `show` documents — the menu never covers the cursor — for a
    pointer that is a few pixels outside the measured text (in the leading
    between lines, or past a line's end). Only the vertical span is used
    because the menu lands wholly below or above the area, so its
    horizontal extent cannot overlap it; using the area's left edge instead
    of the pointer would move a menu opened at the end of a long selection
    far to the left of the pointer.

[^band-below-noop]: With the menu below the area, a submenu that grows down
    from its item is below the area already, and one that flips up ends at
    its item's top and rises by its own height. It crosses the area only
    when it is taller than the room between its item and the area, which is
    exactly when it does not fit in the band, so the fit rule hands it to
    today's placement. The band changes the result only for a menu above the
    area, which is the case the user reported.

[^band-fit-rule]: Two other rules were considered. Confining a submenu to
    the band even when it does not fit would cap and scroll it; a scrolled
    submenu in a strip is harder to use than one that briefly covers the
    text, and in the editor it never happens: the band holds the root menu,
    which is taller than any of its submenus. Testing whether the submenu
    overlaps the area horizontally before confining it would add a second
    geometry check for a case the fit rule already handles.

[^seam-read]: Three other ways were considered. Calling
    `selection.getRangeAt(0).getClientRects()` inside the existing
    `readDocumentSelection` reader would measure only the browser's
    selection, not the word a caret would widen to, and would do geometry
    in a reader the seam documents for resolving a selection. A seam read
    over the browser's selection alone has the same gap. Lexical's
    `createRectsFromDOMRange` measures and filters rectangles itself, reading
    `getBoundingClientRect` and `getComputedStyle` outside the seam. Lexical's
    `createDOMRange` is the Lexical ecosystem's way to turn a node range into
    a DOM range (its floating toolbars use it), and inside `readRangeRects`
    it runs only where the seam calls it, the way `mountView`'s factory and
    `readDocumentSelection`'s reader do. No popup in this library anchors to
    a text range today: `ComboBox` and `AutoCompleteField` anchor to their
    input element, `Tooltip` follows the pointer, `Popover` anchors to an
    element, and `CodeEditor`'s completions are CodeMirror's own.

[^table-selection]: A table selection has no browser selection to measure:
    `@lexical/table` highlights the cells itself. The cells usually exceed
    the large-selection limits anyway, and Text style is disabled while
    cells are selected, so there is no style to watch. A selected image or
    rule is not text and takes no format. Opening these at the pointer, as
    today, keeps the rule to what can be measured.

[^thresholds]: Three lines: the user's own example ("taller than a few
    lines"), and the menu then opens at most two line pitches (about 60 px
    at the default size) further down than the pointer. At line height 1.8
    a three-line range measures `1.8 + 1.8 + 1 = 4.6` heights of one line's
    text, rounded up to 5 so a three-line selection never falls back. The
    rule counts in heights of the pointer's line rather than pixels so it
    scales with headings and with the reader's font size; it cannot count
    the editor's line pitch directly, since the line height is a theme
    variable (`--ts-ui-md-line-height`). One third of the viewport: a
    selection that size leaves at least a third of the viewport on its
    roomier side for the menu, which is "larger than the room around it"
    made measurable.

[^element-boxes]: A browser's range rectangles include the border box of
    every element the range wholly contains, besides one rectangle per line
    of text. A fully selected paragraph's box spans all its lines, so without
    this rule a pointer in the leading between two lines would pick the
    paragraph as "the line". A text line never holds another measured
    rectangle; an image's box holds none either, so it stays.

[^growth]: Large sets `font-size: 1.2em` on the word. The line grows, and
    the word's lower edge moves down by roughly the extra size: about 4 px
    for 16 px text, more for a heading. A menu flush against the old edge
    would then hide the word's descenders. `(1.2 − 1) × line height` grows
    with the text, since the measured line height is the text's own size.
    It is structural clearance for a known change, not a cosmetic inset.

[^keyboard-point]: Browsers disagree on where a key-raised `contextmenu` is
    reported, and WebKitGTK (the Tauri shell's engine) is not Chromium. The
    caret's own rectangle, measured the same way as the area, gives one
    answer everywhere, and in the large-selection fallback makes "the line
    under the pointer" the caret's line, which is where a keyboard user is
    looking. The second measurement is made only for a keyboard open.

[^radio-rows]: `closeOnActivate: false` on a plain item would keep the menu
    open, but a plain item's checkmark flips by itself on each activation (a
    multi-select toggle) and has no public way for a sibling to be
    unchecked, so a single choice could not be shown. `RadioMenuRow` is the
    library's single-choice row, never closes its menu, and is unchecked by
    whoever owns the group, which is what `Split` does. A submenu panel
    calls every factory each time it opens, so the rows are kept in an array
    indexed by preset and reassigned there, as `Split` reassigns its two
    row variables.

[^mixed-value]: Lexical returns its default for a mixed selection as it does
    for an unstyled one, and calling it twice with two defaults does not tell
    them apart either. Telling them apart would mean re-implementing
    Lexical's boundary handling for text nodes the selection only touches.
    The case lasts until the first pick, which makes the value uniform.

[^undo]: Lexical's history would merge a second style change on the same
    text node into the step before it (one dirty leaf whose text reads as
    before). The editor's history wrapper (`isOwnUndoStep`,
    `markdownHistory.ts:52`) turns any update that changed the document
    into a step of its own, so each pick already is one. No precedent in the
    codebase merges repeated style changes.

---

## Implementation Notes

No plan item was dropped. Three details the plan left open, and the changes made after review, are below:

- **The keyboard-open tests restart `Menu`'s input watch.** The watch is
  installed once per process against the window of the first test's DOM, so
  a later test's key press never reached it. The wiring tests call
  `Menu._stopInputWatch()` and `Menu._startInputWatch()` before dispatching
  the key press, and stop the watch afterwards, which also clears the
  recorded key press.
- **The keyboard session tests build the menu before the key press.**
  Constructing a `Menu` starts the input watch, so building it inside the
  same expression as the press (as `showFromKeyboard` does) is the wrong
  order for a menu that is not shown through `show`.
- **The kept-clear area's growth is computed as `height * 1.2 - height`**
  rather than `(1.2 - 1) * height`, which in floating point gives 3.99… for
  a 20 px line and a bottom edge of 123.99999999999999 instead of 124.

Changes after the first review:

- **Keyboard open point.** The caret's corner is pinned to the editor's
  visible box, as `resolveContextMenuTarget` pins a keyboard-opened menu to
  its widget's box. The precedent also scrolls the current item into view
  first; the editor does not, because the caret is where the user is typing
  and is already in view.
- **Checked radio.** The current value is read from the word the commands
  widen a caret to, so a caret at the end, at the start or inside a styled
  word shows the same choice.
- **Line under the pointer.** It is the whole line: the rectangle under the
  pointer joined with every rectangle sharing its line, so inline code or a
  smaller word does not stand for it and a larger word is counted.
- **Cost.** Dropping element boxes compares each rectangle only with those
  that start within its vertical span. For 2,000 paragraphs selected, with
  8,000 measured rectangles, the area is computed in about 3 ms. The time to
  build and measure the range in a real browser was not measured.

Manual browser checks, run by the reviewer in Chromium, as the plan says:
checks 1, 2, 4, 5, 6 and 8, and the submenu part of 7. Still unchecked:
WebKitGTK, dark mode, source mode (check 10), undo after Escape in a
browser (the rest of check 7), the right-edge case (check 3), and the table
and image cases (check 9).

Changes after the second review:

- **A kept-clear area that leaves no room.** `Menu.showClearOf` opened off
  screen for an area filling the viewport. It now falls back to `show`'s
  placement at the pointer when the room on the roomier side is less than the
  menu's height and less than four rows (`MIN_CLEAR_OF_ROWS`); the fallback
  menu may cover the area, which the JSDoc, Menu.md and the changelog state.
- **Images.** The editor measures the boxes of the images in a selection
  separately, by the range that spans each image among its parent's children,
  and `contextMenuKeptClearArea` takes them as a fourth argument. The
  whole-selection check runs first: a selection small enough to keep clear
  whole is kept clear whole wherever the pointer is, an image included. Only
  a selection too large for that falls back to the line under the pointer,
  and with the pointer on an image (and on no text) that line is the image's
  box joined with the text sharing its vertical span, grown for the Large
  size by that text only; with no such text it is the image's own box,
  ungrown. An image never sets the growth. That image measurement is covered
  by tests with the seam mocked; whether Lexical's range builder gives
  exactly the image's box for that parent range in a real browser was not
  checked.
- **Zero-height rectangles** no longer drop a line that holds them.
