// The counter families: native DOM/CSSOM writes with the forced-layout
// detector (`count=1`), camelCase style writes (`deepwrites=1`), per-class
// method calls (`work=1`), DOM seam calls (`seam=1`) and platform calls
// (`plat=1`). Ported from Loom's qa-harness.ts except the seam and platform
// counters, which are new. Every family tallies only between
// `startCounting()` and `stopCounting()`; nothing here patches anything at
// import time.

import { className, ownerProto, rootOwnerProto } from './tree.js';
import type { AnyObj, HarnessLibrary, HarnessTools, PhaseReport } from './types.js';

/** The counter fields of one phase's report. */
export type PhaseCounts = Pick<PhaseReport, 'writes' | 'forcedStacks' | 'work' | 'seam' | 'plat'>;

/**
 * How many distinct stacks are kept per forced-read API. Loom's value: the
 * first few distinct call chains name what forces the layout; later ones
 * mostly repeat them and only grow the report.
 */
const FORCED_STACKS_PER_API = 4;

/** How many distinct stacks are kept for `.invisible` class toggles; Loom's value, for the same reason. */
const INVISIBLE_STACKS = 3;

/**
 * Stack lines dropped from the top of a captured stack before keeping any.
 * Loom's offset: it skips the header and the harness's own frames, so the
 * kept lines start at or next to the library code that caused the event.
 */
const STACK_SKIP_LINES = 2;

/** Stack lines kept per forced read (Loom's `slice(2, 12)`): enough to reach the library caller. */
const FORCED_STACK_DEPTH = 10;

/** Stack lines kept per `.invisible` toggle (Loom's `slice(2, 14)`): its callers sit deeper in layout. */
const INVISIBLE_STACK_DEPTH = 12;

/**
 * Decimal places kept in a per-unit tally. Loom's rounding: a hundredth of a
 * call per unit is below anything a comparison acts on.
 */
const PER_UNIT_DECIMALS = 2;

/** Whether a counting window is open; every family tallies only while it is. */
let counting = false;

/** Which families have been installed; `stopCounting` reports these. */
const installed = { writes: false, work: false, seam: false, plat: false };

let writeCounts: Record<string, number> = {};
let workCounts: Record<string, number> = {};
const seamCounts: { sink: Record<string, number>; source: Record<string, number> } = { sink: {}, source: {} };
let platCounts: Record<string, number> = {};

/** Set by any counted DOM write; the next layout-reading call clears it and counts a forced read. */
let layoutDirty = false;

/** The first distinct stacks per forced-read API (and per `.invisible` toggle). */
const forcedStacks: Record<string, string[]> = {};

/** Opens a counting window: empties every tally and the stored stacks, then starts counting. */
export function startCounting(): void {
    writeCounts = {};
    workCounts = {};
    seamCounts.sink = {};
    seamCounts.source = {};
    platCounts = {};
    layoutDirty = false;

    for (const key of Object.keys(forcedStacks)) {
        delete forcedStacks[key];
    }

    counting = true;
}

/**
 * Closes the counting window and returns its tallies per unit.
 *
 * A family is reported when it is installed, or when something tallied into
 * it during the window — an ablation's own `memo.*` or `skip*` counters, say,
 * on a run that did not install that family's counters.
 *
 * @param units - How many units the window covered.
 * @returns `writes` and `forcedStacks`, `work`, `seam` and `plat`, each only when reported.
 */
export function stopCounting(units: number): PhaseCounts {
    counting = false;

    const out: PhaseCounts = {};

    if (installed.writes || Object.keys(writeCounts).length > 0) {
        out.writes = perUnit(writeCounts, units);
        out.forcedStacks = { ...forcedStacks };
    }

    if (installed.work || Object.keys(workCounts).length > 0) {
        out.work = perUnit(workCounts, units);
    }

    if (installed.seam) {
        out.seam = { sink: perUnit(seamCounts.sink, units), source: perUnit(seamCounts.source, units) };
    }

    if (installed.plat) {
        out.plat = perUnit(platCounts, units);
    }

    return out;
}

/**
 * Runs `work` with every counter family paused, so a driver's own setup and
 * teardown stay out of the counting window. Counting is restored to what it
 * was before, also when `work` throws.
 *
 * @param work - The unmeasured work.
 * @returns What `work` resolves to; rejects with whatever it throws.
 */
