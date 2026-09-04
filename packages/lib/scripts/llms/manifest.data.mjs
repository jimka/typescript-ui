// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Hand-authored seam for the AI-agent capability manifest (`llms.txt`).
 *
 * This is the ONLY file a human edits for the manifest. It holds the curated,
 * task-organised spine — which components belong in the anti-reinvention catalog,
 * how each is phrased as a task, the hard-rule conventions, and the prose blocks.
 * Everything else (import subpath, one-line summary, doc link) is derived from the
 * TypeDoc JSON model by `generate.mjs`, so those columns can never drift from source.
 *
 * Catalog entry shape: `{ task, symbol, subpath?, doc? }`.
 *   - `task`    — human task phrasing ("Split view with a draggable divider").
 *   - `symbol`  — the exported class name; resolved against the TypeDoc model. A name
 *                 absent from the model fails the build (drift guard).
 *   - `subpath` — OPTIONAL `package.json` exports key, required only when the bare
 *                 symbol name exists in more than one module (e.g. `TreeNode`); the
 *                 generator throws on an ambiguous name with no disambiguator.
 *   - `doc`     — OPTIONAL repo-relative doc override. Omit for a component with a
 *                 `docs/components/<Name>.md` or `docs/layouts/<Name>.md` page
 *                 (auto-derived); supply it when the page name differs (data layer).
 *
 * Internal/abstract exports (AbstractInput, DragManager, BaseObject, …) are
 * deliberately absent — the catalog is task-facing, not an export dump.
 */

