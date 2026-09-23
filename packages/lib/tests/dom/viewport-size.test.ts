// @vitest-environment jsdom
//
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Coverage for `ProductionDOMSource.getViewportSize` against the REAL
// production source (the `jsdom` pragma keeps `tests/setup/node-setup.ts` from
// installing the modelled DOM, mirroring `tests/dom/countElements.test.ts`) —
// plans/implemented/environment-read-caching.md, Expected Behaviour rows
// V1-V3.
//
// The point of the rows is the read that does NOT happen: the root element's
// client size forces a document layout in a browser, and the window's inner
// size does not, so the root is read only where the window reports 0. jsdom
// lays nothing out, so the reads are counted instead — `clientWidth` and
// `clientHeight` are shadowed on `document.documentElement` by counting
// getters, whose originals live on `Element.prototype`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';

/** How many times each shadowed root-client property was read. */
interface RootClientReads {
    width:  number;
    height: number;
}

describe('ProductionDOMSource.getViewportSize', () => {
    let innerWidthDescriptor:  PropertyDescriptor | undefined;
    let innerHeightDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
        innerWidthDescriptor  = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        innerHeightDescriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    });

    afterEach(() => {
        restoreWindowSize('innerWidth', innerWidthDescriptor);
        restoreWindowSize('innerHeight', innerHeightDescriptor);

        delete (document.documentElement as unknown as Record<string, unknown>).clientWidth;
        delete (document.documentElement as unknown as Record<string, unknown>).clientHeight;
    });

    /**
     * Puts one of `window`'s size properties back the way jsdom had it.
     *
     * @param name - The property name.
     * @param descriptor - The saved descriptor, or `undefined` when the
     * property was inherited rather than owned.
     */
    function restoreWindowSize(name: 'innerWidth' | 'innerHeight', descriptor: PropertyDescriptor | undefined): void {
        if (descriptor) {
            Object.defineProperty(window, name, descriptor);

            return;
        }

        delete (window as unknown as Record<string, unknown>)[name];
    }

    /**
     * Models a window inner size, which in a browser is read without laying
     * anything out.
     *
     * @param width - The reported `innerWidth`.
     * @param height - The reported `innerHeight`.
     */
    function setWindowInnerSize(width: number, height: number): void {
        Object.defineProperty(window, 'innerWidth',  { configurable: true, value: width });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    }

    /**
     * Shadows the root element's client size with counting getters, so a case
     * can assert how many layout-forcing reads the source still takes.
     *
     * @param width - The value `clientWidth` reports.
     * @param height - The value `clientHeight` reports.
     *
     * @returns The per-property read counts, incremented in place.
     */
    function countRootClientReads(width: number, height: number): RootClientReads {
        const reads: RootClientReads = { width: 0, height: 0 };

        Object.defineProperty(document.documentElement, 'clientWidth', {
            configurable: true,
            get: (): number => {
                reads.width++;

                return width;
            },
        });
        Object.defineProperty(document.documentElement, 'clientHeight', {
            configurable: true,
            get: (): number => {
                reads.height++;

                return height;
            },
        });

        return reads;
    }

    it('V1: reads the window inner size and never touches the root', () => {
        setWindowInnerSize(1280, 800);

        const reads = countRootClientReads(1265, 785);

        expect(DOM.source.getViewportSize()).toEqual({ width: 1280, height: 800 });
        expect(reads).toEqual({ width: 0, height: 0 });
    });

    it('V2: falls back to the root client size when the window reports 0 on both axes', () => {
        setWindowInnerSize(0, 0);

        const reads = countRootClientReads(1265, 785);

        expect(DOM.source.getViewportSize()).toEqual({ width: 1265, height: 785 });
        expect(reads).toEqual({ width: 1, height: 1 });
    });

    it('V3: falls back per axis, so only the zero axis reads the root', () => {
        setWindowInnerSize(1280, 0);

        const reads = countRootClientReads(1265, 785);

        expect(DOM.source.getViewportSize()).toEqual({ width: 1280, height: 785 });
        expect(reads).toEqual({ width: 0, height: 1 });
    });
});
