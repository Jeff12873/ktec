// Réglages communs à tout KTEC : connexion MySQL (une seule pour toutes les applications) et ce poste.
// Montrés par le portail (bouton « Réglages ») et par l'écran de configuration des applications.

import { h, ic, formulaire, essayer, confirmer, fenetre, tailleFr, dateHeureFr } from './ui.js'
import { api } from './api.js'
import { etat, actualiserEtat } from './etat.js'
import { demanderMotDePasse } from './connexion.js'
import { ouvrirAutreFichier, creerNouveauFichier } from './fichier.js'

// ---------------------------------------------------------------- connexion MySQL

export function carteMySQL(apres = () => {}) {
  const c = etat.connexion
  const form = formulaire(
    [
      { nom: 'serveur', libelle: 'Serveur', obligatoire: true, aide: 'Nom ou adresse IP du serveur MySQL' },
      { nom: 'port', libelle: 'Port', type: 'nombre', defaut: 3306 },
      { nom: 'base', libelle: 'Base de données', obligatoire: true },
      { nom: 'utilisateur', libelle: 'Utilisateur', obligatoire: true, aide: 'De préférence un compte en lecture seule' },
    ],
    c,
  )
  const statut = c.ouverte
    ? h('div', { class: `bandeau ${c.infos?.compteEnEcriture ? '' : 'info'}` }, ic(c.infos?.compteEnEcriture ? 'alerte' : 'coche'),
        `Connecté à ${c.infos?.serveur || 'MySQL'}${c.infos?.compteEnEcriture ? ' — attention : ce compte peut modifier la base' : ' — compte en lecture seule'}.`)
    : c.configuree
      ? h('div', { class: 'bandeau' }, ic('cadenas'), 'Connexion fermée : le mot de passe est demandé à chaque ouverture.')
      : h('div', { class: 'bandeau info' }, ic('base'), 'Renseignez la connexion à la base MySQL de la GMAO.')

  return h(
    'div',
    { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('base', 18), 'Connexion MySQL')),
    statut,
    form.element,
    h('div', { class: 'actions', style: { marginTop: '14px' } },
      h('button', {
        class: 'principal',
        onclick: async () => {
          const ok = await essayer(() => api('/api/ktec/configuration/mysql', { methode: 'POST', corps: form.lire() }), 'Connexion enregistrée')
          if (ok !== undefined) {
            await actualiserEtat()
            demanderMotDePasse().then(() => apres())
          }
        },
      }, 'Enregistrer et se connecter'),
      c.configuree && !c.ouverte ? h('button', { onclick: () => demanderMotDePasse().then(() => apres()) }, ic('cadenas', 16), 'Saisir le mot de passe') : null,
      c.ouverte ? h('button', { class: 'discret', onclick: async () => { await api('/api/ktec/session', { methode: 'DELETE' }); await actualiserEtat(); apres() } }, 'Fermer la connexion') : null,
    ),
  )
}

// ---------------------------------------------------------------- ce poste

export function cartePoste(apres = () => {}) {
  const ia = etat.ia || {}
  const arret = h('input', { type: 'number', min: 1, max: 480, value: etat.poste?.arretIAMinutes || 20, style: { width: '110px' } })
  const ligne = (libelle, valeur) => h('div', { style: { display: 'flex', gap: '12px', padding: '6px 0', borderBottom: '1px solid var(--bord)' } }, h('span', { class: 'discret', style: { minWidth: '140px' } }, libelle), h('span', {}, valeur || '—'))
  return h(
    'div',
    { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('puce', 18), 'Ce poste')),
    ligne('Modèle d’IA', ia.installee ? ia.modele : 'non installé'),
    ligne('Calcul sur', ia.appareil),
    ligne('Java et BIRT', etat.java ? 'installés' : 'non installés : lancez l’installation de KTEC'),
    ligne('Connaissances', h('span', { class: 'mono' }, etat.fichierKtec)),
    h('label', { class: 'champ', style: { marginTop: '14px' } }, h('span', {}, 'Mettre l’IA en veille après (minutes)'), arret),
    h('div', { class: 'actions', style: { marginTop: '14px' } },
      h('button', { onclick: () => essayer(() => api('/api/ktec/poste', { methode: 'POST', corps: { arretIAMinutes: Number(arret.value) } }), 'Enregistré') }, 'Enregistrer'),
      h('button', {
        class: 'discret',
        onclick: async () => {
          if (!(await confirmer('Arrêter KTEC (toutes les applications) ? Relancez-le ensuite avec son raccourci.'))) return
          await api('/api/ktec/quitter', { methode: 'POST' })
          document.body.innerHTML = '<div class="accueil"><div class="accueil-titre"><h1>KTEC est arrêté</h1><p class="sous-titre">Vous pouvez fermer cet onglet.</p></div></div>'
        },
      }, ic('sortie', 16), 'Arrêter KTEC'),
    ),
  )
}

