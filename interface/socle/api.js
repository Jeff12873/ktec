// Dialogue avec le serveur KTEC.
//
//   await api('/api/machines')                                   → liste (JSON)
//   await api('/api/machines', { methode: 'POST', corps: {…} })  → envoi de JSON
//   await api('/api/documents', { methode: 'POST', fichier })    → envoi d'un fichier
//   await flux('/api/assistant', corps, (type, donnees) => …)    → réponse de l'IA au fil de l'eau
//
// Dans une application (page /birtec/…), « /api/schema » part vers « /api/birtec/schema » :
// chaque application parle à ses propres routes. « /api/ktec/… » (portail, connexion MySQL) reste tel quel.

// L'application de la page (« birtec » pour /birtec/), ou null sur le portail.
export const appli = location.pathname.split('/').filter(Boolean)[0] || null

// L'adresse réelle d'une route (à utiliser aussi pour les liens et les fetch directs).
export function adresse(chemin) {
  if (!appli || !chemin.startsWith('/api/') || chemin.startsWith('/api/ktec/')) return chemin
  return `/api/${appli}/` + chemin.slice('/api/'.length)
}

export async function api(chemin, { methode = 'GET', corps, fichier, entetes = {}, signal } = {}) {
  const options = { method: methode, headers: { 'X-KTEC': '1', ...entetes }, signal }
  if (fichier) {
    options.body = fichier
    options.headers['Content-Type'] = fichier.type || 'application/octet-stream'
  } else if (corps !== undefined) {
    options.body = JSON.stringify(corps)
    options.headers['Content-Type'] = 'application/json'
  }

  let reponse
  try {
    reponse = await fetch(adresse(chemin), options)
  } catch (erreur) {
    if (erreur.name === 'AbortError') throw erreur
    throw new Error("KTEC ne répond plus. Relancez-le avec son raccourci.")
  }
  const texte = await reponse.text()
  const donnees = texte ? JSON.parse(texte) : null
  if (!reponse.ok) throw Object.assign(new Error(donnees?.erreur || `Erreur ${reponse.status}`), { statut: reponse.status })
  return donnees
}

// Lit une réponse envoyée en plusieurs morceaux (« event: … / data: … »).
export async function flux(chemin, corps, surEvenement, signal) {
  const reponse = await fetch(adresse(chemin), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KTEC': '1' }, body: JSON.stringify(corps), signal })
  if (!reponse.ok) {
    const texte = await reponse.text()
    throw new Error(JSON.parse(texte || '{}').erreur || `Erreur ${reponse.status}`)
  }
  const lecteur = reponse.body.getReader()
  const decodeur = new TextDecoder()
  let tampon = ''
  for (;;) {
    const { value, done } = await lecteur.read()
    if (done) break
    tampon += decodeur.decode(value, { stream: true })
    let fin
    while ((fin = tampon.indexOf('\n\n')) >= 0) {
      const bloc = tampon.slice(0, fin)
      tampon = tampon.slice(fin + 2)
      const type = bloc.match(/^event: (.*)$/m)?.[1]
      const donnees = bloc.match(/^data: (.*)$/m)?.[1]
      if (type && donnees) surEvenement(type, JSON.parse(donnees))
    }
  }
}
