# Secure defaults

The default run is the safe run. Nothing below needs a flag, and none of it can be switched off.

## How the tool behaves by default

- **No network.** The tool reads the files it is given and sends nothing anywhere. It does not download the Electron release list (you save it and pass it with `--releases`), does not look up a certificate, a version or a page, does not follow an address from any file, and does not check for updates. An argument that looks like an address is refused. It can run in a locked-down job with no outbound access at all.
- **No commands.** The tool never runs a packager, a build, a package manager, `git`, a shell or any other program. No name, path or value from the input is ever put on a command line. A project from an unknown source can be checked without running any of its code, which is not true of installing its dependencies or running its build.
- **No dependencies.** Node 22 or newer and nothing else, so a release check does not add a supply chain of its own. There is no `node_modules` to install before it runs.
- **Strict readers.** The JSON configuration files are read by a small reader that accepts only JSON: no comments, no trailing commas, nesting no deeper than 64 levels, a key twice in one object refused. The YAML configuration is read by a reader for a documented subset, which refuses everything else with its line. A file that is not understood is a finding that fails the gate by default; it is never skipped without a word.
- **Reads only what is named.** The tool opens the files listed in [inputs.md](inputs.md). It does not follow a symbolic link while it walks the project, and it does not open a file that a configuration names.
- **Regular files only, bounded.** Each file is opened once, its type and size are taken from the open file, and anything that is not a regular file or is over the limit is refused or skipped before it is read.
- **Keys stay out of the report.** A certificate or key file is reported by its path and kind. The tool never copies its contents into a finding, a note or any output format.
- **Clean output.** Text from the input has control characters, line separators and direction controls removed and its length capped before it reaches a report or an error message, so a hostile file name or value cannot rewrite the terminal or reorder what a reader sees. Markdown cells escape pipes, backslashes, line breaks and `<`, `>` and `&`. CSV cells are quoted as RFC 4180 says, and a cell that a spreadsheet would read as a formula gets a leading `'`.
- **No prototype tricks.** JSON and YAML are read into lists, so a key named `__proto__` or `constructor` is just data.
- **Not checked is never fine.** A check that had nothing to read says `not checked`, a platform that was left out says `skipped`, and a setting that was not found says "not found in source". None of them is written as a pass.
- **The gate is on.** Without any option, an error makes the run exit with `1`. A pipeline that adds the tool notices an unsupported Electron major, an unsafe `webPreferences` value, an update address over http and a key file from the first run.
- **Writes nothing to disk.** The report goes to the screen. Redirect it to a file or the job summary only when you need to keep it.

## Running it safely on a project you do not know

1. Run the check before anything else touches the project: before `npm install`, before a build, before a packager. Each of those runs code; the check does not.
2. Run it as a user with read access to the folder and nothing else. It needs no certificate, no account, no keys and no network.
3. Read the notes and the info findings: they say which configuration was not read and which setting was left out, so a pass is not taken for more than it is.
