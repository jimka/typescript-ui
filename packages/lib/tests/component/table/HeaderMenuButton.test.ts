// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { Event } from '~/core/Event';
import type { Component } from '~/core/Component';
import { Insets } from '~/primitive/Insets';
import { installTestDOM, makeEvent, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ColumnSpec } from '~/component/table/ColumnConfig';
import { TRACK_WIDTH } from '~/component/container/Scrollbar';
import { _ruleCacheHas } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

const TABLE_MODEL = new Model([
    { name: 'a', type: 'string', order: 0 },
    { name: 'b', type: 'string', order: 1 },
]);

/** A two-string-column table over an empty, unloaded store — no record data is needed to exercise the header geometry. */
function makeTable(spec?: ColumnSpec): InstanceType<typeof Table> {
    return new Table(new MemoryStore(TABLE_MODEL, []), spec);
}

/** Renders detached and lays out at a fixed 400x300 outer size. */
function layOut<T extends Component>(component: T): T {
    component.getElement(true);
    component.setWidth(400);
    component.setHeight(300);
    component.doLayout();

    return component;
}

// MUST be the first describe block in this file, and its one test the only
// place a real dispatched click DOM event is used. `Event`'s window-level
// base listener is armed once per event TYPE for the lifetime of this
// module and is not re-armed by a later `installTestDOM()` call — see
// CollapseButton.test.ts, which documents the same constraint.
describe('TableHeader menu button activation (real DOM dispatch)', () => {
    afterEach(() => DOM.reset());

    it('emits columncontextmenu with an empty field name and the button\'s own rect', () => {
        installTestDOM(CONFIG);

        const table  = layOut(makeTable());
        const header = table.getHeader();
        const button = header.getMenuButton();
        const handle = button.getElement(true)!;
        const fn     = vi.fn();

        header.on('columncontextmenu', fn);

        Event.fireEvent(button, makeEvent(handle, 'click') as any);

        const rect = DOM.source.getViewportRect(button);

        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith('', rect.left, rect.bottom);
    });
});

