# GitHub Actions setup

`github-actions.yml` is a complete validation workflow template. It runs the frontend build, unit tests, Rust tests, Clippy and desktop compilation on macOS, Windows and Linux; UI/accessibility tests run on Linux.

The initial publishing connection can push source files but does not have GitHub’s `workflow` scope. For that reason, this file is kept outside `.github/workflows/` and is **not active**.

To enable CI using an appropriately authorized GitHub session, copy `docs/ci/github-actions.yml` to `.github/workflows/check.yml` and commit it. GitHub Actions must also be enabled for the repository. Check all three platform results before claiming cross-platform build compatibility. Runtime usability still needs native verification.

The workflow only validates; it does not sign, publish releases or configure updates. Its repository permissions are restricted to `contents: read`.
