import { describe, it, expect } from 'vitest';

// Same glob pattern demos.ts uses to resolve source text, read independently
// here so this guard exercises the actual authored demo modules rather than
// anything demos.ts derives from them — see content-constructs.test.ts:7-11
// for the same independent-glob rationale applied to the Markdown corpus.
const RAW_SOURCES = import.meta.glob('../src/demos/*.ts', {
    query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const MODULES = Object.entries(RAW_SOURCES);

/** The five values `## Architecture Decisions`' height scale allows. */
const ALLOWED_HEIGHTS = [64, 120, 200, 260, 320];

describe('demo source hygiene', () => {
    it.each(MODULES)('%s exports exactly height and create', (path, source) => {
        const exportLines = source.match(/^export /gm) ?? [];

        expect(exportLines, `${path} exports: ${JSON.stringify(exportLines)}`).toHaveLength(2);
        expect(source).toMatch(/^export const height\b/m);
        expect(source).toMatch(/^export function create\(/m);
    });

    it.each(MODULES)('%s declares no top-level binding other than height', (path, source) => {
        const offenders = source.match(/^(?:export\s+)?(?:const|let|var)\s+(?!height\b)/gm);

        expect(offenders, `${path} top-level bindings: ${JSON.stringify(offenders)}`).toBeNull();
    });

    it.each(MODULES)('%s declares no top-level function other than create', (path, source) => {
        const offenders = source.match(/^(?:export\s+)?(?:async\s+)?function\s+(?!create\b)/gm);

        expect(offenders, `${path} top-level functions: ${JSON.stringify(offenders)}`).toBeNull();
    });

    it.each(MODULES)('%s sets height to one of the five scale values', (path, source) => {
        const match = /^export const height: number = (\d+);/m.exec(source);

        expect(match, `${path} has no matching height literal`).not.toBeNull();
        expect(ALLOWED_HEIGHTS, `${path} height is ${match?.[1]}`).toContain(Number(match![1]));
    });

    it.each(MODULES)('%s starts no timer', (path, source) => {
        expect(source, `${path} starts a timer`).not.toMatch(/\b(?:setInterval|setTimeout|requestAnimationFrame)\b/);
    });

    it.each(MODULES)('%s has no colour literal', (path, source) => {
        expect(source, `${path} has a colour literal`).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/);
    });

    it.each(MODULES)('%s builds no component inside a components: array literal', (path, source) => {
        expect(source, `${path} constructs a component inline in components:`)
            .not.toMatch(/components:\s*\[[^\]]*(?:new\s+)?[A-Z][A-Za-z]*\s*\(/);
    });

    it.each(MODULES)('%s has no line over 100 characters', (path, source) => {
        const longLines = source.split('\n').filter((line) => line.length > 100);

        expect(longLines, `${path} long lines: ${JSON.stringify(longLines)}`).toHaveLength(0);
    });
});
