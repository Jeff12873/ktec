// Les comptes, quand une licence est installée. Sans licence, rien ne change : K.NOVA fonctionne comme avant.
//
// - Chacun est reconnu par sa session Windows (lue par Node : aucun programme lancé, aucune alerte, aucun mot de passe).
// - La personne qui importe la licence devient administrateur : la licence lui sert de clé.
// - Les autres, à leur première ouverture, ne voient rien : une demande part toute seule à côté du fichier partagé,
//   et l'administrateur la voit. Il règle pour chaque compte : Aucun, Lecture ou Écriture par application, et les
//   lignes permises. Couper un compte prend effet en quelques secondes.
// - Les comptes sont dans un petit fichier à côté du .ktec (« .comptes »), chiffré avec la clé du site : le changer
//   ne recopie pas les centaines de Mo du fichier de connaissances, et chaque poste le relit à chaque instant.
// - En acceptant une demande, l'administrateur dépose la clé du site chiffrée pour ce poste (« .acces ») : le
//   nouveau poste l'utilise tout seul, sans fichier .ktecclef à donner.
// Limite : comme la licence, ces droits cadrent l'usage normal ; ils ne résistent pas à un informaticien déterminé.

import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { RACINE, journal } from './installation.js'
import { etatPartage, ouvrirFichier, requeteEnCours, definirControles } from './partage.js'
import { cleDuPoste, empreinteDuFichier, chiffrer, dechiffrer, rangerCle } from './cle.js'
import { lireLicence, problemeLicence } from './licence.js'

export const ACCES = ['aucun', 'lecture', 'ecriture']
const erreur = (statut, message) => Object.assign(new Error(message), { statut })
const fichierPartage = () => etatPartage().fichier
const chemins = () => {
  const f = fichierPartage()
  return f ? { comptes: `${f}.comptes`, info: `${f}.comptes-info`, demandes: `${f}.demandes`, acces: `${f}.acces` } : null
}
const nomSur = (login) => String(login).replace(/[^\w.-]+/g, '_')

// Qui utilise ce poste : la session Windows.
export const identite = () => ({ login: os.userInfo().username.toUpperCase(), poste: os.hostname() })

// ---------------------------------------------------------------- le fichier des comptes

// La clé du site du fichier ouvert (null : fichier en clair, ou clé absente de ce poste).
let memoCle = { fichier: null, cle: null }
function cleSite() {
  const f = fichierPartage()
  if (memoCle.fichier !== f || !memoCle.cle) {
    let cle = null
    try {
      const e = empreinteDuFichier(f)
      cle = e ? cleDuPoste(e) : null
    } catch {}
    memoCle = { fichier: f, cle }
  }
  return memoCle.cle
}

// { existe, lisible, donnees } ; relu seulement quand le fichier change, et regardé au plus toutes les 2 secondes
// (chaque requête le consulte : le dossier réseau ne doit pas ralentir l'outil).
let memo = { signature: null, valeur: null, chemin: null, vu: 0 }
function lireComptes() {
  const c = chemins()
  if (!c) return { existe: false }
  if (memo.chemin === c.comptes && memo.valeur && Date.now() - memo.vu < 2000) return memo.valeur
  const garder = (valeur, signature = null) => {
    memo = { signature, valeur, chemin: c.comptes, vu: Date.now() }
    return valeur
  }
  let infos
  try {
    infos = fs.statSync(c.comptes)
  } catch {
    return garder({ existe: false })
  }
  const signature = `${c.comptes}|${infos.size}|${infos.mtimeMs}`
  if (memo.signature === signature) return garder(memo.valeur, signature)
  let valeur
  try {
    const texte = fs.readFileSync(c.comptes, 'utf8')
    valeur = { existe: true, lisible: true, donnees: JSON.parse(texte.startsWith('ENC1:') ? dechiffrer(texte, cleSite()) : texte) }
  } catch {
    valeur = { existe: true, lisible: false }
  }
  return garder(valeur, signature)
}

// Écrit le fichier des comptes (chiffré si le fichier de connaissances l'est), et son résumé public pour les postes
// qui n'ont pas encore la clé : le client et le nom des administrateurs.
function ecrireComptes(donnees) {
  const c = chemins()
  if (!c) throw erreur(409, 'Aucun fichier de connaissances ouvert.')
  const cle = cleSite()
  const ecrire = (chemin, texte) => {
    fs.writeFileSync(`${chemin}.envoi`, texte)
    fs.renameSync(`${chemin}.envoi`, chemin)
  }
  ecrire(c.comptes, cle ? chiffrer(JSON.stringify(donnees), cle) : JSON.stringify(donnees))
  ecrire(c.info, JSON.stringify({ client: donnees.licence?.client || '', admins: donnees.admins.map((a) => donnees.comptes[a]?.nom || a) }))
  memo = { signature: null, valeur: null, chemin: null, vu: 0 }
}

