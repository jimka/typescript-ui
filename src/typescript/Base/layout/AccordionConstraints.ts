// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutConstraints } from "./LayoutConstraints.js";

/**
 * Layout constraints for child components added to an {@link Accordion} container.
 * Provides the header label and initial open state for each collapsible section.
 */
export class AccordionConstraints extends LayoutConstraints {

    /** Text displayed in the section's header button. */
    label: string;

    /** Whether the section starts expanded. Defaults to false if omitted. */
    initiallyOpen?: boolean;

    /**
     * @param label - Text displayed in the section header.
     * @param initiallyOpen - Whether the section starts expanded. Defaults to false.
     */
    constructor(label: string, initiallyOpen?: boolean) {
        super();

        this.label = label;
        this.initiallyOpen = initiallyOpen;
    }
}
