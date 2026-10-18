// Les composants communs à toutes les applications KTEC, installés une seule fois dans le dossier de KTEC :
//   node        → le Node qui fait tourner KTEC (celui du lanceur d'installation, recopié)
//   llama       → le moteur d'IA llama.cpp (version carte graphique Vulkan, sinon processeur)
//   java        → Java portable (JDK : il compile aussi le moteur Java de KTEC)
//   birt        → le moteur BIRT (seulement la partie « ReportEngine »)
//   connecteur  → le pilote MySQL (Connector/J)
//   moteurJava  → moteur-java/Moteur.java compilé
//   modeles     → modèle d'IA choisi (et son fichier « vision ») + modèle de recherche
//
// Hors ligne, tout est copié du kit (dossier hors-ligne/ à côté du lanceur) ; en ligne, téléchargé.
// Un composant déjà présent dans la bonne version n'est ni retéléchargé ni recopié.
// suivi(type, données) reçoit l'avancement : « etape », « progression », « message ».

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { telecharger, tailleLisible } from '../socle/telechargement.js'
import { decompresser } from '../socle/zip.js'
import { extraireTarGz } from '../socle/tar.js'
import { telechargerDepuisHuggingFace, modeleConseille, lireCatalogue } from '../socle/modeles.js'

const WINDOWS = process.platform === 'win32'

export const catalogue = () => lireCatalogue()

// ---------------------------------------------------------------- Node

// Le Node qui exécute l'installation est recopié : KTEC tournera avec la même version.
export function installerNode(dossier, suivi) {
  const cible = WINDOWS ? path.join(dossier, 'moteur', 'node', 'node.exe') : path.join(dossier, 'moteur', 'node', 'bin', 'node')
  if (fs.existsSync(cible) && fs.statSync(cible).size === fs.statSync(process.execPath).size) return suivi('message', 'Node déjà installé.')
  fs.mkdirSync(path.dirname(cible), { recursive: true })
  fs.copyFileSync(process.execPath, cible)
  if (!WINDOWS) fs.chmodSync(cible, 0o755)
  suivi('message', `Node ${process.version} installé.`)
}

// ---------------------------------------------------------------- llama.cpp

export async function installerLlama(dossier, kit, suivi) {
  const c = catalogue()
  let llama = await installerVarianteLlama(dossier, kit, 'vulkan', suivi)
  let appareils = listerAppareils(llama)
  if (appareils === null) {
    suivi('message', 'La version pour carte graphique ne fonctionne pas sur ce poste : version pour processeur.')
    llama = await installerVarianteLlama(dossier, kit, 'cpu', suivi)
    appareils = listerAppareils(llama) || []
  }
  return { llama, appareils, version: c.llama }
}

async function installerVarianteLlama(dossier, kit, variante, suivi) {
  const c = catalogue()
  const cible = path.join(dossier, 'moteur', `llama-${variante}`)
  const nomExe = WINDOWS ? 'llama-server.exe' : 'llama-server'
  const existant = trouverFichier(cible, nomExe)
  if (existant && fs.existsSync(path.join(cible, c.llama))) {
    suivi('message', `Moteur d'IA déjà installé (${variante}).`)
    return existant
  }
  fs.rmSync(cible, { recursive: true, force: true })
  if (kit) {
    if (!fs.existsSync(path.join(kit, `llama-${variante}`))) throw new Error(`llama.cpp (${variante}) absent du kit hors ligne`)
    await copierDossier(path.join(kit, `llama-${variante}`), cible, suivi, `Moteur d'IA (${variante})`)
  } else {
    const nomArchive = WINDOWS
      ? `llama-${c.llama}-bin-win-${variante}-x64.zip`
      : `llama-${c.llama}-bin-ubuntu-${variante === 'cpu' ? '' : variante + '-'}x64.tar.gz`
    const archive = path.join(dossier, 'moteur', nomArchive)
    await telecharger(`https://github.com/ggml-org/llama.cpp/releases/download/${c.llama}/${nomArchive}`, archive, { surProgression: progression(suivi, `Moteur d'IA (${variante})`) })
    fs.mkdirSync(cible, { recursive: true })
    if (WINDOWS) decompresser(fs.readFileSync(archive), cible)
    else extraireTarGz(fs.readFileSync(archive), cible)
    fs.rmSync(archive, { force: true })
  }
  fs.writeFileSync(path.join(cible, c.llama), '') // repère de la version installée
  const installe = trouverFichier(cible, nomExe)
  if (!installe) throw new Error('llama-server introuvable après installation')
  if (!WINDOWS) for (const f of fs.readdirSync(path.dirname(installe))) fs.chmodSync(path.join(path.dirname(installe), f), 0o755)
  suivi('message', `Moteur d'IA llama.cpp ${c.llama} installé (${variante}).`)
  return installe
}

