import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { VBox } from '~/layout/VBox';
import { HBox } from '~/layout/HBox';
import { Text } from '~/component/input/Text';
import { Insets } from '~/primitive/Insets';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/**
 * Builds a Container hosting a VBox, sized and inset-cleared so cell origins
 * start at (0,0). The host MUST be a Container (clampsToContentSize() === false)
 * and have a materialised element, or doLayout() early-returns / collapses.
 */
function hostVBox(width: number, height: number, vbox: VBox): Container {
    const host = new Container({ layoutManager: vbox });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

describe('VBox setters/getters', () => {
    it('defaults component spacing to 5', () => {
        expect(new VBox().getComponentSpacing()).toBe(5);
    });

    it('updates component spacing', () => {
        const vbox = new VBox();

        vbox.setComponentSpacing(10);

        expect(vbox.getComponentSpacing()).toBe(10);
    });

    it('defaults stretching to false', () => {
        expect(new VBox().isStretching()).toBe(false);
    });

    it('toggles stretching', () => {
        const vbox = new VBox();

        vbox.setStretching(true);

        expect(vbox.isStretching()).toBe(true);
    });

    it('doLayout() does not throw without a container', () => {
        expect(() => new VBox().doLayout()).not.toThrow();
    });
});

describe('VBox doLayout geometry', () => {
    afterEach(() => DOM.reset());

    it('stacks children top-to-bottom separated by componentSpacing', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(200, 400, new VBox()); // default spacing 5
        const a = new Component({ preferredSize: { width: 50, height: 30 } });
        const b = new Component({ preferredSize: { width: 60, height: 40 } });

        host.addComponent(a);
        host.addComponent(b);

        host.doLayout();

        // Contract: stack at insets.top (0); child i's y = sum(prev heights) + i*spacing.
        expect(a.getY()).toBe(0);
        expect(a.getHeight()).toBe(30);
        expect(b.getY()).toBe(35); // 30 + spacing(5)
        expect(b.getHeight()).toBe(40);
    });

    it('stacks three children with the cumulative-offset relation', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(200, 600, new VBox({ spacing: 10 }));
        const a = new Component({ preferredSize: { width: 50, height: 30 } });
        const b = new Component({ preferredSize: { width: 50, height: 40 } });
        const c = new Component({ preferredSize: { width: 50, height: 20 } });

        host.addComponent(a);
        host.addComponent(b);
        host.addComponent(c);

        host.doLayout();

        expect(a.getY()).toBe(0);
        expect(b.getY()).toBe(40);  // 30 + 10
        expect(c.getY()).toBe(90);  // 30 + 40 + 2*10
    });

    it('keeps each child at its preferred width when not stretching', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(200, 400, new VBox());
        const a = new Component({ preferredSize: { width: 50, height: 30 } });
        const b = new Component({ preferredSize: { width: 60, height: 40 } });

        host.addComponent(a);
        host.addComponent(b);

        host.doLayout();

        expect(a.getWidth()).toBe(50);
        expect(b.getWidth()).toBe(60);
    });

    it('fills every child to the inner width when stretching', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(200, 400, new VBox({ stretching: true }));
        const a = new Component({ preferredSize: { width: 50, height: 30 } });
        const b = new Component({ preferredSize: { width: 60, height: 40 } });

        host.addComponent(a);
        host.addComponent(b);

        const innerWidth = host.getInnerSize()!.width;

        host.doLayout();

        expect(a.getWidth()).toBe(innerWidth);
        expect(b.getWidth()).toBe(innerWidth);
    });

    it('splits leftover vertical slack roughly in proportion to weight', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(200, 400, new VBox());
        const a = new Component({ preferredSize: { width: 50, height: 0 } });
        const b = new Component({ preferredSize: { width: 50, height: 0 } });

        const w1 = Object.assign(new LayoutConstraints(), { weight: 1 });
        const w2 = Object.assign(new LayoutConstraints(), { weight: 2 });

        host.addComponent(a, w1);
        host.addComponent(b, w2);

        host.doLayout();

        // Relational: a weight-2 cell gets ~2x the height of a weight-1 cell.
        expect(b.getHeight()).toBeCloseTo(a.getHeight() * 2, 5);
    });
});

