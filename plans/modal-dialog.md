# Modal Dialog — Implementation Plan

## Overview

This plan describes adding a `Dialog` component to the framework at `Base/Dialog.ts`, along with a `DialogBackdrop` helper and all necessary modifications to `Theme.ts` and `index.ts`. The design follows every convention in the codebase: `Component` subclasses only, CSS via setter API, `Event` namespace for all listeners, tokens in `Theme`, appending to `document.documentElement`.

---

## Architecture Decisions

### 1. New standalone class, not an extension of `Window`

`Window` is tightly coupled to dragging, resizing, and the `WindowBorder`/`WindowHeader` subsystem. A modal dialog is a fundamentally different interaction model: it is not draggable or resizable by default, it owns a backdrop, it manages focus containment, and it can be driven entirely by configuration. Extending `Window` would force `Dialog` to inherit machinery that must be suppressed. A new `Dialog extends Component` shares only the common base.

### 2. Separate `DialogBackdrop` component, not an inline element inside `Dialog`

The backdrop must sit at a lower z-index than the dialog panel but still above all regular content. Both are logically siblings appended to `document.documentElement`, mirroring how `Notification` and `ContextMenu` work. Giving the backdrop its own `Component` subclass keeps it in the framework lifecycle (`getElement()`, `removeElement()`, `destructor()`).

### 3. Static `Dialog.show(config)` convenience API, mirroring `Notification.show()`

Callers that want a one-shot confirm/cancel prompt should not have to manage an instance. The static method creates a `Dialog` internally and returns a `Promise<DialogResult>` that resolves when the user dismisses it. The instance API is also public for callers who need fine-grained control.

### 4. Focus trap via a document-level `keydown` capture listener

The `inert` attribute would require enumerating and marking every sibling of the backdrop, which is fragile. A capture-phase `keydown` listener that intercepts `Tab`/`Shift-Tab` and cycles focus within the dialog's focusable descendants is self-contained and portable. `Event.addViewportListener` is not used here because it calls `stopPropagation`, which would break other keyboard listeners. `document.addEventListener` is used directly, as `Window.ts` already does for drag.

### 5. Z-index layering

`Window` starts at 9000. `ContextMenu` uses 10000. `Notification` uses 10002. Proposed:
- `DialogBackdrop`: 10100
- `Dialog` panel: 10101 + (instance counter × 2), allowing stacked dialogs to layer correctly.

---

## New Files

### `Base/Dialog.ts`

The main public-facing class. Contains the `Dialog` component and its static `show` API, plus exported interfaces and the `DialogResult` type.

**Responsibilities:**
- Creates and owns a `DialogBackdrop` sibling.
- Builds internal layout: `Border` manager with a title bar in NORTH, scrollable content area in CENTER, and button row in SOUTH.
- Registers a document-level capture `keydown` listener for Escape and Tab focus trapping.
- Manages focus: on open, focuses the first focusable descendant; on close, restores focus to the previously active element.
- Exposes `show()` / `hide()` instance methods and the static `Dialog.show(config)` convenience.
- Resolves the returned `Promise<DialogResult>` on any close action.
- Calls `this.destructor()` and `backdrop.destructor()` on close.

**Public API:**

```typescript
export type DialogResult = 'confirm' | 'cancel' | 'close';

export interface DialogButtonConfig {
    text    : string;
    result? : DialogResult;  // defaults to 'cancel'
    primary?: boolean;
}

export interface DialogConfig {
    title            : string;
    message?         : string;           // plain text; ignored if contentComponent is set
    contentComponent?: Component;
    buttons?         : DialogButtonConfig[];  // defaults to [{ text: 'OK', result: 'confirm', primary: true }]
    width?           : number;           // default 480
    height?          : number;           // default 'auto'
    closeOnBackdrop? : boolean;          // default false
}

export class Dialog extends Component {
    static show(config: DialogConfig): Promise<DialogResult>;

    constructor(config: DialogConfig);

    show(): Promise<DialogResult>;

    hide(result: DialogResult): void;

    getContentComponent(): Component;
}
```

### `Base/component/DialogBackdrop.ts`

A thin full-viewport overlay that visually blocks content behind a dialog.

**Responsibilities:**
- Extends `Component`.
- Uses `Position.FIXED`, full viewport size, z-index 10100.
- Sets `backgroundColor` to `var(--ts-ui-dialog-backdrop-bg)`.
- Exposes `addClickListener(listener: Function): void` via `Event.addListener` for the optional close-on-backdrop-click behaviour.

---

## Existing Files to Modify

### `Base/Theme.ts`

Add to the `Theme` interface (after the `notification` block):
```typescript
dialog: {
    backdrop: {
        background: string;
    };
    shadow: string;
};
```

Add to `DefaultTheme`:
```typescript
dialog: {
    backdrop: { background: 'rgba(0, 0, 0, 0.45)' },
    shadow  : '4px 8px 24px rgba(0, 0, 0, 0.35)',
},
```

Add to `DarkTheme`:
```typescript
dialog: {
    backdrop: { background: 'rgba(0, 0, 0, 0.65)' },
    shadow  : '4px 8px 24px rgba(0, 0, 0, 0.6)',
},
```

