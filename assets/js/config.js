/* ChercheAppart — configuration publique (sûre à publier).
 *
 * Renseignez ces 3 valeurs après avoir créé votre projet Supabase (gratuit,
 * sans carte). Tant que SUPABASE_URL vaut "", le site fonctionne en mode local
 * (recherche en direct dans le navigateur) sans compte ni notifications.
 *
 *   SUPABASE_URL       : Supabase ▸ Project Settings ▸ Data API ▸ Project URL
 *   SUPABASE_ANON_KEY  : Supabase ▸ Project Settings ▸ API Keys ▸ anon public
 *                        (clé PUBLIQUE, conçue pour le navigateur — RLS protège les données)
 *   VAPID_PUBLIC_KEY   : clé publique Web Push (déjà pré-remplie ; à garder identique
 *                        à VAPID_PUBLIC_KEY côté secrets GitHub)
 */
window.CHERCHEAPPART_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  VAPID_PUBLIC_KEY: "BKJNwAa7Cm1_8MmqE_6m1zu0Ey8jzKNdtuEyEy6XhZktx5wViOI6f8oiOaPdcUBDhsoQKUvSfDcEnK4UuaoeelI",
};
