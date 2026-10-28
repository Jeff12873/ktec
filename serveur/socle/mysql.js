// La connexion à MySQL, par le moteur Java (moteur-java/Moteur.java).
//
// Tout est rangé dans le fichier de connaissances (info « ktec.connexion », chiffrée avec la clé du site) :
// serveur, port, base, et deux comptes :
//   - lecture  : utilisé par tout le monde, automatiquement (aucun mot de passe à taper) ;
//   - écriture : seulement pour créer ou modifier des FI dans la GMAO, en mode administrateur.
// Les mots de passe ne quittent jamais le serveur : ni l'interface ni le journal ne les voient, et ils sont
// transmis au moteur Java par son entrée standard. Seul l'administrateur peut les remplacer (Réglages).

import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { installation, reglagesPoste, journal } from './installation.js'

// La connexion complète, mots de passe compris : fournie par le fichier de connaissances (ktec.js).
let lireConnexion = () => null
export function definirIdentifiants(fournisseur) {
  lireConnexion = fournisseur
}

function identifiants() {
  let lue = null
  try {
    lue = lireConnexion()
  } catch {
    lue = null
  }
  const { mysql } = reglagesPoste() // serveur, port, base (du fichier, sinon du poste)
  return {
    serveur: lue?.serveur || mysql.serveur,
    port: lue?.port || mysql.port || 3306,
    base: lue?.base || mysql.base,
    lecture: { utilisateur: lue?.utilisateur || mysql.utilisateur || '', motDePasse: lue?.motDePasse || '' },
    ecriture: { utilisateur: lue?.ecriture?.utilisateur || '', motDePasse: lue?.ecriture?.motDePasse || '' },
  }
}

// Le dernier essai de connexion avec le compte de lecture (refait si la connexion change, ou 2 min après un échec).
let essai = { empreinte: null, date: 0, infos: null, erreur: null, enCours: false }
const empreinte = (id) => crypto.createHash('sha256').update([id.serveur, id.port, id.base, id.lecture.utilisateur, id.lecture.motDePasse].join('\u0000')).digest('hex')

function verifierConnexion(id) {
  const e = empreinte(id)
  if (essai.enCours || (essai.empreinte === e && (!essai.erreur || Date.now() - essai.date < 120_000))) return
  essai = { ...essai, enCours: true }
  moteurJava('tester', {}, { compte: id.lecture })
    .then((infos) => {
      if (essai.empreinte !== e || essai.erreur) journal(`Connexion MySQL ouverte : ${infos.serveur}, base ${infos.base}`)
      essai = { empreinte: e, date: Date.now(), infos, erreur: null, enCours: false }
    })
    .catch((erreur) => {
      if (essai.empreinte !== e || !essai.erreur) journal(`Connexion MySQL impossible : ${erreur.message}`)
      essai = { empreinte: e, date: Date.now(), infos: null, erreur: erreur.message, enCours: false }
    })
}

export function etatConnexion() {
  const id = identifiants()
  const configuree = Boolean(id.serveur && id.base && id.lecture.utilisateur)
  const complete = configuree && Boolean(id.lecture.motDePasse)
  if (complete) verifierConnexion(id)
  const essaiValable = essai.empreinte === empreinte(id)
  return {
    configuree,
    motDePasse: Boolean(id.lecture.motDePasse), // enregistré ou non (jamais sa valeur)
    // Ouverte dès que le mot de passe est là, sauf si le dernier essai a échoué.
    ouverte: complete && !(essaiValable && essai.erreur),
    erreur: essaiValable ? essai.erreur : null,
    serveur: id.serveur || '',
    port: id.port,
    base: id.base || '',
    utilisateur: id.lecture.utilisateur,
    ecriture: { configuree: Boolean(id.ecriture.utilisateur && id.ecriture.motDePasse), utilisateur: id.ecriture.utilisateur },
    infos: essaiValable ? essai.infos : null,
  }
}

// Essaie une connexion avant de l'enregistrer (Réglages) : { serveur, port, base, utilisateur, motDePasse }.
export function testerCompte({ serveur, port, base, utilisateur, motDePasse }) {
  return moteurJava('tester', {}, { compte: { utilisateur, motDePasse }, url: `jdbc:mysql://${serveur}:${port || 3306}/${base}` })
}

// Après un changement de connexion : on refait l'essai tout de suite.
export function oublierEssai() {
  essai = { empreinte: null, date: 0, infos: null, erreur: null, enCours: false }
}

export function lireSchema() {
  return moteurJava('schema', {}, { compte: compteLecture() })
}

// Requête de lecture (le moteur Java refuse tout ce qui n'est pas SELECT, WITH, SHOW, DESCRIBE, EXPLAIN).
export function executerRequete(sql, limite = 200) {
  return moteurJava('requete', { limite }, { compte: compteLecture(), texte: sql })
}

