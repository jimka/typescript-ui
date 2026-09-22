// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for plans/implemented/text-measurement-without-reflow.md
// — Expected Behaviour TM1–TM16, I1 and I1b.
//
// The modelled source derives both the probe and the canvas advance from one
// baked advance table, so canvas-versus-probe parity is true here by
// construction and proves nothing (the in-engine A/B is that gate). What these
// cases pin is routing: which seam read ran, how many times, with which
// requests, and when a cache clears. A counting source wraps every text
// measurement read — still delegating to the modelled implementation — in the
// style of `TextBatchMeasure.test.ts`'s `installCountingMeasureSource`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import type { ComputedFont, DOMSource, TextAdvanceSpacing } from '~/core/DOM';
import { Util } from '~/core/Util';
import type { TextMeasureOptions, TextMeasureRequest, TextMetrics } from '~/core/Util';
import {
    CALIBRATION_TEXT,
    canvasFontFrom,
    decideSpacing,
    isCanvasText,
    measureManyTextMetrics,
    measureManyTextWidths,
    measureTextMetrics,
    _textMeasureCacheSizes,
} from '~/core/TextMeasure';
import { Text } from '~/component/input/Text';
import { installTestDOM } from '../dom/TestDOM';
import type { ModelledDOMConfig } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG: ModelledDOMConfig = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** The memo's capacity and text-length bound, mirrored from `TextMeasure.ts`. */
const MEMO_MAX_ENTRIES     = 1024;
const MEMO_MAX_TEXT_LENGTH = 256;

/** The font-level caches' capacity, mirrored from `TextMeasure.ts`. */
const FONT_CACHE_MAX_ENTRIES = 256;

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** Every text-measurement read the counting source saw, in call order. */
interface SeamCounter {
    /** Each `measureText` call. */
    text:          Array<{ text: string; options?: TextMeasureOptions }>;
    /** Each `measureTexts` call's request list. */
    batches:       TextMeasureRequest[][];
    /** Each `measureTextWidths` call. */
    widths:        Array<{ texts: string[]; options?: TextMeasureOptions }>;
    /** How many `getComputedFont` calls ran. */
    computedFonts: number;
    /** Each `measureTextAdvance` call. */
    advances:      Array<{ text: string; spacing: TextAdvanceSpacing }>;
    /** The modelled source underneath, for expectations that must not count. */
    model:         DOMSource;
}

/**
 * Wraps the installed source with counting text-measurement reads that still
 * delegate to the modelled implementation.
 *
 * @param advance - Replaces the modelled `measureTextAdvance`, for a case that
 *   needs a canvas that cannot measure or that differs between spacing modes.
 * @returns The counter.
 */
function installCountingSource(advance?: (text: string, font: string, spacing: TextAdvanceSpacing) => number | null): SeamCounter {
    const model = DOM.source;
    const counter: SeamCounter = { text: [], batches: [], widths: [], computedFonts: 0, advances: [], model };

    const wrapped = Object.create(model, {
        measureText: {
            value: (text: string, options?: TextMeasureOptions): TextMetrics => {
                counter.text.push({ text, options });

                return model.measureText(text, options);
            },
        },
        measureTexts: {
            value: (requests: TextMeasureRequest[]): TextMetrics[] => {
                counter.batches.push(requests);

                return model.measureTexts(requests);
            },
        },
        measureTextWidths: {
            value: (texts: string[], options?: TextMeasureOptions): number[] => {
                counter.widths.push({ texts, options });

                return model.measureTextWidths(texts, options);
            },
        },
        getComputedFont: {
            value: (options?: TextMeasureOptions): ComputedFont => {
                counter.computedFonts += 1;

                return model.getComputedFont(options);
            },
        },
        measureTextAdvance: {
            value: (text: string, font: string, spacing: TextAdvanceSpacing): number | null => {
                counter.advances.push({ text, spacing });

                return advance ? advance(text, font, spacing) : model.measureTextAdvance(text, font, spacing);
            },
        },
    });

    DOM.install({ source: wrapped });

    return counter;
}

/**
 * A canvas whose `"run"` and `"words"` advances each differ from the modelled
 * one by a fixed offset. The modelled probe's width is the modelled advance
 * rounded up, so a calibration against it matches a mode only when that
 * mode's offset is 0 — which the modelled canvas, equal in both modes, can
 * never tell apart.
 *
 * @param runSkew - Px added to every `"run"` advance.
 * @param wordsSkew - Px added to every `"words"` advance.
 * @returns A replacement for `measureTextAdvance`, for `installCountingSource`.
 */
