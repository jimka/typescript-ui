// @vitest-environment jsdom
//
// Behavioural coverage for plans/implemented/text-measurement-without-reflow.md
// — Expected Behaviour P1–P4: the two new production reads,
// `ProductionDOMSource.measureTextAdvance` and `getComputedFont`, against the
// real seam (the `jsdom` pragma keeps `tests/setup/node-setup.ts` from
// installing the modelled DOM). The canvas context, its accepted-font cache
// and the early-measurement flag are module state in `core/DOM.ts`, so every
// case imports the seam from a fresh module graph.
import { describe, it, expect, afterEach, vi } from 'vitest';

/** Width, in px, of every character in the stubbed context's font. */
const STUB_ADVANCE = 7;

/** A font the stubbed context refuses, keeping whatever it held before. */
const BOGUS_FONT = 'normal normal 400 normal 14px bogus';

/** A font the stubbed context accepts. */
const ACCEPTED_FONT = 'normal normal 400 normal 14px serif';

/** Every field a `ComputedFont` carries. */
const COMPUTED_FONT_KEYS = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariantCaps', 'fontStretch', 'lineHeight',
    'letterSpacing', 'wordSpacing', 'textTransform', 'fontFeatureSettings', 'fontVariationSettings',
    'fontKerning', 'fontVariantLigatures', 'fontVariantNumeric', 'fontVariantEastAsian', 'fontSizeAdjust',
    'textRendering',
];

/**
 * A 2D context whose `measureText` is `STUB_ADVANCE` px a character, whose
 * `font` setter ignores any string containing `bogus` (as a real context
 * ignores a font it cannot parse), and which has `fontKerning`.
 *
 * @returns The stub.
 */
function stubContext(): { font: string; fontKerning: string; measureText(text: string): { width: number } } {
    let font = '10px sans-serif';

    return {
        get font(): string {
            return font;
        },
        set font(value: string) {
            if (!value.includes('bogus')) {
                font = value;
            }
        },
        fontKerning: 'auto',
        measureText: (text: string): { width: number } => ({ width: STUB_ADVANCE * text.length }),
    };
}

/**
 * Imports `ProductionDOMSource` from a fresh module graph, so the context
 * cache and the one-shot warning start unset.
 *
 * @returns A new production source.
 */
async function freshSource(): Promise<import('~/core/DOM').ProductionDOMSource> {
    vi.resetModules();

    const { ProductionDOMSource } = await import('~/core/DOM');

    return new ProductionDOMSource();
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    Reflect.deleteProperty(document, 'fonts');
});

describe('ProductionDOMSource.measureTextAdvance', () => {
    it('P1: returns null without a 2D context, and asks for one only once', async () => {
        // Passed through to jsdom's own `getContext`, which implements no 2D
        // context and answers null.
        const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
        const source     = await freshSource();

        expect(source.measureTextAdvance('abc', ACCEPTED_FONT, 'run')).toBeNull();
        expect(source.measureTextAdvance('abc', ACCEPTED_FONT, 'words')).toBeNull();
        expect(source.measureTextAdvance('def', ACCEPTED_FONT, 'run')).toBeNull();
        expect(getContext).toHaveBeenCalledTimes(1);
    });

    it('P2: measures a run whole or word by word, refuses a font the context rejects, and kerns an accepted one', async () => {
        const context = stubContext();

        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);

        const source = await freshSource();

        expect(source.measureTextAdvance('abc def', ACCEPTED_FONT, 'run')).toBe(49);
        expect(source.measureTextAdvance('abc def', ACCEPTED_FONT, 'words')).toBe(49);
        expect(context.fontKerning).toBe('normal');
        expect(source.measureTextAdvance('abc def', BOGUS_FONT, 'run')).toBeNull();

        // A rejected font must not leave the context measuring under it: the
        // accepted font is re-selected before the next read.
        expect(source.measureTextAdvance('abc', ACCEPTED_FONT, 'run')).toBe(21);
        expect(context.font).toBe(ACCEPTED_FONT);
    });

    it('P3: warns once before the startup font settles, sharing the probe\'s one-shot flag', async () => {
        const fonts = { status: 'loaded', ready: Promise.resolve(), addEventListener(): void {}, load: (): Promise<unknown> => Promise.resolve([]) };

        Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stubContext() as unknown as CanvasRenderingContext2D);
        vi.resetModules();

        const { ThemeManager, ModernTheme }        = await import('~/core/Theme');
        const { ProductionDOMSource }              = await import('~/core/DOM');
        const { isFontActivated }                  = await import('~/core/FontActivation');

        ThemeManager.setTheme(ModernTheme);

        expect(isFontActivated()).toBe(false);

        const source = new ProductionDOMSource();

        source.measureTextAdvance('abc', ACCEPTED_FONT, 'run');
        source.measureTextAdvance('abc', ACCEPTED_FONT, 'run');

        expect(warn).toHaveBeenCalledTimes(1);

        source.measureText('probe');

        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('P3: stays silent once the probe has already warned', async () => {
        const fonts = { status: 'loaded', ready: Promise.resolve(), addEventListener(): void {}, load: (): Promise<unknown> => Promise.resolve([]) };

        Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stubContext() as unknown as CanvasRenderingContext2D);
        vi.resetModules();

        const { ThemeManager, ModernTheme } = await import('~/core/Theme');
        const { ProductionDOMSource }       = await import('~/core/DOM');

        ThemeManager.setTheme(ModernTheme);

        const source = new ProductionDOMSource();

        source.measureText('probe');
        source.measureTextAdvance('abc', ACCEPTED_FONT, 'run');

        expect(warn).toHaveBeenCalledTimes(1);
    });
});

describe('ProductionDOMSource.getComputedFont', () => {
    it('P4: returns every ComputedFont field as a string and leaves <body> as it found it', async () => {
        const source   = await freshSource();
        const children = document.body.childNodes.length;

        const font = source.getComputedFont({ fontWeight: 'bold' });

        expect(Object.keys(font).sort()).toEqual([...COMPUTED_FONT_KEYS].sort());

        for (const key of COMPUTED_FONT_KEYS) {
            expect(typeof (font as unknown as Record<string, unknown>)[key], key).toBe('string');
        }

        expect(document.body.childNodes.length).toBe(children);
    });
});
