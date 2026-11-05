// Le lanceur de K.NOVA sous Windows : le raccourci lance Node sur ce fichier, qui démarre K.NOVA en arrière-plan,
// sans fenêtre, puis se ferme aussitôt. Un « surveillant » caché relance K.NOVA quand il s'arrête avec le code 42
// (redémarrage demandé après une mise à jour), comme le faisait la boucle de « Lancer KTEC.bat ».
// Pas de VBScript ni de PowerShell : seulement Node, déjà installé avec K.NOVA.
// Il attend que K.NOVA réponde (20 s au plus) : sinon il sort en erreur, et installer-discret.bat passe la main à
// « Installer KTEC.bat », avec une console qui montre ce qui ne va pas.

import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = path.dirname(fileURLToPath(import.meta.url))
const RACINE = path.dirname(ICI)
const [premier, ...suite] = process.argv.slice(2)

if (premier === '--surveillant') {
  const lancer = () =>
    spawn(process.execPath, [path.join(ICI, 'demarrer.js'), ...suite], { cwd: RACINE, stdio: 'ignore', windowsHide: true })
      .on('exit', (code) => code === 42 && lancer())
  lancer()
} else {
  const args = premier ? [premier, ...suite] : []
  spawn(process.execPath, [fileURLToPath(import.meta.url), '--surveillant', ...args], { cwd: RACINE, detached: true, stdio: 'ignore', windowsHide: true }).unref()
  const installation = args.includes('--installation')
  if (!(await attendreKnova(installation))) process.exit(1)
  if (installation) await raccourciDuPack()
}

// K.NOVA répond-il ? Même fichier et même identifiant que dans demarrer.js.
async function attendreKnova(installation) {
  const fichier = path.join(RACINE, 'cache', installation ? 'serveur-installation.json' : 'serveur.json')
  const identifiant = crypto.createHash('sha256').update(RACINE + (installation ? ' installation' : '')).digest('hex').slice(0, 16)
  for (let essai = 0; essai < 40; essai++) {
    try {
      const { port } = JSON.parse(fs.readFileSync(fichier, 'utf8'))
      const r = await (await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(1000) })).json()
      if (r.identifiant === identifiant) return true
    } catch {}
    await new Promise((fin) => setTimeout(fin, 500))
  }
  return false
}

// Le raccourci « Installer K.NOVA » du pack, relatif à l'origine (sans icône possible) : réécrit avec ses chemins
// complets et l'icône de K.NOVA. Il garde son chemin relatif, au cas où le dossier serait déplacé.
async function raccourciDuPack() {
  const raccourci = path.join(RACINE, '..', 'Installer K.NOVA.lnk')
  if (process.platform !== 'win32' || !fs.existsSync(raccourci)) return
  try {
    const { fichierLnk } = await import('./installation/raccourcis.js')
    fs.writeFileSync(raccourci, fichierLnk({
      cible: path.join(RACINE, 'installer-discret.bat'),
      relatif: '.\\fichiers\\installer-discret.bat',
      dossier: RACINE,
      icone: path.join(RACINE, 'icone-installation.ico'),
    }))
  } catch {}
}
