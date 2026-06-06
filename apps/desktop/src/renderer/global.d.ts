import type { TranslateTerApi } from '../preload';

declare global {
  interface Window {
    translateTer: TranslateTerApi;
  }
}
