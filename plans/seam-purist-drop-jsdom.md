---
depends-on: [modelled-dom-events-geometry]
touches-shared: [src/typescript/lib/core/DOM.ts, src/typescript/lib/core/Event.ts, tests/setup/jsdom-setup.ts, vitest.config.ts]
---

# Seam-Purist Tightening — Drop jsdom From The Suite — Implementation Plan

## Overview

Plan 1 ([`modelled-dom-events-geometry`](./modelled-dom-events-geometry.md)) makes the offline harness *able* to deliver modelled events and answer real geometry. This plan makes the framework *able to be tested* under that harness with no browser environment at all: it closes the remaining seam **leaks** — the spots where production code in `src/typescript/lib` touches a global browser constructor or a native event object directly instead of going through `DOM.source` / `DOM.sink` / the `Event` wrapper — so the ~81 component test files can drop their `// @vitest-environment jsdom` pragma and run under the default `node` environment.

**Motivation (the case for going hard-core).** jsdom never implemented layout: its `getBoundingClientRect` returns zero rects — the *same* dead values the old DOM stub returned and the same values Plan 1's oracle now replaces with real composed geometry. So jsdom buys the suite nothing once Plan 1 lands; it only costs. jsdom environment creation dominates suite runtime (~57–67 s of a ~64 s run), so dropping it is both a large speedup *and* full determinism (no userland DOM timing, no partial-spec gaps). The framework already routes essentially all of its DOM through the seam — `grep -rnE "\bdocument\.[a-zA-Z]" src/typescript/lib` and the equivalent `window.` executable grep both return **zero** non-comment hits (every match is JSDoc, a `--ts-ui-window-*` theme token, a local named `window`, or the `Window` component). The leaks that remain are a small, enumerable set of `instanceof` guards against global DOM constructors and native-event construction sites. This is a **production-code refactor**, so it respects [`ARCHITECTURE.md`](../ARCHITECTURE.md) (seam discipline, the `Event` class, handle-only references) and [`CODE_CONVENTIONS.md`](../CODE_CONVENTIONS.md) (typed setters, one-element-per-class).

The `local/no-raw-dom` ESLint rule ([`scripts/eslint/no-raw-dom.js`](../scripts/eslint/no-raw-dom.js)) with its **empty** baseline ([`scripts/eslint/no-raw-dom.baseline.json`](../scripts/eslint/no-raw-dom.baseline.json) is `[]`) already forbids holding `Element`/`Node`/`HTMLElement` and touching raw DOM. But it deliberately does **not** flag `EventTarget`, native event types (`KeyboardEvent`/`PointerEvent`/…), or `instanceof Element` — `Element` in an `instanceof` RHS is a value reference, and only `document`/`window` are in the rule's `GLOBAL_IDENTIFIERS`. So today's leaks pass lint. Part of this plan extends the rule to catch them, turning "purist" from a one-time cleanup into an enforced invariant.

---

## Architecture Decisions

### Leak class 1 — `instanceof` against global DOM constructors → seam predicates

Verified sites (`grep -rnE "instanceof (Element|Node|HTMLElement|HTMLInputElement|HTMLSelectElement|EventTarget)" src/typescript/lib`):

