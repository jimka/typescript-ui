# Listeners in the Component Options Bag — Implementation Plan

## Overview

Today only DOM-less event hosts can register listeners from their options bag, and each does it with hand-written `if (options?.listeners?.X !== undefined) this.on("X", ...)` boilerplate in its constructor. A plain `Component` (or `ToolBar`) cannot register a DOM listener through its options bag at all — callers must reach for `Event.addListener` by hand after construction.

This plan adds a `listeners` field to the base [`ComponentOptions`](../src/typescript/lib/core/Component.ts#L106) so **any** Component subclass can wire DOM event listeners (`click`, `mouseenter`, …) declaratively, with **zero host code**. It also threads the existing per-host custom-event bags onto a single shared protected helper, replacing the N-line boilerplate in the ten Component-derived hosts. The four non-Component hosts (`Tab`, `Accordion`, `ButtonGroup`, `AbstractStore`) are handled separately because they own no DOM element and so cannot use the DOM path — `AbstractStore` already has the cleanest version of the helper and stays as-is.

Core files: [`Component.ts`](../src/typescript/lib/core/Component.ts), [`Event.ts`](../src/typescript/lib/core/Event.ts), [`ListenerBag.ts`](../src/typescript/lib/core/ListenerBag.ts).

---

## Architecture Decisions

### The host split is three-way, not "14 uniform hosts" — and it drives everything

The 14 hand-wired hosts fall into three groups by base class, verified by reading each declaration:

- **Component subclasses (10):** `Tree`, `AbstractInput`, `SpinButton` (via `Button`), `WindowBorder`, `SplitGutter`, `CollapseButton`, `Scrollbar`, `ResizeHandle`, `TabBar` (via `Container`), `Drawer`. These own a DOM element, so both DOM and custom listeners are meaningful. They get the new base mechanism.
- **`LayoutManager` subclasses (2):** `Tab`, `Accordion` ([`LayoutManager extends BaseObject`](../src/typescript/lib/layout/LayoutManager.ts#L29)). No element of their own — DOM listeners are nonsensical. They only have custom events fired via `ListenerBag`.
- **Plain classes (2):** `ButtonGroup` ([class with no `extends`](../src/typescript/lib/core/ButtonGroup.ts), [`AbstractStore`](../src/typescript/lib/data/AbstractStore.ts#L72) — `export abstract class AbstractStore`). No element either.

Only the 10 Component hosts can share the base mechanism. `ToolBar` (problem 3) is a Component subclass with **no** custom events, so it gets DOM listeners for free with no host edits. The 4 non-Component hosts keep custom-only wiring; the plan refactors them only for boilerplate parity, not to route through Component.

### Unified `listeners` value type — index-signature base that custom bags widen

Problem 1 is a TypeScript variance constraint: a sub-interface property must be **assignable to** the base's. A custom bag like `{ collapse?: () => void }` is not assignable to a strict DOM-event map keyed by `keyof GlobalEventHandlersEventMap`. The resolution is to make the base type **open** so any host bag is a valid subtype:

```typescript
// In ComponentOptions
listeners?: ComponentListeners;
```

where

```typescript
export type ComponentListeners =
    Partial<Record<keyof GlobalEventHandlersEventMap, (event: Event) => void>>
    & { [event: string]: ((...args: any[]) => void) | undefined };
```

The index signature `[event: string]` is what makes a custom bag assignable: a host's `{ collapse?: () => void }` widens cleanly under it. The mapped DOM-event half preserves *autocomplete* and *typed-event* ergonomics for known DOM names (`click`, `pointerdown`, …) without forcing custom keys to match.

A host narrows by **redeclaring** `listeners` as the intersection of its custom bag with the base type, e.g.:

```typescript
// CollapseButtonOptions
listeners?: ComponentListeners & { collapse?: () => void };
```

This stays assignable to the base (intersection is a subtype), keeps the strong `collapse` payload typing the host already had, and lets the same bag also carry DOM keys (`click`, …). The host's existing custom keys remain compile-checked; only DOM keys fall back to the loose `(event: Event) => void`.

**Tradeoff (stated explicitly):** the open index signature means a typo'd custom key (`{ collaps: … }`) is *not* a compile error on a host bag — it is silently accepted and routed to `Event.addListener("collaps", …)` as a DOM type that never fires. The alternative — a closed union with no index signature — would catch the typo but makes every host bag fail the assignability check (problem 1 returns) and blocks problem 3 (a bare Component could never carry custom-shaped keys). Openness is the price of a single unified field; the per-host intersection recovers payload typing for the keys a host cares about, which is the part that actually matters.

**Rejected — two separate fields** (`listeners` for custom, `domListeners` for DOM). Avoids the variance problem entirely, but contradicts the confirmed scope ("one bag carries both"), forces callers to learn two field names, and leaves the existing hosts' field meaning DOM-incapable. Rejected for ergonomics.

**Rejected — base `listeners` strongly typed to DOM only, custom hosts keep a different field name** (`on`/`handlers`). Breaks the 14 hosts' public `listeners` field name (a public-API rename across the library) for no gain. Rejected.

### Timing split — DOM in `applyOptions`, custom in one post-super helper

Problem 2 is the construction-order split, confirmed by reading [`Component` constructor](../src/typescript/lib/core/Component.ts#L318): `applyOptions` runs *inside* `super()`, **before** a subclass's `_listeners: ListenerBag = new ListenerBag()` field initializer. So:

- **DOM keys** are wired in base `applyOptions` via a new `applyListenerOptions(opts)` sub-hook (mirroring the existing [`applyChromeOptions`](../src/typescript/lib/core/Component.ts#L474) pattern). `Event.addListener` needs only the component's id and the global map — confirmed safe during the super() cascade, no element or subclass field required. This is what gives `ToolBar` and bare `Component` DOM listeners with zero host code (problem 3).
- **Custom keys** cannot be wired here — `this._listeners` does not exist yet. They are wired by a single shared protected helper the host calls **once** in its constructor body, after `super()` returns. This helper replaces the per-host boilerplate.

### Routing — host passes its custom-event key set; base owns DOM detection

The helper must split a mixed bag into DOM keys (→ `Event.addListener`) and custom keys (→ `this.on`) without double-wiring. The base `applyListenerOptions` already consumed the DOM keys during super(); the post-super helper must consume only the custom keys. Three routing strategies were considered:

1. **A global "known DOM event names" set.** Fragile — must enumerate every DOM event, and a custom event named like a DOM one (none today, but e.g. `"scroll"` on `Scrollbar`) would mis-route. Rejected.
2. **Structural partition** (host bag has nested `dom:` / `custom:` sub-objects). Breaks the flat-bag ergonomics and the existing field shape. Rejected.
3. **The host declares its own custom-event key list.** Each host already has a `TXxxEvent` string-literal union and an `on()` overload set — it *knows* its keys. The helper takes that list, pulls exactly those keys out of the bag for `this.on`, and the base `applyListenerOptions` skips them. **Chosen** — it is explicit, needs no global registry, and a host's custom key always wins its own name regardless of DOM-name collisions.

Concretely, the base splits as: `applyListenerOptions(opts)` iterates the bag and calls `Event.addListener` for every key **not** in a per-instance "custom keys" set; the post-super helper `applyCustomListeners(opts.listeners, customKeys)` calls `this.on` for every key **in** `customKeys`. The custom-key set is supplied by the host (it passes its literal key array), so the base never needs to know custom names a priori. The set is stored on a protected field during `applyOptions` so the DOM pass can consult it.

**Ordering wins:** every existing host wires `options.listeners.X` *after* its internal wiring and lets the option win (it is appended to the bag) — `ListenerBag.add` and `Event.addListener` both append, so registration order is preserved exactly. No behavioural change.

### `Scrollbar` `"scroll"` collision is real — handle via the custom-key set

`Scrollbar` has a custom event named `"scroll"`, which is also a DOM event name. Because routing strategy 3 makes the **host's custom-key list authoritative**, `"scroll"` on a Scrollbar bag routes to `this.on` (custom), never to `Event.addListener`. This is the correct, behaviour-preserving outcome and is the concrete reason strategy 1 (global DOM-name set) was rejected.

### Non-Component hosts stay off the Component path

`Tab`, `Accordion`, `ButtonGroup` keep their own constructor wiring (they have no DOM element and no `applyListenerOptions`). `AbstractStore` already iterates `Object.keys(options.listeners)` generically in its own `applyOptions` — the cleanest existing form — and needs no change. The plan refactors `Tab`/`Accordion`/`ButtonGroup` only to collapse their `if (…!==undefined) this.on(…)` blocks into the same generic key-iteration `AbstractStore` already uses, for consistency; their `listeners` field type stays a plain custom bag (no `ComponentListeners`), since they cannot accept DOM keys.

---

## Public API (TypeScript Signatures)

```typescript
// Component.ts — new exported type
export type ComponentListeners =
    Partial<Record<keyof GlobalEventHandlersEventMap, (event: Event) => void>>
    & { [event: string]: ((...args: any[]) => void) | undefined };

// Component.ts — ComponentOptions gains:
export interface ComponentOptions {
    // …existing fields…
    /**
     * Event listeners wired at construction. DOM-event keys (`click`,
     * `pointerdown`, …) register via `Event.addListener`; a subclass that
     * declares custom events widens this with its own keys, which route to
     * `on()` instead.
     */
    listeners?: ComponentListeners;
}

// Component — new protected members
protected _customListenerKeys: Set<string>;   // populated per applyOptions pass

/** DOM-listener sub-hook, mirrors applyChromeOptions. Called from applyOptions. */
protected applyListenerOptions(opts: TOptions): void;

/**
 * Wires the custom-event entries of a listeners bag via this.on(). Hosts with
 * custom events call this ONCE in their constructor after super() returns,
 * passing their literal custom-event key list.
 */
protected applyCustomListeners(
    listeners: ComponentListeners | undefined,
    customKeys: readonly string[]
): void;
```

A host widens the type and supplies its keys like:

```typescript
// CollapseButtonOptions
listeners?: ComponentListeners & { collapse?: () => void };

// CollapseButton constructor, after super():
this.applyCustomListeners(options?.listeners, ["collapse"]);
```

The base `applyListenerOptions` registers `customKeys` on `this._customListenerKeys` so the same pass skips them; but since the host's `applyCustomListeners` runs post-super while `applyListenerOptions` runs during super, the host passes its key list to **both**. To avoid duplicating the literal, the host stores it once:

```typescript
private static readonly CUSTOM_LISTENER_KEYS = ["collapse"] as const;
```

and the base reads it through a small protected accessor the host overrides:

```typescript
/** Custom-event key names this class owns; "" base returns []. Hosts override. */
protected customListenerKeys(): readonly string[] { return []; }
```

`applyListenerOptions` calls `this.customListenerKeys()` to know what to skip; the host's post-super call passes the same accessor result. One source of truth, consulted from both timings.

---

## Internal Structure

Base `applyListenerOptions` (called from `applyOptions`, during super()):

```typescript
protected applyListenerOptions(opts: TOptions): void {
    const listeners = opts.listeners;
    if (!listeners) return;

    const custom = new Set(this.customListenerKeys());
    for (const type of Object.keys(listeners)) {
        if (custom.has(type)) continue;          // routed to on() post-super
        const fn = listeners[type];
        if (fn) Event.addListener(this, type, fn);
    }
}
```

Base `applyCustomListeners` (called by host post-super):

```typescript
protected applyCustomListeners(
    listeners: ComponentListeners | undefined,
    customKeys: readonly string[]
): void {
    if (!listeners) return;
    for (const event of customKeys) {
        const fn = listeners[event];
        if (fn) this.on(event as any, fn);
    }
}
```

Host pattern (replaces all the `if (options?.listeners?.X !== undefined) this.on(...)` blocks):

```typescript
protected customListenerKeys(): readonly string[] { return ["collapse"]; }
// …in constructor, after super():
this.applyCustomListeners(options?.listeners, this.customListenerKeys());
```

`applyOptions` calls `this.applyListenerOptions(opts)` at the end (after `components`, so listeners are wired last — matches current host ordering where listener wiring is the tail of the constructor).

---

## Ordered Implementation Steps

1. **Base type + field.** In [`Component.ts`](../src/typescript/lib/core/Component.ts): add `import { Event } from "~/core/Event.js"` (verify no cycle — Event already imports Component; a value import of `Event` into Component is a runtime cycle, so import lazily inside the method or confirm the existing module graph tolerates it — see Potential Challenges). Add the `ComponentListeners` type, add `listeners?: ComponentListeners` to `ComponentOptions`, add `protected customListenerKeys(): readonly string[] { return []; }`.

2. **Base DOM hook.** Add `applyListenerOptions(opts)` and call it from `applyOptions` after the `components` dispatch. → verify: a bare `new Component({ listeners: { click: fn } })` fires `fn` on click.

3. **Base custom helper.** Add `applyCustomListeners(listeners, customKeys)`. → verify: typecheck only (no host uses it yet).

4. **Barrel.** Export `ComponentListeners` from [`core/index.ts`](../src/typescript/lib/core/index.ts) alongside `ComponentOptions`.

5–14. **Migrate the 10 Component hosts.** For each: (a) widen its `XOptions.listeners` to `ComponentListeners & { …existing bag… }`; (b) add `protected customListenerKeys()` returning its literal key list; (c) replace the `if (options?.listeners?.X !== undefined) this.on(...)` block(s) with a single `this.applyCustomListeners(options?.listeners, this.customListenerKeys())`. Hosts and their key lists:
   - `Tree` — `["selection","loaderror"]`
   - `AbstractInput` — `["change","binding"]`
   - `SpinButton` — `["tick"]` (note: `action` comes from `Button`, not in the bag — leave untouched)
   - `WindowBorder` — `["drag"]`
   - `SplitGutter` — `["dragstart","drag","collapse"]`
   - `CollapseButton` — `["collapse"]`
   - `Scrollbar` — `["scroll"]` (confirm `"scroll"` lands in custom set so it never reaches `Event.addListener`)
   - `ResizeHandle` — `["dragstart","dragmove","dragend"]`
   - `TabBar` — `["tabpressed","reordered","tabclose","dockrequested","tabdragstart","tearoffrequested","detached"]`
   - `Drawer` — `["open","close","beforeclose"]`
   → verify after each: typecheck + the existing demo for that host still fires its custom listeners.

15. **`ToolBar` — zero-edit DOM listeners.** No source change. Confirm `new ToolBar({ listeners: { click: fn } })` wires through the inherited base mechanism. → verify in `ToolBarPanel` demo.

16. **Non-Component hosts.** `Tab`, `Accordion`, `ButtonGroup`: collapse their `if (…) this.on(…)` blocks into a generic `for (const event of Object.keys(options.listeners))` loop matching `AbstractStore`'s existing form; their `listeners` field type stays a plain custom bag (do **not** add `ComponentListeners` — they have no element). `AbstractStore`: no change. → verify: typecheck + their demos.

17. **Boilerplate sweep.** `grep -rn 'if (options?.listeners?.' src/typescript/lib` → expect zero matches (all 10 Component hosts plus the 3 refactored non-Component hosts converted). → verify.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Component.ts` (type, option field, two hooks, accessor, call in applyOptions) |
| Modify | `src/typescript/lib/core/index.ts` (export `ComponentListeners`) |
| Modify | `src/typescript/lib/component/tree/Tree.ts` |
| Modify | `src/typescript/lib/component/input/AbstractInput.ts` |
| Modify | `src/typescript/lib/component/input/SpinButton.ts` |
| Modify | `src/typescript/lib/component/container/WindowBorder.ts` |
| Modify | `src/typescript/lib/component/container/SplitGutter.ts` |
| Modify | `src/typescript/lib/component/container/CollapseButton.ts` |
| Modify | `src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `src/typescript/lib/component/table/cell/ResizeHandle.ts` |
| Modify | `src/typescript/lib/component/container/TabBar.ts` |
| Modify | `src/typescript/lib/core/Drawer.ts` |
| Modify | `src/typescript/lib/layout/Tab.ts` (collapse to generic loop) |
| Modify | `src/typescript/lib/layout/Accordion.ts` (collapse to generic loop) |
| Modify | `src/typescript/lib/core/ButtonGroup.ts` (collapse to generic loop) |
| Modify | `docs/recipes/component-options.md` (document the `listeners` bag) |

`AbstractStore.ts` is intentionally **not** modified.

---

## Verification

- **Typecheck:** `npx tsc --noEmit` (or project's typecheck script) — 0 errors. Pay attention to the variance check on each widened `listeners` field; an error there means the intersection isn't assignable to `ComponentListeners`.
- **Boilerplate gone:** `grep -rn 'if (options?.listeners?.' src/typescript/lib` → zero matches.
- **New base mechanism present:** `grep -rn 'applyListenerOptions\|applyCustomListeners' src/typescript/lib/core/Component.ts` → both defined.
- **DOM-listener smoke test (problem 3):** in the `ToolBarPanel` demo, construct a `ToolBar` (or any plain Component) with `{ listeners: { click: () => console.log("hit") } }`, click it, confirm the handler fires — no host code was added.
- **Custom-listener regression:** for `CollapseButton` / `SplitGutter` / `Scrollbar` / `TabBar`, confirm their existing demos still fire custom events (`collapse`, `scroll`, `tabpressed`) — registration order and payloads unchanged.
- **`"scroll"` routing:** confirm a `Scrollbar({ listeners: { scroll: fn } })` fires `fn` via `on`, not a stray DOM scroll listener.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

`ComponentOptions` and the new `ComponentListeners` type are public API (`core` barrel, [`core/index.ts`](../src/typescript/lib/core/index.ts#L14)).

- Export `ComponentListeners` from `core/index.ts`; verify it lands in `docs/api/core/` after build.
- Update [`docs/recipes/component-options.md`](../docs/recipes/component-options.md): add a short "Wiring event listeners" section showing both a DOM-event bag on a plain component and a custom-event bag on a host like `Drawer` / `SplitGutter`. This recipe already enumerates the options layering, so the `listeners` field belongs there.
- JSDoc on `ComponentOptions.listeners`, `applyListenerOptions`, and `applyCustomListeners` — same-bucket `{@link}` is fine (all in `core`). Reference `Event.addListener` as `[\`Event.addListener\`](/api/core/...)` only if cross-file linking is needed; same bucket, so `{@link Event.addListener}` suffices.

---

## Potential Challenges

- **Component ↔ Event import cycle.** `Event.ts` imports `Component`. Adding a value import of `Event` into `Component.ts` creates a runtime cycle. Mitigation: import `Event` lazily inside `applyListenerOptions` (dynamic access) or confirm the existing ESM graph already tolerates the cycle (TypeScript namespaces are resolved at call time, so a top-level `import { Event }` used only inside a method body is typically safe). Verify with a runtime smoke test, not just typecheck.
- **`this.on(event as any, fn)` in the base helper.** The base has no `on` method — only hosts with a `ListenerBag` do. `applyCustomListeners` is only ever called by hosts that define `on`, so the cast is sound, but the base must not call it itself. Keep `applyCustomListeners` host-invoked only (never called from `applyOptions`).
- **Typo'd custom keys are silent.** Per the unified-type tradeoff, a mistyped custom key routes to a never-firing DOM listener. Acceptable; flagged in Architecture Decisions.
- **`SpinButton.action`** is a `Button` event, not in the SpinButton bag — do not add it to `customListenerKeys`; leave Button's own wiring untouched.

---

## Critical Files

- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — constructor order, `applyOptions`, `applyChromeOptions` (the hook to mirror).
- [`src/typescript/lib/core/Event.ts`](../src/typescript/lib/core/Event.ts) — `addListener` semantics (id-keyed, element-free, append order).
- [`src/typescript/lib/core/ListenerBag.ts`](../src/typescript/lib/core/ListenerBag.ts) — `add` append order (matches `Event.addListener`).
- [`src/typescript/lib/data/AbstractStore.ts`](../src/typescript/lib/data/AbstractStore.ts#L106) — the existing generic key-iteration form the non-Component hosts converge on.
- [`src/typescript/lib/component/container/CollapseButton.ts`](../src/typescript/lib/component/container/CollapseButton.ts) — simplest single-custom-event host; the migration template.
- [`docs/recipes/component-options.md`](../docs/recipes/component-options.md) — the doc page to extend.

---

## Non-Goals

- **No `off`-from-options or listener removal API.** Construction-time wiring only, matching every existing host.
- **No `ListenerOptions` (passive) passthrough in the bag.** The current hosts don't expose it; adding it is out of scope.
- **No routing of DOM listeners on `Tab` / `Accordion` / `ButtonGroup` / `AbstractStore`.** They have no element; DOM keys on their bags stay unsupported.
- **No change to `AbstractStore`** — its `applyOptions` already has the target form.
