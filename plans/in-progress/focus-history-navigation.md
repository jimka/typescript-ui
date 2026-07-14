# Focus History Navigation — Implementation Plan

## Overview

Add a global **focus-history service** to the library: a document-level observer that records the chronological trail of focused elements across an app, plus a keyboard combination that walks that trail backward and forward — browser back/forward, but for keyboard focus. Pressing *back* re-focuses the previously focused element; *forward* re-does it. Entries whose element has left the DOM are skipped and dropped.

The service lives in [`src/typescript/lib/core/FocusHistory.ts`](src/typescript/lib/core/FocusHistory.ts) (new). It is modelled on [`LayerManager`](src/typescript/lib/core/LayerManager.ts) — a module-level broker exposed as an `export namespace`, owning its document-level listeners through a sentinel `Component` (`LayerManager.ts:139`, `LayerManager.ts:545`). It observes focus with a viewport `focusin` listener and drives its accelerator with a viewport `keydown` listener, both via [`Event.addViewportListener`](src/typescript/lib/core/Event.ts#L392). Every DOM touch — reading the active element, moving focus, testing connectivity, interning event targets — funnels through the [`DOM.source`](src/typescript/lib/core/DOM.ts#L701) / [`DOM.sink`](src/typescript/lib/core/DOM.ts#L440) seam, so the service is unit-testable headlessly through the same harness the rest of the library uses ([`tests/dom/TestDOM.ts`](tests/dom/TestDOM.ts)).

It is exported from the core barrel [`src/typescript/lib/core/index.ts`](src/typescript/lib/core/index.ts) (the `@jimka/typescript-ui/core` subpath, already the home of `Body`, `LayerManager`, `Event`, `DOM`). It is **opt-in**: nothing auto-starts it, matching the library's stance that real accelerators are consumer-installed (see the *Keyboard shortcuts* recipe and `MenuItemConfig.shortcut` being a display-only hint, `MenuItem.ts:47`).

---

## Architecture Decisions

### A namespace service keyed on a sentinel Component, not a `Component` subclass

`FocusHistory` has no DOM element of its own — it observes and drives focus on *other* elements. That makes it structurally a `LayerManager`, not a `Tooltip`. `Tooltip` (`Tooltip.ts:65`, static-instance singleton) is a `Component` because it renders a floating surface; `LayerManager` (`LayerManager.ts:158`, `export namespace`) is a pure broker with module-private state and a sentinel `Component` (`_listenerOwner`, `LayerManager.ts:139`) that owns its viewport listeners because `Event.addViewportListener` binds to a `Component`. `FocusHistory` follows `LayerManager` exactly: `export namespace FocusHistory` with a module-private `const _owner = new Component()` sentinel. This also sidesteps the DOM.ts:1840 caveat about `namespace` + `export let` — like `LayerManager`, the namespace exports only functions; all mutable state is module-private `let`.

### History stores `Handle`s, not `Component`s

Focus lands on DOM elements, and focusable elements are frequently *inside* components (an `input` in a `Text`, a list row, a raw `button`) with no 1:1 `Component`. The one thing every focus target has is a DOM element, and the seam already interns any element to a canonical [`Handle`](src/typescript/lib/core/DOM.ts#L86). So an entry is a bare `Handle`. A `Handle` is sufficient to (a) re-focus (`DOM.sink.focus(handle)`, `DOM.ts:542`) and (b) detect staleness (`DOM.source.isConnected(handle)`, `DOM.ts:848`). Handle equality mirrors element equality (the registry maps each node to exactly one handle, `DOM.ts:137`), which is what makes consecutive-focus dedupe correct.

Interned handles are held **weakly** by the registry (`DOM.ts:178`), so storing only the number cannot pin a dead element: a still-connected element is kept alive by the document; a disconnected, otherwise-unreferenced element is GC'd and its handle finalized (`DOM.ts:143`), after which `resolve` throws (`DOM.ts:201`) — which the staleness check treats as stale.

### Observation via a viewport `focusin` listener

`focus` does not bubble; `focusin` does, so a single document-level `focusin` capture listener sees every focus change in the app. `LayerManager` already relies on exactly this (`LayerManager.ts:521`, `onFocusIn`). `FocusHistory` registers its own `focusin` viewport listener against its sentinel owner. Multiple components may hold viewport listeners for the same type — `Event`'s `baseViewportListener` fans out to all of them (`Event.ts:143`) — so `FocusHistory`'s and `LayerManager`'s `focusin`/`keydown` listeners coexist without interference.

### Re-entrancy guard for service-driven focus

`FocusHistory.back()`/`forward()` call `DOM.sink.focus(handle)`, which synchronously fires a real `focusin` in the browser. That event must **not** be recorded (it is a replay, not a new user focus). A module-private `_navigating` boolean is set `true` for the duration of the sink call and the `focusin` handler returns early while it is set. Browsers dispatch `focusin` synchronously inside `element.focus()`, so a plain boolean spanning the one sink call is sufficient — no timer or frame deferral is needed.

### Overlay save/restore churn is recorded, not special-cased

Overlays that save and restore focus (`Dialog._previousFocus`, captured at `Dialog.ts:627`, restored at `Dialog.ts:802`) generate genuine `focusin` events. These are *real* focus movements the user experienced, so recording them is correct, not corruption. The only replayed focus the service must ignore is its **own** back/forward navigation (the `_navigating` guard). Transient overlay internals that get recorded (e.g. the dialog's first focusable, `Dialog.ts:707`) become stale the moment the overlay closes and are dropped by the staleness prune on the next navigation — so no LayerManager-specific coupling is needed. This keeps the service ignorant of the overlay layer entirely, except for the one modal read below.

### Back/forward is suppressed while a modal layer is open

A modal `Dialog` owns a Tab focus-trap (`Dialog.ts:744`) and modality (`LayerDismissMode "modal"`, `LayerManager.ts:23`). Letting focus-history yank focus to an element *outside* the modal would break the trap and the modal contract. So the keydown handler consults `LayerManager.getTopLayer()` (`LayerManager.ts:307`) and, when the topmost layer's `getDismissMode()` is `"modal"`, does nothing (no navigation, no `preventDefault`) — the accelerator falls through inert. Non-modal layers (dropdowns, popovers) do not suppress it.

### Default combo: `Alt+[` / `Alt+]`, layout-independent, overridable

Back is `Alt+BracketLeft`, forward is `Alt+BracketRight`. Rationale: (1) these mirror the "navigate back/forward" bindings common in code editors, reading naturally as history motion; (2) they carry **no** default browser action, unlike `Alt+Left`/`Alt+Right`, which *are* the browser's own history navigation — reusing those would either hijack real page navigation or be fought by it; (3) they avoid the `Ctrl`/`Cmd`+letter space application menus claim (the *Keyboard shortcuts* recipe wires `Ctrl+N/O/S`). The combo is matched on `KeyboardEvent.code` (the physical key) rather than `.key`, so it is keyboard-layout independent, and both combos are fully overridable via `configure()` / `enable()`.

### Uses `DOM.source.isConnected` for staleness — with a small test-harness addition

The connectivity check is the existing seam `DOM.source.isConnected` (`DOM.ts:848`). The modelled test source currently returns `false` unconditionally (`TestDOM.ts:709`), which would make *every* recorded entry stale offline and render recording untestable. The plan adds a `setConnected(handle, connected)` injected input to `TestDOM.ts`, mirroring the existing `setNaturalSize` / `setBorderInset` injected-input pattern (`TestDOM.ts:1049`, `TestDOM.ts:1066`), and has `ModelledDOMSource.isConnected` consult it (default `false`, preserving today's behaviour for every existing caller). No production seam changes.

---

## Public API

All symbols carry `@category Core`. Module-scope types + interfaces are exported alongside the `namespace`, exactly as `LayerManager` exports `LayerDismissMode` / `DismissableLayer` beside `namespace LayerManager`.

```typescript
/** A physical-key chord. `code` is a `KeyboardEvent.code` value (layout-independent). */
export interface FocusHistoryKeyCombo {
    code:   string;      // e.g. "BracketLeft"
    ctrl?:  boolean;     // default false
    alt?:   boolean;     // default false
    shift?: boolean;     // default false
    meta?:  boolean;     // default false
}

/** Options for {@link FocusHistory.enable} / {@link FocusHistory.configure}. */
export interface FocusHistoryOptions {
    /** Max entries retained; oldest dropped past this. Default 50. */
    maxSize?: number;
    /** Back accelerator. Default `Alt+[` (`{ code: "BracketLeft", alt: true }`). */
    back?:    FocusHistoryKeyCombo;
    /** Forward accelerator. Default `Alt+]` (`{ code: "BracketRight", alt: true }`). */
    forward?: FocusHistoryKeyCombo;
}

/** The sole custom event name. */
export type FocusHistoryEvent = "change";

/** Payload of the `"change"` event: the navigability of the trail after the change. */
export interface FocusHistoryChange {
    canGoBack:    boolean;
    canGoForward: boolean;
}

export namespace FocusHistory {
    /** Installs the focusin + keydown listeners, seeds the current active element, and begins recording. Idempotent. */
    export function enable(options?: FocusHistoryOptions): void;

    /** Removes the listeners and stops recording. Preserves the trail (re-enable resumes). Idempotent. */
    export function disable(): void;

    /** Whether the service is currently observing. */
    export function isEnabled(): boolean;

    /** Updates maxSize / combos without toggling enablement. Only supplied fields change. */
    export function configure(options: FocusHistoryOptions): void;

    /** Re-focuses the previous live entry, skipping+dropping stale ones. Returns true if focus moved. */
    export function back(): boolean;

    /** Re-focuses the next live entry, skipping+dropping stale ones. Returns true if focus moved. */
    export function forward(): boolean;

    /** Whether a live entry exists before the current position (prunes stale entries as a side effect). */
    export function canGoBack(): boolean;

    /** Whether a live entry exists after the current position (prunes stale entries as a side effect). */
    export function canGoForward(): boolean;

    /** Empties the trail and fires `"change"`. */
    export function clear(): void;

    /** Subscribes to trail-navigability changes. */
    export function on(event: "change", listener: (change: FocusHistoryChange) => void): void;

    /** Unsubscribes a `"change"` listener. */
    export function off(event: "change", listener: (change: FocusHistoryChange) => void): void;
}
```

---

## Internal Structure

Module-private state (all `let`/`const`, none exported — mirrors `LayerManager`):

```typescript
// Named constants (per CODE_CONVENTIONS: name = "what", comment = "why").
// 50: a working session's focus trail rarely exceeds a few dozen stops; caps
// memory at 50 handle numbers while leaving generous back-depth.
const DEFAULT_MAX_ENTRIES: number = 50;
// Alt+[ / Alt+]: editor-style "navigate back/forward"; no default browser
// action (unlike Alt+Left/Right = browser history); layout-independent via code.
const DEFAULT_BACK_COMBO:    FocusHistoryKeyCombo = { code: "BracketLeft",  alt: true };
const DEFAULT_FORWARD_COMBO: FocusHistoryKeyCombo = { code: "BracketRight", alt: true };

const _owner: Component = new Component();          // sentinel for viewport listeners
const _listeners = new ListenerBag<FocusHistoryEvent>();

let _entries: Handle[] = [];   // chronological, oldest first
let _index: number = -1;       // current position; -1 when empty
let _enabled: boolean = false;
let _navigating: boolean = false;   // re-entrancy guard around service-driven focus
let _maxSize: number = DEFAULT_MAX_ENTRIES;
let _back:    FocusHistoryKeyCombo = DEFAULT_BACK_COMBO;
let _forward: FocusHistoryKeyCombo = DEFAULT_FORWARD_COMBO;
```

**Recording** (`focusin` handler → `record`):

```
onFocusIn(e):
    if (!_enabled || _navigating) return;                 // guard replays
    if (!DOM.source.isElement(e.target)) return;
    record(DOM.source.intern(e.target));

record(handle):
    if (_index >= 0 && _entries[_index] === handle) return;   // dedupe consecutive
    _entries.length = _index + 1;                              // truncate forward
    _entries.push(handle);
    while (_entries.length > _maxSize) { _entries.shift(); }   // drop oldest
    _index = _entries.length - 1;
    fireChange();
```

**Staleness prune** (compact, no event) — run before every navigation and every `canGo*` query:

```
isLive(handle): try { return DOM.source.isConnected(handle); } catch { return false; }
    // catch covers a GC-collected weak handle whose resolve throws.

pruneStale():
    const kept: Handle[] = [];
    let newIndex = -1;
    for (let i = 0; i < _entries.length; i++) {
        if (isLive(_entries[i])) {
            kept.push(handle);
            if (i <= _index) newIndex = kept.length - 1;   // nearest survivor at/before current
        }
    }
    _entries = kept;
    _index = newIndex;   // -1 when nothing survived at/before the old current
```

**Navigation**:

```
navigate(direction: -1 | +1): boolean
    pruneStale();
    const target = _index + direction;
    if (target < 0 || target >= _entries.length) return false;
    _index = target;
    focusEntry(_entries[_index]);
    return true;

focusEntry(handle):
    _navigating = true;
    DOM.sink.focus(handle);
    _navigating = false;
    fireChange();

back()    => navigate(-1);
forward() => navigate(+1);
```

**Keydown accelerator**:

```
onKeyDown(e):
    if (!_enabled) return;
    const dir = matchesCombo(e, _back) ? -1 : matchesCombo(e, _forward) ? +1 : 0;
    if (dir === 0) return;
    const top = LayerManager.getTopLayer();
    if (top && top.getDismissMode() === "modal") return;   // don't fight the modal trap
    e.preventDefault();
    dir === -1 ? back() : forward();

matchesCombo(e, c):
    e.code === c.code &&
    e.altKey  === !!c.alt   && e.ctrlKey === !!c.ctrl &&
    e.shiftKey=== !!c.shift && e.metaKey === !!c.meta;
```

**Enable / disable**:

```
enable(options?):
    if (options) configure(options);
    if (_enabled) return;
    _enabled = true;
    Event.addViewportListener(_owner, "focusin", onFocusIn);
    Event.addViewportListener(_owner, "keydown", onKeyDown);
    const active = DOM.source.getActiveElement();   // seed so first back() has an origin
    if (active !== null) record(active);

disable():
    if (!_enabled) return;
    _enabled = false;
    _navigating = false;
    Event.removeViewportListener(_owner, "focusin", onFocusIn);
    Event.removeViewportListener(_owner, "keydown", onKeyDown);
```

`fireChange()` computes `{ canGoBack: _index > 0, canGoForward: _index < _entries.length - 1 }` (accurate immediately after a `record`/`navigate`, both of which leave `_index` consistent) and calls `_listeners.fire("change", change)`. `on`/`off` forward to `_listeners.add`/`_listeners.remove`. `canGoBack()`/`canGoForward()` call `pruneStale()` first, then return the same bounds check, so a query never reports a stale-only direction as navigable.

All listener args are named module functions (`onFocusIn`, `onKeyDown`) per the ARCHITECTURE rule against inline listeners.

---

## Ordered Implementation Steps

1. **`tests/dom/TestDOM.ts` — add staleness + richer events (test infra first, so the service is testable red-green).**
   - Add `private readonly _connected = new Set<Handle>()` to `TestHandleTable`, with `setConnected(handle, connected)` and `isConnected(handle): boolean`.
   - Change `ModelledDOMSource.isConnected` (`TestDOM.ts:709`) to `return _table.isConnected(handle);` (default `false` — unchanged for existing callers).
   - Export `setConnected(handle, connected)` beside `setNaturalSize` (`TestDOM.ts:1049`).
   - Extend `makeEvent`'s `init` (`TestDOM.ts:1018`) with `code?`, `altKey?`, `ctrlKey?`, `shiftKey?`, `metaKey?` and copy them onto the event object, so a `keydown` combo is drivable offline.
2. **Write `tests/unit/core/FocusHistory.test.ts`** covering every unit-testable row in *Expected Behaviour* (test-first). Drive `focusin`/`keydown` via `DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(handle, "focusin"))` — the recording sink invokes window-registered viewport listeners (`TestDOM.ts:407`). Mark live handles with `setConnected(handle, true)`.
3. **Create `src/typescript/lib/core/FocusHistory.ts`** per *Public API* + *Internal Structure*. Import `Component`, `Event`, `DOM`/`Handle`, `LayerManager`, `ListenerBag`. JSDoc every export; do not `{@link}` any private symbol (CODE_CONVENTIONS: internal-link rule).
4. **Modify `src/typescript/lib/core/index.ts`** — after the `LayerManager` export (`index.ts:27`) add:
   `export { FocusHistory } from '~/core/FocusHistory.js';`
   `export type { FocusHistoryOptions, FocusHistoryKeyCombo, FocusHistoryEvent, FocusHistoryChange } from '~/core/FocusHistory.js';`
5. **Run the suite** — `npx vitest run tests/unit/core/FocusHistory.test.ts`; green.
6. **Docs** — create `docs/recipes/focus-history.md`; register it in `docs/.vitepress/config.mts` under the recipes sidebar near *Keyboard shortcuts* (`config.mts:217`). Add a one-line cross-reference from `docs/concepts/accessibility.md`.
7. **Full verification** — see *Verification*.
8. **Regression checkpoint** — `grep -rn "isConnected" src/typescript/lib/` — confirm no production seam signature changed; only `FocusHistory.ts` is a new caller.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/core/FocusHistory.ts` |
| Modify | `src/typescript/lib/core/index.ts` (barrel export) |
| Modify | `tests/dom/TestDOM.ts` (`setConnected` injected input; `isConnected` consults it; `makeEvent` gains `code`/modifier fields) |
| Create | `tests/unit/core/FocusHistory.test.ts` |
| Create | `docs/recipes/focus-history.md` |
| Modify | `docs/.vitepress/config.mts` (recipes sidebar entry) |
| Modify | `docs/concepts/accessibility.md` (one cross-reference link) |

---

## Expected Behaviour

Unit-testable through the seam unless marked **manual-verify**.

1. **Seed on enable** — `enable()` with a non-null `getActiveElement()` records it as entry 0; `back()` then has an origin. *(unit)*
2. **Record on focusin** — a `focusin` on a new element appends an entry and advances `_index`; `canGoForward()` becomes false, `canGoBack()` true when >1 entry. *(unit)*
3. **Dedupe consecutive** — two `focusin`s for the same handle produce one entry. *(unit)*
4. **Truncate forward on new focus** — after `back()`, a fresh `focusin` drops the entries ahead of `_index` (no orphan forward branch). *(unit)*
5. **`back()` re-focuses previous** — `getActiveElement()` equals the prior entry; returns true. *(unit)*
6. **`forward()` re-does** — after a `back()`, `forward()` returns to the later entry. *(unit)*
7. **Skip + drop stale** — with an intermediate entry marked `setConnected(h, false)`, `back()` skips it, focuses the next live entry, and the stale entry is gone from the trail. *(unit)*
8. **Service focus not recorded** — `back()`/`forward()` (which call `DOM.sink.focus`) do not append entries or shift `_index` beyond the navigation target; `_navigating` suppresses the replay. *(unit — dispatch a `focusin` for the replayed handle while `_navigating` conceptually holds; verify by asserting entry count unchanged across a `back()`)*
9. **`maxSize` bound** — recording past `maxSize` drops the oldest; `_index` stays at the newest. *(unit)*
10. **`canGoBack`/`canGoForward` honesty** — a trail whose only earlier entries are all stale reports `canGoBack() === false`. *(unit)*
11. **`clear()`** — empties the trail, `_index = -1`, fires `"change"` with both flags false. *(unit)*
12. **Keydown combo** — a `keydown` matching `back`/`forward` (built via extended `makeEvent`) moves focus and calls `preventDefault`; a non-matching combo does neither. *(unit)*
13. **Modal suppression** — with a registered `DismissableLayer` whose `getDismissMode()` is `"modal"` as top layer, the back/forward `keydown` does nothing and does not `preventDefault`. *(unit — reuse the `fakeLayer` stub pattern from `LayerManager.test.ts:36`)*
14. **`disable()` stops observing** — after `disable()`, a `focusin` records nothing and the combo is inert; the trail is preserved. *(unit)*
15. **`"change"` event** — fires on record and on navigate with correct `canGoBack`/`canGoForward`. *(unit)*
16. **Real keyboard + focus ring** — actual `Alt+[`/`Alt+]` in a browser moves the visible focus ring; native `focusin` ordering during `.focus()` keeps the `_navigating` guard tight. *(manual-verify)*
17. **Live overlay coexistence** — opening and closing a real `Dialog` records its internal focus and its restore, and once closed the stale dialog entry is pruned on the next `back()`; no corruption of the surrounding trail. *(manual-verify)*

---

## Verification

- **Typecheck / build:** `npm run build` (project tsc/Vite pipeline) — zero errors.
- **Unit tests:** `npx vitest run tests/unit/core/FocusHistory.test.ts` plus a full `npx vitest run` to confirm the `TestDOM.ts` `isConnected`/`makeEvent` changes regress nothing (Tooltip anchor-watch, editor keydown, LayerManager all touch these).
- **Regression grep:** `grep -rn "isConnected" src/typescript/lib/` — only the new `FocusHistory.ts` is added as a caller; no seam signature moved.
- **Docs build:** `npm run docs:build` — must finish with **zero** warnings (CODE_CONVENTIONS: no `{@link}` to internal symbols from public JSDoc).
- **Manual smoke:** in a demo app, `FocusHistory.enable()`, tab through several controls, then `Alt+[` / `Alt+]` — the focus ring walks the trail; open a modal `Dialog` and confirm the combo is inert while it is up.

---

## Documentation Impact

- **Barrel / API reference:** `FocusHistory` and its four types are exported from `core/index.ts`, so TypeDoc emits them under the core API (`@category Core`). No symbol is renamed or removed.
- **New recipe:** `docs/recipes/focus-history.md` — enable the service, wire `on("change")` to back/forward toolbar buttons, override the combo. Cross-link the *Keyboard shortcuts* recipe (`docs/recipes/keyboard-shortcuts.md`) and register the page in `docs/.vitepress/config.mts` (recipes sidebar, `config.mts:199`–`221`).
- **Concept cross-reference:** add one link from `docs/concepts/accessibility.md` (focus-history aids keyboard navigation).
- **JSDoc link discipline:** public JSDoc may reference `LayerManager` (exported) but must describe internal helpers (`record`, `pruneStale`, `_navigating`) in prose, never `{@link}` them.

---

## Potential Challenges

- **GC-collected weak handles throw on resolve.** `isLive` wraps `DOM.source.isConnected` in try/catch and treats a throw as stale — the intended semantics for a finalized handle (`DOM.ts:201`).
- **Modelled `isConnected` is `false` by default.** Recording is untestable without the `setConnected` injected input; the plan adds it to `TestDOM.ts` following the `setNaturalSize`/`setBorderInset` precedent, default `false` (no existing-caller regression).
- **Synchronous-focusin assumption.** The `_navigating` boolean only covers the replay if `focusin` fires synchronously inside `DOM.sink.focus`; browsers do. Documented inline so a future async-focus quirk is traced here.
- **Coexistence with `LayerManager` `focusin`/`keydown` viewport listeners.** Both fan out through `baseViewportListener` (`Event.ts:143`); ordering is registration order and neither blocks the other. No shared state.
- **Overlay churn.** Handled structurally (record-all + prune-on-navigate), not by special-casing overlays — the only overlay coupling is the single modal read in the keydown handler.
- **Dedupe correctness** relies on canonical handle equality; guaranteed by the registry's node→handle reverse map (`DOM.ts:139`).

---

## Critical Files

- [`src/typescript/lib/core/LayerManager.ts`](src/typescript/lib/core/LayerManager.ts) — the exact broker-namespace + sentinel-owner + viewport-listener pattern to mirror (`:139`, `:521`, `:545`); source of `getTopLayer` / `LayerDismissMode`.
- [`src/typescript/lib/core/Event.ts`](src/typescript/lib/core/Event.ts) — `addViewportListener` / `removeViewportListener` (`:392`, `:429`) and the `baseViewportListener` fan-out (`:143`).
- [`src/typescript/lib/core/DOM.ts`](src/typescript/lib/core/DOM.ts) — `getActiveElement` (`:867`), `isConnected` (`:848`), `sink.focus` (`:542`), `intern`/`isElement` (`:701`/`:732`), `getWindow` (`:887`), `Handle` (`:86`).
- [`src/typescript/lib/core/ListenerBag.ts`](src/typescript/lib/core/ListenerBag.ts) — the custom-event `on`/`off`/`fire` backing (per ARCHITECTURE event-handling split).
- [`src/typescript/lib/overlay/Dialog.ts`](src/typescript/lib/overlay/Dialog.ts) — single-level save/restore prior art (`:465`, `:627`, `:707`, `:744`, `:802`) the service must coexist with.
- [`tests/dom/TestDOM.ts`](tests/dom/TestDOM.ts) — `installTestDOM` (`:992`), sink `dispatchEvent` window fan-out (`:407`), `makeEvent` (`:1018`), `getActiveElement`/`isConnected` model (`:709`, `:719`).
- [`tests/overlay/LayerManager.test.ts`](tests/overlay/LayerManager.test.ts) — the `fakeLayer` stub + afterEach-drain pattern (`:36`, `:68`) to reuse for the modal-suppression test.

---

## Non-Goals

- **No auto-enablement.** The service is opt-in (`enable()`); nothing global starts it, matching the library's consumer-installed-accelerator stance.
- **No browser-history / URL integration.** This is focus history, not `history.pushState`; it does not touch the address bar or the browser back/forward stack.
- **No scoped / per-region histories.** One global trail per document. Multiple independent focus scopes are out of scope.
- **No built-in back/forward UI.** Consumers render their own buttons and drive them via `on("change")` + `back()`/`forward()`.
- **No reuse of `Alt+Left`/`Alt+Right`.** Deliberately avoided so the service never hijacks or fights native browser history navigation.
- **No cross-document / iframe focus tracking.** `focusin` from nested browsing contexts is not observed.
