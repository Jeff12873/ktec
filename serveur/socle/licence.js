// La licence du client : un fichier .licence émis et signé par le développeur (Ed25519). Seule la clé publique
// est ici : elle vérifie la signature, elle ne permet pas d'en fabriquer. Changer une lettre du fichier (ajouter
// une application, repousser la date) invalide la signature.
//   { format: 'knova-licence', version, numero, client, applis: ['prevtec'…], emise, fin|null, reseau|null, postes|null, signature }
// Limite : le code tourne sur les postes ; la licence cadre un client honnête, elle n'empêche pas un piratage déterminé.

import crypto from 'node:crypto'

const CLE_PUBLIQUE = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEATBnJ3ps6twlbp1rnPbmCpAd+El5kvEeBrEbaCtcuU2g=
-----END PUBLIC KEY-----
`
const erreur = (message) => Object.assign(new Error(message), { statut: 400 })

// Même mise en forme que l'outil du développeur : clés triées, pour une signature stable.
const canonique = (v) => (Array.isArray(v) ? `[${v.map(canonique).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonique(v[k])}`).join(',')}}` : JSON.stringify(v))

// Le contenu d'une licence dont la signature est bonne ; sinon une erreur qui dit pourquoi.
export function lireLicence(texte) {
  let l
  try {
    l = JSON.parse(String(texte))
  } catch {
    throw erreur('Ce fichier n’est pas une licence K.NOVA.')
  }
  if (l?.format !== 'knova-licence' || !l.signature) throw erreur('Ce fichier n’est pas une licence K.NOVA.')
  const { signature, ...contenu } = l
  let bonne = false
  try {
    bonne = crypto.verify(null, Buffer.from(canonique(contenu)), CLE_PUBLIQUE, Buffer.from(signature, 'base64'))
  } catch {}
  if (!bonne) throw erreur('Licence refusée : elle n’a pas été émise par le développeur, ou elle a été modifiée.')
  return contenu
}

// Le réseau du poste (domaine Windows), lu dans les variables de la session : aucun programme lancé, aucune alerte.
const reseauDuPoste = () => [process.env.USERDNSDOMAIN, process.env.USERDOMAIN].filter(Boolean).map((x) => x.toUpperCase())

// Ce qui empêche la licence de servir ici : '' si elle est en règle.
export function problemeLicence(l) {
  if (l.fin && l.fin < new Date().toISOString().slice(0, 10)) return `Licence expirée depuis le ${l.fin.split('-').reverse().join('/')} : demandez son renouvellement au développeur.`
  if (l.reseau && !reseauDuPoste().includes(l.reseau)) return 'Cette licence a été émise pour un autre site.'
  return ''
}
