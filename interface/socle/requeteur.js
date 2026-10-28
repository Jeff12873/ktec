// L'assistant de requêtes (administrateur) : construire une requête de lecture sans écrire de SQL.
//
//   ouvrirRequeteur({ titre, champs: [{ nom, libelle, obligatoire, aide }], sql, consigne }) → le SQL, ou null
//
// Trois façons de faire, sur le même « plan » :
//   - l'assistant guidé : la table de départ, puis une colonne pour chaque champ attendu (les jointures sont
//     trouvées d'après les liens connus du fichier de connaissances), et des conditions simples ;
//   - les blocs (Blockly) : les mêmes éléments à emboîter, avec en plus les groupes « l'une de ces conditions » ;
//   - le SQL, en mode expert : modifié à la main, il ne se rouvre plus dans l'assistant ni dans les blocs.
// Le plan est gardé dans la première ligne du SQL (un commentaire « -- ktec-requeteur … ») : la requête se rouvre
// telle qu'on l'a construite. L'aperçu montre les 20 premières lignes ; « Proposer » demande à l'IA les colonnes.

import { h, vider, ic, fenetre, notifier, essayer } from './ui.js'
import { api } from './api.js'

const MARQUE = '-- ktec-requeteur '
const OPERATEURS = [
  ['=', 'égal à'], ['<>', 'différent de'], ['>', 'plus grand que'], ['>=', 'au moins'], ['<', 'plus petit que'], ['<=', 'au plus'],
  ['contient', 'contient'], ['commence', 'commence par'], ['dans', 'dans la liste (a, b, c)'], ['vide', 'est vide'], ['rempli', 'n’est pas vide'],
]
const SANS_VALEUR = new Set(['vide', 'rempli'])

let structure = null
async function lireStructure() {
  structure ??= await api('/api/ktec/requeteur/structure')
  return structure
}

// ---------------------------------------------------------------- du plan au SQL

