// L'installation de KTEC et de ses applications, ses mises à jour et sa désinstallation.
//
// Source des paquets :
//   - hors ligne : le kit (dossier hors-ligne/ à côté du lanceur), avec kit.json, les composants et applis/<id>.zip ;
//   - en ligne   : GitHub (catalogue outils/applis.json de la branche main, dernières Releases de chaque dépôt).
// Le dossier de KTEC tient un registre (registre.json) : version du socle, composants installés, applications.
// Rien n'est jamais installé deux fois : seuls les composants demandés par les applications choisies et
// absents (ou dans une autre version) sont ajoutés.
//
// Les données ne sont jamais touchées : fichier .ktec, Documents/KTEC (rapports), réglages du poste.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { RACINE, WINDOWS, version, lireJson, ecrireJson, dossierInstallationParDefaut, dossierModelesParDefaut, journal } from '../socle/installation.js'
import { telecharger } from '../socle/telechargement.js'
import { decompresser } from '../socle/zip.js'
import * as composants from './composants.js'
import { creerRaccourcis, supprimerRaccourcis } from './raccourcis.js'

const KIT = path.join(RACINE, 'hors-ligne')
const DEPOT_CATALOGUE = 'https://raw.githubusercontent.com/Jeff12873/ktec/main/outils/applis.json'

// Ce qui fait le programme KTEC lui-même (copié ou remplacé à l'installation et aux mises à jour).
const FICHIERS_DU_SOCLE = ['serveur', 'interface', 'moteur-java', 'outils', 'docs', 'VERSION', 'package.json', 'README.md',
  'Lancer KTEC.bat', 'lancer-ktec.sh', 'Installer KTEC.bat', 'installer-ktec.sh']

export const kit = () => lireJson(path.join(KIT, 'kit.json'), null)

// ---------------------------------------------------------------- catalogue et état

// Les applications disponibles, avec leur dernière version (kit hors ligne ou GitHub).
export async function catalogueApplis() {
  const k = kit()
  const local = lireJson(path.join(RACINE, 'outils', 'applis.json'), { applis: [] })
  if (k) {
    return {
      source: 'kit',
      socle: { version: k.ktec },
      applis: local.applis.filter((a) => k.applis?.[a.id]).map((a) => ({ ...a, disponible: k.applis[a.id] })),
    }
  }
  // En ligne : le catalogue de GitHub (s'il répond), sinon celui de ce programme.
  let cat = local
  try {
    const r = await fetch(DEPOT_CATALOGUE, { signal: AbortSignal.timeout(8000) })
    if (r.ok) cat = await r.json()
  } catch {}
  const versions = await Promise.all([cat.socle?.depot || 'Jeff12873/ktec', ...cat.applis.map((a) => a.depot)].map(derniereVersion))
  return {
    source: 'github',
    socle: { ...cat.socle, version: versions[0] },
    applis: cat.applis.map((a, i) => ({ ...a, disponible: versions[i + 1] })),
  }
}

async function derniereVersion(depot) {
  try {
    const r = await fetch(`https://api.github.com/repos/${depot}/releases/latest`, { headers: { 'User-Agent': 'KTEC' }, signal: AbortSignal.timeout(8000) })
    if (!r.ok) return null
    return (await r.json()).tag_name.replace(/^v/, '')
  } catch {
    return null
  }
}

export function registre(dossier) {
  return lireJson(path.join(dossier, 'registre.json'), null)
}

// L'installation existante : celle d'où tourne ce programme si c'est une installation, sinon le dossier par défaut.
export function dossierInstalle() {
  if (registre(RACINE)) return RACINE
  const defaut = dossierInstallationParDefaut()
  return registre(defaut) ? defaut : null
}

export function etat() {
  const installe = dossierInstalle()
  const k = kit()
  return {
    source: k ? 'kit' : 'github',
    kit: k,
    versionProgramme: version(),
    enInstallation: !registre(RACINE), // lancé depuis un kit ou un zip (pas depuis une installation)
    installe: installe ? { dossier: installe, ...registre(installe) } : null,
    dossierParDefaut: dossierInstallationParDefaut(),
    dossierModeles: dossierModelesParDefaut(),
    poste: composants.poste(),
    espaceLibreGo: composants.espaceLibre(installe || dossierInstallationParDefaut()),
    modeles: composants.catalogue().modeles.filter((m) => !k || k.modeles?.includes(m.code)).map(({ code, nom, taille_go, pour }) => ({ code, nom, tailleGo: taille_go, pour })),
    systeme: WINDOWS ? 'windows' : 'linux',
  }
}

// ---------------------------------------------------------------- installation

let enCours = false