export async function suspendCounting<T>(work: () => Promise<T>): Promise<T> {
    const wasCounting = counting;

    counting = false;

    try {
        return await work();
    } finally {
        counting = wasCounting;
    }
}

/**
 * Divides every tally by `units`, rounded to hundredths, largest first.
 *
 * @param counts - Tallies over the whole window.
 * @param units - How many units the window covered.
 * @returns The tallies per unit.
 */
export function perUnit(counts: Record<string, number>, units: number): Record<string, number> {
    const out: Record<string, number> = {};

    for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        out[k] = +(v / units).toFixed(PER_UNIT_DECIMALS);
    }

    return out;
}

/**
 * Adds one to write counter `kind` while counting. A kind that changes the DOM
 * leaves layout dirty until the next layout-reading call.
 *
 * @param kind - The counter's key.
 */
export function bumpWrite(kind: string): void {
    if (counting) {
        writeCounts[kind] = (writeCounts[kind] ?? 0) + 1;

        if (/\.changed(@|$)|^sheet\.|^mut\.|cssText\.changed/.test(kind)) {
            layoutDirty = true;
        }
    }
}

/**
 * Adds one to work counter `kind` while counting.
 *
 * @param kind - The counter's key.
 */
export function bumpWork(kind: string): void {
    if (counting) {
        workCounts[kind] = (workCounts[kind] ?? 0) + 1;
    }
}

/**
 * Adds one to platform counter `key` while counting. Unlike `bumpWork` it is
 * module-private and absent from `HarnessTools`: no ablation and no panel
 * tallies into this family, which holds engine calls alone.
 *
 * @param key - The counter's key; one of `PLATFORM_CALLS`' constants.
 */
function bumpPlat(key: string): void {
    if (counting) {
        platCounts[key] = (platCounts[key] ?? 0) + 1;
    }
}

/**
 * Escapes `text` for use as a literal inside a regular expression.
 *
 * @param text - Any text.
 * @returns The escaped text.
 */
function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Shortens a captured stack to one line: drops the top lines, keeps `depth`
 * frames, and strips the dev server's `/@fs/…/dist/lib/` prefix and `?t=`
 * cache busters so frames name the library's own files.
 *
 * @param stack - An `Error().stack`, captured by the caller.
 * @param depth - How many frames to keep.
 * @returns The frames joined by ` <- `.
 */
function formatStack(stack: string, depth: number): string {
    const libPrefix = new RegExp(`${escapeRegExp(location.origin)}/@fs/[^ ]*/dist/lib/`, 'g');

    return stack.split('\n').slice(STACK_SKIP_LINES, STACK_SKIP_LINES + depth)
        .map((l) => l.trim().replace(/^at /, '').replace(libPrefix, '').replace(/\?t=\d+/g, ''))
        .join(' <- ');
}

/**
 * Stores `stack` under `key` unless it is already stored or `limit` stacks are.
 *
 * @param key - The API or event the stack belongs to.
 * @param stack - The formatted stack.
 * @param limit - How many distinct stacks `key` keeps.
 */
function keepStack(key: string, stack: string, limit: number): void {
    const stacks = (forcedStacks[key] ??= []);

    if (stacks.length < limit && !stacks.includes(stack)) {
        stacks.push(stack);
    }
}

/**
 * Called by every wrapped layout-reading API. When a counted write has left
 * layout dirty, the read forces a synchronous style and layout: count it and
 * keep its stack.
 *
 * @param api - The reading API's name.
 */
function noteForcedRead(api: string): void {
    if (!counting || !layoutDirty) {
        return;
    }

    layoutDirty = false;
    bumpWrite(`forced.${api}`);

    if ((forcedStacks[api]?.length ?? 0) < FORCED_STACKS_PER_API) {
        keepStack(api, formatStack(new Error().stack ?? '', FORCED_STACK_DEPTH), FORCED_STACKS_PER_API);
    }
}

/**
 * Installs the native write counters (`count=1`): the forced-layout detector,
 * then the mutation, declaration, stylesheet, attribute and class-list
 * counters, in Loom's order.
 */
