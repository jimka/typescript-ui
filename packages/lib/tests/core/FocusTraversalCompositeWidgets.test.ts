// @vitest-environment jsdom
//
// Step 7 of plans/framework-focus-traversal.md: "Audit composite widgets for
// the one-stop rule." Adds a test, not a fix — a widget exposing more than
// one stop is a bug in that widget (or, as discovered below, in a shared
// dependency) and gets its own plan rather than being patched here.
//
// Against the REAL production DOM source (the `jsdom` pragma keeps
// `tests/setup/node-setup.ts` from installing the modelled DOM, mirroring
// `tests/dom/countElements.test.ts`): the modelled `ModelledDOMSource` has no
// real selector engine, so `findFocusable`'s `querySelectorAll` only ever
// returns what a test explicitly seeds — it cannot answer "does this real
// widget's rendered markup produce one match," which is exactly the question
// this audit asks.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { findFocusable } from '~/core/Focusable';
import { Tree } from '~/component/tree/Tree';
import { Table } from '~/component/table/Table';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { CodeEditor } from '~/component/editor/CodeEditor';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { Tab } from '~/layout/Tab';
import { ToggleButton } from '~/component/button/ToggleButton';
import { ButtonGroup } from '~/overlay/ButtonGroup';
import { LayoutConstraints } from '~/layout/LayoutConstraints';

/** The eligible tab stops inside `el`'s real, rendered subtree, in DOM order. */
function stops(el: Handle): Handle[] {
    return findFocusable(el).filter(handle => DOM.source.isRenderedVisible(handle));
}

/** How many eligible tab stops `el`'s real, rendered subtree exposes. */
function stopCount(el: Handle): number {
    return stops(el).length;
}

/** Mounts a component's element into the real document so its descendants are queryable. */
function mount(el: Handle): void {
    DOM.sink.appendChild(DOM.source.getBody(), el);
}

describe('One tab stop per composite widget (Expected Behaviour: RovingTabIndex groups)', () => {
    it('Tree exposes exactly one stop', () => {
        const tree = new Tree();
        tree.setNodes([{ label: 'A' }, { label: 'B' }, { label: 'C' }]);
        const el = tree.getElement(true)!;
        mount(el);

        expect(stopCount(el)).toBe(1);
    });

    it("Table's body exposes exactly one stop", async () => {
        const store = new MemoryStore(new Model([{ name: 'c0', type: 'string' }], 'c0'), [{ c0: 'a' }, { c0: 'b' }]);
        await store.load();

        const table = new Table(store);
        const bodyEl = table.getBody().getElement(true)!;
        mount(table.getElement(true)!);

        expect(stopCount(bodyEl)).toBe(1);
    });

    // `FOCUSABLE_SELECTOR` (`core/Focusable.ts`) carries its
    // `:not([tabindex="-1"])` guard on every one of its branches, so the
    // `tabindex="-1"` `RovingTabIndex.add` writes onto a group's inactive
    // members hides them from the selector whatever tag they render as —
    // including the real `<button>` a `ToggleButton` or a `TabButton` is. A
    // roving group therefore contributes its single active member and nothing
    // else, which is what the two widgets below assert.
    it('ButtonGroup exposes exactly one stop', () => {
        const host  = new Container();
        const group = new ButtonGroup();

        for (const label of ['A', 'B', 'C']) {
            const button = new ToggleButton(label);

            host.addComponent(button);
            group.addButton(button);
        }

        // Without this the group holds no `RovingTabIndex` at all, every
        // button keeps the `tabindex="0"` it sets for standalone use, and the
        // count below is 3 rather than 1.
        group.setContainer(host);

        const el = host.getElement(true)!;
        mount(el);

        expect(stopCount(el)).toBe(1);
    });

    it('A Tab layout\'s TabBar exposes exactly one stop', () => {
        const host = new Container({ layoutManager: new Tab() });

        host.addComponent(new Component({}));
        host.addComponent(new Component({}));
        host.addComponent(new Component({}));

        const hostEl = host.getElement(true)!;
        mount(hostEl);

        // The strip's `TabButton`s are built by the Tab layout pass, which
        // needs a connected, sized host to run — without it the strip has no
        // buttons and the count below would be 1 for the wrong reason.
        host.setPreferredSize({ width: 400, height: 300 });
        host.flushLayout();

        const barEl = DOM.source.querySelectorAll(hostEl, '[role="tablist"]')[0]!;

        expect(stopCount(barEl)).toBe(1);
    });

    // A closeable cell's ✕ is a real `<button>` that `Button`'s constructor
    // gives an explicit `tabindex="0"`, so before the close buttons joined the
    // strip's roving group the two counts below were 4 and 2 — one stray stop
    // per ✕ on top of the strip's own single stop
    // (tab-and-dialog-key-routing, Expected Behaviour: "Tab stops a strip
    // exposes").
    it('A Tab layout\'s TabBar exposes exactly one stop when every tab is closeable', () => {
        const host = new Container({ layoutManager: new Tab() });

        for (let i = 0; i < 3; i++) {
            host.addComponent(new Component({}), Object.assign(new LayoutConstraints(), { closeable: true }));
        }

        const hostEl = host.getElement(true)!;
        mount(hostEl);

        host.setPreferredSize({ width: 400, height: 300 });
        host.flushLayout();

        const barEl = DOM.source.querySelectorAll(hostEl, '[role="tablist"]')[0]!;

        expect(stopCount(barEl)).toBe(1);
    });

    it('A Tab layout\'s TabBar exposes exactly one stop with a single closeable tab among plain ones', () => {
        const host = new Container({ layoutManager: new Tab() });

        host.addComponent(new Component({}));
        host.addComponent(new Component({}), Object.assign(new LayoutConstraints(), { closeable: true }));
        host.addComponent(new Component({}));

        const hostEl = host.getElement(true)!;
        mount(hostEl);

        host.setPreferredSize({ width: 400, height: 300 });
        host.flushLayout();

        const barEl = DOM.source.querySelectorAll(hostEl, '[role="tablist"]')[0]!;

        expect(stopCount(barEl)).toBe(1);
    });

    // The two below stay open, and neither is a selector problem — the guard
    // above cannot fix either. `MenuBar` builds plain `MenuBarButton`s and
    // never constructs a `RovingTabIndex` at all, so every one of its buttons
    // legitimately keeps `tabindex="0"` and the bar exposes one stop per
    // button. `ToolBar` does rove its children, but also makes its own element
    // a tab stop (`getAria().setTabIndex(0)` in its constructor), so the bar
    // and its roving group's active member are two stops. Each is a bug in
    // that widget and gets its own plan rather than being patched here.
    it.todo('MenuBar exposes exactly one stop — currently one per button, since it enrols them in no RovingTabIndex group (see comment above)');
    it.todo('ToolBar exposes exactly one stop — currently two, its own tabindex="0" plus its roving group\'s active member (see comment above)');
});

