import { afterEach, describe, expect, it } from 'vitest';
import { fallBackToPublic, routeApiRequest, type NativeServerEndpoint } from './server-endpoint';
const browser = window as Window & { __mapleServerIdentity?: NativeServerEndpoint };
afterEach(() => {
  delete browser.__mapleServerIdentity;
});
describe('native server routing', () => {
  it('routes only this server API, and never routes an arbitrary third-party request', () => {
    browser.__mapleServerIdentity = {
      serverUrl: 'https://phoebe.justmaple.app',
      publicApiUrl: 'https://phoebe.justmaple.app',
      apiUrl: 'https://local.phoebe.justmaple.app',
      localUrl: 'https://local.phoebe.justmaple.app',
    };
    expect(routeApiRequest('/api/notebooks', '').url).toBe(
      'https://local.phoebe.justmaple.app/api/notebooks',
    );
    expect(routeApiRequest('https://phoebe.justmaple.app/api/notebooks', '').isApi).toBe(true);
    expect(routeApiRequest('https://elsewhere.example/api/notebooks', '').isApi).toBe(false);
    expect(routeApiRequest('/api-unrelated', '').isApi).toBe(false);
    expect(fallBackToPublic()).toBe(true);
    expect(routeApiRequest('/api/notebooks', '').url).toBe(
      'https://phoebe.justmaple.app/api/notebooks',
    );
    expect(browser.__mapleServerIdentity.serverUrl).toBe('https://phoebe.justmaple.app');
    expect(fallBackToPublic()).toBe(false);
  });
  it('preserves existing browser and development API configuration', () => {
    expect(routeApiRequest('/api/notebooks', 'https://paperbark.justmaple.app').url).toBe(
      'https://paperbark.justmaple.app/api/notebooks',
    );
    expect(routeApiRequest('/api/notebooks', '').url).toBe('/api/notebooks');
    expect(fallBackToPublic()).toBe(false);
  });
});
