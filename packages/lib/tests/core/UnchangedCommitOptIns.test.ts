// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage for stage 2 of the unchanged-commit layout skip: `Panel` (the class
 * itself, not its subclasses), `LabeledGrid`, `Header` — and so `WindowHeader`
 * — and `StatusBar` opt in, and every placement input that changes how a
 * subtree is placed without scheduling a pass now marks one as owed. Case
 * numbers E1 to E12 refer to `## Expected Behaviour` in
 * `plans/implemented/unchanged-commit-opt-ins.md`; E13 lives in
 * `UnchangedCommitSkip.test.ts` (case 13) and E14 is in-engine only.
 *
 * E1 to E8 pin the change. E9 to E12 pin what must *stay* true once it lands:
 * each opted-in class's own writers still lay it out, and a web-font swap
 * still re-measures through the skip. They pass before the change too, which
 * is the point — they are the regression half of the suite.
 *
 * `afterEach` disposes every root the case built and restores `ModernTheme`,
 * because `ThemeManager.setTheme` fires every listener still registered in the
 * process (see `TextThemeReflow.test.ts` for why that makes theme cases
 * uniquely sensitive to cross-test pollution).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Panel } from '~/core/Panel';
import { Form } from '~/core/Form';
import { Border } from '~/layout/Border';
import { Fit } from '~/layout/Fit';
import { Grid } from '~/layout/Grid';
import { Split } from '~/layout/Split';
import { HBox } from '~/layout/HBox';
import { VBox } from '~/layout/VBox';
import { BoxLayout } from '~/layout/BoxLayout';
import { HFlow } from '~/layout/HFlow';
import { LayoutManager } from '~/layout/LayoutManager';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { FillType } from '~/layout/FillType';
import { AnchorType } from '~/layout/AnchorType';
import { Header } from '~/component/display/Header';
import { StatusBar } from '~/component/container/StatusBar';
import { LabeledGrid } from '~/component/container/LabeledGrid';
import { LabeledFieldSet } from '~/component/container/LabeledFieldSet';
import { WindowHeader } from '~/component/container/WindowHeader';
import { ScrollStrip } from '~/component/container/ScrollStrip';
import { Text } from '~/component/input/Text';
import { TextField } from '~/component/input/TextField';
import { Insets } from '~/primitive/Insets';
import { Placement } from '~/primitive/Placement';
import { DOM } from '~/core/DOM';
import { ThemeManager, ModernTheme } from '~/core/Theme';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

/** E2's scene box — large enough that no clamp in it bites. */
const SCENE_WIDTH  = 800;
const SCENE_HEIGHT = 600;

/** E4/E5's root box, and the leaves' preferred size. */
const ROOT_WIDTH   = 400;
const ROOT_HEIGHT  = 200;
const LEAF_WIDTH   = 100;
const LEAF_HEIGHT  = 20;

/** E5's padding and border, each thick enough to move or shrink by a visible amount. */
const PADDING_PX = 10;
const BORDER_PX  = 5;

/** E7's geometry row: a spacing wide enough to separate it from E4's stacked leaves. */
const PROBE_SPACING = 10;

/** E2's scene, as the plan counts it: root, both bars, the panel and its form. */
const SCENE_COMPONENTS = 13;

/** E2: the root's `Border` commits its three regions and nothing else recurses. */
const SKIPPED_SCENE_COMMITS = 3;

/**
 * Builds a config whose baked font table is a private deep copy, so E12 can
 * widen the advances mid-run (modelling the real face swapping in) without
 * mutating the shared JSON module every other suite reads. Copied from
 * `tests/component/tree/TreeFontReflow.test.ts`.
 *
 * @returns The modelled-DOM config.
 */
function makeConfig() {
    return {
        rootMountOffset: { x: 0, y: 0 },
        viewport:        { width: 1280, height: 800 },
        scrollBarWidth:  15,
        fontMetrics:     structuredClone(fontMetrics),
        themeVars:       {},
    };
}

/**
 * Doubles every per-character advance in the (cloned) baked font table, the
 * way a real face swapping in widens every measured label.
 *
 * @param config - The config whose cloned table to widen.
 */
