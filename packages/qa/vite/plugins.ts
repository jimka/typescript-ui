// The QA app's Vite plugins and config helpers. Node-side: the page never
// imports this file.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Plugin } from 'vite';

/** One entry of Vite's `resolve.alias` array, with a regex `find`. */
interface RegexAlias {
    find: RegExp;
    replacement: string;
}

/** The parts of a package's `package.json` the aliases derive from. */
interface PackageJson {
    name: string;
    exports?: Record<string, unknown>;
}

/** Where a library build keeps the files its own code requests by URL. */
const LIBRARY_ASSETS = 'dist/lib/assets';

/** The URL prefix those requests use — absolute, from the site root. */
const ASSETS_URL = '/assets';

/** Content types for what a library build emits under `assets/`. */
const ASSET_TYPES: Record<string, string> = {
    '.js': 'text/javascript; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
};

/**
 * Escapes `text` for use as a literal inside a regular expression.
 *
 * @param text - Any text.
 * @returns The escaped text.
 */
function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reads the `package.json` of the package at `libDir`.
 *
 * @param libDir - The package's directory.
 * @returns The parsed file.
 * @throws Error - When the file is missing or not JSON; the message names its path.
 */
function readPackage(libDir: string): PackageJson {
    return JSON.parse(fs.readFileSync(path.join(libDir, 'package.json'), 'utf8')) as PackageJson;
}

/**
 * Writes one report under `resultsDir` as `<name>-<epoch ms>.json`. The body
 * goes to a `.tmp` file first and is renamed into place, so a reader polling
 * the directory never sees half a file.
 *
 * @param resultsDir - The results directory; created when missing.
 * @param name - The report's `name=`; characters outside `[\w.-]` become `_`.
 * @param body - The request body.
 */
function writeReport(resultsDir: string, name: string | null, body: Buffer): void {
    fs.mkdirSync(resultsDir, { recursive: true });

    const safeName = (name ?? 'unnamed').replace(/[^\w.-]/g, '_');
    const file = path.join(resultsDir, `${safeName}-${Date.now()}.json`);

    fs.writeFileSync(`${file}.tmp`, body);
    fs.renameSync(`${file}.tmp`, file);
}

/**
 * Accepts `POST /__qa/report?name=<name>` and writes the body to
 * `<resultsDir>/<name>-<epoch ms>.json`, through a `.tmp` file and a rename.
 * Every other request goes to the next middleware.
 *
 * @param options - `resultsDir`, where reports are written.
 * @returns The plugin.
 */
export function qaReportPlugin(options: { resultsDir: string }): Plugin {
    return {
        name: 'qa-report',
        configureServer(server): void {
            server.middlewares.use((req, res, next) => {
                const url = new URL(req.url ?? '/', 'http://localhost');

                if (url.pathname !== '/__qa/report' || req.method !== 'POST') {
                    next();

                    return;
                }

                const chunks: Buffer[] = [];

                req.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                });

                req.on('end', () => {
                    writeReport(options.resultsDir, url.searchParams.get('name'), Buffer.concat(chunks));
                    res.end('ok');
                });
            });
        },
    };
}

/**
 * The alias for one exact `exports` key: `.` or a subpath without `*`.
 *
 * @param name - The package name.
 * @param key - The `exports` key.
 * @param target - The key's `import` file, relative to the package.
 * @param libDir - The package's directory.
 * @returns The alias.
 */
function exactAlias(name: string, key: string, target: string, libDir: string): RegexAlias {
    const specifier = key === '.' ? name : `${name}/${key.replace(/^\.\//, '')}`;

    return { find: new RegExp(`^${escapeRegExp(specifier)}$`), replacement: path.resolve(libDir, target) };
}

/**
 * The alias for one `*` key: the text the `*` matches in the import is
 * substituted for the `*` in the target.
 *
 * @param name - The package name.
 * @param key - The `exports` key, with one `*`.
 * @param target - The key's `import` file, with one `*`.
 * @param libDir - The package's directory.
 * @returns The alias.
 */
