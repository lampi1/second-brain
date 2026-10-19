// Standalone, deterministic product preview: five views, every request size, permission scopes and same-id updates.
// No Electron/IPC or agent commands: the bridge refuses all actions. Open through genui:preview, never app bootstrap.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Bridge, Lang } from '@shared/contract';
import { setLang } from './i18n';
import { catalogFixtures, questionFixture } from './components/genui/fixtures';
import './styles/tokens.css';
import './styles/app.css';
import './styles/genui.css';
import './styles/qwin.css';

window.sb = { invoke: () => Promise.reject(new Error('Preview: no application actions')), on: () => () => {} } as unknown as Bridge;
const { ArtifactCard } = await import('./components/GenUi');
const { RequestPanel } = await import('./components/RequestPanel');

function Preview() {
  const [language, languageSet] = useState<Lang>('it');
  const [theme, themeSet] = useState('dark');
  const [revision, revise] = useState(0);
  const [answers, answerSet] = useState(0);
  const richQuestion = questionFixture(language);
  const control = { padding: 10, marginRight: 10, background: 'var(--surface-3)', border: '1px solid var(--border-3)', borderRadius: 6 };
  return <main style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
    <h1>GenUI · {language === 'it' ? 'Anteprima componenti' : 'Component preview'}</h1>
    <nav style={{ marginBottom: 24 }} aria-label="Preview controls">
      <button style={control} onClick={() => { const next = language === 'it' ? 'en' : 'it'; setLang(next); languageSet(next); }}>IT / EN</button>
      <button style={control} onClick={() => { const next = theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; themeSet(next); }}>{theme}</button>
      <button style={control} onClick={() => revise(n => n + 1)}>{language === 'it' ? 'Aggiorna stesso id' : 'Update same id'}</button>
      <output aria-live="polite">{language === 'it' ? 'Risposte inviate' : 'Answers submitted'}: {answers}</output>
    </nav>
    {catalogFixtures.map(spec => <ArtifactCard key={spec.component} cwd="C:/fixture" item={{ kind: 'artifact', id: 'preview-' + spec.component,
      key: spec.component, at: 0, target: 'chat', title: spec.component, summary: `${language === 'it' ? 'Revisione' : 'Revision'} ${revision}`,
      ui: spec.component === 'barChart' ? { ...spec, props: { ...spec.props, bars: spec.props.bars.map((b, i) => i === 0 ? { ...b, value: b.value + revision } : b) } } : spec }} />)}
    <div key={language}>
      {(['window', 'tile', 'orchestrator', 'lane', 'compact'] as const).map(variant => <section key={variant} style={{ marginTop: 32 }}>
        <RequestPanel req={{ ...richQuestion, id: variant }} variant={variant} chatTitle="Fixture"
          onAnswer={() => answerSet(n => n + 1)} />
      </section>)}
      <section style={{ marginTop: 32 }}><h2>{language === 'it' ? 'Permessi' : 'Permissions'}</h2>
        <RequestPanel variant="tile" req={{ ...richQuestion, id: 'permission', type: 'permission', questions: undefined,
          tool: 'Bash', title: 'Leggi il report / Read report', input: { command: 'Get-Content report.md' }, detail: 'Get-Content report.md', alwaysRules: ['Read(report.md)'] }} onAnswer={() => answerSet(n => n + 1)} />
      </section>
    </div>
  </main>;
}
document.body.style.overflow = 'auto';
document.documentElement.dataset.theme = 'dark';
createRoot(document.getElementById('root')!).render(<Preview />);
