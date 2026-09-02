import { describe, it, expect, afterEach, vi } from 'vitest';
import { MarkdownViewer } from '~/component/display/MarkdownViewer';
import { DOM } from '~/core/DOM';
import type { TreeNode } from '~/component/tree/TreeNode';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

const SOURCE = '# Introduction\n\n## Getting Started\n\n### Install\n';

afterEach(() => DOM.reset());

describe('MarkdownViewer minimap/controls visibility', () => {
    it('defaults to both visible', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;

        expect(viewer.isMinimapVisible()).toBe(true);
        expect(viewer.isControlsVisible()).toBe(true);
        expect(viewer._minimap.isVisible()).not.toBe(false);
        expect(viewer._controls.isVisible()).not.toBe(false);
    });

    it('setMinimapVisible(false) hides only the minimap', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;

        viewer.setMinimapVisible(false);

        expect(viewer.isMinimapVisible()).toBe(false);
        expect(viewer._minimap.isVisible()).toBe(false);
        expect(viewer._controls.isVisible()).not.toBe(false);
    });

    it('setControlsVisible(false) hides only the controls', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;

        viewer.setControlsVisible(false);

        expect(viewer.isControlsVisible()).toBe(false);
        expect(viewer._controls.isVisible()).toBe(false);
        expect(viewer._minimap.isVisible()).not.toBe(false);
    });

    it('honours showMinimap: false / showControls: false at construction', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE, showMinimap: false, showControls: false }) as any;

        expect(viewer._minimap.isVisible()).toBe(false);
        expect(viewer._controls.isVisible()).toBe(false);
    });
});

describe('MarkdownViewer minimap placement wiring', () => {
    it('calls placeNextTo(_markdown) from its own doLayout', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;
        const spy = vi.spyOn(viewer._minimap, 'placeNextTo');

        viewer.doLayout();

        expect(spy).toHaveBeenCalledWith(viewer._markdown);
    });

    it('re-hugs after stepping width, stepping zoom, and resetting — none of which trigger a layout pass on their own', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;
        const spy = vi.spyOn(viewer._minimap, 'placeNextTo');

        viewer._onWider();
        expect(spy).toHaveBeenLastCalledWith(viewer._markdown);

        viewer._onZoomIn();
        expect(spy).toHaveBeenLastCalledWith(viewer._markdown);

        viewer._onReset();
        expect(spy).toHaveBeenLastCalledWith(viewer._markdown);
    });
});

describe('MarkdownViewer controls placement wiring', () => {
    it('calls placeNextTo(_markdown) from its own doLayout, same as the minimap', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;
        const spy = vi.spyOn(viewer._controls, 'placeNextTo');

        viewer.doLayout();

        expect(spy).toHaveBeenCalledWith(viewer._markdown);
    });

    it('re-hugs after stepping width, stepping zoom, and resetting — none of which trigger a layout pass on their own', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;
        const spy = vi.spyOn(viewer._controls, 'placeNextTo');

        viewer._onWider();
        expect(spy).toHaveBeenLastCalledWith(viewer._markdown);

        viewer._onZoomIn();
        expect(spy).toHaveBeenLastCalledWith(viewer._markdown);

        viewer._onReset();
        expect(spy).toHaveBeenLastCalledWith(viewer._markdown);
    });
});

describe('MarkdownViewer scroll ownership', () => {
    it('never scrolls itself — the internal content pane owns autoScroll instead', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;

        expect(viewer.getAutoScroll()).toBe('none');
        expect(viewer._content.getAutoScroll()).toBe('y');
    });

    it('keeps the minimap and controls outside the scrolling content pane, so scrolling the prose never carries them along', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;
        const contentElement = viewer._content.getElement(true);

        expect(DOM.source.contains(contentElement, viewer._minimap.getElement(true))).toBe(false);
        expect(DOM.source.contains(contentElement, viewer._controls.getElement(true))).toBe(false);
    });

    it('getScrollTop/setScrollTop delegate to the internal content pane', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;

        viewer.setScrollTop(42);

        expect(viewer.getScrollTop()).toBe(42);
        expect(viewer._content.getScrollTop()).toBe(42);
    });
});

