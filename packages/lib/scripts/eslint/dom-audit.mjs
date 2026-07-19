// Independent cross-check that the type-aware no-raw-dom rule is not missing a
// whole category. This mechanism is deliberately NOT type-based: it greps the
// lib for DOM-only API names that have no framework collision (a framework
// object never has `addEventListener` / `getBoundingClientRect` / `querySelector`
// / `getComputedStyle` / …). Every such raw hit must be either inside the seam
// (`core/DOM.ts`), already routed (`DOM.sink.` / `DOM.source.`), or present in
// the no-raw-dom baseline. A hit that is none of those is a DOM access the type
// rule failed to flag — the script exits non-zero so two independent mechanisms
// must agree.
//
// Usage: npm run lint:dom-audit

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const LIB = "src/typescript/lib";
const baselineKeys = new Set(
    JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts/eslint/no-raw-dom.baseline.json"), "utf8"))
);
const baselinedSites = new Set([...baselineKeys].map((k) => k.split(":").slice(0, 2).join(":")));

// DOM-only members / globals with no framework lookalike. (Ambiguous names like
// .style/.children/.id/.contains are intentionally excluded — only the type rule
// can adjudicate those; this sweep proves no DOM-distinctive category slips by.)
const PATTERNS = [
    "addEventListener", "removeEventListener", "dispatchEvent",
    "getBoundingClientRect", "getClientRects",
    "querySelector", "querySelectorAll",
    "appendChild", "removeChild", "insertBefore", "replaceChild", "cloneNode",
    "scrollIntoView", "getContext",
    "getComputedStyle", "matchMedia", "requestAnimationFrame", "cancelAnimationFrame",
    "elementsFromPoint", "createElement",
];

const regex = new RegExp("\\b(" + PATTERNS.join("|") + ")\\b");

let raw = "";

try {
    // ripgrep-free: git grep with line numbers across the lib.
    raw = execSync(`git grep -n -E "\\b(${PATTERNS.join("|")})\\(" -- "${LIB}/**/*.ts"`, { encoding: "utf8" });
} catch (e) {
    raw = e.stdout ? e.stdout.toString() : "";
}

const misses = [];

for (const line of raw.split("\n")) {
    if (!line) {
        continue;
    }

    const firstColon  = line.indexOf(":");
    const secondColon = line.indexOf(":", firstColon + 1);
    const file = line.slice(0, firstColon);
    const lineNo = line.slice(firstColon + 1, secondColon);
    const text = line.slice(secondColon + 1);

    // Exemptions: the seam itself, the measurement leaf relocation target, and
    // anything already routed through the seam.
    if (file === `${LIB}/core/DOM.ts`) {
        continue;
    }

    if (/\bDOM\.(sink|source)\./.test(text)) {
        continue;
    }

    // Comments / JSDoc lines.
    const trimmed = text.trim();

    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
        continue;
    }

    if (!regex.test(text)) {
        continue;
    }

    const site = `${file}:${lineNo}`;

    if (!baselinedSites.has(site)) {
        misses.push(`${site}  ${trimmed}`);
    }
}

if (misses.length > 0) {
    console.error(`dom-audit: ${misses.length} DOM-only API use(s) neither seamed nor baselined — the type rule missed them:`);

    for (const m of misses) {
        console.error("  " + m);
    }

    process.exit(1);
}

console.log(`dom-audit: clean — every DOM-only API use in ${LIB} is seamed (DOM.sink/DOM.source, core/DOM.ts) or baselined.`);
