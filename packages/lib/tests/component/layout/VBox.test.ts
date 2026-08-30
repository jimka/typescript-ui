import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { VBox } from '~/layout/VBox';
import { HBox } from '~/layout/HBox';
import { Text } from '~/component/input/Text';
import { Insets } from '~/primitive/Insets';
import { AnchorType } from '~/layout/AnchorType';
import { FillType } from '~/layout/FillType';
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

    it('defaults itemAlign to "baseline"', () => {
        expect(new VBox().getItemAlign()).toBe('baseline');
    });

    it('stretching:true option maps to itemAlign "stretch"', () => {
        const vbox = new VBox({ stretching: true });

        expect(vbox.getItemAlign()).toBe('stretch');
        expect(vbox.isStretching()).toBe(true);
    });

    it('stretching:false option maps to itemAlign "baseline"', () => {
        expect(new VBox({ stretching: false }).getItemAlign()).toBe('baseline');
    });

    it('setStretching toggles itemAlign between "stretch" and "baseline"', () => {
        const vbox = new VBox();

        vbox.setStretching(true);
        expect(vbox.getItemAlign()).toBe('stretch');

        vbox.setStretching(false);
        expect(vbox.getItemAlign()).toBe('baseline');
    });

    it('setItemAlign updates isStretching', () => {
        const vbox = new VBox();

        vbox.setItemAlign('stretch');
        expect(vbox.isStretching()).toBe(true);

        vbox.setItemAlign('center');
        expect(vbox.isStretching()).toBe(false);
    });

    it('an explicit itemAlign option wins over stretching (dispatched after)', () => {
        const vbox = new VBox({ stretching: true, itemAlign: 'center' });

        expect(vbox.getItemAlign()).toBe('center');
    });

    it('round-trips setItemAlign/getItemAlign', () => {
        const vbox = new VBox();

        vbox.setItemAlign('end');

        expect(vbox.getItemAlign()).toBe('end');
    });
});

