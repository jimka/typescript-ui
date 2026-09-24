// The built-in drivers. A panel names a driver by a key of its targets; the
// driver acts on that target for one phase and returns one timing sample per
// measured unit. `drag`, `wheel` and `resize` are ported from Loom's
// `runDrag`, `runWheelScroll` and `runResize`, with the target handed in
// instead of looked up; the drivers after `passes` are new. A driver's own
// setup and teardown run inside `tools.suspendCounting`, so only its measured
// units land in the counters.

import { countCssRules } from './dom.js';
import { awaitSettledGeometry } from './probes.js';
import type {
    AnyObj,
    CallTarget,
    ClickTarget,
    DriveContext,
    Driver,
    HarnessTools,
    HoverTarget,
    KeyTarget,
    PanTarget,
    ParkTarget,
    ThemeTarget,
    TypeTarget,
} from './types.js';

/**
 * Wheel delta per unit, in pixels: Loom's per-notch value, kept so the app's
 * wheel phases scroll exactly as the campaign's did.
 */
const WHEEL_DELTA_PX = 40;

/**
 * Mouse moves in `park`'s unmeasured lead-in, one per frame: the `Split` sees
 * a gradual drag, as it would from a user, rather than one jump.
 */
const LEAD_FRAMES = 10;

/**
 * Frames a driver waits after its unmeasured setup or teardown: one for
 * `Split.scheduleDrag`'s coalesced flush, one for the layout flush it
 * schedules, and one spare. The same wait lets a focus or caret move's
 * deferred work land — the engine's `selectionchange` task, and an editor's
 * update and relayout after it — before the measured units start.
 */
const SETTLE_FRAMES = 3;

/**
 * Frames `settle` needs every probed rectangle to hold still for before it
 * calls the page rested. Two, so one frame's pause inside a burst — an eased
 * scroll's slowest step, or a dropped frame — does not read as rest.
 */
const SETTLE_STABLE_FRAMES = 2;

/**
 * The most frames `settle` waits before failing the run: two seconds at 60 Hz,
 * and over ten at the 91.5 ms per frame `table-rows`' wheel phase runs at
 * (plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md, `trw`).
 * A page still moving by then is not settling.
 */
const SETTLE_CAP_FRAMES = 120;

/**
 * The fewest units `park` runs: its moved check reads the element's rectangle
 * before the last unit's move lands, which with one unit is the lead-in's own
 * rectangle, so a single unit could never show a drag that did not park.
 */
const PARK_MIN_UNITS = 2;

/** Mouse moves in `park`'s restore drag, one per frame, for `LEAD_FRAMES`' reason. */
const RESTORE_FRAMES = 10;

/** How far inside its element `hover` sweeps: one pixel keeps the pointer inside it at both ends. */
const EDGE_INSET_PX = 1;

/** The pointer id WebKit gives the mouse, so a synthetic pointer event reads as the mouse's. */
const POINTER_ID = 1;

/** Frames `theme` waits after the last switch before counting rules: the switch's restyle lands in it. */
const THEME_COUNT_FRAMES = 1;

/** Frames `theme` waits after restoring: the restyle, and the relayout it schedules, land before the phase ends. */
const THEME_SETTLE_FRAMES = 3;

// `button` and `buttons` values, fixed by the UI Events spec, as in dom.ts:
// `button` 0 is the primary button, and `buttons` is a bitmask whose bit 0 is
// the primary button.
const PRIMARY_BUTTON = 0;
const NO_BUTTONS_HELD = 0;
const PRIMARY_BUTTON_HELD = 1;

/** A point in client coordinates. */
interface Point {
    x: number;
    y: number;
}

/** A rectangle's edges, as `getBoundingClientRect` reports them. */
interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** The optional state a synthetic pointer or mouse event carries. */
interface PointerInit {
    buttons?: number;
    relatedTarget?: EventTarget | null;
}

/**
 * The signed step for unit `index` of a triangle wave: `+stepPx` for the
 * first half of the units, `-stepPx` for the second, so a phase ends where
 * it started.
 *
 * @param index - The unit's index.
 * @param units - The phase's unit count.
 * @param stepPx - The step size.
 * @returns The step to apply for this unit.
 */
function triangleStep(index: number, units: number, stepPx: number): number {
    return index < units / 2 ? stepPx : -stepPx;
}

/**
 * The centre of an element's box, in client coordinates.
 *
 * @param el - The element.
 * @returns The centre point.
 */
