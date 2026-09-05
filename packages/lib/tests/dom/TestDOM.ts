// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Test-only DOM seam implementations: a recording write sink and a modelled
// read source that answers geometry from committed component state (the
// validated geometry oracle) and text metrics from a baked table — no browser
// layout, no `getBoundingClientRect`, no `getComputedStyle`. Not exported from
// the library barrel.
//
// Both seams speak opaque numeric `Handle`s, exactly like the production pair.
// The sink mints a synthetic handle from a private counter for every created
// element / interned target and parks a plain stub object behind it; the source
// reads the recorded scroll / value / id state back off that stub. The shared
// `TestHandleTable` is what lets a write through the sink be read by the source.

import { DOM, type DOMSink, type DOMSource, type DocumentSelectionRange, type ElementPatch, type Handle, type TimerId, type PatchBuilder, type Rect, type ScrollMetrics, type OffsetSize, type MediaState } from '~/core/DOM';
import type { Component } from '~/core/Component';
import type { Size } from '~/primitive/Size';
import type { TextMeasureOptions, TextMeasureRequest, TextMetrics } from '~/core/Util';
import { clearBorderWidths } from '~/core/BorderWidths';
import { _resetTextMeasurementRegistry } from '~/component/input/Text';

/**
 * Per-font baked metrics: font ascent/descent/cap-top plus per-character
 * advance widths, all in pixels at the pinned size.
 */
export interface BakedFont {
    ascent:  number;
    descent: number;
    capTop:  number;
    advance: Record<string, number>;
}

/**
 * A baked font-metrics table keyed by `${family}|${size}|${weight}|${style}`,
 * generated once in a real browser by `scripts/gen-font-metrics.mjs` and read
 * back offline by {@link ModelledDOMSource}.
 */
export interface FontMetricsTable {
    fonts: Record<string, BakedFont>;
}

/** Config injected into a {@link ModelledDOMSource}. */
export interface ModelledDOMConfig {
    /** Viewport offset of the root component's mount point (the one root DOM read). */
    rootMountOffset: { x: number; y: number };
    /** The modelled viewport size. */
    viewport: Size;
    /** The modelled native scrollbar width in pixels. */
    scrollBarWidth: number;
    /** The baked font-metrics table. */
    fontMetrics: FontMetricsTable;
    /** Resolved theme CSS variables (`--ts-ui-*` → value). */
    themeVars?: Record<string, string>;
}

/**
 * Plain stub parked behind a test handle. The recorder never reads layout off
 * it; it carries only the scalar state a write records and a read reflects back
 * (id / value / scroll offsets / tag), so handle round-trips behave.
 */
interface HandleStub {
    tagName:    string;
    id:         string;
    value:      string;
    scrollLeft: number;
    scrollTop:  number;
    /** Intrinsic image size, seeded by {@link setNaturalSize} (default 0). */
    naturalWidth:  number;
    naturalHeight: number;
    /**
     * Modelled media playback state, folded by the recording sink's media
     * writes and seeded by {@link setMediaState}, read back by
     * {@link ModelledDOMSource.getMediaState} (which has no live element).
     */
    media: MediaState;
    /**
     * Accumulated geometry-relevant inline-style writes, folded by
     * {@link RecordingDOMSink.apply} and parsed by
     * {@link ModelledDOMSource.getElementRect}. Default `""` (no write recorded).
     */
    styleLeft:      string;
    styleTop:       string;
    styleWidth:     string;
    styleHeight:    string;
    styleTransform: string;
    /**
     * Per-handle border inset for geometry composition, seeded by
     * {@link setBorderInset}. Border is written rule-side and un-attributable per
     * handle offline, so it is an explicit injected input (default `{0,0,0,0}`).
     */
    borderInset: { top: number; right: number; bottom: number; left: number };
    /**
     * Per-handle scroll extent for {@link ModelledDOMSource.getScrollMetrics},
     * seeded by {@link setScrollExtent}. Overflow has no offline derivation
     * (there is no real layout to measure content against the client box), so
     * it is an explicit injected input; `null` (the default) means no
     * overflow was injected and the scroll extent equals the client box.
     */
    scrollExtent: { width: number; height: number } | null;
}

/**
 * Mints synthetic numeric handles from a private counter and parks a
 * {@link HandleStub} behind each, shared by the recording sink and modelled
 * source so a sink write is visible to a source read. Rebuilt per
 * {@link installTestDOM} call.
 */
class TestHandleTable {
    private readonly _stubs = new Map<Handle, HandleStub>();
    private readonly _parents = new Map<Handle, Handle>();
    private readonly _byId = new Map<string, Handle>();
    /** Selector → handle, seeded by {@link setQuerySelectorResult}. There is no selector engine offline. */
    private readonly _bySelector = new Map<string, Handle>();
    private readonly _connected = new Set<Handle>();
    private _focus: Handle | null = null;
    private _next = 1;
    /** The modelled `location.hash`, seeded empty. Shared so a sink write is visible to a source read. */
    private _locationHash = '';
    /** The modelled `location.pathname`, seeded `'/'`. Shared so a sink write is visible to a source read. */
    private _locationPathname = '/';
    /** The modelled `location.search`, seeded empty. Shared so a sink write is visible to a source read. */
    private _locationSearch = '';

    /**
     * Mints a fresh handle for a created element / interned target.
     *
     * @param tag - The element tag name (uppercased onto the stub).
     * @returns The new handle.
     */
    mint(tag: string): Handle {
        const handle = this._next as Handle;

        this._next += 1;
        this._stubs.set(handle, {
            tagName:        tag.toUpperCase(),
            id:             '',
            value:          '',
            scrollLeft:     0,
            scrollTop:      0,
            naturalWidth:   0,
            naturalHeight:  0,
            media:          {
                currentTime:  0,
                duration:     0,
                paused:       true,
                ended:        false,
                volume:       1,
                muted:        false,
                playbackRate: 1,
            },
            styleLeft:      '',
            styleTop:       '',
            styleWidth:     '',
            styleHeight:    '',
            styleTransform: '',
            borderInset:    { top: 0, right: 0, bottom: 0, left: 0 },
            scrollExtent:   null,
        });

        return handle;
    }

    /**
     * Resolves a handle to its stub.
     *
     * @param handle - The handle to resolve.
     * @returns The parked stub.
     */
    stub(handle: Handle): HandleStub {
        const stub = this._stubs.get(handle);

        if (!stub) {
            throw new Error(`TestHandleTable: handle ${handle} is not registered`);
        }

        return stub;
    }

