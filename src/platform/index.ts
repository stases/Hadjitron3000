import type { Platform } from './api';
import { browserPlatform } from './browser';
import { electronPlatform } from './electron';

export type Hadji = Omit<Platform, 'kind' | 'window'> & {
  readonly frame: 'custom' | 'native';
  window: NonNullable<Platform['window']>;
};

declare global {
  interface Window {
    hadji?: Hadji;
  }
}

export const platform: Platform = window.hadji ? electronPlatform(window.hadji) : browserPlatform;
