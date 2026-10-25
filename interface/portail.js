// Le portail KTEC : les applications installées sur ce poste, en tuiles.
// Un clic ouvre l'application (/birtec/, /pdrtec/…) ; la connexion MySQL et l'IA sont communes.

import { h, vider, ic, notifier, confirmer, fenetre, nomAppli } from './socle/ui.js'
import { api } from './socle/api.js'
import { etat, suivreEtat, surChangement } from './socle/etat.js'
import { etiquetteIA, etiquetteMySQL, demanderMotDePasse } from './socle/connexion.js'
import { carteMySQL, cartePoste, carteFichier, carteCle } from './socle/reglages.js'
import { etiquetteFichier, boutonAdmin } from './socle/fichier.js'
import { constellation } from './fond.js'
import { lancerAssistant } from './assistant.js'
import { ouvrirMessage } from './socle/message.js'
import { pointsNouveaux, encartNouveautes } from './socle/nouveautes.js'

// Les applications de la suite, pour montrer aussi celles qui ne sont pas (encore) installées.
const SUITE = [
  { id: 'birtec', nom: 'BiRTEC', couleur: '#10b981', sousTitre: 'Rapports BIRT', description: 'Rapports BIRT (tableaux, graphiques, tableaux croisés) et indicateurs ITM, sur la base de la GMAO.' },
  { id: 'pdrtec', nom: 'PDRTEC', couleur: '#a3e635', sousTitre: 'Recherche de pièces', description: 'Retrouver une pièce de rechange par ses caractéristiques, son emplacement, sa photo.' },
  { id: 'aitec', nom: 'AITEC', couleur: '#2dd4bf', sousTitre: 'Assistant IA', description: 'L’assistant IA de l’atelier : parc, historique, documents, réponses sourcées.' },
]

const racine = document.getElementById('portail')
const barre = h('div', { class: 'portail-etat' })
const applis = await api('/api/ktec/applis')
await suivreEtat()

// Premier lancement sur ce poste : l'assistant (fichier de connaissances, clé du site, connexion à la GMAO).
// Fichier chiffré sans la clé sur ce poste : seulement l'écran de la clé.
const assistant = await api('/api/ktec/assistant').catch(() => ({}))
const avecAssistant = Boolean(assistant.aFaire || assistant.cleManquante)

// Connexion MySQL configurée mais fermée : on propose le mot de passe une fois pour toutes les applications.
// Pas encore configurée : on ouvre les réglages.
if (!avecAssistant && location.hash !== '#reglages' && etat.connexion.configuree && !etat.connexion.ouverte && applis.length) demanderMotDePasse({ automatique: true })

const installees = new Set(applis.map((a) => a.id))
const tuiles = [
  ...applis.map((a) => h('a', { class: 'tuile-appli', href: `/${a.id}/`, style: a.couleur ? { '--accent': a.couleur } : {} },
    h('div', { class: 'tete' }, h('img', { src: `/apps/${a.id}/${a.icone || 'interface/icone.svg'}`, alt: '' }),
      h('div', {}, h('strong', {}, nomAppli(a.nom)), h('span', {}, a.sousTitre || ''))),
    h('p', {}, a.description || ''),
    h('span', { class: 'version' }, `Version ${a.version}`))),
  ...SUITE.filter((a) => !installees.has(a.id)).map((a) => h('a', { class: 'tuile-appli absente', href: '/installation/', style: { '--accent': a.couleur }, title: 'Pas encore installée sur ce poste : cliquer pour l’installer' },
    h('div', { class: 'tete' }, h('img', { src: '/icone.svg', alt: '' }), h('div', {}, h('strong', {}, nomAppli(a.nom)), h('span', {}, a.sousTitre))),
    h('p', {}, a.description),
    h('span', { class: 'version' }, 'Pas encore installée — l’installer'))),
]

// Réglages communs (connexion MySQL, ce poste) : bouton « Réglages » ou adresse /#reglages.
function ouvrirReglages() {
  const recharger = () => location.reload()
  fenetre({ titre: 'Réglages de KTEC', large: true, contenu: h('div', { class: 'grille grille-2' }, carteMySQL(recharger), cartePoste(recharger), carteFichier(recharger), carteCle(recharger)), boutons: [{ texte: 'Fermer', classe: 'discret' }] })
    .then(() => history.replaceState(null, '', '/'))
}
window.addEventListener('hashchange', () => location.hash === '#reglages' && ouvrirReglages())
const lienConfiguration = '#reglages'
function dessinerEtat() {
  vider(barre, etiquetteIA(etat.ia), etiquetteMySQL(etat.connexion, lienConfiguration), etiquetteFichier(etat.partage), boutonAdmin(etat.partage))
}
dessinerEtat()
surChangement((e) => (e.injoignable ? notifier('KTEC ne répond plus : relancez-le avec son raccourci.', 'erreur') : dessinerEtat()))

