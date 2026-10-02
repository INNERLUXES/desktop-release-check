// Report formats: text for a terminal, Markdown for a pull request or job summary, JSON for other tools, CSV
// for a spreadsheet.

function plural(count, one, many = `${one}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

function countsLine(c) {
  return `${c.error} error, ${c.warning} warning, ${c.info} info`;
}

function where(f) {
  return `${f.file}:${f.line}`;
}

function gateLine(r) {
  return r.gate.pass ? `GATE: PASS (--fail-on ${r.gate.failOn})` : `GATE: FAIL - ${r.gate.reason}`;
}

function electronLine(r) {
  const e = r.electron;
  if (e === null) return null;
  if (e.declared === null) return 'electron: no electron dependency in package.json';
  const d = e.declared;
  const base = `electron: ${d.spec === null ? 'not a string' : d.spec} (${d.file}:${d.line})`;
  if (e.releases === null) return `${base}, support not checked (no --releases file)`;
  const rel = `latest stable major ${e.releases.latestMajor}, supported ${e.releases.supported.join(', ')} (${e.releases.file})`;
  return d.major === null ? `${base}, version not read` : `${base}, major ${d.major}, ${rel}`;
}

const STATE_TEXT = { configured: 'configured', missing: 'not configured', disabled: 'turned off', adhoc: 'ad hoc identity' };

function settingValue(l) {
  return l.value === 'expression' ? 'an expression' : l.value;
}

export function toText(r) {
  const lines = [`desktop-release-check: ${r.project.path}`, `project: ${r.project.kinds.join(', ')}`];
  const eLine = electronLine(r);
  if (eLine) lines.push(eLine);
  if (r.project.kinds.includes('electron')) {
    lines.push(`webPreferences: ${plural(r.source.objects, 'object')} in ${plural(r.source.filesWithObjects, 'file')}, ${plural(r.source.files, 'source file')} read`);
    for (const s of r.settings) {
      if (s.locations.length === 0) lines.push(`  ${s.setting.padEnd(28)}  not found in source`);
      for (const l of s.locations) lines.push(`  ${s.setting.padEnd(28)}  ${settingValue(l).padEnd(13)}  ${where(l)}${l.unsafe ? '  UNSAFE' : ''}`);
    }
  }
  lines.push('signing:');
  for (const platform of ['windows', 'macos']) {
    if (!r.platforms.includes(platform)) {
      lines.push(`  ${platform.padEnd(7)}  skipped (--platforms)`);
      continue;
    }
    if (r.signing[platform].length === 0) lines.push(`  ${platform.padEnd(7)}  not checked`);
    for (const s of r.signing[platform]) {
      let text = `${s.packager}: ${STATE_TEXT[s.state] ?? s.state}${s.how ? ` (${s.how})` : ''}`;
      if (platform === 'macos' && s.hardenedRuntime) text += `, hardened runtime ${s.hardenedRuntime}`;
      if (platform === 'macos' && s.notarization) text += `, notarization ${s.notarization === 'env' ? 'by environment variables, not checked' : s.notarization}`;
      lines.push(`  ${platform.padEnd(7)}  ${text}  ${where(s)}`);
    }
  }
  lines.push('update:');
  if (r.update.length === 0) lines.push('  nothing to check');
  for (const u of r.update) lines.push(`  ${u.packager.padEnd(8)}  ${u.present ? u.how : 'no update setup found'}${u.file && u.line ? `  ${u.file}:${u.line}` : ''}`);
  lines.push(`key files: ${plural(r.keyFiles.found.length, 'file')} found`);
  lines.push('checks:');
  for (const c of r.checks) lines.push(`  ${c.n}  ${c.name.padEnd(30)}  ${c.result.padEnd(11)}  ${c.detail}`);
  lines.push(`findings: ${countsLine(r.counts)}`);
  if (!r.findings.length) lines.push('', 'no findings');
  for (const f of r.findings) {
    lines.push('', `${f.severity.toUpperCase().padEnd(7)}  ${f.id}  ${where(f)}  ${f.subject}`, `         ${f.message}`, `         fix: ${f.fix}`);
  }
  if (r.notes.length) lines.push('');
  for (const note of r.notes) lines.push(`note: ${note}`);
  lines.push('', gateLine(r));
  return lines.join('\n') + '\n';
}

// A Markdown table cell: backslashes and pipes escaped, line breaks flattened, and <, > and & written as
// entities, so text from an input file cannot break the table or be read as HTML.
export function mdCell(t) {
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n|\r/g, ' ');
}

export function toMarkdown(r) {
  const lines = [`## desktop-release-check: ${countsLine(r.counts)}`, '', `Project: \`${mdCell(r.project.path).replace(/`/g, "'")}\` (${mdCell(r.project.kinds.join(', '))}).`];
  lines.push('', '| Check | Result | Detail |', '| --- | --- | --- |');
  for (const c of r.checks) lines.push(`| ${c.n}. ${mdCell(c.name)} | ${c.result === 'fail' ? '**fail**' : mdCell(c.result)} | ${mdCell(c.detail)} |`);
  if (r.project.kinds.includes('electron') && r.settings.length) {
    lines.push('', '| webPreferences setting | Where | Value |', '| --- | --- | --- |');
    for (const s of r.settings) {
      if (s.locations.length === 0) lines.push(`| ${mdCell(s.setting)} | | not found in source |`);
      for (const l of s.locations) lines.push(`| ${mdCell(s.setting)} | ${mdCell(where(l))} | ${l.unsafe ? '**' : ''}${mdCell(settingValue(l))}${l.unsafe ? '**' : ''} |`);
    }
  }
  if (!r.findings.length) lines.push('', 'No findings.');
  else {
    lines.push('', '| Severity | Check | Where | Message | Fix |', '| --- | --- | --- | --- | --- |');
    for (const f of r.findings) lines.push(`| ${f.severity} | ${mdCell(f.id)} | ${mdCell(where(f))} | ${mdCell(f.message)} | ${mdCell(f.fix)} |`);
  }
  if (r.notes.length) lines.push('');
  for (const note of r.notes) lines.push(`- ${mdCell(note)}`);
  lines.push('', r.gate.pass ? `**Gate passed** (--fail-on ${r.gate.failOn}).` : `**Gate failed:** ${mdCell(r.gate.reason)}.`);
  return lines.join('\n') + '\n';
}

export function toJson(r) {
  return JSON.stringify(r, null, 2) + '\n';
}

// RFC 4180 quoting, and a leading quote on cells a spreadsheet would read as a formula.
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One row per finding.
export function toCsv(r) {
  const rows = [['severity', 'id', 'check', 'file', 'line', 'subject', 'message', 'fix']];
  for (const f of r.findings) rows.push([f.severity, f.id, String(f.check), f.file, String(f.line), f.subject, f.message, f.fix]);
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
