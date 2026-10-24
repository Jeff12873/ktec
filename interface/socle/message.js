// « Message au développeur » : une petite fenêtre pour proposer une amélioration, avec des captures d'écran
// (collées avec Ctrl+V, glissées ou choisies). Le message est rangé dans le fichier de connaissances, avec
// l'application, l'écran, la version et le poste ; rien n'est envoyé sur Internet.

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
      h('p', { class: 'texte-2' }, 'Une idée d’amélioration, un souci ? Décrivez-le, avec une capture si possible. Le message reste chez vous, dans le fichier de connaissances : il sera lu et exporté depuis le lanceur (« Messages »).'),
      zone),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      {
        texte: 'Enregistrer le message',
        classe: 'principal',
        action: async () => {
          if (!texte.value.trim() && !images.length) { notifier('Écrivez un message ou ajoutez une image.', 'erreur'); return false }
          await api('/api/ktec/messages', { methode: 'POST', corps: { appli, ecran, texte: texte.value, images } })
          notifier('Message enregistré, merci !')
          return true
        },
      },
    ],
  })
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
