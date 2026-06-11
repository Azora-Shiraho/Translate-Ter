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
      message: 'Check whether the local Whisper program and model are ready.'
    })
  },
  {
    id: 'local.faster-whisper',
    kind: 'local',
    displayName: 'faster-whisper local',
    requiresConsentForUpload: false,
    health: async () => ({
      providerId: 'local.faster-whisper',
      ok: false,
      status: 'unavailable',
      message: 'Download runtime to install the local faster-whisper environment, or use an existing local environment.'
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
      message: 'Cloud recognition needs a service address and API key.'
    })
  }
];

export function validateAsrRequest(request: CreateJobRequest): void {
  const provider = asrProviders.find((item) => item.id === request.asrProviderId);
  if (!provider) {
    throw new Error('The selected recognition method is not available.');
  }
  if (provider.requiresConsentForUpload && !request.allowCloudAsrUpload) {
    throw new Error('Cloud recognition cannot start until audio upload is allowed and the service is set up.');
  }
}
