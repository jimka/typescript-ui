# Button Description Subtitle, Tooltip Wiring & Multiline Tooltip — Implementation Plan

## Overview

Three coupled changes:

1. **Button subtitle** — an optional second `Text` line stacked *below* the title inside the button's content row, smaller/dimmer than the title. New public API: `setText`, `setDescription`, `getDescription`, `clearDescription`, and `ButtonOptions.description`.
2. **Button tooltip wiring** — Button attaches a hover tooltip via [`Tooltip.attach`](../src/typescript/lib/core/Tooltip.ts#L224), keeping the tooltip string in sync as the title or description changes. Tooltip format: `{title}\n\n{description}` when a description exists, else `{title}`.
3. **Tooltip multiline upgrade** — [`Tooltip`](../src/typescript/lib/core/Tooltip.ts#L61) renders `\n`-containing strings on multiple lines, sizing width to the widest line and height to the line count, with single-line callers visually unchanged.

All work lives in [`Button.ts`](../src/typescript/lib/component/button/Button.ts) and [`Tooltip.ts`](../src/typescript/lib/core/Tooltip.ts). The title/description Text styling reuses [`Text`](../src/typescript/lib/component/input/Text.ts) typed setters; the subtitle's dim colour and font size add three theme tokens.

---

## Architecture Decisions

### DOM tree — glyph beside a vertical title/description stack, nested inside the existing `_content` HBox

Today `_content` is a `Component` with an `HBox` layout holding `[glyph?, _text]` ([Button.ts:247-251](../src/typescript/lib/component/button/Button.ts#L247)). `_content` carries a documented stability contract — subclasses re-anchor it and `computePreferredSize` reads `_content.getPreferredSize()` ([Button.ts:140-149](../src/typescript/lib/component/button/Button.ts#L140), [Button.ts:712](../src/typescript/lib/component/button/Button.ts#L712)). **Keep `_content`'s field identity and its HBox shape unchanged.**

Introduce a new private `_titleColumn: Component` laid out by a `VBox` (`spacing: 0`), holding `[_text, _description?]`. `_content`'s HBox then holds `[glyph?, _titleColumn]`. The glyph stays vertically centred beside the whole title/subtitle stack (HBox centre alignment), the title sits above the description, and the outer `Fit` + anchor/fill behaviour is untouched because `_content` is still the single child of the Button's `Fit` layout.

Rejected: a flat 3-row VBox of `[glyph, title, description]` — that would put the glyph above the text instead of beside it, and would require rebuilding `_content` as a VBox, breaking the HBox shape subclasses (`MenuBarButton`) depend on.

`_description` is created lazily on first `setDescription` (mirroring `_glyph`'s lazy creation in `setGlyph`, [Button.ts:396-413](../src/typescript/lib/component/button/Button.ts#L396)), not in the constructor — an empty description must not reserve a line. (`Text` already collapses to 0×0 when empty, [Text.ts:361-371](../src/typescript/lib/component/input/Text.ts#L361), but not creating it at all keeps the VBox single-child for the common no-subtitle case and avoids a dangling Text whose theme listener never fires usefully.)

### `_titleColumn` is private, not part of the subclass contract

Only `_content` is the documented protected re-anchor seam. `_titleColumn` is an internal detail of how the row stacks its label; it stays `private`. `MenuBarButton` reads `this._content.getLayoutManager()` ([MenuBarButton.ts:106](../src/typescript/lib/component/menubar/MenuBarButton.ts#L106)) and that still returns the HBox — unaffected. `AccordionHeader` previously called `this.getText().setTextAlign('left')` / `setInsets(...)` ([AccordionHeader.ts:40-41](../src/typescript/lib/component/container/AccordionHeader.ts#L40)) to reach the inner Text — with `getText()` removed (see *Remove `Button.getText()`* below) those calls are refactored to Button's own anchor + insets API, so they never depend on `_titleColumn` or `_text` directly.

### `description` option dispatched late, mirroring `text`

`applyOptions` runs inside `super()` before `_text`/`_content`/`_titleColumn` exist, so `text` is written *pure* into `_options` there and dispatched from the constructor body once children exist ([Button.ts:303](../src/typescript/lib/component/button/Button.ts#L303), [Button.ts:263-272](../src/typescript/lib/component/button/Button.ts#L263)). `description` follows the identical pattern: pure write in `applyOptions`, dispatch via `this.setDescription(...)` in the constructor body right after the `text`/`glyph` dispatch block, **before** the `recomputePreferredSize()` call so the initial auto-size includes the subtitle.

### Title ownership — add `Button.setText`, route the constructor through it, rebuild the tooltip from both setters

Today there is no `Button.setText`; callers mutate the title via `getText().setText(...)` directly ([Button.ts:377](../src/typescript/lib/component/button/Button.ts#L377)), so Button cannot observe title changes. Add a `Button.setText(text: string): this` that (a) forwards to `this._text.setText(text)`, (b) calls `recomputePreferredSize()`, and (c) rebuilds the tooltip string via `_rebuildTooltip()`. Route the constructor's existing `this._text.setText(effectiveText)` ([Button.ts:266-269](../src/typescript/lib/component/button/Button.ts#L266)) through `this.setText(effectiveText)` so construction and post-construction stay in lockstep. `setDescription` / `clearDescription` also rebuild the tooltip. Both read the current title from `this._text.getText()` and the current description from `this._description?.getText()`.

`setText` is the **only** new public title-related method. There is no public `getText()` anymore (see next decision) and no layout-delegation helpers (`setTextAlign` / `setTextInsets` are explicitly *not* added).

### Remove `Button.getText()` — route all title mutation through `setText` so the tooltip stays in sync

`Button.getText()` ([Button.ts:377](../src/typescript/lib/component/button/Button.ts#L377)) is **removed entirely** — no protected accessor replaces it, no layout-delegation helpers are added. Rationale: with the tooltip now derived from the title, any caller that reached the inner `Text` and called `setText` on it would silently desync the tooltip. Removing the accessor forces every title mutation through `Button.setText`, which is the single point that re-runs `_rebuildTooltip()`. This converts the previous plan's documented "callers bypass the tooltip" limitation into a compile-time guarantee instead of a runtime footgun.

Removal is **scoped to Button and its subclasses only.** The codebase has many unrelated `getText()` methods (Text, TextInput, table-cell editors, `FieldSet`'s Legend, `WindowHeader`/`Window` via `display/Header`) — none of those are touched. Confirmed by `grep -rn '\.getText()' src/`: only four call sites reach a Button/ToggleButton receiver (enumerated in *Ordered Implementation Steps*); all other matches are non-Button classes.

The two former *layout* call sites (`Tab`, `AccordionHeader`) reached `getText()` only to mutate the inner Text's **layout** (insets / text-align), not its string. Because the user rejected a protected inner-Text accessor, they are refactored to express the same visual result through the button's own public layout API — `anchor: AnchorType.WEST` for left alignment and the button's own `setInsets` for horizontal padding (the same pattern `MenuBarButton` already uses, [MenuBarButton.ts:113](../src/typescript/lib/component/menubar/MenuBarButton.ts#L113)). Concrete refactors are spelled out in *Ordered Implementation Steps* steps 9–10.

### `getDescription()` returns the inner `Text` component

`getDescription()` returns the inner description `Text` or `null` when no description has been set (mirroring `getGlyph()` returning `Glyph | null`, [Button.ts:436](../src/typescript/lib/component/button/Button.ts#L436)). It is a read accessor on a lazily-created child, not a title-mutation seam, so it does **not** reintroduce the desync problem that motivated removing `getText()` — there is no `setDescription`-equivalent that bypasses `_rebuildTooltip` because the only way to change the description text is `Button.setDescription`. The composed tooltip helper reads the string via `this._description?.getText() ?? ""`.

### Tooltip attachment is always-on but only shows when there is text

Call `this._rebuildTooltip()` from `setText` / `setDescription` / `clearDescription`. The helper composes the string and calls `Tooltip.attach(this, str)` when the string is non-empty, or `Tooltip.detach(this)` when it is empty (no title and no description). This keeps it minimal — no separate opt-in flag. A button constructed with no text and no description gets no tooltip until one is set. No suppression flag is added (Non-Goal); a future plan can add `setTooltipEnabled` if needed.

### Tooltip multiline — switch `_text` to `pre-wrap`, derive height from explicit line count

`_text` is currently `whiteSpace: "nowrap"` ([Tooltip.ts:102](../src/typescript/lib/core/Tooltip.ts#L102)) and `show()` measures one line via `Util.measureTextWidth` with a fixed `ITEM_HEIGHT + V_PADDING` height ([Tooltip.ts:136-147](../src/typescript/lib/core/Tooltip.ts#L136)); `doLayout` sizes `_text` to a single `ITEM_HEIGHT` ([Tooltip.ts:422-431](../src/typescript/lib/core/Tooltip.ts#L422)). Upgrade:

- Switch `_text` from `nowrap` to `pre-wrap` — preserves `\n` as real breaks *and* wraps long lines within the fixed width. (`Text.setWhiteSpace` exists via the `whiteSpace` option path; the Tooltip already calls `this._text.setWhiteSpace(...)`.)
- In `show()`: split `text` on `\n`; width = `clamp(MIN_WIDTH, MAX_WIDTH, max-per-line measured width + H_PADDING)`; lineCount = number of `\n`-split segments; height = `lineCount * ITEM_HEIGHT + V_PADDING`.
- In `doLayout`: size `_text` height to `lineCount * ITEM_HEIGHT` (cache the count on the instance from `show()`), width to `getWidth() - H_PADDING` as today.

Single-line callers (no `\n`) compute `lineCount = 1`, yielding `ITEM_HEIGHT + V_PADDING` and the unchanged single-line width — appearance preserved. `pre-wrap` on a single short line that doesn't exceed `MAX_WIDTH` renders identically to `nowrap`.

Wrapping caveat (Potential Challenges): a single line longer than `MAX_WIDTH` wraps to a second visual line that the `\n`-count height calc does not account for, so it would clip. Mitigation: keep the existing `MAX_WIDTH` clamp on width and accept that very long unbroken lines clip — matching today's single-line clip behaviour. The Button tooltip's title and description are short, so this is a documented edge, not a blocker. Keep `MIN_WIDTH`/`MAX_WIDTH`/`ITEM_HEIGHT`/`H_PADDING`/`V_PADDING` semantics; extend rather than rewrite.

---

## Public API (TypeScript Signatures)

```typescript
// Button.ts
export interface ButtonOptions extends ComponentOptions {
    // ...existing fields...
    description?: string;   // dispatched late, mirroring `text`
}

class Button<TOptions extends ButtonOptions = ButtonOptions> extends Component<TOptions> {
    private _titleColumn!: Component;        // VBox holding [_text, _description?]
    private _description: Text | null = null; // lazily created on first setDescription

    setText(text: string): this;             // NEW — sole public title entry point; rebuilds tooltip + recompute
    // getText(): Text;  ← REMOVED. No public getText, no protected inner-Text accessor,
    //                     no setTextAlign / setTextInsets delegations.

    setDescription(text: string): this;      // creates/updates the subtitle Text; rebuilds tooltip + recompute
    getDescription(): Text | null;           // inner Text or null
    clearDescription(): this;                 // removes subtitle; rebuilds tooltip + recompute

    private _rebuildTooltip(): void;          // compose {title}\n\n{description} | {title}; attach/detach
}
```

No new typed *CSS* setter on Button — the subtitle is styled by calling existing `Text` setters (`setFontSize`, `setFontWeight`, `setForegroundColor`) on `_description`, the same way the title is styled at [Button.ts:253-256](../src/typescript/lib/component/button/Button.ts#L253).

```typescript
// Tooltip.ts — no public signature change; internal `show`/`doLayout` extended.
private _lineCount: number = 1;  // cached by show(), read by doLayout()
```

---

## Theme Tokens

The subtitle is "smaller and dimmer." Add three tokens so the look is theme-driven rather than hardcoded.

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-button-description-font-size` | `11px` | `11px` | Subtitle font size (smaller than `--ts-ui-button-font-size`) |
| `--ts-ui-button-description-fg` | `rgb(110, 110, 110)` | `rgb(160, 160, 160)` | Subtitle foreground (dimmer than the title's `--ts-ui-text-color`) |
| `--ts-ui-button-description-weight` | `normal` | `normal` | Subtitle font weight (title is `bold`) |

Theme.ts blocks needing entries:
- **`Theme` interface** ([Theme.ts:53-71](../src/typescript/lib/core/Theme.ts#L53)) — add `description: { fontSize, foreground, weight }` under the `button` bucket.
- **`themeToVars`** ([Theme.ts:557-567](../src/typescript/lib/core/Theme.ts#L557)) — emit the three vars from `theme.button.description.*`.
- **The three theme literals** — `ModernTheme.ts` ([button block at line 19](../src/typescript/lib/core/themes/ModernTheme.ts#L19)), `ClassicTheme.ts` (button block line 18), `DarkTheme.ts` (button block line 16) — add a `description` sub-object to each `button` block (Dark uses the dark default column).

Apply on `_description` via `setFontSize("--ts-ui-button-description-font-size")` (string form binds the token, [Text.ts:643-661](../src/typescript/lib/component/input/Text.ts#L643)), `setForegroundColor("var(--ts-ui-button-description-fg, rgb(110,110,110))")`, `setFontWeight("var(--ts-ui-button-description-weight, normal)")`.

---

## Internal Structure

Constructor content-row build (replaces [Button.ts:246-261](../src/typescript/lib/component/button/Button.ts#L246)):

```typescript
this._text        = new Text();
this._titleColumn = new Component();
this._titleColumn.setLayoutManager(new VBox({ spacing: 0 }));
this._titleColumn.setInsets(new Insets(0, 0, 0, 0));
this._titleColumn.setPointerEvents("none");
this._titleColumn.addComponent(this._text);

this._content = new Component();
this._content.setLayoutManager(new HBox({ spacing: 2 }));
this._content.setInsets(new Insets(0, 0, 0, 0));
this._content.setPointerEvents("none");
this._content.addComponent(this._titleColumn);   // glyph inserted at index 0 by setGlyph

// title styling unchanged (Button.ts:253-256)
```

`setGlyph` still does `this._content.insertComponent(glyph, 0)` ([Button.ts:406](../src/typescript/lib/component/button/Button.ts#L406)) — glyph lands before `_titleColumn`, preserving `[glyph, titleColumn]` order.

`setDescription` body shape (mirrors `setGlyph`):

```typescript
setDescription(text: string): this {
    if (!this._description) {
        this._description = new Text();
        this._description.setPointerEvents("none");
        this._description.setTextAlign("center");
        this._description.setFontSize("--ts-ui-button-description-font-size");
        this._description.setFontWeight("var(--ts-ui-button-description-weight, normal)");
        this._description.setForegroundColor("var(--ts-ui-button-description-fg, rgb(110, 110, 110))");
        this._titleColumn.addComponent(this._description);
    }

    this._description.setText(text);
    this._rebuildTooltip();
    this.recomputePreferredSize();

    return this;
}
```

`_rebuildTooltip`:

```typescript
private _rebuildTooltip(): void {
    const title = this._text.getText();
    const desc  = this._description?.getText() ?? "";
    const str   = desc ? `${title}\n\n${desc}` : title;

    if (str) {
        Tooltip.attach(this, str);
    } else {
        Tooltip.detach(this);
    }
}
```

---

## Ordered Implementation Steps

1. **Theme tokens.** Add `button.description` to the `Theme` interface ([Theme.ts:53](../src/typescript/lib/core/Theme.ts#L53)), emit three vars in `themeToVars` ([Theme.ts:557](../src/typescript/lib/core/Theme.ts#L557)), and add the `description` sub-object to the `button` block in `ModernTheme.ts`, `ClassicTheme.ts`, `DarkTheme.ts`. → verify: `npm run build` typechecks; `grep -rn 'ts-ui-button-description' src/` shows 3 token names wired.
2. **Button content row.** Import `VBox`; add `_titleColumn` and `_description` fields; rebuild the constructor content row per *Internal Structure* (nest `_titleColumn` in `_content`). → verify: existing demos still render glyph beside title.
3. **`Button.setText` + remove `getText`.** Add `setText(text: string): this` (forward to `this._text.setText`, then `recomputePreferredSize()`, then `_rebuildTooltip()`); route the constructor's `this._text.setText(effectiveText)` ([Button.ts:266-269](../src/typescript/lib/component/button/Button.ts#L266)) through `this.setText(effectiveText)`. **Delete the `getText()` method and its JSDoc** ([Button.ts:372-379](../src/typescript/lib/component/button/Button.ts#L372)). → verify: `grep -n 'getText' src/typescript/lib/component/button/Button.ts` shows zero matches; title still renders; auto-size still tracks label. (Build will now fail at the four call sites below until steps 8–10 land — that is expected; do them in the same change.)
4. **`description` option.** Add `description?: string` to `ButtonOptions`; pure-write it in `applyOptions` ([Button.ts:303](../src/typescript/lib/component/button/Button.ts#L303) block); dispatch `this.setDescription(this._options.description)` in the constructor body after the glyph dispatch and before `recomputePreferredSize()`.
5. **Description setters.** Add `setDescription` / `getDescription` / `clearDescription` per *Internal Structure*; each calls `recomputePreferredSize()` (like `setGlyph`/`clearGlyph`) and `_rebuildTooltip()`.
6. **`_rebuildTooltip`.** Add the private helper; import `Tooltip`. Call from `setText` / `setDescription` / `clearDescription`.
7. **Tooltip multiline.** In `Tooltip.ts`: switch `_text` to `pre-wrap` ([Tooltip.ts:102](../src/typescript/lib/core/Tooltip.ts#L102)); add `_lineCount`; in `show()` split on `\n`, width = widest-line clamp, height = `lineCount * ITEM_HEIGHT + V_PADDING`; in `doLayout` size `_text` height to `lineCount * ITEM_HEIGHT`. → verify: single-line tooltip unchanged; `"a\n\nb"` renders 3 lines.
8. **Pure `setText` call sites.** Replace the two `getText().setText(...)` callers on Button receivers with `setText(...)`:
   - [`AccordionDemoPanel.ts:74`](../src/typescript/AccordionDemoPanel.ts#L74): `this.singleOpenToggle.getText().setText(\`Single-open: ...\`)` → `this.singleOpenToggle.setText(\`Single-open: ...\`)` (`singleOpenToggle` is a ToggleButton, i.e. a Button subclass).
   - [`MiscPanel.ts:429`](../src/typescript/MiscPanel.ts#L429): `buttonTheme.getText().setText(themeCycle[themeIndex].next)` → `buttonTheme.setText(themeCycle[themeIndex].next)` (`buttonTheme` is a Button).
9. **`AccordionHeader` layout refactor.** `AccordionHeader extends Button` ([AccordionHeader.ts:27](../src/typescript/lib/component/container/AccordionHeader.ts#L27)) and currently does `this.getText().setTextAlign('left'); this.getText().setInsets(new Insets(0,0,0,8))` ([AccordionHeader.ts:40-41](../src/typescript/lib/component/container/AccordionHeader.ts#L40)). Replace with Button's own public API:
   - Left-align the content row by passing `anchor: AnchorType.WEST` through `super(label, options)` — fold it into the merged options bag (`{ ...options, anchor: options?.anchor ?? AnchorType.WEST }`) so an explicit caller `anchor` still wins; `anchor` is consumed once when the constructor adds `_content` to the outer `Fit` ([Button.ts:258-261](../src/typescript/lib/component/button/Button.ts#L258)), so it must be set via options, not a post-`super` setter.
   - Reproduce the 8px left gap with the button's own insets. Button's default insets are `Insets(5, 10, 5, 10)` ([Button.ts:107](../src/typescript/lib/component/button/Button.ts#L107)); the old code added 8px on the inner Text's left *on top of* the button's left inset. After construction, call `this.setInsets(new Insets(top, right, bottom, 18))` (button default left 10 + the old 8) — or whatever value the visual check confirms — keeping the other three sides at their resolved values. `Button.setInsets` is overridden to auto-fire `recomputePreferredSize` ([Button.ts:622](../src/typescript/lib/component/button/Button.ts#L622)), so no extra prodding. Remove the now-unused `Insets` import only if it becomes orphaned. → verify: accordion headers render left-aligned with the same left gap as before (visual smoke).
10. **`Tab` layout refactor.** `Tab` is **not** a Button subclass — it's an external caller building a `ToggleButton` ([Tab.ts:728](../src/typescript/lib/layout/Tab.ts#L728)). It currently sets the button's own insets `new Insets(0, rightInset, 0, 4)` ([Tab.ts:772](../src/typescript/lib/layout/Tab.ts#L772)) **and** the inner Text's insets `new Insets(0, 4, 0, 4)` ([Tab.ts:773](../src/typescript/lib/layout/Tab.ts#L773)) for label breathing room. Fold the inner-Text horizontal padding into the button's own insets and delete line 773: change line 772 to `new Insets(0, rightInset + 4, 0, 8)` (left `4 + 4`, right `rightInset + 4`). → verify: tab labels keep the same horizontal padding; the close-button reserve on closeable tabs is unchanged (it still rides `rightInset`).
11. **Docs** (see *Documentation Impact*).
12. **Regression checkpoint.** `grep -rn '\.getText()' src/` — confirm **zero** matches resolve to a Button/ToggleButton/AccordionHeader receiver; the remaining matches are all unrelated classes (Text, TextInput, table-cell editors, `FieldSet` Legend, `WindowHeader`/`Window` Header). `grep -n 'getText' src/typescript/lib/component/button/Button.ts` → zero. `npm run build` → 0 errors (proves no dangling Button `getText` caller).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/button/Button.ts` |
| Modify | `src/typescript/lib/core/Tooltip.ts` |
| Modify | `src/typescript/lib/core/Theme.ts` |
| Modify | `src/typescript/lib/core/themes/ModernTheme.ts` |
| Modify | `src/typescript/lib/core/themes/ClassicTheme.ts` |
| Modify | `src/typescript/lib/core/themes/DarkTheme.ts` |
| Modify | `src/typescript/lib/component/container/AccordionHeader.ts` (getText layout → anchor WEST + button insets) |
| Modify | `src/typescript/lib/layout/Tab.ts` (getText layout → fold padding into button insets) |
| Modify | `src/typescript/AccordionDemoPanel.ts` (getText().setText → setText) |
| Modify | `src/typescript/MiscPanel.ts` (getText().setText → setText) |
| Modify | `docs/components/Button.md` |
| Modify | `docs/components/ButtonGroup.md` (example calls removed `getText()`) |
| Modify | `docs/components/MenuBarButton.md` (inherited-setter list names `getText`) |
| Modify | `docs/.vitepress/config.mts` (only if a new page is added — not needed; Button page exists) |

---

## Verification

- **Typecheck / build:** `npm run build` — 0 errors. (A 0-error build is itself the proof that no caller still references the removed `Button.getText`.)
- **`getText` removal invariant:** `grep -n 'getText' src/typescript/lib/component/button/Button.ts` — zero matches. `grep -rn '\.getText()' src/` — every remaining match resolves to a non-Button class (Text, TextInput, table-cell editors, `FieldSet` Legend, `WindowHeader`/`Window` Header); no Button / ToggleButton / AccordionHeader receiver remains.
- **Token wiring:** `grep -rn 'ts-ui-button-description' src/` — token name appears in `Theme.ts` (interface + themeToVars), all three theme literals, and `Button.ts`.
- **Subclass sanity:** `MenuBarButton` (glyph + label), `SpinButton` (glyph only, no description), `PickerButton`, `ToggleButton`, `TabCloseButton`, `AccordionHeader` still construct and size correctly — `_content` is still the HBox they read.
- **Manual smoke (demo screen):** a Button with `{ text: "Save", description: "Persist changes" }` shows the subtitle below the title, dimmer/smaller; hovering shows a 3-line tooltip (`Save`, blank, `Persist changes`); a plain `Button("OK")` shows a single-line tooltip; `clearDescription()` collapses the row back to one line and the tooltip back to `OK`.
- **Layout-refactor smoke:** open the **Accordion** demo — section headers are still left-aligned with the same left gap as before. Open the **Tabs** demo — tab labels keep the same horizontal padding, and closeable tabs still reserve room on the right for the ✕ (label doesn't run under it).
- **Theme toggle:** flip Modern / Classic / Dark — subtitle colour + size track the active theme's `button.description.*`.
- **Docs:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

New public API is consumer-visible: `Button.setText`, `Button.setDescription`, `Button.getDescription`, `Button.clearDescription`, `ButtonOptions.description`. The Tooltip multiline upgrade is behavioural (no signature change).

**Breaking change:** `Button.getText()` is **removed** from the public surface. This is a breaking API change for any consumer that called `button.getText()` (or `…getText().setText(…)`). Doc fallout to fix:

- **JSDoc prose in `Button.ts`** ([Button.ts:646-653](../src/typescript/lib/component/button/Button.ts#L646)) — the `getPreferredSize` doc comment references "a `getText().setText(...)` that grows or shrinks the label." Reword to reference `setText(...)` (the new owner) so the regenerated `docs/api/component/button/classes/Button.md` doesn't advertise a removed method.
- **Curated `docs/components/ButtonGroup.md`** ([line 48](../docs/components/ButtonGroup.md#L48)) — `console.log('selected:', button.getText())` calls the removed method on a Button. Update the example (it should not have been reading the title via `getText()`); show the appropriate replacement or drop the line.
- **Curated `docs/components/MenuBarButton.md`** ([line 5](../docs/components/MenuBarButton.md#L5)) — prose lists "`setText`, `getText`, `setGlyph`, …" as inherited Button setters. Remove `getText` from that list.
- **Generated `docs/api/component/button/classes/Button.md`** (and the AccordionHeader/ToggleButton/MenuBarButton/etc. inherited-member pages) regenerate from typedoc on `npm run docs:build`; they pick up the removal automatically — do **not** hand-edit them.
- **Unrelated `getText()` doc references stay** (`Header.md`, `Label.md`, `Text.md`, `TextField.md`, `TextArea.md`, `PasswordField.md`, `IconText.md`) — those document non-Button classes' own `getText`/`getTextComponent` and are out of scope.

- **Barrel:** `Button` and `ButtonOptions` are already re-exported from [`src/typescript/lib/component/button/index.ts`](../src/typescript/lib/component/button/index.ts) — the new methods and option field surface automatically once the JSDoc `@category Components` blocks are present (the interface already has it). No barrel edit needed.
- **Curated page:** update [`docs/components/Button.md`](../docs/components/Button.md) — add a "Description / subtitle" section showing `Button({ text, description })`, `setDescription` / `clearDescription`, and that a tooltip is auto-attached from title + description. Note the new `button.description.*` theme tokens in the existing "Theming" section.
- **Catalog / sidebar:** the Button entry already exists in `docs/components/index.md` ([line 25](../docs/components/index.md#L25)) and the sidebar ([config.mts:65](../docs/.vitepress/config.mts#L65)) — no new page, so no sidebar change.
- **Tooltip page:** `docs/components/Tooltip.md` exists and is linked in the sidebar ([config.mts:59](../docs/.vitepress/config.mts#L59)) — add a sentence that tooltip text may contain `\n` for multi-line tooltips.
- **JSDoc cross-bucket:** `Button` (bucket `component/button`) references `Tooltip` (bucket `core`) in the new `_rebuildTooltip` / `setText` docs — use the markdown-link form `[\`Tooltip\`](/api/core/classes/Tooltip)`, not `{@link}`, per `_shared/docs-conventions.md`.

---

## Potential Challenges

- **Empty title + description.** If a consumer sets only a description, the tooltip is `{description}` with a leading blank-line format only when a title also exists — `_rebuildTooltip` already guards via `desc ? ... : title`; an empty title with a description yields `"\n\n{desc}"`. Mitigation: treat empty title the same — compose `desc` alone when `title` is empty (cheap extra guard in the helper).
- **`recomputePreferredSize` during construction.** `setDescription` is dispatched before the constructor's `recomputePreferredSize()`; the description's own `setText` already schedules a layout and `recomputePreferredSize` runs again at construction end — no stale size. Mitigation: keep the dispatch ordering in step 4.
- **Long unbroken tooltip line clipping.** Covered in Architecture Decisions — accepted edge matching today's single-line clip.
- **`pre-wrap` collapsing trailing space differently.** Negligible for the short Button strings; single-line appearance verified unchanged because a no-`\n` short string under `MAX_WIDTH` doesn't wrap.

---

## Critical Files

- [`src/typescript/lib/component/button/Button.ts`](../src/typescript/lib/component/button/Button.ts) — content row, `applyOptions` late-dispatch, `setGlyph`/`recomputePreferredSize`/`computePreferredSize` patterns to mirror.
- [`src/typescript/lib/core/Tooltip.ts`](../src/typescript/lib/core/Tooltip.ts) — `show`/`doLayout`/`attach`/`detach`.
- [`src/typescript/lib/component/input/Text.ts`](../src/typescript/lib/component/input/Text.ts) — `setFontSize` token binding, `setWhiteSpace`, empty-text collapse, `getText`.
- [`src/typescript/lib/layout/VBox.ts`](../src/typescript/lib/layout/VBox.ts) — preferred-mode column sizing for the title/description stack.
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) + the three literals under `core/themes/` — token plumbing.
- [`src/typescript/lib/component/menubar/MenuBarButton.ts`](../src/typescript/lib/component/menubar/MenuBarButton.ts) — the one subclass reading `_content.getLayoutManager()` + overriding `computePreferredSize`.

---

## Non-Goals

- **A tooltip-suppression flag.** Attachment is always-on (shows only when title/description non-empty). A `setTooltipEnabled` opt-out is deferred.
- **Description on `SpinButton` / glyph-only buttons.** No subclass requests a subtitle; the API is available but unused there.
- **Word-wrapping a single line longer than `MAX_WIDTH` without clipping in the tooltip.** Matches today's single-line clip behaviour; the height calc counts explicit `\n` lines only.
