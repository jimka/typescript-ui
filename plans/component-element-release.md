# Component Element Release — Implementation Plan

## Overview

Add a base-class seam that lets a live `Component` drop its DOM element — clear the cached `_element` handle and detach the node from the document — while the component object itself stays alive and reusable, then rebuild a fresh element the next time one is needed. This is the sibling of the existing teardown seam (`dispose()` → `destructor()`), which *destroys* the component; release keeps it alive.

Release is refused unless a component opts in through a new protected gate `canRelease()`, whose base default is `false`. Re-materialization rides the existing lazy path: after release, `getElement(true)` finds no cached element, misses the by-id lookup because the node was detached, and falls back to `render()` → `init()` — the same rebuild path the probe suite at [dom-state-replay-probe.test.ts](packages/lib/tests/component/dom-state-replay-probe.test.ts) already exercises.

The core change lives in [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) (the `release()` method, the `canRelease()` gate, two rematerialize flags, and a rebuild-time restore hook) plus one idempotency fix in [core/Event.ts](packages/lib/src/typescript/lib/core/Event.ts). Both are grounded in the read-only audit [plans/dom-only-state-inventory.md](plans/dom-only-state-inventory.md), whose Table A, Table B, and "third failure shape" findings are folded in below as requirements and non-goals.

The base default of `false` means **no library component is releasable in v1**. That is the intended, fail-safe outcome: the framework ships the seam and the base-level fixes, and each library or consumer component becomes releasable only after its own audit clears it (a per-component follow-up). The mechanism is proven by a test-only releasable subclass, exactly as the probe suite proves the rebuild path today.

---

## Architecture Decisions

### The gate is a protected boolean method defaulting to `false` — mirroring `clampsToContentSize()`

