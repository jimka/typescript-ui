---
depends-on: [markdown-viewer-floating-minimap-and-controls]
---

# Hide Inherited Members on API Reference Pages — Implementation Plan

## Overview

The docs app's API reference pages render TypeDoc-generated Markdown as-is, and TypeDoc inlines every inherited member alongside a class's own — [`FieldSet.md`](packages/lib/docs/api/component/container/classes/FieldSet.md) pulls in roughly 150 `Component` methods it never declares itself; `Button.md` is 7,169 lines, 71% of it inherited. This plan adds a floating toggle button, in the style of [`DiagramView`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts)'s own zoom/fit/reset cluster, that hides inherited members by default and lets a reader reveal them. All of it lives in `packages/docs` — the generated Markdown tree, the VitePress site, and the typedoc pipeline are untouched.

This plan depends on `markdown-viewer-floating-minimap-and-controls`, which introduces the `FloatingPanel` primitive and restructures `DocsShell`/`DocsContent` around a floating `MarkdownMinimap` — merged to `master` in `433897ea`. This plan's toggle button reuses that same structure as a second floating control.

---

## Architecture Decisions

### Filtering happens client-side, in the docs app only

`typedoc.json`'s `excludeInherited` was already rejected for this purpose in `plans/implemented/docs-typedoc-reference.md`'s Non-Goals: that config is shared with the live VitePress site, and a build flag can't be a per-user toggle. This plan instead filters the fetched Markdown text at render time, in `packages/docs/src/content/apiMarkdown.ts`.

### One pure filter function: `filterInheritedMembers`

Added to `apiMarkdown.ts` beside the existing `normalizeApiMarkdown`, same shape: a documented, pure string→string transform.

A generated class/interface page groups members under `## `-level headings (`## Methods`, `## Properties`, …); each member is its own `### ` heading; a member inherited from a base class carries a `#### Inherited from` sub-heading somewhere in its block, a member the class declares itself does not.[^page-structure]

The function drops a member's full line range — from its `### ` heading up to (not including) the next `### ` or the section's end — whenever that range contains a line that is exactly `#### Inherited from`. If a section had at least one member and every one of them was dropped, the now-empty `## ` heading is dropped too, so a fully-inherited class does not leave a dangling `## Methods` heading with nothing under it.[^empty-section-example] A section with no `### ` children at all (`## Extends`, `## Extended by`) is never a candidate for that cleanup. A source with no `#### Inherited from` line anywhere is returned unchanged.

### Preference storage: a plain module, no new abstraction

The docs app has no existing settings/preferences module. `packages/lib/docs/layouts/Split.md` and other component docs already document the project's convention for this: a component never persists its own state, the consuming app owns storage directly. This plan adds `packages/docs/src/content/apiPreferences.ts`, two functions wrapping `localStorage` under one key, matching that convention rather than inventing a settings abstraction.

### `DocsContent` tracks the unfiltered source and exposes two new members

`DocsContent` already tracks `_linkBaseDir: string | null`, non-null exactly while an API page is shown. This plan adds a same-shaped `_rawApiSource: string | null`, set alongside `_linkBaseDir` at every one of its five assignment sites in `showPath` — the API page's fetched-and-normalized source when non-null, so a preference toggle can re-filter without a network re-fetch.

`showSource`'s block-rendering body is extracted into a new `renderContent(source)`, called both by `showSource` (still followed by `applyFragment`) and by the new `setShowInheritedMembers` method. This split matters: `applyFragment("")` calls `setScrollTop(0)`, and running it on every toggle would snap a reader who has scrolled deep into a page back to the top every time they flip the toggle.[^scroll-preservation]

### The toggle is a floating `ToggleButton`, not a header checkbox

