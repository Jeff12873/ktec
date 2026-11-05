// La racine d'un pack Windows : le raccourci « Installer K.NOVA » et le LISEZ-MOI ; tout le reste est dans « fichiers ».
// Le raccourci lance fichiers\installer-discret.bat (le Node du pack sur le lanceur, sans console qui reste) : seule
// la page d'installation s'ouvre, dans le navigateur. Il est « relatif » (aucun chemin absolu) : il marche où que le
// pack soit extrait. Au premier lancement, le lanceur le réécrit avec ses chemins complets et l'icône de K.NOVA.
// Utilisé par fabriquer-kit.js (kit hors ligne complet) et fabriquer-pack.js (petit pack, en ligne).

import fs from 'node:fs'
import path from 'node:path'
import { fichierLnk } from '../serveur/installation/raccourcis.js'
import { ecrireIco } from '../serveur/socle/icone.js'

export const ICONE = 'icone-installation.ico'

// L'icône de K.NOVA, rangée dans « fichiers » pour le raccourci.
export function ecrireIcone(dossierFichiers) {
  ecrireIco(fs.readFileSync(path.join(dossierFichiers, 'interface', 'icone.png')), path.join(dossierFichiers, ICONE))
}

export const LANCEUR_INSTALLATION = 'installer-discret.bat'
export const raccourciInstaller = () => fichierLnk({ relatif: `.\\fichiers\\${LANCEUR_INSTALLATION}`, icone: `fichiers\\${ICONE}` })

export function lisezMoi({ enLigne }) {
  return [
    'K.NOVA — installation',
    '',
    '1. Extraire ce dossier sur le PC (clic droit sur le zip › Extraire tout) : le raccourci ne marche pas depuis le zip.',
    '2. Double-cliquer « Installer K.NOVA ».',
    enLigne
      ? '   La page d\'installation s\'ouvre dans le navigateur et guide jusqu\'au bout : elle télécharge les outils choisis\r\n   (et l\'IA si AITEC est coché). Aucun droit d\'administrateur n\'est demandé.'
      : '   La page d\'installation s\'ouvre dans le navigateur et guide jusqu\'au bout : rien n\'est téléchargé,\r\n   aucun droit d\'administrateur n\'est demandé.',
    '   K.NOVA s\'installe dans le profil de l\'utilisateur.',
    '3. À la fin, « Ouvrir K.NOVA ». Un raccourci K.NOVA est posé sur le Bureau et dans le menu Démarrer.',
    '',
    'Le dossier « fichiers » contient le programme : il n\'y a rien à y ouvrir.',
    'L\'icône de K.NOVA apparaît sur le raccourci après le premier lancement.',
    'Si le raccourci ne fait rien : double-cliquer fichiers\\Installer KTEC.bat (même installation, avec une console).',
    '',
  ].join('\r\n')
}
