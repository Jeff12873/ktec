// Les nouveautés d'une mise à jour : les points des versions plus récentes que celle installée.
// « 0.4.2 » (copié du kit) et « 0.4.2.7 » (numéro de publication) sont la même version : seuls les trois
// premiers nombres comptent.

import { h } from './ui.js'

const base = (v) => String(v || '').split('.').slice(0, 3).map((n) => Number(n) || 0)

export function plusRecente(a, b) {
  const x = base(a), y = base(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

// Les points à montrer (les plus récents d'abord), sans doublon, limités pour rester un résumé.
export function pointsNouveaux(nouveautes = [], installee, max = 6) {
  const points = nouveautes.filter((n) => !installee || plusRecente(n.version, installee)).flatMap((n) => n.points || [])
  return [...new Set(points)].slice(0, max)
}

// L'encart : « BiRTEC 0.9.0 » puis ses nouveautés en liste.
export function encartNouveautes(lignes) {
  const utiles = lignes.filter((l) => l.points.length)
  if (!utiles.length) return null
  return h('div', { class: 'encart-nouveautes' },
    utiles.map((l) => h('div', { class: 'nouveautes-appli' },
      h('strong', {}, `${l.nom} ${String(l.version).split('.').slice(0, 3).join('.')}`),
      h('ul', {}, l.points.map((p) => h('li', {}, p))))))
}
