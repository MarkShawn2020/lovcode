use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TechStack {
    pub runtime: String, // node, python, rust, unknown
    pub package_manager: Option<String>,
    pub orm: Option<String>,
    pub frameworks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeakedSecret {
    pub file: String,
    pub line: usize,
    pub key_name: String,
    pub preview: String, // 脱敏预览
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvCheckResult {
    pub missing_keys: Vec<String>,
    pub leaked_secrets: Vec<LeakedSecret>,
    pub env_example_exists: bool,
    pub env_exists: bool,
}

/// 检测项目技术栈
pub fn detect_tech_stack(project_path: &str) -> Result<TechStack, String> {
    let path = Path::new(project_path);

    let mut stack = TechStack {
        runtime: "unknown".to_string(),
        package_manager: None,
        orm: None,
        frameworks: Vec::new(),
    };

    // Node.js 检测
    let package_json_path = path.join("package.json");
    if package_json_path.exists() {
        stack.runtime = "node".to_string();

        // 检测包管理器
        if path.join("pnpm-lock.yaml").exists() {
            stack.package_manager = Some("pnpm".to_string());
        } else if path.join("yarn.lock").exists() {
            stack.package_manager = Some("yarn".to_string());
        } else if path.join("package-lock.json").exists() {
            stack.package_manager = Some("npm".to_string());
        } else if path.join("bun.lockb").exists() {
            stack.package_manager = Some("bun".to_string());
        }

        // 解析 package.json 检测 ORM 和框架
        if let Ok(content) = fs::read_to_string(&package_json_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                let deps = json
                    .get("dependencies")
                    .and_then(|v| v.as_object())
                    .map(|m| m.keys().cloned().collect::<Vec<_>>())
                    .unwrap_or_default();

                let dev_deps = json
                    .get("devDependencies")
                    .and_then(|v| v.as_object())
                    .map(|m| m.keys().cloned().collect::<Vec<_>>())
                    .unwrap_or_default();

                let all_deps: HashSet<_> = deps.iter().chain(dev_deps.iter()).collect();

                // ORM 检测
                if all_deps.contains(&"prisma".to_string())
                    || all_deps.contains(&"@prisma/client".to_string())
                {
                    stack.orm = Some("prisma".to_string());
                } else if all_deps.contains(&"drizzle-orm".to_string()) {
                    stack.orm = Some("drizzle".to_string());
                } else if all_deps.contains(&"typeorm".to_string()) {
                    stack.orm = Some("typeorm".to_string());
                } else if all_deps.contains(&"sequelize".to_string()) {
                    stack.orm = Some("sequelize".to_string());
                }

                // 框架检测
                if all_deps.contains(&"next".to_string()) {
                    stack.frameworks.push("Next.js".to_string());
                }
                if all_deps.contains(&"react".to_string()) {
                    stack.frameworks.push("React".to_string());
                }
                if all_deps.contains(&"vue".to_string()) {
                    stack.frameworks.push("Vue".to_string());
                }
                if all_deps.contains(&"express".to_string()) {
                    stack.frameworks.push("Express".to_string());
                }
                if all_deps.contains(&"@tauri-apps/api".to_string()) {
                    stack.frameworks.push("Tauri".to_string());
                }
                if all_deps.contains(&"vite".to_string()) {
                    stack.frameworks.push("Vite".to_string());
                }
            }
        }
    }

    // Python 检测
    let pyproject_path = path.join("pyproject.toml");
    let requirements_path = path.join("requirements.txt");
    if pyproject_path.exists() || requirements_path.exists() {
        if stack.runtime == "unknown" {
            stack.runtime = "python".to_string();
        } else {
            stack.runtime = format!("{}/python", stack.runtime);
        }

        // 检测包管理器
        if path.join("poetry.lock").exists() {
            stack.package_manager = Some("poetry".to_string());
        } else if path.join("Pipfile.lock").exists() {
            stack.package_manager = Some("pipenv".to_string());
        } else if path.join("uv.lock").exists() {
            stack.package_manager = Some("uv".to_string());
        }

        // 检测 ORM (从 pyproject.toml 或 requirements.txt)
        let deps_content = if pyproject_path.exists() {
            fs::read_to_string(&pyproject_path).unwrap_or_default()
        } else {
            fs::read_to_string(&requirements_path).unwrap_or_default()
        };

        if deps_content.contains("alembic") {
            stack.orm = Some("alembic".to_string());
        } else if deps_content.contains("django") {
            stack.orm = Some("django".to_string());
            stack.frameworks.push("Django".to_string());
        } else if deps_content.contains("sqlalchemy") {
            stack.orm = Some("sqlalchemy".to_string());
        }

        if deps_content.contains("fastapi") {
            stack.frameworks.push("FastAPI".to_string());
        }
        if deps_content.contains("flask") {
            stack.frameworks.push("Flask".to_string());
        }
    }

    // Rust 检测
    let cargo_path = path.join("Cargo.toml");
    if cargo_path.exists() {
        if stack.runtime == "unknown" {
            stack.runtime = "rust".to_string();
        } else {
            stack.runtime = format!("{}/rust", stack.runtime);
        }
        stack.package_manager = Some("cargo".to_string());

        if let Ok(content) = fs::read_to_string(&cargo_path) {
            if content.contains("sqlx") {
                stack.orm = Some("sqlx".to_string());
            } else if content.contains("diesel") {
                stack.orm = Some("diesel".to_string());
            } else if content.contains("sea-orm") {
                stack.orm = Some("sea-orm".to_string());
            }

            if content.contains("tauri") {
                stack.frameworks.push("Tauri".to_string());
            }
            if content.contains("actix") {
                stack.frameworks.push("Actix".to_string());
            }
            if content.contains("axum") {
                stack.frameworks.push("Axum".to_string());
            }
        }
    }

    Ok(stack)
}

/// 检查环境变量
pub fn check_env_vars(project_path: &str) -> Result<EnvCheckResult, String> {
    let path = Path::new(project_path);
    let env_example_path = path.join(".env.example");
    let env_path = path.join(".env");

    let env_example_exists = env_example_path.exists();
    let env_exists = env_path.exists();

    let mut missing_keys = Vec::new();
    let mut leaked_secrets = Vec::new();

    // 检查 .env.example vs .env 的完整性
    if env_example_exists && env_exists {
        let example_keys = parse_env_keys(&env_example_path);
        let env_keys = parse_env_keys(&env_path);

        for key in example_keys {
            if !env_keys.contains(&key) {
                missing_keys.push(key);
            }
        }
    } else if env_example_exists && !env_exists {
        // .env 不存在，所有 example 的 key 都算 missing
        missing_keys = parse_env_keys(&env_example_path);
    }

    // 扫描源代码中的敏感信息泄露
    leaked_secrets = scan_for_leaked_secrets(path);

    Ok(EnvCheckResult {
        missing_keys,
        leaked_secrets,
        env_example_exists,
        env_exists,
    })
}

fn parse_env_keys(path: &Path) -> Vec<String> {
    let mut keys = Vec::new();
    if let Ok(content) = fs::read_to_string(path) {
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some(pos) = line.find('=') {
                let key = line[..pos].trim().to_string();
                if !key.is_empty() {
                    keys.push(key);
                }
            }
        }
    }
    keys
}

