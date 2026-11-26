// EitanGD Gacha: server connection. All game data lives on the server; this file only talks to it.
window.API = (function () {
  const C = window.APP_CONFIG || {};
  const configured = !!(C.SUPABASE_URL && !C.SUPABASE_URL.includes("YOUR-") && C.SUPABASE_ANON_KEY && !C.SUPABASE_ANON_KEY.includes("YOUR-"));
  // window.API_MOCK lets the test suite run the UI without a real backend.
  const sb = window.API_MOCK ? window.API_MOCK.client : configured
    ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "eitangd-auth" },
      })
    : null;

  class ApiError extends Error {
    constructor(message, status, extra) { super(message); this.status = status || 0; this.extra = extra || {}; }
  }

  const SIGNED_OUT = /^(Signed out|Banned|JWT expired|invalid JWT)/i;
  let onSessionLost = () => {};

  function friendly(msg) {
    if (!msg) return "Error";
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "No connection";
    return msg;
  }

  async function rpc(name, args) {
    if (!sb) throw new ApiError("Backend not configured");
    const { data, error } = await sb.rpc(name, args || {});
    if (error) {
      const msg = friendly(error.message);
      if (SIGNED_OUT.test(msg)) onSessionLost(/^Banned/i.test(msg) ? "banned" : "signedout");
      throw new ApiError(msg, error.code);
    }
    return data;
  }

  async function fn(action, body) {
    if (window.API_MOCK) return window.API_MOCK.fn(action, body);
    if (!configured) throw new ApiError("Backend not configured");
    const { data: s } = await sb.auth.getSession();
    const headers = { "content-type": "application/json", apikey: C.SUPABASE_ANON_KEY };
    if (s.session) headers.authorization = "Bearer " + s.session.access_token;
    let res;
    try {
      res = await fetch(C.SUPABASE_URL + "/functions/v1/api", {
        method: "POST", headers, body: JSON.stringify(Object.assign({ action }, body || {})),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      throw new ApiError(e && e.name === "TimeoutError" ? "Timed out" : "No connection");
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(j.error || "Error " + res.status, res.status, j);
    return j;
  }

  async function setSession(s) {
    const { error } = await sb.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
    if (error) throw new ApiError(error.message);
  }

  async function session() {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session;
  }

  async function signOutLocal() {
    try { await sb.auth.signOut({ scope: "local" }); } catch (e) { /* ignore */ }
  }

  // Real-time: own profile row and own notifications.
  let channel = null;
  function subscribe(userId, handlers) {
    unsubscribe();
    if (!sb || !sb.channel) return;
    channel = sb.channel("me-" + userId)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: "id=eq." + userId },
        (p) => handlers.profile && handlers.profile(p.new))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + userId },
        (p) => handlers.notification && handlers.notification(p.new))
      .subscribe();
  }
  function unsubscribe() {
    if (channel && sb) { try { sb.removeChannel(channel); } catch (e) { /* ignore */ } }
    channel = null;
  }

  return {
    configured: configured || !!window.API_MOCK,
    ApiError, rpc, fn, setSession, session, signOutLocal, subscribe, unsubscribe,
    onSessionLost(cb) { onSessionLost = cb; },
    onAuthChange(cb) { if (sb) sb.auth.onAuthStateChange((ev, s) => cb(ev, s)); },
  };
})();
