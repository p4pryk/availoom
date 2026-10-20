# Availoom 0.7.1 — pre-release

Your AI limits, at a glance. The first Availoom-branded build is available for local macOS Apple Silicon testing.

## Included

- Original reserve-gauge icon and the Availoom name across the app and native menu.
- A thin horizontal strip, vertical dock, service selection and light/dark/system appearance.
- Experimental Codex account quota readings through the installed CLI, with verified identity, refresh and reset details.
- Optional session-only auto-refresh, offline waiting and clear stale-reading states.
- Optional launch at login and threshold-crossing notifications.
- Website shortcuts for Claude, Gemini and Grok; a local Claude session diagnostic.

## Scope

Only Codex has an automated quota adapter. Reads have been verified on one local account; broader plan/CLI compatibility is still being tested. Other providers do not display automated quotas.

The macOS build is unsigned and not notarized. Windows/Linux runtime support, physical sleep/wake, multiple monitors, full VoiceOver coverage, long-running performance, login launch and actual OS notification delivery require more verification. No automatic update channel is configured.

## Live connection check — October 20, 2026

A native macOS connection returned one weekly Codex pool with 97% remaining and a source reset time. The README includes the connected panel with account details collapsed. This is a dated snapshot of one account, not a fixed allowance.

## Testing

The local suite contains 15 frontend/domain tests, 22 Rust tests and 35 UI tests. UI coverage includes dark/light accessibility scans, layout, connection consent, cancellation, one-click refresh, account changes and notification deduplication. Notification/login OS effects are mocked in those tests.

## Upgrade

Quit the old build before opening Availoom. Install `Availoom.app` at its permanent location before enabling launch at login. Existing Orbit preferences are preserved through the stable application identifier. Account readings and auto-refresh consent intentionally do not survive restart.
