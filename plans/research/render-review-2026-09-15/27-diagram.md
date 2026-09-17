# 27 diagram — render-work review

**Summary**

- The only DOM write a pan frame makes is a **stylesheet-rule mutation** — `applyTransformToHost` writes the content host's `transform` through `Component.setTransform`, which targets the component's `#id` CSS rule, not an inline style. Probe: one `pointermove` produces exactly one seam write and it is `setRuleStyles`. Uncoalesced, so it runs once per raw pointer event, not once per frame. In the cost model that is a full-document restyle per pointer sample on hot path 1 and 3 (F27.1, HIGH).
- Every `pointerdown` / `click` / `dblclick` / `contextmenu` runs `nodeIdAt`, which walks **every node component in the graph** and does a DOM lookup per node. Probe: one pointerdown plus one click on a 400-node graph = 380 `getElementById` + 422 `contains` calls. Only the mounted subset can ever be the target (F27.2, HIGH).
- Every zoom notch and every resize frame rebuilds the whole residency state: a sort over every leaf height (`medianLeafHeight`, whose inputs change only per ELK pass), a `Set` over every node id, an id array plus a `Set` over every edge, and a `Map` over every drawn edge. Probe: 5 wheel notches → 5 full recomputes; 10 resize frames → 10 (F27.3, HIGH).
- The pan/zoom target carries no `will-change` hint, although the library's own documented compositor-hint mechanism is used by eight other modules. Every pan frame therefore re-rasterises the whole visible canvas — up to N `<rect>` plus 3×E `<path>` — in software Cairo (F27.4, HIGH, reasoned not measured).
- A data refresh destroys and rebuilds every node component with no rebind path. Probe: replaying the **identical** graph on a 100-node view costs 4466 seam writes, 202 `createElement`, 198 `createElementNS` and 398 releases (F27.11, MEDIUM).

Both 2026-08-29 health-audit items for this slice are **closed**: the per-node `ThemeManager` leak (probe P13: listener count stable at 3331 across four refreshes) and the un-sized `DiagramNodeLayer` `<svg>` (probe P14: committed 2000×3200, `overflow: visible`). The audit's duplication item — the triplicated viewport→graph inversion — is still open (F27.14).

Probes live in `.worktrees/_probes/27-diagram/probe.test.ts` (14 cases, all passing); each finding quotes the case that produced its number.

---

## Findings

### F27.1 Pan, zoom and resize write the viewport transform into a stylesheet rule, once per raw event

- **Category**: C, D, B, G
- **Impact**: HIGH — one full-document restyle per pointer sample during a pan, per wheel notch during a zoom, and per frame during a `Split`/`Dock` resize of the pane holding the diagram.
- **Where**:
  - `component/diagram/DiagramView.ts:1002-1008` (`applyTransformToHost`), `:1005` (the write)
  - `core/Component.ts:3276-3282` (`setTransform`) → `core/Component.ts:1893-1901` (`setElementCSSRule`) → `core/Component.ts:1914-1924` (`commitCSSRule`) → `core/StyleTarget.ts:457-465` (`StyleRule.flushDirty`) → `core/DOM.ts:1667` (`setRuleStyles`)
  - `component/diagram/DiagramView.ts:2171-2205` (`_handlePointerMove`), `:2122-2127` (`_handleWheel`), `:1759-1785` (`anchorCentreAcrossResize`)
  - `component/diagram/DiagramView.ts:1154-1163` (`setZoom`, no equality gate), `:1187-1198` (`fitGraph`, two writes), `:1212-1224` (`resetView`, up to three)
  - `core/Component.ts:2974-2981` (`setCursor`) → `writeStyle` → `commitCSSRule` — two more rule writes per pan gesture, at `DiagramView.ts:2161` and `:2196`/`:2212`
- **Hot path** (pan):
  1. native `pointermove` → `Event` window capture → `DiagramView._handlePointerMove` (`:2171`)
  2. `this._panX/_panY = …` (`:2201-2202`)
  3. `applyTransformToHost()` (`:2204`)
  4. `this._contentHost.setTransform("translate(…) scale(…)")` (`:1005`)
  5. `Component.setElementCSSRule("transform", …)` → `StyleRule.queue` + `commitCSSRule` → `DOM.sink.setRuleStyles(#<hostId>, { transform })`
- **Evidence**:
  - `Component.setTransform` writes `this._styleRule` (a `StyleRule`, `Component.ts:583`), **not** the `InlineStyle` surface that `setX`/`setY`/`setWidth`/`setHeight`/`setOpacity`/`setZIndex` use (`setElementStyle`, `Component.ts:1767`). Its own JSDoc (`Component.ts:3258-3262`) says as much: "`setTranslate` writes `transform` as an inline style on a separate surface … the cached value here is the rule-side value only."
  - Probe **P11**: a quiet pan frame's write log is exactly `["setRuleStyles"]`. 40 consecutive pan frames = 40 writes, all `setRuleStyles`, zero appends/creates.
  - Probe **P2**: 10 `pointermove` calls → 10 `transform` rule writes on the host's `#id` selector.
  - Probe **P3**: 5 wheel notches → 5 rule writes. Probe **P7**: 10 resize frames → 10 rule writes.
  - No coalescing. `Split.scheduleDrag`/`flushDrag` and `DragManager.scheduleMove`/`flushMove` (see `plans/implemented/dragmanager-pointer-coalescing.md`, Architecture Decisions) are the library's two precedents for buffering a raw pointer stream to one rAF; `DiagramView` has neither.
  - No equality gate anywhere on the path: `setZoom` assigns and applies unconditionally, `applyTransformToHost` composes and writes unconditionally. `fitGraph` calls `setZoom` (write 1, against the *old* pan) then `centreGraph` (write 2); `applyLayout` writes at `:913`, then `tryInitialCentre` can write twice more in the same task.
- **Proposed change**: three separable steps, in increasing order of blast radius.
  1. Gate the write: `applyTransformToHost` composes the string, compares it with a cached `_appliedTransform`, and skips the write when equal — but still calls `updateResidency()`, which must run on a resize that changed no pan or zoom.
  2. Coalesce `_handlePointerMove`'s transform application to one `requestAnimationFrame`, `Split.scheduleDrag`-shaped: buffer the latest `(clientX, clientY)`, apply at most once per frame, cancel on `pointerup`/`destructor`. Leave the click-slop test inline and unthrottled (it is a pure field write).
  3. Move the transform off the rule and onto the inline-style surface. This needs a library seam: `Component.setTranslate` (`Component.ts:4647`) is the inline-transform writer but carries translate only, and `setElementStyle` is `protected`, so `DiagramView` cannot reach it on a plain `Container`. Either extend `setTranslate` to take an optional scale, or add a public inline-transform setter beside it, and route `applyTransformToHost` through it. **This is a library gap, not a diagram workaround** — it should be decided upstream rather than by making `_contentHost` a bespoke `Component` subclass.
- **Risk / blast radius**: `applyTransformToHost` is the single funnel every pan/zoom/centre/resize path ends in (`setZoom`, `centreGraph`, `centreNode`, `zoomAboutViewportPoint`, `anchorCentreAcrossResize`, `applyLayout`), so a gate there is one change with wide reach. `DiagramView.test.ts` reads `view._contentHost.getTransform()` in ~30 assertions (`parseTransform`, `graphPointAt`, `centreGraphPoint` helpers at `:151-171`) — `getTransform()` reflects the *rule* value, so moving to the inline surface breaks every one of those unless the cached string is still exposed. Step 3 also changes which surface wins over a theme/class rule; `_contentHost` has no class rule of its own, so that is a non-issue here but is for a general `Component` setter.
- **Proof at implement time**: a probe asserting `setRuleStyles` count `=== 0` across N `pointermove` calls and `<= 1` per animation frame; and ms/frame on a WebKitGTK recording of a `Split`-gutter drag over a pane holding a ≥200-node diagram, against the same recording today.