function centreOf(el: Element): { x: number; y: number } {
    const rect = el.getBoundingClientRect();

    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Checks that a driver's target is an object carrying every named method.
 *
 * @param driver - The driver's name, for the error.
 * @param target - The panel's target.
 * @param methods - The methods the driver calls.
 * @returns The target, typed for calling them.
 * @throws Error - `<driver>: …` when the target is missing or lacks a method.
 */
function requireMethods(driver: string, target: unknown, methods: string[]): AnyObj {
    if (typeof target !== 'object' || target === null) {
        throw new Error(`${driver}: no target object`);
    }

    for (const method of methods) {
        if (typeof (target as AnyObj)[method] !== 'function') {
            throw new Error(`${driver}: target has no ${method}()`);
        }
    }

    return target as AnyObj;
}

/**
 * Checks that a driver's target is an element.
 *
 * @param driver - The driver's name, for the error.
 * @param target - The panel's target.
 * @returns The element.
 * @throws Error - `<driver>: target is not an element` otherwise.
 */
function requireElement(driver: string, target: unknown): Element {
    if (!(target instanceof Element)) {
        throw new Error(`${driver}: target is not an element`);
    }

    return target;
}

/**
 * Presses `target.element` at its centre and drags it along `target.axis`,
 * one `mousemove` on `document` per frame by whatever `stepFor` gives that
 * unit, then releases where it ended up.
 *
 * @param ctx - The phase's context; `ctx.target` is `{ element, axis }`.
 * @param name - The driver's name, for the errors.
 * @param stepFor - This unit's signed step along the axis, in px.
 * @returns The frame gaps.
 * @throws Error - `<name>: target is not an element` or
 *   `<name>: target axis must be "x" or "y"`, before anything is dispatched.
 */
async function pressAndDrag(ctx: DriveContext, name: string, stepFor: (index: number) => number): Promise<number[]> {
    const target = ctx.target as { element?: unknown; axis?: unknown } | null | undefined;
    const element = requireElement(name, target?.element);
    const axis = target?.axis;

    if (axis !== 'x' && axis !== 'y') {
        throw new Error(`${name}: target axis must be "x" or "y"`);
    }

    let { x, y } = centreOf(element);

    ctx.tools.fireMouse('mousedown', element, x, y);

    const gaps = await ctx.tools.runFrames(ctx.units, (i) => {
        const delta = stepFor(i);

        if (axis === 'x') {
            x += delta;
        } else {
            y += delta;
        }

        ctx.tools.fireMouse('mousemove', document, x, y);
    });

    ctx.tools.fireMouse('mouseup', document, x, y);

    return gaps;
}

/**
 * Drags `target.element` along `target.axis`: a `mousedown` at its centre,
 * one `mousemove` on `document` per frame moving `stepPx` out for the first
 * half of the units and back for the second, then a `mouseup`.
 *
 * @param ctx - The phase's context; `ctx.target` is `{ element, axis }`.
 * @returns The frame gaps.
 */
async function drag(ctx: DriveContext): Promise<number[]> {
    return pressAndDrag(ctx, 'drag', (i) => triangleStep(i, ctx.units, ctx.stepPx));
}

/**
 * Drags `target.element` `stepPx` along `target.axis` every unit, never back:
 * a `mousedown` at its centre, one `mousemove` on `document` per frame, and a
 * `mouseup` `units × stepPx` px from where it started. Unlike `drag`'s
 * triangle wave, this one ends somewhere else, so the layout it leaves behind
 * is the one the drag actually asked for.
 *
 * @param ctx - The phase's context; `ctx.target` is `{ element, axis }`, the
 *   same target `drag` uses.
 * @returns The frame gaps.
 */
async function dragout(ctx: DriveContext): Promise<number[]> {
    return pressAndDrag(ctx, 'dragout', () => ctx.stepPx);
}

/**
 * Wheel-scrolls `target` one notch per frame at its centre: down for the
 * first half of the units, back up for the second.
 *
 * @param ctx - The phase's context; `ctx.target` is an element.
 * @returns The frame gaps.
 */
async function wheel(ctx: DriveContext): Promise<number[]> {
    const element = requireElement('wheel', ctx.target);
    const { x, y } = centreOf(element);

    return ctx.tools.runFrames(ctx.units, (i) => {
        const deltaY = triangleStep(i, ctx.units, WHEEL_DELTA_PX);

        element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY, deltaMode: WheelEvent.DOM_DELTA_PIXEL }));
    });
}

/**
 * Window-resize stand-in: re-lays out `target` at a new width every frame,
 * `stepPx` narrower for the first half of the units and wider for the second,
 * then restores the original width. Exercises the "ancestor resizes, every
 * descendant relayouts" path a window resize does.
 *
 * @param ctx - The phase's context; `ctx.target` has `getWidth`, `setWidth` and `doLayout`.
 * @returns The frame gaps.
 */
async function resize(ctx: DriveContext): Promise<number[]> {
    const target = requireMethods('resize', ctx.target, ['getWidth', 'setWidth', 'doLayout']);
    const setWidth = target.setWidth as (w: number) => void;
    const doLayout = target.doLayout as () => void;
    const w0 = (target.getWidth as () => number).call(target);
    let w = w0;

    const gaps = await ctx.tools.runFrames(ctx.units, (i) => {
        w -= triangleStep(i, ctx.units, ctx.stepPx);
        setWidth.call(target, w);
        doLayout.call(target);
    });

    setWidth.call(target, w0);
    doLayout.call(target);

    return gaps;
}

/**
 * One synchronous `doLayout()` per unit on an unchanged target — "one
 * unchanged pass", the unit slice 26's census counted.
 *
 * @param ctx - The phase's context; `ctx.target` has `doLayout`.
 * @returns Each pass's duration.
 */
async function passes(ctx: DriveContext): Promise<number[]> {
    const target = requireMethods('passes', ctx.target, ['doLayout']);
    const doLayout = target.doLayout as () => void;

    return ctx.tools.runPasses(ctx.units, () => doLayout.call(target));
}

/**
 * The sweep offset for unit `index`: the distance `(index + 1) × stepPx`,
 * reflected between 0 and `spanPx`, so the pointer bounces between the two
 * ends of the sweep.
 *
 * @param index - The unit's index.
 * @param stepPx - Pixels per unit.
 * @param spanPx - The sweep's length.
 * @returns The offset from the sweep's start, in `[0, spanPx]`.
 */
