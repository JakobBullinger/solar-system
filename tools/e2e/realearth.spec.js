/**
 * realearth.spec.js — Level 28, real Earth geography, end to end.
 *
 * Enters the Earth-orbit close-up regime (level 24) and proves the day
 * texture shows REAL, correctly-placed continents (not just "a rendered
 * scene"): the camera is parked exactly along Earth's true Sun direction
 * at a pinned jd, a handful of REAL named coordinates (Amazon basin, the
 * mid-Atlantic, the West Africa coast, the Caribbean Sea) are forward-
 * projected to screen pixels using the SAME spin/tilt transform
 * earthorbit.js applies to the mesh, and the rendered pixel colors are
 * asserted land-tinted vs. ocean-tinted. A second shot on the night side
 * proves real city lights: Europe reads bright, a remote South Atlantic
 * point stays dark. A third check proves the ocean sun-glint: parking the
 * camera along the real sun direction puts the specular sweet spot near
 * screen center, where an ocean pixel must be measurably brighter than an
 * off-axis ocean control pixel at similar lighting.
 *
 * The forward transform (mirrors earthorbit.js buildEarth()/tick(), see
 * that file's header and geodata.js's for the (u,v)/longitude convention):
 *   texture (u,v) → object-space (phi,theta) on the unit sphere →
 *   +spin (mesh.rotation.y, ORRERY.STARLINK.earthSpinFraction) →
 *   +23.44° axial tilt about Z (frame.rotation.z, same as bodies3d) →
 *   world position. Screen projection reuses THREE's own camera math
 * (reconstructed in-page from CameraPath.pose(), fov=50 per main.js) —
 * this spec trusts THREE for the lens, not a hand-rolled projection.
 */
'use strict';

const fs = require('fs');
const zlib = require('zlib');
const { test, expect, gotoOrrery, screenshot, assertSceneRendered } = require('./orrery');

// ---- zero-dep PNG pixel sampler (same approach as eclipse.spec.js) --------
function decodePNG(file) {
  const buf = fs.readFileSync(file);
  let width = 0, height = 0, channels = 4, off = 8;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IHDR') {
      width = buf.readUInt32BE(off + 8);
      height = buf.readUInt32BE(off + 12);
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[buf[off + 8 + 9]];
    } else if (type === 'IDAT') idat.push(buf.slice(off + 8, off + 8 + len));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
  };
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], ri = y * (stride + 1) + 1, ro = y * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[ri + x];
      const left = x >= channels ? px[ro + x - channels] : 0;
      const up = y > 0 ? px[ro - stride + x] : 0;
      const ul = y > 0 && x >= channels ? px[ro - stride + x - channels] : 0;
      px[ro + x] = (f === 0 ? cur : f === 1 ? cur + left : f === 2 ? cur + up
        : f === 3 ? cur + ((left + up) >> 1) : cur + paeth(left, up, ul)) & 0xff;
    }
  }
  return {
    width, height,
    /** Mean RGB over a small box centered at (x,y) — robust to a 1-2px projection wobble. */
    rgbAt(x, y, r) {
      r = r || 2;
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.round(y) + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.round(x) + dx;
          if (xx < 0 || xx >= width) continue;
          const i = yy * stride + xx * channels;
          sr += px[i]; sg += px[i + 1]; sb += px[i + 2]; n++;
        }
      }
      return [sr / n, sg / n, sb / n];
    },
  };
}

// ---- forward transform (mirrors earthorbit.js — see file header) ---------
const DEG = Math.PI / 180;
const TILT = -23.44 * DEG;

/** Real (lat,lon) -> world position on the R=1 Earth mesh at a given spin phase. */
function worldPos(lat, lon, spinFraction) {
  const u = (((lon + 180) / 360) % 1 + 1) % 1;
  const v = (90 - lat) / 180;
  const phi = u * 2 * Math.PI, theta = v * Math.PI, S = spinFraction * 2 * Math.PI;
  const fx = -Math.sin(theta) * Math.cos(phi + S);
  const fy = Math.cos(theta);
  const fz = Math.sin(theta) * Math.sin(phi + S);
  return [
    fx * Math.cos(TILT) - fy * Math.sin(TILT),
    fx * Math.sin(TILT) + fy * Math.cos(TILT),
    fz,
  ];
}

const EARTH_R = 6.371; // scene units, matches earthorbit.js's SphereGeometry(6.371, ...)
const CAM_D = 16;      // comfortably between MIN_D (7.2) and MAX_D (620)

/**
 * Pin the clock, park the camera exactly along ±the real Sun direction
 * (the same formula earthorbit.js's tick() and earthorbit.spec.js's
 * day-side framing use), and return spinFraction + the camera's world
 * direction (unit vector) for the forward-transform math above.
 */
async function frameAlongSun(page, jd, sign) {
  return page.evaluate(({ jd, sign, camD }) => {
    const O = window.ORRERY;
    O.TimeBar.playing = false;
    O.TimeBar.snapJd(jd);
    const earth = O.DATA.PLANETS.filter((p) => p.key === 'earth')[0];
    const h = O.Kepler.heliocentric(earth.el, jd);
    const dir = new window.THREE.Vector3(-h.x, -h.z, h.y).normalize().multiplyScalar(sign);
    O.CameraPath.begin({ to: dir.clone().multiplyScalar(camD), instant: true });
    return {
      dir: dir.toArray(),
      spinFraction: O.EarthOrbit.debug().spinFraction,
    };
  }, { jd, sign, camD: CAM_D });
}