function wildcardAlias(name: string, key: string, target: string, libDir: string): RegexAlias {
    const [keyPrefix, keySuffix] = key.replace(/^\.\//, '').split('*');
    const [targetPrefix, targetSuffix] = target.split('*');

    return {
        find: new RegExp(`^${escapeRegExp(`${name}/${keyPrefix}`)}(.+)${escapeRegExp(keySuffix)}$`),
        // `path.join` keeps the prefix's trailing `/`, so `$1` lands inside the directory.
        replacement: `${path.join(path.resolve(libDir), targetPrefix)}$1${targetSuffix}`,
    };
}

/**
 * The alias list `qaLibraryPlugin` installs: one per `exports` entry of the
 * package at `libDir` whose value has a string `import`. Exact keys come
 * first, then `*` keys by the length of the text before the `*`, longest
 * first, so the first alias that matches is the most specific.
 *
 * @param libDir - The library build's package directory.
 * @returns The aliases, in match order.
 */
export function libraryAliases(libDir: string): RegexAlias[] {
    const pkg = readPackage(libDir);
    const exact: RegexAlias[] = [];
    const wildcard: Array<{ prefixLength: number; alias: RegexAlias }> = [];

    for (const [key, value] of Object.entries(pkg.exports ?? {})) {
        const target = (value as { import?: unknown } | null)?.import;

        if (typeof target !== 'string') {
            continue;
        }

        if (key.includes('*')) {
            wildcard.push({ prefixLength: key.indexOf('*'), alias: wildcardAlias(pkg.name, key, target, libDir) });
        } else {
            exact.push(exactAlias(pkg.name, key, target, libDir));
        }
    }

    wildcard.sort((a, b) => b.prefixLength - a.prefixLength);

    return [...exact, ...wildcard.map((entry) => entry.alias)];
}

/**
 * Maps a request path under `/assets/` to the file it names inside the library
 * build's own `dist/lib/assets`. The build's code asks for those files by a
 * build-specific hashed name, so the mapping is by directory; no name is
 * written down here.
 *
 * @param libDir - The library build's package directory.
 * @returns A function from a request pathname to the absolute file it names, or `null` for a pathname that is not under `/assets/` or that climbs out of the directory.
 */
export function libraryAssetFile(libDir: string): (pathname: string) => string | null {
    const assetsDir = path.join(path.resolve(libDir), LIBRARY_ASSETS);

    return (pathname: string): string | null => {
        if (!pathname.startsWith(`${ASSETS_URL}/`)) {
            return null;
        }

        let name: string;

        try {
            // Decoded first, so an escaped `..` is caught by the same check.
            name = decodeURIComponent(pathname.slice(ASSETS_URL.length + 1));
        } catch {
            // A malformed escape names no file; Vite's own fallback does the same.
            return null;
        }

        const file = path.join(assetsDir, name);

        return file !== assetsDir && isUnder(file, assetsDir) ? file : null;
    };
}

/**
 * Aliases every exported subpath of the package at `libDir` to that build's
 * file, and fails any other import of the package. Without the guard an
 * unaliased import would fall through to normal resolution — the
 * `node_modules` symlink, the main tree's build — and load a second library
 * instance whose prototypes the counters never see.
 *
 * `enforce: 'pre'`, because `resolveId` is first-wins and Vite's own resolver
 * runs before normal-order plugins; aliasing runs before both, so an id that
 * reaches the guard still in bare form had no alias.
 *
 * It also serves that build's `dist/lib/assets` at `/assets/`. Imports are not
 * the only way the build reaches its own files: the store starts its worker
 * with `new Worker('/assets/StoreWorker-<hash>.js')`, an absolute path the app
 * serving the page has to answer. Unanswered, the store of a panel holding
 * 1,000 records or more never loads and the panel stays empty.
 *
 * @param options - `libDir`, the library build's package directory.
 * @returns The plugin.
 * @throws Error - When the build has no `dist/lib/assets`; the message names it.
 */
export function qaLibraryPlugin(options: { libDir: string }): Plugin {
    const name = readPackage(options.libDir).name;
    const aliases = libraryAliases(options.libDir);
    const ownImport = new RegExp(`^${escapeRegExp(name)}(/|$)`);

    if (!fs.existsSync(path.join(options.libDir, LIBRARY_ASSETS))) {
        throw new Error(
            `the library build at ${options.libDir} has no ${LIBRARY_ASSETS}: nothing would answer the `
                + `${ASSETS_URL}/ requests the build makes for its own files, such as the store's worker. `
                + 'Build the arm again.',
        );
    }

    const assetFile = libraryAssetFile(options.libDir);

    return {
        name: 'qa-library-arm',
        enforce: 'pre',
        config: () => ({ resolve: { alias: aliases } }),
        configureServer(server): void {
            server.middlewares.use((req, res, next) => {
                const file = assetFile(new URL(req.url ?? '/', 'http://localhost').pathname);

                if (file === null || fs.statSync(file, { throwIfNoEntry: false })?.isFile() !== true) {
                    next();

                    return;
                }

                res.setHeader('Content-Type', ASSET_TYPES[path.extname(file)] ?? 'application/octet-stream');
                res.end(fs.readFileSync(file));
            });
        },
        resolveId(id: string): null {
            if (ownImport.test(id)) {
                this.error(`${id} is not exported by the library build at ${options.libDir}`);
            }

            return null;
        },
    };
}

/**
 * Whether `file` is `dir` itself or inside it.
 *
 * @param file - An absolute path.
 * @param dir - An absolute path.
 * @returns `true` when `file` is `dir` or under it.
 */
function isUnder(file: string, dir: string): boolean {
    return file === dir || file.startsWith(dir + path.sep);
}

/**
 * A `server.watch.ignored` matcher that ignores every path except `root`
 * itself, `<root>/index.html`, `<root>/src/**` and `<root>/tests/**`. The
 * watcher asks about the root first and skips an ignored directory's
 * contents, so run output under the root is never walked.
 *
 * @param root - The app's root directory.
 * @returns `true` for a path the watcher should ignore.
 */
export function outsideAppSource(root: string): (file: string) => boolean {
    const watched = ['index.html', 'src', 'tests'].map((entry) => path.join(root, entry));

    return (file: string): boolean => file !== root && !watched.some((dir) => isUnder(file, dir));
}
