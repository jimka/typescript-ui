// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Generator for the AI-agent capability manifest (`llms.txt`).
 *
 * Reads the curated seam (`manifest.data.mjs`) and the TypeDoc JSON model emitted by
 * `docs:api`, resolves each curated symbol to its owning module (= import subpath) and
 * first-paragraph JSDoc summary, and renders TWO variants of the manifest from one
 * resolved row set:
 *   - `llms.txt` (repo root, committed)              — filesystem-relative `.md` links,
 *                                                       for coding agents that can `Read`
 *                                                       the repo.
 *   - `../docs/public/llms.txt` (gitignored)         — site URLs, for web agents fetching
 *                                                       the hosted copy; the docs app's
 *                                                       Vite public directory copies it to
 *                                                       the site root. Contains zero
 *                                                       `docs/` paths.
 *
 * The seam holds every human-authored word; this script derives all import subpaths,
 * summaries, and links — so they cannot drift from source. A curated symbol that is
 * renamed, removed, or ambiguously colliding fails the build (see resolveSymbol).
 *
 * Run: `node scripts/llms/generate.mjs` (from the repo root, after `docs:api`).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { groups, conventions, mentalModel, drillDown, devAppendix, proseTargets } from "./manifest.data.mjs";

/** Path to the TypeDoc JSON model (emitted by `docs:api` via typedoc.json `"json"`). */
const MODEL_PATH = "docs/api/typedoc-model.json";

/** Committed, filesystem-link output read by in-repo coding agents. */
const ROOT_OUT = "llms.txt";

/** Gitignored, site-link output the docs app's public directory deploys at the site root for web agents. */
const SITE_OUT = "../docs/public/llms.txt";

/** npm package name — the import-subpath prefix printed in every catalog row. */
const PACKAGE = "@jimka/typescript-ui";

/** Deployed docs-site base (the docs app's Vite `base`); site-mode link prefix. */
const SITE_BASE = "https://jimka.github.io/typescript-ui/";

/** GitHub blob base for repo-root docs the site does not publish (ARCHITECTURE.md, …). */
const GITHUB_BLOB = "https://github.com/jimka/typescript-ui/blob/master/";

/**
 * Hard token ceiling per output file. The manifest is always-loaded context for an
 * agent, so its cost must stay bounded as the catalog grows; the build fails past this.
 *
 * Raised from 6000: the site variant (longer absolute URLs than the fs variant)
 * was already at ~5994/6000 before the CheckboxMenuRow catalog entry, so adding
 * one further minimally-worded row (task + capped summary + link) still crossed
 * the prior ceiling. Nudged up by the minimum needed rather than trimming
 * existing hand-authored catalog wording to make room.
 *
 * Raised again from 6100: the RadioMenuRow catalog entry pushed the site
 * variant to ~6106/6100, for the same reason as the CheckboxMenuRow raise
 * above — one more minimally-worded row.
 *
 * Raised again from 6110: the PopupPanel + PopupButton catalog entries
 * pushed the site variant to ~6258/6110 — two more minimally-worded rows.
 *
 * Raised again from 6260: the DiagnosticsOverlay catalog entry pushed the
 * site variant to ~6349/6260 — one more minimally-worded row.
 *
 * Raised again from 6350: the StyleAuditOverlay catalog entry pushed the
 * site variant to ~6438/6350 — one more minimally-worded row.
 *
 * Raised again from 6440: the WebGLCanvas / Video / VideoPlayer entries and
 * the new "Charts / Diagrams" group (LineChart, BarChart, ChartLegend,
 * DiagramView) pushed the site variant to ~6931/6440 — seven more
 * minimally-worded rows plus one new group heading.
 */
const TOKEN_BUDGET = 6940;

/** Max summary length (chars). Bounds a single row so the catalog stays under budget. */
const SUMMARY_CAP = 140;

/** Rough chars-per-token divisor for the byte-pair token estimate (no tokenizer dep). */
const CHARS_PER_TOKEN = 4;

/** TypeDoc `ReflectionKind` for a class — the catalog's components. */
const KIND_CLASS = 128;

/** TypeDoc `ReflectionKind` for an interface — indexed so colliding names still resolve. */
const KIND_INTERFACE = 256;

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
 * Index every exported class/interface by its owning module.
 *
 * The module's `name` is the full `package.json` exports subpath, so it is the import
 * subpath directly — no filename parsing. Keying by `(subpath, symbol)` keeps
 * same-named symbols in different modules distinct (Body, TreeNode, BorderOptions).
 *
 * @param model - the parsed TypeDoc model.
 * @returns a `Map<subpath, Map<symbolName, node>>`.
 */
