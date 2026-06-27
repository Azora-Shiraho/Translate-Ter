import type { TranslationProvider } from '@shared/translation/types';
import { getProviderCatalogEntry } from '@shared/providers/catalog';
import type { SettingsStore } from '../services/settingsStore';
import { createBasicProviderHealth } from '../services/providerHealth';
import type { ScopedLogger } from '../services/logger';
import {
  createMockTranslationProviderFactory,
  createOpenAiCompatibleTranslationProviderFactory
} from './adapters/openAiCompatibleTranslationProviderFactory';
import type { TranslationProviderFactory, TranslationProviderRegistry } from './types';

export function createTranslationProviderRegistry(
  factories: TranslationProviderFactory[]
): TranslationProviderRegistry {
  const providers = new Map<string, TranslationProviderFactory>();

  for (const factory of factories) {
    assertCatalogProviderKind(factory.id, 'translation');
    if (providers.has(factory.id)) {
      throw new Error(`Duplicate translation provider factory registration: ${factory.id}.`);
    }
    providers.set(factory.id, factory);
  }

  return {
    get(id) {
      return providers.get(id);
    },
    has(id) {
      return providers.has(id);
    },
    createProviders() {
      return [...providers.values()].map((factory) => factory.create());
    },
    async health(id) {
      const factory = providers.get(id);
      if (!factory) {
        return undefined;
      }
      if (factory.health) {
        return factory.health();
      }
      const result = await factory.create().health();
      return createBasicProviderHealth(id, result, 'unavailable');
    },
    list() {
      return [...providers.values()];
    }
  };
}

export function createMainTranslationProviderRegistry(options: {
  settingsStore: Pick<SettingsStore, 'getSecret'>;
  logger?: ScopedLogger;
}): TranslationProviderRegistry {
  return createTranslationProviderRegistry([
    createMockTranslationProviderFactory(),
    createOpenAiCompatibleTranslationProviderFactory({
      settingsStore: options.settingsStore,
      logger: options.logger
    })
  ]);
}

export function createTranslationProviders(
  registry: TranslationProviderRegistry
): TranslationProvider[] {
  return registry.createProviders();
}

function assertCatalogProviderKind(providerId: string, kind: 'asr' | 'translation'): void {
  const entry = getProviderCatalogEntry(providerId);
  if (!entry || entry.kind !== kind) {
    throw new Error(`Provider ${providerId} is not a known ${kind} provider in the shared catalog.`);
  }
}
