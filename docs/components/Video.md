# Video

[`Video`](/api/component/display/classes/Video) is a thin native `<video>` surface — the media twin of [`Image`](/components/Image). It owns the typed media setters, a live playback-state read, and the native media-event bridge, but no on-screen controls. For a ready-made player with a control bar, use [`VideoPlayer`](/components/VideoPlayer); reach for `Video` directly when you want the bare surface (e.g. a background loop, or your own custom chrome).

## Usage

```typescript
import { Video } from '@jimka/typescript-ui/component/display';

const surface = Video({
    src:      '/media/clip.mp4',
    poster:   '/media/poster.png',
    autoplay: false,
    loop:     true,
    muted:    true,
    preload:  'metadata',
});

surface.on('ended', () => console.log('reached the end'));

panel.addComponent(surface);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getSrc()` / `setSrc(url)` | Read / write the media source (`src` attribute). |
| `getPoster()` / `setPoster(url)` | Poster image shown before playback. |
| `isAutoplay()` / `setAutoplay(b)` | Toggle the `autoplay` attribute. |
| `isLoop()` / `setLoop(b)` | Toggle the `loop` attribute. |
| `isMuted()` / `setMuted(b)` | Muted state (drives the live IDL property). |
| `getPreload()` / `setPreload('none' \| 'metadata' \| 'auto')` | Preload strategy. |
| `getVolume()` / `setVolume(n)` | Audio volume, clamped to `[0, 1]`. |
| `getPlaybackRate()` / `setPlaybackRate(n)` | Playback speed multiplier. |
| `setCurrentTime(seconds)` | Seek to a position (runtime-only — not an option). |
| `play()` / `pause()` | Start / pause playback. |
| `getMediaState()` | Live `{ currentTime, duration, paused, ended, volume, muted, playbackRate }` snapshot. |
| `on(event, fn)` / `off(event, fn)` | Subscribe to re-emitted media events. |
| `dispose()` | Detach the native media listeners. |

## Events

Media events do not bubble, so they cannot route through the framework's window-level `Event` layer. `Video` wires them natively at render time and re-emits them through its own `on` / `off` surface:

`timeupdate`, `play`, `pause`, `ended`, `loadedmetadata`, `durationchange`, `volumechange`, `ratechange`.

## Notes

- **`currentTime` is runtime-only.** The live playhead is not consumer configuration, so it is not on `VideoOptions` and has no getter — read it live through `getMediaState()`, and seek with `setCurrentTime()`.
- **`volume` is clamped.** Out-of-range values saturate to `0` or `1`.
- **Dispose to unwire.** `dispose()` removes the native media listeners; call it before discarding a surface you created imperatively.

## See also

- [API: Video](/api/component/display/classes/Video)
- [`VideoPlayer`](/components/VideoPlayer) — the composite player with a control bar
- [`Image`](/components/Image) — the static-bitmap twin
