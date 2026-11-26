# Step-by-step guide: putting EitanGD Gacha online

This guide takes you from zero to a working site with accounts, the admin panel and real-time kicks and bans. You don't need to know how to code. Just follow each step in order and tick the boxes.

**Time:** about 30–45 minutes. **Cost:** free.

> **Why so many accounts?** GitHub Pages can only show files, it can't keep secrets. So the accounts, cards and orbs live on **Supabase** (a free database), and nobody can cheat by editing the page. **Cloudflare** stops bots with a captcha. 2FA uses an **authenticator app** on your phone, so no email service is needed.

---

## Before you start: your notes table

During the guide you'll copy several values. Keep this table open in a notes app and fill it in as you go:

| # | Value | Where you get it | Secret? |
|---|---|---|---|
| A | Turnstile **Site Key** | Step 1 | No (goes in the website) |
| B | Turnstile **Secret Key** | Step 1 | **Yes** |
| E | Supabase **Project URL** | Step 3 | No (goes in the website) |
| F | Supabase **anon / publishable key** | Step 3 | No (goes in the website) |
| G | Your site address | Step 0 | No |

The **secret** value (B) must **never** go into any file in GitHub. It only goes into Supabase's settings pages. (There are no C and D: those were for an email service the game no longer needs.)

---

## Step 0: Merge the code and work out your site address
- [ ] Open the pull request on GitHub and click **Merge pull request → Confirm merge**.
- [ ] Your site address (**G**) is `https://<your-github-username>.github.io`. For example: `https://eitanai-git.github.io`. Write it down **without** `/gd-gacha-clone` at the end.

---

## Step 1: Cloudflare Turnstile (the captcha)
1. [ ] Go to <https://dash.cloudflare.com/sign-up> and create a free account (or log in).
2. [ ] In the left menu click **Turnstile** (or search "Turnstile" at the top).
3. [ ] Click **Add widget**.
4. [ ] **Widget name:** `EitanGD Gacha`.
5. [ ] **Hostnames:** click **Add hostnames** and add both of these:
   - your site address without `https://`, e.g. `eitanai-git.github.io`
   - `localhost`
6. [ ] **Widget mode:** **Managed**. **Pre-clearance:** No.
7. [ ] Click **Create**.
8. [ ] Copy the **Site Key** into your notes as **A**.
9. [ ] Copy the **Secret Key** into your notes as **B**.

---

## Step 2: Install an authenticator app on your phone
The admin account logs in with a password **plus** a 6-digit code from your phone. That code changes every 30 seconds, so a stolen password alone isn't enough.

1. [ ] On your phone, install **one** of these free apps: **Google Authenticator**, **Microsoft Authenticator**, **Authy** or **2FAS**.
2. [ ] That's all for now. You'll connect it to the game in Step 9.

---

## Step 3: Create the Supabase project (the database)
1. [ ] Go to <https://supabase.com> → **Start your project** and sign in with GitHub.
2. [ ] Click **New project**.
   - **Name:** `eitangd-gacha`
   - **Database password:** click **Generate a password**, and save it in your password manager. You won't need it in this guide.
   - **Region:** the one closest to you.
   - Click **Create new project**, then wait about 2 minutes until it says the project is ready.
3. [ ] Left menu → **Project Settings** (gear icon) → **Data API**. Copy the **Project URL** (like `https://abcdefgh.supabase.co`) into your notes as **E**.
4. [ ] Still in Project Settings → **API Keys**. Copy the **anon public** key (under the "Legacy API keys" tab) **or** the **publishable** key (starts with `sb_publishable_`) into your notes as **F**.
   - ⚠️ Do **not** copy the `service_role` or `secret` key. It is not needed anywhere in this guide.

---

## Step 4: Create the database tables
1. [ ] In Supabase, left menu → **SQL Editor** → **+ New query**.
2. [ ] On GitHub, open the file [`supabase/schema.sql`](supabase/schema.sql), click the **Copy raw file** button (two overlapping squares, top right of the file), and paste everything into the SQL Editor.
3. [ ] Click **Run** (bottom right). You should see **"Success. No rows returned"**.
   - If it shows a warning about "destructive operations", click **Run this query**. It only sets permissions.
4. [ ] Left menu → **Database** → **Publications** → click **supabase_realtime**. Make sure the switches for **profiles** and **notifications** are **on**. These make kicks and popups instant.

---

## Step 5: Lock down logins
In Supabase, left menu → **Authentication**:

1. [ ] **Sign In / Providers**:
   - **Allow new users to sign up**: turn it **OFF** and click **Save**. Don't worry, players can still sign up on your site. The game's server creates accounts after checking the captcha and password.
   - In the provider list, make sure **Email** is **Enabled**.
