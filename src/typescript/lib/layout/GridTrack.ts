// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * The sizing mode of a single {@link GridTrack} (one row or one column).
 *
 * - `"weight"` — the track takes a proportional share of the space left after
 *   fixed and content tracks are sized; the share is `value / sum(weights)`.
 * - `"fixed"` — the track is exactly `value` pixels wide (column) or tall (row).
 * - `"content"` — the track sizes to its children, using `max(preferred, min)`
 *   so a child that only set a min size still widens (or heightens) the track.
 *
 * @category Layouts
 */
export type GridTrackMode = "weight" | "fixed" | "content";

/**
 * Describes how a single {@link Grid} row or column is sized.
 *
 * @remarks `value` carries the weight (mode `"weight"`) or the pixel size
 * (mode `"fixed"`) and is ignored for mode `"content"`. Declare tracks on the
 * grid via {@link Grid.setColumnTracks} / {@link Grid.setRowTracks}; when fewer
 * tracks are supplied than the grid has columns/rows, the missing tracks
 * default to `{ mode: "weight", value: 1 }`.
 *
 * @category Layouts
 */
export interface GridTrack {

    /** The sizing mode for this track. */
    mode: GridTrackMode;

    /** Weight (mode `"weight"`) or pixel size (mode `"fixed"`); ignored for `"content"`. */
    value?: number;
}
