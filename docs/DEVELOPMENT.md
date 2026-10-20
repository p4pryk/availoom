# Availoom 0.7.1 — desktop AI quota strip

A local-first Tauri 2 / Rust / React utility. The main interface is a small floating strip, with a contextual detail panel. No central backend or telemetry. Background usage reads are off by default and require explicit, session-only opt-in.

## Run and build

Requirements: Node 20.19+ (CI uses Node 22), Rust stable, and the Tauri system prerequisites.

```sh
npm ci
source "$HOME/.cargo/env" # if Rust is not already on PATH
npm run tauri dev
npm run tauri build -- --bundles app
```

macOS output: `src-tauri/target/release/bundle/macos/Availoom.app`. This is a local development release, not a notarized distribution build. Transparent macOS windows currently use Tauri's `macos-private-api` feature; App Store distribution is not validated.

## Real data

- Startup shows **no quota numbers**. Opening a provider does not read its account.
- **Codex:** a manual, experimental adapter is implemented using the documented App Server protocol. Click Codex → Connect Codex, review the discovered executable and scope, then choose “Connect for this session”. Manual Refresh then reads the same verified account in one click until disconnect or quit. After a successful read, you can explicitly enable automatic refresh for the current session.
- The application launches that installed CLI over stdio, initializes it, reads account metadata, reads rate limits, then rechecks the account. No inference, login, logout, reset-credit redemption or message sending is requested.
- The CLI uses its own existing session and may refresh/store that session or write its own logs. Availoom does not read or copy credential files. Account identity and quotas remain in Availoom memory until disconnect or process exit.
- Changing account/plan aborts the new reading. Empty or unknown values never become zero or full usage. Multi-pool responses take precedence over the legacy bucket. Credits are excluded.
- Claude, Gemini and Grok have no automated quota adapter yet; buttons open official provider pages. Claude → Check local session checks the local CLI and detects external-provider configuration (such as Z.ai), which is not a Claude subscription. The diagnostic returns only the provider hostname and session status; no tokens are exposed.
- The shipped application contains no demo mode or synthetic quota generator. Test fixtures live only in automated tests.

Live Codex reading was verified with the owner's authorization on 18 October 2026 using CLI 0.163.0: one weekly pool was returned and rendered in the native strip. Automated tests additionally use synthetic protocol responses and a test-only UI bridge. This confirms this local session, not all account types or CLI versions.

Protocol references: [initialization](https://learn.chatgpt.com/docs/app-server#initialization), [account and rate-limit methods](https://learn.chatgpt.com/docs/app-server#auth-endpoints). Before public/commercial distribution, re-evaluate OpenAI authentication terms and supported Sign in with ChatGPT options.

## Refresh and first launch

- First launch opens a setup guide with service selection and an explanation of which providers support readings. It never reads an account without an action by the user. The guide can be reopened from Settings.
- Auto-refresh is enabled only after a successful Codex read. It targets a five-minute interval while the application runs; platform timer throttling can delay it. It uses the same verified account and CLI path.
- Permission lives only in memory. Pause, disconnect, process exit, any read error or account change stops automatic reads. Pausing an in-flight read cancels it; late responses cannot restore cleared data.
- Offline periods wait without sending requests. A delayed wake-up performs at most one overdue read, not a backlog. Old values remain explicitly stale; they never reset based on the clock alone.
- No account or quota cache is written by Availoom. Preferences and window geometry contain no credentials or quota data.

## Desktop behavior

- Settings → Services on your strip hides unused providers and remembers the choice. At least one service stays visible. The horizontal strip shortens when collapsed; hiding a service does not disconnect it.
- Reading details are collapsed by default, including account identity and raw plan metadata. The main panel shows remaining usage, reset and reading age. Single-pool readings are not duplicated in selectable cards.
- Arrow keys navigate services; Home/End jump to the first/last service. Command-comma (Control-comma) opens settings.
- Settings → Orientation switches between a 44 px horizontal strip and a vertical dock; the choice survives restart. The entire interface is English. Codex shows Connect until read; website-only providers are labelled Open website.
- Drag the Availoom mark; focus it and use arrow keys to move the window, or Enter to recenter.
- Detail panels grow the native window and clamp its position to the current monitor's work area.
- Escape and focus loss collapse the detail panel. Escape restores keyboard focus.
- System/light/dark, always-on-top and reduced-motion settings are saved through Rust in the app's config directory. No secrets are in this settings file.
- A second launch activates the existing instance. Closing the window hides it; Quit Availoom exits the application. Window position is restored on the next clean launch, and the window is clamped to an available monitor on resize, focus and detected timer gaps. Physical monitor hot-unplug and real sleep/wake still need wider hardware testing.
- The menu-bar icon restores the strip, recenters it or quits the app.
- Each provider shows up to two actual pools, labelled with their durations (for example 5h and 7d). A selected model pool stays visible; extra pools are available in details and counted with +N. Missing pools are not synthesized; missing values remain unknown.

## Verification

```sh
npm run build
npm test
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Local Playwright tests use installed Google Chrome. On CI, install Chromium with `npx playwright install --with-deps chromium` first. The suite covers keyboard behavior, explicit consent, delayed response cancellation, absence of demonstration controls, source identity, missing values, protocol errors, contrast and layout. Automated accessibility checks do not establish complete assistive-technology conformance.

## Remaining work

- Expand live Codex verification beyond the already tested local account to other plans and organizations.
- Validate alternative provider sources before adding adapters.
- Full VoiceOver/text scaling, multiple physical monitors, sleep/wake and long-running resource tests.
- System-specific verification on Windows/Linux; prepared CI is not production support.
- Signing/notarization, updates and distribution policy.

## Release scope

0.7.1 is a pre-release for local macOS Apple Silicon use, not a signed public 1.0. The Rust backend and React interface are shared through Tauri; A Windows/Linux workflow template is prepared in `docs/ci/github-actions.yml`, but is not enabled on GitHub. Platform prerequisites, CLI discovery and native behavior must be verified separately before claiming support.

Before public 1.0: Apple signing/notarization; a release/update channel; multi-monitor, VoiceOver and extended native lifecycle testing; validation of supported Codex versions/accounts. Additional provider adapters are deferred. No production update URL or signing identity is fabricated.

## 0.7 brand preparation and daily controls

- New original reserve-gauge icon in `brand-icon.svg` and monochrome `brand-mark.svg`; generated desktop icon formats and a matching menu-bar symbol. Product name is now Availoom. The existing `local.orbit.ai-strip` identifier and preferences directory are intentionally retained so upgrades preserve settings. Name screening found no matching software product, but domain and trademark availability have not been established.
- Manual refresh uses the connected session without repeating the connection dialog; every response retains before/after account checks. Background refresh remains a separate opt-in.
- Optional launch at login uses the OS login setting, read from the official Tauri plugin. Never enabled automatically. Install the app at its permanent location before enabling it.
- Optional low-usage alerts require notification permission. Alert only on a successful observed crossing from above 10% to 10% or lower. No startup notification, repeated low-state notification, email, account ID or quota amount in notification text. New readings above the threshold rearm the alert. No inference or background reads are enabled by this switch.
- A session-update notification is distinguished from a verified account change. The interrupted read is still rejected, automation stops, and the previous reading remains stale for a manual guarded retry. This is not a bypass of account verification.
