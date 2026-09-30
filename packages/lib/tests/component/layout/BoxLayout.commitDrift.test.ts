// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * `BoxLayout.commitStackedPlacements`'s drift carry
 * (plans/in-progress/vbox-stale-prepass-heights.md): a child that commits
 * taller/wider than the extent `VBox`/`HBox` resolved for it — the shape of
 * `Markdown`'s width-triggered re-measure clamping `setHeight` up past a
 * stale slot — must push every later sibling by the same amount, in the same
 * pass, instead of overlapping it until the growing child's own scheduled
 * pass catches up a frame later.
 *
 * T1, T2, T3 and T6 exercise the vertical arm (`VBox`); T4 and T5 the
 * horizontal arm (`HBox`), using a synthetic child since no library
 * component triggers a same-commit width growth. T1 and T2 pin the two
 * production-build measurements the plan's frame-by-frame reading took from
 * the docs site: a 2009px block in a 100px default slot, and a 730px
 * mid-commit re-measure after a width change. T6 is a guard: it does not
 * reproduce the defect, and exists only to prove the drift is measured
 * against the child's own resolved extent, never the cell step to its next
 * sibling.
 *
 * C1-C4 are the other half of that guard, in both arms: a child that commits
 * *smaller* than its resolved extent must leave every later sibling exactly
 * where the calc phase planned it. Equal mode resolves every cell as
 * `FillType.BOTH`, which `LayoutManager.resolveBounds` hands over whole
 * without reading the child's maximum, so a child with a ceiling of its own
 * clamps back down inside its cell on every pass — the `Checkbox` committing
 * its own 16 pixels against a larger request that `commitBounds`' own
 * comment cites. Carrying that negative difference would pull later siblings
 * up into the slack; these four pin the positions that proves it does not.
 *
 * Follows LayoutManager.commitBounds.test.ts's host-Container idiom and its
 * `getX() + getTranslateX()` true-position reading.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { VBox } from '~/layout/VBox';
