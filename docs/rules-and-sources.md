# Rules and sources

Every version rule, option name and security item the tool uses comes from an official page, opened and saved under [research/sources](../research/sources) with its address on the first line. `src/data.js` holds the names, and `test/data.test.js` compares each of them, and the sentences quoted in the findings, with the saved text, so a name cannot change without the page text changing with it. Nothing here was taken from memory or from a blog post. Where the documentation names a setting only through an environment variable, the tool says that it cannot see it.

The pages were saved as text. Navigation and page chrome were dropped; the first line of each file is `Source:` and the address. The Apple page is rendered by script, so its text was taken from the JSON that Apple publishes for the same page.

## Electron

| Rule | Value | Where it is written |
| --- | --- | --- |
| Support window | "The latest three stable major versions are supported by the Electron team" | Electron timelines, "Version support policy". https://www.electronjs.org/docs/latest/tutorial/electron-timelines ([electron-timelines.txt](../research/sources/electron-timelines.txt)) |
| Minor releases | "We only support the latest minor release for each stable release series" | the same page. Its example: if the latest release is 42.1.x, the 41.0.x and 40.2.x series are supported |
| Where the list comes from | a saved copy of the release list that Electron publishes | https://releases.electronjs.org/releases.json (downloaded by the user, passed with `--releases`) |
| Item 2 | "2. Do not enable Node.js integration for remote content": the example to avoid is `nodeIntegration: true` | Electron security checklist. https://www.electronjs.org/docs/latest/tutorial/security ([electron-security.txt](../research/sources/electron-security.txt)) |
| Item 3 | "3. Enable Context Isolation": `contextIsolation: false` | the same page |
| Item 4 | "4. Enable process sandboxing": `sandbox: false` | the same page |
| Item 6 | "6. Do not disable webSecurity": `webSecurity: false` | the same page |
| Item 8 | "8. Do not enable allowRunningInsecureContent": `allowRunningInsecureContent: true` | the same page |
| Item 16 | "16. Use a current version of Electron" | the same page; quoted in the fix of an unsupported version |
| Defaults | the safe value is the default since Electron 5 (`nodeIntegration`), 12 (`contextIsolation`) and 20 (`sandbox`) | the notes under items 2, 3 and 4. Carried in the JSON report as a fact of the page |

The security page says item 2 concerns renderers "that load remote content", and that disabling context isolation also disables process sandboxing. The tool reports the setting it finds and says that it cannot see what a window loads.

## Signing and notarization

| Rule | Value | Where it is written |
| --- | --- | --- |
| Windows, why sign | signing consecutive releases "with a consistent publisher/signing identity lets publisher reputation build over time" | Microsoft, code signing options. https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options ([microsoft-code-signing-options.txt](../research/sources/microsoft-code-signing-options.txt)) |
| macOS, why notarize | "Notarize your macOS software to give users more confidence that the Developer ID-signed software you distribute has been checked by Apple for malicious components" | Apple, notarizing macOS software before distribution. https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution ([apple-notarization.txt](../research/sources/apple-notarization.txt)) |
| macOS, what the notary service requires | "Enable code-signing for all of the executables you distribute"; a Developer ID certificate, not an ad hoc one; "Enable the Hardened Runtime capability for your app and command line targets" | the same page, "Prepare your software for notarization" |

### electron-builder

| Option | Meaning | Where it is written |
| --- | --- | --- |
| `win.sign` | the single Windows signing option; a `type` of `signtool`, `hsm`, `pkcs11` or `azure`; unset signs with credentials from the environment (`WIN_CSC_LINK`, `CSC_LINK`); `false` or `null` disables signing | https://www.electron.build/docs/win ([electron-builder-win.txt](../research/sources/electron-builder-win.txt)) and https://www.electron.build/docs/features/code-signing/code-signing-win ([electron-builder-code-signing-win.txt](../research/sources/electron-builder-code-signing-win.txt)) |
| `win.signtoolOptions`, `win.azureSignOptions` | the version 26 keys, which the page says were removed and rewritten to `win.sign` | the Windows page |
| `mac.sign.identity` | the signing certificate; not set looks in the keychain; `null` skips signing; `"-"` is ad hoc | https://www.electron.build/docs/mac ([electron-builder-mac.txt](../research/sources/electron-builder-mac.txt)) and https://www.electron.build/docs/features/code-signing/code-signing-mac ([electron-builder-code-signing-mac.txt](../research/sources/electron-builder-code-signing-mac.txt)) |
| `mac.sign.hardenedRuntime` | "required for notarization on macOS 10.15+"; the default is `true` for standard darwin builds | the macOS page |
| `mac.identity`, `mac.hardenedRuntime` | the older flat keys, which the page says are rewritten into `mac.sign` | the macOS page |
| `mac.notarize` | "notarize stays on mac"; `notarize: true` enables it; the Apple credentials are environment variables | https://www.electron.build/docs/features/code-signing/notarization ([electron-builder-notarization.txt](../research/sources/electron-builder-notarization.txt)) |
| `publish` | the update providers; can be set at the top level or per platform | https://www.electron.build/docs/publish ([electron-builder-publish.txt](../research/sources/electron-builder-publish.txt)) |
| `url`, `endpoint`, `publicUrl`, `protocol` | the address fields of the generic server, S3, R2 and GitHub providers; `protocol` is `"https"` or `"http"` for GitHub | the publish page and https://www.electron.build/docs/features/auto-update ([electron-builder-auto-update.txt](../research/sources/electron-builder-auto-update.txt)) |
| configuration files | the `build` key of `package.json`, or `electron-builder.yml` (the default), JSON, JSON5, TOML, JavaScript or TypeScript | https://www.electron.build/docs/configuration ([electron-builder-configuration.txt](../research/sources/electron-builder-configuration.txt)) |

