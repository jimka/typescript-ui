// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Body, DOM, FocusHistory } from '@jimka/typescript-ui/core';
import { Tab } from '@jimka/typescript-ui/layout';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { VBoxPanel } from "./VBoxPanel.js";
import { HBoxPanel } from "./HBoxPanel.js";
import { BoxJustifyPanel } from "./BoxJustifyPanel.js";
import { AlignSelfPanel } from "./AlignSelfPanel.js";
import { HFlowPanel } from "./HFlowPanel.js";
import { VFlowPanel } from "./VFlowPanel.js";
import { BorderPanel } from "./BorderPanel.js";
import { RowPanel } from "./RowPanel.js";
import { ColumnPanel } from "./ColumnPanel.js";
import { FitPanel } from "./FitPanel.js";
import { SplitPanel } from "./SplitPanel.js";
import { MiscPanel } from "./MiscPanel.js";
import { BindingPanel } from "./BindingPanel.js";
import { ComplexUIPanel } from "./ComplexUIPanel.js";
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

DOM.source.getScrollBarWidth();
(window as any).bench = Benchmark;

let body = Body.getInstance();

FocusHistory.enable();

let layoutManager = new Tab();
body.setLayoutManager(layoutManager);

layoutManager.addLazyTab(() => new MiscPanel(),            "Misc."      );
layoutManager.addLazyTab(() => new BindingPanel(),         "Binding"    );
layoutManager.addLazyTab(() => new RowPanel(),             "Row"        );
layoutManager.addLazyTab(() => new ColumnPanel(),          "Column"     );
layoutManager.addLazyTab(() => new FitPanel(),             "Fit"        );
layoutManager.addLazyTab(() => new SplitPanel(),           "Split"      );
layoutManager.addLazyTab(() => new BorderPanel(),          "Border"     );
layoutManager.addLazyTab(() => new HBoxPanel(),            "HBox"       );
layoutManager.addLazyTab(() => new VBoxPanel(),            "VBox"       );
layoutManager.addLazyTab(() => new BoxJustifyPanel(),      "Justify"    );
layoutManager.addLazyTab(() => new AlignSelfPanel(),       "AlignSelf"  );
layoutManager.addLazyTab(() => new HFlowPanel(),           "HFlow"      );
layoutManager.addLazyTab(() => new VFlowPanel(),           "VFlow"      );
layoutManager.addLazyTab(() => new GridPanel(),            "Grid"       );
layoutManager.addLazyTab(() => new ComplexUIPanel(),       "Complex"    );
layoutManager.addLazyTab(() => new AccordionDemoPanel(),   "Accordion"  );
layoutManager.addLazyTab(() => new TabDemoPanel(),         "Tab"        );
layoutManager.addLazyTab(() => new MenuBarPanel(),         "MenuBar"    );
layoutManager.addLazyTab(() => new ToolBarPanel(),         "ToolBar"    );
layoutManager.addLazyTab(() => new MultiSelectListPanel(), "MultiSelect");
layoutManager.addLazyTab(() => new BaselinePanel(),        "Baseline"   );
layoutManager.addLazyTab(() => new LayoutSerializationPanel(), "Layout I/O" );
layoutManager.addLazyTab(() => new MarkdownPanel(),        "Markdown"   );
layoutManager.addLazyTab(() => new CodeEditorPanel(),      "CodeEditor" );
layoutManager.addLazyTab(() => new ChartDemoPanel(),       "Charts"     );
layoutManager.addLazyTab(() => new DiagramPanel(),         "Diagram"    );
layoutManager.addLazyTab(() => new MarkdownEditorPanel(),  "MD Editor"  );

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
