// Les écrans des comptes, quand une licence est installée (sans licence, aucun ne s'affiche) :
//   - l'écran d'attente d'une personne qui n'a pas encore d'accès (sa demande est partie toute seule) ;
//   - l'écran « Comptes » de l'administrateur : les demandes, puis les comptes, application par application ;
//   - la carte « Licence » des réglages, pour l'importer ou la renouveler.
// Serveur : serveur/socle/comptes.js.

import { h, vider, ic, essayer, fenetre, notifier, confirmer, dateFr } from './ui.js'
import { api } from './api.js'

const NIVEAUX = [['aucun', 'Aucun'], ['lecture', 'Lecture'], ['ecriture', 'Écriture']]
const NOMS_APPLIS = { aitec: 'AITEC', prevtec: 'PREVTEC', birtec: 'BiRTEC', pdrtec: 'PDRTEC' }
const nomDe = (id) => NOMS_APPLIS[id] || id.toUpperCase()

// Sans aucun accès : cet écran à la place de tout le reste. Il se rouvre seul quand les droits arrivent.
export function ecranSansAcces(racine, c) {
  const admins = c.admins?.length ? c.admins.join(', ') : 'l’administrateur'
  const nom = h('input', { type: 'text', value: c.demande?.nom || '', placeholder: 'Votre nom et prénom', maxlength: 80 })
  const envoyer = async () => {
    if (await essayer(() => api('/api/ktec/comptes/demande', { methode: 'POST', corps: { nom: nom.value } }), 'Envoyé à l’administrateur')) location.reload()
  }
  const [titre, texte, suite] = c.probleme
    ? ['Licence à renouveler', c.probleme, null]
    : c.coupe
      ? ['Accès coupé', `Votre accès a été coupé par ${admins}.`, null]
      : c.demande?.statut === 'refusee'
        ? ['Demande refusée', `Votre demande d’accès a été refusée par ${admins}.`, h('button', { onclick: envoyer }, 'Redemander l’accès')]
        : ['Demande envoyée', `${c.admins?.length ? `L’administrateur ${admins}` : 'L’administrateur'} a été prévenu : vos droits sont en cours de création.`,
          h('div', { class: 'actions' }, nom, h('button', { class: 'principal', onclick: envoyer }, 'Envoyer mon nom'))]
  vider(racine, h('div', { class: 'ecran-sans-acces' },
    h('img', { src: '/icone.svg', alt: '', class: 'logo-sans-acces' }),
    h('h1', {}, titre),
    h('p', { class: 'texte-2' }, texte),
    c.demande?.statut === 'en_attente' && !c.coupe ? h('p', { class: 'discret' }, 'Pour qu’il vous reconnaisse, vous pouvez lui donner votre nom :') : null,
    suite,
    h('p', { class: 'discret petit-texte' }, `Compte Windows ${c.login} · poste ${c.poste}${c.client ? ` · ${c.client}` : ''}`),
    h('button', { class: 'discret petit', onclick: () => importerLicence() }, ic('cle', 14), 'J’ai le fichier de licence')))
}

// Choisir le fichier .licence : la personne qui l'importe devient administrateur.
export async function importerLicence() {
  const nom = h('input', { type: 'text', placeholder: 'Votre nom et prénom', maxlength: 80 })
  const choix = h('input', { type: 'file', accept: '.licence,application/json' })
  const ok = await fenetre({
    titre: 'Importer la licence',
    contenu: h('div', { class: 'grille', style: { gap: '10px' } },
      h('p', { class: 'texte-2', style: { margin: 0 } }, 'Le fichier .licence vient du développeur. En l’important, vous devenez administrateur : vous réglez ensuite les accès de chacun.'),
      h('label', { class: 'champ' }, h('span', {}, 'Votre nom'), nom),
      h('label', { class: 'champ' }, h('span', {}, 'Fichier de licence'), choix)),
    boutons: [{ texte: 'Annuler', classe: 'discret', valeur: false }, { texte: 'Importer', classe: 'principal', action: async () => {
      if (!choix.files[0]) { notifier('Choisissez le fichier .licence.', 'erreur'); return false }
      await api(`/api/ktec/licence?nom=${encodeURIComponent(nom.value)}`, { methode: 'POST', fichier: choix.files[0] })
      return true
    } }],
  })
  if (ok) { notifier('Licence importée : vous êtes administrateur'); setTimeout(() => location.reload(), 800) }
}

