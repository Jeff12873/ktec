// Les messages au développeur : depuis n'importe quelle application, un texte et des images (captures d'écran)
// pour proposer une amélioration ou signaler un souci. Ils sont rangés dans le fichier de connaissances
// (réglage « ktec.messages » et fichiers « ktec-messages ») ; le portail les liste (à faire, en cours, fait).
//
// L'envoi : derrière un mot de passe (donné seulement aux personnes choisies), K.NOVA prépare un mail vers le
// développeur, que la messagerie du poste (Outlook) envoie elle-même, avec le zip des captures à joindre.
// K.NOVA ne se connecte jamais à Internet. Seule l'empreinte du mot de passe est ici (scrypt) : on ne peut pas
// en retrouver le mot de passe.

import os from 'node:os'
import crypto from 'node:crypto'
import path from 'node:path'
import { ErreurHttp, envoyerOctets } from './socle/http.js'
import { lireInfo, ecrireInfo, lireFichier, enregistrerFichier, supprimerFichier } from './socle/ktec.js'
import { version, reglagesPoste } from './socle/installation.js'
import { applisPubliques } from './socle/applis.js'
import { creerZip } from './socle/zip.js'

const IMAGES_MAX = 6
const TAILLE_MAX = 5 * 1024 * 1024
const ETATS = ['a_faire', 'en_cours', 'fait']

const lireMessages = () => lireInfo('ktec.messages', [])

const DESTINATAIRE = 'contact@hknova.fr'
const MOT_DE_PASSE = { sel: 'ec04e0dc39a672db50063fd188c07451', empreinte: 'efe3c80c6baed7e87348d8090f532e6b9afeabe2bc2c02d82a222787e07e9e16' }
const essais = { nombre: 0, jusqua: 0 } // 5 erreurs : 5 minutes d'attente

