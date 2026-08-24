// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { COMPONENT_CLASS } from "~/core/ClassStyleRules.js";
import { DOM } from "~/core/DOM.js";
import { styleRuleEntries } from "~/core/StyleTarget.js";

/** How many duplicate-body rows to show, ranked by bytes wasted. */
const MAX_ROWS = 25;

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

    for (const handle of DOM.source.querySelectorAll(DOM.source.getBody(), `.${COMPONENT_CLASS}`)) {
        const id = DOM.source.getId(handle);
        if (!id) continue;

        const classAttr = DOM.source.getAttribute(handle, "class") ?? "";
        const name = classAttr.split(/\s+/).find((cls) => cls !== "" && cls !== COMPONENT_CLASS);

        if (name) {
            index.set("#" + DOM.source.escapeSelector(id), name);
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
 * Per-metric summary counts for {@link StyleAuditResult}.
 *
 * @category Core
 */
export interface StyleAuditSummary {
    totalRules:         number;
    totalSizeKB:        string;
    componentRuleCount: number;
    uniqueBodyCount:    number;
    wastedKB:           string;
}

/**
 * One duplicate-body group, ranked by bytes wasted.
 *
 * @category Core
 */
export interface DuplicateRuleRow {
    count:     number;
    wastedKB:  string;
    component: string;
    scope:     string;
    body:      string;
}

/**
 * The full result of {@link auditStyleRules}.
 *
 * @category Core
 */
export interface StyleAuditResult {
    summary:    StyleAuditSummary;
    duplicates: DuplicateRuleRow[];
}

/**
 * Audits the framework's shared stylesheet for per-instance (`#id`-scoped)
 * rules whose declaration body duplicates another instance's. Ranks the
 * worst offenders by bytes wasted, capped to the top 25.
 *
 * @returns The {@link StyleAuditResult}.
 */
export function auditStyleRules(): StyleAuditResult {
    const componentIndex = buildComponentIndex();
    const entries        = styleRuleEntries();

    let totalBytes         = 0;
    let componentRuleCount = 0;

    const bodies = new Map<string, { count: number; scope: string; componentNames: Set<string> }>();

    for (const entry of entries) {
        totalBytes += entry.cssText.length;

        if (!entry.selector.startsWith("#")) {
            continue;
        }

        componentRuleCount++;

        const body         = entry.cssText.slice(entry.cssText.indexOf("{"));
        const scope        = classifySelector(entry.selector);
        const componentName = componentNameForSelector(entry.selector, componentIndex);
        const existing      = bodies.get(body);

        if (existing) {
            existing.count++;
            if (componentName) existing.componentNames.add(componentName);
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

    const duplicates: DuplicateRuleRow[] = dupeStats.slice(0, MAX_ROWS).map((stat) => ({
        count:     stat.count,
        wastedKB:  formatKB(stat.wastedBytes),
        component: stat.componentNames.size > 0 ? Array.from(stat.componentNames).sort().join(", ") : "—",
        scope:     stat.scope,
        body:      stat.body,
    }));

    return {
        summary: {
            totalRules: entries.length,
            totalSizeKB: formatKB(totalBytes),
            componentRuleCount,
            uniqueBodyCount: bodies.size,
            wastedKB: formatKB(totalWastedBytes),
        },
        duplicates,
    };
}
