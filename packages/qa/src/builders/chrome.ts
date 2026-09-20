// The application chrome every panel that needs it shares: a menu bar, a
// toolbar, a status bar and the explorer's file-tree renderer. Shared so a
// change to the chrome is one reviewed change to the QA app, never a
// difference between panels.

import { Button } from '@jimka/typescript-ui/component/button';
import { StatusBar } from '@jimka/typescript-ui/component/container';
import type { MenuConfig } from '@jimka/typescript-ui/component/container';
import { Glyph } from '@jimka/typescript-ui/component/display';
import { MenuBar, ToolBar } from '@jimka/typescript-ui/component/menubar';
import { IconLabelTreeNodeRenderer } from '@jimka/typescript-ui/component/tree';
import type { TreeNode, TreeNodeRenderContext, TreeNodeRenderer } from '@jimka/typescript-ui/component/tree';
import { code_branch } from '@jimka/typescript-ui/glyphs/solid/code_branch';
import { database } from '@jimka/typescript-ui/glyphs/solid/database';
import { file } from '@jimka/typescript-ui/glyphs/solid/file';
import { flag_checkered } from '@jimka/typescript-ui/glyphs/solid/flag_checkered';
import { floppy_disk } from '@jimka/typescript-ui/glyphs/solid/floppy_disk';
import { folder } from '@jimka/typescript-ui/glyphs/solid/folder';
import { folder_open } from '@jimka/typescript-ui/glyphs/solid/folder_open';
import { gear } from '@jimka/typescript-ui/glyphs/solid/gear';
import { gears } from '@jimka/typescript-ui/glyphs/solid/gears';
import { house } from '@jimka/typescript-ui/glyphs/solid/house';
import { magnifying_glass } from '@jimka/typescript-ui/glyphs/solid/magnifying_glass';
import { star } from '@jimka/typescript-ui/glyphs/solid/star';
import { trash } from '@jimka/typescript-ui/glyphs/solid/trash';

// The toolbar's and the file tree's glyphs; register them at module load.
Glyph.register(file, folder, folder_open, floppy_disk, magnifying_glass, gear, star, house, trash, code_branch, database, gears, flag_checkered);

/** The menu bar's menus: four, of six items each, like a small editor's. */
const MENUS: ReadonlyArray<{ label: string; items: readonly string[] }> = [
    { label: 'File', items: ['New', 'Open', 'Save', 'Save As', 'Close', 'Exit'] },
    { label: 'Edit', items: ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Find'] },
    { label: 'View', items: ['Explorer', 'Outline', 'Status Bar', 'Zoom In', 'Zoom Out', 'Full Screen'] },
    { label: 'Help', items: ['Documentation', 'Shortcuts', 'Release Notes', 'Report Issue', 'Check for Updates', 'About'] },
];

/** The toolbar's buttons: a glyph each, and a text that becomes its hover tooltip. */
const TOOLS: ReadonlyArray<{ glyph: string; text: string }> = [
    { glyph: 'file', text: 'New File' },
    { glyph: 'folder-open', text: 'Open Folder' },
    { glyph: 'floppy-disk', text: 'Save' },
    { glyph: 'magnifying-glass', text: 'Search' },
    { glyph: 'gear', text: 'Settings' },
    { glyph: 'star', text: 'Favourites' },
    { glyph: 'house', text: 'Home' },
    { glyph: 'trash', text: 'Delete' },
    { glyph: 'code-branch', text: 'Branches' },
    { glyph: 'database', text: 'Database' },
    { glyph: 'gears', text: 'Build' },
    { glyph: 'flag-checkered', text: 'Run' },
];

/** Every menu item's action: the chrome is measured, never used. */
export function noCommand(): void {}

/**
 * A menu bar of four menus, File, Edit, View and Help, of six items each.
 *
 * @returns The menu bar.
 */
export function appMenuBar(): MenuBar {
    const menus: MenuConfig[] = MENUS.map((menu) => ({
        label: menu.label,
        items: menu.items.map((text) => ({ text, action: noCommand })),
    }));

    return MenuBar({ menus });
}

/**
 * A toolbar of twelve glyph-only buttons; each button's text is its hover tooltip.
 *
 * @returns The toolbar.
 */
export function appToolBar(): ToolBar {
    return ToolBar({ components: TOOLS.map((tool) => Button({ text: tool.text, glyph: tool.glyph, showText: false })) });
}

/**
 * A status bar that reads `Ready` until something sets a message.
 *
 * @returns The status bar.
 */
export function appStatusBar(): StatusBar {
    return StatusBar({ defaultMessage: 'Ready' });
}

/**
 * The file tree's glyph for a row: an open folder for an expanded branch, a
 * closed one for a collapsed branch, and a file for a leaf.
 *
 * @param _node - The row's node; the glyph depends on its state alone.
 * @param context - The row's state.
 * @returns The glyph's registry name.
 */
function fileIcon(_node: TreeNode, context: TreeNodeRenderContext): string {
    if (!context.hasChildren) {
        return 'file';
    }

    return context.expanded ? 'folder-open' : 'folder';
}

/**
 * The explorer tree's renderer factory: an icon and a label per row.
 *
 * @returns A fresh renderer.
 */
export function fileTreeRenderer(): TreeNodeRenderer {
    return new IconLabelTreeNodeRenderer(fileIcon);
}