// ---------------------------------------------------------------- fichier de connaissances

export function carteFichier(apres = () => {}) {
  const p = etat.partage || {}
  const ligne = (libelle, valeur) => h('div', { style: { display: 'flex', gap: '12px', padding: '6px 0', borderBottom: '1px solid var(--bord)' } }, h('span', { class: 'discret', style: { minWidth: '140px' } }, libelle), h('span', {}, valeur || '—'))
  const sauvegardes = h('div')
  api('/api/ktec/sauvegardes').then((liste) => sauvegardes.replaceChildren(
    liste.length ? h('ul', { style: { margin: '6px 0 0', paddingLeft: '18px' } }, liste.map((s) => h('li', { class: 'discret', style: { fontSize: '13px' } }, `${dateHeureFr(new Date(s.date).toISOString())} — ${tailleFr(s.taille)}`)))
      : h('p', { class: 'discret', style: { fontSize: '13px' } }, 'Aucune pour l’instant (une à chaque prise de la main, une par heure au plus).'))).catch(() => {})
  return h(
    'div',
    { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('livre', 18), 'Fichier de connaissances')),
    h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Le fichier .ktec contient tout ce que les applications savent du site. Placé sur un lecteur réseau, il est partagé par tous les postes : un seul modifie à la fois, les autres suivent ses changements.'),
    ligne('Fichier', h('span', { class: 'mono' }, p.fichier)),
    ligne('Taille', p.taille ? tailleFr(p.taille) : ''),
    ligne('Modifications', p.motDePasse ? 'protégées par un mot de passe (mode administrateur)' : 'libres : la main est prise toute seule'),
    p.autreAdmin ? ligne('En ce moment', `${p.autreAdmin.nom} (${p.autreAdmin.poste}) modifie le fichier`) : null,
    h('div', { class: 'actions', style: { marginTop: '14px' } },
      h('button', { onclick: ouvrirAutreFichier }, ic('dossier', 16), 'Ouvrir un autre fichier'),
      h('button', { class: 'discret', onclick: creerNouveauFichier }, ic('plus', 16), 'Créer un fichier'),
      h('button', { class: 'discret', onclick: () => changerMotDePasse(p.motDePasse).then(apres) }, ic('cadenas', 16), p.motDePasse ? 'Changer le mot de passe' : 'Protéger par un mot de passe'),
    ),
    h('h3', { style: { margin: '16px 0 0', fontSize: '14px' } }, 'Sauvegardes (dossier KTEC-sauvegardes, à côté du fichier)'),
    sauvegardes,
  )
}

async function changerMotDePasse(existe) {
  const champs = []
  if (existe) champs.push({ nom: 'actuel', libelle: 'Mot de passe actuel', type: 'mot-de-passe', obligatoire: true })
  champs.push({ nom: 'nouveau', libelle: existe ? 'Nouveau mot de passe (vide = plus de mot de passe)' : 'Mot de passe administrateur', type: 'mot-de-passe', obligatoire: !existe, aide: '4 caractères au moins. Il sera demandé pour toute modification du fichier, sur tous les postes.' })
  champs.push({ nom: 'confirmation', libelle: 'Encore une fois', type: 'mot-de-passe' })
  const form = formulaire(champs)
  await fenetre({
    titre: existe ? 'Mot de passe administrateur' : 'Protéger le fichier par un mot de passe',
    contenu: form.element,
    boutons: [
      { texte: 'Annuler', classe: 'discret' },
      {
        texte: 'Enregistrer',
        classe: 'principal',
        action: async () => {
          const v = form.lire()
          if ((v.nouveau || '') !== (v.confirmation || '')) throw new Error('Les deux mots de passe sont différents.')
          await api('/api/ktec/mot-de-passe', { methode: 'POST', corps: { actuel: v.actuel, nouveau: v.nouveau } })
          await actualiserEtat()
        },
      },
    ],
  })
}
