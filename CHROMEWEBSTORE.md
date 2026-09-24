# CHROMEWEBSTORE.md — Bostadssök Companion

Tracks Developer Dashboard fields and permission justifications for
submission. Copy the relevant sections straight into the Chrome Web Store
Developer Dashboard when publishing.

## Single purpose

Shows a calculated real monthly housing cost (using the user's own
interest/amortization/down-payment assumptions) and distance to daycare,
groceries, and public transit directly on Hemnet and Booli listing pages,
and lets the user save a private note and star rating per listing.

## Permissions requested & justification

| Permission | Why it's needed |
|---|---|
| `storage` | Store the user's cost-calculation assumptions and their private notes/ratings per address, locally, so they persist between visits. |
| Host permission: `https://www.hemnet.se/*`, `https://www.booli.se/*` | The content script only runs on listing pages of these two sites to read the publicly visible price/fee/address text and inject the overlay panel. |
| Host permission: `https://nominatim.openstreetmap.org/*` | Geocodes the listing's address (free, keyless OpenStreetMap service) so distances can be calculated. |
| Host permission: `https://overpass.kumi.systems/*`, `https://overpass.private.coffee/*` | Queries OpenStreetMap for the nearest daycare, supermarket, and transit stop within 2 km of the listing. Two interchangeable Overpass mirrors are listed because they are raced in parallel and the first usable answer wins; the official `overpass-api.de` is deliberately not requested, since it answers 406 to every browser-origin request. |

## Data handling summary (for the Privacy tab)

- **Collected:** the listing address, price, and fee text visible on the
  page the user is viewing; the user's own free-text notes and star
  ratings.
- **Sent off-device:** the listing address only, sent to Nominatim (for
  geocoding) and Overpass (for nearby amenities) — both third-party,
  free OpenStreetMap community services, not controlled by us. No other
  data leaves the browser.
- **Not collected:** no account, no analytics, no browsing history outside
  the two supported domains.
- **Retention:** notes and settings live in `chrome.storage.local` only,
  removable by uninstalling the extension.

## Compliance note

Nominatim and Overpass are free, fair-use public services (informal cap
around 1 request/second, no bulk/commercial scraping). Fine for personal
use or a small beta — though live testing already saw an Overpass mirror
queue a single request for 162 seconds, so distances will be unreliable
at any real volume even before a hard block. If this extension gets real user volume, geocoding
must move to a paid provider (e.g. Mapbox, 100k free requests/month) before
a wider launch, to avoid the shared IP getting rate-limited or blocked.

## Known follow-ups before submission

- [x] Test against real, live Hemnet/Booli listing pages in an actual
      browser. Done 2026-09-07 against three live listings (Hemnet
      lägenhet + villa, Booli lägenhet); six bugs found and fixed, see
      "Live-test findings" below.
- [x] Real icon set. Done 2026-09-07: three separately drawn SVGs in
      ../icon-src/, each rasterised at its own native size (no bitmap is
      scaled). Default icon puts the mark on a light plate so it holds
      contrast on light and dark toolbars alike (worst case 6.05:1); see
      "Icon notes" below.
- [ ] Hosted privacy policy page, since third-party hosts are contacted.
- [ ] Screenshots showing the overlay panel on a real listing.
- [ ] Decide the compliance path above before any meaningful user growth.

## Live-test findings (2026-09-07)

Tested in Chrome 152 against three live listings: a Hemnet lägenhet
(Sturegatan 1A, Uppsala), a Hemnet villa (Rämshyttan 406, Ludvika), and a
Booli lägenhet (Riddargatan 49, Stockholm). Six bugs surfaced that the
synthetic fixtures had not:

1. **Panel never appeared on Hemnet.** `document.body.innerText` contains
   "Bevaka slut*pris*" long before "Utgångspris", and the number pattern
   allowed a whitespace-only match, so price came back `null` and `render()`
   bailed out. The captured number must now start with a digit, and labels
   are tried in priority order instead of as one alternation.
2. **Wrong price when the panel did render.** Hemnet paints "Pris/m²"
   before the Utgångspris block, so an early render captured 50 198 kr
   (per m²) as the asking price. Matches are now unit-aware and per-area
   figures are skipped, and rendering waits until a usable price exists.
3. **Distances always failed.** `overpass-api.de` answers 406 to any
   browser-origin request. Two CORS-friendly mirrors are tried first.
