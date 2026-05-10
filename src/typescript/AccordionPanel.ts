// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "./Base/Component.js";
import { Accordion } from "./Base/layout/Accordion.js";
import { AccordionConstraints } from "./Base/layout/AccordionConstraints.js";
import { VBox } from "./Base/layout/VBox.js";
import { HBox } from "./Base/layout/HBox.js";
import { Fit } from "./Base/layout/Fit.js";
import { Text } from "./Base/component/Text.js";
import { Button } from "./Base/component/Button.js";
import { Checkbox } from "./Base/component/Checkbox.js";
import { TextField } from "./Base/component/TextField.js";
import { List } from "./Base/component/List.js";
import { Insets } from "./Base/Insets.js";
import { Panel } from "./Base/Panel.js";

/**
 * Demonstrates the Accordion layout manager with multiple collapsible sections,
 * programmatic open/close controls, and single-open mode toggling.
 */
export class AccordionPanel extends Panel {

    private accordion: Accordion;
    private singleOpenToggle: Button;

    constructor() {
        super();

        // VBox with stretching so children fill the full container width.
        // Without stretching, VBox uses size.width from setPreferredSize, which
        // would give 0 width when only the height is meaningful.
        const outerVBox = new VBox();
        outerVBox.setStretching(true);
        this.setLayoutManager(outerVBox);

        // --- Controls toolbar ---
        const toolbar = new Component();
        toolbar.setLayoutManager(new HBox());
        toolbar.setPreferredSize(0, 36);

        const openAllBtn = new Button("Open All");
        openAllBtn.setPreferredSize(90, 28);
        toolbar.addComponent(openAllBtn);

        const closeAllBtn = new Button("Close All");
        closeAllBtn.setPreferredSize(90, 28);
        toolbar.addComponent(closeAllBtn);

        this.singleOpenToggle = new Button("Single-open: OFF");
        this.singleOpenToggle.setPreferredSize(160, 28);
        toolbar.addComponent(this.singleOpenToggle);

        this.addComponent(toolbar);

        // --- Accordion ---
        const accordionContainer = new Component();

        this.accordion = new Accordion();
        accordionContainer.setLayoutManager(this.accordion);

        // Re-layout the outer VBox whenever a section toggles so the accordion
        // container resizes to match the new total preferred height.
        this.accordion.setOnSectionToggle(() => { this.doLayout(); });

        // Section 1: open by default
        accordionContainer.addComponent(this.buildInfoSection(), new AccordionConstraints('Personal Info', true));
        accordionContainer.addComponent(this.buildPreferencesSection(), new AccordionConstraints('Preferences'));
        accordionContainer.addComponent(this.buildListSection(), new AccordionConstraints('Recent Items'));
        accordionContainer.addComponent(this.buildAboutSection(), new AccordionConstraints('About'));

        this.addComponent(accordionContainer);

        // --- Wire controls ---
        openAllBtn.addActionListener(() => {
            for (let i = 0; i < 4; i++) {
                this.accordion.openSection(i);
            }
        });

        closeAllBtn.addActionListener(() => {
            for (let i = 0; i < 4; i++) {
                this.accordion.closeSection(i);
            }
        });

        this.singleOpenToggle.addActionListener(() => {
            const next = !this.accordion.isSingleOpen();
            this.accordion.setSingleOpen(next);
            this.singleOpenToggle.getText().setText(`Single-open: ${next ? 'ON' : 'OFF'}`);
        });
    }

    /**
     * Builds a form section with labelled text fields.
     *
     * @returns The section content component.
     */
    private buildInfoSection(): Component {
        const panel = new Panel();
        const vbox = new VBox();
        vbox.setStretching(true);
        panel.setLayoutManager(vbox);
        panel.setInsets(new Insets(8, 8, 8, 8));
        panel.setPreferredSize(0, 116);

        panel.addComponent(this.labeledField('Name:', 'Jane Doe'));
        panel.addComponent(this.labeledField('Email:', 'jane@example.com'));
        panel.addComponent(this.labeledField('Phone:', '+1 555 000 0000'));

        return panel;
    }

    /**
     * Builds a section with toggle checkboxes.
     *
     * @returns The section content component.
     */
    private buildPreferencesSection(): Component {
        const panel = new Panel();
        const vbox = new VBox();
        vbox.setStretching(true);
        panel.setLayoutManager(vbox);
        panel.setInsets(new Insets(8, 8, 8, 8));
        panel.setPreferredSize(0, 110);

        for (const text of ['Enable notifications', 'Dark mode', 'Auto-save']) {
            const row = new Component();
            row.setLayoutManager(new HBox());
            row.setPreferredSize(0, 28);

            row.addComponent(new Checkbox());

            const optionText = new Text(text);
            optionText.setPreferredSize(200, 28);
            row.addComponent(optionText);

            panel.addComponent(row);
        }

        return panel;
    }

    /**
     * Builds a section with a scrollable item list.
     *
     * @returns The section content component.
     */
    private buildListSection(): Component {
        const panel = new Panel();
        panel.setLayoutManager(new Fit());
        panel.setPreferredSize(0, 150);

        const list = new List();

        for (const item of ['Report Q1.pdf', 'Budget 2026.xlsx', 'Meeting notes.txt',
                             'Design mockup.png', 'Proposal draft.docx', 'Invoice #1042.pdf']) {
            list.addItem(item);
        }

        panel.addComponent(list);

        return panel;
    }

    /**
     * Builds a short informational section with descriptive labels.
     *
     * @returns The section content component.
     */
    private buildAboutSection(): Component {
        const panel = new Panel();
        const vbox = new VBox();
        vbox.setStretching(true);
        panel.setLayoutManager(vbox);
        panel.setInsets(new Insets(8, 8, 8, 8));
        panel.setPreferredSize(0, 86);

        const heading = new Text('Accordion Layout Manager');
        heading.setFontWeight('bold');
        heading.setPreferredSize(0, 20);
        panel.addComponent(heading);

        const line2 = new Text('Vertically stacked sections with CSS height animation.');
        line2.setPreferredSize(0, 20);
        panel.addComponent(line2);

        const line3 = new Text('Supports single-open mode and programmatic open/close.');
        line3.setPreferredSize(0, 20);
        panel.addComponent(line3);

        return panel;
    }

    /**
     * Creates a horizontal row with a fixed-width caption and a text field.
     *
     * @param caption - The caption string shown to the left of the field.
     * @param value - Initial text for the field.
     * @returns The row component.
     */
    private labeledField(caption: string, value: string): Component {
        const row = new Panel();
        row.setLayoutManager(new HBox());
        row.setPreferredSize(0, 30);

        const captionText = new Text(caption);
        captionText.setPreferredSize(70, 30);
        row.addComponent(captionText);

        const field = new TextField();
        field.setValue(value);
        field.setPreferredSize(200, 28);
        row.addComponent(field);

        return row;
    }
}
