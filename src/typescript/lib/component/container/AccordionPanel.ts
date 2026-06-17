// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Container, ContainerOptions } from "~/core/Container.js";
import { Component } from "~/core/Component.js";
import { Accordion, SectionToggleCallback } from "~/layout/Accordion.js";
import { AccordionConstraints } from "~/layout/AccordionConstraints.js";
import { callable } from "~/core/Callable.js";

/**
 * One entry in an {@link AccordionPanel}'s `sections` options array.
 *
 * @category Components
 */
export interface AccordionSectionConfig {
    /** Label rendered in the section's header button. */
    label:          string;
    /** Component shown inside the section's content area when expanded. */
    component:      Component;
    /** Whether the section starts expanded. Defaults to `false` if omitted. */
    initiallyOpen?: boolean;
}

/**
 * Construction-time options for {@link AccordionPanel}.
 *
 * @category Components
 */
export interface AccordionPanelOptions extends ContainerOptions {
    /** Optional initial sections; each entry maps to one `addSection` call. */
    sections?:        AccordionSectionConfig[];
    /** Mirrors `Accordion.setSingleOpen` — only one section open at a time. */
    singleOpen?:      boolean;
    /** Optional callback fired when a section opens or closes. */
    onSectionToggle?: SectionToggleCallback;
}

/**
 * A [`Container`](/api/core/classes/Container) subclass that owns an internal
 * [`Accordion`](/api/layout/classes/Accordion) layout manager and exposes a
 * section-typed `addSection` surface so consumers do not have to wire
 * `new Container({ layoutManager: new Accordion() })` themselves. The bare
 * Container + Accordion manager path still works unchanged; `AccordionPanel`
 * is the convenience entry point.
 *
 * Section operations (open/close, single-open mode, toggle events) are reached
 * through {@link getAccordion}, the typed accessor for the wrapped manager,
 * rather than a mirrored forwarder per method.
 *
 * @example
 * ```typescript
 * import { AccordionPanel } from '@jimka/typescript-ui/component/container';
 *
 * const acc = new AccordionPanel({
 *     singleOpen: true,
 *     sections: [
 *         { label: 'Profile',     component: profilePanel, initiallyOpen: true },
 *         { label: 'Preferences', component: prefsPanel },
 *     ],
 * });
 *
 * acc.getAccordion().openSection(1);
 * ```
 *
 * @category Components
 */
class AccordionPanel<TOptions extends AccordionPanelOptions = AccordionPanelOptions> extends Container<TOptions> {

    /**
     * Wires the panel to an internal `Accordion` manager, dispatches the
     * optional `sections` / `singleOpen` / `onSectionToggle` options to the
     * relevant setters.
     *
     * @param options - Optional construction-time options applied to the panel.
     */
    constructor(options?: TOptions) {
        super(options);

        // Set the layout manager unconditionally — even if the caller passed
        // `layoutManager` via the options bag, `AccordionPanel`'s identity is
        // the `Accordion` manager. Override-by-options would defeat the class.
        this.setLayoutManager(new Accordion());

        if (options?.singleOpen !== undefined) {
            this.getAccordion().setSingleOpen(options.singleOpen);
        }

        if (options?.sections) {
            for (const section of options.sections) {
                this.addSection(section.component, section.label, section.initiallyOpen);
            }
        }

        if (options?.onSectionToggle) {
            this.getAccordion().on("sectiontoggle", options.onSectionToggle);
        }
    }

    /**
     * Adds a section to the panel's internal `Accordion` manager.
     *
     * @param component - The content shown inside the section.
     * @param label - The section header's label.
     * @param initiallyOpen - Optional. Whether the section starts expanded; defaults to `false`.
     *
     * @returns This panel, for method chaining.
     */
    addSection(component: Component, label: string, initiallyOpen?: boolean): this {
        const constraints = new AccordionConstraints(label, initiallyOpen);

        this.addComponent(component, constraints);

        return this;
    }

    /**
     * Typed accessor for the internally-owned `Accordion` manager. Use it to
     * reach section operations (open/close, single-open mode, toggle events)
     * without casting `getLayoutManager()`.
     *
     * @returns The wrapped `Accordion` instance.
     */
    getAccordion(): Accordion {
        return this.getLayoutManager() as Accordion;
    }
}

const AccordionPanelCallable = callable(AccordionPanel);
type AccordionPanelCallable<TOptions extends AccordionPanelOptions = AccordionPanelOptions> = AccordionPanel<TOptions>;
export {
    AccordionPanel         as _AccordionPanel,
    AccordionPanelCallable as AccordionPanel,
};