fn scan_for_leaked_secrets(project_path: &Path) -> Vec<LeakedSecret> {
    let mut secrets = Vec::new();

    // 敏感信息正则 - 匹配硬编码的 API keys, tokens, passwords
    let secret_pattern = Regex::new(
        r#"(?i)(api[_-]?key|secret|password|token|credential|private[_-]?key)\s*[=:]\s*['"]([\w\-_./+=]{8,})['""]"#
    ).unwrap();

    // 要扫描的文件扩展名
    let scan_extensions = ["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "rb"];

    // 要排除的目录
    let exclude_dirs = ["node_modules", "target", ".git", "dist", "build", "__pycache__", ".venv", "venv"];

    scan_directory(project_path, &secret_pattern, &scan_extensions, &exclude_dirs, &mut secrets);

    secrets
}

fn scan_directory(
    dir: &Path,
    pattern: &Regex,
    extensions: &[&str],
    exclude_dirs: &[&str],
    secrets: &mut Vec<LeakedSecret>,
) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = path.file_name().unwrap_or_default().to_string_lossy();

        if path.is_dir() {
            // 跳过排除目录
            if exclude_dirs.iter().any(|&d| file_name == d) {
                continue;
            }
            scan_directory(&path, pattern, extensions, exclude_dirs, secrets);
        } else if path.is_file() {
            // 检查扩展名
            let ext = path.extension().unwrap_or_default().to_string_lossy();
            if !extensions.iter().any(|&e| ext == e) {
                continue;
            }

            // 跳过测试文件和配置示例
            if file_name.contains(".test.") || file_name.contains(".spec.") || file_name.contains(".example") {
                continue;
            }

            // 扫描文件内容
            if let Ok(content) = fs::read_to_string(&path) {
                for (line_num, line) in content.lines().enumerate() {
                    // 跳过注释行
                    let trimmed = line.trim();
                    if trimmed.starts_with("//") || trimmed.starts_with("#") || trimmed.starts_with("*") {
                        continue;
                    }

                    for cap in pattern.captures_iter(line) {
                        let key_name = cap.get(1).map(|m| m.as_str()).unwrap_or("unknown");
                        let value = cap.get(2).map(|m| m.as_str()).unwrap_or("");

                        // 过滤掉明显的占位符
                        if value.contains("your_") || value.contains("xxx") || value.contains("placeholder") || value == "undefined" || value == "null" {
                            continue;
                        }

                        // 脱敏预览
                        let preview = if value.len() > 8 {
                            format!("{}...{}", &value[..4], &value[value.len()-4..])
                        } else {
                            "****".to_string()
                        };

                        secrets.push(LeakedSecret {
                            file: path.strip_prefix(dir.parent().unwrap_or(dir))
                                .unwrap_or(&path)
                                .to_string_lossy()
                                .to_string(),
                            line: line_num + 1,
                            key_name: key_name.to_string(),
                            preview,
                        });
                    }
                }
            }
        }
    }
}
