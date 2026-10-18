// Les routes de la page d'installation (interface/installation/), sous /api/ktec/installation/… :
// état du poste et de l'installation, catalogue des applications, installation, mises à jour, désinstallation.
// La même page sert à la première installation (KTEC lancé en « mode installation » depuis le kit ou le zip)
// et, ensuite, aux mises à jour depuis le portail.

import { ouvrirFlux, ErreurHttp } from '../socle/http.js'
import path from 'node:path'
import { journal, RACINE } from '../socle/installation.js'
import { publierMaintenant } from '../socle/partage.js'
import { arreterIA } from '../socle/ia.js'
import { etat, catalogueApplis, installer, mettreAJour, desinstallerAppli, toutDesinstaller, lancerKtec } from './installateur.js'

export function routes(r, { modeInstallation }) {
  r.get('/api/ktec/installation/etat', () => ({ ...etat(), modeInstallation }))

  r.get('/api/ktec/installation/catalogue', () => catalogueApplis())

  // { dossier, applis, modele, raccourcis } : réponse en flux (« etape », « progression », « message », puis « fin » ou « erreur »).
  r.post('/api/ktec/installation/installer', async (ctx) => {
    const demande = await ctx.json()
    if (!demande.applis?.length) throw new ErreurHttp(400, 'Choisissez au moins une application.')
    // Depuis KTEC installé : les applications ajoutées ou remplacées sont chargées au redémarrage.
    await suivreEnFlux(ctx, (suivi) => installer(demande, suivi), (resultat) => {
      if (!modeInstallation && path.resolve(resultat.dossier) === path.resolve(RACINE)) redemarrer()
    })
  })

  r.post('/api/ktec/installation/mettre-a-jour', async (ctx) => {
    const demande = await ctx.json()
    await suivreEnFlux(ctx, (suivi) => mettreAJour(demande, suivi), (resultat) => resultat.redemarrer && redemarrer())
  })

  r.post('/api/ktec/installation/desinstaller', async (ctx) => {
    const { id } = await ctx.json()
    const registre = desinstallerAppli(id)
    // Les routes de l'application sont chargées : on redémarre KTEC (sauf depuis le kit, qui n'en charge aucune).
    if (!modeInstallation) redemarrer()
    return { registre, redemarrage: !modeInstallation }
  })

  r.post('/api/ktec/installation/tout-desinstaller', async (ctx) => {
    const { modeles = false } = await ctx.json()
    const { arret } = toutDesinstaller({ modeles })
    if (arret) arreter(0)
    return { arret }
  })

  // Après une installation depuis le kit ou le zip : lance KTEC installé, puis ce programme s'arrête.
  r.post('/api/ktec/installation/lancer', async (ctx) => {
    const { dossier } = await ctx.json()
    lancerKtec(dossier)
    if (modeInstallation) arreter(0, 4000)
  })
}

async function suivreEnFlux(ctx, travail, apres = () => {}) {
  const flux = ouvrirFlux(ctx.res)
  try {
    const resultat = await travail((type, donnees) => flux.envoyer(type, donnees))
    flux.envoyer('fin', resultat)
    flux.fermer()
    apres(resultat)
  } catch (erreur) {
    journal(`Installation : ${erreur.stack || erreur.message}`)
    flux.envoyer('erreur', { message: erreur.message })
    flux.fermer()
  }
}

// Le lanceur (Lancer KTEC.bat, lancer-ktec.sh) relance KTEC quand il s'arrête avec le code 42.
function redemarrer() {
  journal('Redémarrage de KTEC après une mise à jour')
  arreter(42)
}

function arreter(code, delai = 800) {
  setTimeout(() => {
    try {
      publierMaintenant()
    } catch {}
    arreterIA()
    process.exit(code)
  }, delai)
}
