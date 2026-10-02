# desktop-release-check

Checks the release setup of an Electron or Tauri desktop app before it ships. You give it the project folder. It reads the files that decide how the app is built and released, and answers six questions: is the Electron version one that Electron still supports, are the `webPreferences` of every window safe, is Windows signing configured, is macOS signing, the hardened runtime and notarization configured, is the auto-update setup safe, and is a certificate or a private key sitting in the project folder. Every finding names the file and the line, and the page of the official documentation it follows.

A desktop release is assembled from settings in five places: `package.json`, a packager configuration (electron-builder or Electron Forge for Electron, `tauri.conf.json` for Tauri), the main process source, a few environment variables in the release job, and the folder itself. None of them breaks a build when it is wrong. An old Electron major still builds, `nodeIntegration: true` still opens a window, an unsigned installer still installs, and an update address over plain http still works. The problems show up later, in a SmartScreen warning, a Gatekeeper dialog, a security review or an incident. This tool reads those settings in a second, so the check can run on every pull request and on every release tag.

- Every finding has an id, a severity (error, warning or info), the file, the line, a plain message, a fix and the address of the official page it follows.
- Electron's support window is judged against a releases list that you save from Electron itself ([releases.electronjs.org/releases.json](https://releases.electronjs.org/releases.json)), with `--releases`. Without it the check says "not checked"; it never says "fine" for a thing it did not look at.
- The `webPreferences` settings are read from the source, and each unsafe value is mapped to the item of the Electron security checklist that it breaks, with the item named exactly as the page names it. A setting that is not written in the source is reported as "not found in source", never as safe.
- The option names of electron-builder, Electron Forge and Tauri are the ones their documentation pages show. The pages are saved in [research/sources](research/sources), and a test compares every name and every quoted sentence in [src/data.js](src/data.js) and in the findings with the saved text.
- It reads files only. It never runs a build, a packager or any program, fetches nothing and opens no network connection.
- A certificate or key file is reported by its path only; its contents are never read into a report.
- Reports as text, Markdown, JSON and CSV, with an exit code for a pipeline gate.
- Plain JavaScript, no dependencies; the same files always give the same report.

```
npm test
```

```
ℹ tests 159
ℹ pass 158
ℹ fail 0
ℹ skipped 1
```

The skipped test makes a symbolic link, which Windows does not allow without a privilege; on Linux and macOS all 159 run.

## Quick start

Requires Node 22 or newer. There is nothing to install.

```
git clone https://github.com/INNERLUXES/desktop-release-check.git
cd desktop-release-check
node bin/desktop-release-check.js examples/harbor-notes --releases test/fixtures/releases.json
```

Or without a clone, in the folder of your project:

```
npx --yes github:INNERLUXES/desktop-release-check . --releases releases.json
```

To judge the Electron version, save Electron's own release list and pass it in:

```
curl -L -o releases.json https://releases.electronjs.org/releases.json
```

The tool does not download it for you, because it opens no connection. [docs/inputs.md](docs/inputs.md) lists the files the tool reads and the keys it looks at, for electron-builder, Electron Forge and Tauri.

`examples/` holds made-up apps. `examples/harbor-notes` is an Electron note taking app, wrong on purpose: Electron 30 against the releases fixture, `nodeIntegration` on and `contextIsolation` off, no Windows signing, no notarization, an update address over plain http and a placeholder certificate file left in `build/`. `examples/harbor-notes-fixed` is the same app with all of it corrected. `examples/tidewater-sync` is a small Tauri app with an updater that has no `pubkey`, an update endpoint over http, no macOS signing identity and the hardened runtime turned off, and `examples/tidewater-sync-fixed` corrects them. `examples/output` holds the reports of the first app in every format; `npm run example` writes them again and fails if the README no longer shows what a real run prints.

`test/fixtures/releases.json` is a trimmed copy of Electron's release list, kept for the tests and the examples. It is a fixture, not current data: it does not say which Electron versions are supported today. Judge your own project with a fresh download.

## Usage

```
node bin/desktop-release-check.js examples/harbor-notes --releases test/fixtures/releases.json
```

