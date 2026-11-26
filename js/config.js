// EitanGD Gacha: backend settings. Fill these in from your Supabase and Cloudflare dashboards (see SETUP.md).
// These values are PUBLIC by design. Never put the service_role key or any secret here.
window.APP_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  // Supabase → Project Settings → API Keys → the "anon" (legacy) or "publishable" key
  SUPABASE_ANON_KEY: "YOUR-ANON-OR-PUBLISHABLE-KEY",
  // Cloudflare → Turnstile → your widget → Site Key
  TURNSTILE_SITE_KEY: "YOUR-TURNSTILE-SITE-KEY",
};