| File:line | Current | Shape |
|---|---|---|
| [`core/Type.ts:34`](../src/typescript/lib/core/Type.ts#L34) | `value instanceof Element` | `isElement` predicate body |
| [`layout/Accordion.ts:697`](../src/typescript/lib/layout/Accordion.ts#L697), [`:723`](../src/typescript/lib/layout/Accordion.ts#L723) | `e.relatedTarget instanceof Node && … contains(el, intern(e.relatedTarget))` | hover-leave containment guard |
| [`overlay/Notification.ts:289`](../src/typescript/lib/overlay/Notification.ts#L289), [`:313`](../src/typescript/lib/overlay/Notification.ts#L313) | same `relatedTarget instanceof Node` pattern | hover-leave containment guard |
| [`overlay/AbstractWindow.ts:2420`](../src/typescript/lib/overlay/AbstractWindow.ts#L2420) | `e.target instanceof Node && … contains(targetEl, intern(e.target))` | target containment guard |
| [`component/container/TabBar.ts:1212`](../src/typescript/lib/component/container/TabBar.ts#L1212) | `if (!(target instanceof Node)) return false` | `isBarChromeTarget` guard before `intern(target)` |
| [`component/container/TabBar.ts:2912`](../src/typescript/lib/component/container/TabBar.ts#L2912) | `target instanceof Node && contains(closeElement, intern(target))` | close-target containment guard |
| [`component/input/AbstractCalendarDropdown.ts:615`](../src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L615) | `if (e.target instanceof HTMLInputElement) return` | skip-preventDefault on the inner input |

The replacement is a pair of **seam predicates** added to the `DOMSource` interface and both implementations: `isNode(value: unknown): boolean` and `isElement(value: unknown): boolean`. The production implementation keeps today's `value instanceof Node` / `value instanceof Element` *inside the seam* (where naming DOM types is allowed — `core/DOM.ts` is the one module exempt from `no-raw-dom`); the modelled implementation answers from the harness's sentinel/handle model (Plan 1's `intern` already recognises sentinels — `isNode`/`isElement` return `true` for an event-target sentinel or an interned handle, `false` for a plain non-node value).

The `relatedTarget instanceof Node` / `target instanceof Node` guards exist purely to make `intern(...)` type-safe (the field is `EventTarget | null`, and `intern` takes `EventTarget`). They become `DOM.source.isNode(e.relatedTarget) && …`. The `HTMLInputElement` guard at `AbstractCalendarDropdown.ts:615` is narrower — it asks "is the target specifically a text input?". Since the only thing the handler does with that fact is *skip `preventDefault`*, and a calendar's only focusable input descendant is its own text field, this is re-expressed as a tag check through the seam: `DOM.source.getTagName(handle) === "INPUT"` after `isNode`+`intern` (the seam already exposes `getTagName` for handle-keyed reads — confirm during implementation; if absent, add `getTagName(handle): string`). This keeps the rule honest: no global constructor is named outside `core/DOM.ts`.

`Type.isElement` ([`core/Type.ts:33`](../src/typescript/lib/core/Type.ts#L33)) is a special case: it is **dead beyond `Type.ts` itself** (`grep -rn "isElement\|ifElement\|requireElement" src/typescript --include=*.ts` shows only the two internal callers at [`Type.ts:45`](../src/typescript/lib/core/Type.ts#L45) and [`Type.ts:59`](../src/typescript/lib/core/Type.ts#L59), both inside `Type.ts`). Decision: re-point its body to `DOM.source.isElement(value)` rather than delete it, because deleting a public `namespace Type` export is a doc/API change outside this plan's scope (see Non-Goals); routing it through the seam closes the leak with a one-line body change and zero call-site churn. Surface the dead-code observation; do not remove it.

### Leak class 2 — native-event construction → the `Event` wrapper owns event shape

`grep -rnE "new (KeyboardEvent|PointerEvent|MouseEvent|Event|CustomEvent|DragEvent|WheelEvent)\(" src/typescript/lib` yields exactly three sites:

- [`core/Event.ts:202`](../src/typescript/lib/core/Event.ts#L202) — `fireEvent`'s string overload builds `new CustomEvent(type, payload)` and hands it to `DOM.sink.dispatchEvent`.
- [`component/table/cell/editor/Number.ts:32`](../src/typescript/lib/component/table/cell/editor/Number.ts#L32) and [`component/table/cell/editor/String.ts:30`](../src/typescript/lib/component/table/cell/editor/String.ts#L30) — each re-wraps a forwarded keydown into `new KeyboardEvent('keydown', { key, code, keyCode, shiftKey, … })` and re-fires it up to the parent cell via `Event.fireEvent`.

Decision: the framework's `Event` namespace becomes the sole constructor of dispatched event objects, so Plan 1's modelled delivery can feed plain sentinel events with **no native `Event`/`KeyboardEvent` construction anywhere in `src/typescript/lib`**.

- **`fireEvent` string overload** ([`Event.ts:202`](../src/typescript/lib/core/Event.ts#L202)): move the `new CustomEvent(...)` *behind the sink*. Add `DOM.sink.dispatchEvent(handle, type, detail?)` (or a sibling `dispatchCustomEvent`) that the **production** sink implements with `new CustomEvent`, and the **modelled** sink implements by building Plan 1's plain sentinel event. `Event.fireEvent` calls the seam method instead of minting a `CustomEvent` itself. This is the cleaner boundary: `Event.ts` (production code) stops naming a global event constructor; the construction lives in `core/DOM.ts` where DOM types are legal.
- **`Number.ts` / `String.ts` editors**: the re-wrap exists to forward a keydown from the inner `TextField` up to the parent cell preserving `key`/`code`/modifiers. Replace `Event.fireEvent(this, new KeyboardEvent('keydown', {...}))` with an `Event.fireEvent(this, "keydown", { key, code, keyCode, shiftKey, ctrlKey, altKey, metaKey })`-style **CustomEvent-detail forward**, *provided* the consuming cell handler ([`Cell.ts:80`](../src/typescript/lib/component/table/cell/Cell.ts#L80), [`CellEditorPool.ts:128`](../src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L128)) reads `key` in a way that survives the CustomEvent shape. **Investigate the consumer first**: if `onKeyDown(e: KeyboardEvent)` reads `e.key` and the forwarded CustomEvent carries `detail.key` not `e.key`, the forward must either (a) put the fields on the event object itself (a plain-object event the modelled and native paths both accept) or (b) the consumer switches to reading `detail`. Prefer routing the forwarded fields through the same seam dispatch the string overload now uses, so one event-construction path serves both. If the keydown re-wrap cannot be reshaped without a behavioural change to the cell editor's commit/cancel flow, document it as a residual in `## Potential Challenges` and keep that one native construction — but the goal is zero.

The two editor handler params (`evnt: KeyboardEvent`) and every other `e.key` / `e.clientX` / `e.deltaY` **read** site (enumerated below) need **no change**: those reads work unchanged on Plan 1's plain sentinel event, which carries `key`/`clientX`/`clientY`/`deltaX`/`deltaY`/`button`/modifier fields. The leak was only the *construction* and the `instanceof` *narrowing*, not the field reads.

### Leak class 3 — the long-tail global surface is mostly already sealed

`grep -rnE "\bCSS\.|FileList|DataTransfer|\bdocument\.|\bwindow\." src/typescript/lib --include=*.ts | grep -v core/DOM.ts` returns ~110 hits. Triaged:

- **(c) False positives — the overwhelming majority (~106).** Executable `document.*` and `window.*` member access: **zero** (`grep -rnE "\bdocument\.[a-zA-Z]" … | grep -vE ":\s*(\*|//)"` and the `window.` equivalent both empty). Every hit is a JSDoc/comment mention ("mounts on `document.documentElement`"), a `--ts-ui-window-*` theme-token string in [`Theme.ts`](../src/typescript/lib/core/Theme.ts), a local variable named `window`/`windowSize`, or the `Window`/`AbstractWindow` component class. No action.
- **(a) Real leaks routed through the seam — `CSS.escape` (2 sites).** [`component/display/Glyphs.ts:159`](../src/typescript/lib/component/display/Glyphs.ts#L159) and [`:184`](../src/typescript/lib/component/display/Glyphs.ts#L184) call `CSS.escape(id)` to build a `querySelector("#"+...)` against the mounted sprite. `CSS` is a global namespace jsdom doesn't ship (hence the [`tests/setup/jsdom-setup.ts`](../tests/setup/jsdom-setup.ts) polyfill). The id passed is always the framework-controlled `ts-glyph-<name>` slug, so a full CSS-escape is overkill; but to keep the seam pure, route it through `DOM.source.escapeSelector(id)` (production: `CSS.escape`; modelled: the same ASCII backslash-quote the polyfill already uses). This deletes the polyfill's reason to exist (see migration). `CSS.supports` is not used (`grep` empty).
- **(b) Residual globals that are *types*, not leaks — `FileList` / `DataTransfer`.** `FileList` appears in [`FileField.ts:132`](../src/typescript/lib/component/input/FileField.ts#L132) (`getFiles(): FileList | null`), [`FileField.ts:357`](../src/typescript/lib/component/input/FileField.ts#L357) (`acceptDroppedFiles(files: FileList)`), and the seam itself ([`DOM.ts:1046`](../src/typescript/lib/core/DOM.ts#L1046), [`:1728`](../src/typescript/lib/core/DOM.ts#L1728)). `e.dataTransfer?.files` is read once in [`FileDropZone.ts:198`](../src/typescript/lib/component/input/FileDropZone.ts#L198). These are **global lib types in signatures**, not constructor references or DOM reads — `FileList`/`DataTransfer`/`File` are Web Platform data types, not element-tree types, and the `no-raw-dom` rule deliberately doesn't flag them (only the `DOM_TYPE_NAMES` element family). A `FileList` is a value the seam already vends via `DOM.source.getFiles(handle)` and that a drop event carries; it doesn't hold an `Element`. **Decision: leave the `FileList` type names as-is.** They are TypeScript `lib.dom.d.ts` *type* references that compile fine under `node` (TS lib types are ambient, independent of the runtime environment) and need no runtime `FileList` global. The `e.dataTransfer?.files` read works on the sentinel event if a file-drop test injects a `dataTransfer` field; that is Plan 1 harness territory, and offline file-drop is marked needs-manual-verify (no real `FileList` offline). Flag in `## Potential Challenges`.

### Extend `no-raw-dom` to enforce the no-`instanceof`-global invariant

After the leaks close, add a clause to [`scripts/eslint/no-raw-dom.js`](../scripts/eslint/no-raw-dom.js) so a future `x instanceof Element` / `instanceof Node` / `instanceof HTMLInputElement` outside `core/DOM.ts` is a build error — otherwise the cleanup silently regresses. The rule already has the type machinery (`typeIsDom`, `FLAGGED_TYPE_NAMES`); add a `BinaryExpression` visitor for `operator === "instanceof"` whose `right` Identifier resolves to a flagged DOM type. Keep the empty baseline empty (the migration fixes every existing hit before the rule tightens). This is the enforcement half of "purist".

### Migration end-state: node + one tiny residual shim (honest about the `CustomEvent` floor)

The user asked to go hard-core toward "zero global browser surface." We reach it for `src/typescript/lib`: after the leaks close, no production module names a DOM constructor, reads a raw global, or constructs a native event. The **test** end-state:

- Drop `// @vitest-environment jsdom` from the ~81 component test files; they run under `node`.
- Set `vitest.config.ts` default `environment: 'node'` (already the default — just remove the per-file opt-in expectation from the comment) and delete the `jsdom`-specific `setupFiles` entry once its shims are gone.
- Delete the `matchMedia` and `CSS.escape` polyfills in [`tests/setup/jsdom-setup.ts`](../tests/setup/jsdom-setup.ts): `matchMedia` already routes through `DOM.source.matchMedia` (which Plan 1 / the seam answers off-browser — [`Glyph.ts:119`](../src/typescript/lib/component/display/Glyph.ts#L119), [`Animation.ts:74`](../src/typescript/lib/core/Animation.ts#L74)), and `CSS.escape` is replaced by `DOM.source.escapeSelector`. The file becomes empty or is deleted.
- Remove `jsdom` from [`package.json`](../package.json#L118) `devDependencies`.

**Honest caveat (purist vs pragmatic).** Two things resist full seaming and may force a *residual* and explicitly-documented allowance, not a global shim:
1. **`CustomEvent` / `KeyboardEvent` construction** moves *behind the seam* into `core/DOM.ts`'s production sink — which still references the native constructor. That is correct seam discipline (the seam is the one place allowed to name DOM types), not a leak; under `node` the production sink is never instantiated (tests install the modelled sink), so the native constructors are never evaluated. No runtime global needed.
2. **`FileList`/`DataTransfer`** remain as ambient TS *type* names in signatures (compile-only, no runtime global). Real file-drop behaviour stays manual-verify.

So the achievable end-state is **node with zero shim file** for production code, with the only "browser names" surviving as (a) seam-internal production-sink construction never run under `node`, and (b) ambient TS lib types. That is the purist end-state honestly stated.

---

## Public API (TypeScript Signatures)

All additions are **seam interface** methods on `DOMSource` / `DOMSink` in [`core/DOM.ts`](../src/typescript/lib/core/DOM.ts), implemented in both `ProductionDOMSource`/`ProductionDOMSink` and the modelled `tests/dom/TestDOM.ts` pair (the modelled side is Plan 1's harness — coordinate the additions there).

```ts
interface DOMSource {
    /** True when value is a DOM Node (production: `value instanceof Node`;
     *  modelled: an event-target sentinel or interned handle). */
    isNode(value: unknown): boolean;

    /** True when value is a DOM Element (production: `value instanceof Element`;
     *  modelled: as isNode, narrowed to element handles). */
    isElement(value: unknown): boolean;

    /** Tag name of a handle's element, uppercased (e.g. "INPUT"). Used to
     *  replace `instanceof HTMLInputElement`. Add only if not already present. */
    getTagName(handle: Handle): string;

    /** CSS.escape for selector construction (production: `CSS.escape`;
     *  modelled: ASCII backslash-quote, matching today's jsdom-setup shim). */
    escapeSelector(value: string): string;
}

interface DOMSink {
    /** Dispatch a custom event of `type` carrying `detail` on a handle.
     *  Production builds a native CustomEvent; modelled builds a plain sentinel
     *  event (Plan 1). Replaces `Event.fireEvent`'s inline `new CustomEvent`. */
    dispatchCustomEvent(handle: Handle, type: string, detail?: unknown): void;
}
```

No new `Component` DOM property, so no typed-setter / `_field` / `XOptions` triad is introduced.

---

## Ordered Implementation Steps

> Plan-1 dependency: the **modelled** implementations of every method below live in `tests/dom/TestDOM.ts`, which Plan 1 owns. If Plan 1 is already implemented, extend its `ModelledDOMSource`/`RecordingDOMSink`; if landed in the same cycle, coordinate so the seam interface and both implementations move together (the `touches-shared` keys flag `DOM.ts` + the harness).

1. **Add seam predicates** (`core/DOM.ts`): declare `isNode`, `isElement`, `escapeSelector` on `DOMSource`; `dispatchCustomEvent` on `DOMSink`. Implement on `ProductionDOMSource`/`ProductionDOMSink` with the native bodies (`instanceof`, `CSS.escape`, `new CustomEvent`). Add `getTagName` only if `grep -n "getTagName" core/DOM.ts` shows it's missing.
2. **Modelled implementations** (`tests/dom/TestDOM.ts`, Plan 1 harness): `isNode`/`isElement` recognise the event-target sentinel and interned handles; `escapeSelector` reuses the ASCII backslash-quote from the old `jsdom-setup` shim; `dispatchCustomEvent` builds Plan 1's plain sentinel event and routes it through the modelled `dispatchEvent`; `getTagName` reads the handle stub's `tagName`.
3. **Close `instanceof Node`/`Element` guards**: edit `Accordion.ts:697,723`, `Notification.ts:289,313`, `AbstractWindow.ts:2420`, `TabBar.ts:1212,2912` to `DOM.source.isNode(...)` ahead of `intern`. Verify: `grep -rnE "instanceof (Element|Node|HTMLElement|EventTarget)" src/typescript/lib` — expect only the `core/DOM.ts` seam bodies (which the file is exempt from) and zero in `component`/`layout`/`overlay`.
4. **Close `instanceof HTMLInputElement`** (`AbstractCalendarDropdown.ts:615`): `isNode` + `intern` + `getTagName(handle) === "INPUT"`. Verify `grep -rn "instanceof HTML" src/typescript/lib` — expect zero outside the seam.
5. **Route `Type.isElement`** (`core/Type.ts:34`): body becomes `return DOM.source.isElement(value);`. Add the `DOM` import. Note the dead-code observation in the report (do not remove `Type.isElement`/`ifElement`/`requireElement`).
6. **Re-route `fireEvent`'s string overload** (`Event.ts:202`): replace `new CustomEvent(...)` + `DOM.sink.dispatchEvent(element, ...)` with `DOM.sink.dispatchCustomEvent(element, typeOrEvent, payload)`. Keep the pre-built-event overload ([`Event.ts:204`](../src/typescript/lib/core/Event.ts#L204)) as-is for now (it forwards a caller-supplied event; the only callers that supplied a *native-constructed* one are the two editors, fixed next).
7. **Reshape editor keydown forwards** (`Number.ts:32`, `String.ts:30`): investigate the consumer (`Cell.ts:80`, `CellEditorPool.ts:128`) first; replace `Event.fireEvent(this, new KeyboardEvent('keydown', {...}))` with a seam/CustomEvent-detail forward carrying `key`/`code`/`keyCode`/modifiers such that the consumer's `e.key`/modifier reads still resolve. Verify `grep -rnE "new (KeyboardEvent|CustomEvent|MouseEvent|PointerEvent|WheelEvent|Event)\(" src/typescript/lib` — expect zero (or document any residual in Challenges).
8. **Route `CSS.escape`** (`Glyphs.ts:159,184`): `CSS.escape(id)` → `DOM.source.escapeSelector(id)`. Verify `grep -rn "CSS\.escape\|CSS\.supports" src/typescript/lib` — expect zero.
9. **Tighten `no-raw-dom`** (`scripts/eslint/no-raw-dom.js`): add a `BinaryExpression` visitor flagging `instanceof <flagged-DOM-type>` outside `core/DOM.ts`. Run `npx eslint src` — expect green (every site fixed in steps 3–5) with the empty baseline unchanged.
10. **Migrate tests off jsdom**: remove `// @vitest-environment jsdom` from the ~81 files (`grep -rln "@vitest-environment jsdom" tests/`); the `vitest.config.ts` default `node` env then applies. Run the suite.
11. **Strip the shim file** (`tests/setup/jsdom-setup.ts`): delete the `matchMedia` and `CSS.escape` polyfills; if the file ends empty, remove it and drop the `setupFiles` entry in `vitest.config.ts`. Update the stale comment on `vitest.config.ts:10`.
12. **Remove the dependency**: delete `"jsdom"` from `package.json:118`; `npm install` to update the lockfile. Verify `grep -rn "jsdom" tests/ src/ vitest.config.ts vite.config.ts` — expect zero (besides this plan).
13. **Full verification**: typecheck, lint, the whole suite under `node`, and a before/after runtime comparison.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/DOM.ts` — `isNode`/`isElement`/`escapeSelector`/`getTagName?` on `DOMSource`; `dispatchCustomEvent` on `DOMSink`; production bodies |
| Modify | `src/typescript/lib/core/Event.ts` — `fireEvent` string overload routes through `dispatchCustomEvent` |
| Modify | `src/typescript/lib/core/Type.ts` — `isElement` body → `DOM.source.isElement` |
| Modify | `src/typescript/lib/layout/Accordion.ts` — two `isNode` guards |
| Modify | `src/typescript/lib/overlay/Notification.ts` — two `isNode` guards |
| Modify | `src/typescript/lib/overlay/AbstractWindow.ts` — one `isNode` guard |
| Modify | `src/typescript/lib/component/container/TabBar.ts` — two `isNode` guards |
| Modify | `src/typescript/lib/component/input/AbstractCalendarDropdown.ts` — `isNode`+`getTagName` guard |
| Modify | `src/typescript/lib/component/display/Glyphs.ts` — two `escapeSelector` calls |
| Modify | `src/typescript/lib/component/table/cell/editor/Number.ts` — keydown forward reshape |
| Modify | `src/typescript/lib/component/table/cell/editor/String.ts` — keydown forward reshape |
| Modify | `tests/dom/TestDOM.ts` — modelled `isNode`/`isElement`/`escapeSelector`/`dispatchCustomEvent`/`getTagName` (Plan 1 harness) |
| Modify | `scripts/eslint/no-raw-dom.js` — `instanceof <DOM-type>` clause |
| Modify | `vitest.config.ts` — default-env comment, drop `setupFiles` if shim deleted |
| Modify | `package.json` — remove `jsdom` devDependency |
| Modify | ~81 files under `tests/` — remove `// @vitest-environment jsdom` |
| Delete | `tests/setup/jsdom-setup.ts` — if it ends empty after shim removal |

No new files. No theme tokens. No public-API *additions* visible to consumers (seam interfaces are internal; `Type.isElement`'s signature is unchanged).

---

## Expected Behaviour

Derived from the seam contract and the routing in `Event.ts` — not from current output. Most cases are **unit-testable offline** under Plan 1's harness; file-drop and real-browser focus stay manual.

### Seam predicates

1. **`isNode` true for node-like, false otherwise** *(offline)*. `DOM.source.isNode(<interned handle / event-target sentinel>)` → `true`; `DOM.source.isNode(null)` / `isNode("x")` / `isNode({})` → `false`. Production: matches `instanceof Node`.
2. **`isElement` narrows to elements** *(offline)*. `isElement` true for an element handle/sentinel, false for a non-node value; production matches `instanceof Element`.
3. **`getTagName` reports the tag** *(offline)*. For a handle whose stub `tagName` is `"INPUT"`, `getTagName(handle) === "INPUT"`; the calendar guard skips `preventDefault` exactly when the target is the inner input and not otherwise.
4. **`escapeSelector` round-trips glyph ids** *(offline)*. `escapeSelector("ts-glyph-arrow-up")` returns it unchanged (all chars in `[a-zA-Z0-9_-]`); a char outside the set is backslash-quoted — identical to the deleted jsdom-setup shim.

### Containment guards (behaviour preserved)

5. **Accordion / Notification hover-leave still no-ops on internal relatedTarget** *(offline)*. When `e.relatedTarget` is a descendant of the header/notification element, the `isNode`+`contains` guard returns early (tools stay revealed) exactly as the `instanceof Node`+`contains` version did; a `null` relatedTarget falls through to the hide path. *(Needs Plan 1 modelled `relatedTarget` on the sentinel event + a built modelled tree for `contains`.)*
6. **`AbstractWindow` target-containment guard preserved** *(offline)*. Same: target inside `targetEl` → early return; outside or non-node → proceeds.
7. **`TabBar.isBarChromeTarget` unchanged** *(offline)*. Returns `true` iff the (non-null, node) target is contained in an entry wrapper; non-node target → `false` (no throw on `intern`).

### Event construction

8. **`fireEvent(component, type, payload)` dispatches a custom event with detail** *(offline)*. A subtree/exact listener for `type` runs with the payload reachable (via `detail` or the sentinel's fields per Plan 1); no native `CustomEvent` is constructed under the modelled sink. Production still dispatches a real `CustomEvent`.
9. **Editor keydown forward reaches the cell handler with `key`/modifiers intact** *(offline)*. Typing a key in the inner `TextField` forwards a `"keydown"` to the parent cell; the cell's `onKeyDown` reads the same `key`/`shiftKey`/… it would have from a native keydown. *(Gate: the consumer reads the forwarded fields, not a now-absent native property.)*
10. **No native event constructor remains** *(offline, grep-testable)*. `grep -rnE "new (KeyboardEvent|PointerEvent|MouseEvent|WheelEvent|CustomEvent|Event)\(" src/typescript/lib` → zero.

### Field reads unaffected

11. **`e.key` / `e.clientX` / `e.deltaY` handlers fire identically under modelled events** *(offline)*. The ~49 keyboard/pointer field-read sites (`AutoCompleteField`, `Tree`, `Slider`, `VirtualScroller`, `SplitGutter`, `TabBar`, `Body`, …) read the same values off Plan 1's sentinel event as off a native one — *no code change*, asserted by the existing/new component tests passing under `node`.

### Migration end-state

12. **Suite passes under `node` with jsdom removed** *(offline)*. The full suite runs green with no `// @vitest-environment jsdom` pragma, no `jsdom` dependency, and no shim file. *(This is the headline acceptance gate.)*
13. **Runtime drops** *(offline, measured)*. Wall-clock suite time falls by the jsdom-environment share (~57–67 s of ~64 s today) — record a before/after.
14. **Lint forbids regressions** *(offline)*. `npx eslint src` flags a freshly-added `x instanceof Element` outside `core/DOM.ts` (spot-check by temporarily adding one).

### Needs manual-verify

15. **Real file-drop** *(manual)*. `e.dataTransfer.files` / `FileList` behaviour has no offline model; verify in the app demo (drag a file onto the `FileDropZone`).
16. **Real browser event capture / passive semantics / native focus** *(manual)*. The production sink's `CustomEvent`/`addEventListener`/`focus` paths are exercised only in a real browser; the in-app demos cover them.

---

## Verification

- **Typecheck**: `npm run typecheck` — seam additions are typed; `FileList` ambient types still resolve under `node`.
- **Lint**: `npx eslint src scripts` — green with the empty baseline; the new `instanceof` clause catches regressions (spot-check per case 14).
- **Grep invariants** (all expect zero outside `core/DOM.ts`):
  - `grep -rnE "instanceof (Element|Node|HTMLElement|HTMLInputElement|HTMLSelectElement|EventTarget)" src/typescript/lib`
  - `grep -rnE "new (KeyboardEvent|PointerEvent|MouseEvent|WheelEvent|CustomEvent|Event)\(" src/typescript/lib`
  - `grep -rn "CSS\.escape\|CSS\.supports" src/typescript/lib`
  - `grep -rln "@vitest-environment jsdom" tests/`
  - `grep -rn "jsdom" package.json vitest.config.ts vite.config.ts`
- **Suite under node**: `npx vitest run` — full green (cases 8–12). Compare wall-clock against a pre-change `npx vitest run` for case 13; expect a multi-fold drop.
- **Unit coverage of seam predicates**: tests for cases 1–4 in the harness suite (`tests/dom/…`); containment-guard cases 5–7 in the relevant component tests under Plan 1's modelled events.
- **`npm run docs:build`**: 0 errors / 0 link warnings (the only acceptable warning is typedoc's "unsupported TypeScript version"). No public API moved, so this is a regression guard, not a doc update.
- **Manual smoke** (cases 15–16): in the app — file-drop on `FileDropZone`, Accordion/Notification hover-leave near a child, calendar dropdown pointer-down on its input, a table cell keydown commit/cancel, a glyph render (escapeSelector path). Name the demo screens: the misc/input demos and the table demo.

---

## Potential Challenges

- **Plan 1 sequencing.** Every modelled implementation lands in `tests/dom/TestDOM.ts`. If Plan 1 isn't merged first, this plan's `node` suite has no modelled events/geometry to run against. `depends-on` enforces order; if co-developed, move the seam interface + both impls in one change.
- **Editor keydown forward shape.** If `Cell.onKeyDown` / `CellEditorPool` read native-only `KeyboardEvent` properties the CustomEvent-detail forward can't carry transparently, the reshape touches the consumer too — investigate before editing, and if it can't be done without altering commit/cancel behaviour, keep that single `new KeyboardEvent` and document it as the one residual native construction.
- **`getTagName` may not exist on the seam.** If absent, adding it is in scope; confirm via `grep` before assuming. The calendar guard is the only consumer, so keep it minimal.
- **`FileList`/`DataTransfer` residual.** These remain as ambient TS type names (compile-only) and as runtime values only a real browser/jsdom produces; offline file-drop stays manual-verify. This is the honest limit of "zero browser surface" — types are not leaks, but a reader expecting *literally no DOM identifiers* will see `FileList` in signatures.
- **A component test that secretly relied on jsdom layout.** jsdom returns zero rects, so any test asserting non-zero geometry was already using Plan 1's oracle (or was a stub). But a test that called a real `document.createElement`/`querySelector` through some non-seam path would break under `node` — surface it as a finding, don't paper it over with a reinstated shim. (The zero-executable-`document.` grep says none exist in `src`; a *test* doing so is the risk.)
- **`matchMedia` polyfill removal.** The lib path already uses `DOM.source.matchMedia`; the jsdom-setup polyfill patches jsdom's *own* `window.matchMedia`, which nothing in the seam-routed code consults under `node`. Confirm no test imports a path that touches `window.matchMedia` directly before deleting.
- **Lint `instanceof` clause false positives.** A user-defined class named `Element`/`Node` would trip a naïve name check; gate the new clause on the same `typeIsDom` lib-symbol confirmation the existing visitors use, not on the identifier name alone.

---

## Critical Files

- [`src/typescript/lib/core/DOM.ts`](../src/typescript/lib/core/DOM.ts) — the seam; where `isNode`/`isElement`/`escapeSelector`/`dispatchCustomEvent` are declared and natively implemented (the one module allowed to name DOM types).
- [`src/typescript/lib/core/Event.ts`](../src/typescript/lib/core/Event.ts) — `fireEvent` (the `CustomEvent` construction to re-route), `baseListener` field reads.
- [`tests/dom/TestDOM.ts`](../tests/dom/TestDOM.ts) — Plan 1's harness; the modelled implementations of every new seam method land here.
- [`scripts/eslint/no-raw-dom.js`](../scripts/eslint/no-raw-dom.js) + [`scripts/eslint/no-raw-dom.baseline.json`](../scripts/eslint/no-raw-dom.baseline.json) — the enforcement rule (empty baseline) the new `instanceof` clause extends.
- [`tests/setup/jsdom-setup.ts`](../tests/setup/jsdom-setup.ts) — the `matchMedia` + `CSS.escape` shims this plan deletes.
- [`vitest.config.ts`](../vitest.config.ts) — default `node` env, `setupFiles`.
- [`src/typescript/lib/component/table/cell/Cell.ts`](../src/typescript/lib/component/table/cell/Cell.ts) + [`editor/CellEditorPool.ts`](../src/typescript/lib/component/table/cell/editor/CellEditorPool.ts) — the keydown-forward consumers to investigate before reshaping the editors.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) (seam discipline, `Event` class), [`CODE_CONVENTIONS.md`](../CODE_CONVENTIONS.md) (typed setters, one-element-per-class).

---

## Non-Goals

- **No new component behaviour.** Every changed line traces to a seam leak; no feature, no refactor of adjacent code.
- **No removal of `Type.isElement`/`ifElement`/`requireElement`.** They are dead beyond `Type.ts` but removing public `namespace Type` exports is a doc/API change out of scope — flag the dead code, re-route the body, don't delete.
- **No selector-engine / `querySelector` modelling.** `escapeSelector` only escapes; the modelled `querySelector` stays Plan 1's concern.
- **No worker-transport work.** The seam stays worker-ready; serialising across a boundary is separate.
- **No `FileList`/`DataTransfer` seam abstraction.** They remain ambient TS types in signatures; offline file-drop is not modelled (manual-verify).
- **No change to the pre-built-event `fireEvent` overload's contract.** Only its sole native-constructing callers (the two editors) are reshaped; the overload itself stays for legitimate pre-built-event forwarding.