// { dossier, applis: [id], modele: 'auto' | code, raccourcis: true } — suivi(type, données) pour l'avancement.
export async function installer({ dossier, applis = [], modele = 'auto', raccourcis = true }, suivi) {
  if (enCours) throw new Error('Une installation est déjà en cours.')
  enCours = true
  try {
    dossier = path.resolve(dossier || dossierInstallationParDefaut())
    const cat = await catalogueApplis()
    const choisies = cat.applis.filter((a) => applis.includes(a.id))
    const besoins = new Set(choisies.flatMap((a) => a.besoins || []))
    // Le moteur Java (connexion MySQL) a besoin des classes de BIRT pour être compilé.
    if (besoins.has('java')) besoins.add('birt')
    const k = kit()
    if (k && k.systeme !== (WINDOWS ? 'windows' : 'linux')) throw new Error(`Ce kit hors ligne est fait pour ${k.systeme}, pas pour ce système.`)
    const kitDossier = k ? KIT : null
    const ancien = registre(dossier) || { composants: {}, applis: {} }
    const reg = { ...ancien, composants: { ...ancien.composants }, applis: { ...ancien.applis } }
    const config = lireJson(path.join(dossier, 'installation.json'), {})
    const etapes = 3 + (besoins.has('ia') ? 2 : 0) + (besoins.has('java') ? 1 : 0) + (raccourcis ? 1 : 0)
    let numero = 0
    const etape = (titre) => suivi('etape', { numero: ++numero, total: etapes, titre })
    journal(`Installation de KTEC dans ${dossier} : ${applis.join(', ') || 'socle seul'} (${k ? 'kit hors ligne' : 'en ligne'})`)

    // 1. Le programme KTEC et Node
    etape(`Programme KTEC ${cat.socle.version || version()} dans ${dossier}`)
    fs.mkdirSync(dossier, { recursive: true })
    if (path.resolve(dossier) !== path.resolve(RACINE)) copierSocle(RACINE, dossier)
    composants.installerNode(dossier, suivi)
    reg.ktec = lireVersion(dossier)
    reg.composants.node = process.version

    // 2. Moteur d'IA, puis choix du modèle selon la carte graphique
    let carte = null
    if (besoins.has('ia')) {
      etape("Moteur d'IA")
      const { llama, appareils, version: v } = await composants.installerLlama(dossier, kitDossier, suivi)
      carte = composants.choisirCarte(appareils)
      Object.assign(config, { llama, appareil: carte ? carte.code : 'none', appareilNom: carte ? carte.nom : 'processeur' })
      reg.composants.llama = v
      suivi('message', `L'IA utilisera : ${carte ? `${carte.nom} (${carte.memoireGo} Go)` : 'le processeur seul'}`)
    }

    // 3. Java, moteur BIRT, pilote MySQL, moteur Java de KTEC
    if (besoins.has('java')) {
      const c = composants.catalogue()
      etape(`Java ${c.java.version}, moteur BIRT ${c.birt.version} et pilote MySQL`)
      const java = await composants.installerJava(dossier, kitDossier, suivi)
      const birt = await composants.installerBirt(dossier, kitDossier, suivi)
      const connecteur = await composants.installerConnecteur(dossier, kitDossier, suivi)
      const moteurJava = composants.compilerMoteurJava(dossier, java, birt, connecteur, suivi)
      Object.assign(config, { java: java.java, birt, connecteur, moteurJava })
      Object.assign(reg.composants, { java: c.java.version, birt: c.birt.version, connecteur: c.connecteur.version })
    }

    // 4. Modèles d'IA (dans un dossier commun du poste sous Windows)
    if (besoins.has('ia')) {
      const ramGo = composants.poste().ramGo
      const m = composants.choisirModele(modele, { ramGo, vramGo: carte ? carte.memoireGo : 0, kitModeles: k?.modeles })
      let dossierModeles = config.dossierModeles || dossierModelesParDefaut()
      etape(`Modèle d'IA : ${m.nom} (${String(m.taille_go).replace('.', ',')} Go), dans ${dossierModeles}`)
      try {
        fs.mkdirSync(dossierModeles, { recursive: true })
      } catch {
        dossierModeles = path.join(dossier, 'modeles')
        suivi('message', `Dossier commun inaccessible : les modèles iront dans ${dossierModeles}`)
      }
      const fichiers = await composants.installerModeles(m, dossierModeles, kitDossier, suivi)
      Object.assign(config, { dossierModeles, ...fichiers })
      reg.composants.modele = m.code
    }
    config.poste = { systeme: WINDOWS ? 'Windows' : 'Linux', ramGo: composants.poste().ramGo, carte: carte?.nom || config.poste?.carte || null, vramGo: carte?.memoireGo ?? config.poste?.vramGo ?? 0 }
    config.prepareLe = new Date().toISOString()
    ecrireJson(path.join(dossier, 'installation.json'), config)

    // 5. Les applications
    etape(`Applications : ${choisies.map((a) => a.nom).join(', ') || 'aucune'}`)
    for (const a of choisies) reg.applis[a.id] = await installerAppli(dossier, a, suivi)

    // 6. Raccourcis
    if (raccourcis) {
      etape('Raccourcis')
      creerRaccourcis(dossier, suivi)
    }

    reg.installeLe ??= new Date().toISOString()
    reg.misAJourLe = new Date().toISOString()
    ecrireJson(path.join(dossier, 'registre.json'), reg)
    journal(`Installation terminée : ${JSON.stringify(reg.applis)}`)
    return { dossier, registre: reg }
  } finally {
    enCours = false
  }
}

