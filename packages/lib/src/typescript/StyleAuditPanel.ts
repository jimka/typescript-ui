// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Component, Panel } from '@jimka/typescript-ui/core';
import { HBox, VBox } from '@jimka/typescript-ui/layout';
import { Text } from '@jimka/typescript-ui/component/input';
import { Header } from '@jimka/typescript-ui/component/display';
import { Button } from '@jimka/typescript-ui/component/button';
import { StyleAuditView } from '@jimka/typescript-ui/diagnostics';

/**
 * Demo tab wrapping the library's {@link StyleAuditView} — the stylesheet
 * dedup audit itself (scan, dedup grouping, summary, results table) lives
 * there. This file supplies only the page title and the "Shared Instance
 * Style Groups" scaffolding: eight demo buttons that manufacture
 * grouped/ungrouped style rules so the embedded audit has something
 * interesting to show on a fresh page load.
 *
 * @category Demo
 */
class StyleAuditPanel extends Panel {

    constructor() {
        super({ layoutManager: new VBox({ spacing: 8 }), autoScroll: "auto" });

        this.addComponent(new Header("Stylesheet Dedup Audit"));

        this.addComponent(new Header("Shared Instance Style Groups"));
        this.addComponent(new Text(
            "The five 'Grouped' buttons below all pass the same non-default backgroundColor and "
            + "the same styleGroup token, so they share one .Button--warning-demo rule instead of "
            + "each carrying its own #id rule. The three 'Ungrouped' buttons use the identical "
            + "backgroundColor with no styleGroup, so each still writes its own #id rule — refresh "
            + "the audit above and compare their row counts.",
            { whiteSpace: "normal" },
        ));

        const styleGroupDemoRow = new Component({ layoutManager: new HBox({ spacing: 8 }) });
        for (let i = 1; i <= 5; i++) {
            styleGroupDemoRow.addComponent(new Button("Grouped " + i, {
                backgroundColor: "#b58900",
                styleGroup:      "warning-demo",
            }));
        }
        for (let i = 1; i <= 3; i++) {
            styleGroupDemoRow.addComponent(new Button("Ungrouped " + i, { backgroundColor: "#b58900" }));
        }
        this.addComponent(styleGroupDemoRow);

        this.addComponent(new StyleAuditView(), { weight: 1 });
    }
}

const StyleAuditPanelCallable = callable(StyleAuditPanel);
type StyleAuditPanelCallable = StyleAuditPanel;
export {
    StyleAuditPanel         as _StyleAuditPanel,
    StyleAuditPanelCallable as StyleAuditPanel
};
