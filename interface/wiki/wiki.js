// Le wiki de K.NOVA (/wiki/) : toutes les pages d'aide de K.NOVA et des applications installées, un sommaire,
// une recherche, et les notes du site écrites par l'administrateur (rangées dans le fichier .ktec).
//
//   #/<livre>/<page>   une page (livre : « ktec » ou l'identifiant d'une application)
//   #/notes/<id>       une note du site à part
//   #/recherche?q=…    les résultats d'une recherche
//
// Conventions des pages (fichiers HTML, voir serveur/wiki.js) :
//   class="admin"                         → pastille « Admin » : ce cas se règle côté administrateur
//   <script type="application/json" data-maquette>{…}</script>
//                                         → une maquette annotée de l'écran (voir maquette() plus bas)

import { h, vider, ic, notifier, fenetre, confirmer, formulaire, nomAppli, NOM_KNOVA } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { etat, suivreEtat, surChangement, modeAdmin } from '/socle/etat.js'
import { boutonAdmin } from '/socle/fichier.js'
import { ouvrirMessage } from '/socle/message.js'

const racine = document.getElementById('wiki')
let donnees = { livres: [], notes: [] }
let index = null // le texte de toutes les pages, lu à la première recherche

const sommaire = h('nav', { class: 'wiki-sommaire' })
const article = h('main', { class: 'wiki-article' })
const recherche = h('input', { type: 'search', class: 'wiki-recherche', placeholder: 'Rechercher dans le wiki…', autocomplete: 'off' })
const coin = h('div', { class: 'wiki-coin' })

await suivreEtat()
await charger()
vider(racine, h('div', { class: 'wiki' },
  h('header', { class: 'wiki-entete' },
    h('a', { class: 'wiki-titre', href: '#/ktec/bienvenue' }, h('img', { src: '/icone.svg', alt: '' }), nomAppli(NOM_KNOVA), h('span', {}, 'Wiki')),
    recherche,
    h('div', { style: { flex: 1 } }),
    coin,
    h('a', { class: 'bouton petit discret', href: '/', title: 'Retour au portail K.NOVA' }, ic('retour', 14), 'Portail')),
  h('div', { class: 'wiki-corps' }, sommaire, article)))
dessinerCoin()
surChangement((nouveau, ancien) => {
  dessinerCoin()
  if (Boolean(nouveau.modeAdmin) !== Boolean(ancien.modeAdmin)) charger().then(afficher)
})

let attente = null
recherche.addEventListener('input', () => {
  clearTimeout(attente)
  attente = setTimeout(() => (location.hash = recherche.value.trim() ? `#/recherche?q=${encodeURIComponent(recherche.value.trim())}` : '#/ktec/bienvenue'), 250)
})
window.addEventListener('hashchange', afficher)
afficher()

function dessinerCoin() {
  vider(coin, modeAdmin() ? h('span', { class: 'pastille-admin', title: 'Vous pouvez ajouter et modifier les notes du site' }, 'Admin') : null, boutonAdmin(etat.partage))
}

async function charger() {
  try {
    donnees = await api('/api/ktec/wiki')
  } catch (erreur) {
    notifier(erreur.message, 'erreur')
  }
}

// ---------------------------------------------------------------- navigation

// (Fonctions déclarées : la page s'affiche dès le chargement, plus haut.)
function pages() {
  return donnees.livres.flatMap((l) => l.sections.flatMap((s) => s.pages.map((p) => ({ ...p, livre: l, section: s }))))
}
// (alias : les anciens noms de page, ceux du « ? » des écrans d'avant le wiki.)
function trouver(livre, id) {
  return pages().find((p) => p.livre.id === livre && (p.id === id || (p.alias || []).includes(id)))
}

