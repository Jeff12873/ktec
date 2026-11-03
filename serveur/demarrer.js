// Point de départ de K.NOVA (lancé par serveur/lanceur.js sous Windows, sans console, ou par « lancer-ktec.sh »).
//
// 1. si K.NOVA tourne déjà pour cet utilisateur, on ouvre simplement sa fenêtre ;
// 2. sinon : on charge le portail et les applications installées, et on démarre le serveur web
//    (sur ce poste uniquement) ;
// 3. on ouvre la fenêtre de K.NOVA sur le portail, http://127.0.0.1:<port> ;
// 4. quand plus aucune fenêtre n'est ouverte, K.NOVA s'arrête tout seul.
//
// Options : --sans-navigateur (pour les essais) ;
//           --installation (lancé par « Installer KTEC » depuis le kit ou le zip : seule la page d'installation,
//           sans ouvrir de fichier de connaissances).

import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { creerRoutes, demarrerServeur, pourAppli } from './socle/http.js'
import { chargerApplis } from './socle/applis.js'
import { routes as routesPortail, presence } from './portail.js'
import { routes as routesInstallation } from './installation/routes.js'
import { routes as routesMessages } from './messages.js'
import { routes as routesRequeteur } from './requeteur.js'
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
const enMarche = precedent && (await repond(precedent.port))
if (enMarche) {
  console.log('K.NOVA est déjà lancé : ouverture de sa fenêtre.')
  // Aucune page ouverte depuis 10 s (fenêtre restée noire ou fermée) : le navigateur habituel, plus sûr.
  const sansFenetre = Date.now() - (enMarche.presence || 0) > 10_000
  if (!sansNavigateur) ouvrirNavigateur(`http://127.0.0.1:${precedent.port}${page}`, { habituel: sansFenetre })
  process.exit(0)
}

// ---- 2. démarrage
journal(`Démarrage de K.NOVA ${version()} (${RACINE})`)
const routes = creerRoutes()
routes.get('/api/ping', () => ({ identifiant, presence: presence.derniere }))
routesPortail(routes)
routesInstallation(routes, { modeInstallation })
routesMessages(routes)
routesRequeteur(routes)
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
journal(`K.NOVA prêt : ${adresse}`)
console.log(`\n  K.NOVA est ouvert : ${adresse}\n`)
if (modeInstallation) console.log(`  Si la page ne s'affiche pas, ouvrez cette adresse dans votre navigateur.\n`)
if (!sansNavigateur) {
  const ouvertLe = Date.now()
  ouvrirNavigateur(adresse)
  // La fenêtre de K.NOVA (Edge en mode « app », profil à part) peut rester noire ou ne pas s'ouvrir sur un poste
  // verrouillé : sans aucun signe de sa page au bout de 15 s, K.NOVA s'ouvre dans le navigateur habituel.
  if (!modeInstallation) {
    setTimeout(() => {
      if (presence.derniere > ouvertLe) return
      journal('Aucune fenêtre de K.NOVA au bout de 15 s : ouverture dans le navigateur habituel')
      ouvrirNavigateur(adresse, { habituel: true })
    }, 15_000).unref()
  }
}

// Plus aucune fenêtre ouverte depuis 3 minutes : K.NOVA s'arrête proprement (il tourne sans console, rien
// d'autre ne permettrait de le fermer). Une fenêtre réduite donne encore signe de vie au moins une fois par minute.
if (!sansNavigateur && !modeInstallation) {
  setInterval(() => {
    if (Date.now() - presence.derniere < 3 * 60_000) return
    journal('Plus aucune fenêtre de K.NOVA ouverte : arrêt')
    publierMaintenant()
    arreterIA()
    process.exit(0)
  }, 30_000).unref()
}

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
    const r = await reponse.json()
    return r.identifiant === identifiant ? r : false
  } catch {
    return false
  }
}

// K.NOVA s'ouvre dans sa propre fenêtre, comme une application : Edge (ou Chrome, Chromium) en mode « app »,
// sans onglets ni barre d'adresse, avec un profil à lui (cache/fenetre) pour ne pas se mêler au navigateur
// de l'utilisateur. Sans l'un d'eux : le navigateur par défaut.
// Sous Windows, K.NOVA (et son installation) s'ouvre dans un onglet du navigateur habituel : sur les postes
// verrouillés, la fenêtre « app » à profil séparé reste noire. Ailleurs, la fenêtre à part est gardée.
function ouvrirNavigateur(adresse, { habituel = false } = {}) {
  const fenetre = modeInstallation || habituel || WINDOWS ? null : navigateurApp()
  try {
    if (fenetre) {
      const profil = path.join(chemins.cache, 'fenetre')
      spawn(fenetre, [`--app=${adresse}`, `--user-data-dir=${profil}`, '--no-first-run', '--no-default-browser-check', '--window-size=1400,900'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
      return
    }
    const [commande, args] = WINDOWS ? ['cmd', ['/c', 'start', '', adresse]] : ['xdg-open', [adresse]]
    spawn(commande, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch {
    console.log(`Ouvrez ce lien dans votre navigateur : ${adresse}`)
  }
}

function navigateurApp() {
  if (WINDOWS) {
    const bases = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean)
    const candidats = bases.flatMap((b) => [path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe')])
    return candidats.find((f) => fs.existsSync(f)) || null
  }
  for (const nom of ['microsoft-edge', 'google-chrome', 'chromium', 'chromium-browser']) {
    for (const dossier of (process.env.PATH || '').split(path.delimiter)) {
      if (dossier && fs.existsSync(path.join(dossier, nom))) return path.join(dossier, nom)
    }
  }
  return null
}
