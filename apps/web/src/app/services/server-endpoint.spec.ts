import { afterEach, describe, expect, it } from 'vitest';
import { fallBackToPublic, routeApiRequest, type NativeServerEndpoint } from './server-endpoint';
const browser = window as Window & { __mapleServerIdentity?: NativeServerEndpoint };
afterEach(() => {
  delete browser.__mapleServerIdentity;
  vi.unstubAllGlobals();
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
  it('reports the failed endpoint to native once, without accepting a stale failure', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('webkit', { messageHandlers: { nativeBridge: { postMessage } } });
    browser.__mapleServerIdentity = {
      serverUrl: 'https://primary.example',
      publicApiUrl: 'https://primary.example',
      apiUrl: 'https://new-local.example',
      localUrl: 'https://new-local.example',
    };
    expect(fallBackToPublic('https://old-local.example')).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
    expect(fallBackToPublic('https://new-local.example')).toBe(true);
    expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({
      type: 'serverEndpointFailed',
      payload: { endpoint: 'https://new-local.example' },
    });
    expect(fallBackToPublic('https://new-local.example')).toBe(false);
    expect(postMessage).toHaveBeenCalledOnce();
  });
});
