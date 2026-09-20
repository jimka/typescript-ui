use std::ffi::OsString;

use tauri::{Url, WebviewUrl, WebviewWindowBuilder};

/// Label of the one window the shell opens.
const WINDOW_LABEL: &str = "qa";

/// Title of that window; a full-screen window shows it only in task switchers.
const WINDOW_TITLE: &str = "typescript-ui QA";

/// Exit code for bad arguments, matching `runqa.sh`'s "bad arguments" code.
const USAGE_EXIT_CODE: i32 = 2;

/// Opens one full-screen window on the URL given as the only argument, and
/// runs until that window closes or the process is stopped. A bad argument
/// exits with [`USAGE_EXIT_CODE`] before Tauri starts, so it never opens a
/// window.
fn main() {
    let url = match run_url(std::env::args_os().skip(1)) {
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

/// The URL the window opens: exactly one argument, parsed as an http or
/// https URL. The arguments are taken as the OS gives them, so an argument
/// that is not valid UTF-8 is refused as not a URL instead of panicking.
///
/// # Arguments
///
/// * `args` - The command-line arguments after the program name.
///
/// # Returns
///
/// The parsed URL, or the message to print after `qa-host: ` for a wrong
/// argument count, an argument that is not a URL, or a scheme other than
/// `http` or `https`.
fn run_url(args: impl Iterator<Item = OsString>) -> Result<Url, String> {
    let args: Vec<OsString> = args.collect();

    let [arg] = args.as_slice() else {
        return Err("usage: qa-host <url>".to_string());
    };

    let not_a_url = || format!("not a URL: \"{}\"", arg.to_string_lossy());
    let text = arg.to_str().ok_or_else(not_a_url)?;
    let url = Url::parse(text).map_err(|_| not_a_url())?;

    match url.scheme() {
        "http" | "https" => Ok(url),
        _ => Err(format!(
            "only http and https URLs are allowed, got \"{text}\""
        )),
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use super::run_url;

    /// `run_url` over the given arguments, as `main` passes them.
    ///
    /// # Arguments
    ///
    /// * `args` - The arguments after the program name.
    ///
    /// # Returns
    ///
    /// Whatever `run_url` returns for them.
    fn run_url_of(args: &[&str]) -> Result<String, String> {
        run_url(args.iter().map(|arg| OsString::from(*arg))).map(|url| url.to_string())
    }

    /// T1: one http URL is returned as given, query intact.
    #[test]
    fn accepts_an_http_url_with_its_query() {
        assert_eq!(
            run_url_of(&["http://localhost:5190/?qa=x&host=tauri"]),
            Ok("http://localhost:5190/?qa=x&host=tauri".to_string())
        );
    }

    /// T2: no argument, or more than one, is a usage error.
    #[test]
    fn rejects_anything_but_one_argument() {
        let usage = Err("usage: qa-host <url>".to_string());

        assert_eq!(run_url_of(&[]), usage);

        assert_eq!(
            run_url_of(&["http://localhost:5190/", "http://localhost:5190/"]),
            usage
        );
    }

    /// T3: an argument that does not parse as a URL is named in the error.
    #[test]
    fn rejects_an_argument_that_is_not_a_url() {
        assert_eq!(
            run_url_of(&["not a url"]),
            Err("not a URL: \"not a url\"".to_string())
        );
    }

    /// A non-UTF-8 argument is not a URL, even when the rest of it would
    /// parse as one; the error shows it with the bad bytes replaced.
    #[cfg(unix)]
    #[test]
    fn rejects_an_argument_that_is_not_utf8() {
        use std::os::unix::ffi::OsStringExt;

        // 0x80 is a UTF-8 continuation byte with no lead byte before it, the
        // shortest way to make an argument that is not valid UTF-8.
        let arg = OsString::from_vec(b"http://localhost:5190/?qa=\x80".to_vec());

        assert_eq!(
            run_url(std::iter::once(arg)).map(|url| url.to_string()),
            Err("not a URL: \"http://localhost:5190/?qa=\u{FFFD}\"".to_string())
        );
    }

    /// T4: only http and https are accepted.
    #[test]
    fn accepts_only_http_and_https() {
        assert_eq!(
            run_url_of(&["file:///etc/passwd"]),
            Err("only http and https URLs are allowed, got \"file:///etc/passwd\"".to_string())
        );

        assert_eq!(
            run_url_of(&["https://example.com/"]),
            Ok("https://example.com/".to_string())
        );
    }
}
