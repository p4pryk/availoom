//! Session diagnostics only. Never claims to retrieve subscription quota.
use serde::Serialize;
use serde_json::Value;
use std::process::Stdio;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStatus {
    installed: bool,
    logged_in: bool,
    source: &'static str,
    host: Option<String>,
}
fn external_host(raw: Option<&str>) -> Option<String> {
    let url = tauri::Url::parse(raw?).ok()?;
    let host = url.host_str()?;
    (host != "api.anthropic.com").then(|| host.to_owned())
}
#[tauri::command]
pub async fn inspect_claude() -> Result<ClaudeStatus, String> {
    let path = crate::codex::discover_tool("claude").into_iter().next();
    let settings = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".claude")));
    // Only the provider hostname leaves this function; no configuration or token is logged.
    let config: Value = settings
        .and_then(|p| std::fs::read(p.join("settings.json")).ok())
        .and_then(|s| serde_json::from_slice(&s).ok())
        .unwrap_or(Value::Null);
    let environment = std::env::var("ANTHROPIC_BASE_URL").ok();
    let host = external_host(
        environment
            .as_deref()
            .or(config["env"]["ANTHROPIC_BASE_URL"].as_str()),
    );
    let mut result = ClaudeStatus {
        installed: path.is_some(),
        logged_in: false,
        source: if host.is_some() {
            "external"
        } else {
            "unknown"
        },
        host,
    };
    let Some(path) = path else {
        return Ok(result);
    };
    // External sessions cannot establish a Claude subscription. No process needed.
    if result.host.is_some() {
        return Ok(result);
    }
    let parent = std::path::Path::new(&path).parent().ok_or("cli_missing")?;
    let mut paths = vec![parent.to_path_buf()];
    if let Some(env) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&env));
    }
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::process::Command::new(&path)
            .args(["auth", "status", "--json"])
            .env(
                "PATH",
                std::env::join_paths(paths).map_err(|_| "cli_missing")?,
            )
            .current_dir(std::env::temp_dir())
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "timeout")?
    .map_err(|_| "cli_missing")?;
    let auth: Value = serde_json::from_slice(&output.stdout).map_err(|_| "format_changed")?;
    result.logged_in = auth["loggedIn"].as_bool().unwrap_or(false);
    if auth["authMethod"] == "claude.ai" && auth["apiProvider"] == "firstParty" {
        result.source = "claude";
    }
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strips_credentials_paths_and_query_from_provider_diagnostic() {
        assert_eq!(
            external_host(Some(
                "https://secret:token@api.z.ai/api/anthropic?key=secret"
            )),
            Some("api.z.ai".into())
        );
    }
    #[test]
    fn only_exact_official_host_is_native() {
        assert_eq!(external_host(Some("https://api.anthropic.com")), None);
        assert_eq!(
            external_host(Some("https://api.anthropic.com.example.org")),
            Some("api.anthropic.com.example.org".into())
        );
        assert_eq!(external_host(None), None);
    }
}
