# Agent local ChercheAppart (Leboncoin / PAP / SeLoger)

Ces sites bloquent tout accès automatisé depuis un **serveur** (DataDome bloque les
IP de datacenter). La seule façon **gratuite** de les surveiller est de le faire
depuis **votre propre machine** (votre IP résidentielle), avec un vrai navigateur.

Cet agent n'est **pas** une extension Chrome : c'est un petit script Node,
planifiable, qui :

1. ouvre chacune de vos **URL de recherche** (générées dans l'onglet « Recherches »
   du site) dans un navigateur ;
2. lit la **1re page** de résultats ;
3. pousse les nouvelles annonces dans Supabase → vous recevez le **même push**
   que Bien'ici (via le worker serveur, sous ≤ 30 min).

---

## Installation (une fois)

Prérequis : **Node.js 18+** (https://nodejs.org). Google Chrome installé est un plus
(meilleure résistance à l'anti-bot).

```bash
cd agent
npm install
npx playwright install chromium     # télécharge le navigateur (si Chrome absent)
cp .env.example .env                 # puis éditez .env
cp config.example.json config.json   # puis collez-y vos URL de recherche
```

- **`.env`** : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (clé secrète, Project
  Settings ▸ API Keys), `OWNER_EMAIL` (votre e-mail de connexion au site).
- **`config.json`** : la liste de vos URL de recherche (onglet « Recherches » ▸
  bouton « Ouvrir » ▸ copiez l'URL de la barre d'adresse).

### Vérifier que ça marche

```bash
npm run dry-run        # n'écrit rien, affiche les annonces détectées
```

- Si vous voyez des annonces listées → parfait, passez à la planification.
- Si vous voyez `BLOQUÉ (anti-bot)` → mettez `HEADLESS=false` dans `.env`
  (une fenêtre s'ouvrira brièvement) et/ou installez Google Chrome, puis réessayez.

Un vrai enregistrement :

```bash
npm start
```

---

## Planifier (toutes les heures, automatique)

### Windows — Planificateur de tâches
1. Ouvrez **Planificateur de tâches** ▸ **Créer une tâche de base**.
2. Déclencheur : **Quotidien**, puis dans l'onglet Déclencheurs, **Répéter toutes
   les 1 heure** pendant « indéfiniment ».
3. Action : **Démarrer un programme**
   - Programme : `node`
   - Arguments : `agent.mjs`
   - Démarrer dans : le chemin complet du dossier `agent`.
4. (Optionnel) cochez « Exécuter même si l'utilisateur n'est pas connecté ».

### macOS / Linux — cron
```bash
crontab -e
# ajoutez (adaptez le chemin) : toutes les heures
0 * * * * cd /chemin/vers/agent && /usr/bin/node agent.mjs >> agent.log 2>&1
```

---

## Notes

- **Gratuit** : aucune API payante, aucun proxy. C'est votre connexion qui fait le
  travail.
- **Confidentialité** : `.env`, `config.json` et le profil navigateur (`.userdata/`)
  restent sur votre machine (ignorés par git).
- **Robustesse** : le profil navigateur est **persistant** — une fois le challenge
  anti-bot résolu, les exécutions suivantes sont plus fluides. En cas de blocage
  persistant, `HEADLESS=false` + Google Chrome installé donnent le meilleur taux de
  réussite (comportement d'un vrai utilisateur).
- **Conformité** : vous consultez vos propres recherches depuis votre navigateur, à
  faible fréquence. Respectez les CGU des sites et n'augmentez pas la cadence.
