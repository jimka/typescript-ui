import { describe, it, expect } from 'vitest';
import { splitBlocks } from '../src/content/blocks.js';

describe('splitBlocks', () => {
    it('yields a single markdown block, byte-identical, for source with no marker', () => {
        const source = '# Title\n\nJust prose.\n';

        expect(splitBlocks(source)).toEqual([{ kind: 'markdown', source }]);
    });

    it('drops the empty leading prose segment when a marker pair opens the source', () => {
        const source = '<!-- demo: button-basic -->\n> fallback\n<!-- /demo -->';

        expect(splitBlocks(source)).toEqual([{ kind: 'demo', id: 'button-basic' }]);
    });

    it('yields prose, demo, prose in order, each keeping its own text', () => {
        const source = [
            'Intro.',
            '<!-- demo: button-basic -->',
            '> fallback',
            '<!-- /demo -->',
            '## Usage',
        ].join('\n');

        expect(splitBlocks(source)).toEqual([
            { kind: 'markdown', source: 'Intro.' },
            { kind: 'demo',     id: 'button-basic' },
            { kind: 'markdown', source: '## Usage' },
        ]);
    });

    it('yields two demo blocks with no empty markdown block between them', () => {
        const source = [
            '<!-- demo: a -->',
            '<!-- /demo -->',
            '<!-- demo: b -->',
            '<!-- /demo -->',
        ].join('\n');

        expect(splitBlocks(source)).toEqual([
            { kind: 'demo', id: 'a' },
            { kind: 'demo', id: 'b' },
        ]);
    });

    it('drops the fallback region, and the following prose starts after the close marker', () => {
        const source = [
            'Before.',
            '<!-- demo: button-basic -->',
            '> **Live demo** — dropped text.',
            '<!-- /demo -->',
            'After.',
        ].join('\n');

        const blocks = splitBlocks(source);

        expect(blocks).toEqual([
            { kind: 'markdown', source: 'Before.' },
            { kind: 'demo',     id: 'button-basic' },
            { kind: 'markdown', source: 'After.' },
        ]);
        expect(JSON.stringify(blocks)).not.toContain('Live demo');
    });

    it('handles an empty fallback region (open immediately followed by close)', () => {
        const source = [
            'Before.',
            '<!-- demo: button-basic -->',
            '<!-- /demo -->',
            'After.',
        ].join('\n');

        expect(splitBlocks(source)).toEqual([
            { kind: 'markdown', source: 'Before.' },
            { kind: 'demo',     id: 'button-basic' },
            { kind: 'markdown', source: 'After.' },
        ]);
    });

    it('drops a multi-line fallback whole, including blank lines, a blockquote, and a fence', () => {
        const source = [
            '<!-- demo: button-basic -->',
            '> A blockquote line.',
            '',
            '```ts',
            'const x = 1;',
            '```',
            '<!-- /demo -->',
            'After.',
        ].join('\n');

        const blocks = splitBlocks(source);

        expect(blocks).toEqual([
            { kind: 'demo',     id: 'button-basic' },
            { kind: 'markdown', source: 'After.' },
        ]);
        expect(JSON.stringify(blocks)).not.toContain('const x');
    });

    it('does not treat an indented marker as a marker — it must start at column 0', () => {
        const source = [
            '> <!-- demo: x -->',
            '  <!-- demo: x -->',
            'Body.',
            '  <!-- /demo -->',
        ].join('\n');

        expect(splitBlocks(source)).toEqual([{ kind: 'markdown', source }]);
    });

    it('does not treat an id outside [a-z0-9-]+ as a marker', () => {
        const source = '<!-- demo: Button Basic -->';

        expect(splitBlocks(source)).toEqual([{ kind: 'markdown', source }]);
    });

    it('does not treat an unrelated comment or a comment mid-line as a marker', () => {
        const source = [
            '<!-- unrelated -->',
            'Text <!-- demo: x --> more',
        ].join('\n');

        expect(splitBlocks(source)).toEqual([{ kind: 'markdown', source }]);
    });

    it('leaves a close marker with no preceding open marker as prose', () => {
        const source = 'Body.\n<!-- /demo -->';

        expect(splitBlocks(source)).toEqual([{ kind: 'markdown', source }]);
    });

    it('consumes the rest of the source on an unterminated open marker, with no trailing prose block', () => {
        const source = [
            '<!-- demo: button-basic -->',
            '> fallback, never closed',
            'more lines',
        ].join('\n');

        expect(splitBlocks(source)).toEqual([{ kind: 'demo', id: 'button-basic' }]);
    });

    it('yields a demo block for an unknown id — resolution is the registry\'s job', () => {
        const source = '<!-- demo: no-such-demo -->\n<!-- /demo -->';

        expect(splitBlocks(source)).toEqual([{ kind: 'demo', id: 'no-such-demo' }]);
    });
});
