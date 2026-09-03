---
touches-shared: [packages/lib/src/typescript/lib/layout/Tab.ts, packages/lib/src/typescript/lib/component/container/TabBar.ts, packages/lib/docs/layouts/Tab.md, packages/lib/docs/reference/changelog/next.md]
---

# Tab Double-Click Event — Implementation Plan

## Overview

[`Tab`](packages/lib/src/typescript/lib/layout/Tab.ts#L59) emits nine events
today — `tabclose`, `beforetabclose`, `empty`, `detach`, `select`, `activate`,
`dock`, `exception`, `busychange` — and none of them reports a **double-click
on a tab button**. A consumer cannot recover the gesture from outside either:
`Tab` keeps its `TabBar` private
([Tab.ts:312](packages/lib/src/typescript/lib/layout/Tab.ts#L312)) and
`TabBar` exposes no way to map an event target back to a cell, so there is no
route from a DOM `dblclick` to the tab it landed on.

This plan adds one event, `"tabdblclick"`, carrying the double-clicked tab's
live content component and its zero-based index — the payload
[`"activate"`](packages/lib/src/typescript/lib/layout/Tab.ts#L2569) already
uses. Two files change. `TabBar` interprets the DOM gesture into a **cell** id
— a cell being `TabBar`'s own name for one tab's bar-side record, its button
and label, keyed by an id the owning `Tab` minted — and emits its own
`"tabdblclick"(id)`; `Tab` resolves that id to live content and re-emits the
public `"tabdblclick"(content, index)`.

The requesting consumer is the Loom editor, whose preview ("temp") tab should
pin when the user double-clicks it in the strip, matching VS Code.[^why-loom]

---

## Architecture Decisions

### The strip resolves the gesture; `Tab` translates it to content

`TabBar` registers one `dblclick` subtree listener **on itself** in `init()`,
walks the event target up to the cell whose tab button contains it, and emits
`"tabdblclick"(id)`. `Tab` subscribes in `attach()`, resolves the id against
`_contents`, and emits the public `"tabdblclick"(content, index)`. This
mirrors the bar's own self-registered `dblclick` listener in
[`installMoveTrigger`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1397)
and the `"tabpressed"` → [`Tab._onBarTabPressed`](packages/lib/src/typescript/lib/layout/Tab.ts#L1033)
hand-off every other bar gesture already uses.[^self-registration]

### The payload mirrors `"activate"`

`"tabdblclick"` carries `(content: Component, index: number)`. A cell whose
content is not built yet — a lazy tab whose factory has not run — emits
nothing, exactly as `_onBarTabClose` skips a contentless entry
([Tab.ts:1103-1106](packages/lib/src/typescript/lib/layout/Tab.ts#L1103)).[^lazy-skip]

### The target-to-cell walk is shared with `isBarChromeTarget`

[`isBarChromeTarget`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1310)
already walks `_entries` testing whether each tab button's element contains
the event target. That loop becomes a private `entryForTarget(target)` helper
returning the matching cell, and `isBarChromeTarget` calls it instead of
repeating the walk.[^dedup]

On a strip of two tabs:

| `dblclick` target | `entryForTarget` | `Tab` emits |
|---|---|---|
| the second tab's button element | that tab's cell | `"tabdblclick"(second content, 1)` |
| the ✕ inside the first tab's button | that tab's cell | `"tabdblclick"(first content, 0)` |
| the strip's own element (blank area) | `null` | nothing |
| a strip tool's button | `null` | nothing |

### No `TabOptions.listeners` field for it

The construction-time `listeners` bag
([Tab.ts:155-165](packages/lib/src/typescript/lib/layout/Tab.ts#L155)) gains
no `tabdblclick` key; the event is wired through `on()` only.[^no-listeners-bag]

---

## Public API

`packages/lib/src/typescript/lib/component/container/TabBar.ts`:

```typescript
export type TabBarEvent =
    "tabpressed" | "reorder" | "tabclose" | "dockrequested" | "tabdragstart"
    | "tearoffrequested" | "detach" | "dockhover" | "tabdblclick";

class TabBar extends Container<TabBarOptions> {
    on(event: "tabdblclick", listener: (id: string) => void): this;

    protected emit(event: "tabdblclick", id: string): void;
}
```

`packages/lib/src/typescript/lib/layout/Tab.ts`:

```typescript
export type TabEvent =
    "tabclose" | "beforetabclose" | "empty" | "detach" | "select" | "activate"
    | "dock" | "exception" | "busychange" | "tabdblclick";

class Tab extends LayoutManager {
    /**
     * Registers a listener for the `"tabdblclick"` event, which fires when a
     * tab button in the strip is double-clicked, carrying that tab's content
     * component and its zero-based index.
     */
    on(event: "tabdblclick", listener: (content: Component, index: number) => void): this;

    protected emit(event: "tabdblclick", content: Component, index: number): void;
}
```

`off` needs no change on either class: both take the whole `XEvent` union in a
single signature
([Tab.ts:2626](packages/lib/src/typescript/lib/layout/Tab.ts#L2626),
[TabBar.ts:3245](packages/lib/src/typescript/lib/component/container/TabBar.ts#L3245)).

The first click of a double-click already activates the tab through the
button's `"action"` → `onTabPressed` path, so a `"tabdblclick"` listener always
runs with the double-clicked tab already active.

---

## Internal Structure

`TabBar` — the extracted helper, the new listener, and the rewritten head of
`isBarChromeTarget`:

```typescript
/**
 * Returns the cell whose tab button contains `target`, or `null` when the
 * target lands outside every tab button.
 */
private entryForTarget(target: EventTarget | null): BarEntry | null {
    if (!DOM.source.isNode(target)) {
        return null;
    }

    const targetHandle = DOM.source.intern(target);

    for (const entry of this._entries) {
        const buttonEl = entry.button.getElement();

        if (buttonEl && DOM.source.contains(buttonEl, targetHandle)) {
            return entry;
        }
    }

    return null;
}

/**
 * Subtree `dblclick` handler: emits `"tabdblclick"` for the cell the gesture
 * landed on. A double-click on the strip's blank area or its fixed chrome
 * resolves to no cell and emits nothing.
 */
private onTabDoubleClick(e: MouseEvent): void {
    const entry = this.entryForTarget(e.target);

    if (entry) {
        this.emit("tabdblclick", entry.id);
    }
}

private isBarChromeTarget(target: EventTarget | null): boolean {
    if (this.entryForTarget(target) !== null) {
        return true;
    }

    if (!DOM.source.isNode(target)) {
        return false;
    }

    const targetHandle = DOM.source.intern(target);

    // …the existing tool-group / lead-widget / scroll-arrow checks, unchanged.
}
```

`Tab` — the bar-event handler, beside `_onBarTabPressed`:

```typescript
/**
 * Strip `"tabdblclick"` handler: a cell's tab button was double-clicked.
 * Re-emits the public `"tabdblclick"` with the cell's live content and index.
 *
 * @param id - The double-clicked cell id.
 */
private _onBarTabDoubleClick = (id: string): void => {
    const idx = this._contents.findIndex(entry => entry.id === id);

    if (idx < 0) {
        return;
    }

    const entry = this._contents[idx];

    // A deferred entry has no content for the event to carry, and unlike
    // "activate" there is nothing to owe it later — the gesture is over.
    if (entry.component) {
        this.emit("tabdblclick", entry.component, idx);
    }
};
```

---

## Ordered Implementation Steps

1. **`packages/lib/tests/layout/Tab.doubleClick.test.ts`** — new file, written
   first. Copy the `CONFIG`, `hostTab()`, and `barEntries()` helpers from
   [`Tab.renameAndVeto.test.ts`](packages/lib/tests/layout/Tab.renameAndVeto.test.ts#L18)
   widening `barEntries`' element type with `closeButton?: TabCloseButton` so
   case 2 can reach the ✕. Add a `driveBarDoubleClick(tab, target)` helper that reaches
   `tab`'s private `_bar` and calls its private `onTabDoubleClick` with
   `makeEvent(target, 'dblclick')`
   ([TestDOM.makeEvent](packages/lib/tests/dom/TestDOM.ts#L1494); driving a
   private `dblclick` handler with a synthesized event mirrors
   [`Window.headerMoveTrigger.test.ts:74-94`](packages/lib/tests/overlay/Window.headerMoveTrigger.test.ts#L74)).
   Write the six cases in `## Expected Behaviour`. They must fail to compile
   at this point — `"tabdblclick"` does not exist yet.

2. **`TabBar.ts`** — add `"tabdblclick"` to the `TabBarEvent` union at
   [line 98](packages/lib/src/typescript/lib/component/container/TabBar.ts#L98)
   and a bullet for it to that type's doc list at
   [lines 79-94](packages/lib/src/typescript/lib/component/container/TabBar.ts#L79):
   `` `"tabdblclick"(id)` — a cell's tab button was double-clicked; the owner
   re-emits it with the live content. ``

3. **`TabBar.ts`** — add the `on` overload after the `"dockhover"` one at
   [line 3229](packages/lib/src/typescript/lib/component/container/TabBar.ts#L3229)
   and the matching `protected emit` overload after
   [line 3265](packages/lib/src/typescript/lib/component/container/TabBar.ts#L3265).
   Both signatures are in `## Public API`.

4. **`TabBar.ts`** — extract `entryForTarget` from
   [`isBarChromeTarget`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1310)
   and rewrite that method's head to call it, exactly as
   `## Internal Structure` shows. Place `entryForTarget` immediately above
   `isBarChromeTarget`. Leave the tool-group, lead-widget, and scroll-arrow
   checks byte-identical.

5. **`TabBar.ts`** — add `onTabDoubleClick` (per `## Internal Structure`)
   directly below `isBarChromeTarget`, and register it in `init()` on the line
   after the existing keydown registration at
   [line 770](packages/lib/src/typescript/lib/component/container/TabBar.ts#L770):
   `Event.addSubtreeListener(this, "dblclick", this.onTabDoubleClick);`. No
   teardown call — disposal purges the registration, which is why the keydown
   listener beside it has none either.

6. **`Tab.ts`** — add `"tabdblclick"` to the `TabEvent` union at
   [line 59](packages/lib/src/typescript/lib/layout/Tab.ts#L59), and a clause
   for it to that union's doc block at
   [lines 26-56](packages/lib/src/typescript/lib/layout/Tab.ts#L26): it fires
   when a tab button is double-clicked, carrying that tab's content and index,
   and does not fire for a tab whose deferred content has not been built.

7. **`Tab.ts`** — add the `on` overload with its JSDoc after the `"activate"`
   one at [line 2569](packages/lib/src/typescript/lib/layout/Tab.ts#L2569),
   and the matching `protected emit` overload after
   [line 2647](packages/lib/src/typescript/lib/layout/Tab.ts#L2647).

8. **`Tab.ts`** — add the `_onBarTabDoubleClick` arrow-function field from
   `## Internal Structure` directly below
   [`_onBarTabPressed`](packages/lib/src/typescript/lib/layout/Tab.ts#L1033),
   subscribe it in `attach()` beside the other bar subscriptions
   ([line 986](packages/lib/src/typescript/lib/layout/Tab.ts#L986)) and
   unsubscribe it in `detach()` beside theirs
   ([line 1018](packages/lib/src/typescript/lib/layout/Tab.ts#L1018)). Both
   lists must stay symmetric — every `on` in `attach` has its `off` in
   `detach`.

9. Run `npx vitest run packages/lib/tests/layout/Tab.doubleClick.test.ts` —
   all six cases green. Then `npm run typecheck` and the full `npm test`.

10. `grep -rln 'tabdblclick' packages/lib/src` — exactly two files,
    `component/container/TabBar.ts` and `layout/Tab.ts`. A third file means
    something was pasted into the wrong place.

11. **Docs** — `packages/lib/docs/layouts/Tab.md`: add a `tabdblclick` row to
    the *Events* table at
    [line 50](packages/lib/docs/layouts/Tab.md#L50) and one short paragraph
    after the `beforetabclose` paragraph
    ([line 59](packages/lib/docs/layouts/Tab.md#L59)) stating that the first
    click of the pair has already activated the tab, that a blank-strip or
    chrome double-click fires nothing, and that a tab whose deferred content
    has not been built fires nothing.

12. **Docs** — `packages/lib/docs/reference/changelog/next.md`: add a bullet
    to the `### Layouts` subsection under `## Added`
    ([line 109](packages/lib/docs/reference/changelog/next.md#L109)), in the
    style of the `"beforetabclose"` bullet beside it.

13. Run `npm run docs:api` — must finish with **zero** warnings (the new
    JSDoc `{@link}`s may only name exported, non-internal symbols).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Tab.ts` |
| Create | `packages/lib/tests/layout/Tab.doubleClick.test.ts` |
| Modify | `packages/lib/docs/layouts/Tab.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

The six numbered cases are unit-testable through the private
`onTabDoubleClick` handler and need no browser; one manual check follows them.

1. **A double-click on a tab button emits the event with that tab's content
   and index.** Two contents added to a `hostTab()`, `host.doLayout()`, then
   `driveBarDoubleClick(tab, barEntries(tab)[1].button.getElement(true)!)`
   fires `"tabdblclick"` exactly once with the second content and `1`.
2. **A double-click on a descendant of the tab button resolves to the same
   tab.** With the tab added `closeable`, targeting
   `barEntries(tab)[0].closeButton!.getElement(true)!` — a real DOM child of
   the tab button — fires the event with the first content and `0`.
3. **A double-click on the strip's blank area emits nothing.** Targeting the
   bar's own element handle fires no `"tabdblclick"`.
4. **A double-click on the strip's tool group emits nothing.** With a tool
   added via `tab.addTool(button)`, targeting that button's element fires no
   `"tabdblclick"`.
5. **A lazy tab whose content has not been built emits nothing.** Add one
   eager content first (so the lazy tab is not the initial tab, which a layout
   pass would materialize), then `tab.addLazyTab(factory, 'Later')`, then
   `host.doLayout()`. The lazy cell has no content; a double-click on its tab
   button fires no `"tabdblclick"`, and the factory is not invoked.
6. **A reordered strip reports the new index.** Move the first cell to the end
   by calling the bar's public `moveBarEntry(firstId, 1)` and then `Tab`'s
   private `_onBarReordered(firstId, 1)` — reaching a private handler the same
   way `Tab.renameAndVeto.test.ts` reaches `_onBarTabClose`. A double-click on
   that same tab button now reports index `1`, not `0`: the index comes from
   `_contents`, which the reorder re-sorted.

Manual (once, in the demo app): double-clicking a tab in a rendered strip
fires the event; double-clicking the blank strip area still toggles a hosting
window's maximize, unchanged.

---

## Verification

- `npm run typecheck` — clean.
- `npx vitest run packages/lib/tests/layout/Tab.doubleClick.test.ts` — six
  passing cases.
- `npm test` — clean. `Tab.closeDisposal`, `Tab.renameAndVeto`, `Tab.tabGlyph`,
  `TabBar.test`, `TabBar.contextMenu`, `TabBar.edgecases` and `TabPanel.test`
  all exercise the two files this plan edits and must stay green unchanged.
- `npm run docs:api` — zero warnings.
- `grep -rln 'tabdblclick' packages/lib/src` — exactly two files, as step 10
  lists.
- `grep -rn 'tabdblclick' packages/lib/docs/layouts/Tab.md packages/lib/docs/reference/changelog/next.md`
  — at least one match in each.
- `grep -c 'this._bar.on(' packages/lib/src/typescript/lib/layout/Tab.ts` and
  `grep -c 'this._bar.off(' …` — equal counts (nine each), proving `attach` /
  `detach` stayed symmetric.
- `git diff --name-only` — exactly the five files in the table.

---

## Documentation Impact

- **`packages/lib/docs/layouts/Tab.md`** — the canonical `Tab` page. Its
  *Events* table gains a `tabdblclick` row, plus the paragraph described in
  step 11. This is the same pair of edits the `beforetabclose` addition made
  to this page.
- **`packages/lib/docs/reference/changelog/next.md`** — a bullet under
  `## Added` → `### Layouts`.
- **`packages/lib/docs/components/TabPanel.md`** needs no edit. It documents
  the close hooks specifically and already names `getTab()` as the route to
  every other `Tab` event, which is how a `TabPanel` consumer reaches this one.
- **`packages/lib/llms.txt`** needs no edit: it indexes components and their
  docs pages, not individual events, and no page is added or renamed.
- `packages/lib/docs/api/**` is TypeDoc output — regenerated by
  `npm run docs:api`, never hand-edited.

---

## Potential Challenges

- **Two `dblclick` subtree listeners now sit on the same `TabBar`.** The
  window-move trigger's listener
  ([TabBar.ts:1397](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1397))
  and the new one both register for `dblclick` on the bar; the dispatcher
  keeps a per-component listener array, so both run. Neither returns a stop
  disposition, and their target tests are complements (the move trigger vetoes
  chrome, this one requires a tab button), so exactly one acts on any given
  double-click. Do not add a `stop` to either.
- **A double-click on a closeable tab's ✕ closes the tab on the first click.**
  The cell is gone (and its button disposed) before any second click, so in a
  real browser the pair usually produces no `dblclick` on that button at all.
  Case 2 above pins the resolution logic rather than that browser sequence;
  nothing in this plan needs the ✕ case to behave any particular way.
- **`entry.button.getElement()` is the non-forcing read.** It returns `null`
  before first render, so `entryForTarget` returns `null` for an unrendered
  strip. That matches the existing `isBarChromeTarget` behaviour and is why
  the tests call `host.doLayout()` first. Do not switch it to
  `getElement(true)` — forcing element creation from an event handler would
  build DOM during dispatch.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/container/TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts) —
  `TabBarEvent` (line 98), `BarEntry` (196), `init` (751), `isBarChromeTarget`
  (1310), `installMoveTrigger` (1366, the self-registered `dblclick`
  precedent), `createBarEntry` (1632), the `on` / `emit` overload lists
  (3222, 3258).
- [`packages/lib/src/typescript/lib/layout/Tab.ts`](packages/lib/src/typescript/lib/layout/Tab.ts) —
  `TabEvent` and its doc block (26-61), `TabOptions.listeners` (155),
  `ContentEntry` (264), `attach` / `detach` (974, 995), `_onBarTabPressed`
  (1033), `_onBarTabClose` (1103, the contentless-entry guard), the `on` /
  `emit` overload lists (2486, 2639).
- [`packages/lib/tests/layout/Tab.renameAndVeto.test.ts`](packages/lib/tests/layout/Tab.renameAndVeto.test.ts) —
  the `hostTab` / `barEntries` / private-handler test shape the new test file
  copies.
- [`packages/lib/tests/overlay/Window.headerMoveTrigger.test.ts`](packages/lib/tests/overlay/Window.headerMoveTrigger.test.ts) —
  how a private `dblclick` handler is driven with a synthesized event.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Event handling*: the self-only rule
  for the `Event` API, the named-listener rule, and the widen-the-`XEvent`-union
  instruction this plan follows.
- [`packages/lib/docs/layouts/Tab.md`](packages/lib/docs/layouts/Tab.md) — the
  *Events* table and its surrounding paragraphs.

---

## Non-Goals

- **No `TabPanel` forwarder.** `TabPanel` mirrors no per-event forwarder for
  `activate`, `select`, or `beforetabclose` either; `getTab().on(…)` is the
  documented route and needs no new surface.
- **No keyboard equivalent.** No key gesture emits `"tabdblclick"`; the event
  reports the mouse gesture only.
- **No behaviour of its own.** `Tab` does nothing in response to the
  double-click — no rename, no pin, no re-selection. The event is an
  announcement; the consumer decides.
- **No `TabBar`-level public hit-testing API.** `entryForTarget` stays private.
  Exposing an element-to-cell lookup would let consumers reach past the event
  surface, which is the coupling
  [`ARCHITECTURE.md`](ARCHITECTURE.md)'s event rules exist to prevent.

---

## Notes

[^why-loom]: Loom (the sibling desktop editor built on this library) recycles
    one "temp" tab as the user single-clicks through the file tree, and pins it
    on the first edit or on a double-click in the *tree*. Pinning on a
    double-click on the *tab* — what VS Code does — is the one trigger it
    cannot wire, because the gesture never reaches it. Loom's own plan
    (`../loom/plans/pin-tab-on-doubleclick.md`) consumes this event and
    depends on it landing first.

[^self-registration]: Three shapes were available and only one is conformant.
    (a) A per-cell `Event.addSubtreeListener(tabButton, "dblclick", …)` inside
    `createBarEntry`, mirroring the `contextmenu` listener already there
    ([TabBar.ts:1677](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1677)) —
    rejected: that line registers an `Event` listener against *another*
    `Component` (a privately-owned child), the exact bypass
    [`ARCHITECTURE.md`](ARCHITECTURE.md)'s *A component must not listen to
    another component's events through `Event`* forbids, including its
    explicit "even when the child was just constructed" clause. Copying it
    would repeat that bypass in new code. (b) Reusing `installMoveTrigger`'s optional
    `onEmptyDoubleClick` callback — rejected: it fires only for the strip's
    blank area and deliberately vetoes every tab button. (c) The chosen shape:
    one self-registered subtree listener in `init()`, mirroring
    `Event.addSubtreeListener(this, "keydown", this.onToolbarKeyDown)` on
    [line 770](packages/lib/src/typescript/lib/component/container/TabBar.ts#L770)
    and the bar's own `dblclick` registration on
    [line 1397](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1397).
    A bare registration also inherits the dispatcher's primary-button default
    for `dblclick` ([ARCHITECTURE.md](ARCHITECTURE.md), *Event handling*), so
    no non-primary gesture can reach the handler.

[^lazy-skip]: `"activate"` owes a deferred announcement (`announceActivation`)
    when a lazy tab is selected before its factory has run, because the
    consumer's question — "which tab is now showing?" — still has a correct
    answer once the build finishes. A double-click has no such pending answer:
    by the time a factory resolves, the gesture is over, and firing then would
    report a stale interaction. So the contentless case is dropped outright
    rather than deferred. The double-click still selects the tab (through the
    button's `"action"`), which starts the build and emits `"activate"` in the
    usual way.

[^dedup]: The alternative was a second copy of the same eight-line walk. Both
    call sites need precisely "the cell whose tab button contains this target",
    and `isBarChromeTarget`'s own comment already explains why the tab clip is
    excluded from that test — duplicating the loop would duplicate that
    subtlety too. The extraction is behaviour-preserving: `isBarChromeTarget`
    checks the entries first today and still does, and the `isNode` guard it
    used to run once now runs inside `entryForTarget` and again for the
    remaining checks, which is a repeated cheap type test and nothing more.

[^no-listeners-bag]: The bag currently carries `tabclose`, `beforetabclose`,
    `empty`, `exception` and `busychange` — the events whose payload is a
    label, an error, or a flag. It already omits `select`, `activate`, `dock`
    and `detach`, the four content- and window-carrying events, of which
    `"tabdblclick"` is a fifth. Adding a key for this one event alone would
    make the omission look deliberate for exactly one member of that group.
    Widening the bag to cover all five is a separate, uniform change and is
    out of scope here.