export function installWriteCounters(): void {
    installed.writes = true;
    installForcedLayoutDetector();
    installMutationCounter();
    installDeclarationCounters();
    installSheetCounters();
    installAttributeCounters();
    installClassListCounters();
}

/** Wraps `getBoundingClientRect`, `getComputedStyle` and the layout-reading element properties so each notes a forced read. */
function installForcedLayoutDetector(): void {
    const elProto = Element.prototype;
    const gbcr = elProto.getBoundingClientRect;

    elProto.getBoundingClientRect = function (this: Element): DOMRect {
        noteForcedRead('getBoundingClientRect');

        return gbcr.call(this);
    };

    const gcs = window.getComputedStyle;

    window.getComputedStyle = function (el: Element, pseudo?: string | null): CSSStyleDeclaration {
        noteForcedRead('getComputedStyle');

        return gcs.call(window, el, pseudo);
    };

    for (const [proto, props] of [
        [HTMLElement.prototype, ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft']],
        [Element.prototype, ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight', 'scrollTop', 'scrollLeft']],
    ] as Array<[object, string[]]>) {
        for (const prop of props) {
            wrapLayoutProperty(proto, prop);
        }
    }
}

/**
 * Redefines one layout-reading accessor so its read, and its write where it has
 * one, notes a forced read. A scroll write clamps against layout, forcing it too.
 *
 * @param proto - The prototype that owns the accessor.
 * @param prop - The property name.
 */
function wrapLayoutProperty(proto: object, prop: string): void {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);

    if (!desc?.get) {
        return;
    }

    const get = desc.get;
    const set = desc.set;

    Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: desc.enumerable,
        get(this: Element): unknown {
            noteForcedRead(prop);

            return get.call(this);
        },
        set: set ? function (this: Element, v: unknown): void {
            noteForcedRead(`${prop}.set`);
            set.call(this, v);
        } : undefined,
    });
}

/**
 * Counts DOM structure churn: nodes added and removed under a target, keyed by
 * the target's first class. Records arrive in a microtask, before the driver's
 * promise continues, so they land inside the counting window.
 */
function installMutationCounter(): void {
    const mutations = new MutationObserver((records) => {
        if (!counting) {
            return;
        }

        for (const record of records) {
            const target = record.target as Element;
            const cls = (target.classList && target.classList[0]) || target.nodeName.toLowerCase();

            if (record.addedNodes.length) {
                bumpWrite(`mut.${cls}.added`);
                writeCounts[`mut.${cls}.addedNodes`] = (writeCounts[`mut.${cls}.addedNodes`] ?? 0) + record.addedNodes.length;
            }

            if (record.removedNodes.length) {
                bumpWrite(`mut.${cls}.removed`);
                writeCounts[`mut.${cls}.removedNodes`] = (writeCounts[`mut.${cls}.removedNodes`] ?? 0) + record.removedNodes.length;
            }
        }
    });

    mutations.observe(document.documentElement, { childList: true, subtree: true });
}

/**
 * Counts `setProperty`, `removeProperty` and `cssText` writes, split by
 * stylesheet rule or inline style and by whether the write changes anything.
 */
function installDeclarationCounters(): void {
    const declProto = CSSStyleDeclaration.prototype;
    const setProperty = declProto.setProperty;
    const removeProperty = declProto.removeProperty;
    const cssTextDesc = Object.getOwnPropertyDescriptor(declProto, 'cssText');

    declProto.setProperty = function (this: CSSStyleDeclaration, key: string, value: string | null, priority?: string): void {
        if (counting) {
            const same = this.getPropertyValue(key) === (value ?? '');

            bumpWrite(`${this.parentRule ? 'rule' : 'inline'}.setProperty.${same ? 'same' : 'changed'}`);
        }

        setProperty.call(this, key, value, priority);
    };

    declProto.removeProperty = function (this: CSSStyleDeclaration, key: string): string {
        if (counting) {
            const had = this.getPropertyValue(key) !== '';

            bumpWrite(`${this.parentRule ? 'rule' : 'inline'}.removeProperty.${had ? 'changed' : 'same'}`);
        }

        return removeProperty.call(this, key);
    };

    if (cssTextDesc?.set && cssTextDesc.get) {
        const setCssText = cssTextDesc.set;
        const getCssText = cssTextDesc.get;

        Object.defineProperty(declProto, 'cssText', {
            configurable: true,
            enumerable: cssTextDesc.enumerable,
            get: getCssText,
            set(this: CSSStyleDeclaration, value: string): void {
                if (counting) {
                    bumpWrite(`${this.parentRule ? 'rule' : 'inline'}.cssText.${getCssText.call(this) === value ? 'same' : 'changed'}`);
                }

                setCssText.call(this, value);
            },
        });
    }
}