const id = (nom) => `\`${String(nom).replace(/`/g, '')}\``
const litteral = (v) => (/^-?\d+(\.\d+)?$/.test(String(v).trim()) ? String(v).trim() : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`)

// Le chemin de la table de départ vers chaque table (liens connus, dans les deux sens) : Map(table → { parent, de, vers }).
function chemins(depart, liens) {
  const voisins = new Map()
  const ajouter = (a, b, colA, colB) => (voisins.get(a) || voisins.set(a, []).get(a)).push({ table: b, colA, colB })
  for (const l of liens) {
    ajouter(l.deTable, l.versTable, l.deColonne, l.versColonne)
    ajouter(l.versTable, l.deTable, l.versColonne, l.deColonne)
  }
  const vus = new Map([[depart, null]])
  const file = [depart]
  while (file.length) {
    const t = file.shift()
    for (const v of voisins.get(t) || []) {
      if (vus.has(v.table)) continue
      vus.set(v.table, { parent: t, colParent: v.colA, col: v.colB })
      file.push(v.table)
    }
  }
  return vus
}

// Les tables proches de la table de départ (pour les listes de colonnes) : elle-même et ses voisines à 2 liens.
function tablesProches(depart, s, profondeur = 2) {
  const c = chemins(depart, s.liens)
  const niveau = (t) => { let n = 0; let x = t; while (c.get(x)) { x = c.get(x).parent; n++ } return n }
  return s.tables.filter((t) => c.has(t.nom) && niveau(t.nom) <= profondeur).sort((a, b) => niveau(a.nom) - niveau(b.nom) || a.nom.localeCompare(b.nom))
}

function conditionSql(c, ref) {
  if (c.ou) return c.ou.length ? `(${c.ou.map((x) => conditionSql(x, ref)).join(' OR ')})` : ''
  if (c.et) return c.et.length ? `(${c.et.map((x) => conditionSql(x, ref)).join(' AND ')})` : ''
  const col = ref(c.colonne)
  if (!col) return ''
  switch (c.op) {
    case 'contient': return `${col} LIKE ${litteral(`%${c.valeur}%`)}`
    case 'commence': return `${col} LIKE ${litteral(`${c.valeur}%`)}`
    case 'dans': return `${col} IN (${String(c.valeur).split(',').map((x) => litteral(x.trim())).join(', ')})`
    case 'vide': return `(${col} IS NULL OR ${col} = '')`
    case 'rempli': return `(${col} IS NOT NULL AND ${col} <> '')`
    default: return `${col} ${OPERATEURS.some(([o]) => o === c.op) ? c.op : '='} ${litteral(c.valeur ?? '')}`
  }
}

// { depart, champs: { nom: 'table.colonne' }, conditions: { et: [...] } } → { sql, erreurs }
export function genererSql(plan, s, champs) {
  const erreurs = []
  if (!plan.depart) return { sql: '', erreurs: ['Choisissez la table de départ.'] }
  const c = chemins(plan.depart, s.liens)
  const alias = new Map([[plan.depart, 't0']])
  const jointures = []
  const joindre = (table) => {
    if (alias.has(table)) return alias.get(table)
    const pas = c.get(table)
    if (!pas) return null
    const parent = joindre(pas.parent)
    const a = `t${alias.size}`
    alias.set(table, a)
    jointures.push(`LEFT JOIN ${id(table)} ${a} ON ${a}.${id(pas.col)} = ${parent}.${id(pas.colParent)}`)
    return a
  }
  const ref = (texte) => {
    const [table, colonne] = String(texte || '').split('.')
    if (!table || !colonne) return null
    const a = joindre(table)
    if (!a) { erreurs.push(`Aucun lien connu entre ${plan.depart} et ${table}.`); return null }
    return `${a}.${id(colonne)}`
  }
  const selection = champs.filter((x) => plan.champs[x.nom]).map((x) => `${ref(plan.champs[x.nom])} AS ${x.nom}`).filter((x) => !x.startsWith('null'))
  for (const x of champs) if (x.obligatoire && !plan.champs[x.nom]) erreurs.push(`Champ obligatoire sans colonne : ${x.libelle}.`)
  if (!selection.length) return { sql: '', erreurs: [...erreurs, 'Choisissez au moins une colonne.'] }
  const ou = conditionSql(plan.conditions || { et: [] }, ref)
  const sql = [`SELECT ${selection.join(',\n       ')}`, `FROM ${id(plan.depart)} t0`, ...jointures, ou ? `WHERE ${ou.replace(/^\((.*)\)$/s, '$1')}` : ''].filter(Boolean).join('\n')
  return { sql, erreurs }
}

const avecPlan = (plan, sql) => `${MARQUE}${JSON.stringify(plan)}\n${sql}`
// Le plan d'une requête faite par l'assistant, si elle n'a pas été retouchée à la main.
function lirePlan(sql, s, champs) {
  const ligne = String(sql || '').split('\n')[0]
  if (!ligne.startsWith(MARQUE)) return null
  try {
    const plan = JSON.parse(ligne.slice(MARQUE.length))
    const corps = String(sql).split('\n').slice(1).join('\n').trim()
    return { plan, retouche: corps !== genererSql(plan, s, champs).sql.trim() }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- la fenêtre

export async function ouvrirRequeteur({ titre = 'Assistant de requête', champs = [], sql = '', consigne = '' }) {
  let s
  try {
    s = await lireStructure()
  } catch (e) {
    notifier(e.message, 'erreur')
    return null
  }
  if (!s.tables.length) {
    notifier('La structure de la base n’est pas encore dans le fichier de connaissances (BiRTEC › Base, ou la constellation des tables).', 'erreur')
    return null
  }
  const lu = lirePlan(sql, s, champs)
  let plan = lu?.plan || { v: 1, depart: '', champs: {}, conditions: { et: [] } }
  let expert = Boolean(String(sql).trim()) && (!lu || lu.retouche) // SQL écrit (ou retouché) à la main
  let onglet = expert ? 'sql' : 'assistant'
  const onglets = h('div', { class: 'segments', style: { marginBottom: '12px' } })
  const corps = h('div', { class: 'corps-requeteur' })
  const zoneSql = h('textarea', { class: 'sql', rows: 12, spellcheck: false }, expert ? String(sql).replace(/^-- ktec-requeteur [^\n]*\n/, '') : '')
  const apercu = h('div', { class: 'apercu-requeteur' })
  const bandeau = h('div')
  let minuterie = null
  let blocs = null // l'espace de travail Blockly, une fois ouvert

  const sqlCourant = () => (expert ? zoneSql.value.trim() : genererSql(plan, s, champs).sql)
  const changer = () => {
    if (!expert) zoneSql.value = genererSql(plan, s, champs).sql
    clearTimeout(minuterie)
    minuterie = setTimeout(previsualiser, 700)
  }

  async function previsualiser() {
    const { erreurs } = expert ? { erreurs: [] } : genererSql(plan, s, champs)
    vider(bandeau, erreurs.length ? h('div', { class: 'bandeau' }, ic('alerte'), erreurs.join(' ')) : null)
    const texte = sqlCourant()
    if (!texte) return vider(apercu)
    vider(apercu, h('p', { class: 'discret curseur' }, 'Lecture des 20 premières lignes'))
    try {
      const r = await api('/api/ktec/requeteur/apercu', { methode: 'POST', corps: { sql: texte } })
      const manquants = champs.filter((x) => x.obligatoire && !r.colonnes.some((c) => c.nom.toLowerCase() === x.nom.toLowerCase()))
      vider(apercu,
        manquants.length ? h('div', { class: 'bandeau', style: { marginBottom: '8px' } }, ic('alerte'), `Colonnes attendues absentes : ${manquants.map((x) => x.nom).join(', ')}.`) : null,
        h('div', { class: 'tableau-conteneur', style: { maxHeight: '32vh' } }, h('table', { class: 'tableau compact' },
          h('thead', {}, h('tr', {}, r.colonnes.map((c) => h('th', {}, c.nom)))),
          h('tbody', {}, r.lignes.map((l) => h('tr', {}, l.map((v) => h('td', {}, v === null ? '—' : String(v).slice(0, 80)))))))),
        h('p', { class: 'discret', style: { fontSize: '12px' } }, `${r.lignes.length} ligne${r.lignes.length > 1 ? 's' : ''} affichée${r.lignes.length > 1 ? 's' : ''}${r.tronque ? ' (il y en a d’autres)' : ''} · ${r.dureeMs} ms`))
    } catch (e) {
      vider(apercu, h('div', { class: 'bandeau' }, ic('alerte'), e.message))
    }
  }

  // ---- assistant guidé
  function dessinerAssistant() {
    const listeTables = h('datalist', { id: 'requeteur-tables' }, s.tables.map((t) => h('option', { value: t.nom }, t.libelle)))
    const depart = h('input', { type: 'text', value: plan.depart, list: 'requeteur-tables', placeholder: 'ex. la table des machines, des interventions…' })
    depart.addEventListener('change', () => {
      if (!s.tables.some((t) => t.nom === depart.value)) return notifier('Table inconnue.', 'erreur')
      plan = { ...plan, depart: depart.value, champs: {} }
      dessinerAssistant()
      changer()
    })
    const proches = plan.depart ? tablesProches(plan.depart, s) : []
    const options = (valeur) => [h('option', { value: '' }, '— rien —'),
      ...proches.map((t) => h('optgroup', { label: `${t.nom}${t.libelle ? ` — ${t.libelle}` : ''}` }, t.colonnes.map((c) => h('option', { value: `${t.nom}.${c.nom}`, selected: valeur === `${t.nom}.${c.nom}` }, `${c.nom}${c.libelle ? ` — ${c.libelle}` : ''}`)))),
      // Une colonne plus lointaine (proposée par l'IA) reste visible.
      valeur && !proches.some((t) => valeur.startsWith(`${t.nom}.`)) ? h('option', { value: valeur, selected: true }, valeur) : null]
    const lignesChamps = champs.map((x) => {
      const select = h('select', {}, options(plan.champs[x.nom] || ''))
      select.addEventListener('change', () => { plan.champs[x.nom] = select.value; if (!select.value) delete plan.champs[x.nom]; changer() })
      return h('div', { class: 'ligne-requeteur' }, h('div', {}, h('b', {}, x.libelle || x.nom), x.obligatoire ? h('span', { class: 'rouge' }, ' *') : null, x.aide ? h('div', { class: 'discret', style: { fontSize: '12px' } }, x.aide) : null), select)
    })
    const conditions = plan.conditions?.et || []
    const complexes = conditions.some((c) => c.ou || c.et)
    const toutesColonnes = proches.flatMap((t) => t.colonnes.map((c) => `${t.nom}.${c.nom}`))
    const ligneCondition = (c, i) => {
      const col = h('select', { class: 'fin' }, toutesColonnes.map((v) => h('option', { value: v, selected: v === c.colonne }, v)))
      const op = h('select', { class: 'fin' }, OPERATEURS.map(([v, t]) => h('option', { value: v, selected: v === c.op }, t)))
      const valeur = h('input', { type: 'text', value: c.valeur ?? '', disabled: SANS_VALEUR.has(c.op) })
      const maj = () => { conditions[i] = { colonne: col.value, op: op.value, valeur: valeur.value }; valeur.disabled = SANS_VALEUR.has(op.value); changer() }
      col.onchange = maj; op.onchange = maj; valeur.oninput = maj
      return h('div', { class: 'condition-requeteur' }, col, op, valeur, h('button', { class: 'discret icone-seule petit', title: 'Retirer', onclick: () => { conditions.splice(i, 1); plan.conditions = { et: conditions }; dessinerAssistant(); changer() } }, ic('x', 14)))
    }
    vider(corps, listeTables,
      h('label', { class: 'champ' }, h('span', {}, 'Table de départ (une ligne de résultat par ligne de cette table)'), depart),
      plan.depart ? [
        h('h3', {}, 'Les champs attendus'),
        h('div', { class: 'champs-requeteur' }, lignesChamps),
        h('h3', {}, 'Conditions (toutes à la fois)'),
        complexes ? h('p', { class: 'discret' }, 'Ces conditions ont été faites avec les blocs (groupes « l’une de ces conditions ») : modifiez-les dans l’onglet Blocs.')
          : [conditions.map(ligneCondition), h('button', { class: 'petit', onclick: () => { conditions.push({ colonne: toutesColonnes[0], op: '=', valeur: '' }); plan.conditions = { et: conditions }; dessinerAssistant() } }, ic('plus', 14), 'Une condition')],
      ] : null)
  }

  // ---- blocs
  async function dessinerBlocs() {
    if (!plan.depart) {
      return vider(corps, h('p', { class: 'discret' }, 'Choisissez d’abord la table de départ dans l’assistant (ou faites proposer les colonnes par l’IA).'))
    }
    const zone = h('div', { class: 'blockly-requeteur' })
    vider(corps, zone)
    try {
      await chargerBlockly()
    } catch (e) {
      return vider(corps, h('div', { class: 'bandeau' }, ic('alerte'), `Blocs indisponibles : ${e.message}`))
    }
    blocs?.dispose?.()
    blocs = creerEspace(zone, plan, s, champs, (nouveau) => { plan = nouveau; changer() })
  }

  // ---- SQL (expert)
  function dessinerSql() {
    vider(corps,
      h('p', { class: 'discret', style: { marginTop: 0 } }, expert ? 'Requête écrite ou retouchée à la main : elle ne se rouvre plus dans l’assistant ni dans les blocs.' : 'Le SQL construit par l’assistant. Le modifier ici le fait passer en mode expert.'),
      zoneSql,
      expert && plan.depart ? h('button', { class: 'petit discret', onclick: () => { expert = false; montrer('assistant'); changer() } }, ic('retour', 14), 'Revenir à la requête de l’assistant (les retouches sont perdues)') : null)
  }
  zoneSql.addEventListener('input', () => {
    if (!expert) { expert = true; notifier('Mode expert : la requête ne se rouvrira plus dans l’assistant.') }
    clearTimeout(minuterie)
    minuterie = setTimeout(previsualiser, 900)
  })

  function montrer(nom) {
    onglet = nom
    vider(onglets, [['assistant', 'Assistant', 'loupe'], ['blocs', 'Blocs', 'table'], ['sql', 'SQL (expert)', 'console']].map(([cle, texte, icone]) =>
      h('button', { class: cle === onglet ? 'choisi' : '', disabled: expert && cle !== 'sql', onclick: () => montrer(cle) }, ic(icone, 15), texte)))
    if (nom === 'assistant') dessinerAssistant()
    else if (nom === 'blocs') dessinerBlocs()
    else dessinerSql()
  }

  async function proposer(bouton) {
    bouton.disabled = true
    const r = await essayer(() => api('/api/ktec/requeteur/proposer', { methode: 'POST', corps: { champs: champs.map(({ nom, libelle, aide }) => ({ nom, libelle, aide })), depart: plan.depart, consigne } }))
    bouton.disabled = false
    if (!r) return
    plan = { ...plan, depart: r.depart || plan.depart, champs: { ...plan.champs, ...r.champs } }
    expert = false
    notifier(`${Object.keys(r.champs).length} champ${Object.keys(r.champs).length > 1 ? 's' : ''} proposé${Object.keys(r.champs).length > 1 ? 's' : ''} : vérifiez-les.${r.remarque ? ` ${r.remarque}` : ''}`)
    montrer(onglet === 'sql' ? 'assistant' : onglet)
    changer()
  }

  montrer(onglet)
  if (!expert) zoneSql.value = genererSql(plan, s, champs).sql
  previsualiser()
  const resultat = await fenetre({
    titre,
    large: true,
    contenu: h('div', { class: 'requeteur' },
      h('div', { class: 'tete-requeteur' }, onglets, h('div', { style: { flex: 1 } }),
        h('button', { title: 'L’IA propose la table de départ et une colonne pour chaque champ, d’après la structure de la base', onclick: (e) => proposer(e.currentTarget) }, ic('etincelle', 15), 'Proposer')),
      consigne ? h('p', { class: 'texte-2', style: { marginTop: 0 } }, consigne) : null,
      corps, bandeau,
      h('h3', {}, 'Aperçu'), apercu),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Garder cette requête', classe: 'principal', action: () => {
        const texte = sqlCourant()
        if (!texte) throw new Error('La requête est vide.')
        return expert ? texte : avecPlan(plan, texte)
      } },
    ],
  })
  blocs?.dispose?.()
  return resultat || null
}

// ---------------------------------------------------------------- Blockly (chargé à la demande, sans Internet)

let chargement = null
function chargerBlockly() {
  if (window.Blockly?.Blocks?.ktec_requete) return Promise.resolve()
  chargement ??= (async () => {
    const script = (src) => new Promise((ok, echec) => {
      const e = document.createElement('script')
      e.src = src
      e.onload = ok
      e.onerror = () => echec(new Error(`impossible de charger ${src}`))
      document.head.append(e)
    })
    await script('/vendor/blockly/blockly_compressed.js')
    await script('/vendor/blockly/fr.js')
    definirBlocs()
  })()
  return chargement
}

// L'état lu par les listes des blocs (la table de départ choisie, la structure, les champs attendus).
const contexte = { depart: '', s: null, champs: [] }
const couleurs = { requete: 160, champ: 200, condition: 30, groupe: 290 }

function definirBlocs() {
  const B = window.Blockly
  const colonnes = () => {
    const liste = contexte.depart && contexte.s ? tablesProches(contexte.depart, contexte.s).flatMap((t) => t.colonnes.map((c) => [`${t.nom}.${c.nom}`, `${t.nom}.${c.nom}`])) : []
    return liste.length ? liste : [['—', '']]
  }
  B.Blocks.ktec_requete = {
    init() {
      this.appendDummyInput().appendField('Lire chaque ligne de').appendField(new B.FieldDropdown(() => contexte.s.tables.map((t) => [t.nom, t.nom]), (v) => { contexte.depart = v; return v }), 'TABLE')
      this.appendStatementInput('CHAMPS').appendField('champs')
      this.appendStatementInput('CONDITIONS').appendField('seulement si')
      this.setColour(couleurs.requete)
      this.setDeletable(false)
      this.setTooltip('La table de départ : une ligne de résultat par ligne de cette table. Les jointures vers les autres tables sont trouvées toutes seules.')
    },
  }
  B.Blocks.ktec_champ = {
    init() {
      this.appendDummyInput().appendField(new B.FieldDropdown(() => contexte.champs.map((x) => [x.libelle || x.nom, x.nom])), 'CHAMP').appendField('←').appendField(new B.FieldDropdown(colonnes), 'COLONNE')
      this.setPreviousStatement(true, 'champ')
      this.setNextStatement(true, 'champ')
      this.setColour(couleurs.champ)
      this.setTooltip('Un champ attendu par l’application, et la colonne qui le remplit.')
    },
  }
  B.Blocks.ktec_condition = {
    init() {
      this.appendDummyInput().appendField(new B.FieldDropdown(colonnes), 'COLONNE').appendField(new B.FieldDropdown(OPERATEURS.map(([v, t]) => [t, v])), 'OP').appendField(new B.FieldTextInput(''), 'VALEUR')
      this.setPreviousStatement(true, 'condition')
      this.setNextStatement(true, 'condition')
      this.setColour(couleurs.condition)
      this.setTooltip('Une condition sur une colonne (« est vide » et « n’est pas vide » ignorent la valeur).')
    },
  }
  for (const [type, texte, aide] of [['ktec_ou', 'l’une de ces conditions', 'Au moins une des conditions du groupe.'], ['ktec_et', 'toutes ces conditions', 'Toutes les conditions du groupe (dans un groupe « l’une de ces conditions »).']]) {
    B.Blocks[type] = {
      init() {
        this.appendStatementInput('LISTE').setCheck('condition').appendField(texte)
        this.setPreviousStatement(true, 'condition')
        this.setNextStatement(true, 'condition')
        this.setColour(couleurs.groupe)
        this.setTooltip(aide)
      },
    }
  }
}

function creerEspace(zone, plan, s, champs, surChangement) {
  const B = window.Blockly
  Object.assign(contexte, { depart: plan.depart, s, champs })
  const theme = B.Theme.defineTheme('ktec', {
    base: B.Themes.Classic,
    componentStyles: { workspaceBackgroundColour: '#0d1512', toolboxBackgroundColour: '#132019', toolboxForegroundColour: '#d7e5dc', flyoutBackgroundColour: '#132019', flyoutForegroundColour: '#d7e5dc', scrollbarColour: '#2c3d35', insertionMarkerColour: '#fff' },
  })
  const espace = B.inject(zone, {
    media: '/vendor/blockly/media/',
    theme,
    trashcan: true,
    zoom: { controls: true, wheel: true, startScale: 0.9 },
    move: { scrollbars: true, drag: true, wheel: false },
    toolbox: { kind: 'flyoutToolbox', contents: [{ kind: 'block', type: 'ktec_champ' }, { kind: 'block', type: 'ktec_condition' }, { kind: 'block', type: 'ktec_ou' }, { kind: 'block', type: 'ktec_et' }] },
  })
  // Le plan devient des blocs : la requête d'abord (sa table fixe les colonnes proposées), puis ses enfants.
  const nouveau = (type) => { const b = espace.newBlock(type); b.initSvg(); return b }
  const enchainer = (entree, blocsListe) => {
    let precedent = null
    for (const b of blocsListe) {
      if (!precedent) entree.connection.connect(b.previousConnection)
      else precedent.nextConnection.connect(b.previousConnection)
      precedent = b
    }
  }
  const versBlocs = (c) => {
    if (c.ou || c.et) {
      const g = nouveau(c.ou ? 'ktec_ou' : 'ktec_et')
      enchainer(g.getInput('LISTE'), (c.ou || c.et).map(versBlocs))
      return g
    }
    const b = nouveau('ktec_condition')
    b.setFieldValue(c.colonne, 'COLONNE')
    b.setFieldValue(c.op || '=', 'OP')
    b.setFieldValue(String(c.valeur ?? ''), 'VALEUR')
    return b
  }
  const racine = nouveau('ktec_requete')
  racine.setFieldValue(plan.depart, 'TABLE')
  enchainer(racine.getInput('CHAMPS'), champs.filter((x) => plan.champs[x.nom]).map((x) => {
    const b = nouveau('ktec_champ')
    b.setFieldValue(x.nom, 'CHAMP')
    b.setFieldValue(plan.champs[x.nom], 'COLONNE')
    return b
  }))
  enchainer(racine.getInput('CONDITIONS'), (plan.conditions?.et || []).map(versBlocs))
  racine.moveBy(20, 20)
  espace.getAllBlocks(false).forEach((b) => b.render())

  // Les blocs deviennent le plan, à chaque changement.
  const suite = (premier) => { const l = []; for (let b = premier; b; b = b.getNextBlock()) l.push(b); return l }
  const versCondition = (b) => (b.type === 'ktec_condition' ? { colonne: b.getFieldValue('COLONNE'), op: b.getFieldValue('OP'), valeur: b.getFieldValue('VALEUR') }
    : { [b.type === 'ktec_ou' ? 'ou' : 'et']: suite(b.getInputTargetBlock('LISTE')).map(versCondition) })
  espace.addChangeListener((e) => {
    if (e.isUiEvent) return
    const champsPlan = {}
    for (const b of suite(racine.getInputTargetBlock('CHAMPS'))) if (b.getFieldValue('COLONNE')) champsPlan[b.getFieldValue('CHAMP')] = b.getFieldValue('COLONNE')
    surChangement({ v: 1, depart: racine.getFieldValue('TABLE'), champs: champsPlan, conditions: { et: suite(racine.getInputTargetBlock('CONDITIONS')).map(versCondition) } })
  })
  return espace
}