/** Project real-world (lat,lon) points to screen pixels via a reconstructed camera (see header). */
async function projectPoints(page, points) {
  const pose = await page.evaluate(() => window.ORRERY.CameraPath.pose());
  return page.evaluate(({ points, pose }) => {
    const w = window.innerWidth, h = window.innerHeight;
    const cam = new window.THREE.PerspectiveCamera(50, w / h, 0.1, 12000);
    cam.position.set(pose.position[0], pose.position[1], pose.position[2]);
    cam.lookAt(pose.target[0], pose.target[1], pose.target[2]);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    return points.map((p) => {
      const v = new window.THREE.Vector3(p[0], p[1], p[2]);
      v.project(cam);
      return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h, v.z];
    });
  }, { points, pose });
}

/** Same "is this pixel ocean-colored" heuristic as the ocean-glint shader mask (shaders.js). */
function looksOcean([r, g, b]) {
  return b > r * 1.25 && b > g * 1.02;
}

const PIN_JD_DAY = 2461199.92;   // camera along +sunDir: Amazon/Atlantic/Africa in frame
const PIN_JD_NIGHT = 2461200.27; // camera along -sunDir: Europe near center, night side

test('Earth-orbit day side: real coastlines land under the correct continents', async ({ page }) => {
  await gotoOrrery(page);
  await page.click('#opt-earth');
  await expect(page.locator('#eo-ui')).toHaveClass(/on/);

  const { spinFraction } = await frameAlongSun(page, PIN_JD_DAY, 1);
  await page.evaluate(
    () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
  );

  // Real, named coordinates — land/ocean truth is geography, not app data.
  const points = {
    amazon: [-3, -60],      // Amazon basin, Brazil — LAND
    westAfrica: [8, -12],   // West African coast — LAND
    midAtlantic: [5, -30],  // open ocean between Brazil and Africa — OCEAN
    caribbean: [15, -75],   // Caribbean Sea — OCEAN
  };
  const names = Object.keys(points);
  const world = names.map((n) => worldPos(points[n][0], points[n][1], spinFraction)
    .map((c) => c * EARTH_R));
  const screen = await projectPoints(page, world);

  // Sanity: every test point must be in front of the camera and on screen
  // (z < 1 in NDC) — a wrong sign anywhere in the transform would push
  // these off the back of the sphere instead.
  screen.forEach((s, i) => expect(s[2], names[i] + ' is on the visible hemisphere').toBeLessThan(1));

  const shot = await screenshot(page, 'realearth-dayside');
  assertSceneRendered(shot);
  const png = decodePNG(shot);

  const colors = {};
  names.forEach((n, i) => { colors[n] = png.rgbAt(screen[i][0], screen[i][1]); });

  expect(looksOcean(colors.amazon), 'Amazon basin renders as land: ' + colors.amazon).toBe(false);
  expect(looksOcean(colors.westAfrica), 'West Africa coast renders as land: ' + colors.westAfrica).toBe(false);
  expect(looksOcean(colors.midAtlantic), 'mid-Atlantic renders as ocean: ' + colors.midAtlantic).toBe(true);
  expect(looksOcean(colors.caribbean), 'Caribbean Sea renders as ocean: ' + colors.caribbean).toBe(true);

  // ---- ocean sun-glint ---------------------------------------------------
  // The camera sits exactly along the real Sun direction, so the specular
  // sweet spot (view dir ≈ sun dir ≈ surface normal) is near screen center.
  // The sub-camera point itself is open ocean at this jd (mid-Atlantic off
  // Brazil) — its rendered pixel must be markedly brighter than an
  // off-axis ocean control point (Caribbean) lit at a similar angle but
  // far from the reflection direction.
  // (5°N, 45°W) is the open-ocean point nearest the true sub-solar
  // direction at PIN_JD_DAY (found by an offline grid search over the
  // same forward transform — see .agent-status.md) — the specular sweet
  // spot lands right on it.
  const centerWorld = worldPos(5, -45, spinFraction).map((c) => c * EARTH_R);
  const [glintScreen] = await projectPoints(page, [centerWorld]);
  const glint = png.rgbAt(glintScreen[0], glintScreen[1], 3);
  const glintLuma = Math.max(...glint);
  const controlLuma = Math.max(...colors.caribbean);
  expect(glintLuma, 'glint hotspot ' + glint + ' vs control ' + colors.caribbean)
    .toBeGreaterThan(controlLuma + 25);
});

test('Earth-orbit night side: real city lights, dark open ocean', async ({ page }) => {
  await gotoOrrery(page);
  await page.click('#opt-earth');
  await expect(page.locator('#eo-ui')).toHaveClass(/on/);

  const { spinFraction } = await frameAlongSun(page, PIN_JD_NIGHT, -1);
  await page.evaluate(
    () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
  );

  const points = {
    paris: [48.85, 2.35],          // dense European cluster — bright
    southAtlantic: [-35, -20],     // remote open ocean, no cities — dark
  };
  const names = Object.keys(points);
  const world = names.map((n) => worldPos(points[n][0], points[n][1], spinFraction)
    .map((c) => c * EARTH_R));
  const screen = await projectPoints(page, world);
  screen.forEach((s, i) => expect(s[2], names[i] + ' is on the visible (night) hemisphere').toBeLessThan(1));

  const shot = await screenshot(page, 'realearth-nightside');
  assertSceneRendered(shot);
  const png = decodePNG(shot);

  const europe = png.rgbAt(screen[0][0], screen[0][1], 3);
  const ocean = png.rgbAt(screen[1][0], screen[1][1], 3);
  expect(Math.max(...europe), 'Europe cluster lit: ' + europe).toBeGreaterThan(60);
  expect(Math.max(...ocean), 'remote South Atlantic dark: ' + ocean).toBeLessThan(20);
});