// « Messages » : les messages au développeur rangés dans le fichier de connaissances, avec leur état,
// et l'export en zip (texte + images) à transmettre.
const ETATS_MESSAGE = { a_faire: 'À faire', en_cours: 'En cours', fait: 'Fait' }
const boutonMessages = h('button', { class: 'petit discret', onclick: () => listeMessages() }, ic('livre', 14), 'Messages')
async function compterMessages() {
  try {
    const n = (await api('/api/ktec/messages')).filter((m) => m.etat !== 'fait').length
    vider(boutonMessages, ic('livre', 14), n ? `Messages (${n})` : 'Messages')
  } catch {}
}
async function listeMessages() {
  const liste = h('div', { class: 'liste-messages' })
  const dessiner = async () => {
    const messages = await api('/api/ktec/messages')
    vider(liste, messages.length ? messages.map((m) => h('div', { class: `message-dev${m.etat === 'fait' ? ' fait' : ''}` },
      h('div', { class: 'entete-message' },
        h('strong', {}, `${m.appli} ${String(m.version).split('.').slice(0, 3).join('.')}`),
        h('span', {}, `${m.ecran ? m.ecran + ' · ' : ''}${new Date(m.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · ${m.poste}`),
        h('span', { style: { flex: 1 } }),
        h('select', { class: 'mini', onchange: async (e) => { await api(`/api/ktec/messages/${m.id}`, { methode: 'POST', corps: { etat: e.target.value } }); dessiner(); compterMessages() } },
          Object.entries(ETATS_MESSAGE).map(([v, t]) => h('option', { value: v, selected: m.etat === v }, t))),
        h('button', { class: 'discret icone-seule', title: 'Supprimer ce message', onclick: async () => { if (!(await confirmer('Supprimer ce message et ses images ?', { texte: 'Supprimer', danger: true }))) return; await api(`/api/ktec/messages/${m.id}`, { methode: 'POST', corps: { supprimer: true } }); dessiner(); compterMessages() } }, ic('poubelle', 15))),
      m.texte ? h('p', {}, m.texte) : null,
      m.images?.length ? h('div', { class: 'vignettes-message' }, m.images.map((nom) => h('a', { href: `/api/ktec/messages/images/${encodeURIComponent(nom)}`, target: '_blank', rel: 'noopener' }, h('img', { src: `/api/ktec/messages/images/${encodeURIComponent(nom)}`, alt: 'Capture' })))) : null))
      : h('p', { class: 'texte-2' }, 'Aucun message pour l’instant. Chaque application a un bouton « Message au développeur » en haut à droite.'))
  }
  await dessiner()
  fenetre({
    titre: 'Messages au développeur',
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2' }, 'Les propositions d’amélioration envoyées depuis les applications. Elles restent dans le fichier de connaissances ; l’export en zip (textes et images) sert à les transmettre.'),
      liste),
    boutons: [
      { texte: 'Exporter (zip)', classe: '', action: () => { location.href = '/api/ktec/messages/export.zip'; return false } },
      { texte: 'Fermer', classe: 'principal', valeur: true },
    ],
  })
}
compterMessages()

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
      h('div', {}, h('h1', {}, nomAppli('KTEC')), h('p', { class: 'sous-titre' }, 'Les applications de l’atelier')),
      h('div', { class: 'espace' }),
      barre,
    ),
    applis.length ? null : h('div', { class: 'bandeau' }, ic('alerte'), 'Aucune application installée sur ce poste.'),
    h('div', { class: 'tuiles-applis' }, tuiles),
    // La confidentialité, dite simplement : c'est la première question qu'on pose sur ces outils.
    h('div', { class: 'portail-confiance' },
      h('h2', {}, ic('bouclier', 18), 'Vos informations restent chez vous'),
      h('p', {}, 'Ces outils ont été développés dans le respect de la propriété des informations : aucune donnée sensible ou d’entreprise n’est stockée dans les applications.'),
      h('div', { class: 'points-confiance' },
        h('div', {}, ic('livre', 16), h('span', {}, h('b', {}, 'Un fichier local unique. '), 'Tout ce qui concerne le site passe par un seul fichier de connaissances (.ktec), rangé chez vous.')),
        h('div', {}, ic('etincelle', 16), h('span', {}, h('b', {}, 'Une IA locale. '), 'L’intelligence artificielle tourne sur ce poste : rien n’est envoyé à l’extérieur.')),
        h('div', {}, ic('nuage', 16), h('span', {}, h('b', {}, 'Hors ligne. '), 'Le système fonctionne sans connexion à Internet.')))),
    h('div', { class: 'portail-pied' },
      h('span', { title: 'Les connaissances du site, communes à toutes les applications' }, ic('livre', 14), ' ', etat.partage?.fichier || etat.fichierKtec),
      h('span', {}, `KTEC ${etat.version}`),
      h('div', { style: { flex: 1 } }),
      h('a', { class: 'bouton petit discret', href: '/installation/', title: 'Mettre à jour, ajouter ou désinstaller des applications' }, ic('telecharger', 14), 'Installation et mises à jour'),
      h('button', { class: 'petit discret', onclick: () => ouvrirMessage({ appli: 'ktec', ecran: 'Lanceur' }) }, ic('envoyer', 14), 'Message au développeur'),
      boutonMessages,
      h('button', { class: 'petit discret', onclick: ouvrirReglages }, ic('reglages', 14), 'Réglages'),
      h('button', { class: 'petit discret', onclick: quitter }, ic('sortie', 14), 'Arrêter KTEC'),
    ),
  ),
)