    /** Every handle the table has minted, in mint order. */
    handles(): Handle[] {
        return Array.from(this._stubs.keys());
    }

    /**
     * Records or clears a child's parent pointer in the modelled tree.
     *
     * @param child - The child handle.
     * @param parent - The parent handle, or null to clear.
     */
    setParent(child: Handle, parent: Handle | null): void {
        if (parent === null) {
            this._parents.delete(child);

            return;
        }

        this._parents.set(child, parent);
    }

    /**
     * Returns a handle's recorded parent in the modelled tree.
     *
     * @param handle - The child handle.
     * @returns The parent handle, or null when none was recorded.
     */
    parent(handle: Handle): Handle | null {
        return this._parents.get(handle) ?? null;
    }

    /**
     * Indexes a handle under an id for {@link byId} (called from `setId`).
     *
     * @param handle - The handle to index.
     * @param id - The id to index it under (empty clears nothing).
     */
    indexId(handle: Handle, id: string): void {
        if (id) {
            this._byId.set(id, handle);
        }
    }

    /**
     * Looks up the handle indexed under an id.
     *
     * @param id - The id to resolve.
     * @returns The indexed handle, or null.
     */
    byId(id: string): Handle | null {
        return this._byId.get(id) ?? null;
    }

    /**
     * Records or clears the focused handle.
     *
     * @param handle - The newly-focused handle, or null to clear.
     */
    setFocus(handle: Handle | null): void {
        this._focus = handle;
    }

    /**
     * Returns the focused handle.
     *
     * @returns The focused handle, or null when nothing is focused.
     */
    focus(): Handle | null {
        return this._focus;
    }

    /**
     * Marks a handle connected/disconnected, seeded by {@link setConnected}.
     *
     * @param handle - The handle to mark.
     * @param connected - Whether it should read as connected.
     */
    setConnected(handle: Handle, connected: boolean): void {
        if (connected) {
            this._connected.add(handle);
        } else {
            this._connected.delete(handle);
        }
    }

    /**
     * Reads a handle's connectivity, seeded by {@link setConnected}. Default
     * `false` — unseeded handles read as disconnected (today's behaviour).
     *
     * @param handle - The handle to query.
     * @returns Whether the handle is marked connected.
     */
    isConnected(handle: Handle): boolean {
        return this._connected.has(handle);
    }

    /**
     * Seeds the handle a selector resolves to, read back by
     * {@link ModelledDOMSource.querySelector}.
     *
     * @param selector - The exact selector string the code under test passes.
     * @param handle - The handle that selector should find.
     */
    setSelectorResult(selector: string, handle: Handle): void {
        this._bySelector.set(selector, handle);
    }

    /**
     * Reads the handle seeded for a selector. Default `null` — an unseeded
     * selector matches nothing, which is what every test written before
     * seeding existed relies on.
     *
     * @param selector - The selector to resolve.
     * @returns The seeded handle, or `null`.
     */
    selectorResult(selector: string): Handle | null {
        return this._bySelector.get(selector) ?? null;
    }

    /**
     * Returns the modelled `location.hash`.
     *
     * @returns The current hash, including its leading `"#"`, or `""` when empty.
     */
    locationHash(): string {
        return this._locationHash;
    }

    /**
     * Writes the modelled `location.hash`.
     *
     * @param hash - The new hash, including its leading `"#"`.
     */
    setLocationHash(hash: string): void {
        this._locationHash = hash;
    }

    /**
     * Returns the modelled `location.pathname`.
     *
     * @returns The current path, always starting with `"/"`.
     */
    locationPathname(): string {
        return this._locationPathname;
    }

    /**
     * Writes the modelled `location.pathname`.
     *
     * @param pathname - The new path.
     */
    setLocationPathname(pathname: string): void {
        this._locationPathname = pathname;
    }

    /**
     * Returns the modelled `location.search`.
     *
     * @returns The current search, including its leading `"?"`, or `""` when empty.
     */
    locationSearch(): string {
        return this._locationSearch;
    }

    /**
     * Writes the modelled `location.search`.
     *
     * @param search - The new search, including its leading `"?"`.
     */
    setLocationSearch(search: string): void {
        this._locationSearch = search;
    }
}

/** The shared table, rebuilt by {@link installTestDOM}. */
let _table = new TestHandleTable();

/** The stable window handle, minted once per {@link installTestDOM}. */
let _windowHandle: Handle = 0 as Handle;

/**
 * The handle currently displayed fullscreen, set by
 * {@link RecordingDOMSink.requestFullscreen} / cleared by `exitFullscreen`, read
 * back by {@link ModelledDOMSource.getFullscreenElement}. `null` when nothing is.
 */
let _fullscreenHandle: Handle | null = null;

/**
 * The brand a {@link makeEvent} sentinel carries on its `target`, so the
 * modelled {@link ModelledDOMSource.intern} resolves it straight back to the
 * element handle rather than minting a fresh stub.
 */
const SENTINEL_TARGET = Symbol('TestDOM.sentinelTarget');

/** A plain event target the modelled `intern` maps back to its embedded handle. */
interface SentinelTarget {
    [SENTINEL_TARGET]: Handle;
}

/** Type guard recognising a {@link makeEvent} sentinel target. */
function isSentinelTarget(target: unknown): target is SentinelTarget {
    return typeof target === 'object' && target !== null && SENTINEL_TARGET in target;
}

/**
 * No-op write sink: every structural mutation and batched {@link ElementPatch}
 * is captured in {@link RecordingDOMSink.writes} for assertions; nothing touches
 * a real DOM. Created elements mint a synthetic handle off the shared table.
 */
export class RecordingDOMSink implements DOMSink {
    readonly writes: Array<{ op: string; args: unknown[] }> = [];

    /**
     * Registered listeners, keyed by target handle then event type. The
     * framework registers all its base listeners on the window handle, so in
     * practice this holds one set per type under the window, plus whatever a
     * test registers directly.
     */
    private readonly _listeners = new Map<Handle, Map<string, Set<Function>>>();

    /** Timers scheduled through this sink that have not yet fired. */
    private readonly _timers = new Set<TimerId>();

    private record(op: string, ...args: unknown[]): void {
        this.writes.push({ op, args });
    }

