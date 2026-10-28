// Le fichier .ktec partagé, ouvert par plusieurs postes à la fois (repris d'IASSITEC).
//
//   lecteur réseau (ou Documents)        ce poste
//   connaissances.ktec  ── copie ──►  cache/base.ktec  ◄── KTEC lit ici
//          ▲                                  │
//          └──────── publication ─────────────┘   (seulement par le poste qui a le verrou)
//
// - En consultation, on lit la copie locale et on la remplace dès que le fichier partagé change.
// - Pour modifier, il faut le verrou : un petit fichier « connaissances.ktec.verrou » posé à côté,
//   qui dit qui modifie et depuis quand. Un seul poste à la fois.
//   · Fichier sans mot de passe : le verrou est pris tout seul à la première modification (un poste seul,
//     ou une équipe qui se fait confiance) ;
//   · Fichier avec mot de passe : il faut passer en mode administrateur (barre du haut).
// - Chaque modification est publiée quelques secondes plus tard : la copie locale est envoyée
//   sous un nom temporaire puis renommée d'un coup, pour qu'aucun poste ne lise un fichier à moitié écrit.
// - Une sauvegarde du fichier est faite à chaque prise du verrou (une par heure au plus, 5 gardées,
//   dans KTEC-sauvegardes à côté du fichier).
//
// Les applications déclarent leurs tables avec ajouterStructure() : elles sont créées à chaque ouverture.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { DatabaseSync } from 'node:sqlite'
import { RACINE, chemins, reglagesPoste, modifierReglagesPoste, journal } from './installation.js'

const DELAI_PUBLICATION = 3_000          // on regroupe les modifications rapprochées
const VERROU_ABANDONNE = 10 * 60_000     // verrou non rafraîchi depuis 10 min = poste planté
const ADMIN_INACTIF = 30 * 60_000        // on rend le verrou après 30 min sans modification
const SAUVEGARDES_GARDEES = 5
export const FORMAT = 1                  // structure commune du fichier (voir ktec.js)

const etat = {
  fichier: null,         // chemin du .ktec partagé
  signature: null,       // taille et date du fichier partagé lors de la dernière copie
  copieDu: null,
  version: 0,            // augmente quand le contenu change : l'interface se recharge
  admin: null,           // { nom, jeton, cookie, depuis, derniereAction, auto } quand CE poste a le verrou
  aPublier: false,
  publication: { derniere: null, erreur: null },
  avertissement: null,
}
let connexion = null
let lectureSeule = true
const structures = []

// La requête en cours (cookie du mode administrateur), pour savoir qui écrit. Rempli par http.js.
export const requeteEnCours = new AsyncLocalStorage()

// Identifie cette installation (poste + dossier) : sur un même poste, chaque agent a la sienne.
const IDENTIFIANT_INSTALLATION = crypto.createHash('sha256').update(os.hostname() + RACINE).digest('hex').slice(0, 16)

const copieLocale = () => path.join(chemins.cache, 'base.ktec')
const cheminVerrou = () => etat.fichier + '.verrou'
const erreur = (statut, message) => Object.assign(new Error(message), { statut })

// ---------------------------------------------------------------- structure

// fonction(db) : crée les tables d'une application (CREATE TABLE IF NOT EXISTS…), à chaque ouverture.
export function ajouterStructure(fonction) {
  structures.push(fonction)
  if (connexion) {
    // Fichier déjà ouvert : on rouvre pour créer les nouvelles tables.
    ouvrirBase(copieLocale(), { lectureSeule })
  }
}

// La copie locale est d'abord ouverte en écriture pour créer les tables manquantes (sans effet sur le
// fichier partagé), puis rouverte en lecture seule si ce poste n'a pas le verrou.
function ouvrirBase(chemin, { lectureSeule: seule }) {
  connexion?.close()
  connexion = null
  const base = new DatabaseSync(chemin)
  base.exec('PRAGMA journal_mode = DELETE') // la base tient toujours en un seul fichier, qu'on peut copier sans risque
  base.exec('PRAGMA foreign_keys = ON')
  for (const fonction of structures) fonction(base)
  if (seule) {
    base.close()
    connexion = new DatabaseSync(chemin, { readOnly: true })
  } else connexion = base
  lectureSeule = seule
}

// Le fichier est-il déjà ouvert ? (sans l'ouvrir : sert à lire la connexion partagée sans effet de bord)
export const baseOuverte = () => Boolean(connexion)

