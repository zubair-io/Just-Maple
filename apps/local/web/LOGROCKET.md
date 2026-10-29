# LogRocket Integration

LogRocket is integrated into Just Maple for production monitoring and debugging.

## Features

- **Production-only**: LogRocket only initializes in production builds, never in development
- **Automatic user identification**: Users are automatically identified when they log in
- **Error tracking**: Uncaught errors are automatically captured
- **Session recording**: User sessions are recorded for debugging
- **Privacy-focused**: Sensitive data (auth tokens, passwords) is automatically redacted

## Setup

### 1. Get your LogRocket App ID

1. Sign up at [https://logrocket.com](https://logrocket.com)
2. Create a new application
3. Copy your App ID (format: `your-org/your-app-name`)

### 2. Configure the App ID

Edit `apps/web/src/environments/environment.prod.ts`:

```typescript
export const environment = {
  // ... other config
  logRocketAppId: 'your-org/just-maple', // Replace with your actual App ID
};
```

### 3. Build and Deploy

LogRocket will automatically initialize when the production build is deployed.

## Usage

### Track Custom Events

```typescript
import { LogRocketService } from './services/logrocket.service';

constructor(private logRocket: LogRocketService) {}

async trackEvent() {
  await this.logRocket.track('custom_event', {
    property1: 'value1',
    property2: 123,
  });
}
```

### Capture Exceptions

```typescript
try {
  // some code
} catch (error) {
  await this.logRocket.captureException(error as Error, {
    context: 'additional context',
  });
}
```

### Get Session URL

```typescript
const sessionUrl = await this.logRocket.getSessionURL();
console.log('Share this URL with support:', sessionUrl);
```

## What's Recorded

### Automatically Recorded:

- User interactions (clicks, navigation)
- Network requests (with sensitive data redacted)
- Console logs and errors
- JavaScript errors
- User information (email, display name)

### Redacted Automatically:

- Authorization headers
- Password fields
- Credit card numbers
- Any element with `data-private` attribute

## Privacy & Security

- Authorization tokens are automatically redacted from network requests
- Only errors and events are sent in production
- Development builds never initialize LogRocket
- Users are identified by their user ID and email only

## Monitoring

View your sessions at: [https://app.logrocket.com](https://app.logrocket.com)

## Disable LogRocket

To disable LogRocket, simply remove or empty the `logRocketAppId` in `environment.prod.ts`:

```typescript
logRocketAppId: '', // Empty = disabled
```
