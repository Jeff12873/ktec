// Le petit pack Windows d'installation en ligne (publié dans les Releases, téléchargé depuis la page de
// présentation) : le programme K.NOVA, le Node de Windows et le raccourci « Installer K.NOVA ». Tout le reste
// (Java, BIRT, les applications, l'IA) est téléchargé par la page d'installation, avec sa progression.
//
//   node outils/fabriquer-pack.js --node <node.exe de Windows> --sortie <K.NOVA-windows.zip>

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RACINE } from '../serveur/socle/installation.js'
import { zipperDossier } from '../serveur/socle/zip.js'
import { ecrireIco } from '../serveur/socle/icone.js'
import { raccourciInstaller, lisezMoi, ICONE } from './racine-windows.js'

const PROGRAMME = ['serveur', 'interface', 'moteur-java', 'outils', 'VERSION', 'package.json', 'README.md', 'nouveautes.json',
  'Lancer KTEC.bat', 'Installer KTEC.bat', 'installer-discret.bat', 'Desinstaller KTEC.bat']

const args = process.argv.slice(2)
const option = (nom) => { const i = args.indexOf(nom); return i < 0 ? null : args[i + 1] }
const node = option('--node')
const sortie = option('--sortie')
if (!node || !sortie || !fs.existsSync(node)) {
  console.error('Usage : node outils/fabriquer-pack.js --node <node.exe> --sortie <K.NOVA-windows.zip>')
  process.exit(1)
}

const temporaire = fs.mkdtempSync(path.join(os.tmpdir(), 'knova-pack-'))
const fichier = (nom, contenu) => { const c = path.join(temporaire, nom); fs.writeFileSync(c, contenu); return c }
const ico = path.join(temporaire, ICONE)
ecrireIco(fs.readFileSync(path.join(RACINE, 'interface', 'icone.png')), ico)
const { taille } = await zipperDossier(RACINE, sortie, {
  prefixe: 'K.NOVA/fichiers/',
  garder: (nom) => PROGRAMME.includes(nom),
  supplements: [
    { chemin: fichier('Installer K.NOVA.lnk', raccourciInstaller()), nom: 'K.NOVA/Installer K.NOVA.lnk' },
    { chemin: fichier('LISEZ-MOI.txt', lisezMoi({ enLigne: true })), nom: 'K.NOVA/LISEZ-MOI.txt' },
    { chemin: ico, nom: `K.NOVA/fichiers/${ICONE}` },
    { chemin: path.resolve(node), nom: 'K.NOVA/fichiers/hors-ligne/node/node.exe' },
  ],
})
fs.rmSync(temporaire, { recursive: true, force: true })
console.log(`Pack prêt : ${sortie} (${Math.round(taille / 1e6)} Mo)`)