// La carte des réglages.
export function carteLicence(c) {
  return h('div', { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('cle', 18), 'Licence')),
    c?.lisible
      ? h('div', {},
        h('p', { class: 'texte-2', style: { marginTop: 0 } }, `${c.client} · ${(c.applis || []).map(nomDe).join(', ')} · ${c.fin ? `jusqu’au ${dateFr(c.fin)}` : 'sans date de fin'}`),
        c.probleme ? h('div', { class: 'bandeau' }, ic('alerte'), c.probleme) : null,
        c.admin ? h('div', { class: 'actions' }, h('button', { onclick: ouvrirComptes }, ic('personne', 16), 'Comptes'), h('button', { class: 'discret', onclick: importerLicence }, ic('cle', 16), 'Remplacer la licence')) : null)
      : h('div', {},
        h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Sans licence, tout le monde utilise K.NOVA comme aujourd’hui. Avec le fichier .licence du développeur, chaque personne n’a que les accès que vous lui donnez.'),
        h('button', { onclick: importerLicence }, ic('cle', 16), 'Importer la licence')))
}

// ---------------------------------------------------------------- l'écran Comptes de l'administrateur

// Les cases d'un compte : niveau par application de la licence, lignes permises, administrateur.
function editeur(v, lignes, compte) {
  // Les boutons gardés ici : la fenêtre est déjà fermée (retirée de la page) quand on lit les choix.
  const boutons = {}
  const radios = (app) => {
    const nomGroupe = `acces-${compte.login}-${app}`
    boutons[app] = NIVEAUX.map(([val]) => h('input', { type: 'radio', name: nomGroupe, value: val, checked: (compte.applis?.[app] || 'aucun') === val }))
    return h('div', { class: 'niveaux-compte' }, h('b', {}, nomDe(app)), NIVEAUX.map(([, texte], i) => h('label', {}, boutons[app][i], texte)))
  }
  const toutes = h('input', { type: 'checkbox', checked: compte.lignes === null || compte.lignes === undefined })
  const cases = lignes.map((l) => [l.id, h('input', { type: 'checkbox', checked: Boolean(compte.lignes?.includes(l.id)) })])
  const zoneLignes = h('div', { class: 'lignes-compte', hidden: toutes.checked }, cases.map(([id, c]) => h('label', {}, c, lignes.find((l) => l.id === id).nom)))
  toutes.onchange = () => { zoneLignes.hidden = toutes.checked }
  const admin = h('input', { type: 'checkbox', checked: Boolean(compte.admin) })
  const nom = h('input', { type: 'text', value: compte.nom || '', placeholder: 'Nom et prénom', maxlength: 80 })
  const element = h('div', { class: 'editeur-compte' },
    h('label', { class: 'champ' }, h('span', {}, 'Nom'), nom),
    (v.licence.applis || []).map(radios),
    lignes.length ? h('div', {}, h('label', {}, toutes, ' Toutes les lignes'), zoneLignes) : null,
    h('label', { class: 'discret' }, admin, ' Administrateur (règle les comptes, accès complet)'))
  const valeur = () => ({
    login: compte.login, nom: nom.value, admin: admin.checked,
    applis: Object.fromEntries(Object.entries(boutons).map(([app, liste]) => [app, liste.find((x) => x.checked)?.value || 'aucun'])),
    lignes: toutes.checked ? null : cases.filter(([, c]) => c.checked).map(([id]) => id),
  })
  // « Comme un autre compte » : recopie ses cases.
  const recopier = (autre) => {
    for (const [app, liste] of Object.entries(boutons)) for (const r of liste) r.checked = r.value === (autre.applis?.[app] || 'aucun')
    toutes.checked = autre.lignes === null
    zoneLignes.hidden = toutes.checked
    for (const [id, c] of cases) c.checked = Boolean(autre.lignes?.includes(id))
  }
  return { element, valeur, recopier }
}

