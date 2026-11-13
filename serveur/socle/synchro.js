// Le fichier partagé chiffré, bloc par bloc, et sa synchronisation avec ce poste. Sans dépendance : ce module tourne
// aussi dans un fil de travail (synchro-tache.js), pour que K.NOVA ne se fige pas pendant un transfert.
//
// Format : « KTECCHIF1\n » + empreinte de la clé (16) + « \n », puis des blocs : drapeau (1 = dernier) | taille (4) |
// iv (12) | étiquette (16) | données. L'en-tête, le numéro du bloc et le drapeau sont authentifiés (ni bloc échangé,
// ni fichier tronqué). Les blocs font 1 Mo (8 Mo dans les fichiers écrits avant K.NOVA 0.12 : encore lus).
//
// Sur le réseau, seuls les blocs qui ont changé voyagent :
//   cache/miroir.ktec  copie exacte (en clair) du fichier partagé, jamais ouverte par SQLite
//   cache/miroir.json  pour chaque bloc : son étiquette sur le partage, sa taille et l'empreinte de son contenu
// - Réception : on lit les en-têtes des blocs (quelques Ko) et on ne télécharge que ceux dont l'étiquette a changé.
// - Envoi : la copie de travail est comparée au miroir bloc par bloc. Les blocs changés sont d'abord écrits dans
//   « connaissances.ktec.maj » (journal complet, renommé d'un coup), puis recopiés à leur place dans le fichier
//   partagé ; le journal est ensuite effacé. Un envoi interrompu est rejoué au passage suivant (par le poste qui a
//   le verrou, ou par n'importe qui si le verrou est abandonné). Un lecteur qui voit le journal, ou des en-têtes qui
//   ont bougé pendant sa lecture, recommence plus tard : il ne lit jamais un fichier à moitié écrit.
// - Beaucoup de blocs changés (compactage, nouvelle clé) ou ancien format : tout le fichier est renvoyé sous un nom
//   temporaire puis renommé d'un coup, comme avant.

import fs from 'node:fs'
import crypto from 'node:crypto'

const ENTETE = 'KTECCHIF1\n'
const LONGUEUR_ENTETE = ENTETE.length + 17
const BLOC = 1024 * 1024
const BLOC_MAX = 8 * 1024 * 1024
const TETE = 33
const MAGIE_JOURNAL = Buffer.from('KTECMAJ1\n', 'latin1')
const ENVOI_MAX = 64 // blocs changés au-delà desquels on renvoie tout le fichier

export const empreinteCle = (c) => crypto.createHash('sha256').update(c).digest('hex').slice(0, 16)
export const signatureDe = (chemin) => {
  const infos = fs.statSync(chemin)
  return `${infos.size}-${infos.mtimeMs}`
}
const enteteDe = (c) => Buffer.from(`${ENTETE}${empreinteCle(c)}\n`, 'latin1')
const empreinteBloc = (b) => crypto.createHash('sha256').update(b).digest('base64').slice(0, 22)
const abime = () => Object.assign(new Error('Fichier de connaissances abîmé ou mauvaise clé du site.'), { statut: 423 })
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

const aad = (entete, numero, dernier) => {
  const b = Buffer.alloc(5)
  b.writeUInt32BE(numero)
  b[4] = dernier ? 1 : 0
  return Buffer.concat([entete, b])
}

function chiffrerBloc(c, entete, numero, dernier, clair) {
  const iv = crypto.randomBytes(12)
  const chiffreur = crypto.createCipheriv('aes-256-gcm', c, iv)
  chiffreur.setAAD(aad(entete, numero, dernier))
  const donnees = Buffer.concat([chiffreur.update(clair), chiffreur.final()])
  const tete = Buffer.alloc(5)
  tete[0] = dernier ? 1 : 0
  tete.writeUInt32BE(donnees.length, 1)
  const etiquette = chiffreur.getAuthTag()
  return { octets: Buffer.concat([tete, iv, etiquette, donnees]), etiquette: etiquette.toString('hex') }
}

function dechiffrerBloc(c, entete, numero, tete, donnees) {
  const dechiffreur = crypto.createDecipheriv('aes-256-gcm', c, tete.subarray(5, 17))
  dechiffreur.setAAD(aad(entete, numero, tete[0] === 1))
  dechiffreur.setAuthTag(tete.subarray(17, 33))
  try {
    return Buffer.concat([dechiffreur.update(donnees), dechiffreur.final()])
  } catch {
    throw abime()
  }
}

