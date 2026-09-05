---
depends-on:
  - clipboard-context-menu-foundation
---

# Text Input Context-Menu Clipboard Actions — Implementation Plan

## Overview

`Body.init` suppresses the browser's own right-click menu page-wide ([native-context-menu-suppression.md](implemented/native-context-menu-suppression.md)). That took away every native `<input>`/`<textarea>`'s built-in Cut/Copy/Paste menu — the browser's Ctrl/Cmd+X/C/V shortcuts still work, only the right-click menu is gone. This plan restores it for every text-editing form component in the library, by wiring one mechanism onto [`TextInput`](../packages/lib/src/typescript/lib/component/input/TextInput.ts) ([TextInput.ts:107](../packages/lib/src/typescript/lib/component/input/TextInput.ts#L107)).

`TextInput` is the one real DOM chokepoint. `TextField` extends it directly; `PasswordField` and `UsernameField` extend `TextField`; `TextArea` extends `TextInput` directly (as a `<textarea>`). Three more components *compose* a `TextInput`-family instance as a real, `addComponent`-registered child rather than extending it: `NumberSpinner._input` (a `TextField` subclass, [NumberSpinner.ts:169](../packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L169)), `AutoCompleteField._textField` (a `TextField` subclass, [AutoCompleteField.ts:123](../packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L123)), and `AbstractPickerField._input` (a `PickerInput`, itself a direct `TextInput` subclass, [AbstractPickerField.ts:82](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L82)) — the shared base of `DateField`, `DateTimeField`, and `TimeField`. Each composing class adds its inner field with a plain `this.addComponent(this._input)` / `this.addComponent(this._textField)` call in its own constructor — confirmed by reading `AbstractPickerField.ts:114`, `AutoCompleteField.ts:146`, and `NumberSpinner.ts:204`, not assumed. Because every one of these ten leaf classes ultimately has a real, rendered `TextInput` descendant under the right-clicked pixel, wiring the mechanism once inside `TextInput`'s own constructor gives all ten a right-click Cut/Copy/Paste menu with no per-subclass code.

