// « Pourquoi K.NOVA ? » : un enchaînement d'une trentaine de secondes, joué au tout premier lancement sur le poste,
// puis à la demande (bouton du pied du portail). Quatre phases dans l'univers de la supernova :
//   1. l'enjeu : la propriété et la maîtrise des données ; les confier à un cloud extérieur, c'est en dépendre ;
//   2. la connaissance : tout reste chez vous, réuni dans un seul fichier chiffré, que seule la clé du site ouvre ;
//   3. les applications, en orbite autour de ce fichier ;
//   4. le résultat : tout se contracte dans le soleil, et l'intro du portail prend le relais (la création du logo).
// Tout est dessiné sur une toile, le texte par-dessus. « Passer », Échap ou Entrée mènent directement au logo.

import { h } from './socle/ui.js'

const DUREE = 31_000 // en temps du récit ; joué au ralenti (LENTEUR), il dure environ 45 secondes
const LENTEUR = 1.5
const PHASES = [
  { debut: 0, fin: 8000, titre: 'L’enjeu' },
  { debut: 8000, fin: 19500, titre: 'La connaissance' },
  { debut: 19500, fin: 27000, titre: 'Les applications' },
  { debut: 27000, fin: DUREE, titre: 'Le résultat' },
]
const PHRASES = [
  { debut: 0, texte: 'Aujourd’hui, la propriété et la maîtrise de ses données sont cruciales pour une entreprise.' },
  { debut: 3800, texte: 'Les confier aux IA et aux clouds extérieurs, c’est dépendre de services que l’on ne contrôle pas.' },
  { debut: 8000, texte: 'Avec K.NOVA, vous restez maîtres de vos données : tout est local, rien ne quitte le site.' },
  { debut: 11000, texte: 'Toutes les données du site sont réunies dans un seul fichier, chiffré, rangé chez vous.' },
  { debut: 14300, texte: 'Il ne s’ouvre qu’avec la clé du site, gardée à part : copié ou volé, le fichier reste illisible.' },
  { debut: 19500, texte: 'BiRTEC : la puissance des requêtes, les données simplifiées.' },
  { debut: 22000, texte: 'PDRTEC : une recherche de pièces performante et classée.' },
  { debut: 24500, texte: 'AITEC : la maintenance de premier niveau, dynamique et évolutive.' },
  { debut: 27000, texte: 'Moins de temps à chercher, plus de temps pour décider.' },
]
// Les mêmes couleurs et le même ordre que les orbites du logo.
const APPLIS = [
  { nom: 'BiRTEC', couleur: '#10b981', rayon: 118, angle: -35 },
  { nom: 'PDRTEC', couleur: '#a3e635', rayon: 182, angle: 205 },
  { nom: 'AITEC', couleur: '#2dd4bf', rayon: 246, angle: 80 },
]
const SOLEIL = '#fde68a'
const VERT = '#4ade80'
const ROUGE = '#f87171'

const borne = (x) => Math.min(1, Math.max(0, x))
const entre = (t, a, b) => borne((t - a) / (b - a))
const sortie = (p) => 1 - Math.pow(1 - p, 3)
const doux = (p) => p * p * (3 - 2 * p)
const dir = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]

// Un hasard toujours le même : l'enchaînement est identique à chaque fois.
function hasards(graine) {
  return () => (graine = (graine * 16807) % 2147483647) / 2147483647
}

