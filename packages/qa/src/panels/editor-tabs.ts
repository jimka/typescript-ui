import { Panel } from '@jimka/typescript-ui/core';
import type { Component } from '@jimka/typescript-ui/core';
import { TabPanel } from '@jimka/typescript-ui/component/container';
import { CodeEditor } from '@jimka/typescript-ui/component/editor';
import { Split } from '@jimka/typescript-ui/layout';
import { codeDocument } from '../builders/data.js';
import { elementFor, requireElement } from '../builders/dom.js';
import { THEME_CYCLE, themeTarget } from '../pageTargets.js';
import type { HarnessTools, ThemeTarget } from '../harness/types.js';
import type { PanelBuild } from '../panels.js';

/** The panel's id, for errors. */
const PANEL = 'editor-tabs';

/** Lines per editor: several screens, as `builders/shell.ts` uses. */
const EDITOR_LINES = 300;

/** Frames each tab is left shown for, so CodeMirror mounts its view before the next tab hides it. */
const SHOW_FRAMES = 2;

/** The class CodeMirror puts on a focused view: the one difference between two editors that is expected, and not a theme's. */
const FOCUS_CLASS = 'cm-focused';

export const description = 'A Split of one always-visible CodeEditor — the reference — beside a TabPanel of n editors (default 8) of 300 lines each. Its afterMount shows every tab once, so every editor mounts a CodeMirror view, then returns to tab 0; a hidden tab is undisplayed rather than disposed, so the hidden editors keep their views. Built for G25, which read `unreached` on both shells because a tab never shown holds no view to withhold a theme reconfigure from. It reproduces no outside behaviour and has no recorded figure.';

/** 8 tabs: seven hidden editors per theme switch, one lap of shows over a 14-unit phase. */
export const defaultScale = 8;

/** One lap of shows and checks over a two-theme cycle, then a settled trailing phase. */
export const defaultDrive = 'theme:14,idle:4';

/** The editors and the tab strip the theme target drives, and the class list the reference carried at mount. */
interface Parts {
    /** The always-visible editor every check compares against. */
    reference: Component;
    /** One editor per tab, in tab order. */
    editors: Component[];
    /** The tab group holding `editors`. */
    tabbed: Component;
    /** The reference editor's `.cm-editor` class list under the mount theme; the `theme.indistinct` guard compares against it. */
    mountClasses: string;
    /** The tab the panel last selected; the work counters read it rather than the strip. */
    selected: number;
}

/**
 * An editor's `.cm-editor` class list, sorted and without {@link FOCUS_CLASS},
 * as one string. CodeMirror puts its light/dark style-module classes there, so
 * this is what tells an editor that took a theme reconfigure from one that did
 * not — every colour `codeEditorTheme` writes is either a `var(--ts-ui-…)`
 * reference the browser re-resolves for every editor the moment `ThemeManager`
 * writes the document element, or one of the fixed syntax colours, which are
 * the same in both modes, so a computed colour could not.
 *
 * @param tools - The harness tools.
 * @param editor - The editor.
 * @returns The class list, sorted and space-joined.
 * @throws Error - `editor-tabs: no element matches .cm-editor` when the editor has mounted no view.
 */
function editorClasses(tools: HarnessTools, editor: Component): string {
    const view = requireElement(elementFor(tools, editor, PANEL), '.cm-editor', PANEL);

    return [...view.classList].filter((name) => name !== FOCUS_CLASS).sort().join(' ');
}

/**
 * Selects tab `index` and records it, so the work counters can tell the shown
 * editor from the hidden ones.
 *
 * @param parts - The panel's parts.
 * @param index - The tab to show.
 */
function showTab(parts: Parts, index: number): void {
    (parts.tabbed as unknown as { getTab(): { setActiveTabIndex(i: number): unknown } }).getTab().setActiveTabIndex(index);
    parts.selected = index;
}

/**
 * Checks the editor of the tab shown on the previous unit against the
 * reference, which was never hidden: the two class lists must be equal, since
 * the page has been on one theme since before the tab came back.
 *
 * `theme.indistinct` says the switch left no trace in the reference's own class
 * list, so that unit's check could not have failed whatever the arm did — the
 * guard for the day CodeMirror stops carrying the theme there.
 *
 * @param tools - The harness tools.
 * @param parts - The panel's parts.
 * @param index - The tab shown on the previous unit.
 */
function checkShownTab(tools: HarnessTools, parts: Parts, index: number): void {
    const reference = editorClasses(tools, parts.reference);

    tools.bumpWork(editorClasses(tools, parts.editors[index]) === reference ? 'theme.match' : 'theme.mismatch');

    if (reference === parts.mountClasses) {
        tools.bumpWork('theme.indistinct');
    }
}

/**
 * The panel's `theme` target: `themeTarget(THEME_CYCLE)`, with each unit of
 * one lap also showing the next tab or checking the one shown before it.
 *
 * An even unit switches the theme and *then* shows tab `index / 2 + 1`, so the
 * editor coming back was hidden when the switch went out; the odd unit after it
 * checks that editor *before* switching back, which is the only moment a
 * withheld reconfigure is observable. Each tab is shown exactly once, so the
 * theme it carries when shown is always the mount theme and every show lands on
 * a `DarkTheme` unit — an editor that was never caught up is always
 * distinguishable from one that was. Units past the lap keep switching without
 * showing anything, which lets the phase be lengthened for timing without
 * weakening the check.
 *
 * @param tools - The harness tools.
 * @param parts - The panel's parts.
 * @param n - Tabs.
 * @returns The target; its `restore()` restores the theme and selects tab 0.
 */
