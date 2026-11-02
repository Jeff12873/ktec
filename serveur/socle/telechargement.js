// Téléchargement de gros fichiers (modèles, llama.cpp, mises à jour).
//
// - reprend là où il s'était arrêté si la connexion coupe (fichier « .partiel ») ;
// - vérifie l'empreinte SHA-256 quand on la connaît ;
// - appelle surProgression(octetsRecus, total) pour afficher l'avancement ;
// - abandonne après une minute sans rien recevoir (poste sans accès à Internet, proxy qui ne répond pas).

import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'

const SILENCE_MAX = 60_000

export async function telecharger(url, destination, { sha256, taille, surProgression } = {}) {
  if (fs.existsSync(destination) && (await estComplet(destination, { sha256, taille }))) {
    return 'déjà présent'
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const partiel = destination + '.partiel'
  let dejaRecu = fs.existsSync(partiel) ? fs.statSync(partiel).size : 0

  const entetes = { 'User-Agent': 'KTEC' }
  if (dejaRecu > 0) entetes.Range = `bytes=${dejaRecu}-`

  // Le minuteur repart à chaque morceau reçu : seule une minute de silence complet arrête le téléchargement.
  const arret = new AbortController()
  let minuteur
  const patienter = () => {
    clearTimeout(minuteur)
    minuteur = setTimeout(() => arret.abort(), SILENCE_MAX)
  }
  patienter()
  let sortie
  try {
    return await recevoir()
  } catch (erreur) {
    sortie?.destroy()
    if (arret.signal.aborted) throw new Error(`Pas de réponse de ${new URL(url).host} depuis une minute : ce poste n’a sans doute pas accès à Internet. Utilisez le kit hors ligne, ou le zip de mise à jour.`)
    throw erreur
  } finally {
    clearTimeout(minuteur)
  }

  async function recevoir() {
    const reponse = await fetch(url, { headers: entetes, redirect: 'follow', signal: arret.signal })
    if (reponse.status === 416) {
      dejaRecu = 0 // le fichier partiel ne correspond plus : on recommence
      fs.rmSync(partiel, { force: true })
      clearTimeout(minuteur)
      return telecharger(url, destination, { sha256, taille, surProgression })
    }
    if (!reponse.ok) throw new Error(`Téléchargement refusé (${reponse.status}) : ${url}`)

    // Le serveur ne sait pas reprendre : on repart de zéro.
    if (dejaRecu > 0 && reponse.status !== 206) dejaRecu = 0

    const total = taille || dejaRecu + Number(reponse.headers.get('content-length') || 0)
    sortie = fs.createWriteStream(partiel, { flags: dejaRecu > 0 ? 'a' : 'w' })
    let recu = dejaRecu

    for await (const morceau of reponse.body) {
      patienter()
      if (!sortie.write(morceau)) await new Promise((ok) => sortie.once('drain', ok))
      recu += morceau.length
      surProgression?.(recu, total)
    }
    clearTimeout(minuteur) // tout est reçu : la vérification de l'empreinte peut être longue
    await new Promise((ok, echec) => sortie.end((erreur) => (erreur ? echec(erreur) : ok())))

    if (!(await estComplet(partiel, { sha256, taille }))) {
      fs.rmSync(partiel, { force: true })
      throw new Error(`Fichier abîmé pendant le téléchargement : ${path.basename(destination)}. Relancez la préparation.`)
    }
    fs.renameSync(partiel, destination)
    return 'téléchargé'
  }
}

async function estComplet(fichier, { sha256, taille }) {
  if (taille && fs.statSync(fichier).size !== taille) return false
  if (sha256) return (await empreinte(fichier)) === sha256
  return true
}

export function empreinte(fichier) {
  return new Promise((ok, echec) => {
    const hash = crypto.createHash('sha256')
    fs.createReadStream(fichier)
      .on('data', (morceau) => hash.update(morceau))
      .on('end', () => ok(hash.digest('hex')))
      .on('error', echec)
  })
}

// « 1,4 Go », « 350 Mo »…
export function tailleLisible(octets) {
  if (octets >= 1e9) return (octets / 1e9).toFixed(1).replace('.', ',') + ' Go'
  if (octets >= 1e6) return Math.round(octets / 1e6) + ' Mo'
  return Math.round(octets / 1e3) + ' Ko'
}
