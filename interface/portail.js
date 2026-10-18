// Le portail KTEC : les applications installées sur ce poste, en tuiles.
// Un clic ouvre l'application (/birtec/, /pdrtec/…) ; la connexion MySQL et l'IA sont communes.

import { h, vider, ic, notifier, confirmer, fenetre } from './socle/ui.js'
import { api } from './socle/api.js'
import { etat, suivreEtat, surChangement } from './socle/etat.js'
import { etiquetteIA, etiquetteMySQL, demanderMotDePasse } from './socle/connexion.js'
import { carteMySQL, cartePoste } from './socle/reglages.js'

// Les applications de la suite, pour montrer aussi celles qui ne sont pas (encore) installées.
const SUITE = [
  { id: 'birtec', nom: 'BiRTEC', sousTitre: 'Rapports BIRT', description: 'Rapports BIRT et indicateurs ITM, construits par formulaire sur la base de la GMAO.' },
  { id: 'pdrtec', nom: 'PDRTec', sousTitre: 'Recherche de pièces', description: 'Retrouver une pièce de rechange par ses caractéristiques, son emplacement, sa photo.' },
  { id: 'aitec', nom: 'AITEC', sousTitre: 'Assistant IA', description: 'L’assistant IA de l’atelier : parc, historique, documents, réponses sourcées.' },
]

const racine = document.getElementById('portail')
const barre = h('div', { class: 'portail-etat' })
const applis = await api('/api/ktec/applis')
await suivreEtat()

// Connexion MySQL configurée mais fermée : on propose le mot de passe une fois pour toutes les applications.
// Pas encore configurée : on ouvre les réglages.
if (location.hash !== '#reglages' && etat.connexion.configuree && !etat.connexion.ouverte && applis.length) demanderMotDePasse({ automatique: true })

const installees = new Set(applis.map((a) => a.id))
const tuiles = [
  ...applis.map((a) => h('a', { class: 'tuile-appli', href: `/${a.id}/` },
    h('div', { class: 'tete' }, h('img', { src: `/apps/${a.id}/${a.icone || 'interface/icone.svg'}`, alt: '' }),
      h('div', {}, h('strong', {}, a.nom), h('span', {}, a.sousTitre || ''))),
    h('p', {}, a.description || ''),
    h('span', { class: 'version' }, `Version ${a.version}`))),
  ...SUITE.filter((a) => !installees.has(a.id)).map((a) => h('div', { class: 'tuile-appli absente', title: 'Pas encore installée sur ce poste' },
    h('div', { class: 'tete' }, h('img', { src: '/icone.svg', alt: '' }), h('div', {}, h('strong', {}, a.nom), h('span', {}, a.sousTitre))),
    h('p', {}, a.description),
    h('span', { class: 'version' }, 'Pas encore installée'))),
]

// Réglages communs (connexion MySQL, ce poste) : bouton « Réglages » ou adresse /#reglages.
function ouvrirReglages() {
  const recharger = () => location.reload()
  fenetre({ titre: 'Réglages de KTEC', large: true, contenu: h('div', { class: 'grille grille-2' }, carteMySQL(recharger), cartePoste(recharger)), boutons: [{ texte: 'Fermer', classe: 'discret' }] })
    .then(() => history.replaceState(null, '', '/'))
}
window.addEventListener('hashchange', () => location.hash === '#reglages' && ouvrirReglages())
const lienConfiguration = '#reglages'
function dessinerEtat() {
  vider(barre, etiquetteIA(etat.ia), etiquetteMySQL(etat.connexion, lienConfiguration))
}
dessinerEtat()
surChangement((e) => (e.injoignable ? notifier('KTEC ne répond plus : relancez-le avec son raccourci.', 'erreur') : dessinerEtat()))

async function quitter() {
  if (!(await confirmer('Arrêter KTEC ? Les applications ouvertes ne répondront plus.', { texte: 'Arrêter' }))) return
  await api('/api/ktec/quitter', { methode: 'POST' })
  vider(racine, h('div', { class: 'portail' }, h('h1', {}, 'KTEC est arrêté'), h('p', { class: 'texte-2' }, 'Relancez-le avec son raccourci.')))
}

vider(
  racine,
  h('div', { class: 'portail' },
    h('div', { class: 'portail-entete' },
      h('img', { src: '/icone.svg', alt: '' }),
      h('div', {}, h('h1', {}, 'KTEC'), h('p', { class: 'sous-titre' }, 'Les applications de l’atelier')),
      h('div', { class: 'espace' }),
      barre,
    ),
    applis.length ? null : h('div', { class: 'bandeau' }, ic('alerte'), 'Aucune application installée sur ce poste.'),
    h('div', { class: 'tuiles-applis' }, tuiles),
    h('div', { class: 'portail-pied' },
      h('span', { title: 'Les connaissances du site, communes à toutes les applications' }, ic('livre', 14), ' ', etat.fichierKtec),
      h('span', {}, `KTEC ${etat.version}`),
      h('div', { style: { flex: 1 } }),
      h('button', { class: 'petit discret', onclick: ouvrirReglages }, ic('reglages', 14), 'Réglages'),
      h('button', { class: 'petit discret', onclick: quitter }, ic('sortie', 14), 'Arrêter KTEC'),
    ),
  ),
)

if (location.hash === '#reglages' || !etat.connexion.configuree) ouvrirReglages()
