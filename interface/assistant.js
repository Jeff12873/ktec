// L'assistant du premier lancement : une question par écran, avec sa description, et un chargement entre deux
// pendant que KTEC vérifie ce qu'on vient de lui donner.
//   1. Bienvenue
//   2. Le fichier de connaissances (en choisir un existant, ou en créer un)
//   3. La clé du site (l'importer si la configuration est chiffrée ; sinon proposer de la chiffrer)
//   4. La connexion à la base de la GMAO (essayée avec le mot de passe, jamais enregistré)
//   5. Récapitulatif
// lancerAssistant({ seulementCle: true }) : seulement l'écran de la clé (poste sans la clé d'un fichier chiffré).

import { h, vider, ic } from './socle/ui.js'
import { api } from './socle/api.js'
import { explorateur } from './socle/fichier.js'

export function lancerAssistant({ seulementCle = false } = {}) {
  return new Promise((termine) => {
    const carte = h('div', { class: 'carte carte-assistant' })
    const voile = h('div', { class: 'assistant' }, carte)
    document.body.append(voile)
    const bilan = { fichier: null, cle: null, connexion: null }
    let etat = null

    // Un écran : numéro, titre, description, contenu, boutons.
    const ecran = ({ numero, titre, description, contenu = null, boutons = [] }) => vider(carte,
      numero ? h('div', { class: 'etape-assistant' }, seulementCle ? 'Clé du site' : `Étape ${numero} sur 3`) : null,
      h('h1', {}, titre),
      description ? h('p', { class: 'description-assistant' }, description) : null,
      contenu,
      h('div', { class: 'boutons-assistant' }, boutons))
    const bouton = (texte, action, classe = '') => h('button', { class: classe, onclick: action }, texte)
    const erreur = (message) => h('div', { class: 'bandeau' }, ic('alerte'), message)

    // Le chargement entre deux écrans : au moins un court instant, pour qu'on voie ce que KTEC vérifie.
    async function chargement(message, travail) {
      vider(carte, h('div', { class: 'chargement-assistant' }, h('div', { class: 'rond-chargement' }), h('p', {}, message)))
      const [resultat] = await Promise.allSettled([travail(), new Promise((r) => setTimeout(r, 900))])
      if (resultat.status === 'rejected') throw resultat.reason
      return resultat.value
    }
    const relire = async () => (etat = await api('/api/ktec/assistant'))

    function fermer() {
      voile.classList.add('fin')
      setTimeout(() => { voile.remove(); termine() }, 350)
    }

    // ---- 1. Bienvenue
    function bienvenue() {
      ecran({
        titre: 'Bienvenue dans KTEC',
        description: 'Les applications de l’atelier : rapports et indicateurs (BiRTEC), recherche de pièces (PDRTEC), assistant IA (AITEC). Tout reste chez vous : un fichier de connaissances local, une IA sur ce poste, aucun envoi sur Internet. Trois questions pour commencer.',
        boutons: [bouton('Commencer', () => fichier(), 'principal')],
      })
    }

    // ---- 2. Le fichier de connaissances
    function fichier(message = null) {
      ecran({
        numero: 1,
        titre: 'Avez-vous déjà un fichier de connaissances ?',
        description: 'C’est le fichier qui contient tout ce que les applications savent du site : structure de la base, réglages, requêtes, documents… Il y en a un seul pour tous les postes, souvent sur un lecteur réseau, avec l’extension .ktec.',
        contenu: h('div', {},
          message ? erreur(message) : null,
          etat?.fichier?.fichier ? h('p', { class: 'discret' }, 'Fichier actuel : ', h('span', { class: 'mono' }, etat.fichier.fichier)) : null),
        boutons: [
          bouton('Oui, je le choisis', () => choisirFichier(), 'principal'),
          bouton('Non, en créer un', () => creerFichier()),
          etat?.fichier?.fichier ? bouton('Garder le fichier actuel', () => { bilan.fichier = etat.fichier.fichier; cle() }, 'discret') : null,
        ],
      })
    }
    function choisirFichier() {
      const ex = explorateur('fichier', async (chemin) => {
        try {
          await chargement('Ouverture et vérification du fichier…', () => api('/api/ktec/fichier/ouvrir', { methode: 'POST', corps: { chemin } }))
          await relire()
          bilan.fichier = chemin
          cle()
        } catch (e) {
          fichier(e.message)
        }
      })
      ecran({ numero: 1, titre: 'Choisissez le fichier .ktec', description: 'Parcourez jusqu’au fichier (lecteur réseau, clé USB…), puis cliquez dessus.', contenu: ex.element, boutons: [bouton('Retour', () => fichier(), 'discret')] })
    }
    function creerFichier() {
      const nom = h('input', { type: 'text', value: 'connaissances.ktec' })
      const ex = explorateur('dossier', () => {})
      ecran({
        numero: 1,
        titre: 'Où créer le fichier ?',
        description: 'Choisissez un dossier partagé si plusieurs postes doivent l’utiliser (un lecteur réseau, par exemple), puis son nom.',
        contenu: h('div', {}, ex.element, h('label', { class: 'champ', style: { marginTop: '10px' } }, h('span', {}, 'Nom du fichier'), nom)),
        boutons: [
          bouton('Créer le fichier', async () => {
            if (!ex.dossier()) return
            const nomFichier = nom.value.trim().endsWith('.ktec') ? nom.value.trim() : `${nom.value.trim()}.ktec`
            try {
              await chargement('Création du fichier de connaissances…', () => api('/api/ktec/fichier/creer', { methode: 'POST', corps: { dossier: ex.dossier(), nom: nomFichier } }))
              await relire()
              bilan.fichier = etat.fichier?.fichier
              cle()
            } catch (e) {
              fichier(e.message)
            }
          }, 'principal'),
          bouton('Retour', () => fichier(), 'discret'),
        ],
      })
    }

    // ---- 3. La clé du site
    function cle(message = null) {
      const c = etat?.cle || {}
      if (c.chiffree && !c.bonneCle) {
        const choix = h('input', { type: 'file', accept: '.ktecclef,application/json', style: { display: 'none' } })
        choix.onchange = async () => {
          const f = choix.files[0]
          if (!f) return
          try {
            await chargement('Vérification de la clé…', () => api('/api/ktec/cle/importer', { methode: 'POST', fichier: f }))
            await relire()
            bilan.cle = 'importée'
            seulementCle ? fin() : connexion()
          } catch (e) {
            cle(e.message)
          }
        }
        return ecran({
          numero: 2,
          titre: 'Avez-vous la clé du site ?',
          description: 'La configuration de ce fichier (connexion, adresses, requêtes, réglages) est chiffrée. La clé du site, un petit fichier .ktecclef exporté sur le premier poste, permet à KTEC de la lire. Elle n’est demandée qu’une fois sur ce poste.',
          contenu: h('div', {}, message ? erreur(message) : null, choix),
          boutons: [
            bouton('Oui, je la choisis', () => choix.click(), 'principal'),
            seulementCle ? bouton('Plus tard', () => fermer(), 'discret') : bouton('Plus tard (les réglages resteront invisibles)', () => { bilan.cle = 'absente'; connexion() }, 'discret'),
          ],
        })
      }
      if (c.chiffree) {
        bilan.cle = 'déjà sur ce poste'
        return seulementCle ? fin() : connexion()
      }
      ecran({
        numero: 2,
        titre: 'Protéger la configuration ?',
        description: 'KTEC peut chiffrer la configuration rangée dans le fichier (connexion à la base, adresses, requêtes, réglages des applications) : sans la clé du site, personne ne peut la lire, et aucun mot de passe n’est à taper. La clé est créée sur ce poste ; exportez-la ensuite et gardez-la en lieu sûr : les autres postes en auront besoin.',
        contenu: message ? erreur(message) : null,
        boutons: [
          bouton('Oui, chiffrer et exporter la clé', async () => {
            try {
              await chargement('Chiffrement de la configuration…', () => api('/api/ktec/cle/chiffrer', { methode: 'POST' }))
              const r = await api('/api/ktec/cle/exporter', { methode: 'POST' })
              const lien = h('a', { href: URL.createObjectURL(new Blob([r.contenu], { type: 'application/json' })), download: r.nom })
              document.body.append(lien); lien.click(); lien.remove()
              await relire()
              bilan.cle = 'créée et exportée'
              connexion()
            } catch (e) {
              cle(e.message)
            }
          }, 'principal'),
          bouton('Plus tard', () => { bilan.cle = 'configuration en clair'; connexion() }, 'discret'),
        ],
      })
    }

    // ---- 4. La connexion à la base de la GMAO
    function connexion(message = null) {
      const m = etat?.mysql || {}
      const champ = (libelle, valeur, attributs = {}) => {
        const e = h('input', { type: 'text', value: valeur ?? '', ...attributs })
        return { e, element: h('label', { class: 'champ' }, h('span', {}, libelle), e) }
      }
      const serveur = champ('Serveur', m.serveur, { placeholder: 'adresse du serveur MySQL' })
      const port = champ('Port', m.port || 3306, { inputmode: 'numeric' })
      const base = champ('Base', m.base)
      const utilisateur = champ('Utilisateur', m.utilisateur)
      const mdp = champ('Mot de passe', '', { type: 'password', autocomplete: 'off' })
      ecran({
        numero: 3,
        titre: 'La connexion à la base de la GMAO',
        description: m.serveur ? 'Les applications lisent la base de la GMAO en lecture seule. La connexion est déjà réglée : il ne reste que le mot de passe, demandé à chaque démarrage et jamais enregistré.' : 'Les applications lisent la base de la GMAO en lecture seule. Le mot de passe est demandé à chaque démarrage de KTEC, et jamais enregistré.',
        contenu: h('div', {}, message ? erreur(message) : null, h('div', { class: 'grille grille-2' }, serveur.element, port.element, base.element, utilisateur.element), mdp.element),
        boutons: [
          bouton('Essayer et continuer', async () => {
            try {
              await chargement('Connexion à la base…', async () => {
                await api('/api/ktec/configuration/mysql', { methode: 'POST', corps: { serveur: serveur.e.value, port: port.e.value, base: base.e.value, utilisateur: utilisateur.e.value } })
                if (mdp.e.value) await api('/api/ktec/session', { methode: 'POST', corps: { motDePasse: mdp.e.value } })
              })
              bilan.connexion = `${utilisateur.e.value}@${serveur.e.value}/${base.e.value}${mdp.e.value ? ' (connecté)' : ''}`
              fin()
            } catch (e) {
              connexion(e.message)
            }
          }, 'principal'),
          bouton('Passer pour l’instant', () => { bilan.connexion = 'à régler plus tard'; fin() }, 'discret'),
          bouton('Retour', () => cle(), 'discret'),
        ],
      })
    }

    // ---- 5. Récapitulatif
    function fin() {
      const ligne = (libelle, valeur) => valeur ? h('li', {}, h('b', {}, libelle + ' : '), valeur) : null
      ecran({
        titre: seulementCle ? 'La configuration est lisible' : 'C’est prêt',
        description: seulementCle ? 'La clé du site est enregistrée sur ce poste : les applications retrouvent leurs réglages.' : 'KTEC est réglé sur ce poste. Tout se modifie ensuite dans « Réglages », en bas du lanceur.',
        contenu: seulementCle ? null : h('ul', { class: 'bilan-assistant' }, ligne('Fichier de connaissances', bilan.fichier), ligne('Clé du site', bilan.cle), ligne('Base de la GMAO', bilan.connexion)),
        boutons: [bouton('Ouvrir KTEC', async () => { if (!seulementCle) await api('/api/ktec/assistant/fini', { methode: 'POST' }).catch(() => {}); fermer() }, 'principal')],
      })
    }

    relire().catch(() => {}).finally(() => (seulementCle ? cle() : bienvenue()))
  })
}
