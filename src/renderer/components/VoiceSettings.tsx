// Settings → Voce (ADR 0152): the spoken conversation with the Orchestrator, on or off (the mic button in the inputs
// only dictates, owner 2026-10-24), push-to-talk for it (owner 2026-10-29), which model transcribes (Parakeet, Whisper veloce / preciso: ADR 0214), which Italian voice answers (with «Prova»), how fast it speaks,
// which microphone listens (lib/mic.ts: the list follows what is plugged in), and the local models: what is on disk, what is missing, the one-time download with its progress. Writes go through
// settings:set like every other row of the page. Mounted by SettingsPage.tsx.
import { useEffect, useState } from 'react';
import { VOICE_ASRS, VOICE_NAMES, VOICE_SPEEDS, type VoiceAsr, type VoiceName, type VoiceSpeed } from '@shared/voice';
import { setSetting, useApp } from '../store/store';
import { previewVoice, setTalk, startVoice, useVoice, voice } from '../lib/voice';
import { Switch } from './SettingsPage';
import { chooseMic, micName, pick, refreshMics, useMics } from '../lib/mic';
import { IconPlay } from './Icons';
import { Select } from './Select';
import { t } from '../i18n';

export function VoiceSettings() {
  const settings = useApp(s => s.settings);
  const engine = useVoice(v => v.engine);
  const [trying, setTrying] = useState(false), [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    startVoice();
    void window.sb.invoke('voice:state', undefined).then(st => voice.set(s => ({ ...s, engine: st })), () => {});
  }, [settings?.voiceAsr, settings?.voiceName]);
  const mic = useMics(m => m);
  const talking = useVoice(v => v.mode === 'talk' && v.phase !== 'off');
  useEffect(() => { refreshMics(); }, []);
  if (!settings) return null;
  const asr: VoiceAsr = settings.voiceAsr ?? 'fast', name: VoiceName = settings.voiceName ?? 'paola', speed: VoiceSpeed = settings.voiceSpeed ?? 'normal';
  const dl = engine?.downloading, pct = dl && dl.total ? Math.round((dl.done / dl.total) * 100) : 0;
  const ready = !!engine && engine.ready.vad && engine.ready.asr && engine.ready.tts;
  const tryIt = async () => {
    setTrying(true); setProblem(null);
    setProblem(await previewVoice(name));
    setTrying(false);
  };
  const diagnostic = engine?.diagnostics;
  return <>
    <div className="st-row" data-testid="st-voice-talk">
      <div className="st-text"><span className="st-title">{t('voice.talkTitle')}</span><p className="st-desc">{t('voice.talkHint')}</p></div>
      <div className="st-ctl"><Switch on={talking} onChange={on => void setTalk(on)} label={t('voice.talkTitle')} testid="st-voice-talk-on" /></div>
    </div>
    <div className="st-row" data-testid="st-voice-ptt">
      <div className="st-text"><span className="st-title">{t('voice.pttTitle')}</span><p className="st-desc">{t('voice.pttHint')}</p></div>
      <div className="st-ctl"><Switch on={settings.voicePtt === true} onChange={on => void setSetting({ voicePtt: on })} label={t('voice.pttTitle')} testid="st-voice-ptt-on" /></div>
    </div>
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
    <div className="st-row" data-testid="st-voice-speed">
      <div className="st-text"><span className="st-title">{t('voice.speedTitle')}</span><p className="st-desc">{t('voice.speedHint')}</p></div>
      <div className="st-ctl"><div className="segmented" role="radiogroup" aria-label={t('voice.speedTitle')}>
        {VOICE_SPEEDS.map(v => <button key={v} type="button" role="radio" aria-checked={speed === v} className={speed === v ? 'on' : ''} onClick={() => void setSetting({ voiceSpeed: v })} data-testid={`st-voice-speed-${v}`}>{t(`voice.speed.${v}`)}</button>)}
      </div></div>
    </div>
    <div className="st-row" data-testid="st-voice-mic">
      <div className="st-text"><span className="st-title">{t('mic.title')}</span>
        <p className="st-desc" data-testid="st-voice-mic-desc">{!mic.devices.length ? t('mic.none') : mic.chosen && !mic.using ? t('mic.away', { name: micName(mic.chosen) }) : t('mic.hint')}</p></div>
      <div className="st-ctl">
        <Select value={pick(mic.chosen, mic.devices)?.id ?? ''} aria-label={t('mic.title')} data-testid="st-voice-mic-pick"
          onChange={e => { const d = mic.devices.find(x => x.id === e.target.value); chooseMic(d ?? null); }}>
          <option value="">{t('mic.default')}</option>
          {mic.devices.map((d, i) => <option key={d.id} value={d.id}>{micName(d, i)}</option>)}
        </Select>
      </div>
    </div>
    <div className="st-row" data-testid="st-voice-models">
      <div className="st-text"><span className="st-title">{t('voice.modelsTitle')}</span>
        <p className="st-desc">{engine?.error ? engine.error : ready ? t('voice.modelsReady') : dl ? t('voice.downloading', { pct }) : t('voice.modelsMissing', { mb: engine?.missingMb ?? 0 })}</p>
        {dl && <span className="voice-dl wide" aria-label={`${pct}%`}><i style={{ width: `${pct}%` }} /></span>}
      </div>
      <div className="st-ctl">{!ready && <button type="button" className="btn btn-primary btn-s" disabled={!!dl} onClick={() => void window.sb.invoke('voice:prepare', undefined).then(st => voice.set(s => ({ ...s, engine: st })))} data-testid="st-voice-download">{t('voice.download')}</button>}</div>
    </div>
    <details className="st-row-block" data-testid="voice-diagnostics"><summary>{t('rt.voice.diagnostics')}</summary>
      <button type="button" className="btn btn-ghost btn-s" onClick={() => void window.sb.invoke('voice:state', undefined).then(st => voice.set(s => ({ ...s, engine: st })))}>{t('rt.voice.refresh')}</button>
      <p className="st-desc">{t('rt.voice.hint')}</p>
      {diagnostic && <><p>{t('rt.voice.recognition')}: {diagnostic.recognitionAfterEndpoint.meanMs === null ? '—' : `${Math.round(diagnostic.recognitionAfterEndpoint.meanMs)} ms`} · n={diagnostic.recognitionAfterEndpoint.count}</p>
        <p>{t('rt.voice.synthesis')}: {diagnostic.synthesisRequestToAudio.meanMs === null ? '—' : `${Math.round(diagnostic.synthesisRequestToAudio.meanMs)} ms`} · n={diagnostic.synthesisRequestToAudio.count}</p>
        <details><summary>{t('rt.voice.exact')}</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(diagnostic, null, 2)}</pre></details></>}
    </details>
  </>;
}
