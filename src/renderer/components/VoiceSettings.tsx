// Settings → Voce (ADR 0152): which Whisper transcribes (Veloce / Precisa), which Italian voice answers (with «Prova»),
// and the local models: what is on disk, what is missing, the one-time download with its progress. Writes go through
// settings:set like every other row of the page. Mounted by SettingsPage.tsx.
import { useEffect, useState } from 'react';
import { VOICE_ASRS, VOICE_NAMES, type VoiceAsr, type VoiceName } from '@shared/voice';
import { setSetting, useApp } from '../store/store';
import { previewVoice, startVoice, useVoice, voice } from '../lib/voice';
import { IconPlay } from './Icons';
import { t } from '../i18n';

export function VoiceSettings() {
  const settings = useApp(s => s.settings);
  const engine = useVoice(v => v.engine);
  const [trying, setTrying] = useState(false), [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    startVoice();
    void window.sb.invoke('voice:state', undefined).then(st => voice.set(s => ({ ...s, engine: st })), () => {});
  }, [settings?.voiceAsr, settings?.voiceName]);
  if (!settings) return null;
  const asr: VoiceAsr = settings.voiceAsr ?? 'fast', name: VoiceName = settings.voiceName ?? 'paola';
  const dl = engine?.downloading, pct = dl && dl.total ? Math.round((dl.done / dl.total) * 100) : 0;
  const ready = !!engine && engine.ready.vad && engine.ready.asr && engine.ready.tts;
  const tryIt = async () => {
    setTrying(true); setProblem(null);
    setProblem(await previewVoice(name));
    setTrying(false);
  };
  return <>
    <div className="st-row" data-testid="st-voice-asr">
      <div className="st-text"><span className="st-title">{t('voice.asrTitle')}</span><p className="st-desc">{t('voice.asrHint')}</p></div>
      <div className="st-ctl"><div className="segmented" role="radiogroup" aria-label={t('voice.asrTitle')}>
        {VOICE_ASRS.map(a => <button key={a} type="button" role="radio" aria-checked={asr === a} className={asr === a ? 'on' : ''} onClick={() => void setSetting({ voiceAsr: a })} data-testid={`st-voice-asr-${a}`}>{t(`voice.asr.${a}`)}</button>)}
      </div></div>
    </div>
    <div className="st-row" data-testid="st-voice-name">
      <div className="st-text"><span className="st-title">{t('voice.nameTitle')}</span><p className="st-desc">{problem ?? t('voice.nameHint')}</p></div>
      <div className="st-ctl st-voice-ctl">
        <div className="segmented" role="radiogroup" aria-label={t('voice.nameTitle')}>
          {VOICE_NAMES.map(v => <button key={v} type="button" role="radio" aria-checked={name === v} className={name === v ? 'on' : ''} onClick={() => void setSetting({ voiceName: v })} data-testid={`st-voice-name-${v}`}>{t(`voice.name.${v}`)}</button>)}
        </div>
        <button type="button" className="btn btn-ghost btn-s" disabled={trying || !engine?.ready.tts} onClick={() => void tryIt()} data-tip={engine?.ready.tts ? undefined : t('voice.tryNeedsDownload')} data-testid="st-voice-try"><IconPlay size={12} /> {t('voice.try')}</button>
      </div>
    </div>
    <div className="st-row" data-testid="st-voice-models">
      <div className="st-text"><span className="st-title">{t('voice.modelsTitle')}</span>
        <p className="st-desc">{engine?.error ? engine.error : ready ? t('voice.modelsReady') : dl ? t('voice.downloading', { pct }) : t('voice.modelsMissing', { mb: engine?.missingMb ?? 0 })}</p>
        {dl && <span className="voice-dl wide" aria-label={`${pct}%`}><i style={{ width: `${pct}%` }} /></span>}
      </div>
      <div className="st-ctl">{!ready && <button type="button" className="btn btn-primary btn-s" disabled={!!dl} onClick={() => void window.sb.invoke('voice:prepare', undefined).then(st => voice.set(s => ({ ...s, engine: st })))} data-testid="st-voice-download">{t('voice.download')}</button>}</div>
    </div>
  </>;
}
