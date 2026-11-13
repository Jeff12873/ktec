// La page d'installation de K.NOVA : première installation (applications, dossier, modèle d'IA), puis mises à jour,
// ajout ou désinstallation d'applications. Ouverte par « Installer KTEC » (kit hors ligne ou zip téléchargé),
// ou depuis le portail (Réglages › Installation et mises à jour).

import { h, vider, ic, notifier, confirmer, fenetre, tailleFr, dateHeureFr, nomAppli, NOM_KNOVA } from '/socle/ui.js'
import { api, flux } from '/socle/api.js'
import { explorateur } from '/socle/fichier.js'
import { pointsNouveaux } from '/socle/nouveautes.js'

const racine = document.getElementById('installation')
let etat = null
let catalogue = null

async function charger() {
  vider(racine, h('div', { class: 'portail' }, entete(), h('p', { class: 'discret curseur' }, 'Lecture du catalogue des applications')))
  etat = await api('/api/ktec/installation/etat')
  try {
    catalogue = await api('/api/ktec/installation/catalogue')
  } catch (erreur) {
    catalogue = { applis: [], socle: {}, erreur: erreur.message }
  }
  dessiner()
}

function entete() {
  return h('div', { class: 'portail-entete' },
    h('img', { src: '/icone.svg', alt: '' }),
    h('div', {}, h('h1', {}, nomAppli(NOM_KNOVA)), h('p', { class: 'sous-titre' }, etat?.installe && !etat.modeInstallation ? 'Installation et mises à jour' : 'Installation des applications de l’atelier')),
    h('div', { class: 'espace' }),
    etat ? h('span', { class: 'etiquette accent', title: sourceDetail() }, ic(etat.source === 'github' ? 'nuage' : 'dossier', 15), { kit: 'Kit hors ligne', paquet: 'Mise à jour hors ligne' }[etat.source] || 'En ligne (GitHub)') : null,
    etat && !etat.modeInstallation ? h('a', { class: 'bouton petit discret', href: '/' }, ic('retour', 14), 'Portail') : null,
  )
}

function sourceDetail() {
  if (etat.source === 'paquet') return `Zip de mise à jour fabriqué le ${dateHeureFr(etat.paquet.cree)} : rien n'est téléchargé.`
  if (etat.source !== 'kit') return 'Les paquets sont téléchargés depuis GitHub (dernières versions publiées).'
  return `Kit pour ${etat.kit.systeme}, fabriqué le ${dateHeureFr(etat.kit.cree)} : rien n'est téléchargé.`
}

function dessiner() {
  const contenu = h('div', { class: 'portail' }, entete())
  if (catalogue.erreur) contenu.append(h('div', { class: 'bandeau' }, ic('alerte'), `Catalogue indisponible : ${catalogue.erreur}`))
  // Lancé depuis le zip de mise à jour décompressé : seulement cette mise à jour, hors ligne.
  if (etat.paquet) {
    contenu.append(cartePaquet())
    return vider(racine, contenu)
  }
  if (etat.installe) contenu.append(carteInstallee())
  if (!etat.installe || etat.modeInstallation) contenu.append(formulaireInstallation())
  vider(racine, contenu)
}

const versionLisible = (v) => v || '—'
// Poste trop juste pour le modèle d'IA « moyen » conseillé : les applications qui ont besoin de l'IA s'installent quand
// même, au choix avec une IA légère (prévenu) ou sans IA. Sous 4 Go de mémoire : sans IA seulement.
const faible = (a) => (a.besoins || []).includes('ia') && etat.capaciteIA && !etat.capaciteIA.ia
const RAM_IA_LEGERE = 4
// PREVTEC est une porte d'AITEC (même code, mêmes données) : sa tuile installe AITEC.
const PREVTEC = { id: 'prevtec', porteDe: 'aitec', nom: 'PREVTEC', couleur: '#38bdf8', sousTitre: 'Plan de maintenance', description: 'Réévaluer le plan de maintenance : le Pareto des pannes, un préventif bien orienté, les fiches de niveau 1. Fonctionne aussi sans IA.' }
const avecPortes = (applis) => applis.flatMap((a) => (a.id === 'aitec' ? [a, { ...PREVTEC, besoins: a.besoins, disponible: a.disponible, beta: a.beta }] : [a]))
const idInstalle = (a) => a.porteDe || a.id

