// Petit serveur web : routes de l'API et fichiers de l'interface.
//
// Chaque bloc ajoute ses routes avec routes.get('/api/…', fonction), routes.post(…), etc.
// Les routes d'une application sont rangées sous son nom : « /api/schema » de BiRTEC répond à
// « /api/birtec/schema » (voir pourAppli). Celles du portail sont sous « /api/ktec/… ».
// La fonction reçoit un « contexte » :
//   ctx.params   → morceaux variables du chemin (/api/machines/:id → ctx.params.id)
//   ctx.query    → paramètres après le « ? »
//   ctx.json()   → corps de la requête lu comme du JSON
//   ctx.octets() → corps brut (fichiers envoyés)
//   ctx.admin    → true si ce navigateur est en mode administrateur sur le fichier .ktec
//   ctx.exigerAdmin() → avant une modification du fichier .ktec : refuse si ce n'est pas permis
//                  (voir exigerEcriture dans partage.js)
// Elle renvoie un objet (envoyé en JSON) ou utilise ctx.res directement (fichiers, flux).

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { chemins, journal } from './installation.js'
import { applis } from './applis.js'
import { requeteEnCours, estAdmin, exigerEcriture, noterActiviteAdmin } from './partage.js'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.bcmap': 'application/octet-stream',
}

export class ErreurHttp extends Error {
  constructor(statut, message) {
    super(message)
    this.statut = statut
  }
}

export function creerRoutes() {
  const liste = []
  const ajouter = (methode) => (motif, action) => {
    const noms = []
    const expression = new RegExp('^' + motif.replace(/:(\w+)/g, (_, nom) => (noms.push(nom), '([^/]+)')) + '$')
    liste.push({ methode, expression, noms, action })
  }
  return { liste, get: ajouter('GET'), post: ajouter('POST'), put: ajouter('PUT'), delete: ajouter('DELETE') }
}

// Les routes vues par une application : « /api/… » devient « /api/<appli>/… ».
export function pourAppli(routes, id) {
  const prefixer = (methode) => (motif, action) => routes[methode](motif.replace(/^\/api\//, `/api/${id}/`), action)
  return { get: prefixer('get'), post: prefixer('post'), put: prefixer('put'), delete: prefixer('delete') }
}

export function demarrerServeur(routes, port) {
  const serveur = http.createServer((req, res) => traiter(routes, req, res))
  return new Promise((ok, echec) => {
    serveur.on('error', echec)
    // Uniquement sur ce poste : personne d'autre sur le réseau ne peut s'y connecter.
    serveur.listen(port, '127.0.0.1', () => ok(serveur))
  })
}

async function traiter(routes, req, res) {
  const url = new URL(req.url, 'http://localhost')
  try {
    if (url.pathname.startsWith('/api/')) {
      await traiterApi(routes, req, res, url)
    } else {
      envoyerFichierStatique(res, url.pathname)
    }
  } catch (erreur) {
    const statut = erreur.statut || 500
    if (statut === 500) journal(`Erreur ${req.method} ${url.pathname} : ${erreur.stack}`)
    if (res.headersSent) return res.end()
    envoyerJson(res, statut, { erreur: erreur.message })
  }
}

async function traiterApi(routes, req, res, url) {
  // Protection contre les autres sites web ouverts dans le navigateur de l'agent :
  // - l'adresse demandée doit être celle de ce poste (parade au « DNS rebinding ») ;
  // - toute requête qui modifie quelque chose doit porter l'en-tête X-KTEC, qu'une page
  //   d'un autre site ne peut pas ajouter sans l'accord du serveur (que l'on ne donne jamais).
  //   (X-BIRTEC est encore accepté pour les pages restées ouvertes pendant le passage à KTEC.)
  const hote = (req.headers.host || '').replace(/:\d+$/, '')
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hote)) throw new ErreurHttp(403, 'Adresse refusée')
  if (req.method !== 'GET' && req.headers['x-ktec'] !== '1' && req.headers['x-birtec'] !== '1') throw new ErreurHttp(403, 'Requête refusée')

  for (const route of routes.liste) {
    if (route.methode !== req.method) continue
    const correspondance = url.pathname.match(route.expression)
    if (!correspondance) continue

    const params = Object.fromEntries(route.noms.map((nom, i) => [nom, decodeURIComponent(correspondance[i + 1])]))
    const cookie = lireCookie(req, 'ktec_admin')
    const ctx = {
      req,
      res,
      params,
      query: Object.fromEntries(url.searchParams),
      octets: () => lireCorps(req),
      json: async () => JSON.parse((await lireCorps(req)).toString('utf8') || '{}'),
      cookie,
      admin: estAdmin(cookie),
      exigerAdmin() {
        exigerEcriture()
        noterActiviteAdmin()
      },
    }
    // Le cookie suit la requête jusqu'aux écritures (même après des await).
    const resultat = await requeteEnCours.run({ cookie }, () => route.action(ctx))
    if (!res.headersSent && !res.writableEnded) envoyerJson(res, 200, resultat ?? { ok: true })
    return
  }
  throw new ErreurHttp(404, 'Adresse inconnue : ' + url.pathname)
}