describe('A Tab-key owner\'s own tab stop (CodeEditor)', () => {
    // A resting CodeEditor exposes exactly one tab stop: CodeMirror's
    // `.cm-content`, which is `contenteditable="true"` and carries no
    // `tabindex` attribute. A real browser tabs into it natively
    // (`contenteditable` carries an implicit tabIndex of 0), and
    // `FOCUSABLE_SELECTOR` (`core/Focusable.ts`) now matches it too, through
    // its `[contenteditable]:not([contenteditable="false"])` branch. The
    // search panel (`CodeEditorSearchPanel`) contributes nothing on top of
    // that, but not because `isRenderedVisible` filters it out — its
    // find/replace rows are built lazily by `buildControls()`, which only runs
    // once the panel is actually opened (`CodeEditor.setSearchPanelOpen`), so
    // a resting panel has zero child components and thus zero rendered
    // elements for the selector to find in the first place. Consequence for
    // this service: with `FocusTraversal` enabled, a plain `Tab` from outside
    // a `CodeEditor` now lands on the editing surface instead of stepping over
    // the editor entirely, and `stopAfterOwner`/`stopBeforeOwner` have a real
    // in-owner stop to step past rather than always falling back to the
    // first/last stop of the root.

    // Every editor a case below builds, disposed after it. Mounting starts
    // CodeMirror's measure cycle on an animation frame; left undisposed, that
    // frame runs after the case has ended, and its selection layer calls
    // `Range.getClientRects`, which jsdom does not implement, so CodeMirror
    // logs a TypeError. Disposing destroys the view, which cancels the frame.
    // Mirrors MarkdownHeadingScoping.test.ts's `panes`.
    const editors: CodeEditor[] = [];

    afterEach(() => {
        for (const editor of editors.splice(0)) {
            editor.dispose();
        }
    });

    it('a resting, actually-mounted CodeEditor exposes exactly one tab stop', () => {
        const editor = new CodeEditor('hello');
        editors.push(editor);
        const el = editor.getElement(true)!;
        mount(el);

        // CodeMirror mounts lazily from `onFirstLayout`, which needs a
        // connected, sized element to fire — a bare `getElement(true)` never
        // triggers it (the component's only child stays the undisplayed
        // search panel), so the selector match below would trivially be zero
        // for the wrong reason. Force the real mount so the assertion
        // actually exercises the editing surface.
        editor.setPreferredSize({ width: 400, height: 300 });
        editor.flushLayout();
        expect(DOM.source.querySelector(el, '.cm-content')).not.toBeNull(); // sanity: CodeMirror did mount

        expect(stopCount(el)).toBe(1);
    });

    it("that one stop is CodeMirror's contenteditable surface", () => {
        const editor = new CodeEditor('hello');
        editors.push(editor);
        const el = editor.getElement(true)!;
        mount(el);

        editor.setPreferredSize({ width: 400, height: 300 });
        editor.flushLayout();

        expect(stops(el)).toEqual([DOM.source.querySelector(el, '.cm-content')]);
    });
});

