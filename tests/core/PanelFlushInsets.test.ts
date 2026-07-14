// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

//
// Offline coverage for Panel's `flush` construction option — a
// construction-time default selector that seeds zero content insets for
// rail-style containers instead of the standard (4, 4, 4, 4) default. See
// plans/implemented/rail-container-zero-insets.md.
//
import { describe, it, expect } from 'vitest';
import { _Panel } from '~/core/Panel';
import { Insets } from '~/primitive/Insets';

/** Asserts an Insets reports the given (top, right, bottom, left) values. */
function expectInsets(insets: Insets, top: number, right: number, bottom: number, left: number): void {
    expect(insets.getTop()).toBe(top);
    expect(insets.getRight()).toBe(right);
    expect(insets.getBottom()).toBe(bottom);
    expect(insets.getLeft()).toBe(left);
}

describe('Panel — flush construction option', () => {
    it('flush: true zeroes the default insets', () => {
        const panel = new _Panel({ flush: true });
        expectInsets(panel.getInsets(), 0, 0, 0, 0);
        expectInsets(panel.getContentInsets(), 0, 0, 0, 0);
    });

    it('flush omitted keeps the 4px default', () => {
        const panel = new _Panel();
        expectInsets(panel.getInsets(), 4, 4, 4, 4);
    });

    it('flush: false keeps the 4px default', () => {
        const panel = new _Panel({ flush: false });
        expectInsets(panel.getInsets(), 4, 4, 4, 4);
    });

    it('an explicit insets wins over flush: true', () => {
        const panel = new _Panel({ flush: true, insets: new Insets(2, 2, 2, 2) });
        expectInsets(panel.getInsets(), 2, 2, 2, 2);
    });

    it('an explicit insets wins without flush too', () => {
        const panel = new _Panel({ insets: new Insets(1, 1, 1, 1) });
        expectInsets(panel.getInsets(), 1, 1, 1, 1);
    });

    it('does not mutate the shared default insets', () => {
        new _Panel({ flush: true });
        const panel = new _Panel();
        expectInsets(panel.getInsets(), 4, 4, 4, 4);
    });
});
