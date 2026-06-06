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
  return uiLanguage === 'zh-CN'
    ? `${language.nativeName} / ${language.englishName}`
    : `${language.englishName} / ${language.nativeName}`;
}
