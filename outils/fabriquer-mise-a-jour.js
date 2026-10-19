// Fabrique un petit zip de mise à jour de KTEC : le programme et les applications, sans les composants
// (Node, Java, BIRT, moteur d'IA, modèles), qui sont déjà sur le poste. Quelques Mo au lieu de plusieurs Go.
// Pour un poste sans accès à GitHub : le zip s'apporte sur clé USB, puis dans KTEC :
// « Installation et mises à jour » › « Depuis un fichier… ». Le même zip sert sous Windows et sous Linux.
//
//     node outils/fabriquer-mise-a-jour.js
// Options :
//   --applis-locales     applications prises dans les dossiers de développement (applisDev des réglages)
//                        au lieu des dernières Releases GitHub
//   --dossier <dossier>  où ranger le zip (par défaut : à côté de KTEC)

import fs from 'node:fs'
import path from 'node:path'
import { RACINE, reglagesPoste, lireJson } from '../serveur/socle/installation.js'
import { telecharger, tailleLisible } from '../serveur/socle/telechargement.js'
import { lireZip, creerZip } from '../serveur/socle/zip.js'

const FICHIERS_DU_PROGRAMME = ['serveur', 'interface', 'moteur-java', 'outils', 'docs', 'VERSION', 'package.json', 'README.md',
  'Lancer KTEC.bat', 'lancer-ktec.sh', 'Installer KTEC.bat', 'installer-ktec.sh']
const PUBLIES = ['app.json', 'blocs', 'interface', 'lib', 'docs', 'VERSION', 'package.json', 'README.md']

const args = process.argv.slice(2)
const applisLocales = args.includes('--applis-locales')
const iDossier = args.indexOf('--dossier')
const sortie = path.resolve(iDossier >= 0 ? args[iDossier + 1] : path.join(RACINE, '..'))

main().catch((erreur) => {
  console.error('\n✗ ' + erreur.message)
  process.exitCode = 1
})

async function main() {
  const ktec = fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim()
  const nom = `KTEC-mise-a-jour-${ktec}`
  const fichiers = []
  const ajouter = (chemin, nomDansZip, filtre = () => true) => {
    if (fs.statSync(chemin).isDirectory()) {
      for (const e of fs.readdirSync(chemin)) ajouter(path.join(chemin, e), `${nomDansZip}/${e}`, filtre)
    } else if (filtre(nomDansZip)) {
      let octets = fs.readFileSync(chemin)
      // Les lanceurs Windows en fins de ligne Windows (cmd lit mal un .bat en fins Linux).
      if (nomDansZip.endsWith('.bat')) octets = Buffer.from(octets.toString('utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'))
      fichiers.push({ nom: nomDansZip, octets })
    }
  }

  console.log(`\nMise à jour de KTEC ${ktec}`)
  for (const n of FICHIERS_DU_PROGRAMME) if (fs.existsSync(path.join(RACINE, n))) ajouter(path.join(RACINE, n), `${nom}/KTEC/${n}`)

  const applis = lireJson(path.join(RACINE, 'outils', 'applis.json'), { applis: [] }).applis
  const versions = {}
  for (const a of applis) {
    let paquet
    if (applisLocales) {
      const dossier = reglagesPoste().applisDev.find((d) => lireJson(path.join(d, 'app.json'), {}).id === a.id)
      if (!dossier) throw new Error(`${a.nom} : aucun dossier de développement dans applisDev`)
      const siens = []
      const ajouterAppli = (chemin, n) => {
        if (fs.statSync(chemin).isDirectory()) for (const e of fs.readdirSync(chemin)) ajouterAppli(path.join(chemin, e), `${n}/${e}`)
        else siens.push({ nom: n, octets: fs.readFileSync(chemin) })
      }
      for (const n of PUBLIES) if (fs.existsSync(path.join(dossier, n))) ajouterAppli(path.join(dossier, n), `${a.id}/${n}`)
      paquet = creerZip(siens)
    } else {
      const temporaire = path.join(sortie, `.${a.id}-${process.pid}.zip`)
      await telecharger(`https://github.com/${a.depot}/releases/latest/download/${a.id}.zip`, temporaire)
      paquet = fs.readFileSync(temporaire)
      fs.rmSync(temporaire, { force: true })
    }
    const v = lireZip(paquet).find((f) => f.nom === `${a.id}/VERSION`)
    versions[a.id] = v ? v.lire().toString('utf8').trim() : 'inconnue'
    fichiers.push({ nom: `${nom}/applis/${a.id}.zip`, octets: paquet })
    console.log(`  ${a.nom} ${versions[a.id]}`)
  }

  fichiers.push({ nom: `${nom}/mise-a-jour.json`, octets: Buffer.from(JSON.stringify({ cree: new Date().toISOString(), ktec, applis: versions }, null, 2) + '\n') })
  const zip = path.join(sortie, `${nom}.zip`)
  fs.writeFileSync(zip, creerZip(fichiers))
  console.log(`\nMise à jour prête : ${zip} (${tailleLisible(fs.statSync(zip).size)})`)
  console.log('Sur le poste : KTEC › « Installation et mises à jour » › « Depuis un fichier… ».\n')
}