constellation()

// Mises à jour : au lancement, KTEC regarde sur GitHub s'il existe des versions plus récentes que celles installées
// (programme et applications). Si oui, un bandeau propose de tout mettre à jour d'un clic : seuls les paquets
// changés sont téléchargés (quelques Mo), jamais Java, BIRT ni les modèles d'IA.
async function verifierMisesAJour() {
  try {
    const e = await api('/api/ktec/installation/etat')
    // Date de la dernière mise à jour, dans le pied du portail.
    if (e.installe?.misAJourLe) document.querySelector('.portail-pied span:nth-child(2)')?.after(h('span', { title: 'Dernière mise à jour du programme ou des applications' }, ic('rafraichir', 14), ` Mis à jour le ${new Date(e.installe.misAJourLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`))
    if (!e.installe || e.enInstallation || e.source !== 'github') return // en développement, ou lancé depuis un kit
    const cat = await api('/api/ktec/installation/catalogue')
    // « 0.4.2 » (copié du kit) et « 0.4.2.7 » (numéro de publication sur GitHub) sont la même version.
    const differente = (dispo, installee) => dispo && installee && dispo !== installee && !dispo.startsWith(installee + '.') && !installee.startsWith(dispo + '.')
    const aJour = [
      ...(differente(cat.socle?.version, e.installe.ktec) ? [{ nom: 'KTEC', version: cat.socle.version, points: pointsNouveaux(cat.socle.nouveautes, e.installe.ktec) }] : []),
      ...cat.applis.filter((a) => differente(a.disponible, e.installe.applis?.[a.id])).map((a) => ({ nom: a.nom, version: a.disponible, points: pointsNouveaux(a.nouveautes, e.installe.applis[a.id]) })),
    ]
    if (!aJour.length) return
    // Le bandeau, puis l'encart des nouveautés (sans détails) de chaque logiciel à mettre à jour.
    document.querySelector('.portail-entete')?.after(h('div', { class: 'carte-maj' },
      h('div', { class: 'bandeau info bandeau-maj' }, ic('telecharger'),
        h('span', { style: { flex: 1 } }, `Mise à jour disponible : ${aJour.map((a) => `${a.nom} ${String(a.version).split('.').slice(0, 3).join('.')}`).join(', ')}.`),
        h('a', { class: 'bouton petit principal', href: '/installation/?tout=1' }, 'Mettre à jour maintenant')),
      encartNouveautes(aJour)))
  } catch {
    // Pas d'accès à GitHub (hors ligne) : rien à signaler, la mise à jour par fichier reste possible.
  }
}
verifierMisesAJour()

if (avecAssistant) lancerAssistant({ seulementCle: !assistant.aFaire }).then(() => location.reload())
else if (location.hash === '#reglages' || !etat.connexion.configuree) ouvrirReglages()
