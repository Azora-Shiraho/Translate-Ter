import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASR_PROVIDER_ID,
  DEFAULT_TRANSLATION_PROVIDER_ID,
  getProviderCatalogEntry,
  providerCatalog
} from './catalog';
import { providerSecretFieldKeys } from './types';

describe('providerCatalog', () => {
  it('keeps provider ids unique', () => {
    const providerIds = providerCatalog.map((provider) => provider.id);
    expect(new Set(providerIds).size).toBe(providerIds.length);
  });

  it('gives every visible provider a label and description key', () => {
    const visibleProviders = providerCatalog.filter((provider) => provider.visibleInSettings || provider.visibleInWorkflow);

    for (const provider of visibleProviders) {
      expect(provider.labelKey).toBeTruthy();
      expect(provider.descriptionKey).toBeTruthy();
    }
  });

  it('limits secret field keys to the supported settings schema', () => {
    const supportedFieldKeys = new Set(providerSecretFieldKeys);

    for (const provider of providerCatalog) {
      for (const field of provider.secretFields) {
        expect(supportedFieldKeys.has(field.key)).toBe(true);
      }
    }
  });

  it('includes the default asr provider in the workflow-visible catalog', () => {
    expect(getProviderCatalogEntry(DEFAULT_ASR_PROVIDER_ID)).toMatchObject({
      id: DEFAULT_ASR_PROVIDER_ID,
      kind: 'asr',
      visibleInWorkflow: true
    });
  });

  it('includes the default translation provider in the workflow-visible catalog', () => {
    expect(getProviderCatalogEntry(DEFAULT_TRANSLATION_PROVIDER_ID)).toMatchObject({
      id: DEFAULT_TRANSLATION_PROVIDER_ID,
      kind: 'translation',
      visibleInWorkflow: true
    });
  });

  it('never points production defaults at mock providers', () => {
    expect(getProviderCatalogEntry(DEFAULT_ASR_PROVIDER_ID)?.runtimeKind).not.toBe('mock');
    expect(getProviderCatalogEntry(DEFAULT_TRANSLATION_PROVIDER_ID)?.runtimeKind).not.toBe('mock');
  });
});
