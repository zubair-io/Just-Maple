export const environment = {
  production: false,
  apiUrl: 'http://localhost:7072',
  wsUrl: 'ws://localhost:7072',
  // SignalR config (disabled for e2e)
  useSignalR: false,
  signalrNegotiateUrl: '',
  // LogRocket (disabled for e2e)
  logRocketAppId: '',
  // Google OAuth for Gmail integration
  google: {
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
  },
};
