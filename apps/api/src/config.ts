export const config = {
    port: parseInt(process.env.PORT || '7071'),
    mongodbUri: process.env.MONGODB_URI || 'mongodb://192.168.0.244:27017/justmaple',
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    jwtExpiresIn: '7d',
    magicLinkExpiresIn: 15 * 60 * 1000, // 15 minutes
    get isDev() {
        return process.env.NODE_ENV !== 'production';
    },
    corsOrigins: process.env.CORS_ORIGINS?.split(',') || [
        'http://localhost:4200',
        'https://localhost:4200',
        'http://192.168.0.244:4200',
        'https://192.168.0.244:4200',
        'https://just-maple-dev.localhost:4200',
        'https://dev.justmaple.app:4200',
        'https://dev.justmaple.ai:4200',
    ],

    // Email config
    azureCommConnectionString: process.env.AZURE_COMMUNICATION_CONNECTION_STRING,
    emailFrom: process.env.EMAIL_FROM || 'DoNotReply@justmaple.app',

    // WebAuthn/Passkey config
    rpName: process.env.RP_NAME || 'Just Maple',
    rpID: process.env.RP_ID || 'justmaple.app',
    origin: process.env.ORIGIN || 'https://justmaple.app',

    // SignalR config (for production mode using Azure SignalR via AutumnBlaze)
    useSignalR: process.env.USE_SIGNALR === 'true',
    signalrServiceUrl: process.env.SIGNALR_SERVICE_URL,
    signalrServiceKey: process.env.SIGNALR_SERVICE_KEY,

    // Paperbark config (push notification relay service)
    paperbarkUrl: process.env.PAPERBARK_URL || 'https://paperbark.justmaple.app',
    paperbarkApiKey: process.env.PAPERBARK_API_KEY,
};