```
desktop-release-check: examples/harbor-notes
project: electron
electron: 30.1.0 (examples/harbor-notes/package.json:7), major 30, latest stable major 44, supported 44, 43, 42 (test/fixtures/releases.json)
webPreferences: 1 object in 1 file, 1 source file read
  nodeIntegration               true           examples/harbor-notes/src/main.js:9  UNSAFE
  contextIsolation              false          examples/harbor-notes/src/main.js:10  UNSAFE
  sandbox                       true           examples/harbor-notes/src/main.js:11
  webSecurity                   not found in source
  allowRunningInsecureContent   not found in source
signing:
  windows  electron-builder: not configured  examples/harbor-notes/electron-builder.yml:3
  macos    electron-builder: configured (mac.sign.identity), hardened runtime default, notarization missing  examples/harbor-notes/electron-builder.yml:9
update:
  electron  publish  examples/harbor-notes/electron-builder.yml:10
key files: 1 file found
checks:
  1  Electron version                fail         electron 30.1.0 (major 30) is unsupported
  2  Electron security settings      fail         1 webPreferences object in 1 file: 2 unsafe, 3 found, 2 not found in source
  3  Windows signing                 warn         electron-builder: not configured
  4  macOS signing and notarization  warn         electron-builder: configured, hardened runtime default, notarization not enabled
  5  Auto-update                     fail         electron: publish; 1 problem
  6  Certificate and key files       fail         1 file
findings: 5 error, 2 warning, 0 info

ERROR    electron-unsupported  examples/harbor-notes/package.json:7  electron
         electron "30.1.0" (examples/harbor-notes/package.json:7) is major 30. Electron's support policy: "The latest three stable major versions are supported by the Electron team"; in test/fixtures/releases.json the latest stable major is 44, so the supported majors are 44, 43, 42
         fix: Upgrade to Electron 44, one major at a time. The security page asks to "16. Use a current version of Electron"

ERROR    insecure-node-integration  examples/harbor-notes/src/main.js:9  nodeIntegration
         nodeIntegration: true (examples/harbor-notes/src/main.js:9) breaks item "2. Do not enable Node.js integration for remote content" of the Electron security checklist. It matters most for a window that loads remote content, which the tool cannot see
         fix: Set nodeIntegration to false, or remove it; see https://www.electronjs.org/docs/latest/tutorial/security

ERROR    insecure-context-isolation  examples/harbor-notes/src/main.js:10  contextIsolation
         contextIsolation: false (examples/harbor-notes/src/main.js:10) breaks item "3. Enable Context Isolation" of the Electron security checklist. It matters most for a window that loads remote content, which the tool cannot see
         fix: Set contextIsolation to true, or remove it; see https://www.electronjs.org/docs/latest/tutorial/security

ERROR    update-insecure-url  examples/harbor-notes/electron-builder.yml:12  publish.url
         publish.url is http://updates.example.com/harbor-notes (examples/harbor-notes/electron-builder.yml:12): updates are fetched over plain http, so anyone on the network path can read or replace what the app downloads
         fix: Use an https:// address

ERROR    committed-key-file  examples/harbor-notes/build/FAKE-signing-certificate.pfx:1  .pfx
         examples/harbor-notes/build/FAKE-signing-certificate.pfx (.pfx) is a certificate or private key file inside the project. Its contents are not shown. If git tracks it, anyone with the repository has the key
         fix: Remove it from the project and from the git history, revoke the certificate if it was ever pushed, and give the signing step the key from a secret store or an environment variable

WARNING  windows-signing-missing  examples/harbor-notes/electron-builder.yml:3  windows signing
         No Windows code signing is configured (electron-builder). electron-builder also signs with a certificate from the WIN_CSC_LINK or CSC_LINK environment variable, which the files cannot show. Microsoft's code signing page says signing consecutive releases "with a consistent publisher/signing identity lets publisher reputation build over time", which an unsigned app cannot do (https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
         fix: Set win.sign with a type of signtool, hsm, pkcs11 or azure

WARNING  macos-notarization-missing  examples/harbor-notes/electron-builder.yml:5  notarization
         Notarization is not enabled in examples/harbor-notes/electron-builder.yml:5 (mac.notarize). Apple's notarization page (https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution): "Notarize your macOS software to give users more confidence that the Developer ID-signed software you distribute has been checked by Apple for malicious components"
         fix: Set mac.notarize to true and give the Apple credentials as environment variables (docs/rules-and-sources.md)

GATE: FAIL - 5 errors
```

