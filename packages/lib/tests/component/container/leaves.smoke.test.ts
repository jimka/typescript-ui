//
// Tier 3 — honestly scoped-out leaves. These components are presentational
// chrome or pure drag/menu/baseline-measurement machinery whose behaviour only
// pays off under a real browser (pointer geometry, native legend/baseline
// metrics, document-level drag listeners). Per the plan's methodology they get a
// construction smoke test at most — no invented behavioural assertions — plus a
// couple of cheap pure-getter round-trips where the getter does not touch native
// metrics. See each comment for why deeper coverage needs a browser.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Legend } from '~/component/container/Legend';
import { MenuSeparator } from '~/component/container/MenuSeparator';
import { MenuItem } from '~/component/container/MenuItem';
import { Glyph } from '~/component/display/Glyph';
import { circle_check } from '~/glyphs/solid/circle_check';
import { WindowHeader } from '~/component/container/WindowHeader';
import { AccordionHeader } from '~/component/container/AccordionHeader';
import { SplitGutter } from '~/component/container/SplitGutter';
import { WindowBorder, Direction } from '~/component/container/WindowBorder';
import { DialogBackdrop } from '~/component/container/DialogBackdrop';
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

describe('container leaves construction smoke', () => {
    afterEach(() => DOM.reset());

    it('Legend constructs without throwing (presentational <legend> leaf)', () => {
        installTestDOM(CONFIG);

        // Static-positioned title chrome; nothing to assert beyond construction.
        expect(() => new Legend()).not.toThrow();
    });

    it('MenuSeparator constructs without throwing (presentational rule)', () => {
        installTestDOM(CONFIG);

        expect(() => new MenuSeparator()).not.toThrow();
    });

    it('DialogBackdrop constructs without throwing (presentational overlay)', () => {
        installTestDOM(CONFIG);

        expect(() => new DialogBackdrop()).not.toThrow();
    });

    it('WindowHeader constructs without throwing (drag-bound chrome)', () => {
        installTestDOM(CONFIG);

        expect(() => new WindowHeader('Title')).not.toThrow();
    });

    it('AccordionHeader constructs without throwing (hover/baseline-bound chrome)', () => {
        installTestDOM(CONFIG);

        expect(() => new AccordionHeader('Section')).not.toThrow();
    });

    it('SplitGutter constructs without throwing (drag-resize interaction)', () => {
        installTestDOM(CONFIG);

        // Entirely drag-resize bound; a real pointer is needed for behaviour.
        expect(() => new SplitGutter('horizontal')).not.toThrow();
    });

    it('WindowBorder constructs without throwing (drag-resize interaction)', () => {
        installTestDOM(CONFIG);

        expect(() => new WindowBorder(Direction.NORTH)).not.toThrow();
    });
});

describe('WindowBorder Direction enum', () => {
    it('declares the eight resize directions as distinct members', () => {
        // A trivial value assertion on the pure direction enum — no DOM needed.
        const members = [
            Direction.NORTH, Direction.SOUTH, Direction.WEST, Direction.EAST,
            Direction.NORTHWEST, Direction.SOUTHEAST, Direction.SOUTHWEST, Direction.NORTHEAST,
        ];

        expect(new Set(members).size).toBe(8);
    });
});

describe('MenuItem pure boolean getters', () => {
    afterEach(() => DOM.reset());

    it('isSeparator reflects the separator config', () => {
        installTestDOM(CONFIG);

        const separator = new MenuSeparator();
        const leaf      = new MenuItem({ text: 'Open' }, () => {}, () => {});

        expect(separator.isSeparator()).toBe(true);
        expect(leaf.isSeparator()).toBe(false);
    });

    it('isEnabled is true unless enabled is explicitly false', () => {
        installTestDOM(CONFIG);

        const enabledByDefault = new MenuItem({ text: 'A' }, () => {}, () => {});
        const explicitlyOff    = new MenuItem({ text: 'B', enabled: false }, () => {}, () => {});

        expect(enabledByDefault.isEnabled()).toBe(true);
        expect(explicitlyOff.isEnabled()).toBe(false);

        // getBaseline is intentionally NOT tested: it reads native text metrics
        // that the modelled source cannot supply, so it belongs to a real
        // browser run.
    });
});

describe('MenuItem glyph colour', () => {
    afterEach(() => DOM.reset());

    it('applies config.glyphColor to the leading glyph, and leaves it unset otherwise', () => {
        installTestDOM(CONFIG);
        Glyph.register(circle_check);

        const tinted = new MenuItem({ text: 'A', glyph: 'circle-check', glyphColor: 'rgb(1, 2, 3)' }, () => {}, () => {}) as any;
        const plain  = new MenuItem({ text: 'B', glyph: 'circle-check' }, () => {}, () => {}) as any;

        expect(tinted._iconGlyph.getForegroundColor()).toBe('rgb(1, 2, 3)');
        expect(plain._iconGlyph.getForegroundColor()).toBeNull();
    });
});

describe('MenuItem checkmark self-toggle', () => {
    afterEach(() => DOM.reset());

    it('closeOnActivate: false + checked toggles isChecked() back and forth on repeated activation', () => {
        installTestDOM(CONFIG);

        const item = new MenuItem({ text: 'A', checked: false, closeOnActivate: false }, () => {}, () => {}) as any;

        expect(item.isChecked()).toBe(false);
        expect(item._checkText.getText()).toBe('');

        item.activate();
        expect(item.isChecked()).toBe(true);
        expect(item._checkText.getText()).toBe('✓');

        item.activate();
        expect(item.isChecked()).toBe(false);
        expect(item._checkText.getText()).toBe('');
    });

    it('closeOnActivate: false without checked never becomes checkable', () => {
        installTestDOM(CONFIG);

        const item = new MenuItem({ text: 'A', closeOnActivate: false }, () => {}, () => {});

        expect(() => item.activate()).not.toThrow();
        expect(item.hasCheck()).toBe(false);
        expect(item.isChecked()).toBe(false);

        item.activate();
        expect(item.hasCheck()).toBe(false);
        expect(item.isChecked()).toBe(false);
    });

    it('default closeOnActivate + checked still calls onActivate exactly once', () => {
        installTestDOM(CONFIG);

        const onActivate = vi.fn();
        const item = new MenuItem({ text: 'A', checked: false }, onActivate, () => {});

        item.activate();

        expect(onActivate).toHaveBeenCalledOnce();
    });
});
