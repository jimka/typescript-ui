// What the harness records about the page rather than about a phase's work:
// the geometry probe (sampled once per driven unit under `geom=1`) and the
// `before` snapshot. Ported from Loom's qa-harness.ts; nothing here runs at
// import time.

import { countPainted, elementOf, isPainted } from './dom.js';
import type { AnyObj, GeometryTarget, HarnessTools } from './types.js';

/** One rounded `[left, top, width, height]` rectangle, or `null` for a missing element. */
type GeometrySample = [number, number, number, number] | null;

/** The labelled targets the probe samples, or `null` while the probe is off. */
let geometryTargets: Record<string, GeometryTarget> | null = null;

/** The samples taken since the probe was switched on, per label. */
let geometrySeries: Record<string, GeometrySample[]> = {};

/**
 * Switches the geometry probe on for one phase, or leaves it off.
 *
 * @param targets - Label → target to sample every unit; `null` keeps the probe off.
 */
export function setGeometryTargets(targets: Record<string, GeometryTarget> | null): void {
    geometryTargets = targets;
    geometrySeries = {};

    for (const label of Object.keys(targets ?? {})) {
        geometrySeries[label] = [];
    }
}

/**
 * Appends one rounded rectangle per label; a no-op while the probe is off.
 * Each sample forces a layout, which is why the probe is opt-in.
 */
export function sampleGeometry(): void {
    if (!geometryTargets) {
        return;
    }

    for (const [label, target] of Object.entries(geometryTargets)) {
        geometrySeries[label].push(sampleTarget(target));
    }
}

/**
 * Returns the samples and switches the probe off.
 *
 * @returns The series per label, or `null` when the probe was off.
 */
export function takeGeometry(): Record<string, GeometrySample[]> | null {
    if (!geometryTargets) {
        return null;
    }

    const series = geometrySeries;

    setGeometryTargets(null);

    return series;
}

/**
 * The rounded rectangle of one geometry target.
 *
 * @param target - A CSS selector, or a component resolved through its id.
 * @returns `[left, top, width, height]`, or `null` when the target has no element.
 */
function sampleTarget(target: GeometryTarget): GeometrySample {
    const el = typeof target === 'string' ? document.querySelector(target) : elementOf(target);

    if (!el) {
        return null;
    }

    const r = el.getBoundingClientRect();

    return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
}

/**
 * The page before any phase ran: viewport, element counts, clamp tally, the
 * paint-feature scan, and the panel's own host fields.
 *
 * @param tools - The harness tools, for the component-tree walk.
 * @param host - The panel's `describe()` fields, stored as given.
 * @returns The `before` block of the report.
 */
export function snapshotBefore(tools: HarnessTools, host: AnyObj): AnyObj {
    return {
        viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
        elements: document.querySelectorAll('*').length,
        svgPainted: countPainted('svg'),
        textPainted: countPainted('.Text'),
        invisible: document.querySelectorAll('.ts-ui-component.invisible').length,
        undisplayed: document.querySelectorAll('.ts-ui-component.undisplayed').length,
        clampTally: clampTally(tools),
        scan: { ...countPaintFeatures(), ...findScrollContainers() },
        host,
    };
}

/**
 * Tallies `clampsToContentSize()` by class across the live tree, largest
 * count first. Read into the `before` block, so it costs nothing during a phase.
 *
 * @param tools - The harness tools, for the component-tree walk.
 * @returns Class name → how many live instances clamp to their content size.
 */
