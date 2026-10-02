// Finds the webPreferences of an Electron app in JavaScript and TypeScript source, without running or parsing the
// language in full. A small tokenizer skips comments, strings, template literals and regular expressions, so that
// text inside them is never read as code, and keeps the line of every token. Then every object written after
// "webPreferences:" or "webPreferences =" is read for its top-level properties. A property is a literal when its
// whole value is true or false; anything else is an expression the tool does not evaluate. The tokenizer reads
// each character once and uses no pattern that can backtrack.

export const SCAN_LIMITS = { maxTokens: 1_000_000, maxObjectTokens: 5000, maxTemplateDepth: 16 };

const REGEX_AFTER_PUNCT = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'delete', 'void', 'throw', 'in', 'of', 'new', 'await', 'yield', 'else', 'do']);

function isIdStart(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$' || c > '\u007f';
}

function isIdPart(c) {
  return isIdStart(c) || (c >= '0' && c <= '9');
}

// Tokens: { k: 'id' | 'str' | 'num' | 'p' | 'tpl' | 're', v, line }. Returns { tokens, truncated }.
export function tokenize(text, limits = SCAN_LIMITS) {
  const s = String(text);
  const tokens = [];
  let i = 0;
  let line = 1;
  let truncated = false;

  // Past the end of a template literal that starts after its opening backtick at index start; counts lines.
  function skipTemplate(start, depth) {
    let j = start;
    while (j < s.length) {
      const c = s[j];
      if (c === '\n') line += 1;
      if (c === '\\') {
        if (s[j + 1] === '\n') line += 1;
        j += 2;
        continue;
      }
      if (c === '`') return j + 1;
      if (c === '$' && s[j + 1] === '{') {
        if (depth >= limits.maxTemplateDepth) return s.length;
        j = skipExpression(j + 2, depth + 1);
        continue;
      }
      j += 1;
    }
    return j;
  }

  // Past the "}" that closes a template expression that starts at index start.
  function skipExpression(start, depth) {
    let j = start;
    let braces = 1;
    while (j < s.length) {
      const c = s[j];
      if (c === '\n') line += 1;
      if (c === '`') {
        j = skipTemplate(j + 1, depth);
        continue;
      }
      if (c === '"' || c === "'") {
        j += 1;
        while (j < s.length && s[j] !== c && s[j] !== '\n') j += s[j] === '\\' ? 2 : 1;
        j += 1;
        continue;
      }
      if (c === '{') braces += 1;
      if (c === '}') {
        braces -= 1;
        if (braces === 0) return j + 1;
      }
      j += 1;
    }
    return j;
  }

  const regexAllowed = () => {
    const last = tokens[tokens.length - 1];
    if (!last) return true;
    if (last.k === 'p') return REGEX_AFTER_PUNCT.has(last.v);
    if (last.k === 'id') return REGEX_AFTER_WORD.has(last.v);
    return false;
  };

  while (i < s.length) {
    if (tokens.length >= limits.maxTokens) {
      truncated = true;
      break;
    }
    const c = s[i];
    if (c === '\n') {
      line += 1;
      i += 1;
    } else if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '\ufeff' || c === '\u00a0') {
      i += 1;
    } else if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i += 1;
    } else if (c === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) {
        if (s[i] === '\n') line += 1;
        i += 1;
      }
      i += 2;
    } else if (c === '"' || c === "'") {
      const start = i + 1;
      let j = start;
      while (j < s.length && s[j] !== c && s[j] !== '\n') j += s[j] === '\\' ? 2 : 1;
      tokens.push({ k: 'str', v: s.slice(start, Math.min(j, s.length)), line });
      i = j + 1;
    } else if (c === '`') {
      const startLine = line;
      i = skipTemplate(i + 1, 0);
      tokens.push({ k: 'tpl', v: '', line: startLine });
    } else if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < s.length && s[j] !== '\n') {
        if (s[j] === '\\') {
          j += 2;
          continue;
        }
        if (s[j] === '[') inClass = true;
        else if (s[j] === ']') inClass = false;
        else if (s[j] === '/' && !inClass) break;
        j += 1;
      }
      j += 1;
      while (j < s.length && isIdPart(s[j])) j += 1;
      tokens.push({ k: 're', v: '', line });
      i = j;
    } else if (isIdStart(c)) {
      let j = i + 1;
      while (j < s.length && isIdPart(s[j])) j += 1;
      tokens.push({ k: 'id', v: s.slice(i, j), line });
      i = j;
    } else if (c >= '0' && c <= '9') {
      let j = i + 1;
      while (j < s.length && (isIdPart(s[j]) || s[j] === '.')) j += 1;
      tokens.push({ k: 'num', v: s.slice(i, j), line });
      i = j;
    } else {
      tokens.push({ k: 'p', v: c, line });
      i += 1;
    }
  }
  return { tokens, truncated };
}

