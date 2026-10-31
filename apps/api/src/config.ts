export const config = {
    port: parseInt(process.env.PORT || '7071'),
    host: process.env.HOST || '127.0.0.1',
    instanceId: process.env.INSTANCE_ID || '',
    publicUrl: process.env.PUBLIC_URL || process.env.ORIGIN || 'https://justmaple.app',
    localUrl: process.env.LOCAL_URL || '',
    databaseDriver: process.env.DATABASE_DRIVER || (process.env.MONGODB_URI ? 'mongodb' : 'sqlite'),
    databasePath: process.env.DATABASE_PATH || './storage/just-maple.sqlite',
    backgroundJobsEnabled: process.env.DISABLE_BACKGROUND_JOBS !== 'true',
    serverSearchEnabled: process.env.SERVER_SEARCH_ENABLED === 'true',
    // Deployment-owned AI roots only; never supplied by a client request.
    get botAllowedPrivateEndpoints() {
        return (process.env.BOT_ALLOWED_PRIVATE_ENDPOINTS || '')
            .split(',')
            .map((url) => url.trim())
            .filter(Boolean);
    },
    mongodbUri: process.env.MONGODB_URI || 'mongodb://192.168.0.244:27017/justmaple',
    redisUrl: process.env.REDIS_URL,
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    jwtExpiresIn: '14d', // 14 days - refreshes on each app open
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

    // WebAuthn/Passkey config
    rpName: process.env.RP_NAME || 'Just Maple',
    rpID: process.env.RP_ID || 'justmaple.app',
    origin: process.env.ORIGIN || 'https://justmaple.app',
    get passkeyOrigins() {
        return (
            process.env.PASSKEY_ORIGINS?.split(',').map((origin) => origin.trim()) || [this.origin]
        );
    },

    // Paperbark config (push notification relay service)
    // Supports both PAPERBARK_API_KEY and paperbark-api-key formats for Azure compatibility
    paperbarkUrl:
        process.env.PAPERBARK_URL ||
        process.env['paperbark-url'] ||
        'https://paperbark.justmaple.app',
    paperbarkApiKey: process.env.PAPERBARK_API_KEY || process.env['paperbark-api-key'],

    // APNs config (for direct push in production)
    apnsKeyId: process.env.APNS_KEY_ID,
    apnsTeamId: process.env.APNS_TEAM_ID,
    // Key can be provided as file path OR as the actual key content (preferred for Azure)
    apnsKeyPath: process.env.APNS_KEY_PATH,
    apnsKey: process.env.APNS_KEY, // .p8 key content
    apnsBundleId: process.env.APNS_BUNDLE_ID || 'com.just.maple.JapaneseMaple',
    apnsProduction: process.env.APNS_PRODUCTION === 'true',

    // Use direct APNs if origin is production
    get useDirectApns() {
        return !this.isDev && !!this.apnsKeyId && !!this.apnsTeamId;
    },

    // Gravatar config
    gravatarKey: process.env.GRAVATAR_KEY,

    // Azure Blob Storage config (Hornbeam - for profile pictures and recordings)
    hornbeamConnectionString: process.env.HORNBEAM,
    profilePictureContainer: 'profile-picture',
    recordingsContainer: 'recordings',

    // Local storage fallback (used when Azure Blob Storage is not configured)
    localStoragePath: process.env.LOCAL_STORAGE_PATH || './storage',
    localStorageRequired: process.env.LOCAL_STORAGE_REQUIRED === 'true',

    // Gmail / Google OAuth config
    gmailClientId: process.env.GMAIL_CLIENT_ID || '',
    gmailClientSecret: process.env.GMAIL_CLIENT_SECRET || '',

    // Lego service config
    rebrickableApiKey: process.env.REBRICKABLE_API_KEY,
    brightDataApiKey: process.env.BRIGHT_DATA_API_KEY,
    claudeApiKey: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY,
    hornbeamBlobUrl: process.env.HORNBEAM_BLOB_URL || 'https://hornbeam.justmaple.app/data',
};
