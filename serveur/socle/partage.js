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
// - Chaque modification est publiée quelques secondes plus tard. Seuls les blocs qui ont changé voyagent, dans les
//   deux sens, et jamais un poste ne lit un fichier à moitié écrit (voir synchro.js). Les transferts tournent dans
//   un fil de travail : K.NOVA reste utilisable pendant ce temps.
// - Fichier chiffré (clé du site, voir cle.js) : la copie locale est déchiffrée avec la clé rangée sur ce poste.
//   Sans la bonne clé (jamais reçue, ou « Nouvelle clé » faite ailleurs), rien ne s'ouvre et les copies locales
//   sont effacées : le portail demande la clé.
// - Pas de sauvegarde automatique : chaque copie emporterait les données et la clé du site. La sauvegarde du
//   lecteur réseau (service informatique) protège le fichier, comme tout document.
//
// Les applications déclarent leurs tables avec ajouterStructure() : elles sont créées à chaque ouverture.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { RACINE, chemins, reglagesPoste, modifierReglagesPoste, journal } from './installation.js'
import { cleDuPoste, empreinteDuFichier } from './cle.js'
import { empreinteCle, signatureDe } from './synchro.js'

const DELAI_PUBLICATION = 3_000          // on regroupe les modifications rapprochées
const VERROU_ABANDONNE = 10 * 60_000     // verrou non rafraîchi depuis 10 min = poste planté
const ADMIN_INACTIF = 30 * 60_000        // on rend le verrou après 30 min sans modification
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
  cleManquante: null,    // empreinte de la clé du fichier partagé, quand ce poste ne l'a pas
  ouverture: false,      // un autre fichier arrive (changerFichier)
}
let connexion = null
let lectureSeule = true
const structures = []

// La requête en cours (cookie du mode administrateur), pour savoir qui écrit. Rempli par http.js.
export const requeteEnCours = new AsyncLocalStorage()

// Identifie cette installation (poste + dossier) : sur un même poste, chaque agent a la sienne.
const IDENTIFIANT_INSTALLATION = crypto.createHash('sha256').update(os.hostname() + RACINE).digest('hex').slice(0, 16)

const copieLocale = () => path.join(chemins.cache, 'base.ktec')
const miroir = () => path.join(chemins.cache, 'miroir.ktec')          // le fichier partagé tel quel, en clair
const cheminEtatMiroir = () => path.join(chemins.cache, 'miroir.json')
const cheminBaseDe = () => path.join(chemins.cache, 'base.json')     // de quel miroir vient la copie locale
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
// Le chemin du fichier partagé (sans calculer tout l'état : les contrôles de licence s'en servent).
export const fichierOuvert = () => etat.fichier

// La base ouverte (copie locale). Ouvre le fichier du poste au premier appel.
export function db() {
  if (!connexion && etat.ouverture) throw erreur(503, 'Le fichier de connaissances arrive depuis le partage : patientez un instant.')
  if (!connexion && !etat.cleManquante) ouvrirFichier(cheminParDefaut())
  if (!connexion) throw erreur(423, 'Le fichier de connaissances est chiffré : la clé du site manque sur ce poste.')
  return connexion
}

