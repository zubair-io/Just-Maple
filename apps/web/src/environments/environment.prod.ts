export const environment = {
  production: true,
  apiUrl: 'https://paperbark.justmaple.app',
  wsUrl: 'wss://paperbark.justmaple.app',
  // SignalR removed - using WebSocket
  useSignalR: false,
  signalrNegotiateUrl: '', // Deprecated - SignalR removed
  // LogRocket (only enabled in production)
  logRocketAppId: 'd4ksdx/just-maple',
  // Google OAuth for Gmail integration
  google: {
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
    calendarScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  },
};
