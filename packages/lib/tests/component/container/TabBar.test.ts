import { describe, it, expect, afterEach, vi } from 'vitest';
import { TabBar } from '~/component/container/TabBar';
import { TabButton } from '~/component/button/TabButton';
import { TabCloseButton } from '~/component/button/TabCloseButton';
import { Button } from '~/component/button/Button';
import { Component } from '~/core/Component';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { ROVING_MEMBER_ATTR } from '~/core/RovingTabIndex';
import { Glyph } from '~/component/display/Glyph';
import { file } from '~/glyphs/solid/file';
import { file_lines } from '~/glyphs/solid/file_lines';
import { DOM } from '~/core/DOM';
import { SpatialNavigation } from '~/core/SpatialNavigation';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** A LayoutConstraints carrying a closeable flag (and optional name). */
function closeable(): LayoutConstraints {
    const c = new LayoutConstraints();

    c.closeable = true;

    return c;
}

/** A LayoutConstraints carrying a glyph name. */
function glyphed(name: string): LayoutConstraints {
    const c = new LayoutConstraints();

    c.glyph = name;

    return c;
}

/** Reaches TabBar's private `_entries`, the same private surface other suites cast through. */
function barEntries(bar: TabBar): Array<{ id: string; button: TabButton; closeButton?: TabCloseButton }> {
    return (bar as unknown as { _entries: Array<{ id: string; button: TabButton; closeButton?: TabCloseButton }> })._entries;
}

/** Builds a TabBar with three entries: a, b, c (no constraints). */
function threeEntryBar(): TabBar {
    const bar = new TabBar();

    bar.createBarEntry('a', 'Alpha');
    bar.createBarEntry('b', 'Beta');
    bar.createBarEntry('c', 'Gamma');

    return bar;
}

describe('TabBar entry tracking', () => {
    afterEach(() => DOM.reset());

    it('makes the first entry active and joins later entries inactive', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();

        expect(bar.getActiveEntryId()).toBe('a');
    });

    it('returns ids in strip order as a defensive copy', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();
        const ids = bar.getEntryIds();

        expect(ids).toEqual(['a', 'b', 'c']);

        ids.push('mutated');

        // The returned array is a copy; mutating it must not affect the strip.
        expect(bar.getEntryIds()).toEqual(['a', 'b', 'c']);
    });

    it('setActiveEntry updates the active id; unknown id is a no-op', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();

        bar.setActiveEntry('b');

        expect(bar.getActiveEntryId()).toBe('b');

        bar.setActiveEntry('nope');

        expect(bar.getActiveEntryId()).toBe('b');
    });
});

// directional-panel-navigation plan, Expected Behaviour #22: SpatialNavigation's
// chord claims ArrowRight/Left first, so the strip's own active-tab step must
// stand down entirely while it does.
describe('TabBar onToolbarKeyDown — stands down while SpatialNavigation claims the key', () => {
    afterEach(() => {
        DOM.reset();
        vi.restoreAllMocks();
    });

    it('ArrowRight activates the next tab when the key is unclaimed', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();

        (bar as any).onToolbarKeyDown({ key: 'ArrowRight' } as KeyboardEvent);

        expect(bar.getActiveEntryId()).toBe('b');
    });

    it('a claimed ArrowRight does not change the active tab', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();

        vi.spyOn(SpatialNavigation, 'claimsKey').mockReturnValue(true);

        (bar as any).onToolbarKeyDown({ key: 'ArrowRight' } as KeyboardEvent);

        expect(bar.getActiveEntryId()).toBe('a');
    });
});