export function sweepOffset(index: number, stepPx: number, spanPx: number): number {
    const travelled = ((index + 1) * stepPx) % (2 * spanPx);

    return travelled <= spanPx ? travelled : 2 * spanPx - travelled;
}

/**
 * The last rectangle, in document order, that contains a point. Left and top
 * edges are inclusive, right and bottom edges exclusive.
 *
 * @param rects - The rectangles, in document order.
 * @param x - The point's x.
 * @param y - The point's y.
 * @param usable - Skips an index for which it returns `false`; every index is usable by default.
 * @returns The index of the hit, or −1 when no usable rectangle contains the point.
 */
export function hitIndex(rects: ReadonlyArray<Rect>, x: number, y: number, usable: (index: number) => boolean = () => true): number {
    for (let index = rects.length - 1; index >= 0; index--) {
        const r = rects[index];

        if (x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height && usable(index)) {
            return index;
        }
    }

    return -1;
}

/**
 * How far past the start `park` holds the pointer at unit `index`: `leadPx`
 * plus `stepPx` more per unit for the first half of the units, then back, so
 * the pointer never returns closer than `leadPx`.
 *
 * @param index - The unit's index.
 * @param units - The phase's unit count.
 * @param stepPx - Pixels per unit.
 * @param leadPx - The lead-in's distance.
 * @returns The distance from the drag's start.
 */
export function parkOffset(index: number, units: number, stepPx: number, leadPx: number): number {
    const steps = index < units / 2 ? index + 1 : units - index - 1;

    return leadPx + stepPx * steps;
}

/**
 * A driver that calls its target once per frame with the unit's index. `call`,
 * `update` and `toggle` are all made by it: targets are keyed by driver name,
 * so a panel that offers two mutations needs two names.
 *
 * @param name - The driver's name; it prefixes the driver's errors.
 * @returns The driver.
 */
export function makeCallDriver(name: string): Driver {
    return async function callDriver(ctx: DriveContext): Promise<number[]> {
        if (typeof ctx.target !== 'function') {
            throw new Error(`${name}: target must be a function (index) => void`);
        }

        const call = ctx.target as CallTarget;

        return ctx.tools.runFrames(ctx.units, (index) => call(index));
    };
}

/**
 * Runs frames that do nothing, so whatever the page does on its own — an
 * animation loop, say — is what the phase measures. The target is ignored.
 *
 * @param ctx - The phase's context.
 * @returns The frame gaps.
 */
async function idle(ctx: DriveContext): Promise<number[]> {
    return ctx.tools.runFrames(ctx.units, () => {});
}

/**
 * Waits, unmeasured, until the page stops moving, then runs frames that do
 * nothing, as `idle` does. Every unit is therefore a settled sample, so a
 * geometry gate read on this phase compares the layout the page rests in
 * rather than one caught mid-burst. The target is ignored.
 *
 * @param ctx - The phase's context.
 * @returns The frame gaps.
 * @throws Error - `settle: still moving after <n> frames` when the page never rests.
 */
async function settle(ctx: DriveContext): Promise<number[]> {
    ctx.notes.push(await ctx.tools.suspendCounting(async () => awaitSettledGeometry(ctx.tools, SETTLE_STABLE_FRAMES, SETTLE_CAP_FRAMES)));

    return ctx.tools.runFrames(ctx.units, () => {});
}

/**
 * Reads one field of a target that may not be an object.
 *
 * @param target - The panel's target.
 * @param name - The field.
 * @returns The field's value, or `undefined` when the target is not an object.
 */
function field(target: unknown, name: string): unknown {
    return typeof target === 'object' && target !== null ? (target as AnyObj)[name] : undefined;
}

/**
 * Whether a value can stand for an element: it has `getBoundingClientRect`
 * and `dispatchEvent`, which is all the drivers call on one besides `focus`.
 *
 * @param value - Any value.
 * @returns `true` for an element, or a stand-in with those two functions.
 */
function isElementLike(value: unknown): value is Element {
    return typeof field(value, 'getBoundingClientRect') === 'function' && typeof field(value, 'dispatchEvent') === 'function';
}

/**
 * Whether a value names an axis.
 *
 * @param value - Any value.
 * @returns `true` for `'x'` or `'y'`.
 */
function isAxis(value: unknown): value is 'x' | 'y' {
    return value === 'x' || value === 'y';
}

/**
 * Checks `hover`'s target.
 *
 * @param target - The panel's target.
 * @returns The target, typed.
 * @throws Error - When the element or the axis is missing or wrong.
 */
function requireHoverTarget(target: unknown): HoverTarget {
    if (!isElementLike(field(target, 'element')) || !isAxis(field(target, 'axis'))) {
        throw new Error('hover: target must be { element, axis: "x" | "y" }');
    }

    return target as HoverTarget;
}

/**
 * Checks `park`'s target.
 *
 * @param target - The panel's target.
 * @returns The target, typed.
 * @throws Error - When any field is missing or wrong; `leadPx` must be a positive, finite number.
 */
function requireParkTarget(target: unknown): ParkTarget {
    const direction = field(target, 'direction');
    const leadPx = field(target, 'leadPx');

    if (!isElementLike(field(target, 'element')) || !isAxis(field(target, 'axis'))
        || (direction !== 1 && direction !== -1)
        || typeof leadPx !== 'number' || !Number.isFinite(leadPx) || leadPx <= 0) {
        throw new Error('park: target must be { element, axis: "x" | "y", direction: 1 | -1, leadPx > 0 }');
    }

    return target as ParkTarget;
}

