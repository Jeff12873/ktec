// La page d'installation de KTEC : première installation (applications, dossier, modèle d'IA), puis mises à jour,
// ajout ou désinstallation d'applications. Ouverte par « Installer KTEC » (kit hors ligne ou zip téléchargé),
// ou depuis le portail (Réglages › Installation et mises à jour).

import { h, vider, ic, notifier, confirmer, fenetre, tailleFr, dateHeureFr } from '/socle/ui.js'
import { api, flux } from '/socle/api.js'
import { explorateur } from '/socle/fichier.js'

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
    h('div', {}, h('h1', {}, 'KTEC'), h('p', { class: 'sous-titre' }, etat?.installe && !etat.modeInstallation ? 'Installation et mises à jour' : 'Installation des applications de l’atelier')),
    h('div', { class: 'espace' }),
    etat ? h('span', { class: 'etiquette accent', title: sourceDetail() }, ic(etat.source === 'kit' ? 'dossier' : 'nuage', 15), etat.source === 'kit' ? 'Kit hors ligne' : 'En ligne (GitHub)') : null,
    etat && !etat.modeInstallation ? h('a', { class: 'bouton petit discret', href: '/' }, ic('retour', 14), 'Portail') : null,
  )
}

function sourceDetail() {
  if (etat.source !== 'kit') return 'Les paquets sont téléchargés depuis GitHub (dernières versions publiées).'
  return `Kit pour ${etat.kit.systeme}, fabriqué le ${dateHeureFr(etat.kit.cree)} : rien n'est téléchargé.`
}

function dessiner() {
  const contenu = h('div', { class: 'portail' }, entete())
  if (catalogue.erreur) contenu.append(h('div', { class: 'bandeau' }, ic('alerte'), `Catalogue indisponible : ${catalogue.erreur}`))
  if (etat.installe) contenu.append(carteInstallee())
  if (!etat.installe || etat.modeInstallation) contenu.append(formulaireInstallation())
  vider(racine, contenu)
}

const versionLisible = (v) => v || '—'
// « 0.4.2 » (copié du kit) et « 0.4.2.7 » (numéro de publication sur GitHub) sont la même version.
const plusRecente = (dispo, installee) => dispo && installee && dispo !== installee && !dispo.startsWith(installee + '.') && !installee.startsWith(dispo + '.')

// ---------------------------------------------------------------- installation existante

