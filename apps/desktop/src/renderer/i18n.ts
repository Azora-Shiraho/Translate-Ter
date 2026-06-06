import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { i18nResources } from '@shared/i18n';

export const resources = i18nResources;

void i18n.use(initReactI18next).init({
  resources,
  lng: 'en-US',
  fallbackLng: 'en-US',
  interpolation: { escapeValue: false }
});

export default i18n;
