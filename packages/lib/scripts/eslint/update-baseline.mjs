// Regenerates scripts/eslint/no-raw-dom.baseline.json — the authoritative
// inventory of raw-DOM sites still awaiting migration. Runs the no-raw-dom rule
// with suppression disabled (NO_RAW_DOM_IGNORE_BASELINE), collects every
// reported site as a "<relpath>:<line>:<messageId>" key, and writes the sorted
// list. Each Phase-2 migration shrinks this file; the final state is `[]`.
//
// Usage: npm run lint:baseline

import { ESLint } from "eslint";
import fs from "node:fs";
import path from "node:path";

process.env.NO_RAW_DOM_IGNORE_BASELINE = "1";

const BASELINE_PATH = path.join(process.cwd(), "scripts/eslint/no-raw-dom.baseline.json");

const eslint  = new ESLint();
const results = await eslint.lintFiles(["src/typescript/lib/**/*.ts"]);

const keys = [];

for (const result of results) {
    const rel = path.relative(process.cwd(), result.filePath).split(path.sep).join("/");

    for (const message of result.messages) {
        if (message.ruleId === "local/no-raw-dom") {
            keys.push(rel + ":" + message.line + ":" + message.messageId);
        }
    }
}

keys.sort();

fs.writeFileSync(BASELINE_PATH, JSON.stringify(keys, null, 2) + "\n");

console.log("Wrote " + keys.length + " baselined sites to " + path.relative(process.cwd(), BASELINE_PATH));
