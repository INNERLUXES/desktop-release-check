# Threat model

## What the tool touches

- It reads the project folder named on the command line: `package.json`, the electron-builder and Forge configuration files, the source under `src/` and the `main` entry, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, and the releases file named with `--releases`. It also walks the project folder to find certificate and key files, and reads at most the first 64 KB of a `.pem` file.
- It does not follow a path or an address written inside a file, and it does not follow a symbolic link while walking.
- It writes only to the screen (standard output and standard error).
- It opens no network connection and runs no program: not a packager, not a shell, not `git`, not the app.

## What the input may hold

A project is often checked in a pipeline that runs on pull requests, including pull requests from people outside the team, and a desktop app may come from an agency or a vendor. The tool treats the whole folder as possibly hostile. A file can be huge, very deeply nested, or hold very many values. A source file can be made of unbalanced brackets, an unterminated string, or a very long run of characters meant to slow a tokenizer down. A configuration can hold a key named `__proto__` or `constructor`, a very long version string, or text with control and direction characters in an address. A file name can contain control characters. The folder can hold a symbolic link that points out of it, a device or a pipe where a file should be, or a very large number of files. The releases file can be anything.

## What could go wrong, and what stops it

| Risk | Control |
| --- | --- |
| A huge file, deeply nested JSON or YAML, or very many values exhaust memory or time | Files over 10 MB are refused from the size of the open file before they are read; a source file over 2 MB is skipped; JSON deeper than 64 levels, or with more than 200,000 values, is refused; YAML has limits on depth, lines and line length. The readers recurse only as deep as their limits |
| A crafted source file makes the scanner run for a very long time | The tokenizer reads each character once and has no backtracking pattern; template literals nest at most 16 deep; a file is cut at 1,000,000 tokens; an object is read for at most 5,000 tokens. Tests run unbalanced brackets, long runs of quotes and slashes, and deep nesting |
| A crafted version string, `Cargo.toml` line or YAML line makes a pattern run for a very long time | Text is cut to a fixed length before a pattern runs on it; the patterns are anchored and have bounded repeats and no nested repetition. Tests run very long near misses |
| A walk of a huge folder tree takes very long | The walk looks at no more than 200,000 files and 16 levels, skips `node_modules`, `.git` and `target`, and says when it stopped |
| A symbolic link leads to a file the user did not name | The walk never follows or lists a symbolic link. The configuration files are opened by name and must be regular files |
| A device, a pipe or a folder in place of a file makes the tool hang or read without end | The type and size are taken from the open file, and anything that is not a regular file is refused. A `.pem` is read for its first 64 KB only |
| A key named `__proto__` or `constructor` changes how objects behave | JSON and YAML are read into lists of keys and values; objects are never built from input keys. A test checks that no prototype changes |
| A file name or a value rewrites the terminal through escape sequences, or reorders text with direction characters | Control characters (C0 and C1), line and paragraph separators and Unicode direction controls are replaced by a space before any text reaches a report or an error message, and the length is capped |
| A value breaks the Markdown table in the job summary, or hides text as an HTML tag | Pipes, backslashes, line breaks, `<`, `>` and `&` are escaped in every table cell |
| A CSV report runs a formula when opened in a spreadsheet | Cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading `'`; every cell is quoted as RFC 4180 says |
| A private key is copied into a report, a job log or the job summary | A key file is reported by path and kind only. The first bytes of a `.pem` are looked at for a header and are never kept in a finding; a test checks that the text of a key file never appears in any report |
| A file that is not understood is skipped, and a check passes without having run | A configuration that cannot be read is a `config-unreadable` error, a format that is not read is named in `config-not-read`, a check with no input is `not checked`, and a platform left out is `skipped`. Nothing is guessed |
| The argument names a URL, so the tool becomes a fetcher | Arguments that look like addresses are refused, for the project folder and for `--releases`; the tool has no code that opens a connection, and a test checks that no module imports a network or process module |
| A project path outside the folder is read through `main` | The `main` entry is read only when it resolves to a file inside the project folder |

## Out of scope

What the app does at run time, the packager that builds it, the certificates and where they are stored, and the correctness of the documentation the tool follows. [limits.md](limits.md) lists what a check of the files cannot see.
