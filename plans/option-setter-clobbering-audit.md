# Option-Setter Clobbering Audit — Implementation Plan

## Overview

[`plans/implemented/background-token-cleanup.md`](plans/implemented/background-token-cleanup.md) fixed one bug shape at fourteen sites: a component constructor calls `super(options, subclassDefaults)`, which correctly applies a caller-supplied option — then the constructor (or a method it calls) makes an imperative `this.setX(...)` call with a hardcoded literal for that same, documented `ComponentOptions` field, silently overwriting whatever the caller passed. That plan scoped itself to `backgroundColor` / `foregroundColor` / `backgroundImage` and named the rest of the field space — border, padding, insets, cursor, overflow, opacity, size constraints, transform, transition — as a deliberate follow-up. This plan is that follow-up.

Sweeping `packages/lib/src/typescript/lib` for the same shape across every other `ComponentOptions` field finds **thirteen confirmed sites across nine fields** (`border`, `borderRadius`, `shadow`, `cursor`, `outline`, `overflow`, `preferredSize`, `minSize`, `maxSize`) in thirteen components: [`DiagramNode.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts), [`DiagramGroupNode.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramGroupNode.ts), [`StatusBar.ts`](packages/lib/src/typescript/lib/component/container/StatusBar.ts), [`Popover.ts`](packages/lib/src/typescript/lib/overlay/Popover.ts), [`TabButton.ts`](packages/lib/src/typescript/lib/component/button/TabButton.ts), [`MenuBar.ts`](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts), [`Tree.ts`](packages/lib/src/typescript/lib/component/tree/Tree.ts), [`TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts), [`Checkbox.ts`](packages/lib/src/typescript/lib/component/input/Checkbox.ts), [`RadioButton.ts`](packages/lib/src/typescript/lib/component/input/RadioButton.ts), [`Toggle.ts`](packages/lib/src/typescript/lib/component/input/Toggle.ts), [`Slider.ts`](packages/lib/src/typescript/lib/component/input/Slider.ts), and [`AbstractChart.ts`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts). The fix is the same one background-token-cleanup used: move the hardcoded literal into a `_default<Class>Options` bag (creating the bag and a `subclassDefaults` constructor parameter where the class doesn't already have both) and delete the imperative call.

The sweep also confirmed, revised, or ruled out several other candidates read in full during this audit — see `## Architecture Decisions` for the verification trail and `## Non-Goals` for what stays out of scope and why. Every component keeps its current default *look*; the only change is that a caller who supplies one of these options now gets it instead of having it silently discarded.

---

## Architecture Decisions

### The fix mechanism, re-verified against current code

`Component`'s constructor doc comment ([`Component.ts:507-522`](packages/lib/src/typescript/lib/core/Component.ts#L507-L522)) still states the contract background-token-cleanup relied on: `_defaultOptions` is a pure fallback consulted by getters and `applyStyle` when the caller omitted a field, never dispatched into `_options`. The constructor (line [524](packages/lib/src/typescript/lib/core/Component.ts#L524)) resolves it via `resolveClassDefaults(this.constructor, subclassDefaults)` at line [553](packages/lib/src/typescript/lib/core/Component.ts#L553), which [`ComponentDefaults.ts:78`](packages/lib/src/typescript/lib/core/ComponentDefaults.ts#L78) implements: subclass defaults are frozen and cached per concrete class, and a class's own `_default<Name>Options` wins over an ancestor's because it is spread last (`{ ...ancestorDefaults, ...(subclassDefaults ?? {}) }` at each layer). `applyOptions` (line [593](packages/lib/src/typescript/lib/core/Component.ts#L593)) dispatches each present field to its setter; `applyChromeOptions` (line [679](packages/lib/src/typescript/lib/core/Component.ts#L679)) is the one exception, always folding `options.X ?? this._defaultOptions.X` and dispatching the result for `border` / `borderRadius` / `shadow` / `backgroundImage` — a *default-dispatch* fold, versus every other fixable field's *getter-read* fold. This still matches the precedent's own description; no line-number drift changed the mechanism.

### Not every `ComponentOptions` field has a working fold — this bounds the sweep

Reading every relevant getter in `Component.ts` field by field found two groups:

| Folds `_defaultOptions` (fixable with this plan's pattern) | Does not fold anywhere (not fixable this way) |
|---|---|
| `insets`, `padding`, `backgroundColor`, `foregroundColor`, `border`/`borderRadius`/`shadow`/`backgroundImage` (chrome group), `outline`, `cursor`, `zIndex`, `preferredSize`/`minSize`/`maxSize`, `overflow`, `pointerEvents`, `writingMode` | `background` (shorthand), `colorScheme`, `transform`, `transformOrigin`, `transition`, `willChange`, `opacity`, `touchAction` |

The right column's getters (e.g. `getTransition()` at [`Component.ts:4173`](packages/lib/src/typescript/lib/core/Component.ts#L4173), `getOpacity()` at [`:4370`](packages/lib/src/typescript/lib/core/Component.ts#L4370)) return a private cached field set only by their own setter — never `_defaultOptions`. Seeding `_defaultOptions.transition` for a class would be dead data: nothing reads it, so the "fix" would silently fail to apply the default and *still* fail to preserve a caller override, the opposite of the fix's purpose. This is why `opacity` and `transition` (both named in the follow-up scope) turned up **zero fixable sites**: every constructor-time hardcode found on a right-column field belongs to an internal helper component with no caller-facing options bag at all (`DragGhost`, `ScrollArrowButton`, `AutoRepeat`-driven children), except one — see `## Non-Goals`.

### The "options-aware fold" variant, not a new pattern

Background-token-cleanup's own `## Implementation Notes` records that `TabButton`'s shipped fix needed more than "delete the call": `Button.applyChromeOptions` also unconditionally repaints `backgroundColor` from a private constant unless the caller's *raw* `options` had one, bypassing `_defaultOptions` — so `applyTabStyling` had to become `applyTabStyling(options?: TabButtonOptions)` and fold `options?.backgroundColor ?? this._defaultOptions.backgroundColor` explicitly. Two sites in this sweep need that same variant, for the same reason (a derived-from-internal-state value computed by a private helper, not a static literal): [`TabButton.ts`](packages/lib/src/typescript/lib/component/button/TabButton.ts)'s `border`/`borderRadius`/`shadow` (below) and [`TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts)'s `border`. Both are the *same* established fold technique, applied at the point that recomputes the value instead of at a getter — not a new fix shape.

### `TabButton.applyTabStyling()` still clobbers border/borderRadius/shadow — confirmed, in scope

Background-token-cleanup's `## Architecture Decisions` flagged this and deliberately left it out: `applyTabStyling()` unconditionally calls `this.setBorder({...four sides...})`, `this.clearBorderRadius()`, and `this.clearShadow()` after `applyOptions(options)` already ran. Re-read in full at [`TabButton.ts:150-172`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L150) — it still holds, unchanged in shape (only the `backgroundColor` line has since grown an options-aware fold, per the note above). `Button.applyChromeOptions` has **no** bypass for `border`/`borderRadius`/`shadow` (only for `backgroundColor` — verified by reading [`Button.ts:663`](packages/lib/src/typescript/lib/component/button/Button.ts#L663) onward), so `border` fixes with a plain bag entry. `borderRadius`/`shadow` need an explicit `undefined` key in `_defaultTabButtonOptions` (not simply omitted) to suppress `Button`'s own non-empty class defaults for those two fields[^undefined-key-suppression].

### Sites read in full and confirmed *not* bugs

Per the precedent's own rigor requirement, every candidate below was read start-to-end before being ruled out:

- **[`AutoCompleteField.ts`](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts)** and **[`ProgressBar.ts`](packages/lib/src/typescript/lib/component/display/ProgressBar.ts)** — both call `super()` with no options, hardcode chrome early, then call `this.applyOptions(options)` at the constructor's tail. Same shape as `WindowHeader.ts`, already verified in the precedent: the late call dispatches the caller's value last, so it wins. No change.
- **[`SplitGutter.ts`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts)**'s `setOpaque(true)`-driven border** — only runs when the constructor sees `options?.opaque` truthy. This is a documented behavioural mode switch (opaque strip vs. divider), the same carve-out class as `Button`'s `flat` option — not an accidental default.
- **[`Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts)**, **`Footer.ts`**'s `FooterRow`, **`Header.ts`** (table), **`Cell.ts`**, **[`FieldDecorator.ts`](packages/lib/src/typescript/lib/validation/FieldDecorator.ts)**, **`MarkdownEditor.ts`**'s `WysiwygSurface`, and the `SelectableListRow` inner class in **`AbstractSelectableList.ts`** — none of these constructors accept a `ComponentOptions`-shaped bag at all (positional-only, or `super({ tag: ... })` with no forwarded options). Same "no options bag to clobber" classification the precedent already applied to `Dialog`/`Menu`. No change.
- **[`DragGhost.ts`](packages/lib/src/typescript/lib/overlay/DragGhost.ts)** and other drag/overlay helpers (`DragFeedback`, `DropZoneOverlay`, `ReorderIndicator`, `Tooltip`, `Notification`) — same "no options bag" reasoning; their `zIndex`/`opacity`/`pointerEvents` literals have nothing to clobber.

### Two real hits deferred, not fixed here — different fix shape, not this plan's pattern

- **`updateHeight()` / `updateSize()` family** — [`TextField.ts:64-73`](packages/lib/src/typescript/lib/component/input/TextField.ts#L64-L73), and the identical method copy-pasted into `PasswordField.ts`, `UsernameField.ts`, `ComboBox.ts`, `NumberSpinner.ts`, and `AbstractPickerField.ts` — all unconditionally call `setPreferredSize`/`setMinSize`/`setMaxSize` with a hardcoded width, clobbering a caller's own size. This is a real instance of the bug, but the fix can't be "seed a static default and delete the call": `updateHeight()` legitimately re-runs on every theme change (font-size shifts need a new pixel height), so the literal can't be pre-baked into `_defaultOptions` — the method itself needs to preserve whatever width/min/max is *already resolved* (default or caller override) and only overwrite the height component, the same technique `TextField.setBorder`'s own override already uses correctly a few lines below (`const pref = this.getPreferredSize(); if (pref) { this.setPreferredSize({ width: pref.width, height: h }); }`, [`TextField.ts:97-102`](packages/lib/src/typescript/lib/component/input/TextField.ts#L97-L102)). That's six files needing the same non-trivial, options-preserving rewrite — sized like its own plan, not a bag substitution. Left for a follow-up.
- **`Slider.ts`'s `preferredSize`/`maxSize`** — hardcoded at construction ([`Slider.ts:101-102`](packages/lib/src/typescript/lib/component/input/Slider.ts#L101-L102)) and again by the private `applyOrientation()` ([`:710-722`](packages/lib/src/typescript/lib/component/input/Slider.ts#L710-L722)), which also fires from the public runtime `setOrientation()`. Fixing the construction-time clobber without breaking `setOrientation()`'s legitimate runtime resize needs `applyOrientation` split into an options-aware construction path and an unconditional runtime path — more than this plan's bag-substitution pattern. `Slider`'s `outline`/`cursor` (static, unconditional, no orientation dependency) are fixed here; `preferredSize`/`maxSize` are not.
- **`ToolBar.ts`'s orientation-driven `border`** ([`ToolBar.ts:246-248`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L246-L248)) — the border write lives inside the *public* `setOrientation()`, called identically from `applyOptions`'s forced re-dispatch and from any runtime consumer. An options-aware fold here needs splitting that method into a construction-time and a runtime path, a `ToolBar`-specific refactor beyond this plan's pattern. Deferred.
- **`Scrollbar.ts`'s `setTouchAction("none")`** in `init()` ([`Scrollbar.ts:515`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L515)) — `touchAction` is a right-column (non-folding) field, so it can't take this plan's bag fix; a local "only set if unset" guard would work but is a different fix shape for a single low-value field (a caller overriding a scrollbar's touch handling is an unlikely case). Deferred alongside the no-fold-field finding above rather than inventing a one-off guard.

### One plan, not a split

Thirteen confirmed sites across nine fields in thirteen components is the same order of magnitude as background-token-cleanup's fourteen sites across three fields — that plan's own precedent for what fits in one plan. Every confirmed site here uses one of the same two established techniques (plain bag substitution, or the options-aware fold TabButton's Implementation Notes already established) — none needs a new mechanism, so splitting by field or subsystem would not reduce risk, only add coordination overhead. The three larger, differently-shaped bugs found during the sweep (`updateHeight` family, `Slider` sizing, `ToolBar` orientation-border) are excluded for exactly that reason — see `## Non-Goals` — keeping this plan to the one established pattern throughout.

---

## Public API

`Checkbox`, `RadioButton`, `Toggle`, `Slider` are generic (`class X<TOptions extends XOptions = XOptions>`) with no `subclassDefaults` parameter today; each gains a **new, optional, trailing** one — no existing call site's signature changes in an incompatible way. Mirror the existing generic pattern at [`ToolBar.ts:127,156-160`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L156-L160) exactly — a two-signature overload (a public-facing one pinned to the base `XOptions`, plus the generic implementation signature) so a call site passing an object literal doesn't narrow `TOptions` to that literal type. `AbstractChart` is also generic but is `abstract` — never constructed directly with an object literal — and already has a `subclassDefaults` parameter; it needs no overload, only a bag to pass through the parameter it already has:

```typescript
// Public overload — same as every other call site sees today.
constructor(options?: CheckboxOptions, subclassDefaults?: Partial<CheckboxOptions>);
// Implementation signature — generic, forwards subclassDefaults through TOptions.
// The `{ ...(options ?? {}) }` wrapper is Checkbox's existing call shape — only
// the second argument is new.
constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
    super(
        { ...(options ?? {}) } as TOptions,
        { ..._defaultCheckboxOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
    );
    ...
}
```

`RadioButton` keeps its leading positional `text?: string` parameter ahead of `options`/`subclassDefaults` — unlike `TabButton`, it does not forward `text` into its `super(...)` call at all (that call only ever carried `options`); `text` is applied separately later in the constructor body, untouched by this plan.

```typescript
// New subclassDefaults parameter (mirrors ToolBar.ts's generic pattern):
Checkbox(options?: CheckboxOptions, subclassDefaults?: Partial<CheckboxOptions>)
RadioButton(text?: string, options?: RadioButtonOptions, subclassDefaults?: Partial<RadioButtonOptions>)
Toggle(options?: ToggleOptions, subclassDefaults?: Partial<ToggleOptions>)
Slider(options?: SliderOptions, subclassDefaults?: Partial<SliderOptions>)
AbstractChart(options?: O, subclassDefaults?: Partial<O>)   // parameter already existed; gains its own module-level bag
```

No other component's constructor signature changes — `DiagramNode`, `DiagramGroupNode`, `StatusBar`, `Popover`, `MenuBar`, `Tree`, `TabBar`, `TabButton` already accept and forward `subclassDefaults`; only their `_default<Class>Options` bag content changes.

---

## Clobbering-Bug Fix Sites

| File | Site | Field(s) clobbered | Existing bag? | Fix |
|---|---|---|---|---|
| `component/diagram/DiagramNode.ts` | Lines 94-96, constructor | `border`, `borderRadius`, `cursor` | Yes (`_defaultDiagramNodeOptions`) | Add fields to existing bag |
| `component/diagram/DiagramGroupNode.ts` | Lines 66-69, constructor | `cursor`, `border`, `borderRadius` | Yes (`_defaultDiagramGroupNodeOptions`) | Add fields to existing bag |
| `component/container/StatusBar.ts` | Lines 125-127, constructor | `border`, `minSize`, `maxSize` | Yes (`_defaultStatusBarOptions`) | Add fields to existing bag |
| `overlay/Popover.ts` | Lines 192-194, constructor | `border`, `borderRadius`, `shadow` | Yes (`_defaultPopoverOptions`) | Add fields to existing bag |
| `component/button/TabButton.ts` | `applyTabStyling()`, lines 152-157 (`border`), 158 (`borderRadius`), 159 (`shadow`) | `border`, `borderRadius`, `shadow` | Yes (`_defaultTabButtonOptions`) | Add fields (border literal; borderRadius/shadow as explicit `undefined`) to existing bag; keep `applyTabStyling` options-aware for `backgroundColor` only |
| `component/menubar/MenuBar.ts` | Line 86, constructor | `minSize` | Yes (`_defaultMenuBarOptions`) | Add field to existing bag |
| `component/tree/Tree.ts` | Lines 119-121, constructor | `overflow`, `preferredSize`, `maxSize` | Yes (`_defaultTreeOptions`) | Add fields to existing bag |
| `component/container/TabBar.ts` | Line 596, constructor (`preferredSize`); `applyUnderBorder()` line 817 (`border`) | `preferredSize`, `border` | Yes (`_defaultTabBarOptions`) | Add `preferredSize` to bag; make `applyUnderBorder` take optional `options` and fold `border` only at the construction call site |
| `component/input/Checkbox.ts` | Line 118, constructor | `outline` | No — create | New bag + `subclassDefaults` param (generic-class overload) |
| `component/input/RadioButton.ts` | Line 105, constructor | `outline` | No — create | New bag + `subclassDefaults` param (generic-class overload) |
| `component/input/Toggle.ts` | Line 89, constructor | `outline` | No — create | New bag + `subclassDefaults` param (generic-class overload) |
| `component/input/Slider.ts` | Lines 103-104, constructor | `outline`, `cursor` | No — create | New bag + `subclassDefaults` param (generic-class overload); `preferredSize`/`maxSize` NOT fixed here, see `## Non-Goals` |
| `component/chart/AbstractChart.ts` | Lines 167-168, constructor | `preferredSize`, `minSize` | No — create | New bag, forwarded through the existing `subclassDefaults` parameter (generic-class overload, mirrors `ToolBar`) |

**Verified not bugs (late `applyOptions` rescue, same shape as the precedent's `WindowHeader.ts` finding):** `component/input/AutoCompleteField.ts`, `component/display/ProgressBar.ts`.

**Verified not bugs (behavioural mode gated on an explicit option, like `Button`'s `flat`):** `component/container/SplitGutter.ts`'s `setOpaque(true)` border.

**Verified not bugs (no options bag to clobber, same classification as the precedent's `Dialog`/`Menu` finding):** `component/table/Table.ts`, `component/table/Footer.ts`, `component/table/Header.ts`, `component/table/cell/Cell.ts`, `validation/FieldDecorator.ts`, `component/editor/MarkdownEditor.ts` (`WysiwygSurface`), `component/list/AbstractSelectableList.ts` (`SelectableListRow`), `overlay/DragGhost.ts` and sibling drag/overlay helpers.

**Confirmed real, deferred to separate follow-up plans (different fix shape — see `## Architecture Decisions` and `## Non-Goals`):** the `updateHeight()`/`updateSize()` family (`TextField.ts`, `PasswordField.ts`, `UsernameField.ts`, `ComboBox.ts`, `NumberSpinner.ts`, `AbstractPickerField.ts`), `Slider.ts`'s orientation-conditional `preferredSize`/`maxSize`, `ToolBar.ts`'s orientation-driven `border`, `Scrollbar.ts`'s `setTouchAction("none")`.

---

## Ordered Implementation Steps

Each step edits one file. Run `npm test` (in `packages/lib`) after every 3-4 steps to localize any regression.

### Step 1 — `DiagramNode.ts`

[`DiagramNode.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts):

1. In `_defaultDiagramNodeOptions` (line 39), add:
   ```typescript
   border:       "1px solid var(--ts-ui-border-color, rgb(180, 180, 180))",
   borderRadius: "4px",
   cursor:       "pointer",
   ```
2. Delete lines 94-96 (`this.setBorder(...)`, `this.setBorderRadius(NODE_BORDER_RADIUS)`, `this.setCursor("pointer")`).
3. Delete the now-unused `const NODE_BORDER_RADIUS = "4px";` declaration (line 47) — it was referenced only at the deleted call site.

**Verification checkpoint:** `grep -n "setBorder\|setBorderRadius\|setCursor\|NODE_BORDER_RADIUS" packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts` — zero matches (the `.selected` state rule uses `selectedStyleRule.set(...)`, untouched).

### Step 2 — `DiagramGroupNode.ts`

[`DiagramGroupNode.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramGroupNode.ts):

1. In `_defaultDiagramGroupNodeOptions` (line 37), add:
   ```typescript
   cursor:       "pointer",
   border:       "1px solid var(--ts-ui-diagram-group-border, var(--ts-ui-border-color, rgb(180, 180, 180)))",
   borderRadius: "4px",
   ```
2. Delete lines 66, 68-69 (`this.setCursor("pointer")`, `this.setBorder(...)`, `this.setBorderRadius(GROUP_BORDER_RADIUS)`). Leave the comment at lines 63-65 explaining *why* the node needs a pointer cursor — move it to sit above the bag's `cursor` entry instead of deleting it.
3. Delete the now-unused `const GROUP_BORDER_RADIUS = "4px";` declaration (line 28).

**Verification checkpoint:** `grep -n "setCursor\|setBorder\|GROUP_BORDER_RADIUS" packages/lib/src/typescript/lib/component/diagram/DiagramGroupNode.ts` — zero matches.

### Step 3 — `StatusBar.ts`

[`StatusBar.ts`](packages/lib/src/typescript/lib/component/container/StatusBar.ts):

1. In `_defaultStatusBarOptions` (line 59), add:
   ```typescript
   border:  { borderTop: `${STATUS_BAR_BORDER_TOP_WIDTH}px solid var(--ts-ui-statusbar-border, rgb(220, 220, 220))` },
   minSize: { width: 0, height: STATUS_BAR_HEIGHT },
   maxSize: { width: Number.MAX_SAFE_INTEGER, height: STATUS_BAR_HEIGHT },
   ```
2. Delete lines 125-127 (`this.setBorder(...)`, `this.setMinSize(...)`, `this.setMaxSize(...)`).

**Verification checkpoint:** `grep -n "this.setBorder\|this.setMinSize\|this.setMaxSize" packages/lib/src/typescript/lib/component/container/StatusBar.ts` — zero matches.

### Step 4 — `Popover.ts`

[`Popover.ts`](packages/lib/src/typescript/lib/overlay/Popover.ts):

1. In `_defaultPopoverOptions` (line 99), add:
   ```typescript
   border:       { border: "1px solid var(--ts-ui-popover-border, rgb(200, 200, 200))" },
   borderRadius: "var(--ts-ui-popover-radius, 6px)",
   shadow:       "var(--ts-ui-popover-shadow, 2px 4px 12px rgba(0, 0, 0, 0.18))",
   ```
2. Delete lines 192-194 (`this.setBorder(...)`, `this.setBorderRadius(...)`, `this.setShadow(...)`). Leave the `// Theme-driven chrome.` comment above them — move it to sit above the bag's three new entries.

**Verification checkpoint:** `grep -n "this.setBorder\|this.setBorderRadius\|this.setShadow" packages/lib/src/typescript/lib/overlay/Popover.ts` — zero matches (the unrelated `this._arrowComponent.setShadow(arrowShadow)` at line 863 is a child component and is untouched).

### Step 5 — `MenuBar.ts`

[`MenuBar.ts`](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts):

1. In `_defaultMenuBarOptions` (line 24), add:
   ```typescript
   minSize: { width: 0, height: MENU_BAR_BUTTON_HEIGHT },
   ```
2. Delete line 86 (`this.setMinSize(...)`).

**Verification checkpoint:** `grep -n "this.setMinSize" packages/lib/src/typescript/lib/component/menubar/MenuBar.ts` — zero matches.

### Step 6 — `Tree.ts`

[`Tree.ts`](packages/lib/src/typescript/lib/component/tree/Tree.ts):

1. In `_defaultTreeOptions` (line 64), add:
   ```typescript
   overflow:      "hidden",
   preferredSize: { width: 200, height: 300 },
   maxSize:       { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER },
   ```
2. Delete lines 119-121 (`this.setOverflow("hidden")`, `this.setPreferredSize(...)`, `this.setMaxSize(...)`).

**Verification checkpoint:** `grep -n "this.setOverflow\|this.setPreferredSize\|this.setMaxSize" packages/lib/src/typescript/lib/component/tree/Tree.ts` — zero matches.

### Step 7 — `TabButton.ts`

[`TabButton.ts`](packages/lib/src/typescript/lib/component/button/TabButton.ts):

1. In `_defaultTabButtonOptions` (line 27), add:
   ```typescript
   border: {
       borderTop:    "var(--ts-ui-tab-button-border-top,    var(--ts-ui-tab-button-border, none))",
       borderRight:  "var(--ts-ui-tab-button-border-right,  var(--ts-ui-tab-button-border, none))",
       borderBottom: "var(--ts-ui-tab-button-border-bottom, var(--ts-ui-tab-button-border, none))",
       borderLeft:   "var(--ts-ui-tab-button-border-left,   var(--ts-ui-tab-button-border, none))",
   },
   // Explicit `undefined` keys — not omitted — so these two win over Button's
   // own non-empty `_defaultButtonOptions.borderRadius`/`.shadow` in the
   // spread merge at ComponentDefaults.ts's resolveClassDefaults. Omitting
   // the keys would let Button's rounded/shadowed look leak through once the
   // unconditional `clearBorderRadius()`/`clearShadow()` calls below are
   // deleted.
   borderRadius: undefined,
   shadow:       undefined,
   ```
2. In `applyTabStyling()` (starting line 150), delete the four-side `this.setBorder({...})` call (lines 152-157) and the `this.clearBorderRadius();` (line 158) / `this.clearShadow();` (line 159) lines. Leave line 151, `this.setBackgroundColor(options?.backgroundColor ?? (this._defaultOptions.backgroundColor as string));`, and every hover/selected line untouched — see `## Architecture Decisions` (border/borderRadius/shadow's *state* overrides on hover/selected stay in scope for a later, separate change if ever wanted; this plan only removes the *resting-state* hardcode).
3. Update the method's JSDoc — it currently says *"Paints the tab's unselected background, border, hover, and selected states..."*; adjust to note the resting border/borderRadius/shadow are now handled by `_defaultTabButtonOptions`, mirroring the existing `backgroundImage` sentence in the same comment block.

**Verification checkpoint:** `grep -n "this.setBorder\|this.clearBorderRadius\|this.clearShadow" packages/lib/src/typescript/lib/component/button/TabButton.ts` — zero matches at the resting-state call site (`setHoverBorder`/`setSelectedBorder`/`setHoverShadow`/`setSelectedShadow` calls are untouched and will still match `setShadow`-adjacent greps by name only, not by these exact patterns).

### Step 8 — `TabBar.ts`

[`TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts):

1. In `_defaultTabBarOptions` (line 447), add:
   ```typescript
   preferredSize: { width: 0, height: STRIP_THICKNESS },
   ```
2. Delete line 596 (`this.setPreferredSize({ width: 0, height: STRIP_THICKNESS });`).
3. Change `private applyUnderBorder(): void {` (line 817) to `private applyUnderBorder(options?: TabBarOptions): void {`.
4. Inside `applyUnderBorder`, change the `this.setBorder({...})` call (lines 830-835) to fold the caller's value first:
   ```typescript
   this.setBorder(options?.border ?? {
       borderTop:    this._side === "south" ? rule : "none",
       borderBottom: this._side === "north" ? rule : "none",
       borderLeft:   this._side === "east"  ? rule : "none",
       borderRight:  this._side === "west"  ? rule : "none",
   });
   ```
5. At the constructor's call site (line 591), change `this.applyUnderBorder();` to `this.applyUnderBorder(options);`. Leave every other call site (`setUnderBorderFullWidth`'s call at line 925, `setSide`'s call at line 961, the theme-change subscription's call at line 643) calling `this.applyUnderBorder()` with **no** argument — these are legitimate runtime recomputes triggered by an explicit state change, the same carve-out class as `TabButton`'s hover/selected border, not construction defaults.

**Verification checkpoint:** `grep -n "applyUnderBorder(" packages/lib/src/typescript/lib/component/container/TabBar.ts` — one call passes `options` (the constructor), the rest pass nothing. `grep -n "this.setPreferredSize" packages/lib/src/typescript/lib/component/container/TabBar.ts` — zero matches in the constructor body (the `hide()`/tool-strip helper methods, if any set preferredSize elsewhere, are unrelated and untouched — none were found in this sweep).

### Step 9 — `Checkbox.ts`

[`Checkbox.ts`](packages/lib/src/typescript/lib/component/input/Checkbox.ts):

1. Above `class Checkbox` (before line 47), add:
   ```typescript
   const _defaultCheckboxOptions: Partial<CheckboxOptions> = {
       outline: "none",
   };
   ```
2. Change the constructor (line 59) to the two-signature overload, mirroring [`ToolBar.ts:156-160`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L156-L160). Keep the existing `{ ...(options ?? {}) } as TOptions` first argument exactly as it is today — only the second argument is new:
   ```typescript
   constructor(options?: CheckboxOptions, subclassDefaults?: Partial<CheckboxOptions>);
   constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
       super(
           { ...(options ?? {}) } as TOptions,
           { ..._defaultCheckboxOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
       );
       ...
   ```
3. Delete line 118 (`this.setOutline("none");`) — the outer-scope call on `this` (the root). Leave every `this._box.set*`/`this._check.set*`/`this._dash.set*` call untouched (children, no options of their own).

**Verification checkpoint:** `grep -n "^        this.setOutline" packages/lib/src/typescript/lib/component/input/Checkbox.ts` — zero matches.

### Step 10 — `RadioButton.ts`

[`RadioButton.ts`](packages/lib/src/typescript/lib/component/input/RadioButton.ts):

1. Above `class RadioButton` (before line 47), add:
   ```typescript
   const _defaultRadioButtonOptions: Partial<RadioButtonOptions> = {
       outline: "none",
   };
   ```
2. Change the constructor (line 61) to the two-signature overload, keeping the leading `text?: string` positional parameter. `RadioButton`'s current `super({ ...(options ?? {}) } as TOptions);` call (line 62) does **not** forward `text` at all — `text` is applied separately, later in the constructor body — so leave that untouched; only add the trailing `subclassDefaults` argument:
   ```typescript
   constructor(text?: string, options?: RadioButtonOptions, subclassDefaults?: Partial<RadioButtonOptions>);
   constructor(text?: string, options?: TOptions, subclassDefaults?: Partial<TOptions>) {
       super(
           { ...(options ?? {}) } as TOptions,
           { ..._defaultRadioButtonOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
       );
       ...
   ```
3. Delete line 105 (`this.setOutline("none");`) on `this` (the root). Leave `this._ring.set*`/`this._dot.set*` calls untouched.

**Verification checkpoint:** `grep -n "^        this.setOutline" packages/lib/src/typescript/lib/component/input/RadioButton.ts` — zero matches.

### Step 11 — `Toggle.ts`

[`Toggle.ts`](packages/lib/src/typescript/lib/component/input/Toggle.ts):

1. Above `class Toggle` (before line 32), add:
   ```typescript
   const _defaultToggleOptions: Partial<ToggleOptions> = {
       outline: "none",
   };
   ```
2. Change the constructor (line 43) to the two-signature overload, mirroring Step 9.
3. Delete line 89 (`this.setOutline("none");`) on `this` (the root). Leave `this._thumb.set*`/`this._track.set*` calls untouched.

**Verification checkpoint:** `grep -n "^        this.setOutline" packages/lib/src/typescript/lib/component/input/Toggle.ts` — zero matches.

### Step 12 — `Slider.ts`

[`Slider.ts`](packages/lib/src/typescript/lib/component/input/Slider.ts):

1. Above `class Slider` (before line 59), add:
   ```typescript
   const _defaultSliderOptions: Partial<SliderOptions> = {
       outline: "none",
       cursor:  "pointer",
   };
   ```
2. Change the constructor (line 72) to the two-signature overload:
   ```typescript
   constructor(options?: SliderOptions, subclassDefaults?: Partial<SliderOptions>);
   constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
       super(
           { ...(options ?? {}) } as TOptions,
           { ..._defaultSliderOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
       );
       ...
   ```
3. Delete lines 103-104 (`this.setOutline("none");`, `this.setCursor("pointer");`). **Do not** touch `this.setPreferredSize(...)` (line 101) or `this.setMaxSize(...)` (line 102) — see `## Non-Goals`; those stay exactly as they are.

**Verification checkpoint:** `grep -n "this.setOutline\|^        this.setCursor" packages/lib/src/typescript/lib/component/input/Slider.ts` — zero matches at the constructor's top-level call site (the runtime `this.setCursor(value ? "pointer" : "default")` at line 730 is an unrelated hover/press state handler, untouched).

### Step 13 — `AbstractChart.ts`

[`AbstractChart.ts`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts):

1. Above `export abstract class AbstractChart` (before line 114), add:
   ```typescript
   const _defaultAbstractChartOptions: Partial<AbstractChartOptions> = {
       preferredSize: { width: 400, height: 300 },
       minSize:       { width: 80, height: 60 },
   };
   ```
2. Change `super(options, subclassDefaults);` (line 163) to:
   ```typescript
   super(options, { ..._defaultAbstractChartOptions, ...(subclassDefaults ?? {}) } as Partial<O>);
   ```
3. Delete lines 167-168 (`this.setPreferredSize(...)`, `this.setMinSize(...)`).

**Verification checkpoint:** `grep -n "this.setPreferredSize\|this.setMinSize" packages/lib/src/typescript/lib/component/chart/AbstractChart.ts` — zero matches. `grep -n "constructor(options" packages/lib/src/typescript/lib/component/chart/LineChart.ts packages/lib/src/typescript/lib/component/chart/BarChart.ts` — confirm both still just call `super(options)` (no `_default*Options` bag of their own to reconcile — the fix lives entirely at the `AbstractChart` layer).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramGroupNode.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/StatusBar.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Popover.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/TabButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/MenuBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Checkbox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/RadioButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Toggle.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Slider.ts` |
| Modify | `packages/lib/src/typescript/lib/component/chart/AbstractChart.ts` |

No files are created or deleted.

---

## Expected Behaviour

All unit-testable **(U)** via the offline `getElement(true)` + cast-to-`any` harness used in `tests/component/Component.test.ts`.

1. **Default unchanged when the caller passes nothing (U).** For all thirteen sites: `new <Class>(...)` with the minimal required positional args renders the same value as before this plan — e.g. `new DiagramNode().getBorderRadius() === "4px"`, `new Checkbox().getOutline() === "none"`, `new AbstractChart()` (via a concrete subclass) reports `getPreferredSize()` `{width: 400, height: 300}`.
2. **Caller override now wins (U).** For all thirteen sites, passing the clobbered field(s) in the options bag makes the getter return the caller's value — e.g. `new DiagramNode({ border: "2px dashed red" }).getBorder()` reflects the override, `new StatusBar({ minSize: { width: 50, height: 10 } }).getMinSize()` reflects `{50, 10}`, `new Checkbox({ outline: "2px solid blue" }).getOutline() === "2px solid blue"`.
3. **`TabButton` border/borderRadius/shadow resting state (U).** `new TabButton("x").getBorder()` reflects the tab token border (not `Button`'s ridge); `new TabButton("x").getBorderRadius()` is `null` (not `Button`'s `"4px"`); `new TabButton("x", { border: "3px solid green" }).getBorder()` reflects the caller's override. Hover/selected border/shadow behaviour is unchanged — no new tests needed there.
4. **`TabBar` border options-aware fold (U).** `new TabBar().` under-border renders the theme token (unchanged); `new TabBar({ border: { border: "1px solid red" } }).getBorder()` reflects the caller's override at construction. A subsequent `tabBar.setSide("west")` still re-derives the theme-token border (this is the documented runtime behaviour, not pinned as a regression — see `## Architecture Decisions`).
5. **Subclass-default layering still works (U).** For every new-bag site: passing a `subclassDefaults` bag with the fixed field set overrides the class's own `_default<Class>Options` entry, per `resolveClassDefaults`'s existing, already-tested layering — no new mechanism test needed, only confirming none of these thirteen bags is malformed (a plain object, no functions/class instances stored in the shared module-level bag except where already established, e.g. `Insets` instances).
6. **Generic-class constructor overload compiles at every existing call site (U/typecheck).** `grep -rn "new Checkbox(\|new RadioButton(\|new Toggle(\|new Slider(" packages/lib/src packages/lib/tests packages/docs` — every existing call site passes at most `(options)` or `(text, options)`; the new trailing `subclassDefaults` parameter is additive and doesn't break any of them. Confirmed by `npm run typecheck` succeeding, not by manual inspection of every match.

---

## Verification

- `npm run typecheck` (in `packages/lib`) — four constructors gain a brand-new, overloaded `subclassDefaults` parameter (`Checkbox`, `RadioButton`, `Toggle`, `Slider`); `AbstractChart` already had the parameter and only gains a bag to pass through it; the other eight sites' constructor signatures are unchanged — only their `_default<Class>Options` bag content changes. All thirteen are checked by this run.
- `npm run test` (in `packages/lib`) — full suite green; add `## Expected Behaviour` items 1-4 as new cases, following the harness pattern already used in `tests/component/Component.test.ts` and the per-class test files touched by background-token-cleanup.
- Grep invariants (per-file, listed in each step's own verification checkpoint above) — re-run all thirteen together as a final pass:
  ```
  grep -n "this.setBorder\b" packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts packages/lib/src/typescript/lib/component/diagram/DiagramGroupNode.ts packages/lib/src/typescript/lib/component/container/StatusBar.ts packages/lib/src/typescript/lib/overlay/Popover.ts
  ```
  — zero matches in all four (the border literal now lives only in each class's `_default*Options` bag).
- Manual visual smoke (no automated coverage of rendered CSS defaults): open the app (`npm run dev`) under Modern, Dark, and Classic themes and confirm unchanged appearance for a diagram with nodes and group nodes, a `StatusBar`, a `Popover`, tab buttons and a tab strip, a `MenuBar`, a `Tree`, a `Checkbox`/`RadioButton`/`Toggle`, a `Slider`, and a chart (`LineChart` or `BarChart`). This is a regression check — nothing should look different from before this plan.
- `npm run docs:api` (in `packages/lib`) — 0 warnings (the new `subclassDefaults` parameters need a `@param` line each, mirroring the wording other sites already use — see `## Documentation Impact`).

---

## Documentation Impact

- **Four constructors gain a `subclassDefaults` parameter for the first time** (`Checkbox`, `RadioButton`, `Toggle`, `Slider`) — each needs a `@param subclassDefaults` line in its constructor JSDoc, mirroring the wording other sites in this codebase already use: *"Per-subclass default bag layered over this class's defaults; subclasses forward their `_default<Class>Options` constant here."* `AbstractChart` already had the parameter; only its module-level default bag is new, so its JSDoc is unchanged.
- No new export, no doc page to update — every changed field was already documented as part of `ComponentOptions` (or the class's own `*Options` interface extending it).
- Changelog (`packages/lib/docs/reference/changelog/next.md`): add a `### Component defaults` entry under `## Fixed` (or under `## Breaking changes` if that heading already exists in `next.md` at implementation time — check first), following the wording pattern background-token-cleanup's own changelog entry used:
  ```markdown
  ### Component defaults

  `DiagramNode`, `DiagramGroupNode`, `StatusBar`, `Popover`, `TabButton`,
  `MenuBar`, `Tree`, `TabBar`, `Checkbox`, `RadioButton`, `Toggle`, `Slider`,
  and `AbstractChart` previously ignored a caller-supplied `border`,
  `borderRadius`, `shadow`, `cursor`, `outline`, `overflow`, `preferredSize`,
  `minSize`, or `maxSize` (depending on the component) and always painted
  their own hardcoded default instead. Passing any of these options now
  works as documented. No consumer action is needed unless code relied on
  the option being silently ignored.
  ```

---

## Critical Files

- [`plans/implemented/background-token-cleanup.md`](plans/implemented/background-token-cleanup.md) — the precedent this plan mirrors exactly: same fix mechanism, same verification rigor, same options-aware-fold variant (its own `## Implementation Notes` records why `TabButton` needed it).
- [`packages/lib/src/typescript/lib/core/Component.ts:507-522`](packages/lib/src/typescript/lib/core/Component.ts#L507-L522) (constructor doc comment), [`:593`](packages/lib/src/typescript/lib/core/Component.ts#L593) (`applyOptions`), [`:679`](packages/lib/src/typescript/lib/core/Component.ts#L679) (`applyChromeOptions`) — the base mechanism every fix in this plan relies on, re-verified against current line numbers.
- [`packages/lib/src/typescript/lib/core/ComponentDefaults.ts:78`](packages/lib/src/typescript/lib/core/ComponentDefaults.ts#L78) (`resolveClassDefaults`) — the layering guarantee (deepest class wins) every bag edit in this plan depends on.
- [`packages/lib/src/typescript/lib/component/button/TabButton.ts:150-172`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L150-L172) — the worked options-aware-fold example (its `backgroundColor` line), the pattern Step 7 and Step 8 extend to `border`.
- [`packages/lib/src/typescript/lib/component/menubar/ToolBar.ts:127,156-160`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L156-L160) — the generic-class `subclassDefaults` overload pattern Steps 9-12 mirror exactly (Step 13's `AbstractChart` already has the parameter and needs no overload — see `## Public API`).
- [`packages/lib/src/typescript/lib/component/button/Button.ts:663`](packages/lib/src/typescript/lib/component/button/Button.ts#L663) (`applyChromeOptions` override) and [`:220-237`](packages/lib/src/typescript/lib/component/button/Button.ts#L220-L237) (`_defaultButtonOptions`) — confirms `border` has no bypass (fixes with a plain bag entry) while `borderRadius`/`shadow` need the explicit-`undefined`-key suppression Step 7 uses.
- [`packages/lib/src/typescript/lib/component/input/TextField.ts:64-73,97-102`](packages/lib/src/typescript/lib/component/input/TextField.ts#L64-L73) — the `updateHeight()` bug this plan deliberately does not fix, and the already-correct "preserve current value" technique (`setBorder`'s own override) a future plan for that family should follow.

---

## Non-Goals

- **Not fixing the `updateHeight()`/`updateSize()` sizing family** (`TextField`, `PasswordField`, `UsernameField`, `ComboBox`, `NumberSpinner`, `AbstractPickerField`). Confirmed real instances of the same underlying bug, but the fix needs an options-preserving rewrite of a method that must keep re-running on theme change — a different, larger shape than this plan's bag substitution. Left for a dedicated follow-up plan; `## Architecture Decisions` names the technique to use (mirror `TextField.setBorder`'s own override).
- **Not fixing `Slider`'s orientation-conditional `preferredSize`/`maxSize`.** Entangled with the legitimate runtime `setOrientation()` resize; needs `applyOrientation` split into a construction-time (options-aware) and runtime (unconditional) path. `Slider`'s `outline`/`cursor` are fixed here since they have no such entanglement.
- **Not fixing `ToolBar`'s orientation-driven `border`.** The write lives inside the public `setOrientation()` method shared by both the options-dispatch and any runtime caller; fixing it needs splitting that method, a `ToolBar`-specific change beyond this plan's pattern.
- **Not fixing `Scrollbar`'s `setTouchAction("none")`.** `touchAction` has no `_defaultOptions` fold anywhere in `Component.ts` (confirmed by reading every relevant getter — see `## Architecture Decisions`'s two-column table), so this plan's bag-substitution fix cannot apply; a working fix needs either extending the base fold mechanism for `touchAction` (a `Component.ts`-level change, out of scope) or a bespoke local guard (a different fix shape for one low-value field).
- **Not extending `Component.ts`'s base fold mechanism to `transform`, `transformOrigin`, `transition`, `willChange`, `opacity`, `colorScheme`, or `background` (shorthand).** The sweep found zero constructor-time clobbering sites on these fields outside of internal helper components with no caller-facing options bag (already excluded on that basis). Extending the base mechanism for fields nothing currently needs would be speculative, ruled out by `CLAUDE.md`'s simplicity-first guideline.
- **Not adding a `ComponentOptions`-shaped bag to `Table`, `Footer`'s `FooterRow`, `Header` (table), `Cell`, `FieldDecorator`, `MarkdownEditor`'s `WysiwygSurface`, `AbstractSelectableList`'s row class, or any drag/overlay helper.** None exposes one today; adding one purely to enable an override is new public API surface, the same reasoning background-token-cleanup's own non-goals used for `Dialog`/`Menu`.
- **No component's default paint or behaviour changes** when nobody customises anything. Every site in `## Clobbering-Bug Fix Sites` keeps its current rendered look; only the override path changes.
- **Not touching `TabButton`'s hover/selected border, borderRadius, or shadow overrides**, nor `applyTabStyling`'s hover/selected background/image lines. Only the resting-state `border`/`borderRadius`/`shadow` hardcode moves into the bag.

---

## Notes

[^undefined-key-suppression]: `resolveClassDefaults` ([`ComponentDefaults.ts:78`](packages/lib/src/typescript/lib/core/ComponentDefaults.ts#L78)) builds its cached bag from `Object.keys(subclassDefaults)`, writing `bag[key] = supplied[key]` for every key present — including a key whose value is `undefined`. Since each class's own defaults are spread *after* its ancestor's (`{ ...parentDefaults, ...(subclassDefaults ?? {}) }`, applied at every layer up to `Component`), a `_defaultTabButtonOptions` entry of `borderRadius: undefined` overrides `Button`'s own `_defaultButtonOptions.borderRadius = "var(--ts-ui-border-radius, 4px)"` in the final merged bag — `Component.applyChromeOptions`'s fold (`options.borderRadius ?? this._defaultOptions.borderRadius`) then resolves to `undefined` and the dispatch is skipped, leaving no `border-radius` CSS property (the same rendered outcome `clearBorderRadius()` currently produces by explicit removal). Omitting the key entirely, instead of setting it to `undefined`, would leave `Button`'s `"4px"` value visible in the merged bag and change `TabButton`'s rendered corner radius — the opposite of this plan's "no visual change when nobody customises anything" goal.
