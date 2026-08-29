// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Pure route-pattern mechanics behind Router: normalizing a hash/path,
// compiling a registered pattern into segments + an ambiguity key, matching a
// path against a compiled pattern, and picking the most specific match. No
// DOM seam involved — internal to router/, not exported from the barrel.

/** The kind of a single pattern segment. */
type SegmentKind = "static" | "param" | "catchAll";

/** One segment of a compiled pattern. */
interface RouteSegment {
    kind:  SegmentKind;
    /** Literal text for "static", the parameter name for "param", "" for "catchAll". */
    value: string;
}

/** A pattern parsed into segments, plus its ambiguity key. */
export interface CompiledPattern {
    /** The pattern string as registered, after normalization (e.g. "/data/:id"). */
    pattern:  string;
    /** Ambiguity key: static segments by literal, "param" as ":", "catchAll" as "*". */
    key:      string;
    segments: RouteSegment[];
}

/**
 * Normalizes a hash or path to a leading-slash, no-trailing-slash path: strips
 * a leading `"#"`, discards everything from the first `"?"` onward, and
 * collapses empty segments (so a doubled `"//"` and a trailing `"/"` both
 * disappear). `""`, `"#"`, and `"#/"` all normalize to `"/"`.
 *
 * @param input - The raw hash (with or without its leading `"#"`) or path.
 * @returns The normalized path.
 */
export function normalizePath(input: string): string {
    const withoutHash = input.startsWith("#") ? input.slice(1) : input;

    return "/" + splitPath(splitQuery(withoutHash).path).join("/");
}

/**
 * Splits a normalized path into its non-empty segments.
 *
 * @param path - The path to split.
 * @returns The segments, in order.
 */
export function splitPath(path: string): string[] {
    return path.split("/").filter((segment) => segment.length > 0);
}

/**
 * Splits a URL-ish string at its first `"#"`: the part before, and the
 * fragment without its `"#"`. Everything after the first `"#"` is the
 * fragment verbatim — a second `"#"` in the input stays part of it. Never
 * normalizes either half; the caller runs `path` through {@link normalizePath}.
 *
 * @param input - The raw href or path, with or without a fragment.
 * @returns The part before the first `"#"`, and the fragment without it.
 */
export function splitFragment(input: string): { path: string; fragment: string } {
    const hashIndex = input.indexOf("#");

    if (hashIndex === -1) {
        return { path: input, fragment: "" };
    }

    return { path: input.slice(0, hashIndex), fragment: input.slice(hashIndex + 1) };
}

/**
 * Splits a URL-ish string at its first `"?"`: the part before, and the query
 * without its `"?"`. Everything after the first `"?"` is the query verbatim —
 * a second `"?"` stays part of it.
 *
 * @param input - The raw href or path, with or without a query.
 * @returns The part before the first `"?"`, and the query without it.
 */
export function splitQuery(input: string): { path: string; query: string } {
    const queryIndex = input.indexOf("?");

    if (queryIndex === -1) {
        return { path: input, query: "" };
    }

    return { path: input.slice(0, queryIndex), query: input.slice(queryIndex + 1) };
}

/**
 * Parses a query string into decoded key/value pairs. Tolerates one leading
 * `"?"`. Later duplicates of a key win; pairs that are empty or have an empty
 * key are skipped.
 *
 * @param query - The raw query string, with or without its leading `"?"`.
 * @returns The decoded key/value pairs.
 */
export function parseQuery(query: string): Record<string, string> {
    const body   = query.startsWith("?") ? query.slice(1) : query;
    const result: Record<string, string> = {};

    for (const pair of body.split("&")) {
        if (pair.length === 0) {
            continue;
        }

        const equalsIndex = pair.indexOf("=");
        const rawKey      = equalsIndex === -1 ? pair : pair.slice(0, equalsIndex);
        const rawValue    = equalsIndex === -1 ? ""   : pair.slice(equalsIndex + 1);
        const key         = decodeSegment(rawKey);

        if (key.length === 0) {
            continue;
        }

        result[key] = decodeSegment(rawValue);
    }

    return result;
}

