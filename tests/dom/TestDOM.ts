// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Test-only DOM seam implementations: a recording write sink and a modelled
// read source that answers geometry from committed component state (the
// validated geometry oracle) and text metrics from a baked table — no browser
// layout, no `getBoundingClientRect`, no `getComputedStyle`. Not exported from
// the library barrel.

import { DOM, type DOMSink, type DOMSource, type Rect, type ScrollMetrics, type OffsetSize } from '~/core/DOM';
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
 * Minimal stand-in for an `HTMLElement` returned by {@link RecordingDOMSink}.
 * The recorder never reads layout off it; it exists only so the framework's
 * direct (non-sink) property touches during render don't throw.
 */
function makeStubElement(tag: string): HTMLElement {
    const stub = {
        tagName:    tag.toUpperCase(),
        id:         '',
        style:      {} as Record<string, string>,
        isConnected: false,
        scrollLeft: 0,
        scrollTop:  0,
        value:      '',
        setAttribute(): void {},
        removeAttribute(): void {},
        getElementsByTagName(): never[] { return []; },
        remove(): void {},
    };

    return stub as unknown as HTMLElement;
}

/**
 * No-op write sink: every structural mutation and style write is captured in
 * {@link RecordingDOMSink.writes} for assertions; nothing touches a real DOM.
 */
export class RecordingDOMSink implements DOMSink {
    readonly writes: Array<{ op: string; args: unknown[] }> = [];

    private record(op: string, ...args: unknown[]): void {
        this.writes.push({ op, args });
    }

    setStyle(_style: CSSStyleDeclaration, key: string, value: string | null): void {
        this.record('setStyle', key, value);
    }

    createElement(tag: string): HTMLElement {
        this.record('createElement', tag);

        return makeStubElement(tag);
    }

    createElementNS(ns: string, tag: string): Element {
        this.record('createElementNS', ns, tag);

        return makeStubElement(tag);
    }

    appendChild(_parent: Node, _child: Node): void {
        this.record('appendChild');
    }

    removeChild(_parent: Node, _child: Node): void {
        this.record('removeChild');
    }

    removeElement(_element: Element): void {
        this.record('removeElement');
    }

    addClass(_element: Element, name: string): void {
        this.record('addClass', name);
    }

    removeClass(_element: Element, name: string): void {
        this.record('removeClass', name);
    }

    toggleClass(_element: Element, name: string, on?: boolean): void {
        this.record('toggleClass', name, on);
    }

    setAttribute(_element: Element, key: string, value: string): void {
        this.record('setAttribute', key, value);
    }

    removeAttribute(_element: Element, key: string): void {
        this.record('removeAttribute', key);
    }

    setTextContent(_node: Node, text: string): void {
        this.record('setTextContent', text);
    }

    setScrollLeft(element: Element, value: number): void {
        this.record('setScrollLeft', value);
        (element as unknown as { scrollLeft: number }).scrollLeft = value;
    }

    setScrollTop(element: Element, value: number): void {
        this.record('setScrollTop', value);
        (element as unknown as { scrollTop: number }).scrollTop = value;
    }

    focus(_element: HTMLElement, options?: { preventScroll?: boolean }): void {
        this.record('focus', options);
    }

    blur(_element: HTMLElement): void {
        this.record('blur');
    }

    setValue(element: HTMLElement, value: string): void {
        this.record('setValue', value);
        (element as unknown as { value: string }).value = value;
    }

    setSelectionRange(_element: HTMLElement, start: number, end: number): void {
        this.record('setSelectionRange', start, end);
    }

    addListener<T extends Event = Event>(_target: EventTarget, type: string, _handler: (event: T) => void, _options?: boolean | AddEventListenerOptions): void {
        this.record('addListener', type);
    }

    removeListener<T extends Event = Event>(_target: EventTarget, type: string, _handler: (event: T) => void, _options?: boolean | EventListenerOptions): void {
        this.record('removeListener', type);
    }

    dispatchEvent(_target: EventTarget, event: Event): void {
        this.record('dispatchEvent', event.type);
    }
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
    getElementRect(_element: Element): Rect {
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
    getScrollLeft(element: Element): number {
        return (element as unknown as { scrollLeft?: number }).scrollLeft ?? 0;
    }

    /** Reads the scroll offset recorded onto the stub by the recording sink. */
    getScrollTop(element: Element): number {
        return (element as unknown as { scrollTop?: number }).scrollTop ?? 0;
    }

    /**
     * Committed-geometry tests don't assert native overflow, so the modelled
     * source reports a zeroed metrics box (no scrollable content).
     */
    getScrollMetrics(_element: Element): ScrollMetrics {
        return { scrollTop: 0, scrollLeft: 0, scrollWidth: 0, scrollHeight: 0, clientWidth: 0, clientHeight: 0 };
    }

    /** No offset-box model offline; reports zeros. */
    getOffsetSize(_element: Element): OffsetSize {
        return { offsetTop: 0, offsetHeight: 0 };
    }

    /** The modelled source never attaches elements to a document. */
    isConnected(_element: Element): boolean {
        return false;
    }

    /** Reads the value recorded onto the stub by the recording sink. */
    getValue(element: HTMLElement): string {
        return (element as unknown as { value?: string }).value ?? '';
    }

    /** No focus model offline; reports nothing focused. */
    getActiveElement(): Element | null {
        return null;
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
    const sink   = new RecordingDOMSink();
    const source = new ModelledDOMSource(config);

    DOM.install({ sink, source });

    return sink;
}
