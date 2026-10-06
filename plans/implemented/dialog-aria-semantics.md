---
depends-on: [modal-dialog-focus-trap]
touches-shared:
  - packages/lib/docs/concepts/accessibility.md
  - packages/lib/docs/reference/changelog/next.md
  - ARCHITECTURE.md
  - packages/lib/src/typescript/lib/overlay/Dialog.ts
  - packages/lib/src/typescript/lib/overlay/AbstractWindow.ts
  - packages/lib/src/typescript/lib/overlay/Drawer.ts
  - packages/lib/src/typescript/lib/overlay/Popover.ts
  - packages/lib/tests/overlay/Dialog.test.ts
  - packages/lib/tests/overlay/Drawer.test.ts
  - packages/lib/tests/overlay/Popover.test.ts
---

# Dialog and Window ARIA Semantics — Implementation Plan

## Overview

A screen-reader user who opens a `Dialog` lands in a modal that is not announced as one. The dialog element is a plain `div`: no role, no accessible name (the text a screen reader speaks for an element), no description. Its title-bar close button is an unnamed button. Measured in Chromium, the accessibility tree (the structure a browser hands to a screen reader) lists a confirm dialog as loose text and three buttons, the first one nameless.[^measured]

`modal-dialog-focus-trap` made modality real and left the semantics out as a non-goal. This plan adds them, for every dialog-like layer the library opens:

