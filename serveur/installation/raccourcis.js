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
      // WindowStyle 7 = fenêtre réduite : on ne voit que le navigateur.
      const script = `$r = (New-Object -ComObject WScript.Shell).CreateShortcut('${raccourci.replace(/'/g, "''")}'); $r.TargetPath = '${lanceur.replace(/'/g, "''")}'; $r.WorkingDirectory = '${dossier.replace(/'/g, "''")}'; $r.IconLocation = '${ico.replace(/'/g, "''")}'; $r.WindowStyle = 7; $r.Save()`
      try {
        execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore', windowsHide: true })
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

function dossiersWindows() {
  const dossiers = [path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')]
  try {
    dossiers.unshift(execFileSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8', windowsHide: true }).trim())
  } catch {}
  return dossiers.filter(Boolean)
}

function dossiersLinux() {
  const dossiers = [path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'applications')]
  try {
    const bureau = execFileSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8' }).trim()
    if (bureau && fs.existsSync(bureau) && bureau !== os.homedir()) dossiers.push(bureau)
  } catch {}
  return dossiers
}