function skewedCanvas(runSkew: number, wordsSkew: number): (text: string, font: string, spacing: TextAdvanceSpacing) => number | null {
    const model = DOM.source;

    return (text: string, font: string, spacing: TextAdvanceSpacing): number | null =>
        model.measureTextAdvance(text, font, spacing)! + (spacing === 'run' ? runSkew : wordsSkew);
}

/**
 * The probe calls a counter saw: `measureText` + `measureTexts` + `measureTextWidths`.
 *
 * @param counter - The counter.
 * @returns The number of probe calls.
 */
function probeCalls(counter: SeamCounter): number {
    return counter.text.length + counter.batches.length + counter.widths.length;
}

/**
 * Every text-measurement read a counter saw: the probes, the computed-font
 * reads and the canvas advances.
 *
 * @param counter - The counter.
 * @returns The number of reads.
 */
function seamCalls(counter: SeamCounter): number {
    return probeCalls(counter) + counter.computedFonts + counter.advances.length;
}

/**
 * The texts each `measureTexts` call carried.
 *
 * @param counter - The counter.
 * @returns One list of texts per call.
 */
function batchTexts(counter: SeamCounter): string[][] {
    return counter.batches.map(batch => batch.map(request => request.text));
}

/**
 * A computed font every part of which the canvas reproduces, with overrides.
 *
 * @param overrides - The fields to replace.
 * @returns The computed font.
 */
function computed(overrides: Partial<ComputedFont> = {}): ComputedFont {
    return {
        fontFamily:            '"Manrope Variable", system-ui, sans-serif',
        fontSize:              '14px',
        fontWeight:            '400',
        fontStyle:             'normal',
        fontVariantCaps:       'normal',
        fontStretch:           '100%',
        lineHeight:            '16px',
        letterSpacing:         'normal',
        wordSpacing:           '0px',
        textTransform:         'none',
        fontFeatureSettings:   'normal',
        fontVariationSettings: 'normal',
        fontKerning:           'auto',
        fontVariantLigatures:  'normal',
        fontVariantNumeric:    'normal',
        fontVariantEastAsian:  'normal',
        fontSizeAdjust:        'none',
        textRendering:         'auto',
        ...overrides,
    };
}

/** The shorthand `computed()` gives. */
const BASE_SHORTHAND = 'normal normal 400 normal 14px "Manrope Variable", system-ui, sans-serif';

/** The shorthand the modelled source's default font resolves to under `CONFIG`. */
const MODEL_SHORTHAND = 'normal normal 400 normal 14px system-ui, sans-serif';

/** The whitespace rule's table: each text, and whether it may use the canvas. */
const WHITESPACE_TABLE: Array<[string, boolean]> = [
    ['Ln 12, Col 5', true],
    ['a\u00a0b',     true],
    ['',             true],
    [' Ready',       false],
    ['Ready ',       false],
    ['a  b',         false],
    ['a\tb',         false],
];

