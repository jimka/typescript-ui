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
}

/**
 * Mints synthetic numeric handles from a private counter and parks a
 * {@link HandleStub} behind each, shared by the recording sink and modelled
 * source so a sink write is visible to a source read. Rebuilt per
 * {@link installTestDOM} call.
 */
class TestHandleTable {
    private readonly _stubs = new Map<Handle, HandleStub>();
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
            tagName:    tag.toUpperCase(),
            id:         '',
            value:      '',
            scrollLeft: 0,
            scrollTop:  0,
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
}

/** The shared table, rebuilt by {@link installTestDOM}. */
let _table = new TestHandleTable();

/**
 * No-op write sink: every structural mutation and batched {@link ElementPatch}
 * is captured in {@link RecordingDOMSink.writes} for assertions; nothing touches
 * a real DOM. Created elements mint a synthetic handle off the shared table.
 */
export class RecordingDOMSink implements DOMSink {
    readonly writes: Array<{ op: string; args: unknown[] }> = [];

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

    appendChild(_parent: Handle, _child: Handle): void {
        this.record('appendChild');
    }

    removeChild(_parent: Handle, _child: Handle): void {
        this.record('removeChild');
    }

    removeElement(_handle: Handle): void {
        this.record('removeElement');
    }

    focus(_handle: Handle, options?: { preventScroll?: boolean }): void {
        this.record('focus', options);
    }

    blur(_handle: Handle): void {
        this.record('blur');
    }

    setValue(handle: Handle, value: string): void {
        this.record('setValue', value);
        _table.stub(handle).value = value;
    }

    setSelectionRange(_handle: Handle, start: number, end: number): void {
        this.record('setSelectionRange', start, end);
    }

    addListener<T extends Event = Event>(_target: Handle, type: string, _handler: (event: T) => void, _options?: boolean | AddEventListenerOptions): void {
        this.record('addListener', type);
    }

    removeListener<T extends Event = Event>(_target: Handle, type: string, _handler: (event: T) => void, _options?: boolean | EventListenerOptions): void {
        this.record('removeListener', type);
    }

    dispatchEvent(_target: Handle, event: Event): void {
        this.record('dispatchEvent', event.type);
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
    }

    insertBefore(_parent: Handle, _node: Handle, _reference: Handle | null): void {
        this.record('insertBefore');
    }

    createDocumentFragment(): Handle {
        this.record('createDocumentFragment');

        return _table.mint('fragment');
    }

    click(_handle: Handle): void {
        this.record('click');
    }

    setSelectedIndex(_handle: Handle, index: number): void {
        this.record('setSelectedIndex', index);
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

    /** Interns a raw target by minting a fresh stub handle off the shared table. */
    intern(_target: EventTarget): Handle {
        return _table.mint('');
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
     * The modelled source has no model for arbitrary non-component elements, so
     * it reports a zero rect. Offline assertions are scoped to component
     * geometry via {@link getViewportRect}.
     */
    getElementRect(_handle: Handle): Rect {
        return makeRect(0, 0, 0, 0);
    }

    measureText(text: string, _options?: TextMeasureOptions): TextMetrics {
        const font  = this.font();
        let   width = 0;

        for (const ch of text) {
            width += font.advance[ch] ?? font.advance[' '] ?? 0;
        }

        return {
            width:    Math.ceil(width),
            height:   Math.ceil(font.ascent + font.descent),
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
     * Committed-geometry tests don't assert native overflow, so the modelled
     * source reports a zeroed metrics box (no scrollable content).
     */
    getScrollMetrics(_handle: Handle): ScrollMetrics {
        return { scrollTop: 0, scrollLeft: 0, scrollWidth: 0, scrollHeight: 0, clientWidth: 0, clientHeight: 0 };
    }

    /** No offset-box model offline; reports zeros. */
    getOffsetSize(_handle: Handle): OffsetSize {
        return { offsetTop: 0, offsetHeight: 0 };
    }

    /** The modelled source never attaches elements to a document. */
    isConnected(_handle: Handle): boolean {
        return false;
    }

    /** Reads the value recorded onto the stub by the recording sink. */
    getValue(handle: Handle): string {
        return _table.stub(handle).value;
    }

    /** No focus model offline; reports nothing focused. */
    getActiveElement(): Handle | null {
        return null;
    }

    /** Modelled media query: never matches; change subscription is a no-op. */
    matchMedia(_query: string): { matches: boolean; addChangeListener(handler: (event: MediaQueryListEvent) => void): void } {
        return { matches: false, addChangeListener: (): void => {} };
    }

    /** No window object offline; no handle is the window. */
    isWindow(_target: Handle | null): boolean {
        return false;
    }

    /** Offline window target — a fresh stub handle for listener registration. */
    getWindow(): Handle {
        return _table.mint('window');
    }

    /** No DOM tree offline; containment is always false. */
    contains(_ancestor: Handle, _node: Handle | null): boolean {
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

    /** No DOM tree offline. */
    getParentElement(_handle: Handle): Handle | null {
        return null;
    }

    /** No DOM tree offline. */
    getParentNode(_handle: Handle): Handle | null {
        return null;
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

    getInlineStyle(_handle: Handle, _key: string): string {
        return '';
    }

    getElementById(_id: string): Handle | null {
        return null;
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

    getSelectedIndex(_handle: Handle): number {
        return -1;
    }

    getSelectedOptionDataset(_handle: Handle, _key: string): string | undefined {
        return undefined;
    }

    getNaturalSize(_handle: Handle): { width: number; height: number } {
        return { width: 0, height: 0 };
    }

    getFiles(_handle: Handle): FileList | null {
        return null;
    }

    hasPointerCapture(_handle: Handle, _pointerId: number): boolean {
        return false;
    }

    elementsFromPoint(_x: number, _y: number): Handle[] {
        return [];
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

    const sink   = new RecordingDOMSink();
    const source = new ModelledDOMSource(config);

    DOM.install({ sink, source });

    return sink;
}