describe('MarkdownViewer width controls', () => {
    it('wider steps _widthIndex and calls setMaxMeasure with the next preset', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;

        viewer._onWider();

        expect(viewer._widthIndex).toBe(2);
        expect(viewer._markdown.getMaxMeasure()).toBe('90ch');
    });

    it('narrower steps _widthIndex and calls setMaxMeasure with the previous preset', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;

        viewer._onNarrower();

        expect(viewer._widthIndex).toBe(0);
        expect(viewer._markdown.getMaxMeasure()).toBe('60ch');
    });

    it('clamps at the wide bound rather than erroring or going out of bounds', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;

        viewer._onWider();
        viewer._onWider();
        viewer._onWider();

        expect(viewer._widthIndex).toBe(2);
        expect(viewer._markdown.getMaxMeasure()).toBe('90ch');
    });

    it('clamps at the narrow bound rather than erroring or going out of bounds', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;

        viewer._onNarrower();
        viewer._onNarrower();
        viewer._onNarrower();

        expect(viewer._widthIndex).toBe(0);
        expect(viewer._markdown.getMaxMeasure()).toBe('60ch');
    });
});

describe('MarkdownViewer zoom controls', () => {
    it('zoom in steps _zoomIndex and calls setFontScale with the next preset', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;

        viewer._onZoomIn();

        expect(viewer._zoomIndex).toBe(2);
        expect(viewer._markdown.getFontScale()).toBe(1.15);
    });

    it('zoom out steps _zoomIndex and calls setFontScale with the previous preset', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;

        viewer._onZoomOut();

        expect(viewer._zoomIndex).toBe(0);
        expect(viewer._markdown.getFontScale()).toBe(0.85);
    });

    it('clamps at the zoomed-in bound', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;

        viewer._onZoomIn();
        viewer._onZoomIn();
        viewer._onZoomIn();

        expect(viewer._zoomIndex).toBe(3);
        expect(viewer._markdown.getFontScale()).toBe(1.3);
    });
});

describe('MarkdownViewer reset', () => {
    it('clears both overrides to null/1 and resets both indices, rather than re-applying the default preset', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;

        viewer._onWider();
        viewer._onZoomIn();
        viewer._onReset();

        expect(viewer._widthIndex).toBe(1);
        expect(viewer._zoomIndex).toBe(1);
        expect(viewer._markdown.getMaxMeasure()).toBeNull();
        expect(viewer._markdown.getFontScale()).toBe(1);
    });
});

describe('MarkdownViewer.setMarkdown', () => {
    it('refreshes the minimap\'s headings to the new source, not the construction-time set', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: '# Old\n' }) as any;

        viewer.setMarkdown('# New Heading\n');

        const roots = viewer._minimap._tree.getNodes() as TreeNode[];

        expect(roots).toHaveLength(1);
        expect(roots[0].label).toBe('New Heading');
    });

    it('refreshes the tracker\'s headings to the new source, not the construction-time set', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: '# Old\n' }) as any;

        viewer.setMarkdown('# New Heading\n\n## Sub Heading\n');

        expect(viewer._tracker.getHeadings().map((h: { text: string }) => h.text)).toEqual(['New Heading', 'Sub Heading']);
    });
});

describe('MarkdownViewer minimap-select scrolls to the heading', () => {
    it('clicking a minimap row scrolls the viewer to that heading', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;
        viewer.getElement(true);

        // Stubbed on the internal scrolling content pane, not the outer
        // viewer — scrollToHeading reads its own pane's rect, and the outer
        // no longer scrolls (see "MarkdownViewer scroll ownership" above).
        DOM.sink.apply(viewer._content.getElement(true), { style: { left: '0px', top: '0px', width: '400px', height: '300px' } });

        // Resolve the actual rendered heading ids from the minimap's own tree
        // (built from the same extractMarkdownHeadings source), so the test
        // doesn't hand-derive the slug.
        const roots = viewer._minimap._tree.getNodes() as TreeNode[];
        const gettingStartedNode = roots[0].children![0];
        const gettingStartedId = gettingStartedNode.data as string;

        DOM.sink.apply(DOM.source.getElementById(gettingStartedId)!, { style: { left: '0px', top: '500px', width: '10px', height: '10px' } });

        viewer._minimap.emit('select', gettingStartedId);

        expect(viewer.getScrollTop()).toBe(500);
    });
});

