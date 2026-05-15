// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Body, Util } from '@jimka/typescript-ui/core';
import { Tab } from '@jimka/typescript-ui/layout';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { VBoxPanel } from "./VBoxPanel.js";
import { HBoxPanel } from "./HBoxPanel.js";
import { BorderPanel } from "./BorderPanel.js";
import { RowPanel } from "./RowPanel.js";
import { ColumnPanel } from "./ColumnPanel.js";
import { FitPanel } from "./FitPanel.js";
import { SplitPanel } from "./SplitPanel.js";
import { MiscPanel } from "./MiscPanel.js";
import { BindingPanel } from "./BindingPanel.js";
import { ComplexUIPanel } from "./ComplexUIPanel.js";
import { GridPanel } from "./GridPanel.js";
import { AccordionPanel } from "./AccordionPanel.js";
import { TabPanel } from "./TabPanel.js";
import { MenuBarPanel } from "./MenuBarPanel.js";
import { MultiSelectListPanel } from "./MultiSelectListPanel.js";

import { Benchmark } from "./perf/Benchmark.js";
import { BaselinePanel } from "./BaselinePanel.js";

Util.getScrollBarWidth();
(window as any).bench = Benchmark;

let body = Body.getInstance();

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
layoutManager.addLazyTab(() => new GridPanel(),            "Grid"       );
layoutManager.addLazyTab(() => new ComplexUIPanel(),       "Complex"    );
layoutManager.addLazyTab(() => new AccordionPanel(),       "Accordion"  );
layoutManager.addLazyTab(() => new TabPanel(),             "Tab"        );
layoutManager.addLazyTab(() => new MenuBarPanel(),         "MenuBar"    );
layoutManager.addLazyTab(() => new MultiSelectListPanel(), "MultiSelect");
layoutManager.addLazyTab(() => new BaselinePanel(),        "Baseline"   );

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
