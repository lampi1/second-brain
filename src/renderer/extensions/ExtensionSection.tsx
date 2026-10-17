// A single accessible data renderer for validated extensions; integration owns navigation and data loading.
import { parseSection } from '../../shared/extension-section';
import { t } from '../i18n';

export function ExtensionSection({ manifest }: { manifest: unknown }) {
  let section;
  try { section = parseSection(manifest); }
  catch { return <p role="alert">{t('sections.invalid')}</p>; }
  const statuses: Record<string, string> = { open: t('sections.open'), done: t('sections.done'), blocked: t('sections.blocked') };
  return <section aria-label={section.title}>
    <h2>{section.title}</h2>
    {section.rows.length === 0 ? <p>{t('sections.noRows')}</p> :
      <table><caption>{section.title}</caption>
        <thead><tr>{section.columns.map(c => <th scope="col" key={c.id}>{c.label}</th>)}</tr></thead>
        <tbody>{section.rows.map(row => <tr key={row.id}>{row.cells.map((cell, i) =>
          <td key={section.columns[i]!.id}>{section.columns[i]!.kind === 'status' ? statuses[cell] : section.columns[i]!.kind === 'date' ? <time dateTime={cell}>{cell}</time> : cell}</td>)}</tr>)}</tbody>
      </table>}
  </section>;
}