    apply(handle: Handle, patch: ElementPatch): void {
        this.record('apply', handle, patch);

        // Reflect the scalar writes a source read will reflect back, so a
        // round-trip (write scroll/value → read it) behaves like production.
        const stub = _table.stub(handle);

        if (patch.scrollLeft !== undefined) {
            stub.scrollLeft = patch.scrollLeft;
        }

        if (patch.scrollTop !== undefined) {
            stub.scrollTop = patch.scrollTop;
        }

        // Mirrors production fidelity: a real `getElementById` finds an id
        // however it was written (`.id =`, `setAttribute("id", …)`, …), but the
        // modelled `_byId` index only grew through the dedicated `setId` sink
        // call until now — leaving an id set via a generic `setAttr` patch (as
        // `Markdown`'s rendered headings are) unfindable offline.
        if (patch.setAttr?.id !== undefined) {
            _table.indexId(handle, patch.setAttr.id);
        }

        this.foldGeometry(stub, patch);
    }

    /**
     * Folds the latest geometry-relevant inline-style declarations
     * (`left`/`top`/`width`/`height`/`transform`) from a patch onto the stub, so
     * {@link ModelledDOMSource.getElementRect} can parse what was written. A
     * `null` declaration clears the field; last write wins.
     *
     * @param stub - The target handle's stub.
     * @param patch - The applied patch.
     */
    private foldGeometry(stub: HandleStub, patch: ElementPatch): void {
        const style = patch.style;

        if (!style) {
            return;
        }

        const fold = (key: 'left' | 'top' | 'width' | 'height' | 'transform', field:
            'styleLeft' | 'styleTop' | 'styleWidth' | 'styleHeight' | 'styleTransform'): void => {
            if (key in style) {
                stub[field] = style[key] ?? '';
            }
        };

        fold('left', 'styleLeft');
        fold('top', 'styleTop');
        fold('width', 'styleWidth');
        fold('height', 'styleHeight');
        fold('transform', 'styleTransform');
    }

    edit(handle: Handle): PatchBuilder {
        return makeBuilder((patch) => this.apply(handle, patch));
    }

    release(handle: Handle): void {
        this.record('release', handle);
    }

    setRuleStyles(rule: CSSStyleRule, styles: Record<string, string | null>): void {
        this.record('setRuleStyles', (rule as { selectorText?: string }).selectorText ?? '', styles);
    }

    ensureStyleRule(selector: string): CSSStyleRule {
        this.record('ensureStyleRule', selector);

        return { selectorText: selector, style: {} } as unknown as CSSStyleRule;
    }

    deleteStyleRule(selector: string): void {
        this.record('deleteStyleRule', selector);
    }

    ensureKeyframes(name: string, _body: string): void {
        this.record('ensureKeyframes', name);
    }

    createElement(tag: string): Handle {
        this.record('createElement', tag);

        return _table.mint(tag);
    }

    createElementNS(ns: string, tag: string): Handle {
        this.record('createElementNS', ns, tag);

        return _table.mint(tag);
    }

    appendChild(parent: Handle, child: Handle): void {
        this.record('appendChild', parent, child);
        _table.setParent(child, parent);
    }

    removeChild(_parent: Handle, child: Handle): void {
        this.record('removeChild');
        _table.setParent(child, null);
    }

    removeElement(handle: Handle): void {
        this.record('removeElement');
        _table.setParent(handle, null);
    }

    focus(handle: Handle, options?: { preventScroll?: boolean }): void {
        this.record('focus', options);
        _table.setFocus(handle);
    }

    /**
     * Models what the browser does when native `requestSubmit()` fires: records
     * the call, then dispatches a modelled `submit` event at the handle (mirroring
     * {@link dispatchCustomEvent}'s offline modelling of browser event dispatch),
     * so listeners wired via `Event.addListener(..., "submit", ...)` fire offline.
     */
    requestSubmit(handle: Handle): void {
        this.record('requestSubmit');
        this.dispatchEvent(handle, makeEvent(handle, "submit"));
    }

    blur(_handle: Handle): void {
        this.record('blur');
        _table.setFocus(null);
    }

    setValue(handle: Handle, value: string): void {
        this.record('setValue', value);
        _table.stub(handle).value = value;
    }

    setSelectionRange(_handle: Handle, start: number, end: number): void {
        this.record('setSelectionRange', start, end);
    }

    /**
     * Writes the modelled hash and, only when it actually changed, dispatches
     * a modelled `hashchange` at the window handle — mirroring the browser's
     * own "no `hashchange` on a same-value write" behaviour.
     */
    setLocationHash(hash: string): void {
        this.record('setLocationHash', hash);
        this.writeLocationHash(hash);
    }

    /** Same change-detection and dispatch as {@link setLocationHash}; the record differs so tests can tell the two apart. */
    replaceLocationHash(hash: string): void {
        this.record('replaceLocationHash', hash);
        this.writeLocationHash(hash);
    }

    private writeLocationHash(hash: string): void {
        const previous = _table.locationHash();

        _table.setLocationHash(hash);

        if (hash !== previous) {
            this.dispatchEvent(_windowHandle, makeEvent(_windowHandle, 'hashchange'));
        }
    }

    /**
     * Writes the modelled pathname, search, and hash, splitting `url` at its
     * first `"#"` and then its first `"?"` the way a real `pushState` URL
     * splits across `location.pathname` / `location.search` /
     * `location.hash`. Dispatches nothing, mirroring `history.pushState`.
     */
    pushHistoryPath(url: string): void {
        this.record('pushHistoryPath', url);
        this.writeHistoryPath(url);
    }

    /** Same split as {@link pushHistoryPath}; the record differs so tests can tell the two apart. */
    replaceHistoryPath(url: string): void {
        this.record('replaceHistoryPath', url);
        this.writeHistoryPath(url);
    }

