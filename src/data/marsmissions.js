/**
 * marsmissions.js — The real Mars manifest, 2026–2031 (level 23 data).
 *
 * Five missions, adversarially fact-checked 2026-07-06 (see the level-23
 * research memory): ESCAPADE (en route, loitering near Sun–Earth L2), MMX,
 * Rosalind Franklin, Tianwen-3, and the aspirational SR-1 Freedom. NASA/ESA
 * MSR (unfunded FY2026) and Starship (no verified manifest) are deliberately
 * absent — do not add missions without re-research.
 *
 * Each mission carries a reference trajectory: departure/arrival Julian
 * dates seeded from the NASA Interplanetary Mission Design Handbook
 * (TM-2010-216764) windows, and a baked heliocentric departure velocity v1
 * (AU/day). v1 values are Lambert solutions refined by offline Newton
 * shooting against previewLive — the n-body path from launchState(depJd, v1)
 * threads Mars within ~1,700 km at arrJd. Found by scripts, verified by
 * mars-planner.test.js; do not hand-edit. Rosalind Franklin's ~26-month
 * cruise is a one-revolution transfer (zero-rev Lambert can't reach C3
 * below ~40 for it); its v1 comes from an offline 1-rev Lambert scan.
 *
 * HANDBOOK entries double as validation fixtures: our lambert.js must
 * reproduce these published C3 / arrival-v∞ values (it does, to ±0.01).
 */
window.ORRERY = window.ORRERY || {};

