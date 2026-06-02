# Button Description Alignment, Visibility & Glyph Line-Height Matching — Implementation Plan

## Overview

Four changes shipped as one coherent plan. Three touch the leading-glyph / content-row code in [`Button.ts`](../src/typescript/lib/component/button/Button.ts); the fourth is an unrelated trailing-gap bug fix in [`Tooltip.ts`](../src/typescript/lib/core/Tooltip.ts) that piggybacks because it lives in the same multiline-tooltip area the description feature drives. The Tooltip fix is independent and should land as its **own** code commit (see *Architecture Decisions › Tooltip multiline trailing gap* and the implementation steps).

1. **Description alignment option** — a new `ButtonOptions` boolean `descriptionUnderGlyph` that controls where a button's description/subtitle aligns when the button has a leading glyph. Two content-row topologies switched by the flag:
   - **"under glyph" (full width, the new DEFAULT)** — the description spans the full content-row width *below* the glyph+title row, its left edge under the **glyph**. Tree: `_content`(HBox) = `[ outerVBox(VBox) = [ innerHBox(HBox) = [glyph?, _text], _description ] ]`.
   - **"under title" (indented, the just-shipped behavior, now opt-in)** — `_content`(HBox) = `[glyph?, _titleColumn(VBox) = [_text, _description?]]`.

2. **Description visibility option** — a new `ButtonOptions` boolean `showDescription` (default `true`) that controls whether the description is **rendered on the button face at all**. When `false`, the description text is still stored and still composed into the hover tooltip (`{title}\n\n{description}`), but `_rebuildContentRow` builds the minimal `[glyph?, _titleColumn[_text]]` tree without `_description`. Lets a consumer keep the button compact (glyph + title only) while surfacing the longer subtitle on hover.

