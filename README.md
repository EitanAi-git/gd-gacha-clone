# EitanGD Gacha

A fan-made Geometry Dash card-collecting (gacha) game. Players open packs, collect level cards, sell duplicates and complete sets. Each player has a secure account, and the admin has a real-time control panel.

- **Website:** static HTML, CSS and JS, hosted on GitHub Pages
- **Server:** Supabase (database, auth, real-time, edge function)
- **Step-by-step setup guide:** [SETUP.md](SETUP.md)

Inspired by [gachagd.com](https://gachagd.com) by John119 and mochamaple. This is an independent project with original code, design and generated card art. It is not affiliated with gachagd.com or RobTop Games.

## Credits
- **Geometry Dash** © RobTop Games.
- Every level belongs to its creator. Each card shows "by <creator>" under its name and a credit line in its art.
- Difficulty tiers follow the GD community lists (GDDL, AREDL).
- Uses [supabase-js](https://github.com/supabase/supabase-js) (MIT) and [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT), vendored in `js/vendor/`.

## Features
- **Accounts:**
  - Username and password, with a Cloudflare Turnstile captcha.
  - Lockouts after failed logins, and passwords checked against known breaches.
  - 2FA with an authenticator app (Google Authenticator, Authy…): required for admins, optional for players.
- **Game:**
  - Packs with per-rarity odds; Foil and Full art versions.
  - Flip-to-reveal opening and bulk ×10.
  - Orbs that build up over time, a daily streak, and selling.
  - Collection, catalog and a page for each card.
- **Server-side everything:** orbs, cards, odds and prices live in the database, so editing the page can't cheat.
- **Real time:** popups, kicks, bans, suspensions and wipes reach the player instantly.
- **Admin panel** (popup with a collapsible category sidebar):
  - Players: see all info, log in as them, kick (one player or everyone), ban, suspend, block (a popup they can't close), wipe, reset, set password, give orbs or any number of any card, send popups.
  - Cards, Packs and Economy: edit every value, including what each card is worth.
  - Security (lockouts, login history) and Logs (every admin action).
- **Searchable dropdowns** everywhere, **light and dark theme**, and a layout that works on phones.

## Files
| Path | What it is |
|---|---|
| `index.html`, `css/style.css` | Page shell and styles |
| `js/config.js` | Your public Supabase URL and key, and the Turnstile site key |
| `js/api.js` | Connection to Supabase (RPC calls, edge function, real-time) |
| `js/game.js` | Cache of the server state |
| `js/auth-ui.js` | Login, signup, 2FA, account settings, kicks/bans, popups, theme |
| `js/ui.js` | Home, Catalog and Card pages |
| `js/admin.js` | Admin panel |
| `js/picker.js` | Searchable dropdown |
| `js/cards.js`, `js/data.js` | Card rendering and display constants |
| `supabase/schema.sql` | Database: tables, security rules, game and admin functions, starting cards |
| `supabase/functions/api/index.ts` | Edge function: signup, login, 2FA, "log in as", set password |

## Run locally
```bash
python3 -m http.server 8000
```
Then open http://localhost:8000 (after filling in `js/config.js`, and adding `http://localhost:8000` to `ALLOWED_ORIGINS`).
