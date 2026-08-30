// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable } from "~/core/Callable.js";
import { VBox } from "~/layout/VBox.js";
import { MemoryStore } from "~/data/MemoryStore.js";
import { Model } from "~/data/Model.js";
import { Table } from "~/component/table/Table.js";
import type { ColumnSpec } from "~/component/table/ColumnConfig.js";
import { Text } from "~/component/input/Text.js";
import { Button } from "~/component/button/Button.js";
import { Tooltip } from "~/overlay/Tooltip.js";
import { auditStyleRules } from "~/diagnostics/StyleAudit.js";
import { Container } from "../core";
import { UNBOUNDED } from "../primitive";

/**
 * The embeddable stylesheet-dedup audit: an explanation, a Refresh button, a
 * summary line, and a table of the worst duplicate-body offenders by bytes
 * wasted. Runs one audit immediately at construction and again only on an
 * explicit Refresh click — no periodic auto-refresh, mirroring the source
 * demo panel this view was extracted from.
 *
 * Embedded by both the demo app's own "Style Audit" tab and
 * {@link StyleAuditOverlay}'s window body; whichever container embeds it owns
 * scrolling, so this view does not set `autoScroll` on itself.
 *
 * @category Core
 */
class StyleAuditView extends Container {

    private readonly _summary:       Text  = new Text("", { whiteSpace: "normal" });
    private readonly _refreshButton: Button = new Button("Refresh");
    private readonly _store:         MemoryStore;

    private readonly _boundRefresh: () => void = () => this.refresh();

    constructor() {
        super({ layoutManager: new VBox({ spacing: 8 }) });

        const explanation = new Text(
            "Scans the framework's shared #Base stylesheet for per-instance (#id) rules whose "
            + "declaration body duplicates another instance's — bytes a shared class-level rule "
            + "could collapse to one copy. Switch tabs to populate more components, then refresh.",
            { whiteSpace: "normal" },
        );
        this.addComponent(explanation);

        this._refreshButton.on("action", this._boundRefresh);
        this.addComponent(this._refreshButton);

        this.addComponent(this._summary);

        const model = new Model([
            { name: "count",     type: "number", order: 0 },
            { name: "wastedKB",  type: "string", order: 1 },
            { name: "component", type: "string", order: 2 },
            { name: "scope",     type: "string", order: 3 },
            { name: "body",      type: "string", order: 4 },
        ]);
        this._store = new MemoryStore(model, []);

        const spec: ColumnSpec = {
            autoSizeColumns: true,
            columns: [
                { field: "count",     minWidth: 70                      ,  readOnly: true },
                { field: "wastedKB",  minWidth: 100                     , readOnly: true },
                { field: "component", minWidth: 140                     , readOnly: true },
                { field: "scope",     minWidth: 110                     , readOnly: true },
                { field: "body",      minWidth: 420, maxWidth: UNBOUNDED, preserveWidth: true, readOnly: true },
            ],
        };

        this.addComponent(new Table(this._store, spec), { weight: 1 });

        this.refresh();
    }

    /** Re-runs {@link auditStyleRules} and writes the result into the summary text and table. */
    private refresh(): void {
        const { summary, duplicates } = auditStyleRules();

        this._summary.setText(
            `Total rules: ${summary.totalRules} · Total size: ${summary.totalSizeKB} · `
            + `Per-instance (#id) rules: ${summary.componentRuleCount} · Unique bodies: ${summary.uniqueBodyCount} · `
            + `Estimated dedupeable size: ${summary.wastedKB}`,
        );

        this._store.loadData(duplicates);
    }

    /**
     * Detaches the Refresh button's own hover tooltip — `Button` attaches one
     * for any non-empty title but never detaches it itself, the same reason
     * `DiagnosticsOverlay.teardown` detaches its own titled button's tooltip.
     */
    protected destructor(): void {
        Tooltip.detach(this._refreshButton);
        super.destructor();
    }
}

const StyleAuditViewCallable = callable(StyleAuditView);
type StyleAuditViewCallable = StyleAuditView;
export {
    StyleAuditView         as _StyleAuditView,
    StyleAuditViewCallable as StyleAuditView
};
