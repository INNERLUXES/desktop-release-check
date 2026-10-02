# Security

## Reporting a problem

Write to info@innerluxes.dev with the subject line "desktop-release-check security", or use private vulnerability reporting on this repository. Please do not open a public issue for a vulnerability.

Include a small made-up project folder, configuration file or source file that shows the problem, what you expected and what happened. Use made-up app names, and no real keys, certificates, internal addresses or customer files.

## Scope

In scope:

- an input that makes the tool open a network connection or run a program
- an input that makes the tool read a file other than the ones listed in docs/inputs.md, through a symbolic link, a path written in a file or the `main` entry
- an input that makes the tool print the contents of a certificate or key file
- a configuration, source or releases file that makes a reader accept something its documented format does not allow, or follow a path
- an input that makes the tool hang, take very long, or use unbounded memory or stack, such as deep nesting, very many values, a very long string, a very long source line, unbalanced brackets, a folder with very many files, or a path that is not a regular file
- text from a file name, a version, an address or a key name that breaks a Markdown table, injects a formula into a CSV report, or rewrites the terminal through control or direction characters
- a key name such as `__proto__` that changes how objects behave inside the tool
- a finding that docs/method.md says is reported, for an input the tool accepts, that the report leaves out, or a check reported as passed that docs/method.md says is `not checked`

Out of scope: how the app uses its settings at run time, whether the project signs in a release job through environment variables (docs/limits.md lists what a check of the files cannot see), the packagers and the documentation the tool follows, and the security of the certificates themselves.

Read [docs/threat-model.md](docs/threat-model.md) for the rest.
