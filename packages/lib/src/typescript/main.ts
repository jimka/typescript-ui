// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Body, DOM, FocusHistory, SpatialNavigation } from '@jimka/typescript-ui/core';
import { Split } from '@jimka/typescript-ui/layout';
import type { LayoutSize } from '@jimka/typescript-ui/layout';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { Router, type RouteParams } from '@jimka/typescript-ui/router';
import { DemoNavigator } from "./DemoNavigator.js";
import { DemoSectionDeck } from "./DemoSectionDeck.js";
import { allSections, DEFAULT_SECTION_SLUG } from "./demoSections.js";
import { loadPaneSizes, savePaneSizes } from "./demoLayoutStore.js";
import { Benchmark } from "./perf/Benchmark.js";

// Starting nav width in px, seeded into the split below. A category label
// wider than this clips; the gutter is draggable and the result is persisted,
// so a reader who wants another width sets it once.
const NAV_DEFAULT_WIDTH = 200;

// Drag floor, so a gutter drag cannot crush the nav pane to nothing. A little
// over half NAV_DEFAULT_WIDTH: enough that a pane dragged to the floor still
// shows a row's chevron and the first several characters of its clipped label,
// so it still reads as the nav rather than a blank strip. Hardcoded rather than
// derived from the labels because their rendered widths are not known until
// after the first layout pass.
const NAV_MIN_WIDTH = 120;

// The visible divider between the panes is this gap; see `Split`'s `spacing`.
// Both panes are Containers with zero insets that paint no background of their
// own, so the gap itself is the divider — no border or divider component. The
// value is the one the layout's own worked example uses (docs/layouts/Split.md),
// so the demo app's divider matches what that page tells a reader to expect.
const GUTTER_SPACING = 8;

// Split divides equally between panes with no stored size, which would open the
// app with a 50% nav pane, so the starting geometry is seeded rather than left
// to that default. Pane 0 carries `weight: 0` so it persists as px; pane 1 is
// the only weighted pane, so its ratio is the whole remainder.
const DEFAULT_PANE_SIZES: LayoutSize[] = [
    { unit: "px",    value: NAV_DEFAULT_WIDTH },
    { unit: "ratio", value: 1                 },
];

DOM.source.getScrollBarWidth();
(window as any).bench = Benchmark;

FocusHistory.enable();
SpatialNavigation.enable();

const split = new Split({
    orientation: "horizontal",
    spacing:     GUTTER_SPACING,
    paneSizes:   loadPaneSizes(DEFAULT_PANE_SIZES),
    listeners:   { paneresize: savePaneSizes },
});

const body = await Body.init({ layoutManager: split });

// Both handlers are driven by the router rather than by the tree directly: the
// URL names the section the moment its row is clicked, so the location field
// never trails the visible panel — the same reason the old tab strip drove
// "select" rather than "activate".
function showDefaultSection(): void {
    deck.show(DEFAULT_SECTION_SLUG);
    demoNav.select(DEFAULT_SECTION_SLUG);
}

// An unknown slug shows the default section and leaves the URL alone, so the
// location field still reads the bad segment while Misc. is on screen. This is
// deliberately *not* what the tab strip did: its handler was a no-op on a miss,
// so mid-session the panel already showing simply stayed. The two agree only on
// a fresh load, where that panel was the default one anyway; switching is the
// better of the two, since a miss now always lands somewhere legible rather
// than depending on what happened to be open.
function showSection(params: RouteParams): void {
    if (!deck.show(params.section)) {
        showDefaultSection();

        return;
    }

    demoNav.select(params.section);
}

const router = new Router({
    routes: {
        "/":         showDefaultSection,
        "/:section": showSection,
    },
});

// Declared below the two handlers, which read them only once `router.start()`
// runs on the last line — the same arrangement the previous hash-sync handler
// used, where it closed over a `router` declared beneath it.
// Height is 0 because a horizontal Split clamps a gutter drag against the
// main-axis component of a pane's min size only — `min.width` here — so the
// height would impose nothing on the drag, and leaving it at 0 also keeps the
// pane from handing the Body a vertical minimum of its own.
const demoNav = new DemoNavigator(router, { minSize: { width: NAV_MIN_WIDTH, height: 0 } });
const deck    = new DemoSectionDeck(allSections());

body.addComponent(demoNav, { weight: 0 });
body.addComponent(deck,    { weight: 1 });

// Applies the current route synchronously, so the routed panel is already
// mounted and visible when the first layout pass runs.
router.start();

const PersonModel = new Model([
    { name: 'id',   type: 'number'                  },
    { name: 'name', type: 'string'                  },
    { name: 'age',  type: 'number', defaultValue: 0 },
]);

const store = new MemoryStore(PersonModel, [
    { id: 1, name: 'Alice', age: 30 },
    { id: 2, name: 'Bob'  , age: 25 },
]);

store.on('load', () => {
    for (let obj of store.getAll()) {
        console.log(obj);
    }
});

await store.load();

if (false) {
    Benchmark.benchAll();
}
