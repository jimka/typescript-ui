import { describe, it, expect, vi, afterEach } from 'vitest';
import { temporalDisplayText } from '~/data/temporalText';
import type { TemporalFieldType } from '~/data/temporalText';

const D = new Date(2021, 4, 17, 14, 30, 20);

/**
 * A second sample whose month, day and hour are every one of them single-digit.
 * `D`'s day (17) and hour (14) are two-digit already and only its month (5) is
 * not, so `D` alone cannot tell `'numeric'` from `'2-digit'` for the day or the
 * hour — an option set that slipped on either would format `D` exactly as the
 * call it replaced. Its minute (8) and second (7) are single-digit too, but
 * pinning those is beyond any sample: ICU pads a minute and a second inside a
 * time pattern whichever of the two the option names, so the day and the hour
 * are what this sample buys.
 */
const SINGLE_DIGIT = new Date(2021, 0, 5, 9, 8, 7);

/** Both samples, so every case below runs over a padded and an unpadded date. */
const SAMPLES = [D, SINGLE_DIGIT];

/** Never a finite time value: the branch a cached formatter would throw on. */
const INVALID = new Date(NaN);

/**
 * The `toLocale*String` call the module made for one variant before it
 * formatted through cached `Intl.DateTimeFormat`s — this file's parity
 * reference, held verbatim so no assertion is pinned to a machine locale's own
 * spelling of a date. The convention
 * `TableExporter.test.ts` labels "locale-agnostic".
 *
 * @param type - The temporal field type.
 * @param showSeconds - Whether seconds show; ignored for `'date'`.
 * @param value - The value to format.
 * @returns The text the engine's own call gives for that variant.
 */
function engineText(type: TemporalFieldType, showSeconds: boolean, value: Date): string {
    switch (type) {
        case 'date':
            return value.toLocaleDateString();

        case 'time':
            return value.toLocaleTimeString(undefined, showSeconds
                ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
                : { hour: '2-digit', minute: '2-digit' });

        case 'datetime':
            return value.toLocaleString(undefined, showSeconds
                ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }
                : { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
}

/** Every variant `temporalDisplayText` accepts — the whole key space, six of them. */
const VARIANTS: ReadonlyArray<[type: TemporalFieldType, showSeconds: boolean]> = [
    ['date',     false],
    ['date',     true],
    ['time',     false],
    ['time',     true],
    ['datetime', false],
    ['datetime', true],
];

describe('temporalDisplayText', () => {
    it('27. formats a date as locale-formatted text, not the native toString form', () => {
        const text = temporalDisplayText('date', false, D);

        expect(text).not.toContain('GMT');
        expect(text).not.toContain('(');
    });

    it('28. showSeconds widens the output for time and datetime', () => {
        expect(temporalDisplayText('time', true, D).length)
            .toBeGreaterThan(temporalDisplayText('time', false, D).length);
        expect(temporalDisplayText('datetime', true, D).length)
            .toBeGreaterThan(temporalDisplayText('datetime', false, D).length);
    });

    it('29. showSeconds is ignored for date', () => {
        expect(temporalDisplayText('date', true, D)).toBe(temporalDisplayText('date', false, D));
    });

    it('30. a date variant equals toLocaleDateString, with seconds and without', () => {
        for (const sample of SAMPLES) {
            expect(temporalDisplayText('date', false, sample)).toBe(sample.toLocaleDateString());
            expect(temporalDisplayText('date', true, sample)).toBe(sample.toLocaleDateString());
        }
    });

    it('31. a time variant equals toLocaleTimeString with the same option set', () => {
        for (const sample of SAMPLES) {
            expect(temporalDisplayText('time', false, sample))
                .toBe(sample.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
            expect(temporalDisplayText('time', true, sample))
                .toBe(sample.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        }
    });

    it('32. a datetime variant equals toLocaleString with the same option set', () => {
        for (const sample of SAMPLES) {
            expect(temporalDisplayText('datetime', false, sample))
                .toBe(sample.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }));
            expect(temporalDisplayText('datetime', true, sample))
                .toBe(sample.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        }
    });

    it('33. an invalid date keeps the text the engine gives it, on every variant, and throws on none', () => {
        // `Intl.DateTimeFormat.prototype.format` throws a RangeError for a
        // non-finite time value where `toLocale*String` returns text, so a
        // variant reaching a cached formatter here fails by throwing out of the
        // call below, before its `toBe` runs, rather than comparing unequal.
        for (const [type, showSeconds] of VARIANTS) {
            expect(temporalDisplayText(type, showSeconds, INVALID)).toBe(engineText(type, showSeconds, INVALID));
        }
    });

    it('34. the formatter is shared across values, the text is not', () => {
        const oneSecondLater = new Date(D.getTime() + 1000);

        expect(temporalDisplayText('datetime', true, oneSecondLater))
            .not.toBe(temporalDisplayText('datetime', true, D));
        expect(temporalDisplayText('datetime', true, D))
            .toBe(temporalDisplayText('datetime', true, D));
    });
});

/**
 * Rounds of all six variants case 35 drives. The first builds every formatter;
 * the nine after it must reuse them, and still produce the engine's text — an
 * assertion a key too coarse to separate two variants fails on.
 */
const MEMO_ROUNDS = 10;

describe('temporalDisplayText — one formatter per variant, built once', () => {
    const RealDateTimeFormat = Intl.DateTimeFormat;

    afterEach(() => {
        // A leaked stand-in would follow the whole file.
        Intl.DateTimeFormat = RealDateTimeFormat;
        vi.resetModules();
    });

    it('35. sixty calls across six variants construct six formatters, each at the host locale', async () => {
        // Taken before the stand-in is installed: `toLocale*String` reaches the
        // engine's own intrinsic rather than the `Intl.DateTimeFormat` binding,
        // but computing the reference first keeps that independent of it.
        const expected = VARIANTS.map(([type, showSeconds]) => engineText(type, showSeconds, D));
        const locales: unknown[] = [];

        // A `function` expression, not an arrow: the module calls it with `new`.
        // Returning an object makes that object the result of the construction.
        Intl.DateTimeFormat = function CountingDateTimeFormat(
            locale?: Intl.LocalesArgument,
            options?: Intl.DateTimeFormatOptions,
        ): Intl.DateTimeFormat {
            locales.push(locale);

            return new RealDateTimeFormat(locale, options);
        } as unknown as typeof Intl.DateTimeFormat;

        // `_formats` is module-level, so the cases above left it warm and a
        // count taken against that copy would read zero either way. The stand-in
        // is already installed, so the fresh copy's first build is counted.
        vi.resetModules();

        const { temporalDisplayText: fresh } = await import('~/data/temporalText');

        for (let round = 0; round < MEMO_ROUNDS; round++) {
            VARIANTS.forEach(([type, showSeconds], variant) => {
                expect(fresh(type, showSeconds, D)).toBe(expected[variant]);
            });
        }

        // Six, not sixty: one per variant, and none rebuilt.
        expect(locales).toHaveLength(VARIANTS.length);

        // No call passes a locale, which is why the locale has no place in the
        // key: every formatter resolves the host default, the same one
        // `toLocale*String` resolved.
        expect(locales.every((locale) => locale === undefined)).toBe(true);
    });
});
