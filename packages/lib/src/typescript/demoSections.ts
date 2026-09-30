// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Component } from '@jimka/typescript-ui/core';
import { slugify } from "./demoSlug.js";
import { VBoxPanel } from "./VBoxPanel.js";
import { HBoxPanel } from "./HBoxPanel.js";
import { BoxJustifyPanel } from "./BoxJustifyPanel.js";
import { AlignSelfPanel } from "./AlignSelfPanel.js";
import { HFlowPanel } from "./HFlowPanel.js";
import { VFlowPanel } from "./VFlowPanel.js";
import { BorderPanel } from "./BorderPanel.js";
import { ContentBoxPanel } from "./ContentBoxPanel.js";
import { RowPanel } from "./RowPanel.js";
import { ColumnPanel } from "./ColumnPanel.js";
import { FitPanel } from "./FitPanel.js";
import { SplitPanel } from "./SplitPanel.js";
import { MiscPanel } from "./MiscPanel.js";
import { BindingPanel } from "./BindingPanel.js";
import { ComplexUIPanel } from "./ComplexUIPanel.js";
import { PropertyGridPanel } from "./PropertyGridPanel.js";
import { RotatedRecordPanel } from "./RotatedRecordPanel.js";
import { GridPanel } from "./GridPanel.js";
import { AccordionDemoPanel } from "./AccordionDemoPanel.js";
import { TabDemoPanel } from "./TabDemoPanel.js";
import { MenuBarPanel } from "./MenuBarPanel.js";
import { ToolBarPanel } from "./ToolBarPanel.js";
import { MultiSelectListPanel } from "./MultiSelectListPanel.js";
import { LayoutSerializationPanel } from "./LayoutSerializationPanel.js";
import { BaselinePanel } from "./BaselinePanel.js";
import { MarkdownPanel } from "./MarkdownPanel.js";
import { CodeEditorPanel } from "./CodeEditorPanel.js";
import { ChartDemoPanel } from "./ChartDemoPanel.js";
import { DiagramPanel } from "./DiagramPanel.js";
import { MarkdownEditorPanel } from "./MarkdownEditorPanel.js";
import { MarkerListPanel } from "./MarkerListPanel.js";
import { StyleAuditPanel } from "./StyleAuditPanel.js";

/** One demo section: a tree leaf, a URL segment, and the panel behind them. */
export interface DemoSection {
    /** The tree leaf's text, and the string `slug` is derived from. */
    readonly label:   string;
    /** The section's URL segment, derived from `label` by `slugify`. */
    readonly slug:    string;
    /** Builds the section's panel; called at most once, on first selection. */
    readonly factory: () => Component;
}

/** One nav-tree root: a category title over the sections filed under it. */
export interface DemoCategory {
    /** The category row's text. Carries no slug — a category is not navigable. */
    readonly title:    string;
    /** The category's sections, in the order their leaves appear. */
    readonly sections: readonly DemoSection[];
}

/**
 * Builds one section, deriving its slug rather than taking one.
 *
 * Every entry in `DEMO_CATEGORIES` goes through here so no slug is ever
 * written by hand — which is what keeps a label and its URL from drifting.
 *
 * @param label - The section's displayed label.
 * @param factory - Builds the section's panel on first selection.
 * @returns The section, with its slug derived from `label`.
 */
function section(label: string, factory: () => Component): DemoSection {
    return { label, slug: slugify(label), factory };
}

/**
 * The nav tree's seven categories and the 32 sections under them, in display
 * order. Each label is the section's URL, so relabelling one breaks its
 * bookmark — see "Every section keeps its current label, so every URL keeps
 * working" in plans/implemented/demo-app-category-navigation.md.
 */
export const DEMO_CATEGORIES: readonly DemoCategory[] = [
    {
        title: "Box & Flow Layouts",
        sections: [
            section("HBox",          () => new HBoxPanel()                 ),
            section("VBox",          () => new VBoxPanel()                 ),
            section("Row",           () => new RowPanel()                  ),
            section("Column",        () => new ColumnPanel()               ),
            section("Justify",       () => new BoxJustifyPanel()           ),
            section("AlignSelf",     () => new AlignSelfPanel()            ),
            section("HFlow",         () => new HFlowPanel()                ),
            section("VFlow",         () => new VFlowPanel()                ),
        ],
    },
    {
        title: "Regions & Grids",
        sections: [
            section("Border",        () => new BorderPanel()               ),
            section("Split",         () => new SplitPanel()                ),
            section("Grid",          () => new GridPanel()                 ),
            section("Fit",           () => new FitPanel()                  ),
            section("Layout I/O",    () => new LayoutSerializationPanel()  ),
        ],
    },
    {
        title: "Containers & Bars",
        sections: [
            section("Accordion",     () => new AccordionDemoPanel()        ),
            section("Tab",           () => new TabDemoPanel()              ),
            section("MenuBar",       () => new MenuBarPanel()              ),
            section("ToolBar",       () => new ToolBarPanel()              ),
        ],
    },
    {
        title: "Data & Lists",
        sections: [
            section("Binding",       () => new BindingPanel()              ),
            section("Property Grid", () => new PropertyGridPanel()         ),
            section("Rotated",       () => new RotatedRecordPanel()        ),
            section("MultiSelect",   () => new MultiSelectListPanel()      ),
            section("Marker Lists",  () => new MarkerListPanel()           ),
        ],
    },
    {
        title: "Editors & Visuals",
        sections: [
            section("Markdown",      () => new MarkdownPanel()             ),
            section("MD Editor",     () => new MarkdownEditorPanel()       ),
            section("CodeEditor",    () => new CodeEditorPanel()           ),
            section("Charts",        () => new ChartDemoPanel()            ),
            section("Diagram",       () => new DiagramPanel()              ),
        ],
    },
    {
        title: "Diagnostics",
        sections: [
            section("Baseline",      () => new BaselinePanel()             ),
            section("Content Box",   () => new ContentBoxPanel()           ),
            section("Style Audit",   () => new StyleAuditPanel()           ),
        ],
    },
    {
        title: "Showcase",
        sections: [
            section("Misc.",         () => new MiscPanel()                 ),
            section("Complex",       () => new ComplexUIPanel()            ),
        ],
    },
];

/** The slug `/` lands on: `"misc"`, which is the panel tab index 0 opened before this change. */
export const DEFAULT_SECTION_SLUG = slugify("Misc.");

/**
 * Every section, flattened in category order then in-category order.
 *
 * @returns The 32 sections, in the order the nav tree lists them.
 *
 * @remarks Recomputes on each call, which is free here: it is called once at
 * startup and once per test.
 */
export function allSections(): readonly DemoSection[] {
    return DEMO_CATEGORIES.flatMap(category => category.sections);
}
