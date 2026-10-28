# Ajouter une application à KTEC

Une application est un dossier (en général son propre dépôt GitHub) :

```
monappli/
  app.json              description pour le portail
  VERSION
  package.json          { "type": "module" }
  interface/
    menu.js             liste des écrans (chargé par la coquille commune)
    icone.svg
    app.css             styles propres (facultatif)
    aide/*.html         pages d'aide (facultatif)
  blocs/<écran>/
    serveur.js          export function routes(r) { r.get('/api/…', …) }
    vue.js              export default { chemin, titre, icone, menu, groupe, aide, afficher(zone, { id, query }) }
```

## app.json

```json
{
  "id": "monappli",
  "nom": "MonAppli",
  "sousTitre": "Ce qu'elle fait en trois mots",
  "description": "Une phrase pour la tuile du portail.",
  "icone": "interface/icone.svg",
  "besoins": ["java", "ia"]
}
```

`id` : minuscules, chiffres et tirets ; c'est aussi l'adresse de l'application (`/monappli/`) et le préfixe de ses
routes (`/api/monappli/…`). `besoins` : composants communs nécessaires (`java`, `birt`, `ia`), installés une seule
fois par KTEC.

## interface/menu.js

```js
import accueil from '../blocs/accueil/vue.js'
import reglages from '../blocs/reglages/vue.js'

export const blocs = [accueil, reglages]   // ordre du menu
export { accueil }                          // écran par défaut
export const styles = 'interface/app.css'   // facultatif
export function auDemarrage(etat) {}        // facultatif : ex. vérifier la connexion à la GMAO
```

## Côté serveur

Les blocs importent le socle commun par `ktec/…` :

```js
import { ErreurHttp } from 'ktec/http.js'
import { lireInfo, ecrireInfo } from 'ktec/ktec.js'      // fichier .ktec (réglages : clés « monappli.… »)
import { db, ajouterStructure, noterModification } from 'ktec/partage.js' // ses propres tables
import { executerRequete, etatConnexion } from 'ktec/mysql.js'
import { discuter } from 'ktec/ia.js'
```

Ses propres tables : `ajouterStructure((db) => db.exec('CREATE TABLE IF NOT EXISTS …'))`. Toute écriture directe
commence par `ctx.exigerAdmin()` (verrou du fichier partagé) et se termine par `noterModification()` (publication) ;
`ecrireInfo` et les autres fonctions de `ktec.js` le font d'elles-mêmes.

Droits (KTEC 0.6) : les réglages, le SQL et l'écriture dans la GMAO sont réservés à l'administrateur
(`ctx.exigerModeAdmin()`, `ctx.modeAdmin` ; à l'écran `etat.modeAdmin`). Un écran de réglages se déclare
`menu: 'admin'` (au menu en mode administrateur seulement) ou `admin: true` (hors menu, mais réservé). Une écriture
permise aussi en consultation (résultat d'une analyse lancée par un utilisateur) appelle
`exigerEcriture({ pourTous: true })`. Les requêtes passent par le compte de lecture (`executerRequete`), les
écritures dans la GMAO par le compte d'écriture (`ecrireDansLaBase`, en mode administrateur seulement).

## Côté écran

```js
import { h, vider, ic, notifier } from '/socle/ui.js'
import { api, adresse } from '/socle/api.js'   // api('/api/x') → /api/monappli/x
import { etat, peutModifier } from '/socle/etat.js' // état commun : IA, connexion MySQL, fichier .ktec ; ce poste peut-il modifier ?
import { demanderMotDePasse } from '/socle/connexion.js'
import autre from '../autre/vue.js'           // entre blocs de la même application : chemins relatifs
```

## Essayer

Dans le `reglages-poste.json` de KTEC : `"applisDev": ["/chemin/vers/monappli"]`, puis relancer KTEC.
