// Runtime ablations (`abl=<name>[,…]`): each patches the page's live code to
// remove one piece of work, so a same-session A/B against a run without it
// bounds what removing that work in the library could save. Ported from
// Loom's `ABLATIONS`, minus the entries whose change is in the library now
// (`size.memo`, `skip.unchanged`, `border.region-memo`, `accordion.seed`) and
// the dropped G10 pair (`clamp.rows`, `clamp.once`), plus the W3.0 bounding
// sweep's arms (plans/implemented/w3-0-bounding-sweep.md), each of which
// counts its own engagement under `skipped.<name>.`, `memo.<name>.` or
// `dose.<name>.`. Nothing here patches anything at import time.

import { cssAccessorHost } from './counters.js';
import type { Ablation, AnyObj, HarnessLibrary, HarnessTools } from './types.js';

/**
 * Drops every stylesheet-rule write — rule declarations through
 * `setProperty`, `removeProperty`, `cssText` and the camelCase accessors, and
 * rule insertion and deletion — while leaving inline-style writes intact.
 * Applied on top of the write counters when both are requested, so counted
 * rule writes fall to zero as proof.
 *
 * @returns A note saying how many camelCase accessors were wrapped.
 */
export function dropRuleWrites(): string {
    dropRuleDeclarationWrites();

    const accessors = dropRuleAccessorWrites();

    CSSStyleSheet.prototype.insertRule = function (): number {
        return 0;
    };

    CSSStyleSheet.prototype.deleteRule = function (): void { /* dropped */ };

    return `rule writes dropped (incl. ${accessors} camelCase accessors)`;
}

/** Makes `setProperty`, `removeProperty` and `cssText` writes to a stylesheet rule do nothing. */
function dropRuleDeclarationWrites(): void {
    const declProto = CSSStyleDeclaration.prototype;
    const setProperty = declProto.setProperty;
    const removeProperty = declProto.removeProperty;
    const cssTextDesc = Object.getOwnPropertyDescriptor(declProto, 'cssText');

    declProto.setProperty = function (this: CSSStyleDeclaration, key: string, value: string | null, priority?: string): void {
        if (!this.parentRule) {
            setProperty.call(this, key, value, priority);
        }
    };

    declProto.removeProperty = function (this: CSSStyleDeclaration, key: string): string {
        return this.parentRule ? '' : removeProperty.call(this, key);
    };

    if (cssTextDesc?.set && cssTextDesc.get) {
        const setCssText = cssTextDesc.set;

        Object.defineProperty(declProto, 'cssText', {
            configurable: true,
            enumerable: cssTextDesc.enumerable,
            get: cssTextDesc.get,
            set(this: CSSStyleDeclaration, value: string): void {
                if (!this.parentRule) {
                    setCssText.call(this, value);
                }
            },
        });
    }
}

/**
 * Makes direct camelCase assignment to a stylesheet rule do nothing — the path
 * `writeDeclaration` takes for every key without a hyphen, and the one
 * `setClipPath` uses. Without it the ablation leaves the very writes it is
 * meant to remove in place.
 *
 * @returns How many accessors were wrapped.
 */
function dropRuleAccessorWrites(): number {
    const { host, names } = cssAccessorHost();

    for (const name of names) {
        const desc = Object.getOwnPropertyDescriptor(host, name)!;
        const get = desc.get!;
        const set = desc.set!;

        Object.defineProperty(host, name, {
            configurable: true,
            enumerable: desc.enumerable,
            get,
            set(this: CSSStyleDeclaration, value: string): void {
                if (!this.parentRule) {
                    set.call(this, value);
                }
            },
        });
    }

    return names.length;
}

/**
 * The live CodeMirror `EditorView` instances behind every mounted `CodeEditor`.
 *
 * @param tools - The harness tools, for the component-tree walk.
 * @returns The views.
 */
export function codeMirrorViews(tools: HarnessTools): AnyObj[] {
    const views: AnyObj[] = [];

    for (const c of tools.walkComponents()) {
        if (tools.isA(c, 'CodeEditor')) {
            const view = c._view as AnyObj | null | undefined;

            if (view && typeof view.requestMeasure === 'function') {
                views.push(view);
            }
        }
    }

    return views;
}

/**
 * Exposes a live count on `window` under `name`, read through a getter so the
 * value is current whenever someone looks.
 *
 * @param name - The `window` property name.
 * @param read - Returns the current count.
 */
function exposeCount(name: string, read: () => number): void {
    Object.defineProperty(window as unknown as AnyObj, name, { configurable: true, get: read });
}

/**
 * No-ops `doLayout` on the prototype of the first live layout manager whose
 * class chain includes `name`, so every layout of that class stops laying out.
 *
 * @param tools - The harness tools.
 * @param name - A layout manager class name.
 * @returns A note from no-op'ing its `doLayout`, or saying none was found.
 */
function noopLayoutManagerDoLayout(tools: HarnessTools, name: string): string {
    const lm = tools.findLayoutManager(name);

    return lm ? tools.noopOnOwningProto(lm, 'doLayout') : `no ${name} layout manager`;
}

/** A method as an ablation calls it: any receiver, any arguments. */
type Method = (this: unknown, ...args: unknown[]) => unknown;

/** The prefixes of an ablation's own work counters: a skip, a memo hit or miss, or work a dose adds. */
type OwnCounterPrefix = 'skipped' | 'memo' | 'dose';

/** Calls the method a `withOwnMethod` replacement stands in for, on `self` with `args`. */
type Delegate = (self: unknown, args: unknown[]) => unknown;

/** A `withOwnMethod` replacement: gets the receiver, the arguments, and the method it stands in for. */
type Replacement = (self: unknown, args: unknown[], delegate: Delegate) => unknown;

/** A size or offset `Split` stores: its refill's float arithmetic leaves noise far below a pixel, so equal within this is unchanged. */
const SIZE_EPSILON_PX = 1e-9;

/** A pane rectangle equal within this is unmoved: an interpolated collapse frame lands on the end rectangle to within float noise. */
const RECT_EPSILON_PX = 1e-6;

/**
 * Adds one to ablation `name`'s own work counter `<prefix>.<name>.<what>`.
 * An ablation names its counters after itself so the analyser can tell
 * them from the page's and from another arm's. A `<what>` ending in `Miss`
 * records work the ablation did not remove — a memo's miss, a fall back to
 * the original — which `qa-ab.py` leaves out of `engaged`, so an arm that
 * only missed never reads as engaged.
 *
 * @param tools - The harness tools.
 * @param prefix - `skipped`, `memo` or `dose`.
 * @param name - The ablation's `abl=` name, verbatim.
 * @param what - One camelCase word saying what was skipped, served, added or missed.
 */
function bump(tools: HarnessTools, prefix: OwnCounterPrefix, name: string, what: string): void {
    tools.bumpWork(`${prefix}.${name}.${what}`);
}

/**
 * A reader that caches `compute()`'s result until the current task ends: the
 * first read computes and schedules a microtask that clears the cache, so
 * every read before that microtask runs is served from it.
 *
 * @param compute - Computes the value; runs at most once per task.
 * @param onHit - Called on every read served from the cache, for a memo's hit counter.
 * @returns The reader.
 */
function perTask<T>(compute: () => T, onHit?: () => void): () => T {
    let filled = false;
    let value: T | undefined;

    return function readPerTask(): T {
        if (filled) {
            onHit?.();

            return value as T;
        }

        value = compute();
        filled = true;

        queueMicrotask(() => {
            filled = false;
        });

        return value;
    };
}

/**
 * Runs `body` with `replacement` installed as `obj`'s own `method`, then puts
 * back the own property that was there before, or deletes it when there was
 * none. This is what lets an ablation skip one component's method for the
 * length of one call without touching the counters a panel installed on that
 * component as own properties (`countInstance`): the replacement delegates to
 * them, or skips them, like any other caller.
 *
 * @param obj - The instance.
 * @param method - The method's name.
 * @param replacement - The stand-in; its delegate is the previous own property, or the prototype's method looked up at call time.
 * @param body - The work to run with the stand-in installed.
 * @returns What `body` returns.
 */
function withOwnMethod<T>(obj: AnyObj, method: string, replacement: Replacement, body: () => T): T {
    const previous = Object.getOwnPropertyDescriptor(obj, method);
    const delegate: Delegate = previous
        ? (self, args): unknown => (previous.value as Method).apply(self, args)
        : (self, args): unknown => ((Object.getPrototypeOf(obj) as AnyObj)[method] as Method).apply(self, args);

    Object.defineProperty(obj, method, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: function ownReplacement(this: unknown, ...args: unknown[]): unknown {
            return replacement(this, args, delegate);
        },
    });

    try {
        return body();
    } finally {
        if (previous) {
            Object.defineProperty(obj, method, previous);
        } else {
            delete obj[method];
        }
    }
}

/**
 * `withOwnMethod` over several instances at once, each with its own stand-in.
 *
 * @param objs - The instances.
 * @param method - The method's name.
 * @param replacementFor - Builds each instance's stand-in, before `body` runs.
 * @param body - The work to run with every stand-in installed.
 * @returns What `body` returns.
 */
function withOwnMethodOnEach<T>(objs: AnyObj[], method: string, replacementFor: (obj: AnyObj) => Replacement, body: () => T): T {
    if (objs.length === 0) {
        return body();
    }

    const [first, ...rest] = objs;

    return withOwnMethod(first, method, replacementFor(first), () => withOwnMethodOnEach(rest, method, replacementFor, body));
}

/**
 * The constructor named `name` in `obj`'s prototype chain.
 *
 * @param obj - Any object.
 * @param name - A class name.
 * @returns The class, or `null` when `obj` is no instance of a class of that name.
 */
function chainClass(obj: object, name: string): AnyObj | null {
    for (let p = Object.getPrototypeOf(obj); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
        if ((p.constructor as { name?: string } | undefined)?.name === name) {
            return p.constructor as AnyObj;
        }
    }

    return null;
}

/**
 * A test of whether an object's chain holds a class of one of `names`,
 * answered once per constructor: it runs on paths as hot as every commit.
 *
 * @param names - Class names.
 * @returns The test.
 */
function chainTest(names: string[]): (obj: object) => boolean {
    const answers = new WeakMap<object, boolean>();

    return function holdsClass(obj: object): boolean {
        const ctor = obj.constructor as object;
        let answer = answers.get(ctor);

        if (answer === undefined) {
            answer = names.some((name) => chainClass(obj, name) !== null);
            answers.set(ctor, answer);
        }

        return answer;
    };
}

/**
 * Calls `obj[method](...args)`: a library method reached by name.
 *
 * @param obj - The receiver.
 * @param method - The method's name.
 * @param args - Its arguments.
 * @returns What it returns.
 */
function call<T = unknown>(obj: unknown, method: string, ...args: unknown[]): T {
    return ((obj as AnyObj)[method] as Method).apply(obj, args) as T;
}

/**
 * A component's committed rectangle.
 *
 * @param component - The component.
 * @returns `[x, y, width, height]`.
 */
function rectOf(component: unknown): number[] {
    return [call<number>(component, 'getX'), call<number>(component, 'getY'), call<number>(component, 'getWidth'), call<number>(component, 'getHeight')];
}

/**
 * Whether two lists hold the same values in order, compared with `===`.
 *
 * @param a - One list.
 * @param b - The other.
 * @returns `true` when they are element-wise identical.
 */
function sameValues(a: readonly unknown[], b: readonly unknown[]): boolean {
    return a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * Whether two lists of numbers are equal within `epsilon`.
 *
 * @param a - One list.
 * @param b - The other.
 * @param epsilon - The largest difference still counted as equal.
 * @returns `true` when every pair is within `epsilon`.
 */
function sameWithin(a: readonly number[], b: readonly number[], epsilon: number): boolean {
    return a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) <= epsilon);
}

/**
 * Wraps the real sink's `apply` so `listener` runs after every write to the
 * document element: a theme switch writes its variables there first, before
 * any listener reads them, so a memo of theme-bound reads clears here.
 *
 * @param lib - The library objects.
 * @param listener - Runs after each such write.
 */
