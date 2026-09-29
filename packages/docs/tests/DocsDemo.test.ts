// @vitest-environment jsdom
//
// DocsDemo builds library components (Panel, ToggleButton, Markdown) through
// the library's production DOM seam as it is constructed — same reason
// DocsContent.test.ts and demos.test.ts need a real DOM (see their own top
// comments). `resolveProseMeasureWidth` is mocked because jsdom lays nothing
// out, so the real off-screen probe resolves to 0 and an assertion against
// it would hold for any arithmetic the constructor did to it.
import { describe, it, expect, vi } from 'vitest';
import { Panel } from '@jimka/typescript-ui/core';
import { DocsDemo } from '../src/shell/DocsDemo.js';
import type { DemoEntry } from '../src/content/demos.js';

const measure = vi.hoisted(() => ({ value: 640 }));

vi.mock('../src/shell/proseWidth.js', () => ({
    resolveProseMeasureWidth: () => measure.value,
}));

// A stand-in demo whose stage content is a bare Panel: this file asserts on
// the block's own geometry, not on any real demo's tree. A type-only import
// of DemoEntry keeps demos.ts (and its eager glob over every demo module)
// out of this file.
const entry: DemoEntry = { module: { height: 120, create: () => new Panel() }, source: 'source text' };

describe('DocsDemo prose measure', () => {
    it('caps its width at the bare resolved measure, so the prose left margin comes out of the measure instead of pushing the block past the prose', () => {
        const demo = new DocsDemo(entry);

        expect(demo.getMaxSizeConstraint()?.width).toBe(640);

        demo.dispose();
    });
});
