// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Panel, PanelOptions } from "~/core/Panel.js";
import { Component } from "~/core/Component.js";
import { Accordion, AccordionEvent, SectionToggleCallback } from "~/layout/Accordion.js";
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
export interface AccordionPanelOptions extends PanelOptions {
    /** Optional initial sections; each entry maps to one `addSection` call. */
    sections?:        AccordionSectionConfig[];
    /** Mirrors `Accordion.setSingleOpen` — only one section open at a time. */
    singleOpen?:      boolean;
    /** Optional callback fired when a section opens or closes. */
    onSectionToggle?: SectionToggleCallback;
}

/**
 * A [`Panel`](/api/core/classes/Panel) subclass that owns an internal
 * [`Accordion`](/api/layout/classes/Accordion) layout manager and exposes a
 * section-typed `addSection` / `openSection` / `closeSection` surface so
 * consumers do not have to wire `new Panel({ layoutManager: new Accordion() })`
 * themselves. The bare Panel + Accordion manager path still works
 * unchanged; `AccordionPanel` is the convenience entry point.
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
 * ```
 *
 * @category Components
 */
class AccordionPanel<TOptions extends AccordionPanelOptions = AccordionPanelOptions> extends Panel<TOptions> {

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
            this.setSingleOpen(options.singleOpen);
        }

        if (options?.sections) {
            for (const section of options.sections) {
                this.addSection(section.component, section.label, section.initiallyOpen);
            }
        }

        if (options?.onSectionToggle) {
            this.getAccordionManager().on("sectiontoggle", options.onSectionToggle);
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
     * Opens the section at `index`. Forwards to the wrapped
     * `Accordion.openSection`.
     *
     * @param index - Zero-based section index.
     *
     * @returns This panel, for method chaining.
     */
    openSection(index: number): this {
        this.getAccordionManager().openSection(index);

        return this;
    }

    /**
     * Closes the section at `index`. Forwards to the wrapped
     * `Accordion.closeSection`.
     *
     * @param index - Zero-based section index.
     *
     * @returns This panel, for method chaining.
     */
    closeSection(index: number): this {
        this.getAccordionManager().closeSection(index);

        return this;
    }

    /**
     * Returns whether the section at `index` is currently open. Forwards to
     * the wrapped `Accordion.isSectionOpen`.
     *
     * @param index - Zero-based section index.
     *
     * @returns `true` when the section is expanded.
     */
    isSectionOpen(index: number): boolean {
        return this.getAccordionManager().isSectionOpen(index);
    }

    /**
     * Toggles single-open mode (only one section may be open at a time).
     * Forwards to the wrapped `Accordion.setSingleOpen`.
     *
     * @param value - True to enable single-open mode.
     *
     * @returns This panel, for method chaining.
     */
    setSingleOpen(value: boolean): this {
        this.getAccordionManager().setSingleOpen(value);

        return this;
    }

    /**
     * Returns whether single-open mode is enabled. Forwards to the wrapped
     * `Accordion.isSingleOpen`.
     *
     * @returns `true` when only one section may be open at a time.
     */
    isSingleOpen(): boolean {
        return this.getAccordionManager().isSingleOpen();
    }

    /**
     * Registers a listener on the wrapped {@link Accordion} manager. Public
     * forwarder so consumers can wire `sectiontoggle` listeners through the
     * panel surface without reaching the protected manager accessor.
     *
     * @param event - The {@link Accordion} event name.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This panel, for method chaining.
     */
    on(event: "sectiontoggle", listener: SectionToggleCallback): this;
    on(event: AccordionEvent,  listener: Function): this {
        this.getAccordionManager().on(event, listener as SectionToggleCallback);

        return this;
    }

    /**
     * Removes a listener previously registered via {@link on}.
     *
     * @param event - The {@link Accordion} event the listener was registered for.
     * @param listener - The exact callback reference to remove.
     *
     * @returns This panel, for method chaining.
     */
    off(event: AccordionEvent, listener: Function): this {
        this.getAccordionManager().off(event, listener as SectionToggleCallback);

        return this;
    }

    /**
     * Typed accessor for the internally-owned `Accordion` manager. Subclasses
     * use it to forward additional accordion-specific setters without
     * re-implementing the cast.
     *
     * @returns The wrapped `Accordion` instance.
     */
    protected getAccordionManager(): Accordion {
        return this.getLayoutManager() as Accordion;
    }
}

const AccordionPanelCallable = callable(AccordionPanel);
type AccordionPanelCallable<TOptions extends AccordionPanelOptions = AccordionPanelOptions> = AccordionPanel<TOptions>;
export {
    AccordionPanel         as _AccordionPanel,
    AccordionPanelCallable as AccordionPanel,
};
