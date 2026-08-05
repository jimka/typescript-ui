// @vitest-environment jsdom
//
// DocsSidebar constructs library components (Panel, TextField, Tree), whose
// bundled module evaluates a top-level `Body` singleton that reads
// `document` at import time — same reason DocsMinimap.test.ts needs a real
// DOM. This package has no access to packages/lib's modelled DOM test
// harness (installTestDOM), which is test-only and not published, so this
// exercises the real thing through jsdom instead, mirroring
// DocsMinimap.test.ts's own harness.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Body, Event } from '@jimka/typescript-ui/core';
import { Fit } from '@jimka/typescript-ui/layout';
import { Router } from '@jimka/typescript-ui/router';
import type { TextField } from '@jimka/typescript-ui/component/input';
import type { Tree, TreeNode } from '@jimka/typescript-ui/component/tree';
import { DocsSidebar } from '../src/shell/DocsSidebar.js';

let router: Router;
let sidebar: DocsSidebar;

/** Finds the first node (depth-first) whose `data` equals `path`, or `undefined`. */
function findNode(nodes: TreeNode[], path: string): TreeNode | undefined {
    for (const node of nodes) {
        if (node.data === path) {
            return node;
        }
        const found = node.children ? findNode(node.children, path) : undefined;
        if (found) {
            return found;
        }
    }
    return undefined;
}

/**
 * Mounts `sidebar` into a real, connected DOM and types `query` into its
 * search field by setting the field's value and firing the real `input`
 * event the field listens for — mirroring how DocsMinimap.test.ts drives a
 * `Link.click()` through the framework's own event plumbing rather than
 * calling a private handler directly.
 */
function type(query: string): void {
    const [searchField] = sidebar.getComponents() as [TextField, Tree];

    searchField.setValue(query);
    Event.fireEvent(searchField, 'input');
}

beforeEach(() => {
    router = new Router();
});

afterEach(() => {
    // Body is a page-level singleton that outlives each test; a sidebar
    // mounted into it via Body.init's `components` option (pure append, no
    // replace — see Component.applyOptions) must be detached before dispose,
    // or the next test's Body.init call finds two children under a Fit()
    // that only ever accepts one.
    Body.getInstance().removeComponent(sidebar);
    sidebar.dispose();
});