### F27.2 `nodeIdAt` scans every node in the graph, with a DOM lookup each, on every pointer event

- **Category**: A, H
- **Impact**: HIGH — O(N) DOM lookups per `pointerdown`, and again per `click`; N is the whole graph, not the mounted subset.
- **Where**:
  - `component/diagram/DiagramView.ts:1896-1912` (`nodeIdAt`)
  - callers: `:2151` (`_handlePointerDown`), `:1944` (via `nodeIdAtEvent` ← `_handleClick:1852`, `_handleDoubleClick:1877`, `_handleContextMenu:2081`)
  - `core/Component.ts:1284-1297` (`getElement`) — a miss falls through to `DOM.source.getElementById` and is **not** cached (`this._element = null` leaves the next call to repeat it)
  - `core/DOM.ts:2703-2707` (production `getElementById` = `document.getElementById`)
- **Hot path**:
  1. native `pointerdown` → `_handlePointerDown` (`:2138`)
  2. `isControlsTarget(event.target)` (`:2151` → `:2104`) — 1 `intern`, 1 `contains`
  3. `nodeIdAt(event.target)` (`:2151`) — 1 `intern`, then for **each** entry of `_nodeComponents`: `component.getElement()` (a `document.getElementById` when the node was never mounted) and `DOM.source.contains` when it was
  4. the native `click` that follows repeats steps 2–3 through `nodeIdAtEvent`
- **Evidence**: probe **P10** — a 400-node graph at zoom 1 with 210 resident: one `pointerdown` plus one `click` on empty canvas = **380 `getElementById` + 422 `contains` = 802 DOM lookups**. Probe **P4**, with every node forced to have an element, shows the pure `contains` form: 401 calls for a single `pointerdown`.
- **Proposed change**: iterate `this._residentIds` rather than `this._nodeComponents` — a component that is not mounted has no element in the document and cannot be the event target, so the scan is already answering a question it cannot answer "yes" to for those nodes. That alone removes every `getElementById`. Beyond that, keep a `Map<Handle, string>` written by `mountNode`/`unmountNode` (`:1094`, `:1121`) and resolve the target by walking up with `DOM.source.getParentElement`/`closest` until a handle in the map is hit — O(depth) instead of O(resident).
- **Risk / blast radius**: `nodeIdAt` is also the "is this press on a node?" gate that decides whether a drag pans (`:2151`), so a behaviour change here changes the pan/click contract. Pinned by `DiagramView.test.ts` "a click on a simplified node selects it", "a press on a simplified node pans", "an edge press pans but still does not clear the selection", and the node-virtualization block ("selection survives an unmount / remount cycle"). The simplified path (`nodeIdAtGraphPoint`, `:1985`) is unaffected — it is already geometric.
- **Proof at implement time**: a probe counting `DOM.source.getElementById` + `DOM.source.contains` calls for one `pointerdown` + `click` on a 400-node graph; today 802, target O(depth).

### F27.3 A zoom or resize frame recomputes the LOD statistic and both residency sets from scratch

- **Category**: D, G
- **Impact**: HIGH — per wheel notch, and per frame for the whole duration of a pane resize.
- **Where**:
  - `component/diagram/DiagramView.ts:1044-1080` (`updateResidency`)
  - `:1056` — `medianLeafHeight(this._nodeRects, this._containerIds)` is evaluated as an *argument*, so it runs even when `shouldSimplify`'s node-count floor would reject immediately (`:193`)
  - `component/diagram/DiagramView.ts:157-173` (`medianLeafHeight`) — builds an array of every leaf height and `sort`s it
  - `:1063` — `computeResidentIds` (`DiagramResidency.ts:385-403`) allocates a `Set` over every node id
  - `:1079` → `DiagramEdgeLayer.setResidency:860-866` → `recomputeResidentEdges:790-794` (allocates `this._edges.map(e => e.id)` **plus** a `Set`) → `updateDrawnEdges:812-846` (allocates `new Map(this._drawn.map(…))` plus a `next` array)
  - the gate: `DiagramResidency.residencyNeedsRefresh:341-356` returns `true` whenever the live rect's extents differ from the committed one — which is every zoom notch and every resize frame
- **Hot path** (resize): `Body`/`Split` resize → `DiagramView.doLayout:1738` → `anchorCentreAcrossResize:1759` → `applyTransformToHost:1002` → `updateResidency:1044` → `medianLeafHeight` sort + `computeResidentIds` + `setResidency` + `recomputeResidentEdges` + `updateDrawnEdges`.
- **Evidence**: probe **P3** — 5 wheel notches on a 400-node/399-edge graph produced 5 `setResidency` calls and 5 `setNodes` calls. Probe **P7** — 10 resize frames produced 10 `setResidency` calls and 10 transform rule writes. Reading `updateResidency` confirms `medianLeafHeight` is unconditional on the option being on (`isSimplifyAtLowZoom()` defaults `true`).
- **Proposed change**: three caches, none of which touches the refresh rule the node-virtualization plan fixed (`plans/implemented/diagram-node-virtualization.md`, "The residency rect is sized from the viewport and re-centred by hysteresis" — I am not proposing to change *when* the rect is recomputed, only what the recompute costs).
  1. Cache the median leaf height in a field recomputed in `promoteIncomingNodes` (`:703`), the only place `_nodeRects`/`_containerIds` are replaced. Both maps are swapped by identity, never mutated in place, so the cache invariant is a one-line assignment.
  2. Short-circuit `shouldSimplify` on the node-count floor before the statistic is needed — i.e. pass a thunk, or test `this._nodeComponents.size < LOD_MIN_NODES` first.
  3. In `recomputeResidentEdges`, iterate `this._edges` directly instead of materialising an id array; in `updateDrawnEdges`, keep `_drawn` as a `Map<string, DrawnEdge>` field rather than rebuilding one per call.
- **Risk / blast radius**: the cached median must be invalidated on every path that replaces `_nodeRects` — `promoteIncomingNodes` is the only one today, but `handleLayoutFailure` and `destructor` also touch the incoming maps. `DiagramLevelOfDetail.test.ts` pins `medianLeafHeight`/`shouldSimplify` as pure functions, so caching must happen in the caller, not inside them. `DiagramResidency.test.ts` pins `computeResidentIds`'s signature (`ids: Iterable<string>`).
- **Proof at implement time**: a probe asserting `medianLeafHeight` is evaluated once per ELK pass rather than once per residency refresh (count via a spy on a `private medianLeafHeight()` wrapper), and allocation count per wheel notch under `--expose-gc` or a simple call counter.

### F27.4 No compositor hint on the pan/zoom target