Originally planned as a checkbox in the global header; revised twice once `markdown-viewer-floating-minimap-and-controls`'s `FloatingPanel` came into view, landing on mirroring `DiagramView.buildControls`/`makeControlButton` exactly: a bare `FloatingPanel` (no background, shadow, or insets of its own — same as `DiagramView`'s `_controls`) holding one glyph-only button.[^placement-revision] The one difference from `DiagramView`'s buttons: "show inherited members" is persistent state, not a momentary action, so it uses `ToggleButton` instead of `Button`, exactly as `packages/docs/src/shell/DocsDemo.ts` and `packages/docs/src/demos/togglebutton-group.ts` already do elsewhere in this app.

It is a `DocsShell`-level sibling of `DocsContent` — added to the same `centre` Anchor container the base branch already builds for the minimap — not a child of `DocsContent` itself. That matters: `DocsContent.showBlocks` disposes and rebuilds all of `DocsContent`'s own children on every navigation, so a toggle button built and added there would risk its own `action` handler disposing the very component whose event is still executing, the moment a click re-renders the page. Living outside that cycle avoids the hazard entirely — the same reason the minimap is safe there today.

### The toggle shows only on API pages

Cheap to do correctly because the toggle is never rebuilt on navigation (previous decision). `DocsContent.isApiPage()` is a new getter (`return this._linkBaseDir !== null;`); `DocsShell`'s existing `onOutlineChange` handler — already the one hook that fires exactly once per page render, currently used to feed the minimap — calls `this._inheritedToggle.setVisible(this._content.isApiPage())` on every firing.

---

## Public API

```typescript
// packages/docs/src/content/apiMarkdown.ts — new export
export function filterInheritedMembers(source: string): string;
```

```typescript
// packages/docs/src/content/apiPreferences.ts — new file
export function loadShowInheritedMembers(): boolean;
export function saveShowInheritedMembers(value: boolean): void;
```

```typescript
// packages/docs/src/shell/DocsContent.ts — additions to the existing class
class DocsContent {
    // existing members unchanged, plus:
    isApiPage(): boolean;
    setShowInheritedMembers(value: boolean): void;
}
```

```typescript
// packages/docs/src/shell/DocsShell.ts — additions to the existing class
class DocsShell {
    // new private field:
    // private readonly _inheritedToggle: FloatingPanel;
}
```

---

## Implementation

### `apiPreferences.ts`

```typescript
const SHOW_INHERITED_KEY = 'ts-ui-docs-show-inherited-members';

export function loadShowInheritedMembers(): boolean {
    return localStorage.getItem(SHOW_INHERITED_KEY) === 'true';
}

export function saveShowInheritedMembers(value: boolean): void {
    localStorage.setItem(SHOW_INHERITED_KEY, String(value));
}
```

Absent or unparseable storage reads as `false` (hidden) — the agreed default.

### `DocsContent.ts`

```typescript
private renderApiSource(source: string): void {
    this._rawApiSource = source;
    this.showSource(loadShowInheritedMembers() ? source : filterInheritedMembers(source));
}

private renderContent(source: string): void {
    const blocks = splitBlocks(source);
    this.emitOutline(blocks);
    this.showBlocks(blocks);
}

private showSource(source: string): void {
    this.renderContent(source);
    this.applyFragment(this._targetFragment);
}

isApiPage(): boolean {
    return this._linkBaseDir !== null;
}

setShowInheritedMembers(value: boolean): void {
    saveShowInheritedMembers(value);

    if (this._rawApiSource === null) {
        return;
    }

    this.renderContent(value ? this._rawApiSource : filterInheritedMembers(this._rawApiSource));
}
```

`showPath`'s two API-page branches (the `cached` hit, and the resolved `fetchApiPage(...).then(...)`) call `this.renderApiSource(cached)` / `this.renderApiSource(source)` in place of their current direct `this.showSource(...)` calls. `showPath`'s other three branches (authored page, not-found, fetch-error) each gain `this._rawApiSource = null;` alongside their existing `this._linkBaseDir = null;` line.

`renderContent` already re-runs `emitOutline`, so the minimap's heading outline updates to match the filtered/unfiltered member list with no separate wiring.

### `DocsShell.ts`

