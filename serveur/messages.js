// Les messages au développeur : depuis n'importe quelle application, un texte et des images (captures d'écran)
// pour proposer une amélioration ou signaler un souci. Ils restent chez vous : rangés dans le fichier de
// connaissances (réglage « ktec.messages » et fichiers « ktec-messages »), jamais envoyés sur Internet.
// Le portail les liste (à faire, en cours, fait) et les exporte en un zip à transmettre.

import os from 'node:os'
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
      appli: appliConnue?.nom || 'KTEC',
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

  // Tous les messages (ou seulement ceux qui ne sont pas faits) dans un zip : un texte lisible et les images.
  r.get('/api/ktec/messages/export.zip', (ctx) => {
    const tous = lireMessages().filter((m) => ctx.query.tous || m.etat !== 'fait')
    const ETIQUETTES = { a_faire: 'À faire', en_cours: 'En cours', fait: 'Fait' }
    const texte = tous.map((m) => [
      `# ${m.appli} ${m.version} — ${new Date(m.date).toLocaleString('fr-FR')} — ${ETIQUETTES[m.etat]}`,
      `Écran : ${m.ecran || '—'} · Poste : ${m.poste} (${m.ordinateur}) · KTEC ${m.ktec}`,
      '',
      m.texte || '(sans texte)',
      m.images?.length ? `\nImages : ${m.images.join(', ')}` : '',
    ].join('\n')).join('\n\n----------------------------------------\n\n')
    const fichiers = [{ nom: 'messages.txt', octets: Buffer.from(`Messages au développeur (${tous.length})\n\n${texte}\n`, 'utf8') }, { nom: 'messages.json', octets: Buffer.from(JSON.stringify(tous, null, 2), 'utf8') }]
    for (const m of tous) for (const nom of m.images || []) {
      const octets = lireFichier('ktec-messages', nom)
      if (octets) fichiers.push({ nom: `images/${nom}`, octets: Buffer.from(octets) })
    }
    const d = new Date()
    envoyerOctets(ctx.res, creerZip(fichiers), { type: 'application/zip', nom: `messages-KTEC-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.zip`, telecharger: true })
  })
}