function tabThemeTarget(tools: HarnessTools, parts: Parts, n: number): ThemeTarget {
    const base = themeTarget(THEME_CYCLE);

    return {
        cycle: (index: number): void => {
            const tab = Math.floor(index / 2) + 1;
            const shows = index % 2 === 0;
            const inLap = tab <= n - 1;

            if (inLap && !shows) {
                checkShownTab(tools, parts, tab);
            }

            base.cycle(index);

            if (inLap && shows) {
                showTab(parts, tab);
            }
        },
        restore: (): void => {
            base.restore();
            showTab(parts, 0);
        },
    };
}

/**
 * Tallies every theme reconfigure one tab's editor is asked for as
 * `theme.shown` or `theme.hidden`, by whether its tab is the selected one when
 * the ask arrives. `theme.hidden` is the population `g25.theme-withhold` could
 * skip, which is what an `unreached` verdict needs to be read against.
 *
 * @param tools - The harness tools.
 * @param parts - The panel's parts.
 * @param index - The editor's tab index.
 * @returns `counting theme.hidden/shown for tab <index>`.
 */
function countTabTheme(tools: HarnessTools, parts: Parts, index: number): string {
    const host = parts.editors[index] as unknown as Record<string, unknown>;
    const original = host.onThemeChange as (this: unknown) => unknown;

    host.onThemeChange = function countedTabTheme(this: unknown): unknown {
        tools.bumpWork(parts.selected === index ? 'theme.shown' : 'theme.hidden');

        return original.call(this);
    };

    return `counting theme.hidden/shown for tab ${index}`;
}

/**
 * Installs the editors' theme counters, prototype counter first.
 *
 * The order matters: an instance wrapper resolves `onThemeChange` through the
 * prototype chain at the moment it installs, so a wrapper put on a tab editor
 * before `countMethod` had replaced the prototype method would hold the
 * unwrapped original, and `onThemeChange@CodeEditor` would miss every tab
 * editor — the very count the cell scores the arm on.
 *
 * @param tools - The harness tools.
 * @param parts - The panel's parts.
 * @returns One note per counter.
 */
function installThemeCounters(tools: HarnessTools, parts: Parts): string[] {
    const notes = [tools.countMethod(parts.reference, 'onThemeChange')];

    parts.editors.forEach((_editor, index) => notes.push(countTabTheme(tools, parts, index)));

    return notes;
}

/**
 * Shows every tab once, so each editor mounts a CodeMirror view, then comes
 * back to tab 0 and records the reference's class list under the mount theme.
 *
 * @param tools - The harness tools.
 * @param parts - The panel's parts.
 * @param root - The panel's root, laid out after each selection.
 * @param n - Tabs.
 */
async function mountEveryView(tools: HarnessTools, parts: Parts, root: Component, n: number): Promise<void> {
    for (let k = 0; k < n; k++) {
        showTab(parts, k);
        root.doLayout();
        await tools.waitFrames(SHOW_FRAMES);
    }

    showTab(parts, 0);
    await tools.waitFrames(SHOW_FRAMES);

    parts.mountClasses = editorClasses(tools, parts.reference);
}

/**
 * Builds a reference editor beside a tab group of `n` editors.
 *
 * @param n - Tabs, one `CodeEditor` each.
 * @returns The split as root, target of `passes` and `resize`; and `afterMount`, which mounts every tab's view and gives `theme` the panel's own target.
 */
export function build(n: number): PanelBuild {
    const reference = CodeEditor(codeDocument(EDITOR_LINES), { language: 'javascript' });
    const editors = Array.from({ length: n }, () => CodeEditor(codeDocument(EDITOR_LINES), { language: 'javascript' }));
    const tabbed = TabPanel({ tabs: editors.map((component, k) => ({ label: `file${k}.ts`, component })) });

    const root = Panel({
        layoutManager: Split({ orientation: 'horizontal' }),
        components: [
            { component: reference, constraints: { weight: 1 } },
            { component: tabbed, constraints: { weight: 1 } },
        ],
    });

    const parts: Parts = { reference, editors, tabbed, mountClasses: '', selected: 0 };

    return {
        root,
        targets: { passes: root, resize: root },
        afterMount: async (tools: HarnessTools): Promise<Record<string, unknown>> => {
            await mountEveryView(tools, parts, root, n);

            return { theme: tabThemeTarget(tools, parts, n) };
        },
        // `tabbed` and `reference` hold a box in every unit. The two editor
        // labels do not: `Tab.doLayout` undisplays every inactive page, an
        // undisplayed element resolves to `display: none`, and the probe reads
        // its rectangle as `[0, 0, 0, 0]` rather than `null` — so each of them
        // gates only the phases its own tab is shown in. `editorLast` holds a
        // box from the unit that shows its tab until `restore()`, which is the
        // window in which a withheld reconfigure is caught up, so that is the
        // layout worth gating; `editor0` is the other way round — zero for the
        // whole theme phase, and real again in the trailing settled phase,
        // which `restore()` returns to tab 0, the phase `[^settled-gate]` takes
        // the soundness verdict from. Every run of the cell shows the same tab
        // on the same unit, so the two series have the same shape in every arm
        // and no label moves with a scroll offset: a DIFF still means the arm.
        geometry: { tabbed, reference, editor0: editors[0], editorLast: editors[n - 1] },
        describe: () => ({
            tabs: n,
            lines: EDITOR_LINES,
            // The premise of the cell: `n + 1` says every hidden tab still
            // holds a view for `g25.theme-withhold` to withhold from.
            editorViews: document.getElementById(root.getId())?.querySelectorAll('.cm-editor').length ?? 0,
        }),
        installWork: (tools: HarnessTools): string[] => installThemeCounters(tools, parts),
    };
}
