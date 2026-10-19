// Lecture et fabrication des fichiers ZIP, sans bibliothèque.
//
// Sert à :
//   - lire les documents Office et LibreOffice (.docx, .xlsx, .pptx, .odt, .ods), qui sont des ZIP ;
//   - décompresser llama.cpp sous Windows ;
//   - appliquer une mise à jour de KTEC ou d'une application ;
//   - fabriquer l'archive d'une extraction de tables (creerZip).
//
// Seules les deux méthodes de compression courantes sont gérées : « stockée » et « deflate ».

import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

// Renvoie la liste des fichiers du ZIP : [{ nom, lire() → Buffer }]
export function lireZip(octets) {
  const fin = chercherFinDuRepertoire(octets)
  const nombre = octets.readUInt16LE(fin + 10)
  let position = octets.readUInt32LE(fin + 16)
  const fichiers = []

  for (let i = 0; i < nombre; i++) {
    if (octets.readUInt32LE(position) !== 0x02014b50) throw new Error('ZIP abîmé')
    const methode = octets.readUInt16LE(position + 10)
    const tailleCompressee = octets.readUInt32LE(position + 20)
    const longueurNom = octets.readUInt16LE(position + 28)
    const longueurExtra = octets.readUInt16LE(position + 30)
    const longueurCommentaire = octets.readUInt16LE(position + 32)
    const debutLocal = octets.readUInt32LE(position + 42)
    const nom = octets.toString('utf8', position + 46, position + 46 + longueurNom)

    fichiers.push({
      nom,
      lire() {
        // L'en-tête local peut avoir des champs de longueur différente de ceux du répertoire.
        const debutDonnees = debutLocal + 30 + octets.readUInt16LE(debutLocal + 26) + octets.readUInt16LE(debutLocal + 28)
        const donnees = octets.subarray(debutDonnees, debutDonnees + tailleCompressee)
        if (methode === 0) return Buffer.from(donnees)
        if (methode === 8) return zlib.inflateRawSync(donnees)
        throw new Error(`Compression non gérée (${methode}) pour ${nom}`)
      },
    })
    position += 46 + longueurNom + longueurExtra + longueurCommentaire
  }
  return fichiers
}

function chercherFinDuRepertoire(octets) {
  // La signature de fin se trouve dans les derniers 64 Ko (commentaire éventuel compris).
  for (let i = octets.length - 22; i >= Math.max(0, octets.length - 65558); i--) {
    if (octets.readUInt32LE(i) === 0x06054b50) return i
  }
  throw new Error("Ce fichier n'est pas un ZIP valide")
}

// Raccourci : contenu texte d'un fichier précis du ZIP (ou null s'il n'existe pas).
export function lireTexteDansZip(fichiers, nom) {
  const fichier = fichiers.find((f) => f.nom === nom)
  return fichier ? fichier.lire().toString('utf8') : null
}

// Décompresse tout le ZIP dans un dossier. « garder(nom) » permet d'ignorer certains fichiers.
export function decompresser(octets, dossier, garder = () => true) {
  for (const fichier of lireZip(octets)) {
    if (fichier.nom.endsWith('/') || !garder(fichier.nom)) continue
    const destination = path.join(dossier, fichier.nom)
    if (!destination.startsWith(path.resolve(dossier))) continue // protection contre « ../ »
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, fichier.lire())
  }
}