// Écriture dans la base (création et modification de FI dans la GMAO, en mode administrateur seulement : c'est
// à l'appelant de le vérifier), avec le compte d'écriture. instructions = [{ sql, valeurs }] (SELECT, INSERT, UPDATE
// ou SET seulement ; « ? » pour chaque valeur), exécutées dans une transaction annulée à la fin (simulation),
// ou validée si valider = true. Renvoie { valide, resultats }.
export function ecrireDansLaBase(instructions, { valider = false } = {}) {
  const { ecriture } = identifiants()
  if (!ecriture.utilisateur || !ecriture.motDePasse) throw Object.assign(new Error('Aucun compte d’écriture réglé : l’administrateur doit le renseigner (Réglages › Connexion à la GMAO).'), { statut: 409 })
  const b64 = (t) => Buffer.from(String(t), 'utf8').toString('base64')
  const texte = instructions.map(({ sql, valeurs = [] }) => [b64(sql), ...valeurs.map((v) => (v === null || v === undefined ? '~' : b64(v)))].join(' ')).join('\n')
  return moteurJava('ecrire', valider ? { valider: 'oui' } : {}, { compte: ecriture, texte })
}

// Fait tourner un rapport dans le moteur BIRT (aperçu HTML ou export). Renvoie { erreurs }.
// images : adresse où KTEC sert les images d'un aperçu HTML (graphiques), rangées dans <sortie>_images.
export function rendreRapport(fichier, format, sortie, parametres = {}, ressources = null, images = null) {
  exigerSession()
  const options = { rapport: fichier, format, sortie }
  if (ressources) options.ressources = ressources
  if (images && format === 'html') options.images = images
  const parametresListe = Object.entries(parametres).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([nom, valeur]) => `${nom}=${valeur}`)
  return moteurJava('rendu', options, { compte: compteLecture(), parametres: parametresListe, delai: 300_000 })
}

// Vérifie un .rptdesign sans le faire tourner (pas besoin de mot de passe). Renvoie { ok, erreurs }.
export function verifierRapport(fichier, ressources = null) {
  return moteurJava('verifier', ressources ? { rapport: fichier, ressources } : { rapport: fichier })
}

function compteLecture() {
  const id = identifiants()
  if (!id.lecture.motDePasse) throw Object.assign(new Error('Connexion à la GMAO non réglée : l’administrateur doit la renseigner (Réglages).'), { statut: 401 })
  return id.lecture
}

// ---------------------------------------------------------------- lancement du moteur Java

function urlJdbc() {
  const id = identifiants()
  if (!id.serveur || !id.base) throw Object.assign(new Error('Connexion à la GMAO non réglée : l’administrateur doit la renseigner (Réglages).'), { statut: 409 })
  return `jdbc:mysql://${id.serveur}:${id.port || 3306}/${id.base}`
}

export function javaInstalle() {
  const config = installation()
  return Boolean(config?.java && fs.existsSync(config.java) && fs.existsSync(config.moteurJava))
}

// Lance une commande du moteur Java et renvoie sa réponse (JSON). Lance une erreur si le moteur en signale une.
// compte : { utilisateur, motDePasse } (rien pour « verifier », qui n'ouvre pas de connexion).
export function moteurJava(commande, options = {}, { compte = { utilisateur: '', motDePasse: '' }, url = null, texte = '', delai = 120_000, parametres = [] } = {}) {
  const config = installation()
  if (!javaInstalle()) return Promise.reject(Object.assign(new Error("Java n'est pas installé sur ce poste : lancez la préparation."), { statut: 409 }))
  const classes = [config.moteurJava, config.connecteur, path.join(config.birt, 'lib', '*')].join(path.delimiter)
  // Entrées et sorties en UTF-8 quel que soit le système (Windows écrirait sinon en cp1252 : accents abîmés).
  const args = ['-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8', '-Dfile.encoding=UTF-8', '-cp', classes, 'Moteur', commande, '--url', url || (commande === 'verifier' ? 'jdbc:mysql://localhost/verifier' : urlJdbc()), '--utilisateur', compte.utilisateur || '']
  for (const [nom, valeur] of Object.entries(options)) args.push(`--${nom}`, String(valeur))
  for (const parametre of parametres) args.push('--param', parametre) // paramètres de rapport « nom=valeur »

  return new Promise((ok, echec) => {
    const processus = spawn(config.java, args, { windowsHide: true })
    // Les morceaux sont gardés tels quels et décodés à la fin : un caractère accentué peut être coupé
    // entre deux morceaux (il deviendrait « ��� » si chaque morceau était décodé à part).
    const morceaux = []
    let erreurs = ''
    const minuterie = setTimeout(() => processus.kill(), delai)
    processus.stdout.on('data', (morceau) => morceaux.push(morceau))
    processus.stderr.on('data', (morceau) => (erreurs += morceau))
    processus.on('error', echec)
    processus.on('close', () => {
      clearTimeout(minuterie)
      const sortie = Buffer.concat(morceaux).toString('utf8')
      const ligne = sortie.trim().split('\n').pop() // la réponse JSON est la dernière ligne
      let reponse
      try {
        reponse = JSON.parse(ligne)
      } catch {
        journal(`Moteur Java (${commande}) : réponse illisible\n${erreurs.slice(-2000)}`)
        return echec(new Error('Le moteur Java a échoué (voir journal.txt).'))
      }
      if (reponse.erreur) return echec(Object.assign(new Error(reponse.erreur), { statut: 400 }))
      ok(reponse)
    })
    processus.stdin.end(`${compte.motDePasse || ''}\n${texte}`)
  })
}
