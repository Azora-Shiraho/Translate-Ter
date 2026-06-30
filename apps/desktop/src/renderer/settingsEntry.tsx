import React from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './styles.css';
import './modern.css';

import { SettingsApp } from './app/SettingsApp';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root not found.');
}

createRoot(rootElement).render(<SettingsApp />);