    private writeHistoryPath(url: string): void {
        const hashIndex  = url.indexOf('#');
        const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
        const queryIndex = beforeHash.indexOf('?');

        _table.setLocationPathname(queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex));
        _table.setLocationSearch(queryIndex === -1 ? '' : beforeHash.slice(queryIndex));
        _table.setLocationHash(hashIndex === -1 ? '' : url.slice(hashIndex));
    }

    writeClipboardText(text: string): void {
        this.record('writeClipboardText', text);
    }

    clearDocumentSelection(): void {
        this.record('clearDocumentSelection');
    }

    addListener<T extends Event = Event>(target: Handle, type: string, handler: (event: T) => void, _options?: boolean | AddEventListenerOptions): void {
        this.record('addListener', type);

        let byType = this._listeners.get(target);

        if (!byType) {
            byType = new Map<string, Set<Function>>();
            this._listeners.set(target, byType);
        }

        let set = byType.get(type);

        if (!set) {
            set = new Set<Function>();
            byType.set(type, set);
        }

        set.add(handler as Function);
    }

    removeListener<T extends Event = Event>(target: Handle, type: string, handler: (event: T) => void, _options?: boolean | EventListenerOptions): void {
        this.record('removeListener', type);

        this._listeners.get(target)?.get(type)?.delete(handler as Function);
    }

    /**
     * Reproduces what the browser does to reach `baseListener`: resolves the
     * window-handle listeners registered for the event's type and invokes each
     * with the same event object (so consume-once markers survive). It does NOT
     * walk the element tree — `baseListener` does that by reading the source.
     */
    dispatchEvent(_target: Handle, event: Event): void {
        this.record('dispatchEvent', event.type);

        const handlers = this._listeners.get(_windowHandle)?.get(event.type);

        if (!handlers) {
            return;
        }

        for (const handler of Array.from(handlers)) {
            (handler as (event: Event) => void)(event);
        }
    }

    /**
     * Builds a plain sentinel event (via {@link makeEvent}) carrying `init.detail`
     * and routes it through the modelled {@link dispatchEvent}, so the framework's
     * `Event.fireEvent` reaches listeners offline with no native `CustomEvent`.
     */
    dispatchCustomEvent(target: Handle, type: string, init?: CustomEventInit): void {
        this.dispatchEvent(target, makeEvent(target, type, { detail: init?.detail }));
    }

    requestAnimationFrame(_callback: FrameRequestCallback): number {
        this.record('requestAnimationFrame');

        return 0;
    }

    cancelAnimationFrame(handle: number): void {
        this.record('cancelAnimationFrame', handle);
    }

    /**
     * Delegates to the global timer rather than swallowing the callback the way
     * {@link requestAnimationFrame} does, so `vi.useFakeTimers()` and
     * `vi.advanceTimersByTime` keep driving animation fallbacks offline.
     */
    setTimeout(callback: () => void, delayMs: number): TimerId {
        this.record('setTimeout', delayMs);

        const id = setTimeout(() => {
            this._timers.delete(id);
            callback();
        }, delayMs);

        this._timers.add(id);

        return id;
    }

    clearTimeout(id: TimerId): void {
        this.record('clearTimeout', id);
        this._timers.delete(id);
        clearTimeout(id);
    }

    clearAllTimeouts(): void {
        this.record('clearAllTimeouts');

        for (const id of this._timers) {
            clearTimeout(id);
        }

        this._timers.clear();
    }

    setId(handle: Handle, id: string): void {
        this.record('setId', id);
        _table.stub(handle).id = id;
        _table.indexId(handle, id);
    }

    insertBefore(parent: Handle, node: Handle, _reference: Handle | null): void {
        this.record('insertBefore');
        _table.setParent(node, parent);
    }

    createDocumentFragment(): Handle {
        this.record('createDocumentFragment');

        return _table.mint('fragment');
    }

    click(_handle: Handle): void {
        this.record('click');
    }

    setPointerCapture(_handle: Handle, pointerId: number): void {
        this.record('setPointerCapture', pointerId);
    }

    releasePointerCapture(_handle: Handle, pointerId: number): void {
        this.record('releasePointerCapture', pointerId);
    }

    /**
     * A live rendering context cannot be modelled or forwarded across a worker,
     * so the recording sink records the request and returns `null` — the signal
     * that makes a canvas no-op offline.
     */
    getContext(_handle: Handle, contextId: string, _options?: unknown): RenderingContext | null {
        this.record('getContext', contextId);

        return null;
    }

    /**
     * A foreign live widget cannot be modelled or forwarded across a worker, so
     * the recording sink records the request and returns `null` without calling
     * `factory` — the signal that makes a `mountView`-based component (e.g.
     * `CodeEditor`) no-op offline, mirroring {@link getContext}.
     */
    mountView<T>(_handle: Handle, _factory: (parent: HTMLElement) => T): T | null {
        this.record('mountView');

        return null;
    }

    mediaPlay(handle: Handle): void {
        this.record('mediaPlay');
        _table.stub(handle).media.paused = false;
    }

    mediaPause(handle: Handle): void {
        this.record('mediaPause');
        _table.stub(handle).media.paused = true;
    }

    setCurrentTime(handle: Handle, seconds: number): void {
        this.record('setCurrentTime', seconds);
        _table.stub(handle).media.currentTime = seconds;
    }

    setVolume(handle: Handle, value: number): void {
        this.record('setVolume', value);
        _table.stub(handle).media.volume = value;
    }

    setMuted(handle: Handle, muted: boolean): void {
        this.record('setMuted', muted);
        _table.stub(handle).media.muted = muted;
    }

    setPlaybackRate(handle: Handle, rate: number): void {
        this.record('setPlaybackRate', rate);
        _table.stub(handle).media.playbackRate = rate;
    }

    requestFullscreen(handle: Handle): void {
        this.record('requestFullscreen');
        _fullscreenHandle = handle;
    }

    exitFullscreen(): void {
        this.record('exitFullscreen');
        _fullscreenHandle = null;
    }
}

/**
 * Flattens every recorded `setRuleStyles` op into one `{ selector, key, value }`
 * row per declaration, in bag insertion order within recording order. Lets
 * assertions keep their existing per-declaration key/value shape without
 * depending on how many declarations a given sink call batched together.
 *
 * @param sink - The recording sink to read.
 */
export function ruleStyleWrites(
    sink: RecordingDOMSink
): Array<{ selector: string; key: string; value: string | null }> {
    const rows: Array<{ selector: string; key: string; value: string | null }> = [];

    for (const write of sink.writes) {
        if (write.op !== 'setRuleStyles') {
            continue;
        }

        const selector = write.args[0] as string;
        const styles   = write.args[1] as Record<string, string | null>;

        for (const key of Object.keys(styles)) {
            rows.push({ selector, key, value: styles[key] });
        }
    }

    return rows;
}

