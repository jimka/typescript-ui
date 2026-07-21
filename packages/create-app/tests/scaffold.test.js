// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

import {
    toValidPackageName,
    renameTemplateFile,
    isEmpty,
    parseCliArgs,
    scaffold,
    main,
} from '../index.js';

describe('toValidPackageName', () => {
    it.each([
        ['My App', 'my-app'],
        ['Foo/Bar', 'foo-bar'],
        ['_x', 'x'],
        ['.foo', 'foo'],
        ['-my-app-', 'my-app'],
        ['My App!', 'my-app'],
        ['my-app', 'my-app'],
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
        expect(parseCliArgs(['my-app'])).toEqual({ targetDir: 'my-app' });
    });

    it('returns undefined when no positional is given', () => {
        expect(parseCliArgs([])).toEqual({ targetDir: undefined });
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
        expect(pkg.name).toBe(toValidPackageName(basename(target)));
        expect(pkg.dependencies['@jimka/typescript-ui']).toBe('^0.1.0');
    });

    it('copies the whole template, including nested files', async () => {
        tmpRoot = mkdtempSync(join(tmpdir(), 'create-tsui-app-'));
        const target = join(tmpRoot, 'my-app');

        await scaffold(target);

        expect(existsSync(join(target, 'src', 'main.ts'))).toBe(true);
        expect(existsSync(join(target, 'index.html'))).toBe(true);
        expect(existsSync(join(target, 'vite.config.ts'))).toBe(true);
        expect(existsSync(join(target, 'tsconfig.json'))).toBe(true);
        expect(existsSync(join(target, 'README.md'))).toBe(true);
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
});
