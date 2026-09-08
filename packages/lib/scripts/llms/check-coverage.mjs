// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage guard for the AI-agent capability manifest (`llms.txt`).
 *
 * `generate.mjs`'s `resolveSymbol` is a drift guard in one direction: a curated
 * `groups` entry whose symbol was renamed or removed fails the build. This script
 * guards the other direction: a newly-shipped public class that nobody has triaged
 * into `groups` (catalogue it) or `excludedSymbols` (explicitly not catalogue-worthy —
 * a sub-part or framework primitive) is silent drift the build would otherwise never
 * catch, exactly how MenuBar/ToolBar/Dock/Rail and ten others sat undiscovered.
 *
 * Walks every module in the TypeDoc JSON model, collects every concrete (non-abstract)
 * class, and fails if any such class is in neither list. Also fails if an
 * `excludedSymbols` entry no longer resolves to any class — a stale exclusion left
 * behind by a rename or removal, the same drift `resolveSymbol` catches for `groups`.
 *
 * Run: `node scripts/llms/check-coverage.mjs` (from `packages/lib`, after `docs:api`).
 */

import fs from "node:fs";

import { groups, excludedSymbols } from "./manifest.data.mjs";

/** Path to the TypeDoc JSON model (emitted by `docs:api` via typedoc.json `"json"`). */
const MODEL_PATH = "docs/api/typedoc-model.json";

/** TypeDoc `ReflectionKind` for a class. */
const KIND_CLASS = 128;

/**
 * Load and parse the TypeDoc JSON model.
 *
 * @returns the parsed model (root reflection with one child Module per entry point).
 * @throws Error - if the model file is absent (run `docs:api` first).
 */
function loadModel() {
    if (!fs.existsSync(MODEL_PATH)) {
        throw new Error(`TypeDoc model not found at ${MODEL_PATH} — run \`npm run docs:api\` first.`);
    }

    return JSON.parse(fs.readFileSync(MODEL_PATH, "utf8"));
}

/**
 * Collect every concrete (non-abstract) class in the model, keyed by name to the
 * module(s) it appears in — a name can legitimately appear in more than one module
 * (e.g. `Body` in `core` and `component/table`).
 *
 * @param model - the parsed TypeDoc model.
 * @returns a `Map<className, string[]>` of owning module names.
 */
function collectConcreteClasses(model) {
    const byName = new Map();

    for (const module of model.children ?? []) {
        for (const child of module.children ?? []) {
            if (child.kind === KIND_CLASS && !child.flags?.isAbstract) {
                const modules = byName.get(child.name) ?? [];

                modules.push(module.name);
                byName.set(child.name, modules);
            }
        }
    }

    return byName;
}

function main() {
    const model = loadModel();
    const concreteClasses = collectConcreteClasses(model);

    const cataloguedSymbols = new Set(groups.flatMap((group) => group.entries.map((entry) => entry.symbol)));
    const excludedSet = new Set(excludedSymbols);

    const uncatalogued = [];

    for (const [name, modules] of concreteClasses) {
        if (!cataloguedSymbols.has(name) && !excludedSet.has(name)) {
            uncatalogued.push(`  ${name} (${modules.join(", ")})`);
        }
    }

    const staleExclusions = excludedSymbols.filter((name) => !concreteClasses.has(name));

    if (uncatalogued.length > 0) {
        throw new Error(
            `${uncatalogued.length} public component(s) are in neither manifest.data.mjs's ` +
                `\`groups\` nor \`excludedSymbols\`:\n${uncatalogued.join("\n")}\n\n` +
                `Add a task-facing row to \`groups\` if this is something a consumer would reach ` +
                `for directly, or name it in \`excludedSymbols\` with a reason if it's a sub-part ` +
                `or internal primitive.`,
        );
    }

    if (staleExclusions.length > 0) {
        const isSingular = staleExclusions.length === 1;

        throw new Error(
            `${staleExclusions.length} \`excludedSymbols\` entr${isSingular ? "y" : "ies"} no longer ` +
                `resolve${isSingular ? "s" : ""} to any class (renamed or removed?): ` +
                `${staleExclusions.join(", ")}. Remove ${isSingular ? "it" : "them"} from \`excludedSymbols\`.`,
        );
    }

    console.log(
        `Coverage OK: ${cataloguedSymbols.size} catalogued, ${excludedSet.size} explicitly excluded, ` +
            `0 unaccounted for.`,
    );
}

main();
