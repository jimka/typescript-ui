import { describe, it, expect } from 'vitest';
import { Component, ComponentOptions } from '~/core/Component';
import { Panel, PanelOptions } from '~/core/Panel';
import { Fit } from '~/layout/Fit';
import { Absolute } from '~/layout/Absolute';
import { BulletedList } from '~/component/list/BulletedList';
import { BulletedListItemStyle } from '~/component/list/BulletedListItemStyle';
import { IconText } from '~/component/display/IconText';
import { Glyph } from '~/component/display/Glyph';
import { xmark } from '~/glyphs/solid/xmark';
import { lookupGlyph } from '~/component/display/Glyphs';
import { ToolBar } from '~/component/menubar/ToolBar';
import { Tree } from '~/component/tree/Tree';
import { MenuBar } from '~/component/menubar/MenuBar';
import { DiagramNode } from '~/component/diagram/DiagramNode';
import { DiagramGroupNode } from '~/component/diagram/DiagramGroupNode';
import { ScrollStrip } from '~/component/container/ScrollStrip';
import { SplitGutter } from '~/component/container/SplitGutter';
import { HBox } from '~/layout/HBox';
import { VBox } from '~/layout/VBox';
import { ListItem } from '~/component/list/ListItem';
import { TextField } from '~/component/input/TextField';
import { NumberSpinner } from '~/component/input/NumberSpinner';
import { NumberEditor } from '~/component/table/cell/editor/Number';
import { AutoCompleteField } from '~/component/input/AutoCompleteField';
import { Link } from '~/component/input/Link';
import { PickerButton } from '~/component/input/PickerButton';
import { RailHandle } from '~/overlay/RailHandle';
import { NumberedList } from '~/component/list/NumberedList';
import { NumberedListItemStyle } from '~/component/list/NumberedListItemStyle';
import { TabCloseButton } from '~/component/button/TabCloseButton';
import { NotificationHistoryButton } from '~/overlay/NotificationHistoryButton';
import { Button } from '~/component/button/Button';
import { ToggleButton } from '~/component/button/ToggleButton';
import { TabButton } from '~/component/button/TabButton';
import { MenuBarButton } from '~/component/menubar/MenuBarButton';
import { Checkbox } from '~/component/input/Checkbox';
import { RadioButton } from '~/component/input/RadioButton';
import { Toggle } from '~/component/input/Toggle';
import { Slider } from '~/component/input/Slider';
import { StatusBar } from '~/component/container/StatusBar';
import { TabBar } from '~/component/container/TabBar';
import { MenuSeparator } from '~/component/container/MenuSeparator';
import { SortPriorityBadge } from '~/component/table/cell/SortPriorityBadge';
import { FilterClauseBadge } from '~/component/table/cell/FilterClauseBadge';
import { Scrollbar } from '~/component/container/Scrollbar';
import { WindowHeader } from '~/component/container/WindowHeader';
import { ResizeHandle } from '~/component/table/cell/ResizeHandle';
import { ComboBox } from '~/component/input/ComboBox';
import { List } from '~/component/list/List';
import { HeaderCell } from '~/component/table/cell/Header';
import { ParentHeaderCell } from '~/component/table/cell/ParentHeader';
import { ToolBarSeparator } from '~/component/menubar/ToolBarSeparator';
import { ChartLegend } from '~/component/chart/ChartLegend';
import { Drawer } from '~/overlay/Drawer';
import { Popover } from '~/overlay/Popover';
import { PopupPanel } from '~/overlay/PopupPanel';
import { AnimatedDropdown } from '~/core/AnimatedDropdown';
import { LineChart } from '~/component/chart/LineChart';
import { BarChart } from '~/component/chart/BarChart';
import { DiagramView } from '~/component/diagram/DiagramView';
import { FloatingPanel } from '~/component/container/FloatingPanel';
import { MarkdownMinimap } from '~/component/display/MarkdownMinimap';
import { MarkdownViewer } from '~/component/display/MarkdownViewer';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { SelectableText } from '~/component/input/SelectableText';
import { StringCell } from '~/component/table/cell/String';
import { NumberRenderer } from '~/component/table/cell/renderer/Number';
import { Canvas, CanvasOptions } from '~/component/display/Canvas';
import { WebGLCanvas, WebGLCanvasOptions } from '~/component/display/WebGLCanvas';
import { Insets } from '~/primitive/Insets';
import { Size } from '~/primitive/Size';

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

// Panel subclass seeding autoScroll/scrollShadows/scrollbarStyle through
// subclassDefaults, the way real subclasses do — this is the defect
// panel-scroll-option-defaults.md fixes: Panel.applyOptions always-dispatched
// these three setters with a hardcoded literal instead of a class default.
class ScrollingPanel extends Panel {
    constructor(options?: PanelOptions) {
        super(options, {
            layoutManager:  new Fit(),
            autoScroll:     'y',
            scrollShadows:  false,
            scrollbarStyle: 'native',
        } as Partial<PanelOptions>);
    }
}

// Canvas / WebGLCanvas seed the animation-loop fields through subclassDefaults.
// Their getters must fold `_defaultOptions`, and — unlike most rows here — the
// draw path consumes the callbacks, so a defaulted hook has to actually fire.
class DefaultedCanvas extends Canvas {
    constructor(options?: CanvasOptions) {
        super(options, { maxFps: 45, animateWhenHidden: true } as Partial<CanvasOptions>);
    }
}

class DefaultedWebGLCanvas extends WebGLCanvas {
    constructor(options?: WebGLCanvasOptions) {
        super(options, { maxFps: 24, animateWhenHidden: true } as Partial<WebGLCanvasOptions>);
    }
}