```typescript
private buildInheritedToggle(): FloatingPanel {
    const panel = new FloatingPanel({ corner: 'bottom-right', visible: false, layoutManager: new Fit() });

    const toggle = ToggleButton('Show inherited members', {
        glyph: 'eye',
        showText: false,
        selected: loadShowInheritedMembers(),
        listeners: { action: () => this._content.setShowInheritedMembers(toggle.isSelected()) },
    });
    panel.addComponent(toggle);

    return panel;
}
```

In the constructor, alongside the existing minimap construction (after `this._content = new DocsContent(router)`, so the closure above always finds `this._content` assigned):

```typescript
this._inheritedToggle = this.buildInheritedToggle();
centre.addComponent(this._inheritedToggle, this._inheritedToggle.getAnchorConstraints());
```

`onOutlineChange` gains one line:

```typescript
private onOutlineChange(headings: MarkdownHeading[]): void {
    this._minimap.setHeadings(headings);
    this._inheritedToggle.setVisible(this._content.isApiPage());
    Component.afterNextLayout(this.handleContentSettled);
}
```

`ToggleButton`'s `"action"` listener is a `ClickListener` (`(event: MouseEvent) => …`), not the new value, so the handler reads it back via `toggle.isSelected()` — `toggle` referenced inside its own `const` initializer is safe because the closure only reads it when a later click fires, after the declaration completes.

Register the `eye` glyph alongside the existing `github`/`bug` registration:

```typescript
import { eye } from '@jimka/typescript-ui/glyphs/solid/eye';
// ...
Glyph.register(github, bug, eye);
```

---

## Ordered Implementation Steps

1. **`packages/docs/src/content/apiMarkdown.ts`** — add `filterInheritedMembers` per *Architecture Decisions*. Verify: the new function is exported; `grep -n "filterInheritedMembers" packages/docs/src/content/apiMarkdown.ts` shows the definition.
2. **`packages/docs/tests/apiMarkdown.test.ts`** — add `describe('filterInheritedMembers', …)` per *Expected Behaviour* below, written before step 1's implementation is trusted (red, then green).
3. **`packages/docs/src/content/apiPreferences.ts`** — new file, per *Implementation*.
4. **`packages/docs/src/shell/DocsContent.ts`** — add `_rawApiSource`, `renderApiSource`, `renderContent` (extracted from `showSource`), `isApiPage`, `setShowInheritedMembers`, per *Implementation*. Update the five `showPath` assignment sites. Import `filterInheritedMembers` from `../content/apiMarkdown.js` and `loadShowInheritedMembers`/`saveShowInheritedMembers` from `../content/apiPreferences.js`.
5. **`packages/docs/tests/DocsContent.test.ts`** — add coverage per *Expected Behaviour*, written before step 4 is trusted. Extend the file's existing `vi.mock('../src/content/pages.js', …)` pattern with an equivalent mock of `../src/content/api.js` (`apiFileFor`, `fetchApiPage`) so an API-page fixture can be exercised.
6. **`packages/docs/src/shell/DocsShell.ts`** — add the `eye` glyph import/registration, `_inheritedToggle` field, `buildInheritedToggle`, its construction/wiring in the constructor, and the `onOutlineChange` addition, per *Implementation*. Import `FloatingPanel` from `@jimka/typescript-ui/component/container`, `ToggleButton` from `@jimka/typescript-ui/component/button`, `Fit` from `@jimka/typescript-ui/layout`, `loadShowInheritedMembers` from `../content/apiPreferences.js`.
7. Typecheck `packages/docs`. `grep -rn "filterInheritedMembers\|isApiPage\|setShowInheritedMembers" packages/docs/src` shows every call site from steps 4 and 6.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/docs/src/content/apiMarkdown.ts` |
| Modify | `packages/docs/tests/apiMarkdown.test.ts` |
| Create | `packages/docs/src/content/apiPreferences.ts` |
| Modify | `packages/docs/src/shell/DocsContent.ts` |
| Modify | `packages/docs/tests/DocsContent.test.ts` |
| Modify | `packages/docs/src/shell/DocsShell.ts` |

---

## Expected Behaviour

`filterInheritedMembers` (unit-testable, `apiMarkdown.test.ts`):

| Input | Output |
|---|---|
| No `#### Inherited from` anywhere | Returned byte-identical |
| A section with a mix of own and inherited members | Only the inherited members removed; section heading and own members survive |
| A section where every member is inherited | The whole section (heading + members) removed |
| Multiple sections, each with inherited members | Each filtered independently |
| A member block with nested `#### Parameters`/`##### paramName` content, ending in `#### Inherited from` | The entire block removed, not just from the marker down |
| The literal text "Inherited from" in prose, not as an exact `#### Inherited from` heading line | Left alone |

