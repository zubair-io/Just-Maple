export const environment = {
  production: false,
  apiUrl: '', // Use proxy to local API
  wsUrl: '', // Use proxy to local WebSocket
  // SignalR removed - using WebSocket
  useSignalR: false,
  signalrNegotiateUrl: '', // Deprecated - SignalR removed
  // LogRocket (only enabled in production)
  logRocketAppId: '',
};
