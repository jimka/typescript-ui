import { Body } from "./Base/Body.js";
import { Tab } from "./Base/layout/Tab.js";
import { VBoxPanel } from "./VBoxPanel.js";
import { HBoxPanel } from "./HBoxPanel.js";
import { BorderPanel } from "./BorderPanel.js";
import { RowPanel } from "./RowPanel.js";
import { ColumnPanel } from "./ColumnPanel.js";
import { FitPanel } from "./FitPanel.js";
import { SplitPanel } from "./SplitPanel.js";
import { MiscPanel } from "./MiscPanel.js";

let body = Body.getInstance();

let layoutManager = new Tab();
body.setLayoutManager(layoutManager);

let miscPanel = new MiscPanel();
body.addComponent(miscPanel, { name: "Misc." });

let rowPanel = new RowPanel();
body.addComponent(rowPanel, { name: "Row" });

let columnPanel = new ColumnPanel();
body.addComponent(columnPanel, { name: "Column" });

let fitPanel = new FitPanel();
body.addComponent(fitPanel, { name: "Fit" });

let splitPanel = new SplitPanel();
body.addComponent(splitPanel, { name: "Split" });

let borderPanel = new BorderPanel();
body.addComponent(borderPanel, { name: "Border" });

let hboxPanel = new HBoxPanel();
body.addComponent(hboxPanel, { name: "HBox" });

let vboxPanel = new VBoxPanel();
body.addComponent(vboxPanel, { name: "VBox" });
