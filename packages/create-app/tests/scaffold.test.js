// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

import { fileURLToPath } from 'node:url';

import {
    toValidPackageName,
    renameTemplateFile,
    isEmpty,
    parseCliArgs,
    scaffold,
    main,
} from '../index.js';

const TEMPLATE_DIR = fileURLToPath(new URL('../template', import.meta.url));

/**
 * Every file under the template directory, as destination-relative paths with
 * the template rename applied.
 * @param {string} dir - Directory to walk.
 * @param {string} prefix - Destination-relative prefix accumulated so far.
 * @returns {string[]} Relative paths a scaffolded project must contain.
 */
function listTemplateRelPaths(dir, prefix = '') {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const destName = renameTemplateFile(entry.name);
        const destPath = prefix ? join(prefix, destName) : destName;

        return entry.isDirectory()
            ? listTemplateRelPaths(join(dir, entry.name), destPath)
            : [destPath];
    });
}

describe('toValidPackageName', () => {
    it.each([
        ['My App', 'my-app'],
        ['Foo/Bar', 'foo-bar'],
        ['_x', 'x'],
        ['.foo', 'foo'],
        ['-my-app-', 'my-app'],
        ['My App!', 'my-app'],
        ['my-app', 'my-app'],
        // A name made entirely of characters that get stripped leaves nothing
        // behind. npm rejects an empty name, so the fallback has to stand in.
        ['...', 'typescript-ui-app'],
        ['--', 'typescript-ui-app'],
        ['___', 'typescript-ui-app'],
        ['ÅÄÖ', 'typescript-ui-app'],
        ['   ', 'typescript-ui-app'],
    ])('converts %j to %j', (input, expected) => {
        expect(toValidPackageName(input)).toBe(expected);
    });
});

describe('renameTemplateFile', () => {
    it('maps _gitignore to .gitignore', () => {
        expect(renameTemplateFile('_gitignore')).toBe('.gitignore');
    });

    it('leaves other names unchanged', () => {
        expect(renameTemplateFile('index.html')).toBe('index.html');
        expect(renameTemplateFile('package.json')).toBe('package.json');
    });

    it('leaves an Object.prototype-shaped name unchanged rather than resolving to the inherited member', () => {
        expect(renameTemplateFile('constructor')).toBe('constructor');
        expect(renameTemplateFile('toString')).toBe('toString');
        expect(renameTemplateFile('__proto__')).toBe('__proto__');
    });
});

describe('isEmpty', () => {
    it('is true for an empty entry list', () => {
        expect(isEmpty([])).toBe(true);
    });

    it('is false for a non-empty entry list', () => {
        expect(isEmpty(['index.html'])).toBe(false);
    });
});

describe('parseCliArgs', () => {
    it('returns the positional target directory', () => {
        expect(parseCliArgs(['my-app'])).toEqual({ help: false, targetDir: 'my-app' });
    });

    it('returns undefined when no positional is given', () => {
        expect(parseCliArgs([])).toEqual({ help: false, targetDir: undefined });
    });

    it('sets help on --help without throwing', () => {
        expect(parseCliArgs(['--help'])).toEqual({ help: true, targetDir: undefined });
    });

    it('sets help on the -h short flag', () => {
        expect(parseCliArgs(['-h'])).toEqual({ help: true, targetDir: undefined });
    });

    it('throws on more than one positional argument, naming the extra one', () => {
        expect(() => parseCliArgs(['a', 'b'])).toThrow(/b/);
    });
});