// L'empreinte d'un fichier partagé chiffré (null : fichier en clair, une base SQLite ordinaire).
export function empreinteDuFichier(chemin) {
  const fd = fs.openSync(chemin, 'r')
  try {
    const tete = Buffer.alloc(LONGUEUR_ENTETE)
    const lus = fs.readSync(fd, tete, 0, LONGUEUR_ENTETE, 0)
    if (lus < LONGUEUR_ENTETE || tete.subarray(0, ENTETE.length).toString('latin1') !== ENTETE) return null
    return tete.subarray(ENTETE.length, ENTETE.length + 16).toString('latin1')
  } finally {
    fs.closeSync(fd)
  }
}

// Les en-têtes de tous les blocs : { entete, empreinte, blocs: [{ position, longueur, clair, dernier, tete, etiquette }] }.
function lireTetes(fd) {
  const entete = Buffer.alloc(LONGUEUR_ENTETE)
  if (fs.readSync(fd, entete, 0, LONGUEUR_ENTETE, 0) < LONGUEUR_ENTETE || entete.subarray(0, ENTETE.length).toString('latin1') !== ENTETE) throw abime()
  const blocs = []
  let position = LONGUEUR_ENTETE
  let clair = 0
  for (;;) {
    const tete = Buffer.alloc(TETE)
    if (fs.readSync(fd, tete, 0, TETE, position) < TETE) throw abime()
    const longueur = tete.readUInt32BE(1)
    if (longueur > BLOC_MAX) throw abime()
    blocs.push({ position, longueur, clair, dernier: tete[0] === 1, tete, etiquette: tete.subarray(17, 33).toString('hex') })
    position += TETE + longueur
    clair += longueur
    if (tete[0] === 1) break
  }
  return { entete, empreinte: entete.subarray(ENTETE.length, ENTETE.length + 16).toString('latin1'), blocs, tailleClair: clair }
}

// Chiffre toute la base « source » dans « destination » (et en recopie le clair dans « copie »). Renvoie les blocs.
function chiffrerTout(source, destination, c, copie = null) {
  const entete = enteteDe(c)
  const taille = fs.statSync(source).size
  const lecture = fs.openSync(source, 'r')
  const ecriture = fs.openSync(destination, 'w')
  const miroir = copie ? fs.openSync(copie, 'w') : null
  const blocs = []
  try {
    fs.writeSync(ecriture, entete)
    const tampon = Buffer.alloc(BLOC)
    let position = 0
    for (let numero = 0; ; numero++) {
      const lus = fs.readSync(lecture, tampon, 0, BLOC, position)
      position += lus
      const dernier = position >= taille || lus < BLOC
      const clair = tampon.subarray(0, lus)
      const b = chiffrerBloc(c, entete, numero, dernier, clair)
      fs.writeSync(ecriture, b.octets)
      if (miroir !== null) fs.writeSync(miroir, clair)
      blocs.push({ t: b.etiquette, l: lus, h: empreinteBloc(clair) })
      if (dernier) break
    }
    fs.fsyncSync(ecriture)
  } finally {
    fs.closeSync(lecture)
    fs.closeSync(ecriture)
    if (miroir !== null) fs.closeSync(miroir)
  }
  return blocs
}

export function chiffrerFichier(source, destination, c) {
  chiffrerTout(source, destination, c)
}

// ---------------------------------------------------------------- état du miroir

function lireEtat(chemin) {
  try {
    return JSON.parse(fs.readFileSync(chemin, 'utf8'))
  } catch {
    return null
  }
}
function ecrireEtat(chemin, etat) {
  fs.writeFileSync(chemin + '.envoi', JSON.stringify(etat))
  fs.renameSync(chemin + '.envoi', chemin)
}

// Le compteur de modifications de la base SQLite (en-tête, octets 24 à 27) : il change à chaque écriture validée.
function compteurDe(fd) {
  const b = Buffer.alloc(4)
  fs.readSync(fd, b, 0, 4, 24)
  return b.readUInt32BE(0)
}

// Sous Windows, le renommage échoue si un autre poste est en train de lire le fichier : on réessaie.
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
      pause(300)
    }
  }
}

