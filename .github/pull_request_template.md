## What changes

<!-- One or two sentences. -->

## Checks

- [ ] `npm test`, `npm run check` and `npm run example` pass, and the files under `examples/output` are the ones `npm run example` wrote
- [ ] A change to a check or a reader is described in docs/method.md, and has a test with the project files written inline, and a near miss that must not match
- [ ] A change to an option name, a version rule or a security item follows the official pages: the new page text is saved in research/sources, `src/data.js` and docs/rules-and-sources.md match it, and nothing was added from memory
- [ ] Text from the input goes through `safeText`, and the tool still fetches nothing, opens no connection, runs no program and follows no symbolic link it was not given
- [ ] A thing the tool cannot see is reported as not checked or not found, never as passed, and the contents of a key file never reach a report
- [ ] Paths are opened with `path.resolve`, shown relative with forward slashes, and file names are compared exactly, so the result is the same on Linux, macOS and Windows
- [ ] No real key, certificate or token in fixtures or examples; key fixtures are a header made at run time and `FAKE-TEST-KEY`
- [ ] The commit messages of this pull request follow Conventional Commits
