# Architecture

```
navigateur ──► KTEC (Node, 127.0.0.1:47700)
                 │   /                    portail (tuiles des applications)
                 │   /birtec/, /pdrtec/…  coquille commune + écrans de l'application
                 │   /api/ktec/…          routes communes (état, connexion MySQL, réglages)
                 │   /api/<appli>/…       routes de chaque application
                 │
                 ├──► llama.cpp (IA, une seule pour toutes les applications)
                 ├──► fichier .ktec (SQLite : connaissances du site, communes)
                 └──► java Moteur <commande> ──► MySQL (lecture seule)
                                            └──► moteur BIRT (rapports)
```

## Sur le poste

```
KTEC/                      (dossier d'installation, dans le profil de l'utilisateur)
  serveur/ interface/ moteur-java/    le socle (ce dépôt)
  apps/<id>/                          une application par dossier (paquet <id>.zip de son dépôt)
  moteur/                             Node, llama.cpp, Java, BIRT : partagés
  installation.json                   ce qui est installé et où (écrit par l'installation)
  reglages-poste.json                 connexion MySQL sans mot de passe, dossier de travail, fichier .ktec
  journal.txt, cache/
Documents/KTEC/            (dossier de travail)
  connaissances.ktec                  les connaissances du site
  rapports/                           rapports créés par BiRTEC
```

## Le socle

- **Applications** (`serveur/socle/applis.js`) : chaque dossier de `apps/` (et de `applisDev` en développement) qui a un
  `app.json` est une application. Ses blocs sont chargés au démarrage ; leurs routes `/api/…` sont rangées sous
  `/api/<id>/…` (`pourAppli` dans `http.js`). Le code serveur d'une application importe le socle par `ktec/…`,
  traduit en chemin vers `serveur/socle/` (crochet de résolution de Node).
- **Serveur web** (`serveur/socle/http.js`) : sur ce poste uniquement (127.0.0.1). Toute requête qui modifie quelque
  chose doit porter l'en-tête `X-KTEC` (parade contre les autres sites ouverts dans le navigateur). Seuls les fichiers
  `vue.js` et `.css` des blocs et le dossier `interface/` des applications sont envoyés au navigateur.
- **Coquille commune** (`interface/appli.js`) : menu, barre du haut (IA, connexion MySQL, aide), écran du bloc choisi.
  Elle charge `/apps/<id>/interface/menu.js`, qui donne la liste des écrans de l'application.
- **Appels à l'API** (`interface/socle/api.js`) : dans une application, `api('/api/schema')` part vers
  `/api/<id>/schema` ; `adresse()` fait de même pour les liens et les `fetch` directs.
- **Connexion MySQL** (`serveur/socle/mysql.js`, `interface/socle/connexion.js`) : une seule pour tout KTEC. Le mot de
  passe est gardé en mémoire par le serveur, transmis au moteur Java par son entrée standard, jamais écrit.
- **Moteur Java** (`moteur-java/Moteur.java`) : compilé à l'installation. Connexion en lecture seule, requêtes de
  lecture uniquement (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN), 30 s au plus ; rendu et vérification des rapports BIRT.
- **Fichier .ktec partagé** (`serveur/socle/partage.js`, repris d'IASSITEC) : KTEC lit une copie locale
  (`cache/base.ktec`), remplacée dès que le fichier partagé change (contrôle toutes les 10 s). Pour écrire, il faut le
  **verrou** (`connaissances.ktec.verrou`, à côté du fichier) : un seul poste à la fois. Sans mot de passe sur le
  fichier, il est pris tout seul à la première écriture (`exigerEcriture`) ; avec, il faut le mode administrateur
  (cookie de ce navigateur, `ctx.exigerAdmin()`). Chaque écriture est publiée quelques secondes plus tard (copie sous
  un nom temporaire puis renommage) ; sauvegarde à chaque prise du verrou (`KTEC-sauvegardes`, une par heure au plus,
  5 gardées). Les applications déclarent leurs tables avec `ajouterStructure()`.
- **Connaissances** (`serveur/socle/ktec.js`) : tables communes `tables_base`, `liens`, `dictionnaire`, `liens_dico`,
  `notes`, `requetes`, `infos`, et `indicateurs`, `fichiers` (BiRTEC) ; chaque écriture passe par le verrou puis la
  publication. Au premier lancement, l'ancien `.birtec` de BiRTEC est copié en `.ktec` (l'original reste en place).
  Les tables d'AITEC (machines, interventions, documents, passages…) sont déclarées par AITEC.
- **Préférences du poste** (`serveur/socle/preferences.js`, `preferences.json`) : ce qui ne regarde que l'agent
  (disposition de la Constellation, tuiles de l'accueil), pour ne pas republier le fichier partagé à chaque geste.
- **IA** (`serveur/socle/ia.js`) : llama-server lancé à la demande, arrêté après un délai sans question ; un seul
  modèle pour toutes les applications.

Les fondations (IA, serveur web, interface) viennent d'IASSITEC, puis de BiRTEC.