// La base ouverte (copie locale). Ouvre le fichier du poste au premier appel.
export function db() {
  if (!connexion) ouvrirFichier(cheminParDefaut())
  return connexion
}

let cheminParDefaut = () => {
  throw erreur(409, 'Aucun fichier .ktec ouvert')
}
// ktec.js indique où est le fichier du poste (réglages, ou Documents/KTEC/connaissances.ktec).
export function definirCheminParDefaut(fonction) {
  cheminParDefaut = fonction
}

// Exécute plusieurs écritures d'un coup : tout ou rien (les transactions s'emboîtent).
let profondeur = 0
export function transaction(travail) {
  const base = db()
  const point = `point${profondeur}`
  base.exec(profondeur === 0 ? 'BEGIN' : `SAVEPOINT ${point}`)
  profondeur++
  try {
    const resultat = travail(base)
    profondeur--
    base.exec(profondeur === 0 ? 'COMMIT' : `RELEASE ${point}`)
    return resultat
  } catch (e) {
    profondeur--
    base.exec(profondeur === 0 ? 'ROLLBACK' : `ROLLBACK TO ${point}; RELEASE ${point}`)
    throw e
  }
}

// ---------------------------------------------------------------- ouverture

// Ouvre un fichier .ktec (il doit exister) et le retient pour les prochains lancements.
export function ouvrirFichier(fichier) {
  fichier = path.resolve(fichier)
  if (!fs.existsSync(fichier)) throw erreur(404, `Fichier introuvable : ${fichier}`)
  if (etat.admin) quitterAdmin()
  etat.fichier = fichier
  etat.signature = null
  try {
    copierDepuisLePartage()
  } catch (e) {
    // Réseau coupé : on travaille sur la dernière copie, en consultation.
    if (!fs.existsSync(copieLocale())) throw e
    ouvrirBase(copieLocale(), { lectureSeule: true })
    etat.copieDu = fs.statSync(copieLocale()).mtime.toISOString()
    etat.avertissement = 'Le fichier partagé est inaccessible : vous consultez la dernière copie enregistrée sur ce poste.'
  }
  if (reglagesPoste().fichierKtec !== fichier) modifierReglagesPoste({ fichierKtec: fichier })
  journal(`Fichier de connaissances : ${fichier}`)
  return fichier
}

// Crée un fichier .ktec vide (structure seulement) à cet endroit, puis l'ouvre.
export function creerFichier(fichier) {
  fichier = path.resolve(fichier.endsWith('.ktec') ? fichier : fichier + '.ktec')
  if (fs.existsSync(fichier)) throw erreur(409, 'Un fichier porte déjà ce nom.')
  fs.mkdirSync(chemins.cache, { recursive: true })
  const nouveau = path.join(chemins.cache, 'nouveau.ktec')
  fs.rmSync(nouveau, { force: true })
  const base = new DatabaseSync(nouveau)
  base.exec('PRAGMA journal_mode = DELETE')
  for (const fonction of structures) fonction(base)
  base.close()
  fs.mkdirSync(path.dirname(fichier), { recursive: true })
  fs.copyFileSync(nouveau, fichier)
  fs.rmSync(nouveau, { force: true })
  journal(`Nouveau fichier de connaissances : ${fichier}`)
  return ouvrirFichier(fichier)
}

// Copie le fichier partagé dans le cache s'il a changé. Renvoie true s'il a été recopié.
function copierDepuisLePartage() {
  const infos = fs.statSync(etat.fichier)
  const signature = `${infos.size}-${infos.mtimeMs}`
  if (signature === etat.signature && connexion) return false
  fs.mkdirSync(chemins.cache, { recursive: true })
  const temporaire = copieLocale() + '.copie'
  fs.copyFileSync(etat.fichier, temporaire)
  connexion?.close()
  connexion = null
  fs.renameSync(temporaire, copieLocale())
  ouvrirBase(copieLocale(), { lectureSeule: !etat.admin })
  etat.signature = signature
  etat.copieDu = new Date().toISOString()
  etat.version++
  etat.avertissement = null
  return true
}

// Toutes les 10 secondes : en consultation, on suit les changements faits par un autre poste.
setInterval(() => {
  if (!etat.fichier || etat.admin) return
  try {
    if (copierDepuisLePartage()) journal('Nouvelle version du fichier de connaissances chargée')
  } catch {
    etat.avertissement = 'Le fichier partagé est inaccessible : vous consultez la dernière copie enregistrée sur ce poste.'
  }
}, 10_000).unref()