const lireInfoPublique = () => {
  try {
    return JSON.parse(fs.readFileSync(chemins().info, 'utf8'))
  } catch {
    return { client: '', admins: [] }
  }
}

// ---------------------------------------------------------------- la licence

// Importer la licence : la personne qui l'importe devient administrateur (la licence lui sert de clé).
// Une nouvelle licence (renouvelée, autres applications) remplace l'ancienne et garde les comptes.
export function importerLicence(texte, { nom = '' } = {}) {
  const contenu = lireLicence(texte)
  const probleme = problemeLicence(contenu)
  if (probleme) throw erreur(400, probleme)
  const avant = lireComptes()
  if (avant.existe && !avant.lisible) throw erreur(423, 'Le fichier des comptes ne se lit pas sur ce poste : il faut la clé du site.')
  const { login } = identite()
  // Première licence : « accueil en lecture » (ceux qui utilisent déjà l'outil gardent l'accès, en lecture).
  const d = avant.donnees || { admins: [], comptes: {}, accueil: true }
  d.licence = { ...contenu, texte: String(texte) }
  if (!d.admins.includes(login)) d.admins.push(login)
  d.comptes[login] = { ...(d.comptes[login] || {}), nom: String(nom || d.comptes[login]?.nom || login).slice(0, 80) }
  ecrireComptes(d)
  journal(`Licence K.NOVA importée (${contenu.client}) : ${login} est administrateur`)
  return etatCompte()
}

// ---------------------------------------------------------------- les droits de ce poste

// null : pas de licence, tout fonctionne comme avant.
export function etatCompte() {
  const lu = lireComptes()
  if (!lu.existe) return null
  const { login, poste } = identite()
  const info = lireInfoPublique()
  if (!lu.lisible) return { licence: true, login, poste, lisible: false, acces: {}, admin: false, client: info.client, admins: info.admins, demande: demande(login) }
  const d = lu.donnees
  const l = d.licence || {}
  const probleme = problemeLicence(l)
  const admin = d.admins.includes(login)
  const compte = d.comptes[login]
  const acces = {}
  if (!probleme) {
    for (const a of l.applis || []) {
      const niveau = admin ? 'ecriture' : compte?.applis?.[a]
      if (niveau && niveau !== 'aucun') acces[a] = niveau
    }
  }
  return {
    licence: true, lisible: true, login, poste, admin, acces, probleme,
    nom: compte?.nom || '', lignes: admin ? null : compte?.lignes ?? null,
    client: l.client, applis: l.applis || [], fin: l.fin || null,
    admins: d.admins.map((a) => d.comptes[a]?.nom || a),
    coupe: Boolean(compte?.coupe),
    demande: admin || compte ? null : demande(login),
    demandes: admin ? demandesEnAttente(d).length : 0,
    accueil: Boolean(d.accueil),
  }
}

// Accueil en lecture : un compte Windows qui ouvre l'outil pour la première fois reçoit la lecture sur toutes les
// applications de la licence, et apparaît dans la liste de l'administrateur, qui le règle ou le coupe ensuite.
export function accueillir() {
  const lu = lireComptes()
  const { login, poste } = identite()
  if (!lu.lisible || !lu.donnees.accueil || lu.donnees.comptes[login] || lu.donnees.admins.includes(login)) return false
  const d = structuredClone(lu.donnees)
  d.comptes[login] = { nom: demande(login)?.nom || '', applis: Object.fromEntries((d.licence?.applis || []).map((a) => [a, 'lecture'])), lignes: null, accueil: true, poste, le: new Date().toISOString() }
  ecrireComptes(d)
  fs.rmSync(path.join(chemins().demandes, `${nomSur(login)}.json`), { force: true })
  return true
}

export function changerAccueil(actif) {
  const d = exigerAdministrateur()
  d.accueil = Boolean(actif)
  ecrireComptes(d)
  return vueAdministrateur()
}

// Le niveau du compte de ce poste pour une application : 'ecriture', 'lecture' ou 'aucun' ; null sans licence.
export function accesAppli(id) {
  const e = etatCompte()
  if (!e) return null
  return e.acces[id] || 'aucun'
}

