/**
 * STUN and TURN server configuration for WebRTC
 * Used for NAT traversal in peer-to-peer connections
 */

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  // Google STUN servers (free, public)
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },

  // Public TURN servers from Open Relay Project
  // NOTE: These are free public servers with limited bandwidth
  // For production, replace with your own TURN servers (Twilio, Xirsys, or self-hosted CoTURN)
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

/**
 * Production TURN server configuration template
 * Replace with your own TURN server credentials
 */
export const PRODUCTION_ICE_SERVERS: RTCIceServer[] = [
  // Google STUN servers
  { urls: 'stun:stun.l.google.com:19302' },

  // Your own TURN servers (replace these)
  // {
  //   urls: 'turn:your-turn-server.com:3478',
  //   username: 'your-username',
  //   credential: 'your-credential',
  // },
];