/** Counts stylesheet rule insertions and deletions. */
function installSheetCounters(): void {
    const sheetProto = CSSStyleSheet.prototype;
    const insertRule = sheetProto.insertRule;
    const deleteRule = sheetProto.deleteRule;

    sheetProto.insertRule = function (this: CSSStyleSheet, rule: string, index?: number): number {
        bumpWrite('sheet.insertRule');

        return insertRule.call(this, rule, index);
    };

    sheetProto.deleteRule = function (this: CSSStyleSheet, index: number): void {
        bumpWrite('sheet.deleteRule');
        deleteRule.call(this, index);
    };
}

/** Counts attribute writes and removals; a changed write is attributed to the element's first class. */
function installAttributeCounters(): void {
    const elProto = Element.prototype;
    const setAttribute = elProto.setAttribute;
    const removeAttribute = elProto.removeAttribute;

    elProto.setAttribute = function (this: Element, name: string, value: string): void {
        if (counting) {
            const same = this.getAttribute(name) === value;

            bumpWrite(same ? `attr.${name}.same` : `attr.${name}.changed@${(this.classList && this.classList[0]) || this.nodeName.toLowerCase()}`);
        }

        setAttribute.call(this, name, value);
    };

    elProto.removeAttribute = function (this: Element, name: string): void {
        if (counting) {
            bumpWrite(`attr.${name}.remove.${this.hasAttribute(name) ? 'changed' : 'same'}`);
        }

        removeAttribute.call(this, name);
    };
}

/**
 * The element a token list belongs to, named by the list's own first token —
 * a component's first class is its constructor name.
 *
 * @param list - A class list.
 * @returns The first token, or `?`.
 */
function tokenOwner(list: DOMTokenList): string {
    return (list.value || '').split(' ')[0] || '?';
}

/**
 * Counts class-list `add`, `remove` and `toggle`; a changed add or remove is
 * attributed to its owner and tokens, and a changed `.invisible` add keeps
 * its stack — who toggles a component's visibility mid-phase.
 */
function installClassListCounters(): void {
    const tokenProto = DOMTokenList.prototype;
    const tokenAdd = tokenProto.add;
    const tokenRemove = tokenProto.remove;
    const tokenToggle = tokenProto.toggle;

    tokenProto.add = function (this: DOMTokenList, ...tokens: string[]): void {
        if (counting) {
            const same = tokens.every((t) => this.contains(t));

            bumpWrite(same ? 'classList.add.same' : `classList.add.changed@${tokenOwner(this)}:${tokens.join('+')}`);

            if (!same && tokens.includes('invisible') && (forcedStacks['classList.add.invisible']?.length ?? 0) < INVISIBLE_STACKS) {
                keepStack('classList.add.invisible', formatStack(new Error().stack ?? '', INVISIBLE_STACK_DEPTH), INVISIBLE_STACKS);
            }
        }

        tokenAdd.apply(this, tokens);
    };

    tokenProto.remove = function (this: DOMTokenList, ...tokens: string[]): void {
        if (counting) {
            const changed = tokens.some((t) => this.contains(t));

            bumpWrite(changed ? `classList.remove.changed@${tokenOwner(this)}:${tokens.join('+')}` : 'classList.remove.same');
        }

        tokenRemove.apply(this, tokens);
    };

    tokenProto.toggle = function (this: DOMTokenList, token: string, force?: boolean): boolean {
        if (counting) {
            const has = this.contains(token);
            const want = force ?? !has;

            bumpWrite(`classList.toggle.${has === want ? 'same' : 'changed'}`);
        }

        return tokenToggle.call(this, token, force);
    };
}

