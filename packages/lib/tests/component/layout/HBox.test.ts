import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { HBox } from '~/layout/HBox';
import { Text } from '~/component/input/Text';
import { AnchorType } from '~/layout/AnchorType';
import { FillType } from '~/layout/FillType';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Insets } from '~/primitive/Insets';
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
 * Builds a Container hosting an HBox, sized and inset-cleared so cell origins
 * start at (0,0). The host MUST be a Container (clampsToContentSize() === false)
 * and have a materialised element, or doLayout() early-returns / collapses.
 */
function hostHBox(width: number, height: number, hbox: HBox): Container {
    const host = new Container({ layoutManager: hbox });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

describe('HBox', () => {
    it('defaults component spacing to 5', () => {
        expect(new HBox().getComponentSpacing()).toBe(5);
    });
    it('updates component spacing', () => {
        const hbox = new HBox();
        hbox.setComponentSpacing(10);
        expect(hbox.getComponentSpacing()).toBe(10);
    });
    it('defaults stretching to false', () => {
        expect(new HBox().isStretching()).toBe(false);
    });
    it('toggles stretching', () => {
        const hbox = new HBox();
        hbox.setStretching(true);
        expect(hbox.isStretching()).toBe(true);
    });
    it('doLayout() does not throw without a container', () => {
        expect(() => new HBox().doLayout()).not.toThrow();
    });
    it('defaults itemAlign to "baseline"', () => {
        expect(new HBox().getItemAlign()).toBe('baseline');
    });
    it('stretching:true option maps to itemAlign "stretch"', () => {
        const hbox = new HBox({ stretching: true });
        expect(hbox.getItemAlign()).toBe('stretch');
        expect(hbox.isStretching()).toBe(true);
    });
    it('stretching:false option maps to itemAlign "baseline"', () => {
        expect(new HBox({ stretching: false }).getItemAlign()).toBe('baseline');
    });
    it('setStretching toggles itemAlign between "stretch" and "baseline"', () => {
        const hbox = new HBox();
        hbox.setStretching(true);
        expect(hbox.getItemAlign()).toBe('stretch');
        hbox.setStretching(false);
        expect(hbox.getItemAlign()).toBe('baseline');
    });
    it('setItemAlign updates isStretching', () => {
        const hbox = new HBox();
        hbox.setItemAlign('stretch');
        expect(hbox.isStretching()).toBe(true);
        hbox.setItemAlign('center');
        expect(hbox.isStretching()).toBe(false);
    });
    it('an explicit itemAlign option wins over stretching (dispatched after)', () => {
        const hbox = new HBox({ stretching: true, itemAlign: 'center' });
        expect(hbox.getItemAlign()).toBe('center');
    });
    it('round-trips setItemAlign/getItemAlign', () => {
        const hbox = new HBox();
        hbox.setItemAlign('end');
        expect(hbox.getItemAlign()).toBe('end');
    });
});

describe('HBox itemAlign cross placement', () => {
    afterEach(() => DOM.reset());

    it('itemAlign "start" pins the child to the row\'s leading edge', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 24, new HBox({ itemAlign: 'start' }));
        const child = new Component({ preferredSize: { width: 100, height: 16 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getY()).toBe(0);
        expect(child.getHeight()).toBe(16);
    });

    it('itemAlign "center" centres the child in the row', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 24, new HBox({ itemAlign: 'center' }));
        const child = new Component({ preferredSize: { width: 100, height: 16 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getY()).toBe(4); // (24 - 16) / 2
        expect(child.getHeight()).toBe(16);
    });

    it('itemAlign "end" pins the child to the row\'s trailing edge', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 24, new HBox({ itemAlign: 'end' }));
        const child = new Component({ preferredSize: { width: 100, height: 16 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getY()).toBe(8); // 24 - 16
        expect(child.getHeight()).toBe(16);
    });

    it('itemAlign "stretch" fills the row height', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 24, new HBox({ itemAlign: 'stretch' }));
        const child = new Component({ preferredSize: { width: 100, height: 16 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getY()).toBe(0);
        expect(child.getHeight()).toBe(24);
    });

    it('the deprecated stretching:true option behaves identically to itemAlign "stretch"', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 24, new HBox({ stretching: true }));
        const child = new Component({ preferredSize: { width: 100, height: 16 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getY()).toBe(0);
        expect(child.getHeight()).toBe(24);
    });

    it('the default itemAlign top-aligns a non-baseline child (unchanged from today)', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 24, new HBox());
        const child = new Component({ preferredSize: { width: 100, height: 16 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getY()).toBe(0);
        expect(child.getHeight()).toBe(16);
    });

    it('per-child align-self overrides itemAlign for that child only', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 24, new HBox({ itemAlign: 'center' }));
        const centred = new Component({ preferredSize: { width: 50, height: 16 } });
        const anchored = new Component({ preferredSize: { width: 50, height: 16 } });
        const anchorConstraints = Object.assign(new LayoutConstraints(), { anchor: AnchorType.SOUTH });

        host.addComponent(centred);
        host.addComponent(anchored, anchorConstraints);
        host.doLayout();

        expect(centred.getY()).toBe(4);  // centred: (24 - 16) / 2
        expect(anchored.getY()).toBe(8); // SOUTH-anchored: pinned to the row bottom
    });

    // Regression coverage for the itemAlign cross-extent double-subtraction
    // bug: `containerSize` (from `getInnerSize()`) already excludes the
    // host's insets, so the row's cross band is `containerSize.height`
    // itself, offset by `crossLead` — subtracting the insets a second time
    // shrank the band and left a gap between an aligned child and the host's
    // true far edge.
    it('itemAlign "end" reaches the host\'s true bottom inset with non-zero insets', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 60, new HBox({ itemAlign: 'end' }));
        host.setInsets(new Insets(10, 0, 10, 0));
        // The host's inner (content) height is 60 - 10 - 10 = 40; that is the
        // row's cross band, unmodified. A 30px-tall child aligned "end" sits
        // flush with the band's bottom edge, 10px above the host's own bottom
        // edge (60 - 10 = 50).
        const child = new Component({ preferredSize: { width: 100, height: 30 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getY()).toBe(20); // 10 (top inset) + (40 - 30)
        expect(child.getHeight()).toBe(30);
        expect(child.getY() + child.getHeight()).toBe(50); // flush with the host's true bottom inset
    });

    it('itemAlign "center" centres the child within the host\'s true cross band with non-zero insets', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 60, new HBox({ itemAlign: 'center' }));
        host.setInsets(new Insets(10, 0, 10, 0));
        const child = new Component({ preferredSize: { width: 100, height: 30 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getY()).toBe(15); // 10 (top inset) + (40 - 30) / 2
        expect(child.getHeight()).toBe(30);
    });
});

