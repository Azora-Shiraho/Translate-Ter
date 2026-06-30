export type AppView = 'workspace' | 'batch';

export type RunningAction = 'transcribe' | 'translate' | 'export';

export type ToastTone = 'neutral' | 'warning' | 'error' | 'success';

export type ToastMessage = {
  id: string;
  message: string;
  tone: ToastTone;
  exiting: boolean;
};

export type ActiveDownload = {
  scope: 'runtime' | 'model' | 'ffmpeg';
  receivedBytes: number;
  totalBytes?: number;
  message: string;
};

export type HealthTone = 'good' | 'accent' | 'warn' | 'error' | 'muted';

export type DerivedHealthState = {
  tone: HealthTone;
  label: string;
  detail: string;
};

export type SettingsJumpTarget = 'asr-provider' | 'ffmpeg' | 'cuda' | 'whisper-model' | 'translation-provider';

export type RuntimeStatusRow = {
  label: string;
  value: string;
  tone?: 'good' | 'warn' | 'error' | 'accent' | 'muted';
};

export type WriteUiLog = (
  level: 'debug' | 'info' | 'warning' | 'error',
  event: string,
  details?: unknown,
  scope?: string,
  message?: string
) => void;

export type ReportUiError = (
  event: string,
  error: unknown,
  details?: Record<string, unknown>,
  scope?: string
) => string;

export type UiFeedback = {
  writeUiLog: WriteUiLog;
  reportUiError: ReportUiError;
  setMessage: (message: string) => void;
  pushStatus: (message: string, tone?: ToastTone) => void;
  pushToast: (message: string, tone?: ToastTone) => void;
};
