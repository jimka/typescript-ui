import { describe, it, expect } from 'vitest';
import { Component, ComponentOptions } from '~/core/Component';
import { Absolute } from '~/layout/Absolute';
import { BulletedList } from '~/component/list/BulletedList';
import { BulletedListItemStyle } from '~/component/list/BulletedListItemStyle';
import { IconText } from '~/component/display/IconText';
import { ToolBar } from '~/component/menubar/ToolBar';
import { SplitGutter } from '~/component/container/SplitGutter';
import { HBox } from '~/layout/HBox';
import { TextField } from '~/component/input/TextField';
import { NumberedList } from '~/component/list/NumberedList';
import { NumberedListItemStyle } from '~/component/list/NumberedListItemStyle';
import { TabCloseButton } from '~/component/button/TabCloseButton';
import { Button } from '~/component/button/Button';
import { Drawer } from '~/overlay/Drawer';
import { Popover } from '~/overlay/Popover';

// Subclass that seeds class-level defaults the way real subclasses do — through
// `subclassDefaults`, which land in `_defaultOptions`, never via a setter.
class Defaulted extends Component {
    constructor(options?: ComponentOptions) {
        super(options, {
            borderRadius: '4px',
            shadow:       '0 0 2px black',
            outline:      'none',
            border:       '2px solid red',
            overflow:     'auto',
        } as Partial<ComponentOptions>);
    }
}

describe('default options as pure fallback', () => {
    it('does not dispatch class defaults into the _options bag', () => {
        const c = new Component({}) as any;
        for (const key of ['cursor', 'padding', 'insets', 'maxSize', 'minSize',
                           'zIndex', 'borderRadius', 'shadow', 'pointerEvents',
                           'writingMode', 'layoutManager']) {
            expect(c._options[key], `_options.${key}`).toBeUndefined();
        }
        expect(c._border).toBeNull();
        expect(c._outline).toBeNull();
        expect(c._overflowX).toBeNull();
        expect(c._overflowY).toBeNull();
    });

    it('resolves base-class defaults through the getters', () => {
        const c = new Component({});
        expect(c.getCursor()).toBe('default');
        expect(c.getOverflowX()).toBe('hidden');
        expect(c.getOverflowY()).toBe('hidden');
        expect(c.isDisplayed()).toBe(true);
        const insets = c.getInsets();
        expect([insets.getTop(), insets.getRight(), insets.getBottom(), insets.getLeft()]).toEqual([0, 0, 0, 0]);
        // No base default for these — stay null until a subclass/caller supplies one.
        expect(c.getBorderRadius()).toBeNull();
        expect(c.getShadow()).toBeNull();
        expect(c.getPointerEvents()).toBeNull();
        expect(c.getWritingMode()).toBeNull();
        expect(c.getBorder()).toBeNull();
        expect(c.getOutline()).toBeNull();
    });

    it('resolves subclass defaults through the getters without a caller value', () => {
        const c = new Defaulted() as any;
        expect(c.getBorderRadius()).toBe('4px');
        expect(c.getShadow()).toBe('0 0 2px black');
        expect(c.getOutline()).toBe('none');
        expect(c.getOverflowX()).toBe('auto');
        // outline & overflow are pure fallbacks: the private field stays null,
        // the value comes from _defaultOptions.
        expect(c._outline).toBeNull();
        expect(c._overflowX).toBeNull();
        // Chrome fields (border/borderRadius/shadow) keep their default on the
        // dispatch path so clear*() can suppress an inherited default; they are
        // therefore present in _options / _border, not lazily resolved.
        expect(c._options.borderRadius).toBe('4px');
        expect(c._options.shadow).toBe('0 0 2px black');
        expect(c._border).not.toBeNull();
    });

    it('honors an explicit value equal to the default as explicit (key presence)', () => {
        const c = new Component({ cursor: 'default' }) as any;
        expect(c._options.cursor).toBe('default');
        expect(c.getCursor()).toBe('default');
    });

    it('keeps the bag free of default keys when only some fields are explicit', () => {
        const c = new Component({ cursor: 'pointer', zIndex: 5 }) as any;
        expect(c._options.cursor).toBe('pointer');
        expect(c._options.zIndex).toBe(5);
        expect(c._options.padding).toBeUndefined();
        expect(c._options.insets).toBeUndefined();
        expect(c._options.maxSize).toBeUndefined();
    });

    it('attaches the eased wheel scroller at render for a default-scrollable overflow', () => {
        const c = new Defaulted() as any;
        expect(c._wheelScroller).toBeFalsy();   // no setter fired
        c.getElement(true);                      // render -> applyStyle
        expect(c._wheelScroller).toBeTruthy();   // attached from the effective overflow
    });

    it('keeps the border default working (dispatched, layout sees its width)', () => {
        const c = new Defaulted() as any;
        // border stays dispatched, so the parsed border IS present and the
        // border-width path reports a non-zero pre-connect estimate.
        expect(c.getBorder()).not.toBeNull();
        const size = c.getBorderSize();
        expect(size.top).toBeGreaterThan(0);
    });

    it('lazily attaches the default layout manager exactly once', () => {
        const c = new Component({});
        const lm = c.getLayoutManager();
        expect(lm).toBeInstanceOf(Absolute);
        expect(lm.getContainer()).toBe(c);
        // Stable identity across repeated resolution — no re-detach/re-attach.
        expect(c.getLayoutManager()).toBe(lm);
        expect(c.getLayoutManager().getContainer()).toBe(c);
        expect(() => c.doLayout()).not.toThrow();
    });

    it('still honors an explicit layout manager', () => {
        const explicit = new Absolute();
        const c = new Component({ layoutManager: explicit });
        expect(c.getLayoutManager()).toBe(explicit);
        expect(explicit.getContainer()).toBe(c);
    });

    it('reads min/max as the raw author constraint, leaving the computed getter to fold layout', () => {
        const c = new Component({}) as any;
        // No author constraint supplied -> bag empty; computed getter still works.
        expect(c._options.minSize).toBeUndefined();
        expect(c._options.maxSize).toBeUndefined();
        expect(c.getMaxSize()).not.toBeUndefined();
    });
});