describe('HBox justify with insets', () => {
    afterEach(() => DOM.reset());

    // Regression coverage for the justify-residual double-subtraction bug:
    // `containerSize` (from `getInnerSize()`) already excludes the host's
    // insets, so the row's main-axis band is `containerSize.width` itself —
    // subtracting the insets a second time shrank the band and left an
    // outsized, asymmetric gap on the trailing side for every justify mode
    // except "start".
    it('justify "end" reaches the host\'s true trailing inset with non-zero insets', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 24, new HBox({ justify: 'end' }));
        host.setInsets(new Insets(0, 10, 0, 10));
        // The host's inner (content) width is 200 - 10 - 10 = 180; that is the
        // row's main-axis band, unmodified. A 50px-wide child justified "end"
        // sits flush with the band's trailing edge.
        const child = new Component({ preferredSize: { width: 50, height: 16 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getX()).toBe(140); // 10 (left inset) + (180 - 50)
        expect(child.getX() + child.getWidth()).toBe(190); // flush with the host's true right inset (200 - 10)
    });

    it('justify "center" centres the child within the host\'s true main-axis band with non-zero insets', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 24, new HBox({ justify: 'center' }));
        host.setInsets(new Insets(0, 10, 0, 10));
        const child = new Component({ preferredSize: { width: 50, height: 16 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getX()).toBe(75); // 10 (left inset) + (180 - 50) / 2
    });
});

