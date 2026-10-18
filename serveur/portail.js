// Les routes communes à toutes les applications, sous /api/ktec/… :
// état général, applications installées, connexion MySQL (une seule pour tout KTEC),
// dossier de travail, réglages du poste.

import fs from 'node:fs'
import { ErreurHttp } from './socle/http.js'
import { cheminKtec } from './socle/ktec.js'
import { etatIA, arreterIA } from './socle/ia.js'
import { version, reglagesPoste, modifierReglagesPoste, dossierTravail, journal } from './socle/installation.js'
import { etatConnexion, ouvrirSession, fermerSession, javaInstalle } from './socle/mysql.js'
import { applisPubliques } from './socle/applis.js'

export function routes(r) {
  // Interrogé régulièrement par l'interface.
  r.get('/api/ktec/etat', () => ({
    version: version(),
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
      arreterIA()
      process.exit(0)
    }, 300)
  })
}
