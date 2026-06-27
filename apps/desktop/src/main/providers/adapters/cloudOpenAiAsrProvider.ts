import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { normalizeAsrLanguageCode } from '@shared/languages';
import type { SubtitleDocument } from '@shared/models';
import { getProviderCatalogEntry } from '@shared/providers/catalog';
import type { SettingsStore } from '../../services/settingsStore';
import { testOpenAICompatibleProvider } from '../../services/providerHealth';
import type { ScopedLogger } from '../../services/logger';
import type { AsrProviderAdapter, AsrTranscribeRequest } from '../types';
import { ProviderOperationError } from '../types';

const PROVIDER_ID = 'cloud.openai';

export function createCloudOpenAiAsrProvider(options: {
  settingsStore: Pick<SettingsStore, 'getSecret'>;
  logger?: ScopedLogger;
}): AsrProviderAdapter {
  const catalogEntry = getRequiredCatalogEntry();

  return {
    id: PROVIDER_ID,
    async health() {
      return testOpenAICompatibleProvider({
        providerId: PROVIDER_ID,
        secret: options.settingsStore.getSecret(PROVIDER_ID),
        defaultBaseUrl: catalogEntry.defaultBaseUrl!,
        defaultModel: catalogEntry.defaultModel,
        logger: options.logger
      });
    },
    async transcribe(request: AsrTranscribeRequest): Promise<SubtitleDocument> {
      const secret = options.settingsStore.getSecret(PROVIDER_ID);
      if (!secret?.apiKey) {
        throw new ProviderOperationError('The cloud recognition API key has not been filled in yet.', {
          code: 'ProviderUnconfigured',
          retryable: false
        });
      }

      const uploadPath = request.audioPath ?? request.job.mediaPath;
      const fileBuffer = await readFile(uploadPath);
      const fileName = basename(uploadPath);
      const form = new FormData();
      form.append('file', new Blob([fileBuffer]), fileName);
      form.append('model', secret.model ?? catalogEntry.defaultModel ?? 'whisper-1');
      form.append('response_format', 'verbose_json');
      if (request.job.sourceLanguage !== 'auto') {
        form.append('language', normalizeAsrLanguageCode(request.job.sourceLanguage));
      }

      const response = await fetch(`${(secret.baseUrl ?? catalogEntry.defaultBaseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${secret.apiKey}`
        },
        body: form
      });

      if (!response.ok) {
        throw new ProviderOperationError(
          `The cloud recognition request failed (HTTP ${response.status}).`,
          {
            code: 'ProviderUnavailable',
            retryable: response.status >= 500 || response.status === 429
          }
        );
      }

      const payload = (await response.json()) as {
        text?: string;
        language?: string;
        segments?: Array<{ id?: number | string; start?: number; end?: number; text?: string }>;
      };
      const segments = Array.isArray(payload.segments) && payload.segments.length > 0
        ? payload.segments.map((segment, index) => ({
            id: `${request.job.id}-seg-${index + 1}`,
            index: index + 1,
            startMs: Math.round((segment.start ?? index * 3) * 1000),
            endMs: Math.round((segment.end ?? (index + 1) * 3) * 1000),
            sourceText: segment.text?.trim() || '...',
            status: 'transcribed' as const,
            confidence: 0.9
          }))
        : [
            {
              id: `${request.job.id}-seg-1`,
              index: 1,
              startMs: 0,
              endMs: 5000,
              sourceText: payload.text?.trim() || '...',
              status: 'transcribed' as const,
              confidence: 0.9
            }
          ];

      return {
        id: `doc-${request.job.id}`,
        format: 'srt',
        sourceLanguage: payload.language || request.job.sourceLanguage,
        targetLanguage: request.job.targetLanguage,
        segments,
        metadata: {
          inputMediaPath: request.job.mediaPath,
          createdAt: new Date().toISOString(),
          asrProvider: request.job.asrProviderId,
          warnings: [...request.job.warnings]
        }
      };
    }
  };
}

function getRequiredCatalogEntry() {
  const entry = getProviderCatalogEntry(PROVIDER_ID);
  if (!entry || entry.kind !== 'asr') {
    throw new Error(`Provider catalog entry is missing for ${PROVIDER_ID}.`);
  }
  return entry;
}
