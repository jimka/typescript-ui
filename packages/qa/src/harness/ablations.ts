// Runtime ablations (`abl=<name>[,…]`): each patches the page's live code to
// remove one piece of work, so a same-session A/B against a run without it
// bounds what removing that work in the library could save. Ported from
// Loom's `ABLATIONS`, minus the entries whose change is in the library now
// (`size.memo`, `skip.unchanged`, `border.region-memo`, `accordion.seed`) and
// the dropped G10 pair (`clamp.rows`, `clamp.once`). Nothing here patches
// anything at import time.

import { cssAccessorHost } from './counters.js';
import type { Ablation, AnyObj, HarnessTools } from './types.js';

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

/**
 * G12 / F06.3: a Split drag that computes a zero delta (the pane is at its
 * clamp) still runs the whole re-layout. Early-return instead.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function splitNoopDrag(tools: HarnessTools): string {
    const split = tools.findLayoutManager('Split');

    if (!split) {
        return 'no Split layout manager';
    }

    const proto = tools.ownerProto(split, 'onDrag');

    if (!proto) {
        return 'onDrag not found';
    }

    const original = proto.onDrag as (...args: unknown[]) => unknown;
    let skipped = 0;
    const lastAmount = new WeakMap<object, number>();

    proto.onDrag = function (this: AnyObj, ...args: unknown[]): unknown {
        const amount = args.find((a) => typeof a === 'number') as number | undefined;

        if (amount === 0 || (amount !== undefined && lastAmount.get(this) === amount)) {
            skipped++;
            tools.bumpWork('skipped.split.onDrag');

            return undefined;
        }

        if (amount !== undefined) {
            lastAmount.set(this, amount);
        }

        return original.apply(this, args);
    };

    exposeCount('__splitNoopDrags', () => skipped);

    return 'Split.onDrag early-returns on a zero/repeat delta';
}

/**
 * G12 / F06.4 upper bound: `recalculateSizes` runs once per (container,
 * available) pair instead of every pass.
 *
 * @param tools - The harness tools.
 * @returns A note saying what was patched.
 */
function splitRecalcGate(tools: HarnessTools): string {
    const split = tools.findLayoutManager('Split');

    if (!split) {
        return 'no Split layout manager';
    }

    const proto = tools.ownerProto(split, 'recalculateSizes');

    if (!proto) {
        return 'recalculateSizes not found';
    }

    const original = proto.recalculateSizes as (...args: unknown[]) => unknown;
    const seen = new WeakMap<object, string>();
    let skipped = 0;

    proto.recalculateSizes = function (this: AnyObj, ...args: unknown[]): unknown {
        const signature = JSON.stringify(args.filter((a) => typeof a === 'number' || typeof a === 'string'));

        if (seen.get(this) === signature) {
            skipped++;
            tools.bumpWork('skipped.split.recalculateSizes');

            return undefined;
        }

        seen.set(this, signature);

        return original.apply(this, args);
    };

    exposeCount('__splitRecalcSkipped', () => skipped);

    return 'Split.recalculateSizes gated on its argument signature';
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
 * Name → ablation. Each patches the page and returns a one-line note; an
 * ablation whose target is absent says so in its note and patches nothing.
 */
export const ABLATIONS: Record<string, Ablation> = {
    // G12 / F06.3 and F06.4, the wave-3 candidates the agenda names.
    'split.noop-drag': splitNoopDrag,
    'split.recalc-gate': splitRecalcGate,
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
