# KTEC

Le portail et le socle commun des applications de l'atelier :

| Application | Rôle | Dépôt |
|---|---|---|
| **BiRTEC** | Rapports BIRT et indicateurs ITM, construits par formulaire sur la base de la GMAO | [birtec](https://github.com/Jeff12873/birtec) |
| **PDRTec** | Recherche de pièces de rechange (caractéristiques, emplacement, photo), en direct sur la base | [pdrtec](https://github.com/Jeff12873/pdrtec) |
| **AITEC** | L'assistant IA de l'atelier (ex IASSITEC) : parc et interventions synchronisés avec la GMAO, documents | [aitec](https://github.com/Jeff12873/aitec) |

- **Un seul lanceur** (`Lancer KTEC.bat`, `lancer-ktec.sh`) ouvre le portail dans le navigateur : une tuile par
  application installée. On passe d'une application à l'autre par le bas du menu.
- **Rien en double** : le moteur d'IA et son modèle, Java, le moteur BIRT et le pilote MySQL sont installés une fois
  et partagés par toutes les applications.
- **Une seule connexion MySQL**, en lecture seule : le mot de passe est demandé une fois pour toutes les applications,
  gardé en mémoire, jamais enregistré.
- **Un seul fichier de connaissances `.ktec`** : la structure de la base, le dictionnaire, les liens, les conventions,
  les données et réglages de chaque application. Placé sur un lecteur réseau, il est **partagé** : chaque poste
  travaille sur une copie, un seul modifie à la fois (verrou, pris tout seul si le fichier n'a pas de mot de passe,
  mode administrateur sinon), publication automatique, sauvegardes. Le programme est une « coquille vide » : aucune
  donnée de site dans ce dépôt.
- Windows et Linux, installé dans le profil de l'utilisateur (aucun droit d'administrateur), IA locale (llama.cpp) :
  rien ne sort de l'entreprise.

## Installer

- **Avec Internet** : télécharger [KTEC.zip](https://github.com/Jeff12873/ktec/releases/latest/download/KTEC.zip),
  le décompresser, lancer **`Installer KTEC.bat`** (Windows) ou `sh installer-ktec.sh` (Linux).
- **Sans Internet** : le kit hors ligne (un gros zip, fabriqué par `node outils/fabriquer-kit.js`), décompressé,
  puis **`Installer KTEC.bat`**.

Une page s'ouvre dans le navigateur : on coche les applications, on choisit le dossier et le modèle d'IA, et tout
s'installe en silence, une seule fois pour les composants communs. La même page sert ensuite aux mises à jour et
à la désinstallation (portail › « Installation et mises à jour »). Détails : [docs/INSTALLATION.md](docs/INSTALLATION.md).

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
| `serveur/socle/` | Serveur web (`http.js`), applications (`applis.js`), fichier partagé (`partage.js` : copie, verrou, publication, mode administrateur), connaissances (`ktec.js`), préférences du poste (`preferences.js`), IA (`ia.js`), MySQL (`mysql.js`), réglages (`installation.js`), zip, téléchargements |
| `moteur-java/Moteur.java` | Le programme Java : connexion MySQL, structure, requêtes en lecture seule, moteur BIRT |
| `serveur/installation/`, `interface/installation/` | L'installateur : composants communs, applications, raccourcis, mises à jour, désinstallation, et sa page |
| `outils/` | Versions des composants et modèles d'IA (`catalogue.json`), catalogue des applications (`applis.json`), fabrication du kit hors ligne (`fabriquer-kit.js`) |
| `Installer KTEC.bat`, `installer-ktec.sh` | Lanceurs de l'installation (Node du kit, ou téléchargé) |
| `interface/` | Portail (`index.html`, `portail.js`, bouton « Réglages »), coquille des applications (`appli.html`, `appli.js`), thème commun, outils d’écran (`socle/` : API, connexion MySQL, réglages communs…) |

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) et [docs/AJOUTER-UNE-APPLICATION.md](docs/AJOUTER-UNE-APPLICATION.md).

## Composants tiers

llama.cpp (MIT), modèles Qwen (Apache 2.0), Eclipse Temurin (GPLv2 + exception Classpath), Eclipse BIRT (EPL 2.0),
MySQL Connector/J (GPLv2 + exception FOSS) : installés sur le poste, jamais inclus dans ce dépôt.
Tracés d'icônes Lucide (ISC).
