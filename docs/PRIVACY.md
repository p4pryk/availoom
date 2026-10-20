# Privacy and data flow

Availoom runs locally. It has no hosted backend, telemetry, analytics or account synchronization.

## Codex readings

A reading starts only after you connect for the current session, or explicitly enable auto-refresh after a successful read. The Rust backend starts the discovered Codex CLI App Server over standard input/output, requests account metadata and rate limits, then checks account identity again. It does not read or copy Codex credential files directly, send a model prompt or request login/logout. Codex itself may contact its service, refresh its session and write its own logs.

Account identity and usage readings stay in Availoom memory. Disconnect or exit clears them. A verified account change clears the previous identity and requires a new connection. Other reading errors stop auto-refresh; a previous result may remain visible as stale.

## Claude diagnostic and provider websites

The optional local Claude diagnostic reads the provider configuration and can run the installed CLI’s authentication-status command. It returns installation/session status and, for external configurations, a hostname without URL credentials, paths or query strings. It does not retrieve Claude quotas.

Opening a provider website launches an official service URL in your browser. Your browser and that provider handle the session under their own policies.

## Persistent storage and OS controls

Availoom stores appearance, orientation, visible services, setup completion, alert preference and window position locally. Its application identifier remains `local.orbit.ai-strip` for compatibility with earlier releases. These settings contain no account credentials or quota cache.

Launch at login uses the operating system’s login setting and is disabled by default. Low-usage alerts require notification permission and are disabled by default. Notification text contains no email, account ID or exact quota value. Auto-refresh consent is separate, lasts only for the running session and is never restored from preferences.

## Sharing diagnostics

Public bug reports should contain app/OS/CLI versions and reproduction steps. Do not post credentials, authentication files, raw account responses or screenshots containing account details.