function afterRootStyleApply(lib: HarnessLibrary, listener: () => void): void {
    const sink = lib.DOM.sink as AnyObj;
    const apply = sink.apply as Method;
    // Interned once for the document's lifetime, so one lookup serves every apply.
    const root = call(lib.DOM.source, 'getDocumentElement');

    sink.apply = function applyThenNotify(this: unknown, handle: unknown, patch: unknown): unknown {
        const result = apply.call(this, handle, patch);

        if (handle === root) {
            listener();
        }

        return result;
    };
}

/**
 * G12 / F06.3 and its control: a `Split` drag frame whose clamp leaves both
 * panes where they were still lays both out again. `skip` says which of the two
 * arms this is; everything else — the gutter lookup, the pane pair, the
 * per-frame `withOwnMethodOnEach` install and restore, the rectangle snapshot
 * and the compare — is shared, so the control pays it too.
 *
 * With `skip`, the layout of a pane the frame left at its rectangle is skipped:
 * F06.3's proposed fix, a port of `Accordion.layoutSections`'
 * `contentHeight !== oldHeight` gate. `onDrag`'s write of the pair's stored
 * sizes still runs either way, since a frame at offset 0 writes the rendered
 * size back into them.
 *
 * Without `skip` every one of those layouts still runs and is only counted,
 * which is the control: it carries exactly the candidate's patching cost and
 * removes none of its work, so `mean(candidate) − mean(control)` is the gate's
 * own time with the instrument's cost cancelled. W3.0's park cell charged about
 * 3.4 ms to *any* runtime patch on this path — its co-run `split.recalc-gate`
 * arm read +3.52 ms while avoiding no work at all — and that tax is what the
 * control prices.
 *
 * @param tools - The harness tools.
 * @param name - The ablation's `abl=` name, for its counter.
 * @param prefix - `skipped` for the candidate; `dose` for the control, which keeps its count out of `work/u`.
 * @param what - The counter's one-word `<what>`.
 * @param skip - Whether an unmoved pane's layout is skipped, or only counted and then run.
 * @returns A note saying what was patched.
 */
function splitDragGate(tools: HarnessTools, name: string, prefix: OwnCounterPrefix, what: string, skip: boolean): string {
    const split = tools.findLayoutManager('Split');

    if (!split) {
        return 'no Split layout manager';
    }

    const proto = tools.ownerProto(split, 'onDrag')!;
    const onDrag = proto.onDrag as Method;

    proto.onDrag = function (this: AnyObj, container: AnyObj, gutter: unknown, position: number): unknown {
        // The panes exactly as `onDrag` takes them.
        const index = (this._gutters as unknown[]).indexOf(gutter);
        const panes = call<AnyObj[]>(container, 'getLaidOutComponents');
        const drag = (): unknown => onDrag.call(this, container, gutter, position);

        if (index < 0 || !panes[index] || !panes[index + 1]) {
            return drag();
        }

        return withOwnMethodOnEach([panes[index], panes[index + 1]], 'doLayout', (pane) => gateUnmovedLayout(tools, name, prefix, what, skip, pane), drag);
    };

    return `Split.onDrag ${skip ? 'skips' : 'still runs'} the layout of a pane the frame left in place`;
}

/**
 * A `doLayout` stand-in that counts every pass `pane` takes while it still sits
 * at the rectangle it had when the stand-in was built, and skips that pass when
 * `skip`. Without `skip` it counts the same population and runs it anyway,
 * which is what makes the control's `work` verdict read flat.
 *
 * @param tools - The harness tools.
 * @param name - The ablation's name, for its counter.
 * @param prefix - The counter's prefix.
 * @param what - The counter's `<what>`.
 * @param skip - Whether the counted pass is skipped or delegated.
 * @param pane - The pane.
 * @returns The stand-in.
 */
function gateUnmovedLayout(tools: HarnessTools, name: string, prefix: OwnCounterPrefix, what: string, skip: boolean, pane: AnyObj): Replacement {
    const before = rectOf(pane);

    return (self, args, delegate): unknown => {
        if (sameValues(rectOf(self), before)) {
            bump(tools, prefix, name, what);

            if (skip) {
                return self;
            }
        }

        return delegate(self, args);
    };
}

/**
 * G12 / F06.4: `Split.recalculateSizes` runs on every pass. Skips a call
 * whose every input — the space, the panes, their stored sizes, bounds and
 * weights — equals the previous call's, when that call left every stored
 * size where it was: it would write the sizes it already holds. The second
 * condition keeps a pane the refill is still re-clamping from one pass to the
 * next from freezing part-way.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function splitRecalcGate(tools: HarnessTools): string {
    const name = 'split.recalc-gate';
    const split = tools.findLayoutManager('Split');

    if (!split) {
        return 'no Split layout manager';
    }

    const proto = tools.ownerProto(split, 'recalculateSizes')!;
    const recalculate = proto.recalculateSizes as Method;
    const lastCall = new WeakMap<object, { signature: unknown[]; stable: boolean }>();

    proto.recalculateSizes = function (this: AnyObj): unknown {
        const signature = recalculationSignature(this);

        if (signature === null) {
            return recalculate.call(this);
        }

        const last = lastCall.get(this);

        if (last?.stable && sameValues(last.signature, signature)) {
            bump(tools, 'skipped', name, 'recalc');

            return undefined;
        }

        const before = new Map(this._sizes as Map<unknown, number>);
        const result = recalculate.call(this);

        lastCall.set(this, { signature, stable: sameSizes(before, this._sizes as Map<unknown, number>) });

        return result;
    };

    return 'Split.recalculateSizes skips a call whose inputs and last result are unchanged';
}

/**
 * Everything `recalculateSizes` reads besides its (absent) arguments: the
 * orientation, the container's inner size, the last available extent and the
 * pane count; then, per pane in order, the pane itself, its stored size, the
 * main-axis extent of its minimum and maximum, its resize weight, its
 * `weight` constraint, and whether its content is out.
 *
 * @param split - The `Split` layout manager.
 * @returns The signature, or `null` when the manager has no container.
 */
function recalculationSignature(split: AnyObj): unknown[] | null {
    const container = call<AnyObj | null>(split, 'getContainer');

    if (!container) {
        return null;
    }

    const inner = call<{ width: number; height: number } | null>(container, 'getInnerSize');
    const panes = call<AnyObj[]>(container, 'getComponents');
    const horizontal = split._orientation === 'horizontal';
    const signature: unknown[] = [split._orientation, inner?.width ?? null, inner?.height ?? null, split._lastAvailableMain, panes.length];

    for (const pane of panes) {
        signature.push(...paneSignature(split, pane, horizontal));
    }

    return signature;
}

/**
 * One pane's part of `recalculationSignature`.
 *
 * @param split - The `Split` layout manager.
 * @param pane - The pane.
 * @param horizontal - Whether the main axis is the width.
 * @returns The pane's inputs, in a fixed order.
 */
function paneSignature(split: AnyObj, pane: AnyObj, horizontal: boolean): unknown[] {
    const main = (size: { width: number; height: number } | null): number | null => (size ? (horizontal ? size.width : size.height) : null);
    const constraints = call<{ weight?: number } | null | undefined>(split, 'getLayoutConstraints', pane);

    return [
        pane,
        (split._sizes as Map<unknown, number>).get(pane),
        main(call(split, 'paneMinSize', pane)),
        main(call(split, 'paneMaxSize', pane)),
        (split._weights as Map<unknown, number>).get(pane),
        constraints?.weight,
        (split._undisplayedPaneContent as Map<unknown, unknown>).has(pane),
    ];
}

/**
 * Whether a `Split`'s stored sizes are what they were.
 *
 * @param before - A copy taken before the call.
 * @param after - The live map after it.
 * @returns `true` when the same panes hold sizes each within `SIZE_EPSILON_PX` of before.
 */
function sameSizes(before: Map<unknown, number>, after: Map<unknown, number>): boolean {
    if (before.size !== after.size) {
        return false;
    }

    for (const [pane, size] of after) {
        const was = before.get(pane);

        if (was === undefined || Math.abs(was - size) > SIZE_EPSILON_PX) {
            return false;
        }
    }

    return true;
}

/**
 * CodeMirror's Resize/Intersection observers disconnected for every editor,
 * so a size change no longer schedules its measure.
 *
 * @param tools - The harness tools.
 * @returns A note saying how many observers were disconnected.
 */
function disconnectCodeMirrorObservers(tools: HarnessTools): string {
    const views = codeMirrorViews(tools);
    let disconnected = 0;

    for (const view of views) {
        const observer = view.observer as AnyObj | undefined;

        for (const key of Object.keys(observer ?? {})) {
            const value = (observer as AnyObj)[key];

            if (value instanceof ResizeObserver || value instanceof IntersectionObserver) {
                value.disconnect();
                disconnected++;
            }
        }
    }

    return `disconnected ${disconnected} CodeMirror observers across ${views.length} views`;
}

/**
 * Ceiling for extending the seam's same-value filter to attribute writes:
 * every `setAttribute` whose value already matches is skipped. Unlike a
 * stylesheet-rule write this does not force a *document* restyle, so the
 * count does not predict the cost — hence measuring before planning.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function dropSameAttributeWrites(tools: HarnessTools): string {
    const proto = Element.prototype;
    const setAttribute = proto.setAttribute;
    let skipped = 0;

    proto.setAttribute = function (this: Element, name: string, value: string): void {
        if (this.getAttribute(name) === value) {
            skipped++;
            tools.bumpWrite(`skipattr@${name}`);

            return;
        }

        setAttribute.call(this, name, value);
    };

    exposeCount('__sameAttrSkipped', () => skipped);

    return 'same-value attribute writes dropped';
}

/**
 * Upper bound for a same-value filter in `DOM.writeDeclaration`: every direct
 * camelCase style write whose value already matches is skipped, and each skip
 * is attributed, so the ablation says *what* it dropped as well as how much it
 * saved. The library's own same-value writes are already removed by the
 * `writeDeclaration` filter, so whatever shows up here on a filtered build
 * comes from somewhere else — CodeMirror, or a path that bypasses the seam.
 *
 * @param tools - The harness tools.
 * @returns A note saying how many accessors were wrapped.
 */
function dropSameStyleWrites(tools: HarnessTools): string {
    const { host, names } = cssAccessorHost();

    if (names.length === 0) {
        return 'no CSS accessors found';
    }

    let skipped = 0;

    for (const name of names) {
        const desc = Object.getOwnPropertyDescriptor(host, name)!;
        const get = desc.get!;
        const set = desc.set!;

        Object.defineProperty(host, name, {
            configurable: true,
            enumerable: desc.enumerable,
            get,
            set(this: CSSStyleDeclaration, value: string): void {
                if (get.call(this) === value) {
                    skipped++;
                    tools.bumpWrite(`skip@${name}`);
                    tools.bumpWrite(this.parentRule ? 'skip.rule' : 'skip.inline');

                    return;
                }

                set.call(this, value);
            },
        });
    }

    exposeCount('__sameWritesSkipped', () => skipped);

    return `same-value style writes dropped (${names.length} accessors wrapped)`;
}

