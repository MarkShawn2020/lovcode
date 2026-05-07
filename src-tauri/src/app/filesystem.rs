use super::*;

// ============================================================================
// Directory Listing
// ============================================================================

#[derive(Debug, Clone, serde::Serialize)]
pub(crate) struct DirEntry {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) is_dir: bool,
}

/// Get file metadata (size, modified time, is_dir)
pub(crate) fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let file_path = PathBuf::from(&path);

    if !file_path.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    let metadata =
        fs::metadata(&file_path).map_err(|e| format!("Failed to get metadata: {}", e))?;

    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    Ok(FileMetadata {
        size: metadata.len(),
        modified,
        is_dir: metadata.is_dir(),
    })
}

#[derive(serde::Serialize)]
pub(crate) struct FileMetadata {
    pub(crate) size: u64,
    pub(crate) modified: Option<u64>,
    pub(crate) is_dir: bool,
}

#[derive(serde::Serialize)]
pub(crate) struct ArchiveListing {
    pub(crate) entries: Vec<ArchiveEntry>,
    pub(crate) total_entries: usize,
    pub(crate) truncated: bool,
}

#[derive(serde::Serialize)]
pub(crate) struct ArchiveEntry {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) is_dir: bool,
    pub(crate) size: u64,
    pub(crate) compressed_size: u64,
}

pub(crate) fn contains_cjk(text: &str) -> bool {
    text.chars().any(|ch| {
        ('\u{3400}'..='\u{4DBF}').contains(&ch)
            || ('\u{4E00}'..='\u{9FFF}').contains(&ch)
            || ('\u{F900}'..='\u{FAFF}').contains(&ch)
    })
}

pub(crate) fn decode_zip_entry_name(entry: &zip::read::ZipFile<'_>) -> String {
    let raw = entry.name_raw();
    if let Ok(name) = std::str::from_utf8(raw) {
        return name.to_string();
    }

    let (decoded, _, had_errors) = encoding_rs::GB18030.decode(raw);
    if !had_errors && contains_cjk(decoded.as_ref()) {
        return decoded.into_owned();
    }

    entry.name().to_string()
}

/// Read file contents
pub(crate) fn read_file(path: String) -> Result<String, String> {
    let file_path = PathBuf::from(&path);

    if !file_path.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    if !file_path.is_file() {
        return Err(format!("Not a file: {}", path));
    }

    let bytes = fs::read(&file_path).map_err(|e| format!("Failed to read file: {}", e))?;
    String::from_utf8(bytes)
        .map_err(|_| "Cannot preview this file as text because it is not valid UTF-8.".to_string())
}

/// List ZIP archive contents without extracting files.
pub(crate) fn list_zip_entries(
    path: String,
    limit: Option<usize>,
) -> Result<ArchiveListing, String> {
    let file_path = PathBuf::from(&path);

    if !file_path.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    if !file_path.is_file() {
        return Err(format!("Not a file: {}", path));
    }

    let file = fs::File::open(&file_path).map_err(|e| format!("Failed to open ZIP: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Failed to read ZIP archive: {}", e))?;
    let total_entries = archive.len();
    let max_entries = limit.unwrap_or(1000).clamp(1, 5000);
    let mut entries = Vec::new();

    for i in 0..std::cmp::min(total_entries, max_entries) {
        let entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry {}: {}", i, e))?;
        let path = decode_zip_entry_name(&entry);
        let trimmed = path.trim_end_matches('/');
        let name = trimmed
            .rsplit('/')
            .next()
            .filter(|value| !value.is_empty())
            .unwrap_or(&path)
            .to_string();

        entries.push(ArchiveEntry {
            name,
            is_dir: path.ends_with('/') || entry.is_dir(),
            path,
            size: entry.size(),
            compressed_size: entry.compressed_size(),
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.path.to_lowercase().cmp(&b.path.to_lowercase()),
    });

    Ok(ArchiveListing {
        entries,
        total_entries,
        truncated: total_entries > max_entries,
    })
}

/// List directory contents (non-recursive, respects .gitignore patterns)
pub(crate) fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let dir_path = PathBuf::from(&path);

    if !dir_path.exists() {
        return Err(format!("Directory does not exist: {}", path));
    }

    if !dir_path.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    // Common patterns to ignore
    let ignore_patterns = [
        ".git",
        "node_modules",
        ".DS_Store",
        "target",
        "dist",
        "build",
        ".next",
        ".nuxt",
        ".output",
        "__pycache__",
        ".pytest_cache",
        ".venv",
        "venv",
        ".idea",
        ".vscode",
        "*.pyc",
        ".turbo",
    ];

    let mut entries: Vec<DirEntry> = Vec::new();

    let read_dir =
        fs::read_dir(&dir_path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in read_dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip ignored patterns
        if ignore_patterns.iter().any(|p| {
            if p.starts_with("*.") {
                name.ends_with(&p[1..])
            } else {
                name == *p
            }
        }) {
            continue;
        }

        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);

        entries.push(DirEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir,
        });
    }

    // Sort: directories first, then alphabetically
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}
