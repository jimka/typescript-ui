// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Panel, Event } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { Table } from '@jimka/typescript-ui/component/table';
import type { ColumnSpec } from '@jimka/typescript-ui/component/table';
import { Text } from '@jimka/typescript-ui/component/input';
import { Header } from '@jimka/typescript-ui/component/display';
import { Button } from '@jimka/typescript-ui/component/button';

/** How many duplicate-body rows to show, ranked by bytes wasted. */
const MAX_ROWS = 25;

/** Byte length past which a rule body is truncated in the table (full text is a quote-and-paste job, not a table cell's). */
const BODY_PREVIEW_LENGTH = 160;

/** The marker class every framework component's root element carries alongside its concrete class name (`class="ts-ui-component Button"`). */
const COMPONENT_MARKER_CLASS = "ts-ui-component";

interface DuplicateRuleRow {
    count:     number;
    wastedKB:  string;
    component: string;
    scope:     string;
    body:      string;
}

interface StyleAuditSummary {
    totalRules:         number;
    totalSizeKB:        string;
    componentRuleCount: number;
    uniqueBodyCount:    number;
    wastedKB:           string;
}

/** Formats a byte count as kilobytes with two decimals, e.g. `18.32 KB`. */
function formatKB(bytes: number): string {
    return (bytes / 1024).toFixed(2) + " KB";
}

/**
 * Classifies a `#id`-scoped rule's selector into the shape of duplication it
 * represents, for the summary's "scope" column: a bare `#id` (the plain base
 * rule), a state suffix (`.pressed`, `:hover`, …), or a pseudo-element
 * (`::-webkit-scrollbar`).
 */
function classifySelector(selector: string): string {
    if (selector.includes("::")) return "pseudo-element";
    if (selector.slice(1).includes(":") || selector.slice(1).includes(".")) return "state suffix";
    return "plain";
}

/** The concrete component class name for a `.ts-ui-component` element, e.g. `"Button"` from `class="ts-ui-component Button"`. */
function componentClassName(element: Element): string | null {
    return Array.from(element.classList).find(cls => cls !== COMPONENT_MARKER_CLASS) ?? null;
}

/**
 * Maps every live component's escaped `#<id>` selector prefix to its concrete
 * class name. A stylesheet rule's selector may carry a state/pseudo suffix
 * after the id (`.pressed`, `:hover:not(.pressed)`, `::-webkit-scrollbar`),
 * and the id itself is CSS-escaped when it starts with a digit (component ids
 * are UUIDs, so this is the common case, not an edge case) — matching by
 * re-escaping each live element's id and testing it as a selector prefix
 * avoids having to hand-parse where the id ends and the suffix begins.
 */
function buildComponentIndex(): Map<string, string> {
    const index = new Map<string, string>();

    for (const element of document.querySelectorAll(`.${COMPONENT_MARKER_CLASS}`)) {
        if (!element.id) {
            continue;
        }

        const name = componentClassName(element);
        if (name) {
            index.set("#" + CSS.escape(element.id), name);
        }
    }

    return index;
}

/** Resolves the component class name owning a rule's selector via the id-prefix index from {@link buildComponentIndex}. */
function componentNameForSelector(selector: string, index: Map<string, string>): string | null {
    for (const [idSelector, name] of index) {
        if (selector === idSelector || selector.startsWith(idSelector + ".") || selector.startsWith(idSelector + ":")) {
            return name;
        }
    }

    return null;
}

/**
 * Reads the framework's shared `<style id="Base">` stylesheet and measures
 * how much of it is duplicate content: per-instance (`#id`-scoped) rules
 * whose declaration body is byte-identical to another instance's, which a
 * shared class-level rule could collapse to one copy. Mirrors the manual CDP
 * inspection used to scope the stylesheet-dedup plans in `plans/`.
 */
