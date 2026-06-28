---
depends-on: [dock-host-centric-events]
---

# Dock `"moved"` Lifecycle Event — Implementation Plan

## Overview

> **Dependency:** this is built **on top of `feature/dock-host-centric-events`** (or off `master` once that branch merges). Every line/path cited here reflects the post-host-centric `Dock.ts`; on bare `master` the symbols (`reconcileHosts`, `_panelHost`, `_frameRegion`, the `window` payload field) do not exist. Do not implement against bare `master`.

`Dock` ([src/typescript/lib/overlay/Dock.ts](../src/typescript/lib/overlay/Dock.ts)) emits a host-centric panel-lifecycle event set — `"attach" | "detach" | "focus" | "close"` ([Dock.ts:85](../src/typescript/lib/overlay/Dock.ts#L85)) — where `"attach"`/`"detach"` name *host* transitions (tiled tree ⇄ float window) and a move *within* one host is silent. This plan adds a fifth event, `"moved"`, that fills that silence: it fires when a panel **relocates inside its current host** — dragged from one `Tab`/region to another within the same tiled tree, or repositioned within a single float — without changing host.

The event is derived from the per-panel **region ledger** `_frameRegion` ([Dock.ts:165](../src/typescript/lib/overlay/Dock.ts#L165)) that the host-centric work already maintains every sweep via `regionForFrame(frame)` ([Dock.ts:665](../src/typescript/lib/overlay/Dock.ts#L665), [Dock.ts:1235](../src/typescript/lib/overlay/Dock.ts#L1235)). `reconcileHosts(root)` ([Dock.ts:646](../src/typescript/lib/overlay/Dock.ts#L646)) is extended so that, after the host diff, a same-host change of region **object identity** emits `"moved"`. No new ledger, no new sweep trigger, no `Tab.ts` change — every intra-host relocation path already lands a coalesced sweep (verified in [Architecture Decisions](#sweep-coverage-no-tabts-change-needed)).

Touches: [Dock.ts](../src/typescript/lib/overlay/Dock.ts) (the event union, the region-diff in `reconcileHosts`, ledger-seeding audit, `on`/`off`/`emit` overloads, JSDoc), [MiscPanel.ts](../src/typescript/MiscPanel.ts) (demo logging), and the curated doc page [docs/components/Dock.md](../docs/components/Dock.md). No barrel change — `DockEvent` and `DockPanelEvent` are already exported.

---

## Architecture Decisions

### The diff key: region **object identity**, scoped to "same host"

`reconcileHosts` already computes, per registered frame, both the host (`hostForFrame`) and the region (`regionForFrame`, written into `_frameRegion`). `"moved"` is the case **host unchanged, region object changed**. The branch order inside the per-frame loop becomes:

1. **First appearance** (`!_panelHost.has(id)`) → `attach` only; seed *both* `_panelHost` and `_frameRegion`; **never** `moved`.
2. **Host change** (`host !== prev`) → `detach`(old) + `attach`(new); update both ledgers; **never** `moved` (the move across hosts is already fully described by the pair).
3. **Same host, region object changed** (`host === prev && region && region !== prevRegion`) → `moved` only.
4. **Unchanged** → silent.

Using the region **Container object** (`===` identity) rather than a stable string key is the simplest correct option *for this codebase* because regions are anonymous (no public id) and the ledger already stores the object. The risk a raw-identity diff carries — a structural reshape swapping the region object of a panel that did not conceptually move — is analysed next.

### Region-object stability across reshapes — false-fire / missed-fire analysis

The dock tree is constantly restructured by `DockRegion` ([src/typescript/lib/layout/DockRegion.ts](../src/typescript/lib/layout/DockRegion.ts)). Walking each path for **(a)** the dragged panel and **(b)** a pre-existing *neighbour* whose tree gets wrapped/collapsed around it:

- **`splitOnEdge`** ([DockRegion.ts:410](../src/typescript/lib/layout/DockRegion.ts#L410)):
  - *(a) dragged* — always lands in a **fresh** `newStack()` ([DockRegion.ts:418](../src/typescript/lib/layout/DockRegion.ts#L418)). Its region object is new ⇒ `moved` fires. **Correct** — the panel genuinely relocated to a new pane.
  - *(b) neighbour* — branch "extend existing same-axis Split" ([DockRegion.ts:424](../src/typescript/lib/layout/DockRegion.ts#L424)) and "insert adjacent into same-axis Split" ([DockRegion.ts:447](../src/typescript/lib/layout/DockRegion.ts#L447)) leave every sibling stack **untouched** (only the new stack is inserted). The "wrap unit in a fresh Split" branch calls `ensureStacked(unit)` ([DockRegion.ts:462](../src/typescript/lib/layout/DockRegion.ts#L462), [DockRegion.ts:487](../src/typescript/lib/layout/DockRegion.ts#L487)), which returns an **existing `Tab`/`Split` unchanged** and only wraps a *bare leaf*. The `unit` it splits against is the region or its whole `Tab` stack — the wrap re-parents that **whole stack object**, not the inner frame's stack, so the neighbour frame's *region* (its `Tab` stack) keeps its identity. **No false-fire** for a stacked neighbour.
- **`dockAsTab`** ([DockRegion.ts:605](../src/typescript/lib/layout/DockRegion.ts#L605)):
  - *(a) dragged* — joins an existing `Tab` (cases 1/2) or a fresh `newStack()` (case 3). Either way its region object differs from before ⇒ `moved` fires. **Correct.**
  - *(b) neighbour* — cases 1/2 move only the dragged panel in; existing tabs keep their region. Case 3 ([DockRegion.ts:628](../src/typescript/lib/layout/DockRegion.ts#L628)) wraps `this._region` (a *bare leaf*) into a fresh stack, changing **that leaf's** region object. In a `Dock`, however, leaves are **always already in reorderable `Tab` stacks** — the compiler (`compileTabs`/`compileRegion`, [Dock.ts:480](../src/typescript/lib/overlay/Dock.ts#L480)) and every `DockRegion` deposit guarantee it — so case 3 (a bare-leaf region) is effectively unreachable through normal `Dock` usage. **No false-fire in practice.**
- **`collapseIfSinglePaneSplit`** ([DockRegion.ts:556](../src/typescript/lib/layout/DockRegion.ts#L556)) and the twin `collapseSinglePaneSplit` in `Dock` ([Dock.ts:879](../src/typescript/lib/overlay/Dock.ts#L879)): the surviving lone child is **`moveComponent`-hoisted**, never recreated, so a neighbour that survives a collapse keeps its region object. **No false-fire.**
- **`pruneEmptyStack`/`pruneRegion`**: remove an *emptied* stack — the relocated frame already left it, so its ledger entry already points at the destination. **No false-fire.**

**Conclusion.** Region-object identity is correct for every relocation a user can perform in a `Dock`, because `DockRegion`/`Dock` never re-mint the region object of a *stacked* panel that did not itself move. The lone theoretical false-fire — a **bare-leaf** neighbour wrapped by `ensureStacked`/`dockAsTab` case 3 — is unreachable given `Dock`'s leaves-are-always-stacked invariant. A stable position-path key would buy nothing here and add a second ledger to keep in sync; it is **rejected** as over-engineering. The residual is documented as a boundary test (see [Expected Behaviour](#expected-behaviour)) rather than engineered away.

Missed-fire: none. Every genuine relocation re-mints or re-targets the dragged frame's region object, and every such path lands a sweep (next decision), so `moved` is observed for all of them.

### Pure reorder within one strip does **not** fire `moved`

Reordering tabs inside one strip keeps the same region **object** (the frame stays in the same `Tab` container; only its index changes). `Tab._onBarReordered` ([Tab.ts:910](../src/typescript/lib/layout/Tab.ts#L910)) re-sorts `_contents` and calls `scheduleLayout()` — it emits **no** event `Dock` subscribes to and never calls `requestSweep`, so a reorder lands **no Dock sweep** at all. Thus a reorder is silent on two independent grounds (no sweep; and even if one ran, the region object is unchanged). This is the **recommended default**: a reorder repositions a panel *within the same place*, not *to a different place* — it is not a relocation. Including reorders would require the ledger to also track the tab **index**, adding a parallel `Map<string, number>` to seed and diff on every path, plus a new sweep trigger wired to `"reordered"` — cost the user explicitly did not ask for. **Reorders stay silent.**

### Payload: reuse `DockPanelEvent`, `window` = the (unchanged) current host; no region info

`"moved"` carries `DockPanelEvent { id, content, window }` ([Dock.ts:94](../src/typescript/lib/overlay/Dock.ts#L94)), with `window` set to the host the panel **now sits in** (which equals the host it sat in before — `moved` is same-host by definition). No region object is exposed. Regions are anonymous (no stable public id), so putting a from/to region `Container` in a **public** payload would leak an internal, identity-only object a consumer cannot meaningfully name or persist. A consumer that needs the new arrangement re-reads `getLayoutState()` ([Dock.ts:297](../src/typescript/lib/overlay/Dock.ts#L297)) — `moved` is a *relocation signal*, mirroring how `focus` is a "the active panel changed, go re-read" signal. Keeping the payload identical to the other four events (no `moved`-only fields) preserves the flat, uniform `DockPanelEvent` surface the host-centric work established.

### Emit from the same sweep-driven reconcile (single source of truth)

`"moved"` is emitted from **inside `reconcileHosts`**, in the same per-frame loop that already emits `attach`/`detach` and already writes `_frameRegion`. This inherits the host-centric guarantees for free: one coalesced rAF sweep per gesture burst (`scheduleSweep` → `runSweep` → `reconcileHosts`, [Dock.ts:522](../src/typescript/lib/overlay/Dock.ts#L522)), and a single code path regardless of which DnD route landed the sweep. No sibling method is added — the region read and write already live there; only the diff-and-emit between them is new.

The current tail of the loop ([Dock.ts:665](../src/typescript/lib/overlay/Dock.ts#L665)) unconditionally overwrites `_frameRegion`; the new code must read `prevRegion` **before** overwriting and gate the `moved` emit on the first-appearance / host-change branches so neither false-fires:

```typescript
// inside the for-loop, replacing the host-diff block + the region-ledger tail:
const host         = this.hostForFrame(frame, root);
const hadHost      = this._panelHost.has(id);
const prevHost     = this._panelHost.get(id) ?? null;
const region       = this.regionForFrame(frame);
const prevRegion   = this._frameRegion.get(id) ?? null;

if (!hadHost) {
    this.emit("attach", { id, content: frame, window: host });
} else if (host !== prevHost) {
    this.emit("detach", { id, content: frame, window: prevHost });
    this.emit("attach", { id, content: frame, window: host });
} else if (region && prevRegion && region !== prevRegion) {
    this.emit("moved", { id, content: frame, window: host });
}

this._panelHost.set(id, host);

if (region) {
    this._frameRegion.set(id, region);
}
```

The `region && prevRegion` guard makes a frame transiently **out of any `Tab` region** (`regionForFrame` returns `null` mid-teardown) silent rather than spuriously `moved`, and the branch is `else if` after the host-change branch so a host change never also fires `moved`.

### Ledger seeding — `moved` must never false-fire on first appearance

`_frameRegion` is **already seeded everywhere a panel first appears**, which is exactly what keeps a fresh panel out of the `moved` branch (the host-change/first-appearance branches run instead, and on first appearance there is no `prevRegion`):

- `addPanel` seeds `_frameRegion.set(spec.id, region)` ([Dock.ts:272](../src/typescript/lib/overlay/Dock.ts#L272)) — but **not** `_panelHost`, by design, so the first sweep takes the first-appearance branch (`attach` only). ✓
- `compileTabs` seeds both `_panelHost.set(id, null)` and `_frameRegion.set(id, region)` at construction ([Dock.ts:510](../src/typescript/lib/overlay/Dock.ts#L510)) — so a compiled panel's first sweep is silent. ✓
- A **restore** (`setLayoutState`) re-homes frames without seeding `_frameRegion`; the first post-restore sweep then sees `prevRegion === null` for any newly-restored frame and takes first-appearance/host-change, not `moved`. Frames that *survived* the restore in place keep their ledger entry and stay silent. ✓ (No new seeding needed — the `region && prevRegion` guard covers the null-prev case.)

The audit's outcome: **no new seeding is required.** The implementer must nonetheless re-verify each seed site against the worktree's actual lines (host-centric may have shifted them) and confirm none was missed — a missing seed manifests as a spurious `moved` on a panel's *second* sweep.

### Sweep coverage — no `Tab.ts` change needed

Every intra-host relocation path already lands a coalesced sweep, so `moved` is observed without touching `Tab`:

| Intra-host relocation | Sweep trigger | Source |
| --- | --- | --- |
| Region-to-region drag (edge split / centre dock) via `DockRegion` | `onDrop` → `this._onStructureChanged?.()` → `requestSweep` | [DockRegion.ts:128](../src/typescript/lib/layout/DockRegion.ts#L128), wired at [Dock.ts:790](../src/typescript/lib/overlay/Dock.ts#L790) |
| Tab-bar merge within the same host (`Tab._onBarDockRequested` → `"docked"`) | `Tab "docked"` → `onPanelDocked` → `requestSweep` | [Dock.ts:185](../src/typescript/lib/overlay/Dock.ts#L185), wired at [Dock.ts:813](../src/typescript/lib/overlay/Dock.ts#L813) (added by the host-centric work) |
| Edge-split that prunes/collapses the source | `pruneRegion`/`pruneEmptyStack` → `scheduleSweep` / `requestSweep` | [Dock.ts:846](../src/typescript/lib/overlay/Dock.ts#L846), [DockRegion.ts:520](../src/typescript/lib/layout/DockRegion.ts#L520) |
| Pure reorder within one strip | *(no sweep — and intentionally no `moved`; see decision above)* | [Tab.ts:910](../src/typescript/lib/layout/Tab.ts#L910) |

The only relocation that lands no sweep is a pure reorder, which is intentionally silent. **`Tab.ts` is out of scope.**

### Conventions compliance

- **Event-surface `on`/`off`/`emit` overloads:** `"moved"` is added to the existing `"attach" | "detach" | "close"` overload group (same `(event: DockPanelEvent) => void` signature, never `null`), mirroring the established pattern ([Dock.ts:1381](../src/typescript/lib/overlay/Dock.ts#L1381), [Dock.ts:1408](../src/typescript/lib/overlay/Dock.ts#L1408), [Dock.ts:1431](../src/typescript/lib/overlay/Dock.ts#L1431)). Each overload keeps its own JSDoc block (CODE_CONVENTIONS §JSDoc).
- **No `{@link}` to internal symbols** from the public `DockEvent`/`DockPanelEvent`/`on` JSDoc — the new prose describes the move semantics without naming private methods (CODE_CONVENTIONS §"Don't `{@link}` internal symbols").
- **Named-reference listeners / `ListenerBag`:** no new listener wiring — `moved` rides the existing `_listeners` bag and `reconcileHosts` call site. No `declare`-field trap (the bag is already deferred to the constructor body).

No unavoidable convention violation.

---

## Public API (TypeScript Signatures)

```typescript
// DockEvent gains "moved":
export type DockEvent = "attach" | "detach" | "moved" | "focus" | "close";

// DockPanelEvent is UNCHANGED (no new fields) — moved reuses { id, content, window }.

class Dock extends Container<DockOptions> {
    // "moved" joins the existing non-null overload group:
    on(event: "attach" | "detach" | "moved" | "close", listener: (event: DockPanelEvent) => void): this;
    on(event: "focus", listener: (event: DockPanelEvent | null) => void): this;

    off(event: "attach" | "detach" | "moved" | "close", listener: (event: DockPanelEvent) => void): this;
    off(event: "focus", listener: (event: DockPanelEvent | null) => void): this;

    protected emit(event: "attach" | "detach" | "moved" | "close", payload: DockPanelEvent): void;
    protected emit(event: "focus", payload: DockPanelEvent | null): void;
}
```

---

## Ordered Implementation Steps

1. **Add `"moved"` to the `DockEvent` union** ([Dock.ts:85](../src/typescript/lib/overlay/Dock.ts#L85)). Place it after `"detach"` (`"attach" | "detach" | "moved" | "focus" | "close"`) to keep host-pair events adjacent. → verify: `npm run typecheck` flags the now-incomplete `emit` switch nowhere (the body delegates to `_listeners.fire`, so no exhaustiveness break) but the overload groups must be widened in step 4 first for callers.

2. **Extend the `DockEvent` doc block** ([Dock.ts:65–85](../src/typescript/lib/overlay/Dock.ts#L65)) — add one sentence: `"moved"` fires when a panel relocates **within** its current host (a different region in the same tiled tree, or repositioned in the same float); it never accompanies a host change (that is `detach`+`attach`) nor a first appearance (that is `attach` alone), and a pure same-strip reorder is silent.

3. **Extend `reconcileHosts`** ([Dock.ts:646–671](../src/typescript/lib/overlay/Dock.ts#L646)) per the [snippet above](#emit-from-the-same-sweep-driven-reconcile-single-source-of-truth): read `prevRegion` before the overwrite, add the `else if (region && prevRegion && region !== prevRegion)` → `emit("moved", …)` branch, keep the unconditional `_frameRegion.set` tail. Update the method JSDoc to mention the same-host region-change → `moved` case. → verify: unit tests (step 7).

4. **Widen the `on`/`off`/`emit` overload groups** ([Dock.ts:1381](../src/typescript/lib/overlay/Dock.ts#L1381), [Dock.ts:1408](../src/typescript/lib/overlay/Dock.ts#L1408), [Dock.ts:1431](../src/typescript/lib/overlay/Dock.ts#L1431)): add `"moved"` to each `"attach" | "detach" | "close"` literal. Update each overload's JSDoc `@param event` enumeration to include `"moved"` and add a clause to the `on`-group doc describing the `moved` payload (same `{ id, content, window }`, `window` = current host). → verify: `npm run typecheck`.

5. **Audit ledger seeding** (read-only): confirm against the worktree's actual lines that `addPanel`, `compileTabs`, and the restore path leave a fresh panel out of the `moved` branch (see [decision](#ledger-seeding--moved-must-never-false-fire-on-first-appearance)). No code change expected; if a seed site moved, note it. → verify: the addPanel / restore unit tests in step 7 stay green.

6. **MiscPanel demo** ([MiscPanel.ts:863](../src/typescript/MiscPanel.ts#L863)): add one line after the `detach` line, reusing the existing `host()` helper ([MiscPanel.ts:861](../src/typescript/MiscPanel.ts#L861)):
   ```typescript
   dock.on("moved", e => console.log(`[Dock] moved: ${e.id} -> ${host(e)}`));
   ```
   → verify: `npm run typecheck`; manual smoke (step in Verification).

7. **Unit tests** in [tests/overlay/Dock.lifecycle.test.ts](../tests/overlay/Dock.lifecycle.test.ts) — see [Expected Behaviour](#expected-behaviour). Add a `describe('Dock moved', …)` block. → verify: `npm test`.

8. **Docs** — [docs/components/Dock.md](../docs/components/Dock.md) Panel-lifecycle section (table at [Dock.md:70](../docs/components/Dock.md#L70) + rules + gesture table at [Dock.md:79](../docs/components/Dock.md#L79)). See [Documentation Impact](#documentation-impact). → verify: `npm run docs:build` (0 errors; the lone pre-existing `PickerCellList.getMinSize` link warning is unrelated and acceptable).

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `src/typescript/lib/overlay/Dock.ts` |
| Modify | `src/typescript/MiscPanel.ts` |
| Modify | `tests/overlay/Dock.lifecycle.test.ts` |
| Modify | `docs/components/Dock.md` |

No barrel change — `DockEvent` and `DockPanelEvent` are already exported from `src/typescript/lib/overlay/index.ts`.

---

## Expected Behaviour

All cases below are **offline-unit-testable**: the existing harness ([tests/overlay/Dock.lifecycle.test.ts](../tests/overlay/Dock.lifecycle.test.ts)) captures rAF (`captureRaf`/`flush`) and drives `moveComponent` between regions/windows directly, then flushes the sweep. Derive each from the contract, not from current output.

1. **Same-host region-to-region move fires exactly one `moved` (correct host), no attach/detach.** Add two panels into the tiled tree, flush. Record attach/detach/moved. Move one frame from the root `Tab` region into a *second* tiled `Tab` region (e.g. build a second region via `newTabRegion`/`addComponent` and `moveComponent` the frame in — or split off a region) and `scheduleSweep` + flush. Expect: one `moved` with `window === null`, zero attach, zero detach. Assert `_frameRegion.get(id)` now equals the destination region object.

2. **Host change fires detach+attach and NOT moved.** Reuse the existing tear-off setup (`Tab "detached"` → sweep, [test L205](../tests/overlay/Dock.lifecycle.test.ts#L205)) and the re-dock setups (region-body drop [L137], tab-bar merge [L169]); add a `moved` spy to each and assert it is **never** called. (Add the spy to the existing tests or mirror them in the new block.)

3. **addPanel / first appearance fires no `moved`.** Mirror the existing addPanel test ([L95](../tests/overlay/Dock.lifecycle.test.ts#L95)) with a `moved` spy; flush; assert `attach` fired once and `moved` not at all.

4. **No-op sweep fires no `moved`.** Mirror the unchanged-tiled-tree test ([L116](../tests/overlay/Dock.lifecycle.test.ts#L116)) with a `moved` spy; call `runSweep()` directly after a settled layout; assert `moved` not called (region object unchanged).

5. **Restore (`setLayoutState`) fires no spurious `moved` for surviving panels.** Build a dock, capture its `getLayoutState()`, `setLayoutState(state)`, flush; assert no `moved` for panels whose region object the restore preserved. (Restored-fresh frames take first-appearance/host-change, not `moved` — guard `region && prevRegion`.)

6. **Boundary (documents the region-identity behaviour):** a relocation that re-mints the dragged frame's region object — an **edge split** that drops the frame into a fresh `newStack()` — fires exactly one `moved` for the *dragged* frame and **none** for a stacked neighbour whose `Tab` region object the reshape preserved. This pins the [stability analysis](#region-object-stability-across-reshapes--false-fire--missed-fire-analysis): no neighbour false-fire under `Dock`'s leaves-are-always-stacked invariant.

**Manual-verify only** (the real drag *gesture* — pointer geometry the offline harness cannot exercise): `npm run dev`, app on `http://localhost:8015`, click **"Dockable layout (Dock)"**, open the console, and drag a tab from one region into another **within the main dock** — observe a single `[Dock] moved: <id> -> (tiled)` line and **no** attach/detach. Drag a tab *out* to a float and confirm `detach`+`attach` (no `moved`); reorder tabs within one strip and confirm **silence**.

---

## Verification

- `npm run typecheck` (`tsconfig.lib.json`) — 0 errors.
- `npm test` — runs `typecheck:test` then vitest; the new `Dock moved` cases (Expected Behaviour 1–6) green, all pre-existing Dock lifecycle tests still green.
- `npm run docs:build` — 0 errors; the single pre-existing `PickerCellList.getMinSize` link warning is unrelated and acceptable. No *new* link warnings (the `moved` JSDoc adds no `{@link}` to internal symbols).
- **Manual smoke** (offline-untestable drag gesture): the `http://localhost:8015` → "Dockable layout (Dock)" steps in Expected Behaviour — single `moved` on an intra-host region drag, `detach`+`attach` on a tear-off, silence on a reorder.

---

## Documentation Impact

`docs/components/Dock.md`, Panel-lifecycle section:

- **Event table** ([Dock.md:70](../docs/components/Dock.md#L70)) — add a row:
  `| `moved` | a panel **relocates within** its current host — a different region in the same tiled tree, or repositioned in the same float | `{ id, content, window }` |`
  and update the lead sentence "emits four events" → "emits five events".
- **Gesture table** ([Dock.md:79](../docs/components/Dock.md#L79)) — replace the single "Internal move within one host *(silent)*" row with two rows:
  `| Move a panel to a different region within one host | `moved` (`window` = that host) |`
  `| Reorder tabs within one strip | *(silent)* |`
- **Rules list** ([Dock.md:94](../docs/components/Dock.md#L94)) — rewrite the "An internal move is silent" bullet ([Dock.md:98](../docs/components/Dock.md#L98)) into a `moved` rule: a relocation to a *different* region within the same host fires `moved` (host unchanged, `window` names that host); a host change fires `detach`+`attach` and **not** `moved`; a first appearance fires `attach` alone and **not** `moved`; a pure same-strip reorder fires nothing. Add a sentence that `moved` carries no region info — a consumer reacting to a layout change re-reads `getLayoutState()`.
- Optionally extend the `dock.on(...)` example block ([Dock.md:85](../docs/components/Dock.md#L85)) with a `moved` line.

`DockEvent` / `DockPanelEvent` / `Dock.on` JSDoc updates (steps 2 & 4) regenerate the API reference under `docs/api/overlay/` via `docs:api`. No catalog `index.md` or `docs/.vitepress/config.mts` sidebar change — no new page, no rename.

---

## Critical Files

- [src/typescript/lib/overlay/Dock.ts](../src/typescript/lib/overlay/Dock.ts) — `reconcileHosts`, `_frameRegion`/`regionForFrame`, the `DockEvent` doc block, the `on`/`off`/`emit` overload groups, the seed sites (`addPanel`, `compileTabs`).
- [src/typescript/lib/layout/DockRegion.ts](../src/typescript/lib/layout/DockRegion.ts) — `splitOnEdge`, `dockAsTab`, `newStack`, `ensureStacked`, `pruneEmptyStack`, `collapseIfSinglePaneSplit`: the source of region-object stability (read to confirm the false-fire analysis at implement time).
- [src/typescript/lib/layout/Tab.ts](../src/typescript/lib/layout/Tab.ts) — `_onBarReordered` (reorder lands no sweep), the `"docked"` emit (`_onBarDockRequested`): confirm no change is needed.
- [tests/overlay/Dock.lifecycle.test.ts](../tests/overlay/Dock.lifecycle.test.ts) — the rAF-capture harness and the attach/detach/focus/close test shapes the `moved` tests mirror.
- [docs/components/Dock.md](../docs/components/Dock.md) — the Panel-lifecycle section to extend.

---

## Non-Goals

- **Reorder-within-a-strip as `moved`.** Excluded — a reorder is repositioning *within* a place, not a relocation *to* a place; including it needs an index ledger and a new sweep trigger the user did not ask for.
- **Exposing region identity in the payload.** Excluded — regions are anonymous; a consumer re-reads `getLayoutState()`.
- **A stable region-key / position-path diff.** Excluded — region-object identity is correct under `Dock`'s invariants; a second ledger would add sync cost for no behavioural gain.
- **Any `Tab.ts` change.** Out of scope — every intra-host relocation already lands a sweep.
