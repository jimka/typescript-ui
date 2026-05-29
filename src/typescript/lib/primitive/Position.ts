// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * CSS `position` values used by the framework.
 *
 * The framework positions every component absolutely (see
 * [ARCHITECTURE.md](/ARCHITECTURE.md) §Positioning). Only three values
 * are exposed:
 *
 * - `ABSOLUTE` — the universal default for every framework component.
 * - `FIXED` — the documented exception for floating overlays that anchor to
 *   the viewport (`AnimatedDropdown`, `Popover`, `Notification`, `Dialog`,
 *   `DialogBackdrop`). Set internally by these subclasses; never by callers.
 * - `STATIC` — the documented exception for an HTML element whose native
 *   semantics require in-flow rendering (currently only `Legend`, which needs
 *   the notch in its parent `<fieldset>`'s border).
 *
 * Other CSS values (`relative`, `sticky`, `initial`, `inherit`) are
 * intentionally **not** members. Application code does not call
 * `setPosition` — that setter is `protected` on `Component`.
 *
 * @category Util
 */
export enum Position {
    STATIC = "static",
    FIXED = "fixed",
    ABSOLUTE = "absolute",
}