// SpatialNavigation can move DOM focus onto a TabButton directly (a plain
// .focus() call) without ever running it through onTabPressed, so the active
// id can lag behind wherever focus actually is. A bare ArrowRight/Left must
// still step from the focused tab, or it silently "skips" — jumping relative
// to the stale active tab instead of the one the user is looking at.
describe('TabBar onToolbarKeyDown — steps from the focused tab, not a stale active id', () => {
    afterEach(() => DOM.reset());

    it('steps from the tab that holds DOM focus when it differs from the active tab', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar(); // a, b, c — 'a' active by construction
        bar.getElement(true);

        const entries = barEntries(bar);

        // Simulate a SpatialNavigation move: focus lands on 'c' directly,
        // bypassing onTabPressed, so getActiveEntryId() still reports 'a'.
        entries[2].button.focus();
        expect(bar.getActiveEntryId()).toBe('a');

        (bar as any).onToolbarKeyDown({ key: 'ArrowRight' } as KeyboardEvent);

        // Wraps from the focused tab ('c', index 2) to 'a' (index 0) — not a
        // step from the stale active tab ('a', index 0) to 'b'.
        expect(bar.getActiveEntryId()).toBe('a');
    });

    it('falls back to the active tab when DOM focus is outside this strip', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();
        bar.getElement(true);
        bar.setActiveEntry('b');

        (bar as any).onToolbarKeyDown({ key: 'ArrowRight' } as KeyboardEvent);

        expect(bar.getActiveEntryId()).toBe('c');
    });
});

// tab-and-dialog-key-routing plan, Expected Behaviour "The roving group's
// contents and tabindex": a closeable cell's ✕ is a member of the strip's
// roving group, not a Tab stop of its own. Membership — not a bare
// `setTabIndex(-1)` — is what keeps the ✕ reachable, because
// SpatialNavigation recovers a roved-off member through the
// `data-ts-ui-roving-member` marker only `RovingTabIndex.add` writes.
describe('TabBar — close buttons are roving members', () => {
    afterEach(() => DOM.reset());

    /** Builds a rendered three-cell bar whose every cell is closeable. */
    function threeCloseableBar(): TabBar {
        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha', closeable());
        bar.createBarEntry('b', 'Beta', closeable());
        bar.createBarEntry('c', 'Gamma', closeable());
        bar.getElement(true);

        return bar;
    }

    it('roves every ✕ to -1, leaving the active cell\'s tab button the only stop', () => {
        installTestDOM(CONFIG);

        const bar     = threeCloseableBar();
        const entries = barEntries(bar);

        expect(entries.map(e => e.button.getCloseButton()!.getAria().getTabIndex())).toEqual([-1, -1, -1]);
        expect(entries.map(e => e.button.getAria().getTabIndex())).toEqual([0, -1, -1]);
    });

    it('marks every ✕ with the roving-member attribute', () => {
        installTestDOM(CONFIG);

        const bar = threeCloseableBar();

        for (const entry of barEntries(bar)) {
            const closeEl = entry.button.getCloseButton()!.getElement(true)!;

            expect(DOM.source.hasAttribute(closeEl, ROVING_MEMBER_ATTR)).toBe(true);
        }
    });

    it('setActiveEntry puts tabindex="0" on that cell\'s tab button, never on a ✕', () => {
        installTestDOM(CONFIG);

        const bar = threeCloseableBar();

        bar.setActiveEntry('c');

        const entries = barEntries(bar);

        expect(entries.map(e => e.button.getAria().getTabIndex())).toEqual([-1, -1, 0]);
        expect(entries.map(e => e.button.getCloseButton()!.getAria().getTabIndex())).toEqual([-1, -1, -1]);
    });

    it('removeBarEntry drops both of that cell\'s members', () => {
        installTestDOM(CONFIG);

        const bar     = threeCloseableBar();
        const removed = barEntries(bar)[1];
        const button  = removed.button;
        const close   = removed.button.getCloseButton()!;

        bar.removeBarEntry('b');

        const items = (bar as any)._rovingTabIndex.getItems();

        expect(items).toHaveLength(4);
        expect(items).not.toContain(button);
        expect(items).not.toContain(close);
    });

    // `RovingTabIndex.remove` activates the member before the one it removed
    // when that member was active. With each ✕ interleaved after its own tab
    // button, "the member before" is a ✕ — and nothing downstream corrects it,
    // because the owner's post-close re-selection goes through `setActiveVisual`,
    // which deliberately performs no roving move. Without a correction here the
    // strip's single `tabindex="0"` lands on a close button.
    it('leaves the group\'s only tabindex="0" on a tab button after the active cell is removed', () => {
        installTestDOM(CONFIG);

        const bar = threeCloseableBar();

        bar.setActiveEntry('b');
        bar.removeBarEntry('b');

        const items: Component[] = (bar as any)._rovingTabIndex.getItems();
        const tabbable = items.filter(item => item.getAria().getTabIndex() === 0);

        expect(tabbable).toHaveLength(1);
        expect(barEntries(bar).map(entry => entry.button)).toContain(tabbable[0]);
    });

    it('leaves DOM focus on a tab button after the active cell is removed', () => {
        installTestDOM(CONFIG);

        const bar = threeCloseableBar();

        bar.setActiveEntry('b');
        bar.removeBarEntry('b');

        const active = DOM.source.getActiveElement();

        expect(barEntries(bar).map(entry => entry.button.getElement())).toContain(active);
    });

    // Interleaving each ✕ into the roving group made this state reachable by
    // keyboard: arrow onto a non-active cell's ✕ and press Delete. The removed
    // cell is not the roving-active member, so `RovingTabIndex.remove` moves
    // nothing and the focus repair above never fires — the caller then disposes
    // the focused element.
    it('leaves DOM focus on a tab button after a focused non-active cell is removed', () => {
        installTestDOM(CONFIG);

        const bar = threeCloseableBar();

        bar.setActiveEntry('a');
        barEntries(bar)[2].closeButton!.focus();
        bar.removeBarEntry('c');

        const active = DOM.source.getActiveElement();

        expect(barEntries(bar).map(entry => entry.button.getElement())).toContain(active);
    });

    it('lands on the cell that took the removed one\'s place, not the end of the strip', () => {
        installTestDOM(CONFIG);

        const bar = threeCloseableBar();

        bar.setActiveEntry('a');
        barEntries(bar)[1].button.focus();
        bar.removeBarEntry('b');

        const active = DOM.source.getActiveElement();

        expect(active).toBe(barEntries(bar)[1].button.getElement());
    });
});

