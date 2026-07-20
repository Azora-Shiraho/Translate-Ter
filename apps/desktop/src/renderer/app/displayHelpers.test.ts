import { describe, expect, it } from 'vitest';
import { i18nResources } from '@shared/i18n';
import { resolveTechnicalMessage, resolveUserMessage } from './displayHelpers';

function createTranslator(language: 'en-US' | 'zh-CN') {
  const translations = i18nResources[language].translation as Record<string, unknown>;
  return (key: string, params?: Record<string, unknown>): string => {
    const value = key.split('.').reduce<unknown>((current, part) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[part];
    }, translations);
    if (typeof value !== 'string') return key;
    return value.replace(/{{(\w+)}}/g, (_, name: string) => String(params?.[name] ?? `{{${name}}}`));
  };
}

describe('runtime message localization', () => {
  it('resolves structured messages with interpolation', () => {
    expect(
      resolveUserMessage(
        {
          message: 'raw',
          userMessage: {
            messageKey: 'runtimeMessage.providerModelMissing',
            messageParams: { model: 'demo-model' }
          }
        },
        createTranslator('zh-CN')
      )
    ).toBe('连接成功，但服务中没有模型“demo-model”。');
  });

  it('keeps dynamic translation progress when a localized descriptor provides its counts', () => {
    expect(
      resolveUserMessage(
        {
          message: 'Translating 2/5 batches.',
          userMessage: {
            messageKey: 'runtimeMessage.jobTranslationProgress',
            messageParams: { completed: '2', total: '5' }
          }
        },
        createTranslator('zh-CN')
      )
    ).toBe('正在翻译第 2/5 批。');
  });

  it('does not expose unknown translation keys', () => {
    expect(
      resolveUserMessage(
        { message: 'Original diagnostic', userMessage: { messageKey: 'runtimeMessage.unknown' } },
        createTranslator('en-US')
      )
    ).toBe('Original diagnostic');
  });

  it('maps known legacy messages and preserves unknown messages', () => {
    const t = createTranslator('zh-CN');
    expect(resolveUserMessage('Batch item started.', t)).toBe('批量任务项已开始。');
    expect(resolveUserMessage('Third-party failure', t)).toBe('Third-party failure');
    expect(resolveUserMessage('Clipboard write failed.', t, 'error')).toBe('Clipboard write failed.');
  });

  it('keeps technical diagnostics separate from user-facing text', () => {
    const input = {
      message: 'legacy',
      userMessage: {
        messageKey: 'runtimeMessage.providerCheckFailed',
        technicalMessage: 'connect ECONNREFUSED 127.0.0.1:1234'
      }
    };
    expect(resolveUserMessage(input, createTranslator('zh-CN'))).toBe('服务检查失败。');
    expect(resolveTechnicalMessage(input)).toBe('connect ECONNREFUSED 127.0.0.1:1234');
  });

  it('keeps the English and Chinese dictionaries structurally aligned', () => {
    const collectKeys = (value: unknown, prefix = ''): string[] => {
      if (!value || typeof value !== 'object') return [prefix];
      return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        collectKeys(child, prefix ? `${prefix}.${key}` : key)
      );
    };
    expect(collectKeys(i18nResources['en-US'].translation).sort()).toEqual(
      collectKeys(i18nResources['zh-CN'].translation).sort()
    );
  });
});