function route() {
  const [chemin, q] = location.hash.replace(/^#\/?/, '').split('?')
  const [a, b] = chemin.split('/')
  return { a, b, q: new URLSearchParams(q || '').get('q') || '' }
}

async function afficher() {
  const { a, b, q } = route()
  if (a === 'recherche') {
    if (recherche.value.trim() !== q) recherche.value = q
    dessinerSommaire(null)
    return afficherRecherche(q)
  }
  if (a === 'notes') {
    const note = donnees.notes.find((n) => n.id === b)
    dessinerSommaire(`notes/${b}`)
    return note ? afficherNoteSeule(note) : introuvable()
  }
  const page = trouver(a, b) || (a && !b ? pages().find((p) => p.livre.id === a) : null) || trouver('ktec', 'bienvenue') || pages()[0]
  if (!page) return introuvable()
  dessinerSommaire(`${page.livre.id}/${page.id}`)
  await afficherPage(page)
}

function introuvable() {
  vider(article, h('div', { class: 'bandeau' }, ic('alerte'), 'Page introuvable.'), h('p', {}, h('a', { href: '#/ktec/bienvenue' }, 'Revenir à l’accueil du wiki')))
}

function dessinerSommaire(actif) {
  const pageSeules = donnees.notes.filter((n) => !n.page)
  vider(sommaire,
    donnees.livres.map((l) => h('details', { class: 'wiki-livre', open: !actif || actif.startsWith(`${l.id}/`) || l.id === 'ktec' },
      h('summary', { style: { '--accent': l.couleur } }, h('img', { src: l.icone, alt: '' }), nomAppli(l.nom, l.couleur)),
      l.sections.map((s) => h('div', { class: 'wiki-section' },
        h('div', { class: 'wiki-section-titre' }, s.titre),
        s.pages.map((p) => h('a', { href: `#/${l.id}/${p.id}`, class: actif === `${l.id}/${p.id}` ? 'actif' : '' }, h('span', {}, p.titre), p.admin ? pastilleAdmin() : null)))))),
    pageSeules.length || modeAdmin()
      ? h('details', { class: 'wiki-livre', open: true },
        h('summary', {}, ic('livre', 16), 'Notes du site'),
        h('div', { class: 'wiki-section' },
          pageSeules.map((n) => h('a', { href: `#/notes/${n.id}`, class: actif === `notes/${n.id}` ? 'actif' : '' }, h('span', {}, n.titre), n.admin ? pastilleAdmin() : null)),
          modeAdmin() ? h('button', { class: 'petit discret', onclick: () => editerNote({ page: null }) }, ic('plus', 14), 'Nouvelle page du site') : null))
      : null)
  sommaire.querySelector('a.actif')?.scrollIntoView({ block: 'nearest' })
}

function pastilleAdmin(titre = 'Se règle côté administrateur') {
  return h('span', { class: 'pastille-admin', title: titre }, 'Admin')
}

// ---------------------------------------------------------------- une page

async function afficherPage(page) {
  const contenu = h('div', { class: 'wiki-contenu' })
  const liste = pages()
  const i = liste.findIndex((p) => p === liste.find((x) => x.livre.id === page.livre.id && x.id === page.id))
  const lienEcran = page.ecran ? (page.livre.id === 'ktec' ? page.ecran : `/${page.livre.id}/#/${page.ecran}`) : null
  vider(article,
    h('div', { class: 'wiki-fil' },
      h('span', { style: { color: page.livre.couleur } }, page.livre.nom), ic('suivant', 12), h('span', {}, page.section.titre),
      h('div', { style: { flex: 1 } }),
      page.admin ? pastilleAdmin('Cette page parle de réglages réservés à l’administrateur') : null,
      lienEcran ? h('a', { class: 'bouton petit', href: lienEcran, target: '_blank', rel: 'noopener', title: 'Ouvrir cet écran dans un nouvel onglet' }, ic('lien', 14), 'Ouvrir l’écran') : null),
    contenu,
    notesDeLaPage(`${page.livre.id}/${page.id}`),
    piedDePage(page, liste[i - 1], liste[i + 1]))
  const reponse = await fetch(page.livre.base + page.id + '.html').catch(() => null)
  contenu.innerHTML = reponse?.ok ? await reponse.text() : '<p>Cette page n’est pas encore écrite.</p>'
  preparer(contenu, page.livre)
  article.scrollTop = 0
  window.scrollTo(0, 0)
  document.title = `${contenu.querySelector('h1')?.textContent || page.titre} — Wiki K.NOVA`
}

// Les pastilles « Admin », les maquettes annotées, et le sommaire de la page.
function preparer(contenu, livre) {
  // « Sur cette page » : un lien par partie (titres h2), dès qu'il y en a trois.
  const parties = [...contenu.querySelectorAll('h2')]
  if (parties.length >= 3) {
    const encart = h('nav', { class: 'wiki-sur-page' }, h('b', {}, 'Sur cette page'),
      parties.map((t) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }) } }, t.textContent.replace(/^Admin\s*/, ''))))
    ;(contenu.querySelector('.but') || contenu.querySelector('h1'))?.after(encart)
  }
  for (const e of contenu.querySelectorAll('.admin')) {
    const cible = e.tagName === 'DETAILS' ? e.querySelector('summary') : e
    cible?.prepend(pastilleAdmin(), ' ')
  }
  // « Voir le cas d'usage » : la visite guidée sur le vrai écran, dans un onglet à part (socle/visite.js).
  for (const b of contenu.querySelectorAll('[data-visite]')) {
    const adresse = `/${livre.id}/#/${b.dataset.ecran || ''}?visite=${encodeURIComponent(b.dataset.visite)}`
    b.replaceWith(h('button', { class: 'bouton-visite', title: 'K.NOVA ouvre l’écran et vous montre, étape par étape', onclick: () => window.open(adresse, 'knova-visite') }, ic('marche', 16), b.textContent || 'Voir le cas d’usage'))
  }
  for (const s of contenu.querySelectorAll('script[data-maquette]')) {
    try {
      s.replaceWith(maquette(JSON.parse(s.textContent), livre))
    } catch {
      s.remove()
    }
  }
}

