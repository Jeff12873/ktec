// La coquille commune des applications KTEC : le menu, la barre du haut, et l'écran du bloc choisi.
//
// La page /birtec/ charge /apps/birtec/interface/menu.js, qui exporte :
//   { nom, sousTitre, blocs: [...], accueil, configuration, auDemarrage(etat) }
// Chaque écran est un « bloc » (dossier blocs/<nom>/vue.js de l'application) qui exporte :
//   { chemin, titre, icone, menu, groupe, aide, afficher(zone, { id, query }) }

import { h, vider, ic, fenetreOuverte, notifier, nomAppli, COULEUR_KTEC } from './socle/ui.js'
import { etat, suivreEtat, surChangement } from './socle/etat.js'
import { appli, api } from './socle/api.js'
import { etiquetteIA, etiquetteMySQL } from './socle/connexion.js'
import { etiquetteFichier, boutonAdmin } from './socle/fichier.js'
import { ouvrirMessage } from './socle/message.js'

const racine = document.getElementById('appli')
const toutes = await api('/api/ktec/applis')
const description = toutes.find((a) => a.id === appli)
if (!description) {
  location.href = '/'
  throw new Error(`Application inconnue : ${appli}`)
}
const app = await import(`/apps/${appli}/interface/menu.js`)
const BLOCS = app.blocs
document.title = `${description.nom} — KTEC`
// La teinte de vert de l'application (app.json « couleur ») : boutons, sélections, filtres actifs…
if (description.couleur) document.documentElement.style.setProperty('--accent', description.couleur)
document.querySelector('link[rel=icon]').href = `/apps/${appli}/${description.icone || 'interface/icone.svg'}`
if (app.styles) document.head.append(h('link', { rel: 'stylesheet', href: `/apps/${appli}/${app.styles}` }))

const menu = h('nav', { class: 'menu' })
const barre = h('header', { class: 'barre' })
const zone = h('main', { class: 'contenu' })
let contenuBarre = ''
let affiche = null // le bloc affiché, pour le recharger quand le fichier partagé change
const autresApplis = toutes.filter((a) => a.id !== appli)

await suivreEtat()
vider(racine, h('div', { class: 'appli' }, menu, h('div', { class: 'zone-principale' }, barre, zone)))
surChangement(quandEtatChange)
window.addEventListener('hashchange', afficherBloc)

await app.auDemarrage?.(etat)
dessinerMenu()
dessinerBarre()
afficherBloc()

// ---------------------------------------------------------------- écrans

function routeActuelle() {
  const [chemin = '', ...reste] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/')
  const query = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''))
  const bloc = BLOCS.find((b) => b.chemin === chemin) || app.accueil || BLOCS[0]
  return { bloc, id: reste.join('/') || null, query }
}

async function afficherBloc() {
  const { bloc, id, query } = routeActuelle()
  affiche = bloc
  dessinerMenu()
  vider(zone)
  try {
    await bloc.afficher(zone, { id, query })
  } catch (erreur) {
    vider(zone, h('div', { class: 'bandeau' }, ic('alerte'), erreur.message))
  }
}

function dessinerMenu() {
  const actuel = routeActuelle().bloc
  vider(
    menu,
    // Retour au portail, et passage direct aux autres applications installées.
    h('a', { class: 'menu-ktec', href: '/', title: 'Portail KTEC : toutes les applications' }, ic('retour', 14), nomAppli('KTEC', COULEUR_KTEC)),
    h('div', { class: 'menu-titre' },
      h('img', { src: `/apps/${appli}/${description.icone || 'interface/icone.svg'}`, alt: '' }),
      h('div', {}, h('strong', {}, nomAppli(description.nom)), h('span', {}, description.sousTitre || ''))),
    // Les écrans par groupe (« groupe » de chaque bloc) : un titre discret avant chaque nouveau groupe.
    // Le groupe « Réglages » est poussé en bas du menu.
    // menu: 'admin' → écran visible seulement en mode administrateur.
    BLOCS.filter((b) => b.menu === true || (b.menu === 'admin' && etat.admin)).map((b, i, liste) => [
      b.groupe && b.groupe !== liste[i - 1]?.groupe
        ? h('div', { class: `menu-groupe ${b.groupe === 'Réglages' ? 'en-bas' : ''}` }, b.groupe)
        : null,
      h('a', { href: `#/${b.chemin}`, class: b === actuel ? 'actif' : '' }, ic(b.icone, 19), h('span', {}, b.titre)),
    ]),
    autresApplis.length
      ? h('div', { class: 'menu-autres' }, autresApplis.map((a) => h('a', { href: `/${a.id}/`, title: a.description || '' }, h('img', { src: `/apps/${a.id}/${a.icone || 'interface/icone.svg'}`, alt: '' }), nomAppli(a.nom, a.couleur))))
      : null,
    h('div', { class: 'pied' }, `${description.nom} ${description.version} · KTEC ${etat.version}`),
  )
}

// ---------------------------------------------------------------- barre du haut

function dessinerBarre() {
  const c = etat.connexion
  const p = etat.partage || {}
  const cle = JSON.stringify([etat.ia, c, p.nomFichier, p.avertissement, p.aPublier, p.publication, p.autreAdmin, p.admin, p.motDePasse])
  if (cle === contenuBarre) return
  contenuBarre = cle
  vider(
    barre,
    app.barre?.() || null,
    h('div', { class: 'espace' }),
    etiquetteIA(etat.ia),
    etiquetteMySQL(c, '/#reglages'),
    etiquetteFichier(p),
    boutonAdmin(p),
    h('button', { class: 'discret icone-seule', title: 'Message au développeur : proposer une amélioration', onclick: () => ouvrirMessage({ appli, ecran: routeActuelle().bloc.titre || '' }) }, ic('envoyer', 18)),
    h('button', { class: 'discret icone-seule', title: 'Aide sur cet écran', onclick: () => (location.hash = `#/aide/${routeActuelle().bloc.aide || 'premiers-pas'}`) }, ic('aide', 19)),
  )
}

function quandEtatChange(nouveau, ancien) {
  if (nouveau.injoignable) return notifier('KTEC ne répond plus : relancez-le avec son raccourci.', 'erreur')
  dessinerBarre()
  if (nouveau.partage?.avertissement && nouveau.partage.avertissement !== ancien.partage?.avertissement) notifier(nouveau.partage.avertissement)
  // Mode administrateur pris ou rendu : les écrans montrent ou cachent leurs boutons de modification.
  if (Boolean(nouveau.admin) !== Boolean(ancien.admin)) {
    dessinerMenu()
    if (!fenetreOuverte()) afficherBloc()
    return
  }
  // Le contenu du fichier a changé (modification d'un autre poste) : on recharge l'écran,
  // sauf si l'agent est en train d'écrire ou si l'écran ne le souhaite pas (assistant).
  if (ancien.partage && nouveau.partage?.version !== ancien.partage.version && affiche?.rafraichir !== false && !fenetreOuverte() && !saisieEnCours()) afficherBloc()
}

function saisieEnCours() {
  const actif = document.activeElement
  return actif && ['INPUT', 'TEXTAREA', 'SELECT'].includes(actif.tagName) && actif.value
}

// Les blocs redessinent l'écran avec window.ktec.recharger() (window.birtec : ancien nom, gardé).
window.ktec = { recharger: afficherBloc }
window.birtec = window.ktec