function copierSocle(source, destination) {
  for (const nom of FICHIERS_DU_SOCLE) {
    const depuis = path.join(source, nom)
    if (!fs.existsSync(depuis)) continue
    fs.rmSync(path.join(destination, nom), { recursive: true, force: true })
    fs.cpSync(depuis, path.join(destination, nom), { recursive: true })
  }
  if (!WINDOWS) for (const sh of ['lancer-ktec.sh', 'installer-ktec.sh']) if (fs.existsSync(path.join(destination, sh))) fs.chmodSync(path.join(destination, sh), 0o755)
  // Lanceurs Windows en fins de ligne Windows (cmd lit mal un .bat en fins Linux).
  for (const bat of ['Lancer KTEC.bat', 'Installer KTEC.bat']) {
    const f = path.join(destination, bat)
    if (fs.existsSync(f)) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'))
  }
}

const lireVersion = (dossier) => {
  try {
    return fs.readFileSync(path.join(dossier, 'VERSION'), 'utf8').trim()
  } catch {
    return null
  }
}

// Une application : son paquet <id>.zip (dossier <id>/ dedans), décompressé dans apps/<id>/ à la place de l'ancien.
async function installerAppli(dossier, appli, suivi) {
  const k = kit()
  let octets
  if (k) {
    const zip = path.join(KIT, 'applis', `${appli.id}.zip`)
    if (!fs.existsSync(zip)) throw new Error(`${appli.nom} absente du kit hors ligne`)
    octets = fs.readFileSync(zip)
  } else {
    const temporaire = path.join(os.tmpdir(), `ktec-${appli.id}-${process.pid}.zip`)
    await telecharger(`https://github.com/${appli.depot}/releases/latest/download/${appli.id}.zip`, temporaire, { surProgression: composants.progression(suivi, appli.nom) })
    octets = fs.readFileSync(temporaire)
    fs.rmSync(temporaire, { force: true })
  }
  const apps = path.join(dossier, 'apps')
  const nouveau = path.join(apps, `.${appli.id}-nouveau`)
  fs.rmSync(nouveau, { recursive: true, force: true })
  decompresser(octets, nouveau)
  const contenu = fs.existsSync(path.join(nouveau, appli.id, 'app.json')) ? path.join(nouveau, appli.id) : nouveau
  if (!fs.existsSync(path.join(contenu, 'app.json'))) throw new Error(`Paquet ${appli.id}.zip incomplet`)
  // Remplacement d'un coup : en cas d'erreur, l'ancienne version reste en place.
  const cible = path.join(apps, appli.id)
  const ancienne = path.join(apps, `.${appli.id}-ancienne`)
  fs.rmSync(ancienne, { recursive: true, force: true })
  if (fs.existsSync(cible)) fs.renameSync(cible, ancienne)
  fs.renameSync(contenu, cible)
  fs.rmSync(nouveau, { recursive: true, force: true })
  fs.rmSync(ancienne, { recursive: true, force: true })
  const v = lireVersion(cible)
  suivi('message', `${appli.nom} ${v} installée.`)
  return v
}

// ---------------------------------------------------------------- mises à jour