The exit code is `1`: an unsupported Electron major, two unsafe `webPreferences` values, an update address over http and a key file are errors, and errors fail the run by default. The two warnings (no Windows signing, notarization not enabled) do not. `sandbox: true` is written in the source and is safe, so it is shown without a mark. `webSecurity` appears only in a comment of `src/main.js`, which the tool skips, so it is "not found in source"; that is not a statement that it is safe. The Windows warning points at the `win` key of `electron-builder.yml`, and the notarization warning at the `mac` key. The key file is shown by its path and its kind; its contents are not read into the report.

The fixed app passes, also with `--fail-on warning`:

```
node bin/desktop-release-check.js examples/harbor-notes-fixed --releases test/fixtures/releases.json --fail-on warning
```

```
desktop-release-check: examples/harbor-notes-fixed
project: electron
electron: 43.7.7 (examples/harbor-notes-fixed/package.json:10), major 43, latest stable major 44, supported 44, 43, 42 (test/fixtures/releases.json)
webPreferences: 1 object in 1 file, 1 source file read
  nodeIntegration               false          examples/harbor-notes-fixed/src/main.js:10
  contextIsolation              true           examples/harbor-notes-fixed/src/main.js:11
  sandbox                       true           examples/harbor-notes-fixed/src/main.js:12
  webSecurity                   true           examples/harbor-notes-fixed/src/main.js:13
  allowRunningInsecureContent   false          examples/harbor-notes-fixed/src/main.js:14
signing:
  windows  electron-builder: configured (win.sign type signtool)  examples/harbor-notes-fixed/electron-builder.yml:5
  macos    electron-builder: configured (mac.sign.identity), hardened runtime on, notarization on  examples/harbor-notes-fixed/electron-builder.yml:13
update:
  electron  electron-updater dependency  examples/harbor-notes-fixed/package.json:7
key files: 0 files found
checks:
  1  Electron version                pass         electron 43.7.7 (major 43) is supported
  2  Electron security settings      pass         1 webPreferences object in 1 file: 0 unsafe, 5 found, 0 not found in source
  3  Windows signing                 pass         electron-builder: configured
  4  macOS signing and notarization  pass         electron-builder: configured, hardened runtime on, notarization on
  5  Auto-update                     pass         electron: electron-updater dependency
  6  Certificate and key files       pass         none found
findings: 0 error, 0 warning, 0 info

no findings

GATE: PASS (--fail-on warning)
```

A small Tauri app shows the other layout:

```
node bin/desktop-release-check.js examples/tidewater-sync
```