/**
 * A minimal {@link PatchBuilder} stand-in for the recording sink: accumulates
 * the same patch shape and flushes through the supplied commit. Mirrors the
 * production builder's fields without importing its private class.
 */
function makeBuilder(commit: (patch: ElementPatch) => void): PatchBuilder {
    const patch: {
        style?:    Record<string, string | null>;
        addClass?: string[];
        setAttr?:  Record<string, string>;
        text?:     string;
    } = {};

    const builder = {
        style(key: string, value: string | null) {
            (patch.style ??= {})[key] = value;

            return builder;
        },
        addClass(name: string) {
            (patch.addClass ??= []).push(name);

            return builder;
        },
        attr(key: string, value: string) {
            (patch.setAttr ??= {})[key] = value;

            return builder;
        },
        text(value: string) {
            patch.text = value;

            return builder;
        },
        commit(): void {
            commit(patch);
        },
    };

    return builder as unknown as PatchBuilder;
}

/**
 * Modelled read source: reproduces component geometry from committed layout
 * state (the residual-0 oracle) and resolves text metrics, theme variables, and
 * environment constants from the injected config — no browser required.
 */
export class ModelledDOMSource implements DOMSource {
    private readonly _config: ModelledDOMConfig;

    constructor(config: ModelledDOMConfig) {
        this._config = config;
    }

    /**
     * Interns a raw target. A {@link makeEvent} sentinel resolves straight back
     * to its embedded element handle; any other target mints a fresh stub
     * (today's behaviour, preserved for non-sentinel callers).
     */
    intern(target: EventTarget): Handle {
        if (isSentinelTarget(target)) {
            return target[SENTINEL_TARGET];
        }

        return _table.mint('');
    }

    /**
     * A modelled node is a {@link makeEvent} sentinel target — the offline stand-in
     * for the raw `e.relatedTarget` / `e.target` a guard narrows before `intern`.
     * A plain value (null, string, bare object, number) is not a node.
     */
    isNode(value: unknown): value is EventTarget {
        return isSentinelTarget(value);
    }

    /**
     * Offline, every sentinel target stands for an element handle, so `isElement`
     * matches {@link isNode} — there is no non-element node in the model.
     */
    isElement(value: unknown): value is EventTarget {
        return isSentinelTarget(value);
    }

    /**
     * Mirrors the deleted jsdom-setup `CSS.escape` shim: backslash-quotes any
     * char outside `[a-zA-Z0-9_-]`, leaving framework glyph ids untouched.
     */
    escapeSelector(value: string): string {
        return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
    }

    /** Runs the geometry oracle: walks `getParentComponent()` to the root. */
    getViewportRect(component: Component): Rect {
        let x = 0;
        let y = 0;

        for (let node: Component | null = component; node; node = node.getParentComponent()) {
            const parent = node.getParentComponent();

            if (!parent) {
                x += this._config.rootMountOffset.x;
                y += this._config.rootMountOffset.y;
                break;
            }

            const border = parent.getBorderSize();

            x += border.left + node.getX() + node.getTranslateX() - parent.getScrollLeft();
            y += border.top  + node.getY() + node.getTranslateY() - parent.getScrollTop();
        }

        const { width, height } = this.transposeIfRotated(component);

        return makeRect(x, y, width, height);
    }

    /**
     * Composes a handle's viewport rect from the inline-style writes the sink
     * recorded (`left`/`top`/`width`/`height`/`transform`), climbing the
     * modelled tree and adding each ancestor's local offset + injected border
     * inset, subtracting its recorded scroll, and adding the root mount offset.
     * Sourced entirely from written values, NOT cached component fields, so a
     * cached-but-not-written divergence is observable. A handle with no recorded
     * `width`/`height` write returns the zero rect.
     */
    getElementRect(handle: Handle): Rect {
        const self = localBox(_table.stub(handle));

        if (self.w === 0 && self.h === 0 && _table.stub(handle).styleWidth === '' && _table.stub(handle).styleHeight === '') {
            return makeRect(0, 0, 0, 0);
        }

        let x = self.x;
        let y = self.y;

        for (let parent = _table.parent(handle); parent !== null; parent = _table.parent(parent)) {
            const parentStub = _table.stub(parent);
            const parentBox  = localBox(parentStub);

            x += parentBox.x + parentStub.borderInset.left - parentStub.scrollLeft;
            y += parentBox.y + parentStub.borderInset.top  - parentStub.scrollTop;
        }

        x += this._config.rootMountOffset.x;
        y += this._config.rootMountOffset.y;

        return makeRect(x, y, self.w, self.h);
    }

    measureText(text: string, options?: TextMeasureOptions): TextMetrics {
        const font       = this.font();
        const fontBox    = font.ascent + font.descent;
        const lineHeight = Math.max(fontBox, this.resolveLineHeightPx(options?.lineHeight, fontBox));
        // Mirror production: a line box taller than the font box splits the
        // surplus evenly above and below, which lowers the baseline.
        const baseline   = Math.round((lineHeight - fontBox) / 2 + font.ascent);
        let   width      = 0;

        for (const ch of text) {
            width += font.advance[ch] ?? font.advance[' '] ?? 0;
        }

        // Model soft-wrap when a wrap width is supplied: pack the run into as
        // many equal lines as it takes to fit within maxWidth, so the reported
        // height grows by whole lines. Char-proportional rather than word-aware,
        // which is enough to exercise width-dependent height; callers that pass
        // no maxWidth keep the single-line measurement unchanged.
        const maxWidth = options?.maxWidth;

        if (maxWidth !== undefined && maxWidth > 0 && width > maxWidth) {
            const lines = Math.ceil(width / maxWidth);

            return {
                width:    Math.ceil(maxWidth),
                height:   Math.ceil(lineHeight * lines),
                baseline,
            };
        }

        return {
            width:    Math.ceil(width),
            height:   Math.ceil(lineHeight),
            baseline,
        };
    }

    measureTextWidths(texts: string[], options?: TextMeasureOptions): number[] {
        return texts.map(t => this.measureText(t, options).width);
    }

    measureTexts(requests: TextMeasureRequest[]): TextMetrics[] {
        return requests.map(r => this.measureText(r.text, r.options));
    }

