// The text of a question or a command card away from the PC (ADR 0259 §4): Telegram (phone-port.ts) and Remote Control
// (relay.ts, through the Orchestrator) show the same parts as the PC's «Bivio» card: the question, its context
// sentence, what the user must do («Tocca a te»), what was done, and what happens on each road. A command is the
// question «Eseguo sul PC?» with the command whole; since ADR 0275 nothing stays for the PC: a production, database or
// Azure one (touchesProdDbAzure) runs only after the user's yes to that whole command.
// Pure; used by phone-port.ts and relay.ts, pinned by test/unit/chats/ask-text.test.ts.
import type { ChatItem, PendingRequest, UiBrief } from '../../shared/contract';
import { prodRisk } from '../../shared/runnable';
import { filterOutgoing } from '../phone/filter';

/** the brief an agent attached to this request (show_ui next-ask), if any */
export function briefFor(p: Pick<PendingRequest, 'id'>, items: readonly ChatItem[]): UiBrief | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === 'artifact' && it.askId === p.id && it.ui.component === 'brief') return it.ui.props;
  }
  return undefined;
}

const numbered = (xs: readonly string[]) => xs.map((x, i) => `${i + 1}. ${x}`);

/** The question's parts, one per line (no markdown: the bridge filters and condenses it). */
export function questionLines(question: string, b: UiBrief | undefined): string[] {
  if (!b) return [question];
  const out = [question];
  if (b.why) out.push(b.why);
  if (b.change) out.push(`${b.change.what ? `${b.change.what}: ` : ''}${b.change.before} → ${b.change.after}`);
  if (b.todo?.length) out.push('Tocca a te:', ...numbered(b.todo));
  if (b.done.length) out.push('Fatto:', ...b.done.map(d => `• ${d}`));
  const road = (head: string, steps: readonly string[] | undefined, fx: string) =>
    steps?.length ? `${head}: ${steps.join(' → ')}` : fx ? `${head}: ${fx}` : '';
  out.push(road(`Se Sì${b.yesLabel ? ` (${b.yesLabel})` : ''}`, b.yesSteps, b.ifYes), road(`Se No${b.noLabel ? ` (${b.noLabel})` : ''}`, b.noSteps, b.ifNo));
  return out.filter(Boolean);
}

/** A command card as a question: what the phone and the relay show. */
export function commandLines(p: PendingRequest, who: string): string[] {
  const c = p.command;
  if (!c) return [p.title];
  return ['Eseguo questo comando sul tuo PC?', ...(c.lead ? [c.lead] : []), c.code,
    `Se Sì: lo lancio sul PC → l'esito va a ${who} da solo`, `Se No: non lo eseguo → ${who} va avanti senza`];
}

/** the owner's reserved commands besides production (2026-11-09: «DB writes, prod releases, Azure writes»): databases and
 *  migrations, Azure and other cloud or cluster tools (with a path before them too), recursive or bulk deletes */
const RESERVED_TOOL = /(?:^|[\s;|&('"`\\/])(?:az|azd|azcopy|aws|gcloud|gsutil|terraform|pulumi|kubectl|helm|sqlcmd|psql|mysql|mysqladmin|mongo|mongosh|mongos|sqlite3|redis-cli|invoke-sqlcmd|bcp|dotnet-ef|prisma|sequelize|knex|flyway|liquibase)(?:\.(?:cmd|exe|ps1|bat))?(?=$|[\s;|&)'"`])/i;
const RESERVED_WORDS = /\b(?:ef\s+database|migrat\w*|db:\w+|database|drop\s+(?:table|database|collection|schema)|truncate|delete\s+from|insert\s+into|update\s+\w+\s+set|\w+-az\w*|[a-z]+-azure\w*)\b/i;
/** an MCP tool of a cloud or database server (mcp__azure__…, azmcp_…, mcp__postgres__…, mcp__supabase__…) */
const RESERVED_MCP = /\b(?:mcp__[\w-]*(?:azure|az|sql|postgres|pg|mysql|maria|mongo|redis|supabase|neon|planetscale|cosmos|dynamo|db|database|prisma|drizzle)[\w-]*__|azmcp_)/i;
/** database and migration CLIs the tool list misses (supabase db, drizzle-kit, pg_dump, dropdb, mongorestore…) */
const RESERVED_CLI = /\b(?:supabase\s+db|drizzle-kit|pg_dump|pg_restore|pg_dumpall|createdb|dropdb|mongorestore|mongodump|mongoimport|mysqldump)\b|_?migrat\w*|database_url/i;

/** Text that runs something on production, a database or Azure (ADR 0275): the one thing the Orchestrator never grants
 *  for the user without his yes. A denylist, plus the runner's own production check (shared/runnable.ts prodRisk). */
export const touchesProdDbAzure = (text: string): boolean => RESERVED_TOOL.test(text) || RESERVED_WORDS.test(text) || RESERVED_MCP.test(text) || RESERVED_CLI.test(text)
  || /\b(deploy\w*|produzion\w*|production|prod)\b/i.test(text) || prodRisk(text) !== null;

/** Telegram's filter (phone/filter.ts) hides command lines and paths: a command the phone would show as
 *  «[comando: eseguilo dal PC]» is never decided there, the user must see what runs. */
export const commandShownWhole = (p: PendingRequest): boolean => !!p.command && filterOutgoing(p.command.code) === p.command.code;