/**
 * Builds a non-stretching HBox host (a Container so doLayout runs), sized and
 * inset-cleared so child origins start at (0,0). Mirrors the Anchor.test.ts
 * host pattern; used for the placement case that proves a VBox container
 * baseline-aligns in a row rather than centring.
 */
function hostHBox(width: number, height: number): Container {
    const host = new Container({ layoutManager: new HBox() });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

describe('VBox first-child baseline forwarding', () => {
    afterEach(() => DOM.reset());

    it('forwards the first child\'s baseline (chrome-free container adds 0)', () => {
        installTestDOM(CONFIG);

        const text = new Text('Label');
        const container = hostVBox(200, 400, new VBox());

        container.addComponent(text);

        // Container has zero insets/border/padding (hostVBox clears insets), so
        // wrapInnerBaseline adds nothing — the container baseline IS the child's.
        expect(text.getBaseline()).not.toBeNull();
        expect(container.getBaseline()).toBe(text.getBaseline());
    });

    it('baseline-aligns in a non-stretching HBox instead of centring', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(800, 400);

        // A: a short VBox container whose first row is a Text. A plain Component
        // (not Container) clamps to its content height, so it stays short and the
        // baseline-vs-centre distinction is real rather than filling the row.
        const column = new Component({ layoutManager: new VBox() });
        column.getElement(true);
        column.clearInsets();
        column.addComponent(new Text('First row'));

        // B: a tall baseline-bearing sibling — small baseline near the font
        // ascent, large box height, so it dominates the row's descent. Size via
        // the setters, not the constructor option: Text re-measures at
        // construction and caps a constructor preferredSize to its content
        // height, whereas setPreferredSize + setMaxSize hold the tall box.
        const tall = new Text('Tall');
        tall.setPreferredSize(40, 200);
        tall.setMaxSize(200, 200);

        host.addComponent(column);
        host.addComponent(tall);

        host.doLayout();

        const columnBaseline = column.getBaseline()!;
        const rowAscent = Math.max(columnBaseline, tall.getBaseline()!);

        // Baseline placement: y = contentTop(0) + (rowAscent - ownBaseline).
        expect(column.getY()).toBeCloseTo(rowAscent - columnBaseline, 5);

        // Guard: this must NOT be the old null-baseline centred position, which
        // sat the short column near the middle of the ~200px text line.
        const rowDescent = tall.getHeight() - tall.getBaseline()!;
        const centred = Math.max(0, (rowAscent + rowDescent - column.getHeight()) / 2);
        expect(column.getY()).not.toBeCloseTo(centred, 1);
    });

    it('returns null for an empty container (no children)', () => {
        installTestDOM(CONFIG);

        const container = hostVBox(200, 400, new VBox());

        expect(container.getBaseline()).toBeNull();
    });

    it('returns null when the first child has a null baseline (verbatim, no scan)', () => {
        installTestDOM(CONFIG);

        const container = hostVBox(200, 400, new VBox());

        // First child is a plain Component (Absolute layout → null baseline).
        container.addComponent(new Component({ preferredSize: { width: 50, height: 30 } }));
        // A later baseline-bearing child must NOT be consulted.
        container.addComponent(new Text('Has a baseline'));

        expect(container.getBaseline()).toBeNull();
    });

    it('adds the container chrome exactly once (no double-count)', () => {
        installTestDOM(CONFIG);

        const text = new Text('Label');
        const container = hostVBox(200, 400, new VBox());

        container.addComponent(text);
        container.setInsets(new Insets(10, 0, 0, 0));

        // Chrome (insets.top = 10) is added once by Component.getBaseline →
        // wrapInnerBaseline; getContentBaseline itself stays content-relative.
        expect(container.getBaseline()).toBe(text.getBaseline()! + 10);
    });

    it('still forwards the baseline when stretching (no HBox-style guard)', () => {
        installTestDOM(CONFIG);

        const text = new Text('Label');
        const container = hostVBox(200, 400, new VBox({ stretching: true }));

        container.addComponent(text);

        // VBox stretching is the cross (width) axis and leaves child baselines
        // intact, so the baseline is NOT nulled out (unlike HBox stretching).
        expect(container.getBaseline()).toBe(text.getBaseline());
        expect(container.getBaseline()).not.toBeNull();
    });
});