describe('VBox itemAlign cross placement', () => {
    afterEach(() => DOM.reset());

    it('itemAlign "start" pins the child to the column\'s leading edge', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(24, 200, new VBox({ itemAlign: 'start' }));
        const child = new Component({ preferredSize: { width: 16, height: 100 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getX()).toBe(0);
        expect(child.getWidth()).toBe(16);
    });

    it('itemAlign "center" centres the child in the column', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(24, 200, new VBox({ itemAlign: 'center' }));
        const child = new Component({ preferredSize: { width: 16, height: 100 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getX()).toBe(4); // (24 - 16) / 2
        expect(child.getWidth()).toBe(16);
    });

    it('itemAlign "end" pins the child to the column\'s trailing edge', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(24, 200, new VBox({ itemAlign: 'end' }));
        const child = new Component({ preferredSize: { width: 16, height: 100 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getX()).toBe(8); // 24 - 16
        expect(child.getWidth()).toBe(16);
    });

    it('itemAlign "stretch" fills the column width', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(24, 200, new VBox({ itemAlign: 'stretch' }));
        const child = new Component({ preferredSize: { width: 16, height: 100 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getX()).toBe(0);
        expect(child.getWidth()).toBe(24);
    });

    it('the deprecated stretching:true option behaves identically to itemAlign "stretch"', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(24, 200, new VBox({ stretching: true }));
        const child = new Component({ preferredSize: { width: 16, height: 100 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getX()).toBe(0);
        expect(child.getWidth()).toBe(24);
    });

    it('the default itemAlign ("baseline" degrading to "start") keeps west-origin placement', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(24, 200, new VBox());
        const child = new Component({ preferredSize: { width: 16, height: 100 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getX()).toBe(0);
        expect(child.getWidth()).toBe(16);
    });

    // Regression coverage for the itemAlign cross-extent double-subtraction
    // bug (the VBox counterpart of HBox's — see HBox.test.ts): `containerSize`
    // (from `getInnerSize()`) already excludes the host's insets, so the
    // column's cross band is `containerSize.width` itself, offset by
    // `crossLead` — subtracting the insets a second time shrank the band and
    // left a gap between an aligned child and the host's true far edge.
    it('itemAlign "end" reaches the host\'s true right inset with non-zero insets', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(60, 200, new VBox({ itemAlign: 'end' }));
        host.setInsets(new Insets(0, 10, 0, 10));
        // The host's inner (content) width is 60 - 10 - 10 = 40; that is the
        // column's cross band, unmodified. A 30px-wide child aligned "end"
        // sits flush with the band's trailing edge, 10px left of the host's
        // own right edge (60 - 10 = 50).
        const child = new Component({ preferredSize: { width: 30, height: 100 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getX()).toBe(20); // 10 (left inset) + (40 - 30)
        expect(child.getWidth()).toBe(30);
        expect(child.getX() + child.getWidth()).toBe(50); // flush with the host's true right inset
    });

    it('itemAlign "center" centres the child within the host\'s true cross band with non-zero insets', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(60, 200, new VBox({ itemAlign: 'center' }));
        host.setInsets(new Insets(0, 10, 0, 10));
        const child = new Component({ preferredSize: { width: 30, height: 100 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getX()).toBe(15); // 10 (left inset) + (40 - 30) / 2
        expect(child.getWidth()).toBe(30);
    });
});

describe('VBox justify with insets', () => {
    afterEach(() => DOM.reset());

    // Regression coverage for the justify-residual double-subtraction bug
    // (the VBox counterpart of HBox's — see HBox.test.ts): `containerSize`
    // (from `getInnerSize()`) already excludes the host's insets, so the
    // column's main-axis band is `containerSize.height` itself — subtracting
    // the insets a second time shrank the band and left an outsized,
    // asymmetric gap on the trailing side for every justify mode except
    // "start".
    it('justify "end" reaches the host\'s true trailing inset with non-zero insets', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(24, 200, new VBox({ justify: 'end' }));
        host.setInsets(new Insets(10, 0, 10, 0));
        // The host's inner (content) height is 200 - 10 - 10 = 180; that is
        // the column's main-axis band, unmodified. A 50px-tall child
        // justified "end" sits flush with the band's trailing edge.
        const child = new Component({ preferredSize: { width: 16, height: 50 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getY()).toBe(140); // 10 (top inset) + (180 - 50)
        expect(child.getY() + child.getHeight()).toBe(190); // flush with the host's true bottom inset (200 - 10)
    });

    it('justify "center" centres the child within the host\'s true main-axis band with non-zero insets', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(24, 200, new VBox({ justify: 'center' }));
        host.setInsets(new Insets(10, 0, 10, 0));
        const child = new Component({ preferredSize: { width: 16, height: 50 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getY()).toBe(75); // 10 (top inset) + (180 - 50) / 2
    });
});

describe('VBox per-child anchor/fill cross placement with insets', () => {
    afterEach(() => DOM.reset());

    // Regression coverage for the same crossExtent double-subtraction bug
    // (the VBox counterpart of HBox's — see HBox.test.ts), exercised through
    // the per-child anchor/fill constraint path (`BoxLayout.crossPlacement`)
    // rather than the global `itemAlign` option — this is the exact path the
    // reported bug traveled through in AlignSelfPanel's WEST/EAST/fill column.
    it('an EAST-anchored child reaches the host\'s true right inset with non-zero insets', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(60, 200, new VBox());
        host.setInsets(new Insets(0, 10, 0, 10));
        const child = new Component({ preferredSize: { width: 30, height: 100 } });
        const constraints = Object.assign(new LayoutConstraints(), { anchor: AnchorType.EAST });

        host.addComponent(child, constraints);
        host.doLayout();

        expect(child.getX()).toBe(20); // 10 (left inset) + (40 - 30)
        expect(child.getWidth()).toBe(30);
        expect(child.getX() + child.getWidth()).toBe(50); // flush with the host's true right inset (60 - 10)
    });

    it('a HORIZONTAL-fill child spans the host\'s true cross band with non-zero insets', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(60, 200, new VBox());
        host.setInsets(new Insets(0, 10, 0, 10));
        const child = new Component({ preferredSize: { width: 30, height: 100 } });
        const constraints = Object.assign(new LayoutConstraints(), { fill: FillType.HORIZONTAL });

        host.addComponent(child, constraints);
        host.doLayout();

        expect(child.getX()).toBe(10); // left inset
        expect(child.getWidth()).toBe(40); // 60 - 10 - 10: the full true cross band, not trimmed again
    });
});

describe('VBox itemAlign cross placement — mode: "equal"', () => {
    afterEach(() => DOM.reset());

    it('itemAlign "start" pins the child to the column\'s leading edge', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(24, 200, new VBox({ mode: 'equal', itemAlign: 'start' }));
        const child = new Component({ preferredSize: { width: 16, height: 100 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getX()).toBe(0);
        expect(child.getWidth()).toBe(16);
    });

    it('itemAlign "center" centres the child in the column', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(24, 200, new VBox({ mode: 'equal', itemAlign: 'center' }));
        const child = new Component({ preferredSize: { width: 16, height: 100 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getX()).toBe(4); // (24 - 16) / 2
        expect(child.getWidth()).toBe(16);
    });

    it('itemAlign "end" pins the child to the column\'s trailing edge', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(24, 200, new VBox({ mode: 'equal', itemAlign: 'end' }));
        const child = new Component({ preferredSize: { width: 16, height: 100 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getX()).toBe(8); // 24 - 16
        expect(child.getWidth()).toBe(16);
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

describe('VBox resolveChildHeight clamp ordering', () => {
    afterEach(() => DOM.reset());

    it('places a min <= max child at its preferred height (unchanged case)', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(200, 400, new VBox());
        const child = new Component({ preferredSize: { width: 50, height: 120 } });
        child.setMinSize({ width: 50, height: 40 });
        child.setMaxSize({ width: 50, height: 200 });

        host.addComponent(child);
        host.doLayout();

        expect(child.getHeight()).toBe(120);
    });

    it('floors a min <= max child below its minimum to the minimum (unchanged case)', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(200, 400, new VBox());
        const child = new Component({ preferredSize: { width: 50, height: 10 } });
        child.setMinSize({ width: 50, height: 40 });
        child.setMaxSize({ width: 50, height: 200 });

        host.addComponent(child);
        host.doLayout();

        expect(child.getHeight()).toBe(40);
    });

    it('caps a min <= max child above its maximum to the maximum (unchanged case)', () => {
        installTestDOM(CONFIG);

        const host = hostVBox(200, 400, new VBox());
        const child = new Component({ preferredSize: { width: 50, height: 900 } });
        child.setMinSize({ width: 50, height: 40 });
        child.setMaxSize({ width: 50, height: 200 });

        host.addComponent(child);
        host.doLayout();

        expect(child.getHeight()).toBe(200);
    });

    it('honours the minimum over a smaller maximum, so a later sibling does not overlap (degenerate min > max)', () => {
        installTestDOM(CONFIG);

        const vbox = new VBox();
        const host = hostVBox(200, 400, vbox);
        const stage = new Component({ preferredSize: { width: 50, height: 120 } });
        stage.setMinSize({ width: 50, height: 120 });
        stage.setMaxSize({ width: 50, height: 47 });
        const toggle = new Component({ preferredSize: { width: 50, height: 30 } });

        host.addComponent(stage);
        host.addComponent(toggle);
        host.doLayout();

        // The stage's own committed height always lands on its min (120) once
        // Component.setHeight's clampHeight reasserts it — that step alone
        // doesn't distinguish the bug from the fix.
        expect(stage.getHeight()).toBe(120);

        // What DOES distinguish them: the column must reserve the stage's full
        // min height before advancing to the next child, not the smaller
        // (wrong) max it clamps to internally. Before the fix, the toggle
        // lands at 47 + spacing, overlapping the stage's last 73px.
        expect(toggle.getY()).toBe(120 + vbox.getComponentSpacing());
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
        tall.setPreferredSize({ width: 40, height: 200 });
        tall.setMaxSize({ width: 200, height: 200 });

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