/**
 * Checks `click`'s target.
 *
 * @param target - The panel's target.
 * @returns The target, typed.
 * @throws Error - When `elements` is missing, empty, or holds a non-element.
 */
function requireClickTarget(target: unknown): ClickTarget {
    const elements = field(target, 'elements');

    if (!Array.isArray(elements) || elements.length === 0 || !elements.every(isElementLike)) {
        throw new Error('click: target must be { elements: [Element, …] } with at least one element');
    }

    return target as ClickTarget;
}

/**
 * Checks `key`'s target.
 *
 * @param target - The panel's target.
 * @returns The target, typed.
 * @throws Error - When the element is missing, or `keys` is empty or holds a non-string.
 */
function requireKeyTarget(target: unknown): KeyTarget {
    const keys = field(target, 'keys');

    if (!isElementLike(field(target, 'element')) || !Array.isArray(keys) || keys.length === 0 || !keys.every((k) => typeof k === 'string')) {
        throw new Error('key: target must be { element, keys: [string, …] } with at least one key');
    }

    return target as KeyTarget;
}

/**
 * Checks `type`'s target.
 *
 * @param target - The panel's target.
 * @returns The target, typed.
 * @throws Error - When the element is missing or cannot be focused, or `text` is empty or not a string.
 */
function requireTypeTarget(target: unknown): TypeTarget {
    const element = field(target, 'element');
    const text = field(target, 'text');

    if (!isElementLike(element) || typeof field(element, 'focus') !== 'function' || typeof text !== 'string' || text === '') {
        throw new Error('type: target must be { element, text } with a non-empty text');
    }

    return target as TypeTarget;
}

/**
 * Checks `theme`'s target.
 *
 * @param target - The panel's target.
 * @returns The target, typed.
 * @throws Error - When `cycle` or `restore` is missing.
 */
function requireThemeTarget(target: unknown): ThemeTarget {
    if (typeof field(target, 'cycle') !== 'function' || typeof field(target, 'restore') !== 'function') {
        throw new Error('theme: target must be { cycle(index), restore() }');
    }

    return target as ThemeTarget;
}

/**
 * Dispatches a bubbling, cancelable `PointerEvent` from the primary mouse:
 * `PointerEvent` carries fields a `MouseEvent` does not (`pointerId`,
 * `pointerType`), so it has its own helper rather than `tools.fireMouse`.
 *
 * @param type - The event type, e.g. `pointermove`.
 * @param target - What the event is dispatched on.
 * @param x - The event's `clientX`.
 * @param y - The event's `clientY`.
 * @param init - `buttons` (default 0) and `relatedTarget` (default `null`).
 */
function firePointer(type: string, target: EventTarget, x: number, y: number, init: PointerInit = {}): void {
    target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: POINTER_ID,
        pointerType: 'mouse',
        isPrimary: true,
        button: PRIMARY_BUTTON,
        buttons: init.buttons ?? NO_BUTTONS_HELD,
        clientX: x,
        clientY: y,
        relatedTarget: init.relatedTarget ?? null,
    }));
}

/**
 * Dispatches `pointer<kind>` then `mouse<kind>` on one target, in the order a
 * browser does. Each family reaches only its own listeners, so a gesture that
 * sent one would leave the other half of the hot path unexercised.
 *
 * @param tools - The harness tools, for `fireMouse`.
 * @param kind - The event kind: `over`, `out`, `move`, `down` or `up`.
 * @param target - What both events are dispatched on.
 * @param x - The events' `clientX`.
 * @param y - The events' `clientY`.
 * @param init - The events' `buttons` and `relatedTarget`.
 */
function firePair(tools: HarnessTools, kind: string, target: EventTarget, x: number, y: number, init: PointerInit): void {
    firePointer(`pointer${kind}`, target, x, y, init);
    tools.fireMouse(`mouse${kind}`, target, x, y, init);
}

/**
 * Dispatches a bubbling, cancelable `KeyboardEvent`.
 *
 * @param type - `keydown` or `keyup`.
 * @param target - What the event is dispatched on.
 * @param key - The event's `key`.
 */
function fireKey(type: string, target: EventTarget, key: string): void {
    target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key }));
}

/** What `hover` reads once, before its first unit. */
interface SweepFrame {
    /** The target element, then every descendant the pointer can hit, in document order. */
    candidates: Element[];
    /** Each candidate's rectangle, read at phase start. */
    rects: Rect[];
    /** The sweep's length along the axis. */
    span: number;
    /** The point `offset` along the sweep, on the element's centre line. */
    pointAt(offset: number): Point;
}

/** What `hover` tracks from unit to unit. */
interface SweepState {
    /** The element under the pointer, or `null` before the first unit. */
    current: Element | null;
    /** How often the element under the pointer changed. */
    crossings: number;
    /** Where the pointer is. */
    point: Point;
}

/**
 * Whether the engine's own hit test can land on an element: one whose
 * computed `pointer-events` is `none`, or whose `visibility` is `hidden`, is
 * passed through to whatever lies beneath. A `Button` relies on this: its
 * content is `pointer-events: none`, so its whole face hits the button, whose
 * tooltip listens on it alone.
 *
 * @param element - A descendant of the swept element.
 * @returns `true` when a pointer over it would target it.
 */
