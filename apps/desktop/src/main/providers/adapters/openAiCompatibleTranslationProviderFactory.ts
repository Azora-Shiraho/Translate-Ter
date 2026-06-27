import { MockTranslationProvider, OpenAICompatibleTranslationProvider } from '@shared/translation/providers';
import { getProviderCatalogEntry } from '@shared/providers/catalog';
import type { SettingsStore } from '../../services/settingsStore';
import { createBasicProviderHealth, testOpenAICompatibleProvider } from '../../services/providerHealth';
import type { ScopedLogger } from '../../services/logger';
import type { TranslationProviderFactory } from '../types';

const PROVIDER_ID = 'openai.compatible';

export function createOpenAiCompatibleTranslationProviderFactory(options: {
  settingsStore: Pick<SettingsStore, 'getSecret'>;
  logger?: ScopedLogger;
}): TranslationProviderFactory {
  const catalogEntry = getRequiredCatalogEntry();

  return {
    id: PROVIDER_ID,
    create() {
      const secret = options.settingsStore.getSecret(PROVIDER_ID);
      return new OpenAICompatibleTranslationProvider({
        id: PROVIDER_ID,
        baseUrl: secret?.baseUrl ?? catalogEntry.defaultBaseUrl ?? 'https://api.openai.com/v1',
        apiKey: secret?.apiKey,
        model: secret?.model ?? catalogEntry.defaultModel ?? 'gpt-4o-mini',
        priority: 10
      });
    },
    async health() {
      return testOpenAICompatibleProvider({
        providerId: PROVIDER_ID,
        secret: options.settingsStore.getSecret(PROVIDER_ID),
        defaultBaseUrl: catalogEntry.defaultBaseUrl!,
        defaultModel: catalogEntry.defaultModel,
        logger: options.logger
      });
    }
  };
}

export function createMockTranslationProviderFactory(): TranslationProviderFactory {
  return {
    id: 'mock.local',
    create() {
      return new MockTranslationProvider();
    },
    async health() {
      return createBasicProviderHealth('mock.local', {
        ok: true,
        message: 'Mock translation provider is ready.'
      });
    }
  };
}

function getRequiredCatalogEntry() {
  const entry = getProviderCatalogEntry(PROVIDER_ID);
  if (!entry || entry.kind !== 'translation') {
    throw new Error(`Provider catalog entry is missing for ${PROVIDER_ID}.`);
  }
  return entry;
}