`canRelease()` is a `protected` method returning a fixed `false`, overridden per-subclass to `true`. It mirrors the established `clampsToContentSize()` gate at [Component.ts:3234](packages/lib/src/typescript/lib/core/Component.ts#L3234) (returns `true`, `Container` overrides to `false`).[^gate-precedent] The two "opt" terms in the request are not in tension: the design provides an **opt-out hook** (a gate a component overrides), and that hook's **default is opt-in-only** — a component is releasable *only* if it overrides the gate to `true`. An un-audited component inherits `false` and cannot be released.

### Re-materialization rides the existing `getElement(true)` → `render()` path — release must detach the node, not just null the handle

`getElement(createIfMissing)` at [Component.ts:939-952](packages/lib/src/typescript/lib/core/Component.ts#L939-L952) returns the cached `_element`; when it is unset it looks the element up by id via `DOM.source.getElementById`, and only when *that* misses does it call `render()`. So nulling `_element` alone is not enough: the still-attached node would be resurrected by id and `render()` would never run. `release()` therefore **detaches the node** (`DOM.sink.removeElement`) so the by-id lookup misses, then nulls `_element`.[^detach-crux] No new rebuild entry point is introduced — the rebuild is the existing `render()`, unchanged.

### The listener double-register fix is idempotent registration in `Event`, not release-path de-registration

The "third failure shape" in the inventory: an `init()` override that calls `Event.addListener` / `addSubtreeListener` unconditionally pushes a second listener on every rebuild (both end in an unguarded `compFunc.listeners.push` — [Event.ts:299](packages/lib/src/typescript/lib/core/Event.ts#L299), [Event.ts:391](packages/lib/src/typescript/lib/core/Event.ts#L391)), so every event then fires twice. The fix guards each push: skip it when the exact listener reference is already registered for that component id.[^idempotent-not-deregister] This is the only fix available at the base level, because the base class cannot know which listeners a subclass's `init()` override will re-register, so it cannot de-register them on the release path.

### Scroll and focus are restored from a rebuild-time `onFirstLayout`-style callback, because they only "take" on a connected, sized element

Native `scrollLeft`/`scrollTop` set on a detached element clamp to 0, and `focus()` on a detached element is a no-op. A lazily-rebuilt element is still detached inside `init()` (its parent appends it only after `render()` returns). So the restore cannot run in `init()` directly; it is queued into the first-connected-layout drain (`_firstLayoutCallbacks`, drained by `runFirstLayoutCallbacks` — [Component.ts:5230-5247](packages/lib/src/typescript/lib/core/Component.ts#L5230-L5247)), the framework's own "mounted and sized" hook.[^why-firstlayout] The cached `_scrollLeft`/`_scrollTop` fields survive release untouched (plain JS state), so only re-issuing them is needed; focus is captured at release time into a flag because nothing mirrors it.

### The three base Table B stale-reference rows are fixed inside `release()` by mirroring `destructor()`'s teardown

`release()` tears down the clip and content frames (`clearClipFrame()` / `clearContentFrame()`) and releases the outgoing root handle — the same steps `destructor()` runs at [Component.ts:781-812](packages/lib/src/typescript/lib/core/Component.ts#L781-L812), minus child destruction, theme-subscription release, and style-rule disposal (release keeps the component alive).[^mirror-destructor] This resets `_clipFrame` / `_contentFrame` to `null` (so the next layout re-frames the fresh element) and drops the outgoing handle from `_ownedHandles` (so it does not accumulate one dead handle per cycle).

---

## Public API

```typescript
// core/Component.ts — new PUBLIC method
/**
 * Releases this component's DOM element — detaches the node from the
 * document and clears the cached handle — while keeping the component
 * object alive and reusable. A fresh element is built lazily the next time
 * getElement(true) is called. Distinct from dispose(), which destroys the
 * component. Refused (returns false, no-op) unless the component opts in by
 * overriding the release gate; also a no-op when no element is materialised.
 *
 * @returns true if an element was released, false if refused or none was live.
 */
release(): boolean;

// core/Component.ts — new PROTECTED gate (opt-in; default false)
/**
 * Whether this component supports releasing its element without being
 * destroyed. Default false — a component becomes releasable only by
 * overriding this to true, and only once its own element-derived state is
 * provably rebuilt by render()/init() or absent.
 */
protected canRelease(): boolean;   // default: return false;
```

New private fields on `Component` (plain initializers — written only at runtime by `release()` / the restore hook, never by `applyOptions`, so no `declare` is needed, matching `_lastEffectiveVisible` at [Component.ts:389](packages/lib/src/typescript/lib/core/Component.ts#L389)):

```typescript
private _pendingRematerialize   : boolean = false;   // set by release(), consumed at rebuild
private _refocusOnRematerialize : boolean = false;   // captured at release(), consumed on restore
```

No new exported symbol and no barrel/subpath change: `release()` / `canRelease()` are members of the already-exported `Component`. `Event.addListener` / `addSubtreeListener` keep their existing signatures.

---

## Internal Structure

`release()` body (order mirrors `destructor()`):

```typescript
release(): boolean {
    if (!this.canRelease()) return false;

    const element = this._element;      // read the field directly — NOT getElement(),
    if (!element) return false;         // which would resurrect a detached node by id

    // Capture focus intent before the node leaves the document.
    this._refocusOnRematerialize = DOM.source.getActiveElement() === element;

    // Tear down clip / content frames so their fields reset to null and the
    // next layout re-frames the fresh element (Table B _clipFrame/_contentFrame).
    this.clearClipFrame();
    this.clearContentFrame();

    // Detach the node so getElement()'s by-id lookup misses and render() runs.
    DOM.sink.removeElement(element);

    // Drop the outgoing handle so _ownedHandles does not accumulate (Table B).
    DOM.sink.release(element);
    this.untrackHandle(element);

    this._element             = undefined;
    this._pendingRematerialize = true;
    return true;
}
```

Rebuild-time hook — appended to the end of `init(element)`, using the `element` parameter (never `getElement()`, which is unset mid-render):

```typescript
// ...existing init() body (setId, buffer attach, class list, applyStyle,
//    child re-append) ...
if (this._pendingRematerialize) {
    this._pendingRematerialize = false;
    // Queue the scroll/focus restore for the first connected layout — a
    // detached element cannot hold scroll or focus. Push directly (not via
    // onFirstLayout, which calls getElement() — unset here mid-render) and
    // schedule a layout to guarantee the drain.
    (this._firstLayoutCallbacks ??= []).push(() => this.restoreReleasedState(element));
    this.scheduleLayout();
}
return this;
```

```typescript
private restoreReleasedState(element: Handle): void {
    if (this._scrollLeft !== 0 || this._scrollTop !== 0) {
        DOM.sink.apply(element, { scrollLeft: this._scrollLeft, scrollTop: this._scrollTop });
    }
    if (this._refocusOnRematerialize) {
        this._refocusOnRematerialize = false;
        DOM.sink.focus(element, { preventScroll: true });   // preventScroll: avoid focus-scroll pollution
    }
}
```

`Event.addListener` / `addSubtreeListener` — the terminal push becomes guarded:

```typescript
if (!compFunc.listeners.includes(listener)) {
    compFunc.listeners.push(listener);
}
```

---

## Ordered Implementation Steps

1. **[core/Event.ts](packages/lib/src/typescript/lib/core/Event.ts)** — In `addListener`, replace the unconditional `compFunc.listeners.push(listener)` at [:299](packages/lib/src/typescript/lib/core/Event.ts#L299) with the `includes`-guarded push. Do the identical replacement in `addSubtreeListener` at [:391](packages/lib/src/typescript/lib/core/Event.ts#L391). Verify: `grep -n 'listeners.push' src/typescript/lib/core/Event.ts` — both remaining sites are inside an `if (!...includes...)` guard.

2. **[core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts)** — Add the two private fields `_pendingRematerialize` and `_refocusOnRematerialize` near the other runtime flag fields (around [:389](packages/lib/src/typescript/lib/core/Component.ts#L389)), each with a plain `= false` initializer and a one-line comment.

3. **[core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts)** — Add the protected `canRelease()` gate returning `false`, placed beside `clampsToContentSize()` ([:3234](packages/lib/src/typescript/lib/core/Component.ts#L3234)) with a JSDoc block mirroring its style.

4. **[core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts)** — Add the public `release()` method next to `removeElement()` ([:971](packages/lib/src/typescript/lib/core/Component.ts#L971)) and `dispose()` ([:715](packages/lib/src/typescript/lib/core/Component.ts#L715)), with the body from **Internal Structure** and the JSDoc from **Public API**.

5. **[core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts)** — Add the private `restoreReleasedState(element: Handle)` helper near the scroll setters ([:3425](packages/lib/src/typescript/lib/core/Component.ts#L3425)).

6. **[core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts)** — Append the `_pendingRematerialize` block to the end of `init()` ([:5421-5448](packages/lib/src/typescript/lib/core/Component.ts#L5421-L5448)), before `return this;`. Confirm it uses the `element` parameter, not `getElement()`.

7. **[tests/component/dom-state-replay-probe.test.ts](packages/lib/tests/component/dom-state-replay-probe.test.ts)** — Invert the `double-registers an init()-installed listener across a rebuild` case ([:201-222](packages/lib/tests/component/dom-state-replay-probe.test.ts#L201-L222)) to assert idempotency: after a rebuild the listener is registered once, so a single `Event.removeListener` fully unregisters it (`removeListenerCount()` becomes `1`). Update the comment to point at this plan.[^invert-probe]

8. **New test file `tests/component/element-release.test.ts`** — Cover the `## Expected Behaviour` cases below.

9. **[docs/concepts/component-lifecycle.md](packages/lib/docs/concepts/component-lifecycle.md)** — Add a `## Releasing the element` section (see `## Documentation Impact`).

10. **Regenerate** `packages/lib/llms.txt` via `npm run docs:llms` (do not hand-edit). Run `npm run docs:build` — must finish with zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [packages/lib/src/typescript/lib/core/Event.ts](packages/lib/src/typescript/lib/core/Event.ts) |
| Modify | [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) |
| Modify | [packages/lib/tests/component/dom-state-replay-probe.test.ts](packages/lib/tests/component/dom-state-replay-probe.test.ts) |
| Create | packages/lib/tests/component/element-release.test.ts |
| Modify | packages/lib/docs/concepts/component-lifecycle.md |
| Modify (regenerate) | packages/lib/llms.txt |

---

## Expected Behaviour

Test-only releasable subclass used throughout (mirrors the probe file's `ListenerOnInitComponent`):

```typescript
class ReleasableProbe extends Component {
    protected canRelease(): boolean { return true; }
}
```

**Gate — offline-testable.**
1. `new Component({})` (base gate `false`): after `getElement(true)`, `release()` returns `false` and records **no** `removeElement`.
2. `new ReleasableProbe({})`: after `getElement(true)`, `release()` returns `true` and records exactly one `removeElement` on the component's handle.
3. Idempotency / no live element: a second `release()` (element already gone) returns `false` and records no further `removeElement`.

**Detach half — offline-testable via recorded sink writes.**
4. After `release()` on a `ReleasableProbe`, the recorder shows `removeElement` and `release` for the outgoing handle. (Assert on `DOM.sink` writes, per the probe file's `writesFor` pattern — do **not** call `getElement()` afterward to check, because the offline `getElementById` model still resolves the released id.[^offline-byid])
5. A clip-framed `ReleasableProbe` (`setClipFrame(0,0,10,10)` then `release()`) records teardown of the frame wrapper, and a subsequent `setClipFrame` on the rebuilt element creates a **new** frame (the `if (!this._clipFrame)` guard no longer blocks it).

**Rebuild half — offline-testable by calling the protected `render()` directly (probe pattern).**
6. After `release()` then `render()`, the fresh element receives `setId`, the class list (`COMPONENT_CLASS` + constructor name), the replayed attribute buffer (full `ElementAttributes.attach`), and geometry from `replayGeometryStyles` — i.e. the existing rebuild replay still holds.
7. Child elements survive: a `ReleasableProbe` with two `addComponent` children, after `release()` + `render()`, re-appends both child elements onto the fresh root (the children are not released; `init()`'s child loop re-parents them).
8. `_ownedHandles` does not grow across cycles: after `release()` + rebuild, the tracked-handle set holds the fresh root handle, not the released one. (Assert indirectly — a second `release()`+rebuild still records exactly one `release` per cycle.)

**Listener idempotency — offline-testable.**
9. A `ReleasableProbe` whose `init()` registers one listener through `Event.addListener` with a stable method reference: after a rebuild the listener is present once; a single `Event.removeListener` fully unregisters it (base window listener uninstalled). This is the inverted probe case (step 7 above).

**Scroll / focus restore — offline-testable at the write level (drive a connected layout with the `OnFirstLayout.test.ts` mock pattern); the actual scroll landing and focus move are manual-verify.**
10. `ReleasableProbe` in a laid-out host, `setScrollTop(40)`, `release()`, then re-show (rebuild + connected layout, `isConnected` mocked `true`, frames flushed): the recorder shows an `apply` carrying `scrollTop: 40` on the fresh element. **Manual-verify:** the rebuilt element actually scrolls to 40 in a browser.
11. `ReleasableProbe` that is the active element, `release()`, then re-show: the recorder shows a `focus` write with `{ preventScroll: true }`. **Manual-verify:** focus actually returns to the element in a browser, without scrolling an `overflow:hidden` ancestor.
12. No spurious restore on first render: a freshly constructed `ReleasableProbe` (never released) that lays out connected records **no** scroll `apply` and **no** `focus` from the restore hook (`_pendingRematerialize` is `false`).

**Manual-verify only (no offline signal).**
13. Releasing a component mid-CSS-transition does not throw and simply drops the transition (pre-existing `Animation` behaviour, unchanged).

---

## Verification

- **Typecheck:** `npm run typecheck` and `npm run typecheck:test` (from `packages/lib`).
- **Unit tests:** `npm run test` — the new `element-release.test.ts` and the inverted probe case must pass; the full suite must stay green (the `Event` idempotency change touches a shared path — watch for any test that relied on duplicate registration).
- **Lint:** `npm run lint` — the `no-raw-dom` rule allows `DOM.sink` / `DOM.source` calls; confirm no raw element/handle typing leaked in.
- **Grep invariant:** `grep -n 'listeners.push' packages/lib/src/typescript/lib/core/Event.ts` — every match sits inside an `includes` guard.
- **Docs:** `npm run docs:llms` then `npm run docs:build` — zero warnings (per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), *Don't `{@link}` internal symbols*: `release()`'s JSDoc must not `{@link canRelease}`, since the gate is `protected`).
- **Manual smoke (browser, `npm run dev`, localhost:8015):** build a small releasable panel subclass; scroll it, focus a control, `release()`, re-show, and confirm scroll position and focus return and that no `overflow:hidden` ancestor jumps.

---

## Documentation Impact

- **Public surface:** `release()` is a new public method on the already-exported `Component`; no new barrel or subpath entry is needed. `canRelease()` is `protected` and is excluded from the TypeDoc build, so nothing references it from public docs.
- **Doc page:** add a `## Releasing the element` section to [docs/concepts/component-lifecycle.md](packages/lib/docs/concepts/component-lifecycle.md), placed after `## Element creation: getElement()` and before/near `## Disposal`. State plainly: release keeps the component alive (unlike `dispose()`), is refused unless `canRelease()` is overridden, rebuilds lazily on the next `getElement(true)`, and that per-component state beyond scroll/focus is the releasing component's responsibility. Cross-reference `dispose()` / `destructor()` in the existing `## Disposal` section.
- **Generated index:** regenerate `packages/lib/llms.txt` with `npm run docs:llms` (never hand-edit).
- **JSDoc:** describe the gate relationship in prose inside `release()`'s JSDoc rather than linking the protected `canRelease()`.

---

## Potential Challenges

- **Offline `getElementById` resurrects a released id.** The test harness's `removeElement` clears only the parent link, not the id index ([TestDOM.ts:426-429](packages/lib/tests/dom/TestDOM.ts#L426-L429)), so after `release()` a `getElement()` call offline returns the dead handle. *Mitigation:* test the detach and rebuild halves separately on recorded sink writes and the direct `render()` call — never assert the full `release()` → `getElement(true)` round trip offline. Production is unaffected (`document.getElementById` misses a detached node).
- **Scroll/focus only land on a connected element.** Restoring in `init()` alone would write onto a detached node and be lost. *Mitigation:* the restore is queued into the first-connected-layout drain, which fires only once the element is mounted and sized.
- **`Event` idempotency is a shared-path change.** *Mitigation:* it only skips an exact-reference duplicate, which is never intentional; the full suite plus the inverted probe guard it.
- **Inline-closure listeners are not fixed by idempotency.** `HeaderCell` registers new closures per rebuild, so each is a distinct reference. *Mitigation:* `HeaderCell` is not opted in; its fix (stable references) is a deferred per-component follow-up.

---

## Critical Files

- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) — `getElement` ([:939](packages/lib/src/typescript/lib/core/Component.ts#L939)), `removeElement` ([:971](packages/lib/src/typescript/lib/core/Component.ts#L971)), `dispose`/`destructor` ([:715](packages/lib/src/typescript/lib/core/Component.ts#L715)/[:732](packages/lib/src/typescript/lib/core/Component.ts#L732)), `clampsToContentSize` gate precedent ([:3234](packages/lib/src/typescript/lib/core/Component.ts#L3234)), `init` replay loop ([:5421](packages/lib/src/typescript/lib/core/Component.ts#L5421)), `applyStyle`/`replayGeometryStyles` ([:4419](packages/lib/src/typescript/lib/core/Component.ts#L4419)/[:4501](packages/lib/src/typescript/lib/core/Component.ts#L4501)), scroll setters ([:3425](packages/lib/src/typescript/lib/core/Component.ts#L3425)), `focus` ([:4352](packages/lib/src/typescript/lib/core/Component.ts#L4352)), clip/content frame setters ([:1011](packages/lib/src/typescript/lib/core/Component.ts#L1011)/[:1135](packages/lib/src/typescript/lib/core/Component.ts#L1135)), `trackHandle`/`untrackHandle` ([:824](packages/lib/src/typescript/lib/core/Component.ts#L824)/[:846](packages/lib/src/typescript/lib/core/Component.ts#L846)), `onFirstLayout`/`runFirstLayoutCallbacks` ([:5206](packages/lib/src/typescript/lib/core/Component.ts#L5206)/[:5230](packages/lib/src/typescript/lib/core/Component.ts#L5230)).
- [packages/lib/src/typescript/lib/core/Event.ts](packages/lib/src/typescript/lib/core/Event.ts) — `addListener` ([:271](packages/lib/src/typescript/lib/core/Event.ts#L271)) / `addSubtreeListener` ([:367](packages/lib/src/typescript/lib/core/Event.ts#L367)) and their `push` sites.
- [packages/lib/src/typescript/lib/core/StyleTarget.ts](packages/lib/src/typescript/lib/core/StyleTarget.ts) & [core/ElementAttributes.ts](packages/lib/src/typescript/lib/core/ElementAttributes.ts) — the `attach`/`materialize` buffers `init()` replays; `ElementAttributes.attach` writes the full retained state, `InlineStyle` is re-issued from backing fields by `applyStyle`.
- [packages/lib/tests/component/dom-state-replay-probe.test.ts](packages/lib/tests/component/dom-state-replay-probe.test.ts) — the rebuild-half probe pattern to reuse.
- [packages/lib/tests/core/OnFirstLayout.test.ts](packages/lib/tests/core/OnFirstLayout.test.ts) — the offline connected-layout drive pattern for the scroll/focus tests.
- [packages/lib/tests/dom/TestDOM.ts](packages/lib/tests/dom/TestDOM.ts) — the recording sink and `_byId` model behind the offline caveats.
- [plans/dom-only-state-inventory.md](plans/dom-only-state-inventory.md) — the authoritative catalogue of what a rebuild loses/dangles.

---

## Non-Goals

- **No library component is opted in.** Base `canRelease()` stays `false` with no override. Enabling any real component is a per-component follow-up, gated on clearing that component's Table A / Table B rows below — see `## Addendum: Follow-Up Roadmap` for the opt-in recipe and the suggested clustering of those follow-ups. Shipping the seam with zero opted-in components is the intended v1 (the request permits this explicitly).
- **No auto-wiring.** `release()` is a manual call. It is not driven by visibility, `Tab` panels, `Accordion`, or any offscreen detection. The framework supplies the mechanism; the app decides policy.
- **Bespoke per-component state replay is deferred** (treated as `accept-loss` or `refuse` in v1). From **Table A**: `TextInput` selection range; `Video` playhead / play-state (`setCurrentTime`, `play`/`pause`); `CodeEditor` and `MarkdownEditor` view remount; `Date`/`DateTime`/`Time` cell-editor in-progress text; `TreeRow` toggle/spinner children; `PickerColumn` and `AbstractSelectableList` scroll bypasses; `ProgressSpinner` overlay re-parent; `VideoPlayer` fullscreen glyph; `FileField` selection; `SelectableListRow` and `DiagramEdgeLayer` mid-`render()` class/path writes; `Split`/`Border`/`Accordion`/`Tab` layout-injected structural children; `TableHeader` scrollbar cover.
- **Bespoke stale-reference cleanup is deferred** (**Table B**, beyond the three base rows handled here): `Canvas._ctx` and its `_syncedWidth/Height/Dpr` guards; `Tooltip.elementAttachments`; `AnimatedDropdown._anchorElement`, `Menu._excludedEl`/`_currentOpener`, `Popover._anchorElement`/`_scrollAncestors`, `Dialog._previousFocus`; `CodeEditor._view`/`_flashOverlay`; `Markdown._contentHandles`; `VirtualScroller`/`VirtualRowView._rowPool`; `AbstractChart._marks`; `ScrollStrip` arrows; `TabButton._closeButton`; `Rail._mounted`; `Drawer._open`.
- **`WebGLCanvas` is refused, not released.** Its GL context and GPU resources are unrecoverable on a fresh element (Table A `opt-out`); it must keep the base `canRelease()` `false` and must never be opted in without a bespoke context-teardown design.
- **`HeaderCell`'s inline-closure listeners are not fixed.** Base idempotency dedups only stable references; per-rebuild closures need `HeaderCell` to hold stable references first — a per-component follow-up.
- **The offline `getElementById` model is not changed.** Fixing `TestDOM.removeElement` to evict `_byId` is out of scope; tests split the two halves instead.

---

## Addendum: Follow-Up Roadmap

v1 ships the seam with `canRelease()` returning `false` everywhere. This addendum is the followable trail for the work after v1: how to make one real component releasable, and a suggested order for doing it across the library. It exists because the `## Non-Goals` list is an *inventory* of what is deferred, not a *procedure* — a later `/implement` run needs the procedure.

### Re-anchor the inventory first

[plans/dom-only-state-inventory.md](plans/dom-only-state-inventory.md)'s line numbers have drifted since it was written. During this plan's drafting the crux `getElement` had moved from the inventory's `Component.ts:863` to `:939`, and other cited base-class sites shifted similarly. **Before trusting any inventory row, re-locate its symbol in current source** (grep the method/field name; do not follow the printed line number blind). The inventory's *findings* — verdicts, which fields dangle, which listeners double-register — remain accurate; only its citations are stale. A cheap first task for any follow-up is to refresh the inventory's line numbers against `master`.

### Recipe — opting one component in

For a target component `X`, in order:

1. **Clear its Table B stale references.** For every `X` field the inventory's Table B lists as pointing at a dead element, either null-and-re-resolve it on the release/rebuild path or confirm `X`'s own `init()`/`render()` already rebuilds it. A field left pointing at the released node is a silent use-after-release. (Base already handles `_clipFrame`/`_contentFrame`/`_ownedHandles`; anything `X`-specific is on `X`.)
2. **Make its `init()` listeners stable references.** Base `Event` idempotency (shipped in v1) dedups any listener registered with the *same* reference across a rebuild. If `X`'s `init()` registers inline-closure listeners (the `HeaderCell` shape), refactor them to stable bound fields first, or the dedup cannot see them and they still stack.
3. **Confirm all its Table A state self-heals, or add the replay.** For each Table A row for `X`: verify `init()`/`render()` already re-issues that state onto the fresh element (many do — inline style and geometry already self-heal via `applyStyle`; base scroll/focus are restored by v1), or add the capture-on-release / replay-on-rebuild for what does not. A row the inventory marks `opt-out` (unrecoverable, e.g. a GL context) means `X` cannot be opted in at all.
4. **Override `canRelease()` to return `true`** on `X`.
5. **Add a round-trip probe test** for `X`, split into the detach half (assert recorded `removeElement`/`release` sink writes) and the rebuild half (call the protected `render()` directly, then assert `X`'s specific state is present on the fresh element) — the two-half technique this plan's `## Expected Behaviour` uses, forced by the offline `getElementById` caveat.[^offline-byid]

### Suggested clustering of the deferred follow-ups

Order later plans cheapest-and-safest first, so the seam gains real users before the hard state-preservation work:

| Cluster | Components | Why grouped |
|---|---|---|
| **A — trivially self-healing** | components whose `init()`/`render()` already re-issue every Table A row and carry no Table B field or inline-closure listener (candidates to confirm: `Label`, `ListItem`, `SortPriorityBadge`, the picker inner cells) | pure recipe steps 4–5; no new replay code |
| **B — native scroll/focus only** | `DiagramView` pan, `AbstractSelectableList` / `PickerColumn` scroll bypasses | base scroll restore covers most; each needs its scroll write routed through the mirrored setter (recipe step 3) plus its Table B ref cleared |
| **C — media & editor state** | `Video` playhead/play-state, `VideoPlayer` fullscreen glyph, `CodeEditor` / `MarkdownEditor` view remount | biggest: bespoke capture-on-release and rebuild (CodeMirror `EditorState` re-parent, Lexical `setRootElement`); see the inventory's per-row recovery notes |
| **D — virtualized row views** | `Table` / `Tree` via `VirtualScroller` / `VirtualRowView`, `TableHeader` scrollbar cover, `ScrollStrip` arrows | must rebuild the scroller and re-append the row pool; the inventory flags `VirtualRowView._rowPool` as its worst entry |
| **Permanent refusal** | `WebGLCanvas` | GL context + GPU resources are unrecoverable on a fresh element; keeps `canRelease()` `false` forever |

Each cluster is its own plan (or a small stack). None is a straight `/implement` of the current plan — they are new planning passes that consume this recipe and the re-anchored inventory.

---

## Notes

[^gate-precedent]: `clampsToContentSize()` is the exact shape wanted: a `protected` method returning a fixed boolean, read at the point of decision, overridden by the one subclass that differs. Reusing that shape keeps the gate discoverable (a reader who knows one knows the other) and avoids inventing an options-bag flag, which would be wrong here — releasability is an intrinsic property of a component's implementation, not consumer configuration, so per [ARCHITECTURE.md](ARCHITECTURE.md) *Three non-negotiable rules* it must stay off the `XOptions` bag.

[^detach-crux]: From the inventory's "Verified assumptions": a release that clears `_element` without removing the node resurrects the dead element by id and never calls `render()`. `DOM.sink.removeElement` calls `element.remove()` in production, so `document.getElementById` then misses and `render()` runs. The outgoing handle is additionally passed to `DOM.sink.release` so a stale handle can never be resolved again, and dropped from `_ownedHandles` via `untrackHandle` so the destructor's later sweep does not double-release it.

[^idempotent-not-deregister]: Two options were considered. (a) Release-path de-registration — have `release()` call `removeListener` for everything `init()` will re-register. Rejected: the base `Component` cannot enumerate a subclass's `init()`-registered listeners, and `HeaderCell`'s inline closures are not removable by reference at all, so this cannot be done generically. (b) Idempotent registration — skip the push when the same `(component id, type, listener reference)` is already present. Chosen: it is a two-line base-level change that fixes every stable-reference site (`Tree`, table `Body`, `DiagramView`, `TabBar`, `ParentHeader`, `ResizeHandle`) at once, needs no per-component work, and is safe because registering the identical listener twice is never intentional. It does not fix inline-closure sites (each rebuild is a new reference), which is why those stay deferred.

[^why-firstlayout]: `runFirstLayoutCallbacks` ([Component.ts:5230-5247](packages/lib/src/typescript/lib/core/Component.ts#L5230-L5247)) fires its queue only when the element exists and `DOM.source.isConnected` is true, and it re-arms cleanly (the queue is nulled after each drain, and a later push refills it). That is precisely "run once the rebuilt element is mounted and sized" — the moment scroll and focus can take. The restore is pushed directly into `_firstLayoutCallbacks` rather than through the public `onFirstLayout`, because `onFirstLayout` calls `getElement()` to choose its sync-vs-async branch, and inside `init()` (mid-`render()`) `_element` is not yet assigned — calling `getElement()` there would trigger the by-id lookup, which offline resurrects the released node. Using the `element` parameter sidesteps this. A `scheduleLayout()` accompanies the push (mirroring `onFirstLayout`'s own body) so the drain is guaranteed even if nothing else schedules a layout.

[^mirror-destructor]: `destructor()` ([Component.ts:781-812](packages/lib/src/typescript/lib/core/Component.ts#L781-L812)) already performs exactly the element-level teardown release needs — `clearClipFrame()` / `clearContentFrame()`, `DOM.sink.removeElement`, and releasing the tracked handle — but wrapped in component-destroying work (recursing into `_components`, releasing theme subscriptions, disposing style rules, clearing `_ownedHandles` entirely). Release takes only the element-level subset and additionally nulls `_element` and sets the rematerialize flag; children, theme subscriptions, style rules, and the component object all stay intact so the component can rebuild.

[^invert-probe]: The `double-registers…` probe currently asserts the *buggy* behaviour (a rebuild needs two `removeListener` calls to fully unregister), documenting the third failure shape for this plan to fix. Once registration is idempotent it must assert the *fixed* behaviour (one registration survives a rebuild; one `removeListener` uninstalls the base window listener). This mirrors how the `replays an attribute…` case in the same file was inverted when the element-attribute buffer landed — the probe is kept as the regression guard, flipped to the corrected expectation. The probe's `ListenerOnInitComponent` already uses a stable bound field for its handler, so idempotency-by-reference dedups it.

[^offline-byid]: The offline `RecordingDOMSink.removeElement` sets the handle's parent to `null` but never evicts the id from `ModelledDOMSource`'s `_byId` map ([TestDOM.ts:426-429](packages/lib/tests/dom/TestDOM.ts#L426-L429)), so `getElementById` keeps resolving a detached (and now registry-released) handle. Any `getElement()` after `release()` is therefore unreliable offline. The tests avoid it: the detach half asserts on recorded `removeElement`/`release` writes, and the rebuild half calls the protected `render()` directly (the established probe-suite technique), so neither depends on the by-id path. Production is correct because `document.getElementById` genuinely misses a removed node.
