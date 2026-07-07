/**
 * geodata.js — Level 28: real Earth geography, baked offline.
 *
 * Two real datasets, baked at build time so the runtime stays fully
 * offline (no network, no image assets — everything below is inline data):
 *
 *   landmask   A 1440×720 (0.25°) boolean land/ocean grid derived from the
 *              real NASA "Blue Marble" specular map (water reflects the
 *              Sun specularly, land doesn't, so the map IS a land/ocean
 *              mask) — the same `earth_specular_2048.jpg` shipped with the
 *              three.js example gallery. Bake recipe (offline, one-time —
 *              rerun only if re-baking from a fresh source): downsample to
 *              1440×720, threshold the specular luminance (<110 ⇒ land),
 *              denoise with a 3×3 majority filter (kills JPEG speckle
 *              around coastlines), then row-major run-length-encode
 *              (varint run lengths, base64) — real coastlines in ~14 KB.
 *              Resolution floor: small oceanic islands under roughly one
 *              grid cell (~28 km) don't survive the denoise — a handful of
 *              CITIES below (Apia, Honolulu, Male) sit on real islands too
 *              small for this grid to see as land; test/geodata.test.js
 *              documents the exact list.
 *   CITIES     ~265 real cities (name, lat, lon, intensity); intensity is
 *              sampled from the real NASA "Black Marble" night-lights
 *              composite (`earth_lights_2048.png`, same three.js gallery)
 *              at each city's coordinate, normalized 0–1 — so relative
 *              brightness (Tokyo/NYC/London near 1.0, a Sahel capital
 *              near 0.2) reflects the real satellite photometry, not a
 *              guess.
 *
 * Desert belts are a short list of real, well-known arid regions (Sahara,
 * Arabian, Kalahari/Namib, Australian Outback, Gobi/Taklamakan, Atacama,
 * the North American Southwest, the Iranian plateau) used only to bias
 * the land tint in textures.js — a coarse, cheap biome hint layered over
 * the real coastlines, not a precise classification.
 *
 * Longitude convention: pixel column x of the SOURCE images runs
 * lon = x/W·360 − 180 (x=0 at the anti-meridian, increasing eastward) —
 * standard equirectangular, and exactly the convention three.js's own
 * earth demos use unflipped on a SphereGeometry (u=0 → object-space
 * −X → world position after `mesh.rotation.y` is a pure phase shift of
 * that same u, so this mapping renders right-way-out, not mirrored).
 * `textures.js` calls this module with the SAME (u, v) fractions its
 * pixel loop already uses (u = x/W, v = y/H of the CANVAS being painted),
 * so land/ocean and city lights land under the correct part of the spin —
 * see main.js's `spins` phase formula, which this module's grid indexing
 * matches by construction (both key off fractional x/width).
 *
 * Pure data + arithmetic — no THREE, no DOM — loads in plain Node
 * (test/geodata.test.js) exactly like data/bodies.js and data/starlink.js.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.GeoData = (function () {
  'use strict';

  // ---- base64 (no atob/Buffer dependency — plain Node loads this too) ------
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64decode(s) {
    var lookup = {};
    for (var i = 0; i < B64.length; i++) lookup[B64.charAt(i)] = i;
    s = s.replace(/=+$/, '');
    var bytes = [];
    var buffer = 0, bits = 0;
    for (var j = 0; j < s.length; j++) {
      var c = s.charAt(j);
      if (lookup[c] === undefined) continue; // skip stray whitespace/newlines
      buffer = (buffer << 6) | lookup[c];
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 0xff);
      }
    }
    return bytes;
  }

  function wrapIdx(x, w) { return ((x % w) + w) % w; }

  // ---- Landmask: real coastlines, RLE + base64 (see header) ----------------
  var LAND_W = 1440, LAND_H = 720, LAND_START = 0;
  var LAND_RLE =
    '+agCKfQKLs0JAg0IAxVdCgoCAjTCCUdLEQNDpgkDCQICUCsFElikCQsCVRIJEAoPNAkNpAlnFA8GBQQQBTMDAgkLDQKVCWMPcQMWCgYZDewIYROKAQMMCgQD' +
    'AQUQ3wgFCloXlwEJHbUDAqcFDAslAy0LpAEGHa4CA4EBDaAFEgwCBQkDDgIpDb4BAgOoAgIKBX4QngUZDAkFNQvBAbACAgoDfhKbBRwCBAUKBAIDLA+6AQMF' +
    'lQELAwMCB4ABAooBFJkFJAQ9GbIBkQEECByLAgMCDwMEkgUlAjQDAh20AXwHBQMEBg4UkgIVlAUHAx4DIgIDJ7UBfBADCwsCAguVAhXxBAUoHgMhAwIluAF+' +
    'Ha8CFAcF5QQLICECIgIDF8QBgAEhtAIJBg3DBAQYEAgFDhUCMhHHAYQBCgQTwQISwAQEGg8HCwsPBjALzQGJAQUFDwcEuQITuwQJJAcICBECDQICKwzMAY0B' +
    'AgQOCQi1AgPKBAknBQkIHwIGHxfIAZQBDQsJ/wYKOQIfBwQcIAsDtAEBAY0BEA0IwQIEqgQCDwUYAUUmIQsDuAGOAQoVAr0CC50EDnEkIMgBBAWGAQnSAhCY' +
    'BBBQCRQpAQEexwEFBYoBBccBBoQBFZEECwEHGwQxDBEpAQEkvwGYAQLEAQqCARkDDf0DDAQCBgUSBhEDBwEFCQgKAggKAwUHDwcovgHZAg+AATD4AwkNDgsH' +
    'EAUEERMJWAcEAxCiAcYCGXECDjX7AwMFAgYSCwYEBAsBAxIVCXmgAb4CF3BNYwkGA44DAgQXBxAOERYMEw1bnAG3AhVxVmANAQYDBooDLRULBwgHMlaaAbYC' +
    'EG1hYBQDB4sDCQMeGAcJCQYyV5gBswIQbmRhHAwLgAMSNQkHMFuUAbMCD2xlZgYCBBsKgwMJUQUDFAIKX5QBrwIObjUEKAMC8QMJggKRAbACC3E3BCMIA+wD' +
    'EgMHXQKUAY4BsQILcjgDIAsD7AMfRgQKEosBjQGtAg11V/0DICcFEA8HEwwIDgMEAmF9AgytAgxsCgFUCAcEAS0CQgfzAiEmBw8PBxIJDAUNAg9WfAIJrwIM' +
    'NQMoZwwPARIWCD4H8gIpGgwSCwgQCgsFIlWEAa8CDDcDJ2gGKRQLBgSqAysDBBEMCwIGDAcPCgsFEwIGAgZWeAIIrgIMOAUmoAECBAUMBQSpAxgEEAIIBQUE' +
    'CwwWBQgQDAUTCgdVeAMIrQILNQ4itQEHAjIDAgPvAhgEJgQKDhUGBRANBRIJDVB+AgOtAgs1DwoCCQIMtAE4EekCFAcoBAoSEAUFEQ4EEwEWTn6xAgw1DwkD' +
    'CQkKsAEDBS0VBwjZAhIHKgMLEw0GBRAPBCtMggGrAg80EAcEBQIDDQa4AS4VBQrcAg0IORQHCQcPEgMrSwYDeaoCEDIQBQcFGgG2AQ4DGxYBD3sI2gEKDDYW' +
    'AwoKDhICNUMCB3mrAgMBCi8SBQgHFgO3AQsGBgkEAwIsdQlUA4QBAhM2IQ0PBAJCTmkEC64CCisVBgoEFQS5AQkXATdtBFoHAgKUATYgDw4DAkRPZgYJxQEC' +
    'aAkrFgYhBbsBBlEJEVIDUxYDA40BCgcmHBENUTsGB1sBCAgHuQEDAwMCDJQBFwYiBLACnwEkAghVAS0GByoYEhBNOgwBZsQBBwETlAEVBiQCsgKYATtMBSs7' +
    'FREXHQUoNQ0Ca7gBIZQBFQbYApYBUTcHJz8VDxsOCAMHJzQLBG6yASWTARYF2AIiAggIYlUoFAYDBQgQPA8ECAwcDBYmMwgHbacBNAIEbwoRFQXYAhACDQUH' +
    'GFFhEAQIGAIGAg0QJgIRDgkHCQEFFgwZIDgFCGmpAT0+BCwQDhIF2AIEAQMcCB9IZQtEExsGDg0LBw8EAhANGR5FZqsBKQIeMgYsEwsRBgQD0AIDIQgjQG4F' +
    'Sw4UBAEOBQ8MCA0DBg0OGhtFZa0BKQIiLwQtFwkQCAEDBAPKAgIkBSozzgEFDwgFAQEfCAkNAwcKDQECHBpDYasBAQVSPQIQBgUcBxAHCASmAgMLAmowzwEc' +
    'CR0GCg8BCAkNJBg7BQFatAFYGAYXAwIEBRIBIQMSBQoDpQIECgNuLcwBHQ4YBwgaCQ4WBgkZN1MCBbsBXBQIEFwGCgKmAgENAnEuyAESAgkSEgQBBQQcBxIU' +
    'CAkcAQEwU8EBYREIDV4HCwEnAYMDLtwBBSgBBQQdBhQSCAohK1HCAWYNBQ1hB7oDLd4BAi8CIAMWEQcMISlRwgFoDAULYge7Ay6VAQFIAmgkJiZPwQFrDAUJ' +
    'YQi9AwQCAwMopAEElwElBwEiJE2/AW0NBgdhCL4DAwsnnwEIlQElCAYgIkvAAVAEGQ9nAQMH0QMWBQuWAQQECAUDfwMHJwoGCgIUIkpKAnRRCRIQaAEEBLED' +
    'AiISCQiXAQQCEn4xDAEMBxAiRzQEFAdwVQ4GCgcCogQEIQ2zARF/MRgKDCU8AwE2CQYBAhJuVxnNAgHhAQUeDrMBDAMCcwQHBAMsGAsKJzY/CQQZaycLJxXQ' +
    'AgLgAQ4PFLIBBgIEegMGBAUqHAoFLDNGIWkmDiUW0AIC3wEQDhawAQUEAoMBBQgaGAMPCwIuMEgiZyYPJRawBBIMGL0CBQwVGAQROi5IImcmDycJAwqhBAMK' +
    'GAcZEAWmAgUREBoDFTYtSh9oJw0pCQkEoQQnAzClAgYSEAcKITYtSh1mKgssC68EVqMCBwwCBiIgNitLGGkrCzEIsgRTmwINDAUHIR81K0wVaisKNQW0BFGb' +
    'Ag4CAgcIBSQcNilSCm8EASUK8AQtAhyyAQJAAioUBDQNBAo2KccBKgzzBCwCFQIEswECPwMoFwE3DQYHOCXHASkN9QRC1gEFIAIoIgItDwcCOiPFASsNIAHW' +
    'BD/WAQcgASUjBS8BAwpDH8YBLA0gApkEAjICBz7KAQELBEglAxQGCQITCUIexAEtDiACFAP/AwUwSMoBBQYESTQCBhQWBUMdwAEvEB8CFASTAQLoAgUtS8sB' +
    'DUk2AgYWGAFEHL8BLxEbAwEBFAaUAQHmAgUrTskBDklAF1wbvgEwEQ8CCgMHAg4G4wMMCgYmU8gBC0xBGVsZvwEwERoDBgYOBeADDggII1jEAQpPQRpcFsAB' +
    'MBEaAgcJDAPgAw8FCiNaBAEwAwwGeQdRQh9YBgINwAEwESMKDAHgAxEDCiJcBAEvBAwIpwEBJkMgYAvBATEQJAnsAxwiYDIEDAukAQIRAhJEIGIIwwEzEA8M' +
    'BwjpAxwVCgRbAgcvBA0QsQEDEkUfEwJOBsUBMxAJEgcD6wMdDgUBDQJcAggCBiUFCCGmAQETRR8SBJgCNCr0AxwJiwEhCAYqeAI5RR8RBpcCMyfkAwQRGgmM' +
    'ASAKAi52BzVEIRAHlwIyF94DCAICCAwLFwyMASA9cAo1QyIQCJYCEQMJAxAX2gMmBgICFwyNAQQDGT9tAz5BJA4KlAIPBwYEDxgPAckDSAyYAQIFD0FlAgQC' +
    'RDwoBw6TAg0JBQQEAQkaDgMpApwDSAuiAQ1EAwEDAloCIgEoPCgEEecBBScLCwwBCBwOAikDmQNIDKIBDAYCQQQBfgIpPTzlAQYrBA8LAQgeDQEqApgDRw6i' +
    'AQoHA0EJAX4CJD884gEGPxQfzwNFE6ABBwgGQggCbAEPAyU/POEBBgIFORIgzgNFF5wBBwcIQwcCbAEOBCU/POABDy8CBxIHAgwFBswDRhibAQcJBEcDBXsD' +
    'JwQDODvgAQ8uBAcRFAcEywNHGJoBB1cDA30BNDM83wEOLgQJEBPVA0cblwEHWgIDBAGwATA83gEOLAgJDhPVA0cclAEHYwIDsQEvO98BDC0ICQ0U1ANIHZIB' +
    'B2UCArIBLjvgAQssCAoIGcMCAY4BSRqRAQICBWgDAmoBSSk/3wEMKgcIAQIHGsICA4sBSxmPAQZuAwNpAU0jQuABDCgHBgQCBB3NA0wZjwEDcwMCuQEgRN8B' +
    'DSgFAgEEAwQCHuACAmpNGY8BAnUCBMEBFEjQAQcFDikEAgEEAiXfAgNoTxmIAQODAcEBEE7LAQkFDSkEKgIB4AEDfARnURiIAQOFAcABDFbFAQsJCSgFHAYG' +
    '5AEDfANoURiQAr8BDDwCGcUBCwoLJQYZCQTjAgRsTRKWAr8BDTgGGb8BDwsMJQgFBQjzAgVtTBGNAgMHfwI/DQkBAwMnBhq+AQ4NCyQVA/UCBW8HBj8PjgIE' +
    'B3YCBAU+DQgCAwNKuwEODQweAgKMAwZyBAg+D48CAwd2AwIHPQ1cugENDA4akgMGgQEEBDQOkAIDCnIEAwY9DV25AQ4HEhaVAwaCAQMFNA2SAgILcgMDBzwO' +
    'XLoBDQcWEZUDBoQBAgYzC6ICcgEFBj0NXLkBDQkWEJMDBYcBAgY0CaUCdwY9DVu4AQ0JGAuVAwSKAQIGNQimAncFPwtbtwEKDBgMlAMEiwECBjUHpwJ5A0AJ' +
    'W7gBCA4XDJMDBI0BAgY1BqkCvAEHXLoBAxMUDJQDAo4BAwY1BaoCcgFLA1cFA88BFAqlBAUGNAStAnoClgEIBM4BFQeGAwKfAQcF5QJ5A5UBCATOARUEqwQH' +
    'BeMCdQEGAZUBCATOAQYDAg6sBAYH4gKQAgkE0AEEFOwCAr4BBgfjApsBAlckBOcB7QICvgEHBuUCCAKOAQRUJQfkAa4EBwfmAgcDjQEDUw8DEwnhAbAEBwfn' +
    'AgcFcQNrEAQSCtcBAwSyBAYI6QIIA28EaAgGGhHSAdsDAVsHBe8CBgNvAmcHChkS0QHbAwFbBwTyAgQEiAEIRgQOGBPGAQYEtwQIA/MCAwWGAQtFAhAXFcQB' +
    'wgQIA/MCBASEAQ5UGBbEAcEECgH0AosBEk4BAhcWxgHhAgHdAYEDhwEWUBgCAw8BA8cBugQLAvUChQEZTyYDBAPKAbYEDAP0AoMBCwIOTy0DywGiAQKQAw0E' +
    '9AKCAQkFDk4uAc0BnAEHMATbAg4E9AKGAQIKCAIBUA8C6wGFAQERCS8LHgI3AwoBAgLtAQ4E9QLuAQYCBQTrAYEBBQ0MLQ4bBjMFCgECAgoB4gEOAvcCoAEH' +
    'SQQCBAXsAX8HCQ8rEBoHMgQaA+ABiAOXAQUDCQEERAkF7QF9DAUOJwECEhcJMgQcAeABiQOUAQkCD0cCBfABOAJBDQcMJxUXCjID/QGKA5MBCQUOOwMN8gE2' +
    'BT8OCQkoFBgLMgL7AYwDkgEJBw43BgzzATUGPw8ICScQHA2bAgERFAL3ApIBBwoNNAcL9gE1CjkSBwkmERwNmgIDDxUD9gKSAQYLCAMCMwYJ+QE2CzcUAg8k' +
    'EB0MrAIWBPUCkgEFDAczCwf8AScCDQs3JiMPHgusAhcG8wKSAQULCBMBHQ0G/QEmBgsLNikhDh4KrAIYCPECkQEFCwICBAwKGg8F/gElCAwKNCwgDh4IrAIY' +
    'De0CkQEFEAMKDBgSAuUBAxcjDAwLMS4fD9ACGQ7rApIBBg8DCgsY+QEVBRUHBg8MDC8wHRDNAhoQ6gKSAQYQAS33ATEKAhENDisyHBHAAgIIGhHqApMBBj73' +
    'ATAfDQ4pNRoSvgIEBRoP7gKTAQYUAgIDI/cBMBgBBwwRJjYaE2IE0wEmDfECkgEGEgkj+AEwFgMICxIkNxoTYQTSASYCBwTyApIBBRAKJfgBMBYDCQwSIzca' +
    'EbcCJwIJAfMCkwEDDwko+AEvFwMLCxIiFAgbGxC2AigD/QKTAQEQBir5AS0aAQ0ODiMQDhgcD7UCKwH9AiwDowH7ASwrDQ0kDRIVHg+0AqkDLAScAYICJzIM' +
    'CyQLFxAgELMCqQMtApwBgwImHwMSDggUBQcGUQ+QAgIgKwP7AssBgwImHwUTDQcSCQQHUg2QAgUdKwb5AsoBhAIlIAUVCAEDBg0BAgsFBVQMjwIHGi0H+QLI' +
    'AYUCJCEFFgYMCw9eDY0CBxouB/kCyAGEAiQiBRcEDgsOXQ+JAgkYMQj5AsYBhQIjDAEWBRgEDQwOWxGHAgkGCAoyCPkCxQGFAiQMARYEGgMOCw5bEYYCCgMM' +
    'CTII+QLDAYcCJCQBHAQOCg9ZE4ACHgoxB/sCwQGIAiVAAxAKD1cV/gEfCy8H/QLBAYcCJEECEgwLQAIWFf4BHwwtCP4CuwEBBIgCI0ADEwsLQAEXFIACHQ4s' +
    'B4ADugEBA4oCIUIBFAsMVxSBAhwOKweCA7kBjgIgNgoZBxBHAg4ThAIdCykIgwO4AY4CHzcKGQYRSAIOE4QCBQMWCicJgwO3AY8CHTsIGgUSRwIREIQCBAkS' +
    'CiUKhAO3AY8CBAMUKwQPBRsFE0cBEg+4AQFMAgoSCiMMhAO3AZcCEhgCBxARAhwDFloMuAEDVRMLHgIBDYYDtwGXAgcdIEkGBQoHPgS+AQJSFgsdEYYDtwGY' +
    'AgMZJ0oECAcI0wIXCxwRiAO2AbECKVgDC9ECGQscEYgDtgGwAitl0AIaDBoSiQO1AZkCAhEvZc8CGwwaEooDswGZAgQPMWTOAhwLDhsBAowDsQGZAg4EM1YE' +
    'Cs0CHQoOG5EDrwGaAkVWBArNAh0EEhMBBZYDrAGbAkVlzgIdARMKAwagA6gBnAJDZtECLQwEBaIDpAGdAkNn0gIsBAIGBASlA6ABngJFZdMCMgcDA6gDnAGe' +
    'Aklj1AIoAwUHBQGrA5kBnAJNYdUCJgYEBLUDlwGcAlBf1gIkCAMDtgOWAZwCVFvXAiYGvQOUAZwCXRoJMNgCJgW9A5IBnQJhFgsu2gIlBL8DkAGeAmIUDizb' +
    'AiMFvwOPAZ4CYxMUJ9gBAYIBIwXAAwgBhAGeAmUSFSXZAQGCASQDwQMHBYEBngJmERwOBQrdAukDBgaAAZ4Cag0eCgkH3wLoAwYHfp8CbgkjA/AC6gMFB36f' +
    'AnAGlQPtAwUHYgMBBBOfAnIDlQPuAwUHXBERngLqAQScAgEC6wMGBlwSAwMKngLpAQeeAusDBgZJBgMCBxkJnQLoAQqdAu0DBQVGDwYaCZsCqwEBPQucAu4D' +
    'BQVEMQiaAq0BATwLnALvAwQFQzMImAKuAQI8C5oC8QMEBj43B5cCrwECPAuaAvIDBAY8OAeVArIBAjwLmALzAwUGOjgJkgK1AQIDAjYMlgLzAwYINzkJjgK6' +
    'AQc2DJQC8wMICDU7CYwCuwEINg2RAvQDCQgzPAmMArwBCDYOjwL1AwkIMjwJjAK8AQg3Dg0C/gH4AwgIMT0JigK+AQg3DwkF/AH8AwUJMD4IiQK/AQk3EgII' +
    '+wH+AwUJLz8HhwLBAQo2HPoBgQQECDA+B4YCwwEJNh35AYIEAwgwPwWHAsQBCTUe+AGCBAMJL0AEhgLFAQo1AwIRAgn0AYIEBAosQgKHAsYBCTYBAxADEBQF' +
    '0wGDBAUKKswCxgEKOQ8EFQEU0QEJAfoDBQspzALHAQk5DgYqzwEJA/oDBAwoywLIAQk5DQcqzgEJBPsDBAwnygLKAQk4DAkqDgG9AQkF/QMECybJAswBCjcJ' +
    'DCoEC7oBCwT/AwQLJcgCzQELTDi5AQsFgAQECyTIAs0BDE8qBQICAbcBDQWBBAMMI8cCzgENUCfBAQ4FggQBDiLHAs4BDVEnvwEPBJMEIToCAwj/AdABDVEn' +
    'vAERBJQEIDcFAwr9AdIBC1IqUwNcFwOWBB83AwcJ+wHUAQpTKFMFVxwBlwQfQwv2AdYBCVMmVQVWtQQfRgr0AdYBCVInDAI+AQQKU7cEH0kJ8QHYAQhSKAsC' +
    'OxJBAwu8BB8jByEH8AHYAQlQKgoCORQ/BwXABCAdDSEK7AHYAQlPLAgDORQ9CgPBBCAcDSMK7AHXAQpNLwQGNxY6DALCBCAbDiYL6QHXAQlMOjcXOA0CwQQi' +
    'Gg0oC+kB1gEKSTs4GDfQBCMZDCkL6QHWAQxGPDcaNdEEJBgMnQLWAQ1FPDUeMg4FwAQkFg07CtgB1gEORDwyIjANB8EEIxYNOwzWAdYBD0M8MSMwDAjDBCIU' +
    'DjsN1QHWAQ9CPTAkMAsIxgQhEg88D9IB1wEPP0AuJi8LCMcEIwoCAg49EdIB1wEOPkEtKC4MBskEIwUWKAQMAQUKBAIGBMgB2AEOPEIsKS8MAywDngQ7KQUT' +
    'BBAEyAHZAQ07QysrLzkGoQQ2KwIWAd0B2gENN0YqLDA4B6EENaEC2wENNUgoLTA4B6MEM6EC3AENNEgmLzE3B6QEMqAC3QEOMkklMDI2CKYEL6AC3QEOLU4k' +
    'MQkCKDUIqgQroALdAQ8pUSQwCQMpMwitBCigAt8BDidUIjEIBSkyB7AECwUVoQLfAQ4mVR81BQcqMAe1BAUIFAsFkQLfAQ4mVhw5AQoqLwbFBCSPAuABDSVX' +
    'GkYrLgbGBCSNAuIBDCRZGEcsLQbHBCWKAuQBCyFcGEcsLQbIBCWJAuYBChxgGEctLAbJBCSIAukBCBlkF0gsLgTKBCOJAukBBxhmFkgsLwPLBCKKAngDbgYX' +
    'ZxdHLS4DBAHMBBuLAngEbgYSaxZJLC8CAwTMBBmMAncFbgUQbhZILDcDzQQWjAJ4Bm0ECnQWSQcCIjcD0wQQiwJ6Bm0DCXUWSQYEIS4CCQHTBBCLAnoFbwMG' +
    'dxZJBgUgLgPdBA6MAnsBcysBVBVKBQgdLwLeBA2NAu8BKgFUFEsFCRw9A9AEDC8D3AHuAYABE0sFChs9BNAEAwIGLgPeAewBHwFhEkwEDBo+A9EEAQQFLATh' +
    'AeoBHQNiEUwEDRg1AQkD1wQEKwUHBdYB6gEZBmMQTAMOFzUDCAPWBAUnCQQJ1gHqARMLYxBMAw8VNgQHAtQECCMOAQzWAeoBDRFjD0sEEBI4BdwECSEdEgPB' +
    'AeoBBhdjD0sDEhA8A9sECSAmBwcEAroB6wEDGGQOTAMVCj8D2wQKHw4DFwMJwQGFAmUMTQIXCEAC3QQKHg4EJMEBggJmC04CGAZAA+EEBx0OBCe/AYECZgtO' +
    'AhcGQQPjBAYLBQsQAyi+AYECZwlPAxYFQwELAdkEBgcKCBIBKb8B/wFoCAYDRgUVA08E2AQJAwUDBAU/vgH/AWgHBwRFBhUBTwXZBA8FBAQ/vgH+AWoFCAVE' +
    'B2IH2wQLCAQCRLoB/gFrAwgGRQdbAwII4AQGCEy5AfwBdwZGBloO4QQFCE25AfoBeAdGBVkP4gQECE65AfkBeAhGBFgEAwrjBAIJTrkB9wF5CEcDXwrvBE27' +
    'AfUBeQhIA14K8ARNuwHzAXsHSAVcBvUETrsB8QF7B0kGPQIbBvUET7sBNAmyAXwGSwc6BBoG9QRQvAEuDrEBfQNNCDgGGgX1BFQCBrEBKxGvAc4BCTYIkwVe' +
    'sAEnFa4BzgEKNAuRBWGuASQXrQG8AQIRCzINkAVirgEPCgcbqwG8AQkMCzAOkAVkrgEKEAIdqwG9AQkLCy4PkQVlrwEFMwoCnQG+AQoKDCwPkgVm8wGbAcAB' +
    'CgkMKhCTBWfzAWoCLsEBCQoKKhCUBWjzAWkCLcQBCAkKKRCVBWj0AWgCLMcBCAgJKRCVBWnzAWkBK8kBCAgJJxGUBWr0AZMBygEKBgkmEpQFavQBkgHMAQoG' +
    'CCMVkwVs8gGSAc4BCQcIHxmQBW7yAZEB0AEJBwceGo8FcPEBjwHTAQwEBx0ajgVy8AFVATfWAQwFBRYBBhqOBXLwAVQCNtgBDQUDFQUCHIwFdO4BVQE12gEO' +
    'GyYkBOIEdO4BigHWAQEFDhonCAMMAQwD3wR27wGJAd0BDxkmCAwCAwwD3gR37wGIAd4BERcjChENAeAEd+8BhwHgAREWIhcDDwHgBHXxAVwGJOIBEBchiQV1' +
    'AwPrAVwJIeQBDxchiAV2AgfoAVsKIOYBDhchOwLLBIAB5wFaCiDoAQ0XIQkBMAXJBIABAgXfAVsJIOkBDRgfCQMIASQJxgSKAd0BWwkf6gEQFh0KBAMHIAzF' +
    'BI0B2wFaCR/kAQEGEBUcCg0jC8UEfgER2AFaCB/tAQ8WGgsLJwkOArUEfgES2AFZCB7uAQ8EAhAaCwopCA0GsgRmAinYAVkIHfABDwMDDxoLCioHDAmwBGYC' +
    'KdkBWAcd8QEQAwIQGQsKLQQKDa8EZgEw0wF68wERAgEQGAsMLAUIEq0EmQEEA8kBePUBEQgBChcKBwEGHAILCAYXqQSiAcgBd/UBEgcBDhMKBgMFGwYICgMa' +
    'pgSkAcgBdfcBERgBBwkLBQMFEAMMAwgpogSnAccBdPgBDyMGDQQDBRADDQEJLJ4EqgHGAXL6AQ4kAhEDBAUqAQQpmgSsAcUBRwIp+wENNwMFBTAomASuAcUB' +
    'RgMn/QEMNwMFBTEoGwH7A68BxQFFAyaAAgo3AwYFNSUZAvoDsAHFAUQDJoECCTcDCQI4IxcD+wO1AcABQwMlgwIINwMJAjohFgP8A7YBvwFEAiWEAgc3Akch' +
    'FAP9A7cBvgFEAySGAgSCASEKC/4DtwG+AUQDI/4CAg4iCAoPAfADtwG+AUMCJI0CBmsCDiUIBBIC8AO2Ab4BQwMkiwIKZwIQJR4C8QO0Ab4BRAMkigILeSOT' +
    'BLMBvwFEAySLAg4DBmsilAS0Ab4BRQIkjAIZaCGWBLMBvwFEAiOOAhlmI5UEswG/AUUCIpICFWUYAguVBLIBwAFEAiKbAhFfFwYKlQSwAcEBRQIhngIPXQUE' +
    'DgoIlASwAcIBRAIhpQICAgMCAgwCBgJFAgcMDAiUBK8BwgFnswIDAQIDAgYDEQU4Cw0HlQStAcIBPQIqtgICHgY5Cg0IlAStAcIBPAMq1QIFPAgPCJMErAHD' +
    'AT0BK9ICBVcJkgSqAcQBasACAg4FWQmRBKkBxQFTAhXAAgMNBFwIkQSnAccBUgIWwAICDgJfB5AEpgHIAWu2AwKQBKQBygFrtgMBkASjAcsBa8gHoQHMAVIC' +
    'F5cDAq8EoQHMAVIDFpYDA7AEnwHNAVIDFpYDA7AEnwHNAVEEFvACBSEEsASdAc4BUQMX8AIJHAWxBJsBzgFSAxfqAhcUBrAEmwHNAVQCFyICxAIZFAaxBJgB' +
    'zgFVAhciA8ICGRUHsQSWAc4BVgIXIQXBAhgWB7EElQHOAVcCFyAGwAIYFwexBJUBzgFYAhYfB8ACFxcIsQSVAc4BWAMVHgi/AhgXCLEElQHOAVkBFh4IswID' +
    'CBkXCLIElAHOAXEcCbACBwcZFwmyBJMBzQFyHAqtAgoHFxgNrwSSAc0BchsLrAIMBRgZDa8EkQHNAXEbDaoCKxgOVQLYAxUBeswBchkPqQItFg9WAdkDEwN5' +
    'zAFyGA+pAi8VD7IEEgN4ywFyFhCrAjETD7QEEQJ4ywFxFBOrAjMRELUEiQHLAXAUFKgCAQE2DhG3BIcBywFvFBWnAjoNEbkEhAHMAW0VFaQCAgM8CRO6BIIB' +
    'zAFrFxWjAgQCPQgTuwSBAcwBaRgWowJEBhW7BIABzAFmGxajAkYDFn4DuwN/zAFlHBajAl9+BLsDfc4BYx0WowJffgO9A3vPAWMdFaMCYb4EetABYR8UogJi' +
    'vgR60QFeIROiAmO+BHrRAV0iE6ICZL0EetIBWyQSoQJnvAR40wFaJRGhAmq6BHjUAVgmEZ4CbrkEd9YBVicRmQJ1twR31gFWJhGYAni2BHbXAVYlEpUCfD8B' +
    '9QN12QFWJBKPAoIBPwPzA3TbAVUjEo8ChAE/A/IDdNsBVSITjQKHAT8D8QN03AFVIROMAogBQgHwA3PdAVUgFIoCiwFCAu0Dc98BVCATigKMAbEEcuEBVB8T' +
    'iQKPAa8EceIBVB8SiAKTAa0EcOMBVCARiAKUAasEZ+0BVCARiAKUAasEZu4BVCEQiAKVAaoEZe8BVCEPiQKVAaoEYfMBVCEPiAKYAagEX/UBVCEPiAKZAacE' +
    'XvYBUyIOiQKaAaYEXfgBUSQNiQKbAaUEW/oBTicMiwKaAaUEWvsBTCoKjAKcAaMEWfwBSTADkQKbAaMEWP4BR8UCnAGhBFn+AUfGApsBoQRZ/gFHxgKbAaEE' +
    'WP8BR8UCnAGhBFiAAkbFApwBoQRYgAJGxAKdAaEEWf8BRsUCnAGgBFr/AUbFApwBoARagAJFxQKdAZ8EWoECQ8cCnAGfBFmDAkLHAp0BnQRahAJByAKcAZ0E' +
    'WYYCP8kCnAGcBFmIAj3LApsBnARYiQI7zQKbAZ0EVosCOc8CmQGeBFWMAjjQApkBngRUjgI30AKZAZ4EVI4CNtECmQGdBFKRAjbRApgBnQRSkwI00gKYAZ0E' +
    'UZQCM9QClwGdBFCWAjLVApYBngRPlwIw1gKWAZ4ETpkCLdkCNwhVnwRNmgIs2gIzDlKgBE2aAivbAjAVTqAETJsCKtwCKCFJoQRKnQIp3QImJEeiBEqcAijf' +
    'AiQmRqMESpwCJ+ACIikMATekBEqdAiTiAiErCgI3pARJnwIh4wIhLQgDNqQESaACHeYCFgUGLwUFNqMESaICDfUCEj4EBTakBDcCD6UCCPkCD0ADBjakBDcG' +
    'CqcCA/4CC0wBAzGlBDm4BQhMAQQxpAQ7kAYwWwPGAz2PBjBbBMUDPZIGLF0EwwM+kwYrXgPDAz+SBipgAsMDP5MGKWECwQNBkgYpYQLBA0GSBiliAr8DQZMG' +
    'KWMEuwNClAYoYwW6A0GWBiZkBgYCsQNAmAYdbAgDA7EDP5wGDQMJbQ6xAz2jBgcEB28OsQM7pwYDCARwDbMDNKsHDbQDLbAHDbYDLbAHDLcDLbEHC7YDLbQH' +
    'CbUDLbYHB7YDLbcHBbcDLbcHBLgDIwIIvgYBCgFhAgkFuAMjBQLABgYCBl8FAQEFBLkDI8cGDl8IBAO6AyPIBg1eCcADAwIfyAYNXQrAAwIDIMgGC10KwQMC' +
    'AyADAcQGC10JwQMDAyADAcQGCl0KwQMDAyDJBghdCsIDAwMgygYGXAvIAyDMBgRcC8kDH6sHDMoDH6kHDcoDIKYHDc0DIKUHDcoDAgIfpQcOygMCAh6kBw/L' +
    'AwICG6YHEMsDAQEbpwcQzAMBARqoBxDKAx2pBw/KAx6pBw3MAx6vBwbOAx6DCx6DCyH+CiP9CiP9CiL7CgEBIvsKJPwKIv4KIIALH4ELH4ILHoMLHIYLGYcL' +
    'F4kLFooLFosLFYwLFI0LEyMCAwPjChMiAwED4woUjAsSjgsSkAsFAgMDBY4LCQQGjQsJBQaMCwgGB4sLAwMCBgmUCwEBDJALEo4LFI0LE5ELC5cLA5HdAgKe' +
    'CwKTCwWXCwmUCwgCA4cLAQkFCQGHCwEGBpMLC5ULCJcLCJMGAYMFCZIGA4EFCYUFBDIEVAT9BAvIAxKsAQUEERUOHQEhBAkCAgb7BAcDAsQDF6ABAggfEBAt' +
    'Aw0e8gQJygMZiAFGBR0gCgoo3wQCBgnLAxt4VgIgCwMIFAcyDgTDBAQCCckDAwIfaQMD8gHCBAQCCb8DAwUqY/gBxgQBBQe/AwYCOQIHSPwBzQQGuQNeBAIu' +
    'hwICA8MEBrEDbSaVAsEEB6wDcSObAgMCCwKsBAiKAwMbdCKjAgQImwQDDQ6EAwQXdiKyApYEBwsQgwMIEnYiugKPBAkFAQISggMJEHUfxgL4AwMNCgMX+gID' +
    'Aw8KdR3OAvMDAw4JBBjvAiMDdhTbAoIECQQX5gKlARPeAoAECgMYhgIGBhAHHgQCD7ABEOYC+AMMAxfqAQMWiwIN6QICBu4DDQMY2QEFCgMVjQIL/QLdAxMD' +
    'GcwBBAcGCQUPlAIHgAPUAxsDGcsBBgYHAQ0DAgWjBdADCgMOBBjKAQkDHAKrBeECAwYCBQNYBQkLBRfJAdYF4QIUZQoGGMcB1gXmAg9jCwgYxgHWBZQDAUQH' +
    'CxrCAdkF3AIDMwUzAxwduwHeBf8BBVkDCgkMAg4MHQQOBRYisQHmBYECB1sDAz0SCAwFDCysAeoFhQIGCARRRwkRBAYCNKgB5QWSAgMHC0tLAlSlAeYFnwIK' +
    'FQQyoAGjAeYFjQIBFggGBwcHBwUknwGgAegF7QEHCgQMBBQkBAkGAxmdAZwB5wXxAXcICQiaAZ0B5wXtAX4EDgWXAZ8B6AXlAbICnwHqBdkBBAK1AqAB7QXS' +
    'AbsCogHwBcMBAgq3AqIB9wXEAQIDAgO0AqEB/QXPAZUCAhyfAf8FzgGJAgQHBSCWAYQGpQECJv4BAgQJBwYgkAGKBp4BERMIAf8BCwwHHosBkAYNAo0BHQiJ' +
    'AggPCBuHAZcGCwKNAa8CBxAOEkoMLZ4GmwGtAg8IaBIooAaaAa4COgI9GCWhBpwBrgIzBAICNyAjoAaeAa4CLgICBDkhJJwGpwGpAi4CPSMzhQa1AaQCBANh' +
    'JwQEM/sFugGiAgIHTkAz+gW/AakCSUE0+QXDAakCRQwNIzACB/sF0wGaAjQVFh8kEQT8BdQBngIhHx4RK5UG0gHbAlibBr0B4AJhoga1AcoCeKoGswHLAm+1' +
    'BrEBywJQ2AauAc8CQuEGrwHWAjPqBq0B+gIL7gYCB6UB+wIFggegAYQKnQGFCpwBkgqOAZgKiQGmCg4OY6wKASZX2ApY1ApM2goDAi7m1AE=';

  var landGrid = null;
  function decodeLand() {
    if (landGrid) return landGrid;
    var bytes = b64decode(LAND_RLE);
    var grid = new Uint8Array(LAND_W * LAND_H);
    var idx = 0, cur = LAND_START, pos = 0;
    while (idx < grid.length && pos < bytes.length) {
      var run = 0, shift = 0, b;
      do { b = bytes[pos++]; run |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
      for (var k = 0; k < run && idx < grid.length; k++) grid[idx++] = cur;
      cur = cur ? 0 : 1;
    }
    landGrid = grid;
    return grid;
  }

  /** u,v fractional texture coords: u wraps west→east from the antimeridian, v runs 0 (north pole) → 1 (south pole). */
  function isLandUV(u, v) {
    var g = decodeLand();
    var x = wrapIdx(Math.floor(u * LAND_W), LAND_W);
    var y = Math.min(LAND_H - 1, Math.max(0, Math.floor(v * LAND_H)));
    return g[y * LAND_W + x] === 1;
  }

  function uvOf(lat, lon) {
    var u = ((lon + 180) / 360) % 1; if (u < 0) u += 1;
    var v = (90 - lat) / 180;
    return [u, v];
  }

  function isLand(lat, lon) {
    var uv = uvOf(lat, lon);
    return isLandUV(uv[0], uv[1]);
  }

  // ---- Coarse desert belts (real, well-known arid regions; see header) -----
  // [latMin, latMax, lonMin, lonMax]
  var DESERTS = [
    [15, 32, -17, 34],     // Sahara
    [12, 32, 34, 60],      // Arabian
    [-29, -17, 12, 26],    // Kalahari / Namib
    [-31, -18, 118, 145],  // Australian Outback
    [34, 46, 75, 110],     // Gobi / Taklamakan
    [-40, -18, -75, -65],  // Atacama
    [22, 37, -117, -103],  // Sonoran / Mojave / Chihuahuan
    [25, 40, 45, 63],      // Iranian plateau
    [-52, -40, -72, -66]   // Patagonian steppe
  ];
  function isDesert(lat, lon) {
    for (var i = 0; i < DESERTS.length; i++) {
      var d = DESERTS[i];
      if (lat >= d[0] && lat <= d[1] && lon >= d[2] && lon <= d[3]) return true;
    }
    return false;
  }

  // ---- Real city lights (see header for provenance) -------------------------
  // [name, lat, lon, intensity 0..1]
  var CITIES = [
    ["Abidjan", 5.36, -4.01, 1],
    ["Abu Dhabi", 24.45, 54.38, 1],
    ["Abuja", 9.06, 7.49, 0.96],
    ["Accra", 5.6, -0.19, 0.81],
    ["Addis Ababa", 9.03, 38.74, 0.77],
    ["Adelaide", -34.93, 138.6, 1],
    ["Ahmedabad", 23.02, 72.57, 0.93],
    ["Alexandria", 31.2, 29.92, 1],
    ["Algiers", 36.75, 3.06, 1],
    ["Almaty", 43.24, 76.95, 1],
    ["Amman", 31.95, 35.93, 1],
    ["Amsterdam", 52.37, 4.9, 1],
    ["Anchorage", 61.22, -149.9, 1],
    ["Ankara", 39.93, 32.86, 1],
    ["Antananarivo", -18.88, 47.51, 0.69],
    ["Apia", -13.83, -171.76, 0.12],
    ["Ashgabat", 37.95, 58.38, 0.77],
    ["Asmara", 15.34, 38.93, 0.23],
    ["Asuncion", -25.3, -57.64, 1],
    ["Athens", 37.98, 23.73, 1],
    ["Atlanta", 33.75, -84.39, 1],
    ["Auckland", -36.85, 174.76, 1],
    ["Austin", 30.27, -97.74, 1],
    ["Baghdad", 33.31, 44.36, 1],
    ["Baku", 40.41, 49.87, 1],
    ["Baltimore", 39.29, -76.61, 1],
    ["Bamako", 12.65, -8, 0.58],
    ["Bangalore", 12.97, 77.59, 1],
    ["Bangkok", 13.76, 100.5, 1],
    ["Barcelona", 41.39, 2.17, 1],
    ["Beijing", 39.9, 116.41, 1],
    ["Beirut", 33.89, 35.5, 1],
    ["Belgrade", 44.79, 20.45, 1],
    ["Belo Horizonte", -19.92, -43.94, 1],
    ["Berlin", 52.52, 13.4, 1],
    ["Bishkek", 42.87, 74.59, 0.85],
    ["Bogota", 4.71, -74.07, 1],
    ["Boston", 42.36, -71.06, 1],
    ["Brasilia", -15.79, -47.88, 0.93],
    ["Bratislava", 48.15, 17.11, 0.69],
    ["Brazzaville", -4.27, 15.24, 1],
    ["Brisbane", -27.47, 153.03, 1],
    ["Brussels", 50.85, 4.35, 1],
    ["Bucharest", 44.43, 26.1, 1],
    ["Budapest", 47.5, 19.04, 1],
    ["Buenos Aires", -34.6, -58.38, 1],
    ["Buffalo", 42.89, -78.88, 1],
    ["Bujumbura", -3.36, 29.36, 0.2],
    ["Cairo", 30.04, 31.24, 1],
    ["Calgary", 51.05, -114.07, 1],
    ["Cape Town", -33.92, 18.42, 1],
    ["Caracas", 10.49, -66.88, 1],
    ["Casablanca", 33.57, -7.59, 1],
    ["Charlotte", 35.23, -80.84, 1],
    ["Chengdu", 30.57, 104.07, 1],
    ["Chennai", 13.08, 80.27, 1],
    ["Chicago", 41.88, -87.63, 1],
    ["Chisinau", 47.01, 28.86, 1],
    ["Chittagong", 22.36, 91.78, 1],
    ["Chongqing", 29.56, 106.55, 0.81],
    ["Christchurch", -43.53, 172.64, 1],
    ["Cincinnati", 39.1, -84.51, 1],
    ["Cleveland", 41.5, -81.69, 1],
    ["Colombo", 6.93, 79.85, 1],
    ["Columbus", 39.96, -82.99, 1],
    ["Copenhagen", 55.68, 12.57, 0.81],
    ["Cordoba", -31.42, -64.18, 1],
    ["Curitiba", -25.43, -49.27, 1],
    ["Dakar", 14.72, -17.47, 0.66],
    ["Dallas", 32.78, -96.8, 1],
    ["Damascus", 33.51, 36.28, 1],
    ["Dar es Salaam", -6.79, 39.21, 1],
    ["Darwin", -12.46, 130.84, 0.73],
    ["Delhi", 28.61, 77.21, 1],
    ["Denver", 39.74, -104.99, 1],
    ["Detroit", 42.33, -83.05, 1],
    ["Dhaka", 23.81, 90.41, 1],
    ["Djibouti", 11.59, 43.15, 0.31],
    ["Doha", 25.29, 51.53, 1],
    ["Dubai", 25.2, 55.27, 1],
    ["Dublin", 53.35, -6.26, 1],
    ["Dushanbe", 38.56, 68.78, 0.89],
    ["Edmonton", 53.55, -113.49, 1],
    ["Fortaleza", -3.73, -38.53, 1],
    ["Foshan", 23.02, 113.12, 1],
    ["Gaborone", -24.66, 25.91, 0.66],
    ["Guadalajara", 20.66, -103.35, 1],
    ["Guangzhou", 23.13, 113.26, 1],
    ["Guatemala City", 14.63, -90.51, 1],
    ["Hangzhou", 30.27, 120.16, 1],
    ["Hanoi", 21.03, 105.85, 0.81],
    ["Harare", -17.83, 31.05, 1],
    ["Havana", 23.11, -82.37, 1],
    ["Helsinki", 60.17, 24.94, 1],
    ["Ho Chi Minh City", 10.82, 106.63, 1],
    ["Hong Kong", 22.32, 114.17, 1],
    ["Honolulu", 21.31, -157.86, 1],
    ["Houston", 29.76, -95.37, 1],
    ["Hyderabad", 17.39, 78.49, 1],
    ["Indianapolis", 39.77, -86.16, 1],
    ["Irkutsk", 52.29, 104.3, 1],
    ["Islamabad", 33.68, 73.05, 1],
    ["Istanbul", 41.01, 28.98, 1],
    ["Jakarta", -6.21, 106.85, 1],
    ["Jeddah", 21.54, 39.17, 1],
    ["Jerusalem", 31.77, 35.21, 0.85],
    ["Johannesburg", -26.2, 28.05, 1],
    ["Kabul", 34.56, 69.21, 0.12],
    ["Kampala", 0.35, 32.58, 0.85],
    ["Kansas City", 39.1, -94.58, 1],
    ["Karachi", 24.86, 67.01, 1],
    ["Kathmandu", 27.72, 85.32, 0.77],
    ["Kazan", 55.79, 49.12, 1],
    ["Khartoum", 15.5, 32.56, 1],
    ["Kigali", -1.94, 30.06, 0.12],
    ["Kingston", 17.97, -76.79, 0.96],
    ["Kinshasa", -4.44, 15.27, 1],
    ["Kolkata", 22.57, 88.36, 1],
    ["Krasnoyarsk", 56.01, 92.87, 1],
    ["Kuala Lumpur", 3.14, 101.69, 1],
    ["Kuwait City", 29.38, 47.98, 1],
    ["Kyiv", 50.45, 30.52, 0.85],
    ["La Paz", -16.5, -68.15, 0.66],
    ["Lagos", 6.52, 3.38, 1],
    ["Lahore", 31.55, 74.34, 1],
    ["Las Vegas", 36.17, -115.14, 1],
    ["Leon", 21.12, -101.68, 0.93],
    ["Libreville", 0.39, 9.45, 0.62],
    ["Lima", -12.05, -77.04, 1],
    ["Lisbon", 38.72, -9.14, 1],
    ["Ljubljana", 46.06, 14.51, 1],
    ["London", 51.51, -0.13, 1],
    ["Los Angeles", 34.05, -118.24, 1],
    ["Luanda", -8.84, 13.23, 1],
    ["Lusaka", -15.39, 28.32, 1],
    ["Madrid", 40.42, -3.7, 1],
    ["Male", 4.17, 73.51, 0.2],
    ["Managua", 12.11, -86.24, 1],
    ["Manaus", -3.12, -60.02, 1],
    ["Manila", 14.6, 120.98, 1],
    ["Maputo", -25.97, 32.57, 0.77],
    ["Marrakesh", 31.63, -7.99, 0.62],
    ["Maseru", -29.32, 27.48, 0.5],
    ["Mbabane", -26.32, 31.13, 0.62],
    ["Medellin", 6.25, -75.56, 1],
    ["Melbourne", -37.81, 144.96, 1],
    ["Memphis", 35.15, -90.05, 1],
    ["Mexico City", 19.43, -99.13, 1],
    ["Miami", 25.76, -80.19, 1],
    ["Milan", 45.46, 9.19, 1],
    ["Milwaukee", 43.04, -87.91, 1],
    ["Minneapolis", 44.98, -93.27, 1],
    ["Minsk", 53.9, 27.57, 1],
    ["Mogadishu", 2.05, 45.32, 0.27],
    ["Monterrey", 25.69, -100.32, 1],
    ["Montevideo", -34.9, -56.16, 0.93],
    ["Montreal", 45.5, -73.57, 1],
    ["Moscow", 55.76, 37.62, 1],
    ["Mumbai", 19.08, 72.88, 1],
    ["Muscat", 23.61, 58.59, 0.77],
    ["Nagoya", 35.18, 136.91, 1],
    ["Nairobi", -1.29, 36.82, 1],
    ["Nanjing", 32.06, 118.8, 1],
    ["Nashville", 36.16, -86.78, 1],
    ["Naypyidaw", 19.75, 96.13, 0.12],
    ["Ndjamena", 12.13, 15.06, 0.31],
    ["New Orleans", 29.95, -90.07, 1],
    ["New York", 40.71, -74.01, 1],
    ["Niamey", 13.51, 2.11, 0.47],
    ["Nizhny Novgorod", 56.33, 44, 1],
    ["Nouakchott", 18.09, -15.98, 0.47],
    ["Noumea", -22.28, 166.46, 0.58],
    ["Novosibirsk", 55.03, 82.92, 1],
    ["Nur-Sultan", 51.13, 71.43, 0.73],
    ["Nuuk", 64.18, -51.69, 0.2],
    ["Omsk", 54.99, 73.37, 1],
    ["Orlando", 28.54, -81.38, 1],
    ["Osaka", 34.69, 135.5, 1],
    ["Oslo", 59.91, 10.75, 1],
    ["Ottawa", 45.42, -75.7, 1],
    ["Panama City", 8.98, -79.52, 1],
    ["Paris", 48.85, 2.35, 1],
    ["Perth", -31.95, 115.86, 1],
    ["Philadelphia", 39.95, -75.17, 1],
    ["Phnom Penh", 11.55, 104.92, 0.31],
    ["Phoenix", 33.45, -112.07, 1],
    ["Pittsburgh", 40.44, -79.99, 1],
    ["Podgorica", 42.44, 19.26, 0.54],
    ["Port Moresby", -9.48, 147.15, 0.81],
    ["Portland", 45.52, -122.68, 1],
    ["Porto Alegre", -30.03, -51.23, 1],
    ["Prague", 50.09, 14.42, 0.93],
    ["Puebla", 19.04, -98.2, 1],
    ["Quito", -0.23, -78.52, 1],
    ["Recife", -8.05, -34.9, 1],
    ["Reykjavik", 64.15, -21.94, 0.93],
    ["Riga", 56.95, 24.11, 0.93],
    ["Rio de Janeiro", -22.91, -43.17, 1],
    ["Riyadh", 24.71, 46.68, 1],
    ["Rome", 41.9, 12.5, 1],
    ["Rosario", -32.95, -60.64, 1],
    ["Rostov-on-Don", 47.24, 39.71, 1],
    ["Sacramento", 38.58, -121.49, 1],
    ["Salt Lake City", 40.76, -111.89, 1],
    ["Salvador", -12.97, -38.51, 1],
    ["Samara", 53.2, 50.15, 0.93],
    ["San Antonio", 29.42, -98.49, 1],
    ["San Diego", 32.72, -117.16, 1],
    ["San Francisco", 37.77, -122.42, 1],
    ["San Jose", 9.93, -84.08, 1],
    ["San Juan", 18.47, -66.11, 1],
    ["San Salvador", 13.69, -89.19, 1],
    ["Santiago", -33.45, -70.67, 1],
    ["Santo Domingo", 18.49, -69.93, 0.89],
    ["Sao Paulo", -23.55, -46.63, 1],
    ["Sarajevo", 43.86, 18.41, 0.16],
    ["Seattle", 47.61, -122.33, 1],
    ["Seoul", 37.57, 126.98, 1],
    ["Shanghai", 31.23, 121.47, 1],
    ["Shenzhen", 22.54, 114.06, 1],
    ["Singapore", 1.35, 103.82, 1],
    ["Skopje", 42, 21.43, 0.66],
    ["Sofia", 42.7, 23.32, 0.81],
    ["St Louis", 38.63, -90.2, 1],
    ["St Petersburg", 59.93, 30.34, 1],
    ["Stockholm", 59.33, 18.06, 1],
    ["Suva", -18.14, 178.44, 0.43],
    ["Sydney", -33.87, 151.21, 1],
    ["Taipei", 25.03, 121.57, 1],
    ["Tallinn", 59.44, 24.75, 0.77],
    ["Tampa", 27.95, -82.46, 1],
    ["Tashkent", 41.3, 69.24, 1],
    ["Tbilisi", 41.72, 44.79, 0.69],
    ["Tegucigalpa", 14.1, -87.22, 0.5],
    ["Tehran", 35.69, 51.39, 1],
    ["Tel Aviv", 32.08, 34.78, 1],
    ["Thimphu", 27.47, 89.64, 0.12],
    ["Tianjin", 39.13, 117.2, 1],
    ["Tijuana", 32.51, -117.02, 1],
    ["Tirana", 41.33, 19.82, 0.43],
    ["Tokyo", 35.68, 139.69, 1],
    ["Toronto", 43.65, -79.38, 1],
    ["Tripoli", 32.89, 13.19, 1],
    ["Tunis", 36.81, 10.18, 1],
    ["Ulaanbaatar", 47.89, 106.91, 0.62],
    ["Ulan-Ude", 51.83, 107.6, 0.77],
    ["Vancouver", 49.28, -123.12, 1],
    ["Vienna", 48.21, 16.37, 1],
    ["Vientiane", 17.97, 102.6, 0.54],
    ["Vilnius", 54.69, 25.28, 0.81],
    ["Vladivostok", 43.12, 131.89, 0.96],
    ["Volgograd", 48.71, 44.51, 1],
    ["Warsaw", 52.23, 21.01, 1],
    ["Washington DC", 38.91, -77.04, 1],
    ["Wellington", -41.29, 174.78, 1],
    ["Windhoek", -22.56, 17.08, 0.66],
    ["Winnipeg", 49.9, -97.14, 1],
    ["Wuhan", 30.59, 114.31, 0.96],
    ["Wuxi", 31.57, 120.3, 0.81],
    ["Yangon", 16.87, 96.2, 0.89],
    ["Yaounde", 3.87, 11.52, 0.47],
    ["Yekaterinburg", 56.84, 60.61, 1],
    ["Yerevan", 40.18, 44.51, 0.77],
    ["Zagreb", 45.81, 15.98, 1],
    ["Zurich", 47.38, 8.54, 1]

  ];

  return {
    LAND_W: LAND_W,
    LAND_H: LAND_H,
    isLand: isLand,
    isLandUV: isLandUV,
    isDesert: isDesert,
    uvOf: uvOf,
    CITIES: CITIES
  };
})();
