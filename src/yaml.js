// A small, strict reader for the subset of YAML that an electron-builder.yml uses: block mappings, block
// sequences, plain, single-quoted and double-quoted scalars, comments, and flow sequences of scalars. It keeps
// the line of every value and returns the same nodes as the JSON reader in json.js. Anything else (anchors,
// aliases, tags, block scalars, flow mappings with content, tab indentation, several documents) is refused with
// the line, and never guessed. Nothing here uses a pattern that can backtrack on its input.

export const YAML_LIMITS = { maxDepth: 64, maxLines: 100_000, maxLineLength: 4000 };

function fail(label, line, message) {
  throw new Error(`${label}: line ${line}: ${message}`);
}

// The text of a line without its comment: a "#" that starts the line or follows a space or tab, outside quotes.
function stripComment(text) {
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (quote === '"' && c === '\\') i += 1;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      if (i === 0 || ' \t[,:-'.includes(text[i - 1])) quote = c;
    } else if (c === '#' && (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\t')) {
      return text.slice(0, i);
    }
  }
  return text;
}

// The index of the colon that ends a mapping key (followed by a space or the end of the text), outside quotes,
// or -1.
function keyColon(text) {
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (quote === '"' && c === '\\') i += 1;
      else if (c === quote) quote = '';
    } else if ((c === '"' || c === "'") && i === 0) {
      quote = c;
    } else if (c === ':' && (i === text.length - 1 || text[i + 1] === ' ')) {
      return i;
    }
  }
  return -1;
}

const DOUBLE_ESCAPES = { '"': '"', '\\': '\\', '/': '/', n: '\n', t: '\t', r: '\r', 0: '\0', b: '\b', f: '\f' };

