# Form Component & Dialog `dismissable` Option — Implementation Plan

## Overview

Two independent additions to the typescript-ui library, both extracting UI the consuming sqladmin app was forced to hand-assemble.

1. **A new `Form` component** — a `Panel` subclass that bakes the semantic `<form>` tag, wires an `onSubmit` callback once at construction through the framework's own `Event` API, and exposes a public `requestSubmit()` that reaches the native `HTMLFormElement.requestSubmit()` through the DOM seam. Lives at `src/typescript/lib/core/Form.ts`, exported through [`src/typescript/lib/core/index.ts`](src/typescript/lib/core/index.ts).

2. **A `dismissable?: boolean` option on `Dialog`** (default `true`) — when `false`, the dialog becomes a mandatory modal: no title-bar close button, Escape does not close it, and a backdrop click does not close it (independent of `closeOnBackdrop`). All changes are in [`src/typescript/lib/overlay/Dialog.ts`](src/typescript/lib/overlay/Dialog.ts).

The `requestSubmit()` method forces a new method onto the `DOMSink` seam, which has exactly two implementations: `ProductionDOMSink` ([`src/typescript/lib/core/DOM.ts:1285`](src/typescript/lib/core/DOM.ts#L1285)) and `RecordingDOMSink` ([`tests/dom/TestDOM.ts:266`](tests/dom/TestDOM.ts#L266)). Both must gain it, plus the `DOMSink` interface at [`src/typescript/lib/core/DOM.ts:465`](src/typescript/lib/core/DOM.ts#L465).

Scoped **out**: the downstream sqladmin `loginDialog.ts` rewrite (a different repo that consumes these primitives later). See `## Non-Goals`.

---

## Architecture Decisions

### Form extends `Panel`, not `Container` or `Component`

`Form` is a **content surface** that holds form fields, so it wants `Panel`'s two extras over the lower `Container`: the default 4px perimeter insets and the `autoScroll` stack (a tall form inside a short area should scroll, which is the `Panel` carve-out in [ARCHITECTURE.md](ARCHITECTURE.md) *Size constraints* — a `Panel` clamps to its own explicit min/max and lets overflow scroll, rather than inflating to content size). `Container` gives neither. Both `Panel` and `Container` already provide `components` / `layoutManager` (inherited from `Component`), so either would satisfy the container requirement; `Panel` wins on the scroll/inset behaviour a form surface actually needs. `FormOptions extends PanelOptions`, inheriting `autoScroll`, `insets`, `layoutManager`, `components`, etc.

### Tag baked via the `subclassDefaults` → `_defaultOptions` mechanism

`Component`'s constructor applies the tag from its merged defaults: `if (options?.tag !== undefined) this._tag = options.tag; else if (this._defaultOptions.tag !== undefined) this._tag = this._defaultOptions.tag;` ([`Component.ts:446-449`](src/typescript/lib/core/Component.ts#L446)). `Button` seeds `tag: "button"` in `_defaultButtonOptions` and forwards it as the second `super()` argument ([`Button.ts:222`, `Button.ts:449-451`](src/typescript/lib/component/button/Button.ts#L449)); `Panel`'s constructor is `constructor(options?, subclassDefaults?)` and merges `{ ..._defaultPanelOptions, ...subclassDefaults }` into the `super()` defaults ([`Panel.ts:153-157`](src/typescript/lib/core/Panel.ts#L153)). `Form` mirrors this exactly: `super(options, { tag: "form" })`. This lands `tag: "form"` in `_defaultOptions`, so a consumer who passes no `tag` gets `<form>`, and the value survives the `applyOptions` re-merge. **Do not** call `setAttribute("tag", …)` or touch the element directly — there is no `tag` setter by design; the default-options path is the sanctioned mechanism.

### `onSubmit` is wired once via `Event.addListener(this, "submit", …)` to a named method

`submit` is a real DOM event (it bubbles and is cancelable), so per [ARCHITECTURE.md](ARCHITECTURE.md) *Event handling* it belongs on the `Event` surface, not the `on`/`off`/`emit` custom-event machinery. The framework's single window-level capture handler catches `submit` and routes it to the component whose element id matches the event target ([`Event.ts:110-119`](src/typescript/lib/core/Event.ts#L110)); a `submit` dispatched at the form's own `<form>` element therefore reaches `Event.addListener(this, "submit", …)`. The base listener invokes handlers with `listener.apply(compFunc.component, [evnt])` ([`Event.ts:116`](src/typescript/lib/core/Event.ts#L116)), i.e. with the component as `this`, so passing an **unbound method reference** `this.handleSubmit` is correct and satisfies the *Listeners must reference a named function* rule (no arrow, no `.bind`). Wiring happens in the **constructor body after `super()`** (the deferred-dispatch face of the super-cascade trap), never in `applyOptions`.

`onSubmit` is a plain consumer callback, not a DOM-property write, so the three-rules-for-DOM-writes cache/options plumbing does not apply. It is stored in a private `_onSubmit` field for `handleSubmit` to read. `_onSubmit` is **not** touched during the `super()` cascade (it is assigned in the constructor body), so a plain `private _onSubmit: ((form: Form) => void) | null = null;` initializer is correct — the `declare` rule does **not** apply here (that rule is only for fields a cascade-dispatched setter writes).

### `requestSubmit()` delegates through `DOM.sink`, mirroring `Component.focus`

`Component.getElement()` returns an opaque branded `Handle`, never the live DOM node ([`Component.ts:750`](src/typescript/lib/core/Component.ts#L750)), so `Form.requestSubmit()` cannot call `.requestSubmit()` on it directly. The framework already invokes native element methods through the `DOM.sink` seam: `Component.focus()` resolves `this.getElement()` and calls `DOM.sink.focus(element, …)` ([`Component.ts:3929-3938`](src/typescript/lib/core/Component.ts#L3929)); `ProductionDOMSink.focus` is `(_registry.resolve(handle) as HTMLElement).focus(options)` ([`DOM.ts:1414`](src/typescript/lib/core/DOM.ts#L1414)). `Form.requestSubmit()` mirrors this exactly with a new `DOM.sink.requestSubmit(handle)` method.

### `requestSubmit()`, not `.submit()`

The whole point of `requestSubmit()` is that it fires the **cancelable `submit` event** and runs the form's **constraint validation** before submitting; `HTMLFormElement.submit()` skips both. Only `requestSubmit()` lets the `onSubmit` wiring (and the browser's native validation + password-manager save prompt) run. The production sink therefore calls `.requestSubmit()`, never `.submit()`.

### Both `DOMSink` implementations gain `requestSubmit`; the recording sink models the browser's submit dispatch

The seam has exactly two implementors — `ProductionDOMSink` and the test `RecordingDOMSink` — plus the `DOMSink` interface; all three must be updated or the build breaks. `ProductionDOMSink.requestSubmit` calls the native method. `RecordingDOMSink.requestSubmit` **records the call and then dispatches a modelled `submit` event at the handle** (`this.dispatchEvent(handle, makeEvent(handle, "submit"))`), reproducing what the browser does when native `requestSubmit()` fires `submit` up to the window capture handler. This mirrors the existing precedent where `RecordingDOMSink.dispatchCustomEvent` models browser `CustomEvent` dispatch offline ([`TestDOM.ts:448`](tests/dom/TestDOM.ts#L448)) and where `apply` reflects scalar writes back for round-trip reads. It is what makes `form.requestSubmit()` → `onSubmit` fire **unit-testable** offline; the real native validation/password-manager behaviour stays a manual-verify step.

### The `dismissable` flag reaches `DialogTitleBar` as a constructor parameter

`DialogTitleBar` is constructed once in the `Dialog` constructor ([`Dialog.ts:514`](src/typescript/lib/overlay/Dialog.ts#L514)) and builds its close button unconditionally in its own constructor ([`Dialog.ts:186-207`](src/typescript/lib/overlay/Dialog.ts#L186)). The cleanest thread is a **third constructor parameter** `dismissable: boolean` (its existing signature is `(title, onClose)`). A parameter (rather than a full options bag) matches the class's minimal, positional constructor style and keeps the change surgical. When `false`, the close button is not created, added, or wired at all; `_closeButton` becomes `Button | null` and `doLayout` guards on it. A `getCloseButton(): Button | null` getter (mirroring [`TabButton.getCloseButton()`](src/typescript/lib/component/button/TabButton.ts)) is added so the suppression is unit-testable through the public `Dialog.getTitleBar()` accessor.

### Three dismissal paths gated on `dismissable !== false`; `getDismissMode()` stays `"modal"`

The three paths are gated independently so existing behaviour is byte-for-byte unchanged when `dismissable` is `undefined`:

- **Title-bar close button** — suppressed by not building it (above).
- **Escape** — `LayerManager`'s keydown handler asks the topmost non-`"manual"` layer to close via `requestClose()` ([`LayerManager.ts:554`](src/typescript/lib/core/LayerManager.ts#L554)); `Dialog.requestClose()` ([`Dialog.ts:1038`](src/typescript/lib/overlay/Dialog.ts#L1038)) gains an early `if (this._config.dismissable === false) return;`. `getDismissMode()` deliberately **stays `"modal"`** rather than switching to `"manual"`: a `"manual"` layer would be *skipped* by the Escape loop, letting Escape fall through to close a layer *beneath* the modal — wrong for a mandatory top modal. Keeping `"modal"` + a no-op `requestClose` means Escape is *swallowed* (does nothing), which is the intended behaviour.
- **Backdrop click** — wired in `open()` only when `closeOnBackdrop` ([`Dialog.ts:683-684`](src/typescript/lib/overlay/Dialog.ts#L683)); the guard becomes `if (this._config.closeOnBackdrop && this._config.dismissable !== false)`.

`dismissable` defaults to `true`, so `dismissable === false` is the sole suppression trigger and every existing caller (who passes `undefined`) is unaffected: the title bar passes `config.dismissable !== false` → `true` → close button built exactly as before; `requestClose` proceeds; backdrop wiring unchanged.

---

## Public API

### `Form` (new — `src/typescript/lib/core/Form.ts`)

```typescript
export interface FormOptions extends PanelOptions {
    /**
     * Called after a native form submission is requested — via the submit
     * button, Enter in a field, or `requestSubmit()`. The framework has already
     * called `preventDefault()` on the submit event, so the page will not
     * navigate; the handler owns what submission means.
     */
    onSubmit?: (form: Form) => void;
}

class Form<TOptions extends FormOptions = FormOptions> extends Panel<TOptions> {
    constructor(options?: TOptions);

    /**
     * Requests a native form submission, firing the cancelable `submit` event
     * and running the browser's constraint validation (unlike `.submit()`,
     * which skips both). No-op if the form is not yet rendered.
     */
    requestSubmit(): void;

    private handleSubmit(e: SubmitEvent): void;
}

// callable() export pair (mirror Panel.ts / Container.ts):
const FormCallable = callable(Form);
type FormCallable<TOptions extends FormOptions = FormOptions> = Form<TOptions>;
export {
    Form         as _Form,
    FormCallable as Form,
};
```

Barrel additions in [`src/typescript/lib/core/index.ts`](src/typescript/lib/core/index.ts) (place directly after the `Panel` lines at 21-22):

```typescript
export { Form } from '~/core/Form.js';
export type { FormOptions } from '~/core/Form.js';
```

### `DOMSink.requestSubmit` (new interface method — `src/typescript/lib/core/DOM.ts`)

```typescript
/**
 * Requests a native form submission on a `<form>` element, firing the
 * cancelable `submit` event and running constraint validation.
 *
 * @param handle - The form element to submit.
 */
requestSubmit(handle: Handle): void;
```

### `DialogConfig.dismissable` (new option — `src/typescript/lib/overlay/Dialog.ts`)

```typescript
/**
 * When `false`, the dialog is a mandatory modal: no title-bar close button,
 * Escape does not close it, and a backdrop click does not close it (regardless
 * of `closeOnBackdrop`). Defaults to `true`.
 */
dismissable?: boolean;
```

### `DialogTitleBar` constructor + getter (modified — `src/typescript/lib/overlay/Dialog.ts`)

```typescript
constructor(title: string, onClose: () => void, dismissable: boolean);

/** Returns the close button, or `null` when the title bar is non-dismissable. */
getCloseButton(): Button | null;
```

---

## Internal Structure

### `Form` construction (post-`super()` body)

```typescript
class Form<TOptions extends FormOptions = FormOptions> extends Panel<TOptions> {

    private _onSubmit: ((form: Form) => void) | null = null;

    constructor(options?: TOptions) {
        super(options, { tag: "form" } as Partial<TOptions>);

        // Wire after super() returns: Event.addListener needs the fully
        // constructed component, and this is the deferred-dispatch site the
        // super-cascade trap requires (never applyOptions).
        this._onSubmit = options?.onSubmit ?? null;
        Event.addListener(this, "submit", this.handleSubmit);
    }

    private handleSubmit(e: SubmitEvent): void {
        e.preventDefault();
        this._onSubmit?.(this);
    }

    requestSubmit(): void {
        const element = this.getElement();

        if (!element) {
            return;
        }

        DOM.sink.requestSubmit(element);
    }
}
```

Note: `Event.addListener(this, "submit", this.handleSubmit)` passes an unbound method reference; the base listener applies it with `this` = the form (see Architecture Decisions). Do **not** wrap it in an arrow.

### `DialogTitleBar` close-button suppression

```typescript
private _closeButton: Button | null = null;   // was: readonly, always built

constructor(title: string, onClose: () => void, dismissable: boolean) {
    super();
    // … title text setup unchanged …

    if (dismissable) {
        this._closeButton = new Button({ glyph: "xmark" });
        // … existing close-button styling unchanged …
        this.addComponent(this._closeButton);
        this._closeButton.on("action", onClose);
    }
}
```

In `doLayout` ([`Dialog.ts:278-320`](src/typescript/lib/overlay/Dialog.ts#L278)): compute the label's right bound from whether the close button exists, and guard the close-button placement:

```typescript
const rightBound = this._closeButton
    ? (w - CLOSE_SIZE - TITLE_RIGHT_GAP)   // reserve close-button slot (existing closeX)
    : (w - TITLE_H_PAD);                   // no button: label runs to the right pad

const labelWidth = Math.max(0, rightBound - labelX - TITLE_RIGHT_GAP);
// … set label X/Y/width/height using labelWidth …

if (this._closeButton) {
    // existing close-button positioning block, unchanged
}
```

### `Dialog` wiring changes

- Constructor ([`Dialog.ts:514`](src/typescript/lib/overlay/Dialog.ts#L514)): `new DialogTitleBar(config.title, () => this.hide('close'), config.dismissable !== false)`.
- `open()` backdrop guard ([`Dialog.ts:683`](src/typescript/lib/overlay/Dialog.ts#L683)): `if (this._config.closeOnBackdrop && this._config.dismissable !== false)`.
- `requestClose()` ([`Dialog.ts:1038`](src/typescript/lib/overlay/Dialog.ts#L1038)): early-return `if (this._config.dismissable === false) return;` before `this.hide('close')`.

---

## Ordered Implementation Steps

1. **`src/typescript/lib/core/DOM.ts`** — add `requestSubmit(handle: Handle): void` to the `DOMSink` interface (near `focus`, ~line 574) with JSDoc; add the impl to `ProductionDOMSink` (near `focus` at line 1414): `requestSubmit(handle: Handle): void { (_registry.resolve(handle) as HTMLFormElement).requestSubmit(); }` with `/** @inheritDoc */`.

2. **`tests/dom/TestDOM.ts`** — add `requestSubmit` to `RecordingDOMSink` (near `focus`/`click`, ~line 378-482): record `'requestSubmit'` then `this.dispatchEvent(handle, makeEvent(handle, "submit"));`. (`makeEvent` is defined in the same file.)

3. **`src/typescript/lib/core/Form.ts`** — create the file. Imports: `Panel, PanelOptions` from `~/core/Panel.js`; `Event` from `~/core/Event.js`; `DOM` from `~/core/DOM.js`; `callable` from `~/core/Callable.js`. Implement `FormOptions`, `Form` (per `## Internal Structure`), and the `callable()` export pair (mirror the tail of [`Container.ts`](src/typescript/lib/core/Container.ts) / [`Panel.ts`](src/typescript/lib/core/Panel.ts)). Full JSDoc per conventions.

4. **`src/typescript/lib/core/index.ts`** — add the `Form` value + `FormOptions` type exports after the `Panel` lines (21-22).

5. **`src/typescript/lib/overlay/Dialog.ts`** —
   a. Add `dismissable?: boolean` to `DialogConfig` (after `closeOnBackdrop`, ~line 80) with JSDoc.
   b. `DialogTitleBar`: change `_closeButton` to `Button | null = null`; add the `dismissable` constructor param; wrap close-button build in `if (dismissable)`; add `getCloseButton()` getter; guard `doLayout` and adjust the label right-bound (per `## Internal Structure`).
   c. `Dialog` constructor: pass `config.dismissable !== false` to `DialogTitleBar`.
   d. `open()`: extend the backdrop guard with `&& this._config.dismissable !== false`.
   e. `requestClose()`: early-return when `this._config.dismissable === false`.

6. **`src/typescript/MiscPanel.ts`** (demo) — in the dialog-button block (~line 1094), add a `"Dialog — non-dismissable (mandatory)"` button that calls `Dialog.show({ title, message, dismissable: false, buttons: [{ text: 'OK', result: 'confirm', primary: true }] })`. Add a small `Form` demo: a `Form({ layoutManager: new VBox(), components: [ /* a couple of TextFields */ ], onSubmit: (f) => Notification.show('submitted', 'success') })` plus an **external** `Button("Submit").on("action", () => form.requestSubmit())`. Add the `Form` import from `@jimka/typescript-ui/core`.

7. **Tests** — create `tests/core/Form.test.ts` (drift note: the plan originally said `tests/component/core/Form.test.ts`, but the repo's actual convention mirrors `src/typescript/lib/core/*.ts` under `tests/core/*.test.ts` — e.g. `Aria.ts` → `tests/core/Aria.test.ts`, `Body.ts` → `tests/core/Body.test.ts` — so the file lives at `tests/core/Form.test.ts` instead); extend `tests/overlay/Dialog.test.ts` (per `## Verification`).

8. **Docs** — create `docs/components/Form.md`; add a `Form` row to `docs/components/index.md`; add a `Form` sidebar entry to `docs/.vitepress/config.mts` (Inputs group); add a `dismissable` row to the `DialogConfig` table in `docs/components/Dialog.md`; add a `Form` catalog entry to `scripts/llms/manifest.data.mjs` (Inputs / Forms group). Then run `npm run docs:build` — must finish with zero warnings and the manifest must resolve the `Form` symbol.

9. **Checkpoints** — `grep -rn "requestSubmit" src/typescript/lib/core/DOM.ts tests/dom/TestDOM.ts` → expect the interface + both sinks. `npm run typecheck` (or `tsc --noEmit`) green.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/core/Form.ts` |
| Create | `tests/core/Form.test.ts` |
| Create | `docs/components/Form.md` |
| Modify | `src/typescript/lib/core/DOM.ts` (DOMSink interface + ProductionDOMSink) |
| Modify | `tests/dom/TestDOM.ts` (RecordingDOMSink) |
| Modify | `src/typescript/lib/core/index.ts` (barrel exports) |
| Modify | `src/typescript/lib/overlay/Dialog.ts` (DialogConfig, DialogTitleBar, Dialog) |
| Modify | `src/typescript/MiscPanel.ts` (demo) |
| Modify | `tests/overlay/Dialog.test.ts` (dismissable cases) |
| Modify | `docs/components/index.md` (catalog row) |
| Modify | `docs/components/Dialog.md` (dismissable option row) |
| Modify | `docs/.vitepress/config.mts` (Form sidebar entry) |
| Modify | `scripts/llms/manifest.data.mjs` (Form catalog entry) |

---

## Expected Behaviour

### Form (unit-testable)

- **Renders a `<form>` element.** A rendered `Form` (`form.getElement(true)`) produces a `createElement` sink write with tag `"form"`; `form.getTag()` returns `"form"`. Assert via the recording sink's `writes` (mirror the `countWrites`/`createElement` pattern in [`tests/component/button/TabButton.test.ts`](tests/component/button/TabButton.test.ts)).
- **`onSubmit` fires exactly once with `preventDefault` applied.** With a `vi.fn()` `onSubmit`, dispatching a `submit` event whose `preventDefault` is a spy at the rendered form's handle (build the event mirroring the `enterEvent()` helper in [`tests/overlay/Dialog.test.ts`](tests/overlay/Dialog.test.ts), with `target` a sentinel resolving to the form handle) invokes `onSubmit` once with the form instance, and the `preventDefault` spy was called.
- **`requestSubmit()` triggers the wired submit.** After render, `form.requestSubmit()` records a `requestSubmit` sink write **and** (through the recording sink's modelled submit dispatch) invokes the `onSubmit` spy exactly once. A `requestSubmit()` on an unrendered form is a no-op (no throw, no write).
- **Is a `Panel`.** `new Form()` `instanceof Panel` (the callable preserves the prototype chain); inherited options such as `autoScroll` and `layoutManager` apply.

### Form (manual-verify)

- In a real browser, `requestSubmit()` runs native **constraint validation** (a `required` empty field blocks submission and shows the native bubble) and triggers the browser's **password-manager save** flow for a form containing username/password fields. The offline harness cannot exercise native validation or the password manager.

### Dialog `dismissable` (unit-testable)

- **Default (`dismissable` omitted) is unchanged.** `getTitleBar().getCloseButton()` is a `Button`; `getDismissMode()` is `"modal"`; `requestClose()` closes (resolves the show-promise with `'close'`); a `closeOnBackdrop: true` dialog still wires the backdrop click.
- **`dismissable: false` suppresses the close button.** `getTitleBar().getCloseButton()` is `null`.
- **`dismissable: false` makes `requestClose()` a no-op.** Calling `requestClose()` does not resolve the show-promise / does not call `hide` (assert the promise stays pending, e.g. via a race against a sentinel, or spy on `hide`). This is the Escape path (LayerManager routes Escape → `requestClose`).
- **`dismissable: false` does not wire the backdrop even with `closeOnBackdrop: true`.** After `show()` with both flags, the backdrop has no close-on-click listener (assert no `hide`/resolve on a modelled backdrop click, or that the backdrop click listener was never added).
- **`getDismissMode()` stays `"modal"`** for a non-dismissable dialog (Escape is swallowed, not delegated downward).

### Dialog `dismissable` (manual-verify)

- Visual: a `dismissable: false` dialog shows no ✕ in the title bar and the title label extends into the reclaimed space; pressing Escape and clicking the backdrop leave it open; its footer buttons still close it. Exercise via the new MiscPanel demo button.

---

## Verification

- **Typecheck:** `npm run typecheck` (or `tsc --noEmit`) green — in a worktree, symlink `node_modules` from the main checkout first if a tool needs it.
- **Unit tests:** `npx vitest run tests/core/Form.test.ts tests/overlay/Dialog.test.ts` — all `## Expected Behaviour` unit cases pass.
- **Seam grep:** `grep -rn "requestSubmit" src/typescript/lib/core/DOM.ts tests/dom/TestDOM.ts` — interface + `ProductionDOMSink` + `RecordingDOMSink` present (three sites).
- **Docs build:** `npm run docs:build` — zero TypeDoc warnings (no `{@link}` to non-exported symbols in the new `Form` JSDoc), and `docs:llms` resolves the new `Form` manifest symbol against the TypeDoc model (an unresolved symbol fails the build).
- **Manual smoke:** run the demo app, open the **Misc.** tab; exercise the `Form` submit button (external button → `requestSubmit()` → notification) and the non-dismissable dialog button (no ✕, Escape/backdrop inert, footer button closes).

---

## Documentation Impact

- **`Form`** is exported from the `core` barrel → `@jimka/typescript-ui/core`. Add:
  - `docs/components/Form.md` — a component page (mirror the structure of an existing simple page; the `docs:llms` generator auto-derives the catalog link from `docs/components/<Name>.md`).
  - A row in the flat catalog `docs/components/index.md` (Inputs section).
  - A sidebar entry in `docs/.vitepress/config.mts` under the Inputs group (mirror the `TextField` line).
  - A catalog entry `{ task: "Semantic <form> container with submit handling", symbol: "Form" }` in the **Inputs / Forms** group of `scripts/llms/manifest.data.mjs` (the symbol must exist in the TypeDoc model — guaranteed by the barrel export).
- **`Dialog.dismissable`** — add a `| \`dismissable\` | \`true\` | When \`false\`, mandatory modal: no close button, Escape/backdrop inert. |` row to the `DialogConfig` options table in `docs/components/Dialog.md`. No new page or sidebar entry (it is an option on an existing component). The TypeDoc-generated `DialogConfig` interface page picks up the JSDoc automatically.
- **JSDoc link hygiene:** the new `Form` public JSDoc must only `{@link}` exported, non-internal symbols (`Panel`, `Component`) per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) — describe `handleSubmit`/`_onSubmit` in prose, never link them.
- The `tests/unit/llms-generate.test.ts` suite uses a **synthetic** TypeDoc model, so it does not need editing; it exercises the generator's pure helpers, not the real catalog.

---

## Potential Challenges

- **Recording sink submit modelling.** If `RecordingDOMSink.requestSubmit` only recorded (like `click`) without dispatching, the `requestSubmit → onSubmit` unit test could not observe the callback. Modelling the submit dispatch (per Architecture Decisions) is deliberate and mirrors `dispatchCustomEvent`; keep the two in the same offline-modelling spirit.
- **Label width when the close button is gone.** Missing the `doLayout` right-bound adjustment leaves the title truncated to the old close-button-reserved width — verify the label uses the reclaimed space in the non-dismissable case (visual manual check).
- **`DialogTitleBar` is exported.** Its constructor gains a required third parameter; this is a public-signature change. Every internal construction site is the single one in `Dialog`'s constructor — grep `new DialogTitleBar` to confirm there is exactly one caller before changing the signature.
- **Do not switch `getDismissMode()` to `"manual"`** for non-dismissable dialogs — it would let Escape close a layer beneath the modal. Gate `requestClose` instead.

---

## Critical Files

- [`src/typescript/lib/core/Panel.ts`](src/typescript/lib/core/Panel.ts) — base class; `constructor(options?, subclassDefaults?)` tag-forwarding + `callable()` export pair to mirror.
- [`src/typescript/lib/core/Container.ts`](src/typescript/lib/core/Container.ts) — simplest `callable()` export-pair template.
- [`src/typescript/lib/component/button/Button.ts`](src/typescript/lib/component/button/Button.ts) (`_defaultButtonOptions` at line 222, constructor at 432) — the tag-baking-via-defaults reference.
- [`src/typescript/lib/core/Component.ts`](src/typescript/lib/core/Component.ts) — tag application (446-449); `getElement` returning `Handle` (750); `focus()` (3929) as the `getElement → DOM.sink.<native>` template.
- [`src/typescript/lib/core/DOM.ts`](src/typescript/lib/core/DOM.ts) — `DOMSink` interface (465), `ProductionDOMSink.focus` (1414) to mirror.
- [`tests/dom/TestDOM.ts`](tests/dom/TestDOM.ts) — `RecordingDOMSink` (266), `makeEvent` (1129), `dispatchEvent`/`dispatchCustomEvent` (429/448).
- [`src/typescript/lib/core/Event.ts`](src/typescript/lib/core/Event.ts) — `addListener` (226) and the base-listener target-id routing (95-119).
- [`src/typescript/lib/overlay/Dialog.ts`](src/typescript/lib/overlay/Dialog.ts) — `DialogConfig` (63), `DialogTitleBar` (156) + its `doLayout` (278), `Dialog` constructor (484), `open()` (680), `requestClose()` (1038).
- [`src/typescript/lib/core/LayerManager.ts`](src/typescript/lib/core/LayerManager.ts) — `DismissableLayer` (41), Escape `onKeyDown` → `requestClose` (541-556).
- [`tests/overlay/Dialog.test.ts`](tests/overlay/Dialog.test.ts) — white-box test style (`_Dialog`, `TestDialog`, `enterEvent`).
- [`src/typescript/MiscPanel.ts`](src/typescript/MiscPanel.ts) — existing Dialog demo block (~1074-1104) to extend.

---

## Non-Goals

- **The sqladmin `loginDialog.ts` rewrite.** Replacing the app's reconstruct-on-close non-dismissability hack and its hand-assembled `{tag:"form"}` panel with these new primitives is downstream work in the separate sqladmin repo; it consumes this release, it is not part of it.
- **An `on("submit", fn)` semantic shorthand on `Form`.** The task specifies the `onSubmit` option wired via `Event.addListener`; a richer `on`/`off` submit surface is not requested and is not added here.
- **Runtime `setOnSubmit` / re-wiring.** `onSubmit` is wired once at construction, matching the intended thin-app usage.
- **Any change to `.submit()` semantics or a `submit()` method** — only `requestSubmit()` is exposed, by design.
