// La connexion à la GMAO, commune à toutes les applications : réglée une fois par l'administrateur et rangée
// (chiffrée) dans le fichier de connaissances. Aucun mot de passe n'est jamais demandé aux utilisateurs.

import { h, ic, notifier } from './ui.js'
import { etat } from './etat.js'

// Pour les applications d'avant KTEC 0.6, qui proposaient de saisir le mot de passe : il n'y a plus rien à saisir,
// on dit seulement pourquoi la connexion n'est pas ouverte.
export async function demanderMotDePasse({ automatique = false } = {}) {
  if (automatique || etat.connexion?.ouverte) return
  notifier(messageConnexion(etat.connexion), 'erreur')
}

export function messageConnexion(c = {}) {
  if (!c.configuree || !c.motDePasse) return 'La connexion à la GMAO n’est pas réglée : l’administrateur doit la renseigner (Réglages du lanceur KTEC).'
  return `Connexion à la GMAO impossible : ${c.erreur || 'serveur injoignable'}.`
}

// L'étiquette de la barre du haut, commune au portail et aux applications.
export function etiquetteMySQL(c, lienConfiguration) {
  if (!c.configuree || !c.motDePasse) return h('a', { class: 'etiquette orange', href: lienConfiguration, title: 'L’administrateur doit régler la connexion à la GMAO (Réglages)' }, ic('base', 15), 'GMAO non réglée')
  if (!c.ouverte) return h('a', { class: 'etiquette rouge', href: lienConfiguration, title: c.erreur || 'Connexion impossible' }, ic('cadenas', 15), `${c.base} : connexion impossible`)
  return h('span', { class: 'etiquette accent', title: `${c.base} sur ${c.serveur}:${c.port}${c.infos?.serveur ? ` — ${c.infos.serveur}` : ''}` }, ic('base', 15), `${c.base} sur ${c.serveur}`)
}

export function etiquetteIA(ia = {}) {
  if (!ia.installee) return h('span', { class: 'etiquette rouge', title: 'Le moteur d’IA n’est pas installé sur ce poste' }, h('span', { class: 'point' }), 'IA non installée')
  const titre = `${ia.modele} sur ${ia.appareil}`
  if (ia.chat === 'démarrage') return h('span', { class: 'etiquette orange', title: titre }, h('span', { class: 'point anime' }), "Chargement de l'IA…")
  if (ia.chat === 'prêt') return h('span', { class: 'etiquette accent', title: titre }, h('span', { class: 'point' }), 'IA prête')
  return h('span', { class: 'etiquette', title: titre }, h('span', { class: 'point' }), 'IA en veille')
}
