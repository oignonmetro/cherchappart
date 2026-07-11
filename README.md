# 🏠 ChercheAppart

Recherche et veille d'annonces immobilières hébergeable **gratuitement sur GitHub
Pages**. Chaque utilisateur définit **ses propres critères** ; l'outil interroge
Bien'ici **en direct depuis le navigateur**, suit les nouvelles annonces et prépare
les messages de contact. Aucun réglage n'est imposé, aucune donnée n'est partagée.

👉 **100 % statique et par-utilisateur** : les critères restent dans votre navigateur.

---

## Ce que fait l'outil

| Fonction | Fiabilité | Détail |
|---|---|---|
| **Recherche en direct (Bien'ici)** | ✅ Fonctionnelle | Le navigateur interroge l'API publique de Bien'ici (locations & ventes, agences + particuliers) avec **vos** critères. CORS ouvert → aucun serveur nécessaire |
| **Re-vérification automatique** | ✅ | Tant que l'onglet Annonces est ouvert, une recherche est relancée toutes les 3 min ; les nouveautés sont marquées « nouveau » |
| **Générateur d'URL filtrées** | ✅ Très fiable | Vos critères → URL de recherche réelles (Bien'ici, Leboncoin) |
| **Contact semi-automatique** | ✅ | Message pré-rédigé + ouverture en un clic (mailto / annonce) |
| **Veille serveur + alertes push** | ✅ Option gratuite | Backend Supabase + cron GitHub Actions : la veille tourne **en arrière-plan, par utilisateur, app fermée**, et notifie chaque nouvelle annonce. Voir [`SETUP.md`](SETUP.md) |
| **Alertes Leboncoin / PAP / SeLoger (e-mail)** | ✅ Option gratuite | Lit vos propres alertes e-mail de ces sites (par utilisateur), sans scraping — conforme aux CGU. Voir [`SETUP.md`](SETUP.md#6-option-alertes-leboncoin--pap--seloger--sans-scraping) |
| **Extension navigateur (Leboncoin/PAP/SeLoger)** | ✅ Option gratuite | Surveille vos recherches sauvegardées depuis **votre propre navigateur** (vos cookies), en complément de l'e-mail, pour une détection plus rapide. Voir [`SETUP.md`](SETUP.md#7-option-extension-navigateur--détection-quasi-instantanée) |
| **Agent local (Leboncoin/PAP/SeLoger)** | ✅ Option gratuite | Programme Node sur **votre machine** (IP résidentielle → pas de blocage anti-bot) qui surveille vos URL de recherche automatiquement (ex. horaire), sans extension. Voir [`agent/README.md`](agent/README.md) |

## Deux modes

- **Sans configuration** (par défaut) : recherche Bien'ici **en direct dans le navigateur** avec vos critères, actualisée tant que l'onglet est ouvert. Rien à installer.
- **Avec backend gratuit** (optionnel) : comptes utilisateurs (Supabase), veille **en arrière-plan** toutes les 30 min (GitHub Actions) et **notifications push** même app fermée. Tout est gratuit et sans carte bancaire → [`SETUP.md`](SETUP.md).

## Pourquoi cette architecture ?

GitHub Pages est **statique**. La clé : l'API de Bien'ici renvoie
`Access-Control-Allow-Origin: *`, donc **le navigateur de chaque visiteur peut
l'interroger directement** avec ses propres critères. Résultat : pas de serveur, pas
de fichier de critères commun, pas de données partagées entre utilisateurs.

```
Vos critères (dans VOTRE navigateur, localStorage)
        │
        ▼
  fetch() direct  ──►  API Bien'ici (suggest.json + realEstateAds.json)
        │                     (CORS: Access-Control-Allow-Origin: *)
        ▼
  Tableau de bord Annonces (le vôtre uniquement)
```

> Leboncoin, PAP et SeLoger bloquent l'accès automatisé (DataDome) : ils restent
> accessibles via les **URL de recherche filtrées** générées (onglet Recherches).

## Pourquoi pas de contact 100 % automatique ?

Envoyer des messages automatisés sur ces plateformes **enfreint leurs CGU** et
déclenche leurs anti-robots (blocage de compte). ChercheAppart fait du **contact
semi-automatique** : message pré-rempli depuis votre modèle, ouvert en un clic —
**vous validez l'envoi**.

---

## Installation

1. **Forkez / créez** ce dépôt sur votre compte GitHub.
2. **Activez GitHub Pages** : `Settings ▸ Pages ▸ Source : GitHub Actions`.
3. Ouvrez le site publié : réglez vos critères, ouvrez l'onglet **Annonces**. C'est tout.

Rien à committer ni à configurer côté serveur : la recherche se fait dans le navigateur.

## Développement local

```bash
python3 -m http.server 8000        # puis http://localhost:8000
```

## Veille côté serveur (optionnel, avancé)

Le dossier `scraper/` fournit un **outil en ligne de commande** facultatif (Python)
pour ceux qui veulent une veille en arrière-plan sur **leur propre** machine/serveur
(ex. envoi d'alertes). Il n'est pas nécessaire au fonctionnement du site.

```bash
pip install -r scraper/requirements.txt
python scraper/scrape.py --criteria scraper/criteria.example.json --out listings.json
```

L'adaptateur Bien'ici (`scraper/sites/bienici.py`) fonctionne depuis un serveur ;
Leboncoin/PAP échouent proprement (anti-bots). Pour les débloquer, branchez un proxy
résidentiel ou une API tierce dans les adaptateurs.

## Structure

```
index.html                 Interface (onglets Critères / Recherches / Annonces / À propos)
assets/css/style.css        Styles (thème clair & sombre)
assets/js/app.js            Logique : critères, recherche Bien'ici en direct, contact
assets/js/cloud.js          Compte, veille serveur, boîte e-mail, extension (optionnel)
.github/workflows/pages.yml Déploiement GitHub Pages
.github/workflows/veille.yml Veille serveur (Bien'ici + e-mail), optionnelle
backend/                    Worker de veille serveur (Node) + ingestion e-mail
supabase/schema.sql         Schéma de la base (comptes, recherches, annonces, RLS)
extension/                  Extension navigateur optionnelle (Leboncoin/PAP/SeLoger)
agent/                      Agent local optionnel (Node) : surveille les URL de recherche
scraper/                    Veille CLI optionnelle (Python) + adaptateurs par site
```

## Étendre à un nouveau site (interface)

Ajoutez une entrée dans `SITE_BUILDERS` de `assets/js/app.js` pour générer l'URL de
recherche filtrée. Pour une récupération en direct dans le tableau de bord, il faut
une API tierce autorisant le CORS (comme Bien'ici) — voir `bieniciSearch()`.

## Avertissement légal

Outil fourni à titre éducatif. Respectez les CGU et le `robots.txt` des sites, le
RGPD et la législation applicable. N'automatisez pas l'envoi de messages en
violation des conditions d'utilisation des plateformes.

## Licence

MIT.
