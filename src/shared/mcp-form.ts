// Flat MCP elicitation forms mapped to the existing question panel. The harness validates user answers before
// returning typed content; unsupported constraints and credential fields never become an automatic approval.
import type { PendingRequest, Question } from './contract';

interface Field { name: string; question: Question; type: 'string' | 'number' | 'integer' | 'boolean'; required: boolean; enum?: string[]; min?: number; max?: number; minLength?: number; maxLength?: number }
export interface McpForm { fields: Field[]; questions: Question[] }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const SKIP = 'Non compilare';
const CONTROL = /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const CREDENTIAL = /(password|passwd|passphrase|secret|token|api.?key|credential|credenzial|chiave api)/i;
export const isMcpFormRequest = (req: Pick<PendingRequest, 'type' | 'tool'>): boolean => req.type === 'question' && req.tool.startsWith('mcp__');

export function mcpForm(schema: unknown, message = ''): McpForm {
  if (!object(schema) || schema.type !== 'object' || !object(schema.properties)) throw new Error('expected an object schema');
  if (CREDENTIAL.test(`${message} ${String(schema.title ?? '')} ${String(schema.description ?? '')}`)) throw new Error('credential fields require a login handoff');
  if (Object.keys(schema).some(k => !['type', 'properties', 'required', 'additionalProperties', 'title', 'description'].includes(k))) throw new Error('unsupported form constraints');
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') throw new Error('unsupported additionalProperties');
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(k => typeof k !== 'string' || !Object.hasOwn(schema.properties!, k)))) throw new Error('invalid required fields');
  const required = new Set(schema.required as string[] | undefined), entries = Object.entries(schema.properties);
  if (entries.length > 8) throw new Error('at most 8 fields are supported');
  const fields = entries.map(([name, raw]): Field => {
    if (!name || name.length > 100 || CONTROL.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('invalid field name');
    if (!object(raw) || !['string', 'number', 'integer', 'boolean'].includes(String(raw.type))) throw new Error('unsupported field type');
    if (CREDENTIAL.test(`${name} ${String(raw.title ?? '')} ${String(raw.description ?? '')}`)) throw new Error('credential fields require a login handoff');
    const allowed = ['type', 'title', 'description', 'default', ...(raw.type === 'string' ? ['enum', 'minLength', 'maxLength'] : raw.type === 'boolean' ? [] : ['minimum', 'maximum'])];
    if (Object.keys(raw).some(k => !allowed.includes(k))) throw new Error('unsupported field constraints');
    for (const key of ['title', 'description']) if (raw[key] !== undefined && (typeof raw[key] !== 'string' || (raw[key] as string).length > 2000)) throw new Error('invalid field description');
    for (const key of ['minimum', 'maximum', 'minLength', 'maxLength']) if (raw[key] !== undefined && (typeof raw[key] !== 'number' || !Number.isFinite(raw[key]) || (key.endsWith('Length') && (!Number.isInteger(raw[key]) || (raw[key] as number) < 0)))) throw new Error('invalid field bounds');
    if (typeof raw.title === 'string' && CONTROL.test(raw.title)) throw new Error('invalid field title');
    if (typeof raw.minimum === 'number' && typeof raw.maximum === 'number' && raw.minimum > raw.maximum || typeof raw.minLength === 'number' && typeof raw.maxLength === 'number' && raw.minLength > raw.maxLength) throw new Error('inconsistent field bounds');
    if (raw.enum !== undefined && (!Array.isArray(raw.enum) || !raw.enum.length || raw.enum.length > 8 || raw.enum.some(v => typeof v !== 'string' || !v.trim() || v.length > 200 || v === SKIP) || new Set(raw.enum).size !== raw.enum.length)) throw new Error('unsupported enum');
    const choices = raw.type === 'boolean' ? ['Sì', 'No'] : raw.enum as string[] | undefined;
    const hints = [raw.description, required.has(name) ? 'Obbligatorio' : 'Facoltativo', raw.type === 'integer' ? 'Numero intero' : raw.type === 'number' ? 'Numero' : '',
      raw.minimum !== undefined ? `Minimo: ${raw.minimum}` : '', raw.maximum !== undefined ? `Massimo: ${raw.maximum}` : '',
      raw.minLength !== undefined ? `Almeno ${raw.minLength} caratteri` : '', raw.type === 'string' ? `Massimo ${Math.min(Number(raw.maxLength ?? 16000), 16000)} caratteri` : ''];
    const question: Question = { question: raw.title ? `${raw.title} (${name})` : name, header: hints.filter(Boolean).join(' · '), options: [...(choices ?? []), ...(required.has(name) ? [] : [SKIP])].map(label => ({ label })), multiSelect: false };
    return { name, question, type: raw.type as Field['type'], required: required.has(name), ...(raw.enum ? { enum: raw.enum as string[] } : {}), ...(raw.minimum !== undefined ? { min: raw.minimum as number } : {}), ...(raw.maximum !== undefined ? { max: raw.maximum as number } : {}), ...(raw.minLength !== undefined ? { minLength: raw.minLength as number } : {}), ...(raw.maxLength !== undefined ? { maxLength: raw.maxLength as number } : {}) };
  });
  if (new Set(fields.map(f => f.question.question)).size !== fields.length) throw new Error('ambiguous field labels');
  return { fields, questions: fields.map(f => f.question) };
}

export function mcpFormAnswer(form: McpForm, answers: Record<string, string | string[]>): Record<string, string | number | boolean> {
  const content: Record<string, string | number | boolean> = Object.create(null);
  for (const f of form.fields) {
    const raw = answers[f.question.question];
    if ((raw === undefined || raw === SKIP) && !f.required) continue;
    if (typeof raw !== 'string') throw new Error(`Risposta richiesta: ${f.name}`);
    let value: string | number | boolean = raw;
    if (f.type === 'boolean') {
      if (!['Sì', 'No'].includes(raw)) throw new Error(`${f.name}: scegli Sì o No`);
      value = raw === 'Sì';
    } else if (f.type === 'number' || f.type === 'integer') {
      value = Number(raw);
      if (!raw.trim() || !Number.isFinite(value) || (f.type === 'integer' && !Number.isSafeInteger(value)) || (f.min !== undefined && value < f.min) || (f.max !== undefined && value > f.max)) throw new Error(`${f.name}: numero non valido o fuori intervallo`);
    } else if ((f.enum && !f.enum.includes(raw)) || raw.length < (f.minLength ?? 0) || raw.length > Math.min(f.maxLength ?? 16000, 16000)) throw new Error(`${f.name}: testo non valido per il modulo`);
    content[f.name] = value;
  }
  return content;
}
