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
    code: 'zh',
    englishName: 'Chinese',
    nativeName: '中文',
    supportsAsr: true,
    supportsTranslationTarget: false
  },
  {
    code: 'zh-CN',
    englishName: 'Chinese Simplified',
    nativeName: '简体中文',
    supportsAsr: false,
    supportsTranslationTarget: true
  },
  {
    code: 'zh-TW',
    englishName: 'Chinese Traditional',
    nativeName: '繁體中文',
    supportsAsr: false,
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

export function canonicalSourceLanguageCode(code: string): string {
  const normalized = code.trim().toLowerCase();
  if (normalized === 'zh-tw' || normalized === 'zh-cn' || normalized === 'zh') return 'zh';
  if (normalized === 'en-us') return 'en';
  return code;
}

export function canonicalTargetLanguageCode(code: string): string {
  const normalized = code.trim().toLowerCase();
  if (normalized === 'zh') return 'zh-CN';
  if (normalized === 'zh-cn') return 'zh-CN';
  if (normalized === 'zh-tw') return 'zh-TW';
  if (normalized === 'en-us') return 'en';
  return code;
}

export function languageLabel(code: string, uiLanguage: 'en-US' | 'zh-CN' = 'en-US'): string {
  const canonicalCode =
    code.trim().toLowerCase() === 'zh' ? canonicalSourceLanguageCode(code) : canonicalTargetLanguageCode(code);
  const language = languageRegistry.find((item) => item.code === canonicalCode);
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
