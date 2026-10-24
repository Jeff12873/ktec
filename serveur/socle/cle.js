// La clé du site : elle chiffre la configuration rangée dans le fichier de connaissances (connexion MySQL,
// adresses, requêtes, réglages des applications). Sans mot de passe à taper : seul KTEC, sur un poste qui a la
// clé, lit la configuration. La clé n'est jamais sur GitHub.
//
//   - créée une fois (Réglages › « Chiffrer la configuration », ou au premier lancement d'un nouveau site) ;
//   - gardée sur chaque poste dans le dossier de KTEC (cle-site.dat), protégée sous Windows par la session
//     de l'utilisateur (DPAPI) : copiée sur un autre PC, elle ne sert à rien ;
//   - exportée en un petit fichier (.ktecclef) à garder en lieu sûr, et importée sur les autres postes.
//
// Chiffrement : AES-256-GCM. Une valeur chiffrée s'écrit « ENC1: » + base64(iv 12 octets | étiquette 16 | données).

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { RACINE, WINDOWS, journal } from './installation.js'

const FICHIER = path.join(RACINE, 'cle-site.dat')
const PREFIXE = 'ENC1:'
let cle // Buffer, null (pas de clé sur ce poste) ou undefined (pas encore lue)

// L'empreinte d'une clé : notée dans le fichier de connaissances, pour reconnaître la bonne clé sans la révéler.
export const empreinteCle = (c) => crypto.createHash('sha256').update(c).digest('hex').slice(0, 16)

export function cleDuPoste() {
  if (cle !== undefined) return cle
  cle = null
  try {
    if (!fs.existsSync(FICHIER)) return cle
    const contenu = fs.readFileSync(FICHIER, 'utf8').trim()
    cle = Buffer.from(WINDOWS ? dpapi('Unprotect', contenu) : contenu, 'base64')
    if (cle.length !== 32) throw new Error('clé de longueur inattendue')
  } catch (erreur) {
    journal(`Clé du site illisible sur ce poste : ${erreur.message}`)
    cle = null
  }
  return cle
}

export function enregistrerCle(nouvelle) {
  const texte = nouvelle.toString('base64')
  fs.writeFileSync(FICHIER, WINDOWS ? dpapi('Protect', texte) : texte, { mode: 0o600 })
  cle = nouvelle
}

export const nouvelleCle = () => crypto.randomBytes(32)

// Le fichier à exporter (et à importer sur un autre poste).
export function fichierCle(c = cleDuPoste()) {
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

export function chiffrer(texte, c = cleDuPoste()) {
  if (!c) throw Object.assign(new Error('La clé du site n’est pas sur ce poste : importez-la (Réglages › Clé du site).'), { statut: 423 })
  const iv = crypto.randomBytes(12)
  const chiffreur = crypto.createCipheriv('aes-256-gcm', c, iv)
  const donnees = Buffer.concat([chiffreur.update(String(texte), 'utf8'), chiffreur.final()])
  return PREFIXE + Buffer.concat([iv, chiffreur.getAuthTag(), donnees]).toString('base64')
}

// Renvoie le texte en clair, ou null si la clé manque ou n'est pas la bonne.
export function dechiffrer(valeur, c = cleDuPoste()) {
  if (!estChiffre(valeur)) return valeur
  if (!c) return null
  try {
    const brut = Buffer.from(valeur.slice(PREFIXE.length), 'base64')
    const dechiffreur = crypto.createDecipheriv('aes-256-gcm', c, brut.subarray(0, 12))
    dechiffreur.setAuthTag(brut.subarray(12, 28))
    return Buffer.concat([dechiffreur.update(brut.subarray(28)), dechiffreur.final()]).toString('utf8')
  } catch {
    return null
  }
}

// Windows : protection par la session de l'utilisateur (DPAPI), sans rien installer.
function dpapi(sens, texte) {
  const script = `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${sens}([Convert]::FromBase64String($env:KTEC_DONNEES), $null, 'CurrentUser'))`
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', env: { ...process.env, KTEC_DONNEES: sens === 'Protect' ? Buffer.from(texte).toString('base64') : texte }, timeout: 20_000, windowsHide: true }).trim()
    .replace(/^(.*)$/s, (b64) => (sens === 'Unprotect' ? Buffer.from(b64, 'base64').toString('utf8') : b64))
}
