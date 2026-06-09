import { describe, expect, it } from 'vitest';
import { canonicalLanguageCode, languageLabel, normalizeAsrLanguageCode } from './languages';

describe('normalizeAsrLanguageCode', () => {
  it('keeps auto detect for empty and auto values', () => {
    expect(normalizeAsrLanguageCode('auto')).toBe('auto');
    expect(normalizeAsrLanguageCode(' Auto ')).toBe('auto');
    expect(normalizeAsrLanguageCode('   ')).toBe('auto');
  });

  it('reduces locale-specific whisper languages to the base code', () => {
    expect(normalizeAsrLanguageCode('zh-CN')).toBe('zh');
    expect(normalizeAsrLanguageCode('zh-tw')).toBe('zh');
    expect(normalizeAsrLanguageCode('en-US')).toBe('en');
    expect(normalizeAsrLanguageCode('ja-JP')).toBe('ja');
  });

  it('maps chinese variants to one canonical app language', () => {
    expect(canonicalLanguageCode('zh-CN')).toBe('zh-CN');
    expect(canonicalLanguageCode('zh-TW')).toBe('zh-CN');
    expect(languageLabel('zh-TW', 'en-US')).toBe('Chinese');
    expect(languageLabel('zh-TW', 'zh-CN')).toBe('中文');
  });
});