describe('TextMeasure — routing', () => {
    it('TM1: the first measurement probes once, carrying its font\'s calibration', () => {
        const counter = installCountingSource();

        const metrics = measureTextMetrics('Hello');

        expect(counter.computedFonts).toBe(1);
        expect(counter.text).toHaveLength(0);
        expect(batchTexts(counter)).toEqual([['Hello', CALIBRATION_TEXT]]);
        expect(counter.advances).toEqual([
            { text: CALIBRATION_TEXT, spacing: 'run' },
            { text: CALIBRATION_TEXT, spacing: 'words' },
        ]);
        expect(metrics).toEqual(counter.model.measureText('Hello'));
    });

    it('TM2: a calibrated font measures a new string on the canvas alone', () => {
        const first   = measureTextMetrics('Hello');
        const counter = installCountingSource();

        const second = measureTextMetrics('World');

        expect(probeCalls(counter)).toBe(0);
        expect(counter.computedFonts).toBe(0);
        expect(counter.advances.map(a => a.text)).toEqual(['World']);
        expect(second).toEqual({
            width:    Math.ceil(counter.model.measureTextAdvance('World', MODEL_SHORTHAND, 'run')!),
            height:   first.height,
            baseline: first.baseline,
        });
    });

    it('TM3: a repeated string is served from the memo with no seam read', () => {
        measureTextMetrics('Hello');
        const world   = measureTextMetrics('World');
        const counter = installCountingSource();

        expect(measureTextMetrics('World')).toBe(world);
        expect(seamCalls(counter)).toBe(0);
    });

    it('TM4: a wrap width probes alone, and a repeat of it is a memo hit', () => {
        measureTextMetrics('Hello');
        const counter = installCountingSource();

        const wrapped = measureTextMetrics('Hello World', { maxWidth: 30 });

        expect(counter.text).toEqual([{ text: 'Hello World', options: { maxWidth: 30 } }]);
        expect(seamCalls(counter)).toBe(1);

        expect(measureTextMetrics('Hello World', { maxWidth: 30 })).toBe(wrapped);
        expect(seamCalls(counter)).toBe(1);
    });

    it('TM5: a text the whitespace rule rejects probes, never the canvas', () => {
        measureTextMetrics('Hello');
        const counter    = installCountingSource();
        const ineligible = WHITESPACE_TABLE.filter(([, canvas]) => !canvas).map(([text]) => text);

        for (const text of ineligible) {
            expect(measureTextMetrics(text)).toEqual(counter.model.measureText(text));
        }

        expect(counter.text.map(call => call.text)).toEqual(ineligible);
        expect(counter.batches).toHaveLength(0);
        expect(counter.advances).toHaveLength(0);
    });

    it('TM9: a <body> typography context the canvas cannot reproduce keeps every measurement on the probe', () => {
        installTestDOM({ ...CONFIG, textContext: { letterSpacing: '1px' } });
        const counter = installCountingSource();

        measureTextMetrics('Hello');
        measureTextMetrics('World');
        measureTextMetrics('Hello', { fontWeight: '600' });
        measureTextMetrics('World', { fontWeight: '600' });

        expect(counter.text.map(call => call.text)).toEqual(['Hello', 'World', 'Hello', 'World']);
        expect(counter.batches).toHaveLength(0);
        expect(counter.advances).toHaveLength(0);
        expect(counter.computedFonts).toBe(2);
    });

    it('TM10: a font the canvas cannot measure probes without a calibration, and stays on the probe', () => {
        const counter = installCountingSource(() => null);

        measureTextMetrics('Hello');

        expect(counter.text.map(call => call.text)).toEqual(['Hello']);
        expect(counter.batches).toHaveLength(0);
        expect(counter.computedFonts).toBe(1);

        measureTextMetrics('World');

        expect(counter.text.map(call => call.text)).toEqual(['Hello', 'World']);
        expect(counter.batches).toHaveLength(0);
        expect(counter.computedFonts).toBe(1);
    });

    it('TM11: invalidating the text metrics drops every cache, so the font re-resolves and re-calibrates', () => {
        measureTextMetrics('Hello');
        measureTextMetrics('World');

        Util.invalidateTextMetricsCache();

        expect(_textMeasureCacheSizes()).toEqual({ fonts: 0, spacing: 0, lines: 0, memo: 0 });

        const counter = installCountingSource();

        measureTextMetrics('World');

        expect(counter.computedFonts).toBe(1);
        expect(batchTexts(counter)).toEqual([['World', CALIBRATION_TEXT]]);
    });

    it('TM12: a memoised string re-measures at the new width once the face changes and the metrics are invalidated', () => {
        const config = { ...CONFIG, fontMetrics: structuredClone(fontMetrics) };

        installTestDOM(config);
        measureTextMetrics('Hello');

        const before = measureTextMetrics('World').width;

        for (const font of Object.values(config.fontMetrics.fonts) as Array<{ advance: Record<string, number> }>) {
            for (const ch of Object.keys(font.advance)) {
                font.advance[ch] *= 2;
            }
        }

        Util.invalidateTextMetricsCache();

        const after = measureTextMetrics('World').width;

        expect(after).toBeGreaterThan(before);
        expect(after).toBe(DOM.source.measureText('World').width);
    });

    it('TM15: a batch probes every probe-bound request and each new font\'s calibration in one call, in request order', () => {
        measureTextMetrics('Hello');
        const counter     = installCountingSource();
        const newFont     = { fontWeight: '600' };
        const wrapOptions = { maxWidth: 30 };

        const results = measureManyTextMetrics([
            { text: 'World' },
            { text: 'Hello', options: newFont },
            { text: 'Wordle', options: newFont },
            { text: 'Hello World', options: wrapOptions },
        ]);

        expect(counter.text).toHaveLength(0);
        expect(counter.batches).toEqual([[
            { text: 'Hello', options: newFont },
            { text: 'Wordle', options: newFont },
            { text: 'Hello World', options: wrapOptions },
            { text: CALIBRATION_TEXT, options: newFont },
        ]]);
        expect(counter.advances.map(a => a.text)).toEqual(['World', CALIBRATION_TEXT, CALIBRATION_TEXT]);
        expect(results).toEqual([
            counter.model.measureText('World'),
            counter.model.measureText('Hello', newFont),
            counter.model.measureText('Wordle', newFont),
            counter.model.measureText('Hello World', wrapOptions),
        ]);
    });

    it('TM15: an empty batch returns an empty list with no seam read', () => {
        const counter = installCountingSource();

        expect(measureManyTextMetrics([])).toEqual([]);
        expect(seamCalls(counter)).toBe(0);
    });
});

