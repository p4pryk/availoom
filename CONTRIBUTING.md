# Contributing to Availoom

Availoom 0.7.1 is a macOS pre-release. Start with the build and validation commands in the [README](README.md). A source license has not been selected; confirm the licensing terms before submitting code for redistribution.

For a bug report, include the app version, OS/architecture, CLI version when relevant, expected behavior and reproducible steps. Remove account identities, tokens, local paths and private quota data from screenshots and logs.

For UI changes, inspect horizontal and vertical layouts, dark and light themes, keyboard focus, reduced motion, disconnected states and one/two/multiple quota pools. Never add invented usage to the shipped application. Keep synthetic readings in tests.

For adapter changes, preserve explicit session consent, before/after account checks, cancellation and stale-state behavior. Do not include credentials or account fixtures copied from a real session. Run the relevant existing checks and explain their results.

The Windows/Linux workflow template in `docs/ci/` is a portability check, not proof of native product support. Report platform-specific behavior separately.