describe('scaffold', () => {
    let tmpRoot;

    afterEach(() => {
        if (tmpRoot) {
            rmSync(tmpRoot, { recursive: true, force: true });
            tmpRoot = undefined;
        }
    });

    it('creates the target directory when it does not exist yet (the primary npm-create path)', async () => {
        tmpRoot = mkdtempSync(join(tmpdir(), 'create-tsui-app-'));
        const target = join(tmpRoot, 'my-app');
        expect(existsSync(target)).toBe(false);

        await scaffold(target);

        expect(existsSync(target)).toBe(true);
        expect(existsSync(join(target, 'package.json'))).toBe(true);
    });

    it('refuses to scaffold into an existing non-empty directory and writes nothing', async () => {
        tmpRoot = mkdtempSync(join(tmpdir(), 'create-tsui-app-'));
        const target = join(tmpRoot, 'my-app');
        mkdirSync(target);
        writeFileSync(join(target, 'existing.txt'), 'keep me');

        await expect(scaffold(target)).rejects.toThrow(/not empty/);

        expect(readdirSync(target)).toEqual(['existing.txt']);
    });

    it('renames _gitignore to .gitignore on disk', async () => {
        tmpRoot = mkdtempSync(join(tmpdir(), 'create-tsui-app-'));
        const target = join(tmpRoot, 'my-app');

        await scaffold(target);

        expect(existsSync(join(target, '.gitignore'))).toBe(true);
        expect(existsSync(join(target, '_gitignore'))).toBe(false);
    });

    it('substitutes the package name derived from the target basename', async () => {
        tmpRoot = mkdtempSync(join(tmpdir(), 'create-tsui-app-'));
        const target = join(tmpRoot, 'My App');

        await scaffold(target);

        const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
        const templatePkg = JSON.parse(readFileSync(join(TEMPLATE_DIR, 'package.json'), 'utf8'));
        expect(pkg.name).toBe(toValidPackageName(basename(target)));
        expect(pkg.dependencies['@jimka/typescript-ui']).toBe(templatePkg.dependencies['@jimka/typescript-ui']);
    });

    it('copies the whole template, including nested files', async () => {
        tmpRoot = mkdtempSync(join(tmpdir(), 'create-tsui-app-'));
        const target = join(tmpRoot, 'my-app');

        await scaffold(target);

        // Enumerated from the template rather than hardcoded, so a file added
        // to template/ that scaffold() fails to copy is caught here instead of
        // shipping silently. Names are mapped through renameTemplateFile so the
        // check follows the _gitignore -> .gitignore rename.
        const expected = listTemplateRelPaths(TEMPLATE_DIR);
        expect(expected.length).toBeGreaterThan(0);

        for (const relPath of expected) {
            expect(existsSync(join(target, relPath)), `missing ${relPath}`).toBe(true);
        }
    });
});

describe('main', () => {
    let tmpRoot;

    afterEach(() => {
        if (tmpRoot) {
            rmSync(tmpRoot, { recursive: true, force: true });
            tmpRoot = undefined;
        }
    });

    it('prompts for the directory when none is given on argv', async () => {
        tmpRoot = mkdtempSync(join(tmpdir(), 'create-tsui-app-'));
        const target = join(tmpRoot, 'my-app');
        let askCalls = 0;
        const ask = async () => {
            askCalls += 1;
            return target;
        };

        await main([], ask);

        expect(askCalls).toBe(1);
        expect(existsSync(join(target, 'package.json'))).toBe(true);
    });

    it('scaffolds from the positional argument without prompting', async () => {
        tmpRoot = mkdtempSync(join(tmpdir(), 'create-tsui-app-'));
        const target = join(tmpRoot, 'my-app');
        let askCalls = 0;
        const ask = async () => {
            askCalls += 1;
            return target;
        };

        await main([target], ask);

        expect(askCalls).toBe(0);
        expect(existsSync(join(target, 'package.json'))).toBe(true);
    });

    it('prints usage and scaffolds nothing when --help is given', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        let askCalls = 0;
        const ask = async () => {
            askCalls += 1;
            return '';
        };

        try {
            await main(['--help'], ask);

            expect(askCalls).toBe(0);
            expect(logSpy.mock.calls.some(([line]) => /usage/i.test(line))).toBe(true);
        } finally {
            logSpy.mockRestore();
        }
    });

    it('rejects with a clear error and creates nothing when the answer is empty', async () => {
        tmpRoot = mkdtempSync(join(tmpdir(), 'create-tsui-app-'));
        const originalCwd = process.cwd();
        process.chdir(tmpRoot);
        const ask = async () => '';

        try {
            await expect(main([], ask)).rejects.toThrow(/no project directory given/);
            expect(readdirSync(tmpRoot)).toEqual([]);
        } finally {
            process.chdir(originalCwd);
        }
    });
});
