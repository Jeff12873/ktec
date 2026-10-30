// La clé du site : elle chiffre la configuration rangée dans le fichier de connaissances (connexion MySQL,
// adresses, requêtes, réglages des applications). Sans mot de passe à taper : seul KTEC lit la configuration.
// La clé n'est jamais sur GitHub.
//
//   - créée une fois (Réglages › « Chiffrer la configuration », ou à la première connexion enregistrée) ;
//   - rangée dans le fichier de connaissances lui-même, emballée par une clé propre à KTEC : tous les postes qui
//     ouvrent le fichier la trouvent, sans rien installer ni importer, et sans appel au système (pas de DPAPI,
//     pas de PowerShell) ;
//   - exportable en un petit fichier (.ktecclef), à garder en lieu sûr.
//
// Chiffrement : AES-256-GCM. Une valeur chiffrée s'écrit « ENC1: » + base64(iv 12 octets | étiquette 16 | données).
// La clé emballée s'écrit « CLE1: » + la même chose, avec la clé de KTEC.

import crypto from 'node:crypto'

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

// La clé du site, lue dans le fichier ouvert (null : configuration en clair, ou clé absente du fichier).
let memo = { emballee: null, cle: null }
export function cleDuSite() {
  const emballee = lireMarque()?.cle || null
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
    throw Object.assign(new Error('Ce fichier n’est pas une clé du site KTEC.'), { statut: 400 })
  }
  if (j.format !== 'ktec-cle-du-site' || !j.cle) throw Object.assign(new Error('Ce fichier n’est pas une clé du site KTEC.'), { statut: 400 })
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