function auditBaseStylesheet(): { summary: StyleAuditSummary; duplicates: DuplicateRuleRow[] } {
    const styleElement = document.getElementById("Base") as HTMLStyleElement | null;
    const sheet        = styleElement?.sheet ?? null;

    const emptySummary: StyleAuditSummary = {
        totalRules: 0, totalSizeKB: formatKB(0), componentRuleCount: 0, uniqueBodyCount: 0, wastedKB: formatKB(0),
    };

    if (!sheet) {
        return { summary: emptySummary, duplicates: [] };
    }

    const componentIndex = buildComponentIndex();
    const rules = Array.from(sheet.cssRules);
    let totalBytes = 0;
    let componentRuleCount = 0;

    const bodies = new Map<string, { count: number; scope: string; componentNames: Set<string> }>();

    for (const rule of rules) {
        const text = rule.cssText ?? "";
        totalBytes += text.length;

        const selector = (rule as CSSStyleRule).selectorText;
        if (!selector || !selector.startsWith("#")) {
            continue;
        }

        componentRuleCount++;

        const body = text.slice(text.indexOf("{"));
        const scope = classifySelector(selector);
        const componentName = componentNameForSelector(selector, componentIndex);
        const entry = bodies.get(body);

        if (entry) {
            entry.count++;
            if (componentName) entry.componentNames.add(componentName);
        } else {
            const componentNames = new Set<string>();
            if (componentName) componentNames.add(componentName);
            bodies.set(body, { count: 1, scope, componentNames });
        }
    }

    const dupeStats: { body: string; count: number; scope: string; componentNames: Set<string>; wastedBytes: number }[] = [];
    let totalWastedBytes = 0;

    for (const [body, { count, scope, componentNames }] of bodies) {
        if (count <= 1) {
            continue;
        }

        const wastedBytes = body.length * (count - 1);
        totalWastedBytes += wastedBytes;

        dupeStats.push({ body, count, scope, componentNames, wastedBytes });
    }

    dupeStats.sort((a, b) => b.wastedBytes - a.wastedBytes);

    const duplicates: DuplicateRuleRow[] = dupeStats.slice(0, MAX_ROWS).map(stat => ({
        count:     stat.count,
        wastedKB:  formatKB(stat.wastedBytes),
        component: stat.componentNames.size > 0 ? Array.from(stat.componentNames).sort().join(", ") : "—",
        scope:     stat.scope,
        body:      stat.body.length > BODY_PREVIEW_LENGTH ? stat.body.slice(0, BODY_PREVIEW_LENGTH - 1) + "…" : stat.body,
    }));

    return {
        summary: {
            totalRules: rules.length,
            totalSizeKB: formatKB(totalBytes),
            componentRuleCount,
            uniqueBodyCount: bodies.size,
            wastedKB: formatKB(totalWastedBytes),
        },
        duplicates,
    };
}

/**
 * Live dedup audit of the shared `<style id="Base">` stylesheet: counts how
 * many per-instance (`#id`-scoped) CSS rules on the current page are
 * byte-identical to another instance's, and how many bytes a shared
 * class-level rule could reclaim. Built to spot the pattern the
 * `hoist-button-tabbar-state-chrome-rules` and `suppress-empty-style-rules`
 * plans fix, and to catch it recurring in a future component.
 *
 * @category Demo
 */
class StyleAuditPanel extends Panel {

    private readonly _summary: Text;
    private readonly _store:   MemoryStore;

    constructor() {
        super({ layoutManager: new VBox({ spacing: 8 }), autoScroll: "auto" });

        this.addComponent(new Header("Stylesheet Dedup Audit"));
        this.addComponent(new Text(
            "Scans the framework's shared #Base stylesheet for per-instance (#id) rules whose "
            + "declaration body duplicates another instance's — bytes a shared class-level rule "
            + "could collapse to one copy. Switch tabs to populate more components, then refresh.",
            { whiteSpace: "normal" },
        ));

        const refreshButton = new Button("Refresh");
        Event.addListener(refreshButton, "click", () => this.refresh());
        this.addComponent(refreshButton);

        this._summary = new Text("", { whiteSpace: "normal" });
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
            columns: [
                { field: "count",     minWidth: 70,  readOnly: true },
                { field: "wastedKB",  minWidth: 100, readOnly: true },
                { field: "component", minWidth: 140, readOnly: true },
                { field: "scope",     minWidth: 110, readOnly: true },
                { field: "body",      minWidth: 420, readOnly: true },
            ],
        };

        this.addComponent(new Table(this._store, spec), { weight: 1 });

        this.refresh();
    }

    private refresh(): void {
        const { summary, duplicates } = auditBaseStylesheet();

        this._summary.setText(
            `Total rules: ${summary.totalRules} · Total size: ${summary.totalSizeKB} · `
            + `Per-instance (#id) rules: ${summary.componentRuleCount} · Unique bodies: ${summary.uniqueBodyCount} · `
            + `Estimated dedupeable size: ${summary.wastedKB}`,
        );

        this._store.loadData(duplicates);
    }
}

const StyleAuditPanelCallable = callable(StyleAuditPanel);
type StyleAuditPanelCallable = StyleAuditPanel;
export {
    StyleAuditPanel         as _StyleAuditPanel,
    StyleAuditPanelCallable as StyleAuditPanel
};