// tab-and-dialog-key-routing plan, the Delete table in `## Architecture
// Decisions`: Delete closes the focused tab when that cell is closeable, from
// the tab button and from the ✕ alike, and reports no disposition otherwise so
// a Delete the strip has no action for keeps propagating.
describe('TabBar onToolbarKeyDown — Delete closes the focused tab', () => {
    afterEach(() => {
        DOM.reset();
        vi.restoreAllMocks();
    });

    /** A rendered bar whose cell 'a' is plain and cells 'b' / 'c' are closeable. */
    function mixedBar(): TabBar {
        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha');
        bar.createBarEntry('b', 'Beta', closeable());
        bar.createBarEntry('c', 'Gamma', closeable());
        bar.getElement(true);

        return bar;
    }

    it('closes the cell whose tab button holds focus', () => {
        installTestDOM(CONFIG);

        const bar = mixedBar();
        const spy = vi.fn();
        bar.on('tabclose', spy);

        barEntries(bar)[1].button.focus();

        const result = (bar as any).onToolbarKeyDown({ key: 'Delete' } as KeyboardEvent);

        expect(spy).toHaveBeenCalledWith('b');
        expect(result).toEqual({ prevent: true });
    });

    it('closes the cell whose ✕ holds focus', () => {
        installTestDOM(CONFIG);

        const bar = mixedBar();
        const spy = vi.fn();
        bar.on('tabclose', spy);

        barEntries(bar)[1].closeButton!.focus();

        const result = (bar as any).onToolbarKeyDown({ key: 'Delete' } as KeyboardEvent);

        expect(spy).toHaveBeenCalledWith('b');
        expect(result).toEqual({ prevent: true });
    });

    it('is inert on a non-closeable cell', () => {
        installTestDOM(CONFIG);

        const bar = mixedBar();
        const spy = vi.fn();
        bar.on('tabclose', spy);

        barEntries(bar)[0].button.focus();

        const result = (bar as any).onToolbarKeyDown({ key: 'Delete' } as KeyboardEvent);

        expect(spy).not.toHaveBeenCalled();
        expect(result).toBeUndefined();
    });

    it('is inert while a strip tool holds focus', () => {
        installTestDOM(CONFIG);

        const bar  = mixedBar();
        const tool = new Button('Tool');
        bar.addTool(tool);

        const spy = vi.fn();
        bar.on('tabclose', spy);

        tool.focus();

        const result = (bar as any).onToolbarKeyDown({ key: 'Delete' } as KeyboardEvent);

        expect(spy).not.toHaveBeenCalled();
        expect(result).toBeUndefined();
    });

    it('is inert while nothing in the strip holds focus', () => {
        installTestDOM(CONFIG);

        const bar = mixedBar();
        const spy = vi.fn();
        bar.on('tabclose', spy);

        const result = (bar as any).onToolbarKeyDown({ key: 'Delete' } as KeyboardEvent);

        expect(spy).not.toHaveBeenCalled();
        expect(result).toBeUndefined();
    });

    it('is inert on an empty strip', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();
        bar.getElement(true);

        const spy = vi.fn();
        bar.on('tabclose', spy);

        const result = (bar as any).onToolbarKeyDown({ key: 'Delete' } as KeyboardEvent);

        expect(spy).not.toHaveBeenCalled();
        expect(result).toBeUndefined();
    });

    it('stands down while SpatialNavigation claims the key', () => {
        installTestDOM(CONFIG);

        const bar = mixedBar();
        const spy = vi.fn();
        bar.on('tabclose', spy);

        barEntries(bar)[1].button.focus();
        vi.spyOn(SpatialNavigation, 'claimsKey').mockReturnValue(true);

        const result = (bar as any).onToolbarKeyDown({ key: 'Delete' } as KeyboardEvent);

        expect(spy).not.toHaveBeenCalled();
        expect(result).toBeUndefined();
    });
});