import { HBox } from '~/layout/HBox';
import { Markdown } from '~/component/display/Markdown';
import { Checkbox } from '~/component/input/Checkbox';
import { FillType } from '~/layout/FillType';
import { AnchorType } from '~/layout/AnchorType';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { DOM } from '~/core/DOM';
import { installTestDOM, setScrollExtent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/**
 * Stands in for the width arm's trigger, which no library component has today
 * (`Markdown`/`Image` both re-derive height from width, never width from
 * height — see the plan's `[^width-arm]`). Re-sets its own width at the end
 * of every `setHeight`, the mirror image of `Markdown.setWidth` raising a
 * height floor that the following `setHeight` clamps up to.
 */
class WidthOnHeightLeaf extends Component {
    // Bare `declare`, not a `= undefined` initializer: `armWidthAfterHeight`
    // runs after construction, so a real initializer would never fire before
    // it, but CODE_CONVENTIONS.md's cascade rule is the same shape as the
    // field it guards against here — keep the field declaration inert.
    declare private _widthAfterHeight: number | undefined;

    /**
     * Arms this leaf to re-set its own width to `width` at the end of every
     * subsequent `setHeight` call.
     *
     * @param width - The width to re-set after every `setHeight`.
     */
    armWidthAfterHeight(width: number): void {
        this._widthAfterHeight = width;
    }

    /**
     * Sets the height, then re-asserts the armed width — modelling a child
     * whose own commit raises its width after `LayoutManager.commitBounds`
     * already wrote the resolved one.
     *
     * @param height - The new height in pixels.
     * @returns This component, for method chaining.
     */
    setHeight(height: number): this {
        super.setHeight(height);

        if (this._widthAfterHeight !== undefined) {
            super.setWidth(this._widthAfterHeight);
        }

        return this;
    }
}

describe('BoxLayout.commitStackedPlacements drift carry', () => {
    let hosts: Container[];

    beforeEach(() => {
        installTestDOM(CONFIG);
        hosts = [];
    });

    afterEach(() => {
        // Disposing each host disposes its `Markdown` children, which removes
        // their theme listeners — DOM.reset() alone does not reach those.
        for (const host of hosts) {
            host.dispose();
        }

        DOM.reset();
    });

    /** Builds a Container hosting `vbox`, inset-cleared so the first cell starts at (0, 0). */
    function hostVBox(width: number, height: number, vbox: VBox): Container {
        const host = new Container({ layoutManager: vbox });

        host.getElement(true);
        host.setWidth(width);
        host.setHeight(height);
        host.clearInsets();
        hosts.push(host);

        return host;
    }

    /** Builds a Container hosting `hbox`, inset-cleared so the first cell starts at (0, 0). */
    function hostHBox(width: number, height: number, hbox: HBox): Container {
        const host = new Container({ layoutManager: hbox });

        host.getElement(true);
        host.setWidth(width);
        host.setHeight(height);
        host.clearInsets();
        hosts.push(host);

        return host;
    }

    /** A plain, non-growing child with a fixed preferred size. */
    function box(width: number, height: number): Component {
        return new Component({ preferredSize: { width, height } });
    }

    /**
     * Adds a `Markdown` to `host` and seeds it to report `extent` as its
     * measured content height the next time something re-measures it. `host`
     * must already have a materialised element.
     *
     * @param host - The container to add the `Markdown` to.
     * @param extent - The scroll extent to seed, in pixels.
     * @returns The added `Markdown`.
     */
    function md(host: Container, extent: number): Markdown {
        const m = new Markdown('# A');

        host.addComponent(m);
        setScrollExtent(m.getElement(true)!, { width: 0, height: extent });

        return m;
    }

    /** A component's true visual position: static origin plus any translate. */
    function truePosition(c: Component): { x: number; y: number } {
        return { x: c.getX() + c.getTranslateX(), y: c.getY() + c.getTranslateY() };
    }

    it('T1: a VBox child that clamps past its 100px default slot during commit pushes every later sibling down by the full growth', () => {
        const host = hostVBox(400, 5000, new VBox({ spacing: 0, itemAlign: 'stretch' }));
        const a = md(host, 2009);
        const b = box(100, 50);
        const c = box(100, 50);

        host.addComponent(b);
        host.addComponent(c);
        host.doLayout();

        expect(a.getHeight()).toBe(2009); // the growing child really grew

        expect(truePosition(b).y).toBe(2009);
        expect(truePosition(c).y).toBe(2059);
        expect(truePosition(b).x).toBe(0); // cross axis untouched
    });

    it('T2: a width change that raises an already-measured child\'s height mid-commit carries the drift forward', () => {
        const host = hostVBox(400, 5000, new VBox({ spacing: 0, itemAlign: 'stretch' }));
        const a = md(host, 500);
        const b = box(100, 50);

        host.addComponent(b);
        host.doLayout();
        host.doLayout();

        host.setWidth(300);
        setScrollExtent(a.getElement(true)!, { width: 0, height: 1230 });
        host.doLayout();

        expect(a.getHeight()).toBe(1230); // the growing child really grew

        expect(truePosition(b).y).toBe(1230);
    });

    it('T3: an equal-mode VBox child that clamps past its shared cell during commit pushes later siblings by the same drift', () => {
        const host = hostVBox(400, 300, new VBox({ mode: 'equal', spacing: 0, itemAlign: 'stretch' }));
        const a = md(host, 2009);
        const b = box(100, 50);
        const c = box(100, 50);

        host.addComponent(b);
        host.addComponent(c);
        host.doLayout();

        expect(a.getHeight()).toBe(2009); // the growing child really grew

        expect(truePosition(b).y).toBe(2009);
        expect(truePosition(c).y).toBe(2109);
    });

    it('T4: an HBox child that raises its own width during commit pushes every later sibling right by the full growth', () => {
        const host = hostHBox(1000, 40, new HBox({ spacing: 0, itemAlign: 'start' }));
        const a = new WidthOnHeightLeaf({ preferredSize: { width: 100, height: 40 } });

        a.armWidthAfterHeight(300);
        const b = box(50, 40);
        const c = box(50, 40);

        host.addComponent(a);
        host.addComponent(b);
        host.addComponent(c);
        host.doLayout();

        expect(a.getWidth()).toBe(300); // the growing child really grew

        expect(truePosition(b).x).toBe(300);
        expect(truePosition(c).x).toBe(350);
        expect(truePosition(b).y).toBe(0); // cross axis untouched
    });

    it('T5: an equal-mode HBox child that raises its own width during commit pushes later siblings by the same drift', () => {
        const host = hostHBox(300, 40, new HBox({ mode: 'equal', spacing: 0, itemAlign: 'start' }));
        const a = new WidthOnHeightLeaf({ preferredSize: { width: 100, height: 40 } });

        a.armWidthAfterHeight(300);
        const b = box(50, 40);
        const c = box(50, 40);

        host.addComponent(a);
        host.addComponent(b);
        host.addComponent(c);
        host.doLayout();

        expect(a.getWidth()).toBe(300); // the growing child really grew

        expect(truePosition(b).x).toBe(300);
        expect(truePosition(c).x).toBe(400);
    });

    it('T6: a smaller, anchored child inside its equal-mode cell does not pull later siblings into its own slack', () => {
        const host = hostVBox(400, 300, new VBox({ mode: 'equal', spacing: 0, itemAlign: 'stretch' }));
        const a = box(100, 50);
        const b = box(100, 40);
        const c = box(100, 50);
        const bConstraints = Object.assign(new LayoutConstraints(), { fill: FillType.NONE, anchor: AnchorType.NORTHWEST });

        host.addComponent(a);
        host.addComponent(b, bConstraints);
        host.addComponent(c);
        host.doLayout();

        expect(b.getHeight()).toBe(40); // smaller than its 100px cell, not clamped up

        expect(truePosition(c).y).toBe(200);
    });

    it('C1: an equal-mode VBox child that clamps down inside its cell leaves its sibling where the calc phase planned it', () => {
        const host = hostVBox(400, 300, new VBox({ mode: 'equal', spacing: 0, itemAlign: 'stretch' }));
        const a = new Checkbox();
        const b = box(100, 50);

        host.addComponent(a);
        host.addComponent(b);
        host.doLayout();

        // The clamp-down really happened: the cell is 150px, the Checkbox
        // commits its own 16. Without this the position check below would
        // pass for the wrong reason — nothing having moved either way.
        expect(a.getHeight()).toBe(16);

        expect(truePosition(b).y).toBe(150);
    });

    it('C2: an equal-mode VBox child held down by its own maxSize leaves its sibling where the calc phase planned it', () => {
        const host = hostVBox(400, 300, new VBox({ mode: 'equal', spacing: 0, itemAlign: 'stretch' }));
        const a = new Component({ preferredSize: { width: 100, height: 50 }, maxSize: { width: 400, height: 30 } });
        const b = box(100, 50);

        host.addComponent(a);
        host.addComponent(b);
        host.doLayout();

        expect(a.getHeight()).toBe(30); // clamped down from the 150px cell

        expect(truePosition(b).y).toBe(150);
    });

    it('C3: an equal-mode HBox child that clamps down inside its cell leaves its sibling where the calc phase planned it', () => {
        const host = hostHBox(300, 40, new HBox({ mode: 'equal', spacing: 0, itemAlign: 'stretch' }));
        const a = new Checkbox();
        const b = box(50, 40);

        host.addComponent(a);
        host.addComponent(b);
        host.doLayout();

        expect(a.getWidth()).toBe(16); // clamped down from the 150px cell

        expect(truePosition(b).x).toBe(150);
    });

    it('C4: an equal-mode HBox child held down by its own maxSize leaves its sibling where the calc phase planned it', () => {
        const host = hostHBox(300, 40, new HBox({ mode: 'equal', spacing: 0, itemAlign: 'stretch' }));
        const a = new Component({ preferredSize: { width: 50, height: 40 }, maxSize: { width: 30, height: 40 } });
        const b = box(50, 40);

        host.addComponent(a);
        host.addComponent(b);
        host.doLayout();

        expect(a.getWidth()).toBe(30); // clamped down from the 150px cell

        expect(truePosition(b).x).toBe(150);
    });

    // C5/C6 are the only cases whose cell step differs from the growing
    // child's own resolved extent, which takes `spacing` off this file's
    // otherwise universal 0. With spacing 0 the two are numerically equal, so
    // measuring the drift against the step instead of the extent — the error
    // `## Architecture Decisions`' "never its cell" forbids — is
    // indistinguishable in every other case here, and the growth-only guard
    // floors the negative difference it produces on a clamp-down child to the
    // same 0 the correct code gives. These two restore a case that error can
    // fail.
    it('C5: a growing VBox child\'s drift is measured against its own extent, not the spacing-inclusive step to its sibling', () => {
        const host = hostVBox(400, 5000, new VBox({ spacing: 10, itemAlign: 'stretch' }));
        const a = md(host, 2009);
        const b = box(100, 50);
        const c = box(100, 50);

        host.addComponent(b);
        host.addComponent(c);
        host.doLayout();

        expect(a.getHeight()).toBe(2009); // the growing child really grew

        // Planned: A at 0 in a 100px default slot, B at 100 + 10 spacing, C a
        // further 50 + 10 on. Drift is A's own 2009 - 100 = 1909, so each
        // lands 1909 lower. Measuring against the 110px step would carry
        // 1899 and leave both 10px short.
        expect(truePosition(b).y).toBe(2019);
        expect(truePosition(c).y).toBe(2079);
    });

    it('C6: a growing HBox child\'s drift is measured against its own extent, not the spacing-inclusive step to its sibling', () => {
        const host = hostHBox(1000, 40, new HBox({ spacing: 10, itemAlign: 'start' }));
        const a = new WidthOnHeightLeaf({ preferredSize: { width: 100, height: 40 } });

        a.armWidthAfterHeight(300);
        const b = box(50, 40);
        const c = box(50, 40);

        host.addComponent(a);
        host.addComponent(b);
        host.addComponent(c);
        host.doLayout();

        expect(a.getWidth()).toBe(300); // the growing child really grew

        // Drift is A's own 300 - 100 = 200. Measuring against the 110px step
        // would carry 190 and leave both 10px short.
        expect(truePosition(b).x).toBe(310);
        expect(truePosition(c).x).toBe(370);
    });
});