// L'empreinte de la clé qui manque à ce poste pour ouvrir le fichier (null : rien ne manque).
export const empreinteManquante = () => etat.cleManquante

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
  attendreTache()
  etat.fichier = fichier
  etat.signature = null
  etat.cleManquante = null
  try {
    const cle = cleDuPartage()
    const em = lireJson(cheminEtatMiroir())
    const de = lireJson(cheminBaseDe())
    if (em?.fichier === fichier && em.empreinte === (cle ? empreinteCle(cle) : null) && de?.fichier === fichier && de.de === em.generation && fs.existsSync(copieLocale())) {
      // La copie de ce poste date du dernier passage : ouverte tout de suite, les nouveautés suivent en arrière-plan.
      ouvrirBase(copieLocale(), { lectureSeule: true })
      etat.signature = em.signature
      etat.copieDu = fs.statSync(copieLocale()).mtime.toISOString()
      etat.version++
      setTimeout(suivre, 100)
    } else rafraichirMaintenant({ forcerCopie: true })
  } catch (e) {
    // Clé du site absente ou changée : le fichier reste fermé, le portail demande la clé.
    if (etat.cleManquante) {
      if (reglagesPoste().fichierKtec !== fichier) modifierReglagesPoste({ fichierKtec: fichier })
      return fichier
    }
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

// Changer de fichier depuis l'écran. Un fichier pas encore reçu sur ce poste (souvent sur un partage lent)
// arrive en arrière-plan : K.NOVA continue de répondre. En cas d'échec, l'ancien fichier est rouvert.
export async function changerFichier(fichier) {
  fichier = path.resolve(fichier)
  if (!fs.existsSync(fichier)) throw erreur(404, `Fichier introuvable : ${fichier}`)
  if (etat.ouverture) throw erreur(409, 'Un fichier est déjà en cours d’ouverture : patientez un instant.')
  if (lireJson(cheminEtatMiroir())?.fichier === fichier) return ouvrirFichier(fichier) // déjà sur ce poste
  const ancien = etat.fichier
  if (etat.admin) quitterAdmin()
  attendreTache()
  journal(`Ouverture du fichier de connaissances : ${fichier}`)
  connexion?.close()
  connexion = null
  Object.assign(etat, { fichier, signature: null, cleManquante: null, avertissement: null, ouverture: true })
  etat.version++
  try {
    for (let essai = 1; ; essai++) {
      const { valeur, erreur: e } = await lancerRafraichissement({ forcerCopie: true }).promesse
      if (e) throw e
      if (!valeur.occupe) break
      if (essai >= 10) throw erreur(503, 'Un autre poste est en train d’enregistrer ce fichier : réessayez dans un instant.')
      await new Promise((ok) => setTimeout(ok, 1000))
    }
  } catch (e) {
    // Clé du site absente : le fichier est retenu, le portail demande la clé.
    if (!etat.cleManquante) {
      journal(`Ouverture impossible de ${fichier} : ${`${e.code || ''} ${e.message}`.trim()}`)
      etat.ouverture = false
      if (ancien && ancien !== fichier) {
        try {
          ouvrirFichier(ancien)
        } catch {}
      }
      throw erreur(e.statut || 500, `Impossible d’ouvrir ce fichier : ${e.message}`)
    }
  } finally {
    etat.ouverture = false
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

const lireJson = (chemin) => {
  try {
    return JSON.parse(fs.readFileSync(chemin, 'utf8'))
  } catch {
    return null
  }
}
const ecrireJson = (chemin, valeur) => {
  fs.mkdirSync(path.dirname(chemin), { recursive: true })
  fs.writeFileSync(chemin, JSON.stringify(valeur))
}

// ---------------------------------------------------------------- transferts (fil de travail)

// Un transfert à la fois (synchro.js, dans synchro-tache.js). traiter(valeur, erreur) tourne ici, une seule fois,
// quand il se termine. tache.promesse → { valeur } ou { erreur } ; tache.attendre() : l'attend sans rendre la main
// (ouverture, prise du verrou, arrêt), et lève l'erreur.
let tacheEnCours = null
function lancerTache(operation, donnees, traiter) {
  const { port1, port2 } = new MessageChannel()
  const drapeau = new Int32Array(new SharedArrayBuffer(4))
  const travailleur = new Worker(new URL('./synchro-tache.js', import.meta.url), { workerData: { operation, donnees, port: port2, drapeau }, transferList: [port2] })
  let resultat = null
  const tache = {
    operation,
    finir(message) {
      if (resultat) return resultat
      port1.close()
      if (tacheEnCours === tache) tacheEnCours = null
      try {
        if (!message?.ok) throw Object.assign(new Error(message?.message || 'transfert interrompu'), { code: message?.code, statut: message?.statut })
        resultat = { valeur: traiter(message.valeur, null) }
      } catch (e) {
        try {
          traiter(null, e)
        } catch {}
        resultat = { erreur: e }
      }
      return resultat
    },
    attendre() {
      if (!resultat) {
        if (Atomics.wait(drapeau, 0, 0, 30 * 60_000) === 'timed-out') travailleur.terminate()
        tache.finir(receiveMessageOnPort(port1)?.message)
      }
      if (resultat.erreur) throw resultat.erreur
      return resultat.valeur
    },
  }
  tache.promesse = new Promise((ok) => {
    port1.on('message', (m) => ok(tache.finir(m)))
    travailleur.on('error', (e) => ok(tache.finir({ ok: false, message: e.message })))
  })
  tacheEnCours = tache
  return tache
}
const attendreTache = () => {
  try {
    tacheEnCours?.attendre()
  } catch {}
}

// La clé pour lire le fichier partagé (null : fichier en clair). Ce poste ne l'a pas : fichier fermé, erreur 423.
function cleDuPartage() {
  const empreinte = empreinteDuFichier(etat.fichier)
  if (!empreinte) return null
  const c = cleDuPoste(empreinte)
  if (c) return c
  fermerSansCle(empreinte)
  throw erreur(423, 'La clé du site manque sur ce poste.')
}

// Met la copie locale à jour depuis le partage (seuls les blocs changés voyagent).
function lancerRafraichissement({ forcerCopie = false } = {}) {
  const cle = cleDuPartage()
  const verrou = lireVerrou()
  // Un envoi interrompu se rejoue seulement par le poste qui a le verrou, ou si personne ne l'a plus.
  const peutReparer = Boolean(etat.admin) || !verrou || Date.now() - verrou.vu > VERROU_ABANDONNE
  fs.mkdirSync(chemins.cache, { recursive: true })
  const donnees = { fichier: etat.fichier, miroir: miroir(), cheminEtat: cheminEtatMiroir(), cle, copie: copieLocale() + '.copie', forcerCopie, peutReparer }
  return lancerTache('rafraichir', donnees, recevoir)
}

function recevoir(valeur, erreur) {
  if (erreur) {
    // Bloc illisible sans envoi en cours : mauvaise clé ou fichier abîmé.
    if (erreur.statut === 423) {
      try {
        fermerSansCle(empreinteDuFichier(etat.fichier) || 'inconnue')
      } catch {}
    }
    throw erreur
  }
  if (valeur.occupe) return valeur
  if (valeur.copie) {
    connexion?.close()
    connexion = null
    fs.renameSync(valeur.copie, copieLocale())
    ouvrirBase(copieLocale(), { lectureSeule: !etat.admin })
    ecrireJson(cheminBaseDe(), { fichier: etat.fichier, de: valeur.etat.generation })
    etat.version++
  }
  if (!connexion) ouvrirBase(copieLocale(), { lectureSeule: !etat.admin })
  etat.signature = valeur.etat.signature
  etat.copieDu = new Date().toISOString()
  etat.avertissement = null
  etat.cleManquante = null
  return valeur
}

// Le même, attendu sur place (ouverture, prise du verrou). Un autre poste en plein envoi : on réessaie un peu.
function rafraichirMaintenant(options) {
  attendreTache()
  for (let essai = 1; ; essai++) {
    const r = lancerRafraichissement(options).attendre()
    if (!r.occupe) return r
    if (essai >= 10) throw erreur(503, 'Un autre poste est en train d’enregistrer le fichier partagé : réessayez dans un instant.')
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000)
  }
}

// Ce poste n'a pas (ou plus) la clé du fichier : on ferme, et on efface les copies locales en clair.
function fermerSansCle(empreinte) {
  if (etat.cleManquante !== empreinte) journal('Clé du site absente ou changée : fichier de connaissances fermé, copie locale effacée')
  etat.cleManquante = empreinte
  if (etat.admin) {
    if (lireVerrou()?.jeton === etat.admin.jeton) fs.rmSync(cheminVerrou(), { force: true })
    etat.admin = null
    etat.aPublier = false
  }
  connexion?.close()
  connexion = null
  for (const chemin of [copieLocale(), miroir(), cheminEtatMiroir(), cheminBaseDe()]) fs.rmSync(chemin, { force: true })
  etat.signature = null
  etat.version++
  etat.avertissement = null
}

// Toutes les 10 secondes : en consultation, on suit les changements faits par un autre poste.
function suivre() {
  if (!etat.fichier || etat.admin || tacheEnCours || etat.ouverture) return
  try {
    if (connexion && signatureDe(etat.fichier) === etat.signature) return lectureRetablie()
    lancerRafraichissement().promesse.then(({ valeur, erreur }) => {
      if (erreur) return lectureImpossible(erreur)
      if (valeur.change) journal(`Nouvelle version du fichier de connaissances chargée (${valeur.transferes ?? 'tous les'} blocs reçus)`)
      if (!valeur.occupe) lectureRetablie()
    })
  } catch (e) {
    lectureImpossible(e)
  }
}
setInterval(suivre, 10_000).unref()
let derniereErreurLecture = null

function lectureRetablie() {
  if (derniereErreurLecture) journal('Fichier partagé de nouveau accessible')
  derniereErreurLecture = null
}
function lectureImpossible(e) {
  if (etat.cleManquante) return // le portail demande la clé
  etat.avertissement = 'Le fichier partagé est inaccessible : vous consultez la dernière copie enregistrée sur ce poste.'
  // La cause (code système : EBUSY, EPERM, ENOENT…) dans le journal, une fois par panne : pour diagnostiquer un partage réseau.
  const cause = `${e.code || ''} ${e.message}`.trim()
  if (cause !== derniereErreurLecture) journal(`Lecture du fichier partagé impossible : ${cause}`)
  derniereErreurLecture = cause
}

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
    // On repart de la toute dernière version du partage, cette fois en écriture.
    attendreTache()
    const em = lireJson(cheminEtatMiroir())
    const de = lireJson(cheminBaseDe())
    const aJour = connexion && em && de?.fichier === etat.fichier && de.de === em.generation && signatureDe(etat.fichier) === etat.signature && !fs.existsSync(etat.fichier + '.maj')
    if (!aJour) rafraichirMaintenant({ forcerCopie: true })
    ouvrirBase(copieLocale(), { lectureSeule: false })
    ecrireJson(cheminBaseDe(), { fichier: etat.fichier, de: null }) // la copie va diverger du miroir
  } catch (e) {
    quitterAdmin()
    throw e
  }
  journal(`Modification du fichier de connaissances : ${nom}${auto ? ' (automatique)' : ''}`)
  return { ok: true }
}

