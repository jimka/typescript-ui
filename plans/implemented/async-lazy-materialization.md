# Async Lazy Materialization with Spinner — Implementation Plan

## Overview

Two related problems, one plan:

1. **Construction-time DOM coupling.** Today, constructing a `Component` synchronously inserts a CSS rule into the live stylesheet; constructing a `Text` synchronously probes `document.body` and forces layout; constructing a `Table` measures column-header text once per column the same way. None of those operations can happen off-thread, but all of them can be *deferred* to a moment when the component is being added to the live DOM. After deferring, "constructing a subtree" is JS-only — no stylesheet inserts, no forced layout. That makes the second piece work.
2. **Spinner-first activation for lazy `Tab` and `Window` content.** With construction effectively detached, the existing `addLazyTab` mechanism can be flipped from "synchronous build on first activation" to "show spinner immediately, paint, run factory, fade content in." `Window` gets a matching `setContentFactory` API so a `new Window(...).show()` returns instantly with a spinner while the content tree builds.

Lazy panel construction is already wired up for `Tab` (`addLazyTab`) and exists informally for `Window` (callers build heavy content between `new Window(...)` and `win.show()`). In both cases the factory still runs on the main thread synchronously at the moment of activation: selecting a lazy `Tab` blocks the UI until the panel is built, and a slow content tree (e.g. the table at [MiscPanel.ts:102-162](../src/typescript/MiscPanel.ts#L102-L162)) blocks the window-open animation until the tree is ready.

The goal is to flip the perceived latency:

- **Tab**: clicking a lazy tab switches the tab strip immediately, paints a centred [`ProgressSpinner`](../src/typescript/lib/component/display/ProgressSpinner.ts) in the content area, yields to the browser so the spinner renders, then runs the factory and fades the real panel in over the spinner.
- **Window**: `win.show()` is replaced by an opt-in `setContentFactory(factory)` (or `show(factory)`) path. The window animates open with a spinner inside its content area, yields to the browser, runs the factory, then fades the real content in.

JS is single-threaded; we cannot truly build a `Component` off-thread because every constructor touches the DOM. "In the background" here means: paint a spinner first (one or two rAFs of yield), *then* run the factory on the main thread. The user sees an immediate spinner instead of a frozen UI, which is the visible win.

Both paths share the same primitive: a small helper that (1) mounts a `ProgressSpinner` into a host container, (2) yields two animation frames so the spinner reaches the screen, (3) runs the factory, (4) cross-fades the result in over the spinner. The helper lives next to [`Animation.play`](../src/typescript/lib/core/Animation.ts#L88) since it composes the same `transitionend`-with-fallback pattern. Both `Tab.materialize` ([Tab.ts:445](../src/typescript/lib/layout/Tab.ts#L445)) and `Window.show` ([Window.ts:159](../src/typescript/lib/core/Window.ts#L159)) call into it.

---

## Architecture Decisions

### Two-rAF yield, not Web Workers or microtasks

The factory must run on the main thread (DOM). The only realistic "yield" is to let the browser paint the spinner between the click and the factory call. A single `requestAnimationFrame` is not enough in practice — Firefox can race the rAF with the next layout pass and still paint *after* the factory has blocked. The same two-rAF dance that `Animation.play` already performs for `from`/`to` ([Animation.ts:127-131](../src/typescript/lib/core/Animation.ts#L127-L131)) is the right primitive: rAF → rAF → run factory. This guarantees the spinner has been committed to the screen before the synchronous heavy work starts.

Rejected: chunking the factory across microtasks (would require every factory to be a generator/async iterator — a large API change for marginal gain). Rejected: `requestIdleCallback` — not in Safari and not aligned to paint boundaries.

### Spinner is a fresh `ProgressSpinner`, mounted inline — not `showOverlay`

[`ProgressSpinner.showOverlay`](../src/typescript/lib/component/display/ProgressSpinner.ts#L173) is designed to overlay an *existing* rendered component, sized from the target's `getWidth()` / `getHeight()`. For `Tab` the content slot has no rendered component yet, and for `Window` we want the spinner to live inside the content area as the only child, not stacked on top of nothing. The plan uses a *fresh*, *inline* `ProgressSpinner` added as a regular child component, then removed on factory completion. `showOverlay` is unchanged.

### Cross-fade via `Animation.play`, not a custom transition

Both call sites already use `Animation.play` for opacity transitions (Tab tab-fade at [Tab.ts:551](../src/typescript/lib/layout/Tab.ts#L551), Window scale-fade at [Window.ts:175](../src/typescript/lib/core/Window.ts#L175)). The new helper plays an opacity transition on the freshly-materialized component's element with `from: { opacity: "0" }, to: { opacity: "1" }`. The spinner is removed in `onComplete` so a brief overlap is visible — that's the desired "fade in over the spinner" effect. Reduced motion short-circuits via `Animation.play`'s existing handling.

### `Tab` materialization becomes asynchronous; `getVisibleComponent` no longer triggers a build

Today `getVisibleComponent` ([Tab.ts:159](../src/typescript/lib/layout/Tab.ts#L159)) synchronously calls `materialize` when the selected entry has only a factory. That has to stop — `getPreferredSize`/`getMinSize`/`getMaxSize` ([Tab.ts:184](../src/typescript/lib/layout/Tab.ts#L184), [Tab.ts:221](../src/typescript/lib/layout/Tab.ts#L221), [Tab.ts:258](../src/typescript/lib/layout/Tab.ts#L258)) all call `getVisibleComponent`, and triggering a factory from inside a sizing query reintroduces the block we are trying to remove.

Instead: `onTabPressed` triggers materialization explicitly via a new `materializeAsync` path. `getVisibleComponent` returns the spinner placeholder while the factory is in flight, and the materialized component once it lands. The selected-entry pointer (`selectedTabIndex`) updates immediately so the tab strip's selected button is correct from the first frame.

### `TabEntry` gains a `spinner` slot and a `state` field

`TabEntry` already carries `component` and `factory`. Add `spinner: ProgressSpinner | null` and `state: "lazy" | "building" | "ready"`. State transitions:

- Eager `createTab`: `state: "ready"`, `factory: null`, `component: <X>`, `spinner: null`.
- `addLazyTab`: `state: "lazy"`, `factory: <f>`, `component: null`, `spinner: null`.
- First activation: `state: "building"`, `spinner: <new ProgressSpinner>` mounted into container; factory queued for next-next rAF.
- Factory completes: `state: "ready"`, `component: <result>`, `spinner: null` (removed and discarded after fade-in completes).

The `state` field prevents re-entrant builds if the user spam-clicks a lazy tab mid-materialization.

### Tier 1 — defer all construction-time DOM coupling

For the spinner-yield-fade pattern to feel responsive, the factory body must not thrash layout during the two-rAF yield. Three eager DOM-coupled operations happen during typical component construction today:

1. **`Component` constructor inserts a per-component CSS rule into the live stylesheet** ([Component.ts:220](../src/typescript/lib/core/Component.ts#L220)) via `CSS.createComponentRule` → `sheet.insertRule(...)` ([CSS.ts:122](../src/typescript/lib/core/CSS.ts#L122)). Paid once per component instance.
2. **`Text` constructor eagerly probes the off-screen `<span>`** via `measureTextMetrics` at [Text.ts:96](../src/typescript/lib/component/input/Text.ts#L96) which appends to `document.body` and calls `getBoundingClientRect` — forces synchronous layout. Paid per `Text` and again on every `setText`/`setFont*`. (The `calculateSize` call at [Text.ts:93](../src/typescript/lib/component/input/Text.ts#L93) is inside the `ThemeManager.onThemeChange` callback registered during construction — it fires later, on theme change, not during construction.)

`Table.buildColumnConfigs` was investigated as a third candidate but is in fact a pure Map-builder ([Table.ts:500-508](../src/typescript/lib/component/table/Table.ts#L500-L508)); `defaultColumnWidth` (which does call `measureTextWidth`) is reached only from user-driven `setColumnVisible` and `resetColumns`, not from construction. Construction-time width initialisation goes through [layout/Table.ts:initializeWidths](../src/typescript/lib/layout/Table.ts#L200) which uses a `description.length * CHAR_WIDTH` heuristic — no DOM probe. There is no Table deferral to do.

The plan defers the two remaining items to a moment when the component is already in (or being added to) the live DOM, so construction itself is JS-only. Combined with the spinner pause, this means the spinner has time to paint and the factory's main-thread block is dominated by object allocation, not by forced layout.

The framework's existing primitives make this cheap: element creation is already lazy ([Component.ts:333](../src/typescript/lib/core/Component.ts#L333)), inline-style writes already buffer via `dirtyStyle` ([Component.ts:445-452](../src/typescript/lib/core/Component.ts#L445-L452)), and `commitElementStyle` is a no-op when the element doesn't exist ([Component.ts:500-510](../src/typescript/lib/core/Component.ts#L500-L510)). The deferrals plug the three remaining leaks.

### Tier 2 — detached construction without `DocumentFragment`

After Tier 1 lands, a constructed-but-unattached subtree holds all its state as JS — no DOM nodes, no stylesheet entries, no measurements. There's no need for an explicit `DocumentFragment` wrapper: the components are already detached from the live document. The factory's output graph is "spliced" into the live DOM atomically the moment `host.addComponent(component)` runs in `Animation.materialize`'s onReady callback, which triggers the single attach-time DOM and rule-flush burst.

### `Window` gains `setContentFactory(factory)`

Don't overload `addComponent`. A separate setter (`setContentFactory`) makes intent explicit and keeps `addComponent` semantics intact for eager content. When `setContentFactory` is called, the factory is stored; when `show()` runs, the window does its existing entrance animation *and* mounts a spinner into the content area. After the two-rAF yield, the factory runs, the result is added via `this.addComponent(...)`, the spinner is removed, and the new content fades in. Calling `show()` without a content factory is unchanged.

Rejected: a `lazy: () => Component` field on `WindowOptions`. Options propagate through `applyOptions`, and the only behavioural difference would be a single method call — clearer to expose `setContentFactory` directly. Authors can still set it inline:

```typescript
const win = new Window("Heavy");
win.setSize({ width: 800, height: 600 });
win.setContentFactory(() => new HeavyContent());
win.show();
```

### Spinner placement: centred via existing `setPreferredSize` and a centering layout

A `ProgressSpinner` defaults to `--ts-ui-font-size` × `--ts-ui-font-size` (≈14×14 px). To centre it inside the container (Tab content area or Window inner area), wrap it in a `Component` with a [`Grid`](../src/typescript/lib/layout/Grid.ts) 1×1 layout that doesn't stretch, *or* set the spinner's position absolutely and centre it manually in the host's `doLayout`. The simpler route is `Grid(1, 1)` without stretching — spinner sits in the centre of the cell. The wrapper is destroyed when the spinner is removed.

Rejected: `showOverlay` — see above. The spinner is the only child during the build, not an overlay.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/core/Animation.ts — additive
export namespace Animation {
    export interface MaterializeConfig {
        host:             Component;            // where the spinner mounts and the content lands
        factory:          () => Component;      // synchronous factory; runs after the two-rAF yield
        spinnerComponent: Component;            // caller-provided; usually `new ProgressSpinner()` (see Step 4)
        fadeMs?:          number;               // cross-fade duration; defaults to 160
        onReady?:         (component: Component) => void; // fires after the fade-in completes
    }

    export function materialize(config: MaterializeConfig): void;
}

// src/typescript/lib/layout/Tab.ts — internal changes; no new public API
// (addLazyTab, materialize signature unchanged; new private materializeAsync)

// src/typescript/lib/core/Window.ts — additive
class Window extends Panel {
    setContentFactory(factory: () => Component): this;
}
```

`Animation.materialize` is the shared primitive. Both `Tab` and `Window` call it; nothing else needs to.

---

## Theme Tokens

No new tokens. The spinner already reads `--ts-ui-progress-spinner-color` and the fade uses `opacity`, which is not themed.

---

## Tier 1 Implementation

### 1a. Lazy `Component.cssRule`

#### [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts)

Change `cssRule` from eager-created in the constructor to lazy:

- Field becomes `private cssRule: CSSStyleRule | null = null;`
- Remove the `this.cssRule = CSS.createComponentRule(...)` line from the constructor ([Component.ts:220](../src/typescript/lib/core/Component.ts#L220)).
- Introduce a private helper:

```typescript
private ensureCSSRule(): CSSStyleRule {
    if (!this.cssRule) {
        this.cssRule = CSS.createComponentRule(this.getId()) as CSSStyleRule;
        if (Object.keys(this.dirtyCSSRule).length > 0) {
            Object.assign(this.cssRule.style, this.dirtyCSSRule);
            this.dirtyCSSRule = {};
        }
    }
    return this.cssRule;
}
```

- Route every direct write (51 sites in [Component.ts](../src/typescript/lib/core/Component.ts) per `grep -c "cssRule\.style" src/typescript/lib/core/Component.ts` — `padding`, `background-color`, `background-image`, `color`, `color-scheme`, `border*`, `box-shadow`, `outline`, `appearance`, `border-image`, `transform`, `min/max width/height`, etc.) through `setElementCSSRule(key, value)`. The batched path is already wired ([Component.ts:540-548](../src/typescript/lib/core/Component.ts#L540-L548)); the audit just removes the bypasses.
- `commitCSSRule()` ([Component.ts:556](../src/typescript/lib/core/Component.ts#L556)) gains a gate: only call `ensureCSSRule()` when the element exists *or* when `dirtyCSSRule` has at least one entry that must be visible before render (none currently — Border etc. write to the rule but read back from the live one). The simplest rule: skip the rule materialisation entirely when the element doesn't exist; the next `getElement(true)` call triggers `render()`, which calls `ensureCSSRule()` at the top to flush the buffer before any DOM is created.
- `getCSSRule()` ([Component.ts:322](../src/typescript/lib/core/Component.ts#L322)) is the cross-class read used by `Input`, `ComboBox`, `TextInput` ([Input.ts:112](../src/typescript/lib/component/input/Input.ts#L112), [ComboBox.ts:116](../src/typescript/lib/component/input/ComboBox.ts#L116), [TextInput.ts:255](../src/typescript/lib/component/input/TextInput.ts#L255)). It becomes `return this.ensureCSSRule();` — callers that need the live rule force materialisation. After Tier 1, no construction-time path calls `getCSSRule()`; only attach-time / first-render paths do.

Audit check: `grep -rn "cssRule\.style\|\.cssRule\b" src/typescript/lib/` should show only the helper itself and `commitCSSRule` after the sweep.

Risk: `Border.applyOnCSSRule`, `BorderLine.applyOnCSSRule`, and similar style-on-rule helpers accept a `CSSStyleRule` reference and mutate it directly. They're invoked from `setBorder`/`clearBorder`/etc. The callers should write into a temporary `Style` map and pass it to `setElementCSSRules`, OR the helpers should be inverted to return a `Style` map that the caller passes to `setElementCSSRules`. Either preserves batching. Pick the inversion — `Border.toStyle(): Style` is the cleaner shape and removes the "this method mutates its argument" surprise.

### 1b. Lazy `Text.calculateSize`

#### [src/typescript/lib/component/input/Text.ts](../src/typescript/lib/component/input/Text.ts)

Move the `<span>` probe off the construction path:

- Add `private measurementDirty: boolean = true;`
- Remove both `this.calculateSize()` calls from the constructor ([Text.ts:93](../src/typescript/lib/component/input/Text.ts#L93), [Text.ts:96](../src/typescript/lib/component/input/Text.ts#L96)).
- In `setText`, `setFontFamily`, `setFontSize`, and the other setters currently calling `calculateSize()` ([Text.ts:301](../src/typescript/lib/component/input/Text.ts#L301), [Text.ts:398](../src/typescript/lib/component/input/Text.ts#L398), [Text.ts:463](../src/typescript/lib/component/input/Text.ts#L463) and any siblings): replace the `this.calculateSize()` call with `this.measurementDirty = true; this.scheduleLayout();`.
- `calculateSize()` clears the flag at the top:

```typescript
private calculateSize(): void {
    this.measurementDirty = false;
    if (!this.autoMeasure) return;
    // ...existing body
}
```

- Wrap the read accessors:

```typescript
getPreferredSize(): Size | null {
    if (this.measurementDirty) this.calculateSize();
    return super.getPreferredSize();
}

getBaseline(): number | null {
    if (this.measurementDirty) this.calculateSize();
    return this.wrapInnerBaseline(this.measuredBaseline);
}
```

- `measure()` ([Text.ts:264](../src/typescript/lib/component/input/Text.ts#L264)) still works — `calculateSize` now also clears the flag.

The first `getPreferredSize`/`getBaseline` call happens during the parent's `doLayout`, which runs after attach to the live DOM. The probe still appends to `document.body` and reads the same theme-derived font properties as before — same correctness, deferred timing.

Risk: code that asks a detached `Text` for its preferred size before attach (e.g. tests, manual layout) will trigger the probe at that call. The probe still works in isolation (it appends to `document.body` regardless of `Text`'s attachment) so the result is correct; only the *timing* of the forced layout shifts.

---

## Internal Structure

### Animation.materialize

```typescript
export function materialize(config: MaterializeConfig): void {
    const { host, factory, fadeMs = 160, onReady } = config;

    const spinner = new ProgressSpinner();
    const spinnerWrap = new Component();
    spinnerWrap.setLayoutManager(new Grid(1, 1).setStretching(false));
    spinnerWrap.addComponent(spinner);

    host.addComponent(spinnerWrap);
    host.scheduleLayout();

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const component = factory();
            host.addComponent(component);

            const el = component.getElement(true);
            host.scheduleLayout();

            Animation.play(el, {
                from:       { opacity: "0" },
                to:         { opacity: "1" },
                durationMs: fadeMs,
                properties: ["opacity"],
                onComplete: () => {
                    host.removeComponent(spinnerWrap);
                    host.scheduleLayout();
                    onReady?.(component);
                },
            });
        });
    });
}
```

`Animation.play` already handles reduced motion — when set, the `to` styles are applied synchronously and `onComplete` fires same-tick, so the spinner is removed without a visible fade. That's the correct behaviour for that user setting.

### Tab — async materialize path

```typescript
// Replaces existing materialize() body for the lazy case; eager path unchanged.
private materializeAsync(idx: number): void {
    const entry = this.tabs[idx];
    if (!entry || entry.state !== "lazy") {
        return; // already building or ready
    }
    if (!entry.factory) {
        return;
    }

    const container = this.getContainer();
    if (!container) {
        return;
    }

    entry.state = "building";

    Animation.materialize({
        host:    container,
        factory: entry.factory!,
        onReady: (component) => {
            entry.component = component;
            entry.factory   = null;
            entry.spinner   = null;
            entry.state     = "ready";
            this.wireComponentAria(entry, component);
            container.scheduleLayout();
        },
    });
}
```

`getVisibleComponent` becomes a pure read:

```typescript
getVisibleComponent(): Component | null {
    const container = this.getContainer();
    if (!container) {
        return null;
    }

    const entry = this.tabs[this.selectedTabIndex];
    if (!entry) {
        return container.getComponents()[this.selectedTabIndex] ?? null;
    }

    return entry.component;
}
```

`onTabPressed` triggers materialization on first activation:

```typescript
onTabPressed(tab: Component): void {
    const idx = this.tabs.findIndex(entry => entry.button === tab);
    if (idx < 0) {
        return;
    }

    this.selectedTabIndex = idx;
    this.rovingTabIndex.moveTo(idx);

    const entry = this.tabs[idx];
    if (entry.state === "lazy") {
        this.materializeAsync(idx);
    }

    this.getContainer()?.scheduleLayout();
}
```

`doLayout` must also trigger materialization for the initial tab on first paint (today this happens implicitly via `getVisibleComponent`). Add a check at the top of `doLayout`: if `tabs[selectedTabIndex].state === "lazy"`, call `materializeAsync(selectedTabIndex)`. The first `doLayout` will place the spinner; the factory runs after two rAFs; the next `scheduleLayout` (triggered in `onReady`) places the real component.

The "no visible component yet" branch in `doLayout` ([Tab.ts:511-515](../src/typescript/lib/layout/Tab.ts#L511-L515)) needs to handle the building state. When `getVisibleComponent` returns `null` (because the entry is still building), the spinner wrapper added by `Animation.materialize` is already in `container.getComponents()`. The fallback `components[0]` no longer fits — instead, when the selected entry's component is `null` but `state === "building"`, find and surface the spinner wrapper as the visible component for layout purposes. This is done by stashing a reference on the entry (`entry.spinner = spinnerWrap`) so the layout pass can pull it directly.

### Window — show with deferred content

```typescript
private contentFactory: (() => Component) | null = null;

setContentFactory(factory: () => Component): this {
    this.contentFactory = factory;
    return this;
}

show(): this {
    // ... existing show body up through Animation.play(el, { entrance })
    // After scheduling the entrance animation:
    if (this.contentFactory) {
        const factory = this.contentFactory;
        this.contentFactory = null;

        Animation.materialize({
            host:    this,
            factory: factory,
        });
    }
    return this;
}
```

The window-entrance animation and the content-materialize yield run concurrently. The two rAFs of yield generally complete *during* the 150 ms entrance animation, so the spinner is visible by the time the window finishes scaling in. The real content fades in afterwards.

---

## Ordered Implementation Steps

The Tier 1 deferrals ship first because they're independently valuable (less layout thrash on every panel-construction path, not only the lazy ones) and they're what make the spinner pause feel right. The spinner work follows.

### Step 1 — Defer `Component.cssRule` creation

Apply 1a end-to-end:

1. Convert `Border.applyOnCSSRule` and `BorderLine.applyOnCSSRule` (and any sibling helpers) to `toStyle(): Style`.
2. Switch every `setBorder` / `setBorderRadius` / etc. call site in `Component.ts` to write via `setElementCSSRules(border.toStyle())`.
3. Sweep the remaining ~30 direct `this.cssRule.style.X = ...` writes in `Component.ts` to `setElementCSSRule("X", value)`.
4. Make `cssRule` nullable and add `ensureCSSRule()`.
5. Drop the `createComponentRule` call from the constructor.
6. Update `getCSSRule()` to call `ensureCSSRule()`.

Verification: `grep -rn "cssRule\.style" src/typescript/lib/` — expect zero matches outside `ensureCSSRule` / `commitCSSRule`. `npx tsc --noEmit` clean. Construct a fresh `Component` in DevTools, inspect `document.styleSheets[].cssRules.length` — should not increment until the element renders.

### Step 2 — Defer `Text.calculateSize`

Apply 1b. `npx tsc --noEmit` clean. In DevTools Performance, record construction of a heavy panel — the `Recalculate Style` events from `measureTextMetrics` should disappear from the construction window and reappear during the first `doLayout`.

### Step 3 — `Animation.materialize`

Add the helper to [Animation.ts](../src/typescript/lib/core/Animation.ts) inside the `Animation` namespace. Import `ProgressSpinner` and `Component` and `Grid` lazily inside the function body to avoid a top-level circular dependency between `Animation` (in `core`) and `ProgressSpinner` (in `component/display`).

**Cycle risk**: `ProgressSpinner` imports from `~/core/Theme.js`, `~/core/CSS.js`, and `~/core/Component.js`. `Animation` lives in `~/core/`. Importing `ProgressSpinner` from `Animation.ts` would create a `core → component/display → core` cycle. (Note: `core → layout` is already an established direction — `Component`, `Window`, `Dialog`, and `Menu` all import from `~/layout/` — so `core` is not strictly above `layout` in the import graph; the constraint that matters here is the specific cycle with `component/display`.) Resolution: take a `spinnerComponent: Component` in `MaterializeConfig` and let callers construct it. This keeps `Animation` free of `component/display` imports and gives call sites a hook for spinner customisation later.

Final signature matches the Public API section above. Verify with `npx tsc --noEmit` — no new errors above baseline.

### Step 4 — Centering wrapper helper

`Tab` and `Window` construct the spinner-and-wrapper pair themselves (a `Component` with a `Grid(1,1)` layout and stretching off, holding a fresh `ProgressSpinner`) and pass it to `Animation.materialize` as `spinnerComponent`. This keeps `Animation` import-free of `component/display` — the only direction that would introduce a cycle. (`core → layout` is already established via `Component`/`Window`/`Dialog`/`Menu`, so `Grid` itself could be imported into `Animation.ts` if the wrapper construction were centralised there; but pushing it to the call sites is still preferred because it leaves the spinner's shape — size, padding, alternate spinner classes — under caller control.)

### Step 5 — `Tab` async materialization

Modify [Tab.ts](../src/typescript/lib/layout/Tab.ts):

1. Extend `TabEntry` ([Tab.ts:43](../src/typescript/lib/layout/Tab.ts#L43)) with `spinner: Component | null` and `state: "lazy" | "building" | "ready"`. Default `state` is `"lazy"` for new entries (set explicitly in `addLazyTab`); `createTab` sets `state: "ready"`.
2. Replace the synchronous `materialize` ([Tab.ts:445](../src/typescript/lib/layout/Tab.ts#L445)) with `materializeAsync`. The eager path in `createTab` does not call this — it directly populates `entry.component`.
3. Rewrite `getVisibleComponent` to a pure read off the entry (no factory invocation). If `entry.state === "building"` and `entry.spinner !== null`, return `entry.spinner` so `doLayout` places the spinner wrapper as the visible component.
4. Hook `materializeAsync` into `onTabPressed` and into `doLayout` (for the initial-tab case on first paint).
5. Update the fade logic at [Tab.ts:546-558](../src/typescript/lib/layout/Tab.ts#L546-L558): the tab-strip selection fade should still fire when switching between *ready* tabs. For a tab that's still building, the spinner is shown — no extra fade needed (the materialize helper handles the content fade-in). Guard the existing fade on `entry.state === "ready"`.

### Step 6 — `Window.setContentFactory`

Modify [Window.ts](../src/typescript/lib/core/Window.ts):

1. Add `private contentFactory: (() => Component) | null = null;`
2. Add `setContentFactory(factory: () => Component): this`.
3. In `show()` after `Animation.play(el, { entrance })`, if `contentFactory` is set, build a spinner wrapper and call `Animation.materialize`.
4. In `onExitAction` ([Window.ts:205](../src/typescript/lib/core/Window.ts#L205)), null out `contentFactory` defensively in case the window is closed mid-build. (Not strictly required — the destructor will GC the closure — but tidier.)

### Step 7 — Demo migration

Update [MiscPanel.ts:102-162](../src/typescript/MiscPanel.ts#L102-L162) (the slow table window) and [MiscPanel.ts:166-202](../src/typescript/MiscPanel.ts#L166-L202) (the paginated table window) to use `setContentFactory` instead of building content inline before `show()`. The other window callers (image at [MiscPanel.ts:87-99](../src/typescript/MiscPanel.ts#L87-L99), tree at [MiscPanel.ts:293](../src/typescript/MiscPanel.ts#L293), glyph at [MiscPanel.ts:562-571](../src/typescript/MiscPanel.ts#L562-L571), table with column spec at [MiscPanel.ts:204-256](../src/typescript/MiscPanel.ts#L204-L256)) are leaves — migrate them too for consistency, even where the build is cheap. Migration is a small refactor: move the body of the action listener into a factory.

Before:
```typescript
let win2 = new Window("blaah!");
win2.setX(50); win2.setY(200); win2.setWidth(800); win2.setHeight(600);
// ... build tableStore, tablePanel ...
win2.addComponent(tablePanel);
win2.show();
```

After:
```typescript
let win2 = new Window("blaah!");
win2.setX(50); win2.setY(200); win2.setWidth(800); win2.setHeight(600);
win2.setContentFactory(() => {
    // ... build tableStore, tablePanel ...
    return tablePanel;
});
win2.show();
```

### Step 8 — Verification (see Verification section below)

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — lazy `cssRule`, sweep direct `cssRule.style` writes to batched path |
| Modify | [src/typescript/lib/primitive/Border.ts](../src/typescript/lib/primitive/Border.ts) — `applyOnCSSRule` → `toStyle` |
| Modify | [src/typescript/lib/primitive/BorderLine.ts](../src/typescript/lib/primitive/BorderLine.ts) — `applyOnCSSRule` → `toStyle` |
| Modify | [src/typescript/lib/component/input/Text.ts](../src/typescript/lib/component/input/Text.ts) — `measurementDirty` flag, lazy `calculateSize` |
| Modify | [src/typescript/lib/core/Animation.ts](../src/typescript/lib/core/Animation.ts) — add `materialize` helper |
| Modify | [src/typescript/lib/layout/Tab.ts](../src/typescript/lib/layout/Tab.ts) — async materialization, `state` field, spinner placement |
| Modify | [src/typescript/lib/core/Window.ts](../src/typescript/lib/core/Window.ts) — `setContentFactory`, spinner mount in `show()` |
| Modify | [src/typescript/MiscPanel.ts](../src/typescript/MiscPanel.ts) — migrate slow window callers to `setContentFactory` |

---

## Verification

1. **Type-check**: `npx tsc --noEmit` produces no new errors above the baseline.
2. **Build**: `npx vite build` succeeds.
3. **Tier 1 — no stylesheet inserts during construction**: in DevTools, snapshot `document.styleSheets[0].cssRules.length`, run `new ComplexUIPanel()` from the console without attaching, snapshot again — counts should match. Attach via `body.addComponent(panel)` — count grows on the next paint.
4. **Tier 1 — no forced-layout reads during construction**: DevTools Performance recording around `new MiscPanel()` and `new ComplexUIPanel()` shows zero `Recalculate Style` / `Layout` events between construction start and end. The reads reappear during the first `doLayout` (i.e. after attach), as expected.
5. **Tier 1 — `grep` invariants**:
   - `grep -rn "cssRule\.style" src/typescript/lib/` → only `ensureCSSRule` and `commitCSSRule` match.
   - `grep -n "this\.calculateSize()" src/typescript/lib/component/input/Text.ts` → no match inside the constructor (the call inside `ThemeManager.onThemeChange` is fine — it fires later).
6. **Tab interactivity** in `npm run dev`:
   - First paint: tab strip is rendered immediately. The initial `MiscPanel` tab transitions from spinner to content after the two-rAF yield. Spinner is briefly visible.
   - Click `"Complex"` (the heaviest tab): tab button selection updates instantly. Spinner appears in the content area. After the panel builds, content fades in over the spinner. Spinner disappears. Subsequent clicks back to `"Complex"` are instant (cached on `entry.component`).
   - Spam-click `"Tab"` → `"MenuBar"` → `"Tab"` while a build is in flight: no double-build (guarded by `state === "building"`).
7. **Tab keyboard nav**: ArrowRight through unvisited tabs materializes each in turn, with spinner appearing in the content area for each. No frozen frames.
8. **Window with `setContentFactory`** (slow table case): clicking "Show window with table (slow)!" produces an instant window-open animation; the content area shows a spinner during the scale-in; after the build, the table fades in over the spinner.
9. **Window without `setContentFactory`** (image case): existing inline `addComponent` path is unchanged. No spinner is shown — the image element is the only child from the first frame.
10. **Reduced motion**: enable `prefers-reduced-motion: reduce` in DevTools. Spinner appears, factory runs after the two rAFs, content swap is instant (no fade). Spinner is removed in the same tick the content lands.
11. **Layout sizing**: `Tab.getPreferredSize` / `getMinSize` / `getMaxSize` no longer trigger factory invocations. Verify by clicking a never-visited tab while watching DevTools Performance — no synchronous panel construction during a window resize.
12. **Per [CLAUDE.md](../CLAUDE.md)**: run `graphify update . --directed` after the implementation lands.
13. **Docs**: `npm run docs:build` — 0 errors and 0 link warnings (the lone acceptable warning is typedoc's pre-existing "unsupported TypeScript version" notice). The new `Window.setContentFactory` and `Animation.materialize` must surface in their respective API pages.

---

## Documentation Impact

- `Animation.materialize` is exported from the `Animation` namespace in `~/core/Animation.ts`. The `core` barrel already re-exports the `Animation` namespace, so no barrel change is needed. The TypeDoc entry point picks up the new function automatically.
- `Window.setContentFactory` is a new public method on `Window`. The `core` barrel already exports `Window`. The TypeDoc class page will pick up the method from JSDoc; add a `@remarks` block explaining the spinner-yield-fade lifecycle and reference [`Animation.materialize`](../src/typescript/lib/core/Animation.ts) via the cross-bucket markdown-link form: `[\`Animation.materialize\`](/api/core/functions/Animation.materialize)`.
- `Tab.addLazyTab` JSDoc ([Tab.ts:407-430](../src/typescript/lib/layout/Tab.ts#L407-L430)) needs an updated `@remarks` paragraph stating that materialization is now asynchronous and a spinner is shown during the build.
- No symbol renames or removals — no stale-link sweep required.

---

## Potential Challenges

- **`Border.applyOnCSSRule` inversion ripple**: changing the helpers from "mutate the passed rule" to "return a `Style` map" touches every call site that invokes them. The set is small (`setBorder`/`clearBorder`/`setBorderRadius` in `Component.ts`, plus any in primitive renderers) but must be swept in one PR — half-converted helpers leave a class of writes still bypassing the batched path. Audit with `grep -rn "applyOnCSSRule\|applyOnCssRule" src/typescript/lib/`.
- **Order-sensitive CSS writes**: a few sites set a property and later remove it (e.g. `setShadow` / `clearShadow`). The `dirtyCSSRule` map is keyed by property name, so a later `null` write correctly overwrites an earlier value. No ordering hazard. Confirm by reading `setElementCSSRule` semantics ([Component.ts:540-548](../src/typescript/lib/core/Component.ts#L540-L548)) before sweeping.
- **`measure()` semantics on detached `Text`**: callers (tests, manual layout) that build a `Text` and immediately call `measure()` or `getPreferredSize()` still trigger the probe — Tier 1b doesn't break them, it just shifts the timing for the *automatic* path. Document in the JSDoc that `getPreferredSize` on a detached `Text` now performs the probe lazily.
- **Tab `doLayout` placing the spinner vs the visible component**: today the layout loop hides every component and shows only `getVisibleComponent()`. With the spinner-as-visible-component scheme, the spinner wrapper is in `container.getComponents()` during the build; on `onReady` the real component is added (so the container has *both* until the spinner wrapper is removed). The hide-all loop at [Tab.ts:501-505](../src/typescript/lib/layout/Tab.ts#L501-L505) and the visible-component show at [Tab.ts:531-532](../src/typescript/lib/layout/Tab.ts#L531-L532) work as long as `getVisibleComponent` returns the right one — but `placeComponent` is called only on the visible one, so the other stays at whatever position/size it was last given. Acceptable because the spinner wrapper is removed in `onReady` before the next layout pass commits.
- **Spam-click race**: user clicks lazy tab A, then lazy tab B before A's factory runs. Both rAF chains fire. A's spinner is in A-host (the container) but A is no longer selected; B mounts its own spinner. Result: two spinner wrappers in the container, only B is "visible". The selected-index check in `materializeAsync`'s `onReady` (`if (this.selectedTabIndex !== idx) { ... still install but don't fade }`) lets A complete silently while B remains the user-visible work. The completed-but-unselected component is fine — next time the user clicks A, it's already cached.
- **Container that doesn't support multiple children**: `Body` accepts arbitrary children. Not a concern for the Tab case. For the Window case, `Window` extends `Panel` extends `Component` — same `addComponent` path. The window's header is a `Placement.NORTH` border-layout child; the spinner is added without placement (defaults to CENTRE), which is the slot the real content will occupy.
- **Spinner ARIA**: `ProgressSpinner` already sets `role="status"` and `aria-label="Loading"` ([ProgressSpinner.ts:107-108](../src/typescript/lib/component/display/ProgressSpinner.ts#L107-L108)). Screen readers announce "Loading" when the spinner appears; no extra wiring needed.
- **`Animation.play` clobbering the spinner's inline opacity**: the spinner's element style is untouched; only the *new content's* element gets opacity transitions. No conflict.
- **Cancellation on window close mid-build**: if the user closes the window before the factory completes, `onExitAction` triggers the close animation and destructor. The pending rAF callback still fires and calls `host.addComponent(component)` on a detached host. Mitigation: in `materialize`, check `host.getElement() === null || host.isDestroyed?.()` (if such a flag exists) inside the inner rAF before running the factory; if so, bail and call `onReady` with a no-op. Confirm whether `Component` exposes a destroyed flag before relying on this; if not, the existing destructor path is tolerant of late `addComponent` calls because the element is already gone (the new child is added to a detached subtree and GC'd with the parent).

---

## Critical Files

- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — `cssRule` field, ~30 direct `cssRule.style.X = ...` sites, `dirtyCSSRule` batched path, `commitCSSRule`
- [src/typescript/lib/core/CSS.ts](../src/typescript/lib/core/CSS.ts) — `createComponentRule` → `sheet.insertRule` on the live stylesheet
- [src/typescript/lib/component/input/Text.ts](../src/typescript/lib/component/input/Text.ts) — eager `calculateSize` call in constructor and font setters
- [src/typescript/lib/core/Util.ts](../src/typescript/lib/core/Util.ts) — `measureTextMetrics` (the forced-layout probe being deferred)
- [src/typescript/lib/primitive/Border.ts](../src/typescript/lib/primitive/Border.ts) / [BorderLine.ts](../src/typescript/lib/primitive/BorderLine.ts) — `applyOnCSSRule` callers to invert into `toStyle`
- [src/typescript/lib/core/Animation.ts](../src/typescript/lib/core/Animation.ts) — pattern for two-rAF + transitionend-with-fallback
- [src/typescript/lib/core/Window.ts](../src/typescript/lib/core/Window.ts) — entrance animation lives at lines 175-180; new factory path runs concurrently
- [src/typescript/lib/layout/Tab.ts](../src/typescript/lib/layout/Tab.ts) — existing lazy infrastructure (`addLazyTab`, `materialize`, `TabEntry`)
- [src/typescript/lib/component/display/ProgressSpinner.ts](../src/typescript/lib/component/display/ProgressSpinner.ts) — instance API and theme tokens
- [src/typescript/MiscPanel.ts](../src/typescript/MiscPanel.ts) — slow window callers to migrate
- [plans/implemented/lazy-panel-construction.md](implemented/lazy-panel-construction.md) — the prior plan whose API we are extending; reread before touching `TabEntry`

---

## Non-Goals

- **True off-thread component construction**: factories still run on the main thread. The Tier 1 deferrals make the factory body JS-only (no stylesheet inserts, no forced layout) so the main-thread block shrinks to object allocation; together with the spinner pause, this is the practical equivalent of "off-thread" for user-perceived responsiveness. Web Workers / OffscreenCanvas measurement / Constructable Stylesheets are explicitly out of scope.
- **`DocumentFragment` wrappers**: superseded by Tier 1 — once construction doesn't touch the DOM, a fragment buys nothing.
- **Chunked / generator-based factories**: factories remain synchronous and run in one block after the yield. A future plan can introduce a generator API if specific panels become too slow to build in a single tick.
- **Preloading lazy tabs in the background after idle**: the current scheme only builds on user activation. A "warm next tab during idle" enhancement is out of scope; it would interact with `requestIdleCallback` and rate-limiting heuristics that this plan deliberately avoids.
- **Spinner customisation per call site**: the spinner is a default `ProgressSpinner` with no size/colour overrides. Per-site theming can be added later via a `MaterializeConfig.spinnerComponent` override (already in the signature, but the demo doesn't exercise it).
- **Animating the spinner's removal**: the spinner disappears the moment the content's fade-in completes. A cross-fade where the spinner fades *out* while the content fades in is a polish item; in practice the brief overlap during the content's opacity transition reads as a fade from the user's perspective.
