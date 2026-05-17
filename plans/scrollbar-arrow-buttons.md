# Scrollbar Arrow Buttons — Implementation Plan

## Overview

Add classic OS-style arrow buttons to each end of the custom [`Scrollbar`](../src/typescript/lib/component/container/Scrollbar.ts) track. Vertical scrollbars gain an up arrow at the top and a down arrow at the bottom; horizontal scrollbars gain left/right arrows at the start/end of the track. Each button steps the scroll position by a fixed pixel amount on click and repeats while held, with the matching arrow visually disabled when scroll is already at that edge.

The feature lives entirely inside `Scrollbar`. Its main consumer is [`VirtualScroller`](../src/typescript/lib/component/container/VirtualScroller.ts) which already owns both vertical and horizontal `Scrollbar` instances ([VirtualScroller.ts:69](../src/typescript/lib/component/container/VirtualScroller.ts#L69), [VirtualScroller.ts:73](../src/typescript/lib/component/container/VirtualScroller.ts#L73)) and feeds them metrics via [`layoutScrollbars`](../src/typescript/lib/component/container/VirtualScroller.ts#L198). No `VirtualScroller` changes are needed — `Scrollbar.setMetrics`/track-length math is updated to subtract the arrow regions so the existing call sites continue to work unchanged.

Arrows default to **off** (`arrowsEnabled: false`) so the current minimalist look is preserved unless an owner opts in via the new `ScrollbarOptions` bag.

---

## Architecture Decisions

### Build a dedicated `ScrollArrowButton` — do not reuse `SpinButton`

[`SpinButton`](../src/typescript/lib/component/input/SpinButton.ts) already implements the press-and-hold tick logic this feature needs ([SpinButton.ts:114-159](../src/typescript/lib/component/input/SpinButton.ts#L114)). On paper it is reusable, but the actual subclass is rigidly shaped for a NumberSpinner cell: it hard-codes `setPreferredSize(18, halfHeight)` and `setMaxSize(18, halfHeight)` keyed off the native input height ([SpinButton.ts:101-107](../src/typescript/lib/component/input/SpinButton.ts#L101)), only accepts the symbols `"▲" | "▼"` ([SpinButton.ts:53](../src/typescript/lib/component/input/SpinButton.ts#L53)), and binds itself to the chevron glyphs. A scrollbar arrow needs to be a 12 px square (or whatever `TRACK_WIDTH` resolves to) and support all four directions.

Instead, build a tiny `ScrollArrowButton extends Component` and **lift the tick scheduler into a small private helper inside `Scrollbar`** (or inline it in the button). The hold-repeat logic is ~30 lines — duplicating it is cheaper than reshaping `SpinButton`. Document the duplication so a future refactor can extract a shared `HoldRepeat` utility if a third call site appears.

### Solid-triangle glyphs via the `Glyph` registry — not pure CSS borders

The brief noted that `arrow-up`/`arrow-down`/`arrow-left`/`arrow-right` already exist in [Glyphs.ts](../src/typescript/lib/component/display/Glyphs.ts). Verification shows only `arrow-down` (`▼`) and `arrow-right` (`▶`) are currently registered ([Glyphs.ts:74-75](../src/typescript/lib/component/display/Glyphs.ts#L74)). Add the two missing entries — `arrow-up` (`▲`) and `arrow-left` (`◀`) — as `kind: "char"` Unicode entries. This is a one-line-each addition that follows the existing pattern; no SVG path extraction needed.

Using `Glyph` (Unicode mode) over CSS triangle hacks (`border: solid transparent`) means the arrow follows `currentColor` automatically, theme-toggle works for free, and the visual matches existing tree disclosure arrows.

### Step size — fixed pixels per click, default 40, configurable

The most intuitive scroll step is a small fixed distance (matching native scrollbar arrow behaviour). 40 px is roughly two rows in the Table at default font size. Expose `setArrowStep(px)` / `getArrowStep()` for owners who need finer/coarser control. Default `40`. Reject the "page-size / 10" derivation — it produces inconsistent step sizes that shift as content grows, surprising users.

### Opt-in via constructor option, default `false`

The current bare-thumb aesthetic ships everywhere today. Flipping to default-on would change the visual of every existing Table, Tree, and VirtualScroller-using component without ceremony. Add `arrowsEnabled?: boolean` to a new `ScrollbarOptions` bag with default `false`. Owners that want the classic look (a future setting on `VirtualScrollerOptions`, perhaps) wire it through explicitly.

### Hit-target sizing — square buttons matching `TRACK_WIDTH`

Each arrow button is `TRACK_WIDTH` × `TRACK_WIDTH` (12 × 12 px). This makes them tidy squares at the track ends, gives the cross-axis a uniform width, and avoids per-orientation sizing branches. The arrow glyph inside the button is rendered at 8 × 8 (matching the [`SpinButton` glyph size](../src/typescript/lib/component/input/SpinButton.ts#L86)) and centred.

### Track length excludes arrow regions only when arrows are enabled

`getTrackLength()` returns the bar's primary-axis size today ([Scrollbar.ts:237-239](../src/typescript/lib/component/container/Scrollbar.ts#L237)). When `arrowsEnabled === true`, subtract `2 * TRACK_WIDTH` and offset the thumb's primary-axis origin by `+TRACK_WIDTH`. The arrow regions are the same size on both ends so the math stays symmetric. When `arrowsEnabled === false`, behaviour is byte-identical to today.

### Disabled-at-edge state

After each `setMetrics` call, compute `atStart = scrollPosition <= 0` and `atEnd = scrollPosition >= maxScroll`. Set a disabled visual state on the matching button via a new `setDisabled(boolean)` method on `ScrollArrowButton`. Disabled buttons:
- Render the glyph in `var(--ts-ui-scrollbar-arrow-disabled-color)` (theme token, below).
- Ignore `mousedown` events (early return; do not start the tick scheduler).

No `pointer-events: none` — keep the element clickable so hover styling does not require special-casing; the mousedown handler simply returns early.

---

## Public API (TypeScript Signatures)

### `Scrollbar` — extended

```typescript
export interface ScrollbarOptions extends ComponentOptions {
    arrowsEnabled?: boolean;   // default false
    arrowStep?:     number;    // default 40 (pixels per click/tick)
}

export class Scrollbar extends Component {
    // existing:
    constructor(orientation?: ScrollbarOrientation, options?: ScrollbarOptions);

    // NEW typed setters/getters (with private backing fields `_arrowsEnabled`, `_arrowStep`):
    setArrowsEnabled(enabled: boolean): this;
    isArrowsEnabled(): boolean;

    setArrowStep(px: number): this;
    getArrowStep(): number;
}
```

`/implement` will route the new options through the constructor — the cached backing fields are `_arrowsEnabled: boolean` and `_arrowStep: number`, matching the project's option-routing convention noted in [SKILL.md](../.claude/skills/plan/SKILL.md).

### `ScrollArrowButton` — new internal class (not exported)

Lives alongside `Scrollbar` in the same file (single-use, no callable wrapper). One element per class — `Component` subclass:

```typescript
type ArrowDirection = "up" | "down" | "left" | "right";

class ScrollArrowButton extends Component {
    constructor(direction: ArrowDirection);

    addTickListener(listener: () => void): void;
    setDisabledState(disabled: boolean): void;
    isDisabledState(): boolean;
}
```

Internally owns a child `Glyph` (one of `arrow-up`/`arrow-down`/`arrow-left`/`arrow-right`) and the press-and-hold scheduler (`scheduleNext` / `cancelRepeat`, mirroring [`SpinButton`'s pattern](../src/typescript/lib/component/input/SpinButton.ts#L121)).

Not exported from the `container` barrel — purely a Scrollbar implementation detail. Following the project's one-element-per-class rule and keeping the new class file-local avoids polluting the public API surface for what is essentially private DOM glue.

---

## Theme Tokens

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-scrollbar-arrow-bg` | `transparent` | `transparent` | Resting background of an arrow button. Matches track by default. |
| `--ts-ui-scrollbar-arrow-color` | `rgba(0, 0, 0, 0.55)` | `rgba(255, 255, 255, 0.65)` | Glyph colour for an enabled arrow. |
| `--ts-ui-scrollbar-arrow-disabled-color` | `rgba(0, 0, 0, 0.18)` | `rgba(255, 255, 255, 0.20)` | Glyph colour for an at-edge (disabled) arrow. |
| `--ts-ui-scrollbar-arrow-hover-bg` | `rgba(0, 0, 0, 0.06)` | `rgba(255, 255, 255, 0.08)` | Background on hover, mirrors the thumb-hover idiom. |

The existing in-file `var(--ts-ui-scrollbar-thumb, …)` calls in [Scrollbar.ts:71](../src/typescript/lib/component/container/Scrollbar.ts#L71) and [Scrollbar.ts:82](../src/typescript/lib/component/container/Scrollbar.ts#L82) are **not** wired to `Theme.ts` today — they rely on the inline fallback. To stay consistent, the four new arrow tokens can either:

- **(a)** Continue the inline-fallback pattern (`var(--ts-ui-scrollbar-arrow-color, rgba(0, 0, 0, 0.55))`) so no `Theme.ts` change is required. Recommended for surgical scope.
- **(b)** Add a `scrollbar` sub-object to the `Theme` interface in [Theme.ts:17](../src/typescript/lib/core/Theme.ts#L17) plus matching entries in [`DefaultTheme`](../src/typescript/lib/core/Theme.ts#L259), [`DarkTheme`](../src/typescript/lib/core/Theme.ts#L411), and [`themeToVars`](../src/typescript/lib/core/Theme.ts#L565). This would be the first scrollbar tokens to live in Theme.ts and pulls the four existing thumb/track tokens along for the ride.

Pick (a) for this plan. If a future plan formalises scrollbar theming, (b) is a follow-up that covers all eight tokens (`-track`, `-thumb`, `-thumb-hover`, and the four new arrow tokens) in one pass.

---

## Internal Structure

### `Scrollbar` private state additions

```typescript
private _arrowsEnabled  : boolean = false;
private _arrowStep      : number  = 40;
private arrowStart      : ScrollArrowButton | null = null;  // up or left
private arrowEnd        : ScrollArrowButton | null = null;  // down or right
```

### DOM/layout when `arrowsEnabled === true` (vertical example)

```
+--------+   y = 0           ← arrowStart (up)    size = TRACK_WIDTH × TRACK_WIDTH
|   ▲    |
+--------+   y = TRACK_WIDTH ← track region starts
|        |
|  thumb |   thumb.setY(TRACK_WIDTH + thumbPos)
|        |
+--------+   y = height - TRACK_WIDTH ← arrowEnd (down)
|   ▼    |
+--------+   y = height
```

### Key math changes

```typescript
private getTrackLength(): number {
    const raw    = this.isVertical() ? this.getHeight() : this.getWidth();
    const inset  = this._arrowsEnabled ? 2 * TRACK_WIDTH : 0;
    return Math.max(0, raw - inset);
}

private getTrackOrigin(): number {
    return this._arrowsEnabled ? TRACK_WIDTH : 0;
}

private setThumbPos(pos: number): void {
    const origin = this.getTrackOrigin();
    if (this.isVertical()) {
        this.thumb.setY(origin + pos);
    } else {
        this.thumb.setX(origin + pos);
    }
}
```

The `onTrackClick` paging math also needs the origin subtracted from the read `offsetY`/`offsetX` before comparing against `thumbPos`.

### Tick handler

```typescript
private onArrowTick(direction: -1 | 1): void {
    const maxScroll   = Math.max(0, this.contentSize - this.viewportSize);
    const newPosition = Math.max(0, Math.min(maxScroll, this.scrollPosition + direction * this._arrowStep));
    if (newPosition !== this.scrollPosition) {
        this.fireScrollListeners(newPosition);
    }
}
```

The scroll listener path in `VirtualScroller` already calls back into `setMetrics` on the next frame, which will refresh `atStart`/`atEnd` and update the disabled state.

---

## Ordered Implementation Steps

### Step 1 — Add the missing Unicode arrow glyphs

[`src/typescript/lib/component/display/Glyphs.ts`](../src/typescript/lib/component/display/Glyphs.ts) — append two entries next to the existing `arrow-down`/`arrow-right` ([Glyphs.ts:74-75](../src/typescript/lib/component/display/Glyphs.ts#L74)):

```typescript
"arrow-left":  { kind: "char", char: "◀" },
"arrow-up":    { kind: "char", char: "▲" },
```

Use the literal Unicode characters to match the existing style of those two lines. No JSDoc change — `Glyphs` is `@internal`.

Verify: `grep -n 'arrow-up\|arrow-left' src/typescript/lib/component/display/Glyphs.ts` returns the two new lines.

### Step 2 — Add `ScrollArrowButton` (file-local) at the top of `Scrollbar.ts`

Single new class above the existing `Scrollbar` class definition. Imports `Glyph` from `~/component/display/Glyph.js`. Constructor:

1. `super()`, `setPosition(Position.ABSOLUTE)`, `setWidth(TRACK_WIDTH)`, `setHeight(TRACK_WIDTH)`.
2. `setCursor("default")`.
3. `setBackgroundColor("var(--ts-ui-scrollbar-arrow-bg, transparent)")`.
4. Construct the inner `Glyph` keyed by direction (`new Glyph("arrow-" + direction)`), `setPreferredSize(8, 8)`, centre it (use Component's existing layout — addComponent + setX/setY centring math, or wrap in `setDisplay("flex")` with `alignItems`/`justifyContent`; pick what the codebase already does for centred glyphs by referencing [`SpinButton`'s glyph centring](../src/typescript/lib/component/input/SpinButton.ts#L86)).
5. Apply the foreground colour via `setColor("var(--ts-ui-scrollbar-arrow-color, rgba(0, 0, 0, 0.55))")` so the glyph inherits via `currentColor`.
6. Wire `mousedown` / `mouseup` / `mouseleave` listeners and the press-and-hold scheduler (mirror [SpinButton.ts:133-159](../src/typescript/lib/component/input/SpinButton.ts#L133)).
7. Wire `mouseover` / `mouseout` listeners to swap `background-color` to/from the hover token.

`setDisabledState(disabled)`:
- Cancels any in-flight repeat (`cancelRepeat()`).
- Swaps the glyph's colour CSS to `var(--ts-ui-scrollbar-arrow-disabled-color, …)`.
- Stores `_disabled` so the `mousedown` handler can early-return.

### Step 3 — Extend `Scrollbar` constructor to accept `ScrollbarOptions`

Add the interface, add `_arrowsEnabled` / `_arrowStep` private fields, extend the constructor signature to `(orientation?, options?)`. Pull `arrowsEnabled` / `arrowStep` out of options (with defaults `false` / `40`) and store them in the backing fields before any DOM construction.

If `_arrowsEnabled === true`, construct the two `ScrollArrowButton` instances (`up` + `down` for vertical, `left` + `right` for horizontal), append them as children, position them at the ends (`setX(0); setY(0)` for start; for end, the position is set lazily inside `setMetrics`/`setThumbPos` because the cross-axis size changes), and wire each one's `addTickListener` to `onArrowTick(-1)` / `onArrowTick(+1)`.

If `_arrowsEnabled === false`, leave `arrowStart` / `arrowEnd` null. All downstream code branches on the field, not on null-checks of buttons.

### Step 4 — Recompute track length to exclude arrow regions

Update `getTrackLength()` and add `getTrackOrigin()` per the snippet in **Internal Structure** above. Audit every caller of `getTrackLength()` ([Scrollbar.ts:183](../src/typescript/lib/component/container/Scrollbar.ts#L183), [Scrollbar.ts:333](../src/typescript/lib/component/container/Scrollbar.ts#L333)) — both already use the return value as the usable scroll-axis length, so subtraction is transparent.

Update `setThumbPos` ([Scrollbar.ts:259](../src/typescript/lib/component/container/Scrollbar.ts#L259)) to add the track origin. Update `onTrackClick` ([Scrollbar.ts:368](../src/typescript/lib/component/container/Scrollbar.ts#L368)): subtract the origin from `click` before comparing against `thumbPos`, **and** early-return if the raw click is within an arrow region (so paging doesn't fire from clicks on the arrows themselves — those should be handled by the button's own mousedown listener and stopped from bubbling).

In `setMetrics`, after the existing scroll-position math, position the end arrow's primary-axis origin: `arrowEnd.setY(getHeight() - TRACK_WIDTH)` (vertical) or `arrowEnd.setX(getWidth() - TRACK_WIDTH)` (horizontal). The start arrow's origin is fixed at 0 and set once in the constructor.

### Step 5 — Wire disabled-state at edges

At the end of `setMetrics` (after the new arrow-end positioning), compute:

```typescript
if (this._arrowsEnabled) {
    const maxScroll = Math.max(0, contentSize - viewportSize);
    this.arrowStart!.setDisabledState(scrollPosition <= 0);
    this.arrowEnd!  .setDisabledState(scrollPosition >= maxScroll);
}
```

When the scrollbar hides itself because content fits (`!overflow`, [Scrollbar.ts:177](../src/typescript/lib/component/container/Scrollbar.ts#L177)) the arrows are hidden along with the rest of the bar — no separate handling needed.

### Step 6 — Add typed setters/getters

`setArrowsEnabled(enabled)` / `isArrowsEnabled()` — when toggled at runtime, this needs to construct or destroy the arrow buttons and refresh `setMetrics` to recompute thumb size against the new track length. To keep scope tight, **document that `setArrowsEnabled` is intended for construction-time use** (via the options bag); runtime toggles are supported but call `setMetrics(viewportSize, contentSize, scrollPosition)` internally after rebuilding the buttons.

`setArrowStep(px)` / `getArrowStep()` — pure field write/read, no DOM impact.

### Step 7 — Update the `container` barrel

[`src/typescript/lib/component/container/index.ts:12`](../src/typescript/lib/component/container/index.ts#L12) — add `ScrollbarOptions` to the exported types list:

```typescript
export type { ScrollbarListener, ScrollbarOrientation, ScrollbarOptions } from '~/component/container/Scrollbar.js';
```

`ScrollArrowButton` is **not** exported (file-local implementation detail).

### Step 8 — JSDoc the new public surface

- `ScrollbarOptions` — `@category Components`, one-line per field.
- `setArrowsEnabled` / `isArrowsEnabled` / `setArrowStep` / `getArrowStep` — `@category Components`, describe defaults and the at-edge disabled behaviour.
- Update the existing `Scrollbar` class JSDoc ([Scrollbar.ts:30-46](../src/typescript/lib/component/container/Scrollbar.ts#L30)) to mention the arrow-buttons opt-in in one sentence.

Cross-bucket reference to `Glyph` (in `component/display`) from `Scrollbar` JSDoc, if it appears, must use the markdown-link form per [CLAUDE.md](../CLAUDE.md): `[\`Glyph\`](/api/component/display/classes/Glyph)`.

### Step 9 — Regression sweep on `VirtualScroller`

No code change expected in [`VirtualScroller.ts`](../src/typescript/lib/component/container/VirtualScroller.ts). Verify by reading [`layoutScrollbars`](../src/typescript/lib/component/container/VirtualScroller.ts#L198): it calls `setMetrics(effH, contentHeight, scrollY)` and equivalents for H — these now flow through the new track-length math transparently. `getTrackWidth()` ([Scrollbar.ts:211](../src/typescript/lib/component/container/Scrollbar.ts#L211)) still returns `TRACK_WIDTH` (the cross-axis dimension, unchanged). Verify the existing reservations at [VirtualScroller.ts:202-210](../src/typescript/lib/component/container/VirtualScroller.ts#L202) still work — they do, because `getTrackWidth` is unchanged.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/container/Scrollbar.ts` — add `ScrollbarOptions`, `ScrollArrowButton`, arrow construction/disposal, track-length math, edge-disabled logic, four new typed setters/getters |
| Modify | `src/typescript/lib/component/display/Glyphs.ts` — add `arrow-up` (`▲`) and `arrow-left` (`◀`) entries |
| Modify | `src/typescript/lib/component/container/index.ts` — export `ScrollbarOptions` |

No new files. No deletions. `VirtualScroller.ts`, `Body.ts`, `Tree.ts` are untouched.

---

## Verification

1. **Type check** — `npm run typecheck` clean.
2. **Glyph registry** — `grep -n 'arrow-up\|arrow-down\|arrow-left\|arrow-right' src/typescript/lib/component/display/Glyphs.ts` returns four lines.
3. **No call-site break** — `grep -rn 'new Scrollbar(' src/typescript/lib/` (currently two hits in `VirtualScroller.ts`) — both still compile with the unchanged single-argument call (`new Scrollbar("vertical")` / `new Scrollbar("horizontal")`) because the new options argument is optional.
4. **Default-off invariance** — open a Table or Tree in the dev server (`npm run dev`, http://localhost:8015); the scrollbar visual is byte-identical to today (thumb + track only, no arrows).
5. **Manual smoke (arrows-on)** — temporarily flip `arrowsEnabled` to `true` on the `VirtualScroller`'s internal Scrollbar construction (or wire a one-off demo) on the MiscPanel slow-table screen:
   - Click each arrow once → scroll moves by `arrowStep` (40 px default).
   - Press and hold an arrow → scroll repeats at an accelerating cadence matching `SpinButton`.
   - Scroll to top → up arrow dims, down arrow stays bright; releasing the mouse mid-hold stops the repeat.
   - Scroll to bottom → mirror behaviour on the down arrow.
   - Same checks on the horizontal scrollbar with a wide table.
6. **Track click still pages** — clicking the track between the arrows pages by one viewport (existing behaviour); clicking *on* an arrow does not also fire the track-paging handler.
7. **Theme toggle** — switch `DefaultTheme` ↔ `DarkTheme` in the dev server; arrow colour and hover background change correctly via the inline `var(...)` fallbacks.
8. **Docs build clean** — `npm run docs:build` reports zero errors and zero new link warnings (the typedoc "unsupported TypeScript version" notice is the lone acceptable warning).
9. **Knowledge graph refresh** — `graphify update . --directed`.

---

## Documentation Impact

- `Scrollbar` lives in the `component/container` bucket; it is already exported from [`src/typescript/lib/component/container/index.ts:11`](../src/typescript/lib/component/container/index.ts#L11). Add `ScrollbarOptions` to the same barrel.
- The Scrollbar API page is generated by typedoc from the `component/container` entry point in [typedoc.json](../typedoc.json). No manual sidebar edit required if the existing curated page just lists "Scrollbar" without enumerating its methods.
- If a curated `docs/component/container/Scrollbar.md` page exists, add a short "Arrow buttons" subsection describing the opt-in option and the four typed setters. Run `grep -rln '\bScrollbar\b' docs/` before editing to enumerate the pages that mention it.
- Cross-bucket reference: `Scrollbar` JSDoc mentioning the `Glyph` class (in `component/display`) must use a markdown link per [CLAUDE.md](../CLAUDE.md) — `{@link}` would render as plain text and surface as a docs:build warning.

---

## Potential Challenges

- **Arrow button mousedown vs. track mousedown** — `Scrollbar` listens for `mousedown` on itself ([Scrollbar.ts:101](../src/typescript/lib/component/container/Scrollbar.ts#L101)). Events on the arrow children will bubble up. Mitigation: call `e.stopPropagation()` inside the arrow's mousedown handler, or have `onTrackClick` early-return when the event target is an arrow (check via `e.target` against `arrowStart.getElement()` / `arrowEnd.getElement()`).
- **Disabled-state visual flicker on first render** — `setMetrics` is what computes `atStart`/`atEnd`. Before the first `setMetrics`, both arrows render in the enabled colour even though `scrollPosition === 0`. Mitigation: set the start arrow disabled at construction (since `scrollPosition` defaults to 0), let `setMetrics` correct the end arrow once content metrics arrive.
- **Hover background blocks arrow visibility on dark theme** — the proposed `--ts-ui-scrollbar-arrow-hover-bg` of `rgba(255, 255, 255, 0.08)` is subtle; verify visually on the dark theme during Step 5 smoke testing and bump opacity if needed.
- **Repeat tick coalescing with rapid `setMetrics`** — the tick handler fires `fireScrollListeners(newPosition)`, which `VirtualScroller` translates into `setScrollY/X` → next frame → `setMetrics`. If `setMetrics` re-applies the disabled state mid-hold once the edge is hit, the cancel happens inside `setDisabledState`. Confirm the cancel doesn't leave a stuck `mouseup` listener — the existing viewport mouseup wires in `SpinButton` cleanly cancel on release ([SpinButton.ts:92](../src/typescript/lib/component/input/SpinButton.ts#L92)), so mirror that pattern.

---

## Critical Files

- [src/typescript/lib/component/container/Scrollbar.ts](../src/typescript/lib/component/container/Scrollbar.ts) — primary edit target; full file (~400 lines) needs re-reading during implementation.
- [src/typescript/lib/component/container/VirtualScroller.ts](../src/typescript/lib/component/container/VirtualScroller.ts) — main consumer; confirm `layoutScrollbars` and `getTrackWidth` callers still work unchanged.
- [src/typescript/lib/component/input/SpinButton.ts](../src/typescript/lib/component/input/SpinButton.ts) — reference for the hold-repeat scheduler pattern (`onMouseDown`, `scheduleNext`, `cancelRepeat`, viewport mouseup listener).
- [src/typescript/lib/component/display/Glyphs.ts](../src/typescript/lib/component/display/Glyphs.ts) — registry of named glyphs; arrow entries live here.
- [src/typescript/lib/component/display/Glyph.ts](../src/typescript/lib/component/display/Glyph.ts) — `Glyph` constructor signature for the inner arrow component inside `ScrollArrowButton`.
- [src/typescript/lib/component/container/index.ts](../src/typescript/lib/component/container/index.ts) — barrel update for `ScrollbarOptions`.
- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — read-only for this plan (theme tokens use inline `var(...)` fallbacks per Architecture Decision **(a)**); a future plan may formalise scrollbar tokens here.

---

## Non-Goals

- **No formal `Theme.ts` scrollbar token block.** The existing thumb/track tokens are inline-fallback today; the four new arrow tokens follow the same pattern. Promoting all eight to `Theme.ts` is a separate, surgical refactor.
- **No `SpinButton` refactor.** The duplication of hold-repeat logic between `ScrollArrowButton` and `SpinButton` is intentional. Extracting a shared `HoldRepeat` helper is a follow-up if a third consumer appears.
- **No keyboard arrow-key handling on the scrollbar.** Scrollbar arrow buttons are mouse/touch affordances. Keyboard navigation is the owner's job (e.g. Table row navigation already exists).
- **No autoscroll while dragging past the edge.** Classic OS scrollbars don't do this and neither will ours.
- **No per-axis arrow customization.** Both arrows on a scrollbar share the same `arrowStep`. Asymmetric step sizes are not a real use case.
- **No animated thumb-glide.** Each click jumps `arrowStep` pixels instantly. Smooth-scroll easing is a separate, larger ask.