/**
 * The VirtualScroller stops updating scrollbar metrics per frame: finds the
 * first `Tree`'s scroller field and no-ops its `layoutScrollbars`.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function noopScrollerLayoutScrollbars(tools: HarnessTools): string {
    const tree = tools.findComponent('Tree');

    if (!tree) {
        return 'no Tree instance';
    }

    for (const key of Object.keys(tree)) {
        const v = tree[key] as AnyObj;

        if (v && typeof v === 'object' && typeof v.layoutScrollbars === 'function') {
            return tools.noopOnOwningProto(v, 'layoutScrollbars');
        }
    }

    return 'no scroller field on Tree';
}

/**
 * G12 / F06.9: a pane collapse re-lays out every pane on every animation
 * frame, even the toggled one, which holds its final rectangle and only
 * clip-reveals. For the length of a collapse, each laid-out pane's layout
 * runs only when its rectangle moved since the last layout that ran; the
 * first call, `runCollapse`'s end layout, always runs, since an expand needs
 * it. The animation helpers are module functions the page cannot patch, so
 * the gate sits on each pane.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function g12CollapseStatic(tools: HarnessTools): string {
    const name = 'g12.collapse-static';
    const split = tools.findLayoutManager('Split');

    if (!split) {
        return 'no Split layout manager';
    }

    const proto = tools.ownerProto(split, 'setPaneCollapsed')!;
    const setPaneCollapsed = proto.setPaneCollapsed as Method;
    const guards = new WeakMap<object, () => void>();

    proto.setPaneCollapsed = function (this: AnyObj, index: number, collapsed: boolean): unknown {
        const container = call<AnyObj | null>(this, 'getContainer');
        const panes = container ? call<AnyObj[]>(container, 'getLaidOutComponents') : [];

        for (const pane of panes) {
            if (!guards.has(pane)) {
                guards.set(pane, guardStaticRelayout(tools, name, this, pane, () => guards.delete(pane)));
            }
        }

        const result = setPaneCollapsed.call(this, index, collapsed);

        // No collapse started (an unchanged state, no serving gutter), or it
        // ran to its end at once under reduced motion: nothing to gate.
        if (this._collapsing !== true) {
            for (const pane of panes) {
                guards.get(pane)?.();
            }
        }

        return result;
    };

    return 'Split collapse skips a pane layout at an unmoved rectangle';
}

/**
 * Gives `pane` an own `doLayout` that, while `split` is collapsing, skips a
 * call at the rectangle the last call that ran was made at. Unlike
 * `withOwnMethod`, it outlives the call that installs it: it removes itself —
 * putting back the own property that was there, or none — on the first call
 * made once the collapse has ended.
 *
 * @param tools - The harness tools.
 * @param name - The ablation's name, for its counter.
 * @param split - The `Split` layout manager.
 * @param pane - The pane.
 * @param onRemoved - Called once the guard has removed itself.
 * @returns Removes the guard at once.
 */
function guardStaticRelayout(tools: HarnessTools, name: string, split: AnyObj, pane: AnyObj, onRemoved: () => void): () => void {
    const previous = Object.getOwnPropertyDescriptor(pane, 'doLayout');
    let last: number[] | null = null;

    const remove = (): void => {
        if (previous) {
            Object.defineProperty(pane, 'doLayout', previous);
        } else {
            delete pane.doLayout;
        }

        onRemoved();
    };

    Object.defineProperty(pane, 'doLayout', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: function collapseGuardedLayout(this: AnyObj, ...args: unknown[]): unknown {
            if (split._collapsing !== true) {
                remove();

                return (pane.doLayout as Method).apply(this, args);
            }

            const rect = rectOf(this);

            if (last !== null && sameWithin(rect, last, RECT_EPSILON_PX)) {
                bump(tools, 'skipped', name, 'staticRelayout');

                return this;
            }

            last = rect;

            return ((previous?.value ?? (Object.getPrototypeOf(pane) as AnyObj).doLayout) as Method).apply(this, args);
        },
    });

    return remove;
}

/**
 * G05: `LayoutManager.resolveBounds` reads the child's preferred, current,
 * minimum and maximum size before looking at its fill, and a both-axes fill
 * discards all four. Serves that placement without them — exactly the
 * rectangle the both-fill branch returns.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function g05LazyReads(tools: HarnessTools): string {
    const name = 'g05.lazy-reads';
    const lm = tools.findLayoutManager('LayoutManager');

    if (!lm) {
        return 'no layout manager';
    }

    const proto = tools.ownerProto(lm, 'resolveBounds')!;
    const resolveBounds = proto.resolveBounds as Method;

    proto.resolveBounds = function (this: AnyObj, component: unknown, x: number, y: number, maxWidth: number, maxHeight: number, fill?: unknown, anchor?: unknown): unknown {
        // The original's precedence: the child's own constraint wins over the argument.
        const constraints = call<{ fill?: unknown } | null | undefined>(this, 'getLayoutConstraints', component);
        const effective = constraints?.fill || fill || 'none';

        if (effective === 'both') {
            bump(tools, 'skipped', name, 'resolve');

            return { x, y, width: maxWidth, height: maxHeight };
        }

        return resolveBounds.call(this, component, x, y, maxWidth, maxHeight, fill, anchor);
    };

    return 'LayoutManager.resolveBounds serves a both-axes fill without its size reads';
}

/**
 * G08: environment reads repeated within one task. The viewport size is
 * read once per task, each theme variable once until the document element's
 * style is next written, and the static minimized-window stack is laid out
 * at most once per task.
 *
 * @param tools - The harness tools.
 * @param lib - The library objects: the DOM seam, and `AbstractWindow`.
 * @returns A note saying what was patched.
 */
function g08EnvReads(tools: HarnessTools, lib: HarnessLibrary): string {
    const name = 'g08.env-reads';
    const source = lib.DOM.source as AnyObj;
    const getViewportSize = source.getViewportSize as Method;
    const getThemeVar = source.getThemeVar as Method;
    const themeVars = new Map<string, unknown>();

    const readViewport = perTask(() => {
        bump(tools, 'memo', name, 'viewportMiss');

        return getViewportSize.call(source);
    }, () => bump(tools, 'memo', name, 'viewportHit'));

    source.getViewportSize = function memoisedViewportSize(): unknown {
        return readViewport();
    };

    source.getThemeVar = function memoisedThemeVar(this: unknown, varName: string): unknown {
        if (themeVars.has(varName)) {
            bump(tools, 'memo', name, 'themeVarHit');

            return themeVars.get(varName);
        }

        bump(tools, 'memo', name, 'themeVarMiss');

        const value = getThemeVar.call(this, varName);

        themeVars.set(varName, value);

        return value;
    };

    afterRootStyleApply(lib, () => themeVars.clear());

    return `viewport per task, theme variables until the root style changes${onceMinimizedStackPerTask(tools, name, lib)}`;
}

/**
 * G08's third part: `AbstractWindow.relayoutMinimizedStack` runs at most
 * once per task, so a viewport resize no longer re-lays out the whole stack
 * once per minimized window.
 *
 * @param tools - The harness tools.
 * @param name - The ablation's name, for its counter.
 * @param lib - The library objects.
 * @returns The note's tail: the part installed, or `; no AbstractWindow`.
 */
function onceMinimizedStackPerTask(tools: HarnessTools, name: string, lib: HarnessLibrary): string {
    const windows = lib.AbstractWindow as AnyObj | undefined;

    if (!windows || typeof windows.relayoutMinimizedStack !== 'function') {
        return '; no AbstractWindow';
    }

    const relayout = windows.relayoutMinimizedStack as Method;

    const relayoutOnce = perTask(() => {
        relayout.call(windows);

        return undefined;
    }, () => bump(tools, 'skipped', name, 'minStack'));

    windows.relayoutMinimizedStack = function relayoutMinimizedStackOnce(): void {
        relayoutOnce();
    };

    return ', minimized stack once per task';
}

/**
 * G09: more components opted into the unchanged-commit skip. Both scopes
 * replace the *base* gate, so each reaches only the classes that inherit it —
 * a class shipping its own override shadows the patch and is unaffected,
 * which is what keeps a skip the shipped build already gets out of the count.
 * `all` therefore measures the headroom left over the shipped opt-ins rather
 * than an absolute ceiling, and that headroom shrinks every time a class opts
 * in for real: since `unchanged-commit-opt-ins` it excludes `Panel` and every
 * subclass of it (`ScrollStrip`, `Form`, `AbstractChart`, `DiagramView`,
 * `MarkdownViewer`, `FloatingPanel`, …), `LabeledGrid`, `Header`,
 * `WindowHeader` and `StatusBar` as well as stage 1's `MenuBar`, `ToolBar`
 * and the table's cells. `chrome` names `Header` and `StatusBar`, and both
 * now ship the override, so it grants no skip on any scene and is kept only
 * as the narrow arm's historical reading. A skip is counted where the base
 * gate says yes inside a layout pass and the answer is the ablation's.
 *
 * @param tools - The harness tools.
 * @param name - `g09.all` or `g09.chrome`.
 * @param scope - Which components are opted in.
 * @returns A note saying what was patched.
 */
function g09SkipUnchanged(tools: HarnessTools, name: string, scope: 'all' | 'chrome'): string {
    const any = tools.walkComponents()[0];

    if (!any) {
        return 'no component';
    }

    const layoutProto = tools.rootOwnerProto(any, 'canSkipUnchangedLayout')!;
    const commitProto = tools.rootOwnerProto(any, 'canSkipUnchangedCommit')!;
    const component = tools.rootOwnerProto(any, 'doLayout')!.constructor as unknown as { currentLayoutPass(): number };
    const canSkipLayout = layoutProto.canSkipUnchangedLayout as Method;
    const canSkipCommit = commitProto.canSkipUnchangedCommit as Method;
    const isChrome = chainTest(['Header', 'StatusBar']);

    const optedIn = scope === 'all'
        ? function canSkipAll(): boolean {
            return true;
        }
        : function canSkipChrome(this: object): boolean {
            return isChrome(this) || (canSkipLayout.call(this) as boolean);
        };

    layoutProto.canSkipUnchangedLayout = optedIn;

    commitProto.canSkipUnchangedCommit = function countedCanSkipCommit(this: AnyObj): boolean {
        const skip = canSkipCommit.call(this) as boolean;

        if (skip && this.canSkipUnchangedLayout === optedIn && component.currentLayoutPass() !== 0) {
            bump(tools, 'skipped', name, 'commit');
        }

        return skip;
    };

    return scope === 'all'
        ? 'every component without a shipped opt-in skips an unchanged commit'
        : 'Header and StatusBar skip an unchanged commit (both ship it: no effect)';
}

/**
 * G11's residue after the size-hint memo: work a layout pass still does to
 * gather. A content frame is reserved only when the container overflows; a
 * fully displayed child list is shared rather than copied; and a grid with
 * no tracks and no baseline alignment, whose every track resolves as a weight
 * and never reads content, skips measuring it.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function g11GatherResidue(tools: HarnessTools): string {
    const name = 'g11.gather-residue';
    const lm = tools.findLayoutManager('LayoutManager');
    const any = tools.walkComponents()[0];

    if (!lm || !any) {
        return 'no layout manager';
    }

    const frameProto = tools.rootOwnerProto(lm, 'reserveContentFrame')!;
    const reserveContentFrame = frameProto.reserveContentFrame as Method;
    const listProto = tools.rootOwnerProto(any, 'getLaidOutComponents')!;
    const getLaidOutComponents = listProto.getLaidOutComponents as Method;

    frameProto.reserveContentFrame = function (this: AnyObj): unknown {
        const container = call<AnyObj | null>(this, 'getContainer');

        if (container && !call<boolean>(this, 'isOverflowingX') && !call<boolean>(this, 'isOverflowingY')) {
            call(container, 'clearContentFrame');
            bump(tools, 'skipped', name, 'reserve');

            return this;
        }

        return reserveContentFrame.call(this);
    };

    listProto.getLaidOutComponents = function (this: AnyObj): unknown {
        const children = this._components as AnyObj[];

        if (children.every((child) => call<boolean>(child, 'isDisplayed'))) {
            bump(tools, 'memo', name, 'laidOutShared');

            return children;
        }

        return getLaidOutComponents.call(this);
    };

    return `content frame, laid-out list${skipTracklessGridMeasure(tools, name)}`;
}

/**
 * G11's grid part: `Grid.measureContent` returns zeros for a grid with no
 * column or row tracks and no baseline alignment, which never reads them.
 * `LabeledGrid` declares tracks, so it never takes the shortcut.
 *
 * @param tools - The harness tools.
 * @param name - The ablation's name, for its counter.
 * @returns The note's tail: the part installed, or `; no Grid layout manager`.
 */
function skipTracklessGridMeasure(tools: HarnessTools, name: string): string {
    const grid = tools.findLayoutManager('Grid');

    if (!grid) {
        return '; no Grid layout manager';
    }

    const proto = tools.ownerProto(grid, 'measureContent')!;
    const measureContent = proto.measureContent as Method;

    proto.measureContent = function (this: AnyObj, components: unknown, cols: number, rows: number): unknown {
        if ((this._columnTracks as unknown[]).length === 0 && (this._rowTracks as unknown[]).length === 0 && !this._baselineAlign) {
            bump(tools, 'skipped', name, 'measureContent');

            return { columns: new Array(cols).fill(0), rows: new Array(rows).fill(0) };
        }

        return measureContent.call(this, components, cols, rows);
    };

    return ', track-less grid measure';
}

