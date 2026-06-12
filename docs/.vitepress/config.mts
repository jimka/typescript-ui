import { defineConfig, type DefaultTheme } from 'vitepress';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sidebarPath = resolve(here, '../api/typedoc-sidebar.json');
const apiSidebar: DefaultTheme.SidebarItem[] = existsSync(sidebarPath)
    ? JSON.parse(readFileSync(sidebarPath, 'utf-8'))
    : [];

export default defineConfig({
    title:       '@jimka/typescript-ui',
    description: 'A web-based layout manager and UI component framework written in TypeScript.',
    base:        '/typescript-ui/',
    cleanUrls:   true,
    lastUpdated: true,

    themeConfig: {
        nav: [
            { text: 'Guide',      link: '/guide/' },
            { text: 'Components', link: '/components/' },
            { text: 'Layouts',    link: '/layouts/' },
            { text: 'Data',       link: '/data/' },
            { text: 'Recipes',    link: '/recipes/' },
            { text: 'API',        link: '/api/' },
            { text: 'GitHub',     link: 'https://github.com/jimka/typescript-ui' },
        ],

        sidebar: {
            '/guide/': [
                { text: 'Guide', items: [
                    { text: 'Introduction', link: '/guide/' },
                    { text: 'Installation', link: '/guide/installation' },
                    { text: 'Mental model', link: '/guide/mental-model' },
                ] },
            ],
            '/concepts/': [
                { text: 'Concepts', items: [
                    { text: 'Overview',            link: '/concepts/' },
                    { text: 'Component lifecycle', link: '/concepts/component-lifecycle' },
                    { text: 'Layout system',       link: '/concepts/layout-system' },
                    { text: 'Sizing',              link: '/concepts/sizing' },
                    { text: 'Events',              link: '/concepts/events' },
                    { text: 'Layering',            link: '/concepts/layering' },
                    { text: 'Theming',             link: '/concepts/theming' },
                    { text: 'Data binding',        link: '/concepts/data-binding' },
                    { text: 'Accessibility',       link: '/concepts/accessibility' },
                    { text: 'Performance',         link: '/concepts/performance' },
                ] },
            ],
            '/components/': [
                { text: 'Components', items: [
                    { text: 'Catalog', link: '/components/' },
                ] },
                { text: 'Core', collapsed: false, items: [
                    { text: 'Body',             link: '/components/Body' },
                    { text: 'Window',           link: '/components/Window' },
                    { text: 'Dialog',           link: '/components/Dialog' },
                    { text: 'Drawer',           link: '/components/Drawer' },
                    { text: 'Tooltip',          link: '/components/Tooltip' },
                    { text: 'Popover',          link: '/components/Popover' },
                    { text: 'Notification',     link: '/components/Notification' },
                    { text: 'AnimatedDropdown', link: '/components/AnimatedDropdown' },
                ] },
                { text: 'Buttons', collapsed: false, items: [
                    { text: 'Button',         link: '/components/Button' },
                    { text: 'ToggleButton',   link: '/components/ToggleButton' },
                    { text: 'RadioButton',    link: '/components/RadioButton' },
                    { text: 'ButtonGroup',    link: '/components/ButtonGroup' },
                    { text: 'SpinButton',     link: '/components/SpinButton' },
                    { text: 'TabCloseButton', link: '/components/TabCloseButton' },
                ] },
                { text: 'Inputs', collapsed: false, items: [
                    { text: 'TextField',         link: '/components/TextField' },
                    { text: 'TextArea',          link: '/components/TextArea' },
                    { text: 'PasswordField',     link: '/components/PasswordField' },
                    { text: 'Checkbox',          link: '/components/Checkbox' },
                    { text: 'Toggle',            link: '/components/Toggle' },
                    { text: 'ComboBox',          link: '/components/ComboBox' },
                    { text: 'AutoCompleteField', link: '/components/AutoCompleteField' },
                    { text: 'DateField',         link: '/components/DateField' },
                    { text: 'TimeField',         link: '/components/TimeField' },
                    { text: 'DateTimeField',     link: '/components/DateTimeField' },
                    { text: 'NumberSpinner',     link: '/components/NumberSpinner' },
                    { text: 'Slider',            link: '/components/Slider' },
                ] },
                { text: 'Display', collapsed: false, items: [
                    { text: 'Label',           link: '/components/Label' },
                    { text: 'Header',          link: '/components/Header' },
                    { text: 'Text',            link: '/components/Text' },
                    { text: 'Image',           link: '/components/Image' },
                    { text: 'Glyph',           link: '/components/Glyph' },
                    { text: 'Glyphs',          link: '/components/Glyphs' },
                    { text: 'IconText',        link: '/components/IconText' },
                    { text: 'IconLabel',       link: '/components/IconLabel' },
                    { text: 'FieldSet',        link: '/components/FieldSet' },
                    { text: 'FormFieldSet',    link: '/components/FormFieldSet' },
                    { text: 'Legend',          link: '/components/Legend' },
                    { text: 'ProgressBar',     link: '/components/ProgressBar' },
                    { text: 'ProgressSpinner', link: '/components/ProgressSpinner' },
                    { text: 'PaginationBar',   link: '/components/PaginationBar' },
                    { text: 'Spacer',          link: '/components/Spacer' },
                    { text: 'StatusBar',       link: '/components/StatusBar' },
                ] },
                { text: 'Lists', collapsed: false, items: [
                    { text: 'List',            link: '/components/List' },
                    { text: 'MultiSelectList', link: '/components/MultiSelectList' },
                    { text: 'ListItem',        link: '/components/ListItem' },
                    { text: 'BulletedList',    link: '/components/BulletedList' },
                    { text: 'NumberedList',    link: '/components/NumberedList' },
                ] },
                { text: 'Toolbar', collapsed: false, items: [
                    { text: 'ToolBar',          link: '/components/ToolBar' },
                    { text: 'ToolBarSeparator', link: '/components/ToolBarSeparator' },
                ] },
                { text: 'Menus', collapsed: false, items: [
                    { text: 'MenuBar',              link: '/components/MenuBar' },
                    { text: 'MenuBarButton',        link: '/components/MenuBarButton' },
                    { text: 'Menu',                 link: '/components/Menu' },
                    { text: 'MenuItem',             link: '/components/MenuItem' },
                    { text: 'MenuSeparator',        link: '/components/MenuSeparator' },
                ] },
                { text: 'Tree', collapsed: false, items: [
                    { text: 'Tree', link: '/components/Tree' },
                ] },
                { text: 'Containers', collapsed: false, items: [
                    { text: 'TabBar',         link: '/components/TabBar' },
                    { text: 'TabPanel',       link: '/components/TabPanel' },
                    { text: 'AccordionPanel', link: '/components/AccordionPanel' },
                ] },
                { text: 'Table', collapsed: false, items: [
                    { text: 'Table',           link: '/components/Table' },
                    { text: 'TablePanel',      link: '/components/TablePanel' },
                    { text: 'TreeTable',       link: '/components/TreeTable' },
                    { text: 'TreeTablePanel',  link: '/components/TreeTablePanel' },
                    { text: 'Table internals', link: '/components/TableInternals' },
                ] },
                { text: 'Scrolling', collapsed: false, items: [
                    { text: 'Scrollbar',       link: '/components/Scrollbar' },
                    { text: 'VirtualScroller', link: '/components/VirtualScroller' },
                ] },
            ],
            '/layouts/': [
                { text: 'Layouts', items: [
                    { text: 'Overview',    link: '/layouts/' },
                    { text: 'Constraints', link: '/layouts/Constraints' },
                ] },
                { text: 'Layout managers', collapsed: false, items: [
                    { text: 'Absolute',  link: '/layouts/Absolute' },
                    { text: 'Fit',       link: '/layouts/Fit' },
                    { text: 'Border',    link: '/layouts/Border' },
                    { text: 'HBox',      link: '/layouts/HBox' },
                    { text: 'VBox',      link: '/layouts/VBox' },
                    { text: 'HFlow',     link: '/layouts/HFlow' },
                    { text: 'Grid',      link: '/layouts/Grid' },
                    { text: 'Card',      link: '/layouts/Card' },
                    { text: 'Tab',       link: '/layouts/Tab' },
                    { text: 'Split',     link: '/layouts/Split' },
                    { text: 'Accordion', link: '/layouts/Accordion' },
                ] },
                { text: 'Docking', collapsed: false, items: [
                    { text: 'DockRegion', link: '/layouts/DockRegion' },
                ] },
                { text: 'Serialization', collapsed: false, items: [
                    { text: 'Layout serialization', link: '/layouts/LayoutSerialization' },
                ] },
            ],
            '/data/': [
                { text: 'Data layer', items: [
                    { text: 'Overview', link: '/data/' },
                    { text: 'Model',    link: '/data/model' },
                    { text: 'Store',    link: '/data/store' },
                    { text: 'Proxy',    link: '/data/proxy' },
                    { text: 'Record',   link: '/data/record' },
                    { text: 'Binding',  link: '/data/binding' },
                ] },
            ],
            '/recipes/': [
                { text: 'Recipes', items: [
                    { text: 'Overview', link: '/recipes/' },
                ] },
                { text: 'Data + UI', collapsed: false, items: [
                    { text: 'CRUD with a Table',       link: '/recipes/crud-table' },
                    { text: 'Bind a record to a form', link: '/recipes/bind-form' },
                    { text: 'Custom cell type',        link: '/recipes/custom-cell' },
                    { text: 'Virtualized lists',       link: '/recipes/virtualized-list' },
                ] },
                { text: 'Windows + dialogs', collapsed: false, items: [
                    { text: 'Floating window',  link: '/recipes/floating-window' },
                    { text: 'Modal dialog',     link: '/recipes/dialog-modal' },
                    { text: 'Right-click menu', link: '/recipes/right-click-menu' },
                    { text: 'Notifications',    link: '/recipes/notifications' },
                ] },
                { text: 'Theming + interaction', collapsed: false, items: [
                    { text: 'Custom brand theme',  link: '/recipes/custom-theme' },
                    { text: 'Keyboard shortcuts', link: '/recipes/keyboard-shortcuts' },
                    { text: 'Drag-and-drop',      link: '/recipes/drag-and-drop' },
                ] },
                { text: 'Construction patterns', collapsed: false, items: [
                    { text: 'Component constructor options', link: '/recipes/component-options' },
                ] },
            ],
            '/reference/': [
                { text: 'Reference', items: [
                    { text: 'Overview',        link: '/reference/' },
                    { text: 'Glossary',        link: '/reference/glossary' },
                    { text: 'FAQ',             link: '/reference/faq' },
                    { text: 'Troubleshooting', link: '/reference/troubleshooting' },
                    { text: 'Browser support', link: '/reference/browser-support' },
                    { text: 'Migration',       link: '/reference/migration' },
                    { text: 'Changelog',       link: '/reference/changelog' },
                ] },
            ],
            '/api/':       apiSidebar,
        },

        socialLinks: [
            { icon: 'github', link: 'https://github.com/jimka/typescript-ui' },
        ],

        search: { provider: 'local' },

        outline: { level: [2, 3] },
    },

    ignoreDeadLinks: true,
});