`DocsContent` (unit-testable, `DocsContent.test.ts`, extending its existing mock pattern with an API-page fixture):
- `isApiPage()` is `false` before any page is shown and while an authored/not-found/fetch-error page is shown; `true` while an API page (cache hit or freshly fetched) is shown.
- `setShowInheritedMembers(false)` on a shown API page removes that page's inherited members from the rendered blocks and the emitted `"outlinechange"` headings; `setShowInheritedMembers(true)` restores them, without a second fetch.
- `setShowInheritedMembers` on an authored page persists the preference (`localStorage` reads back the new value) but does not touch the rendered content.

Manual verification only (scroll/visual behaviour the test harness can't exercise — see `plans/implemented/markdown-viewer-floating-minimap-and-controls.md`'s own precedent for this same limitation):
- The floating toggle appears bottom-right only on API pages, doesn't collide with the minimap (top-right) or the status bar.
- Toggling it preserves scroll position rather than jumping to the top.
- The minimap's heading outline updates to match the filtered/unfiltered list.

---

## Verification

1. `npm test` in `packages/docs` — new and existing tests green.
2. Typecheck `packages/docs`.
3. `npm run docs:dev` from the worktree; visit a heavily-inherited page (`component/container` → `FieldSet`, or `component/button` → `Button`) and walk the manual cases in *Expected Behaviour*. Reload the page and confirm the last-set preference persists.

---

## Critical Files