// Une maquette annotée : l'écran dessiné en blocs (jamais une vraie capture : aucune donnée du site), et des
// repères numérotés. { titre, ratio (hauteur / largeur, en %), blocs: [[x, y, l, h, texte, genre]],
// reperes: [[x, y, légende, admin?]] } — positions et tailles en % du cadre.
// genres : barre, menu, zone, carte, bouton, accent, champ, texte, graphe.
function maquette(m, livre) {
  const cadre = h('div', { class: 'maquette-cadre', style: { paddingTop: `${m.ratio || 56}%`, '--accent': livre.couleur } })
  for (const [x, y, l, ht, texte, genre] of m.blocs || []) {
    cadre.append(h('div', { class: `m-bloc m-${genre || 'zone'}`, style: { left: `${x}%`, top: `${y}%`, width: `${l}%`, height: `${ht}%` } }, texte ? h('span', {}, texte) : null))
  }
  ;(m.reperes || []).forEach(([x, y], k) => cadre.append(h('div', { class: 'm-repere', style: { left: `${x}%`, top: `${y}%` } }, String(k + 1))))
  return h('figure', { class: 'maquette' },
    m.titre ? h('figcaption', {}, ic('image', 14), m.titre) : null,
    cadre,
    h('ol', { class: 'maquette-legende' }, (m.reperes || []).map(([, , texte, admin]) => h('li', {}, admin ? [pastilleAdmin(), ' '] : null, texte))))
}

function piedDePage(page, avant, apres) {
  return h('footer', { class: 'wiki-pied' },
    h('div', { class: 'wiki-contact' },
      ic('envoyer', 18),
      h('div', {},
        h('b', {}, 'Toujours bloqué ? '),
        'Écrivez au développeur : décrivez ce que vous faisiez, ce que vous attendiez, et joignez une capture d’écran. Le message est gardé dans le fichier de connaissances, puis transmis par la personne qui en a la charge.'),
      h('button', { class: 'petit', onclick: () => ouvrirMessage({ appli: page.livre.id, ecran: `Wiki : ${page.titre}` }) }, 'Message au développeur')),
    h('div', { class: 'wiki-suite' },
      avant ? h('a', { href: `#/${avant.livre.id}/${avant.id}` }, '← ', avant.titre) : h('span'),
      apres ? h('a', { href: `#/${apres.livre.id}/${apres.id}` }, apres.titre, ' →') : h('span')))
}

// ---------------------------------------------------------------- notes du site