// Fabrique un fichier .zip à partir de [{ nom, octets }] (compression « deflate », noms en UTF-8).
export function creerZip(fichiers) {
  const locaux = []
  const centraux = []
  let decalage = 0
  const maintenant = new Date()
  const heure = (maintenant.getHours() << 11) | (maintenant.getMinutes() << 5) | (maintenant.getSeconds() >> 1)
  const jour = ((maintenant.getFullYear() - 1980) << 9) | ((maintenant.getMonth() + 1) << 5) | maintenant.getDate()
  for (const f of fichiers) {
    const nom = Buffer.from(f.nom, 'utf8')
    const brut = Buffer.isBuffer(f.octets) ? f.octets : Buffer.from(f.octets)
    const compresse = zlib.deflateRawSync(brut)
    const crc = zlib.crc32(brut)
    const entete = Buffer.alloc(30)
    entete.writeUInt32LE(0x04034b50, 0)
    entete.writeUInt16LE(20, 4) // version nécessaire
    entete.writeUInt16LE(0x0800, 6) // noms en UTF-8
    entete.writeUInt16LE(8, 8) // deflate
    entete.writeUInt16LE(heure, 10)
    entete.writeUInt16LE(jour, 12)
    entete.writeUInt32LE(crc, 14)
    entete.writeUInt32LE(compresse.length, 18)
    entete.writeUInt32LE(brut.length, 22)
    entete.writeUInt16LE(nom.length, 26)
    entete.writeUInt16LE(0, 28)
    locaux.push(entete, nom, compresse)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version créatrice
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(heure, 12)
    central.writeUInt16LE(jour, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compresse.length, 20)
    central.writeUInt32LE(brut.length, 24)
    central.writeUInt16LE(nom.length, 28)
    central.writeUInt32LE(decalage, 42)
    centraux.push(central, nom)
    decalage += entete.length + nom.length + compresse.length
  }
  const tailleCentral = centraux.reduce((t, b) => t + b.length, 0)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0)
  fin.writeUInt16LE(fichiers.length, 8)
  fin.writeUInt16LE(fichiers.length, 10)
  fin.writeUInt32LE(tailleCentral, 12)
  fin.writeUInt32LE(decalage, 16)
  return Buffer.concat([...locaux, ...centraux, fin])
}

// ---------------------------------------------------------------- gros zip (kit hors ligne)

