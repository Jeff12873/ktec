// Point de départ de KTEC (lancé par « Lancer KTEC.bat » ou « lancer-ktec.sh »).
//
// 1. si KTEC tourne déjà pour cet utilisateur, on ouvre simplement le navigateur ;
// 2. sinon : on charge le portail et les applications installées, et on démarre le serveur web
//    (sur ce poste uniquement) ;
// 3. on ouvre le navigateur sur le portail, http://127.0.0.1:<port>.
//
// Options : --sans-navigateur (pour les essais) ;
//           --installation (lancé par « Installer KTEC » depuis le kit ou le zip : seule la page d'installation,
//           sans ouvrir de fichier de connaissances).

import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { creerRoutes, demarrerServeur, pourAppli } from './socle/http.js'
import { chargerApplis } from './socle/applis.js'
import { routes as routesPortail } from './portail.js'
import { routes as routesInstallation } from './installation/routes.js'
import { routes as routesMessages } from './messages.js'
import { ktec } from './socle/ktec.js'
import { publierMaintenant } from './socle/partage.js'
import { arreterIA } from './socle/ia.js'
import { RACINE, WINDOWS, chemins, version, journal, lireJson, ecrireJson } from './socle/installation.js'

const modeInstallation = process.argv.includes('--installation')
// Les anciens IASSITEC (47800) et BiRTEC (47900) peuvent tourner à côté ; l'installation a ses propres ports.
const PREMIER_PORT = modeInstallation ? 47690 : 47700
const fichierServeur = path.join(chemins.cache, process.argv.includes('--installation') ? 'serveur-installation.json' : 'serveur.json')
const identifiant = crypto.createHash('sha256').update(RACINE + (modeInstallation ? ' installation' : '')).digest('hex').slice(0, 16)
const page = modeInstallation ? '/installation/' : '/'
const sansNavigateur = process.argv.includes('--sans-navigateur')

// ---- 1. déjà lancé ?
const precedent = lireJson(fichierServeur, null)
if (precedent && (await repond(precedent.port))) {
  console.log('KTEC est déjà lancé : ouverture du navigateur.')
  if (!sansNavigateur) ouvrirNavigateur(`http://127.0.0.1:${precedent.port}${page}`)
  process.exit(0)
}

// ---- 2. démarrage
journal(`Démarrage de KTEC ${version()} (${RACINE})`)
const routes = creerRoutes()
routes.get('/api/ping', () => ({ identifiant }))
routesPortail(routes)
routesInstallation(routes, { modeInstallation })
routesMessages(routes)
if (!modeInstallation) {
  await chargerApplis((id) => pourAppli(routes, id))
  // Ouvre le fichier de connaissances dès le départ (et reprend l'ancien .birtec au premier lancement).
  try {
    ktec()
  } catch (erreur) {
    journal(`Fichier de connaissances inaccessible : ${erreur.message}`)
  }
}

const port = await demarrerSurUnPortLibre()
ecrireJson(fichierServeur, { port, pid: process.pid })
const adresse = `http://127.0.0.1:${port}${page}`
journal(`KTEC prêt : ${adresse}`)
console.log(`\n  KTEC est ouvert dans votre navigateur : ${adresse}\n  Fermer cette fenêtre arrête KTEC.\n`)
if (!sansNavigateur) ouvrirNavigateur(adresse)

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    publierMaintenant() // les dernières modifications du fichier .ktec partent avant l'arrêt
    arreterIA()
    process.exit(0)
  })
}

// ---------------------------------------------------------------- outils

async function demarrerSurUnPortLibre() {
  for (let p = PREMIER_PORT; p < PREMIER_PORT + 100; p++) {
    try {
      await demarrerServeur(routes, p)
      return p
    } catch (erreur) {
      if (erreur.code !== 'EADDRINUSE') throw erreur
    }
  }
  throw new Error(`Aucun port libre entre ${PREMIER_PORT} et ${PREMIER_PORT + 99}`)
}

async function repond(port) {
  try {
    const reponse = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(1500) })
    return (await reponse.json()).identifiant === identifiant
  } catch {
    return false
  }
}

function ouvrirNavigateur(adresse) {
  const [commande, args] = WINDOWS ? ['cmd', ['/c', 'start', '', adresse]] : ['xdg-open', [adresse]]
  try {
    spawn(commande, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch {
    console.log(`Ouvrez ce lien dans votre navigateur : ${adresse}`)
  }
}