const OPEN = new Set(['{', '(', '[']);
const CLOSE = new Set(['}', ')', ']']);

const isP = (t, v) => t !== undefined && t.k === 'p' && t.v === v;

// The properties at the top level of the object whose "{" is tokens[open]: { key, line, value, literal, spread }.
// value is 'true' or 'false' for a literal and null for anything else. Returns { props, end } or null when the
// object is not closed within the limit.
function readObject(tokens, open, limits) {
  const props = [];
  let depth = 1;
  let j = open + 1;
  let key = null;
  let keyLine = 0;
  let valueTokens = [];
  const finish = () => {
    if (key === null) return;
    let value = null;
    let literal = false;
    if (valueTokens.length === 1 && valueTokens[0].k === 'id' && (valueTokens[0].v === 'true' || valueTokens[0].v === 'false')) {
      value = valueTokens[0].v;
      literal = true;
    }
    props.push({ key, line: keyLine, value, literal });
    key = null;
    valueTokens = [];
  };
  for (; j < tokens.length && j - open <= limits.maxObjectTokens; j += 1) {
    const t = tokens[j];
    if (t.k === 'p' && OPEN.has(t.v)) {
      depth += 1;
      if (depth > 1 && key !== null) valueTokens.push(t);
      continue;
    }
    if (t.k === 'p' && CLOSE.has(t.v)) {
      depth -= 1;
      if (depth === 0) {
        finish();
        return { props, end: j };
      }
      if (key !== null) valueTokens.push(t);
      continue;
    }
    if (depth !== 1) {
      if (key !== null) valueTokens.push(t);
      continue;
    }
    if (isP(t, ',')) {
      finish();
      continue;
    }
    if (key === null) {
      if (isP(t, '.') && isP(tokens[j + 1], '.') && isP(tokens[j + 2], '.')) {
        props.push({ key: '...', line: t.line, value: null, literal: false, spread: true });
        j += 2;
        // skip the spread expression up to the next comma at this level
        let d = 0;
        for (j += 1; j < tokens.length && j - open <= limits.maxObjectTokens; j += 1) {
          const u = tokens[j];
          if (u.k === 'p' && OPEN.has(u.v)) d += 1;
          else if (u.k === 'p' && CLOSE.has(u.v)) {
            if (d === 0) {
              j -= 1;
              break;
            }
            d -= 1;
          } else if (d === 0 && isP(u, ',')) break;
        }
        continue;
      }
      if ((t.k === 'id' || t.k === 'str') && isP(tokens[j + 1], ':')) {
        key = t.v;
        keyLine = t.line;
        j += 1;
      } else if (t.k === 'id' && (isP(tokens[j + 1], ',') || isP(tokens[j + 1], '}'))) {
        // shorthand property: the value is the variable of the same name
        props.push({ key: t.v, line: t.line, value: null, literal: false });
      }
      continue;
    }
    valueTokens.push(t);
  }
  return null;
}

// Every object written as the value of webPreferences in the tokens: [{ line, props, ... }].
export function findWebPreferences(tokens, limits = SCAN_LIMITS) {
  const found = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (!((t.k === 'id' || t.k === 'str') && t.v === 'webPreferences')) continue;
    const sep = tokens[i + 1];
    if (!(isP(sep, ':') || isP(sep, '='))) continue;
    if (isP(sep, '=') && isP(tokens[i + 2], '=')) continue;
    if (!isP(tokens[i + 2], '{')) continue;
    const object = readObject(tokens, i + 2, limits);
    if (object) found.push({ line: t.line, props: object.props });
  }
  return found;
}

// The webPreferences objects of one source text, with { truncated } when the token limit cut the text short.
export function scanSource(text, limits = SCAN_LIMITS) {
  const { tokens, truncated } = tokenize(text, limits);
  return { objects: findWebPreferences(tokens, limits), truncated };
}