describe('FOCUSABLE_SELECTOR eligibility (Expected Behaviour: the match table)', () => {
    // Against the real selector engine, so the `[tabindex]:not([tabindex="-1"])`
    // branch of FOCUSABLE_SELECTOR is actually exercised rather than seeded —
    // the offline ModelledDOMSource used by FocusTraversal.test.ts has no
    // selector engine (see this file's own header comment).
    it('a plain element with tabindex="-1" is excluded; one with tabindex="0" is not', () => {
        const container = DOM.sink.createElement('div');
        mount(container);

        const negative = DOM.sink.createElement('div');
        DOM.sink.edit(negative).attr('tabindex', '-1').commit();
        DOM.sink.appendChild(container, negative);

        const positive = DOM.sink.createElement('div');
        DOM.sink.edit(positive).attr('tabindex', '0').commit();
        DOM.sink.appendChild(container, positive);

        expect(findFocusable(container)).toEqual([positive]);
    });

    it('a native control carries the same guard — tabindex="-1" excludes a button and an input too', () => {
        // The rows the old single-line constant got wrong: its guard bound to
        // the trailing `[tabindex]` branch alone, so these two matched their
        // own branch whatever tabindex they held. This is the value
        // `RovingTabIndex.add` writes onto every inactive member.
        const container = DOM.sink.createElement('div');
        mount(container);

        const rovedOffButton = DOM.sink.createElement('button');
        DOM.sink.edit(rovedOffButton).attr('tabindex', '-1').commit();
        DOM.sink.appendChild(container, rovedOffButton);

        const rovedOffInput = DOM.sink.createElement('input');
        DOM.sink.edit(rovedOffInput).attr('tabindex', '-1').commit();
        DOM.sink.appendChild(container, rovedOffInput);

        const activeButton = DOM.sink.createElement('button');
        DOM.sink.edit(activeButton).attr('tabindex', '0').commit();
        DOM.sink.appendChild(container, activeButton);

        expect(findFocusable(container)).toEqual([activeButton]);
    });

    it('only a real link matches the href branch — a Glyph\'s decorative <use href> does not', () => {
        const container = DOM.sink.createElement('div');
        mount(container);

        const link = DOM.sink.createElement('a');
        DOM.sink.edit(link).attr('href', '/x').commit();
        DOM.sink.appendChild(container, link);

        // An anchor without an href is not focusable in a browser either.
        DOM.sink.appendChild(container, DOM.sink.createElement('a'));

        // The shape every `Glyph` icon renders as (`<svg><use href="#…">`) —
        // matched by a bare `[href]` branch, focusable by nothing. This is
        // the row that retired `SpatialNavigation`'s local glyph filter.
        const glyph = DOM.sink.createElement('use');
        DOM.sink.edit(glyph).attr('href', '#icon').commit();
        DOM.sink.appendChild(container, glyph);

        expect(findFocusable(container)).toEqual([link]);
    });

    it('a contenteditable surface matches unless it is contenteditable="false"', () => {
        const container = DOM.sink.createElement('div');
        mount(container);

        const editable = DOM.sink.createElement('div');
        DOM.sink.edit(editable).attr('contenteditable', 'true').commit();
        DOM.sink.appendChild(container, editable);

        // What `MarkdownEditor.setContentEditable(false)` writes — a surface
        // deliberately taken out of editing, and so out of the tab order.
        const readOnly = DOM.sink.createElement('div');
        DOM.sink.edit(readOnly).attr('contenteditable', 'false').commit();
        DOM.sink.appendChild(container, readOnly);

        expect(findFocusable(container)).toEqual([editable]);
    });
});
