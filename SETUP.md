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

## 6. (Option) Alertes Leboncoin / PAP / SeLoger — sans scraping

Ces sites bloquent le scraping (DataDome). La solution gratuite et conforme :
**lire leurs propres e-mails d'alerte** et les convertir en push unifié.

Contrairement au reste de la configuration, **cette étape ne se fait PAS dans
des secrets GitHub** : chaque utilisateur renseigne **sa propre boîte** depuis
le site (table `email_sources`, protégée par RLS — personne d'autre que vous
et le worker n'y a accès). Rien à toucher côté dépôt.

1. **Créez une adresse e-mail dédiée** (ex. Gmail `mes-alertes-immo@gmail.com`)
   que vous ne lirez pas — elle sert de tuyau.
2. Activez un **mot de passe d'application** : compte Google ▸ Sécurité ▸
   validation en 2 étapes (obligatoire) ▸ **Mots de passe des applications** →
   créez-en un (16 caractères). **N'utilisez jamais votre mot de passe principal.**
3. Sur **Leboncoin, PAP, SeLoger** : faites votre recherche avec vos critères →
   **enregistrez-la / créez une alerte e-mail** vers cette adresse dédiée.
4. Sur le site ChercheAppart, connecté, dans la carte **📧 Alertes Leboncoin /
   PAP / SeLoger** : renseignez l'adresse et le mot de passe d'application →
   **Enregistrer la boîte**.

À chaque passage (30 min), le worker lit — pour **chaque utilisateur** qui a
configuré une boîte — les e-mails d'alerte non lus, en extrait les annonces,
les dédoublonne et envoie le **même push** que Bien'ici. Les e-mails lus sont
marqués comme tels ; vous n'avez jamais besoin d'ouvrir cette boîte vous-même.

## 7. (Option) Extension navigateur — détection quasi instantanée

Complément de l'e-mail : une extension qui tourne dans **votre propre navigateur**
(vos cookies, votre IP) surveille vos recherches sauvegardées Leboncoin/PAP/SeLoger
à intervalle court (15 min par défaut, réglable). Comme c'est une navigation
normale de votre part, DataDome n'a aucune raison de la bloquer — contrairement à
un serveur. Gratuit, aucune installation de dépendance.

**⚠️ Note de transparence :** l'algorithme d'extraction est générique et tolérant
(repère les liens de fiche-annonce par motif d'URL, comme pour les e-mails) et a
été testé sur des pages construites pour simuler une liste d'annonces. Il n'a pas
pu être validé contre le HTML réel de Leboncoin/SeLoger/PAP depuis cet
environnement (ces sites bloquent aussi les requêtes sortantes d'ici). Un premier
essai réel de votre part permettra d'ajuster si besoin — voir « Vérifier » ci-dessous.

### Installation (extension non publiée : mode développeur)

1. Ouvrez `chrome://extensions` (ou `edge://extensions`) → activez **Mode développeur**
   (interrupteur en haut à droite).
2. **Charger l'extension non empaquetée** → sélectionnez le dossier
   [`extension/`](extension) de ce dépôt (téléchargez-le ou clonez le dépôt localement).
3. Ouvrez le site ChercheAppart, connectez-vous, puis dans la carte Compte :
   **🧩 Connecter l'extension** (le statut passe à « Extension détectée » puis
   « Extension connectée »).
4. Clic droit sur l'icône de l'extension → **Options** (ou `chrome://extensions` →
   Détails → Options) :
   - Sur Leboncoin/PAP/SeLoger, faites votre recherche filtrée, **sauvegardez-la**,
     copiez son URL, collez-la dans « Recherches surveillées ».
   - Réglez la fréquence (15 min par défaut).

### Vérifier que ça fonctionne

Ouvrez `chrome://extensions` → votre extension → **service worker** (lien
« Inspecter les vues ») pour voir les logs, ou ouvrez la console (F12) sur une
page Leboncoin/PAP/SeLoger : vous devez voir `ChercheAppart (site): N annonce(s)
détectée(s)`. Si vous voyez `0 annonce détectée` sur une vraie page de résultats,
dites-le-moi avec une capture — j'ajusterai l'extraction.

Comme pour les e-mails, les annonces détectées apparaissent au prochain passage
du serveur (≤ 30 min) sous forme de notification push (la clé d'envoi reste
côté serveur, jamais dans l'extension).

## Notes

- **iOS** : le Web Push exige d'**ajouter le site à l'écran d'accueil** (Safari ▸ Partager
  ▸ Sur l'écran d'accueil), puis d'activer les alertes depuis l'app installée.
- **Coût** : tout est dans les paliers gratuits (Supabase Free, Actions gratuit pour dépôt
  public, Web Push gratuit). Aucune carte bancaire.
- **Sources** : la veille interroge **Bien'ici** (agences + particuliers) automatiquement.
  Leboncoin / PAP / SeLoger sont couverts par l'e-mail et/ou l'extension (options 6-7),
  ou disponibles via les URL de recherche filtrées de l'onglet **Recherches**.