function quoted(text, line, label) {
  const q = text[0];
  let out = '';
  let i = 1;
  for (;;) {
    if (i >= text.length) fail(label, line, 'a quoted string is not closed on the same line');
    const c = text[i];
    if (q === "'") {
      if (c === "'") {
        if (text[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        break;
      }
      out += c;
      i += 1;
    } else {
      if (c === '"') break;
      if (c === '\\') {
        const n = text[i + 1];
        if (n === undefined || !Object.hasOwn(DOUBLE_ESCAPES, n)) fail(label, line, 'this escape in a double-quoted string is not supported');
        out += DOUBLE_ESCAPES[n];
        i += 2;
        continue;
      }
      out += c;
      i += 1;
    }
  }
  if (text.slice(i + 1).trim() !== '') fail(label, line, 'text after a quoted string');
  return out;
}

function scalar(raw, line, label) {
  const text = raw.trim();
  if (text.startsWith('"') || text.startsWith("'")) return { t: 'string', line, value: quoted(text, line, label) };
  if (text === 'true' || text === 'false') return { t: 'boolean', line, value: text === 'true' };
  if (text === 'null' || text === '~' || text === '') return { t: 'null', line, value: null };
  if (text.length <= 30 && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(text)) return { t: 'number', line, value: Number(text) };
  if ('&*!|>%@`'.includes(text[0])) fail(label, line, `"${text[0]}" at the start of a value (anchors, aliases, tags and block scalars) is not supported`);
  if (text[0] === '{') {
    if (text === '{}') return { t: 'object', line, props: [] };
    fail(label, line, 'a flow mapping with content is not supported; write it as a block mapping');
  }
  if (text[0] === '[') return flowSequence(text, line, label);
  return { t: 'string', line, value: text };
}

function flowSequence(text, line, label) {
  if (text[text.length - 1] !== ']') fail(label, line, 'a flow sequence must end on the same line');
  const inner = text.slice(1, -1);
  const items = [];
  let quote = '';
  let start = 0;
  const push = (end) => {
    const part = inner.slice(start, end).trim();
    if (part !== '') {
      if (part[0] === '[' || part[0] === '{') fail(label, line, 'a flow sequence inside a flow sequence is not supported');
      items.push(scalar(part, line, label));
    }
  };
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (quote) {
      if (quote === '"' && c === '\\') i += 1;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ',') {
      push(i);
      start = i + 1;
    }
  }
  push(inner.length);
  return { t: 'array', line, items };
}

function isSeqStart(content) {
  return content === '-' || content.startsWith('- ');
}

export function parseYaml(text, label = 'input', { limits = YAML_LIMITS } = {}) {
  const rawLines = String(text).replace(/^\ufeff/, '').split(/\r\n|\n|\r/);
  if (rawLines.length > limits.maxLines) throw new Error(`${label}: more than ${limits.maxLines.toLocaleString('en-US')} lines`);
  const items = [];
  let started = false;
  rawLines.forEach((raw, index) => {
    const line = index + 1;
    if (raw.length > limits.maxLineLength) fail(label, line, `a line longer than ${limits.maxLineLength} characters`);
    let indent = 0;
    while (raw[indent] === ' ') indent += 1;
    if (raw[indent] === '\t') fail(label, line, 'a tab in the indentation; YAML needs spaces');
    const content = stripComment(raw.slice(indent)).trimEnd();
    if (content === '') return;
    if (content === '---' && !started) {
      started = true;
      return;
    }
    if (indent === 0 && (content === '---' || content === '...' || content.startsWith('--- '))) fail(label, line, 'more than one document is not supported');
    if (indent === 0 && content.startsWith('%')) fail(label, line, 'a directive is not supported');
    started = true;
    items.push({ indent, content, line });
  });
  if (items.length === 0) return { t: 'null', line: 1, value: null };

  let pos = 0;

  function parseNode(indent, depth) {
    if (depth > limits.maxDepth) fail(label, items[pos].line, `nested more than ${limits.maxDepth} deep`);
    const item = items[pos];
    if (isSeqStart(item.content)) return parseSeq(item.indent, depth);
    if (keyColon(item.content) !== -1 && item.content[0] !== '[' && item.content[0] !== '{') return parseMap(item.indent, depth);
    pos += 1;
    return scalar(item.content, item.line, label);
  }

  function parseMap(indent, depth) {
    const first = items[pos];
    const props = [];
    const seen = new Set();
    while (pos < items.length) {
      const item = items[pos];
      if (item.indent < indent) break;
      if (item.indent > indent) fail(label, item.line, 'unexpected indentation');
      if (isSeqStart(item.content)) break;
      const colon = keyColon(item.content);
      if (colon === -1) fail(label, item.line, 'a "key: value" pair is expected');
      let key = item.content.slice(0, colon).trim();
      if (key.startsWith('"') || key.startsWith("'")) key = quoted(key, item.line, label);
      else if ('&*!|>?[{%@`'.includes(key[0] ?? ' ') || key === '<<') fail(label, item.line, 'this kind of key is not supported');
      if (seen.has(key)) fail(label, item.line, `the key "${key.slice(0, 40).replace(/[^ -~]/g, '?')}" appears twice in one mapping`);
      seen.add(key);
      const rest = item.content.slice(colon + 1).trim();
      pos += 1;
      let value;
      if (rest === '') {
        const next = items[pos];
        if (next && next.indent > indent) value = parseNode(next.indent, depth + 1);
        else if (next && next.indent === indent && isSeqStart(next.content)) value = parseSeq(indent, depth + 1);
        else value = { t: 'null', line: item.line, value: null };
      } else {
        value = scalar(rest, item.line, label);
      }
      props.push({ key, line: item.line, value });
    }
    return { t: 'object', line: first.line, props };
  }

  function parseSeq(indent, depth) {
    const first = items[pos];
    const list = [];
    while (pos < items.length) {
      const item = items[pos];
      if (item.indent < indent) break;
      if (item.indent > indent) fail(label, item.line, 'unexpected indentation');
      if (!isSeqStart(item.content)) break;
      const after = item.content.slice(1);
      const rest = after.trim();
      if (rest === '') {
        pos += 1;
        const next = items[pos];
        if (next && next.indent > indent) list.push(parseNode(next.indent, depth + 1));
        else list.push({ t: 'null', line: item.line, value: null });
        continue;
      }
      if (isSeqStart(rest)) fail(label, item.line, 'a sequence inside a sequence on one line is not supported');
      if (keyColon(rest) !== -1 && rest[0] !== '[' && rest[0] !== '{') {
        // "- key: value": the mapping starts here and continues on the following lines at the column of the key.
        const column = indent + 1 + (after.length - after.trimStart().length);
        items[pos] = { indent: column, content: rest, line: item.line };
        list.push(parseMap(column, depth + 1));
        continue;
      }
      pos += 1;
      list.push(scalar(rest, item.line, label));
    }
    return { t: 'array', line: first.line, items: list };
  }

  const root = parseNode(items[0].indent, 0);
  if (pos < items.length) fail(label, items[pos].line, 'unexpected content after the end of the document');
  return root;
}
