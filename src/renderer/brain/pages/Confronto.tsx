// Confronto modelli: the brain's model comparison (the same job done by Claude's and Cursor's agents, judged blind):
// the main report rendered (tables exportable in CSV), the report files to download, every comparison file openable
// in Esplora; the report ends with the discussion bar (ADR 0037). Data: /api/files (reviews/compare/…) and /api/file.
import { normFile, normFiles } from '../types';
import { useBrain } from '../api';
import { fmt } from '../lib/format';
import { baseName } from '../lib/text';
import { Async, Empty, Explain, PageHead } from '../components/States';
import { DataTable, type Col } from '../components/DataTable';
import { Markdown } from '../components/Markdown';
import { download, IconDownload, Section, toast, type Navigate } from '../components/ui';
import { DiscussBar } from '../components/Discuss';

const PREFIX = 'reviews/compare/';
const MAIN = ['reviews/compare/report.md', 'reviews/compare/summary.md'];

export async function saveBrainFile(path: string): Promise<void> {
  const r = await window.sb.invoke('brain:api', { path: `/api/file?p=${encodeURIComponent(path)}` });
  if (!r.ok) { toast(`Non riesco a leggere ${baseName(path)}: ${r.error}`); return; }
  const f = normFile(r.data);
  download(baseName(path), f.text, /\.json$/.test(path) ? 'application/json' : /\.html$/.test(path) ? 'text/html' : 'text/markdown');
}

interface Row { file: string; nome: string; cartella: string }
export function Confronto({ nav }: { nav: Navigate }) {
  const files = useBrain('/api/files', normFiles);
  const all = files.data ?? [];
  const reports = all.filter(f => f.startsWith(PREFIX));
  const main = MAIN.find(f => all.includes(f)) ?? reports.find(f => f.endsWith('.md')) ?? null;
  const doc = useBrain(main ? `/api/file?p=${encodeURIComponent(main)}` : null, normFile);
  const set = new Set(all);
  const rows: Row[] = reports.map(f => ({ file: f, nome: baseName(f), cartella: f.slice(PREFIX.length).split('/').slice(0, -1).join('/') || '(principale)' }));
  const cols: Col<Row>[] = [
    { key: 'nome', label: 'File', render: r => <button type="button" className="bx-go" onClick={() => nav(`esplora/${r.file}`)}>{r.nome}</button> },
    { key: 'cartella', label: 'Cartella', width: '30%' },
    { key: 'file', label: 'Scarica', width: '110px', render: r => <button type="button" className="bx-btn s" onClick={() => void saveBrainFile(r.file)}><IconDownload /> Scarica</button> },
  ];
  return (
    <>
      <PageHead title="Confronto modelli" at={files.at} onRefresh={() => { files.reload(); doc.reload(); }}
        lead={files.data ? (reports.length ? <><b>{reports.length} file di confronto</b>{main ? <> · il report principale è aggiornato {fmt.ago(doc.data?.modified)}</> : null}.</> : <b>Nessun confronto ancora.</b>) : undefined}
        what="Lo stesso lavoro fatto dagli agenti di Cursor e di Claude, giudicato alla cieca: chi trova più problemi veri, chi dà falsi allarmi, quanto costa, quanto ci mette." />
      <Explain says="chi trova più problemi veri, chi dà falsi allarmi, quanto costa e quanto tempo ci mette." why="decide quale strumento usare per quale lavoro, con i numeri e non a sensazione."
        next={reports.length ? 'guarda «Ancora da giudicare»: senza il tuo giudizio (o della QA) i numeri restano a zero' : undefined} />
      <Async loading={files.loading && !files.data} error={files.data ? null : files.error} onRetry={() => files.reload()} lines={6} block>
        {() => !reports.length ? <Empty title="Nessun report di confronto">Quando un confronto tra modelli finisce, il suo report compare qui.</Empty> : (
          <>
            <div className="bx-row">{MAIN.concat('reviews/compare/report.html').filter(f => set.has(f)).map(f => <button key={f} type="button" className="bx-btn" onClick={() => void saveBrainFile(f)}><IconDownload /> Scarica {baseName(f)}</button>)}</div>
            {main && (
              <section className="bx-card" data-testid="bx-compare-report">
                <Async loading={doc.loading && !doc.data} error={doc.data ? null : doc.error} onRetry={() => doc.reload()} lines={8}>
                  {() => doc.data && <><p className="small muted" style={{ marginBottom: 8 }}>{main} · aggiornato {fmt.when(doc.data.modified)}</p><Markdown text={doc.data.text} files={set} onOpenFile={f => nav(`esplora/${f}`)} name="confronto" />
                    <DiscussBar testId="bx-compare-discuss" topic={{ kind: 'quote', quote: { id: `confronto|${main}`, what: 'numero', title: 'il confronto tra modelli', source: `${main}, aggiornato ${fmt.when(doc.data.modified)}`,
                      facts: [`${reports.length} file di confronto in reviews/compare/`], question: 'Cosa ci dice questo confronto? Quale modello per quale lavoro, e cosa resta da giudicare?' } }} /></>}
                </Async>
              </section>
            )}
            <Section title="Tutti i file del confronto" count={reports.length}>
              <DataTable name="file-confronto" label="File del confronto" rows={rows} cols={cols} filters={['cartella']} />
            </Section>
          </>
        )}
      </Async>
    </>
  );
}
