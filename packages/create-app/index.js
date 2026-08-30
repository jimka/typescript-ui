// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Pure helpers, filesystem writer, and CLI entry for the `@jimka/create-tsui-app`
 * scaffolder. Plain ESM, no build step — this file is shipped as-is (see
 * `## Architecture Decisions` in plans/implemented/create-tsui-app.md).
 */

import { existsSync, readdirSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

/** Maps a template-side basename to its on-disk destination name. */
const RENAME_MAP = new Map([['_gitignore', '.gitignore']]);

/** Absolute path to the template directory this package ships. */
const TEMPLATE_DIR = fileURLToPath(new URL('./template', import.meta.url));

/** Package name used when a directory name sanitises away to nothing. */
const FALLBACK_PACKAGE_NAME = 'typescript-ui-app';

/**
 * Pre-existing entries that don't block scaffolding a target directory.
 * Mirrors the ignore list other `create-*` scaffolders (e.g. create-vite)
 * use for a freshly `git init`-ed or IDE-touched directory. Deliberately
 * excludes anything the template itself writes (e.g. `.gitignore`), so a
 * pre-existing file with the same name is never silently overwritten.
 */
const SAFE_EXISTING_ENTRIES = new Set([
    '.git',
    '.gitattributes',
    '.hg',
    '.hgcheck',
    '.hgignore',
    '.idea',
    '.vscode',
    '.DS_Store',
    'Thumbs.db',
]);

/**
 * Convert an arbitrary target-dir name into a valid npm package name.
 *
 * A name built only from characters this strips — `...`, `--`, or a
 * non-Latin name like `ÅÄÖ` — sanitises down to the empty string, which npm
 * rejects as a package name, so the fallback stands in for it.
 * @param {string} input - The raw directory name.
 * @returns {string} A name satisfying npm's package-name rules.
 */
export function toValidPackageName(input) {
    const sanitised = input
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[._]+/, '')
        .replace(/^-+|-+$/g, '');

    return sanitised || FALLBACK_PACKAGE_NAME;
}

/**
 * Map a template filename to its on-disk name (`_gitignore` → `.gitignore`).
 * @param {string} name - The template-side basename.
 * @returns {string} The destination basename.
 */
export function renameTemplateFile(name) {
    return RENAME_MAP.get(name) ?? name;
}

/**
 * True when a target directory's entry list permits scaffolding: empty, or
 * containing only pre-existing entries from `SAFE_EXISTING_ENTRIES` (e.g. a
 * `.git` directory from `git init`).
 * @param {string[]} entries - Directory entries.
 * @returns {boolean} Whether scaffolding may proceed.
 */
export function isEmpty(entries) {
    return entries.every((entry) => SAFE_EXISTING_ENTRIES.has(entry));
}

/**
 * Parse argv into `{ help, targetDir }` (targetDir undefined when omitted).
 * Uses node:util parseArgs with `allowPositionals: true`.
 * @param {string[]} argv - Arguments after the node binary and script.
 * @returns {{ help: boolean, targetDir: string | undefined }} The parsed flags.
 * @throws Error - when more than one positional argument is given.
 */
export function parseCliArgs(argv) {
    const { values, positionals } = parseArgs({
        args:             argv,
        options:          { help: { type: 'boolean', short: 'h' } },
        allowPositionals: true,
    });

    if (positionals.length > 1) {
        throw new Error(`unexpected extra argument(s): ${positionals.slice(1).join(', ')}`);
    }

    return { help: values.help === true, targetDir: positionals[0] };
}

/**
 * Recursively copy `src` to `dest`, renaming each destination basename via
 * `renameTemplateFile`. Manual walk (not `fs.cpSync`) because `cpSync` has no
 * per-entry rename hook.
 * @param {string} src - Source directory (template or a subdirectory of it).
 * @param {string} dest - Destination directory (created if absent).
 * @returns {void}
 */
function copyTemplateDir(src, dest) {
    mkdirSync(dest, { recursive: true });

    for (const entry of readdirSync(src, { withFileTypes: true })) {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, renameTemplateFile(entry.name));

        if (entry.isDirectory()) {
            copyTemplateDir(srcPath, destPath);
        } else {
            copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * Write the template to `targetDir`, applying renames and the package-name
 * substitution. Filesystem-only — it never touches the registry — so it is
 * unit-tested against a temp dir (see `## Expected Behaviour`).
 * @param {string} targetDir - Destination directory.
 * @returns {Promise<void>} Resolves once the starter is written.
 */
export async function scaffold(targetDir) {
    if (existsSync(targetDir) && !isEmpty(readdirSync(targetDir))) {
        throw new Error(`target directory "${targetDir}" is not empty`);
    }

    mkdirSync(targetDir, { recursive: true });
    copyTemplateDir(TEMPLATE_DIR, targetDir);

    const packageJsonPath = join(targetDir, 'package.json');
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    pkg.name = toValidPackageName(basename(targetDir));
    writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
}

/**
 * Ask once for the target directory via node:readline/promises, closing the
 * interface in a finally.
 * @returns {Promise<string>} The answer, trimmed.
 */
export async function promptForTargetDir() {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    try {
        return (await rl.question('Project directory: ')).trim();
    } finally {
        rl.close();
    }
}

/**
 * Print CLI usage to stdout.
 * @returns {void}
 */
function printUsage() {
    console.log(`Usage: create-tsui-app [target-directory] [options]

Scaffold a minimal typescript-ui starter project.

Options:
  -h, --help   Print this usage information.`);
}

/**
 * CLI entry: parse args, prompt when the directory is omitted, scaffold, then
 * print next steps.
 * @param {string[]} argv - Arguments after the node binary and script.
 * @param {() => Promise<string>} [ask] - Prompt seam; defaults to
 *   promptForTargetDir. Supplied only by tests, never by the bin wrapper.
 * @returns {Promise<void>} Resolves once scaffolding completes.
 */
export async function main(argv, ask = promptForTargetDir) {
    const { help, targetDir } = parseCliArgs(argv);

    if (help) {
        printUsage();
        return;
    }

    const dir = targetDir ?? (await ask());

    if (dir === '') {
        throw new Error('no project directory given (use "." for the current directory)');
    }

    const target = resolve(process.cwd(), dir);

    await scaffold(target);

    console.log(`\nScaffolded a typescript-ui app in ${target}\n`);
    console.log('Next steps:');
    console.log(`  cd ${dir}`);
    console.log('  npm install');
    console.log('  npm run dev');
}