`ComboBox` is out of scope: it renders `tag: "div"` with a `userSelect: "none"` label span ([ComboBox.ts:90,365](../packages/lib/src/typescript/lib/component/input/ComboBox.ts#L90)) — no editable text, nothing to cut, copy, or paste. `FileField`, `FileDropZone`, `Slider`, and `AbstractBooleanInput` (`Checkbox`/`RadioButton`/`Toggle`) are out of scope for the same reason. This plan depends on `clipboard-context-menu-foundation.md` (plan 1 of this batch) for `buildClipboardMenuItems(config)` and `DOMSource.getSelectionRange(handle)` — both used exactly as that plan designs them, not redesigned here.

---

## Architecture Decisions

### One self-wired mechanism on `TextInput`; no public `contextmenu` event

`TextInput`'s constructor registers its own `contextmenu` listener and owns a private `Menu` instance, mirroring `Table`'s `_columnContextMenu` ([Table.ts:214](../packages/lib/src/typescript/lib/component/table/Table.ts#L214)) and `MarkdownEditor`'s self-wired menu ([markdown-editor-context-menu.md](implemented/markdown-editor-context-menu.md)). No component in scope gets a public `on("contextmenu", …)` API — a consumer wanting a custom menu builds their own overlay.[^self-wired]

### An exact-target `Event.addListener`, not a subtree listener

`TextInput` registers with `Event.addListener(this, "contextmenu", this.handleContextMenu)`, following `CollapseButton`'s identical shape ([CollapseButton.ts:178](../packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L178)), not `Event.addSubtreeListener`.[^exact-target]

### Cut and Paste re-fire the native `"input"` event; they don't call `notifyChange` directly

After writing the new text and caret, `cut()` and `paste()` call `Event.fireEvent(this, "input")` rather than calling `this.notifyChange(...)` themselves. This is required, not just tidy: it's the only way a *composing* class's own raw-DOM listener notices a programmatic change.[^input-refire]

### Read-only or disabled omits Cut and Paste; Copy is always offered

The context menu passes a `paste` and a `cut` handler into `ClipboardMenuConfig` only when `this.isEnabled() && !this.isReadOnly()`; `copy` is always passed. This matches the config's own convention — a handler that isn't supplied gets no row at all, not a dimmed one — and follows `AbstractInput.isEnabled()` / `isReadOnly()` ([AbstractInput.ts:105,129](../packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L105)), the library's one existing "can this be edited right now" signal.[^readonly-gate]

### `PasswordField` gets no special restriction

`PasswordField`'s Cut/Copy/Paste inherit from `TextInput` unchanged.[^password-verified]

### Caret repositioning bypasses `TextInput.select()`

`cut()` and `paste()` write the post-edit caret with `DOM.sink.setSelectionRange(element, pos, pos)` directly, never through `this.select(start, end)`.[^select-bug]

### Paste truncates to `maxLength`

When `getMaxLength()` is set, `paste()` truncates the combined text (existing text with the clipboard text spliced in) to that length before writing it.[^maxlength]

### Paste re-checks its element after the clipboard-read `await`

`paste()` re-reads `this.getElement()` after `await DOM.source.readClipboardText()` resolves, and skips the mutation (but still resolves `true`) if the field was destroyed while the read was in flight.[^async-disposal]

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/input/TextInput.ts — new public methods,
// inherited by every subclass and every composed inner field.

/**
 * Copies the current selection to the system clipboard. No-op without a
 * selection.
 *
 * @returns This component, for method chaining.
 */
copy(): this;

/**
 * Copies the current selection to the system clipboard, then removes it
 * from the field. No-op without a selection, or when the field is
 * disabled or read-only.
 *
 * @returns This component, for method chaining.
 */
cut(): this;

/**
 * Reads the system clipboard and inserts it at the caret, replacing any
 * selection; truncates the result to `maxLength` when one is set.
 *
 * @returns A promise resolving `true` when the clipboard was read (even if
 *   it was empty), `false` when the browser denied the read, or when the
 *   field is currently disabled or read-only (the read is never attempted
 *   in that case).
 */
paste(): Promise<boolean>;
```

No new options, no new events, no change to any existing signature. `TextInputOptions` is unchanged.

---

## Internal Structure

All additions are inside `class TextInput` in [TextInput.ts](../packages/lib/src/typescript/lib/component/input/TextInput.ts).

New imports, added to the existing import block:

```typescript
import { Menu } from "~/overlay/Menu.js";
import { buildClipboardMenuItems, ClipboardMenuConfig } from "~/component/shared/buildClipboardMenuItems.js";
```

New field, placed after `ownStyleTraits` ([TextInput.ts:117](../packages/lib/src/typescript/lib/component/input/TextInput.ts#L117)), before the constructor:

```typescript
// Self-wired Cut/Copy/Paste replacement for the browser's own right-click
// menu, suppressed page-wide by Body.init (native-context-menu-suppression.md).
// Never a registered child — disposed explicitly in destructor(), mirroring
// Table's _columnContextMenu ([Table.ts:214]).
private readonly _contextMenu: Menu = new Menu();
```

One new line inside the constructor, directly after the existing `Event.addListener(this, "input", this.onInput);` ([TextInput.ts:132](../packages/lib/src/typescript/lib/component/input/TextInput.ts#L132)):

```typescript
Event.addListener(this, "contextmenu", this.handleContextMenu);
```

New `destructor()` override, placed after the constructor's closing brace ([TextInput.ts:136](../packages/lib/src/typescript/lib/component/input/TextInput.ts#L136)):

```typescript
/**
 * Disposes the context menu, then runs the inherited teardown.
 * `_contextMenu` is a `Position.FIXED` overlay (ARCHITECTURE.md's
 * `AnimatedDropdown` carve-out) and is never added via `addComponent`, so
 * `super.destructor()`'s child recursion cannot reach it on its own — the
 * same explicit-dispose shape `Table.destructor()` uses for
 * `_columnContextMenu`.
 */
protected destructor(): void {
    this._contextMenu.dispose();

    super.destructor();
}
```

New `handleContextMenu`, placed after `onInput()` ([TextInput.ts:161-166](../packages/lib/src/typescript/lib/component/input/TextInput.ts#L161-L166)):

```typescript
/**
 * Native `contextmenu` handler: opens the Cut/Copy/Paste menu that
 * replaces the browser's own. Copy is always offered; Cut and Paste are
 * omitted (not dimmed) when the field is disabled or read-only.
 *
 * @param event - The native contextmenu event; its `clientX`/`clientY` seed
 *   the menu's position.
 * @returns Stops propagation and suppresses the browser's own menu.
 */
private handleContextMenu(event: MouseEvent): Event.ListenerResult {
    const element = this.getElement();

    if (element) {
        const range           = DOM.source.getSelectionRange(element);
        const hasSelectedText = range !== null && range.start !== range.end;

        const config: ClipboardMenuConfig = {
            hasSelectedText,
            copy: () => this.copy(),
        };

        if (this.isEnabled() && !this.isReadOnly()) {
            config.cut   = () => this.cut();
            config.paste = () => void this.paste();
        }

        this._contextMenu.show(event.clientX, event.clientY, buildClipboardMenuItems(config));
    }

    return { stop: true, prevent: true };
}
```

New `copy()`, `cut()`, `paste()`, placed after `select()` ([TextInput.ts:625-643](../packages/lib/src/typescript/lib/component/input/TextInput.ts#L625-L643)):

```typescript
copy(): this {
    const element = this.getElement();
    if (!element) {
        return this;
    }

    const range = DOM.source.getSelectionRange(element);
    if (range === null || range.start === range.end) {
        return this;
    }

    DOM.sink.writeClipboardText(this.getText().slice(range.start, range.end));

    return this;
}

cut(): this {
    const element = this.getElement();
    if (!element || !this.isEnabled() || this.isReadOnly()) {
        return this;
    }

    const range = DOM.source.getSelectionRange(element);
    if (range === null || range.start === range.end) {
        return this;
    }

    const text = this.getText();
    DOM.sink.writeClipboardText(text.slice(range.start, range.end));

    this.setText(text.slice(0, range.start) + text.slice(range.end));
    DOM.sink.setSelectionRange(element, range.start, range.start);

    // Re-fires the native "input" event so a composing field's own raw-DOM
    // listener (AbstractPickerField.onInput, AutoCompleteField's debounce
    // trigger) notices a change made through code rather than a keystroke —
    // see the "Cut and Paste re-fire" Architecture Decision.
    Event.fireEvent(this, "input");

    return this;
}

async paste(): Promise<boolean> {
    const element = this.getElement();
    if (!element || !this.isEnabled() || this.isReadOnly()) {
        return false;
    }

    const clip = await DOM.source.readClipboardText();
    if (clip === null) {
        return false;
    }

    // Re-fetched: the field may have been destroyed while the read was in
    // flight (e.g. its parent panel closed mid-permission-prompt).
    const el = this.getElement();

    if (clip !== "" && el) {
        const text  = this.getText();
        const range = DOM.source.getSelectionRange(el) ?? { start: text.length, end: text.length };

        let combined = text.slice(0, range.start) + clip + text.slice(range.end);
        const maxLength = this.getMaxLength();
        if (maxLength !== null && combined.length > maxLength) {
            combined = combined.slice(0, maxLength);
        }

        this.setText(combined);

        const caret = Math.min(range.start + clip.length, combined.length);
        DOM.sink.setSelectionRange(el, caret, caret);
        Event.fireEvent(this, "input");
    }

    return true;
}
```

---

## Ordered Implementation Steps

1. **Add imports and the `_contextMenu` field.** In [TextInput.ts](../packages/lib/src/typescript/lib/component/input/TextInput.ts): add the two new imports; add the `_contextMenu` field after `ownStyleTraits` ([:117](../packages/lib/src/typescript/lib/component/input/TextInput.ts#L117)). No behavior yet — this step only makes the class compile with the new field.

2. **Write the offline tests (red).** Extend [`packages/lib/tests/component/input/TextInput.test.ts`](../packages/lib/tests/component/input/TextInput.test.ts) with the cases in `## Expected Behaviour` numbered 1-17, following the file's existing `for (const [name, make] of [...])` loop pattern (see [:38-54](../packages/lib/tests/component/input/TextInput.test.ts#L38-L54)) to run the shared cases across `TextField`, `TextArea`, and `PasswordField`. Use `DOM.sink.setSelectionRange(el, start, end)` to seed a selection (the foundation plan's `ModelledDOMSource.getSelectionRange` reads it back) and `vi.spyOn(DOM.source, 'readClipboardText')` to stub paste reads, following [`markdown-editor-context-menu-clipboard.md`](implemented/markdown-editor-context-menu-clipboard.md)'s Step 2 idiom. Assert clipboard writes via `(sink as RecordingDOMSink).writes.filter(w => w.op === 'writeClipboardText')`. For behaviours 15-17, drive the real listener with `Event.fireEvent(field, makeEvent(el, 'contextmenu', { clientX, clientY }))` — the same technique [`CollapseButton.test.ts`](../packages/lib/tests/component/container/CollapseButton.test.ts) already uses for `click`/`dblclick` — and assert the resulting menu via `vi.spyOn(Menu.prototype, 'show')`, not a white-box call to the private `handleContextMenu`.
   *Check:* the new tests fail to compile or fail their assertions (the methods don't exist yet).

3. **Implement the constructor wiring, `destructor()`, `handleContextMenu()`, `copy()`, `cut()`, `paste()`.** All from `## Internal Structure`, at the cited anchors in `TextInput.ts`.
   *Check:* Step 2's tests go green. `grep -n "this.select(" packages/lib/src/typescript/lib/component/input/TextInput.ts` inside the new methods — zero matches (confirms the caret-repositioning decision was followed).

4. **Extend [`DateField.test.ts`](../packages/lib/tests/component/input/DateField.test.ts).** Add a test that pastes text into the inner `_input` (via the file's existing white-box access pattern) and asserts the *outer* `DateField`'s `on("change", fn)` fires with the freshly parsed `Date` — proving the `Event.fireEvent(this, "input")` re-fire reaches `AbstractPickerField.onInput`. Cover behaviours 18-19.
   *Check:* green with no source changes to `DateField.ts` / `AbstractPickerField.ts` — this is what confirms the mechanism is inherited, not duplicated.

5. **Extend [`AutoCompleteField.test.ts`](../packages/lib/tests/component/input/AutoCompleteField.test.ts).** Add a test that pastes text matching a configured suggestion into `_textField`, advances the debounce timer, and asserts a matching suggestion becomes available — proving the re-fired `"input"` event reaches `AutoCompleteField`'s own debounce-triggering listener. Cover behaviour 20.
   *Check:* green with no source changes to `AutoCompleteField.ts`.

6. **Extend [`NumberSpinner.test.ts`](../packages/lib/tests/component/input/NumberSpinner.test.ts).** Add one test performing a cut on the inner `_input` and asserting the clipboard write and the field's raw displayed text change, with `NumberSpinner.getValue()` (the committed number) unchanged until blur — confirming `NumberSpinner` needs no code of its own; a cut/paste behaves like typing arbitrary uncommitted text, exactly as it already does today. Cover behaviour 21.
   *Check:* green with no source changes to `NumberSpinner.ts`.

7. **Update `TextInput`'s class doc comment** ([:95-106](../packages/lib/src/typescript/lib/component/input/TextInput.ts#L95-L106)) to mention the right-click Cut/Copy/Paste menu and the new `cut()`/`copy()`/`paste()` methods, describing the mechanism in prose (no `{@link}` to `handleContextMenu` or `buildClipboardMenuItems`, per CODE_CONVENTIONS.md).

8. **Full check.** `npm run typecheck`, `npm -w packages/lib run typecheck:test`, `npm test`, `npm run lint`, `npm run docs:api` (zero warnings).

9. **Docs.** Apply every edit in `## Documentation Impact`, per the `document` skill.

10. **Manual smoke test.** Behaviours 22-26, in the running demo app.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/TextInput.ts` |
| Modify | `packages/lib/tests/component/input/TextInput.test.ts` |
| Modify | `packages/lib/tests/component/input/DateField.test.ts` |
| Modify | `packages/lib/tests/component/input/AutoCompleteField.test.ts` |
| Modify | `packages/lib/tests/component/input/NumberSpinner.test.ts` |
| Modify | `packages/lib/docs/components/TextField.md` |
| Modify | `packages/lib/docs/components/TextArea.md` |
| Modify | `packages/lib/docs/components/PasswordField.md` |
| Modify | `packages/lib/docs/components/NumberSpinner.md` |
| Modify | `packages/lib/docs/components/AutoCompleteField.md` |
| Modify | `packages/lib/docs/components/DateField.md` |
| Modify | `packages/lib/docs/components/DateTimeField.md` |
| Modify | `packages/lib/docs/components/TimeField.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

No changes to `PickerInput.ts`, `AbstractPickerField.ts`, `DateField.ts`, `DateTimeField.ts`, `TimeField.ts`, `NumberSpinner.ts`, or `AutoCompleteField.ts` — see `## Non-Goals`.

---

## Expected Behaviour

**Unit-testable — shared across `TextField` / `TextArea` / `PasswordField`** (`TextInput.test.ts`):

1. With `"hello world"` and characters 0-5 selected, `copy()` records exactly one `writeClipboardText` write carrying `"hello"`.
2. With a collapsed caret, `copy()` records no write.
3. With `"hello world"` and characters 6-11 selected, `cut()` records a `writeClipboardText` write carrying `"world"`, leaves `getText()` as `"hello "`, and leaves the caret collapsed at offset 6.
4. With a collapsed caret, `cut()` records no write and leaves `getText()` unchanged.
5. `cut()` on a disabled field, and on a read-only field, each record no write and leave the text unchanged.
6. `cut()` fires the field's own `on("change", fn)` with the post-cut text.
7. With the clipboard stubbed to resolve `"X"` and a collapsed caret at offset 2 in `"hello"`, `paste()` resolves `true` and leaves `getText()` as `"heXllo"`, with the caret collapsed at offset 3.
8. With the clipboard stubbed to resolve `"X"` and characters 0-5 selected in `"hello world"`, `paste()` resolves `true` and leaves `getText()` as `"X world"`.
9. With the clipboard stubbed to resolve `null`, `paste()` resolves `false` and leaves `getText()` unchanged.
10. With the clipboard stubbed to resolve `""`, `paste()` resolves `true` and leaves `getText()` unchanged.
11. `paste()` on a disabled field, and on a read-only field, each resolve `false` **without** calling `DOM.source.readClipboardText` at all (assert the stub's mock was not called).
12. `paste()` fires the field's own `on("change", fn)` with the post-paste text.
13. With `maxLength` set to 5 and `"12345"` already filling the field with a collapsed caret at the end, pasting `"67"` resolves `true` and leaves `getText()` as `"12345"` (truncated, no error) with the caret at offset 5.
14. `paste()` does not throw when the field is destroyed while the clipboard read is still pending (stub the read with a `Promise` that resolves after `field.dispose()` runs); the pending `paste()` call still resolves `true`.
15. Right-clicking (via `Event.fireEvent(field, makeEvent(el, 'contextmenu', { clientX, clientY }))`) with text selected opens the menu (assert via `vi.spyOn(Menu.prototype, 'show')`) with `Cut`/`Copy`/`Paste` all `enabled: true`.
16. The same right-click with a collapsed caret opens the menu with `Cut`/`Copy` `enabled: false` and `Paste` present and enabled.
17. The same right-click on a read-only field, and separately on a disabled field, each open a menu containing only `Copy` (no `Cut` or `Paste` row at all) — assert via the item count and `text` values in the captured `show()` call, not just `enabled`.

**Unit-testable — composed fields** (behaviours the base `TextInput` cases above don't reach):

18. Pasting text into a `DateField`'s inner `_input` fires the outer `DateField`'s `on("change", fn)` with the newly parsed `Date` (not `undefined` or the stale prior value).
19. Cutting all the text out of a `DateField`'s inner `_input` fires the outer `on("change", fn)` with `null`.
20. Pasting text that matches a configured `AutoCompleteField` suggestion into `_textField`, then advancing the debounce timer, makes that suggestion available the same way a keystroke would (assert via the same mechanism the field's own existing debounce tests use).
21. Cutting from a `NumberSpinner`'s inner `_input` records a clipboard write and changes the inner field's displayed text; `NumberSpinner.getValue()` (the committed, clamped number) is unchanged until blur or Enter — the same behavior typing garbage text into the field already has today.

**Manual** (`npm run dev`, app on `localhost:8015`):

22. Right-clicking a `TextField`/`TextArea`/`PasswordField`/`UsernameField` with text selected shows a menu leading with enabled Cut/Copy/Paste; each acts correctly; the browser's own menu never appears.
23. Right-clicking a read-only field shows a Copy-only menu; a disabled field shows no menu at all (or, if the browser still dispatches `contextmenu` on a disabled control in some engine, a Copy-only menu — confirm which).
24. Right-clicking inside a `NumberSpinner`, an `AutoCompleteField`, and a `DateField`/`DateTimeField`/`TimeField` each show the same Cut/Copy/Paste menu, positioned at the click point inside the inner input, not offset by the composite's own chrome.
25. Pasting into a `DateField` updates the field's parsed value the same way typing the same text would (including going invalid/red-bordered on unparsable text).
26. Right-clicking an `AutoCompleteField` while its suggestion dropdown is open does not visually break the dropdown; pasting refreshes the suggestion list.

---

## Verification

- `npm run typecheck` and `npm -w packages/lib run typecheck:test` — clean.
- `cd packages/lib && npx vitest run tests/component/input/TextInput.test.ts tests/component/input/DateField.test.ts tests/component/input/AutoCompleteField.test.ts tests/component/input/NumberSpinner.test.ts` — all green.
- `npm test` — the whole suite; no regression.
- `npm run lint` — clean.
- `grep -n "this.select(" packages/lib/src/typescript/lib/component/input/TextInput.ts` — no match inside `cut()`/`paste()` (confirms the caret-repositioning decision).
- `grep -rn "_contextMenu\b" packages/lib/src/typescript/lib/component/input/TextInput.ts` — the field declaration, the `handleContextMenu` use, and the `destructor()` dispose call; nothing else.
- `npm run docs:api` — zero warnings.
- `npm run build:docs` — clean VitePress build.
- Manual cases 22-26 above.

---

## Documentation Impact

- **[`TextField.md`](../packages/lib/docs/components/TextField.md)** — add `cut()` / `copy()` / `paste()` rows to the "Common methods" table ([:27-36](../packages/lib/docs/components/TextField.md#L27-L36)), and a sentence noting the right-click menu now offers Cut/Copy/Paste (dimmed/omitted per selection and read-only/disabled state).
- **[`TextArea.md`](../packages/lib/docs/components/TextArea.md)** — same table addition ([:26-35](../packages/lib/docs/components/TextArea.md#L26-L35)).
- **[`PasswordField.md`](../packages/lib/docs/components/PasswordField.md)** — add a `## Notes` bullet ([:17-21](../packages/lib/docs/components/PasswordField.md#L17-L21)) stating Cut/Copy/Paste work unrestricted, same as any other text field, since the browser itself does not block clipboard access on `type="password"`.
- **[`NumberSpinner.md`](../packages/lib/docs/components/NumberSpinner.md)** — add a `## Behavior` bullet noting the inner field's right-click Cut/Copy/Paste menu, and that Cut/Paste act on the raw displayed text (uncommitted until blur/Enter), same as typing.
- **[`AutoCompleteField.md`](../packages/lib/docs/components/AutoCompleteField.md)** — add a `## Notes` bullet ([:64-67](../packages/lib/docs/components/AutoCompleteField.md#L64-L67)) noting the inner field's right-click menu and that Paste re-triggers the suggestion query exactly like typing.
- **[`DateField.md`](../packages/lib/docs/components/DateField.md)**, **[`DateTimeField.md`](../packages/lib/docs/components/DateTimeField.md)**, **[`TimeField.md`](../packages/lib/docs/components/TimeField.md)** — each gets a `## Notes` (or equivalent) bullet noting the inner `PickerInput`'s right-click Cut/Copy/Paste menu, and that Cut/Paste re-parse the field the same way typing does.
- **[`next.md`](../packages/lib/docs/reference/changelog/next.md)** — add an `### Components` bullet under `## Added`: "`TextInput` (and every text field built on it — `TextField`, `TextArea`, `PasswordField`, `UsernameField`, `NumberSpinner`, `AutoCompleteField`, `DateField`, `DateTimeField`, `TimeField`) gains a right-click Cut/Copy/Paste menu and public `cut()` / `copy()` / `paste()` methods, restoring what `Body.init`'s native-context-menu suppression removed."

---

## Potential Challenges

- **A disabled `<input>` may never dispatch `contextmenu` at all in real browsers**, since browsers treat `disabled` form controls as inert to pointer interaction. The `isEnabled()` check in `handleContextMenu` is defensive; manual case 23 confirms what actually happens live, since the offline harness can't model browser inertness.
- **The composed fields' own raw-DOM `"input"` listeners are easy to miss.** `AbstractPickerField` and `AutoCompleteField` each register `Event.addListener(this._input/_textField, "input", …)` from outside the inner field — a pattern this plan relies on rather than changes. If a future refactor of either class moves that listener onto the semantic `on("change", …)` API instead, the `Event.fireEvent(this, "input")` re-fire keeps working either way (a real `"input"` event satisfies both a raw listener and, via `TextInput.onInput`, the semantic `"change"` fan-out).
- **`Menu.show()` never calls `.focus()`** (confirmed by reading `Menu.ts`'s `show`/`showAnchored`), so opening the context menu does not blur the field — an `AutoCompleteField`'s suggestion dropdown is not force-closed by opening this menu. Manual case 26 double-checks this live.

---

## Critical Files

- [`TextInput.ts`](../packages/lib/src/typescript/lib/component/input/TextInput.ts) — the file this plan edits; read `onInput`, `setText`/`getText`, `select()`, `applyEnabled`/`applyReadOnly` before editing.
- [`AbstractInput.ts`](../packages/lib/src/typescript/lib/component/input/AbstractInput.ts) — `isEnabled()` / `isReadOnly()` ([:105,129](../packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L105)), `notifyChange` ([:218](../packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L218)).
- [`plans/clipboard-context-menu-foundation.md`](clipboard-context-menu-foundation.md) — `buildClipboardMenuItems` / `ClipboardMenuConfig` and `DOMSource.getSelectionRange`, consumed as-is.
- [`Table.ts:214,1683-1778`](../packages/lib/src/typescript/lib/component/table/Table.ts#L214) — the `_columnContextMenu` self-wired-menu precedent this plan mirrors.
- [`CollapseButton.ts:150-179,355-359`](../packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L150) — the exact-target `Event.addListener(this, "contextmenu", …)` precedent on a single-DOM-element leaf.
- [`DateField.ts:129-142`](../packages/lib/src/typescript/lib/component/input/DateField.ts#L129) — `onDropdownSelected`'s existing `Event.fireEvent(this._input, "input")` call and its doc comment, the direct precedent for the input-refire decision.
- [`AbstractPickerField.ts:104-138,414-433`](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L104) — `_input`'s construction as a real registered child, and `onInput()`'s dependence on the raw `"input"` DOM event.
- [`AutoCompleteField.ts:144-186,491-509`](../packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L144) — `_textField`'s construction and its own `"input"`-driven debounce trigger.
- [`NumberSpinner.ts:99-108,182-232`](../packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L99) — `NumberSpinnerField`'s construction, confirming it needs no code of its own.
- [`Menu.ts:297-330`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L297) — `show()`, confirming it never moves DOM focus.
- [`plans/implemented/markdown-editor-context-menu.md`](implemented/markdown-editor-context-menu.md) and [`markdown-editor-context-menu-clipboard.md`](implemented/markdown-editor-context-menu-clipboard.md) — the menu-wiring and clipboard-command precedents; the latter's Implementation Notes record the exact-target-vs-subtree mistake this plan avoids by choosing correctly up front.
- [`native-context-menu-suppression.md`](implemented/native-context-menu-suppression.md) — why this menu is needed at all.

---

## Non-Goals

- **`ComboBox`, `FileField`, `FileDropZone`, `Slider`, `AbstractBooleanInput`** — no editable text; confirmed by reading each, not assumed.
- **No changes to `PickerInput.ts`, `AbstractPickerField.ts`, `DateField.ts`, `DateTimeField.ts`, `TimeField.ts`, `NumberSpinner.ts`, `AutoCompleteField.ts`.** Every one of them inherits the mechanism through composition; touching them would contradict this plan's own finding.
- **No public `on("contextmenu", …)` API and no way for a consumer to add extra rows to the menu.** Out of scope; a consumer wanting more builds their own overlay.
- **No rich clipboard formats.** Copy writes plain text; Paste inserts plain text — the only thing a native `<input>`/`<textarea>` value can ever hold.
- **No fix to `TextInput.select()`'s zero-caret defaulting quirk** (`select(0, 0)` selects everything instead of collapsing, because `!start`/`!end` treat `0` as unset). This plan works around it by not calling `select()`; fixing `select()` itself is a separate change, since `select()` has other callers outside this plan's scope.
- **No shortcut hints or glyphs on the three menu rows**, matching `buildClipboardMenuItems`'s own design (no platform-detection helper for `Ctrl` vs `Cmd`).
- **No change to how `AbstractPickerField.onInput` parses text or how `AutoCompleteField` debounces** — this plan makes the *existing* mechanisms fire correctly for a Cut/Paste-driven change; it does not alter what they do once fired.

---

## Notes

[^self-wired]: The alternative — a consumer-wired `on("contextmenu", fn)` API like `Tree`, `DiagramView`, or `CollapseButton` expose — fits a menu whose *contents* vary by consumer intent. Cut/Copy/Paste has no such variation: every text field wants the same three rows, computed from state (`hasSelectedText`, `isReadOnly`) the field already owns. Self-wiring, like `Table`'s column menu and `MarkdownEditor`'s context menu, is the pattern the codebase already uses for exactly this "the component knows its own menu contents" case.

[^exact-target]: `markdown-editor-context-menu.md`'s own Implementation Notes record a real bug from getting this choice wrong: `WysiwygSurface` needed `Event.addSubtreeListener` because Lexical renders many nested `<span>`s inside one `contenteditable` root, so `event.target` for a real right-click is almost never the root element itself. `TextInput` cannot have this problem: ARCHITECTURE.md's "one DOM element per class" rule means it owns exactly one `<input>`/`<textarea>` with no descendant elements, so `event.target` for any right-click on it is always that element itself. `CollapseButton`'s identical exact-target registration on its own single `<span>` confirms this is the established shape for a childless leaf, not a special case invented for this plan.

[^input-refire]: Investigation found this is a real gap, not a hypothetical one. `AbstractPickerField` wires `Event.addListener(this._input, "input", () => this.onInput())` ([AbstractPickerField.ts:121](../packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L121)) directly on the raw DOM event of its composed `_input` — the *only* path that parses the typed text into `_value` and fires the outer field's own `on("change", …)` / binding listeners. `TextInput.notifyChange()` fires a *different* event (the `AbstractInput` `"change"`/`"binding"` `ListenerBag`, which nothing outside `_input` itself is listening to) — so a `cut()`/`paste()` that only called `this.notifyChange(...)` would silently leave `DateField.getValue()` stale and never notify a bound bindable field, exactly the kind of desync the task brief warned against. `AutoCompleteField` has the same shape for a smaller stake: its own debounced suggestion-query trigger is wired to `_textField`'s raw `"input"` event too ([AutoCompleteField.ts:162](../packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L162)) (its `on("change", …)` bridge at [:170](../packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L170) *would* have worked, since that one goes through the `AbstractInput` `"change"` event `TextInput.notifyChange` fires — but the suggestion refresh would not). `NumberSpinner` has no such listener (it only wires `"blur"`/`"keydown"` on `_input`), so it is unaffected either way. Rather than special-case the two composed classes that need it, `Event.fireEvent(this, "input")` dispatches a real (`CustomEvent`-backed) `"input"` event through the same window-capture-handler pipeline a real keystroke uses, which every listener — `TextInput`'s own `onInput`, and any outside listener on the same element and event type — receives identically. This is not a novel trick: `DateField.onDropdownSelected` / `DateTimeField` / `TimeField` already call `Event.fireEvent(this._input, "input")` after `setValue()` for the identical reason ("re-fires `input` so any non-`AbstractInput` consumer reading from the inner DOM event still sees the change" — [DateField.ts:131-133](../packages/lib/src/typescript/lib/component/input/DateField.ts#L131-L133)). Putting the same call inside `TextInput.cut()`/`paste()` themselves means every composing class gets the fix for free, rather than each needing its own post-mutation `Event.fireEvent` call the way `onDropdownSelected` does today.

[^readonly-gate]: A disabled or read-only field's browser-native typing is already blocked at the DOM `disabled`/`readonly` attribute level; without this gate, a script-driven Paste would bypass that and silently mutate a field the user (and the consumer's own validation) believes is locked. Copy is left ungated because reading a selection is never destructive and a read-only field is still meant to be copyable — the platform convention every desktop text field follows.

[^password-verified]: Two claims were checked, not assumed. First, `HTMLInputElement.setSelectionRange()`/`selectionStart`/`selectionEnd` are explicitly supported on `type="password"` (along with `text`, `search`, `tel`, `url`) per MDN, and have been since 2015 — reading or writing a password field's selection is not restricted by any modern browser. Second, the well-known "password fields block copy/paste" behavior some sites exhibit is implemented by the *site's own* `onpaste="return false"` / `event.preventDefault()` on the `copy`/`paste` DOM events — a per-site opt-in, not a browser default — and Firefox even ships a `dom.event.clipboardevents.enabled` flag specifically to let users override such site-level blocking. This framework does not add any such site-level block today, and Ctrl+C/Ctrl+V already work unrestricted on every `PasswordField` (per the Overview — only the *right-click menu* was ever suppressed). Restricting only the new menu path while leaving the keyboard path fully open would add no actual confidentiality benefit — anyone who can reach the keyboard shortcut already has the capability — so `PasswordField` is treated exactly like any other field.
    Sources: [MDN — HTMLInputElement.setSelectionRange()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/setSelectionRange); search results on site-level copy/paste blocking via `onpaste`/`preventDefault` and Firefox's `dom.event.clipboardevents.enabled` override.

[^select-bug]: `select(start?, end?)` ([TextInput.ts:625-643](../packages/lib/src/typescript/lib/component/input/TextInput.ts#L625-L643)) defaults each argument with `!start`/`!end` checks, which treat an explicit `0` the same as "omitted". `select(0, 0)` — exactly what placing a collapsed caret at the very start of a field requires — resolves to `start = 0` (correct, `0` was already the fallback) but `end = text.length + 1` (wrong: `!0` is `true`, so the "omitted" branch fires and selects to the end), selecting the entire field instead of collapsing the caret. `cut()`/`paste()` need to place a collapsed caret at an arbitrary offset — including `0` — so they write `DOM.sink.setSelectionRange` directly rather than risk hitting this quirk.

[^maxlength]: `TextInput.setText()` writes through `DOM.sink.setValue`, which sets the element's `.value` property directly. Setting `.value` by script does not enforce the native `maxlength` attribute — only the browser's own typed/pasted-input path does. A real Ctrl+V paste is truncated by the browser to fit `maxlength`; this seam-driven `paste()` would silently exceed it without the explicit truncation, breaking parity with the native shortcut it's meant to match.

[^async-disposal]: `paste()`'s only `await` point is the clipboard read, during which the field's owning window, panel, or dialog could close and destroy it. Reading `this.getElement()` again after the `await` (rather than trusting the value captured before it) and skipping the mutation when it's now `undefined` avoids writing to, or firing an event on, a component that no longer has a live element — the same class of async-vs-teardown race this codebase has hit before (a completed clipboard read reaching a destroyed component is directly analogous to a completed animation or async callback reaching one).