// Les lignes (parcs) que ce compte peut voir ; null : toutes (ou pas de licence).
export function lignesAutorisees() {
  const e = etatCompte()
  return e && !e.admin && Array.isArray(e.lignes) ? new Set(e.lignes) : null
}

// Branchés sur partage.js : qui peut modifier le fichier, qui est administrateur.
definirControles({
  actif: () => Boolean(etatCompte()),
  admin: () => {
    const e = etatCompte()
    return e ? e.admin : null
  },
  // Avant une écriture. pourTous : historique, résultats d'analyse… permis à qui peut ouvrir l'application.
  ecriture: ({ pourTous = false } = {}) => {
    const e = etatCompte()
    if (!e) return false
    if (e.admin && !e.probleme) return true
    const appli = requeteEnCours.getStore()?.appli
    if (!appli) return true // tâche de fond lancée par ce poste
    const niveau = appli === 'ktec' ? (Object.keys(e.acces).length ? 'ecriture' : 'aucun') : e.acces[appli] || 'aucun'
    if (niveau === 'ecriture' || (pourTous && niveau === 'lecture')) return true
    throw erreur(403, niveau === 'lecture' ? 'Votre compte est en lecture seule sur cette application.' : 'Votre compte n’a pas accès à cette application.')
  },
  acces: (appli) => accesAppli(appli),
})

// ---------------------------------------------------------------- les demandes d'accès

function demande(login) {
  try {
    return JSON.parse(fs.readFileSync(path.join(chemins().demandes, `${nomSur(login)}.json`), 'utf8'))
  } catch {
    return null
  }
}

// Ce poste demande l'accès (première ouverture, ou nom complété) : un petit fichier à côté du fichier partagé.
export function demanderAcces({ nom } = {}) {
  const c = chemins()
  if (!c) return null
  const { login, poste } = identite()
  const avant = demande(login)
  if (avant && avant.statut === 'en_attente' && nom === undefined) return avant
  const d = { login, poste, nom: String(nom ?? avant?.nom ?? '').trim().slice(0, 80), date: avant?.statut === 'en_attente' ? avant.date : new Date().toISOString(), statut: 'en_attente', clePublique: clePublique() }
  fs.mkdirSync(c.demandes, { recursive: true })
  fs.writeFileSync(path.join(c.demandes, `${nomSur(login)}.json`), JSON.stringify(d))
  return d
}

// Les demandes à traiter : pas celles d'un administrateur ou d'un compte déjà réglé (restées d'avant).
const demandesEnAttente = (d) => listerDemandes().filter((x) => x.statut === 'en_attente' && !d.admins.includes(x.login) && !(d.comptes[x.login] && !d.comptes[x.login].coupe))

export function listerDemandes() {
  const c = chemins()
  try {
    return fs.readdirSync(c.demandes).filter((f) => f.endsWith('.json')).map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(c.demandes, f), 'utf8'))
      } catch {
        return null
      }
    }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------- l'administrateur

function exigerAdministrateur() {
  const lu = lireComptes()
  if (!lu.existe || !lu.lisible || !lu.donnees.admins.includes(identite().login)) throw erreur(403, 'Réservé à l’administrateur.')
  return lu.donnees
}

// Les comptes, les demandes et la licence, pour l'écran Comptes.
export function vueAdministrateur() {
  const d = exigerAdministrateur()
  const l = d.licence || {}
  return {
    licence: { client: l.client, applis: l.applis, emise: l.emise, fin: l.fin, numero: l.numero, probleme: problemeLicence(l) },
    moi: identite().login,
    accueil: Boolean(d.accueil),
    comptes: Object.entries(d.comptes).map(([login, c]) => ({ login, nom: c.nom || '', admin: d.admins.includes(login), applis: c.applis || {}, lignes: c.lignes ?? null, vu: c.vu || null, coupe: Boolean(c.coupe), accueil: Boolean(c.accueil), poste: c.poste || '' })).sort((a, b) => Number(b.admin) - Number(a.admin) || a.nom.localeCompare(b.nom)),
    demandes: demandesEnAttente(d),
  }
}

const propreAcces = (applis, licence) => Object.fromEntries((licence.applis || []).map((a) => [a, ACCES.includes(applis?.[a]) ? applis[a] : 'aucun']))
const propresLignes = (lignes) => (Array.isArray(lignes) ? [...new Set(lignes.map(String))] : null)

