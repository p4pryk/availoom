//! Read-only App Server adapter. No authentication files are read by Availoom.
//! The caller requires session consent. Each read verifies identity; no login or model prompts.
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
};

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Quota {
    pub pool_id: String,
    pub pool_label: String,
    pub used: Option<f64>,
    pub remaining: Option<f64>,
    pub window_duration: Option<u64>,
    pub resets_at: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    pub account_ref: String,
    pub account_label: String,
    pub plan_label: Option<String>,
    pub fetched_at: u64,
    pub source_kind: &'static str,
    pub quotas: Vec<Quota>,
}

pub fn discover() -> Vec<String> {
    discover_tool("codex")
}
pub fn discover_tool(tool: &str) -> Vec<String> {
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|s| std::env::split_paths(&s).collect())
        .unwrap_or_default();
    #[cfg(not(target_os = "windows"))]
    paths.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        paths.push(home.join(".local/bin"));
        // Discover executable paths only. Never inspect CLI configuration or credentials.
        if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
            let mut nodes: Vec<_> = entries.flatten().map(|e| e.path().join("bin")).collect();
            nodes.sort();
            nodes.reverse();
            paths.extend(nodes);
        }
    }
    let name = if cfg!(windows) {
        format!("{tool}.exe")
    } else {
        tool.to_owned()
    };
    let mut found = Vec::new();
    for dir in paths {
        let p = dir.join(&name);
        if p.is_absolute() && p.is_file() {
            let text = p.to_string_lossy().to_string();
            if !found.contains(&text) {
                found.push(text)
            }
        }
    }
    found
}

pub fn normalize(value: &Value) -> Result<Vec<Quota>, &'static str> {
    let buckets: Vec<(String, &Value)> = match value.get("rateLimitsByLimitId") {
        Some(Value::Object(map)) => map.iter().map(|(k, v)| (k.clone(), v)).collect(),
        Some(Value::Null) | None => match value.get("rateLimits") {
            Some(v) if v.is_object() => vec![(
                v.get("limitId")
                    .and_then(Value::as_str)
                    .unwrap_or("codex")
                    .to_owned(),
                v,
            )],
            Some(Value::Null) => return Ok(vec![]),
            _ => return Err("format_changed"),
        },
        _ => return Err("format_changed"),
    };
    let mut output = Vec::new();
    for (id, bucket) in buckets {
        if !bucket.is_object() {
            return Err("format_changed");
        }
        for lane in ["primary", "secondary"] {
            let Some(w) = bucket.get(lane).filter(|w| !w.is_null()) else {
                continue;
            };
            if !w.is_object() {
                return Err("format_changed");
            }
            let used = match w.get("usedPercent") {
                None | Some(Value::Null) => None,
                Some(v) => Some(
                    v.as_f64()
                        .filter(|n| n.is_finite() && (0.0..=100.0).contains(n))
                        .ok_or("format_changed")?,
                ),
            };
            let duration = optional_positive(w, "windowDurationMins")?
                .map(|m| m.checked_mul(60).ok_or("format_changed"))
                .transpose()?;
            let resets = optional_positive(w, "resetsAt")?;
            if resets.is_some_and(|s| s > 253402300799) {
                return Err("format_changed");
            }
            output.push(Quota {
                pool_id: format!("{id}:{lane}"),
                pool_label: bucket
                    .get("limitName")
                    .and_then(Value::as_str)
                    .unwrap_or(&id)
                    .to_owned(),
                used,
                remaining: used.map(|u| 100.0 - u),
                window_duration: duration,
                resets_at: resets,
            });
        }
    }
    Ok(output)
}

fn optional_positive(v: &Value, key: &str) -> Result<Option<u64>, &'static str> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_u64()
            .filter(|n| *n > 0)
            .map(Some)
            .ok_or("format_changed"),
    }
}

fn identity(v: &Value) -> Result<(String, String, Option<String>), &'static str> {
    let account = &v["account"];
    if account.is_null() {
        return Err("not_signed_in");
    }
    if account["type"] != "chatgpt" {
        return Err("unsupported_account");
    }
    let email = account["email"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("identity_unknown")?;
    let plan = account["planType"].as_str().map(str::to_owned);
    // Full account response is compared before/after read; no account payload is logged.
    let hash = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(account).map_err(|_| "format_changed")?)
    );
    Ok((hash, email.to_owned(), plan))
}

async fn response<R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
    id: u64,
) -> Result<Value, &'static str> {
    for _ in 0..256 {
        let mut line = String::new();
        // Bound a single protocol frame to 1 MiB, including unknown notifications.
        let n = (&mut *reader)
            .take(1_048_577)
            .read_line(&mut line)
            .await
            .map_err(|_| "transport_error")?;
        if n == 0 {
            return Err("transport_closed");
        }
        if n > 1_048_576 || !line.ends_with('\n') {
            return Err("format_changed");
        }
        let v: Value = serde_json::from_str(&line).map_err(|_| "format_changed")?;
        if v.get("method").is_some() {
            // Startup announces the current auth mode before the first account snapshot.
            // After that baseline, any auth update invalidates this reading.
            if v.get("id").is_some() {
                return Err("format_changed");
            }
            if v["method"] == "account/updated" && id > 2 {
                return Err("session_updated");
            }
            continue;
        }
        if v["id"] == id {
            if v.get("error").is_some() {
                return Err("source_error");
            }
            return v.get("result").cloned().ok_or("format_changed");
        }
    }
    Err("format_changed")
}