describe('TextMeasure — calibration', () => {
    it('TM8: a font whose run advance matches the probe measures later strings as a run', () => {
        const counter = installCountingSource(skewedCanvas(0, 3));

        measureTextMetrics('Hello');

        const world = measureTextMetrics('World');

        expect(counter.advances.slice(2)).toEqual([{ text: 'World', spacing: 'run' }]);
        expect(world.width).toBe(Math.ceil(counter.model.measureTextAdvance('World', MODEL_SHORTHAND, 'run')!));
        expect(probeCalls(counter)).toBe(1);
    });

    it('TM8: a font whose words advance matches the probe measures later strings word by word', () => {
        const counter = installCountingSource(skewedCanvas(-3, 0));

        measureTextMetrics('Hello');

        const world = measureTextMetrics('World');

        expect(counter.advances.slice(2)).toEqual([{ text: 'World', spacing: 'words' }]);
        expect(world.width).toBe(Math.ceil(counter.model.measureTextAdvance('World', MODEL_SHORTHAND, 'words')!));
        expect(probeCalls(counter)).toBe(1);
    });

    it('TM8: a font whose canvas matches the probe in neither mode stays on the probe, uncalibrated, for the generation', () => {
        const counter = installCountingSource(skewedCanvas(2, 3));

        measureTextMetrics('Hello');
        measureTextMetrics('World');
        measureTextMetrics('Hello World');

        expect(batchTexts(counter)).toEqual([['Hello', CALIBRATION_TEXT]]);
        expect(counter.text.map(call => call.text)).toEqual(['World', 'Hello World']);
        expect(counter.advances.map(a => a.text)).toEqual([CALIBRATION_TEXT, CALIBRATION_TEXT]);
        expect(counter.computedFonts).toBe(1);
    });

    it('TM16: a widths calibration decides from the calibration text\'s own probe width', () => {
        const counter = installCountingSource(skewedCanvas(0, 3));
        const texts   = ['Hello', 'World'];

        measureManyTextWidths(texts);

        const widths = measureManyTextWidths(texts);

        expect(counter.widths).toHaveLength(1);
        expect(counter.advances.slice(2)).toEqual([{ text: 'Hello', spacing: 'run' }, { text: 'World', spacing: 'run' }]);
        expect(widths).toEqual(counter.model.measureTextWidths(texts));
    });
});

describe('TextMeasure — widths', () => {
    it('TM16: an uncalibrated font probes every text, then its calibration, and returns only the texts\' widths', () => {
        const counter = installCountingSource();
        const texts   = ['Hello', ' Ready', 'World'];

        const widths = measureManyTextWidths(texts);

        expect(counter.widths).toEqual([{ texts: [...texts, CALIBRATION_TEXT], options: undefined }]);
        expect(widths).toEqual(counter.model.measureTextWidths(texts));
    });

    it('TM16: a calibrated font measures eligible texts on the canvas and probes the rest in one call', () => {
        const texts = ['Hello', ' Ready', 'World'];

        measureManyTextWidths(texts);
        const counter = installCountingSource();

        const widths = measureManyTextWidths(texts);

        expect(counter.widths).toEqual([{ texts: [' Ready'], options: undefined }]);
        expect(counter.advances.map(a => a.text)).toEqual(['Hello', 'World']);
        expect(widths).toEqual(counter.model.measureTextWidths(texts));
    });

    it('TM16: an empty list returns an empty list with no seam read', () => {
        const counter = installCountingSource();

        expect(measureManyTextWidths([])).toEqual([]);
        expect(seamCalls(counter)).toBe(0);
    });
});