export const groups = [
    { name: "Layouts", entries: [
        { task: "Stack children vertically", symbol: "VBox" },
        { task: "Lay children out in a horizontal row", symbol: "HBox" },
        { task: "Dock regions around a center (north/south/east/west/center)", symbol: "Border" },
        { task: "Split view with a draggable divider", symbol: "Split" },
        { task: "Rows-and-columns grid with sized tracks", symbol: "Grid" },
        { task: "Tabbed panels sharing one region", symbol: "Tab" },
        { task: "Card stack showing one child at a time", symbol: "Card" },
        { task: "Collapsible accordion sections", symbol: "Accordion" },
        { task: "Stretch a single child to fill the container", symbol: "Fit" },
        { task: "Wrap children like text that reflows (horizontal flow)", symbol: "HFlow" },
    ] },

    { name: "Containers / Windows", entries: [
        { task: "Group labelled form fields in a bordered box", symbol: "FieldSet" },
        { task: "Auto-build a labelled form from a field descriptor list", symbol: "LabeledFieldSet" },
        { task: "Line up labelled components without a border/legend", symbol: "LabeledGrid" },
        { task: "Self-managing tab container (add/close/select tabs)", symbol: "TabPanel" },
        { task: "Self-managing accordion of collapsible sections", symbol: "AccordionPanel" },
        { task: "Bottom status bar with segments", symbol: "StatusBar" },
        { task: "Virtualize a huge child list (render only visible rows)", symbol: "VirtualScroller" },
        { task: "Mutually-exclusive group of toggle buttons", symbol: "ButtonGroup" },
        { task: "Corner-pinned floating panel", symbol: "FloatingPanel" },
    ] },

    { name: "Inputs / Forms", entries: [
        { task: "Semantic <form> container with submit handling", symbol: "Form" },
        { task: "Push button", symbol: "Button" },
        { task: "Two-state toggle button", symbol: "ToggleButton" },
        { task: "Button with a primary action plus a dropdown menu", symbol: "SplitButton" },
        { task: "Button whose click opens a dropdown menu", symbol: "MenuButton" },
        { task: "Button whose click opens a custom popup panel", symbol: "PopupButton" },
        { task: "Clickable text link that activates in-app (click / Enter)", symbol: "Link" },
        { task: "Checkbox", symbol: "Checkbox" },
        { task: "Radio button (mutually exclusive within a group)", symbol: "RadioButton" },
        { task: "On/off switch", symbol: "Toggle" },
        { task: "Slider for a numeric range", symbol: "Slider" },
        { task: "Single-line text field", symbol: "TextField" },
        { task: "Multi-line text area", symbol: "TextArea" },
        { task: "Masked password field", symbol: "PasswordField" },
        { task: "Username / login-identifier field", symbol: "UsernameField" },
        { task: "Numeric input with up/down spinners", symbol: "NumberSpinner" },
        { task: "Dropdown select bound to a store", symbol: "ComboBox" },
        { task: "Type-ahead field with autocomplete suggestions", symbol: "AutoCompleteField" },
        { task: "Date picker field", symbol: "DateField" },
        { task: "Combined date-and-time picker field", symbol: "DateTimeField" },
        { task: "File chooser field", symbol: "FileField" },
    ] },

    { name: "Data / Tables / Trees", entries: [
        { task: "Editable data grid / spreadsheet-style table, with per-column or per-cell editor/renderer types", symbol: "Table", doc: "docs/components/Table.md" },
        { task: "Store-bound table with a scroll frame and toolbar", symbol: "TablePanel" },
        { task: "Table whose rows form an expandable tree", symbol: "TreeTable" },
        { task: "Expandable tree of nodes", symbol: "Tree" },
        { task: "Single-select scrollable list", symbol: "List" },
        { task: "Multi-select list", symbol: "MultiSelectList" },
    ] },

    { name: "Charts / Diagrams", entries: [
        { task: "Line chart over a linear or time x axis", symbol: "LineChart" },
        { task: "Grouped or stacked bar chart over a category axis", symbol: "BarChart" },
        { task: "Clickable series legend for a chart", symbol: "ChartLegend" },
        { task: "Auto-laid-out graph / diagram viewer with pan and zoom", symbol: "DiagramView" },
    ] },

    { name: "Display", entries: [
        { task: "Heading / section title text", symbol: "Header" },
        { task: "Image", symbol: "Image" },
        { task: "Font-Awesome icon glyph", symbol: "Glyph" },
        { task: "Icon paired with a label", symbol: "IconLabel" },
        { task: "Render a Markdown string as formatted content", symbol: "Markdown" },
        { task: "Floating heading-outline minimap", symbol: "MarkdownMinimap" },
        { task: "Markdown viewer with minimap and zoom controls", symbol: "MarkdownViewer" },
        { task: "Syntax-highlighted code editor with formatting, folding, search, lint and completion", symbol: "CodeEditor" },
        { task: "WYSIWYG rich-text editor whose value is a Markdown string", symbol: "MarkdownEditor" },
        { task: "Determinate/indeterminate progress bar", symbol: "ProgressBar" },
        { task: "Spinning busy indicator", symbol: "ProgressSpinner" },
        { task: "Page-through pagination controls", symbol: "PaginationBar" },
        { task: "Custom 2D drawing surface", symbol: "Canvas" },
        { task: "Custom GPU drawing surface (WebGL2)", symbol: "WebGLCanvas" },
        { task: "Bare native video surface", symbol: "Video" },
        { task: "Video player with a themable control bar", symbol: "VideoPlayer" },
        { task: "Bulleted (unordered) list of items", symbol: "BulletedList" },
        { task: "Numbered (ordered) list of items", symbol: "NumberedList" },
    ] },

    { name: "Overlays", entries: [
        { task: "Floating draggable/resizable window", symbol: "Window" },
        { task: "Window whose body is a tab container", symbol: "TabWindow" },
        { task: "Modal dialog (alert/confirm/prompt/custom)", symbol: "Dialog" },
        { task: "Edge-anchored sliding drawer", symbol: "Drawer" },
        { task: "Context / dropdown menu", symbol: "Menu" },
        { task: "Checkbox row in a menu", symbol: "CheckboxMenuRow" },
        { task: "Radio row in a menu", symbol: "RadioMenuRow" },
        { task: "Anchored floating popover", symbol: "Popover" },
        { task: "Custom popup panel anchored to a trigger", symbol: "PopupPanel" },
        { task: "Hover tooltip", symbol: "Tooltip" },
        { task: "Transient toast notification", symbol: "Notification" },
        { task: "Browse / re-open past notifications", symbol: "NotificationHistoryButton" },
        { task: "Live runtime diagnostics window (FPS, heap, components, layout, listeners, CSS rules)", symbol: "DiagnosticsOverlay" },
        { task: "Stylesheet duplicate-rule audit window (per-instance rule dedup by wasted bytes)", symbol: "StyleAuditOverlay" },
    ] },

    { name: "Data layer", entries: [
        { task: "In-memory record collection backing a table/list", symbol: "Store", doc: "docs/data/store.md" },
        { task: "Store that loads/saves rows over a REST endpoint", symbol: "AjaxStore", doc: "docs/data/store.md" },
        { task: "Typed record schema (fields, defaults, validation)", symbol: "Model", doc: "docs/data/model.md" },
        { task: "A single editable record instance", symbol: "ModelRecord", doc: "docs/data/record.md" },
        { task: "Declare a typed field on a model", symbol: "Field", doc: "docs/data/model.md" },
        { task: "Two-way bind a component property to a record field", symbol: "Binding", doc: "docs/data/binding.md" },
        { task: "Hierarchical store for tree data", symbol: "TreeStore", doc: "docs/data/store.md" },
        { task: "Node in a tree store", symbol: "TreeNode", subpath: "data", doc: "docs/data/store.md" },
        { task: "Relate models (has-many / belongs-to)", symbol: "Association", doc: "docs/data/associations.md" },
    ] },

    { name: "App shell", entries: [
        { task: "Map the URL to a top-level app section", symbol: "Router", doc: "docs/concepts/routing.md" },
        { task: "Give the app a browser-tab icon", symbol: "Favicon", doc: "docs/components/Body.md" },
    ] },
];

