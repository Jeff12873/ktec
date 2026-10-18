// Fabrique le kit hors ligne de KTEC : un gros zip qui contient tout (programme, Node, moteur d'IA, Java,
// moteur BIRT, pilote MySQL, modèles d'IA, applications), pour installer des postes sans Internet.
//
// À lancer sur un PC connecté à Internet, Windows ou Linux (un kit Windows se fabrique aussi depuis Linux) :
//     node outils/fabriquer-kit.js
// Options :
//   --systeme windows|linux      système des postes à installer (par défaut : celui de ce PC)
//   --modeles moyen,grand        modèles d'IA à inclure (moyen par défaut ; petit, mini, grand +23,5 Go)
//   --dossier <dossier>          où fabriquer le kit (par défaut : KTEC-hors-ligne-<système>, à côté de KTEC)
//   --applis-locales             applications prises dans les dossiers de développement (applisDev des réglages)
//                                au lieu des dernières Releases GitHub
//   --sans-zip                   garder le dossier sans fabriquer le zip
//
// Ce qui est déjà sur ce PC (modèles, moteur d'IA, Java, BIRT de l'installation actuelle) est repris sans
// nouveau téléchargement quand le système est le même. Sur le poste : décompresser le zip, puis lancer
// « Installer KTEC.bat » (ou installer-ktec.sh) : la page d'installation s'ouvre, rien n'est téléchargé.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RACINE, installation, reglagesPoste, lireJson, ecrireJson, dossierModelesParDefaut } from '../serveur/socle/installation.js'
import { telecharger, tailleLisible } from '../serveur/socle/telechargement.js'
import { telechargerDepuisHuggingFace, lireCatalogue } from '../serveur/socle/modeles.js'
import { decompresser, lireZip, zipperDossier, creerZip } from '../serveur/socle/zip.js'
import { extraireTarGz } from '../serveur/socle/tar.js'

const options = lireOptions(process.argv.slice(2))
const catalogue = lireCatalogue()
const applis = lireJson(path.join(RACINE, 'outils', 'applis.json'), { applis: [] })
const ICI = process.platform === 'win32' ? 'windows' : 'linux'
const FICHIERS_DU_PROGRAMME = ['serveur', 'interface', 'moteur-java', 'outils', 'docs', 'VERSION', 'package.json', 'README.md',
  'Lancer KTEC.bat', 'lancer-ktec.sh', 'Installer KTEC.bat', 'installer-ktec.sh']

main().catch((erreur) => {
  console.error('\n✗ ' + erreur.message)
  console.error('Le kit n’est pas terminé. Relancez la commande : ce qui est déjà prêt n’est pas refait.')
  process.exitCode = 1
})

