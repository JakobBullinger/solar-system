/**
 * bodies.js — Astronomical data for the orrery.
 *
 * Orbital elements are Keplerian elements at epoch J2000 with per-century
 * rates, from the JPL "Approximate Positions of the Planets" tables
 * (valid 1800 AD – 2050 AD). Angles in degrees, distances in AU.
 *
 *   el: [ a, aDot, e, eDot, I, IDot, L, LDot, peri, periDot, node, nodeDot ]
 *       a    semi-major axis          L    mean longitude
 *       e    eccentricity             peri longitude of perihelion
 *       I    inclination              node longitude of ascending node
 */
window.ORRERY = window.ORRERY || {};

ORRERY.DATA = (function () {
  'use strict';

  var SUN = {
    key: 'sun',
    name: 'Sun',
    type: 'G-type main-sequence star',
    color: '#F2A63C',
    radiusKm: 696340,
    rotationHours: 609.12, // ~25.38 days at the equator
    axialTilt: 7.25,
    tempC: 5505,
    sceneRadius: 9,
    fact: 'The Sun holds 99.86% of the solar system’s mass. Every planet here is rounding error.',
    stats: [
      ['Diameter', '1,392,700 km'],
      ['Surface temp', '5,505 °C'],
      ['Core temp', '~15,000,000 °C'],
      ['Age', '~4.6 billion years']
    ]
  };

  var PLANETS = [
    {
      key: 'mercury', name: 'Mercury', type: 'Rocky planet',
      color: '#B8AFA6', radiusKm: 2439.7, rotationHours: 1407.6,
      axialTilt: 0.03, tempC: 167, moonCount: 0,
      el: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749,
           252.25032350, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081],
      fact: 'A single Mercury day (sunrise to sunrise) lasts 176 Earth days — two full Mercury years.',
      texture: 'mercury'
    },
    {
      key: 'venus', name: 'Venus', type: 'Rocky planet',
      color: '#E6C79A', radiusKm: 6051.8, rotationHours: -5832.5,
      axialTilt: 177.4, tempC: 464, moonCount: 0,
      el: [0.72333566, 0.00000390, 0.00677672, -0.00004107, 3.39467605, -0.00078890,
           181.97909950, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418],
      fact: 'Venus spins backwards, so its sun rises in the west — once every 117 Earth days.',
      texture: 'venus', atmo: '#F2DFB8', atmoI: 1.0
    },
    {
      key: 'earth', name: 'Earth', type: 'Rocky planet',
      color: '#6B93D6', radiusKm: 6371, rotationHours: 23.9345,
      axialTilt: 23.44, tempC: 15, moonCount: 1,
      el: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668,
           100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0.0, 0.0],
      fact: 'The only place in the universe confirmed to host life — and the only planet not named after a god.',
      texture: 'earth', atmo: '#7DB8FF', atmoI: 0.9,
      moons: [{
        key: 'moon', name: 'The Moon', radiusKm: 1737.4, orbitDays: 27.322,
        distanceKm: 384400, color: '#C4C0BA',
        fact: 'The Moon drifts 3.8 cm farther from Earth every year — dinosaurs saw it noticeably larger in the sky.'
      }]
    },
    {
      key: 'mars', name: 'Mars', type: 'Rocky planet',
      color: '#C1653F', radiusKm: 3389.5, rotationHours: 24.6229,
      axialTilt: 25.19, tempC: -63, moonCount: 2,
      el: [1.52371034, 0.00001847, 0.09339410, 0.00007882, 1.84969142, -0.00813131,
           -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343],
      fact: 'Olympus Mons rises 22 km above the Martian plains — two and a half Everests, stacked.',
      texture: 'mars', atmo: '#D9A06B', atmoI: 0.35
    },
    {
      key: 'jupiter', name: 'Jupiter', type: 'Gas giant',
      color: '#C8A06B', radiusKm: 69911, rotationHours: 9.925,
      axialTilt: 3.13, tempC: -110, moonCount: 95,
      el: [5.20288700, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714,
           34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106],
      fact: 'The Great Red Spot is a storm wider than Earth that has raged for at least 190 years.',
      texture: 'jupiter', atmo: '#C8B090', atmoI: 0.5,
      moons: [
        {
          key: 'io', name: 'Io', radiusKm: 1821.6, orbitDays: 1.769,
          distanceKm: 421700, color: '#D9C46A',
          fact: 'The most volcanic world known — Jupiter’s tides knead Io’s interior until it erupts from hundreds of active volcanoes.'
        },
        {
          key: 'europa', name: 'Europa', radiusKm: 1560.8, orbitDays: 3.551,
          distanceKm: 671100, color: '#C9B8A4',
          fact: 'Beneath its cracked ice shell lies a salty ocean holding more water than all of Earth’s seas combined.'
        },
        {
          key: 'ganymede', name: 'Ganymede', radiusKm: 2634.1, orbitDays: 7.155,
          distanceKm: 1070400, color: '#A79A8C',
          fact: 'The largest moon in the solar system — bigger than Mercury — and the only one with its own magnetic field.'
        },
        {
          key: 'callisto', name: 'Callisto', radiusKm: 2410.3, orbitDays: 16.689,
          distanceKm: 1882700, color: '#8E8378',
          fact: 'The most heavily cratered world we know: a four-billion-year-old surface that was never resurfaced.'
        }
      ]
    },
    {
      key: 'saturn', name: 'Saturn', type: 'Gas giant',
      color: '#DCC292', radiusKm: 58232, rotationHours: 10.7,
      axialTilt: 26.73, tempC: -140, moonCount: 274,
      el: [9.53667594, -0.00125060, 0.05386179, -0.00050991, 2.48599187, 0.00193609,
           49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794],
      fact: 'Saturn’s rings span 280,000 km yet average only about 10 metres thick.',
      texture: 'saturn', atmo: '#E8D5A8', atmoI: 0.5, hasRings: true,
      moons: [{
        key: 'titan', name: 'Titan', radiusKm: 2574.7, orbitDays: 15.945,
        distanceKm: 1221870, color: '#C79B5B',
        fact: 'The only moon with a thick atmosphere. Methane rain falls onto rivers and lakes of liquid natural gas at −179 °C.'
      }]
    },
    {
      key: 'uranus', name: 'Uranus', type: 'Ice giant',
      color: '#9BD4D6', radiusKm: 25362, rotationHours: -17.24,
      axialTilt: 97.77, tempC: -195, moonCount: 28,
      el: [19.18916464, -0.00196176, 0.04725744, -0.00004397, 0.77263783, -0.00242939,
           313.23810451, 428.48202785, 170.95427630, 0.40805281, 74.01692503, 0.04240589],
      fact: 'Uranus orbits tipped on its side — each pole gets 42 straight years of sunlight, then 42 of night.',
      texture: 'uranus', atmo: '#9BD4D6', atmoI: 0.55, hasRings: 'faint'
    },
    {
      key: 'neptune', name: 'Neptune', type: 'Ice giant',
      color: '#4A6FD4', radiusKm: 24622, rotationHours: 16.11,
      axialTilt: 28.32, tempC: -200, moonCount: 16,
      el: [30.06992276, 0.00026291, 0.00859048, 0.00005105, 1.77004347, 0.00035372,
           -55.12002969, 218.45945325, 44.96476227, -0.32241464, 131.78422574, -0.00508664],
      fact: 'Winds on Neptune reach 2,100 km/h — the fastest in the solar system, on the planet farthest from the Sun.',
      texture: 'neptune', atmo: '#6A8FE8', atmoI: 0.55
    },
    {
      key: 'pluto', name: 'Pluto', type: 'Dwarf planet',
      color: '#C9B29B', radiusKm: 1188.3, rotationHours: -153.3,
      axialTilt: 122.5, tempC: -225, moonCount: 5,
      el: [39.48211675, -0.00031596, 0.24882730, 0.00005170, 17.14001206, 0.00004818,
           238.92903833, 145.20780515, 224.06891629, -0.04062942, 110.30393684, -0.01183482],
      fact: 'Pluto and its moon Charon orbit a point in empty space between them — a true double world.',
      texture: 'pluto', atmo: '#B0A8C0', atmoI: 0.15
    }
  ];

  /**
   * Comets share the planets' element format. Rates are zero except LDot,
   * which encodes the mean motion (360° per period, per century). Mean
   * longitude at J2000 is derived from the epoch of a known perihelion
   * passage, so the time bar reproduces real apparitions.
   */
  var COMETS = [
    {
      key: 'halley', name: 'Halley', type: '1P — Short-period comet',
      isComet: true, color: '#9FD8E8', radiusKm: 5.5,
      el: [17.857, 0, 0.96714, 0, 162.262, 0,
           236.03, 477.04, 169.75, 0, 58.42, 0],
      fact: 'Tracked by astronomers since at least 240 BC, Halley returns every ~76 years. Its 1986 visit was met by a fleet of five spacecraft; the next show is in July 2061.',
      stats: [
        ['Nucleus', '15 × 8 km'],
        ['Orbital period', '~76 years'],
        ['Perihelion', '0.59 AU'],
        ['Aphelion', '35.1 AU'],
        ['Last perihelion', 'Feb 1986'],
        ['Next perihelion', 'Jul 2061']
      ]
    },
    {
      key: 'encke', name: 'Encke', type: '2P — Short-period comet',
      isComet: true, color: '#B9E3C6', radiusKm: 2.4,
      el: [2.2152, 0, 0.8483, 0, 11.78, 0,
           81.8, 10919.0, 161.11, 0, 334.57, 0],
      fact: 'The shortest period of any major comet — one lap every 3.3 years. Dust shed along its orbit rains down on Earth as the Taurid meteor showers every autumn.',
      stats: [
        ['Nucleus', '~4.8 km'],
        ['Orbital period', '3.3 years'],
        ['Perihelion', '0.34 AU'],
        ['Aphelion', '4.09 AU'],
        ['Debris trail', 'Taurid meteors']
      ]
    }
  ];

  return { SUN: SUN, PLANETS: PLANETS, COMETS: COMETS };
})();