Add to `themeToVars`:
```typescript
'--ts-ui-dialog-backdrop-bg': theme.dialog.backdrop.background,
'--ts-ui-dialog-shadow'     : theme.dialog.shadow,
```

### `Base/index.ts`

Add exports:
```typescript
export { Dialog } from './Dialog.js';
export type { DialogConfig, DialogButtonConfig, DialogResult } from './Dialog.js';
```

---

## Internal Structure of `Dialog`

```
document.documentElement
  ├── ... (existing Body children)
  ├── ... (Window instances)
  ├── <div id="...">   ← DialogBackdrop  (z-index 10100, position fixed, full viewport)
  └── <div id="...">   ← Dialog          (z-index 10101, position fixed, centered)
        └── Border layout:
              NORTH  → title bar (Label + optional close button)
              CENTER → contentContainer (Fit layout, holds contentComponent or message Label)
              SOUTH  → buttonRow (HBox layout, holds Button instances)
```

The `Dialog` component uses `Position.FIXED` and is centered by computing `(viewportWidth - dialogWidth) / 2` and `(viewportHeight - dialogHeight) / 2` as `x` / `y`, matching how `Notification.restack()` positions its toasts.

---

## Focus Trapping Detail

**On `show()`:**
1. Record `document.activeElement` as `this.previousFocus`.
2. After appending to DOM and calling `doLayout()`, call `this.focusFirst()`.
3. `focusFirst()` queries the dialog element for `button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])`, finds the first visible one, and calls `.focus()`.
4. Register `this.boundKeyHandler` via `document.addEventListener('keydown', this.boundKeyHandler, true)` (capture phase).

**`boundKeyHandler` logic:**
- If `key === 'Escape'`: call `this.hide('close')`.
- If `key === 'Tab'`: collect focusable elements inside the dialog. If `shiftKey` and focus is on the first element, wrap to the last (and `preventDefault`). If not `shiftKey` and focus is on the last element, wrap to the first (and `preventDefault`). Otherwise let the browser handle normally.

**On `hide()`:**
1. `document.removeEventListener('keydown', this.boundKeyHandler, true)`.
2. Remove backdrop and dialog elements; call `destructor()` on both.
3. Restore `(this.previousFocus as HTMLElement)?.focus()`.
4. Resolve `this.resolvePromise(result)`.

---

## Static `Dialog.show()` Implementation

```typescript
static show(config: DialogConfig): Promise<DialogResult> {
    const dialog = new Dialog(config);
    return dialog.show();
}
```

A one-liner that constructs an instance and delegates. The instance `show()` method returns the `Promise<DialogResult>`.

---

## Ordered Implementation Steps

**Step 1 — Extend `Theme`**
Add `dialog` token block to `Theme`, `DefaultTheme`, `DarkTheme`, and `themeToVars`. Zero risk to existing functionality.

**Step 2 — Implement `DialogBackdrop`**
Isolated, stateless component. Verify full-viewport rendering at the correct z-index and that `addClickListener` works via `Event.addListener`.

**Step 3a — `Dialog` constructor and layout structure**
Build the Border layout with title bar, content area, and button row. Apply all visual styling tokens.

**Step 3b — Instance `show()` method**
DOM attachment, `doLayout()`, z-index assignment, focus capture, `Promise` plumbing.

**Step 3c — `hide(result)` method**
Listener cleanup, element removal, focus restoration, promise resolution.

**Step 3d — Static `Dialog.show(config)`**
One-line convenience wrapper.

**Step 3e — Viewport resize handling**
On resize, re-center the dialog and update the backdrop size.

**Step 4 — Add exports to `Base/index.ts`**

**Step 5 — Manual integration testing**
Verify:
- Confirm/cancel buttons resolve the promise correctly.
- Escape resolves with `'close'`.
- Tab cycles only within the dialog.
- `closeOnBackdrop: true` closes on backdrop click.
- Content behind the dialog cannot receive mouse or keyboard events.
- Stacking two dialogs layers z-indices correctly and restores focus on close.
- Theme switching while a dialog is open updates backdrop and shadow.

---

## Key Tradeoffs Summary

| Decision | Alternative considered | Reason chosen |
|---|---|---|
| Separate `DialogBackdrop` | Backdrop as inline child of `Dialog` | Avoids stacking context issue; backdrop and panel are DOM siblings like other top-level overlays |
| `show()` returns a `Promise` | Callback-based API | Callers can `await Dialog.show(...)` inline |
| Focus trap via `document.addEventListener` | `Event.addViewportListener` | `addViewportListener` calls `stopPropagation`, breaking other key handlers; direct DOM use is what `Window.ts` already does for drag |
| No `inert` attribute | Set `inert` on body children | `inert` enumeration is fragile with floating components; pointer-events blocked by backdrop plus z-index plus keyboard trap is sufficient |
| `Dialog` extends `Component` directly | `Dialog` extends `Window` | `Window` carries drag/resize machinery that is unwanted and difficult to suppress |

---

## Critical Files

- `src/typescript/Base/Dialog.ts` (new)
- `src/typescript/Base/component/DialogBackdrop.ts` (new)
- `src/typescript/Base/Theme.ts`
- `src/typescript/Base/index.ts`