- [`packages/docs/src/content/apiMarkdown.ts`](packages/docs/src/content/apiMarkdown.ts) — `normalizeApiMarkdown` is the pattern `filterInheritedMembers` follows.
- [`packages/docs/src/shell/DocsContent.ts`](packages/docs/src/shell/DocsContent.ts) — `showPath`, `showSource`, `emitOutline`.
- [`packages/docs/src/shell/DocsShell.ts`](packages/docs/src/shell/DocsShell.ts) — `centre` construction, `onOutlineChange`, as restructured by `markdown-viewer-floating-minimap-and-controls`.
- [`packages/lib/src/typescript/lib/component/diagram/DiagramView.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) — `buildControls`/`makeControlButton`, the precedent this plan's toggle button mirrors.
- [`packages/docs/src/shell/DocsDemo.ts`](packages/docs/src/shell/DocsDemo.ts) — existing `ToggleButton` usage in this app.
- `plans/implemented/markdown-viewer-floating-minimap-and-controls.md` — `FloatingPanel`/`MarkdownMinimap` design this plan builds on.

---

## Non-Goals

- Changing `typedoc.json`'s `excludeInherited` — shared with the live VitePress site; already rejected in `plans/implemented/docs-typedoc-reference.md`.
- A settings panel or any other persisted preference beyond this one boolean.

---

## Implementation Notes

**Manual verification (the plan's three harness-can't-exercise cases) was run, not skipped.** `npm run build:lib` and `npm run docs:api` produced a fresh `dist/` and generated API tree, a worktree-local `node_modules/@jimka/typescript-ui` symlink was pointed at this worktree's `packages/lib` (the default resolution otherwise walks up to the main tree's `node_modules`, serving unfixed code), and the docs app plus the library's own demo app were served on spare ports and driven via `mcp__chrome-devtools__*` against `FieldSet.md` (a heavily-inherited page):

- **Corner placement / no collision.** Screenshotted and DOM-measured bottom-right, `visibility: hidden` (not shown) on an authored page (`/guide/installation`), `visibility: visible` on an API page, sitting above the status bar with a visible gap and not overlapping the top-right minimap.
- **Scroll preservation.** Scrolled the pane to `scrollTop: 800`, clicked the toggle to reveal ~150 inherited members (`scrollHeight` grew from 4120 to 105982), confirmed `scrollTop` stayed at `800` (no jump to top).
- **Minimap outline sync.** The "On this page" tree went from 6 entries (own members only) to 199 (inherited members included) on the same click, matching the rendered content.
- Also checked: `localStorage` persistence across a real page reload (toggled on, reloaded, toggle read back `pressed` with inherited members already shown; toggled off, back to 7 headings).

No regression found in any of the three cases the plan named.

**Three deviations surfaced by live user testing after the above passed**, all folded into the branch's single code commit per the coordinator's direction (same functionality, not a follow-up):

1. **Toggle visually lagged 1-2s after clicking.** `ToggleButton.onAction` flips the `.selected` class synchronously, before firing the `"change"` event this toggle's `action` listener runs on — so the listener's own `DocsContent.setShowInheritedMembers` call (a full `splitBlocks` + `showBlocks` rebuild, expensive on a 7000-line page) ran in the same task as the click, starving the browser of a paint for the class flip until the rebuild finished. A first attempt deferred the call through a single `DOM.sink.requestAnimationFrame` — but per spec, a frame's animation-frame callbacks run *before* that frame's own style/layout/paint, so a callback registered that way still runs and paints together, in the same frame; the class flip's paint stayed blocked behind the rebuild exactly as before. Fixed instead with a *nested* deferral — `DocsShell.deferInheritedMembersRender` schedules the rebuild inside a `requestAnimationFrame` callback registered from *within* another `requestAnimationFrame` callback — so the (trivial) outer callback's frame paints normally, showing the flip, before the (expensive) inner callback's frame begins the rebuild. This exact shape has a precedent in this codebase: `Animation.materialize` (`packages/lib/src/typescript/lib/core/Animation.ts:604-605`) nests two `DOM.sink.requestAnimationFrame` calls for the identical reason its own `@remarks` states — "a single rAF still races layout … the same two-rAF dance `play()` performs for entrance transitions" (the `play()` side is `Animation.ts:201-202`). (A bare *single*-shot `DOM.sink.requestAnimationFrame` deferral, for the unrelated need of reading next-frame state rather than sequencing around a paint, has two precedents: `Dock.scheduleFocusRecompute` and `Dock.scheduleSweep`.) Verified live: instrumenting `window.requestAnimationFrame` to timestamp each of the two nested callbacks measured a **16.7ms gap** between the outer (trivial) and inner (heavy) callback firing — exactly one frame interval at this display's 60Hz refresh rate — confirming a real frame boundary, and therefore a genuine render/paint opportunity, falls between them rather than both running back-to-back within the same frame.

2. **Toggle clamped to the pane's raw corner instead of hugging the text column** like the minimap does via `MarkdownMinimap.placeNextTo`. That method used only `FloatingPanel`-level state (`getParentComponent`, `getInnerSize`, `getContentInsets`, `getWidth`, `getMargin`, `getAnchorConstraints`, `setX`) — nothing `MarkdownMinimap`-specific — so it was promoted verbatim onto `FloatingPanel` itself (`packages/lib/src/typescript/lib/component/container/FloatingPanel.ts`), along with its `TEXT_COLUMN_GAP_PX` constant; `MarkdownMinimap` now inherits it (its own copy, and the now-unused `DOM` import, were removed). `DocsShell.rehugMinimap` was renamed `rehugFloatingPanels` and now calls `placeNextTo` on both the minimap and the toggle. `FloatingPanel.placeNextTo`'s existing 5-case test suite was ported from `MarkdownMinimap.test.ts` onto `FloatingPanel.test.ts` (a bare `FloatingPanel`, not a `MarkdownMinimap` subclass) since it's now a second independent consumer of the mechanic; `MarkdownMinimap.test.ts`'s own suite was left in place and continues to pass unchanged (pure move, no behaviour change — verified by the full `packages/lib` suite, 4039/4039 green both before commit and after).

3. **Button rendered far wider than `DiagramView`'s own control buttons** (185×29 vs. the target 38×28) despite identical `{ glyph, showText: false }` construction. Root cause, found by comparing rendered DOM: `ToggleButton`'s constructor forwards only its positional `text` to `super(text, undefined, subclassDefaults)` (no options), so `Button`'s own constructor renders the *full* title before `showText` has been recorded anywhere (defaulting to shown); `ToggleButton`'s tail `applyOptions(options)` call then writes `_options.showText = false` as a pure flag with no accompanying `options.text` key (text was positional) to trigger `Button`'s existing `setText`-dispatch resync — so nothing ever re-blanked `_text`, and the stale full-width title rode along into the row `setGlyph` rebuilt. This is the same "subclass that forwards only `text` to super and hands its bag to a tail `applyOptions`" trap the file's own comments already document for `glyph`/`description` (and the sibling bug the `ToggleButton glyph option (regression)` test already guards) — just not extended to `showText`, which has no setter of its own to dispatch. Fixed with one additional branch in `Button.applyOptions` (`packages/lib/src/typescript/lib/component/button/Button.ts`): when `showText` changes without an accompanying `text` in the same call and the content row is already built, re-dispatch through `setShowText` (which blanks/restores `_text` from the current `_options.text` and rebuilds the row). Pinned by a new regression test in `ToggleButton.test.ts` reproducing the exact positional-text + `{ glyph, showText: false }` construction; verified with the full `packages/lib` suite (4039/4039 green) and live — the rendered button now measures 38×28, byte-for-byte the same as `DiagramView`'s own control buttons.

Deviations 2 and 3 change `packages/lib`'s shipped behaviour (a new public `FloatingPanel.placeNextTo` method; a rendering fix affecting every existing `ToggleButton`/`TabButton` built with `showText: false`), so both gained an entry in `packages/lib/docs/reference/changelog/next.md`, matching the convention recent `packages/lib` commits (`339c124d`, `ea2eaeda`, others) already follow for consumer-visible changes.

---

## Notes

[^page-structure]: Confirmed by inspecting `packages/lib/docs/api/component/container/classes/FieldSet.md`: `## Methods` at line 54, `### addComponent()` at line 56, `#### Inherited from` at line 101, repeating for every member.

[^empty-section-example]: `FieldSet` itself is close to this case: its `addComponent`, `addComponents`, and most other `### ` entries under `## Methods` all carry `#### Inherited from` — a thin wrapper class can end up with nothing of its own left in a section once inherited members are stripped.

[^scroll-preservation]: `DocsContent.applyFragment("")` (the common case — most navigations carry no URL fragment) calls `this.setScrollTop(0)`. `showSource`'s existing callers all want that on a real navigation. `setShowInheritedMembers` fires from a click on an already-shown page and must not re-trigger it, or every toggle click would scroll the reader back to the top of a long API page.

[^placement-revision]: First planned as a header checkbox (simplest, but before `FloatingPanel` existed in this codebase, and it would have needed either restructuring `DocsContent`'s scroll layout to pin a toolbar above its content, or rebuilding the checkbox every navigation — risking the checkbox's own handler disposing itself mid-event). Once `markdown-viewer-floating-minimap-and-controls`'s `FloatingPanel` and floating `MarkdownMinimap` were taken into account, revised to a styled floating card with a text-labelled `Checkbox` mirroring `MarkdownMinimap`'s card chrome. Revised again, per explicit direction, to mirror `DiagramView`'s bare (unstyled) floating control-button cluster instead, using `ToggleButton` rather than `Checkbox`.