- **Category**: F
- **Impact**: HIGH — every pan frame re-rasterises the whole visible canvas in software Cairo. **Reasoned, not measured**: this environment cannot record paint.
- **Where**:
  - `component/diagram/DiagramView.ts:479-481` (the `_contentHost` construction) — `setTransformOrigin` is set, `setWillChange` is not
  - grep: `grep -rn "setWillChange" packages/lib/src/typescript/lib/component/diagram/` → **0 hits**; the same grep over `packages/lib/src/typescript/lib/` hits `VirtualRowView.ts`, `table/Table.ts`, `Scrollbar.ts`, `Accordion.ts`, `CollapseSupport.ts`, `LayoutManager.ts`, `AnimatedDropdown.ts`, `OverlayFade.ts`, `AbstractWindow.ts`
  - `packages/lib/docs/concepts/performance.md` § "Compositor-layer hints" documents the mechanism and names window drag, virtual rows and the table header as the framework's own automatic users
- **Hot path**: `_handlePointerDown:2138` → (no hint) → `_handlePointerMove:2171` → transform write → browser re-rasterises the content host subtree, which holds the edge layer's 3 elements per drawn edge (`drawHitPath`, `drawVisiblePath`, optional `drawLabel`) plus either every mounted node component or every simplified `<rect>`.
- **Evidence**: source reading plus the grep above. The subtree size is real: probe **P9** reports 211 drawn edges on a 400-node graph at zoom 1; probe **P6** reports 400 `<rect>` children while simplified.
- **Proposed change**: `this._contentHost.setWillChange("transform")` on `pointerdown` when the press will pan (`:2155`, beside the `setCursor("grabbing")`), cleared on `pointerup` (`:2211`) and on the button-released branch (`:2194`); and set-then-clear around a wheel burst with a short settle timer, mirroring `AbstractWindow`'s mousedown/mouseup pairing. The doc's own guidance — set over the active-motion lifetime, clear promptly — applies directly, and one element is far under the browser threshold.
- **Risk / blast radius**: none in the library; `setWillChange` is a documented public setter. A permanently-set hint would cost GPU memory, so the set/clear pairing matters.
- **Proof at implement time**: ms/frame on a WebKitGTK Timeline recording of a pan drag over a 300-node diagram, before and after; expect the gain to be paint-side, not JS-side, so a write-count probe will not show it.

### F27.5 Residency churn mutates the content host from inside `doLayout`, contradicting the method's own JSDoc

- **Category**: D, H
- **Impact**: MEDIUM — one extra scheduled layout pass per resize frame in which the mounted set changes.
- **Where**:
  - `component/diagram/DiagramView.ts:1726-1746` (`doLayout` and its JSDoc)
  - `:1742` → `anchorCentreAcrossResize:1759` → `:1784` `applyTransformToHost()` → `:1007` `updateResidency()` → `:1067` `unmountNode` / `:1073` `mountNode`
  - `:1094-1109` (`mountNode`) writes `component.setWidth` / `setHeight` on a child, then `this._contentHost.addComponent(component)`
  - `core/Component.ts:6821` (`insertComponent`) → `:6856` `this.scheduleLayout()`; `core/Component.ts:6959` (`removeComponent`) → `:6968` `this.scheduleLayout()`
- **Hot path**: as above, once per resize frame whose viewport-extent change moves a node in or out of the residency rect.
- **Evidence**: the JSDoc at `:1731-1735` states "Writes only the content host's transform and the (unmanaged) overlay, **never a child's rect**, so neither can feed back into the layout it runs inside." Reading the chain shows both halves are false: `mountNode` writes a child's width and height, and `addComponent`/`removeComponent` schedule a layout on `_contentHost`. `packages/lib/docs/concepts/performance.md` § "Avoiding layout thrash" names this pattern explicitly ("Mutating during a layout callback … re-enters the layout pass").
- **Proposed change**: split the resize response. `anchorCentreAcrossResize` keeps the pan write (it is what holds the viewport centre still) but defers the residency reconciliation to `Component.afterNextLayout` — the uplift `plans/implemented/resize-settle-afternextlayout-uplift.md` already established for exactly this "do it after the pass, not inside it" shape. Failing that, correct the JSDoc so the next reader is not misled.
- **Risk / blast radius**: deferring residency by one frame means a node entering the viewport during a fast resize appears a frame late; the residency margin (half a viewport) is sized to absorb exactly that. `DiagramView.test.ts`'s virtualization block drives `setSize` + `doLayout` synchronously and asserts the mounted set immediately afterwards, so several of those tests would need an `afterNextLayout` flush.
- **Proof at implement time**: layout-passes-per-second in `DiagnosticsOverlay` during a gutter drag over a diagram, and a probe asserting one `doLayout` per `setSize` rather than two.

### F27.6 `applyLayout` reconciles the *old* graph's edges immediately before releasing all of them

- **Category**: B, E
- **Impact**: MEDIUM — once per ELK pass, proportional to the previous graph's edge count.
- **Where**: `component/diagram/DiagramView.ts:897` (`promoteIncomingNodes()`) vs `:902` (`this._edgeLayer.setEdges(...)`)
- **Hot path**:
  1. `applyLayout:877` → `promoteIncomingNodes:703`
  2. `:713` `this._residencyViewport = null` → `:734` `updateResidency()` → `:1079` `this._edgeLayer.setResidency(residency)`
  3. `DiagramEdgeLayer.setResidency:860` → `recomputeResidentEdges` + `updateDrawnEdges` — against `_edges`, which still holds the **previous** graph's routes, so newly-admitted old edges are drawn
  4. back in `applyLayout:902` → `setEdges:496` → `rebuildPaths:746` releases every drawn edge and redraws from the new routes
- **Evidence**: source reading of the call order. Because `promoteIncomingNodes` nulls `_residencyViewport`, step 3's refresh gate always opens, so the wasted reconcile is unconditional, not occasional.
- **Proposed change**: hand the edge layer its new routes before the residency push — either call `setEdges` before `promoteIncomingNodes`, or have `promoteIncomingNodes` skip the edge-layer half of `updateResidency` (a `skipEdges` flag, or by splitting `updateResidency` into node and edge halves so `applyLayout` can order them).
- **Risk / blast radius**: `setEdges` clears `_edgeEmphasis` (`:498`), and `promoteIncomingNodes` clears `_selection`/`_nodeEmphasis` — the order between those two clears is observable to `DiagramView.test.ts`'s "a setData whose layout lands clears the emphasis" and "a setData whose layout fails leaves the previous graph's emphasis in place". Reordering must not change which of the two clears wins.
- **Proof at implement time**: a probe counting `createElementNS('path')` across one `setData` on a settled 400-edge view; today it draws some old edges that are released in the same task.

### F27.7 Promoting a new graph repaints every simplified rect for an emphasis that is already empty

- **Category**: B, E
- **Impact**: MEDIUM — one 9-attribute patch per drawn rect per `setData`, on rects that are released a few statements later.
- **Where**:
  - `component/diagram/DiagramView.ts:727-728` (`this._nodeLayer.setSelected(null); this._nodeLayer.setEmphasis(new Set());`)
  - `component/diagram/DiagramNodeLayer.ts:190-198` (`setEmphasis` repaints every `_drawn` key unconditionally)
  - `:273-287` (`repaint`) → one `DOM.sink.apply` with `removeAttr: ["opacity"]` plus the full 9-key `rectAttrs` bag
  - `:207-231` (`redraw`) then releases every one of those rects when `setNodes` runs at `DiagramView.ts:1059`