// Drives the registered "scroll" handler directly rather than a real DOM
// dispatch: Event's window-level capture handler for a type installs once
// per module and never re-arms on a later test's fresh installTestDOM() sink
// (see DiagramView.test.ts's own file-level comment on the same constraint),
// so only the first-ever real dispatch in this file could rely on it.
describe('MarkdownViewer scroll tracking', () => {
    it('emits activeheadingchange as the viewer scrolls, only when the resolved id changes', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;
        viewer.getElement(true);

        const headings = viewer._tracker.getHeadings() as Array<{ id: string }>;

        // Each heading's own top is a fixed "document coordinate"; setScrollTop
        // below (the framework's own scroll API, so it lands on whichever
        // element getScrollElement() actually resolves to) is subtracted from
        // it when findActiveHeading climbs to the scroll-owning ancestor —
        // the same technique Markdown.test.ts's own findActiveHeading suite uses.
        DOM.sink.apply(DOM.source.getElementById(headings[0].id)!, { style: { left: '0px', top: '100px', width: '10px', height: '10px' } });
        DOM.sink.apply(DOM.source.getElementById(headings[1].id)!, { style: { left: '0px', top: '600px', width: '10px', height: '10px' } });
        // The third heading needs its own stub too — an unstubbed handle hits
        // ModelledDOMSource's zero-rect fallback (top 0), which would
        // trivially satisfy "top <= paneTop" and win as the last (in document
        // order) candidate regardless of scroll position.
        DOM.sink.apply(DOM.source.getElementById(headings[2].id)!, { style: { left: '0px', top: '900px', width: '10px', height: '10px' } });

        const listener = vi.fn();
        viewer.on('activeheadingchange', listener);

        viewer.setScrollTop(500);
        viewer.handleNativeScroll();

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenLastCalledWith(headings[0].id);

        // Same scroll position again — the resolved heading is unchanged, so
        // no second emission.
        viewer.handleNativeScroll();
        expect(listener).toHaveBeenCalledTimes(1);

        viewer.setScrollTop(650);
        viewer.handleNativeScroll();

        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenLastCalledWith(headings[1].id);
    });

    it('keeps the clicked heading active through the native scroll event it triggers, even when a later heading ties it for the top-crossing position', () => {
        installTestDOM(CONFIG);

        const viewer = new MarkdownViewer({ markdown: SOURCE }) as any;
        viewer.getElement(true);

        // Stubbed on the internal scrolling content pane — see the previous test's own comment.
        DOM.sink.apply(viewer._content.getElement(true), { style: { left: '0px', top: '0px', width: '400px', height: '300px' } });

        const headings = viewer._tracker.getHeadings() as Array<{ id: string }>;

        DOM.sink.apply(DOM.source.getElementById(headings[0].id)!, { style: { left: '0px', top: '0px',   width: '10px', height: '10px' } });
        // The second and third headings sit at the exact same top — two
        // adjacent headings with no content between them, a layout a
        // real clamped scroll-to-end can also produce (see
        // findActiveHeading's own doc comment). Pure top-crossing alone
        // would resolve to whichever of the two comes last in document
        // order, regardless of which one was actually clicked.
        DOM.sink.apply(DOM.source.getElementById(headings[1].id)!, { style: { left: '0px', top: '200px', width: '10px', height: '10px' } });
        DOM.sink.apply(DOM.source.getElementById(headings[2].id)!, { style: { left: '0px', top: '200px', width: '10px', height: '10px' } });

        const listener = vi.fn();
        viewer.on('activeheadingchange', listener);

        viewer._minimap.emit('select', headings[1].id);

        expect(viewer.getScrollTop()).toBe(200);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenLastCalledWith(headings[1].id);

        // The resulting native scroll event fires with scrollTop unchanged.
        // findActiveHeading alone would resolve to the third heading here
        // (both tie for "last crossed") — the pin from the click keeps the
        // second heading, the one actually clicked, active instead.
        viewer.handleNativeScroll();

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenLastCalledWith(headings[1].id);

        // A genuine further scroll clears the pin and resumes geometry-driven
        // tracking, now correctly resolving to the third heading.
        viewer.setScrollTop(205);
        viewer.handleNativeScroll();

        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenLastCalledWith(headings[2].id);
    });

    it('honours a construction-time listeners.activeheadingchange callback', () => {
        installTestDOM(CONFIG);

        const listener = vi.fn();
        const viewer = new MarkdownViewer({ markdown: SOURCE, listeners: { activeheadingchange: listener } }) as any;
        viewer.getElement(true);

        const headings = viewer._tracker.getHeadings() as Array<{ id: string }>;

        DOM.sink.apply(DOM.source.getElementById(headings[0].id)!, { style: { left: '0px', top: '100px', width: '10px', height: '10px' } });
        DOM.sink.apply(DOM.source.getElementById(headings[1].id)!, { style: { left: '0px', top: '600px', width: '10px', height: '10px' } });
        DOM.sink.apply(DOM.source.getElementById(headings[2].id)!, { style: { left: '0px', top: '900px', width: '10px', height: '10px' } });

        viewer.setScrollTop(500);
        viewer.handleNativeScroll();

        expect(listener).toHaveBeenCalledWith(headings[0].id);
    });
});
