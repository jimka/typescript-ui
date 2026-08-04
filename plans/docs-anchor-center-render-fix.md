# Anchor Demo Centered-Box Border — Implementation Plan

## Overview

The Anchor layout manager's docs page ([`packages/lib/docs/layouts/Anchor.md`](../packages/lib/docs/layouts/Anchor.md)) embeds a live demo defined in [`packages/docs/src/demos/anchor-positions.ts:25`](../packages/docs/src/demos/anchor-positions.ts#L25). It builds a `Panel` with an `Anchor` layout manager holding three children: a full-width `Header` band, a bottom-right `Pinned` `Button`, and a `Header('Centered 50%')` positioned at `left: 25%, top: 25%, width: 50%, height: 50%`. A user reported that the demo "doesn't render the center component correctly."

This plan is the outcome of a reproduction investigation, not a guess. Direct DOM measurement (`getBoundingClientRect`) of the live demo at `http://localhost:5174/typescript-ui/layouts/Anchor`, at multiple viewport widths (900px, 700px, 500px) and after an in-page resize (900px → 700px, no reload), confirms the `Anchor` layout manager computes the centre box's position and size **exactly** right every time — see `## Addendum: Measurements` below. The defect is not in `Anchor`, not in `Header`'s layout, and not resize-related staleness. It is in the demo module itself: the centre `Header` has no visible background or border, so its correctly-centred box is invisible, and the only thing a viewer actually sees — the header's title text — sits far off-centre because `Header` always left-aligns its label. The demo visually contradicts its own "Centered 50%" name and the page's own ASCII diagram, which draws the box with a border.

The fix touches only [`packages/docs/src/demos/anchor-positions.ts`](../packages/docs/src/demos/anchor-positions.ts): give the centre `Header` a visible border so the box `Anchor` already computes correctly becomes visible. No change to `Anchor.ts`, `AnchorConstraints.ts`, or `Header.ts`.

---

## Architecture Decisions

### Make the box visible; don't touch the layout math

