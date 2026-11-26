use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

use tauri::{
    http::{header, Method, Request, Response, StatusCode},
    AppHandle, Manager,
};

use crate::state::SettingsWrapper;

const CHUNK: u64 = 4 * 1024 * 1024;

pub(super) fn authorized(path: &Path, roots: &[PathBuf]) -> Option<PathBuf> {
    let file = path.canonicalize().ok()?;
    if !file.extension()?.eq_ignore_ascii_case("mp4") || !file.is_file() {
        return None;
    }
    roots
        .iter()
        .filter_map(|root| root.canonicalize().ok())
        .any(|root| file.starts_with(root))
        .then_some(file)
}

pub fn serve(app: &AppHandle, is_main: bool, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let empty = |status| Response::builder().status(status).body(Vec::new()).unwrap();
    if !is_main {
        return empty(StatusCode::FORBIDDEN);
    }
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return empty(StatusCode::METHOD_NOT_ALLOWED);
    }
    let Some(path) = request.uri().path().strip_prefix('/') else {
        return empty(StatusCode::NOT_FOUND);
    };
    let Ok(path) = percent_encoding::percent_decode_str(path).decode_utf8() else {
        return empty(StatusCode::BAD_REQUEST);
    };
    let settings = app.state::<SettingsWrapper>().get_settings();
    let Some(path) = authorized(
        Path::new(path.as_ref()),
        &[settings.recordings_folder, settings.clips_folder],
    ) else {
        return empty(StatusCode::NOT_FOUND);
    };
    let Ok(mut file) = File::open(path) else {
        return empty(StatusCode::NOT_FOUND);
    };
    let Ok(metadata) = file.metadata() else {
        return empty(StatusCode::NOT_FOUND);
    };
    let size = metadata.len();
    let range = request.headers().get(header::RANGE);
    let head = request.method() == Method::HEAD;
    let mut response = Response::builder()
        .header(header::CONTENT_TYPE, "video/mp4")
        .header(header::ACCEPT_RANGES, "bytes");
    if head || (range.is_none() && size <= CHUNK) {
        response = response.header(header::CONTENT_LENGTH, size);
        let mut body = Vec::new();
        if !head && file.take(CHUNK).read_to_end(&mut body).is_err() {
            return empty(StatusCode::INTERNAL_SERVER_ERROR);
        }
        return response.body(body).unwrap();
    }
    let span = if let Some(range) = range {
        range.to_str().ok().and_then(|range| parse_range(range, size))
    } else {
        Some((0, CHUNK - 1))
    };
    let Some((start, end)) = span else {
        return response
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{size}"))
            .body(Vec::new())
            .unwrap();
    };
    let mut body = Vec::new();
    if file
        .seek(SeekFrom::Start(start))
        .and_then(|_| file.take(end - start + 1).read_to_end(&mut body))
        .is_err()
        || body.len() as u64 != end - start + 1
    {
        return empty(StatusCode::INTERNAL_SERVER_ERROR);
    }
    response
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"))
        .header(header::CONTENT_LENGTH, body.len())
        .body(body)
        .unwrap()
}

fn parse_range(value: &str, size: u64) -> Option<(u64, u64)> {
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    let last = size.checked_sub(1)?;
    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?.min(CHUNK);
        return (suffix > 0).then_some((size.saturating_sub(suffix), last));
    }
    let start = start.parse::<u64>().ok()?;
    let end = if end.is_empty() {
        last
    } else {
        end.parse::<u64>().ok()?.min(last)
    };
    (start <= end).then_some((start, end.min(start.saturating_add(CHUNK - 1))))
}

#[cfg(test)]
mod tests {
    use super::{parse_range, CHUNK};
    #[test]
    fn supports_seek_ranges_and_rejects_invalid_ranges() {
        assert_eq!(parse_range("bytes=200-", 500), Some((200, 499)));
        assert_eq!(parse_range("bytes=-20", 500), Some((480, 499)));
        assert_eq!(parse_range("bytes=500-", 500), None);
        assert_eq!(parse_range("bytes=0-1,4-5", 500), None);
        assert_eq!(parse_range("bytes=1-", CHUNK * 2), Some((1, CHUNK)));
    }
}
