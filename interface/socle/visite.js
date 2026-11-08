// Les visites guidées : K.NOVA montre un cas d'usage sur le vrai écran, étape par étape. La page s'assombrit sauf
// la zone utile, une bulle explique, et l'application fait elle-même les choix (« Suivant »).
//
// Chaque application décrit ses visites dans interface/visites.js :
//   export const visites = { 'mon-cas': { titre, etapes: [ { cible, titre, texte, avant, attendre } ] } }
//     cible    : sélecteur CSS (ou fonction → élément) de la zone à montrer ; sans cible : bulle au centre
//     texte    : texte de la bulle (ou fonction → texte, lue après « avant »)
//     avant    : async () => …, ce que la visite fait à la place de l'utilisateur avant de montrer l'étape
//     attendre : sélecteur à attendre (écran qui se charge, aperçu qui se calcule), 20 s au plus
//     zoom     : grossit la zone montrée, le temps de l'étape (2 : deux fois plus grande)
// On la lance par l'adresse : /<appli>/#/<écran>?visite=<id> (le bouton « Voir le cas d'usage » du wiki).
//
// La présentation d'une application enchaîne ses visites dans un ordre logique : export const presentation = ['id', …]
// (ou presentations = { appli: [...] } quand plusieurs applications partagent le fichier). Elle est proposée au premier
// lancement sur ce poste, et se relance par le bouton de la barre du haut.

import { h, ic, fenetre } from './ui.js'

const ATTENTE_MAX = 20_000
const MARGE = 10
const AVANT_MAINTIEN = 250 // un simple clic n'affiche rien
const MAINTIEN = 1200

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
  const nomVisite = h('span', {}, visite.titre || 'Visite guidée')
  const suivant = h('button', { class: 'principal petit' })
  const quitter = h('button', { class: 'discret petit' }, 'Quitter la visite')
  const bulle = h('div', { class: 'visite-bulle', role: 'dialog' },
    h('div', { class: 'visite-tete' }, ic('etincelle', 16), nomVisite, compteur),
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
    let enlever = () => {}
    let zoomee = null
    const sansZoom = () => {
      if (zoomee) Object.assign(zoomee.style, { transform: '', zIndex: '', position: '', transition: '' })
      zoomee = null
    }
    const arreter = () => {
      fini = true
      sansZoom()
      enlever()
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

    // Maintenir le clic hors de la bulle : un anneau se remplit, et la présentation s'arrête quand il est plein.
    let attente = null
    let anneau = null
    const relacher = () => {
      clearTimeout(attente)
      anneau?.remove()
      anneau = null
    }
    const surAppui = (e) => {
      if (e.button !== 0 || bulle.contains(e.target)) return
      relacher()
      attente = setTimeout(() => {
        anneau = h('div', { class: 'visite-maintien', style: { left: `${e.clientX}px`, top: `${e.clientY}px` } }, h('i'), h('span', {}, 'Maintenez pour passer la présentation'))
        document.body.append(anneau)
        attente = setTimeout(arreter, MAINTIEN)
      }, AVANT_MAINTIEN)
    }
    document.addEventListener('pointerdown', surAppui, true)
    for (const fin of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(fin, relacher, true)
    enlever = () => {
      relacher()
      document.removeEventListener('pointerdown', surAppui, true)
      for (const fin of ['pointerup', 'pointercancel', 'blur']) window.removeEventListener(fin, relacher, true)
    }

    const montrer = async (i) => {
      const e = visite.etapes[i]
      sansZoom()
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
      cible?.scrollIntoView({ block: 'center', inline: e.zoom ? 'center' : 'nearest', behavior: 'smooth' })
      if (e.zoom && cible) {
        zoomee = cible
        Object.assign(cible.style, { position: 'relative', zIndex: 3, transition: 'transform .35s cubic-bezier(.2,.7,.2,1)', transform: `scale(${e.zoom})` })
      }
      titre.textContent = e.titre || ''
      nomVisite.textContent = e.chapitre || visite.titre || 'Visite guidée'
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

// ---------------------------------------------------------------- la présentation d'une application

export async function chargerPresentation(appli) {
  try {
    const m = await import(`/apps/${appli}/interface/visites.js`)
    const ids = m.presentations?.[appli] ?? m.presentation
    if (!ids?.length) return null
    return { titre: 'Présentation', etapes: ids.flatMap((id) => (m.visites[id]?.etapes || []).map((e) => ({ ...e, chapitre: m.visites[id].titre }))) }
  } catch {
    return null // pas de présentation pour cette application
  }
}

// Au premier lancement sur ce poste, on propose la présentation (une seule fois, même si on refuse).
export async function proposerPresentation(appli, nom, presentation) {
  const cle = `knova-presentation-${appli}`
  try {
    if (localStorage.getItem(cle)) return
    localStorage.setItem(cle, new Date().toISOString())
  } catch {
    return // sans mémoire, on ne la proposerait à chaque ouverture
  }
  const oui = await fenetre({
    titre: `Bienvenue dans ${nom}`,
    contenu: h('p', { style: { margin: 0 } }, `Une présentation guidée vous montre les cas d’usage, sur le vrai écran, dans l’ordre. Elle ne modifie rien, se quitte à tout moment et se relance avec le bouton `, ic('lecture', 14), ` en haut de l’écran.`),
    boutons: [{ texte: 'Plus tard', classe: 'discret', valeur: false }, { texte: 'Commencer', classe: 'principal', valeur: true }],
  })
  if (oui) await lancerVisite(presentation)
}
