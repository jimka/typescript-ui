# VideoPlayer

[`VideoPlayer`](/api/component/display/classes/VideoPlayer) is a complete video player: a native [`Video`](/components/Video) surface framed by a control bar built entirely from this library's own components — play / pause, a seek scrubber, a current-time / duration readout, volume, mute, and fullscreen. The native browser `controls` chrome is **not** used, so the whole player themes with the rest of your UI.

The player is a [`Border`](/api/layout/classes/Border) layout with the video in the centre region and the control bar docked south. Source loading routes through a pluggable [`PlaybackEngine`](/api/component/display/interfaces/PlaybackEngine) (progressive download by default).

## Usage

```typescript
import { VideoPlayer } from '@jimka/typescript-ui/component/display';

const player = VideoPlayer({
    src:           '/media/clip.mp4',
    poster:        '/media/poster.png',
    volume:        0.8,
    preferredSize: { width: 640, height: 400 },
});

player.on('ended', () => console.log('playback finished'));

panel.addComponent(player);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getSrc()` / `setSrc(url)` | Read / load the media source (routes through the playback engine). |
| `getVolume()` / `setVolume(n)` | Audio volume, clamped to `[0, 1]`. |
| `isMuted()` / `setMuted(b)` | Muted state. |
| `getPlaybackRate()` / `setPlaybackRate(n)` | Playback speed multiplier. |
| `getCurrentTime()` / `setCurrentTime(seconds)` | Read the playhead / seek. |
| `getDuration()` | Live media duration in seconds. |
| `isPlaying()` / `play()` / `pause()` / `togglePlay()` | Play-state control. |
| `isControlsVisible()` / `setControlsVisible(b)` | Show or hide the control bar. |
| `isFullscreen()` / `enterFullscreen()` / `exitFullscreen()` / `toggleFullscreen()` | Fullscreen control. |
| `on(event, fn)` / `off(event, fn)` | Subscribe to `play` / `pause` / `ended`. |
| `dispose()` | Detach the player's native + video listeners. |

## Events

`VideoPlayer` emits the player-level lifecycle subset of the underlying video's media events: `play`, `pause`, `ended`.

## Notes

- **Custom control bar, not native.** The control bar is composed from [`Button`](/components/Button), [`Slider`](/components/Slider), and [`Text`](/components/Text), arranged with an `HBox` — so it inherits your theme tokens. Hide it entirely with `controls: false`.
- **Fullscreen needs a user gesture.** The fullscreen button triggers `enterFullscreen()` from its click handler; a programmatic call outside a gesture is rejected by the browser. A `fullscreenchange` listener keeps the button glyph in sync when the user presses Esc.
- **Scrubbing is guarded.** While you drag the seek scrubber, incoming `timeupdate` events do not fight the thumb.
- **Pluggable loading.** `setSrc` destroys the previous engine session and loads through the current [`PlaybackEngine`](/api/component/display/interfaces/PlaybackEngine). The default [`ProgressiveEngine`](/api/component/display/classes/ProgressiveEngine) writes the `src` attribute for a progressive MP4 / WebM; supply your own `engine` to integrate an adaptive-streaming library. Adaptive streaming itself is not bundled.

## See also

- [API: VideoPlayer](/api/component/display/classes/VideoPlayer)
- [`Video`](/components/Video) — the bare native surface it composes
- [`Slider`](/components/Slider) — the scrubber / volume control
