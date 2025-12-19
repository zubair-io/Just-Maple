export const environment = {
  production: true,
  apiUrl: 'https://paperbark.justmaple.app',
  wsUrl: '', // Not used when useSignalR is true
  // SignalR config (production uses Azure SignalR via AutumnBlaze)
  useSignalR: true,
  signalrNegotiateUrl: 'https://autumn-blaze.justmaple.app/api/signalr',
  // LogRocket (only enabled in production)
  logRocketAppId: 'd4ksdx/just-maple', // Replace with your actual LogRocket app ID
};
