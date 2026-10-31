// Le lanceur de K.NOVA sous Windows : le raccourci lance Node sur ce fichier, qui démarre K.NOVA en arrière-plan,
// sans fenêtre, puis se ferme aussitôt. Un « surveillant » caché relance K.NOVA quand il s'arrête avec le code 42
// (redémarrage demandé après une mise à jour), comme le faisait la boucle de « Lancer KTEC.bat ».
// Pas de VBScript ni de PowerShell : seulement Node, déjà installé avec K.NOVA.

import { spawn } from 'node:child_process'
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
}
