# Inputs

The tool takes one argument: the project folder. It reads the files below, and no others except the source files under `src/` and the main entry of an Electron project, and it looks at the names of the other files only to find certificate and key files. It follows no symbolic link and opens nothing that a file names.

## An Electron project

A project is an Electron project when `package.json` has `electron` in `devDependencies` or `dependencies` (`devDependencies` wins when both name it).

| File | What is read |
| --- | --- |
| `package.json` | The `electron` version. The `build` key, as an electron-builder configuration. The `main` entry. The `electron-updater` dependency, as an update setup |
| `electron-builder.yml` | An electron-builder configuration, in the YAML subset below |
| `electron-builder.json` | An electron-builder configuration in JSON |
| `forge.config.json` | An Electron Forge configuration, when it is JSON |
| `src/**` | Every `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts` and `.tsx` file, for `webPreferences`. `node_modules` folders are skipped |
| the `main` file | Read too, when it lies inside the project and outside `src/` |

electron-builder reads its configuration from the `build` key of `package.json` or from a file named with `--config`, which defaults to `electron-builder.yml`, and also accepts JSON, JSON5, TOML and JavaScript or TypeScript files ([configuration page](https://www.electron.build/docs/configuration)). The tool reads `package.json`, `electron-builder.yml` and `electron-builder.json`. When more than one of them exists, all are read, a setting counts as present when any of them sets it, and a note says so. A JSON5, TOML, JavaScript or TypeScript configuration (`electron-builder.json5`, `electron-builder.toml`, `electron-builder.js`, `electron-builder.ts`, `forge.config.js`, `forge.config.ts`) is not read; when one is present, an info finding names it, so a pass is never claimed for what was not read.

When an electron-builder configuration was read, signing is judged from it. Only when there is none is `forge.config.json` used. When there is neither, the signing findings say so.

### The keys of electron-builder that are read

| Key | Meaning |
| --- | --- |
| `win.sign` | An object with a `type` of `signtool`, `hsm`, `pkcs11` or `azure` (or a string, a custom signing module); `false` or `null` turns Windows signing off |
| `win.signtoolOptions`, `win.azureSignOptions` | The older layout, still read as "configured" |
| `mac.sign.identity` | The macOS signing identity; `null` skips signing, `"-"` is an ad hoc signature |
| `mac.sign` | `null` skips signing; a string is a custom signing module |
| `mac.identity` | The older layout, directly under `mac` |
| `mac.sign.hardenedRuntime`, `mac.hardenedRuntime` | The hardened runtime; the documented default is `true` |
| `mac.notarize` | `true` enables the notarization step; `false` turns it off |
| `publish` (at any level) | The update provider; strings, objects and lists are read. Inside it, `url`, `endpoint` and `publicUrl` are compared with `http://`, and `protocol` with `http` |

### The keys of Electron Forge that are read

| Key | Meaning |
| --- | --- |
| `packagerConfig.osxSign` | macOS signing; the object must exist, even if empty |
| `packagerConfig.osxNotarize` | Notarization with the credentials of an Apple account |
| `packagerConfig.windowsSign` | Windows signing |
| `makers[].config.certificateFile`, `makers[].config.windowsSign` | Windows signing of an installer maker |

Forge's pages name no option for the hardened runtime, so it is not checked for Forge. Forge publishers are not read.

### The YAML subset

An `electron-builder.yml` is read by a small reader that keeps the line of every value. It accepts block mappings and block sequences (also a sequence at the same indent as its key), plain, single-quoted and double-quoted scalars, `true`, `false`, `null`, numbers, comments, a leading `---`, and flow sequences of scalars (`[a, b]`). It refuses, with the line, anchors, aliases, tags, block scalars (`|` and `>`), flow mappings with content, tab indentation, more than one document, a key twice in one mapping, merge keys, and multi-line plain scalars. A refusal is a `config-unreadable` error; nothing is guessed.

## A Tauri project

A project is a Tauri project when `src-tauri/tauri.conf.json` exists.

| File | What is read |
| --- | --- |
| `src-tauri/tauri.conf.json` | The version 2 layout: `bundle.windows.certificateThumbprint`, `bundle.windows.signCommand`, `bundle.macOS.signingIdentity`, `bundle.macOS.hardenedRuntime`, `plugins.updater.pubkey`, `plugins.updater.endpoints`, `plugins.updater.dangerousInsecureTransportProtocol` |
| `src-tauri/Cargo.toml` | A line reader, not a TOML reader: the `tauri` version and the `tauri-plugin-updater` dependency |

The configuration is read as strict JSON. A `tauri.conf.json5` or `Tauri.toml` next to it is not read, and an info finding names it. Tauri's configuration reference names both formats.

**Version 1.** The Tauri 2 migration guide says that `tauri > bundle` moved to the top level and `tauri > updater` moved to `plugins > updater`. A configuration with a `tauri` key and no `bundle` key is taken for the version 1 layout, is not judged, and is reported as `tauri-v1-layout`. No other difference between the versions is described on the pages the tool follows, so none is applied.

**Notarization.** Tauri's macOS guide sets the Apple credentials as environment variables (`APPLE_API_ISSUER`, `APPLE_API_KEY` and `APPLE_API_KEY_PATH`, or `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID`) when the build runs, so the files cannot show it. The tool reports that as an info finding, `macos-notarization-env`.

## The releases file

`--releases <file>` is a saved copy of [https://releases.electronjs.org/releases.json](https://releases.electronjs.org/releases.json), a JSON array of objects with a `version`. The tool does not download it. It reads the `version` of every entry; a version of three numbers and nothing after them is a stable release, and alphas, betas and nightly builds are left out. The latest three stable majors are the supported ones.

`test/fixtures/releases.json` in this repository is a trimmed copy for the tests and examples. It is a fixture, not current data.

## Certificate and key files

The whole project folder is walked, without following a symbolic link and without entering folders named `node_modules`, `.git` or `target`. A file with the extension `.pfx`, `.p12` or `.key` is reported by its path. A `.pem` file is reported when the first 64 KB hold a PEM header and the words `PRIVATE KEY-----`. Extensions are compared without regard to letter case. The contents of a file are never copied into a report.

## Sizes

A configuration file over 10 MB is not read. A source file over 2 MB is not scanned. More than 3,000 source files, more than 200,000 files in the walk, and folders nested deeper than 16 levels are cut off, each with an info finding that says so.