    /**
     * Resolves a CSS `line-height` value to a pixel number for the modelled
     * measurement path, falling back to the font box when the value is
     * absent or not a bare pixel/unitless number (e.g. `normal`,
     * `calc(...)`) — the model does not evaluate CSS expressions.
     */
    private resolveLineHeightPx(lineHeight: string | undefined, fontBox: number): number {
        if (lineHeight === undefined) {
            return fontBox;
        }

        const px = parseFloat(lineHeight);

        return isNaN(px) ? fontBox : px;
    }

    resolveFontSizePx(fontSizeCSS: string): number {
        const px = parseFloat(fontSizeCSS);

        return isNaN(px) ? 14 : px;
    }

    measureFontMetrics(): { ascent: number; descent: number; capTop: number } {
        const font = this.font();

        return { ascent: font.ascent, descent: font.descent, capTop: font.capTop };
    }

    getThemeVar(name: string): string {
        return this._config.themeVars?.[name] ?? '';
    }

    getViewportSize(): Size {
        return this._config.viewport;
    }

    getScrollBarWidth(): number {
        return this._config.scrollBarWidth;
    }

    /** Deterministic dpr 1 offline, so backing-store math needs no real display. */
    getDevicePixelRatio(): number {
        return 1;
    }

    isModelled(): boolean {
        return true;
    }

    /** Reads the scroll offset recorded onto the stub by the recording sink. */
    getScrollLeft(handle: Handle): number {
        return _table.stub(handle).scrollLeft;
    }

    /** Reads the scroll offset recorded onto the stub by the recording sink. */
    getScrollTop(handle: Handle): number {
        return _table.stub(handle).scrollTop;
    }

    /**
     * Reports the handle's written client box (`width`/`height`) and recorded
     * scroll offsets. The scroll extent is the injected {@link setScrollExtent}
     * value when seeded, else equals the client box (no overflow).
     */
    getScrollMetrics(handle: Handle): ScrollMetrics {
        const stub        = _table.stub(handle);
        const clientWidth  = px(stub.styleWidth);
        const clientHeight = px(stub.styleHeight);

        return {
            scrollTop:    stub.scrollTop,
            scrollLeft:   stub.scrollLeft,
            scrollWidth:  stub.scrollExtent?.width  ?? clientWidth,
            scrollHeight: stub.scrollExtent?.height ?? clientHeight,
            clientWidth,
            clientHeight,
        };
    }

    /**
     * Reports the handle's offset-box top edge (its recorded `top` write,
     * relative to its offset parent in the modelled tree) and its recorded
     * `height` write.
     */
    getOffsetSize(handle: Handle): OffsetSize {
        const stub = _table.stub(handle);

        return { offsetTop: px(stub.styleTop), offsetHeight: px(stub.styleHeight) };
    }

    /** Reads the connectivity seeded by {@link setConnected} (default `false`). */
    isConnected(handle: Handle): boolean {
        return _table.isConnected(handle);
    }

    /** Reads the value recorded onto the stub by the recording sink. */
    getValue(handle: Handle): string {
        return _table.stub(handle).value;
    }

    /** Reads the focused handle recorded by the sink's `focus`/`blur`. */
    getActiveElement(): Handle | null {
        return _table.focus();
    }

    /** No live Selection offline; always reports nothing selected. */
    getDocumentSelection(): DocumentSelectionRange | null {
        return null;
    }

    /** No system clipboard offline; always reports the read as unavailable. */
    readClipboardText(): Promise<string | null> {
        return Promise.resolve(null);
    }

    /** Modelled media query: never matches; change subscription is a no-op. */
    matchMedia(_query: string): { matches: boolean; addChangeListener(handler: (event: MediaQueryListEvent) => void): void } {
        return { matches: false, addChangeListener: (): void => {} };
    }

    /** No window object offline; no handle is the window. */
    isWindow(_target: Handle | null): boolean {
        return false;
    }

    /**
     * The stable window handle minted once per {@link installTestDOM}, so the
     * listener `installBaseListener` registers and the lookup `dispatchEvent`
     * performs agree on one window handle.
     */
    getWindow(): Handle {
        return _windowHandle;
    }

    /** Reads the modelled hash written by {@link RecordingDOMSink.setLocationHash} / `replaceLocationHash`. */
    getLocationHash(): string {
        return _table.locationHash();
    }

    /** Reads the modelled pathname written by {@link RecordingDOMSink.pushHistoryPath} / `replaceHistoryPath`. */
    getLocationPathname(): string {
        return _table.locationPathname();
    }

    /** Reads the modelled search written by {@link RecordingDOMSink.pushHistoryPath} / `replaceHistoryPath`. */
    getLocationSearch(): string {
        return _table.locationSearch();
    }

    /** Climbs `node`'s recorded parents looking for `ancestor` (inclusive). */
    contains(ancestor: Handle, node: Handle | null): boolean {
        for (let h: Handle | null = node; h !== null; h = _table.parent(h)) {
            if (h === ancestor) {
                return true;
            }
        }

        return false;
    }

    /**
     * No selector engine offline: a selector resolves only to the handle a
     * test seeded for it with {@link setQuerySelectorResult}, and `null`
     * otherwise. `root` is ignored — the seeding is global, not scoped to a
     * subtree.
     */
    querySelector(_root: Handle, selector: string): Handle | null {
        return _table.selectorResult(selector);
    }

    /** No DOM tree offline; selector queries find nothing. */
    querySelectorAll(_root: Handle, _selector: string): Handle[] {
        return [];
    }

    /** No selector engine offline; nothing to count. */
    countElements(): number {
        return 0;
    }

    /** No live stylesheet offline; nothing to read. */
    getRuleCssText(_rule: CSSStyleRule): string {
        return '';
    }

    /** No selector engine offline; no element matches. */
    matches(_handle: Handle, _selector: string): boolean {
        return false;
    }

    /** Returns the handle's recorded parent in the modelled tree. */
    getParentElement(handle: Handle): Handle | null {
        return _table.parent(handle);
    }

    /** Returns the handle's recorded parent in the modelled tree. */
    getParentNode(handle: Handle): Handle | null {
        return _table.parent(handle);
    }

    /** No DOM tree offline. */
    getFirstChild(_handle: Handle): Handle | null {
        return null;
    }

    /** No computed border offline; reports zero widths. */
    getBorderWidths(_handle: Handle): { top: string; right: string; bottom: string; left: string } {
        return { top: '0px', right: '0px', bottom: '0px', left: '0px' };
    }