/**
 * G14: a full accordion pass reflows every section, and asks a closed one
 * for its preferred height, though a settled closed section — not animating,
 * and no toggle in flight — is clipped out of sight at a height its content
 * does not change. On such a pass the section's height is served from a
 * cache filled on first use, and its layout is skipped.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function g14ClosedSection(tools: HarnessTools): string {
    const name = 'g14.closed-section';
    const accordion = tools.findLayoutManager('Accordion');

    if (!accordion) {
        return 'no Accordion layout manager';
    }

    const proto = tools.ownerProto(accordion, 'layoutSections')!;
    const layoutSections = proto.layoutSections as Method;
    const closedHeights = new WeakMap<object, number>();

    const skipReflow: Replacement = (self) => {
        bump(tools, 'skipped', name, 'closedReflow');

        return self;
    };

    proto.layoutSections = function (this: AnyObj, components: AnyObj[], containerWidth: unknown, left: unknown, top: unknown, resizable: unknown, contentHeightFor: SectionHeight, animateShrink: unknown, reflowAll: unknown): unknown {
        if (reflowAll !== true) {
            return layoutSections.call(this, components, containerWidth, left, top, resizable, contentHeightFor, animateShrink, reflowAll);
        }

        const settled = components.map((component, i) => isSettledClosed(this, component, i));
        const heightFor = closedHeightServer(tools, name, closedHeights, components, settled, contentHeightFor);
        const layOut = (): unknown => layoutSections.call(this, components, containerWidth, left, top, resizable, heightFor, animateShrink, reflowAll);

        return withOwnMethodOnEach(components.filter((_, i) => settled[i]), 'doLayout', () => skipReflow, layOut);
    };

    return 'Accordion full pass skips a settled closed section';
}

/** `Accordion.layoutSections`' content-height callback: section `i`'s height, open or closed. */
type SectionHeight = (i: number, isOpen: boolean) => number;

/**
 * Wraps a pass's content-height callback so a settled closed section's
 * height is served from `cache`, filled on its first use; any other section
 * drops its entry and is asked as before.
 *
 * @param tools - The harness tools.
 * @param name - The ablation's name, for its counter.
 * @param cache - Section content → its cached height.
 * @param components - The sections' contents, in order.
 * @param settled - Whether each section is settled closed this pass.
 * @param contentHeightFor - The pass's own callback.
 * @returns The wrapped callback.
 */
function closedHeightServer(tools: HarnessTools, name: string, cache: WeakMap<object, number>, components: AnyObj[], settled: boolean[], contentHeightFor: SectionHeight): SectionHeight {
    return function servedHeight(i: number, isOpen: boolean): number {
        const component = components[i];

        if (!settled[i]) {
            cache.delete(component);

            return contentHeightFor(i, isOpen);
        }

        const cached = cache.get(component);

        if (cached !== undefined) {
            bump(tools, 'skipped', name, 'closedPreferred');

            return cached;
        }

        const height = contentHeightFor(i, isOpen);

        cache.set(component, height);

        return height;
    };
}

/**
 * Whether section `i` is displayed, closed, not animating, and no toggle is in flight.
 *
 * @param accordion - The `Accordion` layout manager.
 * @param component - The section's content.
 * @param i - The section's index.
 * @returns `true` for a settled closed section.
 */
function isSettledClosed(accordion: AnyObj, component: AnyObj, i: number): boolean {
    return call<boolean>(component, 'isDisplayed')
        && !(accordion._openState as boolean[])[i]
        && !(accordion._wrapperAnimations as Map<number, unknown>).has(i)
        && !(accordion._shrinkAnimations as Map<number, unknown>).has(i)
        && accordion._toggleAnimations === 0;
}

/**
 * G16, the settled pass: a scrolling `Panel` re-measures its scroll metrics
 * on every layout pass. Skips the re-measure while the panel's size, child
 * count and recorded content extent equal its last full run's. Only for
 * `passes`: a scroll moves the shadows without changing any of those. A panel
 * whose re-measure returns at once — not scrolling, not effectively visible,
 * or without an element — is passed through uncounted: skipping it would save
 * nothing.
 *
 * Every term is a value the panel has already cached, so the gate calls no
 * size hint: `_lastContentExtent` is the content extent the panel's own
 * `scheduleGutterSettleOnShrink` records at the end of the same `doLayout`
 * that ran the re-measure, so the value compared here is the previous pass's
 * — the "nothing has changed since last time" test the gate wants, without
 * the subtree size computation `getPreferredSize` would cost once per pane
 * per pass. That record is only refreshed while the panel shows a scroll
 * affordance; for a panel that shows none it holds still, and the gate falls
 * back to size and child count.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function g16PanelSettled(tools: HarnessTools): string {
    const name = 'g16.panel-settled';
    const panel = tools.findComponent('Panel');

    if (!panel) {
        return 'no Panel';
    }

    const proto = tools.ownerProto(panel, 'remeasureScrollMetrics')!;
    const remeasure = proto.remeasureScrollMetrics as Method;
    const lastRun = new WeakMap<object, unknown[]>();

    proto.remeasureScrollMetrics = function (this: AnyObj): unknown {
        if (!remeasures(this)) {
            return remeasure.call(this);
        }

        const extent = this._lastContentExtent as { width: number; height: number };

        const signature = [
            call(this, 'getWidth'),
            call(this, 'getHeight'),
            call<unknown[]>(this, 'getComponents').length,
            extent.width,
            extent.height,
        ];

        const last = lastRun.get(this);

        if (last && sameValues(last, signature)) {
            bump(tools, 'skipped', name, 'remeasure');

            return undefined;
        }

        const result = remeasure.call(this);

        lastRun.set(this, signature);

        return result;
    };

    return 'Panel skips a settled scroll-metrics re-measure';
}

/**
 * Whether a panel's `remeasureScrollMetrics` would do any work: its own
 * guards return at once for a panel that does not scroll, is not effectively
 * visible, or has no element yet.
 *
 * @param panel - The panel.
 * @returns `true` when the re-measure would run.
 */
function remeasures(panel: AnyObj): boolean {
    return panel._autoScroll !== 'none' && call<boolean>(panel, 'isEffectivelyVisible') && Boolean(call(panel, 'getElement'));
}

/**
 * G16, the scroll path: reads a scroll repeats within one task. The shadow
 * overlay is re-sized only when the panel's size or reserved gutter changed;
 * scroll metrics read inside the overlay-scrollbar sync and the shadow update
 * are served once per element per task; and the maximum scroll offsets once
 * per component per task.
 *
 * @param tools - The harness tools.
 * @param lib - The library objects: the DOM seam.
 * @returns A note saying what was patched.
 */
function g16ScrollReads(tools: HarnessTools, lib: HarnessLibrary): string {
    const name = 'g16.scroll-reads';
    const panel = tools.findComponent('Panel');
    const any = tools.walkComponents()[0];

    if (!panel || !any) {
        return 'no Panel';
    }

    skipUnchangedShadowResize(tools, name, tools.ownerProto(panel, 'resizeScrollShadowOverlay')!);
    memoiseScrollPathMetrics(tools, name, tools.ownerProto(panel, 'updateScrollShadows')!, lib);

    for (const method of ['getMaxScrollLeft', 'getMaxScrollTop']) {
        memoiseMaxScroll(tools.rootOwnerProto(any, method)!, method, () => bump(tools, 'memo', name, 'maxScrollHit'));
    }

    return 'shadow resize, scroll-path metrics and max scroll served once per change or task';
}

/**
 * Skips `resizeScrollShadowOverlay` while a panel's width, height and
 * reserved scrollbar gutter equal the last call's.
 *
 * @param tools - The harness tools.
 * @param name - The ablation's name, for its counter.
 * @param proto - `Panel.prototype`.
 */
function skipUnchangedShadowResize(tools: HarnessTools, name: string, proto: AnyObj): void {
    const resize = proto.resizeScrollShadowOverlay as Method;
    const lastCall = new WeakMap<object, unknown[]>();

    proto.resizeScrollShadowOverlay = function (this: AnyObj, ...args: unknown[]): unknown {
        const gutter = this._scrollbarGutter as { right: number; bottom: number };
        const signature = [call(this, 'getWidth'), call(this, 'getHeight'), gutter.right, gutter.bottom];
        const last = lastCall.get(this);

        lastCall.set(this, signature);

        if (last && sameValues(last, signature)) {
            bump(tools, 'skipped', name, 'shadowResize');

            return undefined;
        }

        return resize.apply(this, args);
    };
}

/**
 * Serves `getScrollMetrics` from a per-element, per-task memo while a
 * panel's `syncOverlayScrollbars` or `updateScrollShadows` runs; every other
 * read passes through.
 *
 * @param tools - The harness tools.
 * @param name - The ablation's name, for its counter.
 * @param proto - `Panel.prototype`.
 * @param lib - The library objects: the DOM seam.
 */
function memoiseScrollPathMetrics(tools: HarnessTools, name: string, proto: AnyObj, lib: HarnessLibrary): void {
    const source = lib.DOM.source as AnyObj;
    const getScrollMetrics = source.getScrollMetrics as Method;
    const reads = new Map<unknown, () => unknown>();
    let depth = 0;

    for (const method of ['syncOverlayScrollbars', 'updateScrollShadows']) {
        const original = proto[method] as Method;

        proto[method] = function (this: unknown, ...args: unknown[]): unknown {
            depth++;

            try {
                return original.apply(this, args);
            } finally {
                depth--;
            }
        };
    }

    source.getScrollMetrics = function scrollPathMetrics(this: unknown, handle: unknown): unknown {
        if (depth === 0) {
            return getScrollMetrics.call(this, handle);
        }

        let read = reads.get(handle);

        if (!read) {
            read = perTask(() => getScrollMetrics.call(source, handle), () => bump(tools, 'memo', name, 'metricsHit'));
            reads.set(handle, read);
        }

        return read();
    };
}

/**
 * Serves a maximum scroll offset from a per-component, per-task memo of the
 * original. A component with no scroll element is passed through
 * uncounted: its offset is 0 without any read, so there is nothing to serve.
 *
 * @param proto - `Component.prototype`, which owns the method.
 * @param method - `getMaxScrollLeft` or `getMaxScrollTop`.
 * @param onHit - Called on each read served from the memo.
 */
function memoiseMaxScroll(proto: AnyObj, method: string, onHit: () => void): void {
    const original = proto[method] as Method;
    const reads = new WeakMap<object, () => unknown>();

    proto[method] = function (this: object): unknown {
        if (!call(this, 'getScrollElement')) {
            return original.call(this);
        }

        let read = reads.get(this);

        if (!read) {
            read = perTask(() => original.call(this), onHit);
            reads.set(this, read);
        }

        return read();
    };
}

/**
 * G18, repeated measurement: the same text under the same font is measured
 * again and again. `measureText`, `measureTexts` and `measureTextWidths` are
 * served from a memo keyed on the text and every option, `maxWidth`
 * included, which clears when the document element's style is written — a
 * theme switch — and when a web font finishes loading.
 *
 * @param tools - The harness tools.
 * @param lib - The library objects: the DOM seam.
 * @returns A note saying what was patched.
 */
function g18MeasureMemo(tools: HarnessTools, lib: HarnessLibrary): string {
    const name = 'g18.measure-memo';
    const source = lib.DOM.source as AnyObj;
    const metrics = new Map<string, unknown>();
    const widths = new Map<string, unknown>();

    const count = (served: boolean): void => bump(tools, 'memo', name, served ? 'callHit' : 'callMiss');

    const clearMeasureMemo = function clearMeasureMemo(): void {
        metrics.clear();
        widths.clear();
    };

    memoiseMeasureText(source, metrics, count);
    memoiseMeasureTexts(source, metrics, count);
    memoiseMeasureTextWidths(source, widths, count);
    afterRootStyleApply(lib, clearMeasureMemo);
    (document as { fonts?: EventTarget }).fonts?.addEventListener('loadingdone', clearMeasureMemo);

    return 'measureText, measureTexts and measureTextWidths memoised until the theme or fonts change';
}

