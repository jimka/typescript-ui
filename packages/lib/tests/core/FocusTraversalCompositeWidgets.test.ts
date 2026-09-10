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
import { describe, it, expect } from 'vitest';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { findFocusable } from '~/core/Focusable';
import { Tree } from '~/component/tree/Tree';
import { Table } from '~/component/table/Table';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { CodeEditor } from '~/component/editor/CodeEditor';

/** The eligible tab stops inside `el`'s real, rendered subtree. */
function stopCount(el: Handle): number {
    return findFocusable(el).filter(handle => DOM.source.isRenderedVisible(handle)).length;
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

    // MenuBar, ToolBar, ButtonGroup, and Tab/TabBar are deliberately NOT
    // asserted at "exactly one" below — this audit found each currently
    // exposes one stop per managed item, not one for the whole group. Root
    // cause, confirmed by inspecting the rendered markup: `FOCUSABLE_SELECTOR`
    // (`core/Focusable.ts`) is the comma-separated CSS list
    // `'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'`.
    // Its `:not([tabindex="-1"])` guard binds only to the trailing
    // `[tabindex]` branch — a native `<button>`/`<a href>`/`<input>`/`<select>`/
    // `<textarea>` still matches its own branch regardless of `tabindex`, so
    // `RovingTabIndex.add`'s `tabindex="-1"` on the inactive items never
    // excludes them when the managed items render as one of those native tags
    // (`MenuBarButton`, `ToolBar`'s and `ButtonGroup`'s `Button`/
    // `ToggleButton` items, and a `Tab` layout's `TabButton` items — all real
    // `<button>` elements). `Tree`'s rows are not native-tag elements, and
    // `Table`'s body cells route through `RovingTabIndex` on non-native
    // elements too, so both are unaffected and pass above.
    // `core/Focusable.ts` is owned by plans/directional-panel-navigation.md
    // and this plan must not edit it (see its own Architecture Decisions), so
    // fixing the selector is out of scope here — tracked as a follow-up
    // rather than silently patched. See `## Implementation Notes` below.
    it.todo('MenuBar exposes exactly one stop — currently one per button (core/Focusable.ts selector gap, see comment above)');
    it.todo('ToolBar exposes exactly one stop — currently one per button (core/Focusable.ts selector gap, see comment above)');
    it.todo('ButtonGroup exposes exactly one stop — currently one per button (core/Focusable.ts selector gap, see comment above)');
    it.todo('A Tab layout\'s TabBar exposes exactly one stop — currently one per tab (core/Focusable.ts selector gap, see comment above)');
});

describe('A Tab-key owner\'s own tab stop (CodeEditor)', () => {
    // A resting CodeEditor exposes ZERO tab stops today, not one. Root cause:
    // CodeMirror's `.cm-content` is `contenteditable="true"` with no
    // `tabindex` attribute — a real browser still tabs into it natively
    // (`contenteditable` carries an implicit tabIndex of 0), but
    // `FOCUSABLE_SELECTOR` (`core/Focusable.ts`) has no `[contenteditable]`
    // branch, so `findFocusable` never matches it. The search panel
    // (`CodeEditorSearchPanel`) contributes nothing either, but not because
    // `isRenderedVisible` filters it out — its find/replace rows are built
    // lazily by `buildControls()`, which only runs once the panel is actually
    // opened (`CodeEditor.setSearchPanelOpen`), so a resting panel has zero
    // child components and thus zero rendered elements for the selector to
    // find in the first place. Consequence for this service: with
    // `FocusTraversal` enabled, a plain `Tab` from outside a
    // `CodeEditor` skips over it entirely (and still calls `preventDefault`,
    // since focus moves to whatever the next real stop is), and
    // `stopAfterOwner`/`stopBeforeOwner`'s "no stop inside the owner" fallback
    // (the first/last stop of the root) is always what actually fires for it,
    // not a position genuinely adjacent to the editor. Same class of gap as
    // the `RovingTabIndex` one above — a pre-existing `core/Focusable.ts`
    // limitation this plan must not edit — tracked here rather than silently
    // relied upon. See `## Implementation Notes` below.
    it('confirms the gap: a resting, actually-mounted CodeEditor exposes zero tab stops', () => {
        const editor = new CodeEditor('hello');
        const el = editor.getElement(true)!;
        mount(el);

        // CodeMirror mounts lazily from `onFirstLayout`, which needs a
        // connected, sized element to fire — a bare `getElement(true)` never
        // triggers it (the component's only child stays the undisplayed
        // search panel), so the selector match below would trivially be zero
        // for the wrong reason. Force the real mount so the assertion
        // actually exercises the gap the comment above describes.
        editor.setPreferredSize({ width: 400, height: 300 });
        editor.flushLayout();
        expect(DOM.source.querySelector(el, '.cm-content')).not.toBeNull(); // sanity: CodeMirror did mount

        expect(stopCount(el)).toBe(0);
    });

    it.todo('CodeEditor exposes exactly one tab stop reachable from outside it (core/Focusable.ts selector gap, see comment above)');
});

describe('tabindex="-1" exclusion (Expected Behaviour: FOCUSABLE_SELECTOR eligibility table)', () => {
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
});