2. [ ] **Attack Protection**:
   - Turn on **Enable Captcha protection**.
   - Provider: **Turnstile by Cloudflare**.
   - Secret: paste **B**. Click **Save**.
3. [ ] **Rate Limits**:
   - Find **"Rate limit for token verifications"** and set it to **300**. Click **Save**.
   - Why: all logins pass through the game's server, so Supabase sees them coming from one place.

---

## Step 6: Deploy the game's server function
1. [ ] In Supabase, left menu → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. [ ] Change the function name to exactly: `api`
3. [ ] Delete all the sample code in the editor.
4. [ ] On GitHub, open [`supabase/functions/api/index.ts`](supabase/functions/api/index.ts), click **Copy raw file**, and paste it into the editor.
5. [ ] Click **Deploy function** and wait for it to finish.
6. [ ] Open the **api** function → **Details** (or **Settings**) tab. Turn **OFF** **"Verify JWT with legacy secret"** / **"Enforce JWT verification"**, then click **Save**.
   - This is safe: the function checks every login itself. Login and signup can't send a token yet, because the player isn't logged in.
7. [ ] Left menu → **Edge Functions** → **Secrets**. Add these two, one at a time (Name → Value → **Save**):

   | Name | Value |
   |---|---|
   | `TURNSTILE_SECRET` | **B** |
   | `ALLOWED_ORIGINS` | **G**, e.g. `https://eitanai-git.github.io` (no `/` at the end, no repo name) |

---

## Step 7: Connect the website to Supabase
1. [ ] On GitHub, go to the **main** branch and open [`js/config.js`](js/config.js). Click the ✏️ **pencil** (Edit).
2. [ ] Replace the three placeholder values, keeping the quotes:
   ```js
   SUPABASE_URL: "E goes here",
   SUPABASE_ANON_KEY: "F goes here",
   TURNSTILE_SITE_KEY: "A goes here",
   ```
3. [ ] Click **Commit changes…** → **Commit changes**.

---

## Step 8: Turn on GitHub Pages
1. [ ] In the repository, go to **Settings** → **Pages** (left menu).
2. [ ] **Source:** *Deploy from a branch*. **Branch:** `main`, folder `/ (root)`. Click **Save**.
3. [ ] Wait 1–2 minutes and refresh the page. A link appears at the top: **"Your site is live at …"**, e.g. `https://eitanai-git.github.io/gd-gacha-clone/`. Open it.
4. [ ] You should see the **Log in / Create account** screen with a captcha.
   - If you see **"Almost there"** instead, Step 7 wasn't saved, or GitHub hasn't finished updating yet. Wait a minute and refresh.

---

## Step 9: Make yourself the admin
1. [ ] On your site, click **Create account**, pick your username and a strong password (10+ characters), solve the captcha, and click **Create account**.
2. [ ] In Supabase, open **SQL Editor** → **+ New query**, paste this (change `YourUsername` to your username) and click **Run**:
   ```sql
   update public.profiles set role = 'admin' where lower(username) = lower('YourUsername');
   ```
   It should say **"Success. 1 row affected"** (or similar).
3. [ ] Back on the site, refresh the page. Click your name (top right) to open **Account**.
4. [ ] Under **Two-factor login (2FA)**, click **Set up 2FA**. A QR code appears.
5. [ ] In your authenticator app, tap **+** → **Scan a QR code**, and point your phone at the screen. "EitanGD Gacha" appears in the app with a 6-digit code.
   - Setting it up on the same phone? Choose **Enter a setup key** instead and type the key shown under the QR code.
6. [ ] Type the code from the app into the box and click **Turn on 2FA**.
7. [ ] Click the **🛠 Admin** button at the top. The admin panel opens. 🎉
8. [ ] From now on, every login asks for the current code from the app. That's the admin protection.

> 💡 Keep the authenticator app on your phone. If you delete it or lose your phone, see **"Lost your phone"** in the table below.

---

## Step 10: Test that everything works
Use a **private/incognito window** as a second player:
- [ ] In the private window, create a test account (e.g. `TestPlayer`) and open a pack.
- [ ] In your normal window: **🛠 Admin → Players → TestPlayer**:
  - [ ] **Send popup** with the preset "i am here just to annoy you". The private window shows it right away.
  - [ ] **Give a card**, any amount. It appears in the test player's collection.
  - [ ] **Suspend**. The test player sees a red banner and can't open packs. Then **Unsuspend**.
  - [ ] **Kick**. The test player is logged out instantly.
  - [ ] **👁 Log in as this player**. You see their account. Click **Return to admin**.
- [ ] Log out of the test account and try a wrong password 6 times. It gets locked, and **Admin → Security** shows the lock (click **Unlock**).

All ticked? You're done! 🎉

---

