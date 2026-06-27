import { getProviderCatalogEntry } from '@shared/providers/catalog';
import type { SettingsStore } from '../services/settingsStore';
import type { WhisperAssetManager } from '../services/whisperAssets';
import type { NativeBackendClient } from '../services/nativeBackendClient';
import type { FasterWhisperService } from '../services/fasterWhisperService';
import type { ScopedLogger } from '../services/logger';
import { createCloudOpenAiAsrProvider } from './adapters/cloudOpenAiAsrProvider';
import { createFasterWhisperAsrProvider } from './adapters/fasterWhisperAsrProvider';
import { createLocalWhisperCppAsrProvider } from './adapters/localWhisperCppAsrProvider';
import type { AsrProviderAdapter, AsrProviderRegistry } from './types';

export function createAsrProviderRegistry(adapters: AsrProviderAdapter[]): AsrProviderRegistry {
  const providers = new Map<string, AsrProviderAdapter>();

  for (const adapter of adapters) {
    assertCatalogProviderKind(adapter.id, 'asr');
    if (providers.has(adapter.id)) {
      throw new Error(`Duplicate ASR provider adapter registration: ${adapter.id}.`);
    }
    providers.set(adapter.id, adapter);
  }

  return {
    get(id) {
      return providers.get(id);
    },
    resolve(id) {
      const adapter = providers.get(id);
      if (!adapter) {
        throw new Error('The selected recognition method is not available.');
      }
      return adapter;
    },
    has(id) {
      return providers.has(id);
    },
    async health(id) {
      return providers.get(id)?.health();
    },
    list() {
      return [...providers.values()];
    }
  };
}

export function createMainAsrProviderRegistry(options: {
  settingsStore: Pick<SettingsStore, 'get' | 'getSecret'>;
  whisperAssets: Pick<WhisperAssetManager, 'ensureRuntime'>;
  nativeBackend: Pick<NativeBackendClient, 'transcribe'>;
  fasterWhisper: Pick<FasterWhisperService, 'health' | 'transcribe'>;
  logger?: ScopedLogger;
}): AsrProviderRegistry {
  return createAsrProviderRegistry([
    createLocalWhisperCppAsrProvider({
      settingsStore: options.settingsStore,
      whisperAssets: options.whisperAssets,
      nativeBackend: options.nativeBackend
    }),
    createFasterWhisperAsrProvider({
      settingsStore: options.settingsStore,
      fasterWhisper: options.fasterWhisper
    }),
    createCloudOpenAiAsrProvider({
      settingsStore: options.settingsStore,
      logger: options.logger
    })
  ]);
}

function assertCatalogProviderKind(providerId: string, kind: 'asr' | 'translation'): void {
  const entry = getProviderCatalogEntry(providerId);
  if (!entry || entry.kind !== kind) {
    throw new Error(`Provider ${providerId} is not a known ${kind} provider in the shared catalog.`);
  }
}