- **Hot path**: `setData` → `applyLayout:897` → `promoteIncomingNodes:728` → `setEmphasis(new Set())` → N repaints → `:734` `updateResidency` → `setNodes` → `redraw` → N releases + N creates.
- **Evidence**: probe **P6** — a second `setData` on a simplified 400-node view issues 1639 `apply` writes, of which **402 carry `removeAttr: ["opacity"]`**, i.e. the repaint form. `setSelected(null)` is already correctly gated (`:170-177` no-ops when `_selected` was already `null`); `setEmphasis` is not.
- **Proposed change**: give `setEmphasis` the same shape as `setSelected` — repaint only the symmetric difference between the old and new sets, and no-op when both are empty. Independently, move the two state clears in `promoteIncomingNodes` to *after* `updateResidency`, so they act on the new draw rather than the outgoing one.
- **Risk / blast radius**: `DiagramNodeLayer.test.ts` pins "setEmphasis(new Set()) removes the opacity attribute from every rect" and "state applied before a draw survives it" — the first asserts the removal happens, so a gate must keep the behaviour for a non-empty→empty transition and only skip empty→empty.
- **Proof at implement time**: a probe asserting zero `apply` writes for `setEmphasis(new Set())` on a layer whose emphasis is already empty; and the `removeAttr` count in P6 dropping from 402 to ~0.

### F27.8 `setEdgeEmphasis` releases and recreates every drawn edge element