describe('TextMeasure — bounds', () => {
    it('TM13: the memo holds 1,024 entries, evicts the oldest on overflow, and never keeps a text over 256 characters', () => {
        for (let i = 0; i <= MEMO_MAX_ENTRIES; i++) {
            measureTextMetrics(`s${i}`);
        }

        expect(_textMeasureCacheSizes().memo).toBe(MEMO_MAX_ENTRIES);

        const counter = installCountingSource();

        measureTextMetrics('s1');
        expect(counter.advances).toHaveLength(0);

        measureTextMetrics('s0');
        expect(counter.advances).toHaveLength(1);

        const longest = 'x'.repeat(MEMO_MAX_TEXT_LENGTH);
        const tooLong = 'x'.repeat(MEMO_MAX_TEXT_LENGTH + 1);

        measureTextMetrics(longest);
        measureTextMetrics(longest);
        expect(counter.advances).toHaveLength(2);

        measureTextMetrics(tooLong);
        measureTextMetrics(tooLong);
        expect(counter.advances).toHaveLength(4);
        expect(probeCalls(counter)).toBe(0);
    });

    it('TM13: a string recalled before the overflow survives it, and the least recently used one goes instead', () => {
        for (let i = 0; i < MEMO_MAX_ENTRIES; i++) {
            measureTextMetrics(`s${i}`);
        }

        // `s0` is the oldest entry until this recall makes it the most
        // recently used, leaving `s1` the least recently used.
        measureTextMetrics('s0');
        measureTextMetrics(`s${MEMO_MAX_ENTRIES}`);

        expect(_textMeasureCacheSizes().memo).toBe(MEMO_MAX_ENTRIES);

        const counter = installCountingSource();

        measureTextMetrics('s0');
        expect(counter.advances).toHaveLength(0);

        measureTextMetrics('s1');
        expect(counter.advances).toHaveLength(1);
    });

    it('TM14: the font caches never pass 256 entries, and results stay those of a fresh measurement', () => {
        for (let size = 1; size <= FONT_CACHE_MAX_ENTRIES + 1; size++) {
            const options = { fontSize: `${size}px` };

            expect(measureTextMetrics('Hello', options)).toEqual(DOM.source.measureText('Hello', options));

            const sizes = _textMeasureCacheSizes();

            expect(sizes.fonts).toBeLessThanOrEqual(FONT_CACHE_MAX_ENTRIES);
            expect(sizes.spacing).toBeLessThanOrEqual(FONT_CACHE_MAX_ENTRIES);
            expect(sizes.lines).toBeLessThanOrEqual(FONT_CACHE_MAX_ENTRIES);
        }

        // The 257th font found the caches full and cleared them.
        expect(_textMeasureCacheSizes().fonts).toBe(1);
    });
});

