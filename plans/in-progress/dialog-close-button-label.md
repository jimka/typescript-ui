---
depends-on: [focus-history-can-go-back-follows-focus]
touches-shared:
  - packages/lib/src/typescript/lib/overlay/Dialog.ts
  - packages/lib/src/typescript/lib/core/Body.ts
  - packages/lib/src/typescript/lib/core/index.ts
  - packages/lib/tests/overlay/Dialog.aria.test.ts
  - packages/lib/tests/overlay/Dialog.test.ts
  - packages/lib/docs/components/Dialog.md
  - packages/lib/docs/components/Body.md
  - packages/lib/docs/concepts/accessibility.md      # also edited by window-focus-on-show (same section, another paragraph) and spatial-navigation-redesign
  - packages/lib/docs/reference/changelog/next.md    # also edited by every branch of the stack
---

# Dialog Close Button Label — Implementation Plan

## Overview

The title-bar close button of a [`Dialog`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L714) is named "Close". The name is a module constant, [`CLOSE_BUTTON_LABEL`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L193), which [`DialogTitleBar`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L321) passes to its `Button` as a hidden `text`. The button writes that text into `aria-label` and shows it as a tooltip.

An application can rename the button only on a dialog it constructs itself, through `dialog.getTitleBar().getCloseButton()?.setText(…)`. It cannot reach the button of a dialog the library constructs:

| How the dialog is made | Can the close button be renamed today? |
|---|---|
| `new Dialog(config)`, or a subclass | yes, after construction, through `getTitleBar().getCloseButton()` |
| `Dialog.show(config)` | no: the dialog is never handed out |
| `Dialog.confirm`, `info`, `success`, `warning`, `error` | no: they take `(title, message)` and no config |

This plan adds two things. `DialogConfig` gains `closeButtonLabel`, for one dialog. `Body` gains a `strings` option, an application-wide table of the library's built-in strings that holds one entry so far: the dialog close button's name. The second is what reaches the five shortcuts, and it is the smallest mechanism that a later localisation of the library's other strings can grow from. The work is in `overlay/Dialog.ts`, `core/Body.ts` and one new module, `core/BuiltInStrings.ts`.

Line numbers and links are those of commit `59a5c2e27`, the tip of `feature/focus-history-can-go-back-follows-focus`, which this plan is implemented on. The code it builds on is not on `master`.

Nothing changes for an application that sets neither: the button is still named "Close". `plans/window-focus-on-show.md` is independent of this plan; the two can be implemented in either order.

---

## Decisions Awaiting Sign-off

The plan is written for the recommended answer. A different answer means revising the plan before it is implemented; the implementer does not choose.