// creerLogo : appelée à la fin (ou quand on passe), elle lance la création du logo sous l'écran du récit, qui s'efface.
export function jouerRecit(creerLogo = () => Promise.resolve()) {
  const hasard = hasards(42)
  const etoiles = Array.from({ length: 170 }, () => ({ x: hasard(), y: hasard(), r: 0.4 + hasard() * 1.3, ph: hasard() * 7 }))
  const donnees = Array.from({ length: 72 }, (_, i) => ({
    angle: hasard() * 360, dist: 18 + Math.sqrt(hasard()) * 78, ph: hasard() * 7, decal: hasard(),
    couleur: [VERT, '#2dd4bf', SOLEIL, '#a3e635'][i % 4], fuite: i % 3 === 0, taille: 1.6 + hasard() * 1.8,
  }))

  const toile = h('canvas', { class: 'recit-toile' })
  const phase = h('div', { class: 'recit-phase' })
  const texte = h('p', { class: 'recit-texte' })
  const barres = PHASES.map(() => h('span', {}, h('i')))
  const passer = h('button', { class: 'petit discret recit-passer' }, 'Passer')
  const ecran = h('div', { class: 'recit-knova', 'aria-label': 'Pourquoi K.NOVA ?' },
    toile, phase, texte, h('div', { class: 'recit-bas' }, h('div', { class: 'recit-barres' }, barres), passer))
  document.body.append(ecran)
  document.body.classList.add('recit-en-cours')
  const ctx = toile.getContext('2d')

  let w = 0
  let ht = 0
  const ajuster = () => {
    const ratio = devicePixelRatio || 1
    w = innerWidth
    ht = innerHeight
    toile.width = w * ratio
    toile.height = ht * ratio
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  }
  ajuster()
  addEventListener('resize', ajuster)

  let phrase = -1
  let numPhase = -1
  const montrer = (el, contenu) => {
    el.textContent = contenu
    el.animate([{ opacity: 0, filter: 'blur(4px)' }, { opacity: 1, filter: 'none' }], { duration: 700, easing: 'ease-out' })
  }
  // La phrase s'écrit lettre après lettre (chaque mot reste entier en bout de ligne).
  const ecrire = (contenu) => {
    let rang = 0
    texte.replaceChildren(...contenu.split(' ').flatMap((mot, i) => [
      ...(i ? [' '] : []),
      h('span', { class: 'recit-mot' }, [...mot].map((c) => h('span', { class: 'recit-lettre', style: { animationDelay: `${rang++ * 32}ms` } }, c))),
    ]))
  }

  function dessiner(t) {
    const u = Math.min(w / 900, ht / 800)
    const cx = w / 2
    const cy = ht / 2 // le milieu, là où l'intro fera exploser le logo
    // La fin : tout se contracte dans le soleil, qui se réduit à une étincelle.
    const contraction = 1 - sortie(entre(t, 29300, 30600))
    const scene = 1 - entre(t, 30400, 31000)
    ctx.clearRect(0, 0, w, ht)

    // Les étoiles du fond.
    for (const e of etoiles) {
      ctx.globalAlpha = (0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t / 700 + e.ph))) * entre(t, 0, 1500)
      ctx.fillStyle = '#e2e8f0'
      ctx.beginPath()
      ctx.arc(e.x * w, e.y * ht, e.r, 0, Math.PI * 2)
      ctx.fill()
    }

    // Phase 1 : le cloud extérieur, une nova rouge et noire menaçante en haut, et les données aspirées vers elle.
    const K = [cx, cy - 255 * u]
    const detour = [cx + 70 * u, cy - 150 * u] // le point qui courbe la fuite
    const vuNova = entre(t, 2200, 3400) * (1 - entre(t, 9000, 10600))
    const fuite = entre(t, 2800, 3600) * (1 - entre(t, 8300, 9000))
    if (vuNova > 0) nova(ctx, K[0], K[1], u * (1 - 0.6 * entre(t, 9000, 10600)), vuNova, t)
    if (fuite > 0) {
      ctx.globalAlpha = fuite * 0.25
      ctx.strokeStyle = ROUGE
      ctx.setLineDash([4 * u, 8 * u])
      ctx.lineDashOffset = -t / 30
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.quadraticCurveTo(detour[0], detour[1], K[0], K[1])
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Phase 2 : le bouclier se referme autour du site ; la fuite est coupée.
    const bouclier = entre(t, 8000, 8900)
    const vuBouclier = bouclier * (1 - entre(t, 12000, 13500))
    if (vuBouclier > 0) {
      const R = 135 * u * (1 + 0.03 * Math.sin(t / 300))
      ctx.globalAlpha = vuBouclier
      ctx.fillStyle = 'rgba(74, 222, 128, 0.06)'
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = VERT
      ctx.lineWidth = 3 * u
      ctx.shadowColor = VERT
      ctx.shadowBlur = 18
      ctx.beginPath()
      ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * sortie(bouclier))
      ctx.stroke()
      ctx.shadowBlur = 0
      // L'éclat où la fuite se cogne au bouclier.
      const choc = entre(t, 8500, 8700) * (1 - entre(t, 8700, 9600))
      if (choc > 0) {
        const [dx, dy] = dir(-90)
        ctx.globalAlpha = choc
        ctx.fillStyle = '#fff'
        ctx.shadowColor = VERT
        ctx.shadowBlur = 30
        ctx.beginPath()
        ctx.arc(cx + dx * R, cy + dy * R, 7 * u * (1 + choc), 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
      }
    }

    // Les données du site : un essaim qui flotte, fuit (phase 1), puis se rassemble au centre (phase 2).
    const apparu = entre(t, 0, 1500)
    for (const d of donnees) {
      const derive = d.angle + Math.sin(t / 2000 + d.ph) * 8
      const [dx, dy] = dir(derive)
      const hx = cx + dx * d.dist * u
      const hy = cy + dy * d.dist * u
      const c = sortie(entre(t, 11000 + d.decal * 1300, 12600 + d.decal * 1300))
      const x = hx + (cx - hx) * c
      const y = hy + (cy - hy) * c
      const a = apparu * (1 - entre(t, 13600, 14300))
      if (a > 0) {
        ctx.globalAlpha = a * (0.6 + 0.4 * Math.sin(t / 500 + d.ph))
        ctx.fillStyle = d.couleur
        ctx.shadowColor = d.couleur
        ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.arc(x, y, d.taille * u * 1.4, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
      }
      // Une donnée sur trois part vers le cloud, en boucle, tant que le bouclier n'est pas fermé.
      if (d.fuite && fuite > 0) {
        const p = ((t - 2800) / 2300 + d.decal) % 1
        for (let k = 0; k < 7; k++) {
          const q = p - k * 0.018
          if (q < 0) continue
          const [bx, by] = courbe([hx, hy], detour, K, q)
          ctx.globalAlpha = fuite * (1 - k / 7) * (1 - q * 0.4)
          ctx.fillStyle = k ? ROUGE : '#fecaca'
          ctx.beginPath()
          ctx.arc(bx, by, (2.6 - k * 0.25) * u * 1.3, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    // Le fichier : un soleil qui grandit en absorbant les données. Son cadenas apparaît ouvert ; la clé du site
    // arrive, entre dans la serrure, tourne, et l'anse se referme d'un coup (éclair et onde).
    const noyau = sortie(entre(t, 11200, 14000))
    if (noyau > 0) {
      const rc = u * (5 + 27 * noyau) * (1 + 0.05 * Math.sin(t / 380)) * (0.15 + 0.85 * contraction) * (1 + 0.8 * entre(t, 30300, 30700))
        * (1 + 0.6 * doux(entre(t, 14000, 15000)) * (1 - doux(entre(t, 18600, 19600)))) // plus gros pendant le verrouillage
      ctx.globalAlpha = scene
      const halo = ctx.createRadialGradient(cx, cy, rc * 0.2, cx, cy, rc * 3.2)
      halo.addColorStop(0, 'rgba(253, 230, 138, 0.55)')
      halo.addColorStop(1, 'rgba(253, 230, 138, 0)')
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(cx, cy, rc * 3.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = scene
      ctx.fillStyle = SOLEIL
      ctx.beginPath()
      ctx.arc(cx, cy, rc, 0, Math.PI * 2)
      ctx.fill()
      const cadenas = entre(t, 13200, 14000) * scene
      if (cadenas > 0) {
        const taille = rc * 0.62
        const ferme = sortie(entre(t, 16900, 17250))
        dessinerCadenas(ctx, cx, cy, taille, cadenas, 1 - ferme)
        // La clé : elle arrive en vol du bas à gauche jusqu'à la serrure, tourne d'un quart de tour, puis s'efface.
        const vol = sortie(entre(t, 14600, 16100))
        const vueCle = entre(t, 14600, 14900) * (1 - entre(t, 17600, 18300)) * scene
        if (vueCle > 0) {
          const serrure = [cx, cy + taille * 0.25]
          const depart = [cx - 330 * u, cy + 190 * u]
          const kx = depart[0] + (serrure[0] - depart[0]) * vol
          const ky = depart[1] + (serrure[1] - depart[1]) * vol - Math.sin(vol * Math.PI) * 90 * u
          const tour = sortie(entre(t, 16300, 16900)) * (Math.PI / 2)
          dessinerCle(ctx, kx, ky, (34 - 12 * vol) * u, -0.5 * (1 - vol), tour, vueCle)
        }
        // Le déclic : un éclair blanc et une onde verte autour du soleil.
        const clic = entre(t, 17200, 18400)
        if (clic > 0 && clic < 1) {
          ctx.globalAlpha = (1 - clic) * scene
          ctx.strokeStyle = VERT
          ctx.lineWidth = 4 * u * (1 - clic)
          ctx.shadowColor = VERT
          ctx.shadowBlur = 24
          ctx.beginPath()
          ctx.arc(cx, cy, rc * (1.1 + 3 * sortie(clic)), 0, Math.PI * 2)
          ctx.stroke()
          ctx.shadowBlur = 0
          ctx.globalAlpha = (1 - clic) * 0.8 * scene
          ctx.fillStyle = '#fff'
          ctx.beginPath()
          ctx.arc(cx, cy, rc * (1 + 0.4 * clic), 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    // Phase 3 : les applications sortent du soleil et prennent leur orbite. Phase 4 : elles tournent plus vite
    // et renvoient vers lui ce qu'elles trouvent (rien ne part ailleurs).
    APPLIS.forEach((a, i) => {
      const debut = 19700 + i * 2500
      if (t < debut) return
      const e = sortie(entre(t, debut, debut + 1500))
      const acceleration = Math.max(0, t - 27000) * 0.6
      const angle = a.angle + (t - debut + acceleration) * 0.011 / (1 + i * 0.45)
      const rr = a.rayon * u * contraction
      // L'orbite se dessine en pointillés derrière la planète.
      ctx.globalAlpha = 0.6 * e * scene
      ctx.strokeStyle = a.couleur
      ctx.lineWidth = (3 - i * 0.8) * u
      ctx.setLineDash([(i === 0 ? 30 : i === 1 ? 18 : 6) * u, 12 * u])
      ctx.lineDashOffset = -t / 40
      ctx.beginPath()
      ctx.arc(cx, cy, rr, ((angle - 360 * e) * Math.PI) / 180, (angle * Math.PI) / 180)
      ctx.stroke()
      ctx.setLineDash([])
      const [dx, dy] = dir(angle)
      const px = cx + dx * rr * e
      const py = cy + dy * rr * e
      // Phase 4 : des éclats remontent de la planète vers le soleil.
      if (t > 27000 && t < 29300) {
        for (let k = 0; k < 3; k++) {
          const p = ((t - 27000) / 1100 + k / 3 + i * 0.21) % 1
          ctx.globalAlpha = (1 - p) * 0.9
          ctx.fillStyle = a.couleur
          ctx.beginPath()
          ctx.arc(px + (cx - px) * p, py + (cy - py) * p, 2.4 * u * 1.3, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = scene
      ctx.fillStyle = a.couleur
      ctx.shadowColor = a.couleur
      ctx.shadowBlur = 20
      ctx.beginPath()
      ctx.arc(px, py, (8 + 6 * (1 - e)) * u, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0
    })

    ctx.globalAlpha = 1

    // Le texte, la phase et la barre de progression.
    const ip = PHRASES.findLastIndex((p) => t >= p.debut)
    if (ip !== phrase) {
      phrase = ip
      ecrire(PHRASES[ip].texte)
    }
    const nPhase = PHASES.findLastIndex((p) => t >= p.debut)
    if (nPhase !== numPhase) {
      numPhase = nPhase
      montrer(phase, `${nPhase + 1} / ${PHASES.length} · ${PHASES[nPhase].titre}`)
    }
    PHASES.forEach((p, i) => { barres[i].firstChild.style.width = `${entre(t, p.debut, p.fin) * 100}%` })
  }

  return new Promise((resoudre) => {
    const t0 = performance.now()
    let image = 0
    let fini = false
    const finir = () => {
      if (fini) return
      fini = true
      cancelAnimationFrame(image)
      removeEventListener('resize', ajuster)
      removeEventListener('keydown', touche, true)
      document.body.classList.remove('recit-en-cours')
      // Le logo se crée dessous pendant que le récit s'efface : son explosion part du même soleil.
      const logo = creerLogo()
      ecran.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, easing: 'ease-in' }).finished.then(() => ecran.remove())
      resoudre(logo)
    }
    const touche = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault()
        finir()
      }
    }
    passer.addEventListener('click', finir)
    addEventListener('keydown', touche, true)
    const etape = (maintenant) => {
      const t = (maintenant - t0) / LENTEUR
      dessiner(Math.min(t, DUREE))
      if (t >= DUREE) finir()
      else image = requestAnimationFrame(etape)
    }
    image = requestAnimationFrame(etape)
  })
}

// Un point d'une courbe de Bézier quadratique.
function courbe([ax, ay], [bx, by], [cx, cy], p) {
  const q = 1 - p
  return [q * q * ax + 2 * q * p * bx + p * p * cx, q * q * ay + 2 * q * p * by + p * p * cy]
}

// Le cloud extérieur : un disque sombre et calme, cerclé d'une lueur rouge douce. Une fumée légère tourne lentement
// autour, et une texture de volutes tourne à l'intérieur. Il se résorbe quand le bouclier coupe la fuite.
const VOLUTES = (() => {
  const hasard = hasards(7)
  return Array.from({ length: 46 }, () => ({ r: 0.15 + hasard() * 0.8, a: hasard() * Math.PI * 2, long: 0.3 + hasard() * 0.9, ep: 0.6 + hasard() * 1.6, al: 0.05 + hasard() * 0.1 }))
})()
function nova(ctx, x, y, s, alpha, t) {
  const R = 58
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s, s)
  ctx.globalAlpha = alpha
  const pouls = 1 + 0.03 * Math.sin(t / 1400)
  // Le halo, très doux.
  const halo = ctx.createRadialGradient(0, 0, R * 0.9, 0, 0, R * 2.3)
  halo.addColorStop(0, 'rgba(153, 27, 27, 0.35)')
  halo.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(0, 0, R * 2.3, 0, Math.PI * 2)
  ctx.fill()
  // La fumée : des nappes floues qui tournent lentement autour du disque, en ondulant.
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2 + t / 9000 + Math.sin(t / 3200 + k) * 0.25
    const dist = R * (1.08 + 0.1 * Math.sin(t / 2600 + k * 2))
    const taille = R * (0.5 + 0.15 * Math.sin(t / 2100 + k * 1.3))
    const fx = Math.cos(ang) * dist
    const fy = Math.sin(ang) * dist
    const nappe = ctx.createRadialGradient(fx, fy, 0, fx, fy, taille)
    nappe.addColorStop(0, 'rgba(185, 28, 28, 0.22)')
    nappe.addColorStop(1, 'rgba(185, 28, 28, 0)')
    ctx.fillStyle = nappe
    ctx.beginPath()
    ctx.arc(fx, fy, taille, 0, Math.PI * 2)
    ctx.fill()
  }
  // Le disque, sombre.
  const rayon = R * pouls
  const fond = ctx.createRadialGradient(-rayon * 0.25, -rayon * 0.25, 0, 0, 0, rayon)
  fond.addColorStop(0, '#2a0808')
  fond.addColorStop(1, '#0b0202')
  ctx.fillStyle = fond
  ctx.beginPath()
  ctx.arc(0, 0, rayon, 0, Math.PI * 2)
  ctx.fill()
  // La texture : des volutes fines qui tournent lentement, à l'intérieur seulement.
  ctx.save()
  ctx.clip()
  ctx.rotate(t / 14000)
  ctx.lineCap = 'round'
  for (const v of VOLUTES) {
    ctx.globalAlpha = alpha * v.al
    ctx.strokeStyle = '#fca5a5'
    ctx.lineWidth = v.ep
    ctx.beginPath()
    ctx.arc(0, 0, rayon * v.r, v.a, v.a + v.long)
    ctx.stroke()
  }
  ctx.restore()
  // Le cercle rouge, avec une lueur douce.
  ctx.globalAlpha = alpha * 0.85
  ctx.strokeStyle = '#ef4444'
  ctx.lineWidth = 2
  ctx.shadowColor = '#ef4444'
  ctx.shadowBlur = 16
  ctx.beginPath()
  ctx.arc(0, 0, rayon, 0, Math.PI * 2)
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.restore()
}

// Un cadenas sombre posé sur le soleil. ouvert (0 → 1) : l'anse levée, sa branche droite sortie du corps.
function dessinerCadenas(ctx, x, y, taille, alpha, ouvert = 0) {
  ctx.globalAlpha = alpha
  ctx.strokeStyle = '#0a110d'
  ctx.fillStyle = '#0a110d'
  ctx.lineWidth = taille * 0.22
  const leve = ouvert * taille * 0.32
  const haut = y - taille * 0.15
  ctx.beginPath()
  ctx.moveTo(x - taille * 0.42, haut + taille * 0.1)
  ctx.lineTo(x - taille * 0.42, haut - leve)
  ctx.arc(x, haut - leve, taille * 0.42, Math.PI, 0)
  ctx.lineTo(x + taille * 0.42, haut - leve + (ouvert ? taille * 0.05 : taille * 0.1 + leve))
  ctx.stroke()
  ctx.beginPath()
  ctx.roundRect(x - taille * 0.62, y - taille * 0.15, taille * 1.24, taille * 0.95, taille * 0.15)
  ctx.fill()
  ctx.fillStyle = '#fde68a'
  ctx.beginPath()
  ctx.arc(x, y + taille * 0.25, taille * 0.14, 0, Math.PI * 2)
  ctx.fill()
}

// La clé du site : un anneau, une tige et deux dents, blanche et lumineuse. (x, y) : le bout de la tige ;
// pente : son inclinaison en vol ; tour : le quart de tour dans la serrure (la clé s'amincit en tournant).
function dessinerCle(ctx, x, y, taille, pente, tour, alpha) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(x, y)
  ctx.rotate(pente)
  ctx.scale(1, Math.max(0.15, Math.cos(tour)))
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#ffffff'
  ctx.shadowColor = VERT
  ctx.shadowBlur = 18
  ctx.lineWidth = taille * 0.16
  ctx.beginPath()
  ctx.arc(-taille * 1.25, 0, taille * 0.38, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillRect(-taille * 0.88, -taille * 0.08, taille * 0.88, taille * 0.16)
  ctx.fillRect(-taille * 0.35, 0, taille * 0.12, taille * 0.3)
  ctx.fillRect(-taille * 0.15, 0, taille * 0.12, taille * 0.22)
  ctx.restore()
}
