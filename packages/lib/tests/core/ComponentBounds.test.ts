// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for `Component`'s geometry-diff primitives — `setBounds` /
// `applyBounds` / `invalidateLayout` / `isLayoutDirty` — added by the
// layout-calc-commit-split plan. Cases are numbered to match the plan's
// `## Expected Behaviour` list (1-10); 11-15 live in
// `tests/component/table/CellLayoutSkip.test.ts`, which needs a real Table.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component, _Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** Opts into the unchanged-geometry layout skip, mirroring `Cell`'s override. */
class SkippableComponent extends _Component {
    protected canSkipUnchangedLayout(): boolean {
        return true;
    }
}

describe('Component.setBounds', () => {
    it('1. writes x/y/width/height and reports the change', () => {
        const c = new Component({});

        const changed = c.setBounds(10, 20, 30, 40);

        expect(changed).toBe(true);
        expect(c.getX()).toBe(10);
        expect(c.getY()).toBe(20);
        expect(c.getWidth()).toBe(30);
        expect(c.getHeight()).toBe(40);
    });

    it('2. reports true then false for the same request repeated', () => {
        const c = new Component({});

        expect(c.setBounds(10, 20, 30, 40)).toBe(true);
        expect(c.setBounds(10, 20, 30, 40)).toBe(false);
    });

    it('3. reports the clamped width, and false when the same request repeats', () => {
        const c = new Component({});
        c.setMaxSize({ width: 25, height: 40 });

        expect(c.setBounds(10, 20, 30, 40)).toBe(true);
        expect(c.getWidth()).toBe(25);

        expect(c.setBounds(10, 20, 30, 40)).toBe(false);
    });

    it('4. flushes as one batched style write, and leaves autoCommit true', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const c    = new Component({});
        const root = c.getElement(true)!;

        const mark = sink.writes.length;

        c.setBounds(10, 20, 30, 40);

        expect(c.getAutoCommitStyle()).toBe(true);

        const styleApplies = sink.writes
            .slice(mark)
            .filter(w => w.op === 'apply' && w.args[0] === root && (w.args[1] as { style?: unknown }).style);

        expect(styleApplies.length).toBe(1);
        expect(styleApplies[0].args[1]).toEqual({
            style: { left: '10px', top: '20px', width: '30px', height: '40px' },
        });
    });
});

describe('Component.applyBounds — default (does not opt in)', () => {
    it('5. lays out on both calls at an unchanged rectangle', () => {
        const c = new Component({});
        c.getElement(true);

        const doLayout = vi.spyOn(c, 'doLayout');

        c.applyBounds(10, 20, 30, 40);
        c.applyBounds(10, 20, 30, 40);

        expect(doLayout).toHaveBeenCalledTimes(2);
    });
});

describe('Component.applyBounds — opted in (canSkipUnchangedLayout)', () => {
    it('6. skips the second call at an unchanged rectangle', () => {
        const c = new SkippableComponent();
        c.getElement(true);

        const doLayout = vi.spyOn(c, 'doLayout');

        c.applyBounds(10, 20, 30, 40);
        c.applyBounds(10, 20, 30, 40);

        expect(doLayout).toHaveBeenCalledTimes(1);
    });

    it('7. invalidateLayout between two unchanged calls forces both to lay out', () => {
        const c = new SkippableComponent();
        c.getElement(true);

        const doLayout = vi.spyOn(c, 'doLayout');

        c.applyBounds(10, 20, 30, 40);
        c.invalidateLayout();
        c.applyBounds(10, 20, 30, 40);

        expect(doLayout).toHaveBeenCalledTimes(2);
    });

    it('8. lays out on both calls when the component has no element', () => {
        const c = new SkippableComponent();

        const doLayout = vi.spyOn(c, 'doLayout');

        c.applyBounds(10, 20, 30, 40);
        c.applyBounds(10, 20, 30, 40);

        expect(doLayout).toHaveBeenCalledTimes(2);
    });
});

describe('Component.isLayoutDirty / scheduleLayout', () => {
    it('9. true on a fresh component, false after doLayout, true again after scheduleLayout', () => {
        const c = new Component({});
        c.getElement(true);

        expect(c.isLayoutDirty()).toBe(true);

        c.doLayout();
        expect(c.isLayoutDirty()).toBe(false);

        c.scheduleLayout();
        expect(c.isLayoutDirty()).toBe(true);
    });

    it('10. scheduleLayout on a paused component still leaves isLayoutDirty true', () => {
        const c = new Component({});
        c.getElement(true);
        c.doLayout();

        expect(c.isLayoutDirty()).toBe(false);

        c.pauseLayout();
        c.scheduleLayout();

        expect(c.isLayoutDirty()).toBe(true);
    });
});
