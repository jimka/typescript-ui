// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Animation } from "~/core/Animation.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";

/** Duration of the read-only rejection flash, in milliseconds. */
const READONLY_FLASH_MS = 300;

/** Peak opacity of the read-only rejection wash — a subtle tint that keeps the text readable. */
const READONLY_FLASH_PEAK_OPACITY = 0.16;

/**
 * Fill of the read-only rejection wash: the project's validation-error token,
 * with a light/dark-safe fallback, so the tint follows a `ThemeManager.setTheme`
 * toggle with no rebuild (the CSS variable resolves live).
 */
const READONLY_FLASH_COLOR = "var(--ts-ui-validation-error-border, #dc2626)";

/**
 * The read-only rejection wash both editors play when an edit is refused: a
 * pointer-transparent overlay that fills its host's box, rests at
 * `opacity: 0`, and is pulsed from a subtle error tint back to transparent.
 *
 * A full-box wash is used rather than a border/ring cue because an editor is
 * often large and mostly empty, so an edge flash sits far from where the eye
 * is (the caret) and reads as nothing; the wash covers the content the user is
 * looking at while staying faint enough to keep the text legible.
 *
 * The owning component tracks the overlay's handle, so its teardown releases
 * the element, and calls {@link ReadOnlyFlash.cancel} before that.
 */
export class ReadOnlyFlash {

    /** The overlay that is pulsed; `null` until mounted (or forever, offline). */
    private _overlay: Handle | null = null;

    /**
     * The pulse in flight, cancelled on teardown so its fallback timer cannot
     * fire against the overlay's released element handle.
     */
    private _animation: Animation.CancelHandle | null = null;

    /**
     * Creates the wash under `host`, appended after the host's content so it
     * paints on top of it.
     *
     * @param host - The mounted element the overlay fills.
     * @param zIndex - The overlay's stacking order within `host`.
     * @returns The overlay's handle, for the caller to track as its own.
     */
    mount(host: Handle, zIndex: number): Handle {
        const overlay = DOM.sink.createElement("div");

        DOM.sink.apply(overlay, {
            style: {
                position:      "absolute",
                inset:         "0",
                pointerEvents: "none",
                zIndex:        String(zIndex),
                backgroundColor: READONLY_FLASH_COLOR,
                opacity:       "0",
            },
        });
        DOM.sink.appendChild(host, overlay);

        this._overlay = overlay;

        return overlay;
    }

    /**
     * Pulses the wash once, restarting a pulse still in flight. No-op before
     * the overlay is mounted (offline, or before the host's first mount), and
     * — via {@link Animation.play} — honours `prefers-reduced-motion`: under
     * reduced motion nothing animates.
     */
    play(): void {
        if (!this._overlay) {
            return;
        }

        this._animation?.cancel();
        this._animation = Animation.play(this._overlay, {
            from:       { opacity: String(READONLY_FLASH_PEAK_OPACITY) },
            to:         { opacity: "0" },
            durationMs: READONLY_FLASH_MS,
            properties: ["opacity"],
        });
    }

    /** Stops a pulse still in flight. Call before the overlay's handle is released. */
    cancel(): void {
        this._animation?.cancel();
        this._animation = null;
    }
}