// tab-and-dialog-key-routing plan, Expected Behaviour "Arrow keys": the ✕ is
// now a place focus can land, so an arrow pressed there must step from the ✕'s
// own cell rather than from a possibly stale active cell.
describe('TabBar onToolbarKeyDown — steps from the cell whose ✕ holds focus', () => {
    afterEach(() => DOM.reset());

    it('ArrowRight from cell b\'s ✕ activates cell c', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha', closeable());
        bar.createBarEntry('b', 'Beta', closeable());
        bar.createBarEntry('c', 'Gamma', closeable());
        bar.getElement(true);

        // Focus lands on 'b''s ✕ directly (a SpatialNavigation move), so the
        // active id still reports 'a'.
        barEntries(bar)[1].closeButton!.focus();
        expect(bar.getActiveEntryId()).toBe('a');

        (bar as any).onToolbarKeyDown({ key: 'ArrowRight' } as KeyboardEvent);

        expect(bar.getActiveEntryId()).toBe('c');
    });
});

describe('TabBar moveBarEntry', () => {
    afterEach(() => DOM.reset());

    it('clamps a huge destination to the last slot', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();

        bar.moveBarEntry('a', 99);

        expect(bar.getEntryIds()).toEqual(['b', 'c', 'a']);
    });

    it('treats dest === from as a no-op', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();

        bar.moveBarEntry('b', 1);

        expect(bar.getEntryIds()).toEqual(['a', 'b', 'c']);
    });

    it('reorders to an interior slot', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();

        bar.moveBarEntry('c', 0);

        expect(bar.getEntryIds()).toEqual(['c', 'a', 'b']);
    });
});

/** The private surface this suite reaches into for wrapper/indicator geometry. */
type Wrapper = { getX(): number; getTranslateX(): number };
type BarInternals = {
    _entries: Array<{ id: string; button: Wrapper }>;
    _indicator: { getTranslateX(): number };
};

describe('TabBar selection indicator tracks the active tab across a same-count reorder', () => {
    afterEach(() => DOM.reset());

    it('keeps the indicator glued to the active tab after moveBarEntry reshuffles slots', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar(); // a, b, c
        bar.getElement(true);
        bar.setActiveEntry('b'); // middle tab, so a reorder actually displaces it

        bar.placeStrip(0, 0, 300, 30); // first placement: slow path, indicator lands correctly

        const { _entries, _indicator } = bar as unknown as BarInternals;
        const wrapper = _entries.find(e => e.id === 'b')!.button;

        expect(_indicator.getTranslateX()).toBe(wrapper.getX() + wrapper.getTranslateX());

        // Move 'c' to the front: same tab COUNT, so the strip's equal-width mode
        // keeps every wrapper's width unchanged — only positions shift. 'b'
        // (still active) slides from slot 1 to slot 2, a size-stable move that
        // LayoutManager.commitBounds now drives via translate.
        bar.moveBarEntry('c', 0);
        bar.placeStrip(0, 0, 300, 30);

        expect(_indicator.getTranslateX()).toBe(wrapper.getX() + wrapper.getTranslateX());
    });
});