function isHittable(element: Element): boolean {
    const style = getComputedStyle(element);

    return style.pointerEvents !== 'none' && style.visibility !== 'hidden';
}

/**
 * Reads the rectangles `hover` hit-tests against: the target element's and
 * every hittable descendant's. Reading them once makes the event sequence a
 * function of the panel and the step, so every arm of a comparison gets the
 * same one.
 *
 * @param target - `hover`'s target.
 * @returns The sweep's candidates, rectangles, span and point function.
 * @throws Error - `hover: element has no extent along <axis>` when the element is too small to sweep.
 */
function readSweepFrame(target: HoverTarget): SweepFrame {
    const box = target.element.getBoundingClientRect();
    const horizontal = target.axis === 'x';
    const span = (horizontal ? box.width : box.height) - 2 * EDGE_INSET_PX;

    if (span < 1) {
        throw new Error(`hover: element has no extent along ${target.axis}`);
    }

    const descendants = Array.from(target.element.querySelectorAll('*')).filter(isHittable);
    const origin = (horizontal ? box.left : box.top) + EDGE_INSET_PX;
    const line = horizontal ? box.top + box.height / 2 : box.left + box.width / 2;

    return {
        candidates: [target.element, ...descendants],
        rects: [box, ...descendants.map((el) => el.getBoundingClientRect())],
        span,
        pointAt: (offset: number): Point => (horizontal ? { x: origin + offset, y: line } : { x: line, y: origin + offset }),
    };
}

/**
 * Moves the pointer from one element onto another, as a browser reports it:
 * `out` on the old element (when there is one), then `over` on the new, each
 * naming the other as `relatedTarget`.
 *
 * @param tools - The harness tools.
 * @param from - The element the pointer leaves, or `null`.
 * @param to - The element the pointer enters.
 * @param point - Where the pointer is.
 */
function crossBoundary(tools: HarnessTools, from: Element | null, to: Element, point: Point): void {
    if (from) {
        firePair(tools, 'out', from, point.x, point.y, { buttons: NO_BUTTONS_HELD, relatedTarget: to });
    }

    firePair(tools, 'over', to, point.x, point.y, { buttons: NO_BUTTONS_HELD, relatedTarget: from });
}

/**
 * One `hover` unit: moves the pointer to the unit's point, crosses into the
 * element under it when that changed, and moves over it.
 *
 * @param ctx - The phase's context.
 * @param frame - The rectangles read at phase start.
 * @param sweep - The sweep's state; updated.
 * @param index - The unit's index.
 */
function hoverUnit(ctx: DriveContext, frame: SweepFrame, sweep: SweepState, index: number): void {
    sweep.point = frame.pointAt(sweepOffset(index, ctx.stepPx, frame.span));

    // A candidate the page has since removed (a chart rebuilds its marks every
    // pass) is skipped; with none left under the pointer, the target element
    // itself is the hit.
    const hitAt = hitIndex(frame.rects, sweep.point.x, sweep.point.y, (k) => frame.candidates[k].isConnected);
    const hit = hitAt >= 0 ? frame.candidates[hitAt] : frame.candidates[0];

    if (hit !== sweep.current) {
        sweep.crossings++;
        crossBoundary(ctx.tools, sweep.current, hit, sweep.point);
        sweep.current = hit;
    }

    firePair(ctx.tools, 'move', hit, sweep.point.x, sweep.point.y, { buttons: NO_BUTTONS_HELD });
}

/**
 * Sweeps the pointer across `target.element` along `target.axis`, `stepPx`
 * per unit, bouncing between its edges one pixel inside them, with no button
 * held. Each unit sends `pointermove` and `mousemove` to the element under the
 * pointer, preceded by `out`/`over` pairs when that element changed. After the
 * last unit the pointer leaves the element it is over.
 *
 * @param ctx - The phase's context; `ctx.target` is a `HoverTarget`.
 * @returns The frame gaps.
 */
async function hover(ctx: DriveContext): Promise<number[]> {
    const target = requireHoverTarget(ctx.target);
    const frame = await ctx.tools.suspendCounting(async () => readSweepFrame(target));
    const sweep: SweepState = { current: null, crossings: 0, point: frame.pointAt(0) };
    const samples = await ctx.tools.runFrames(ctx.units, (index) => hoverUnit(ctx, frame, sweep, index));

    await ctx.tools.suspendCounting(async () => leaveAndSettle(ctx.tools, sweep));
    ctx.notes.push(`hover: ${sweep.crossings} crossings over ${ctx.units} units among ${frame.candidates.length} elements`);

    return samples;
}

/**
 * Moves the pointer off the element it is over, then lets the page settle.
 *
 * @param tools - The harness tools.
 * @param sweep - The sweep's state.
 */
async function leaveAndSettle(tools: HarnessTools, sweep: SweepState): Promise<void> {
    if (sweep.current) {
        firePair(tools, 'out', sweep.current, sweep.point.x, sweep.point.y, { buttons: NO_BUTTONS_HELD, relatedTarget: null });
    }

    await tools.waitFrames(SETTLE_FRAMES);
}

/**
 * An element's rectangle as a comparable key.
 *
 * @param element - The element.
 * @returns Its rounded `left,top,width,height`.
 */
function rectKey(element: Element): string {
    const r = element.getBoundingClientRect();

    return [r.left, r.top, r.width, r.height].map(Math.round).join(',');
}

