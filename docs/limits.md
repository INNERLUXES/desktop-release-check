# Limits

## What the tool can know

- **It sees what the files say, not what the built app does.** A signing certificate that is supplied to the release job through an environment variable (`WIN_CSC_LINK`, `CSC_LINK`, the Apple credentials) leaves no trace in the project folder. The tool reports "not configured" or "not enabled" for what the files do not set, and its messages say that the setting may come from the environment. It cannot tell a project that never signs from one that signs in the release job. Setting `win.sign` and `mac.notarize` in a file settles it.
- **A setting that is not found is not a setting that is safe.** For `webPreferences`, "not found in source" means that no object with that key was found in the files read: the setting may be left to Electron's default, set in code that is not read, or set on a window that is built elsewhere. The report never calls it safe.
- **The scanner reads one pattern.** A `webPreferences` object is found where it is written as `webPreferences: { ... }` or `webPreferences = { ... }`. An object built in another place and passed in (`webPreferences: options`), a property set after the window is created, a settings file read at run time and a generated bundle are not seen. A value is judged only when it is the literal `true` or `false`; an expression is reported and not evaluated. `app.enableSandbox()` and the command line switches of Electron are not read.
- **The tokenizer is approximate for JavaScript.** It skips comments, strings, template literals and regular expressions, and decides between a division and a regular expression from the token before the slash. A source file with an unusual construct may be read wrongly in rare cases; a file that is cut by a size limit is named in an info finding.
- **Item 2 of the security checklist depends on what a window loads.** The tool cannot see whether a window loads remote content, so it reports `nodeIntegration: true` as an error and says so. A project that loads only its own local files may judge it differently; the other four settings are stated by the page for every window.
- **The Electron version is the declared one.** `package.json` says `^43.0.0`; the installed version is whatever the lock file and the install gave. The tool does not read lock files or `node_modules`. A `^` range is not flagged for a minor release, because it can move to the latest minor; a tag or a range with an operator is not read.
- **The releases file is a snapshot.** The support window is as current as the file you pass. The fixture in `test/fixtures` is old the day it is saved. The tool cannot know that a file is stale; it does not look at dates.
- **Not every configuration format is read.** JSON5, TOML, JavaScript and TypeScript configurations of electron-builder and Forge, `tauri.conf.json5` and `Tauri.toml` are not read, and are named when present. A Forge configuration that reads its values in code, or a publisher list, is not seen.
- **Only the keys the saved pages name are read.** The electron-builder pages name `win.sign`, the version 26 keys `win.signtoolOptions` and `win.azureSignOptions`, and the flat `mac.identity` and `mac.hardenedRuntime`. A project written for an earlier electron-builder that signs with another flat key (for example a certificate file set directly under `win`) is not recognized, and gets the "not configured" warning; the message and the fix name the keys the tool reads.
- **The YAML reader is a subset.** [inputs.md](inputs.md) lists what it accepts. A configuration written with anchors, tags or multi-line scalars is refused with its line, so the file has to be written in the subset, or in JSON.
- **Tauri 1 is not read.** The version 1 layout is recognized, reported and not judged. `Cargo.toml` is read by line, not as TOML, to find the `tauri` version and the updater plugin.
- **Files in git are not known.** The tool looks at the project folder, not at the git index. A key file that is ignored by git is still reported, and one that a tool wrote into a folder named `target`, `node_modules` or `.git` is not looked at. The message says "if git tracks it".

## What the tool does not check

- Whether a signature is valid, a certificate has expired, or an app is notarized. It reads settings, not artifacts.
- Content security policy, IPC validation, permission handlers, navigation limits, `shell.openExternal`, fuses, and every other item of the security checklist beyond the five settings.
- The signature or the manifest of an update, or the server it comes from; only the address scheme and the Tauri `pubkey` are checked.
- Linux packaging, Windows installer settings other than signing, Mac App Store builds.
- Dependencies of the project, their versions and their advisories.

## Size

- A configuration file or the releases file over 10 MB is not read. A source file over 2 MB is not scanned. A file with more than 1,000,000 tokens is scanned only up to that.
- At most 3,000 source files are read, in path order. At most 200,000 files are looked at when searching for key files, and folders nested deeper than 16 levels are not entered.
- JSON nested deeper than 64 levels, or with more than 200,000 values, is refused. YAML nested deeper than 64 levels, with more than 100,000 lines or a line over 4,000 characters, is refused.
- Text shown in a report is cut to a fixed length: 300 characters for a name, a subject or a path, 1,200 for a message or a fix, 600 for a note.

Every limit is reported, as a finding, a note or a stopped run, so a cut is never silent.
