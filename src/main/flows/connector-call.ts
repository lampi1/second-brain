// Validates portable connector recipes and substitutes only whole declared input values, never tool/server names.
import { createHash } from 'node:crypto';
import type { FlowConnectorCall } from '../../shared/flow-connector';
import { WORK_ROLE_IDS } from '../../shared/roles';
import { redact } from '../log';
const CREDENTIAL = /^(password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|cookie|credentials?)$/i;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
export const connectorHash = (v: unknown): string => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
function canonical(v: unknown): unknown { return Array.isArray(v) ? v.map(canonical) : plain(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v; }
export function connectorArguments(value: unknown, inputs: readonly string[], values?: Record<string, string>): Record<string, unknown> {
  if (!plain(value) || JSON.stringify(value).length > 16000) throw new Error('Connector arguments require a JSON object up to 16000 characters');
  const visit = (v: unknown, depth: number, templates = true): unknown => {
    if (depth > 8) throw new Error('Connector arguments exceed nesting limit');
    if (v === null || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      if (v.length > 8000 || /\u0000/.test(v) || redact(v) !== v) throw new Error('Connector arguments cannot contain credentials; use the connector vault');
      if (!templates || !v.includes('{{') && !v.includes('}}')) return v;
      const match = /^\{\{([a-z0-9][a-z0-9._:-]{0,100})\}\}$/.exec(v);
      if (!match || !inputs.includes(match[1]!)) throw new Error('Connector placeholders must be whole declared inputs: {{name}}');
      if (!values) return v;
      const result = values[match[1]!];
      if (result === undefined || result.length > 8000 || redact(result) !== result || /\u0000/.test(result)) throw new Error(`Connector input ${match[1]} is missing, oversized or contains a credential`);
      return result;
    }
    if (Array.isArray(v) && v.length <= 100) return v.map(x => visit(x, depth + 1, templates));
    if (templates && plain(v) && Object.hasOwn(v, '$input')) {
      if (Object.keys(v).some(k => !['$input', 'as'].includes(k)) || typeof v.$input !== 'string' || !inputs.includes(v.$input) || !['string', 'integer', 'number', 'boolean', 'json'].includes(v.as as string)) throw new Error('Typed connector binding requires {$input: declared input, as: string|integer|number|boolean|json}');
      if (!values) return { $input: v.$input, as: v.as };
      const raw = values[v.$input]; if (raw === undefined || raw.length > 8000) throw new Error(`Missing or oversized connector input ${v.$input}`);
      let value: unknown = raw;
      if (v.as !== 'string') { try { value = JSON.parse(raw); } catch { throw new Error(`Connector input ${v.$input} is not valid ${v.as}`); } }
      if (v.as === 'integer' && !Number.isSafeInteger(value) || v.as === 'number' && (typeof value !== 'number' || !Number.isFinite(value)) || v.as === 'boolean' && typeof value !== 'boolean') throw new Error(`Connector input ${v.$input} does not match ${v.as}`);
      return visit(value, depth + 1, false);
    }
    if (plain(v) && Object.keys(v).length <= 100) return Object.fromEntries(Object.entries(v).map(([k, x]) => {
      if (['__proto__', 'constructor', 'prototype'].includes(k) || CREDENTIAL.test(k) || k.length > 128) throw new Error('Connector argument key is unsafe or names a credential');
      return [k, visit(x, depth + 1, templates)];
    }));
    throw new Error('Connector arguments must contain bounded JSON data');
  };
  const result = visit(value, 0) as Record<string, unknown>;
  if (JSON.stringify(result).length > 16000) throw new Error('Resolved connector arguments exceed 16000 characters');
  return result;
}
export function validateConnector(value: unknown, inputs: readonly string[]): FlowConnectorCall {
  if (!plain(value) || Object.keys(value).some(k => !['serverId', 'tool', 'serverHash', 'toolHash', 'role', 'arguments'].includes(k))) throw new Error('Invalid connector recipe');
  const { serverId, tool, serverHash, toolHash, role } = value;
  if (typeof serverId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(serverId) || typeof tool !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(tool)) throw new Error('Connector requires exact serverId and tool names');
  if ([serverHash, toolHash].some(v => typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))) throw new Error('Read app_flow_connectors to pin serverHash and toolHash');
  if (!(WORK_ROLE_IDS as readonly unknown[]).includes(role)) throw new Error('Connector requires an existing work role');
  return { serverId, tool, serverHash: serverHash as string, toolHash: toolHash as string, role: role as FlowConnectorCall['role'], arguments: connectorArguments(value.arguments, inputs) };
}
