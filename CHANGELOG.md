# Changes

## 1.0.0

First release.

- Checks the release setup of an Electron or Tauri desktop app from its files: `package.json`, the electron-builder configuration (`build` key, `electron-builder.yml`, `electron-builder.json`), `forge.config.json`, the source under `src/` and the `main` entry, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`. Never runs a build or a program and never fetches anything.
- Judges the Electron major against the latest three stable majors of a saved Electron release list given with `--releases`, and flags a version below the latest minor of a supported line. Without the list the check says it was not checked.
- Reads the `webPreferences` objects of the source and reports `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false`, `webSecurity: false` and `allowRunningInsecureContent: true`, each with the item of the Electron security checklist it breaks. A setting that is not written is "not found in source", never safe.
- Checks Windows signing, macOS signing, the hardened runtime and notarization for electron-builder, Electron Forge and Tauri, with the option names of their documentation, and says when a setting can only come from the environment.
- Checks the update setup: an update address or endpoint over plain http, a Tauri updater without a `pubkey`, `dangerousInsecureTransportProtocol`, and no update setup.
- Reports a `.pfx`, `.p12`, `.key` or a `.pem` with a private key inside the project, by path only.
- Every finding has an id, a severity (error, warning, info), the file, the line, a message, a fix and the address of the official page it follows.
- The names, sentences and security items come from official pages, which are saved in `research/sources`; a test compares `src/data.js` and the findings with the saved text.
- Reports as text, Markdown, JSON and CSV; `--fail-on` for a pipeline gate; `--platforms` to leave one platform out; exit code `2` for a usage or input error.
- Safe input: only the listed files are read, files over 10 MB are refused, source files over 2 MB are skipped, JSON nested more than 64 deep is refused, the YAML reader accepts a documented subset only, the scanner has no backtracking pattern, symbolic links are not followed, and control characters are removed from every text shown.
- Release packages come with a CycloneDX SBOM, SHA-256 checksums and a build provenance attestation.
