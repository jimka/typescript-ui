// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Normalized result of parsing a raw server response.
 *
 * @remarks
 * Collapses the two historical {@link AjaxProxy} parse branches (a paginated
 * `{ data, total }` envelope versus a top-level array) into one shape. `success`
 * and `message` are parsed when present but are not acted upon by the proxy or
 * store today — surfacing them as sync errors/events is a separate plan.
 *
 * @category Data
 */
export interface ReadResult {
    records  : any[];
    total?   : number;
    success? : boolean;
    message? : string;
}

/**
 * Parses a raw server response into a {@link ReadResult}.
 *
 * @remarks
 * A `Reader` lets {@link AjaxProxy} delegate response parsing so callers can swap
 * in a custom envelope format without subclassing the proxy. The default
 * implementation is {@link JsonReader}.
 *
 * @category Data
 */
export interface Reader {

    /**
     * Parses a raw server response into a normalized {@link ReadResult}.
     *
     * @param raw - The parsed JSON body from the server.
     * @param paginated - Whether the read requested pagination. Paginated reads
     *   expect an envelope object; unpaginated reads expect an array.
     *
     * @returns The normalized read result.
     */
    read(raw: any, paginated: boolean): ReadResult;
}

/**
 * How {@link JsonReader} chooses between the envelope and top-level-array parse.
 *
 * - `'auto'` — the historical behaviour: an envelope when the read requested
 *   pagination, a top-level array otherwise. The response *shape* is assumed to
 *   follow the request.
 * - `'envelope'` — always parse the `{ [rootProperty], [totalProperty] }`
 *   envelope, regardless of pagination. For servers that return a counted
 *   envelope on every read (paginated or not), decoupling the parse shape from
 *   whether this particular read carried `page`/`pageSize`.
 * - `'array'` — always parse a top-level (optionally `root`-unwrapped) array.
 *
 * @category Data
 */
export type JsonReaderMode = 'auto' | 'envelope' | 'array';

/**
 * Construction-time options for {@link JsonReader}.
 *
 * @category Data
 */
export interface JsonReaderOptions {
    root?          : string;
    rootProperty?  : string;
    totalProperty? : string;
    /**
     * Which parse to use. Defaults to `'auto'` (envelope when paginated, array
     * otherwise). Set `'envelope'` or `'array'` to fix the shape independently
     * of the read's pagination — see {@link JsonReaderMode}.
     */
    mode?          : JsonReaderMode;
}

/**
 * The envelope key holding the records array in a paginated response when no
 * `rootProperty` override is given. Mirrors the `{ data, total }` shape the
 * legacy inline {@link AjaxProxy} parser hardcoded.
 */
const DEFAULT_ROOT_PROPERTY = 'data';

/**
 * The envelope key holding the total record count in a paginated response when
 * no `totalProperty` override is given. Mirrors the legacy hardcoded `total`.
 */
const DEFAULT_TOTAL_PROPERTY = 'total';

/**
 * Default JSON reader reproducing the historical {@link AjaxProxy} parse: an
 * optional `root` unwrap, a `{ data, total }` envelope when paginated, and a
 * top-level array otherwise.
 *
 * @remarks
 * Configure `rootProperty`/`totalProperty` to read a differently keyed envelope.
 * Throws the same diagnostic messages as the original inline parser on a
 * malformed response shape so existing callers and tests are unaffected.
 *
 * @category Data
 */
export class JsonReader implements Reader {

    private _root: string | undefined;
    private _rootProperty: string;
    private _totalProperty: string;
    private _mode: JsonReaderMode;

    /**
     * Constructs a JsonReader from the given options.
     *
     * @param options - Optional. The root-key and envelope-key overrides, and
     *   the parse {@link JsonReaderMode | mode}.
     */
    constructor(options?: JsonReaderOptions) {
        this._root          = options?.root;
        this._rootProperty  = options?.rootProperty ?? DEFAULT_ROOT_PROPERTY;
        this._totalProperty = options?.totalProperty ?? DEFAULT_TOTAL_PROPERTY;
        this._mode          = options?.mode ?? 'auto';
    }

    /**
     * Parses a raw server response into a normalized {@link ReadResult}.
     *
     * @param raw - The parsed JSON body from the server.
     * @param paginated - Whether the read requested pagination.
     *
     * @returns The normalized read result.
     *
     * @remarks
     * With the default `'auto'` mode the parse follows `paginated`: an envelope
     * when paginated, a top-level array otherwise. `'envelope'` / `'array'`
     * force the shape regardless of `paginated`. Envelope parsing reads
     * `rootProperty` as the records array and `totalProperty` as the count from
     * the (optionally `root`-unwrapped) object; array parsing unwraps `root` to
     * an array, or falls back to a top-level array. Throws an `Error` on an
     * unexpected shape.
     */
    read(raw: any, paginated: boolean): ReadResult {
        const envelope = this._mode === 'envelope' || (this._mode === 'auto' && paginated);

        return envelope ? this.readEnvelope(raw) : this.readArray(raw);
    }

    /**
     * Reads a paginated `{ [rootProperty], [totalProperty] }` envelope.
     *
     * @param raw - The parsed JSON body from the server.
     *
     * @returns The normalized read result carrying records and total.
     */
    private readEnvelope(raw: any): ReadResult {
        const envelope = this._root ? raw[this._root] : raw;

        if (envelope == null || typeof envelope !== 'object') {
            throw new Error(`AjaxProxy: paginated response is not an envelope object`);
        }

        const data  = envelope[this._rootProperty];
        const total = envelope[this._totalProperty];

        if (!Array.isArray(data)) {
            throw new Error(`AjaxProxy: paginated response 'data' is not an array`);
        }

        return {
            records: data,
            total  : typeof total === 'number' ? total : undefined,
            success: typeof envelope.success === 'boolean' ? envelope.success : undefined,
            message: typeof envelope.message === 'string' ? envelope.message : undefined,
        };
    }

    /**
     * Reads an unpaginated top-level array, unwrapping `root` when configured.
     *
     * @param raw - The parsed JSON body from the server.
     *
     * @returns The normalized read result carrying records.
     */
    private readArray(raw: any): ReadResult {
        if (this._root) {
            const extracted = raw[this._root];

            if (!Array.isArray(extracted)) {
                throw new Error(`AjaxProxy: root '${this._root}' did not resolve to an array`);
            }

            return { records: extracted };
        }

        if (!Array.isArray(raw)) {
            throw new Error(`AjaxProxy: response is not an array and no root was specified`);
        }

        return { records: raw };
    }
}
