# YouTube OAuth configuration

LeagueRecord is an installed desktop application and uses a Google Desktop app
OAuth client. Google may require both the client ID and client secret when this
client exchanges or refreshes tokens.

The Desktop client secret is not a confidential security boundary: any value
distributed with a desktop executable can be extracted. Google likewise treats
installed applications as unable to keep it confidential. LeagueRecord supplies
the value only because Google's token endpoint requires it for the registered
client; user authorization is protected by PKCE and user tokens are protected
separately.

Official release users do not configure OAuth. The maintainer supplies the
Desktop OAuth credentials at build time, and users authorize their own Google
account in the system browser.

## Local development

Create a **Desktop app** OAuth client in the same Google Cloud project that has
YouTube Data API v3 and the required quota. Configure the OAuth consent screen
and required scopes, then set both locally:

```powershell
$env:YOUTUBE_OAUTH_CLIENT_ID = "YOUR_CLIENT_ID.apps.googleusercontent.com"
$env:YOUTUBE_OAUTH_CLIENT_SECRET = "YOUR_DESKTOP_CLIENT_SECRET"
bun run electron:dev
```

Alternatively, create these ignored one-line files:

- `electron/youtube/local-client-id.txt`
- `electron/youtube/local-client-secret.txt`

Never commit either local file. Do not use a Web application or Firebase web
client; use the credential pair belonging to the Google Desktop app client.

## Official packaging

The release job supplies `YOUTUBE_OAUTH_CLIENT_ID` and
`YOUTUBE_OAUTH_CLIENT_SECRET`, then runs `bun run electron:build`. The build
script validates both values and writes ignored build inputs under
`.build-input/`. Electron Builder copies them to `resources/youtube/`.

Source builders may supply their own Desktop client in the same way. Ordinary
users of the official installer do not need a Google Cloud project. Bundled
official credentials take precedence over inherited environment variables so
the OAuth identity cannot be silently replaced at launch.

## Security properties

- Authorization Code Flow with PKCE (`S256`) and a per-request random `state`.
- The redirect listener binds only to `127.0.0.1` on an ephemeral port.
- Access and refresh tokens remain in the Electron main process.
- User tokens are encrypted at rest with Electron `safeStorage` in the user's
  app data directory.
- Disconnecting revokes the refresh token at Google and deletes the local copy.
- OAuth credential values are excluded from Git and injected only into release
  builds.

The packaged Desktop client ID and client secret must both be considered public.
They do not grant access to a user's channel by themselves. Channel access still
requires that user's OAuth consent and tokens. PKCE protects the authorization
code exchange but does not make packaged application credentials confidential.

Keeping the client secret truly confidential would require a separately secured
backend to perform all token exchanges and refreshes. That architecture would
also cause the backend to process sensitive OAuth tokens and is outside this
desktop-only design.