describe('TabBar removeBarEntry', () => {
    afterEach(() => DOM.reset());

    it('resets active to null when the removed entry was active', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar(); // 'a' is active

        bar.removeBarEntry('a');

        expect(bar.getEntryIds()).toEqual(['b', 'c']);
        expect(bar.getActiveEntryId()).toBeNull();
    });

    it('leaves the active id unchanged when a non-active entry is removed', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar(); // 'a' is active

        bar.removeBarEntry('b');

        expect(bar.getEntryIds()).toEqual(['a', 'c']);
        expect(bar.getActiveEntryId()).toBe('a');
    });

    it('treats an unknown id as a no-op', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();

        bar.removeBarEntry('nope');

        expect(bar.getEntryIds()).toEqual(['a', 'b', 'c']);
        expect(bar.getActiveEntryId()).toBe('a');
    });
});

describe('TabBar busy state', () => {
    afterEach(() => DOM.reset());

    it('setEntryBusy(id, true) marks the entry busy; setEntryBusy(id, false) clears it', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha');
        bar.setEntryBusy('a', true);

        expect(bar.isEntryBusy('a')).toBe(true);

        bar.setEntryBusy('a', false);

        expect(bar.isEntryBusy('a')).toBe(false);
    });

    it('setEntryBusy on an unknown id is a no-op and chainable; isEntryBusy is false', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();

        expect(bar.setEntryBusy('nope', true)).toBe(bar);
        expect(bar.isEntryBusy('nope')).toBe(false);
    });

    it('removeBarEntry clears the busy read for that id', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha');
        bar.setEntryBusy('a', true);
        bar.removeBarEntry('a');

        expect(bar.isEntryBusy('a')).toBe(false);
    });
});

describe('TabBar modified state', () => {
    afterEach(() => DOM.reset());

    it('setEntryModified(id, true) marks the entry modified; setEntryModified(id, false) clears it', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha');
        bar.setEntryModified('a', true);

        expect(bar.isEntryModified('a')).toBe(true);

        bar.setEntryModified('a', false);

        expect(bar.isEntryModified('a')).toBe(false);
    });

    it('setEntryModified on an unknown id is a no-op and chainable; isEntryModified is false', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();

        expect(bar.setEntryModified('nope', true)).toBe(bar);
        expect(bar.isEntryModified('nope')).toBe(false);
    });

    it('isEntryModified is false for a cell never marked modified, and false again after removeBarEntry', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha');

        expect(bar.isEntryModified('a')).toBe(false);

        bar.setEntryModified('a', true);
        bar.removeBarEntry('a');

        expect(bar.isEntryModified('a')).toBe(false);
    });
});

describe('TabBar entry metadata', () => {
    afterEach(() => DOM.reset());

    it('reflects name and closeable, with documented defaults for unknown ids', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();

        bar.createBarEntry('x', 'Xavier', closeable());
        bar.createBarEntry('y', 'Yvonne'); // no constraints → not closeable

        expect(bar.getEntryName('x')).toBe('Xavier');
        expect(bar.isEntryCloseable('x')).toBe(true);
        expect(bar.isEntryCloseable('y')).toBe(false);

        // Documented defaults for an unknown id.
        expect(bar.getEntryName('missing')).toBe('');
        expect(bar.isEntryCloseable('missing')).toBe(false);
    });
});

