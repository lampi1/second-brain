// Strict, non-executable TOML subset for foreign Codex agent files and generated tool exports.
export interface CodexAgentFile { name: string; description: string; developer_instructions: string; model?: string; model_reasoning_effort?: string; features?: Record<string, boolean> }

export function readAgentToml(text: string): CodexAgentFile {
  if (Buffer.byteLength(text) > 2 * 1024 ** 2 || text.includes('\0')) throw new Error('Invalid agent TOML');
  const values: Record<string, string | boolean> = {}, features: Record<string, boolean> = {};
  let section = false;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith('#')) continue;
    if (line === '[features]' && !section) { section = true; continue; }
    const match = /^([a-z_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new Error('Unsupported agent TOML syntax');
    const key = match[1]!, raw = match[2]!, target = section ? features : values;
    if (Object.hasOwn(target, key)) throw new Error('Duplicate TOML key');
    if (section) {
      if (!/^(true|false)(?:\s+#.*)?$/.test(raw)) throw new Error('Invalid TOML feature');
      features[key] = raw.startsWith('true'); continue;
    }
    if (!['name', 'description', 'developer_instructions', 'model', 'model_reasoning_effort'].includes(key)) throw new Error('Unsupported agent TOML key');
    let value: string;
    if (raw.startsWith('"""') || raw.startsWith("'''")) {
      const quote = raw.slice(0, 3); let body = raw.slice(3);
      while (!body.includes(quote)) { if (++i >= lines.length) throw new Error('Unclosed TOML string'); body += '\n' + lines[i]!; }
      const end = body.indexOf(quote);
      if (body.slice(end + 3).trim() && !body.slice(end + 3).trim().startsWith('#')) throw new Error('Trailing TOML content');
      body = body.slice(0, end).replace(/^\n/, '');
      value = quote === "'''" ? body : decodeBasic(body);
    } else if (raw.startsWith("'")) {
      const m = /^'([^']*)'\s*(?:#.*)?$/.exec(raw); if (!m) throw new Error('Invalid TOML literal'); value = m[1]!;
    } else {
      const m = /^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/.exec(raw); if (!m) throw new Error('Invalid TOML string'); value = decodeBasic(m[1]!);
    }
    values[key] = value;
  }
  if (!['name', 'description', 'developer_instructions'].every(k => typeof values[k] === 'string' && String(values[k]).trim())) throw new Error('Missing required Codex agent fields');
  return { ...values, ...(section ? { features } : {}) } as unknown as CodexAgentFile;
}

function decodeBasic(body: string): string {
  const escapes: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };
  let result = '';
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (char !== '\\') { result += char; continue; }
    const code = body[++i];
    if (code && Object.hasOwn(escapes, code)) { result += escapes[code]; continue; }
    if (code === 'u' || code === 'U') {
      const length = code === 'u' ? 4 : 8, hex = body.slice(i + 1, i + 1 + length);
      if (hex.length !== length || !/^[a-fA-F0-9]+$/.test(hex)) throw new Error('Invalid TOML escape');
      const point = parseInt(hex, 16);
      if (point > 0x10ffff || point >= 0xd800 && point <= 0xdfff) throw new Error('Invalid TOML codepoint');
      result += String.fromCodePoint(point); i += length; continue;
    }
    throw new Error('Unsupported TOML escape');
  }
  return result;
}

export function emitAgentToml(agent: CodexAgentFile): string {
  const lines = [`# Generated from agents/${agent.name}.md; edit the source agent instead.`];
  for (const key of ['name', 'description', 'developer_instructions', 'model_reasoning_effort'] as const) {
    if (agent[key] !== undefined) lines.push(`${key} = ${JSON.stringify(agent[key])}`);
  }
  if (agent.features) { lines.push('', '[features]'); for (const [key, value] of Object.entries(agent.features)) lines.push(`${key} = ${value}`); }
  return lines.join('\n') + '\n';
}
