// Le fichier .ktec : toutes les connaissances propres au site, en un seul fichier (base SQLite),
// commun à toutes les applications KTEC (BiRTEC, PDRTec, AITEC…).
//
// On y range ce que les applications apprennent de la GMAO et que l'IA doit connaître :
//   notes      → conventions et explications (les notes « toujours » sont données à l'IA à chaque question)
//   tables     → structure des tables (lue sur MySQL ou importée d'un export « CREATE TABLE »)
//   liens      → liens entre tables (la base n'en déclare pas toujours : ils sont alors déduits ou importés)
//   requetes   → requêtes SQL du site, servant d'exemples à l'IA
//   fichiers   → rapports modèles, bibliothèques, feuilles de style… (le contenu des fichiers)
//   indicateurs→ indicateurs de la GMAO (requête indicateur + requête liste)
//   dictionnaire → nom clair et description des tables et colonnes, tables écartées de l'IA
//   liens_dico → nom clair et description des liens entre tables
//   infos      → réglages propres au site : charte des rapports, fenêtres des indicateurs, réglages de
//                chaque application (clés « pdrtec.… », « aitec.… »)
//
// Rien de tout cela n'est dans le programme ni sur GitHub : le programme est une « coquille vide ».
// Le fichier se copie, s'envoie ou se sauvegarde comme n'importe quel document.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { reglagesPoste, modifierReglagesPoste, dossierTravail, journal, lireJson, dossierInstallationParDefaut, definirConnexionPartagee } from './installation.js'
import { definirIdentifiants } from './mysql.js'
import { cleDuPoste, chiffrer, dechiffrer, estChiffre, empreinteCle, nouvelleCle, enregistrerCle, lireFichierCle } from './cle.js'
import { db, ajouterStructure, definirCheminParDefaut, ouvrirFichier, creerFichier, exigerEcriture, noterModification, transaction, etatPartage, FORMAT, baseOuverte } from './partage.js'

// Le fichier partagé lui-même (verrou, publication, mode administrateur) : voir partage.js.
export { db, transaction, exigerEcriture, noterModification, ajouterStructure }
export { FORMAT }

// Le fichier du poste (réglages), sinon <dossier de travail>/connaissances.ktec.
export function cheminKtec() {
  return reglagesPoste().fichierKtec || path.join(dossierTravail(), 'connaissances.ktec')
}

// Premier accès : l'ancien .birtec est repris, sinon un fichier vide est créé.
definirCheminParDefaut(() => {
  const chemin = cheminKtec()
  if (!fs.existsSync(chemin)) reprendreAncienBirtec(chemin)
  if (!fs.existsSync(chemin)) creerFichier(chemin)
  return chemin
})

// La base (copie locale du fichier partagé), en lecture. Pour écrire : les fonctions ci-dessous, ou
// exigerEcriture() avant et noterModification() après.
export function ktec() {
  return db()
}

// Une écriture : verrou d'abord (pris tout seul si le fichier n'a pas de mot de passe), publication ensuite.
function ecrire(travail) {
  exigerEcriture()
  const resultat = travail(db())
  noterModification()
  return resultat
}

// Ouvre (ou crée) un autre fichier .ktec et le retient pour les prochaines ouvertures.
// Un ancien fichier .birtec est converti : copié à côté sous le même nom en .ktec (l'original est gardé).
export function changerKtec(chemin) {
  chemin = path.resolve(chemin)
  const extension = path.extname(chemin).toLowerCase()
  if (!['.ktec', '.birtec'].includes(extension)) throw Object.assign(new Error('Le fichier doit avoir l’extension .ktec'), { statut: 400 })
  if (!fs.existsSync(path.dirname(chemin))) throw Object.assign(new Error(`Dossier introuvable : ${path.dirname(chemin)}`), { statut: 404 })
  if (extension === '.birtec') {
    if (!fs.existsSync(chemin)) throw Object.assign(new Error(`Fichier introuvable : ${chemin}`), { statut: 404 })
    const converti = chemin.slice(0, -extension.length) + '.ktec'
    if (!fs.existsSync(converti)) fs.copyFileSync(chemin, converti)
    journal(`Ancien fichier ${chemin} converti en ${converti}`)
    chemin = converti
  }
  return fs.existsSync(chemin) ? ouvrirFichier(chemin) : creerFichier(chemin)
}

