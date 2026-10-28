// L'assistant de requêtes (réservé à l'administrateur) : de quoi construire une requête de lecture sans écrire de
// SQL. La structure de la base (tables, colonnes, liens) vient du fichier de connaissances ; l'aperçu passe par le
// moteur Java en lecture seule ; l'IA peut proposer les correspondances champ ↔ colonne.
// L'écran est dans interface/socle/requeteur.js (assistant guidé, blocs, SQL en mode expert).

import { ErreurHttp } from './socle/http.js'
import { lireTables, lireLiens, lireDictionnaire } from './socle/ktec.js'
import { executerRequete } from './socle/mysql.js'
import { discuter, iaInstallee } from './socle/ia.js'

// La structure, sans les tables écartées dans le dictionnaire : { tables: [{ nom, libelle, colonnes: [{ nom, type, libelle }] }], liens }
function structure() {
  const dico = lireDictionnaire()
  const tables = lireTables()
    .filter((t) => !dico.tables.get(t.nom.toLowerCase())?.exclue)
    .map((t) => ({
      nom: t.nom,
      libelle: dico.tables.get(t.nom.toLowerCase())?.libelle || t.commentaire || '',
      colonnes: t.colonnes.map((c) => ({ nom: c.nom, type: c.type, libelle: dico.colonnes.get(`${t.nom}.${c.nom}`.toLowerCase())?.libelle || c.commentaire || '' })),
    }))
  const noms = new Set(tables.map((t) => t.nom))
  const liens = lireLiens().filter((l) => noms.has(l.deTable) && noms.has(l.versTable)).map(({ deTable, deColonne, versTable, versColonne }) => ({ deTable, deColonne, versTable, versColonne }))
  return { tables, liens }
}

const CONSIGNES = `Tu aides un administrateur de GMAO à écrire une requête de lecture. On te donne les champs attendus par une application (nom, libellé, aide) et des tables de la base avec leurs colonnes.
Choisis la table de départ (une ligne de résultat par ligne de cette table) et, pour chaque champ, la colonne qui lui correspond (« table.colonne »), dans la table de départ ou dans une table liée. Laisse vide un champ sans colonne évidente : n'invente rien.
Réponds seulement avec un objet JSON, sans texte autour :
{"depart":"table","champs":{"champ":"table.colonne"},"remarque":"une phrase au plus"}`

// Les tables les plus probables pour ces champs (mots communs avec les noms et libellés), pour garder la demande courte.
function tablesProbables(s, champs, consigne, nombre = 25) {
  const mots = (texte) => new Set(String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((m) => m.length > 2))
  const voulus = mots([consigne, ...champs.map((c) => `${c.nom} ${c.libelle} ${c.aide || ''}`)].join(' '))
  const score = (t) => {
    const leurs = mots(`${t.nom} ${t.libelle} ${t.colonnes.map((c) => `${c.nom} ${c.libelle}`).join(' ')}`)
    let n = 0
    for (const m of voulus) if (leurs.has(m)) n++
    return n + (voulus.has(t.nom.toLowerCase()) ? 5 : 0)
  }
  return [...s.tables].map((t) => ({ t, n: score(t) })).sort((a, b) => b.n - a.n).slice(0, nombre).map((x) => x.t)
}

function lireJson(texte) {
  const debut = texte.indexOf('{')
  const fin = texte.lastIndexOf('}')
  try {
    return debut < 0 ? null : JSON.parse(texte.slice(debut, fin + 1))
  } catch {
    return null
  }
}

export function routes(r) {
  r.get('/api/ktec/requeteur/structure', (ctx) => {
    ctx.exigerModeAdmin()
    return structure()
  })

  // { sql } → les 20 premières lignes (le moteur refuse tout ce qui n'est pas une lecture).
  r.post('/api/ktec/requeteur/apercu', async (ctx) => {
    ctx.exigerModeAdmin()
    const { sql = '' } = await ctx.json()
    if (!String(sql).trim()) throw new ErreurHttp(400, 'Requête vide.')
    return executerRequete(String(sql).replace(/^\s*--[^\n]*$/gm, ''), 20)
  })

  // { champs: [{ nom, libelle, aide }], depart, consigne } → { depart, champs: { nom: 'table.colonne' }, remarque }
  r.post('/api/ktec/requeteur/proposer', async (ctx) => {
    ctx.exigerModeAdmin()
    if (!iaInstallee()) throw new ErreurHttp(409, 'L’IA n’est pas installée sur ce poste.')
    const { champs = [], depart = '', consigne = '' } = await ctx.json()
    const s = structure()
    const candidates = tablesProbables(s, champs, `${consigne} ${depart}`)
    if (depart && !candidates.some((t) => t.nom === depart)) candidates.unshift(...s.tables.filter((t) => t.nom === depart))
    const noms = new Set(candidates.map((t) => t.nom))
    const texte = [
      `Ce que l’application attend${consigne ? ` (${consigne})` : ''} :`,
      ...champs.map((c) => `- ${c.nom} : ${c.libelle}${c.aide ? ` (${c.aide})` : ''}`),
      depart ? `Table de départ déjà choisie : ${depart}` : '',
      '', 'Tables :',
      ...candidates.map((t) => `${t.nom}${t.libelle ? ` (${t.libelle})` : ''} : ${t.colonnes.map((c) => `${c.nom}${c.libelle ? `=${c.libelle}` : ''}`).join(', ').slice(0, 900)}`),
      '', 'Liens :',
      ...s.liens.filter((l) => noms.has(l.deTable) && noms.has(l.versTable)).slice(0, 120).map((l) => `${l.deTable}.${l.deColonne} → ${l.versTable}.${l.versColonne}`),
    ].join('\n')
    const reponse = await discuter([{ role: 'system', content: CONSIGNES }, { role: 'user', content: texte }], { temperature: 0.1, maxMots: 800 })
    const lu = lireJson(reponse)
    if (!lu) throw new ErreurHttp(502, 'Réponse de l’IA illisible : réessayez.')
    // On ne garde que des colonnes qui existent vraiment (sans tenir compte de la casse ; « colonne » seule = table de départ).
    const departLu = s.tables.find((t) => t.nom.toLowerCase() === String(lu.depart || depart).toLowerCase())?.nom || depart
    const reconnaitre = (ref) => {
      const morceaux = String(ref || '').split('.')
      const [table, colonne] = morceaux.length > 1 ? morceaux : [departLu, morceaux[0]]
      const t = s.tables.find((x) => x.nom.toLowerCase() === String(table).toLowerCase())
      const c = t?.colonnes.find((x) => x.nom.toLowerCase() === String(colonne).toLowerCase())
      return c ? `${t.nom}.${c.nom}` : null
    }
    lu.depart = departLu
    lu.champs = Object.fromEntries(Object.entries(lu.champs || {}).map(([nom, ref]) => [nom, reconnaitre(ref)]).filter(([, ref]) => ref))
    const existe = Boolean
    return {
      depart: s.tables.some((t) => t.nom === lu.depart) ? lu.depart : depart,
      champs: Object.fromEntries(Object.entries(lu.champs || {}).filter(([nom, ref]) => champs.some((c) => c.nom === nom) && existe(ref))),
      remarque: String(lu.remarque || '').slice(0, 300),
    }
  })
}
