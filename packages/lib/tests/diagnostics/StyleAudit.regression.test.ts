// @vitest-environment jsdom
//
// Live-gallery regression ratchet for the stylesheet-dedup audit
// (plans/in-progress/style-audit-ci-ratchet.md). Unlike StyleAudit.test.ts,
// which exercises `auditStyleRules()`'s own mechanism (grouping, sorting, the
// 25-row cap) against synthetic `StyleRule` fixtures, this file mounts a
// broad gallery of real framework components and asserts the live duplicate
// count does not exceed a checked-in ceiling — catching any future change
// that reintroduces per-instance CSS that should live at the class or state
// tier instead. Kept in its own file because Vitest isolates each test
// file's module graph by default, so the gallery's ~100 real component
// instances can't pollute StyleAudit.test.ts's exact-count assertions (see
// the plan's "Kept in a separate file" architecture decision).
//
// Table's body virtualizer does not render rows under plain jsdom (a
// worktree probe confirmed the header renders but zero Row/Cell descendants
// appear under TableBody, evidently gated on a real-DOM measurement jsdom
// reports as zero) — see the plan's "Table row-body virtualization is not
// exercised" architecture decision. Table is therefore included for
// header-only coverage; body-level Cell coverage instead comes from two
// standalone StringCell instances, and real row-pool duplication coverage
// comes from a List, which does fully populate its row pool under jsdom.
import { describe, it, expect } from 'vitest';
import { Component } from '~/core/Component';
import { Panel } from '~/core/Panel';
import { VBox } from '~/layout/VBox';
import { LayerManager } from '~/core/LayerManager';
import { auditStyleRules } from '~/diagnostics/StyleAudit';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { Table } from '~/component/table/Table';
import { List } from '~/component/list/List';
import { StringCell } from '~/component/table/cell/String';
import { TextField } from '~/component/input/TextField';
import { ToolBar } from '~/component/menubar/ToolBar';
import { Tree } from '~/component/tree/Tree';
import { MenuBar } from '~/component/menubar/MenuBar';
import { DiagramNode } from '~/component/diagram/DiagramNode';
import { DiagramGroupNode } from '~/component/diagram/DiagramGroupNode';
import { ScrollStrip } from '~/component/container/ScrollStrip';
import { Button } from '~/component/button/Button';
import { TabButton } from '~/component/button/TabButton';
import { MenuBarButton } from '~/component/menubar/MenuBarButton';
import { TabCloseButton } from '~/component/button/TabCloseButton';
import { PickerButton } from '~/component/input/PickerButton';
import { ToggleButton } from '~/component/button/ToggleButton';
import { StatusBar } from '~/component/container/StatusBar';
import { TabBar } from '~/component/container/TabBar';
import { MenuSeparator } from '~/component/container/MenuSeparator';
import { SortPriorityBadge } from '~/component/table/cell/SortPriorityBadge';
import { FilterClauseBadge } from '~/component/table/cell/FilterClauseBadge';
import { Scrollbar } from '~/component/container/Scrollbar';
import { ResizeHandle } from '~/component/table/cell/ResizeHandle';
import { ComboBox } from '~/component/input/ComboBox';
import { HeaderCell } from '~/component/table/cell/Header';
import { ParentHeaderCell } from '~/component/table/cell/ParentHeader';
import { ToolBarSeparator } from '~/component/menubar/ToolBarSeparator';
import { ChartLegend } from '~/component/chart/ChartLegend';
import { Popover } from '~/overlay/Popover';
import { SplitGutter } from '~/component/container/SplitGutter';
import { BulletedList } from '~/component/list/BulletedList';
import { ListItem } from '~/component/list/ListItem';
import { NumberedList } from '~/component/list/NumberedList';
import { IconText } from '~/component/display/IconText';
import { Glyph } from '~/component/display/Glyph';
import { Drawer } from '~/overlay/Drawer';
import { AnimatedDropdown } from '~/core/AnimatedDropdown';
import { LineChart } from '~/component/chart/LineChart';
import { BarChart } from '~/component/chart/BarChart';
import { DiagramView } from '~/component/diagram/DiagramView';
import { FloatingPanel } from '~/component/container/FloatingPanel';
import { MarkdownMinimap } from '~/component/display/MarkdownMinimap';
import { MarkdownViewer } from '~/component/display/MarkdownViewer';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { Link } from '~/component/input/Link';
import { Checkbox } from '~/component/input/Checkbox';
import { RadioButton } from '~/component/input/RadioButton';
import { Toggle } from '~/component/input/Toggle';
import { Slider } from '~/component/input/Slider';
import { AutoCompleteField } from '~/component/input/AutoCompleteField';
import { NumberEditor } from '~/component/table/cell/editor/Number';
import { PopupPanel } from '~/overlay/PopupPanel';
import { NotificationHistoryButton } from '~/overlay/NotificationHistoryButton';
import { NumberRenderer } from '~/component/table/cell/renderer/Number';

const NOOP = (): void => {};