// Le texte d'une note, écrit simplement : paragraphes, lignes « - » en liste, **gras**. (Jamais de HTML.)
function texteNote(texte) {
  const bloc = h('div', { class: 'note-texte' })
  const gras = (ligne) => ligne.split(/\*\*(.+?)\*\*/g).map((morceau, k) => (k % 2 ? h('b', {}, morceau) : morceau))
  for (const paragraphe of String(texte || '').split(/\n\s*\n/)) {
    const lignes = paragraphe.split('\n').filter((l) => l.trim())
    if (!lignes.length) continue
    if (lignes.every((l) => /^\s*[-•]\s/.test(l))) bloc.append(h('ul', {}, lignes.map((l) => h('li', {}, gras(l.replace(/^\s*[-•]\s/, ''))))))
    else bloc.append(h('p', {}, lignes.flatMap((l, k) => (k ? [h('br'), ...gras(l)] : gras(l)))))
  }
  return bloc
}

function carteNote(n) {
  return h('div', { class: 'wiki-note' },
    h('div', { class: 'wiki-note-titre' }, ic('livre', 15), h('b', {}, n.titre), n.admin ? pastilleAdmin() : null, h('div', { style: { flex: 1 } }),
      modeAdmin() ? [
        h('button', { class: 'discret icone-seule', title: 'Modifier cette note', onclick: () => editerNote(n) }, ic('crayon', 15)),
        h('button', { class: 'discret icone-seule', title: 'Supprimer cette note', onclick: () => supprimerNote(n) }, ic('poubelle', 15)),
      ] : null),
    texteNote(n.texte))
}

function notesDeLaPage(cle) {
  const notes = donnees.notes.filter((n) => n.page === cle)
  if (!notes.length && !modeAdmin()) return null
  return h('section', { class: 'wiki-notes' },
    h('h2', {}, 'Notes du site'),
    notes.length ? notes.map(carteNote) : h('p', { class: 'texte-2' }, 'Aucune note pour cette page. Ajoutez-y vos procédures, contacts ou précisions propres au site : elles sont rangées dans le fichier de connaissances.'),
    modeAdmin() ? h('button', { class: 'petit discret', onclick: () => editerNote({ page: cle }) }, ic('plus', 14), 'Ajouter une note') : null)
}

function afficherNoteSeule(n) {
  vider(article, h('div', { class: 'wiki-fil' }, h('span', {}, 'Notes du site')), h('div', { class: 'wiki-contenu' }, h('h1', {}, n.titre), n.admin ? h('p', {}, pastilleAdmin()) : null), carteNote({ ...n, titre: 'Note du site' }))
}

async function editerNote(note) {
  const form = formulaire([
    { nom: 'titre', libelle: 'Titre', obligatoire: true, large: true },
    { nom: 'texte', libelle: 'Texte', type: 'zone', aide: 'Une ligne vide sépare les paragraphes ; une ligne qui commence par « - » fait une liste ; **gras**.' },
    { nom: 'admin', libelle: 'Pour qui ?', type: 'choix', choix: [['', 'Tout le monde'], ['oui', 'Cas administrateur (pastille Admin)']] },
  ], { titre: note.titre || '', texte: note.texte || '', admin: note.admin ? 'oui' : '' })
  form.element.querySelector('textarea').rows = 10
  const valeurs = await fenetre({
    titre: note.id ? 'Modifier la note du site' : note.page ? 'Nouvelle note sur cette page' : 'Nouvelle page du site',
    large: true,
    contenu: h('div', {}, h('p', { class: 'texte-2' }, 'Rangée dans le fichier de connaissances : visible sur tous les postes qui l’ouvrent, jamais envoyée ailleurs.'), form.element),
    boutons: [{ texte: 'Annuler', classe: 'discret' }, { texte: 'Enregistrer', classe: 'principal', action: () => form.lire() }],
  })
  if (!valeurs) return
  try {
    const r = await api('/api/ktec/wiki/notes', { methode: 'POST', corps: { id: note.id, page: note.page, titre: valeurs.titre, texte: valeurs.texte, admin: valeurs.admin === 'oui' } })
    donnees.notes = r.notes
    index = null
    notifier('Note enregistrée')
    if (!note.page && !note.id) location.hash = `#/notes/${r.note.id}`
    else afficher()
  } catch (erreur) {
    notifier(erreur.message, 'erreur')
  }
}