// Le choix sur un poste léger : 'legere', 'sans', ou null si l'on renonce.
async function choisirIA() {
  const ram = etat.capaciteIA?.ramGo ?? etat.poste?.ramGo ?? 0
  const legerePossible = ram >= RAM_IA_LEGERE
  const legere = h('input', { type: 'radio', name: 'choix-ia', value: 'legere', checked: legerePossible, disabled: !legerePossible })
  const sans = h('input', { type: 'radio', name: 'choix-ia', value: 'sans', checked: !legerePossible })
  const compris = h('input', { type: 'checkbox', style: { width: 'auto' } })
  return fenetre({
    titre: 'Ce poste est léger',
    contenu: h('div', { class: 'grille', style: { gap: '12px' } },
      h('p', { class: 'texte-2', style: { margin: 0 } }, etat.capaciteIA?.raison || ''),
      h('label', { class: `choix-ia${legerePossible ? '' : ' grise'}` }, legere, h('div', {},
        h('b', {}, 'IA légère'),
        h('div', { class: 'discret' }, legerePossible ? `Le modèle ${ram >= 8 ? '« petit »' : '« très petit »'} s’installe. L’IA marchera, mais plus lentement et avec des réponses moins justes : relisez ce qu’elle propose.` : `Pas possible : ce poste n’a que ${ram} Go de mémoire.`),
        legerePossible ? h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' } }, compris, 'J’ai compris') : null)),
      h('label', { class: 'choix-ia' }, sans, h('div', {},
        h('b', {}, 'Sans IA'),
        h('div', { class: 'discret' }, 'Rien de plus à télécharger. PREVTEC et le niveau 1 fonctionnent ; l’assistant de dépannage et les textes rédigés par l’IA ne seront pas disponibles.')))),
    boutons: [{ texte: 'Annuler', classe: 'discret', valeur: null }, { texte: 'Installer', classe: 'principal', action: () => {
      if (legere.checked && !compris.checked) { notifier('Cochez « J’ai compris » pour l’IA légère.', 'erreur'); return false }
      return legere.checked ? 'legere' : 'sans'
    } }],
  })
}
// « 0.4.2 » (copié du kit) et « 0.4.2.7 » (numéro de publication sur GitHub) sont la même version.
const plusRecente = (dispo, installee) => dispo && installee && dispo !== installee && !dispo.startsWith(installee + '.') && !installee.startsWith(dispo + '.')

// ---------------------------------------------------------------- installation existante

function carteInstallee() {
  const inst = etat.installe
  const lignes = avecPortes(catalogue.applis).map((a) => {
    const installee = inst.applis?.[idInstalle(a)]
    const actions = installee
      ? a.porteDe ? [h('span', { class: 'discret' }, 'avec AITEC')] : [
          plusRecente(a.disponible, installee) ? h('button', { class: 'petit principal', onclick: () => lancerMiseAJour([a.id]) }, ic('telecharger', 14), `Mettre à jour (${versionLisible(a.disponible)})`) : h('span', { class: 'discret' }, 'à jour'),
          h('button', { class: 'petit discret danger', onclick: () => desinstaller(a) }, ic('poubelle', 14), 'Désinstaller'),
        ]
      : [h('button', { class: 'petit', title: faible(a) ? etat.capaciteIA.raison : '', onclick: () => installerSelection([...Object.keys(inst.applis || {}), idInstalle(a)], inst.dossier) }, ic('plus', 14), faible(a) ? 'Ajouter (poste léger)' : 'Ajouter')]
    // Les nouveautés de la version disponible, en quelques mots, sous le nom de l'application.
    const points = installee && !a.porteDe && plusRecente(a.disponible, installee) ? pointsNouveaux(a.nouveautes, installee) : []
    return h('tr', {},
      h('td', {}, h('strong', {}, nomAppli(a.nom, a.couleur)), h('div', { class: 'discret', style: { fontSize: '12px' } }, a.sousTitre),
        points.length ? h('ul', { class: 'nouveautes-ligne' }, points.map((p) => h('li', {}, p))) : null),
      h('td', { class: 'mono' }, installee ? versionLisible(installee) : '—'),
      h('td', { class: 'mono' }, versionLisible(a.disponible)),
      h('td', {}, h('div', { class: 'actions' }, actions)))
  })
  const socleAJour = !plusRecente(catalogue.socle?.version, inst.ktec)
  return h('div', { class: 'carte', style: { marginBottom: '20px' } },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('coche', 18), 'K.NOVA est installé'),
      h('div', { class: 'actions' },
        h('button', { class: 'principal', onclick: () => lancerMiseAJour(null) }, ic('rafraichir', 16), 'Tout mettre à jour'),
        h('button', { title: 'Poste sans accès à GitHub : choisir le zip de mise à jour (fabriqué ailleurs, apporté sur clé USB)', onclick: choisirFichierMaj }, ic('dossier', 16), 'Depuis un fichier…'),
        etat.modeInstallation ? h('button', { onclick: () => ouvrirKtec(inst.dossier) }, ic('lecture', 16), 'Ouvrir K.NOVA') : null)),
    h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Dans ', h('span', { class: 'mono' }, inst.dossier), `. Programme K.NOVA ${versionLisible(inst.ktec)}`, socleAJour ? ' (à jour).' : ` — version ${versionLisible(catalogue.socle.version)} disponible.`),
    socleAJour ? null : (() => { const p = pointsNouveaux(catalogue.socle?.nouveautes, inst.ktec); return p.length ? h('ul', { class: 'nouveautes-ligne' }, p.map((x) => h('li', {}, x))) : null })(),
    h('table', { class: 'tableau' }, h('thead', {}, h('tr', {}, h('th', {}, 'Application'), h('th', {}, 'Installée'), h('th', {}, 'Disponible'), h('th', {}, ''))), h('tbody', {}, lignes)),
    h('p', { class: 'discret', style: { fontSize: '13px', marginTop: '12px' } }, `Composants communs : ${Object.entries(inst.composants || {}).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}. Rien n'est installé deux fois.`),
    h('div', { class: 'actions', style: { marginTop: '10px' } }, h('button', { class: 'petit discret danger', onclick: toutDesinstaller }, ic('poubelle', 14), 'Désinstaller K.NOVA')),
  )
}

