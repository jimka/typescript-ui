// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// `nearestRevealOffset` is the one rule every reveal in the library applies:
// scroll the least distance that brings a span of content into a viewport.
// Cases N1–N12 of plans/implemented/scroll-reveal-geometry-fixes.md.
//
// Everything is measured along one axis of the scrolled content. The span to
// show runs from `start` to `end`; the viewport, `extent` long, currently
// shows `offset` to `offset + extent`. Each expected offset below is worked
// out from that statement, not read back from the function.
import { describe, it, expect } from 'vitest';
import { nearestRevealOffset } from '~/core/ScrollReveal';

interface RuleCase {
    id:     string;
    start:  number;
    end:    number;
    offset: number;
    extent: number;
    result: number;
    why:    string;
}

// A viewport showing 100–400 unless the case is about the extent itself.
const CASES: RuleCase[] = [
    { id: 'N1',  start: 150,  end: 190, offset: 100, extent: 300, result: 100, why: 'in view' },
    { id: 'N2',  start: 100,  end: 140, offset: 100, extent: 300, result: 100, why: 'starts exactly on the start edge' },
    { id: 'N3',  start: 360,  end: 400, offset: 100, extent: 300, result: 100, why: 'ends exactly on the end edge' },
    { id: 'N4',  start: 20,   end: 60,  offset: 100, extent: 300, result: 20,  why: 'fits, cut at the start: its start goes to the start edge' },
    { id: 'N5',  start: 420,  end: 460, offset: 100, extent: 300, result: 160, why: 'fits, cut at the end: its end goes to the end edge (460 - 300)' },
    { id: 'N6',  start: 50,   end: 650, offset: 100, extent: 300, result: 100, why: 'covers the viewport: no offset shows more of it' },
    { id: 'N7',  start: 100,  end: 700, offset: 100, extent: 300, result: 100, why: 'too long, already starting on the start edge' },
    { id: 'N8',  start: 200,  end: 800, offset: 100, extent: 300, result: 200, why: 'too long, cut at the end: its start goes to the start edge' },
    { id: 'N9',  start: -150, end: 350, offset: 100, extent: 300, result: 50,  why: 'too long, cut at the start: its end goes to the end edge (350 - 300)' },
    { id: 'N10', start: 20,   end: 60,  offset: 100, extent: 0,   result: 100, why: 'a viewport with no extent shows nothing wherever it is' },
    { id: 'N11', start: 20,   end: 60,  offset: 100, extent: -12, result: 100, why: 'a negative extent is no viewport' },
    { id: 'N12', start: 20,   end: 60,  offset: 100, extent: NaN, result: 100, why: 'an unsized extent is no viewport' },
];

describe('nearestRevealOffset', () => {
    for (const { id, start, end, offset, extent, result, why } of CASES) {
        it(`${id}: span ${start}–${end}, offset ${offset}, extent ${extent} → ${result} (${why})`, () => {
            expect(nearestRevealOffset(start, end, offset, extent)).toBe(result);
        });
    }
});
