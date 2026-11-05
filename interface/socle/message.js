// « Message au développeur » : une petite fenêtre pour proposer une amélioration, avec des captures d'écran
// (collées avec Ctrl+V, glissées ou choisies). Le message est rangé dans le fichier de connaissances, avec
// l'application, l'écran, la version et le poste. Pour l'envoyer : un mot de passe, puis Outlook s'ouvre avec
// le mail prêt (K.NOVA lui-même ne se connecte pas à Internet).

import { h, vider, ic, notifier, fenetre } from './ui.js'
import { api } from './api.js'

const IMAGES_MAX = 6
const COTE_MAX = 1920 // les grandes captures sont réduites (largeur ou hauteur) avant l'envoi

export function ouvrirMessage({ appli = 'ktec', ecran = '' } = {}) {
  const images = [] // { nom, donnees }
  const texte = h('textarea', { rows: 6, placeholder: 'Ce qui vous gêne, ou ce que vous aimeriez voir dans l’application…' })
  const vignettes = h('div', { class: 'vignettes-message' })
  const choix = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } })

  const dessiner = () => vider(vignettes, images.map((im, i) => h('div', { class: 'vignette-message' },
    h('img', { src: im.donnees, alt: im.nom }),
    h('button', { class: 'discret icone-seule', title: 'Retirer cette image', onclick: () => { images.splice(i, 1); dessiner() } }, ic('x', 14)))))

  const ajouter = async (fichiers) => {
    for (const f of [...fichiers].filter((x) => x.type.startsWith('image/'))) {
      if (images.length >= IMAGES_MAX) return notifier(`${IMAGES_MAX} images au plus.`, 'erreur')
      images.push({ nom: f.name || 'capture.png', donnees: await reduire(f) })
    }
    dessiner()
  }
  choix.addEventListener('change', () => ajouter(choix.files))
  const zone = h('div', { class: 'zone-message' }, texte, vignettes,
    h('div', { class: 'actions' },
      h('button', { class: 'petit', onclick: () => choix.click() }, ic('image', 14), 'Ajouter une image'),
      h('span', { class: 'discret', style: { fontSize: '13px' } }, 'ou collez une capture d’écran (Ctrl+V), ou glissez-la ici.')),
    choix)
  zone.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); ajouter(f) } })
  zone.addEventListener('dragover', (e) => e.preventDefault())
  zone.addEventListener('drop', (e) => { e.preventDefault(); ajouter(e.dataTransfer.files) })

  setTimeout(() => texte.focus(), 50)
  return fenetre({
    titre: 'Message au développeur',
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2' }, 'Une idée d’amélioration, un souci ? Décrivez-le, avec une capture si possible. Le message est gardé dans le fichier de connaissances (« Messages » sur le portail) ; avec le mot de passe, il part au développeur par Outlook.'),
      zone),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer seulement', classe: 'discret', action: () => enregistrer() },
      { texte: 'Envoyer par Outlook…', classe: 'principal', action: async () => {
        const message = await enregistrer()
        if (message) await envoyerParOutlook([message.id])
        return Boolean(message)
      } },
    ],
  })

  async function enregistrer() {
    if (!texte.value.trim() && !images.length) { notifier('Écrivez un message ou ajoutez une image.', 'erreur'); return false }
    const message = await api('/api/ktec/messages', { methode: 'POST', corps: { appli, ecran, texte: texte.value, images } })
    notifier('Message enregistré, merci !')
    return message
  }
}

// L'envoi : le mot de passe (demandé une fois par page), puis le mail s'ouvre dans Outlook, captures comprises.
let motDePasseRetenu = ''
export async function envoyerParOutlook(ids = null) {
  let reponse = null
  if (motDePasseRetenu) reponse = await api('/api/ktec/messages/envoi', { methode: 'POST', corps: { motDePasse: motDePasseRetenu, ids } }).catch(() => null)
  if (!reponse) {
    const champ = h('input', { type: 'password', autocomplete: 'off', placeholder: 'Mot de passe' })
    setTimeout(() => champ.focus(), 50)
    reponse = await fenetre({
      titre: 'Envoyer au développeur',
      contenu: h('div', {}, h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'L’envoi est réservé aux personnes qui ont reçu le mot de passe. Outlook s’ouvrira avec le mail prêt à partir.'), champ),
      boutons: [
        { texte: 'Annuler', classe: 'discret', valeur: null },
        { texte: 'Préparer le mail', classe: 'principal', action: async () => {
          const r = await api('/api/ktec/messages/envoi', { methode: 'POST', corps: { motDePasse: champ.value, ids } })
          motDePasseRetenu = champ.value
          return r
        } },
      ],
    })
  }
  if (!reponse) return false
  if (!reponse.ouvert) {
    const lien = h('a', { href: reponse.eml, download: 'message-KNOVA.eml' })
    document.body.append(lien)
    lien.click()
    lien.remove()
  }
  notifier(reponse.ouvert ? 'Outlook s’ouvre avec le mail prêt, captures comprises : il ne reste qu’à l’envoyer.' : 'Ouvrez le fichier message-KNOVA.eml téléchargé : Outlook l’affiche prêt à envoyer.')
  return true
}

// Une image en « data: » ; réduite si elle dépasse COTE_MAX, en PNG (captures) ou JPEG si elle reste lourde.
function reduire(fichier) {
  return new Promise((ok, echec) => {
    const lecteur = new FileReader()
    lecteur.onerror = () => echec(new Error('Image illisible'))
    lecteur.onload = () => {
      const img = new Image()
      img.onerror = () => echec(new Error('Image illisible'))
      img.onload = () => {
        const echelle = Math.min(1, COTE_MAX / Math.max(img.width, img.height))
        if (echelle === 1 && fichier.size < 1.5 * 1024 * 1024 && /png|jpe?g|webp|gif/.test(fichier.type)) return ok(lecteur.result)
        const toile = document.createElement('canvas')
        toile.width = Math.round(img.width * echelle)
        toile.height = Math.round(img.height * echelle)
        toile.getContext('2d').drawImage(img, 0, 0, toile.width, toile.height)
        const png = toile.toDataURL('image/png')
        ok(png.length < 2.5 * 1024 * 1024 ? png : toile.toDataURL('image/jpeg', 0.88))
      }
      img.src = lecteur.result
    }
    lecteur.readAsDataURL(fichier)
  })
}