/**
 * The memo key for one measurement: the text and every option.
 *
 * @param text - The text.
 * @param options - The measurement's options.
 * @returns The key.
 */
function measureKey(text: string, options: unknown): string {
    return text + '\u0000' + JSON.stringify(options ?? {});
}

/**
 * Serves `source.measureText` from `memo`.
 *
 * @param source - The real DOM source.
 * @param memo - Key → metrics, shared with `measureTexts`.
 * @param count - Tallies a call as served or not.
 */
function memoiseMeasureText(source: AnyObj, memo: Map<string, unknown>, count: (served: boolean) => void): void {
    const measureText = source.measureText as Method;

    source.measureText = function memoisedMeasureText(this: unknown, text: string, options?: unknown): unknown {
        const key = measureKey(text, options);

        if (memo.has(key)) {
            count(true);

            return memo.get(key);
        }

        count(false);

        const measured = measureText.call(this, text, options);

        memo.set(key, measured);

        return measured;
    };
}

/**
 * Serves each request of `source.measureTexts` from `memo`, sending only the
 * misses to the original, in one call.
 *
 * @param source - The real DOM source.
 * @param memo - Key → metrics, shared with `measureText`.
 * @param count - Tallies a call as served entirely from the memo, or not.
 */
function memoiseMeasureTexts(source: AnyObj, memo: Map<string, unknown>, count: (served: boolean) => void): void {
    const measureTexts = source.measureTexts as Method;

    source.measureTexts = function memoisedMeasureTexts(this: unknown, requests: Array<{ text: string; options?: unknown }>): unknown {
        const keys = requests.map((request) => measureKey(request.text, request.options));
        const misses = requests.filter((_, i) => !memo.has(keys[i]));

        count(requests.length > 0 && misses.length === 0);

        if (misses.length > 0 || requests.length === 0) {
            const measured = measureTexts.call(this, misses) as unknown[];

            misses.forEach((request, i) => memo.set(measureKey(request.text, request.options), measured[i]));
        }

        return keys.map((key) => memo.get(key));
    };
}

/**
 * Serves each width of `source.measureTextWidths` from `memo`, sending only
 * the misses to the original, in one call.
 *
 * @param source - The real DOM source.
 * @param memo - Key → width.
 * @param count - Tallies a call as served entirely from the memo, or not.
 */
function memoiseMeasureTextWidths(source: AnyObj, memo: Map<string, unknown>, count: (served: boolean) => void): void {
    const measureTextWidths = source.measureTextWidths as Method;

    source.measureTextWidths = function memoisedMeasureTextWidths(this: unknown, texts: string[], options?: unknown): unknown {
        const keys = texts.map((text) => measureKey(text, options));
        const misses = texts.filter((_, i) => !memo.has(keys[i]));

        count(texts.length > 0 && misses.length === 0);

        if (misses.length > 0 || texts.length === 0) {
            const measured = measureTextWidths.call(this, misses, options) as unknown[];

            misses.forEach((text, i) => memo.set(measureKey(text, options), measured[i]));
        }

        return keys.map((key) => memo.get(key));
    };
}

/** `measureText`'s font options, with the defaults `DOM.source.measureText` applies. */
interface FontOptions {
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    fontStyle: string;
    fontVariant: string;
    fontStretch: string;
    lineHeight: string;
}

/**
 * `measureText`'s font options with its defaults filled in: the same values
 * `ProductionDOMSource.measureText` destructures with.
 *
 * @param options - The options as passed.
 * @returns The seven font options.
 */
function withMeasureDefaults(options: Partial<FontOptions>): FontOptions {
    return {
        fontFamily: options.fontFamily ?? 'var(--ts-ui-font-family, system-ui, sans-serif)',
        fontSize: options.fontSize ?? 'var(--ts-ui-font-size, 14px)',
        fontWeight: options.fontWeight ?? 'normal',
        fontStyle: options.fontStyle ?? 'normal',
        fontVariant: options.fontVariant ?? 'normal',
        fontStretch: options.fontStretch ?? 'normal',
        lineHeight: options.lineHeight ?? 'calc(1em + var(--ts-ui-line-padding, 2px))',
    };
}

/** A `var(--name)` or `var(--name, fallback)` with a fallback free of parentheses. */
const CSS_VAR = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*?))?\s*\)/g;

/**
 * Replaces each `var(--name, fallback)` in `value` with the theme variable's
 * value, or the fallback when the variable is empty.
 *
 * @param value - A CSS value.
 * @param lib - The library objects: the live DOM source, so the reads count as the page's.
 * @returns The value with its variables resolved; a nested or unresolvable one stays `var(`.
 */
function resolveThemeVars(value: string, lib: HarnessLibrary): string {
    return value.replace(CSS_VAR, (_match: string, varName: string, fallback?: string) => call<string>(lib.DOM.source, 'getThemeVar', varName) || (fallback ?? ''));
}

/**
 * G18, measurement without reflow: `measureText` measures through a hidden
 * DOM probe, forcing a document layout per call. Measures the width on a
 * canvas instead, under the same font, and takes the height and baseline from
 * the first DOM measurement of that font. A wrap width, or a family or size
 * that still holds a `var(` or `calc(` once the theme variables are resolved,
 * goes to the original.
 *
 * @param tools - The harness tools.
 * @param lib - The library objects: the DOM seam.
 * @returns A note saying what was patched.
 */
