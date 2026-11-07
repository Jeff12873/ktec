// L'état général, demandé au serveur toutes les 4 secondes : fichier ouvert, mode administrateur,
// état de l'IA, publication sur le partage… Les écrans s'y abonnent avec surChangement().

import { api, adresse } from './api.js'

export const etat = { pret: false }
const abonnes = new Set()

export function surChangement(fonction) {
  abonnes.add(fonction)
  return () => abonnes.delete(fonction)
}

// Chaque page se fait connaître du serveur, et le prévient quand on la ferme : K.NOVA ne s'arrête que quand
// plus aucune page n'est ouverte, pas quand le navigateur endort la fenêtre (réduite, poste verrouillé, veille).
const PAGE = crypto.randomUUID()
addEventListener('pagehide', () => {
  fetch(adresse('/api/ktec/fermeture'), { method: 'POST', keepalive: true, headers: { 'X-KTEC': '1', 'X-Page': PAGE } }).catch(() => {})
})
// Revenue du cache du navigateur (retour arrière) : elle se refait connaître tout de suite.
addEventListener('pageshow', (e) => e.persisted && actualiserEtat())

export async function actualiserEtat() {
  try {
    const nouveau = await api('/api/ktec/etat', { entetes: { 'X-Page': PAGE } })
    const ancien = { ...etat }
    Object.assign(etat, nouveau, { pret: true, injoignable: false })
    for (const fonction of abonnes) fonction(etat, ancien)
  } catch {
    if (!etat.injoignable) {
      etat.injoignable = true
      for (const fonction of abonnes) fonction(etat, etat)
    }
  }
  return etat
}

export function suivreEtat() {
  setInterval(actualiserEtat, 4000)
  return actualiserEtat()
}

export const estAdmin = () => Boolean(etat.admin)

// Ce poste peut-il modifier le fichier .ktec ? En mode administrateur, ou quand le fichier n'a pas de mot de passe
// (la main est alors prise toute seule) et que personne d'autre ne le modifie.
export const peutModifier = () => Boolean(etat.admin) || (!etat.partage?.motDePasse && !etat.partage?.autreAdmin)

// Réglages, SQL et comptes de la GMAO : en mode administrateur, ou quand le fichier n'a pas de mot de passe.
export const modeAdmin = () => Boolean(etat.modeAdmin)
