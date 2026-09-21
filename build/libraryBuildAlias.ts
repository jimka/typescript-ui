// The library-build alias shared by every in-repo Vite config that imports
// `@jimka/typescript-ui` (packages/qa, packages/docs). Each exported subpath
// resolves to one checkout's own packages/lib build, never to whatever the
// node_modules symlink points at, which in a worktree is the main tree's
// build. Node-side: no page imports this file.

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
 * The alias list `libraryBuildPlugin` installs: one per `exports` entry of the
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
 * Aliases every exported subpath of the package at `libDir` to that build's
 * file, and fails any other import of the package. Without the guard an
 * unaliased import would fall through to normal resolution — the
 * `node_modules` symlink, the main tree's build — and load a second library
 * instance.
 *
 * `enforce: 'pre'`, because `resolveId` is first-wins and Vite's own resolver
 * runs before normal-order plugins; aliasing runs before both, so an id that
 * reaches the guard still in bare form had no alias.
 *
 * @param options - `libDir`, the library build's package directory.
 * @returns The plugin.
 */
export function libraryBuildPlugin(options: { libDir: string }): Plugin {
    const name = readPackage(options.libDir).name;
    const aliases = libraryAliases(options.libDir);
    const ownImport = new RegExp(`^${escapeRegExp(name)}(/|$)`);

    return {
        name: 'library-build-alias',
        enforce: 'pre',
        config: () => ({ resolve: { alias: aliases } }),
        resolveId(id: string): null {
            if (ownImport.test(id)) {
                this.error(`${id} is not exported by the library build at ${options.libDir}`);
            }

            return null;
        },
    };
}