function verifierMotDePasseEnvoi(motDePasse) {
  if (Date.now() < essais.jusqua) throw new ErreurHttp(429, 'Trop d’essais : réessayez dans quelques minutes.')
  const calcul = crypto.scryptSync(String(motDePasse || ''), Buffer.from(MOT_DE_PASSE.sel, 'hex'), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  if (!crypto.timingSafeEqual(calcul, Buffer.from(MOT_DE_PASSE.empreinte, 'hex'))) {
    if (++essais.nombre >= 5) Object.assign(essais, { nombre: 0, jusqua: Date.now() + 5 * 60_000 })
    throw new ErreurHttp(403, 'Mot de passe incorrect.')
  }
  essais.nombre = 0
}

const ETIQUETTES = { a_faire: 'À faire', en_cours: 'En cours', fait: 'Fait' }
const texteMessage = (m) => [
  `# ${m.appli} ${m.version} — ${new Date(m.date).toLocaleString('fr-FR')} — ${ETIQUETTES[m.etat]}`,
  `Écran : ${m.ecran || '—'} · Poste : ${m.poste} (${m.ordinateur}) · K.NOVA ${m.ktec}`,
  '',
  m.texte || '(sans texte)',
  m.images?.length ? `\nImages : ${m.images.join(', ')}` : '',
].join('\n')
const nomZip = () => {
  const d = new Date()
  return `messages-KNOVA-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.zip`
}

export function routes(r) {
  r.get('/api/ktec/messages', () => lireMessages())

  // { appli, ecran, texte, images: [{ nom, donnees (data:image/…;base64,…) }] }
  r.post('/api/ktec/messages', async (ctx) => {
    const { appli = 'ktec', ecran = '', texte = '', images = [] } = await ctx.json()
    if (!String(texte).trim() && !images.length) throw new ErreurHttp(400, 'Écrivez un message ou ajoutez une image.')
    if (images.length > IMAGES_MAX) throw new ErreurHttp(400, `${IMAGES_MAX} images au plus.`)
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const noms = images.map((image, i) => {
      const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/.exec(image.donnees || '')
      if (!m) throw new ErreurHttp(400, 'Image PNG, JPEG, GIF ou WebP seulement.')
      const octets = Buffer.from(m[2], 'base64')
      if (octets.length > TAILLE_MAX) throw new ErreurHttp(400, 'Image trop lourde (5 Mo au plus).')
      const nom = `${id}-${i + 1}.${m[1].replace('jpeg', 'jpg')}`
      enregistrerFichier('ktec-messages', nom, octets, 'Message au développeur')
      return nom
    })
    const appliConnue = applisPubliques().find((a) => a.id === appli)
    const message = {
      id,
      date: new Date().toISOString(),
      appli: appliConnue?.nom || 'K.NOVA',
      version: appliConnue?.version || version(),
      ktec: version(),
      ecran: String(ecran).slice(0, 200),
      poste: reglagesPoste().nomAgent || os.userInfo().username,
      ordinateur: os.hostname(),
      texte: String(texte).slice(0, 10_000),
      images: noms,
      etat: 'a_faire',
    }
    ecrireInfo('ktec.messages', [message, ...lireMessages()])
    return message
  })

  // { motDePasse, ids? } : vérifie le mot de passe et prépare le mail (adresse « mailto: » ouverte par la messagerie
  // du poste). Les messages envoyés passent « en cours ». Le zip des captures est à joindre au mail.
  r.post('/api/ktec/messages/envoi', async (ctx) => {
    const { motDePasse, ids } = await ctx.json()
    verifierMotDePasseEnvoi(motDePasse)
    const messages = lireMessages()
    const choisis = messages.filter((m) => (Array.isArray(ids) && ids.length ? ids.includes(m.id) : m.etat !== 'fait'))
    if (!choisis.length) throw new ErreurHttp(400, 'Aucun message à envoyer.')
    const avecImages = choisis.some((m) => m.images?.length)
    // Un lien « mailto: » trop long est refusé par Outlook : le corps est raccourci, le zip a tout.
    let corps = choisis.map(texteMessage).join('\n\n----------------------------------------\n\n')
    if (corps.length > 1500) corps = corps.slice(0, 1500) + '\n\n[…] La suite est dans le zip joint.'
    if (avecImages) corps += `\n\nCaptures d’écran : joindre le fichier ${nomZip()} (dossier Téléchargements).`
    const sujet = `K.NOVA — ${choisis.length} message${choisis.length > 1 ? 's' : ''} (${[...new Set(choisis.map((m) => m.appli))].join(', ')})`
    const maintenant = new Date().toISOString()
    for (const m of choisis) {
      m.envoyeLe = maintenant
      if (m.etat === 'a_faire') m.etat = 'en_cours'
    }
    ecrireInfo('ktec.messages', messages)
    return {
      mailto: `mailto:${DESTINATAIRE}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`,
      zip: avecImages ? `/api/ktec/messages/export.zip?ids=${choisis.map((m) => m.id).join(',')}` : null,
    }
  })

  r.post('/api/ktec/messages/:id', async (ctx) => {
    const { etat, supprimer } = await ctx.json()
    const messages = lireMessages()
    const message = messages.find((m) => m.id === ctx.params.id)
    if (!message) throw new ErreurHttp(404, 'Message introuvable')
    if (supprimer) {
      for (const nom of message.images || []) supprimerFichier('ktec-messages', nom)
      ecrireInfo('ktec.messages', messages.filter((m) => m.id !== message.id))
      return { supprime: true }
    }
    if (!ETATS.includes(etat)) throw new ErreurHttp(400, 'État inconnu')
    message.etat = etat
    ecrireInfo('ktec.messages', messages)
    return message
  })

  r.get('/api/ktec/messages/images/:nom', (ctx) => {
    const nom = path.basename(ctx.params.nom)
    const octets = lireFichier('ktec-messages', nom)
    if (!octets) throw new ErreurHttp(404, 'Image introuvable')
    const ext = path.extname(nom).slice(1)
    envoyerOctets(ctx.res, Buffer.from(octets), { type: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` })
  })

  // Tous les messages (ou seulement ceux qui ne sont pas faits, ou ceux demandés : ?ids=a,b) dans un zip :
  // un texte lisible et les images.
  r.get('/api/ktec/messages/export.zip', (ctx) => {
    const ids = ctx.query.ids ? String(ctx.query.ids).split(',') : null
    const tous = lireMessages().filter((m) => (ids ? ids.includes(m.id) : ctx.query.tous || m.etat !== 'fait'))
    const texte = tous.map(texteMessage).join('\n\n----------------------------------------\n\n')
    const fichiers = [{ nom: 'messages.txt', octets: Buffer.from(`Messages au développeur (${tous.length})\n\n${texte}\n`, 'utf8') }, { nom: 'messages.json', octets: Buffer.from(JSON.stringify(tous, null, 2), 'utf8') }]
    for (const m of tous) for (const nom of m.images || []) {
      const octets = lireFichier('ktec-messages', nom)
      if (octets) fichiers.push({ nom: `images/${nom}`, octets: Buffer.from(octets) })
    }
    envoyerOctets(ctx.res, creerZip(fichiers), { type: 'application/zip', nom: nomZip(), telecharger: true })
  })
}