describe('default options as pure fallback', () => {
    it('resolves Canvas / WebGLCanvas animation defaults through the getters', () => {
        const canvas = new DefaultedCanvas();
        const webgl  = new DefaultedWebGLCanvas();

        expect(canvas.getMaxFps()).toBe(45);
        expect(canvas.getAnimateWhenHidden()).toBe(true);
        expect(webgl.getMaxFps()).toBe(24);
        expect(webgl.getAnimateWhenHidden()).toBe(true);

        // Pure fallbacks: never dispatched into the bag.
        expect((canvas as any)._options.maxFps).toBeUndefined();
        expect((webgl as any)._options.animateWhenHidden).toBeUndefined();

        // And an explicit value still wins.
        expect(new DefaultedCanvas({ maxFps: 5 }).getMaxFps()).toBe(5);
    });

    it('does not dispatch class defaults into the _options bag', () => {
        const c = new Component({}) as any;
        for (const key of ['cursor', 'userSelect', 'padding', 'insets', 'maxSize', 'minSize',
                           'zIndex', 'borderRadius', 'shadow', 'pointerEvents',
                           'writingMode', 'layoutManager']) {
            expect(c._options[key], `_options.${key}`).toBeUndefined();
        }
        expect(c._border).toBeNull();
        expect(c._instanceStyle.outline).toBeUndefined();
        expect(c._instanceStyle.overflowX).toBeUndefined();
        expect(c._instanceStyle.overflowY).toBeUndefined();
    });

    it('resolves base-class defaults through the getters', () => {
        const c = new Component({});
        expect(c.getCursor()).toBe('default');
        expect(c.getUserSelect()).toBe('none');
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
        // outline & overflow are pure fallbacks: the instance layer never
        // authors the key, the value comes from _defaultOptions.
        expect(c._instanceStyle.outline).toBeUndefined();
        expect(c._instanceStyle.overflowX).toBeUndefined();
        // Chrome fields (border/borderRadius/shadow) keep their default on the
        // dispatch path so clear*() can suppress an inherited default; they are
        // therefore present in the instance layer / _border, not lazily resolved.
        expect(c._instanceStyle.borderRadius).toBe('4px');
        expect(c._instanceStyle.shadow).toBe('0 0 2px black');
        expect(c._border).not.toBeNull();
    });

    it('honors an explicit value equal to the default as explicit (key presence)', () => {
        const c = new Component({ cursor: 'default' }) as any;
        expect(c._instanceStyle.cursor).toBe('default');
        expect(c.getCursor()).toBe('default');
    });

    it('keeps the bag free of default keys when only some fields are explicit', () => {
        const c = new Component({ cursor: 'pointer', zIndex: 5 }) as any;
        expect(c._instanceStyle.cursor).toBe('pointer');
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

// Default-resolution registry. Every class that seeds a `_default*Options`
// field gets a row asserting that a bare construction (no caller options) still
// resolves the default through its getter. This is the mechanical guard for the
// "Class-level defaults must survive the getter" rule in ARCHITECTURE.md — a
// dropped default fails here even though it is invisible to the offline harness.
// Add a row when you add a defaulted field.
const insetsTuple = (i: Insets | null) => i && [i.getTop(), i.getRight(), i.getBottom(), i.getLeft()];

// MenuBarButton's onClick/onHover constructor params, for rows that only need
// a bare instance and never fire either callback.
const NOOP = (): void => {};

// Runs `read` with `xmark` registered. The registry is global and shared, and
// TabCloseButton registers `xmark` for its own default glyph — so unregistering
// unconditionally would pull it out from under the TabCloseButton rows below.
// Only what this helper registered is removed again.
const withXmark = (read: () => unknown): unknown => {
    const preRegistered = lookupGlyph('xmark') !== undefined;

    if (!preRegistered) {
        Glyph.register(xmark);
    }

    try {
        return read();
    } finally {
        if (!preRegistered) {
            Glyph.unregister('xmark');
        }
    }
};
const sizeTuple   = (s: Size | null)   => s && [s.width, s.height];

const DEFAULT_RESOLUTION: Array<{ label: string; resolve: () => unknown; expected: unknown }> = [
    { label: 'Component cursor',             resolve: () => new Component({}).getCursor(),                              expected: 'default' },
    { label: 'Component userSelect',         resolve: () => new Component({}).getUserSelect(),                          expected: 'none' },
    { label: 'Component overflow',           resolve: () => new Component({}).getOverflowX(),                           expected: 'hidden' },
    { label: 'TextField padding',            resolve: () => insetsTuple(new TextField().getPadding()),                  expected: [3, 3, 3, 3] },
    { label: 'NumberSpinner _input textAlign', resolve: () => (new NumberSpinner() as any)._input.getTextAlign(), expected: 'right' },
    { label: 'NumberSpinner _input border',            resolve: () => (new NumberSpinner() as any)._input.getBorder(),            expected: { border: 'none' } },
    { label: 'NumberSpinner _input borderRadius',       resolve: () => (new NumberSpinner() as any)._input.getBorderRadius(),      expected: '0' },
    { label: 'NumberSpinner _input outline',            resolve: () => (new NumberSpinner() as any)._input.getOutline(),           expected: 'none' },
    { label: 'AutoCompleteField _textField border',       resolve: () => (new AutoCompleteField() as any)._textField.getBorder(),       expected: { border: 'none' } },
    { label: 'AutoCompleteField _textField borderRadius', resolve: () => (new AutoCompleteField() as any)._textField.getBorderRadius(), expected: '0' },
    { label: 'AutoCompleteField _textField outline',      resolve: () => (new AutoCompleteField() as any)._textField.getOutline(),      expected: 'none' },
    { label: 'NumberSpinner _upBtn border',   resolve: () => (new NumberSpinner() as any)._upBtn.getBorder(),   expected: { borderTop: '1px solid transparent' } },
    { label: 'NumberSpinner _downBtn border', resolve: () => (new NumberSpinner() as any)._downBtn.getBorder(), expected: { borderTop: '1px solid var(--ts-ui-spinner-divider, rgb(180, 180, 180))' } },
    { label: 'NumberEditor _textField textAlign', resolve: () => (new NumberEditor() as any)._textField.getTextAlign(), expected: 'right' },
    { label: 'ToolBar orientation',          resolve: () => new ToolBar().getOrientation(),                             expected: 'horizontal' },
    { label: 'ToolBar compact',              resolve: () => new ToolBar().isCompact(),                                  expected: true },
    { label: 'ToolBar backgroundColor',      resolve: () => new ToolBar().getBackgroundColor(),                         expected: 'var(--ts-ui-toolbar-bg, rgb(245, 245, 245))' },
    { label: 'Tree backgroundColor',         resolve: () => new Tree().getBackgroundColor(),                            expected: 'var(--ts-ui-input-bg, rgb(255, 255, 255))' },
    { label: 'MenuBar backgroundColor',      resolve: () => new MenuBar().getBackgroundColor(),                         expected: 'var(--ts-ui-menu-bar-bg, rgb(245, 245, 245))' },
    { label: 'DiagramNode backgroundColor',  resolve: () => new DiagramNode().getBackgroundColor(),                     expected: 'var(--ts-ui-diagram-node-bg, var(--ts-ui-button-bg, rgb(245, 245, 245)))' },
    { label: 'DiagramGroupNode backgroundColor', resolve: () => new DiagramGroupNode().getBackgroundColor(),            expected: 'var(--ts-ui-diagram-group-bg, rgba(120, 120, 120, 0.08))' },
    { label: 'ScrollStrip backgroundColor',  resolve: () => new ScrollStrip().getBackgroundColor(),                     expected: 'transparent' },
    { label: 'Button backgroundColor',       resolve: () => new Button('x').getBackgroundColor(),                       expected: 'var(--ts-ui-button-bg, transparent)' },
    { label: 'Button _text textAlign',       resolve: () => (new Button() as any)._text.getTextAlign(),                  expected: 'center' },
    { label: 'Button _text fontWeight',      resolve: () => (new Button() as any)._text.getFontWeight(),                 expected: 'bold' },
    { label: 'TabButton backgroundColor',    resolve: () => new TabButton('x').getBackgroundColor(),                    expected: 'var(--ts-ui-tab-button-bg, #b8b8c3)' },
    { label: 'TabButton backgroundImage',    resolve: () => new TabButton('x').getBackgroundImage(),                    expected: 'var(--ts-ui-tab-button-bg, #b8b8c3)' },
    { label: 'TabButton hoverBackgroundColor', resolve: () => new TabButton('x').getHoverBackgroundColor(),             expected: 'var(--ts-ui-tab-button-hover-bg, #c4c4cf)' },
    { label: 'TabButton hoverBackgroundImage', resolve: () => new TabButton('x').getHoverBackgroundImage(),             expected: 'var(--ts-ui-tab-button-hover-bg, #c4c4cf)' },
    { label: 'TabButton hoverShadow',        resolve: () => new TabButton('x').getHoverShadow(),                        expected: 'none' },
    { label: 'MenuBarButton insets',         resolve: () => insetsTuple(new MenuBarButton('File', NOOP, NOOP).getInsets()), expected: [0, 10, 0, 10] },
    { label: 'MenuBarButton getShadow() (rendered)',            resolve: () => { const b = new MenuBarButton('File', NOOP, NOOP); b.getElement(true); return b.getShadow(); }, expected: 'none' },
    { label: 'MenuBarButton getBackgroundImage() (rendered)',   resolve: () => { const b = new MenuBarButton('File', NOOP, NOOP); b.getElement(true); return b.getBackgroundImage(); }, expected: 'none' },
    { label: 'MenuBarButton getPressedBackgroundColor() (rendered)', resolve: () => { const b = new MenuBarButton('File', NOOP, NOOP); b.getElement(true); return b.getPressedBackgroundColor(); }, expected: 'var(--ts-ui-menu-bar-btn-bg, transparent)' },
    { label: 'MenuBarButton getHoverBackgroundColor() (rendered)',  resolve: () => { const b = new MenuBarButton('File', NOOP, NOOP); b.getElement(true); return b.getHoverBackgroundColor(); }, expected: 'var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))' },
    // Render before reading — before first render, `styleLayers()` still uses
    // the `getClassStyleDefaults()` virtual layer, which resolves this
    // correctly even against the pre-fix defect (see the plan's `[^leaf-loss]`
    // note); only the rendered class-tier rule exposed the bug.
    { label: 'MenuBarButton backgroundColor (rendered)', resolve: () => { const b = new MenuBarButton('File', NOOP, NOOP); b.getElement(true); return b.getBackgroundColor(); }, expected: 'var(--ts-ui-menu-bar-btn-bg, transparent)' },
    { label: 'MenuBarButton foregroundColor (rendered)', resolve: () => { const b = new MenuBarButton('File', NOOP, NOOP); b.getElement(true); return b.getForegroundColor(); }, expected: 'var(--ts-ui-menu-bar-btn-fg, inherit)' },
    { label: 'MenuBarButton cursor (rendered)',          resolve: () => { const b = new MenuBarButton('File', NOOP, NOOP); b.getElement(true); return b.getCursor(); },          expected: 'pointer' },
    { label: 'TabCloseButton foregroundColor (rendered)', resolve: () => { const b = new TabCloseButton(); b.getElement(true); return b.getForegroundColor(); }, expected: 'var(--ts-ui-close-button-fg, #555)' },
    { label: 'TabCloseButton backgroundColor (rendered)', resolve: () => { const b = new TabCloseButton(); b.getElement(true); return b.getBackgroundColor(); }, expected: 'transparent' },
    { label: 'TabCloseButton borderRadius (rendered)',    resolve: () => { const b = new TabCloseButton(); b.getElement(true); return b.getBorderRadius(); },    expected: '3px' },
    { label: 'PickerButton backgroundColor (rendered)',   resolve: () => { const b = new PickerButton(); b.getElement(true); return b.getBackgroundColor(); }, expected: 'transparent' },
    { label: 'PickerButton shadow (rendered)',            resolve: () => { const b = new PickerButton(); b.getElement(true); return b.getShadow(); },           expected: 'none' },
    { label: 'RailHandle getBackgroundColor()',           resolve: () => { const h = new RailHandle(); h.getElement(true); return h.getBackgroundColor(); },   expected: 'transparent' },
    { label: 'RailHandle getShadow()',                    resolve: () => { const h = new RailHandle(); h.getElement(true); return h.getShadow(); },             expected: 'none' },
    // ToggleButton itself has no backgroundColor default of its own; the value
    // below now comes from `Button`'s own `_defaultButtonOptions.backgroundColor`
    // entry — this plan's fix folds it through the getter instead of an
    // imperative repaint, so a bare ToggleButton (no subclassDefaults) still
    // resolves the same token.
    { label: 'ToggleButton backgroundColor (unset)', resolve: () => new ToggleButton('x').getBackgroundColor(),         expected: 'var(--ts-ui-button-bg, transparent)' },
    { label: 'StatusBar backgroundColor',    resolve: () => new StatusBar().getBackgroundColor(),                       expected: 'var(--ts-ui-statusbar-bg, rgb(245, 245, 245))' },
    { label: 'StatusBar foregroundColor',    resolve: () => new StatusBar().getForegroundColor(),                       expected: 'var(--ts-ui-statusbar-color, rgb(60, 60, 60))' },
    { label: 'TabBar backgroundColor',       resolve: () => new TabBar().getBackgroundColor(),                          expected: 'var(--ts-ui-tab-toolbar-bg, #eee)' },
    { label: 'MenuSeparator backgroundColor', resolve: () => new MenuSeparator().getBackgroundColor(),                  expected: 'transparent' },
    { label: 'SortPriorityBadge backgroundColor', resolve: () => new SortPriorityBadge().getBackgroundColor(),          expected: 'var(--ts-ui-sort-badge-bg, rgba(0,0,0,0.15))' },
    { label: 'SortPriorityBadge foregroundColor', resolve: () => new SortPriorityBadge().getForegroundColor(),          expected: 'var(--ts-ui-sort-badge-color, inherit)' },
    { label: 'FilterClauseBadge backgroundColor', resolve: () => new FilterClauseBadge().getBackgroundColor(),          expected: 'var(--ts-ui-filter-clause-badge-bg, rgba(0,0,0,0.15))' },
    { label: 'FilterClauseBadge foregroundColor', resolve: () => new FilterClauseBadge().getForegroundColor(),          expected: 'var(--ts-ui-filter-clause-badge-color, inherit)' },
    { label: 'Scrollbar backgroundColor',    resolve: () => new Scrollbar().getBackgroundColor(),                       expected: 'var(--ts-ui-scrollbar-track, rgba(0, 0, 0, 0.04))' },
    { label: 'Scrollbar touchAction',        resolve: () => new Scrollbar().getTouchAction(),                           expected: 'none' },
    { label: 'ScrollArrowButton backgroundColor', resolve: () => (new Scrollbar('vertical', { arrowsEnabled: true }).getComponents()[1] as any).getBackgroundColor(), expected: 'var(--ts-ui-scrollbar-arrow-bg, transparent)' },
    // Index [2] (`_arrowEnd`), not [1] (`_arrowStart`): `buildArrows` force-disables
    // the start arrow unconditionally at construction (scroll position starts at 0),
    // and `ownStyleStates`' `.disabled` state now resolves through `getForegroundColor`
    // like any other active-state layer — so index [1] would report the dimmed
    // disabled-state token here, not the resting default this row means to check.
    { label: 'ScrollArrowButton foregroundColor', resolve: () => (new Scrollbar('vertical', { arrowsEnabled: true }).getComponents()[2] as any).getForegroundColor(), expected: 'var(--ts-ui-scrollbar-arrow-color, rgba(0, 0, 0, 0.55))' },
    { label: 'ScrollArrowGlyph minSize',     resolve: () => (new Scrollbar('vertical', { arrowsEnabled: true }).getComponents()[1] as any)._glyph.getMinSizeConstraint(), expected: { width: 12, height: 12 } },
    { label: 'ScrollbarThumb cursor',        resolve: () => (new Scrollbar() as any)._thumb.getCursor(),                expected: 'grab' },
    { label: 'ScrollbarThumb backgroundColor', resolve: () => (new Scrollbar() as any)._thumb.getBackgroundColor(),     expected: 'var(--ts-ui-scrollbar-thumb, rgba(0, 0, 0, 0.35))' },
    { label: 'ResizeHandle cursor',          resolve: () => new ResizeHandle().getCursor(),                             expected: 'var(--ts-ui-table-resize-handle-cursor, ew-resize)' },
    { label: 'ResizeHandle backgroundImage', resolve: () => new ResizeHandle().getBackgroundImage(),                    expected: 'linear-gradient(to right,transparent 80%,var(--ts-ui-table-resize-handle-color,rgba(0,0,0,0.2)) 80%)' },
    { label: 'ComboBoxCaret minSize',        resolve: () => (new ComboBox() as any)._caret.getMinSizeConstraint(),      expected: { width: 14, height: 14 } },
    // Unlike its ComboBoxCaretGlyph/WindowHeaderTitleGlyph siblings below, an
    // unrendered Button's icon hasn't been line-height-synced yet:
    // Button._syncGlyphSize needs a real Text.getLineHeight() measurement,
    // which this DOM-less registry harness never provides, so the glyph is
    // still at Glyph's own un-re-pinned base default (16x16, matching the
    // "Glyph minSize" row below) rather than ButtonIconGlyph's 14x14 class
    // default. See Button.test.ts's "ButtonIconGlyph style hoisting" for the
    // post-render 14x14 value this class default actually produces.
    { label: 'ButtonIconGlyph minSize',      resolve: () => new Button({ glyph: 'unicode-arrow-up' }).getGlyph()!.getMinSizeConstraint(), expected: { width: 16, height: 16 } },
    { label: 'ComboBoxCaretGlyph minSize',     resolve: () => (new ComboBox() as any)._caret.getGlyph().getMinSizeConstraint(),               expected: { width: 14, height: 14 } },
    { label: 'WindowHeaderTitleGlyph minSize', resolve: () => new WindowHeader('Title').getGlyph()!.getMinSizeConstraint(),                    expected: { width: 14, height: 14 } },
    { label: 'SelectableListRow cursor',     resolve: () => (new List({ items: ['a'] }) as any)._rowPool[0].getCursor(), expected: 'pointer' },
    { label: 'SelectableListRow border',     resolve: () => (new List({ items: ['a'] }) as any)._rowPool[0].getBorder(), expected: { borderBottom: '1px solid var(--ts-ui-list-row-separator, transparent)' } },
    { label: 'AbstractSelectableList minSize (via List)', resolve: () => new List().getMinSizeConstraint(), expected: { width: 100, height: 100 } },
    { label: 'HeaderCellRenderer cursor',    resolve: () => new HeaderCell('Name', 'name').getRenderer().getCursor(),   expected: 'default' },
    { label: 'HeaderCellRenderer userSelect', resolve: () => new HeaderCell('Name', 'name').getRenderer().getUserSelect(), expected: 'none' },
    { label: 'HeaderCell renderer text fontWeight', resolve: () => new HeaderCell('Name', 'name').getRenderer().getText().getFontWeight(), expected: 'bold' },
    { label: 'HeaderCell renderer text userSelect', resolve: () => new HeaderCell('Name', 'name').getRenderer().getText().getUserSelect(), expected: 'none' },
    { label: 'ParentHeaderCellRenderer cursor', resolve: () => new ParentHeaderCell('Group', null).getRenderer().getCursor(), expected: 'default' },
    { label: 'ParentHeaderCellRenderer userSelect', resolve: () => new ParentHeaderCell('Group', null).getRenderer().getUserSelect(), expected: 'none' },
    { label: 'ParentHeaderCell renderer text userSelect', resolve: () => new ParentHeaderCell('Group', null).getRenderer().getText().getUserSelect(), expected: 'none' },
    { label: 'ParentHeaderCell renderer text fontWeight', resolve: () => new ParentHeaderCell('Group', null).getRenderer().getText().getFontWeight(), expected: 'bold' },
    { label: 'ParentHeaderCell renderer text textAlign', resolve: () => new ParentHeaderCell('Group', null).getRenderer().getText().getTextAlign(), expected: 'center' },
    { label: 'ToolBarSeparator backgroundColor', resolve: () => new ToolBarSeparator().getBackgroundColor(),            expected: 'var(--ts-ui-toolbar-separator-color, rgb(220, 220, 220))' },
    { label: 'ChartLegend backgroundColor',  resolve: () => new ChartLegend().getBackgroundColor(),                     expected: 'transparent' },
    { label: 'Popover backgroundColor',      resolve: () => new Popover().getBackgroundColor(),                        expected: 'var(--ts-ui-popover-bg, rgb(255, 255, 255))' },
    { label: 'Popover foregroundColor',      resolve: () => new Popover().getForegroundColor(),                        expected: 'var(--ts-ui-popover-color, rgb(0, 0, 0))' },
    { label: 'SplitGutter collapsible',      resolve: () => new SplitGutter('horizontal').isCollapsible(),              expected: true },
    { label: 'SplitGutter movable',          resolve: () => new SplitGutter('horizontal').isMovable(),                  expected: true },
    { label: 'BulletedList itemStyle',       resolve: () => new BulletedList().getStyle(),                              expected: BulletedListItemStyle.DISC },
    { label: 'BulletedList layout spacing',  resolve: () => (new BulletedList().getLayoutManager() as VBox).getComponentSpacing(), expected: 0 },
    { label: 'ListItem tag',                 resolve: () => new ListItem('k', 'v').getTag(),                            expected: 'li' },
    { label: 'ListItem marker gap',          resolve: () => (new ListItem('k', 'v').getLayoutManager() as HBox).getComponentSpacing(), expected: 4 },
    { label: 'ListItemMarkerText textAlign', resolve: () => (new ListItem('k', 'v') as any)._marker.getTextAlign(),     expected: 'right' },
    { label: 'NumberedList itemStyle',       resolve: () => new NumberedList().getStyle(),                              expected: NumberedListItemStyle.DECIMAL },
    { label: 'IconText gap',                 resolve: () => (new IconText('unicode-arrow-up', 'x').getLayoutManager() as HBox).getComponentSpacing(), expected: 2 },
    { label: 'Glyph tag (char entry)',       resolve: () => new Glyph('unicode-arrow-up').getTag(),                     expected: 'span' },
    // The SVG kind is the one that used to override this default per-instance
    // with `tag: "svg"`. It must resolve to the same `span` as a char glyph, so
    // the animation class lands on a compositable HTML element.
    { label: 'Glyph tag (svg entry)',        resolve: () => withXmark(() => new Glyph('xmark').getTag()),               expected: 'span' },
    { label: 'Glyph minSize',                resolve: () => new Glyph('unicode-arrow-up').getMinSizeConstraint(),       expected: { width: 16, height: 16 } },
    { label: 'Popover placement',            resolve: () => new Popover().getPlacement(),                               expected: 'auto' },
    { label: 'Drawer edge',                  resolve: () => new Drawer().getEdge(),                                     expected: 'west' },
    { label: 'Button flat',                  resolve: () => new Button({ text: 'x' }).isFlat(),                         expected: false },
    { label: 'TabCloseButton glyph',         resolve: () => new TabCloseButton().getGlyph()?.getGlyphName(),            expected: 'xmark' },
    { label: 'TabCloseButton preferredSize', resolve: () => sizeTuple(new TabCloseButton().getPreferredSize()),         expected: [16, 16] },
    { label: 'NotificationHistoryButton glyph', resolve: () => new NotificationHistoryButton().getGlyph()?.getGlyphName(), expected: 'clock-rotate-left' },
    { label: 'NotificationHistoryButton menuItems', resolve: () => typeof new NotificationHistoryButton().getMenuItems(), expected: 'function' },
    { label: 'NotificationHistoryButton scrollToBottomOnShow', resolve: () => new NotificationHistoryButton().isScrollToBottomOnShow(), expected: true },
    { label: 'AnimatedDropdown visible',     resolve: () => new AnimatedDropdown().isVisible(),                         expected: false },
    { label: 'LineChart showLegend',         resolve: () => new LineChart({}).isShowLegend(),                           expected: true },
    { label: 'LineChart legendPosition',     resolve: () => new LineChart({}).getLegendPosition(),                      expected: 'right' },
    { label: 'LineChart showPoints',         resolve: () => new LineChart({}).isShowPoints(),                           expected: true },
    { label: 'LineChart curved',             resolve: () => new LineChart({}).isCurved(),                               expected: false },
    { label: 'LineChart xScaleType',         resolve: () => new LineChart({}).getXScaleType(),                          expected: 'linear' },
    { label: 'BarChart grouped (no data)',   resolve: () => new BarChart({}).isGrouped(),                               expected: false },
    { label: 'DiagramView zoom',             resolve: () => new DiagramView().getZoom(),                                expected: 1 },
    { label: 'DiagramView controls',         resolve: () => new DiagramView().isControlsVisible(),                      expected: true },
    { label: 'FloatingPanel corner',         resolve: () => new FloatingPanel({}).getCorner(),                          expected: 'top-right' },
    { label: 'FloatingPanel margin',         resolve: () => new FloatingPanel({}).getMargin(),                          expected: 12 },
    { label: 'MarkdownMinimap maxHeadingDepth', resolve: () => new MarkdownMinimap({}).getMaxHeadingDepth(),            expected: 3 },
    { label: 'MarkdownMinimap minSize',      resolve: () => new MarkdownMinimap({}).getMinSizeConstraint(),             expected: { width: 160, height: 0 } },
    { label: 'MarkdownMinimap maxSize',      resolve: () => new MarkdownMinimap({}).getMaxSizeConstraint(),             expected: { width: Number.MAX_SAFE_INTEGER, height: 500 } },
    { label: 'MarkdownViewer showMinimap',   resolve: () => new MarkdownViewer({}).isMinimapVisible(),                   expected: true },
    { label: 'MarkdownViewer showControls',  resolve: () => new MarkdownViewer({}).isControlsVisible(),                  expected: true },
    { label: 'MarkdownEditor readOnly',      resolve: () => new MarkdownEditor().getReadOnly(),                         expected: false },
    { label: 'Link tag',                     resolve: () => new Link().getTag(),                                        expected: 'a' },
    { label: 'Link foregroundColor',         resolve: () => new Link().getForegroundColor(),                            expected: 'var(--ts-ui-link-color, rgb(21, 101, 192))' },
    { label: 'Link cursor',                  resolve: () => new Link().getCursor(),                                     expected: 'pointer' },
    { label: 'Link interactive',             resolve: () => new Link().isInteractive(),                                 expected: true },
    { label: 'Panel autoScroll',             resolve: () => new Panel({}).getAutoScroll(),                              expected: 'none' },
    { label: 'Panel scrollShadows',          resolve: () => new Panel({}).getScrollShadows(),                           expected: true },
    { label: 'Panel scrollbarStyle',         resolve: () => new Panel({}).getScrollbarStyle(),                          expected: 'overlay' },
    { label: 'ScrollingPanel autoScroll',     resolve: () => new ScrollingPanel().getAutoScroll(),                       expected: 'y' },
    { label: 'ScrollingPanel overflowY',      resolve: () => new ScrollingPanel().getOverflowY(),                        expected: 'auto' },
    { label: 'ScrollingPanel scrollShadows',  resolve: () => new ScrollingPanel().getScrollShadows(),                    expected: false },
    { label: 'ScrollingPanel scrollbarStyle', resolve: () => new ScrollingPanel().getScrollbarStyle(),                   expected: 'native' },

    // option-setter-clobbering-audit: the follow-up sweep across border,
    // borderRadius, shadow, cursor, outline, overflow, preferredSize, minSize,
    // maxSize.
    { label: 'DiagramNode border',           resolve: () => new DiagramNode().getBorder(),                              expected: { border: '1px solid var(--ts-ui-border-color, rgb(180, 180, 180))' } },
    { label: 'DiagramNode borderRadius',     resolve: () => new DiagramNode().getBorderRadius(),                        expected: '4px' },
    { label: 'DiagramNode cursor',           resolve: () => new DiagramNode().getCursor(),                              expected: 'pointer' },
    { label: 'DiagramGroupNode cursor',      resolve: () => new DiagramGroupNode().getCursor(),                         expected: 'pointer' },
    { label: 'DiagramGroupNode border',      resolve: () => new DiagramGroupNode().getBorder(),                         expected: { border: '1px solid var(--ts-ui-diagram-group-border, var(--ts-ui-border-color, rgb(180, 180, 180)))' } },
    { label: 'DiagramGroupNode borderRadius', resolve: () => new DiagramGroupNode().getBorderRadius(),                  expected: '4px' },
    { label: 'StatusBar border',             resolve: () => new StatusBar().getBorder(),                                expected: { borderTop: '1px solid var(--ts-ui-statusbar-border, rgb(220, 220, 220))' } },
    { label: 'StatusBar minSize',            resolve: () => new StatusBar().getMinSizeConstraint(),                     expected: { width: 0, height: 22 } },
    { label: 'StatusBar maxSize',            resolve: () => new StatusBar().getMaxSizeConstraint(),                     expected: { width: Number.MAX_SAFE_INTEGER, height: 22 } },
    { label: 'Popover border',               resolve: () => new Popover().getBorder(),                                  expected: { border: '1px solid var(--ts-ui-popover-border, rgb(200, 200, 200))' } },
    { label: 'Popover borderRadius',         resolve: () => new Popover().getBorderRadius(),                            expected: 'var(--ts-ui-popover-radius, 6px)' },
    { label: 'Popover shadow',               resolve: () => new Popover().getShadow(),                                  expected: 'var(--ts-ui-popover-shadow, 2px 4px 12px rgba(0, 0, 0, 0.18))' },
    { label: 'PopupPanel backgroundColor',   resolve: () => new PopupPanel().getBackgroundColor(),                      expected: 'var(--ts-ui-autocomplete-bg, rgb(255, 255, 255))' },
    { label: 'PopupPanel border',            resolve: () => new PopupPanel().getBorder(),                               expected: { border: 'var(--ts-ui-input-border)' } },
    { label: 'PopupPanel borderRadius',      resolve: () => new PopupPanel().getBorderRadius(),                         expected: 'var(--ts-ui-border-radius, 4px)' },
    { label: 'PopupPanel shadow',            resolve: () => new PopupPanel().getShadow(),                               expected: 'var(--ts-ui-autocomplete-shadow, 2px 4px 8px rgba(0,0,0,0.15))' },
    { label: 'TabButton border',             resolve: () => new TabButton('x').getBorder(),                             expected: {
        borderTop:    'var(--ts-ui-tab-button-border-top,    var(--ts-ui-tab-button-border, none))',
        borderRight:  'var(--ts-ui-tab-button-border-right,  var(--ts-ui-tab-button-border, none))',
        borderBottom: 'var(--ts-ui-tab-button-border-bottom, var(--ts-ui-tab-button-border, none))',
        borderLeft:   'var(--ts-ui-tab-button-border-left,   var(--ts-ui-tab-button-border, none))',
    } },
    { label: 'TabButton borderRadius (suppressed)', resolve: () => new TabButton('x').getBorderRadius(),                expected: null },
    { label: 'MenuBar minSize',              resolve: () => new MenuBar().getMinSizeConstraint(),                       expected: { width: 0, height: 28 } },
    { label: 'Tree overflow',                resolve: () => new Tree().getOverflow(),                                   expected: 'hidden' },
    { label: 'Tree preferredSize (no constraint; height is content-derived)', resolve: () => new Tree().getPreferredSizeConstraint(), expected: null },
    { label: 'Tree maxSize',                 resolve: () => new Tree().getMaxSizeConstraint(),                          expected: { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER } },
    { label: 'Tree rowOverflow',             resolve: () => new Tree().getRowOverflow(),                                expected: 'scroll' },
    { label: 'Tree expandTrigger',           resolve: () => new Tree().getExpandTrigger(),                              expected: 'dblclick' },
    { label: 'TabBar preferredSize',         resolve: () => new TabBar().getPreferredSizeConstraint(),                  expected: { width: 0, height: 30 } },
    // The active theme in the test harness (Modern) has tab.underBorderFullWidth
    // false, so applyUnderBorder()'s early-return branch clears the border —
    // this row pins that pre-existing, theme-driven default, not anything this
    // plan changes (Step 8 only makes the *border* argument options-aware).
    { label: 'TabBar under-border (theme default: cleared)', resolve: () => new TabBar().getBorder(),                    expected: { border: 'none' } },
    { label: 'Checkbox outline',             resolve: () => new Checkbox().getOutline(),                                expected: 'none' },
    { label: 'Checkbox _box cursor',         resolve: () => (new Checkbox() as any)._box.getCursor(),                   expected: 'pointer' },
    { label: 'Checkbox _box backgroundColor', resolve: () => (new Checkbox() as any)._box.getBackgroundColor(),         expected: 'var(--ts-ui-checkbox-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))' },
    { label: 'Checkbox _box border',         resolve: () => (new Checkbox() as any)._box.getBorder(),                   expected: { border: '1px solid var(--ts-ui-form-border, rgb(160, 160, 160))' } },
    { label: 'Checkbox _box borderRadius',   resolve: () => (new Checkbox() as any)._box.getBorderRadius(),             expected: 'var(--ts-ui-checkbox-radius, 3px)' },
    { label: 'Checkbox _check minSize',      resolve: () => (new Checkbox() as any)._check.getMinSizeConstraint(),      expected: { width: 12, height: 12 } },
    { label: 'RadioButton outline',          resolve: () => new RadioButton().getOutline(),                             expected: 'none' },
    { label: 'RadioButton _ring cursor',     resolve: () => (new RadioButton() as any)._ring.getCursor(),               expected: 'pointer' },
    { label: 'RadioButton _ring backgroundColor', resolve: () => (new RadioButton() as any)._ring.getBackgroundColor(), expected: 'var(--ts-ui-radio-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))' },
    { label: 'RadioButton _ring border',     resolve: () => (new RadioButton() as any)._ring.getBorder(),               expected: { border: '1px solid var(--ts-ui-form-border, rgb(160, 160, 160))' } },
    { label: 'RadioButton _ring borderRadius', resolve: () => (new RadioButton() as any)._ring.getBorderRadius(),       expected: '50%' },
    { label: 'RadioButton _dot minSize',     resolve: () => (new RadioButton() as any)._dot.getMinSizeConstraint(),     expected: { width: 8, height: 8 } },
    { label: 'Toggle outline',               resolve: () => new Toggle().getOutline(),                                  expected: 'none' },
    { label: 'ToggleTrack backgroundColor (off)', resolve: () => (new Toggle() as any)._track.getBackgroundColor(),     expected: 'var(--ts-ui-toggle-track-bg-off, rgb(200, 200, 200))' },
    { label: 'ToggleTrack borderRadius',     resolve: () => (new Toggle() as any)._track.getBorderRadius(),             expected: '999px' },
    { label: 'ToggleTrack cursor',           resolve: () => (new Toggle() as any)._track.getCursor(),                   expected: 'pointer' },
    { label: 'ToggleTrack minSize',          resolve: () => (new Toggle() as any)._track.getMinSizeConstraint(),        expected: { width: 36, height: 20 } },
    { label: 'ToggleTrack maxSize',          resolve: () => (new Toggle() as any)._track.getMaxSizeConstraint(),        expected: { width: 36, height: 20 } },
    { label: 'ToggleThumb backgroundColor',  resolve: () => (new Toggle() as any)._thumb.getBackgroundColor(),          expected: 'var(--ts-ui-toggle-thumb-bg, rgb(255, 255, 255))' },
    { label: 'ToggleThumb borderRadius',     resolve: () => (new Toggle() as any)._thumb.getBorderRadius(),             expected: '999px' },
    { label: 'ToggleThumb shadow',           resolve: () => (new Toggle() as any)._thumb.getShadow(),                   expected: '0 1px 2px rgba(0, 0, 0, 0.25)' },
    { label: 'ToggleThumb maxSize',          resolve: () => (new Toggle() as any)._thumb.getMaxSizeConstraint(),        expected: { width: 16, height: 16 } },
    { label: 'Slider outline',               resolve: () => new Slider().getOutline(),                                  expected: 'none' },
    { label: 'Slider cursor',                resolve: () => new Slider().getCursor(),                                   expected: 'pointer' },
    { label: 'SliderTrack backgroundColor',  resolve: () => (new Slider() as any)._track.getBackgroundColor(),          expected: 'var(--ts-ui-slider-track-bg, rgb(220, 220, 220))' },
    { label: 'SliderTrack borderRadius',     resolve: () => (new Slider() as any)._track.getBorderRadius(),             expected: '999px' },
    { label: 'SliderActiveTrack backgroundColor', resolve: () => (new Slider() as any)._activeTrack.getBackgroundColor(), expected: 'var(--ts-ui-slider-track-active-bg, rgb(30, 100, 200))' },
    { label: 'SliderActiveTrack borderRadius', resolve: () => (new Slider() as any)._activeTrack.getBorderRadius(),      expected: '999px' },
    { label: 'SliderThumb backgroundColor',  resolve: () => (new Slider() as any)._thumb.getBackgroundColor(),           expected: 'var(--ts-ui-slider-thumb-bg, rgb(255, 255, 255))' },
    { label: 'SliderThumb borderRadius',     resolve: () => (new Slider() as any)._thumb.getBorderRadius(),              expected: '50%' },
    { label: 'SliderThumb border',           resolve: () => (new Slider() as any)._thumb.getBorder(),                    expected: { border: '1px solid var(--ts-ui-form-border, rgb(160, 160, 160))' } },
    { label: 'SliderThumb shadow',           resolve: () => (new Slider() as any)._thumb.getShadow(),                    expected: '0 1px 2px rgba(0, 0, 0, 0.25)' },
    { label: 'SliderThumb maxSize',          resolve: () => (new Slider() as any)._thumb.getMaxSizeConstraint(),         expected: { width: 16, height: 16 } },
    { label: 'AbstractChart preferredSize (via LineChart)', resolve: () => new LineChart({}).getPreferredSizeConstraint(), expected: { width: 400, height: 300 } },
    { label: 'AbstractChart minSize (via LineChart)', resolve: () => new LineChart({}).getMinSizeConstraint(),          expected: { width: 80, height: 60 } },
    { label: 'StringCell foregroundColor',   resolve: () => new StringCell().getForegroundColor(),                       expected: 'var(--ts-ui-table-cell-color, inherit)' },
    { label: 'StringCell backgroundColor',   resolve: () => new StringCell().getBackgroundColor(),                       expected: 'var(--ts-ui-table-cell-bg, transparent)' },
    { label: 'StringCell border',            resolve: () => new StringCell().getBorder(),                                expected: { border: 'var(--ts-ui-table-cell-border, none)' } },
    { label: 'SelectableText userSelect',    resolve: () => new SelectableText().getUserSelect(),                       expected: 'text' },
    { label: 'SelectableText cursor',        resolve: () => new SelectableText().getCursor(),                           expected: 'text' },
    { label: 'NumberRenderer _text textAlign (default, right)', resolve: () => (new NumberRenderer() as any)._text.getTextAlign(), expected: 'right' },
    { label: 'MarkdownEditor surface userSelect', resolve: () => (new MarkdownEditor() as any)._wysiwyg.getUserSelect(), expected: 'text' },
    { label: 'MarkdownEditor surface cursor', resolve: () => (new MarkdownEditor() as any)._wysiwyg.getCursor(),          expected: 'text' },
    { label: 'Link userSelect',              resolve: () => new Link().getUserSelect(),                                 expected: 'text' },
];

describe('default-resolution registry: a bare construction resolves every class default', () => {
    for (const { label, resolve, expected } of DEFAULT_RESOLUTION) {
        it(label, () => {
            expect(resolve()).toEqual(expected);
        });
    }
});

describe('an explicit value wins over a class default', () => {
    it('BulletedList itemStyle', () => {
        const list = new BulletedList({ itemStyle: BulletedListItemStyle.SQUARE }) as any;
        expect(list.getStyle()).toBe(BulletedListItemStyle.SQUARE);
        expect(list._style).toBe(BulletedListItemStyle.SQUARE); // backed by declare'd _style, not _options
    });

    it('IconText gap', () => {
        const row = new IconText('unicode-arrow-up', 'hi', { gap: 8 }) as any;
        expect(row._options.gap).toBe(8);
        expect((row.getLayoutManager() as HBox).getComponentSpacing()).toBe(8);
    });

    it('default-resolved fields do not pollute the explicit bag (getter-folded fields)', () => {
        const tb = new ToolBar() as any;
        const list = new BulletedList() as any;
        expect(list._options.itemStyle).toBeUndefined();   // resolved via getStyle fold, never stored
        expect(tb._options.backgroundColor).toBeUndefined(); // resolved via getBackgroundColor fold
        expect((new Button('x') as any)._options.backgroundColor).toBeUndefined();
    });

    it('a caller-supplied backgroundColor wins over the fourteen clobbering-bug sites’ hardcoded default', () => {
        expect(new Tree({ backgroundColor: 'red' }).getBackgroundColor()).toBe('red');
        expect(new MenuBar({ backgroundColor: 'red' }).getBackgroundColor()).toBe('red');
        expect(new DiagramNode({ backgroundColor: 'red' }).getBackgroundColor()).toBe('red');
        expect(new DiagramGroupNode({ backgroundColor: 'red' }).getBackgroundColor()).toBe('red');
        expect(new ScrollStrip({ backgroundColor: 'red' }).getBackgroundColor()).toBe('red');
    });

    it('a subclassDefaults bag overrides the class’s own default for the new-bag sites', () => {
        expect(new Tree(undefined, { backgroundColor: 'green' }).getBackgroundColor()).toBe('green');
        expect(new MenuBar(undefined, { backgroundColor: 'green' }).getBackgroundColor()).toBe('green');
        expect(new DiagramGroupNode(undefined, { backgroundColor: 'green' }).getBackgroundColor()).toBe('green');
        expect(new ScrollStrip(undefined, { backgroundColor: 'green' }).getBackgroundColor()).toBe('green');
    });

    it('TabButton backgroundColor/backgroundImage override wins', () => {
        expect(new TabButton('x', { backgroundColor: 'red' }).getBackgroundColor()).toBe('red');
        expect(new TabButton('x', { backgroundImage: 'none' }).getBackgroundImage()).toBe('none');
    });

    it('ToggleButton forwards subclassDefaults through to Button', () => {
        // Both backgroundImage and backgroundColor demonstrate the plumbing:
        // Button's own applyChromeOptions folds `_defaultOptions.backgroundImage`
        // and (since this plan) `_defaultOptions.backgroundColor` the same way,
        // so a subclassDefaults value reaches either field with no further help
        // — no subclass needs to reassert backgroundColor itself any more.
        expect(new ToggleButton('x', undefined, { backgroundImage: 'none' }).getBackgroundImage()).toBe('none');
        expect(new ToggleButton('x', undefined, { backgroundColor: 'blue' }).getBackgroundColor()).toBe('blue');
    });

    it('TabButton default wins the "deepest class wins" conflict against Button\'s own gradient', () => {
        // Button contributes a competing backgroundImage default (a gradient);
        // TabButton's own default must win because it is spread after Button's.
        expect(new TabButton('x').getBackgroundImage()).toBe('var(--ts-ui-tab-button-bg, #b8b8c3)');
    });

    it('a caller-supplied backgroundColor/foregroundColor wins for StatusBar, TabBar, MenuSeparator, SortPriorityBadge, FilterClauseBadge', () => {
        expect(new StatusBar({ backgroundColor: 'red' }).getBackgroundColor()).toBe('red');
        expect(new StatusBar({ foregroundColor: 'blue' }).getForegroundColor()).toBe('blue');
        expect(new TabBar({ backgroundColor: 'red' }).getBackgroundColor()).toBe('red');
        expect(new MenuSeparator(undefined, { backgroundColor: 'red' }).getBackgroundColor()).toBe('red');
        expect(new SortPriorityBadge({ backgroundColor: 'red' }).getBackgroundColor()).toBe('red');
        expect(new SortPriorityBadge({ foregroundColor: 'blue' }).getForegroundColor()).toBe('blue');
        expect(new FilterClauseBadge({ backgroundColor: 'red' }).getBackgroundColor()).toBe('red');
        expect(new FilterClauseBadge({ foregroundColor: 'blue' }).getForegroundColor()).toBe('blue');
    });

    it('a caller-supplied backgroundColor/foregroundColor wins for Scrollbar, ToolBarSeparator, ChartLegend, Popover', () => {
        expect(new Scrollbar('vertical', { backgroundColor: 'red' }).getBackgroundColor()).toBe('red');
        expect(new ToolBarSeparator({ backgroundColor: 'red' }).getBackgroundColor()).toBe('red');
        expect(new ChartLegend({ backgroundColor: 'red' }).getBackgroundColor()).toBe('red');
        expect(new Popover({ backgroundColor: 'red' }).getBackgroundColor()).toBe('red');
        expect(new Popover({ foregroundColor: 'blue' }).getForegroundColor()).toBe('blue');
    });

    it('a caller-supplied touchAction wins for Scrollbar', () => {
        // Render is required to discriminate: Scrollbar's old `init()` override
        // only clobbered the caller value with `setTouchAction("none")` once the
        // element was created, so an unrendered instance passed even against the
        // bug this fix removes.
        const scrollbar = new Scrollbar('vertical', { touchAction: 'pan-y' });
        scrollbar.getElement(true);

        expect(scrollbar.getTouchAction()).toBe('pan-y');
    });

    it('clearTouchAction on Scrollbar suppresses the class default', () => {
        const scrollbar = new Scrollbar();
        scrollbar.clearTouchAction();

        expect(scrollbar.getTouchAction()).toBeNull();
    });

    it('a caller value beats the ScrollingPanel subclass defaults', () => {
        const panel = new ScrollingPanel({
            autoScroll:     'none',
            scrollShadows:  true,
            scrollbarStyle: 'overlay',
        });
        expect(panel.getAutoScroll()).toBe('none');
        expect(panel.getScrollShadows()).toBe(true);
        expect(panel.getScrollbarStyle()).toBe('overlay');
    });

    it('a runtime setAutoScroll call beats both the caller value and the subclass default', () => {
        const panel = new ScrollingPanel();
        panel.setAutoScroll('auto');
        expect(panel.getAutoScroll()).toBe('auto');
        expect(panel.getOverflowY()).toBe('auto');
    });

    it('clearAutoScroll resolves to "none", not back to the subclass default', () => {
        const panel = new ScrollingPanel();
        panel.clearAutoScroll();
        expect(panel.getAutoScroll()).toBe('none');
        expect(panel.getOverflowY()).toBe('hidden');
    });

    it('a subclass default is never dispatched into the _options bag', () => {
        expect((new ScrollingPanel() as any)._options.autoScroll).toBeUndefined();
    });

    // option-setter-clobbering-audit: a caller-supplied value now wins at each
    // of the thirteen sites the sweep fixed, instead of being silently
    // clobbered by a hardcoded constructor-time setter call.
    it('DiagramNode border/borderRadius/cursor overrides win', () => {
        const n = new DiagramNode({ border: '2px dashed red', borderRadius: '10px', cursor: 'grab' });
        expect(n.getBorder()).toEqual({ border: '2px dashed red' });
        expect(n.getBorderRadius()).toBe('10px');
        expect(n.getCursor()).toBe('grab');
    });

    it('DiagramGroupNode cursor/border/borderRadius overrides win', () => {
        const n = new DiagramGroupNode({ cursor: 'grab', border: '2px dashed red', borderRadius: '10px' });
        expect(n.getCursor()).toBe('grab');
        expect(n.getBorder()).toEqual({ border: '2px dashed red' });
        expect(n.getBorderRadius()).toBe('10px');
    });

    it('StatusBar border/minSize/maxSize overrides win', () => {
        const bar = new StatusBar({
            border:  { border: '2px dashed red' },
            minSize: { width: 50, height: 10 },
            maxSize: { width: 500, height: 100 },
        });
        expect(bar.getBorder()).toEqual({ border: '2px dashed red' });
        expect(bar.getMinSizeConstraint()).toEqual({ width: 50, height: 10 });
        expect(bar.getMaxSizeConstraint()).toEqual({ width: 500, height: 100 });
    });

    it('Popover border/borderRadius/shadow overrides win', () => {
        const p = new Popover({ border: { border: '2px dashed red' }, borderRadius: '10px', shadow: 'none' });
        expect(p.getBorder()).toEqual({ border: '2px dashed red' });
        expect(p.getBorderRadius()).toBe('10px');
        expect(p.getShadow()).toBe('none');
    });

    it('TabButton resting border/borderRadius overrides win over the tab token', () => {
        const t = new TabButton('x', { border: '3px solid green', borderRadius: '10px' });
        expect(t.getBorder()).toEqual({ border: '3px solid green' });
        expect(t.getBorderRadius()).toBe('10px');
    });

    it('MenuBar minSize override wins', () => {
        expect(new MenuBar({ minSize: { width: 50, height: 40 } }).getMinSizeConstraint()).toEqual({ width: 50, height: 40 });
    });

    it('Tree overflow/preferredSize/maxSize overrides win', () => {
        const tree = new Tree({ overflow: 'visible', preferredSize: { width: 100, height: 150 }, maxSize: { width: 500, height: 500 } });
        expect(tree.getOverflow()).toBe('visible');
        expect(tree.getPreferredSizeConstraint()).toEqual({ width: 100, height: 150 });
        expect(tree.getMaxSizeConstraint()).toEqual({ width: 500, height: 500 });
    });

    it('TabBar preferredSize override wins, and border override wins at construction', () => {
        const bar = new TabBar({ preferredSize: { width: 10, height: 40 }, border: { border: '1px solid red' } });
        expect(bar.getPreferredSizeConstraint()).toEqual({ width: 10, height: 40 });
        expect(bar.getBorder()).toEqual({ border: '1px solid red' });
    });

    it('Checkbox/RadioButton/Toggle/Slider outline overrides win', () => {
        expect(new Checkbox({ outline: '2px solid blue' }).getOutline()).toBe('2px solid blue');
        expect(new RadioButton(undefined, { outline: '2px solid blue' }).getOutline()).toBe('2px solid blue');
        expect(new Toggle({ outline: '2px solid blue' }).getOutline()).toBe('2px solid blue');
        expect(new Slider({ outline: '2px solid blue' }).getOutline()).toBe('2px solid blue');
    });

    it('Slider cursor override wins', () => {
        expect(new Slider({ cursor: 'grab' }).getCursor()).toBe('grab');
    });

    it('AbstractChart preferredSize/minSize overrides win (via LineChart)', () => {
        const chart = new LineChart({ preferredSize: { width: 600, height: 400 }, minSize: { width: 100, height: 100 } });
        expect(chart.getPreferredSizeConstraint()).toEqual({ width: 600, height: 400 });
        expect(chart.getMinSizeConstraint()).toEqual({ width: 100, height: 100 });
    });

    it('a subclassDefaults bag overrides the class default for the four new-bag sites', () => {
        expect(new Checkbox(undefined, { outline: 'green' } as any).getOutline()).toBe('green');
        expect(new RadioButton(undefined, undefined, { outline: 'green' } as any).getOutline()).toBe('green');
        expect(new Toggle(undefined, { outline: 'green' } as any).getOutline()).toBe('green');
        expect(new Slider(undefined, { outline: 'green', cursor: 'grab' } as any).getOutline()).toBe('green');
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

    it('clearUserSelect suppresses the base userSelect default even when never set', () => {
        const c = new Component({});
        expect(c.getUserSelect()).toBe('none');
        c.clearUserSelect();
        expect(c.getUserSelect()).toBeNull();
    });

    it('a never-cleared component still resolves its default, explicit value wins', () => {
        expect(new Component({}).getCursor()).toBe('default');
        expect(new Component({ cursor: 'pointer' }).getCursor()).toBe('pointer');
    });
});