function buildSymbolIndex(model) {
    const index = new Map();

    for (const module of model.children ?? []) {
        const bySymbol = new Map();

        for (const child of module.children ?? []) {
            if (child.kind === KIND_CLASS || child.kind === KIND_INTERFACE) {
                bySymbol.set(child.name, child);
            }
        }

        index.set(module.name, bySymbol);
    }

    return index;
}

/**
 * Resolve a curated entry to exactly one `(subpath, node)` match — the drift guard.
 *
 * @param entry - a seam entry `{ symbol, subpath? }`.
 * @param index - the `(subpath, symbol)` index from buildSymbolIndex.
 * @returns the resolved `{ subpath, node }`.
 * @throws Error - if the symbol resolves to zero matches (renamed/removed) or to more
 *   than one with no `subpath` disambiguator (ambiguous colliding name).
 */
function resolveSymbol(entry, index) {
    const matches = [];

    for (const [subpath, bySymbol] of index) {
        if (bySymbol.has(entry.symbol) && (entry.subpath === undefined || entry.subpath === subpath)) {
            matches.push({ subpath, node: bySymbol.get(entry.symbol) });
        }
    }

    if (matches.length === 0) {
        const where = entry.subpath ? ` in module "${entry.subpath}"` : "";

        throw new Error(`Manifest symbol "${entry.symbol}" not found${where} in the TypeDoc model (renamed or removed?).`);
    }

    if (matches.length > 1) {
        const modules = matches.map((m) => m.subpath).join(", ");

        throw new Error(`Manifest symbol "${entry.symbol}" is ambiguous — found in ${modules}; add a \`subpath\` disambiguator.`);
    }

    return matches[0];
}

/**
 * Extract a one-line summary from a symbol's JSDoc.
 *
 * Joins every comment-summary part by its rendered `.text` (text parts verbatim, `code`
 * parts already carry their backticks, `inline-tag` parts such as `{@link Foo}` render
 * as their `.text` so no word is dropped), takes the first paragraph, collapses
 * whitespace, and strips any inline markdown links to their display text — an author
 * may write `[`Container`](/api/…)` in the JSDoc lead, which is link clutter in a
 * one-line row and would otherwise leak a `/api/…` URL into the output. Caps the length.
 *
 * @param node - the resolved TypeDoc reflection.
 * @returns the summary string (empty if the symbol has no JSDoc).
 */
function summarize(node) {
    const parts = node.comment?.summary ?? [];
    const joined = parts.map((part) => part.text ?? "").join("");
    const firstParagraph = joined.split(/\n\s*\n/)[0] ?? "";
    const unlinked = firstParagraph.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    const collapsed = unlinked.replace(/\s+/g, " ").trim();

    if (collapsed.length > SUMMARY_CAP) {
        // Reserve the last of the SUMMARY_CAP characters for the appended ellipsis.
        return `${collapsed.slice(0, SUMMARY_CAP - 1).trimEnd()}…`;
    }

    return collapsed;
}

/**
 * Resolve a row's canonical (repo-relative) doc target.
 *
 * Uses an explicit `doc` override when present; otherwise probes the component and
 * layout doc directories for a page named after the symbol.
 *
 * @param entry - the seam entry.
 * @param warnings - collector appended to when no page is found.
 * @returns the canonical repo-relative `.md` path, or null if none exists.
 */
function resolveDoc(entry, warnings) {
    const candidates = entry.doc
        ? [entry.doc]
        : [`docs/components/${entry.symbol}.md`, `docs/layouts/${entry.symbol}.md`];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    warnings.push(`No doc page found for "${entry.symbol}" (tried ${candidates.join(", ")}) — row emitted without a link.`);

    return null;
}

/**
 * Render a canonical target as a link in the requested mode — the single link function.
 *
 * @param target - a canonical repo-relative path (page, section root, or repo-root doc).
 * @param mode - `"fs"` for filesystem-relative paths, `"site"` for deployed URLs.
 * @returns the link string.
 */
function linkFor(target, mode) {
    if (mode === "fs") {
        return target;
    }

    if (target.startsWith("docs/")) {
        return SITE_BASE + target.slice("docs/".length).replace(/\.md$/, "");
    }

    // Repo-root doc (ARCHITECTURE.md, CODE_CONVENTIONS.md) — not served by the site.
    return GITHUB_BLOB + target;
}

/**
 * Build the resolved row set once (shared by both output variants).
 *
 * @param index - the `(subpath, symbol)` index.
 * @param warnings - collector for missing-doc warnings.
 * @returns groups with each entry resolved to `{ task, symbol, subpath, summary, target }`.
 */
function buildRows(index, warnings) {
    return groups.map((group) => ({
        name: group.name,
        rows: group.entries.map((entry) => {
            const { subpath, node } = resolveSymbol(entry, index);

            return {
                task: entry.task,
                symbol: entry.symbol,
                subpath,
                summary: summarize(node),
                target: resolveDoc(entry, warnings),
            };
        }),
    }));
}

