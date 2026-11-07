// Le logo de K.NOVA : une supernova, son soleil et quatre planètes sur leurs orbites en pointillés.
// À l'ouverture du portail (une fois par lancement), une intro : le soleil explose au milieu de l'écran, les
// planètes arrivent de loin en spirale à travers la page, les orbites se dessinent, puis le logo monte à sa place
// et le menu apparaît. Un clic ou une touche passe l'intro ; rien ne bouge si le poste demande moins d'animations.

const NS = 'http://www.w3.org/2000/svg'
// Une orbite par application, dans sa couleur : BiRTEC, PDRTEC, AITEC, PREVTEC (du centre vers l'extérieur).
const ORBITES = [
  { rayon: 32, couleur: '#10b981', epaisseur: 3.5, pointilles: '36 10', planete: 4.2, angle: -30, depart: 135, duree: 70 },
  { rayon: 49, couleur: '#a3e635', epaisseur: 2.6, pointilles: '22 14', planete: 4.6, angle: 150, depart: 45, duree: 105 },
  { rayon: 66, couleur: '#2dd4bf', epaisseur: 1.9, pointilles: '10 13', planete: 3.8, angle: 250, depart: 100, duree: 140 },
  { rayon: 83, couleur: '#38bdf8', epaisseur: 1.3, pointilles: '4 12', planete: 3.4, angle: 20, depart: 200, duree: 185 },
]
const calme = () => matchMedia('(prefers-reduced-motion: reduce)').matches
let numero = 0

function el(nom, attributs = {}, enfants = []) {
  const e = document.createElementNS(NS, nom)
  for (const [k, v] of Object.entries(attributs)) e.setAttribute(k, v)
  for (const enfant of enfants) e.append(enfant)
  return e
}
const point = (rayon, angle) => [rayon * Math.cos((angle * Math.PI) / 180), rayon * Math.sin((angle * Math.PI) / 180)]

// Le logo (SVG). Chaque orbite tourne lentement avec sa planète ; le soleil respire.
export function logoSupernova() {
  const id = `sn${++numero}`
  const masques = el('defs')
  const orbites = ORBITES.map((o, i) => {
    // Le masque sert à « dessiner » l'orbite pendant l'intro (le pointillé se trace comme un trait qui avance).
    const tour = 2 * Math.PI * o.rayon
    const trace = el('circle', { r: o.rayon, fill: 'none', stroke: '#fff', 'stroke-width': 12, 'stroke-dasharray': tour, 'stroke-dashoffset': 0, transform: `rotate(${o.angle})` })
    masques.append(el('mask', { id: `${id}-m${i}`, maskUnits: 'userSpaceOnUse', x: -100, y: -100, width: 200, height: 200 }, [trace]))
    const [x, y] = point(o.rayon, o.angle)
    const astre = el('circle', { class: 'planete', cx: x, cy: y, r: o.planete, fill: o.couleur })
    const g = el('g', { class: 'orbite', style: `animation-duration:${o.duree}s` }, [
      el('circle', { class: 'trace-orbite', r: o.rayon, fill: 'none', stroke: o.couleur, 'stroke-width': o.epaisseur, 'stroke-dasharray': o.pointilles, 'stroke-linecap': 'round', mask: `url(#${id}-m${i})` }),
      astre,
    ])
    return { ...o, g, trace, astre, tour }
  })
  const flash = el('circle', { class: 'flash', r: 20, fill: '#fde68a', opacity: 0 })
  const onde = el('circle', { class: 'onde', r: 20, fill: 'none', stroke: '#fde68a', 'stroke-width': 2, opacity: 0 })
  const soleil = el('g', { class: 'soleil' }, [el('circle', { r: 16, fill: '#fde68a' }), el('circle', { r: 8, fill: '#fff' })])
  const svg = el('svg', { class: 'supernova', viewBox: '-100 -100 200 200', role: 'img', 'aria-label': 'K.NOVA' }, [masques, flash, onde, ...orbites.map((o) => o.g), soleil])
  svg.parties = { orbites, flash, onde, soleil }
  return svg
}