describe('subclass defaults resolve as pure fallback', () => {
    it('BulletedList resolves its DISC default without writing _options', () => {
        const list = new BulletedList() as any;
        expect(list.getStyle()).toBe(BulletedListItemStyle.DISC);
        expect(list._options.itemStyle).toBeUndefined();
        list.getElement(true);
        expect(list.getStyle()).toBe(BulletedListItemStyle.DISC);
    });

    it('BulletedList honors an explicit itemStyle as explicit state', () => {
        const list = new BulletedList({ itemStyle: BulletedListItemStyle.SQUARE }) as any;
        expect(list.getStyle()).toBe(BulletedListItemStyle.SQUARE);
        // itemStyle is backed by the declare'd `_style` field, not `_options`.
        expect(list._style).toBe(BulletedListItemStyle.SQUARE);
    });

    it('IconText applies the default gap (2) without writing _options.gap', () => {
        const row = new IconText('unicode-arrow-up', 'hi') as any;
        expect(row._options.gap).toBeUndefined();
        expect((row.getLayoutManager() as HBox).getComponentSpacing()).toBe(2);
    });

    it('IconText honors an explicit gap', () => {
        const row = new IconText('unicode-arrow-up', 'hi', { gap: 8 }) as any;
        expect(row._options.gap).toBe(8);
        expect((row.getLayoutManager() as HBox).getComponentSpacing()).toBe(8);
    });

    it('ToolBar seeds its orientation/compact defaults and resolves its bg color, bag clean', () => {
        const tb = new ToolBar() as any;
        expect(tb.getOrientation()).toBe('horizontal');
        expect(tb.isCompact()).toBe(true);
        expect(tb.getBackgroundColor()).toBe('var(--ts-ui-toolbar-bg, rgb(245, 245, 245))');
        expect(tb._options.orientation).toBeUndefined();
        expect(tb._options.compact).toBeUndefined();
    });

    it('SplitGutter seeds its collapsible/movable defaults with a clean bag', () => {
        const gutter = new SplitGutter('horizontal') as any;
        expect(gutter.isCollapsible()).toBe(true);
        expect(gutter.isMovable()).toBe(true);
        expect(gutter._options.collapsible).toBeUndefined();
        expect(gutter._options.movable).toBeUndefined();
    });
});

describe('more subclass defaults resolve as pure fallback', () => {
    it('NumberedList resolves its DECIMAL default with a clean bag', () => {
        const list = new NumberedList() as any;
        expect(list.getStyle()).toBe(NumberedListItemStyle.DECIMAL);
        expect(list._options.itemStyle).toBeUndefined();
    });

    it('TabCloseButton resolves its xmark glyph and 16x16 preferred size', () => {
        const btn = new TabCloseButton() as any;
        expect(btn.getGlyph()).not.toBeNull();
        expect(btn.getGlyph().getGlyphName()).toBe('xmark');
        const pref = btn.getPreferredSize();
        expect([pref.width, pref.height]).toEqual([16, 16]);
    });

    it('Button defaults flat off with a clean bag, and resolves anchor/fill', () => {
        const b = new Button({ text: 'x' }) as any;
        expect(b.isFlat()).toBe(false);
        expect(b._options.flat).toBeUndefined();
        expect(b.getAnchor()).toBeTruthy();
        expect(b.getFill()).toBeTruthy();
    });

    it('Drawer resolves its edge/modal/size/duration defaults', () => {
        // edge is _options-backed and always-dispatched, so the default is
        // written by setEdge; the contract is that getEdge resolves it.
        const d = new Drawer() as any;
        expect(d.getEdge()).toBeTruthy();
        expect(typeof d.getDrawerSize()).toBe('number');
        expect(typeof d.isModal()).toBe('boolean');
    });

    it('Popover resolves its placement default with a clean bag', () => {
        const p = new Popover() as any;
        expect(p.getPlacement()).toBe('auto');
        expect(p._options.placement).toBeUndefined();
    });
});

describe('isVisible folds a subclass visible default', () => {
    class HiddenByDefault extends Component {
        constructor(options?: ComponentOptions) {
            super(options, { visible: false } as Partial<ComponentOptions>);
        }
    }

    it('a subclass defaulting visible:false reports false (not null) when never set', () => {
        expect(new HiddenByDefault().isVisible()).toBe(false);
    });

    it('a plain Component is null (inherit); an explicit value still wins', () => {
        expect(new Component({}).isVisible()).toBeNull();
        const h = new HiddenByDefault();
        h.setVisible(true);
        expect(h.isVisible()).toBe(true);
    });
});

describe('clear*() suppresses a class-level default (does not revert to it)', () => {
    it('clearPadding suppresses a subclass padding default', () => {
        const field = new TextField() as any;
        expect(field.getPadding()).not.toBeNull(); // TextField defaults 3px
        field.clearPadding();
        expect(field.getPadding()).toBeNull();      // cleared, not re-folded
    });

    it('clearCursor suppresses the base cursor default even when never set', () => {
        const c = new Component({});
        expect(c.getCursor()).toBe('default');
        c.clearCursor();
        expect(c.getCursor()).toBeNull();
    });

    it('a never-cleared component still resolves its default, explicit value wins', () => {
        expect(new Component({}).getCursor()).toBe('default');
        expect(new Component({ cursor: 'pointer' }).getCursor()).toBe('pointer');
    });
});
