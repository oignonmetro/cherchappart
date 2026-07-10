# Activation de la veille serveur (100 % gratuit)

Le site fonctionne déjà sans rien (recherche en direct dans le navigateur).
Ces étapes ajoutent la **veille en arrière-plan par utilisateur + les alertes push**,
en restant **entièrement gratuit et sans carte bancaire**.

Durée : ~15 min. Trois briques gratuites : **Supabase** (base + comptes),
**GitHub Actions** (le cron), **Web Push** (les notifications).

---

## 1. Créer le projet Supabase (gratuit, sans CB)

1. Compte sur https://supabase.com → **New project** (plan **Free**).
2. Notez le mot de passe de la base (pas indispensable ici).
3. **SQL Editor** → collez tout le contenu de [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
4. **Authentication ▸ Providers ▸ Email** : laissez activé (lien magique).
   - Optionnel : **Authentication ▸ URL Configuration ▸ Site URL** =
     `https://VOTRE-USER.github.io/cherchappart/` (pour la redirection du lien).

## 2. Renseigner la config publique du site

Dans **Project Settings ▸ Data API**, copiez **Project URL** et la clé **anon public**
(clé publique, prévue pour le navigateur — les données restent protégées par RLS).

Éditez [`assets/js/config.js`](assets/js/config.js) :

```js
window.CHERCHEAPPART_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...",           // clé anon public
  VAPID_PUBLIC_KEY: "BKJNwAa7Cm1_...",   // déjà pré-remplie (ne pas changer)
};
```

Commit + push → la carte **« Veille en arrière-plan + alertes »** apparaît sur le site.

## 3. Configurer les secrets GitHub (pour le cron)

Dépôt ▸ **Settings ▸ Secrets and variables ▸ Actions ▸ New repository secret** :

| Secret | Valeur |
|---|---|
| `SUPABASE_URL` | même URL qu'à l'étape 2 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase ▸ Project Settings ▸ API Keys ▸ **service_role** (⚠️ secret, jamais dans le code) |
| `VAPID_PUBLIC_KEY` | fournie séparément (identique à `config.js`) |
| `VAPID_PRIVATE_KEY` | fournie séparément (⚠️ secrète) |
| `VAPID_SUBJECT` | `mailto:votre@email.fr` |

> Les clés VAPID ont été générées pour vous. Régénérables à tout moment :
> `cd backend && npm i && node -e "console.log(require('web-push').generateVAPIDKeys())"`

## 4. C'est actif

- Le workflow **« Veille des annonces (serveur) »** tourne **toutes les 30 min**
  (Actions ▸ Run workflow pour un test immédiat).
- Sur le site : **connectez-vous** (lien e-mail), réglez vos critères (**Enregistrer**
  les pousse côté serveur), puis **🔔 Activer les alertes**.
- À chaque nouvelle annonce correspondant à VOS critères, vous recevez une
  **notification push** — même application fermée.

---

## Notes

- **iOS** : le Web Push exige d'**ajouter le site à l'écran d'accueil** (Safari ▸ Partager
  ▸ Sur l'écran d'accueil), puis d'activer les alertes depuis l'app installée.
- **Coût** : tout est dans les paliers gratuits (Supabase Free, Actions gratuit pour dépôt
  public, Web Push gratuit). Aucune carte bancaire.
- **Sources** : la veille interroge **Bien'ici** (agences + particuliers). Leboncoin /
  SeLoger restent hors veille automatique (anti-bots) — disponibles via les URL de
  recherche filtrées de l'onglet **Recherches**.
