/* ChercheAppart — couche "cloud" (Supabase + Web Push).
 *
 * Optionnelle : si la config Supabase est absente, tout est désactivé et l'app
 * reste en mode local (recherche en direct dans le navigateur). Sinon, elle
 * ajoute : compte par e-mail (lien magique), sauvegarde des critères côté serveur
 * (pour la veille en arrière-plan) et alertes Web Push.
 *
 * Expose window.Cloud avec une API simple consommée par app.js.
 */
(() => {
  "use strict";
  const cfg = window.CHERCHEAPPART_CONFIG || {};
  const enabled = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);

  const Cloud = {
    enabled,
    user: null,
    _client: null,
    _onChange: null,
  };
  window.Cloud = Cloud;

  if (!enabled) return; // mode local : rien à faire

  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  Cloud._client = sb;

  /* ---- Auth (lien magique par e-mail) ---- */
  Cloud.onAuthChange = (cb) => { Cloud._onChange = cb; };

  sb.auth.onAuthStateChange((_evt, session) => {
    Cloud.user = session?.user || null;
    if (Cloud._onChange) Cloud._onChange(Cloud.user);
  });

  Cloud.init = async () => {
    const { data } = await sb.auth.getSession();
    Cloud.user = data.session?.user || null;
    return Cloud.user;
  };

  Cloud.signIn = async (email) => {
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.href.split("#")[0] },
    });
    if (error) throw error;
  };

  Cloud.signOut = async () => { await sb.auth.signOut(); };

  /* ---- Critères (recherche) côté serveur ---- */
  Cloud.loadCriteria = async () => {
    if (!Cloud.user) return null;
    const { data, error } = await sb
      .from("searches").select("criteria").eq("user_id", Cloud.user.id)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (error) { console.warn("loadCriteria", error.message); return null; }
    return data?.criteria || null;
  };

  Cloud.saveCriteria = async (criteria) => {
    if (!Cloud.user) return;
    // une seule recherche par utilisateur : on remplace.
    const { data: existing } = await sb
      .from("searches").select("id").eq("user_id", Cloud.user.id).limit(1).maybeSingle();
    const row = {
      user_id: Cloud.user.id, criteria, active: true, updated_at: new Date().toISOString(),
      label: (criteria.villes && criteria.villes[0]) ? `Recherche ${criteria.villes[0]}` : "Ma recherche",
    };
    if (existing?.id) {
      const { error } = await sb.from("searches").update(row).eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await sb.from("searches").insert(row);
      if (error) throw error;
    }
  };

  /* ---- Web Push ---- */
  const urlB64ToUint8 = (b64) => {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  };

  Cloud.enablePush = async () => {
    if (!Cloud.user) throw new Error("Connectez-vous d'abord.");
    if (!("serviceWorker" in navigator) || !("PushManager" in window))
      throw new Error("Notifications non supportées par ce navigateur.");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Autorisation refusée.");

    const reg = await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8(cfg.VAPID_PUBLIC_KEY),
    });
    const json = sub.toJSON();
    const { error } = await sb.from("push_subscriptions").upsert({
      user_id: Cloud.user.id,
      endpoint: json.endpoint,
      keys: json.keys,
    }, { onConflict: "endpoint" });
    if (error) throw error;
  };

  Cloud.pushStatus = async () => {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    return Boolean(sub);
  };
})();
