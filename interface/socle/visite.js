// Les visites guidées : K.NOVA montre un cas d'usage sur le vrai écran, étape par étape. La page s'assombrit sauf
// la zone utile, une bulle explique, et l'application fait elle-même les choix (« Suivant »).
//
// Chaque application décrit ses visites dans interface/visites.js :
//   export const visites = { 'mon-cas': { titre, etapes: [ { cible, titre, texte, avant, attendre } ] } }
//     cible    : sélecteur CSS (ou fonction → élément) de la zone à montrer ; sans cible : bulle au centre
//     texte    : texte de la bulle (ou fonction → texte, lue après « avant »)
//     avant    : async () => …, ce que la visite fait à la place de l'utilisateur avant de montrer l'étape
//     attendre : sélecteur à attendre (écran qui se charge, aperçu qui se calcule), 20 s au plus
// On la lance par l'adresse : /<appli>/#/<écran>?visite=<id> (le bouton « Voir le cas d'usage » du wiki).

import { h, ic } from './ui.js'

const ATTENTE_MAX = 20_000
const MARGE = 10

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms))

async function attendreElement(quoi) {
  const trouver = () => (typeof quoi === 'function' ? quoi() : document.querySelector(quoi))
  const fin = Date.now() + ATTENTE_MAX
  while (Date.now() < fin) {
    const e = trouver()
    if (e && e.getBoundingClientRect().width) return e
    await pause(150)
  }
  return null
}

export async function lancerVisite(visite) {
  if (!visite?.etapes?.length) return
  document.querySelector('.visite')?.remove()
  const trou = h('div', { class: 'visite-trou' })
  const titre = h('b')
  const texte = h('p')
  const compteur = h('span', { class: 'visite-compteur' })
  const suivant = h('button', { class: 'principal petit' })
  const quitter = h('button', { class: 'discret petit' }, 'Quitter la visite')
  const bulle = h('div', { class: 'visite-bulle', role: 'dialog' },
    h('div', { class: 'visite-tete' }, ic('etincelle', 16), h('span', {}, visite.titre || 'Visite guidée'), compteur),
    titre, texte,
    h('div', { class: 'visite-boutons' }, quitter, suivant))
  const voile = h('div', { class: 'visite' }, trou, bulle)
  document.body.append(voile)

  let cible = null
  let fini = false
  // La zone éclairée suit l'élément (défilement, redimensionnement, écran qui bouge).
  const placer = () => {
    if (fini) return
    const r = cible?.getBoundingClientRect()
    if (r && r.width) {
      Object.assign(trou.style, { left: `${r.left - MARGE}px`, top: `${r.top - MARGE}px`, width: `${r.width + 2 * MARGE}px`, height: `${r.height + 2 * MARGE}px`, opacity: 1 })
      const b = bulle.getBoundingClientRect()
      const enDessous = r.bottom + MARGE + 14 + b.height < innerHeight
      const top = enDessous ? r.bottom + MARGE + 14 : Math.max(12, r.top - MARGE - 14 - b.height)
      const left = Math.min(Math.max(12, r.left), innerWidth - b.width - 12)
      Object.assign(bulle.style, { left: `${left}px`, top: `${Math.min(top, innerHeight - b.height - 12)}px`, transform: 'none' })
    } else {
      Object.assign(trou.style, { left: '50%', top: '50%', width: '0px', height: '0px', opacity: 1 })
      Object.assign(bulle.style, { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' })
    }
    requestAnimationFrame(placer)
  }

  return new Promise((terminer) => {
    const arreter = () => {
      fini = true
      voile.remove()
      document.removeEventListener('keydown', surTouche)
      terminer()
    }
    const surTouche = (e) => {
      if (e.key === 'Escape') arreter()
      if (e.key === 'Enter' || e.key === 'ArrowRight') suivant.click()
    }
    document.addEventListener('keydown', surTouche)
    quitter.onclick = arreter

    const montrer = async (i) => {
      const e = visite.etapes[i]
      suivant.disabled = true
      suivant.textContent = 'Un instant…'
      compteur.textContent = `${i + 1} / ${visite.etapes.length}`
      try {
        if (e.avant) await e.avant()
        if (e.attendre) await attendreElement(e.attendre)
        cible = e.cible ? await attendreElement(e.cible) : null
      } catch (erreur) {
        cible = null
        console.warn('Visite guidée :', erreur)
      }
      if (fini) return
      cible?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      titre.textContent = e.titre || ''
      texte.textContent = typeof e.texte === 'function' ? e.texte() : e.texte || ''
      const derniere = i === visite.etapes.length - 1
      suivant.disabled = false
      suivant.textContent = derniere ? 'Terminer' : 'Suivant'
      suivant.onclick = () => (derniere ? arreter() : montrer(i + 1))
      suivant.focus()
    }
    requestAnimationFrame(placer)
    montrer(0)
  })
}

// Au chargement d'une application : « ?visite=<id> » dans l'adresse lance la visite (une seule fois).
export async function visiteDemandee(appli, query) {
  if (!query?.visite) return
  const id = query.visite
  history.replaceState(null, '', location.href.replace(/([?&])visite=[^&#]*&?/, '$1').replace(/[?&]$/, ''))
  try {
    const { visites } = await import(`/apps/${appli}/interface/visites.js`)
    await lancerVisite(visites[id])
  } catch (erreur) {
    console.warn('Visite guidée introuvable :', id, erreur)
  }
}