function g18CanvasWidth(tools: HarnessTools, lib: HarnessLibrary): string {
    const name = 'g18.canvas-width';
    const ctx = document.createElement('canvas').getContext('2d');

    if (!ctx) {
        return 'no canvas 2D context';
    }

    const source = lib.DOM.source as AnyObj;
    const measureText = source.measureText as Method;
    const fontMetrics = new Map<string, { height: number; baseline: number }>();

    source.measureText = function canvasMeasureText(this: unknown, text: string, options: Partial<FontOptions> & { maxWidth?: number } = {}): unknown {
        if (options.maxWidth !== undefined) {
            return measureText.call(this, text, options);
        }

        const font = withMeasureDefaults(options);
        const family = resolveThemeVars(font.fontFamily, lib);
        const size = resolveThemeVars(font.fontSize, lib);

        if (/var\(|calc\(/.test(family) || /var\(|calc\(/.test(size)) {
            bump(tools, 'memo', name, 'fallbackMiss');

            return measureText.call(this, text, options);
        }

        const key = Object.values(font).join('\u0000');
        const known = fontMetrics.get(key);

        if (!known) {
            const measured = measureText.call(this, text, options) as { height: number; baseline: number };

            fontMetrics.set(key, { height: measured.height, baseline: measured.baseline });

            return measured;
        }

        ctx.font = `${font.fontStyle} ${font.fontVariant} ${font.fontWeight} ${size} ${family}`;
        bump(tools, 'memo', name, 'canvas');

        return { width: Math.ceil(ctx.measureText(text).width), height: known.height, baseline: known.baseline };
    };

    return 'measureText measures widths on a canvas';
}

/**
 * G19: the tooltip's idle paths. An attachment identical to the component's
 * current one — same text, colors and mode — is not rebuilt. The idle `hide`
 * the plan also named is left alone: with nothing showing, fading or watched,
 * the tooltip has no element, and `hide` already returns before any fade.
 *
 * @param tools - The harness tools.
 * @param lib - The library objects: `Tooltip`.
 * @returns A note saying what was patched.
 */
function g19TooltipIdle(tools: HarnessTools, lib: HarnessLibrary): string {
    const name = 'g19.tooltip-idle';
    const tooltip = lib.Tooltip as AnyObj | undefined;

    if (!tooltip) {
        return 'no Tooltip';
    }

    const attachWith = tooltip._attachWith as Method;
    const detach = tooltip.detach as Method;
    const attached = new WeakMap<object, { text: unknown; covering: unknown; colors: string }>();

    tooltip._attachWith = function unchangedAttach(this: unknown, component: object, text: unknown, colors: unknown, covering: unknown): unknown {
        const entry = { text, covering, colors: JSON.stringify(colors ?? null) };
        const current = attached.get(component);

        if (current && current.text === entry.text && current.covering === entry.covering && current.colors === entry.colors) {
            bump(tools, 'skipped', name, 'attach');

            return undefined;
        }

        // Recorded after the original runs: it detaches first, which clears the entry.
        const result = attachWith.call(this, component, text, colors, covering);

        attached.set(component, entry);

        return result;
    };

    tooltip.detach = function forgettingDetach(this: unknown, component: object): unknown {
        attached.delete(component);

        return detach.call(this, component);
    };

    return 'Tooltip skips an unchanged attach';
}

/**
 * G20, as a dose: the per-event ancestor walk lives in `Event`'s
 * closure-private listener, which no page code can reach, so it cannot be
 * removed. Instead `getParentElement` and `getId`, the walk's two reads, each
 * run twice and return the second result — both are pure — so the arm pays
 * one more walk, and its cost bounds the walk the fix removes.
 *
 * @param tools - The harness tools.
 * @param lib - The library objects: the DOM seam.
 * @returns A note saying what was patched.
 */
function g20WalkDose(tools: HarnessTools, lib: HarnessLibrary): string {
    const name = 'g20.walk-dose';
    const source = lib.DOM.source as AnyObj;

    for (const method of ['getParentElement', 'getId']) {
        const original = source[method] as Method;

        source[method] = function dosedRead(this: unknown, ...args: unknown[]): unknown {
            original.apply(this, args);
            bump(tools, 'dose', name, 'extraCall');

            return original.apply(this, args);
        };
    }

    return 'getParentElement and getId each run twice';
}

/**
 * G21: a table's render pass rebuilds the same visible-record list many
 * times, sweeps every pooled cell's focus style when none holds it, and
 * re-applies the required-empty state with no column requiring anything. The
 * list is served while its sources are the same arrays — both are only ever
 * reassigned — the sweep takes the targeted branch, and the required state
 * is skipped when nothing is required.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function g21RenderPass(tools: HarnessTools): string {
    const name = 'g21.render-pass';
    const body = tools.findComponent('TableBody');

    if (!body) {
        return 'no TableBody';
    }

    memoiseVisibleRecords(tools, name, tools.ownerProto(body, 'getVisibleRecords')!);
    skipIdleFocusSweep(tools, name, tools.ownerProto(body, '_updateFocusStyle')!);
    skipUnrequiredEmptyState(tools, name, tools.ownerProto(body, 'applyRequiredEmptyState')!);

    return 'visible records memoised, idle focus sweep and unrequired empty state skipped';
}

/**
 * A later arm isolating one part of `g21.render-pass`: only the
 * visible-record memo, so a cell can attribute the group's time to that part
 * alone rather than the three-part bundle.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function g21VisibleMemo(tools: HarnessTools): string {
    const name = 'g21.visible-memo';
    const body = tools.findComponent('TableBody');

    if (!body) {
        return 'no TableBody';
    }

    memoiseVisibleRecords(tools, name, tools.ownerProto(body, 'getVisibleRecords')!);

    return 'visible records memoised';
}

/**
 * Serves `getVisibleRecords` while the arrays it is built from are the same:
 * the store's records and the row filter for a flat body, the flattened rows
 * for a tree body.
 *
 * @param tools - The harness tools.
 * @param name - The ablation's name, for its counter.
 * @param proto - The prototype that owns `getVisibleRecords`.
 */
function memoiseVisibleRecords(tools: HarnessTools, name: string, proto: AnyObj): void {
    const getVisibleRecords = proto.getVisibleRecords as Method;
    const served = new WeakMap<object, { sources: unknown[]; records: unknown }>();

    proto.getVisibleRecords = function (this: AnyObj): unknown {
        const sources = '_flatRows' in this ? [this._flatRows] : [(this._store as AnyObj)._records, this._rowVisible];
        const last = served.get(this);

        if (last && sameValues(last.sources, sources)) {
            bump(tools, 'memo', name, 'visibleHit');

            return last.records;
        }

        const records = getVisibleRecords.call(this);

        served.set(this, { sources, records });

        return records;
    };
}

/**
 * A stand-in for the previously focused cell: `_updateFocusStyle` then takes
 * its targeted branch — clearing this one cell, which is a no-op — instead of
 * sweeping the whole pool, and nulls the field itself.
 */
const NO_FOCUSED_CELL = {
    getParentComponent: (): boolean => true,
    setStyleState: (): void => { /* no cell holds `.focused` */ },
};

/**
 * Skips `_updateFocusStyle`'s pool-wide sweep when no cell holds the focus
 * style: with `_previousFocusedCell` null, no cell has `.focused`, which is
 * set only where that field is.
 *
 * @param tools - The harness tools.
 * @param name - The ablation's name, for its counter.
 * @param proto - The prototype that owns `_updateFocusStyle`.
 */
function skipIdleFocusSweep(tools: HarnessTools, name: string, proto: AnyObj): void {
    const updateFocusStyle = proto._updateFocusStyle as Method;

    proto._updateFocusStyle = function (this: AnyObj): unknown {
        if (this._previousFocusedCell === null) {
            this._previousFocusedCell = NO_FOCUSED_CELL;
            bump(tools, 'skipped', name, 'focusSweep');
        }

        return updateFocusStyle.call(this);
    };
}

/**
 * Skips `applyRequiredEmptyState` when no column is required, statically or
 * by predicate: every cell's required-empty state is then already `false`.
 *
 * @param tools - The harness tools.
 * @param name - The ablation's name, for its counter.
 * @param proto - The prototype that owns `applyRequiredEmptyState`.
 */
function skipUnrequiredEmptyState(tools: HarnessTools, name: string, proto: AnyObj): void {
    const applyRequiredEmptyState = proto.applyRequiredEmptyState as Method;
    const anyRequired = new WeakMap<object, boolean>();

    proto.applyRequiredEmptyState = function (this: AnyObj, row: unknown, record: unknown): unknown {
        const configs = this._columnConfigs as Map<string, { required?: boolean; requiredPredicate?: unknown }>;
        let required = anyRequired.get(configs);

        if (required === undefined) {
            required = [...configs.values()].some((config) => config.required === true || Boolean(config.requiredPredicate));
            anyRequired.set(configs, required);
        }

        if (!required) {
            bump(tools, 'skipped', name, 'requiredEmpty');

            return undefined;
        }

        return applyRequiredEmptyState.call(this, row, record);
    };
}

/**
 * G22: a table re-lays out every visible cell on every frame of a resize
 * burst. Gives the table body the settle relay `Tree` already has: once a
 * burst is under way, cells keep their bounds until the settle re-renders
 * them at the settled width two frames after the burst.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function g22SettleRelay(tools: HarnessTools): string {
    const name = 'g22.settle-relay';
    const body = tools.findComponent('TableBody');

    if (!body) {
        return 'no TableBody';
    }

    const windowProto = tools.ownerProto(body, 'renderWindow')!;
    const boundsProto = tools.rootOwnerProto(body, 'applyBounds')!;
    const renderWindow = windowProto.renderWindow as Method;
    const applyBounds = boundsProto.applyBounds as Method;
    const isCell = chainTest(['Cell']);
    let deferring = false;

    windowProto.renderWindow = function (this: AnyObj, bodyWidth?: number, columnWidths?: number[]): unknown {
        // Exactly `updateColumnWidthCache`'s test.
        const widthsChanged = bodyWidth !== undefined
            && (this._lastBodyWidth !== bodyWidth || !sameValues(this._lastColumnWidths as number[], columnWidths ?? []));

        if (!call<boolean>(this, 'deferRowLayoutWhileResizing', widthsChanged)) {
            return renderWindow.call(this, bodyWidth, columnWidths);
        }

        const outer = deferring;

        deferring = true;

        try {
            return renderWindow.call(this, bodyWidth, columnWidths);
        } finally {
            deferring = outer;
        }
    };

    boundsProto.applyBounds = function (this: AnyObj, x: number, y: number, width: number, height: number): unknown {
        if (deferring && isCell(this) && call<number>(this, 'getWidth') > 0) {
            bump(tools, 'skipped', name, 'cellBounds');

            return this;
        }

        return applyBounds.call(this, x, y, width, height);
    };

    return 'table body defers cell bounds during a resize burst';
}

/**
 * G23: header and cell writes that repeat unchanged. A filter cell offered
 * its current operators again, or asked to show the operator face it shows,
 * does nothing; and a date formatted by `toLocale*String` goes through a
 * cached `Intl.DateTimeFormat` instead of building one per call.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function g23WriteEconomy(tools: HarnessTools): string {
    const name = 'g23.write-economy';
    const cell = tools.findComponent('FilterCell');

    if (!cell) {
        return 'no FilterCell';
    }

    const operatorsProto = tools.ownerProto(cell, 'setOperators')!;
    const faceProto = tools.ownerProto(cell, 'applyOperatorFace')!;
    const setOperators = operatorsProto.setOperators as Method;
    const applyOperatorFace = faceProto.applyOperatorFace as Method;
    const shownFace = new WeakMap<object, unknown>();

    operatorsProto.setOperators = function (this: AnyObj, operators: unknown[]): unknown {
        if (operators === this._operators && operators.length > 0) {
            bump(tools, 'skipped', name, 'operators');

            return this;
        }

        return setOperators.call(this, operators);
    };

    faceProto.applyOperatorFace = function (this: AnyObj, op: unknown): unknown {
        if (shownFace.has(this) && shownFace.get(this) === op) {
            bump(tools, 'skipped', name, 'operatorFace');

            return undefined;
        }

        const result = applyOperatorFace.call(this, op);

        shownFace.set(this, op);

        return result;
    };

    cacheDateFormatters(tools, name);

    return 'filter operators and face skipped when unchanged, dates formatted through cached formatters';
}

/**
 * How often a cached date format is checked against the engine's own
 * `toLocale*String`: every hundredth hit, so a formatter that drifts from it
 * shows in `intlMismatch` while the check itself stays out of the timing.
 */
const INTL_CHECK_EVERY = 100;

/**
 * `Date.prototype`'s three locale formatters, each with the ECMA-402
 * `required` and `defaults` it builds its format with.
 */
const DATE_FORMATTERS: Array<[method: string, required: 'date' | 'time' | 'any', defaults: 'date' | 'time' | 'all']> = [
    ['toLocaleDateString', 'date', 'date'],
    ['toLocaleTimeString', 'time', 'time'],
    ['toLocaleString', 'any', 'all'],
];

/**
 * Formats `Date.prototype.toLocaleDateString`, `toLocaleTimeString` and
 * `toLocaleString` through a cached `Intl.DateTimeFormat` per method, locale
 * and options, for an undefined or string locale and a valid date. Every
 * hundredth hit also runs the original and counts a differing string.
 *
 * @param tools - The harness tools.
 * @param name - The ablation's name, for its counters.
 */
function cacheDateFormatters(tools: HarnessTools, name: string): void {
    const formats = new Map<string, Intl.DateTimeFormat>();
    let hits = 0;

    for (const [method, required, defaults] of DATE_FORMATTERS) {
        const original = (Date.prototype as unknown as AnyObj)[method] as Method;

        (Date.prototype as unknown as AnyObj)[method] = function cachedFormat(this: Date, locales?: unknown, options?: Intl.DateTimeFormatOptions): unknown {
            if ((locales !== undefined && typeof locales !== 'string') || Number.isNaN(this.getTime())) {
                return original.call(this, locales, options);
            }

            const key = `${method}\u0000${locales ?? '\u0001'}\u0000${JSON.stringify(options ?? null)}`;
            const format = formats.get(key);

            if (!format) {
                // The engine's own string first: a call it rejects caches nothing.
                const text = original.call(this, locales, options);

                formats.set(key, new Intl.DateTimeFormat(locales, dateTimeOptions(options, required, defaults)));

                return text;
            }

            bump(tools, 'memo', name, 'intlHit');

            const text = format.format(this);

            hits++;

            if (hits % INTL_CHECK_EVERY === 0 && original.call(this, locales, options) !== text) {
                bump(tools, 'memo', name, 'intlMismatch');
            }

            return text;
        };
    }
}

/**
 * The options a `toLocale*String` call builds its format with (ECMA-402's
 * `ToDateTimeOptions`): unless the options already name a field its
 * `required` kind covers, or a style, its `defaults` fields are added as
 * `numeric`. `Intl.DateTimeFormat` alone would format an hour-only option
 * set without the date `toLocaleDateString` adds.
 *
 * @param options - The options as passed.
 * @param required - Which fields count as already chosen.
 * @param defaults - Which fields to add when none is.
 * @returns The options to build the format with.
 */
function dateTimeOptions(options: Intl.DateTimeFormatOptions | undefined, required: 'date' | 'time' | 'any', defaults: 'date' | 'time' | 'all'): Intl.DateTimeFormatOptions {
    const out: Record<string, unknown> = { ...options };
    const chosen = (fields: string[]): boolean => fields.some((field) => out[field] !== undefined);
    const dateChosen = required !== 'time' && chosen(['weekday', 'year', 'month', 'day']);
    const timeChosen = required !== 'date' && chosen(['dayPeriod', 'hour', 'minute', 'second', 'fractionalSecondDigits']);

    if (dateChosen || timeChosen || chosen(['dateStyle', 'timeStyle'])) {
        return out;
    }

    if (defaults !== 'time') {
        Object.assign(out, { year: 'numeric', month: 'numeric', day: 'numeric' });
    }

    if (defaults !== 'date') {
        Object.assign(out, { hour: 'numeric', minute: 'numeric', second: 'numeric' });
    }

    return out;
}

/**
 * G24, the list: a selection or focus move rewrites every row's class. A
 * row set to the selected or focused state it already has does nothing,
 * since it would rewrite an identical class attribute.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function g24ListRows(tools: HarnessTools): string {
    const name = 'g24.list-rows';
    const row = tools.findComponent('SelectableListRow');

    if (!row) {
        return 'no SelectableListRow';
    }

    for (const [method, field] of [['setSelected', '_selected'], ['setFocused', '_focused']]) {
        const proto = tools.ownerProto(row, method)!;
        const original = proto[method] as Method;

        proto[method] = function (this: AnyObj, value: boolean): unknown {
            if (value === this[field]) {
                bump(tools, 'skipped', name, 'rowClass');

                return this;
            }

            return original.call(this, value);
        };
    }

    return 'list row skips an unchanged selected or focused write';
}

/**
 * G24, the tree: the ceiling of a render signature gate on `passes`, where
 * nothing changes between passes and every re-render is redundant, so the
 * tree's row-window render does nothing at all. Sound only there.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function g24TreeWindow(tools: HarnessTools): string {
    const name = 'g24.tree-window';
    const tree = tools.findComponent('Tree');

    if (!tree) {
        return 'no Tree instance';
    }

    tools.ownerProto(tree, 'renderWindow')!.renderWindow = function (): void {
        bump(tools, 'skipped', name, 'renderWindow');
    };

    return 'Tree.renderWindow does nothing';
}

/**
 * G25: a theme switch reconfigures every mounted editor, the hidden ones
 * behind inactive tabs included. A hidden editor owes the reconfigure
 * instead, and pays it when it is next shown. Only an editor that has mounted
 * its view is withheld and counted: one behind a tab never shown has no view
 * — it mounts on its first layout, under the theme of the moment — so its
 * reconfigure is already a no-op, and a skip there would save nothing.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function g25ThemeWithhold(tools: HarnessTools): string {
    const name = 'g25.theme-withhold';
    const editor = tools.findComponent('CodeEditor');

    if (!editor) {
        return 'no CodeEditor instance';
    }

    const themeProto = tools.ownerProto(editor, 'onThemeChange')!;
    const visibilityProto = tools.ownerProto(editor, 'onEffectiveVisibilityChange')!;
    const onThemeChange = themeProto.onThemeChange as Method;
    const onEffectiveVisibilityChange = visibilityProto.onEffectiveVisibilityChange as Method;
    const owing = new WeakSet<object>();

    themeProto.onThemeChange = function (this: AnyObj): unknown {
        if (this._view && !call<boolean>(this, 'isEffectivelyVisible')) {
            owing.add(this);
            bump(tools, 'skipped', name, 'theme');

            return undefined;
        }

        return onThemeChange.call(this);
    };

    visibilityProto.onEffectiveVisibilityChange = function (this: AnyObj, effective: boolean): unknown {
        const result = onEffectiveVisibilityChange.call(this, effective);

        if (effective && owing.has(this)) {
            owing.delete(this);
            onThemeChange.call(this);
        }

        return result;
    };

    return 'hidden editors withhold a theme reconfigure until shown';
}

/**
 * How long a Markdown viewer's width must hold still before `g26`'s
 * deferred height measure runs: a drag delivers a width every frame, about
 * 16 ms apart, so this falls after the end of a burst, not inside it.
 */
const MEASURE_SETTLE_MS = 100;

/**
 * G26: the Markdown viewer's resize path. The floating panels re-read the
 * text column's rendered rectangle to hug it on every placement, and every
 * width change re-measures the content height. The rectangle is served while
 * the column's id, width, reading measure, font scale and the theme are
 * unchanged; and a height measure a width change asks for waits until the
 * width has held still for `MEASURE_SETTLE_MS`, then runs once.
 *
 * @param tools - The harness tools.
 * @param lib - The library objects: the DOM seam.
 * @returns A note saying what was patched.
 */
function g26ViewerResize(tools: HarnessTools, lib: HarnessLibrary): string {
    const name = 'g26.viewer-resize';
    const minimap = tools.findComponent('MarkdownMinimap');
    const markdown = tools.findComponent('Markdown');

    if (!minimap || !markdown) {
        return minimap ? 'no Markdown' : 'no MarkdownMinimap';
    }

    const theme = { generation: 0 };

    cacheHugRectangle(tools, name, tools.ownerProto(minimap, 'placeNextTo')!, lib, theme);
    deferWidthDrivenMeasure(tools, name, markdown);

    const themeProto = tools.ownerProto(markdown, 'onThemeChanged')!;
    const onThemeChanged = themeProto.onThemeChanged as Method;

    themeProto.onThemeChanged = function (this: unknown): unknown {
        theme.generation++;

        return onThemeChanged.call(this);
    };

    return 'hug rectangle cached, width-driven height measure deferred';
}

/**
 * Serves the text column's rectangle `FloatingPanel.placeNextTo` reads from
 * a per-panel cache while its key — the column's id, width, reading measure,
 * font scale and the theme generation — is unchanged.
 *
 * @param tools - The harness tools.
 * @param name - The ablation's name, for its counter.
 * @param proto - The prototype that owns `placeNextTo`.
 * @param lib - The library objects: the DOM seam.
 * @param theme - The theme generation, raised on every theme change.
 */
function cacheHugRectangle(tools: HarnessTools, name: string, proto: AnyObj, lib: HarnessLibrary, theme: { generation: number }): void {
    const placeNextTo = proto.placeNextTo as Method;
    const source = lib.DOM.source as AnyObj;
    const getElementRect = source.getElementRect as Method;
    const rects = new WeakMap<object, { key: unknown[]; rect: unknown }>();
    let placing: { panel: object; key: unknown[] } | null = null;

    proto.placeNextTo = function (this: object, textColumn: AnyObj | null): unknown {
        const column = textColumn as { getId?(): string; getWidth?(): number; getMaxMeasure?(): unknown; getFontScale?(): number } | null;
        const key = [column?.getId?.(), column?.getWidth?.(), column?.getMaxMeasure?.(), column?.getFontScale?.(), theme.generation];
        const outer = placing;

        placing = { panel: this, key };

        try {
            return placeNextTo.call(this, textColumn);
        } finally {
            placing = outer;
        }
    };

    source.getElementRect = function hugRectangle(this: unknown, handle: unknown): unknown {
        if (placing === null) {
            return getElementRect.call(this, handle);
        }

        const cached = rects.get(placing.panel);

        if (cached && sameValues(cached.key, placing.key)) {
            bump(tools, 'memo', name, 'rectHit');

            return cached.rect;
        }

        const rect = getElementRect.call(this, handle);

        rects.set(placing.panel, { key: placing.key, rect });

        return rect;
    };
}

/**
 * Defers the content-height measure `Markdown.setWidth` asks for: while a
 * `setWidth` call runs, `measureContentHeight` only (re)arms a timer that runs
 * it once after `MEASURE_SETTLE_MS`. Every other measure runs at once, and so
 * does one on a `Markdown` with no element or not effectively visible, which
 * returns without measuring: deferring it would save nothing.
 *
 * @param tools - The harness tools.
 * @param name - The ablation's name, for its counter.
 * @param markdown - A live `Markdown`, for its prototype.
 */
function deferWidthDrivenMeasure(tools: HarnessTools, name: string, markdown: AnyObj): void {
    const widthProto = tools.ownerProto(markdown, 'setWidth')!;
    const measureProto = tools.ownerProto(markdown, 'measureContentHeight')!;
    const setWidth = widthProto.setWidth as Method;
    const measure = measureProto.measureContentHeight as Method;
    const settingWidth = new WeakSet<object>();
    const timers = new WeakMap<object, ReturnType<typeof setTimeout>>();

    widthProto.setWidth = function (this: object, width: number): unknown {
        const outer = settingWidth.has(this);

        settingWidth.add(this);

        try {
            return setWidth.call(this, width);
        } finally {
            if (!outer) {
                settingWidth.delete(this);
            }
        }
    };

    measureProto.measureContentHeight = function (this: object): unknown {
        if (!settingWidth.has(this) || !call(this, 'getElement') || !call<boolean>(this, 'isEffectivelyVisible')) {
            return measure.call(this);
        }

        bump(tools, 'skipped', name, 'measure');
        clearTimeout(timers.get(this));

        timers.set(this, setTimeout(() => {
            timers.delete(this);
            measure.call(this);
        }, MEASURE_SETTLE_MS));

        return undefined;
    };
}

/**
 * How far above the pane's top a heading may sit and still count as reached:
 * `Markdown`'s own `ACTIVE_HEADING_TOP_TOLERANCE_PX`, which is not exported.
 */
const ACTIVE_HEADING_TOLERANCE_PX = 1;

/** A heading as `HeadingScrollTracker` holds it. */
interface TrackedHeading {
    id: string;
}

/** One tracker's cached heading offsets, and what they were measured under. */
interface HeadingOffsets {
    headings: unknown;
    scrollHeight: number;
    clientWidth: number;
    offsets: Array<number | null>;
}

/** The scroll metrics `DOM.source.getScrollMetrics` returns. */
interface ScrollMetrics {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    clientWidth: number;
}

/**
 * G27: every scroll tick resolves the active heading by querying and
 * measuring every heading. Measures each heading's offset in the scrolled
 * content once, rebuilding only when the headings, the content height or the
 * pane width change, and resolves each tick from the offsets and the scroll
 * position, with `findActiveHeading`'s rule.
 *
 * @param tools - The harness tools.
 * @param lib - The library objects: the DOM seam.
 * @returns A note saying what was patched.
 */
function g27HeadingCache(tools: HarnessTools, lib: HarnessLibrary): string {
    const name = 'g27.heading-cache';
    const viewer = tools.findComponent('MarkdownViewer');
    const tracker = viewer?._tracker as AnyObj | undefined;

    if (!tracker) {
        return 'no MarkdownViewer';
    }

    const proto = tools.ownerProto(tracker, 'trackScroll')!;
    const trackScroll = proto.trackScroll as Method;
    const cache = new WeakMap<object, HeadingOffsets>();

    proto.trackScroll = function (this: AnyObj, scrollElement: unknown): unknown {
        if (this._pendingClickScrollTop !== null) {
            return trackScroll.call(this, scrollElement);
        }

        const metrics = call<ScrollMetrics>(lib.DOM.source, 'getScrollMetrics', scrollElement);
        let offsets = cache.get(this);

        if (!offsets || offsets.headings !== this._headings || offsets.scrollHeight !== metrics.scrollHeight || offsets.clientWidth !== metrics.clientWidth) {
            offsets = measureHeadingOffsets(lib, scrollElement, this._headings as TrackedHeading[], metrics);
            cache.set(this, offsets);
            bump(tools, 'memo', name, 'rebuildMiss');
        } else {
            bump(tools, 'memo', name, 'trackHit');
        }

        call(this, 'setActiveHeading', activeHeadingAt(this._headings as TrackedHeading[], offsets.offsets, metrics));

        return undefined;
    };

    return 'heading offsets measured once per layout, not per scroll tick';
}

/**
 * Measures each heading's offset from the top of the scrolled content, found
 * as `findActiveHeading` finds it. Reads through the live DOM source, so they
 * count as the page's work.
 *
 * @param lib - The library objects: the DOM seam.
 * @param scrollElement - The pane's scroll-owning element.
 * @param headings - The tracked headings, in document order.
 * @param metrics - The pane's scroll metrics now.
 * @returns The offsets, `null` for a heading with no element in the pane, and what they were measured under.
 */
function measureHeadingOffsets(lib: HarnessLibrary, scrollElement: unknown, headings: TrackedHeading[], metrics: ScrollMetrics): HeadingOffsets {
    const source = lib.DOM.source;
    const paneTop = call<{ top: number }>(source, 'getElementRect', scrollElement).top;

    const offsets = headings.map((heading) => {
        const el = call(source, 'querySelector', scrollElement, `[id="${call<string>(source, 'escapeSelector', heading.id)}"]`);

        return el === null ? null : call<{ top: number }>(source, 'getElementRect', el).top - paneTop + metrics.scrollTop;
    });

    return { headings, scrollHeight: metrics.scrollHeight, clientWidth: metrics.clientWidth, offsets };
}

/**
 * The active heading at the current scroll position, by `findActiveHeading`'s
 * rule: the last heading at or above the pane's top, or at maximum scroll the
 * first one not yet reached.
 *
 * @param headings - The tracked headings, in document order.
 * @param offsets - Each heading's offset in the content, or `null`.
 * @param metrics - The pane's scroll metrics now.
 * @returns The active heading's id, or `null` above every heading.
 */
function activeHeadingAt(headings: TrackedHeading[], offsets: Array<number | null>, metrics: ScrollMetrics): string | null {
    const atMaxScroll = metrics.scrollHeight > metrics.clientHeight
        && metrics.scrollTop >= metrics.scrollHeight - metrics.clientHeight - ACTIVE_HEADING_TOLERANCE_PX;

    let active: string | null = null;

    for (let i = 0; i < headings.length; i++) {
        const offset = offsets[i];

        if (offset === null) {
            continue;
        }

        if (offset - metrics.scrollTop <= ACTIVE_HEADING_TOLERANCE_PX) {
            active = headings[i].id;
        } else {
            if (atMaxScroll) {
                active = headings[i].id;
            }

            break;
        }
    }

    return active;
}

/** G28's note on a library whose `setTransform` already writes inline (from motion-transform-inline on). */
const TRANSFORM_INLINE_NOTE = 'no rule-side transform: setTransform writes inline';

/**
 * Whether the library's `setTransform` already writes the element's inline
 * style: its `Component` carries the `writeTransform` helper that composes the
 * one inline declaration `setTranslate` and `setTransform` share. This
 * ablation's raw inline write would drop a `setTranslate` offset composed into
 * that declaration, so it patches nothing there.
 *
 * @param setProto - The prototype owning `setTransform`.
 * @returns `true` when the library writes transforms inline itself.
 */
function libraryWritesTransformInline(setProto: AnyObj): boolean {
    return typeof setProto.writeTransform === 'function';
}

/**
 * G28: `setTransform` writes the component's `#id` stylesheet rule, so every
 * continuous-motion frame restyles through the rule. Writes the same
 * transform inline instead, which outranks the rule it replaces; transforms
 * already set move inline at install, uncounted.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched, or `TRANSFORM_INLINE_NOTE` on a library that writes transforms inline itself.
 */
function g28TransformInline(tools: HarnessTools): string {
    const name = 'g28.transform-inline';
    const any = tools.walkComponents()[0];

    if (!any) {
        return 'no component';
    }

    const setProto = tools.rootOwnerProto(any, 'setTransform')!;
    const clearProto = tools.rootOwnerProto(any, 'clearTransform')!;

    if (libraryWritesTransformInline(setProto)) {
        return TRANSFORM_INLINE_NOTE;
    }

    setProto.setTransform = function (this: AnyObj, value: string): unknown {
        if (this._transform === value) {
            return this;
        }

        this._transform = value;
        call(this, 'setElementStyle', 'transform', value);
        bump(tools, 'skipped', name, 'ruleWrite');

        return this;
    };

    clearProto.clearTransform = function (this: AnyObj): unknown {
        this._transform = null;
        call(this, 'setElementStyle', 'transform', null);

        return this;
    };

    for (const component of tools.walkComponents()) {
        if (component._transform) {
            call(component, 'setElementCSSRule', 'transform', null);
            call(component, 'setElementStyle', 'transform', component._transform);
        }
    }

    return 'setTransform writes inline, not to the rule';
}

/** The revision stamps `installChartRevision` has installed, so a later install can tell its own from a restored prototype. */
const chartRevisionStamps = new WeakSet<object>();

/**
 * Stamps every chart state change: an own `scheduleLayout` on
 * `AbstractChart.prototype` adds one to the chart's `__w3Revision`, then
 * calls the parent prototype's, looked up at call time. Every chart state
 * change schedules a layout, so an unchanged revision means unchanged state.
 * Installed once, by whichever chart ablation runs first.
 *
 * @param chartProto - `AbstractChart.prototype`.
 */
function installChartRevision(chartProto: AnyObj): void {
    if (Object.hasOwn(chartProto, 'scheduleLayout') && chartRevisionStamps.has(chartProto.scheduleLayout as object)) {
        return;
    }

    const stamp = function scheduleLayoutWithRevision(this: AnyObj, ...args: unknown[]): unknown {
        this.__w3Revision = chartRevision(this) + 1;

        return ((Object.getPrototypeOf(chartProto) as AnyObj).scheduleLayout as Method).apply(this, args);
    };

    chartRevisionStamps.add(stamp);
    chartProto.scheduleLayout = stamp;
}

/**
 * A chart's state revision.
 *
 * @param chart - The chart.
 * @returns How many state changes it has scheduled a layout for since the stamp was installed.
 */
function chartRevision(chart: AnyObj): number {
    return (chart.__w3Revision as number | undefined) ?? 0;
}

/** A chart ablation's note on a library whose `AbstractChart` gates its own repaint (from chart-repaint-gate on). */
const CHART_GATED_NOTE = 'no ungated repaint: AbstractChart gates its own';

/**
 * Whether the library's `AbstractChart` gates its own repaint: an own
 * `scheduleLayout` that is not a revision stamp is the library's override,
 * which marks the chart's marks stale. The stamp would replace that override,
 * and the library's gate would then keep outdated marks through a data change.
 *
 * @param chartProto - `AbstractChart.prototype`.
 * @returns `true` when the prototype carries the library's own override.
 */
function libraryGatesChartRepaint(chartProto: AnyObj): boolean {
    return Object.hasOwn(chartProto, 'scheduleLayout') && !chartRevisionStamps.has(chartProto.scheduleLayout as object);
}

/**
 * `AbstractChart.prototype`, with the revision stamp installed.
 *
 * @param tools - The harness tools.
 * @returns The prototype; or, installing nothing, the note `'no AbstractChart'` when no chart is mounted, or `CHART_GATED_NOTE` when the library gates its own repaint.
 */
function chartPrototype(tools: HarnessTools): AnyObj | string {
    const chart = tools.findComponent('AbstractChart');
    const chartClass = chart ? chainClass(chart, 'AbstractChart') : null;

    if (!chartClass) {
        return 'no AbstractChart';
    }

    const proto = chartClass.prototype as AnyObj;

    if (libraryGatesChartRepaint(proto)) {
        return CHART_GATED_NOTE;
    }

    installChartRevision(proto);

    return proto;
}

/**
 * F26.1: a chart rebuilds every SVG mark on every layout pass. Keeps the
 * marks when the plot rectangle, both scales' domain and range, and the
 * chart's state revision equal the last repaint's.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function chartRepaintGate(tools: HarnessTools): string {
    const name = 'chart.repaint-gate';
    const proto = chartPrototype(tools);

    if (typeof proto === 'string') {
        return proto;
    }

    const repaint = proto.repaint as Method;
    const lastRepaint = new WeakMap<object, unknown[]>();

    proto.repaint = function (this: AnyObj, plot: { x: number; y: number; width: number; height: number }, xScale: AnyObj, yScale: AnyObj): unknown {
        const signature = [
            plot.x, plot.y, plot.width, plot.height,
            String(call(xScale, 'domain')), String(call(xScale, 'range')),
            String(call(yScale, 'domain')), String(call(yScale, 'range')),
            chartRevision(this),
        ];

        const last = lastRepaint.get(this);

        if (last && sameValues(last, signature)) {
            bump(tools, 'skipped', name, 'repaint');

            return undefined;
        }

        lastRepaint.set(this, signature);

        return repaint.call(this, plot, xScale, yScale);
    };

    return 'chart keeps its marks across an unchanged repaint';
}

/** A chart's plot rectangle. */
interface PlotRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * F26.2: a chart re-measures its axis margins, a dozen text measurements, on
 * every pass. The margins depend on the scale domains — a state change, so a
 * new revision — not on the pixel range, so the insets `computePlot` found
 * are re-applied to the new outer rectangle until the revision moves.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function chartMarginMemo(tools: HarnessTools): string {
    const name = 'chart.margin-memo';
    const proto = chartPrototype(tools);

    if (typeof proto === 'string') {
        return proto;
    }

    const computePlot = proto.computePlot as Method;
    const insets = new WeakMap<object, { revision: number; left: number; top: number; right: number; bottom: number }>();

    proto.computePlot = function (this: AnyObj, plotOuter: PlotRect): unknown {
        const revision = chartRevision(this);
        const cached = insets.get(this);

        if (cached && cached.revision === revision) {
            bump(tools, 'memo', name, 'plotHit');

            return {
                x: plotOuter.x + cached.left,
                y: plotOuter.y + cached.top,
                width: Math.max(0, plotOuter.width - cached.left - cached.right),
                height: Math.max(0, plotOuter.height - cached.top - cached.bottom),
            };
        }

        const plot = computePlot.call(this, plotOuter) as PlotRect;
        const left = plot.x - plotOuter.x;
        const top = plot.y - plotOuter.y;

        // A collapsed plot was clamped at 0, which hides the far insets.
        if (plot.width !== 0 && plot.height !== 0) {
            insets.set(this, { revision, left, top, right: plotOuter.width - left - plot.width, bottom: plotOuter.height - top - plot.height });
        }

        return plot;
    };

    return 'chart re-applies its axis insets until its state changes';
}

/**
 * Name → ablation. Each patches the page and returns a one-line note; an
 * ablation whose target is absent says so in its note and patches nothing.
 */
export const ABLATIONS: Record<string, Ablation> = {
    // The W3.0 bounding sweep's arms: one per wave-3 candidate group (G…) or
    // finding (F26.…), named after it; see
    // plans/implemented/w3-0-bounding-sweep.md.
    'split.noop-drag': (tools) => splitDragGate(tools, 'split.noop-drag', 'skipped', 'paneLayout', true),
    // A later arm, outside the sweep: the control for the line above. Same
    // code, same per-frame cost, no skip, so a park cell can price the
    // instrument and subtract it from the candidate's reading.
    'split.noop-control': (tools) => splitDragGate(tools, 'split.noop-control', 'dose', 'wouldSkip', false),
    'split.recalc-gate': splitRecalcGate,
    'g12.collapse-static': g12CollapseStatic,
    'g05.lazy-reads': g05LazyReads,
    'g08.env-reads': g08EnvReads,
    'g09.all': (tools) => g09SkipUnchanged(tools, 'g09.all', 'all'),
    'g09.chrome': (tools) => g09SkipUnchanged(tools, 'g09.chrome', 'chrome'),
    'g11.gather-residue': g11GatherResidue,
    'g14.closed-section': g14ClosedSection,
    'g16.panel-settled': g16PanelSettled,
    'g16.scroll-reads': g16ScrollReads,
    'g18.measure-memo': g18MeasureMemo,
    'g18.canvas-width': g18CanvasWidth,
    'g19.tooltip-idle': g19TooltipIdle,
    'g20.walk-dose': g20WalkDose,
    'g21.render-pass': g21RenderPass,
    // A later arm, outside the sweep: isolates one part of a W3.0 group.
    'g21.visible-memo': g21VisibleMemo,
    'g22.settle-relay': g22SettleRelay,
    'g23.write-economy': g23WriteEconomy,
    'g24.list-rows': g24ListRows,
    'g24.tree-window': g24TreeWindow,
    'g25.theme-withhold': g25ThemeWithhold,
    'g26.viewer-resize': g26ViewerResize,
    'g27.heading-cache': g27HeadingCache,
    'g28.transform-inline': g28TransformInline,
    'chart.repaint-gate': chartRepaintGate,
    'chart.margin-memo': chartMarginMemo,
    // Component.syncScrollOffsets becomes a no-op: no live scrollLeft/scrollTop
    // read anywhere during layout (the caches stay as last written).
    'sync.scroll': (tools) => {
        const any = tools.walkComponents()[0];

        return any ? tools.noopOnOwningProto(any, 'syncScrollOffsets') : 'no component';
    },
    // CodeMirror's per-frame measure cycle becomes a no-op for every editor
    // (EditorView.prototype.measure). Editors keep their DOM as-is.
    'cm.measure': (tools) => {
        const views = codeMirrorViews(tools);

        if (views.length === 0) {
            return 'no CodeMirror views';
        }

        const proto = Object.getPrototypeOf(views[0]) as AnyObj;

        proto.measure = function (): void { /* ablated */ };

        return `EditorView.measure no-op'd (${views.length} views)`;
    },
    'cm.observers': disconnectCodeMirrorObservers,
    // CodeEditor stops laying itself out (its element keeps its size; the pane resizes around it).
    'editor.doLayout': (tools) => {
        const editor = tools.findComponent('CodeEditor');

        return editor ? tools.noopOnOwningProto(editor, 'doLayout') : 'no CodeEditor instance';
    },
    // No stylesheet-rule mutations at all during the run (inline writes kept).
    'norules': dropRuleWrites,
    'nosameattr': dropSameAttributeWrites,
    'nosamewrites': dropSameStyleWrites,
    // aria-hidden attribute writes dropped.
    'noaria': () => {
        const setAttribute = Element.prototype.setAttribute;

        Element.prototype.setAttribute = function (this: Element, name: string, value: string): void {
            if (name !== 'aria-hidden') {
                setAttribute.call(this, name, value);
            }
        };

        return 'aria-hidden writes dropped';
    },
    // Component.setVisible becomes a no-op (Tab.doLayout's per-pass hide/show round trip disappears).
    'novisible': (tools) => {
        const any = tools.walkComponents()[0];

        return any ? tools.noopOnOwningProto(any, 'setVisible') : 'no component';
    },
    // The first Tab layout stops laying out (its visible child no longer resizes with the pane).
    'tab.doLayout': (tools) => noopLayoutManagerDoLayout(tools, 'Tab'),
    // Tree stops re-rendering its row window (no per-frame row width writes).
    'tree.renderWindow': (tools) => {
        const tree = tools.findComponent('Tree');

        return tree ? tools.noopOnOwningProto(tree, 'renderWindow') : 'no Tree instance';
    },
    // Tree ignores layout entirely (neither resizes itself nor its rows).
    'tree.doLayout': (tools) => {
        const tree = tools.findComponent('Tree');

        return tree ? tools.noopOnOwningProto(tree, 'doLayout') : 'no Tree instance';
    },
    'scroller.layoutScrollbars': noopScrollerLayoutScrollbars,
    // The first Accordion layout stops laying out its sections.
    'accordion.doLayout': (tools) => noopLayoutManagerDoLayout(tools, 'Accordion'),
    // The first Card layout stops laying out its visible page.
    'card.doLayout': (tools) => noopLayoutManagerDoLayout(tools, 'Card'),
};