- [`Dialog`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L686) gets a role (`dialog` or `alertdialog`), a name taken from its title, a description taken from its message, and a named close button.
- [`Window`](../packages/lib/src/typescript/lib/overlay/Window.ts#L42) and [`TabWindow`](../packages/lib/src/typescript/lib/overlay/TabWindow.ts#L60) become non-modal dialogs with a name, and their minimize, maximize, close and window-menu buttons get names.
- [`Drawer`](../packages/lib/src/typescript/lib/overlay/Drawer.ts#L226) gets the `dialog` role. [`Popover`](../packages/lib/src/typescript/lib/overlay/Popover.ts#L192) already has it and gains a name from its title.
- [`Aria`](../packages/lib/src/typescript/lib/core/Aria.ts#L86) gains `aria-describedby` accessors, a way to remove `aria-labelledby`, and the `alertdialog` role.

No layer gets `aria-modal`. The survey behind each choice, covering every layer including the ones this plan leaves alone, is in [Addendum: ARIA survey of every layer](#addendum-aria-survey-of-every-layer). Nothing in SQLAdmin has to change.

---

## Architecture Decisions

### Roles are set in the constructor, through `getAria()`

Each layer sets its role in its constructor body with `this.getAria().setRole(…)`. This is what [`Popover`](../packages/lib/src/typescript/lib/overlay/Popover.ts#L211) and [`PopupPanel`](../packages/lib/src/typescript/lib/overlay/PopupPanel.ts#L114) already do, and what `ARCHITECTURE.md` prescribes for ARIA. `AriaRole` gains `'alertdialog'`.

| Layer | Role | Set in |
|---|---|---|
| `Dialog` | `config.role`, default `dialog` | `Dialog` constructor |
| `Window`, `TabWindow` | `dialog` | `AbstractWindow` constructor |
| `Drawer`, modal or not | `dialog` | `Drawer` constructor |
| `Popover`, `PopupPanel` | `dialog` | unchanged |

### `inert` is the modality flag; no layer sets `aria-modal`

A modal `Dialog` or `Drawer` does not carry `aria-modal="true"`. The `inert` attribute that `LayerManager` already puts on everything outside the modal is what takes that content away from a screen reader, in every browser.[^no-aria-modal]

`aria-modal` would hide more than `inert` does. It tells a screen reader to ignore everything that is not a DOM descendant of the dialog element. The library mounts a dialog's own dropdowns, menus and popovers on `<html>`, beside the dialog, and keeps toast text readable while a dialog is open. On VoiceOver both would go silent.

`ARCHITECTURE.md` gets one sentence saying so, so that the attribute is not added later.

### A layer is named by reference to the element that shows its title

A dialog-like layer points `aria-labelledby` at the id of the `Text` component that renders its title. The name then follows every later change of that text with no extra code. This mirrors [`Accordion`](../packages/lib/src/typescript/lib/layout/Accordion.ts#L1583) (`wrapper.getAria().setLabelledBy(title.getId())`) and [`Tab`](../packages/lib/src/typescript/lib/layout/Tab.ts#L1757).[^by-reference]

| Layer | Named by | Follows a title change |
|---|---|---|
| `Dialog` | `aria-labelledby` → the title bar's `Text` | yes, `getTitleBar().getTitleText().setText(…)` |
| `Dialog` with `ariaLabel` | `aria-label`, and no `aria-labelledby` | fixed string |
| `Window` | `aria-labelledby` → the header's `Text` | yes, `setHeaderText(…)` |
| `TabWindow` | `aria-label` = the active tab's label | refreshed on `show()` and on each activation |
| `Popover` with a title | `aria-labelledby` → the title `Text` | yes, `setTitle(…)` |
| `Popover` without a title, `Drawer` | nothing by default | the consumer calls `getAria().setLabel(…)` |

### A `TabWindow` reads its name when it is about to be announced

A `TabWindow` has no title element; its title is the active tab's label, read on demand by [`getTitle()`](../packages/lib/src/typescript/lib/overlay/TabWindow.ts#L273). The window therefore writes that label into `aria-label` at the two moments a screen reader announces a window: `show()`, and `onActivate(true)` just before the window takes focus. A new protected hook on `AbstractWindow`, `reflectAccessibleName()`, carries this; its base body is empty and only `TabWindow` overrides it.[^tabwindow-pull]

The override leaves a name alone when a consumer set one through `getAria().setLabel(…)`.

| Sequence | `aria-label` afterwards |
|---|---|
| `show()` with active tab "Query 1" | `Query 1` |
| the user selects "Query 2", then the window is activated again | `Query 2` |
| the user selects "Query 2" and focus stays in the window | still `Query 1` until the next activation |
| the consumer called `getAria().setLabel("Workspace")`, then activation | `Workspace` |
| the strip is empty | attribute absent |

### A `Dialog` is described by its message

When a dialog is built from `message` (not `contentComponent`), `aria-describedby` points at the message text. A screen reader then reads the message when focus enters the dialog, which is how a confirm or error prompt is understood without exploring it. A dialog built from `contentComponent` gets no description.[^description]

| Config | `aria-describedby` |
|---|---|
| `message: 'This cannot be undone.'` | the id of the message `SelectableText` |
| `message` omitted or `''` | absent |
| `contentComponent: form` | absent |

### `Dialog.confirm`, `Dialog.warning` and `Dialog.error` are alert dialogs

`DialogConfig.role` defaults to `'dialog'`. Three shortcuts pass `'alertdialog'`; nothing else is inferred.[^alertdialog]

| Call | Role |
|---|---|
| `Dialog.show({ title, message })`, `new Dialog(config)` | `dialog` |
| `Dialog.info(…)`, `Dialog.success(…)` | `dialog` |
| `Dialog.confirm(…)`, `Dialog.warning(…)`, `Dialog.error(…)` | `alertdialog` |
| `Dialog.show({ …, role: 'alertdialog' })` | `alertdialog` |

### An icon-only title-bar button is a `Button` with a hidden title

Every icon-only title-bar button is built with `text` and `showText: false`. `Button` then writes the text into `aria-label` and shows it as a hover tooltip. This is the library's documented way to name a glyph-only button, used by the table header's menu button ([`TableHeaderMenuButton`](../packages/lib/src/typescript/lib/component/table/Header.ts#L129)) and the editors' toolbars.[^show-text]

| Button | Name |
|---|---|
| `Dialog` title-bar close | `Close` |
| window minimize | `Minimize`; `Restore` while the window is minimized |
| window maximize | `Maximize`; `Restore` while the window is maximized |
| window close | `Close` |
| `TabWindow` leading glyph | `Window menu`, plus `aria-haspopup="menu"` |

The window strings are the ones the window menu already shows for the same actions. They live in one exported constant in `windowControls.ts`. The library has no localisation mechanism: such strings are English module constants (`MENU_BUTTON_LABEL`, `MODIFIED_DESCRIPTION`), and a consumer who needs another language reaches the component and calls its setter.[^strings]

A side effect is visible: these buttons now show a tooltip on hover.

### Consumer overrides: two `DialogConfig` fields, `getAria()` everywhere else

`DialogConfig` gains `role` and `ariaLabel`. They have to be config fields because `Dialog.show(config)` never hands out the instance. Every other layer is an ordinary component the consumer holds, so the existing route applies: `drawer.getAria().setLabel(…)`, and for a window, whose name is a reference, `window.getAria().clearLabelledBy().setLabel(…)`.[^overrides]

### Initial focus is unchanged, except that a hidden `initialFocus` falls back

The existing order in [`Dialog.focusFirst`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1076) already suits both patterns, so it stays.[^initial-focus]

| Dialog | Focus lands on |
|---|---|
| `Dialog.confirm` | Cancel (the `primary` button, the least destructive action) |
| `Dialog.info` / `success` / `warning` / `error` | OK |
| a form in `contentComponent` | `initialFocus`, else the first control in the body |
| nothing focusable | the dialog element itself |

One hole is closed. A dialog is announced when focus enters it. Today an `initialFocus` component that is hidden or disabled when the dialog opens makes the focus call do nothing, so focus rests on `<body>` and nothing is announced. `requestedFocusElement()` now resolves through `visibleFocusable`, the lookup the rest of `focusFirst` uses, and returns `null` for such a component, which falls through to the default order.

---

## Public API

```typescript
// core/Aria.ts

export type AriaRole = /* … existing members … */ | 'alertdialog';

/** New. Removes `aria-labelledby`. The null companion to `setLabelledBy`. */
clearLabelledBy(): this;

/** New. Sets `aria-describedby` to the id of the element that describes this one. */
setDescribedBy(id: string): this;

/** New. The current `aria-describedby` value, or null. */
getDescribedBy(): string | null;

/** New. Removes `aria-describedby`. */
clearDescribedBy(): this;
```

```typescript
// overlay/Dialog.ts

/** New. The ARIA role of a dialog. */
export type DialogRole = 'dialog' | 'alertdialog';

export interface DialogConfig {
    // … existing fields …

    /** New. `'alertdialog'` for a message that interrupts and needs an answer. Defaults to `'dialog'`. */
    role?: DialogRole;

    /** New. Accessible name, replacing the title as the name. An empty string counts as not set. */
    ariaLabel?: string;
}
```

- Both fields are read once, in the constructor. There is no setter and no backing field: after construction the value lives in the dialog's `Aria` (`dialog.getAria().getRole()`), which is also how a consumer changes it later.
- `DialogRole` is added to the type export in [`overlay/index.ts:21`](../packages/lib/src/typescript/lib/overlay/index.ts#L21).
- `Dialog.confirm`, `info`, `success`, `warning`, `error` and `show` keep their signatures.

```typescript
// overlay/AbstractWindow.ts — class AbstractWindow

/** New. Refreshes a name the window derives rather than references. Called from show() and onActivate(true). */
protected reflectAccessibleName(): void;   // base body: empty
```

```typescript
// overlay/windowControls.ts — internal module, not re-exported from overlay/index.ts

export const WINDOW_CONTROL_LABEL: {
    readonly minimize: "Minimize";
    readonly maximize: "Maximize";
    readonly restore:  "Restore";
    readonly close:    "Close";
    readonly menu:     "Window menu";
};

export function createWindowControlButton(glyph: string, title: string): Button;    // `title` is new and required
export function createWindowLeadGlyphButton(glyph: string, title: string): Button;  // `title` is new and required
```

`Window`, `TabWindow`, `Drawer`, `Popover` and `WindowHeader` gain no public member and no option.

---

## Internal Structure

Every new function, method and constant gets a JSDoc block ([CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md)).

### `core/Aria.ts`

`clearLabelledBy` and `clearDescribedBy` copy [`clearLabel`](../packages/lib/src/typescript/lib/core/Aria.ts#L761), including its early return when nothing is cached:

```typescript
clearLabelledBy(): this {
    if (!this._attributes.has("labelledby")) {
        return this;
    }

    this._attributes.delete("labelledby");
    this._component.applyAriaAttribute("aria-labelledby", null);

    return this;
}
```

`setDescribedBy` / `getDescribedBy` copy [`setLabelledBy` / `getLabelledBy`](../packages/lib/src/typescript/lib/core/Aria.ts#L369) with the key `"describedby"`.

### `overlay/Dialog.ts`

```typescript
/** Accessible name and hover text of the title-bar close button. */
const CLOSE_BUTTON_LABEL: string = "Close";
```

```typescript
private applyAriaSemantics(description: Component | null): void {
    const aria = this.getAria();

    aria.setRole(this._config.role ?? "dialog");

    if (this._config.ariaLabel) {
        aria.setLabel(this._config.ariaLabel);
    } else {
        aria.setLabelledBy(this._titleBar.getTitleText().getId());
    }

    if (description !== null) {
        aria.setDescribedBy(description.getId());
    }
}
```

```typescript
private requestedFocusElement(): Handle | null {
    const component = this._config.initialFocus;
    const element   = component?.getElement();

    if (!element) {
        return null;
    }

    // visibleFocusable lists the root first when it is itself a stop, then its
    // descendants, and leaves out anything hidden or disabled.
    return visibleFocusable(element)[0] ?? null;
}
```

### `overlay/TabWindow.ts`

```typescript
// The name this window last wrote into aria-label. A different current value
// means a consumer named the window, and that name is left alone.
private _reflectedName: string | null = null;

protected reflectAccessibleName(): void {
    const aria = this.getAria();

    if (aria.getLabel() !== this._reflectedName) {
        return;
    }

    const title = this.getTitle();

    this._reflectedName = title !== "" ? title : null;

    if (this._reflectedName !== null) {
        aria.setLabel(this._reflectedName);
    } else {
        aria.clearLabel();
    }
}

protected reflectMaximizeState(state: WindowState): void {
    this._maxTool.setText(state === "maximized" ? WINDOW_CONTROL_LABEL.restore : WINDOW_CONTROL_LABEL.maximize);
    this._minTool.setText(state === "minimized" ? WINDOW_CONTROL_LABEL.restore : WINDOW_CONTROL_LABEL.minimize);
}
```

The glyphs of a `TabWindow`'s tools still do not swap; only their names do.

---

## Ordered Implementation Steps

Work test-first. For each step, write the named cases from `## Expected Behaviour`, see them fail, then make the change. Run only the test files a step names until step 12.

1. **Baseline.** From `packages/lib`, run `npx vitest run tests/core/Aria.test.ts tests/overlay/Dialog.test.ts tests/overlay/DialogSeverity.test.ts tests/overlay/Drawer.test.ts tests/overlay/Popover.test.ts tests/overlay/PopupPanel.test.ts tests/overlay/AbstractWindow.activate.test.ts tests/overlay/AbstractWindow.windowMenu.test.ts tests/component/button/WindowControlButton.classStyleHoisting.test.ts tests/component/button/Button.test.ts`. All must pass before any edit.

2. **`Aria`.** In [`core/Aria.ts`](../packages/lib/src/typescript/lib/core/Aria.ts): add `| 'alertdialog'` to `AriaRole` right after `'dialog'` ([:38](../packages/lib/src/typescript/lib/core/Aria.ts#L38)). Add `clearLabelledBy` after `getLabelledBy` ([:380](../packages/lib/src/typescript/lib/core/Aria.ts#L380)), then `setDescribedBy`, `getDescribedBy`, `clearDescribedBy`. Check: cases A1–A4 pass.

3. **`Dialog` — role, name, description.** In [`overlay/Dialog.ts`](../packages/lib/src/typescript/lib/overlay/Dialog.ts):
   - Add `export type DialogRole` above `DialogConfig` ([:109](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L109)) and the two fields after `initialFocus` ([:147](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L147)).
   - In the constructor ([:728](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L728)), declare `let description: Component | null = null;` before the `if (config.contentComponent)` block ([:784](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L784)). In the `else` branch, after `messageText` is added to the container, write `if (config.message) { description = messageText; }`.
   - Call `this.applyAriaSemantics(description);` right after `this.addComponent(this._contentContainer, …)` ([:794](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L794)). `_titleBar` and `_config` are assigned by then.
   - Add `applyAriaSemantics` after `applySeverityHeader`.
   - Add `DialogRole` to the type export in [`overlay/index.ts:21`](../packages/lib/src/typescript/lib/overlay/index.ts#L21).

   Check: cases D1–D10 pass.

4. **`Dialog` — close button.** Add `CLOSE_BUTTON_LABEL` beside the other private constants ([:154](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L154)). In `DialogTitleBar`'s constructor ([:293](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L293)) change `new Button({ glyph: "xmark" })` to `new Button({ glyph: "xmark", text: CLOSE_BUTTON_LABEL, showText: false })`. Leave every following setter call on the button as it is. Check: cases D11–D12 pass.

5. **`Dialog` — shortcuts.** In [`Dialog.confirm`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1691) add `role: 'alertdialog'` to the config. In [`Dialog.alert`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1714) add `role: severity === 'warning' || severity === 'error' ? 'alertdialog' : 'dialog'`. Add one sentence to the JSDoc of `confirm`, `warning` and `error`: the dialog is announced as an alert dialog. Check: cases S1–S3 pass; `tests/overlay/DialogSeverity.test.ts` passes unchanged.

6. **`Dialog` — `initialFocus`.** Replace the body of [`requestedFocusElement`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1127) with the snippet and reword its JSDoc: the result is the first visible, enabled stop of the component, the component's own element included. Keep the `FOCUSABLE_SELECTOR` import; `primaryButtonElement` still uses it. Edit the two existing cases named in `## Verification`. Check: cases F1–F4 pass; the whole of `tests/overlay/Dialog.test.ts` passes.

7. **Window control names.** In [`overlay/windowControls.ts`](../packages/lib/src/typescript/lib/overlay/windowControls.ts):
   - Add `WINDOW_CONTROL_LABEL` above `WindowControlButton`.
   - Give `WindowControlButton` ([:70](../packages/lib/src/typescript/lib/overlay/windowControls.ts#L70)) and `WindowLeadGlyphButton` ([:130](../packages/lib/src/typescript/lib/overlay/windowControls.ts#L130)) the constructor `(glyph: string, title: string, subclassDefaults?: Partial<ButtonOptions>)` and pass `{ glyph, text: title, showText: false, insets: new Insets(2, 2, 2, 2) }` to `super`.
   - Give both factory functions ([:145](../packages/lib/src/typescript/lib/overlay/windowControls.ts#L145), [:159](../packages/lib/src/typescript/lib/overlay/windowControls.ts#L159)) the second parameter and forward it.
   - Update the callers in the same step, or the build breaks. [`WindowHeader.ts:168–170`](../packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L168): `minimize`, `maximize`, `close`. [`TabWindow.ts:95–97`](../packages/lib/src/typescript/lib/overlay/TabWindow.ts#L95): the same three. [`TabWindow.ts:112`](../packages/lib/src/typescript/lib/overlay/TabWindow.ts#L112): `WINDOW_CONTROL_LABEL.menu`, and on the next line `this._leadGlyphBtn.getAria().setHasPopup("menu");`.
   - In `tests/component/button/WindowControlButton.classStyleHoisting.test.ts`, give each of the five factory calls a second argument (`'Close'` for `'xmark'`, `'Window menu'` for the lead glyph).

   Check: `grep -rn "createWindowControlButton(\|createWindowLeadGlyphButton(" packages/lib/src packages/lib/tests` shows two arguments at every call; cases W3 and W5 pass.

8. **Names follow the window state.** In [`WindowHeader.setMaximizeButtonGlyph`](../packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L470) add, after the `setGlyph` call, `this._maximizeButton.setText(name === "window-restore" ? WINDOW_CONTROL_LABEL.restore : WINDOW_CONTROL_LABEL.maximize);`. In [`setMinimizeButtonGlyph`](../packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L488) add the same line for `_minimizeButton` with `WINDOW_CONTROL_LABEL.minimize`. Both signatures stay. In [`TabWindow.reflectMaximizeState`](../packages/lib/src/typescript/lib/overlay/TabWindow.ts#L236) replace the empty body with the snippet, rename the parameter to `state`, and rewrite the JSDoc: the glyph stays, the name follows the state. Update the comment in [`AbstractWindow.ts:2012`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2012) that calls the method a no-op. Check: cases W4 and W6 pass.

9. **Window role and name.**
   - [`AbstractWindow`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) constructor: after `this.getAria().setTabIndex(-1);` ([:444](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L444)) add `this.getAria().setRole("dialog");`.
   - Add `protected reflectAccessibleName(): void {}` after the `reflectMaximizeState` declaration ([:610](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L610)), with a JSDoc block that says when it is called and that the base does nothing.
   - In [`show()`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L765), add `this.reflectAccessibleName();` as the statement after `const el = this.getElement(true)!;`.
   - In [`onActivate`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L934), add `this.reflectAccessibleName();` as the first statement inside `if (active) {`, before `this.focusSelf();`.
   - [`Window`](../packages/lib/src/typescript/lib/overlay/Window.ts) constructor: after the `addTitleGlyphClickListener` line ([:95](../packages/lib/src/typescript/lib/overlay/Window.ts#L95)) add `this.getAria().setLabelledBy(this._header.getText().getId());`.
   - [`TabWindow`](../packages/lib/src/typescript/lib/overlay/TabWindow.ts): add the `_reflectedName` field beside the other fields ([:62](../packages/lib/src/typescript/lib/overlay/TabWindow.ts#L62)) and the `reflectAccessibleName` override after `reflectMaximizeState`.

   Check: cases W1, W2 and W7–W11 pass; `tests/overlay/AbstractWindow.activate.test.ts` passes unchanged.

10. **`Drawer`.** In the [`Drawer`](../packages/lib/src/typescript/lib/overlay/Drawer.ts#L226) constructor, after `this.setPosition(Position.FIXED);` ([:231](../packages/lib/src/typescript/lib/overlay/Drawer.ts#L231)) add `this.getAria().setRole("dialog");`. Check: cases R1–R3 pass.

11. **`Popover`.** In [`setTitle`](../packages/lib/src/typescript/lib/overlay/Popover.ts#L326), after the `if (!this._titleComponent) { … } else { … }` block, add `this.getAria().setLabelledBy(this._titleComponent.getId());`. In [`clearTitle`](../packages/lib/src/typescript/lib/overlay/Popover.ts#L361), inside `if (this._titleComponent) {`, add `this.getAria().clearLabelledBy();`. Check: cases P1–P4 pass.

12. **Documentation.** Make the edits in `## Documentation Impact`.

13. **Verify.** Run `## Verification` in full.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Aria.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/index.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/windowControls.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/WindowHeader.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Window.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/TabWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Drawer.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Popover.ts` |
| Modify | `packages/lib/tests/core/Aria.test.ts` |
| Create | `packages/lib/tests/overlay/Dialog.aria.test.ts` |
| Modify | `packages/lib/tests/overlay/Dialog.test.ts` |
| Create | `packages/lib/tests/overlay/AbstractWindow.aria.test.ts` |
| Modify | `packages/lib/tests/overlay/Drawer.test.ts` |
| Modify | `packages/lib/tests/overlay/Popover.test.ts` |
| Modify | `packages/lib/tests/component/button/WindowControlButton.classStyleHoisting.test.ts` |
| Modify | `packages/lib/docs/components/Dialog.md` |
| Modify | `packages/lib/docs/components/Window.md` |
| Modify | `packages/lib/docs/components/TabWindow.md` |
| Modify | `packages/lib/docs/components/AbstractWindow.md` |
| Modify | `packages/lib/docs/components/Drawer.md` |
| Modify | `packages/lib/docs/components/Popover.md` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/concepts/layering.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `ARCHITECTURE.md` |

---

## Expected Behaviour

Cases A to P are testable offline in the modelled test DOM. "The attribute `x` is `v`" means `DOM.source.getAttribute(component.getElement(true)!, 'x') === v`; "absent" means that call returns `null`. Cases X are checked in Chromium through an accessibility-tree snapshot. Cases MV need a real screen reader.

### `Aria` (offline)

| # | Given | Then |
|---|---|---|
| A1 | a fresh `Aria`; `setDescribedBy('d1')` | `getDescribedBy()` is `null` before, `'d1'` after |
| A2 | a rendered component; `setDescribedBy('d1')`, then `clearDescribedBy()` | the attribute `aria-describedby` is `'d1'`, then absent; the getter is `null` |
| A3 | a rendered component; `setLabelledBy('t1')`, then `clearLabelledBy()` | the attribute `aria-labelledby` is `'t1'`, then absent; the getter is `null` |
| A4 | `clearLabelledBy()` and `clearDescribedBy()` on a fresh `Aria`; `setRole('alertdialog')` | no throw, no attribute write for the two clears; `getRole()` is `'alertdialog'` |

### `Dialog` (offline)

`titleId` is `dialog.getTitleBar().getTitleText().getId()`. `messageId` is `dialog.getContentComponent().getComponents()[0].getId()`.

| # | Given | Then |
|---|---|---|
| D1 | `new Dialog({ title: 'T', message: 'M' })` | the attribute `role` is `'dialog'` |
| D2 | the same with `role: 'alertdialog'` | `role` is `'alertdialog'` |
| D3 | D1 | `aria-labelledby` is `titleId`; `aria-label` is absent; the title text's element carries the id `titleId` |
| D4 | D1 with `ariaLabel: 'Delete record 42'` | `aria-label` is `'Delete record 42'`; `aria-labelledby` is absent |
| D5 | D1 with `ariaLabel: ''` | as D3 |
| D6 | D1 | `aria-describedby` is `messageId` |
| D7 | `new Dialog({ title: 'T', contentComponent: new Component() })` | `aria-describedby` is absent |
| D8 | `new Dialog({ title: 'T' })`, and with `message: ''` | `aria-describedby` is absent |
| D9 | D1, before `show()` and after it | `aria-modal` is absent both times |
| D10 | D1; `dialog.getTitleBar().getTitleText().setText('New')` | `aria-labelledby` is still `titleId`; the title text reads `'New'` |
| D11 | D1 | `dialog.getTitleBar().getCloseButton()!.getAria().getLabel()` is `'Close'` |
| D12 | D1 with `dismissable: false` | `getCloseButton()` is `null`; `role` and `aria-labelledby` are as in D1 and D3 |

### `Dialog` shortcuts (offline)

`Dialog.show` is spied as [`DialogSeverity.test.ts:67`](../packages/lib/tests/overlay/DialogSeverity.test.ts#L67) does; the config is the spy's first argument.

| # | Call | Then |
|---|---|---|
| S1 | `Dialog.confirm('T', 'M')` | `config.role` is `'alertdialog'`; `config.buttons` is unchanged |
| S2 | `Dialog.warning('T', 'M')`, `Dialog.error('T', 'M')` | `config.role` is `'alertdialog'` |
| S3 | `Dialog.info('T', 'M')`, `Dialog.success('T', 'M')` | `config.role` is `'dialog'` |

### `Dialog` initial focus (offline)

The cases use `requestFocusEl()`, the existing white-box seam of [`Dialog.test.ts:61`](../packages/lib/tests/overlay/Dialog.test.ts#L61). `wrapper` is the rendered `initialFocus` component, `field` an `<input>` created through `DOM.sink.createElement`.

| # | Given | Then |
|---|---|---|
| F1 | `setQuerySelectorAllResult(wrapperEl, FOCUSABLE_SELECTOR, [field])` | returns `field` |
| F2 | F1 and `setRenderedVisible(field, false)` | returns `null` |
| F3 | F1 and `field` carries the attribute `disabled` | returns `null` |
| F4 | stops `[hidden, field]` with `hidden` not rendered visible | returns `field` |

### Windows (offline)

`header` is `win.getHeader()`. Buttons are reached white-box, as `(header as any)._maximizeButton` and `(tabWindow as any)._maxTool`.

| # | Given | Then |
|---|---|---|
| W1 | `new Window('Local Storage')`; `new TabWindow()` | the attribute `role` is `'dialog'` on each; `aria-modal` is absent |
| W2 | the `Window` of W1; then `setHeaderText('Storage')` | `aria-labelledby` is `header.getText().getId()` both times |
| W3 | the `Window` of W1 | the labels of `_minimizeButton`, `_maximizeButton`, `_exitButton` are `'Minimize'`, `'Maximize'`, `'Close'` |
| W4 | `header.setMaximizeButtonGlyph('window-restore')`, then `'window-maximize'`; the same for `setMinimizeButtonGlyph` with `'window-restore'` and `'window-minimize'` | the maximize label is `'Restore'`, then `'Maximize'`; the minimize label is `'Restore'`, then `'Minimize'` |
| W5 | `new TabWindow()` | the labels of `_minTool`, `_maxTool`, `_closeTool` are `'Minimize'`, `'Maximize'`, `'Close'`; `_leadGlyphBtn` has the label `'Window menu'` and `getHasPopup()` is `'menu'` |
| W6 | `(tabWindow as any).reflectMaximizeState('maximized')`, then `'minimized'`, then `'normal'` | max tool `'Restore'` and min tool `'Minimize'`; then `'Maximize'` and `'Restore'`; then `'Maximize'` and `'Minimize'` |
| W7 | a `TabWindow` with one tab; `onActivate(true)` | `getAria().getLabel()` equals `tabWindow.getTitle()`, which is not empty |
| W8 | W7; `vi.spyOn(tabWindow, 'getTitle').mockReturnValue('B')`; `onActivate(true)` | the label is `'B'` |
| W9 | W7; `getAria().setLabel('Workspace')`; `onActivate(true)` | the label is `'Workspace'` |
| W10 | `new TabWindow()` with no tab; `onActivate(true)` | the label is `null` |
| W11 | W7; `getTitle` mocked to return `''`; `onActivate(true)` | the label is `null` (the earlier name is removed) |

### `Drawer` (offline)

| # | Given | Then |
|---|---|---|
| R1 | `new Drawer()`; `new Drawer({ modal: true })` | `role` is `'dialog'` on each |
| R2 | the modal drawer of R1 after `open()` | `aria-modal` is absent |
| R3 | `drawer.getAria().setLabel('Filters')`; `open()`; `close()` run to completion | the label is still `'Filters'` |

### `Popover` (offline)

`titleId` is `(popover as any)._titleComponent.getId()`.

| # | Given | Then |
|---|---|---|
| P1 | `new Popover()`; `setTitle('Confirm delete')` | `getAria().getLabelledBy()` is `titleId`; the role is still `'dialog'` |
| P2 | P1; `setTitle('Really?')` | `getLabelledBy()` is the same `titleId` |
| P3 | P1; `clearTitle()` (and `setTitle(null)`) | `getLabelledBy()` is `null` |
| P4 | `new Popover({ title: 'T' })`; `new Popover()` | `getLabelledBy()` is `titleId`; `null` |

### Unchanged (offline)

`tests/overlay/DialogSeverity.test.ts`, `tests/overlay/PopupPanel.test.ts`, `tests/overlay/AbstractWindow.activate.test.ts`, `tests/overlay/AbstractWindow.windowMenu.test.ts`, `tests/overlay/LayerManager.modalFocus.test.ts`, `tests/component/button/Button.test.ts` and `tests/overlay/Menu.test.ts` pass without edits.

### Accessibility-tree snapshot (Chromium)

The demo app, page `#/misc`, driven through chrome-devtools. The lines are what `take_snapshot` prints.

| # | Do | Expect in the snapshot |
|---|---|---|
| X1 | "Dialog — confirm/cancel" | `alertdialog "…" description="…"` holding `button "Close"`, `button "Cancel" focusable focused`, `button "Confirm"`; no control of the page behind |
| X2 | "Dialog — info" | `dialog "…" description="…"`; not `alertdialog` |
| X3 | "Dialog — form (focus stays inside)", open its `ComboBox` with `ArrowDown`; show a toast from the console | `dialog "…"` with no `modal` flag; the dropdown's `listbox` and the toast's `status` or `alert` node are both listed |
| X4 | "Dialog — non-dismissable (mandatory)" | a named `dialog`; no `button "Close"` |
| X5 | "Show window with title glyph", then maximize it | `dialog "<header text>"` holding `button "Minimize"`, `button "Maximize"`, `button "Close"`; after maximizing, `button "Restore"` in place of `"Maximize"` |
| X6 | "Modal drawer from left" | a `dialog` node holding the drawer's controls; no control of the page behind |
| X7 | a popover with a title ("Auto placement") | `dialog "<title>"` |

### Needs manual verification (screen reader)

Run with NVDA on Windows (Firefox and Chrome) and VoiceOver on macOS (Safari). Each row says what to listen for. The planner ran none of them.

| # | Do | Listen for |
|---|---|---|
| MV1 | `Dialog.confirm` | the title, "alert dialog", the message, then "Cancel, button". The message is read once, without exploring |
| MV2 | `Dialog.info`; `Dialog.error` | "dialog" for the first, "alert dialog" for the second; each with its title and message |
| MV3 | a form dialog | the title, "dialog", then the focused field's own label. No message is read |
| MV4 | `Tab` to the title-bar close button | "Close, button" |
| MV5 | in a dialog, move the reading cursor (NVDA arrow keys in browse mode, VoiceOver `VO`+arrows) past the last control | the cursor stays in the dialog; nothing of the page behind is read |
| MV6 | a dialog with a `ComboBox`: open it and arrow through it | each option is announced. This is the case `aria-modal` would break on VoiceOver |
| MV7 | Shift+F10 on a field in a dialog | the menu and each highlighted row are announced |
| MV8 | an error toast while a dialog is open | the toast text is announced. Record separately whether an info toast is announced at all |
| MV9 | a dialog opened from a dialog; close the inner one | the inner dialog is announced with its own name; after it closes, the control that regains focus is announced |
| MV10 | a non-dismissable dialog | announced with its name; no close button can be reached |
| MV11 | click a `Window`; `Tab` through its header buttons; maximize | the header text, "dialog"; "Minimize", "Maximize", "Close"; then "Restore". Record whether NVDA reads the window's whole content when it is activated |
| MV12 | a `TabWindow` with two tabs: activate it, switch tab, activate another window, come back | the active tab's label as the name each time the window is entered; the leading glyph reads "Window menu" and announces a menu |
| MV13 | a modal `Drawer` named with `getAria().setLabel('Filters')` | "Filters, dialog" and its first control |
| MV14 | a `Popover` with a title holding a button; focus the button | the popover's title, "dialog" |
| MV15 | hover each title-bar button | a tooltip with the button's name |
| MV16 | SQLAdmin with the library symlinked: the login dialog, a failed sign-in, "Sign out", the SQL preview dialog, the shortcuts dialog, the Local Storage window | "Connect to database, dialog" and the focused field; "Connection failed, alert dialog" and the message; "Sign out, alert dialog"; each title; the window as in MV11. Nothing in the app behaves differently |

---

## Verification

Where the cases go: A in `tests/core/Aria.test.ts` (a new `describe('Aria — labelledby / describedby')`); D and S in the new `tests/overlay/Dialog.aria.test.ts`; F in `tests/overlay/Dialog.test.ts`, beside the existing `requestedFocusElement()` cases; W in the new `tests/overlay/AbstractWindow.aria.test.ts`; R in `tests/overlay/Drawer.test.ts`; P in `tests/overlay/Popover.test.ts`.

Setup for the two new files:

- Node environment and `installTestDOM(CONFIG)` with the `CONFIG` object of [`DialogSeverity.test.ts:13`](../packages/lib/tests/overlay/DialogSeverity.test.ts#L13); `afterEach(() => DOM.reset())`.
- Import the raw classes: `_Dialog as Dialog` from `~/overlay/Dialog`, `Window` from `~/overlay/Window`, `_TabWindow as TabWindow` from `~/overlay/TabWindow`.
- Dispose every dialog and window a case creates. `LayerManager` is a module singleton, and a layer left registered is written through a released handle by the next modal that opens.
- D9's "after `show()`": call `dialog.show()` without awaiting it, assert, then `dialog.dispose()`.
- W7: give the window a tab with `tabWindow.createTab(new Component())`. Drive activation with `onActivate(true)` directly, as [`AbstractWindow.activate.test.ts:29`](../packages/lib/tests/overlay/AbstractWindow.activate.test.ts#L29) does.

Edits to existing cases in `tests/overlay/Dialog.test.ts`:

- "requestedFocusElement() falls back to the first focusable descendant" ([:1359](../packages/lib/tests/overlay/Dialog.test.ts#L1359)): replace the `querySelector` mock with `setQuerySelectorAllResult(wrapper.getElement(true)!, FOCUSABLE_SELECTOR, [descendant])`. It becomes case F1.
- "requestedFocusElement() is null when the component offers nothing focusable" ([:1373](../packages/lib/tests/overlay/Dialog.test.ts#L1373)): drop the `querySelector` mock; the expectation stays.
- "returns the component root when it is itself focusable" ([:1345](../packages/lib/tests/overlay/Dialog.test.ts#L1345)) must pass unchanged.

Commands, from the repo root:

1. `npm run typecheck`
2. `npm -w packages/lib run typecheck:test`
3. `cd packages/lib && npx vitest run tests/core/Aria.test.ts tests/overlay/Dialog.aria.test.ts tests/overlay/Dialog.test.ts tests/overlay/DialogSeverity.test.ts tests/overlay/AbstractWindow.aria.test.ts tests/overlay/AbstractWindow.activate.test.ts tests/overlay/AbstractWindow.windowMenu.test.ts tests/overlay/Window.headerMoveTrigger.test.ts tests/overlay/Drawer.test.ts tests/overlay/Popover.test.ts tests/overlay/PopupPanel.test.ts tests/overlay/LayerManager.modalFocus.test.ts tests/overlay/Notification.test.ts tests/component/button/WindowControlButton.classStyleHoisting.test.ts tests/component/button/Button.test.ts tests/component/container/TabBar.test.ts tests/component/dispose-full-teardown.test.ts tests/unit/import-without-dom.test.ts`
4. `npm test` — the whole suite.
5. `npm run lint`
6. `npm run docs:api`, then `npm run docs:llms:check`
7. The X cases. From `packages/lib`, start the demo on a spare port, not the configured 8015: `npx vite --port 8091 --strictPort`. Open `http://localhost:8091/#/misc` with chrome-devtools `new_page` and take snapshots with `take_snapshot`. Pass `verbose: true` whenever the assertion is about a `dialog` node: the short form leaves a plain `dialog` container out. Close the page and stop the server afterwards.
8. The MV cases, or a note in the implementation notes listing which were not run.

Grep checks:

- `grep -rn "aria-modal\|setModal(" packages/lib/src/typescript/lib` — exactly two hits, both in `overlay/Drawer.ts`: the `setModal` setter and its call in `applyOptions`. No `aria-modal`.
- `grep -rn 'Button({ glyph: "xmark" })' packages/lib/src/typescript/lib/overlay` — one hit, in `Notification.ts`, whose button is named on the next lines with `getAria().setLabel`.
- `grep -rn "'alertdialog'" packages/lib/src/typescript/lib` — hits in `core/Aria.ts` and `overlay/Dialog.ts` only.

---

## Documentation Impact

No new class is exported, so `llms.txt` needs no entry. `DialogRole` is exported from `overlay/index.ts`; `Aria` is already exported from `core/index.ts`.

- **[`docs/components/Dialog.md`](../packages/lib/docs/components/Dialog.md)**
  - The paragraph under the severity example ([:75](../packages/lib/docs/components/Dialog.md#L75)): add that `Dialog.warning`, `Dialog.error` and `Dialog.confirm` are announced as alert dialogs.
  - The `DialogConfig` table ([:103](../packages/lib/docs/components/Dialog.md#L103)): add rows for `role` (default `'dialog'`) and `ariaLabel` (default: the title).
  - `### Initial focus` ([:115](../packages/lib/docs/components/Dialog.md#L115)): add that an `initialFocus` component that is hidden or disabled when the dialog opens is skipped, and that an alert dialog should mark its least destructive button `primary`, since that is where focus lands.
  - New `### Screen readers` section after `### Keyboard`. Say: the role and the table of shortcuts from `### Dialog.confirm, Dialog.warning and Dialog.error are alert dialogs`; the name comes from the title and follows `getTitleBar().getTitleText().setText(…)`; `ariaLabel` replaces it, and a dialog with an empty title needs one; a `message` is the description and is read when the dialog opens; a `contentComponent` dialog has none, and `dialog.getAria().setDescribedBy(text.getId())` adds one; the close button is named "Close"; the dialog carries no `aria-modal`, with a link to the accessibility page.
- **[`docs/components/Window.md`](../packages/lib/docs/components/Window.md)**: new `## Screen readers` section before `## Gotchas` ([:126](../packages/lib/docs/components/Window.md#L126)). A window is a non-modal dialog named by its header text; `setHeaderText` renames it; the header buttons are named Minimize, Maximize, Close, with Restore while minimized or maximized, and show the name as a tooltip; `getAria().setLabel(…)` cannot override a name given by reference, so call `getAria().clearLabelledBy()` first.
- **[`docs/components/TabWindow.md`](../packages/lib/docs/components/TabWindow.md)**, `## Title, move & controls` ([:72](../packages/lib/docs/components/TabWindow.md#L72)). Title bullet: the title is also the window's accessible name, written when the window is shown and each time it is activated; a name set with `getAria().setLabel(…)` is kept. Window-glyph bullet: named "Window menu". Controls bullet: the three controls are named, and the name (not the glyph) reads "Restore" while minimized or maximized.
- **[`docs/components/AbstractWindow.md`](../packages/lib/docs/components/AbstractWindow.md)**: in the `Window menu` row ([:15](../packages/lib/docs/components/AbstractWindow.md#L15)), replace "(`reflectMaximizeState` is a no-op there)" with: on `TabWindow` the hook renames the tool buttons and leaves their glyphs. Add a row `Accessible role and name`: the base sets `role="dialog"` and calls `reflectAccessibleName()` on show and on activation. In `## What subclasses provide`, add the name refresh to the list of hooks.
- **[`docs/components/Drawer.md`](../packages/lib/docs/components/Drawer.md)**: after the table under `## Modal vs. non-modal` ([:37](../packages/lib/docs/components/Drawer.md#L37)), one paragraph: a drawer has the `dialog` role and no title of its own, so name it with `drawer.getAria().setLabel('Filters')`, or `setLabelledBy(heading.getId())` when it shows a heading.
- **[`docs/components/Popover.md`](../packages/lib/docs/components/Popover.md)**, the `setTitle` row of `## Convenience setters` ([:59](../packages/lib/docs/components/Popover.md#L59)): the title is also the popover's accessible name. One sentence below the table: without a title, name the popover with `getAria().setLabel(…)`.
- **[`docs/concepts/accessibility.md`](../packages/lib/docs/concepts/accessibility.md)**
  - `## Roles used by built-in components` ([:34](../packages/lib/docs/concepts/accessibility.md#L34)): add rows for `Dialog` (`dialog`, or `alertdialog` for `confirm` / `warning` / `error`; named by its title, described by its message), `Window` / `TabWindow` (`dialog`, non-modal, named by the title), and `Drawer` / `Popover` / `PopupPanel` (`dialog`).
  - New `## Dialogs and windows` section before `## Live announcements` ([:297](../packages/lib/docs/concepts/accessibility.md#L297)): the naming table from `### A layer is named by reference to the element that shows its title`; the icon-button rule (`text` plus `showText: false`, link to [Button](/components/Button)); a short "why no `aria-modal`" paragraph — the rest of the application is `inert`, and `aria-modal` would also hide the dialog's own dropdowns and the toasts from VoiceOver; the new `Aria` setters.
  - `## Testing`, the screen-reader bullet ([:313](../packages/lib/docs/concepts/accessibility.md#L313)): add what to listen for — a dialog's title, role and message on open; "Close, button" on the title bar; an open dropdown inside a dialog still being read.
- **[`docs/concepts/layering.md`](../packages/lib/docs/concepts/layering.md)**, `## Modal scope` ([:129](../packages/lib/docs/concepts/layering.md#L129)): one sentence after the first paragraph — a modal layer is modal because of `inert`; it carries no `aria-modal`, which would hide the layers opened from it.
- **[`docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md)**
  - `## Changed` → `### Overlay`: **`Dialog`, `Window`, `TabWindow` and `Drawer` are announced as dialogs.** Role, name and description as above; `confirm` / `warning` / `error` are alert dialogs; no consumer action is needed. And: **Title-bar buttons have names and tooltips** — the dialog's close button, and a window's minimize, maximize, close and window-menu buttons.
  - `## Added` → `### Core`: `Aria.setDescribedBy` / `getDescribedBy` / `clearDescribedBy`, `Aria.clearLabelledBy`, the `'alertdialog'` role.
  - `## Added` → `### Overlay`: `DialogConfig.role`, `DialogConfig.ariaLabel`, `DialogRole`. A `Popover`'s title is its accessible name.
  - `## Fixed` → `### Overlay`: **An `initialFocus` component that is hidden or disabled no longer leaves a dialog without focus.**
- **[`ARCHITECTURE.md`](../ARCHITECTURE.md)**, `## Modal layers` ([:51](../ARCHITECTURE.md#L51)): add to the first paragraph — "No layer sets `aria-modal`: it would hide the layers opened from the modal, which are mounted beside it, and `inert` already hides everything else."

---

## Potential Challenges

- **`Popover.setTitle` runs inside `super()`.** `applyOptions` dispatches it during the base constructor, before `Popover`'s own field initializers have run. The added line only calls `getAria()`, which is safe then. Do not read any other `Popover` field (`_anchorElement`, `_isOpen`) in it.
- **`TabWindow._reflectedName` uses a plain initializer.** That is correct only because `reflectAccessibleName` is never called during `super()`. Keep the two calls in `show()` and `onActivate` and add none to a setter `applyOptions` dispatches.
- **A required parameter on the two factory functions.** Step 7 changes callers and the test file together; `npm run typecheck` and `typecheck:test` fail until all twelve call sites have the argument: seven in source, five in the test file.
- **Tooltips on title-bar buttons are new.** They come with `showText: false` and are intended. A test that counts tooltip attachments on a window or dialog would need its count raised; none was found.
- **`docs:api` must stay at zero warnings.** `reflectAccessibleName` is protected: describe it in prose in public JSDoc, never with `{@link}`.
- **The modelled test DOM reads attributes back after render only.** Call `getElement(true)` before `DOM.source.getAttribute`. Checked for `role` and `aria-labelledby` on a `Dialog` with a throwaway test.

---

## Critical Files

- [`core/Aria.ts`](../packages/lib/src/typescript/lib/core/Aria.ts) — `AriaRole` (:10), `setLabelledBy` (:369), `clearLabel` (:761, the shape to copy), `setAttribute` (:846).
- [`core/Component.ts`](../packages/lib/src/typescript/lib/core/Component.ts#L5894) — `applyAriaAttribute`, the one seam every ARIA write goes through.
- [`overlay/Dialog.ts`](../packages/lib/src/typescript/lib/overlay/Dialog.ts) — `DialogConfig` (:109), `DialogTitleBar` constructor (:272), `Dialog` constructor (:728), `focusFirst` (:1076), `requestedFocusElement` (:1127), `confirm` (:1691), `alert` (:1714).
- [`core/Focusable.ts`](../packages/lib/src/typescript/lib/core/Focusable.ts#L213) — `visibleFocusable`, reused for `initialFocus`.
- [`overlay/windowControls.ts`](../packages/lib/src/typescript/lib/overlay/windowControls.ts) — both button classes and factories.
- [`component/container/WindowHeader.ts`](../packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L168) — the header's three controls and the two glyph setters (:470, :488).
- [`overlay/AbstractWindow.ts`](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) — constructor (:405), the `reflect…` hooks (:563–610), `getTitle` (:628), `show` (:765), `onActivate` (:934).
- [`overlay/Window.ts`](../packages/lib/src/typescript/lib/overlay/Window.ts#L74), [`overlay/TabWindow.ts`](../packages/lib/src/typescript/lib/overlay/TabWindow.ts#L78) — the two constructors.
- [`overlay/Popover.ts`](../packages/lib/src/typescript/lib/overlay/Popover.ts#L211) and [`overlay/PopupPanel.ts`](../packages/lib/src/typescript/lib/overlay/PopupPanel.ts#L114) — the precedent for a role set in the constructor; `PopupPanel.toggleFor` (:187) names itself by reference.
- [`layout/Accordion.ts`](../packages/lib/src/typescript/lib/layout/Accordion.ts#L1583) — the precedent for `aria-labelledby` pointing at a title component's id.
- [`component/table/Header.ts`](../packages/lib/src/typescript/lib/component/table/Header.ts#L129) — `TableHeaderMenuButton`, the precedent for a named icon-only button; [`component/button/Button.ts`](../packages/lib/src/typescript/lib/component/button/Button.ts#L1521) — `_reflectAccessibleName`, which does the work.
- [`tests/overlay/DialogSeverity.test.ts`](../packages/lib/tests/overlay/DialogSeverity.test.ts), [`tests/overlay/PopupPanel.test.ts`](../packages/lib/tests/overlay/PopupPanel.test.ts#L257), [`tests/overlay/AbstractWindow.activate.test.ts`](../packages/lib/tests/overlay/AbstractWindow.activate.test.ts) — the test recipes.
- [`plans/implemented/modal-dialog-focus-trap.md`](implemented/modal-dialog-focus-trap.md) — Implementation Notes, deviation 1 (`inert` is never on `<body>`) and "Left as they are".

---

## Non-Goals

- **`aria-modal`, and an `Aria.setModal` setter.** Decided against; see `### inert is the modality flag`.
- **A name option on `Window`, `Drawer` or `Popover`.** `getAria()` is the existing route and no option in the library carries an ARIA string today.
- **Renaming a `TabWindow` the moment its active tab changes while it stays active.** The name is refreshed on the next activation.[^tabwindow-pull]
- **Names for the tab close button (`TabCloseButton`) and the filter popover's remove button.** Both are unnamed today. They are not title-bar buttons of a layer; a separate change.
- **The `Window` header's title glyph.** It opens the window menu on click but is a `Glyph`, not a button, and cannot be reached from the keyboard. That is keyboard operation, not naming.
- **The `banner` landmark a `WindowHeader` produces.** It renders a `<header>` element, which a browser exposes as a page banner inside the window.
- **`aria-controls` on `ComboBox`, a name for the date and time picker groups, `role="tooltip"` on `Tooltip`, and `aria-expanded` on `RailHandle`.** Found by the survey; none is a dialog.
- **Whether an info or success toast is reliably announced.** Its live region (an element a screen reader announces when its content changes) is created together with its text, which some screen readers miss. MV8 records what happens; a fix is its own plan.
- **A localisation mechanism.** The new strings follow the existing convention of English constants.
- **SQLAdmin changes.** None are needed.[^sqladmin]
- **Conveying a dialog's severity in its name.** The role and the title carry it.

---

## Addendum: ARIA survey of every layer

"Has" was read from the source at `27c9b7157` and, for `Dialog`, `Window`, the `ComboBox` dropdown and the toast, measured in Chromium.[^measured]

| Layer | Has today | Lacks | Right for it | This plan |
|---|---|---|---|---|
| `Dialog`, `Dialog.show` | focus moved in and returned; everything outside `inert`; `Tab` wraps | role, name, description, a name on the close button | `dialog`, named by its title, described by its message | all four |
| `Dialog.confirm` / `warning` / `error` | as above | as above | `alertdialog` | all four |
| `Dialog.info` / `success` | as above | as above | `dialog` | all four |
| `Window` | `tabindex="-1"`; takes focus when activated | role, name, names on minimize / maximize / close | non-modal `dialog`, named by its header text | all |
| `TabWindow` | as `Window`; its strip is a `tablist` | role, name, names on four buttons | non-modal `dialog`, named by the active tab | all |
| `Drawer`, modal | focus moved in and returned; outside `inert` | role, name | `dialog`; only the consumer knows a name | role |
| `Drawer`, non-modal | nothing | role, name | non-modal `dialog` | role |
| `Popover` | `role="dialog"` | a name, although it has a `title` option | named by its title | name |
| `PopupPanel` | `role="dialog"`; `aria-labelledby` its opener; `PopupButton` has `aria-haspopup`, `aria-expanded`, `aria-controls` | — | as it is | none |
| `Menu` | `menu` / `menuitem`; `aria-labelledby` its anchor; `aria-activedescendant` | — | as it is | none |
| `ComboBox` dropdown | field is `combobox` with `aria-expanded`; list is `listbox` | `aria-controls` from the field to the list | combobox pattern | non-goal |
| `AutoCompleteField` dropdown | `combobox`, `aria-autocomplete`, `aria-expanded`, `aria-controls`, `aria-activedescendant` | — | as it is | none |
| date and time picker dropdowns | `role="group"` | a name for the group | a named group | non-goal |
| `Notification` toast | `alert` + `assertive` for error and warning, `status` + `polite` for info and success; badge `aria-hidden`; dismiss button named | a region that exists before its text | live region | non-goal |
| `Rail` | handles are named buttons with `aria-pressed` | a group role and name; `aria-expanded` | toolbar or navigation | non-goal |
| `Tooltip` | nothing | `role="tooltip"`, `aria-describedby` on its target | tooltip pattern | non-goal |

Against the WAI-ARIA dialog patterns:

| The pattern asks | `Dialog` after this plan | `Window` after this plan |
|---|---|---|
| `role="dialog"` or `alertdialog` | yes | `dialog` |
| `aria-modal="true"` on a modal | no; `inert` does the job | not modal, so no |
| `aria-labelledby` or `aria-label` | yes | yes |
| `aria-describedby` for a short message | yes, for `message` dialogs | no |
| focus moves in on open | yes (focus-trap plan) | on activation |
| focus returns on close | yes (focus-trap plan) | not applicable |
| `Tab` wraps inside a modal | yes (focus-trap plan) | no, by design |

---

## Notes

[^measured]: Measured on the worktree base `27c9b7157`, in Chromium on Linux, on the demo's `#/misc` page through chrome-devtools; notes are kept at `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans2/dialog-aria/runtime-prototype.md`. Today `Dialog.confirm('Delete record', 'This cannot be undone.')` gives the snapshot `StaticText "Delete record"`, `button` (no name), `StaticText "This cannot be undone."`, `button "Cancel"`, `button "Confirm"`, all directly under the page root. After setting `role="alertdialog"`, `aria-labelledby` (the title span's id), `aria-describedby` (the message span's id) and `aria-label="Close"` by script, the same dialog reads `alertdialog "Delete record" description="This cannot be undone."` with `button "Close"`. A `Window` given `role="dialog"` and `aria-labelledby` reads `dialog "Local Storage"` with three unnamed buttons. Offline, a throwaway test confirmed that `DOM.source.getAttribute` reads `role` and `aria-labelledby` back, that a `Text`'s element carries `getId()` as its id, and that `new Button({ glyph, text, showText: false })` has the same preferred size as `new Button({ glyph })`. Not measured: Firefox, WebKit, Chrome on macOS, and any screen reader.

[^no-aria-modal]: `aria-modal="true"` asks a screen reader to treat everything outside the element as unavailable. Whether that helps depends on what is outside. In this library three things are outside a modal dialog's element and must stay available. First, its own dropdowns, menus, popovers and nested dialogs: `LayerManager.mount` puts each on `<html>`, as a sibling of the dialog, and `modal-dialog-focus-trap` keeps exactly these live (the modal's *scope*). Second, toast text: that plan makes only a toast's dismiss button inert so the message is still announced. Third, anything not the library's, such as a password manager's menu beside a login field, which is why `inert` is never written to `<body>`. `inert` is applied surface by surface and leaves all three alone. `aria-modal` cannot make that distinction: it is all-or-nothing by DOM containment. Two public reports describe the result on VoiceOver. [w3c/aria-practices#1241](https://github.com/w3c/aria-practices/issues/1241): VoiceOver does not accept an element that is not a DOM descendant of the `aria-modal` element, and `aria-owns` does not help. [w3c/aria#1854](https://github.com/w3c/aria/issues/1854): VoiceOver ignores live regions outside a modal dialog, while JAWS, NVDA and Narrator read them. Measured here, Chromium on Linux does not act on the attribute at all: with `aria-modal="true"` on a dialog and its `ComboBox` open, the dropdown's `listbox` stayed in the accessibility tree and the dialog merely gained a `modal` flag. So where the attribute is honoured it hides the wrong things, and where it is not it changes nothing; in both cases the page behind is already gone because it is `inert` (the focus-trap plan measured the snapshot shrinking from 146 nodes to the dialog's own). The same reasoning covers a modal `Drawer`. Two alternatives were considered and rejected. Setting `aria-modal` only while the modal has no open child layer needs a new `LayerManager` query and an attribute that flips as dropdowns open, and still silences toasts. Declaring the child layers with `aria-owns` is the workaround the first report says does not work. Neither could be tested without VoiceOver. MV5, MV6 and MV8 are the checks that this decision holds on a real screen reader.

[^by-reference]: `aria-labelledby` is resolved by the browser each time the name is asked for, so the name is whatever the title element shows at that moment. An `aria-label` copy of the title would need a write at every place the title can change, and a `Dialog`'s title can be changed from outside through `getTitleBar().getTitleText()`, which the dialog cannot observe. Every component's element carries its component id (`Component.getId()`), so no id has to be invented. `aria-labelledby` takes precedence over `aria-label` in the browser's name computation, which is why `ariaLabel` replaces the reference rather than being added next to it.

[^tabwindow-pull]: A pushed name would need a notification for every way the active tab's label can change: a user selection, a programmatic one, the re-selection after a tab closes, a tab docked in, and a rename. `TabBar` sets the active cell in four places and `Tab` has no single event that covers them; `TabWindow`'s own class comment records that the title "is never cached" and is read on demand. Wiring a push would widen this plan into `Tab.ts` and `TabBar.ts`. Reading the label at `show()` and at activation covers every moment a screen reader announces the window's name, because a window is announced when focus enters it, and `LayerManager` activates a window on both a press and a focus move into it. The cost is the third row of the table: the stored name is stale between a tab switch and the next activation. In that interval the screen reader has just announced the newly selected tab itself.

[^description]: The WAI-ARIA dialog pattern recommends `aria-describedby` for a dialog whose content is a short message and advises against it when the content has structure (a form, a list, a table), because a screen reader reads the description as one flat string. `message` is always plain text and `contentComponent` is by definition structured, so the two config fields already draw that line. A consumer who wants a description on a `contentComponent` dialog calls `dialog.getAria().setDescribedBy(text.getId())` on a constructed dialog; one who wants a long message not to be read calls `clearDescribedBy()`. A `describedBy` config field was considered and left out: nothing asked for it.

[^alertdialog]: An alert dialog is a modal dialog that interrupts the user to give an important message and get a response; the WAI-ARIA pattern names confirmation prompts and error messages as its examples. Info and success messages are acknowledgements, not alerts. Deriving the role from `severity` in the constructor was considered and rejected: `Dialog.show({ severity: 'error', contentComponent: form })` is a tinted form, not an alert, and a rule that looks at two fields is harder to predict than three shortcuts that state their role.

[^show-text]: Two precedents exist. `text` plus `showText: false` is the documented one (`docs/components/Button.md`, "Showing the title in the tooltip only") and gives a sighted mouse user the same word a screen reader gets. The toast's dismiss button uses the other, a bare `getAria().setLabel("Dismiss notification")`, which names the button without a tooltip; it predates `showText` and is left as it is. A required `title` parameter on the two window-control factories, rather than a `setText` call after construction, follows the project's rule that components are configured through options at construction, and makes an unnamed control a compile error.

[^strings]: Searched for `locale`, `i18n`, `localis`, `translate` and for options named `…Label` / `…Text`: the library has no string table and no translation hook. Accessible strings are literals or module constants beside their use: `"Dismiss notification"`, `"Notification history"`, `"Main menu"`, `"More"`, `"Loading"`, `"Column options"`, `"Modified"`. The window menu's rows are literals too. `WINDOW_CONTROL_LABEL` is exported only because two modules (`WindowHeader.ts`, `TabWindow.ts`) need the same five strings.

[^overrides]: No options bag in the library has a field for an ARIA string (searched for `ariaLabel`, `accessibleName` and `label?:`); `ARCHITECTURE.md` routes ARIA through `getAria()`. `DialogConfig` is the one place that route does not reach, because the static shortcuts construct the dialog internally. The field is called `ariaLabel` after the attribute it writes and the `Aria.setLabel` setter it feeds; `label` would read as a visible label, which is what that word means on `Checkbox` and on table columns. On a `Window`, `aria-labelledby` outranks `aria-label`, so an override there is `getAria().clearLabelledBy().setLabel(…)`; `clearLabelledBy` exists for this and for `Popover.clearTitle`.

[^initial-focus]: The WAI-ARIA pattern asks for focus on the least destructive action of a confirmation, on the most likely action of a simple message, and on the first field of a form. `Dialog.confirm` marks Cancel `primary`, the severity shortcuts mark OK `primary`, a message body holds nothing focusable so the primary button wins, and a form's first field comes before the buttons. A dialog with nothing focusable takes focus itself since the focus-trap plan, and now has a role and a name to announce there. The hidden-`initialFocus` case is the first item of that plan's "Left as they are" list that this plan depends on: without focus inside the dialog, none of the new attributes is ever spoken. `DialogConfig.initialFocus` already documents the fixed behaviour ("Ignored when the component has no focusable element on open").

[^sqladmin]: Read, not run (`/home/jika/typescript/sqladmin/frontend/src`). The application calls `Dialog.confirm`, `Dialog.error` and `Dialog.show`, constructs `Dialog` directly (the login dialog with `dismissable: false` and `initialFocus`, `promptQueryName`, `ImportRowsDialog`), subclasses it twice (`DismissDialog`, `SqlPreviewModal`, each passing a config to `super`), and opens one `Window`. It never calls `getTitleBar()`, never sets ARIA on a dialog or window, and uses no `Popover` or `Drawer`. Every dialog passes a non-empty `title`, so each gets a name. What a user of the application notices: confirm and error prompts are announced as alert dialogs with their message, and title-bar buttons show a tooltip. The login dialog's `initialFocus` is a visible field, so the fallback change does not touch it.

---

## Implementation Notes

Built on `feature/scroll-reveal-geometry-fixes` (`e521d512f`). The plan was drafted on that branch before it was rebased onto the current master. Nothing had drifted: every path and line number the plan cites matched the base.

### Decided by the user on 2026-10-10: no `aria-modal` anywhere

Implemented as planned. No `Dialog`, `Drawer`, `Window`, `TabWindow` or `Popover` sets `aria-modal`, and `Aria` has no setter for it. This was the plan's one debatable call, and it could not be tested where it matters.

**The decision.** Accepted as implemented. The screen reader check (VoiceOver, NVDA, JAWS, Firefox and WebKit) stays a manual verification.

**The evidence.**

- `inert` already removes the page. Measured again in Chromium on Linux on this branch: with a dialog open, the accessibility-tree snapshot holds the dialog's own nodes and every node of the page behind is `ignored`.
- `aria-modal` is all-or-nothing by DOM containment. The library mounts a dialog's dropdowns, menus, popovers and nested dialogs on `<html>`, beside the dialog. Toast text is kept readable while a dialog is open.
- Two public reports say what VoiceOver then does. [w3c/aria-practices#1241](https://github.com/w3c/aria-practices/issues/1241): VoiceOver does not accept an element that is not a DOM descendant of the `aria-modal` element, and `aria-owns` does not help. [w3c/aria#1854](https://github.com/w3c/aria/issues/1854): VoiceOver ignores live regions outside a modal dialog.
- Chromium on Linux ignores the attribute. Measured on this branch with `aria-modal="true"` set by script on the open form dialog, its `ComboBox` open and an error toast shown: the dialog reads `dialog "Focus containment" modal`, and the dropdown's `listbox` with its four `option` nodes and the toast's `alert` node are all still listed.

**What was not tested.** VoiceOver, NVDA, JAWS, Firefox and WebKit. The claim that VoiceOver would go silent rests on the two reports alone. MV5, MV6 and MV8 are the checks that decide it.

**What would change if the attribute is wanted.**

- `core/Aria.ts`: a typed `setModal(value: boolean | null)` and `getModal()`, with cases in `tests/core/Aria.test.ts`.
- `overlay/Dialog.ts`: `applyAriaSemantics` calls `aria.setModal(true)`.
- `overlay/Drawer.ts`: `open()` sets it when the drawer opens modal and the close path removes it, since a drawer keeps the modality it opened with.
- Three test cases flip: "never carries aria-modal, before or after it is shown" (`Dialog.aria.test.ts`), "carries no aria-modal while a modal drawer is open" (`Drawer.test.ts`), and the `Window` half of W1 stays as it is.
- Documentation: the sentence in `ARCHITECTURE.md`, `### Why no aria-modal` in `accessibility.md`, the paragraph in `layering.md`, the closing paragraph of `### Screen readers` in `Dialog.md`, the sentence in `Drawer.md` and the changelog entry. The source comments in `Dialog.applyAriaSemantics` and the `Drawer` constructor say the same.
- The plan's grep check `aria-modal\|setModal(` would then match `Aria.ts` and `Dialog.ts` as well.
- If VoiceOver does hide the portaled layers, the attribute would also have to come off while the modal has an open child layer. That needs a new `LayerManager` notification for "the scope changed", and it still leaves toasts silent on VoiceOver. The plan rejected this for that reason.

### Deviations from the plan

1. **The title-bar buttons are reachable through getters.** The plan gives `WindowHeader` and `TabWindow` no public member, and says a consumer who needs another wording "reaches the component and calls its setter". For the window buttons there was no way to reach them: they are private fields. The instruction for this run was that every accessible name is overridable the way the precedent is. The precedent is a public getter that returns the `Button`: `Header.getMenuButton()` on the table header, `DialogTitleBar.getCloseButton()`, `AccordionHeader.getTitleButton()`. Added, in that shape:
   - `WindowHeader.getMinimizeButton()`, `getMaximizeButton()`, `getCloseButton()`.
   - `TabWindow.getMinimizeButton()`, `getMaximizeButton()`, `getCloseButton()`, `getWindowMenuButton()`.
   - `Dialog` already had `getTitleBar().getCloseButton()`.

   The close getter has one name on all three. `WindowHeader`'s older members say "exit" (`addExitButtonListener`, `getExitButtonElement`), and the getter was first called `getExitButton()` to match; the review pointed out that the same control then had two names across `Window` and `TabWindow`, so it follows `DialogTitleBar`, `TabButton` and the header's own `setCloseable`.

2. **A window renames only a button that still carries a library name.** The plan's `setMaximizeButtonGlyph`, `setMinimizeButtonGlyph` and `TabWindow.reflectMaximizeState` call `setText` unconditionally, which would overwrite a consumer's name on the first state change. They go through a new module function, `reflectWindowControlLabel(button, ownLabel, restoring)` in `windowControls.ts`, which writes only when the button's current text is one of the two names the library gives that button: its own and "Restore". The intent is the one behind the plan's `_reflectedName` for a `TabWindow`'s name, that a value the library did not write is the consumer's and is left alone. The mechanism differs: `_reflectedName` remembers the last value written, while this compares against the two possible library names and keeps no state, so a consumer who names a maximize button exactly "Maximize" or "Restore" is not told apart from the library. Cases W4 and W6 hold as written; three cases cover the override.

3. **The window menu reads its row texts from `WINDOW_CONTROL_LABEL`.** `AbstractWindow.buildWindowMenuItems` had the literals `"Minimize"`, `"Maximize"`, `"Restore"` and `"Close"`. The plan says the button names "are the ones the window menu already shows" and "live in one exported constant", which is only true if the menu uses the constant. Same strings, so `AbstractWindow.windowMenu.test.ts` passes unchanged. "Always on top" and "Lock position" stay literals: no button shares them.

4. **The library has no localisation mechanism, as the plan found.** Searched again for `locale`, `i18n`, `translat`, a labels option and a default-label setter. The matches are sort collation and CSS `translate`. The existing mechanism for an icon-only button's name is a module constant passed as `text` with `showText: false`, and that is what was used: `CLOSE_BUTTON_LABEL` in `Dialog.ts` and `WINDOW_CONTROL_LABEL` in `windowControls.ts`. No English literal was added anywhere else in a component.

5. **No source comment contains the string `aria-modal`.** The plan's grep check wants exactly two hits for `aria-modal\|setModal(`, both `Drawer.setModal`. The comments that explain the decision in `Dialog.applyAriaSemantics` and the `Drawer` constructor say "the ARIA modal flag" and point at `ARCHITECTURE.md`. The second review noted the cost: a search of the source for `aria-modal` finds nothing, and the reader has to know to look in `ARCHITECTURE.md`. Kept, because the plan's check is explicit; naming the attribute in the two comments is a two-line change if the check is relaxed.

6. **D3 and D6 check the reference through the document, not through an `id` attribute.** The test DOM keeps a component's id in its own index, not as an attribute, so `getAttribute(el, 'id')` is `null`. The two cases show the dialog and assert that `DOM.source.getElementById(titleId)` is the title text's element, and likewise for the message.

7. **F2, F3 and one added case seed `querySelector`.** Offline, the old lookup's `querySelector` returns `null` for an unseeded selector, so a case that only hides the field passed before the change. `setQuerySelectorResult(FOCUSABLE_SELECTOR, field)` makes the old lookup answer what a browser answers, and the cases then failed first.

8. **A call's result is named before it is tested.** The plan's snippets for `clearLabelledBy`, `clearDescribedBy` and `TabWindow.reflectAccessibleName` put a call in the `if` condition, as `Aria.clearLabel` does. The project rule is to assign the result to a named constant first, so the three do (`hasReference`, `currentLabel`). Nothing else differs from the snippets.

9. **Extra cases** beyond `## Expected Behaviour`: each `Aria` clear writes one removal and none again; the clears chain; a dialog's role is not derived from `severity`; a `message` beside a `contentComponent` gives no description; the close button can be renamed; a hidden `initialFocus` ends with focus on the next visible control (through `show()`); a `Window` carries no `aria-label`; the `clearLabelledBy().setLabel(…)` override; a `Window` follows its state through `reflectMaximizeState`; the tool glyphs of a `TabWindow` stay; the window-menu name survives `setGlyph`; a `TabWindow` is named on `show()`, is not renamed on deactivation, and keeps a name set before the first activation; a popover whose title was cleared and set again points at the new title; a consumer's label on an untitled popover survives `clearTitle()`.

10. **Demo** (`MiscPanel.ts`, not in the file table): "Dialog — alert with an accessible name" uses `role` and `ariaLabel`, and the drawer demo names its drawer with `getAria().setLabelledBy(heading.getId())`.

11. **More documentation than listed.** `Window.md` and `TabWindow.md` describe the getters and the rename rule; `accessibility.md` has a table of where each button is reached; the changelog has an `## Added` → `### Overlay` entry for the getters, and its `## Changed` entry says that a name already set with `getAria().setLabel(…)` on a `Dialog`, a `Window` or a titled `Popover` is now outranked by the reference to the title.

12. **No DOM seam member was added.** Every write goes through `Aria` and `Component.applyAriaAttribute`, so there is no entry under Breaking changes → Core.

13. **A window reflects the state it is constructed in.** Found by the review. The plan wires the names to the transition hook only, and `setWindowState` returns early for a state that is already current, so `new Window('W', { windowState: 'maximized' })` and the `TabWindow` equivalent kept the name "Maximize". `AbstractWindow.initChrome` now calls `reflectMaximizeState(getWindowState())` after its `setWindowState` call. This also corrects something older than the plan: such a `Window` kept the normal state's glyphs on its header buttons. Three cases in `AbstractWindow.aria.test.ts`, and a changelog entry under `## Fixed`.

14. **A `Popover` writes the reference to its title once, and removes only its own.** Found by the review. The plan's step 11 sets `aria-labelledby` on every `setTitle`, which put the reference back after a consumer had replaced it with `clearLabelledBy().setLabel(…)`, the override the changelog recommends. The reference is now written when the title row is created, and only when the consumer has set neither an `aria-label` nor an `aria-labelledby` of their own; `clearTitle()` removes it only while it still points at the title. So a name the consumer set is never replaced or outranked by a later title. P1–P4 hold as written; four cases cover the override. This is a third way of telling the library's name from the consumer's, beside `_reflectedName` and deviation 2, and it is not symmetric with a `TabWindow`: a consumer who removes a titled popover's reference and sets no name leaves it unnamed through later `setTitle` calls, until the title is cleared and set again, while a `TabWindow` takes its name back (deviation 17).

15. **A `Tab` strip's descriptor tools are named** (`component/container/TabBar.ts`, not in the file table), in a code commit and a documentation commit of their own, since the change reaches every `Tab` strip and not only a `TabWindow`'s title bar. Found by the review. `TabBar.buildDescriptorTool` built `new Button({ glyph })` and attached the descriptor's `label` as a tooltip only, so the button had no accessible name. On a `TabWindow` these tools sit in the title bar beside the newly named controls. The button is now built with `text: label, showText: false`, the same mechanism as the window controls, and the separate `Tooltip.attach` call is gone, since the button shows its title as a tooltip itself. The plan's non-goals name the tab close button and the filter popover's remove button as a separate change; descriptor tools were not on that list.

16. **A stale comment was corrected** in `core/Focusable.ts` (not in the file table). Found by the review: `findFocusable`'s comment described the lookup `requestedFocusElement` no longer has.

17. **A `TabWindow` names itself again after the consumer clears the name.** Found by the second review. With the plan's snippet, a `getAria().clearLabel()` after the window had written its name left the stored name unequal to the current one for good, and the window stayed unnamed. A missing label is now treated as nobody's. W9 holds as written; one case covers this.

18. **The name is pinned to arrive before focus, and to be written by `show()`.** Found by the second and third reviews: W7–W11 passed with `reflectAccessibleName()` and `focusSelf()` swapped in `onActivate`, and the "shown" case passed without the call in `show()`, because `show()` also activates the window. One case records the name at the moment the window is focused; the "shown" case silences the activation.

19. **A Breaking-changes entry and a migration note** (`docs/reference/migration/next.md`, not in the file table). Found by the second review. An `aria-label` set after construction on a `Dialog`, a `Window` or a titled `Popover` is now outranked by the title reference, which needs consumer action, and items that do are listed under Breaking changes → Overlay with a note. SQLAdmin sets no ARIA on these layers. **Decided by the user on 2026-10-10:** the breaking change is accepted.

20. **Files changed beyond the plan's file table:** `tests/diagnostics/DiagnosticsOverlay.rowTooltips.test.ts` and `tests/component/container/TabBar.tools.test.ts` (next section), `src/typescript/MiscPanel.ts` (10), `component/container/TabBar.ts` and `docs/layouts/Tab.md` (15), `core/Focusable.ts` (16), `docs/reference/migration/next.md` (19). None of these is in the plan's `touches-shared` list, which matters to a later chained rebase if a sibling branch edits the same file.

### Existing tests whose expected value changed

| Test | Change | Why |
|---|---|---|
| `tests/diagnostics/DiagnosticsOverlay.rowTooltips.test.ts`, case 8 | tooltip count `27` → `30` | The overlay is a `Window`. Its header's three buttons are now named, and a named button shows its name as a tooltip. The plan expected a count like this might exist and found none. |
| `tests/overlay/Dialog.test.ts`, "requestedFocusElement() falls back to the first focusable descendant" | the `querySelector` mock became `setQuerySelectorAllResult`; the expected element is the same | as the plan says (case F1) |
| `tests/overlay/Dialog.test.ts`, "requestedFocusElement() is null when the component offers nothing focusable" | the `querySelector` mock was dropped; the expectation is the same | as the plan says |
| `tests/component/button/WindowControlButton.classStyleHoisting.test.ts` | five factory calls gained the `title` argument; no expectation changed | as the plan says |
| `tests/component/container/TabBar.tools.test.ts`, "builds a flat, tooltip'd Button from a descriptor…" | two assertions were added (the accessible name, and that it is kept off the face); the existing tooltip assertion holds unchanged | deviation 15 |

No other existing test was edited.

### Verification that was run

Whole check set from `packages/lib`: `typecheck`, `typecheck:test`, `lint`, the whole vitest suite (554 files, 9668 passed, 2 todo), `docs:api` (no warnings), `docs:llms:check`, `build:lib`. The plan's three grep checks hold.

Chromium on Linux through chrome-devtools, on this worktree's demo dev server (port 8091), page `#/misc`. Each row is a verbose accessibility-tree snapshot. Demo buttons were pressed by script (`element.click()`); the `ComboBox`, the window's maximize button and the nested-dialog button took real clicks and real key presses. `TabWindow`, the two popovers and the hidden-`initialFocus` dialog were built by script from the served library modules, since the demo has no button for them.

| Case | Snapshot |
|---|---|
| X1, `Dialog.confirm` | `alertdialog "Confirm action" description="Are you sure you want to proceed with this action?"` holding `button "Close"`, `button "Cancel" focusable focused`, `button "Confirm"`; every node of the page is `ignored` |
| X2, `Dialog.info` / `Dialog.success` | `dialog "Import complete" description="Loaded 1,204 rows."`; `dialog "Saved" description="…"`; `button "Close"`, `button "Ok"` focused |
| `Dialog.warning` / `Dialog.error` | `alertdialog "Unsaved changes" description="…"`; `alertdialog "Connection failed" description="Host not allowed."` |
| `Dialog.show({ title, message })` | `dialog "Information" description="…"` |
| `role` + `ariaLabel` (new demo button) | `alertdialog "Delete record 42" description="Record 42 will be removed. This cannot be undone."`; the visible title is "Delete?"; `button "Cancel"` focused |
| X4, non-dismissable | `dialog "Mandatory action required" description="…"`; no `button "Close"` |
| X3, form dialog, `ComboBox` open, an error and an info toast | `dialog "Focus containment"` with no description and no `modal` flag; `listbox` with four `option` nodes; `alert` "Saving failed" and `status` "Draft kept". `ArrowDown` then `Enter` chose "Beta": the dropdown is operable |
| nested dialog from the form | `alertdialog "Nested dialog" description="…"`; the outer dialog is out of the tree |
| X5, `Window` | `dialog "Settings"` holding `banner`, `button "Minimize"`, `button "Maximize"`, `button "Close"`; after a click on Maximize, `button "Restore"`. The page behind stays in the tree |
| hover on a window's Close | a tooltip reading "Close" |
| `TabWindow`, two tabs | `dialog "Query 1"` holding `tablist`, `button "Minimize"`, `button "Maximize"`, `button "Close"` (disabled: the tabs are not closeable), `button "Window menu" haspopup="menu"`. After a click on the second tab the name is still "Query 1"; after the next activation it is "Query 2". Maximized, the tool reads "Restore", then "Maximize" again |
| X6, modal `Drawer` | `dialog "Modal drawer — left"` (named by the demo's heading) holding `textbox "Filter"` focused and `button "Close"`; no control of the page |
| non-modal `Drawer` | `dialog "Non-modal drawer — left"`; the page's controls are still listed |
| X7, titled `Popover` | `dialog "Confirm delete"` |
| untitled `Popover` | `dialog` with no name |
| hidden `initialFocus` | focus is on the next visible field, not on `<body>` |
| a `Window` constructed with `windowState: 'maximized'` (deviation 13) | its maximize button is named "Restore" and shows the restore glyph; minimize is "Minimize" |
| a `TabWindow` with a descriptor tool (deviation 15) | the tool's button is named "New tab", beside "Minimize", "Maximize", "Close" and "Window menu" |
| a titled `Popover` renamed with `clearLabelledBy().setLabel('Mine')`, then `setTitle('T2')` (deviation 14) | `aria-label` is "Mine" and there is no `aria-labelledby` |

No element carried `aria-modal` at any point, nothing was left `inert` afterwards, and the console showed no error or warning.

**Not run.** A real screen reader, Firefox and WebKit. The `verify` skill drives the SQLAdmin application, which was not to be run. The docs application's own tests (`packages/docs`) were run for the corpus checks only: seven files pass (1807 cases), and six do not load in a worktree because they import the built library through the main tree's `node_modules`.

### What to listen for, by hand

Rows MV1–MV16 of `### Needs manual verification (screen reader)` are the list. None was run. Run them with NVDA on Windows in Firefox and Chrome, and with VoiceOver on macOS in Safari. Three rows decide the `aria-modal` question and should come first:

- **MV5.** In a dialog, move the reading cursor past the last control (NVDA arrow keys in browse mode, VoiceOver `VO`+arrows). It must stay in the dialog and read nothing of the page. This is the check that `inert` alone is enough.
- **MV6.** Open the `ComboBox` in the form dialog and arrow through it. Each option must be announced.
- **MV8.** Show an error toast while a dialog is open. Its text must be announced. Note separately whether an info toast is announced at all.

Then, in order: MV1 (the title, "alert dialog", the message once, "Cancel, button"), MV2 ("dialog" for info, "alert dialog" for error), MV3 (a form dialog reads no message), MV4 ("Close, button"), MV7 (a context menu inside a dialog), MV9 (a nested dialog, and the control that regains focus), MV10 (no close button can be reached), MV11 (a `Window`: its header text, "dialog", "Minimize", "Maximize", "Close", then "Restore"; note whether NVDA reads the whole window content on activation), MV12 (a `TabWindow`: the active tab's label as the name on each entry, "Window menu" announcing a menu), MV13 (a named drawer), MV14 (a titled popover), MV15 (a tooltip on each title-bar button), MV16 (SQLAdmin).

Three more things to listen for that the plan does not list:

- Whether "Restore" is announced when the focused maximize button changes its name, or only on the next focus.
- Whether Firefox and Safari expose `alertdialog` with its description the way Chromium's tree does.
- In a `TabWindow`, what is announced after a tab switch inside the active window: the stored name is the previous tab's until the next activation.

### SQLAdmin

Read, not run (`frontend/src`, library `^0.10.0`). No application change is needed. The application sets no ARIA on a dialog or a window, never calls `getTitleBar()`, and uses no `Popover`, `Drawer` or `TabWindow` directly. No dialog has an empty title.

| Where | Built as | Role | Name | Description |
|---|---|---|---|---|
| Login (`shell/LoginDialog.ts`) | `new Dialog`, `dismissable: false`, `initialFocus`, built anew for each attempt of the reopen loop | `dialog` | "Connect to database" | none; the focused field is read |
| A failed sign-in | `Dialog.error` | `alertdialog` | "Connection failed" | the server's message |
| "Save preset", "Save query as" (`promptQueryName.ts`) | `Dialog({ contentComponent })` | `dialog` | the title passed | none |
| Sign out, close-tab guard, replace query, remove saved query, clear storage | `Dialog.confirm` | `alertdialog` | the title passed | the question |
| Delete rows (`dock/TableWorkPanel.ts`) | `Dialog.show({ title, message })` | `dialog` | "Delete rows" | the message |
| SQL preview (`dock/SqlPreviewDialog.ts`) | `SqlPreviewModal extends Dialog` | `dialog` | the DDL title, such as "Create table" | none |
| Import rows (`dock/ImportRowsDialog.ts`) | `new Dialog` | `dialog` | `Import into "<table>"` | none |
| Shortcuts, About, Changelog (`shell/DismissDialog.ts`) | `DismissDialog extends Dialog` | `dialog` | the title passed | none |
| Local Storage (`shell/localStorageWindow.ts`) | `new Window("Local Storage")` | `dialog`, non-modal | "Local Storage" | — |
| A panel floated out of the `Dock` | a library window | `dialog`, non-modal | its header text or active tab | — |

- **Login.** The login dialog has no close button, so it has no "Close" name to announce, and each rebuilt dialog of the loop is announced afresh with the same name. `initialFocus` is `LoginForm.focusTarget(…)`, which always returns a visible field (host, database, username or password), so the fallback change does not touch it.
- **What a user notices.** Confirm and error prompts are announced as alert dialogs with their message. The title-bar buttons of every dialog and of the Local Storage window show a tooltip.
- **Two things the application could do, neither needed.** "Delete rows" is a confirmation built with `Dialog.show`, so it is a plain `dialog`; `role: 'alertdialog'` would announce it as the prompt it is. It also marks no button `primary`, so focus opens on the title-bar close button, which is today's behaviour. And the long dialogs with a `contentComponent` (SQL preview, import) have no description, which is right for a form.

### Left as they are

- **The names are English and there is no application-wide way to change them.** A `Dialog` opened through `Dialog.show` or a shortcut is never handed out, so its close button cannot be renamed; the same is true of the shortcuts' "OK", "Cancel" and "Confirm" texts today. Renaming it for every dialog needs either a `DialogConfig` field or the localisation mechanism the plan lists as a non-goal.
- **A renamed minimize or maximize button keeps one name in every state.** The window no longer swaps it to "Restore", and the consumer has no event for "maximized" to swap it themselves (`"minimize"` and `"restore"` exist; there is none for maximize). A pair of names per button would need an option on the window, which the plan decided against.
- **A `TabWindow`'s name is stale between a tab switch and the next activation**, as the plan says. Seen in Chromium.
- **A window does not take focus when it is shown, so it is not announced then.** Older than this plan, and left alone because this plan must not move focus. `show()` activates the window before it mounts it, so the focus call lands on an element that is not in the document yet. Measured in Chromium: after `new Window(…).show()` the active element is still `<body>`. The window is announced, with its new role and name, when focus first enters it: on a click, or on `Tab` into it. The plan's premise that `show()` is an announcement moment does not hold today; the call there still puts the name in place before the window is in the document. MV11 and MV12 begin with a click, so they do not expose this. A candidate for a follow-up plan.
- **A `WindowHeader` is exposed as a `banner` landmark inside the window**, as the plan's non-goals say. Seen in every window snapshot.
- **A `Window`'s title icon is still not a button.** It opens the window menu on a click only.
- **An untitled `Popover` and a `Drawer` have the `dialog` role and no name** until the consumer gives one. Seen in Chromium for the popover. The library's own popover, the table filter's conditions popover (`component/table/cell/Filter.ts`), is constructed without a title but is given one each time it opens, so it is named.
- **A tab's close button and the filter popover's remove button are still unnamed**, as the plan's non-goals say.
