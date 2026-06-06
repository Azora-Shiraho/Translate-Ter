import type { CreateJobRequest, ProviderHealth } from '@shared/models';

export type AsrProviderInfo = {
  id: string;
  kind: 'local' | 'cloud' | 'mock';
  displayName: string;
  requiresConsentForUpload: boolean;
  health(): Promise<ProviderHealth>;
};

export const asrProviders: AsrProviderInfo[] = [
  {
    id: 'local.whisper.cpp',
    kind: 'local',
    displayName: 'whisper.cpp local',
    requiresConsentForUpload: false,
    health: async () => ({
      providerId: 'local.whisper.cpp',
      ok: true,
      status: 'degraded',
      message: 'Runtime is checked per selected model.'
    })
  },
  {
    id: 'cloud.openai',
    kind: 'cloud',
    displayName: 'Cloud ASR',
    requiresConsentForUpload: true,
    health: async () => ({
      providerId: 'cloud.openai',
      ok: false,
      status: 'unconfigured',
      message: 'Cloud ASR is an explicit opt-in adapter placeholder.'
    })
  },
  {
    id: 'mock.asr',
    kind: 'mock',
    displayName: 'Mock ASR',
    requiresConsentForUpload: false,
    health: async () => ({
      providerId: 'mock.asr',
      ok: true,
      status: 'healthy'
    })
  }
];

export function validateAsrRequest(request: CreateJobRequest): void {
  const provider = asrProviders.find((item) => item.id === request.asrProviderId);
  if (!provider) {
    throw new Error(`Unknown ASR provider: ${request.asrProviderId}`);
  }
  if (provider.requiresConsentForUpload && !request.allowCloudAsrUpload) {
    throw new Error('Cloud ASR upload requires explicit user consent and provider configuration.');
  }
}