const resume = (c, lignes) => [
  Object.entries(c.applis || {}).filter(([, n]) => n !== 'aucun').map(([a, n]) => `${nomDe(a)} : ${n === 'ecriture' ? 'Écriture' : 'Lecture'}`).join(' · ') || (c.admin ? 'Tout' : 'Aucun accès'),
  c.admin || c.lignes === null ? 'Toutes les lignes' : c.lignes.map((id) => lignes.find((l) => l.id === id)?.nom || id).join(', ') || 'Aucune ligne',
]

export async function ouvrirComptes() {
  const v0 = await essayer(() => api('/api/ktec/comptes'))
  if (!v0) return
  // Les lignes sont celles d'AITEC (Administration › Lignes) : elles ne servent que dans AITEC et PREVTEC.
  let lignes = []
  const aitecIci = (await api('/api/ktec/applis').catch(() => [])).some((a) => a.id === 'aitec')
  const avecLignes = (v0.licence.applis || []).some((a) => ['aitec', 'prevtec'].includes(a))
  if (aitecIci) {
    try {
      const r = await api('/api/aitec/parcs')
      lignes = (Array.isArray(r) ? r : r.parcs || []).filter((p) => !p.nonClasse && p.id).map((p) => ({ id: p.id, nom: p.nom }))
    } catch {}
  }
  const corps = h('div', { class: 'ecran-comptes' })
  const regler = async (valeur, message) => {
    const v = await essayer(() => api('/api/ktec/comptes/regler', { methode: 'POST', corps: valeur }), message)
    if (v) dessiner(v)
  }
  const modifier = async (v, c) => {
    const e = editeur(v, lignes, c)
    const ok = await fenetre({ titre: `${c.nom || c.login}`, contenu: e.element, boutons: [{ texte: 'Annuler', classe: 'discret', valeur: false }, { texte: 'Enregistrer', classe: 'principal', valeur: true }] })
    if (ok) regler(e.valeur(), 'Compte enregistré')
  }
  const couper = async (c) => {
    if (!(await confirmer(`Couper l’accès de ${c.nom || c.login} ? Il ne verra plus rien d’ici quelques secondes. Vous pourrez le rétablir avec Modifier.`, { texte: 'Couper', danger: true }))) return
    const v = await essayer(() => api('/api/ktec/comptes/couper', { methode: 'POST', corps: { login: c.login } }), 'Accès coupé')
    if (v) dessiner(v)
  }
  function dessiner(v) {
    const regles = v.comptes.filter((c) => !c.coupe || c.admin)
    vider(corps,
      h('p', { class: 'texte-2', style: { marginTop: 0 } }, `Licence ${v.licence.client} · ${(v.licence.applis || []).map(nomDe).join(', ')} · ${v.licence.fin ? `jusqu’au ${dateFr(v.licence.fin)}` : 'sans date de fin'}`),
      v.licence.probleme ? h('div', { class: 'bandeau' }, ic('alerte'), v.licence.probleme) : null,
      avecLignes && !aitecIci ? h('div', { class: 'bandeau' }, ic('alerte'), 'Installez AITEC sur ce poste pour régler les lignes : en attendant, chaque compte voit toutes les lignes.') : null,
      h('div', { class: 'actions accueil-comptes' },
        h('span', { style: { flex: 1 } }, v.accueil
          ? h('span', {}, h('b', {}, 'Accueil en lecture actif : '), 'chaque personne qui ouvre l’outil reçoit la lecture et apparaît ci-dessous.')
          : h('span', { class: 'discret' }, 'Accueil en lecture coupé : les nouvelles personnes demandent l’accès.')),
        h('button', { class: 'petit', onclick: async () => { const r = await essayer(() => api('/api/ktec/comptes/accueil', { methode: 'POST', corps: { actif: !v.accueil } })); if (r) dessiner(r) } }, v.accueil ? 'Couper l’accueil' : 'Rouvrir l’accueil')),
      h('h3', {}, v.demandes.filter((d) => d.statut === 'en_attente').length ? `Demandes (${v.demandes.filter((d) => d.statut === 'en_attente').length})` : 'Demandes'),
      v.demandes.filter((d) => d.statut === 'en_attente').length
        ? v.demandes.filter((d) => d.statut === 'en_attente').map((d) => {
          const e = editeur(v, lignes, { login: d.login, nom: d.nom, applis: {}, lignes: null })
          const modele = h('select', { onchange: (x) => { const autre = v.comptes.find((c) => c.login === x.target.value); if (autre) e.recopier(autre) } },
            h('option', { value: '' }, 'Comme un autre compte…'), regles.map((c) => h('option', { value: c.login }, c.nom || c.login)))
          return h('div', { class: 'carte demande-compte' },
            h('div', { class: 'entete-demande' }, h('b', {}, d.nom || d.login), h('span', { class: 'discret' }, ` ${d.nom ? `(${d.login}) ` : ''}— poste ${d.poste} — ${new Date(d.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`)),
            e.element,
            h('div', { class: 'actions' }, modele,
              h('button', { class: 'discret', onclick: async () => { const r = await essayer(() => api('/api/ktec/comptes/refuser', { methode: 'POST', corps: { login: d.login } }), 'Demande refusée'); if (r) dessiner(r) } }, 'Refuser'),
              h('button', { class: 'principal', onclick: () => regler(e.valeur(), `${d.nom || d.login} a ses accès`) }, 'Accepter')))
        })
        : h('p', { class: 'discret' }, 'Aucune demande en attente.'),
      h('h3', {}, 'Comptes'),
      h('div', { class: 'tableau-conteneur' }, h('table', { class: 'tableau' },
        h('thead', {}, h('tr', {}, ['Compte', 'Accès', 'Lignes', 'Dernière ouverture', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, v.comptes.map((c) => {
          const [acces, lignesTexte] = resume(c, lignes)
          return h('tr', { class: c.coupe ? 'compte-coupe' : '' },
            h('td', {}, h('b', {}, c.nom || c.login), c.admin ? h('span', { class: 'etiquette' }, 'admin') : null, c.accueil ? h('span', { class: 'etiquette orange', title: 'Arrivé par l’accueil en lecture : à régler' }, 'accueil') : null, h('div', { class: 'discret petit-texte' }, `${c.login}${c.poste ? ` · ${c.poste}` : ''}`)),
            h('td', {}, c.coupe ? 'Coupé' : acces), h('td', {}, lignesTexte), h('td', {}, c.vu ? dateFr(c.vu) : '—'),
            h('td', { class: 'actions' }, h('button', { class: 'petit', onclick: () => modifier(v, c) }, 'Modifier'), c.admin || c.coupe ? null : h('button', { class: 'petit discret danger', onclick: () => couper(c) }, 'Couper')))
        })))))
  }
  dessiner(v0)
  await fenetre({ titre: 'Comptes', large: true, contenu: corps, boutons: [{ texte: 'Fermer', classe: 'discret', valeur: true }] })
}

// Le bouton « Comptes » de l'administrateur, avec le nombre de demandes en attente.
export function boutonComptes(c) {
  if (!c?.admin) return null
  return h('button', { class: `petit${c.demandes ? ' principal' : ' discret'}`, onclick: ouvrirComptes, title: 'Les accès de chacun' }, ic('personne', 14), c.demandes ? `Comptes · ${c.demandes} demande${c.demandes > 1 ? 's' : ''}` : 'Comptes')
}
