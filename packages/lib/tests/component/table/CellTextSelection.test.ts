//
// Coverage for the text-bearing cell renderers' user-select opt-in, the
// three header-cell classes' opt-out, and a cross-cutting regression check
// that interactive chrome elsewhere in the framework kept its unselectable
// default. `Component.setUserSelect` caches its value, so `getUserSelect()`
// reads back cached state with no DOM required — the offline harness is
// installed anyway since the renderers under test mint DOM.sink elements at
// construction.
//
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { StringRenderer } from '~/component/table/cell/renderer/String';
import { NumberRenderer } from '~/component/table/cell/renderer/Number';
import { DateRenderer } from '~/component/table/cell/renderer/Date';
import { DateTimeRenderer } from '~/component/table/cell/renderer/DateTime';
import { TimeRenderer } from '~/component/table/cell/renderer/Time';
import { ComboRenderer } from '~/component/table/cell/renderer/Combo';
import { LinkCellRenderer } from '~/component/table/cell/renderer/Link';
import { GlyphRenderer } from '~/component/table/cell/renderer/Glyph';
import { HeaderCell } from '~/component/table/cell/Header';
import { ParentHeaderCell } from '~/component/table/cell/ParentHeader';
import { GroupSeparatorCell } from '~/component/table/cell/GroupSeparator';
import { StringCell } from '~/component/table/cell/String';
import { Button } from '~/component/button/Button';
import { MenuItem } from '~/component/container/MenuItem';
import { TabButton } from '~/component/button/TabButton';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('text-bearing cell renderers opt in to user-select: text', () => {
    it('StringRenderer and its Text opt in', () => {
        const r = new StringRenderer();

        expect(r.getUserSelect()).toBe('text');
        expect(r.getText().getUserSelect()).toBe('text');
    });

    it('NumberRenderer and its Text opt in', () => {
        const r = new NumberRenderer();

        expect(r.getUserSelect()).toBe('text');
        expect(r.getComponents()[0].getUserSelect()).toBe('text');
    });

    it('DateRenderer and its Text opt in', () => {
        const r = new DateRenderer();

        expect(r.getUserSelect()).toBe('text');
        expect(r.getComponents()[0].getUserSelect()).toBe('text');
    });

    it('DateTimeRenderer and its Text opt in', () => {
        const r = new DateTimeRenderer();

        expect(r.getUserSelect()).toBe('text');
        expect(r.getComponents()[0].getUserSelect()).toBe('text');
    });

    it('TimeRenderer and its Text opt in', () => {
        const r = new TimeRenderer();

        expect(r.getUserSelect()).toBe('text');
        expect(r.getComponents()[0].getUserSelect()).toBe('text');
    });

    it('ComboRenderer and its Text opt in', () => {
        const r = new ComboRenderer([]);

        expect(r.getUserSelect()).toBe('text');
        expect(r.getText().getUserSelect()).toBe('text');
    });

    it('LinkCellRenderer and its Text opt in', () => {
        const r = new LinkCellRenderer();

        expect(r.getUserSelect()).toBe('text');
        expect(r.getText().getUserSelect()).toBe('text');
    });

    it('GlyphRenderer stays unselectable — glyph cells are not text', () => {
        expect(new GlyphRenderer().getUserSelect()).toBe('none');
    });
});

describe('header, parent-header and group-separator cells opt back out', () => {
    it('HeaderCell keeps its StringRenderer and Text unselectable', () => {
        const cell = new HeaderCell('Name', 'name');

        expect(cell.getRenderer().getUserSelect()).toBe('none');
        expect(cell.getRenderer().getText().getUserSelect()).toBe('none');
    });

    it('ParentHeaderCell keeps its StringRenderer and Text unselectable', () => {
        const cell = new ParentHeaderCell('Group', null);

        expect(cell.getRenderer().getUserSelect()).toBe('none');
        expect(cell.getRenderer().getText().getUserSelect()).toBe('none');
    });

    it('GroupSeparatorCell keeps its StringRenderer and Text unselectable', () => {
        const cell = new GroupSeparatorCell('Group', null);

        expect(cell.getRenderer().getUserSelect()).toBe('none');
        expect(cell.getRenderer().getText().getUserSelect()).toBe('none');
    });

    it('a body StringCell built from the same renderer is unaffected by the header opt-out', () => {
        expect(new StringCell().getRenderer().getUserSelect()).toBe('text');
    });
});

describe('interactive chrome keeps its unselectable default', () => {
    it("a Button's label Text stays unselectable", () => {
        const btn = new Button({ text: 'Save' });

        expect((btn as any)._text.getUserSelect()).toBe('none');
    });

    it("a MenuItem's title Text stays unselectable", () => {
        const item = new MenuItem({ text: 'A' }, () => {}, () => {});

        expect((item as any)._titleText.getUserSelect()).toBe('none');
    });

    it("a TabButton's label stays unselectable", () => {
        const tab = new TabButton('Tab');

        expect((tab as any)._text.getUserSelect()).toBe('none');
    });
});
