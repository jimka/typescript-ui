---
touches-shared:
  - packages/lib/src/typescript/lib/component/container/index.ts
  - packages/lib/src/typescript/lib/overlay/Menu.ts
  - packages/lib/docs/components/index.md
  - packages/lib/docs/reference/changelog/next.md
---

# Boolean menu-row base extraction — Implementation Plan

## Overview

`CheckboxMenuRow` and `RadioMenuRow` never tell their consumer that a keyboard activation happened. Both expose an `"action"` event registered as a DOM `click` listener on the row element ([CheckboxMenuRow.ts:255-260](packages/lib/src/typescript/lib/component/container/CheckboxMenuRow.ts#L255), [RadioMenuRow.ts:259-264](packages/lib/src/typescript/lib/component/container/RadioMenuRow.ts#L259)), but the keyboard path — ArrowDown to the row, then Enter — reaches `activate()` ([MenuBar.ts:141-142](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L141) → [Menu.ts:807-819](packages/lib/src/typescript/lib/overlay/Menu.ts#L807) → `row.activate()`), and `activate()` only calls `setChecked(…)`. No click ever reaches the row, so the handler never runs. The graphic flips and the consumer hears nothing.

This plan fixes the missing notification by re-homing `"action"` on the framework's custom-event machinery and extracting the base class the two rows should always have shared. `RadioMenuRow` is a near-byte-identical copy of `CheckboxMenuRow` — the duplication is why the same defect exists twice — so the fix lands in one new abstract class, `AbstractBooleanMenuRow`, that both rows extend. Three smaller repairs in the same file family ride along: the two dead exported event types are replaced by one live one, `MenuRow.closeMenu()`'s status as a consumer extension point is written down, and the two coexisting menu-separator implementations converge onto `MenuSeparator`.

No public signature changes. Every consumer — [Split.ts:1131-1196](packages/lib/src/typescript/lib/layout/Split.ts#L1131), [Table.ts:1706](packages/lib/src/typescript/lib/component/table/Table.ts#L1706), [Table.ts:1795](packages/lib/src/typescript/lib/component/table/Table.ts#L1795), [AbstractWindow.ts:1723-1732](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1723), [MenuBarPanel.ts:144-151](packages/lib/src/typescript/MenuBarPanel.ts#L144) — uses only `new XMenuRow({…})`, `on("action", fn)`, `isChecked()` and `setChecked(…)`, all of which keep their exact shapes.

---

## Architecture Decisions

### `"action"` becomes a `ListenerBag` event, not a DOM-`click` shorthand

The row's `"action"` event moves from `Event.addListener(this, "click", …)` onto the typed `on` / `off` / `emit` pub-sub surface backed by a private `ListenerBag`, and `activate()` emits it. The precedent is [AbstractInput.ts:59-77](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L59) and [AbstractInput.ts:150-200](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L150) — an abstract base holding one `registerListenerBag`-wrapped `ListenerBag`, wiring the construction-time `listeners` bag from its own constructor body, and exposing typed forwarders.[^why-bag]

Both activation routes then notify through one point:

| Route | Reaches | Notifies today | Notifies after |
|---|---|---|---|
| Click anywhere on the row | `handleClick` → `activate()` | yes (separate DOM listener) | yes (`activate()` emits) |
| Enter on the highlighted row | `Menu.activateFocused()` → `activate()` | **no** | yes (`activate()` emits) |
| `setChecked(true)` from application code | control only | no | no |
| Click on a disabled (pointer-inert) row | nothing | no | no |

### The emit belongs in `activate()`, never in `setChecked()`

`setChecked` stays a silent state write. Only `activate()` emits, and it emits after the value mutation so the handler reads the new state.[^emit-placement]

### The base reaches its control through an abstract accessor

`AbstractBooleanMenuRow` holds no reference to the inner control. It declares `protected abstract getControl(): AbstractBooleanInput`, and each subclass keeps its own typed field (`_checkbox`, `_radio`) and returns it. This mirrors [AbstractBooleanInput.ts:201](packages/lib/src/typescript/lib/component/input/AbstractBooleanInput.ts#L201)'s `protected abstract getInteractiveSurface(): Component` one layer down.[^accessor]

`AbstractBooleanInput` is the right return type because it already declares everything the base needs: `getValue()` / `setValue()` from [AbstractInput.ts:86-97](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L86), `isEnabled()` from [AbstractInput.ts:104](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L104), and `Component`'s geometry setters.

### This reverses `split-gutter-collapse-radio.md`'s rejection of a shared base

[plans/implemented/split-gutter-collapse-radio.md](plans/implemented/split-gutter-collapse-radio.md)'s `[^no-shared-base]` footnote considered and rejected this extraction on two grounds. Neither holds, and that footnote itself named `AbstractBooleanInput` as "the shape to copy when the time comes".[^rejection-reversed]

### Per-class event types are replaced by one live type on the base

`CheckboxMenuRowEvent` and `RadioMenuRowEvent` ([CheckboxMenuRow.ts:11](packages/lib/src/typescript/lib/component/container/CheckboxMenuRow.ts#L11), [RadioMenuRow.ts:11](packages/lib/src/typescript/lib/component/container/RadioMenuRow.ts#L11)) are exported, re-exported from the container barrel, and referenced nowhere. Both are deleted. The base exports `AbstractBooleanMenuRowEvent = "action"` in their place and actually uses it in the `on` / `off` / `emit` signatures, as ARCHITECTURE.md requires of every class that emits through a `ListenerBag`.

### Both `Menu` build loops build a `MenuSeparator`

`Menu` has two build loops, one per mode. *Rebuild mode* — a context menu — tears down and rebuilds its rows on every `show()`, and already builds a `MenuSeparator` for `separator: true` at [Menu.ts:293-294](packages/lib/src/typescript/lib/overlay/Menu.ts#L293). *Persistent mode* — a `MenuBar` dropdown, built once and reopened — still routes the same config through `MenuItem`'s own separator branch at [Menu.ts:982-1001](packages/lib/src/typescript/lib/overlay/Menu.ts#L982). Persistent mode switches to `MenuSeparator`, and `MenuItem`'s separator branch is deleted so only one implementation remains.[^separator-converge]

After the change both loops resolve a config entry the same way:

| Config entry | Row built |
|---|---|
| `{ separator: true }` | `MenuSeparator` |
| `{ separator: true, row: fn }` | `MenuSeparator` — `separator` wins, `fn` is never called |
| `{ row: fn }` | `fn()`, then `setCssVarPrefix` + `setMenuCloseHandler` |
| `{ text: "…", action: fn }` | `MenuItem` |

### `MenuRow.closeMenu()` stays, and says so

`closeMenu()` ([MenuRow.ts:241-243](packages/lib/src/typescript/lib/component/container/MenuRow.ts#L241)) has no caller in any shipped `MenuRow` subclass, but it is not speculative surface: it is a `protected` member documented as consumer-facing at [docs/components/Menu.md:83](packages/lib/docs/components/Menu.md#L83), and its only possible callers are custom rows written outside this repo. It is kept, and its own JSDoc is amended to say it is the extension point for a consumer-written row.[^close-menu]

---

## Public API

New abstract class, exported from `component/container`. Not wrapped with `callable()` — abstract classes are never instantiated, matching `MenuRow` and `AbstractBooleanInput`.

```typescript
/** Events exposed by an AbstractBooleanMenuRow. */
export type AbstractBooleanMenuRowEvent = "action";

export interface AbstractBooleanMenuRowOptions extends ComponentOptions {
    text?:    string;
    checked?: boolean;
    enabled?: boolean;
    listeners?: { action?: () => void };
}

export abstract class AbstractBooleanMenuRow<
    TOptions extends AbstractBooleanMenuRowOptions = AbstractBooleanMenuRowOptions
> extends MenuRow<TOptions> {
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>);

    isChecked(): boolean;
    setChecked(value: boolean): this;
    isEnabled(): boolean;
    isNavigable(): boolean;
    activate(): void;
    getContentWidth(): number;
    setColumns(checkZone: number, iconStart: number, _titleColumn: number): void;
    doLayout(): this;

    on(event: AbstractBooleanMenuRowEvent, listener: () => void): this;
    off(event: AbstractBooleanMenuRowEvent, listener: () => void): this;

    protected emit(event: AbstractBooleanMenuRowEvent): void;
    protected installControl(): void;
    protected abstract getControl(): AbstractBooleanInput;
    protected abstract applyActivation(): void;
}
```

State-bearing fields: the inner control is the cache for both `checked` and `enabled`, exactly as today — neither is written into `_options`, and neither has a setter `applyOptions` could dispatch. `_checkZone` / `_iconStart` are private to the base, written only by `setColumns`.

Unchanged public shapes, now inheriting from the base instead of declaring their own copies:

```typescript
export interface CheckboxMenuRowOptions extends AbstractBooleanMenuRowOptions {}
export interface RadioMenuRowOptions    extends AbstractBooleanMenuRowOptions {}

class CheckboxMenuRow extends AbstractBooleanMenuRow<CheckboxMenuRowOptions> { }
class RadioMenuRow    extends AbstractBooleanMenuRow<RadioMenuRowOptions>    { }
```

Removed exports: `CheckboxMenuRowEvent`, `RadioMenuRowEvent`.

---

## Internal Structure

The base's constructor does not touch the control, because the control cannot exist until the subclass constructor body runs. It wires only the listener bag:

```typescript
private _listeners: ListenerBag<AbstractBooleanMenuRowEvent> =
    this.registerListenerBag(new ListenerBag<AbstractBooleanMenuRowEvent>());

constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
    super(options, subclassDefaults);

    this.applyListeners(options?.listeners);
}
```

Everything that needs the control lives in `installControl()`, which each subclass calls at the end of its own constructor:

```typescript
protected installControl(): void {
    const control = this.getControl();

    control.setPointerEvents("none");
    this.addComponent(control);

    if (!control.isEnabled()) {
        this.setPointerEvents("none");
        this.setOpacity(DISABLED_OPACITY);
    }

    Event.addListener(this, "mouseover", this.handleMouseOver);
    Event.addListener(this, "mouseout",  this.handleMouseOut);
    Event.addListener(this, "click",     this.handleClick);
}
```

`installControl` reads the disabled state off the control rather than off the options bag, which is the same test by construction: the control is always built with `enabled: options?.enabled ?? true`, so `control.isEnabled()` is `false` exactly when the caller passed `enabled: false`.

Activation is guard, mutate, notify:

```typescript
activate(): void {
    if (!this.isEnabled()) {
        return;
    }

    this.applyActivation();
    this.emit("action");
}
```

Each subclass supplies two methods and nothing else of substance:

```typescript
// CheckboxMenuRow
protected getControl(): AbstractBooleanInput { return this._checkbox; }
protected applyActivation(): void { this.setChecked(!this.isChecked()); }

// RadioMenuRow
protected getControl(): AbstractBooleanInput { return this._radio; }
protected applyActivation(): void { this.setChecked(true); }
```

---

## Ordered Implementation Steps

1. **Write the failing tests** for cases **A1-A6** in `## Expected Behaviour`, in [tests/component/container/MenuRow.test.ts](packages/lib/tests/component/container/MenuRow.test.ts), plus the `Menu`-level case **A9** in [tests/overlay/Menu.test.ts](packages/lib/tests/overlay/Menu.test.ts). Cases **A7** and **A8** are existing coverage in `MenuRow.test.ts` that must stay green, not new tests. Every row built in a test must be disposed, per the file's existing `afterEach` comment. Run `npx vitest run tests/component/container/MenuRow.test.ts tests/overlay/Menu.test.ts` — A1-A6 and A9 must fail, everything else must pass. The separator cases A10-A13 come later, in step 9.

2. **Create** `packages/lib/src/typescript/lib/component/container/AbstractBooleanMenuRow.ts`. Move, verbatim except for the substitutions below, from [CheckboxMenuRow.ts](packages/lib/src/typescript/lib/component/container/CheckboxMenuRow.ts): the `DISABLED_OPACITY` constant and its comment (lines 13-15), the `_iconStart` / `_checkZone` fields and their comments (50-56), `isChecked` / `setChecked` (122-141), `isNavigable` (143-151), `isEnabled` (153-162), `getContentWidth` (176-189), `setColumns` (191-204), and `doLayout` (206-244). Substitutions:
   - Every `this._checkbox` read becomes `this.getControl()`.
   - Doc wording "checkbox" becomes "control"; "Toggles"/"Selects" becomes "Activates".
   - `isEnabled`'s doc says it reads the inner control's own enabled state, the cache for this row's `enabled` option.
   Then add: the `ListenerBag` field, the constructor, `installControl()`, `activate()`, `on` / `off` / `emit`, the two abstract members, and the three private handlers `handleMouseOver` / `handleMouseOut` / `handleClick` (bodies: `this.setFocused(true)`, `this.setFocused(false)`, `this.activate()`).[^handler-methods] Imports: `ComponentOptions`, `Event`, `ListenerBag`, `AbstractBooleanInput`, `MenuItem`, `MenuRow`.

3. **Rewrite** [CheckboxMenuRow.ts](packages/lib/src/typescript/lib/component/container/CheckboxMenuRow.ts) down to: the `CheckboxMenuRowOptions` interface (now `extends AbstractBooleanMenuRowOptions`, empty body with a doc comment), the class JSDoc, the `_checkbox` field, a constructor that calls `super(options, subclassDefaults)`, builds the `Checkbox` exactly as today (lines 80-84), and calls `this.installControl()`, plus `getControl()` and `applyActivation()`. Keep the `callable()` export block unchanged. Delete `CheckboxMenuRowEvent`, `DISABLED_OPACITY`, the `_iconStart` / `_checkZone` fields, the three handler fields, the `applyListeners` call, and every method now inherited.

   **Do not call `applyListeners` again** — the base already did, and `ListenerBag.add` does not deduplicate, so a second call would fire every construction-time listener twice.

   **Keep the field named `_checkbox`** — [MenuRow.test.ts:163](packages/lib/tests/component/container/MenuRow.test.ts#L163) and [:173](packages/lib/tests/component/container/MenuRow.test.ts#L173) read it through an `as any` cast.

4. **Rewrite** [RadioMenuRow.ts](packages/lib/src/typescript/lib/component/container/RadioMenuRow.ts) the same way. The `RadioButton` construction (lines 80-83) is unchanged — its label is the **first positional argument**, not an options field. `applyActivation()` is `this.setChecked(true)`; keep the select-only explanation from today's `activate()` doc (lines 164-170) on it. **Keep the field named `_radio`** ([MenuRow.test.ts:425](packages/lib/tests/component/container/MenuRow.test.ts#L425), [:435](packages/lib/tests/component/container/MenuRow.test.ts#L435)).

5. **Update the barrel** [component/container/index.ts](packages/lib/src/typescript/lib/component/container/index.ts): add `export { AbstractBooleanMenuRow }` and `export type { AbstractBooleanMenuRowOptions, AbstractBooleanMenuRowEvent }` from the new module, placed directly above the `CheckboxMenuRow` line; drop `CheckboxMenuRowEvent` from line 17 and `RadioMenuRowEvent` from line 19.

   Checkpoint: `grep -rn 'CheckboxMenuRowEvent\|RadioMenuRowEvent' packages/lib/src packages/lib/tests` — expect zero matches.

6. **Run** `npm run typecheck && npm run typecheck:test && npx vitest run tests/component/container/MenuRow.test.ts` — A1-A8 must now pass.

7. **Converge the separator build** in [Menu.ts:971-1010](packages/lib/src/typescript/lib/overlay/Menu.ts#L971). Replace `buildPersistentItems`' `if (config.row && config.separator !== true)` branch structure with the same three-branch shape `showAnchored` uses ([Menu.ts:290-318](packages/lib/src/typescript/lib/overlay/Menu.ts#L290)): `config.separator === true` builds `new MenuSeparator()` (its default prefix is already `"menu-bar"`), `else if (config.row)` keeps today's factory branch, `else` builds the `MenuItem`. `MenuSeparator` is already imported at line 13. Replace the branch's existing comment with one noting that both loops now differ only in their CSS-variable prefix and their activate callback.

8. **Delete `MenuItem`'s separator branch** in [MenuItem.ts](packages/lib/src/typescript/lib/component/container/MenuItem.ts):
   - Remove `SEPARATOR_HEIGHT` (line 170) and the whole `if (config.separator) { … return; }` block (242-262).
   - Remove the `isSeparator()` override (482-484) — `MenuRow`'s default already returns `false`.
   - `isNavigable()` (493-495) becomes `return true;` with its doc trimmed to "every item is navigable; `activate` is what refuses to run for a disabled one".
   - Remove `setEnabled`'s separator guard (522-524) and `doLayout`'s separator early return (664-666).
   - Update the class JSDoc (line 156) to drop the "renders instead as a thin horizontal rule" sentence, and `updateLabelHeights`' comment (620-621) to drop "a separator has none of these".
   - Update `MenuItemConfig.separator`'s doc (line 115) to: `Menu` renders a `MenuSeparator` for this entry and ignores every other field, `row` included.

9. **Update the separator tests** — cases **A10-A13** in `## Expected Behaviour`:
   - [tests/overlay/Menu.test.ts:1425-1439](packages/lib/tests/overlay/Menu.test.ts#L1425) (**A11**): the comment claiming persistent mode never builds a `MenuSeparator` is now wrong — replace it with one stating both modes build `MenuSeparator`, and change `expect(row).toBeInstanceOf(MenuItem)` to `toBeInstanceOf(MenuSeparator)`. `expect(row.isSeparator()).toBe(true)` and `expect(factory).not.toHaveBeenCalled()` stay.
   - [tests/overlay/Menu.test.ts](packages/lib/tests/overlay/Menu.test.ts) (**A10**): add a new case beside it asserting that a plain `{ separator: true }` entry in persistent mode builds a `MenuSeparator` whose `isSeparator()` is `true` and whose preferred height is `MenuSeparator.HEIGHT`.
   - [tests/overlay/Menu.test.ts:167-172](packages/lib/tests/overlay/Menu.test.ts#L167) (**A12**): the existing "no-ops on a separator index" case is unchanged and must still pass — a `MenuSeparator` fails `setItemEnabled`'s `instanceof MenuItem` guard just as a separator `MenuItem` failed its own internal guard.
   - [tests/component/container/leaves.smoke.test.ts:95-103](packages/lib/tests/component/container/leaves.smoke.test.ts#L95): build the separator as `new MenuSeparator()` and keep the `MenuItem` leaf as the `false` case.
   - [tests/component/content-box-containment.test.ts:543-550](packages/lib/tests/component/content-box-containment.test.ts#L543) (**A13**): build `new MenuSeparator('menu-bar', { border: '2px solid black' })` instead of the `MenuItem`.

10. **Amend `MenuRow.closeMenu()`'s JSDoc** ([MenuRow.ts:236-243](packages/lib/src/typescript/lib/component/container/MenuRow.ts#L236)) to state that it is the extension point a consumer-written `MenuRow` subclass calls to dismiss the panel hosting it, and that no shipped subclass calls it because none needs to. Do not `{@link}` it from any exported symbol's JSDoc — it is `protected`, and CODE_CONVENTIONS.md forbids that link.

11. **Fix the `Split` comment that the fix falsifies** at [tests/component/layout/Split.gutterMenu.test.ts:407-425](packages/lib/tests/component/layout/Split.gutterMenu.test.ts#L407). Its comment says calling `activate()` directly bypasses the click event "and therefore `syncCollapseRows` entirely"; after this change `activate()` emits `"action"`, so the handler and `syncCollapseRows` do run. Rewrite the comment to say `activate()` now runs the same handler a click does, and that the assertion isolates the select-only rule because a `CheckboxMenuRow` would have flipped the row to unchecked before the re-sync ran. The assertion itself is unchanged and must still pass.

12. **Documentation** — see `## Documentation Impact`.

13. **Full verification** — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/container/AbstractBooleanMenuRow.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/CheckboxMenuRow.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/RadioMenuRow.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/MenuRow.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/MenuItem.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/index.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Menu.ts` |
| Modify | `packages/lib/tests/component/container/MenuRow.test.ts` |
| Modify | `packages/lib/tests/component/container/leaves.smoke.test.ts` |
| Modify | `packages/lib/tests/component/content-box-containment.test.ts` |
| Modify | `packages/lib/tests/component/layout/Split.gutterMenu.test.ts` |
| Modify | `packages/lib/tests/overlay/Menu.test.ts` |
| Modify | `packages/lib/docs/components/CheckboxMenuRow.md` |
| Modify | `packages/lib/docs/components/RadioMenuRow.md` |
| Modify | `packages/lib/docs/components/MenuItem.md` |
| Modify | `packages/lib/docs/components/index.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/llms.txt` (regenerated, never hand-edited) |

---

## Expected Behaviour

All unit-testable unless marked. The `click(row)` helper at [MenuRow.test.ts:27-30](packages/lib/tests/component/container/MenuRow.test.ts#L27) dispatches a real exact-target click through the window listener; use it for every click case.

**A1.** `new CheckboxMenuRow({ text: 'Bold', listeners: { action } })`, then `row.activate()` — `action` is called exactly once, and inside it `row.isChecked()` reads `true`. *(This is the reported bug; it fails today.)*

**A2.** The same row, `row.activate()` twice — `action` is called twice, and reads `true` then `false`.

**A3.** `new RadioMenuRow({ text: 'Lead', listeners: { action } })`, then `row.activate()` twice — `action` is called twice, and reads `true` both times. The second activation changes no state but still notifies, matching the click behaviour case R5 already pins at [MenuRow.test.ts:302-324](packages/lib/tests/component/container/MenuRow.test.ts#L302).

**A4.** `new CheckboxMenuRow({ text: 'Bold', enabled: false, listeners: { action } })`, then `row.activate()` — `action` is never called and `isChecked()` stays `false`. Same for `RadioMenuRow`.

**A5.** `row.setChecked(true)` on either row class fires **no** `action`. Only `activate()` notifies.

**A6.** `row.off('action', fn)` after `row.on('action', fn)` — a following `activate()` does not call `fn`.

**A7.** A click on either row still calls `action` exactly once and reads the post-activation value. *(Passes today; must keep passing.)*

**A8.** Every existing `CheckboxMenuRow` / `RadioMenuRow` case in `MenuRow.test.ts` still passes unchanged — construction state, `isEnabled`, the disabled opacity + `pointerEvents` writes, `isNavigable()`, `getContentWidth()`, and the `setColumns` / `doLayout` placement assertions that read `_checkbox` / `_radio`.

**A9.** In [tests/overlay/Menu.test.ts](packages/lib/tests/overlay/Menu.test.ts): a persistent-mode `new Menu([{ row: () => new CheckboxMenuRow({ text: 'Bold', listeners: { action } }) }], onClose)` — after `menu.focusItem(0)` and `menu.activateFocused()`, `action` has been called once, and the row read back from `_menuItems[0]` reports `isChecked() === true`. Reading the row out of `_menuItems` rather than closing over a pre-built instance follows the idiom already used at [Menu.test.ts:180-182](packages/lib/tests/overlay/Menu.test.ts#L180), and respects `MenuItemConfig.row`'s rule that a factory must return a fresh instance. This case is the end-to-end shape of the MenuBar Enter path.

**A10.** Persistent mode builds a `MenuSeparator` for `{ separator: true }`: `new Menu([{ text: 'A' }, { separator: true }], onClose)` — the second row is a `MenuSeparator` instance, `isSeparator()` is `true`, and its preferred height is `MenuSeparator.HEIGHT` (9).

**A11.** `separator` still wins over `row` in persistent mode: `new Menu([{ separator: true, row: factory }], onClose)` builds a `MenuSeparator` and never calls `factory`.

**A12.** `Menu.setItemEnabled(index, false)` on a separator index still does not throw — a `MenuSeparator` is not a `MenuItem`, so [Menu.ts:530](packages/lib/src/typescript/lib/overlay/Menu.ts#L530)'s `instanceof` guard skips it.

**A13.** A `MenuSeparator` given a border has no child components to pin (the case migrated from `content-box-containment.test.ts`).

**Manual verification** (the offline harness cannot exercise real key events, focus, or rendered separator geometry):

**M1.** Dev app (`npm run dev`, http://localhost:8015), **MenuBar** section: open the **Options** menu, arrow down to *Enable Notifications*, press Enter. The checkbox flips **and** the status line below the bar updates. Repeat for *Auto-Save*. Then click the same rows with the mouse and confirm the status line still updates exactly once per click.

**M2.** Same section: confirm the separator between the three `checked` items and the two `CheckboxMenuRow` entries still renders as a thin rule with the same height and spacing as before, in both the MenuBar dropdown (persistent mode) and a right-click context menu.

**M3.** **Split** section: right-click a gutter. The five rows render at their previous positions; the two *Collapse …* radio rows still behave as one choice — picking one clears the other, and re-picking the selected one changes nothing.

---

## Verification

- `npm run typecheck` and `npm run typecheck:test` — both clean.
- `npm run test` — full suite green.
- `npm run lint` — no new findings; the `local/require-content-bounds` rule must stay quiet for the base's `doLayout`, which reads `getContentBounds()`.
- `grep -rn 'CheckboxMenuRowEvent\|RadioMenuRowEvent' packages/lib/` — zero matches outside `plans/`.
- `grep -rn 'SEPARATOR_HEIGHT' packages/lib/src` — zero matches.
- `grep -n 'applyListeners' packages/lib/src/typescript/lib/component/container/AbstractBooleanMenuRow.ts packages/lib/src/typescript/lib/component/container/CheckboxMenuRow.ts packages/lib/src/typescript/lib/component/container/RadioMenuRow.ts` — exactly one match, in `AbstractBooleanMenuRow.ts`.
- `npm run docs:api` — must finish with **zero** warnings.
- `npm run docs:llms` — regenerate `packages/lib/llms.txt` and commit whatever it produces. No manifest entry is needed for the new abstract class.[^llms]
- `npm run build:lib` — succeeds.
- Manual checks **M1-M3** above.

---

## Documentation Impact

- [docs/components/CheckboxMenuRow.md](packages/lib/docs/components/CheckboxMenuRow.md) — the Methods table's `on("action", fn)` row: it fires once per activation, whether the activation came from a click or from Enter, after the row's own state has flipped. The page's opening paragraph already promises the Enter behaviour and needs no change.
- [docs/components/RadioMenuRow.md:62](packages/lib/docs/components/RadioMenuRow.md#L62) — "Subscribe to each click" becomes "Subscribe to each activation — a click or Enter"; note it fires even when the row was already selected.
- [docs/components/index.md](packages/lib/docs/components/index.md) — Menus table: add an `AbstractBooleanMenuRow` row directly after `MenuRow`, linking `/api/component/container/classes/AbstractBooleanMenuRow`, described as the shared base for a menu row hosting a boolean control. This mirrors how `AbstractInput` is catalogued at [index.md:50](packages/lib/docs/components/index.md#L50) — a catalogue row, no dedicated page.
- [docs/components/MenuItem.md:21](packages/lib/docs/components/MenuItem.md#L21) — the `separator` row: `Menu` renders a `MenuSeparator` for the entry and ignores every other field.
- [docs/components/MenuSeparator.md](packages/lib/docs/components/MenuSeparator.md) — no edit. Its claims that `separator: true` "inserts a MenuSeparator" and that `Menu` picks the CSS-variable family automatically become true in both menu modes for the first time.
- [docs/reference/changelog/next.md](packages/lib/docs/reference/changelog/next.md) — three bullets under new headings:
  - `## Fixed` → `### Menu`: activating a `CheckboxMenuRow` or `RadioMenuRow` with Enter now fires its `action` listener. Previously only a mouse click did, so a keyboard user could flip the control without the application ever hearing about it.
  - `## Fixed` → `### Menu`: a `MenuBar` dropdown's `separator: true` entry now renders through `MenuSeparator`, the same class a context menu already used.
  - `## Changed` → `### Menu`: `CheckboxMenuRow` and `RadioMenuRow` now share the new `AbstractBooleanMenuRow` base. `action` moves onto the framework's `on` / `off` listener surface; the call shapes are unchanged. The unused `CheckboxMenuRowEvent` and `RadioMenuRowEvent` type exports are removed in favour of `AbstractBooleanMenuRowEvent`.
- Export surface: the three new symbols join [component/container/index.ts](packages/lib/src/typescript/lib/component/container/index.ts), already a TypeDoc entry point — no `typedoc.json` change.

---

## Potential Challenges

- **A second `applyListeners` call fires every listener twice.** `Event.addListener` silently ignored a repeat registration of the same function; `ListenerBag.add` appends unconditionally. The base owns the single call; neither subclass may keep its own.
- **`getControl()` throws if called before the subclass assigns its field.** Nothing in the base's constructor may call it — the constructor's only job is `super(…)` plus `applyListeners`. Everything else waits for `installControl()`.
- **`Split.syncCollapseRows` would recurse if the emit sat in `setChecked`.** [Split.ts:1122-1127](packages/lib/src/typescript/lib/layout/Split.ts#L1122) calls `setChecked` on both collapse rows from inside an `action` handler. Keep the emit in `activate()` only.
- **`Checkbox.setSelected` still fires a synthetic DOM `click` on its own element** ([Checkbox.ts:430](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L430)). That click is inert here — the row's own `click` listener matches on the row's element id, not the checkbox's — but do not "simplify" the pointer-inert child away; it is what routes a click on the graphic to the row.
- **Removing `MenuItem`'s separator branch changes what `new MenuItem({ separator: true }, …)` renders.** Direct construction outside `Menu` is awkward (two mandatory callback arguments) and has no in-repo caller other than the two tests migrated in step 9, but the change is worth naming in review.
- **The `llms.txt` token budget is nearly full.** If `npm run docs:llms` fails, raise `TOKEN_BUDGET` at [scripts/llms/generate.mjs:60](packages/lib/scripts/llms/generate.mjs#L60) by the minimum needed and extend its comment; do not trim existing catalogue wording.
- **Undisposed rows break later tests in the same file.** `Event`'s installed-listener bookkeeping outlives `DOM.reset()`, so every row a new test builds must be disposed.

---

## Critical Files

| File | Why |
|---|---|
| [component/input/AbstractBooleanInput.ts](packages/lib/src/typescript/lib/component/input/AbstractBooleanInput.ts) | The precedent for the whole extraction: an abstract base that reaches its subclass's graphic through `protected abstract getInteractiveSurface()` (line 201) and defers post-`super()` wiring to a protected `installKeyboard()` (162-164). Also the return type of `getControl()`. |
| [component/input/AbstractInput.ts:59-77](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L59), [:150-200](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L150) | The precedent for the `ListenerBag` half: field initializer wrapped in `registerListenerBag`, `applyListeners` called once from the base constructor with a comment saying leaves must not repeat it, and the typed `on` / `off` / `emit` forwarders. |
| [component/container/CheckboxMenuRow.ts](packages/lib/src/typescript/lib/component/container/CheckboxMenuRow.ts) | The source of everything moving into the base, comments included. |
| [component/container/RadioMenuRow.ts](packages/lib/src/typescript/lib/component/container/RadioMenuRow.ts) | The copy being collapsed; its `activate()` doc (164-177) carries the select-only rule that survives on `applyActivation()`. |
| [component/container/MenuRow.ts](packages/lib/src/typescript/lib/component/container/MenuRow.ts) | The contract `Menu` drives every row through, and the home of `setMenuCloseHandler` / `closeMenu`. |
| [component/container/MenuItem.ts](packages/lib/src/typescript/lib/component/container/MenuItem.ts) | The separator branch being deleted, the five methods that guard on it, and `MenuItemConfig`'s `checked` / `separator` / `row` docs. |
| [component/container/MenuSeparator.ts](packages/lib/src/typescript/lib/component/container/MenuSeparator.ts) | The surviving separator: same 9 px height, border, margin and `role` the deleted branch wrote. |
| [overlay/Menu.ts:290-318](packages/lib/src/typescript/lib/overlay/Menu.ts#L290), [:807-819](packages/lib/src/typescript/lib/overlay/Menu.ts#L807), [:971-1010](packages/lib/src/typescript/lib/overlay/Menu.ts#L971) | The two build loops being aligned, and `activateFocused` — the keyboard entry point the bug lives on. |
| [core/Event.ts:274-290](packages/lib/src/typescript/lib/core/Event.ts#L274) | The exact-target routing that makes a synthetic click on a child undeliverable to the parent's listener — the mechanism behind the bug. |
| [core/ListenerBag.ts](packages/lib/src/typescript/lib/core/ListenerBag.ts) | `add` / `remove` / `fire` semantics, including that `add` does not deduplicate. |
| [layout/Split.ts:1105-1200](packages/lib/src/typescript/lib/layout/Split.ts#L1105) | `syncCollapseRows` and the five gutter rows — the consumer most sensitive to when `action` fires. |
| [tests/component/container/MenuRow.test.ts](packages/lib/tests/component/container/MenuRow.test.ts) | The `click()` helper, the dispose rule, and the two `_checkbox` / `_radio` private-field reads that pin those field names. |
| [plans/implemented/split-gutter-collapse-radio.md](plans/implemented/split-gutter-collapse-radio.md) | The `[^no-shared-base]` footnote this plan reverses; read it before the extraction so the reversal is deliberate. |

---

## Non-Goals

- **`MenuItemConfig.checked` is not folded into this extraction.** It stays exactly as it is.[^menuitem-checked]
- **No `setEnabled` on either row, and no live enabled re-sync while a menu is open.** A menu rebuilds its rows from their factories on every open.
- **No dedicated docs page for `AbstractBooleanMenuRow`.** It gets a catalogue row and its generated API page, matching `AbstractInput`.
- **No `ToggleMenuRow`.** `Toggle` is the third `AbstractBooleanInput` subclass, but no menu needs it and the base is not being built speculatively wide.
- **`MenuItemConfig.separator` stays on the config interface.** Only its implementation moves; the consumer-facing way to ask for a separator is unchanged.
- **`ButtonGroup` is not modified**, and neither row exposes its inner control.
- **No change to the pointer-inert inner control, nor to the disabled row's opacity and `pointerEvents` writes.** Both writes and the condition they run under move into the base unchanged.

---

## Notes

[^why-bag]: ARCHITECTURE.md splits the two event surfaces by the **origin** of the event: `Event.addListener` for anything that starts as a real DOM event, `on` / `off` / `emit` over a `ListenerBag` for anything that does not. A boolean menu row's activation has two origins — a DOM click on the row, and `Menu.activateFocused()` calling `row.activate()` from a key handler that belongs to a different component. The second has no DOM event on the row at all, which is exactly why the DOM-shorthand form cannot carry it. Two alternatives were rejected. Synthesising a click inside `activate()` needs a re-entrancy flag (the row's own `click` handler calls `activate()`) and throws when the row is not yet mounted, since `Event.fireEvent` requires an element. Registering the consumer's listener on the inner control instead is the cross-component listening ARCHITECTURE.md forbids outright, and would not fire for `RadioButton` anyway — `RadioButton.setSelected` dispatches nothing.

[^emit-placement]: `Split.openGutterMenu`'s `action` handler calls `syncCollapseRows`, which calls `setChecked` on both collapse rows ([Split.ts:1122-1127](packages/lib/src/typescript/lib/layout/Split.ts#L1122)). If `setChecked` emitted, that write would re-enter the handler, which would call `setChecked` again, and so on. Emitting from `activate()` alone also keeps the existing meaning of the event — "the user actioned this row" — rather than widening it to "this row's value was written", which is what the inherited `change` event on the inner control already means.

[^accessor]: The alternative the earlier plan assumed — a `declare protected _control` field on the base that each subclass fills in after `super()` — is what made the seam look bad, and it is not needed. With an abstract accessor the base holds no field for the control, so there is no initializer to clobber and no `declare` workaround. Nothing in the base's construction wants the control: `MenuRow`'s constructor only calls `setPreferredSize`, `ComponentOptions` carries no `enabled` field for `applyOptions` to dispatch, and `doLayout` / `getContentWidth` / `isEnabled` / `isChecked` / `setChecked` all run after construction. The typing was checked against the real tree rather than assumed: a probe declaring `protected abstract getControl(): AbstractBooleanInput` with `Checkbox` and `RadioButton` implementations, calling `getValue` / `setValue` / `isEnabled` / `getPreferredSize` / `setX` / `setY` / `setWidth` / `setHeight` / `setPointerEvents` through it, compiles clean under `tsc -p tsconfig.lib.json --noEmit`.

[^rejection-reversed]: The rejection's first ground was that a base "cannot build the control before `super()` returns", forcing a `declare`-guarded field the base reads before the subclass fills it. That describes one possible design, not the only one — see the abstract-accessor footnote above; the base never holds the control at all. Its second ground was blast radius: `CheckboxMenuRow` already had several consumers, and refactoring it while adding one row type was too large a change. That ground was about the timing, not the design, and it does not survive a change that alters no public signature: `new CheckboxMenuRow({…})`, `on("action", fn)`, `off`, `isChecked()`, `setChecked()`, `isEnabled()`, `isNavigable()`, `getContentWidth()`, `setColumns()` and `activate()` all keep their exact shapes, so every existing call site compiles and behaves identically apart from the bug being fixed. The footnote also set its own trigger — "the extraction is the right move at the third boolean menu row" — and that trigger was already met when `RadioMenuRow` was written: `MenuItemConfig.checked` ([MenuItem.ts:74-92](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L74)) was the first checkable-menu-row mechanism and predates both classes.

[^separator-converge]: The two implementations render the identical row: `MenuSeparator` sets height 9, `borderTop: 1px solid var(--ts-ui-<prefix>-separator-color, …)`, `margin: 4px 0`, `backgroundColor: transparent` and `role="separator"` ([MenuSeparator.ts:44-59](packages/lib/src/typescript/lib/component/container/MenuSeparator.ts#L44)); `MenuItem`'s branch writes the same five things ([MenuItem.ts:242-262](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L242)). Converging on `MenuSeparator` rather than the other way round is forced: `MenuSeparator` is the one that already serves rebuild mode, the one the shipped docs describe, and the one whose whole class is those five writes. Leaving `MenuItem`'s branch in place after switching the call site would leave a second implementation alive only through its tests — the same condition that let the two drift in the first place. `Menu`'s only structural reads of a row are `isSeparator()` ([Menu.ts:197](packages/lib/src/typescript/lib/overlay/Menu.ts#L197)) and `isNavigable()`, and `MenuSeparator` answers both the way the deleted branch did.

[^close-menu]: The evidence that `closeMenu()` is contract rather than leftover: `MenuRow`'s class JSDoc invites consumers to extend it for a custom row; `setMenuCloseHandler`'s own JSDoc already states that the injected callback is "the only way a subclass can close the panel it is hosted in"; `Menu` wires it on every factory-built row in both build loops; and [docs/components/Menu.md:83](packages/lib/docs/components/Menu.md#L83) documents it to consumers by name. No in-repo caller is expected, because the intended caller is a consumer subclass outside this repository. Removing it would delete the only escape hatch for a documented use case — a custom row with an "Apply and close" affordance — and there is no cheaper replacement, since a factory row holds no reference to its menu.

[^handler-methods]: The three handlers become private methods rather than the `readonly` arrow-function fields the two rows use today. `Event`'s dispatcher invokes a listener as `entry.listener.apply(compFunc.component, [evnt])` ([Event.ts:285](packages/lib/src/typescript/lib/core/Event.ts#L285)), so a plain method receives the component as `this`; `AbstractBooleanInput.handleActivationKey` ([AbstractBooleanInput.ts:146-164](packages/lib/src/typescript/lib/component/input/AbstractBooleanInput.ts#L146)) is the same shape in the class this extraction mirrors. The fields existed only to hold the closures — `Component.destructor` purges the registrations, so nothing removes them by reference — and no test reads them. Both forms satisfy ARCHITECTURE.md's "listeners must reference a named function" rule.

[^menuitem-checked]: `MenuItemConfig.checked` and `CheckboxMenuRow` look like the same feature but sit on different composition models and produce different rows. `checked` is a declarative field on a data descriptor: it renders a `✓` `Text` in the menu's shared leading check column, makes every row in that menu reserve that column so the icon and title columns stay aligned, and auto-flips only when the entry also sets `closeOnActivate: false` ([MenuItem.ts:549-556](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L549)). `CheckboxMenuRow` is a component built by a `row:` factory: it hosts a real `Checkbox`, reserves no check column (`hasCheck()` keeps `MenuRow`'s `false`), and aligns its graphic at the *icon* position instead. Consolidating them would force one visual and one column contribution on both. The rule-of-three question the duplication raises is answered by the extraction itself: the two byte-identical classes share a base, and the third, differently-shaped mechanism stays where it is.

[^llms]: `packages/lib/llms.txt` is generated from `scripts/llms/manifest.data.mjs`, whose header states that abstract exports are deliberately absent because the catalogue is task-facing. `CheckboxMenuRow` and `RadioMenuRow` keep their existing manifest entries, and the generator scrapes each summary from the class JSDoc's first sentence — which this plan leaves unchanged — so the regenerated file should differ little or not at all.

## Implementation Notes

- **`packages/lib/tests/component/dispose-listener-teardown.test.ts` needed a one-line update, though it isn't in the plan's Files table.** This registry test enumerates, via a source scan, every class with its own `Event.addListener(this, …)` call site and asserts an explicit shrink-only baseline (`UNCLAIMED_LISTENER_CLASSES`) of the ones with no dedicated coverage. Moving the `mouseover`/`mouseout`/`click` registrations from `CheckboxMenuRow`/`RadioMenuRow` into `AbstractBooleanMenuRow.installControl()` (per this plan's design) mechanically moves those call sites to the new class too, so the live scan now reports `AbstractBooleanMenuRow` instead of the two former leaf classes. Updated the baseline array to swap `'CheckboxMenuRow'` / `'RadioMenuRow'` for `'AbstractBooleanMenuRow'`, keeping alphabetical order — no new listener-registering behaviour was introduced, just relocated. `npm run test` is green with this change; it was the only file outside the plan's table that needed touching.
- **`AbstractBooleanMenuRow.ts`'s own class-level JSDoc initially linked `{@link getControl}` and `{@link applyActivation}`** (the two abstract members) from its own doc comment. Both are `protected`, so `npm run docs:api` flagged two "resolved but not included in the documentation" warnings — the same rule CODE_CONVENTIONS.md and `docs-conventions.md` state for any exported symbol's JSDoc. Switched both to plain backticks (`` `getControl()` `` / `` `applyActivation()` ``), matching the convention for a non-linkable internal symbol. `npm run docs:api` now reports only the one pre-existing, unrelated warning on `DiagramEdgeLayer.setEdges` (a file this plan never touches).
