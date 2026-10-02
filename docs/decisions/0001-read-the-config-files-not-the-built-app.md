# 1. Read the configuration files, not the built app

## Context

The tool needs to tell whether the release setup of an Electron or Tauri app is in order before it ships. There are richer ways to know what a release does: build it and inspect the installer, verify the signature of the artifacts, run the notarization check, launch the app and read its windows, or call the update server. Each of them needs a finished build, a platform (a Mac to inspect a notarized app, a Windows machine to verify a signature), certificates or accounts, and often a network, and the answer comes when the cost of a change is already high. The people who need the answer most often need it earlier: when the configuration changes in a pull request, in a pipeline on Linux, before a release tag, or in a review of an app that comes from an agency or a vendor.

A configuration file does not say everything. A certificate can come from an environment variable, an Apple credential from a secret of the release job, and a window can be created in code that builds its `webPreferences` somewhere else. A check that treated the absence of a setting as a pass would be wrong in the way that matters most.

## Decision

The tool reads the project's files as data: `package.json`, the packager configuration, the source under `src/`, and for Tauri the configuration and `Cargo.toml`. It reads the Electron release list as a file that the user saves, because the tool opens no connection. The version window, the security checklist items, the option names and the update rules come from official pages, which are saved with their addresses, and a test compares the code with the saved text. The tool never runs a build, a packager or any program, never evaluates a script, and never fetches anything.

A thing the tool cannot see is said, not guessed: a setting that is not found is "not found in source", a check without its input is `not checked`, a configuration format it does not read is named, and a value that comes from the environment is reported as not configured in the files, with the reason in the message. Reading is strict: a file outside the documented format is a finding, never silently skipped.

## Consequences

The check runs in a second, on Windows, Linux or macOS, with only Node, no certificate, no account and no network access, and no input can make it run code or reach out to a host. The same files give the same report, so it can run on every pull request and gate a release tag. The cost is that it sees what the files say, not what the release does: an app that signs in the release job with an environment certificate gets a warning until the setting is also written in a file, a `webPreferences` object built elsewhere is not found, and the validity of a signature or the state of a notarization ticket is out of reach. The tool says what it left out, lists its limits in docs/limits.md, and leaves the final answer to the people who know the release.
