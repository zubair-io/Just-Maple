export const environment = {
  production: false,
  apiUrl: '', // Empty = use relative URLs (proxied in dev)
  wsUrl: '', // Empty = use relative URLs (proxied in dev)
  // SignalR config (disabled in dev - use WebSocket)
  useSignalR: false,
  signalrNegotiateUrl: '/azure/api/signalr', // Only used when useSignalR: true
  // LogRocket (only enabled in production)
  logRocketAppId: '',
  // Google OAuth for Gmail integration
  google: {
    clientId: '', // Set in environment.prod.ts or via env var
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
  },
};
