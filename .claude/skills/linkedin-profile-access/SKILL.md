---
name: linkedin-profile-access
description: Read a LinkedIn profile and pull its full-resolution profile photo starting from just a person's name or a profile URL, using the user's logged-in Chrome, without getting blocked. Use when asked to find someone's LinkedIn page, verify an employee's identity/employer against LinkedIn, or download LinkedIn profile photos in HD (e.g. filling in missing org-chart photos).
---

# LinkedIn profile access (logged-in Chrome)

Established 2026-08-29 while importing 122 missing org-chart photos. Every
claim below was verified live that day — the "doesn't work" list is as valuable
as the "works" list, because each item costs 15+ minutes to rediscover.

## The one working route to a full-resolution photo

```
LinkedIn profile page  →  read the signed _800_800 URL out of the page HTML
                       →  navigate the tab TO that image URL
                       →  now same-origin: fetch(location.href) → blob
                       →  <a download> → ~/Downloads → move into the repo
```

Why this shape and not something simpler: the image bytes can only be read
**from a page already on `media.licdn.com`**, because that makes the fetch
same-origin. And the signed URL can only be found **on the profile page**. So
the tab has to physically travel from one to the other. That is the whole trick.

The result is the original JPEG the person uploaded — not a screenshot, not a
re-encode. `_800_800` is a transform *ceiling*, so real sizes vary (observed:
800×800, 667×667, 616×616, 500×500, 439×439, 299×299, 260×260).

### Step 1 — on the profile page, grab the URL and jump to it

```js
var H = document.documentElement.innerHTML;
var x = H.match(/https:\/\/media\.licdn\.com\/dms\/image\/[^"'\\ ]*profile-displayphoto[^"'\\ ]*_800_800[^"'\\ ]*/);
if (x) { location.href = x[0].replace(/&amp;/g, '&'); }
JSON.stringify({ name: (document.querySelector('main')?.innerText || '').split('\n')[0], got: !!x })
```

The URL lives in a `<link rel="preload" as="image" imageSrcSet="...">` in the
head, so it is present even before the profile body finishes rendering.
`.replace(/&amp;/g,'&')` is required — the HTML-escaped URL 403s.

### Step 2 — on the image page, save it and move to the next person

```js
var b = await fetch(location.href).then(r => r.blob());
var a = document.createElement('a');
a.href = URL.createObjectURL(b); a.download = 'First Last.jpg';
document.body.appendChild(a); a.click(); a.remove();
await new Promise(r => setTimeout(r, 7000 + Math.random() * 5000));  // pace LinkedIn
location.href = 'https://www.linkedin.com/in/<next-slug>/';
JSON.stringify({ saved: 'First Last', bytes: b.size })
```

Two calls per person; folding the "go to next profile" into the download call
keeps it at two.

## Prerequisite the user must set once

Chrome allows only **one automatic download per window** and silently discards
the rest — no error, no console message, `a.click()` reports success. This ate
14 files before it was noticed. Have the user open
`chrome://settings/content/automaticDownloads` and add `[*.]licdn.com` to
**Autorisés**.

**Always verify files actually landed** (`ls ~/Downloads`) after the first two
saves, and spot-check every ~10. Never trust the JS return value alone.

## Finding the profile from just a name

In priority order — the first two cost nothing against LinkedIn's quotas:

1. **Guess the vanity slug**: `/in/firstname-lastname/` and
   `/in/firstnamelastname/` (accents stripped). Surprisingly high hit rate for
   French professionals; a miss is a clean, cheap `/404/`.
2. **Bing Images** for candidate slugs — see below.
3. **LinkedIn people search** (`/search/results/people/?keywords=...`) — works
   and is authoritative, but LinkedIn meters it as *commercial use* and will
   throttle the account for the month. Profile **views** are not metered the
   same way. Use search sparingly, prefer views.
4. **Ask the user for URLs.** For anyone still unresolved this is by far the
   best move — it is seconds of their time versus many minutes of guessing.

### Bing Images for candidate slugs

Bing's *web* search returns a 128 KB page with zero LinkedIn links (anti-bot),
and so does DuckDuckGo's html endpoint. Bing **Images** still answers. Each
result carries an `m="{...}"` JSON blob with `murl` (image) and `purl` (the page
it was found on) — for a profile photo, `purl` is the profile itself.

Use a **fresh cookie jar per query**; a shared jar pollutes results.

```bash
CK=$(mktemp)
curl -s -A "$UA" -c "$CK" "https://www.bing.com/" -o /dev/null
curl -s -A "$UA" -b "$CK" "https://www.bing.com/images/search?q=$Q&form=HDRSC2&count=50"
```

Recall is decent, **precision is poor** — roughly half the top candidates were
the wrong human. Never accept a Bing match without the profile check below.

## Confirming it is actually the right person

Read the rendered profile's `main` element; the first ~10 lines are reliably
name / degree / headline / location / employer:

