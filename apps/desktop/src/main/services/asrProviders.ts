import type { CreateJobRequest, ProviderHealth } from '@shared/models';

export type AsrProviderInfo = {
  id: string;
  kind: 'local' | 'cloud';
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
      ok: false,
      status: 'degraded',
      message: 'Runtime readiness depends on the selected whisper.cpp binary and model assets.'
    })
  },
  {
    id: 'cloud.openai',
    kind: 'cloud',
    displayName: 'Cloud ASR',
    requiresConsentForUpload: false,
    health: async () => ({
      providerId: 'cloud.openai',
      ok: false,
      status: 'unconfigured',
      message: 'Cloud ASR requires a valid service endpoint and credential configuration.'
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
