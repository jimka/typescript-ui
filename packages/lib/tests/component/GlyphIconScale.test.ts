// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// End-to-end coverage for plans/in-progress/glyph-icon-size-scale.md: every
// migrated call site should read its icon size off the theme's resolved
// glyph-scale snapshot, so it grows under a raised scale.base, while the
// sites deliberately left off the scale (Scrollbar's arrow, TableHeader's
// menu glyph, or Button's own per-instance derivation) must NOT move. One
// describe per base; each test constructs fresh so the per-construction
// reads (SpinButton, ComboBox) are exercised, not just the per-layout
// re-pins (WindowHeader, TabButton).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { ThemeManager, ModernTheme, defineTheme } from '~/core/Theme';
import type { Component } from '~/core/Component';
import { SpinButton } from '~/component/input/SpinButton';
import { ComboBox } from '~/component/input/ComboBox';
import { WindowHeader } from '~/component/container/WindowHeader';
import { TabButton } from '~/component/button/TabButton';
import { Checkbox } from '~/component/input/Checkbox';
import { RadioButton } from '~/component/input/RadioButton';
import { Scrollbar } from '~/component/container/Scrollbar';
import { Table } from '~/component/table/Table';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Every root component a test constructs is registered here and disposed in
// afterEach, before ThemeManager.setTheme(ModernTheme) restores the shared
// theme. A Component that outlives its test stays subscribed to
// ThemeManager's theme-listener array, so the *next* test's setTheme call
// fires its stale, already-detached DOM writes against handles that
// belonged to a DOM.reset() sink from a prior test — exactly the
// cross-test theme-listener pollution HeaderThemeReflow.test.ts documents.
let constructed: Component[] = [];

/** Registers `component` for disposal in this test's afterEach; returns it unchanged. */
function track<T extends Component>(component: T): T {
    constructed.push(component);

    return component;
}

beforeEach(() => {
    installTestDOM(CONFIG);
    constructed = [];
});
afterEach(() => {
    for (const component of constructed) {
        component.dispose();
    }

    ThemeManager.setTheme(ModernTheme);
    DOM.reset();
});

describe('glyph icon steps at the default base (14)', () => {
    it("SpinButton's chevron sits at the compact-control glyphXs step (8x8)", () => {
        const pref = track(new SpinButton('▲')).getGlyph()!.getPreferredSize()!;

        expect(pref).toEqual({ width: 8, height: 8 });
    });

    it("WindowHeader's title glyph sits at the text-matched glyphMd step (14x14)", () => {
        const pref = track(new WindowHeader('Title', { glyph: 'unicode-arrow-up' })).getGlyph()!.getPreferredSize()!;

        expect(pref).toEqual({ width: 14, height: 14 });
    });

    it("ComboBox's caret box sits at the text-matched glyphMd step (14)", () => {
        const combo = track(new ComboBox()) as unknown as { _caret: { getCaretSize(): number } };

        expect(combo._caret.getCaretSize()).toBe(14);
    });

    it("a Checkbox's check glyph is centred at the historical (1,1) offset", () => {
        const checkbox = track(new Checkbox()) as unknown as { _check: Component };

        expect(checkbox._check.getX()).toBe(1);
        expect(checkbox._check.getY()).toBe(1);
    });

    it("a RadioButton's dot is centred at the historical (3,3) offset", () => {
        const radio = track(new RadioButton()) as unknown as { _dot: Component };

        expect(radio._dot.getX()).toBe(3);
        expect(radio._dot.getY()).toBe(3);
    });
});

describe('glyph icon steps after scale.base is raised to 28', () => {
    beforeEach(() => ThemeManager.setTheme(defineTheme(ModernTheme, { scale: { base: 28 } })));

    it("SpinButton's chevron grows with glyphXs (16x16)", () => {
        const pref = track(new SpinButton('▲')).getGlyph()!.getPreferredSize()!;

        expect(pref).toEqual({ width: 16, height: 16 });
    });

    it("WindowHeader's title glyph grows with glyphMd (28x28)", () => {
        const pref = track(new WindowHeader('Title', { glyph: 'unicode-arrow-up' })).getGlyph()!.getPreferredSize()!;

        expect(pref).toEqual({ width: 28, height: 28 });
    });

    it("ComboBox's caret box grows with glyphMd (28)", () => {
        const combo = track(new ComboBox()) as unknown as { _caret: { getCaretSize(): number } };

        expect(combo._caret.getCaretSize()).toBe(28);
    });

    it("a closeable TabButton's close-button chevron grows with glyphXs (16x16)", () => {
        const tab = track(new TabButton('A', { closeable: true }));

        expect(tab.getCloseButton()!.getGlyph()!.getPreferredSize()).toEqual({ width: 16, height: 16 });
    });

    it("a Checkbox's box and check glyph grow together (32 box, 24 ink, centred)", () => {
        const checkbox = track(new Checkbox()) as unknown as { _box: Component; _check: Component };

        expect(checkbox._box.getWidth()).toBe(32);
        expect(checkbox._box.getHeight()).toBe(32);
        expect(checkbox._check.getPreferredSize()).toEqual({ width: 24, height: 24 });
        expect(checkbox._check.getX()).toBe(3);
        expect(checkbox._check.getY()).toBe(3);
    });

    it("a Checkbox's indeterminate dash stays centred as the box grows", () => {
        const checkbox = track(new Checkbox()) as unknown as { _dash: Component };

        expect(checkbox._dash.getX()).toBe(11);
        expect(checkbox._dash.getY()).toBe(14);
    });

    it("a RadioButton's ring and dot grow together (32 ring, 16 ink, centred)", () => {
        const radio = track(new RadioButton()) as unknown as { _ring: Component; _dot: Component };

        expect(radio._ring.getWidth()).toBe(32);
        expect(radio._ring.getHeight()).toBe(32);
        expect(radio._dot.getPreferredSize()).toEqual({ width: 16, height: 16 });
        expect(radio._dot.getX()).toBe(7);
        expect(radio._dot.getY()).toBe(7);
    });
});

// The two fixed-host icons and Button's own per-instance icon are deliberate
// Non-Goals of the plan — none of them is on the scale, so a raised base must
// leave every one of these untouched. Both remaining cases are pinned to
// Scrollbar's TRACK_WIDTH, an ergonomic track-width constant distinct from
// the icon scale (see plans/glyph-icon-host-box-migration.md), not a
// fixed-host argument of their own.
describe('fixed-host icons stay off the scale at base 28', () => {
    beforeEach(() => ThemeManager.setTheme(defineTheme(ModernTheme, { scale: { base: 28 } })));

    it("a Scrollbar arrow glyph stays 12x12", () => {
        const scrollbar = track(new Scrollbar('vertical', { arrowsEnabled: true }));
        const arrowButton = scrollbar.getComponents()[1] as unknown as {
            _glyph: { getPreferredSize(): { width: number; height: number } };
        };

        expect(arrowButton._glyph.getPreferredSize()).toEqual({ width: 12, height: 12 });
    });

    it("a TableHeader menu-button glyph stays 8x8", () => {
        const model = new Model([{ name: 'a', type: 'string', order: 0 }]);
        const table = track(new Table(new MemoryStore(model, [])));
        const glyph = table.getHeader().getMenuButton().getGlyph()!;

        expect(glyph.getPreferredSize()).toEqual({ width: 8, height: 8 });
    });
});
