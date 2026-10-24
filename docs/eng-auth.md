# Authentication

Just Maple uses passkeys for account creation and sign-in. No email address, password, magic link, or verification code is required.

## New accounts

1. Choose **Create an account** on `/login` and enter a display name (1–80 characters after trimming).
2. `POST /api/auth/passkey/signup/start` with `{ "displayName": "Your name" }` returns WebAuthn creation options.
3. The browser creates a discoverable passkey, requiring user verification (biometric or device PIN).
4. `POST /api/auth/passkey/signup/finish` accepts the registration response. The server verifies the challenge, origin, RP ID, and user verification before storing the account and credential and issuing a JWT.

Display names are not unique identifiers and do not grant access to existing accounts. Each account receives a server-generated ID. New accounts have no email field. Existing email metadata is retained for compatibility; it cannot be used to authenticate.

## Sign-in and additional passkeys

`POST /api/auth/passkey/login/start` returns discoverable authentication options, without an email filter. Send the browser's authentication response to `/api/auth/passkey/login/finish`. The server verifies the signature and user verification, updates the credential counter, and issues a session for the credential's existing owner.

Authenticated users can add additional passkeys in Settings using `/api/auth/passkey/register/start` and `/finish`. Registration challenges are bound to that authenticated user. Existing account IDs, data, passkeys, and valid JWT sessions remain usable.

JWTs use the account ID (`sub`) as identity and expire after 14 days. `/api/auth/refresh` requires a valid bearer token; it does not recover an expired session. Browser sessions use origin-scoped local storage, and native wrappers can use their existing Keychain bridge.

## Local development sign-in

On localhost, development builds show **Development sign-in** below the passkey form.
Enter an existing account's email and a JWT signed by the development API. From the
repository root, generate a token with:

```sh
bun run dev:token you@example.com
```

The command reads `apps/api/.env`, looks up the existing user, and prints a one-hour
token. It does not create or modify accounts. Paste the token into the form with
that account's email. The API validates the signature, expiration, existing user,
and email before returning the normal session. This endpoint is disabled when
`NODE_ENV=production` and rejects non-local browser origins. Production builds do
not display the form. Passkey signup and sign-in remain available.

## Challenge storage

Challenges are stored in MongoDB's `passkey_challenges` collection with a ceremony kind, optional account ID/display name, and five-minute expiry. Finish endpoints atomically consume the matching challenge before verification. Expiry is checked in the query, independently of MongoDB TTL cleanup. This prevents concurrent replay and supports multiple API replicas. Invalid client data cannot be used as a database query operator.

## Sharing without email

Settings displays the account ID. Share a notebook with another user's account ID using `POST /api/notebooks/:id/share` with `{ "userId": "<account ID>", "accessLevel": "write" }` (or `"read"`). Display names are for presentation only.

## Deployment

- Set `RP_ID` to the relying-party hostname and `ORIGIN` to the exact HTTPS app origin. Local tests use `localhost` and `http://localhost:7072`.
- Startup removes the legacy non-sparse email index, allowing multiple accounts without email. Email is retained as metadata and no replacement unique email index is created; this also avoids unsupported unique-index creation on populated Cosmos DB collections. Account IDs and passkey credentials remain the identity keys. It creates a TTL index for passkey challenges. Migration failures stop startup. Test this migration against your database provider before deploying.
- The email sending service and its Azure Communication Email dependency/configuration are removed. Remove `AZURE_COMMUNICATION_CONNECTION_STRING` and `EMAIL_FROM` from deployment secrets when no longer needed elsewhere.
- Existing users have passkeys. Check that these are discoverable and accessible at the configured RP before rollout. Add another passkey while signed in if needed. Keep a synced passkey or a second passkey: there is no email recovery path.
- Old `/api/auth/magic-link`, `/verify`, and `/verify-code` endpoints return 404. The old browser `/verify` route redirects to login. Old `magic_links` records are no longer read; they can expire or be removed by a separate database maintenance operation.
- The reMarkable client has no WebAuthn implementation. Its obsolete email login has been removed, and the login screen explains that passkey sign-in is not supported there yet. Existing stored sessions are retained.

## Validation

API tests cover signup without email, duplicate display names, verification failures, expired/malformed/wrong-ceremony challenges, credential reuse, challenge replay, authenticated enrollment, existing accounts, and removed endpoints. Chromium tests use a resident virtual authenticator against an isolated MongoDB instance to exercise real WebAuthn signup and sign-in.