// ---------------------------------------------------------------- zip de mise à jour décompressé

function cartePaquet() {
  const inst = etat.installe
  const p = etat.paquet
  if (!inst) {
    return h('div', { class: 'bandeau' }, ic('alerte'), 'Ce dossier est une mise à jour, mais K.NOVA n’est pas installé sur ce poste : installez-le d’abord avec le kit hors ligne complet.')
  }
  const change = (installee, fournie) => (!plusRecente(fournie, installee) ? h('span', { class: 'discret' }, 'déjà à jour') : h('strong', {}, `${versionLisible(installee)} → ${fournie}`))
  const lignes = [
    h('tr', {}, h('td', {}, h('strong', {}, 'Programme K.NOVA')), h('td', {}, change(inst.ktec, p.ktec))),
    ...catalogue.applis.map((a) => h('tr', {}, h('td', {}, h('strong', {}, nomAppli(a.nom, a.couleur))),
      h('td', {}, inst.applis?.[a.id] ? change(inst.applis[a.id], a.disponible) : h('span', { class: 'discret' }, 'pas installée ici : ignorée')))),
  ]
  return h('div', { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('telecharger', 18), 'Mise à jour hors ligne'),
      h('div', { class: 'actions' },
        h('button', { class: 'principal', onclick: () => lancerMiseAJour(null, '/api/ktec/installation/paquet/appliquer') }, ic('rafraichir', 16), 'Mettre à jour'),
        h('button', { onclick: () => ouvrirKtec(inst.dossier) }, ic('lecture', 16), 'Ouvrir K.NOVA sans mettre à jour'))),
    h('p', { class: 'texte-2', style: { marginTop: 0 } }, `Mise à jour fabriquée le ${dateHeureFr(p.cree)}, pour K.NOVA installé dans `, h('span', { class: 'mono' }, inst.dossier),
      '. Rien n’est téléchargé. K.NOVA, s’il est ouvert, est arrêté le temps de la mise à jour. Vos données (fichier de connaissances, rapports, réglages) ne sont pas touchées.'),
    h('table', { class: 'tableau' }, h('tbody', {}, lignes)))
}