// Les cartes que llama.cpp voit. null = le moteur ne démarre même pas.
export function listerAppareils(llama) {
  let sortie
  try {
    sortie = execFileSync(llama, ['--list-devices'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, windowsHide: true })
  } catch (erreur) {
    if (!erreur.stdout && !erreur.stderr) return null
    sortie = `${erreur.stdout || ''}${erreur.stderr || ''}`
    if (!/Available devices/.test(sortie)) return null
  }
  // Exemple : « Vulkan0: NVIDIA GeForce RTX 4060 (8188 MiB, 7900 MiB free) »
  const appareils = []
  for (const [, code, nom, memoire] of sortie.matchAll(/^\s*(\w+\d+): (.+?) \((\d+) MiB/gm)) {
    appareils.push({ code, nom, memoireGo: Math.round(memoire / 1024), integree: estIntegree(nom) })
  }
  return appareils
}

// Les cartes intégrées au processeur partagent la mémoire vive : on ne s'en sert pas.
function estIntegree(nom) {
  return /llvmpipe|Ryzen|Raphael|Mendocino|Phoenix|Rembrandt|Renoir|Cezanne|Radeon\(TM\) Graphics|Radeon Graphics|Vega \d|Intel\(R\) (UHD|HD|Iris|Graphics)|Intel.*Arc.*Graphics$|Microsoft Basic/i.test(nom)
}

export function choisirCarte(appareils) {
  return appareils.filter((a) => !a.integree && a.memoireGo >= 3).sort((a, b) => b.memoireGo - a.memoireGo)[0] || null
}

// ---------------------------------------------------------------- Java, BIRT, pilote MySQL

export async function installerJava(dossier, kit, suivi) {
  const c = catalogue()
  const cible = path.join(dossier, 'moteur', 'java')
  const nomJava = WINDOWS ? 'java.exe' : 'java'
  let java = trouverFichier(cible, nomJava)
  if (!java) {
    fs.rmSync(cible, { recursive: true, force: true })
    if (kit) {
      await copierDossier(path.join(kit, 'java'), cible, suivi, 'Java')
    } else {
      fs.mkdirSync(cible, { recursive: true })
      const archive = path.join(dossier, 'moteur', WINDOWS ? 'java.zip' : 'java.tar.gz')
      await telecharger(c.java[WINDOWS ? 'windows' : 'linux'], archive, { surProgression: progression(suivi, 'Java') })
      if (WINDOWS) decompresser(fs.readFileSync(archive), cible)
      else extraireTarGz(fs.readFileSync(archive), cible)
      fs.rmSync(archive, { force: true })
    }
    java = trouverFichier(cible, nomJava)
    if (!java) throw new Error('Java introuvable après installation')
  }
  const javac = path.join(path.dirname(java), WINDOWS ? 'javac.exe' : 'javac')
  if (!WINDOWS) for (const f of fs.readdirSync(path.dirname(java))) fs.chmodSync(path.join(path.dirname(java), f), 0o755)
  const versionJava = spawnSync(java, ['-version'], { encoding: 'utf8' }).stderr?.split('\n')[0] // java -version écrit sur la sortie d'erreur
  suivi('message', versionJava || 'Java prêt.')
  return { java, javac }
}

export async function installerBirt(dossier, kit, suivi) {
  const c = catalogue()
  const cible = path.join(dossier, 'moteur', 'birt')
  if (fs.existsSync(path.join(cible, 'lib')) && fs.existsSync(path.join(cible, c.birt.version))) {
    suivi('message', `Moteur BIRT ${c.birt.version} déjà installé.`)
    return cible
  }
  fs.rmSync(cible, { recursive: true, force: true })
  if (kit) {
    await copierDossier(path.join(kit, 'birt'), cible, suivi, 'Moteur BIRT')
  } else {
    const archive = path.join(dossier, 'moteur', 'birt.zip')
    await telecharger(c.birt.url, archive, { surProgression: progression(suivi, 'Moteur BIRT') })
    const temporaire = path.join(dossier, 'moteur', 'birt-temporaire')
    decompresser(fs.readFileSync(archive), temporaire, (nom) => nom.startsWith('ReportEngine/'))
    fs.renameSync(path.join(temporaire, 'ReportEngine'), cible)
    fs.rmSync(temporaire, { recursive: true, force: true })
    fs.rmSync(archive, { force: true })
  }
  fs.writeFileSync(path.join(cible, c.birt.version), '')
  suivi('message', `Moteur BIRT ${c.birt.version} installé.`)
  return cible
}

export async function installerConnecteur(dossier, kit, suivi) {
  const c = catalogue()
  const fichier = path.join(dossier, 'moteur', `mysql-connector-j-${c.connecteur.version}.jar`)
  if (!fs.existsSync(fichier)) {
    fs.mkdirSync(path.dirname(fichier), { recursive: true })
    if (kit) fs.copyFileSync(path.join(kit, path.basename(fichier)), fichier)
    else await telecharger(c.connecteur.url, fichier)
  }
  suivi('message', `Pilote MySQL ${c.connecteur.version} prêt.`)
  return fichier
}

// Compile moteur-java/Moteur.java (connexion MySQL, rapports BIRT) dans moteur/classes.
// Sans BIRT (aucune application ne le demande), seul le pilote MySQL est nécessaire… mais Moteur.java
// utilise les classes de BIRT : on compile alors avec BIRT s'il est là, sinon on l'installe quand même.
export function compilerMoteurJava(dossier, { javac }, birt, connecteur, suivi) {
  const classes = path.join(dossier, 'moteur', 'classes')
  fs.rmSync(classes, { recursive: true, force: true })
  fs.mkdirSync(classes, { recursive: true })
  const chemin = [connecteur, path.join(birt, 'lib', '*')].join(path.delimiter)
  const resultat = spawnSync(javac, ['-encoding', 'UTF-8', '-d', classes, '-cp', chemin, path.join(dossier, 'moteur-java', 'Moteur.java')], { encoding: 'utf8', windowsHide: true })
  if (resultat.status !== 0) throw new Error(`Compilation du moteur Java impossible : ${(resultat.stderr || resultat.error?.message || '').slice(0, 500)}`)
  suivi('message', 'Moteur Java de KTEC compilé.')
  return classes
}

// ---------------------------------------------------------------- modèles d'IA

// code : 'auto' ou un code du catalogue. Renvoie le modèle choisi (et pourquoi).
export function choisirModele(code, { ramGo, vramGo, kitModeles }) {
  const c = catalogue()
  const disponibles = kitModeles ? c.modeles.filter((m) => kitModeles.includes(m.code)) : c.modeles
  if (!disponibles.length) throw new Error('Aucun modèle d’IA dans le kit hors ligne')
  return disponibles.find((m) => m.code === code) || modeleConseille({ modeles: disponibles }, ramGo, vramGo)
}

export async function installerModeles(modele, dossierModeles, kit, suivi) {
  const c = catalogue()
  fs.mkdirSync(dossierModeles, { recursive: true })
  const obtenir = async (depot, fichier, local) => {
    const destination = path.join(dossierModeles, local)
    if (kit) await copierFichier(path.join(kit, 'modeles', local), destination, suivi, local)
    else if (!fs.existsSync(destination)) await telechargerDepuisHuggingFace(depot, fichier, destination, progression(suivi, local))
    suivi('message', `${local} : prêt (${tailleLisible(fs.statSync(destination).size)})`)
    return destination
  }
  return {
    modele: { code: modele.code, nom: modele.nom, fichier: await obtenir(modele.depot, modele.fichier, modele.local), vision: await obtenir(modele.depot, modele.vision, modele.vision_local) },
    recherche: { nom: c.recherche.nom, fichier: await obtenir(c.recherche.depot, c.recherche.fichier, c.recherche.local), dimensions: c.recherche.dimensions },
  }
}

// ---------------------------------------------------------------- le poste

export function poste() {
  return {
    systeme: WINDOWS ? 'Windows' : 'Linux',
    processeur: os.cpus()[0]?.model?.trim() || 'inconnu',
    coeurs: os.cpus().length,
    ramGo: Math.round(os.totalmem() / 1024 ** 3),
  }
}

export function espaceLibre(dossier) {
  try {
    let existant = dossier
    while (!fs.existsSync(existant)) existant = path.dirname(existant)
    const infos = fs.statfsSync(existant)
    return Math.round((infos.bavail * infos.bsize) / 1024 ** 3)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- outils

export function trouverFichier(dossier, nom) {
  if (!fs.existsSync(dossier)) return null
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name)
    if (entree.isFile() && entree.name === nom) return chemin
    if (entree.isDirectory()) {
      const trouve = trouverFichier(chemin, nom)
      if (trouve) return trouve
    }
  }
  return null
}

export function progression(suivi, nom) {
  let dernier = 0
  return (recu, total) => {
    if (Date.now() - dernier < 400 && recu < total) return
    dernier = Date.now()
    suivi('progression', { nom, recu, total })
  }
}

// Copie d'un gros fichier (kit sur clé USB, partage…) avec avancement. Déjà présent et de même taille : rien à faire.
export async function copierFichier(source, destination, suivi, nom = path.basename(destination)) {
  if (!fs.existsSync(source)) throw new Error(`${path.basename(source)} absent du kit hors ligne`)
  const total = fs.statSync(source).size
  if (fs.existsSync(destination) && fs.statSync(destination).size === total) return
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const partiel = destination + '.partiel'
  const afficher = progression(suivi, nom)
  let copie = 0
  await new Promise((ok, echec) => {
    fs.createReadStream(source)
      .on('data', (morceau) => afficher((copie += morceau.length), total))
      .on('error', echec)
      .pipe(fs.createWriteStream(partiel))
      .on('finish', ok)
      .on('error', echec)
  })
  fs.renameSync(partiel, destination)
}

async function copierDossier(source, destination, suivi, nom) {
  if (!fs.existsSync(source)) throw new Error(`${nom} absent du kit hors ligne`)
  suivi('message', `${nom} : copie depuis le kit…`)
  fs.cpSync(source, destination, { recursive: true })
}
