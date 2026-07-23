---
"lovcode": patch
---

Fix project-path decoding for projects whose directory name contains a hyphen. The fallback in `decode_project_path` now enumerates every contiguous segment range and merges with `-` (not only a prefix), so middle-of-path names like `.../git/<with-dashes>/` resolve to a real directory instead of being split across two segments.
