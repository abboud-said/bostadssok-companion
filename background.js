// background.js
// Geocodes the listing address via OpenStreetMap Nominatim, then queries the
// Overpass API for the nearest daycare, grocery store, and public transit
// stop within 2 km. Results are cached per address to stay within the free
// public APIs' fair-use limits (see README for the compliance caveat).

const RADIUS_M = 2000;

// Endpoints are raced in parallel, so this is the total wait, not a per-step
// budget that stacks up across the list.
const OVERPASS_TIMEOUT_MS = 40000;

// overpass-api.de is deliberately absent: it answers 406 to every
// browser-origin request because it wants an identifying User-Agent, which
// fetch() is not allowed to set. Keeping it only added a guaranteed failure to
// every error message and made the real cause harder to read.
const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];

// Everything that fails upstream used to reach the user as one generic line in
// the panel. Log it here too: open the service worker console from
// chrome://extensions to see which step actually broke and how long it took.
const LOG = "[Bostadssök]";
const log = (...a) => console.log(LOG, ...a);
const warn = (...a) => console.warn(LOG, ...a);
const error = (...a) => console.error(LOG, ...a);

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocodeOnce(query) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=se&q=" +
    encodeURIComponent(query);
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    error(`Nominatim request failed after ${Date.now() - t0} ms for ${JSON.stringify(query)}:`, err);
    throw err;
  }
  if (!res.ok) {
    error(`Nominatim returned HTTP ${res.status} for ${JSON.stringify(query)}`);
    throw new Error("Geocoding failed: " + res.status);
  }
  const data = await res.json();
  if (!data.length) {
    warn(`Nominatim: no hit for ${JSON.stringify(query)} (${Date.now() - t0} ms)`);
    return null;
  }
  log(`Nominatim: ${JSON.stringify(query)} -> ${data[0].display_name} ` +
      `[${data[0].lat}, ${data[0].lon}] (${Date.now() - t0} ms)`);
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

async function geocode(address) {
  // Addresses arrive as "Sturegatan 1A, Främre Luthagen, Uppsala kommun".
  // Nominatim often misses the neighbourhood, so fall back to street +
  // municipality (without the "kommun" suffix) before giving up.
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  const street = parts[0];
  const municipality = parts.length > 1 ? parts[parts.length - 1].replace(/\s*kommun$/i, "") : null;

  const candidates = [address];
  if (municipality) candidates.push(street + ", " + municipality);
  if (parts.length > 2) candidates.push(street + ", " + parts[1]);

  for (const c of candidates) {
    const hit = await geocodeOnce(c + ", Sverige");
    if (hit) return hit;
  }
  // Joined rather than passed as an array: an array logs as "Array(2)" in the
  // service worker console until you expand it.
  error(`Geocoding gave up on ${JSON.stringify(address)}; tried: ${candidates.join(" | ")}`);
  throw new Error("Adressen hittades inte.");
}

async function queryOverpass(lat, lon) {
  const query = `
    [out:json][timeout:15];
    (
      node["amenity"="kindergarten"](around:${RADIUS_M},${lat},${lon});
      node["shop"="supermarket"](around:${RADIUS_M},${lat},${lon});
      node["highway"="bus_stop"](around:${RADIUS_M},${lat},${lon});
      node["railway"="station"](around:${RADIUS_M},${lat},${lon});
      node["railway"="tram_stop"](around:${RADIUS_M},${lat},${lon});
    );
    out body;
  `;
  // The mirrors are queried in parallel and the first usable answer wins, so
  // the user waits for the fastest mirror rather than for the slow one plus
  // the fast one. Both requests are always sent; that is the cost of not
  // making everyone wait out a queue. Overpass results are cached for 30 days,
  // so this is at most two requests per address, not per page view.
  const attempt = async (endpoint) => {
    const host = new URL(endpoint).host;
    const t0 = Date.now();
    let res;
    try {
      // URLSearchParams sets application/x-www-form-urlencoded; a plain string
      // body would make fetch send text/plain, which Overpass also rejects.
      // The [timeout:] in the query only bounds server-side execution — a busy
      // mirror can sit on a request for minutes before running it — so the
      // real bound has to come from the client.
      res = await fetch(endpoint, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS)
      });
    } catch (err) {
      const why = err.name === "TimeoutError"
        ? `tidsgräns efter ${OVERPASS_TIMEOUT_MS} ms`
        : String(err.name || err);
      warn(`Overpass ${host} failed after ${Date.now() - t0} ms — ${why}`);
      throw new Error(`${host}: ${why}`); // reject so Promise.any moves on
    }
    const ms = Date.now() - t0;
    if (!res.ok) {
      // A non-ok response resolves rather than rejects, so turn it into a
      // rejection or Promise.any would treat 504 as a winning answer.
      warn(`Overpass ${host} returned HTTP ${res.status} after ${ms} ms`);
      throw new Error(`${host}: HTTP ${res.status}`);
    }
    const data = await res.json();
    log(`Overpass ${host} answered first: ${data.elements?.length ?? 0} elements (${ms} ms)`);
    return data.elements || [];
  };

  const t0 = Date.now();
  try {
    return await Promise.any(OVERPASS_ENDPOINTS.map(attempt));
  } catch (err) {
    // Promise.any rejects with an AggregateError holding every failure.
    const failures = (err.errors || [err]).map((e) => e.message).join("; ");
    error(`Overpass: every endpoint failed after ${Date.now() - t0} ms — ${failures}`);
    throw new Error("Overpass failed — " + failures);
  }
}

function nearestOfType(elements, lat, lon, predicate) {
  let best = null;
  for (const el of elements) {
    if (!predicate(el)) continue;
    const d = haversineMeters(lat, lon, el.lat, el.lon);
    if (!best || d < best.distanceM) {
      best = { distanceM: Math.round(d), name: el.tags?.name || null };
    }
  }
  return best;
}

async function findAmenities(address) {
  const cacheKey = "amenities:" + address.toLowerCase();
  const cached = await chrome.storage.local.get([cacheKey]);
  if (cached[cacheKey] && Date.now() - cached[cacheKey].fetchedAt < 30 * 24 * 60 * 60 * 1000) {
    log(`cache hit for ${JSON.stringify(address)}`);
    return cached[cacheKey].data; // cache for 30 days, addresses don't move
  }

  log(`looking up ${JSON.stringify(address)} (not cached)`);
  const { lat, lon } = await geocode(address);
  const elements = await queryOverpass(lat, lon);

  const result = {
    forskola: nearestOfType(elements, lat, lon, (e) => e.tags?.amenity === "kindergarten"),
    mataffar: nearestOfType(elements, lat, lon, (e) => e.tags?.shop === "supermarket"),
    kollektivtrafik: nearestOfType(
      elements,
      lat,
      lon,
      (e) => e.tags?.highway === "bus_stop" || e.tags?.railway === "station" || e.tags?.railway === "tram_stop"
    )
  };

  await chrome.storage.local.set({ [cacheKey]: { data: result, fetchedAt: Date.now() } });
  return result;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "FIND_AMENITIES") {
    findAmenities(msg.address)
      .then((amenities) => sendResponse({ ok: true, amenities }))
      .catch((err) => {
        // The panel only ever shows one generic sentence, so this is the only
        // place the real cause and stack survive.
        error(`FIND_AMENITIES failed for ${JSON.stringify(msg.address)}:`, err);
        sendResponse({ ok: false, error: String(err.message || err) });
      });
    return true; // async response
  }
});
