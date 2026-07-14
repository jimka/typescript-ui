// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { Component } from "~/core/Component.js";

/**
 * Layout constraints for child components added to an {@link Accordion} container.
 * Provides the header label and initial open state for each collapsible section.
 *
 * @category Layouts
 */
export class AccordionConstraints extends LayoutConstraints {

    /** Text displayed in the section's header button. */
    label: string;

    /** Whether the section starts expanded. Defaults to false if omitted. */
    initiallyOpen?: boolean;

    /** Per-section tool components shown in this section's header tool group. */
    tools?: Component[];

    /**
     * Share of the container's leftover height this section absorbs when the open
     * sections underflow. `0` (the default) leaves this section's weight to
     * {@link Accordion.setFillHeight} — which opts every open section in at an
     * equal default weight when on, or nothing when off. A positive weight grows
     * the section by its fraction of the total fill weight (each recipient capped
     * at its max), so a single weighted section fills all the slack and equal
     * weights split it, and it biases the share when combined with
     * `setFillHeight`.
     */
    fillWeight?: number;

    /**
     * @param label - Text displayed in the section header.
     * @param initiallyOpen - Whether the section starts expanded. Defaults to false.
     * @param glyph - Optional registry glyph name shown leading the header
     *   label. Stored on the inherited `glyph` constraint field.
     * @param tools - Optional per-section tool components for this header.
     */
    constructor(label: string, initiallyOpen?: boolean, glyph?: string, tools?: Component[]) {
        super();

        this.label = label;
        this.initiallyOpen = initiallyOpen;
        this.glyph = glyph ?? null;
        this.tools = tools;
    }
}