describe('HBox per-child anchor/fill cross placement with insets', () => {
    afterEach(() => DOM.reset());

    // Regression coverage for the same crossExtent double-subtraction bug,
    // exercised through the per-child anchor/fill constraint path
    // (`BoxLayout.crossPlacement`) rather than the global `itemAlign` option —
    // this is the exact path the reported bug traveled through in
    // AlignSelfPanel's NORTH/SOUTH/fill row.
    it('a SOUTH-anchored child reaches the host\'s true bottom inset with non-zero insets', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 60, new HBox());
        host.setInsets(new Insets(10, 0, 10, 0));
        const child = new Component({ preferredSize: { width: 100, height: 30 } });
        const constraints = Object.assign(new LayoutConstraints(), { anchor: AnchorType.SOUTH });

        host.addComponent(child, constraints);
        host.doLayout();

        expect(child.getY()).toBe(20); // 10 (top inset) + (40 - 30)
        expect(child.getHeight()).toBe(30);
        expect(child.getY() + child.getHeight()).toBe(50); // flush with the host's true bottom inset (60 - 10)
    });

    it('a VERTICAL-fill child spans the host\'s true cross band with non-zero insets', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 60, new HBox());
        host.setInsets(new Insets(10, 0, 10, 0));
        const child = new Component({ preferredSize: { width: 100, height: 30 } });
        const constraints = Object.assign(new LayoutConstraints(), { fill: FillType.VERTICAL });

        host.addComponent(child, constraints);
        host.doLayout();

        expect(child.getY()).toBe(10); // top inset
        expect(child.getHeight()).toBe(40); // 60 - 10 - 10: the full true cross band, not trimmed again
    });
});

describe('HBox itemAlign cross placement — mode: "equal"', () => {
    afterEach(() => DOM.reset());

    it('itemAlign "start" pins the child to the row\'s leading edge', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 24, new HBox({ mode: 'equal', itemAlign: 'start' }));
        const child = new Component({ preferredSize: { width: 100, height: 16 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getY()).toBe(0);
        expect(child.getHeight()).toBe(16);
    });

    it('itemAlign "center" centres the child in the row', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 24, new HBox({ mode: 'equal', itemAlign: 'center' }));
        const child = new Component({ preferredSize: { width: 100, height: 16 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getY()).toBe(4); // (24 - 16) / 2
        expect(child.getHeight()).toBe(16);
    });

    it('itemAlign "end" pins the child to the row\'s trailing edge', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 24, new HBox({ mode: 'equal', itemAlign: 'end' }));
        const child = new Component({ preferredSize: { width: 100, height: 16 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getY()).toBe(8); // 24 - 16
        expect(child.getHeight()).toBe(16);
    });
});

describe('HBox getContentBaseline itemAlign guard', () => {
    afterEach(() => DOM.reset());

    it('returns a baseline for the default itemAlign ("baseline")', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 100, new HBox());
        host.addComponent(new Text('Label'));

        expect(host.getBaseline()).not.toBeNull();
    });

    it('returns null when itemAlign is "center"', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 100, new HBox({ itemAlign: 'center' }));
        host.addComponent(new Text('Label'));

        expect(host.getBaseline()).toBeNull();
    });

    it('returns null when itemAlign is "stretch" (unchanged from today, now via the itemAlign guard)', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(200, 100, new HBox({ itemAlign: 'stretch' }));
        host.addComponent(new Text('Label'));

        expect(host.getBaseline()).toBeNull();
    });

    it('returns null via the deprecated setStretching(true)', () => {
        installTestDOM(CONFIG);

        const hbox = new HBox();
        hbox.setStretching(true);

        const host = hostHBox(200, 100, hbox);
        host.addComponent(new Text('Label'));

        expect(host.getBaseline()).toBeNull();
    });
});

describe('HBox resolveChildWidth clamp ordering', () => {
    afterEach(() => DOM.reset());

    it('honours the minimum over a smaller maximum, so a later sibling does not overlap (degenerate min > max)', () => {
        installTestDOM(CONFIG);

        const hbox = new HBox();
        const host = hostHBox(800, 200, hbox);
        const stage = new Component({ preferredSize: { width: 120, height: 50 } });
        stage.setMinSize({ width: 120, height: 50 });
        stage.setMaxSize({ width: 47, height: 50 });
        const toggle = new Component({ preferredSize: { width: 30, height: 50 } });

        host.addComponent(stage);
        host.addComponent(toggle);
        host.doLayout();

        // The stage's own committed width always lands on its min (120) once
        // Component.setWidth's clampWidth reasserts it — that step alone
        // doesn't distinguish the bug from the fix.
        expect(stage.getWidth()).toBe(120);

        // What DOES distinguish them: the row must reserve the stage's full
        // min width before advancing to the next child, not the smaller
        // (wrong) max it clamps to internally. Before the fix, the toggle
        // lands at 47 + spacing, overlapping the stage's last 73px.
        expect(toggle.getX()).toBe(120 + hbox.getComponentSpacing());
    });
});
