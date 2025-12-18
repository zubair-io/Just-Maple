export const environment = {
  production: false,
  apiUrl: '', // Use proxy to local API
  wsUrl: '', // Not used when useSignalR is true
  // SignalR config (local testing with production AutumnBlaze)
  useSignalR: true,
  signalrNegotiateUrl: 'https://autumn-blaze.justmaple.app/api/signalr',
};