4. **Panel stretched to full viewport height on Hemnet.** Hemnet ships
   `body > div:not(...) { height: 100% }` and exempts only its own
   overlays. The panel now pins `height: auto !important` and caps itself
   with `max-height: calc(100vh - 106px)`.
5. **Booli addresses failed to geocode.** The page title reads "Lägenhet
   till salu på Riddargatan 49, …"; the prefix is now trimmed.
6. **"Söker…" could hang forever.** A busy Overpass mirror queues a
   request rather than rejecting it — one measured wait was 162 s — and
   the [timeout:15] inside the query only bounds server-side execution,
   not the queue. Each endpoint now gets a 15 s client-side
   AbortSignal.timeout budget, and the panel caps its own wait at 50 s
   and says so. Measured after the fix: first mirror aborted at 15 s,
   second answered, distances shown at 34 s.

Also improved while testing: the address sent for geocoding now includes
the locality (the h1 alone is just a street name), boarea keeps its
decimal (75,6 m² was parsed as 756), and driftkostnad is normalised to a
yearly figure so a kr/mån value is no longer divided by 12 a second time.

Verified working end to end: price/fee extraction, monthly-cost maths,
amenity distances, star rating and note persisting across a reload, and
the popup listing saved homes.

## Icon notes (2026-09-07)

Source SVGs live in `../icon-src/` (one per size, outside the packaged
folder). `render-icons` rasterises each at its own native size in Chrome
on a transparent background — no bitmap is ever scaled up or down, which
is what was wrong with the placeholders: all three shipped the same
14-pixel glyph, so it was illegible at 128 and a smudge at 16.

