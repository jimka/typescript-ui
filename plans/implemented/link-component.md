# Link Component — Implementation Plan

## Overview

Add a standalone `Link` component to the library — a focusable, keyboard-activatable text link whose **hit area is exactly its text** — then **rewrite [`LinkCellRenderer`](src/typescript/lib/component/table/cell/renderer/Link.ts#L45) to use it**. One implementation, one place the link look lives. Two components kept in visual sync by convention is exactly the drift this work exists to remove.

`Link` is built on [`Text`](src/typescript/lib/component/input/Text.ts#L99), rendering a real `<a>` via the inherited `tag` option — **not** on `Button`, whose padding and content row leave its click target larger than the glyph bounds even with `compact: true`. `Text` calls `clearInsets()` ([Text.ts:142](src/typescript/lib/component/input/Text.ts#L142)) and sizes itself from an off-screen text probe, so its box *is* the glyph box.

Because `Link extends Text`, the renderer's `_text: Text` field holds a `Link` unchanged, `getText(): Text` keeps its exact contract, and the inherited `setAutoMeasure(false)` / `setLineHeight` machinery still applies. A new `interactive` option — with a **typed `setInteractive` / `isInteractive` pair**, per ARCHITECTURE.md's three non-negotiable rules — drops the `role` + `tabindex` and makes the keydown handler inert, for the cell case where `Table` owns keyboard nav and click routing.

Also touched: `Aria` ([Aria.ts](src/typescript/lib/core/Aria.ts)) gains `'link'` on `AriaRole` **and a new `clearRole()`**, the `component/input` barrel gains the export, and [`MiscPanel.ts`](src/typescript/MiscPanel.ts#L202) gains a demo row.

**Every claim below was verified against the real tree by building a throwaway prototype in a worktree** — including a full `npm run test` (206 files / 2425 tests, all green) with the rewritten renderer in place, and an end-to-end keydown driven through the real window-capture route. The findings are recorded inline; the prototype was reverted.

---

## Architecture Decisions

### One implementation: `LinkCellRenderer` composes a real `Link`

The renderer swaps its inner `new Text(...)` for `new Link(..., { interactive: false })`. The colour, underline, and cursor live in `Link` alone and the renderer inherits them by construction — there is no second copy to drift. Consequently **no shared style-constants module is created**: an earlier draft proposed `component/shared/linkStyle.ts` to hold the colour/underline literals for two independent implementations. With one implementation, it has no remaining reason to exist. Do not create it.

This works because `Link` **IS-A** `Text`. Verified, not assumed:

- **Type assignability** — `const t: Text = new Link("x")` and a `getText(): Text` returning a `Link` both typecheck clean. This is not obvious: `Text` is generic (`Text<TOptions extends TextOptions = TextOptions>`) and `Link extends Text<LinkOptions>`, so assignability to `Text<TextOptions>` is a real question. It compiles.
- **`instanceof`** — `new Link("x") instanceof Text` is `true` (the `callable()` Proxy forwards `[[Construct]]` via `Reflect.construct`, so the prototype chain resolves). This is **load-bearing**: `CellRenderer.doLayout` gates its vertical-centring on `if (!(child instanceof Text)) return this;` ([CellRenderer.ts](src/typescript/lib/component/table/cell/renderer/CellRenderer.ts)) and then calls `child.setLineHeight(h)`. A `Link` child keeps that path.
- **Inherited `Text` API** — `setAutoMeasure(false)` and `setLineHeight(px)` are available on `Link` and behave identically.

### `interactive` flag: wire the listener once, gate with `tabIndex` + a handler guard

`LinkOptions` gains `interactive?: boolean` (default `true`). When `false`, the link has **no `role` and no `tabindex`**, and its keydown handler returns immediately.

The keydown listener is wired **once, unconditionally, in the constructor** and never touched again. `setInteractive` does **no listener work** — it toggles `role` + `tabIndex` only. `handleKeyDown` self-guards with `if (!this.isInteractive()) return;`. `dispose()` removes the listener unconditionally.

**Why this is safe** (verified against the real dispatcher): `Event`'s `baseListener` resolves its target with `listeners.get(DOM.source.getId(intern(evnt.target)))` ([Event.ts:107-118](src/typescript/lib/core/Event.ts#L107)) — a component's listener fires **only when its own element is the event target**. A no-`href` `<a>` with no `tabindex` is not focusable, so it can never be `document.activeElement` and can never receive a keydown; and `Text` renders a single element with no descendants ([Text.ts:1272](src/typescript/lib/component/input/Text.ts#L1272)), so there is no descendant-target path either. A non-interactive link's listener is **inert, not stranded** — it costs one map entry and is never invoked.

**The handler guard is not redundant with that.** Without it, correctness rests on the non-local invariant *"non-focusable ⇒ never targeted"*, which lives in the browser's focus model rather than in this class. With it, `Link` is **locally correct** even if something focuses it another way (a `tabindex` set by other code, a programmatic `.focus()`, a future `href`). Verified load-bearing: with the guard deleted, a keydown delivered to a non-interactive link **does** activate it (test rows 7 and 12 fail).

Rejected alternatives:

- **Churn the listener inside `setInteractive`** (add on `true`, remove on `false`). This works — an earlier draft did it and passed — but it is strictly more machinery for no gain: it needs an idempotence guard (`Event.addListener` has no dedupe; without one, `setInteractive(true)` twice made a single Enter fire **three** times) *and* a matching conditional teardown. Wiring once makes double-registration **unrepresentable** rather than merely guarded-against, and deletes both.
- **Clear `tabIndex` post-construction from the renderer** (`getAria().setTabIndex(null)`). Rejected: it puts the knowledge that a cell link must not be focusable in the *caller*, so every future presentational consumer must remember it. The option keeps it in one place.

**On precedent — churn-in-a-setter is _not_ a new pattern here, so that is not the reason to avoid it.** [`Panel.setScrollShadows`](src/typescript/lib/core/Panel.ts#L349) → `refreshScrollShadows` → `installScrollShadows` / `removeScrollShadows` adds and removes a `"scroll"` listener exactly that way ([Panel.ts:668](src/typescript/lib/core/Panel.ts#L668), [Panel.ts:726](src/typescript/lib/core/Panel.ts#L726)), guarded by a `_shadowScrollHandler` null-check whose own comment calls it *"the wire-once rule"*. (Every other `Event.removeListener` in the library does sit in an `off()` or a `dispose()`/`destroy()`.) The choice here therefore rests on simplicity, not novelty: `Panel` *must* churn because its listener has a real cost when inactive — `scroll` fires continuously and it owns an overlay element to tear down. `Link`'s keydown listener on a non-focusable element is provably never invoked, so churn buys it nothing.

**`interactive` genuinely belongs on the `XOptions` bag** under ARCHITECTURE.md:151's test ("consumer-configurable properties only"): `LinkCellRenderer` is a real consumer of the non-interactive mode, and display-only links are a legitimate consumer need beyond it (any read-only rendering of link-styled text). It is not framework bookkeeping, a runtime cache, or derived state.

**`role` is dropped in non-interactive mode too.** A non-focusable `role="link"` is a lie to assistive technology: it announces an affordance the user cannot take — the cell's text is already announced by the enclosing `gridcell`, and the real affordance is the Table's `"cellclick"`. Interactive links keep `role="link"` because an `<a>` **without `href` has no implicit link role** (it maps to `generic`), so it must be stated explicitly. `role` and `tabIndex` move together in `setInteractive` because both describe the one affordance.

### `interactive` gets a typed setter — the missing setter was the defect, not a constraint

An earlier draft hit a real bug (`{ interactive: false }` silently produced `tabindex="0"`) and designed around it by reading the raw `options` parameter in the constructor. That was wrong: it is exactly the call site ARCHITECTURE.md:149 forbids — *"Constructors route through the setter too. **Add the setter if it doesn't exist.**"* The correct shape is the one the architecture already mandates, and it fixes the bug at its cause.

The underlying mechanic is still worth knowing, because it is what makes the *always-dispatch* form mandatory rather than stylistic: `Component`'s constructor sets `this._options = {} as TOptions` ([Component.ts:450](src/typescript/lib/core/Component.ts#L450)) — the bag **starts empty**. The caller's options object is never copied in; it is only dispatched through `applyOptions`, and each *setter* writes its own value. So a field whose `applyOptions` dispatch is gated `if (options.interactive !== undefined)` never fires for the default, and `_options.interactive` stays `undefined`.

The three rules resolve to:

- **Rule 149 (typed setter)** — `setInteractive(value: boolean)` owns both effects; nothing else touches ARIA or the listener.
- **Rule 150 (cache in memory)** — `interactive` maps 1:1 onto its `LinkOptions` field with no normalisation, so **`_options` is the cache**: `setInteractive` writes `this._options.interactive`, `isInteractive()` reads it. **No `_interactive` backing field.** This is not merely tidier — a `private _interactive = …` field initializer would run *after* `super()` and clobber the value the cascade wrote, the exact trap CODE_CONVENTIONS.md's *"Fields written during the `super()` cascade must use `declare`"* describes. Using `_options` (a `Component` field, assigned before `applyOptions` runs) sidesteps it entirely, so no `declare` is needed either.
- **Rule 206 (always-dispatch)** — the effect is construction-time with no render re-read, so `applyOptions` must call `this.setInteractive(options.interactive ?? this.isInteractive())`. **Never** `if (options.interactive !== undefined)` alone; that is precisely the bug above.

`interactive: true` therefore goes in `_defaultLinkOptions` and `isInteractive()` folds it (`_options.interactive ?? _defaultOptions.interactive ?? true`), so the always-dispatch `?? this.isInteractive()` resolves the class default. Per ARCHITECTURE.md:210 that earns a row in the default-resolution registry.

### The keydown wiring lives in the constructor body, not `applyOptions`

With the wiring unconditional, it could go in either place — `applyOptions` (which runs inside `super()`) or the constructor body (after `super()` returns). **Put it in the constructor body**, next to `applyListeners`.

The reason is what each place is *for*, not safety: `applyOptions` exists to dispatch **option fields to their setters**. The keydown wiring is now structural — it happens for every `Link` regardless of any option — so it does not belong in an options cascade. Keeping `applyOptions` to exactly one line (`setInteractive(...)`) also keeps the always-dispatch rule legible.

Safety is not the discriminator, and this is worth recording so nobody re-litigates it: an earlier prototype wired keydown from `applyOptions` during `super()` and an Enter driven through the **real window-capture route** fired exactly once. `Event.addListener` needs only `component.getId()` — assigned by `BaseObject`'s constructor ([BaseObject.ts:16](src/typescript/lib/core/BaseObject.ts#L16)), which runs first — and never touches the element (it stores `{component, listener}` in a module map; the window handler resolves target → id at *dispatch* time). `this.handleKeyDown` is a prototype method, present from class-definition time. So either location works; the constructor body is chosen for clarity.

This is also why there is **no contradiction with ARCHITECTURE.md:17**: that rule defers the `listeners`-bag dispatch because a `ListenerBag` is a *subclass instance field* that does not exist until after `super()`. `Event.addListener` involves no instance field, so the hazard never applied to it.

`handleKeyDown` must be a **prototype method**, not an arrow field: `Event` binds `this` via `listener.apply(component, …)` ([Event.ts:116](src/typescript/lib/core/Event.ts#L116)), and the stable reference is what lets `dispose()`'s `Event.removeListener` find it by `indexOf`. An arrow field would yield a new reference per read and silently fail to unregister.

### No idempotence guard in `setInteractive` — it has nothing to guard

`setInteractive` needs **no** `if (this._options.interactive === value) return this;` early-return. With the listener wired exactly once for the component's whole life, double-registration is **unrepresentable**, not merely defended against. The setter's remaining effects — `Aria.setRole` / `setTabIndex` / `clearRole` — are value-assignments that are naturally idempotent.

Verified: `setInteractive(true)` three times on a default link, and a `true → false → true` round trip, each fire Enter exactly once with no guard present.

(An earlier draft *did* need this guard, because it churned the listener in the setter — `Event.addListener` ends in a bare `listeners.push` with no dedupe, so without a guard `setInteractive(true)` twice made one Enter fire three times. Wiring once removes the failure mode rather than guarding it. Do not reintroduce the guard "for safety" — it would be dead code implying a hazard that no longer exists.)

### `foregroundColor` / `cursor` / `tag` are class defaults; the underline is a class-level CSS rule

The delivery paths differ, and mixing them up silently drops styling:

- `tag`, `foregroundColor`, `cursor` go in `_defaultLinkOptions` (the `subclassDefaults` bag, [Text.ts:121](src/typescript/lib/component/input/Text.ts#L121)). Safe **only because** `Component` resolves `tag` from `_defaultOptions` ([Component.ts:455-457](src/typescript/lib/core/Component.ts#L455)), and `getForegroundColor` / `getCursor` are key-presence-folding getters ([Component.ts:1785](src/typescript/lib/core/Component.ts#L1785), [Component.ts:1905](src/typescript/lib/core/Component.ts#L1905)) that `applyStyle` re-reads at render ([Component.ts:4049-4054](src/typescript/lib/core/Component.ts#L4049)). This is ARCHITECTURE.md's *"Class-level defaults must survive the getter"* → **fold-in-the-getter** case, already satisfied by the base. Bonus: `clearForegroundColor()` correctly suppresses the default.
- ~~`styleRules` **cannot** go in `subclassDefaults` … it must be merged into the options bag via the array-merge idiom.~~ **Superseded during implementation: the underline is not an option at all.** The premise held — `applyOptions` dispatches `styleRules` only from the caller's bag ([Component.ts:533](src/typescript/lib/core/Component.ts#L533)), never from `_defaultOptions`, and putting it in the defaults bag silently drops it (verified by mutation). But the conclusion was wrong: it asked which *bag* should carry the underline, when the underline is **constant styling, not per-instance state**. Every link is underlined; none varies. So it is a class-level `StyleRule` (`.Link { text-decoration: underline }`) beside the existing `.Link:focus-visible` rule, and the constructor collapses to `super(text, options, _defaultLinkOptions)`.

  This is better on three counts, not just tidier. It costs **one CSS rule per page** instead of one per link. It stops `styleRules` being used for something that owes a typed setter, cache and getter it has no use for (ARCHITECTURE.md:149-151). And it **fixes the caller-override defect** the audit found: the merge idiom appended `Link`'s rule *last*, so a caller's `{ suffix: "", textDecoration: "none" }` was silently clobbered — making the *"a consumer who wants it gone passes `styleRules`"* Non-Goal false. A caller's rule is id-scoped (`#<id>`, [StyleTarget.ts:169](src/typescript/lib/core/StyleTarget.ts#L169)) and an id outranks a class, so it now genuinely wins. Verified in a real browser: injecting the id-scoped rule flips `underline` → `none`.

  **The cost, recorded honestly:** the underline is no longer offline-observable. A module-level IIFE runs at *import* time, before any per-test sink exists — unlike `focusRing.ts`, whose rule is registered by a function a test can call. So the underline joins `.TextField:focus` and `.Link:focus-visible` as manual-verify. What the tests still pin is the *mechanism*: a caller's rule materialises id-scoped, and no instance-level underline is emitted.

Note the contrast with `interactive`: `foregroundColor` and `cursor` need **no** `applyOptions` dispatch for their defaults, because `applyStyle` re-reads their folding getters at every render — the *"fold it in the getter"* arm of ARCHITECTURE.md:206. `interactive`'s effect (ARIA + listener wiring) is applied once and never re-read, so it takes the other arm: **always-dispatch**. Same rule, opposite branch — which is why the two look different.

### `LinkCellRendererOptions.color` maps to `foregroundColor` — plain forwarding is correct

```typescript
this._text = new Link("", {
    interactive:     false,
    foregroundColor: options?.color,
});
```

No `?? LINK_COLOR` fallback and no conditional spread is needed, and this is verified by the **existing, unmodified** test that pins both branches. When `options?.color` is `undefined`, `applyOptions`'s `if (options.foregroundColor !== undefined)` gate skips the setter, `_options` never gains the key, and the folding getter returns `Link`'s class default — the exact literal the old code inlined. When `color` is supplied, the setter writes it and the getter returns it.

### Build on `Text`, render a real `<a>`, hit area = glyph box

`Text` defaults `tag: "span"` ([Text.ts:62](src/typescript/lib/component/input/Text.ts#L62)); `Link` supplies `tag: "a"` through `subclassDefaults`, keeping it a true *fallback* so a caller passing `tag` still wins (verified: `new Link("x", { tag: "span" }).getTag() === "span"`). Do **not** copy `Label`'s older inline-merge idiom (`tag: options?.tag ?? "label"`, [Label.ts:43](src/typescript/lib/component/input/Label.ts#L43)) — `subclassDefaults` is the mechanism `Text` now provides.

### No `href` — the Link is always JS-activated

`Link` takes **no `href`**. Activation is exclusively `on("action", fn)`.

1. **The driving use case is in-app navigation** (open a tab), not URL navigation. CLAUDE.md *Simplicity First* forbids configurability that wasn't requested.
2. **Supporting both would fork every mechanism in the class.** With an `href` the `<a>` is natively focusable — so `setTabIndex(0)` must be skipped; and Enter fires a **native** click — so the synthetic click below would **double-fire** and the keydown wiring must be skipped. Two focus models and two activation models branching on one optional string, for zero consumers.
3. **Adding it later is purely additive** — set the attribute, skip the tabIndex + keydown wiring. Nothing here has to be undone.

### Keyboard: Enter only, via `Event.addListener`

- **Enter only.** Space is button semantics; the WAI-ARIA link pattern activates on Enter. A no-`href` `<a>` fires no native click on Enter, so the click is synthesised — and with no `href` it can never double-fire.
- **`Event.addListener`, not `addSubtreeListener`.** `Text` renders one element and writes `textContent` into it ([Text.ts:1272](src/typescript/lib/component/input/Text.ts#L1272)) — no descendant elements, so keydown always targets the `<a>` itself, which is what `addListener`'s exact-target match resolves. `addSubtreeListener` ([Event.ts:316](src/typescript/lib/core/Event.ts#L316)) is for components with inner DOM; wrong here.
- The handler is a **plain prototype method**, not an arrow field. `Event` invokes listeners as `listener.apply(compFunc.component, [evnt])` ([Event.ts:116](src/typescript/lib/core/Event.ts#L116)), so `this` is bound for us; a prototype method also yields a stable reference so `removeListener` in `dispose()` matches. Satisfies ARCHITECTURE.md *"Listeners must reference a named function"*.

### No double-activation in a table cell — `click()` sugar is inert without a listener

**The load-bearing fact: `Link.on("action", fn)` is a thin wrapper over `Event.addListener(this, "click", fn)`. It registers nothing at construction.** A `Link` with no registered `"action"` listener has **no click plumbing of its own** — `Link` never calls `preventDefault`, never calls `stopPropagation`, and never registers a click listener unless a consumer asks for one. `click()` merely fires the DOM event; with no listener registered it is a no-op (verified: it does not throw and nothing observable happens).

Therefore, in a cell: **the renderer must register no `"action"` listener** (it doesn't — it only constructs the `Link` and calls `setAutoMeasure(false)`), the click passes straight through to the Table's `"cellclick"` routing exactly as it did when the child was a plain `Text`, and nothing fires twice. The `interactive: false` mode additionally means no keydown listener exists to compete with `Table`'s RovingTabIndex.

### `click()` / `on` / `off` mirror `Button` exactly

`Link.on("action", fn)` wraps `Event.addListener(this, "click", fn)`; `click()` wraps `Event.fireEvent(this, "click")` — the same typed semantic DOM shorthand `Button` uses ([Button.ts:1458](src/typescript/lib/component/button/Button.ts#L1458), [Button.ts:1494](src/typescript/lib/component/button/Button.ts#L1494)). Routing Enter through `this.click()` gives keyboard and mouse one shared path, so an `"action"` handler fires once either way. Per ARCHITECTURE.md this is sugar over the DOM surface — **no `ListenerBag`, no `emit`** — because `Event.addListener` already multiplexes per component id. `ClickListener` is reused from `Button.ts` via a **type-only** import (erased at build; no runtime coupling from `component/input` back to `component/button`).

### `listeners` bag, wired unguarded

`LinkOptions` carries `listeners?: { action?: ClickListener }`, dispatched by `this.applyListeners(options?.listeners)` from the **constructor body** after `super()` returns ([Component.ts:596](src/typescript/lib/core/Component.ts#L596)). Unlike `Button` ([Button.ts:531](src/typescript/lib/component/button/Button.ts#L531)), the call is **not** prototype-guarded: that guard exists because `Button` has subclasses wiring their own bags. `Link` has none. If a subclass is ever added, the guard must be added with it.

### Focus ring: `:focus-visible`, the first in the codebase

The repo's existing focus rules use `:focus` ([TextInput.ts:25-34](src/typescript/lib/component/input/TextInput.ts#L25), [AbstractSelectableList.ts:191](src/typescript/lib/component/list/AbstractSelectableList.ts#L191)) — correct for text inputs, where a mouse-focus ring is wanted. For a **link** it is wrong: clicking would leave a persistent ring after activation. `Link` uses `:focus-visible`, the first use in this codebase — a deliberate, flagged deviation. The *mechanism* is identical (module-level `StyleRule`, `scope: "selector"`, in an IIFE); only the pseudo-class differs.

A plain `outline` is used rather than the `::after` ring from [focusRing.ts](src/typescript/lib/component/input/focusRing.ts): that trick exists for **composite** inputs painting a ring on outer chrome, and is overkill for a leaf `<a>` that focuses itself. The ring reuses `2px solid var(--ts-ui-indicator-focus, rgb(30, 100, 200))` for consistency.

The `.Link` selector depends on `constructor.name` — verified `new Link("x").constructor.name === "Link"`, and both [`vite.config.ts:48-49`](vite.config.ts#L48) and [`vite.lib.config.ts:68-69`](vite.lib.config.ts#L68) set terser `compress.keepNames` / `mangle.keepNames`, so it survives minification like every other component's rule.

### `Text`'s generics do not complicate the callable pattern

`class Link extends Text<LinkOptions>` **fixes** `TOptions`, so `Link` is non-generic and the callable alias is the plain form used by `Label` ([Label.ts:95-100](src/typescript/lib/component/input/Label.ts#L95)):

```typescript
const LinkCallable = callable(Link);
type LinkCallable = Link;                 // NOT type LinkCallable<T> = ...
```

Do **not** copy `Text`'s generic alias ([Text.ts:1279](src/typescript/lib/component/input/Text.ts#L1279)) — that exists only because `Text` stays generic for subclasses to fix.

### Placement: `component/input/Link.ts`, exported through the existing barrel

`Link` lives beside `Text.ts` and `Label.ts` in `src/typescript/lib/component/input/`, exported via the existing [`component/input/index.ts`](src/typescript/lib/component/input/index.ts) barrel and the already-published `@jimka/typescript-ui/component/input` subpath.

Rejected: `component/link/Link.ts` — a new directory needs a new `vite.lib.config.ts` entry ([vite.lib.config.ts:31](vite.lib.config.ts#L31)), a new `package.json` `exports` subpath, and a new `index.ts`: a whole bundle for one class that *is* a `Text` subclass. The filename does not collide — the renderer at `component/table/cell/renderer/Link.ts` is a different path exporting a differently-named symbol (`LinkCellRenderer`), so TypeDoc resolution stays unambiguous.

**Import direction check:** `component/table` already imports from `component/input` (`CellRenderer.ts` imports `Text`), so the renderer importing `Link` adds no new cross-entry dependency direction.

---

## Public API

New file `src/typescript/lib/component/input/Link.ts`:

```typescript
export type LinkEvent = "action";

export interface LinkOptions extends TextOptions {
    /**
     * When `false`, the link is presentational: no `role`, no `tabindex`, and
     * no keyboard activation. Defaults to `true`.
     */
    interactive?: boolean;

    /** Construction-time listener bag — the declarative form of `on("action", fn)`. */
    listeners?: { action?: ClickListener };
}

class Link extends Text<LinkOptions> {
    constructor(text?: String, options?: LinkOptions);

    /** Whether this link is focusable and keyboard-activatable. */
    isInteractive(): boolean;

    /**
     * Toggles `role="link"` and `tabindex="0"` together. Does no listener
     * work — the keydown handler is wired once and self-guards.
     */
    setInteractive(value: boolean): this;

    on(event: "action", listener: ClickListener): this;
    off(event: "action", listener: ClickListener): this;

    /** Fires this link's own `"click"`, running every `"action"` handler. */
    click(): this;

    /** Removes the keydown listener, then the inherited theme listener. */
    dispose(): void;

    protected applyOptions(options: LinkOptions): this;
    private handleKeyDown(event: KeyboardEvent): void;
}

const LinkCallable = callable(Link);
type LinkCallable = Link;
export { Link as _Link, LinkCallable as Link };
```

State-bearing property routing (for `/implement`'s call-site check):

| Option field | Setter | Getter | Cache |
|---|---|---|---|
| `LinkOptions.interactive` | `setInteractive(value)` | `isInteractive()` | `this._options.interactive` — **no backing field** |

`isInteractive()` follows this repo's boolean-accessor convention — `isTruncate()` ([Text.ts:1105](src/typescript/lib/component/input/Text.ts#L1105)), `isEnabled()` ([Button.ts:2434](src/typescript/lib/component/button/Button.ts#L2434)) — not `getInteractive()`.

Modified `src/typescript/lib/core/Aria.ts` — **two** additions:

```typescript
export type AriaRole =
    /* … */
    | 'button'
    | 'link'        // ADDED
    /* … */;

class Aria {
    /** Removes the `role` attribute. The null companion to setRole. */
    clearRole(): this;   // ADDED
}
```

`clearRole()` is required, not incidental: `setRole(role: AriaRole)` accepts **no `null`** and `Aria` has no clear companion for it, so `setInteractive(false)` has no way to drop the role without it. It mirrors the existing `clearLabel()` ([Aria.ts:738](src/typescript/lib/core/Aria.ts#L738)) exactly, and the machinery already supports it — `applyAriaAttribute(name, null)` routes to `removeElementAttribute` ([Component.ts:3689](src/typescript/lib/core/Component.ts#L3689)), and `applyToElement` already skips a `null` `_role`.

`LinkCellRendererOptions` is **unchanged** (`color?: string`), and so is `LinkCellRenderer`'s public surface (`getText(): Text`, `getValue()`, `setValue()`).

---

## Internal Structure

`Link.ts` — the load-bearing parts:

```typescript
/**
 * The link foreground colour. `--ts-ui-link-color` lets a theme retint every
 * link at once; the literal is the shipped fallback.
 */
const LINK_COLOR_CSS = "var(--ts-ui-link-color, rgb(21, 101, 192))";

// Module-level focus ring. `:focus-visible` (not `:focus`, as the inputs use)
// so a mouse click doesn't leave a ring on the link after activation.
// Passing `styles` to the StyleRule constructor auto-`ensure()`s it.
(() => {
    new StyleRule({
        scope:  "selector",
        name:   ".Link:focus-visible",
        styles: {
            outline:       "2px solid var(--ts-ui-indicator-focus, rgb(30, 100, 200))",
            outlineOffset: "1px",
        },
    });
})();

// `tag`/`foregroundColor`/`cursor` are pure fallbacks: Component resolves `tag`
// from `_defaultOptions` (Component.ts:455) and `applyStyle` re-reads the two
// folding getters at render, so all three survive without being dispatched.
// `interactive` is here so the always-dispatch `?? this.isInteractive()` in
// applyOptions resolves the class default (ARCHITECTURE.md:206).
// `styleRules` must NOT be added here — applyOptions never reads it from the
// defaults bag (Component.ts:533).
const _defaultLinkOptions: Partial<LinkOptions> = {
    tag:             "a",
    foregroundColor: LINK_COLOR_CSS,
    cursor:          "pointer",
    interactive:     true,
};

// NO `_interactive` backing field: `_options` is the cache
// (ARCHITECTURE.md:150). A field initializer here would run after super() and
// clobber what the applyOptions cascade wrote.

constructor(text?: String, options?: LinkOptions) {
    super(
        text,
        {
            ...(options ?? {}),
            styleRules: [
                ...(options?.styleRules ?? []),
                { suffix: "", styles: { textDecoration: "underline" } },
            ],
        },
        _defaultLinkOptions,
    );

    // Wired ONCE for the component's whole life, regardless of `interactive`.
    // handleKeyDown self-guards, so the flag needs no listener churn — and a
    // non-interactive link can never be a keydown target anyway (not
    // focusable; Event dispatches by evnt.target). dispose() removes it.
    Event.addListener(this, "keydown", this.handleKeyDown);

    // Constructor body per ARCHITECTURE.md:17 — never in applyOptions.
    this.applyListeners(options?.listeners);
}

protected applyOptions(options: LinkOptions): this {
    super.applyOptions(options);

    // ALWAYS-dispatch (ARCHITECTURE.md:206): the effect is construction-time
    // with no render re-read, so the default must fire too. Gating this on
    // `if (options.interactive !== undefined)` is the documented bug — the
    // default would never apply role/tabindex.
    this.setInteractive(options.interactive ?? this.isInteractive());

    return this;
}

isInteractive(): boolean {
    return this._options.interactive ?? this._defaultOptions.interactive ?? true;
}

/**
 * Toggles the link's interactive affordance. `role` and `tabindex` move
 * together because both describe the one affordance. No listener work: the
 * keydown handler is wired once in the constructor and reads isInteractive().
 *
 * No idempotence guard needed — Aria's setters are value-assignments, and the
 * listener is never re-registered.
 */
setInteractive(value: boolean): this {
    this._options.interactive = value;

    if (value) {
        // An <a> with no href is neither focusable nor exposed as a link, so
        // both are supplied explicitly.
        this.getAria().setRole("link").setTabIndex(0);
    } else {
        // A presentational link claims neither: it can't be activated, and the
        // gridcell already announces the text.
        this.getAria().clearRole().setTabIndex(null);
    }

    return this;
}

/**
 * Activates on Enter only — Space is button semantics, not link semantics.
 * A no-href <a> fires no native click on Enter, so it is synthesised here;
 * because there is no href, it can never double-fire.
 *
 * The isInteractive() guard keeps this locally correct rather than relying on
 * the non-local "non-focusable => never targeted" invariant.
 *
 * A prototype method, not an arrow field: Event binds `this` via
 * listener.apply(component, …), and the stable reference is what lets
 * dispose()'s removeListener find it.
 */
private handleKeyDown(event: KeyboardEvent): void {
    if (!this.isInteractive()) {
        return;
    }

    if (event.key !== "Enter") {
        return;
    }

    event.preventDefault();
    this.click();
}

dispose() {
    // Unconditional — the listener is always registered.
    Event.removeListener(this, "keydown", this.handleKeyDown);
    super.dispose();
}
```

`LinkCellRenderer` — the only change to its body:

```typescript
this._text = new Link("", {
    // Presentational: the Table owns keyboard nav (RovingTabIndex) and routes
    // clicks through its own "cellclick" event, so the link must not take tab
    // focus or wire its own keyboard handling.
    interactive:     false,
    // `undefined` is gated out by applyOptions, so an unset `color` falls
    // through to Link's class default — the same colour as before.
    foregroundColor: options?.color,
});
// Renderer Texts opt out of auto-measure — the host cell force-sizes them.
this._text.setAutoMeasure(false);
this.addComponent(this._text);
```

The `private readonly _text: Text;` field declaration **stays `Text`**, not `Link` — the renderer's contract is `getText(): Text` and nothing in it needs `Link`'s surface.

---

## Ordered Implementation Steps

1. **Extend `Aria`** in [`src/typescript/lib/core/Aria.ts`](src/typescript/lib/core/Aria.ts#L12) — two edits:
   - Insert `| 'link'` into `AriaRole` immediately after `| 'button'` (line 25).
   - Add `clearRole()` directly after `getRole()` (line 115-117), mirroring `clearLabel()` (line 738):
     ```typescript
     clearRole(): this {
         this._role = null;
         this._component.applyAriaAttribute("role", null);

         return this;
     }
     ```

2. **Create `src/typescript/lib/component/input/Link.ts`** per *Public API* + *Internal Structure*. Imports: `Text`, `TextOptions` from `~/component/input/Text.js`; `Event` from `~/core/Event.js`; `StyleRule` from `~/core/StyleTarget.js`; `callable` from `~/core/Callable.js`; and **`import type { ClickListener } from "~/component/button/Button.js";`** (type-only — a value import would couple the bundles).
   - Check: `npx tsc -p tsconfig.lib.json --noEmit` → clean. (Step 1 must land first, or `setRole("link")` and `clearRole()` fail to typecheck.)

3. **Export through the barrel** — in [`src/typescript/lib/component/input/index.ts`](src/typescript/lib/component/input/index.ts), directly after the two `Label` lines:
   ```typescript
   export { Link } from '~/component/input/Link.js';
   export type { LinkOptions, LinkEvent } from '~/component/input/Link.js';
   ```
   No `vite.lib.config.ts` or `package.json` change — `component/input` is already an entry point.

4. **Rewrite `LinkCellRenderer`'s constructor** ([`src/typescript/lib/component/table/cell/renderer/Link.ts`](src/typescript/lib/component/table/cell/renderer/Link.ts#L50)) per *Internal Structure*. Add `import { Link } from "~/component/input/Link.js";` and replace the `new Text("", {...})` call. Keep the `Text` import (the `_text` field and `getText()` return type still use it), keep `setAutoMeasure(false)`, keep `addComponent`. Update the class JSDoc: it now composes `Link` in presentational mode; keep the existing "does not handle the click itself / pair with `cellclick`" paragraph, which is still exactly true. Update `LinkCellRendererOptions.color`'s JSDoc (line 15) to describe the default in prose without repeating the literal.
   - Check: `grep -rn 'rgb(21, 101, 192)' src/typescript/lib/` → **exactly one** match, in `component/input/Link.ts`.
   - Check: **run the existing `tests/component/table/CustomRenderer.test.ts` unmodified** → all 9 pass. Do **not** edit those 9 tests.

5. **Do NOT create `component/shared/linkStyle.ts`.** With one implementation there is nothing to share. If a `linkStyle.ts` exists in your tree, it is from a stale draft — delete it.

6. **Register the class defaults** in [`tests/component/default-options-fallback.test.ts`](tests/component/default-options-fallback.test.ts#L147). ARCHITECTURE.md requires a row per defaulted field, because a dropped default is invisible to the offline harness. Add to the registry array (~lines 147-186):
   ```typescript
   { label: 'Link tag',             resolve: () => new Link().getTag(),             expected: 'a' },
   { label: 'Link foregroundColor', resolve: () => new Link().getForegroundColor(), expected: 'var(--ts-ui-link-color, rgb(21, 101, 192))' },
   { label: 'Link cursor',          resolve: () => new Link().getCursor(),          expected: 'pointer' },
   { label: 'Link interactive',     resolve: () => new Link().isInteractive(),      expected: true },
   ```
   `interactive` **does** get a row — it is now a `_defaultLinkOptions` field, and ARCHITECTURE.md:210 requires one per defaulted field.

7. **Write `tests/component/input/Link.test.ts`** covering every unit-testable row in *Expected Behaviour*. Model it on [`tests/component/input/Label.test.ts`](tests/component/input/Label.test.ts) (`installTestDOM` + the `lastSetAttr` helper). **Read the *Test-harness constraint* box below first** — it determines the file's whole shape, and ignoring it produces tests that pass alone and fail in sequence.

8. **Add the three new renderer rows** (R1-R3 below) to the existing `describe('LinkCellRenderer')` block in `tests/component/table/CustomRenderer.test.ts`. Append only — do not touch the 9 existing cases.

9. **Add the demo row to `MiscPanel.ts`.** Add `Link` to the existing `@jimka/typescript-ui/component/input` import block ([MiscPanel.ts:49-59](src/typescript/MiscPanel.ts#L49)) between `DateTimeField` and `NumberSpinner`. Insert the row **immediately after `rightColumn.addComponent(iconTextRow);` ([MiscPanel.ts:1321](src/typescript/MiscPanel.ts#L1321))** — the `IconText`/`IconLabel` neighbourhood is where the text-with-affordance display demos live. `Component`, `HBox`, `Text` and `Notification` are already imported.

   ```typescript
   // Link: the hit area is exactly the text. The HBox row is load-bearing —
   // it sizes the link to its preferred (natural) width; a stretching parent
   // would widen the box and the hit area with it.
   const linkRow = new Component();
   linkRow.setLayoutManager(new HBox());
   linkRow.addComponent(new Text("Link:"));
   linkRow.addComponent(new Link("Open the release notes", {
       listeners: { action: () => Notification.show("Link actioned — click and Enter both land here.", "info") },
   }));
   rightColumn.addComponent(linkRow);
   ```

   MiscPanel uses inline arrow listeners throughout; ARCHITECTURE.md's named-function rule governs library component internals, and *Surgical Changes* says match local style. Keep the arrow.

10. **Documentation** — see `## Documentation Impact`.

11. **Verify** — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/input/Link.ts` |
| Create | `tests/component/input/Link.test.ts` |
| Create | `docs/components/Link.md` |
| Modify | `src/typescript/lib/core/Aria.ts` (add `'link'` to `AriaRole`; add `clearRole()`) |
| Modify | `src/typescript/lib/component/table/cell/renderer/Link.ts` (compose `Link`) |
| Modify | `src/typescript/lib/component/input/index.ts` (barrel export) |
| Modify | `tests/component/default-options-fallback.test.ts` (three registry rows) |
| Modify | `tests/component/table/CustomRenderer.test.ts` (**append** R1-R3; existing 9 untouched) |
| Modify | `src/typescript/MiscPanel.ts` (import + demo row) |
| Modify | `docs/.vitepress/config.mts` (sidebar entry) |
| Modify | `docs/components/index.md` (catalog row) |
| Modify | `scripts/llms/manifest.data.mjs` (capability row) |
| Modify | `llms.txt` (regenerated, committed) |
| **Not created** | ~~`src/typescript/lib/component/shared/linkStyle.ts`~~ — no second implementation to share with |

---

## Expected Behaviour

### Regression: `LinkCellRenderer`'s observable behaviour must not change

Its internals genuinely change, so this is the blast radius. **[`tests/component/table/CustomRenderer.test.ts`](tests/component/table/CustomRenderer.test.ts) already covers all of it and its 9 existing cases must pass byte-for-byte unmodified** (verified against a prototype — all 9 pass):

| Existing test | Pins |
|---|---|
| `caches null and renders empty for a fresh renderer` | `getValue() === null`, `getText().getText() === ''` |
| `renders its value as link text and round-trips it through getValue` | `setValue('orders')` → both |
| `normalises null / undefined to null and renders empty` | `null` **and** `undefined` → `null` |
| `tints the link text (default link colour, overridable)` | `getText().getForegroundColor() === 'var(--ts-ui-link-color, rgb(21, 101, 192))'`; `{ color: 'rgb(1, 2, 3)' }` → `'rgb(1, 2, 3)'` — **this is what pins `color` → `foregroundColor`** |
| `routes through ColumnConfig.renderer to a display-only cell` | `getEditorKey() === null`, value pushed on construction |

Add these **new** rows to that same `describe` block:

| # | Behaviour |
|---|---|
| R1 | `new LinkCellRenderer().getText()` is `instanceof Link` **and** `instanceof Text` — the composition happened, and `CellRenderer.doLayout`'s `child instanceof Text` gate still passes. |
| R2 | The inner link is presentational: `(r.getText() as Link).isInteractive() === false`, `getText().getAria().getTabIndex() === null`, `getText().getAria().getRole() === null`. This is the cell-must-not-take-tab-focus contract. (The link *does* carry a keydown listener — wired unconditionally — but with no `tabindex` it can never be a keydown target, and `handleKeyDown` returns early regardless. Do not assert the listener's absence.) |
| R3 | The renderer registers no `"action"` listener, so a cell click reaches `Table`'s `"cellclick"` and nothing fires twice. Assert `r.getText().getElement(true)` then `(r.getText() as Link).click()` produces no renderer-side effect (`getValue()` unchanged, no throw); the "registers nothing" half is by inspection of the constructor body. |

### ⚠️ Test-harness constraint: every listener must be unregistered between tests

**Read this before writing `Link.test.ts`.** `Link` is the first component in this repo to be unit-tested through the real window-capture event route, and that route has a module-state leak that will waste hours if you meet it blind. Discovered by prototype:

`Event`'s `installedListenerTypes` is a **module-level `Set`** ([Event.ts:39](src/typescript/lib/core/Event.ts#L39)) that survives `DOM.reset()`. `installBaseListener` skips `DOM.sink.addListener(window, …)` when the type is already in that Set — but `installTestDOM` mints a **fresh window handle and a fresh sink with no listeners**. So the *second* test in a file that uses a given event type registers into `listenerMap`, finds no window handler on the new sink, and **silently receives nothing**.

The symptom is brutal: a test passes with `it.only` and fails in sequence, reporting `0` calls. It affects **both** `"keydown"` and `"click"` — verified: three identical `on('action') + click()` tests in one file gave pass, fail, fail.

**The fix, verified:** drive every event type's listener count to zero at the end of each test. `Event.removeListener` calls `uninstallBaseListener` once the last listener for a type goes ([Event.ts:267](src/typescript/lib/core/Event.ts#L267)), so the next test re-installs cleanly. Use a teardown registry:

```typescript
let made: Array<() => void> = [];
beforeEach(() => { installTestDOM(CONFIG); made = []; });
afterEach(() => { for (const t of made) t(); DOM.reset(); });

/** Mounts a link, registers an action spy, and schedules full unregistration. */
function wire(link: Link) {
    const fn = vi.fn();
    link.getElement(true);
    link.on('action', fn);
    made.push(() => { link.off('action', fn); link.dispose(); });   // BOTH — click + keydown
    return fn;
}

/** Routes a real keydown through the window-capture path. */
function pressKey(link: Link, key: string): void {
    Event.fireEvent(link, makeEvent(link.getElement(true)!, 'keydown', { key }) as any);
}
```

`makeEvent` is exported from `tests/dom/TestDOM.ts` ([line 1187](tests/dom/TestDOM.ts#L1187)) and accepts `{ key }`. Both halves of the teardown are required: `off` releases `"click"`, `dispose` releases `"keydown"`. This is why [`ComboBox.test.ts:17-18`](tests/component/input/ComboBox.test.ts#L17) calls its handler directly and calls the real route "manual-verify" — with the teardown discipline above, the real route *is* testable, and rows 10-14 below depend on it.

### Unit-testable — new `Link` (`tests/component/input/Link.test.ts`, `installTestDOM`)

| # | Behaviour |
|---|---|
| 1 | `new Link("Docs")` then `.getElement(true)` records a `createElement` write with tag `"a"`; `getTag() === "a"`. *(verified)* |
| 2 | The same link records `setAttr` `role: "link"` and `tabindex: "0"`. *(verified via `getAria()`)* |
| 3 | `new Link("x", { tag: "span" }).getTag() === "span"` — the class default is a fallback, not forced. *(verified)* |
| 4 | `new Link("x").getForegroundColor() === 'var(--ts-ui-link-color, rgb(21, 101, 192))'` and `.getCursor() === "pointer"`. *(verified)* |
| 5 | `new Link("x", { foregroundColor: "rgb(1, 2, 3)" }).getForegroundColor() === "rgb(1, 2, 3)"` — caller beats the default. *(verified)* |
| 6 | `new Link("x").clearForegroundColor().getForegroundColor() === null` — an explicit clear suppresses the default (key-presence getter). |
| 7 | **A non-interactive link never activates.** `new Link("x", { interactive: false })` → `isInteractive() === false`, `getAria().getTabIndex() === null`, `getAria().getRole() === null`, and `pressKey(link, "Enter")` fires **nothing**. This is the load-bearing row: it pins both the always-dispatch forward (an `if (options.interactive !== undefined)` gate leaves role/tabIndex applied) **and** the `handleKeyDown` guard. *(verified: fails on both counts without them)* |
| 8 | `new Link("x")` → `isInteractive() === true`, tabIndex `0`, role `'link'` — the class default fires through always-dispatch. *(verified)* |
| 9 | **Superseded** (the underline is a class-level rule, not an instance rule). Split in two: a caller's `styleRules` entry is still dispatched, and **no** instance-level underline is emitted; and a caller rule materialises **id-scoped** (`#<id>`), which is what lets it outrank `.Link`. The underline itself is manual-verify — see the note in *Architecture Decisions*. |
| 10 | **Enter activates.** `pressKey(link, "Enter")` runs the `"action"` spy **exactly once**. *(verified)* |
| 11 | **Space does not.** `pressKey(link, " ")` — and `"a"`, `"Escape"` — fires nothing. Space is button semantics. *(verified)* |
| 12 | **`true → false` drops the affordance.** `setInteractive(false)` on a default link → `getTabIndex() === null`, `getRole() === null`, and `pressKey(…, "Enter")` fires nothing. *(verified: the Enter half fails without the `handleKeyDown` guard)* |
| 13 | **`false → true` restores it.** On a `{ interactive: false }` link → `getTabIndex() === 0`, `getRole() === 'link'`, Enter fires **once**. *(verified)* |
| 14 | **Repeat calls are harmless.** `setInteractive(true)` three times on a default link → Enter still fires **exactly once**. Pins that wiring-once makes double-registration unrepresentable. *(verified)* |
| 15 | **Round trip.** `setInteractive(false)` then `setInteractive(true)` → Enter fires exactly once. *(verified)* |
| 16 | `link.on("action", fn)` then `link.click()` (mounted) runs `fn` once; after `off`, `click()` does not. |
| 17 | `new Link("x", { listeners: { action: fn } })` mounted + `click()` runs `fn` once — the bag equals `on()`. |
| 18 | `new Link("x")` mounted, **no** listener registered → `click()` does not throw and has no observable effect — the sugar is inert. *(verified — this is why a cell's click can't double-fire)* |
| 19 | `new Link("x").click()` **unmounted** throws (inherited `Event.fireEvent` contract, same as `Button`) — pin it, don't guard it. |
| 20 | `dispose()` on a `{ interactive: false }` link does not throw — teardown is unconditional and the listener is always present. *(verified)* |
| 21 | `new Link("Docs").getText() === "Docs"` — the positional arg survives the 3-arg `super`. *(verified)* |
| 22 | `new Link("x").constructor.name === "Link"` — the `.Link:focus-visible` selector depends on it. *(verified)* |
| 23 | `new Link("x") instanceof Text === true`. *(verified)* |

Rows 7 and 10-18 need the `wire()` / `pressKey()` helpers and the teardown registry from the box above.

**What rows 7 and 12 do and don't prove.** `pressKey` *forces* the link's element to be the event target, which a real browser would never do for a non-focusable element. So these rows verify the **`handleKeyDown` guard** — the component's local correctness — not the "non-focusable ⇒ never targeted" invariant. The offline harness has no focus model, so that invariant is **manual-verify** (check 7 below). This is the right split: the guard is what the code owns, the invariant is what the platform owns.

### Manual verification (`npm run dev` → **Misc.** tab, right column)

The harness cannot exercise these: the real window-capture keydown route is explicitly manual-verify in this repo ([ComboBox.test.ts:17-18](tests/component/input/ComboBox.test.ts#L17)), and focus, geometry, and paint have no offline model.

1. **Tab order** — Tab reaches the link and it takes focus.
2. **Focus ring** — appears on Tab focus; does **not** appear after a mouse click (what `:focus-visible` buys over `:focus`).
3. **Enter activates** — the notification appears. **Space does not.**
4. **Click activates** — the notification appears, exactly once.
5. **Hit area is exactly the text** — the pointer cursor appears only over the glyphs; hovering 3-4px above/below/left/right shows the default cursor and clicking does nothing. Compare against `Button({ compact: true })`, whose target visibly overshoots its label — the whole reason for the component.
6. **Link cells** — **superseded during implementation: a link column was added.** The plan was right that no demo table used `LinkCellRenderer` (its only in-repo consumers were the barrel, `ColumnConfig`'s JSDoc, and the test) but wrong to forbid adding one, because that contradicted check 7 below: the invariant that a cell link is inert is explicitly *not* unit-testable, yet check 7 punted its only verification to a different repo on an unmerged branch. The renderer — the half of this change that alters shipped behaviour — would have had no in-repo browser coverage at all. `MiscPanel`'s spec table already demoed `"cellclick"`, the seam the renderer pairs with, so a `Manager` column (`renderer: () => new LinkCellRenderer()`) now exercises it. **Check in the Misc. tab → the window-with-table-spec button:** Manager cells render as links; clicking one reports through the existing `cellclick` status bar; Carol's null Manager renders empty and still reports; and Manager is the one column that never enters edit mode, since a custom-rendered cell carries no editor.
7. **The non-focusable invariant** (the one the unit tests deliberately cannot reach). Now checkable in-repo via the Manager column from check 6: Tab must never land on a link cell's text, and pressing Enter while a link cell is *selected* must trigger only the Table's own handling — never a second activation from the cell's inner `Link`. This is the real-browser check that a non-interactive link is never a keydown target. The same check applies to sqladmin's StructurePanel FK grid once this merges, but no longer depends on it.

---

## Verification

```bash
npx tsc -p tsconfig.lib.json --noEmit      # must be clean; needs step 1 (AriaRole) first
npm run test                               # typecheck:test + vitest run — 206 files / 2425 tests green before this change
npm run build:lib                          # NOT `npm run build` — sqladmin consumes the built dist/lib via symlink
npm run docs:build                         # must finish with ZERO warnings (CODE_CONVENTIONS.md)
```

**Lint — read this before reporting a failure.** `npm run lint` (`eslint src`) **already fails on master** with exactly one pre-existing error, in the very file this plan edits:

```
src/typescript/lib/component/table/cell/renderer/Link.ts
  51:9  error  super() drops the constructor's "options" parameter … local/forward-super-options
```

`LinkCellRenderer`'s `super()` legitimately takes no arguments (`CellRenderer`'s constructor has none), so the rule is a false positive here. **Expect exactly that one error, at a line number shifted by the added import — and no others.** Do not "fix" it by passing `options` to `super()`; that would not compile. Do not add a disable comment either — leaving pre-existing lint state untouched is what *Surgical Changes* requires.

Grep invariants:

```bash
grep -rn 'rgb(21, 101, 192)' src/typescript/lib/          # expect exactly 1 — component/input/Link.ts
grep -rn 'ts-ui-link-color'  src/typescript/lib/          # expect exactly 1 — component/input/Link.ts
grep -rn 'textDecoration: "underline"' src/typescript/lib/ # expect exactly 1 — component/input/Link.ts
grep -rn 'linkStyle' src/typescript/lib/                   # expect ZERO — the shared module is not created
```

Targeted regression run:

```bash
npx vitest run tests/component/table/CustomRenderer.test.ts   # 9 existing + 3 new, all green
npx vitest run tests/component/input/Link.test.ts
```

Manual smoke test: `npm run dev`, **Misc.** tab, right-hand column, the row labelled `Link:` — walk manual checks 1-5.

---

## Documentation Impact

`Link` is exported from the `component/input` barrel → published at `@jimka/typescript-ui/component/input`, documented at `/api/component/input/classes/Link`.

1. **Create `docs/components/Link.md`.** Follow [`docs/components/Text.md`](docs/components/Text.md)'s shape (intro + `## Usage` + `## Common methods`). Must state: the hit area is exactly the text (and that a stretching parent widens it); there is no `href` — activation is `on("action")`; Enter activates, Space does not; `interactive: false` yields a presentational link (and that `LinkCellRenderer` is the shipped example); and `dispose()` must be called before removal. Cross-reference `Text`, `Button`, and `LinkCellRenderer` in the `/components/X` link form.
2. **`docs/.vitepress/config.mts`** — add `{ text: 'Link', link: '/components/Link' },` to the `Display` group, immediately after the `Text` entry ([line 112](docs/.vitepress/config.mts#L112)).
3. **`docs/components/index.md`** — add a row to the `## Display` table after the `Label` row ([line 74](docs/components/index.md#L74)):
   `| [`Link`](/components/Link) | Clickable text link — hit area is exactly the text; activates on click or Enter |`
4. **`scripts/llms/manifest.data.mjs`** — add `{ task: "Clickable text link that activates in-app (click / Enter)", symbol: "Link" },` to the `"Inputs / Forms"` section ([lines 52-72](scripts/llms/manifest.data.mjs#L52)). No `doc:` key — `generate.mjs` auto-derives `docs/components/${symbol}.md`. No `subpath:` key — `Link` resolves uniquely (`LinkCellRenderer` is a different symbol name).
5. **Regenerate `llms.txt`** via `npm run docs:llms` (or the full `npm run docs:build`) and commit it — the root copy is committed; `docs/public/llms.txt` is gitignored.
6. **`ColumnConfig.renderer`'s JSDoc** ([ColumnConfig.ts:176-181](src/typescript/lib/component/table/ColumnConfig.ts#L176)) already describes `LinkCellRenderer` + `"cellclick"` correctly and needs **no** change — the composition is an implementation detail.
7. **JSDoc constraint** — CODE_CONVENTIONS.md forbids `{@link}`-ing private/protected/`@internal`/non-exported symbols from public JSDoc. `LINK_COLOR_CSS` is a module-private constant, so describe the colour token **in prose**; do not `{@link}` it. `Link` itself *is* exported, so `LinkCellRenderer`'s JSDoc **may** `{@link Link}`. Violating the former fails `npm run docs:build`.
8. **No doc page for `LinkCellRenderer`** exists (it appears in neither `docs/` nor `llms.txt`) — no page to update.

---

## Potential Challenges

- **Gating `interactive`'s dispatch on `!== undefined` silently breaks the default.** `_options` starts empty ([Component.ts:450](src/typescript/lib/core/Component.ts#L450)) and only setters populate it, so `if (options.interactive !== undefined) this.setInteractive(...)` never fires for a plain `new Link("x")` — no role, no tabIndex. Use the always-dispatch form (`this.setInteractive(options.interactive ?? this.isInteractive())`, ARCHITECTURE.md:206). Test rows 7-8 are the guard.
- **Do not omit the `if (!this.isInteractive()) return;` guard in `handleKeyDown`.** It is what makes a non-interactive link inert *locally*, rather than relying on the browser never targeting a non-focusable element. Verified: deleting it makes rows 7 and 12 fail.
- **Do not add listener churn to `setInteractive`, and do not add an idempotence guard to it.** The listener is wired once; both would be dead machinery implying a hazard that cannot occur.
- **Do not add a `_interactive` backing field.** `_options` is the cache (ARCHITECTURE.md:150). A `private _interactive = …` initializer runs *after* `super()` and would clobber the value the `applyOptions` cascade wrote — the `declare` trap from CODE_CONVENTIONS.md. Using `_options` avoids needing `declare` at all.
- **The `Link.test.ts` event-route leak** — see the *Test-harness constraint* box in `## Expected Behaviour`. Tests that pass with `it.only` and fail in sequence are this, not a product bug.
- **A regression here reaches a real consumer.** sqladmin consumes this library through a **symlink to this working tree**, and its foreign-key grid uses the renderer today: `frontend/src/dock/StructurePanel.ts:393` — `{ field: "refTable", renderer: () => new LinkCellRenderer() }`. Its adoption of `Link` stays a Non-Goal, but `LinkCellRenderer` changing under it is not hypothetical. Run `npm run build:lib` and confirm sqladmin's StructurePanel FK links still render and still respond to `cellclick`.
- **The hit area only equals the text when the parent sizes the Link to preferred width.** A `Fit` parent, or `VBox`/`HBox` with `stretching: true`, widens the box and the hit area with it. `VBox`/`HBox` default `stretching: false`, so the demo row is safe — document the constraint in `Link.md` rather than defeating it in the component.
- **`Text`'s `truncate: true` default** caps `minSize.width` at 100px and sets `overflow: hidden` ([Text.ts:78](src/typescript/lib/component/input/Text.ts#L78), [Text.ts:1121](src/typescript/lib/component/input/Text.ts#L1121)), so a narrow parent ellipsises the link. Inherited `Text` behaviour and correct — do **not** override it to `false` (that is `Button`'s label-specific choice, to make the button grow).
- **The focus outline can be clipped** by an ancestor's `overflow: hidden` (the framework default) when the link sits flush against a container edge — the hazard [focusRing.ts:5-10](src/typescript/lib/component/input/focusRing.ts#L5) documents. `outlineOffset: "1px"` keeps the ring tight. If manual check #2 shows clipping, the fallback is the `::after` inset-ring pattern — do not reach for it pre-emptively.
- **`styleRules` in `subclassDefaults` is silently dropped** ([Component.ts:533](src/typescript/lib/core/Component.ts#L533)) — still true, and the reason the underline is a class-level rule rather than a default. Nothing in the library puts `styleRules` in a defaults bag, so the trap is latent; it is a `Component` wart (the bag is typed `Partial<TOptions>` but only getter-backed keys are honoured), not a `Link` one.
- **Pre-existing lint error in the renderer file** — see `## Verification`. Do not attribute it to this change and do not try to fix it.

---

## Critical Files

| File | Why |
|---|---|
| [`src/typescript/lib/component/input/Text.ts`](src/typescript/lib/component/input/Text.ts) | The base. Read the 3-arg constructor (L121), `_defaultTextOptions` (L61), `clearInsets()` (L142), `truncate` (L1121), `dispose` (L1260), the generic callable alias (L1278). |
| [`src/typescript/lib/component/input/Label.ts`](src/typescript/lib/component/input/Label.ts) | The in-repo `Text`-subclass template — non-generic callable alias. |
| [`src/typescript/lib/component/table/cell/renderer/Link.ts`](src/typescript/lib/component/table/cell/renderer/Link.ts) | The file being rewritten. Public surface must not move. |
| [`src/typescript/lib/component/table/cell/renderer/CellRenderer.ts`](src/typescript/lib/component/table/cell/renderer/CellRenderer.ts) | `doLayout`'s `child instanceof Text` gate + `setLineHeight` — the reason `Link extends Text` matters at runtime. |
| [`tests/component/table/CustomRenderer.test.ts`](tests/component/table/CustomRenderer.test.ts) | The regression contract. Its 9 cases must pass unmodified; three rows appended. |
| [`src/typescript/lib/core/Component.ts`](src/typescript/lib/core/Component.ts) | `_options = {}` (L450 — why always-dispatch is mandatory), `tag` resolution (L455), `_aria` field (L329), `ComponentStyleRuleSpec` + merge idiom (L82-97), `styleRules` dispatch (L533), `applyListeners` (L596), folding getters (L1785, L1905), `applyAriaAttribute` (L3689), `applyStyle` re-read (L4049). |
| [`tests/dom/TestDOM.ts`](tests/dom/TestDOM.ts) | `makeEvent` (L1187) and the modelled `dispatchEvent` → window-handler route the keyboard tests drive. |
| [`src/typescript/lib/component/button/Button.ts`](src/typescript/lib/component/button/Button.ts) | The `on`/`off`/`click`/`ClickListener`/`listeners`-bag pattern to mirror (L30, L37, L1458, L1475, L1494) and the guard **not** to copy (L531). |
| [`src/typescript/lib/core/Event.ts`](src/typescript/lib/core/Event.ts) | `addListener` (L226), `removeListener` (L267), `addSubtreeListener` (L316 — not used), `fireEvent` (L198), `listener.apply(component, …)` (L116) proving `this` is bound. |
| [`src/typescript/lib/core/Aria.ts`](src/typescript/lib/core/Aria.ts) | `AriaRole` union (L12-43), `setRole` (L103), `setTabIndex` (L124). |
| [`src/typescript/lib/component/input/TextInput.ts`](src/typescript/lib/component/input/TextInput.ts) | The module-level `StyleRule` IIFE pattern (L25-34) the focus rule copies. |
| `ARCHITECTURE.md`, `CODE_CONVENTIONS.md` | Binding. Especially *Event handling*, *All attributes and styles go through typed setters*, *Class-level defaults must survive the getter*, *Components are exported through `callable()`*. |

---

## Non-Goals

- **sqladmin adoption.** sqladmin has a hand-rolled `linkButton` — a `chromeless: true, compact: true` `Button` with an inline `var(--ts-ui-link-color, rgb(21, 101, 192))` — which is the review finding that prompted this component. Note it currently lives **only on sqladmin's unmerged `column-sequence-links` worktree branch** (`.worktrees/column-sequence-links/frontend/src/dock/SequenceInfoPanel.ts:116`), not in sqladmin's main tree; nothing in sqladmin `main` references `ts-ui-link-color`. Swapping it for the real component is a separate change in a separate repo. **This plan must not touch sqladmin.**
- **Sharing style constants between two link implementations.** Superseded: there is now one implementation. No `component/shared/linkStyle.ts`.
- **`href` / real URL navigation.** Decided against above; additive later if a consumer appears.
- ~~**A `Link` demo column in a demo-app table.**~~ **Reversed during implementation** — see manual-verify check 6. The stated reason ("adding one to exercise a refactor the unit tests already cover is scope creep") was false: the unit tests do *not* cover the non-focusable invariant, and this plan says so itself in check 7. A `Manager` column now demos `LinkCellRenderer` in `MiscPanel`'s spec table.
- **`:hover` and `:visited` states.** The permanent underline + pointer cursor already carry the affordance. `:visited` is meaningless without an `href`.
- **A separate `--ts-ui-link-underline` token.** An underline is not a theme colour; a consumer who wants it gone passes `styleRules`. (This was **false as first implemented** — the merge idiom clobbered such a rule — and is now true: the underline is a class-level rule and a caller's entry is id-scoped, so it wins on specificity. Verified in a browser.)
- **`disabled` state.** Not requested, and the semantics are non-obvious (drop `tabindex`? grey out? swallow the click?). Note `interactive: false` is **not** a disabled state — it is a presentational mode; a disabled link would also need a colour change and a blocked click.
- **`description` / tooltip.** `Button`'s `setDescription` exists for toolbar buttons; a link's accessible name is its text. A consumer wanting a tooltip composes `Tooltip`.
- **A new `component/link` bundle entry point.** Rejected above; `Link` ships through `component/input`.
