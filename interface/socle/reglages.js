// Réglages communs à tout KTEC : connexion à la GMAO (une seule pour toutes les applications) et ce poste.
// Montrés par le portail (bouton « Réglages ») et par l'écran de configuration des applications.

import { h, ic, vider, notifier, formulaire, essayer, confirmer, fenetre, tailleFr, dateHeureFr } from './ui.js'
import { api } from './api.js'
import { etat, actualiserEtat, modeAdmin } from './etat.js'
import { ouvrirAutreFichier, creerNouveauFichier } from './fichier.js'

// ---------------------------------------------------------------- connexion à la GMAO
//
// Rangée chiffrée dans le fichier de connaissances, commune à tous les postes. Deux comptes : lecture (tout le monde,
// automatique) et écriture (FI dans la GMAO, mode administrateur). Les mots de passe ne reviennent jamais à
// l'écran : un champ laissé vide garde celui qui est enregistré.

export function carteMySQL(apres = () => {}) {
  const c = etat.connexion
  const entete = h('div', { class: 'carte-entete' }, h('h2', {}, ic('base', 18), 'Connexion à la GMAO'))
  if (!modeAdmin()) {
    return h('div', { class: 'carte' }, entete,
      c.ouverte ? h('div', { class: 'bandeau info' }, ic('coche'), `Connecté à « ${c.base} » sur ${c.serveur}.`)
        : h('div', { class: 'bandeau' }, ic('cadenas'), c.motDePasse ? `Connexion impossible : ${c.erreur || 'serveur injoignable'}.` : 'La connexion n’est pas encore réglée.'),
      h('p', { class: 'texte-2' }, 'Seul l’administrateur règle la connexion : passez en mode administrateur (en haut de l’écran).'))
  }
  const dejaLecture = c.motDePasse ? 'enregistré — laisser vide pour le garder' : ''
  const dejaEcriture = c.ecriture?.configuree ? 'enregistré — laisser vide pour le garder' : ''
  const form = formulaire(
    [
      { nom: 'serveur', libelle: 'Serveur', obligatoire: true, aide: 'Nom ou adresse IP du serveur MySQL' },
      { nom: 'port', libelle: 'Port', type: 'nombre', defaut: 3306 },
      { nom: 'base', libelle: 'Base de données', obligatoire: true, large: true },
      // Chaque compte sur sa ligne, son mot de passe à côté.
      { nom: 'utilisateur', libelle: 'Compte de lecture', obligatoire: true, aide: 'Utilisé par tout le monde, automatiquement : un compte qui ne peut que lire' },
      { nom: 'motDePasse', libelle: 'Mot de passe', type: 'mot-de-passe', aide: dejaLecture },
      { nom: 'ecritureUtilisateur', libelle: 'Compte d’écriture (facultatif)', aide: 'Seulement pour créer ou modifier des FI depuis AITEC, en mode administrateur' },
      { nom: 'ecritureMotDePasse', libelle: 'Mot de passe', type: 'mot-de-passe', aide: dejaEcriture },
    ],
    { serveur: c.serveur, port: c.port, base: c.base, utilisateur: c.utilisateur, ecritureUtilisateur: c.ecriture?.utilisateur || '' }, // jamais de mot de passe
  )
  const statut = c.ouverte
    ? h('div', { class: 'bandeau info' }, ic('coche'), `Connecté à ${c.infos?.serveur || 'MySQL'}${c.infos?.compteEnEcriture ? ' — attention : le compte de lecture peut modifier la base' : ''}.`)
    : c.motDePasse
      ? h('div', { class: 'bandeau' }, ic('alerte'), `Connexion impossible : ${c.erreur || 'serveur injoignable'}.`)
      : h('div', { class: 'bandeau info' }, ic('base'), 'Renseignez la connexion à la base MySQL de la GMAO. Les mots de passe sont chiffrés dans le fichier de connaissances : personne n’aura à les taper.')
  const bilan = h('div')
  const ligneBilan = (nom, b) => b && h('div', { class: `bandeau ${b.ok ? 'info' : ''}`, style: { marginTop: '8px' } }, ic(b.ok ? 'coche' : 'alerte'),
    b.ok ? `${nom} : connexion réussie${nom === 'Compte de lecture' && b.compteEnEcriture ? ' — attention, ce compte peut modifier la base' : ''}.` : `${nom} : ${b.erreur}`)

  return h(
    'div',
    { class: 'carte' },
    entete,
    statut,
    etat.partage?.motDePasse ? null : h('div', { class: 'bandeau', style: { marginTop: '8px' } }, ic('cadenas'), 'Le fichier n’a pas de mot de passe administrateur : n’importe qui peut changer ces réglages. Protégez-le (carte « Fichier de connaissances »).'),
    form.element,
    bilan,
    h('div', { class: 'actions', style: { marginTop: '14px' } },
      h('button', {
        class: 'principal',
        onclick: async () => {
          const r = await essayer(() => api('/api/ktec/configuration/mysql', { methode: 'POST', corps: form.lire() }), 'Connexion enregistrée dans le fichier de connaissances')
          if (r === undefined) return
          vider(bilan, ligneBilan('Compte de lecture', r.lecture), ligneBilan('Compte d’écriture', r.ecriture))
          await actualiserEtat()
          apres()
        },
      }, 'Enregistrer et essayer'),
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
    ligne('Java et BIRT', etat.java ? 'installés' : 'non installés : lancez l’installation de K.NOVA'),
    ligne('Connaissances', h('span', { class: 'mono' }, etat.fichierKtec)),
    h('label', { class: 'champ', style: { marginTop: '14px' } }, h('span', {}, 'Mettre l’IA en veille après (minutes)'), arret),
    h('div', { class: 'actions', style: { marginTop: '14px' } },
      h('button', { onclick: () => essayer(() => api('/api/ktec/poste', { methode: 'POST', corps: { arretIAMinutes: Number(arret.value) } }), 'Enregistré') }, 'Enregistrer'),
      h('button', {
        class: 'discret',
        onclick: async () => {
          if (!(await confirmer('Arrêter K.NOVA (toutes les applications) ? Relancez-le ensuite avec son raccourci.'))) return
          await api('/api/ktec/quitter', { methode: 'POST' })
          document.body.innerHTML = '<div class="accueil"><div class="accueil-titre"><h1>K.NOVA est arrêté</h1><p class="sous-titre">Vous pouvez fermer cet onglet.</p></div></div>'
        },
      }, ic('sortie', 16), 'Arrêter K.NOVA'),
      modeAdmin() ? h('button', { class: 'discret', title: 'Le journal de K.NOVA en direct (démarrage, connexion, moteur Java, IA, erreurs)', onclick: consoleDebug }, ic('console', 16), 'Console (debug)') : null,
    ),
  )
}

// La console de debug : K.NOVA tourne sans fenêtre ; ce qu'il écrivait dans la console s'affiche ici, en direct.
function consoleDebug() {
  const zone = h('pre', { class: 'console-debug' })
  let suivre = true
  zone.addEventListener('scroll', () => (suivre = zone.scrollTop + zone.clientHeight >= zone.scrollHeight - 30))
  const ajouter = (lignes) => {
    for (const ligne of lignes) zone.append(h('div', { class: /\[(erreur|attention)\]|impossible|échou|erreur/i.test(ligne) ? 'ligne-erreur' : '' }, ligne))
    while (zone.childElementCount > 1500) zone.firstElementChild.remove()
    if (suivre) zone.scrollTop = zone.scrollHeight
  }
  const source = new EventSource('/api/ktec/journal/flux')
  source.addEventListener('lignes', (e) => ajouter(JSON.parse(e.data)))
  source.addEventListener('ligne', (e) => ajouter([JSON.parse(e.data)]))
  source.onerror = () => ajouter([`${new Date().toISOString()}  — connexion à la console perdue (K.NOVA arrêté ?)`])
  fenetre({
    titre: 'Console (debug)',
    large: true,
    contenu: h('div', {}, h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Le journal de K.NOVA, en direct. À copier pour signaler un problème.'), zone),
    boutons: [
      { texte: 'Copier', classe: 'discret', action: () => { navigator.clipboard.writeText(zone.innerText).then(() => notifier('Journal copié')); return false } },
      { texte: 'Ouvrir journal.txt', classe: 'discret', action: () => { window.open('/api/ktec/journal.txt', '_blank', 'noopener'); return false } },
      { texte: 'Fermer', classe: 'principal' },
    ],
  }).finally(() => source.close())
}

// ---------------------------------------------------------------- fichier de connaissances

export function carteFichier(apres = () => {}) {
  const p = etat.partage || {}
  const admin = modeAdmin() // en consultation : le fichier et « Ouvrir un autre fichier », rien d'autre
  const ligne = (libelle, valeur) => h('div', { style: { display: 'flex', gap: '12px', padding: '6px 0', borderBottom: '1px solid var(--bord)' } }, h('span', { class: 'discret', style: { minWidth: '140px' } }, libelle), h('span', {}, valeur || '—'))
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
      admin ? h('button', { class: 'discret', onclick: creerNouveauFichier }, ic('plus', 16), 'Créer un fichier') : null,
      admin ? h('button', { class: 'discret', onclick: () => changerMotDePasse(p.motDePasse).then(apres) }, ic('cadenas', 16), p.motDePasse ? 'Changer le mot de passe' : 'Protéger par un mot de passe') : null,
    ),
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

// La clé du site : la configuration (connexion, adresses, requêtes, réglages) chiffrée dans le fichier de
// connaissances, avec la clé rangée dans le fichier lui-même. Sans mot de passe à taper, sans rien sur les postes.
// L'administrateur peut aussi exporter la configuration en clair (.ktecconf) et la reprendre, réglage par réglage.
export function carteCle(apres = () => {}) {
  const corps = h('div', {}, h('p', { class: 'discret curseur' }, 'Lecture'))
  const telecharger = (r) => {
    const lien = h('a', { href: URL.createObjectURL(new Blob([r.contenu], { type: 'application/json' })), download: r.nom })
    document.body.append(lien); lien.click(); lien.remove()
  }
  const telechargerCle = async () => {
    telecharger(await api('/api/ktec/cle/exporter', { methode: 'POST' }))
    notifier('Clé du site exportée : gardez ce fichier en lieu sûr (clé USB, coffre).')
  }
  const exporterConfiguration = async () => {
    const r = await essayer(() => api('/api/ktec/configuration/exporter', { methode: 'POST' }))
    if (r) telecharger(r)
  }
  const choisirFichier = (accept, suite) => {
    const choix = h('input', { type: 'file', accept, style: { display: 'none' } })
    choix.onchange = () => choix.files[0] && suite(choix.files[0])
    document.body.append(choix); choix.click(); choix.remove()
  }
  const importer = () => choisirFichier('.ktecclef,application/json', async (fichier) => {
    await essayer(() => api('/api/ktec/cle/importer', { methode: 'POST', fichier }), 'Clé du site rangée sur ce poste : le fichier est lisible')
    dessiner(); apres()
  })
  const nouvelle = async () => {
    if (!(await confirmer('Repartir d’une nouvelle clé ? Les réglages chiffrés avec l’ancienne clé restent illisibles : reprenez-les ensuite depuis un fichier de configuration (.ktecconf), et ressaisissez la connexion à la GMAO.', { texte: 'Nouvelle clé', danger: true }))) return
    await essayer(() => api('/api/ktec/cle/nouvelle', { methode: 'POST' }), 'Nouvelle clé du site')
    dessiner(); apres()
  }
  // Reprendre une configuration : on choisit les réglages à reprendre (tout est coché d'office).
  const reprendre = () => choisirFichier('.ktecconf,.txt,application/json', async (fichier) => {
    let contenu
    try {
      contenu = JSON.parse(await fichier.text())
    } catch {
      return notifier('Ce fichier n’est pas lisible.', 'erreur')
    }
    if (contenu?.format !== 'ktec-configuration' || !Array.isArray(contenu.elements)) return notifier('Ce n’est pas une configuration de K.NOVA (.ktecconf).', 'erreur')
    const cases = contenu.elements.map((e) => ({ e, boite: h('input', { type: 'checkbox', checked: true }) }))
    await fenetre({
      titre: 'Reprendre une configuration',
      contenu: h('div', {},
        h('p', { class: 'texte-2', style: { marginTop: 0 } }, `Exportée le ${dateHeureFr(contenu.exportee)}. Chaque réglage coché remplace celui de ce fichier de connaissances.`),
        h('div', { class: 'liste-reprise' }, cases.map(({ e, boite }) => h('label', { class: 'ligne-reprise' }, boite, h('span', { class: 'mono' }, e.cle), h('span', { class: 'discret' }, `${e.table === 'reglages' ? 'AITEC' : 'K.NOVA'} · ${tailleFr(e.valeur.length)}`))))),
      boutons: [
        { texte: 'Annuler' },
        {
          texte: 'Reprendre', classe: 'principal', action: async () => {
            const choisis = cases.filter((x) => x.boite.checked).map((x) => `${x.e.table}/${x.e.cle}`)
            const r = await essayer(() => api('/api/ktec/configuration/reprendre', { methode: 'POST', corps: { elements: contenu.elements, choisis } }))
            if (!r) return false
            notifier(`${r.repris} réglage${r.repris > 1 ? 's' : ''} repris : relancez K.NOVA pour que les applications les relisent.`)
            dessiner(); apres()
            return true
          },
        },
      ],
    })
  })
  // Tout le fichier chiffré : la clé sort du fichier, elle reste sur ce poste ; on l'exporte pour les autres postes.
  const chiffrer = async () => {
    if (!(await confirmer('Chiffrer tout le fichier de connaissances ? Sans la clé du site, il ne s’ouvrira plus. La clé reste sur ce poste et va être exportée : donnez ce fichier (.ktecclef) aux autres postes, une fois chacun.', { texte: 'Chiffrer et exporter la clé' }))) return
    if (await essayer(() => api('/api/ktec/cle/chiffrer', { methode: 'POST' }), 'Tout le fichier est chiffré')) await telechargerCle()
    dessiner(); apres()
  }
  // Couper l'accès des autres postes : une nouvelle clé, le fichier est rechiffré avec elle.
  const couper = async () => {
    if (!(await confirmer('Créer une nouvelle clé ? Le fichier est rechiffré : tous les autres postes ne l’ouvrent plus et effacent leur copie. Seuls les postes à qui vous donnerez la nouvelle clé (exportée maintenant) y auront accès.', { texte: 'Nouvelle clé : couper les autres postes', danger: true }))) return
    if (await essayer(() => api('/api/ktec/cle/nouvelle', { methode: 'POST' }), 'Nouvelle clé du site : les autres postes sont coupés')) await telechargerCle()
    dessiner(); apres()
  }
  async function dessiner() {
    const e = await api('/api/ktec/cle').catch(() => null)
    if (!e) return vider(corps, h('p', { class: 'discret' }, 'État de la clé indisponible.'))
    const admin = modeAdmin()
    // Tout va bien : on n'en parle pas. La carte reste repliée, et n'existe que pour l'administrateur.
    const enOrdre = e.chiffree && e.bonneCle && e.complet
    carte.open = !enOrdre
    carte.hidden = enOrdre && !admin
    vider(corps,
      h('p', { class: 'texte-2', style: { marginTop: 0 } }, !e.chiffree
        ? 'Ce fichier (créé par une version d’avant de K.NOVA) est en clair : chiffrez-le. Les nouveaux fichiers sont chiffrés dès leur création.'
        : !e.bonneCle ? 'Le fichier a été chiffré avec une clé que ce poste n’a pas.'
          : e.complet ? 'Tout le fichier est chiffré : sans la clé du site, il ne s’ouvre pas. La clé est rangée sur ce poste ; chaque autre poste la reçoit une fois (fichier .ktecclef).'
            : 'Ancien format : seule la configuration est chiffrée, et sa clé est rangée dans le fichier lui-même. Chiffrez tout le fichier : la clé en sortira.'),
      e.chiffree && !e.bonneCle ? h('div', { class: 'bandeau' }, ic('cadenas'), admin ? 'Rangez la clé du site (.ktecclef) si vous l’avez ; sinon repartez d’une nouvelle clé, puis reprenez la configuration (.ktecconf) et ressaisissez la connexion.' : 'Sans la clé, les applications ne voient pas leurs réglages : voyez l’administrateur.') : null,
      admin ? h('div', { class: 'actions', style: { marginTop: '10px', flexWrap: 'wrap' } },
        !e.complet && (e.bonneCle || !e.chiffree) ? h('button', { class: 'principal', onclick: chiffrer }, ic('cadenas', 16), 'Chiffrer tout le fichier et exporter la clé') : null,
        e.complet && e.bonneCle ? h('button', { class: 'danger', title: 'Le fichier est rechiffré : les autres postes ne l’ouvrent plus sans la nouvelle clé', onclick: couper }, ic('cle', 16), 'Nouvelle clé : couper les autres postes') : null,
        e.chiffree && !e.bonneCle ? h('button', { onclick: importer }, ic('dossier', 16), 'Ranger la clé (.ktecclef)') : null,
        e.chiffree && !e.bonneCle ? h('button', { class: 'danger', onclick: nouvelle }, ic('cle', 16), 'Nouvelle clé') : null,
        h('button', { onclick: reprendre }, ic('dossier', 16), 'Reprendre une configuration'),
        !e.chiffree || e.bonneCle ? h('button', { class: 'discret', onclick: exporterConfiguration }, ic('telecharger', 16), 'Exporter la configuration') : null,
        e.bonneCle ? h('button', { class: 'discret', onclick: telechargerCle }, ic('telecharger', 16), 'Exporter la clé') : null) : null)
  }
  const carte = h('details', { class: 'carte carte-repliable', hidden: true }, h('summary', { class: 'carte-entete' }, h('h2', {}, ic('cadenas', 18), 'Clé du site')), corps)
  dessiner()
  return carte
}
