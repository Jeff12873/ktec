// Les raccourcis « KTEC » : Bureau et menu Démarrer (Windows), menu des applications et Bureau (Linux).
// Ils lancent le portail (Lancer KTEC.bat / lancer-ktec.sh), avec l'icône de KTEC.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { WINDOWS } from '../socle/installation.js'
import { ecrireIco } from '../socle/icone.js'

export function creerRaccourcis(dossier, suivi = () => {}) {
  // L'icône des raccourcis : interface/icone.png, et sa version .ico pour Windows.
  const png = path.join(dossier, 'cache', 'icone.png')
  const ico = path.join(dossier, 'cache', 'icone.ico')
  fs.mkdirSync(path.dirname(png), { recursive: true })
  fs.copyFileSync(path.join(dossier, 'interface', 'icone.png'), png)
  ecrireIco(fs.readFileSync(png), ico)

  if (WINDOWS) {
    const lanceur = path.join(dossier, 'Lancer KTEC.bat')
    for (const dossierRaccourci of dossiersWindows()) {
      const raccourci = path.join(dossierRaccourci, 'KTEC.lnk')
      try {
        fs.mkdirSync(dossierRaccourci, { recursive: true })
        fs.writeFileSync(raccourci, fichierLnk({ cible: lanceur, dossier, icone: ico }))
        suivi('message', `Raccourci créé : ${raccourci}`)
      } catch {
        suivi('message', `Raccourci impossible dans ${dossierRaccourci} : lancez « Lancer KTEC.bat » dans ${dossier}`)
      }
    }
    return
  }

  const lanceur = path.join(dossier, 'lancer-ktec.sh')
  fs.chmodSync(lanceur, 0o755)
  const fiche = `[Desktop Entry]\nType=Application\nName=KTEC\nComment=Les applications de l'atelier (BiRTEC, PDRTec, AITEC)\nExec=sh "${lanceur}"\nIcon=${png}\nTerminal=false\nCategories=Office;Utility;\n`
  for (const dossierFiche of dossiersLinux()) {
    fs.mkdirSync(dossierFiche, { recursive: true })
    fs.writeFileSync(path.join(dossierFiche, 'ktec.desktop'), fiche, { mode: 0o755 })
    suivi('message', `Raccourci créé : ${path.join(dossierFiche, 'ktec.desktop')}`)
  }
}

export function supprimerRaccourcis() {
  const fichiers = WINDOWS ? dossiersWindows().map((d) => path.join(d, 'KTEC.lnk')) : dossiersLinux().map((d) => path.join(d, 'ktec.desktop'))
  for (const f of fichiers) fs.rmSync(f, { force: true })
}

// Le Bureau (peut être redirigé, vers OneDrive par exemple : on le lit dans le registre) et le menu Démarrer.
function dossiersWindows() {
  const dossiers = [path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')]
  let bureau = path.join(process.env.USERPROFILE || os.homedir(), 'Desktop')
  try {
    const sortie = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'Desktop'], { encoding: 'utf8', windowsHide: true })
    const lu = sortie.match(/Desktop\s+REG_(?:EXPAND_)?SZ\s+(.+)$/m)?.[1]?.trim()
    if (lu) bureau = lu.replace(/%([^%]+)%/g, (tout, nom) => process.env[nom] ?? tout)
  } catch {}
  if (fs.existsSync(bureau)) dossiers.unshift(bureau)
  return dossiers.filter(Boolean)
}

// Un raccourci Windows (.lnk, format MS-SHLLINK) écrit à la main : chemin de la cible, dossier de travail, icône,
// fenêtre réduite (on ne voit que le navigateur).
function fichierLnk({ cible, dossier, icone }) {
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
  const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
  const unicode = (t) => Buffer.from(t, 'utf16le')
  const chaine = (t) => Buffer.concat([u16(t.length), unicode(t)])

  const entete = Buffer.concat([
    u32(0x4c), Buffer.from('0114020000000000c000000000000046', 'hex'),
    u32(0x02 | 0x10 | 0x40 | 0x80), // LinkInfo, dossier de travail, icône, textes en Unicode
    u32(0x20), Buffer.alloc(24), u32(0), u32(0),
    u32(7), // fenêtre réduite
    u16(0), u16(0), u32(0), u32(0),
  ])

  // Le chemin de la cible : en ANSI ; s'il a des accents, aussi en Unicode (en-tête de LinkInfo plus long).
  const volume = Buffer.concat([u32(17), u32(3), u32(0), u32(0x10), Buffer.from([0])]) // disque fixe, sans nom
  const ascii = /^[\x20-\x7e]*$/.test(cible)
  const tailleEnteteInfo = ascii ? 0x1c : 0x24
  const cheminAnsi = Buffer.concat([Buffer.from(cible.replace(/[^\x20-\x7e]/g, '?'), 'latin1'), Buffer.from([0])])
  const offVolume = tailleEnteteInfo
  const offChemin = offVolume + volume.length
  const offSuffixe = offChemin + cheminAnsi.length
  let corps = [volume, cheminAnsi, Buffer.from([0])]
  let offsetsUnicode = []
  if (!ascii) {
    const bourrage = Buffer.alloc((offSuffixe + 1) % 2) // textes Unicode sur une adresse paire
    const cheminUnicode = Buffer.concat([unicode(cible), Buffer.alloc(2)])
    const offCheminU = offSuffixe + 1 + bourrage.length
    offsetsUnicode = [u32(offCheminU), u32(offCheminU + cheminUnicode.length)]
    corps = [...corps, bourrage, cheminUnicode, Buffer.alloc(2)]
  }
  const tailleInfo = tailleEnteteInfo + corps.reduce((n, b) => n + b.length, 0)
  const linkInfo = Buffer.concat([u32(tailleInfo), u32(tailleEnteteInfo), u32(1), u32(offVolume), u32(offChemin), u32(0), u32(offSuffixe), ...offsetsUnicode, ...corps])

  return Buffer.concat([entete, linkInfo, chaine(dossier), chaine(icone), u32(0)])
}

function dossiersLinux() {
  const dossiers = [path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'applications')]
  try {
    const bureau = execFileSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8' }).trim()
    if (bureau && fs.existsSync(bureau) && bureau !== os.homedir()) dossiers.push(bureau)
  } catch {}
  return dossiers
}
