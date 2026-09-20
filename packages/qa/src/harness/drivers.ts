// The built-in drivers. A panel names a driver by a key of its targets; the
// driver acts on that target for one phase and returns one timing sample per
// measured unit. Ported from Loom's `runDrag`, `runWheelScroll` and
// `runResize`, with the target handed in instead of looked up.

import type { AnyObj, DriveContext, Driver } from './types.js';

/**
 * Wheel delta per unit, in pixels: Loom's per-notch value, kept so the app's
 * wheel phases scroll exactly as the campaign's did.
 */
const WHEEL_DELTA_PX = 40;

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
 * Drags `target.element` along `target.axis`: a `mousedown` at its centre,
 * one `mousemove` on `document` per frame moving `stepPx` out for the first
 * half of the units and back for the second, then a `mouseup`.
 *
 * @param ctx - The phase's context; `ctx.target` is `{ element, axis }`.
 * @returns The frame gaps.
 */
async function drag(ctx: DriveContext): Promise<number[]> {
    const target = ctx.target as { element?: unknown; axis?: unknown } | null | undefined;
    const element = requireElement('drag', target?.element);
    const axis = target?.axis;

    if (axis !== 'x' && axis !== 'y') {
        throw new Error('drag: target axis must be "x" or "y"');
    }

    let { x, y } = centreOf(element);

    ctx.tools.fireMouse('mousedown', element, x, y);

    const gaps = await ctx.tools.runFrames(ctx.units, (i) => {
        const delta = triangleStep(i, ctx.units, ctx.stepPx);

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

/** Driver name → driver. A panel names these by the keys of its targets. */
export const DRIVERS: Record<string, Driver> = { drag, wheel, resize, passes };