export function quitterAdmin() {
  if (!etat.admin) return
  clearTimeout(minuterie)
  try {
    attendreTache()
    if (etat.aPublier) lancerPublication()?.attendre()
  } catch (e) {
    journal(`Publication impossible en rendant la main : ${e.message}`)
  }
  const verrou = lireVerrou()
  if (verrou?.jeton === etat.admin.jeton) fs.rmSync(cheminVerrou(), { force: true })
  journal(`Fin des modifications : ${etat.admin.nom}`)
  etat.admin = null
  revenirEnConsultation()
}

// Tout est publié : la copie locale est celle du miroir. Sinon (partage inaccessible, verrou repris), les
// modifications non publiées sont perdues : on repart du partage.
function revenirEnConsultation({ reconstruire = etat.aPublier } = {}) {
  etat.aPublier = false
  try {
    if (reconstruire) rafraichirMaintenant({ forcerCopie: true })
    else {
      ouvrirBase(copieLocale(), { lectureSeule: true })
      ecrireJson(cheminBaseDe(), { fichier: etat.fichier, de: lireJson(cheminEtatMiroir())?.generation ?? null })
    }
  } catch {
    ouvrirBase(copieLocale(), { lectureSeule: true })
  }
}

export function estAdmin(cookie) {
  return Boolean(etat.admin && cookie && etat.admin.cookie === cookie)
}

