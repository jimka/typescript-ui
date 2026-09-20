import { Tree } from '@jimka/typescript-ui/component/tree';
import { fileTreeRenderer } from '../builders/chrome.js';
import { folderNodes } from '../builders/data.js';
import { elementFor } from '../builders/dom.js';
import type { HarnessTools } from '../harness/types.js';
import type { PanelBuild } from '../panels.js';

/** The panel's id, for errors. */
const PANEL = 'tree-nodes';

export const description = 'Tree of n folders of 5 files each (default 300: 1,800 nodes), fully expanded, with the explorer\'s icon renderer. Reproduces slice 18 F18.6 (Tree.doLayout re-renders the row window unconditionally, sweeping the pool\'s selection style twice): setStyleState@TreeRow = 2 × the row pool per unchanged pass; and F18.4 (every caret and icon change rebuilds a Glyph): 1.5 ensureStyleRule, setRuleStyles and deleteStyleRule per keyboard toggle.';

/** 300 folders: 1,800 nodes, a tree that virtualises and scrolls. */
export const defaultScale = 300;

/** Collapsing and expanding the first folder from the keyboard, the path F18.4 names. */
export const defaultDrive = 'key';

/**
 * Builds a fully expanded `Tree` of `n` folders.
 *
 * @param n - Folders.
 * @returns The tree as root, target of `passes` and `resize`; `afterMount` selects the first folder and gives `key` (ArrowLeft collapses it, ArrowRight expands it) and `wheel` the tree's element.
 */
export function build(n: number): PanelBuild {
    const nodes = folderNodes(n);
    const tree = Tree();

    tree.setRendererFactory(fileTreeRenderer);
    tree.setNodes(nodes);
    tree.expandAll();

    return {
        root: tree,
        targets: { passes: tree, resize: tree },
        afterMount: (tools: HarnessTools): Record<string, unknown> => {
            tree.selectNode(nodes[0]);

            const element = elementFor(tools, tree, PANEL);

            return { key: { element, keys: ['ArrowLeft', 'ArrowRight'] }, wheel: element };
        },
        geometry: { tree },
        describe: () => ({
            nodes: nodes.reduce((sum, node) => sum + 1 + (node.children?.length ?? 0), 0),
            treeRows: document.getElementById(tree.getId())?.querySelectorAll('.TreeRow').length ?? 0,
        }),
        installWork: (tools: HarnessTools): string[] => [tools.countMethod(tree, 'setStyleState', 'setStyleState', true)],
    };
}
