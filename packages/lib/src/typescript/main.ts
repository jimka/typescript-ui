// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Body, Component, DOM, FocusHistory } from '@jimka/typescript-ui/core';
import { Tab } from '@jimka/typescript-ui/layout';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { Router, type RouteParams } from '@jimka/typescript-ui/router';
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

import { Benchmark } from "./perf/Benchmark.js";
import { BaselinePanel } from "./BaselinePanel.js";
import { MarkdownPanel } from "./MarkdownPanel.js";
import { CodeEditorPanel } from "./CodeEditorPanel.js";
import { ChartDemoPanel } from "./ChartDemoPanel.js";
import { DiagramPanel } from "./DiagramPanel.js";
import { MarkdownEditorPanel } from "./MarkdownEditorPanel.js";
import { MarkerListPanel } from "./MarkerListPanel.js";

DOM.source.getScrollBarWidth();
(window as any).bench = Benchmark;

FocusHistory.enable();

let layoutManager = new Tab();
Body.init({ layoutManager });

// Tab labels carry punctuation and spaces ("Misc.", "Layout I/O"); slugify
// them into stable URL segments and index them so a route can select by
// name. Routing through this helper (rather than a separately written slug
// list) is what keeps the two lists from drifting.
function slugify(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const slugs: string[] = [];

function addSection(factory: () => Component, label: string): void {
    slugs.push(slugify(label));
    layoutManager.addLazyTab(factory, label);
}

addSection(() => new MiscPanel(),            "Misc."      );
addSection(() => new BindingPanel(),         "Binding"    );
addSection(() => new RowPanel(),             "Row"        );
addSection(() => new ColumnPanel(),          "Column"     );
addSection(() => new FitPanel(),             "Fit"        );
addSection(() => new SplitPanel(),           "Split"      );
addSection(() => new BorderPanel(),          "Border"     );
addSection(() => new HBoxPanel(),            "HBox"       );
addSection(() => new VBoxPanel(),            "VBox"       );
addSection(() => new BoxJustifyPanel(),      "Justify"    );
addSection(() => new AlignSelfPanel(),       "AlignSelf"  );
addSection(() => new HFlowPanel(),           "HFlow"      );
addSection(() => new VFlowPanel(),           "VFlow"      );
addSection(() => new GridPanel(),            "Grid"       );
addSection(() => new ComplexUIPanel(),       "Complex"    );
addSection(() => new PropertyGridPanel(),    "Property Grid");
addSection(() => new RotatedRecordPanel(),   "Rotated"      );
addSection(() => new AccordionDemoPanel(),   "Accordion"  );
addSection(() => new TabDemoPanel(),         "Tab"        );
addSection(() => new MenuBarPanel(),         "MenuBar"    );
addSection(() => new ToolBarPanel(),         "ToolBar"    );
addSection(() => new MultiSelectListPanel(), "MultiSelect");
addSection(() => new MarkerListPanel(),      "Marker Lists");
addSection(() => new BaselinePanel(),        "Baseline"   );
addSection(() => new ContentBoxPanel(),      "Content Box");
addSection(() => new LayoutSerializationPanel(), "Layout I/O" );
addSection(() => new MarkdownPanel(),        "Markdown"   );
addSection(() => new CodeEditorPanel(),      "CodeEditor" );
addSection(() => new ChartDemoPanel(),       "Charts"     );
addSection(() => new DiagramPanel(),         "Diagram"    );
addSection(() => new MarkdownEditorPanel(),  "MD Editor"  );

function showSection(params: RouteParams): void {
    const index = slugs.indexOf(params.section);

    if (index >= 0) {
        layoutManager.setActiveTabIndex(index);
    }
}

function showDefaultSection(): void {
    layoutManager.setActiveTabIndex(0);
}

// Driven by "select" rather than "activate": the URL names the section the
// moment its tab is picked, not once a lazy panel has finished building — so a
// slow factory never leaves the location field trailing the visible tab.
function syncHashToTab(index: number): void {
    router.navigate("/" + slugs[index]);
}

const router = new Router({
    routes: {
        "/":         showDefaultSection,
        "/:section": showSection,
    },
});

layoutManager.on("select", syncHashToTab);
router.start();

const PersonModel = new Model([
    { name: 'id',   type: 'number'                  },
    { name: 'name', type: 'string'                  },
    { name: 'age',  type: 'number', defaultValue: 0 },
]);

const store = new MemoryStore(PersonModel, [
    { id: 1, name: 'Alice', age: 30 },
    { id: 2, name: 'Bob'  , age: 25 },
]);

store.on('load', () => {
    for (let obj of store.getAll()) {
        console.log(obj);
    }
});

await store.load();

if (false) {
    Benchmark.benchAll();
}
