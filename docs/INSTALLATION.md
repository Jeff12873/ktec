# Installer KTEC

Tout s'installe **dans le profil de l'utilisateur** (aucun droit d'administrateur, rien dans Program Files), par une
page dans le navigateur : choix des applications, du dossier et du modèle d'IA, puis installation silencieuse
suivie en direct. La même page sert ensuite aux mises à jour, à l'ajout et à la désinstallation d'applications
(portail › « Installation et mises à jour »).

## Avec Internet

1. Télécharger [KTEC.zip](https://github.com/Jeff12873/ktec/releases/latest/download/KTEC.zip) et le décompresser.
2. Lancer **`Installer KTEC.bat`** (Windows) ou `sh installer-ktec.sh` (Linux) : Node est téléchargé une fois dans
   le profil, puis la page d'installation s'ouvre.
3. Cocher les applications, choisir le dossier (par défaut `%LOCALAPPDATA%\KTEC` ou `~/.local/share/ktec`),
   **Installer**. Le catalogue des applications est lu sur GitHub (`outils/applis.json`) ; chaque application vient
   de la dernière Release de son dépôt (`<id>.zip`).

## Sans Internet : le kit hors ligne (un gros zip)

1. Sur un PC connecté : `node outils/fabriquer-kit.js` (options `--systeme windows|linux`, `--modeles moyen,grand`,
   `--applis-locales`, `--sans-zip`). Le kit `KTEC-hors-ligne-<système>.zip` contient le programme, Node, le moteur
   d'IA (carte graphique et processeur), Java, le moteur BIRT, le pilote MySQL, les modèles d'IA et les applications.
   Ce qui est déjà sur le PC (modèles, moteurs) est repris sans téléchargement. Format ZIP64 (fichiers de plus de
   4 Go), sans compression, lisible par l'Explorateur Windows et par `unzip`.
2. Sur le poste : décompresser le zip (clé USB ou disque), lancer **`Installer KTEC.bat`** : rien n'est téléchargé.

## Ce qui est installé, et une seule fois

```
KTEC/                          dossier choisi
  serveur/ interface/ …        le programme KTEC
  apps/<id>/                   les applications
  moteur/                      node, llama-vulkan|llama-cpu, java, birt, pilote MySQL, classes (moteur Java compilé)
  installation.json            où sont les composants (lu par KTEC)
  registre.json                versions du programme, des composants et des applications
Modèles d'IA                   dossier commun du poste (C:\Users\Public\KTEC\modeles, ou ceux d'IASSITEC/BiRTEC)
```

Seuls les composants demandés par les applications choisies (`besoins` de `outils/applis.json` : `ia`, `java`,
`birt`) et absents (ou dans une autre version) sont ajoutés. Le modèle « automatique » est choisi selon la mémoire
et la carte graphique détectée par llama.cpp.

## Mises à jour et désinstallation

- **Mettre à jour** : versions disponibles (kit, ou dernières Releases GitHub) comparées au registre ; seules les
  applications plus récentes sont remplacées (d'un coup : en cas d'erreur, l'ancienne reste). Le programme KTEC
  lui-même aussi (moteur Java recompilé) ; KTEC redémarre tout seul.
- **Mettre à jour depuis un fichier** (poste sans accès à GitHub) : `node outils/fabriquer-mise-a-jour.js` fabrique
  sur un PC connecté un petit zip (quelques Mo : le programme et les applications, sans Java, BIRT ni modèles d'IA),
  valable pour Windows et Linux. Sur le poste : « Installation et mises à jour » › **Depuis un fichier…** ; la page
  montre ce qui va changer, puis l'applique comme une mise à jour en ligne.
- **Désinstaller une application** : son dossier `apps/<id>` ; ses données dans le `.ktec` sont gardées.
- **Désinstaller KTEC** : le dossier d'installation et les raccourcis ; les modèles d'IA seulement si demandé.
  Le fichier `.ktec`, `Documents/KTEC` et les réglages hors du dossier ne sont jamais supprimés.

Code : `serveur/installation/` (composants, installateur, raccourcis, routes), `interface/installation/` (la page),
`outils/fabriquer-kit.js`, `outils/fabriquer-mise-a-jour.js`, `Installer KTEC.bat`, `installer-ktec.sh`.

## Premier lancement sur un poste : l'assistant

Au premier lancement, KTEC pose trois questions, une par écran, avec un chargement entre deux pendant qu'il vérifie :

1. **Le fichier de connaissances** : en choisir un existant (lecteur réseau, clé USB…) ou en créer un.
2. **La clé du site** : si la configuration du fichier est chiffrée, importer la clé (fichier `.ktecclef`) ; sinon,
   proposer de la chiffrer (la clé est alors créée sur ce poste et exportée aussitôt).
3. **La connexion à la base de la GMAO** : rien à faire si l'administrateur l'a déjà rangée dans le fichier ; sinon,
   serveur, base, compte de lecture et mot de passe, chiffrés dans le fichier (plus personne n'a à le taper).

Les postes réglés avant l'assistant ne le voient pas. Un poste qui ouvre un fichier chiffré sans en avoir la clé ne
voit que l'écran de la clé.

## La clé du site : configuration chiffrée, sans mot de passe

La configuration rangée dans le fichier de connaissances (connexion MySQL, adresses, requêtes, réglages des
applications) peut être chiffrée (AES-256-GCM) : Réglages › « Clé du site » › « Chiffrer la configuration ».

- La clé est créée une fois et rangée dans le fichier de connaissances lui-même, emballée par une clé propre à
  KTEC : tous les postes qui ouvrent le fichier lisent la configuration, sans rien importer. KTEC n'appelle jamais
  le système pour la protéger (ni DPAPI, ni PowerShell : rien qui ressemble à un vol de mots de passe pour
  l'antivirus de l'entreprise). Les utilisateurs ne voient jamais la configuration chiffrée, mots de passe compris.
- « Exporter la clé » donne un petit fichier `.ktecclef`, à garder en lieu sûr.
- « Exporter la configuration » donne les réglages en clair (`.ktecconf`, sans la connexion MySQL ni ses mots de
  passe) ; « Reprendre une configuration » les remet, réglage par réglage, dans un fichier de connaissances.
- Fichier chiffré avant KTEC 0.7 (clé sur le poste, protégée par Windows) : sa clé n'est pas dans le fichier.
  L'administrateur range le `.ktecclef` s'il l'a ; sinon « Nouvelle clé », puis « Reprendre une configuration »
  et la connexion à ressaisir. L'ancien `cle-site.dat` n'est plus jamais lu (il peut être supprimé).
- Sans la clé, les applications ne voient pas leurs réglages, et ne peuvent pas les écraser.
- Restent lisibles : les données du site (structure de la base, dictionnaire, interventions, documents).
