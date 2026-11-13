// Le fichier de connaissances .ktec, côté écran : ouvrir ou créer un fichier (explorateur de dossiers),
// mode administrateur (fichier protégé par un mot de passe), étiquette d'état dans la barre du haut.

import { h, vider, ic, fenetre, formulaire, notifier, essayer, confirmer, heureFr } from './ui.js'
import { api } from './api.js'
import { etat } from './etat.js'

// ---------------------------------------------------------------- explorateur de dossiers

// Le navigateur ne donne pas le chemin complet d'un fichier : on parcourt les dossiers via le serveur.
// mode 'fichier' : on choisit un fichier (extensions) ; mode 'dossier' : on choisit un dossier.
export function explorateur(mode, surChoix, extensions = '.ktec') {
  const liste = h('div', { class: 'explorateur' })
  const racines = h('div', { class: 'racines' })
  const champ = h('input', { placeholder: 'Chemin du dossier, ex. Z:\\Maintenance ou \\\\serveur\\partage' })
  let dossierActuel = null
  async function aller(dossier) {
    try {
      const r = await api(`/api/ktec/explorer?extensions=${encodeURIComponent(extensions)}${dossier ? '&dossier=' + encodeURIComponent(dossier) : ''}`)
      dossierActuel = r.dossier
      champ.value = r.dossier || ''
      vider(racines, r.racines.map((x) => h('button', { class: 'petit', onclick: () => aller(x.chemin) }, x.nom)))
      vider(
        liste,
        r.parent ? h('div', { onclick: () => aller(r.parent) }, ic('monter', 16), 'Dossier parent') : null,
        r.dossiers.map((nom) => h('div', { onclick: () => aller(joindre(r.dossier, nom)) }, ic('dossier', 16), nom)),
        mode === 'fichier' ? r.fichiers.map((nom) => h('div', { class: 'fichier', onclick: () => surChoix(joindre(r.dossier, nom)) }, ic('document', 16), nom)) : null,
        r.dossier && !r.dossiers.length && !(mode === 'fichier' && r.fichiers.length) ? h('div', { class: 'discret' }, 'Dossier vide') : null,
      )
    } catch (erreur) {
      notifier(erreur.message, 'erreur')
    }
  }
  champ.addEventListener('keydown', (e) => e.key === 'Enter' && aller(champ.value.trim()))
  aller(null).then(() => racines.querySelector('button')?.click())
  return {
    element: h('div', {}, racines, h('div', { class: 'actions', style: { marginBottom: '10px' } }, champ, h('button', { onclick: () => aller(champ.value.trim()) }, 'Aller')), liste),
    dossier: () => dossierActuel,
  }
}

function joindre(dossier, nom) {
  const separateur = dossier.includes('\\') ? '\\' : '/'
  return dossier.endsWith(separateur) ? dossier + nom : dossier + separateur + nom
}

// ---------------------------------------------------------------- ouvrir, créer

export function ouvrirAutreFichier() {
  return new Promise((termine) => {
    // Pendant l'ouverture (un fichier sur un partage lent peut prendre quelques minutes la première fois).
    const attente = h('div', { class: 'chargement-assistant', hidden: true }, h('div', { class: 'rond-chargement' }), h('p', {}, 'Ouverture du fichier… Depuis un dossier partagé, la première fois peut prendre quelques minutes.'))
    const choix = explorateur('fichier', async (chemin) => {
      choix.element.hidden = true
      attente.hidden = false
      const ok = await essayer(() => api('/api/ktec/fichier/ouvrir', { methode: 'POST', corps: { chemin } }), 'Fichier ouvert')
      if (ok !== undefined) return location.reload()
      choix.element.hidden = false
      attente.hidden = true
    }, '.ktec,.birtec')
    fenetre({
      titre: 'Ouvrir un fichier de connaissances',
      large: true,
      contenu: h('div', {}, h('p', { class: 'texte-2' }, 'Parcourez les dossiers jusqu’au fichier .ktec (sur le lecteur réseau partagé, en général), puis cliquez dessus. Un ancien fichier .birtec est converti en .ktec à côté (l’original est gardé).'), choix.element, attente),
      boutons: [{ texte: 'Annuler', classe: 'discret' }],
    }).then(termine)
  })
}

export function creerNouveauFichier() {
  const choix = explorateur('dossier', () => {})
  const form = formulaire([{ nom: 'nom', libelle: 'Nom du fichier', obligatoire: true, defaut: 'connaissances', aide: '.ktec sera ajouté' }])
  return fenetre({
    titre: 'Créer un fichier de connaissances',
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2' }, '1. Choisissez le dossier : de préférence sur le lecteur réseau partagé, pour que tous les postes y aient accès.'),
      choix.element,
      h('p', { class: 'texte-2', style: { marginTop: '18px' } }, '2. Donnez-lui un nom.'),
      form.element),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      {
        texte: 'Créer le fichier',
        classe: 'principal',
        action: async () => {
          if (!choix.dossier()) throw new Error('Choisissez d’abord un dossier.')
          await api('/api/ktec/fichier/creer', { methode: 'POST', corps: { dossier: choix.dossier(), nom: form.lire().nom } })
          location.reload()
        },
      },
    ],
  })
}