    /** No computed overflow offline; reports visible. */
    getComputedOverflow(_handle: Handle): { overflow: string; overflowX: string; overflowY: string } {
        return { overflow: 'visible', overflowX: 'visible', overflowY: 'visible' };
    }

    /** Offline document root — a fresh stub handle for overlay mounting. */
    getDocumentElement(): Handle {
        return _table.mint('html');
    }

    /** Offline body — a fresh stub handle. */
    getBody(): Handle {
        return _table.mint('body');
    }

    /** Offline head — a fresh stub handle. */
    getHead(): Handle {
        return _table.mint('head');
    }

    /**
     * Offline measurement uses baked fonts with no async swap, so no batch of
     * font loads ever settles and there is no stale fallback to refresh — the
     * callback never fires.
     */
    onFontsReady(_callback: () => void): void {
        // Intentionally inert offline.
    }

    /**
     * Offline measurement uses baked fonts that are always present, so there is
     * nothing to fetch and no activation to wait for. Reporting `false` is what
     * keeps the startup layout gate from ever being armed offline: nothing here
     * would release it, and every test that drives frames by hand would stall.
     */
    startFontLoad(_family: string): boolean {
        return false;
    }

    getInlineStyle(_handle: Handle, _key: string): string {
        return '';
    }

    getElementById(id: string): Handle | null {
        return _table.byId(id);
    }

    getId(handle: Handle): string {
        return _table.stub(handle).id;
    }

    getDataset(_handle: Handle, _key: string): string | undefined {
        return undefined;
    }

    getTagName(handle: Handle): string {
        return _table.stub(handle).tagName;
    }

    hasAttribute(_handle: Handle, _key: string): boolean {
        return false;
    }

    getAttribute(_handle: Handle, _key: string): string | null {
        return null;
    }

    /** Reads the intrinsic size seeded by {@link setNaturalSize} (default 0). */
    getNaturalSize(handle: Handle): { width: number; height: number } {
        const stub = _table.stub(handle);

        return { width: stub.naturalWidth, height: stub.naturalHeight };
    }

    /**
     * Reads the modelled media state folded by the recording sink's media writes
     * and seeded by {@link setMediaState}. Returns a copy so a caller cannot
     * mutate the stub through the snapshot.
     */
    getMediaState(handle: Handle): MediaState {
        return { ..._table.stub(handle).media };
    }

    /** Returns the handle last passed to `requestFullscreen`, or `null`. */
    getFullscreenElement(): Handle | null {
        return _fullscreenHandle;
    }

    getFiles(_handle: Handle): FileList | null {
        return null;
    }

    hasPointerCapture(_handle: Handle, _pointerId: number): boolean {
        return false;
    }

    /**
     * Returns the stack of handles whose written-rect contains `(x, y)`,
     * topmost first. With no z-index model, paint order is DOM order: a
     * descendant paints over its ancestor (deeper tree depth = topmost), and a
     * later sibling over an earlier one (later mint order = topmost).
     */
    elementsFromPoint(x: number, y: number): Handle[] {
        const hits = _table.handles().filter((handle) => {
            const rect = this.getElementRect(handle);

            if (rect.width === 0 && rect.height === 0) {
                return false;
            }

            return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
        });

        hits.sort((a, b) => {
            const depthDelta = this.treeDepth(b) - this.treeDepth(a);

            // Tie-break by mint order: a later-minted (later-appended) sibling
            // paints on top, so it sorts first.

            return depthDelta !== 0 ? depthDelta : (b as number) - (a as number);
        });

        return hits;
    }

    /** Counts a handle's ancestors in the modelled tree (0 at the root). */
    private treeDepth(handle: Handle): number {
        let depth = 0;

        for (let parent = _table.parent(handle); parent !== null; parent = _table.parent(parent)) {
            depth += 1;
        }

        return depth;
    }

    /**
     * Resolves the baked font entry for the active theme font, falling back to
     * the sole entry when the table holds exactly one font.
     */
    private font(): BakedFont {
        const family = this.getThemeVar('--ts-ui-font-family');
        const size   = this.getThemeVar('--ts-ui-font-size');
        const key    = `${family}|${size}|normal|normal`;
        const exact  = this._config.fontMetrics.fonts[key];

        if (exact) {
            return exact;
        }

        const entries = Object.values(this._config.fontMetrics.fonts);

        if (entries.length === 1) {
            return entries[0];
        }

        throw new Error(`ModelledDOMSource: no baked font for "${key}"`);
    }

    /** Swaps width/height for a vertical writing-mode (rotated) box. */
    private transposeIfRotated(component: Component): { width: number; height: number } {
        const writingMode = component.getWritingMode();
        const vertical    = writingMode != null && writingMode.startsWith('vertical');
        const width       = component.getWidth();
        const height      = component.getHeight();

        return vertical ? { width: height, height: width } : { width, height };
    }
}

/** Parses a recorded `"<n>px"` write to a number, defaulting to 0. */
function px(value: string): number {
    const n = parseFloat(value);

    return isNaN(n) ? 0 : n;
}

/**
 * Parses a recorded `transform` write to its translate offset. Accepts the 3D
 * form `setTranslate` writes (`translate3d(<x>px,<y>px,0)`) and a plain
 * `translate(<x>px,<y>px)`; any other value is `[0, 0]`.
 *
 * @param transform - The recorded `transform` style write.
 * @returns The `[x, y]` translate offset in pixels.
 */
function parseTranslate(transform: string): [number, number] {
    const match = /translate(?:3d)?\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/.exec(transform);

    if (!match) {
        return [0, 0];
    }

    return [parseFloat(match[1]), parseFloat(match[2])];
}

/** The local box (position + size) parsed from a stub's recorded writes. */
function localBox(stub: HandleStub): { x: number; y: number; w: number; h: number } {
    const [tx, ty] = parseTranslate(stub.styleTransform);

    return {
        x: px(stub.styleLeft) + tx,
        y: px(stub.styleTop) + ty,
        w: px(stub.styleWidth),
        h: px(stub.styleHeight),
    };
}

/** Builds a {@link Rect} with the `DOMRect`-style derived edges filled in. */
function makeRect(x: number, y: number, width: number, height: number): Rect {
    return {
        x, y, width, height,
        top:    y,
        left:   x,
        right:  x + width,
        bottom: y + height,
    };
}

