// The numbers, option names and page items the checks rest on. Each one comes from an official page that is saved,
// with its address on the first line, in research/sources, and test/data.test.js compares this file with the saved
// text. Change a value here only after saving the new page text and updating docs/rules-and-sources.md.

export const SOURCES = [
  { id: 'electron-timelines', file: 'electron-timelines.txt', url: 'https://www.electronjs.org/docs/latest/tutorial/electron-timelines' },
  { id: 'electron-security', file: 'electron-security.txt', url: 'https://www.electronjs.org/docs/latest/tutorial/security' },
  { id: 'microsoft-code-signing-options', file: 'microsoft-code-signing-options.txt', url: 'https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options' },
  { id: 'apple-notarization', file: 'apple-notarization.txt', url: 'https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution' },
  { id: 'electron-builder-configuration', file: 'electron-builder-configuration.txt', url: 'https://www.electron.build/docs/configuration' },
  { id: 'electron-builder-win', file: 'electron-builder-win.txt', url: 'https://www.electron.build/docs/win' },
  { id: 'electron-builder-mac', file: 'electron-builder-mac.txt', url: 'https://www.electron.build/docs/mac' },
  { id: 'electron-builder-publish', file: 'electron-builder-publish.txt', url: 'https://www.electron.build/docs/publish' },
  { id: 'electron-builder-auto-update', file: 'electron-builder-auto-update.txt', url: 'https://www.electron.build/docs/features/auto-update' },
  { id: 'electron-builder-code-signing', file: 'electron-builder-code-signing.txt', url: 'https://www.electron.build/docs/features/code-signing/' },
  { id: 'electron-builder-code-signing-win', file: 'electron-builder-code-signing-win.txt', url: 'https://www.electron.build/docs/features/code-signing/code-signing-win' },
  { id: 'electron-builder-code-signing-mac', file: 'electron-builder-code-signing-mac.txt', url: 'https://www.electron.build/docs/features/code-signing/code-signing-mac' },
  { id: 'electron-builder-notarization', file: 'electron-builder-notarization.txt', url: 'https://www.electron.build/docs/features/code-signing/notarization' },
  { id: 'forge-code-signing-windows', file: 'forge-code-signing-windows.txt', url: 'https://www.electronforge.io/guides/code-signing/code-signing-windows' },
  { id: 'forge-code-signing-macos', file: 'forge-code-signing-macos.txt', url: 'https://www.electronforge.io/guides/code-signing/code-signing-macos' },
  { id: 'tauri-sign-windows', file: 'tauri-sign-windows.txt', url: 'https://v2.tauri.app/distribute/sign/windows/' },
  { id: 'tauri-sign-macos', file: 'tauri-sign-macos.txt', url: 'https://v2.tauri.app/distribute/sign/macos/' },
  { id: 'tauri-updater', file: 'tauri-updater.txt', url: 'https://v2.tauri.app/plugin/updater/' },
  { id: 'tauri-config-reference', file: 'tauri-config-reference.txt', url: 'https://v2.tauri.app/reference/config/' },
  { id: 'tauri-migrate-from-v1', file: 'tauri-migrate-from-v1.txt', url: 'https://v2.tauri.app/start/migrate/from-tauri-1/' }
];

export const RELEASES_URL = 'https://releases.electronjs.org/releases.json';

// Electron's policy: "The latest three stable major versions are supported by the Electron team." The same page:
// "We only support the latest minor release for each stable release series."
export const SUPPORT = {
  majors: 3,
  policy: 'The latest three stable major versions are supported by the Electron team',
  minorPolicy: 'We only support the latest minor release for each stable release series',
  page: 'https://www.electronjs.org/docs/latest/tutorial/electron-timelines'
};

export const SECURITY_PAGE = 'https://www.electronjs.org/docs/latest/tutorial/security';