export const conventions = [
    { rule: "Never use CSS flex/grid or `position: relative` — arrange children with a LayoutManager (HBox/VBox/Border/Grid/Split/…).", doc: "docs/concepts/layout-system.md" },
    { rule: "Size with setMinSize/setPreferredSize/setMaxSize honouring min ≤ preferred ≤ max; to scroll, wrap content in a Panel with autoScroll — never `overflow` CSS.", doc: "docs/concepts/sizing.md" },
    { rule: "Construct with the callable + options-bag idiom (`Button({ text })`), not post-construction setters; reserve `setX` for runtime changes.", doc: "docs/recipes/component-options.md" },
    { rule: "Mount the top-level layout with `Body.init({ layoutManager, components })` — one call; use `Body.getInstance()` only to reach the body afterwards.", doc: "docs/components/Body.md" },
    { rule: "Route DOM events through the `Event` class (`Event.addListener`); emit and observe semantic events with `on`/`off`/`emit`. Never call `addEventListener`.", doc: "docs/concepts/events.md" },
    { rule: "Theme through design tokens, never hardcoded colours.", doc: "docs/concepts/theming.md" },
    { rule: "Move data through Model/Store/Binding, not manual DOM writes — bind components to records instead of pushing values by hand.", doc: "docs/concepts/data-binding.md" },
    { rule: "One DOM element per component class; touch the element only at render time, not from a setter dispatched during construction.", doc: "docs/concepts/component-lifecycle.md" },
];

// Prose blocks. Links appear ONLY as `{{key}}` placeholders naming a `proseTargets`
// entry, never as baked-in paths — the generator rewrites each placeholder through
// linkFor(target, mode), so the same block renders repo-relative paths in `llms.txt`
// and site URLs in `docs/public/llms.txt`.
export const mentalModel =
    `This is a layout-driven, retained-mode framework — closer to Java Swing than to ` +
    `React or HTML flow. There is no flexbox, no CSS grid, no document flow: every ` +
    `Component is a rectangle absolutely positioned and sized in JavaScript by a ` +
    `LayoutManager in a single doLayout() pass. Construct UIs declaratively with the ` +
    `callable + options-bag idiom — ` +
    "`Panel({ layoutManager: VBox(), components: [Text('Name'), ComboBox()] })`. " +
    `Theming is token-based; DOM events go through the Event class, semantic events ` +
    `through on/off/emit. Full orientation: {{guide/mental-model}}.`;

export const drillDown =
    `- Component & layout detail (options, examples) → {{components/}}, {{layouts/}}\n` +
    `- Full generated API reference → {{api/}}\n` +
    `- Framework internals & binding rules → {{ARCHITECTURE}}`;

export const devAppendix =
    `Building the library itself (not just apps against it): read {{ARCHITECTURE}} ` +
    `(event surfaces, one-DOM-element-per-class, absolute positioning, the ` +
    `size-constraint contract, typed-setter rules) and {{CODE_CONVENTIONS}}. ` +
    `Concepts index: {{concepts/}}.`;

// Canonical (repo-relative) form of every link a prose placeholder may reference.
// A trailing-slash target is a docs section root; ARCHITECTURE / CODE_CONVENTIONS are
// repo-root docs the site does not publish (GitHub-blob URL in site mode). linkFor
// handles page, section-root, and repo-root targets uniformly.
export const proseTargets = {
    "guide/mental-model": "docs/guide/mental-model.md",
    "components/": "docs/components/",
    "layouts/": "docs/layouts/",
    "concepts/": "docs/concepts/",
    "api/": "docs/api/",
    "ARCHITECTURE": "ARCHITECTURE.md",
    "CODE_CONVENTIONS": "CODE_CONVENTIONS.md",
};
