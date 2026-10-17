// A single accessible data renderer for validated extensions; integration owns navigation and data loading.
import { parseSection } from '../../shared/extension-section';

export function ExtensionSection({ manifest }: { manifest: unknown }) {
  let section;
  try { section = parseSection(manifest); }
  catch { return <p role="alert">Sezione non disponibile: i dati non sono validi. Ricarica la sezione.</p>; }
  const statuses: Record<string, string> = { open: 'Aperta', done: 'Completata', blocked: 'Bloccata' };
  return <section aria-label={section.title}>
    <h2>{section.title}</h2>
    {section.rows.length === 0 ? <p>Nessun elemento. Aggiungi dati alla sezione per iniziare.</p> :
      <table><caption>{section.title}</caption>
        <thead><tr>{section.columns.map(c => <th scope="col" key={c.id}>{c.label}</th>)}</tr></thead>
        <tbody>{section.rows.map(row => <tr key={row.id}>{row.cells.map((cell, i) =>
          <td key={section.columns[i]!.id}>{section.columns[i]!.kind === 'status' ? statuses[cell] : section.columns[i]!.kind === 'date' ? <time dateTime={cell}>{cell}</time> : cell}</td>)}</tr>)}</tbody>
      </table>}
  </section>;
}
