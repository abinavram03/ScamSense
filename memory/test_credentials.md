# ScamSense Test Credentials

## Admin (seeded automatically on backend startup)
- Email: `ScamSense@admin.com`
- Password: `SS012`
- Role: admin

## Auth Endpoints
- `POST /api/auth/register` — body `{email, password, name?}` → sets httpOnly cookie + returns `{id, email, name, token}`
- `POST /api/auth/login` — body `{email, password}` → sets cookie + returns token
- `POST /api/auth/logout` — clears cookie
- `GET /api/auth/me` — returns current user
- `POST /api/predict` (auth required) — body `{url, message}` → prediction JSON
- `GET /api/scans` — recent scan history for the current user

## Notes
- Cookies are `SameSite=none; Secure` so cross-site frontend can send them with `credentials: include`.
- The frontend also stores the `token` from login response in `localStorage` and sends it as `Authorization: Bearer <token>` as a fallback.
