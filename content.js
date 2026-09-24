// content.js
// Runs on Hemnet and Booli listing pages. Extracts price/fee/address via
// text-pattern matching (robust to markup/class-name changes since both
// sites are React/Next apps that restyle often), then asks the background
// worker to geocode the address and find nearby amenities, and renders a
// floating overlay panel with the results plus a personal note field.

(function () {
  // The number must START with a digit. Without that, a label that happens to
  // appear in running text ("Bevaka slutpris") matches with a whitespace-only
  // capture, parseInt("") gives NaN, and extraction silently yields null.
  const SEK_NUM = "\\d[\\d\\s\\u00A0.,]*"; // 3 795 000 / 75,6 / 1.250.000

  function toNumber(str) {
    if (!str) return null;
    const n = parseInt(String(str).replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }

  // Swedish decimals use a comma, thousands a space/nbsp/dot, so strip the
  // latter and treat the comma as the decimal point (75,6 m² -> 75.6).
  function toDecimal(str) {
    if (!str) return null;
    const n = parseFloat(String(str).replace(/[\s .]/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  // Slightly longer than the worst case the worker allows itself — one geocode
  // plus a 40 s budget covering both Overpass mirrors, which it races in
  // parallel — so this timer only fires when the worker genuinely never
  // answers. It also matches the "up to a minute" the loading text promises.
  const AMENITY_TIMEOUT_MS = 60000;

  // Per-area units come first so "50 198 kr/m²" is captured as kr/m² and not as
  // a bare "kr" — that distinction is what keeps a Pris/m² figure out of price.
  const UNIT = "kr\\s*\\/\\s*(?:mån|år|m²|kvm)|kr|m²|kvm";

  function findAllAfterLabel(text, labelPattern) {
    // Named groups so this can't break again if labelPattern ever contains its
    // own capturing group (as "(Utgångspris|...)" did).
    const re = new RegExp(
      labelPattern + "\\D{0,10}(?<num>" + SEK_NUM + ")\\s*(?<unit>" + UNIT + ")?",
      "gi"
    );
    return [...text.matchAll(re)].map((m) => ({
      num: m.groups.num,
      unit: (m.groups.unit || "").toLowerCase(),
      index: m.index
    }));
  }

  // Tries labels in priority order instead of as one alternation, so the most
  // specific label wins even when a vaguer one appears earlier in the page text.
  // `accept` lets a caller skip matches with the wrong unit and keep scanning.
  function findFirstLabel(text, labels, accept) {
    for (const label of labels) {
      for (const hit of findAllAfterLabel(text, label)) {
        if (toNumber(hit.num) == null) continue;
        if (accept && !accept(hit)) continue;
        return hit;
      }
    }
    return null;
  }

  const isPerArea = (hit) => /m²|kvm/.test(hit.unit);

  function extractAddress() {
    // The h1 holds only the street ("Sturegatan 1A"), which is far too vague to
    // geocode. The document title carries the locality too: "Sturegatan 1A i
    // Främre Luthagen, Uppsala kommun - lägenhet till salu - Hemnet".
    const h1 = (document.querySelector("h1")?.innerText || "").trim();
    const titleMain = (document.title || "").split(/\s+[-–|]\s+/)[0].trim();
    const fromTitle = titleMain.replace(/\s+i\s+/i, ", ");
    // Only trust the title when it actually contains the street from the h1,
    // and drop whatever precedes it — Booli titles read "Lägenhet till salu på
    // Riddargatan 49, Östermalm, Stockholm", and that prefix breaks geocoding.
    const at = h1 ? fromTitle.toLowerCase().indexOf(h1.toLowerCase()) : -1;
    if (at >= 0) return fromTitle.slice(at);
    return firstNonEmpty(h1, fromTitle);
  }

  function extractListing() {
    const bodyText = document.body.innerText;

    const address = extractAddress();

    // The bare "Pris" fallback must not swallow "Pris/m²" (a per-square-metre
    // figure) or "Prisutveckling", both of which sit above Utgångspris.
    const price = toNumber(
      findFirstLabel(
        bodyText,
        ["Utgångspris", "Begärt pris", "Slutpris", "Pris(?![a-zåäöA-ZÅÄÖ])"],
        (hit) => !isPerArea(hit)
      )?.num
    );
    const avgift = toNumber(findFirstLabel(bodyText, ["Avgift"])?.num);
    const boarea = toDecimal(findFirstLabel(bodyText, ["Boarea"])?.num);

    // Hemnet prints driftkostnad as kr/år in one block and kr/mån in another;
    // normalise to a yearly figure so monthlyCost() can safely divide by 12.
    const drift = findFirstLabel(bodyText, ["Driftkostnad"]);
    const driftValue = toNumber(drift?.num);
    const driftkostnad =
      driftValue == null ? null : /mån/.test(drift.unit) ? driftValue * 12 : driftValue;

    return { address, price, avgift, driftkostnad, boarea, url: location.href };
  }

  function firstNonEmpty(...vals) {
    return vals.find((v) => v && v.trim().length > 0) || "";
  }

  function normalizeAddressKey(address) {
    return address.toLowerCase().replace(/[^a-z0-9åäö]/gi, "");
  }

  function monthlyCost({ price, avgift, driftkostnad }, assumptions) {
    const loanAmount = Math.max(0, price * (1 - assumptions.downPaymentPct / 100));
    const yearlyRatePct = (assumptions.interestPct + assumptions.amortizationPct) / 100;
    const loanMonthly = (loanAmount * yearlyRatePct) / 12;
    const driftMonthly = driftkostnad ? driftkostnad / 12 : 0;
    return Math.round(loanMonthly + (avgift || 0) + driftMonthly);
  }

  function formatSEK(n) {
    if (n == null) return "okänt";
    return n.toLocaleString("sv-SE") + " kr";
  }

  async function render(listing) {
    const { assumptions } = await chrome.storage.local.get(["assumptions"]);
    const settings = assumptions || { interestPct: 4.0, amortizationPct: 2.0, downPaymentPct: 15 };

    const key = normalizeAddressKey(listing.address);
    const { notes } = await chrome.storage.local.get(["notes"]);
    const savedNote = (notes || {})[key] || { text: "", stars: 0 };

    const panel = document.createElement("div");
    panel.id = "bostadssok-companion-panel";
    panel.innerHTML = `
      <div class="bsc-header">
        <span>Bostadssök Companion</span>
        <button class="bsc-close" title="Dölj">×</button>
      </div>
      <div class="bsc-section">
        <div class="bsc-row"><strong>Verklig månadskostnad</strong></div>
        <div class="bsc-row bsc-cost">${formatSEK(monthlyCost(listing, settings))}/mån</div>
        <div class="bsc-row bsc-small">Ränta ${settings.interestPct}% · amortering ${settings.amortizationPct}% · kontantinsats ${settings.downPaymentPct}% — <a href="#" class="bsc-edit-assumptions">ändra</a></div>
      </div>
      <div class="bsc-section bsc-amenities"></div>
      <div class="bsc-section">
        <div class="bsc-row"><strong>Din anteckning</strong></div>
        <div class="bsc-stars">
          ${[1, 2, 3, 4, 5].map((n) => `<span data-star="${n}" class="bsc-star ${n <= savedNote.stars ? "bsc-star-filled" : ""}">★</span>`).join("")}
        </div>
        <textarea class="bsc-note" placeholder="T.ex. bra läge men mörkt kök...">${savedNote.text}</textarea>
      </div>
    `;
    document.body.appendChild(panel);

    panel.querySelector(".bsc-close").addEventListener("click", () => panel.remove());

    let currentStars = savedNote.stars;
    panel.querySelectorAll(".bsc-star").forEach((starEl) => {
      starEl.addEventListener("click", async () => {
        currentStars = Number(starEl.dataset.star);
        panel.querySelectorAll(".bsc-star").forEach((s) => {
          s.classList.toggle("bsc-star-filled", Number(s.dataset.star) <= currentStars);
        });
        await saveNote(key, listing, currentStars, panel.querySelector(".bsc-note").value);
      });
    });

    const noteEl = panel.querySelector(".bsc-note");
    let saveTimer = null;
    noteEl.addEventListener("input", () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveNote(key, listing, currentStars, noteEl.value), 600);
    });

    panel.querySelector(".bsc-edit-assumptions").addEventListener("click", (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });

    loadAmenities(panel, listing);
  }

  // Amenities come from the background worker (geocoding + Overpass). Split out
  // of render() so the retry button can run exactly the same request again.
  function loadAmenities(panel, listing) {
    const box = panel.querySelector(".bsc-amenities");
    if (!box) return;

    // Say how long this can take. The worker races two Overpass mirrors with a
    // 40 s budget, and a queued mirror routinely uses most of it — without a
    // hint the panel just looks frozen.
    box.innerHTML = `
      <div class="bsc-row"><strong>Avstånd</strong></div>
      <div class="bsc-row bsc-small bsc-loading">Söker avstånd (kan ta upp till en minut)…</div>
    `;

    // The service worker can be evicted before it replies, so cap the wait here
    // too and ignore a late answer once we have given up.
    let settled = false;
    const amenityTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      showAmenityError(panel, listing);
    }, AMENITY_TIMEOUT_MS);

    chrome.runtime.sendMessage({ type: "FIND_AMENITIES", address: listing.address }, (resp) => {
      if (settled) return;
      settled = true;
      clearTimeout(amenityTimer);
      if (!panel.isConnected) return; // panel was closed while we waited
      if (!resp?.ok) {
        showAmenityError(panel, listing);
        return;
      }
      const { forskola, mataffar, kollektivtrafik } = resp.amenities;
      const target = panel.querySelector(".bsc-amenities");
      if (!target) return;
      target.innerHTML = `
        <div class="bsc-row"><strong>Avstånd</strong></div>
        ${amenityRow("Förskola", forskola)}
        ${amenityRow("Mataffär", mataffar)}
        ${amenityRow("Kollektivtrafik", kollektivtrafik)}
      `;
    });
  }

  function showAmenityError(panel, listing) {
    const box = panel.querySelector(".bsc-amenities");
    if (!box) return;
    // Overloaded mirrors are transient, so offer a retry instead of a dead end.
    box.innerHTML = `
      <div class="bsc-row"><strong>Avstånd</strong></div>
      <div class="bsc-row bsc-small">Avstånd kunde inte hämtas just nu — speglarna är överbelastade</div>
      <button class="bsc-retry" type="button">Försök igen</button>
    `;
    box.querySelector(".bsc-retry").addEventListener("click", () => loadAmenities(panel, listing));
  }

  function amenityRow(label, item) {
    if (!item) return `<div class="bsc-row bsc-small">${label}: ingen hittad inom 2 km</div>`;
    // Plenty of OSM nodes are unnamed; don't leave a dangling em dash.
    const name = item.name ? " — " + escapeHtml(item.name) : "";
    return `<div class="bsc-row bsc-small">${label}: ${item.distanceM} m${name}</div>`;
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  async function saveNote(key, listing, stars, text) {
    const { notes } = await chrome.storage.local.get(["notes"]);
    const all = notes || {};
    all[key] = { text, stars, address: listing.address, url: listing.url, updatedAt: Date.now() };
    await chrome.storage.local.set({ notes: all });
  }

  // Hemnet/Booli are client-rendered SPAs; give hydration a moment, then
  // watch for the content to actually appear before extracting.
  // Gate on a usable price rather than on "some content exists". Hemnet renders
  // the Utgångspris block noticeably later than the rest of the page, and
  // rendering on the first mutation picked up the Pris/m² figure instead.
  function tryRender() {
    if (document.getElementById("bostadssok-companion-panel")) return true;
    if (!document.querySelector("h1")) return false;
    const listing = extractListing();
    if (!listing.address || !listing.price) return false;
    render(listing);
    return true;
  }

  const observer = new MutationObserver(() => {
    if (tryRender()) observer.disconnect();
  });

  // Check once up front: at document_idle the page may already be hydrated, and
  // an observer that never fires would leave the panel permanently missing.
  if (!tryRender()) {
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 15000); // safety timeout
  }

  // Exposed for the jsdom test harness only; harmless in production.
  window.__bscExtractListing = extractListing;
  window.__bscMonthlyCost = monthlyCost;
})();
