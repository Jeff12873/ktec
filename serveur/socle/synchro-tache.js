// Fil de travail : une opération de synchro.js (rafraichir, publier), pour que K.NOVA ne se fige pas pendant un
// transfert. Le résultat part par le port ; le drapeau permet aussi de l'attendre sans boucle d'événements.
import { workerData } from 'node:worker_threads'
import { rafraichir, publier } from './synchro.js'

const { operation, donnees, port, drapeau } = workerData
let message
try {
  message = { ok: true, valeur: { rafraichir, publier }[operation](donnees) }
} catch (e) {
  message = { ok: false, message: e.message, code: e.code, statut: e.statut }
}
port.postMessage(message)
Atomics.store(drapeau, 0, 1)
Atomics.notify(drapeau, 0)