async function main() {
  const systeme = options.systeme
  const memeSysteme = systeme === ICI
  const nomKit = `KTEC-hors-ligne-${systeme}`
  const sortie = path.resolve(options.dossier || path.join(RACINE, '..', nomKit))
  const kit = path.join(sortie, 'hors-ligne')
  const temporaire = path.join(sortie, 'temporaire')
  const modeles = options.modeles.map((code) => catalogue.modeles.find((m) => m.code === code) || erreur(`Modèle inconnu : ${code}`))
  const local = installation() || {}
  console.log(`\nKit hors ligne de KTEC pour ${systeme}`)
  console.log(`  Dossier : ${sortie}`)
  console.log(`  Modèles : ${modeles.map((m) => m.nom).join(', ')}\n`)
  fs.mkdirSync(kit, { recursive: true })
  fs.mkdirSync(temporaire, { recursive: true })

  // 1. Le programme KTEC ------------------------------------------------------------------
  etape(1, 'Programme KTEC')
  for (const nom of FICHIERS_DU_PROGRAMME) {
    fs.rmSync(path.join(sortie, nom), { recursive: true, force: true })
    if (fs.existsSync(path.join(RACINE, nom))) fs.cpSync(path.join(RACINE, nom), path.join(sortie, nom), { recursive: true })
  }
  if (!fs.existsSync(path.join(sortie, 'installer-ktec.sh'))) erreur('installer-ktec.sh manquant')
  fs.chmodSync(path.join(sortie, 'installer-ktec.sh'), 0o755)
  fs.chmodSync(path.join(sortie, 'lancer-ktec.sh'), 0o755)

  // 2. Node -----------------------------------------------------------------------------
  etape(2, `Node ${catalogue.node}`)
  const nodeExe = systeme === 'windows' ? path.join(kit, 'node', 'node.exe') : path.join(kit, 'node', 'bin', 'node')
  if (!fs.existsSync(nodeExe)) {
    const nom = systeme === 'windows' ? `node-${catalogue.node}-win-x64` : `node-${catalogue.node}-linux-x64`
    const archive = path.join(temporaire, systeme === 'windows' ? `${nom}.zip` : `${nom}.tar.gz`)
    await telecharger(`https://nodejs.org/dist/${catalogue.node}/${path.basename(archive)}`, archive, { surProgression: progression(path.basename(archive)) })
    finProgression()
    // Seul l'exécutable sert : KTEC n'utilise ni npm ni modules.
    if (systeme === 'windows') {
      const fichier = lireZip(fs.readFileSync(archive)).find((f) => f.nom === `${nom}/node.exe`)
      fs.mkdirSync(path.dirname(nodeExe), { recursive: true })
      fs.writeFileSync(nodeExe, fichier.lire())
    } else {
      extraireTarGz(fs.readFileSync(archive), temporaire)
      fs.mkdirSync(path.dirname(nodeExe), { recursive: true })
      fs.copyFileSync(path.join(temporaire, nom, 'bin', 'node'), nodeExe)
      fs.chmodSync(nodeExe, 0o755)
    }
  }

  // 3. llama.cpp : versions carte graphique (Vulkan) et processeur --------------------------------
  etape(3, `Moteur d'IA llama.cpp ${catalogue.llama}`)
  for (const variante of ['vulkan', 'cpu']) {
    const cible = path.join(kit, `llama-${variante}`)
    if (fs.existsSync(path.join(cible, catalogue.llama))) continue
    fs.rmSync(cible, { recursive: true, force: true })
    const dejaLa = memeSysteme && local.llama && local.llama.includes(`llama-${variante}`) ? racineDe(local.llama, `llama-${variante}`) : null
    if (dejaLa && fs.existsSync(path.join(dejaLa, catalogue.llama))) {
      fs.cpSync(dejaLa, cible, { recursive: true })
      console.log(`  ${variante} : repris de ce PC`)
      continue
    }
    const nomArchive = systeme === 'windows'
      ? `llama-${catalogue.llama}-bin-win-${variante}-x64.zip`
      : `llama-${catalogue.llama}-bin-ubuntu-${variante === 'cpu' ? '' : variante + '-'}x64.tar.gz`
    const archive = path.join(temporaire, nomArchive)
    await telecharger(`https://github.com/ggml-org/llama.cpp/releases/download/${catalogue.llama}/${nomArchive}`, archive, { surProgression: progression(nomArchive) })
    finProgression()
    fs.mkdirSync(cible, { recursive: true })
    if (systeme === 'windows') decompresser(fs.readFileSync(archive), cible)
    else extraireTarGz(fs.readFileSync(archive), cible)
    fs.writeFileSync(path.join(cible, catalogue.llama), '')
  }

  // 4. Java, moteur BIRT, pilote MySQL ---------------------------------------------------------
  etape(4, `Java ${catalogue.java.version}, moteur BIRT ${catalogue.birt.version}, pilote MySQL`)
  if (!fs.existsSync(path.join(kit, 'java'))) {
    const dejaLa = memeSysteme && local.java ? racineDe(local.java, 'java') : null
    if (dejaLa) {
      fs.cpSync(dejaLa, path.join(kit, 'java'), { recursive: true })
      console.log('  Java : repris de ce PC')
    } else {
      const archive = path.join(temporaire, systeme === 'windows' ? 'java.zip' : 'java.tar.gz')
      await telecharger(catalogue.java[systeme], archive, { surProgression: progression('Java') })
      finProgression()
      fs.mkdirSync(path.join(kit, 'java'), { recursive: true })
      if (systeme === 'windows') decompresser(fs.readFileSync(archive), path.join(kit, 'java'))
      else extraireTarGz(fs.readFileSync(archive), path.join(kit, 'java'))
    }
  }
  // Le moteur BIRT et le pilote MySQL sont en Java : les mêmes pour Windows et Linux.
  if (!fs.existsSync(path.join(kit, 'birt', catalogue.birt.version))) {
    fs.rmSync(path.join(kit, 'birt'), { recursive: true, force: true })
    if (local.birt && fs.existsSync(path.join(local.birt, catalogue.birt.version))) {
      fs.cpSync(local.birt, path.join(kit, 'birt'), { recursive: true })
      console.log('  Moteur BIRT : repris de ce PC')
    } else {
      const archive = path.join(temporaire, 'birt.zip')
      await telecharger(catalogue.birt.url, archive, { surProgression: progression('Moteur BIRT') })
      finProgression()
      decompresser(fs.readFileSync(archive), temporaire, (nom) => nom.startsWith('ReportEngine/'))
      fs.renameSync(path.join(temporaire, 'ReportEngine'), path.join(kit, 'birt'))
      fs.writeFileSync(path.join(kit, 'birt', catalogue.birt.version), '')
    }
  }
  const connecteur = path.join(kit, `mysql-connector-j-${catalogue.connecteur.version}.jar`)
  if (!fs.existsSync(connecteur)) {
    if (local.connecteur && path.basename(local.connecteur) === path.basename(connecteur) && fs.existsSync(local.connecteur)) fs.copyFileSync(local.connecteur, connecteur)
    else await telecharger(catalogue.connecteur.url, connecteur)
  }

  // 5. Modèles d'IA ----------------------------------------------------------------------------
  etape(5, "Modèles d'IA")
  const dossierModeles = path.join(kit, 'modeles')
  fs.mkdirSync(dossierModeles, { recursive: true })
  const dejaTelecharges = [local.dossierModeles, dossierModelesParDefaut()].filter(Boolean)
  const obtenir = async (depot, fichier, nomLocal) => {
    const destination = path.join(dossierModeles, nomLocal)
    if (fs.existsSync(destination)) return
    const ici = dejaTelecharges.map((d) => path.join(d, nomLocal)).find((f) => fs.existsSync(f))
    if (ici) {
      // Même disque : un lien suffit (instantané) ; sinon, une copie.
      try {
        fs.linkSync(ici, destination)
      } catch {
        fs.copyFileSync(ici, destination)
      }
      console.log(`  ${nomLocal} : repris de ce PC`)
    } else {
      await telechargerDepuisHuggingFace(depot, fichier, destination, progression(nomLocal))
      finProgression()
    }
  }
  for (const m of modeles) {
    await obtenir(m.depot, m.fichier, m.local)
    await obtenir(m.depot, m.vision, m.vision_local)
  }
  await obtenir(catalogue.recherche.depot, catalogue.recherche.fichier, catalogue.recherche.local)

  // 6. Les applications ----------------------------------------------------------------------
  etape(6, 'Applications')
  const dossierApplis = path.join(kit, 'applis')
  fs.rmSync(dossierApplis, { recursive: true, force: true })
  fs.mkdirSync(dossierApplis, { recursive: true })
  const versions = {}
  for (const a of applis.applis) {
    const zip = path.join(dossierApplis, `${a.id}.zip`)
    if (options.applisLocales) {
      const dossier = reglagesPoste().applisDev.find((d) => lireJson(path.join(d, 'app.json'), {}).id === a.id)
      if (!dossier) erreur(`${a.nom} : aucun dossier de développement dans applisDev`)
      fs.writeFileSync(zip, paquetLocal(dossier, a.id))
    } else {
      await telecharger(`https://github.com/${a.depot}/releases/latest/download/${a.id}.zip`, zip, { surProgression: progression(`${a.id}.zip`) })
      finProgression()
    }
    const fichierVersion = lireZip(fs.readFileSync(zip)).find((f) => f.nom === `${a.id}/VERSION`)
    versions[a.id] = fichierVersion ? fichierVersion.lire().toString('utf8').trim() : 'inconnue'
    console.log(`  ${a.nom} ${versions[a.id]}`)
  }

  fs.rmSync(temporaire, { recursive: true, force: true })
  ecrireJson(path.join(kit, 'kit.json'), {
    systeme,
    cree: new Date().toISOString(),
    ktec: fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim(),
    applis: versions,
    modeles: modeles.map((m) => m.code),
    composants: { node: catalogue.node, llama: catalogue.llama, java: catalogue.java.version, birt: catalogue.birt.version, connecteur: catalogue.connecteur.version },
  })

  // 7. Le gros zip -----------------------------------------------------------------------------
  if (!options.zip) {
    console.log(`\nKit prêt (dossier, sans zip) : ${sortie}\n`)
    return
  }
  etape(7, 'Le zip')
  const fichierZip = `${sortie}.zip`
  const { taille } = await zipperDossier(sortie, fichierZip, { prefixe: `${nomKit}/`, surProgression: progression(path.basename(fichierZip)) })
  finProgression()
  console.log(`\nKit prêt : ${fichierZip} (${tailleLisible(taille)})`)
  console.log('Sur le poste : décompresser le zip, puis lancer « Installer KTEC.bat » (ou installer-ktec.sh).\n')
}

