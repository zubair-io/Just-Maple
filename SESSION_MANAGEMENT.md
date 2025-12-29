# Session Management & Token Refresh

## Overview

The authentication system now implements:

1. **Automatic logout on 401** - Users are logged out when their token expires
2. **Sliding window sessions** - Tokens refresh to 14 days each time the app opens

## Token Lifetime

- **Initial JWT Duration**: 14 days (from login)
- **Auto-Refresh**: Every time the user opens the app
- **New Expiration**: 14 days from now (sliding window)

## How It Works

### Login Flow

```
User requests magic link
   ↓
Magic link sent to email (valid for 15 min)
   ↓
User clicks link/enters code
   ↓
JWT access token issued (14-day expiration)
   ↓
Token stored in localStorage
```

### App Open Flow (Sliding Window)

```
User opens app
   ↓
AuthService.initFromStorage() loads token
   ↓
AuthService.refreshToken() called automatically
   ↓
POST /api/auth/refresh sends current token
   ↓
New JWT issued (14 days from NOW)
   ↓
Token updated in localStorage
```

### Token Expiration Flow

```
API request with expired token
   ↓
Server returns 401 Unauthorized
   ↓
Auth interceptor catches 401
   ↓
AuthService.logout() called
   ↓
Token cleared, user redirected to /login
```

## User Experience

### Active Users (Opens app weekly)

- ✅ **Never logged out**
- Token refreshes every time they open the app
- 14-day expiration resets on each open
- Seamless experience

### Inactive Users (Gone >14 days)

- ⏱️ **Token expires after 14 days of no use**
- Next API request returns 401
- Automatically logged out and redirected to login
- Must request new magic link

## Implementation Details

### Frontend Changes

**1. Auth Interceptor** (`apps/web/src/app/interceptors/auth.interceptor.ts`)

- Catches 401 errors on all authenticated requests
- Automatically calls `AuthService.clearAuthOnExpiration()` on 401
- Clears token and redirects to login page
- Uses `clearAuthOnExpiration()` instead of `logout()` to avoid circular dependency (no HTTP call)

**2. AuthService** (`apps/web/src/app/services/auth.service.ts`)

- New `refreshToken()` method
- Calls POST `/api/auth/refresh` with current token
- Receives new token with 14-day expiration
- Updates localStorage and signals

- New `clearAuthOnExpiration()` method
- Called by interceptor on 401 (avoids circular dependency)
- Clears token signals and storage without HTTP call
- Clears IndexedDB cache

**3. App Initialization** (`initFromStorage()` in AuthService)

- Loads token from localStorage on app startup
- Sets token signals immediately for instant auth state
- Defers `refreshToken()` call using `queueMicrotask()` to avoid circular dependency
    - This allows service initialization to complete before making HTTP calls
    - Token refresh runs in next microtask (faster than setTimeout)
- Falls back to `fetchCurrentUser()` if refresh fails

### Backend Changes

**1. Token Duration** (`apps/api/src/config.ts`)

```typescript
jwtExpiresIn: '14d', // 14 days - refreshes on each app open
```

**2. Refresh Endpoint** (`apps/api/src/routes/auth.ts`)

```typescript
POST /api/auth/refresh
- Requires valid JWT in Authorization header
- Verifies current token
- Issues new token with 14-day expiration
- Returns: { accessToken, user }
```

## Security Considerations

### Why This Approach?

**Pros:**

- ✅ Simple implementation (no refresh token database)
- ✅ Excellent UX for active users (never logged out)
- ✅ Automatic cleanup of inactive sessions (14-day max)
- ✅ No server-side session storage needed
- ✅ Works with native apps (iOS keychain integration)

**Cons:**

- ⚠️ Cannot revoke tokens server-side (until they expire)
- ⚠️ Compromised token valid for up to 14 days

### Token Revocation

If you need to revoke tokens immediately:

1. User changes password → Clear all devices
2. Security breach → Add token blacklist to Redis
3. Account lockout → Disable user in database

For now, tokens self-expire after 14 days of inactivity.

## Testing

### Test Scenario 1: Active User

1. Log in via magic link
2. Close browser
3. Open app next day → Token automatically refreshed
4. Close browser
5. Open app 13 days later → Still logged in, token refreshed again

### Test Scenario 2: Inactive User

1. Log in via magic link
2. Don't open app for 15 days
3. Open app → Token expired
4. Make any API request → 401 error
5. Automatically logged out and redirected to login

### Test Scenario 3: Concurrent Sessions

1. Log in on Device A
2. Log in on Device B (new token issued)
3. Both devices can refresh independently
4. Each device maintains its own 14-day window

## Migration Notes

**Existing Users:**

- No migration needed
- Old 7-day tokens will continue working until they expire
- On next app open, they'll get new 14-day tokens
- Gradual rollout over 7 days

**Breaking Changes:**

- None - fully backward compatible