/**
 * The point `offset` px from `start` in the park's direction along its axis.
 *
 * @param start - The drag's start.
 * @param target - `park`'s target.
 * @param offset - How far along.
 * @returns The point.
 */
function parkPoint(start: Point, target: ParkTarget, offset: number): Point {
    const delta = target.direction * offset;

    return target.axis === 'x' ? { x: start.x + delta, y: start.y } : { x: start.x, y: start.y + delta };
}

/**
 * `park`'s unmeasured lead-in: presses the element at its centre and drags
 * `leadPx` in the park's direction over `LEAD_FRAMES` frames, one move per
 * frame, then lets the page settle.
 *
 * @param tools - The harness tools.
 * @param target - `park`'s target.
 * @returns Where the drag started, and the element's rectangle once parked.
 */
async function leadIn(tools: HarnessTools, target: ParkTarget): Promise<{ start: Point; rect: string }> {
    const start = centreOf(target.element);

    tools.fireMouse('mousedown', target.element, start.x, start.y);

    for (let frame = 1; frame <= LEAD_FRAMES; frame++) {
        const point = parkPoint(start, target, (target.leadPx * frame) / LEAD_FRAMES);

        tools.fireMouse('mousemove', document, point.x, point.y);
        await tools.waitFrames(1);
    }

    await tools.waitFrames(SETTLE_FRAMES);

    return { start, rect: rectKey(target.element) };
}

/**
 * Drags an element from its current centre to `to` over `RESTORE_FRAMES`
 * frames and releases it there, then lets the page settle.
 *
 * @param tools - The harness tools.
 * @param element - The element to drag.
 * @param to - Where to release it.
 */
async function dragBack(tools: HarnessTools, element: Element, to: Point): Promise<void> {
    const from = centreOf(element);

    tools.fireMouse('mousedown', element, from.x, from.y);

    for (let frame = 1; frame <= RESTORE_FRAMES; frame++) {
        const t = frame / RESTORE_FRAMES;

        tools.fireMouse('mousemove', document, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
        await tools.waitFrames(1);
    }

    tools.fireMouse('mouseup', document, to.x, to.y);
    await tools.waitFrames(SETTLE_FRAMES);
}

/**
 * `park`'s unmeasured teardown: reads the element's rectangle, releases the
 * drag, and drags the element back to where the lead-in started.
 *
 * The last measured unit returns the pointer to `leadPx`, where the lead-in
 * left it, so the rectangle is read before that move lands: a `Split` or
 * `Accordion` gutter applies a move in the frame after it arrives. An element
 * that followed the pointer is therefore read one unit further out and differs
 * from the lead-in's rectangle.
 *
 * @param tools - The harness tools.
 * @param target - `park`'s target.
 * @param start - Where the lead-in started.
 * @param pointer - Where the pointer is.
 * @returns The element's rectangle at the end of the measured units.
 */
async function releaseAndRestore(tools: HarnessTools, target: ParkTarget, start: Point, pointer: Point): Promise<string> {
    const held = rectKey(target.element);

    tools.fireMouse('mouseup', document, pointer.x, pointer.y);
    await dragBack(tools, target.element, start);

    return held;
}

/**
 * A gutter drag parked against its clamp. An unmeasured lead-in presses the
 * element and drags it `leadPx` in `direction`, past the clamp; each measured
 * unit then moves the pointer on `document` to `parkOffset(…)` past the start,
 * out for the first half of the units and back for the second, never closer
 * than `leadPx`. An unmeasured teardown releases and drags the element back.
 *
 * @param ctx - The phase's context; `ctx.target` is a `ParkTarget`.
 * @returns The frame gaps.
 * @throws Error - Before anything is dispatched, for fewer than two units; after restoring, when the element moved during the measured units: `leadPx` did not reach the clamp.
 */
async function park(ctx: DriveContext): Promise<number[]> {
    const target = requireParkTarget(ctx.target);

    if (ctx.units < PARK_MIN_UNITS) {
        throw new Error(`park: needs at least ${PARK_MIN_UNITS} units, got ${ctx.units}`);
    }

    const lead = await ctx.tools.suspendCounting(async () => leadIn(ctx.tools, target));
    let pointer = parkPoint(lead.start, target, target.leadPx);

    const samples = await ctx.tools.runFrames(ctx.units, (index) => {
        pointer = parkPoint(lead.start, target, parkOffset(index, ctx.units, ctx.stepPx, target.leadPx));
        ctx.tools.fireMouse('mousemove', document, pointer.x, pointer.y);
    });

    const held = await ctx.tools.suspendCounting(async () => releaseAndRestore(ctx.tools, target, lead.start, pointer));

    if (held !== lead.rect) {
        throw new Error(`park: the element moved during the measured units (${lead.rect} → ${held}); leadPx does not reach the clamp`);
    }

    ctx.notes.push(`park: lead ${target.leadPx}px, element held at ${lead.rect} for ${ctx.units} units`);

    return samples;
}

/**
 * One primary-button click at `point` on `element`: a press and a release,
 * each as a pointer and a mouse event, then `click`.
 *
 * @param tools - The harness tools.
 * @param element - The element clicked.
 * @param point - Where it is clicked.
 */
function pressAndRelease(tools: HarnessTools, element: Element, point: Point): void {
    firePair(tools, 'down', element, point.x, point.y, { buttons: PRIMARY_BUTTON_HELD });
    firePair(tools, 'up', element, point.x, point.y, { buttons: NO_BUTTONS_HELD });
    tools.fireMouse('click', element, point.x, point.y, { buttons: NO_BUTTONS_HELD });
}

/**
 * One click per unit at the centre of each element in turn, the centres read
 * once before the first unit.
 *
 * @param ctx - The phase's context; `ctx.target` is a `ClickTarget`.
 * @returns The frame gaps.
 */
async function click(ctx: DriveContext): Promise<number[]> {
    const { elements } = requireClickTarget(ctx.target);
    const centres = await ctx.tools.suspendCounting(async () => elements.map((el) => centreOf(el)));

    return ctx.tools.runFrames(ctx.units, (index) => {
        const k = index % elements.length;

        pressAndRelease(ctx.tools, elements[k], centres[k]);
    });
}

/**
 * One `keydown` and `keyup` per unit on the focused element, cycling through
 * `keys`. The focus, and what it sets off, settle before the first unit.
 *
 * @param ctx - The phase's context; `ctx.target` is a `KeyTarget`.
 * @returns The frame gaps.
 */
async function key(ctx: DriveContext): Promise<number[]> {
    const { element, keys } = requireKeyTarget(ctx.target);

    await ctx.tools.suspendCounting(async () => {
        (element as HTMLElement).focus({ preventScroll: true });
        await ctx.tools.waitFrames(SETTLE_FRAMES);
    });

    return ctx.tools.runFrames(ctx.units, (index) => {
        const name = keys[index % keys.length];

        fireKey('keydown', element, name);
        fireKey('keyup', element, name);
    });
}

/**
 * Focuses an element and puts the caret at its end: an `<input>` or
 * `<textarea>` through its selection range, anything else as a
 * contenteditable through the document selection.
 *
 * @param element - The element typed into.
 * @param tag - Its lower-case tag name, for the error.
 * @throws Error - `type: <tag> did not take focus` when neither it nor a descendant holds focus.
 */
function focusAtEnd(element: HTMLElement, tag: string): void {
    element.focus({ preventScroll: true });

    if (!element.contains(document.activeElement)) {
        throw new Error(`type: ${tag} did not take focus`);
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.setSelectionRange(element.value.length, element.value.length);

        return;
    }

    const selection = getSelection()!;

    selection.selectAllChildren(element);
    selection.collapseToEnd();
}

/**
 * Inserts one character the way an editing command does, so the engine fires
 * its own trusted `beforeinput` and `input` events.
 *
 * @param text - The text to cycle through.
 * @param index - The unit's index.
 * @param tag - The element's lower-case tag name, for the error.
 * @throws Error - When the engine refuses the insert.
 */
function insertCharacter(text: string, index: number, tag: string): void {
    if (!document.execCommand('insertText', false, text[index % text.length])) {
        throw new Error(`type: document.execCommand("insertText") returned false for ${tag}`);
    }
}

/**
 * Deletes what `type` typed, one character per unit, then lets the page settle.
 *
 * @param tools - The harness tools.
 * @param count - How many characters were typed.
 */
async function deleteTyped(tools: HarnessTools, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
        document.execCommand('delete');
    }

    await tools.waitFrames(SETTLE_FRAMES);
}

