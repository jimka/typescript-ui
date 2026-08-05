import { callable, Panel } from '@jimka/typescript-ui/core';
import type { PanelOptions } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { Link } from '@jimka/typescript-ui/component/input';
import type { MarkdownHeading } from '@jimka/typescript-ui/component/display';
import { Insets } from '@jimka/typescript-ui/primitive';
import { Router } from '@jimka/typescript-ui/router';

// Wide enough for a two-word heading at the deepest indent level before
// wrapping — mirrors DocsSidebar's own SIDEBAR_WIDTH constant shape. Height
// is 0 because the minimap sits in a Border EAST region, which reads only
// the width.
const MINIMAP_WIDTH = 220;

// Pixels of indentation added per heading depth level below the first.
// Matches Tree's own INDENT_PX so the minimap's nesting reads at the same
// visual scale as the sidebar's tree.
const MINIMAP_INDENT_PX = 16;

/**
 * The east column: a clickable outline of the current page's headings,
 * indented by depth. A sibling of the scrolling `DocsContent` pane in the
 * shell's `Border` layout, not a descendant of it, so it stays visually
 * fixed while the content pane scrolls. Clicking a row navigates to the
 * heading the same way an authored in-page `#fragment` link does.
 */
class DocsMinimap extends Panel {

    private readonly _router: Router;

    /** The last list passed to {@link setHeadings}. */
    private _headings: MarkdownHeading[] = [];

    /** The currently-built row components, rebuilt on every {@link setHeadings} call. */
    private readonly _rows: Link[] = [];

    constructor(router: Router, options?: PanelOptions) {
        super(options, {
            // stretching: true fills each row to the panel's cross-axis width —
            // without it a row sizes to its own unwrapped preferred width, which
            // leaves no room for setWhiteSpace('normal') to wrap into and a short
            // word ends up character-wrapped and vertically clipped instead. The
            // same reason DocsContent's own VBox column passes it.
            layoutManager:  VBox({ spacing: 2, stretching: true }),
            autoScroll:     'y',
            preferredSize:  { width: MINIMAP_WIDTH, height: 0 },
        });

        this._router = router;
    }

    /**
     * Replaces the shown outline with `headings`, rebuilding the row
     * components.
     *
     * @param headings - The current page's headings, in document order.
     */
    setHeadings(headings: MarkdownHeading[]): void {
        this._headings = headings;
        this.rebuild();
    }

    /**
     * Disposes the previous rows, then builds one `Link` per heading,
     * indented by depth — the dispose-then-empty-then-rebuild sequence
     * `DocsContent.showBlocks` uses for the same reason: `removeAllComponents`
     * does not dispose and `dispose()` does not unparent.
     */
    private rebuild(): void {
        for (const row of this._rows) {
            row.dispose();
        }

        this._rows.length = 0;
        this.removeAllComponents();

        for (const heading of this._headings) {
            const row = new Link(heading.text, {
                padding:   new Insets(0, 0, 0, (heading.depth - 1) * MINIMAP_INDENT_PX),
                listeners: { action: () => this.handleRowClick(heading.id) },
            });

            row.setWhiteSpace('normal');
            this._rows.push(row);
            this.addComponent(row);
        }

        this.scheduleLayout();
    }

    /**
     * Navigates to a heading's id, mirroring `DocsContent.onLinkClick`'s
     * bare-fragment branch.
     *
     * @param id - The clicked heading's slugified id.
     */
    private handleRowClick(id: string): void {
        this._router.navigate(this._router.getPath() + '#' + id);
    }
}

const DocsMinimapCallable = callable(DocsMinimap);
type DocsMinimapCallable = DocsMinimap;
export {
    DocsMinimap         as _DocsMinimap,
    DocsMinimapCallable as DocsMinimap,
};
