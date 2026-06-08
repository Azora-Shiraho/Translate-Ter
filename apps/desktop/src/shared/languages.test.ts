import { describe, expect, it } from 'vitest';
import { normalizeAsrLanguageCode, whisperPromptForLanguage } from './languages';

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

  it('provides chinese script prompts for whisper recognition', () => {
    expect(whisperPromptForLanguage('zh-CN')).toContain('简体中文');
    expect(whisperPromptForLanguage('zh-TW')).toContain('繁體中文');
    expect(whisperPromptForLanguage('en-US')).toBeUndefined();
  });
});