3. **Glyph line-height matching** — the leading `_glyph` is sized so its box height equals the **title's rendered line-box height** (the line of text it sits beside), instead of the Glyph's static 16×16 default ([Glyph.ts:167](../src/typescript/lib/component/display/Glyph.ts#L167)). Today the title renders at `--ts-ui-button-font-size` (12 px in [`ModernTheme`](../src/typescript/lib/core/themes/ModernTheme.ts#L24), bold) × the `--ts-ui-line-height` multiplier (1.2) ≈ 14.4 px, while the glyph paints at 16 px — visibly taller than the line it leads, most noticeable in the new under-glyph layout where the glyph sits beside the single title line.

4. **Tooltip multiline trailing-gap fix** — multiline tooltips (e.g. the button's `{title}\n\n{description}`) currently render with a visible empty line at the bottom. Root cause: `show()` sizes height as `lines.length * ITEM_HEIGHT + V_PADDING` with `ITEM_HEIGHT = 20` ([Tooltip.ts:78,157](../src/typescript/lib/core/Tooltip.ts#L78)) and `doLayout()` sets the inner `_text` height to `_lineCount * ITEM_HEIGHT` ([Tooltip.ts:445](../src/typescript/lib/core/Tooltip.ts#L445)), but the `_text` (a default `Text`: font-size 14 px × `var(--ts-ui-line-height, 1.2)` ≈ 16.8 px per line) actually renders each line ~3 px shorter than 20 px. The over-allocation accumulates into trailing empty space that reads as a blank final line. The fix ties the per-line height to the **actual** resolved `_text` line height.

The alignment flag only has a visible effect when **both** a glyph and a description are present **and** `showDescription` is true; without either, or with `showDescription` false, both modes resolve to the current minimal tree, so the six Button subclasses (none of which set a description) keep their content-row shape. The glyph-line-height change is broader: it touches **every** glyph-bearing button, including the subclasses and Tab tab-buttons — see *Architecture Decisions › Glyph line-height matching* and *Potential Challenges* for the scope/regression analysis. The demo gains a second "Cancel" button showing the opt-in indented mode (optionally a third showing description-on-hover-only), and [`docs/components/Button.md`](../docs/components/Button.md) documents the new options.

This builds directly on [`plans/implemented/button-description-and-tooltip.md`](implemented/button-description-and-tooltip.md), reusing its `_text` / `_glyph` / `_description` / `_titleColumn` fields, its late-dispatch machinery, and the multiline-tooltip machinery (`_lineCount`, `ITEM_HEIGHT`, `V_PADDING`) that the trailing-gap fix corrects.

---

## Architecture Decisions

### Default flips to "under glyph" — the indented behavior becomes opt-in

The just-shipped feature always rendered the description indented under the **title** (inside `_titleColumn`, to the right of the glyph — [Button.ts:440-457](../src/typescript/lib/component/button/Button.ts#L440)). This plan makes **full-width "under glyph"** the default. Concretely: a button with `{ text, description, glyph }` and no explicit flag now renders the description at full width, its left edge under the glyph — a behavioral change to the existing demo "Save document" button and to any consumer relying on the indented look. Opting back in is `descriptionUnderGlyph: false`. This flip is intentional and called out here so the implementer doesn't "preserve" the old default.

### Option name, cache, and reads — `descriptionUnderGlyph?: boolean`, default `true`

Add `descriptionUnderGlyph?: boolean` to `ButtonOptions`. Per ARCHITECTURE.md's three rules ([ARCHITECTURE.md:80-83](../ARCHITECTURE.md#L80)) the options bag is the cache: the setter writes `this._options.descriptionUnderGlyph = value`, the getter returns `this._options.descriptionUnderGlyph ?? true`. No separate `_`-backing field is needed because the stored form is the raw boolean (no normalisation). A private read helper `_isDescriptionUnderGlyph()` (returns the `?? true` value) is used by the rebuild method so the default lives in one place.

Typed surface: `setDescriptionUnderGlyph(value: boolean): this` and `isDescriptionUnderGlyph(): boolean`. The setter writes the flag then calls `_rebuildContentRow()` + `recomputePreferredSize()` so a runtime flip restructures the tree live.

### Description visibility — `showDescription?: boolean`, default `true`, hides on-button render but keeps the tooltip

Add `showDescription?: boolean` to `ButtonOptions`, defaulting `true`. Name and accessor shape follow the codebase's boolean-option convention `is<X>()` / `set<X>()` — `isEnabled`/`setEnabled` ([Button.ts:1266,1292](../src/typescript/lib/component/button/Button.ts#L1266)), `isChromeless`/`setChromeless` ([Button.ts:642,662](../src/typescript/lib/component/button/Button.ts#L642)) — so the surface is `setShowDescription(value: boolean): this` and `isShowDescription(): boolean`. Same options-bag-as-cache treatment as `descriptionUnderGlyph` (ARCHITECTURE.md three rules): setter writes `this._options.showDescription = value`, getter returns `this._options.showDescription ?? true`, no `_`-backing field, no `declare` (it rides the bag, not a class field — the cascade trap does not apply). A private `_isShowDescription()` resolves the `?? true` default for the rebuild method.

**Semantics — text always stored, on-button render gated, tooltip untouched.**

- `setDescription(text)` still lazily creates `_description`, sets its text, rebuilds the tooltip, and recomputes — regardless of `showDescription`. The `_description` instance must **exist** whenever a description string is set, because `_rebuildTooltip` composes the tooltip from `_description.getText()` ([Button.ts:497-513](../src/typescript/lib/component/button/Button.ts#L497)). So `_description` is created in `setDescription` as today; the flag only controls whether `_rebuildContentRow` **parents** it into `_content`.
- `_rebuildContentRow()` consults `_isShowDescription()`: when it returns `false`, treat the tree exactly as the no-description case — build `[glyph?, _titleColumn[_text]]` (the minimal tree), leaving `_description` detached (parentless) but alive. The `descriptionUnderGlyph` branch is only taken when `_description && _glyph && underGlyph && showDescription`. This preserves the subclass-safety invariant (minimal tree when nothing is shown).
- `_rebuildTooltip()` is **unaffected** — it reads `_text` / `_description` text directly and always emits `{title}\n\n{description}` when both exist, so the tooltip keeps showing the description even when it is hidden on the button face.
- **Interaction with `descriptionUnderGlyph`:** when `showDescription` is false the alignment flag has no visible on-button effect (nothing is rendered) but remains harmless — `_rebuildContentRow` short-circuits to the minimal tree before consulting the alignment branch. Note this in the docs.

`setShowDescription(value)` calls `_rebuildContentRow()` + `recomputePreferredSize()` for runtime flips (flipping false→true re-parents the live `_description` into the tree; true→false detaches it). It does **not** touch the tooltip — the tooltip never changes with this flag. No constructor-body late dispatch of the flag is needed: like `descriptionUnderGlyph`, it is pure-written in `applyOptions` so it is already cached before the `setDescription` late-dispatch rebuilds the tree.

### Super-cascade trap — the flag's writes during `super()` need care, but the flag rides the options bag so no `declare` field is required

`Button.applyOptions` runs inside `super()` ([Button.ts:334](../src/typescript/lib/component/button/Button.ts#L334)). Following the existing `description` / `text` / `glyph` precedent, the flag is **pure-written** into `this._options` in `applyOptions` (no setter dispatch there) and the *real* dispatch happens from the constructor body once children exist. Because the cache is `this._options.descriptionUnderGlyph` (an object property, not a class field), the TypeScript class-field super-cascade trap — which clobbers `= initializer` / `!` fields written by setters during `super()` ([Button.ts:179-197](../src/typescript/lib/component/button/Button.ts#L179)) — **does not apply**: there is no new class field to clobber. This mirrors how `chromeless` / `anchor` / `fill` are pure-written ([Button.ts:352-354](../src/typescript/lib/component/button/Button.ts#L352)) with no backing field. **No `declare` field is added.** (If a future change ever moves this flag to a class field written by `setDescriptionUnderGlyph` during the cascade, that field would need `declare` per the trap — but this design avoids that.)

### Dispatch ORDER in the constructor body — flag pure-write, then text/glyph/description, with the rebuild riding the setters

The constructor body currently late-dispatches `setText` → `setGlyph` → `setDescription` ([Button.ts:301-310](../src/typescript/lib/component/button/Button.ts#L301)). The new flag must be in `this._options` **before** the tree is first assembled so the first `setDescription` builds the correct topology. Two ordering facts make this robust regardless of cascade timing:

1. `applyOptions` already pure-writes `descriptionUnderGlyph` into `_options` during `super()` — so by the time the constructor body runs, `this._options.descriptionUnderGlyph` is final. No constructor-body dispatch of the *flag* is needed before the description dispatch; the flag is already cached.
2. `setDescription` (and `setGlyph`) call `_rebuildContentRow()` (see next decision), which reads the cached flag live. So whichever of `setGlyph` / `setDescription` runs, the rebuild lands the children in the right tree.

Therefore the constructor body keeps its existing `setText` → `setGlyph` → `setDescription` order unchanged; the flag needs no late dispatch of its own (it is consumed by the rebuilds those setters already trigger). The new `setDescriptionUnderGlyph` setter exists only for **runtime** flips after construction.

### Single private `_rebuildContentRow()` — the one place that reparents `_glyph` / `_text` / `_description`

All topology assembly routes through one idempotent private method `_rebuildContentRow()`. It is called from `setGlyph`, `clearGlyph`, `setDescription`, `clearDescription`, and `setDescriptionUnderGlyph`. It (re)builds `_content`'s child tree from the current `_glyph` / `_text` / `_description` instances and the cached flag, **without** ever recreating `_content` (preserving its identity and HBox layout — the documented subclass seam, [Button.ts:150-159](../src/typescript/lib/component/button/Button.ts#L150)).

**Reparenting correctness (the crux).** `Component.addComponent` / `insertComponent` **throw** if the component already has a parent ([Component.ts:3449-3451](../src/typescript/lib/core/Component.ts#L3449), [Component.ts:3496-3498](../src/typescript/lib/core/Component.ts#L3496)); they early-return (no-op) only when the parent is already *this* ([Component.ts:3445](../src/typescript/lib/core/Component.ts#L3445)). So moving `_text` / `_glyph` / `_description` between the two topologies **must** detach them from their current parent first. The safe, idempotent shape is: at the top of `_rebuildContentRow()`, detach every shared child from whatever parent currently holds it, then re-add into the target tree. Detach via the parent's `removeComponent` — but `removeComponent` also calls `component.removeElement()` ([Component.ts:3557](../src/typescript/lib/core/Component.ts#L3557)), which is fine because `addComponent` re-creates/re-attaches the element ([Component.ts:3469-3472](../src/typescript/lib/core/Component.ts#L3469)). Because `getParentComponent()` ([Component.ts:3405](../src/typescript/lib/core/Component.ts#L3405)) returns the live parent, the method reads each child's current parent and removes from it, making the method safe to call any number of times.

Idempotence detail: `addComponent` early-returns when the child's parent is already the target ([Component.ts:3445](../src/typescript/lib/core/Component.ts#L3445)), so a no-op rebuild (flag unchanged, glyph/description unchanged) that re-detaches and re-attaches into the same slots is still correct — but to avoid needless DOM churn the method should detach-then-rebuild from a known-empty state rather than diffing. See *Internal Structure* for the concrete body.

### Container components (outer VBox, inner HBox) are created LAZILY, only for under-glyph mode

Under-title mode reuses the existing `_titleColumn` (VBox). Under-glyph mode needs two **extra** containers: an `_outerColumn` (VBox holding `[innerHBox, _description]`) and an `_innerRow` (HBox holding `[glyph?, _text]`). These are created **lazily** on first entry into under-glyph-with-description, mirroring the lazy `_glyph` / `_description` creation pattern. Rationale:

- A button with no description, or in under-title mode, never allocates them — keeping the minimal tree the subclasses depend on.
- Lazy creation keeps the common case (no description) at exactly today's two-component depth.

Both lazy containers get the same chrome the existing containers set ([Button.ts:277-286](../src/typescript/lib/component/button/Button.ts#L277)): `setLayoutManager(new VBox({ spacing: 0 }))` / `new HBox({ spacing: 2 })`, `setInsets(new Insets(0,0,0,0))`, `setPointerEvents("none")`. The inner HBox reuses `spacing: 2` to match `_content`'s glyph-text gap so the glyph-text spacing is visually identical to under-title mode. (MenuBarButton bumps `_content`'s spacing to 4 but sets no description, so it never builds `_innerRow` — its spacing override is unaffected.)

Backing fields `_outerColumn` and `_innerRow` are `private` and nullable (`Component | null = null`), lazily assigned. They are **not** part of the subclass contract (like `_titleColumn`, [Button.ts:161-169](../src/typescript/lib/component/button/Button.ts#L161)). They are plain `= null` initialisers, not setter-written during the cascade, so no `declare` trap applies to them.

### `_content` keeps HBox identity; `computePreferredSize` sizes correctly in both modes

`_content` stays the same instance with its HBox layout. In under-glyph mode `_content`'s HBox holds a **single** child (the outer VBox). HBox `getPreferredSize` in `"preferred"` mode sums child widths + `spacing*(n-1)` ([HBox.ts:236-249](../src/typescript/lib/layout/HBox.ts#L236)); with one child `n-1 = 0`, so `_content` sizes exactly to the outer VBox's preferred size (plus `_content`'s zero perimeter). The outer VBox's preferred size includes the description row, so `computePreferredSize` ([Button.ts:845-853](../src/typescript/lib/component/button/Button.ts#L845)) — which reads `this._content.getPreferredSize()` — includes the description in **both** modes. The description's subtree always lives inside `_content`. Confirmed against [HBox.ts:208-259](../src/typescript/lib/layout/HBox.ts#L208).

### Glyph line-height matching — the lever is `Glyph.setPreferredSize`, sized from the title's line box, applied via a deferred re-sync

**The lever is the glyph's `preferredSize`, not its font-size.** A `Glyph`'s rendered *box* is its `preferredSize`, for **both** kinds: SVG glyphs paint `<svg width/height>` from `preferredSize` inline in `render()` ([Glyph.ts:656-660](../src/typescript/lib/component/display/Glyph.ts#L656)) and `setPreferredSize` pins min=pref=max so the glyph stays rigid in flex layouts ([Glyph.ts:280-286](../src/typescript/lib/component/display/Glyph.ts#L280)); char glyphs render a `<span>` whose box is the same pinned `preferredSize` (their `font-size`/`line-height` only position the Unicode char *inside* that box — [Glyph.ts:255-265](../src/typescript/lib/component/display/Glyph.ts#L255), [Glyph.ts:307-323](../src/typescript/lib/component/display/Glyph.ts#L307)). `Glyph.setFontSize` takes a **number only** and is explicitly a no-op for SVG box sizing ([Glyph.ts:318-323](../src/typescript/lib/component/display/Glyph.ts#L318)), so a font-size token is the *wrong* lever — it would not resize an SVG glyph's box at all. **Reject the token/CSS-var approach** (the task asked us to prefer it *if Glyph supports font-size-driven box sizing* — it does not). The right lever is `_glyph.setPreferredSize(px, px)` with `px` equal to the title line-box height.

**The size value is the title's rendered line-box height = `_text.getLineHeight()`.** The title `_text` is bound to `--ts-ui-button-font-size` for font-size ([Button.ts:291](../src/typescript/lib/component/button/Button.ts#L291)) but its *line-height* stays on the generic `--ts-ui-line-height` multiplier (1.2) — Button overrides only `setFontSize`, never `setLineHeight`, so the title keeps `Text`'s default `var(--ts-ui-line-height, 1.2)` rule ([Text.ts:96-97,129](../src/typescript/lib/component/input/Text.ts#L96)). `Text.getLineHeight()` returns that resolved pixel value (font-size × multiplier, populated lazily by `readThemeLineHeightPx()` on first measure / on theme change — [Text.ts:252-265](../src/typescript/lib/component/input/Text.ts#L252), [Text.ts:797-799](../src/typescript/lib/component/input/Text.ts#L797)). So the glyph height is `Math.round(this._text.getLineHeight() ?? <fallback>)`. Use a square box (`width === height`) — the existing 16×16 default is square and SVG/char glyphs are authored on a square viewbox; matching the *height* to the line box and keeping it square is the natural fit. (≈14.4 → 14 px at the ModernTheme default, vs today's 16 px — a small shrink; see *Potential Challenges*.)

**Apply it in a deferred re-sync, never at construction.** `getLineHeight()` resolves from a `getComputedStyle` read of `--ts-ui-line-height` and a text measurement, which ARCHITECTURE.md forbids during construction ([ARCHITECTURE.md:173](../ARCHITECTURE.md#L173) "never read layout during construction; defer to a layout pass or theme-change callback"). Button already has the right deferred seam: `recomputePreferredSize()` runs at end-of-constructor ([Button.ts:315](../src/typescript/lib/component/button/Button.ts#L315)) and re-fires on every theme change via `ThemeManager.onThemeChange(this._onThemeChange)` ([Button.ts:205,320](../src/typescript/lib/component/button/Button.ts#L205)). Add a private `_syncGlyphSize()` that reads `_text.getLineHeight()` and calls `_glyph.setPreferredSize(px, px)` when a glyph exists, and **call it from the top of `recomputePreferredSize()`** (before it computes the content size) so: (a) the glyph is sized before the button's own preferred size is derived from `_content`, and (b) it re-syncs automatically on theme toggle through the existing handler — no new listener, no construction-time measurement. `setGlyph` already ends in `recomputePreferredSize()`, so a freshly-set glyph is sized on the same call.

### Glyph line-height matching is opt-out per subclass, via the existing `setPreferredSize` override-after-super pattern — and does NOT clobber explicit glyph sizes

`_syncGlyphSize()` runs inside `recomputePreferredSize()`, which **no-ops entirely when `_consumerSetPreferredSize` is set** ([Button.ts:820-823](../src/typescript/lib/component/button/Button.ts#L820)) — i.e. on any button whose *own* preferred size was pinned by a consumer. But subclasses size the **glyph** (not the button) explicitly *after* construction: `SpinButton` calls `glyph.setPreferredSize(8, 8)` ([SpinButton.ts:104](../src/typescript/lib/component/input/SpinButton.ts#L104)) and `Tab` calls `closeButton.getGlyph().setPreferredSize/​setMinSize/​setMaxSize(CLOSE_GLYPH_SIZE…)` ([Tab.ts:813-816](../src/typescript/lib/layout/Tab.ts#L813)) in their constructors, *after* `super()` and its end-of-constructor `recomputePreferredSize()` have already run. Those later explicit `setPreferredSize` calls **win** (they run last), so SpinButton's 8 px chevron and Tab's close ✕ are unaffected at construction. The risk is only a *subsequent* theme toggle re-firing `recomputePreferredSize` → `_syncGlyphSize` and overwriting the subclass's explicit glyph size with the title-line-height value.

**Mitigation:** `_syncGlyphSize()` must only resize a glyph it is *responsible* for — i.e. one whose size the framework set, not one a subclass/consumer pinned. Two viable shapes; the plan picks the first:

1. **Guard on a private flag.** `setGlyph` sets a private `_glyphAutoSized = true` after creating the glyph; any external `_glyph.setPreferredSize` by a subclass leaves the *Button* unaware, so instead **gate `_syncGlyphSize` on "did Button create this glyph and has no subclass since re-pinned it"** is hard to detect from Button. Rejected as too implicit.
2. **(CHOSEN) Make subclass glyph sizing authoritative by having `_syncGlyphSize` skip when the glyph's current preferred size was set by something other than this method.** Simplest robust form: `_syncGlyphSize` records the px it last wrote in a private `_glyphSyncedSize: number | null`; on each call it reads the glyph's current `getPreferredSize()` and **only overwrites when that current size still equals the value `_syncGlyphSize` itself last wrote** (or is null/unset). If a subclass or `Tab` has since pinned a different size, the equality check fails and `_syncGlyphSize` leaves it alone. On the first run there is nothing pinned, so the line-height value applies; after a subclass overrides, the override sticks across theme toggles.

This keeps the line-height match for *plain* glyph buttons (the common case and the demo) while letting `SpinButton` / `TabCloseButton` / `Tab` close-glyph / any consumer `getGlyph().setPreferredSize(...)` opt out simply by sizing the glyph themselves — which they already do. Flag the equality-guard as the one piece of new bookkeeping in *Potential Challenges*.

### Scope contrast — alignment is glyph+description-only; glyph-sizing is all-glyph-buttons

The alignment option only restructures the tree when a button has **both** a glyph and a description, so it touches only that narrow set and leaves all six subclasses' content rows byte-for-byte unchanged. The glyph line-height match is **broader**: it runs for every button that has a glyph, including `MenuBarButton`, `PickerButton` (calendar/clock trigger), `ToggleButton`, `AccordionHeader`, and — but for the opt-out guard above — `SpinButton` / `TabCloseButton` / Tab close buttons. The implementer and user must visually verify the all-glyph-buttons set (see *Verification* and *Potential Challenges*), because this is a real, if small, change to the rendered glyph size on every plain glyph button.

### Subclasses' content-row shape is untouched — verified

- **MenuBarButton** ([MenuBarButton.ts:106](../src/typescript/lib/component/menubar/MenuBarButton.ts#L106)) reads `this._content.getLayoutManager() as HBox` and overrides `computePreferredSize`. `_content` stays an HBox; MenuBarButton sets no description so `_rebuildContentRow` always lands the under-title minimal tree (`[glyph?, _titleColumn]`) — `_innerRow` / `_outerColumn` are never created. Its glyph (if any) gets line-height-matched like any plain button; verify visually.
- **AccordionHeader** ([AccordionHeader.ts:40,50](../src/typescript/lib/component/container/AccordionHeader.ts#L40)) uses `anchor: WEST` + `setInsets`; touches no content-row internals and sets no description. Content row unaffected.
- **SpinButton / PickerButton / ToggleButton / TabCloseButton** — none reference `_content` / `_text` / `_glyph` / `_description` / `_titleColumn` / `getLayoutManager` / `computePreferredSize`, and none set a description, so their content-row *shape* is unaffected. SpinButton and TabCloseButton/Tab additionally pin their glyph size explicitly and so opt out of the line-height match via the equality guard above.

The invariant that guarantees content-row subclass safety: **when `_description` is `null` OR `showDescription` is false, `_rebuildContentRow` produces the current tree (`[glyph?, _titleColumn]` with `_titleColumn = [_text]`)** regardless of the alignment flag. Only `glyph + description + descriptionUnderGlyph=true + showDescription=true` selects the alternate topology.

### Tooltip multiline trailing gap — tie per-line height to the actual `_text` line height, not the fixed `ITEM_HEIGHT = 20`

**Root cause (confirmed in code).** `Tooltip.show()` sizes the box at `lines.length * ITEM_HEIGHT + V_PADDING` ([Tooltip.ts:157](../src/typescript/lib/core/Tooltip.ts#L157)) and `doLayout()` sizes the inner label at `_lineCount * ITEM_HEIGHT` ([Tooltip.ts:445](../src/typescript/lib/core/Tooltip.ts#L445)), both with `ITEM_HEIGHT = 20` ([Tooltip.ts:78](../src/typescript/lib/core/Tooltip.ts#L78)). The tooltip `_text` is a default `Text` ([Tooltip.ts:105-112](../src/typescript/lib/core/Tooltip.ts#L105)) — font-size 14 px ([Text.ts:63](../src/typescript/lib/component/input/Text.ts#L63)), line-height bound to `--ts-ui-line-height` (multiplier ≈ 1.2 → ~16.8 px per line via `readThemeLineHeightPx()` = `fontSize * parsed` ([Text.ts:252-265](../src/typescript/lib/component/input/Text.ts#L252))). So each line over-allocates `20 − 16.8 ≈ 3.2 px`; the bottom of a multi-line tooltip accumulates `lineCount × 3.2 px` of empty space, reading as a trailing blank line.

**Fix.** Replace the fixed `ITEM_HEIGHT` per-line height with the tooltip text's **resolved** line height, read at `show()` time (hover time — not construction, so the measurement read is allowed; ARCHITECTURE.md only bans construction-time layout reads). Concretely:

- `Text.getLineHeight()` returns `_options.lineHeight ?? _defaultOptions.lineHeight ?? null` ([Text.ts:797-799](../src/typescript/lib/component/input/Text.ts#L797)). For the tooltip `_text` (never set explicitly) this is `_defaultOptions.lineHeight`, which is `undefined` until the first `calculateSize()` populates it via `readThemeLineHeightPx()` ([Text.ts:315-317](../src/typescript/lib/component/input/Text.ts#L315)) — so a *cold* read can return `null`. To get a guaranteed resolved value at `show()` time, the tooltip computes the per-line height itself rather than depending on whether `_text` has measured yet: read `--ts-ui-line-height` and the text font-size the same way `Text` does, or — simpler and theme-correct — measure once via `Util.measureTextMetrics("X", { fontSize, lineHeight: "var(--ts-ui-line-height,1.2)" })` and take its `height` as the per-line height. The cleanest is to add a private `_perLineHeight(): number` on `Tooltip` returning `Math.ceil(<resolved line height px>)`, computed in `show()`.
- Total box height becomes `lines.length * perLine + V_PADDING`; `doLayout()` sets the label height to `_lineCount * perLine` (cache the resolved `perLine` alongside `_lineCount`, e.g. a private `_perLine: number` set in `show()` and read in `doLayout()`, mirroring how `_lineCount` is cached for the layout pass).
- **`ITEM_HEIGHT` becomes the single-line minimum/baseline**, not the per-line multiplier. Keep `ITEM_HEIGHT = 20` as a floor so a 1-line tooltip is never shorter than today: `perLine = Math.max(<resolved line height>, /* none */)` is **not** what we want for multi-line (that would re-introduce the gap); instead keep single-line visually unchanged by flooring the **total**: for the common 1-line case `1 * 16.8 + 8 ≈ 24.8` vs today's `1 * 20 + 8 = 28`. Decide between (a) accepting the slightly tighter single-line box (it still comfortably fits the 16.8 px line plus 8 px padding) or (b) flooring the whole-box height to `ITEM_HEIGHT + V_PADDING` for the 1-line case to keep it byte-identical. **Recommended: (b)** — floor the box so single-line tooltips stay exactly as shipped, and only multi-line tooltips switch to the tight per-line height. Implement as `tooltipHeight = lines.length * perLine + V_PADDING` then, if `lines.length === 1`, `tooltipHeight = Math.max(tooltipHeight, ITEM_HEIGHT + V_PADDING)`. This keeps the just-shipped single-line behavior pixel-stable while removing the multi-line trailing gap.
- **Theme reactivity.** Because `perLine` is resolved inside `show()` (which runs on every hover) from the live `--ts-ui-line-height` / font-size, a theme/font-size change is automatically reflected on the next hover — no cached stale value, no extra listener.

This fix is **independent** of the Button content-row work and should be a **separate code commit** at `/implement` time (one functionality per commit). It touches only `Tooltip.ts`.

---

## Public API (TypeScript Signatures)

```typescript
// Button.ts
export interface ButtonOptions extends ComponentOptions {
    // ...existing fields...
    /**
     * When a leading glyph AND a description are both present, controls where
     * the description aligns. `true` (default) spans the description full-width
     * below the glyph+title row, its left edge under the glyph. `false` indents
     * it under the title text, beside the glyph. No effect without both a glyph
     * and a description. Dispatched via the content-row rebuild that
     * setGlyph/setDescription already trigger.
     */
    descriptionUnderGlyph?: boolean;

    /**
     * When `false`, the description is NOT rendered on the button face — the
     * button shows only its glyph and title — but it STILL appears in the hover
     * tooltip (`{title}\n\n{description}`). Default `true` (description shown on
     * the button). The text is always stored; only its on-button render is
     * suppressed. No effect without a description. When `false`, the
     * `descriptionUnderGlyph` alignment flag has no visible effect.
     */
    showDescription?: boolean;
}

class Button<TOptions extends ButtonOptions = ButtonOptions> extends Component<TOptions> {
    private _outerColumn: Component | null = null;  // VBox [innerHBox, _description] — lazy, under-glyph only
    private _innerRow:    Component | null = null;   // HBox [glyph?, _text]          — lazy, under-glyph only
    private _glyphSyncedSize: number | null = null;  // px _syncGlyphSize last wrote; guards subclass opt-out

    setDescriptionUnderGlyph(value: boolean): this;  // writes flag, rebuilds row, recomputes
    isDescriptionUnderGlyph(): boolean;              // this._options.descriptionUnderGlyph ?? true

    setShowDescription(value: boolean): this;        // writes flag, rebuilds row, recomputes (tooltip untouched)
    isShowDescription(): boolean;                    // this._options.showDescription ?? true

    private _rebuildContentRow(): void;              // sole reparent point; idempotent
    private _isDescriptionUnderGlyph(): boolean;     // shared default-resolving read used by rebuild
    private _isShowDescription(): boolean;           // shared default-resolving read used by rebuild
    private _syncGlyphSize(): void;                  // sizes _glyph to title line-box height; theme-reactive, opt-out-safe
}
```

```typescript
// Tooltip.ts — no public surface change; internal per-line-height fix.
class Tooltip extends Component {
    private _perLine: number;            // resolved per-line px, set in show(), read by doLayout()
    private _perLineHeight(): number;    // reads live --ts-ui-line-height / font-size; theme-reactive
}
```

No new CSS setter, no new theme token. Both Button flags ride the options bag (no `_`-backing field, no `declare` field). The glyph-sizing change reuses `Glyph.setPreferredSize` and the title's existing `--ts-ui-button-font-size` / `--ts-ui-line-height` bindings; the tooltip fix re-reads `--ts-ui-line-height` at hover time — so all three are theme-reactive for free.

---

## Internal Structure

`_rebuildContentRow()` — detach-then-build, idempotent. The two helper containers are created lazily only on the under-glyph branch.

```typescript
private _isDescriptionUnderGlyph(): boolean {
    return this._options.descriptionUnderGlyph ?? true;
}

private _isShowDescription(): boolean {
    return this._options.showDescription ?? true;
}

private _detach(child: Component | null): void {
    const p = child?.getParentComponent();
    if (p) p.removeComponent(child!);
}

private _rebuildContentRow(): void {
    // 1. Detach every shared child from whatever parent currently holds it.
    //    add/insertComponent throw if a child still has a parent, so this
    //    detach pass is mandatory and makes the method re-callable.
    this._detach(this._glyph);
    this._detach(this._text);
    this._detach(this._description);
    this._detach(this._titleColumn);
    this._detach(this._innerRow);
    this._detach(this._outerColumn);

    const underGlyph    = this._isDescriptionUnderGlyph();
    const showDesc      = this._isShowDescription();
    // Treat description as absent for rendering purposes when hidden — the
    // instance stays alive (detached above) so the tooltip can still read it.
    const renderDesc    = this._description && showDesc;

    if (renderDesc && this._glyph && underGlyph) {
        // Under-glyph (full width): _content[ outer( inner[glyph, _text], _description ) ]
        if (!this._innerRow) {
            this._innerRow = new Component();
            this._innerRow.setLayoutManager(new HBox({ spacing: 2 }));
            this._innerRow.setInsets(new Insets(0, 0, 0, 0));
            this._innerRow.setPointerEvents("none");
        }
        if (!this._outerColumn) {
            this._outerColumn = new Component();
            this._outerColumn.setLayoutManager(new VBox({ spacing: 0 }));
            this._outerColumn.setInsets(new Insets(0, 0, 0, 0));
            this._outerColumn.setPointerEvents("none");
        }

        this._innerRow.addComponent(this._glyph);
        this._innerRow.addComponent(this._text);
        this._outerColumn.addComponent(this._innerRow);
        this._outerColumn.addComponent(this._description);
        this._content.addComponent(this._outerColumn);
    } else {
        // Under-title (today's tree): _content[ glyph?, _titleColumn[ _text, _description? ] ]
        // When showDescription is false, _description is NOT added — minimal tree.
        this._titleColumn.addComponent(this._text);
        if (renderDesc) {
            this._titleColumn.addComponent(this._description);
        }
        if (this._glyph) {
            this._content.insertComponent(this._glyph, 0);  // glyph leads
        }
        this._content.addComponent(this._titleColumn);      // titleColumn after glyph
    }
}
```

Insertion order in the under-title branch: insert the glyph at index 0 *then* append `_titleColumn` yields `[glyph, _titleColumn]`; when there's no glyph it's just `[_titleColumn]` — matching today's tree exactly. When `showDescription` is false, `_description` is detached at the top and never re-parented, so the button face shows glyph+title only while `_description` stays alive for the tooltip.

`_syncGlyphSize()` — sizes the glyph to the title's line box, theme-reactive, opt-out-safe via the equality guard:

```typescript
private _syncGlyphSize(): void {
    const glyph = this._glyph;
    if (!glyph) {
        return;
    }

    // Title line-box height: button-font-size × --ts-ui-line-height (resolved
    // px). _text keeps Text's default line-height var, so getLineHeight()
    // returns the rendered line box. Fall back to the current glyph height if
    // the measurement isn't ready (pre-attach), so we never write 0/NaN.
    const lineHeight = this._text.getLineHeight();
    if (lineHeight === null) {
        return;
    }
    const px = Math.round(lineHeight);

    // Opt-out guard: only overwrite a glyph size this method itself last wrote.
    // A subclass / consumer that pinned its own glyph size (SpinButton 8px,
    // Tab close-glyph) leaves a current size != _glyphSyncedSize, so we skip
    // and their explicit size survives theme toggles.
    const current = glyph.getPreferredSize();
    const ours    = this._glyphSyncedSize;
    if (current && ours !== null && (current.width !== ours || current.height !== ours)) {
        return;
    }

    glyph.setPreferredSize(px, px);
    this._glyphSyncedSize = px;
}
```

Wire it into `recomputePreferredSize` at the top, *before* the content size is read (and before the `_consumerSetPreferredSize` early-return is moot for glyph sizing — note the existing early-return means buttons whose *own* size is consumer-pinned skip glyph re-sync too; that is acceptable because such buttons are sizing-frozen by intent):

```typescript
protected recomputePreferredSize(): void {
    this._syncGlyphSize();          // NEW — size glyph to title line box first

    if (this._consumerSetPreferredSize) {
        return;
    }
    // ...existing body...
}
```

> Note: placing `_syncGlyphSize()` *above* the `_consumerSetPreferredSize` guard means even a button with a pinned own-size still line-height-matches its glyph; placing it below skips it for pinned buttons. The plan puts it **above** so the glyph match is independent of whether the consumer froze the button's own size. SpinButton/Tab still opt out via the per-glyph equality guard, not via the button-level freeze.

Constructor changes ([Button.ts:275-310](../src/typescript/lib/component/button/Button.ts#L275)):

- Keep creating `_text`, `_titleColumn`, `_content` exactly as today (so the no-description minimal tree is unchanged and `_content` identity/HBox is preserved). The initial `this._titleColumn.addComponent(this._text)` and `this._content.addComponent(this._titleColumn)` stay — they ARE the under-title base case, which `_rebuildContentRow` reproduces.
- `setGlyph` / `setDescription` (called in the late-dispatch block) now end with `_rebuildContentRow()` instead of their ad-hoc `insertComponent` / `addComponent` calls (see *Ordered Implementation Steps*). The end-of-constructor `recomputePreferredSize()` runs `_syncGlyphSize` once children + glyph exist and the component can resolve the line height post-attach (or it re-runs on first theme/layout pass).

`setGlyph` ([Button.ts:530-547](../src/typescript/lib/component/button/Button.ts#L530)) — replace the body's `this._content.insertComponent(glyph, 0)` with: create `_glyph`, reset `_glyphSyncedSize = null` (a fresh glyph hasn't been synced), then `this._rebuildContentRow()`, then `recomputePreferredSize()` (which calls `_syncGlyphSize`). `clearGlyph` ([Button.ts:554-563](../src/typescript/lib/component/button/Button.ts#L554)) — after detaching/nulling `_glyph`, set `_glyphSyncedSize = null`, call `_rebuildContentRow()` + `recomputePreferredSize()`.

`setDescription` ([Button.ts:440-457](../src/typescript/lib/component/button/Button.ts#L440)) — create+style `_description` lazily as today (it must exist for the tooltip even when `showDescription` is false) but **do not** add it to `_titleColumn` inline; instead set its text, then `_rebuildContentRow()` (which parents it only when `showDescription` is true), `_rebuildTooltip()`, `recomputePreferredSize()`. `clearDescription` ([Button.ts:477-487](../src/typescript/lib/component/button/Button.ts#L477)) — null `_description`, then `_rebuildContentRow()` + tooltip + recompute.

`setShowDescription` / `isShowDescription` — `setShowDescription(value)` writes `this._options.showDescription = value`, then `_rebuildContentRow()` + `recomputePreferredSize()` (no tooltip call — the tooltip is unaffected by this flag). `isShowDescription()` returns `this._options.showDescription ?? true`.

**Tooltip per-line height** ([Tooltip.ts](../src/typescript/lib/core/Tooltip.ts)) — replace the fixed `ITEM_HEIGHT` per-line multiplier with a resolved per-line height, cached for `doLayout`:

```typescript
// New private field, alongside _lineCount.
private _perLine: number = Tooltip.ITEM_HEIGHT;

// Resolved at hover time (show()), so it tracks the live theme line-height.
private _perLineHeight(): number {
    // measureTextMetrics runs at hover time (not construction) → allowed.
    const { height } = Util.measureTextMetrics("X", {
        // match the tooltip _text: default 14px font, theme line-height var.
        lineHeight: "var(--ts-ui-line-height, 1.2)",
    });
    return Math.ceil(height);
}

// In show(), after computing `lines`:
this._perLine = this._perLineHeight();
let tooltipHeight = lines.length * this._perLine + Tooltip.V_PADDING;
if (lines.length === 1) {
    // Keep the just-shipped single-line box pixel-stable.
    tooltipHeight = Math.max(tooltipHeight, Tooltip.ITEM_HEIGHT + Tooltip.V_PADDING);
}

// In doLayout(), replace `_lineCount * ITEM_HEIGHT`:
this._text.setHeight(this._lineCount * this._perLine);
```

`ITEM_HEIGHT` stays defined as the single-line floor; only the per-line multiplier for multi-line tooltips changes. Confirm `measureTextMetrics`'s options accept `lineHeight` as a CSS string (it does — `Text.calculateSize` passes `this._lineHeightCSSRule` through the same call, [Text.ts:341](../src/typescript/lib/component/input/Text.ts#L341)); if a font-size must be passed to match the tooltip text exactly, supply the same default the tooltip `Text` uses (14 px).

---

## Ordered Implementation Steps

**Commit A — Button content-row work (alignment + visibility + glyph sizing):**

1. **Option fields.** Add `descriptionUnderGlyph?: boolean` and `showDescription?: boolean` (each with JSDoc) to `ButtonOptions` ([Button.ts:43](../src/typescript/lib/component/button/Button.ts#L43)).
2. **Pure-write in `applyOptions`.** In the pure-write block ([Button.ts:352-354](../src/typescript/lib/component/button/Button.ts#L352)) add `if (opts.descriptionUnderGlyph !== undefined) this._options.descriptionUnderGlyph = opts.descriptionUnderGlyph;` and `if (opts.showDescription !== undefined) this._options.showDescription = opts.showDescription;`. No setter dispatch here. → verify: no new class field, so no `declare` needed (cross-check against the cascade-trap doc at [Button.ts:179-197](../src/typescript/lib/component/button/Button.ts#L179)).
3. **Backing fields.** Add `private _outerColumn: Component | null = null;`, `private _innerRow: Component | null = null;` (JSDoc: under-glyph-only, not part of the subclass contract) and `private _glyphSyncedSize: number | null = null;` (JSDoc: px `_syncGlyphSize` last wrote; the per-glyph opt-out guard).
4. **`_rebuildContentRow` + helpers.** Add `_isDescriptionUnderGlyph`, `_isShowDescription`, `_detach`, `_rebuildContentRow` per *Internal Structure*. The rebuild consults `_isShowDescription()` — when false it builds the minimal tree without `_description` (kept alive, detached). → verify: method is parent-aware (reads `getParentComponent`) and re-callable.
5. **`_syncGlyphSize`.** Add `_syncGlyphSize()` per *Internal Structure* (reads `_text.getLineHeight()`, equality-guarded `setPreferredSize`). Call it from the top of `recomputePreferredSize` ([Button.ts:820](../src/typescript/lib/component/button/Button.ts#L820)), above the `_consumerSetPreferredSize` early-return. → verify: no `getElement(true)` / `getBoundingClientRect` is called at construction time — `getLineHeight()` returns the cached resolved value or null, and the call site is the already-deferred `recomputePreferredSize`.
6. **Route `setGlyph` / `clearGlyph` through the rebuild.** Replace `setGlyph`'s `this._content.insertComponent(glyph, 0)` with `this._glyphSyncedSize = null; this._rebuildContentRow();`; have `clearGlyph` set `_glyphSyncedSize = null` and call `_rebuildContentRow()` after nulling `_glyph`. Keep the existing `recomputePreferredSize()` calls (now also the glyph-size sync point).
7. **Route `setDescription` / `clearDescription` through the rebuild.** Remove the inline `this._titleColumn.addComponent(this._description)` / `removeComponent` from `setDescription`/`clearDescription`; call `_rebuildContentRow()` instead. `_description` is still lazily created in `setDescription` so the tooltip can read it even when `showDescription` is false. Keep `_rebuildTooltip()` + `recomputePreferredSize()`.
8. **Mode setters/getters.** Add `setDescriptionUnderGlyph(value)` (writes `_options.descriptionUnderGlyph`, then `_rebuildContentRow()` + `recomputePreferredSize()`) / `isDescriptionUnderGlyph()` (`?? true`), and `setShowDescription(value)` (writes `_options.showDescription`, then `_rebuildContentRow()` + `recomputePreferredSize()` — no tooltip call) / `isShowDescription()` (`?? true`). Place near `setEnabled` / `isEnabled` for parity.
9. **Constructor sanity.** Confirm the constructor's existing `setText`→`setGlyph`→`setDescription` dispatch still yields a correct tree and a line-height-matched glyph: `setGlyph` and `setDescription` each call `_rebuildContentRow`; the end-of-constructor `recomputePreferredSize` runs `_syncGlyphSize`. → verify by tracing: `{text, glyph, description}` default → after `setGlyph` rebuild (no description yet → under-title `[glyph,_titleColumn[_text]]`), after `setDescription` rebuild (glyph+desc+default true → under-glyph `[outer[inner[glyph,_text],desc]]`), then glyph sized to the title line box on recompute. Also trace `{text, glyph, description, showDescription: false}` → minimal `[glyph,_titleColumn[_text]]`, `_description` alive + parentless, tooltip = `{title}\n\n{description}`.
10. **Subclass opt-out trace.** Confirm `SpinButton` ([SpinButton.ts:104](../src/typescript/lib/component/input/SpinButton.ts#L104)) and `Tab` close-glyph ([Tab.ts:813-816](../src/typescript/lib/layout/Tab.ts#L813)) still end up at their explicit glyph sizes: their `setPreferredSize(8,8)` / `setPreferredSize(CLOSE_GLYPH_SIZE…)` run after super's recompute, leaving `current != _glyphSyncedSize`, so a later theme toggle's `_syncGlyphSize` skips them.
11. **Demo.** In [`MiscPanel.ts`](../src/typescript/MiscPanel.ts) leave the "Save document" button as-is ([MiscPanel.ts:461-466](../src/typescript/MiscPanel.ts#L461)) (now shows the default under-glyph layout + line-height-matched glyph for free). Directly below it add a "Cancel" button with `glyph: "xmark"` (already imported+registered, [MiscPanel.ts:70,79](../src/typescript/MiscPanel.ts#L70)), a description, and `descriptionUnderGlyph: false`; `leftColumn.addComponent(...)`. Optionally add a third button with a description and `showDescription: false` (subtitle only on hover) to demo the visibility flag — keep it minimal.
12. **Docs.** Update [`docs/components/Button.md`](../docs/components/Button.md) Description/subtitle section (lines 16-28) per *Documentation Impact*: the new `descriptionUnderGlyph` and `showDescription` options **and** a one-line note that a leading glyph is auto-sized to match the title's line height.
13. **Regression checkpoints.** `npm run build` → 0 errors. `grep -n "insertComponent\|addComponent" src/typescript/lib/component/button/Button.ts` → only inside `_rebuildContentRow` and the unchanged constructor base build. Visual smoke (below) across plain glyph buttons + the subclasses.

**Commit B — Tooltip multiline trailing-gap fix (independent):**

14. **Per-line height field + helper.** In [`Tooltip.ts`](../src/typescript/lib/core/Tooltip.ts) add `private _perLine: number = Tooltip.ITEM_HEIGHT;` (alongside `_lineCount`, [Tooltip.ts:87](../src/typescript/lib/core/Tooltip.ts#L87)) and a private `_perLineHeight()` per *Internal Structure* that measures the resolved line height via `Util.measureTextMetrics`.
15. **Resolve per-line height in `show()`.** After computing `lines` ([Tooltip.ts:148-157](../src/typescript/lib/core/Tooltip.ts#L148)), set `this._perLine = this._perLineHeight()`, change `tooltipHeight` to `lines.length * this._perLine + Tooltip.V_PADDING`, and floor the single-line case to `ITEM_HEIGHT + V_PADDING`. → verify: a 1-line tooltip's height is unchanged from today.
16. **Use per-line height in `doLayout()`.** Replace `this._lineCount * Tooltip.ITEM_HEIGHT` ([Tooltip.ts:445](../src/typescript/lib/core/Tooltip.ts#L445)) with `this._lineCount * this._perLine`.
17. **Regression checkpoint.** `npm run build` → 0 errors. Hover a multiline tooltip (the demo button's title+description) → no trailing empty line; hover a single-line tooltip → unchanged.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/button/Button.ts` |
| Modify | `src/typescript/lib/core/Tooltip.ts` |
| Modify | `src/typescript/MiscPanel.ts` |
| Modify | `docs/components/Button.md` |

---

## Verification

- **Typecheck/build:** `npm run build` — 0 errors.
- **No-description content-row invariant:** construct `new Button("OK")`, `new Button({ glyph: "xmark" })`, and a MenuBarButton; confirm `_content`'s children are exactly `[_titleColumn]` / `[glyph, _titleColumn]` and `_outerColumn` / `_innerRow` stay `null` (content-row subclasses unaffected). MenuBarButton's `getLayoutManager() as HBox` still resolves.
- **Default under-glyph:** the demo "Save document" (glyph + description, no flag) renders the description full-width below the glyph+title row, left edge under the glyph.
- **Opt-in under-title:** the new "Cancel" (`descriptionUnderGlyph: false`) renders the description indented under the title, beside the glyph — the two buttons stack to show both alignments.
- **Description hidden on face, shown in tooltip (`showDescription: false`):** a button with `{ text, description, showDescription: false }` renders glyph+title only (no subtitle on the face), `_content`'s subtree has no `_description`, but hovering shows the `{title}\n\n{description}` tooltip. Flipping `setShowDescription(true)` re-parents the live `_description` into the tree (no console error); flipping back to `false` removes it again — proves the detach/re-attach path for the visibility flag.
- **Flag interaction:** with `showDescription: false`, toggling `setDescriptionUnderGlyph(true/false)` produces no visible on-button change (minimal tree either way) and no error.
- **Runtime flip:** `setDescriptionUnderGlyph(false)` then `(true)` on a glyph+description button toggles the topology with no console error (proves the detach-before-add reparent is correct and `_rebuildContentRow` is idempotent).
- **Sizing:** both modes report a preferred size that includes the description (parent layout doesn't clip the subtitle); under-glyph `_content` (single VBox child) sizes to the VBox.
- **Glyph line-height match (manual visual):**
  - On the MiscPanel demo "Save document" and "Cancel" buttons, the leading glyph's box height visually equals the **title line beside it** (no longer the old 16 px overhang). Eyeball at default zoom.
  - **Theme toggle:** switch ModernTheme ↔ another theme (or change `--ts-ui-button-font-size` / `--ts-ui-line-height`) and confirm the glyph re-sizes to track the new title line height (proves the `ThemeManager.onThemeChange` → `recomputePreferredSize` → `_syncGlyphSize` path).
  - **MenuBarButton:** a menubar button with a glyph shows the glyph matched to its label line, not overgrown.
  - **Tab tab-button / close glyph:** the close ✕ stays at its explicit `CLOSE_GLYPH_SIZE` (Tab pins it) and a SpinButton chevron stays at 8 px — confirm a theme toggle does **not** grow either to the title line height (proves the equality opt-out guard).
- **Tooltip attachment:** title+description tooltip still attaches in all modes including `showDescription: false`.
- **Tooltip trailing gap (manual visual):**
  - Hover a **multiline** tooltip (any glyph+description button → `{title}\n\n{description}`) and confirm the box hugs the text with **no trailing empty line** at the bottom (the ~3 px/line over-allocation is gone).
  - Hover a **single-line** tooltip (a plain `Tooltip.attach(c, "Hello")` / a button with title only) and confirm its box is **pixel-identical** to the just-shipped behavior (the `ITEM_HEIGHT + V_PADDING` floor preserves it).
  - **Theme toggle:** change `--ts-ui-line-height` (or switch themes) and re-hover a multiline tooltip — the per-line height tracks the new value (proves `_perLineHeight` is resolved at hover time, not cached stale).
- **Docs:** `npm run docs:build` — 0 errors, 0 link warnings (the typedoc "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

New consumer-visible API: `ButtonOptions.descriptionUnderGlyph`, `ButtonOptions.showDescription`, `Button.setDescriptionUnderGlyph` / `isDescriptionUnderGlyph`, `Button.setShowDescription` / `isShowDescription`. The glyph line-height match is internal behaviour (no new public symbol) but is consumer-visible rendering, so it gets a one-line mention. The Tooltip trailing-gap fix is an internal bug fix (no public symbol changes) and needs **no doc update**.

- **Barrel:** `Button` / `ButtonOptions` are already exported from [`src/typescript/lib/component/button/index.ts`](../src/typescript/lib/component/button/index.ts); the new methods + option surface automatically via the existing `@category Components` JSDoc. **No barrel edit.** `Tooltip` is already exported and unchanged in surface.
- **Curated page:** update the **Description / subtitle** section of [`docs/components/Button.md`](../docs/components/Button.md#L16):
  - `descriptionUnderGlyph` (default `true` = full-width below the glyph; `false` = indented under the title), note it only matters with a glyph + a description, show both forms, and state the default flip from the prior shipped behavior.
  - `showDescription` (default `true` = description shown on the button face; `false` = description hidden on the face but still shown in the hover tooltip), note that with `false` the `descriptionUnderGlyph` flag has no visible effect.
  - A sentence noting that a leading glyph is auto-sized to match the title's line height (and that a consumer or subclass can override by sizing the glyph explicitly via `getGlyph().setPreferredSize(...)`).
- **Catalog/sidebar:** Button page already exists in [`docs/components/index.md`](../docs/components/index.md) and the sidebar — no new page, no sidebar change.
- **Generated API pages** (`docs/api/component/button/...`) regenerate from typedoc on `npm run docs:build` — do not hand-edit.

---

## Potential Challenges

- **Reparent throws on stale parent.** `add/insertComponent` throw when the child still has a parent — mitigated by the mandatory detach pass at the top of `_rebuildContentRow` (reads each child's live `getParentComponent`).
- **DOM churn on no-op rebuilds.** `_rebuildContentRow` detaches and re-attaches even when nothing changed (e.g. `setDescriptionUnderGlyph` with the same value). Mitigation: it's rare/runtime-only and the churn is a handful of nodes; the hot path (`setText`) never calls the rebuild.
- **Inner HBox spacing.** The lazy `_innerRow` uses `spacing: 2` to match `_content`'s default glyph-text gap; MenuBarButton's spacing-4 override only touches `_content` and never builds `_innerRow`.
- **`removeComponent` detaches the element.** It calls `removeElement()`; re-adding re-attaches a fresh element — confirmed harmless against [Component.ts:3464-3472](../src/typescript/lib/core/Component.ts#L3464).
- **Glyph sizing is the wrong-lever trap.** `Glyph.setFontSize` does **not** resize an SVG glyph's box — sizing must go through `setPreferredSize`. Mitigated by choosing `setPreferredSize` and documenting why the font-size/CSS-var route was rejected (*Architecture Decisions › Glyph line-height matching*).
- **Construction-time measurement ban.** `_text.getLineHeight()` resolves via `getComputedStyle` + measurement. Mitigated by calling `_syncGlyphSize` only from `recomputePreferredSize` (already deferred to end-of-constructor + theme change), and bailing when `getLineHeight()` returns `null` (not yet resolved) so no 0/NaN size is written before first measure.
- **All-glyph-buttons behavioral change (verify visually).** Every plain glyph button's glyph shrinks from 16 px to ≈14 px (title line box) at the ModernTheme default. This is intended (the point of the change) but is a real visual delta on MenuBarButton, PickerButton triggers, ToggleButton, AccordionHeader, and any consumer glyph button — the implementer must eyeball these, and the user must confirm the smaller glyph reads correctly, before declaring done.
- **Subclass / consumer glyph-size opt-out.** `SpinButton` (8 px) and `Tab` close-glyph (`CLOSE_GLYPH_SIZE`) pin their glyph after super's recompute, so they win at construction; the equality guard in `_syncGlyphSize` (`current != _glyphSyncedSize → skip`) keeps them from being overwritten on a later theme toggle. The guard is the one piece of new bookkeeping — verify with the theme-toggle check that neither grows to the title line height.
- **`recomputePreferredSize` placement of `_syncGlyphSize`.** Putting it **above** the `_consumerSetPreferredSize` early-return is deliberate so the glyph match applies even when the button's own size is pinned; confirm this is the intended behaviour with the user if a pinned-size glyph button should instead keep its 16 px glyph.
- **`showDescription` false but `_description` must outlive the tree.** The instance is detached (parentless) but never nulled while a description string is set, so the tooltip still composes it. Mitigation: `_rebuildContentRow` only *parents* `_description`; `setDescription`/`clearDescription` own its lifecycle, and `_rebuildTooltip` reads it directly regardless of parentage.
- **Tooltip per-line measurement at hover.** `_perLineHeight` calls `Util.measureTextMetrics` on every `show()`. Mitigated: `show()` runs at hover time (not construction), measurement of a single `"X"` is cheap, and resolving live keeps it theme-reactive without a cached stale value or an extra listener.
- **Single-line tooltip regression risk.** Switching the per-line multiplier from 20 to ~16.8 would shrink the just-shipped single-line box. Mitigated by flooring the 1-line case to `ITEM_HEIGHT + V_PADDING`, keeping single-line tooltips pixel-stable; only multi-line tooltips lose the trailing gap.
- **`measureTextMetrics` line-height option shape.** Confirm it accepts a CSS `var(...)` string for `lineHeight` (it does — `Text.calculateSize` passes `_lineHeightCSSRule` the same way, [Text.ts:341](../src/typescript/lib/component/input/Text.ts#L341)); if the resolved height must match the tooltip text exactly, pass the same 14 px font-size the tooltip `Text` defaults to ([Text.ts:63](../src/typescript/lib/component/input/Text.ts#L63)).

---

## Critical Files

- [`src/typescript/lib/component/button/Button.ts`](../src/typescript/lib/component/button/Button.ts) — content-row build, `applyOptions` pure-write block, `setGlyph`/`setDescription`/`clear*`, `recomputePreferredSize`/`computePreferredSize`, the title's `setFontSize("--ts-ui-button-font-size")` ([Button.ts:291](../src/typescript/lib/component/button/Button.ts#L291)), the cascade-trap docs.
- [`src/typescript/lib/component/display/Glyph.ts`](../src/typescript/lib/component/display/Glyph.ts#L280) — `setPreferredSize` (pins min=pref=max), `setFontSize` (number-only, no-op for SVG box), the 16×16 default; confirms `setPreferredSize` is the box-sizing lever.
- [`src/typescript/lib/component/input/Text.ts`](../src/typescript/lib/component/input/Text.ts#L797) — `getLineHeight()` returns `_options.lineHeight ?? _defaultOptions.lineHeight ?? null` (the latter resolved lazily on first `calculateSize`, [Text.ts:315-317](../src/typescript/lib/component/input/Text.ts#L315)) / `readThemeLineHeightPx()` (`fontSize * multiplier`, [Text.ts:252-265](../src/typescript/lib/component/input/Text.ts#L252)), `setFontSize` string-token binding, `--ts-ui-line-height` default rule, default font-size 14 ([Text.ts:63](../src/typescript/lib/component/input/Text.ts#L63)).
- [`src/typescript/lib/core/Tooltip.ts`](../src/typescript/lib/core/Tooltip.ts) — `show()` height computation ([Tooltip.ts:148-160](../src/typescript/lib/core/Tooltip.ts#L148)), `doLayout()` label height ([Tooltip.ts:439-448](../src/typescript/lib/core/Tooltip.ts#L439)), `_lineCount` ([Tooltip.ts:87](../src/typescript/lib/core/Tooltip.ts#L87)), `ITEM_HEIGHT = 20` / `V_PADDING = 8` ([Tooltip.ts:76-78](../src/typescript/lib/core/Tooltip.ts#L76)), the default `Text` child ([Tooltip.ts:105-112](../src/typescript/lib/core/Tooltip.ts#L105)) — the trailing-gap fix site.
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts#L3444) — `addComponent`/`insertComponent`/`removeComponent`/`getParentComponent` parent-throw + early-return semantics that make the reparent rebuild correct.
- [`src/typescript/lib/layout/HBox.ts`](../src/typescript/lib/layout/HBox.ts#L208) — single-child preferred sizing that lets `_content` size to the outer VBox.
- [`src/typescript/lib/component/menubar/MenuBarButton.ts`](../src/typescript/lib/component/menubar/MenuBarButton.ts#L106) — the one subclass reading `_content.getLayoutManager()` as HBox; the content-row safety case to preserve.
- [`src/typescript/lib/component/input/SpinButton.ts`](../src/typescript/lib/component/input/SpinButton.ts#L104) & [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts#L813) — explicit glyph sizing that must opt out of the line-height match.
- [`plans/implemented/button-description-and-tooltip.md`](implemented/button-description-and-tooltip.md) — the feature this extends.

---

## Non-Goals

- **Theme tokens / CSS for the alignment.** Pure topology; no styling change, no new token.
- **A dedicated glyph-line-height theme token.** The glyph reuses the title's existing `--ts-ui-button-font-size` × `--ts-ui-line-height` product via `_text.getLineHeight()`; no new token is introduced.
- **Description support on the glyph-only subclasses.** None request a subtitle; the flag is available but unused there.
- **Changing SpinButton / Tab close-glyph sizes.** They keep their explicit sizes via the opt-out guard; this plan does not retune them.
- **A diffing rebuild that avoids DOM churn.** The full detach-rebuild is simpler and correct; the rebuild is off the hot path.
- **Changing the under-title indentation amount or the description's text-align.** Out of scope; both modes reuse the existing `_description` styling.
- **A separate "tooltip only" description field or auto-truncation.** `showDescription` simply gates the on-button render of the existing `description`; it does not add a distinct tooltip-only text or any truncation of the on-button subtitle.
- **Reworking the tooltip's width sizing or `H_PADDING` / `MAX_WIDTH`.** The trailing-gap fix only corrects the **vertical** per-line height; horizontal sizing is unchanged.
- **A theme token for tooltip line height.** The tooltip reuses the live `--ts-ui-line-height` via a hover-time measurement; no new token.