function carteInstallee() {
  const inst = etat.installe
  const lignes = catalogue.applis.map((a) => {
    const installee = inst.applis?.[a.id]
    const actions = installee
      ? [
          plusRecente(a.disponible, installee) ? h('button', { class: 'petit principal', onclick: () => lancerMiseAJour([a.id]) }, ic('telecharger', 14), `Mettre à jour (${versionLisible(a.disponible)})`) : h('span', { class: 'discret' }, 'à jour'),
          h('button', { class: 'petit discret danger', onclick: () => desinstaller(a) }, ic('poubelle', 14), 'Désinstaller'),
        ]
      : [h('button', { class: 'petit', onclick: () => installerSelection([...Object.keys(inst.applis || {}), a.id], inst.dossier) }, ic('plus', 14), 'Ajouter')]
    return h('tr', {},
      h('td', {}, h('strong', {}, a.nom), h('div', { class: 'discret', style: { fontSize: '12px' } }, a.sousTitre)),
      h('td', { class: 'mono' }, installee ? versionLisible(installee) : '—'),
      h('td', { class: 'mono' }, versionLisible(a.disponible)),
      h('td', {}, h('div', { class: 'actions' }, actions)))
  })
  const socleAJour = !plusRecente(catalogue.socle?.version, inst.ktec)
  return h('div', { class: 'carte', style: { marginBottom: '20px' } },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('coche', 18), 'KTEC est installé'),
      h('div', { class: 'actions' },
        h('button', { class: 'principal', onclick: () => lancerMiseAJour(null) }, ic('rafraichir', 16), 'Tout mettre à jour'),
        h('button', { title: 'Poste sans accès à GitHub : choisir le zip de mise à jour (fabriqué ailleurs, apporté sur clé USB)', onclick: choisirFichierMaj }, ic('dossier', 16), 'Depuis un fichier…'),
        etat.modeInstallation ? h('button', { onclick: () => ouvrirKtec(inst.dossier) }, ic('lecture', 16), 'Ouvrir KTEC') : null)),
    h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Dans ', h('span', { class: 'mono' }, inst.dossier), `. Programme KTEC ${versionLisible(inst.ktec)}`, socleAJour ? ' (à jour).' : ` — version ${versionLisible(catalogue.socle.version)} disponible.`),
    h('table', { class: 'tableau' }, h('thead', {}, h('tr', {}, h('th', {}, 'Application'), h('th', {}, 'Installée'), h('th', {}, 'Disponible'), h('th', {}, ''))), h('tbody', {}, lignes)),
    h('p', { class: 'discret', style: { fontSize: '13px', marginTop: '12px' } }, `Composants communs : ${Object.entries(inst.composants || {}).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}. Rien n'est installé deux fois.`),
    h('div', { class: 'actions', style: { marginTop: '10px' } }, h('button', { class: 'petit discret danger', onclick: toutDesinstaller }, ic('poubelle', 14), 'Désinstaller KTEC')),
  )
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
    vider(tuiles, catalogue.applis.map((a) => h('label', { class: `tuile-appli ${choix.has(a.id) ? '' : 'absente'}`, style: { cursor: 'pointer' } },
      h('div', { class: 'tete' },
        h('input', { type: 'checkbox', checked: choix.has(a.id), style: { width: 'auto' }, onchange: (e) => { e.target.checked ? choix.add(a.id) : choix.delete(a.id); dessinerTuiles() } }),
        h('div', {}, h('strong', {}, a.nom), h('span', {}, a.sousTitre))),
      h('p', {}, a.description),
      h('span', { class: 'version' }, `Version ${versionLisible(a.disponible)} · demande : ${(a.besoins || []).map((b) => BESOINS[b] || b).join(', ')}`))))
    zoneIA.hidden = !besoins().has('ia')
  }
  dessinerTuiles()

  vider(zoneIA,
    h('h2', { style: { margin: '24px 0 10px' } }, '3. Le modèle d’IA'),
    h('div', { class: 'carte' },
      h('label', { class: 'champ' }, h('span', {}, 'Modèle'), modele),
      h('p', { class: 'discret', style: { fontSize: '13px' } }, `Ce poste : ${etat.poste.systeme}, ${etat.poste.processeur} (${etat.poste.coeurs} cœurs), ${etat.poste.ramGo} Go de mémoire. La carte graphique est détectée pendant l’installation : le choix automatique en tient compte. Les modèles sont rangés dans un dossier commun du poste (`, h('span', { class: 'mono' }, etat.dossierModeles), ') et ne sont jamais téléchargés deux fois.'),
      etat.source === 'kit' ? h('p', { class: 'discret', style: { fontSize: '13px' } }, 'Version hors ligne : seuls les modèles du kit sont proposés.') : null))

  const parcourir = () => {
    const ex = explorateur('dossier', () => {})
    fenetre({
      titre: 'Dossier d’installation',
      large: true,
      contenu: h('div', {}, h('p', { class: 'texte-2' }, 'Choisissez un dossier de votre profil (les programmes ne peuvent pas tourner ailleurs sur les postes verrouillés). KTEC y sera installé dans un sous-dossier « KTEC ».'), ex.element),
      boutons: [{ texte: 'Annuler', classe: 'discret' }, { texte: 'Choisir', classe: 'principal', action: () => { if (ex.dossier()) dossier.value = ex.dossier().replace(/[\\/]$/, '') + (ex.dossier().includes('\\') ? '\\KTEC' : '/KTEC') } }],
    })
  }

  return h('div', {},
    etat.installe ? h('h2', { style: { margin: '10px 0' } }, 'Réinstaller depuis ce ' + (etat.source === 'kit' ? 'kit' : 'paquet')) : null,
    h('h2', { style: { margin: '10px 0' } }, '1. Les applications'),
    tuiles,
    h('h2', { style: { margin: '24px 0 10px' } }, '2. Le dossier d’installation'),
    h('div', { class: 'carte' },
      h('div', { class: 'actions' }, dossier, h('button', { onclick: parcourir }, ic('dossier', 16), 'Parcourir')),
      h('p', { class: 'discret', style: { fontSize: '13px' } }, `Dans votre profil, sans droits d’administrateur. ${etat.espaceLibreGo !== null ? `Espace libre : ${etat.espaceLibreGo} Go.` : ''} Vos données (fichier .ktec, Documents/KTEC) ne sont jamais dans ce dossier.`),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' } }, raccourcis, 'Raccourcis « KTEC » sur le Bureau et dans le menu')),
    zoneIA,
    h('div', { class: 'actions', style: { marginTop: '24px' } },
      h('button', { class: 'principal', onclick: () => installerSelection([...choix], dossier.value.trim(), modele.value, raccourcis.checked) }, ic('telecharger', 16), 'Installer')),
  )
}

