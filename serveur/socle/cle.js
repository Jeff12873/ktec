// La clé du site : elle chiffre TOUT le fichier de connaissances partagé. Sans elle, le fichier ne s'ouvre pas.
// La clé n'est jamais sur GitHub, ni dans le fichier.
//
//   - créée avec le fichier, par l'administrateur, qui l'exporte (.ktecclef) pour les autres postes ;
//   - rangée sur chaque poste autorisé, dans le dossier de K.NOVA (cles/<empreinte>.ktecclef) : donnée une fois,
//     elle sert ensuite toute seule (pas de mot de passe à taper, pas de DPAPI ni de PowerShell) ;
//   - « Nouvelle clé » (administrateur) : le fichier est rechiffré, toutes les autres clés ne l'ouvrent plus ; un
//     poste qui n'a plus la bonne clé efface sa copie locale et redemande la clé.
// Limite : la clé est en clair dans le dossier de K.NOVA du poste ; elle protège le fichier du partage (copié,
// volé), pas un poste dont on aurait pris le contrôle.
//
// Deux chiffrements, AES-256-GCM, avec la même clé :
//   - le fichier partagé entier : « KTECCHIF1\n » + empreinte (16) + « \n », puis des blocs de 8 Mo au plus :
//     drapeau (1 = dernier) | taille (4) | iv (12) | étiquette (16) | données ; l'en-tête, le numéro du bloc et le
//     drapeau sont authentifiés (ni bloc échangé, ni fichier tronqué) ;
//   - les valeurs de la configuration (connexion MySQL, requêtes…), dans la copie locale aussi : « ENC1: » +
//     base64(iv 12 octets | étiquette 16 | données).
// Les anciens fichiers rangeaient la clé emballée dans le fichier (« CLE1: », clé de KTEC) : encore lue, le temps
// que l'administrateur chiffre tout le fichier.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { RACINE } from './installation.js'

const PREFIXE = 'ENC1:'
const EMBALLAGE = 'CLE1:'
const CLE_KTEC = crypto.createHash('sha256').update('KTEC · clé du site · emballage 1').digest()

// Où la clé est rangée : la marque « ktec.cle » du fichier de connaissances (fournie par ktec.js, qui l'écrit).
let lireMarque = () => null
export function definirMarque(lecteur) {
  lireMarque = lecteur
}

// L'empreinte d'une clé : notée dans le fichier, pour reconnaître la bonne clé sans la révéler.
export const empreinteCle = (c) => crypto.createHash('sha256').update(c).digest('hex').slice(0, 16)

export const nouvelleCle = () => crypto.randomBytes(32)

export function emballerCle(c) {
  return EMBALLAGE + sceller(c, CLE_KTEC).toString('base64')
}

// ---------------------------------------------------------------- les clés rangées sur ce poste

const dossierCles = path.join(RACINE, 'cles')
const cheminCle = (empreinte) => path.join(dossierCles, `${empreinte}.ktecclef`)

// La clé de ce poste pour cette empreinte (null s'il ne l'a pas).
export function cleDuPoste(empreinte) {
  if (!/^[0-9a-f]{16}$/.test(String(empreinte || ''))) return null
  try {
    const c = lireFichierCle(fs.readFileSync(cheminCle(empreinte), 'utf8'))
    return empreinteCle(c) === empreinte ? c : null
  } catch {
    return null
  }
}
export function rangerCle(c) {
  fs.mkdirSync(dossierCles, { recursive: true })
  fs.writeFileSync(cheminCle(empreinteCle(c)), fichierCle(c), { mode: 0o600 })
}
export function oublierCle(empreinte) {
  if (/^[0-9a-f]{16}$/.test(String(empreinte || ''))) fs.rmSync(cheminCle(empreinte), { force: true })
}

// La clé du site du fichier ouvert : celle du poste pour l'empreinte notée dans le fichier ; sinon (ancien
// fichier) la clé emballée dans le fichier. null : configuration en clair, ou clé absente.
let memo = { emballee: null, cle: null }
export function cleDuSite() {
  const marque = lireMarque()
  const duPoste = cleDuPoste(marque?.empreinte)
  if (duPoste) return duPoste
  const emballee = marque?.cle || null
  if (emballee !== memo.emballee) {
    let cle = null
    try {
      if (emballee?.startsWith(EMBALLAGE)) cle = ouvrir(Buffer.from(emballee.slice(EMBALLAGE.length), 'base64'), CLE_KTEC)
      if (cle && cle.length !== 32) cle = null
    } catch {
      cle = null
    }
    memo = { emballee, cle }
  }
  return memo.cle
}

// Le fichier à exporter (et à importer dans un autre fichier de connaissances du même site).
export function fichierCle(c = cleDuSite()) {
  return JSON.stringify({ format: 'ktec-cle-du-site', version: 1, empreinte: empreinteCle(c), cle: c.toString('base64'), exportee: new Date().toISOString() }, null, 2) + '\n'
}
export function lireFichierCle(texte) {
  let j
  try {
    j = JSON.parse(String(texte))
  } catch {
    throw Object.assign(new Error('Ce fichier n’est pas une clé du site K.NOVA.'), { statut: 400 })
  }
  if (j.format !== 'ktec-cle-du-site' || !j.cle) throw Object.assign(new Error('Ce fichier n’est pas une clé du site K.NOVA.'), { statut: 400 })
  const c = Buffer.from(j.cle, 'base64')
  if (c.length !== 32) throw Object.assign(new Error('Clé du site abîmée.'), { statut: 400 })
  return c
}