// Accepter une demande, ou régler un compte : { login, nom, applis: { prevtec: 'lecture' }, lignes: [ids] | null, admin }.
export function reglerCompte({ login, nom, applis, lignes = null, admin = false }) {
  const d = exigerAdministrateur()
  const cle = String(login || '').toUpperCase()
  if (!cle) throw erreur(400, 'Compte inconnu.')
  const avant = d.comptes[cle] || {}
  d.comptes[cle] = { ...avant, nom: String(nom ?? avant.nom ?? cle).trim().slice(0, 80) || cle, applis: propreAcces(applis, d.licence || {}), lignes: propresLignes(lignes), coupe: false, accueil: false, par: identite().login, le: new Date().toISOString() }
  if (admin && !d.admins.includes(cle)) d.admins.push(cle)
  if (!admin && d.admins.includes(cle)) {
    if (d.admins.length === 1) throw erreur(400, 'Il faut garder au moins un administrateur.')
    d.admins = d.admins.filter((a) => a !== cle)
  }
  ecrireComptes(d)
  const dem = demande(cle)
  if (dem) {
    deposerCle(cle, dem)
    fs.rmSync(path.join(chemins().demandes, `${nomSur(cle)}.json`), { force: true })
  }
  return vueAdministrateur()
}

export function refuserDemande(login) {
  exigerAdministrateur()
  const dem = demande(login)
  if (!dem) throw erreur(404, 'Demande introuvable.')
  fs.writeFileSync(path.join(chemins().demandes, `${nomSur(login)}.json`), JSON.stringify({ ...dem, statut: 'refusee', par: identite().login, le: new Date().toISOString() }))
  return vueAdministrateur()
}

// Couper un compte : plus aucun accès, en quelques secondes. Il garde sa ligne pour être réactivé.
export function couperCompte(login) {
  const d = exigerAdministrateur()
  const cle = String(login || '').toUpperCase()
  if (d.admins.includes(cle)) throw erreur(400, 'Retirez d’abord le rôle d’administrateur de ce compte.')
  if (!d.comptes[cle]) throw erreur(404, 'Compte inconnu.')
  d.comptes[cle] = { ...d.comptes[cle], applis: {}, coupe: true, par: identite().login, le: new Date().toISOString() }
  ecrireComptes(d)
  return vueAdministrateur()
}

// La date de dernière ouverture de ce compte (au plus une écriture par jour).
export function noterOuverture() {
  const lu = lireComptes()
  const { login } = identite()
  if (!lu.lisible || !lu.donnees.comptes[login]) return
  const jour = new Date().toISOString().slice(0, 10)
  if (lu.donnees.comptes[login].vu === jour) return
  try {
    const d = structuredClone(lu.donnees)
    d.comptes[login].vu = jour
    ecrireComptes(d)
  } catch {}
}

// ---------------------------------------------------------------- la clé du site, donnée à un nouveau poste

const cheminPoste = () => path.join(RACINE, 'cles', 'poste.pem')
function clePublique() {
  try {
    return crypto.createPublicKey(fs.readFileSync(cheminPoste(), 'utf8')).export({ type: 'spki', format: 'pem' })
  } catch {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    fs.mkdirSync(path.dirname(cheminPoste()), { recursive: true })
    fs.writeFileSync(cheminPoste(), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    return crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' })
  }
}

function deposerCle(login, dem) {
  const cle = cleSite()
  if (!cle || !dem.clePublique) return
  const emballee = crypto.publicEncrypt({ key: dem.clePublique, oaepHash: 'sha256' }, cle).toString('base64')
  fs.mkdirSync(chemins().acces, { recursive: true })
  fs.writeFileSync(path.join(chemins().acces, `${nomSur(login)}.json`), JSON.stringify({ poste: dem.poste, cle: emballee }))
}

// Toutes les 10 secondes, un poste à qui il manque la clé regarde si l'administrateur la lui a déposée.
setInterval(() => {
  try {
    if (!etatPartage().cleManquante || !chemins()) return
    const depot = path.join(chemins().acces, `${nomSur(identite().login)}.json`)
    if (!fs.existsSync(depot)) return
    const { cle } = JSON.parse(fs.readFileSync(depot, 'utf8'))
    rangerCle(crypto.privateDecrypt({ key: fs.readFileSync(cheminPoste(), 'utf8'), oaepHash: 'sha256' }, Buffer.from(cle, 'base64')))
    fs.rmSync(depot, { force: true })
    memoCle = { fichier: null, cle: null }
    ouvrirFichier(fichierPartage())
    journal('Clé du site reçue de l’administrateur : fichier de connaissances ouvert')
  } catch {}
}, 10_000).unref()
