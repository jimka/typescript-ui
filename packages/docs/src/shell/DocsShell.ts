import { callable, Panel } from '@jimka/typescript-ui/core';
import { Border } from '@jimka/typescript-ui/layout';
import { Placement } from '@jimka/typescript-ui/primitive';
import { Header } from '@jimka/typescript-ui/component/display';
import { StatusBar } from '@jimka/typescript-ui/component/container';
import { Router } from '@jimka/typescript-ui/router';
import { moduleCount, symbolCount } from '../content/api.js';
import { DocsSidebar } from './DocsSidebar.js';
import { DocsContent } from './DocsContent.js';

/**
 * The app shell: `Header` north, `DocsSidebar` west, `DocsContent` centre, and
 * a `StatusBar` south carrying the TypeDoc model counts — mirrors
 * `packages/lib/src/typescript/main.ts`'s `Border` composition. See "The app
 * shell mirrors the demo app's composition" in
 * plans/implemented/packages-docs.md.
 */
class DocsShell extends Panel {

    private readonly _sidebar: DocsSidebar;
    private readonly _content: DocsContent;

    constructor(router: Router) {
        super({ layoutManager: Border() });

        const header = new Header('@jimka/typescript-ui');

        this._sidebar = new DocsSidebar(router);
        this._content = new DocsContent(router);

        const statusBar = new StatusBar({
            message: `${moduleCount()} modules · ${symbolCount()} documented symbols`,
        });

        this.addComponent(header,         { placement: Placement.NORTH });
        this.addComponent(this._sidebar,  { placement: Placement.WEST });
        this.addComponent(this._content,  { placement: Placement.CENTER });
        this.addComponent(statusBar,      { placement: Placement.SOUTH });
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