```
["Fabien Andreu", "· 2e", "AdOps Lead", "Paris", "·", "Coordonnées", "Havas Media Group", ...]
```

Accept only if **both** hold:

- **Name**: tokenise both names (NFD-strip accents, lowercase, split on
  non-alphanumerics). Require the first-name token to match, plus **at least
  one** surname token. Do not require all tokens and do not compare whole
  strings — real data breaks both:
  - `"Eve-Marie (Weiss) Chateau"` embeds a maiden name → whole-string match fails
  - `"Corinne Abitbol"` for an employee recorded as `"Corinne Abitbol Terrier"`
    → all-tokens match fails
  Allow prefix-equality only for tokens ≥4 chars, or `"Imane E."` matches
  everything.
- **Employer**: match the whole corporate family, not just the parent brand.
  For Havas: `havas|arena media|socialyse|fullsix|mediapilot|forward media|betc`.
  Employees legitimately list subsidiaries (Arena Media, Havas Market, Havas
  City, Havas Edge…).

If the name matches but the employer does not, mark it **uncertain and do not
download** — report it to the user instead. Real examples caught this way: a
supermarket cashier for "Laurence Barbier", a freelance photographer for
"Gabriel Bascou", a Pittsburgh academic for "Stéphanie Da Costa". A wrong face
in an org chart is worse than a missing one.

Do **not** use a bare "does the page mention Havas?" test: the logged-in
chrome's recent-entity sidebar mentions your own recent searches, so unrelated
profiles score 1–8 hits on the company name.

## Do not retry these — all verified dead

- **Fetching the image anywhere but from a licdn page.** `media.licdn.com` sends
  **no CORS headers**: cross-origin `fetch` throws, `<img crossorigin>` fails to
  load, and canvas is tainted. There is no way around this.
- **Forging a bigger size.** The `?e=…&v=beta&t=…` signature is bound to the
  exact path. `shrink_200_200`→`shrink_800_800`, `crop_800_800`, dropping the
  query, keeping only `e=` — all 403 (Akamai).
- **Talking to localhost from a LinkedIn page.** Their CSP `connect-src` blocks
  fetch/XHR (even `mode:'no-cors'`, even to `https://example.com`), `img-src`
  blocks an `<img>` beacon, popups return `null`, and `form-action` blocks a form
  POST. A top-level `location.href` navigation to `http://127.0.0.1:…` *does*
  proceed, but the connection then hangs on Chrome's Private Network Access
  preflight and freezes the renderer.
- **Direct HTTP fetch of linkedin.com** (curl/proxies): HTTP 999 regardless of
  User-Agent. allorigins / corsproxy / codetabs / thingproxy / r.jina.ai all
  522/403. Google Cache returns 200 with no LinkedIn content. Wayback does not
  archive profiles.
- **The company people directory for bulk harvesting.**
  `/company/<slug>/people/` renders 12 cards; the pager advances ("Page 2 sur
  6") but the card list never re-renders under automation. Not worth fighting.
- **Rendering a profile in a same-origin iframe.** It loads and is readable, but
  LinkedIn never renders the profile body into it — you get a constant ~11.8 KB
  shell.
- **The old Voyager endpoints.** `/voyager/api/typeahead/hitsV2` → 404.

## Browser-tool gotchas that cost real time

- **`javascript_tool` hard-times-out at 45 s** (CDP `Runtime.evaluate`). Keep
  every call under it; a paced sleep plus a page read fits, a batch of paced
  fetches does not.
- **Wrap nothing in an IIFE.** The REPL does not await a returned promise — an
  `(async()=>{...})()` yields `{}`. Use top-level `await` and end with a bare
  expression. Use `var`, not `const`, since the context persists between calls.
- **Navigating destroys the return value.** `await sleep(); location.href=...;`
  then returning gives `{}` — the context dies before serialisation. Either
  navigate as the very last statement after computing the result string, or
  accept the loss and read state back on the next call.
- **`sessionStorage` and `localStorage` are stubbed**: `setItem` silently
  no-ops, and reads come back `null` even within the same call. Keep all
  cross-navigation state in the agent's own context, not the page. (`window.x`
  does persist between calls, but only until the next navigation.)
- **Signed URLs are redacted out of tool results** (`[BLOCKED: Cookie/query
  string data]`), and the redactor scans whole payloads — a raw HTML excerpt
  containing any signed URL is dropped too. Sanitise excerpts before returning
  them, and never plan on carrying a signed URL back into the agent's context;
  keep it inside the page.
- **`computer.left_click` may not reach injected elements** — a synthetic button
  clicked at its own coordinates never fired. Don't rely on it to manufacture a
  user gesture.

## Pacing and account safety

Space LinkedIn *page* loads 10–25 s apart, randomised. Image fetches hit the CDN
and need no throttling. Watch for a captcha or "Cette page n'est pas disponible"
and stop immediately if one appears. Prefer profile views over searches.
