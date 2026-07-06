// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Video } from "~/component/display/Video.js";

/**
 * Pluggable media-loading strategy for a {@link Video} surface.
 *
 * @remarks
 * The engine seam decouples *how a source is loaded* from the {@link Video}
 * primitive and the `VideoPlayer` composite. The default {@link ProgressiveEngine}
 * simply writes the `src` attribute and lets the browser fetch a progressive
 * MP4 / WebM. A future adaptive-streaming engine (hls.js / dash.js) would attach
 * to the raw media element and drive its buffer — which needs the live
 * `HTMLVideoElement` the DOM seam deliberately hides, so that escape is a
 * documented prerequisite for streaming and out of scope here. Implement this
 * interface to add a new strategy without touching the component.
 *
 * @category Components
 */
export interface PlaybackEngine {
    /**
     * Loads a source into the given video surface.
     *
     * @param video - The video surface to load into.
     * @param src - The media source URL.
     */
    load(video: Video, src: string): void;

    /**
     * Releases any resources the engine holds (detaches a streaming instance,
     * cancels in-flight fetches). Called before a new `load` and on disposal.
     */
    destroy(): void;
}

/**
 * The default {@link PlaybackEngine}: progressive download. `load` writes the
 * `src` attribute (the browser auto-fetches a progressive MP4 / WebM); `destroy`
 * is a no-op because a progressive source holds no engine-side resources.
 *
 * @category Components
 */
class ProgressiveEngine implements PlaybackEngine {
    /**
     * Points the video surface at `src` by writing its `src` attribute.
     *
     * @param video - The video surface to load into.
     * @param src - The media source URL.
     */
    load(video: Video, src: string): void {
        video.setSrc(src);
    }

    /**
     * No-op: a progressive source holds no engine-side resources to release.
     */
    destroy(): void {
        // Progressive playback keeps no engine state; nothing to tear down.
    }
}

export { ProgressiveEngine };
