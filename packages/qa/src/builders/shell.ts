// The application shell `shell-deep` and `shell-shallow` share: an explorer
// `Accordion` beside a `Dock` of code editors, under a menu bar and a toolbar,
// over a status bar. It is shaped after Loom's S1 and S3 scenarios so a later
// Loom plan can baseline against it, but built from the library's own
// components over generated content, so its numbers do not match Loom's
// history. The two depths differ only in the dock: two rows of two regions,
// or one region.

import { Panel } from '@jimka/typescript-ui/core';
import type { Component } from '@jimka/typescript-ui/core';
import type { StatusBar } from '@jimka/typescript-ui/component/container';
import { Header } from '@jimka/typescript-ui/component/display';
import { CodeEditor } from '@jimka/typescript-ui/component/editor';
import type { CodeEditorCursorPosition } from '@jimka/typescript-ui/component/editor';
import { List } from '@jimka/typescript-ui/component/list';
import { Tree } from '@jimka/typescript-ui/component/tree';
import { Accordion, AccordionConstraints, Border, Split } from '@jimka/typescript-ui/layout';
import { Dock } from '@jimka/typescript-ui/overlay';
import type { DockLayoutSpec, DockPanelSpec } from '@jimka/typescript-ui/overlay';
import { Placement } from '@jimka/typescript-ui/primitive';
import type { CallTarget, HarnessTools } from '../harness/types.js';
import type { PanelBuild } from '../panels.js';
import { appMenuBar, appStatusBar, appToolBar, fileTreeRenderer } from './chrome.js';
import { codeDocument, folderNodes, outlineLabels } from './data.js';
import { childGutter, dockGutter, elementFor, firstPainted, requireElement } from './dom.js';
import { choice } from './params.js';
import { TYPE_TEXT } from './shared.js';
import { countInstance } from './work.js';

/** A shell's depth: a 2×2 dock grid (S1's shape) or a single dock region (S3's). */
export type ShellDepth = 'deep' | 'shallow';

/** The gutters `drag` can take, per depth; the first is the default, the gutter each Loom scenario drags. */
const GRIPS = {
    deep: ['dock-h', 'dock-v', 'sidebar', 'section', 'tab'],
    shallow: ['sidebar', 'section'],
} as const;

/** What `hover` can sweep, per depth; the shallow shell's single region has no tab strip worth sweeping. */
const HOVERS = {
    deep: ['toolbar', 'menubar', 'tabs'],
    shallow: ['toolbar', 'menubar'],
} as const;

/** What `wheel` can scroll: the file tree (Loom's wheel target) or the first painted editor. */
const WHEELS = ['tree', 'editor'] as const;

/** What `toggle` flips: the closed History section, or the sidebar pane's collapse. */
const TOGGLES = ['section', 'pane'] as const;

/** Dock rows and columns in the deep shell: Loom's `grid=2x2`. */
const DEEP_ROWS = 2;
const DEEP_COLUMNS = 2;

/** The sidebar's minimum width: the clamp `park` pushes against. */
const SIDEBAR_MIN_PX = 160;

/** The sidebar's preferred width, where it starts: a typical explorer's. */
const SIDEBAR_PREFERRED_PX = 280;

/** The sidebar's preferred height: any value works, since the split fills the viewport; this one is a typical screen's. */
const SIDEBAR_PREFERRED_HEIGHT_PX = 600;

/** How far past the sidebar's minimum `park`'s lead-in drags, so every measured unit is past the clamp. */
const PARK_OVERSHOOT_PX = 40;

/** Folders in the open Files tree: 240 nodes, a tree that scrolls. */
const FILE_TREE_FOLDERS = 40;

/** Entries in the open Outline list: a list that scrolls. */
const OUTLINE_ITEMS = 60;

/** Folders in the closed History tree: content the closed section is still measured over. */
const HISTORY_FOLDERS = 20;

/** Lines per editor: several screens, so an editor scrolls. */
const EDITOR_LINES = 300;

/** Index of the History section, the closed one, in the explorer. */
const HISTORY_SECTION = 2;