// Met à jour les applications installées (et le socle KTEC) vers les versions disponibles.
// Renvoie { redemarrer } : vrai si le programme KTEC qui tourne a été remplacé.
export async function mettreAJour({ applis = null, socle = true } = {}, suivi) {
  const dossier = dossierInstalle()
  if (!dossier) throw new Error('KTEC n’est pas installé sur ce poste.')
  const reg = registre(dossier)
  const cat = await catalogueApplis()
  let redemarrer = false
  if (socle && cat.socle.version && cat.socle.version !== reg.ktec) {
    suivi('etape', { numero: 1, total: 2, titre: `Programme KTEC ${reg.ktec} → ${cat.socle.version}` })
    if (kit()) copierSocle(RACINE, dossier)
    else {
      const zip = path.join(os.tmpdir(), `KTEC-${process.pid}.zip`)
      await telecharger(`https://github.com/${cat.socle.depot}/releases/latest/download/${cat.socle.paquet}`, zip, { surProgression: composants.progression(suivi, 'KTEC') })
      const temporaire = path.join(os.tmpdir(), `KTEC-maj-${process.pid}`)
      fs.rmSync(temporaire, { recursive: true, force: true })
      decompresser(fs.readFileSync(zip), temporaire)
      copierSocle(fs.existsSync(path.join(temporaire, 'KTEC')) ? path.join(temporaire, 'KTEC') : temporaire, dossier)
      fs.rmSync(temporaire, { recursive: true, force: true })
      fs.rmSync(zip, { force: true })
    }
    // Le moteur Java a pu changer : on le recompile.
    const config = lireJson(path.join(dossier, 'installation.json'), {})
    if (config.java && config.birt && config.connecteur) {
      composants.compilerMoteurJava(dossier, { javac: path.join(path.dirname(config.java), WINDOWS ? 'javac.exe' : 'javac') }, config.birt, config.connecteur, suivi)
    }
    reg.ktec = lireVersion(dossier)
    redemarrer = path.resolve(dossier) === path.resolve(RACINE)
  }
  suivi('etape', { numero: 2, total: 2, titre: 'Applications' })
  for (const a of cat.applis) {
    if (!(a.id in reg.applis) || (applis && !applis.includes(a.id))) continue
    if (a.disponible && a.disponible === reg.applis[a.id]) continue
    reg.applis[a.id] = await installerAppli(dossier, a, suivi)
    redemarrer ||= path.resolve(dossier) === path.resolve(RACINE) // les routes serveur d'une application sont chargées au démarrage
  }
  reg.misAJourLe = new Date().toISOString()
  ecrireJson(path.join(dossier, 'registre.json'), reg)
  return { redemarrer, registre: reg }
}

// ---------------------------------------------------------------- désinstallation

// Une application : son dossier apps/<id> et sa ligne du registre. Les composants communs restent.
export function desinstallerAppli(id) {
  const dossier = dossierInstalle()
  if (!dossier) throw new Error('KTEC n’est pas installé sur ce poste.')
  const reg = registre(dossier)
  fs.rmSync(path.join(dossier, 'apps', id), { recursive: true, force: true })
  delete reg.applis[id]
  ecrireJson(path.join(dossier, 'registre.json'), reg)
  journal(`Application désinstallée : ${id}`)
  return reg
}

// Tout KTEC : le dossier d'installation et les raccourcis ; les modèles d'IA seulement si demandé.
// Le fichier .ktec, Documents/KTEC et tout ce qui n'est pas dans le dossier d'installation sont gardés.
// Si ce programme tourne depuis le dossier à supprimer, la suppression est faite juste après son arrêt.
export function toutDesinstaller({ modeles = false } = {}) {
  const dossier = dossierInstalle()
  if (!dossier) throw new Error('KTEC n’est pas installé sur ce poste.')
  const config = lireJson(path.join(dossier, 'installation.json'), {})
  supprimerRaccourcis()
  const aSupprimer = [dossier]
  if (modeles && config.dossierModeles && !config.dossierModeles.startsWith(dossier)) aSupprimer.push(config.dossierModeles)
  journal(`Désinstallation de KTEC : ${aSupprimer.join(', ')}`)
  const enCoursDUtilisation = path.resolve(dossier) === path.resolve(RACINE)
  if (!enCoursDUtilisation) {
    for (const d of aSupprimer) fs.rmSync(d, { recursive: true, force: true })
    return { arret: false }
  }
  // On ne peut pas effacer le programme qui tourne (Windows le refuse) : un petit script s'en charge après l'arrêt.
  if (WINDOWS) {
    const commandes = aSupprimer.map((d) => `rmdir /s /q "${d}"`).join(' & ')
    spawn('cmd.exe', ['/c', `timeout /t 3 /nobreak >nul & ${commandes}`], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } else {
    spawn('sh', ['-c', `sleep 2; ${aSupprimer.map((d) => `rm -rf '${d.replace(/'/g, "'\\''")}'`).join('; ')}`], { detached: true, stdio: 'ignore' }).unref()
  }
  return { arret: true }
}

// Lance KTEC installé (après une installation depuis un kit ou un zip).
export function lancerKtec(dossier) {
  if (WINDOWS) {
    // Fenêtre réduite, comme le raccourci : on ne voit que le navigateur.
    spawn('cmd.exe', ['/c', `start "KTEC" /min "${path.join(dossier, 'Lancer KTEC.bat')}"`], { cwd: dossier, detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref()
  } else {
    spawn('sh', [path.join(dossier, 'lancer-ktec.sh')], { cwd: dossier, detached: true, stdio: 'ignore' }).unref()
  }
}

