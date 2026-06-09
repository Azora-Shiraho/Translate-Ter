import { describe, expect, it } from 'vitest';
import {
  canonicalSourceLanguageCode,
  canonicalTargetLanguageCode,
  languageLabel,
  normalizeAsrLanguageCode
} from './languages';

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

  it('maps chinese variants differently for source and target language workflows', () => {
    expect(canonicalSourceLanguageCode('zh-CN')).toBe('zh');
    expect(canonicalSourceLanguageCode('zh-TW')).toBe('zh');
    expect(canonicalTargetLanguageCode('zh')).toBe('zh-CN');
    expect(canonicalTargetLanguageCode('zh-TW')).toBe('zh-TW');
    expect(languageLabel('zh', 'en-US')).toBe('Chinese');
    expect(languageLabel('zh-CN', 'zh-CN')).toBe('简体中文');
    expect(languageLabel('zh-TW', 'zh-CN')).toBe('繁體中文');
  });
});