**The default icon puts the brand-green mark on a white plate with rounded
corners.** That is not decoration: no flat colour can clear 3:1 against
both a light and a dark toolbar (proof under "Why the dark variant cannot
simply become the default"), and since `icon_variants` is inert only one
icon is ever shown. A plate makes the icon carry its own contrast, so it
stops depending on the toolbar colour at all. The plate is full-bleed
because at 16px the padding is the expensive part.

Per-size decisions:

- **16px** — solid silhouette on the plate, no kr badge. A stroked outline
  collapses at this size (the gap between roof line and body line fills
  in). A first attempt kept a thin roof overhang; it rendered as pale grey
  slivers rather than roof, so the roof is a plain wide triangle on the
  body. The triangle base and both walls sit on whole pixels and stay
  crisp. The plate costs the house about 2px of width versus the
  plateless version — the one real price of this design.
- **48px** — line-style house plus a simplified kr badge, scaled to 0.93
  and re-seated so the badge (the widest and lowest element) clears the
  plate edge. At the badge radius the house geometry first allowed, "kr"
  rendered as an unreadable blob, so the house was shrunk to let the badge
  grow. No door — at 48 the extra line closes up the body. The badge's
  white separating ring now reads as a gap in the plate, which is the
  effect it was drawn for.
- **128px** — full detail: house with door and a clear kr badge, scaled to
  0.924 with a 12px plate margin. Stroke weight matches 48px optically
  (~6-7% of the canvas), not absolutely. The drop shadow the plateless
  version used is gone: the plate supplies that depth, and a shadow inside
  a hard-edged plate reads as a printing error rather than lift.

The previous plateless line versions are kept as
`../icon-src/icon{16,48,128}-line.svg` in case the plate is ever dropped.

### Dark colour scheme variants

A second set (`icons/icon{16,48,128}-dark.png`, sources `../icon-src/
icon{16,48,128}-dark.svg`) exists because the brand green is close to
invisible on a dark toolbar. Same geometry, three deliberate changes:

- Colour lifts to `#4ADE80` — same hue family (~142 deg), chosen for
  headroom. `#16A34A` was the first shade to clear 3:1, but only at
  3.66:1, and Chrome's dark toolbar shade varies by theme and platform.
- The badge's white separating ring becomes a real transparent gap,
  punched through the house with an SVG mask, so it works against any
  dark shade instead of assuming one. A white ring reads as a halo on
  dark.
- The 128px drop shadow is dropped rather than recoloured — a dark green
  shadow under a light green house on a dark ground adds nothing.

Contrast measured on the shipped pixels (dominant fully-opaque colour of
each PNG, not the hex in the source), WCAG minimum for UI components is
3:1:

| Background | Light variant | Dark variant |
|---|---|---|
| Chrome dark toolbar `#35363A` | 1.32:1 FAIL | **6.93:1 PASS** |
| Incognito / darker `#202124` | 1.80:1 FAIL | **9.24:1 PASS** |
| Lighter dark theme `#5F6368` | 1.48:1 FAIL | **3.47:1 PASS** |
| Pure black `#000000` | 2.35:1 FAIL | **12.05:1 PASS** |

All three dark sizes pass on every background tested; the worst case is
3.47:1 on the lightest grey a dark theme is likely to use.

**The `icon_variants` manifest key does nothing in Chrome 152.** The key
is declared (top level and under `action`), but this Chrome build ignores
it. Verified rather than assumed:

1. An extension whose manifest has *only* `icon_variants`, with `icons`
   and `action.default_icon` removed, falls back to the generic puzzle
   piece — Chrome finds no icon at all.
2. Chrome refuses to load an extension with a malformed *known* key
   (`"icons": "not-an-object"` gives "Invalid value for 'icons'."), but
   accepts `"icon_variants": "not-an-array"` silently, exactly as it
   accepts an invented key. So Chrome's parser does not know the key.
3. There is no related entry in `chrome://flags`.

Note that "no install warnings" proves nothing here — Chrome ignores
unknown manifest keys without warning, which a misspelled-key control
confirmed.

The key is kept because it is inert (proven above) and is the forward
path if Chrome ships support, but **the dark PNGs currently ship unused**.
Until then the toolbar icon in dark mode is the low-contrast light
variant. Re-check on a Chrome that supports the key before treating this
as fixed.

### Rasterisation gotcha

Render with `--force-color-profile=srgb`. Without it Chrome rasterises
into the display's colour profile and the exported PNGs are off-brand:
`#14532D` shipped as `#23532C` and `#4ADE80` as `#6CDE7D` before the flag
was added. Contrast was measured on decoded PNG pixels afterwards to
confirm the shipped files really are the intended colours.

### Why the dark variant cannot simply become the default

Since `icon_variants` is inert, only one icon is ever shown, so the
obvious move is to pick whichever single colour survives both toolbars.
It was measured rather than assumed. `#4ADE80` is not it:

| Background | `#14532D` (default) | `#4ADE80` (dark variant) | `#1D9250` (best compromise) |
|---|---|---|---|
| White `#FFFFFF` | 9.11:1 | 1.74:1 FAIL | 3.98:1 |
| Chrome light toolbar `#DEE1E6` | 6.95:1 | 1.33:1 FAIL | 3.03:1 |
| Chrome dark toolbar `#35363A` | 1.32:1 FAIL | 6.93:1 | 3.03:1 |
| Mid grey `#5F6368` | 1.51:1 FAIL | 3.47:1 | 1.52:1 FAIL |

`#1D9250` is the best colour that exists inside the brand hue (143.8 deg
+/- 3), found by exhaustive search over sRGB. It clears 3:1 on both real
toolbars — but only just: 3.03:1 is the arithmetic maximum any single
colour can reach against `#DEE1E6` and `#35363A` together, because those
two demand a luminance inside [0.2110, 0.2170], a band 0.006 wide. There
is no margin for a theme whose toolbar is a slightly different shade.

And no flat colour clears 3:1 on all four backgrounds — that is
arithmetically impossible, not merely hard. Mid grey `#5F6368` requires
luminance <= 0.0079 or >= 0.4707; the two toolbars require it to sit in
[0.2110, 0.2170]. The sets do not intersect.


**Resolved by giving the mark a plate instead of picking a colour.** The
default icon is `#14532D` on a full-bleed white plate. Contrast for a
plated icon is two relationships, not one: whether the mark is readable
on the plate (constant, background-independent) and whether the icon
separates from the toolbar. The icon is perceivable if *either* the plate
or the mark contrasts with the background, so the effective figure is the
larger of the two. Measured on the shipped PNG pixels, identical at all
three sizes:

| Background | Plate vs bg | Mark vs bg | Effective |
|---|---|---|---|
| White `#FFFFFF` | 1.00:1 | 9.11:1 | **9.11:1** |
| Chrome light toolbar `#DEE1E6` | 1.31:1 | 6.95:1 | **6.95:1** |
| Chrome dark toolbar `#35363A` | 12.07:1 | 1.32:1 | **12.07:1** |
| Mid grey `#5F6368` | 6.05:1 | 1.51:1 | **6.05:1** |

Mark vs plate is 9.11:1 everywhere. Worst effective contrast on any
background is 6.05:1 — double the 3:1 floor, against 3.03:1 with zero
headroom for the best flat colour, which failed mid grey outright.

On a white page the plate is invisible (1.00:1) and the icon simply reads
as the green house; the plate only announces itself where it is needed.

## Service worker logging (2026-09-07)

`background.js` logs every step of an amenity lookup to the service worker
console (chrome://extensions -> "service worker"), prefixed `[Bostadssök]`.
Added after a report that a listing showed "Kunde inte hitta avstånd" with
no way to tell which step failed: Nominatim's answer, each Overpass
endpoint's status and timing, and the final rejection with its stack.

It also fixed a misleading error string. The old code kept only the *last*
endpoint's status, so a run where both working mirrors timed out was
reported as "Overpass failed: 406" — blaming `overpass-api.de`, whose 406
is structural and expected, rather than the timeouts that were the real
cause. Every endpoint's outcome is now collected and reported together.

Verified by capturing the worker's console during real round trips: cache
hit, Nominatim hit, Nominatim no-hit into geocoding failure, per-endpoint
Overpass warnings, and the final error with stack. The Overpass *success*
line was not exercised — the mirrors were unavailable throughout testing
(see below).

### Overpass availability, measured 2026-09-07

Diagnosing the Spelvägen 3 report showed the failure is not
address-specific and not a geocoding problem. Nominatim resolved the
address to an exact house number in 6 ms
(`3, Spelvägen, Hammartorp, Trångsund, ... 142 60` at 59.2304, 18.1358).
Overpass is what fails:

| Endpoint | Result |
|---|---|
| `overpass.kumi.systems` | 34.7 s (success) in one probe; timed out past 75 s later the same session |
| `overpass.private.coffee` | HTTP 504 after ~72 s |
| `overpass-api.de` | HTTP 406, always — structural, cannot work from a browser |

The Uppsala address that worked earlier failed the same way minutes
later, so this is upstream congestion, not a per-listing issue. The 15 s
per-endpoint budget is currently too tight for these mirrors, but raising
it trades one failure mode for another: the panel would sit on "Söker..."
for up to 45 s. Left at 15 s pending a decision; the compliance note above
already flags that these free instances are not dependable at volume.

## Overpass handling reworked (2026-09-07)

Three changes after the Spelvägen diagnosis:

1. **`overpass-api.de` removed** from the endpoint list and from
   `host_permissions`. Its 406 is structural — it wants an identifying
   `User-Agent` that `fetch()` may not set — so it could only ever add a
   guaranteed failure to the end of every error message.
2. **The two remaining mirrors are raced in parallel** with `Promise.any`
   and a 40 s budget, instead of being tried in sequence with 15 s each.
   The user now waits for the fastest mirror rather than for the slow one
   plus the fast one. A non-ok response is converted into a rejection, or
   `Promise.any` would accept a 504 as a winning answer. Both requests are
   always sent; results stay cached for 30 days, so that is at most two
   requests per address, not per page view.
3. **The panel offers a retry instead of a dead end.** Loading now reads
   "Söker avstånd (kan ta upp till en minut)…" so a slow lookup does not
   look frozen, and failure reads "Avstånd kunde inte hämtas just nu —
   speglarna är överbelastade" with a "Försök igen" button that re-runs the
   same request. The content script's own timeout moved 50 s -> 60 s to
   match what the loading copy promises.

Verified against the service worker console and the live Spelvägen
listing, with the mirrors stubbed through CDP where the real ones were
unavailable:

- **Parallel dispatch**: both requests intercepted 1 ms apart (+57 ms,
  +58 ms after the call started).
- **Fastest answer wins**: with one mirror stubbed to answer and the other
  left hanging, the whole lookup returned in 66 ms rather than waiting out
  the hanging mirror's 40 s. Verified with each mirror as the winner.
- **Real-world failure path**: with both mirrors genuinely down, each
  logged a 40 s timeout but the total was 40005 ms — one budget, not two.
- **Panel states**: loading copy observed with requests held open; error
  copy and "Försök igen" observed on the live listing; clicking retry
  issued two further Overpass requests and resolved.