/** Index of the sidebar pane in the explorer split. */
const SIDEBAR_PANE = 0;

/**
 * Units between two toggles: each 200 ms collapse animation (Accordion's and
 * CollapseSupport's) is about 12 frames at 60 Hz, so 30 lets it, and its
 * settle, finish before the next toggle, and a phase measures whole animations.
 */
const TOGGLE_PERIOD_UNITS = 30;

/** The status bar `showCursor` writes to: the mounted shell's. A page mounts one panel. */
let cursorStatus: StatusBar | null = null;

/**
 * Shows the caret's position in the status bar, as an editor's status
 * readout does on every cursor move. Every editor of the shell registers it.
 *
 * @param position - The caret's position.
 */
function showCursor(position: CodeEditorCursorPosition): void {
    cursorStatus?.setMessage(`Ln ${position.line}, Col ${position.column}`);
}

/**
 * One editor page: a header over a `CodeEditor`.
 *
 * @param r - The dock region's index.
 * @param t - The tab's index in its region.
 * @returns The page, its editor and its header.
 */
function page(r: number, t: number): { page: Component; editor: Component; header: Component } {
    const editor = CodeEditor(codeDocument(EDITOR_LINES), { language: 'javascript', listeners: { cursorchange: showCursor } });
    const header = Header(`src/file${r}.${t}.ts`);

    const content = Panel({
        layoutManager: Border(),
        components: [
            { component: header, constraints: { placement: Placement.NORTH } },
            { component: editor, constraints: { placement: Placement.CENTER } },
        ],
    });

    return { page: content, editor, header };
}

/**
 * One dock region's tabs: `n` editor pages.
 *
 * @param r - The region's index.
 * @param n - Tabs in the region.
 * @param editors - Collects each region's first editor, for geometry.
 * @param headers - Collects each region's first page header, for geometry.
 * @returns The region's layout spec.
 */
function region(r: number, n: number, editors: Component[], headers: Component[]): { tabs: DockPanelSpec[] } {
    const tabs = Array.from({ length: n }, (_, t) => {
        const built = page(r, t);

        if (t === 0) {
            editors.push(built.editor);
            headers.push(built.header);
        }

        return { id: `file-${r}-${t}`, title: `file${r}.${t}.ts`, closeable: false, disposeOnClose: false, content: built.page };
    });

    return { tabs };
}

/**
 * The dock's layout: two rows of two regions, or one region.
 *
 * @param depth - The shell's depth.
 * @param n - Tabs per region.
 * @param editors - Collects each region's first editor.
 * @param headers - Collects each region's first page header.
 * @returns The layout spec.
 */
function dockLayout(depth: ShellDepth, n: number, editors: Component[], headers: Component[]): DockLayoutSpec {
    if (depth === 'shallow') {
        return region(0, n, editors, headers);
    }

    const rows = Array.from({ length: DEEP_ROWS }, (_, row) => ({
        split: 'horizontal' as const,
        children: Array.from({ length: DEEP_COLUMNS }, (_, column) => region(row * DEEP_COLUMNS + column, n, editors, headers)),
    }));

    return { split: 'vertical', children: rows };
}

/** The explorer: its sidebar pane, the accordion laying it out, and its three sections. */
interface Explorer {
    sidebar: Component;
    accordion: Accordion;
    files: Tree;
    outline: Component;
    history: Component;
}

/**
 * The explorer sidebar: an open file tree, an open outline list and a closed
 * history tree, in a resizable accordion.
 *
 * @returns The explorer's parts.
 */