describe('TableHeader menu button', () => {
    beforeEach(() => installTestDOM(CONFIG));
    afterEach(() => DOM.reset());

    it('is exposed via getMenuButton, parented to the header', () => {
        const header = makeTable().getHeader();
        const button = header.getMenuButton();

        expect(button.getParentComponent()).toBe(header);
    });

    it('does not shift the fixed row child indices and is appended last', () => {
        const header = makeTable().getHeader();
        const button = header.getMenuButton();

        expect(header.getParentRow()).toBe(header.getComponents()[0]);
        expect(header.getComponents()[1].getClassName()).toBe('Row');
        expect(header.getFilterRow()).toBe(header.getComponents()[2]);
        expect(header.getComponents()[3]).toBe(button);
    });

    it('exactly fills the vertical-scrollbar reservation band, replacing the old cover', () => {
        const table  = layOut(makeTable());
        const header = table.getHeader();
        const button = header.getMenuButton();
        const box    = header.getContentBounds()!;
        const trackW = TRACK_WIDTH;

        expect(button.getX()).toBe(box.x + box.width - trackW);
        expect(button.getWidth()).toBe(trackW);
    });

    it('fits the reservation band at its own preferred size', () => {
        const table  = layOut(makeTable());
        const header = table.getHeader();
        const button = header.getMenuButton();
        const trackW = TRACK_WIDTH;
        const pref   = button.getPreferredSize()!;

        expect(button.getWidth()).toBe(trackW);
        expect(button.getWidth()).toBe(pref.width);
        expect(button.getHeight()).toBe(pref.height);
    });

    it('sizes the reservation band from the fixed Scrollbar track width, not the native scrollbar probe', () => {
        // 40 is arbitrary, chosen only to differ from both CONFIG's native
        // probe (15) and TRACK_WIDTH (12) — proves the band no longer tracks
        // the probe at all, not just that it happens to equal it today.
        installTestDOM({ ...CONFIG, scrollBarWidth: 40 });

        const table  = layOut(makeTable());
        const header = table.getHeader();
        const button = header.getMenuButton();

        expect(button.getWidth()).toBe(TRACK_WIDTH);
    });

    it('pins the glyph from the fixed Scrollbar track width, not the native scrollbar probe', () => {
        installTestDOM({ ...CONFIG, scrollBarWidth: 40 });

        const table  = layOut(makeTable());
        const header = table.getHeader();
        const button = header.getMenuButton();

        // TRACK_WIDTH (12) minus MENU_BUTTON_CHROME_PX (4) — the glyph pin's
        // own production formula, restated here as the expected value.
        expect(button.getGlyph()!.getPreferredSize()!.width).toBe(TRACK_WIDTH - 4);
    });

    // A border never moves the content-box origin, so it cannot tell a real
    // `headerBox.x`/`width` read apart from the outer, unbordered box — the
    // trap this regresses: sizing the button against the header's OUTER box
    // instead of its content box would overshoot the header's own right
    // border into the clip.
    it('tracks the header content box, not the outer box, when the header has a border', () => {
        const table = makeTable();

        table.getHeader().setBorder('6px solid black');

        const header = layOut(table).getHeader();
        const button = header.getMenuButton();
        const trackW = TRACK_WIDTH;
        const box    = header.getContentBounds()!;

        expect(button.getX()).toBe(box.x + box.width - trackW);
        expect(button.getWidth()).toBe(trackW);
        expect(button.getHeight()).toBe(box.height);
    });

    // A border never moves the content-box origin, so it cannot tell a real
    // `headerBox.y` read apart from a hardcoded top of 0 — the trap a stale
    // partial re-derivation would fall into (`x`/`width`/`height` refreshed
    // but `y` left at a construction-time value). Padding is what proves it,
    // since only padding (not a border) shifts the content box's origin.
    it('offsets from a padded header\'s content-box origin', () => {
        const table = makeTable();

        table.getHeader().setPadding(new Insets(4, 4, 4, 4));

        const header = layOut(table).getHeader();
        const button = header.getMenuButton();
        const box    = header.getContentBounds()!;

        expect(box.y).toBeGreaterThan(0);
        expect(button.getY()).toBe(box.y);
    });

    it('spans the full header band height, matching the scrollbar cover', () => {
        const table  = layOut(makeTable());
        const header = table.getHeader();
        const button = header.getMenuButton();
        const box    = header.getContentBounds()!;

        expect(header.hasParentRow()).toBe(false);
        expect(button.getY()).toBe(box.y);
        expect(button.getHeight()).toBe(box.height);
    });

    it('still spans the full header band, including the parent-header row, when one is present', () => {
        const spec: ColumnSpec = { columns: [
            { field: 'a', group: 'G' },
            { field: 'b', group: 'G' },
        ] };
        const table  = layOut(makeTable(spec));
        const header = table.getHeader();
        const button = header.getMenuButton();
        const box    = header.getContentBounds()!;

        expect(header.hasParentRow()).toBe(true);
        expect(button.getY()).toBe(box.y);
        expect(button.getHeight()).toBe(box.height);
    });

    it('lays out its own content after being positioned, so the glyph is actually placed inside it', () => {
        const table  = layOut(makeTable());
        const header = table.getHeader();
        const button = header.getMenuButton();
        const glyph  = button.getGlyph()!;

        // Committing the button's outer rect via setX/setY/setWidth/
        // setHeight alone, with no doLayout() cascade, never runs the
        // button's own Fit layout — so the glyph's position is derived from
        // arithmetic over its own never-laid-out container and comes out
        // NaN: present in the DOM, sized, but nowhere in particular, so it
        // never paints. A real doLayout() cascade leaves it a finite number.
        expect(Number.isFinite(glyph.getY())).toBe(true);
    });

    it('is not moved or resized by a header-level layout', () => {
        const table  = layOut(makeTable());
        const header = table.getHeader();
        const button = header.getMenuButton();

        const before = { x: button.getX(), y: button.getY(), width: button.getWidth(), height: button.getHeight() };

        header.doLayout();

        expect({ x: button.getX(), y: button.getY(), width: button.getWidth(), height: button.getHeight() }).toEqual(before);
    });

    // An `inset` box-shadow (the button's own left-edge divider) always clips
    // to the padding edge, inside the border, regardless of the border's
    // colour — so flat chrome's own reserved 1px transparent border (kept
    // uniform across rest/hover/pressed so its colour swap doesn't nudge the
    // glyph) left the divider 1px short of the button's true edges on every
    // side it touches. The button has its own opaque hover/pressed
    // background fill for interaction feedback, making that border
    // reservation redundant, so the fix clears it in every state: with no
    // border to clip against, the padding edge coincides with the button's
    // true edges and the divider reaches them.
    it('clears the border in every state so the inset-shadow divider is not clipped', () => {
        const header = makeTable().getHeader();
        const button = header.getMenuButton();

        expect(button.getBorder()).toEqual({ border: 'none' });
        expect(button.getHoverBorder()).toBeNull();
        expect(button.getPressedBorder()).toBeNull();
    });

    it('reports the accessible name and popup role', () => {
        const header = makeTable().getHeader();
        const button = header.getMenuButton();

        expect(button.getAria().getLabel()).toBe('Column options');
        expect(button.getAria().getHasPopup()).toBe('menu');
    });

    // Plan style-group-removal.md: TableHeader opts its menu button's glyph
    // into the TABLE_HEADER_MENU_GLYPH_TRAIT StyleTrait right after
    // pinGlyphSize, so every table's header menu icon shares one
    // .ts-ui-component.ts-ui-trait-table-header-menu-glyph rule instead of
    // each repeating the same size on its own #id rule.

    /** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
    function idSelector(component: { getId(): string }): string {
        return '#' + DOM.source.escapeSelector(component.getId());
    }

    /** Flattens every `setRuleStyles` write to `selector` found in `writes` into one key/value map. */
    function declarationsFor(writes: RecordingDOMSink['writes'], selector: string): Record<string, string | null> {
        const out: Record<string, string | null> = {};
        for (const w of writes) {
            if (w.op !== 'setRuleStyles' || w.args[0] !== selector) {
                continue;
            }

            const styles = w.args[1] as Record<string, string | null>;
            for (const key of Object.keys(styles)) {
                out[key] = styles[key];
            }
        }

        return out;
    }

    /** Every DOM class token any `apply` write in `writes` added via `addClass`. */
    function addedClassesOf(writes: RecordingDOMSink['writes']): readonly string[] {
        const out: string[] = [];
        for (const w of writes) {
            if (w.op !== 'apply') continue;
            const addClass = (w.args[1] as { addClass?: string[] }).addClass;
            if (Array.isArray(addClass)) out.push(...addClass);
        }

        return out;
    }

    it("a second table's header menu button glyph writes no size declaration to its own #id rule, and the shared .ts-ui-component.ts-ui-trait-table-header-menu-glyph trait rule exists", () => {
        const sink = installTestDOM(CONFIG);

        layOut(makeTable()); // seed the trait rule

        const secondStart  = sink.writes.length;
        const second       = layOut(makeTable());
        const secondWrites = sink.writes.slice(secondStart);

        const glyph        = second.getHeader().getMenuButton().getGlyph()!;
        const declarations = declarationsFor(secondWrites, idSelector(glyph));

        expect(declarations.minWidth).toBeUndefined();
        expect(declarations.minHeight).toBeUndefined();
        expect(declarations.maxWidth).toBeUndefined();
        expect(declarations.maxHeight).toBeUndefined();
        expect(_ruleCacheHas('.ts-ui-component.ts-ui-trait-table-header-menu-glyph')).toBe(true);
        expect(_ruleCacheHas('.ButtonIconGlyph--table-header-menu-glyph')).toBe(false);
    });

    it("a rendered header menu button glyph's DOM class list carries the trait token and no legacy group token", () => {
        const sink  = installTestDOM(CONFIG);
        const start = sink.writes.length;

        layOut(makeTable());

        const classes = addedClassesOf(sink.writes.slice(start));

        expect(classes).toContain('ts-ui-trait-table-header-menu-glyph');
        expect(classes.some((token) => token.endsWith('--table-header-menu-glyph'))).toBe(false);
    });
});