// ---------------------------------------------------------------- mot de passe administrateur

const lireInfoBrute = (cle) => db().prepare('SELECT valeur FROM infos WHERE cle = ?').get(cle)?.valeur ?? null

export function motDePasseDefini() {
  return Boolean(lireInfoBrute('mot_de_passe'))
}

export function verifierMotDePasse(motDePasse) {
  const [methode, sel, empreinte] = String(lireInfoBrute('mot_de_passe') || '').split('$')
  if (methode !== 'scrypt' || !sel || !empreinte) return false
  const calculee = crypto.scryptSync(motDePasse || '', sel, 32)
  return crypto.timingSafeEqual(calculee, Buffer.from(empreinte, 'hex'))
}

// Le mot de passe n'est jamais enregistré en clair : seulement une empreinte « scrypt ». Vide = retiré.
export function changerMotDePasse(nouveau) {
  exigerEcriture()
  const valeur = nouveau ? (() => {
    const sel = crypto.randomBytes(16).toString('hex')
    return `scrypt$${sel}$${crypto.scryptSync(nouveau, sel, 32).toString('hex')}`
  })() : null
  if (valeur) db().prepare('INSERT OR REPLACE INTO infos VALUES (?, ?)').run('mot_de_passe', valeur)
  else db().prepare("DELETE FROM infos WHERE cle = 'mot_de_passe'").run()
  noterModification()
}

// ---------------------------------------------------------------- verrou et mode administrateur

export function lireVerrou() {
  if (!etat.fichier) return null
  try {
    return JSON.parse(fs.readFileSync(cheminVerrou(), 'utf8'))
  } catch {
    return null
  }
}

function ecrireVerrou(verrou, { exclusif = false } = {}) {
  fs.writeFileSync(cheminVerrou(), JSON.stringify(verrou), { flag: exclusif ? 'wx' : 'w' })
}

const nouveauJeton = () => crypto.randomBytes(24).toString('hex')

// Prend le verrou. Renvoie { occupe: verrou } si quelqu'un d'autre modifie déjà.
// auto : pris tout seul pour une modification (fichier sans mot de passe).
export function entrerAdmin(nom, { forcer = false, auto = false } = {}) {
  db()
  if (etat.admin) {
    if (!auto) Object.assign(etat.admin, { auto: false, pourTous: false })
    return { ok: true }
  }
  if (!fs.existsSync(etat.fichier)) throw erreur(409, `Le fichier de connaissances est introuvable (${etat.fichier}) : modification impossible. Vérifiez le lecteur réseau, ou ouvrez un autre fichier (Réglages).`)

  const existant = lireVerrou()
  const abandonne = existant && Date.now() - existant.vu > VERROU_ABANDONNE
  // Verrou laissé par cette même installation (KTEC fermé brutalement) : on le reprend.
  const leNotre = existant && existant.installation === IDENTIFIANT_INSTALLATION
  if (existant && !abandonne && !leNotre && !forcer) return { occupe: publicDuVerrou(existant) }

  const verrou = { nom, poste: os.hostname(), installation: IDENTIFIANT_INSTALLATION, jeton: nouveauJeton(), depuis: Date.now(), vu: Date.now() }
  try {
    // Création « exclusive » : si deux postes essaient au même instant, un seul réussit.
    ecrireVerrou(verrou, { exclusif: !existant })
  } catch (e) {
    if (e.code === 'EEXIST') return { occupe: publicDuVerrou(lireVerrou()) }
    throw e
  }
  // « jeton » identifie le verrou (il est lisible sur le partage) ; « cookie » ne quitte jamais ce poste.
  etat.admin = { nom, jeton: verrou.jeton, cookie: nouveauJeton(), depuis: verrou.depuis, derniereAction: Date.now(), auto }
  try {
    etat.signature = null
    copierDepuisLePartage() // on repart de la toute dernière version, cette fois en écriture
    sauvegarder()
  } catch (e) {
    quitterAdmin()
    throw e
  }
  journal(`Modification du fichier de connaissances : ${nom}${auto ? ' (automatique)' : ''}`)
  return { ok: true }
}

export function quitterAdmin() {
  if (!etat.admin) return
  try {
    if (etat.aPublier) publier()
  } catch (e) {
    journal(`Publication impossible en rendant la main : ${e.message}`)
  }
  const verrou = lireVerrou()
  if (verrou?.jeton === etat.admin.jeton) fs.rmSync(cheminVerrou(), { force: true })
  journal(`Fin des modifications : ${etat.admin.nom}`)
  etat.admin = null
  try {
    etat.signature = null
    copierDepuisLePartage()
  } catch {
    ouvrirBase(copieLocale(), { lectureSeule: true })
  }
}

