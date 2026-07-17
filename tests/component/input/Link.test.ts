// Link is a Text subclass rendering a real `<a>`: its hit area is exactly the
// glyph box, it has no href, and it activates on click or Enter (never Space).
// `interactive: false` makes it presentational — no role, no tabindex, and an
// inert keydown handler — which is the mode LinkCellRenderer composes.
//
// Every Link registers a "keydown" listener in its constructor, so EVERY link a
// test creates must be disposed before the test ends. `Event`'s
// `installedListenerTypes` is module state that survives `DOM.reset()`, while
// `installTestDOM` mints a fresh sink with no window handler — so a type left
// registered makes the NEXT test's events silently vanish. Driving each type's
// listener count to zero triggers `uninstallBaseListener`, which re-arms the
// next test. Hence `makeLink`/`wire` and the `made` teardown registry: use them
// rather than constructing links directly.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Link } from '~/component/input/Link';
import type { LinkOptions } from '~/component/input/Link';
import { Text } from '~/component/input/Text';
import { DOM } from '~/core/DOM';
import { Event } from '~/core/Event';
import { installTestDOM, makeEvent, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

const LINK_COLOR = 'var(--ts-ui-link-color, rgb(21, 101, 192))';

let sink: RecordingDOMSink;
let made: Array<() => void>;

beforeEach(() => {
    sink = installTestDOM(CONFIG);
    made = [];
});

afterEach(() => {
    for (const teardown of made) {
        teardown();
    }

    DOM.reset();
});

/**
 * Creates a Link and schedules the dispose() that releases its keydown
 * listener. Every link in this file must come from here — see the file header.
 */
function makeLink(text?: string, options?: LinkOptions): Link {
    const link = new Link(text, options);

    made.push(() => link.dispose());

    return link;
}

/** Mounts a link, registers an "action" spy, and schedules its removal. */
function wire(link: Link) {
    const fn = vi.fn();

    link.getElement(true);
    link.on('action', fn);
    made.push(() => link.off('action', fn));

    return fn;
}

/** Routes a real keydown to the link through the window-capture path. */
function pressKey(link: Link, key: string): void {
    Event.fireEvent(link, makeEvent(link.getElement(true)!, 'keydown', { key }) as any);
}

/** Latest recorded `setAttr` value for `attr` on any handle, or undefined. */
function lastSetAttr(attr: string): unknown {
    let value: unknown;

    for (const w of sink.writes) {
        if (w.op !== 'apply') {
            continue;
        }

        const patch = w.args[1] as { setAttr?: Record<string, unknown> };

        if (patch?.setAttr && attr in patch.setAttr) {
            value = patch.setAttr[attr];
        }
    }

    return value;
}

describe('Link element and styling', () => {
    it('renders an <a> element', () => {
        const link = makeLink('Docs');

        link.getElement(true);

        expect(sink.writes.some((w) => w.op === 'createElement' && w.args[0] === 'a')).toBe(true);
        expect(link.getTag()).toBe('a');
    });

    it('supplies tag as a fallback a caller can override', () => {
        expect(makeLink('x', { tag: 'span' }).getTag()).toBe('span');
    });

    it('defaults to the link colour and a pointer cursor', () => {
        const link = makeLink('x');

        expect(link.getForegroundColor()).toBe(LINK_COLOR);
        expect(link.getCursor()).toBe('pointer');
    });

    it('lets a caller override the foreground colour', () => {
        expect(makeLink('x', { foregroundColor: 'rgb(1, 2, 3)' }).getForegroundColor()).toBe('rgb(1, 2, 3)');
    });

    it('lets an explicit clear suppress the colour default', () => {
        expect(makeLink('x').clearForegroundColor().getForegroundColor()).toBeNull();
    });

    it('appends the underline rule without dropping a caller rule', () => {
        const link = makeLink('x', { styleRules: [{ suffix: ':hover', styles: { opacity: '0.8' } }] });

        // Rules are deferred until render, so materialise them before reading.
        link.getElement(true);

        const styled = sink.writes
            .filter((w) => w.op === 'setRuleStyle')
            .map((w) => [w.args[0], w.args[1]]);

        expect(styled).toContainEqual(['textDecoration', 'underline']);
        expect(styled).toContainEqual(['opacity', '0.8']);
    });

    it('keeps its constructor text through the 3-arg super', () => {
        expect(makeLink('Docs').getText()).toBe('Docs');
    });

    it('is a Text and keeps its class name for the focus-ring selector', () => {
        const link = makeLink('x');

        expect(link instanceof Text).toBe(true);
        expect(link.constructor.name).toBe('Link');
    });
});

describe('Link interactive affordance', () => {
    it('claims role and tabindex by default', () => {
        const link = makeLink('x');

        link.getElement(true);

        expect(link.isInteractive()).toBe(true);
        expect(link.getAria().getRole()).toBe('link');
        expect(link.getAria().getTabIndex()).toBe(0);
        expect(lastSetAttr('role')).toBe('link');
        expect(lastSetAttr('tabindex')).toBe('0');
    });

    it('claims neither role nor tabindex when presentational', () => {
        const link = makeLink('x', { interactive: false });

        link.getElement(true);

        expect(link.isInteractive()).toBe(false);
        expect(link.getAria().getRole()).toBeNull();
        expect(link.getAria().getTabIndex()).toBeNull();
    });

    it('drops the affordance on setInteractive(false)', () => {
        const link = makeLink('x');
        const fn   = wire(link);

        link.setInteractive(false);

        expect(link.getAria().getRole()).toBeNull();
        expect(link.getAria().getTabIndex()).toBeNull();

        pressKey(link, 'Enter');

        expect(fn).not.toHaveBeenCalled();
    });

    it('restores the affordance on setInteractive(true)', () => {
        const link = makeLink('x', { interactive: false });
        const fn   = wire(link);

        link.setInteractive(true);

        expect(link.getAria().getRole()).toBe('link');
        expect(link.getAria().getTabIndex()).toBe(0);

        pressKey(link, 'Enter');

        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('stays single-firing when setInteractive(true) repeats', () => {
        const link = makeLink('x');
        const fn   = wire(link);

        link.setInteractive(true);
        link.setInteractive(true);
        link.setInteractive(true);

        pressKey(link, 'Enter');

        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('stays single-firing across a false/true round trip', () => {
        const link = makeLink('x');
        const fn   = wire(link);

        link.setInteractive(false);
        link.setInteractive(true);

        pressKey(link, 'Enter');

        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe('Link activation', () => {
    it('activates on Enter', () => {
        const link = makeLink('x');
        const fn   = wire(link);

        pressKey(link, 'Enter');

        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('ignores Space and other keys', () => {
        const link = makeLink('x');
        const fn   = wire(link);

        pressKey(link, ' ');
        pressKey(link, 'a');
        pressKey(link, 'Escape');

        expect(fn).not.toHaveBeenCalled();
    });

    it('never activates a presentational link on Enter', () => {
        const link = makeLink('x', { interactive: false });
        const fn   = wire(link);

        pressKey(link, 'Enter');

        expect(fn).not.toHaveBeenCalled();
    });

    it('runs an action listener on click and stops after off', () => {
        const link = makeLink('x');
        const fn   = vi.fn();

        link.getElement(true);
        link.on('action', fn);
        link.click();

        expect(fn).toHaveBeenCalledTimes(1);

        link.off('action', fn);
        link.click();

        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('wires the listeners bag exactly like on()', () => {
        const fn   = vi.fn();
        const link = makeLink('x', { listeners: { action: fn } });

        made.push(() => link.off('action', fn));

        link.getElement(true);
        link.click();

        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('is inert when clicked with no listener registered', () => {
        const link = makeLink('x');

        link.getElement(true);

        expect(() => link.click()).not.toThrow();
    });

    it('throws when clicked unmounted', () => {
        expect(() => makeLink('x').click()).toThrow();
    });
});

describe('Link teardown', () => {
    it('disposes a presentational link without throwing', () => {
        const link = new Link('x', { interactive: false });

        expect(() => link.dispose()).not.toThrow();
    });
});