// The webPreferences settings of the security page, the value that breaks the item, the item as the page names it,
// and the sentence of the page that gives the version since which the safe value is the default (null: none).
export const SECURITY_SETTINGS = [
  { setting: 'nodeIntegration', unsafe: true, id: 'insecure-node-integration', item: '2. Do not enable Node.js integration for remote content', defaultSince: { major: 5, text: 'This recommendation is the default behavior in Electron since 5.0.0' } },
  { setting: 'contextIsolation', unsafe: false, id: 'insecure-context-isolation', item: '3. Enable Context Isolation', defaultSince: { major: 12, text: 'Context Isolation is the default behavior in Electron since 12.0.0' } },
  { setting: 'sandbox', unsafe: false, id: 'insecure-sandbox', item: '4. Enable process sandboxing', defaultSince: { major: 20, text: 'This recommendation is the default behavior in Electron since 20.0.0' } },
  { setting: 'webSecurity', unsafe: false, id: 'insecure-web-security', item: '6. Do not disable webSecurity', defaultSince: null },
  { setting: 'allowRunningInsecureContent', unsafe: true, id: 'insecure-content', item: '8. Do not enable allowRunningInsecureContent', defaultSince: null }
];

export const CURRENT_VERSION_ITEM = '16. Use a current version of Electron';

// Microsoft's page and Apple's page, the reasons behind the signing and notarization warnings.
export const MICROSOFT_PAGE = 'https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options';
export const APPLE_PAGE = 'https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution';

// electron-builder, as its configuration pages name the options. In the current documentation Windows signing is
// the "sign" option of "win" (a "type" of signtool, hsm, pkcs11 or azure; false or null turns signing off), and the
// macOS signing options live in "mac.sign"; "notarize" stays on "mac". The keys of the older layout are still read,
// because the pages name them: "signtoolOptions" and "azureSignOptions" under "win", and "identity" and
// "hardenedRuntime" directly under "mac".
export const BUILDER = {
  winKey: 'win',
  macKey: 'mac',
  signKey: 'sign',
  signTypes: ['signtool', 'hsm', 'pkcs11', 'azure'],
  legacyWin: ['signtoolOptions', 'azureSignOptions'],
  identity: 'identity',
  hardenedRuntime: 'hardenedRuntime',
  notarize: 'notarize',
  adHocIdentity: '-',
  publish: 'publish',
  publishUrlKeys: ['url', 'endpoint', 'publicUrl'],
  protocolKey: 'protocol',
  updaterPackage: 'electron-updater',
  buildKey: 'build',
  configFiles: ['electron-builder.yml', 'electron-builder.json'],
  unreadFiles: ['electron-builder.json5', 'electron-builder.toml', 'electron-builder.js', 'electron-builder.ts']
};

// Electron Forge: the options of its signing pages.
export const FORGE = {
  file: 'forge.config.json',
  unreadFiles: ['forge.config.js', 'forge.config.ts'],
  packagerConfig: 'packagerConfig',
  osxSign: 'osxSign',
  osxNotarize: 'osxNotarize',
  windowsSign: 'windowsSign',
  certificateFile: 'certificateFile',
  makers: 'makers',
  makerConfig: 'config'
};

// Tauri 2, as its configuration reference and guides name the options.
export const TAURI = {
  dir: 'src-tauri',
  file: 'tauri.conf.json',
  unreadFiles: ['tauri.conf.json5', 'Tauri.toml'],
  cargo: 'Cargo.toml',
  bundle: 'bundle',
  windows: 'windows',
  macos: 'macOS',
  certificateThumbprint: 'certificateThumbprint',
  signCommand: 'signCommand',
  signingIdentity: 'signingIdentity',
  hardenedRuntime: 'hardenedRuntime',
  adHocIdentity: '-',
  plugins: 'plugins',
  updater: 'updater',
  pubkey: 'pubkey',
  endpoints: 'endpoints',
  insecureTransport: 'dangerousInsecureTransportProtocol',
  updaterPlugin: 'tauri-plugin-updater',
  v1Key: 'tauri'
};

export const PACKAGE_FILE = 'package.json';
export const ELECTRON_PACKAGE = 'electron';

// Files that hold a certificate or a private key.
export const KEY_EXTENSIONS = ['.pfx', '.p12', '.key'];
export const PEM_EXTENSION = '.pem';
export const PEM_MARKER = 'PRIVATE KEY-----';
export const PEM_BEGIN = '-----BEGIN ';

export const SOURCE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'];
export const SOURCE_DIR = 'src';

export const PLATFORMS = ['windows', 'macos'];