// L'intro. bloc : l'en-tête (logo, nom) ; logo : le SVG ; aCacher : ce qui n'apparaît qu'à la fin (le menu) ;
// origine : le point de l'écran où le soleil explose (le milieu par défaut, la souris après un big bang).
// Renvoie une promesse résolue quand tout est en place.
export function jouerIntro({ bloc, logo, nom, aCacher, origine = null }) {
  if (calme()) return Promise.resolve()
  const { orbites, flash, onde, soleil } = logo.parties
  const animations = []
  const anime = (cible, images, options) => {
    const a = cible.animate(images, { fill: 'both', easing: 'ease-out', ...options })
    animations.push(a)
    return a
  }

  // Départ : le menu caché, le logo agrandi au milieu de l'écran, orbites effacées et planètes absentes.
  window.scrollTo(0, 0)
  document.body.classList.add('intro-en-cours')
  for (const e of aCacher) e.classList.add('intro-cache')
  logo.classList.add('en-intro')
  bloc.style.transform = ''
  const r = bloc.getBoundingClientRect()
  const echelle = Math.min(1.9, (innerHeight * 0.62) / r.height)
  // Au milieu : tout l'en-tête est centré ; à la souris : c'est le soleil qui se pose sous la souris.
  let [ox, oy] = [innerWidth / 2, innerHeight / 2]
  if (origine) {
    const s = logo.getBoundingClientRect()
    ox = origine.x - (s.left + s.width / 2 - (r.left + r.width / 2)) * echelle
    oy = origine.y - (s.top + s.height / 2 - (r.top + r.height / 2)) * echelle
  }
  const decalage = `translate(${ox - (r.left + r.width / 2)}px, ${oy - (r.top + r.height / 2)}px) scale(${echelle})`
  bloc.style.transform = decalage
  for (const o of orbites) {
    o.trace.setAttribute('stroke-dashoffset', o.tour)
    o.astre.style.opacity = 0
  }
  nom.style.opacity = 0

  // 1. L'explosion du soleil (0 → 0,9 s).
  anime(soleil, [{ transform: 'scale(0)' }, { transform: 'scale(1.5)', offset: 0.45 }, { transform: 'scale(1)' }], { duration: 900, easing: 'cubic-bezier(.2,.9,.3,1.2)' })
  anime(flash, [{ opacity: 0.95, transform: 'scale(0.2)' }, { opacity: 0, transform: 'scale(5)' }], { duration: 900 })
  anime(onde, [{ opacity: 0.9, transform: 'scale(0.5)' }, { opacity: 0, transform: 'scale(6.5)' }], { duration: 1500, delay: 150 })

  // 2. Les planètes arrivent en spirale, de très loin, sur une toile posée sur toute la page.
  const toile = document.createElement('canvas')
  toile.className = 'toile-intro'
  document.body.append(toile)
  const ctx = toile.getContext('2d')
  const ratio = devicePixelRatio || 1
  toile.width = innerWidth * ratio
  toile.height = innerHeight * ratio
  ctx.scale(ratio, ratio)
  const boite = logo.getBoundingClientRect()
  const centre = [boite.left + boite.width / 2, boite.top + boite.height / 2]
  const unite = boite.width / 200
  const loin = Math.hypot(innerWidth, innerHeight) * 0.85
  const vols = orbites.map((o, i) => {
    // L'angle d'arrivée est celui de la planète sur son orbite ; on part du bas de l'écran (gauche, droite,
    // milieu) en faisant un tour et quart à un tour et demi.
    let fin = o.angle
    while (fin - o.depart < 450) fin += 360
    return { o, debut: 500 + i * 260, duree: 2700, rayon: o.rayon * unite, fin, traine: [] }
  })
  const t0 = performance.now()
  let image = 0
  let fini = false
  const terminer = new Promise((resoudre) => {
    const etape = (maintenant) => {
      if (fini) return
      const t = maintenant - t0
      ctx.clearRect(0, 0, innerWidth, innerHeight)
      let enVol = false
      for (const v of vols) {
        const p = Math.min(1, Math.max(0, (t - v.debut) / v.duree))
        if (p <= 0) { enVol = true; continue }
        const e = 1 - Math.pow(1 - p, 3)
        const angle = v.o.depart + (v.fin - v.o.depart) * e
        const rayon = v.rayon + (loin - v.rayon) * (1 - e)
        const [x, y] = point(rayon, angle)
        if (p < 1) {
          enVol = true
          v.traine.push([centre[0] + x, centre[1] + y])
          if (v.traine.length > 26) v.traine.shift()
          dessinerTraine(ctx, v.traine, v.o.couleur, Math.max(2.5, v.o.planete * unite * (1 + (1 - e) * 2.5)))
        } else if (!v.pose) {
          v.pose = true
          v.o.astre.style.opacity = 1
          anime(v.o.astre, [{ transform: 'scale(2.2)' }, { transform: 'scale(1)' }], { duration: 500 })
          // 3. L'orbite se dessine derrière la planète posée.
          anime(v.o.trace, [{ strokeDashoffset: v.o.tour }, { strokeDashoffset: 0 }], { duration: 900, easing: 'ease-in-out' })
        }
      }
      if (enVol) image = requestAnimationFrame(etape)
      else resoudre()
    }
    image = requestAnimationFrame(etape)
  })

  const passer = () => finir(true)
  const finir = (vite = false) => {
    if (fini) return
    fini = true
    cancelAnimationFrame(image)
    removeEventListener('pointerdown', passer, true)
    removeEventListener('keydown', passer, true)
    toile.remove()
    for (const a of animations) a.cancel()
    for (const o of orbites) {
      o.trace.setAttribute('stroke-dashoffset', 0)
      o.astre.style.opacity = ''
    }
    logo.classList.remove('en-intro')
    // 4. Le logo monte à sa place, puis le menu apparaît, élément après élément (et le nom, après un big bang).
    if (origine && !vite) nom.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 800, fill: 'backwards' })
    nom.style.opacity = ''
    bloc.animate([{ transform: decalage }, { transform: 'none' }], { duration: vite ? 250 : 900, easing: 'cubic-bezier(.6,0,.25,1)' })
    bloc.style.transform = ''
    aCacher.forEach((e, i) => setTimeout(() => e.classList.remove('intro-cache'), (vite ? 120 : 700) + i * (vite ? 20 : 90)))
    setTimeout(() => document.body.classList.remove('intro-en-cours'), vite ? 300 : 900)
  }
  addEventListener('pointerdown', passer, true)
  addEventListener('keydown', passer, true)

  return terminer.then(() => {
    if (fini) return
    toile.remove()
    // Le nom apparaît sous le soleil (pas après un big bang : il revient seulement une fois le logo à sa place),
    // puis on laisse les orbites finir de se tracer avant de monter.
    if (!origine) anime(nom, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 600 })
    return new Promise((resoudre) => setTimeout(resoudre, 1100))
  }).then(() => finir())
}

function dessinerTraine(ctx, traine, couleur, taille) {
  for (let i = 1; i < traine.length; i++) {
    ctx.globalAlpha = (i / traine.length) * 0.55
    ctx.strokeStyle = couleur
    ctx.lineWidth = taille * (i / traine.length)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(...traine[i - 1])
    ctx.lineTo(...traine[i])
    ctx.stroke()
  }
  const [x, y] = traine.at(-1)
  ctx.globalAlpha = 1
  ctx.fillStyle = couleur
  ctx.shadowColor = couleur
  ctx.shadowBlur = 14
  ctx.beginPath()
  ctx.arc(x, y, taille, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0
}