## Something went wrong?

| What you see | What to do |
|---|---|
| **"Almost there"** page | `js/config.js` still has placeholders, or Pages hasn't updated. Redo Step 7, wait 2 minutes, then hard refresh (Ctrl+Shift+R). |
| **"Can't reach the server"** | **E** in `js/config.js` is wrong. It must start with `https://` and end with `.supabase.co`. |
| Captcha doesn't appear | Ad blockers can block it. Also check that your site address is in the Turnstile hostnames (Step 1.5). |
| **"Captcha failed"** or **"Captcha is not configured"** | Check `TURNSTILE_SECRET` (Step 6.7) and the captcha secret in Step 5.2. Both must be **B**. |
| **"Origin not allowed"**, or a CORS error in the browser console (F12) | `ALLOWED_ORIGINS` must be exactly **G**: no trailing `/`, no `/gd-gacha-clone`. |
| **"No connection"** when logging in | The function isn't named exactly `api`, or isn't deployed (Step 6). |
| **"Signed out"** right after logging in | JWT verification is still on for the function (Step 6.6), or the SQL in Step 4 didn't run. |
| **"Wrong code"** when setting up or logging in with 2FA | Use the **newest** code in the app, and make sure your phone's time is set automatically (Settings → Date & time → automatic). Codes only work for about 30 seconds. |
| **Lost your phone** or deleted the authenticator app | In the Supabase **SQL Editor**, run (with your username): `select public.srv_twofa_disable(id) from public.profiles where lower(username) = lower('YourUsername');` Then log in with just your password and do Step 9.4–9.6 again. |
| **"Could not start a session"** | Make sure the **Email** provider is enabled (Step 5.1). If the message mentions an invalid email, add the secret `INTERNAL_EMAIL_DOMAIN` = `users.example.com` *before* anyone else signs up. |
| Kicks/popups only show after refreshing | Turn on **profiles** and **notifications** in Step 4.4. |
| Admin panel says **"Admin tools are locked"** | Turn on 2FA (Step 9.4–9.6). If it's already on, log out and log in again with the app code. |
| Forgot your admin password | Accounts have no real email, so password-recovery emails can't work. Instead, run this in the Supabase SQL Editor (lowercase username): `update auth.users set encrypted_password = extensions.crypt('NewPassword123!', extensions.gen_salt('bf', 10)) where email = 'yourname@users.eitangd.invalid';` |

---

## Changing the game later
- **Cards, prices, odds, card worth, orbs economy:** all in **🛠 Admin**. No code changes needed.
- **Updating the code** (for example after a new pull request): merge it, then:
  - If `supabase/schema.sql` changed, run it again in the SQL Editor (Step 4). It keeps all players and settings.
  - If `supabase/functions/api/index.ts` changed, open the **api** function in Supabase, paste the new code and deploy again.

---

## How the security works (for reference)
- **Nothing to edit in the browser:** the browser keeps only the login token and display settings (theme, sound, sidebar). Orbs, cards, odds and prices live on the server, which checks every action.
- **No direct database access:** Row Level Security is on for every table. Players can't change anything directly, and can read only their own profile and popups.
- **Login protection:**
  - Captcha on login and signup.
  - 5 wrong passwords lock that username for 1 minute, doubling up to 1 hour.
  - 30 failures from one IP in 10 minutes lock that IP.
  - Errors never reveal whether a username exists, and logins always take the same time.
  - Passwords need 10+ characters, can't contain the username, and are checked against known data breaches.
  - Passwords are stored as bcrypt hashes. Nobody, not even the admin, can see them.
- **2FA with an authenticator app (TOTP):**
  - Required for admins, optional for players.
  - The secret key stays on the server and players can never read it.
  - Each code works only once, and a login gets 5 tries before it expires.
- **No shortcut around the login:** a session counts only if the game's server function created it. Logging in directly against Supabase gives a token the game refuses.
- **Real-time enforcement:**
  - Kick, ban and password changes delete the player's sessions on the server.
  - Their open page reacts within a second, and any further request fails.
- **Admin safety:**
  - Admin actions need a 2FA session, and all are logged in **Admin → Logs**.
  - Admins can't kick, ban or suspend themselves.
  - "Log in as" can't change the player's password or 2FA.
- **Page hardening:**
  - A strict Content Security Policy: no inline scripts, and Cloudflare's captcha is the only outside script.
  - All text is escaped.
  - The Supabase library is stored in the repo, not loaded from a CDN.

**Known limits:**
- The login token lives in browser storage, as on most websites.
- Someone who keeps guessing a player's password can keep that account locked. Each guess needs a captcha, and you can unlock accounts in **Admin → Security**.
- The per-IP limit relies on the address the host reports, but the per-username lock always applies.