async fn send<W: tokio::io::AsyncWrite + Unpin>(
    writer: &mut W,
    value: Value,
) -> Result<(), &'static str> {
    let line = format!("{value}\n");
    writer
        .write_all(line.as_bytes())
        .await
        .map_err(|_| "transport_error")?;
    writer.flush().await.map_err(|_| "transport_error")
}

async fn exchange<W: tokio::io::AsyncWrite + Unpin, R: tokio::io::AsyncBufRead + Unpin>(
    input: &mut W,
    output: &mut R,
    expected: Option<&str>,
) -> Result<Reading, &'static str> {
    send(input,json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"availoom_local","title":"Availoom","version":env!("CARGO_PKG_VERSION")}}})).await?;
    response(output, 1).await?;
    send(input, json!({"method":"initialized"})).await?;
    send(
        input,
        json!({"id":2,"method":"account/read","params":{"refreshToken":false}}),
    )
    .await?;
    let before = response(output, 2).await?;
    let (account_ref, account_label, plan_label) = identity(&before)?;
    if expected.is_some_and(|e| e != account_ref) {
        return Err("account_changed");
    }
    send(input, json!({"id":3,"method":"account/rateLimits/read"})).await?;
    let quotas = normalize(&response(output, 3).await?)?;
    send(
        input,
        json!({"id":4,"method":"account/read","params":{"refreshToken":false}}),
    )
    .await?;
    let after = response(output, 4).await?;
    if before["account"] != after["account"] {
        return Err("account_changed");
    }
    let fetched_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "clock_error")?
        .as_secs();
    Ok(Reading {
        account_ref,
        account_label,
        plan_label,
        fetched_at,
        source_kind: "codex_app_server",
        quotas,
    })
}