// ---------------------------------------------------------------- journal d'envoi

// Journal : magie | taille du JSON (4) | JSON { taille, blocs: [[position, longueur]…] } | octets | sha256 de ce qui précède.
function ecrireJournal(fichier, ecrits, tailleFinale) {
  const description = Buffer.from(JSON.stringify({ taille: tailleFinale, blocs: ecrits.map((e) => [e.position, e.octets.length]) }))
  const longueur = Buffer.alloc(4)
  longueur.writeUInt32BE(description.length)
  const corps = Buffer.concat([MAGIE_JOURNAL, longueur, description, ...ecrits.map((e) => e.octets)])
  const envoi = fichier + '.maj.envoi'
  const fd = fs.openSync(envoi, 'w')
  try {
    fs.writeSync(fd, corps)
    fs.writeSync(fd, crypto.createHash('sha256').update(corps).digest())
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  remplacer(envoi, fichier + '.maj')
}

// Recopie les blocs du journal à leur place dans le fichier partagé, puis l'efface. Sans effet s'il est rejoué deux fois.
function rejouerJournal(fichier) {
  const chemin = fichier + '.maj'
  let brut
  try {
    brut = fs.readFileSync(chemin)
  } catch {
    return
  }
  const corps = brut.subarray(0, brut.length - 32)
  const complet = brut.length > MAGIE_JOURNAL.length + 36 && corps.subarray(0, MAGIE_JOURNAL.length).equals(MAGIE_JOURNAL) && crypto.createHash('sha256').update(corps).digest().equals(brut.subarray(brut.length - 32))
  // Journal incomplet : il n'a jamais été renommé en entier, le fichier partagé n'a pas été touché.
  if (complet) {
    const longueur = corps.readUInt32BE(MAGIE_JOURNAL.length)
    const debut = MAGIE_JOURNAL.length + 4
    const { taille, blocs } = JSON.parse(corps.subarray(debut, debut + longueur).toString())
    const fd = fs.openSync(fichier, 'r+')
    try {
      let position = debut + longueur
      for (const [cible, octets] of blocs) {
        fs.writeSync(fd, corps, position, octets, cible)
        position += octets
      }
      fs.ftruncateSync(fd, taille)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  }
  fs.rmSync(chemin, { force: true })
}

// ---------------------------------------------------------------- réception

// Met le miroir à jour depuis le fichier partagé, et en fait une copie de travail neuve (« copie ») s'il a changé ou
// si forcerCopie. Renvoie { change, etat, copie } ; { occupe: true } si un envoi est en cours (on réessaiera).
export function rafraichir({ fichier, miroir, cheminEtat, cle, copie = null, forcerCopie = false, peutReparer = false }) {
  if (fs.existsSync(fichier + '.maj')) {
    if (!peutReparer) return { occupe: true }
    rejouerJournal(fichier)
  }
  const ancien = lireEtat(cheminEtat)
  const resultat = cle ? rafraichirChiffre({ fichier, miroir, cheminEtat, cle }, ancien) : rafraichirEnClair({ fichier, miroir, cheminEtat }, ancien)
  if (resultat.occupe) return resultat
  if (copie && (resultat.change || forcerCopie)) fs.copyFileSync(miroir, copie)
  else copie = null
  return { ...resultat, copie }
}

function rafraichirChiffre({ fichier, miroir, cheminEtat, cle }, ancien) {
  const signature = signatureDe(fichier)
  const fd = fs.openSync(fichier, 'r')
  try {
    const t = lireTetes(fd)
    if (t.empreinte !== empreinteCle(cle)) throw abime()
    const valide = ancien?.fichier === fichier && ancien.empreinte === t.empreinte && Array.isArray(ancien.blocs) && fs.existsSync(miroir)
    let aLire = []
    let decale = !valide
    let ancienClair = 0
    t.blocs.forEach((b, i) => {
      const a = valide ? ancien.blocs[i] : null
      if (!a || a.t !== b.etiquette) aLire.push(i)
      // Un bloc inchangé mais décalé (un bloc précédent a changé de taille) : on refait tout le miroir.
      else if (ancienClair !== b.clair) decale = true
      ancienClair += a?.l ?? 0
    })
    if (decale) aLire = t.blocs.map((_, i) => i)
    if (!aLire.length) {
      const etat = { ...ancien, signature }
      ecrireEtat(cheminEtat, etat)
      return { change: false, etat }
    }

    const cible = decale ? miroir + '.nouveau' : miroir
    const blocs = decale ? [] : ancien.blocs.slice(0, t.blocs.length)
    const sortie = fs.openSync(cible, decale ? 'w' : 'r+')
    try {
      for (const i of aLire) {
        const b = t.blocs[i]
        const clair = lireBloc(fd, fichier, t, i, cle)
        if (!clair) return { occupe: true }
        fs.writeSync(sortie, clair, 0, clair.length, b.clair)
        blocs[i] = { t: b.etiquette, l: b.longueur, h: empreinteBloc(clair) }
      }
      fs.ftruncateSync(sortie, t.tailleClair)
    } finally {
      fs.closeSync(sortie)
    }
    // Le fichier a-t-il bougé pendant la lecture (un envoi a commencé) ? On recommencera : le miroir.json n'a pas
    // changé, les blocs déjà réécrits seront relus.
    const apres = lireTetes(fd)
    if (fs.existsSync(fichier + '.maj') || apres.blocs.length !== t.blocs.length || apres.blocs.some((b, i) => b.etiquette !== t.blocs[i].etiquette)) {
      if (decale) fs.rmSync(cible, { force: true })
      return { occupe: true }
    }
    if (decale) fs.renameSync(cible, miroir)
    const etat = { fichier, empreinte: t.empreinte, signature, generation: (ancien?.generation || 0) + 1, blocs }
    ecrireEtat(cheminEtat, etat)
    return { change: true, etat, transferes: aLire.length }
  } finally {
    fs.closeSync(fd)
  }
}

// Un bloc déchiffré ; null si un envoi est en train de l'écrire (journal présent). Bloc illisible deux fois de suite
// sans envoi en cours : fichier abîmé ou mauvaise clé.
function lireBloc(fd, fichier, t, i, cle) {
  const b = t.blocs[i]
  for (let essai = 1; ; essai++) {
    try {
      const tete = Buffer.alloc(TETE)
      const donnees = Buffer.alloc(b.longueur)
      if (fs.readSync(fd, tete, 0, TETE, b.position) < TETE || fs.readSync(fd, donnees, 0, b.longueur, b.position + TETE) < b.longueur) throw abime()
      return dechiffrerBloc(cle, t.entete, i, tete, donnees)
    } catch (e) {
      if (fs.existsSync(fichier + '.maj')) return null
      if (essai >= 2) throw e
      pause(300)
    }
  }
}

function rafraichirEnClair({ fichier, miroir, cheminEtat }, ancien) {
  const signature = signatureDe(fichier)
  if (ancien?.fichier === fichier && ancien.empreinte === null && ancien.signature === signature && fs.existsSync(miroir)) return { change: false, etat: ancien }
  fs.copyFileSync(fichier, miroir + '.nouveau')
  fs.renameSync(miroir + '.nouveau', miroir)
  const etat = { fichier, empreinte: null, signature, generation: (ancien?.generation || 0) + 1, blocs: null }
  ecrireEtat(cheminEtat, etat)
  return { change: true, etat }
}

// ---------------------------------------------------------------- envoi

// Publie la copie de travail « base » sur le partage. Renvoie { etat, envoyes } ; { aRefaire: true } si la base a été
// modifiée pendant la lecture (on recommencera).
export function publier({ fichier, base, miroir, cheminEtat, cle, poste }) {
  // Envoi précédent interrompu : on le termine d'abord (ce poste a le verrou).
  if (fs.existsSync(fichier + '.maj')) rejouerJournal(fichier)
  fs.rmSync(fichier + '.maj.envoi', { force: true })
  const ancien = lireEtat(cheminEtat)
  const fdBase = fs.openSync(base, 'r')
  try {
    const compteur = compteurDe(fdBase)
    const taille = fs.fstatSync(fdBase).size
    if (!cle) return publierEnClair({ fichier, base, miroir, cheminEtat, poste }, ancien, fdBase, compteur)
    const empreinte = empreinteCle(cle)
    let t = null
    try {
      const fd = fs.openSync(fichier, 'r')
      try {
        t = lireTetes(fd)
      } finally {
        fs.closeSync(fd)
      }
    } catch {}
    const compatible = t && t.empreinte === empreinte && ancien?.fichier === fichier && ancien.empreinte === empreinte && Array.isArray(ancien.blocs) && t.blocs.slice(0, -1).every((b) => b.longueur === BLOC) && fs.existsSync(miroir)
    const toutRenvoyer = () => publierTout({ fichier, base, miroir, cheminEtat, cle, poste }, ancien, fdBase, compteur)
    if (!compatible) return toutRenvoyer()

    const n = Math.max(1, Math.ceil(taille / BLOC))
    const changes = []
    const blocs = []
    const tampon = Buffer.alloc(BLOC)
    for (let i = 0; i < n; i++) {
      const lus = fs.readSync(fdBase, tampon, 0, BLOC, i * BLOC)
      const clair = tampon.subarray(0, lus)
      const h = empreinteBloc(clair)
      const a = ancien.blocs[i]
      const distant = t.blocs[i]
      const dernier = i === n - 1
      if (!a || !distant || a.h !== h || a.t !== distant.etiquette || distant.dernier !== dernier || distant.longueur !== lus) {
        if (changes.length >= ENVOI_MAX) return toutRenvoyer()
        changes.push({ i, clair: Buffer.from(clair), dernier })
      }
      blocs.push({ t: distant?.etiquette, l: lus, h })
    }
    if (compteurDe(fdBase) !== compteur || fs.fstatSync(fdBase).size !== taille) return { aRefaire: true }

    if (changes.length) {
      const ecrits = changes.map(({ i, clair, dernier }) => {
        const b = chiffrerBloc(cle, t.entete, i, dernier, clair)
        blocs[i].t = b.etiquette
        return { position: LONGUEUR_ENTETE + i * (TETE + BLOC), octets: b.octets }
      })
      ecrireJournal(fichier, ecrits, LONGUEUR_ENTETE + (n - 1) * (TETE + BLOC) + TETE + blocs[n - 1].l)
      rejouerJournal(fichier)
      // Le miroir suit : en cas d'arrêt avant la fin, les étiquettes du miroir.json ne correspondent plus au partage
      // et ces blocs seront relus.
      const fdMiroir = fs.openSync(miroir, 'r+')
      try {
        for (const { i, clair } of changes) fs.writeSync(fdMiroir, clair, 0, clair.length, i * BLOC)
        fs.ftruncateSync(fdMiroir, taille)
      } finally {
        fs.closeSync(fdMiroir)
      }
    }
    const etat = { fichier, empreinte, signature: signatureDe(fichier), generation: (ancien.generation || 0) + 1, blocs }
    ecrireEtat(cheminEtat, etat)
    return { etat, envoyes: changes.length }
  } finally {
    fs.closeSync(fdBase)
  }
}

function publierTout({ fichier, base, miroir, cheminEtat, cle, poste }, ancien, fdBase, compteur) {
  const envoi = `${fichier}.envoi-${poste}`
  const blocs = chiffrerTout(base, envoi, cle, miroir + '.nouveau')
  if (compteurDe(fdBase) !== compteur) {
    fs.rmSync(envoi, { force: true })
    fs.rmSync(miroir + '.nouveau', { force: true })
    return { aRefaire: true }
  }
  remplacer(envoi, fichier)
  fs.renameSync(miroir + '.nouveau', miroir)
  const etat = { fichier, empreinte: empreinteCle(cle), signature: signatureDe(fichier), generation: (ancien?.generation || 0) + 1, blocs }
  ecrireEtat(cheminEtat, etat)
  return { etat, envoyes: blocs.length }
}

// Ancien fichier en clair : copié en entier, comme avant.
function publierEnClair({ fichier, base, miroir, cheminEtat, poste }, ancien, fdBase, compteur) {
  fs.copyFileSync(base, miroir + '.nouveau')
  if (compteurDe(fdBase) !== compteur) {
    fs.rmSync(miroir + '.nouveau', { force: true })
    return { aRefaire: true }
  }
  const envoi = `${fichier}.envoi-${poste}`
  fs.copyFileSync(miroir + '.nouveau', envoi)
  remplacer(envoi, fichier)
  fs.renameSync(miroir + '.nouveau', miroir)
  const etat = { fichier, empreinte: null, signature: signatureDe(fichier), generation: (ancien?.generation || 0) + 1, blocs: null }
  ecrireEtat(cheminEtat, etat)
  return { etat, envoyes: 1 }
}
