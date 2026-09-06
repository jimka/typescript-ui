---
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/CodeEditor.ts
  - packages/lib/src/typescript/lib/component/editor/theme.ts
---

# CodeEditor Floating Search Widget — Implementation Plan

## Overview

`CodeEditor` currently installs `search()` from `@codemirror/search` with no configuration and lets CodeMirror render its own search panel — a plain HTML form that docks inside the editor and pushes the document down ([packages/lib/src/typescript/lib/component/editor/CodeEditor.ts:1408](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1408), [:1421](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1421)). This plan replaces that panel's user interface with a framework-built floating card pinned to the editor's upper-right corner, overlaying the document instead of reserving space for it.

The card is a new `FloatingPanel` subclass, `CodeEditorSearchPanel`, in a new file `packages/lib/src/typescript/lib/component/editor/CodeEditorSearchPanel.ts`. Every one of its nine actions is a glyph-only `Button` / `ToggleButton` with a descriptive hover tooltip. It carries no CodeMirror knowledge: it emits two events, and `CodeEditor` translates them into `@codemirror/search`'s commands and `SearchQuery` state.

`CodeEditor` keeps extending `Component` and keeps mounting CodeMirror onto its own element. It gains an `Anchor` layout manager, one framework child (the search panel), a two-binding keymap for `Ctrl-F` / `Escape`, and a `doLayout` override. `packages/lib/src/typescript/lib/component/editor/theme.ts` gains two rules that hide CodeMirror's own search panel while leaving its search-match highlighting, its line-number dialog, and its lint panel intact.

---

## Architecture Decisions

### `CodeEditor` stays a `Component` and gains an `Anchor` layout manager

`CodeEditor` is not converted to `Panel`. It keeps its class, its own element as CodeMirror's mount parent, and every existing DOM resolution; the only structural change is that its layout manager becomes a per-instance `Anchor` and it registers one child.[^no-panel]

