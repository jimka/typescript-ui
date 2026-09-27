// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * The three field types whose cells render a `Date` as locale-formatted text.
 *
 * @category Data
 */
export type TemporalFieldType = 'date' | 'time' | 'datetime';

/**
 * A variant of {@link temporalDisplayText}: its field type, plus whether
 * seconds show. The same key spelling `CellTextResolver` builds for its
 * renderer pool.
 *
 * @internal
 */
type TemporalFormatKey = TemporalFieldType | `${TemporalFieldType}:seconds`;

/**
 * The options each variant formats with — the exact option objects this module
 * used to pass to `toLocaleTimeString` / `toLocaleString`, plus the numeric
 * year, month and day an optionless `toLocaleDateString()` adds for itself.
 * Held at module scope so no call builds one.
 *
 * Every set names at least one date field and, where a time is shown, one time
 * field, so ECMA-402's `ToDateTimeOptions` adds nothing on either route: a
 * formatter built from these options is the formatter the replaced
 * `toLocale*String` call built for itself.
 */
const TEMPORAL_FORMAT_OPTIONS: Record<TemporalFormatKey, Intl.DateTimeFormatOptions> = {
    'date':             { year: 'numeric', month: 'numeric', day: 'numeric' },
    'date:seconds':     { year: 'numeric', month: 'numeric', day: 'numeric' },
    'time':             { hour: '2-digit', minute: '2-digit' },
    'time:seconds':     { hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'datetime':         { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' },
    'datetime:seconds': { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' },
};

/**
 * One `Intl.DateTimeFormat` per variant, built on first use and held for the
 * life of the module — at most six, one per key of
 * {@link TEMPORAL_FORMAT_OPTIONS}.
 *
 * Never invalidated: a formatter depends on nothing but its option set and the
 * host's default locale and time zone. The option set is the key's own, so it
 * cannot drift; the locale is never passed, since this module formats at the
 * host default and takes no locale, and a page has no way to set either default
 * while it runs. What is left is a default changing under the page — an
 * operating-system locale or time-zone change, or a host that honours a
 * `TZ` environment variable set out of band — after which a newly constructed
 * formatter would resolve the new default and these would not. That divergence
 * is accepted: detecting it means constructing a formatter to read
 * `resolvedOptions()`, which is the cost this memo exists to remove, and an
 * already-rendered cell does not re-format on such a change today either,
 * since each renderer caches its display text and re-formats only on
 * `setValue`.
 *
 * Constructing a formatter is the expensive half of formatting a date, which is
 * why the instance is kept and not the formatted text: the text differs per
 * value, the formatter does not.
 */
const _formats: Map<TemporalFormatKey, Intl.DateTimeFormat> = new Map();

/**
 * The shared formatter for one variant, built on first use.
 *
 * @param key - The variant to format with.
 * @returns The formatter every caller of that variant shares.
 */
function temporalFormat(key: TemporalFormatKey): Intl.DateTimeFormat {
    let format = _formats.get(key);

    if (!format) {
        format = new Intl.DateTimeFormat(undefined, TEMPORAL_FORMAT_OPTIONS[key]);
        _formats.set(key, format);
    }

    return format;
}

/**
 * Formats `value` exactly as a cell of this variant displays it — through a
 * shared `Intl.DateTimeFormat` per variant. Its text equals what the
 * `toLocaleDateString` / `toLocaleTimeString` / `toLocaleString` call this
 * module used to make for that variant produced, so a substring filter over a
 * temporal column can match what the cell actually shows.
 *
 * @param type - The temporal field type, selecting which shared formatter runs.
 * @param showSeconds - Whether to include seconds; ignored for `'date'`.
 * @param value - The value to format.
 * @returns The locale-formatted display text.
 *
 * @internal — not re-exported from the package barrel.
 */
export function temporalDisplayText(type: TemporalFieldType, showSeconds: boolean, value: Date): string {
    if (Number.isNaN(value.getTime())) {
        return temporalDisplayTextUncached(type, showSeconds, value);
    }

    const key: TemporalFormatKey = showSeconds ? `${type}:seconds` : type;

    return temporalFormat(key).format(value);
}

/**
 * Formats `value` through the engine's own `toLocale*String` calls, the way
 * this module did before it held formatters.
 *
 * Reached for one production case: an invalid `Date`, whose text these three
 * methods define and a cached formatter does not — `Intl.DateTimeFormat`'s
 * `format` throws a `RangeError` for a non-finite time value where each of them
 * returns text. A cell renderer guards on truthiness only, and an invalid
 * `Date` object is truthy, so the case is reachable.
 *
 * @param type - The temporal field type, selecting which native formatter runs.
 * @param showSeconds - Whether to include seconds; ignored for `'date'`.
 * @param value - The value to format.
 * @returns The locale-formatted display text.
 */
function temporalDisplayTextUncached(type: TemporalFieldType, showSeconds: boolean, value: Date): string {
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