// Le paquet d'une application depuis son dossier de développement : comme la Release GitHub
// (dossier <id>/ avec les fichiers publiés de l'application).
function paquetLocal(dossier, id) {
  const PUBLIES = ['app.json', 'blocs', 'interface', 'lib', 'docs', 'VERSION', 'package.json', 'README.md']
  const fichiers = []
  const ajouter = (chemin, nom) => {
    if (fs.statSync(chemin).isDirectory()) for (const e of fs.readdirSync(chemin)) ajouter(path.join(chemin, e), `${nom}/${e}`)
    else fichiers.push({ nom, octets: fs.readFileSync(chemin) })
  }
  for (const n of PUBLIES) if (fs.existsSync(path.join(dossier, n))) ajouter(path.join(dossier, n), `${id}/${n}`)
  return creerZip(fichiers)
}

// Le dossier de base d'un composant installé (ex. …/moteur/java/jdk-21…/bin/java → …/moteur/java).
function racineDe(fichier, nomDossier) {
  let d = path.dirname(fichier)
  while (path.basename(d) !== nomDossier && path.dirname(d) !== d) d = path.dirname(d)
  return path.basename(d) === nomDossier ? d : null
}

function lireOptions(args) {
  const o = { systeme: process.platform === 'win32' ? 'windows' : 'linux', modeles: ['moyen'], dossier: null, applisLocales: false, zip: true }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--systeme') o.systeme = args[++i]
    else if (args[i] === '--modeles') o.modeles = args[++i].split(',').map((s) => s.trim()).filter(Boolean)
    else if (args[i] === '--dossier') o.dossier = args[++i]
    else if (args[i] === '--applis-locales') o.applisLocales = true
    else if (args[i] === '--sans-zip') o.zip = false
  }
  if (!['windows', 'linux'].includes(o.systeme)) erreur('--systeme windows ou linux')
  return o
}

function erreur(message) {
  throw new Error(message)
}

function etape(numero, texte) {
  console.log(`[${numero}/7] ${texte}`)
}

let derniere = 0
function progression(nom) {
  return (recu, total) => {
    if (Date.now() - derniere < 500 && recu < total) return
    derniere = Date.now()
    process.stdout.write(`\r  ${nom} : ${tailleLisible(recu)} / ${tailleLisible(total)} (${total ? Math.floor((recu / total) * 100) : 0} %)      `)
  }
}

function finProgression() {
  process.stdout.write('\r' + ' '.repeat(90) + '\r')
}
