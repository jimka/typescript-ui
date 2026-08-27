// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { Header } from '@jimka/typescript-ui/component/display';
import { StyleAuditView } from '@jimka/typescript-ui/diagnostics';

/**
 * Demo tab wrapping the library's {@link StyleAuditView} — the stylesheet
 * dedup audit itself (scan, dedup grouping, summary, results table) lives
 * there. This file supplies only the page title.
 *
 * @category Demo
 */
class StyleAuditPanel extends Panel {

    constructor() {
        super({ layoutManager: new VBox({ spacing: 8 }), autoScroll: "auto" });

        this.addComponent(new Header("Stylesheet Dedup Audit"));

        this.addComponent(new StyleAuditView(), { weight: 1 });
    }
}

const StyleAuditPanelCallable = callable(StyleAuditPanel);
type StyleAuditPanelCallable = StyleAuditPanel;
export {
    StyleAuditPanel         as _StyleAuditPanel,
    StyleAuditPanelCallable as StyleAuditPanel
};