The current electron-builder pages describe version 27, in which the signing options moved into `win.sign` and `mac.sign`. A project that has not migrated is read through the older keys that the pages name. The tool follows the pages; it does not know which version of electron-builder a project installs.

### Electron Forge

| Option | Meaning | Where it is written |
| --- | --- | --- |
| `packagerConfig.osxSign` | enables macOS signing; the object must exist, even if empty | https://www.electronforge.io/guides/code-signing/code-signing-macos ([forge-code-signing-macos.txt](../research/sources/forge-code-signing-macos.txt)) |
| `packagerConfig.osxNotarize` | notarization, with an Apple ID, an API key or a keychain profile | the same page |
| `packagerConfig.windowsSign`, `windowsSign` in a maker | Windows signing | https://www.electronforge.io/guides/code-signing/code-signing-windows ([forge-code-signing-windows.txt](../research/sources/forge-code-signing-windows.txt)) |
| `certificateFile` in a maker `config` | the `.pfx` file of a Squirrel.Windows or MSI maker | the same page |

### Tauri 2

| Option | Meaning | Where it is written |
| --- | --- | --- |
| `bundle.windows.certificateThumbprint` | the SHA1 hash of the signing certificate | https://v2.tauri.app/distribute/sign/windows/ ([tauri-sign-windows.txt](../research/sources/tauri-sign-windows.txt)) and https://v2.tauri.app/reference/config/ ([tauri-config-reference.txt](../research/sources/tauri-config-reference.txt)) |
| `bundle.windows.signCommand` | a custom command that signs the binaries | the same pages |
| `bundle.macOS.signingIdentity` | the identity to sign with; `"-"` is ad hoc | https://v2.tauri.app/distribute/sign/macos/ ([tauri-sign-macos.txt](../research/sources/tauri-sign-macos.txt)) |
| `bundle.macOS.hardenedRuntime` | "Whether the codesign should enable hardened runtime"; default `true` | the configuration reference |
| notarization | the App Store Connect API credentials or an Apple ID, set as environment variables | the macOS signing page |
| `plugins.updater.pubkey` | "has to be the public key generated from the Tauri CLI. It cannot be a file path!" | https://v2.tauri.app/plugin/updater/ ([tauri-updater.txt](../research/sources/tauri-updater.txt)) |
| `plugins.updater.endpoints` | an array of endpoint URLs; "TLS is enforced in production mode" | the updater page |
| `plugins.updater.dangerousInsecureTransportProtocol` | "allows the updater to accept non-HTTPS endpoints. Use this configuration with caution!" | the updater page |
| version 1 layout | `tauri > bundle` moved to the top level; `tauri > updater` moved to `plugins > updater` | https://v2.tauri.app/start/migrate/from-tauri-1/ ([tauri-migrate-from-v1.txt](../research/sources/tauri-migrate-from-v1.txt)) |

## What the pages leave open

- The Forge pages name no option for the hardened runtime, so the tool does not check it for Forge.
- The electron-builder pages do not say how a configuration in `package.json` and one in `electron-builder.yml` combine, so the tool reads both and counts a setting when either sets it.
- The Tauri pages show the notarization credentials only as environment variables, so notarization is info for Tauri, never pass and never fail.
- The saved pages are the text of the pages as they were read. A page that changes needs a new saved copy and a change of `src/data.js`; `test/data.test.js` fails until both agree.
