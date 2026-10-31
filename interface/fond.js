// Fond du portail : une constellation discrète qui dérive lentement (points reliés quand ils sont proches).
// Purement décorative : estompée, elle se fige si le poste demande moins d'animations,
// et s'arrête d'elle-même quand l'onglet n'est pas affiché.
//
// La gravité : après 10 secondes de souris immobile, les étoiles dérivent lentement vers elle. Celles qui l'atteignent grossissent une petite
// boule ; plus elle grossit, plus elle attire. Quand presque toutes y sont : surBigBang(x, y) est appelé
// (le logo du portail explose et rejoue son intro à cet endroit) et les étoiles reprennent leur place.

export function constellation({ surBigBang = null } = {}) {
  const toile = document.createElement('canvas')
  toile.className = 'fond-constellation'
  toile.setAttribute('aria-hidden', 'true')
  document.body.prepend(toile)
  const ctx = toile.getContext('2d')
  const calme = matchMedia('(prefers-reduced-motion: reduce)').matches
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4ade80'
  const [r, v, b] = rvb(accent)
  let largeur = 0
  let hauteur = 0
  let points = []
  const souris = { x: 0, y: 0, la: false, depuis: 0 }
  let masse = 0 // étoiles avalées par la boule
  let total = 0
  // souris.depuis : depuis quand la souris n'a pas bougé (quelques pixels près). La gravité n'agit qu'au bout de
  // 10 secondes d'immobilité, pour ne pas gêner la navigation ; dès qu'elle bouge, la boule relâche ses étoiles.
  window.addEventListener('pointermove', (e) => {
    const bouge = Math.hypot(e.clientX - souris.x, e.clientY - souris.y) > 3
    Object.assign(souris, { x: e.clientX, y: e.clientY, la: true })
    if (bouge || !souris.depuis) souris.depuis = performance.now()
  })
  document.documentElement.addEventListener('pointerleave', () => (souris.la = false))

  function dimensionner() {
    const ratio = window.devicePixelRatio || 1
    largeur = window.innerWidth
    hauteur = window.innerHeight
    toile.width = largeur * ratio
    toile.height = hauteur * ratio
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    // Un point pour ~16 000 px², comme un ciel peu chargé.
    const nombre = Math.round(Math.min(110, Math.max(35, (largeur * hauteur) / 16000)))
    total = nombre
    masse = 0
    points = Array.from({ length: nombre }, () => ({
      x: Math.random() * largeur,
      y: Math.random() * hauteur,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
      rayon: 0.8 + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2,
    }))
  }

  function dessiner(temps = 0) {
    ctx.clearRect(0, 0, largeur, hauteur)
    const portee = 140
    const visibles = points.filter((p) => !p.avalee)
    for (let i = 0; i < visibles.length; i++) {
      const p = visibles[i]
      for (let j = i + 1; j < visibles.length; j++) {
        const q = visibles[j]
        const d = Math.hypot(p.x - q.x, p.y - q.y)
        if (d > portee) continue
        ctx.strokeStyle = `rgba(${r}, ${v}, ${b}, ${0.16 * (1 - d / portee)})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(q.x, q.y)
        ctx.stroke()
      }
    }
    for (const p of visibles) {
      // Les étoiles scintillent un peu.
      const eclat = 0.35 + 0.25 * Math.sin(temps / 1400 + p.phase)
      ctx.fillStyle = `rgba(${r}, ${v}, ${b}, ${eclat})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.rayon, 0, Math.PI * 2)
      ctx.fill()
    }
    // La boule sous la souris : pleine, avec une lueur autour, plus vive à mesure qu'elle grossit.
    if (masse > 0) {
      const rayon = rayonBoule()
      ctx.save()
      ctx.shadowColor = `rgba(${r}, ${v}, ${b}, 0.9)`
      ctx.shadowBlur = 10 + rayon * 1.6
      ctx.fillStyle = `rgb(${Math.round(r + (255 - r) * 0.55)}, ${Math.round(v + (255 - v) * 0.55)}, ${Math.round(b + (255 - b) * 0.55)})`
      ctx.beginPath()
      ctx.arc(souris.x, souris.y, rayon, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  const rayonBoule = () => 2 + Math.sqrt(masse) * 2.2
  const attire = () => souris.la && souris.depuis && performance.now() - souris.depuis >= 10_000 && !document.body.classList.contains('intro-en-cours')

  // Attire les étoiles vers la souris, de plus en plus fort à mesure que la boule grossit.
  function graviter(temps) {
    if (!attire()) {
      // Souris partie ou immobile depuis longtemps : la boule relâche ses étoiles, doucement.
      if (masse > 0 && Math.random() < 0.08) {
        masse--
        const angle = Math.random() * Math.PI * 2
        const p = points.find((q) => q.avalee)
        if (p) Object.assign(p, { avalee: false, x: souris.x, y: souris.y, vx: Math.cos(angle) * 0.6, vy: Math.sin(angle) * 0.6 })
      }
      return
    }
    // La force grandit avec la boule, jusqu'aux deux tiers des étoiles absorbées : au-delà, les dernières
    // arriveraient trop vite et la traverseraient.
    const poids = Math.min(masse, (total * 2) / 3)
    const force = 0.0035 * (1 + poids * 0.14)
    const capture = rayonBoule() + 4
    for (const p of points) {
      if (p.avalee) continue
      const dx = souris.x - p.x
      const dy = souris.y - p.y
      const d = Math.hypot(dx, dy) || 1
      if (d < capture) {
        p.avalee = true
        masse++
        continue
      }
      const a = force * (300 / (d + 150))
      const [ux, uy] = [dx / d, dy / d]
      // La vitesse « de côté » est freinée : sans ça, les étoiles se mettraient en orbite autour de la boule
      // au lieu d'y tomber ; freinées, elles spiralent vers elle.
      const laterale = p.vx * -uy + p.vy * ux
      const freinLateral = laterale * 0.05
      p.vx += ux * a + uy * freinLateral
      p.vy += uy * a - ux * freinLateral
      const max = 0.5 + poids * 0.05
      const vitesse = Math.hypot(p.vx, p.vy)
      if (vitesse > max) {
        p.vx *= max / vitesse
        p.vy *= max / vitesse
      }
    }
    if (masse >= total * 0.85) bigBang()
  }

  // Le big bang, c'est le logo qui le fait (le portail rejoue son intro sous la souris) : les étoiles avalées
  // reprennent simplement leur place dans le ciel, pendant que le fond est estompé.
  function bigBang() {
    const { x, y } = souris
    masse = 0
    for (const p of points) {
      if (!p.avalee) continue
      Object.assign(p, { avalee: false, x: Math.random() * largeur, y: Math.random() * hauteur, vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18 })
    }
    surBigBang?.(x, y)
  }

  function avancer(temps) {
    graviter(temps)
    for (const p of points) {
      if (p.avalee) continue
      // Sans attraction (souris partie, intro), les étoiles retrouvent peu à peu leur dérive tranquille.
      const vitesse = Math.hypot(p.vx, p.vy)
      if (vitesse > 0.25 && (!souris.la || document.body.classList.contains('intro-en-cours'))) {
        p.vx *= 0.98
        p.vy *= 0.98
      }
      const [x0, y0] = [p.x, p.y]
      p.x += p.vx
      p.y += p.vy
      // Une étoile rapide peut traverser la boule entre deux images : on regarde tout son trajet, et elle
      // disparaît dès qu'il touche la boule (sinon la gravité la relancerait de l'autre côté).
      if (attire()) {
        if (distanceAuTrajet(souris.x, souris.y, x0, y0, p.x, p.y) < rayonBoule() + 4) {
          p.avalee = true
          masse++
          continue
        }
      }
      if (p.x < -20) p.x = largeur + 20
      if (p.x > largeur + 20) p.x = -20
      if (p.y < -20) p.y = hauteur + 20
      if (p.y > hauteur + 20) p.y = -20
    }
    dessiner(temps)
    requestAnimationFrame(avancer)
  }

  dimensionner()
  window.addEventListener('resize', () => { dimensionner(); if (calme) dessiner() })
  if (calme) dessiner()
  else requestAnimationFrame(avancer)
}

// La distance d'un point (px, py) au segment parcouru par une étoile, de (ax, ay) à (bx, by).
function distanceAuTrajet(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const k = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy))
}

function rvb(couleur) {
  const m = couleur.match(/^#([0-9a-f]{6})$/i)
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
  const n = couleur.match(/\d+/g)
  return n && n.length >= 3 ? n.slice(0, 3).map(Number) : [74, 222, 128]
}