function explorer(): Explorer {
    const files = Tree();

    files.setRendererFactory(fileTreeRenderer);
    files.setNodes(folderNodes(FILE_TREE_FOLDERS));
    files.expandAll();

    const outline = List({ items: outlineLabels(OUTLINE_ITEMS) });
    const history = Tree();

    history.setNodes(folderNodes(HISTORY_FOLDERS));

    const accordion = Accordion({ resizable: true, fillHeight: true });

    const sidebar = Panel({
        layoutManager: accordion,
        minSize: { width: SIDEBAR_MIN_PX, height: 0 },
        preferredSize: { width: SIDEBAR_PREFERRED_PX, height: SIDEBAR_PREFERRED_HEIGHT_PX },
        components: [
            { component: files, constraints: new AccordionConstraints('Files', true) },
            { component: outline, constraints: new AccordionConstraints('Outline', true) },
            { component: history, constraints: new AccordionConstraints('History', false) },
        ],
    });

    return { sidebar, accordion, files, outline, history };
}

/**
 * The `toggle` target: every `TOGGLE_PERIOD_UNITS` units, flips the History
 * section open or closed, or the sidebar pane collapsed or expanded.
 *
 * @param mode - What to flip.
 * @param accordion - The explorer's accordion.
 * @param split - The explorer split.
 * @returns The target.
 */
function toggleTarget(mode: typeof TOGGLES[number], accordion: Accordion, split: Split): CallTarget {
    return function toggleEvery(index: number): void {
        if (index % TOGGLE_PERIOD_UNITS !== 0) {
            return;
        }

        if (mode === 'pane') {
            split.setPaneCollapsed(SIDEBAR_PANE, !split.isPaneCollapsed(SIDEBAR_PANE));
        } else if (accordion.isSectionOpen(HISTORY_SECTION)) {
            accordion.closeSection(HISTORY_SECTION);
        } else {
            accordion.openSection(HISTORY_SECTION);
        }
    };
}

/** The parts of a built shell its targets are found in. */
interface ShellParts {
    depth: ShellDepth;
    params: URLSearchParams;
    panel: string;
    center: Component;
    explorer: Explorer;
    menuBar: Component;
    toolBar: Component;
    dock: Component;
}

/**
 * The `drag` target for the `grip=` parameter.
 *
 * @param tools - The harness tools.
 * @param parts - The shell's parts.
 * @param dockElement - The dock's element.
 * @returns `{ element, axis }`.
 */
function dragTarget(tools: HarnessTools, parts: ShellParts, dockElement: HTMLElement): { element: HTMLElement; axis: 'x' | 'y' } {
    const grip = choice(parts.params, 'grip', GRIPS[parts.depth], parts.panel);

    switch (grip) {
        case 'dock-h':
            return { element: dockGutter(dockElement, 'dock-h', parts.panel), axis: 'y' };
        case 'dock-v':
            return { element: dockGutter(dockElement, 'dock-v', parts.panel), axis: 'x' };
        case 'sidebar':
            return { element: childGutter(tools, parts.center, parts.panel), axis: 'x' };
        case 'section':
            return { element: childGutter(tools, parts.explorer.sidebar, parts.panel), axis: 'y' };
        case 'tab':
            return { element: requireElement(dockElement, '.TabButton', parts.panel), axis: 'x' };
    }
}

/**
 * The `hover` target for the `hover=` parameter.
 *
 * @param tools - The harness tools.
 * @param parts - The shell's parts.
 * @param dockElement - The dock's element.
 * @returns `{ element, axis }`.
 */
function hoverTarget(tools: HarnessTools, parts: ShellParts, dockElement: HTMLElement): { element: HTMLElement; axis: 'x' } {
    const hover = choice(parts.params, 'hover', HOVERS[parts.depth], parts.panel);

    switch (hover) {
        case 'toolbar':
            return { element: elementFor(tools, parts.toolBar, parts.panel), axis: 'x' };
        case 'menubar':
            return { element: elementFor(tools, parts.menuBar, parts.panel), axis: 'x' };
        case 'tabs':
            return { element: requireElement(dockElement, '.TabBar', parts.panel), axis: 'x' };
    }
}

/**
 * The targets that need the mounted page: the parameters are read, and every
 * element looked up, only once the shell has laid out.
 *
 * @param tools - The harness tools.
 * @param parts - The shell's parts.
 * @returns `drag`, `park`, `hover`, `wheel` and `type`.
 */