// Met tout un dossier dans un zip, sans compression et sans le charger en mémoire : pour le kit hors ligne
// (plusieurs Go, des modèles d'IA de plus de 4 Go). Format ZIP64 quand c'est nécessaire, que Windows
// (Explorateur) et Linux (unzip) savent ouvrir. Les fichiers exécutables gardent ce droit sous Linux.
//   prefixe : dossier racine dans le zip (ex. « KTEC-hors-ligne-windows/ »)
// garder(nom) : les entrées du premier niveau à mettre dans le zip (par défaut : toutes).
export async function zipperDossier(source, destination, { prefixe = '', surProgression = () => {}, garder = () => true } = {}) {
  const fichiers = []
  const parcourir = (dossier) => {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      if (dossier === source && !garder(entree.name)) continue
      const chemin = path.join(dossier, entree.name)
      if (entree.isDirectory()) parcourir(chemin)
      else if (entree.isFile()) fichiers.push(chemin)
    }
  }
  parcourir(source)
  const total = fichiers.reduce((t, f) => t + fs.statSync(f).size, 0)
  const MAX = 0xffffffff
  const maintenant = new Date()
  const heure = (maintenant.getHours() << 11) | (maintenant.getMinutes() << 5) | (maintenant.getSeconds() >> 1)
  const jour = ((maintenant.getFullYear() - 1980) << 9) | ((maintenant.getMonth() + 1) << 5) | maintenant.getDate()
  const fd = fs.openSync(destination, 'w')
  const tampon = Buffer.alloc(8 * 1024 * 1024)
  const centraux = []
  let position = 0
  let fait = 0
  const ecrire = (b) => {
    fs.writeSync(fd, b, 0, b.length, position)
    position += b.length
  }
  try {
    for (const fichier of fichiers) {
      const infos = fs.statSync(fichier)
      const taille = infos.size
      const nom = Buffer.from(prefixe + path.relative(source, fichier).split(path.sep).join('/'), 'utf8')
      const gros = taille >= MAX
      const debut = position
      // En-tête local (le CRC est écrit après coup, une fois le fichier lu).
      const extraLocal = gros ? Buffer.alloc(20) : Buffer.alloc(0)
      if (gros) {
        extraLocal.writeUInt16LE(0x0001, 0)
        extraLocal.writeUInt16LE(16, 2)
        extraLocal.writeBigUInt64LE(BigInt(taille), 4)
        extraLocal.writeBigUInt64LE(BigInt(taille), 12)
      }
      const entete = Buffer.alloc(30)
      entete.writeUInt32LE(0x04034b50, 0)
      entete.writeUInt16LE(45, 4) // version nécessaire : ZIP64
      entete.writeUInt16LE(0x0800, 6) // noms en UTF-8
      entete.writeUInt16LE(0, 8) // stocké tel quel
      entete.writeUInt16LE(heure, 10)
      entete.writeUInt16LE(jour, 12)
      entete.writeUInt32LE(gros ? MAX : taille, 18)
      entete.writeUInt32LE(gros ? MAX : taille, 22)
      entete.writeUInt16LE(nom.length, 26)
      entete.writeUInt16LE(extraLocal.length, 28)
      ecrire(entete)
      ecrire(nom)
      ecrire(extraLocal)
      let crc = 0
      const entree = fs.openSync(fichier, 'r')
      try {
        for (;;) {
          const lus = fs.readSync(entree, tampon, 0, tampon.length, null)
          if (!lus) break
          const morceau = tampon.subarray(0, lus)
          crc = zlib.crc32(morceau, crc)
          ecrire(morceau)
          fait += lus
          surProgression(fait, total)
        }
      } finally {
        fs.closeSync(entree)
      }
      const crcOctets = Buffer.alloc(4)
      crcOctets.writeUInt32LE(crc >>> 0, 0)
      fs.writeSync(fd, crcOctets, 0, 4, debut + 14)

      // Entrée du répertoire central.
      const loin = debut >= MAX
      const champs64 = [...(gros ? [taille, taille] : []), ...(loin ? [debut] : [])]
      const extraCentral = Buffer.alloc(champs64.length ? 4 + champs64.length * 8 : 0)
      if (champs64.length) {
        extraCentral.writeUInt16LE(0x0001, 0)
        extraCentral.writeUInt16LE(champs64.length * 8, 2)
        champs64.forEach((v, i) => extraCentral.writeBigUInt64LE(BigInt(v), 4 + i * 8))
      }
      const central = Buffer.alloc(46)
      central.writeUInt32LE(0x02014b50, 0)
      central.writeUInt16LE((3 << 8) | 45, 4) // créé « sous Unix » : les droits (exécutable) sont lus
      central.writeUInt16LE(45, 6)
      central.writeUInt16LE(0x0800, 8)
      central.writeUInt16LE(0, 10)
      central.writeUInt16LE(heure, 12)
      central.writeUInt16LE(jour, 14)
      central.writeUInt32LE(crc >>> 0, 16)
      central.writeUInt32LE(gros ? MAX : taille, 20)
      central.writeUInt32LE(gros ? MAX : taille, 24)
      central.writeUInt16LE(nom.length, 28)
      central.writeUInt16LE(extraCentral.length, 30)
      central.writeUInt32LE((((infos.mode & 0o111) ? 0o100755 : 0o100644) << 16) >>> 0, 38)
      central.writeUInt32LE(loin ? MAX : debut, 42)
      centraux.push(central, nom, extraCentral)
    }
    const debutCentral = position
    for (const b of centraux) ecrire(b)
    const tailleCentral = position - debutCentral
    const nombre = fichiers.length
    if (nombre >= 0xffff || debutCentral >= MAX || tailleCentral >= MAX) {
      // Fin de répertoire ZIP64 et son repère.
      const debut64 = position
      const fin64 = Buffer.alloc(56)
      fin64.writeUInt32LE(0x06064b50, 0)
      fin64.writeBigUInt64LE(44n, 4)
      fin64.writeUInt16LE(45, 12)
      fin64.writeUInt16LE(45, 14)
      fin64.writeBigUInt64LE(BigInt(nombre), 24)
      fin64.writeBigUInt64LE(BigInt(nombre), 32)
      fin64.writeBigUInt64LE(BigInt(tailleCentral), 40)
      fin64.writeBigUInt64LE(BigInt(debutCentral), 48)
      ecrire(fin64)
      const repere = Buffer.alloc(20)
      repere.writeUInt32LE(0x07064b50, 0)
      repere.writeBigUInt64LE(BigInt(debut64), 8)
      repere.writeUInt32LE(1, 16)
      ecrire(repere)
    }
    const fin = Buffer.alloc(22)
    fin.writeUInt32LE(0x06054b50, 0)
    fin.writeUInt16LE(Math.min(nombre, 0xffff), 8)
    fin.writeUInt16LE(Math.min(nombre, 0xffff), 10)
    fin.writeUInt32LE(Math.min(tailleCentral, MAX), 12)
    fin.writeUInt32LE(Math.min(debutCentral, MAX), 16)
    ecrire(fin)
  } finally {
    fs.closeSync(fd)
  }
  return { fichiers: fichiers.length, taille: position }
}