/**
 * Serializes key/value pairs into a query string, without a leading `"?"`.
 * Keys come out in `Object.keys` order — insertion order, except that
 * integer-like keys come first, in ascending order.
 *
 * @param query - The key/value pairs to serialize.
 * @returns The query string, or `""` for an empty record.
 */
export function formatQuery(query: Record<string, string>): string {
    return Object.keys(query)
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
        .join("&");
}

/**
 * Whether two query records hold the same keys with the same values,
 * regardless of key order.
 *
 * @param a - The first query record.
 * @param b - The second query record.
 * @returns `true` when both records hold the same key/value pairs.
 */
export function sameQuery(a: Record<string, string>, b: Record<string, string>): boolean {
    const aKeys = Object.keys(a);

    return aKeys.length === Object.keys(b).length && aKeys.every((key) => a[key] === b[key]);
}

/**
 * Normalizes a base to leading-and-trailing-slash form, so
 * {@link stripBase} and {@link joinBase} can both assume that shape.
 * `""`, `"/"`, `"x"`, `"/x"`, and `"/x/"` all become `"/"` or `"/x/"`.
 *
 * @param base - The raw base path.
 * @returns The normalized base.
 */
export function normalizeBase(base: string): string {
    const segments = splitPath(base);

    return segments.length === 0 ? "/" : "/" + segments.join("/") + "/";
}

/**
 * Removes `base` from the front of `pathname`, then normalizes what is
 * left through {@link normalizePath}. A `pathname` that does not start with
 * `base` is normalized as-is rather than rejected.
 *
 * @param base - The site base, in any shape {@link normalizeBase} accepts.
 * @param pathname - The URL path to strip the base from.
 * @returns The normalized path with `base` removed.
 */
export function stripBase(base: string, pathname: string): string {
    const normalizedBase = normalizeBase(base);
    // Base without its trailing slash, e.g. "/typescript-ui" ("" at the root).
    const basePrefix = normalizedBase.slice(0, -1);

    if (basePrefix !== "" && (pathname === basePrefix || pathname.startsWith(basePrefix + "/"))) {
        return normalizePath(pathname.slice(basePrefix.length));
    }

    return normalizePath(pathname);
}

/**
 * Joins a normalized base and a normalized path into a URL path — the
 * inverse of {@link stripBase}.
 *
 * @param base - The site base, in any shape {@link normalizeBase} accepts.
 * @param path - The route path, in any shape {@link normalizePath} accepts.
 * @returns The joined URL path.
 */
export function joinBase(base: string, path: string): string {
    const normalizedBase = normalizeBase(base);
    const normalizedPath = normalizePath(path);

    if (normalizedPath === "/") {
        return normalizedBase;
    }

    return normalizedBase.slice(0, -1) + normalizedPath;
}

/**
 * Parses a registered pattern into {@link RouteSegment}s and derives its
 * ambiguity key.
 *
 * @param pattern - The pattern string, e.g. `"/data/rows/:sel"`.
 * @returns The compiled pattern.
 * @throws If `"*"` appears anywhere but the final segment.
 */
export function compilePattern(pattern: string): CompiledPattern {
    const normalized = normalizePath(pattern);
    const rawSegments = splitPath(normalized);

    const segments: RouteSegment[] = rawSegments.map((raw, i) => {
        if (raw === "*") {
            if (i !== rawSegments.length - 1) {
                throw new Error(`RoutePattern: "*" is only valid as the final segment of "${pattern}"`);
            }

            return { kind: "catchAll", value: "" };
        }

        if (raw.startsWith(":")) {
            return { kind: "param", value: raw.slice(1) };
        }

        return { kind: "static", value: raw };
    });

    const key = segments
        .map((segment) => segment.kind === "static" ? segment.value : segment.kind === "param" ? ":" : "*")
        .join("/");

    return { pattern: normalized, key, segments };
}

