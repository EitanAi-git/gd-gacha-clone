# Setting up EitanGD Gacha

The website runs on **GitHub Pages**. Accounts, cards and orbs live on **Supabase**, so nothing a player can edit in their browser changes the game. You need four free accounts:

| Service | What it does | Cost |
|---|---|---|
| [Supabase](https://supabase.com) | Database, logins, real-time updates, server code | Free tier |
| [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) | Captcha on login and signup | Free |
| [Brevo](https://www.brevo.com) | Sends the email 2FA codes | Free, 300 emails/day |
| GitHub Pages | Hosts the website | Free |

Plan on about 30 minutes. Do the steps in order.

---

## 1. Create the Supabase project
1. Sign in at supabase.com and click **New project**. Pick any name and region, and save the database password somewhere safe.
2. When it's ready, open **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. You should see "Success. No rows returned".
   - You can run it again later (for example after an update). It keeps your players and settings.
3. Open **Database → Publications → supabase_realtime** and check that `profiles` and `notifications` are switched on. The SQL normally does this already. Real-time kicks, bans and popups need it.

## 2. Lock down Supabase Auth
In **Authentication**:
1. **Sign In / Providers → Email**: keep **Email** enabled. Turn **off** "Allow new users to sign up". New accounts are made only by the server function, which checks the captcha, the username and the password.
2. **Attack Protection → Enable Captcha protection**: choose **Turnstile** and paste your Turnstile **secret** key (from step 3). This stops password guessing against Supabase directly.
3. **Rate Limits**: every login goes through your server function, so Supabase sees most logins coming from one place. Raise **"token verifications"** to about **300 per 5 minutes** so normal players aren't slowed down. Your own lockouts (below) still protect each account.

## 3. Create the Turnstile captcha
1. Go to Cloudflare → **Turnstile → Add widget**.
2. Hostnames: `YOUR-GITHUB-NAME.github.io` and `localhost`.
3. Widget mode: **Managed**.
4. Copy the **Site Key** (public, used in `js/config.js`) and the **Secret Key** (secret, used in steps 2 and 5).

## 4. Set up Brevo for 2FA emails
1. Create a Brevo account.
2. **Senders, domains & dedicated IPs → Senders → Add a sender**. Use an email you own and confirm it from your inbox.
3. **SMTP & API → API Keys → Generate a new API key**. Copy it.

## 5. Deploy the server function
1. In Supabase open **Edge Functions → Deploy a new function → Via Editor**.
2. Name it exactly `api`, replace the sample code with the whole of [`supabase/functions/api/index.ts`](supabase/functions/api/index.ts), and click **Deploy**.
3. Open the function's **Details / Settings** and turn **off** "Enforce JWT verification" (also called "Verify JWT"). The function checks tokens itself, and login and signup have no token yet.
4. Open **Edge Functions → Secrets** and add:

| Name | Value |
|---|---|
| `TURNSTILE_SECRET` | your Turnstile secret key |
| `BREVO_API_KEY` | your Brevo API key |
| `MAIL_FROM` | the sender email you verified in Brevo |
| `ALLOWED_ORIGINS` | `https://YOUR-GITHUB-NAME.github.io` (add `,http://localhost:8000` for local testing). No trailing slash and no repo path. |

*(With the Supabase CLI you can instead run `supabase functions deploy api --no-verify-jwt` and `supabase secrets set NAME=value`.)*

## 6. Point the website at your project
Edit [`js/config.js`](js/config.js):
- `SUPABASE_URL`: **Project Settings → Data API → Project URL** (looks like `https://abcd1234.supabase.co`)
- `SUPABASE_ANON_KEY`: **Project Settings → API Keys**. Use the **anon** key (legacy tab) or the **publishable** key.
- `TURNSTILE_SITE_KEY`: the Turnstile **site** key

These three values are public by design. **Never** put the `service_role` / secret key in this file or anywhere in the repository.

Commit and push.

## 7. Turn on GitHub Pages
Repository → **Settings → Pages** → Source: *Deploy from a branch*, then pick your branch and `/ (root)` → **Save**. After a minute the site is live at `https://YOUR-GITHUB-NAME.github.io/gd-gacha-clone/`.

## 8. Make yourself the admin
1. On the site, click **Create account** and sign up with your username.
2. In Supabase **SQL Editor**, run (with your username):
   ```sql
   update public.profiles set role = 'admin' where lower(username) = lower('YourUsername');
   ```
3. On the site, open **Account** (your name, top right) → **Email 2FA** → enter your email → type the code you receive.
4. The **🛠 Admin** button now works. On later logins you'll be asked for an email code.

Admins **must** keep 2FA on. Admin tools stay locked for an admin session that didn't use the email code.

## 9. Test it
- Log in as a second test player in a private window and open a few packs.
- As admin, open that player in **Admin → Players** and try **Send popup** ("i am here just to annoy you"), **Block**, **Kick** and **Ban**. The private window should react within a second, with no refresh.
- Try 6 wrong passwords on the test account: it locks, and the lock shows in **Admin → Security**.

---

## What the admin panel can do
- **Players:**
  - See everything about a player: orbs, collection, pulls, sessions and IPs, login history, 2FA email.
  - Set, add or remove orbs, up to 9,223,372,036,854,775,807.
  - Give any card with any version and any amount, with no limit, or give one of every card.
  - Kick, Block, Ban (with a reason and how long), Unban, Wipe, Reset progress, Reset 2FA, and Make or remove admin.
  - Set a new password, which logs them out everywhere.
  - **Log in as** the player. A yellow bar shows, and **Return to admin** takes you back.
  - Send a popup.
- **Cards:** edit every card's name, creator, set, rarity and **worth**. Turn cards on or off, and add or delete custom cards.
- **Packs:** price, size, colours, sets, every rarity's odds, availability and order. You can also create new packs.
- **Economy & values:** worth of each rarity, foil and full-art chance and extra worth, starting orbs, passive orbs per hour and cap, and daily reward values.
- **Popups:** message one player or everyone. Players who are offline see it when they next log in.
- **Security:** locked usernames and IPs (unlock them), and the full login history.
- **Logs:** every admin action, with who did it and when.

## How the security works
- **Nothing trusted in the browser.** The browser keeps only the login token and display settings (theme, sound, sidebar). Orbs, cards, odds and prices are all on the server. Every action (open pack, sell, claim) is checked and done by the database.
- **No direct database access.** Row Level Security is on for every table, and players can't insert, update or delete anything directly. They can read only their own profile and their own popups.
- **Login protection:**
  - Captcha on login and signup.
  - 5 wrong passwords lock that username for 1 minute, doubling up to 1 hour.
  - 30 failures from one IP in 10 minutes lock that IP.
  - Errors never reveal whether a username exists, and every login takes the same time.
  - Passwords of 10+ characters, never containing the username, and checked against known data breaches (Have I Been Pwned, which only receives the first 5 characters of a hash).
  - Passwords are stored as bcrypt hashes by Supabase. Nobody, including the admin, can see them.
- **Email 2FA:**
  - 6-digit codes, stored only as hashes, valid for 10 minutes, with 5 tries.
  - Required for admins and optional for players.
- **No shortcut around the login.** A session is valid only if the server function created it. Signing in straight against Supabase's own login gives a token that every game function refuses.
- **Real-time enforcement:**
  - Kick, ban and password resets delete the player's sessions on the server. Their very next request fails.
  - Their open page gets a real-time event and shows the "logged out" or "banned" screen immediately.
  - A block stops all play at once.
- **Admin safety:** admin actions need a 2FA session and are recorded in the log. Admins can't kick, ban or block themselves. "Log in as" can't be used to change the player's password or 2FA.
- **Page hardening:** a strict Content Security Policy (no inline scripts, and only Cloudflare's captcha as an outside script). Everything shown on the page is escaped, and supabase-js is shipped inside the repo, not loaded from a CDN.

### Known limits
- The login token is kept in the browser's storage, as on almost every website. The security policy and escaping are there to keep other scripts from reading it.
- Someone who keeps guessing a player's password can keep that account locked. Each guess needs a captcha, and you can unlock accounts in **Admin → Security**.
- The per-IP limit uses the address the hosting provider reports. A determined attacker may be able to vary it, but the per-username lock still applies.

## Troubleshooting
- **"Backend not configured"**: `js/config.js` still has the placeholder values.
- **"Captcha is not configured" / "Captcha failed"**: check `TURNSTILE_SECRET` in the function's secrets, and that your site's hostname is in the Turnstile widget.
- **"Origin not allowed"** or a CORS error in the console: `ALLOWED_ORIGINS` must exactly match the address bar origin, for example `https://name.github.io`.
- **"Email 2FA is not configured" / "Could not send the email code"**: check `BREVO_API_KEY` and `MAIL_FROM`, and that the sender is verified in Brevo.
- **"Could not start a session"**: make sure the Email provider is enabled (step 2.1). If the message mentions an invalid email, add a secret `INTERNAL_EMAIL_DOMAIN` = `users.example.com` **before** anyone signs up. Accounts use internal addresses like `name@users.eitangd.invalid` that never receive mail.
- **Kicks only take effect after a refresh**: check step 1.3, because real-time needs the publication.
- **Admin button opens "Admin tools are locked"**: turn on email 2FA in Account, log out, and log in again with the code.
