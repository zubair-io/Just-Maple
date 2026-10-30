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
export function fallBackToPublic(failedEndpoint = nativeServerEndpoint()?.apiUrl): boolean {
  const native = nativeServerEndpoint();
  if (!native || native.apiUrl === native.publicApiUrl || native.apiUrl !== failedEndpoint)
    return false;
  native.apiUrl = native.publicApiUrl;
  // Keep native collectors and subsequent probes on the same route as the web view.
  window.webkit?.messageHandlers?.nativeBridge?.postMessage(
    JSON.stringify({ type: 'serverEndpointFailed', payload: { endpoint: failedEndpoint } }),
  );
  window.dispatchEvent(new Event(serverEndpointChanged));
  return true;
}
