// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Glyph } from "~/component/display/Glyph.js";
import { Animation } from "~/core/Animation.js";
import { TREE_TOGGLE_TRAIT } from "~/core/StyleTraits.js";
import { COLLAPSE_DURATION, COLLAPSE_EASING } from "~/layout/CollapseSupport.js";
import { angle_right } from "~/glyphs/solid/angle_right.js";

Glyph.register(angle_right);

/**
 * The one glyph every tree toggle shows; expansion is a rotation of it, not
 * a change of glyph name. Shared by `TreeRow` and
 * `TreeCellRenderer` (through {@link createTreeToggle}) so `Tree` and
 * `TreeTable` toggles stay identical.
 */
const TREE_TOGGLE_GLYPH = "angle-right";

/** Collapsed: the glyph as drawn, pointing right. */
const COLLAPSED_ROTATION = "rotate(0deg)";

/** Expanded: a quarter turn clockwise, pointing down. */
const EXPANDED_ROTATION = "rotate(90deg)";

/** Same duration and curve as the row motion, so caret and rows move together. */
const ROTATION_TRANSITION = `transform ${COLLAPSE_DURATION}ms ${COLLAPSE_EASING}`;

/**
 * Builds a freshly constructed tree toggle glyph, at rest (no transition) and
 * rotated for the given expansion state.
 *
 * @param expanded - Whether the toggle should start pointing down (expanded)
 *   or right (collapsed).
 * @returns A new, unparented {@link Glyph} ready to be appended to a row.
 *
 * @internal Not barrel-exported; used by `TreeRow` and `TreeCellRenderer`.
 */
export function createTreeToggle(expanded: boolean): Glyph {
    // The pointer cursor comes from the shared tree-toggle trait.
    const toggle = new Glyph(TREE_TOGGLE_GLYPH, { styleTrait: TREE_TOGGLE_TRAIT });

    toggle.clearInsets();
    toggle.getAria().setHidden(true);
    rotateTreeToggle(toggle, expanded, false);

    return toggle;
}

/**
 * Turns an existing tree toggle glyph to the given expansion state, optionally
 * animating the turn with the shared 200 ms transition.
 *
 * The transition is written before the transform, so the transform change is
 * the one it animates (or does not) — writing them in the other order would
 * animate the *previous* transform's arrival instead.
 *
 * @param toggle - The toggle glyph to turn.
 * @param expanded - Whether the toggle should point down (expanded) or right
 *   (collapsed).
 * @param animate - Whether to turn with the shared transition instead of
 *   snapping. Ignored (treated as `false`) under `prefers-reduced-motion: reduce`.
 *
 * @internal Not barrel-exported; used by `TreeRow` and `TreeCellRenderer`.
 */
export function rotateTreeToggle(toggle: Glyph, expanded: boolean, animate: boolean): void {
    toggle.setTransition(animate && !Animation.isReducedMotion() ? ROTATION_TRANSITION : null);
    toggle.setTransform(expanded ? EXPANDED_ROTATION : COLLAPSED_ROTATION);
}
