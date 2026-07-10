# Extension ChercheAppart (Leboncoin/PAP/SeLoger)

Voir [`SETUP.md`](../SETUP.md#7-option-extension-navigateur--détection-quasi-instantanée)
pour l'installation et l'utilisation.

## Maintenance

`background.js` contient deux constantes en dur, à mettre à jour si vous forkez
ce dépôt vers un autre projet Supabase :

```js
const SUPABASE_URL = "https://plxzievikemytnssnqxm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_...";
```

`manifest.json` déclare aussi ces hôtes en dur dans `host_permissions` (Supabase
+ `https://oignonmetro.github.io/*` pour le handshake de session) : à adapter de
la même façon si vous changez de domaine ou de projet Supabase.

## Comment ça marche

- `background.js` (service worker) : programme une alarme périodique, ouvre en
  arrière-plan les recherches sauvegardées, reçoit les annonces détectées,
  gère la session Supabase (rafraîchissement de jeton inclus), envoie les
  annonces via l'API REST de Supabase (pas de SDK, juste `fetch`).
- `content-watch.js` : injecté sur Leboncoin/PAP/SeLoger, extrait les annonces
  de la page (recherche de liens de fiche-annonce par motif d'identifiant
  numérique, remontée jusqu'au plus petit conteneur contenant un prix et une
  seule annonce), envoie le résultat au service worker.
- `bridge.js` : injecté sur le site ChercheAppart, relaie la session Supabase
  (envoyée par `assets/js/cloud.js` via `postMessage`) vers le service worker.
- `options.html` / `options.js` : réglages (recherches surveillées, fréquence),
  statut de connexion, bouton de vérification manuelle.
