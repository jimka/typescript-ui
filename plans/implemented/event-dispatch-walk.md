---
touches-shared:
  - packages/lib/src/typescript/lib/core/DOM.ts
  - packages/lib/src/typescript/lib/core/Event.ts
  - packages/lib/src/typescript/lib/core/index.ts
  - packages/lib/tests/dom/TestDOM.ts
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
  - packages/qa/README.md
---

# Event Dispatch Walk — Implementation Plan

## Overview

G20 `event-dispatch-and-registrants`, from wave 3 of the render-performance campaign. `Event`'s window-level dispatcher runs subtree listeners by walking from the event target to the document root. At every level it makes two seam calls, `DOM.source.getId` and `DOM.source.getParentElement` ([`core/Event.ts:301-347`](packages/lib/src/typescript/lib/core/Event.ts#L301)). It does this for every event of any type that has a subtree registration anywhere on the page, whether or not an ancestor is registered. The W3.0 sweep measured the walk at 75–79% of all DOM-seam read calls per chart-hover unit: 11.98 of 15.92 on `chart-line`, 17.37 of 22.01 on `chart-dashboard` ([`96-w3-0-bounding-sweep.md`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L220)). Its dose arm, which ran the walk twice, cost no visible frame time. **This plan removes work, not milliseconds**, and expects frame time to stay flat.

The change adds one seam read, `DOMSource.closestWithId(handle, ids)`. It returns the nearest element at or above `handle` whose `id` is a key of the type's registration map, climbing inside `core/DOM.ts`. The dispatcher calls it once per registered ancestor on the path, plus once more to find that there are no more. A walk that matches nothing now costs one seam call instead of two per level. Every dispatch rule stays as it is: exact target before subtree, inner before outer, `stop`/`prevent`, listeners added or removed mid-dispatch, components disposed mid-dispatch.

The change touches `core/DOM.ts` (the new read and its result type), `core/Event.ts` (the walk), `tests/dom/TestDOM.ts` (the offline twin), the tests, and the docs. `FieldDecorator`'s covering tooltip registers subtree `mouseover`/`mousemove`/`mouseout`/`mousedown` listeners while it shows an error ([`overlay/Tooltip.ts:635-641`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L635)). So today every `mousemove` anywhere walks to the root while any decorator shows an error, and the in-engine check covers that path too. The plan also deletes `Event.init()`, an exported no-op with no callers, in its own commit.

---

## Architecture Decisions

### The seam finds the next registered ancestor — the way `isRenderedVisible` climbs and the exact-target map looks up