function lireCookie(req, nom) {
  const cookies = req.headers.cookie || ''
  const trouve = cookies.split(';').map((c) => c.trim().split('=')).find(([cle]) => cle === nom)
  return trouve ? trouve[1] : null
}

export function envoyerJson(res, statut, donnees) {
  res.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(donnees))
}

// Corps de la requête, 2 Go au plus (gros documents).
function lireCorps(req, limite = 2 * 1024 ** 3) {
  return new Promise((ok, echec) => {
    const morceaux = []
    let taille = 0
    req.on('data', (morceau) => {
      taille += morceau.length
      if (taille > limite) {
        echec(new ErreurHttp(413, 'Fichier trop gros'))
        req.destroy()
      } else morceaux.push(morceau)
    })
    req.on('end', () => ok(Buffer.concat(morceaux)))
    req.on('error', echec)
  })
}


// Fichiers de l'interface :
//   /                          → le portail KTEC
//   /<appli>/                  → la coquille commune, qui charge l'application (ex. /birtec/)
//   /apps/<appli>/interface/…  → fichiers de l'application (menu, aide, icône, styles)
//   /apps/<appli>/blocs/…      → écrans de l'application (seulement vue.js et .css : le code serveur
//                                 des blocs n'est jamais envoyé au navigateur)
//   /installation/             → la page d'installation, mises à jour, désinstallation
//   le reste                   → interface/ de KTEC (socle commun, thème)
function envoyerFichierStatique(res, chemin) {
  chemin = decodeURIComponent(chemin)
  let fichier = null
  const morceaux = chemin.split('/').filter(Boolean)
  if (morceaux[0] === 'apps' && applis().has(morceaux[1])) {
    const dossier = applis().get(morceaux[1]).dossier
    const reste = morceaux.slice(2).join('/')
    if (/^blocs\/[\w-]+\/(vue\.js|[\w-]+\.css)$/.test(reste) || /^interface\/[\w./-]+$/.test(reste)) fichier = path.join(dossier, reste)
    if (fichier && !fichier.startsWith(dossier + path.sep)) fichier = null
  } else if (morceaux.length === 1 && applis().has(morceaux[0]) && chemin.endsWith('/')) {
    fichier = path.join(chemins.interface, 'appli.html')
  } else if (morceaux.length === 1 && applis().has(morceaux[0])) {
    res.writeHead(302, { Location: `/${morceaux[0]}/` })
    return res.end()
  } else {
    fichier = path.join(chemins.interface, chemin.endsWith('/') ? chemin + 'index.html' : chemin)
    if (!fichier.startsWith(chemins.interface)) fichier = null
  }
  if (!fichier || !fs.existsSync(fichier) || !fs.statSync(fichier).isFile()) throw new ErreurHttp(404, 'Introuvable : ' + chemin)

  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(fichier)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  })
  fs.createReadStream(fichier).pipe(res)
}

// Envoie un fichier au navigateur (document enregistré dans la base, sauvegarde…).
export function envoyerOctets(res, octets, { type = 'application/octet-stream', nom, telecharger = false } = {}) {
  const entetes = { 'Content-Type': type, 'Content-Length': octets.length, 'Cache-Control': 'no-store' }
  if (nom) entetes['Content-Disposition'] = `${telecharger ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(nom)}`
  res.writeHead(200, entetes)
  res.end(octets)
}

// Flux d'évènements (réponses de l'IA affichées au fur et à mesure).
export function ouvrirFlux(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
  return {
    envoyer(type, donnees) {
      res.write(`event: ${type}\ndata: ${JSON.stringify(donnees)}\n\n`)
    },
    fermer() {
      res.end()
    },
  }
}