function widenFont(config: ReturnType<typeof makeConfig>): void {
    for (const font of Object.values(config.fontMetrics.fonts) as Array<{ advance: Record<string, number> }>) {
        for (const ch of Object.keys(font.advance)) {
            font.advance[ch] *= 2;
        }
    }
}

let frames: FrameRequestCallback[] = [];
let roots: Component[] = [];

/**
 * Installs the modelled DOM with a frame-capturing `requestAnimationFrame`.
 * The offline sink never runs a frame of its own, so every scheduled pass in
 * this file is driven explicitly through {@link flushFrame}.
 *
 * @param config - Optional config; the shared font table by default.
 */
function install(config: ReturnType<typeof makeConfig> = makeConfig()): void {
    installTestDOM(config);

    frames = [];
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);

        return frames.length;
    });
}

/** Runs every captured frame callback, including any a callback re-queues. */
function flushFrame(): void {
    for (let guard = 0; guard < 10 && frames.length > 0; guard += 1) {
        const pending = frames;

        frames = [];

        for (const cb of pending) {
            cb(0);
        }
    }
}

/**
 * Records a root for disposal in `afterEach`.
 *
 * @param root - The root to track.
 * @returns The same root.
 */
function track<T extends Component>(root: T): T {
    roots.push(root);

    return root;
}

/** Every component in a subtree, the root included, in pre-order. */
function flatten(component: Component): Component[] {
    return [component, ...component.getComponents().flatMap(flatten)];
}

/**
 * A component's *visual* left edge: a size-stable move commits through the
 * translate fast path, which leaves `getX()` at its old value, so every
 * position this file asserts on folds the leftover translate back in.
 *
 * @param component - The component to read.
 * @returns The visual x.
 */
function visualX(component: Component): number {
    return component.getX() + component.getTranslateX();
}

/**
 * A component's *visual* top edge — {@link visualX}'s other axis.
 *
 * @param component - The component to read.
 * @returns The visual y.
 */
function visualY(component: Component): number {
    return component.getY() + component.getTranslateY();
}

/**
 * Every component's visual rectangle in a subtree, as one string, so a
 * fast-path move and a slow-path move to the same place read the same.
 *
 * @param component - The subtree root.
 * @returns The joined `x,y,width,height` of every component.
 */
function geometryOf(component: Component): string {
    return flatten(component)
        .map(c => `${visualX(c)},${visualY(c)},${c.getWidth()},${c.getHeight()}`)
        .join('|');
}

/**
 * Stubs the four new opt-ins off, so a case can run its scene the way it ran
 * before this plan — the "plain" arm. `Text` and `TextField` are on the list
 * too, although they are stage 3's opt-ins and not this plan's: this file's
 * scenes hold two `TextField`s and a `Text`, so leaving them opted in would
 * make this a partial arm rather than the no-skip comparison the cases read it
 * as.
 */
function plainArm(): void {
    for (const prototype of [Panel.prototype, LabeledGrid.prototype, Header.prototype, StatusBar.prototype,
        Text.prototype, TextField.prototype]) {
        vi.spyOn(prototype as any, 'canSkipUnchangedLayout').mockReturnValue(false);
    }
}

/**
 * A `placement` constraint for a `Border` region.
 *
 * @param value - The region slot.
 * @returns The constraint.
 */
function placement(value: Placement): LayoutConstraints {
    return Object.assign(new LayoutConstraints(), { placement: value, collapsible: false });
}

/** E2's scene: the four opted-in classes around a two-field form. */
interface Scene {
    root:      Container;
    header:    Header;
    panel:     Panel;
    grid:      LabeledGrid;
    statusBar: StatusBar;
}

/**
 * E2's scene — a `Border` root holding a `Header` north, a `Panel` of a
 * two-field `LabeledGrid` and a `Text` centre, and a `StatusBar` south.
 *
 * @returns The scene's root and the four opted-in components in it.
 */
function makeScene(): Scene {
    const root      = track(new Container({ layoutManager: new Border({ spacing: 0 }) }));
    const header    = new Header('Title');
    const panel     = new Panel({ layoutManager: new VBox() });
    const grid      = new LabeledGrid({ columns: 1 });
    const statusBar = new StatusBar({ defaultMessage: 'Ready' });

    root.getElement(true);
    root.clearInsets();
    root.setWidth(SCENE_WIDTH);
    root.setHeight(SCENE_HEIGHT);

    grid.addField('Name', new TextField());
    grid.addField('City', new TextField());

    panel.addComponent(grid);
    panel.addComponent(new Text('Notes'));

    root.addComponent(header,    placement(Placement.NORTH));
    root.addComponent(panel,     placement(Placement.CENTER));
    root.addComponent(statusBar, placement(Placement.SOUTH));

    return { root, header, panel, grid, statusBar };
}