| # | Question | Recommended, and what the plan builds | If answered otherwise |
|---|---|---|---|
| 1 | How far does this go? | **A config field for one dialog, plus an application-wide table of built-in strings with one entry.**[^scope] | *Field only:* steps 2 and 3 and cases S, B and D5–D7 are dropped, step 5 falls back to `CLOSE_BUTTON_LABEL`, which stays, and the five shortcuts keep "Close". *Full localisation:* a separate, much larger plan; see [Addendum: The library's built-in strings](#addendum-the-librarys-built-in-strings). |
| 2 | What are the new names? | **`Body` option `strings`, type `BuiltInStrings`, entry `dialogClose`, config field `closeButtonLabel`.** Every later entry of the table follows the first one's naming.[^names] | Other names change the plan's identifiers only. |

Neither answer breaks existing code, so there is no migration note.

---

## Architecture Decisions

### A dialog resolves the name once, when it is constructed

The `Dialog` constructor resolves the close button's name and passes it to `DialogTitleBar`, which builds the button with it. The first non-empty value wins:

| `closeButtonLabel` in the config | `strings.dialogClose` set on `Body` | Name |
|---|---|---|
| — | — | `Close` |
| — | `'Stäng'` | `Stäng` |
| `'Discard'` | `'Stäng'` | `Discard` |
| `''` | `'Stäng'` | `Stäng` |
| — | `''` | `Close` |
| `'Discard'`, with `dismissable: false` | any | no close button exists |

An empty string counts as not set at both levels, as it does for `ariaLabel`: an icon-only button with no name is the defect this plan must not make possible.

### One dialog — `DialogConfig.closeButtonLabel`

`DialogConfig` gains `closeButtonLabel?: string`. It follows [`ariaLabel`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L171), the config field `dialog-aria-semantics` added for the same reason: `Dialog.show(config)` never hands out the dialog. It is read once, in the constructor, and has no setter; afterwards the name lives on the button.[^field]

### Every dialog — a `strings` option on `Body`

`BodyOptions` gains `strings`, a partial table of the library's built-in strings, with `Body.setStrings` and `Body.getStrings`. The table is held in a new module, `core/BuiltInStrings.ts`, which `Dialog` reads directly.

This mirrors [`resizeMode`](../packages/lib/src/typescript/lib/core/Body.ts#L45), the one existing setting an application makes once for components it cannot reach: an option on `Body`, a module-level value in the module that uses it ([`core/ResizeDrag.ts:108`](../packages/lib/src/typescript/lib/core/ResizeDrag.ts#L108)), and each owner preferring its own option when it has one.[^body-option]

| Part | `resizeMode` (existing) | `strings` (new) |
|---|---|---|
| Set once by the application | `Body.init({ resizeMode })`, `Body.setResizeMode` | `Body.init({ strings })`, `Body.setStrings` |
| Held in | `core/ResizeDrag.ts`, `_appResizeMode` | `core/BuiltInStrings.ts`, `_appStrings` |
| Read by | `Split`, `Accordion`, `Table`, a window, at drag start | `Dialog`, at construction |
| An owner's own override | its `resizeMode` option | `DialogConfig.closeButtonLabel` |
| Takes effect | from the next drag | for the next dialog constructed |

### The table has one entry, and `setStrings` replaces the application's overrides

`BuiltInStrings` declares exactly one key, `dialogClose`. `Body.setStrings(strings)` replaces the application's whole set of overrides with `strings`; `Body.getStrings()` returns the full table, with the library's default for every key the application did not set.[^replace]

| Calls, in order | `getStrings().dialogClose` |
|---|---|
| none | `Close` |
| `setStrings({ dialogClose: 'Stäng' })` | `Stäng` |
| then `setStrings({})` | `Close` |
| `setStrings({ dialogClose: '' })` | `Close` |

A dialog that is already open keeps the name it was built with. No other built-in string moves into the table in this plan.

### The five shortcuts need no change

`Dialog.confirm`, `info`, `success`, `warning` and `error` construct their dialog through `Dialog.show`, so each picks up `strings.dialogClose` with no code of its own. Their signatures stay `(title, message)`.[^shortcuts]

### `DialogTitleBar` is told the name

`DialogTitleBar`'s constructor gains a fourth, required parameter, `closeLabel`. The title bar holds no default of its own, so the name is resolved in one place. A required parameter is what the window-control factories of [`windowControls.ts`](../packages/lib/src/typescript/lib/overlay/windowControls.ts#L51) use for the same purpose.[^title-bar]

---

## Public API

```typescript
// core/BuiltInStrings.ts — new module

/**
 * The strings the library itself shows or announces, which an application can
 * replace — for another language, say — through the `strings` option of
 * `Body.init`. Holds only the strings that have been moved here.
 */
export interface BuiltInStrings {
    /** Accessible name and tooltip of a `Dialog`'s title-bar close button. Default `"Close"`. */
    dialogClose: string;
}

// Framework-internal, like getAppResizeMode / setAppResizeMode: not re-exported
// from core/index.ts.
export function getBuiltInString(key: keyof BuiltInStrings): string;
export function getAppBuiltInStrings(): BuiltInStrings;
export function setAppBuiltInStrings(strings: Partial<BuiltInStrings>): void;
```

```typescript
// core/Body.ts

export interface BodyOptions extends Omit<ComponentOptions, "components"> {
    // … existing fields …

    /**
     * Replacements for the library's built-in strings, used by every component
     * that has none of its own — including the dialogs `Dialog.show` and the
     * dialog shortcuts build. Omitted keys keep the library's English default.
     * See {@link Body.setStrings}.
     */
    strings?: Partial<BuiltInStrings>;
}

/** New. Replaces the application's overrides of the built-in strings. */
setStrings(strings: Partial<BuiltInStrings>): this;

/** New. The built-in strings in effect: the library's defaults with the application's overrides applied. */
getStrings(): BuiltInStrings;
```

```typescript
// overlay/Dialog.ts

export interface DialogConfig {
    // … existing fields …

    /**
     * Accessible name and tooltip of the title-bar close button, for this
     * dialog only. Defaults to the application-wide `strings.dialogClose` set
     * through `Body`, which is `"Close"` unless changed. An empty string
     * counts as not set. Read once, at construction; change it afterwards
     * through `dialog.getTitleBar().getCloseButton()?.setText(…)`.
     */
    closeButtonLabel?: string;
}

// class DialogTitleBar
constructor(title: string, onClose: () => void, dismissable: boolean, closeLabel: string);
```

- `BuiltInStrings` is added as a type export in [`core/index.ts`](../packages/lib/src/typescript/lib/core/index.ts#L34), beside `ResizeMode`.
- State: the overrides live in `_appStrings` in `core/BuiltInStrings.ts`. `Body` keeps no field of its own; `setStrings` and `getStrings` forward, as `setResizeMode` and `getResizeMode` do.
- `closeButtonLabel` has no setter and no backing field.
- `Dialog.show`, `confirm`, `info`, `success`, `warning` and `error` keep their signatures.

---

## Internal Structure

Every new function, method and constant gets a JSDoc block ([CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md)). No call sits directly in an `if` condition.

### `core/BuiltInStrings.ts`

The module imports nothing and touches no DOM.

```typescript
/** The library's own wording for every built-in string. */
const DEFAULT_STRINGS: BuiltInStrings = {
    dialogClose: "Close",
};

/** The application's overrides, which `Body.setStrings` writes. */
let _appStrings: Partial<BuiltInStrings> = {};

export function getBuiltInString(key: keyof BuiltInStrings): string {
    const override = _appStrings[key];

    // An empty override would leave an icon-only control with no name.
    return override ? override : DEFAULT_STRINGS[key];
}

export function getAppBuiltInStrings(): BuiltInStrings {
    return {
        dialogClose: getBuiltInString("dialogClose"),
    };
}

export function setAppBuiltInStrings(strings: Partial<BuiltInStrings>): void {
    _appStrings = { ...strings };
}
```

### `core/Body.ts`

```typescript
setStrings(strings: Partial<BuiltInStrings>): this {
    setAppBuiltInStrings(strings);

    return this;
}

getStrings(): BuiltInStrings {
    return getAppBuiltInStrings();
}
```

In `applyOptions`, after the `resizeMode` line:

```typescript
if (options.strings !== undefined) this.setStrings(options.strings);
```

### `overlay/Dialog.ts`

In the `Dialog` constructor, replacing the line that builds the title bar:

```typescript
// The config's own name first, then the application-wide one; an empty
// string counts as not set.
const closeLabel = config.closeButtonLabel ? config.closeButtonLabel : getBuiltInString("dialogClose");

this._titleBar = new DialogTitleBar(config.title, () => this.hide('close'), config.dismissable !== false, closeLabel);
```

In `DialogTitleBar`'s constructor:

```typescript
this._closeButton = new Button({ glyph: "xmark", text: closeLabel, showText: false });
```

---

## Ordered Implementation Steps

Work test-first. For each step write the named cases from `## Expected Behaviour`, see them fail, then make the change.

1. **Baseline.** From `packages/lib`: `npx vitest run tests/overlay/Dialog.aria.test.ts tests/overlay/Dialog.test.ts tests/overlay/DialogSeverity.test.ts tests/core/ResizeDrag.test.ts tests/core/Body.test.ts tests/unit/import-without-dom.test.ts`. All must pass before any edit.

2. **The table.** Create `packages/lib/src/typescript/lib/core/BuiltInStrings.ts` with the SPDX header line every source file starts with, the `BuiltInStrings` interface and the three functions of the snippet. Add `export type { BuiltInStrings } from '~/core/BuiltInStrings.js';` to [`core/index.ts`](../packages/lib/src/typescript/lib/core/index.ts#L34) after the `ResizeMode` export, with a comment on the pattern of the one above it: only the type is public; the table is reached through `Body.setStrings`. Check: cases S1–S5 pass.

3. **`Body`.** In [`core/Body.ts`](../packages/lib/src/typescript/lib/core/Body.ts): import the two functions and the type; add `strings` to `BodyOptions` after `resizeMode` ([:45](../packages/lib/src/typescript/lib/core/Body.ts#L45)); add the `applyOptions` line after the `resizeMode` one ([:170](../packages/lib/src/typescript/lib/core/Body.ts#L170)); add `setStrings` and `getStrings` after `getResizeMode` ([:268](../packages/lib/src/typescript/lib/core/Body.ts#L268)). Give `setStrings` the `@remarks` of `setResizeMode`, reworded: the table is page-wide state held in the module `Dialog` reads, because reaching it through the `Body` singleton would construct the page bootstrap from inside a dialog. Add one sentence about `strings` to the JSDoc of `Body.init`. Check: cases B1–B3 pass.

4. **The config field.** In [`overlay/Dialog.ts`](../packages/lib/src/typescript/lib/overlay/Dialog.ts): add `closeButtonLabel` with its JSDoc to `DialogConfig` after `ariaLabel` ([:171](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L171)).

5. **The title bar and the resolution.** One step, because the build does not typecheck between its two halves. In the same file:
   - Add the `closeLabel` parameter and its `@param` line to `DialogTitleBar`'s constructor ([:300](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L300)) and use it in the `Button` options ([:321](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L321)).
   - In the `Dialog` constructor replace the title-bar line ([:786](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L786)) with the snippet and import `getBuiltInString` from `~/core/BuiltInStrings.js`.
   - Delete `CLOSE_BUTTON_LABEL` and its JSDoc ([:192–193](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L192)).
   - Update the class comment of `DialogTitleBar` ([:282](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L282)): the close button's name comes from the dialog's config or the application's strings.
   - In the two `new DialogTitleBar('T', () => {}, false)` calls of `tests/overlay/Dialog.test.ts` ([:1803](../packages/lib/tests/overlay/Dialog.test.ts#L1803), [:1815](../packages/lib/tests/overlay/Dialog.test.ts#L1815)) add the argument `'Close'`.

   Check: `grep -rn "CLOSE_BUTTON_LABEL" packages/lib/src packages/lib/tests` gives no match; cases D1–D8 pass; the baseline files pass.

6. **Demo.** In `packages/lib/src/typescript/MiscPanel.ts`, in the handler of "Dialog — alert with an accessible name", add `closeButtonLabel: 'Keep the record'` to the config.

7. **Documentation.** Make the edits in `## Documentation Impact`.

8. **Verify.** Run `## Verification` in full.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/BuiltInStrings.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/core/index.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/src/typescript/MiscPanel.ts` |
| Create | `packages/lib/tests/core/BuiltInStrings.test.ts` |
| Modify | `packages/lib/tests/overlay/Dialog.aria.test.ts` |
| Modify | `packages/lib/tests/overlay/Dialog.test.ts` |
| Modify | `packages/lib/docs/components/Dialog.md` |
| Modify | `packages/lib/docs/components/Body.md` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every case is testable offline in the modelled test DOM, except the two marked manual. `closeName(dialog)` is `dialog.getTitleBar().getCloseButton()!.getAria().getLabel()`. Each file that sets a string resets the table in `afterEach` with `setAppBuiltInStrings({})`, as `ResizeDrag.test.ts` resets the resize mode ([:103](../packages/lib/tests/core/ResizeDrag.test.ts#L103)).

### The table (offline)

| # | Given | Then |
|---|---|---|
| S1 | nothing set | `getBuiltInString('dialogClose')` is `'Close'`; `getAppBuiltInStrings()` equals `{ dialogClose: 'Close' }` |
| S2 | `setAppBuiltInStrings({ dialogClose: 'Stäng' })` | both read `'Stäng'` |
| S3 | S2, then `setAppBuiltInStrings({})` | both read `'Close'` |
| S4 | `setAppBuiltInStrings({ dialogClose: '' })` | `getBuiltInString('dialogClose')` is `'Close'` |
| S5 | `const mine = { dialogClose: 'A' }`; `setAppBuiltInStrings(mine)`; `mine.dialogClose = 'B'` | `getBuiltInString('dialogClose')` is `'A'` |

### `Body` (offline)

On the recipe of case B1 in [`ResizeDrag.test.ts:455`](../packages/lib/tests/core/ResizeDrag.test.ts#L455).

| # | Given | Then |
|---|---|---|
| B1 | `Body.getInstance().setStrings({ dialogClose: 'Stäng' })` | `Body.getInstance().getStrings()` equals `{ dialogClose: 'Stäng' }`; `getBuiltInString('dialogClose')` is `'Stäng'`; `setStrings` returns the body |
| B2 | `await Body.init({ strings: { dialogClose: 'Fermer' } })` | `Body.getInstance().getStrings().dialogClose` is `'Fermer'` |
| B3 | B1, then `await Body.init({})` | still `'Stäng'`: an `init` without the option leaves the table alone |

### `Dialog` (offline)

| # | Given | Then |
|---|---|---|
| D1 | `new Dialog({ title: 'T', message: 'M' })`, nothing set | `closeName` is `'Close'`; the button's `isShowText()` is `false`. This is the existing case D11 and must pass unchanged |
| D2 | the same with `closeButtonLabel: 'Discard'` | `closeName` is `'Discard'`; `isShowText()` is `false` |
| D3 | the same with `closeButtonLabel: ''` | `closeName` is `'Close'` |
| D4 | `closeButtonLabel: 'Discard'` and `dismissable: false` | `getCloseButton()` is `null`; no throw |
| D5 | `setAppBuiltInStrings({ dialogClose: 'Stäng' })`; `new Dialog({ title: 'T', message: 'M' })` | `closeName` is `'Stäng'` |
| D6 | D5's table; `new Dialog({ title: 'T', message: 'M', closeButtonLabel: 'Discard' })` | `closeName` is `'Discard'` |
| D7 | a dialog built with nothing set; then `setAppBuiltInStrings({ dialogClose: 'Stäng' })`; then a second dialog | the first is still `'Close'`; the second is `'Stäng'` |
| D8 | D2's dialog; `getTitleBar().getCloseButton()!.setText('Later')` | `closeName` is `'Later'`: the existing rename route still works |

### Unchanged (offline)

`tests/overlay/DialogSeverity.test.ts` passes without edits: the shortcuts pass the same config to `Dialog.show` as before. `tests/unit/import-without-dom.test.ts` passes: the new module touches no DOM at import.

### Existing tests whose expected value changes

None. Two calls in `tests/overlay/Dialog.test.ts` gain an argument (step 5), with no expectation changed.

### Needs manual verification

| # | Do | Expect |
|---|---|---|
| MV1 | In the demo, `#/misc`, press "Dialog — alert with an accessible name" and hover the title-bar close button | the tooltip reads "Keep the record". In a Chromium accessibility-tree snapshot the button is `button "Keep the record"` |
| MV2 | From the console run `Body.getInstance().setStrings({ dialogClose: 'Stäng' })`, then press "Dialog — confirm/cancel" | the close button's tooltip reads "Stäng"; the snapshot lists `button "Stäng"` |
| MV3 | NVDA or VoiceOver: `Tab` to the close button in MV2 | "Stäng, button". Screen readers, Firefox and WebKit are manual; the planner ran none |

---

## Verification

Where the cases go: S and B in the new `tests/core/BuiltInStrings.test.ts`; D in `tests/overlay/Dialog.aria.test.ts`, in the existing `describe('Dialog — title-bar close button')` ([:214](../packages/lib/tests/overlay/Dialog.aria.test.ts#L214)), whose `afterEach` gains the table reset.

Setup for `BuiltInStrings.test.ts`: `installTestDOM(CONFIG)` with the `CONFIG` of `ResizeDrag.test.ts` for the B cases; import `Body` from `~/core/Body` and the three functions from `~/core/BuiltInStrings`; `afterEach(() => { setAppBuiltInStrings({}); DOM.reset(); })`. Dispose every dialog a D case constructs.

Commands, from the repo root:

1. `npm run typecheck`
2. `npm -w packages/lib run typecheck:test`
3. `cd packages/lib && npx vitest run tests/core/BuiltInStrings.test.ts` and the files of step 1.
4. `npm test` — the whole suite.
5. `npm run lint`
6. `npm run docs:api`, then `npm run docs:llms:check`
7. MV1 and MV2 in Chromium on the demo (`npx vite --port 8091 --strictPort` from `packages/lib`); MV3, or a note that it was not run.

Grep checks:

- `grep -rn "CLOSE_BUTTON_LABEL" packages/lib` — no match.
- `grep -rn "getBuiltInString(" packages/lib/src/typescript/lib` — matches in `core/BuiltInStrings.ts` and one in `overlay/Dialog.ts`.
- `grep -rn "new DialogTitleBar(" packages/lib/src packages/lib/tests` — three matches, each with four arguments.

---

## Documentation Impact

No component class is added, so `llms.txt` needs no entry. `BuiltInStrings` is exported from `core/index.ts`.

- **[`docs/components/Dialog.md`](../packages/lib/docs/components/Dialog.md)**
  - `## DialogConfig` table ([:105](../packages/lib/docs/components/Dialog.md#L105)): add a row `closeButtonLabel` | `"Close"`, or the application's `strings.dialogClose` | "Accessible name and tooltip of the title-bar close button, for this dialog."
  - `### Screen readers`, the **Close button** paragraph ([:252](../packages/lib/docs/components/Dialog.md#L252)): replace it. The button is named "Close" and shows the name as a tooltip. `closeButtonLabel` renames it for one dialog and works with `Dialog.show(config)`. `Body.init({ strings: { dialogClose: … } })` renames it for every dialog, including the ones `Dialog.confirm`, `info`, `success`, `warning` and `error` build. Include the precedence table of `### A dialog resolves the name once, when it is constructed`. Keep the sentence about `getTitleBar().getCloseButton()?.setText(…)` for a constructed dialog.
  - The sentence that follows ([:256](../packages/lib/docs/components/Dialog.md#L256)): `role`, `ariaLabel` and `closeButtonLabel` are read once, when the dialog is constructed.
- **[`docs/components/Body.md`](../packages/lib/docs/components/Body.md)**: a new `## Built-in strings` section after `## Resize mode` ([:82](../packages/lib/docs/components/Body.md#L82)): what the option is for; the example `await Body.init({ layoutManager: Fit(), strings: { dialogClose: 'Stäng' } });`; that it reaches dialogs the application never constructs; that `setStrings` replaces the earlier overrides and takes effect for the next dialog constructed; that the table holds one entry today and the library's other strings are still English. Add a matching bullet to `## Notes`.
- **[`docs/concepts/accessibility.md`](../packages/lib/docs/concepts/accessibility.md)**, `### Naming an icon-only button` ([:335](../packages/lib/docs/concepts/accessibility.md#L335)): after the table of where each button is reached, one paragraph. A dialog's close button can also be named without reaching it: `closeButtonLabel` in the config for one dialog, `strings.dialogClose` on `Body` for all of them. The window buttons are not in the table yet.
- **[`docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md)**
  - `## Added` → `### Core`: **`Body.init({ strings })`, `Body.setStrings`, `Body.getStrings` and the `BuiltInStrings` type** — an application-wide table of the library's built-in strings, holding the dialog close button's name.
  - `## Added` → `### Overlay`: **`DialogConfig.closeButtonLabel`.**

---

## Potential Challenges

- **Module-level state leaks between test cases.** `_appStrings` outlives `DOM.reset()`. Every file that sets a string resets it in `afterEach`; a case that forgets makes a later "is named Close" case fail.
- **`Dialog` must not call `Body.getInstance()`.** It would construct the page singleton from inside a dialog. `Dialog` imports `getBuiltInString` from `core/BuiltInStrings.ts`.
- **`docs:api` must finish with zero warnings.** The three functions are not exported from an entry point: describe them in prose in the JSDoc of `BodyOptions.strings` and `DialogConfig.closeButtonLabel`, and `{@link}` only `Body.setStrings`.
- **A required constructor parameter.** `npm run typecheck:test` fails until all three `DialogTitleBar` calls have the fourth argument, which is why step 5 is one step.
- **Merging.** `feature/spatial-navigation-redesign` does not touch `Dialog.ts`, `Body.ts` or `core/index.ts`. It and `window-focus-on-show` both append to `changelog/next.md` and edit `accessibility.md`: keep every block.

---

## Critical Files

- [`overlay/Dialog.ts`](../packages/lib/src/typescript/lib/overlay/Dialog.ts) — `DialogConfig` (:118), `ariaLabel` (:171), `CLOSE_BUTTON_LABEL` (:193), `DialogTitleBar` (:288, constructor :300, the button :321, `getCloseButton` :351), the `Dialog` constructor's title-bar line (:786), `show` (:1736), `confirm` (:1760), `alert` (:1786).
- [`core/Body.ts`](../packages/lib/src/typescript/lib/core/Body.ts#L21) — `BodyOptions` (:21), `resizeMode` (:45), `applyOptions` (:165), `setResizeMode` (:256), `getResizeMode` (:268): the precedent to copy.
- [`core/ResizeDrag.ts`](../packages/lib/src/typescript/lib/core/ResizeDrag.ts#L108) — `_appResizeMode`, `getAppResizeMode`, `setAppResizeMode` (:108–126): the shape of the new module's state.
- [`core/index.ts`](../packages/lib/src/typescript/lib/core/index.ts#L29) — the `ResizeMode` type export and its comment (:29–34).
- [`component/button/Button.ts`](../packages/lib/src/typescript/lib/component/button/Button.ts#L1521) — `_reflectAccessibleName`: how a hidden `text` becomes `aria-label` and a tooltip.
- [`overlay/windowControls.ts`](../packages/lib/src/typescript/lib/overlay/windowControls.ts#L51) — `WINDOW_CONTROL_LABEL` and the factories with a required title.
- [`tests/core/ResizeDrag.test.ts`](../packages/lib/tests/core/ResizeDrag.test.ts#L455) — case B1 and the `afterEach` reset (:103): the test recipe.
- [`tests/overlay/Dialog.aria.test.ts`](../packages/lib/tests/overlay/Dialog.aria.test.ts#L214) — the close-button cases.
- [`plans/implemented/dialog-aria-semantics.md`](implemented/dialog-aria-semantics.md) — "Left as they are", first item, which this plan takes on, and its note on strings.

---

## Non-Goals

- **Localising the library.** See the addendum for what that needs.[^scope]
- **Moving any other string into the table.** Not the window controls' names (`WINDOW_CONTROL_LABEL`), not the toast's "Dismiss notification", not the table header's "Column options". Each is reachable through its owner today, and each move is a small change of its own once the table's shape is accepted.
- **The shortcut buttons' texts.** "Ok", "Cancel" and "Confirm" come from the exported `DialogButtons` object, whose literal texts are part of its type. An application in another language builds its prompts with `Dialog.show` and its own `buttons`.[^shortcuts]
- **A config parameter on the five shortcuts.**[^shortcuts]
- **Renaming a button on a dialog that is already open when `setStrings` is called.** A dialog is short-lived; the next one gets the new name.
- **A change event or a re-render when the table changes.**
- **A `closeButtonLabel` option on `Window`, `TabWindow`, `Drawer` or `Popover`.** Their buttons are reachable through getters, and a `Drawer` and a `Popover` have no close button of the library's.
- **SQLAdmin changes.** None are needed; the application is English and sets no name on a dialog's close button.

---

## Addendum: The library's built-in strings

Searched the library source at `59a5c2e27` for string literals passed to `getAria().setLabel`, to a `Button`'s `text`, to `Tooltip.attach`, to `setText` / `setPlaceholder`, and for `text:` / `label:` / `title:` fields of menu and button configs. Counts are from those greps and are approximate.

| Kind | Examples | Where | About |
|---|---|---|---|
| Accessible names set with `getAria().setLabel` | "Dismiss notification", "Notification history", "Main menu", "More", "Loading", "Video player", "Seek", "Volume", `"Filter " + column` | `overlay/Notification.ts:233`, `overlay/NotificationHistoryButton.ts:126`, `component/menubar/MenuBar.ts:103`, `component/menubar/ToolBar.ts:427`, `component/display/ProgressSpinner.ts:147`, `component/display/VideoPlayer.ts:207`, `component/table/cell/Filter.ts:321` | 10 |
| Names of icon-only buttons (`text` with `showText: false`) | "Close"; "Minimize", "Maximize", "Restore", "Window menu"; "Column options"; "Find the next match" | `overlay/Dialog.ts:193`, `overlay/windowControls.ts:51`, `component/table/Header.ts:39`, `component/editor/CodeEditorSearchPanel.ts:182` | 13 |
| Tooltips | "Add row", "Remove selected row", "Sync pending changes" | `component/table/TablePanel.ts:71`, `component/table/TreeTablePanel.ts:77` | 8 |
| Visible button and menu texts | "Ok", "Cancel", "Confirm"; "Cut", "Copy", "Paste"; "Show/hide columns"; "Always on top"; "Lock gutter"; the two Markdown editors' toolbars and menus | `overlay/Dialog.ts:677`, `component/shared/buildClipboardMenuItems.ts:36`, `component/table/Table.ts:1875`, `overlay/AbstractWindow.ts:2084`, `layout/Split.ts:1786`, `component/editor/MarkdownEditor.ts`, `component/editor/MarkdownDocumentPanel.ts` | 100 |
| Other visible text | filter operators ("Contains", "At least"), `Page ${page} of ${totalPages}`, "On this page", "no file selected", toast detail titles | `component/table/ColumnFilter.ts:81`, `component/display/PaginationBar.ts:179`, `component/display/MarkdownMinimap.ts:53`, `component/input/FileField.ts:20`, `overlay/Notification.ts:70` | 20 |

The library has no localisation mechanism. A search for `i18n`, `locale`, `localis`, `localiz` and `translat` finds only CSS `translate`, sort collation and `Intl` date formatting.

What a full localisation would need, beyond this plan:

| Need | Why this plan does not cover it |
|---|---|
| A key for each of the roughly 150 strings, and each component reading through the table | about 25 files; each component decides when it reads (construction, render, each menu build) |
| Strings with parameters, and plural forms | `Page ${page} of ${totalPages}` and `"Filter " + column` are built by concatenation; a table of plain strings cannot hold them |
| `DialogButtons` | an exported `as const` object: its `text` values are literal types, so making them follow the table changes a public type |
| Components already on screen | a change of language must reach rendered components, which needs a subscription like the theme's, or a rule that the table is set before anything is built |
| Dates and numbers | `data/temporalText.ts` and the calendar dropdown format through `Intl` with the browser's locale, not an application setting |
| Right-to-left text | every layout manager places children left to right |
| Shipped translations, and a check that a translation is complete | `Partial<BuiltInStrings>` accepts any subset by design |

The one-entry table is the first row's mechanism with one key. Nothing in the other rows is decided by it.

---

## Notes

[^scope]: Three scopes were weighed.
    **A config field only.** Five lines, and squarely the project's rule that a component is configured at construction. It cannot reach `Dialog.confirm` and the four severity shortcuts, which take no config, and the request names them. It is also the wrong tool for the reason an application renames this button at all, which is language: the same string would be passed at every `Dialog.show` call. Repeating it for the window buttons, the toast's dismiss button and the rest would add one option per string to every component, which is the dead end.
    **A field plus an application-wide table with one entry — chosen.** The table reaches dialogs the application never constructs, with one call. It follows a precedent the library already has for that problem, `Body`'s `resizeMode`. The field stays useful under any later localisation, as the override for one dialog.
    **Full localisation.** About 150 strings in 25 files, parameterised strings, a public type change and a re-render story; see the addendum. It is a plan of its own, and nothing has asked for it.
    The risk in the chosen scope is that an API for all built-in strings is shaped by one string. It is kept small on purpose: plain strings, set once, read at construction. The addendum lists what it does not decide.

[^names]: `strings` says what the table holds and reads naturally in `Body.init({ strings: { … } })`; `text` and `labels` are both words that already mean something on a component (`Button`'s `text`, a `Label`). `BuiltInStrings` separates these from an application's own strings. `dialogClose` is component first, role second, so later keys group by component (`windowClose`, `windowMinimize`). `closeButtonLabel` follows `ariaLabel` and the existing constant `CLOSE_BUTTON_LABEL`; it is "label" because it is both the accessible name and the tooltip.

[^field]: `ariaLabel` set the pattern: a field on `DialogConfig`, read once in the constructor, no setter and no backing field, with `getAria()` as the way to change it afterwards. Here the way to change it afterwards is `getTitleBar().getCloseButton()?.setText(…)`, which `dialog-aria-semantics` added. A setter on `Dialog` would duplicate that route.

[^body-option]: The documentation of `resizeMode` gives the reason in the same words this plan needs: it reaches "the splits and float windows a `Dock` builds, which an app cannot reach to configure one by one". A dialog built by `Dialog.show` or a shortcut is the same case. The value is held in the module that uses it, not on the `Body` instance, for the reason `Body.setResizeMode`'s own remark gives: reading it through the singleton would construct the page bootstrap from inside the reader.
    Two other homes were considered. A static method on `Dialog` (`Dialog.setCloseButtonLabel`) would serve this one string and give the next string, on another class, a second mechanism. A standalone exported function would be a new kind of public entry point; `Body` is where an application already sets what holds for the whole page.

[^replace]: A setter that replaces is what every other setter in the library does, and it gives a way back to the defaults: `setStrings({})`. A merging setter would need a second method to remove an override. An application that sets its strings in two places spreads them into one object first. `getStrings()` returns the resolved table, not the overrides, on the rule in `ARCHITECTURE.md` that a getter folds the default.

[^shortcuts]: The shortcuts are English as a whole: beside the close button's name they show "Ok", "Cancel" or "Confirm". A third parameter carrying a close-button name would localise one of the two or three strings on the dialog and leave the others, and the application would still pass it at every call. With the table, the close button of a shortcut follows the application's language at no cost to the call. The visible button texts are the natural next entries of the table, and they are left out here because `DialogButtons` is an exported constant whose text literals are part of its public type: moving them is a change to that export, with its own decision to make.
    `ariaLabel` is no precedent for a shortcut-level override: it is a field of `DialogConfig`, so it reaches `Dialog.show(config)` and a constructed dialog, and not the five positional shortcuts.

[^title-bar]: `DialogTitleBar` is exported from `overlay/index.ts`, but its class comment says it has no public constructor and is reached through `Dialog.getTitleBar()`. The library constructs it in one place and the tests in two. A parameter with a default would let the title bar fall back to the table by itself and put the resolution in two places. `dialog-aria-semantics` made the same choice for `createWindowControlButton(glyph, title)`: a required name makes an unnamed control a compile error.

---

## Implementation Notes

One slip against the plan, caught by review and fixed: step 3 asks for a
sentence about `strings` in `Body.init`'s JSDoc, and the first pass left it out.
It was added afterwards. The plan's line numbers were located by symbol on the
current chain tip, and the sign-offs were taken as recommended. Review also
added case D9 (a shortcut dialog takes the application-wide name).

Not run (the orchestrator forbade a browser and dev server on this run):

- MV1: the "Dialog — alert with an accessible name" demo tooltip and the
  accessibility-tree name `Keep the record`.
- MV2: `Body.getInstance().setStrings({ dialogClose: 'Stäng' })` from the console
  and the tooltip of "Dialog — confirm/cancel".
- MV3: NVDA or VoiceOver announcement of the close button.

The red step was not run as a separate pass. For the cases that import
`core/BuiltInStrings` (S, B, and D5-D7) it could only have failed at import. D2
and D3 did not need that module and could have been run red first; they were not.
The full suite
(570 files), typecheck, typecheck:test, lint, docs:api and docs:llms:check pass.