describe('TabBar glyph', () => {
    // 'file' / 'file-lines' are SVG-kind glyphs, so (per Glyph.test.ts's
    // convention) each case registers them and this cleans up afterward to
    // avoid leaking into the global registry.
    afterEach(() => {
        Glyph.unregister('file');
        Glyph.unregister('file-lines');
        DOM.reset();
    });

    it('7 — setEntryGlyph on an unknown id is a no-op and chainable; getEntryGlyph is null', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();

        expect(bar.setEntryGlyph('nope', 'file')).toBe(bar);
        expect(bar.getEntryGlyph('nope')).toBeNull();
        expect(barEntries(bar).every(e => e.button.getGlyph() === null)).toBe(true);
    });

    it('8 — swapping the active entry\'s glyph leaves it active and selected', () => {
        installTestDOM(CONFIG);
        Glyph.register(file);

        const bar = threeEntryBar(); // 'a' is active

        bar.setEntryGlyph('a', 'file');

        expect(bar.getActiveEntryId()).toBe('a');
        expect(barEntries(bar)[0].button.isSelected()).toBe(true);
    });

    it('9 — swapping a closeable entry\'s glyph leaves its close button instance untouched', () => {
        installTestDOM(CONFIG);
        Glyph.register(file);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha', closeable());

        const before = barEntries(bar)[0].button.getCloseButton();

        bar.setEntryGlyph('a', 'file');

        expect(barEntries(bar)[0].button.getCloseButton()).toBe(before);
    });

    it('10 — swapping a busy entry\'s glyph leaves it busy', () => {
        installTestDOM(CONFIG);
        Glyph.register(file);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha');
        bar.setEntryBusy('a', true);

        bar.setEntryGlyph('a', 'file');

        expect(bar.isEntryBusy('a')).toBe(true);
    });

    it('13 — setEntryGlyph disposes the glyph it replaces', () => {
        installTestDOM(CONFIG);
        Glyph.register(file, file_lines);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha', glyphed('file'));

        const fn = vi.fn();
        barEntries(bar)[0].button.getGlyph()!.onDestroy(fn);

        bar.setEntryGlyph('a', 'file-lines');

        expect(fn).toHaveBeenCalled();
        expect(bar.getEntryGlyph('a')).toBe('file-lines');
    });

    it('14 — clearEntryGlyph disposes the glyph it removes', () => {
        installTestDOM(CONFIG);
        Glyph.register(file);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha', glyphed('file'));

        const fn = vi.fn();
        barEntries(bar)[0].button.getGlyph()!.onDestroy(fn);

        bar.clearEntryGlyph('a');

        expect(fn).toHaveBeenCalled();
        expect(bar.getEntryGlyph('a')).toBeNull();
    });

    it('setEntryItalic round-trips isEntryItalic', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha');

        expect(bar.isEntryItalic('a')).toBe(false);

        bar.setEntryItalic('a', true);

        expect(bar.isEntryItalic('a')).toBe(true);

        bar.setEntryItalic('a', false);

        expect(bar.isEntryItalic('a')).toBe(false);
    });

    it('setEntryItalic on an unknown id is a no-op and chainable; isEntryItalic is false', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();

        expect(bar.setEntryItalic('nope', true)).toBe(bar);
        expect(bar.isEntryItalic('nope')).toBe(false);
    });

    it('italicising the active entry leaves it active and selected', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar(); // 'a' is active

        bar.setEntryItalic('a', true);

        expect(bar.getActiveEntryId()).toBe('a');
        expect(barEntries(bar)[0].button.isSelected()).toBe(true);
    });

    it('italicising a closeable entry leaves its close button instance untouched', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha', closeable());

        const before = barEntries(bar)[0].button.getCloseButton();

        bar.setEntryItalic('a', true);

        expect(barEntries(bar)[0].button.getCloseButton()).toBe(before);
    });

    it('removeBarEntry clears the italic read for that id', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha');
        bar.setEntryItalic('a', true);
        bar.removeBarEntry('a');

        expect(bar.isEntryItalic('a')).toBe(false);
    });

    it('busy, glyph and italic per-cell flags are independent', () => {
        installTestDOM(CONFIG);
        Glyph.register(file);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha');
        bar.setEntryBusy('a', true);
        bar.setEntryItalic('a', true);

        expect(bar.isEntryBusy('a')).toBe(true);
        expect(bar.isEntryItalic('a')).toBe(true);

        bar.setEntryBusy('a', false);
        bar.setEntryGlyph('a', 'file');

        expect(bar.isEntryItalic('a')).toBe(true);
    });
});