/**
 * Installs a fresh {@link RecordingDOMSink} and a {@link ModelledDOMSource} for
 * the given config, returning the sink so a test can assert recorded writes.
 * Pair with `DOM.reset()` in teardown.
 *
 * @param config - The modelled-source configuration.
 * @returns The installed recording sink.
 */
export function installTestDOM(config: ModelledDOMConfig): RecordingDOMSink {
    _table = new TestHandleTable();
    _windowHandle = _table.mint('window');
    _fullscreenHandle = null;

    // Drop any border-width measurements shared from a previously installed
    // source, so a test file's cases cannot inherit widths measured against it.
    clearBorderWidths();

    // Drop any Text instances registered by a previously installed source, so
    // one test file's cases cannot drag a previous case's Text into a batch.
    _resetTextMeasurementRegistry();

    const sink   = new RecordingDOMSink();
    const source = new ModelledDOMSource(config);

    DOM.install({ sink, source });

    return sink;
}

/**
 * Builds a synthetic event whose `target` resolves through the modelled
 * {@link ModelledDOMSource.intern} straight back to `target`, so the framework's
 * `baseListener` routes it to the right component. A plain sentinel object
 * (not a jsdom `Event`) carries the type, optional coordinate/key/button fields,
 * and an intact `stopPropagation`/`preventDefault` so `applyDisposition` in
 * `Event.ts` can call them when a listener's returned disposition asks for it.
 * The same object is delivered to every listener in a dispatch, so a
 * consume-once marker survives across them.
 *
 * @param target - The element handle the event targets.
 * @param type - The event type (e.g. `"click"`).
 * @param init - Optional `clientX`/`clientY`/`key`/`keyCode`/`button`/`buttons`/
 * `deltaX`/`deltaY`/`detail`/`code`/modifier-key/`relatedTarget`/`pointerId` fields.
 * `relatedTarget`, when given, is wrapped in the same sentinel `target` uses,
 * so `DOM.source.isNode` / `.intern` resolve it back to that handle exactly
 * like `target` (see `ModelledDOMSource.isNode`'s doc comment).
 * @returns The synthetic event.
 */
export function makeEvent(
    target: Handle,
    type: string,
    init?: {
        clientX?: number; clientY?: number; key?: string; keyCode?: number; button?: number; buttons?: number;
        deltaX?: number; deltaY?: number; detail?: unknown; code?: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean;
        metaKey?: boolean; relatedTarget?: Handle; pointerId?: number;
    }
): Event {
    const sentinel: SentinelTarget = { [SENTINEL_TARGET]: target };
    const relatedTargetSentinel: SentinelTarget | undefined =
        init?.relatedTarget !== undefined ? { [SENTINEL_TARGET]: init.relatedTarget } : undefined;

    const event = {
        type,
        target:          sentinel,
        relatedTarget:   relatedTargetSentinel,
        pointerId:       init?.pointerId,
        clientX:         init?.clientX,
        clientY:         init?.clientY,
        key:             init?.key,
        keyCode:         init?.keyCode,
        button:          init?.button,
        buttons:         init?.buttons,
        deltaX:          init?.deltaX,
        deltaY:          init?.deltaY,
        detail:          init?.detail,
        code:            init?.code,
        ctrlKey:         init?.ctrlKey ?? false,
        altKey:          init?.altKey ?? false,
        shiftKey:        init?.shiftKey ?? false,
        metaKey:         init?.metaKey ?? false,
        stopPropagation: function (): void {},
        preventDefault:  function (): void {},
    };

    return event as unknown as Event;
}

/**
 * Seeds a handle's intrinsic image size, read back by
 * {@link ModelledDOMSource.getNaturalSize} (which has no geometric derivation).
 *
 * @param handle - The image element handle.
 * @param width - The intrinsic width in pixels.
 * @param height - The intrinsic height in pixels.
 */
export function setNaturalSize(handle: Handle, width: number, height: number): void {
    const stub = _table.stub(handle);

    stub.naturalWidth  = width;
    stub.naturalHeight = height;
}

/**
 * Seeds a handle's connectivity, read back by
 * {@link ModelledDOMSource.isConnected} (which has no live document to check
 * against). Default `false` — a handle is disconnected until marked otherwise.
 *
 * @param handle - The element handle.
 * @param connected - Whether it should read as connected.
 */
export function setConnected(handle: Handle, connected: boolean): void {
    _table.setConnected(handle, connected);
}

/**
 * Seeds the handle a selector resolves to, read back by
 * {@link ModelledDOMSource.querySelector}. Offline there is no selector
 * engine, so a lookup finds an element only when a test has declared the
 * match; an unseeded selector still returns `null`.
 *
 * @param selector - The exact selector string the code under test passes.
 * @param handle - The handle that selector should find.
 */
export function setQuerySelectorResult(selector: string, handle: Handle): void {
    _table.setSelectorResult(selector, handle);
}

/**
 * Seeds a handle's modelled media state, read back by
 * {@link ModelledDOMSource.getMediaState}. Merges over the current state, so a
 * test can set only the fields it cares about (e.g. `{ duration: 120 }`).
 *
 * @param handle - The media element handle.
 * @param state - The media-state fields to override.
 */
export function setMediaState(handle: Handle, state: Partial<MediaState>): void {
    const stub = _table.stub(handle);

    stub.media = { ...stub.media, ...state };
}

/**
 * Seeds a handle's border inset for geometry composition. Border width is
 * written rule-side (keyed by the `CSSStyleRule` object, not the handle), so it
 * is un-attributable per handle offline — composition reads this injected inset
 * instead of a cached component field. Only tests with bordered parents need it
 * (default `{0,0,0,0}`).
 *
 * @param handle - The element handle.
 * @param insets - The four-sided border inset in pixels.
 */
export function setBorderInset(
    handle: Handle,
    insets: { top: number; right: number; bottom: number; left: number }
): void {
    _table.stub(handle).borderInset = insets;
}

/**
 * Seeds a handle's scroll extent, read back by
 * {@link ModelledDOMSource.getScrollMetrics} as `scrollWidth`/`scrollHeight`.
 * There is no real layout offline to measure overflowing content against the
 * client box, so overflow is an explicit injected input (default: no
 * overflow, the scroll extent equals the client box).
 *
 * @param handle - The scrollable element handle.
 * @param extent - The scroll extent in pixels.
 */
export function setScrollExtent(handle: Handle, extent: { width: number; height: number }): void {
    _table.stub(handle).scrollExtent = extent;
}
