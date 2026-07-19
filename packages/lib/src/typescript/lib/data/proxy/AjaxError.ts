// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { StoreOperation } from '~/data/AbstractStore.js';

/**
 * Error thrown by {@link AjaxProxy} when the server responds with a non-OK HTTP
 * status. It carries the parsed error body alongside the HTTP status so
 * downstream code can surface the server's own message.
 *
 * @remarks
 * The thrown value flows unchanged through the store: it arrives on the
 * `'exception'` event and the `'sync'` payload's `failures` as the `error`
 * field (typed `unknown`), so a consumer narrows it with `instanceof AjaxError`
 * to read `status`/`body`. Because it extends `Error`, existing `catch`/rethrow
 * paths and `err.message` logging keep working unchanged.
 *
 * @category Data
 */
export class AjaxError extends Error {

    /** The HTTP status code of the failed response (e.g. 409). */
    readonly status: number;

    /** The HTTP status text of the failed response (e.g. "Conflict"). */
    readonly statusText: string;

    /** The parsed error body — JSON when parseable, else the raw text, else undefined. */
    readonly body: unknown;

    /** The proxy operation that failed. */
    readonly operation: StoreOperation;

    /** The request URL that produced the failure. */
    readonly url: string;

    /**
     * Constructs an AjaxError from the failing operation, request URL, the
     * non-OK response, and the best-effort parsed error body.
     *
     * @param operation - The proxy operation that failed.
     * @param url - The request URL that produced the failure.
     * @param response - The non-OK fetch response; its `status`/`statusText` are read.
     * @param body - The parsed error body, or undefined when it could not be read.
     */
    constructor(operation: StoreOperation, url: string, response: Response, body: unknown) {
        super(`AjaxProxy: ${operation} failed with status ${response.status}`);

        this.name       = 'AjaxError';
        this.status     = response.status;
        this.statusText = response.statusText;
        this.body       = body;
        this.operation  = operation;
        this.url        = url;
    }
}
