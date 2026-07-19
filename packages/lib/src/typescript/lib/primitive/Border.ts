// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * A border specification built from complete CSS border strings.
 * `border` is the all-sides fallback; each per-side field overrides it for
 * that side. An unspecified side falls back to `border`, then to `"none"`.
 *
 * @category Util
 */
export interface BorderOptions {
    /** CSS `border` shorthand applied to all four sides (e.g. `"1px solid rgb(...)"`, `"none"`, `"var(--x)"`). */
    border?: string;
    /** CSS `border-top` value; overrides `border` for the top side. */
    borderTop?: string;
    /** CSS `border-right` value; overrides `border` for the right side. */
    borderRight?: string;
    /** CSS `border-bottom` value; overrides `border` for the bottom side. */
    borderBottom?: string;
    /** CSS `border-left` value; overrides `border` for the left side. */
    borderLeft?: string;
}

/**
 * Expands a {@link BorderOptions} into the four camelCase longhand style keys
 * (`borderTop`/`borderRight`/`borderBottom`/`borderLeft`) that `StyleRule.setMany`
 * consumes. Each side resolves via `side ?? border ?? "none"`, so a pure-longhand
 * map replays deterministically regardless of what else touched the rule.
 *
 * @param border - The border specification to expand.
 *
 * @returns A map of the four longhand keys to their resolved CSS values.
 *
 * @category Util
 */
export function borderToStyle(border: BorderOptions): Record<string, string | null> {
    const all = border.border ?? "none";

    return {
        borderTop:    border.borderTop    ?? all,
        borderRight:  border.borderRight  ?? all,
        borderBottom: border.borderBottom ?? all,
        borderLeft:   border.borderLeft   ?? all,
    };
}

/**
 * Best-effort leading-`<n>px` width of one side's CSS value. Returns `0` for
 * `undefined`, `none`, `0`, `var(...)`, or any non-`px` leading token. Used both
 * to parse the always-`<n>px` values `getComputedStyle` returns (authoritative,
 * post-render) and to estimate a width from a spec string before an element exists.
 *
 * @param value - A single side's CSS border value, or `undefined`.
 *
 * @returns The leading pixel width, or `0` when none can be parsed.
 *
 * @category Util
 */
export function borderSideWidth(value: string | undefined): number {
    if (!value) {
        return 0;
    }

    const match = value.trim().match(/^([\d.]+)px\b/i);

    return match ? parseFloat(match[1]) : 0;
}