function mountedTargets(tools: HarnessTools, parts: ShellParts): Record<string, unknown> {
    const dockElement = elementFor(tools, parts.dock, parts.panel);
    const drag = dragTarget(tools, parts, dockElement);
    const hover = hoverTarget(tools, parts, dockElement);
    const wheelOn = choice(parts.params, 'wheel', WHEELS, parts.panel);

    return {
        drag,
        hover,
        park: { element: childGutter(tools, parts.center, parts.panel), axis: 'x', direction: -1, leadPx: SIDEBAR_PREFERRED_PX - SIDEBAR_MIN_PX + PARK_OVERSHOOT_PX },
        wheel: wheelOn === 'tree' ? elementFor(tools, parts.explorer.files, parts.panel) : firstPainted(tools, dockElement, '.cm-scroller', parts.panel),
        type: { element: firstPainted(tools, dockElement, '.cm-content', parts.panel), text: TYPE_TEXT },
    };
}

/**
 * Builds a shell: a menu bar, the explorer beside a dock of editors under a
 * toolbar, and a status bar.
 *
 * @param n - Tabs per dock region.
 * @param depth - A 2×2 dock grid or a single region.
 * @param params - The page's URL parameters: `toggle=` here, `grip=`, `hover=` and `wheel=` once mounted.
 * @param panel - The panel's id, for errors.
 * @returns The shell's build.
 * @throws Error - For an unknown `toggle=` value.
 */
export function buildShell(n: number, depth: ShellDepth, params: URLSearchParams, panel: string): PanelBuild {
    const toggleMode = choice(params, 'toggle', TOGGLES, panel);
    const parts = explorer();
    const editors: Component[] = [];
    const headers: Component[] = [];
    const split = Split({ orientation: 'horizontal' });
    const menuBar = appMenuBar();
    const toolBar = appToolBar();
    const status = appStatusBar();
    const dock = Dock({ layout: dockLayout(depth, n, editors, headers) });

    const main = Panel({
        layoutManager: Border(),
        components: [
            { component: toolBar, constraints: { placement: Placement.NORTH } },
            { component: dock, constraints: { placement: Placement.CENTER } },
        ],
    });

    const center = Panel({
        layoutManager: split,
        components: [
            { component: parts.sidebar, constraints: { weight: 0 } },
            { component: main, constraints: { weight: 1 } },
        ],
    });

    const root = Panel({
        layoutManager: Border(),
        components: [
            { component: menuBar, constraints: { placement: Placement.NORTH } },
            { component: center, constraints: { placement: Placement.CENTER } },
            { component: status, constraints: { placement: Placement.SOUTH } },
        ],
    });

    const shell: ShellParts = { depth, params, panel, center, explorer: parts, menuBar, toolBar, dock };
    const geometry: Record<string, Component> = { sidebar: parts.sidebar, files: parts.files, outline: parts.outline, history: parts.history, main, dock, header0: headers[0], status };

    editors.forEach((editor, k) => {
        geometry[`editor${k}`] = editor;
    });

    cursorStatus = status;

    return {
        root,
        targets: { resize: root, passes: root, toggle: toggleTarget(toggleMode, parts.accordion, split) },
        afterMount: (tools: HarnessTools): Record<string, unknown> => mountedTargets(tools, shell),
        geometry,
        describe: () => ({
            regions: editors.length,
            editors: editors.length * n,
            editorViews: document.querySelectorAll('.cm-editor').length,
            fileNodes: parts.files.getNodes().reduce((sum, node) => sum + 1 + (node.children?.length ?? 0), 0),
            outlineItems: OUTLINE_ITEMS,
        }),
        installWork: (tools: HarnessTools): string[] => [
            countInstance(tools, parts.sidebar, 'doLayout', 'sidebar.doLayout'),
            countInstance(tools, main, 'doLayout', 'main.doLayout'),
            countInstance(tools, parts.history, 'doLayout', 'history.doLayout'),
            countInstance(tools, parts.history, 'getPreferredSize', 'history.getPreferredSize'),
            tools.countMethod(editors[0], 'onThemeChange'),
        ],
    };
}