// Premier lancement de KTEC sur un poste où BiRTEC était installé : on reprend son fichier .birtec
// (copié, jamais déplacé : l'ancien reste en place) et ses rapports. Le contenu est le même, seul le nom change.
function reprendreAncienBirtec(destination) {
  const anciensReglages = [dossierInstallationParDefaut('BiRTEC'), ...reglagesPoste().applisDev]
    .map((d) => lireJson(path.join(d, 'reglages-poste.json'), null)).filter(Boolean)
  const dossierAncien = anciensReglages.find((r) => r.dossierTravail)?.dossierTravail || path.join(os.homedir(), 'Documents', 'BiRTEC')
  const ancien = anciensReglages.find((r) => r.fichierBirtec)?.fichierBirtec || path.join(dossierAncien, 'connaissances.birtec')
  if (!fs.existsSync(ancien)) return
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(ancien, destination)
  journal(`Fichier de connaissances repris de BiRTEC : ${ancien} → ${destination}`)
  // Les rapports créés avec BiRTEC, s'il n'y en a pas encore dans le nouveau dossier de travail.
  const rapportsAnciens = path.join(dossierAncien, 'rapports')
  const rapports = path.join(dossierTravail(), 'rapports')
  if (fs.existsSync(rapportsAnciens) && !fs.readdirSync(rapports).length) {
    fs.cpSync(rapportsAnciens, rapports, { recursive: true })
    journal(`Rapports repris de BiRTEC : ${rapportsAnciens} → ${rapports}`)
  }
  // L'adresse de la connexion MySQL (sans mot de passe), si KTEC n'en a pas encore.
  const mysql = anciensReglages.find((r) => r.mysql?.serveur)?.mysql
  if (mysql && !reglagesPoste().mysql.serveur) modifierReglagesPoste({ mysql })
}

