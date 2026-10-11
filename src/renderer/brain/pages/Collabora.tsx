// Collaborazione: how the chats work together without you. Mailboxes (who listens, who has unread mail and is not
// listening = stuck work), who writes to whom (sent vs delivered), how long each shared environment (local stack, test
// node, browser pane) was held and how often a chat had to wait, plus the full mail and environment logs.
// Data: /api/tables (inbox, envs).
import { normTables, type Box, type EnvEvent, type MailEvent } from '../types';
import { useBrain } from '../api';
import { fmt } from '../lib/format';
import { sum } from '../lib/text';
import { Async, Empty, PageHead } from '../components/States';
import { HBarChart } from '../components/Charts';
import { DataTable, type Col } from '../components/DataTable';
import { Pill, Section } from '../components/ui';

const ACTION: Record<string, string> = { sent: 'inviato', delivered: 'consegnato', blocked: 'bloccato', take: 'preso', wait: 'in coda', got: 'ottenuto', release: 'lasciato' };

export function Collabora() {
  const t = useBrain('/api/tables', normTables);
  const d = t.data;
  const pairs = d ? Object.entries(d.inbox.stats).sort((a, b) => b[1].sent - a[1].sent) : [];
  const held = d ? Object.entries(d.envs.filter(e => e.action === 'release' && e.heldMin).reduce<Record<string, number>>((m, e) => ((m[e.env] = (m[e.env] ?? 0) + (e.heldMin ?? 0)), m), {})).sort((a, b) => b[1] - a[1]) : [];
  const waits = d?.envs.filter(e => e.action === 'wait').length ?? 0;
  const boxes = d?.inbox.boxes ?? [];
  const stuck = boxes.filter(b => b.unread && !b.listening);
  const sent = sum(pairs.map(([, s]) => s.sent));
  const boxCols: Col<Box>[] = [
    { key: 'box', label: 'Chat', render: r => <b>{r.box === 'regia' ? 'Regia' : r.box}</b> },
    { key: 'listening', label: 'In ascolto', width: '110px', value: r => (r.listening ? 'sì' : 'no'), help: 'sì = la chat si sveglia appena arriva un messaggio', render: r => <Pill tone={r.listening ? 'good' : 'outline'}>{r.listening ? 'sì' : 'no'}</Pill> },
    { key: 'unread', label: 'Da leggere', type: 'num', width: '110px', render: r => (r.unread ? <Pill tone={r.listening ? 'blue' : 'warn'}>{r.unread}</Pill> : '0') },
    { key: 'since', label: 'In ascolto dal', width: '150px', value: r => r.since ?? '', render: r => (r.since ? fmt.when(r.since) : '') },
  ];
  const mailCols: Col<MailEvent>[] = [
    { key: 'ts', label: 'Quando', type: 'date', width: '120px', render: r => fmt.when(r.ts) },
    { key: 'action', label: 'Azione', width: '110px', value: r => ACTION[r.action] ?? r.action, render: r => <Pill tone={r.action === 'delivered' ? 'good' : r.action === 'blocked' ? 'bad' : ''}>{ACTION[r.action] ?? r.action}</Pill> },
    { key: 'from', label: 'Da', clip: true },
    { key: 'to', label: 'A', clip: true },
    { key: 'via', label: 'Come', width: '120px', help: 'wait = la chat era in ascolto; hook = consegnato a fine turno', value: r => r.via ?? '' },
    { key: 'hop', label: 'Passo', type: 'num', width: '70px', help: 'Il numero della risposta nel botta e risposta (massimo 6, poi si ferma)', value: r => r.hop ?? '' },
  ];
  const envCols: Col<EnvEvent>[] = [
    { key: 'ts', label: 'Quando', type: 'date', width: '120px', render: r => fmt.when(r.ts) },
    { key: 'env', label: 'Ambiente', width: '150px' },
    { key: 'chat', label: 'Chat', clip: true },
    { key: 'action', label: 'Azione', width: '110px', value: r => ACTION[r.action] ?? r.action, help: 'preso; in coda = aspettava; ottenuto dopo l\'attesa; lasciato' },
    { key: 'heldMin', label: 'Minuti', type: 'num', width: '80px', value: r => r.heldMin ?? '' },
  ];

  return (
    <>
      <PageHead title="Collaborazione" at={t.at} onRefresh={() => t.reload()}
        lead={d ? <><b>{sent} messaggi</b> tra chat, <b>{boxes.filter(b => b.listening).length} chat in ascolto</b> adesso{stuck.length ? <>, <b>{stuck.length} con posta ferma</b></> : null}.</> : undefined}
        what="Come le chat si passano il lavoro da sole: la posta tra chat e gli ambienti condivisi (stack, nodi di test, pannello del browser)." />
      <Async loading={t.loading && !d} error={d ? null : t.error} onRetry={() => t.reload()} lines={6} block>
        {() => d && (
          <>
            <Section title="Caselle di posta" count={boxes.length} testId="bx-boxes">
              {boxes.length ? <DataTable name="caselle" label="Caselle di posta" rows={boxes} cols={boxCols} search={false} sort={{ key: 'unread', dir: -1 }}
                explain={{ find: stuck.length ? <><b>{stuck.length} {stuck.length === 1 ? 'chat ha' : 'chat hanno'} posta non letta e non {stuck.length === 1 ? 'ascolta' : 'ascoltano'}</b>: {stuck.map(b => b.box).join(', ')}.</> : <>Nessun messaggio fermo: <b>la posta arriva</b>.</>, next: stuck.length ? 'riapri quelle chat o chiedi alla Regia di girare il messaggio' : undefined, says: 'ogni chat che usa la posta tra chat: se sta ascoltando e cosa la aspetta.', why: 'un messaggio non letto è un lavoro fermo.' }} />
                : <Empty title="Nessuna casella di posta">Le chat che si scrivono tra loro compaiono qui.</Empty>}
            </Section>
            {(pairs.length > 0 || held.length > 0) && (
              <div className="bx-grid-2">
                {pairs.length > 0 && <HBarChart title="Chi scrive a chi" name="posta-coppie" labels={pairs.map(([k]) => k.replace(' -> ', ' → '))} series={[{ label: 'inviati', values: pairs.map(([, s]) => s.sent) }, { label: 'consegnati', values: pairs.map(([, s]) => s.delivered) }]}
                  explain={{ find: <>La coppia più attiva: <b>{pairs[0]![0].replace(' -> ', ' → ')} ({pairs[0]![1].sent})</b>.{pairs.some(([, s]) => s.delivered < s.sent) ? ' Qualche messaggio non è ancora consegnato.' : ''}</>, says: 'quali chat si passano il lavoro da sole.', why: 'ogni messaggio diretto è un passaggio che non fai tu.' }} />}
                {held.length > 0 && <HBarChart title="Ambienti condivisi: minuti occupati" name="ambienti-minuti" labels={held.map(([k]) => k)} series={[{ label: 'minuti', values: held.map(([, v]) => v) }]}
                  explain={{ find: <><b>{held[0]![0]}</b> è l'ambiente più conteso ({held[0]![1]} minuti){waits ? <>; <b>{waits} {waits === 1 ? 'volta' : 'volte'}</b> una chat ha dovuto aspettare</> : null}.</>, says: 'quanto ogni stack, nodo di test o pannello del browser è stato occupato.', why: 'se una chat aspetta spesso, lì serve un secondo ambiente.' }} />}
              </div>
            )}
            <Section title="Registro della posta" count={d.inbox.log.length}>
              <DataTable name="posta-registro" label="Registro della posta" rows={[...d.inbox.log].reverse()} cols={mailCols} filters={['action', 'from', 'to']}
                explain={{ says: 'ogni messaggio inviato e consegnato tra chat.', why: 'per ritrovare chi ha detto cosa a chi.' }} empty="Nessun messaggio tra chat." />
            </Section>
            <Section title="Registro degli ambienti" count={d.envs.length}>
              <DataTable name="ambienti-registro" label="Registro degli ambienti" rows={[...d.envs].reverse()} cols={envCols} filters={['env', 'action']}
                explain={{ says: 'chi ha preso, aspettato e lasciato uno stack o il pannello del browser.', why: 'per capire perché una chat era ferma.' }} empty="Nessun ambiente condiviso usato." />
            </Section>
          </>
        )}
      </Async>
    </>
  );
}