/**
 * Replace every `{{key}}` placeholder in a prose block with a mode-resolved link.
 *
 * @param text - the prose block from the seam.
 * @param mode - the link mode.
 * @returns the prose with links resolved.
 * @throws Error - if a placeholder names a target absent from `proseTargets`.
 */
function interpolateProse(text, mode) {
    return text.replace(/\{\{([^}]+)\}\}/g, (_match, key) => {
        const target = proseTargets[key];

        if (target === undefined) {
            throw new Error(`Prose placeholder "{{${key}}}" has no entry in proseTargets.`);
        }

        return linkFor(target, mode);
    });
}

/**
 * Render one catalog row.
 *
 * @param row - a resolved row.
 * @param mode - the link mode.
 * @returns the Markdown list item.
 */
function renderRow(row, mode) {
    const link = row.target ? ` · ${linkFor(row.target, mode)}` : "";

    return `- ${row.task} → **${row.symbol}** · \`${PACKAGE}/${row.subpath}\` · ${row.summary}${link}`;
}

/**
 * Render the whole manifest for one mode.
 *
 * @param resolvedGroups - the shared resolved row set from buildRows.
 * @param mode - the link mode.
 * @returns the complete manifest text.
 */
function renderDocument(resolvedGroups, mode) {
    const lines = [];

    lines.push("<!-- GENERATED by scripts/llms/generate.mjs from scripts/llms/manifest.data.mjs — do not edit by hand -->");
    lines.push(`# ${PACKAGE} — capability manifest for AI agents`);
    lines.push("");
    lines.push("> Read this before building any UI feature against this library, so you use what");
    lines.push("> exists instead of reinventing it. Open the linked pages for detail.");
    lines.push("");
    lines.push("## Mental model");
    lines.push(interpolateProse(mentalModel, mode));
    lines.push("");
    lines.push("## Capabilities (use these — do not rebuild them)");
    lines.push("Organized by task. Columns: task → symbol · import subpath · summary · docs.");

    for (const group of resolvedGroups) {
        lines.push("");
        lines.push(`### ${group.name}`);

        for (const row of group.rows) {
            lines.push(renderRow(row, mode));
        }
    }

    lines.push("");
    lines.push("## Conventions (hard rules)");

    conventions.forEach((convention, i) => {
        lines.push(`${i + 1}. ${convention.rule} → ${linkFor(convention.doc, mode)}`);
    });

    lines.push("");
    lines.push("## Drill down");
    lines.push(interpolateProse(drillDown, mode));
    lines.push("");
    lines.push("## Developing the library");
    lines.push(interpolateProse(devAppendix, mode));
    lines.push("");

    return lines.join("\n");
}

/**
 * Estimate a text's token cost with the byte-pair chars-per-token heuristic.
 *
 * @param text - the document text.
 * @returns the estimated token count.
 */
function estimateTokens(text) {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Assert a rendered file is within the token budget, printing its estimate.
 *
 * @param name - the output file name (for messages).
 * @param text - the rendered text.
 * @returns the estimated token count.
 * @throws Error - if the estimate exceeds TOKEN_BUDGET.
 */
function assertBudget(name, text) {
    const tokens = estimateTokens(text);

    if (tokens > TOKEN_BUDGET) {
        throw new Error(`${name} is ~${tokens} tokens, over the ${TOKEN_BUDGET} budget.`);
    }

    console.log(`  ${name}: ~${tokens} tokens (${text.length} chars)`);

    return tokens;
}

/**
 * Write a file, creating its parent directory if absent.
 *
 * @param file - the output path.
 * @param text - the content to write.
 */
function writeOutput(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

/**
 * Generate both manifest variants from the TypeDoc model and the curated seam.
 */
function main() {
    const model = loadModel();
    const index = buildSymbolIndex(model);
    const warnings = [];
    const resolvedGroups = buildRows(index, warnings);

    const fsDoc = renderDocument(resolvedGroups, "fs");
    const siteDoc = renderDocument(resolvedGroups, "site");

    console.log("Generated capability manifest:");
    assertBudget(ROOT_OUT, fsDoc);
    assertBudget(SITE_OUT, siteDoc);

    writeOutput(ROOT_OUT, fsDoc);
    writeOutput(SITE_OUT, siteDoc);

    for (const warning of warnings) {
        console.warn(`  warning: ${warning}`);
    }
}

// Run only when invoked directly, so tests can import the helpers without side effects.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}

export { buildSymbolIndex, resolveSymbol, summarize, resolveDoc, linkFor, interpolateProse, renderRow, estimateTokens, assertBudget };
