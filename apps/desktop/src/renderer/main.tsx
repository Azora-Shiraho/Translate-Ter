import React from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './styles.css';
import { App } from './app/App';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root not found.');
}

createRoot(rootElement).render(<App />);