describe('TextMeasure — pure rules', () => {
    it('TM6: isCanvasText follows the whitespace rule', () => {
        for (const [text, canvas] of WHITESPACE_TABLE) {
            expect(isCanvasText(text), JSON.stringify(text)).toBe(canvas);
        }

        expect(isCanvasText('a\nb')).toBe(false);
        expect(isCanvasText('a\fb')).toBe(false);
        expect(isCanvasText('a\rb')).toBe(false);
    });

    it('TM7: canvasFontFrom builds the canvas shorthand and line key from a computed font', () => {
        expect(canvasFontFrom(computed())).toEqual({ shorthand: BASE_SHORTHAND, lineKey: `${BASE_SHORTHAND}|16px` });
        expect(canvasFontFrom(computed({
            fontStyle: 'italic', fontVariantCaps: 'small-caps', fontWeight: '700', fontStretch: '75%', fontSize: '16px', fontFamily: 'serif',
        }))?.shorthand).toBe('italic small-caps 700 condensed 16px serif');
        expect(canvasFontFrom(computed({ fontStyle: 'oblique' }))?.shorthand).toBe(BASE_SHORTHAND.replace(/^normal/, 'oblique'));
    });

    it('TM7: every stretch percentage the shorthand cannot take maps to its keyword', () => {
        const stretches: Array<[string, string]> = [
            ['50%', 'ultra-condensed'], ['62.5%', 'extra-condensed'], ['75%', 'condensed'],
            ['87.5%', 'semi-condensed'], ['100%', 'normal'], ['112.5%', 'semi-expanded'],
            ['125%', 'expanded'], ['150%', 'extra-expanded'], ['200%', 'ultra-expanded'],
        ];

        for (const [percentage, keyword] of stretches) {
            expect(canvasFontFrom(computed({ fontStretch: percentage }))?.shorthand).toBe(`normal normal 400 ${keyword} 14px "Manrope Variable", system-ui, sans-serif`);
            expect(canvasFontFrom(computed({ fontStretch: keyword }))?.shorthand).toBe(`normal normal 400 ${keyword} 14px "Manrope Variable", system-ui, sans-serif`);
        }
    });

    it('TM7: a part the canvas cannot express gives null', () => {
        expect(canvasFontFrom(computed({ fontStretch: '80%' }))).toBeNull();
        expect(canvasFontFrom(computed({ fontStyle: 'oblique 20deg' }))).toBeNull();
        expect(canvasFontFrom(computed({ fontVariantCaps: 'all-small-caps' }))).toBeNull();
        expect(canvasFontFrom(computed({ fontWeight: 'bold' }))).toBeNull();
        expect(canvasFontFrom(computed({ fontSize: '1em' }))).toBeNull();
        expect(canvasFontFrom(computed({ fontFamily: '' }))).toBeNull();
        expect(canvasFontFrom(computed({ fontFamily: 'var(--x), serif' }))).toBeNull();
    });

    it('TM7: a context property off its canvas-compatible values gives null, and an unimplemented one is compatible', () => {
        const incompatible: Array<Partial<ComputedFont>> = [
            { letterSpacing: '1px' },
            { textTransform: 'uppercase' },
            { fontFeatureSettings: '"tnum"' },
            { textRendering: 'optimizeLegibility' },
        ];

        for (const context of incompatible) {
            expect(canvasFontFrom(computed(context)), JSON.stringify(context)).toBeNull();
        }

        const contextFields: Array<keyof ComputedFont> = [
            'letterSpacing', 'wordSpacing', 'textTransform', 'fontFeatureSettings', 'fontVariationSettings',
            'fontKerning', 'fontVariantLigatures', 'fontVariantNumeric', 'fontVariantEastAsian',
            'fontSizeAdjust', 'textRendering',
        ];

        for (const field of contextFields) {
            expect(canvasFontFrom(computed({ [field]: '' }))?.shorthand, field).toBe(BASE_SHORTHAND);
        }

        expect(canvasFontFrom(computed({ letterSpacing: '0px', wordSpacing: 'normal', fontKerning: 'normal' }))?.shorthand).toBe(BASE_SHORTHAND);
    });

    it('TM7: a normal or unimplemented line height gives no line key', () => {
        expect(canvasFontFrom(computed({ lineHeight: 'normal' }))).toEqual({ shorthand: BASE_SHORTHAND, lineKey: null });
        expect(canvasFontFrom(computed({ lineHeight: '' }))).toEqual({ shorthand: BASE_SHORTHAND, lineKey: null });
    });

    it('TM8: decideSpacing picks the mode whose rounded advance equals the probe width, words on a tie', () => {
        expect(decideSpacing(560, 559.4, 561.2)).toBe('run');
        expect(decideSpacing(562, 559.4, 561.2)).toBe('words');
        expect(decideSpacing(560, 559.4, 559.9)).toBe('words');
        expect(decideSpacing(563, 559.4, 561.2)).toBeNull();
        expect(decideSpacing(560, null, 559.9)).toBe('words');
        expect(decideSpacing(560, 559.4, null)).toBe('run');
        expect(decideSpacing(560, null, null)).toBeNull();
    });
});

describe('TextMeasure — Text integration', () => {
    it('I1: a nowrap Text re-measured after setText makes no probe call and one canvas read', () => {
        const text = new Text('Ln 1, Col 1');

        text.getPreferredSize();

        const counter = installCountingSource();

        text.setText('Ln 2, Col 7');
        text.getPreferredSize();

        expect(probeCalls(counter)).toBe(0);
        expect(counter.advances.map(a => a.text)).toEqual(['Ln 2, Col 7']);
    });

    it('I1b: a wrapping Text given a narrower width probes only the wrap; the natural re-measure is a memo hit', () => {
        const wrapping = new Text(
            'a fairly long line of wrapping text that needs multiple lines',
            { truncate: false, whiteSpace: 'normal' },
        );

        wrapping.getPreferredSize();

        const counter = installCountingSource();

        wrapping.setWidth(40);

        expect(counter.text).toHaveLength(1);
        expect(counter.text[0].options?.maxWidth).toBeDefined();
        expect(seamCalls(counter)).toBe(1);
    });
});
