// @vitest-environment jsdom
//
// DocsMinimap constructs library components (Panel, Link), whose bundled
// module evaluates a top-level `Body` singleton that reads `document` at
// import time — same reason demos.test.ts needs a real DOM (see its own
// top comment). This package has no access to packages/lib's modelled DOM
// test harness (installTestDOM), which is test-only and not published, so
// this exercises the real thing through jsdom instead.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Body } from '@jimka/typescript-ui/core';
import { Fit } from '@jimka/typescript-ui/layout';
import { Router } from '@jimka/typescript-ui/router';
import type { MarkdownHeading } from '@jimka/typescript-ui/component/display';
import { Link } from '@jimka/typescript-ui/component/input';
import { DocsMinimap } from '../src/shell/DocsMinimap.js';

let router: Router;
let minimap: DocsMinimap;

beforeEach(() => {
    router = new Router();
});

afterEach(() => {
    minimap.dispose();
});

describe('DocsMinimap', () => {
    it('builds one Link row per heading, in order, indented by depth', () => {
        minimap = new DocsMinimap(router);
        const headings: MarkdownHeading[] = [
            { id: 'a', text: 'A', depth: 1 },
            { id: 'b', text: 'B', depth: 2 },
        ];

        minimap.setHeadings(headings);

        const rows = minimap.getComponents() as Link[];

        expect(rows).toHaveLength(2);
        expect(rows[0].getText()).toBe('A');
        expect(rows[1].getText()).toBe('B');
        expect(rows[0].getPadding()?.getLeft()).toBe(0);
        expect(rows[1].getPadding()?.getLeft()).toBe(16);
    });

    it('disposes the previous rows before building the new ones on a second setHeadings call', () => {
        minimap = new DocsMinimap(router);
        minimap.setHeadings([{ id: 'a', text: 'A', depth: 1 }]);

        const [firstRow] = minimap.getComponents() as Link[];
        const disposeSpy = vi.spyOn(firstRow, 'dispose');

        minimap.setHeadings([{ id: 'b', text: 'B', depth: 1 }]);

        expect(disposeSpy).toHaveBeenCalledTimes(1);
        expect(minimap.getComponents()).toHaveLength(1);
        expect((minimap.getComponents()[0] as Link).getText()).toBe('B');
    });

    it('clears any previously shown rows, leaving the pane present but empty', () => {
        minimap = new DocsMinimap(router);
        minimap.setHeadings([{ id: 'a', text: 'A', depth: 1 }]);

        minimap.setHeadings([]);

        expect(minimap.getComponents()).toHaveLength(0);
    });

    it('navigates to the current path plus the heading fragment when a row is clicked', () => {
        minimap = new DocsMinimap(router);
        // Link.click() fires through Event's window-level capture-phase
        // listener, which needs the element connected to `document` to
        // receive a dispatched event. Body.init mounts the real singleton
        // root into `document.body` — the same call main.ts uses to mount
        // the app for real — so this exercises a real, connected DOM tree
        // rather than a detached one. flushLayout() drains the layout
        // Body.init schedules synchronously, so nothing is left queued
        // against an animation frame that would still be pending once
        // afterEach disposes minimap below (an async flush touching an
        // already-released handle otherwise).
        const body = Body.init({ layoutManager: Fit(), components: [minimap] });
        body.flushLayout();

        vi.spyOn(router, 'getPath').mockReturnValue('/components/Button');
        const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => router);

        minimap.setHeadings([{ id: 'usage', text: 'Usage', depth: 1 }]);
        body.flushLayout();   // drains the layout adding the new row schedules

        (minimap.getComponents()[0] as Link).click();
        body.flushLayout();   // drains anything the click itself schedules

        expect(navigate).toHaveBeenCalledWith('/components/Button#usage');
    });
});
