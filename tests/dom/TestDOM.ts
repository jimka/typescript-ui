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

import { DOM, type DOMSink, type DOMSource, type ElementPatch, type Handle, type PatchBuilder, type Rect, type ScrollMetrics, type OffsetSize } from '~/core/DOM';
import type { Component } from '~/core/Component';
import type { Size } from '~/primitive/Size';
import type { TextMeasureOptions, TextMetrics } from '~/core/Util';

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
    private _focus: Handle | null = null;
    private _next = 1;

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
            styleLeft:      '',
            styleTop:       '',
            styleWidth:     '',
            styleHeight:    '',
            styleTransform: '',
            borderInset:    { top: 0, right: 0, bottom: 0, left: 0 },
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
}

/** The shared table, rebuilt by {@link installTestDOM}. */
let _table = new TestHandleTable();

/** The stable window handle, minted once per {@link installTestDOM}. */
let _windowHandle: Handle = 0 as Handle;

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

    setRuleStyle(_rule: CSSStyleRule, key: string, value: string | null): void {
        this.record('setRuleStyle', key, value);
    }

    ensureStyleRule(selector: string): CSSStyleRule {
        this.record('ensureStyleRule', selector);

        return { selectorText: selector, style: {} } as unknown as CSSStyleRule;
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
        const lineHeight = font.ascent + font.descent;
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
                baseline: Math.round(font.ascent),
            };
        }

        return {
            width:    Math.ceil(width),
            height:   Math.ceil(lineHeight),
            baseline: Math.round(font.ascent),
        };
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
     * scroll offsets. Absent an injected overflow extent, the scroll extent
     * equals the client box (no overflow).
     */
    getScrollMetrics(handle: Handle): ScrollMetrics {
        const stub        = _table.stub(handle);
        const clientWidth  = px(stub.styleWidth);
        const clientHeight = px(stub.styleHeight);

        return {
            scrollTop:    stub.scrollTop,
            scrollLeft:   stub.scrollLeft,
            scrollWidth:  clientWidth,
            scrollHeight: clientHeight,
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

    /** The modelled source never attaches elements to a document. */
    isConnected(_handle: Handle): boolean {
        return false;
    }

    /** Reads the value recorded onto the stub by the recording sink. */
    getValue(handle: Handle): string {
        return _table.stub(handle).value;
    }

    /** Reads the focused handle recorded by the sink's `focus`/`blur`. */
    getActiveElement(): Handle | null {
        return _table.focus();
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

    /** Climbs `node`'s recorded parents looking for `ancestor` (inclusive). */
    contains(ancestor: Handle, node: Handle | null): boolean {
        for (let h: Handle | null = node; h !== null; h = _table.parent(h)) {
            if (h === ancestor) {
                return true;
            }
        }

        return false;
    }

    /** No DOM tree offline; selector queries find nothing. */
    querySelector(_root: Handle, _selector: string): Handle | null {
        return null;
    }

    /** No DOM tree offline; selector queries find nothing. */
    querySelectorAll(_root: Handle, _selector: string): Handle[] {
        return [];
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
     * Offline measurement uses baked fonts with no async swap, so there is no
     * stale fallback to refresh — the callback never fires.
     */
    onFontsReady(_callback: () => void): void {
        // Intentionally inert offline.
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
 * and an intact `stopPropagation`/`preventDefault` so the wrap-and-detect logic
 * in `Event.ts` works unchanged. The same object is delivered to every listener
 * in a dispatch, so a consume-once marker survives across them.
 *
 * @param target - The element handle the event targets.
 * @param type - The event type (e.g. `"click"`).
 * @param init - Optional `clientX`/`clientY`/`key`/`keyCode`/`button`/`detail` fields.
 * @returns The synthetic event.
 */
export function makeEvent(
    target: Handle,
    type: string,
    init?: { clientX?: number; clientY?: number; key?: string; keyCode?: number; button?: number; detail?: unknown }
): Event {
    const sentinel: SentinelTarget = { [SENTINEL_TARGET]: target };

    const event = {
        type,
        target:          sentinel,
        clientX:         init?.clientX,
        clientY:         init?.clientY,
        key:             init?.key,
        keyCode:         init?.keyCode,
        button:          init?.button,
        detail:          init?.detail,
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