/**
 * Returns the extracted params when `segments` match `compiled`, or `null`
 * when they don't. A trailing `catchAll` segment matches zero or more
 * remaining segments; every other kind requires an exact segment count.
 * Captured `:param` values run through `decodeURIComponent`, falling back to
 * the raw segment text on a malformed escape.
 *
 * @param compiled - The compiled pattern to match against.
 * @param segments - The candidate path's segments (from {@link splitPath}).
 * @returns The extracted params, or `null` when there is no match.
 */
export function matchPattern(compiled: CompiledPattern, segments: string[]): Record<string, string> | null {
    const patternSegments = compiled.segments;
    const isCatchAll = patternSegments.length > 0 && patternSegments.at(-1)!.kind === "catchAll";
    const staticLength = isCatchAll ? patternSegments.length - 1 : patternSegments.length;

    if (isCatchAll ? segments.length < staticLength : segments.length !== staticLength) {
        return null;
    }

    const params: Record<string, string> = {};

    for (let i = 0; i < staticLength; i += 1) {
        const patternSegment = patternSegments[i];
        const value = segments[i];

        if (patternSegment.kind === "static") {
            if (patternSegment.value !== value) {
                return null;
            }
        } else if (patternSegment.kind === "param") {
            params[patternSegment.value] = decodeSegment(value);
        }
    }

    return params;
}

/**
 * Decodes a captured path segment or query part, falling back to the raw
 * text when it carries a malformed percent-escape.
 *
 * @param value - The raw segment text.
 * @returns The decoded value, or `value` unchanged on a decode failure.
 */
function decodeSegment(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/** Rank of each real segment kind: higher wins a specificity tie-break. */
const KIND_RANK: Record<SegmentKind, number> = { static: 2, param: 1, catchAll: 0 };

/**
 * Rank of position `i` in `segments`. Reaching the end of the pattern (`i` at
 * or past its length) outranks every real segment kind — see
 * {@link selectPattern}.
 *
 * @param segments - The pattern's segments.
 * @param i - The position to rank.
 * @returns The rank at that position.
 */
function rankAt(segments: readonly RouteSegment[], i: number): number {
    return i >= segments.length ? 3 : KIND_RANK[segments[i].kind];
}

/**
 * Returns the highest-ranked pattern in `compiled` that matches `path`, or
 * `null` when none match. Patterns are compared segment by segment from the
 * left via {@link rankAt}; the first position where two matching patterns
 * differ decides the winner. Two patterns can never tie on every position —
 * that would mean identical ambiguity keys, which the route table (see
 * `Router`) forbids. Registration order never affects the result.
 *
 * @param compiled - The candidate compiled patterns.
 * @param path - The normalized path to match.
 * @returns The winning pattern and its extracted params, or `null`.
 */
export function selectPattern<T extends CompiledPattern>(
    compiled: readonly T[],
    path:     string,
): { compiled: T; params: Record<string, string> } | null {
    const segments = splitPath(path);

    let best:       T | null = null;
    let bestParams: Record<string, string> | null = null;

    for (const candidate of compiled) {
        const params = matchPattern(candidate, segments);

        if (params === null) {
            continue;
        }

        if (best === null || isMoreSpecific(candidate.segments, best.segments)) {
            best = candidate;
            bestParams = params;
        }
    }

    return best === null ? null : { compiled: best, params: bestParams! };
}

/**
 * Whether `a` outranks `b` by {@link rankAt} at the first position where they
 * differ.
 *
 * @param a - The candidate pattern's segments.
 * @param b - The current best pattern's segments.
 * @returns `true` when `a` is more specific than `b`.
 */
function isMoreSpecific(a: readonly RouteSegment[], b: readonly RouteSegment[]): boolean {
    const length = Math.max(a.length, b.length);

    for (let i = 0; i < length; i += 1) {
        const rankA = rankAt(a, i);
        const rankB = rankAt(b, i);

        if (rankA !== rankB) {
            return rankA > rankB;
        }
    }

    return false;
}
