/** Native bootstrap is injected before Angular starts; identity never changes with LAN routing. */
export interface NativeServerEndpoint {
  serverUrl: string;
  publicApiUrl: string;
  apiUrl: string;
  localUrl?: string;
}
export const serverEndpointChanged = 'maple:server-endpoint';
export function nativeServerEndpoint(): NativeServerEndpoint | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window as Window & { __mapleServerIdentity?: NativeServerEndpoint }).__mapleServerIdentity;
}
export function routeApiRequest(url: string, defaultBase: string): { url: string; isApi: boolean } {
  const native = nativeServerEndpoint();
  let path = url;
  for (const base of [native?.publicApiUrl, native?.localUrl, defaultBase]) {
    if (base && url.startsWith(`${base}/api/`)) {
      path = url.slice(base.length);
      break;
    }
  }
  const isApi = path === '/api' || path.startsWith('/api/');
  return { url: isApi ? `${native?.apiUrl ?? defaultBase}${path}` : url, isApi };
}
export function fallBackToPublic(): boolean {
  const native = nativeServerEndpoint();
  if (!native || native.apiUrl === native.publicApiUrl) return false;
  native.apiUrl = native.publicApiUrl;
  window.dispatchEvent(new Event(serverEndpointChanged));
  return true;
}
