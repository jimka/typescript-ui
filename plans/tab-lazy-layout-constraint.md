# Lazy Tabs Through `addComponent` — Implementation Plan

## Overview

Today a lazy tab is registered by calling a method that only the `Tab` layout manager has: `Tab.addLazyTab(factory, name, constraints)` ([packages/lib/src/typescript/lib/layout/Tab.ts:1406](packages/lib/src/typescript/lib/layout/Tab.ts#L1406)). This plan moves registration onto the container path every other child already uses — `container.addComponent(componentOrFactory, constraints)` — with a new `lazy` layout constraint, and widens the factory so it may also be asynchronous.

Three things make that work. First, `Component.addComponent` learns to accept a **zero-argument factory** (`() => Component | Promise<Component>`) as well as a `Component` instance ([packages/lib/src/typescript/lib/core/Component.ts:4608](packages/lib/src/typescript/lib/core/Component.ts#L4608)). Deferring construction is the whole point: a factory is a child that has not been built yet. Second, `LayoutManager` gains one hook, `addDeferredComponent`, which lets a manager claim that unbuilt child instead of forcing it into existence. The base implementation declines, so every manager except `Tab` behaves as if the caller had written `addComponent(factory())`. `Tab` claims it and pushes exactly the same `ContentEntry` that `addLazyTab` pushes today. Third, `Animation.materialize` ([Animation.ts:413](packages/lib/src/typescript/lib/core/Animation.ts#L413)) learns to wait on a factory that returns a promise, so the spinner it already mounts also covers an asynchronous build.

The existing lazy machinery carries the async case: the `TabEntryState` state machine ([Tab.ts:207](packages/lib/src/typescript/lib/layout/Tab.ts#L207)) already mounts a spinner on entering `"building"`, and an async factory simply keeps the entry in `"building"` until its promise settles. `Tab.addLazyTab` and `TabPanel.addLazyTab` survive as thin aliases over the new path, so the demo app's `main.ts` keeps compiling unchanged.

`Dock` is the fourth thing to change, and the one an application sees. Its lazy path is typed synchronous today — `DockPanelSpec.content` is `Component | (() => Component)` ([Dock.ts:45](packages/lib/src/typescript/lib/overlay/Dock.ts#L45)) and `_lazyFactories` is `Map<string, () => Component>` ([Dock.ts:195](packages/lib/src/typescript/lib/overlay/Dock.ts#L195)) — so `Dock.addLazyPanel` ([Dock.ts:458](packages/lib/src/typescript/lib/overlay/Dock.ts#L458)) cannot carry an async factory at all. Both widen to `ComponentFactory`. And because the `Tab` that hosts a lazy panel's deferred content is a private local inside `resolvePanel` ([Dock.ts:548](packages/lib/src/typescript/lib/overlay/Dock.ts#L548)), the `"exception"` that `Tab` gains would fire where no consumer can hear it: `Dock` subscribes to that inner `Tab`, closes the whole docked panel, and re-emits the failure as its own typed `"exception"`.

---

## Architecture Decisions

### The factory-accepting widening lives on core `Component.addComponent`

`addComponent` accepts `Component | ComponentFactory`, and dispatches an unbuilt child to the layout manager through a new `LayoutManager.addDeferredComponent` hook.[^hook-shape] The base hook returns `false` and core then builds the factory immediately, so a factory is universally meaningful: *"a child I have not constructed yet; build it now unless the manager wants to defer it."*[^core-widening]

This mirrors [`DockPanelSpec.content`](packages/lib/src/typescript/lib/overlay/Dock.ts#L45), typed `Component | (() => Component)` and dispatched with `typeof spec.content === "function"` in [`addLazyPanel`](packages/lib/src/typescript/lib/overlay/Dock.ts#L461) — the codebase's existing answer to "a live component or a deferred one". The manager hook itself mirrors the existing `Component` → `LayoutManager` delegation pattern used by [`Component.setLayoutConstraints`](packages/lib/src/typescript/lib/core/Component.ts#L4819), which forwards a child-registration concern straight to the attached manager.

### A deferred factory may return a promise; only a deferring manager accepts one

`ComponentFactory` is `() => Component | Promise<Component>`. A promise-returning factory is meaningful **only** on the deferred path, because the deferred path is the one that has a spinner to show and an owner for the wait. When no manager claims the factory, `addComponent` runs it and throws an `Error` if the result is a promise.[^async-needs-owner]

| Call | Manager | Result |
| --- | --- | --- |
| `addComponent(() => new Panel())` | `HBox` | factory runs now; child added |
| `addComponent(async () => new Panel())` | `HBox` | throws `Error` — nothing can host the wait |
| `addComponent(() => new Panel(), { name: "A" })` | `Tab` | registered lazily; factory not run |
| `addComponent(async () => new Panel(), { name: "A" })` | `Tab` | registered lazily; factory not run |
| `addComponent(async () => new Panel(), { lazy: false })` | `Tab` | throws `Error` — `lazy: false` declines the deferral, so the eager path applies |

### The wait lives inside the existing `"building"` state

`Tab` does not gain a second mechanism for async. An entry still goes `"lazy"` → `"building"` → `"ready"`; `"building"` just lasts longer when the factory returns a promise. `Animation.materialize` keeps ownership of the whole yield-and-fade lifecycle, and gains the wait.

The order inside `materialize` is exact, and a synchronous factory keeps its current timing byte for byte:[^sync-path-untouched]

1. `host.addComponent(spinner)` and `host.scheduleLayout()` — synchronous, as today.
2. Two nested `requestAnimationFrame` callbacks — as today. The spinner reaches the screen here.
3. Inside the second frame, `factory()` runs — as today.
4. If the result is **not** a `Promise`, attach it immediately, still inside that frame. No microtask tick is introduced.
5. If the result **is** a `Promise`, call `result.then(attach, fail)`. The spinner stays mounted for the whole wait.

So the await comes strictly *after* the two-frame yield, never interleaved with it.

### A rejected factory closes the tab and emits `Tab`'s `"exception"` event

When an async factory rejects, `Tab` removes the spinner, tears the tab down through its own `closeEntry` path, and then emits a new typed `"exception"` event carrying the raw error and the tab's label. The library ships no error UI and no retry contract — presenting the failure is the app's job.[^exception-event]

This follows [`AbstractStore`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L30), whose async failures surface as a typed `'exception'` event carrying the raw thrown value ([AbstractStore.ts:50](packages/lib/src/typescript/lib/data/AbstractStore.ts#L50)) rather than as a rejected promise the caller must catch.

Two rules the implementer must not bend:

- **Teardown goes through `closeEntry`**, the same private path the user's ✕ click uses ([Tab.ts:1038](packages/lib/src/typescript/lib/layout/Tab.ts#L1038)). Never call `container.removeComponent(...)` on its own — that leaves the strip cell behind as a phantom tab.
- **The rejection is always handled.** `result.then(attach, fail)` supplies a rejection handler at the point the promise is observed, so a rejecting factory never reaches the runtime's unhandled-rejection channel.

Ordering: the tab is gone from the strip *before* the event fires, so a listener that inspects the strip sees the final state. A failed tab emits `"exception"` and **not** `"tabclose"` — `"tabclose"` carries the content component, and a failed entry never had one.

### A rejection observed after its entry is gone is dropped, not reported

`Animation.materialize` polls `isStale` on the failure path as well as the success path, and calls `onError` only when the entry is still live. **Stale means the entry is no longer in `Tab._contents`** — `closeEntry` spliced it out, because the user clicked ✕, because `closeTab` was called, or because the strip was torn down. A factory that rejects after that reports nothing and tears nothing down.[^stale-rejection]

| The factory settles… | Entry still in `_contents` | Result |
| --- | --- | --- |
| resolves | yes | component attached, fades in, `onReady` |
| resolves | no | component discarded, spinner dropped, no `onReady` |
| rejects | yes | spinner dropped, `onError` → tab closed, `"exception"` emitted |
| rejects | no | spinner dropped, nothing emitted, nothing torn down |

This is a contract, not an optimisation: the consuming SQLAdmin plan `lazy-tab-loading-sequence` deleted its own close-during-flight bookkeeping on the strength of the last row.

### `closeEntry` must also remove a live spinner

`closeEntry` today removes `entry.component` and nothing else. An entry in `"building"` has `component === null` and a mounted `entry.spinner`, so closing it leaves the spinner in the container as an unowned child — which the next layout pass turns into a phantom tab. `closeEntry` gains a matching `entry.spinner` removal.[^spinner-orphan]

### `Dock`'s lazy path carries the widened factory; its eager path rejects a promise

`DockPanelSpec.content` becomes `Component | ComponentFactory` and `Dock._lazyFactories` becomes `Map<string, ComponentFactory>`, so `addLazyPanel` accepts an async factory. `addPanel` does not: `resolvePanel`'s eager branch hands `spec.content` straight to `frame.addComponent`, whose `Fit` manager declines the deferral, so a promise there raises the same core `Error` as on an `HBox`.[^dock-eager-guard]

| Call | Result |
| --- | --- |
| `addPanel({ …, content: new Panel() })` | panel docked, as today |
| `addPanel({ …, content: () => new Panel() })` | factory runs now, panel docked, as today |
| `addPanel({ …, content: async () => new Panel() })` | throws `Error` — a `Fit` frame has no spinner and no owner for the wait |
| `addLazyPanel({ …, content: () => new Panel() })` | tab now, content on first activation |
| `addLazyPanel({ …, content: async () => new Panel() })` | tab now, spinner for the whole wait, content on resolve |

### `Dock` re-emits a failed lazy panel as its own typed `"exception"`

The `Tab` that hosts a lazy panel's content lives inside the identity frame and is a local variable in `resolvePanel`, so an application cannot subscribe to it. `Dock` subscribes for the application: on the inner `Tab`'s `"exception"` it closes the whole docked panel through `removePanel(id)` and then emits a Dock-level `"exception"` carrying `{ id, error }`.[^dock-exception-shape]

The event joins `Dock`'s existing surface exactly like `"emptychange"`: one `DockEvent` union member, one payload interface, an `on` / `off` / `emit` overload trio, and a `listeners.exception` key on `DockOptions`.

Two consequences the implementer must not lose:

- **`removePanel(id)` is the whole-panel teardown**, and it routes through `Tab.closeTab(frame)` on the *outer* region ([Dock.ts:1663](packages/lib/src/typescript/lib/overlay/Dock.ts#L1663)), which fires `"tabclose"` → `onPanelClosed`. That handler evicts `_frames`, `_panelHost` and `_frameRegion` for the id and emits `"close"`. So a failed panel emits `"close"` **before** `"exception"`.
- **`_panels` and `_lazyFactories` deliberately survive** the close ([Dock.ts:1431](packages/lib/src/typescript/lib/overlay/Dock.ts#L1431) documents that retention). That is what makes re-opening the same id a retry: `resolvePanel` finds no cached frame, rebuilds one, and runs the factory again. Do not add a `_panels` / `_lazyFactories` eviction to the failure path.

### An identity frame is never wired as a dock region

`Dock`'s re-wire sweep classifies any `Container` carrying a `Tab` or `Split` manager as a region ([Dock.ts:1396](packages/lib/src/typescript/lib/overlay/Dock.ts#L1396)) and recurses into it from `wireRegion`. A lazy panel's identity frame carries a `Tab`, so today the sweep wires the frame itself as a region. `wireRegion`'s recursion gains one guard: skip a child that is a registered identity frame (`this._frames.get(child.getId()) === child`).[^frame-not-region]

Without the guard the failure path breaks before `Dock` ever hears about it. `closeEntry` emits `"empty"` once the inner strip drains, the frame's own `"empty"` wiring calls `pruneRegion(frame)`, and that calls `parent.removeComponent(frame)` on the outer `Tab`-managed region — which leaves the strip cell behind as a phantom tab, and leaves `removePanel(id)` nothing to close.

### Which loading affordance applies

The library has exactly two, and the choice is decided by one question: **does the component already exist?**

| The component… | Use | Who drives it |
| --- | --- | --- |
| exists; its data is pending | [`ProgressSpinner.showOverlay(target)`](packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts#L195) / `hideOverlay()` | automatic for store-backed panels — `TablePanel` ([TablePanel.ts:77](packages/lib/src/typescript/lib/component/table/TablePanel.ts#L77)) and `TreeTablePanel` ([TreeTablePanel.ts:91](packages/lib/src/typescript/lib/component/table/TreeTablePanel.ts#L91)) wire it off the store's `loadingchange` event |
| does not exist yet | the deferred placeholder, reached through `addComponent(factory, { lazy })` | `Tab` mounts the spinner and swaps it for the built child |

A `Dock` consumer reaches the second row through `dock.addLazyPanel({ …, content: factory })`: the panel's identity frame carries its own strip-hidden `Tab`, so the spinner and the swap are the same machinery.

Worked examples, one per case:

```typescript
// Case 1 — the panel exists, its rows are loading. Nothing to write: TablePanel
// overlays its own Table whenever the store reports loading.
const panel = TablePanel(store);
store.load();

// Case 2 — the panel does not exist yet, and building it is expensive but sync.
container.addComponent(() => new AdvancedPanel(), { name: "Advanced" });

// Case 3 — the panel does not exist yet, and it cannot be built until a fetch
// completes. Same path as case 2; the factory is async.
container.addComponent(
    async () => {
        const columns = await getColumns(ref);

        return TablePanel(buildStore(ref, buildModel(columns), columns));
    },
    { name: ref.table, closeable: true },
);
```

Case 3 is what previously had no library answer: the content depends on fetched metadata, so there is no component to overlay at tab-creation time, and a sync-only factory could not express the wait. An app hitting that case had to hand-roll a third placeholder panel of its own. It does not any more.

### `createSpinnerWrap` stays private

The spinner-building helper ([Tab.ts:1429](packages/lib/src/typescript/lib/layout/Tab.ts#L1429)) is not promoted to a public affordance. The two cases above cover an app's needs completely, and each already owns its spinner: `ProgressSpinner.showOverlay` for a live component, `Tab` for one that does not exist yet.[^spinner-private]

### `lazy` is a `LayoutConstraints` field read only by `Tab`

`LayoutConstraints` gains `lazy?: boolean`. It joins `glyph`, `tooltip`, `closeable` and `transient` — fields declared on the shared constraint class and documented as read by one manager and ignored by the rest ([LayoutConstraints.ts:22–65](packages/lib/src/typescript/lib/layout/LayoutConstraints.ts#L22)).

`lazy` defaults to **true**. `Tab.addDeferredComponent` therefore defers unless the caller passed `lazy: false`.

### `lazy` on an already-constructed `Component` is a no-op

When the first argument is a `Component` instance, `addComponent` never enters the deferred branch, so `lazy` is never read. Construction already happened and cannot be undone; the child is added eagerly exactly as today.

### Deferred children always append

The deferred branch lives in `addComponent` only. `insertComponent` keeps its `component: Component` signature.[^append-only]

To keep tab order equal to call order when eager and lazy adds are interleaved, `Tab.addDeferredComponent` first mints tabs for any container children that no entry owns yet. That catch-up sweep already exists inside `doLayout` ([Tab.ts:1544–1559](packages/lib/src/typescript/lib/layout/Tab.ts#L1544)); it is extracted to a private `syncUntabbedChildren()` and called from both places.

| Call sequence on a `Tab`-managed container | Resulting tab order |
| --- | --- |
| `addComponent(a)` then `addComponent(() => b)` | `a`, `b` |
| `addComponent(() => b)` then `addComponent(a)` | `b`, `a` |
| `addComponent(a)`, `addComponent(() => b)`, `addComponent(c)` | `a`, `b`, `c` |

### A deferred tab's label comes from `constraints.name`, falling back to the tab id

A lazy entry has no component to ask for a name, so the label resolves as `constraints?.name ?? id`, where `id` is the minted `"tab-N"`. This parallels `createTab`, whose last-resort label is the component's generated id ([Tab.ts:1334](packages/lib/src/typescript/lib/layout/Tab.ts#L1334)). The same resolved label is what the `"exception"` event reports, read back with `TabBar.getEntryName(id)` ([TabBar.ts:1408](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1408)).

---

## Public API

```typescript
// packages/lib/src/typescript/lib/core/Component.ts

/**
 * A zero-argument function producing a child component on demand, either
 * immediately or once its promise resolves. An async factory is only accepted
 * by a layout manager that defers it (today: `Tab`).
 */
export type ComponentFactory = () => Component | Promise<Component>;

export interface ConstrainedComponent {
    component:    Component | ComponentFactory;
    constraints?: LayoutConstraints;
}

class Component<TOptions extends ComponentOptions = ComponentOptions> {
    addComponent(component: Component | ComponentFactory, constraints?: LayoutConstraints): this;

    addComponents(
        ...specs: Array<Component | ComponentFactory | ConstrainedComponent
                       | Array<Component | ComponentFactory | ConstrainedComponent>>
    ): this;
}

export interface ComponentOptions {
    components?: Array<Component | ComponentFactory | ConstrainedComponent>;
}
```

```typescript
// packages/lib/src/typescript/lib/layout/LayoutConstraints.ts

export class LayoutConstraints {
    /**
     * Whether a factory passed to `addComponent` is registered without being
     * run. Read by `Tab` only; defaults to `true` there. Ignored when the
     * child is an already-constructed component, and by every other manager.
     */
    lazy?: boolean;
}
```

```typescript
// packages/lib/src/typescript/lib/layout/LayoutManager.ts

export abstract class LayoutManager extends BaseObject {
    /**
     * Offers an unbuilt child to this manager. Returning `true` claims it —
     * the container adds nothing and the manager owns when the factory runs.
     * The base declines, so the container builds the child immediately.
     */
    addDeferredComponent(_factory: ComponentFactory, _constraints?: LayoutConstraints): boolean;
}
```

```typescript
// packages/lib/src/typescript/lib/core/Animation.ts

export interface MaterializeConfig {
    host:             Component;
    /** Sync or async; an async factory is awaited after the two-frame yield. */
    factory:          ComponentFactory;
    spinnerComponent: Component;
    fadeMs?:          number;
    onReady?:         (component: Component) => void;

    /**
     * Called when an async factory rejects, after the spinner has been removed.
     * Not called when `isStale` reports the caller has lost interest. The
     * caller owns everything else about the failure.
     */
    onError?:         (error: unknown) => void;

    /**
     * Polled once per settled factory — just before the built component is
     * attached, and just before a rejection is reported. Returning `true` means
     * the caller no longer wants the result: the spinner is removed, nothing is
     * attached, and neither `onReady` nor `onError` fires.
     */
    isStale?:         () => boolean;
}
```

```typescript
// packages/lib/src/typescript/lib/layout/Tab.ts

export type TabEvent = "tabclose" | "empty" | "detach" | "activate" | "dock" | "exception";

export interface TabOptions extends LayoutManagerOptions {
    listeners?: {
        tabclose?:  (component: Component) => void;
        empty?:     () => void;
        /** Fires after a deferred tab's async factory rejected and its tab was closed. */
        exception?: (error: unknown, label: string) => void;
    };
}

class Tab extends LayoutManager {
    override addDeferredComponent(factory: ComponentFactory, constraints?: LayoutConstraints): boolean;

    /** Thin alias over `addDeferredComponent`; unchanged signature and return type. */
    addLazyTab(factory: ComponentFactory, name: string, constraints?: LayoutConstraints): void;

    on(event: "exception", listener: (error: unknown, label: string) => void): this;
    protected emit(event: "exception", error: unknown, label: string): void;
}
```

```typescript
// packages/lib/src/typescript/lib/component/container/TabPanel.ts

export interface TabEntryConfig {
    label:      string;
    component:  Component | ComponentFactory;
    closeable?: boolean;
    glyph?:     string;
    /** Defer a factory until first activation. Defaults to `true`; ignored for an instance. */
    lazy?:      boolean;
}

class TabPanel<TOptions extends TabPanelOptions = TabPanelOptions> extends Container<TOptions> {
    addTab(
        component: Component | ComponentFactory,
        label: string,
        options?: { closeable?: boolean; glyph?: string; lazy?: boolean },
    ): this;

    /** Alias for `addTab` with a factory. */
    addLazyTab(
        factory: ComponentFactory,
        label: string,
        options?: { closeable?: boolean; glyph?: string },
    ): this;
}
```

`TabPanel` gains no event surface of its own — an `"exception"` listener is wired through `panel.getTab().on("exception", …)`, the same way every other `Tab` event is reached from a `TabPanel`.

```typescript
// packages/lib/src/typescript/lib/overlay/Dock.ts

export interface DockPanelSpec {
    /**
     * The content: a live component, or a factory built on first resolve. A
     * factory that returns a promise is accepted only by `addLazyPanel`, which
     * shows a spinner for the wait; `addPanel` throws on one.
     */
    content: Component | ComponentFactory;
}

export type DockEvent = "attach" | "detach" | "move" | "focus" | "close" | "emptychange" | "exception";

/**
 * Payload for a {@link Dock} `"exception"` event: a lazy panel's content
 * factory rejected. The panel has already been closed and its `"close"` event
 * already emitted by the time this fires.
 */
export interface DockExceptionEvent {
    /** The stable id of the panel that failed (its {@link DockPanelSpec.id}). */
    id:    string;
    /** The value the content factory's promise rejected with. */
    error: unknown;
}

export interface DockOptions extends ContainerOptions {
    listeners?: {
        exception?: (event: DockExceptionEvent) => void;
    };
}

class Dock extends Container<DockOptions> {
    on(event: "exception", listener: (event: DockExceptionEvent) => void): this;
    off(event: "exception", listener: (event: DockExceptionEvent) => void): this;
    protected emit(event: "exception", payload: DockExceptionEvent): void;
}
```

`Dock.addPanel` and `Dock.addLazyPanel` keep their `(spec: DockPanelSpec): this` signatures; only the `content` field they read widens.

---

## Internal Structure

`Component.addComponent` — the whole core change:

```typescript
addComponent(component: Component | ComponentFactory, constraints?: LayoutConstraints): this {
    if (typeof component === "function") {
        const manager = this.getLayoutManager();

        // A manager that claims the factory owns when (and whether) it runs.
        if (manager && manager.addDeferredComponent(component, constraints)) {
            return this;
        }

        const built = component();

        if (built instanceof Promise) {
            throw new Error("Component.addComponent: an async factory needs a layout manager that defers it — "
                          + "add it to a Tab-managed container and leave `lazy` at its default.");
        }

        component = built;
    }

    return this.insertComponent(component, this._components.length, constraints);
}
```

`Animation.materialize` — the yield is unchanged; the attach and the failure path are factored out so the sync and async branches share them:

```typescript
export function materialize(config: MaterializeConfig): void {
    const host    = config.host;
    const factory = config.factory;
    const spinner = config.spinnerComponent;
    const fadeMs  = config.fadeMs ?? MATERIALIZE_FADE_DURATION_MS;

    const dropSpinner = (): void => {
        host.removeComponent(spinner);
        host.scheduleLayout();
    };

    const attach = (component: Component): void => {
        // The caller lost interest during the yield or the await (e.g. its tab
        // was closed): drop the spinner and discard the built component.
        if (config.isStale?.()) {
            dropSpinner();

            return;
        }

        host.addComponent(component);

        const el = component.getElement(true)!;
        host.scheduleLayout();

        play(el, {
            from:       { opacity: "0" },
            to:         { opacity: "1" },
            durationMs: fadeMs,
            properties: ["opacity"],
            onComplete: () => {
                dropSpinner();
                config.onReady?.(component);
            },
        });
    };

    const fail = (error: unknown): void => {
        dropSpinner();

        // The caller lost interest during the await (its tab was closed): there
        // is nothing left to tear down and nobody left to report to.
        if (config.isStale?.()) {
            return;
        }

        config.onError?.(error);
    };

    host.addComponent(spinner);
    host.scheduleLayout();

    DOM.sink.requestAnimationFrame(() => {
        DOM.sink.requestAnimationFrame(() => {
            const result = factory();

            // Only a thenable takes the async branch, so a synchronous factory
            // still attaches inside this same frame with no microtask tick.
            if (result instanceof Promise) {
                result.then(attach, fail);
            } else {
                attach(result);
            }
        });
    });
}
```

`Tab.addDeferredComponent` — registration only; no container child is created, which is what keeps the entry-ownership set in `doLayout` from minting a phantom tab:

```typescript
override addDeferredComponent(factory: ComponentFactory, constraints?: LayoutConstraints): boolean {
    // `lazy` defaults to true: only an explicit false declines the deferral.
    if (constraints?.lazy === false) {
        return false;
    }

    // Give any container child added before this call its tab first, so tab
    // order tracks call order across interleaved eager and lazy adds.
    this.syncUntabbedChildren();

    const id = this.mintId();

    this._bar.createBarEntry(id, constraints?.name ?? id, constraints);
    this._contents.push({
        id,
        component: null,
        factory,
        spinner:   null,
        state:     "lazy",
    });

    this.getContainer()?.scheduleLayout();

    return true;
}
```

`Tab.materializeAsync` — only the `Animation.materialize` config changes. The entry-capture wrapper gains an async branch so `entry.component` is still set before `Animation` attaches the child:

```typescript
Animation.materialize({
    host:             container,
    factory:          () => {
        const result = factory();

        // Capture the built component on the entry the instant it exists —
        // before `Animation.materialize` attaches it to the container and
        // schedules the layout that would otherwise see an entry-unowned
        // child and mint a phantom UUID tab for it. `onReady` re-asserts it.
        if (result instanceof Promise) {
            return result.then((component) => {
                entry.component = component;

                return component;
            });
        }

        entry.component = result;

        return result;
    },
    spinnerComponent: spinner,
    isStale:          () => !this._contents.includes(entry),
    onError:          (error) => this.failEntry(entry, error),
    onReady:          (component) => {
        entry.component = component;
        entry.factory   = null;
        entry.spinner   = null;
        entry.state     = "ready";

        this.wireComponentAria(entry.id, component);
        container.scheduleLayout();
    }
});
```

`Tab.failEntry` — the rejection path, closing through the shared teardown:

```typescript
/**
 * Tears down a deferred tab whose factory rejected, then reports the failure.
 * The spinner has already been removed by the materialize helper, so the
 * entry's reference is cleared first to keep the shared close path from
 * removing it a second time.
 *
 * @param entry - The failed content entry.
 * @param error - The value the factory's promise rejected with.
 */
private failEntry(entry: ContentEntry, error: unknown): void {
    const label = this._bar.getEntryName(entry.id);

    entry.spinner = null;
    entry.factory = null;

    this.closeEntry(entry.id);
    this.emit("exception", error, label);
}
```

`Tab.closeEntry` — one added removal, alongside the existing content removal:

```typescript
const wasSelected = this._selectedTabIndex === idx;
const content = this._contents[idx].component;
const spinner = this._contents[idx].spinner;

this._bar.removeBarEntry(id);
this._contents.splice(idx, 1);

if (content) {
    container.removeComponent(content);
}

// An entry closed mid-build still owns a mounted spinner; leaving it in the
// container makes it an entry-unowned child, and the next layout pass mints a
// phantom tab for it.
if (spinner) {
    container.removeComponent(spinner);
}
```

`syncUntabbedChildren` is the block lifted verbatim out of `doLayout` ([Tab.ts:1544–1559](packages/lib/src/typescript/lib/layout/Tab.ts#L1544)), with `doLayout` calling it in place of the inline loop:

```typescript
private syncUntabbedChildren(): void {
    const container = this.getContainer();
    if (!container) {
        return;
    }

    const owned = new Set<Component>();

    for (const entry of this._contents) {
        if (entry.component) {
            owned.add(entry.component);
        }

        if (entry.spinner) {
            owned.add(entry.spinner);
        }
    }

    for (const component of container.getComponents()) {
        if (!owned.has(component)) {
            this.createTab(component);
        }
    }
}
```

`Tab.addLazyTab` becomes an alias. It copies the caller's constraints onto a fresh object so writing `name` never mutates the caller's instance:

```typescript
addLazyTab(factory: ComponentFactory, name: string, constraints?: LayoutConstraints): void {
    this.addDeferredComponent(factory, Object.assign(new LayoutConstraints(), constraints, { name }));
}
```

`Dock.resolvePanel` — both branches change. The lazy branch subscribes to the frame `Tab`; the eager branch drops its hand-written `typeof` dispatch and lets core apply the promise guard:

```typescript
if (factory) {
    const tab = new Tab();

    tab.setBarVisible(false);
    frame = new Container({ id: spec.id, name: spec.title, layoutManager: tab });

    // Named reference, not an inline arrow: the frame's Tab is a local, so the
    // panel id has to be captured per frame (same shape as wireRegion's onEmpty).
    const onFailed: (error: unknown) => void = (error: unknown): void => {
        this.failPanel(spec.id, error);
    };

    tab.on("exception", onFailed);
    tab.addLazyTab(factory, spec.title ?? spec.id);
} else {
    frame = new Container({ id: spec.id, name: spec.title, layoutManager: new Fit() });

    // A live component or a synchronous factory. A promise-returning factory
    // raises Component.addComponent's Error here: a Fit frame has no spinner.
    frame.addComponent(spec.content);
}
```

`Dock.failPanel` — the whole-panel teardown and the re-emit:

```typescript
/**
 * Closes a lazy panel whose content factory rejected, then reports the failure
 * as this dock's `"exception"`. The panel's own `"close"` event fires first,
 * from the shared close path. The panel stays registered, so re-adding the same
 * id rebuilds its frame and runs the factory again.
 *
 * @param id - The id of the panel whose factory rejected.
 * @param error - The value the factory's promise rejected with.
 */
private failPanel(id: string, error: unknown): void {
    // A frame that is registered but sits in no Tab region cannot be closed
    // through the shared path; evict it directly so a re-add rebuilds it.
    if (!this.removePanel(id)) {
        this._frames.delete(id);
    }

    this.emit("exception", { id, error });
}
```

`Dock.wireRegion` — one guard on the recursion, so an identity frame is never treated as a region:

```typescript
for (const child of region.getComponents()) {
    // An identity frame carries a Tab manager when its panel is lazy, which
    // would otherwise make the sweep wire the panel itself as a drop-taking,
    // prunable region.
    if (this.isRegionContainer(child) && this._frames.get(child.getId()) !== child) {
        this.wireRegion(child);
    }
}
```

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/core/Component.ts`** — add and export `type ComponentFactory = () => Component | Promise<Component>;` beside `ConstrainedComponent` (around line 64), with the JSDoc from `## Public API` and `@category Core`.

2. **`packages/lib/src/typescript/lib/core/index.ts`** — add `ComponentFactory` to the `export type { … } from '~/core/Component.js'` list on line 18.

3. **`packages/lib/src/typescript/lib/layout/LayoutConstraints.ts`** — add the optional `lazy?: boolean` field with the JSDoc from `## Public API`. Do not give it an initializer (the other behaviour flags such as `closeable` and `transient` have none).

4. **`packages/lib/src/typescript/lib/layout/LayoutManager.ts`** — add the non-abstract `addDeferredComponent(_factory, _constraints)` returning `false`, with the JSDoc from `## Public API`. Import `ComponentFactory` as a type-only import from `~/core/Component.js` (the module already imports `Component` from there).

5. **`packages/lib/src/typescript/lib/core/Component.ts`** — widen `addComponent` and add the deferred branch exactly as in `## Internal Structure`, including the promise guard and its `Error`. Update its JSDoc to describe all accepted forms and to state that an async factory needs a deferring manager. Leave `insertComponent` untouched.
   - Check: `grep -n "insertComponent(component: Component," packages/lib/src/typescript/lib/core/Component.ts` — still exactly one match, unchanged.

6. **`packages/lib/src/typescript/lib/core/Component.ts`** — widen `ConstrainedComponent.component`, `ComponentOptions.components`, and the `addComponents` spec type per `## Public API`. In the `addComponents` loop, change the branch to `if (item instanceof Component || typeof item === "function")` so a bare factory is not mistaken for a `ConstrainedComponent`.

7. **`packages/lib/src/typescript/lib/core/Animation.ts`** — rewrite `materialize` exactly as in `## Internal Structure`: extract `dropSpinner` / `attach` / `fail`, add the `instanceof Promise` branch, and add the `onError` and `isStale` config fields with the JSDoc from `## Public API`. Widen `MaterializeConfig.factory` to `ComponentFactory` (type-only import from `~/core/Component.js`). Do not change the two-rAF structure and do not turn `materialize` into an `async` function.
   - Check: `npm run test -w packages/lib -- tests/overlay` still passes — `AbstractWindow.show` ([AbstractWindow.ts:642](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L642)) is the other caller and passes a synchronous factory; it needs no edit.

8. **`packages/lib/src/typescript/lib/layout/Tab.ts`** — extract the ownership catch-up loop out of `doLayout` into the private `syncUntabbedChildren()` shown above, and call it from `doLayout` where the loop was. Behaviour is unchanged at this step.
   - Check: `npm run test -w packages/lib -- tests/component/layout` still passes.

9. **`packages/lib/src/typescript/lib/layout/Tab.ts`** — add `"exception"` to the `TabEvent` union (line 42), add the `on` overload and the `emit` overload from `## Public API`, and add the `exception` key to the `TabOptions.listeners` bag (line 125). No `applyOptions` change is needed — the bag is dispatched by a key loop over its own keys.

10. **`packages/lib/src/typescript/lib/layout/Tab.ts`** — add the spinner removal to `closeEntry` as shown, and change `ContentEntry.factory` to `ComponentFactory | null`.

11. **`packages/lib/src/typescript/lib/layout/Tab.ts`** — add the private `failEntry(entry, error)` method shown above, placed directly below `materializeAsync`.

12. **`packages/lib/src/typescript/lib/layout/Tab.ts`** — update `materializeAsync`'s `Animation.materialize` config as shown: async-aware factory wrapper, `isStale`, `onError`. Extend its JSDoc to say the entry stays in `"building"` until an async factory settles, and that a rejection closes the tab and emits `"exception"`.

13. **`packages/lib/src/typescript/lib/layout/Tab.ts`** — add `addDeferredComponent` as shown, placed directly above `addLazyTab`. Give it JSDoc covering the `lazy` default, the label fallback, that a factory may be async, and that no container child exists until materialization.

14. **`packages/lib/src/typescript/lib/layout/Tab.ts`** — rewrite `addLazyTab`'s body as the alias shown, widening its `factory` parameter to `ComponentFactory`. Keep its `void` return. Trim its JSDoc to name the new primary path (`container.addComponent(factory, { name })`) and keep the materialization remarks; delete the "Mixing direct `container.addComponent` calls with lazy entries is supported" paragraph, whose caveat `syncUntabbedChildren` now removes.
    - Check: `grep -n "_bar.createBarEntry" packages/lib/src/typescript/lib/layout/Tab.ts` — exactly two matches, in `createTab` and in `addDeferredComponent`.

15. **`packages/lib/src/typescript/lib/component/container/TabPanel.ts`** — widen `TabEntryConfig` (`component`, new `lazy`), widen `addTab` to accept `Component | ComponentFactory` plus a `lazy` option, and forward `lazy` into the `LayoutConstraints` it builds. Reduce `addLazyTab` to `return this.addTab(factory, label, options);`. Update the constructor's `tabs` loop (line 94) to pass `entry.lazy` through.

16. **`packages/lib/src/typescript/lib/component/container/TabPanel.ts`** — update the class JSDoc so the summary names the factory-accepting `addTab` (the summary feeds `llms.txt`; see `## Documentation Impact`).

17. **`packages/lib/src/typescript/lib/overlay/Dock.ts`** — widen `DockPanelSpec.content` to `Component | ComponentFactory` and `_lazyFactories` to `Map<string, ComponentFactory>`, adding a type-only `ComponentFactory` import from `~/core/Component.js` (the module already imports `Component` from there). Update the JSDoc per `## Public API`: `addLazyPanel` states that a factory may be async and that the spinner covers the whole wait; `addPanel` states that an async factory throws.

18. **`packages/lib/src/typescript/lib/overlay/Dock.ts`** — rewrite both `resolvePanel` branches exactly as in `## Internal Structure`: the lazy branch wires `onFailed` before `addLazyTab`, and the eager branch replaces its `typeof spec.content === "function" ? spec.content() : spec.content` dispatch with a single `frame.addComponent(spec.content)`.
    - Check: `grep -n 'typeof spec.content' packages/lib/src/typescript/lib/overlay/Dock.ts` — exactly one match, the `addLazyPanel` wrap.

19. **`packages/lib/src/typescript/lib/overlay/Dock.ts`** — add `"exception"` to the `DockEvent` union (line 120) and describe it in that union's JSDoc alongside the `"emptychange"` paragraph, add the `DockExceptionEvent` interface beside `DockEmptyEvent` (line 150) with `@category Core`, add the `exception` key to the `DockOptions.listeners` bag (line 82), and add the `on` / `off` / `emit` overloads from `## Public API` beside the `"emptychange"` ones (lines 1857, 1891, 1907), widening the `emit` implementation signature's payload union to `DockPanelEvent | DockEmptyEvent | DockExceptionEvent | null`. No `applyOptions` change is needed — the bag is dispatched by `applyListeners`' key loop.

20. **`packages/lib/src/typescript/lib/overlay/Dock.ts`** — add the private `failPanel(id, error)` from `## Internal Structure`, placed beside `onPanelClosed` in the `// ----- panel lifecycle -----` block.

21. **`packages/lib/src/typescript/lib/overlay/Dock.ts`** — add the identity-frame guard to `wireRegion`'s recursion as shown. Leave `collectTabRegions` and `firstTabRegion` alone: both are used to find a `Tab` region that *hosts* an identity frame, and a frame never hosts another frame, so walking into one finds nothing either way.
    - Check: `npm run test -w packages/lib -- tests/overlay/Dock.lifecycle.test.ts` still passes.

22. **`packages/lib/src/typescript/lib/overlay/index.ts`** — add `DockExceptionEvent` to the `export type { … } from '~/overlay/Dock.js'` list on line 27.

23. **`packages/lib/tests/core/DeferredChild.test.ts`** (new) — cover the core seam per `## Expected Behaviour` cases 1, 6, 7, 8, 9, 10.

24. **`packages/lib/tests/component/layout/Tab.lazy.test.ts`** (new) — cover cases 2, 3, 4, 5, 11, 12, 13, 14, 15.

25. **`packages/lib/tests/component/container/TabPanel.test.ts`** — add cases 16 and 17 to the existing `TabPanel wiring` describe block.

26. **`packages/lib/tests/overlay/Dock.lifecycle.test.ts`** — add cases 18 and 19 in a new `describe` block, reusing the file's existing dock harness and its `rafQueue` / `flush()` pair. Both cases assert *before* any flush, so neither drives a factory.

27. **`packages/lib/src/typescript/TabDemoPanel.ts`** — add the demo exercise described in `## Verification`, covering the sync, async-resolving, and async-rejecting factories.

28. **`packages/lib/src/typescript/MiscPanel.ts`** — add the two lazy-panel buttons, their two helpers, and the `"exception"` log line described in `## Verification` to the existing **Dockable layout (Dock)** demo (line 955).

29. **Docs** — apply `## Documentation Impact`, then run `npm run docs:build` from the repo root and confirm zero TypeDoc warnings.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/index.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Animation.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/LayoutConstraints.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/LayoutManager.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Tab.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabPanel.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dock.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/index.ts` |
| Modify | `packages/lib/src/typescript/TabDemoPanel.ts` |
| Modify | `packages/lib/src/typescript/MiscPanel.ts` |
| Create | `packages/lib/tests/core/DeferredChild.test.ts` |
| Create | `packages/lib/tests/component/layout/Tab.lazy.test.ts` |
| Modify | `packages/lib/tests/component/container/TabPanel.test.ts` |
| Modify | `packages/lib/tests/overlay/Dock.lifecycle.test.ts` |
| Modify | `packages/lib/docs/layouts/Tab.md` |
| Modify | `packages/lib/docs/components/Dock.md` |
| Modify | `packages/lib/docs/layouts/Constraints.md` |
| Modify | `packages/lib/docs/components/TabPanel.md` |
| Modify | `packages/lib/docs/components/ProgressSpinner.md` |
| Modify | `packages/lib/docs/concepts/layout-system.md` |
| Modify | `packages/lib/llms.txt` (regenerated, not hand-edited) |

---

## Expected Behaviour

Cases 1–19 are unit-testable offline. Cases 20–28 need manual verification in a browser.[^raf-testing]

**Core dispatch**

1. `container.addComponent(() => new Component())` on a container whose manager is an `HBox` runs the factory immediately; the built child is in `container.getComponents()` and carries the constraints that were passed.
2. `container.addComponent(() => new Component(), c)` on a `Tab`-managed container, where `c.name = "Heavy"`, does **not** run the factory and adds **no** child: `container.getComponents()` stays empty.
3. The same call registers one tab: `tab.setActiveTabIndex(99); tab.getActiveTabIndex()` is `0`, and `tab.getActiveTabLabel()` is `"Heavy"`.
4. With no `name` on the constraints, the label falls back to the minted tab id (`"tab-0"` for the first registration on a fresh `Tab`).
5. `addComponent(factory, { lazy: false, name: "Eager" })` on a `Tab`-managed container runs the factory immediately and puts the built child in `container.getComponents()`.
6. `addComponent(instance, { lazy: true })` adds `instance` normally — it is in `container.getComponents()` right away. `lazy` changes nothing.
7. `addComponents(factoryA, { component: factoryB, constraints: c })` on an `HBox`-managed container builds both and adds two children, in that order.
8. `new Container({ layoutManager: new HBox(), components: [factory] })` builds the factory and ends up with one child.

**Async factories on the eager path**

9. `addComponent(async () => new Component())` on an `HBox`-managed container throws an `Error` whose message names `addComponent`. No child is added.
10. `addComponent(async () => new Component(), { lazy: false })` on a `Tab`-managed container throws the same `Error` — `lazy: false` declines the deferral, so the eager path applies.

**Tab registration**

11. Registering a lazy tab and then laying the container out mints exactly one tab, not two: no phantom id-labelled tab appears alongside it (probe with the `setActiveTabIndex(99)` + `getActiveTabIndex()` count idiom).
12. Tab order follows call order across interleaved adds — assert the three rows of the table in `## Architecture Decisions` by activating each index and reading `getActiveTabLabel()`.
13. `tab.addLazyTab(() => new Component(), "Legacy")` still registers one lazy tab with the label `"Legacy"` and still does not run the factory.
14. An **async** factory registers identically: `addComponent(async () => new Component(), c)` adds no child, mints one tab, and does not run the factory.
15. Activating a lazy tab mounts the spinner without building the content: after `tab.setActiveTabIndex(i)` the container holds exactly one child (the spinner) and the factory has still not run. This holds identically for a sync and an async factory, because the spinner mount precedes the two-frame yield.

**TabPanel**

16. `panel.addTab(() => new Component(), "Lazy")` is chainable, does not run the factory, and leaves `panel.getComponents()` empty.
17. `new TabPanel({ tabs: [{ label: "L", component: factory }] })` does not run the factory; `new TabPanel({ tabs: [{ label: "E", component: factory, lazy: false }] })` does, and lands one child.

**Dock**

18. `dock.addPanel({ id: "p", title: "P", content: async () => new Component() })` throws an `Error` whose message names `addComponent`, and no `"attach"` is emitted for `"p"`.
19. `dock.addLazyPanel({ id: "p", title: "P", content: async () => new Component() })` docks the panel without running the factory: `dock.focusPanel("p")` is `true` while the factory has still not been called (assert before the harness flushes its queued animation frames).

**Manual (needs a real browser)**

20. Activating a lazy tab with a **sync** factory shows the centred spinner and then fades the built panel in over it; the factory runs exactly once, so returning to that tab later is instant and shows no second spinner.
21. Activating a lazy tab with an **async** factory that resolves after ~1.2 s keeps the spinner up for the whole wait, then fades the resolved panel in. The tab stays selected throughout and the rest of the UI stays responsive.
22. Activating a lazy tab whose async factory **rejects** removes the spinner, closes that tab, moves the selection to a neighbouring tab, and fires `Tab`'s `"exception"` event with the rejection value and the tab's label. The browser console shows **no** unhandled promise rejection.
23. **Race — the tab is closed while its factory is still in flight.** Activate an async lazy tab, then click its ✕ before the promise settles: the spinner disappears immediately with the tab, the strip has one fewer tab, and when the promise later resolves nothing is added — no extra tab, no stray panel, and no phantom tab after a window resize forces a fresh layout pass.
24. The demo's existing eager tabs, tear-off, re-dock, and close behaviour are unaffected by a lazy sibling in the same strip.
25. The whole demo app still boots — `main.ts` registers every top-level section through `addLazyTab`, so a regression there is immediately visible as a blank or mislabelled section strip.

**Manual — `Dock` (the Dockable layout demo)**

26. **An async docked panel resolves.** Opening the demo's async panel shows its tab in the dock strip at once, with the title, glyph and tooltip already correct, and a centred spinner in the panel body; when the promise resolves the content fades in, in the same tab, at the same strip position, still selected.
27. **An async docked panel rejects.** The spinner goes, the whole docked panel closes — its tab leaves the strip, and a region left with no tabs collapses as it does for a user close — and the console log shows `close` for that id followed by `exception` with the same id and the rejection value. No empty tab and no spinner survive, and there is **no** unhandled promise rejection. Pressing **"Add failing panel"** again re-adds the same id and starts a fresh load, so a failure is retryable.
28. **A docked panel is closed while its factory is in flight.** Click the async panel's ✕ while its spinner shows: the tab and spinner go immediately, and when the promise later settles nothing happens — no content appears for a resolve, and no `exception` line is logged for a reject. Dragging a region divider afterwards forces a layout pass that produces no phantom tab.

---

## Verification

- `npm run typecheck` and `npm run typecheck:test -w packages/lib` — both clean. The typecheck is the load-bearing check for step 6: a missed `typeof item === "function"` branch surfaces as a type error on `item.component`.
- `npm run test` — the two new test files pass, and the existing `Tab.test.ts`, `Tab.lifecycle.test.ts`, `Tab.dockraise.test.ts`, `TabPanel.test.ts`, `LayoutSerialization.test.ts`, `Dock.lifecycle.test.ts`, and the `tests/overlay` window tests are unchanged (beyond the two added `Dock` cases) and still pass. `Dock.lifecycle.test.ts` is the load-bearing check that the `wireRegion` frame guard did not disturb tear-off, re-dock, focus, or prune.
- `npm run lint -w packages/lib` — clean.
- `grep -rn "addLazyTab" packages/lib/src/typescript/` — `Dock.ts`, `main.ts`, `Tab.ts`, `TabPanel.ts` only; no call site needed editing.
- `grep -n 'typeof spec.content' packages/lib/src/typescript/lib/overlay/Dock.ts` — exactly one match (the `addLazyPanel` wrap); `resolvePanel`'s copy is gone.
- `npm run docs:build` — finishes with zero TypeDoc warnings, and `git diff packages/lib/llms.txt` shows only the regenerated summary line.
- **Demo, manual.** `npm run dev`, open `http://localhost:8015`, go to the **Tab** section (`TabDemoPanel`). The changes to add there:
  - One entry in the panel's initial `tabs:` array registered as a **sync** factory — `{ label: "Lazy", component: () => this.buildSlowContent("Lazy") }` — so the options-bag path is exercised.
  - A second entry registered as an **async** factory — `{ label: "Async", component: () => this.buildAsyncContent("Async") }`.
  - An **"Add Lazy Tab"** button beside the existing "Add Tab" / "Add Closeable Tab" buttons, whose handler calls `this.tabPanel.addComponent(() => this.buildSlowContent(label), Object.assign(new LayoutConstraints(), { name: label, closeable: true }))` — the raw container path, not the `addLazyTab` helper.
  - An **"Add Failing Tab"** button whose handler registers `() => this.buildFailingContent(label)` the same way, with `closeable: true`.
  - Three private helpers: `buildSlowContent(title)` busy-waits ~400 ms (`const end = Date.now() + 400; while (Date.now() < end) {}`) before returning `this.buildContent(title)`; `buildAsyncContent(title)` returns a promise that resolves to `this.buildContent(title)` after ~1200 ms; `buildFailingContent(title)` returns a promise that rejects with `new Error(\`${title}: metadata fetch failed\`)` after ~800 ms.
  - Relabel the existing log row's leading `Text` from `"Last closed:"` to `"Last event:"`, and wire `this.tabPanel.getTab().on("exception", …)` to write `Failed: ${label} — ${String(error)}` into `this.logText`.
  - Confirm cases 20–24 above, in that order, then click through the app's other top-level sections for case 25.
- **Demo, manual — the dock.** Same dev server, go to the **Misc** section and press **Dockable layout (Dock)**. The changes to add to that demo (`MiscPanel.ts` line 955):
  - Two toolbar buttons beside the existing Save / Restore pair, each calling `dock.addLazyPanel` — not the `layout` spec, which compiles through the eager `addPanel`. **"Add async panel"** mints a fresh id each press (`async-1`, `async-2`, …) and registers `{ id, title: "Async", glyph: "hourglass", tooltip: "Resolves after a wait", content: () => dockAsyncPanel("Async — resolved after a wait.") }`, so case 26 can check the title, glyph and tooltip while the spinner shows. **"Add failing panel"** reuses the fixed id `"failing"` and registers `{ id: "failing", title: "Failing", glyph: "exclamation-triangle", content: () => dockFailingPanel("Failing") }`, so pressing it again after a failure re-adds the same id and exercises the retry.
  - Two helpers beside the existing `dockPanel(text)`: `dockAsyncPanel(text)` returns a promise resolving to the same `Fit` host after ~1200 ms; `dockFailingPanel(title)` returns a promise rejecting with `new Error(\`${title}: content fetch failed\`)` after ~800 ms.
  - One more log line beside the existing five: `dock.on("exception", e => console.log(\`[Dock] exception: ${e.id} — ${String(e.error)}\`));`.
  - Confirm cases 26–28 above, in that order, watching the console for the `close` → `exception` ordering.

---

## Documentation Impact

`ComponentFactory` is exported from `~/core/Component.js` and must be added to the `export type { … }` list in `packages/lib/src/typescript/lib/core/index.ts`, which is what puts it on the `@jimka/typescript-ui/core` entry point and therefore into the TypeDoc output. `DockExceptionEvent` joins the matching list in `packages/lib/src/typescript/lib/overlay/index.ts` line 27, beside `DockPanelEvent` and `DockEmptyEvent`. `MaterializeConfig` is already public, so its two new fields render automatically from their JSDoc.

Per the repo's JSDoc rule, the new public JSDoc must not `{@link}` any private symbol — describe the materialize-and-fail mechanics in prose rather than naming `materializeAsync`, `createSpinnerWrap`, `failEntry`, or `closeEntry`.

Pages to edit:

- **`packages/lib/docs/layouts/Tab.md`** — rewrite the *Lazy panel construction* section (lines 66–91) so `container.addComponent(factory, { name })` is the documented path and `addLazyTab` is named as the alias. **Delete the `::: warning Don't mix addLazyTab and addComponent :::` block at lines 89–91** — `syncUntabbedChildren` makes mixing correct, so the warning is now wrong. Keep the asynchronous-materialization paragraph. Document the `constraints.name ?? tab id` label fallback. Add a short *Async factories* subsection showing the `async () => { … await … }` form, stating that the spinner covers the whole wait and that a rejection closes the tab and emits `"exception"`, with a `tab.on("exception", (error, label) => …)` snippet. Link to `/components/ProgressSpinner#which-loading-affordance`.
- **`packages/lib/docs/components/ProgressSpinner.md`** — add a *Which loading affordance* section carrying the two-row table and the three worked examples from `## Architecture Decisions`, linking to `/layouts/Tab` for the deferred case. Place it after the existing *Loading overlays on `TablePanel`* section.
- **`packages/lib/docs/components/Dock.md`** — update the *Declaring the initial layout* lead (line 11) so `content` reads "a live component or a factory, which `addLazyPanel` may return a promise from". Add an *Async panel content* subsection under *Programmatic control* (line 131) showing `dock.addLazyPanel({ id, title, content: async () => buildPanel(await fetchMeta()) })`, stating that the tab appears at once with a spinner, that `addPanel` throws on an async factory, and that a rejection closes the panel and emits `"exception"`. In *Panel lifecycle*, leave the five-event `DockPanelEvent` table alone and add `exception` after the `emptychange` block (line 126) as its own short subsection: it fires when a lazy panel's content factory rejected, carries a [`DockExceptionEvent`](/api/overlay/interfaces/DockExceptionEvent) (`{ id, error }`) rather than a `DockPanelEvent`, follows that panel's own `close`, and leaves the panel registered so re-adding the id retries. Include a `dock.on('exception', …)` snippet. Link to `/layouts/Tab` for the underlying deferred-tab machinery.
- **`packages/lib/docs/layouts/Constraints.md`** — add a `lazy` row to the *Plus optional metadata* table (lines 20–23): "`lazy` | Defers a factory passed to `addComponent` until first activation; consumed by [`Tab`](/layouts/Tab), defaults to `true` there."
- **`packages/lib/docs/components/TabPanel.md`** — update line 31 (`Both addTab and addLazyTab accept { closeable?, glyph? }`) to include `lazy?`, and rewrite the *Lazy tabs* section (lines 33–41) to lead with `addTab(() => buildHeavyPanel(), "Heavy")` and the `tabs: [{ label, component: factory }]` options form, with `addLazyTab` named as the alias. Note that a factory may be async and that the `"exception"` event is reached via `panel.getTab()`.
- **`packages/lib/docs/concepts/layout-system.md`** — add one bullet to the manager-responsibility list around line 129: a manager may claim an unbuilt child offered by `addComponent`; the base declines and the container builds it immediately.
- **`packages/lib/llms.txt`** — generated, never hand-edited. Regenerate with `npm run docs:llms` (also run by `docs:build`) after step 16 changes `TabPanel`'s class summary, and commit the result.

No page is added or removed, so the VitePress sidebar and the layouts/components catalogs need no entries.

---

## Potential Challenges

- **Phantom tabs.** `Tab` has no reverse reconcile, and `doLayout` mints a tab for any container child no entry owns. The deferred path adds *no* container child, `materializeAsync` captures the built component onto the entry before `Animation.materialize` attaches it, and `closeEntry` now removes a live spinner. Do not "helpfully" add the spinner or the built component to the container from the new code.
- **Double spinner removal.** On the failure path `Animation.materialize` removes the spinner and then `failEntry` calls `closeEntry`; on the close-during-flight path the order is reversed. `failEntry` nulls `entry.spinner` first, and `Component.removeComponent` is a no-op for a component that is not a child (its `indexOf` guard), so neither order double-removes.
- **A discarded build leaks like any discarded component.** When `isStale` is true, the built component is dropped without ever being attached. `Component.destructor` is `protected`, so `Animation` cannot run teardown on it; the component is garbage collected apart from the framework's known static theme-listener retention, which is pre-existing and out of scope here.
- **`ToolBar.addComponent` narrows the parameter.** [ToolBar.ts:484](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L484) overrides `addComponent` with a `Component`-only signature. TypeScript's method-parameter bivariance accepts that, and a toolbar has no use for a factory, so leave it alone; the typecheck in `## Verification` is the guard if that assumption is wrong.
- **`AbstractWindow._contentFactory` stays sync.** It is typed `(() => Component) | null` ([AbstractWindow.ts:230](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L230)) and is assignable to the widened `MaterializeConfig.factory`. Do not widen it — async window content is a `## Non-Goals` item.
- **`Object.assign(new LayoutConstraints(), constraints, { name })` in `addLazyTab`.** Copying onto a fresh instance keeps a caller-owned constraints object unmutated. Do not simplify it to `constraints.name = name`.
- **`getLayoutManager()` is typed non-nullable but can be undefined at runtime** (it resolves through a cast at [Component.ts:4850](packages/lib/src/typescript/lib/core/Component.ts#L4850)). Keep the `manager && …` guard in the deferred branch.
- **The frame `Tab` drains before `Dock` hears anything.** `closeEntry` emits `"empty"` before `failEntry` emits `"exception"`, so any `"empty"` subscription on a lazy frame's `Tab` runs first. The `wireRegion` guard is what keeps `Dock` from having such a subscription; without it `pruneRegion` yanks the frame out of its region and `removePanel` then finds nothing to close.
- **`addPanel` registers the spec before it resolves the frame.** So the promise guard throws with the id already in `_panels` and no frame built. Leave that as it is: it is a programming error surfaced at development time, and re-adding the same id with a corrected spec overwrites the registration and works.
- **`removePanel` returns `false` for a frame in no `Tab` region.** `failPanel` falls back to deleting the cached frame directly, so a panel that failed while undocked can still be re-added. Do not drop that branch.
- **A failed panel stays registered.** `_panels` and `_lazyFactories` keep their entries after `failPanel`, by design — that is the retry path. Do not "clean up" either map in the failure handler.
- **`Dock`'s `"exception"` fires after its `"close"`.** A listener must not call `removePanel` for that id: the panel is already gone, and a fast re-open may have re-used the id.
- **A stray `setTimeout` warning in async Animation tests.** `Animation.play` arms a fallback timer; a test that drives materialization to completion can leave it pending past teardown. That flake predates this work — do not chase it, and keep the offline tests to the synchronous assertions of case 15.

---

## Critical Files

- [packages/lib/src/typescript/lib/overlay/Dock.ts:25–46, 548–586](packages/lib/src/typescript/lib/overlay/Dock.ts#L25) — `DockPanelSpec.content: Component | (() => Component)` and `resolvePanel`'s `typeof … === "function"` dispatch: the precedent this design mirrors, the existing consumer of `Tab.addLazyTab`, and both branches step 18 rewrites.
- [packages/lib/src/typescript/lib/overlay/Dock.ts:440–481](packages/lib/src/typescript/lib/overlay/Dock.ts#L440) — `addLazyPanel`, the application-facing entry point for a deferred panel.
- [packages/lib/src/typescript/lib/overlay/Dock.ts:1655–1676](packages/lib/src/typescript/lib/overlay/Dock.ts#L1655) — `removePanel`, the whole-panel teardown `failPanel` calls, and its `regionForFrame` precondition.
- [packages/lib/src/typescript/lib/overlay/Dock.ts:1428–1462](packages/lib/src/typescript/lib/overlay/Dock.ts#L1428) — `onPanelClosed`: which maps a close evicts, which it deliberately keeps, and where `"close"` is emitted.
- [packages/lib/src/typescript/lib/overlay/Dock.ts:1205–1265](packages/lib/src/typescript/lib/overlay/Dock.ts#L1205) — `wireRegion` and `pruneRegion`: the recursion the identity-frame guard joins, and what the guard prevents.
- [packages/lib/src/typescript/lib/overlay/Dock.ts:93–155](packages/lib/src/typescript/lib/overlay/Dock.ts#L93) — `DockEvent`, `DockPanelEvent` and `DockEmptyEvent`: the event declaration shape `"exception"` follows.
- [packages/lib/src/typescript/lib/overlay/Dock.ts:1820–1912](packages/lib/src/typescript/lib/overlay/Dock.ts#L1820) — `Dock`'s `on` / `off` / `emit` overload block and its `ListenerBag`.
- [packages/lib/src/typescript/lib/data/AbstractStore.ts:30–54](packages/lib/src/typescript/lib/data/AbstractStore.ts#L30) — the `'exception'` event and `StoreExceptionEvent`: the precedent for how this codebase surfaces an async failure to the app.
- [packages/lib/src/typescript/lib/component/table/TablePanel.ts:77–87](packages/lib/src/typescript/lib/component/table/TablePanel.ts#L77) — the store-driven `showOverlay` / `hideOverlay` wiring: the *other* loading affordance, and the one this plan must not duplicate.
- [packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts:195–235](packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts#L195) — `showOverlay` / `hideOverlay` / `isOverlay`.
- [packages/lib/src/typescript/lib/core/Animation.ts:351–441](packages/lib/src/typescript/lib/core/Animation.ts#L351) — `MaterializeConfig` and `materialize`, the function being widened.
- [packages/lib/src/typescript/lib/overlay/AbstractWindow.ts:629–653](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L629) — the other `Animation.materialize` call site, which must keep working untouched.
- [packages/lib/src/typescript/lib/layout/Tab.ts:196–234](packages/lib/src/typescript/lib/layout/Tab.ts#L196) — `TabEntryState` and `ContentEntry`, the state machine being reused.
- [packages/lib/src/typescript/lib/layout/Tab.ts:1038–1100](packages/lib/src/typescript/lib/layout/Tab.ts#L1038) — `closeEntry` and `closeTab`, the only sanctioned tab-teardown path.
- [packages/lib/src/typescript/lib/layout/Tab.ts:1450–1495](packages/lib/src/typescript/lib/layout/Tab.ts#L1450) — `materializeAsync`, and the reason the deferred path must not touch the container.
- [packages/lib/src/typescript/lib/layout/Tab.ts:2096–2190](packages/lib/src/typescript/lib/layout/Tab.ts#L2096) — the `on` / `off` / `emit` overload block the `"exception"` event joins.
- [packages/lib/src/typescript/lib/layout/Tab.ts:1527–1580](packages/lib/src/typescript/lib/layout/Tab.ts#L1527) — the `doLayout` ownership sweep being extracted.
- [packages/lib/src/typescript/lib/core/Component.ts:4602–4666](packages/lib/src/typescript/lib/core/Component.ts#L4602) — `addComponent` / `insertComponent` / `removeComponent`, and the reason only the first widens.
- [packages/lib/src/typescript/lib/layout/LayoutConstraints.ts](packages/lib/src/typescript/lib/layout/LayoutConstraints.ts) — the existing manager-specific constraint fields `lazy` joins.
- [packages/lib/tests/component/layout/Tab.test.ts:26–110](packages/lib/tests/component/layout/Tab.test.ts#L26) — the offline `hostTab` harness and the `setActiveTabIndex(99)` tab-count idiom the new tests reuse.
- [packages/lib/tests/overlay/Dock.lifecycle.test.ts:1–60](packages/lib/tests/overlay/Dock.lifecycle.test.ts#L1) — the offline dock harness and its `rafQueue` / `flush()` pair, which the two new `Dock` cases reuse.
- [packages/lib/tests/dom/TestDOM.ts:539](packages/lib/tests/dom/TestDOM.ts#L539) — the recording sink's `requestAnimationFrame`, which records and drops the callback.

---

## Non-Goals

- **A retry contract, an error panel, or any other error UI.** The library closes the failed tab and reports the error; presenting it is the app's job.
- **A public API for closing a tab that has never materialized.** `closeTab(content)` matches on the content component, which a lazy entry does not have. The user's ✕ and the internal failure path both reach the shared teardown already; adding a close-by-label API is separate work.
- **Async content for `AbstractWindow.setContentFactory`.** The window content factory stays synchronous.
- **Promoting `createSpinnerWrap` to public API.** Covered by the affordance decision above.
- **Deferring the DOM-subtree build when a live `Component` is passed with `lazy: true`.** `insertComponent` calls `component.getElement(true)` on an already-rendered parent, so the subtree is built at add time. Making that lazy is a separate, optional follow-up; here `lazy` on an instance is an honest no-op.
- **Factory support on `insertComponent`.** Deferred children append.
- **Relabelling a lazy tab from the built component's `getName()` after materialization.** `TabBar` has `getEntryName` but no setter; adding one is out of scope. The label comes from `constraints.name`.
- **Registering the materialized component's `LayoutConstraints` in the manager's constraint map.** `Animation.materialize` adds the built child with no constraints today; the bar entry already holds everything `Tab` reads (`closeable`, `glyph`, `tooltip`, `name`). Unchanged.
- **Lazy semantics for any manager other than `Tab`.** Every other manager inherits the declining base hook.
- **Deferring `Dock.addPanel`.** `addPanel` stays eager; `addLazyPanel` is the deferred entry point, and an async factory handed to `addPanel` throws.
- **A `Dock`-level retry API or in-frame error UI.** `Dock` closes the panel and emits `"exception"`; re-adding the id is the retry, and presenting the failure is the application's job.
- **Evicting `_panels` / `_lazyFactories` when a panel fails.** Their retention is what makes re-adding the id rebuild and re-run the factory, and it matches what a user close already does.
- **Excluding identity frames from anything but `wireRegion`'s recursion.** `collectTabRegions` and `firstTabRegion` still walk them; a frame never hosts another frame, so walking into one finds nothing and widening the guard would be an unmotivated change.
- **Deprecating or removing `addLazyTab`** on either `Tab` or `TabPanel`. Both stay as supported aliases.

---

## Notes

[^core-widening]: The rejected alternative was to keep the widening out of core and put it on `TabPanel.addComponent` as an override, with `Tab` reached only through that subclass. It was rejected because the bare `new Container({ layoutManager: new Tab() })` form is documented as fully supported (`docs/components/TabPanel.md` line 5) and is what the two in-repo consumers actually use — `Dock` builds `new Container({ …, layoutManager: tab })` at Dock.ts:571, and the demo app's `main.ts` drives a bare `Tab` through `Body.init({ layoutManager })`. A `TabPanel`-only widening would leave both of them on `addLazyTab`, so the specialized method would remain the real API and the change would not have achieved its purpose. A second alternative — letting `Tab` discover factories on its own, with no core change — is not implementable: a factory handed to `addComponent` never reaches the manager unless core dispatches it. The cost of the chosen route is one type union and a short branch in `addComponent`, plus a defaulted hook on `LayoutManager`; no existing call site changes, because a `Component` argument still takes the original path byte for byte. Allowing `ComponentFactory` to return a promise does not disturb any of this: the dispatch is still `typeof component === "function"`, and the promise is only ever observed by whoever runs the factory.

[^hook-shape]: Two further alternatives were rejected — one about *where an unbuilt child is stored*, one about *how much the manager decides*.

    **Storing factories in the children array**, by typing `Component._components` as `(Component | ComponentFactory)[]`, was rejected on blast radius. `getComponents()` is read at 96 call sites, and 8 files under `layout/` iterate children and call `Component` methods on them directly — `Tab.doLayout` itself runs `component.setVisible(false)` over every child. Each of those would need a type guard, and any that missed one would fail at runtime rather than at compile time. `Tab` also already stores an unbuilt child in its own `_contents` entry array as `{ id, component: null, factory, spinner: null, state: "lazy" }`, so the factory has a home that only `Tab` reads. A second home would leave two structures tracking one child, and would make `_components.length` stop meaning "live children" — a count the deferred path already has to be careful with (see [^append-only]).

    **Routing every `addComponent` through the manager**, letting it return the component to store, a loading placeholder, or some other substitute, was rejected because it makes child substitution a general capability of every container. A caller that passed `myGrid` would find a substituted placeholder in the tree instead, so `removeComponent(myGrid)` would match nothing and listeners wired against `myGrid` would sit outside the tree. `Tab` avoids that by keeping the spinner in `entry.spinner` — entry-owned, never handed to the caller — and swapping it for the real component on materialize, so the caller's reference is only ever the thing it passed or nothing yet. The narrow `addDeferredComponent` hook gives the manager the same authority for the one case that needs it without opening substitution everywhere.

[^async-needs-owner]: Three ways to handle a promise on the eager path were weighed. **Appending the child when the promise resolves** would make every container silently async: the child appears some frames after the call with no spinner, no ordering guarantee against later `addComponent` calls, and no owner for a rejection — core has no event surface to report one on. **Ignoring the promise** loses the child with no signal at all. **Throwing** is what the codebase already does for manager misuse of the same shape — `Fit` throws `"Container contains more than one component."` and `Border` throws for unresolvable constraints — and it fails loudly at the call site during development rather than producing a permanently blank region in production. The throw is reachable only by a real programming mistake (an async factory handed to a manager that cannot defer), never by correct use.

[^sync-path-untouched]: The `instanceof Promise` branch exists instead of a blanket `await` so the synchronous path keeps exactly its current timing. `await` on a non-promise still costs a microtask tick, which would move the sync attach out of the second animation frame and into the following microtask checkpoint — enough to change when the fade starts relative to layout, and enough to break the offline assertions in case 15 that depend on the spinner mount being the only thing that has happened. `isStale` is checked at the single attach point shared by both branches, so it also covers the pre-existing (if narrow) window in which a tab is closed during the two-frame yield of a *synchronous* build.

[^exception-event]: Three surfacing mechanisms were considered; `addComponent` returns `this` for chaining and so cannot return the rejection, which rules out the simplest option before it starts.

    **An error callback in `LayoutConstraints`** was rejected. `LayoutConstraints` is a plain data class of layout metadata that is serialized and round-tripped (`tests/component/layout/LayoutSerialization.test.ts`); putting a function on it makes it non-serializable and puts an error-handling concern in a geometry bag. It would also be the only callback field on the class, diverging from how everything else in the codebase reports an async failure.

    **Relying on the app to catch inside its own factory**, with the library only owning tab teardown, was rejected because the library still has to *know* the factory failed in order to tear the tab down — so a rejection path is required regardless. And an app that forgets the internal `catch` gets an unhandled rejection plus a tab spinning forever, which is the exact failure mode this plan must prevent. An app that *does* want to swallow the error inside its factory can still do so: it returns a fallback component instead of rejecting, and no tab is closed.

    **A typed `"exception"` event on `Tab`** was chosen. It matches `AbstractStore`'s `'exception'` event, which is how this codebase already reports an async failure to a consumer; it joins an existing `on` / `off` / `emit` + `ListenerBag` surface alongside five other events, so it costs one union member and two overloads; it keeps every trace of error presentation out of the library; and because the rejection handler is attached where the promise is observed, the rejection can never reach the unhandled-rejection channel. The payload is positional (`error`, `label`) rather than an object because every other `Tab` event is positional; `AbstractStore` uses an object payload, but consistency within the emitting class wins over consistency with a class in another layer.

[^stale-rejection]: Checking staleness only on the success path leaves one live failure mode: a factory that rejects *after* the user closed its tab. `Tab.failEntry` would then run against an entry that `closeEntry` already spliced out — `getEntryName` returns nothing useful, the second `closeEntry` finds no matching id and no-ops, and an `"exception"` fires for a tab the consumer can no longer see. For an application that maps the event onto a user-visible notification, that is an error message for something the user already cancelled. The check costs one `if` at the point the rejection is observed, and it is the same predicate the success path already uses, so there is no second definition of "stale" to keep in step. The consuming SQLAdmin plan `lazy-tab-loading-sequence` removed its `_loadingTabs` map and its identity guard because of this rule and the `isStale` success-path check together; reverting either one silently re-opens a race in that application.

[^dock-eager-guard]: Two hand-written promise guards would otherwise exist for the same mistake. `resolvePanel`'s eager branch currently runs the factory itself and hands the result to `frame.addComponent`, so widening `DockPanelSpec.content` would make it store a `Promise` where a `Component` is required — a runtime failure with no message. Passing `spec.content` straight to `frame.addComponent` instead reuses the guard core already has to carry (a factory can reach any manager), keeps one error message for one mistake, and deletes a branch rather than adding one. `addPanel` cannot sensibly accept a promise anyway: its frame is `Fit`-managed, so there is no spinner to show and no entry to own the wait — the same reason an `HBox` rejects one. An application that wants an async panel calls `addLazyPanel`, which is the entry point built for it.

[^dock-exception-shape]: Three ways to surface a lazy panel's failure to a `Dock` consumer were weighed. **Exposing the frame's `Tab`** — an accessor returning the inner manager so an application can subscribe itself — was rejected: it publishes an implementation detail (`Dock` is free to stop using a `Tab` for the frame), it makes every consumer wire per-panel listeners for a per-dock concern, and the application would still have to close the outer panel itself. **Leaving the failure unreported**, closing the panel silently, was rejected because a panel that vanishes with no explanation is indistinguishable from a bug. **A Dock-level `"exception"`** was chosen: it mirrors the `Tab` event one layer up, it joins an `on` / `off` / `emit` + `ListenerBag` surface that already carries six events, and it costs one union member, one payload interface, three overloads and a `listeners` key. The payload is an object (`{ id, error }`) rather than the positional pair `Tab` uses, because every `Dock` event carries an object payload — consistency within the emitting class wins, the same rule that made `Tab`'s payload positional. `id` is the minimum an application needs to act; a consumer wanting more (the `DbObjectRef` SQLAdmin names its error with, for instance) rides it on the thrown value, which is what `PanelLoadError` in the consuming plan does.

[^frame-not-region]: The guard also removes an inconsistency that predates this plan. An *eager* panel's identity frame carries a `Fit` manager, so the sweep never classifies it as a region; a *lazy* panel's frame carries a `Tab`, so the sweep wires it — giving a single panel's body its own `DockRegion` (edge drops landing inside a panel), its own reorderable strip, and its own prune-on-empty. Nothing exercised any of it before, because a lazy frame's inner tab had no ✕ and never drained. The failure path drains it, which turns the dormant `"empty"` wiring into a `removeComponent` on a `Tab`-managed region — the phantom-tab shape this plan spends its `closeEntry` fix and its deferred-registration design avoiding. Making the guard match on registered identity (`this._frames.get(child.getId()) === child`) rather than on the manager type keeps it narrow: a genuine `Tab` region nested under another region is still wired.

[^spinner-orphan]: This is a latent bug that the async path makes easy to hit, rather than a new one. The window in which a `"building"` entry can be closed is two animation frames for a synchronous factory — hard to hit by hand — but the length of a network round-trip for an async one. The consequence is visible: the spinner stays in the container as an entry-unowned child, the `doLayout` ownership sweep mints a fresh id-labelled tab for it on the next pass, and the user is left with a phantom tab holding a spinner that never stops.

[^spinner-private]: Making `createSpinnerWrap` public would add a third way of getting a spinner into a container — one where the container's layout manager does not know the placeholder exists. That is precisely the hand-rolled loading-panel shape this plan exists to remove: an app would mount a spinner as an ordinary child, then have to remember to remove it, and under `Tab` the manager would mint a tab for it. The two public affordances leave nothing to hand-roll: a live component takes `showOverlay`, and a component that does not exist yet — whether its build is synchronous or waits on a fetch — takes `addComponent(factory, { lazy })`, where the manager owns the placeholder's whole lifetime.

[^append-only]: `addComponent` passes `this._components.length` as the insertion index. Under a `Tab` that number counts *materialized* children, which is not the number of tabs — three unmaterialized lazy tabs leave `_components.length` at `0`. So an index handed to the deferred hook would be meaningless in tab space, and interpreting it would silently misplace entries and desynchronize `_selectedTabIndex`. Appending sidesteps the whole index-space mismatch and matches what `addLazyTab` does today. Ordering across interleaved eager and lazy adds is instead handled by the `syncUntabbedChildren` catch-up, which is exact.

[^raf-testing]: The offline harness can drive materialization up to, but not through, the two-frame yield — and the async widening does not move that line. `installTestDOM`'s recording sink implements `requestAnimationFrame` by recording the call and dropping the callback (`tests/dom/TestDOM.ts:539`), and `Animation.materialize` puts the factory call inside two nested frames. The promise microtasks an async factory introduces all sit *after* that gate: the factory is never invoked offline, so no promise is ever created, and awaiting or flushing microtasks in a test gains nothing. Resolve, reject, and close-during-flight are therefore all manual-verify, for a bare `Tab` (cases 21–23) and for a docked panel alike (cases 26–28). `tests/overlay/Dock.lifecycle.test.ts` queues rAF callbacks and flushes them explicitly rather than dropping them, so it *could* push past the gate — but only by also driving `Animation.play`'s fallback timer, which is the coupling this footnote declines below. The two `Dock` cases it gains assert before any flush, on the synchronous side of the gate.

    What *is* synchronous, and therefore assertable, is everything before the yield: `materializeAsync` flips the entry to `"building"` and `Animation.materialize` calls `host.addComponent(spinner)` before returning — so after `tab.setActiveTabIndex(i)` a test can assert the container gained exactly one child and the factory has not run, identically for a sync and an async factory (case 15). Registration is likewise fully synchronous and fully testable (cases 2–5, 11–14), and so is the eager-path promise guard, which runs with no yield at all (cases 9–10, and case 18 through `Dock.addPanel`). Pushing past the gate would mean stubbing the sink's `requestAnimationFrame` to invoke its callback inline and driving `Animation.play`'s fallback timer with fake timers, which couples the test to two animation internals and to the modelled `matchMedia` never reporting reduced motion — not worth it for assertions the demo panel now exercises directly.
