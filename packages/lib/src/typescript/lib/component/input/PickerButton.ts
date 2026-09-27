// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button, ButtonOptions } from "~/component/button/Button.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";

/**
 * Resting + pressed + hover defaults for {@link PickerButton} — transparent
 * background, no border, no shadow, matching what `chromeless: true` used to
 * compute imperatively (`Button.applyChromeOptions`'s chromeless branch).
 * `pressedForegroundColor` restates the same literal token Button's own
 * resting default uses (`_defaultButtonOptions.foregroundColor` in
 * Button.ts — module-private, not importable, so restated here); the other
 * `pressedX`/`hoverX` fields match the resting tier. `PickerButton` has no
 * visual press or hover distinction, so both states must be pinned to the
 * *same* values as resting, not left to Button's generic raised look — see
 * plans/implemented/button-chromeless-followup-dedup.md's Implementation
 * Notes for why the hover pin is needed despite the plan's Architecture
 * Decisions originally concluding otherwise.
 */
const _defaultPickerButtonOptions: Partial<ButtonOptions> = {
    backgroundColor:        "transparent",
    backgroundImage:        "none",
    border:                 "none",
    borderRadius:           undefined,
    shadow:                 "none",
    pressedForegroundColor: "var(--ts-ui-text-color, black)",
    pressedBackgroundColor: "transparent",
    pressedBackgroundImage: "none",
    pressedShadow:          "none",
    hoverBackgroundColor:   "transparent",
    hoverBackgroundImage:   "none",
    hoverShadow:            "none",
};

/**
 * Internal `<button>` Component used by every {@link AbstractPickerField}
 * concrete subclass (DateField / TimeField / DateTimeField) as the
 * glyph-bearing trigger to the right of the input.
 *
 * Declares its own resting chrome (transparent, no border/shadow) instead of
 * `chromeless: true` — see plans/implemented/button-chromeless-followup-dedup.md's
 * Architecture Decisions for why `chromeless` could never dedupe (its bare
 * `#id` resting write, and `pinPressedToResting`'s unconditional per-instance
 * `.pressed` pin). Both the `.pressed` and `:hover` states are pinned to the
 * same resting values via `ownStyleStates`, so neither shows any visual
 * change — identical to its previous chromeless behaviour (see that plan's
 * Implementation Notes: the resting write's move off the bare `#id` rule
 * means `:hover` can no longer rely on outranking `.Button:hover:not(.pressed)`
 * for free, so it must be pinned explicitly, the same shape
 * `WindowControlButton`/`TabCloseButton`/`MenuBarButton` already use). The
 * per-field glyph (calendar / clock / calendar) is set after construction via
 * `setGlyph` — Button's content-row Fit layout centres it within the inner
 * rect automatically.
 *
 * @category Components
 */
class PickerButton extends Button {
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultPickerButtonOptions;

    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".pressed",
            extract: (): StyleBag => ({
                foregroundColor: _defaultPickerButtonOptions.pressedForegroundColor,
                backgroundColor: _defaultPickerButtonOptions.pressedBackgroundColor,
                backgroundImage: _defaultPickerButtonOptions.pressedBackgroundImage,
                shadow:          _defaultPickerButtonOptions.pressedShadow,
            }),
        },
        {
            selector: ":hover",
            extract: (): StyleBag => ({
                backgroundColor: _defaultPickerButtonOptions.hoverBackgroundColor,
                backgroundImage: _defaultPickerButtonOptions.hoverBackgroundImage,
                shadow:          _defaultPickerButtonOptions.hoverShadow,
            }),
        },
    ];

    constructor(subclassDefaults?: Partial<ButtonOptions>) {
        super(
            undefined,
            { insets: new Insets(0, 4, 0, 4) },
            { ..._defaultPickerButtonOptions, ...(subclassDefaults ?? {}) },
        );
    }

    /**
     * Opts into the unchanged-geometry layout skip: a picker's trigger button
     * re-committed at the rectangle it already holds, with no pass owed, is not
     * re-laid-out.
     *
     * A `PickerButton`'s own pass places one content row, in a `Fit`, at the
     * button's own inner rect — which a skip by definition did not change. Every
     * input announces itself:
     *
     * - `clearGlyph`, the *first* `setGlyph`, `setDescription` /
     *   `clearDescription`, `setShowText`, `setShowDescription`,
     *   `setDescriptionUnderGlyph` and a writing-mode change each go through the
     *   inherited content-row rebuild, which empties and refills that row — child
     *   changes that schedule the row itself — and then recompute the button's own
     *   preferred size, whose relay marks every ancestor. A scheduled content row
     *   still gets its own top-level pass under a skipping button, because the
     *   batched layout flush stops walking up at the first ancestor that may
     *   withhold a commit.
     * - A *later* `setGlyph` renames the existing glyph in place and returns
     *   without rebuilding or recomputing anything. That is sound rather than a
     *   gap: a glyph's box never depends on its name, so the content row's shape
     *   is unchanged and no pass is owed.
     * - `setText` writes the label's text, which schedules the label's own parent
     *   — the content row — and then recomputes the button's preferred size,
     *   whose relay marks every ancestor.
     * - The flat and compact insets write this button's own insets, which mark
     *   the layout owed here like any `invalidateLayout`.
     * - Its rectangle is written by {@link AbstractPickerField}'s own pass,
     *   which commits it through `applyBounds` — so a horizontal resize moves the
     *   button, and a change in the field's height re-centres the Fit-centred
     *   glyph. Either is a rectangle change, so neither is withheld.
     * - `setInsets` / `clearInsets`, `setLayoutManager`, padding and border —
     *   each marks the layout owed here, like any `invalidateLayout`.
     * - A theme switch or web-font swap — re-measured through the text-metrics
     *   condition the skip's own gate applies.
     *
     * The opt-in is this class, not `Button`: `ButtonIconGlyph` and
     * `ButtonLabelText` are shared by every button in the library and stay on
     * the default gate, which costs nothing here — the button above them is
     * withheld whole, so nothing reaches them on a settled pass.
     *
     * Not covered, and so not re-flowed until this component's rectangle next
     * moves or something schedules it: a consumer child that changes its own
     * intrinsic size without calling `setPreferredSize` or
     * `notifyIntrinsicSizeChanged`. It should follow its change with
     * `scheduleLayout()`.
     *
     * @returns `true`.
     */
    protected canSkipUnchangedLayout(): boolean {
        return true;
    }
}

const PickerButtonCallable = callable(PickerButton);
type PickerButtonCallable = PickerButton;
export {
    PickerButton         as _PickerButton,
    PickerButtonCallable as PickerButton,
};
