---
name: workday-employee-photos
description: Pull employee profile photos out of Workday ("Find Workers" search) using the user's logged-in Chrome, matched to the right person with no homonym risk. Use when filling in missing org-chart/registry photos, or whenever an internal HR source beats scraping LinkedIn. Includes the manager-photo trap that silently attaches the wrong face.
---

# Workday employee photos

Established 2026-08-30 while finishing an org-chart photo import. Workday beats
LinkedIn for this job on the thing that actually matters: **identity**. A search
returns "1 Result" for the real employee, with a job title that matches the HR
record, so there is no homonym problem at all. LinkedIn, by contrast, offered a
supermarket cashier and a freelance photographer for two of our people.

Trade-off: Workday photos are often **smaller** than LinkedIn's (many 400×400,
some 160×160 or even 99×99). Where someone already has a good LinkedIn photo,
LinkedIn stays the better source. Use Workday to fill gaps and to resolve
anyone LinkedIn can't identify.

## THE TRAP — read this first

A worker page shows **two** `/attachment/` images:

| element | what it is |
|---|---|
| `alt="<Worker Name> employee photo"`, rendered ~160px | the employee's own photo |
| `alt=""`, rendered **26×26** | their **manager's** thumbnail |

If the employee has **no** photo, only the manager's 26×26 remains. Any
detector that grabs "an `/attachment/` background image that is square and
big enough" will therefore attach **the manager's face to the employee** — the
underlying manager image is a full 160×160, so a size check does not save you.
This shipped and had to be caught by the user.

Worse, a loop over *all* matching elements downloads twice under one filename,
and Chrome saves the second as `Name (1).jpg`. Since `(1)` sorts *before* the
plain name, a naive collector prefers the wrong file.

**The rule: take only the image whose `alt` contains the worker's name.** No
alt match ⇒ the worker has no photo. Never fall back to "the biggest square
image on the page", and treat any `Name (1).jpg` as a red flag, never as data.

## Working recipe

Start from the *Find Workers* task page (ask the user for their tenant URL —
e.g. `https://wd3.myworkday.com/<tenant>/d/task/1422$207.htmld`). One agent
call per person; Workday is a SPA, so search → open → fetch → save all happen
without a page load, and the call ends by navigating back to the task page.

```js
var NAME = "First Last";
var N = s => (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'')
              .toLowerCase().replace(/[^a-z0-9]/g,'');

// 1. wait for the search box (it is NOT there immediately after a page load)
var inp=null,k=0;
while (k++ < 10 && !inp) { await new Promise(r=>setTimeout(r,1500));
  inp = document.querySelector('input[aria-label="Find Workers for ALL"]'); }

// 2. drive the React input through its native setter, then Enter
var set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
set.call(inp, NAME); inp.dispatchEvent(new Event('input',{bubbles:true}));
['keydown','keypress','keyup'].forEach(t =>
  inp.dispatchEvent(new KeyboardEvent(t,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true})));
await new Promise(r=>setTimeout(r,5000));

// 3. the result name is a div[role=link] — match normalised (Workday
//    upper-cases surnames inconsistently: "Anaëlle BARY", "Camille JOUANNIC")
var link = [...document.querySelectorAll('[role=link]')]
             .find(e => N(e.innerText) === N(NAME));
link.click();

// 4. ONLY the alt-named photo. Poll: the profile renders slowly.
var el=null,i=0;
while (i++ < 7 && !el) { await new Promise(r=>setTimeout(r,1500));
  el = [...document.querySelectorAll('img')].find(e =>
        /\/attachment\//.test(getComputedStyle(e).backgroundImage||'') &&
        N(e.alt||'').includes(N(NAME))); }

// 5. same-origin, so the bytes are readable directly — no navigation needed
var m = (getComputedStyle(el).backgroundImage||'').match(/url\(["']?([^"')]+)["']?\)/);
var b = await fetch(new URL(m[1], location.origin).href).then(r=>r.blob());
var a = document.createElement('a');
a.href = URL.createObjectURL(b); a.download = NAME + '.jpg';
document.body.appendChild(a); a.click(); a.remove();
```

Return the `alt` text in the result — it is your proof the photo belongs to the
person you asked for, and it costs nothing.

## Details that bite

- **The photo is a CSS `background-image` on a 1×1 transparent GIF** (`gwt-Image`),
  not an `<img src>`. Reading `.src` finds nothing; read `getComputedStyle`.
- **`alt` is not always populated** — but when it is missing, so is the
  employee's photo. That correlation is exactly why the alt test is safe.
- **Chrome's automatic-download limit is per-site.** Allowing `[*.]licdn.com`
  does nothing for Workday. Have the user add `[*.]myworkday.com` at
  `chrome://settings/content/automaticDownloads`, or only the first file saves
  and the rest vanish silently. Verify on disk after the first two.
- **Name mismatches:** a compound surname in HR may be shortened in Workday
  ("Virginie Lefebvre Bertoletti" → 0 results; "Virginie Lefebvre" → 1 result).
  On `0 item(s)`, retry with first name + first surname token.
- **Repeated file sizes are not duplicates.** Workday re-encodes at a fixed
  quality, so many 400×400 photos land on byte-identical sizes (640791 four
  times in one run). Always compare **md5**, never size — a hash sweep over the
  output folder is the cheap way to prove no two employees share a face.
- Workday's search box needs `input[aria-label="Find Workers for ALL"]`; the
  global nav search is a different, useless input.

## Related

Photo-fetching from LinkedIn, and the walls around it, are in
[[linkedin-profile-access]]. Prefer LinkedIn when the person already has a
high-resolution photo there; prefer Workday whenever identity is uncertain.
