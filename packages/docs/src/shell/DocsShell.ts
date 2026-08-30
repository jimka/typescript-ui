import { callable, Component, Container } from '@jimka/typescript-ui/core';
import { Border, HBox, Fit, AnchorType, Anchor, AnchorConstraints } from '@jimka/typescript-ui/layout';
import { Placement } from '@jimka/typescript-ui/primitive';
import { Header, Glyph, MarkdownMinimap } from '@jimka/typescript-ui/component/display';
import type { MarkdownHeading } from '@jimka/typescript-ui/component/display';
import { Button, ToggleButton } from '@jimka/typescript-ui/component/button';
import { StatusBar, FloatingPanel } from '@jimka/typescript-ui/component/container';
import { Router } from '@jimka/typescript-ui/router';
import { github } from '@jimka/typescript-ui/glyphs/brands/github';
import { bug } from '@jimka/typescript-ui/glyphs/solid/bug';
import { eye } from '@jimka/typescript-ui/glyphs/solid/eye';
import { moduleCount, symbolCount } from '../content/api.js';
import { loadShowInheritedMembers } from '../content/apiPreferences.js';
import { DocsSidebar } from './DocsSidebar.js';
import { DocsContent } from './DocsContent.js';

Glyph.register(github, bug, eye);

/** Opens the repo on GitHub — the header's leftmost shortcut button. */
const GITHUB_REPO_URL = 'https://github.com/jimka/typescript-ui';

/** Opens GitHub's new-issue form — the header's rightmost shortcut button. */
const GITHUB_NEW_ISSUE_URL = 'https://github.com/jimka/typescript-ui/issues/new';

/**
 * The app shell: `Header` north, `DocsSidebar` west, a floating
 * `MarkdownMinimap` hugging `DocsContent`'s rendered prose column centre,
 * and a `StatusBar` south carrying the TypeDoc model counts — mirrors
 * `packages/lib/src/typescript/main.ts`'s `Border` composition. See "The app
 * shell mirrors the demo app's composition" in
 * plans/implemented/packages-docs.md.
 */
class DocsShell extends Container {

    private readonly _router: Router;
    private readonly _sidebar: DocsSidebar;
    private readonly _content: DocsContent;
    private readonly _minimap: MarkdownMinimap;
    private readonly _inheritedToggle: FloatingPanel;

    // Stable reference so DocsContent.off would find the same identity;
    // delegates to the named handler below — mirrors DocsContent's own
    // handleLinkClick idiom.
    private readonly handleOutlineChange: (headings: MarkdownHeading[]) => void = (headings) => this.onOutlineChange(headings);

    // Stable reference, mirroring handleOutlineChange above.
    private readonly handleMinimapSelect: (headingId: string) => void = (headingId) => this.onMinimapSelect(headingId);

    // Stable reference for Component.afterNextLayout, mirroring
    // DocsContent's own handleScrollToFragment idiom; delegates to the named
    // handler below.
    private readonly handleContentSettled: () => void = () => this.rehugFloatingPanels();

    constructor(router: Router) {
        super({ layoutManager: Border( { spacing: 0 }) });

        this._router = router;

        const header = new Header('@jimka/typescript-ui', {
            backgroundColor: "#f6f6f7",
            border: {
                borderBottom: "1px solid var(--ts-ui-statusbar-border, rgb(220, 220, 220))"
            }
        });
        header.addComponent(this.buildHeaderActions(), { placement: Placement.EAST, anchor: AnchorType.CENTER });

        this._sidebar = new DocsSidebar(router, {
            backgroundColor: "#f6f6f7",
            border: {
                borderRight: "1px solid var(--ts-ui-statusbar-border, rgb(220, 220, 220))"
            }
        });
        this._content = new DocsContent(router);

        // Anchor-managed wrapper so the minimap can float over the content
        // pane instead of sitting beside it in its own Border region.
        const centre = new Component({ layoutManager: new Anchor() });
        const contentConstraints = new AnchorConstraints();
        contentConstraints.left   = 0;
        contentConstraints.right  = 0;
        contentConstraints.top    = 0;
        contentConstraints.bottom = 0;
        centre.addComponent(this._content, contentConstraints);

        this._minimap = new MarkdownMinimap({ scrollSource: this._content, corner: "top-right" });
        centre.addComponent(this._minimap, this._minimap.getAnchorConstraints());

        this._inheritedToggle = this.buildInheritedToggle();
        centre.addComponent(this._inheritedToggle, this._inheritedToggle.getAnchorConstraints());

        this._content.on('outlinechange', this.handleOutlineChange);
        this._minimap.on('select', this.handleMinimapSelect);

        const statusBar = new StatusBar({
            message: `${moduleCount()} modules · ${symbolCount()} documented symbols`,
        });

        this.addComponent(header,         { placement: Placement.NORTH });
        this.addComponent(this._sidebar,  { placement: Placement.WEST });
        this.addComponent(centre,         { placement: Placement.CENTER });
        this.addComponent(statusBar,      { placement: Placement.SOUTH });
    }