`DOMSource.closestWithId(handle, ids)` climbs `parentElement` inside `core/DOM.ts`, the way [`ProductionDOMSource.isRenderedVisible`](packages/lib/src/typescript/lib/core/DOM.ts#L2729) and [`contains`](packages/lib/src/typescript/lib/core/DOM.ts#L2653) already do in one seam call. It tests each element's `id` against the dispatcher's own id-keyed registration map, which is the lookup the exact-target phase already does ([`core/Event.ts:274-290`](packages/lib/src/typescript/lib/core/Event.ts#L274)). Its result is a small exported record, `IdMatch`, shaped like [`DocumentSelectionRange`](packages/lib/src/typescript/lib/core/DOM.ts#L1659).[^precedent]

The existing short-circuits stay exactly where they are. A type with no registration has no window listener at all (`installedListenerTypes`). A type with no subtree registration returns before any walk ([`core/Event.ts:296-299`](packages/lib/src/typescript/lib/core/Event.ts#L296)). A stop returned in the exact-target phase skips the walk.

### The climb stays live, one call per registered ancestor

The walk does not take a snapshot of the ancestor chain. After the listeners of a matched component have run, the dispatcher reads that element's parent (`getParentElement`, guarded as today) and asks `closestWithId` again from there. So everything a listener does to the tree is seen as the per-level walk saw it. Case EV2 in [`event-subtree-reentrant-dispose.test.ts`](packages/lib/tests/dom/event-subtree-reentrant-dispose.test.ts#L80) — an outer listener does not run after an inner listener disposes its own component — stays exactly as written.[^live-climb]

Seam calls per dispatched event, for a type with subtree registrations:

| Target's path | Matches on the path | `closestWithId` | `getParentElement` | `getId` |
|---|---|---|---|---|
| no registered ancestor (a form hover while a decorator elsewhere shows an error) | 0 | 1 | 0 | 0 |
| one registered ancestor (a chart mark under its chart) | 1 | 2 | 1 | 0 |
| two registered ancestors | 2 | 3 | 2 | 0 |
| the nearer one returns a stop | 1 | 1 | 0 | 0 |
| any of the above, when the type also has an exact-target listener anywhere on the page | — | same | same | +1 (the exact-target phase, unchanged) |

Before this change each row costs one `getId` and one `getParentElement` per level climbed: up to `<html>`, or up to the component that stops the walk.

### The saving is work avoided, not frame time

The walk's reads are property reads, not forced layout, and the dose arm showed a whole second walk inside the plain arms' spread. The plan claims no millisecond gain. It claims fewer seam calls: the two registry look-ups, the intern and the seam round trip that each level costs today. The native `id` and `parentElement` reads stay, inside the one call.[^work-not-ms]

### The registrants stay as they are

`SplitGutter`, `Accordion`, `Button`, `ToolBar`, the charts and the covering tooltip keep their subtree registrations. The campaign's synthesis ([`99-synthesis.md`](plans/research/render-review-2026-09-15/99-synthesis.md#L1870)) also wanted every high-frequency registrant narrowed at once (its ordering constraint 3): narrowing removes the walk for an event type only once no subtree registrant of that type is left. Here the walk's cost no longer grows with depth, so narrowing buys nothing this plan can measure.[^registrants]

### `closestWithId` takes any id lookup, and stops nowhere early

The `ids` parameter is `{ has(id: string): boolean }`, so the dispatcher passes its per-type registration map as it is. No second set of ids is kept.[^lookup-param] The climb runs to the first match or to the root; it does not try to stop sooner.[^no-early-stop]

### Where the fix follows the dose arm, and where it differs

The W3.0 arm `g20.walk-dose` ([`packages/qa/src/harness/ablations.ts:1647`](packages/qa/src/harness/ablations.ts#L1647)) could not remove the walk, because the walk lives in a closure no page code can reach. The arm added a second walk instead.

| Aspect | W3.0 `g20.walk-dose` | This plan |
|---|---|---|
| What it does to the walk | runs each `getParentElement` and `getId` twice | removes both per-level calls; one `closestWithId` per matched ancestor, plus one |
| What it proved | the walk's calls are 75–79% of the seam reads per chart-hover unit; a whole extra walk costs no visible time | those calls are the saving; frame time is expected flat |
| What it reaches | every call of the two methods, the walk's and any other caller's | `Event`'s subtree phase only |
| Invalidation and memory | none needed: both methods are pure | none needed: no cache, every climb reads the live DOM |
| Dispatch semantics | untouched | untouched, and pinned by new tests for add, remove, reparent, dispose, text-node, shadow, window and document targets |
| API | none | `DOMSource.closestWithId` and `IdMatch` |
| Cells | `clh`, `cdh` (chart hover) | the same two, plus a form hover with a decorator in error (`ffyh`) |

### `g20.walk-dose` stays in the QA app

This plan does not change the ablation or its test (A16). The QA README's entry gains a note: on a build with this change, the arm doses only the exact-target `getId` and one `getParentElement` per matched ancestor, so it no longer bounds the walk.[^dose-after]

### `DOMSource` gains a required member

A consumer that implements its own `DOMSource` must add `closestWithId`. The changelog says so under *Breaking changes → Core*, as 0.8.0 and 0.9.0 did for their new members.[^breaking]

### `Event.init()` is deleted, in its own commit

`Event.init()` is exported, documented as "currently a no-op", and has no caller in this repository, Loom or SQLAdmin (slice 03 F03.10). Pre-1.0 an unused public member is deleted, not kept. It goes in a commit of its own, with a changelog entry and a migration note.[^init]

---

## Public API

```typescript
// core/DOM.ts — new, exported beside DocumentSelectionRange / TextSelectionRange
/**
 * Seam-friendly result of {@link DOMSource.closestWithId}: the element that
 * matched, as a handle, and the id it matched on.
 *
 * @category Core
 */
export interface IdMatch {
    /** The matched element. */
    handle: Handle;
    /** The matched element's `id`: the key found in the lookup. */
    id:     string;
}

// core/DOM.ts — new required member of DOMSource, declared after getParentElement
export interface DOMSource {
    /**
     * The nearest element at or above `handle` whose `id` is in `ids`: the
     * start node itself first, then each parent element in turn. The climb
     * runs inside the seam, so the nodes it passes are neither resolved
     * through the handle registry nor interned. A start node with no `id` of
     * its own — a text node, the document, the window — is passed over, and
     * the climb stops where `parentElement` stops: at the document root, the
     * top of a detached subtree, or the top of a shadow tree. An empty `id`
     * never matches.
     *
     * @param handle - The node to start from, usually an event target.
     * @param ids - The ids to look for. Only `has` is called, so a `Set` of
     *   ids and a `Map` keyed by id both serve.
     * @returns The matched element and its id, or `null` when nothing up to
     *   the root matches.
     * @throws Error - When `handle` has been released or collected, as every
     *   handle-taking read does.
     */
    closestWithId(handle: Handle, ids: { has(id: string): boolean }): IdMatch | null;
}

// ProductionDOMSource implements it (core/DOM.ts); ModelledDOMSource implements it (tests/dom/TestDOM.ts).
```

`core/index.ts` adds `IdMatch` to its `export type { … } from '~/core/DOM.js'` list.

Removed: `Event.init(): void` (`core/Event.ts:370-375`).

---

## Internal Structure

### `ProductionDOMSource.closestWithId` — `core/DOM.ts`, after `getParentElement` (`:2685-2689`)

```typescript
/** @inheritDoc */
closestWithId(handle: Handle, ids: { has(id: string): boolean }): IdMatch | null {
    // Typed `Node`, not `Element`: an event target can be a text node, the
    // document or the window. Reading `id` and `parentElement` off any node
    // makes each climb, or stop, as a per-level `getId` / `getParentElement`
    // pair did: a text node has no id and climbs to its parent element, the
    // document's `parentElement` is null, and the window has none at all.
    // `typeof` also rejects the element a window's named-property lookup can
    // return for `id`.
    let node: Node | null | undefined = _registry.resolve(handle);

    while (node) {
        const id: unknown = (node as Element).id;

        if (typeof id === "string" && id !== "" && ids.has(id)) {
            return { handle: _registry.intern(node), id };
        }

        node = (node as Element).parentElement;
    }

    return null;
}
```

`_registry.intern(node)` returns the node's existing handle when it has one, so a matched component element keeps its retained handle and a match on the start node returns `handle` itself.

### `ModelledDOMSource.closestWithId` — `tests/dom/TestDOM.ts`, after `getParentElement` (`:1341-1343`)

```typescript
/**
 * Climbs the handle's recorded parents, the handle itself first, to the
 * first stub whose id is in `ids`: the modelled tree's version of the
 * production climb, as `isRenderedVisible` is.
 */
closestWithId(handle: Handle, ids: { has(id: string): boolean }): IdMatch | null {
    for (let h: Handle | null = handle; h !== null; h = _table.parent(h)) {
        const id = _table.stub(h).id;

        if (id !== '' && ids.has(id)) {
            return { handle: h, id };
        }
    }

    return null;
}
```

`_table.stub(h)` throws on an unknown handle, as the modelled `getId` does. Add `type IdMatch` to the file's import from `~/core/DOM` (`:14`).

### The walk — `core/Event.ts`

Add this function inside the namespace, directly above `let baseListener` (`:248`). Import `IdMatch` beside `Handle` (`:5`: `import type { Handle, IdMatch } from "~/core/DOM.js";`).

```typescript
/**
 * Runs the subtree listeners registered for `evnt`'s type on the event
 * target and its ancestors, nearest first. Each step asks the seam for the
 * next element whose id holds a registration, so an ancestor with none
 * costs no seam call. The next step starts from the live parent of the
 * element just matched, read after its listeners ran, so a listener that
 * disposes, moves, adds or removes a registration is seen as a walk that
 * visited every ancestor would see it.
 *
 * @param evnt - The event being dispatched.
 * @param targetHandle - The event target's handle, or `null` when the event has no target.
 * @param subtreeListeners - The type's subtree registrations, keyed by component id, read once per event.
 */
function dispatchToSubtreeListeners(evnt: Event, targetHandle: Handle | null, subtreeListeners: Map<String, CompFunc>): void {
    let handle: Handle | null = targetHandle;

    while (handle !== null) {
        let match: IdMatch | null;

        try {
            match = DOM.source.closestWithId(handle, subtreeListeners);
        } catch {
            // `handle` was released by a disposal that ran synchronously earlier
            // in this same event's dispatch. Only the event target can be in that
            // state here: the exact-target phase may dispose it (a click that
            // disposes its own target, e.g. a tab's close button). Nothing further
            // up can be resolved through this handle, so the walk ends here instead
            // of throwing. Mirrors FocusHistory.isLive's identical guard around a
            // stale focus handle (core/FocusHistory.ts:82-92).
            return;
        }

        if (match === null) {
            return;
        }

        const compFunc = subtreeListeners.get(match.id)!;
        let propagationStopped = false;

        for (let entry of compFunc.listeners) {
            if (!passesButtonFilter(evnt, evnt.type, entry.options?.button)) {
                continue;
            }

            if (applyDisposition(evnt, entry.listener.apply(compFunc.component, [evnt]), entry.options)) {
                propagationStopped = true;
            }
        }

        if (propagationStopped) {
            return;
        }

        try {
            handle = DOM.source.getParentElement(match.handle);
        } catch {
            // The listeners that just ran can have disposed the component that
            // owns `match.handle`, releasing it. Nothing above it can be reached
            // through that handle, so the walk ends here.
            return;
        }
    }
}
```

In `baseListener`, keep lines 296-299 (the `subtreeListenerMap.get(evnt.type)` read and its early return) where they are, after the exact-target phase. Replace lines 301-347 (from `let handle: Handle | null = targetHandle;` through the end of the `while`) with:

```typescript
        dispatchToSubtreeListeners(evnt, targetHandle, subtreeListeners);
```

The listener loop is today's, character for character. The non-null assertion on `get` holds because `closestWithId` has just found `match.id` in the same map and no listener ran in between.

---

## Ordered Implementation Steps

Every path below is under `packages/lib/` unless it starts with `packages/`. Line numbers are at `feature/w3-0-results` (`11ad15eb`). Other wave-3 plans also edit `core/DOM.ts` and `TestDOM.ts`, so find each anchor by the symbol named, not only by its number.

1. **`src/typescript/lib/core/DOM.ts` — the result type.** Add `IdMatch` (see *Public API*) after `TextSelectionRange` (`:1676-1681`).
2. **`src/typescript/lib/core/DOM.ts` — the declaration.** Add `closestWithId` with its JSDoc to `DOMSource` directly after `getParentElement` (`:1426`).
3. **`src/typescript/lib/core/DOM.ts` — the production read.** Add `ProductionDOMSource.closestWithId` (see *Internal Structure*) directly after `ProductionDOMSource.getParentElement` (`:2685-2689`). Check: `npm run typecheck` passes.
4. **`src/typescript/lib/core/index.ts:14`** — add `IdMatch` to the `export type { … } from '~/core/DOM.js'` list.
5. **`tests/dom/TestDOM.ts`** — add `type IdMatch` to the import at `:14`; add `ModelledDOMSource.closestWithId` after `getParentElement` (`:1341-1343`). Check: `npm -w packages/lib run typecheck:test` passes.
6. **Create `tests/dom/closestWithId.test.ts`** with cases C1–C9 and M1–M2 of *Expected Behaviour*. Use `// @vitest-environment jsdom` and the two-`describe` layout of [`tests/dom/isRenderedVisible.test.ts`](packages/lib/tests/dom/isRenderedVisible.test.ts). Check: the file passes.
7. **Pin today's dispatch rules before touching `Event.ts`.** Add EV5 to `tests/dom/event-subtree-reentrant-dispose.test.ts`. Create `tests/dom/event-subtree-walk.test.ts` with W1–W6 (jsdom; copy that file's `buildChain` and `dispatchAndCatch` helpers). Check: all of them **pass** on the unchanged `Event.ts`. A failure here means the case is wrong, not the code; fix the case.
8. **Write the economy cases, expecting them to fail.** Add W7 to `tests/dom/event-subtree-walk.test.ts`. Add the `describe('Modelled event delivery — subtree walk seam economy')` block S1–S6 to `tests/dom/events.test.ts`, adding `vi` to its `vitest` import. Check: W7 and S1–S5 **fail** (the walk still reads per level). S6 has no subtree registration of its type, so it passes already.
9. **`src/typescript/lib/core/Event.ts`** — add `dispatchToSubtreeListeners` and replace the walk (see *Internal Structure*); import `IdMatch`. Checks:
   - `npx vitest run tests/dom tests/unit/core/Event.test.ts` from `packages/lib` passes, W7 and S1–S6 included.
   - EV1–EV4 are unmodified: `git diff --stat -- tests/dom/event-subtree-reentrant-dispose.test.ts` shows additions only.
   - `grep -n 'DOM.source.getId(handle)' src/typescript/lib/core/Event.ts` has no match.
   - `grep -n 'closestWithId' src/typescript/lib/core/Event.ts` has exactly one match.
   - `grep -rn 'closestWithId(' src tests/dom/TestDOM.ts` finds four lines: the declaration, the production method, the `Event.ts` call and the modelled method.
10. **`docs/concepts/dom-seams.md:63`** — in the traversal list `(\`querySelector\` / \`contains\` / \`closest\` / \`matches\` / \`getParentElement\`)`, replace `` `closest` `` with `` `closestWithId` ``.[^closest-doc]
11. **`docs/reference/changelog/next.md`, *Breaking changes → Core*** (`:10`), a new last bullet in that section: "**`DOMSource` gains one required member: `closestWithId()`.** It returns the nearest element at or above a handle whose `id` is in a given set, climbing inside the seam; `Event`'s subtree dispatch now finds each registered ancestor with one call instead of reading every ancestor's id and parent. Only a consumer implementing its own `DOMSource` is affected."
12. **`packages/qa/README.md:474`**, the `g20.walk-dose` row — append to its last cell: "On a build with `event-dispatch-walk` the walk reads neither method per level, so this arm doses only the exact-target `getId` and one `getParentElement` per matched ancestor, and no longer bounds the walk."
13. **Commit steps 1–12** through the commit skill.
14. **`Event.init()`, in its own commit.**
    - Check first: `grep -rn 'Event\.init\b' packages/ --include=*.ts --include=*.md` finds nothing.
    - Delete the function and its JSDoc (`src/typescript/lib/core/Event.ts:370-375`).
    - In `docs/reference/changelog/next.md`, *Breaking changes → Core*, add: "**`Event.init()` is removed.** It was a documented no-op with no caller. Delete any call to it; there is no replacement. See [Migration](/reference/migration/next) for the full note."
    - In `docs/reference/migration/next.md`, add a section `## \`Event.init\` is removed` after the last section, in the shape of `## \`Slider\`'s \`showTicks\` option and accessors are removed` (`:8`). **What changed and why:** it initialised nothing — the event system installs its window listeners on the first registration of each type — and nothing called it; pre-1.0 dead public surface is cut. **Who needs to act:** any `Event.init()` call is now a compile error; delete the line. Before/after: `Event.init();` → nothing.
    - Check: `npm run typecheck`.
15. **Run the full offline verification** (*Verification* 1–5).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/src/typescript/lib/core/index.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Event.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Create | `packages/lib/tests/dom/closestWithId.test.ts` |
| Create | `packages/lib/tests/dom/event-subtree-walk.test.ts` |
| Modify | `packages/lib/tests/dom/event-subtree-reentrant-dispose.test.ts` |
| Modify | `packages/lib/tests/dom/events.test.ts` |
| Modify | `packages/lib/docs/concepts/dom-seams.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |
| Modify | `packages/qa/README.md` |

---

## Expected Behaviour

Every case below is unit-testable except the last section. The jsdom files use the real production seam (`// @vitest-environment jsdom`), as `event-subtree-reentrant-dispose.test.ts` does; the offline cases use `installTestDOM`, as `events.test.ts` does.

### `closestWithId` — `tests/dom/closestWithId.test.ts`

`ProductionDOMSource` (jsdom). Build raw elements under `document.body`, call through `const source = new ProductionDOMSource()` and `source.intern(el)`, and clear `document.body` after each case.

| Case | Setup | Call | Result |
|---|---|---|---|
| C1 | `a#x > b` | from `a`, ids `{x}` | `{ handle: intern(a), id: 'x' }` — the start node itself counts |
| C2 | `a#x > b#y > c` | from `c`, ids `{x, y}` | `{ handle: intern(b), id: 'y' }` — the nearest wins |
| C3 | `a#x > b > c` | from `c`, ids `{z}` | `null` |
| C4 | `a > b` (neither has an id) | from `b`, ids `{''}` | `null` — an empty id never matches |
| C5 | `a#x` containing a text node `t` | from `intern(t)`, ids `{x}` | `{ handle: intern(a), id: 'x' }` |
| C6 | — | from `intern(document)` and from `intern(window)`, ids `{x}` | `null` both, no throw |
| C7 | `const sink = new ProductionDOMSink()`; `h = sink.createElement('div')`, then `sink.release(h)` | from `h`, ids `{x}` | throws |
| C8 | `host#x` with an open shadow root holding `s` | from `intern(s)`, ids `{x}` | `null` — the climb stops at the top of the shadow tree, where `parentElement` does |
| C9 | `a#x > b` | from `b`, with a `Map([['x', 1]])`, a `Set(['x'])`, and `{ has: (id) => id === 'x' }` | the same match for all three |

`ModelledDOMSource` (after `installTestDOM(CONFIG)`), with a chain built by `root.getElement(true); root.addComponent(mid); mid.addComponent(leaf)`:

| Case | Call | Result |
|---|---|---|
| M1 | from `leaf.getElement()`, ids `{mid.getId()}` | `{ handle: mid.getElement(), id: mid.getId() }` |
| M2 | from `leaf.getElement()`, ids `{'nope'}`; then from an unminted handle `9999999` | `null`; then throws |

### Dispatch economy — `tests/dom/events.test.ts`, new `describe`, offline

Each case uses a fresh `uniqueType()`, builds a chain of components with `addComponent` (the deepest is the target), registers the listeners, then spies with `vi.spyOn(DOM.source, 'closestWithId' | 'getParentElement' | 'getId')` just before one `DOM.sink.dispatchEvent(target, makeEvent(target, type))`. The block's `afterEach` calls `vi.restoreAllMocks()` before `DOM.reset()`. "Levels above" counts from the target: 1 is its parent.

| Case | Chain | Registrations of the type | Listeners that run | `closestWithId` | `getParentElement` | `getId` |
|---|---|---|---|---|---|---|
| S1 | 20 deep | one subtree listener on a component outside the chain | none | 1 | 0 | 0 |
| S2 | 12 deep | subtree, 2 levels above | that one | 2 | 1 | 0 |
| S3 | 12 deep | S2 plus an exact listener on the target | exact, then subtree | 2 | 1 | 1 |
| S4 | 12 deep | subtree 2 and 5 levels above, both return nothing | nearer, then farther | 3 | 2 | 0 |
| S5 | 12 deep | as S4, the nearer returns `true` | the nearer only | 1 | 0 | 0 |
| S6 | 12 deep | an exact listener on the target only | exact | 0 | 0 | 1 |

S1 is slice 03's probe P3, and S2 is its P2.

### Dispatch rules preserved — jsdom

`tests/dom/event-subtree-reentrant-dispose.test.ts`: EV1–EV4 unchanged, plus:

- **EV5** — chain `outer > middle > target`. `middle`'s subtree listener calls `outer.dispose()`. `outer`'s subtree spy does not run, and no error is reported.

`tests/dom/event-subtree-walk.test.ts`. Every case reports no error: wrap each dispatch in a `window` `error` listener, as `dispatchAndCatch` does. W1–W3 dispatch on the chain's target element with `dispatchAndCatch`; W4–W7 dispatch on the node they name.

- **W1 — added mid-dispatch.** Chain `outer > middle > target`. `middle`'s subtree listener calls `Event.addSubtreeListener(outer, type, spy)`. `spy` runs once, in the same dispatch.
- **W2 — removed mid-dispatch.** As W1, but `outer` starts registered and `middle`'s listener removes it. `outer`'s listener does not run.
- **W3 — moved mid-dispatch.** Chain `outerA > inner > target`, plus a separate `outerB` under `document.body`. `outerA`, `inner` and `outerB` each have a subtree listener that records its name. `inner`'s listener also moves `inner`'s element under `outerB`'s (`document.getElementById(outerB.getId())!.appendChild(document.getElementById(inner.getId())!)`). Recorded order: `['inner', 'outerB']`.
- **W4 — text-node target.** A text node appended inside a component's element, dispatched on directly. The component's subtree listener runs once.
- **W5 — shadow target.** A raw host `div` inside a component's element, with an open shadow root holding a `span`. A `MouseEvent(type, { bubbles: true, composed: true })` dispatched on the `span` runs the component's subtree listener once: at the window the target is the host.
- **W6 — window and document targets.** With a subtree listener registered for `type`, `window.dispatchEvent(new Event(type))` and `document.dispatchEvent(new Event(type, { bubbles: true }))` run no listener.
- **W7 — nothing on the path is interned.** A component `host` under `body` (`buildChain(1)`), with five raw `div`s nested inside its element and a subtree listener on `host`. Dispatching on the innermost `div` runs the listener once, and `_handleRegistrySize()` (from `~/core/DOM`) grows by exactly 1: the target's own intern. Today it grows by at least 5: the target and the four raw `div`s above it.

W1–W6 and EV5 pass before and after the change. W7 fails before it.

### Manual — in-engine (the orchestrator)

The A/B in *Verification*: seam counters fall as tabled, geometry is unchanged, frame time is flat. jsdom has no frame loop, so frame time and the engine's own event sequence cannot be checked offline.

---

## Verification

1. `npm run typecheck`, `npm -w packages/lib run typecheck:test`, `npm test`, `npm run lint`.
2. `npm run build:lib`, then `npm -w packages/qa run typecheck` and `npm -w packages/qa run test`. A16 still passes: it tests the ablation's wrapping, not the walk.
3. `npm run docs:api`: the 14 warnings `master` already has, and no new one. `IdMatch` is exported, so the `{@link DOMSource.closestWithId}` in its JSDoc resolves.
4. `npm -w packages/lib run docs:llms:check` passes (it checks classes; nothing here adds one).
5. The greps of steps 9 and 14.

### In-engine A/B — the orchestrator runs this, never the implementer

Every run opens a full-screen window; run it only with the user's go-ahead. `BASE_SHA` is the commit this plan's first commit sits on, which the implementer records in the plan's implementation notes.[^base] From the root of the checkout that holds the fix, so both arms load the same page:

```sh
git worktree add .worktrees/_edw-base <BASE_SHA> --detach
ln -sfn "$PWD/node_modules" .worktrees/_edw-base/node_modules
(cd .worktrees/_edw-base/packages/lib && npm run build:lib)
export QA_WT_LIB="$PWD/.worktrees/_edw-base/packages/lib"
npm run build:lib
```

Then this script, saved outside the repository and run from the repository root. `clh` and `cdh` are the W3.0 cells that bounded G20 (batch `b10`). `ffyh` is new: its `type` phase leaves the first decorated field in error, then `hover` sweeps the header grid, outside every decorator.[^form-cell]

```bash
#!/bin/bash
# event-dispatch-walk in-engine A/B: the base build (wt) against the fix
# (main), one session. Each cell runs base-a, fix-1, base-b, fix-2, base-c:
# the base arm at both ends and in the middle, each arm's runs symmetric
# about the cell's centre, so a linear drift cancels. Every run opens a
# full-screen window.
set -u
RUNQA=packages/qa/runqa.sh
SESSION=${EDW_SESSION:-s1}
FLAGS='work=1&seam=1&geom=1'

wtab() {
    local cell=$1 params=$2 step build arm rep

    for step in wt:base:a main:fix:1 wt:base:b main:fix:2 wt:base:c; do
        IFS=: read -r build arm rep <<< "$step"
        "$RUNQA" "edw$SESSION-$cell-$arm-$rep" "$build" "$params&$FLAGS" || exit 1
    done
}

wtab clh 'panel=chart-line&drive=hover'
wtab cdh 'panel=chart-dashboard&n=50&drive=hover'
wtab ffyh 'panel=form-flat&type=text&drive=type,hover'
```

15 runs, about 4 minutes. A stopped script is re-run for the failing cell under a new `EDW_SESSION`. Afterwards, `git worktree remove --force .worktrees/_edw-base`.

**Reading a cell.** `python3 packages/qa/bin/qa-table.py packages/qa/results edws1-<cell>- --seam`. The first row, `base-a`, is the geometry reference. Read `getParentElement`, `getId` and `closestWithId` from the `seam.source/unit` line under each row. The scored phase is phase 0 for `clh` and `cdh` and phase 1 (`hover`) for `ffyh`. **bracket** is the largest minus the smallest `avg` of the three `base` rows; **Δms** is the mean of the two `fix` rows minus the mean of the three `base` rows. `win` is Δms < −bracket, `regress` is Δms > +bracket, `flat` otherwise. `qa-ab.py` does not apply: it scores ablation arms, and a `fix` arm has no `abl=`.

**Expected readings**, per unit. The **walk counter** is `getParentElement + getId + closestWithId`. The base arm should repeat W3.0's plain counts unless a change stacked under `BASE_SHA` moved the hover path; the A/B stands on its own base rows either way.[^counts]

| Cell | Phase | Base ms | Fix ms | `getParentElement` base → fix | `getId` base → fix | `closestWithId` fix | Walk counter base → fix |
|---|---|---|---|---|---|---|---|
| `clh` | 0 `hover` | ≈ 21.9 | flat | 5.99 → ≈ 1.00 | 5.99 → 0.00 | ≈ 2.00 | 11.98 → ≈ 3.0 (−75%) |
| `cdh` | 0 `hover` | ≈ 27.2 | flat | 8.17 → ≈ 1.02 | 9.20 → ≈ 1.03 | ≈ 2.04 | 17.37 → ≈ 4.1 (−76%) |
| `ffyh` | 1 `hover` | not measured before (≈ 17–18) | flat | 6–7 per walked event (≥ 5.0 per unit) → 0.00 | base `getParentElement` + the exact-target reads (≈ 1) → the exact-target reads alone | one per walked event (≈ 1) | ≈ 15 → ≈ 2 (≈ −85%) |
| `ffyh` | 0 `type` | — | flat | equal | equal | 0 | equal |

The removed calls — about 9 per unit on `clh` and 13 on `cdh` — are the walk the dose arm bounded, less the one call per matched ancestor the fix keeps.

**Pass criteria:**

1. **Geometry `=` on every row of every cell, both `ffyh` phases included.** This is the gate; any `DIFF` fails the change, whatever the counters say.
2. **The form cell reached its path.** `ffyh`'s base rows read `getParentElement` ≥ 5.0 per unit in phase 1. A lower reading means no decorator was in error during the hover: the cell is void; check the `type` phase before reading further.
3. **Work avoided.** The walk counter falls by at least 70% on `clh` and `cdh` and at least 80% on `ffyh` phase 1. `getId` on `clh` reads 0.00; `getParentElement` on `ffyh` phase 1 reads at most 0.05.
4. **Nothing else moved.** Between the arms, per phase, every other `seam.source` counter and every `seam.sink` counter is equal within 1%, and so is `work/u`. `intern` in particular stays at its base value (≈ 1.03 on `clh`, ≈ 1.05 on `cdh`).
5. **Time.** No cell reads `regress`. `flat` is the expected reading everywhere; this plan claims no millisecond gain.

If criteria 1–4 hold and a cell reads `regress`, stop and investigate before merging: a one-call climb cannot cost more than the per-level walk it replaces.

Record the readings in `plans/research/render-review-2026-09-15/`, beside `96-w3-0-bounding-sweep.md`.

---

## Documentation Impact

- **`packages/lib/docs/concepts/dom-seams.md:63`** — the traversal list names `closestWithId` (step 10).
- **`packages/lib/docs/reference/changelog/next.md`** — two *Breaking changes → Core* bullets: the new `DOMSource` member (step 11) and `Event.init()`'s removal (step 14).
- **`packages/lib/docs/reference/migration/next.md`** — the `Event.init` section (step 14). The new `DOMSource` member gets no migration section, following 0.8.0 and 0.9.0.
- **`core/index.ts`** exports `IdMatch`; TypeDoc renders it and the new `DOMSource` member on the generated API pages. Neither JSDoc links an internal symbol.
- **`packages/qa/README.md`** — the `g20.walk-dose` note (step 12).
- `docs/concepts/events.md` describes the dispatch rules, not their cost, and needs no change. `llms.txt` lists no seam members and needs no change.

---

## Potential Challenges

- **Other wave-3 plans edit `core/DOM.ts` and `TestDOM.ts`** (G08, G18). Place each insertion by the neighbouring symbol, not by line number.
- **A partial `DOMSource` double would stop subtree dispatch silently.** The walk's `try`/`catch` would swallow the "not a function" error, as it swallows a released handle. The repository's three source wrappers (`TextBatchMeasure.test.ts`, `BorderWidths.test.ts`, `qa/tests/panels.test.ts`) all build on the real source and inherit the method; TypeScript requires it of every `implements DOMSource`.
- **The modelled source has no shadow roots, window or document nodes.** C6, C8, W5 and W6 therefore run in the jsdom files against the production seam, not in `events.test.ts`.
- **W3 moves a live element outside the seam.** Test code may touch raw DOM, as EV1–EV4 already do; `src/` may not.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Event.ts`](packages/lib/src/typescript/lib/core/Event.ts) — the walk (`:296-347`), the exact-target phase (`:274-290`), `passesButtonFilter` (`:163`), `applyDisposition` (`:197`), `purgeComponent` (`:703`), `init` (`:370-375`).
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — the precedents: `DOMSource` (`:1073`), `contains` (`:1367`, `:2653`), `getParentElement` (`:1426`, `:2685`), `isRenderedVisible` (`:1474`, `:2729`), `DocumentSelectionRange` (`:1659`); `HandleRegistry.intern`/`resolve` (`:234`, `:257`); `_handleRegistrySize` (`:316`).
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — `ModelledDOMSource` (`:982`), its `contains` (`:1296`), `getParentElement` (`:1341`), `isRenderedVisible` (`:1370`), `getId` (`:1423`).
- [`packages/lib/tests/dom/event-subtree-reentrant-dispose.test.ts`](packages/lib/tests/dom/event-subtree-reentrant-dispose.test.ts) — EV1–EV4 and the jsdom helpers W1–W7 copy.
- [`packages/lib/tests/dom/events.test.ts`](packages/lib/tests/dom/events.test.ts) — the offline delivery cases the economy block joins.
- [`packages/lib/tests/dom/isRenderedVisible.test.ts`](packages/lib/tests/dom/isRenderedVisible.test.ts) — the layout of `closestWithId.test.ts`.
- [`packages/lib/src/typescript/lib/overlay/Tooltip.ts:635-641`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L635) — the covering tooltip's subtree registrations.
- [`packages/qa/src/harness/ablations.ts:1647`](packages/qa/src/harness/ablations.ts#L1647) — `g20.walk-dose`.
- [`plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L220) — the W3.0 reading this plan acts on.

---

## Non-Goals

- **Narrowing registrants.** `SplitGutter`, `Accordion`, `ToolBar`, `FileDropZone`, `Button`, the charts and the covering tooltip keep their subtree registrations (see *The registrants stay as they are*).
- **Other ancestor walks.** `Body.onSubtreeClick`, `Scrollbar.isScrollbarTarget`, `CodeEditor.isForeignWheelTarget` and `Popover.collectScrollAncestors` climb with `getParentElement` too. They run per click or wheel, not per `mousemove`, and match on class selectors or row identity, not on registered ids.
- **Slice 03 F03.7 and F03.11.** `baseViewportListener`'s entry arrays and the `Map<String, …>` key type are behaviour-neutral cleanups that no counter in any cell reads.
- **The exact-target phase.** Its one `getId` per event is the precedent this plan follows, and it stays.
- **A millisecond gain.** None is claimed or expected.
- **Changing `g20.walk-dose` or its test.** It stays the W3.0 record; only its README entry gains a note.

---

## Notes

[^precedent]: `isRenderedVisible` is the closest precedent: a question about an element *and its ancestors*, answered by a loop over `parentElement` inside `core/DOM.ts` in one seam call. Its modelled twin climbs `_table.parent` the same way, which is how `closestWithId` is modelled. `contains` is a second climb inside the seam. `Event` already routes every event by component id: the exact-target phase reads one id and looks it up in the type's map. `closestWithId` asks the same question — "is this id registered?" — at each level, without a seam call per level. `DocumentSelectionRange` is the precedent for a structured seam result carrying a `Handle`, exported from the `core` barrel.

[^live-climb]: Slice 03 (F03.3) and the synthesis (X8) proposed `DOMSource.getAncestorIds(handle): readonly string[]`: one call returning a snapshot of every ancestor id, and no `try`/`catch`. It was rejected because a snapshot changes behaviour. EV2 pins that an outer listener does not run once an inner listener has disposed its own component; with a snapshot it would, so the test would have to be restated. When a listener moves its element under another registered ancestor (W3), the old chain's listeners would run and the new chain's would not. The live climb keeps both, and costs one extra seam call per matched ancestor (the `getParentElement` restart), which is small: most paths have zero or one match. The two `catch` blocks still guard what they guarded: a target disposed by the exact-target phase (EV1), and a matched component disposed by its own listeners (EV2).

[^work-not-ms]: W3.0's dose arm ran the walk twice. On `clh` it read 22.12 ms against plain 21.94 (bracket 0.57); on `cdh` 27.63 against 27.22 (bracket 0.75): both inside the spread. The walk's `getParentElement` + `getId` were 11.98 of 15.92 seam reads per `clh` unit and 17.37 of 22.01 per `cdh` unit. Each per-level pair costs two handle-registry resolves (a `Map.get` each, plus a `WeakRef.deref` for an interned node), one intern (a `WeakMap.get`, plus a `WeakRef` and a `FinalizationRegistry.register` on the first sight of a node), and two seam round trips. After the change only the native `id` and `parentElement` reads remain, inside one call. The seam round trips matter most for the transport `ARCHITECTURE.md` keeps the seam ready for: a worker could not afford one per ancestor per `mousemove`.

[^registrants]: The synthesis's ordering constraint 3 said narrowing one registrant leaves the walk in place, because a type's walk disappears only when that type has no subtree registrant left anywhere. With `closestWithId` a registration no longer multiplies the cost by the depth: a path with no registered ancestor costs one call however many registrants exist elsewhere. Narrowing would touch about ten component files to save one call per event. `Accordion`'s proposed switch to `mouseenter`/`mouseleave` would also contradict `ARCHITECTURE.md`'s *Hover detection uses `mouseover` / `mouseout`*, which the synthesis itself flagged as a risk.

[^lookup-param]: The type's subtree map is already the per-type set of registered ids, and every register, unregister, reindex and purge keeps it current. A separate `ReadonlySet<string>` would need the same four updates. `Map<String, CompFunc>` satisfies `{ has(id: string): boolean }` as it is, and would still if slice 03's F03.11 later changes the key type to `string`. A future worker transport would send the map's keys with the call.

[^no-early-stop]: One option was to count the registered ids a walk has matched and stop once it had matched all of them. It is unsafe: a listener that removes an already-visited registration shrinks the map, and the count can reach the new size while a farther registered ancestor is still unvisited. Example: three registrants A (visited), B and C on the path; A's listener removes itself, the size drops to 2, the walk matches B, the count reaches 2, and C is skipped. It would also save nothing at the seam, because the climb from the last match to the root is already one call.

[^dose-after]: The ablation is the W3.0 record, and A16 checks its wrapping, not the walk, so both stay valid. Applied to a fixed build it still doubles every `getParentElement` and `getId` call, but the walk no longer makes them per level. Its reading would then be the cost of the few calls that remain, which is why the README gains a note rather than the ablation a guard.

[^breaking]: `changelog/0.8.0.md:10-14` and `changelog/0.9.0.md:42-47` list each new required `DOMSource` member under *Breaking changes → Core* with the sentence "Only a consumer implementing its own `DOMSource` is affected", and neither release has a migration section for them.

[^init]: The user's rule for pre-1.0 code is that a public member with no callers is deleted, in its own commit. The synthesis lists F03.10 under G20, and G29 asks each dead-code deletion to ride with the group already editing that file. A search of `typescript-ui/packages`, Loom's `src` and SQLAdmin for `Event.init` found no caller.

[^closest-doc]: `DOMSource` has never had a `closest` member; the list at `dom-seams.md:63` names one that does not exist. `closestWithId` takes its place in the same list.

[^base]: Wave 3 stacks each plan on the tip of the one before. The base arm must carry every change the fix arm carries except this plan's. So it is built from the parent of this plan's first commit, not from `master`.

[^form-cell]: W3.0 had no cell for this path. With no decorator in error, `form-flat` registers no subtree `mousemove`, so a hover makes no walk for it. The `type` driver types 150 characters into the first decorated field, past its 20-character limit, then deletes them all, and the field's check shows its "Required" error for the empty text. So the decorator's covering tooltip holds four subtree registrations through the whole `hover` phase. The header grid lies outside every decorator, so each `mousemove` there walks to the root and matches nothing — one seam call after the change. Criterion 2 checks that the error was really up.

[^counts]: A jsdom probe mounted the three panels through the QA app's `mountPanel` and counted the walk for single dispatched events. A `mousemove` on a `chart-line` mark climbs six levels (mark, `g`, `svg`, the chart, `body`, `html`) with one match, the chart: 6 `getId` + 6 `getParentElement`, matching W3.0's 5.99 + 5.99 per unit. On `chart-dashboard` it climbs eight levels with one match, plus one exact-target `getId`: 9 + 8, matching 9.20 + 8.17. On `form-flat` with a decorator in error, a `mousemove` on a header field's `<input>` climbs seven levels with no match (7 + 7); a `pointermove` there costs one exact-target `getId`. So one walked event per unit gives, after the fix, 2 `closestWithId` + 1 `getParentElement` on the charts, and 1 `closestWithId` and no `getParentElement` on the form. The form's 6–7 levels allow for hits on the header grid's own element, one level shallower than a field. Boundary crossings add walked `pointerover`/`pointerout`/`mouseover`/`mouseout` events, each also matching nothing on the header's path; they raise both arms' counts together and leave the fall near 85%.

---

## Implementation Notes

### Anchors were found by symbol, not by line number

Every line number in the plan is at `feature/w3-0-results` (`11ad15eb`), and
this branch starts from `586d2102`, eleven wave-3 plans later. `core/DOM.ts`
had drifted about 200 lines at `DOMSource`, 250 at `getParentElement` and 290
at `ProductionDOMSource.getParentElement`; `core/Event.ts`'s walk sat at
`:300-345` rather than `:301-347`. The plan anticipated this and says to place
each insertion by the neighbouring symbol, which is what was done. No API the
plan names had been renamed or removed, and no assumption it makes about the
dispatcher had changed.

### `Event.init()`'s removal is two commits, not one

The plan's step 14 asks for the deletion "in its own commit" and lists its
changelog and migration edits alongside it. The `commit` skill's buckets put
source and docs in separate commits, one of each per functionality, so the
removal lands as `Remove Event.init, a documented no-op with no callers`
followed by `Document Event.init's removal in the changelog and migration
notes`. Both are separate from the `closestWithId` pair, which is what step 14
was asking for.

### Offline verification, as run

`npm run typecheck`, `npm -w packages/lib run typecheck:test`, `npm test`
(8392 passed, 2 todo) and `npm run lint` are clean. `npm run build:lib`, then
`npm -w packages/qa run typecheck` and `npm -w packages/qa run test` (344
passed, A16 included) are clean. `npm run docs:api` reports 0 errors and 14
warnings — the same 14 `master` already has, none of them touching `IdMatch`,
`closestWithId` or `DOMSource`. `npm -w packages/lib run docs:llms:check`
reports 0 unaccounted for. The greps of steps 9 and 14 all read as the plan
predicts: no `DOM.source.getId(handle)` left in `Event.ts`, exactly one
`closestWithId` there, four `closestWithId(` lines across `src` and
`TestDOM.ts`, and no `Event.init` anywhere under `packages/`.

The red-then-green sequence the plan asks for was observed: W1–W6 and EV5 pass
on the unchanged `Event.ts`; W7 failed at `expected 6 to be 1` (the target plus
the four intermediate `div`s plus `<html>`, exactly the interning the per-level
walk does) and S1–S5 failed with `closestWithId: 0`, while S6 passed already.
All seven pass after the change. `closestWithId.test.ts` was also checked
against a tree with `core/DOM.ts` and `TestDOM.ts` stashed, where 10 of its 11
cases fail with "closestWithId is not a function"; C7 and M2 then assert
`/is not registered/` rather than a bare `toThrow()`, so neither can pass on a
missing method.

`npm -w packages/qa run typecheck` needs an untracked
`node_modules/@jimka/typescript-ui -> ../../packages/lib` symlink inside the
worktree, or it resolves the package up to the main checkout's stale build and
fails on unrelated symbols. The symlink is ignored by `.gitignore` and is not
committed.

No demo or example surface applies: the change adds a seam read and rewrites a
dispatcher's internal walk, with no component or screen to exercise it.

### Pending — the in-engine A/B has not been run

*Verification*'s in-engine A/B is the one step left, and it is the user's to
run: every `runqa.sh` run opens a full-screen WebKitGTK window. `BASE_SHA` is
**`586d21023c7317cd0b12ee8b92a579a9c3eeb26d`** — the parent of this branch's
first commit, i.e. the tip of `feature/environment-read-caching`, which is the
eleventh wave-3 plan stacked under this one. It is *not*
`git merge-base … master`, which is far behind this stack and would put every
other wave-3 change into the delta.

From the root of the checkout that holds the fix:

```sh
git worktree add .worktrees/_edw-base 586d21023c7317cd0b12ee8b92a579a9c3eeb26d --detach
ln -sfn "$PWD/node_modules" .worktrees/_edw-base/node_modules
(cd .worktrees/_edw-base/packages/lib && npm run build:lib)
export QA_WT_LIB="$PWD/.worktrees/_edw-base/packages/lib"
npm run build:lib
```

Then the `wtab` script in *Verification*, unchanged — 15 runs over `clh`, `cdh`
and `ffyh`, about 4 minutes — read with
`python3 packages/qa/bin/qa-table.py packages/qa/results edws1-<cell>- --seam`
against the five pass criteria, and `git worktree remove --force
.worktrees/_edw-base` afterwards. The readings go in
`plans/research/render-review-2026-09-15/`, beside `96-w3-0-bounding-sweep.md`.

The offline seam-economy cases S1–S6 and W7 pin the same counts the A/B is
expected to measure, so what the A/B adds is the geometry gate (criterion 1),
the `ffyh` decorator-in-error path that jsdom cannot drive, and the flat frame
time this plan claims.