/**
 * Types one character per unit into `target.element` through
 * `document.execCommand('insertText')`, cycling through `target.text`; a
 * synthetic `KeyboardEvent` would insert nothing. Afterwards it deletes what
 * it typed.
 *
 * @param ctx - The phase's context; `ctx.target` is a `TypeTarget`.
 * @returns The frame gaps.
 * @throws Error - Before any unit, when the engine has no `execCommand` or the element does not take focus.
 */
async function typeText(ctx: DriveContext): Promise<number[]> {
    const { element, text } = requireTypeTarget(ctx.target);
    const tag = element.tagName.toLowerCase();

    if (typeof document.execCommand !== 'function') {
        throw new Error(`type: this engine has no document.execCommand; cannot type into ${tag}`);
    }

    // Moving the caret queues a `selectionchange`, which an editor answers
    // with an update of its own; both land before counting resumes.
    await ctx.tools.suspendCounting(async () => {
        focusAtEnd(element as HTMLElement, tag);
        await ctx.tools.waitFrames(SETTLE_FRAMES);
    });

    const samples = await ctx.tools.runFrames(ctx.units, (index) => insertCharacter(text, index, tag));

    await ctx.tools.suspendCounting(async () => deleteTyped(ctx.tools, ctx.units));
    ctx.notes.push(`type: ${ctx.units} characters into ${tag}`);

    return samples;
}

/**
 * `theme`'s unmeasured teardown: counts the rules once the last switch has
 * restyled, then restores the page's theme and lets it settle.
 *
 * @param tools - The harness tools.
 * @param target - `theme`'s target.
 * @returns The rule count after the last switch.
 */
async function countAndRestore(tools: HarnessTools, target: ThemeTarget): Promise<number> {
    await tools.waitFrames(THEME_COUNT_FRAMES);

    const after = countCssRules();

    target.restore();
    await tools.waitFrames(THEME_SETTLE_FRAMES);

    return after;
}

/**
 * Switches the page's theme once per unit through `target.cycle(index)`,
 * then restores it. The note gives the page's CSS rule total before the
 * first switch and after the last, which shows a leak of per-switch rules.
 *
 * @param ctx - The phase's context; `ctx.target` is a `ThemeTarget`.
 * @returns The frame gaps.
 */
