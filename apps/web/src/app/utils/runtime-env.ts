import { environment } from '../../environments/environment';

const STORAGE_KEY = 'maple-api-target';

export type ApiTarget = 'local' | 'production';

export function isLocalhost(): boolean {
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

export function getApiTarget(): ApiTarget {
  if (!isLocalhost()) return 'production';
  return (localStorage.getItem(STORAGE_KEY) as ApiTarget) || 'local';
}

export function setApiTarget(target: ApiTarget): void {
  localStorage.setItem(STORAGE_KEY, target);
}

const PROD_API = 'https://paperbark.justmaple.app';
const PROD_WS = 'wss://paperbark.justmaple.app';

export function getApiUrl(): string {
  if (isLocalhost() && getApiTarget() === 'production') {
    return PROD_API;
  }
  return environment.apiUrl || '';
}

export function getWsUrl(): string {
  if (isLocalhost() && getApiTarget() === 'production') {
    return PROD_WS;
  }
  return environment.wsUrl || '';
}