// Avec une licence, les comptes (comptes.js) décident : qui est administrateur, qui peut modifier quoi.
// Sans licence, ces contrôles ne répondent rien et tout fonctionne comme avant.
const controles = {}
export function definirControles(c) {
  Object.assign(controles, c)
}
const licenceActive = () => Boolean(controles.actif?.())
// Le niveau du compte de ce poste pour une application (null : pas de licence).
export const accesAppli = (id) => controles.acces?.(id) ?? null
// Avant une écriture dans la GMAO : il faut le droit d'écriture sur l'application (pas de verrou à prendre).
export const exigerDroitEcriture = () => controles.ecriture?.({})

// Réglages, SQL et comptes MySQL : réservés à ce mode (navigateur administrateur, ou fichier sans mot de passe).
export function modeAdmin(cookie) {
  try {
    const licence = controles.admin?.()
    if (licence !== null && licence !== undefined) return licence
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
  // Licence : les droits du compte Windows remplacent le mot de passe (refus levé par le contrôle).
  const licence = Boolean(controles.ecriture?.({ pourTous }))
  if (motDePasseDefini() && !pourTous && !licence) {
    if (etat.admin && (!requete || requete.cookie === etat.admin.cookie)) return
    throw erreur(403, 'Modification réservée au mode administrateur : cliquez sur « Consultation » en haut de l’écran.')
  }
  if (etat.admin) return
  const resultat = entrerAdmin(reglagesPoste().nomAgent || os.userInfo().username, { auto: true })
  // Main prise pour un utilisateur sur un fichier protégé : rendue peu après la publication (voir publier).
  if (!resultat.occupe && (motDePasseDefini() || licence)) etat.admin.pourTous = true
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
    clearTimeout(minuterie)
    attendreTache()
    revenirEnConsultation({ reconstruire: true })
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
  if (!etat.admin || !etat.aPublier) return
  if (tacheEnCours) {
    minuterie = setTimeout(publierPlusTard, 1000)
    return
  }
  let tache
  try {
    // La base change sans cesse pendant la lecture (long calcul) : la quatrième fois, on publie sur place.
    if (refaits >= 3) {
      refaits = 0
      return lancerPublication()?.attendre()
    }
    tache = lancerPublication()
  } catch (e) {
    return echecPublication(e)
  }
  tache?.promesse.then(({ valeur, erreur }) => {
    if (erreur) return echecPublication(erreur)
    if (valeur.aRefaire) {
      refaits++
      clearTimeout(minuterie)
      minuterie = setTimeout(publierPlusTard, 1000)
    } else refaits = 0
  })
}
let refaits = 0

function echecPublication(e) {
  etat.publication.erreur = e.message
  journal(`Publication impossible : ${e.code ? `${e.code} ` : ''}${e.message} (nouvel essai dans 30 s)`)
  clearTimeout(minuterie)
  minuterie = setTimeout(publierPlusTard, 30_000)
}

// Envoie la copie locale sur le partage (seuls les blocs changés voyagent), dans le fil de travail.
function lancerPublication() {
  if (!etat.admin || !etat.aPublier) return null
  if (lireVerrou()?.jeton !== etat.admin.jeton) throw new Error('le verrou ne nous appartient plus')
  // Fichier chiffré (marque « complet » de la clé du site) : tout part chiffré ; sinon (ancien fichier) tel quel.
  const marque = marqueLocale()
  let cle = null
  if (marque?.complet) {
    cle = cleDuPoste(marque.empreinte)
    if (!cle) throw new Error('la clé du site manque sur ce poste')
  }
  etat.aPublier = false // une modification pendant l'envoi le remet, et relance une publication
  const donnees = { fichier: etat.fichier, base: copieLocale(), miroir: miroir(), cheminEtat: cheminEtatMiroir(), cle, poste: os.hostname() }
  return lancerTache('publier', donnees, (valeur, erreur) => {
    if (erreur || valeur.aRefaire) {
      etat.aPublier = true
      if (erreur) throw erreur
      return valeur
    }
    etat.signature = valeur.etat.signature
    etat.publication = { derniere: new Date().toISOString(), erreur: null }
    // Main prise pour un utilisateur : rendue après 2 minutes sans écriture (une analyse en cours écrit souvent).
    if (etat.admin?.pourTous) setTimeout(() => {
      if (etat.admin?.pourTous && !etat.aPublier && Date.now() - etat.admin.derniereAction >= 110_000) quitterAdmin()
    }, 120_000).unref()
    return valeur
  })
}

// La marque de la clé du site dans la copie locale (écrite par ktec.js) : { empreinte, depuis, complet }.
function marqueLocale() {
  try {
    return JSON.parse(connexion.prepare("SELECT valeur FROM infos WHERE cle = 'ktec.cle'").get()?.valeur || 'null')
  } catch {
    return null
  }
}

// Publie tout de suite (avant l'arrêt de KTEC).
export function publierMaintenant() {
  clearTimeout(minuterie)
  if (etat.admin) quitterAdmin()
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
    motDePasse: connexion ? motDePasseDefini() && !licenceActive() : false,
    admin: etat.admin ? { nom: etat.admin.nom, depuis: etat.admin.depuis, auto: etat.admin.auto, ceNavigateur: estAdmin(cookie) } : null,
    autreAdmin,
    aPublier: etat.aPublier,
    publication: etat.publication,
    avertissement: etat.avertissement,
    cleManquante: Boolean(etat.cleManquante),
    transfert: tacheEnCours ? (tacheEnCours.operation === 'publier' ? 'envoi' : 'reception') : null,
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