export function clampTally(tools: HarnessTools): Record<string, number> {
    const out: Record<string, number> = {};

    for (const c of tools.walkComponents()) {
        const fn = c.clampsToContentSize as (() => boolean) | undefined;

        if (typeof fn !== 'function') {
            continue;
        }

        let clamps = false;

        try {
            clamps = fn.call(c);
        } catch {
            continue;
        }

        if (clamps) {
            const key = tools.className(c);

            out[key] = (out[key] ?? 0) + 1;
        }
    }

    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

/** CSS `opacity` of a fully opaque element; anything lower makes the engine blend it. */
const FULLY_OPAQUE = 1;

/**
 * The computed-style features that make an element expensive to paint or
 * composite, each with the test that says a value has the feature.
 */
const EXPENSIVE: Array<[string, (v: string, cs: CSSStyleDeclaration) => boolean]> = [
    ['boxShadow', (v) => v !== 'none'],
    ['textShadow', (v) => v !== 'none'],
    ['filter', (v) => v !== 'none'],
    ['backdropFilter', (v) => v !== 'none' && v !== ''],
    ['opacity', (v) => parseFloat(v) < FULLY_OPAQUE],
    ['mixBlendMode', (v) => v !== 'normal'],
    ['backgroundImage', (v) => v !== 'none'],
    ['willChange', (v) => v !== 'auto'],
    ['transform', (v) => v !== 'none'],
    ['animationName', (v) => v !== 'none'],
    ['transitionDuration', (v) => v.split(',').some((d) => parseFloat(d) > 0)],
    ['maskImage', (v) => v !== 'none' && v !== ''],
    ['clipPath', (v) => v !== 'none'],
    ['borderRadius', (v, cs) => v !== '0px' && cs.overflow !== 'visible'],
    ['overflow', (v) => v !== 'visible'],
    ['position', (v) => v === 'fixed' || v === 'sticky'],
];

/**
 * How many of an element's classes name it in the scan. Two: the first is the
 * component's class, the second usually a state or variant, and more would
 * split one kind of element across many keys.
 */
const CLASS_KEY_PARTS = 2;

/**
 * Slack for `scrollWidth`/`scrollHeight` against `clientWidth`/`clientHeight`:
 * one pixel absorbs sub-pixel rounding, so only real overflow counts.
 */
const OVERFLOW_SLACK_PX = 1;

/**
 * An `offset` minus `client` size above this means something other than a
 * thin border takes space — a scrollbar gutter. Two pixels allows a one-pixel
 * border on each side.
 */
const BORDER_ALLOWANCE_PX = 2;

/**
 * An element's scan key: its first classes other than the framework's shared
 * marker class, or its tag name when it has none.
 *
 * @param el - The element.
 * @returns The key.
 */
function classKey(el: Element): string {
    const classes = (el.getAttribute('class') ?? '').split(/\s+/).filter((c) => c && c !== 'ts-ui-component');

    return classes.slice(0, CLASS_KEY_PARTS).join('.') || el.tagName.toLowerCase();
}

/**
 * Counts the painted elements and, among them, the expensive paint features
 * by property and by element class.
 *
 * @returns `painted`, `byProp`, `byClassProp` and `classCounts` (painted elements per class key).
 */
export function countPaintFeatures(): AnyObj {
    const byProp: Record<string, number> = {};
    const byClassProp: Record<string, Record<string, number>> = {};
    const classCounts: Record<string, number> = {};
    let painted = 0;

    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        if (!isPainted(el)) {
            continue;
        }

        painted++;

        const cls = classKey(el);

        classCounts[cls] = (classCounts[cls] ?? 0) + 1;

        const cs = getComputedStyle(el);

        for (const [prop, test] of EXPENSIVE) {
            const value = cs[prop as keyof CSSStyleDeclaration] as string;

            if (typeof value === 'string' && test(value, cs)) {
                byProp[prop] = (byProp[prop] ?? 0) + 1;
                byClassProp[cls] ??= {};
                byClassProp[cls][prop] = (byClassProp[cls][prop] ?? 0) + 1;
            }
        }
    }

    return { painted, byProp, byClassProp, classCounts };
}

/**
 * Walks every element once, painted or not: tallies each class key, and lists
 * the elements that scroll with overflowing content or give up space to a
 * scrollbar gutter.
 *
 * @returns `allClassCounts` (every element per class key) and `scrollContainers`.
 */
export function findScrollContainers(): AnyObj {
    const allClassCounts: Record<string, number> = {};
    const scrollContainers: AnyObj[] = [];

    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const cls = classKey(el);

        allClassCounts[cls] = (allClassCounts[cls] ?? 0) + 1;

        const cs = getComputedStyle(el);
        const ox = cs.overflowX;
        const oy = cs.overflowY;
        const scrollable = ['auto', 'scroll'].includes(ox) || ['auto', 'scroll'].includes(oy);
        const overflowing = el.scrollWidth > el.clientWidth + OVERFLOW_SLACK_PX || el.scrollHeight > el.clientHeight + OVERFLOW_SLACK_PX;
        const gutterX = el.offsetWidth - el.clientWidth;
        const gutterY = el.offsetHeight - el.clientHeight;

        if ((scrollable && overflowing) || gutterX > BORDER_ALLOWANCE_PX || gutterY > BORDER_ALLOWANCE_PX) {
            scrollContainers.push({
                cls, ox, oy,
                client: [el.clientWidth, el.clientHeight],
                scroll: [el.scrollWidth, el.scrollHeight],
                gutter: [gutterX, gutterY],
            });
        }
    }

    return { allClassCounts, scrollContainers };
}
