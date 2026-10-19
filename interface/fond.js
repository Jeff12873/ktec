// Fond du portail : une constellation discrète qui dérive lentement (points reliés quand ils sont proches).
// Purement décorative : estompée, elle se fige si le poste demande moins d'animations,
// et s'arrête d'elle-même quand l'onglet n'est pas affiché.

export function constellation() {
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

  function dimensionner() {
    const ratio = window.devicePixelRatio || 1
    largeur = window.innerWidth
    hauteur = window.innerHeight
    toile.width = largeur * ratio
    toile.height = hauteur * ratio
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    // Un point pour ~16 000 px², comme un ciel peu chargé.
    const nombre = Math.round(Math.min(110, Math.max(35, (largeur * hauteur) / 16000)))
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
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      for (let j = i + 1; j < points.length; j++) {
        const q = points[j]
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
    for (const p of points) {
      // Les étoiles scintillent un peu.
      const eclat = 0.35 + 0.25 * Math.sin(temps / 1400 + p.phase)
      ctx.fillStyle = `rgba(${r}, ${v}, ${b}, ${eclat})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.rayon, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  function avancer(temps) {
    for (const p of points) {
      p.x += p.vx
      p.y += p.vy
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

function rvb(couleur) {
  const m = couleur.match(/^#([0-9a-f]{6})$/i)
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
  const n = couleur.match(/\d+/g)
  return n && n.length >= 3 ? n.slice(0, 3).map(Number) : [74, 222, 128]
}
