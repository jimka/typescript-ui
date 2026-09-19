---
depends-on: [qa-app]
touches-shared:
  - packages/qa/runqa.sh
  - packages/qa/README.md
---

# QA App Tauri Host — Implementation Plan

## Overview

This plan lets every QA-app panel be measured in a Tauri window as well as in MiniBrowser. It adds a minimal Tauri 2 shell, `packages/qa/src-tauri/`, and a `tauri` host to the runner built by [`qa-app.md`](plans/qa-app.md). The shell opens one full-screen window on a URL given when it starts, and does nothing else: no plugins, no IPC commands, no frontend of its own. The page, the harness, the panels and the report path are unchanged — the window loads the same dev-server URL MiniBrowser loads, and the page reports to the same Vite endpoint.

The runner change is the one `qa-app.md` prepared for: one name in `HOSTS` and one `tauri)` branch in each of `check_host`, `start_host` and `stop_host`. Nothing else in the QA app changes.

On Linux, where this runner runs, the Tauri window uses the same WebKitGTK library as MiniBrowser. Per-pass work counts must therefore match across the two hosts; frame times are reported per host and never compared across hosts.

---

## Architecture Decisions

### The shell mirrors Loom's working Tauri 2 app, minus everything the page does not need

`packages/qa/src-tauri/` follows [Loom's `src-tauri/`](../loom/src-tauri/Cargo.toml#L1) (Loom paths in this plan are relative to this repo's root, i.e. the sibling checkout): Tauri 2, `tauri` `2.11.3` and `tauri-build` `2.6.3`, `build.rs` calling `tauri_build::build()`, and `tauri::Builder::default()…run(tauri::generate_context!())` ([lib.rs:51–79](../loom/src-tauri/src/lib.rs#L51)). It drops Loom's plugins (`fs`, `dialog`, `os`, `log`), its IPC command, its capabilities file and its GTK icon helper, because the QA page calls no Tauri API.[^minimal]

### The run's URL is the shell's one command-line argument

The shell is built once. The runner starts it as `qa-host <url>`, the way it starts `MiniBrowser --full-screen <url>`. `main` checks the argument before Tauri starts, and the `setup` hook opens the window on it with `WebviewWindowBuilder::new(app, "qa", WebviewUrl::External(url))`. `tauri.conf.json` declares no windows, no `devUrl`, no `frontendDist` and no `beforeDevCommand`.[^url-at-launch]

The argument rule:

| Arguments | Result |
|---|---|
| `http://localhost:5190/?qa=x&host=tauri` | opens the window on that URL |
| (none), or two arguments | exits 2: `qa-host: usage: qa-host <url>` |
| `not a url` | exits 2: `qa-host: not a URL: "not a url"` |
| `file:///etc/passwd` | exits 2: `qa-host: only http and https URLs are allowed, got "file:///etc/passwd"` |

### The shell is built with `cargo build`, not the Tauri CLI

`cargo build --manifest-path packages/qa/src-tauri/Cargo.toml` produces `packages/qa/src-tauri/target/debug/qa-host`. A plain `cargo build` compiles Tauri in dev mode, which embeds no frontend and needs none. No `@tauri-apps/cli` dependency is added.[^cargo-not-cli]

### The window is full screen, and the runner stops it

The window is built with `.fullscreen(true)`, like MiniBrowser's `--full-screen`. The runner stops the process with the same stop-on-result flow `qa-app.md` defines for MiniBrowser; the page never closes itself.[^runner-stops]

### One icon, generated once

Tauri's code generation requires a default window icon, `icons/icon.png` on Linux. The shell ships one 32 × 32 RGBA PNG, written once by a short Python script, and sets `bundle.active: false`, so no other icon is needed.[^icon]

### Linux only; same library as MiniBrowser there

On Linux Tauri renders through wry's WebKitGTK backend, linked against `webkit2gtk-4.1` — the library MiniBrowser uses. On Windows the same shell would use WebView2 (Chromium) and on macOS WKWebView; this plan builds and runs it on Linux only, since the runner itself is Linux-only.[^engine]

### Work counts are compared across hosts; frame times and geometry only within one

Seam, work and native-mutation counts come from the library's JavaScript and the engine's DOM, so a panel's per-pass census must be identical under both hosts. Frame times and geometry depend on how each host embeds the engine — window chrome, scrollbar appearance, WebKit settings — so they are compared only between runs of the same host. The report's `host` field, set from the `host=` parameter the runner passes, keeps them apart.[^within-host]

### The build output stays out of git and out of the app's tools

`src-tauri/.gitignore` ignores `/target/` and `/gen/`, as Loom's [`src-tauri/.gitignore`](../loom/src-tauri/.gitignore#L1) does. The QA app's Vite server, dependency scan and Vitest already see only the app's own source (`qa-app.md`, *Vite and Vitest see only the app's own source*), so the Cargo build under `src-tauri/target/` reaches none of them and this plan changes no QA-app config.[^build-output]

### No WebKit environment overrides

The runner starts the shell with the runner's own environment and sets no `WEBKIT_*` variable, as Loom's shell runs without any. A variable that changes WebKit's rendering path changes what is measured, so if one is ever needed to get a window, every arm of a comparison must carry it.[^no-env]

---

## Public API

Nothing here is exported from any package. The contract is the shell's command line and the runner's host name.

```text
qa-host <url>
  <url>   an http or https URL; the window opens on it, full screen
  exit 2  bad arguments (message on stderr, no window)
  otherwise it runs until its window closes or the runner stops it
```

```text
packages/qa/runqa.sh [--host <host>] <name> <main|wt> [query-params]
  --host   minibrowser (default) | tauri
  QA_TAURI_BIN   the shell binary, default packages/qa/src-tauri/target/debug/qa-host
```

`--host tauri` behaves exactly like `--host minibrowser` — the same arms, Vite start, URL (with `host=tauri`), result wait, verdict and exit codes — except for the process it checks for and starts. When the binary is missing, the runner exits 2 before Vite starts, with `[<name>] no Tauri host at <path> — build it with: cargo build --manifest-path packages/qa/src-tauri/Cargo.toml`.

---

## Internal Structure

### `packages/qa/src-tauri/`

```text
src-tauri/
  Cargo.toml   Cargo.lock   build.rs   tauri.conf.json   .gitignore
  icons/icon.png
  src/main.rs
```

`Cargo.toml`:

```toml
[package]
name = "qa-host"
version = "0.0.0"
description = "Tauri host for the typescript-ui QA app"
edition = "2021"
rust-version = "1.77.2"
publish = false

[build-dependencies]
tauri-build = { version = "2.6.3", features = [] }

[dependencies]
tauri = { version = "2.11.3", features = [] }
```

`build.rs` is Loom's, unchanged: `fn main() { tauri_build::build() }`.

`tauri.conf.json`:

```json
{
  "productName": "typescript-ui QA",
  "version": "0.0.0",
  "identifier": "com.jimka.typescript-ui.qa",
  "build": {},
  "app": {
    "windows": [],
    "security": { "csp": null }
  },
  "bundle": {
    "active": false,
    "icon": ["icons/icon.png"]
  }
}
```

`.gitignore`:

```text
# Generated by Cargo
/target/
# Generated by tauri-build
/gen/
```

### `src/main.rs`

```rust
use tauri::{Url, WebviewUrl, WebviewWindowBuilder};

/// Label of the one window the shell opens.
const WINDOW_LABEL: &str = "qa";

/// Title of that window; a full-screen window shows it only in task switchers.
const WINDOW_TITLE: &str = "typescript-ui QA";

/// Exit code for bad arguments, matching `runqa.sh`'s "bad arguments" code.
const USAGE_EXIT_CODE: i32 = 2;

fn main() {
    let url = match run_url(std::env::args().skip(1)) {
        Ok(url) => url,
        Err(message) => {
            eprintln!("qa-host: {message}");
            std::process::exit(USAGE_EXIT_CODE);
        }
    };

    tauri::Builder::default()
        .setup(move |app| {
            WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(url))
                .title(WINDOW_TITLE)
                .fullscreen(true)
                .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the QA host");
}

/// The URL the window opens: exactly one argument, parsed as an http or https URL.
fn run_url(args: impl Iterator<Item = String>) -> Result<Url, String> { /* the argument-rule table */ }
```

`run_url` collects the arguments; anything but exactly one returns `usage: qa-host <url>`; a parse failure returns `not a URL: "<arg>"`; a scheme other than `http` or `https` returns `only http and https URLs are allowed, got "<arg>"`. A `#[cfg(test)] mod tests` covers every row of the argument table. Every function carries a `///` doc comment with `# Arguments` / `# Returns` sections where they add information, in the style of Loom's [`lib.rs`](../loom/src-tauri/src/lib.rs#L83).

### `icons/icon.png`

Written once from the repository root, then committed:

```python
import struct, zlib
SIZE = 32                          # px; Tauri needs an RGBA PNG and nothing bundles, so small is enough
PIXEL = bytes([0x2d, 0x6c, 0xdf, 0xff])   # opaque blue, RGBA
rows = b''.join(b'\x00' + PIXEL * SIZE for _ in range(SIZE))
def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(rows))
       + chunk(b'IEND', b''))
open('packages/qa/src-tauri/icons/icon.png', 'wb').write(png)
```

### `packages/qa/runqa.sh`

Only these changes to the runner `qa-app.md` defines:

- `HOSTS="minibrowser tauri"`.
- Beside `MINIBROWSER`: `TAURI_HOST_BIN=${QA_TAURI_BIN:-$QA/src-tauri/target/debug/qa-host}`.
- `check_host`'s `case` gains:

  ```bash
  tauri)
      if [ ! -x "$TAURI_HOST_BIN" ]; then
          echo "[$name] no Tauri host at $TAURI_HOST_BIN — build it with: cargo build --manifest-path packages/qa/src-tauri/Cargo.toml" >&2
          exit 2
      fi
      ;;
  ```

- `start_host`'s `case` gains:

  ```bash
  tauri)
      "$TAURI_HOST_BIN" "$2" > "$QA/logs/host-$name.log" 2>&1 &
      HOST_PID=$!
      ;;
  ```

- `stop_host`'s `case` gains a `tauri)` branch whose body is the `minibrowser)` branch's: kill `HOST_PID` if it is set, then clear it.
- The usage comment lists `tauri`, and its first line after the usage still says every run opens a full-screen window on the desktop.

The unknown-host message becomes `unknown host "<host>" (supported: minibrowser tauri)` through `HOSTS`, with no other change.

---

## Ordered Implementation Steps

1. **Prepare the worktree.** As `qa-app.md` step 1 (node_modules symlinks, `npm run build:lib`). Check `cargo --version` and `pkg-config --modversion webkit2gtk-4.1` both succeed; the second is the system library the shell links.
2. **`packages/qa/src-tauri/Cargo.toml`, `build.rs`, `tauri.conf.json`, `.gitignore`** as under *Internal Structure*.
3. **`packages/qa/src-tauri/icons/icon.png`** — run the script under *Internal Structure* from the repository root. Check: `file packages/qa/src-tauri/icons/icon.png` reports `PNG image data, 32 x 32, 8-bit/color RGBA`.
4. **Tests T1–T4, then `src/main.rs`.** Write the `tests` module first, then `run_url` and `main`.
5. **First build.** `cargo test --manifest-path packages/qa/src-tauri/Cargo.toml`, then `cargo build --manifest-path packages/qa/src-tauri/Cargo.toml`. The first run compiles Tauri, wry and the GTK bindings — roughly 400 crates — and takes several minutes; later builds take seconds. Commit the `Cargo.lock` it writes. Check: `ls packages/qa/src-tauri/target/debug/qa-host`, and `git status --short packages/qa/src-tauri` lists no `target/` or `gen/` path.
6. **Check the engine.** `ldd packages/qa/src-tauri/target/debug/qa-host | grep libwebkit2gtk` and `ldd /usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser | grep libwebkit2gtk` name the same file.
7. **`packages/qa/runqa.sh`** as under *Internal Structure*. Check: `bash -n packages/qa/runqa.sh`.
8. **`packages/qa/README.md`** — a *Tauri host* section: what it is; building it (`cargo build --manifest-path …`, several minutes the first time, rebuild only after editing `src-tauri/`, never for a page or panel change); running with `--host tauri`; `QA_TAURI_BIN`; Linux only, and that Windows and macOS would run a different engine; no WebKit environment overrides, and all arms share any that are set. In the measurement rules, extend the same-host rule: work counts must match across hosts, frame times and geometry are compared only within one host. In the panel table, split `chart-line`'s validation entry into one line per host (`minibrowser`, `tauri`), each with its date, build, census and frame time.
9. **Automated verification** — everything under *Verification* except the manual sweep.
10. **Stop.** Do not start `qa-host` or `runqa.sh --host tauri` against a real run. Report that the manual sweep needs the user's go-ahead.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/qa/src-tauri/Cargo.toml` |
| Create | `packages/qa/src-tauri/Cargo.lock` |
| Create | `packages/qa/src-tauri/build.rs` |
| Create | `packages/qa/src-tauri/tauri.conf.json` |
| Create | `packages/qa/src-tauri/.gitignore` |
| Create | `packages/qa/src-tauri/icons/icon.png` |
| Create | `packages/qa/src-tauri/src/main.rs` |
| Modify | `packages/qa/runqa.sh` |
| Modify | `packages/qa/README.md` |

---

## Expected Behaviour

### Unit-testable (`cargo test`, no window)

- **T1** `run_url` with `["http://localhost:5190/?qa=x&host=tauri"]` returns that URL, query intact.
- **T2** `run_url` with no arguments, and with two, returns `usage: qa-host <url>`.
- **T3** `run_url` with `["not a url"]` returns `not a URL: "not a url"`.
- **T4** `run_url` with `["file:///etc/passwd"]` returns `only http and https URLs are allowed, got "file:///etc/passwd"`; `["https://example.com/"]` is accepted.

### Automated, no window

- `runqa.sh --host bogus x main` exits 2 with `unknown host "bogus" (supported: minibrowser tauri)`, before Vite starts.
- `QA_TAURI_BIN=/nonexistent runqa.sh --host tauri x main` exits 2 with the build hint naming `/nonexistent`, before Vite starts: nothing listens on port 5190 afterwards.
- The QA app's typecheck and tests still pass with the built shell in place, and no test is found under `src-tauri/`; `git check-ignore packages/qa/src-tauri/target packages/qa/src-tauri/gen` prints both paths.

### Manual only (opens full-screen windows; needs the user's go-ahead)

- **M1 same census, both hosts.** `passes` with `seam=1&count=1` on `chart-line` gives, per pass, under both `--host minibrowser` and `--host tauri`: `seam.sink` = `{ apply: 241, createElementNS: 210, appendChild: 210, removeChild: 210, release: 210 }`, `seam.source.measureText` = 12, and `writes` `mut.g.addedNodes` = `mut.g.removedNodes` = 210.
- **M2 same work, per-host timing.** `resize` with `seam=1&work=1&geom=1`: the per-frame `seam` and `work` maps are identical across the two hosts; two Tauri runs have `geom` `=` against each other; each host's frame time is reported under its own `host` value.
- **M3 host recorded.** Every report's `host` is the runner's `--host` value, and `qa-table.py`'s `host` column shows it.
- **M4 fast failure.** `--host tauri` with `drive=nope` exits 1 within seconds of the page loading, printing `ERROR unknown driver "nope"`, and the window is gone.

---

## Verification

### Automated (the implementer runs these; none opens a window)

1. `cargo test --manifest-path packages/qa/src-tauri/Cargo.toml` — T1–T4. Several minutes the first time.
2. `cargo build --manifest-path packages/qa/src-tauri/Cargo.toml` — produces the binary; building opens nothing.
3. Step 6's `ldd` comparison.
4. `npm -w packages/qa run typecheck` and `npm -w packages/qa run test`.
5. `bash -n packages/qa/runqa.sh`; the two runner checks under *Expected Behaviour*; afterwards `ss -ltn | grep -c ':5190 '` is `0`.
6. `git check-ignore packages/qa/src-tauri/target packages/qa/src-tauri/gen` prints both.

### Manual sweep (only with the user's go-ahead)

**Every command below opens a full-screen window on the user's desktop. An implementer or agent must not run it.** Each host's runs get their own name prefix, so `qa-table.py`'s `geom` reference is always a run of the same host.

```sh
Q=packages/qa/runqa.sh
$Q --host minibrowser mb-pass     main 'panel=chart-line&drive=passes:10&seam=1&count=1'     || exit 1
$Q --host tauri       ta-pass     main 'panel=chart-line&drive=passes:10&seam=1&count=1'     || exit 1
$Q --host tauri       ta-resize-a main 'panel=chart-line&drive=resize&seam=1&work=1&geom=1'  || exit 1
$Q --host minibrowser mb-resize   main 'panel=chart-line&drive=resize&seam=1&work=1&geom=1'  || exit 1
$Q --host tauri       ta-resize-b main 'panel=chart-line&drive=resize&seam=1&work=1&geom=1'  || exit 1
$Q --host tauri       ta-fail     main 'panel=chart-line&drive=nope'; echo "exit $?"          # M4: exit 1
python3 packages/qa/bin/qa-table.py packages/qa/results mb- --seam
python3 packages/qa/bin/qa-table.py packages/qa/results ta- --seam
```

Accept when M1–M4 hold. Record the Tauri census and each host's frame time in the README's panel table. If the Tauri census differs from MiniBrowser's, the two hosts are not running the same code path, and the Tauri host is not validated until that is explained.

---

## Documentation Impact

- No public API change; nothing is exported from `@jimka/typescript-ui`.
- `packages/qa/README.md` gains the *Tauri host* section and the extended same-host rule (step 8).

---

## Potential Challenges

- **The first build is slow and large.** Several minutes and several gigabytes under `target/`; start it before anything that waits on it, and never inside a measurement sweep.
- **A blank or black Tauri window on some machines.** Known WebKitGTK compositing issues are usually worked around with `WEBKIT_DISABLE_DMABUF_RENDERER=1`; setting it changes the rendering path, so it applies to every arm and is recorded in the sweep's notes. Loom's shell needs none on this machine.
- **A stale binary.** Only `src-tauri/` changes need a rebuild; the page, harness and panels load from the dev server at run time.
- **A window manager that refuses full screen** gives the page a smaller viewport. `before.viewport` records the size the page actually got; runs with different viewports are not comparable, even on one host.

---

## Critical Files

- [`plans/qa-app.md`](plans/qa-app.md) — the runner's host switch (*The runner has a host switch*, and `check_host`, `start_host` and `stop_host` under `packages/qa/runqa.sh` in *Internal Structure*), the stop-on-result flow, the `host` report field, and *Vite and Vitest see only the app's own source*, which keeps `src-tauri/` out of the app's tools.
- [`../loom/src-tauri/Cargo.toml`](../loom/src-tauri/Cargo.toml#L1), [`tauri.conf.json`](../loom/src-tauri/tauri.conf.json#L1), [`build.rs`](../loom/src-tauri/build.rs#L1), [`src/main.rs`](../loom/src-tauri/src/main.rs#L1), [`src/lib.rs`](../loom/src-tauri/src/lib.rs#L51), [`.gitignore`](../loom/src-tauri/.gitignore#L1) — the working Tauri 2 precedent.
- `~/.cargo/registry/src/index.crates.io-*/tauri-2.11.5/src/webview/webview_window.rs` — `WebviewWindowBuilder::new` (:101), `fullscreen` (:528).
- `~/.cargo/registry/src/index.crates.io-*/tauri-macros-2.6.3/src/context.rs:155` and `tauri-codegen-2.6.3/src/context.rs:176–245` — dev mode and the icon requirement.

---

## Non-Goals

- **Windows and macOS Tauri hosts.** They would measure WebView2 and WKWebView, and the runner is Linux-only.
- **Building the shell in CI.** It needs the WebKitGTK development packages and several minutes per run; the Rust unit tests are four small cases and run locally.
- **Tauri plugins, IPC, capabilities, a bundled app or a release build.** The page uses none of them.
- **Comparing frame times between hosts.**
- **Changing the page, the harness or any panel.**

---

## Notes

[^minimal]: The coordinator's facts: the QA page needs no plugins, panels are self-contained, and results POST to the Vite dev server, which is same-origin when the webview loads the dev-server URL. Every Loom addition serves Loom's file access (`fs` scope mirroring, `grant_project_scope`), its dialogs, or GTK dialog icons, and none applies. Without a capabilities file the external page gets no IPC access at all, which is what a measurement page should have. `security.csp: null` is Loom's setting; Tauri injects no CSP into an external URL either way.

[^url-at-launch]: `tauri::generate_context!()` compiles `tauri.conf.json` into the binary, including `devUrl` and any configured windows, so a per-run query string there would force a rebuild per run. `WebviewUrl::External(Url)` loads any URL the process chooses at run time, and `WebviewWindowBuilder` in `setup` is the documented way to create a window from code (its doc example at `webview_window.rs:78–82`). A command-line argument was chosen over an environment variable because it mirrors MiniBrowser's command line, shows in `ps`, and cannot leak into a child process. Tauri does not parse `argv` itself without the CLI plugin, and tao's GTK initialisation does not read it either, so a URL starting with `http` is never mistaken for a GTK option. Checking the argument before `tauri::Builder` runs means a bad argument never opens a window.

[^cargo-not-cli]: `tauri-macros` sets `dev: cfg!(not(feature = "custom-protocol"))` (context.rs:155), and plain `cargo build` does not enable `custom-protocol`. In dev mode with neither `devUrl` nor `frontendDist`, `tauri-codegen` embeds no assets (context.rs:176–205). The CLI's `tauri build` enables `custom-protocol`, so it needs a built `frontendDist` and bundles an installer, neither of which the QA app has or needs. `tauri dev` starts `beforeDevCommand` and watches files, taking over what the runner already does. The CLI's remaining use, generating icons, is replaced by one PNG. So the CLI would add a Node dependency (`@tauri-apps/cli`, which Loom keeps in `devDependencies`) and do nothing a run needs. A debug build is enough: the Rust shell runs no per-frame code, and the engine is the system WebKitGTK library either way.

[^runner-stops]: The page could close itself — wry destroys the webview when a page calls `window.close()` (wry `webkitgtk/mod.rs:460`) — but that would make the page behave differently per host, which `qa-app.md` rules out, and the runner would still need its own stop for a run that hangs, crashes or never reports. The runner's stop-on-result already covers every case for every host, so a second exit path adds nothing. Full screen matches the MiniBrowser runs, so both hosts give the page the whole screen.

[^icon]: `tauri-codegen` resolves the default window icon from the first `.png` in `bundle.icon`, else `icons/icon.png`, and fails the build if the file is missing (context.rs:211–245). With `bundle.active: false`, nothing else reads icons. Generating the full icon set would need the Tauri CLI's `icon` command; copying Loom's would put Loom's branding on this window. A plain square is enough: a full-screen window's icon shows only in a task switcher.

[^engine]: Verified on this machine: Loom's built Tauri binary and `/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser` both link `/lib/x86_64-linux-gnu/libwebkit2gtk-4.1.so.0` (package `libwebkit2gtk-4.1-0` 2.50.4), and wry 0.55.1 depends on `webkit2gtk` 2.0.2, the 4.1 API bindings. The machine is WSL2 with WSLg, where both MiniBrowser and Loom's Tauri shell already open windows. The runner uses Linux paths and `ss`, so a Windows or macOS host would need its own runner work besides a different engine.

[^within-host]: The two hosts share the WebKitGTK library but not its configuration. wry sets its own WebKit settings — WebGL, web audio, the page cache, developer extras in debug builds, non-system scrollbar appearance, no input preedit (wry `webkitgtk/mod.rs:414–447`) — while MiniBrowser sets its own, and the two windows are created by different GTK code. Any of these can move a frame time or a scrollbar-dependent rectangle. None of them changes which library methods run for a given page, so the counts must agree; a difference there would mean the hosts ran different code, not different speeds.

[^build-output]: A Tauri debug build's `target/` holds thousands of directories: Loom's, with release and cross builds, has some 3,500 directories and 23,000 files. By default Vite's watcher, its dependency scan and Vitest's test discovery would all walk that tree from the `packages/qa` root. `qa-app`'s watch list (`index.html`, `src/`, `tests/`), its scan entry (`index.html`) and its `vitest run --dir tests` keep all three inside the app's own files, so `src-tauri/` needs nothing of its own. `/gen/` holds the schemas `tauri-build` writes on every build.

[^no-env]: The coordinator's fact: Loom's shell uses no WebKit environment overrides and runs on this machine. Setting one in the runner would make Tauri runs differ from MiniBrowser runs for a reason unrelated to the host itself.