async function theme(ctx: DriveContext): Promise<number[]> {
    const target = requireThemeTarget(ctx.target);
    const before = await ctx.tools.suspendCounting(async () => countCssRules());
    const samples = await ctx.tools.runFrames(ctx.units, (index) => target.cycle(index));
    const after = await ctx.tools.suspendCounting(async () => countAndRestore(ctx.tools, target));

    ctx.notes.push(`theme: CSS rules ${before} → ${after} over ${ctx.units} switches`);

    return samples;
}

/**
 * Checks `pan`'s target.
 *
 * @param target - The panel's target.
 * @returns The target, typed.
 * @throws Error - When the element or the axis is missing or wrong.
 */
function requirePanTarget(target: unknown): PanTarget {
    if (!isElementLike(field(target, 'element')) || !isAxis(field(target, 'axis'))) {
        throw new Error('pan: target must be { element, axis: "x" | "y" }');
    }

    return target as PanTarget;
}

/**
 * The point `offset` px from `origin` along `axis`.
 *
 * @param origin - Where the offset is measured from.
 * @param axis - The axis to move along.
 * @param offset - How far along.
 * @returns The point.
 */
function offsetAlong(origin: Point, axis: 'x' | 'y', offset: number): Point {
    return axis === 'x' ? { x: origin.x + offset, y: origin.y } : { x: origin.x, y: origin.y + offset };
}

/**
 * `pan`'s unmeasured press: a pointer and a mouse press at the element's
 * centre, the primary button held.
 *
 * @param tools - The harness tools.
 * @param element - The element pressed.
 * @returns Where it was pressed.
 */
function pressAtCentre(tools: HarnessTools, element: Element): Point {
    const centre = centreOf(element);

    firePair(tools, 'down', element, centre.x, centre.y, { buttons: PRIMARY_BUTTON_HELD });

    return centre;
}

/**
 * `pan`'s unmeasured release: a pointer and a mouse release on the element
 * where the pointer is, then lets the page settle.
 *
 * @param tools - The harness tools.
 * @param element - The element pressed.
 * @param point - Where the pointer is.
 */
async function releaseAndSettle(tools: HarnessTools, element: Element, point: Point): Promise<void> {
    firePair(tools, 'up', element, point.x, point.y, { buttons: NO_BUTTONS_HELD });
    await tools.waitFrames(SETTLE_FRAMES);
}

/**
 * `drag` for pointer events: an unmeasured press at the element's centre,
 * then one `pointermove` and `mousemove` per unit on the element itself,
 * `parkOffset(…)` along the axis with no lead — out for the first half of the
 * units and back for the second — and an unmeasured release. Every event goes
 * to the pressed element, as it would under a pointer that stays over it or an
 * element that holds pointer capture; a `DiagramView` or a `Slider` listens
 * for them there, where `drag`'s moves on `document` never arrive.
 *
 * @param ctx - The phase's context; `ctx.target` is a `PanTarget`.
 * @returns The frame gaps.
 */
async function pan(ctx: DriveContext): Promise<number[]> {
    const target = requirePanTarget(ctx.target);
    const origin = await ctx.tools.suspendCounting(async () => pressAtCentre(ctx.tools, target.element));
    let point = origin;

    const samples = await ctx.tools.runFrames(ctx.units, (index) => {
        point = offsetAlong(origin, target.axis, parkOffset(index, ctx.units, ctx.stepPx, 0));
        firePair(ctx.tools, 'move', target.element, point.x, point.y, { buttons: PRIMARY_BUTTON_HELD });
    });

    await ctx.tools.suspendCounting(async () => releaseAndSettle(ctx.tools, target.element, point));

    return samples;
}

/**
 * Fires the window's `resize` event once per unit, so every viewport listener
 * runs, at an unchanged viewport size: no page script can resize the top-level
 * window of either host. The target is ignored.
 *
 * @param ctx - The phase's context.
 * @returns The frame gaps.
 */
async function viewport(ctx: DriveContext): Promise<number[]> {
    return ctx.tools.runFrames(ctx.units, () => {
        window.dispatchEvent(new Event('resize'));
    });
}

/**
 * `wheel` on the horizontal axis: one notch per frame at the element's
 * centre, right for the first half of the units and back left for the second.
 *
 * @param ctx - The phase's context; `ctx.target` is an element.
 * @returns The frame gaps.
 * @throws Error - `hwheel: target must be an Element` otherwise.
 */
async function hwheel(ctx: DriveContext): Promise<number[]> {
    if (!isElementLike(ctx.target)) {
        throw new Error('hwheel: target must be an Element');
    }

    const element = ctx.target;
    const { x, y } = centreOf(element);

    return ctx.tools.runFrames(ctx.units, (i) => {
        const deltaX = triangleStep(i, ctx.units, WHEEL_DELTA_PX);

        element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaX, deltaY: 0, deltaMode: WheelEvent.DOM_DELTA_PIXEL }));
    });
}

/** Driver name → driver. A panel names these by the keys of its targets. */
export const DRIVERS: Record<string, Driver> = {
    drag,
    dragout,
    wheel,
    resize,
    passes,
    idle,
    settle,
    call: makeCallDriver('call'),
    update: makeCallDriver('update'),
    toggle: makeCallDriver('toggle'),
    hover,
    park,
    click,
    key,
    type: typeText,
    theme,
    pan,
    viewport,
    hwheel,
};