export function estAdmin(cookie) {
  return Boolean(etat.admin && cookie && etat.admin.cookie === cookie)
}

// Réglages, SQL et comptes MySQL : réservés à ce mode (navigateur administrateur, ou fichier sans mot de passe).
export function modeAdmin(cookie) {
  try {
    return !motDePasseDefini() || estAdmin(cookie)
  } catch {
    return true // pas de fichier ouvert : il faut pouvoir en choisir un
  }
}

export function cookieAdmin() {
  return etat.admin?.cookie
}

// Avant toute écriture. Fichier avec mot de passe : il faut le mode administrateur (cookie de ce navigateur).
// Sans mot de passe : le verrou est pris tout seul, sauf si un autre poste modifie déjà.
// Hors requête (tâche de fond lancée par ce poste) : il suffit d'avoir le verrou.
// pourTous : écriture permise aussi en consultation (résultats d'analyse IA, historique des conversations),
// jamais pour les réglages : le verrou est alors pris tout seul, comme sans mot de passe.
export function exigerEcriture({ pourTous = false } = {}) {
  db()
  const requete = requeteEnCours.getStore()
  if (motDePasseDefini() && !pourTous) {
    if (etat.admin && (!requete || requete.cookie === etat.admin.cookie)) return
    throw erreur(403, 'Modification réservée au mode administrateur : cliquez sur « Consultation » en haut de l’écran.')
  }
  if (etat.admin) return
  const resultat = entrerAdmin(reglagesPoste().nomAgent || os.userInfo().username, { auto: true })
  // Main prise pour un utilisateur sur un fichier protégé : rendue peu après la publication (voir publier).
  if (!resultat.occupe && motDePasseDefini()) etat.admin.pourTous = true
  if (resultat.occupe) {
    const depuis = new Date(resultat.occupe.depuis).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    throw erreur(423, `${resultat.occupe.nom} (poste ${resultat.occupe.poste}) modifie le fichier de connaissances depuis ${depuis} : réessayez plus tard.`)
  }
}

// Ce qu'on peut montrer d'un verrou à un autre poste.
function publicDuVerrou(verrou) {
  return verrou ? { nom: verrou.nom, poste: verrou.poste, depuis: verrou.depuis } : null
}

// Toutes les minutes : on signale qu'on est toujours là, on vérifie que personne n'a forcé
// le verrou, et on rend la main après une longue inactivité.
setInterval(() => {
  if (!etat.admin) return
  const verrou = lireVerrou()
  if (verrou?.jeton !== etat.admin.jeton) {
    journal('Verrou repris par un autre poste')
    avertirUnMoment(`${verrou?.nom || 'Un autre poste'} a repris la main : vous repassez en consultation.`)
    etat.admin = null
    etat.aPublier = false
    etat.signature = null
    try { copierDepuisLePartage() } catch { /* réseau coupé : on garde la copie */ }
    return
  }
  if (Date.now() - etat.admin.derniereAction > ADMIN_INACTIF) {
    const auto = etat.admin.auto
    quitterAdmin()
    if (!auto) avertirUnMoment('Mode administrateur fermé après 30 minutes sans modification.')
    return
  }
  ecrireVerrou({ ...verrou, vu: Date.now() })
}, 60_000).unref()

// ---------------------------------------------------------------- publication

let minuterie = null
let premiereModification = 0

// À appeler après chaque écriture dans la base.
export function noterModification() {
  if (!etat.admin) throw erreur(403, 'Modification refusée : le fichier de connaissances est en consultation.')
  etat.admin.derniereAction = Date.now()
  if (!etat.aPublier) premiereModification = Date.now()
  etat.aPublier = true
  clearTimeout(minuterie)
  // On attend que les modifications se calment, mais jamais plus de 30 secondes (long calcul d'index…).
  const attente = Date.now() - premiereModification > 30_000 ? 0 : DELAI_PUBLICATION
  minuterie = setTimeout(publierPlusTard, attente)
}

export function noterActiviteAdmin() {
  if (etat.admin) etat.admin.derniereAction = Date.now()
}

function publierPlusTard() {
  try {
    publier()
  } catch (e) {
    etat.publication.erreur = e.message
    journal(`Publication impossible : ${e.message} (nouvel essai dans 30 s)`)
    minuterie = setTimeout(publierPlusTard, 30_000)
  }
}