// ---------------------------------------------------------------- première installation

function formulaireInstallation() {
  // Toutes cochées au départ ; réinstallation depuis un kit : celles déjà installées.
  const dejaLa = Object.keys(etat.installe?.applis || {})
  const choix = new Set(dejaLa.length ? dejaLa : catalogue.applis.map((a) => a.id))
  const dossier = h('input', { type: 'text', value: etat.installe?.dossier || etat.dossierParDefaut })
  const modele = h('select', {},
    h('option', { value: 'auto' }, 'Automatique : le plus adapté à ce poste (conseillé)'),
    etat.modeles.map((m) => h('option', { value: m.code }, `${m.nom} — ${String(m.tailleGo).replace('.', ',')} Go — ${m.pour}`)))
  const raccourcis = h('input', { type: 'checkbox', checked: true, style: { width: 'auto' } })
  const zoneIA = h('div')
  const tuiles = h('div', { class: 'tuiles-applis' })
  const besoins = () => new Set(catalogue.applis.filter((a) => choix.has(a.id)).flatMap((a) => a.besoins || []))
  const BESOINS = { ia: 'IA', java: 'Java', birt: 'BIRT' }

  function dessinerTuiles() {
    vider(tuiles, avecPortes(catalogue.applis).map((a) => h('label', { class: `tuile-appli ${choix.has(idInstalle(a)) ? '' : 'absente'}${faible(a) ? ' poste-leger' : ''}`, style: { cursor: 'pointer', ...(a.couleur ? { '--accent': a.couleur } : {}) }, title: faible(a) ? etat.capaciteIA.raison : null },
      h('div', { class: 'tete' },
        h('input', { type: 'checkbox', checked: choix.has(idInstalle(a)), style: { width: 'auto' }, onchange: (e) => { e.target.checked ? choix.add(idInstalle(a)) : choix.delete(idInstalle(a)); dessinerTuiles() } }),
        h('div', {}, h('strong', {}, nomAppli(a.nom)), h('span', {}, a.sousTitre)),
        a.beta ? h('span', { class: 'pastille-ia beta' }, 'Bêta') : null,
        (a.besoins || []).includes('ia') ? h('span', { class: 'pastille-ia' }, 'IA') : h('span', { class: 'pastille-ia sans' }, 'NoIA')),
      h('p', {}, a.description),
      faible(a) ? h('p', { class: 'raison-bloquee' }, ic('alerte', 14), ' Poste léger : IA légère ou sans IA, au choix à l’installation.') : null,
      h('span', { class: 'version' }, a.porteDe ? 'S’installe avec AITEC : cocher l’une coche l’autre' : `Version ${versionLisible(a.disponible)} · demande : ${(a.besoins || []).map((b) => BESOINS[b] || b).join(', ')}`))))
    zoneIA.hidden = !besoins().has('ia')
  }
  dessinerTuiles()

  vider(zoneIA,
    h('h2', { style: { margin: '24px 0 10px' } }, '3. Le modèle d’IA'),
    h('div', { class: 'carte' },
      h('label', { class: 'champ' }, h('span', {}, 'Modèle'), modele),
      h('p', { class: 'discret', style: { fontSize: '13px' } }, `Ce poste : ${etat.poste.systeme}, ${etat.poste.processeur} (${etat.poste.coeurs} cœurs), ${etat.poste.ramGo} Go de mémoire. ${etat.capaciteIA?.carte ? `Carte graphique : ${etat.capaciteIA.carte}.` : 'Pas de carte graphique reconnue.'} Le choix automatique en tient compte. Les modèles sont rangés dans un dossier commun du poste (`, h('span', { class: 'mono' }, etat.dossierModeles), ') et ne sont jamais téléchargés deux fois.'),
      etat.source === 'kit' ? h('p', { class: 'discret', style: { fontSize: '13px' } }, 'Version hors ligne : seuls les modèles du kit sont proposés.') : null))

  const parcourir = () => {
    const ex = explorateur('dossier', () => {})
    fenetre({
      titre: 'Dossier d’installation',
      large: true,
      contenu: h('div', {}, h('p', { class: 'texte-2' }, 'Choisissez un dossier de votre profil (les programmes ne peuvent pas tourner ailleurs sur les postes verrouillés). K.NOVA y sera installé dans un sous-dossier « KTEC ».'), ex.element),
      boutons: [{ texte: 'Annuler', classe: 'discret' }, { texte: 'Choisir', classe: 'principal', action: () => { if (ex.dossier()) dossier.value = ex.dossier().replace(/[\\/]$/, '') + (ex.dossier().includes('\\') ? '\\KTEC' : '/KTEC') } }],
    })
  }

  return h('div', {},
    etat.installe ? h('h2', { style: { margin: '10px 0' } }, 'Réinstaller depuis ce ' + (etat.source === 'kit' ? 'kit' : 'paquet')) : null,
    h('h2', { style: { margin: '10px 0' } }, '1. Les applications'),
    catalogue.applis.some(faible) ? h('div', { class: 'bandeau', style: { marginBottom: '12px' } }, ic('alerte'), `${etat.capaciteIA.raison} ${catalogue.applis.filter(faible).map((a) => a.nom).join(' et ')} s’installe${catalogue.applis.filter(faible).length > 1 ? 'nt' : ''} quand même : avec une IA légère, ou sans IA (PREVTEC et le niveau 1 fonctionnent sans).`) : null,
    tuiles,
    h('h2', { style: { margin: '24px 0 10px' } }, '2. Le dossier d’installation'),
    h('div', { class: 'carte' },
      h('div', { class: 'actions' }, dossier, h('button', { onclick: parcourir }, ic('dossier', 16), 'Parcourir')),
      h('p', { class: 'discret', style: { fontSize: '13px' } }, `Dans votre profil, sans droits d’administrateur. ${etat.espaceLibreGo !== null ? `Espace libre : ${etat.espaceLibreGo} Go.` : ''} Vos données (fichier .ktec, Documents/KTEC) ne sont jamais dans ce dossier.`),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' } }, raccourcis, 'Raccourcis « K.NOVA » sur le Bureau et dans le menu')),
    zoneIA,
    h('div', { class: 'actions', style: { marginTop: '24px' } },
      h('button', { class: 'principal', onclick: () => installerSelection([...choix], dossier.value.trim(), modele.value, raccourcis.checked) }, ic('telecharger', 16), 'Installer')),
  )
}

// ---------------------------------------------------------------- en cours

// Pendant les téléchargements : des phrases qui tournent, et une fois (une seule) le découpage des concombres.
const CITATIONS = [
  'Vos données restent chez vous : rien ne quitte le poste, même pas pour l’IA.',
  'Une panne bien décrite est déjà à moitié réparée.',
  'L’IA de K.NOVA tourne sur ce PC : pas de nuage, pas de fuite.',
  'Le meilleur dépannage est celui qu’on n’a pas eu à faire.',
  'Une pièce bien rangée se retrouve en dix secondes, pas en dix minutes.',
  'Un rapport clair vaut mieux que dix tableaux que personne ne lit.',
  'La connexion à la GMAO reste en lecture : K.NOVA regarde, il ne touche pas sans vous.',
  'Chaque fichier téléchargé est vérifié par son empreinte avant d’être installé.',
  'La maintenance, c’est l’art de rendre les problèmes ennuyeux.',
  'Pas de droits d’administrateur, pas de service caché : tout est dans votre profil.',
  'Un mot de passe chiffré dans le fichier, jamais en clair, jamais demandé à l’utilisateur.',
  'Patience : un modèle d’IA, c’est quelques milliards de paramètres à ranger.',
]

function citationsTournantes() {
  const zone = h('p', { class: 'citation-installation' })
  let n = Math.floor(Math.random() * CITATIONS.length)
  const tourner = () => {
    if (!zone.isConnected) return clearInterval(minuterie)
    zone.classList.remove('visible')
    setTimeout(() => { zone.textContent = CITATIONS[n++ % CITATIONS.length]; zone.classList.add('visible') }, 300)
  }
  const minuterie = setInterval(tourner, 9000)
  setTimeout(tourner, 0)
  return zone
}

// Le concombre arrive, le couteau le découpe en rondelles qui s'envolent : une seule fois par installation.
function decoupageDesConcombres(zone) {
  const scene = h('div', { class: 'decoupe-concombres', 'aria-hidden': 'true' },
    h('span', { class: 'concombre-entier' }, '🥒'),
    h('span', { class: 'couteau' }, '🔪'),
    ...Array.from({ length: 7 }, (_, i) => h('span', { class: 'rondelle', style: { '--i': String(i), '--x': `${(i - 3) * 38}px`, '--r': `${(i % 2 ? 1 : -1) * (120 + i * 40)}deg` } })))
  zone.append(scene)
  setTimeout(() => scene.remove(), 4200)
}

function vueSuivi(titre) {
  const etapes = h('ol', { class: 'chemin-tables', style: { marginTop: 0 } })
  const barre = h('div', { class: 'progression', hidden: true }, h('div', { style: { width: '0%' } }))
  const detail = h('div', { class: 'texte-2', style: { fontSize: '13px', minHeight: '20px' } })
  const journal = h('div', { class: 'discret mono', style: { fontSize: '12px', maxHeight: '220px', overflow: 'auto', marginTop: '10px' } })
  const fin = h('div')
  const titreCarte = h('h2', {}, ic('rafraichir', 18), titre)
  const citation = citationsTournantes()
  const scene = h('div', { class: 'scene-concombres' })
  let decoupe = false
  vider(racine, h('div', { class: 'portail' }, entete(), h('div', { class: 'carte' }, h('div', { class: 'carte-entete' }, titreCarte), etapes, barre, detail, scene, citation, journal, fin)))
  return {
    surEvenement(type, d) {
      if (type === 'etape') {
        etapes.querySelectorAll('li').forEach((li) => (li.style.opacity = 0.6))
        etapes.append(h('li', {}, d.titre))
        barre.hidden = true
        detail.textContent = ''
      } else if (type === 'progression') {
        barre.hidden = false
        barre.firstChild.style.width = `${d.total ? Math.min(100, (d.recu / d.total) * 100) : 0}%`
        // À mi-chemin du premier gros téléchargement : les concombres, une fois.
        if (!decoupe && d.total > 20e6 && d.recu / d.total > 0.5) { decoupe = true; decoupageDesConcombres(scene) }
        detail.textContent = `${d.nom} : ${tailleFr(d.recu)}${d.total ? ` sur ${tailleFr(d.total)}` : ''}`
      } else if (type === 'message') {
        journal.append(h('div', {}, '✓ ', d))
        journal.scrollTop = journal.scrollHeight
      }
    },
    fin,
    barre,
    detail,
    terminer(texte) {
      citation.remove()
      vider(titreCarte, ic('coche', 18), texte)
      etapes.querySelectorAll('li').forEach((li) => (li.style.opacity = 0.6))
    },
  }
}

async function installerSelection(applis, dossier, modele = 'auto', raccourcis = true) {
  if (!applis.length) return notifier('Choisissez au moins une application.', 'erreur')
  let ia = 'auto'
  if (catalogue.applis.some((a) => applis.includes(a.id) && faible(a))) {
    ia = await choisirIA()
    if (!ia) return
  }
  const suivi = vueSuivi('Installation en cours')
  let resultat = null
  try {
    await flux('/api/ktec/installation/installer', { dossier, applis, modele, raccourcis, ia }, (type, d) => {
      suivi.surEvenement(type, d)
      if (type === 'fin') resultat = d
      if (type === 'erreur') throw new Error(d.message)
    })
  } catch (erreur) {
    vider(suivi.fin, h('div', { class: 'bandeau', style: { marginTop: '14px' } }, ic('alerte'), `L’installation n’est pas terminée : ${erreur.message}. Relancez-la : ce qui est déjà prêt n’est pas refait.`),
      h('div', { class: 'actions' }, h('button', { onclick: charger }, 'Revenir')))
    return
  }
  suivi.barre.hidden = true
  suivi.detail.textContent = ''
  suivi.terminer('Installation terminée')
  vider(suivi.fin,
    h('div', { class: 'bandeau info', style: { marginTop: '14px' } }, ic('coche'), `K.NOVA est installé dans ${resultat.dossier}.`),
    h('div', { class: 'actions' },
      etat.modeInstallation ? h('button', { class: 'principal', onclick: () => ouvrirKtec(resultat.dossier) }, ic('lecture', 16), 'Ouvrir K.NOVA') : h('button', { class: 'principal', onclick: () => attendreRedemarrage() }, 'Terminer'),
      h('button', { class: 'discret', onclick: charger }, 'Revenir')))
}

async function lancerMiseAJour(applis, adresse = '/api/ktec/installation/mettre-a-jour') {
  const suivi = vueSuivi('Mise à jour')
  let resultat = null
  try {
    await flux(adresse, { applis }, (type, d) => {
      suivi.surEvenement(type, d)
      if (type === 'fin') resultat = d
      if (type === 'erreur') throw new Error(d.message)
    })
  } catch (erreur) {
    vider(suivi.fin, h('div', { class: 'bandeau', style: { marginTop: '14px' } }, ic('alerte'), erreur.message), h('button', { onclick: charger }, 'Revenir'))
    return
  }
  suivi.terminer('Mise à jour terminée')
  // Depuis le zip décompressé : K.NOVA installé est arrêté, on propose de l'ouvrir.
  if (etat.modeInstallation && etat.installe) {
    vider(suivi.fin, h('div', { class: 'bandeau info', style: { marginTop: '14px' } }, ic('coche'), `Mise à jour installée dans ${etat.installe.dossier}.`),
      h('div', { class: 'actions' }, h('button', { class: 'principal', onclick: () => ouvrirKtec(etat.installe.dossier) }, ic('lecture', 16), 'Ouvrir K.NOVA')))
    return
  }
  vider(suivi.fin, h('div', { class: 'bandeau info', style: { marginTop: '14px' } }, ic('coche'), resultat.redemarrer ? 'Mise à jour installée : K.NOVA redémarre…' : 'Tout est à jour.'))
  if (resultat.redemarrer) attendreRedemarrage()
  else setTimeout(charger, 1500)
}

// Mise à jour par fichier : le zip est lu, on montre ce qui va changer, puis on l'applique.
function choisirFichierMaj() {
  const choix = h('input', { type: 'file', accept: '.zip', style: { display: 'none' } })
  choix.addEventListener('change', async () => {
    const fichier = choix.files[0]
    choix.remove()
    if (!fichier) return
    notifier('Lecture de la mise à jour…')
    let contenu
    try {
      contenu = await api('/api/ktec/installation/fichier', { methode: 'POST', fichier })
    } catch (erreur) {
      return notifier(erreur.message, 'erreur')
    }
    const change = (installee, fournie) => (installee && installee === fournie ? h('span', { class: 'discret' }, 'déjà à jour') : h('strong', {}, `${versionLisible(installee)} → ${fournie}`))
    const lignes = [
      h('tr', {}, h('td', {}, 'Programme K.NOVA'), h('td', {}, change(contenu.socle.installee, contenu.socle.fournie))),
      ...contenu.applis.map((a) => h('tr', {}, h('td', {}, a.id), h('td', {}, a.installee ? change(a.installee, a.fournie) : h('span', { class: 'discret' }, 'pas installée ici : ignorée')))),
    ]
    const ok = await fenetre({
      titre: 'Mise à jour depuis un fichier',
      contenu: h('div', {},
        h('p', { class: 'texte-2' }, `Fichier fabriqué le ${dateHeureFr(contenu.cree)}. Vos données (fichier de connaissances, rapports, réglages) ne sont pas touchées.`),
        h('table', { class: 'tableau' }, h('tbody', {}, lignes))),
      boutons: [{ texte: 'Annuler', classe: 'discret', valeur: false }, { texte: 'Mettre à jour', classe: 'principal', valeur: true }],
    })
    if (ok) lancerMiseAJour(null, '/api/ktec/installation/fichier/appliquer')
  })
  document.body.append(choix)
  choix.click()
}

async function desinstaller(a) {
  if (!(await confirmer(`Désinstaller ${a.nom} ? Ses données dans le fichier de connaissances sont gardées : la réinstaller les retrouve.`, { texte: 'Désinstaller', danger: true }))) return
  const r = await api('/api/ktec/installation/desinstaller', { methode: 'POST', corps: { id: a.id } })
  notifier(`${a.nom} est désinstallée.`)
  if (r.redemarrage) attendreRedemarrage()
  else charger()
}

async function toutDesinstaller() {
  const modeles = h('input', { type: 'checkbox', style: { width: 'auto' } })
  const ok = await fenetre({
    titre: 'Désinstaller K.NOVA',
    contenu: h('div', {},
      h('p', { class: 'texte-2' }, `Le dossier ${etat.installe.dossier} et les raccourcis seront supprimés. Le fichier de connaissances (.ktec), vos rapports (Documents/KTEC) et vos réglages ailleurs sont gardés.`),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, modeles, `Supprimer aussi les modèles d’IA (${etat.dossierModeles}) — ils peuvent servir à un autre agent du poste`)),
    boutons: [{ texte: 'Annuler', classe: 'discret', valeur: false }, { texte: 'Désinstaller', classe: 'danger', valeur: true }],
  })
  if (!ok) return
  const r = await api('/api/ktec/installation/tout-desinstaller', { methode: 'POST', corps: { modeles: modeles.checked } })
  vider(racine, h('div', { class: 'portail' }, h('h1', {}, 'K.NOVA est désinstallé'), h('p', { class: 'texte-2' }, r.arret ? 'Vous pouvez fermer cet onglet.' : 'Vos données sont gardées.')))
}

