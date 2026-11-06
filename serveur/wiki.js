// Le wiki de K.NOVA : une seule page (/wiki/) qui guide sur tous les écrans de toutes les applications.
//
// Les pages livrées avec le logiciel sont de simples fichiers HTML : interface/wiki/pages/ pour K.NOVA,
// interface/wiki/ de chaque application. Chacun a son sommaire (sommaire.json) :
//   { "sections": [ { "titre": "…", "pages": [ { "id", "titre", "ecran"?, "admin"?, "mots"? } ] } ] }
// ecran : le chemin de l'écran dans l'application (#/<ecran>), pour le lien « Ouvrir l'écran ».
// admin : la page parle d'un réglage réservé à l'administrateur (pastille « Admin » dans le sommaire).
//
// Les notes du site (procédures internes, précisions) sont écrites par l'administrateur et rangées dans le
// fichier de connaissances (« ktec.wiki_notes ») : elles ne sont jamais dans le logiciel.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ErreurHttp } from './socle/http.js'
import { lireInfo, ecrireInfo } from './socle/ktec.js'
import { applis } from './socle/applis.js'
import { chemins } from './socle/installation.js'

const CLE_NOTES = 'ktec.wiki_notes'
const TEXTE_MAX = 20_000

function lireSommaire(fichier) {
  try {
    return JSON.parse(fs.readFileSync(fichier, 'utf8'))
  } catch {
    return { sections: [] }
  }
}

// Les notes : illisibles sans fichier de connaissances (ou sans sa clé), le wiki reste alors sans elles.
function lireNotes() {
  try {
    return lireInfo(CLE_NOTES, []) || []
  } catch {
    return []
  }
}

export function routes(r) {
  // Le sommaire de K.NOVA puis celui de chaque application installée, et les notes du site.
  r.get('/api/ktec/wiki', (ctx) => ({
    livres: [
      { id: 'ktec', nom: 'K.NOVA', couleur: '#a855f7', icone: '/icone.svg', base: '/wiki/pages/', ...lireSommaire(path.join(chemins.interface, 'wiki', 'pages', 'sommaire.json')) },
      ...[...applis().values()]
        .filter((a) => fs.existsSync(path.join(a.dossier, 'interface', 'wiki', 'sommaire.json')))
        .map((a) => ({ id: a.id, nom: a.nom, couleur: a.couleur, icone: `/apps/${a.id}/${a.icone || 'interface/icone.svg'}`, base: `/apps/${a.id}/interface/wiki/`, ...lireSommaire(path.join(a.dossier, 'interface', 'wiki', 'sommaire.json')) })),
    ],
    notes: lireNotes(),
    modeAdmin: ctx.modeAdmin,
  }))

  // Ajouter, modifier ou supprimer une note du site (administrateur : c'est une écriture dans le .ktec).
  // { id?, page?, titre, texte, admin?, supprimer? }
  r.post('/api/ktec/wiki/notes', async (ctx) => {
    ctx.exigerModeAdmin()
    ctx.exigerAdmin()
    const corps = await ctx.json()
    const notes = lireNotes()
    if (corps.supprimer) {
      ecrireInfo(CLE_NOTES, notes.filter((n) => n.id !== corps.id))
      return { notes: lireNotes() }
    }
    const titre = String(corps.titre || '').trim().slice(0, 200)
    const texte = String(corps.texte || '').slice(0, TEXTE_MAX)
    if (!titre) throw new ErreurHttp(400, 'Donnez un titre à la note.')
    // page : « appli/page » d'une page du wiki, ou rien pour une page à part (rubrique « Notes du site »).
    const page = /^[a-z0-9-]+\/[a-z0-9-]+$/.test(String(corps.page || '')) ? corps.page : null
    const note = { id: corps.id || crypto.randomUUID(), page, titre, texte, admin: Boolean(corps.admin), modifieeLe: new Date().toISOString() }
    const i = notes.findIndex((n) => n.id === note.id)
    if (i >= 0) notes[i] = { ...notes[i], ...note }
    else notes.push({ ...note, creeeLe: note.modifieeLe })
    ecrireInfo(CLE_NOTES, notes)
    return { note, notes: lireNotes() }
  })
}