function publier() {
  if (!etat.admin || !etat.aPublier) return
  if (lireVerrou()?.jeton !== etat.admin.jeton) throw new Error('le verrou ne nous appartient plus')
  const envoi = `${etat.fichier}.envoi-${os.hostname()}`
  fs.copyFileSync(copieLocale(), envoi)
  remplacer(envoi, etat.fichier)
  const infos = fs.statSync(etat.fichier)
  etat.signature = `${infos.size}-${infos.mtimeMs}`
  etat.aPublier = false
  etat.publication = { derniere: new Date().toISOString(), erreur: null }
  // Main prise pour un utilisateur : rendue après 2 minutes sans écriture (une analyse en cours écrit souvent).
  if (etat.admin.pourTous) setTimeout(() => {
    if (etat.admin?.pourTous && !etat.aPublier && Date.now() - etat.admin.derniereAction >= 110_000) quitterAdmin()
  }, 120_000).unref()
}

// Publie tout de suite (avant l'arrêt de KTEC).
export function publierMaintenant() {
  clearTimeout(minuterie)
  if (etat.admin) quitterAdmin()
}

// Sous Windows, le renommage échoue si un autre poste est en train de copier le fichier : on réessaie.
function remplacer(source, destination) {
  for (let essai = 1; ; essai++) {
    try {
      fs.renameSync(source, destination)
      return
    } catch (e) {
      if (essai >= 10) {
        fs.rmSync(source, { force: true })
        throw e
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300) // pause de 300 ms
    }
  }
}

// ---------------------------------------------------------------- sauvegardes

const dossierSauvegardes = () => path.join(path.dirname(etat.fichier), 'KTEC-sauvegardes')

function sauvegarder() {
  const base = path.basename(etat.fichier, '.ktec')
  fs.mkdirSync(dossierSauvegardes(), { recursive: true })
  const existantes = listerSauvegardes()
  if (existantes[0] && Date.now() - existantes[0].date < 3_600_000) return // une par heure au plus
  const horodatage = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', 'h')
  fs.copyFileSync(etat.fichier, path.join(dossierSauvegardes(), `${base}-${horodatage}.ktec`))
  for (const ancienne of listerSauvegardes().slice(SAUVEGARDES_GARDEES)) fs.rmSync(ancienne.chemin, { force: true })
}

export function listerSauvegardes() {
  if (!etat.fichier || !fs.existsSync(dossierSauvegardes())) return []
  const base = path.basename(etat.fichier, '.ktec')
  return fs
    .readdirSync(dossierSauvegardes())
    .filter((nom) => nom.startsWith(base + '-') && nom.endsWith('.ktec'))
    .map((nom) => {
      const chemin = path.join(dossierSauvegardes(), nom)
      const infos = fs.statSync(chemin)
      return { nom, chemin, date: infos.mtimeMs, taille: infos.size }
    })
    .sort((a, b) => b.date - a.date)
}

// ---------------------------------------------------------------- état pour l'interface

export function etatPartage(cookie) {
  const verrou = lireVerrou()
  const autreAdmin = verrou && verrou.jeton !== etat.admin?.jeton && verrou.installation !== IDENTIFIANT_INSTALLATION && Date.now() - verrou.vu < VERROU_ABANDONNE ? publicDuVerrou(verrou) : null
  let taille = null
  try {
    taille = fs.statSync(etat.fichier).size
  } catch {}
  return {
    fichier: etat.fichier,
    nomFichier: etat.fichier ? path.basename(etat.fichier) : null,
    taille,
    ouvert: Boolean(connexion),
    version: etat.version,
    copieDu: etat.copieDu,
    motDePasse: connexion ? motDePasseDefini() : false,
    admin: etat.admin ? { nom: etat.admin.nom, depuis: etat.admin.depuis, auto: etat.admin.auto, ceNavigateur: estAdmin(cookie) } : null,
    autreAdmin,
    aPublier: etat.aPublier,
    publication: etat.publication,
    avertissement: etat.avertissement,
  }
}

// Avertissement affiché 2 minutes seulement (les problèmes de réseau, eux, restent affichés).
function avertirUnMoment(message) {
  etat.avertissement = message
  setTimeout(() => {
    if (etat.avertissement === message) etat.avertissement = null
  }, 120_000).unref()
}

// Pour signaler un changement fait sans passer par noterModification (ex. index de recherche).
export function changerVersion() {
  etat.version++
}
