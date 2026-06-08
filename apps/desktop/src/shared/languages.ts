export type LanguageOption = {
  code: string;
  englishName: string;
  nativeName: string;
  supportsAsr: boolean;
  supportsTranslationTarget: boolean;
};

export const languageRegistry: LanguageOption[] = [
  {
    code: 'auto',
    englishName: 'Auto Detect',
    nativeName: '自动检测',
    supportsAsr: true,
    supportsTranslationTarget: false
  },
  {
    code: 'en',
    englishName: 'English',
    nativeName: 'English',
    supportsAsr: true,
    supportsTranslationTarget: true
  },
  {
    code: 'zh-CN',
    englishName: 'Chinese Simplified',
    nativeName: '简体中文',
    supportsAsr: true,
    supportsTranslationTarget: true
  },
  {
    code: 'zh-TW',
    englishName: 'Chinese Traditional',
    nativeName: '繁體中文',
    supportsAsr: true,
    supportsTranslationTarget: true
  },
  {
    code: 'ja',
    englishName: 'Japanese',
    nativeName: '日本語',
    supportsAsr: true,
    supportsTranslationTarget: true
  },
  {
    code: 'ko',
    englishName: 'Korean',
    nativeName: '한국어',
    supportsAsr: true,
    supportsTranslationTarget: true
  },
  {
    code: 'es',
    englishName: 'Spanish',
    nativeName: 'Español',
    supportsAsr: true,
    supportsTranslationTarget: true
  }
];

export function languageLabel(code: string, uiLanguage: 'en-US' | 'zh-CN' = 'en-US'): string {
  const language = languageRegistry.find((item) => item.code === code);
  if (!language) return code;
  return uiLanguage === 'zh-CN' ? language.nativeName : language.englishName;
}

export function normalizeAsrLanguageCode(code: string): string {
  const normalized = code.trim().toLowerCase();
  if (!normalized || normalized === 'auto') return 'auto';

  const [primary] = normalized.split('-');
  if (primary === 'zh') return 'zh';
  if (primary === 'pt') return normalized === 'pt-br' ? 'pt' : 'pt';
  return primary;
}

export function whisperPromptForLanguage(code: string): string | undefined {
  const normalized = code.trim().toLowerCase();
  if (normalized === 'zh-cn') {
    return '以下音频内容使用简体中文。请优先输出简体中文文本，避免使用繁体字。';
  }
  if (normalized === 'zh-tw') {
    return '以下音訊內容使用繁體中文。請優先輸出繁體中文文本，避免使用簡體字。';
  }
  return undefined;
}
