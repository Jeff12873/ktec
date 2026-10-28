// Où se trouvent les choses sur ce poste.
//
// KTEC tourne depuis le dossier où il est installé (le profil de l'utilisateur) :
//   installation.json    → écrit par l'installation : moteur d'IA, Java, BIRT, pilote MySQL, carte graphique
//   reglages-poste.json  → réglages : connexion MySQL (sans le mot de passe), dossier de travail…
//   apps/                → les applications installées (BiRTEC, PDRTec, AITEC…), une par dossier
//   cache/               → fichiers temporaires (aperçus de rapports…)
//   moteur/              → Node, llama.cpp, Java, moteur BIRT : partagés par toutes les applications

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const WINDOWS = process.platform === 'win32'

export const chemins = {
  installation: path.join(RACINE, 'installation.json'),
  reglagesPoste: path.join(RACINE, 'reglages-poste.json'),
  cache: path.join(RACINE, 'cache'),
  interface: path.join(RACINE, 'interface'),
  socle: path.join(RACINE, 'serveur', 'socle'),
  applis: path.join(RACINE, 'apps'),
  journal: path.join(RACINE, 'journal.txt'),
}

export function version() {
  try {
    return fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim()
  } catch {
    return 'développement'
  }
}

// Dossier d'installation par défaut, dans le profil de l'utilisateur
// (les programmes ne peuvent pas être lancés ailleurs sur les postes verrouillés).
export function dossierInstallationParDefaut(nom = 'KTEC') {
  if (WINDOWS) {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    return path.join(local, nom)
  }
  const donnees = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  return path.join(donnees, nom.toLowerCase())
}

// Les modèles d'IA sont de simples fichiers de données, communs à toutes les applications.
// Sous Windows, on les range dans un dossier commun du poste pour ne pas les télécharger une fois par agent.
// Ceux d'une ancienne installation d'IASSITEC ou de BiRTEC sont repris tels quels.
export function dossierModelesParDefaut() {
  const public_ = process.env.PUBLIC || 'C:\\Users\\Public'
  const donnees = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  const anciens = WINDOWS
    ? ['IASSITEC', 'BiRTEC'].map((nom) => path.join(public_, nom, 'modeles'))
    : ['iassitec', 'birtec'].map((nom) => path.join(donnees, nom, 'modeles'))
  const existant = anciens.find((d) => fs.existsSync(d))
  if (existant) return existant
  return WINDOWS ? path.join(public_, 'KTEC', 'modeles') : path.join(dossierInstallationParDefaut(), 'modeles')
}

export function lireJson(fichier, defaut) {
  try {
    return JSON.parse(fs.readFileSync(fichier, 'utf8'))
  } catch {
    return defaut
  }
}

export function ecrireJson(fichier, donnees) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true })
  fs.writeFileSync(fichier, JSON.stringify(donnees, null, 2) + '\n')
}

// installation.json : null si l'installation n'a pas encore été faite (l'IA est alors absente).
export function installation() {
  return lireJson(chemins.installation, null)
}

const REGLAGES_DEFAUT = {
  // Connexion MySQL, commune à toutes les applications.
  // Les comptes et mots de passe sont dans le fichier de connaissances (chiffrés), jamais ici.
  mysql: { serveur: '', port: 3306, base: '', utilisateur: '' },
  dossierTravail: '',   // rapports créés et fichier .ktec par défaut (vide = Documents/KTEC)
  fichierKtec: '',      // fichier de connaissances du site (vide = <dossier de travail>/connaissances.ktec)
  arretIAMinutes: 20,   // l'IA libère la mémoire après ce délai sans question
  applisDev: [],        // en développement : dossiers d'applications chargés en plus de apps/
}

// La connexion MySQL peut aussi être rangée (chiffrée) dans le fichier de connaissances : elle y est commune
// à tous les postes. Le fichier la fournit par cette fonction (ktec.js) ; sinon, celle du poste.
let connexionPartagee = () => null
let dansConnexion = false
export function definirConnexionPartagee(fournisseur) {
  connexionPartagee = fournisseur
}

export function reglagesPoste() {
  const lus = lireJson(chemins.reglagesPoste, {})
  let partagee = null
  if (!dansConnexion) {
    dansConnexion = true // ouvrir le fichier de connaissances relit les réglages du poste : pas de boucle
    try {
      partagee = connexionPartagee()
    } catch {
      partagee = null
    } finally {
      dansConnexion = false
    }
  }
  // (sans les comptes ni les mots de passe : ils ne sortent du fichier que pour le moteur Java, voir mysql.js)
  const mysql = partagee?.serveur ? { serveur: partagee.serveur, port: partagee.port, base: partagee.base, utilisateur: partagee.utilisateur } : lus.mysql
  return { ...REGLAGES_DEFAUT, ...lus, mysql: { ...REGLAGES_DEFAUT.mysql, ...(mysql || {}) } }
}

// Le dossier de travail : rapports créés (.rptdesign) et, par défaut, le fichier .ktec.
export function dossierTravail() {
  const dossier = reglagesPoste().dossierTravail || path.join(os.homedir(), 'Documents', 'KTEC')
  for (const sous of ['rapports']) fs.mkdirSync(path.join(dossier, sous), { recursive: true })
  return dossier
}

export function modifierReglagesPoste(changements) {
  const reglages = { ...reglagesPoste(), ...changements }
  ecrireJson(chemins.reglagesPoste, reglages)
  return reglages
}

// Petit journal pour comprendre un problème après coup (journal.txt, 200 Ko au plus).
export function journal(...morceaux) {
  const ligne = `${new Date().toISOString()}  ${morceaux.join(' ')}\n`
  process.stdout.write(ligne)
  try {
    if (fs.existsSync(chemins.journal) && fs.statSync(chemins.journal).size > 200_000) {
      fs.renameSync(chemins.journal, chemins.journal + '.ancien')
    }
    fs.appendFileSync(chemins.journal, ligne)
  } catch {
    // le journal ne doit jamais empêcher l'application de fonctionner
  }
}