This mirrors [MarkdownViewer:151-201](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L151-L201), which hosts its own `FloatingPanel` children on an `Anchor` and adds each one with `host.addComponent(panel, panel.getAnchorConstraints())` — the contract `FloatingPanel` documents at [FloatingPanel.ts:151-161](packages/lib/src/typescript/lib/component/container/FloatingPanel.ts#L151-L161). `Anchor` is the manager that makes this safe: it "imposes no intrinsic preferred, min, or max size on its host" ([Anchor.ts:52-53](packages/lib/src/typescript/lib/layout/Anchor.ts#L52-L53)) because it never overrides `getPreferredSize` / `getMinSize`, so the base returns `null` / `{0,0}` ([LayoutManager.ts:48-50](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L48-L50), [:158-169](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L158-L169)). `CodeEditor` therefore keeps reporting no size of its own, which is what [setAutoHeight](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1936-L1939) and the docs' "it reports no content-derived size of its own" contract both depend on.

The `Anchor` instance must be constructed inside `CodeEditor`'s constructor, not stored in the module-level `_defaultCodeEditorOptions` constant: a layout manager holds per-instance `_container` state ([Component.ts:684-693](packages/lib/src/typescript/lib/core/Component.ts#L684-L693)).

### The search panel is registered as a child at construction time, and builds its own controls on first open

`CodeEditor`'s constructor creates one `CodeEditorSearchPanel`, calls `setDisplayed(false)` on it, and registers it. The panel's own fields and buttons are built later, the first time the panel opens.

Registering at construction is mandatory, not a preference: `Component.insertComponent` inserts a child's element into `getChildHost()`, which resolves through `getScrollElement()` ([Component.ts:1603-1605](packages/lib/src/typescript/lib/core/Component.ts#L1603-L1605), [:6566-6604](packages/lib/src/typescript/lib/core/Component.ts#L6566-L6604)). `CodeEditor.getScrollElement()` returns CodeMirror's `.cm-scroller` once the view is mounted ([CodeEditor.ts:1327-1329](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1327-L1329)), so an `addComponent` call made after mount would place the search panel *inside* the region CodeMirror owns and rewrites. A child registered before the element exists is appended by `Component.init` to the plain element instead ([Component.ts:7334-7340](packages/lib/src/typescript/lib/core/Component.ts#L7334-L7340)), which is the safe path.

Deferring the *controls* keeps that safety while avoiding a per-editor cost.[^lazy-controls] Adding children to the search panel after it has rendered is safe, because the search panel's own `getScrollElement()` is just its element.

### CodeMirror's search panel state stays open; only its DOM is hidden

`search()` stays installed unchanged, and `openSearchPanel` / `closeSearchPanel` remain the mechanism that opens and closes the *search state*. Two rules in `codeEditorTheme()` hide the panel CodeMirror renders:

```typescript
".cm-panel.cm-search":                                     { display: "none" },
".cm-panels:has(> .cm-panel.cm-search:only-child)":        { display: "none" },
```

The first hides the stock form; the second collapses the panel container so its themed border does not paint a stray line when the search panel is the only thing in it. Both selectors are scoped to `.cm-search`, so CodeMirror's go-to-line dialog (still reachable via `Mod-Alt-g`) and any lint panel keep their container.

Keeping CodeMirror's own panel state open is what keeps every match in the document tinted while the search panel is open.[^panel-gate] The existing `.cm-textfield`, `.cm-button`, `.cm-panels`, `.cm-panels-top` and `.cm-panels-bottom` rules in `theme.ts` stay: the go-to-line dialog uses all of them.

### The search panel emits two semantic events; `CodeEditor` owns every CodeMirror call

`CodeEditorSearchPanel` exposes `on("querychange", …)` and `on("command", …)`. It never imports `@codemirror/search` and never sees an `EditorView`. `CodeEditor` subscribes to both and does the dispatching.

This follows [MarkdownMinimap](packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts#L313-L327), which emits a semantic `"select"` and leaves the owner to decide what selecting means. Two events rather than seven keeps the typed `on` / `off` / `emit` overload set small while staying compile-checked.

### Query changes go through `setSearchQuery`; actions go through the exported commands

Every field edit and toggle produces a `SearchQuery` dispatched as `setSearchQuery`; every button press runs the matching exported command against the live view.

| Search panel event | Payload | What `CodeEditor` runs |
|---|---|---|
| `"querychange"` | all five field values | `view.dispatch({ effects: setSearchQuery.of(new SearchQuery({…})) })` |
| `"command"` | `"findnext"` | `findNext(view)` |
| `"command"` | `"findprevious"` | `findPrevious(view)` |
| `"command"` | `"selectall"` | `selectMatches(view)` |
| `"command"` | `"replacenext"` | `replaceNext(view)` |
| `"command"` | `"replaceall"` | `replaceAll(view)` |
| `"command"` | `"close"` | `closeSearchPanel(view)`, then hide the search panel and refocus the editor |

Every command except `"close"` is guarded on `getSearchQuery(view.state).valid`.[^valid-guard]

### `Ctrl-F` and `Escape` get their own high-precedence bindings; the rest of `searchKeymap` stays

`searchKeymap` stays in the keymap array exactly as it is today. A two-binding keymap wrapped in `Prec.high` is added so `Mod-f` and `Escape` reach `CodeEditor`'s own handlers first.[^own-bindings]

| Key | Where focus is | Behaviour |
|---|---|---|
| `Ctrl-F` / `Cmd-F` | editor document | Opens the search state, shows the search panel, seeds it from the editor selection, focuses the find field |
| `Ctrl-F` / `Cmd-F` | search panel's find field | Not seen by CodeMirror; the browser's own find opens. Accepted |
| `Escape` | editor document, search panel open | Closes the search state, hides the search panel, returns focus to the document |
| `Escape` | editor document, search panel closed | Returns `false`, so `defaultKeymap`'s `simplifySelection` still runs |
| `Escape` | either search panel field | The search panel emits `"command": "close"`; same close path |
| `Enter` | search panel's find field | The search panel emits `"command": "findnext"` |
| `Shift+Enter` | search panel's find field | The search panel emits `"command": "findprevious"` |
| `Enter` | search panel's replace field | The search panel emits `"command": "replacenext"` |
| `F3`, `Ctrl-G`, `Ctrl-D`, `Ctrl-Alt-G` | editor document | Unchanged — still `searchKeymap`'s own bindings |

`searchPanelOpen(state)` is the single source of truth for whether the search panel shows: the `updateListener` watches it flip and shows or hides the search panel. That way a path that opens CodeMirror's own search state without going through `Ctrl-F` (`F3` on an empty query falls through to `openSearchPanel`) still opens the search panel.

### Every action is a glyph-only button with a two-line tooltip

Each control is built as `Button({ glyph, text, showText: false, description, showDescription: false })`. `showText: false` hides the title on the face while still driving the hover tooltip and the reflected `aria-label`; `description` adds the keyboard hint as a second tooltip line. Both are documented behaviours of `Button` ([packages/lib/docs/components/Button.md](packages/lib/docs/components/Button.md), *Showing the title in the tooltip only*), and the glyph-only cluster mirrors [MarkdownViewer.makeControlButton:364-366](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L364-L366) and `DiagramView`'s own cluster ([DiagramView.ts:2217-2223](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L2217-L2223)).

| Control | Class | `glyph` | `text` (tooltip line 1 + `aria-label`) | `description` (tooltip line 2) |
|---|---|---|---|---|
| Match case | `ToggleButton` | `font` | `Match upper and lower case exactly` | — |
| Whole word | `ToggleButton` | `text-width` | `Match whole words only` | — |
| Regular expression | `ToggleButton` | `asterisk` | `Read the search text as a regular expression` | — |
| Find previous | `Button` | `chevron-up` | `Find the previous match` | `Shift+Enter` |
| Find next | `Button` | `chevron-down` | `Find the next match` | `Enter` |
| Select all matches | `Button` | `list-check` | `Select every match in the document` | — |
| Close | `Button` | `xmark` | `Close the search panel` | `Escape` |
| Replace | `Button` | `arrow-right-arrow-left` | `Replace the current match` | `Enter in the Replace field` |
| Replace all | `Button` | `layer-group` | `Replace every match in the document` | — |

All nine glyphs already exist in `packages/lib/src/typescript/lib/glyphs/solid/`; no new glyph asset is needed. Three of them are approximations rather than exact icons.[^glyph-fit] The registry starts empty and each module registers what it uses, so `CodeEditorSearchPanel.ts` needs its own module-level `Glyph.register(...)` call, exactly as [SpinButton.ts:12-25](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L12-L25) does.

---

## Public API

`CodeEditorSearchPanel` is exported from its own module but **not** added to the `component/editor` barrel — it is an implementation detail of `CodeEditor`, like the file-local `MarkdownContentPane` inside `MarkdownViewer.ts`.

```typescript
// packages/lib/src/typescript/lib/component/editor/CodeEditorSearchPanel.ts

/** The five values a search query is built from. */
export interface CodeEditorSearchFields {
    search:        string;
    replace:       string;
    caseSensitive: boolean;
    wholeWord:     boolean;
    regexp:        boolean;
}

/** The actions the panel's buttons and keys ask its owner to perform. */
export type CodeEditorSearchCommand =
    "findnext" | "findprevious" | "selectall" | "replacenext" | "replaceall" | "close";

export interface CodeEditorSearchPanelOptions extends FloatingPanelOptions {
    listeners?: {
        querychange?: (fields: CodeEditorSearchFields) => void;
        command?:     (command: CodeEditorSearchCommand) => void;
    };
}

class CodeEditorSearchPanel extends FloatingPanel<CodeEditorSearchPanelOptions> {
    protected static readonly ownClassStyleDefaults: StyleBag;

    constructor(options?: CodeEditorSearchPanelOptions, subclassDefaults?: Partial<CodeEditorSearchPanelOptions>);

    /** Builds the fields and buttons. Idempotent — a repeat call does nothing. */
    buildControls(): this;

    /** `true` once {@link buildControls} has run. */
    isBuilt(): boolean;

    getFields(): CodeEditorSearchFields;

    /** Writes the controls without emitting `"querychange"`. No-op before {@link buildControls}. */
    setFields(fields: CodeEditorSearchFields): this;

    /** Moves focus to the find field and selects its text. No-op before {@link buildControls}. */
    focusFind(): this;

    /** Clamps this panel's committed width and x to `availableWidth`; called by its owner's `doLayout`. */
    fitWithin(availableWidth: number): this;

    on(event: "querychange", listener: (fields: CodeEditorSearchFields) => void): this;
    on(event: "command",     listener: (command: CodeEditorSearchCommand) => void): this;
    off(event: "querychange", listener: (fields: CodeEditorSearchFields) => void): this;
    off(event: "command",     listener: (command: CodeEditorSearchCommand) => void): this;

    protected emit(event: "querychange", fields: CodeEditorSearchFields): void;
    protected emit(event: "command",     command: CodeEditorSearchCommand): void;
}

const CodeEditorSearchPanelCallable = callable(CodeEditorSearchPanel);
type CodeEditorSearchPanelCallable = CodeEditorSearchPanel;
export {
    CodeEditorSearchPanel         as _CodeEditorSearchPanel,
    CodeEditorSearchPanelCallable as CodeEditorSearchPanel,
};
```

`CodeEditor` adds no new public members. Its new methods are all private:

```typescript
// packages/lib/src/typescript/lib/component/editor/CodeEditor.ts

// Definite-assignment, not `declare`: no cascade-dispatched setter writes it,
// and it is assigned in the constructor body — mirrors MarkdownViewer._controls.
private _searchPanel!: CodeEditorSearchPanel;

// Named handler fields, per ARCHITECTURE.md's "listeners must reference a
// named function" rule — the shape MarkdownViewer.handleMinimapSelect uses.
private readonly handleSearchQueryChange: (fields: CodeEditorSearchFields) => void =
    (fields) => this.applySearchQuery(fields);
private readonly handleSearchCommand: (command: CodeEditorSearchCommand) => void =
    (command) => this.runSearchCommand(command);

private buildSearchQuery(fields: CodeEditorSearchFields): SearchQuery;
private applySearchQuery(fields: CodeEditorSearchFields): void;
private runSearchCommand(command: CodeEditorSearchCommand): void;
private setSearchPanelOpen(open: boolean): void;
private syncSearchPanelFields(state: EditorState): void;
private openSearch(view: EditorView): boolean;
private closeSearch(view: EditorView): boolean;

doLayout(): this;                                             // override, calls super first
```

---

## Internal Structure

### `CodeEditorSearchPanel` composition

```
CodeEditorSearchPanel          FloatingPanel, corner "top-right", VBox({ spacing: ROW_SPACING_PX })
├── findRow                  Component, HBox({ spacing: CONTROL_SPACING_PX, itemAlign: "center" })
│   ├── _findField           TextField  (preferredSize { width: FIELD_WIDTH_PX, height: 0 })
│   ├── _caseButton          ToggleButton "font"
│   ├── _wordButton          ToggleButton "text-width"
│   ├── _regexpButton        ToggleButton "asterisk"
│   ├── _previousButton      Button "chevron-up"
│   ├── _nextButton          Button "chevron-down"
│   ├── _selectAllButton     Button "list-check"
│   └── _closeButton         Button "xmark"
└── replaceRow               Component, HBox({ spacing: CONTROL_SPACING_PX, itemAlign: "center" })
    ├── _replaceField        TextField  (preferredSize { width: FIELD_WIDTH_PX, height: 0 })
    ├── _replaceButton       Button "arrow-right-arrow-left"
    └── _replaceAllButton    Button "layer-group"
```

`height: 0` in the fields' `preferredSize` is not a real height — `TextField` overwrites the height component from its own single-line box measurement while honouring the caller's width ([AbstractInput.ts:299-314](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L299-L314)). Only the width is being set here, and the code needs a comment saying so.

Chrome, mirroring [MarkdownMinimap.ts:124-138](packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts#L124-L138):

```typescript
const SEARCH_PANEL_CHROME: Pick<CodeEditorSearchPanelOptions, "backgroundColor" | "shadow" | "borderRadius"> = {
    backgroundColor: "var(--ts-ui-toolbar-bg, #f5f5f5)",
    shadow:          "var(--ts-ui-popover-shadow, 2px 4px 12px rgba(0, 0, 0, 0.18))",
    borderRadius:    "var(--ts-ui-border-radius, 4px)",
};

const _defaultCodeEditorSearchPanelOptions: Partial<CodeEditorSearchPanelOptions> = {
    ...SEARCH_PANEL_CHROME,
    corner: "top-right",
    // FloatingPanel defaults to zero insets; a card floating over live text
    // needs real padding or its controls sit flush against the shadow edge.
    insets: new Insets(6, 8, 6, 8),
};

protected static readonly ownClassStyleDefaults: StyleBag = SEARCH_PANEL_CHROME;
```

`SEARCH_PANEL_CHROME` must list every `StyleBag` key this class defaults: once a class declares `ownClassStyleDefaults`, the class-tier rule is built from that bag alone, and an omitted key falls back to the framework baseline rather than to `_defaultOptions` (see the comment above `MARKDOWN_MINIMAP_CHROME`). `corner` and `insets` are not `StyleBag` keys, so they stay out of it.

### Wiring inside the search panel

`buildControls()` builds the tree above and wires each control to a named handler field:

- each of the five value controls (two fields, three toggles) → `emit("querychange", this.getFields())`
- each action button → `emit("command", "<id>")`
- `_findField.on("keydown", …)`: `Enter` → `"findnext"`, `Shift+Enter` → `"findprevious"`, `Escape` → `"close"`
- `_replaceField.on("keydown", …)`: `Enter` → `"replacenext"`, `Escape` → `"close"`

A handled key returns `{ stop: true, prevent: true }`; anything else returns `false`.

`setFields` needs no re-entrancy guard: it writes through `TextField.setValue` and `ToggleButton.setSelected`, and the search panel listens on `"action"`, which is the *DOM* `input` / `change` event — neither fires for a programmatic write.

### Wiring inside `CodeEditor`

Constructor, after `super()` returns and after `this._cleanValue` is set:

```typescript
this._searchPanel = new CodeEditorSearchPanel({ zIndex: SEARCH_PANEL_Z_INDEX });
this._searchPanel.setDisplayed(false);
this._searchPanel.on("querychange", this.handleSearchQueryChange);
this._searchPanel.on("command", this.handleSearchCommand);
this.addComponent(this._searchPanel, this._searchPanel.getAnchorConstraints());
```

`SEARCH_PANEL_Z_INDEX = 350`, passed as a caller option so it is dispatched ([Component.ts:792](packages/lib/src/typescript/lib/core/Component.ts#L792)) rather than left as an undispatched class default. The value sits above CodeMirror's gutters (200) and panels (300) and below this editor's own read-only rejection overlay (400) and CodeMirror's own tooltips (500), so the search panel covers the document while the rejection wash still covers everything and a completion list still covers the search panel. A z-index is needed at all because `Component.init` appends framework children *before* `mount()` appends `.cm-editor`, and both are positioned boxes at automatic z-index, so later-in-DOM would otherwise win.

Added to the existing `updateListener` at [CodeEditor.ts:1449-1459](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1449-L1459):

```typescript
if (searchPanelOpen(update.state) !== searchPanelOpen(update.startState)) {
    this.setSearchPanelOpen(searchPanelOpen(update.state));
}

if (searchPanelOpen(update.state)
    && !getSearchQuery(update.state).eq(getSearchQuery(update.startState))) {
    this.syncSearchPanelFields(update.state);
}
```

`setSearchPanelOpen` is the whole framework-side effect, and is the seam offline tests drive:

```typescript
private setSearchPanelOpen(open: boolean): void {
    if (open) {
        this._searchPanel.buildControls();
    }

    this._searchPanel.setDisplayed(open);
    // setDisplayed writes CSS only; a component entering or leaving
    // getLaidOutComponents() needs an explicit pass to be placed.
    this.scheduleLayout();
}
```

Added to the `extensions` array in `mount()`, immediately after the existing `keymap.of([...])`:

```typescript
// Prec.high, so these two win over searchKeymap's own Mod-f / Escape entries
// without disturbing the rest of it.
Prec.high(keymap.of([
    { key: "Mod-f",  run: (view) => this.openSearch(view), preventDefault: true },
    { key: "Escape", run: (view) => this.closeSearch(view) },
])),
```

The remaining private methods are short. `openSearch` and `closeSearch` are what those two bindings run; `runSearchCommand` is what the search panel's `"command"` event runs:

```typescript
private openSearch(view: EditorView): boolean {
    // Flips the search state (which the updateListener turns into a visible
    // search panel) and seeds the query from the current selection. Called even when
    // the state is already open, because this method also has to re-focus.
    openSearchPanel(view);
    this.setSearchPanelOpen(true);
    this.syncSearchPanelFields(view.state);
    this._searchPanel.focusFind();

    return true;
}

private closeSearch(view: EditorView): boolean {
    // `false` when the search panel is already closed, so Escape keeps falling through
    // to defaultKeymap's own simplifySelection binding.
    if (!this._searchPanel.isDisplayed()) {
        return false;
    }

    closeSearchPanel(view);
    this.setSearchPanelOpen(false);
    this.focus();

    return true;
}

private runSearchCommand(command: CodeEditorSearchCommand): void {
    if (!this._view) {
        return;
    }

    if (command === "close") {
        this.closeSearch(this._view);

        return;
    }

    // Every other command is wrapped in the library's own `searchCommand`,
    // which silently falls back to openSearchPanel — and so to re-seeding the
    // query from the selection — on an invalid query. Skip instead.
    if (!getSearchQuery(this._view.state).valid) {
        return;
    }

    switch (command) {
        case "findnext":     findNext(this._view);     break;
        case "findprevious": findPrevious(this._view); break;
        case "selectall":    selectMatches(this._view); break;
        case "replacenext":  replaceNext(this._view);  break;
        case "replaceall":   replaceAll(this._view);   break;
    }
}

private applySearchQuery(fields: CodeEditorSearchFields): void {
    if (this._view) {
        this._view.dispatch({ effects: setSearchQuery.of(this.buildSearchQuery(fields)) });
    }
}

// Factored out so the field-to-query mapping is unit-testable with no view,
// the same reason resolveFormatOptions and applyFormatted are factored out.
private buildSearchQuery(fields: CodeEditorSearchFields): SearchQuery {
    return new SearchQuery({
        search:        fields.search,
        replace:       fields.replace,
        caseSensitive: fields.caseSensitive,
        wholeWord:     fields.wholeWord,
        regexp:        fields.regexp,
    });
}

private syncSearchPanelFields(state: EditorState): void {
    const query = getSearchQuery(state);

    this._searchPanel.setFields({
        search:        query.search,
        replace:       query.replace,
        caseSensitive: query.caseSensitive,
        wholeWord:     query.wholeWord,
        regexp:        query.regexp,
    });
}
```

`buildSearchQuery` leaves `literal` at its default of `false`, matching what CodeMirror's own panel builds today.

`doLayout` clamps the search panel so a narrow editor cannot be forced to overflow — `Anchor` commits a child at its preferred size without capping it to the container ([Anchor.ts:49-53](packages/lib/src/typescript/lib/layout/Anchor.ts#L49-L53)), and this component's own box is `overflow: auto`, so an oversized search panel would raise a real scrollbar on it:

```typescript
doLayout(): this {
    super.doLayout();

    // Guards the super() cascade's own layout pass, which can run before the
    // constructor body assigns _searchPanel — mirrors MarkdownViewer.doLayout.
    const innerSize = this._searchPanel ? this.getInnerSize() : null;

    if (innerSize) {
        this._searchPanel.fitWithin(innerSize.width);
    }

    return this;
}
```

`fitWithin` re-derives x itself, because changing the width invalidates the right-anchored position `Anchor` just committed:

```typescript
fitWithin(availableWidth: number): this {
    const host = this.getParentComponent();

    if (!host || !this.isDisplayed()) {
        return this;
    }

    const margin = this.getMargin();
    const width  = Math.min(this.getWidth(), Math.max(0, availableWidth - margin * 2));

    this.setWidth(width);
    this.setX(host.getContentInsets().getLeft() + availableWidth - margin - width);

    return this;
}
```

---

## Ordered Implementation Steps

1. **Create `packages/lib/src/typescript/lib/component/editor/CodeEditorSearchPanel.ts`.** Imports, the `Glyph.register(...)` call for the nine glyphs, `SEARCH_PANEL_CHROME`, `_defaultCodeEditorSearchPanelOptions`, the exported types, and the class skeleton (constructor, `ownClassStyleDefaults`, the `ListenerBag`, `on` / `off` / `emit`). No controls yet. Wrap with `callable()` and export both names. — verify: `npm run typecheck` in `packages/lib` passes.
2. **Write `packages/lib/tests/component/code-editor-search-panel.test.ts`** covering every offline case in *Expected Behaviour* §B, following the harness setup in `packages/lib/tests/component/code-editor.test.ts:26-35`. — verify: the new suite runs and fails, because the methods it calls do not exist yet.
3. **Add `buildControls()`, `isBuilt()`, `getFields()`, `setFields()`, `focusFind()`, `fitWithin()`** to `CodeEditorSearchPanel.ts`, following *Internal Structure*. Every listener is a named handler field, never an inline arrow at the call site. — verify: `npx vitest run tests/component/code-editor-search-panel.test.ts` is green; `grep -n "protected destructor" packages/lib/src/typescript/lib/component/editor/CodeEditorSearchPanel.ts` — expect zero matches.[^no-destructor]
4. **Edit `packages/lib/src/typescript/lib/component/editor/theme.ts`:** add the two `.cm-search` hide rules next to the existing `.cm-panels` block ([theme.ts:85-94](packages/lib/src/typescript/lib/component/editor/theme.ts#L85-L94)), with a comment saying the stock panel is kept open purely so `searchHighlighter` keeps decorating matches. Delete nothing. — verify: `grep -n "cm-textfield\|cm-button\|cm-panels-bottom" packages/lib/src/typescript/lib/component/editor/theme.ts` still matches.
5. **Edit `CodeEditor.ts` — imports and constructor.** Add `Prec` to the `@codemirror/state` import; add `getSearchQuery`, `setSearchQuery`, `searchPanelOpen`, `openSearchPanel`, `closeSearchPanel`, `findNext`, `findPrevious`, `selectMatches`, `replaceNext`, `replaceAll`, `SearchQuery` to the `@codemirror/search` import; import `Anchor` from `~/layout/Anchor.js` and the search panel's types. Add `SEARCH_PANEL_Z_INDEX`. Change the `super(...)` call at [:454](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L454) to append `layoutManager: new Anchor()` last, with `MarkdownViewer`'s rationale comment ([MarkdownViewer.ts:152-161](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L152-L161)). Build, wire and register `_searchPanel` in the constructor body. — verify: `npx tsc --noEmit`.
6. **Add the private methods** `buildSearchQuery`, `applySearchQuery`, `runSearchCommand`, `setSearchPanelOpen`, `syncSearchPanelFields`, `openSearch`, `closeSearch`, and the `doLayout` override, per *Internal Structure*.
7. **Edit `CodeEditor.mount()`.** Add the `Prec.high(keymap.of([...]))` entry to the `extensions` array — placed immediately after the existing `keymap.of([...])` at [:1408](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1408) — and the two `searchPanelOpen` / `getSearchQuery` blocks inside the existing `updateListener`. Leave `search()` and `searchKeymap` untouched. — verify: `grep -n "searchKeymap" packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — expect exactly two matches, the import and the original `keymap.of` array.
8. **Leave `CodeEditor.destructor()` unchanged.** `Component.destructor` recurses into `addComponent`-registered children ([Component.ts:1045-1048](packages/lib/src/typescript/lib/core/Component.ts#L1045-L1048)), so the search panel is torn down by the existing `super.destructor()` call at [:1308](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1308). — verify: `git diff packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` shows no changed line between `protected destructor()` and its closing brace.
9. **Extend `packages/lib/tests/component/code-editor.test.ts`** with the new `describe` blocks from *Expected Behaviour* §A, and re-run the existing suite.
10. **Update `packages/lib/docs/components/CodeEditor.md`** per *Documentation Impact*.
11. **Full verification pass** — see *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/editor/CodeEditorSearchPanel.ts` |
| Create | `packages/lib/tests/component/code-editor-search-panel.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/theme.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |

No call site of `CodeEditor` changes.[^call-sites]

---

## Expected Behaviour

### A. `CodeEditor` — offline-testable

1. A freshly constructed `CodeEditor` reports exactly one child (`getComponents().length === 1`), and that child is undisplayed (`isDisplayed() === false`).
2. That child's controls are not built: `isBuilt() === false`.
3. `getLayoutManager()` is an `Anchor` instance, and a second `CodeEditor` gets a *different* `Anchor` instance.
4. `getPreferredSize()` is still `null` before any `syncAutoHeight` call — the existing assertion at [code-editor.test.ts:1780](packages/lib/tests/component/code-editor.test.ts#L1780) must keep passing unchanged.
5. `getOverflowX()` and `getOverflowY()` are still `"auto"`, and the eased wheel scroller still attaches — the existing assertions at [:2236-2249](packages/lib/tests/component/code-editor.test.ts#L2236-L2249) must keep passing unchanged.
6. `getScrollElement()` still returns `getElement(true)` with no live view — [:2251-2259](packages/lib/tests/component/code-editor.test.ts#L2251-L2259) unchanged.
7. `setSearchPanelOpen(true)` builds the search panel's controls and displays it; `setSearchPanelOpen(false)` hides it. A second `setSearchPanelOpen(true)` does not rebuild the controls.
8. `buildSearchQuery({ search: "ab", replace: "cd", caseSensitive: true, wholeWord: false, regexp: true })` returns a `SearchQuery` whose `search`, `replace`, `caseSensitive`, `wholeWord` and `regexp` match, and whose `literal` is `false`.
9. With no mounted view, `runSearchCommand("findnext")` and `applySearchQuery(...)` are no-ops that do not throw — the same null-view guard every other editor operation has.
10. `dispose()` on a `CodeEditor` whose search panel was opened leaves the construct/destroy counters balanced and the rule cache clean — this is the existing `dispose-full-teardown.test.ts` row at [:136](packages/lib/tests/component/dispose-full-teardown.test.ts#L136), which needs no edit.

### B. `CodeEditorSearchPanel` — offline-testable

1. A new search panel has no children until `buildControls()`; after it, `getComponents().length === 2` (the two rows).
2. `buildControls()` twice leaves the child count at 2.
3. `getFields()` on a freshly built search panel returns all-empty strings and all-`false` flags.
4. `setFields({...})` then `getFields()` round-trips every field.
5. `setFields(...)` emits no `"querychange"`.
6. Every action button's `"action"` emits `"command"` with the matching id: prev → `"findprevious"`, next → `"findnext"`, select-all → `"selectall"`, replace → `"replacenext"`, replace-all → `"replaceall"`, close → `"close"`.
7. Each of the three toggles emits `"querychange"` whose payload carries its new flag state.
8. A `keydown` of `Enter` on the find field emits `"findnext"` and returns `{ stop: true, prevent: true }`; with `shiftKey` it emits `"findprevious"`; `Escape` emits `"close"`; an unrelated key emits nothing and returns `false`.
9. `Enter` on the replace field emits `"replacenext"`; `Escape` emits `"close"`.
10. Every button reports its title in `aria-label` and renders no visible text (`isShowText() === false`).
11. `fitWithin(availableWidth)` on an undisplayed search panel changes nothing; on a displayed search panel with a host it never leaves the search panel wider than `availableWidth - margin * 2`.

### C. Manual verification only (live browser, `npm run dev`, the CodeEditor demo page)

1. `Ctrl-F` shows a rounded, shadowed card in the editor's top-right corner, over the text, with no document reflow and no docked strip at the top or bottom of the editor.
2. Every match in the document is tinted, and the current one more strongly — the `.cm-searchMatch` / `.cm-searchMatch-selected` colours from `theme.ts`.
3. Hovering each of the nine buttons shows its sentence, plus the key hint on a second line where the table lists one.
4. Find next / previous move the selection and wrap at the document ends; select-all creates one selection range per match.
5. Each of the three toggles changes which matches highlight, and its pressed state is visible.
6. Replace changes the current match and advances; replace-all changes every match in one undo step. Both are inert in a `readOnly: true` editor.
7. `Escape` in the document and `Escape` in either field both close the card and return the caret to the document; the highlighting clears.
8. `Ctrl-F` with text selected in the document seeds the find field with that text.
9. The card reads correctly in both light and dark themes after `ThemeManager.setTheme` — no invisible text, no transparent background.
10. `Ctrl-Alt-G` still opens CodeMirror's go-to-line dialog, still styled, and it still docks normally.
11. Wheeling over a fenced code block in a `Markdown` document with the card open scrolls the document, and the card stays pinned.
12. A `CodeEditor` narrower than the card shows no horizontal scrollbar on its outer box.

---

## Verification

- `npm run typecheck` (or `npx tsc --noEmit` in `packages/lib`) — clean.
- `npx vitest run tests/component/code-editor.test.ts tests/component/code-editor-search-panel.test.ts tests/component/dispose-full-teardown.test.ts tests/component/dispose-listener-teardown.test.ts tests/component/markdown-editor.test.ts tests/component/display/Markdown.test.ts` — all green.
- `npx vitest run` — full suite green; the two exact-array baselines in `dispose-full-teardown.test.ts:581-583` and `dispose-listener-teardown.test.ts:135` must still hold with **no** edit to their baseline lists.
- `npm run lint` — the `local/no-raw-dom` rule has an empty baseline; nothing added here touches raw DOM.
- `npm run docs:api` — zero warnings (`CodeEditorSearchPanel` is not exported from the barrel, so no public JSDoc may `{@link}` it).
- Manual: `npm run dev`, open the CodeEditor demo panel at `localhost:8015`, and walk *Expected Behaviour* §C. Repeat item 11 on a Markdown page with fenced code blocks.

---

## Documentation Impact

`CodeEditorSearchPanel` is not exported from `packages/lib/src/typescript/lib/component/editor/index.ts`, so it needs no API page, no catalogue entry, and no `llms.txt` line.

`packages/lib/docs/components/CodeEditor.md`:

- **Keyboard table** ([:170-179](packages/lib/docs/components/CodeEditor.md#L170-L179)) — change `Ctrl-F` to "Open the floating search panel" and `Escape` to "Close the floating search panel"; add rows for `Enter` / `Shift+Enter` in the find field and `Enter` in the replace field.
- **New "Search and replace" section** after "Keyboard" — describe the corner-pinned card, list the nine controls with their tooltips, and say plainly that it overlays the document rather than docking.
- **Theming section** ([:210](packages/lib/docs/components/CodeEditor.md#L210)) — the sentence naming "the search panel" among the token-themed pieces needs rewording: the search UI is now framework components carrying the framework's own tokens, while the match highlighting is still themed here.
- Line 3's scope sentence already says "search"; no change.

---

## Potential Challenges

- **`:has()` support.** The container-collapse rule uses `:has()`. Every browser this library targets supports it, and the project already relies on similarly-recent CSS (`color-mix` in the same file). If it fails to apply, the visible symptom is a stray 1px line at the editor's bottom edge while search is open — not a functional break.
- **A wheel over the card scrolls the document behind it.** `isForeignWheelTarget` only carves out `.cm-tooltip`, so the framework's eased scroller claims a wheel over the card. Accepted: the card holds no scrollable content, and adding a second carve-out would widen a hot path for a cosmetic gain.
- **`Ctrl-F` inside the find field opens the browser's own find.** CodeMirror never sees the key because focus is outside the editor. Accepted — matching it would need a framework-level `keydown` binding on the field with no clear win.
- **`Markdown`'s upgraded code blocks have no parent component.** Each upgraded editor is raw-appended with no `Component` parent ([Markdown.ts:1116-1145](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1116-L1145)), so its `Anchor` pass only runs off the global pending-layout flush. `setSearchPanelOpen`'s explicit `scheduleLayout()` is what feeds that flush; without it the card would render at `(0, 0)` with no size.
- **A new library class declaring `protected destructor()` or calling `Event.addListener(this, …)` breaks an exact-equality baseline test.** `CodeEditorSearchPanel` must do neither.[^no-destructor]

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` | The component being changed; read `mount()`, `destructor()`, `getScrollElement()`, `isForeignWheelTarget()`, `syncAutoHeight()` before touching anything |
| `packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts` | The precedent: an `Anchor` host with `FloatingPanel` children, a `doLayout` override that re-places them, and glyph-only control buttons |
| `packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts` | The precedent for a `FloatingPanel` subclass with its own chrome and `ownClassStyleDefaults` |
| `packages/lib/src/typescript/lib/component/container/FloatingPanel.ts` | Corner/margin resolution, the `getAnchorConstraints()` host contract, and `placeNextTo` as the model for `fitWithin` |
| `packages/lib/src/typescript/lib/layout/Anchor.ts` | Why the host reports no intrinsic size, and why an oversized child overflows |
| `packages/lib/docs/components/Button.md` | The `showText: false` / `showDescription: false` tooltip contract |
| `packages/lib/src/typescript/lib/component/input/SpinButton.ts` | The canonical module-level `Glyph.register(...)` form |
| `packages/lib/src/typescript/lib/component/editor/theme.ts` | Where the two hide rules go, and which existing rules the go-to-line dialog still needs |
| `packages/lib/tests/component/code-editor.test.ts` | The offline harness conventions this change's tests must follow |
| `node_modules/@codemirror/search/dist/index.d.ts` | The exact `SearchQuery` / command / `setSearchQuery` signatures |

---

## Non-Goals

- **A "N of M matches" readout.** Counting is mechanically easy — `getSearchQuery(state).getCursor(state)` iterates matches — but it is an O(document) walk on every keystroke, with no incremental hook to hang it on. Not asked for as a requirement, so it is out.
- **Making the card draggable, resizable, or dockable.** The corner-pinned, non-draggable shape is settled; a draggable `Window` with a title bar, or a `Popover`, is out of scope.
- **Exposing `CodeEditorSearchPanel` publicly.** It has no use outside `CodeEditor` and would need its own doc page, catalogue entry and API surface for no gain.
- **Converting `CodeEditor` to `Panel`.** See the first architecture decision.
- **Replacing `searchKeymap`'s other bindings.** `F3`, `Ctrl-G`, `Ctrl-D`, `Ctrl-Shift-L` and `Ctrl-Alt-G` keep working exactly as they do today.
- **Restyling `.cm-searchMatch` / `.cm-selectionMatch`.** The existing match colours in `theme.ts` are correct and stay.

---

## Notes

[^no-panel]: Approach (a) — convert `CodeEditor` to `Panel`, give it `Anchor`, and move CodeMirror's mount onto a new inner full-fill child — was investigated in detail and rejected. It costs four separate regressions and buys nothing. First, `Panel.applyOptions` unconditionally dispatches `setAutoScroll(...)` *after* `super.applyOptions()` has handled `options.overflow`, and the `"none"` branch writes `overflow: hidden` on both axes — silently defeating `_defaultCodeEditorOptions.overflow: "auto"` and, with it, the eased wheel scroller the whole scroll story depends on (`core/Panel.ts:264`, `:284`, `:343-345` against `core/Component.ts:811`). Second, `Panel`'s default insets are `Insets(4,4,4,4)` rather than zero, changing `getInnerSize()` and every height number the auto-height suite asserts. Third, `clampsToContentSize()` flips from `true` to `false` (`core/Container.ts:49-51`), changing what `setAutoHeight`'s `setHeight` clamp does for the `Fit`- and `VBox`-hosted editors in `CodeEditorPanel.ts`. Fourth, an inner mount host would have to re-point `mount()`'s `getElement()`, `mountFlashOverlay`, the `.cm-scroller` / `.cm-content` queries, `getScrollElement()` and `isForeignWheelTarget()`'s climb boundary — and the last of those would break roughly ten existing tests that inject fake `.cm-tooltip` subtrees under `editor.getElement(true)` and rely on the climb terminating there (`code-editor.test.ts:2272-2545`). Against all that, the only thing approach (a) would provide is child-hosting and a layout manager, and `Component` already provides both.

[^lazy-controls]: `Markdown` upgrades every fenced code block on a page into its own `CodeEditor` (`Markdown.ts:1093-1146`). Building the full control cluster eagerly would add roughly thirteen components — two text fields, nine buttons, two rows — to every one of them, for a card most readers never open. Deferring the build to the first open keeps the per-editor cost at one undisplayed `FloatingPanel`. The guard is a single `isBuilt()` check at the top of `buildControls()`; the search panel is still registered eagerly, because that is the only point at which registration is safe.

[^panel-gate]: `@codemirror/search`'s match highlighter returns `Decoration.none` whenever the search state's `panel` is `null` — `highlight({ query, panel }) { if (!panel || !query.spec.valid) return Decoration.none; … }` in `node_modules/@codemirror/search/dist/index.js`. So discarding the stock panel outright would silently drop the highlighting of every match, which is a feature the current editor has. Supplying `search({ createPanel })` with a stub panel is the officially sanctioned override, but the stub must hand CodeMirror a live `HTMLElement`, and the DOM seam has no route to one outside `mountView`'s factory — the `local/no-raw-dom` rule has an empty baseline. Leaving CodeMirror's panel state open and hiding its DOM from the theme costs two CSS rules, touches nothing else, and keeps `openSearchPanel` / `closeSearchPanel` / `searchPanelOpen` usable as the open-state machinery. The cost is one undocumented dependency on CodeMirror's internals, which is why the theme rules carry a comment saying what they are for.

[^valid-guard]: `@codemirror/search` wraps `findNext`, `findPrevious`, `selectMatches`, `replaceNext` and `replaceAll` in `searchCommand(f)`, which falls back to `openSearchPanel(view)` whenever the current query is absent or invalid. With the stock panel already open, that fallback re-seeds the query from the editor's current selection — which would silently overwrite whatever the user has typed in the find field. Guarding on `getSearchQuery(view.state).valid` skips the command entirely instead. An empty or malformed query has nothing to find, so nothing is lost.

[^own-bindings]: Relying on `searchKeymap`'s own `Mod-f` and `Escape` almost works — `openSearchPanel` flips CodeMirror's own panel state, and the `updateListener` would show the search panel. It fails in one case: `Ctrl-F` pressed while the search panel is already open and nothing is selected dispatches no transaction at all, so no update fires and focus never returns to the find field. `Escape` has the complementary problem: the close path needs to hand focus back to the document, which `closeSearchPanel` only does when CodeMirror's own panel holds the active element — and a `display: none` panel never can. Two `Prec.high` bindings make both behaviours explicit rather than emergent. `searchKeymap` stays installed for everything else; its now-shadowed `Mod-f` and `Escape` entries are harmless.

[^glyph-fit]: The glyph catalogue is Font Awesome Free 7.2.0 (`packages/lib/src/typescript/lib/glyphs/README.md`), which has no icon for case-sensitivity, whole-word matching, or "replace all". `font` (a stylised "A") for match case, `text-width` (an "A" between horizontal arrows) for whole word, and `layer-group` for replace all are the nearest available metaphors; `asterisk` stands in for the regular-expression toggle, echoing the `.*` VS Code uses. All four lean on their tooltips to be legible, which is why the tooltip sentences describe the behaviour rather than naming the icon. Adding hand-drawn SVG glyphs for the three would be a separate, larger change than this feature warrants, and the user's requirement is glyph-only buttons *with* descriptive tooltips.

[^no-destructor]: `dispose-full-teardown.test.ts:573-583` asserts exact array equality between the classes that declare `protected destructor()` and a hand-kept baseline, and `dispose-listener-teardown.test.ts:135` does the same for classes calling `Event.addListener(this, …)`. Both scanners match on source text, so a new class tripping either one fails a test that has nothing to do with this feature. `CodeEditorSearchPanel` needs neither: its children are all `addComponent`-registered, so `Component.destructor`'s recursion tears them down; its `ListenerBag` goes through `registerListenerBag`; and it listens to its own children through their typed `on()` surfaces, never through the raw `Event` API — which is what `ARCHITECTURE.md` requires anyway.

[^call-sites]: All three production call sites were checked. `CodeEditorPanel.ts:123` / `:167-169` / `:201-203` uses only public methods and hosts the editor in `Fit` and `VBox` — both treat it as an opaque leaf. `MarkdownEditor.ts:827-834` registers it as a `Card`-managed child addressed by id, and its `destructor` deliberately relies on the framework's child recursion (`:1545-1561`), which is unaffected. `Markdown.ts:1142` raw-appends `editor.getElement(true)` into a wrapper and sizes the editor with `setX` / `setY` / `setWidth` / `setHeight` — the outer element stays the sized, wrapper-filling box, which is exactly what this plan preserves by not introducing an inner mount host.

---

## Implementation Notes

- **Dirty-fold leak, found live and fixed.** `_findField` / `_replaceField` are real `TextField` (`AbstractInput`) children, and `Component.wireChild` folds a child's own uncommitted-edit tracking into every ancestor's `isDirty()` unconditionally — there is no opt-out at the base class. Left as the plan specified, typing a search query flipped `CodeEditor.isDirty()` true even though the document itself never changed (confirmed live via the CodeEditor demo panel's own dirty-state readout). `CodeEditorSearchPanel.notifyQueryChange()` now calls `markClean()` on both text fields before emitting `"querychange"`, since the typed query is ephemeral UI state with no document-dirty semantics of its own. Pinned by two new tests in `code-editor-search-panel.test.ts` and one in `code-editor.test.ts`, all reproducing the exact interaction order a real keystroke drives (the base `TextInput` input handler's `notifyChange()` runs, and sets the field dirty, before this panel's own `"action"` listener — registered afterward, in `buildControls()` — has a chance to clean it up again).
- **`default-options-fallback.test.ts` gained four rows for `CodeEditorSearchPanel`.** Not listed in the plan's Files table, but required by `ARCHITECTURE.md`'s *Class-level defaults must survive the getter*: any class declaring `ownClassStyleDefaults` needs a row per defaulted field, mirroring the existing `MarkdownMinimap` rows. Added `backgroundColor` / `shadow` / `borderRadius` (rendered) plus `insets`, following the same pattern.
- **Row/control spacing constants** (`ROW_SPACING_PX`, `CONTROL_SPACING_PX`, `FIELD_WIDTH_PX` in `CodeEditorSearchPanel.ts`) are implementation-detail values the plan's *Internal Structure* named but did not pin a number for; picked to match the codebase's existing `VBox`/`HBox` spacing precedent (`MarkdownViewer`'s and `MarkdownMinimap`'s own `spacing: 4`).
- **Manual verification (Expected Behaviour §C):** items 1, 2 (partially — match tinting confirmed, not the exact selected-vs-unselected colour delta), 3 (tooltip text + key-hint second line, confirmed via a real hover-triggered tooltip), 4 (find next moves the caret to the match), and 7 (`Escape` in the document closes the card and returns the caret, with no residual docked strip) were spot-checked live against the CodeEditor demo panel in a real browser (`npm run dev` in this worktree, a temporary port to avoid the main tree's own dev server). This pass is what surfaced the dirty-fold bug above. Items 5 (toggle pressed-state colouring), 6 (replace / replace-all mutating the document, and their read-only inertness), 8 (`Ctrl-F` seeding the find field from a selection), 9 (dark theme), 10 (`Ctrl-Alt-G` go-to-line), 11 (wheel-over-fenced-code-block in a `Markdown` document), and 12 (no horizontal scrollbar on a narrow editor) were not re-verified beyond the implementation's design rationale already recorded in the plan's *Architecture Decisions* / *Potential Challenges* — still open for the user's own pass.