// Ratchet ceiling for the live-gallery duplicate count (see the plan's "The
// ceiling is a single hand-edited constant" architecture decision). Lower
// this number in the same PR that fixes a dedup root cause. Raise it ONLY
// with a comment here explaining why (e.g. a new component structurally
// can't yet share class-tier CSS) — never raise it just to make a failing
// test pass without first reading the audit's own duplicate rows for a
// fixable cause.
//
// This is `summary.componentRuleCount - summary.uniqueBodyCount`, not
// `duplicates.length` as the plan's Internal Structure snippet originally
// specified — `auditStyleRules()` caps the `duplicates` array it returns to
// its top 25 rows (`MAX_ROWS` in StyleAudit.ts), so `duplicates.length` is
// pinned at 25 the moment real duplication reaches that many groups, which
// this gallery already does (36 real duplicate-body groups today). Asserting
// on the capped length would make the ceiling check pass unconditionally
// regardless of how much duplication exists, defeating the point of a
// regression ratchet. `componentRuleCount - uniqueBodyCount` (every #id rule
// beyond the first instance of each distinct declaration body) comes from
// `StyleAuditResult.summary`, is not capped, and grows or shrinks exactly
// with real duplication — see the plan's `## Implementation Notes` for the
// full account of this deviation. Derived from a real run of this file
// against this worktree's own code (see the plan's Step 4); not carried
// over from any other plan or document.
// Raised from 68 to 69 by plans/split-accordion-panel-scroll-convergence.md's
// SplitGutter `.opaque` migration: `_expandedBackground` (a genuine per-caller
// value — Border passes "transparent", others can override it — so it stays
// a per-instance `setBackgroundColor` call, not a class-tier default) now
// shares a property key with the new `.opaque` `ownStyleStates` bag, so
// `isRestingChromeIsolated` isolates it onto its own `#id:not(.opaque)` rule
// instead of folding it into the same `#id` write as `applyCursor`'s
// direction-derived cursor. The gallery's two identically-configured
// (`'horizontal'`, default `expandedBackground`) SplitGutter instances still
// produce the exact same one redundant pair either way — splitting a
// previously-combined body into two separately-tracked ones just doubles how
// many *groups* record that one redundant pair, not the underlying
// duplication. Not a fixable dedup regression: this is the new class/state
// tier machinery doing its job.
const STYLE_AUDIT_DUPLICATE_CEILING = 69;

// One factory per gallery class. Each constructor call is copied verbatim
// from an existing, already-passing call in default-options-fallback.test.ts.
const GALLERY_FACTORIES: Array<() => Component> = [
    () => new TextField(),
    // NumberSpinner removed: its layout pass calls getBaseline() ->
    // Util.measureTextBaseline(), which needs a canvas 2D context that jsdom
    // doesn't implement without the optional `canvas` npm package.
    () => new ToolBar(),
    () => new Tree(),
    () => new MenuBar(),
    () => new DiagramNode(),
    () => new DiagramGroupNode(),
    () => new ScrollStrip(),
    () => new Button('x'),
    () => new TabButton('x'),
    () => new MenuBarButton('File', NOOP, NOOP),
    () => new TabCloseButton(),
    () => new PickerButton(),
    () => new ToggleButton('x'),
    () => new StatusBar(),
    () => new TabBar(),
    () => new MenuSeparator(),
    () => new SortPriorityBadge(),
    () => new FilterClauseBadge(),
    () => new Scrollbar(),
    () => new ResizeHandle(),
    () => new ComboBox(),
    () => new HeaderCell('Name', 'name'),
    () => new ParentHeaderCell('Group', null),
    () => new ToolBarSeparator(),
    () => new ChartLegend(),
    () => new Popover(),
    () => new SplitGutter('horizontal'),
    () => new BulletedList(),
    () => new ListItem('k', 'v'),
    () => new NumberedList(),
    () => new IconText('unicode-arrow-up', 'x'),
    () => new Glyph('unicode-arrow-up'),
    () => new Drawer(),
    () => new AnimatedDropdown(),
    () => new LineChart({}),
    () => new BarChart({}),
    () => new DiagramView(),
    () => new FloatingPanel({}),
    () => new MarkdownMinimap({}),
    () => new MarkdownViewer({}),
    () => new MarkdownEditor(),
    () => new Link(),
    () => new Checkbox(),
    () => new RadioButton(),
    () => new Toggle(),
    () => new Slider(),
    () => new AutoCompleteField(),
    () => new NumberEditor(),
    () => new PopupPanel(),
    () => new NotificationHistoryButton(),
    () => new NumberRenderer(),
];

function buildGallery(): Component {
    const root = new Panel({ layoutManager: new VBox() });
    root.setWidth(1200);
    root.setHeight(6000);

    for (const build of GALLERY_FACTORIES) {
        root.addComponent(build());
        root.addComponent(build());
    }

    // Table: header-only coverage (see the probe-evidence footnote in the plan).
    const model = new Model([{ name: 'a', type: 'string' }, { name: 'b', type: 'string' }]);
    const store = new MemoryStore({ model, data: [{ a: '1', b: '2' }], autoLoad: true });
    root.addComponent(Table(store));

    // List: real row-pool duplication coverage.
    const list = List({ items: ['a', 'b', 'c'] });
    list.setWidth(400);
    list.setHeight(200);
    root.addComponent(list);

    // Standalone body-Cell coverage (Table's own body virtualizer doesn't
    // render under jsdom — see the probe-evidence footnote in the plan).
    root.addComponent(new StringCell());
    root.addComponent(new StringCell());

    return root;
}

describe('auditStyleRules — live gallery regression ratchet', () => {
    it('the live gallery has no more duplicate style rules than the checked-in ceiling', () => {
        const root = buildGallery();

        LayerManager.mount(root.getElement(true)!);
        root.flushLayout();

        const { summary } = auditStyleRules();
        const redundantRuleCount = summary.componentRuleCount - summary.uniqueBodyCount;

        expect(redundantRuleCount).toBeLessThanOrEqual(STYLE_AUDIT_DUPLICATE_CEILING);

        root.dispose();
    });
});
