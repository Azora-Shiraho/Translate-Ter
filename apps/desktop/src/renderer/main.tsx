import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { Download, FileVideo, Languages, Play, RotateCcw, Save, Settings } from 'lucide-react';
import './i18n';
import './styles.css';
import type { AppSettingsPublic, JobSnapshot, SubtitleSegment, WhisperModelInfo } from '@shared/types';
import { formatTimestamp } from '@shared/srt';
import { languageRegistry } from '@shared/languages';

const steps = ['import', 'asr', 'subtitles', 'translate', 'export'] as const;

function App(): JSX.Element {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<AppSettingsPublic>();
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [job, setJob] = useState<JobSnapshot>();
  const [mediaPath, setMediaPath] = useState('');
  const [exportPath, setExportPath] = useState('');
  const [exportVariant, setExportVariant] = useState<'source' | 'translated' | 'bilingual'>('translated');
  const [message, setMessage] = useState(t('ready'));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void bootstrap();
    const unsubscribe = window.translateTer.jobs.onEvent((event) => {
      if (event.type === 'snapshot') setJob(event.job);
      if (event.type === 'progress') setMessage(event.message ?? event.stage);
      if (event.type === 'error') setMessage(event.message);
    });
    return unsubscribe;
  }, []);

  async function bootstrap(): Promise<void> {
    const [nextSettings, nextModels] = await Promise.all([
      window.translateTer.getSettings(),
      window.translateTer.assets.listWhisperModels()
    ]);
    setSettings(nextSettings);
    setModels(nextModels);
    void i18n.changeLanguage(nextSettings.uiLanguage);
  }

  async function updateSettings(patch: Partial<AppSettingsPublic>): Promise<void> {
    const next = await window.translateTer.saveSettings(patch);
    setSettings(next);
    if (patch.uiLanguage) void i18n.changeLanguage(patch.uiLanguage);
  }

  async function pickMedia(): Promise<void> {
    const selected = await window.translateTer.selectVideo();
    if (selected) setMediaPath(selected);
  }

  async function createAndStart(): Promise<void> {
    if (!settings || !mediaPath.trim()) return;
    setBusy(true);
    try {
      const nextJob = await window.translateTer.startTranscription({
        mediaPath: mediaPath.trim(),
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        asrProviderId: settings.asrProviderId,
        whisperModelId: settings.whisperModelId,
        translationProviderPriority: settings.translationProviderPriority
      });
      setJob(nextJob);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function translateJob(): Promise<void> {
    if (!job) return;
    setBusy(true);
    try {
      setJob(await window.translateTer.startTranslation(job.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function exportSrt(): Promise<void> {
    if (!job?.subtitleDocument || !exportPath.trim()) return;
    setBusy(true);
    try {
      await window.translateTer.exportSrt(job.subtitleDocument, exportPath.trim(), exportVariant, 'source-first');
      setMessage(t('exported'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function updateSegment(segment: SubtitleSegment, patch: Partial<SubtitleSegment>): Promise<void> {
    if (!job) return;
    const next = await window.translateTer.subtitles.updateSegment(job.id, { ...segment, ...patch });
    setJob(next);
  }

  const currentStepIndex = useMemo(() => {
    const step = job?.step ?? 'import';
    return steps.indexOf(step);
  }, [job]);

  if (!settings) return <div className="boot">Translate-Ter</div>;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <FileVideo size={18} />
          <div>
            <strong>{t('appName')}</strong>
            <span>{job?.fileName ?? t('mockNotice')}</span>
          </div>
        </div>
        <nav className="stepper">
          {steps.map((step, index) => (
            <span className={index <= currentStepIndex ? 'step active' : 'step'} key={step}>
              {t(step)}
            </span>
          ))}
        </nav>
        <select
          aria-label={t('uiLanguage')}
          value={settings.uiLanguage}
          onChange={(event) => void updateSettings({ uiLanguage: event.target.value as 'en-US' | 'zh-CN' })}
        >
          <option value="en-US">English</option>
          <option value="zh-CN">中文</option>
        </select>
      </header>

      <main className="workspace">
        <section className="mainPane">
          <div className="media">
            <div className="mediaScreen">
              <FileVideo size={46} />
              <span>{job?.fileName ?? t('chooseMedia')}</span>
            </div>
            <div className="transport">
              <button className="iconButton" title="play" disabled>
                <Play size={16} />
              </button>
              <span>00:00 / 00:10</span>
              <div className="track">
                <span style={{ width: `${job?.progress ?? 0}%` }} />
              </div>
            </div>
          </div>

          <section className="subtitlePanel">
            <div className="panelHeader">
              <h2>{t('subtitles')}</h2>
              <span>{job?.subtitleDocument?.segments.length ?? 0} rows</span>
            </div>
            {job?.subtitleDocument ? (
              <div className="subtitleTable">
                <div className="row head">
                  <span>{t('start')}</span>
                  <span>{t('end')}</span>
                  <span>{t('original')}</span>
                  <span>{t('translated')}</span>
                  <span>{t('status')}</span>
                </div>
                {job.subtitleDocument.segments.map((segment) => (
                  <div className="row" key={segment.id}>
                    <span>{formatTimestamp(segment.startMs)}</span>
                    <span>{formatTimestamp(segment.endMs)}</span>
                    <textarea
                      value={segment.sourceText}
                      onChange={(event) => void updateSegment(segment, { sourceText: event.target.value })}
                    />
                    <textarea
                      value={segment.translatedText ?? ''}
                      placeholder={t('translated')}
                      onChange={(event) => void updateSegment(segment, { translatedText: event.target.value })}
                    />
                    <span className={`status ${segment.status}`}>{segment.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">{t('noSubtitles')}</div>
            )}
          </section>
        </section>

        <aside className="inspector">
          <InspectorSection icon={<Download size={16} />} title={t('import')}>
            <label>
              {t('mediaPath')}
              <input value={mediaPath} placeholder={t('placeholderPath')} onChange={(event) => setMediaPath(event.target.value)} />
            </label>
            <button className="secondary" onClick={() => void pickMedia()}>
              {t('chooseMedia')}
            </button>
          </InspectorSection>

          <InspectorSection icon={<Settings size={16} />} title={t('asr')}>
            <SelectField label={t('sourceLanguage')} value={settings.sourceLanguage} onChange={(value) => void updateSettings({ sourceLanguage: value })} />
            <label>
              {t('asrProvider')}
              <select value={settings.asrProviderId} onChange={(event) => void updateSettings({ asrProviderId: event.target.value })}>
                <option value="local.whisper.cpp">{t('localProvider')} · local.whisper.cpp</option>
                <option value="cloud.openai">{t('cloudProvider')} · cloud.openai</option>
                <option value="mock.asr">{t('mockProvider')} · mock.asr</option>
              </select>
            </label>
            <label>
              {t('whisperModel')}
              <select value={settings.whisperModelId} onChange={(event) => void updateSettings({ whisperModelId: event.target.value })}>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName}
                  </option>
                ))}
              </select>
            </label>
            <div className="modelStatus">
              {models.map((model) => (
                <span className={model.installed ? 'badge installed' : 'badge'} key={model.id}>
                  {model.displayName}: {model.installed ? t('installed') : t('missing')}
                </span>
              ))}
            </div>
            <button className="primary" disabled={busy || !mediaPath.trim()} onClick={() => void createAndStart()}>
              <Play size={16} />
              {t('startTranscription')}
            </button>
          </InspectorSection>

          <InspectorSection icon={<Languages size={16} />} title={t('translate')}>
            <SelectField
              label={t('targetLanguage')}
              value={settings.targetLanguage}
              targetOnly
              onChange={(value) => void updateSettings({ targetLanguage: value })}
            />
            <label>
              {t('translationProvider')}
              <select
                value={settings.translationProviderPriority[0] ?? 'mock.local'}
                onChange={(event) => void updateSettings({ translationProviderPriority: [event.target.value, 'mock.local'] })}
              >
                <option value="mock.local">mock.local</option>
                <option value="openai.compatible">openai.compatible</option>
              </select>
            </label>
            <button className="primary" disabled={busy || !job?.subtitleDocument} onClick={() => void translateJob()}>
              <Languages size={16} />
              {t('translateSubtitles')}
            </button>
          </InspectorSection>

          <InspectorSection icon={<Save size={16} />} title={t('export')}>
            <div className="segmented">
              {[
                ['translated', t('translatedOnly')],
                ['source', t('sourceOnly')],
                ['bilingual', t('bilingual')]
              ].map(([value, label]) => (
                <button className={exportVariant === value ? 'selected' : ''} key={value} onClick={() => setExportVariant(value as typeof exportVariant)}>
                  {label}
                </button>
              ))}
            </div>
            <input value={exportPath} placeholder={t('exportPath')} onChange={(event) => setExportPath(event.target.value)} />
            <button className="primary" disabled={busy || !job?.subtitleDocument || !exportPath.trim()} onClick={() => void exportSrt()}>
              <Save size={16} />
              {t('exportSrt')}
            </button>
          </InspectorSection>
        </aside>
      </main>

      <footer className="statusStrip">
        <span>{t('progress')}: {job?.progress ?? 0}%</span>
        <span>{message}</span>
        {job?.error && (
          <button className="textButton" onClick={() => void createAndStart()}>
            <RotateCcw size={14} />
            {t('retry')}
          </button>
        )}
      </footer>
    </div>
  );
}

function InspectorSection(props: { icon: React.ReactNode; title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="inspectorSection">
      <h3>
        {props.icon}
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

function SelectField(props: { label: string; value: string; targetOnly?: boolean; onChange: (value: string) => void }): JSX.Element {
  const options = languageRegistry.filter((language) => (props.targetOnly ? language.supportsTranslationTarget : language.supportsAsr));
  return (
    <label>
      {props.label}
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {options.map((language) => (
          <option key={language.code} value={language.code}>
            {language.englishName} / {language.nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
