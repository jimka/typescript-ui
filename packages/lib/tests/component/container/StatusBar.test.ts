import { describe, it, expect, afterEach, vi } from 'vitest';
import { StatusBar } from '~/component/container/StatusBar';
import { Component } from '~/core/Component';
import { Text } from '~/component/input/Text';
import { Glyph } from '~/component/display/Glyph';
import { Button } from '~/component/button/Button';
import { HBox } from '~/layout/HBox';
import { Spacer } from '~/component/container/Spacer';
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

// Geometry tests need the font vars for centerInHeight's line-box maths to
// reproduce the plan's measured numbers; the message-only CONFIG above has
// none.
const GEOMETRY_CONFIG = {
    ...CONFIG,
    themeVars: {
        '--ts-ui-font-family':  'TestSans',
        '--ts-ui-font-size':    '14px',
        '--ts-ui-line-padding': '2px',
    },
};

/**
 * Sums `getY()` from `component` up to (but not including) `stopAt`, so the
 * result is `component`'s Y position in `stopAt`'s content-box coordinate
 * frame — the frame `getBaseline()` values are measured against.
 */
function ancestorOffsetY(component: Component, stopAt: Component): number {
    let y: number = 0;
    let node: Component | null = component;

    while (node !== null && node !== stopAt) {
        y += node.getY();
        node = node.getParentComponent();
    }

    return y;
}

describe('StatusBar message', () => {
    afterEach(() => DOM.reset());

    it('defaults message and defaultMessage to empty strings', () => {
        installTestDOM(CONFIG);

        const bar = new StatusBar();

        expect(bar.getMessage()).toBe('');
        expect(bar.getDefaultMessage()).toBe('');
    });

    it('round-trips setMessage', () => {
        installTestDOM(CONFIG);

        const bar = new StatusBar();

        bar.setMessage('Saved');

        expect(bar.getMessage()).toBe('Saved');
    });

    it('round-trips setDefaultMessage and shows it when no message is in flight', () => {
        installTestDOM(CONFIG);

        const bar = new StatusBar();

        bar.setDefaultMessage('Ready');

        // No transient message pending, so the default surfaces immediately.
        expect(bar.getDefaultMessage()).toBe('Ready');
        expect(bar.getMessage()).toBe('Ready');
    });

    it('shows the configured initial message and seeds from defaultMessage', () => {
        installTestDOM(CONFIG);

        expect(new StatusBar({ message: 'Hi' }).getMessage()).toBe('Hi');
        expect(new StatusBar({ defaultMessage: 'Idle' }).getMessage()).toBe('Idle');
    });

    it('clearMessage reverts to the default message', () => {
        installTestDOM(CONFIG);

        const bar = new StatusBar({ defaultMessage: 'Ready' });

        bar.setMessage('Working');

        expect(bar.getMessage()).toBe('Working');

        bar.clearMessage();

        expect(bar.getMessage()).toBe('Ready');
    });
});

describe('StatusBar timed message revert', () => {
    afterEach(() => {
        vi.useRealTimers();
        DOM.reset();
    });

    it('restores the default message after the timeout via fake timers', () => {
        vi.useFakeTimers();
        installTestDOM(CONFIG);

        const bar = new StatusBar({ defaultMessage: 'Ready' });

        bar.setMessage('Saved', 2000);

        expect(bar.getMessage()).toBe('Saved');

        // Deterministic timer test — advance past the timeout, no real wait.
        vi.advanceTimersByTime(2000);

        expect(bar.getMessage()).toBe('Ready');
    });

    it('a later setMessage cancels the pending revert', () => {
        vi.useFakeTimers();
        installTestDOM(CONFIG);

        const bar = new StatusBar({ defaultMessage: 'Ready' });

        bar.setMessage('First', 2000);
        bar.setMessage('Second'); // persistent — cancels the pending revert

        vi.advanceTimersByTime(5000);

        expect(bar.getMessage()).toBe('Second');
    });
});

describe('offline harness honours line-height (guards the TestDOM fix)', () => {
    afterEach(() => DOM.reset());

    it('a centerInHeight(21) Text reports a 21px line box and baseline 16; plain Text reports 16px/13', () => {
        installTestDOM(GEOMETRY_CONFIG);

        const anchored = new Text('Hello');
        anchored.centerInHeight(21);

        expect(anchored.getPreferredSize()).toEqual({ width: 33, height: 21 });
        expect(anchored.getBaseline()).toBe(16);

        const plain = new Text('Hello');

        expect(plain.getPreferredSize()).toEqual({ width: 33, height: 16 });
        expect(plain.getBaseline()).toBe(13);
    });
});

