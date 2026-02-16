export const environment = {
  production: true,
  apiUrl: '', // Relative URLs - served from same origin as API
  wsUrl: '', // Relative URLs - served from same origin as API
  // SignalR config (disabled for self-hosted - use WebSocket)
  useSignalR: false,
  signalrNegotiateUrl: '',
  // LogRocket disabled for self-hosted deployments
  logRocketAppId: '',
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
