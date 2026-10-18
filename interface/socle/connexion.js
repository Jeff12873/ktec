// La connexion MySQL, commune à toutes les applications : le mot de passe est demandé une fois,
// gardé en mémoire par le serveur KTEC jusqu'à sa fermeture, jamais enregistré.

import { h, ic, fenetre, notifier } from './ui.js'
import { api } from './api.js'
import { etat, actualiserEtat } from './etat.js'

// automatique : demande faite d'office à l'ouverture d'une page. Si l'utilisateur a déjà répondu
// « Plus tard » pendant cette session du navigateur, on ne la refait pas à chaque application.
export async function demanderMotDePasse({ automatique = false } = {}) {
  if (automatique && sessionStorage.getItem('ktec-mysql-plus-tard')) return
  const c = etat.connexion
  const champ = h('input', { type: 'password', autocomplete: 'current-password' })
  await fenetre({
    titre: 'Connexion à MySQL',
    contenu: h(
      'div',
      {},
      h('p', { class: 'texte-2' }, `Base « ${c.base} » sur ${c.serveur}:${c.port}, utilisateur « ${c.utilisateur} ».`),
      h('label', { class: 'champ' }, h('span', {}, 'Mot de passe'), champ, h('small', { class: 'aide' }, 'Gardé en mémoire jusqu’à la fermeture de KTEC, jamais enregistré. Valable pour toutes les applications.')),
    ),
    boutons: [
      { texte: 'Plus tard', classe: 'discret', action: () => sessionStorage.setItem('ktec-mysql-plus-tard', '1') },
      {
        texte: 'Se connecter',
        classe: 'principal',
        action: async () => {
          const infos = await api('/api/ktec/session', { methode: 'POST', corps: { motDePasse: champ.value } })
          await actualiserEtat()
          notifier(`Connecté : ${infos.serveur}`)
          if (infos.compteEnEcriture) notifier('Attention : ce compte MySQL peut modifier la base. KTEC ne fait que lire, mais un compte en lecture seule est plus sûr.', 'erreur')
        },
      },
    ],
  })
}

// Les étiquettes de la barre du haut, communes au portail et aux applications.
export function etiquetteMySQL(c, lienConfiguration) {
  if (!c.configuree) return h('a', { class: 'etiquette orange', href: lienConfiguration }, ic('base', 15), 'MySQL à configurer')
  if (!c.ouverte) return h('button', { class: 'etiquette orange', onclick: demanderMotDePasse, title: 'Saisir le mot de passe MySQL' }, ic('cadenas', 15), `${c.base} : connexion fermée`)
  const avertissement = c.infos?.compteEnEcriture ? ' — attention : ce compte peut modifier la base' : ''
  return h('span', { class: `etiquette ${avertissement ? 'orange' : 'accent'}`, title: `${c.utilisateur}@${c.serveur}:${c.port} — ${c.infos?.serveur || ''}${avertissement}` }, ic('base', 15), `${c.base} sur ${c.serveur}`)
}

export function etiquetteIA(ia = {}) {
  if (!ia.installee) return h('span', { class: 'etiquette rouge', title: 'Le moteur d’IA n’est pas installé sur ce poste' }, h('span', { class: 'point' }), 'IA non installée')
  const titre = `${ia.modele} sur ${ia.appareil}`
  if (ia.chat === 'démarrage') return h('span', { class: 'etiquette orange', title: titre }, h('span', { class: 'point anime' }), "Chargement de l'IA…")
  if (ia.chat === 'prêt') return h('span', { class: 'etiquette accent', title: titre }, h('span', { class: 'point' }), 'IA prête')
  return h('span', { class: 'etiquette', title: titre }, h('span', { class: 'point' }), 'IA en veille')
}
