# Consolidate Button Subclasses — Implementation Plan

## Overview

Several button-shaped classes in the framework extend [`Component`](../src/typescript/lib/core/Component.ts) directly rather than [`Button`](../src/typescript/lib/component/button/Button.ts) — not because they want a different element or role, but because `Button`'s chrome defaults (ridge border, drop shadow, gradient background, `:active`/`:hover` style rules, fixed `Fit`+`HBox` content row) would clash with their visual or layout needs. The current workaround is to either reimplement the button shape from scratch ([`PickerButton`](../src/typescript/lib/component/input/PickerButton.ts), [`MenuBarButton`](../src/typescript/lib/component/menubar/MenuBarButton.ts), the file-local `ScrollArrowButton` in [`Scrollbar.ts`](../src/typescript/lib/component/container/Scrollbar.ts)) or to instantiate a `Button` and then strip the chrome post-construction ([`WindowHeader`](../src/typescript/lib/component/container/WindowHeader.ts) calls `.clearBorder()` on each of its three trailing buttons at [WindowHeader.ts:81,85,89](../src/typescript/lib/component/container/WindowHeader.ts#L81)).

This plan adds two opt-out flags to [`Button`](../src/typescript/lib/component/button/Button.ts) — `chromeless` (disable the visual chrome defaults) and `customLayout` (skip the Fit/HBox content row, validation and child plumbing) — and migrates the candidate classes that benefit from them. The four existing `Button` subclasses ([`ToggleButton`](../src/typescript/lib/component/button/ToggleButton.ts), [`TabCloseButton`](../src/typescript/lib/component/button/TabCloseButton.ts), [`SpinButton`](../src/typescript/lib/component/input/SpinButton.ts), [`AccordionHeader`](../src/typescript/lib/component/container/AccordionHeader.ts)) stay untouched: each carries enough specialised behaviour (sticky pressed state, hold-repeat scheduler, side-loaded accordion indicator) to warrant a subclass per the user's directive that "very specialized functionality on buttons … should be located in sub-classes".

The change is concentrated in [`Button.ts`](../src/typescript/lib/component/button/Button.ts); call-site impact is local to [`PickerButton.ts`](../src/typescript/lib/component/input/PickerButton.ts), [`MenuBarButton.ts`](../src/typescript/lib/component/menubar/MenuBarButton.ts), and [`WindowHeader.ts`](../src/typescript/lib/component/container/WindowHeader.ts).

---

## Architecture Decisions

### Verdict per candidate class