/**
 * The camelCase CSS-property accessors on `CSSStyleDeclaration.prototype`.
 *
 * `DOM.writeDeclaration` sends a key containing `-` through `setProperty`, but
 * every other key through direct assignment (`style[key] = value`). The library
 * writes camelCase keys throughout (`clipPath`, `backgroundColor`, `transform`,
 * `contain`), so those writes bypass the `setProperty` / `cssText` hooks
 * entirely. `installDeepStyleCounters` and the `norules` and `nosamewrites`
 * ablations wrap these accessors to close that hole.
 *
 * @returns The object that owns the accessors, and their names.
 */
export function cssAccessorHost(): { host: AnyObj; names: string[] } {
    const skip = new Set(['cssText', 'length', 'parentRule', 'cssFloat']);
    const probe = document.createElement('div').style as unknown as AnyObj;

    // Engines disagree about where CSS-property accessors live: some put them
    // on `CSSStyleDeclaration.prototype`, some on an intermediate
    // (`CSS2Properties`), some on the instance. WebKitGTK reports zero on
    // `CSSStyleDeclaration.prototype`, so find the owner by walking the real
    // chain from an element's own style object and taking the first level that
    // actually owns a known property accessor.
    for (let obj: AnyObj | null = probe; obj; obj = Object.getPrototypeOf(obj) as AnyObj | null) {
        const desc = Object.getOwnPropertyDescriptor(obj, 'clipPath');

        if (!desc?.set || !desc.get || !desc.configurable) {
            continue;
        }

        const names: string[] = [];

        for (const name of Object.getOwnPropertyNames(obj)) {
            if (skip.has(name) || name.includes('-')) {
                continue;
            }

            const d = Object.getOwnPropertyDescriptor(obj, name);

            if (d?.set && d.get && d.configurable) {
                names.push(name);
            }
        }

        return { host: obj, names };
    }

    return { host: CSSStyleDeclaration.prototype as unknown as AnyObj, names: [] };
}

/**
 * Counts direct camelCase style writes, which the `setProperty` / `cssText`
 * hooks cannot see.
 *
 * **Opt-in** (`deepwrites=1`), deliberately: this wraps several hundred
 * accessors, and the added call overhead lands on every style write in the
 * page. Turn it on to read counters; leave it off to read timings.
 *
 * @returns A note saying how many accessors were wrapped.
 */
export function installDeepStyleCounters(): string {
    const { host, names } = cssAccessorHost();

    installed.writes = true;

    for (const name of names) {
        const desc = Object.getOwnPropertyDescriptor(host, name)!;
        const get = desc.get!;
        const set = desc.set!;

        Object.defineProperty(host, name, {
            configurable: true,
            enumerable: desc.enumerable,
            get,
            set(this: CSSStyleDeclaration, value: string): void {
                const same = get.call(this) === value;

                bumpWrite(`${this.parentRule ? 'rule' : 'inline'}.prop.${same ? 'same' : 'changed'}`);
                bumpWrite(`prop@${name}.${same ? 'same' : 'changed'}`);
                set.call(this, value);
            },
        });
    }

    return `deep style counters on ${names.length} accessors`;
}

/**
 * Wraps `method` so every call is tallied as `<label>@<receiver class>`, then
 * delegates to the original. Grouping by the receiver (not the owning
 * prototype) is what makes `doLayout@TabBar` separable from `doLayout@Split`.
 *
 * @param obj - An instance whose chain declares `method`.
 * @param method - The method to count.
 * @param label - The counter's prefix; defaults to `method`.
 * @param root - Wrap the base declaration rather than the nearest override.
 * @returns A note naming the wrapped prototype, or saying none was found.
 */
export function countMethod(obj: object, method: string, label?: string, root: boolean = false): string {
    const proto = root ? rootOwnerProto(obj, method) : ownerProto(obj, method);

    if (!proto) {
        return `NOT FOUND ${method} on ${className(obj)}`;
    }

    const original = proto[method] as (...args: unknown[]) => unknown;
    const tag = label ?? method;

    installed.work = true;

    proto[method] = function (this: AnyObj, ...args: unknown[]): unknown {
        bumpWork(`${tag}@${className(this)}`);

        return original.apply(this, args);
    };

    return `counting ${(proto.constructor as { name?: string })?.name}.${method}`;
}

/** The base `Component` methods every work count covers, wrapped at their base declaration. */
const BASE_WORK_METHODS = ['doLayout', 'scheduleLayout', 'getMinSize', 'getMaxSize', 'getPreferredSize', 'setClipPath'];