export const estChiffre = (valeur) => typeof valeur === 'string' && valeur.startsWith(PREFIXE)

export function chiffrer(texte, c = cleDuSite()) {
  if (!c) throw Object.assign(new Error('La clé du site manque dans ce fichier de connaissances (Réglages › Clé du site).'), { statut: 423 })
  return PREFIXE + sceller(Buffer.from(String(texte), 'utf8'), c).toString('base64')
}

// Renvoie le texte en clair, ou null si la clé manque ou n'est pas la bonne.
export function dechiffrer(valeur, c = cleDuSite()) {
  if (!estChiffre(valeur)) return valeur
  if (!c) return null
  try {
    return ouvrir(Buffer.from(valeur.slice(PREFIXE.length), 'base64'), c).toString('utf8')
  } catch {
    return null
  }
}

function sceller(donnees, c) {
  const iv = crypto.randomBytes(12)
  const chiffreur = crypto.createCipheriv('aes-256-gcm', c, iv)
  const sortie = Buffer.concat([chiffreur.update(donnees), chiffreur.final()])
  return Buffer.concat([iv, chiffreur.getAuthTag(), sortie])
}

function ouvrir(brut, c) {
  const dechiffreur = crypto.createDecipheriv('aes-256-gcm', c, brut.subarray(0, 12))
  dechiffreur.setAuthTag(brut.subarray(12, 28))
  return Buffer.concat([dechiffreur.update(brut.subarray(28)), dechiffreur.final()])
}

// ---------------------------------------------------------------- le fichier partagé entier

const ENTETE = 'KTECCHIF1\n'
const LONGUEUR_ENTETE = ENTETE.length + 17
const BLOC = 8 * 1024 * 1024

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

const aad = (entete, numero, dernier) => {
  const b = Buffer.alloc(5)
  b.writeUInt32BE(numero)
  b[4] = dernier ? 1 : 0
  return Buffer.concat([entete, b])
}

// Chiffre la base « source » (copie locale) dans « destination », bloc par bloc (le fichier peut peser 1 Go).
export function chiffrerFichier(source, destination, c) {
  const entete = Buffer.from(`${ENTETE}${empreinteCle(c)}\n`, 'latin1')
  const taille = fs.statSync(source).size
  const lecture = fs.openSync(source, 'r')
  const ecriture = fs.openSync(destination, 'w')
  try {
    fs.writeSync(ecriture, entete)
    const tampon = Buffer.alloc(BLOC)
    let position = 0
    for (let numero = 0; ; numero++) {
      const lus = fs.readSync(lecture, tampon, 0, BLOC, position)
      position += lus
      const dernier = position >= taille
      const iv = crypto.randomBytes(12)
      const chiffreur = crypto.createCipheriv('aes-256-gcm', c, iv)
      chiffreur.setAAD(aad(entete, numero, dernier))
      const donnees = Buffer.concat([chiffreur.update(tampon.subarray(0, lus)), chiffreur.final()])
      const tete = Buffer.alloc(5)
      tete[0] = dernier ? 1 : 0
      tete.writeUInt32BE(donnees.length, 1)
      fs.writeSync(ecriture, Buffer.concat([tete, iv, chiffreur.getAuthTag()]))
      fs.writeSync(ecriture, donnees)
      if (dernier) break
    }
  } finally {
    fs.closeSync(lecture)
    fs.closeSync(ecriture)
  }
}

// Déchiffre le fichier partagé « source » dans « destination ». Erreur si la clé n'est pas la bonne ou si le
// fichier est abîmé (bloc modifié, fichier tronqué).
export function dechiffrerFichier(source, destination, c) {
  const lecture = fs.openSync(source, 'r')
  const ecriture = fs.openSync(destination, 'w')
  const abime = () => Object.assign(new Error('Fichier de connaissances abîmé ou mauvaise clé du site.'), { statut: 423 })
  try {
    const entete = Buffer.alloc(LONGUEUR_ENTETE)
    fs.readSync(lecture, entete, 0, LONGUEUR_ENTETE, 0)
    let position = LONGUEUR_ENTETE
    const tete = Buffer.alloc(33)
    for (let numero = 0; ; numero++) {
      if (fs.readSync(lecture, tete, 0, 33, position) < 33) throw abime()
      position += 33
      const dernier = tete[0] === 1
      const longueur = tete.readUInt32BE(1)
      if (longueur > BLOC + 16) throw abime()
      const donnees = Buffer.alloc(longueur)
      if (fs.readSync(lecture, donnees, 0, longueur, position) < longueur) throw abime()
      position += longueur
      const dechiffreur = crypto.createDecipheriv('aes-256-gcm', c, tete.subarray(5, 17))
      dechiffreur.setAAD(aad(entete, numero, dernier))
      dechiffreur.setAuthTag(tete.subarray(17, 33))
      try {
        fs.writeSync(ecriture, Buffer.concat([dechiffreur.update(donnees), dechiffreur.final()]))
      } catch {
        throw abime()
      }
      if (dernier) break
    }
  } finally {
    fs.closeSync(lecture)
    fs.closeSync(ecriture)
  }
}