// ---------------------------------------------------------------- en cours

function vueSuivi(titre) {
  const etapes = h('ol', { class: 'chemin-tables', style: { marginTop: 0 } })
  const barre = h('div', { class: 'progression', hidden: true }, h('div', { style: { width: '0%' } }))
  const detail = h('div', { class: 'texte-2', style: { fontSize: '13px', minHeight: '20px' } })
  const journal = h('div', { class: 'discret mono', style: { fontSize: '12px', maxHeight: '220px', overflow: 'auto', marginTop: '10px' } })
  const fin = h('div')
  const titreCarte = h('h2', {}, ic('rafraichir', 18), titre)
  vider(racine, h('div', { class: 'portail' }, entete(), h('div', { class: 'carte' }, h('div', { class: 'carte-entete' }, titreCarte), etapes, barre, detail, journal, fin)))
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
      vider(titreCarte, ic('coche', 18), texte)
      etapes.querySelectorAll('li').forEach((li) => (li.style.opacity = 0.6))
    },
  }
}

async function installerSelection(applis, dossier, modele = 'auto', raccourcis = true) {
  if (!applis.length) return notifier('Choisissez au moins une application.', 'erreur')
  const suivi = vueSuivi('Installation en cours')
  let resultat = null
  try {
    await flux('/api/ktec/installation/installer', { dossier, applis, modele, raccourcis }, (type, d) => {
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
    h('div', { class: 'bandeau info', style: { marginTop: '14px' } }, ic('coche'), `KTEC est installé dans ${resultat.dossier}.`),
    h('div', { class: 'actions' },
      etat.modeInstallation ? h('button', { class: 'principal', onclick: () => ouvrirKtec(resultat.dossier) }, ic('lecture', 16), 'Ouvrir KTEC') : h('button', { class: 'principal', onclick: () => attendreRedemarrage() }, 'Terminer'),
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
  vider(suivi.fin, h('div', { class: 'bandeau info', style: { marginTop: '14px' } }, ic('coche'), resultat.redemarrer ? 'Mise à jour installée : KTEC redémarre…' : 'Tout est à jour.'))
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
      h('tr', {}, h('td', {}, 'Programme KTEC'), h('td', {}, change(contenu.socle.installee, contenu.socle.fournie))),
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
    titre: 'Désinstaller KTEC',
    contenu: h('div', {},
      h('p', { class: 'texte-2' }, `Le dossier ${etat.installe.dossier} et les raccourcis seront supprimés. Le fichier de connaissances (.ktec), vos rapports (Documents/KTEC) et vos réglages ailleurs sont gardés.`),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, modeles, `Supprimer aussi les modèles d’IA (${etat.dossierModeles}) — ils peuvent servir à un autre agent du poste`)),
    boutons: [{ texte: 'Annuler', classe: 'discret', valeur: false }, { texte: 'Désinstaller', classe: 'danger', valeur: true }],
  })
  if (!ok) return
  const r = await api('/api/ktec/installation/tout-desinstaller', { methode: 'POST', corps: { modeles: modeles.checked } })
  vider(racine, h('div', { class: 'portail' }, h('h1', {}, 'KTEC est désinstallé'), h('p', { class: 'texte-2' }, r.arret ? 'Vous pouvez fermer cet onglet.' : 'Vos données sont gardées.')))
}

async function ouvrirKtec(dossier) {
  await api('/api/ktec/installation/lancer', { methode: 'POST', corps: { dossier } })
  vider(racine, h('div', { class: 'portail' }, entete(), h('div', { class: 'carte' }, h('h2', {}, 'KTEC démarre'), h('p', { class: 'texte-2' }, 'Le portail s’ouvre dans un nouvel onglet. Vous pouvez fermer celui-ci.'))))
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
