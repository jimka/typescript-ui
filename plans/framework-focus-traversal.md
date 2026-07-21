---
depends-on: [focus-reveal-on-navigation]
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/DOM.ts
  - packages/lib/src/typescript/lib/core/index.ts
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
[`core/index.ts`](packages/lib/src/typescript/lib/core/index.ts#L27) beside
`FocusHistory` and `RovingTabIndex`.

The library has no Tab handling today outside one place: `Dialog` traps Tab
inside itself ([`Dialog.onKeyDown`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L992))
using a shared focusable selector
([`FOCUSABLE_SELECTOR`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L154)).
Everything else — `ToolBar`, `TabBar`, `ButtonGroup`, `Tree`, `Table`, `MenuBar` —
handles arrow keys only and leaves Tab to the browser.

The hard part is not walking the tab order. It is **arbitration**: two components
legitimately own the Tab key while focus is inside them. `MarkdownEditor` hosts
Lexical, whose table plugin registers a `KEY_TAB_COMMAND` handler that moves the
caret cell-to-cell (`node_modules/@lexical/table/src/LexicalTableSelectionHelpers.ts`,
`applyTableHandlers`, line 787). `CodeEditor` hosts CodeMirror, where Tab is an
indent gesture. A traversal service that swallows Tab unconditionally breaks both.
[`## Architecture Decisions`](#architecture-decisions) centres on how a component
claims the key and how focus eventually leaves it.

**This plan does not fix any current bug.** The idea surfaced while debugging a
`MarkdownEditor` WYSIWYG table where Tab left the editor instead of advancing to
the next cell. Grepping `core/` established the library has no Tab handler, which
ruled out the framework as the culprit — it did not make a framework handler the
cure. That bug is an editor/Lexical integration problem and is tracked separately.

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
third-party editor the library ever embeds.

---

## Architecture Decisions

### The service is a module-level namespace singleton, mirroring `FocusHistory`

`FocusTraversal` is a `namespace` over module-private state in
`core/FocusTraversal.ts`, with `enable()` / `disable()` / `isEnabled()` and a
sentinel `Component` owning its viewport listeners. It is not a `Component`
mixin and not a `LayoutManager` concern.[^singleton]

Precedent: [`core/FocusHistory.ts`](packages/lib/src/typescript/lib/core/FocusHistory.ts#L234)
— the same shape (namespace, `_owner` sentinel `Component` at line 65,
`Event.addViewportListener(_owner, "keydown", …)` at line 255, opt-in `enable()`,
state as module-private `let` bindings).

### A component claims the Tab key with a data-attribute marker, read by an ancestor walk

`Component` gets a typed `setTabKeyOwner(value: boolean)` / `isTabKeyOwner()` pair
backed by a `tabKeyOwner?: boolean` field on `ComponentOptions`. The setter mirrors
the flag onto the element as `data-ts-ui-tab-key-owner` via the existing
[`Component.setDataAttribute`](packages/lib/src/typescript/lib/core/Component.ts#L1503).
On `Tab`, the service walks from the focused element up through
`DOM.source.getParentNode` and stops at the first ancestor carrying the marker.
If it finds one, the service does nothing at all — no `preventDefault`, no focus
move — and Lexical or CodeMirror receives the key exactly as it does today.[^marker]

`MarkdownEditor` and `CodeEditor` set the flag in their own constructors. No
consumer action is required for those two.

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

The service collects candidates with `DOM.source.querySelectorAll(root, FOCUSABLE_SELECTOR)`,
which returns document order, and traverses that array. No `tabOrder` option is
added, and geometry is never read.[^dom-order]

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

### Eligibility reuses `FOCUSABLE_SELECTOR`, plus a `disabled` filter and one new seam read

`FOCUSABLE_SELECTOR` moves from `Dialog.ts` to `FocusTraversal.ts`; `Dialog`
imports it. The service filters the selector's matches by `!hasAttribute(el, "disabled")`
(as `Dialog.getFocusable` already does, line 973) and by a new
`DOMSource.isRenderedVisible(handle)` read.[^visibility]

| Candidate | Eligible | Why |
|---|---|---|
| visible enabled `<button>` | yes | matches the selector |
| `<button disabled>` | no | `disabled` filter |
| `tabindex="-1"` element | no | excluded by the selector |
| `RovingTabIndex` non-active item (`tabindex="-1"`) | no | the group is a single stop |
| `RovingTabIndex` active item (`tabindex="0"`) | yes | the group's one stop |
| element under a `visibility: hidden` ancestor (inactive `Tab` content) | no | `isRenderedVisible` is false |
| element under a `display: none` ancestor | no | `isRenderedVisible` is false |

The roving rows are the reason this plan adds no roving machinery: `RovingTabIndex`
already leaves exactly one `tabindex="0"` per group, so the selector produces
"one stop per composite widget" with no extra work.

### The traversal root is the topmost dismissable layer, else `<body>`

`FocusTraversal` asks [`LayerManager.getTopLayer()`](packages/lib/src/typescript/lib/core/LayerManager.ts#L323)
for the current top layer and uses that layer's element as the root when one
exists; otherwise `DOM.source.getBody()`. Traversal wraps at the ends of the root
only when the root is a modal layer; on `<body>` it stops at the ends and lets the
browser move focus to the browser chrome.[^root]

### Focus moves with `preventScroll: true`, and reveal is a separate concern

Every focus move goes through `DOM.sink.focus(handle, { preventScroll: true })`.
Native `focus()` scrolls `overflow: hidden` ancestors and corrupts the framework's
custom scroll models — the same reason `RovingTabIndex` takes a `preventScroll`
option ([`RovingTabIndex`](packages/lib/src/typescript/lib/core/RovingTabIndex.ts#L26))
and `TabBar` passes `true`
([`TabBar`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L485)).
Bringing an off-screen tab stop into view is `FocusReveal`'s job, from
[`plans/focus-reveal-on-navigation.md`](plans/focus-reveal-on-navigation.md), which
is why that plan is a hard dependency in this one's frontmatter.

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

/** CSS selector matching every element the framework treats as a tab stop. */
export const FOCUSABLE_SELECTOR: string;

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

Added to `Component` ([`core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts)):

```typescript
// ComponentOptions
tabKeyOwner?: boolean;

// Component
setTabKeyOwner(value: boolean): this;   // caches in this._options.tabKeyOwner;
                                        // mirrors data-ts-ui-tab-key-owner via setDataAttribute
isTabKeyOwner(): boolean;               // this._options.tabKeyOwner ?? this._defaultOptions.tabKeyOwner ?? false
```

Added to `DOMSource` ([`core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts#L1005)):

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

3. **Create `core/FocusTraversal.ts` with the pure parts only** — move
   `FOCUSABLE_SELECTOR` here, implement `getTabStops`, `next`, `previous`, and the
   root resolution. No listeners yet. Export from
   [`core/index.ts`](packages/lib/src/typescript/lib/core/index.ts). Verify: unit
   tests over `getTabStops` covering every row of the eligibility table.

4. **Point `Dialog` at the shared selector.** Delete the local
   `FOCUSABLE_SELECTOR` in [`overlay/Dialog.ts`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L154)
   and import it from `~/core/FocusTraversal.js`. Leave `Dialog.onKeyDown`
   otherwise untouched. Verify: `grep -rn "FOCUSABLE_SELECTOR" packages/lib/src/` —
   exactly one definition; the existing dialog tests still pass.

5. **Wire the keydown handler.** `enable()` / `disable()` register and remove a
   viewport `keydown` listener plus a `focusin` listener (for clearing the release
   flag), following `FocusHistory.enable` line for line. Implement the arbitration
   table: owner lookup by ancestor walk, the Escape release flag, and the
   focus move with `preventScroll: true`. Verify: unit tests driving synthetic
   keydown events through the offline DOM for every row of the arbitration table.

6. **Mark the two editors as Tab owners.** `setTabKeyOwner(true)` in the
   constructors of
   [`component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts)
   and [`component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts).
   Verify manually in the demo app: with traversal enabled, Tab inside a code
   editor still indents, and Escape-then-Tab leaves it.

7. **Audit composite widgets for the one-stop rule.** Confirm `Tree`
   ([`Tree.ts`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L119) already
   sets `tabIndex(0)` on the tree root), `Table`'s body, `MenuBar`, `ToolBar`,
   `TabBar`, and `ButtonGroup` each expose exactly one `tabindex >= 0` element.
   This step adds a test, not a fix: a widget exposing more than one stop is a bug
   in that widget and gets its own plan rather than being patched here.
   Verify: a test that renders each widget and asserts `getTabStops` returns
   exactly one handle inside it.

8. **Document.** Add the traversal section to
   [`docs/concepts/accessibility.md`](packages/lib/docs/concepts/accessibility.md)
   and the `FocusTraversal` entry to
   [`packages/lib/llms.txt`](packages/lib/llms.txt). Verify: `npm run docs:build`
   finishes with zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/FocusTraversal.ts` |
| Create | `packages/lib/tests/core/FocusTraversal.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` — add `isRenderedVisible` to `DOMSource` + `ProductionDOMSource` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` — `tabKeyOwner` option, `setTabKeyOwner` / `isTabKeyOwner` |
| Modify | `packages/lib/src/typescript/lib/core/index.ts` — export `FocusTraversal`, `FOCUSABLE_SELECTOR` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` — import the shared `FOCUSABLE_SELECTOR`, delete the local one |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — `setTabKeyOwner(true)` |
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — `setTabKeyOwner(true)` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` — offline `isRenderedVisible` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` — `tabKeyOwner` row |
| Modify | `packages/lib/docs/concepts/accessibility.md` — traversal section |
| Modify | `packages/lib/llms.txt` — `FocusTraversal` entry |

---

## Expected Behaviour

Unit-testable against the offline DOM source:

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
- A `Dialog` still traps Tab at both ends after step 4.
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
- `grep -rn "FOCUSABLE_SELECTOR" packages/lib/src/` — exactly one definition.
- `grep -rn "activeElement\|\.focus(" packages/lib/src/typescript/lib/core/FocusTraversal.ts` —
  every hit is a `DOM.source` / `DOM.sink` call.
- `npm run docs:build` — zero warnings.
- Manual smoke test in the demo app (`npm run dev`, http://localhost:8015): the
  editor demo panel, a dialog, and the toolbar/tab demo panels, with
  `FocusTraversal.enable()` added to `packages/lib/src/typescript/main.ts`
  temporarily beside the existing `FocusHistory.enable()` call at line 40.

---

## Documentation Impact

- `FocusTraversal` and `FOCUSABLE_SELECTOR` are exported from
  [`core/index.ts`](packages/lib/src/typescript/lib/core/index.ts), so TypeDoc
  renders them under the `Core` category. Give the namespace and each exported
  function a `@category Core` JSDoc block, as `FocusHistory` does.
- [`docs/concepts/accessibility.md`](packages/lib/docs/concepts/accessibility.md)
  gains a "Tab traversal" section after "Keyboard navigation: RovingTabIndex",
  covering `enable()`, the Tab-owner flag, and the Escape release. Its
  **Testing** section's keyboard-only bullet should reference the new service.
- The `Component` additions are consumer-facing options, so
  [`packages/lib/llms.txt`](packages/lib/llms.txt) gets a `FocusTraversal` line.
- Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), public JSDoc may not `{@link}`
  private or non-exported symbols — describe the ancestor walk in prose rather
  than naming the internal helper.
- No sidebar entry is needed: the concepts sidebar already lists Accessibility
  (`packages/lib/docs/.vitepress/config.*`, line 56).

---

## Potential Challenges

- **A subtree `keydown` listener fires on every matching ancestor.** The service
  uses `Event.addViewportListener`, not `addSubtreeListener`, so this does not
  bite — but any future per-component variant would need a consume-once marker.
- **The service cannot resolve an element back to its `Component`.** No
  element→`Component` map exists, and `plans/focus-reveal-on-navigation.md`
  deliberately avoids adding one. Every check the service performs must therefore
  be expressible as a DOM read — which is why the Tab-owner flag is an attribute
  and eligibility is a selector plus two predicates.
- **`Escape` is already owned by `LayerManager`**, which closes the topmost
  non-manual layer on it. The release flag must be set without calling
  `preventDefault`, so an Escape inside an editor in a dialog still closes the
  dialog. Check `LayerManager.getTopLayer()` before assuming the key is free.
- **A third editor arrives later.** Anything embedding a third-party editing
  surface must call `setTabKeyOwner(true)`, or traversal will steal its Tab.
  Note the obligation in the `MarkdownEditor` / `CodeEditor` class JSDoc so the
  next such component copies it.
- **`isRenderedVisible` costs a style read per candidate.** Compute tab stops
  lazily inside the Tab handler, never on a timer or per layout pass.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/FocusHistory.ts`](packages/lib/src/typescript/lib/core/FocusHistory.ts) —
  **the precedent.** Namespace singleton, `_owner` sentinel, viewport listeners,
  opt-in `enable()`, `LayerManager` deference. Copy this shape.
- [`packages/lib/src/typescript/lib/core/RovingTabIndex.ts`](packages/lib/src/typescript/lib/core/RovingTabIndex.ts) —
  the existing composite-widget focus manager; this plan reuses it rather than
  replacing it.
- [`packages/lib/src/typescript/lib/overlay/Dialog.ts`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L960) —
  the only existing Tab handler, and the source of `FOCUSABLE_SELECTOR`.
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) —
  the seam every focus and `activeElement` access must route through.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts#L1698) —
  `isEffectivelyVisible`, `isDisplayed`, `setDataAttribute`, `focus(preventScroll)`.
- [`packages/lib/src/typescript/lib/component/menubar/ToolBar.ts`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L484) —
  auto-registers focusable children into a `RovingTabIndex`; the model for the
  step-7 audit.
- [`plans/focus-reveal-on-navigation.md`](plans/focus-reveal-on-navigation.md) —
  the hard dependency; supplies the reveal step that `preventScroll: true` needs.
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
- **Replacing `Dialog`'s focus trap.** Step 4 shares the selector only. Folding
  the trap into the service is a follow-on, gated on a second overlay needing it.
- **New roving-tabindex machinery.** `RovingTabIndex` already exists and already
  produces the one-stop-per-widget property this plan relies on.
- **Arrow-key navigation inside composite widgets.** `Tree`, `Table`, `MenuBar`,
  `ToolBar`, and `TabBar` keep owning their own arrow keys.
- **Focus rings, ARIA attributes, and screen-reader semantics.** Owned by
  `focusRing.ts` and `Aria.ts`.
- **Scrolling a focused stop into view.** Owned by `FocusReveal`.
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
    resolve it to a `Component` — `plans/focus-reveal-on-navigation.md` records
    that no element→`Component` map exists and that adding one is out of bounds.
    A DOM attribute is therefore the only claim channel that survives the seam.
    The same ancestor-walk technique is used in that plan to detect a `<td>`/`<th>`
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

[^visibility]: The seam has no visibility read today — `getComputedOverflow` and
    `getInlineStyle` are the closest, and neither sees an ancestor's
    `display: none`. `Component.isEffectivelyVisible` computes exactly the right
    answer but needs a `Component`, which the service does not have.
    `getElementRect` is not a substitute: a `visibility: hidden` element still
    reports a non-zero rect, and that is the case that matters most, since `Tab`
    hides inactive content that way. The production implementation is
    `Element.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })`;
    the offline implementation walks the modelled parent chain, which `TestDOM`
    already supports.

[^root]: Scoping to the top layer reproduces what `Dialog` does today and is what
    `FocusHistory` already does when it suppresses its accelerator for a modal
    layer (`FocusHistory.ts` line 215). Wrapping only inside a modal is the
    difference between a trap and a traversal: a modal must not let focus escape
    to the page behind it, while on the page itself a user reaching the end of
    the document expects to land in the browser's address bar, not to be looped
    back.