describe('DocsSidebar', () => {
    it('adds the search field and the tree, in that order', () => {
        sidebar = new DocsSidebar(router);

        const components = sidebar.getComponents();

        expect(components).toHaveLength(2);
        expect(components[1]).toBe((sidebar as unknown as { _tree: Tree })._tree);
    });

    it('filters to a page matching the query in its title, dropping a non-matching sibling', () => {
        sidebar = new DocsSidebar(router);
        const body = Body.init({ layoutManager: Fit(), components: [sidebar] });
        body.flushLayout();

        type('install');
        body.flushLayout();

        const [, tree] = sidebar.getComponents() as [TextField, Tree];
        const guide = tree.getNodes().find((n) => n.data === '/guide');

        expect(guide).toBeDefined();
        expect(guide!.children).toHaveLength(1);
        expect(guide!.children![0].data).toBe('/guide/installation');
    });

    it('excludes a top-level group with no matching descendant and no title/heading match of its own', () => {
        sidebar = new DocsSidebar(router);
        const body = Body.init({ layoutManager: Fit(), components: [sidebar] });
        body.flushLayout();

        type('install');
        body.flushLayout();

        const [, tree] = sidebar.getComponents() as [TextField, Tree];

        expect(tree.getNodes().some((n) => n.data === '/data')).toBe(false);
    });

    it('surfaces a page matching only its heading text, not its title', () => {
        sidebar = new DocsSidebar(router);
        const body = Body.init({ layoutManager: Fit(), components: [sidebar] });
        body.flushLayout();

        // /concepts/sizing's title is "Sizing"; "## Baseline (for horizontal
        // layouts)" is one of its headings but not its title.
        type('BASELINE');
        body.flushLayout();

        const [, tree] = sidebar.getComponents() as [TextField, Tree];

        expect(findNode(tree.getNodes(), '/concepts/sizing')).toBeDefined();
    });

    it('keeps a matching group node with an empty children array when none of its children match', () => {
        sidebar = new DocsSidebar(router);
        const body = Body.init({ layoutManager: Fit(), components: [sidebar] });
        body.flushLayout();

        // The "Concepts" group's own index page is titled "Concepts"; none of
        // its twelve child pages' titles or headings contain that word.
        type('concepts');
        body.flushLayout();

        const [, tree] = sidebar.getComponents() as [TextField, Tree];
        const concepts = tree.getNodes().find((n) => n.data === '/concepts');

        expect(concepts).toBeDefined();
        expect(concepts!.children ?? []).toHaveLength(0);
    });

    it('sets the tree to zero nodes when nothing matches', () => {
        sidebar = new DocsSidebar(router);
        const body = Body.init({ layoutManager: Fit(), components: [sidebar] });
        body.flushLayout();

        type('xyzzy');
        body.flushLayout();

        const [, tree] = sidebar.getComponents() as [TextField, Tree];

        expect(tree.getNodes()).toEqual([]);
    });

    it('restores the exact _fullNodes array when the field is cleared back to empty', () => {
        sidebar = new DocsSidebar(router);
        const body = Body.init({ layoutManager: Fit(), components: [sidebar] });
        body.flushLayout();

        const [, tree] = sidebar.getComponents() as [TextField, Tree];
        const fullNodes = tree.getNodes();

        type('install');
        body.flushLayout();
        expect(tree.getNodes()).not.toBe(fullNodes);

        type('');
        body.flushLayout();
        expect(tree.getNodes()).toBe(fullNodes);
    });

    it('calls Tree.expandAll after a non-empty query', () => {
        sidebar = new DocsSidebar(router);
        const body = Body.init({ layoutManager: Fit(), components: [sidebar] });
        body.flushLayout();

        const [, tree] = sidebar.getComponents() as [TextField, Tree];
        const expandAllSpy = vi.spyOn(tree, 'expandAll');

        type('install');
        body.flushLayout();

        expect(expandAllSpy).toHaveBeenCalledTimes(1);
    });

    it('filters in an API-reference node matching by its label', () => {
        sidebar = new DocsSidebar(router);
        const body = Body.init({ layoutManager: Fit(), components: [sidebar] });
        body.flushLayout();

        type('button');
        body.flushLayout();

        const [, tree] = sidebar.getComponents() as [TextField, Tree];

        expect(findNode(tree.getNodes(), '/api/component/button/classes/Button')).toBeDefined();
    });

    it('does not match a substring found only in an API page body, not its label', () => {
        sidebar = new DocsSidebar(router);
        const body = Body.init({ layoutManager: Fit(), components: [sidebar] });
        body.flushLayout();

        type('defined in:');
        body.flushLayout();

        const [, tree] = sidebar.getComponents() as [TextField, Tree];

        // "Defined in:" is TypeDoc's own generated boilerplate line, present
        // in the body of every generated API page (including Button.md) and
        // in no authored page's title, heading, or body — an unambiguous
        // probe for "API page bodies are never fetched to build the search
        // index," unlike a hand-picked prose phrase that might also appear
        // in some authored page's own (indexed) heading text by coincidence.
        expect(tree.getNodes()).toEqual([]);
    });

    it('clears an active filter, resets the tree, and reveals/selects the target when select() is called mid-filter', async () => {
        sidebar = new DocsSidebar(router);
        const body = Body.init({ layoutManager: Fit(), components: [sidebar] });
        body.flushLayout();

        const [searchField, tree] = sidebar.getComponents() as [TextField, Tree];
        const fullNodes = tree.getNodes();

        // Filters to a branch that does not contain /concepts/sizing.
        type('install');
        body.flushLayout();
        expect(findNode(tree.getNodes(), '/concepts/sizing')).toBeUndefined();

        await sidebar.select('/concepts/sizing');
        body.flushLayout();

        expect(searchField.getValue()).toBe('');
        expect(tree.getNodes()).toBe(fullNodes);
        expect(tree.getSelectedNode()?.data).toBe('/concepts/sizing');
    });

    it('leaves an empty search field untouched and does not call Tree.setNodes when select() is called with no active filter', async () => {
        sidebar = new DocsSidebar(router);
        const body = Body.init({ layoutManager: Fit(), components: [sidebar] });
        body.flushLayout();

        const [searchField, tree] = sidebar.getComponents() as [TextField, Tree];
        const setNodesSpy = vi.spyOn(tree, 'setNodes');

        await sidebar.select('/guide/installation');
        body.flushLayout();

        expect(searchField.getValue()).toBe('');
        expect(setNodesSpy).not.toHaveBeenCalled();
        expect(tree.getSelectedNode()?.data).toBe('/guide/installation');
    });
});
