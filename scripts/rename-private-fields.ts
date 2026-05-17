/**
 * One-off driver: rename every `private` / `protected` instance field under a
 * given bucket of `src/typescript/lib/` to carry a leading underscore.
 *
 * Public fields, static fields, and accessor (`getX`/`setX`) method names are
 * out of scope. Already-prefixed fields are skipped (idempotent re-run safe).
 *
 * Usage:
 *   tsx scripts/rename-private-fields.ts [bucket] [--dry-run]
 *
 *   bucket    default `src/typescript/lib` — pass e.g. `src/typescript/lib/core`
 *             to scope a single phase per the plan's Order of Operations.
 *   --dry-run log every intended rename without saving.
 */

import { Project, Scope, PropertyDeclaration } from "ts-morph";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positional = args.filter((a) => !a.startsWith("--"));
const bucket = positional[0] ?? "src/typescript/lib";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });

const glob = `${bucket.replace(/\/+$/, "")}/**/*.ts`;
const sourceFiles = project.getSourceFiles(glob);

let renameCount = 0;

for (const sf of sourceFiles) {
    for (const cls of sf.getClasses()) {
        for (const prop of cls.getInstanceProperties()) {
            if (!(prop instanceof PropertyDeclaration)) {
                continue;
            }

            const scope = prop.getScope();

            if (scope !== Scope.Private && scope !== Scope.Protected) {
                continue;
            }

            const name = prop.getName();

            if (name.startsWith("_")) {
                continue;
            }

            const className = cls.getName() ?? "<anonymous>";
            const filePath = sf.getFilePath();

            console.log(`${filePath}: ${className}.${name} -> _${name}`);
            renameCount++;

            if (!dryRun) {
                prop.rename(`_${name}`);
            }
        }
    }
}

console.log(`\nTotal renames: ${renameCount}${dryRun ? " (dry-run)" : ""}`);

if (!dryRun) {
    project.saveSync();
}