async function supprimerNote(note) {
  if (!(await confirmer(`Supprimer la note « ${note.titre} » ?`, { texte: 'Supprimer', danger: true }))) return
  try {
    donnees.notes = (await api('/api/ktec/wiki/notes', { methode: 'POST', corps: { id: note.id, supprimer: true } })).notes
    index = null
    afficher()
  } catch (erreur) {
    notifier(erreur.message, 'erreur')
  }
}

// ---------------------------------------------------------------- recherche

function simple(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

async function construireIndex() {
  if (index) return index
  const lire = async (p) => {
    const r = await fetch(p.livre.base + p.id + '.html').catch(() => null)
    const div = h('div')
    div.innerHTML = r?.ok ? await r.text() : ''
    div.querySelectorAll('script').forEach((s) => {
      // Les légendes des maquettes comptent aussi.
      try {
        s.replaceWith((JSON.parse(s.textContent).reperes || []).map((x) => x[2]).join(' · '))
      } catch {
        s.remove()
      }
    })
    return { cle: `#/${p.livre.id}/${p.id}`, livre: p.livre, titre: p.titre, admin: p.admin, texte: div.textContent.replace(/\s+/g, ' ').trim(), mots: p.mots || '' }
  }
  index = [
    ...(await Promise.all(pages().map(lire))),
    ...donnees.notes.map((n) => ({ cle: n.page ? `#/${n.page}` : `#/notes/${n.id}`, livre: { nom: 'Notes du site', couleur: 'var(--texte-2)' }, titre: n.titre, admin: n.admin, texte: n.texte || '', mots: '' })),
  ]
  return index
}

async function afficherRecherche(q) {
  vider(article, h('p', { class: 'texte-2' }, 'Recherche…'))
  const mots = simple(q).split(/\s+/).filter((m) => m.length > 1)
  const resultats = (await construireIndex())
    .map((p) => {
      const titre = simple(p.titre)
      const texte = simple(`${p.texte} ${p.mots}`)
      if (!mots.every((m) => titre.includes(m) || texte.includes(m))) return null
      const score = mots.reduce((s, m) => s + (titre.includes(m) ? 10 : 0) + Math.min(5, texte.split(m).length - 1), 0)
      return { ...p, score }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
  vider(article,
    h('div', { class: 'wiki-contenu' },
      h('h1', {}, `Recherche : « ${q} »`),
      h('p', { class: 'texte-2' }, resultats.length ? `${resultats.length} page${resultats.length > 1 ? 's' : ''}` : 'Aucune page ne contient tous ces mots. Essayez un mot plus court, ou un synonyme.'),
      resultats.map((r) => h('a', { class: 'wiki-resultat', href: r.cle },
        h('div', {}, h('span', { class: 'wiki-resultat-livre', style: { color: r.livre.couleur } }, r.livre.nom), h('b', {}, r.titre), r.admin ? pastilleAdmin() : null),
        h('p', {}, extrait(r.texte, mots))))))
}

// Le passage autour du premier mot trouvé, les mots cherchés surlignés.
function extrait(texte, mots) {
  const s = simple(texte)
  const pos = Math.max(0, Math.min(...mots.map((m) => s.indexOf(m)).filter((x) => x >= 0), s.length))
  const debut = Math.max(0, pos - 80)
  const bout = texte.slice(debut, debut + 240)
  const sb = simple(bout)
  const morceaux = []
  let k = 0
  while (k < bout.length) {
    const trouve = mots.map((m) => [m, sb.indexOf(m, k)]).filter(([, x]) => x >= 0).sort((a, b) => a[1] - b[1])[0]
    if (!trouve) { morceaux.push(bout.slice(k)); break }
    const [m, x] = trouve
    morceaux.push(bout.slice(k, x), h('mark', {}, bout.slice(x, x + m.length)))
    k = x + m.length
  }
  return [debut ? '… ' : '', ...morceaux, debut + 240 < texte.length ? ' …' : '']
}