async function ouvrirKtec(dossier) {
  await api('/api/ktec/installation/lancer', { methode: 'POST', corps: { dossier } })
  vider(racine, h('div', { class: 'portail' }, entete(), h('div', { class: 'carte' }, h('h2', {}, 'K.NOVA démarre'), h('p', { class: 'texte-2' }, 'Le portail s’ouvre dans un nouvel onglet. Vous pouvez fermer celui-ci.'))))
}

// KTEC redémarre (code 42) : on attend qu'il réponde, puis on recharge la page.
function attendreRedemarrage() {
  const essai = async () => {
    try {
      await api('/api/ktec/installation/etat')
      location.reload()
    } catch {
      setTimeout(essai, 1500)
    }
  }
  setTimeout(essai, 2500)
}

// Au chargement de la page (à la fin : toutes les fonctions ci-dessus sont alors prêtes).
await charger()
// Depuis le bandeau « Mise à jour disponible » du portail : tout est mis à jour sans autre clic.
if (new URLSearchParams(location.search).has('tout') && etat?.installe && !etat.modeInstallation) {
  history.replaceState(null, '', '/installation/')
  lancerMiseAJour(null)
}

// Signe de vie de la page, chaque minute : lancé par le raccourci du kit (sans console), le programme
// d'installation s'arrête seul quand plus aucune page n'est ouverte.
setInterval(() => api('/api/ktec/etat').catch(() => {}), 60_000)