ORRERY.DATA.MARS = {

  // NASA/TM-2010-216764 ballistic Earth→Mars windows (C3 km²/s², v∞ km/s)
  HANDBOOK: [
    { name: '2026 Type II',    depJd: 2461344.5, arrJd: 2461636.5, c3: 9.144, vinfArr: 2.729 },
    { name: '2026 Type I',     depJd: 2461358.5, arrJd: 2461626.5, c3: 11.11, vinfArr: 2.915 },
    { name: '2026 min-v∞',     depJd: 2461350.5, arrJd: 2461656.5, c3: 9.646, vinfArr: 2.565 },
    { name: '2028 Type II',    depJd: 2462107.5, arrJd: 2462425.5, c3: 8.928, vinfArr: 3.261 },
    { name: '2028 Type I',     depJd: 2462115.5, arrJd: 2462337.5, c3: 9.048, vinfArr: 4.892 },
    { name: '2031 Type II',    depJd: 2462920.5, arrJd: 2463240.5, c3: 8.237, vinfArr: 5.53 },
    { name: '2031 Type I',     depJd: 2462894.5, arrJd: 2463084.5, c3: 9.00,  vinfArr: 5.541 }
  ],

  MISSIONS: [
    {
      key: 'escapade',
      name: 'ESCAPADE',
      agency: 'NASA · UC Berkeley',
      color: '#8ce8dd',
      confidence: 'high',
      status: 'En route — loitering near Sun–Earth L2',
      blurb: 'Twin smallsat orbiters, Blue and Gold, mapping how the solar ' +
        'wind strips Mars’ atmosphere. Launched on New Glenn’s second ' +
        'flight, they took the scenic route: a year parked near Sun–Earth ' +
        'L2, waiting for the 2026 window to open.',
      vehicle: 'New Glenn NG-2 (launched 13 Nov 2025)',
      arrival: 'Propulsive Mars orbit insertion, Sept 2027 — two arrivals ' +
        'two days apart, then months of burns down to elliptical science orbits',
      payload: 'Twin orbiters: magnetometers, electrostatic analyzers, Langmuir probes',
      // Loiter near L2 from launch to the powered Earth-flyby departure
      loiter: { fromJd: 2460992.5, toJd: 2461351.5 },
      depJd: 2461351.5,            // 7 Nov 2026 — powered Earth flyby
      arrJd: 2461656.5,            // 8 Sep 2027
      v1: { x: -0.013433046, y: 0.013551021, z: 0.000289157 },
      c3: 9.2, vinfArr: 2.57
    },
    {
      key: 'mmx',
      name: 'MMX',
      agency: 'JAXA · CNES/DLR',
      color: '#f2a0b5',
      confidence: 'high',
      status: 'Launch window Nov–Dec 2026',
      blurb: 'Martian Moons eXploration: fly to Phobos, hover alongside it in ' +
        'quasi-satellite orbits, land twice, grab over 10 grams, and bring ' +
        'the first pieces of a martian moon home — with the Idefix rover ' +
        'scouting the surface first.',
      vehicle: 'H3, from Tanegashima (slip risk → 2028 if H3 stumbles)',
      arrival: 'Propulsive MOI 2027, then quasi-satellite orbits around ' +
        'Phobos (closest under 20 km); samples back to Earth in JFY 2031',
      payload: 'Orbiter + sampler + CNES/DLR Idefix rover; two touchdowns, >10 g',
      depJd: 2461358.5,            // 14 Nov 2026 (Type I reference)
      arrJd: 2461626.5,            // 9 Aug 2027
      returnJd: 2463231.5,         // samples home, JFY 2031
      v1: { x: -0.014673566, y: 0.012156155, z: -0.000090741 },
      c3: 9.2, vinfArr: 2.92
    },
    {
      key: 'rosalind',
      name: 'Rosalind Franklin',
      agency: 'ESA · NASA',
      color: '#9bd496',
      confidence: 'high',
      status: 'NET Oct 2028',
      blurb: 'Europe’s life-hunting rover, resurrected after losing its ' +
        'Russian ride: it will drill two metres into Oxia Planum — deeper ' +
        'than anything before it — where organics could survive the ' +
        'radiation-baked surface.',
      vehicle: 'Falcon Heavy, from LC-39A (NASA braking engines delivered June 2026)',
      arrival: 'Direct entry and propulsive terminal descent onto Oxia ' +
        'Planum, ~end Nov 2030 — after a 26-month, 1.4-revolution cruise',
      payload: 'Rover with 2 m drill + Pasteur life-detection suite',
      depJd: 2462054.5,            // 10 Oct 2028
      arrJd: 2462838.5,            // 3 Dec 2030 — one-rev transfer (see header)
      multirev: true,
      v1: { x: -0.004188665, y: 0.018636093, z: 0.001033956 },
      c3: 21.6, vinfArr: 3.60
    },
    {
      key: 'tianwen3',
      name: 'Tianwen-3',
      agency: 'CNSA',
      color: '#ff8585',
      confidence: 'high',
      status: 'Window Dec 2028 – Jan 2029',
      blurb: 'China’s Mars sample return: two Long March 5 launches — ' +
        'orbiter/returner and lander/ascender — a drill, a scouting drone, ' +
        'and at least 500 grams flying home around 2031. On the current ' +
        'schedule, the first Mars-surface sample return in history.',
      vehicle: '2 × Long March 5, from Wenchang',
      arrival: 'Propulsive MOI Oct 2029; surface drill + drone sampling; ' +
        'ascent vehicle to orbit rendezvous; Earth return ~2031',
      payload: 'Orbiter + returner + lander + ascender; ≥500 g via drill and drone',
      depJd: 2462107.5,            // 2 Dec 2028 (Type II reference)
      arrJd: 2462425.5,            // 16 Oct 2029
      returnJd: 2463100.5,         // Earth return ~mid 2031
      v1: { x: -0.018131852, y: 0.005856603, z: 0.000674612 },
      c3: 10.0, vinfArr: 3.26
    },
    {
      key: 'sr1',
      name: 'SR-1 Freedom',
      agency: 'NASA (announced 24 Mar 2026)',
      color: '#c9a8ff',
      confidence: 'aspirational',
      status: 'Targets Dec 2028 — aspirational',
      blurb: 'A nuclear-electric flagship demo: a 20 kWe fission reactor ' +
        'driving Hall thrusters, carrying three Ingenuity-class SkyFall ' +
        'helicopters. Bold enough that the trajectory itself is still an ' +
        'open question — shown here as a representative ballistic transfer.',
      vehicle: 'Gateway-PPE-derived bus; HALEU reactor + Brayton cycle; launcher TBD',
      arrival: 'Open question — chemical capture vs low-thrust spiral; ' +
        'deploys three SkyFall helicopters after arrival',
      payload: '20 kWe reactor demo + 3 SkyFall helicopters',
      depJd: 2462120.5,            // 15 Dec 2028 (representative)
      arrJd: 2462441.5,            // 1 Nov 2029 (representative)
      v1: { x: -0.018913708, y: 0.002030264, z: 0.000763130 },
      c3: 9.0, vinfArr: 3.66
    }
  ]
};