- **Category**: F, H
- **Impact**: MEDIUM — per emphasis change, which for the shipped consumer pattern (emphasise a node's edges on selection) is per click.
- **Where**: `component/diagram/DiagramEdgeLayer.ts:531-544` (`setEdgeEmphasis`) → `:746-760` (`rebuildPaths`) → `:954-962` (`releaseDrawnEdge`, 2–3 `removeChild` + `release` per edge) → `:812-846` (`updateDrawnEdges`) → `:769-787` (`drawEdge`, 2–3 `createElementNS` + `apply` + `appendChild` per edge)
- **Hot path**: consumer `click` listener → `DiagramView.setEdgeEmphasis:1486` → `DiagramEdgeLayer.setEdgeEmphasis:531` → full release + full redraw.
- **Evidence**: source reading. The code's own comment (`:534-540`) records the decision and its measurement: "a redraw of a 1000-edge graph's paths measures around 20ms". That number is not a WebKitGTK/software-Cairo number, and the briefing's cost model says paint- and layout-bound Chromium numbers do not transfer. `DrawnEdge` (`:353-365`) already stores `group`, so the information needed for a diff is present.
- **Proposed change**: reconcile by group membership instead of rebuilding — for each entry in `_drawn`, compare `drawn.group` with `groupFor(drawn.id)`; when they differ, move the 2–3 elements into the new group and update the record; when they match, leave them alone. Element count, attribute bags and `d` strings are all unchanged by an emphasis change, so nothing else needs rewriting. The comment's stated reason for avoiding this — "instead of relying on appendChild's move semantics through the DOM seam" — is the point to re-examine: `DOM.sink.appendChild` resolves to `parent.appendChild`, whose move semantics are specified, and the recording sink models it.
- **Risk / blast radius**: `DiagramEdgeLayer.test.ts` has a block pinning that an emphasis change puts an edge's hit path, visible path and label in the same group, and that a second `setEdges` releases both paths of each previous edge. A move-based reconcile must keep the three elements adjacent and in hit-before-visible order (`:227` "appends the hit path before the visible path").
- **Proof at implement time**: a probe counting `createElementNS` + `release` for a `setEdgeEmphasis` on a 400-edge layer; today ≈ 2×400 of each, target ≈ 2× the number of edges that actually changed group.

### F27.9 Edge hover costs a live `getBoundingClientRect` plus a full route scan, per `mousemove`

- **Category**: A, G, I
- **Impact**: MEDIUM — per `mousemove` anywhere over the diagram (the cheap half), and per `mousemove` over an edge (the expensive half).
- **Where**:
  - `component/diagram/DiagramView.ts:2014-2045` (`_handleEdgeMouseMove`), registered as a subtree listener at `:1820`
  - `:2019` → `DiagramEdgeLayer.edgeIdAt:563-571` — one `DOM.source.intern` plus a linear `Array.find` over `_drawn`, on **every** mousemove, including ambient hover over empty canvas or a node
  - `:2025` → `graphPointFor:1922-1930` → `DOM.source.getViewportRect(this)` — production `getBoundingClientRect()`
  - `:2026` → `edgesNear:584-588` → `distanceToRoute:287-299`, which allocates `[startPoint, ...bendPoints, endPoint]` per section per drawn edge
  - `:2040` rebuilds `new Map(this._options.data?.edges.map(…))` over **every** model edge on each hover change — the same map `joinEdgeStyles:969-973` builds per layout
- **Hot path**: native `mousemove` → `Event` capture → `_handleEdgeMouseMove` → (over an edge) `getViewportRect` read + O(drawn edges × segments) distance scan + `routes.map(...).join(" ")` allocation.
- **Evidence**: probe **P9** — 10 `mousemove` calls over an edge on a 400-node graph produced **10 `getViewportRect` reads** against **211 drawn edges**. `_handleWheel:2123` performs the same read per wheel event.
- **Proposed change**:
  - Cache the view's viewport rect in a field, refreshed on `pointerdown`/wheel-burst-start and invalidated by `doLayout` and by a viewport resize, rather than read per event. `Panel`'s scroll-metric settle machinery is the library's precedent for "read once per settled size, not per event".
  - Index `_drawn` by hit handle (`Map<Handle, DrawnEdge>`) so `edgeIdAt` is O(1), removing the per-mousemove linear scan.
  - Hoist the id→model-edge map to a field rebuilt in `setData`, and have `joinEdgeStyles` use it too (removes the duplication).
- **Risk / blast radius**: the cached rect goes stale if something moves the view without a layout pass (a scrolled ancestor). `DiagramView.test.ts`'s `"edgehover"` block includes "applies the pan/zoom inverse before hit-testing", which drives `_handleEdgeMouseMove` directly with a modelled rect, so it will keep passing; a real scrolled-ancestor case is not covered by any test today.
- **Proof at implement time**: a probe asserting `DOM.source.getViewportRect` call count `<= 1` per pointer gesture rather than per event, and `edgeIdAt` doing zero array scans.

### F27.10 An undisplayed diagram pays the whole refresh

- **Category**: E
- **Impact**: MEDIUM — a data refresh on a diagram in an inactive `Tab` page or a collapsed pane costs the same as a visible one.
- **Where**:
  - `component/diagram/DiagramView.ts:877-931` (`applyLayout`), `:703-735` (`promoteIncomingNodes`), `:1044-1080` (`updateResidency`), `DiagramEdgeLayer.ts:496-519` (`setEdges`) — none consults `isEffectivelyVisible()`
  - `component/diagram/DiagramView.ts:798-815` (`syncBusyIndicator`) gates on `getWidth() > 0` / `getHeight() > 0`, which read the **cached** committed size (`core/Component.ts:3339-3344`) and stay non-zero while `display: none`
- **Hot path**: consumer refresh while the diagram's tab is inactive → `setData` → `rebuildNodes` → ELK → `applyLayout` → full promote, full residency reconcile, full edge redraw, node-layer redraw, and a busy overlay mounted and laid out.
- **Evidence**: probe **P8** — a `setData` on a `setDisplayed(false)` view issued **3266 seam writes** and created **398 SVG paths**. `Panel.remeasureScrollMetrics` (`core/Panel.ts`, the `isEffectivelyVisible()` guard and its `onEffectiveVisibilityChange` catch-up) is the library's precedent for withholding and catching up; `plans/implemented/undisplay-inactive-tab-pages.md` is the decision that made inactive pages `display: none` in the first place.
- **Proposed change**: gate the *drawing* half — `updateResidency`'s mount/unmount and both layers' redraws — on `isEffectivelyVisible()`, and register an `onEffectiveVisibilityChange` catch-up that runs it once when the view comes back. The model half (`rebuildNodes`, ELK, `applyLayout`'s coordinate writes) must still run so `whenLaidOut()` resolves and a consumer gating a spinner on it is not stranded. `syncBusyIndicator` should add the same visibility test to its "nothing to cover" condition.
- **Risk / blast radius**: `whenLaidOut()`'s contract ("resolves once the layout pass in flight has placed its nodes") must not change — placement is the model half, so it does not. `DiagramView.test.ts` never exercises an undisplayed view, so this is an uncovered behaviour; new tests are needed either way.
- **Proof at implement time**: re-run probe P8 and assert the write count drops to the model-only floor, then assert the catch-up on `setDisplayed(true)` produces the full draw.

### F27.11 Every `setData` destroys and rebuilds every node component; there is no rebind path

- **Category**: H, D, G
- **Impact**: MEDIUM — per data refresh, proportional to graph size; the library's own virtual components solve this with rebinding.
- **Where**:
  - `component/diagram/DiagramView.ts:647-673` (`rebuildNodes`) — always builds a fresh component per node, keyed by nothing
  - `:703-710` (`promoteIncomingNodes`) — `component.dispose()` on every previous component
  - `:844-866` (`collectNodeSizes`) — `getPreferredSize()` on every incoming component, including containers whose entry the JSDoc itself calls "harmless-but-unused" (`ElkLayoutEngine.mapDiagramNode:153-159` returns before it reads `sizes` for a container)
- **Hot path**: `setData` → `rebuildNodes` (N constructions) → `relayout` → `collectNodeSizes` (N preferred-size resolutions) → ELK → `applyLayout` (3 setters × N) → `promoteIncomingNodes` (N disposals + N `setVisible(true)`) → `updateResidency` (mount the resident subset, N′ element creations).
- **Evidence**: probe **P12** — replaying the **identical** graph object on a 100-node view: **4466 seam writes, 202 `createElement`, 198 `createElementNS`, 398 `release`**, 2 `ensureStyleRule`, 0 `deleteStyleRule`. (The rule counts confirm the LOD plan's finding that the default renderer costs no per-instance rule — element churn, not rule churn, is the cost.) Probe **P13** confirms this is churn, not a leak: theme-listener count is stable at 3331 across four refreshes. `packages/lib/docs/concepts/performance.md` § "Virtual scrolling" states the contrasting rule the `Table`/`Tree` rows follow: "Pool slots are rebound to new data only when needed, not on every scroll tick".
- **Proposed change**: reuse a node component whose model data is unchanged. `rebuildNodes` gains a lookup into `_nodeComponents` by id and, when the previous `DiagramNodeData` for that id is `===` (or shallow-equal on the fields the renderer reads), moves the existing component into `_incomingComponents` instead of building a new one — the same "follow the node, not the position" rule `Tree`'s row slots use. Components whose ids survive keep their elements, their rules and their measured preferred sizes, so `collectNodeSizes` also gets cheaper. Separately, skip containers in `collectNodeSizes` — `buildElkGraph` never reads their entry.
- **Risk / blast radius**: significant. `promoteIncomingNodes`'s disposal loop currently owns the "every shown component is discarded" invariant that `destructor` and the node-virtualization plan's "Unmounting detaches the element" decision both lean on; reuse means a component can now be in both maps at once. Pinned tests: "D5: a setData that swaps out a node generation disposes the evicted components, not just detaches them", "a replaced graph disposes every previous node component and rebuilds residency from scratch", and the whole `DiagramView.incomingNodeDisposal.test.ts` file. A custom `nodeRenderer` returns an opaque `Component` with no update seam, so reuse is only safe when the data for that id is genuinely unchanged — the conservative identity gate, not a general rebind.
- **Proof at implement time**: re-run probe P12 and assert `createElement` ≈ 0 for an identical refresh; plus a WebKitGTK timing of a SQLAdmin-scale (≈325-node) refresh.

### F27.12 The simplified node layer draws every node in the graph, ignoring the residency rect computed beside it

- **Category**: E
- **Impact**: MEDIUM — N `<rect>` elements in the document while simplified, however much of the graph is off screen.
- **Where**: `component/diagram/DiagramView.ts:1059` (`setNodes(simplified ? this._nodeRects : EMPTY_RECTS, …)`) and `:1061-1063` (`next` forced empty while simplified); `component/diagram/DiagramNodeLayer.ts:207-231` (`redraw` creates one `<rect>` per entry of `_rects`)
- **Hot path**: zoom out past the engage threshold → `updateResidency` → `setNodes` with the full rect map → `redraw` → N `createElementNS` + N `apply` + N `appendChild` in one frame.
- **Evidence**: probe **P6** — 400 rects drawn for a 400-node graph while simplified. The `residency` rect is computed two lines above (`:1053`) and handed to the edge layer (`:1079`) but never to the node layer.
- **Counter-argument, stated**: at the engage threshold the median node renders under 16 px, so a graph of a few hundred nodes usually fits the viewport and culling would save nothing. The case that bites is the hysteresis band (rendered height 16–20 px, `LOD_DISENGAGE_HEIGHT` 20 vs `LOD_ENGAGE_HEIGHT` 16, `:128`/`:138`), where a large graph can be several viewports wide and still simplified. I did not measure how often real usage sits in that band.
- **Proposed change**: pass `computeResidentIds(this._nodeRects.keys(), this._nodeRects, residency)` to the node layer instead of the full map, and give `setNodes` the same difference-based reconcile `updateDrawnEdges` already has (draw the newly admitted, release the departed, leave the rest) rather than the current full release-and-redraw. The identity fast path at `DiagramNodeLayer.ts:138` would need replacing, since a culled map is a fresh object each refresh.
- **Risk / blast radius**: `DiagramNodeLayer.test.ts` pins "calling setNodes again with the identical two arguments issues no DOM write at all" — that identity contract is the current cheap path and would be replaced by a content diff. `DiagramView.test.ts` pins "after zoomToFit the view is simplified: every node component is unmounted and **the layer draws all of them**", which encodes today's behaviour directly.
- **Proof at implement time**: element count in the node layer while simplified on a graph three viewports wide, and `createElementNS` count per pan frame in that state.

### F27.13 Both SVG layers' `render()` draw is redundant offline and dead (or stale-targeted) in production

- **Category**: J, I
- **Impact**: LOW — no user-visible cost in production today; it is a second mechanism for a job the deferral already does, and it silently fails the one case it exists for.
- **Where**:
  - `component/diagram/DiagramEdgeLayer.ts:733-739` (`render`) → `:746-748` (`rebuildPaths` resolves `this.getElement()`)
  - `component/diagram/DiagramNodeLayer.ts:115-121` (`render`) → `:207-212` (`redraw`, identical shape)
  - `core/Component.ts:1284-1297` — `this._element` is assigned only **after** `render()` returns, so `getElement()` inside `render()` falls through to `DOM.source.getElementById`
  - `core/DOM.ts:2703-2707` — production `getElementById` is `document.getElementById`, which cannot find an element that has not been appended yet
- **Evidence**: probe **P1** — offline, with the modelled `getElementById` (`tests/dom/TestDOM.ts:1418`, a flat id index that finds detached nodes), forcing the element draws the two edges' 4 paths, and the first connected layout drains the `onFirstLayout` queue and draws them **again** (4 more `createElementNS`, 4 `release`). In production the first draw simply does not happen at `render()` time and the deferral is the only draw.
- **Already catalogued**: `plans/dom-only-state-inventory.md:142` (an **open** plan) records exactly this for `DiagramEdgeLayer`, verdict `replay`, with the same reasoning. It is still open. It does **not** list `DiagramNodeLayer`, which post-dates it and has the identical shape — carry that across.
- **Proposed change**: draw into the handle `render()` was just given rather than re-resolving — pass `element` down to `rebuildPaths(svg)` / `redraw(root)`. That makes the `render()` override do what it claims (self-heal an element rebuild) and makes the `onFirstLayout` deferral the only path for the detached case, ending the double draw offline.
- **Risk / blast radius**: `DiagramEdgeLayer.test.ts`'s "routes arriving before the layer is mounted" block pins both the deferral and the synchronous draw; neither changes. A rebuild-self-heal test does not exist today.
- **Proof at implement time**: a probe asserting exactly one draw per edge across `getElement(true)` + first connected layout.

### F27.14 The viewport↔graph mapping is written out five times

- **Category**: I
- **Impact**: LOW — code health. Carried from `plans/research/codebase-health-audit-2026-08-29.md` Priority 2 item 9 ("the viewport→graph coordinate inversion written out three times in `DiagramView`"); **still open**, and there are two more forward-mapping copies the audit did not count.
- **Where** (inversions, viewport → graph):
  - `component/diagram/DiagramView.ts:1028` (`viewportGraphRect`)
  - `:1374-1375` (`zoomAboutViewportPoint`)
  - `:1927-1928` (`graphPointFor`)
- **Where** (forward, graph → viewport pan):
  - `:1342-1343` (`centreGraph`)
  - `:1597-1598` (`centreNode`)
- **Proposed change**: one small value object or module — `graphToViewport(point, pan, zoom)` / `viewportToGraph(point, pan, zoom)` plus `panCentring(extent, graphExtent, zoom)` — in the shape `DiagramResidency.ts` already has for the rect helpers. Falls out naturally of the `DiagramViewport` extraction in F27.15.
- **Risk / blast radius**: pure arithmetic, fully covered by the existing `DiagramView.test.ts` transform assertions.
- **Proof at implement time**: existing tests pass unchanged; grep count of the literal `/ zoom` inversion drops from 3 to 1.

### F27.15 `DiagramView` carries about eight responsibilities in 2308 lines

- **Category**: H
- **Impact**: LOW — code health; it is the reason findings F27.1, F27.3, F27.5 and F27.6 are entangled in one call chain.
- **Where**: `component/diagram/DiagramView.ts` in full. The distinct concerns: (a) pan/zoom state and the transform write (`:1002-1008`, `:1136-1421`); (b) coordinate mapping (F27.14); (c) residency + LOD reconciliation (`:1044-1129`, plus the module helpers at `:157-200`); (d) hit testing (`:1896-2001`); (e) selection and node emphasis (`:1456-1545`, `:1639-1667`); (f) the control cluster (`:2215-2270`); (g) the busy overlay (`:786-815`); (h) ELK orchestration — generation tokens, the settled promise, failure handling (`:744-990`).
- **Evidence**: the file is the largest in the slice by a factor of two; the doc page and the class JSDoc describe (a), (d), (e) and (h) as the component's function. (c), (f) and (g) are implementation mechanisms that could live beside it.
- **Proposed change**: extract (a)+(b) as a `DiagramViewport` value type (pan, zoom, clamps, both mappings, `centre*` arithmetic), and (h) as a `DiagramLayoutSession` (generation token, settled deferred, busy-overlay lifecycle). Both are pure or nearly pure and would carry their own tests. (c) probably stays — it is the one place that legitimately needs both the viewport and the component maps.
- **Risk / blast radius**: mechanical; `DiagramView.test.ts` reaches into `_contentHost`, `_nodeComponents`, `_nodeRects`, `_residentIds`, `_simplified`, `_edgeLayer` and `_nodeLayer` by name in dozens of places, so any field move is a wide test edit.
- **Proof at implement time**: none needed beyond the existing suite; this is a readability change and should ride behind the measured ones.

### F27.16 Dead option surface and stale citations

- **Category**: J
- **Impact**: LOW.
- **Items**:
  - **`DiagramEdgeData.label`** (`DiagramModel.ts:262-263`) — documented as "routing/placement of labels is left to ELK", but `buildElkGraph:210-214` maps each edge to `{ id, sources, targets }` only, and `DiagramEdgeLayer.drawEdge:782-784` renders `style.label`, never `edge.label`. Grep: `grep -n "label" ElkLayoutEngine.ts` → 3 hits, all in prose; `grep -n "\.label" DiagramEdgeLayer.ts` → 3 hits, all `style?.label` / `drawn.label`. Zero consumers. Either wire it (an ELK `labels` array plus a rendered label) or delete it.
  - **`ElkConstructorOptions.workerUrl`** (`elkjs.d.ts:14`) — `grep -rn "workerUrl" packages/lib/src packages/lib/tests packages/docs/docs packages/docs/src` → **1 hit, its own declaration**. `ElkLayoutEngine.createElk`'s JSDoc (`:561-568`) still describes three modes "checked in that precedence order", including "a consumer-hosted worker URL"; the body (`:570-583`) has two. Delete the field and fix the comment.
  - **Stale plan citation** — `DiagramEdgeLayer.ts:107` cites "the fk-diagram-cardinality-and-index-coverage plan"; `grep -rn "fk-diagram-cardinality" plans/` → 0 hits. This is the health audit's "a plan-name reference in `DiagramEdgeLayer.ts` to a plan that doesn't exist in this repo"; **still open**.
  - **`{@link}` to doc-excluded symbols** — the health audit cites `DiagramEdgeLayer.ts:474/477`; those lines have moved (they are now `setEdges`'s prose, which uses markdown links, not `{@link}`). The remaining candidate is `routeBounds`'s JSDoc at `:316-317`, an exported `@internal` function linking two module-private symbols (`distanceToRoute`, `EDGE_BOUNDS_PADDING`). **Not verified** — I did not run `npm run docs:api`, since it writes generated output.
  - **`on('activate', …)`** is implemented (`DiagramView.ts:1684`, `:1876-1888`) and named in the class JSDoc, but is missing from the doc page's "Common methods" table (`packages/lib/docs/components/DiagramView.md`), which lists the other five events. Doc gap, not dead code.

### F27.17 `DiagramView extends Panel` but never scrolls

- **Category**: H
- **Impact**: LOW.
- **Where**: `component/diagram/DiagramView.ts:292` (`class DiagramView extends Panel<DiagramViewOptions>`); `core/Panel.ts:105-111` (`autoScroll: "none"` default), `:650-705` (`doLayout`).
- **Evidence**: the view never calls `setAutoScroll`, so `remeasureScrollMetrics` (`Panel.ts`, first statement `if (this._autoScroll === "none") return;`) and `scheduleGutterSettleOnShrink` both no-op on every pass, and the overlay-scroll branch is never taken. The clipping the module header credits to the viewport (`DiagramView.ts:12-13`, "`overflow: hidden`") comes from `core/ComponentDefaults.ts:37`, a plain `Component` default, not from `Panel`. What `Panel` actually contributes is `insets: 4,4,4,4` plus a `commitElementStyle()` and two cached reads per layout pass.
- **Proposed change**: consider `Component` with an explicit `insets` default. Low value on its own; worth folding into F27.15 if that extraction happens.
- **Risk / blast radius**: `DiagramViewOptions extends PanelOptions` is public API, so the base change is breaking for any consumer passing a `Panel`-only option. Probably not worth doing alone.

### F27.18 ELK round trip: observations

Not a finding on its own; recorded because the briefing asks for the trace and two of the items above sit on it.

- `relayout:744` → `armLayoutSettled` → `syncBusyIndicator` → `collectNodeSizes:844` (N `getPreferredSize()` resolutions, including containers whose entries ELK never reads — see F27.11) → generation bump → `ElkLayoutEngine.layout:431`.
- `layout:440` builds the whole ELK JSON (`buildElkGraph:203`, O(N+E) allocation), awaits `ensureElk:513` (memoised dynamic import — correctly shared across overlapping calls), then `elk.layout(graph)`.
- **With the default (no `elkWorkerFactory`) the compute runs on the main thread**, so the busy overlay the doc page describes as reading "as 'working' rather than as a frozen canvas" cannot animate for the duration of exactly the pass it exists to cover. The overlay is still worth having (it blocks pointer input and it does animate in worker mode), but the doc's framing overstates the default. Making the worker the default is not straightforwardly available to the library — the worker URL must be resolved by the consumer's bundler, which is why `elkWorkerFactory` is consumer-supplied — so this is an observation, not a proposal.
- `mapElkResult:310` allocates a flat node array, an origins `Map`, a collected-edge array and (for compound graphs) fresh section objects. Once per pass; fine.
- Disposal and worker-fallback handling (`:431-502`) are thorough and well tested (`ElkLayoutEngine.test.ts` E1–E14). No findings.

---

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `DiagramView` (`DiagramView.ts:292`) | Read-only graph viewer: pan, zoom, node selection, ELK-driven auto layout | root `<div>` (via `Panel`); indirectly the content host, both layers, the control cluster, the busy overlay | **writes**: 1 `transform` stylesheet-rule write per pan event / wheel notch / changed-size layout pass; child `setWidth`/`setHeight` per mount. **reads**: cached `getWidth`/`getHeight` (no DOM); `getViewportRect` per wheel and per edge-hover mousemove; O(N) `getElementById`/`contains` per pointer event | over-built | F27.1, F27.2, F27.3, F27.5, F27.6, F27.10, F27.11, F27.14, F27.15, F27.17 |
| `DiagramEdgeLayer` (`DiagramEdgeLayer.ts:374`) | One `<svg>` drawing the routed edges, with markers, dash, labels and invisible hit paths | root `<svg>`, `<defs>` + 5 `<marker>` (8 leaf shapes), 2 persistent `<g>`, 2–3 elements per drawn edge | **writes**: none per pass; a full release+redraw per `setEdges` and per `setEdgeEmphasis`; a difference-based reconcile per `setResidency`. **reads**: none | fits, with one over-built path | F27.6, F27.8, F27.9, F27.13 |
| `DiagramNodeLayer` (`DiagramNodeLayer.ts:59`) | One `<svg>` drawing a plain `<rect>` per node while LOD simplification is engaged | root `<svg>`, one `<rect>` per node id | **writes**: none per pass; full release+redraw per `setNodes` with a new map; 1 patch per repainted rect on `setSelected`/`setEmphasis`. **reads**: none | fits, with two unchanged-value paths | F27.7, F27.12, F27.13 |
| `DiagramNode` (`DiagramNode.ts:83`) | Default node renderer: themed rounded box with glyph + label + optional badge, `.selected` state | its `Panel` root plus an `IconText`/`Text` (and a badge row) | **writes**: none per pass; `.selected` class toggle on selection change, correctly gated by `Component.setStyleState` (`core/Component.ts:6213-6215`) (probe P5: one `apply` for a whole `selectNode`) | fits | — (churned by F27.11) |
| `DiagramGroupNode` (`DiagramGroupNode.ts:64`) | Default container renderer: titled translucent box painted behind its flat-sibling children | its `Panel` root plus a header `IconText`/`Text` | **writes**: none per pass | fits | — (its `collectNodeSizes` entry is dead — F27.11) |
| `DiagramModel.ts` | The three plain model interfaces plus `DiagramPortData` / `DiagramEdgeStyle` / `DiagramEdgeMarker` | none | none | fits, one dead field | F27.16 (`DiagramEdgeData.label`) |
| `DiagramResidency.ts` | Rect helpers: inflate, refresh gate, intersection, resident-id set | none | pure; allocates one `Set` per `computeResidentIds` call | fits | F27.3 (call frequency, not the helpers) |
| `ElkLayoutEngine.ts` | The sole ELK adapter: model → ELK JSON, lazy import, worker mode + fallback, result → model | none | none | fits | F27.16 (`workerUrl` doc), F27.18 |
| `medianLeafHeight` / `shouldSimplify` (`DiagramView.ts:157`, `:192`) | The LOD trigger, split out as pure functions | none | `medianLeafHeight` sorts an O(N) array **per residency refresh** | fits as functions; mis-scheduled by the caller | F27.3 |
| `routeBounds` / `labelPoint` / `midpointAlong` / `buildPathData` / `distanceToSegment` / `distanceToRoute` (`DiagramEdgeLayer.ts:179-351`) | Pure route geometry | none | `distanceToRoute` allocates a point array per section per call, and is called per drawn edge per hover mousemove | fits; hot-path allocation | F27.9 |
| `elkjs.d.ts` | Local ambient types for the optional peer dep | none | none | one dead field | F27.16 |
| `index.ts` | Package-entry re-exports | none | none | fits — every export has a consumer in docs or tests | — |

---

## Redundant, duplicated and dead code

Items not already covered by a finding above.

1. **`isControlsTarget` and `nodeIdAt` repeat the intern-then-contains idiom.** `DiagramView.ts:2104-2113` and `:1896-1912`, and `nodeIdAtEvent:1953-1961` writes a third copy of the same "is this handle inside that element" test. A `containsTarget(componentOrHandle, target)` private helper would replace all three. `grep -c "DOM.source.contains" DiagramView.ts` → 3.
2. **`joinEdgeStyles`'s id→model-edge map is rebuilt inline in the hover handler.** `DiagramView.ts:970` and `:2040` are the same expression. Covered by F27.9's third bullet, listed here because it is also plain duplication.
3. **`DiagramEdgeLayer` and `DiagramNodeLayer` duplicate their constructor preamble and their `SVG_NS` constant.** `DiagramEdgeLayer.ts:22` / `DiagramNodeLayer.ts:27` (`const SVG_NS`), and the identical three-call constructor body `setPointerEvents("none")` + `setCursor("inherit")` + `setOverflow("visible")` (`DiagramEdgeLayer.ts:438-449`, `DiagramNodeLayer.ts:89-98`, with the node layer's `setOverflow` comment copied verbatim from the edge layer and describing markers and haloed labels the node layer does not draw). A shared `AbstractDiagramSvgLayer` base — or at least a shared constant — would carry the release/track/redraw idiom both repeat. `grep -rn "SVG_NS" packages/lib/src/typescript/lib/` → 2 files in this slice, plus `chart/AbstractChart.ts` and `display/Glyph.ts` define their own; a library-wide constant is arguably the right home.
4. **`_drawn` is a linear array in the edge layer and a `Map` in the node layer** for the same job (`DiagramEdgeLayer.ts:380` vs `DiagramNodeLayer.ts:68`). The array form forces the O(n) `find` in `edgeIdAt` (F27.9).
5. **No dead exports in the slice.** Every symbol in `index.ts:1-13` has a consumer. Counts (`grep -rn "\b<sym>\b"`, excluding the diagram source directory): `EDGE_MARKER_EXTENT` — 4 test + 5 docs; `rectsIntersect` — 7 tests; `anyRectIntersects` — 6 tests; `routeBounds` — 8 tests; `medianLeafHeight` / `shouldSimplify` — exercised through `DiagramLevelOfDetail.test.ts`. `DiagramPortData` — 0 tests, 6 docs (the `ports` field itself is tested 11 times via `ElkLayoutEngine.test.ts`). Note that the docs **app** does not instantiate a `DiagramView` anywhere (`grep -rln "DiagramView" packages/docs --exclude-dir=dist` → `src/content/pages.ts` nav entry, `src/shell/DocsShell.ts` comment, `public/llms.txt`) — so every option on `DiagramViewOptions` is exercised only by the lib's own tests and by out-of-repo consumers.

---

## Cross-slice notes

- **→ 01 core-component-lifecycle / 02 core-component-styling: `Component.setTransform` writes a stylesheet rule.** `Component.ts:3276` routes `transform` through `setElementCSSRule`, while every other geometry setter (`setX`/`setY`/`setWidth`/`setHeight`) and `setTranslate` use the inline surface. Under the briefing's cost model that makes `setTransform` the single most expensive geometry setter on the `Component` API, and nothing in its JSDoc says so. Any component animating a transform per frame inherits the problem; `DiagramView` is the one I can name. The fix belongs upstream: either extend `setTranslate` to carry a scale, or add a public inline-transform setter. (F27.1)
- **→ 01 core-component-lifecycle: `Component.getElement()` does not cache a miss.** `Component.ts:1284-1297` assigns `this._element = element` even when the lookup returned `null`, so `_element` stays falsy and the next call repeats `document.getElementById`. Any O(N) loop over unrendered components pays N document lookups every time. (F27.2)
- **→ 03 core-dom-seam-events: `Event` has no per-frame coalescing for `pointermove`/`mousemove`.** Every consumer that needs it (`Split`, `DragManager`, and now `DiagramView`) hand-rolls the same rAF buffer. A `{ coalesce: true }` registration option on `Event.addSubtreeListener` would make the pattern a seam rather than a convention. (F27.1)
- **→ 03 core-dom-seam-events: the offline `getElementById` finds detached elements.** `tests/dom/TestDOM.ts:1418` resolves against a flat id index with no notion of document membership, while production (`DOM.ts:2703`) is `document.getElementById`. Any `render()` override that resolves its own element through `getElement()` therefore behaves differently offline than in production — which is exactly what made probe P1's double draw invisible to the real suite. Worth considering whether the modelled source should model connectedness here.
- **Doc correction, → 01/whoever owns `packages/lib/docs/concepts/performance.md`:** § "Avoiding layout thrash" says "Reading `getSize()` between sets. Every `getSize` call forces a flush so the read is up-to-date." `Component.getSize:3339-3344` returns the cached `_width`/`_height` and forces nothing. `DiagramView` relies on that being cheap (`viewportGraphRect` calls it per pan event), and it is — but the doc says otherwise.
- **Open plan `plans/dom-only-state-inventory.md` has two stale rows for this slice.** Line 141's `DiagramView` row claims pan/zoom state lives in `Component.setScrollLeft`/`setScrollTop`; `grep -n "setScrollLeft\|setScrollTop\|getScrollLeft\|getScrollTop" component/diagram/*.ts` → **0 hits**. Pan is a transform on the content host and has been for some time. Line 224's row cites six listeners at `DiagramView.ts:661-671`; there are now nine, at `:1804-1821`, and all nine are `addSubtreeListener`. Both rows need re-deriving before that plan is implemented. Line 142's `DiagramEdgeLayer` row is still accurate — see F27.13.

---

## Suggested plan grouping

**Plan A — "diagram viewport transform off the stylesheet rule" (F27.1, F27.4).** The single largest win, and the only one whose fix reaches outside the slice. Three steps, measurable separately: (1) gate `applyTransformToHost` on the composed string; (2) coalesce `_handlePointerMove` to one rAF, `Split.scheduleDrag`-shaped; (3) the upstream inline-transform seam plus a `setWillChange` pairing on the pan gesture. Step 3 depends on a `Component` API decision — **cross-slice dependency on 01/02** — and should be raised with the library owner before it is planned, per the "never paper over a library gap" rule. Steps 1 and 2 are self-contained and can ship first.

**Plan B — "diagram pointer hit-testing" (F27.2, F27.9, plus item 1 and 2 of the redundancy list).** One coherent change set: scan only the resident set, index both `_nodeComponents`-by-handle and `_drawn`-by-hit-handle, cache the view's viewport rect per gesture, hoist the id→model-edge map to a field. Every finding here is on the pointer path and every one is measured by the same counter (DOM lookups + `getViewportRect` reads per pointer event). Independent of Plan A.

**Plan C — "diagram residency recompute cost" (F27.3, F27.5, F27.6).** Cache the median leaf height per ELK pass, short-circuit the node-count floor, stop materialising the edge-id array, fix the `applyLayout` ordering, and either defer the mount/unmount out of `doLayout` or correct the JSDoc that says it already is. All three sit on the same `updateResidency` chain and share one proof (allocations + `setResidency` calls per zoom notch / resize frame). Should land **after** Plan A step 1, so the transform gate is in place before the resize path is re-timed — otherwise the rule write dominates the measurement.

**Plan D — "diagram unchanged-value writes" (F27.7, F27.8, F27.12, F27.13).** All four are "write less, or write only what changed" in the two SVG layers: gate `setEmphasis`, diff `setEdgeEmphasis` by group, cull and diff the simplified node set, and draw into the handle `render()` was given. F27.12 is the one with a real behaviour question attached (the counter-argument above), so it could be split out if the hysteresis-band case turns out not to matter. Depends on nothing; conflicts with nothing.

**Plan E — "diagram data refresh rebinding" (F27.11, plus the `collectNodeSizes` container skip).** The largest behavioural change and the one with the widest test blast radius, so last. Depends on Plan D only in the sense that both touch `promoteIncomingNodes`.

**Plan F — "diagram hidden-content gate" (F27.10).** Small and self-contained, but it needs new tests for an uncovered behaviour and a decision about where the visible/model split falls. Could ride with Plan C (both touch `updateResidency`) or stand alone.

**Too small to plan; ride along with a neighbour.** F27.14 (the coordinate-mapping helpers) rides with Plan A, which already touches every one of the five sites. F27.16 (dead `DiagramEdgeData.label`, dead `workerUrl`, the stale plan citation, the missing `on('activate')` doc row) is a documentation/cleanup commit of its own with no measurement. F27.17 (`Panel` base) and F27.15 (the file split) are code-health only and should follow the measured plans, not precede them — F27.15 in particular would make every other plan's diff unreadable if it went first.
