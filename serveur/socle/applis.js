// Les applications installées : un dossier par application dans apps/ (ou, en développement,
// les dossiers listés dans « applisDev » des réglages du poste).
//
// Une application est décrite par son app.json :
//   { "id": "birtec", "nom": "BiRTEC", "sousTitre": "Rapports BIRT", "description": "…",
//     "icone": "interface/icone.svg", "besoins": ["java", "birt", "ia"] }
// et contient :
//   blocs/<nom>/serveur.js   → routes de l'API (rangées sous /api/<id>/…)
//   blocs/<nom>/vue.js       → écrans
//   interface/menu.js        → la liste des écrans et ce qu'il faut faire au démarrage
//   VERSION
//
// Le code serveur d'une application importe le socle commun par « ktec/… » :
//   import { ErreurHttp } from 'ktec/http.js'
// (traduit ici en chemin vers serveur/socle/, quel que soit l'endroit où l'application est installée).

import fs from 'node:fs'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { chemins, reglagesPoste, lireJson, journal } from './installation.js'

registerHooks({
  resolve(specifier, contexte, suivant) {
    if (specifier.startsWith('ktec/')) {
      return { url: pathToFileURL(path.join(chemins.socle, specifier.slice('ktec/'.length))).href, shortCircuit: true }
    }
    return suivant(specifier, contexte)
  },
})

let liste = null

// Map id → { id, nom, sousTitre, description, icone, besoins, version, dossier }
export function applis() {
  if (liste) return liste
  liste = new Map()
  const dossiers = []
  if (fs.existsSync(chemins.applis)) {
    for (const nom of fs.readdirSync(chemins.applis).sort()) dossiers.push(path.join(chemins.applis, nom))
  }
  dossiers.push(...reglagesPoste().applisDev)
  for (const dossier of dossiers) {
    const description = lireJson(path.join(dossier, 'app.json'), null)
    if (!description?.id || !/^[a-z0-9-]+$/.test(description.id)) continue
    if (liste.has(description.id)) {
      journal(`Application ${description.id} en double : ${dossier} ignoré`)
      continue
    }
    let version = 'développement'
    try {
      version = fs.readFileSync(path.join(dossier, 'VERSION'), 'utf8').trim()
    } catch {}
    liste.set(description.id, { besoins: [], ...description, version, dossier: path.resolve(dossier) })
  }
  return liste
}

// Ce que l'interface a besoin de savoir (sans le chemin des dossiers).
export function applisPubliques() {
  return [...applis().values()].map(({ dossier, ...a }) => a)
}

// Charge les routes de chaque bloc de chaque application.
export async function chargerApplis(routesDe) {
  for (const appli of applis().values()) {
    const dossierBlocs = path.join(appli.dossier, 'blocs')
    if (!fs.existsSync(dossierBlocs)) continue
    const routes = routesDe(appli.id)
    for (const nom of fs.readdirSync(dossierBlocs).sort()) {
      const fichier = path.join(dossierBlocs, nom, 'serveur.js')
      if (!fs.existsSync(fichier)) continue
      const bloc = await import(pathToFileURL(fichier).href)
      bloc.routes(routes)
    }
    journal(`Application chargée : ${appli.nom} ${appli.version} (${appli.dossier})`)
  }
}
