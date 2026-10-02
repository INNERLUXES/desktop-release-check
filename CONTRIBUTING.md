# Contributing

Every change goes through a pull request and is reviewed before it is merged. The pipeline runs the tests on Linux, Windows and macOS, the repository checks, CodeQL, and a secure development check of the repository itself.

Commit messages in this repository follow Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `ci:`, with `!` for a breaking change.

## Changing a check

1. Describe the change in docs/method.md first: what the check reports, its severity, and why it matters, with the page of the official documentation it follows. Where the tool makes its own choice (what counts as configured, what is a warning and what is an error, what is reported as not checked), say so and say why.
2. Add a test with the project files written inline, small enough that the result can be worked out by hand, and a near miss that must not match. Use made-up app names.
3. Text from the input goes through `safeText` before it reaches a finding or a note, so control characters are removed.
4. A finding id, once released, keeps its meaning: pipelines and other tools read it from the JSON and CSV reports.
5. A thing the tool cannot see is reported, never passed. Add a finding, a note or a `not checked` result for it.

## Changing the option names, the thresholds or the security items

The names in `src/data.js` come from the pages saved in `research/sources`: Electron's timelines and security pages, Microsoft's and Apple's pages, the electron-builder pages, the Electron Forge pages and the Tauri pages. When a page changes, save the new text in `research/sources` (the address on the first line), change `src/data.js` to match, and update docs/rules-and-sources.md. `test/data.test.js` compares the names and the quoted sentences with the saved text, so changing one without the other fails.

Never add an option name, a version rule or a security item from memory or from a blog post. A new rule needs the official page, opened and saved, and the words of the page that give the name or the number. The releases fixture in `test/fixtures` is a trimmed copy of Electron's list for the tests; it is not a source of facts, and the tests must not depend on which versions are current.

## Changing the readers

1. For the JSON, YAML, source scanner, `Cargo.toml` and version readers, add a test for every form you add and one that must be refused. Keep refusing YAML outside the subset of docs/inputs.md and JSON that is not JSON.
2. Keep the size, depth and token limits, and keep a limit on the length of a string before a pattern runs on it. A pattern must be anchored, with bounded repeats and no nested repetition; add a test with a long near miss.
3. Paths are opened with `path.resolve`, never `path.join`, so an absolute path works on every system. Paths shown in a report are relative, with forward slashes, and file names are compared exactly, letter case included. Do not assume that a backslash is a separator on Linux or macOS.

## Rules for the code

- No runtime dependencies. Node 22 or newer and nothing else.
- The tool reads files of the project and writes only to the screen. It opens no network connection, runs no program, and never follows a URL, a symbolic link or a path from an input.
- The contents of a certificate or key file never reach a report.
- Source files stay ASCII; write any other character in a pattern as a Unicode escape.
- Never commit a real key, certificate or token, even as a fixture, even an expired one. A fixture for a key file is a header line made at run time in the test and the words `FAKE-TEST-KEY`. `npm run check` fails on anything that looks like a credential.
- The README and the documents carry no dates or years.

## Before you open the pull request

```
npm test
npm run check
npm run example
```
