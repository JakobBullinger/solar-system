/**
 * stars.js — Data for the Powers of Ten cosmic zoom (level 22).
 *
 * Everything beyond the planets, hardcoded from real astronomy:
 *   - Voyager 1/2 state (2026-01-01 heliocentric distance + linear drift —
 *     both probes are on hyperbolic escape, so constant radial rate is
 *     accurate to well under 1% over ±decades),
 *   - the ~20 nearest star systems (J2000 RA/Dec, distance, spectral type),
 *   - the Local Group (distances in Mly, real sky directions),
 *   - galactic geometry (Sgr A* direction, north galactic pole, R₀).
 *
 * All directions are stored as J2000 equatorial RA/Dec and converted to the
 * app's scene frame (ecliptic, y-up) by dirFromRaDec, so every entry is
 * checkable against a star catalog at a glance. Distances stay in natural
 * units (AU / ly / Mly); the cosmos renderer works in AU throughout.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.COSMOS = (function () {
  'use strict';

  var DEG = Math.PI / 180;
  var EPS = 23.43928 * DEG;      // obliquity of the ecliptic, J2000
  var LY_AU = 63241.077;         // one light-year in AU
  var LIGHT_H_PER_AU = 0.1386;   // light-hours per AU

  /**
   * J2000 equatorial (RA hours, Dec degrees) → unit vector in the scene
   * frame. Equatorial → ecliptic is a rotation by the obliquity about the
   * equinox axis; ecliptic (x, y, z-north) → scene is (x, z, -y), matching
   * kepler.js toScene.
   */
  function dirFromRaDec(raHours, decDeg) {
    var ra = raHours * 15 * DEG, dec = decDeg * DEG;
    var xq = Math.cos(dec) * Math.cos(ra);
    var yq = Math.cos(dec) * Math.sin(ra);
    var zq = Math.sin(dec);
    var xe = xq;
    var ye = yq * Math.cos(EPS) + zq * Math.sin(EPS);
    var ze = -yq * Math.sin(EPS) + zq * Math.cos(EPS);
    return { x: xe, y: ze, z: -ye };
  }

  // --- Galactic geometry ------------------------------------------------------
  // Sgr A*: RA 17h45m40s, Dec −29°00′28″. North galactic pole: RA 12h51.4m,
  // Dec +27°08′. Sun–center distance R₀ ≈ 26,660 ly (GRAVITY 2021).
  var GALACTIC = {
    centerRa: 17.7611, centerDec: -29.008,
    poleRa: 12.8567, poleDec: 27.13,
    sunToCenterLy: 26660,
    discRadiusLy: 52850,          // ~105,700 ly stellar disc diameter
    sunOrbitMyr: 230              // one galactic year
  };

  // --- Voyagers ---------------------------------------------------------------
  // Distances anchored 2026-01-01 (JD 2461041.5) from the mission status
  // trend: V1 crossed the heliopause 2012-08-25 at 121.6 AU receding
  // 3.58 AU/yr; V2 crossed 2018-11-05 at 119.0 AU receding 3.24 AU/yr.
  var VOYAGERS = [
    {
      key: 'voyager1', name: 'Voyager 1', type: 'Interstellar probe',
      color: '#D7E4F5',
      ra: 17.27, dec: 12.4,                  // toward Ophiuchus, 35° N of ecliptic
      r0: 169.0, jd0: 2461041.5, auPerDay: 3.58 / 365.25,
      kms: 17.0,
      fact: 'The farthest human-made object. Its 1977-vintage transmitter radiates 23 watts — by the time the signal reaches Earth it is a billionth of a billionth of a watt.',
      stats: [
        ['Launched', '5 Sep 1977'],
        ['Crossed heliopause', '25 Aug 2012 · 121.6 AU'],
        ['Speed', '17.0 km/s (3.6 AU/yr)'],
        ['Carries', 'the Golden Record'],
        ['Next stop', 'passes 1.6 ly from Gliese 445 in ~40,000 yr']
      ]
    },
    {
      key: 'voyager2', name: 'Voyager 2', type: 'Interstellar probe',
      color: '#D7E4F5',
      ra: 20.083, dec: -58.9,                // toward Pavo, deep south
      r0: 142.1, jd0: 2461041.5, auPerDay: 3.24 / 365.25,
      kms: 15.4,
      fact: 'The only spacecraft to have visited Uranus and Neptune. It left the Sun’s bubble in 2018, six years after its twin, heading south of the ecliptic.',
      stats: [
        ['Launched', '20 Aug 1977'],
        ['Crossed heliopause', '5 Nov 2018 · 119.0 AU'],
        ['Speed', '15.4 km/s (3.2 AU/yr)'],
        ['Grand Tour', 'Jupiter · Saturn · Uranus · Neptune'],
        ['Next stop', 'passes 1.7 ly from Ross 248 in ~40,000 yr']
      ]
    }
  ];

  /** Heliocentric position (AU, scene axes) of a Voyager at Julian date jd. */
  function voyagerPos(v, jd) {
    var r = v.r0 + (jd - v.jd0) * v.auPerDay;
    var d = dirFromRaDec(v.ra, v.dec);
    return { x: d.x * r, y: d.y * r, z: d.z * r, r: r };
  }

  // --- Heliosphere ------------------------------------------------------------
  var HELIOPAUSE = {
    noseAu: 121,                              // V1 crossing, upwind side
    noseRa: 17.2, noseDec: 17,                // opposite the ISM helium inflow
    tailCapAu: 350
  };

  // Sedna — the bridge object between the Kuiper belt and the inner Oort
  // cloud: perihelion 76 AU, aphelion ~937 AU, period ~11,400 yr.
  var SEDNA = { a: 506, e: 0.8496, i: 11.93, node: 144.25, argPeri: 311.29 };

  // --- The 20 nearest star systems ---------------------------------------------
  // J2000 RA/Dec, distance in light-years, spectral type of the primary.
  // Colors follow spectral class: A bluish-white → M deep orange, L/T/Y
  // (brown dwarfs) magenta-violet.
  var STARS = [
    { key: 'alphacen', name: 'Alpha Centauri', ra: 14.660, dec: -60.83, ly: 4.37,
      spec: 'G2V + K1V + M5.5Ve', color: '#FFF3D6', mag: 1.35,
      fact: 'Triple system and our nearest neighbours. Proxima, the faint red third star, hosts Proxima b — a rocky planet in the habitable zone, 4.25 light-years from your chair.',
      stats: [['Distance', '4.37 ly'], ['Stars', '3 (A, B + Proxima)'], ['Planets', 'Proxima b, d (+ candidates)'], ['Note', 'closest star system to the Sun']] },
    { key: 'barnard', name: "Barnard's Star", ra: 17.963, dec: 4.70, ly: 5.96,
      spec: 'M4V', color: '#FF9E6B', mag: 0.55,
      fact: 'The fastest-moving star in our sky — it crosses a full Moon’s width every 180 years. In 11,800 years it will be the closest star of all.',
      stats: [['Distance', '5.96 ly'], ['Type', 'red dwarf'], ['Planets', 'Barnard b (2024)'], ['Proper motion', '10.4″/yr — the record']] },
    { key: 'luhman16', name: 'Luhman 16', ra: 10.820, dec: -53.32, ly: 6.52,
      spec: 'L7.5 + T0.5', color: '#C77DDB', mag: 0.4,
      fact: 'A pair of brown dwarfs — failed stars too small to ignite hydrogen. Discovered only in 2013, hiding in the glare of the galactic plane.',
      stats: [['Distance', '6.52 ly'], ['Type', 'brown dwarf binary'], ['Discovered', '2013 (WISE)'], ['Note', 'closest brown dwarfs known']] },
    { key: 'wise0855', name: 'WISE 0855−0714', ra: 8.920, dec: -7.23, ly: 7.43,
      spec: 'Y2', color: '#9D6BD6', mag: 0.3,
      fact: 'The coldest known object outside a planetary system: about −30 °C, colder than a winter day. It likely has water-ice clouds.',
      stats: [['Distance', '7.43 ly'], ['Type', 'Y-dwarf (sub-brown dwarf)'], ['Temperature', '≈ −48 to −13 °C'], ['Mass', '~3–10 Jupiters']] },
    { key: 'wolf359', name: 'Wolf 359', ra: 10.942, dec: 7.01, ly: 7.86,
      spec: 'M6V', color: '#FF8A5C', mag: 0.45,
      fact: 'A tiny flare star — barely bigger than Jupiter, a ten-thousandth the Sun’s light, but capable of X-ray flares that briefly outshine everything it has.',
      stats: [['Distance', '7.86 ly'], ['Type', 'red dwarf, flare star'], ['Luminosity', '0.001% of the Sun'], ['Pop culture', 'site of a famous Star Trek battle']] },
    { key: 'lalande', name: 'Lalande 21185', ra: 11.055, dec: 35.97, ly: 8.31,
      spec: 'M2V', color: '#FFA477', mag: 0.6,
      fact: 'The brightest red dwarf of the northern sky — still six times too faint for the naked eye. Two confirmed planets orbit it.',
      stats: [['Distance', '8.31 ly'], ['Type', 'red dwarf'], ['Planets', '2 confirmed'], ['Visible?', 'binoculars only']] },
    { key: 'sirius', name: 'Sirius', ra: 6.752, dec: -16.72, ly: 8.66,
      spec: 'A1V + DA2', color: '#CBD9FF', mag: 1.7,
      fact: 'The brightest star in Earth’s night sky, 25 times the Sun’s luminosity — orbited by Sirius B, a white dwarf the size of Earth with the mass of the Sun.',
      stats: [['Distance', '8.66 ly'], ['Stars', '2 (A + white dwarf B)'], ['Luminosity', '25 × Sun'], ['Note', 'brightest star in our sky']] },
    { key: 'luyten726', name: 'Luyten 726-8', ra: 1.650, dec: -17.95, ly: 8.79,
      spec: 'M5.5V + M6V', color: '#FF8A5C', mag: 0.4,
      fact: 'Home of UV Ceti, the prototype flare star: in 1952 it brightened 75-fold in twenty seconds.',
      stats: [['Distance', '8.79 ly'], ['Stars', '2 red dwarfs'], ['Note', 'UV Ceti = the archetypal flare star']] },
    { key: 'ross154', name: 'Ross 154', ra: 18.830, dec: -23.84, ly: 9.71,
      spec: 'M3.5V', color: '#FF9E6B', mag: 0.45,
      fact: 'A quiet red dwarf in Sagittarius, in the direction of the galactic centre. Voyager-class probes would need 60,000 years to reach it.',
      stats: [['Distance', '9.71 ly'], ['Type', 'red dwarf, mild flare star']] },
    { key: 'ross248', name: 'Ross 248', ra: 23.698, dec: 44.17, ly: 10.30,
      spec: 'M5.5V', color: '#FF8A5C', mag: 0.4,
      fact: 'In about 40,000 years Voyager 2 will drift within 1.7 light-years of this star — its first stellar encounter after leaving home.',
      stats: [['Distance', '10.30 ly'], ['Type', 'red dwarf'], ['Note', 'Voyager 2’s first port of call']] },
    { key: 'epseri', name: 'Epsilon Eridani', ra: 3.548, dec: -9.46, ly: 10.47,
      spec: 'K2V', color: '#FFD9A6', mag: 0.9,
      fact: 'A young Sun-in-the-making, under a billion years old, with a Jupiter-like planet and two asteroid belts — a snapshot of our own system’s childhood.',
      stats: [['Distance', '10.47 ly'], ['Type', 'orange dwarf'], ['Planets', 'ε Eri b + debris discs'], ['Age', '< 1 billion yr']] },
    { key: 'lacaille', name: 'Lacaille 9352', ra: 23.098, dec: -35.85, ly: 10.72,
      spec: 'M0.5V', color: '#FFB185', mag: 0.55,
      fact: 'The nearest star with a directly measured super-Earth pair — two planets found by radial velocity in 2020.',
      stats: [['Distance', '10.72 ly'], ['Type', 'red dwarf'], ['Planets', '2 super-Earths']] },
    { key: 'ross128', name: 'Ross 128', ra: 11.795, dec: 0.80, ly: 11.01,
      spec: 'M4V', color: '#FF9E6B', mag: 0.45,
      fact: 'Orbited by Ross 128 b, one of the most temperate Earth-sized worlds known — and its star is unusually calm for a red dwarf, which bodes well for life.',
      stats: [['Distance', '11.01 ly'], ['Type', 'quiet red dwarf'], ['Planets', 'Ross 128 b (~1.35 M⊕)']] },
    { key: 'ezaqr', name: 'EZ Aquarii', ra: 22.643, dec: -15.30, ly: 11.27,
      spec: 'M5V ×3', color: '#FF8A5C', mag: 0.35,
      fact: 'Three red dwarfs locked in a gravitational dance — the inner pair circles in under four days.',
      stats: [['Distance', '11.27 ly'], ['Stars', '3 red dwarfs']] },
    { key: 'procyon', name: 'Procyon', ra: 7.655, dec: 5.22, ly: 11.46,
      spec: 'F5IV + DQZ', color: '#F4F3FF', mag: 1.4,
      fact: 'The eighth-brightest star in our sky, already swelling into a subgiant — and like Sirius, it tows a white dwarf companion.',
      stats: [['Distance', '11.46 ly'], ['Stars', '2 (F subgiant + white dwarf)'], ['Luminosity', '7 × Sun']] },
    { key: '61cygni', name: '61 Cygni', ra: 21.115, dec: 38.75, ly: 11.40,
      spec: 'K5V + K7V', color: '#FFD9A6', mag: 0.8,
      fact: 'The first star whose distance was ever measured — Bessel’s 1838 parallax of this pair put a ruler on the universe for the first time.',
      stats: [['Distance', '11.40 ly'], ['Stars', '2 orange dwarfs'], ['History', 'first stellar parallax, 1838']] },
    { key: 'struve2398', name: 'Struve 2398', ra: 18.713, dec: 59.62, ly: 11.49,
      spec: 'M3V + M3.5V', color: '#FF9E6B', mag: 0.45,
      fact: 'A binary of flare stars in Draco; the fainter one hosts two candidate planets.',
      stats: [['Distance', '11.49 ly'], ['Stars', '2 red dwarfs']] },
    { key: 'groombridge34', name: 'Groombridge 34', ra: 0.307, dec: 44.02, ly: 11.62,
      spec: 'M1.5V + M3.5V', color: '#FFA477', mag: 0.5,
      fact: 'Two red dwarfs 147 AU apart; the brighter one carries at least two planets, including a nearby super-Earth.',
      stats: [['Distance', '11.62 ly'], ['Stars', '2 red dwarfs'], ['Planets', 'GX And b, c']] },
    { key: 'epsind', name: 'Epsilon Indi', ra: 22.057, dec: -56.78, ly: 11.87,
      spec: 'K5V + T1 + T6', color: '#FFD9A6', mag: 0.85,
      fact: 'An orange dwarf trailed by two brown dwarfs — and its giant planet ε Ind Ab became, in 2024, the coldest exoplanet ever imaged directly (by JWST).',
      stats: [['Distance', '11.87 ly'], ['System', 'K dwarf + 2 brown dwarfs'], ['Planets', 'ε Ind Ab — imaged by JWST']] },
    { key: 'tauceti', name: 'Tau Ceti', ra: 1.735, dec: -15.94, ly: 11.91,
      spec: 'G8V', color: '#FFEFCB', mag: 1.0,
      fact: 'The nearest single Sun-like star — a favourite of SETI searches since 1960, with four candidate super-Earths, two skirting the habitable zone.',
      stats: [['Distance', '11.91 ly'], ['Type', 'G dwarf (Sun-like)'], ['Planets', '4 candidates'], ['Note', 'target of the first SETI search']] }
  ];

  // --- The Local Group ----------------------------------------------------------
  // kind: 'disc' galaxies get a painted spiral; 'blob' galaxies a soft glow.
  var GALAXIES = [
    { key: 'lmc', name: 'Large Magellanic Cloud', ra: 5.393, dec: -69.76, mly: 0.163,
      type: 'Magellanic spiral', sizeLy: 32200, kind: 'blob', color: '#BFD4F2', glow: 1.0,
      fact: 'The Milky Way’s brightest satellite, visible to the southern naked eye as a detached wisp of sky. Home of the Tarantula Nebula, the most violent star factory nearby.',
      stats: [['Distance', '163,000 ly'], ['Diameter', '~32,000 ly'], ['Stars', '~30 billion'], ['Fate', 'merges with us in ~2.4 Gyr']] },
    { key: 'smc', name: 'Small Magellanic Cloud', ra: 0.878, dec: -72.80, mly: 0.203,
      type: 'Dwarf irregular', sizeLy: 18900, kind: 'blob', color: '#B4C9E8', glow: 0.8,
      fact: 'The LMC’s ragged little sibling, trailing a bridge of gas torn loose by tides. Henrietta Leavitt’s study of its pulsing stars gave astronomy its first cosmic ruler.',
      stats: [['Distance', '203,000 ly'], ['Diameter', '~18,900 ly'], ['History', 'birthplace of the period–luminosity law']] },
    { key: 'sculptor', name: 'Sculptor Dwarf', ra: 1.003, dec: -33.71, mly: 0.29,
      type: 'Dwarf spheroidal', sizeLy: 3000, kind: 'blob', color: '#8E9BB5', glow: 0.35,
      fact: 'The first dwarf spheroidal ever found (1937) — a ghostly swarm of ancient stars, a thousand times fainter than the Milky Way.',
      stats: [['Distance', '290,000 ly'], ['Type', 'dwarf spheroidal satellite']] },
    { key: 'fornax', name: 'Fornax Dwarf', ra: 2.665, dec: -34.45, mly: 0.46,
      type: 'Dwarf spheroidal', sizeLy: 2000, kind: 'blob', color: '#8E9BB5', glow: 0.4,
      fact: 'A dwarf satellite rich enough to own six globular clusters of its own — a puzzle, since dark-matter friction should have sunk them long ago.',
      stats: [['Distance', '460,000 ly'], ['Note', 'has 6 globular clusters']] },
    { key: 'leo1', name: 'Leo I', ra: 10.142, dec: 12.31, mly: 0.82,
      type: 'Dwarf spheroidal', sizeLy: 2000, kind: 'blob', color: '#8E9BB5', glow: 0.35,
      fact: 'One of the most distant Milky Way satellites, hiding in the glare of the bright star Regulus.',
      stats: [['Distance', '820,000 ly'], ['Type', 'dwarf spheroidal satellite']] },
    { key: 'ngc6822', name: "Barnard's Galaxy", ra: 19.748, dec: -14.80, mly: 1.63,
      type: 'Barred irregular', sizeLy: 7000, kind: 'blob', color: '#A9BCD9', glow: 0.55,
      fact: 'NGC 6822 — Edwin Hubble proved in 1925 that this smudge lies beyond the Milky Way, the first object ever shown to be another galaxy’s worth away.',
      stats: [['Distance', '1.63 Mly'], ['History', 'first system proven extragalactic']] },
    { key: 'ic10', name: 'IC 10', ra: 0.339, dec: 59.29, mly: 2.2,
      type: 'Starburst dwarf', sizeLy: 5000, kind: 'blob', color: '#C4CFE6', glow: 0.5,
      fact: 'The Local Group’s only starburst galaxy — furiously forming stars behind the dust of our own galactic plane.',
      stats: [['Distance', '2.2 Mly'], ['Type', 'starburst dwarf irregular']] },
    { key: 'ic1613', name: 'IC 1613', ra: 1.080, dec: 2.13, mly: 2.38,
      type: 'Dwarf irregular', sizeLy: 10000, kind: 'blob', color: '#A9BCD9', glow: 0.45,
      fact: 'A serene, dust-free dwarf whose pulsating stars helped calibrate the cosmic distance scale.',
      stats: [['Distance', '2.38 Mly'], ['Type', 'dwarf irregular']] },
    { key: 'm31', name: 'Andromeda Galaxy', ra: 0.712, dec: 41.27, mly: 2.54,
      type: 'Spiral galaxy (SA b)', sizeLy: 152000, kind: 'disc', color: '#D8E2F5', glow: 1.6,
      tiltDeg: 77, paDeg: 38,
      fact: 'M31 — a trillion stars, the most distant thing the naked eye can see. It is falling toward us at 110 km/s; in ~4.5 billion years it and the Milky Way become one.',
      stats: [['Distance', '2.54 Mly'], ['Diameter', '~152,000 ly'], ['Stars', '~1 trillion'], ['Approach', '110 km/s — merger in ~4.5 Gyr']] },
    { key: 'm32', name: 'M32', ra: 0.712, dec: 40.87, mly: 2.49,
      type: 'Compact elliptical', sizeLy: 6500, kind: 'blob', color: '#E3DAC8', glow: 0.5,
      fact: 'A dense little elliptical pressed against Andromeda’s disc — possibly the stripped core of a much larger galaxy Andromeda already ate.',
      stats: [['Distance', '2.49 Mly'], ['Type', 'compact elliptical satellite of M31']] },
    { key: 'm110', name: 'M110', ra: 0.673, dec: 41.69, mly: 2.69,
      type: 'Dwarf elliptical', sizeLy: 15000, kind: 'blob', color: '#DCD5C9', glow: 0.55,
      fact: 'Andromeda’s other bright companion, a smooth elliptical with an oddly fresh sprinkling of young stars.',
      stats: [['Distance', '2.69 Mly'], ['Type', 'dwarf elliptical satellite of M31']] },
    { key: 'm33', name: 'Triangulum Galaxy', ra: 1.564, dec: 30.66, mly: 2.73,
      type: 'Spiral galaxy (SA cd)', sizeLy: 60000, kind: 'disc', color: '#CCDCF0', glow: 1.1,
      tiltDeg: 54, paDeg: 23,
      fact: 'M33 — the Local Group’s third spiral, a flocculent pinwheel probably bound to Andromeda. It hosts NGC 604, a nebula 40 times the size of Orion’s.',
      stats: [['Distance', '2.73 Mly'], ['Diameter', '~60,000 ly'], ['Stars', '~40 billion']] },
    { key: 'wlm', name: 'Wolf–Lundmark–Melotte', ra: 0.033, dec: -15.46, mly: 3.04,
      type: 'Dwarf irregular', sizeLy: 8000, kind: 'blob', color: '#9FB0CC', glow: 0.4,
      fact: 'A hermit on the Local Group’s edge — so isolated it has evolved a whole galactic life untouched by neighbours.',
      stats: [['Distance', '3.04 Mly'], ['Note', 'one of the most isolated Local Group members']] }
  ];

  // The Milky Way's own dossier (the stage-4 galaxy + "You are here" marker).
  var MILKY_WAY = {
    key: 'milkyway', name: 'Milky Way', type: 'Barred spiral galaxy (SBbc)',
    color: '#E8DFC8',
    fact: 'Our galaxy: a barred spiral of 200–400 billion stars. The Sun rides the Orion Arm, 26,660 ly from the central black hole Sgr A*, completing one orbit every 230 million years — it has made about 20 laps since it formed.',
    stats: [
      ['Stellar disc', '~105,700 ly across'],
      ['Stars', '200–400 billion'],
      ['Sun’s position', 'Orion Arm, 26,660 ly out'],
      ['Galactic year', '230 million years'],
      ['Central black hole', 'Sgr A* — 4.15 million M☉']
    ]
  };

  return {
    LY_AU: LY_AU,
    LIGHT_H_PER_AU: LIGHT_H_PER_AU,
    dirFromRaDec: dirFromRaDec,
    GALACTIC: GALACTIC,
    VOYAGERS: VOYAGERS,
    voyagerPos: voyagerPos,
    HELIOPAUSE: HELIOPAUSE,
    SEDNA: SEDNA,
    STARS: STARS,
    GALAXIES: GALAXIES,
    MILKY_WAY: MILKY_WAY
  };
})();
