---
depends-on: [directional-panel-navigation]
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/DOM.ts
  - packages/lib/src/typescript/lib/core/index.ts
  - packages/lib/src/typescript/lib/overlay/Dialog.ts
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/CodeEditor.ts
  - packages/lib/src/typescript/lib/component/table/Table.ts
  - packages/lib/tests/dom/TestDOM.ts
  - packages/lib/tests/component/default-options-fallback.test.ts
  - packages/lib/docs/concepts/accessibility.md
---

# Framework Focus Traversal — Implementation Plan

> **STATUS: DEFERRED. Do not implement this yet.**
>
> Nothing in the library or the demo app currently needs it. The browser's own
> Tab traversal is correct for almost every screen this framework renders today,
> because the library uses real focusable elements and writes real `tabindex`
> values through [`Aria.setTabIndex`](packages/lib/src/typescript/lib/core/Aria.ts#L139).
> Building a framework Tab handler now would add a global keyboard interceptor,
> a new arbitration rule, and a new DOM seam read in exchange for behaviour the
> platform already provides.
>
> This plan exists so the design is not re-derived from scratch when a real need
> appears. Read [`## When To Pick This Up`](#when-to-pick-this-up) first — if none
> of the triggers there has actually happened, close the plan.

## Overview

This plan describes a framework-level keyboard traversal service: an opt-in
module that intercepts `Tab` / `Shift+Tab`, computes the ordered set of tab
stops inside a traversal root, skips ineligible ones, and moves focus. It lives
in a new `packages/lib/src/typescript/lib/core/FocusTraversal.ts`, exported from
[`core/index.ts`](packages/lib/src/typescript/lib/core/index.ts#L43) beside
`FocusHistory` and `RovingTabIndex`.

The library's Tab handling today is narrower than it looks, but it is not limited
to one place. `Dialog` traps Tab inside itself
([`Dialog.onKeyDown`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1121))
using a shared focusable selector, now
[`core/Focusable.ts`](packages/lib/src/typescript/lib/core/Focusable.ts) (moved
there by [`plans/directional-panel-navigation.md`](plans/directional-panel-navigation.md),
which this plan depends on). `Table` also owns Tab while focus is inside it:
[`Body.onKeyDown`](packages/lib/src/typescript/lib/component/table/Body.ts#L2807)
navigates to the next/previous cell, and
[`Cell.onKeyDown`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L595)
does the same from an open cell editor. Everything else — `ToolBar`, `TabBar`,
`ButtonGroup`, `Tree`, `MenuBar` — handles arrow keys only and leaves Tab to the
browser.

The hard part is not walking the tab order. It is **arbitration**: more than one
component legitimately owns the Tab key while focus is inside it. `MarkdownEditor`
hosts Lexical, whose table plugin registers a `KEY_TAB_COMMAND` handler that moves the
caret cell-to-cell (`node_modules/@lexical/table/src/LexicalTableSelectionHelpers.ts`,
`applyTableHandlers`, line 787). `CodeEditor` hosts CodeMirror, where Tab is an
indent gesture. `Table` is framework-authored but wants the same subtree-wide claim.
A traversal service that swallows Tab unconditionally breaks all three.
[`## Architecture Decisions`](#architecture-decisions) centres on how a component
claims the key and how focus eventually leaves it.

**This plan does not fix any current bug.** The idea surfaced while debugging a
`MarkdownEditor` WYSIWYG table where Tab left the editor instead of advancing to
the next cell. Grepping `core/` established the library has no *framework-level*
Tab handler, which ruled out a missing framework service as the culprit — it did
not make building one the cure. That bug is an editor/Lexical integration problem
and is tracked separately.

---

## When To Pick This Up

Implement this only when at least one of the following is concretely true. Each
is a situation the browser's native traversal genuinely cannot handle.

- **A documented accessibility requirement lands** — a customer, audit, or
  compliance target that names WCAG 2.1 SC 2.4.3 ("Focus Order") and cites a
  screen in this framework where the native order is wrong.
- **A keyboard-only navigation demand** — a user or app that must be operable
  with no pointer at all, and reports a specific screen where Tab strands focus
  or visits controls in an order that does not match the visual layout.
- **A container whose visual order deliberately diverges from its DOM order**
  ships and cannot be fixed by re-ordering children. `Border` regions and
  `ToolBar` overflow are the plausible candidates: the app assigns children in
  region-assignment order, and the layout manager paints them somewhere else.
  Reordering the children is the cheap fix and should be tried first.
- **A composite widget needs managed tab stops that `RovingTabIndex` cannot
  express** — a widget where "one stop for the whole group" is wrong, e.g. a
  grid that must expose a cell-level tab order distinct from its row order.
- **The `Dialog` focus trap gains a second implementer** — a second overlay
  (a non-modal panel, a docked tool window) needs the same trap, at which point
  the shared service pays for itself instead of a copy of `onKeyDown`.

If the trigger is only "it would be nice to own Tab", stop. The cost is a global
`keydown` interceptor plus a permanent obligation to arbitrate with every
third-party editor the library ever embeds, and with `Table`.

---

## Architecture Decisions

### The service is a module-level namespace singleton, mirroring `FocusHistory`

`FocusTraversal` is a `namespace` over module-private state in
`core/FocusTraversal.ts`, with `enable()` / `disable()` / `isEnabled()` and a
sentinel `Component` owning its viewport listeners. It is not a `Component`
mixin and not a `LayoutManager` concern.[^singleton]

Precedent: [`core/FocusHistory.ts`](packages/lib/src/typescript/lib/core/FocusHistory.ts#L234)
— the same shape (namespace, `_owner` sentinel `Component` at line 65,
`Event.addViewportListener(_owner, "keydown", …)` at line 260, opt-in `enable()`,
state as module-private `let` bindings).

### A component claims the Tab key with a data-attribute marker, read by an ancestor walk

`Component` gets a typed `setTabKeyOwner(value: boolean)` / `isTabKeyOwner()` pair
backed by a `tabKeyOwner?: boolean` field on `ComponentOptions`. The setter mirrors
the flag onto the element as `data-ts-ui-tab-key-owner` via the existing
[`Component.setDataAttribute`](packages/lib/src/typescript/lib/core/Component.ts#L2055).
On `Tab`, the service walks from the focused element up through
`DOM.source.getParentNode` and stops at the first ancestor carrying the marker.
If it finds one, the service does nothing at all — no `preventDefault`, no focus
move — and Lexical, CodeMirror, or `Table`'s own handlers receive the key exactly
as they do today.[^marker]

`MarkdownEditor`, `CodeEditor`, and `Table` set the flag in their own constructors.
No consumer action is required for those three.

### The marker shape is the inverse of `directional-panel-navigation.md`'s `claimsKey` guard, for a real reason

[`plans/directional-panel-navigation.md`](plans/directional-panel-navigation.md)'s
ten arrow-key owners each call `PanelNavigation.claimsKey(e)` at the top of their
own handler — an active, per-keystroke check made by the exact component whose
listener is about to fire. This plan's Tab owners do the opposite: they mark
themselves once, and the service discovers the marker by walking up from wherever
focus currently sits.

The shapes differ because the two problems differ. `directional-panel-navigation.md`'s
owners decide, on each arrow keystroke, whether *this specific handler* should
act — a local, momentary question the handler is always in a position to ask.
This plan's owners want something more persistent: "while focus is anywhere
inside me, Tab is mine," for as long as that holds, regardless of which
descendant element currently has focus. `MarkdownEditor` and `CodeEditor` need
the marker for an additional, harder reason: they wrap third-party editors
(Lexical, CodeMirror) whose own internal keydown handling cannot be edited to
call a framework guard function, so ownership has to be discoverable from the
outside, passively. `Table` is framework-authored and *could* call an active
guard — but it wants the same subtree-wide, persistent claim the other two
owners want (Tab is `Table`'s whenever focus is inside it, cell or editor, not
just at the instant one specific handler runs), so it uses the same marker
rather than adding a second arbitration shape for one case.
`directional-panel-navigation.md`'s `## Critical Files` lists this plan as one it
must not collide with; this section is the resolution — the two shapes are
deliberately different, not an accidental inconsistency.

### Escape releases the claim for exactly one Tab press

A Tab-owning component would otherwise be a focus trap with no keyboard exit. The
service keeps a one-shot *release flag*: pressing `Escape` while focus is inside a
Tab owner sets it; the next `Tab` ignores the owner's claim and moves focus to the
first tab stop after the owner's own element; anything else clears it.[^escape]

| Key pressed | Focus inside a Tab owner? | Release flag before | Service behaviour | Flag after |
|---|---|---|---|---|
| `Tab` | no | — | moves focus, calls `preventDefault()` | unset |
| `Tab` | yes | unset | does nothing — the owner keeps the key | unset |
| `Escape` | yes | unset | does nothing except set the flag (no `preventDefault`) | **set** |
| `Tab` | yes | set | moves focus to the first stop **after** the owner's element | unset |
| `Shift+Tab` | yes | set | moves focus to the last stop **before** the owner's element | unset |
| `ArrowDown` | yes | set | does nothing | unset |
| any | — | set, focus moved elsewhere | flag cleared on `focusin` | unset |

### Tab order is DOM order; there is no explicit order option

The service collects candidates via `findFocusable(root)` (from `core/Focusable.ts`),
which resolves to `DOM.source.querySelectorAll(root, FOCUSABLE_SELECTOR)` under the
hood and returns document order; the service traverses that array, filtered further
by `isRenderedVisible`. No `tabOrder` option is added, and geometry is never
read.[^dom-order]

DOM order equals component-tree order here — `addComponent` appends — but neither
necessarily equals *visual* order, because layout managers place children by
constraint, not by sequence. A container whose visual order must differ from its
child order is responsible for adding its children in the order it wants traversed.
Worked case:

| App code | DOM / tree order | Painted order (Border) | Tab order |
|---|---|---|---|
| `add(center); add(north); add(south)` | center, north, south | north, center, south | center, north, south |
| `add(north); add(center); add(south)` | north, center, south | north, center, south | north, center, south |

The second row is the fix for the first — reorder the `addComponent` calls, do not
add an ordering option.

### Eligibility reuses `core/Focusable.ts`, plus a new `isRenderedVisible` filter layered on top

`FOCUSABLE_SELECTOR` is not re-introduced here.
[`plans/directional-panel-navigation.md`](plans/directional-panel-navigation.md)
already ships it as an internal
[`core/Focusable.ts`](packages/lib/src/typescript/lib/core/Focusable.ts) (selector +
`disabled` filter, deliberately **not** exported from `core/index.ts`) — and, being
unimplemented and deferred, this plan yields to the sibling that will exist
first.[^focusable-yield] `core/FocusTraversal.ts` imports `FOCUSABLE_SELECTOR` and
`findFocusable` from there and applies one more filter on top —
`!isRenderedVisible` — rather than broadening `core/Focusable.ts` itself.

| Candidate | Eligible | Why |
|---|---|---|
| visible enabled `<button>` | yes | matches the selector |
| `<button disabled>` | no | `disabled` filter (in `core/Focusable.ts`) |
| `tabindex="-1"` element | no | excluded by the selector |
| `RovingTabIndex` non-active item (`tabindex="-1"`) | no | the group is a single stop |
| `RovingTabIndex` active item (`tabindex="0"`) | yes | the group's one stop |
| element under a `visibility: hidden` ancestor (inactive `Tab` content) | no | `isRenderedVisible` is false (this plan's own filter) |
| element under a `display: none` ancestor | no | `isRenderedVisible` is false (this plan's own filter) |

The roving rows are the reason this plan adds no roving machinery: `RovingTabIndex`
already leaves exactly one `tabindex="0"` per group, so the selector produces
"one stop per composite widget" with no extra work.

### The traversal root is the topmost dismissable layer, else `<body>`

`FocusTraversal` asks [`LayerManager.getTopLayer()`](packages/lib/src/typescript/lib/core/LayerManager.ts#L331)
for the current top layer and uses that layer's element as the root when one
exists; otherwise `DOM.source.getBody()`. Traversal wraps at the ends of the root
only when the root is a modal layer; on `<body>` it stops at the ends and lets the
browser move focus to the browser chrome.[^root]

### Focus moves with `preventScroll: true`, and reveal is a separate concern

Every focus move goes through `DOM.sink.focus(handle, { preventScroll: true })`.
Native `focus()` scrolls `overflow: hidden` ancestors and corrupts the framework's
custom scroll models — the same reason `RovingTabIndex` takes a `preventScroll`
option ([`RovingTabIndex`](packages/lib/src/typescript/lib/core/RovingTabIndex.ts#L29))
and `TabBar` passes `true`
([`TabBar`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L496)).
Bringing an off-screen tab stop into view would be
[`plans/focus-reveal-on-navigation.md`](plans/focus-reveal-on-navigation.md)'s
`FocusReveal` broker's job, if this plan ever needed it — it does not: nothing here
calls `FocusReveal`, and this is a "would be nice" observation, not a dependency.

### Scope is keyboard traversal only

This plan owns Tab, Shift+Tab, and which elements are tab stops. It does not own
focus rings ([`component/input/focusRing.ts`](packages/lib/src/typescript/lib/component/input/focusRing.ts)),
ARIA attributes ([`core/Aria.ts`](packages/lib/src/typescript/lib/core/Aria.ts)),
or screen-reader semantics. Those already have owners, and
[`docs/concepts/accessibility.md`](packages/lib/docs/concepts/accessibility.md)
already documents both. That page gains a traversal section; nothing in it is
rewritten.

---

## Public API

New module `packages/lib/src/typescript/lib/core/FocusTraversal.ts`:

```typescript
/** Options for {@link FocusTraversal.enable} / {@link FocusTraversal.configure}. */
export interface FocusTraversalOptions {
    /** Wrap from the last stop to the first at the ends of the root. Default: only inside a modal layer. */
    wrap?: boolean;
}

export namespace FocusTraversal {
    export function enable(options?: FocusTraversalOptions): void;
    export function disable(): void;
    export function isEnabled(): boolean;
    export function configure(options: FocusTraversalOptions): void;

    /** The ordered, eligible tab stops inside `root` (defaults to the current traversal root). */
    export function getTabStops(root?: Handle): Handle[];

    /** Moves focus to the next / previous stop. Returns true if focus moved. */
    export function next(): boolean;
    export function previous(): boolean;
}
```

`FOCUSABLE_SELECTOR` is **not** re-exported here — it stays a single, internal
definition in `core/Focusable.ts` (see *Eligibility reuses `core/Focusable.ts`*).

Added to `Component` ([`core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts)):

```typescript
// ComponentOptions
tabKeyOwner?: boolean;

// Component
setTabKeyOwner(value: boolean): this;   // caches in this._options.tabKeyOwner;
                                        // mirrors data-ts-ui-tab-key-owner via setDataAttribute
isTabKeyOwner(): boolean;               // this._options.tabKeyOwner ?? this._defaultOptions.tabKeyOwner ?? false
```

Added to `DOMSource` ([`core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts#L1153)):

```typescript
/** Whether the element is actually rendered — false under a `display: none` or `visibility: hidden` ancestor. */
isRenderedVisible(handle: Handle): boolean;
```

---

## Ordered Implementation Steps

Coarse by design — this plan will be stale in its details by the time it is
picked up. Each step is a self-contained, independently verifiable slice.

1. **Add the visibility seam read.** Implement `isRenderedVisible` on the
   `DOMSource` interface, on `ProductionDOMSource` in
   [`core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts), and on the
   offline source in [`tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts).
   Verify: a unit test in `tests/dom/` asserting an element under a
   `display: none` ancestor reports false.

2. **Add the Tab-owner flag to `Component`.** `tabKeyOwner` on `ComponentOptions`,
   `setTabKeyOwner` / `isTabKeyOwner`, dispatched from `applyOptions`, plus a row
   in [`tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts)
   as ARCHITECTURE.md requires for any defaulted field. Verify: constructing with
   `{ tabKeyOwner: true }` renders `data-ts-ui-tab-key-owner="true"`.

3. **Create `core/FocusTraversal.ts` with the pure parts only** — import
   `FOCUSABLE_SELECTOR` and `findFocusable` from `core/Focusable.ts` (do **not**
   redefine or re-export the selector; see *Eligibility reuses `core/Focusable.ts`*),
   implement `getTabStops` (the imported candidates filtered by the new
   `isRenderedVisible`), `next`, `previous`, and the root resolution. No listeners
   yet. Export `FocusTraversal` from
   [`core/index.ts`](packages/lib/src/typescript/lib/core/index.ts). Verify: unit
   tests over `getTabStops` covering every row of the eligibility table.

4. **Confirm `Dialog` needs no change.** `Dialog` already imports
   `FOCUSABLE_SELECTOR` from `core/Focusable.ts`, added by
   [`plans/directional-panel-navigation.md`](plans/directional-panel-navigation.md)'s
   own step 2. This plan does not touch `overlay/Dialog.ts`. Verify:
   `grep -rn "FOCUSABLE_SELECTOR" packages/lib/src/` — exactly one definition,
   still in `core/Focusable.ts`.

5. **Wire the keydown handler.** `enable()` / `disable()` register and remove a
   viewport `keydown` listener plus a `focusin` listener (for clearing the release
   flag), following `FocusHistory.enable` line for line. Implement the arbitration
   table: owner lookup by ancestor walk, the Escape release flag, and the
   focus move with `preventScroll: true`. Verify: unit tests driving synthetic
   keydown events through the offline DOM for every row of the arbitration table.

6. **Mark `MarkdownEditor`, `CodeEditor`, and `Table` as Tab owners.**
   `setTabKeyOwner(true)` in the constructors of
   [`component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts),
   [`component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts),
   and [`component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts) —
   `Table` needs it too, since its own Tab handling
   ([`Body.onKeyDown`](packages/lib/src/typescript/lib/component/table/Body.ts#L2807),
   [`Cell.onKeyDown`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L595))
   operates on ordinary tab-stop elements the traversal service would otherwise
   also try to walk. Verify manually in the demo app: with traversal enabled, Tab
   inside a code editor still indents, Tab inside a table still moves cell-to-cell,
   and Escape-then-Tab leaves each of the three.

7. **Audit composite widgets for the one-stop rule.** Confirm `Tree`
   ([`Tree.ts`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L164) already
   sets `tabIndex(0)` on the tree root), `Table`'s body, `MenuBar`, `ToolBar`,
   `TabBar`, and `ButtonGroup` each expose exactly one `tabindex >= 0` element.
   This step adds a test, not a fix: a widget exposing more than one stop is a bug
   in that widget and gets its own plan rather than being patched here.
   Verify: a test that renders each widget and asserts `getTabStops` returns
   exactly one handle inside it.

8. **Document.** Add the traversal section to
   [`docs/concepts/accessibility.md`](packages/lib/docs/concepts/accessibility.md).
   No `llms.txt` change — see *Documentation Impact*.
   Verify: `npm run docs:api` — zero warnings; `npm run build:docs` — clean.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/FocusTraversal.ts` |
| Create | `packages/lib/tests/core/FocusTraversal.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` — add `isRenderedVisible` to `DOMSource` + `ProductionDOMSource` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` — `tabKeyOwner` option, `setTabKeyOwner` / `isTabKeyOwner` |
| Modify | `packages/lib/src/typescript/lib/core/index.ts` — export `FocusTraversal` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — `setTabKeyOwner(true)` |
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — `setTabKeyOwner(true)` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` — `setTabKeyOwner(true)` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` — offline `isRenderedVisible` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` — `tabKeyOwner` row |
| Modify | `packages/lib/docs/concepts/accessibility.md` — traversal section |

`overlay/Dialog.ts` is read but not modified (see step 4) — listed in this plan's
`touches-shared` frontmatter for coordination, not in this table.

---

## Expected Behaviour

Unit-testable against the offline DOM source — including the `disabled` filter,
since `hasAttribute` is genuinely modelled (not the hardcoded always-`false` stub it
started as) by [`directional-panel-navigation.md`](plans/directional-panel-navigation.md)'s
own `TestDOM.ts` step, which this plan inherits:

- `getTabStops` returns document order for a flat container of three buttons.
- `getTabStops` omits a `<button disabled>`.
- `getTabStops` omits an element with `tabindex="-1"`.
- `getTabStops` returns exactly one handle for a `ToolBar` of five buttons wired
  through `RovingTabIndex`.
- `getTabStops` omits everything under a `display: none` ancestor.
- `getTabStops` omits everything under a `visibility: hidden` ancestor — the
  inactive-`Tab`-content case.
- With no layer registered, the root is `<body>`; with a modal layer registered,
  the root is that layer's element and stops outside it are excluded.
- `next()` from the last stop returns `false` on a `<body>` root and wraps to the
  first stop on a modal root.
- Every row of the arbitration table in
  [`## Architecture Decisions`](#architecture-decisions), driven by synthetic
  `keydown` events: Tab outside an owner moves focus and calls `preventDefault`;
  Tab inside an owner does neither; Escape inside an owner sets the release flag
  without calling `preventDefault`; the next Tab then moves focus past the owner's
  element; any other key clears the flag.
- `disable()` leaves a subsequent Tab entirely unhandled.
- `isTabKeyOwner()` returns `false` on a bare `Component` and `true` after
  `setTabKeyOwner(true)` or construction with `{ tabKeyOwner: true }`.

Manual verification only — the offline harness cannot exercise real focus, real
editors, or the browser's own traversal:

- Tab inside a `CodeEditor` still indents; Escape then Tab leaves the editor and
  lands on the next control.
- Tab inside a `MarkdownEditor` WYSIWYG table still advances cell-to-cell.
- Tab inside a `Table` in edit mode still moves cell-to-cell, via `Table`'s own
  handling, not the traversal service's.
- A `Dialog` still traps Tab at both ends.
- Tabbing across a scrolling `Panel` does not jump the panel's scroll offset
  (the `preventScroll: true` guarantee).
- Tabbing into a `ToolBar` lands on its active item; arrow keys then move within
  it; Tab leaves the whole bar.

---

## Verification

- `npm run typecheck` and `npm run lint` — the `local/no-raw-dom` rule must stay
  clean, which it will only if every focus and `activeElement` access in the new
  module goes through `DOM.sink` / `DOM.source`.
- `npm test` — the new `tests/core/FocusTraversal.test.ts` plus the existing
  `tests/core/RovingTabIndex.test.ts` and the dialog tests.
- `grep -rn "FOCUSABLE_SELECTOR" packages/lib/src/` — exactly one definition, in
  `core/Focusable.ts` — this plan must not add a second.
- `grep -rn "activeElement\|\.focus(" packages/lib/src/typescript/lib/core/FocusTraversal.ts` —
  every hit is a `DOM.source` / `DOM.sink` call.
- `npm run docs:api` — zero warnings. `npm run build:docs` — clean.
- Manual smoke test in the demo app (`npm run dev`, http://localhost:8015): the
  editor demo panel, a table panel, a dialog, and the toolbar/tab demo panels, with
  `FocusTraversal.enable()` added to `packages/lib/src/typescript/main.ts`
  temporarily beside the existing `FocusHistory.enable()` call at line 45.

---

## Documentation Impact

- `FocusTraversal` is exported from
  [`core/index.ts`](packages/lib/src/typescript/lib/core/index.ts), so TypeDoc
  renders it under the `Core` category. Give the namespace and each exported
  function a `@category Core` JSDoc block, as `FocusHistory` does.
- [`docs/concepts/accessibility.md`](packages/lib/docs/concepts/accessibility.md)
  gains a "Tab traversal" section after "Keyboard navigation: RovingTabIndex",
  covering `enable()`, the Tab-owner flag, and the Escape release. Its
  **Testing** section's keyboard-only bullet should reference the new service.
- No `llms.txt` change: `FocusTraversal` is a `namespace`, not a concrete class, so
  the coverage manifest (`scripts/llms/manifest.data.mjs`, checked by
  `check-coverage.mjs`) needs no entry — the same reasoning
  `focus-reveal-on-navigation.md` and `directional-panel-navigation.md` use for
  their own namespace exports. The two new `Component` methods need no entry
  either: `Component` is already in `manifest.data.mjs`'s `excludedSymbols` list as
  a framework primitive, and the manifest catalogues classes, not per-method
  surfaces.
- Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), public JSDoc may not `{@link}`
  private or non-exported symbols — describe the ancestor walk in prose rather
  than naming the internal helper, and do not link `core/Focusable.ts`.
- No sidebar entry is needed: the concepts sidebar already lists Accessibility
  ([`packages/docs/src/content/pages.ts:155`](packages/docs/src/content/pages.ts#L155)).

---

## Potential Challenges

- **A subtree `keydown` listener fires on every matching ancestor.** The service
  uses `Event.addViewportListener`, not `addSubtreeListener`, so this does not
  bite — but any future per-component variant would need a consume-once marker.
- **The service cannot resolve an element back to its `Component`.** No
  element→`Component` map exists, and
  [`plans/focus-reveal-on-navigation.md`](plans/focus-reveal-on-navigation.md)
  and [`plans/directional-panel-navigation.md`](plans/directional-panel-navigation.md)
  both deliberately avoid adding one. Every check the service performs must
  therefore be expressible as a DOM read — which is why the Tab-owner flag is an
  attribute and eligibility is a selector plus predicates.
- **`Escape` is already owned by `LayerManager`**, which closes the topmost
  non-modal layer on it. The release flag must be set without calling
  `preventDefault`, so an Escape inside an editor in a dialog still closes the
  dialog. Check `LayerManager.getTopLayer()` before assuming the key is free.
- **A third editor arrives later.** Anything embedding a third-party editing
  surface must call `setTabKeyOwner(true)`, or traversal will steal its Tab.
  Note the obligation in the `MarkdownEditor` / `CodeEditor` class JSDoc so the
  next such component copies it.
- **`isRenderedVisible` costs a style read per candidate.** Compute tab stops
  lazily inside the Tab handler, never on a timer or per layout pass.
- **`Ctrl+Shift`+arrow is already spoken for.** By the time this plan is picked
  up, [`plans/directional-panel-navigation.md`](plans/directional-panel-navigation.md)'s
  `PanelNavigation` service will very likely already own `Ctrl+Shift`+arrow for
  pane navigation — do not propose that chord for anything here.
  [`core/Focusable.ts`](packages/lib/src/typescript/lib/core/Focusable.ts) will
  also already exist as the shared, internal focusable-eligibility helper this
  plan builds on (see *Eligibility reuses `core/Focusable.ts`*) — re-read it
  before implementing step 3, since its exact shape may have moved on since this
  plan was last drafted.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/FocusHistory.ts`](packages/lib/src/typescript/lib/core/FocusHistory.ts) —
  **the precedent.** Namespace singleton, `_owner` sentinel, viewport listeners,
  opt-in `enable()`, `LayerManager` deference. Copy this shape.
- [`packages/lib/src/typescript/lib/core/Focusable.ts`](packages/lib/src/typescript/lib/core/Focusable.ts) —
  **the shared eligibility helper this plan builds on, not duplicates.** Owned by
  `directional-panel-navigation.md`; read it before writing step 3.
- [`packages/lib/src/typescript/lib/core/RovingTabIndex.ts`](packages/lib/src/typescript/lib/core/RovingTabIndex.ts) —
  the existing composite-widget focus manager; this plan reuses it rather than
  replacing it.
- [`packages/lib/src/typescript/lib/overlay/Dialog.ts`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1121) —
  the only existing whole-surface Tab trap; `onKeyDown` (line 1121).
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts#L2807) —
  `Table`'s own Tab handling while `Body` holds focus; the reason `Table` is a
  third Tab owner (see step 6).
- [`packages/lib/src/typescript/lib/component/table/cell/Cell.ts`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L595) —
  `Table`'s Tab handling from an open cell editor; the other half of the reason
  above.
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) —
  the seam every focus and `activeElement` access must route through.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) —
  `isEffectivelyVisible` (line 2266), `isDisplayed` (line 2236), `setDataAttribute`
  (line 2055), `focus(preventScroll)` (line 5209).
- [`packages/lib/src/typescript/lib/component/menubar/ToolBar.ts`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L537) —
  auto-registers focusable children into a `RovingTabIndex`; the model for the
  step-7 audit.
- [`plans/directional-panel-navigation.md`](plans/directional-panel-navigation.md) —
  the hard dependency; supplies `core/Focusable.ts`'s shared selector, and owns
  `Ctrl+Shift`+arrow (a different key, but read its `## Critical Files` entry for
  this plan to keep the cross-reference current).
- [ARCHITECTURE.md](ARCHITECTURE.md) — DOM seam rule, typed-setter rule,
  options-bag-as-cache rule.

---

## Non-Goals

- **Fixing the `MarkdownEditor` table-Tab bug.** That is an editor/Lexical
  integration issue, tracked separately. This plan explicitly yields Tab to the
  editor rather than intervening in it.
- **An explicit `tabOrder` / `tabStop` option.** Tab order is DOM order; a
  container that wants a different order reorders its children. Adding a numeric
  order recreates the positive-`tabindex` mess the platform learned to avoid.
- **Replacing `Dialog`'s focus trap.** This plan shares `core/Focusable.ts`'s
  selector with `Dialog` and nothing else; folding the trap into the service is a
  follow-on, gated on a second overlay needing it.
- **New roving-tabindex machinery.** `RovingTabIndex` already exists and already
  produces the one-stop-per-widget property this plan relies on.
- **Arrow-key navigation inside composite widgets.** `Tree`, `Table`, `MenuBar`,
  `ToolBar`, and `TabBar` keep owning their own arrow keys.
- **Focus rings, ARIA attributes, and screen-reader semantics.** Owned by
  `focusRing.ts` and `Aria.ts`.
- **Scrolling a focused stop into view.** A related but separate concern; see
  *Focus moves with `preventScroll: true`*.
- **Enabling traversal by default.** Nothing in the library calls `enable()`;
  the demo app calls it only during the manual smoke test.

---

## Notes

[^singleton]: Three shapes were weighed. A per-`Component` opt-in would need every
    component in the traversal path to participate, and the tab order is a
    document-wide property no single component can compute. A `LayoutManager`-level
    concern is wrong because tab order deliberately follows the tree, not the
    layout — putting it in the manager would invite exactly the geometry-derived
    ordering this plan rejects. The namespace singleton matches the two facilities
    that already solve document-wide keyboard concerns, `FocusHistory` and
    `LayerManager`, and it is the only one where `enable()` can make the whole
    feature inert by default.

[^marker]: The service has only a `Handle` for the focused element and no way to
    resolve it to a `Component` — `plans/focus-reveal-on-navigation.md` and
    `plans/directional-panel-navigation.md` both record that no element→`Component`
    map exists and that adding one is out of bounds. A DOM attribute is therefore
    the only claim channel that survives the seam. The same ancestor-walk
    technique is used in `focus-reveal-on-navigation.md` to detect a `<td>`/`<th>`
    ancestor, for the same reason: the seam offers no `closest`. Routing the flag
    through `setDataAttribute` rather than the low-level `setElementAttribute` also
    gets construction-time replay for free — `_attributes` is flushed onto the
    element at render (`Component.ts` line 5225), whereas `setElementAttribute` is
    write-through and would silently drop a value set before the element exists.

[^escape]: Escape-to-exit is the WAI-ARIA Authoring Practices convention for
    composite widgets that capture Tab, so it is what a keyboard user will try
    first. Two alternatives were rejected. A modifier chord (`Ctrl+Tab`) collides
    with browser tab switching and is not discoverable. Letting the owner
    programmatically release the claim puts the exit gesture in each editor's
    hands, which is precisely how the two editors would drift apart. The flag must
    be one-shot: a persistent release would leave the editor unable to reclaim Tab
    without a second gesture.

[^dom-order]: A geometry-derived order was considered and rejected. It would mean
    reading a rect for every candidate on every Tab press — expensive, and it
    fights the framework's own guidance against measuring during a hot path. It is
    also ill-defined for the absolutely-positioned children this framework
    produces: overlapping components, right-to-left arrangements, and floating
    overlays have no single correct reading order. An explicit `tabOrder` number
    was rejected separately: positive `tabindex` values are a documented
    accessibility anti-pattern because one wrong value reorders the entire
    document, and a framework-level equivalent inherits that failure mode.

[^focusable-yield]: Two shapes were considered for adding the missing
    `isRenderedVisible` check: broadening `core/Focusable.ts`'s shared helper with
    an optional visibility parameter, or leaving that module untouched and
    filtering on top in `FocusTraversal.ts`. The second was chosen because
    `core/Focusable.ts` is owned by `directional-panel-navigation.md`, which will
    already be implemented and shipping by the time this deferred plan is picked
    up; changing its contract from here risks breaking an invariant that plan's
    own tests already pin. Layering the extra filter costs one array `.filter()`
    call and keeps the dependency one-directional: this plan reads from
    `core/Focusable.ts` and never edits it.

[^root]: Scoping to the top layer reproduces what `Dialog` does today and is what
    `FocusHistory` already does when it suppresses its accelerator for a modal
    layer (`FocusHistory.ts` line 219). Wrapping only inside a modal is the
    difference between a trap and a traversal: a modal must not let focus escape
    to the page behind it, while on the page itself a user reaching the end of
    the document expects to land in the browser's address bar, not to be looped
    back.

---

## Implementation Notes

- **`core/Focusable.ts`'s `FOCUSABLE_SELECTOR` does not exclude a native
  `tabindex="-1"` element.** Step 7's composite-widget audit
  (`tests/core/FocusTraversalCompositeWidgets.test.ts`) found `Tree` and
  `Table`'s body genuinely reduce to one tab stop, but `MenuBar`, `ToolBar`,
  `ButtonGroup`, and a `Tab` layout's `TabBar` do not — each currently exposes
  one stop per `RovingTabIndex`-managed item, not one for the whole group.
  Root cause, confirmed against real rendered markup: the selector
  `'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'`
  is a comma-separated list of independent branches, and its
  `:not([tabindex="-1"])` guard binds only to the trailing `[tabindex]`
  branch. A native `<button>` (or `<a href>` / `<input>` / `<select>` /
  `<textarea>`) still matches its own branch regardless of `tabindex`, so
  `RovingTabIndex.add`'s `tabindex="-1"` on the inactive items never excludes
  them when the managed items render as one of those native tags — which
  `MenuBarButton`, `ToolBar`/`ButtonGroup`'s `Button`/`ToggleButton` items, and
  a `Tab` layout's `TabButton` items all do. This is a pre-existing gap in
  `core/Focusable.ts`, owned by `directional-panel-navigation.md`; per this
  plan's own Architecture Decisions this plan reads from that module and never
  edits it, so the gap is tracked via `it.todo(...)` rows (with the reasoning
  above repeated in-file) rather than patched here. It also means, beyond the
  audit itself, that `FocusTraversal.next()`/`previous()` currently visit each
  button of a `MenuBar`/`ToolBar`/`ButtonGroup`/`TabBar` individually rather
  than treating the group as one stop, on any real page that has one — a
  correctness gap in the *feature*, not only in its test coverage, worth
  fixing `FOCUSABLE_SELECTOR` for (e.g. wrapping the whole list in
  `:is(...):not([tabindex="-1"])`) before this service is enabled by default
  anywhere.

- **A resting `CodeEditor` exposes zero tab stops of its own, not one** —
  found during audit review and pinned by
  `tests/core/FocusTraversalCompositeWidgets.test.ts`'s "A Tab-key owner's own
  tab stop (CodeEditor)" block. CodeMirror's `.cm-content` is
  `contenteditable="true"` with no `tabindex` attribute; a real browser still
  tabs into it natively (`contenteditable` carries an implicit tabIndex of 0),
  but `FOCUSABLE_SELECTOR` has no `[contenteditable]` branch, so
  `findFocusable` never matches it. The search panel contributes nothing
  either, but not because `isRenderedVisible` filters it out — its
  find/replace rows are built lazily by `CodeEditorSearchPanel.buildControls()`,
  which only runs once the panel is actually opened, so a resting panel has
  zero child components and thus zero rendered elements for the selector to
  find in the first place. With `FocusTraversal` enabled, a plain `Tab` from
  outside a `CodeEditor` therefore skips over it entirely rather than landing
  inside it. Same class of gap as the `RovingTabIndex` one above — a
  pre-existing `core/Focusable.ts`
  limitation this plan must not edit — tracked via `it.todo` rather than
  patched here.

- **`stopAfterOwner`/`stopBeforeOwner` (the Escape-release landing spot) fall
  back to "first/last stop of the root" when the Tab-key owner contains no
  focusable descendant of its own — which, per the finding above, is true for
  `CodeEditor` and (since it embeds one for its source view) `MarkdownEditor`
  today, not just a hypothetical case.** The plan's "moves focus to the first
  stop after the owner's element" wording assumes a way to compare two
  elements' document position; the `DOMSource` seam has no such primitive
  (only `contains`, `getParentNode`/`getParentElement`, and `getFirstChild` —
  no next-sibling walk). The implementation derives "after"/"before" from
  `getTabStops(root)`'s own DOM order plus `contains`, which is exact whenever
  the owner has at least one focusable descendant in that list (true for
  `Table`, and for `CodeEditor`/`MarkdownEditor` once the gap above is fixed)
  and degrades to the documented fallback otherwise. The demo-app check
  described below observed the fallback landing on a plausible control, not a
  verified "next" computation — corrected from an earlier draft of this note
  that overstated it as exact for all three owners. Not a numbered footnote
  because it does not change any decision already made — it documents how a
  genuinely underspecified detail was resolved.

- **Manually verified in the demo app** (`npm run dev`, `FocusTraversal.enable()`
  added temporarily beside `FocusHistory.enable()` in `main.ts` as the plan's
  own Verification section describes, then reverted — nothing calls `enable()`
  from library code, matching the plan's Non-Goals): Tab inside a `CodeEditor`
  indents without leaving the editor; `Escape` then `Tab` leaves it and lands
  on a real control elsewhere on the page (the `stopAfterOwner` fallback
  described above, given the zero-internal-stops finding); `disable()`/normal
  Tab traversal across ordinary controls works. A `Dialog`'s own Tab trap was
  also checked, and found to already lose focus to `<body>` on the second
  `Tab` press (Cancel → Confirm → escapes, instead of wrapping back to
  Cancel) — originally recorded here as a **pre-existing bug in `Dialog`'s
  own trap**, unrelated to this plan. A later audit round found that
  attribution wrong: it is the `Dialog`/`FocusTraversal` Tab arbitration gap
  described in the bullet below, not an independent `Dialog` defect — see
  that bullet for the root cause and the fix (`overlay/Dialog.ts` is no
  longer untouched, contradicting step 4 and this section's "unmodified by
  this plan" wording; both are left as the historical record of what was
  originally planned/observed, corrected here rather than rewritten there).
  `MarkdownEditor`'s WYSIWYG table, `Table`'s own cell-to-cell
  Tab handling, and `ToolBar`'s arrow-key behaviour were not separately
  re-verified beyond the automated suite — they share the same
  `setTabKeyOwner(true)` mechanism already confirmed working for `CodeEditor`.

- **Two implementation bugs found and fixed during the audit loop, folded into
  the code commit rather than left as follow-ups:** (1) the Escape-release
  flag was cleared by a bare modifier keydown, so a real `Shift+Tab`
  keystroke — which fires a `Shift` keydown before the combined `Tab`
  keydown — could never consume the release; `onKeyDown` now exempts
  `Shift`/`Control`/`Alt`/`Meta` from the "any other key expires the release"
  branch. (2) `tabKeyOwner` was dispatched only when the caller explicitly
  passed the option, so a hypothetical future subclass defaulting it via
  `subclassDefaults` would answer `isTabKeyOwner() === true` while never
  writing the marker attribute — a violation of ARCHITECTURE.md's "Class-level
  defaults must survive the getter" (the always-dispatch case, since the
  setter's effect is construction-time with no render re-read).
  `applyOptions` now always calls `setTabKeyOwner`, matching `ToolBar`'s own
  `applyOrientation`/`setCompact` precedent for the same rule.

- **A third bug found in a later audit round: the release also expired on a
  `focusin` that stayed inside the same owner, not only one that left it,**
  contradicting the arbitration table's own "focus moved **elsewhere**"
  wording. Concretely, `Table`'s cell-editor cancel path re-focuses the body
  — still inside `Table` — which silently disarmed a release the user had
  just requested with `Escape`, so a single Escape-then-Tab out of an
  in-progress cell edit did not work. The one-shot flag is now
  `_releaseOwner: Handle | null` instead of a bare boolean: `onFocusIn` clears
  it only when the newly-focused element is no longer contained by the owner
  that armed it (`DOM.source.contains`), and `onKeyDown`'s `Tab` branch checks
  `owner === _releaseOwner` rather than a flag with no owner identity.
  `tests/core/FocusTraversal.test.ts` gained two `focusin`-dispatching cases
  (previously none did) covering both the "stays inside" and "moves outside"
  halves. The same round also found the Escape branch's "no `preventDefault`"
  half — load-bearing so `LayerManager` can still close a dialog around an
  editor on the same keystroke — was asserted nowhere; now covered. Finally,
  the `CodeEditor` zero-stop test added in the previous round never actually
  triggered `onFirstLayout`'s lazy CodeMirror mount (a bare `getElement(true)`
  leaves only the undisplayed search panel as a child), so it passed for the
  wrong reason; it now forces the mount via `setPreferredSize` +
  `flushLayout()` and sanity-checks `.cm-content` exists before asserting the
  zero-stop count.

- **A fourth bug found in a later audit round: `Dialog` needed a change after
  all, contradicting step 4 and the Expected Behaviour bullet "A Dialog still
  traps Tab at both ends."** Enabling `FocusTraversal` double-moved focus
  inside an open `Dialog`: both register a viewport `keydown` listener, and
  `core/Event.ts`'s `baseViewportListener` runs every registered listener for
  an event type regardless of an earlier one's disposition (it has no
  propagation-stopped check between listeners, unlike the subtree-listener
  path just above it in the same file) — so `FocusTraversal` moved focus first
  and `Dialog.onKeyDown` then re-read the already-changed active element and
  moved it again. `overlay/Dialog.ts` now calls `this.setTabKeyOwner(true)` in
  `open()` and `this.setTabKeyOwner(false)` in `destructor()` (reached from
  both `hide()`'s finalize and a direct `dispose()`), the same marker
  mechanism `CodeEditor`/`MarkdownEditor`/`Table` already use — `Dialog`'s own
  `getLayerElement()` is `this.getElement()`, an ancestor of everything
  rendered inside it, so `FocusTraversal`'s ancestor walk finds the dialog and
  stands down completely while it is open, leaving `Dialog.onKeyDown` in
  exclusive control exactly as before this plan existed. Covered by a new
  `tests/overlay/Dialog.test.ts` case asserting `isTabKeyOwner()` toggles
  correctly across `show()`/`dispose()`.

  The same round added two more findings' worth of coverage without changing
  behaviour: `tests/core/FocusTraversal.test.ts` gained two cases (forward and
  `Shift+Tab`) exercising `stopAfterOwner`/`stopBeforeOwner`'s "owner has no
  focusable descendant of its own" fallback — the path already described above
  as the actual one taken for `CodeEditor`/`MarkdownEditor`, but previously
  asserted by no test, since every prior Escape-release test seeded a stop
  inside the owner. `tests/core/FocusTraversalCompositeWidgets.test.ts` gained
  a case asserting a plain `tabindex="-1"` element is excluded by
  `findFocusable` against the real selector engine (jsdom) — the eligibility
  table's `tabindex="-1"` row had no test in either the selector-less offline
  harness or a jsdom file until now.
</content>
