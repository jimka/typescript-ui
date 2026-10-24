---
touches-shared:
  - packages/lib/src/typescript/lib/overlay/AbstractWindow.ts
  - packages/lib/src/typescript/lib/overlay/Dock.ts
  - packages/lib/src/typescript/lib/overlay/index.ts
  - packages/lib/src/typescript/lib/layout/Tab.ts
  - packages/lib/src/typescript/lib/component/container/TabBar.ts
  - packages/lib/src/typescript/lib/core/RovingTabIndex.ts
  - packages/lib/src/typescript/lib/layout/LayoutSerialization.ts
  - packages/lib/docs/concepts/accessibility.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
---

# Dock: Activate a Panel Without Moving Focus — Implementation Plan

## Overview

Loom calls [`Dock.focusPanel(id)`](../packages/lib/src/typescript/lib/overlay/Dock.ts#L1990) on every file-tree selection, including arrow-key moves, and expects the tree to keep keyboard focus. Today three library paths take focus away from it:

1. **The float raise.** Since 0.11.0 a shown window with `autoFocus` enabled takes focus on every `bringToFront()`, and `focusPanel` raises a panel's float with a plain `bringToFront()`.
2. **A tab change made from code.** [`Tab.setActiveTabIndex`](../packages/lib/src/typescript/lib/layout/Tab.ts#L2430) goes through [`TabBar.setActiveEntry`](../packages/lib/src/typescript/lib/component/container/TabBar.ts#L2110) and [`RovingTabIndex.moveTo`](../packages/lib/src/typescript/lib/core/RovingTabIndex.ts#L131), which focuses the newly active tab button. `focusPanel` on a tiled panel and `Dock.addPanel`'s activation of a new panel both take this path.
3. **A tab closed from code.** [`TabBar.removeBarEntry`](../packages/lib/src/typescript/lib/component/container/TabBar.ts#L2018) calls [`RovingTabIndex.remove`](../packages/lib/src/typescript/lib/core/RovingTabIndex.ts#L98), which focuses a neighbouring tab button whenever the closed tab was the active one. `Dock.removePanel` takes this path, and Loom's preview closes its temporary tab this way before adding the next one.[^tab-button-focus]

This plan gives the tab strip one focus policy: a gesture on the strip moves focus as today, and a change made from code moves focus onto a tab only when focus would otherwise be lost or already sits in the strip. `Tab.setActiveTabIndex`, `Tab.setActiveContent` and `TabBar.setActiveEntry` take a per-call `focus` option that overrides the policy, and `TabBar.removeBarEntry` takes one for `Tab`'s own use. `Dock.focusPanel` and `AbstractWindow.bringToFront` take the same `focus` option. A float rebuilt by `restoreLayout` ends with the same `autoFocus` as a torn-off float. The spring-loaded raise (the raise a backgrounded window gets while a dragged tab dwells over it) stops moving focus.

---

## Architecture Decisions

### The tab strip's focus policy: gestures move focus, code moves it only to keep it from being lost

The strip decides whether a tab change moves keyboard focus onto a tab:

- **A user gesture on the strip moves focus, as today.** These are a click on a tab, `ArrowLeft` / `ArrowRight` / `Home` / `End` / `Delete` while a tab holds focus, and the context menu's *Switch to*.
- **A change made from code moves only the roving stop** (the group's single `tabindex="0"` member) — unless one of three things holds, in which case focus moves too:
  1. the strip already holds focus (a tab button or a ✕ of this strip);
  2. nothing holds focus (the active element is `<body>` or none);
  3. focus is inside the tab content the change hides or removes.
- **A removal** moves focus to a surviving tab only when the closed cell held focus or focus was inside the closed tab's content.
- **An explicit `focus` option wins:** `true` always moves focus, `false` never does.

| Change | Where focus is before | Focus after | vs today |
|---|---|---|---|
| click on a tab, or the menu's *Switch to* | anywhere | new tab's button | same |
| `setActiveTabIndex(i)` from code | in a file tree outside the strip | stays in the tree | **changed** (was: new tab's button) |
| `setActiveTabIndex(i)` from code | on another tab of the same strip | new tab's button | same |
| `setActiveTabIndex(i)` from code | nowhere (`<body>`) | new tab's button | same |
| `setActiveTabIndex(i)` from code | inside the tab being hidden | new tab's button | same |
| `Dock.addPanel(spec)` (activated on the next layout) | in a file tree | stays in the tree | **changed** |
| `closeTab` / `removePanel` of the active tab from code | in a file tree | stays in the tree | **changed** (was: neighbour's button) |
| `closeTab`, ✕ or `Delete` | on the closed tab's button or ✕ | neighbour's button | same |
| `closeTab` from code | inside the closed tab's content | neighbour's button | same |
| `Tab.revealDescendant(target)` | anywhere | not moved onto a tab; the caller focuses `target` next | **changed** |
| `setActiveTabIndex(i, { focus: true })` | anywhere | new tab's button | — |
| `setActiveTabIndex(i, { focus: false })` | anywhere | not moved | — |

This follows the rule the library already applies when it hands focus back: move focus only when it would otherwise be lost, and never take it from an element that still holds it.[^policy-precedent] It is the corrected default, not an opt-in, because the old default took focus from whatever held it.[^corrected-default]

### Policy lives in `TabBar` and `Tab`; `RovingTabIndex` keeps its default

`RovingTabIndex.moveTo` and `remove` take `{ focus?: boolean }`, defaulting to `true` as today, so `ToolBar` and `ButtonGroup` are unchanged. `TabBar` applies conditions 1 and 2, which it can see from its own entries. `Tab` adds condition 3, because only `Tab` knows which content a change hides or removes. `Tab` uses its existing `contentAround(target)` lookup for that.[^layering]

### A `focus` option on `focusPanel`, not a separate `revealPanel`

`focusPanel(id, options?)` gains `focus?: boolean`. `focus: false` activates the tab and raises its float without moving focus. It mirrors [`CodeEditor.revealRange(at, { focus })`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1499) and its [`CodeEditorRevealOptions.focus`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L144). That option exists for the same case: "previewing a location from another control that should keep focus — a search-results list being arrowed through".[^not-reveal-panel] `focusPanel` passes `options.focus` unchanged to both the window raise and the tab switch.

### `bringToFront` gets the same option instead of the Dock toggling `autoFocus`

`AbstractWindow.bringToFront(options?: WindowRaiseOptions)` takes `focus?: boolean`. Its body already routes through the private `raise(takeFocus)` that `show()` uses to raise without focus. The option only changes how `takeFocus` is computed.[^window-option]

### `focus` has three states everywhere

Omitting `focus` applies the component's default: the window's `autoFocus` for a raise, the strip's policy for a tab switch. An explicit value wins over the default. The two methods applications call get named option interfaces (`WindowRaiseOptions`, `DockFocusPanelOptions`), following `CodeEditorRevealOptions`. The lower-level methods take an inline `{ focus?: boolean }`, following `RovingTabIndex`'s inline constructor options.[^option-types]

| Call | Tab switch | Float raise |
|---|---|---|
| `focusPanel(id)` | strip policy | window's `autoFocus` decides |
| `focusPanel(id, { focus: true })` | focus moves to the new tab | window takes focus, also with `autoFocus: false` |
| `focusPanel(id, { focus: false })` | no focus move; roving stop moves | raised and activated; no focus move |
| `win.bringToFront()` or `bringToFront({})` | — | `autoFocus` decides |
| `win.bringToFront({ focus: false })` | — | never takes focus |
| `win.bringToFront({ focus: true })`, window shown | — | takes focus |

A window that is not shown never takes focus. A repeat activation of the tab that is already active never moves focus, because `RovingTabIndex.moveTo` returns early for it. Both rules are unchanged.

### Restored floats end with the library default `autoFocus: true`

[`applyWindow`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L652) keeps building the window with `autoFocus: false`, so the restore's own `show()` takes no focus. After `show()` and `setWindowState`, it calls `win.setAutoFocus(true)`. From then on a restored float and a torn-off float answer every later raise the same way.[^restore-default] This is the fix the 0.11.0 plan named in advance for this exact problem.[^restore-history]

### A tear-off still takes focus at the moment of tear-off

[`detachTabToWindow`](../packages/lib/src/typescript/lib/layout/Tab.ts#L2531) is not changed. The tear-off is the user's own gesture and the new window is its result, so it takes focus.[^tear-off-focus]

### The spring-loaded raise during a drag never moves focus; the drop raise is unchanged

Both spring-loaded raises pass `{ focus: false }`: `DockRegion`'s dwell timer (through `raiseHostWindow`) and `Tab._onBarDockHover`. The raise after a drop (`DockRegion`'s `onDrop`, `Tab._onBarDockRequested`) keeps a plain `bringToFront()`. The drop ends the gesture in that window, as a tear-off does.[^spring-raise]

---

## Public API

```typescript
// overlay/AbstractWindow.ts — new, exported, declared after WindowOptions (:173–209)
/**
 * Options for {@link AbstractWindow.bringToFront}.
 *
 * @category Core
 */
export interface WindowRaiseOptions {
    /**
     * Whether the raise moves keyboard focus into the window. Omit it to
     * follow the window's `autoFocus`. `false` raises and activates the window
     * without moving focus — for code that surfaces a window while the user
     * keeps working elsewhere, such as a list being arrowed through. `true`
     * takes focus also when `autoFocus` is `false`. A window that is not shown
     * never takes focus.
     */
    focus?: boolean;
}

// AbstractWindow — signature widened (was `bringToFront(): void`)
bringToFront(options?: WindowRaiseOptions): void;
```

```typescript
// overlay/Dock.ts — new, exported, declared after DockExceptionEvent (:212–217)
/**
 * Options for {@link Dock.focusPanel}.
 *
 * @category Core
 */
export interface DockFocusPanelOptions {
    /**
     * Whether activating the panel may move keyboard focus. Omit it for the
     * defaults: the tab switch moves focus onto the panel's tab only when
     * focus would otherwise be lost or already sits in that tab strip, and
     * raising the panel's float lets the window's `autoFocus` decide. `false`
     * moves no focus — for selecting panels from another control that keeps
     * focus, such as a file tree or a results list being arrowed through.
     * `true` moves focus onto the panel's tab and into its float, also one
     * built with `autoFocus: false`.
     */
    focus?: boolean;
}

// Dock — signature widened (was `focusPanel(id: string): boolean`)
focusPanel(id: string, options?: DockFocusPanelOptions): boolean;
```

```typescript
// layout/Tab.ts — signatures widened
setActiveTabIndex(index: number, options?: { focus?: boolean }): this;
setActiveContent(content: Component, options?: { focus?: boolean }): this;

// component/container/TabBar.ts — signatures widened
setActiveEntry(id: string, options?: { focus?: boolean }): this;
removeBarEntry(id: string, options?: { focus?: boolean }): this;

// core/RovingTabIndex.ts — signatures widened, default unchanged (`focus: true`)
moveTo(index: number, options?: { focus?: boolean }): void;
remove(component: Component, options?: { focus?: boolean }): this;
```

No new state-bearing property: every option is per call. `Tab` gains one private field, `_pendingActiveFocus`, beside `_pendingActiveContent`, to carry a deferred `setActiveContent`'s option to the layout pass that applies it. `overlay/index.ts` exports the two new interface types.

---

## Implementation

### `RovingTabIndex`

`moveTo` — only the last block changes; the early return for a repeat activation stays.

```typescript
if (next) {
    next.getAria().setTabIndex(0);

    if (options?.focus ?? true) {
        next.focus(this._preventScroll);
    }
}
```

`remove` — the re-activation forwards the option: `this.moveTo(Math.max(0, idx - 1), options);`.

### `TabBar`

```typescript
/**
 * Whether a tab change made from code may move keyboard focus onto a tab: the
 * strip already holds focus on a tab button or ✕, or nothing holds focus.
 * Focus on a strip tool or anywhere else on the page stays where it is.
 *
 * @returns `true` when a change made from code may move focus.
 */
private codeChangeMayFocus(): boolean {
    const active = DOM.source.getActiveElement();

    return active === null
        || active === DOM.source.getBody()
        || this.entryIndexForElement(active) >= 0;
}

setActiveEntry(id: string, options?: { focus?: boolean }): this {
    // … unchanged lookup and button-group sync …
    this.onTabPressed(this._entries[idx].button, options?.focus ?? this.codeChangeMayFocus());

    return this;
}

private onTabPressed(button: Component, focus: boolean = true): void {
    // … unchanged …
    if (rovingIdx >= 0) {
        this._rovingTabIndex.moveTo(rovingIdx, { focus });
    }
    // … unchanged …
}
```

The two gesture callers of `setActiveEntry` pass `{ focus: true }`: `activateEdgeEntry` ([:1856](../packages/lib/src/typescript/lib/component/container/TabBar.ts#L1856)) and the context menu's *Switch to* action ([:2179](../packages/lib/src/typescript/lib/component/container/TabBar.ts#L2179)). The click listener ([:1942](../packages/lib/src/typescript/lib/component/container/TabBar.ts#L1942)) and the arrow-key handler call `onTabPressed(button)` and keep the default `true`.

`removeBarEntry` — after the existing `heldFocus` line:

```typescript
const rescue = options?.focus ?? heldFocus;
// …
if (entry.closeButton) {
    this._rovingTabIndex.remove(entry.closeButton, { focus: rescue });
}

this._rovingTabIndex.remove(entry.button, { focus: rescue });
this._entries.splice(idx, 1);
this.moveRovingOffCloseButton(rescue);
this.restoreFocusAfterClose(rescue && !wasRovingActive, idx);
```

`moveRovingOffCloseButton(focus: boolean)` passes `{ focus }` to its `moveTo` ([:1766](../packages/lib/src/typescript/lib/component/container/TabBar.ts#L1766)). `restoreFocusAfterClose` is unchanged: it runs only when its `repair` argument is `true`, and then it focuses.

### `Tab`

```typescript
/**
 * Whether keyboard focus is inside `content`'s element.
 *
 * @param content - The tab content to test, or `null`.
 *
 * @returns `true` when the focused element lies inside `content`.
 */
private contentHoldsFocus(content: Component | null): boolean {
    const active = DOM.source.getActiveElement();

    return content !== null && active !== null && this.contentAround(active) === content;
}

setActiveTabIndex(index: number, options?: { focus?: boolean }): this {
    if (this._contents.length === 0) {
        return this;
    }

    const clamped = Util.clamp(index, 0, this._contents.length - 1);

    // Condition 3 of the strip's policy: focus inside the content this switch
    // hides would otherwise be lost, so it follows the switch onto the tab.
    const rescue = this.contentHoldsFocus(this.getActiveContent());
    const focus  = options?.focus ?? (rescue ? true : undefined);

    this._bar.setActiveEntry(this._contents[clamped].id, { focus });

    return this;
}
```

- `setActiveContent(content, options?)`: the immediate branch calls `this.setActiveTabIndex(index, options)`. The deferred branch also stores `this._pendingActiveFocus = options?.focus`. The immediate branch clears it to `undefined` alongside `_pendingActiveContent = null`.
- The pending block in `doLayout` ([:2084–2091](../packages/lib/src/typescript/lib/layout/Tab.ts#L2084)) calls `this.setActiveTabIndex(pendingIndex, { focus: this._pendingActiveFocus })` and then clears the field. Declare the field beside `_pendingActiveContent` ([:333](../packages/lib/src/typescript/lib/layout/Tab.ts#L333)): `private _pendingActiveFocus: boolean | undefined = undefined;`. The policy is evaluated when the pass applies the change, which is the moment focus would move.
- `closeEntry` ([:1179](../packages/lib/src/typescript/lib/layout/Tab.ts#L1179)): before `this._bar.removeBarEntry(id)`, compute `const rescue = this.contentHoldsFocus(content);` and call `this._bar.removeBarEntry(id, rescue ? { focus: true } : undefined)`.
- `revealDescendant` ([:2349](../packages/lib/src/typescript/lib/layout/Tab.ts#L2349)): `this.setActiveContent(content, { focus: false })`. Its caller focuses `target` next, so a focus stop on the tab button in between serves no one.
- `removeEntryKeepingContent` ([:2505](../packages/lib/src/typescript/lib/layout/Tab.ts#L2505)) keeps `this._bar.removeBarEntry(id)`. A tear-off or re-dock moves the content out first, and the cell's own focus is the only thing to rescue.

### `AbstractWindow.bringToFront`

```typescript
bringToFront(options?: WindowRaiseOptions): void {
    const shown     = AbstractWindow.openWindows.has(this);
    const takeFocus = shown && (options?.focus ?? this.isAutoFocus());

    this.raise(takeFocus);

    if (takeFocus) {
        this.takeFocus();
    }
}
```

### `Dock.focusPanel`

Replace the two statements before `return true`:

```typescript
const focus = options?.focus;

this.floatForFrame(frame)?.bringToFront({ focus });
(region.getLayoutManager() as Tab).setActiveTabIndex(index, { focus });
```

`addPanel` and `addLazyPanel` are not edited: the policy in `Tab` / `TabBar` already stops their deferred activation from taking focus away from a control outside the strip.

### `applyWindow`

Add this as the function's last statement, after the existing `if (node.state !== "normal") { … }` block:

```typescript
// From here on the float answers later raises (Dock.focusPanel, a drop into
// it) like a float torn off a tab strip. show() decided its own focus move
// when it ran, so switching autoFocus on now moves no focus.
win.setAutoFocus(true);
```

Replace the comment above `new Window(node.header, { autoFocus: false })` ([:670](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L670)) with: "A restored layout shows its windows from code, not from a gesture on any one of them, so the show takes no focus."

### Spring-loaded raises

```typescript
// DockRegion
private raiseHostWindow(options?: WindowRaiseOptions): void {
    this.hostWindow()?.bringToFront(options);
}

// in scheduleSpringRaise's timer callback (:180):
this.raiseHostWindow({ focus: false });
// the onDrop call (:117) stays `this.raiseHostWindow();`
```

`Tab._onBarDockHover` body becomes `this.ancestorWindow()?.bringToFront({ focus: false });`.

---

## Ordered Implementation Steps

Paths are relative to `packages/lib/`. Line numbers were taken at `180751e98` (v0.11.0); re-locate by symbol if they drifted.

1. **Baseline.** In a worktree, symlink `node_modules` from the main tree first (repo root and `packages/lib`). Run `npx vitest run tests/core/RovingTabIndex.test.ts tests/component/container/TabBar.test.ts tests/component/container/TabBar.contextMenu.test.ts tests/component/layout/Tab.test.ts tests/layout/Tab.keyboardClose.test.ts tests/component/layout/Tab.dockraise.test.ts tests/unit/core/FocusReveal.test.ts tests/overlay/AbstractWindow.focus.test.ts tests/overlay/Dock.lifecycle.test.ts tests/component/layout/LayoutSerialization.test.ts`. All must pass before any edit.
2. **Tests first.** Write every automated case of `## Expected Behaviour` in the file its table names, and rewrite case L1. Run the step-1 command plus the new `tests/layout/DockRegion.springRaise.test.ts`.
   - These must fail now: RT1, RT4, TB1, TB5, T1, T3, T4, T6, T7, W1–W3, D1–D3, D5, D6, DP1, S1, S2, L1.
   - These pins must pass now: RT2, RT3, RT5, TB2–TB4, TB6, T2, T5, T8, W4, W5, D4, TO1, S3.
   - If a case lands on the other side of that split, stop and report instead of adjusting the test. `npm run typecheck:test` fails until step 8; that is expected.
3. **`core/RovingTabIndex.ts`.** Widen `moveTo` ([:131](../packages/lib/src/typescript/lib/core/RovingTabIndex.ts#L131)) and `remove` ([:98](../packages/lib/src/typescript/lib/core/RovingTabIndex.ts#L98)) per `## Implementation`.
   - `moveTo` JSDoc: "…and transfers DOM focus unless `options.focus` is `false`", plus `@param options - `focus: false` moves the tabindex without focusing the item.`
   - `remove` `@remarks`: "If the removed item was active, the previous item (or index 0) becomes active and, unless `options.focus` is `false`, takes focus."
   - Leave the class header comment alone.
   - Check: RT1–RT5 pass.
4. **`component/container/TabBar.ts`.** Add `codeChangeMayFocus` after `entryIndexForElement` ([:1724](../packages/lib/src/typescript/lib/component/container/TabBar.ts#L1724)). Then edit `setActiveEntry`, `onTabPressed`, `removeBarEntry`, `moveRovingOffCloseButton` ([:1749](../packages/lib/src/typescript/lib/component/container/TabBar.ts#L1749)) and the two gesture callers per `## Implementation`. JSDoc:
   - `setActiveEntry`: "Activates the cell with `id` from code. The roving stop moves to it; keyboard focus moves onto its button only when the strip already holds focus or nothing does, unless `options.focus` says otherwise. No-op for an unknown id." plus `@param options - `true` always moves focus onto the cell's button, `false` never does.`
   - `removeBarEntry`: `@param options - `true` moves focus to a surviving cell, `false` never does; omitted, focus moves only when the removed cell held it.`
   - `onTabPressed` and `moveRovingOffCloseButton`: `@param focus - False to move the roving stop without focusing.` In `moveRovingOffCloseButton`'s summary, replace "moving DOM focus with it" with "moving DOM focus with it when `focus` is true".
   - Do not touch `restoreFocusAfterClose`, `focusActiveEdgeEntry` or the arrow-key handler.
   - Check: TB1–TB6 pass; every pre-existing case in `TabBar.test.ts`, `TabBar.contextMenu.test.ts` and `TabBar.edgecases.test.ts` passes unchanged.
5. **`layout/Tab.ts` — tab changes.**
   - The JSDoc block at [:2398–2407](../packages/lib/src/typescript/lib/layout/Tab.ts#L2398) describes `setActiveTabIndex` but sits above `setActiveContent`'s own block, so `setActiveTabIndex` has none. Move that block to sit directly above `setActiveTabIndex` ([:2430](../packages/lib/src/typescript/lib/layout/Tab.ts#L2430)), and replace "the roving tabindex" in it with "the roving tab stop". Add: "Keyboard focus moves onto the new tab only when the strip already holds focus, nothing does, or focus is inside the content this switch hides, unless `options.focus` says otherwise." and `@param options - `true` always moves focus onto the new tab, `false` never does.`
   - Add `contentHoldsFocus` after `contentAround` ([:2373](../packages/lib/src/typescript/lib/layout/Tab.ts#L2373)).
   - Edit `setActiveTabIndex`, `setActiveContent`, the `doLayout` pending block, `closeEntry` and `revealDescendant` per `## Implementation`. Give `setActiveContent` the same `@param options` text.
   - Check: T1–T8 pass; `tests/layout/Tab.keyboardClose.test.ts` and `tests/unit/core/FocusReveal.test.ts` pass unchanged.
6. **`overlay/AbstractWindow.ts`.** Add `WindowRaiseOptions` after `WindowOptions` (ends [:209](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L209)), and replace `bringToFront` ([:966](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L966)) per `## Implementation`.
   - `bringToFront`'s `@remarks` becomes: "A shown window takes keyboard focus when `options.focus` says so, or, with `focus` omitted, when `autoFocus` is enabled — also when it is already the active window. A window that is not shown moves no focus." Add `@param options - Whether the raise moves keyboard focus; see `WindowRaiseOptions`.`
   - Append to the `autoFocus` JSDoc ([:197–203](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L197)) and to `setAutoFocus`'s ([:2349](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2349)): "A `bringToFront({ focus })` call's own `focus` value overrides it."
   - Do not touch `raise`, `show`, `restore` or `onActivate`.
   - Check: W1–W5 pass; every pre-existing case in `AbstractWindow.focus.test.ts` passes unchanged.
7. **`overlay/index.ts` — window type.** Add `WindowRaiseOptions` to the `export type { … } from '~/overlay/AbstractWindow.js'` line ([:8](../packages/lib/src/typescript/lib/overlay/index.ts#L8)). Check: `npm run typecheck` passes.
8. **`overlay/Dock.ts`.** Add `DockFocusPanelOptions` after `DockExceptionEvent` (ends [:217](../packages/lib/src/typescript/lib/overlay/Dock.ts#L217)), and add it to the `export type { … } from '~/overlay/Dock.js'` line of `overlay/index.ts` ([:29](../packages/lib/src/typescript/lib/overlay/index.ts#L29)). Widen `focusPanel` ([:1990](../packages/lib/src/typescript/lib/overlay/Dock.ts#L1990)) per `## Implementation`.
   - JSDoc summary: "Activates the tab hosting `id` and raises its host float when it lives in one, so a buried floated panel surfaces. A successful activation emits a `"focus"`. Keyboard focus follows the defaults described on `DockFocusPanelOptions`; pass `{ focus: false }` to leave focus where it is." Add `@param options - Whether the activation may move keyboard focus.`
   - Describe `bringToFront` in prose; do not `{@link}` it.
   - Check: D1–D6, DP1 and TO1 pass; `npm run typecheck:test` passes.
9. **Spring-loaded raises.**
   - In `layout/DockRegion.ts`: add `WindowRaiseOptions` to the existing `AbstractWindow` import ([:6](../packages/lib/src/typescript/lib/layout/DockRegion.ts#L6)) as `import { AbstractWindow, type WindowRaiseOptions } from …`. Change `raiseHostWindow` ([:158](../packages/lib/src/typescript/lib/layout/DockRegion.ts#L158)) and the timer call ([:180](../packages/lib/src/typescript/lib/layout/DockRegion.ts#L180)) per `## Implementation`; leave the `onDrop` call ([:117](../packages/lib/src/typescript/lib/layout/DockRegion.ts#L117)).
   - `raiseHostWindow`'s JSDoc becomes: "Raises and activates the region's host window, if any. A no-op for an in-document region. `options` goes to the window's `bringToFront`: the drop raise passes none, so the window's `autoFocus` decides; the spring-loaded raise passes `focus: false`." Add `@param options - Forwarded to the window's raise.` Add one sentence to `scheduleSpringRaise`'s JSDoc: "The raise moves no keyboard focus."
   - In `layout/Tab.ts`: change `_onBarDockHover` ([:1520](../packages/lib/src/typescript/lib/layout/Tab.ts#L1520)) per `## Implementation`, and replace the last sentence of its JSDoc with "The raise moves no keyboard focus."
   - Check: S1–S3 pass.
10. **`layout/LayoutSerialization.ts`.** Edit `applyWindow` per `## Implementation`. Check: L1 passes.
11. **Docs.** Apply every edit in `## Documentation Impact`.
12. **Full verification.** Run everything in `## Verification`. A pre-existing test that fails because it asserted the old focus move from a change made from code: stop and report it with the case name, rather than editing it.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/RovingTabIndex.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Tab.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/index.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dock.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/DockRegion.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/LayoutSerialization.ts` |
| Modify | `packages/lib/tests/core/RovingTabIndex.test.ts` |
| Modify | `packages/lib/tests/component/container/TabBar.test.ts` |
| Modify | `packages/lib/tests/component/container/TabBar.contextMenu.test.ts` |
| Modify | `packages/lib/tests/component/layout/Tab.test.ts` |
| Modify | `packages/lib/tests/component/layout/Tab.dockraise.test.ts` |
| Modify | `packages/lib/tests/overlay/AbstractWindow.focus.test.ts` |
| Modify | `packages/lib/tests/overlay/Dock.lifecycle.test.ts` |
| Modify | `packages/lib/tests/component/layout/LayoutSerialization.test.ts` |
| Create | `packages/lib/tests/layout/DockRegion.springRaise.test.ts` |
| Modify | `packages/lib/docs/components/Dock.md` |
| Modify | `packages/lib/docs/components/Window.md` |
| Modify | `packages/lib/docs/components/AbstractWindow.md` |
| Modify | `packages/lib/docs/components/TabBar.md` |
| Modify | `packages/lib/docs/layouts/Tab.md` |
| Modify | `packages/lib/docs/layouts/LayoutSerialization.md` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |

---

## Expected Behaviour

The offline test DOM models focus: `DOM.sink.focus(handle)` records the focused handle, and `DOM.source.getActiveElement()` returns it (`null` until something is focused). Focus moves are therefore unit-testable. Rules for every focus case:

- Materialise the elements involved (`getElement(true)`).
- Put focus where the case says *after* all setup. Then a focus move during setup cannot pass the test by accident. "An outside button" means a connected `Button` outside the strip, as `focusedOpener()` in `AbstractWindow.focus.test.ts` builds. "Nothing focused" means `DOM.sink.blur(…)` on whatever setup focused, so that `getActiveElement()` is `null`.
- "Inside the content" means an element appended with `DOM.sink.appendChild(content.getElement(true)!, el)` and focused, as `FocusReveal.test.ts` builds its `target`.
- In `Dock.lifecycle.test.ts`, call `flush()` once more before placing focus. A shown float queues its show-time focus move on a layout callback that `flush()` drains.

### `RovingTabIndex` — `tests/core/RovingTabIndex.test.ts`, in "repeat activation" (uses `renderedGroup`)

| Case | Setup and action | Expected |
|---|---|---|
| RT1 | `renderedGroup(3)`; clear `sink.writes`; `g.moveTo(2, { focus: false })` | no `focus` write; `tabIndices(g)` is `[-1, -1, 0]`; `getActiveIndex()` is `2` |
| RT2 | as RT1 with `g.moveTo(2)` | one `focus` write (the existing "still focuses…" case pins this; keep it) |
| RT3 | `renderedGroup(3)`; `g.moveTo(0, { focus: false })` three times | no writes at all; active index `0` |
| RT4 | `renderedGroup(3)`; `g.moveTo(2)`; clear `sink.writes`; `g.remove(items[2], { focus: false })` | no `focus` write; `tabIndices(g)` is `[-1, 0]` |
| RT5 | as RT4 with `g.remove(items[2])` | one `focus` write |

### `TabBar` — `tests/component/container/TabBar.test.ts` (uses `threeEntryBar`, `barEntries`)

Each case materialises the strip (`bar.getElement(true)`) and every entry's button.

| Case | Setup and action | Expected |
|---|---|---|
| TB1 | focus an outside button; spy `"tabpressed"`; `bar.setActiveEntry('c')` | active element still the outside button; `getActiveEntryId()` is `'c'`; `"tabpressed"` fired once with `'c'`; button tabindices `[-1, -1, 0]` |
| TB2 | focus entry `b`'s button; `bar.setActiveEntry('c')` | active element is entry `c`'s button |
| TB3 | nothing focused; `bar.setActiveEntry('c')` | active element is entry `c`'s button |
| TB4 | focus an outside button; `bar.setActiveEntry('c', { focus: true })` | active element is entry `c`'s button |
| TB5 | focus entry `b`'s button; `bar.setActiveEntry('c', { focus: false })` | active element still `b`'s button; button tabindices `[-1, -1, 0]` |
| TB6 | `tests/component/container/TabBar.contextMenu.test.ts`: `pinnedFirstBar()`, materialised; focus an outside button; `openMenuFor(bar, 0)`; run the action of the *Switch to* submenu item labelled `Gamma` | active element is entry `c`'s button (a gesture on the strip) |

### `Tab` — `tests/component/layout/Tab.test.ts`, in "Tab active-index state" (uses `hostTab`)

Setup for every case: `hostTab(new Tab())`, `createTab(a)`, `createTab(b)`, `host.getElement(true)`, and every tab button and both contents materialised. `a` is active.

| Case | Setup and action | Expected |
|---|---|---|
| T1 | focus an outside button; spy `tab.on('activate')`; `tab.setActiveTabIndex(1)` | `getActiveTabIndex()` is `1`; `"activate"` fired with `b`; active element still the outside button |
| T2 | focus an element inside `a`'s content; `tab.setActiveTabIndex(1)` | active element is `b`'s tab button |
| T3 | nothing focused; `tab.setActiveTabIndex(1, { focus: false })` | active element is `null` |
| T4 | build `c` and `host.addComponent(c)` without `createTab`; `tab.setActiveContent(c)` (deferred: no cell yet); focus an outside button; `host.doLayout()` | `getActiveContent()` is `c`; active element still the outside button |
| T5 | focus an element inside `a`'s content; `tab.closeTab(a)` | active element is `b`'s tab button |
| T6 | focus an outside button; `tab.closeTab(a)` | active element still the outside button; `getActiveContent()` is `b` |
| T7 | nothing focused; a `target` appended inside `b`'s content; `tab.revealDescendant(target)` | `getVisibleComponent()` is `b`; active element is `null` |
| T8 | focus an outside button; `tab.setActiveTabIndex(1, { focus: true })` | active element is `b`'s tab button |

### `bringToFront` — `tests/overlay/AbstractWindow.focus.test.ts`, in "bringToFront(), a press and restore()" (uses `shown`, `collectLayoutCallbacks`, `pageElement`)

| Case | Setup and action | Expected |
|---|---|---|
| W1 | `a` and `b` shown (default `autoFocus`), `b` active; focus a `pageElement()`; spy `DOM.sink.focus` and `a.on('activate')`; `a.bringToFront({ focus: false })` | `focus` not called; `"activate"` fired once |
| W2 | `win` shown and active; focus a `pageElement()`; `win.bringToFront({ focus: false })` | active element still the page element |
| W3 | `a` shown with `autoFocus: false`, `b` shown and active; focus a `pageElement()`; `a.bringToFront({ focus: true })` | active element is `a`'s element |
| W4 | a window rendered but never shown; `bringToFront({ focus: true })` | `focus` not called |
| W5 | `win` shown and active (default `autoFocus`); focus a `pageElement()`; `win.bringToFront({})` | active element is `win`'s element (same as R1) |

Also assert in W1 and W2 that `(win as any)._focusOnActivation` is `true` after the call, as R9 does.

### `Dock` — `tests/overlay/Dock.lifecycle.test.ts`, new `describe('Dock keyboard focus')` (uses `mountDock`, `captureRaf`, `flush`, `floatPanel`, `rootTab`)

Panels are added `a` then `b`, so `b` is active after setup. "Opener" is an outside button standing in for Loom's file tree.

| Case | Setup and action | Expected |
|---|---|---|
| D1 | tiled `a`, `b`; focus opener; `dock.focusPanel('a', { focus: false })` | returns `true`; `rootTab(dock).getActiveContent().getId()` is `'a'`; active element is the opener; one dock `"focus"` with `id` `'a'` |
| D2 | as D1 with `dock.focusPanel('a')` | active element is the opener (the strip's policy) |
| D3 | tiled `a`, `b`; `const win = floatPanel(dock, 'a')`; `dock.focusPanel('b')`; `flush()`; focus opener; `dock.focusPanel('a', { focus: false })` | returns `true`; active element is the opener; last dock `"focus"` has `id` `'a'` and `window` `win` |
| D4 | as D3 with `dock.focusPanel('a')` | active element is `win.getElement()` |
| D5 | as D3, then focus opener again and call `dock.focusPanel('a', { focus: false })` a second time (the float is now already the active window) | active element is the opener |
| D6 | tiled `a`, `b`; `floatPanel(dock, 'a')`; `const state = dock.getLayoutState()`; `dock.setLayoutState(state)`; lay the restored float out the way `floatPanel` does (find it in `AbstractWindow.getOpenWindows()`, collect its regions, `getElement(true)` + `doLayout()`); `flush()`; focus opener | the restored float's `isAutoFocus()` is `true`. Then `dock.focusPanel('a', { focus: false })` leaves the opener focused, and `dock.focusPanel('a')` afterwards moves focus to the restored float's element — the result D4 gives for a torn-off float |
| DP1 | Loom's preview of a file that is not open yet: tiled `a` (the temporary tab), `b`; `dock.focusPanel('a')`; `flush()`; focus opener; `dock.removePanel('a')`; `dock.addPanel({ id: 'c', … })`; `dock.focusPanel('c', { focus: false })`; `dock.doLayout()`; `flush()` | `rootTab(dock).getActiveContent().getId()` is `'c'`; active element is the opener |
| TO1 | tiled `a`, `b`; focus opener; drive a bare tear-off of `a` as `Dock.panelPresentation.test.ts` ([:279](../packages/lib/tests/overlay/Dock.panelPresentation.test.ts#L279)) does (`detachTabToWindow(entryId, frameA, 100, 100, true)`); take the new window from `AbstractWindow.getOpenWindows()` | the new window's `isAutoFocus()` is `true` and the active element is its element (pins the tear-off's focus) |

### Spring-loaded and drop raises

| Case | File | Setup and action | Expected |
|---|---|---|---|
| S1 | new `tests/layout/DockRegion.springRaise.test.ts` | `installTestDOM`; a shown `Window` holding a `Container` region; `const dr = new DockRegion(region)`; spy `globalThis.setTimeout` to capture its callback; `vi.spyOn(DragManager, 'isDragging').mockReturnValue(true)`; spy `win.bringToFront`; focus an outside button; `(dr as any).scheduleSpringRaise()`; run the captured callback | `bringToFront` called once with `{ focus: false }`; active element still the outside button. Dispose `win` and call `dr.destroy()` in teardown |
| S2 | `tests/component/layout/Tab.dockraise.test.ts`, the existing dock-hover case | `bar.emit('dockhover')` | add: spy called with `{ focus: false }` |
| S3 | same file, the existing drop case | `bar.emit('dockrequested', …)` | add: spy called with no arguments (`toHaveBeenCalledWith()`) |

### Restore — `tests/component/layout/LayoutSerialization.test.ts`

| Case | Setup and action | Expected |
|---|---|---|
| L1 (rewrite the existing case at [:1022](../packages/lib/tests/component/layout/LayoutSerialization.test.ts#L1022)) | collect `Component.afterNextLayout` callbacks (as `collectLayoutCallbacks()` in `AbstractWindow.focus.test.ts` does); focus a connected opener button; same `restoreLayout` call as today; run the collected callbacks | active element is still the opener; the float's `isAutoFocus()` is `true`. Rename the case to "a restored floating window takes no focus when shown and ends with autoFocus on" |

### Manual verification (real browser; the offline DOM cannot show these)

| Case | Steps | Expected |
|---|---|---|
| MV1 | Demo app, *Misc* page, "Dockable layout (Dock)". Tear a tab off into a float. | `document.activeElement` (DevTools console) is inside the new float |
| MV2 | Same dock: open a second float, click into a text field on the main page, then drag a tab from the dock, dwell over the backgrounded float until it rises, and drop the tab back on its own strip | the float rose; after the drop, focus is not inside the float that rose |
| MV3 | Demo app, *Tab* page: click a tab, then use `ArrowRight`, `Home`, `End` and `Delete` on the strip; right-click a tab and use *Switch to* | focus follows each gesture onto the new tab's button, as before this change |
| MV4 | Loom built against this branch (`npm run build:lib`, then point Loom at the local build), with Loom's `'temporary'` opens changed to `dock.focusPanel(id, { focus: false })`. Arrow through the file tree over files that are open (tiled and in a torn-off tab) and files that are not open yet | the matching tab follows the selection; the tree keeps focus on every arrow key |

---

## Verification

From `packages/lib`:

- `npm run typecheck` and `npm run typecheck:test` pass.
- `npm run lint` passes.
- `npx vitest run` — the whole suite passes, including every case above.
- `npm run docs:api` finishes with zero warnings.
- `npm run docs:llms:check` passes.
- `grep -rn "{ autoFocus: false }" src/typescript/lib` — one match, in `layout/LayoutSerialization.ts`.
- `grep -rn "setAutoFocus(true)" src/typescript/lib` — one match, in `layout/LayoutSerialization.ts`.
- `grep -n "setActiveEntry(" src/typescript/lib/component/container/TabBar.ts` — the two gesture callers pass `{ focus: true }`.
- Manual cases MV1–MV4.

---

## Documentation Impact

New types `WindowRaiseOptions` and `DockFocusPanelOptions` are exported from `@jimka/typescript-ui/overlay` ([overlay/index.ts](../packages/lib/src/typescript/lib/overlay/index.ts)). Their API pages are `/api/overlay/interfaces/WindowRaiseOptions` and `/api/overlay/interfaces/DockFocusPanelOptions`. In public JSDoc, describe private members (`raise`, `takeFocus`, `contentAround`, `codeChangeMayFocus`) in prose only.

- **[`docs/layouts/Tab.md`](../packages/lib/docs/layouts/Tab.md)**, *Selecting a tab* ([:117](../packages/lib/docs/layouts/Tab.md#L117)): after the keyboard paragraph, add a short "Keyboard focus" paragraph with the policy. A gesture on the strip moves focus onto the new tab. A change made from code (`setActiveTabIndex`, `setActiveContent`, `closeTab`, a `Dock` action) moves focus onto a tab only when the strip already holds focus, nothing does, or focus is inside the content the change hides or removes. Pass `{ focus: true }` or `{ focus: false }` to `setActiveTabIndex` / `setActiveContent` to decide per call. Include the first eight rows of the policy table from `## Architecture Decisions`. Leave the existing sentences alone.
- **[`docs/components/TabBar.md`](../packages/lib/docs/components/TabBar.md)**, methods table: the `setActiveEntry(id)` row ([:57](../packages/lib/docs/components/TabBar.md#L57)) becomes `setActiveEntry(id, options?)`, "Select from code — emits `"tabpressed"`. Moves focus onto the cell only when the strip holds focus or nothing does; `{ focus }` overrides." The `removeBarEntry(id)` row ([:55](../packages/lib/docs/components/TabBar.md#L55)) becomes `removeBarEntry(id, options?)` with "Moves focus to a surviving cell only when the removed cell held it; `{ focus }` overrides." appended.
- **[`docs/concepts/accessibility.md`](../packages/lib/docs/concepts/accessibility.md)**, *Keyboard navigation: RovingTabIndex* ([:70–74](../packages/lib/docs/concepts/accessibility.md#L70)): item 3 becomes "Calls `focus()` on the new active item's DOM element, unless called with `{ focus: false }`." Add one sentence after the list: "`remove` takes the same option for the item it activates when it removes the active one. A group that changes from code — the [`Tab`](/layouts/Tab#selecting-a-tab) strip — uses it to move the tab stop without taking focus from elsewhere."
- **[`docs/components/Dock.md`](../packages/lib/docs/components/Dock.md)**
  - *Programmatic control*, the `focusPanel(id)` bullet ([:165](../packages/lib/docs/components/Dock.md#L165)): becomes **`focusPanel(id, options?)`**. Add: by default the panel's tab takes focus only when focus would otherwise be lost or already sits in that strip, and its float takes focus when the window's `autoFocus` is on. Pass `{ focus: false }` to activate and raise without moving focus, for selection driven from a file tree or a results list. Link [`DockFocusPanelOptions`](/api/overlay/interfaces/DockFocusPanelOptions).
  - Add one line to the code sample after the `focusPanel('search')` block: `dock.focusPanel('preview', { focus: false }); // the file tree keeps focus`.
  - Add a sentence to the `removePanel(id)` bullet: "Focus moves to the neighbouring tab only when the closed tab or its content held it."
  - *Gestures* table, the tear-off row ([:72](../packages/lib/docs/components/Dock.md#L72)): "The float takes keyboard focus. A float rebuilt by a layout restore takes none when the restore shows it, and after that answers raises the same way."
  - *Gestures* table, the spring-load row: append "without moving keyboard focus".
- **[`docs/components/Window.md`](../packages/lib/docs/components/Window.md)**, *Focus*: in the `autoFocus` table ([:136](../packages/lib/docs/components/Window.md#L136)) leave the rows as they are. Below the paragraph after the table, add a short paragraph with a three-row table for `bringToFront({ focus })`: omitted → `autoFocus` decides; `false` → raises and activates without moving focus; `true` → takes focus also with `autoFocus: false`. Link [`WindowRaiseOptions`](/api/overlay/interfaces/WindowRaiseOptions).
- **[`docs/components/AbstractWindow.md`](../packages/lib/docs/components/AbstractWindow.md)**, *Active focus* row ([:16](../packages/lib/docs/components/AbstractWindow.md#L16)): after "(`autoFocus`, default `true`)" add "— a `bringToFront({ focus })` call's own `focus` value overrides it".
- **[`docs/layouts/LayoutSerialization.md`](../packages/lib/docs/layouts/LayoutSerialization.md)**, step 5 ([:65](../packages/lib/docs/layouts/LayoutSerialization.md#L65)): replace the `autoFocus` sentence with: "A floating window rebuilt here takes no focus when the restore shows it, so a restore never takes focus from what the user is working in. After that it answers raises like a float torn off a tab strip (`autoFocus` on)."
- **[`docs/reference/migration/next.md`](../packages/lib/docs/reference/migration/next.md)** — the page holds only its intro today. Add one section in the shape of the 0.11.0 page's first section:
  - Heading: `## A tab change made from code no longer takes keyboard focus`.
  - **What changed and why.** Selecting or closing a tab from code focused a tab button, taking focus from whatever held it — a file tree being arrowed through lost focus on every selection that opened or switched a `Dock` panel. A change made from code now moves only the tab stop. Focus still moves onto a tab when the strip already holds focus, when nothing holds focus, or when focus was inside the tab content being hidden or closed. Gestures on the strip are unchanged.
  - A table with three columns (*Call* / *Before* / *Now*). Rows: `tab.setActiveTabIndex(i)`, `tab.setActiveContent(c)`, `dock.focusPanel(id)` (tiled panel), `dock.addPanel(spec)`, each with focus in another control — before "focus moves to the tab button", now "focus stays"; `tab.closeTab(c)` / `dock.removePanel(id)` of the active tab with focus in another control — before "focus moves to the neighbouring tab button", now "focus stays".
  - **Who needs to act.** Code that relied on a switch from code landing focus on the tab strip, such as a keyboard shortcut that switches tabs and expects the strip to be focused. Pass `{ focus: true }`:

    ```typescript
    // Before
    tab.setActiveTabIndex(2);                    // focus moved to the tab button

    // After — keep that landing
    tab.setActiveTabIndex(2, { focus: true });
    ```
- **[`docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md)** — the page holds only its intro today. Add headings in the shape of [`0.11.0.md`](../packages/lib/docs/reference/changelog/0.11.0.md) (`## Breaking changes` / `## Added` / `## Changed` / `## Fixed`, each with `### <area>`):
  - `## Breaking changes` → `### Layouts`: **A tab change made from code no longer takes keyboard focus.** One sentence each for the switch rule and the close rule, as in the migration note, then link [Migration](/reference/migration/next#a-tab-change-made-from-code-no-longer-takes-keyboard-focus).
  - `## Added` → `### Overlay`: **`Dock.focusPanel(id, { focus: false })` activates a panel and raises its float without moving keyboard focus**, for selection driven from a tree or list. **`bringToFront({ focus })`** on `Window` / `TabWindow`: `false` raises without focus, `true` takes focus also with `autoFocus: false`, omitted follows `autoFocus`. Link both component pages.
  - `## Added` → `### Layouts`: **`Tab.setActiveTabIndex` and `Tab.setActiveContent` take `{ focus }`** to override the strip's focus rule per call. Same entry, one sentence: `TabBar.setActiveEntry`, `TabBar.removeBarEntry`, `RovingTabIndex.moveTo` and `RovingTabIndex.remove` take the same option.
  - `## Changed` → `### Layouts`: **A float rebuilt by `restoreLayout` ends with `autoFocus` on.** The restore's own show still takes no focus. Later raises now match a float torn off a tab strip, so `Dock.focusPanel(id)` and a drop into the float move focus into it again; this reverses the last sentence of the 0.11.0 entry. Pass `{ focus: false }` to `focusPanel` to keep focus where it is.
  - `## Fixed` → `### Layouts`: **The spring-loaded raise during a tab drag no longer moves keyboard focus** into the window it raises (`DockRegion`, and a `Tab` strip in a window). Since 0.11.0 it did, which left focus in a window the drag only passed over. Second bullet: **`FocusReveal` opening a hidden tab no longer focuses the tab button** before it focuses its target.
- **`llms.txt`** — no change; the capability index lists components, and no component is added.

---

## Potential Challenges

- **`onTabPressed` is also the click and arrow-key handler.** Mitigation: the new parameter defaults to `true`, and neither the click listener ([:1942](../packages/lib/src/typescript/lib/component/container/TabBar.ts#L1942)) nor the arrow-key handler passes a second argument.
- **Hidden focused content under `focus: false`.** Switching away from a tab whose content holds focus hides that content, and the browser drops focus to `<body>`. The default rescues it (condition 3); an explicit `false` does not. Mitigation: `Tab.setActiveTabIndex`'s JSDoc and the `DockFocusPanelOptions` text say `false` never moves focus; the caller who passes it owns the result.
- **A deferred activation evaluates the policy late.** `setActiveContent` on a cell that does not exist yet applies the policy on the next layout pass. Mitigation: that is the moment focus would move, so it is the correct moment; T4 pins the outside-focus case.
- **A queued show-time focus running late in Dock tests.** `Window.show()` queues its focus move on a layout callback that `captureRaf` holds until `flush()`. Mitigation: `flush()` before placing focus in every Dock case.
- **`docs:api` link warnings.** `{@link Dock.focusPanel}` and `{@link AbstractWindow.bringToFront}` resolve only inside their own module. Mitigation: each interface's JSDoc lives in the same file as its method; elsewhere use the module-qualified form from CODE_CONVENTIONS.md, or prose.
- **`_focusOnActivation` must be put back.** Mitigation: the option goes through the existing `raise`, which restores the flag in `finally`; W1/W2 assert it.

---

## Critical Files

- [`component/container/TabBar.ts`](../packages/lib/src/typescript/lib/component/container/TabBar.ts#L1724) — `entryIndexForElement`, `moveRovingOffCloseButton` (:1749), `restoreFocusAfterClose` (:1791), `activateEdgeEntry` (:1844), `removeBarEntry` (:2018), `setActiveEntry` (:2110), `openTabMenu` (:2168), `onTabPressed` (:2261), `onToolbarKeyDown` (:3529).
- [`layout/Tab.ts`](../packages/lib/src/typescript/lib/layout/Tab.ts#L2398) — `setActiveTabIndex` and its stray JSDoc, `setActiveContent` (:2417), `contentAround` (:2373), `revealDescendant` (:2344), `closeEntry` (:1179), the `doLayout` pending block (:2084), `removeEntryKeepingContent` (:2491), `_onBarDockHover` (:1520), `_onBarDockRequested` (:1492), `detachTabToWindow` (:2531).
- [`core/RovingTabIndex.ts`](../packages/lib/src/typescript/lib/core/RovingTabIndex.ts#L98) — `remove`, `moveTo` (:131).
- [`overlay/Menu.ts`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1610) — `returnFocusToInvoker` and the `<body>`-means-nothing check at :1537: the precedent for the strip's policy.
- [`component/editor/CodeEditor.ts`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L138) — `CodeEditorRevealOptions.focus` and `revealRange`: the precedent for a per-call `focus` option.
- [`overlay/AbstractWindow.ts`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L958) — `bringToFront` (:966), `raise` (:983), `onActivate`, `takeFocus` (:1053), `show` (:820), `setAutoFocus` (:2358).
- [`overlay/Dock.ts`](../packages/lib/src/typescript/lib/overlay/Dock.ts#L1979) — `focusPanel`, `addPanel` (:508), `removePanel` (:2024), `floatForFrame` (:2208), `onPanelFocused` (:1682), `onFloatActivated`.
- [`layout/DockRegion.ts`](../packages/lib/src/typescript/lib/layout/DockRegion.ts#L153) — `raiseHostWindow`, `scheduleSpringRaise`, the `onDrop` raise.
- [`layout/LayoutSerialization.ts`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L652) — `applyWindow`.
- [`plans/implemented/window-focus-on-show.md`](implemented/window-focus-on-show.md) — the 0.11.0 plan; its footnotes `restore-layout` and `return`, and its Implementation Notes, are the history behind four decisions here.
- [`tests/overlay/AbstractWindow.focus.test.ts`](../packages/lib/tests/overlay/AbstractWindow.focus.test.ts), [`tests/overlay/Dock.lifecycle.test.ts`](../packages/lib/tests/overlay/Dock.lifecycle.test.ts), [`tests/component/container/TabBar.contextMenu.test.ts`](../packages/lib/tests/component/container/TabBar.contextMenu.test.ts) — the helpers the new cases reuse.

---

## Non-Goals

- **`ToolBar` and `ButtonGroup`.** Both use `RovingTabIndex`, whose default is unchanged. Removing a member of either from code can still move focus through `remove`. They are not tab strips and are not on Loom's path.
- **Focusing the panel's content.** `focusPanel` never focused the panel's own controls and still does not; the application does that, as Loom already does for a permanent open.
- **Loom's own change.** Passing `{ focus: false }` from Loom's `'temporary'` opens belongs to Loom's repository. Without it, the strip's policy already keeps focus in the tree for a tiled panel. The option is still needed for a panel in a float, whose raise follows `autoFocus`.
- **A `focus` option on `Tab.closeTab` / `Dock.removePanel` / `Dock.addPanel`.** No caller needs to override the policy there.[^no-close-option]
- **A minimized float.** `bringToFront()` on an active minimized float still focuses it; the 0.11.0 plan already recorded this as out of scope.
- **A Dock-level option for the windows it hosts.**[^dock-level-option]

---

## Notes

[^tab-button-focus]: Checked with a throwaway vitest probe against `180751e98` under the modelled test DOM; the probe was deleted. Setup: a dock with tiled panels `a` and `b` (`b` active) and a focused outside button. `dock.focusPanel('a')` moved focus to `a`'s tab button. `focusPanel` on the already-active tab moved nothing, because `RovingTabIndex.moveTo` returns early for a repeat activation. `dock.addPanel(c)` moved nothing at once. `focusPanel('c')` straight after returned `false`, because the tab cell does not exist until the next layout. The next `doLayout()` then moved focus to `c`'s tab button through the deferred `setActiveContent`. `removePanel` on the active tab also moved focus off the outside button. In a browser the tab button is connected and visible, so the same `focus()` calls succeed there.

[^policy-precedent]: Three existing sites share the same rule. `Menu.returnFocusToInvoker` returns focus "only when it is still inside this menu's chain", so it never pulls focus back from something the user moved to. `AbstractWindow` returns focus on close only when focus is still inside the window, the HTML rule for a non-modal `<dialog>`, adopted in 0.11.0 (that plan's footnote `return`). `TabBar.restoreFocusAfterClose` moves focus only when the removed cell held it. `Menu` also treats an active element of `<body>` as "nothing focused" ([:1537](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1537)), which condition 2 reuses. The ARIA tabs pattern moves focus between tabs only on keyboard interaction within the tablist, and says nothing for changes made from code. A tab button taking focus from a tree, an editor or a search field serves none of the cases the pattern describes.
    The two "rescue" conditions keep today's landing where the old behaviour helped a keyboard user. Condition 2: after a drag whose source button was disposed, or at startup, focus has nowhere to be, and the new tab is a sensible landing. Condition 3: `Ctrl+W`-style code that closes the tab the user is typing in, or a switch away from it, would otherwise drop focus to `<body>`.

[^corrected-default]: An opt-in (`{ focus: false }` on every call) was rejected. It leaves `Dock.addPanel`'s deferred activation, a close from code, and every `TabPanel` consumer stealing focus until each call site is changed, and it needs options on methods whose callers cannot know what holds focus at the time the move happens (the deferred activation runs inside a later layout pass). The policy fixes all of them at once and keeps every gesture's behaviour. What it changes for consumers is listed in the migration note: a switch or close from code while focus sits in another control no longer moves focus to the strip.
    The per-call option remains for three callers. `Dock.focusPanel({ focus: false })` promises no focus move even when nothing is focused. `Tab.revealDescendant` passes `false` because its caller focuses the target right after. `Tab` passes `true` down to `TabBar` when it sees condition 3, which `TabBar` cannot see.

[^layering]: Putting the policy inside `RovingTabIndex` ("focus only when the group holds focus") was considered. It would change `ToolBar` and `ButtonGroup` too, and it cannot express condition 3, because the group knows its items, not the content they control. It would also break `TabBar.restoreFocusAfterClose`: by the time `remove` runs, the focused cell has already left the group, so "the group holds focus" would read false and focus would fall to `<body>`. `TabBar` already owns the comparable decisions (`heldFocus`, `restoreFocusAfterClose`, `focusActiveEdgeEntry`), so the policy sits beside them.

[^not-reveal-panel]: A separate `revealPanel(id)` was considered and rejected. In this library `reveal…` means "make visible without changing state or emitting events" — `DiagramView.revealNode` says so in its JSDoc, and `Panel.revealRect` / `ScrollStrip.revealItem` only scroll. A no-focus `focusPanel` still activates the tab and emits the dock's `"focus"` event, which Loom relies on to update its title and status bar, so `revealPanel` would break that naming. The one existing method that both reveals and may focus, `CodeEditor.revealRange`, uses a `focus` flag on an options bag — the shape chosen here. Keeping one method also keeps the dedup idiom in `Dock.md` (`if (dock.focusPanel(id)) return;`) working for both uses. The Dock's "focus" (the dock-wide active panel, its `"focus"` event) is separate from keyboard focus; the option controls only keyboard focus.

[^window-option]: The Dock could instead wrap the call: `setAutoFocus(false); bringToFront(); setAutoFocus(previous)`. That writes window state to express a per-call intent, needs a `try/finally` to be safe against a throwing `"activate"` listener, and leaves a consumer with the same need no public route. `AbstractWindow` already has the private `raise(takeFocus)` that `show()` uses for a raise without focus; the option exposes that choice at the public method instead of adding a second public method. `bringToFront` has no overrides (`Window`, `TabWindow`, `DiagnosticsOverlay` and `StyleAuditOverlay` inherit it), so widening the signature touches no subclass.

[^option-types]: `RovingTabIndex`'s constructor takes an inline `{ preventScroll?: boolean }`. The tab-strip methods are lower-level building blocks, and a named interface each would add several exported types for one boolean. `Dock.focusPanel` and `AbstractWindow.bringToFront` are what applications call. `CodeEditorRevealOptions` shows the library names the option type for such methods, which also gives TypeDoc a page to link from the component docs. A two-state option (defaulting to `true` and always forcing) was rejected: `focusPanel(id)` on a float built with `autoFocus: false` — a consumer's own `Window` adopted by the Dock — would change from "no focus" to "focus". Passing the omitted value through keeps the default each component already has.

[^restore-default]: Making both kinds of float `autoFocus: false` instead was rejected. A torn-off float has `autoFocus: true` today, so a consumer's own `bringToFront()` on it would silently stop focusing — a breaking change for every consumer. It would also make library floats disagree with the library default (`autoFocus: true`, chosen in 0.11.0 so accessible behaviour does not depend on applications opting in). Ending restored floats at `true` changes only the restored floats, which have existed with `false` for one release. `show()` reads `autoFocus` when it runs and queues its focus move only then, and `setWindowState` raises nothing, so `setAutoFocus(true)` as `applyWindow`'s last statement moves no focus. A new `show({ focus: false })` option would say the same thing, but it adds API that only this one caller needs.

[^restore-history]: Commit `9758d8c1b` ("Make a shown window take keyboard focus unless built with autoFocus false") added `autoFocus: false` to `applyWindow`. The plan behind it, [`plans/implemented/window-focus-on-show.md`](implemented/window-focus-on-show.md), gives the reason in its footnote `restore-layout`: a restore shows several windows from code, typically at startup, with no gesture on any of them. The same footnote noted that `Dock.focusPanel()` would then not focus a restored float, assumed the application would focus the panel's control itself, and said: "If that proves wrong in use, the fix is for the `Dock` to set `autoFocus` back to `true` on a float once the restore has finished." Loom's report is that case. The fix is placed in `applyWindow` rather than in `Dock`, because `restoreLayout` also rebuilds floats for a plain `TabPanel` that has no `Dock`.

[^tear-off-focus]: The user releasing a dragged tab over empty space has asked for a new window, so focus follows them there, as the 0.11.0 plan's manual case MV7 ("the new window has focus") intended. Building the tear-off window with `autoFocus: false` and focusing it once at tear-off was considered, so that later raises would not focus it. That is the "both `false`" option rejected in `[^restore-default]`. The later raises the user does not ask for — the spring-loaded raise and a `focusPanel` from a tree — now say so per call instead.

[^spring-raise]: `DragManager` drives a drag with viewport `mousemove` / `mouseup` listeners only and has no keyboard handling, so focus has no role in completing a drag. Moving focus mid-drag has costs: the window's remembered return point is overwritten, a `blur` fires on whatever held focus (a cell editor commits on blur), `FocusHistory` records a stop, and when the drop lands elsewhere or snaps back, focus is left in a window the drag only passed over. The 0.11.0 implementation notes recorded this as an unreviewed side effect: "The drag-dwell raises (`DockRegion`, `Tab`) now add `FocusHistory` stops; the owner may want pointer raises to skip focus later." The drop raise is different. The drop puts content into that window at the end of the user's gesture, the same reasoning as the tear-off, so it keeps following the window's `autoFocus`. A spring raise without focus still activates the window (title-bar highlight, the dock's `"focus"` event), as the raise did before 0.11.0.

[^no-close-option]: Under the policy a close from code moves focus only to rescue it from the closed tab, which is what every caller wants. `addPanel`'s activation follows the same policy as any switch from code. Loom needs no override on either. Adding options there would widen three public signatures for no current caller, against the project's "no speculative configurability" rule. `TabBar.removeBarEntry` does get the option, because `Tab.closeEntry` has to pass condition 3 down to it.

[^dock-level-option]: A `DockOptions` field such as `floatAutoFocus` was considered. The Dock creates none of these windows: `Tab.detachTabToWindow` and `restoreLayout` do, and both serve `TabPanel` too. A Dock-level option would have to reach into `Tab`'s tear-off and adopt bare windows a consumer built. The per-call option covers the actual need, which is a raise from a tree or list, and `setAutoFocus` on the window from the dock's `"attach"` event remains for an application that wants different floats.

---

## Implementation Notes

### Deviations and choices where the plan was silent

- **Changelog heading order.** The plan named the 0.11.0 shape as `## Breaking changes` / `## Added` / `## Changed` / `## Fixed`. The released pages (`0.11.0.md`, `0.10.0.md`) actually use Breaking changes → Changed → Added → Fixed, and `next.md` already held a `## Changed` (Tree row motion) followed by a `## Added` (CodeEditor.openSearch) from the two branches this one is stacked on. The new entries follow the released order: Breaking changes at the top, Changed → Layouts after the existing Changed → Components, Added → Layouts / Overlay after the existing Added → Components, Fixed at the end. The plan also said `next.md` "holds only its intro today"; it did not, because of the stack. The migration `next.md` did hold only its intro.
- **`TabBar.setActiveEntry` JSDoc.** The plan's text was merged with the existing summary instead of replacing it, so the list of what the selection syncs (pressed state, roving stop, indicator intent, `"tabpressed"`) stays.
- **`Tab.doLayout` pending block.** It reads `_pendingActiveFocus` into a local and clears both pending fields before calling `setActiveTabIndex`, rather than clearing after the call. The effect is the same; clearing first matches how `_pendingActiveContent` was already cleared before the call.
- **Inline comment in `setActiveTabIndex`.** "roving focus" became "roving tab stop", since the strip no longer always focuses.
- **L1** relies on its describe block's `afterEach(vi.restoreAllMocks)` for the `afterNextLayout` spy.
- **No demo change.** The plan's file table lists none, so none was added (worker step 7).
- **A close made on the strip ends with focus on the active tab (deviation, reworked after audit).** The plan said a removal moves focus to a surviving tab only when the closed cell or its content held it, and the ✕ was expected to hold it. Safari and Firefox do not focus a button on click, so a ✕ close of the active tab left focus nowhere. A first fix moved focus after every strip close as if the closed tab had held it, onto the tab taking its place. An auditor showed that this left focus and the tab stop on an unselected tab after a background close, after which a strip close of the active tab split two ways: `TabBar.removeBarEntry` focused the right neighbour (`restoreFocusAfterClose`, since the stop was not on the closed cell) while `Tab.selectNextContent` selected the left one. Repro: a, b, c, d with c active and focus outside; strip-close a, then c: b is active, focus and the stop are on d. The user decided that every strip close (✕, `Delete`, the menu's *Close* and its bulk closes) ends with focus and the roving stop on the active tab: the tab that becomes active when the active tab closed, the tab that stays active otherwise, also when a target vetoes `beforetabclose`. `closeEntry(id, fromStrip?: true)` now passes `{ focus: false }` to `removeBarEntry`, so the removal does not rescue onto a neighbour first (with the default rescue, T18 saw three focus writes before the one on the active tab), and after `selectNextContent` calls the new public `TabBar.focusActiveEntry()`. It moves the stop with `RovingTabIndex.moveTo` and focuses the button itself when `moveTo` returns early because the stop is already there; the private `Home` / `End` helper `focusActiveEdgeEntry` now reuses it. `setActiveTabIndex` and `setActiveEntry` were rejected as the seam because they emit `"tabpressed"`, which would announce an already-active tab again through `"select"` / `"activate"`. A strip close that empties the strip moves no focus, as before: focus that was on the closed tab or in its content goes with it. A close from code (`closeTab`, `Dock.removePanel`) keeps the plan's rule. T11–T18 pin it (T16 is the repro, T17 the veto, T18 the single focus write), and each failed on the previous code. `Tab.md`, the Breaking changelog entry and the migration table state it; the changelog gained an Added entry for `focusActiveEntry`.

### Observations, not acted on

- **`Tab.dockComponent` passes `{ focus: true }` (fixed in audit, T10).** The plan's caller list missed it, and its tab switch fell under the code-change rule. That rule leaves focus where it is at a drop: `DragManager.onMouseUp` runs the target strip's `onDrop` (and so `dockComponent`) before `endSession` runs the source strip's `onDragEnd`, which removes the dragged button, so the button is still in its strip and still focused when `TabBar.codeChangeMayFocus` runs, and the audit's probe showed focus landing on the source strip's surviving tab instead of the dropped one. A drop is the user's gesture, so the docked tab now takes focus as a click on the strip would. One case differs from before this branch: when the dragged tab was its source strip's active tab, the source strip used to move focus to its own neighbour after the drop (`_onBarDetached` → `removeEntryKeepingContent` → `RovingTabIndex.remove`); now the removed cell no longer holds focus at that point, so focus stays on the dropped tab. T10 drops a tab onto a second in-document strip while its source button holds focus. T9 (added alongside) covers an explicit `focus` option on a deferred `setActiveContent`, which no case exercised. The `TabBar.setActiveEntry` / `removeBarEntry` default change, which the plan's migration spec left out, is now in the migration table and the Breaking changelog entry, which states `TabBar`'s strip-only form of the rule separately. TB7 (added in audit round 2) removes the active closeable cell from code while an outside control holds focus: the stop's detour through the neighbour's ✕ must not move focus, a path no planned case reached.
- In the browser, hovering a dragged tab over the *body* of a strip-mode `TabWindow` float did not spring-raise it, before or after the hover (the strip's own `dockhover` raise did). This branch does not change that path; it is noted only because MV2 had to aim at the float's strip.

### Verification

- Step 2 red/green split matched the plan exactly: RT1, RT4, TB1, TB5, T1, T3, T4, T6, T7, W1–W3, D1–D3, D5, D6, DP1, S1, S2, L1 failed before the change; RT2, RT3, RT5, TB2–TB4, TB6, T2, T5, T8, W4, W5, D4, TO1, S3 passed.
- From `packages/lib`: `npm run typecheck`, `npm run typecheck:test` and `npm run lint` are clean. `npx vitest run`: 639 files, 28 062 tests pass (2 todo), after the audit's T9, T10 and TB7. `npm run docs:api` finishes with zero warnings. `npm run docs:llms:check` passes (108 catalogued, 121 excluded, 0 unaccounted).
- The three `grep` checks in `## Verification` give the expected single matches, and both gesture callers of `setActiveEntry` pass `{ focus: true }`.
- `packages/docs` tests (including `links.test.ts`): 13 files, 2 617 tests pass. They need the branch's own built library: `@jimka/typescript-ui` resolves through its `dist`, which a worktree lacks, so they ran after `npm run build:lib` with `packages/docs/node_modules/@jimka/typescript-ui` linked to `../../../lib` (both gitignored).

### Manual checks (own Vite server on port 8027, worktree `node_modules` symlinked, Chrome DevTools MCP)

- **MV1 — pass.** Dockable layout demo: tearing *Search* off with a real drag left `document.activeElement` on the new `TabWindow`.
- **MV2 — pass, partly synthetic.** The MCP drag tool cannot dwell, so the drag was driven with synthetic `mousedown` / `mousemove` / `mouseup` events (`DragManager` listens on viewport `mousemove` / `mouseup`). Focus sat in a page text field; the dock tab dwelled over the backgrounded float's strip for 1.4 s and the float rose (z-index 9002 → 9004) with focus still in the text field; after dropping back on its own strip, focus was still in the text field, not in the float. The `DockRegion` body path of the spring raise was not reached in the browser (see the observation above); S1 covers it offline.
- **The close rule in `Tab.md` and the migration prose was corrected (audit round 3).** Both said a close from code moves focus onto a tab when nothing holds focus, copying this plan's *Documentation Impact* text, which contradicts its own removal rule (a removal moves focus only when the closed cell or its content held it). The code follows the removal rule, which the user confirmed: a closed tab that held focus hands it to its neighbour. The pages now state the switch and close rules separately, the Tab.md table and the migration table gained the "nothing focused" close row, and the drop's changed landing (T10) has a Fixed changelog entry.
- **Drop onto a different strip — pass, real drag (added in audit).** In the Dock demo, with the Chrome DevTools drag tool (real pointer input), the inactive *Search* tab was dragged from the first tiled strip onto the *Editor* strip: it landed there as the active tab and held keyboard focus. MV2 had only dropped back onto the tab's own strip, so it never reached `dockComponent` on another strip.
- **MV3 — pass.** Tab demo page: a real click on *Beta*, then real `ArrowRight`, `End`, `Home`, `ArrowRight` + `Delete` keys, each left focus on the newly active tab's button (`Delete` closed *Beta* and focused *Alpha*). With focus in an outside text field, the context menu was opened with a synthetic `contextmenu` event, and a real click on *Switch to → Gamma* left focus on *Gamma*'s button.
- **MV4 — not run.** It needs Loom built against this branch in Loom's own repository, with Loom's `'temporary'` opens changed to `focusPanel(id, { focus: false })`; that is outside this worktree. D1–D6 and DP1 cover the same paths offline.
