# StatusBar — Implementation Plan

## Overview

A `StatusBar` is a thin horizontal strip mounted at the bottom of a window or
panel that surfaces transient status messages and small persistent indicators
(connection state, cursor row/col, document counts, zoom %, a determinate
[`ProgressBar`](/api/component/display/classes/ProgressBar) or
[`ProgressSpinner`](/api/component/display/classes/ProgressSpinner)). The
component is intentionally chrome-only: the message string is convenient
sugar over an internal [`Text`](/api/component/input/classes/Text); every
other widget the caller wants in the bar (a clickable status indicator, a
glyph, a progress bar) is built from existing components and inserted via
`addLeft` / `addRight`.

The new file lands at `src/typescript/lib/component/container/StatusBar.ts`
alongside the other Panel-derived chrome containers like
[FieldSet.ts](../src/typescript/lib/component/container/FieldSet.ts) and
[WindowHeader.ts](../src/typescript/lib/component/container/WindowHeader.ts).
It extends [Panel](../src/typescript/lib/core/Panel.ts#L39), wraps an
[HBox](../src/typescript/lib/layout/HBox.ts#L24) layout, and uses two
internal sub-`Panel` zones (left, right) with a flex-weighted spacer between
them. Five new theme tokens land in
[Theme.ts](../src/typescript/lib/core/Theme.ts) — one per `Theme`,
`DefaultTheme`, `DarkTheme`, and `themeToVars` touch point.

There is no `toolbar-component.md` plan in `plans/` at write time — the
prompt's reference to "parallel toolbar-component.md" is a forward
reference. Structural similarity is noted in passing (both wrap an HBox in
a Panel) but no cross-plan coordination is required.

---

## Architecture Decisions

### `StatusBar extends Panel`, wrapping an HBox

The bar is a container that owns children — `Panel` already supplies the
default 4 px insets, the `tag` override hook, and the
[ComponentOptions](../src/typescript/lib/core/Component.ts) cascade. Setting
the layout manager to a single
[HBox](../src/typescript/lib/layout/HBox.ts#L24) gives free preferred-size /
min-size / row-baseline behaviour and is the same shape
[MenuBar.ts:54-57](../src/typescript/lib/component/menubar/MenuBar.ts#L54-L57)
already uses for its horizontal strip. No new layout primitive is needed.

### Two-zone layout — `_leftZone` + spacer + `_rightZone`

Conventional status bars split into a left run (the running message and
recent-activity widgets) and a right run (persistent indicators: zoom %,
cursor, connection). Implement as three siblings of the outer HBox:

1. `_leftZone: _Panel` — its own HBox child, holds the message Text and
   any caller-added left widgets. `weight = 0`.
2. `_spacer: Component` — empty Component with `weight = 1`, given to the
   outer HBox via `setLayoutConstraints` so
   [HBox.doLayout](../src/typescript/lib/layout/HBox.ts#L264-L294)'s
   weight branch hands it the remaining width and pushes the two zones
   to opposite ends.
3. `_rightZone: _Panel` — second HBox child, holds caller-added right
   widgets. `weight = 0`.

`addLeft` / `addRight` delegate to `_leftZone.addComponent` /
`_rightZone.addComponent` respectively; `removeLeft` / `removeRight`
mirror via `removeComponent`. The public API never exposes the zones
directly — encapsulation lets the implementer swap the layout strategy
later (e.g. `flex` CSS) without API churn.

Use the private aliases `_Panel` / `_Component` for the internal nodes
(per the project's [callable export
contract](../plans/implemented/callable-docs-sweep.md)) so the cached
fields are class instances, not the callable variants.

### `setMessage(text, timeoutMs?)` with a default-message revert

`setMessage` is the 90 % use case — `statusBar.setMessage("Ready")`. The
implementation:

1. Stores `text` in `_message`.
2. Updates `_messageText.setText(text)`.
3. If `timeoutMs` is provided, schedules a `window.setTimeout` that, on
   fire, calls `setMessage(this._defaultMessage)` and clears
   `_messageTimer`. A second `setMessage` call before the timer fires
   clears the pending timer first (`window.clearTimeout`) so the most
   recent caller wins.
4. The timer handle is stored as `_messageTimer: number | null`.

`setDefaultMessage` sets `_defaultMessage` and, when no transient
message is currently in flight (i.e. `_messageTimer === null`), pushes
the new default into the visible Text immediately so a freshly
configured StatusBar shows the new default. `clearMessage()` is sugar
for `setMessage(this._defaultMessage)` with no timeout — it also clears
any pending timer.

### `role="status"` + `aria-live="polite"` on the root only

The whole strip is a single screen-reader live region. The bar's element
gets `role="status"` via
[getAria().setRole("status")](../src/typescript/lib/core/Aria.ts#L78) and
`aria-live="polite"` via `getAria().setAttribute("live", "polite")` (the
project's [Aria.ts](../src/typescript/lib/core/Aria.ts) does not ship a
dedicated `setLive` setter, so the generic
[setAttribute](../src/typescript/lib/core/Aria.ts) path is the correct
route — same pattern as the `controls` / `selected` setters at
[Aria.ts:121-298](../src/typescript/lib/core/Aria.ts#L121-L298)).

Marking the *root* live (not just the message Text) means a caller who
mutates a right-zone widget — e.g. flipping a "Disconnected" Text — also
gets a polite announcement, without each widget opting in. Per ARIA, a
nested `role="status"` would create a second live region, so the
internal zones intentionally carry no role.

### No shipped widgets — composition only

A StatusBar instance ships with exactly one built-in piece of furniture:
the internal `_messageText: _Text` in the left zone. Connection
indicators, cursor position, zoom percentage, and progress strips are
all constructed by the caller from existing components and inserted
through `addLeft` / `addRight`. Shipping pre-built "StatusBarItem" or
"StatusBarSeparator" classes would expand the public surface for no
generality gain over `addLeft(new IconText("plug", "Disconnected"))`.

### Chrome — single-line height, top border, distinct background

The bar sits *below* the panel content, so the visible separator is a
**top** border (`borderTop`). Background is a distinct theme token so the
bar reads as chrome rather than as content. Single-line height is
clamped to ~22 px via a `--ts-ui-statusbar-height` token; the
implementer applies it via `setMinSize(0, height)` /
`setMaxSize(Number.MAX_SAFE_INTEGER, height)` so the bar doesn't grow if
a host layout would otherwise stretch it.

The token value is exposed as a CSS string (e.g. `'22px'`) and read in
the constructor with the same `getComputedStyle` route already used by
[ProgressSpinner.ts](../src/typescript/lib/component/display/ProgressSpinner.ts)
for its `--ts-ui-progress-spinner-size` token (search
`getComputedStyle` in that file for the precedent), or — simpler and
already in-pattern with
[MenuBar.ts:64](../src/typescript/lib/component/menubar/MenuBar.ts#L64)
— a hard-coded constant `STATUS_BAR_HEIGHT = 22` paired with the token
governing the CSS rule. Choose the constant path for parity with
`MENU_BAR_BUTTON_HEIGHT`.

### Padding-via-insets, not custom CSS

`Panel` already applies insets through the cascade. Use a non-default
`insets: new Insets(0, 6, 0, 6)` (left/right 6 px, top/bottom 0) wired
in via `_defaultStatusBarOptions` so the message and indicators don't
sit flush against the bar edges. A separate `--ts-ui-statusbar-padding`
token names the value at theme level; the constructor reads it through
the same path as MenuBar's border setup.

---

## Public API (TypeScript Signatures)

### `StatusBar` — `src/typescript/lib/component/container/StatusBar.ts`

```typescript
import { Component } from "~/core/Component.js";
import { Panel, PanelOptions } from "~/core/Panel.js";

export interface StatusBarOptions extends PanelOptions {
    /** Initial transient message shown in the left zone. */
    message?:        string;
    /**
     * Fallback message restored when a timed `setMessage` call expires.
     * Defaults to the empty string.
     */
    defaultMessage?: string;
}

class StatusBar extends Panel<StatusBarOptions> {
    constructor(options?: StatusBarOptions);

    /** Appends a component to the left zone. */
    addLeft(component: Component): this;

    /** Appends a component to the right zone. */
    addRight(component: Component): this;

    /** Removes a component from the left zone. No-op if absent. */
    removeLeft(component: Component): this;

    /** Removes a component from the right zone. No-op if absent. */
    removeRight(component: Component): this;

    /**
     * Replaces the visible status message. When `timeoutMs` is given,
     * the default message is restored after that delay. A subsequent
     * `setMessage` call cancels any pending revert.
     */
    setMessage(text: string, timeoutMs?: number): this;

    /** Returns the currently-visible message string. */
    getMessage(): string;

    /** Cancels any pending revert and reverts to the default message. */
    clearMessage(): this;

    /**
     * Sets the fallback message used when a timed message expires and
     * pushes the new value into the visible Text when no transient
     * message is currently in flight.
     */
    setDefaultMessage(text: string): this;

    /** Returns the configured default message. */
    getDefaultMessage(): string;
}
```

Cached backing fields, by the project's [setter / cached field /
XOptions](../src/typescript/lib/component/display/IconText.ts#L52-L99)
three-rule contract:

| Setter              | Cached field             | XOptions key      |
| ------------------- | ------------------------ | ----------------- |
| `setMessage`        | `_message: string`       | `message`         |
| `setDefaultMessage` | `_defaultMessage: string`| `defaultMessage`  |

Additional private state with no public setter:

```typescript
private _messageTimer: number | null = null;
private _leftZone:     _Panel;
private _rightZone:    _Panel;
private _spacer:       _Component;
private _messageText:  _Text;
```

Export pair via the project's callable wrapper, same shape as
[Panel.ts:58-63](../src/typescript/lib/core/Panel.ts#L58-L63):

```typescript
const StatusBarCallable = callable(StatusBar);
type StatusBarCallable<TOptions extends StatusBarOptions = StatusBarOptions> = StatusBar<TOptions>;
export {
    StatusBar         as _StatusBar,
    StatusBarCallable as StatusBar,
};
```

---

## Theme Tokens

| CSS Custom Property              | Light Default                | Dark Default               | Purpose                                                       |
| -------------------------------- | ---------------------------- | -------------------------- | ------------------------------------------------------------- |
| `--ts-ui-statusbar-bg`           | `'rgb(245, 245, 245)'`       | `'rgb(35, 35, 35)'`        | Distinct chrome background separating bar from main content.  |
| `--ts-ui-statusbar-color`        | `'rgb(60, 60, 60)'`          | `'rgb(200, 200, 200)'`     | Foreground colour for the message Text and inline indicators. |
| `--ts-ui-statusbar-border`       | `'rgb(220, 220, 220)'`       | `'rgb(70, 70, 70)'`        | Top border colour. The bar sits below content; border is top. |
| `--ts-ui-statusbar-height`       | `'22px'`                     | `'22px'`                   | Fixed strip height. Identical across themes.                  |
| `--ts-ui-statusbar-padding`      | `'6px'`                      | `'6px'`                    | Left/right padding inside the bar.                            |

Add a `statusBar` block to the `Theme` interface at
[Theme.ts:17](../src/typescript/lib/core/Theme.ts#L17), placed
alphabetically near `menuBar` ([Theme.ts:135-155](../src/typescript/lib/core/Theme.ts#L135-L155)):

```typescript
statusBar: {
    background: string;
    color     : string;
    border    : string;
    height    : string;
    padding   : string;
};
```

Mirror the block in:

- `DefaultTheme` at [Theme.ts:259](../src/typescript/lib/core/Theme.ts#L259) (light values).
- `DarkTheme` at [Theme.ts:413](../src/typescript/lib/core/Theme.ts#L413) (dark values).
- `themeToVars` at [Theme.ts:565-665](../src/typescript/lib/core/Theme.ts#L565-L665) — five new entries.

---

## Internal Structure

### DOM tree

```
<div role="status" aria-live="polite">     ← StatusBar (HBox outer)
    <div>                                  ← _leftZone (HBox inner, weight=0)
        <div>                              ← _messageText
        ...caller-added left widgets...
    </div>
    <div></div>                            ← _spacer (weight=1)
    <div>                                  ← _rightZone (HBox inner, weight=0)
        ...caller-added right widgets...
    </div>
</div>
```

The outer HBox's `weight = 1` constraint on `_spacer` engages the weight
branch at [HBox.ts:275-281](../src/typescript/lib/layout/HBox.ts#L275-L281),
giving the spacer all remaining width and pushing the zones apart. Both
zones report their preferred width via their own HBox layout, so the
right zone hugs its content and stays anchored.

### Constructor sketch

```typescript
constructor(options?: StatusBarOptions) {
    super({
        ..._defaultStatusBarOptions,
        ...(options ?? {}),
    });

    // Outer HBox arranges the three siblings. Zero spacing so the spacer
    // alone governs the gap between zones.
    this.setLayoutManager(new HBox({ spacing: 0, stretching: true }));

    // Theme chrome.
    this.setBackgroundColor("var(--ts-ui-statusbar-bg, rgb(245, 245, 245))");
    this.setColor("var(--ts-ui-statusbar-color, rgb(60, 60, 60))");
    this.setElementCSSRule(
        "borderTop",
        "1px solid var(--ts-ui-statusbar-border, rgb(220, 220, 220))",
    );
    this.setMinSize(0,                       STATUS_BAR_HEIGHT);
    this.setMaxSize(Number.MAX_SAFE_INTEGER, STATUS_BAR_HEIGHT);

    // Zones — each is its own HBox-managed _Panel with no insets so the
    // outer insets/padding token wins.
    this._leftZone  = new _Panel({ insets: new Insets(0, 0, 0, 0) });
    this._rightZone = new _Panel({ insets: new Insets(0, 0, 0, 0) });
    this._leftZone.setLayoutManager(new HBox({ spacing: 4, stretching: true }));
    this._rightZone.setLayoutManager(new HBox({ spacing: 4, stretching: true }));

    this._spacer = new _Component();
    this._spacer.setLayoutConstraints({ weight: 1 });

    this._messageText = new _Text("");
    this._leftZone.addComponent(this._messageText);

    super.addComponent(this._leftZone);
    super.addComponent(this._spacer);
    super.addComponent(this._rightZone);

    // A11y.
    this.getAria().setRole("status");
    this.getAria().setAttribute("live", "polite");

    // Cascade values from the merged bag.
    if (this._options.defaultMessage !== undefined) {
        this._defaultMessage = this._options.defaultMessage;
    }
    if (this._options.message !== undefined) {
        this.setMessage(this._options.message);
    } else if (this._defaultMessage) {
        this._messageText.setText(this._defaultMessage);
        this._message = this._defaultMessage;
    }
}
```

### `applyOptions`

```typescript
protected applyOptions(options: StatusBarOptions): this {
    super.applyOptions(options);

    if (options.defaultMessage !== undefined) this._options.defaultMessage = options.defaultMessage;
    if (options.message        !== undefined) this._options.message        = options.message;

    return this;
}
```

Both keys are late-built state (their setters reach into `_messageText`,
which does not exist during `super.applyOptions`), so they follow the
same write-pure-and-dispatch-later pattern as
[IconText.applyOptions](../src/typescript/lib/component/display/IconText.ts#L109-L117)
— the constructor body dispatches once children exist.

### `setMessage` body

```typescript
setMessage(text: string, timeoutMs?: number): this {
    if (this._messageTimer !== null) {
        window.clearTimeout(this._messageTimer);
        this._messageTimer = null;
    }

    this._message = text;
    this._messageText.setText(text);

    if (timeoutMs !== undefined && timeoutMs > 0) {
        this._messageTimer = window.setTimeout(() => {
            this._messageTimer = null;
            this._message      = this._defaultMessage;
            this._messageText.setText(this._defaultMessage);
        }, timeoutMs);
    }

    return this;
}
```

---

## Ordered Implementation Steps

1. **Create `src/typescript/lib/component/container/StatusBar.ts`** with
   the class skeleton, `StatusBarOptions`, `_defaultStatusBarOptions`,
   and the `callable()` export pair matching
   [Panel.ts:58-63](../src/typescript/lib/core/Panel.ts#L58-L63). Stub
   the setters so the file compiles.
2. **Build the two-zone layout** in the constructor: outer HBox,
   `_leftZone` / `_spacer` / `_rightZone` siblings with the weighted
   spacer, internal HBox per zone.
3. **Build the message Text** — instantiate `_messageText` as a
   [`_Text`](../src/typescript/lib/component/input/Text.ts) and prepend
   it to `_leftZone`.
4. **Implement `addLeft` / `addRight` / `removeLeft` / `removeRight`** —
   thin delegates to the zone Panels.
5. **Implement `setMessage` / `getMessage` / `clearMessage` /
   `setDefaultMessage` / `getDefaultMessage`** with the timer logic
   from the body sketch above.
6. **Wire `applyOptions`** for `message` and `defaultMessage` per the
   late-built-state pattern.
7. **Wire ARIA** — `getAria().setRole("status")` plus
   `getAria().setAttribute("live", "polite")` in the constructor body.
8. **Add the `statusBar` block to `Theme`, `DefaultTheme`, `DarkTheme`,
   and `themeToVars`** in
   [Theme.ts](../src/typescript/lib/core/Theme.ts). Five tokens, four
   touch points.
9. **Export from the bucket barrel.** Add `StatusBar` and
   `StatusBarOptions` to
   [src/typescript/lib/component/container/index.ts](../src/typescript/lib/component/container/index.ts).
10. **JSDoc all public symbols.** Same-bucket links (`{@link
    StatusBarOptions}`) for symbols in `component/container`;
    cross-bucket links via markdown form
    (`[`Text`](/api/component/input/classes/Text)`,
    `[`ProgressBar`](/api/component/display/classes/ProgressBar)`,
    `[`HBox`](/api/layout/classes/HBox)`) per
    [CLAUDE.md](../CLAUDE.md). Apply `@category Components`.
11. **Add a curated docs page** at
    `docs/components/StatusBar.md` and register it in the **Display**
    or a new **Bars** subsection of
    [docs/.vitepress/config.mts](../docs/.vitepress/config.mts) near the
    existing display entries at lines 92-94. Add a row to
    [docs/components/index.md](../docs/components/index.md) in the
    display/chrome section.
12. **Demo on `http://localhost:8015`** — pick `MiscPanel` or a fresh
    `StatusBarPanel` and add:
    ```typescript
    const sb = new StatusBar({ defaultMessage: "Ready" });
    sb.addRight(new IconText("plug", "Connected"));
    container.addComponent(sb); // border-south slot if Border layout
    setTimeout(() => sb.setMessage("Saved", 2000), 1000);
    ```
    Confirm: "Saved" appears at t=1s, reverts to "Ready" at t=3s.
13. **Regression checkpoint:** `grep -rn 'StatusBar' src/typescript/lib`
    — expect matches only in the new file and the bucket barrel.
14. **`npm run docs:build`** — 0 errors, 0 link warnings (the lone
    acceptable warning is typedoc's pre-existing "unsupported TypeScript
    version" notice).
15. **`graphify update .`** to refresh the knowledge graph with the new
    file.

---

## Files to Create / Modify / Delete

| Action | File                                                                                       |
| ------ | ------------------------------------------------------------------------------------------ |
| Create | `src/typescript/lib/component/container/StatusBar.ts`                                      |
| Modify | `src/typescript/lib/component/container/index.ts` — add `StatusBar`, `StatusBarOptions`.   |
| Modify | `src/typescript/lib/core/Theme.ts` — `statusBar` block in `Theme`, `DefaultTheme`, `DarkTheme`, `themeToVars`. |
| Create | `docs/components/StatusBar.md` — curated component page.                                    |
| Modify | `docs/.vitepress/config.mts` — sidebar entry near line 94.                                  |
| Modify | `docs/components/index.md` — add a row in the display/chrome section.                       |

No deletions.

---

## Verification

1. **Type-check:**
   ```
   npm run typecheck
   ```
2. **Library build:**
   ```
   npm run build:lib
   ```
3. **Docs build clean** (zero errors, zero new link warnings — typedoc's
   "unsupported TypeScript version" is the only acceptable warning):
   ```
   npm run docs:build
   ```
4. **Manual smoke** on `http://localhost:8015` (`npm run dev`):
   - Mount a `StatusBar` with `defaultMessage: "Ready"`.
   - Call `sb.setMessage("Saved", 2000)` from the DevTools console.
   - Confirm "Saved" displays for ~2 s and reverts to "Ready".
   - Call `sb.setMessage("Loading…", 5000)` then immediately
     `sb.setMessage("Done", 1000)` — confirm the second timer wins;
     "Done" is visible at the moment the call returns and reverts after
     1 s, with no "Loading…" flash 5 s later.
   - Confirm `addRight(new IconText("plug", "Connected"))` lands on the
     right edge.
5. **Theme toggle** — switch `ThemeManager` to `DarkTheme`; the bar
   background and top border swap to the dark token values without a
   reload.
6. **A11y** — DevTools "Accessibility" tab inspecting the bar's element
   shows `role="status"` and `aria-live="polite"`. A NVDA / VoiceOver
   smoke (optional) announces the message change.
7. **Grep invariants:**
   ```
   grep -rn 'statusBar' src/typescript/lib/core/Theme.ts
   ```
   Expect: four entries (interface + DefaultTheme + DarkTheme +
   `themeToVars`), five new CSS variables on the last hit.
   ```
   grep -rn 'StatusBar' src/typescript/lib
   ```
   Expect: only the new file and the bucket barrel.
8. **Graphify refresh:**
   ```
   graphify update . --directed
   ```

---

## Documentation Impact

- `StatusBar` and `StatusBarOptions` ship through the
  `component/container` barrel at
  [src/typescript/lib/component/container/index.ts](../src/typescript/lib/component/container/index.ts)
  — the only per-subpath barrel that exports it (there is no root
  barrel).
- Curated docs page: new
  [docs/components/StatusBar.md](../docs/components/StatusBar.md). Add
  the row to the catalog at
  [docs/components/index.md](../docs/components/index.md) and register a
  sidebar item in
  [docs/.vitepress/config.mts](../docs/.vitepress/config.mts) near the
  existing display entries at line 94.
- Cross-bucket JSDoc references must use markdown link form (the bucket
  rule from [CLAUDE.md](../CLAUDE.md)). `StatusBar` will reference
  [`Text`](/api/component/input/classes/Text),
  [`Panel`](/api/core/classes/Panel),
  [`HBox`](/api/layout/classes/HBox),
  [`ProgressBar`](/api/component/display/classes/ProgressBar),
  [`ProgressSpinner`](/api/component/display/classes/ProgressSpinner),
  and
  [`IconText`](/api/component/display/classes/IconText) — every one of
  those lives in a different bucket, so each must use markdown links,
  not `{@link}`. Same-bucket references back to `StatusBarOptions` can
  stay as `{@link StatusBarOptions}`.

---

## Potential Challenges

- **Spacer width when both zones empty.** With an empty `_leftZone`
  and `_rightZone`, HBox still hands the spacer the full remaining
  width — desirable; the bar reads as an empty strip rather than
  collapsing. No mitigation needed.
- **Message-timer leak on dispose.** A `setMessage("…", 5000)` followed
  by tear-down of the parent panel would leave the `setTimeout` alive,
  calling `setText` on a detached `_messageText`. Mitigation: override
  the standard dispose hook (or the existing destructor pattern) to
  clear `_messageTimer` if set. Walk
  [Component](../src/typescript/lib/core/Component.ts) for the disposal
  hook name during implementation.
- **HBox `stretching: true` on the outer manager** vertically clamps
  children to the bar's row height — desirable for the zone Panels and
  for the spacer, but a tall caller-added child (e.g. a `Text` with a
  huge `fontSize`) will be clipped. Mitigation: document the 22 px
  height constraint on the JSDoc for `addLeft` / `addRight`; recommend
  small widgets only.
- **No first-class `Aria.setLive`.** The
  [Aria](../src/typescript/lib/core/Aria.ts) class ships dozens of
  named setters but no `setLive`/`setAtomic` pair — use the generic
  `setAttribute("live", "polite")` path. If `aria-live` usage spreads,
  consider promoting it to a first-class setter in a follow-up; out of
  scope here.
- **Theme-token live read for `--ts-ui-statusbar-height`.** The
  constructor hardcodes `STATUS_BAR_HEIGHT = 22` mirroring
  [`MENU_BAR_BUTTON_HEIGHT`](../src/typescript/lib/component/menubar/MenuBarButton.ts).
  A consumer who edits the token at runtime will see the CSS background
  update but not the `setMinSize`/`setMaxSize`-driven row height.
  Mitigation: keep the token authoritative for documentation purposes,
  and call out the constant in the JSDoc.

---

## Critical Files

- [src/typescript/lib/core/Panel.ts](../src/typescript/lib/core/Panel.ts) — parent class; cascade behaviour and `tag` override hook.
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — `setBackgroundColor`, `setColor`, `setElementCSSRule`, `setMinSize`, `setMaxSize`, `setLayoutConstraints`, `getAria`, disposal hook.
- [src/typescript/lib/layout/HBox.ts](../src/typescript/lib/layout/HBox.ts) — weight branch at [lines 275-281](../src/typescript/lib/layout/HBox.ts#L275-L281) drives the spacer.
- [src/typescript/lib/component/menubar/MenuBar.ts](../src/typescript/lib/component/menubar/MenuBar.ts) — closest sibling pattern: Panel-like horizontal strip with HBox layout, theme tokens, `setMinSize` chrome height.
- [src/typescript/lib/component/display/IconText.ts](../src/typescript/lib/component/display/IconText.ts) — late-built `applyOptions` pattern (write pure, dispatch from constructor body).
- [src/typescript/lib/component/display/ProgressBar.ts](../src/typescript/lib/component/display/ProgressBar.ts) — example callable export + `applyOptions` for a Component-derived strip.
- [src/typescript/lib/component/input/Text.ts](../src/typescript/lib/component/input/Text.ts) — the internal `_messageText` type.
- [src/typescript/lib/core/Aria.ts](../src/typescript/lib/core/Aria.ts) — `setRole`, generic `setAttribute` route for `aria-live`.
- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — four touch points for the new tokens.
- [src/typescript/lib/component/container/index.ts](../src/typescript/lib/component/container/index.ts) — the per-subpath barrel.
- [docs/.vitepress/config.mts](../docs/.vitepress/config.mts) — sidebar registration.
- [docs/components/index.md](../docs/components/index.md) — component catalog table.

---

## Non-Goals

- **No shipped StatusBarItem / StatusBarSeparator classes.** Composition
  through `addLeft` / `addRight` with existing components covers the
  generality; a separator is a 1-px `Component` with a background.
- **No anchored-to-window auto-mount.** The caller decides where the
  StatusBar goes in their layout (typically a Border layout's south
  region). No `window.setStatusBar(bar)` convenience — it would break
  the [`one-element-per-class`](../CLAUDE.md) rule.
- **No multi-line message support.** The bar is single-row at the height
  token; longer text is the caller's problem (truncate with
  `text-overflow: ellipsis`, or rotate through a polite queue).
- **No automatic progress integration.** Adding a
  [`ProgressBar`](/api/component/display/classes/ProgressBar) to the
  right zone via `addRight` is fine, but the StatusBar does not own a
  progress concept of its own (no `setProgress`, no `setBusy`).
- **No message history / queue.** `setMessage` is destructive — the
  previous transient message is lost. Callers wanting an undo trail
  build it themselves.
- **No clickable message hook.** The internal `_messageText` is purely
  presentational; if the caller wants a clickable status element, they
  add their own `Button` or wire a listener via `addLeft`.