// La structure commune du fichier (les applications ajoutent la leur avec ajouterStructure).
ajouterStructure((db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS infos (cle TEXT PRIMARY KEY, valeur TEXT);
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY, titre TEXT NOT NULL, contenu TEXT NOT NULL DEFAULT '',
      toujours INTEGER NOT NULL DEFAULT 0, source TEXT, modifie TEXT);
    CREATE TABLE IF NOT EXISTS tables_base (
      nom TEXT PRIMARY KEY, commentaire TEXT, colonnes TEXT NOT NULL, source TEXT, modifie TEXT);
    CREATE TABLE IF NOT EXISTS liens (
      de_table TEXT, de_colonne TEXT, vers_table TEXT, vers_colonne TEXT, source TEXT,
      PRIMARY KEY (de_table, de_colonne, vers_table));
    CREATE TABLE IF NOT EXISTS requetes (
      id INTEGER PRIMARY KEY, titre TEXT NOT NULL, sql TEXT NOT NULL, description TEXT,
      source TEXT UNIQUE, modifie TEXT);
    CREATE TABLE IF NOT EXISTS indicateurs (
      id INTEGER PRIMARY KEY, nom TEXT NOT NULL, fenetre TEXT, demande TEXT, definition TEXT,
      requete_indicateur TEXT, requete_liste TEXT, source TEXT, modifie TEXT);
    CREATE TABLE IF NOT EXISTS dictionnaire (
      table_nom TEXT NOT NULL, colonne TEXT NOT NULL DEFAULT '', libelle TEXT, description TEXT,
      exclue INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (table_nom, colonne));
    CREATE TABLE IF NOT EXISTS liens_dico (
      de_table TEXT, de_colonne TEXT, vers_table TEXT, libelle TEXT, description TEXT,
      PRIMARY KEY (de_table, de_colonne, vers_table));
    CREATE TABLE IF NOT EXISTS fichiers (
      categorie TEXT, nom TEXT, contenu BLOB, taille INTEGER, source TEXT, modifie TEXT,
      PRIMARY KEY (categorie, nom));
  `)
  db.prepare('INSERT OR IGNORE INTO infos VALUES (?, ?)').run('format', String(FORMAT))
  db.prepare('INSERT OR IGNORE INTO infos VALUES (?, ?)').run('cree', new Date().toISOString())
})

const maintenant = () => new Date().toISOString()

// ---------------------------------------------------------------- réglages du site (infos)

// Valeur JSON rangée dans la table infos (ex. « charte », « itm »), ou la valeur par défaut.
// Une configuration chiffrée (clé du site) est déchiffrée ici ; sans la bonne clé : la valeur par défaut.
export function lireInfo(cle, defaut = null) {
  const ligne = ktec().prepare('SELECT valeur FROM infos WHERE cle = ?').get(cle)
  if (!ligne) return defaut
  const texte = dechiffrer(ligne.valeur)
  if (texte === null) return defaut
  try {
    return JSON.parse(texte)
  } catch {
    return defaut
  }
}

function ecrireInfoBrut(cle, valeur) {
  ktec().prepare('INSERT OR REPLACE INTO infos VALUES (?, ?)').run(cle, protegerTexte(JSON.stringify(valeur), cle))
}

// ---------------------------------------------------------------- configuration chiffrée (clé du site)
//
// Une fois la configuration chiffrée, la marque « ktec.cle » (en clair : l'empreinte de la clé, jamais la clé)
// dit qu'il faut la clé du site pour la lire. Restent en clair : le format et la date de création du fichier.

const EN_CLAIR = new Set(['format', 'cree', 'ktec.cle'])
function marqueCle() {
  const ligne = ktec().prepare("SELECT valeur FROM infos WHERE cle = 'ktec.cle'").get()
  try {
    return ligne ? JSON.parse(ligne.valeur) : null
  } catch {
    return null
  }
}

// Pour les applications qui ont leurs propres réglages (AITEC) : chiffrer en écrivant, déchiffrer en lisant.
export function protegerTexte(texte, cle = '') {
  return typeof texte === 'string' && !EN_CLAIR.has(cle) && marqueCle() ? chiffrer(texte) : texte
}
export const lireTexteProtege = (texte) => (estChiffre(texte) ? dechiffrer(texte) : texte)

export function etatCle() {
  const marque = marqueCle()
  const c = cleDuPoste()
  return { chiffree: Boolean(marque), cleSurLePoste: Boolean(c), bonneCle: Boolean(marque && c && empreinteCle(c) === marque.empreinte), empreinte: marque?.empreinte || null }
}

// Chiffre toute la configuration du fichier (crée la clé du site si ce poste n'en a pas).
export function chiffrerConfiguration() {
  return ecrire((db) => {
    const marque = marqueCle()
    let c = cleDuPoste()
    if (marque && (!c || empreinteCle(c) !== marque.empreinte)) throw Object.assign(new Error('La configuration est déjà chiffrée avec une autre clé : importez la clé du site.'), { statut: 409 })
    if (!c) {
      c = nouvelleCle()
      enregistrerCle(c)
      journal('Clé du site créée sur ce poste')
    }
    db.exec('BEGIN')
    try {
      db.prepare("INSERT OR REPLACE INTO infos VALUES ('ktec.cle', ?)").run(JSON.stringify({ empreinte: empreinteCle(c), depuis: new Date().toISOString() }))
      for (const { cle, valeur } of db.prepare('SELECT cle, valeur FROM infos').all()) {
        if (!EN_CLAIR.has(cle) && !estChiffre(valeur)) db.prepare('UPDATE infos SET valeur = ? WHERE cle = ?').run(chiffrer(valeur, c), cle)
      }
      // Les réglages d'AITEC (table à part), s'il y en a : seulement les textes.
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reglages'").get()) {
        for (const { cle, valeur } of db.prepare('SELECT cle, valeur FROM reglages').all()) {
          if (typeof valeur === 'string' && valeur && !EN_CLAIR.has(cle) && !estChiffre(valeur)) db.prepare('UPDATE reglages SET valeur = ? WHERE cle = ?').run(chiffrer(valeur, c), cle)
        }
      }
      db.exec('COMMIT')
    } catch (erreur) {
      db.exec('ROLLBACK')
      throw erreur
    }
    journal('Configuration du fichier de connaissances chiffrée')
    return etatCle()
  })
}

// Importe la clé du site sur ce poste (fichier .ktecclef) ; refuse une clé qui n'ouvre pas ce fichier.
export function importerCle(texte) {
  const c = lireFichierCle(texte)
  const marque = marqueCle()
  if (marque && empreinteCle(c) !== marque.empreinte) throw Object.assign(new Error('Cette clé n’ouvre pas ce fichier de connaissances : ce n’est pas celle de ce site.'), { statut: 400 })
  enregistrerCle(c)
  journal('Clé du site importée sur ce poste')
  return etatCle()
}

// La connexion MySQL commune à tous les postes, rangée (chiffrée) dans le fichier.
// (seulement une fois le fichier ouvert : la lire ne doit jamais l'ouvrir, les applications déclarent d'abord leurs tables)
const connexionDuFichier = () => (baseOuverte() ? lireInfo('ktec.connexion', null) : null)
definirConnexionPartagee(connexionDuFichier)
definirIdentifiants(connexionDuFichier)

// Enregistre la connexion à la GMAO dans le fichier (réservé à l'administrateur : à vérifier par l'appelant).
// Les mots de passe ne sont jamais écrits en clair : la configuration est chiffrée d'abord (clé du site créée
// sur ce poste au besoin). Un mot de passe laissé vide garde celui déjà enregistré.
export function enregistrerConnexion({ serveur, port, base, utilisateur, motDePasse, ecriture = {} }) {
  const cle = etatCle()
  if (cle.chiffree && !cle.bonneCle) throw Object.assign(new Error('La configuration est chiffrée avec une clé absente de ce poste : importez d’abord la clé du site.'), { statut: 423 })
  if (!cle.chiffree) chiffrerConfiguration()
  const avant = lireInfo('ktec.connexion', {}) || {}
  const memeServeur = avant.serveur === serveur && Number(avant.port) === Number(port) && avant.base === base
  const garder = (nouveau, ancien, memeCompte) => nouveau || (memeServeur && memeCompte ? ancien || '' : '')
  const connexion = {
    serveur, port, base, utilisateur,
    motDePasse: garder(motDePasse, avant.motDePasse, avant.utilisateur === utilisateur),
    ecriture: ecriture.utilisateur ? { utilisateur: ecriture.utilisateur, motDePasse: garder(ecriture.motDePasse, avant.ecriture?.motDePasse, avant.ecriture?.utilisateur === ecriture.utilisateur) } : null,
  }
  ecrireInfo('ktec.connexion', connexion)
  return connexion
}

// ---------------------------------------------------------------- indicateurs

export function listerIndicateurs() {
  return ktec().prepare('SELECT id, nom, fenetre, demande, definition, requete_indicateur AS requeteIndicateur, requete_liste AS requeteListe, source, modifie FROM indicateurs ORDER BY nom').all()
    .map((i) => ({ ...i, definition: i.definition ? JSON.parse(i.definition) : null }))
}

function enregistrerIndicateurBrut({ id, nom, fenetre, demande = '', definition = null, requeteIndicateur, requeteListe, source = null }) {
  const db = ktec()
  const valeurs = [nom, fenetre, demande, definition ? JSON.stringify(definition) : null, requeteIndicateur, requeteListe, source, maintenant()]
  if (id) {
    db.prepare('UPDATE indicateurs SET nom = ?, fenetre = ?, demande = ?, definition = ?, requete_indicateur = ?, requete_liste = ?, source = ?, modifie = ? WHERE id = ?').run(...valeurs, id)
    return id
  }
  return Number(db.prepare('INSERT INTO indicateurs (nom, fenetre, demande, definition, requete_indicateur, requete_liste, source, modifie) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(...valeurs).lastInsertRowid)
}

function supprimerIndicateurBrut(id) {
  ktec().prepare('DELETE FROM indicateurs WHERE id = ?').run(id)
}

// ---------------------------------------------------------------- résumé

export function resumeKtec() {
  const db = ktec()
  const compter = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n
  const chemin = cheminKtec()
  return {
    chemin,
    taille: fs.existsSync(chemin) ? fs.statSync(chemin).size : 0,
    notes: compter('notes'),
    tables: compter('tables_base'),
    liens: compter('liens'),
    requetes: compter('requetes'),
    indicateurs: compter('indicateurs'),
    fichiers: Object.fromEntries(db.prepare('SELECT categorie, COUNT(*) AS n FROM fichiers GROUP BY categorie').all().map((l) => [l.categorie, l.n])),
  }
}

// ---------------------------------------------------------------- notes

export function listerNotes() {
  return ktec().prepare('SELECT id, titre, contenu, toujours, source, modifie FROM notes ORDER BY toujours DESC, titre').all()
}

function enregistrerNoteBrut({ id, titre, contenu = '', toujours = false, source = null }) {
  const db = ktec()
  if (id) {
    db.prepare('UPDATE notes SET titre = ?, contenu = ?, toujours = ?, modifie = ? WHERE id = ?').run(titre, contenu, toujours ? 1 : 0, maintenant(), id)
    return id
  }
  // Une note importée remplace celle qui vient du même fichier.
  if (source) {
    const existante = db.prepare('SELECT id FROM notes WHERE source = ?').get(source)
    if (existante) {
      db.prepare('UPDATE notes SET titre = ?, contenu = ?, modifie = ? WHERE id = ?').run(titre, contenu, maintenant(), existante.id)
      return existante.id
    }
  }
  return Number(db.prepare('INSERT INTO notes (titre, contenu, toujours, source, modifie) VALUES (?, ?, ?, ?, ?)').run(titre, contenu, toujours ? 1 : 0, source, maintenant()).lastInsertRowid)
}

function supprimerNoteBrut(id) {
  ktec().prepare('DELETE FROM notes WHERE id = ?').run(id)
}

// ---------------------------------------------------------------- structure des tables et liens

// tables : [{ nom, commentaire, colonnes: [{ nom, type, cle, commentaire }] }]
function enregistrerTablesBrut(tables, source) {
  const db = ktec()
  const ecrire = db.prepare('INSERT OR REPLACE INTO tables_base (nom, commentaire, colonnes, source, modifie) VALUES (?, ?, ?, ?, ?)')
  db.exec('BEGIN')
  for (const t of tables) ecrire.run(t.nom, t.commentaire || '', JSON.stringify(t.colonnes), source, maintenant())
  db.exec('COMMIT')
}

export function lireTables() {
  return ktec()
    .prepare('SELECT nom, commentaire, colonnes FROM tables_base ORDER BY nom')
    .all()
    .map((t) => ({ nom: t.nom, commentaire: t.commentaire, colonnes: JSON.parse(t.colonnes) }))
}

// liens : [{ deTable, deColonne, versTable, versColonne }]
function enregistrerLiensBrut(liens, source) {
  const db = ktec()
  // Un lien importé ou déclaré l'emporte sur un lien déduit ; l'inverse ne remplace rien.
  const ecrire = db.prepare(source === 'déduit'
    ? 'INSERT OR IGNORE INTO liens VALUES (?, ?, ?, ?, ?)'
    : 'INSERT OR REPLACE INTO liens VALUES (?, ?, ?, ?, ?)')
  db.exec('BEGIN')
  for (const l of liens) ecrire.run(l.deTable, l.deColonne, l.versTable, l.versColonne, source)
  db.exec('COMMIT')
}

export function lireLiens() {
  return ktec().prepare('SELECT de_table AS deTable, de_colonne AS deColonne, vers_table AS versTable, vers_colonne AS versColonne, source FROM liens').all()
}

// Liens déduits des noms de colonnes, pour les bases qui ne déclarent pas leurs clés étrangères :
// une colonne ID_XXX (ou id_xxx) pointe vers la table xxx si celle-ci a une colonne du même nom.
export function deduireLiens(tables) {
  const parNom = new Map(tables.map((t) => [t.nom.toLowerCase(), t]))
  const liens = []
  for (const table of tables) {
    for (const colonne of table.colonnes) {
      const cible = colonne.nom.match(/^id_(.+)$/i)?.[1]?.toLowerCase()
      if (!cible || cible === table.nom.toLowerCase()) continue
      const versTable = parNom.get(cible)
      const versColonne = versTable?.colonnes.find((c) => c.nom.toLowerCase() === colonne.nom.toLowerCase())
      if (versTable && versColonne) liens.push({ deTable: table.nom, deColonne: colonne.nom, versTable: versTable.nom, versColonne: versColonne.nom })
    }
  }
  return liens
}

// ---------------------------------------------------------------- dictionnaire (noms clairs, descriptions, tables écartées)

// { tables: Map(nom → { libelle, description, exclue }), colonnes: Map('table.colonne' → { libelle, description }) }
// Les clés sont en minuscules : MySQL sous Windows ne distingue pas FI de fi.
export function lireDictionnaire() {
  const tables = new Map()
  const colonnes = new Map()
  for (const l of ktec().prepare('SELECT table_nom, colonne, libelle, description, exclue FROM dictionnaire').all()) {
    const entree = { libelle: l.libelle || '', description: l.description || '', exclue: Boolean(l.exclue) }
    if (l.colonne) colonnes.set(`${l.table_nom}.${l.colonne}`.toLowerCase(), entree)
    else tables.set(l.table_nom.toLowerCase(), entree)
  }
  return { tables, colonnes }
}

// Enregistre le nom clair, la description ou l'exclusion d'une table (colonne vide) ou d'une colonne.
// Seuls les champs fournis sont modifiés.
function enregistrerDictionnaireBrut({ table, colonne = '', libelle, description, exclue }) {
  const db = ktec()
  const actuel = db.prepare('SELECT libelle, description, exclue FROM dictionnaire WHERE table_nom = ? AND colonne = ?').get(table, colonne) || {}
  db.prepare('INSERT OR REPLACE INTO dictionnaire (table_nom, colonne, libelle, description, exclue) VALUES (?, ?, ?, ?, ?)').run(
    table, colonne,
    libelle ?? actuel.libelle ?? '',
    description ?? actuel.description ?? '',
    exclue === undefined ? (actuel.exclue ?? 0) : (exclue ? 1 : 0),
  )
}

export function lireLiensDictionnaire() {
  const liens = new Map()
  for (const l of ktec().prepare('SELECT * FROM liens_dico').all()) liens.set(`${l.de_table}.${l.de_colonne}>${l.vers_table}`.toLowerCase(), { libelle: l.libelle || '', description: l.description || '' })
  return liens
}

function enregistrerLienDictionnaireBrut({ deTable, deColonne, versTable, libelle = '', description = '' }) {
  ktec().prepare('INSERT OR REPLACE INTO liens_dico VALUES (?, ?, ?, ?, ?)').run(deTable, deColonne, versTable, libelle, description)
}

// Ajoute un lien saisi à la main (ex. une colonne au nom inhabituel) : il l'emporte sur un lien déduit.
function ajouterLienBrut({ deTable, deColonne, versTable, versColonne }) {
  ktec().prepare('INSERT OR REPLACE INTO liens VALUES (?, ?, ?, ?, ?)').run(deTable, deColonne, versTable, versColonne, 'saisi')
}

// ---------------------------------------------------------------- requêtes du site

function enregistrerRequeteBrut({ titre, sql, description = '', source }) {
  ktec()
    .prepare(`INSERT INTO requetes (titre, sql, description, source, modifie) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(source) DO UPDATE SET titre = excluded.titre, sql = excluded.sql, description = excluded.description, modifie = excluded.modifie`)
    .run(titre, sql, description, source, maintenant())
}

export function listerRequetes() {
  return ktec().prepare('SELECT id, titre, sql, description, source, modifie FROM requetes ORDER BY titre').all()
}

function supprimerRequeteBrut(id) {
  ktec().prepare('DELETE FROM requetes WHERE id = ?').run(id)
}

// ---------------------------------------------------------------- fichiers (modèles, ressources, documents)

function enregistrerFichierBrut(categorie, nom, contenu, source = null) {
  ktec()
    .prepare('INSERT OR REPLACE INTO fichiers (categorie, nom, contenu, taille, source, modifie) VALUES (?, ?, ?, ?, ?, ?)')
    .run(categorie, nom, contenu, contenu.length, source, maintenant())
}

export function listerFichiers(categorie) {
  return ktec().prepare('SELECT nom, taille, source, modifie FROM fichiers WHERE categorie = ? ORDER BY nom').all(categorie)
}

export function lireFichier(categorie, nom) {
  return ktec().prepare('SELECT contenu FROM fichiers WHERE categorie = ? AND nom = ?').get(categorie, nom)?.contenu ?? null
}

function supprimerFichierBrut(categorie, nom) {
  ktec().prepare('DELETE FROM fichiers WHERE categorie = ? AND nom = ?').run(categorie, nom)
}

// Les ressources BIRT (bibliothèques, feuilles de style…) recopiées dans un dossier, pour le moteur BIRT.
export function dossierRessources(dossierCache) {
  const dossier = path.join(dossierCache, 'ressources')
  fs.rmSync(dossier, { recursive: true, force: true })
  fs.mkdirSync(dossier, { recursive: true })
  for (const { nom, contenu } of ktec().prepare("SELECT nom, contenu FROM fichiers WHERE categorie = 'ressources'").all()) {
    fs.writeFileSync(path.join(dossier, path.basename(nom)), contenu)
  }
  return dossier
}

// ---------------------------------------------------------------- écritures (verrou puis publication)

export const ecrireInfo = (...args) => ecrire(() => ecrireInfoBrut(...args))
export const enregistrerIndicateur = (...args) => ecrire(() => enregistrerIndicateurBrut(...args))
export const supprimerIndicateur = (...args) => ecrire(() => supprimerIndicateurBrut(...args))
export const enregistrerNote = (...args) => ecrire(() => enregistrerNoteBrut(...args))
export const supprimerNote = (...args) => ecrire(() => supprimerNoteBrut(...args))
export const enregistrerTables = (...args) => ecrire(() => enregistrerTablesBrut(...args))
export const enregistrerLiens = (...args) => ecrire(() => enregistrerLiensBrut(...args))
export const enregistrerDictionnaire = (...args) => ecrire(() => enregistrerDictionnaireBrut(...args))
export const enregistrerLienDictionnaire = (...args) => ecrire(() => enregistrerLienDictionnaireBrut(...args))
export const ajouterLien = (...args) => ecrire(() => ajouterLienBrut(...args))
export const enregistrerRequete = (...args) => ecrire(() => enregistrerRequeteBrut(...args))
export const supprimerRequete = (...args) => ecrire(() => supprimerRequeteBrut(...args))
export const enregistrerFichier = (...args) => ecrire(() => enregistrerFichierBrut(...args))
export const supprimerFichier = (...args) => ecrire(() => supprimerFichierBrut(...args))