// ---------------------------------------------------------------- mode administrateur

export async function ouvrirModeAdmin() {
  const p = etat.partage || {}
  const champs = [{ nom: 'nom', libelle: 'Votre nom', obligatoire: true, defaut: etat.poste?.nomAgent || '', aide: 'Affiché aux autres postes pendant que vous modifiez.' }]
  if (p.motDePasse) champs.push({ nom: 'motDePasse', libelle: 'Mot de passe administrateur', type: 'mot-de-passe', obligatoire: true })
  const form = formulaire(champs)
  await fenetre({
    titre: 'Passer en mode administrateur',
    contenu: h('div', {},
      h('p', { class: 'texte-2' }, 'Le mode administrateur permet de modifier le fichier de connaissances commun : documents, imports, dictionnaire, réglages. Un seul poste à la fois.'),
      p.autreAdmin ? h('div', { class: 'bandeau' }, ic('alerte'), `${p.autreAdmin.nom} (${p.autreAdmin.poste}) modifie le fichier depuis ${heureFr(new Date(p.autreAdmin.depuis).toISOString())}.`) : null,
      form.element),
    boutons: [
      { texte: 'Annuler', classe: 'discret' },
      {
        texte: 'Entrer',
        classe: 'principal',
        action: async () => {
          const valeurs = form.lire()
          let r = await api('/api/ktec/admin', { methode: 'POST', corps: valeurs })
          if (r.occupe) {
            const depuis = heureFr(new Date(r.occupe.depuis).toISOString())
            const forcer = await confirmer(
              `${r.occupe.nom} (poste ${r.occupe.poste}) modifie déjà le fichier depuis ${depuis}. Si cette personne a terminé ou si son poste est éteint, vous pouvez reprendre la main : ses dernières secondes de modifications non enregistrées seraient perdues.`,
              { texte: 'Reprendre la main', danger: true },
            )
            if (!forcer) return false
            r = await api('/api/ktec/admin', { methode: 'POST', corps: { ...valeurs, forcer: true } })
          }
          // La page se recharge : chaque écran se redessine avec les boutons et les réglages de l'administrateur.
          location.reload()
        },
      },
    ],
  })
}

export async function quitterModeAdmin() {
  if (await essayer(() => api('/api/ktec/admin', { methode: 'DELETE' }))) location.reload()
}

// ---------------------------------------------------------------- barre du haut

// L'état du fichier : nom, enregistrement en cours, autre poste qui modifie, réseau coupé.
export function etiquetteFichier(p = {}) {
  if (!p.nomFichier) return null
  let detail = ''
  let classe = ''
  if (p.avertissement) {
    detail = ' — ' + p.avertissement
    classe = 'orange'
  } else if (p.admin && p.publication?.erreur) {
    detail = ' — partage inaccessible, nouvel essai bientôt'
    classe = 'rouge'
  } else if (p.transfert === 'envoi') {
    detail = ' — envoi au partage…'
  } else if (p.admin && p.aPublier) {
    detail = ' — enregistrement…'
  } else if (p.admin && p.publication?.derniere) {
    detail = ` — enregistré à ${heureFr(p.publication.derniere)}`
  } else if (p.autreAdmin) {
    detail = ` — ${p.autreAdmin.nom} modifie en ce moment`
    classe = 'violet'
  } else if (p.transfert === 'reception') {
    detail = ' — mise à jour depuis le partage…'
  }
  return h('span', { class: `etiquette ${classe}`, title: (p.fichier || '') + detail }, ic('livre', 15), p.nomFichier + detail)
}

// Le bouton du mode administrateur : seulement utile si le fichier a un mot de passe (sinon les
// modifications prennent la main toutes seules), ou pour rendre la main. Il dit ce qu'il fait :
// « Passer en admin » (liseré tournant), puis « Passer en consultation » (rouge pastel).
export function boutonAdmin(p = {}) {
  if (p.admin?.ceNavigateur && !p.admin.auto) {
    return h('button', { class: 'petit bouton-admin actif', title: `Administrateur : ${p.admin.nom}. Revenir en consultation.`, onclick: quitterModeAdmin }, ic('cadenasOuvert', 16), 'Passer en consultation')
  }
  if (!p.motDePasse) return null
  // Le bouton est recréé à chaque changement d'état : on cale son liseré sur l'horloge pour qu'il tourne sans à-coup.
  return h('button', { class: 'petit bouton-admin', style: { animationDelay: `-${Math.round(performance.now() % 3000)}ms` }, onclick: ouvrirModeAdmin, title: 'Passer en mode administrateur pour modifier' }, ic('cadenas', 16), 'Passer en admin')
}