```
desktop-release-check: examples/tidewater-sync
project: tauri
signing:
  windows  tauri: configured (bundle.windows.signCommand)  examples/tidewater-sync/src-tauri/tauri.conf.json:9
  macos    tauri: not configured, hardened runtime off, notarization by environment variables, not checked  examples/tidewater-sync/src-tauri/tauri.conf.json:1
update:
  tauri     plugins.updater  examples/tidewater-sync/src-tauri/tauri.conf.json:16
key files: 0 files found
checks:
  1  Electron version                n/a          no Electron project
  2  Electron security settings      n/a          no Electron project
  3  Windows signing                 pass         tauri: configured
  4  macOS signing and notarization  warn         tauri: not configured, hardened runtime off, notarization by environment variables, not checked
  5  Auto-update                     fail         tauri: plugins.updater; 2 problems
  6  Certificate and key files       pass         none found
findings: 2 error, 2 warning, 1 info

ERROR    update-insecure-url  examples/tidewater-sync/src-tauri/tauri.conf.json:18  plugins.updater.endpoints
         An updater endpoint is http://releases.example.com/{{target}}/{{arch}}/{{current_version}} (examples/tidewater-sync/src-tauri/tauri.conf.json:18): it is plain http. The updater page: "TLS is enforced in production mode"
         fix: Use an https:// address

ERROR    updater-no-pubkey  examples/tidewater-sync/src-tauri/tauri.conf.json:16  plugins.updater
         plugins.updater in examples/tidewater-sync/src-tauri/tauri.conf.json:16 has no pubkey. The updater page: the pubkey "has to be the public key generated from the Tauri CLI". Without it the app cannot verify what it downloads. (A pubkey set in the Rust code with Builder::pubkey is not read by the tool)
         fix: Set plugins.updater.pubkey to the content of the public key; it cannot be a file path

WARNING  macos-signing-missing  examples/tidewater-sync/src-tauri/tauri.conf.json:1  macos signing
         No macOS code signing identity is configured (tauri). Apple's notarization page (https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) asks to "Enable code-signing for all of the executables you distribute"
         fix: Set bundle.macOS.signingIdentity

WARNING  macos-hardened-runtime-off  examples/tidewater-sync/src-tauri/tauri.conf.json:12  hardened runtime
         The hardened runtime is turned off in examples/tidewater-sync/src-tauri/tauri.conf.json:12. Apple's notarization page (https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) asks to "Enable the Hardened Runtime capability for your app and command line targets"
         fix: Set bundle.macOS.hardenedRuntime to true, or remove it (the default is true)

INFO     macos-notarization-env  examples/tidewater-sync/src-tauri/tauri.conf.json:1  notarization
         Tauri notarizes when the Apple credentials are set as environment variables (APPLE_API_ISSUER, APPLE_API_KEY and APPLE_API_KEY_PATH, or APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID) when the build runs. The files cannot show them, so notarization was not checked. Apple's notarization page (https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
         fix: Check that the release job sets them; see https://v2.tauri.app/distribute/sign/macos/

GATE: FAIL - 2 errors
```

Tauri reads its Apple credentials from environment variables when the build runs, so the files cannot show whether the app is notarized; the report says so as an info finding and does not claim it. Run `examples/harbor-notes-fixed` without `--releases` and the Electron version check reports `not checked` and an info finding, not a pass; `npm run example` verifies that too.

```
desktop-release-check <project-folder> [options]
```

```
--releases <file>   a saved copy of https://releases.electronjs.org/releases.json, used to judge
                    the Electron version; without it that check is reported as not checked
--platforms <list>  windows, macos or both, separated by a comma (default: windows,macos)
--format <name>     text, markdown, json or csv (default: text)
--fail-on <level>   exit with 1 when a finding is at this level or above: error or warning
                    (default: error)
--help              show the usage
--version           show the version
```

Paths in the report are relative to the folder you run the command in, with forward slashes on every system; a file outside it is shown with its absolute path. File names are compared exactly, letter case included.

## The six checks

