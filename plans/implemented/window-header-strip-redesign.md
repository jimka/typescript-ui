# Window Header Strip Redesign — Implementation Plan

## Overview

Redesign the [`WindowHeader`](../src/typescript/lib/component/container/WindowHeader.ts) so its trailing control buttons (minimize / maximize / close) and leading title glyph render correctly under the per-region clip frame that now contains every non-collapsible [`Border`](../src/typescript/lib/layout/Border.ts) region. The header today builds a 24×24 control box (a 14px glyph inflated by symmetric `Insets(4,4,4,4)`, [WindowHeader.ts:107-113](../src/typescript/lib/component/container/WindowHeader.ts#L107)) sitting in a **non-stretching** trailing `HBox` and relies on that 24px box **overflowing** the header's ~18px content band to bleed a couple of pixels past the header's bottom edge into the CENTER content panel — the wanted "merged" look. The redesign replaces overflow-and-bleed with **fill-the-band**: the header gets an explicit, text-driven chrome thickness (an explicit preferred height) with **zero vertical insets** so its internal Border regions span the full header height, and the controls **stretch** to that height (the TabWindow strip mechanism) so they are fully contained by the clip frame, reach the bottom edge, and meet the content panel structurally. The title glyph + text are vertically centred via a `Fit({ fill: FillType.HORIZONTAL })` wrapper (the framework's native centering primitive), fixing a pre-existing top-align symptom.

**Root cause (verified).** Commit b332e4d2 (the [border-region-clip-frames](implemented/border-region-clip-frames.md) feature, in master) wraps each non-collapsible Border region in an `overflow: hidden` clip frame sized to the region's allocated rect ([Component.setClipFrame Component.ts:629](../src/typescript/lib/core/Component.ts#L629); Border drives it for EAST at [Border.ts:1075](../src/typescript/lib/layout/Border.ts#L1075), WEST at [Border.ts:1033](../src/typescript/lib/layout/Border.ts#L1033), NORTH at [Border.ts:931](../src/typescript/lib/layout/Border.ts#L931)). The header is a Border whose interior has **no NORTH/SOUTH**, only a WEST title row and an EAST controls row, so `middleY = 0` and `middleHeight = container.getInnerSize().height` ([Border.ts:843](../src/typescript/lib/layout/Border.ts#L843), [Border.ts:944](../src/typescript/lib/layout/Border.ts#L944)) — i.e. the header's **inner** height (full height minus the symmetric `Insets(4,4,4,4)` top+bottom = full − 8 ≈ 18px). The EAST controls region is therefore framed to an 18px band ([Border.ts:1075](../src/typescript/lib/layout/Border.ts#L1075)); the 24px controls overflow it and are clipped on the south edge — they no longer touch the content panel. Empirically (DevTools): header y181 h26; title glyph/text y185 h14; controls h24 → bottom y209, clipped to the band. This is a clip-frames-branch consequence, **not** a regression from the centralize-size-aggregation / scroll-cache branches.

Scope is confined to `WindowHeader` (and a one-token reuse of the new scale plan, decided below); the base [`Header`](../src/typescript/lib/component/display/Header.ts) is **not** changed (see scope decision). Read the related implemented plans for context and to avoid redoing their work: [window-chrome-alignment](implemented/window-chrome-alignment.md) (the `windowControls.ts` factory + the `Insets(4,4,4,4)` decision this plan now revisits), [window-tab-header](implemented/window-tab-header.md) (the `AbstractWindow`/`TabWindow` split and the stretching-tool strip model that is the reference), [tabwindow-leading-glyph](implemented/tabwindow-leading-glyph.md) (the TabWindow leading glyph centred in the strip), and [border-region-clip-frames](implemented/border-region-clip-frames.md) (the clip frame this must compose with, not fight).

---

## Architecture Decisions

### Fill the band, do not overflow it — adopt the TabWindow strip model

The design decision is settled: converge `WindowHeader` on the TabWindow strip model. A [`TabWindow`](../src/typescript/lib/core/TabWindow.ts) adds its controls as tools to its `TabBar` strip, which **stretches** them to the full strip thickness; they fill their region (fully contained by any clip) and reach the content edge. `WindowHeader` instead inflates via symmetric insets and **overflows** its band — the very pattern the constructor comment admits ([WindowHeader.ts:98-106](../src/typescript/lib/component/container/WindowHeader.ts#L98)). The clip frame kills overflow but leaves stretch intact. So the redesign:

1. gives the header an **explicit, text-driven chrome thickness** (an explicit preferred height) with **zero vertical insets** so the internal Border band spans the full header height and reaches the bottom edge where the content panel begins;
2. makes the **controls stretch** to fill that band — contained inside the clip frame, so the frame becomes a no-op (no fight with the clip-frames feature, no per-region opt-out);
3. **vertically centres** the title glyph + text in the thickness with a `Fit({ fill: FillType.HORIZONTAL })` wrapper, the same chrome-geometry centering the tab strip uses for its leading glyph.

This is the stated intent of commit c491751a ("Align the ordinary Window header chrome with the TabWindow"): both header kinds end on the same strip model, both visual symptoms resolve, and it composes WITH the clip frames.

### Thickness via an explicit text-driven preferred height + zero vertical insets (NOT a hard dependency on base-size-ratio-scaling)

The header needs a thickness tall enough for the ~24px control box, but its band must span the **full** header height so stretched controls reach the bottom edge — which rules out using vertical insets to add thickness (an inset shrinks the band away from the edge; see *Reaching the content edge*). **Decision: drive thickness through an explicit, text-relative preferred HEIGHT, and zero the vertical insets** (`Insets(0, 4, 0, 4)` — horizontal padding only).

`Header.updatePreferredSize` computes height as `textHeight + insets.top + insets.bottom` and stores it via `setPreferredSize(100, preferredHeight)` ([Header.ts:167-176](../src/typescript/lib/component/display/Header.ts#L167)). With the vertical insets now `0`, that derivation would collapse the header to the bare text height (~14px) — too short for the control box. So `WindowHeader` must set its preferred height to a **chrome thickness** that accommodates the control box: `thickness = textHeight + 2 * chromeMargin`, where `chromeMargin` is the equal top/bottom gap that surrounds the text line (and the control box) inside the band. This stays text-driven — it grows with the font — and is NOT a hardcoded constant; only `chromeMargin` is a small documented constant, finalized by measurement (Step 7) so the full-height band equals/exceeds the ~24px control box.

Cleanest expression (decided in Step 6): `WindowHeader` computes `thickness` from its measured text height plus `2 * chromeMargin` and calls `setPreferredSize(100, thickness)` directly, keeping the base `Header` untouched. If reusing `Header`'s own derivation is cleaner, the fallback is to promote `Header.updatePreferredSize` from `private` to `protected` and override the chrome term — flagged as the sole permitted base edit (already discussed). Prefer the no-base-edit path.

The just-written [base-size-ratio-scaling](base-size-ratio-scaling.md) plan introduces a font-relative scale surface (`resolveScaleToken` / `readBaseSizePx`, a `--ts-ui-base-size` knob) and names `WindowHeader`'s `LEAD_GLYPH_INK_SIZE` as a migration target. **Decision: do NOT depend on it.** `base-size-ratio-scaling` is **not** set as `depends-on` in frontmatter. When it lands it can migrate `LEAD_GLYPH_INK_SIZE` and express `chromeMargin` as a ratio token; that is a follow-up (Non-Goals), not a blocker. Rationale: a hard dependency would block this bug fix on an unrelated scaling surface; the self-contained text-driven thickness is correct on its own and forward-compatible.

Because the thickness and zeroed insets live in `WindowHeader` only, the base `Header` (and Dialog / Drawer / Accordion / Table headers — see scope decision) keep their `4/4` insets unchanged.

### Controls row stretches to fill the band

The trailing controls row is a plain `HBox` built `stretching: false` (preferred mode) today ([WindowHeader.ts:116](../src/typescript/lib/component/container/WindowHeader.ts#L116)). In preferred mode `HBox.layoutPreferredMode` places the child row block at `insets.getTop()` and only baseline-offsets each child ([HBox.ts:465-475](../src/typescript/lib/layout/HBox.ts#L465)); a 24px control in a taller band sits at the top. When `stretching: true`, every child's height is set to the row height (`containerSize.height`, [HBox.ts:441-445](../src/typescript/lib/layout/HBox.ts#L441)) and baseline alignment is disabled ([HBox.ts:461-463](../src/typescript/lib/layout/HBox.ts#L461)). The title row keeps `stretching: false` and is centred by its `Fit` wrapper instead (see Title centering).

**Decision: build the trailing controls row with `stretching: true`** so each control fills the band height (the TabWindow mechanism) and meets the bottom edge. The control `Button`s drop their symmetric `Insets(4,4,4,4)` inflation (the overflow trick) in favour of the compact `Insets(0,4,0,4)` the TabWindow tools use ([window-chrome-alignment.md decision](implemented/window-chrome-alignment.md), TabBar `computeToolButtonInsets`), since the stretch now supplies the height — the cross-axis `0` is fine because stretch fills it, and the width stays `glyph(14)+4+4+border = 24`. This removes the `for (const control … setInsets(new Insets(4,4,4,4)))` loop ([WindowHeader.ts:111-113](../src/typescript/lib/component/container/WindowHeader.ts#L111)).

### Title centering — a `Fit({ fill: FillType.HORIZONTAL })` wrapper, the framework's native centering primitive

The title glyph + text top-align because the title-row `HBox` blocks its content at the top inset inside the full-height WEST band. Since the band must stay full-height (so the controls fill it), the band cannot be shrunk to the text line — insets cannot both span the band for controls and centre a short line. The framework already has the right primitive: **`Fit`**.

- **`Fit` ([Fit.ts](../src/typescript/lib/layout/Fit.ts)) centres an unfilled axis.** Its `doLayout` (Fit.ts:244-291) delegates to `placeComponent` ([LayoutManager.ts:251](../src/typescript/lib/layout/LayoutManager.ts#L251)), which resolves via `resolveBounds` (LayoutManager.ts:278-397): an axis not covered by `fill` keeps the child's preferred extent and is displaced by the default `CENTER` anchor (vertical displace `(maxHeight - height) / 2`, LayoutManager.ts:373-394). The class doc (Fit.ts:17-26) states `fill: NONE` centres the child and `HORIZONTAL`/`VERTICAL` "stretch on one axis and centre on the other." So a `Fit({ fill: FillType.HORIZONTAL })` container **fills its width and vertically centres** its single child at the child's preferred height.
- **Decision: wrap the title content (leading glyph + text HBox) in a WEST-region container whose layout is `new Fit({ fill: FillType.HORIZONTAL })`.** The title HBox (preferred height ~14, the baseline-aligned glyph+text line) is then vertically centred in the full-height band while its content stays left-aligned and full-width. This is the same family of mechanism the TabBar uses for its leading glyph: `positionLeadGroup` ([TabBar.ts:2368](../src/typescript/lib/component/container/TabBar.ts#L2368)) stretches the lead-group box to the full strip thickness, and the lead-group's stretching HBox ([TabBar.ts:611](../src/typescript/lib/component/container/TabBar.ts#L611)) lays the hosted widget across that thickness so the glyph centres on the strip line — chrome geometry centres the icon, not insets.
- **A Border `AnchorType.CENTER` on the WEST region is IGNORED** for non-collapsible regions, so it cannot be used instead of `Fit`. The non-collapsible Border branch commits the WEST region via `commitBounds(west, 0, 0, westFullWidth, middleHeight)` ([Border.ts:1034](../src/typescript/lib/layout/Border.ts#L1034)), and `commitBounds` ([LayoutManager.ts:417](../src/typescript/lib/layout/LayoutManager.ts#L417)) writes the rect directly, **bypassing `resolveBounds`** — so the region's `AnchorType`/`FillType` constraints are not honoured for vertical centring. `Fit` works precisely because it is the WEST container's own *layout manager* (run inside `commitBounds(...).doLayout()`), centring the title content one level below the region commit, where `resolveBounds` does run.

The leading decorative glyph (pinned to `LEAD_GLYPH_INK_SIZE = 14`, [WindowHeader.ts:29](../src/typescript/lib/component/container/WindowHeader.ts#L29)) stays inside the inner title HBox, so it keeps its shared baseline with the text and is centred together with the line by the `Fit` wrapper.

### Reaching the content edge — zero vertical insets (band = full thickness) + stretch + flush NORTH placement

For controls (and the band) to meet the content panel, the header's **vertical insets are 0** (`Insets(0, 4, 0, 4)`): with `middleY = 0` and `middleHeight = inner height`, a zero bottom inset makes the EAST band span the full header height (a non-zero bottom inset `B` would end the band `B`px above the header bottom, leaving stretched controls `B`px short of the content — a gap). The controls stretch to fill that full-height band, so control bottom edge == band bottom edge == header bottom edge. The header is placed NORTH with `ignoreParentInsets: true` ([Window.ts:77-80](../src/typescript/lib/core/Window.ts#L77)), so `northY = 0` and the CENTER content begins at `middleY = northHeight` ([Border.ts:902](../src/typescript/lib/layout/Border.ts#L902), [Border.ts:906](../src/typescript/lib/layout/Border.ts#L906)) — flush against the header's bottom with no gap. So once the controls fill the header height, their bottom edge sits exactly at the content panel top — the merged look, restored **structurally** rather than by a 2px overflow bleed. The thickness needed for the ~24px control box comes from the explicit text-driven preferred height (see *Thickness*), not from the (now zero) vertical insets.

### Scope — `WindowHeader` only; the base `Header` is untouched

Enumeration (verified): the **only** importer of `~/component/display/Header.js` is `WindowHeader` ([WindowHeader.ts:3](../src/typescript/lib/component/container/WindowHeader.ts#L3)); `grep` for other importers returns none. `AccordionHeader extends Button` ([AccordionHeader.ts:28](../src/typescript/lib/component/container/AccordionHeader.ts#L28)), not `Header`. Dialog uses its own `DialogTitleBar extends Component` ([Dialog.ts:144](../src/typescript/lib/core/Dialog.ts#L144)), not `Header`. The table `Header` ([component/table/Header.ts](../src/typescript/lib/component/table/Header.ts)) is an unrelated class. **Decision: confine every change to `WindowHeader`.** Even though the display `Header` has no consumer besides `WindowHeader` today, overriding insets in the subclass (not editing `_defaultHeaderOptions`) keeps the base contract stable for any future `Header` consumer and matches the "surgical changes" rule. No base `Header` edit is needed or made.

### Clip frame becomes a no-op — proof method

After the redesign the controls fill the band (height == band height == frame height), so the EAST clip frame clips nothing. **Proof requirement:** `getBoundingClientRect` reports the **full** element rect even when the clip frame visually cuts it, so comparing the control's own rect before/after is not a clip proof. The proof compares the **control element's rect against its clip-frame wrapper's rect / overflow**: the wrapper (`overflow: hidden`, parked at the band rect, [Component.ts:642](../src/typescript/lib/core/Component.ts#L642)) must fully contain the control element — `controlRect.bottom <= wrapperRect.bottom` (within sub-pixel) — and the wrapper must have no clipped overflow (`scrollHeight <= clientHeight`). Verification asserts this against the EAST region's frame wrapper.

---

## Public API (TypeScript Signatures)

No public API changes. The redesign is internal to `WindowHeader`'s constructor and `setGlyph`:

- Trailing controls row built with `stretching: true` (an `HBoxOptions` flag, [HBox.ts:16-18](../src/typescript/lib/layout/HBox.ts#L16)) instead of the default.
- Control `Button` insets changed from `Insets(4,4,4,4)` to `Insets(0,4,0,4)` (the compact tool box).
- `WindowHeader` overrides its own `insets` to horizontal-only `Insets(0, 4, 0, 4)` (vertical insets are 0) and sets an explicit text-driven preferred height (`textHeight + 2 * CHROME_MARGIN`) for the chrome thickness.
- The title content is wrapped in a WEST-region container laid out by `new Fit({ fill: FillType.HORIZONTAL })` ([Fit.ts](../src/typescript/lib/layout/Fit.ts)) — `Fit` and `FillType` are existing exports (`FillType` is already imported in `WindowHeader`; add the `Fit` import).

No new exported symbol, no new typed setter, no new `XOptions` field, no new theme token. `getGlyph()` keeps returning `Glyph | null` (the leading glyph stays a plain `Glyph`, unchanged from the current implementation — [WindowHeader.ts:191-194](../src/typescript/lib/component/container/WindowHeader.ts#L191)).

---

## Internal Structure

### WindowHeader thickness + zero vertical insets (constructor)

```
// In WindowHeader constructor, after super(text):

// Horizontal padding only — vertical insets are 0 so the Border band spans the
// full header height and stretched controls reach the content edge.
this.setInsets(new Insets(0, 4, 0, 4));

// Thickness driven by the text height + a small symmetric chrome margin, NOT by
// insets (which are now 0) and NOT a hardcoded constant. Grows with the font.
const textHeight = this.getText().getPreferredSize()?.height ?? 14;
const thickness  = textHeight + 2 * CHROME_MARGIN;
this.setPreferredSize(100, thickness);   // see Step 6 for the cleanest access path
```

`CHROME_MARGIN` is the small documented constant chosen by measurement (Step 7) so the full-height band equals/exceeds the ~24px control box. It is the equal top/bottom gap around the text line and the control box.

### Title row — `Fit({ fill: FillType.HORIZONTAL })` wrapper

```
// Inner title content: glyph + text on one baseline-aligned line (today's row).
this._titleRow = new Component();
this._titleRow.setLayoutManager(new HBox({ spacing: 8 }));
this._titleRow.setInsets(new Insets(0, 0, 0, 5));   // leading corner offset (horizontal only)
this._titleRow.setPointerEvents("none");
this._titleRow.addComponent(title);                 // + leading glyph via setGlyph

// WEST-region wrapper: fills width, vertically centres the title line in the band.
const titleCell = new Component();
titleCell.setLayoutManager(new Fit({ fill: FillType.HORIZONTAL }));
titleCell.addComponent(this._titleRow);
this.addComponent(titleCell, { placement: Placement.WEST, anchor: AnchorType.WEST, fill: FillType.HORIZONTAL });
```

The `Fit` wrapper centres the ~14px title line in the full-height band (`placeComponent` → `resolveBounds` CENTER displacement on the unfilled vertical axis). The existing WEST region `AnchorType.CENTER` would NOT centre it — the non-collapsible Border commit bypasses `resolveBounds` (see Title centering decision) — which is exactly why a child-of-WEST `Fit` is used.

### Trailing controls row — stretch to fill the band (TabWindow mechanism)

```
this._trailingRow = new Component();
this._trailingRow.setLayoutManager(new HBox({ spacing: 0, stretching: true }));
this._trailingRow.setInsets(new Insets(0, 0, 0, 0));
// controls built via createWindowControlButton; insets -> Insets(0, 4, 0, 4)
```

`stretching: true` sizes each control to the band height; the compact `Insets(0,4,0,4)` only sets within-box padding (the stretch supplies the cross height, the width stays `glyph(14)+4+4 ≈ 24`).

---

## Ordered Implementation Steps

1. **Baseline capture (before).** With the dev server running (http://localhost:8015), open a glyph Window via the Misc panel "Show window with title glyph" button and a TabWindow tear-off from the Tab demo. Record, scoped to the right component class (`.Window .WindowHeader`): header rect, control rects, control clip-frame wrapper rect, and title glyph/text y. Capture in both modern and classic themes. This anchors the after-comparison and confirms the south-clip + top-align symptoms.

2. **`WindowHeader.ts` — zero the vertical insets.** In the constructor (after `super(text)`), call `this.setInsets(new Insets(0, 4, 0, 4))` so the Border band spans the full header height (horizontal padding only). → verify: `npm run typecheck` clean.

3. **`WindowHeader.ts` — set the text-driven thickness.** After zeroing the insets, set the explicit preferred height: `thickness = textHeight + 2 * CHROME_MARGIN` (provisional `CHROME_MARGIN = 5`; finalized in Step 7) so the full-height band equals/exceeds the ~24px control box. Use the cleanest access path settled in Step 6 (`setPreferredSize(100, thickness)` directly, or the promoted derivation). The thickness must grow with the text height — do NOT hardcode a px height.

4. **`WindowHeader.ts` — stretch the trailing controls row.** Change the trailing-row `HBox` to `new HBox({ spacing: 0, stretching: true })` ([WindowHeader.ts:116](../src/typescript/lib/component/container/WindowHeader.ts#L116)).

5. **`WindowHeader.ts` — compact the control insets.** Replace the `for (const control … control.setInsets(new Insets(4,4,4,4)))` loop ([WindowHeader.ts:111-113](../src/typescript/lib/component/container/WindowHeader.ts#L111)) with `control.setInsets(new Insets(0, 4, 0, 4))` (the stretch now supplies the height; the box stays 24 wide). Update the now-stale constructor comment ([WindowHeader.ts:98-106](../src/typescript/lib/component/container/WindowHeader.ts#L98)) to describe fill-the-band instead of overflow-the-band.

6. **`WindowHeader.ts` — wrap the title in a `Fit` cell.** Add the `Fit` import (`import { Fit } from "~/layout/Fit.js"`). Build a WEST-region container with `setLayoutManager(new Fit({ fill: FillType.HORIZONTAL }))`, add the existing title row (`HBox`, [WindowHeader.ts:84-90](../src/typescript/lib/component/container/WindowHeader.ts#L84)) into it, and add that cell to the WEST placement in place of the bare title row ([WindowHeader.ts:92-96](../src/typescript/lib/component/container/WindowHeader.ts#L92)). The title row stays `stretching: false`; its leading inset `Insets(0,0,0,5)` ([WindowHeader.ts:88](../src/typescript/lib/component/container/WindowHeader.ts#L88)) is unchanged (horizontal only). The `Fit` wrapper fills width and vertically centres the title line — do NOT use a WEST `AnchorType.CENTER` (ignored by the non-collapsible Border commit). → verify: typecheck clean.

7. **Thickness derivation access (override required).** `Header.updatePreferredSize` is `private`, stores via `setPreferredSize(100, textHeight + insets.top + insets.bottom)` ([Header.ts:167-176](../src/typescript/lib/component/display/Header.ts#L167)), and is called **both** at construction ([Header.ts:84-86](../src/typescript/lib/component/display/Header.ts#L84)) **and on every theme change** ([Header.ts:80-82](../src/typescript/lib/component/display/Header.ts#L80)). With `WindowHeader`'s zeroed vertical insets the base derivation yields `textHeight + 0`, so a plain `setPreferredSize` in the constructor body would be **clobbered back to the bare text height on the next theme switch** (the header collapses) — the no-base-edit path is unsafe. **Decision: promote `Header.updatePreferredSize` from `private` to `protected` and override it in `WindowHeader`** to compute `textHeight + 2 * CHROME_MARGIN`; the one override serves both the construction call and the theme-change call. The override reads only `this.getText().getPreferredSize()`, `CHROME_MARGIN` (module const), and `setPreferredSize` — no `WindowHeader` instance fields — so it is safe under the virtual-call-during-`super()` path. Flag the `private→protected` promotion in the commit. → verify: typecheck clean; header thickness survives a theme toggle.

8. **Measure + finalize `CHROME_MARGIN` (after).** Re-run Step 1's captures. Tune `CHROME_MARGIN` so: (a) every control's rect is fully inside its EAST clip-frame wrapper rect (control bottom ≤ wrapper bottom, no overflow); (b) the control bottom edge == the CENTER content panel top (merged, no gap, no overlap); (c) the `Fit`-wrapped title glyph+text line is vertically centred (equal top/bottom gap). Do this in **both** modern and classic themes (classic control boxes carry border/shadow from [WINDOW_CONTROL_STYLE_RULES windowControls.ts:19-23](../src/typescript/lib/core/windowControls.ts#L19), so the box size matters most there).

9. **Regression sweep.** `grep -n "Insets(4, 4, 4, 4)\|Insets(4,4,4,4)" src/typescript/lib/component/container/WindowHeader.ts` → expect 0 (the symmetric control inflation is gone). Confirm the base `Header` is untouched: `git diff --stat src/typescript/lib/component/display/Header.ts` shows only a possible `private→protected` change (or nothing). → verify: typecheck + the manual checks in Verification.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/container/WindowHeader.ts` |
| Modify (only if Step 7 requires it) | `src/typescript/lib/component/display/Header.ts` (`updatePreferredSize` `private` → `protected` — no behaviour change) |

No files created or deleted. No theme, no `TabWindow`, no `Window` change (the header is restyled in place; `Window` already routes focus through `WindowHeader.setActive` and glyph through `setGlyph`, both unchanged).

---

## Verification

Running-app before/after via Chrome DevTools MCP (app on http://localhost:8015). Open a header Window (Misc panel "Show window with title glyph", which builds `new Window("Settings", { glyph: "arrow-right" })`, [MiscPanel.ts:1028-1036](../src/typescript/MiscPanel.ts#L1028)) **and** a TabWindow tear-off from the Tab demo. Scope every query to the right class (`.Window .WindowHeader`, `.TabWindow`) — many same-type components coexist.

- **Typecheck:** `npm run typecheck` — 0 errors.
- **Controls fully visible (not south-clipped):** each control's rendered box is entirely within the header; no bottom edge is cut. Compare to the before capture where the control bottom (y209) exceeded the header bottom (y207) and was clipped to the band.
- **Clip frame cuts nothing (the load-bearing assertion):** because `getBoundingClientRect` reports full rects even when clipped, assert containment against the **clip-frame wrapper**: locate the EAST controls region's `overflow: hidden` wrapper (the clip frame), and confirm each control element's rect is within the wrapper's rect (`control.bottom <= wrapper.bottom`, sub-pixel) and the wrapper has no clipped overflow (`wrapper.scrollHeight <= wrapper.clientHeight`). The frame is a no-op.
- **Merged look (control bottom == content top):** the control box bottom edge equals the CENTER content panel's top edge (flush, no gap, no overlap) — the structural replacement for the old 2px overflow bleed.
- **Title centred:** the `Fit`-wrapped title glyph + text line is vertically centred in the header (equal top/bottom gap), not top-aligned, while staying left-aligned and full-width. The leading decorative glyph stays aligned with the title text.
- **Both themes:** repeat all of the above in **modern** and **classic** (toggle live). Classic raised controls (border + shadow) make the box size most visible; confirm the box fills the band cleanly with no clip and a flush bottom.
- **TabWindow parity:** the TabWindow tear-off's controls/leading glyph are unchanged (no edit to `TabWindow`); the header Window now matches the strip model side by side.
- **No regression to other headers:** Dialog (`DialogTitleBar`), Drawer, and Accordion (`AccordionHeader`) headers are visually unchanged — none consume the display `Header`, so the WindowHeader-scoped change cannot touch them. Spot-check each in both themes.
- **Behaviour preserved:** drag-move via the title, double-click-to-maximize (and not when double-clicking a control), minimize/maximize/close fire, and `closeable`/`minimizable`/`maximizable` still toggle the right controls.
- **Docs:** no public API change, so `npm run docs:build` is required **only if** Step 7 promotes `Header.updatePreferredSize` to `protected` (a visibility change typedoc surfaces) — in that case run it and expect 0 errors / 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning). Otherwise skip.

---

## Potential Challenges

- **Preferred height is set post-`super`.** `super()` already computed the height with the base `4/4` insets ([Header.ts:84-86](../src/typescript/lib/component/display/Header.ts#L84)); `WindowHeader`'s body must overwrite it with the new text-driven thickness. Mitigation: Step 7 — `WindowHeader` calls `setPreferredSize(100, thickness)` directly after zeroing the insets; only promote `updatePreferredSize` `private→protected` if reusing the base derivation is cleaner, and flag it.
- **`setInsets` after `super` and the setter-defer trap (MEMORY).** `WindowHeader` runs `setInsets` in its constructor body (post-`super`), which is safe (the element/layout exist after construction). Confirm `setInsets` schedules a layout so the zeroed insets take effect on first render.
- **Stretching disables baseline alignment in the controls row.** That is correct for the controls (they are icons, not text). The **title** row stays non-stretching so its glyph+text keep their shared baseline; the `Fit` wrapper centres that line. Don't stretch the title row, or the glyph/text baseline coupling is lost.
- **`CHROME_MARGIN` value is measurement-driven.** A guess that makes the band ≠ control box re-introduces either a clip (band < 24) or a gap (band > 24). Mitigation: Step 8 finalizes it against the live clip-frame wrapper in both themes.
- **Classic theme box size.** Classic controls add a 1px border + shadow ([windowControls.ts:20](../src/typescript/lib/core/windowControls.ts#L20)); the box is slightly larger than modern. Mitigation: tune `CHROME_MARGIN` against the classic box (the larger one) so neither theme clips.
- **AnchorType on the WEST region does not center.** The non-collapsible Border branch commits via `commitBounds` and bypasses `resolveBounds` ([Border.ts:1034](../src/typescript/lib/layout/Border.ts#L1034)), so a WEST `AnchorType.CENTER` is ignored. Do not rely on it — the `Fit({ fill: FillType.HORIZONTAL })` wrapper (run one level down, inside the WEST cell's own layout) is the centering mechanism.

---

## Critical Files

- [`src/typescript/lib/component/container/WindowHeader.ts`](../src/typescript/lib/component/container/WindowHeader.ts) — the only file changed: constructor insets (→ `Insets(0,4,0,4)`) + text-driven preferred height, the `Fit`-wrapped title cell, trailing-row `HBox` `stretching`, control insets ([107-122](../src/typescript/lib/component/container/WindowHeader.ts#L107)), title row ([83-96](../src/typescript/lib/component/container/WindowHeader.ts#L83)), `setGlyph` ([179-199](../src/typescript/lib/component/container/WindowHeader.ts#L179)), `LEAD_GLYPH_INK_SIZE` ([29](../src/typescript/lib/component/container/WindowHeader.ts#L29)).
- [`src/typescript/lib/layout/Fit.ts`](../src/typescript/lib/layout/Fit.ts) — the title-centering primitive: `FitOptions.fill` ([13-15](../src/typescript/lib/layout/Fit.ts#L13)), class doc on `HORIZONTAL` stretch-and-centre ([17-26](../src/typescript/lib/layout/Fit.ts#L17)), `doLayout` → `placeComponent` ([244-291](../src/typescript/lib/layout/Fit.ts#L244)).
- [`src/typescript/lib/component/display/Header.ts`](../src/typescript/lib/component/display/Header.ts) — base insets default ([35](../src/typescript/lib/component/display/Header.ts#L35)), `updatePreferredSize` ([167-176](../src/typescript/lib/component/display/Header.ts#L167)), post-construct height call ([84-86](../src/typescript/lib/component/display/Header.ts#L84)); confirms the WindowHeader-only scope.
- [`src/typescript/lib/layout/HBox.ts`](../src/typescript/lib/layout/HBox.ts) — `stretching` semantics ([16-18](../src/typescript/lib/layout/HBox.ts#L16)), `layoutPreferredMode` cross-height + top-align ([439-475](../src/typescript/lib/layout/HBox.ts#L439)), `rowChildY` baseline/centre ([580-590](../src/typescript/lib/layout/HBox.ts#L580)).
- [`src/typescript/lib/layout/Border.ts`](../src/typescript/lib/layout/Border.ts) — `middleY`/`middleHeight` ([906](../src/typescript/lib/layout/Border.ts#L906), [944](../src/typescript/lib/layout/Border.ts#L944)), WEST frame ([1033-1034](../src/typescript/lib/layout/Border.ts#L1033)), EAST frame ([1075-1076](../src/typescript/lib/layout/Border.ts#L1075)), `getInnerSize`/`getContentInsets` source ([843-851](../src/typescript/lib/layout/Border.ts#L843)).
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `setClipFrame` (the `overflow: hidden` wrapper the proof compares against, [629-660](../src/typescript/lib/core/Component.ts#L629)).
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — `placeComponent` ([251](../src/typescript/lib/layout/LayoutManager.ts#L251)) the entry `Fit` calls; `resolveBounds` fill/anchor displacement, incl. vertical CENTER displace ([278-396](../src/typescript/lib/layout/LayoutManager.ts#L278), [373-394](../src/typescript/lib/layout/LayoutManager.ts#L373)) — how `Fit({fill: HORIZONTAL})` centres vertically; `commitBounds` bypasses anchor ([417](../src/typescript/lib/layout/LayoutManager.ts#L417)) — why a WEST region anchor is ignored for non-collapsible regions.
- [`src/typescript/lib/core/windowControls.ts`](../src/typescript/lib/core/windowControls.ts) — the shared control factory + classic/modern style rules ([19-23](../src/typescript/lib/core/windowControls.ts#L19)).
- [`src/typescript/lib/core/Window.ts`](../src/typescript/lib/core/Window.ts) — NORTH header placement `ignoreParentInsets` ([77-80](../src/typescript/lib/core/Window.ts#L77)); confirms flush-against-CENTER.
- [`src/typescript/lib/core/TabWindow.ts`](../src/typescript/lib/core/TabWindow.ts) — the reference strip (stretching tools); unchanged.
- [`src/typescript/lib/component/container/TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts) — the analogous chrome-geometry centering: lead-group stretching HBox ([611](../src/typescript/lib/component/container/TabBar.ts#L611)) and `positionLeadGroup` ([2368](../src/typescript/lib/component/container/TabBar.ts#L2368)) box the leading glyph across the strip thickness and centre it — the same family as the header's `Fit` wrapper; unchanged.
- [`plans/base-size-ratio-scaling.md`](base-size-ratio-scaling.md) — the font-relative thickness/token surface to adopt **later**, not a dependency.

---

## Non-Goals

- **No base `Header` redesign.** Only `WindowHeader` is restyled; the base default insets stay `4/4` for any future consumer (the optional `updatePreferredSize` visibility bump is the sole permitted base edit, and only if needed).
- **No dependency on base-size-ratio-scaling.** The thickness is a self-contained text-driven preferred height (`textHeight + 2 * CHROME_MARGIN`) now; migrating `LEAD_GLYPH_INK_SIZE` and expressing `CHROME_MARGIN` as a ratio token is deferred to that plan landing.
- **No `TabWindow` / `Window` change.** The header is the only thing redesigned; both windows already route through the unchanged `setActive`/`setGlyph` hooks.
- **No new theme token, no new glyph, no new exported symbol.** Reuses the existing `windowControls.ts` factory and tokens.
- **No change to the leading glyph type.** It stays a plain `Glyph` (not a control-peer `Button`) so it baseline-aligns with the title text in the shared row, per the current implementation.
- **No per-region clip-frame opt-out on Border.** The fix composes WITH the clip frame (controls fill the band) rather than carving an exception into the clip-frames feature.
