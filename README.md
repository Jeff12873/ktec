# KTEC

Le portail et le socle commun des applications de l'atelier :

| Application | Rôle | Dépôt |
|---|---|---|
| **BiRTEC** | Rapports BIRT et indicateurs ITM, construits par formulaire sur la base de la GMAO | [birtec](https://github.com/Jeff12873/birtec) |
| **PDRTec** | Recherche de pièces de rechange (caractéristiques, emplacement, photo), en direct sur la base | [pdrtec](https://github.com/Jeff12873/pdrtec) |
| **AITEC** | L'assistant IA de l'atelier (ex IASSITEC) | à venir |

- **Un seul lanceur** (`Lancer KTEC.bat`, `lancer-ktec.sh`) ouvre le portail dans le navigateur : une tuile par
  application installée. On passe d'une application à l'autre par le bas du menu.
- **Rien en double** : le moteur d'IA et son modèle, Java, le moteur BIRT et le pilote MySQL sont installés une fois
  et partagés par toutes les applications.
- **Une seule connexion MySQL**, en lecture seule : le mot de passe est demandé une fois pour toutes les applications,
  gardé en mémoire, jamais enregistré.
- **Un seul fichier de connaissances `.ktec`** : la structure de la base, le dictionnaire, les liens, les conventions et
  les réglages de chaque application. Le programme est une « coquille vide » : aucune donnée de site dans ce dépôt.
- Windows et Linux, installé dans le profil de l'utilisateur (aucun droit d'administrateur), IA locale (llama.cpp) :
  rien ne sort de l'entreprise.

## Installer

L'installateur (page dans le thème, paquets en ligne ou hors ligne sur clé USB, installation silencieuse dans le
dossier choisi, mises à jour et désinstallation) est en préparation.

## Développer

Aucune dépendance npm, aucune compilation côté Node : seulement Node 24.

```sh
node serveur/demarrer.js        # lance KTEC : http://127.0.0.1:47700
```

Les applications installées sont dans `apps/<id>/`. En développement, on peut charger une application depuis son
propre dossier, sans la copier, avec `reglages-poste.json` :

```json
{ "applisDev": ["/chemin/vers/BiRTEC"] }
```

| Dossier | Contenu |
|---|---|
| `serveur/demarrer.js` | Point de départ : portail, applications, port |
| `serveur/portail.js` | Routes communes (`/api/ktec/…`) : état, applications, connexion MySQL, réglages du poste |
| `serveur/socle/` | Serveur web (`http.js`), applications (`applis.js`), fichier .ktec (`ktec.js`), IA (`ia.js`), MySQL (`mysql.js`), réglages (`installation.js`), zip, téléchargements |
| `moteur-java/Moteur.java` | Le programme Java : connexion MySQL, structure, requêtes en lecture seule, moteur BIRT |
| `interface/` | Portail (`index.html`, `portail.js`, bouton « Réglages »), coquille des applications (`appli.html`, `appli.js`), thème commun, outils d’écran (`socle/` : API, connexion MySQL, réglages communs…) |

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) et [docs/AJOUTER-UNE-APPLICATION.md](docs/AJOUTER-UNE-APPLICATION.md).

## Composants tiers

llama.cpp (MIT), modèles Qwen (Apache 2.0), Eclipse Temurin (GPLv2 + exception Classpath), Eclipse BIRT (EPL 2.0),
MySQL Connector/J (GPLv2 + exception FOSS) : installés sur le poste, jamais inclus dans ce dépôt.
Tracés d'icônes Lucide (ISC).
