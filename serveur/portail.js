// Les routes communes à toutes les applications, sous /api/ktec/… :
// état général, applications installées, connexion MySQL (une seule pour tout KTEC),
// fichier de connaissances .ktec (ouverture, création, mode administrateur, mot de passe, sauvegardes),
// dossier de travail, réglages du poste.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ErreurHttp } from './socle/http.js'
import { cheminKtec, changerKtec } from './socle/ktec.js'
import { etatPartage, entrerAdmin, quitterAdmin, cookieAdmin, verifierMotDePasse, motDePasseDefini, changerMotDePasse, listerSauvegardes, creerFichier, publierMaintenant } from './socle/partage.js'
import { etatIA, arreterIA } from './socle/ia.js'
import { version, reglagesPoste, modifierReglagesPoste, dossierTravail, journal, WINDOWS } from './socle/installation.js'
import { etatConnexion, ouvrirSession, fermerSession, javaInstalle } from './socle/mysql.js'
import { applisPubliques } from './socle/applis.js'

export function routes(r) {
  // Interrogé régulièrement par l'interface.
  r.get('/api/ktec/etat', (ctx) => ({
    version: version(),
    partage: etatPartage(ctx.cookie),
    admin: ctx.admin,
    ia: etatIA(),
    java: javaInstalle(),
    connexion: etatConnexion(),
    dossierTravail: dossierTravail(),
    fichierKtec: cheminKtec(),
    poste: reglagesPoste(),
  }))

  r.get('/api/ktec/applis', () => applisPubliques())

  // ---- connexion MySQL (partagée : le mot de passe n'est demandé qu'une fois pour toutes les applications)

  r.post('/api/ktec/configuration/mysql', async (ctx) => {
    const { serveur, port, base, utilisateur } = await ctx.json()
    if (!serveur?.trim() || !base?.trim() || !utilisateur?.trim()) throw new ErreurHttp(400, 'Serveur, base et utilisateur sont obligatoires.')
    modifierReglagesPoste({ mysql: { serveur: serveur.trim(), port: Number(port) || 3306, base: base.trim(), utilisateur: utilisateur.trim() } })
    fermerSession() // nouvelle connexion : le mot de passe sera redemandé
  })

  r.post('/api/ktec/session', async (ctx) => {
    const { motDePasse } = await ctx.json()
    if (!motDePasse) throw new ErreurHttp(400, 'Saisissez le mot de passe MySQL.')
    return ouvrirSession(motDePasse)
  })

  r.delete('/api/ktec/session', () => {
    fermerSession()
  })

  // ---- dossier de travail

  r.post('/api/ktec/configuration/dossier', async (ctx) => {
    const { dossier } = await ctx.json()
    if (dossier && !fs.existsSync(dossier)) throw new ErreurHttp(404, `Dossier introuvable : ${dossier}`)
    modifierReglagesPoste({ dossierTravail: dossier || '' })
    return { dossier: dossierTravail() }
  })

  // ---- réglages du poste

  r.post('/api/ktec/poste', async (ctx) => {
    const { arretIAMinutes } = await ctx.json()
    return modifierReglagesPoste({ arretIAMinutes: Math.max(1, Math.min(480, Number(arretIAMinutes) || 20)) })
  })

  r.post('/api/ktec/quitter', () => {
    journal('Arrêt demandé depuis l’interface')
    setTimeout(() => {
      publierMaintenant()
      arreterIA()
      process.exit(0)
    }, 300)
  })

  // ---- fichier de connaissances .ktec

  r.post('/api/ktec/fichier/ouvrir', async (ctx) => {
    const { chemin } = await ctx.json()
    changerKtec(chemin)
    return etatPartage(ctx.cookie)
  })

  r.post('/api/ktec/fichier/creer', async (ctx) => {
    const { dossier, nom } = await ctx.json()
    if (!dossier || !nom?.trim()) throw new ErreurHttp(400, 'Choisissez un dossier et un nom de fichier.')
    creerFichier(path.join(dossier, nom.trim()))
    return etatPartage(ctx.cookie)
  })

  // Parcourir les dossiers du poste (le navigateur ne donne pas les chemins complets des fichiers).
  r.get('/api/ktec/explorer', (ctx) => {
    const dossier = ctx.query.dossier ? path.resolve(ctx.query.dossier) : null
    const extensions = String(ctx.query.extensions || '.ktec').split(',')
    if (!dossier) return { dossier: null, parent: null, racines: racines(), dossiers: [], fichiers: [] }
    let entrees
    try {
      entrees = fs.readdirSync(dossier, { withFileTypes: true })
    } catch {
      throw new ErreurHttp(404, `Dossier inaccessible : ${dossier}`)
    }
    const visibles = entrees.filter((e) => !e.name.startsWith('.') && !e.name.startsWith('$'))
    const parent = path.dirname(dossier)
    return {
      dossier,
      parent: parent !== dossier ? parent : null,
      racines: racines(),
      dossiers: visibles.filter((e) => estDossier(dossier, e)).map((e) => e.name).sort((a, b) => a.localeCompare(b, 'fr')),
      fichiers: visibles.filter((e) => e.isFile() && extensions.some((x) => e.name.toLowerCase().endsWith(x))).map((e) => e.name).sort(),
    }
  })

  // ---- mode administrateur (modifier le fichier quand il a un mot de passe ; un seul poste à la fois)

  r.post('/api/ktec/admin', async (ctx) => {
    const { motDePasse, nom, forcer } = await ctx.json()
    if (motDePasseDefini() && !verifierMotDePasse(motDePasse || '')) {
      await new Promise((ok) => setTimeout(ok, 800)) // ralentit les essais en série
      throw new ErreurHttp(401, 'Mot de passe incorrect.')
    }
    const nomAgent = (nom || '').trim() || reglagesPoste().nomAgent || os.userInfo().username
    modifierReglagesPoste({ nomAgent })
    const resultat = entrerAdmin(nomAgent, { forcer })
    if (resultat.occupe) return { occupe: resultat.occupe }
    ctx.res.setHeader('Set-Cookie', `ktec_admin=${cookieAdmin()}; Path=/; HttpOnly; SameSite=Strict`)
    return { ok: true }
  })

  r.delete('/api/ktec/admin', (ctx) => {
    quitterAdmin()
    ctx.res.setHeader('Set-Cookie', 'ktec_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict')
    return { ok: true }
  })

  // { actuel, nouveau } : nouveau vide = plus de mot de passe (les modifications reprennent la main toutes seules).
  r.post('/api/ktec/mot-de-passe', async (ctx) => {
    const { actuel, nouveau } = await ctx.json()
    if (motDePasseDefini() && !verifierMotDePasse(actuel || '')) throw new ErreurHttp(401, 'Mot de passe actuel incorrect.')
    if (nouveau && nouveau.length < 4) throw new ErreurHttp(400, 'Mot de passe trop court (4 caractères au moins).')
    if (!motDePasseDefini()) entrerAdmin(reglagesPoste().nomAgent || os.userInfo().username)
    else ctx.exigerAdmin()
    changerMotDePasse(nouveau || '')
    if (nouveau) ctx.res.setHeader('Set-Cookie', `ktec_admin=${cookieAdmin()}; Path=/; HttpOnly; SameSite=Strict`)
    return { motDePasse: Boolean(nouveau) }
  })

  r.get('/api/ktec/sauvegardes', () => listerSauvegardes().map(({ nom, date, taille }) => ({ nom, date, taille })))
}

// Points de départ proposés dans l'explorateur.
function racines() {
  const liste = [{ nom: 'Dossier personnel', chemin: os.homedir() }]
  if (WINDOWS) {
    // Lecteurs C:, D:, … et lecteurs réseau (Z:…)
    for (const lettre of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const lecteur = `${lettre}:\\`
      if (fs.existsSync(lecteur)) liste.push({ nom: `Lecteur ${lettre}:`, chemin: lecteur })
    }
  } else {
    const uid = os.userInfo().uid
    for (const [nom, chemin] of [['Partages réseau (GNOME)', `/run/user/${uid}/gvfs`], ['Partages réseau (KDE)', `/run/user/${uid}/kio-fuse`], ['/mnt', '/mnt'], ['/media', '/media'], ['Racine /', '/']]) {
      if (fs.existsSync(chemin)) liste.push({ nom, chemin })
    }
  }
  liste.unshift({ nom: 'Dossier du fichier actuel', chemin: path.dirname(cheminKtec()) })
  return liste
}

function estDossier(parent, entree) {
  if (entree.isDirectory()) return true
  if (!entree.isSymbolicLink()) return false
  try {
    return fs.statSync(path.join(parent, entree.name)).isDirectory()
  } catch {
    return false
  }
}