    /**
     * Lays out the shell as usual, then re-hugs the minimap and the
     * inherited-members toggle against `DocsContent`'s current text column —
     * `FloatingPanel.placeNextTo` needs calling after every pass that can
     * move either the window's width or the content pane's rendered width
     * (see its own doc comment for why it's an owner-driven call rather than
     * a `FloatingPanel`-internal `doLayout` override).
     *
     * @returns This shell, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        this.rehugFloatingPanels();

        return this;
    }

    /** Re-hugs the minimap and the inherited-members toggle against `DocsContent`'s current first block. */
    private rehugFloatingPanels(): void {
        const textColumn = this._content.getTextColumnReference();

        this._minimap.placeNextTo(textColumn);
        this._inheritedToggle.placeNextTo(textColumn);
    }

    /**
     * Builds the header's trailing shortcut row: flat, icon-only buttons that
     * open the GitHub repo and a new GitHub issue in a new tab. `showText:
     * false` keeps the title off the button face while still driving its
     * hover tooltip and accessible name.
     *
     * @returns The action row, ready to add at `Placement.EAST`.
     */
    private buildHeaderActions(): Component {
        const repoButton = new Button({ glyph: 'github', text: 'GitHub repository', showText: false, flat: true, compact: true });
        repoButton.on('action', () => { window.open(GITHUB_REPO_URL, '_blank', 'noopener,noreferrer'); });

        const issueButton = new Button({ glyph: 'bug', text: 'Report an issue', showText: false, flat: true, compact: true });
        issueButton.on('action', () => { window.open(GITHUB_NEW_ISSUE_URL, '_blank', 'noopener,noreferrer'); });

        const actions = new Component({ layoutManager: new HBox({ spacing: 4 }) });
        actions.addComponent(repoButton);
        actions.addComponent(issueButton);

        return actions;
    }

    /**
     * Builds the bottom-right floating "show inherited members" toggle,
     * mirroring `DiagramView.buildControls`'s bare (unstyled) `FloatingPanel`
     * holding glyph-only control buttons. A `DocsShell`-level sibling of
     * `DocsContent` rather than one of its children: `DocsContent.showBlocks`
     * disposes and rebuilds all of its own children on every navigation, so a
     * toggle built there would risk its own `action` handler disposing the
     * component whose event is still executing. Starts hidden; {@link
     * onOutlineChange} shows it only while an API page is displayed.
     *
     * @returns The toggle, wrapped in its own `FloatingPanel`.
     */
    private buildInheritedToggle(): FloatingPanel {
        const panel = new FloatingPanel({ corner: 'bottom-right', visible: false, layoutManager: new Fit() });

        const toggle: ToggleButton = ToggleButton('Show inherited members', {
            glyph:     'eye',
            showText:  false,
            selected:  loadShowInheritedMembers(),
            listeners: { action: () => this._content.setShowInheritedMembers(toggle.isSelected()) },
        });
        panel.addComponent(toggle);

        return panel;
    }

    /**
     * Reflects the current page's heading outline into the minimap, shows or
     * hides the inherited-members toggle to match whether the current page is
     * an API page, then re-hugs both floating panels once the incoming
     * page's blocks have actually laid out. `DocsContent.showBlocks` only
     * re-lays-out its own (unchanged) bounds — it never bubbles a layout pass
     * up to this shell — so without this, `rehugFloatingPanels` would run
     * against the outgoing (disposed) block or, on the very first page,
     * against no block at all.
     *
     * @param headings - The current page's headings, in document order.
     */
    private onOutlineChange(headings: MarkdownHeading[]): void {
        this._minimap.setHeadings(headings);
        this._inheritedToggle.setVisible(this._content.isApiPage());
        Component.afterNextLayout(this.handleContentSettled);
    }

    /**
     * Navigates to the current path plus the clicked heading's fragment.
     *
     * @param headingId - The clicked heading's slugified id.
     */
    private onMinimapSelect(headingId: string): void {
        this._router.navigate(this._router.getPath() + '#' + headingId);
    }

    /**
     * Shows `path` in the content pane, scrolled to `fragment`'s heading,
     * and reflects `path` into the sidebar selection — the one method the
     * router's route handlers call.
     *
     * `select` is async (it awaits a tree reveal) but this call is
     * deliberately fire-and-forget: `router.start()` must apply the first
     * route synchronously or the first frame shows the wrong page, so
     * `showPath` and its callers stay synchronous — see "`select` is now
     * async and called from a synchronous route handler" in
     * plans/implemented/docs-content-migration.md.
     *
     * @param path - The route path to show.
     * @param fragment - The URL fragment to scroll to, without its `"#"`, or
     * `""` to scroll to the top.
     */
    showPath(path: string, fragment: string): void {
        this._content.showPath(path, fragment);
        void this._sidebar.select(path);
    }
}

const DocsShellCallable = callable(DocsShell);
type DocsShellCallable = DocsShell;
export {
    DocsShell         as _DocsShell,
    DocsShellCallable as DocsShell,
};