/** E4's scene: an opted-in `Panel` stacking two leaves under a `Fit` root. */
interface StackScene {
    root:  Container;
    panel: Panel;
    box:   BoxLayout;
    a:     Component;
    b:     Component;
}

/**
 * E4's scene — a `VBox` `Panel` of two equal leaves, filled by a `Fit` root,
 * laid out once so it is settled.
 *
 * @returns The root, the panel, its box and the two leaves.
 */
function makeStackScene(): StackScene {
    const root  = track(new Container({ layoutManager: new Fit() }));
    const box   = new VBox({ spacing: 0 });
    const panel = new Panel({ layoutManager: box });
    const a     = new Component({ preferredSize: { width: LEAF_WIDTH, height: LEAF_HEIGHT } });
    const b     = new Component({ preferredSize: { width: LEAF_WIDTH, height: LEAF_HEIGHT } });

    root.getElement(true);
    root.clearInsets();
    root.setWidth(ROOT_WIDTH);
    root.setHeight(ROOT_HEIGHT);

    panel.clearInsets();
    a.getElement(true);
    b.getElement(true);
    panel.addComponent(a);
    panel.addComponent(b);
    root.addComponent(panel);

    root.doLayout();
    flushFrame();
    root.doLayout();
    flushFrame();

    return { root, panel, box, a, b };
}

/**
 * E5's border scene — a `Fit` `Panel` over one leaf, so the leaf's box is the
 * panel's content box and a border visibly shrinks it.
 *
 * @returns The root, the panel and the leaf.
 */
function makeFittedScene(): { root: Container; panel: Panel; leaf: Component } {
    const root  = track(new Container({ layoutManager: new Fit() }));
    const panel = new Panel({ layoutManager: new Fit() });
    const leaf  = new Component({ preferredSize: { width: LEAF_WIDTH, height: LEAF_HEIGHT } });

    root.getElement(true);
    root.clearInsets();
    root.setWidth(ROOT_WIDTH);
    root.setHeight(ROOT_HEIGHT);

    panel.clearInsets();
    leaf.getElement(true);
    panel.addComponent(leaf);
    root.addComponent(panel);

    root.doLayout();
    flushFrame();
    root.doLayout();
    flushFrame();

    return { root, panel, leaf };
}

/**
 * A rendered, settled container laid out by the given manager over its leaves
 * — E7's probe host.
 *
 * @param manager - The manager under test.
 * @param children - How many leaves the host holds; `Fit` takes exactly one.
 * @returns The container and its children.
 */
function makeManagerHost(manager: LayoutManager, children = 2): { host: Container; panes: Component[] } {
    const host  = track(new Container({ layoutManager: manager }));
    const panes = Array.from(
        { length: children },
        () => new Component({ preferredSize: { width: LEAF_WIDTH, height: LEAF_HEIGHT } }),
    );

    host.getElement(true);
    host.clearInsets();
    host.setWidth(ROOT_WIDTH);
    host.setHeight(ROOT_HEIGHT);

    for (const pane of panes) {
        pane.getElement(true);
        host.addComponent(pane);
    }

    host.doLayout();
    flushFrame();
    host.doLayout();
    flushFrame();

    return { host, panes };
}

