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
