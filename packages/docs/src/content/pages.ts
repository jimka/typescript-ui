import { expandContainers } from './containers.js';
import { compareLabels } from './labelOrder.js';

/** A single migrated documentation page. */
export interface DocPage {
    /** The route path, e.g. `/guide/installation` — no trailing slash. */
    path:   string;
    /** The page's title, taken from its first `# ` heading. */
    title:  string;
    /** The page's Markdown source, with `:::` containers already expanded. */
    source: string;
}

/**
 * A sidebar entry: a page's route path plus the label shown for it in the
 * tree. The label is hand-authored from the VitePress sidebar (config.mts)
 * rather than taken from the page's `# ` heading, because the two differ for
 * three pages and a heading may carry inline Markdown (e.g. backticks) that
 * must not leak into a plain tree label.
 */
export interface NavEntry {
    path:  string;
    label: string;
}

/** A sidebar section: a titled group of entries, optionally holding subgroups. */
export interface NavGroup {
    title:   string;
    /**
     * The route of this group's own index page, which clicking the group's
     * tree node navigates to. Usually absent for a subgroup — most are pure
     * groupings with no page of their own — but a subgroup may carry one
     * when it does have a genuine index page, as Reference's Changelog and
     * Migration subgroups do.
     */
    path?:   string;
    /** Pages sitting directly under this group's node, rendered first. */
    pages:   NavEntry[];
    /** Nested subgroups, rendered after `pages`. Two levels deep at most. */
    groups?: NavGroup[];
}

// `import.meta.glob` keys arrive as `../../../lib/docs/guide/installation.md`
// relative to this file (packages/docs/src/content/pages.ts), so
// `../../../lib/docs/` resolves to packages/lib/docs/ — the VitePress source
// this app reads unmodified. See "Markdown content migrates as-is" in
// plans/implemented/packages-docs.md. `reference/changelog` and
// `reference/migration` are listed explicitly alongside the seven
// single-level groups because their per-version pages sit one directory
// deeper (`reference/changelog/0.4.0.md`, `reference/migration/0.4.0.md`).
const RAW_SOURCES = import.meta.glob(
    '../../../lib/docs/{guide,concepts,components,layouts,data,recipes,reference,reference/changelog,reference/migration}/*.md',
    {
        query:  '?raw',
        import: 'default',
        eager:  true,
    },
) as Record<string, string>;

/**
 * Maps a glob key to its route path: strips the `../../../lib/docs` prefix
 * and the `.md` extension, and collapses a trailing `index` onto the
 * directory path — `.../guide/index.md` becomes `/guide`, not `/guide/`,
 * matching what the library `Router` hands a route handler (it normalizes
 * away a trailing slash).
 *
 * @param globKey - The glob-relative path, e.g. `../../../lib/docs/guide/index.md`.
 * @returns The route path, e.g. `/guide`.
 */
function routePathFor(globKey: string): string {
    const withoutPrefix = globKey.replace(/^\.\.\/\.\.\/\.\.\/lib\/docs/, '');
    const withoutExt    = withoutPrefix.replace(/\.md$/, '');

    return withoutExt.replace(/\/index$/, '');
}

/**
 * Reads a page's title from its first `# ` heading, authored in every page
 * in the corpus.
 *
 * @param source - The page's Markdown source.
 * @returns The heading text, or `''` if the source has no `# ` heading.
 */
function titleFor(source: string): string {
    const match = /^# (.+)$/m.exec(source);

    return match ? match[1].trim() : '';
}

const PAGES = new Map<string, DocPage>(
    Object.entries(RAW_SOURCES).map(([globKey, raw]) => {
        const path   = routePathFor(globKey);
        const source = expandContainers(raw);

        return [path, { path, title: titleFor(source), source }];
    }),
);

/**
 * Looks up a migrated page by its route path.
 *
 * @param path - The route path, e.g. `/guide/installation`.
 * @returns The matching {@link DocPage}, or `null` when the path is not one
 *   of the migrated pages.
 */
export function getPage(path: string): DocPage | null {
    return PAGES.get(path) ?? null;
}

/**
 * Looks up a nav table entry, throwing if it isn't a migrated page — a broken
 * entry in the hand-authored {@link getNav} table is an authoring error, not
 * a runtime condition to handle gracefully.
 *
 * @param path - The route path to look up.
 * @returns The matching {@link DocPage}.
 */
