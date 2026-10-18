// Les préférences de ce poste (disposition de la Constellation, tuiles de l'accueil…) : propres à chaque
// agent, gardées dans preferences.json à côté de KTEC plutôt que dans le fichier .ktec partagé
// (qui serait sinon republié à chaque bulle déplacée).

import path from 'node:path'
import { RACINE, lireJson, ecrireJson } from './installation.js'

const fichier = path.join(RACINE, 'preferences.json')

// defaut peut être une fonction (ex. reprendre l'ancienne valeur rangée dans le .ktec).
export function lirePreference(cle, defaut = null) {
  const toutes = lireJson(fichier, {})
  if (cle in toutes) return toutes[cle]
  return typeof defaut === 'function' ? defaut() : defaut
}

export function ecrirePreference(cle, valeur) {
  ecrireJson(fichier, { ...lireJson(fichier, {}), [cle]: valeur })
}