The fix is a one-line addition of a `border` option to the centre `Header` in the demo, following the same `Header(text, { border: {...} })` construction-time styling already used for a docs-app `Header` in [`packages/docs/src/shell/DocsShell.ts:26-31`](../packages/docs/src/shell/DocsShell.ts#L26-L31), and the generic `--ts-ui-border-color` outline pattern used throughout the library, e.g. [`packages/lib/src/typescript/lib/component/table/Table.ts:208`](../packages/lib/src/typescript/lib/component/table/Table.ts#L208): `this.setBorder({ border: "1px solid var(--ts-ui-border-color, black)" })`.[^precedent]

### Leave the header's text left-aligned

`Header`'s label is always left-anchored — a fixed-width `Text` child docked `WEST` in a `Border` layout, never stretched to the header's full width (confirmed by inspecting the rendered DOM: the label's own inline `width` equals its natural text width, not the header's inner width). This is consistent everywhere else `Header` is used in the docs demos (`grid-tracks.ts`, `border-regions.ts`), so overriding it only in this demo would be a one-off inconsistency, not a fix.[^text-align-rejected]

---

## Ordered Implementation Steps

1. In [`packages/docs/src/demos/anchor-positions.ts`](../packages/docs/src/demos/anchor-positions.ts#L30), change the centre panel's construction from:

   ```typescript
   const centerPanel = Header('Centered 50%');
   ```

   to:

   ```typescript
   const centerPanel = Header('Centered 50%', {
       border: { border: '1px solid var(--ts-ui-border-color, rgb(180, 180, 180))' },
   });
   ```

   The fallback `rgb(180, 180, 180)` matches the value already used at the two other `--ts-ui-border-color` call sites cited in `## Architecture Decisions` ([`DiagramNode.ts:94`](../packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts#L94), [`DiagramGroupNode.ts:61`](../packages/lib/src/typescript/lib/component/diagram/DiagramGroupNode.ts#L61)).

2. Check: `grep -n "Header('Centered 50%'" packages/docs/src/demos/anchor-positions.ts` — one match, with the new `border` option present.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `packages/docs/src/demos/anchor-positions.ts` |

---

## Expected Behaviour

All of the following require manual verification in the browser — this is a purely visual, DOM-rendering change with no unit-testable logic.

- Loading `/layouts/Anchor` in the docs app shows the "Centered 50%" box with a visible 1px border, positioned with equal margins on all four sides of the demo pane (still governed by the same, already-correct, `left: 25%, top: 25%, width: 50%, height: 50%` constraints).
- The border box's edges land at the same pixel coordinates as today's invisible box — i.e. `getBoundingClientRect()` on the centre `Header` element is unchanged by this fix, since the component's box-sizing is `border-box` ([`Component.ts:539`](../packages/lib/src/typescript/lib/core/Component.ts#L539)), so an added `1px solid` border is absorbed inside the already-committed rect rather than growing it.
- The header band and pinned button are visually unchanged (out of scope for this fix — see `## Non-Goals`).
- Resizing the browser window re-anchors the bordered box the same way it already re-anchors the invisible one today (no regression to `Anchor`'s existing resize behaviour, since `Anchor.ts` is untouched).

---

## Verification

- `npm run docs:dev` (or use the already-running dev server), open `/layouts/Anchor`, confirm the centre box now shows a visible border, roughly centred with equal margins on all sides.
- Resize the browser window and confirm the bordered box re-centres live, matching the un-bordered box's current (correct) re-anchoring behaviour.
- No test suite covers `packages/docs/src/demos/`; no unit tests to add or run for this change.
- `npm run docs:api` is unaffected (no public API or JSDoc change).

---

## Potential Challenges

- The `1px solid` border on a `border-box`-sized component does not change the demo's DocsDemo stage layout (`height: 260`, fixed by `anchor-positions.ts:17`) — no adjustment needed there.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/Anchor.ts`](../packages/lib/src/typescript/lib/layout/Anchor.ts) — confirmed correct; read to verify the fix doesn't touch it.
- [`packages/lib/src/typescript/lib/layout/AnchorConstraints.ts`](../packages/lib/src/typescript/lib/layout/AnchorConstraints.ts) — the six-field constraint shape the demo already uses correctly.
- [`packages/lib/tests/component/layout/Anchor.test.ts`](../packages/lib/tests/component/layout/Anchor.test.ts) — existing coverage for pin/stretch/percent axis resolution; unaffected by this fix.
- [`packages/docs/src/demos/anchor-positions.ts`](../packages/docs/src/demos/anchor-positions.ts) — the file this plan modifies.
- [`packages/lib/src/typescript/lib/component/display/Header.ts`](../packages/lib/src/typescript/lib/component/display/Header.ts) — confirms the label's left-anchored, natural-width `Text` child and that `border`/`backgroundColor` route through the inherited `ComponentOptions` cascade with no `Header`-specific plumbing needed.
- [`packages/docs/src/shell/DocsShell.ts:26-31`](../packages/docs/src/shell/DocsShell.ts#L26-L31) — the precedent this plan's `Header(text, { border: {...} })` call mirrors.

---

## Non-Goals

- Changing `Anchor.ts`'s bounds computation — it is already correct at every measured viewport size and after live resize.
- Changing `Header.ts`'s text alignment — left-aligned titles are the established convention across every `Header` usage in the docs demos.
- Styling the header band or pinned button — the report names only the centre component.

---

## Addendum: Measurements

All measurements taken against the live docs dev server on `localhost:5174` (main tree, `packages/docs`), using `getBoundingClientRect()` on the actual rendered elements — not screenshots.

**900px viewport width**, canvas `Panel` (the `Anchor`-managed container) at `x=329, y=308, width=550, height=250`; its content insets are 4px per side (confirmed from the header band, which is pinned `left:0 right:0 top:0` and lands exactly at the inset boundary), giving an inner box of `left=333, top=262, width=542, height=242`.

| Element | Expected (25%/50% of inner box) | Measured | Match |
| --- | --- | --- | --- |
| Centre box `x` | `333 + 0.25×542 = 468.5` | `468.5` | exact |
| Centre box `width` | `0.5×542 = 271` | `271` | exact |
| Centre box `y` | `262 + 0.25×242 = 322.5` | `322.5` | exact |
| Centre box `height` | `0.5×242 = 121` | `121` | exact |

The box's own centre (`604`) lands exactly on the inner box's centre (`333 + 542/2 = 604`) — the box positioning is correct. But the visible label text's own rendered rect is `x: 472.5–555.5` (centre `≈514`) — **90px left of the canvas Panel's true centre**, because `Header`'s `Text` child renders at its natural width (`83px`, `data-preferredsize="83px 14px"` in the rendered DOM) pinned to the header's west edge, not stretched to fill it.

**500px viewport width** (fresh page load, sidebar collapses): canvas shrinks to inner box `left=333, top=312, width=142, height=242`. Centre box measured at `x=368.5, width=71, y=372.5, height=121` — matches `333+0.25×142=368.5` and `0.5×142=71` exactly.

**Live resize, 900px → 700px, same page (no reload)**: canvas inner box becomes `left=333, width=342`. Centre box measured at `x=418.5, width=171` — matches `333+0.25×342=418.5` and `0.5×342=171` exactly. `Anchor` re-resolves correctly on a live resize; no staleness.

## Notes

[^precedent]: `--ts-ui-border-color` is the library's generic border-outline token, also used in
    [`packages/lib/src/typescript/lib/component/table/Footer.ts:21`](../packages/lib/src/typescript/lib/component/table/Footer.ts#L21) and
    [`packages/lib/src/typescript/lib/component/display/Markdown.ts:216`](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L216).
    `DocsShell.ts` was chosen as the closer precedent for the exact call shape (`Header(text, { border: {...}, backgroundColor })`
    at construction time) because it's the one other place in this same `packages/docs` app that styles a `Header` this way; this
    plan only needs the border, not the background, since the goal is to reveal the box outline shown in the docs page's ASCII
    diagram, not to add a filled chrome bar.

[^text-align-rejected]: Centring the label text inside the box was considered and rejected. `Header`'s `Text` child is placed
    `WEST` with `fill: FillType.HORIZONTAL` in a `Border` layout, but the rendered DOM shows the label keeps its own natural
    width (`83px` at 900px viewport) rather than stretching to the header's full inner width — so setting `textAlign: 'center'`
    on the label would have no visible effect without also changing how the child is filled, which is `Header`'s internal,
    hardcoded layout (not exposed as a per-instance option) and used identically by every other `Header` demo
    (`grid-tracks.ts`, `border-regions.ts`). Changing it here only would be a framework-behaviour change disguised as a demo
    fix; the border alone already resolves the reported symptom by making the correctly-centred box visible.