function requirePage(path: string): DocPage {
    const page = getPage(path);

    if (page === null) {
        throw new Error(`packages/docs nav table references an unmigrated page: ${path}`);
    }

    return page;
}

/**
 * The sidebar's seven sections, mirroring the VitePress sidebar shape in
 * packages/lib/docs/.vitepress/config.mts (same titles, same order, same
 * unwrap-first-group rule) — see "The sidebar becomes a three-level tree" in
 * plans/implemented/docs-content-migration.md. Each label is copied from that
 * config's `text`, not derived from the page's `# ` heading, so the tree
 * reads exactly as VitePress renders it.
 *
 * @returns The seven nav groups, covering 156 leaf entries plus their seven
 *   section paths and Reference's Changelog and Migration subgroup paths —
 *   165 pages total.
 */
export function getNav(): NavGroup[] {
    const guide: NavEntry[] = [
        { path: '/guide/installation', label: 'Installation' },
        { path: '/guide/mental-model', label: 'Mental model' },
    ];
    const concepts: NavEntry[] = [
        { path: '/concepts/component-lifecycle', label: 'Component lifecycle' },
        { path: '/concepts/construction',        label: 'Constructing components' },
        { path: '/concepts/layout-system',       label: 'Layout system' },
        { path: '/concepts/sizing',              label: 'Sizing' },
        { path: '/concepts/events',              label: 'Events' },
        { path: '/concepts/layering',            label: 'Layering' },
        { path: '/concepts/theming',             label: 'Theming' },
        { path: '/concepts/data-binding',        label: 'Data binding' },
        { path: '/concepts/routing',             label: 'Routing' },
        { path: '/concepts/accessibility',       label: 'Accessibility' },
        { path: '/concepts/performance',         label: 'Performance' },
        { path: '/concepts/dom-seams',           label: 'DOM seams' },
    ];

    const componentsCore: NavEntry[] = [
        { path: '/components/Body',                 label: 'Body' },
        { path: '/components/AbstractWindow',        label: 'AbstractWindow' },
        { path: '/components/Window',                label: 'Window' },
        { path: '/components/TabWindow',             label: 'TabWindow' },
        { path: '/components/Dialog',                label: 'Dialog' },
        { path: '/components/Drawer',                label: 'Drawer' },
        { path: '/components/Rail',                  label: 'Rail' },
        { path: '/components/Dock',                  label: 'Dock' },
        { path: '/components/Tooltip',                label: 'Tooltip' },
        { path: '/components/DiagnosticsOverlay',      label: 'DiagnosticsOverlay' },
        { path: '/components/StyleAuditOverlay',       label: 'StyleAuditOverlay' },
        { path: '/components/Popover',                label: 'Popover' },
        { path: '/components/PopupPanel',              label: 'PopupPanel' },
        { path: '/components/Notification',           label: 'Notification' },
        { path: '/components/NotificationHistoryButton', label: 'NotificationHistoryButton' },
        { path: '/components/AnimatedDropdown',       label: 'AnimatedDropdown' },
    ];
    const componentsButtons: NavEntry[] = [
        { path: '/components/Button',         label: 'Button' },
        { path: '/components/ToggleButton',   label: 'ToggleButton' },
        { path: '/components/SplitButton',    label: 'SplitButton' },
        { path: '/components/MenuButton',     label: 'MenuButton' },
        { path: '/components/PopupButton',    label: 'PopupButton' },
        { path: '/components/RadioButton',    label: 'RadioButton' },
        { path: '/components/ButtonGroup',    label: 'ButtonGroup' },
        { path: '/components/SpinButton',     label: 'SpinButton' },
        { path: '/components/TabButton',      label: 'TabButton' },
        { path: '/components/TabCloseButton', label: 'TabCloseButton' },
    ];
    const componentsInputs: NavEntry[] = [
        { path: '/components/Form',              label: 'Form' },
        { path: '/components/TextField',         label: 'TextField' },
        { path: '/components/TextArea',          label: 'TextArea' },
        { path: '/components/PasswordField',     label: 'PasswordField' },
        { path: '/components/UsernameField',     label: 'UsernameField' },
        { path: '/components/Checkbox',          label: 'Checkbox' },
        { path: '/components/Toggle',            label: 'Toggle' },
        { path: '/components/ComboBox',          label: 'ComboBox' },
        { path: '/components/AutoCompleteField', label: 'AutoCompleteField' },
        { path: '/components/DateField',         label: 'DateField' },
        { path: '/components/TimeField',         label: 'TimeField' },
        { path: '/components/DateTimeField',     label: 'DateTimeField' },
        { path: '/components/NumberSpinner',     label: 'NumberSpinner' },
        { path: '/components/Slider',            label: 'Slider' },
        { path: '/components/FileField',         label: 'FileField' },
        { path: '/components/FileDropZone',      label: 'FileDropZone' },
    ];
    const componentsDisplay: NavEntry[] = [
        { path: '/components/Label',           label: 'Label' },
        { path: '/components/Header',          label: 'Header' },
        { path: '/components/Text',            label: 'Text' },
        { path: '/components/Link',            label: 'Link' },
        { path: '/components/Image',           label: 'Image' },
        { path: '/components/Canvas',          label: 'Canvas' },
        { path: '/components/WebGLCanvas',     label: 'WebGLCanvas' },
        { path: '/components/Glyph',           label: 'Glyph' },
        { path: '/components/Glyphs',          label: 'Glyphs' },
        { path: '/components/IconText',        label: 'IconText' },
        { path: '/components/IconLabel',       label: 'IconLabel' },
        { path: '/components/Markdown',        label: 'Markdown' },
        { path: '/components/MarkdownMinimap', label: 'MarkdownMinimap' },
        { path: '/components/MarkdownViewer',  label: 'MarkdownViewer' },
        { path: '/components/CodeEditor',      label: 'CodeEditor' },
        { path: '/components/MarkdownEditor',  label: 'MarkdownEditor' },
        { path: '/components/FieldSet',        label: 'FieldSet' },
        { path: '/components/LabeledFieldSet', label: 'LabeledFieldSet' },
        { path: '/components/LabeledGrid',     label: 'LabeledGrid' },
        { path: '/components/Legend',          label: 'Legend' },
        { path: '/components/ProgressBar',     label: 'ProgressBar' },
        { path: '/components/ProgressSpinner', label: 'ProgressSpinner' },
        { path: '/components/PaginationBar',   label: 'PaginationBar' },
        { path: '/components/Video',           label: 'Video' },
        { path: '/components/VideoPlayer',     label: 'VideoPlayer' },
        { path: '/components/Spacer',          label: 'Spacer' },
        { path: '/components/StatusBar',       label: 'StatusBar' },
    ];
    const componentsCharts: NavEntry[] = [
        { path: '/components/LineChart',   label: 'LineChart' },
        { path: '/components/BarChart',    label: 'BarChart' },
        { path: '/components/ChartLegend', label: 'ChartLegend' },
    ];
    const componentsLists: NavEntry[] = [
        { path: '/components/List',            label: 'List' },
        { path: '/components/MultiSelectList', label: 'MultiSelectList' },
        { path: '/components/ListItem',        label: 'ListItem' },
        { path: '/components/BulletedList',    label: 'BulletedList' },
        { path: '/components/NumberedList',    label: 'NumberedList' },
    ];
    const componentsToolbar: NavEntry[] = [
        { path: '/components/ToolBar',          label: 'ToolBar' },
        { path: '/components/ToolBarSeparator', label: 'ToolBarSeparator' },
    ];
    const componentsMenus: NavEntry[] = [
        { path: '/components/MenuBar',         label: 'MenuBar' },
        { path: '/components/MenuBarButton',   label: 'MenuBarButton' },
        { path: '/components/Menu',            label: 'Menu' },
        { path: '/components/MenuItem',        label: 'MenuItem' },
        { path: '/components/MenuSeparator',   label: 'MenuSeparator' },
        { path: '/components/CheckboxMenuRow', label: 'CheckboxMenuRow' },
        { path: '/components/RadioMenuRow',    label: 'RadioMenuRow' },
    ];
    const componentsTree: NavEntry[] = [
        { path: '/components/Tree', label: 'Tree' },
    ];
    const componentsDiagram: NavEntry[] = [
        { path: '/components/DiagramView', label: 'DiagramView' },
    ];
    const componentsContainers: NavEntry[] = [
        { path: '/components/TabBar',         label: 'TabBar' },
        { path: '/components/TabPanel',       label: 'TabPanel' },
        { path: '/components/AccordionPanel', label: 'AccordionPanel' },
        { path: '/components/FloatingPanel',  label: 'FloatingPanel' },
    ];
    const componentsTable: NavEntry[] = [
        { path: '/components/Table',           label: 'Table' },
        { path: '/components/TablePanel',      label: 'TablePanel' },
        { path: '/components/TreeTable',       label: 'TreeTable' },
        { path: '/components/TreeTablePanel',  label: 'TreeTablePanel' },
        { path: '/components/TableInternals',  label: 'Table internals' },
    ];
    const componentsScrolling: NavEntry[] = [
        { path: '/components/Scrollbar',       label: 'Scrollbar' },
        { path: '/components/ScrollStrip',     label: 'ScrollStrip' },
        { path: '/components/VirtualScroller', label: 'VirtualScroller' },
    ];

    const layouts: NavEntry[] = [
        { path: '/layouts/Constraints', label: 'Constraints' },
    ];
    const layoutManagers: NavEntry[] = [
        { path: '/layouts/Absolute',  label: 'Absolute' },
        { path: '/layouts/Anchor',    label: 'Anchor' },
        { path: '/layouts/Fit',       label: 'Fit' },
        { path: '/layouts/Border',    label: 'Border' },
        { path: '/layouts/HBox',      label: 'HBox' },
        { path: '/layouts/VBox',      label: 'VBox' },
        { path: '/layouts/HFlow',     label: 'HFlow' },
        { path: '/layouts/VFlow',     label: 'VFlow' },
        { path: '/layouts/Grid',      label: 'Grid' },
        { path: '/layouts/Card',      label: 'Card' },
        { path: '/layouts/Tab',       label: 'Tab' },
        { path: '/layouts/Split',     label: 'Split' },
        { path: '/layouts/Accordion', label: 'Accordion' },
    ];
    const docking: NavEntry[] = [
        { path: '/layouts/DockRegion', label: 'DockRegion' },
    ];
    const serialization: NavEntry[] = [
        { path: '/layouts/LayoutSerialization', label: 'Layout serialization' },
    ];

    const data: NavEntry[] = [
        { path: '/data/model',       label: 'Model' },
        { path: '/data/store',       label: 'Store' },
        { path: '/data/proxy',       label: 'Proxy' },
        { path: '/data/record',      label: 'Record' },
        { path: '/data/associations', label: 'Associations' },
        { path: '/data/binding',     label: 'Binding' },
    ];

    const recipesDataUi: NavEntry[] = [
        { path: '/recipes/crud-table',       label: 'CRUD with a Table' },
        { path: '/recipes/bind-form',         label: 'Bind a record to a form' },
        { path: '/recipes/custom-cell',       label: 'Custom cell type' },
        { path: '/recipes/virtualized-list',  label: 'Virtualized lists' },
    ];
    const recipesWindowsDialogs: NavEntry[] = [
        { path: '/recipes/floating-window',   label: 'Floating window' },
        { path: '/recipes/dialog-modal',       label: 'Modal dialog' },
        { path: '/recipes/right-click-menu',  label: 'Right-click menu' },
        { path: '/recipes/notifications',     label: 'Notifications' },
    ];
    const recipesThemingInteraction: NavEntry[] = [
        { path: '/recipes/custom-theme',        label: 'Custom brand theme' },
        { path: '/recipes/keyboard-shortcuts',  label: 'Keyboard shortcuts' },
        { path: '/recipes/drag-and-drop',       label: 'Drag-and-drop' },
        { path: '/recipes/focus-history',       label: 'Focus history' },
    ];
    const recipesConstructionPatterns: NavEntry[] = [
        { path: '/recipes/component-options', label: 'Component constructor options' },
    ];
    const recipesLocalDevelopment: NavEntry[] = [
        { path: '/recipes/local-development', label: 'Linking a local library checkout' },
    ];

    const reference: NavEntry[] = [
        { path: '/reference/glossary',            label: 'Glossary' },
        { path: '/reference/faq',                 label: 'FAQ' },
        { path: '/reference/troubleshooting',     label: 'Troubleshooting' },
        { path: '/reference/browser-support',     label: 'Browser support' },
    ];
    const changelogVersions: NavEntry[] = [
        { path: '/reference/changelog/next', label: 'Next' },
        { path: '/reference/changelog/0.8.0', label: '0.8.0' },
        { path: '/reference/changelog/0.7.0', label: '0.7.0' },
        { path: '/reference/changelog/0.6.0', label: '0.6.0' },
        { path: '/reference/changelog/0.5.0', label: '0.5.0' },
        { path: '/reference/changelog/0.4.1', label: '0.4.1' },
        { path: '/reference/changelog/0.4.0', label: '0.4.0' },
        { path: '/reference/changelog/0.3.0', label: '0.3.0' },
        { path: '/reference/changelog/0.2.0', label: '0.2.0' },
        { path: '/reference/changelog/0.1.1', label: '0.1.1' },
        { path: '/reference/changelog/0.1.0', label: '0.1.0' },
    ];
    const migrationVersions: NavEntry[] = [
        { path: '/reference/migration/next', label: 'Next' },
        { path: '/reference/migration/0.8.0', label: '0.8.0' },
        { path: '/reference/migration/0.6.0', label: '0.6.0' },
        { path: '/reference/migration/0.5.0', label: '0.5.0' },
        { path: '/reference/migration/0.4.1', label: '0.4.1' },
        { path: '/reference/migration/0.4.0', label: '0.4.0' },
        { path: '/reference/migration/0.2.0', label: '0.2.0' },
    ];

    const nav: NavGroup[] = [
        { title: 'Guide',    path: '/guide',    pages: guide },
        { title: 'Concepts', path: '/concepts', pages: concepts },
        {
            title: 'Components',
            path:   '/components',
            pages:  [],
            groups: [
                { title: 'Core',       pages: componentsCore },
                { title: 'Buttons',    pages: componentsButtons },
                { title: 'Inputs',     pages: componentsInputs },
                { title: 'Display',    pages: componentsDisplay },
                { title: 'Charts',     pages: componentsCharts },
                { title: 'Lists',      pages: componentsLists },
                { title: 'Toolbar',    pages: componentsToolbar },
                { title: 'Menus',      pages: componentsMenus },
                { title: 'Tree',       pages: componentsTree },
                { title: 'Diagram',    pages: componentsDiagram },
                { title: 'Containers', pages: componentsContainers },
                { title: 'Table',      pages: componentsTable },
                { title: 'Scrolling',  pages: componentsScrolling },
            ],
        },
        {
            title: 'Layouts',
            path:   '/layouts',
            pages:  layouts,
            groups: [
                { title: 'Layout managers', pages: layoutManagers },
                { title: 'Docking',         pages: docking },
                { title: 'Serialization',   pages: serialization },
            ],
        },
        { title: 'Data', path: '/data', pages: data },
        {
            title: 'Recipes',
            path:   '/recipes',
            pages:  [],
            groups: [
                { title: 'Data + UI',            pages: recipesDataUi },
                { title: 'Windows + dialogs',     pages: recipesWindowsDialogs },
                { title: 'Theming + interaction', pages: recipesThemingInteraction },
                { title: 'Construction patterns', pages: recipesConstructionPatterns },
                { title: 'Local development',     pages: recipesLocalDevelopment },
            ],
        },
        {
            title: 'Reference',
            path:   '/reference',
            pages:  reference,
            groups: [
                { title: 'Changelog', path: '/reference/changelog', pages: changelogVersions },
                { title: 'Migration', path: '/reference/migration', pages: migrationVersions },
            ],
        },
    ];

    // Fail loudly on a hand-authored path that doesn't resolve to a migrated
    // page — an authoring typo, not a runtime condition to handle gracefully.
    (function requireAll(groups: NavGroup[]): void {
        for (const group of groups) {
            if (group.path !== undefined) {
                requirePage(group.path);
            }
            group.pages.forEach((entry) => requirePage(entry.path));
            if (group.groups) {
                requireAll(group.groups);
            }
        }
    })(nav);

    // Each group's own pages and subgroups are freshly built literals on
    // every call, so sorting them in place is safe.
    (function sortGroups(groups: NavGroup[]): void {
        for (const group of groups) {
            group.pages.sort((a, b) => compareLabels(a.label, b.label));
            if (group.groups) {
                group.groups.sort((a, b) => compareLabels(a.title, b.title));
                sortGroups(group.groups);
            }
        }
    })(nav);

    return nav;
}
