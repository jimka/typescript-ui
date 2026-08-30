/**
 * One-shot codegen for Font Awesome Free SVGs.
 *
 * Reads SVGs from <argv[2]>/{solid,regular,brands}/ and emits one TypeScript
 * file per icon under src/typescript/lib/glyphs/<style>/<identifier>.ts.
 *
 * Usage:
 *   npx tsx scripts/import-fontawesome.ts vendor/package/svgs/
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const STYLES = ["solid", "regular", "brands"] as const;
type Style = (typeof STYLES)[number];

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const OUT_ROOT = join(REPO_ROOT, "src/typescript/lib/glyphs");

interface IconRecord {
    name: string;        // original icon name, e.g. "arrow-right"
    identifier: string;  // sanitized JS identifier, e.g. "arrow_right"
    viewBox: string;
    path: string;
}

function sanitize(name: string): string {
    let id = name.replace(/-/g, "_");
    if (/^[0-9]/.test(id)) id = "_" + id;
    return id;
}

function parseSvg(source: string, file: string): { viewBox: string; path: string } {
    const viewBoxMatch = source.match(/<svg\b[^>]*\bviewBox="([^"]+)"/);
    if (!viewBoxMatch) throw new Error(`No viewBox in ${file}`);
    const viewBox = viewBoxMatch[1];

    const pathMatches = [...source.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)];
    if (pathMatches.length === 0) throw new Error(`No <path> in ${file}`);
    if (pathMatches.length > 1) throw new Error(`Multiple <path> elements in ${file} (got ${pathMatches.length})`);

    return { viewBox, path: pathMatches[0][1] };
}

/** Header for the generated barrels: project-licensed index files carrying no Font Awesome asset data. */
const BARREL_HEADER = "// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0\n\n";

function renderIconFile(rec: IconRecord): string {
    return `// SPDX-License-Identifier: CC-BY-4.0
// Source: Font Awesome Free 7.2.0, https://fontawesome.com/license/free
// © Fonticons, Inc.
import type { NamedGlyphDef } from "~/component/display/Glyphs.js";

export const ${rec.identifier}: NamedGlyphDef = {
    name:    "${rec.name}",
    kind:    "svg",
    viewBox: "${rec.viewBox}",
    path:    "${rec.path}"
};
`;
}

async function readVersion(svgsDir: string): Promise<string> {
    const pkgPath = resolve(svgsDir, "..", "package.json");
    try {
        const raw = await readFile(pkgPath, "utf8");
        const json = JSON.parse(raw) as { version?: string };
        if (json.version) return json.version;
    } catch {
        /* fallthrough */
    }
    return "7.2.0";
}

async function processStyle(svgsDir: string, style: Style): Promise<IconRecord[]> {
    const dir = join(svgsDir, style);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".svg")).sort();

    const records: IconRecord[] = [];
    for (const file of files) {
        const fullPath = join(dir, file);
        const source = await readFile(fullPath, "utf8");
        const { viewBox, path } = parseSvg(source, fullPath);
        const name = file.slice(0, -".svg".length);
        const identifier = sanitize(name);
        records.push({ name, identifier, viewBox, path });
    }

    const outDir = join(OUT_ROOT, style);
    await mkdir(outDir, { recursive: true });

    for (const rec of records) {
        await writeFile(join(outDir, `${rec.identifier}.ts`), renderIconFile(rec), "utf8");
    }

    const indexLines = BARREL_HEADER + records.map((r) => `export * from "./${r.identifier}.js";`).join("\n") + "\n";
    await writeFile(join(outDir, "index.ts"), indexLines, "utf8");

    return records;
}

async function writeTopLevelBarrel(): Promise<void> {
    const content =
        BARREL_HEADER +
        `export * as solid from "./solid/index.js";\n` +
        `export * as regular from "./regular/index.js";\n` +
        `export * as brands from "./brands/index.js";\n`;
    await writeFile(join(OUT_ROOT, "index.ts"), content, "utf8");
}

async function writeReadme(version: string): Promise<void> {
    const md = `# Font Awesome Free Glyphs

Generated from Font Awesome Free ${version} by \`scripts/import-fontawesome.ts\`. Do not edit by hand — re-run the script.

## Identifier sanitization

Filenames are translated to JavaScript identifiers with two rules:

1. Replace every \`-\` with \`_\`. So \`arrow-right.svg\` → \`arrow_right\`.
2. If the first character is a digit, prefix with \`_\`. So \`500px.svg\` → \`_500px\`, \`42-group.svg\` → \`_42_group\`.

The original (hyphenated, digit-leading) name is preserved as the \`name\` field on each \`NamedGlyphDef\`, so the registry key matches the upstream FA name.

## Import patterns

Namespaced bulk import (recommended for registering many icons at once):

\`\`\`ts
import { solid } from "@jimka/typescript-ui/glyphs";

Glyph.register(solid.xmark);
Glyph.register(solid.arrow_right);
\`\`\`

Per-style import (avoids loading other styles):

\`\`\`ts
import { xmark, arrow_right } from "@jimka/typescript-ui/glyphs/solid";
\`\`\`

Per-icon import (smallest unit, lets bundlers tree-shake):

\`\`\`ts
import { xmark } from "@jimka/typescript-ui/glyphs/solid/xmark.js";
\`\`\`

The top-level barrel uses \`export * as solid\` / \`regular\` / \`brands\` so identifiers that collide across styles (e.g. \`heart\`) stay distinct.

## License

Each generated icon file carries:

\`\`\`
// SPDX-License-Identifier: CC-BY-4.0
// Source: Font Awesome Free ${version}, https://fontawesome.com/license/free
// © Fonticons, Inc.
\`\`\`

See [\`LICENSE-FONTAWESOME.md\`](../../../../LICENSE-FONTAWESOME.md) and [\`THIRD-PARTY-NOTICES.md\`](../../../../THIRD-PARTY-NOTICES.md) at the package root for full attribution.
`;
    await writeFile(join(OUT_ROOT, "README.md"), md, "utf8");
}

async function main(): Promise<void> {
    const svgsArg = process.argv[2];
    if (!svgsArg) {
        console.error("Usage: tsx scripts/import-fontawesome.ts <path-to-vendor/package/svgs>");
        process.exit(1);
    }
    const svgsDir = resolve(svgsArg);
    const version = await readVersion(svgsDir);

    await mkdir(OUT_ROOT, { recursive: true });

    const counts: Record<Style, number> = { solid: 0, regular: 0, brands: 0 };
    for (const style of STYLES) {
        const records = await processStyle(svgsDir, style);
        counts[style] = records.length;
    }

    await writeTopLevelBarrel();
    await writeReadme(version);

    const total = counts.solid + counts.regular + counts.brands;
    console.log(
        `Generated ${total} icons (solid=${counts.solid}, regular=${counts.regular}, brands=${counts.brands}) from FA Free ${version}`
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
