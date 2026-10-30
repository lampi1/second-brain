// The options of a new lesson on Impara's start, in one line (ADR 0204; owner, 2026-10-30, report «Impara v3» I1: «le
// opzioni stanno in una sola riga riassuntiva che apre un pannello»): «Conosco le basi · 15′ · Claude Opus alto · voce
// attiva» and «Cambia», which opens one panel with how much the user knows already, how deep, who explains (ADR 0188:
// the engine, its model and its effort, from main's ImparaState.teachers; no choice = the app's: Claude's strongest
// model at high effort; the web research is always Claude's, and picking another engine says so) and the two voices.
// Remembered in Impara's prefs (lib/impara.ts). Used by ImparaStart.tsx; styles impara-quiz.css (.op-*).
import { useRef, useState } from 'react';
import { LESSON_DEPTHS, LESSON_LEVELS, type LessonTeacher, type TeacherOption } from '@shared/lesson';
import type { Effort, Harness } from '@shared/contract';
import { imparaPrefs, setImparaPrefs } from '../../lib/impara';
import { t } from '../../i18n';
import { Popover } from '../ui';
import { Select } from '../Select';
import { HarnessMark } from '../Icons';
import { ImparaSwitch } from './ImparaSwitch';
import '../../styles/impara-quiz.css';

/** The teacher as it will run: the user's choice when its engine is still on offer, else the app's. */
export function teacherNow(prefs: LessonTeacher | null, options: readonly TeacherOption[]): { opt: TeacherOption | null; model: string | null; effort: Effort | null; auto: boolean } {
  const opt = (prefs && options.find(o => o.engine === prefs.engine)) || null;
  if (opt) {
    const model = prefs!.model && opt.models.some(m => m.id === prefs!.model) ? prefs!.model : opt.models[0]?.id ?? null;
    return { opt, model, effort: opt.efforts.length ? prefs!.effort ?? 'high' : null, auto: false };
  }
  const first = options.find(o => o.web) ?? options[0] ?? null;
  return { opt: first, model: first?.models[0]?.id ?? null, effort: first?.efforts.length ? 'high' : null, auto: true };
}

/** «Claude Opus alto»: the engine, its model and effort, short. */
export function teacherLabel(now: ReturnType<typeof teacherNow>): string {
  if (!now.opt) return '';
  const model = now.opt.models.find(m => m.id === now.model)?.name ?? now.model ?? '';
  return [now.opt.label, model, now.effort ? t(`impara.effort.${now.effort}`) : ''].filter(Boolean).join(' ');
}

export function ImparaOptions({ teachers }: { teachers: readonly TeacherOption[] }) {
  const prefs = imparaPrefs.use(s => s);
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const now = teacherNow(prefs.teacher, teachers);
  const voice = prefs.voice ? (prefs.mic ? t('impara.go.voiceBoth') : t('impara.go.voiceOn')) : t('impara.go.voiceOff');
  const parts = [t(`impara.level.${prefs.level}`), t(`impara.depth.${prefs.depth}.short`), teacherLabel(now), voice].filter(Boolean);
  const setTeacher = (patch: Partial<LessonTeacher>) => {
    if (!now.opt) return;
    setImparaPrefs({ teacher: { engine: now.opt.engine, model: now.model, effort: now.effort, ...patch } });
  };
  const pickEngine = (engine: string) => {
    if (engine === '') { setImparaPrefs({ teacher: null }); return; }
    const o = teachers.find(x => x.engine === engine);
    if (o) setImparaPrefs({ teacher: { engine: o.engine, model: o.models[0]?.id ?? null, effort: o.efforts.length ? 'high' : null } });
  };
  return (
    <div className="op-line" data-testid="impara-options">
      <button ref={anchor} type="button" className="op-sum" onClick={() => setOpen(o => !o)} aria-haspopup="dialog" aria-expanded={open} data-testid="impara-options-open">
        {now.opt && <HarnessMark harness={now.opt.engine as Harness} size={13} />}
        <span className="op-sum-t" data-testid="impara-options-summary">{parts.join(' · ')}</span>
        <span className="op-change">{t('impara.go.change')}</span>
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} testid="impara-options-pop" width={400} align="start" kind="dialog" label={t('impara.go.optionsLabel')}>
        <div className="op-panel">
          <div className="op-row">
            <div className="op-l">{t('impara.levelLabel')}</div>
            <span className="ip-seg" role="radiogroup" aria-label={t('impara.levelLabel')}>
              {LESSON_LEVELS.map(l => <button key={l} type="button" role="radio" aria-checked={prefs.level === l} className={prefs.level === l ? 'on' : ''} onClick={() => setImparaPrefs({ level: l })} data-testid={`impara-level-${l}`}>{t(`impara.level.${l}`)}</button>)}
            </span>
          </div>
          <div className="op-row">
            <div className="op-l">{t('impara.depthLabel')}</div>
            <span className="ip-seg" role="radiogroup" aria-label={t('impara.depthLabel')}>
              {LESSON_DEPTHS.map(d => <button key={d} type="button" role="radio" aria-checked={prefs.depth === d} className={prefs.depth === d ? 'on' : ''} onClick={() => setImparaPrefs({ depth: d })} data-testid={`impara-depth-${d}`}>{t(`impara.depth.${d}.label`)}</button>)}
            </span>
          </div>
          {now.opt && (
            <div className="op-row">
              <div className="op-l" data-tip={t('impara.teacher.tip')}>{t('impara.teacher.label')}</div>
              <div className="op-teacher">
                <Select value={now.auto ? '' : now.opt.engine} onChange={e => pickEngine(e.target.value)} data-testid="impara-teacher" aria-label={t('impara.teacher.engine')}>
                  <option value="">{t('impara.teacher.auto')}</option>
                  {teachers.map(o => <option key={o.engine} value={o.engine}>{o.label}</option>)}
                </Select>
                {now.opt.models.length > 0 && (
                  <Select value={now.model ?? ''} onChange={e => setTeacher({ model: e.target.value })} data-testid="impara-teacher-model" aria-label={t('impara.teacher.model')}>
                    {now.opt.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </Select>
                )}
                {now.opt.efforts.length > 0 && (
                  <Select value={now.effort ?? ''} onChange={e => setTeacher({ effort: e.target.value as Effort })} data-testid="impara-teacher-effort" aria-label={t('impara.teacher.effort')}>
                    {now.opt.efforts.map(x => <option key={x} value={x}>{t(`impara.effort.${x}`)}</option>)}
                  </Select>
                )}
              </div>
              {!now.opt.web && <p className="ip-muted op-note" data-testid="impara-teacher-noweb">{t('impara.teacher.noWeb')}</p>}
            </div>
          )}
          <div className="op-row op-voices">
            <ImparaSwitch on={prefs.voice} onChange={on => setImparaPrefs({ voice: on })} label={t('impara.voiceApp')} testid="impara-start-voice" />
            <ImparaSwitch on={prefs.mic} onChange={on => setImparaPrefs({ mic: on })} label={t('impara.voiceMe')} testid="impara-start-mic" />
          </div>
        </div>
      </Popover>
    </div>
  );
}
