export const environment = {
  production: false,
  apiUrl: '', // Use proxy to local API
  wsUrl: '', // Use proxy to local WebSocket
  // SignalR removed - using WebSocket
  useSignalR: false,
  signalrNegotiateUrl: '', // Deprecated - SignalR removed
  // LogRocket (only enabled in production)
  logRocketAppId: '',
  // Google OAuth for Gmail integration
  google: {
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
    calendarScopes: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  },
};
