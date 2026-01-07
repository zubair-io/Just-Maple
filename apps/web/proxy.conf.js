const PROXY_CONFIG = {
  '/api/events/stream': {
    target: 'http://127.0.0.1:8081',
    secure: false,
    changeOrigin: true,
    logLevel: 'debug',
    // Disable buffering for SSE
    onProxyReq: (proxyReq) => {
      proxyReq.setHeader('Connection', 'keep-alive');
      proxyReq.setHeader('Cache-Control', 'no-cache');
    },
    onProxyRes: (proxyRes) => {
      proxyRes.headers['cache-control'] = 'no-cache';
      proxyRes.headers['content-type'] = 'text/event-stream';
      proxyRes.headers['connection'] = 'keep-alive';
      proxyRes.headers['x-accel-buffering'] = 'no'; // Disable nginx buffering
    },
  },
  '/api': {
    target: 'http://127.0.0.1:8081',
    secure: false,
    changeOrigin: true,
  },
  '/ws': {
    target: 'http://127.0.0.1:8081',
    secure: false,
    changeOrigin: true,
    ws: true,
  },
  '/azure': {
    target: 'http://127.0.0.1:7071',
    secure: false,
    changeOrigin: true,
    pathRewrite: {
      '^/azure': '',
    },
  },
};

module.exports = PROXY_CONFIG;