/**
 * Installs the `work=1` counters. Runs *after* the ablations, so a count taken
 * under an ablation reflects the ablated code — which is the point: it says
 * whether the ablation removed the work it claims to.
 *
 * @param tools - The harness tools, for the component-tree walk.
 * @returns One note per counter, saying what it wraps or that its target is absent.
 */
export function installWorkCounters(tools: HarnessTools): string[] {
    const any = tools.walkComponents()[0];

    if (!any) {
        return ['no components to count'];
    }

    const notes = BASE_WORK_METHODS.map((method) => countMethod(any, method, method, true));

    return [...notes, ...countGatherWork(tools, any), ...countLayoutWork(tools)];
}

/**
 * Wraps the calls that price a layout pass's gathering: one
 * `sizeHintMiss@<class>` per live size-hint computation — a per-pass memo
 * miss, since a hit returns before re-basing the record — one
 * `getLaidOutComponents@<class>` per child list built, and one
 * `reserveContentFrame@<manager>` per content-frame walk.
 *
 * @param tools - The harness tools, for the layout-manager lookup.
 * @param any - Any live component, for `Component`'s prototype.
 * @returns One note per counter.
 */
function countGatherWork(tools: HarnessTools, any: object): string[] {
    const lm = tools.findLayoutManager('LayoutManager');

    return [
        countMethod(any, 'beginSizeHintRecord', 'sizeHintMiss', true),
        countMethod(any, 'getLaidOutComponents', 'getLaidOutComponents', true),
        lm ? countMethod(lm, 'reserveContentFrame', 'reserveContentFrame', true) : 'no layout manager',
    ];
}

/**
 * Wraps the layout-manager and component methods Loom's campaign counted
 * separately — `Split`, `Accordion`, `TabBar`, `CollapseButton` and
 * `Border` — and `Grid`'s content measure.
 *
 * @param tools - The harness tools, for the component-tree walk.
 * @returns One note per counter.
 */
function countLayoutWork(tools: HarnessTools): string[] {
    const notes: string[] = [];
    const split = tools.findLayoutManager('Split');

    if (split) {
        notes.push(countMethod(split, 'doLayout', 'split.doLayout'));
        notes.push(countMethod(split, 'recalculateSizes', 'split.recalculateSizes'));
    } else {
        notes.push('no Split layout manager');
    }

    const accordion = tools.findLayoutManager('Accordion');

    if (accordion) {
        notes.push(countMethod(accordion, 'openContentHeight', 'accordion.openContentHeight'));
    }

    const tabBar = tools.findComponent('TabBar');

    notes.push(tabBar ? countMethod(tabBar, 'prepareStrip', 'tabbar.prepareStrip') : 'no TabBar component');

    const collapseButton = tools.findComponent('CollapseButton');

    notes.push(collapseButton ? countMethod(collapseButton, 'applyRotation', 'collapse.applyRotation') : 'no CollapseButton component');

    const border = tools.findLayoutManager('Border');

    notes.push(border ? countMethod(border, 'getPreferredSize', 'border.getPreferredSize') : 'no Border layout manager');

    const grid = tools.findLayoutManager('Grid');

    notes.push(grid ? countMethod(grid, 'measureContent', 'measureContent') : 'no Grid layout manager');

    return notes;
}

/**
 * A proxy over a seam object that tallies each method call under the method's
 * name while counting. The real method runs with the real object as `this`,
 * so the object's own field writes and its calls to its own methods bypass
 * the proxy: they are neither redirected nor counted.
 *
 * @param target - The real sink or source.
 * @param family - Which tally the calls go to.
 * @returns The counting proxy.
 */
function countingProxy(target: object, family: 'sink' | 'source'): object {
    const wrappers = new Map<PropertyKey, (...args: unknown[]) => unknown>();

    return new Proxy(target, {
        get(obj: object, key: PropertyKey): unknown {
            const value = Reflect.get(obj, key);

            if (typeof value !== 'function' || key === 'constructor') {
                return value;
            }

            let wrapper = wrappers.get(key);

            if (!wrapper) {
                const name = String(key);

                wrapper = function countedCall(...args: unknown[]): unknown {
                    if (counting) {
                        seamCounts[family][name] = (seamCounts[family][name] ?? 0) + 1;
                    }

                    return (Reflect.get(obj, key) as (...a: unknown[]) => unknown).apply(obj, args);
                };

                wrappers.set(key, wrapper);
            }

            return wrapper;
        },
    });
}