afterEach(() => {
    flushFrame();

    for (const root of roots) {
        root.dispose();
    }

    roots = [];
    (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
    // Theme state is module-level; restore it even if an assertion above threw
    // — and before `DOM.reset()`, because the restore itself goes through the
    // sink the modelled DOM installed.
    ThemeManager.setTheme(ModernTheme);
    vi.restoreAllMocks();
    DOM.reset();
});

describe('Who opts in (E1)', () => {
    it.each([
        ['a plain Panel',   () => new Panel({ layoutManager: new VBox() }), true],
        ['a LabeledGrid',   () => new LabeledGrid(),                        true],
        ['a Header',        () => new Header('T'),                          true],
        ['a WindowHeader',  () => new WindowHeader('T'),                    true],
        ['a StatusBar',     () => new StatusBar(),                          true],
        ['a Form',          () => new Form(),                               false],
        ['a ScrollStrip',   () => new ScrollStrip(),                        false],
        ['a consumer Panel subclass', () => new (class LocalPanel extends Panel {})(), false],
        ['a LabeledFieldSet',         () => new LabeledFieldSet(),          false],
    ] as const)('answers %s with %s', (_label, build, expected) => {
        install();

        const component = track(build() as Component);

        component.getElement(true);
        component.doLayout();
        flushFrame();

        expect(component.canSkipUnchangedCommit()).toBe(expected);
    });
});

describe('A settled repeat pass stops at the four classes (E2)', () => {
    it('makes three commits, all skipped, and lays out only the root', () => {
        install();

        const { root, header, panel, statusBar } = makeScene();

        root.doLayout();
        flushFrame();

        const first    = geometryOf(root);
        const commits  = vi.spyOn(LayoutManager.prototype as any, 'commitBounds');
        const layouts  = vi.spyOn(Component.prototype, 'doLayout');

        root.doLayout();

        expect(flatten(root)).toHaveLength(SCENE_COMPONENTS);
        expect(commits).toHaveBeenCalledTimes(SKIPPED_SCENE_COMMITS);
        expect(layouts.mock.contexts).toEqual([root]);
        expect(header.canSkipUnchangedCommit()).toBe(true);
        expect(panel.canSkipUnchangedCommit()).toBe(true);
        expect(statusBar.canSkipUnchangedCommit()).toBe(true);
        expect(geometryOf(root)).toBe(first);
    });

    it('commits and lays out every component with the opt-ins off, at the same rectangles', () => {
        install();
        plainArm();

        const { root } = makeScene();

        root.doLayout();
        flushFrame();

        const first   = geometryOf(root);
        const commits = vi.spyOn(LayoutManager.prototype as any, 'commitBounds');
        const layouts = vi.spyOn(Component.prototype, 'doLayout');

        root.doLayout();

        expect(commits).toHaveBeenCalledTimes(SCENE_COMPONENTS - 1);
        expect(layouts).toHaveBeenCalledTimes(SCENE_COMPONENTS);
        expect(geometryOf(root)).toBe(first);
    });
});

describe('A pass owed below still runs (E3)', () => {
    it('lays out the panel and the grid, leaving the header and status bar skipped', () => {
        install();

        const { root, header, panel, grid, statusBar } = makeScene();

        root.doLayout();
        flushFrame();

        grid.invalidateLayout();

        const panelLayout  = vi.spyOn(panel, 'doLayout');
        const gridLayout   = vi.spyOn(grid, 'doLayout');
        const headerLayout = vi.spyOn(header, 'doLayout');
        const statusLayout = vi.spyOn(statusBar, 'doLayout');

        root.doLayout();

        expect(panelLayout).toHaveBeenCalled();
        expect(gridLayout).toHaveBeenCalled();
        expect(headerLayout).not.toHaveBeenCalled();
        expect(statusLayout).not.toHaveBeenCalled();
    });
});

describe('setDisplayed marks the parent (E4)', () => {
    it('re-places the surviving leaf when a sibling leaves the laid-out children', () => {
        install();

        const { root, panel, a, b } = makeStackScene();

        expect(visualY(b)).toBe(LEAF_HEIGHT);

        a.setDisplayed(false);

        expect(panel.canSkipUnchangedCommit()).toBe(false);

        root.doLayout();

        expect(visualY(b)).toBe(0);
    });

    it('marks nothing on a same-value call, and re-places again when the leaf returns', () => {
        install();

        const { root, panel, a, b } = makeStackScene();

        a.setDisplayed(false);
        root.doLayout();
        flushFrame();
        root.doLayout();
        flushFrame();

        a.setDisplayed(false);

        expect(panel.canSkipUnchangedCommit()).toBe(true);

        root.doLayout();

        expect(visualY(b)).toBe(0);

        a.setDisplayed(true);

        expect(panel.canSkipUnchangedCommit()).toBe(false);

        root.doLayout();

        expect(visualY(b)).toBe(LEAF_HEIGHT);
    });
});

describe('Padding and border mark the owner (E5)', () => {
    it('offsets the children after a padding write, and marks nothing on a repeat', () => {
        install();

        const { root, panel, a, b } = makeStackScene();

        panel.setPadding(new Insets(PADDING_PX, PADDING_PX, PADDING_PX, PADDING_PX));

        expect(panel.isLayoutDirty()).toBe(true);

        root.doLayout();
        flushFrame();

        expect(visualX(a)).toBe(PADDING_PX);
        expect(visualY(a)).toBe(PADDING_PX);
        expect(visualX(b)).toBe(PADDING_PX);
        expect(visualY(b)).toBe(PADDING_PX + LEAF_HEIGHT);

        root.doLayout();
        flushFrame();
        panel.setPadding(new Insets(PADDING_PX, PADDING_PX, PADDING_PX, PADDING_PX));

        expect(panel.isLayoutDirty()).toBe(false);
    });

    it('returns the children to the content origin after clearPadding, and marks nothing on a repeat', () => {
        install();

        const { root, panel, a } = makeStackScene();

        panel.setPadding(new Insets(PADDING_PX, PADDING_PX, PADDING_PX, PADDING_PX));
        root.doLayout();
        flushFrame();
        root.doLayout();
        flushFrame();

        panel.clearPadding();

        expect(panel.isLayoutDirty()).toBe(true);

        root.doLayout();
        flushFrame();

        expect(visualX(a)).toBe(0);
        expect(visualY(a)).toBe(0);

        root.doLayout();
        flushFrame();
        panel.clearPadding();

        expect(panel.isLayoutDirty()).toBe(false);
    });

    it('shrinks the content box after a border write, restores it on clearBorder, and marks nothing on a repeat', () => {
        install();

        const { root, panel, leaf } = makeFittedScene();

        expect(leaf.getWidth()).toBe(ROOT_WIDTH);
        expect(leaf.getHeight()).toBe(ROOT_HEIGHT);

        panel.setBorder(`${BORDER_PX}px solid red`);

        expect(panel.isLayoutDirty()).toBe(true);

        root.doLayout();
        flushFrame();

        expect(leaf.getWidth()).toBe(ROOT_WIDTH - 2 * BORDER_PX);
        expect(leaf.getHeight()).toBe(ROOT_HEIGHT - 2 * BORDER_PX);

        root.doLayout();
        flushFrame();
        panel.clearBorder();

        expect(panel.isLayoutDirty()).toBe(true);

        root.doLayout();
        flushFrame();

        expect(leaf.getWidth()).toBe(ROOT_WIDTH);
        expect(leaf.getHeight()).toBe(ROOT_HEIGHT);

        root.doLayout();
        flushFrame();
        panel.clearBorder();

        expect(panel.isLayoutDirty()).toBe(false);
    });
});

describe('removeAllComponents marks (E6)', () => {
    it('leaves the emptied container owing a pass', () => {
        install();

        const { root, panel } = makeStackScene();

        expect(panel.isLayoutDirty()).toBe(false);

        panel.removeAllComponents();

        expect(panel.isLayoutDirty()).toBe(true);

        root.doLayout();
        flushFrame();
    });
});

/**
 * E7's table: one row per layout-manager setter the plan closes — a label, a
 * factory for the manager, a write of a value other than the manager's
 * current one, and how many children the probe host holds (`Fit` takes
 * exactly one).
 */
const MANAGER_SETTERS: ReadonlyArray<readonly [string, () => LayoutManager, (manager: any, panes: Component[]) => void, number]> = [
    ['BoxLayout.setComponentSpacing', () => new VBox(),        m => m.setComponentSpacing(PROBE_SPACING), 2],
    ['BoxLayout.setItemAlign',        () => new VBox(),        m => m.setItemAlign('center'), 2],
    ['BoxLayout.setMode',             () => new VBox(),        m => m.setMode('equal'), 2],
    ['BoxLayout.setOverflowSizing',   () => new VBox(),        m => m.setOverflowSizing('min'), 2],
    ['BoxLayout.setJustify',          () => new VBox(),        m => m.setJustify('center'), 2],
    ['FlowLayout.setComponentSpacing', () => new HFlow(), m => m.setComponentSpacing(PROBE_SPACING), 2],
    ['FlowLayout.setLineSpacing',      () => new HFlow(), m => m.setLineSpacing(PROBE_SPACING), 2],
    ['FlowLayout.setUniform',          () => new HFlow(), m => m.setUniform('both'), 2],
    ['FlowLayout.setAlign',            () => new HFlow(), m => m.setAlign('center'), 2],
    ['FlowLayout.setItemAlign',        () => new HFlow(), m => m.setItemAlign('center'), 2],
    ['FlowLayout.setJustify',          () => new HFlow(), m => m.setJustify('between'), 2],
    ['Grid.setDefaultFill',    () => new Grid({ columns: 1 }), m => m.setDefaultFill(FillType.BOTH), 2],
    ['Grid.setDefaultAnchor',  () => new Grid({ columns: 1 }), m => m.setDefaultAnchor(AnchorType.CENTER), 2],
    ['Grid.setBaselineAlign',  () => new Grid({ columns: 1 }), m => m.setBaselineAlign(true), 2],
    ['Grid.setRows',           () => new Grid({ columns: 1 }), m => m.setRows(2), 2],
    ['Grid.setComponentSpacing', () => new Grid({ columns: 1 }), m => m.setComponentSpacing(PROBE_SPACING), 2],
    ['Grid.setColumns',        () => new Grid({ columns: 1 }), m => m.setColumns(2), 2],
    ['Grid.setColumnTracks',   () => new Grid({ columns: 1 }), m => m.setColumnTracks([{ mode: 'fixed', value: LEAF_WIDTH }]), 2],
    ['Grid.setRowTracks',      () => new Grid({ columns: 1 }), m => m.setRowTracks([{ mode: 'fixed', value: LEAF_HEIGHT }]), 2],
    ['Fit.setFill',            () => new Fit(),                m => m.setFill(FillType.NONE), 1],
    ['Border.setComponentSpacing', () => new Border(),         m => m.setComponentSpacing(PROBE_SPACING), 2],
    ['Split.setOrientation',   () => new Split({ orientation: 'horizontal' }), m => m.setOrientation('vertical'), 2],
    ['Split.setPaneSize',      () => new Split({ orientation: 'horizontal' }), (m, panes) => m.setPaneSize(panes[0], LEAF_WIDTH * 2), 2],
];

describe('Every listed manager setter marks its container (E7)', () => {
    it.each(MANAGER_SETTERS)('%s', (_label, build, write, children) => {
        install();

        const { host, panes } = makeManagerHost(build(), children);

        expect(host.isLayoutDirty()).toBe(false);

        write(host.getLayoutManager(), panes);

        expect(host.isLayoutDirty()).toBe(true);
    });

    it('re-places the children after a spacing change on an opted-in panel', () => {
        install();

        const { root, box, b } = makeStackScene();

        expect(visualY(b)).toBe(LEAF_HEIGHT);

        box.setComponentSpacing(PROBE_SPACING);
        root.doLayout();

        expect(visualY(b)).toBe(LEAF_HEIGHT + PROBE_SPACING);
    });
});

describe('Panel\'s scroll setters mark (E8)', () => {
    it.each([
        ['setScrollShadows',  (panel: Panel) => panel.setScrollShadows(false)],
        ['setScrollbarStyle', (panel: Panel) => panel.setScrollbarStyle('native')],
    ] as const)('%s leaves the panel owing a pass', (_label, write) => {
        install();

        const { root, panel } = makeStackScene();

        expect(panel.isLayoutDirty()).toBe(false);

        write(panel);

        expect(panel.isLayoutDirty()).toBe(true);

        root.doLayout();
        flushFrame();
    });

    // `setAutoScroll` is the one scroll setter whose write can answer itself:
    // when the mode change flips a scrollable axis, the manager's
    // `setOverflowing` lays the panel out on the spot and clears the mark it
    // was just given. The mark is what carries the mode changes that leave the
    // axes alone — `"auto"` and `"both"` are both x + y — where nothing else
    // would notice that the panel now reserves a permanent gutter.
    it('lays the panel out when the mode flips a scrollable axis', () => {
        install();

        const { root, panel } = makeStackScene();
        const layout = vi.spyOn(panel, 'doLayout');

        panel.setAutoScroll('both');

        expect(layout).toHaveBeenCalled();
        expect(panel.isLayoutDirty()).toBe(false);

        root.doLayout();
        flushFrame();
    });

    it('leaves the panel owing a pass when the mode leaves the axes alone', () => {
        install();

        const { root, panel } = makeStackScene();

        panel.setAutoScroll('auto');
        root.doLayout();
        flushFrame();
        root.doLayout();
        flushFrame();

        expect(panel.isLayoutDirty()).toBe(false);

        panel.setAutoScroll('both');

        expect(panel.isLayoutDirty()).toBe(true);

        root.doLayout();
        flushFrame();
    });
});

describe('Header and WindowHeader writers still lay out (E9)', () => {
    it('widens the header label after a text change', () => {
        install();

        const { root, header } = makeScene();

        root.doLayout();
        flushFrame();

        const before = header.getText().getWidth();

        header.getText().setText('A much longer title');
        flushFrame();

        expect(header.getText().getWidth()).toBeGreaterThan(before);
    });

    it('places a title glyph and moves the title right by at least its width', () => {
        install();

        const root   = track(new Container({ layoutManager: new Fit() }));
        const header = new WindowHeader('T');

        root.getElement(true);
        root.clearInsets();
        root.setWidth(ROOT_WIDTH);
        root.setHeight(ROOT_HEIGHT);
        root.addComponent(header);

        // The constructor installs a default title glyph, so the glyph-free
        // baseline this case measures against is reached by clearing it first.
        header.clearGlyph();
        root.doLayout();
        flushFrame();
        root.doLayout();
        flushFrame();

        const titleX = visualX(header.getText());

        header.setGlyph('xmark');
        flushFrame();

        // The glyph is inserted ahead of the title in the header's title row.
        const titleRow = header.getText().getParentComponent()!;
        const glyph    = titleRow.getComponents().find(c => c !== header.getText())!;

        expect(glyph).toBeDefined();
        expect(glyph.getWidth()).toBeGreaterThan(0);
        expect(visualX(header.getText())).toBeGreaterThanOrEqual(titleX + glyph.getWidth());
    });
});

describe('StatusBar writers still lay out (E10)', () => {
    it('widens the message text after a message change', () => {
        install();

        const { root, statusBar } = makeScene();

        root.doLayout();
        flushFrame();

        const message = statusBar.getComponents()[0];
        const before  = message.getWidth();

        statusBar.setMessage('Saved 42 files');
        flushFrame();

        expect(message.getWidth()).toBeGreaterThan(before);
    });

    it('places a widget added on the right beyond the message', () => {
        install();

        const { root, statusBar } = makeScene();

        root.doLayout();
        flushFrame();

        const message = statusBar.getComponents()[0];
        const widget  = new Text('Ln 1');

        statusBar.addRight(widget);
        flushFrame();

        expect(widget.getWidth()).toBeGreaterThan(0);
        expect(visualX(widget)).toBeGreaterThan(visualX(message) + message.getWidth());
    });
});

describe('LabeledGrid.addField still lays out (E11)', () => {
    it('places the new field below the last one', () => {
        install();

        const { root, grid } = makeScene();

        root.doLayout();
        flushFrame();

        const cityField = grid.getComponents()[3];
        const zipField  = new TextField();

        grid.addField('Zip', zipField);
        flushFrame();

        expect(visualY(zipField)).toBeGreaterThan(visualY(cityField));
    });
});

describe('A web-font swap re-measures through the skip (E12)', () => {
    it('lands every rectangle where the plain arm lands it, and moves at least one', () => {
        const swapped = (plain: boolean): { geometry: string; before: string } => {
            const config = makeConfig();

            install(config);

            if (plain) {
                plainArm();
            }

            const { root } = makeScene();

            root.doLayout();
            flushFrame();
            root.doLayout();
            flushFrame();

            const before = geometryOf(root);

            widenFont(config);
            ThemeManager.setTheme(ThemeManager.getTheme());
            flushFrame();
            root.doLayout();
            flushFrame();

            return { geometry: geometryOf(root), before };
        };

        const optedIn = swapped(false);

        for (const root of roots) {
            root.dispose();
        }

        roots = [];
        vi.restoreAllMocks();
        DOM.reset();

        const plain = swapped(true);

        expect(optedIn.geometry).toBe(plain.geometry);
        expect(optedIn.geometry).not.toBe(optedIn.before);
    });
});