pub async fn read(path: &str, cwd: &Path, expected: Option<&str>) -> Result<Reading, &'static str> {
    if !discover().iter().any(|p| p == path) {
        return Err("cli_missing");
    }
    let parent = Path::new(path).parent().ok_or("cli_missing")?;
    let mut paths = vec![parent.to_path_buf()];
    if let Some(p) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&p))
    }
    let mut child = Command::new(path)
        .args(["app-server", "--listen", "stdio://", "-c", "mcp_servers={}"])
        .env(
            "PATH",
            std::env::join_paths(paths).map_err(|_| "cli_missing")?,
        )
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "cli_missing")?;
    let result = tokio::time::timeout(std::time::Duration::from_secs(20), async {
        let mut input = child.stdin.take().ok_or("transport_error")?;
        let mut output = BufReader::new(child.stdout.take().ok_or("transport_error")?);
        exchange(&mut input, &mut output, expected).await
    })
    .await
    .unwrap_or(Err("timeout"));
    let _ = child.kill().await;
    let _ = child.wait().await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn multi_pool_preferred_and_credits_excluded() {
        let q=normalize(&json!({"rateLimits":{"primary":{"usedPercent":99}},"rateLimitsByLimitId":{"codex":{"primary":{"usedPercent":0,"windowDurationMins":300,"resetsAt":1792332000},"secondary":{"usedPercent":100}},"review":{"primary":{"usedPercent":25}}},"credits":{"balance":10000}})).unwrap();
        assert_eq!(q.len(), 3);
        assert_eq!(q[0].remaining, Some(100.));
        assert_eq!(q[0].window_duration, Some(18000));
        assert_eq!(q[1].remaining, Some(0.));
    }
    #[test]
    fn null_not_zero() {
        let q = normalize(&json!({"rateLimits":{"primary":{"usedPercent":null}}})).unwrap();
        assert_eq!(q[0].remaining, None);
        assert_eq!(q[0].resets_at, None);
    }
    #[test]
    fn malformed_never_becomes_valid() {
        for v in [json!(-1), json!(101), json!("40")] {
            assert_eq!(
                normalize(&json!({"rateLimits":{"primary":{"usedPercent":v}}})),
                Err("format_changed")
            );
        }
    }
    #[test]
    fn empty_authoritative_map_does_not_reuse_legacy() {
        assert!(normalize(
            &json!({"rateLimitsByLimitId":{},"rateLimits":{"primary":{"usedPercent":40}}})
        )
        .unwrap()
        .is_empty())
    }
    #[test]
    fn invalid_window_rejected() {
        assert!(normalize(&json!({"rateLimits":{"primary":{"windowDurationMins":-1}}})).is_err());
    }
    #[test]
    fn unsupported_auth_and_unknown_identity_fail_closed() {
        assert!(identity(&json!({"account":{"type":"apiKey"}})).is_err());
        assert!(identity(&json!({"account":{"type":"chatgpt","email":null}})).is_err());
    }
    #[tokio::test]
    async fn ignores_notifications_and_reads_matching_id() {
        let data = b"{\"method\":\"notice\"}\n{\"id\":4,\"result\":{\"ok\":true}}\n";
        assert_eq!(response(&mut &data[..], 4).await.unwrap()["ok"], true);
    }
    #[tokio::test]
    async fn account_changes_interrupt() {
        let data = b"{\"method\":\"account/updated\",\"params\":{}}\n";
        assert_eq!(response(&mut &data[..], 4).await, Err("session_updated"));
    }
    #[tokio::test]
    async fn raw_errors_are_never_forwarded() {
        let data = b"{\"id\":4,\"error\":{\"message\":\"secret-token\"}}\n";
        assert_eq!(response(&mut &data[..], 4).await, Err("source_error"));
    }
    #[tokio::test]
    async fn truncated_stream_fails() {
        let data = b"{\"id\":4}";
        assert_eq!(response(&mut &data[..], 4).await, Err("format_changed"));
    }
    fn scripted(replacement: bool) -> Vec<u8> {
        let account = json!({"account":{"type":"chatgpt","email":"fictional@example.invalid","planType":"plus"}});
        let after = if replacement {
            json!({"account":{"type":"chatgpt","email":"other@example.invalid","planType":"plus"}})
        } else {
            account.clone()
        };
        [json!({"id":1,"result":{}}),json!({"id":2,"result":account}),json!({"id":3,"result":{"rateLimits":{"primary":{"usedPercent":25,"windowDurationMins":300}}}}),json!({"id":4,"result":after})].iter().map(|v|format!("{v}\n")).collect::<String>().into_bytes()
    }
    #[tokio::test]
    async fn full_exchange_is_read_only_and_normalizes_source() {
        let mut sent = Vec::new();
        let bytes = scripted(false);
        let result = exchange(&mut sent, &mut &bytes[..], None).await.unwrap();
        assert_eq!(result.quotas[0].remaining, Some(75.));
        let calls: Vec<Value> = String::from_utf8(sent)
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(
            calls
                .iter()
                .map(|v| v["method"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec![
                "initialize",
                "initialized",
                "account/read",
                "account/rateLimits/read",
                "account/read"
            ]
        );
        assert_eq!(calls[2]["params"]["refreshToken"], false);
    }
    #[tokio::test]
    async fn initial_auth_announcement_is_not_an_account_change() {
        let script = String::from_utf8(scripted(false)).unwrap();
        let offset = script.find("\n").unwrap() + 1;
        let (init, rest) = script.split_at(offset);
        let bytes = format!("{init}{{\"method\":\"account/updated\",\"params\":{{\"authMode\":\"chatgpt\",\"planType\":\"plus\"}}}}\n{rest}").into_bytes();
        let result = exchange(&mut Vec::new(), &mut &bytes[..], None)
            .await
            .unwrap();
        assert_eq!(result.quotas[0].remaining, Some(75.));
    }
    #[tokio::test]
    async fn auth_notification_during_quota_read_discards_result() {
        let script = String::from_utf8(scripted(false)).unwrap();
        let lines: Vec<_> = script.lines().collect();
        let bytes = format!(
            "{}\n{}\n{{\"method\":\"account/updated\",\"params\":{{}}}}\n{}\n{}\n",
            lines[0], lines[1], lines[2], lines[3]
        )
        .into_bytes();
        assert_eq!(
            exchange(&mut Vec::new(), &mut &bytes[..], None)
                .await
                .unwrap_err(),
            "session_updated"
        );
    }
    #[tokio::test]
    async fn changed_account_discards_fetched_quota() {
        let bytes = scripted(true);
        assert_eq!(
            exchange(&mut Vec::new(), &mut &bytes[..], None)
                .await
                .unwrap_err(),
            "account_changed"
        );
    }
    #[tokio::test]
    async fn previous_account_mismatch_never_requests_quota() {
        let bytes = scripted(false);
        let mut sent = Vec::new();
        assert_eq!(
            exchange(&mut sent, &mut &bytes[..], Some("previous-account"))
                .await
                .unwrap_err(),
            "account_changed"
        );
        assert!(!String::from_utf8(sent)
            .unwrap()
            .contains("account/rateLimits/read"));
    }
    #[tokio::test]
    async fn oversized_protocol_frame_is_rejected() {
        let bytes = vec![b'x'; 1_048_577];
        assert_eq!(response(&mut &bytes[..], 1).await, Err("format_changed"));
    }
    #[tokio::test]
    async fn stalled_stream_can_be_timed_out() {
        let (stream, _peer) = tokio::io::duplex(64);
        let mut reader = BufReader::new(stream);
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(5),
            response(&mut reader, 1)
        )
        .await
        .is_err());
    }
}
