// «Chi spiega» on Impara's start (ADR 0188; owner, 2026-10-29: «il modello che spiega può essere scelto dall'utente»):
// the engine, its model and its effort for the research, the check and the lesson, picked from the engines that are on
// (main's ImparaState.teachers). No choice = the app's: Claude's strongest model at high effort. The web research is
// always Claude's (the only engine whose run can have the web and no file): picking another engine says so. Remembered
// in Impara's prefs. Used by ImparaStart.tsx.
import { useRef, useState } from 'react';
import type { LessonTeacher, TeacherOption } from '@shared/lesson';
import { HarnessMark } from '../Icons';
import { MenuItem, MenuLabel, MenuSep, Popover } from '../ui';
import { t } from '../../i18n';
import type { Effort, Harness } from '@shared/contract';

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

export function TeacherChip({ options, value, onChange }: { options: readonly TeacherOption[]; value: LessonTeacher | null; onChange: (v: LessonTeacher | null) => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const now = teacherNow(value, options);
  if (!now.opt) return null;
  const nameOf = (o: TeacherOption, id: string | null) => o.models.find(m => m.id === id)?.name ?? id ?? '';
  const set = (patch: Partial<LessonTeacher>) => {
    const base: LessonTeacher = { engine: now.opt!.engine, model: now.model, effort: now.effort };
    onChange({ ...base, ...patch });
  };
  const pickEngine = (o: TeacherOption) => onChange({ engine: o.engine, model: o.models[0]?.id ?? null, effort: o.efforts.length ? 'high' : null });
  const label = [now.opt.label, nameOf(now.opt, now.model), now.effort ? t(`impara.effort.${now.effort}`) : ''].filter(Boolean).join(' · ');
  return (
    <span className="ip-teacher">
      <span className="ip-muted">{t('impara.teacher.label')}</span>
      <button ref={anchor} type="button" className="ip-teacher-chip" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} data-testid="impara-teacher" data-tip={t('impara.teacher.tip')}>
        <HarnessMark harness={now.opt.engine as Harness} size={13} /><span>{label}</span><span className="ip-caret" aria-hidden="true">▾</span>
      </button>
      {!now.opt.web && <span className="ip-muted ip-teacher-web" data-testid="impara-teacher-noweb">{t('impara.teacher.noWeb')}</span>}
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} testid="impara-teacher-pop" width={280} align="start">
        <MenuLabel>{t('impara.teacher.engine')}</MenuLabel>
        <MenuItem checked={now.auto} onSelect={() => onChange(null)} testid="impara-teacher-auto">{t('impara.teacher.auto')}</MenuItem>
        {options.map(o => <MenuItem key={o.engine} checked={!now.auto && o.engine === now.opt!.engine} onSelect={() => pickEngine(o)} testid={`impara-teacher-${o.engine}`}>{o.label}</MenuItem>)}
        {now.opt.models.length > 0 && <>
          <MenuSep /><MenuLabel>{t('impara.teacher.model')}</MenuLabel>
          {now.opt.models.map(m => <MenuItem key={m.id} checked={m.id === now.model} onSelect={() => set({ model: m.id })} testid={`impara-teacher-model-${m.id}`}>{m.name}</MenuItem>)}
        </>}
        {now.opt.efforts.length > 0 && <>
          <MenuSep /><MenuLabel>{t('impara.teacher.effort')}</MenuLabel>
          {now.opt.efforts.map(e => <MenuItem key={e} checked={e === now.effort} onSelect={() => set({ effort: e })} testid={`impara-teacher-effort-${e}`}>{t(`impara.effort.${e}`)}</MenuItem>)}
        </>}
      </Popover>
    </span>
  );
}