describe('StatusBar flattened structure', () => {
    afterEach(() => DOM.reset());

    it('does not stretch its layout manager', () => {
        installTestDOM(CONFIG);

        const bar = new StatusBar();

        expect((bar.getLayoutManager() as HBox).isStretching()).toBe(false);
    });

    it('holds one flat row: message Text then the flex Spacer, no intermediate Container', () => {
        installTestDOM(CONFIG);

        const bar = new StatusBar();
        const children = bar.getComponents();

        expect(children).toHaveLength(2);
        expect(children[0]).toBeInstanceOf(Text);
        expect(children[1]).toBeInstanceOf(Spacer);
    });

    it('addLeft inserts before the pivot; addRight appends after it', () => {
        installTestDOM(CONFIG);

        const bar = new StatusBar();
        const a   = new Text('a');
        const b   = new Text('b');

        bar.addLeft(a);
        bar.addRight(b);

        const children = bar.getComponents();

        expect(children).toHaveLength(4);
        expect(children[0]).toBeInstanceOf(Text); // message
        expect(children[1]).toBe(a);
        expect(children[2]).toBeInstanceOf(Spacer);
        expect(children[3]).toBe(b);
    });
});

describe('StatusBar baseline alignment (the reported bug)', () => {
    afterEach(() => DOM.reset());

    /**
     * Builds the sqladmin reproduction: a message plus a right-hand identity
     * widget (`Glyph` + `Text` in a non-stretching `HBox`), matching *Measured
     * Baseline Data* in the plan. Optionally appends a glyph-only `Button`
     * pinned to 14px to reproduce the no-clipping composition.
     */
    function buildBar(withButton: boolean): { bar: StatusBar; identityText: Text; button?: Button } {
        const bar = new StatusBar();
        bar.setMessage('Hello');

        const identityText = new Text('user');
        const identity = new Component({
            layoutManager: new HBox({ spacing: 6 }),
            components:    [new Glyph('unicode-arrow-up'), identityText],
        });
        bar.addRight(identity);

        let button: Button | undefined;
        if (withButton) {
            button = new Button({ glyph: 'unicode-arrow-up', flat: true, compact: true });
            button.pinGlyphSize(14);
            bar.addRight(button);
        }

        bar.getElement(true);
        bar.setWidth(400);
        bar.setHeight(21);
        bar.doLayout();

        return { bar, identityText, button };
    }

    it('aligns the message and the identity widget on the same baseline', () => {
        installTestDOM(GEOMETRY_CONFIG);

        const { bar, identityText } = buildBar(false);
        const messageText = bar.getComponents()[0] as Text;

        const messageAbsBaseline  = ancestorOffsetY(messageText, bar) + (messageText.getBaseline() as number);
        const identityAbsBaseline = ancestorOffsetY(identityText, bar) + (identityText.getBaseline() as number);

        expect(messageAbsBaseline).toBe(16);
        expect(identityAbsBaseline).toBe(16);
    });

    it('does not clip any widget past the bar bottom edge', () => {
        installTestDOM(GEOMETRY_CONFIG);

        const { bar } = buildBar(true);

        for (const child of bar.getComponents()) {
            expect(child.getY() + child.getHeight()).toBeLessThanOrEqual(21);
        }
    });

    it('wants exactly STATUS_BAR_HEIGHT as its preferred height — zero slack', () => {
        installTestDOM(GEOMETRY_CONFIG);

        const { bar } = buildBar(true);

        // getPreferredSize() reports the bar's OUTER size: the row's 21px
        // content requirement (computeRowHeight; see the "no clipping" test
        // above for that band asserted directly) plus the bar's own 1px top
        // border via Component.getPerimeterSize(). 21 + 1 = 22 = exactly
        // STATUS_BAR_HEIGHT: the row wants no more and no less than what the
        // fixed-height bar offers.
        expect(bar.getLayoutManager().getPreferredSize()!.height).toBe(22);
    });

    it('centres a baseline-less pinned button in the text line rather than top-anchoring it', () => {
        installTestDOM(GEOMETRY_CONFIG);

        const { button } = buildBar(true);

        expect(button!.getY()).toBe(0.5);
    });

    it('reports the bar stays STATUS_BAR_HEIGHT tall after layout at any width', () => {
        installTestDOM(GEOMETRY_CONFIG);

        const { bar } = buildBar(true);

        expect(bar.getHeight()).toBe(22);
    });
});

describe('Glyph-only Button sizing (pre-existing, documented budget)', () => {
    afterEach(() => DOM.reset());

    it('reports a null baseline and a 22x22 minimum by default; pinGlyphSize(14) brings it to 20x20', () => {
        installTestDOM(GEOMETRY_CONFIG);

        const button = new Button({ glyph: 'unicode-arrow-up', flat: true, compact: true });

        expect(button.getBaseline()).toBe(null);
        expect(button.getMinSize()).toEqual({ width: 22, height: 22 });

        button.pinGlyphSize(14);

        expect(button.getMinSize()).toEqual({ width: 20, height: 20 });
    });
});

describe('StatusBar empty-message anchor collapse (documented limitation)', () => {
    afterEach(() => DOM.reset());

    it('an empty message Text has a null baseline and collapses to 0x0', () => {
        installTestDOM(GEOMETRY_CONFIG);

        const text = new Text('');
        text.centerInHeight(21);

        expect(text.getBaseline()).toBe(null);
        expect(text.getPreferredSize()).toEqual({ width: 0, height: 0 });
    });
});
