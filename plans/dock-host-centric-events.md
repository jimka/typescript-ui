# Host-Centric Dock Lifecycle Events — Implementation Plan

## Overview

`Dock` ([src/typescript/lib/overlay/Dock.ts](../src/typescript/lib/overlay/Dock.ts)) emits a panel-lifecycle event set — `"attach" | "detach" | "focus" | "close"` ([Dock.ts:80](../src/typescript/lib/overlay/Dock.ts#L80)) — whose `"attach"`/`"detach"` semantics are *tiled-tree-centric* and **path-dependent**. `"attach"` is derived only inside `reconcileLocations` ([Dock.ts:614](../src/typescript/lib/overlay/Dock.ts#L614)), which runs only during a sweep; `"detach"` is emitted *eagerly* in `onPanelDetached` ([Dock.ts:997](../src/typescript/lib/overlay/Dock.ts#L997)), the handler for `Tab`'s `"detached"(window)` event. Because re-docking a float by dropping its tab onto an **existing dock tab bar** is handled entirely inside `Tab._onBarDockRequested` → `Tab.dockComponent` ([Tab.ts:1012](../src/typescript/lib/layout/Tab.ts#L1012), [Tab.ts:1716](../src/typescript/lib/layout/Tab.ts#L1716)) — which never calls back into `DockRegion` and so never schedules a sweep — that re-dock path fires **no `attach`**, only a `focus`. Dropping on a region body/edge *does* fire `attach`. The event is therefore unreliable.

This plan redesigns the contract to be **host-centric** and fixes the missing-attach bug as one change. A panel is always hosted somewhere `Dock`-managed: the *tiled tree* (the main dock) or a *float window*. `"attach"` fires whenever a panel **enters** a host, `"detach"` when it **leaves** one; a tear-off is `detach`(tiled) then `attach`(float), a re-dock is `detach`(float) then `attach`(tiled), and a move *within* the same host is silent. `DockPanelEvent` ([Dock.ts:88](../src/typescript/lib/overlay/Dock.ts#L88)) gains a host field so a listener can tell *which* host the panel entered or left. The fix unifies both emissions into a single host-diff reconcile keyed off a per-panel **host-identity ledger** (replacing the `"docked"|"floating"` ledger `_panelLocation`), and guarantees a sweep runs after the one currently-missing trigger — the tab-bar merge — by adding a new `Tab` event emitted from `_onBarDockRequested` and wiring it to `requestSweep`.

Touches: [Dock.ts](../src/typescript/lib/overlay/Dock.ts) (reconcile rewrite, payload field, new wiring, removed eager detach, JSDoc), [Tab.ts](../src/typescript/lib/layout/Tab.ts) (new event), [MiscPanel.ts](../src/typescript/MiscPanel.ts) (demo logging), the overlay barrel ([src/typescript/lib/overlay/index.ts](../src/typescript/lib/overlay/index.ts)), and the curated doc page ([docs/components/Dock.md](../docs/components/Dock.md)).

---

## Architecture Decisions

### Payload shape: add `window: AbstractWindow | null`

`DockPanelEvent` gains one field: `window: AbstractWindow | null`, where `null` denotes the tiled tree / main dock and a non-null value is the float window the panel entered or left. Chosen over a separate `host`/`location` string discriminator because:

- The host *is* already a first-class object in this code — `AbstractWindow` is imported and the whole sweep already reasons in terms of windows (`floatWindowsHoldingFrames`, `ownedFloatWindows`, `windowContains`). A `null`-vs-`AbstractWindow` field is the literal value the reconcile computes; a string discriminator would throw that object away and force the listener to re-derive it.
- A listener that wants the host's title for display reads `event.window?.getTitle() ?? "(tiled)"` directly ([AbstractWindow.getTitle()](../src/typescript/lib/overlay/AbstractWindow.ts#L461)) — the exact thing the demo needs.
- `null` is unambiguous: there is exactly one tiled tree per `Dock`, so it needs no identity beyond "not a float".

`"close"` keeps `window: null` in its payload too (uniform interface) — semantically a close is a destroy, not a host transition, but the field is always present so the interface stays flat. `"focus"`'s payload carries the panel's *current* host window (or `null` if tiled), computed from the same ledger lookup.

`AbstractWindow` is already in scope ([Dock.ts:5](../src/typescript/lib/overlay/Dock.ts#L5)) and is a public exported type ([overlay/index.ts:5](../src/typescript/lib/overlay/index.ts#L5)), so adding it to a public payload introduces no new export and no cross-bucket link problem.

### Single source of truth: host-diff reconcile, eager detach removed

`reconcileLocations` is rewritten to `reconcileHosts` (rename for clarity; it now diffs hosts, not a boolean location). It replaces `_panelLocation: Map<string, "docked"|"floating">` ([Dock.ts:148](../src/typescript/lib/overlay/Dock.ts#L148)) with a **host-identity ledger** `_panelHost: Map<string, AbstractWindow | null>` — `null` = tiled tree, otherwise the float window. Each sweep, for every registered frame, the new host is derived (see next decision); if it differs from the ledger entry, emit `detach`(old host) **then** `attach`(new host), then write the ledger. The eager `detach` in `onPanelDetached` is **removed** — `onPanelDetached` keeps only its `scheduleSweep()` call so the sweep observes the tear-off and emits both `detach`(tiled) and `attach`(float) itself. This makes `reconcileHosts` the single source of truth and dissolves the path-dependence: every structural change that lands a sweep produces correct paired events regardless of which DnD path drove it.

Ordering within a single panel's transition is `detach` *then* `attach` — the panel left one host and entered another. When a panel's host is *unchanged* across a sweep (internal reorder, internal region move within the same window) the diff is a no-op and the pair stays silent.

### Host derivation reuses the existing window walk

The new host for a frame is derived with the helpers the code already has. A frame is tiled (`host = null`) when `isUnder(root, frame)` ([Dock.ts:1309](../src/typescript/lib/overlay/Dock.ts#L1309)) is true — exactly the current `docked` test. Otherwise it is floating, and its host window is the one float in `floatWindowsHoldingFrames()` ([Dock.ts:596](../src/typescript/lib/overlay/Dock.ts#L596)) whose `windowContains(win, frame)` ([Dock.ts:672](../src/typescript/lib/overlay/Dock.ts#L672)) is true — the same lookup `floatForFrame` ([Dock.ts:1204](../src/typescript/lib/overlay/Dock.ts#L1204)) already performs. A new private `hostForFrame(frame, root): AbstractWindow | null` encapsulates this so both the reconcile and the focus/close payload construction call one place. (`floatForFrame` returns the same value but takes no `root`; `hostForFrame` reuses `floatForFrame` for the floating branch and only adds the tiled-vs-floating decision.)

### New `Tab` event: `"docked"` emitted from `_onBarDockRequested`

`TabEvent` ([Tab.ts:37](../src/typescript/lib/layout/Tab.ts#L37)) gains `"docked"`, emitted from `_onBarDockRequested` ([Tab.ts:1012](../src/typescript/lib/layout/Tab.ts#L1012)) **after** `dockComponent` succeeds, carrying the docked content (`Component`) — symmetric in shape with `"tabclose"`/`"activated"` which already carry a `Component`. `Dock` wires it in `wireRegion` ([Dock.ts:736](../src/typescript/lib/overlay/Dock.ts#L736)) alongside the existing `tab.on("detached", …)`, and in `subscribeFloatWindows` ([Dock.ts:547](../src/typescript/lib/overlay/Dock.ts#L547)) for the `TabWindow` float's internal `Tab`, to a bound handler `onPanelDocked` that simply calls `requestSweep` — mirroring exactly how `"detached"` is wired. `dockComponent` is reachable **only** from `_onBarDockRequested` ([grep: Tab.ts is its sole caller](../src/typescript/lib/layout/Tab.ts#L1016)), so emitting there cannot double-fire from a non-DnD path.

Why a `Tab`-level event rather than calling `requestSweep` some other way: `Dock` must not reach into `Tab`'s internals (ARCHITECTURE: a component must not listen to another component's events through `Event`, and must not call across the named-method surface). The tab-bar merge is a structural change `Tab` owns; the symmetric, in-contract signal is a typed `Tab` event, wired the same way `"detached"` already is. The handler does no diffing of its own — it just lands a sweep, and the host-diff reconcile derives the events. Naming: `"docked"` reads as the structural counterpart of `"detached"` (a tab arrived by drop, vs. a tab left by tear-off), keeping the `Tab` vocabulary symmetric.

### Construction stays silent; `addPanel` routed through the sweep

Today initial `layout` panels are seeded `"docked"` and stay silent in `compileTabs` ([Dock.ts:486](../src/typescript/lib/overlay/Dock.ts#L486)), while `addPanel` emits `attach` **synchronously** ([Dock.ts:249](../src/typescript/lib/overlay/Dock.ts#L249)). Under the new contract:

- **Construction stays silent** (recommended and kept). `compileTabs` seeds `_panelHost.set(id, null)` (tiled) for each initial leaf, so the first sweep's host diff sees no change. The demo wires its listeners *after* construction ([MiscPanel.ts:857](../src/typescript/MiscPanel.ts#L857)), so any construction-time emit would be missed regardless — silence is also the only honest contract.
- **`addPanel`'s synchronous `attach` is removed** and the emission is routed through the sweep for consistency. `addPanel` moves the content into the active region and calls `scheduleSweep()`, but does **not** pre-seed `_panelHost` for the new id (or seeds it as *absent*); the reconcile then sees a transition from "no host on record" to `null` (tiled) and emits `attach`(tiled). This makes `addPanel` and a drop both flow through the one reconcile, so the event for a programmatic add and a dragged-in dock are produced by identical code. The reconcile must treat a *missing* ledger entry as "newly entering a host" and emit `attach` with no preceding `detach` (there was no prior host). This is the same first-appearance logic the close path's ledger-delete relies on (see below).

Trade-off: `addPanel`'s `attach` now fires on the next animation frame rather than synchronously. No current caller depends on synchronous emission (the demo listens post-hoc and only logs), and the gain is one code path for "panel entered a host" instead of two that can drift. This is called out in `## Potential Challenges`.

### Close/detach interplay: ledger delete prevents a phantom detach

`onPanelClosed` ([Dock.ts:952](../src/typescript/lib/overlay/Dock.ts#L952)) and `onFloatClosed` ([Dock.ts:1031](../src/typescript/lib/overlay/Dock.ts#L1031)) delete the frame from `_frames` **and** the ledgers, then emit `"close"`. The host-diff reconcile only iterates `this._frames` and skips ids not in `this._panels` — so a closed panel (frame deleted, registration kept on a tab-✕ close but frame gone) is no longer visited, and no phantom `detach` is produced. The ordering guarantee is therefore: a tab ✕ / float ✕ produces `close` only, because by the time the next sweep runs the frame is already out of `_frames` and the reconcile never sees it. A panel torn off then closed is `detach`(tiled)+`attach`(float) on the tear-off sweep, then `close` when destroyed — two real transitions, never a `detach`+`close` pair for one destruction. The reconcile must iterate `this._frames` (not the ledger) and treat a frame absent from `_frames` as already-gone; `_panelHost` is cleaned alongside `_frames` in both close handlers so a re-`addPanel` of the same id starts with no host on record and re-emits `attach`.

`focus` is untouched in mechanism (`setFocus` ([Dock.ts:1060](../src/typescript/lib/overlay/Dock.ts#L1060)) still gates on `_focusedPanelId`); only its payload gains the `window` field, computed via `hostForFrame`. The host-diff reconcile never touches focus state, so it cannot fight the focus path.

### Conventions honored

Listeners are named bound methods (`onPanelDocked`), not inline arrows (CODE_CONVENTIONS: listeners reference a named function). The new `Tab` event follows the existing `on`/`off`/`emit` overload + `ListenerBag<TabEvent>` shape ([Tab.ts:1941](../src/typescript/lib/layout/Tab.ts#L1941)–[Tab.ts:2015](../src/typescript/lib/layout/Tab.ts#L2015)). No new DOM property, no theme token, no `setX` setter — these are custom (non-DOM) events on the `on`/`emit` surface per ARCHITECTURE's event-handling split. No anticipated convention violation.

---

## Public API (TypeScript Signatures)

```typescript
// Dock.ts — payload gains the host field.
export interface DockPanelEvent {
    /** The stable id of the panel (its DockPanelSpec.id). */
    id:      string;
    /** The panel's Dock-owned identity frame. */
    content: Component;
    /**
     * The host the panel entered ("attach"), left ("detach"), or currently
     * occupies ("focus"); `null` denotes the tiled tree / main dock, otherwise
     * the float window. Always `null` for "close" (a destroy, not a transition).
     */
    window:  AbstractWindow | null;
}

// DockEvent union is unchanged in members; only its semantics + JSDoc change.
export type DockEvent = "attach" | "detach" | "focus" | "close";
```

```typescript
// Tab.ts — new structural event.
export type TabEvent = "tabclose" | "empty" | "detached" | "activated" | "docked";

// New on/off/emit overloads, mirroring "detached":
on(event: "docked", listener: (content: Component) => void): this;
off(event: "docked", listener: (content: Component) => void): this; // via the shared off forwarder
protected emit(event: "docked", content: Component): void;
```

```typescript
// Dock.ts — new/renamed private members (signatures only):
private _panelHost: Map<string, AbstractWindow | null>;          // replaces _panelLocation
private hostForFrame(frame: Component, root: Component): AbstractWindow | null;
private reconcileHosts(root: Component): void;                    // replaces reconcileLocations
private onPanelDocked: (content: Component) => void;              // bound; calls requestSweep
```

---

## Internal Structure

`reconcileHosts(root)` per-frame loop (shape, not final code):

```
for (const [id, frame] of this._frames) {
    if (!this._panels.has(id)) continue;        // registration gone -> skip

    const host = this.hostForFrame(frame, root);     // AbstractWindow | null
    const had  = this._panelHost.has(id);
    const prev = this._panelHost.get(id) ?? null;

    if (!had) {
        // first appearance (addPanel / restore): enter, no prior host to leave
        this.emit("attach", { id, content: frame, window: host });
    } else if (host !== prev) {
        this.emit("detach", { id, content: frame, window: prev });
        this.emit("attach", { id, content: frame, window: host });
    }

    this._panelHost.set(id, host);
    // keep _frameRegion update as today (regionForFrame)
}
```

`hostForFrame(frame, root)`:

```
return this.isUnder(root, frame) ? null : this.floatForFrame(frame);
```

Note `floatForFrame` returns `null` for a frame that is neither tiled nor in any open float (mid-teardown). That `null` collides with the tiled sentinel, but a frame that is *not* `isUnder(root)` and in no float is transient — a deleted frame is removed from `_frames` before the next sweep, so the ledger never persists a misleading `null`. Called out in `## Potential Challenges`.

---

## Ordered Implementation Steps

1. **Tab.ts — add the `"docked"` event.** Extend `TabEvent` with `"docked"` ([Tab.ts:37](../src/typescript/lib/layout/Tab.ts#L37)) and its union JSDoc. Add the `on("docked", …)` overload + JSDoc mirroring `"detached"` ([Tab.ts:1965](../src/typescript/lib/layout/Tab.ts#L1965)) and the `emit("docked", content)` overload ([Tab.ts:2011](../src/typescript/lib/layout/Tab.ts#L2011)). In `_onBarDockRequested` ([Tab.ts:1012](../src/typescript/lib/layout/Tab.ts#L1012)), after `dockComponent(content, slot)` succeeds, `this.emit("docked", content)`. → verify: `tsc -p tsconfig.lib.json --noEmit` clean; `grep -n '"docked"' src/typescript/lib/layout/Tab.ts` shows union + overload + emit.

2. **Dock.ts — replace the ledger.** Rename `_panelLocation` → `_panelHost: Map<string, AbstractWindow | null>` ([Dock.ts:148](../src/typescript/lib/overlay/Dock.ts#L148)). Update every reference: `compileTabs` ([Dock.ts:486](../src/typescript/lib/overlay/Dock.ts#L486)) seeds `null`; `onPanelClosed`/`onFloatClosed` delete from `_panelHost`. → verify: `grep -n '_panelLocation' src/` — zero matches.

3. **Dock.ts — add `hostForFrame` and rewrite the reconcile.** Add `private hostForFrame(frame, root)`. Rename `reconcileLocations` → `reconcileHosts` and rewrite per `## Internal Structure`; update the call in `runSweep` ([Dock.ts:534](../src/typescript/lib/overlay/Dock.ts#L534)). → verify: `grep -n 'reconcileLocations' src/` — zero matches.

4. **Dock.ts — add the host field to the payload + all emit sites.** Extend `DockPanelEvent` ([Dock.ts:88](../src/typescript/lib/overlay/Dock.ts#L88)) with `window: AbstractWindow | null`. Update every `this.emit(...)` payload: `"attach"`/`"detach"` in the reconcile (host from the diff), `"close"` in both close handlers (`window: null`), `"focus"` in `setFocus` (host via `hostForFrame(frame, root)` — `setFocus` must obtain `root` via `getRootRegion()`). → verify: `tsc` clean (the payload type forces every site to set `window`).

5. **Dock.ts — remove the eager detach; route `addPanel` through the sweep.** In `onPanelDetached` ([Dock.ts:997](../src/typescript/lib/overlay/Dock.ts#L997)) delete the per-frame `_panelLocation.set(...,"floating")` + `emit("detach", …)` loop, keeping only `scheduleSweep()`. In `addPanel` ([Dock.ts:234](../src/typescript/lib/overlay/Dock.ts#L234)) delete the synchronous `emit("attach", …)` and the `_panelHost`/`_frameRegion` pre-seed for the new id, leaving the `region.moveComponent` + `scheduleSweep()` so the reconcile emits `attach` (missing-ledger branch). → verify: `grep -n 'emit("detach"\|emit("attach"' src/typescript/lib/overlay/Dock.ts` — only the reconcile site remains.

6. **Dock.ts — wire `"docked"` to `requestSweep`.** Add a bound `private onPanelDocked = (content: Component): void => { this.requestSweep(); };` (mirrors `onPanelDetached`'s shape; the `content` arg is unused but matches the listener signature). Wire `tab.on("docked", this.onPanelDocked)` in `wireRegion` ([Dock.ts:762](../src/typescript/lib/overlay/Dock.ts#L762)) next to the existing `tab.on("detached", …)`, and in `subscribeFloatWindows` ([Dock.ts:564](../src/typescript/lib/overlay/Dock.ts#L564)) for the `TabWindow` branch. → verify: `tsc` clean; `grep -n '"docked"' src/typescript/lib/overlay/Dock.ts` shows two wire sites.

7. **Dock.ts — rewrite the `DockEvent` and `DockPanelEvent` doc blocks.** The comment above `DockEvent` ([Dock.ts:65](../src/typescript/lib/overlay/Dock.ts#L65)–80) describes the old tiled-tree-centric semantics; rewrite it to the host-centric contract (attach=enters a host, detach=leaves a host, the `window` field, tear-off = detach(tiled)+attach(float), re-dock = detach(float)+attach(tiled), close=destroy with `window: null`). Update `DockPanelEvent`'s JSDoc and the `on`/`off`/`emit` JSDoc ([Dock.ts:1319](../src/typescript/lib/overlay/Dock.ts#L1319)+) to describe the `window` field. → verify: `npm run docs:build` 0 warnings.

8. **MiscPanel.ts — log the host.** In the `dockButton` handler ([MiscPanel.ts:857](../src/typescript/MiscPanel.ts#L857)–860) extend the four `dock.on(...)` log lines to include the host, e.g. `attach`/`detach`/`focus`: `` `[Dock] attach: ${e.id} -> ${e.window ? e.window.getTitle() : "(tiled)"}` ``; `close` stays `e.id` (its `window` is always null). → verify: app loads; console shows host on drag/tear-off/re-dock.

9. **Docs — update the curated page** (see `## Documentation Impact`). → verify: `npm run docs:build` 0 errors / 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | [src/typescript/lib/layout/Tab.ts](../src/typescript/lib/layout/Tab.ts) — new `"docked"` event (union, `on`/`emit` overloads, JSDoc, emit from `_onBarDockRequested`) |
| Modify | [src/typescript/lib/overlay/Dock.ts](../src/typescript/lib/overlay/Dock.ts) — host ledger, `hostForFrame`, `reconcileHosts`, payload `window` field, removed eager detach, `addPanel` routed through sweep, `onPanelDocked` wiring, `DockEvent`/`DockPanelEvent` JSDoc |
| Modify | [src/typescript/MiscPanel.ts](../src/typescript/MiscPanel.ts) — demo log lines include the host |
| Modify | [docs/components/Dock.md](../docs/components/Dock.md) — host-centric lifecycle table + rules |

No new exports needed: `DockEvent` / `DockPanelEvent` are already exported ([overlay/index.ts:25](../src/typescript/lib/overlay/index.ts#L25)), `AbstractWindow` already exported ([overlay/index.ts:5](../src/typescript/lib/overlay/index.ts#L5)), and `TabEvent` is exported from the layout barrel (the new member rides the existing type alias).

---

## Expected Behaviour

The actual drag **gesture** (pointer events, hit-testing) is not reproducible offline. But the *structural change a gesture produces plus the resulting sweep* **is** offline-exercisable: the existing harness [tests/overlay/Dock.lifecycle.test.ts](../tests/overlay/Dock.lifecycle.test.ts) mounts a sized `Dock`, captures the sweep's `requestAnimationFrame` callbacks in a queue, moves identity frames between a real `Window` and the tiled root by `moveComponent`, and `flush()`es the queue to run the sweep. So the attach/detach **sequencing, host field, and the missing-attach bug fix are all offline unit-testable** by driving the same frame moves the DnD paths perform — only the pointer gesture itself is manual. This file must be **updated** (it references `_panelLocation` and asserts the old `"floating"` ledger value, and asserts a synchronous `addPanel` attach) and **extended** with the cases below.

**Offline unit-testable (drive frame moves + flush the sweep):**

- *Payload shape.* `DockPanelEvent` carries `window: AbstractWindow | null` on every event; `"close"` always carries `window: null`.
- *Missing-ledger → single attach.* `addPanel` then `flush()` emits exactly one `attach` with `window: null` and no `detach`. (Note: `addPanel`'s attach is now produced by the sweep, so the test must `flush()` — the existing synchronous-assertion test is updated accordingly.)
- *Unchanged host → silence.* Two consecutive sweeps with no structural change between them emit nothing.
- *Tear-off → paired detach+attach with hosts.* Move a tiled frame into a `Window`, drive the source region's `"detached"`, `flush()`: expect `detach`(`window: null`) **then** `attach`(`window: theFloat`), and `_panelHost.get(id) === theFloat`.
- *Re-dock via the tab-bar path (the bug-fix regression).* With a frame floating, move it back under the tiled root and emit the new `Tab "docked"` event on the destination region's tab (instead of calling `scheduleSweep` directly — this is exactly what `_onBarDockRequested` now does), `flush()`: expect `detach`(`window: theFloat`) then `attach`(`window: null`). Without the `"docked"`→`requestSweep` wiring this emits nothing — the red/green pin for the bug.
- *Closed frame → no phantom detach.* `removePanel` (or a float ✕) emits `close` only; the next sweep does not visit the removed frame and emits no `detach`.

**Manual-verify only (the actual drag gesture, via the Dock demo + browser):**

- *(a) Tear off a tab to a float* → `detach`(tiled) then `attach`(float-window-title). [Previously: `detach` only.]
- *(b) Re-dock by dropping the float's tab onto an existing dock **tab bar*** → `detach`(float) then `attach`(tiled). **This is the path the current code breaks** (emits `focus` only).
- *(c) Re-dock by dropping on a region **body/edge*** → same `detach`(float) then `attach`(tiled).
- *(d) Internal tab reorder within one region* → silence (no attach/detach).
- *(e) Close a float* → `close`, no phantom `detach`.
- *Re-dock and restore still fire `focus`* for the now-active panel, with its `window` field naming the current host.

---

## Verification

- **Typecheck:** `npm run typecheck` (`tsc -p tsconfig.lib.json --noEmit`) clean. The payload-type change forces every emit site to set `window` — a missed site is a compile error.
- **Test suite:** `npm test` (runs `typecheck:test` then `vitest run`) — the offline-testable invariants above plus the existing Dock/Tab lifecycle tests stay green.
- **Grep invariants:** `grep -rn '_panelLocation\|reconcileLocations' src/` → zero matches (rename complete); `grep -n 'emit("detach"\|emit("attach"' src/typescript/lib/overlay/Dock.ts` → only the reconcile site.
- **Manual smoke test — the Dock demo.** `npm run dev` (app on http://localhost:8015), click **"Dockable layout (Dock)"** on the Misc. panel, then exercise (a)–(e) above with the browser console open, watching the `[Dock] …` lines for the host annotation. (b) is the regression that must now log `detach: … -> (float title)` then `attach: … -> (tiled)`.
- **Theme toggle:** unaffected (no CSS change) — a quick toggle confirms no incidental regression.
- **Docs build:** `npm run docs:build` finishes with **0 errors and 0 link warnings** (typedoc's "unsupported TypeScript version" notice is the only acceptable warning).

---

## Documentation Impact

Public API changes: `DockPanelEvent` gains a `window` field and `DockEvent`'s `attach`/`detach` semantics change (tiled-tree-centric → host-centric). `Tab` gains a `"docked"` event but it is an internal coordination signal (`Dock` is the only consumer); `TabEvent` is already a documented union, so the new member rides the existing type-alias doc — no new curated page.

- **Barrel:** `Dock`, `DockEvent`, `DockPanelEvent` are exported from the per-subpath overlay barrel [src/typescript/lib/overlay/index.ts:24](../src/typescript/lib/overlay/index.ts#L24)–25; no export change (the payload gains a field, not a new symbol).
- **Curated page:** [docs/components/Dock.md](../docs/components/Dock.md) — rewrite the **Panel lifecycle** section ([Dock.md:66](../docs/components/Dock.md#L66)–90). The current table and rules describe the *tiled-tree-centric* model ("attach derived from a floating → docked transition", "an internal move is silent because attach is derived from floating → docked"); replace with the host-centric contract: attach = enters a host (tiled tree *or* a fresh float), detach = leaves a host, the `window` payload field (`null` = tiled), tear-off = detach(tiled)+attach(float), re-dock (both paths) = detach(float)+attach(tiled), internal move within one host = silent, close = `window: null`. Update the example snippet to show reading `event.window`.
- **Catalog / sidebar:** the Dock entry already exists in [docs/components/index.md:21](../docs/components/index.md#L21) and the sidebar ([docs/.vitepress/config.mts:72](../docs/.vitepress/config.mts#L72)); no new entries — content edit only.
- **JSDoc cross-bucket:** the new `window: AbstractWindow | null` field references `AbstractWindow`, which lives in the *same* overlay bucket as `Dock`, so an in-bucket `{@link AbstractWindow}` (or plain prose) resolves cleanly. No internal-symbol link is introduced.

---

## Potential Challenges

- **`addPanel` attach now async.** Emission moves from synchronous to the next animation frame. Mitigation: no caller relies on synchronicity (the demo logs post-hoc); the single-path consistency is the point. Documented here so an `/implement` run does not "restore" the synchronous emit.
- **`floatForFrame` returns `null` for a mid-teardown frame**, colliding with the tiled `null` sentinel. Mitigation: a frame neither tiled nor in any open float is transient — it is deleted from `_frames` (and `_panelHost`) by the close handlers before the next sweep, so the ledger never persists the ambiguous `null`. The reconcile only visits frames still in `_frames` ∩ `_panels`.
- **`subscribeFloatWindows` must wire `"docked"` only on the `TabWindow` branch**, where the float's interior *is* a `Tab` ([Dock.ts:559](../src/typescript/lib/overlay/Dock.ts#L564)) — a bare-`Window` mini-dock's inner `Tab` regions are wired by `wireRegion` instead, so wiring `"docked"` in both places without double-counting is the same split the existing `"detached"`/`"activated"`/`"tabclose"` wiring already respects. Mirror it exactly.
- **Removing the eager detach must not lose the tear-off detach.** The tear-off's `onPanelDetached` keeps `scheduleSweep()`, and the sweep's reconcile now produces `detach`(tiled)+`attach`(float). Verify manually (case a) that the tear-off still emits a `detach` — it now comes from the reconcile, not the eager path.

---

## Critical Files

- [src/typescript/lib/overlay/Dock.ts](../src/typescript/lib/overlay/Dock.ts) — the whole change centres here; read `runSweep`, `reconcileLocations`, `onPanelDetached`, both close handlers, `setFocus`, the ledger fields, and the `on`/`off`/`emit` block.
- [src/typescript/lib/layout/Tab.ts](../src/typescript/lib/layout/Tab.ts) — `TabEvent` ([:37](../src/typescript/lib/layout/Tab.ts#L37)), `_onBarDockRequested` ([:1012](../src/typescript/lib/layout/Tab.ts#L1012)), `dockComponent` ([:1716](../src/typescript/lib/layout/Tab.ts#L1716)), the `"detached"` emit ([:1831](../src/typescript/lib/layout/Tab.ts#L1831)) and its `on`/`emit` overloads ([:1965](../src/typescript/lib/layout/Tab.ts#L1965), [:2011](../src/typescript/lib/layout/Tab.ts#L2011)) — the pattern to mirror.
- [src/typescript/lib/overlay/AbstractWindow.ts](../src/typescript/lib/overlay/AbstractWindow.ts) — `getTitle()` ([:461](../src/typescript/lib/overlay/AbstractWindow.ts#L461)), the host display the demo reads.
- [ARCHITECTURE.md](../ARCHITECTURE.md) §Event handling — the two-surface split and the named-reference-listener rule the new event must follow.
- [docs/components/Dock.md](../docs/components/Dock.md) — the lifecycle section to rewrite.

---

## Non-Goals

- **No `blur` event.** `focus` stays a single nullable event; nothing in this change touches focus mechanics beyond adding the payload field.
- **No change to `Split` semantics.** `Split` remains structural and event-free.
- **No serialization change.** Host transitions are runtime events; `getLayoutState`/`setLayoutState` are untouched (a restore still lands a sweep, which now emits per-frame `attach` via the missing-ledger branch — consistent with the contract, no new persisted state).
- **No public `Tab` consumer for `"docked"`.** It is an internal `Dock` coordination signal; it is added to the typed surface (per ARCHITECTURE) but no docs page promotes it as a `Tab` feature.