/**
 * Installs counting proxies over `DOM.sink` and `DOM.source` through the
 * library's own seam swap point (`seam=1`). Each call is tallied under its
 * method name — the names the library's recording test sink logs.
 *
 * @param dom - The library's `DOM` swap point.
 * @returns A note saying what was installed.
 */
export function installSeamCounters(dom: HarnessLibrary['DOM']): string {
    installed.seam = true;
    dom.install({ sink: countingProxy(dom.sink, 'sink'), source: countingProxy(dom.source, 'source') });

    return 'seam counters on DOM.sink and DOM.source';
}

/**
 * The platform calls `plat=1` counts: the counter's key, the global whose
 * prototype declares the method — `''` for the global object itself — and the
 * method's name. Each key is a constant here, so no wrapper builds one per
 * call.
 *
 * `Intl.DateTimeFormat` is deliberately absent. ECMA-402 specifies
 * `Date.prototype.toLocale*String` as constructing the intrinsic
 * `%Intl.DateTimeFormat%`, not the global binding, so a wrapper on `Intl`
 * would count zero for every library call; the three `Date.prototype` entries
 * are the only countable proxy for that construction.
 */
const PLATFORM_CALLS: ReadonlyArray<readonly [key: string, global: string, method: string]> = [
    ['date.toLocaleDateString', 'Date', 'toLocaleDateString'],
    ['date.toLocaleTimeString', 'Date', 'toLocaleTimeString'],
    ['date.toLocaleString', 'Date', 'toLocaleString'],
    ['string.localeCompare', 'String', 'localeCompare'],
    ['style.getComputedStyle', '', 'getComputedStyle'],
    ['canvas.measureText', 'CanvasRenderingContext2D', 'measureText'],
];

/**
 * The object one platform call's method lives on.
 *
 * @param global - The global whose prototype declares it, or `''` for the global object.
 * @returns The host, or `undefined` when the engine exposes no such global.
 */
function platformHost(global: string): AnyObj | undefined {
    const globals = globalThis as unknown as AnyObj;

    if (global === '') {
        return globals;
    }

    return (globals[global] as { prototype?: AnyObj } | undefined)?.prototype;
}

/**
 * Replaces `host[method]` with one that tallies `key` and delegates to the
 * original. A bare call such as the library's `getComputedStyle(el)` arrives
 * with no receiver, so the host stands in as `this` — which is what the
 * global object's own functions expect.
 *
 * @param host - The object that owns the method.
 * @param method - The method's name.
 * @param key - The counter's key.
 */
function countPlatformCall(host: AnyObj, method: string, key: string): void {
    const original = host[method] as (...args: unknown[]) => unknown;

    host[method] = function countedPlatformCall(this: unknown, ...args: unknown[]): unknown {
        bumpPlat(key);

        return original.apply(this ?? host, args);
    };
}

/**
 * Installs the platform-call counters (`plat=1`): the three `Date.prototype`
 * locale formatters, `String.prototype.localeCompare`, `getComputedStyle` and
 * the canvas `measureText`. Patching global prototypes is what
 * `installWriteCounters` already does; this is that pattern applied to
 * compute rather than to DOM writes.
 *
 * A target the engine does not expose is skipped rather than thrown on —
 * jsdom has no `CanvasRenderingContext2D` — and the note names it, so a
 * report says which of the six were actually watched.
 *
 * @returns A note naming what was wrapped and what the engine does not expose.
 */
export function installPlatformCounters(): string {
    installed.plat = true;

    const wrapped: string[] = [];
    const absent: string[] = [];

    for (const [key, global, method] of PLATFORM_CALLS) {
        const host = platformHost(global);

        if (host && typeof host[method] === 'function') {
            countPlatformCall(host, method, key);
            wrapped.push(key);
        } else {
            absent.push(global || method);
        }
    }

    const note = `platform counters on ${wrapped.join(', ')}`;

    return absent.length > 0 ? `${note}; not exposed: ${absent.join(', ')}` : note;
}