| # | Check | What it reports | Source |
| --- | --- | --- | --- |
| 1 | Electron version | An Electron major outside the latest three stable majors is an error; a version below the latest minor release of a supported line is a warning | [Electron timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) |
| 2 | Electron security settings | `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false`, `webSecurity: false` and `allowRunningInsecureContent: true` in a `webPreferences` object are errors | [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security) |
| 3 | Windows signing | No signing configured, or signing turned off, is a warning | [Microsoft code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) |
| 4 | macOS signing and notarization | No identity, an ad hoc identity, a turned-off hardened runtime or no notarization is a warning | [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) |
| 5 | Auto-update | An update address over plain http, a Tauri updater without a `pubkey` and `dangerousInsecureTransportProtocol` are errors; no update setup is info | [electron-builder publish](https://www.electron.build/docs/publish), [Tauri updater](https://v2.tauri.app/plugin/updater/) |
| 6 | Certificate and key files | A `.pfx`, `.p12`, `.key` or a `.pem` with a private key inside the project is an error, by path only | [Microsoft code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) |

| Id | Severity | What it reports |
| --- | --- | --- |
| `electron-unsupported` | error | The Electron major is not one of the latest three stable majors in the releases file |
| `electron-not-latest-minor` | warning | The version is in a supported line but below the latest minor release of it (only for an exact or `~` version) |
| `electron-support-not-checked` | info | No `--releases` file, so the support was not checked |
| `electron-version-unknown` | info | The version is a tag, a range with an operator, a path or not a string, so it was not checked |
| `insecure-node-integration` | error | `nodeIntegration: true`; breaks "2. Do not enable Node.js integration for remote content" |
| `insecure-context-isolation` | error | `contextIsolation: false`; breaks "3. Enable Context Isolation" |
| `insecure-sandbox` | error | `sandbox: false`; breaks "4. Enable process sandboxing" |
| `insecure-web-security` | error | `webSecurity: false`; breaks "6. Do not disable webSecurity" |
| `insecure-content` | error | `allowRunningInsecureContent: true`; breaks "8. Do not enable allowRunningInsecureContent" |
| `setting-not-literal` | info | A setting is written as an expression, so it was not judged |
| `web-preferences-not-found` | info | No `webPreferences` object was found in the source that was read |
| `windows-signing-missing` | warning | No Windows signing in the electron-builder, Forge or Tauri configuration |
| `windows-signing-disabled` | warning | `win.sign` is `false` or `null` |
| `macos-signing-missing` | warning | No macOS signing identity |
| `macos-signing-disabled` | warning | The macOS identity or signing is `null` |
| `macos-signing-adhoc` | warning | The identity is `"-"`, which cannot be notarized |
| `macos-hardened-runtime-off` | warning | The hardened runtime is turned off |
| `macos-notarization-missing` | warning | `mac.notarize` is not `true` (electron-builder), or `osxNotarize` is missing (Forge) |
| `macos-notarization-env` | info | Tauri notarizes through environment variables, which the files cannot show |
| `update-insecure-url` | error | A publish `url`, `endpoint`, `publicUrl` or an updater endpoint that starts with `http://`, or a publish `protocol` of `http` |
| `updater-no-pubkey` | error | `plugins.updater` has no `pubkey` |
| `updater-insecure-transport` | error | `dangerousInsecureTransportProtocol` is `true` |
| `updater-config-not-found` | info | `Cargo.toml` names the updater plugin but `plugins.updater` is missing |
| `no-auto-update` | info | No update setup was found |
| `committed-key-file` | error | A certificate or private key file inside the project, by path only |
| `config-unreadable` | error | A configuration file is not JSON, is YAML outside the supported subset, or is not a regular file; the line is shown |
| `config-not-read` | info | A configuration of a format the tool does not read is present (`electron-builder.toml`, `forge.config.js`, `tauri.conf.json5`) |
| `source-not-read` | info | A source file, or part of the folder, was left out because of a size or count limit |
| `tauri-v1-layout` | info | `tauri.conf.json` has the version 1 layout, which the tool does not read |

[docs/method.md](docs/method.md) gives each check, its exact rule and why it matters. [docs/rules-and-sources.md](docs/rules-and-sources.md) lists every number and option name with the saved page it comes from.

## Where the facts come from

| Fact | Value | Source |
| --- | --- | --- |
| Electron support window | "The latest three stable major versions are supported by the Electron team" | https://www.electronjs.org/docs/latest/tutorial/electron-timelines |
| Minor releases | "We only support the latest minor release for each stable release series" | the same page |
| Security checklist items | items 2, 3, 4, 6 and 8, named exactly as the page names them | https://www.electronjs.org/docs/latest/tutorial/security |
| Windows signing options | `win.sign` with a `type` of `signtool`, `hsm`, `pkcs11` or `azure`; `false` or `null` turns it off | https://www.electron.build/docs/win and https://www.electron.build/docs/features/code-signing/code-signing-win |
| macOS signing options | `mac.sign.identity`, `mac.sign.hardenedRuntime`, `mac.notarize` | https://www.electron.build/docs/mac and https://www.electron.build/docs/features/code-signing/notarization |
| electron-builder publish | `url`, `endpoint`, `publicUrl`, `protocol` | https://www.electron.build/docs/publish |
| Forge signing options | `packagerConfig.osxSign`, `osxNotarize`, `windowsSign`, `certificateFile` | https://www.electronforge.io/guides/code-signing/code-signing-macos and https://www.electronforge.io/guides/code-signing/code-signing-windows |
| Tauri signing options | `bundle.windows.certificateThumbprint`, `bundle.windows.signCommand`, `bundle.macOS.signingIdentity`, `bundle.macOS.hardenedRuntime` | https://v2.tauri.app/distribute/sign/windows/, https://v2.tauri.app/distribute/sign/macos/ and https://v2.tauri.app/reference/config/ |
| Tauri updater options | `plugins.updater.pubkey`, `endpoints`, `dangerousInsecureTransportProtocol` | https://v2.tauri.app/plugin/updater/ |
| Why sign on Windows | the reputation of a publisher builds over time across signed releases | https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options |
| Why notarize on macOS | notarization and the hardened runtime requirement | https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution |

The electron-builder pages describe the current layout, where signing lives in `win.sign` and `mac.sign`; they also name the older keys (`win.signtoolOptions`, `win.azureSignOptions`, and `identity` and `hardenedRuntime` directly under `mac`), and the tool reads those too. A setting that the documentation says is read from an environment variable (a Windows certificate from `WIN_CSC_LINK`, the Apple credentials) cannot be seen in the files; the findings say so, and the macOS notarization warning for electron-builder is raised until `mac.notarize` is `true` in a file.

## Formats

- `text`: for a terminal: the project, the Electron version and its support, every `webPreferences` setting, the signing and update state, the six checks with their result, then the findings, errors first, each with its check id, file, line and subject, message and fix.
- `markdown`: the same for a pull request comment or the job summary. Pipes, line breaks and angle brackets from the input are escaped, so a value from a file cannot break a table.
- `json`: the whole report: the project, the Electron version and releases used, every setting with its locations, the signing and update state, the six checks, every finding with id, severity, check, file, line, subject, message, fix and source, the notes and the gate.
- `csv`: one row per finding, quoted as RFC 4180 says. A cell that starts with `=`, `+`, `-` or `@` gets a leading `'`, so a spreadsheet does not run it as a formula.

To put the report in the job summary of a GitHub Actions run:

```yaml
permissions:
  contents: read
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
    with:
      node-version: 22
  - name: Desktop release report
    run: npx --yes github:INNERLUXES/desktop-release-check . --releases ci/releases.json --format markdown >> "$GITHUB_STEP_SUMMARY"
  - name: Desktop release gate
    run: npx --yes github:INNERLUXES/desktop-release-check . --releases ci/releases.json --fail-on warning
```

It needs no secrets and no build; a Linux runner is enough. Keep `ci/releases.json` in the repository and refresh it when you plan an Electron upgrade, or download it in an earlier step of the job.

## Exit codes

`0` no finding at the `--fail-on` level, `1` at least one such finding (by default: an error), `2` a usage or input error (a missing project folder, a folder with no Electron or Tauri project, a releases file that is missing or is not a list, an unknown option).

A configuration file that cannot be read is not exit code `2`: it is a finding (`config-unreadable`), so the run still checks everything else and the gate fails.

## Limits

The tool reads what the files say, not what the built app does. A setting that is read from an environment variable or set in code the tool does not read (a JavaScript configuration, a `forge.config.js`, the Rust code of a Tauri app) is not seen, and the report says so instead of passing it. A `webPreferences` object is found only where it is written as `webPreferences: { ... }` or `webPreferences = { ... }` with literal `true` or `false`; the tool does not follow a variable. It does not know what a window loads, so it cannot tell whether `nodeIntegration: true` is used for remote content. The Electron version is the one written in `package.json`, not the one installed. [docs/limits.md](docs/limits.md) lists these, with the size limits.

## Background

- How desktop applications are designed, built, signed and released for Windows, macOS and Linux, with checks like this one in the pipeline: [desktop application development services](https://innerluxes.dev/application/development/desktop).

## License

MIT