| Class | Verdict | Reason |
|---|---|---|
| [`Button`](../src/typescript/lib/component/button/Button.ts) | keep (host) | The host class; gains `chromeless` and `customLayout` options. |
| [`ToggleButton`](../src/typescript/lib/component/button/ToggleButton.ts) | **keep** | Adds a sticky `.selected:not(:hover)` rule, ARIA `aria-pressed`, and rewires `addActionListener` to the `change` event. The sticky toggle state is the user's named example of "specialized functionality" that belongs in a subclass. Out of scope. |
| [`TabCloseButton`](../src/typescript/lib/component/button/TabCloseButton.ts) | **keep** | Five lines of default-bag glue ([TabCloseButton.ts:25-49](../src/typescript/lib/component/button/TabCloseButton.ts#L25-L49)) baked over `Button`. Extending `Button` is already the right shape — there's no chrome conflict, just defaults. Out of scope per user directive: "not include specialized buttons that already inherit from the button class". |
| [`SpinButton`](../src/typescript/lib/component/input/SpinButton.ts) | **keep** | Owns a hold-repeat scheduler (initial 400 ms, ×0.75 decay, 40 ms floor — [SpinButton.ts:52-138](../src/typescript/lib/component/input/SpinButton.ts#L52-L138)) and chevron-glyph sizing. Specialised behaviour ≫ default bag. Out of scope. |
| [`AccordionHeader`](../src/typescript/lib/component/container/AccordionHeader.ts) | **keep** | Side-loads an [`AccordionIndicator`](../src/typescript/lib/component/container/AccordionIndicator.ts) child and owns `setExpanded` / `setAnimationTiming` plumbing. Structural specialisation. Out of scope. |
| [`PickerButton`](../src/typescript/lib/component/input/PickerButton.ts) | **fold → `extends Button`** | Custom `doLayout` that centres a single glyph child ([PickerButton.ts:33-57](../src/typescript/lib/component/input/PickerButton.ts#L33-L57)) — structural specialisation that warrants a subclass. The seven lines of constructor chrome-strip ([PickerButton.ts:20-25](../src/typescript/lib/component/input/PickerButton.ts#L20-L25)) collapse into `chromeless: true` + `customLayout: true`. |
| WindowHeader's exit / minimize / maximize buttons ([WindowHeader.ts:79-96](../src/typescript/lib/component/container/WindowHeader.ts#L79-L96)) | **fold → inline** `Button({ chromeless: true })` | Pure default-bag work — the only post-construction state today is `.clearBorder()` and a redundant `.setBackgroundImage(...)` call that re-applies the same default the `Button` already uses ([Button.ts:55](../src/typescript/lib/component/button/Button.ts#L55) vs [WindowHeader.ts:58](../src/typescript/lib/component/container/WindowHeader.ts#L58) — same `var(--ts-ui-button-bg, …)` literal). No structural specialisation; no named subclass needed. |
| [`MenuBarButton`](../src/typescript/lib/component/menubar/MenuBarButton.ts) | **fold → `extends Button`** | Specialised at the behavioural and ARIA level: sticky `setActive` highlight, menubar-specific ARIA (`role="menuitem"`, `aria-haspopup="menu"`, `aria-expanded`), mandatory `onClick`+`onHover` constructor callbacks, custom `:hover` `StyleRule`, fixed `MENU_BAR_BUTTON_HEIGHT = 28`. Reuses Button's standard content-row machinery — the menubar's only layout difference from a default Button is *west-alignment* of the glyph+text pair (vs Button's centred), which MenuBarButton achieves by re-adding `this._content` with `anchor: AnchorType.WEST` after `super` — so `customLayout: true` is **not** used. The text/glyph methods (`setGlyph` / `clearGlyph` / `getGlyph`) are inherited from Button unchanged. The menubar's fixed height comes from a single `computePreferredSize` override that pins the height to `MENU_BAR_BUTTON_HEIGHT` — Button's native auto-sizing pipeline handles the rest. Requires Button to expose `_content` as `protected` instead of `private` (the only Button visibility change in scope). |
| `ScrollArrowButton` (file-local in [Scrollbar.ts:95-261](../src/typescript/lib/component/container/Scrollbar.ts#L95-L261)) | **keep** | File-local class with a hold-repeat scheduler (same constants as `SpinButton` — [Scrollbar.ts:27-29](../src/typescript/lib/component/container/Scrollbar.ts#L27-L29)), `TRACK_WIDTH × TRACK_WIDTH` sizing, hover/disabled colour states. Extending `Button` would either require pulling the hold-repeat scheduler into `Button` (which the user explicitly wants in subclasses) or copy-pasting four lines of chromeless defaults that the class already inlines. Net code change is negligible, the class isn't exported, and a future plan should be the one to factor a shared `RepeatScheduler` across `SpinButton` and `ScrollArrowButton`. Documented here so the keep verdict is intentional, not an omission. |
| [`RadioButton`](../src/typescript/lib/component/input/RadioButton.ts) | **keep** | Extends `AbstractInput<boolean>`, custom-drawn ring + dot, `role="radio"`, `Bindable<boolean>` semantics, group coordination via [`ButtonGroup`](../src/typescript/lib/core/ButtonGroup.ts). Both visual surface and data surface are incompatible with `Button`. Out of scope. |

The two "fold → extends" rows (`PickerButton`, `MenuBarButton`) and the one "fold → inline" row (WindowHeader trailing buttons) are the entire consolidation scope.

### `chromeless: true` is a dispatch-time gate, not a defaults-bag swap

`Button`'s visual defaults at [Button.ts:48-64](../src/typescript/lib/component/button/Button.ts#L48-L64) bake the chrome consumers might want gone: `border`, `borderRadius`, `shadow`, `backgroundImage`, and the twelve `pressedX` / `hoverX` style-rule fields. A `chromeless?: boolean` flag is the minimal expression of "give me a `<button>` with the cursor + colour + insets defaults but none of the surrounding chrome".

The flag is implemented as a **dispatch-time gate**: `_defaultButtonOptions` stays as the only defaults bag, and chrome fields are kept in `_defaultOptions` even when `chromeless: true`. The override of `applyChromeOptions` (Component's new hook — see Internal Structure) checks the flag and skips the chrome dispatches when active. This is intentionally *not* a defaults-bag swap (which would mutate `_defaultOptions` and lose subclass-supplied chrome on toggle) and *not* a per-setter override (which would silently no-op explicit consumer `setBorder()` calls, violating the typed-setter contract).

A finer-grained API (`borderless`, `shadowless`, `backgroundImageOff`, …) would be six flags for one decision, and per-piece nulling (`border: null`, `shadow: null`) would require widening `ComponentOptions` types fan-out across the framework — not worth the surface area for a feature only the four consolidation targets need. Consumers that want partial chrome (e.g. WindowHeader could in theory want "no border but keep gradient and hover") can pass `chromeless: true` and then re-supply specific values (`backgroundImage: …, hoverShadow: …`). Today, none of the four targets actually want partial chrome — they want all of it gone.

### `customLayout: true` is the structural opt-out

The `Fit` layout and the `_content` HBox row at [Button.ts:163-181](../src/typescript/lib/component/button/Button.ts#L163-L181) bake a `[glyph, text]` child structure that a subclass which wants no content row at all (`PickerButton` centres a single glyph child added by `AbstractPickerField` subclasses; the row isn't useful) can't reuse. `customLayout?: boolean`, when true, skips the `setLayoutManager(new Fit())` call, doesn't build `_content` / `_text` / the text-only children, and relaxes the text/glyph validation at [Button.ts:142-150](../src/typescript/lib/component/button/Button.ts#L142-L150). The subclass is responsible for layout (`doLayout` override) and for adding any children via `addComponent` after `super()`.

A subclass that just needs to *re-anchor* Button's content row (rather than skip it entirely) — like `MenuBarButton`, which wants west-alignment instead of centred — should NOT use `customLayout: true`. Instead it removes and re-adds `this._content` with new constraints via the `protected _content` field, keeping Button's text/glyph machinery intact. `customLayout` is reserved for subclasses whose layout is genuinely incompatible with the content-row structure.

Passing `text` or `glyph` together with `customLayout: true` is a programmer error — the subclass has signalled it owns the children, so the supplied label or glyph has nowhere to land. The constructor throws when both are present (same fail-loud shape as the existing text/glyph validation).

### `Button` natively auto-sizes from its content row

A button with no consumer-supplied `preferredSize` should size itself to its content (glyph + text + insets), not stretch or report zero. Today every consumer that wants this either hand-computes a `preferredSize`, lets the parent layout pick something, or — in MenuBarButton's case — writes a private `recomputePreferredSize` helper. This is duplicate work for one of the most common button shapes.

The plan adds two `protected` methods on `Button`:

- `recomputePreferredSize(): void` — the auto-fire entry point. Reads a private `_consumerSetPreferredSize` flag (flipped to `true` the first time the consumer calls `setPreferredSize`); when false, calls `computePreferredSize()` and pushes the result via a flag-bypassing super call. When `customLayout: true`, this method is a no-op — the subclass owns its sizing.
- `computePreferredSize(): { width: number; height: number }` — the override point. Base implementation derives `{ content.width + insets.left + insets.right, content.height + insets.top + insets.bottom }` from `_content.getPreferredSize()`. Subclasses override to alter (typical case: replace the derived height with a fixed token, à la MenuBarButton's `MENU_BAR_BUTTON_HEIGHT`).

`recomputePreferredSize` auto-fires from:

1. The end of `Button`'s constructor (after the initial text/glyph dispatch).
2. `setGlyph` and `clearGlyph` (after the `_content` child list changes).
3. `setInsets` (overridden in Button to call super then `recomputePreferredSize`).
4. `ThemeManager.onThemeChange` (the font/glyph metrics can shift; the registered handler re-fires the recompute).

The auto-fire makes consumer-facing call sites just-work — `new Button("Save")` lands with a natural preferred size; no consumer code needed. Consumers who want a fixed size pass `preferredSize` in options (or call `setPreferredSize` post-construction); the `_consumerSetPreferredSize` flag flips and future auto-fires no-op. The subclass override path lets `MenuBarButton` collapse to just a `computePreferredSize` override that fixes the height to `MENU_BAR_BUTTON_HEIGHT`.

This is a behaviour change for *every existing* `Button` consumer that didn't pass an explicit `preferredSize` — they'll now report one. Most parent layouts honour `preferredSize` when present, so this could subtly resize buttons that previously stretched or used a layout-supplied size. The smoke pass in Verification specifically watches for this.

### Subclasses can layer their own chrome on top of the defaults bag — and it survives runtime toggles

`Button`'s constructor takes a third `subclassDefaults?: Partial<ButtonOptions>` argument ([Button.ts:127](../src/typescript/lib/component/button/Button.ts#L127)) that layers between Button's base defaults and the caller's options. The final merge is `{ ..._defaultButtonOptions, ...(subclassDefaults ?? {}), ...options }`, and the result is stored in `this._defaultOptions`. Three composition patterns drop out of this:

1. **Subclass keeps Button's default chrome, tweaks specific pieces** — omit `chromeless`; supply field-level overrides in `subclassDefaults`. The full chromeful bag flows through; the subclass's overrides win the merge. This is exactly the pattern [`TabCloseButton`](../src/typescript/lib/component/button/TabCloseButton.ts), [`SpinButton`](../src/typescript/lib/component/input/SpinButton.ts), and [`AccordionHeader`](../src/typescript/lib/component/container/AccordionHeader.ts) already use, unchanged by this plan.
2. **Subclass starts chromeless and supplies its own chrome** — pass `chromeless: true` in the synthesised super options *and* hand custom border / shadow / backgroundImage / pressedX / hoverX values in `subclassDefaults`. The subclass's chrome lives in `_defaultOptions`; the gate suppresses dispatch while `chromeless` is true. Note: under the gate semantics, "starts chromeless" means "rendered without chrome at construction" — the chrome is staged in `_defaultOptions` ready to be applied when the gate flips off. A subclass that genuinely wants no chrome ever, including post-`setChromeless(false)`, just leaves the chrome fields out of `subclassDefaults`.
3. **Subclass forces chromeless by default but lets the consumer opt out** — synthesize the super options as `{ chromeless: true, ...options }`. The consumer's spread wins last, so a caller passing `chromeless: false` opts the instance back into Button's full chrome (plus any chrome the subclass also put in its `subclassDefaults`). This is the [`MenuBarButton` refactor sketch's](#menubarbutton-refactor-sketch) pattern.

The composition works because `chromeless` is read by `applyChromeOptions` from the merged `opts` at every dispatch, and `_defaultOptions` is never mutated by the gate. A subclass that wants its own chrome is never blocked by the new flag, and crucially its chrome **survives runtime toggles**: `setChromeless(true)` clears the DOM via the `clear*` setters and flips the gate; `setChromeless(false)` flips the gate back and calls `restoreChrome`, which re-dispatches from `_defaultOptions` (including the subclass's chrome that's been sitting there untouched the whole time). Toggle as many times as you like — subclass intent is preserved.

A parent component that wants to flatten its `Button` children at insertion time (e.g. [`ToolBar.addComponent`](../src/typescript/lib/component/menubar/ToolBar.ts#L287-L299) override) can call `child.setChromeless(true)` directly instead of chaining the individual `clear*` setters; flipping the parent's intent back off (e.g. moving a button out of a toolbar) and calling `child.setChromeless(false)` restores whatever chrome the button originally had.

### Event listeners on a `Button` route through the component's named methods

External consumers must never call `Event.addListener(button, "click", …)` (or any other raw `Event.addListener` against a `Button` instance) — every event a consumer wants to listen to is the component's responsibility to expose via a named method, e.g. `addActionListener` for click. Bypassing the named-method surface couples the consumer to the component's DOM/event implementation, defeats the named-listener guarantee from [ARCHITECTURE.md](../ARCHITECTURE.md), and makes future event-routing changes inside the component break callers silently.

This plan enforces the rule at two sites:

- **`AbstractPickerField`** ([AbstractPickerField.ts:98-100](../src/typescript/lib/component/input/AbstractPickerField.ts#L98-L100)) currently bypasses the button with `Event.addListener(this._button, "click", …)` and `Event.addListener(this._button, "pointerdown", …)`. The click registration migrates to `this._button.addActionListener(() => this.onButtonClick())`. The `pointerdown` registration needs a new named method on `Button` — see "Public API" below — so the migration becomes `this._button.addPointerDownListener((e) => this.onButtonPointerDown(e))`.
- **WindowHeader** already routes through `Button.addActionListener` for its three trailing buttons ([WindowHeader.ts:276-302](../src/typescript/lib/component/container/WindowHeader.ts#L276-L302)) — no change needed.

The grep regression in Verification ensures no new `Event.addListener(<button>, …)` patterns slip in.

### Chrome opt-out is purely additive — no existing call-site changes

`chromeless` and `customLayout` both default to `undefined`/`false`. Every existing `Button` consumer (including the four kept subclasses) sees identical behaviour: defaults bag applied, Fit + HBox content row built, text/glyph validation enforced. The plan touches `Button.ts` once; it does not regress `ToggleButton`, `TabCloseButton`, `SpinButton`, `AccordionHeader`, or any direct `Button` consumer.

### Subclass vs inline — judged per case

Per the user's "mixed per-class" steer:

- **`PickerButton` → `extends Button`** because its `doLayout` is structural and the type signature is referenced by [`AbstractPickerField._button: PickerButton`](../src/typescript/lib/component/input/AbstractPickerField.ts#L58). Keeping the named class preserves the type and the one-element-per-class layering.
- **WindowHeader's trailing buttons → inline `Button({ chromeless: true })`** because there's no structural specialisation, the only state is `glyph` (literal per button) and click listeners (already on `addActionListener`), and WindowHeader already stores them as `Button` (not a subclass).
- **`MenuBarButton` → `extends Button`** because the sticky `setActive`, menubar-specific ARIA, mandatory dual callbacks, and custom `doLayout` are all named in [MenuBar.ts:147-161](../src/typescript/lib/component/menubar/MenuBar.ts#L147-L161). Inlining would either lose ARIA + callbacks (drops accessibility) or duplicate the same six lines of setup at every call site (currently one — but the named subclass clarifies intent).

### `dispose()` shape stays the same

[`MenuBarButton.dispose`](../src/typescript/lib/component/menubar/MenuBarButton.ts#L199-L202) removes its named click/mouseover listeners; that body carries over verbatim. `PickerButton` has no `dispose`; the `Button` host class has no `dispose`; nothing changes for either.

### Old class names are removed for the inline case only

WindowHeader's trailing buttons aren't a named exported class — they're three `Button` instances. Nothing to delete. `PickerButton` and `MenuBarButton` keep their export forms (`PickerButton` and `MenuBarButton`) and remain in their barrels — they're now `extends Button` instead of `extends Component`, but the names and call-site signatures stay.

---

## Public API (TypeScript Signatures)

### `Button` — new options

```typescript
export interface ButtonOptions extends ComponentOptions {
    // Existing fields — unchanged.
    text?:                   string;
    glyph?:                  string;
    enabled?:                boolean;
    pressedBackgroundColor?: string;
    pressedBackgroundImage?: string;
    pressedForegroundColor?: string;
    pressedBorder?:          BorderOptions;
    pressedBorderRadius?:    string;
    pressedShadow?:          string;
    hoverBackgroundColor?:   string;
    hoverBackgroundImage?:   string;
    hoverForegroundColor?:   string;
    hoverBorder?:            BorderOptions;
    hoverBorderRadius?:      string;
    hoverShadow?:            string;

    // Opt-out flags — new.
    chromeless?:             boolean;   // suppress visual-chrome defaults (border, borderRadius, shadow, backgroundImage, pressedX, hoverX)
    customLayout?:           boolean;   // skip Fit + content HBox; subclass owns layout and children
}
```

Four public-method additions on `Button` — a typed setter for `chromeless`, a named listener for `pointerdown`, and the auto-sizing pair:

```typescript
class Button<TOptions extends ButtonOptions = ButtonOptions> extends Component<TOptions> {
    // … existing surface …
    addActionListener(listener: Function): this;       // unchanged — listens to "click"
    addPointerDownListener(listener: Function): this;  // new — listens to "pointerdown"
    setChromeless(value: boolean): this;               // new — runtime toggle, mirrors the chromeless option
    isChromeless(): boolean;                           // new — reads _options.chromeless

    // New auto-sizing pair. Both protected — subclass extension surface, not consumer API.
    protected recomputePreferredSize(): void;          // gated on _consumerSetPreferredSize and customLayout; calls computePreferredSize
    protected computePreferredSize(): { width: number; height: number };  // override point; base derives from _content + insets
}
```

`setChromeless` and `isChromeless` follow the framework's typed-setter + options-bag-cache rule from [ARCHITECTURE.md](../ARCHITECTURE.md) — every configurable property gets a setter, and the cache lives on `_options`. The setter dispatches through `Component` / `Button`'s existing `clear*` and `set*` methods for the chrome properties; no new low-level seams. The `customLayout` flag deliberately gets no runtime setter — once `Button`'s constructor has built (or skipped) the `_content` / `_text` / Fit layout structure, the structural shape is fixed for the lifetime of the instance.

`addPointerDownListener`'s body matches `addActionListener`'s shape — one `Event.addListener(this, "pointerdown", listener)` line. The named method exists so external consumers (e.g. `AbstractPickerField`) no longer need to reach for raw `Event.addListener(button, …)`; see the "Event listeners on a `Button` route through the component's named methods" decision above.

`recomputePreferredSize` / `computePreferredSize` together give every `Button` a content-derived natural size out of the box (see "`Button` natively auto-sizes from its content row" in the Architecture Decisions). Subclasses override `computePreferredSize` only — the auto-fire wiring and the `_consumerSetPreferredSize` flag live entirely in `recomputePreferredSize` and `Button.setPreferredSize`, so subclass overrides never need to know about either.

`Button.setPreferredSize` is overridden to flip `_consumerSetPreferredSize = true` before delegating to super, so consumer-supplied sizes win over the auto-compute permanently (until the consumer clears it — out of scope for this plan). The two new flag fields (`chromeless`, `customLayout`) are read during the constructor and stored on `_options` per the options-bag-as-cache convention; `chromeless` is additionally writable post-construction via `setChromeless`.

### `PickerButton` — narrows from `Component` to `Button`

```typescript
class PickerButton extends Button {
    constructor();
    doLayout(): this;
}
```

Constructor calls `super({ chromeless: true, customLayout: true, cursor: "pointer", padding: new Insets(0, 4, 0, 4) })`. `doLayout` body is verbatim today's [PickerButton.ts:33-57](../src/typescript/lib/component/input/PickerButton.ts#L33-L57) — centres `this.getComponents()[0]` (the glyph child added post-construction by [`AbstractPickerField`](../src/typescript/lib/component/input/AbstractPickerField.ts) subclasses) in the inner rect. Call-site signature `new PickerButton()` is unchanged.

### `MenuBarButton` — narrows from `Component<MenuBarButtonOptions>` to `Button<MenuBarButtonOptions>`

```typescript
export interface MenuBarButtonOptions extends ButtonOptions {
    glyph?: string;
}

class MenuBarButton extends Button<MenuBarButtonOptions> {
    constructor(text: string, onClick: () => void, onHover: () => void, options?: MenuBarButtonOptions);

    // Inherited unchanged from Button:
    //   getText(), getGlyph(), setGlyph(), clearGlyph()
    //
    // Only override: replace the derived height with the menubar's fixed token.
    protected override computePreferredSize(): { width: number; height: number };

    // Menubar-specific surface:
    setActive(active: boolean): this;
    dispose(): void;
}
```

Constructor calls `super(text, { chromeless: true, ...options }, _defaultMenuBarButtonOptions)`. The third super arg ([Button.ts:127](../src/typescript/lib/component/button/Button.ts#L127)) carries the subclass defaults (`backgroundColor: transparent`, `foregroundColor: inherit`, `cursor: pointer`). `chromeless: true` keeps the gate in `applyChromeOptions` from dispatching Button's chromeful defaults; the menubar's own `:hover` highlight is a separate `StyleRule` owned by `MenuBarButton` (matches today's shape — see [MenuBarButton.ts:80-83](../src/typescript/lib/component/menubar/MenuBarButton.ts#L80-L83)).

`MenuBarButton` no longer carries its own `_text` / `_glyph` / `_label` fields, custom `doLayout`, or `recomputePreferredSize` helper — Button's standard content row (`_text` + optional `_glyph` inside `_content`, laid out by the Fit + HBox pair Button sets up) carries the menubar's glyph+text pair, and Button's native auto-sizing keeps preferred size in sync as the glyph changes. The only layout deviation from a default Button is west-alignment, which MenuBarButton applies in its constructor by re-adding `this._content` (now `protected` on Button — see "Internal Structure → Button visibility change") with `anchor: AnchorType.WEST` and `fill: FillType.NONE`. HBox spacing on the content row is bumped from Button's default `2` to MenuBarButton's `GLYPH_TEXT_GAP = 4`, and the button's `insets` are set to `(0, HORIZONTAL_PAD, 0, HORIZONTAL_PAD)` for the 10-px left/right padding the menubar wants.

The single `computePreferredSize` override takes Button's derived width unchanged and pins the height to `MENU_BAR_BUTTON_HEIGHT = 28`. Auto-fires (initial construction, `setGlyph`, `clearGlyph`, `setInsets`, theme change) inherit from Button — no override needed on those methods.

### WindowHeader — three inline call-site changes

```typescript
this._minimizeButton = new Button({ glyph: "window-minimize", chromeless: true });
this._maximizeButton = new Button({ glyph: "window-maximize", chromeless: true });
this._exitButton     = new Button({ glyph: "xmark",           chromeless: true });
```

The three `setBackgroundImage(this._activeBackgroundImage)` calls are deleted — they re-apply the same value as the Button default ([Button.ts:55](../src/typescript/lib/component/button/Button.ts#L55) vs [WindowHeader.ts:58](../src/typescript/lib/component/container/WindowHeader.ts#L58) — identical string literal); with `chromeless: true` neither the default nor the redundant explicit set fires. The three `.clearBorder()` calls are deleted — `chromeless` already drops the border default. The field types (`Button`, not a subclass) are already correct.

`WindowHeader._activeBackgroundImage` stays — it's still used by `setActive()` to set the *header bar's* background ([WindowHeader.ts:198-208](../src/typescript/lib/component/container/WindowHeader.ts#L198-L208)), independent of the trailing buttons.

---

## Internal Structure

### `chromeless` is a runtime gate, not a defaults-bag swap

The naïve construction-time approach — swap to a stripped chromeless defaults bag *before* `super` runs and store the choice in `_defaultOptions` — has a runtime correctness problem. `setChromeless` would need to mutate `_defaultOptions` in lockstep with the DOM flush, otherwise the next `applyOptions` call would merge in `_defaultOptions.border` / `.shadow` / etc. and dispatch them back. Worse, mutating `_defaultOptions` clobbers any subclass-supplied chrome that was layered in at construction — so a subclass that puts chrome in its defaults bag loses it on the first runtime toggle.

The shape adopted here keeps `_defaultButtonOptions` as the *only* defaults bag. Treat `chromeless` as a **dispatch-time gate** — when active, `applyOptions` skips the chrome dispatches even though `_defaultOptions` still holds the chromeful defaults. Subclass chrome in the defaults bag is preserved across toggles; `setChromeless` just flips the gate and explicitly clears (or restores) the DOM, because CSS doesn't auto-rerender from the option cache.

This requires one tiny refactor of Component: extract its four chrome dispatches into an overridable hook so `Button` can gate them. [`Component.applyOptions:340-346`](../src/typescript/lib/core/Component.ts#L340-L346) currently inlines the four lines for `border` / `borderRadius` / `shadow` / `backgroundImage`. Move them into a new `protected applyChromeOptions(opts: ComponentOptions): void` method, and replace the four inlined lines in `applyOptions` with a single `this.applyChromeOptions(opts);` call. The default implementation does exactly what the inlined code did before — no behaviour change for any existing Component consumer.

```typescript
// Component.ts — new protected hook.
protected applyChromeOptions(opts: ComponentOptions): void {
    if (opts.border          !== undefined) this.setBorder(opts.border);
    if (opts.borderRadius    !== undefined) this.setBorderRadius(opts.borderRadius);
    if (opts.shadow          !== undefined) this.setShadow(opts.shadow);
    if (opts.backgroundImage !== undefined) this.setBackgroundImage(opts.backgroundImage);
}
```

Button overrides the hook to gate on `chromeless` and to extend it with its own pressed/hover chrome. The chrome lines in `Button.applyOptions` (currently dispatching `pressedX` / `hoverX` after the `super.applyOptions` call) move into the override:

```typescript
// Button.ts — override gates AND extends.
protected override applyChromeOptions(opts: ButtonOptions): void {
    // Read the flag from the runtime cache first (set by previous applyOptions
    // calls and by setChromeless) before falling back to the freshly-merged
    // opts.chromeless. This way, once chromeless: true has been set, future
    // applyOptions calls that omit `chromeless` still see the gate as active.
    const chromeless = (this._options.chromeless ?? opts.chromeless) === true;
    if (chromeless) {
        return;
    }

    super.applyChromeOptions(opts);   // Component's four chrome dispatches.

    if (opts.pressedForegroundColor !== undefined) this.setPressedForegroundColor(opts.pressedForegroundColor);
    if (opts.pressedBackgroundColor !== undefined) this.setPressedBackgroundColor(opts.pressedBackgroundColor);
    if (opts.pressedBackgroundImage !== undefined) this.setPressedBackgroundImage(opts.pressedBackgroundImage);
    if (opts.pressedShadow          !== undefined) this.setPressedShadow         (opts.pressedShadow);
    if (opts.pressedBorder          !== undefined) this.setPressedBorder         (opts.pressedBorder);
    if (opts.pressedBorderRadius    !== undefined) this.setPressedBorderRadius   (opts.pressedBorderRadius);

    if (opts.hoverForegroundColor !== undefined) this.setHoverForegroundColor(opts.hoverForegroundColor);
    if (opts.hoverBackgroundColor !== undefined) this.setHoverBackgroundColor(opts.hoverBackgroundColor);
    if (opts.hoverBackgroundImage !== undefined) this.setHoverBackgroundImage(opts.hoverBackgroundImage);
    if (opts.hoverShadow          !== undefined) this.setHoverShadow         (opts.hoverShadow);
    if (opts.hoverBorder          !== undefined) this.setHoverBorder         (opts.hoverBorder);
    if (opts.hoverBorderRadius    !== undefined) this.setHoverBorderRadius   (opts.hoverBorderRadius);
}
```

`Button.applyOptions` loses its `pressedX` / `hoverX` dispatch block (it now lives in `applyChromeOptions`) and keeps only the non-chrome dispatches (`text`, `glyph`, `enabled`, `customLayout`, and now `chromeless`):

```typescript
protected applyOptions(options: TOptions): this {
    super.applyOptions(options);   // calls Component.applyOptions → which calls applyChromeOptions
    const opts = { ...this._defaultOptions, ...options } as TOptions;

    if (opts.text         !== undefined) this._options.text         = opts.text;
    if (opts.glyph        !== undefined) this._options.glyph        = opts.glyph;
    if (opts.enabled      !== undefined) this.setEnabled(opts.enabled);
    if (opts.chromeless   !== undefined) this._options.chromeless   = opts.chromeless;
    if (opts.customLayout !== undefined) this._options.customLayout = opts.customLayout;

    return this;
}
```

At construction with `chromeless: true`: the caller-supplied option flows through `super.applyOptions` → `Component.applyOptions` → `this.applyChromeOptions(opts)` → Button's override sees `opts.chromeless === true`, gate fires, no chrome dispatches. The DOM is set up by Component's element-build but no chrome rules are written. After `super.applyOptions` returns, Button writes `_options.chromeless = true`. Subsequent runtime `applyOptions` calls (with or without `chromeless` in the bag) read `this._options.chromeless ?? opts.chromeless` and continue to gate.

### `setChromeless` runtime toggle

With the gate in place, the runtime setter is just *flip the flag and reconcile the DOM*:

```typescript
setChromeless(value: boolean): this {
    if (this._options.chromeless === value) {
        return this;
    }

    if (value) {
        // Clear the DOM BEFORE flipping the flag, so the clear* setters
        // aren't intercepted by anything that might one day gate them
        // (they aren't gated today, but the ordering keeps the intent
        // self-evident).
        this.clearChrome();
        this._options.chromeless = true;
    } else {
        // Flip the flag first so any clear/set side-effects fire normally,
        // then re-apply chrome from the per-instance _defaultOptions
        // (which still holds the chromeful defaults plus any subclass
        // chrome layered in at construction).
        this._options.chromeless = false;
        this.restoreChrome();
    }

    return this;
}

private clearChrome(): void {
    this.clearBorder();
    this.clearBorderRadius();
    this.clearShadow();
    this.clearBackgroundImage();

    // Guard on the lazy backing slots so a button that never had a pressed
    // or hover treatment applied doesn't acquire an orphan empty StyleRule
    // just to wipe properties that were never set. The lazy getters create
    // the rule on first access; we want to skip creation when there's
    // nothing to clear.
    if (this._pressedStyleRule !== undefined) {
        this.clearPressedBackgroundColor();
        this.clearPressedBackgroundImage();
        this.clearPressedForegroundColor();
        this.clearPressedShadow();
        this.clearPressedBorderRadius();
        // pressedBorder has no clearPressedBorder method today — see "Potential Challenges".
    }
    if (this._hoverStyleRule !== undefined) {
        this.clearHoverBackgroundColor();
        this.clearHoverBackgroundImage();
        this.clearHoverForegroundColor();
        this.clearHoverShadow();
        this.clearHoverBorderRadius();
    }
}

private restoreChrome(): void {
    // Re-apply chrome from this._defaultOptions so subclass-supplied chrome
    // (layered into _defaultOptions at construction) wins over Button's
    // base defaults. The lazy pressedStyleRule / hoverStyleRule getters
    // allocate on first access.
    const d = this._defaultOptions as ButtonOptions;

    if (d.border                 !== undefined) this.setBorder                (d.border);
    if (d.borderRadius           !== undefined) this.setBorderRadius          (d.borderRadius);
    if (d.shadow                 !== undefined) this.setShadow                (d.shadow);
    if (d.backgroundImage        !== undefined) this.setBackgroundImage       (d.backgroundImage);
    if (d.pressedForegroundColor !== undefined) this.setPressedForegroundColor(d.pressedForegroundColor);
    if (d.pressedBackgroundColor !== undefined) this.setPressedBackgroundColor(d.pressedBackgroundColor);
    if (d.pressedBackgroundImage !== undefined) this.setPressedBackgroundImage(d.pressedBackgroundImage);
    if (d.pressedShadow          !== undefined) this.setPressedShadow         (d.pressedShadow);
    if (d.hoverBackgroundColor   !== undefined) this.setHoverBackgroundColor  (d.hoverBackgroundColor);
    if (d.hoverBackgroundImage   !== undefined) this.setHoverBackgroundImage  (d.hoverBackgroundImage);
    if (d.hoverShadow            !== undefined) this.setHoverShadow           (d.hoverShadow);
}

isChromeless(): boolean {
    return this._options.chromeless ?? false;
}
```

`clearChrome` and `restoreChrome` are `private` per CLAUDE.md's "no widening the API surface just because they exist" guidance — single caller, single file. `_defaultOptions` is **never mutated** — subclass chrome layered into it at construction survives every toggle. Toggling `chromeless` true → false → true → false leaves `_defaultOptions` exactly as the constructor produced it.

`applyOptions` writes `chromeless` to `_options` pure (no setter dispatch) — the work `setChromeless` does (clear/restore DOM) is only needed when the *flag actually changes*, and `applyOptions` is a dispatch site, not a state-change site. If `applyOptions` is called with `chromeless: true` and the instance was previously `chromeless: false`, the chrome dispatches gate cleanly via `applyChromeOptions` but the DOM still has the old chrome — the caller should use `setChromeless` for runtime flips. Documented in the `chromeless` field's JSDoc; alternatively `applyOptions` can route through `setChromeless` when the flag changes, at the cost of slightly weirder option-bag dispatch shape.

### `customLayout` wiring in `Button`

`Button`'s constructor body currently does three structural things after the validation guard at [Button.ts:142-150](../src/typescript/lib/component/button/Button.ts#L142-L150):

1. [Button.ts:163](../src/typescript/lib/component/button/Button.ts#L163) — `this.setLayoutManager(new Fit())`.
2. [Button.ts:166-181](../src/typescript/lib/component/button/Button.ts#L166-L181) — build `_text`, `_content`, add `_content` to `this`.
3. [Button.ts:186-192](../src/typescript/lib/component/button/Button.ts#L186-L192) — dispatch `text` and `glyph` from `_options`.

All three are wrapped in a single `if (!this._options.customLayout) { … }`. When `customLayout` is true the subclass takes responsibility for layout and children, and `_text` / `_content` / `_glyph` stay undefined for the lifetime of the instance.

The text/glyph validation at [Button.ts:142-150](../src/typescript/lib/component/button/Button.ts#L142-L150) is rewritten as:

```typescript
const customLayout = options?.customLayout === true;
const validateText  = text ?? options?.text ?? subclassDefaults?.text;
const validateGlyph = options?.glyph ?? subclassDefaults?.glyph;

if (customLayout) {
    if (validateText !== undefined || (validateGlyph !== undefined && validateGlyph !== null)) {
        throw new Error("Button with customLayout: true must not be given `text` or `glyph` — the subclass owns its children.");
    }
} else if (validateText === undefined && (validateGlyph === undefined || validateGlyph === null)) {
    throw new Error("Button must be given a `text` label or a `glyph` option (or both).");
}
```

`getText()`, `setGlyph()`, `clearGlyph()`, `getGlyph()`, `getBaseline()` all guard on `_options.customLayout` and throw with a descriptive message when called on a custom-layout button — these accessors only make sense in the default-layout shape. Existing callers don't touch them on custom-layout buttons (the only call site that calls `.setGlyph` on a `Button` consumer is [TabCloseButton](../src/typescript/lib/component/button/TabCloseButton.ts), which is out of scope, and [WindowHeader.setMaximizeButtonGlyph](../src/typescript/lib/component/container/WindowHeader.ts#L265-L269) which calls `setGlyph` on a `chromeless: true` *not* `customLayout: true` button).

### `PickerButton` refactor sketch

```typescript
class PickerButton extends Button {

    constructor() {
        super({
            chromeless:   true,
            customLayout: true,
            cursor:       "pointer",
            padding:      new Insets(0, 4, 0, 4),
        });
    }

    doLayout(): this {
        super.doLayout();
        // body verbatim from PickerButton.ts:33-57 — centres the single
        // glyph child added by AbstractPickerField subclasses post-construction.
        // …
    }
}
```

`tag: "button"` arrives via `_defaultButtonOptions` (the only defaults bag — see "`chromeless: true` is a dispatch-time gate"). The current explicit `setBorder({ style: NONE, … })` and `setBackgroundColor("transparent")` calls at [PickerButton.ts:22-24](../src/typescript/lib/component/input/PickerButton.ts#L22-L24) are gone — `chromeless: true` keeps `applyChromeOptions` from dispatching Button's chromeful border/shadow/backgroundImage defaults, and `_defaultButtonOptions` has no `backgroundColor` entry, so the element stays at its inherited (transparent) background.

### `MenuBarButton` refactor sketch

```typescript
const GLYPH_TEXT_GAP                = 4;   // overrides Button's default HBox content-row spacing of 2
const HORIZONTAL_PAD                = 10;
export const MENU_BAR_BUTTON_HEIGHT = 28;

const _defaultMenuBarButtonOptions: Partial<MenuBarButtonOptions> = {
    backgroundColor: "var(--ts-ui-menu-bar-btn-bg, transparent)",
    foregroundColor: "var(--ts-ui-menu-bar-btn-fg, inherit)",
    cursor:          "pointer",
};

class MenuBarButton extends Button<MenuBarButtonOptions> {

    private readonly _hoverRule:          StyleRule;
    private readonly _onClickHandler:     () => void;
    private readonly _onMouseOverHandler: () => void;

    constructor(
        text:    string,
        onClick: () => void,
        onHover: () => void,
        options?: MenuBarButtonOptions,
    ) {
        super(
            text,
            { chromeless: true, ...options } as MenuBarButtonOptions,
            _defaultMenuBarButtonOptions,
        );

        // Re-anchor Button's centred content row to the west edge so the
        // glyph+text pair sits against the left padding. _content is
        // `protected` on Button so subclasses can do exactly this.
        this.removeComponent(this._content);
        this.addComponent(this._content, {
            anchor: AnchorType.WEST,
            fill:   FillType.NONE,
        });

        // Bump the HBox content-row spacing from Button's default (2) to the
        // menubar's GLYPH_TEXT_GAP (4).
        (this._content.getLayoutManager() as HBox).setComponentSpacing(GLYPH_TEXT_GAP);

        // Horizontal padding inside the button — replaces Button's 4-px
        // insets. setInsets auto-fires recomputePreferredSize (inherited
        // from Button), so the menubar's fixed-height computePreferredSize
        // override lands the right dimensions without explicit prodding.
        this.setInsets(new Insets(0, HORIZONTAL_PAD, 0, HORIZONTAL_PAD));

        // Menubar-specific :hover highlight. Uses a bare `:hover` selector
        // rather than Button's `:hover:not(:active)`, which is fine here
        // because MenuBarButton doesn't style `:active`. This rule stays
        // independent of Button's hoverStyleRule (which is gated off by
        // chromeless: true).
        this._hoverRule = new StyleRule({ scope: "component", name: this.getId() + ":hover" });
        this._hoverRule.set("backgroundColor",
            "var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))");
        this._hoverRule.ensure();

        this.getAria().setRole("menuitem");
        this.getAria().setHasPopup("menu");
        this.getAria().setExpanded(false);

        this._onClickHandler     = (): void => { onClick(); };
        this._onMouseOverHandler = (): void => { onHover(); };
        Event.addListener(this, "click",     this._onClickHandler);
        Event.addListener(this, "mouseover", this._onMouseOverHandler);
    }

    protected override computePreferredSize(): { width: number; height: number } {
        const { width } = super.computePreferredSize();   // content + insets
        return { width, height: MENU_BAR_BUTTON_HEIGHT };
    }

    setActive(active: boolean): this {
        this.setBackgroundColor(
            active
                ? "var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))"
                : "var(--ts-ui-menu-bar-btn-bg, transparent)"
        );
        this.getAria().setExpanded(active);

        return this;
    }

    dispose(): void {
        Event.removeListener(this, "click",     this._onClickHandler);
        Event.removeListener(this, "mouseover", this._onMouseOverHandler);
    }
}
```

The class is dramatically shorter than today's [MenuBarButton.ts](../src/typescript/lib/component/menubar/MenuBarButton.ts) — no `_text` / `_glyph` / `_label` fields, no `doLayout`, no `setGlyph` / `clearGlyph` / `getGlyph` overrides, no private `recomputePreferredSize` helper. Button's standard content-row machinery handles the children; Button's native auto-sizing handles preferred-size syncing; MenuBarButton just re-anchors the row, bumps spacing, pins the height, and adds menubar-specific ARIA + callbacks + hover rule.

The two outer constructor overloads on `Button` ([Button.ts:127-128](../src/typescript/lib/component/button/Button.ts#L127-L128)) accept the `(text?, options?, subclassDefaults?)` shape, so `MenuBarButton` forwards `_defaultMenuBarButtonOptions` as the third arg the same way today's [`SpinButton`](../src/typescript/lib/component/input/SpinButton.ts) and [`AccordionHeader`](../src/typescript/lib/component/container/AccordionHeader.ts) do.

### `recomputePreferredSize` + `computePreferredSize` wiring

Two new `protected` methods on `Button`, plus a private flag and an override of `setPreferredSize`:

```typescript
// Button.ts — auto-sizing internals.

private _consumerSetPreferredSize = false;

override setPreferredSize(width: number, height: number): this {
    this._consumerSetPreferredSize = true;
    super.setPreferredSize(width, height);

    return this;
}

protected recomputePreferredSize(): void {
    if (this._consumerSetPreferredSize) {
        return;   // consumer's explicit intent wins.
    }
    if (this._options.customLayout) {
        return;   // customLayout subclasses own their sizing — no _content to read.
    }

    const size = this.computePreferredSize();

    // Bypass the consumer-flag flip by going through Component.setPreferredSize
    // directly. `super` here is Component, not Button.
    super.setPreferredSize(size.width, size.height);
}

protected computePreferredSize(): { width: number; height: number } {
    const content = this._content.getPreferredSize() ?? { width: 0, height: 0 };
    const insets  = this.getInsets();

    return {
        width:  content.width  + insets.getLeft() + insets.getRight(),
        height: content.height + insets.getTop()  + insets.getBottom(),
    };
}
```

Auto-fire is wired at four call sites:

1. **End of `Button`'s constructor** — once the initial text/glyph dispatch has populated `_content`'s children, call `this.recomputePreferredSize()`. Gated for `customLayout: true` and for the consumer-set case, so it's a safe no-op on either path.
2. **`setGlyph` and `clearGlyph`** — each appends `this.recomputePreferredSize()` after the existing body (which inserts/removes the glyph child of `_content`). The HBox content row's preferred size has now changed; the recompute picks it up.
3. **`setInsets`** — `Button` overrides Component's `setInsets` to call super then `this.recomputePreferredSize()`. Subclasses (like `MenuBarButton`) that change their insets in the constructor body get their preferred size synced for free.
4. **`ThemeManager.onThemeChange`** — registered once in `Button`'s constructor; the handler is a named method `private onThemeChange = (): void => this.recomputePreferredSize();`. Theme-driven font size changes shift the text's preferred size, so the recompute must re-fire to keep the button in step.

Subclasses extend by overriding `computePreferredSize` only — neither the consumer-flag check nor the auto-fire wiring needs subclass attention. `MenuBarButton`'s override calls `super.computePreferredSize()` to get the derived width, then replaces the height with `MENU_BAR_BUTTON_HEIGHT`. If `computePreferredSize` ever needs to read text-specific metrics directly, the subclass can do so via `this.getText()` and `this.getGlyph()` — the same accessors consumers use.

The `_consumerSetPreferredSize` flag is `private` — no subclass needs to inspect or override it, and the auto-fire policy is owned by `Button` alone. If a consumer later wants to *re-enable* auto-sizing after explicitly setting a size, the API surface would be a `clearPreferredSize()` method that resets the flag and re-fires `recomputePreferredSize` — out of scope here, mentioned in Non-Goals.

### Button visibility change — `_content` becomes `protected`

`Button._content` ([Button.ts:87](../src/typescript/lib/component/button/Button.ts#L87)) goes from `private` to `protected` so subclasses (like `MenuBarButton`) can re-anchor or rebuild the content row without having to fall back to `customLayout: true`:

```typescript
// Button.ts
protected _content!: Component;   // was: private _content!: Component
```

This is the **only** visibility change in the plan. `_text` and `_glyph` stay `private` — subclasses reach them via the existing `getText()` and `getGlyph()` public accessors, which is sufficient for every subclass surface in scope here. A subclass that needs to rewire `_content`'s layout-manager constraints (typical case: re-anchor from `CENTER` to `WEST`) can do so via `removeComponent(this._content); addComponent(this._content, { … })`.

The `_content` JSDoc gains a one-line note documenting the protected-by-design status so future contributors don't accidentally re-narrow it.

### WindowHeader refactor sketch

The three blocks at [WindowHeader.ts:79-89](../src/typescript/lib/component/container/WindowHeader.ts#L79-L89) collapse to:

```typescript
this._minimizeButton = new Button({ glyph: "window-minimize", chromeless: true });
this._maximizeButton = new Button({ glyph: "window-maximize", chromeless: true });
this._exitButton     = new Button({ glyph: "xmark",           chromeless: true });
```

The `_activeBackgroundImage` constant ([WindowHeader.ts:58](../src/typescript/lib/component/container/WindowHeader.ts#L58)) stays — `setActive()` still uses it for the header bar itself ([WindowHeader.ts:200](../src/typescript/lib/component/container/WindowHeader.ts#L200)). Only the three button-side `setBackgroundImage` calls go away.

### `applyOptions` dispatch — summary

The full `Button.applyOptions` shape lives in the "`chromeless` is a runtime gate" subsection above. Recap:

- Chrome dispatches (Component's four plus Button's pressed/hover) live in the overridden `applyChromeOptions(opts)` hook — gated on `(this._options.chromeless ?? opts.chromeless) === true`.
- Non-chrome dispatches (`text`, `glyph`, `enabled`) stay in `Button.applyOptions` after `super.applyOptions`.
- `chromeless` and `customLayout` are written pure into `_options` (no setter dispatch from `applyOptions` — see the note in the runtime-toggle section about why runtime flag flips should use `setChromeless` directly).

---

## Ordered Implementation Steps

1. **Extend `ButtonOptions`** — add `chromeless` and `customLayout` to the interface in [Button.ts:22-38](../src/typescript/lib/component/button/Button.ts#L22-L38). Verify: `npx tsc --noEmit` clean (no consumer changes yet).
2. **Extract `applyChromeOptions` hook on `Component`** — move the four chrome dispatches at [Component.ts:340-346](../src/typescript/lib/core/Component.ts#L340-L346) (`border`, `borderRadius`, `shadow`, `backgroundImage`) into a new `protected applyChromeOptions(opts: ComponentOptions): void` method. Replace the inlined lines in `applyOptions` with a single `this.applyChromeOptions(opts);` call at the same point in the dispatch sequence. Behaviour-equivalent for every existing Component consumer; the hook is the seam Button uses to gate. Verify: every Component-subclass smoke (`MiscPanel`, `LayoutTestPanel`, etc.) renders identically.
3. **Override `applyChromeOptions` in `Button`** — gate the whole hook on `(this._options.chromeless ?? opts.chromeless) === true`; otherwise `super.applyChromeOptions(opts)` then dispatch Button's twelve `pressedX` / `hoverX` chrome fields. Remove the corresponding `pressedX` / `hoverX` dispatch block from `Button.applyOptions` ([Button.ts:217-229](../src/typescript/lib/component/button/Button.ts#L217-L229)) — those now live in the override. Verify: a `Button({ chromeless: true })` smoke instance renders with no chrome; a default `Button()` looks identical to today.
4. **Gate `Button`'s Fit + content-row setup on `customLayout`** — wrap [Button.ts:163](../src/typescript/lib/component/button/Button.ts#L163), [Button.ts:166-181](../src/typescript/lib/component/button/Button.ts#L166-L181), and the late-dispatch block at [Button.ts:186-192](../src/typescript/lib/component/button/Button.ts#L186-L192) in `if (!this._options.customLayout) { … }`. Update the text/glyph validation guard to throw when `customLayout: true` is combined with `text` or `glyph`. Add `customLayout`-aware throws to `getText`, `setGlyph`, `clearGlyph`, `getGlyph`, `getBaseline` — these are inaccessible on a custom-layout button.
5. **Add `setChromeless`, `isChromeless`, and the private `clearChrome` / `restoreChrome` helpers to `Button`** — bodies as in "Internal Structure → `setChromeless` runtime toggle". `_defaultOptions` is never mutated — the gate alone reconciles future `applyOptions` calls. Guard the pressed/hover clears on the lazy backing slots being non-undefined so a never-touched style rule isn't materialised just to wipe it. The clear/restore ordering relative to the flag flip is important; follow the snippet exactly.
6. **Add `chromeless` and `customLayout` writes to `Button.applyOptions`** — both are pure writes into `_options` (no setter dispatch from `applyOptions`). Runtime flag flips happen via `setChromeless`; `applyOptions` is the construction-time + bulk-config path and shouldn't do clear/restore work. See "Internal Structure → `applyOptions` dispatch — summary".
7. **Add `Button.addPointerDownListener`** — one new method on [Button.ts](../src/typescript/lib/component/button/Button.ts) mirroring `addActionListener`'s shape, registering on the `"pointerdown"` event. Needed so step 10's `AbstractPickerField` migration doesn't have to reach for raw `Event.addListener`.
8. **Add native auto-sizing to `Button`** — add the `_consumerSetPreferredSize` private flag, override `Button.setPreferredSize` to flip it, add the `protected recomputePreferredSize` and `protected computePreferredSize` methods (bodies as in "Internal Structure → `recomputePreferredSize` + `computePreferredSize` wiring"). Wire the four auto-fire points: end of constructor, `setGlyph`, `clearGlyph`, `setInsets` (override to call super then recompute), and the `ThemeManager.onThemeChange` registration in the constructor (named `onThemeChange` arrow method).
9. **Smoke-test the host change** — `npm run dev`, exercise `MiscPanel` (default `Button`), `ToolBarPanel` (`ToggleButton`), `TabPanel` (`TabCloseButton`), `AccordionPanel` (`AccordionHeader`), `NumberSpinner` (`SpinButton`). Specifically watch for the auto-sizing behaviour change: any `Button` in those demos that previously had no explicit `preferredSize` now reports one. Confirm visually that no demo has buttons that *shrunk* (auto-size produced a smaller box than the parent layout was already giving them) or that disrupt the demo flow. Then add a transient debug control that calls `someButton.setChromeless(true)` and `setChromeless(false)` on a default `Button` to confirm the runtime toggle round-trips visually. Subclass smoke: construct a synthetic `class CustomButton extends Button` whose `subclassDefaults` carries a custom border colour, then `setChromeless(true)` then `setChromeless(false)` — confirm the subclass border survives the round-trip (the key property the gate-not-swap design gives you). Expectation: zero visual or behavioural regression on the existing demos other than the documented natural-size shift.
10. **Refactor `PickerButton`** — change `extends Component` → `extends Button`, replace the manual chrome-strip ([PickerButton.ts:22-25](../src/typescript/lib/component/input/PickerButton.ts#L22-L25)) with the `super({ chromeless: true, customLayout: true, cursor: "pointer", padding: new Insets(0, 4, 0, 4) })` call. `doLayout` body unchanged. Verify: `AbstractPickerField`'s `_button` field still types as `PickerButton`; `DateField` / `TimeField` / `DateTimeField` demos still centre their glyphs.
11. **Migrate `AbstractPickerField`'s button listeners** — rewrite [AbstractPickerField.ts:98-100](../src/typescript/lib/component/input/AbstractPickerField.ts#L98-L100) so the click and pointerdown registrations go through the named-method surface: `this._button.addActionListener(() => this.onButtonClick())` and `this._button.addPointerDownListener((e: PointerEvent) => this.onButtonPointerDown(e))`. The two `Event.addListener(this._input, …)` calls on the input element are unrelated and stay.
12. **Relax `Button._content` to `protected`** — change [`Button.ts:87`](../src/typescript/lib/component/button/Button.ts#L87) from `private _content!: Component;` to `protected _content!: Component;` and add a one-line JSDoc note that subclasses may re-anchor the content row via `removeComponent` + `addComponent`. `_text` and `_glyph` stay `private` (already exposed via `getText` / `getGlyph` public accessors).
13. **Refactor `MenuBarButton`** — change `extends Component<MenuBarButtonOptions>` → `extends Button<MenuBarButtonOptions>`. Body follows the sketch in "Internal Structure → MenuBarButton refactor sketch": super-call with `chromeless: true` and `_defaultMenuBarButtonOptions` as the third arg; re-anchor `this._content` to `anchor: AnchorType.WEST`; bump HBox spacing to `GLYPH_TEXT_GAP`; set the horizontal insets; build the bare-`:hover` `StyleRule`; ARIA setup; click/mouseover listeners. Drop the `_text` / `_glyph` / `_label` fields, the parallel `setGlyph` / `clearGlyph` / `getGlyph` implementations, the `doLayout` override, and the private `recomputePreferredSize` helper — Button's content-row machinery covers the children, Button's native auto-sizing covers preferred-size syncing. Override `computePreferredSize` only — call `super.computePreferredSize()` for the width and pin the height to `MENU_BAR_BUTTON_HEIGHT`. Keep `setActive`, `dispose`. `MenuBarButtonOptions extends ButtonOptions`. Self-registered click/mouseover listeners at [MenuBarButton.ts:101-102](../src/typescript/lib/component/menubar/MenuBarButton.ts#L101-L102) stay — those are *internal* `Event.addListener(this, …)` calls (the class registering listeners on itself), which is the allowed shape; the bypass rule only forbids *external* consumers from doing the same. Drop the `setElementCSSRule("fontSize", …)` at [MenuBarButton.ts:78](../src/typescript/lib/component/menubar/MenuBarButton.ts#L78) — Button's `_text` child already carries the same `var(--ts-ui-button-font-size, …)` token via [Button.ts:176](../src/typescript/lib/component/button/Button.ts#L176). Verify: [MenuBar.ts:147](../src/typescript/lib/component/menubar/MenuBar.ts#L147) keeps compiling; the menubar demo shows the same hover/active highlights, the same fixed 28-px row height, the same left-aligned glyph+text layout; ARIA reports correctly via DevTools.
14. **Refactor WindowHeader's trailing buttons** — replace the three `new Button({ glyph: … })` + `setBackgroundImage` + `clearBorder` blocks at [WindowHeader.ts:79-89](../src/typescript/lib/component/container/WindowHeader.ts#L79-L89) with three single-line `new Button({ glyph: …, chromeless: true })` calls. WindowHeader's existing `addExitButtonListener` / `addMinimizeButtonListener` / `addMaximizeButtonListener` ([WindowHeader.ts:276-302](../src/typescript/lib/component/container/WindowHeader.ts#L276-L302)) already route through `Button.addActionListener` — they continue to do so. Confirm `_activeBackgroundImage` is still referenced by `setActive()` and is not orphaned.
15. **Grep regression: chrome-strip patterns** — `grep -rn "clearBorder()" src/typescript/` to confirm no remaining redundant chrome-strip-by-default-clear patterns on `Button` instances in the consolidated call sites. Expect zero hits in `WindowHeader.ts`; other components are out of scope.
16. **Grep regression: raw `Event.addListener` against buttons** — `grep -rn 'Event\.addListener(this\._button' src/typescript/` should now return zero matches in `AbstractPickerField.ts` (it was two before step 11). The broader sweep `grep -rn 'Event\.addListener([^,]*[Bb]utton' src/typescript/` should be empty too — any surviving hit is either a false positive (variable named `button` that isn't a `Button`) or a new bypass that needs a named-method route.
17. **Verify build + smoke + docs** — `npx tsc --noEmit`, `npm run dev` smoke pass (see Verification), `npm run docs:build` (0 errors, 0 link warnings).
18. **`graphify update .`** — per [`feedback_search_tool_economy`](../home/jika/.claude/projects/-home-jika-typescript-typescript/memory/feedback_search_tool_economy.md), refresh the graph after source edits so subsequent queries see the new inheritance chain.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — extract the four chrome dispatches from `applyOptions` into a new `protected applyChromeOptions(opts)` hook; behaviour-equivalent for every Component consumer, only the call shape changes |
| Modify | [src/typescript/lib/component/button/Button.ts](../src/typescript/lib/component/button/Button.ts) — add `chromeless` + `customLayout` to `ButtonOptions`; override `applyChromeOptions` to gate on `chromeless` and extend with pressed/hover chrome; gate Fit/content-row setup on `customLayout`; update text/glyph validation; add `setChromeless` / `isChromeless` (with `clearChrome` / `restoreChrome` privates) and `addPointerDownListener`; add `recomputePreferredSize` / `computePreferredSize` (protected) with auto-fire from setGlyph/clearGlyph/setInsets/onThemeChange/end-of-constructor and a `_consumerSetPreferredSize` flag gated by an override of `setPreferredSize`; relax `_content` from `private` to `protected` so subclasses can re-anchor the content row |
| Modify | [src/typescript/lib/component/input/PickerButton.ts](../src/typescript/lib/component/input/PickerButton.ts) — extend `Button` instead of `Component`, replace manual chrome-strip with `chromeless` + `customLayout` |
| Modify | [src/typescript/lib/component/input/AbstractPickerField.ts](../src/typescript/lib/component/input/AbstractPickerField.ts) — route the button click and pointerdown listeners through `addActionListener` / `addPointerDownListener` instead of raw `Event.addListener(this._button, …)` |
| Modify | [src/typescript/lib/component/menubar/MenuBarButton.ts](../src/typescript/lib/component/menubar/MenuBarButton.ts) — extend `Button<MenuBarButtonOptions>` instead of `Component<MenuBarButtonOptions>`; super-call with `chromeless: true` and `_defaultMenuBarButtonOptions`; re-anchor `this._content` to west and bump HBox spacing; keep `setActive` / `dispose` / `recomputePreferredSize` and override `setGlyph` / `clearGlyph` to resync; drop the previous `_text` / `_glyph` / `_label` fields and the `doLayout` override |
| Modify | [src/typescript/lib/component/container/WindowHeader.ts](../src/typescript/lib/component/container/WindowHeader.ts) — inline `chromeless: true` into the three `Button` constructions; delete the matching `setBackgroundImage` and `clearBorder` calls |
| Modify | [docs/components/Button.md](../docs/components/Button.md) — add "Chromeless mode" + "Custom layout" subsections covering the two new flags; cross-link from the existing options table |
| Modify | [docs/components/PickerButton.md](../docs/components/PickerButton.md) (if present) — note the new `extends Button` chain |
| Modify | [docs/components/MenuBarButton.md](../docs/components/MenuBarButton.md) (if present) — note the new `extends Button` chain |

No file deletions. No barrel changes — `PickerButton` and `MenuBarButton` keep their existing exports at [src/typescript/lib/component/input/index.ts](../src/typescript/lib/component/input/index.ts) and [src/typescript/lib/component/menubar/index.ts](../src/typescript/lib/component/menubar/index.ts).

---

## Verification

1. `npx tsc --noEmit` — no new errors above baseline.
2. `grep -rn "clearBorder()" src/typescript/lib/component/container/WindowHeader.ts` — expect zero matches (was three).
3. `grep -rn "setBackgroundImage(this._activeBackgroundImage)" src/typescript/lib/component/container/WindowHeader.ts` — expect zero matches on the three trailing-button blocks (the `setActive()` call on the header itself stays at [WindowHeader.ts:200](../src/typescript/lib/component/container/WindowHeader.ts#L200)).
4. `grep -rn "extends Component" src/typescript/lib/component/input/PickerButton.ts src/typescript/lib/component/menubar/MenuBarButton.ts` — expect zero matches; both should now show `extends Button`.
5. `grep -rn 'Event\.addListener(this\._button' src/typescript/lib/component/input/AbstractPickerField.ts` — expect zero matches (was two). Confirms the button listeners now route through `addActionListener` / `addPointerDownListener`. Broader sweep `grep -rn 'Event\.addListener([^,]*[Bb]utton' src/typescript/` should also be empty of true bypasses.
6. `npm run dev` smoke pass:
    - `MiscPanel` — default `Button` renders the ridge border + gradient + shadow + pressed/hover treatments unchanged.
    - `ToolBarPanel` — `ToggleButton` still toggles, sticky `:active` rule preserved.
    - `TabPanel` — `TabCloseButton` × glyph still closes a tab; tab fade unchanged.
    - `AccordionPanel` — `AccordionHeader` chevron still rotates on expand/collapse.
    - `NumberSpinner` demo — `SpinButton` chevrons hold-repeat as before.
    - `DateField` / `TimeField` / `DateTimeField` demos — `PickerButton` glyph still centred; no border, no shadow, no gradient.
    - MenuBar demo — `MenuBarButton` hover still tints; clicking opens dropdown; ARIA `aria-expanded` toggles correctly (verify via DevTools accessibility tree).
    - `WindowHeader` demo (any `Window`) — exit / minimize / maximize buttons render with the same overall look as today minus the border. The gradient that was being re-applied redundantly is gone; the buttons sit flat against the header gradient instead. Confirm with the user that this is acceptable; if not, fall back to the `chromeless: true, backgroundImage: this._activeBackgroundImage` shape (one extra option per button) to restore the gradient.
    - Theme toggle (light / dark) — all five panels above plus WindowHeader track their theme tokens correctly.
7. `npm run docs:build` — 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).

---

## Documentation Impact

- **Symbol additions:** `Button.setChromeless`, `Button.isChromeless`, `Button.addPointerDownListener` (public) + `Button.recomputePreferredSize`, `Button.computePreferredSize` (protected — subclass extension surface). `setChromeless` / `isChromeless` are the typed-setter pair for the new `chromeless` option (per ARCHITECTURE.md's "options-bag-as-cache" + "every configurable property gets a setter" rules); `addPointerDownListener` pairs with `addActionListener` in the named-listener surface; `recomputePreferredSize` / `computePreferredSize` give every Button content-derived auto-sizing. Both new options (`chromeless`, `customLayout`) land on the existing exported `ButtonOptions` interface; per [docs-conventions.md](../.claude/skills/_shared/docs-conventions.md) fields added to an exported interface need no new export wiring.
- **Symbol changes:** `PickerButton` and `MenuBarButton` inheritance chains flip from `Component` → `Button`. The class names stay exported from the same barrels ([src/typescript/lib/component/input/index.ts](../src/typescript/lib/component/input/index.ts), [src/typescript/lib/component/menubar/index.ts](../src/typescript/lib/component/menubar/index.ts)) so curated pages and typedoc cross-links don't move; typedoc will regenerate the inheritance breadcrumb automatically.
- **Curated pages:**
    - [docs/components/Button.md](../docs/components/Button.md) gains four short subsections — "Chromeless mode" (`chromeless: true` example, list of fields it disables, plus a sentence documenting `setChromeless` as the runtime-toggle counterpart and `isChromeless` as the read accessor), "Custom layout" (`customLayout: true`, with a note that the subclass owns children + layout, plus the throw conditions on text/glyph), "Auto-sizing" (every Button derives its preferred size from content+insets; consumer-supplied `preferredSize` wins permanently; subclasses override `computePreferredSize` to customise), and one line under the existing event-handling section documenting `addPointerDownListener` alongside `addActionListener` and noting that all event registrations on a Button should route through named methods (no raw `Event.addListener(button, …)` from external code).
    - [docs/components/PickerButton.md](../docs/components/PickerButton.md) — if the page exists, the existing "extends Component" wording becomes "extends Button (chromeless, custom layout)". No structural rewrite.
    - [docs/components/MenuBarButton.md](../docs/components/MenuBarButton.md) — the existing "extends Component" wording becomes "extends Button (chromeless)". Mention that the text/glyph methods are inherited from Button.
- **Sidebar:** no changes to [docs/.vitepress/config.mts](../docs/.vitepress/config.mts).
- **Cross-bucket JSDoc:** the new `chromeless` JSDoc in `ButtonOptions` references `[\`MenuBarButton\`](/api/component/menubar/classes/MenuBarButton)` (cross-bucket from `component/button`) per the markdown-link form mandated in [docs-conventions.md](../.claude/skills/_shared/docs-conventions.md); the `customLayout` JSDoc references `[\`PickerButton\`](/api/component/input/classes/PickerButton)` similarly.

---

## Potential Challenges

- **`customLayout: true` throws on accessors that don't fit** — `getText`, `setGlyph`, `clearGlyph`, `getGlyph`, `getBaseline` all expect a Fit + content-row Button. Today no `customLayout` consumer calls them, but the throws should be specific enough that a future caller sees the right diagnostic (e.g. `"setGlyph() is not available on a Button constructed with customLayout: true; the subclass owns its children."`). Audit via `grep` for unintended callers as part of step 8's smoke.
- **`setChromeless` has no `clearPressedBorder` to call** — [`Button`](../src/typescript/lib/component/button/Button.ts) exposes `setPressedBorder` but no `clearPressedBorder` (and the existing chromeful default bag at [Button.ts:48-64](../src/typescript/lib/component/button/Button.ts#L48-L64) doesn't set a `pressedBorder` value, so `_pressedBorder` is `null` by default anyway). `clearChrome` skips it — there's nothing to clear unless the consumer explicitly set one, and even then `chromeless` doesn't promise to undo *consumer-supplied* chrome, only the framework defaults. Same story for `hoverBorder`. If a future consumer hits this edge, add the missing `clearPressedBorder` / `clearHoverBorder` setters in a follow-up.
- **`setChromeless(true)` on an already-chromeless button materialises empty style rules unless guarded** — the lazy `_pressedStyleRule` / `_hoverStyleRule` getters create the `StyleRule` on first access. Calling `clearPressedX` without checking the slot would touch the getter and acquire an empty orphan rule. `clearChrome` guards on `this._pressedStyleRule !== undefined` (and the hover twin) so the rule is only cleared when it actually exists. Documented so future contributors don't simplify the guard away.
- **`applyChromeOptions` extraction is a Component refactor — every chrome-touching test must run unchanged** — the four chrome dispatches at [Component.ts:340-346](../src/typescript/lib/core/Component.ts#L340-L346) move into a new `protected applyChromeOptions(opts)` hook, called from `applyOptions` at the same point in the dispatch sequence. The default implementation is byte-equivalent to the inlined code. Verify with the full Component-subclass smoke pass: any class that depends on the order or side effects of those four chrome lines (theme-token rules, hover/pressed style rules built lazily on first set, etc.) must render identically before and after the move.
- **`Button._content` becomes `protected` — part of the contract for subclasses** — relaxing `_content` from `private` to `protected` means any future restructuring of Button's content row (e.g. replacing the HBox with a different layout, splitting `_content` into multiple children, renaming) now risks breaking subclasses that re-anchor the row. `MenuBarButton` is the only such subclass introduced by this plan; document in the `_content` JSDoc that the field is part of the subclass contract so reviewers catch any later re-narrow attempts. If the contract grows uncomfortable, a future plan can replace direct access with a `protected setContentAnchor(anchor: AnchorType)` method.
- **Auto-sizing is a behaviour change for every existing `Button` consumer that didn't set `preferredSize`** — today such buttons report no preferred size and the parent layout's fallback (often "stretch to fill" or "ask the layout-manager's measure") wins. After the change, those buttons report a content-derived size and most parent layouts will honour it. Demos / call sites where the previous fallback was making the button *larger* than its content will see the button shrink to its natural size. Step 9's smoke pass specifically watches for this; if a regression shows up, the fix is to set an explicit `preferredSize` on that specific call site, not to disable the auto-sizing globally.
- **Auto-sizing reads `_content`, so customLayout buttons need to skip it** — `recomputePreferredSize` guards on `this._options.customLayout` and returns without touching `setPreferredSize`. A `customLayout: true` subclass (e.g. `PickerButton`) owns its children directly and must compute its own preferred size if it wants one. PickerButton today doesn't set one (its parent `AbstractPickerField` sizes it via its own layout); document that this stays the case unless the subclass explicitly overrides.
- **`setPreferredSize` override flips `_consumerSetPreferredSize` permanently** — once a consumer calls `setPreferredSize` (directly or via the options bag), the auto-fire is disabled for the lifetime of the instance. There's no public surface to re-enable it. If a future use case needs that (e.g. "stretch this button for now, then let it auto-size again"), add a `clearPreferredSize()` method that resets the flag and re-fires `recomputePreferredSize`. Out of scope here; noted in Non-Goals.
- **`Button` registers a `ThemeManager.onThemeChange` listener — needs a dispose path eventually** — the auto-sizing re-fires on theme changes. `Button` doesn't currently expose a `dispose` method, so the listener registration is fire-and-forget for the lifetime of the application. If `Button` (or a parent that pools Buttons) ever gains an explicit dispose path, the listener must be unregistered there to avoid retaining the button via the `ThemeManager` callback list. Not a blocker today; flag in the registration's JSDoc.
- **`applyOptions({ chromeless: true })` on a previously-chromeful button does *not* clear the DOM** — `Button.applyOptions` writes `chromeless` to `_options` pure (no setter side effect) and the gate in `applyChromeOptions` prevents *future* chrome dispatches, but the chrome already on the element stays. Callers wanting a runtime flip should use `setChromeless` directly. This is documented in the `chromeless` field's JSDoc on `ButtonOptions`. An alternative is to route the flag through `setChromeless` from inside `applyOptions` when the value differs from the cache, at the cost of mixing dispatch and visual-side-effect work in the same call — flag if the alternative is wanted before implementation.
- **`setChromeless(false)` restores from `_defaultOptions`, not from the consumer's original explicit options** — a consumer that constructed `new Button("Save", { border: { style: DOUBLE } })` lands with `_defaultOptions.border = { ridge, … }` (the framework default) and `_border = Border.fromOptions({ DOUBLE })` (the consumer's value, written by `setBorder` during the initial dispatch). `setChromeless(true)` clears `_border` and the DOM. `setChromeless(false)` re-reads `_defaultOptions.border` (the framework default) — the consumer's `DOUBLE` doesn't come back. This is documented in the `setChromeless` JSDoc. Note: subclass chrome supplied via the third super arg (`subclassDefaults`) *does* round-trip cleanly, because it's merged *into* `_defaultOptions` at construction; only consumer-options-only chrome is lost. A future enhancement could cache consumer-supplied chrome separately, but that's out of scope.
- **WindowHeader's button gradient disappears** — today the three buttons carry `Button`'s default gradient because the explicit `setBackgroundImage(this._activeBackgroundImage)` re-applies the same default. With `chromeless: true` the gradient is gone entirely. This is a visual change. If the smoke pass shows the flat look is jarring, fall back to `Button({ glyph: …, chromeless: true, backgroundImage: this._activeBackgroundImage, pressedShadow: …, hoverShadow: … })` — slightly more verbose but recovers the chrome the user wanted. The plan defaults to the flatter look; the fallback is documented in step 9.
- **MenuBarButton's font-size override is now redundant** — [MenuBarButton.ts:78](../src/typescript/lib/component/menubar/MenuBarButton.ts#L78) sets `fontSize` to `var(--ts-ui-button-font-size, 12px)` on `this`. Button's inherited `_text` child already carries the same `var(--ts-ui-button-font-size, …)` token at [Button.ts:176](../src/typescript/lib/component/button/Button.ts#L176), so once MenuBarButton uses Button's content row the override is duplicate — drop it per step 12. Confirm in smoke that the menubar label still renders at 12 px after removal.
- **MenuBarButton's `_hoverRule` selector** — uses bare `:hover`; Button's `hoverStyleRule` uses `:hover:not(:active)`. With `chromeless: true`, Button's hover rule is never installed, so there's no selector overlap. The two rules don't collide. Documented for the implementer so they don't try to "harmonise" them as a follow-up.
- **`PickerButton.doLayout` reads `this.getComponents()[0]`** — relies on the AbstractPickerField subclass having added the glyph as the only child. After the refactor, `Button` itself contributes no children (`customLayout: true`), so the first child is still the glyph the subclass adds. Invariant preserved. Worth a one-line comment at the top of the new `doLayout`.
- **Button's text/glyph validation interplay with `customLayout`** — supplying `text` (positional) AND `customLayout: true` is currently legal-but-meaningless. The new throw makes it fail loud. Audit existing call sites once the throw lands — `PickerButton` is the only customLayout consumer in this plan (MenuBarButton and the WindowHeader inline buttons reuse Button's content row), and it doesn't pass a redundant text/glyph; verify the rest of the codebase via `grep -rn "customLayout" src/` after step 4 (expect one hit).
- **`MenuBarButton`'s `applyOptions` chain** — currently `super.applyOptions(options)` reaches `Component.applyOptions`. After the refactor it reaches `Button.applyOptions`, which now also dispatches `chromeless` and `customLayout` (pure writes). The pure writes don't trigger any setter side effect, so re-applying options on a `MenuBarButton` continues to be safe.

---

## Critical Files

- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — the chrome-dispatch extraction lands here; read [Component.ts:330-346](../src/typescript/lib/core/Component.ts#L330-L346) (the `applyOptions` body and the four chrome-field lines) to understand the seam point. Behaviour-equivalent change; the new `applyChromeOptions` hook is the only new surface.
- [src/typescript/lib/component/button/Button.ts](../src/typescript/lib/component/button/Button.ts) — host class; ~40-50 LoC will land here (the two flags, the `applyChromeOptions` override, the `customLayout` gating, the validation rewrite, the `setChromeless` / `isChromeless` setters, the `addPointerDownListener` method, the applyOptions writes).
- [src/typescript/lib/component/input/PickerButton.ts](../src/typescript/lib/component/input/PickerButton.ts) — direct refactor; whole file ~60 LoC.
- [src/typescript/lib/component/menubar/MenuBarButton.ts](../src/typescript/lib/component/menubar/MenuBarButton.ts) — direct refactor; the constructor super call and class header change, the rest of the file stays.
- [src/typescript/lib/component/container/WindowHeader.ts](../src/typescript/lib/component/container/WindowHeader.ts) — three call-site rewrites at [WindowHeader.ts:79-89](../src/typescript/lib/component/container/WindowHeader.ts#L79-L89); confirm no other site references the three deleted method calls.
- [src/typescript/lib/component/input/AbstractPickerField.ts](../src/typescript/lib/component/input/AbstractPickerField.ts) — read [AbstractPickerField.ts:50-103](../src/typescript/lib/component/input/AbstractPickerField.ts#L50-L103) to confirm the post-construction glyph-add pattern (still works after PickerButton extends Button).
- [src/typescript/lib/component/menubar/MenuBar.ts](../src/typescript/lib/component/menubar/MenuBar.ts) — read [MenuBar.ts:147-161](../src/typescript/lib/component/menubar/MenuBar.ts#L147-L161) to confirm the constructor signature and option pass-through still match.
- [src/typescript/lib/component/button/ToggleButton.ts](../src/typescript/lib/component/button/ToggleButton.ts), [src/typescript/lib/component/button/TabCloseButton.ts](../src/typescript/lib/component/button/TabCloseButton.ts), [src/typescript/lib/component/input/SpinButton.ts](../src/typescript/lib/component/input/SpinButton.ts), [src/typescript/lib/component/container/AccordionHeader.ts](../src/typescript/lib/component/container/AccordionHeader.ts) — the four kept subclasses; skim each to confirm none pass `chromeless` or `customLayout` (they don't) and that the host changes are non-breaking.
- [src/typescript/lib/component/container/Scrollbar.ts](../src/typescript/lib/component/container/Scrollbar.ts) — read [Scrollbar.ts:95-261](../src/typescript/lib/component/container/Scrollbar.ts#L95-L261) to confirm `ScrollArrowButton` stays out of scope and isn't accidentally touched by Button-side changes.
- [ARCHITECTURE.md](../ARCHITECTURE.md), [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md) — invariants every change must respect (options-bag-as-cache, named listeners, typed setters, one-element-per-class).

---

## Non-Goals

- **Folding `ToggleButton`, `TabCloseButton`, `SpinButton`, `AccordionHeader` into `Button`** — explicitly out of scope per user directive. Each carries specialised behaviour that warrants a subclass.
- **Extracting `ScrollArrowButton`'s / `SpinButton`'s shared hold-repeat scheduler** — both inline the same 400 ms / ×0.75 / 40 ms constants. A `RepeatScheduler` util would deduplicate, but it's separate refactor work.
- **`RadioButton` consolidation** — data surface (`AbstractInput<boolean>`, `Bindable`) and visual surface (ring + dot) both differ from `Button`; folding it would either bloat `Button` or strip semantics.
- **Visual redesign of `Button`** — no new tokens, no shadow tuning, no border restyling. `chromeless` and `customLayout` are opt-out gates; defaults are unchanged.
- **API compatibility shims for `PickerButton` / `MenuBarButton`** — no aliases, no factory functions; the inheritance change is transparent at the call sites because the class names and constructor signatures don't move. Per [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md) and prior consolidation precedents ([box-column-row-consolidation.md](implemented/box-column-row-consolidation.md), [consolidate-menu.md](implemented/consolidate-menu.md)), clean break.
- **Per-piece chrome-off flags (`borderless`, `shadowless`, …) or nullable option fields (`border: null`)** — `chromeless: true` covers every consolidation target in this plan in one flag. Adding finer-grained flags now would be six surface points for zero current consumers.
- **`ButtonGroup` type widening** — `ButtonGroup` continues to accept `RadioButton | ToggleButton` ([ButtonGroup.ts:16](../src/typescript/lib/core/ButtonGroup.ts#L16)); none of the consolidated targets are `ButtonGroup` members.
- **`Button.clearPreferredSize()` to re-enable auto-sizing after consumer override** — once a consumer calls `setPreferredSize`, the `_consumerSetPreferredSize` flag flips and auto-sizing stays off for the lifetime of the instance. A `clearPreferredSize()` method could reset the flag and re-fire `recomputePreferredSize`. Mentioned for future use cases (e.g. "stretch this button temporarily, then let it auto-size again"); not needed by any current consumer.
- **`Button.dispose()` to unregister the theme-change listener** — `Button`'s auto-sizing registers a `ThemeManager.onThemeChange` callback that survives for the application's lifetime. The framework doesn't currently dispose `Button` instances, but if it ever pools or recycles them, the listener will need explicit teardown. Out of scope today; flagged in Potential Challenges so it's visible.
