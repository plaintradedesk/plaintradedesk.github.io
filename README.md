# Plain Trade Desk

A small public-interest reference site about trade disruption affecting Canada. Four audience
views over one shared fact base, generated from data files at build time.

This file is written for you coming back to this cold in four months. Read the first two
sections and you will know why the build behaves the way it does. Read the rest when you
need to change something.

---

## Why there is a build at all

An earlier version of this site was a single hand-edited HTML file. One of those files was
truncated in the middle of a function, inside an unterminated string literal. The browser
consumed the rest of the file as string content, raised no exception, and rendered a page
that looked completely normal while every event listener, the persistence layer and the
initialisation call were silently absent. It was shipped. Nobody could tell by looking.

This repository exists to make that class of failure structurally impossible. A build either
produces a correct site or it fails loudly, and it says which record it is complaining about
and what is wrong with it. The four doors are just what the site happens to contain.

## The rule that everything else depends on

**Facts do not vary by reader. Actions do.**

A shock record describes something that happened in the world. It reads identically to every
audience, at three depths, and the door only chooses which depth is shown. An action record
describes something a reader can do, and it carries the doors and seasons it applies to. The
season control on the People door filters actions. It never touches a shock.

This is the whole reason four doors and four seasons cost roughly what one door costs. It
will be broken by accident the first time somebody wants to reword a fact for one audience.
When that happens the answer is a new action, not a second copy of the fact.

---

## Running it

```
git clone <this repo>
cd plain-trade-desk
npm install
npx playwright install chromium
npm run build
npm test
```

Chromium is needed twice: gates 8 and 12 load every built page in a real browser as part
of the build, and the test suite drives the built site. If you have a Chromium elsewhere,
point `PW_CHROMIUM` at it instead.

| Command | What it does |
|:---|:---|
| `npm run build` | Validates, renders, gates the output, writes `dist/` |
| `npm run validate` | The data gates only. Nothing is rendered and nothing is written |
| `npm test` | Builds, then runs 104 browser and build checks |
| `npm run i18n` | Refreshes the language files from the fact base and reports where each stands |
| `npm run serve` | Serves `dist/` at `http://localhost:8000` the way Pages serves it, 404 included |
| `npm run verify:live -- <url>` | Loads a **served** site and checks it discloses nothing. See Publishing |
| `node src/build.mjs --archived=YYYY-MM-DD` | Builds the site as no longer maintained. See Archiving |
| `node src/build.mjs --lang=fr` | Builds a language into `dist/fr/`, and refuses unless it is complete. See Languages |
| `node src/build.mjs --no-browser` | Builds without opening a browser. Use it only when you have none, and know that gates 8 and 12 are then off and no share card is drawn |

`dist/` is gitignored. The build is deterministic, so two builds from unchanged input produce
byte-identical files, which is what makes a diff in the output mean a real change.

### What a build writes

| File | What it is |
|:---|:---|
| `index.html` | The People door, and the front page |
| `business.html`, `place.html`, `policy.html` | One page per remaining door |
| `about.html` | About this site |
| `promises.html` | What this site promises. **This address does not change.** A municipality deciding whether to link has to cite it inside their own approval process, so moving it breaks somebody else's paperwork |
| `corrections.html` | The corrections log and the computed known-gaps list |
| `plain-trade-desk-offline.html` | Everything in one file, including the standing pages. This is the copy you hand to somebody with no reliable connection. It opens from a memory stick and behaves the same |
| `404.html` | Served for any address that does not exist. Same banner, same look, links to the four doors. Its links are absolute, because it is served at whatever was mistyped |
| `sitemap.xml`, `robots.txt` | Indexing is allowed. The 404 and the offline file are left out of the sitemap and marked `noindex`, because the offline file is a copy of every other page |
| `CNAME` | Only when `site.baseUrl` is a domain rather than a `github.io` subdomain. See Publishing |
| `share-people.png` and three more | One share card per door, 1200 by 630, drawn at build time. See Share cards |

Every page carries its own content in the markup and its stylesheet inline. They work with
JavaScript switched off, and they make no request to any host. Every page also carries a
canonical URL, a unique title and a description, all generated from the data files; the
build refuses if any of that is missing or if two pages claim the same title.

---

## Publishing

The site is published by GitHub Pages, built by Actions, from `main`.

`.github/workflows/deploy.yml` runs the whole build, runs the tests, uploads `dist/` and only
then deploys. **The deploy job depends on the build job, so a failed build never reaches the
public.** That is the architecture of this repository carried into publication: gate 2
refusing on a record nobody has checked for thirty days is a correct reason for a deploy to
stop. There is also a `workflow_dispatch` trigger, so you can publish at a moment of your
choosing rather than by pushing a commit and hoping.

`.github/workflows/build.yml` runs the same build on every other branch and every pull
request, so nothing reaches `main` without passing first.

### First time

1. Settings, Pages, Source: **GitHub Actions**. Not "deploy from a branch".
2. Push to `main`. Watch the run. The deploy job prints the address it published to.
3. Run `npm run verify:live -- <that address>` locally, or read the `verify` job, which does
   the same thing automatically after every deploy.

### The address

One line, in `site.config.json`:

```json
{ "site": { "baseUrl": "https://plaintradedesk.example" } }
```

That value is the canonical URL on every page, the addresses in `sitemap.xml`, the `Sitemap:`
line in `robots.txt`, the absolute links on the 404 page, and the `CNAME` file. Changing it
changes all of them in the same build, which is the point of it being in one place.

Leave it empty and the build falls back to `PTD_BASE_URL`, which the deploy workflow sets to
the GitHub Pages address it was given. That is how the site publishes correctly before a
domain has been bought. A local build with neither says `https://localhost` and tells you so.

When you register a domain, put it in `site.config.json` and push. The build writes
`dist/CNAME` from the same value, which is what tells Pages to answer on that name; you still
have to point the domain's DNS at Pages and tick "Enforce HTTPS" in Settings, Pages. A
`github.io` address needs no CNAME and does not get one.

On the name: the repository is `plain-trade-desk` and the site is the Plain Trade Desk. Avoid
any domain containing Canada, Government, Official, Agency, Bureau, First or Strategy. The
site must not resemble an official one, and the test in law is the impression created rather
than the intention behind it.

### Checking what is actually served

```
npm run verify:live -- https://the-published-site
```

Everything else in this repository checks what the build produced. This checks what a reader
receives, and they are not the same thing: a hosting platform can add an analytics snippet, a
cookie banner or a redirect, and none of that is visible in `dist/`. It loads every page,
and fails if there is a request to any other host, a cookie, anything written to browser
storage, a missing canonical URL, a missing unofficial banner, or a 404 that is the
platform's rather than this site's.

The deploy workflow runs it after every publish. Run it by hand any time you want to know
that the promise page is still true. To try it against the real files before publishing:

```
npm run build
npm run serve            # in one terminal
npm run verify:live -- http://localhost:8000
```

## Share cards

One image per door, 1200 by 630, drawn at build time and named in the `og:image` of that
door's page.

The People layer is meant to travel as an image forwarded through WhatsApp rather than as a
link, because that is how it actually reaches the people it is for. Two rules follow from
that, and both are checked:

- **The unofficial line is on the card**, at the top, in the same words as the banner. A card
  arriving without it is the one piece of this project that could be read as a government
  notice.
- **A card carries no fact, rate or date.** It is a still image that keeps circulating after
  the record behind it has changed, so it carries the door's question and nothing else that
  could go out of date. Every word on it comes from `doors.json` and `pages.json`.

They are SVG, drawn in `src/templates/share.mjs` and rendered to PNG by the same headless
Chromium the build already opens for gates 8 and 12. No image library, no service, no network.
Gate 10 checks the `og:image` on every page against the files the build actually wrote,
because a card that is named but never drawn fails silently inside somebody else's app.

`--no-browser` does not draw them, and says so. That build is degraded in three ways rather
than two.

## Archiving the site

The promise page commits, in writing, that if this site stops being maintained then a notice
will appear at the top of every page within thirty days, that the pages will be archived in
place rather than taken down, and that they will not be left looking current.

That is a build flag, not eight hand edits:

```
node src/build.mjs --archived=2027-03-01
```

The date is the day the fact base was last checked. That build:

- puts a plain notice above the unofficial banner on **every** page, the 404 included,
  saying the site is no longer maintained and giving that date;
- turns off the freshness readout, the next-review line and the per-record staleness flags,
  so nothing on the page can read as live;
- suppresses gate 2, so a site whose records have aged out can still be rebuilt on purpose.

That last one is the whole point. Without it the promise to leave the pages up and marked
would require somebody to hand-edit nine pages during the week they had decided to stop, and
that is a week in which hand edits do not happen.

To archive the published site, change the build step in `.github/workflows/deploy.yml` from
`npm run build` to `npm run build -- --archived=YYYY-MM-DD`, commit it, and turn off the
weekly check by deleting `.github/workflows/weekly-check.yml` or its `schedule:` block. To
un-archive, put it back. Both directions are one commit, which is the difference between a
promise that will be kept and one that will not.

## Adding a shock record

Open `data/shocks.json` and add an object to the `shocks` array. The file also holds the
sector labels at the top; add a sector there first if you need a new one.

```json
{
  "id": "CA_SOMETHING_2026-11",
  "title": "Short, plain, no jargon",
  "status": "inforce",
  "evidence_class": "instrument",
  "effective": "2026-11-03",
  "verified": "2026-11-04",
  "sectors": ["steel", "construction"],
  "doors": ["business", "place", "policy"],
  "facts": [
    { "label": "Rate", "value": "25 percent of the value for duty" },
    { "label": "In force since", "value": "3 November 2026" }
  ],
  "plain": "For the People door. Short sentences. No acronym without expanding it.",
  "operator": "For the business door. Assumes the reader files paperwork.",
  "policy": "For the policy door. Names the legal mechanism.",
  "sources": [
    { "label": "CBSA Customs Notice 26-99", "url": "https://www.cbsa-asfc.gc.ca/..." }
  ]
}
```

Things worth knowing before you save it:

- **`id` never changes**, even when the rate underneath it changes. It is what actions point
  at and what the gates name when they complain.
- **All three registers are required.** A record with an empty `policy` fails the build. If
  you have nothing to say at one depth, you have not finished reading the instrument.
- **`sources` cannot be empty.** A record with nothing behind it does not go on the site.
- **`verified` is the date you last checked it against those sources.** Not the date you
  wrote it. Everything about freshness on the site is computed from this field.
- `unverified: true` is available for a record carried over from working notes. It shows on
  the page with a visible flag and puts the record in the known-gaps list. There are none at
  the moment and it is better if it stays that way.

### Status, and the two vocabularies

`evidence_class` picks which words `status` is allowed to use.

| `evidence_class` | Meaning | Allowed `status` |
|:---|:---|:---|
| `instrument` | Anything with a legal existence | `inforce`, `announced`, `reported`, `ended` |
| `trend` | Anything without one | `observed`, `reported`, `forecast` |

Mixing them fails the build. A `trend` record also gets a different visual treatment and says
"trend, not an instrument" in words. This is not a styling preference. A forecast that renders
like an in-force instrument borrows authority it does not have, and that damages the whole
fact base rather than one record.

There are no `trend` records yet. The support is built and waiting. Do not invent content for
it to prove that it works.

## Adding an action

Open `data/actions.json`. Order in the array is the order on the page.

```json
{
  "id": "ACT_SOMETHING_SPECIFIC",
  "text": "One sentence, imperative, plain.",
  "note": "One short paragraph at most. Why this is worth doing.",
  "by": "This week",
  "urgent": false,
  "doors": ["people"],
  "shocks": ["CA_SOMETHING_2026-11"],
  "sectors": [],
  "seasons": ["working"],
  "family": false,
  "refer": null
}
```

- **`by` is a human phrase**, not a date. "This week", "Before 8 Sept", "Ongoing", "Watch".
- **`doors` cannot be empty** and every id in `shocks` has to exist. Either failure is an
  orphan and fails the build.
- **`sectors: []` means it always shows.** A step with sectors listed only appears when the
  sector filter matches one of them.
- **`seasons` only matters on the People door.** All four season ids means it shows to
  everybody. An empty array means the same thing. On the other three doors it is ignored.
- **`family: true` adds the step when the household lens is on.** It is a lens, not a fifth
  season, and it adds steps without ever replacing one. A thirty-year-old with children and a
  fifty-five-year-old with children are answering the same question.

### The referral rule

`refer` is one of `financial_advisor`, `employment_standards`, `broker`, `lawyer`, or `null`.
The labels those render as live in `data/doors.json`.

The site sits near two professional boundaries. It must never tell a named person which
customs code to declare, and it must never tell a named person when to convert savings into
income. Both are handled the same way, by naming the question and naming who answers it.

**A step carrying a referral must not also carry a recommendation.** Naming the question and
naming who answers it is the whole step. Gate 9 lints for directive language on any step
carrying `financial_advisor` and prints the line, but it only warns, because judgement is
required and a false positive should not block a build. If it fires, read the line yourself.

## Correcting something

`data/corrections.json` is append-only. Add an entry at the top, with the date, what was
wrong, and what it says now. Do not delete entries and do not tidy them up. The visible
history is the point, and a log that only appears after the first mistake is one nobody can
trust.

The known-gaps list below the log on `corrections.html` is not written by hand. It is worked
out from the records every time the site is built, so a gap cannot survive by being forgotten.
If you want something off that list, fix the record.

## Changing copy

Product copy lives in `data/pages.json`, including the masthead, the footer, the three
standing pages and the wording of the generated corrections page. Door titles and ledes live
in `data/doors.json`, season labels and hints in `data/seasons.json`.

No fact, date, rate or source URL may be written into a template. If you find yourself typing
a tariff rate into HTML, stop.

House style: plain prose, no em dashes, no exclamation marks, no marketing register, and no
words like "critical" or "urgent" unless something genuinely is. The existing copy is the
model.

## Languages

Nothing is translated and the site is English only. `data/i18n/` is room for that to change
without the fact base having to be rearranged first, because retrofitting this once the fact
base has grown is the expensive version.

One file per language, keyed by a stable path, each entry carrying the English it is a
translation of:

```json
"doors.people.question": {
  "en": "Is my job or my grocery bill caught up in this?",
  "t": ""
}
```

| Language | Carries |
|:---|:---|
| `fr` | Everything, including the policy register. Federal adoption would effectively require French |
| `pa`, `hi`, `ur` | The plain register and the interface only |

Punjabi, Hindi and Urdu matter more than French for reach in Brampton specifically. Only the
plain register is worth translating: the policy register is read by people who read policy in
English, and a half-translated legal instrument is worse than none. Source labels are never
offered for translation, because "CBSA Customs Notice 26-99" is the name of a document and a
translated name does not find it.

After changing any copy, run `npm run i18n`. It regenerates every language file from the
current source and never discards a translation: an entry whose English has changed keeps its
translation and is reported as stale, because rewriting a sentence is usually cheaper than
translating it again. Every build reports the same drift as a warning.

The build emits English and ignores every empty translation. `node src/build.mjs --lang=fr`
builds a language into `dist/fr/` and **refuses unless that language is complete**, because a
partly translated page is worse than an English one. There is no language switcher and there
should not be one until a language is actually finished. Nothing here machine translates
anything: a wrong sentence about somebody's job, in a language the person who wrote it cannot
read, is worse than an English sentence they can.

---

## The gates

Every gate fails the build except gate 9, which warns. All failures are reported in one pass,
each naming the record and saying what is wrong with it.

| Gate | Fails when |
|:---|:---|
| 1 Unsourced record | A shock has an empty `sources` array, or a source is missing its label or its URL |
| 2 Stale record | A shock's `verified` date is more than **30 days** old, or is in the future. The site itself shows a softer flag at 21 days |
| 3 Missing register | A shock is missing or empty on any of `plain`, `operator`, `policy` |
| 4 Orphaned action | An action's `doors` is empty, or it points at a shock id that does not exist |
| 5 Vocabulary mismatch | A `status` is not valid for that record's `evidence_class` |
| 6 Season distinctness | Two People-door seasons produce action sets differing by fewer than two steps, or a season produces none at all |
| 7 External reference | Anything in the built output fetches from another host. Source links in `sources[]` are `<a href>` and are the only external URLs permitted anywhere |
| 8 Truncation | A page does not parse, does not end with its closing tags, has an inline script that does not compile, or does not load in a headless browser with zero page errors, zero console errors and zero network requests |
| 9 Referral discipline | *Warns only.* A step carrying `refer: "financial_advisor"` uses directive language |
| 10 Broken internal link | An internal href, an asset path or a fragment does not resolve to a file this build actually wrote, or to an id that is actually on the page it points at |
| 11 Page metadata | A page has no canonical URL, no title or no description, two pages share a title, or a canonical is not under the configured `site.baseUrl` |
| 12 Accessibility | axe-core finds a serious or critical WCAG 2.1 A or AA violation on any built page |
| schema | A record is missing a required field, has a duplicate id, or points at a door, sector or season that does not exist |

Four of these deserve a note.

**Gate 7 is the one that matters most.** It is the regression guard for a real defect: this
site was once loading three webfont families from Google, which disclosed every reader's
address and user agent to a third party and made the commitment page false as written. The
site promises readers that reading it discloses nothing about them to anybody. Do not weaken
this gate, and do not add an exception to it.

**Gate 8 is why the headless load is in the build and not only in the tests.** The failure it
guards against renders a normal-looking page. Reading the source will not find it and looking
at the page will not either.

**Gate 10 became possible to fail the moment there was more than one page.** A dead link on
the commitment page, in front of a municipality deciding whether to link here, is a small
disaster for a site whose entire pitch is that it maintains itself honestly.

**Gate 12 is not box-ticking.** WCAG 2.1 AA was required from the start and, until this gate,
was never mechanically enforced, which meant it was a hope. These pages are meant to reach
people under stress, reading on a phone, some of them older, some of them not reading English
as a first language. Conformance is also a precondition if a provincial or federal body ever
adopts this. axe-core is a dev dependency, it runs against the built page, and it is never
part of the output.

One note on gate 7, which the canonical link had to be admitted to. A `<link rel="canonical">`
declares an address and fetches nothing, so it is not treated as a fetch. This is not a hole:
gate 11 requires every canonical to be under the configured `site.baseUrl`, so it cannot be
used to name another host. Every other `rel`, stylesheet and icon and preload among them,
still counts as a fetch and is still refused.

## When the weekly issue says something is going stale

`weekly-check.yml` runs every Monday morning, validates the fact base without building
anything, and opens an issue listing every record within seven days of the 30-day gate.

What to do:

1. Open the record in `data/shocks.json` and open its `sources` in a browser.
2. Read the current text of the instrument. Not a summary of it, and not a news article
   about it.
3. If it still says what the record says, change `verified` to today's date and commit.
4. If it has changed, change the record too, and add an entry to `data/corrections.json`
   saying what it used to say.
5. If it has been repealed or has expired, set `status` to `ended` rather than deleting it.

If the 30-day gate actually fires and the build refuses, it is doing its job. The fix is to
check the record. It is not to raise the threshold.

---

## Two things that are deliberately not finished

Both were left as they are on instruction, and both need a decision from you rather than from
a build.

1. **The contact address on the About page is a placeholder.** It is the last paragraph of
   `pages.about.body` in `data/pages.json`, marked with the class `q` so it renders in the
   muted colour. It has to be filled in before publication, because the same page says
   corrections are welcome and acted on.
2. **The AI and careers shock class is shape only.** The `trend` evidence class, its status
   vocabulary and its visual treatment are built and gated. No `trend` record exists. That is
   intentional until the tariff layer has shipped.

The Gazette and CBSA watcher is a separate job and is deliberately out of scope here.

---

## Layout

```
site.config.json   the published address of this site, and nothing else
data/            the fact base and all product copy
  shocks.json      the spine, one record per measure or event, plus sector labels
  actions.json     what a reader can do, tagged by door, sector and season
  doors.json       the four views, the two status vocabularies, referral labels
  seasons.json     the four People-door seasons and their hints
  pages.json       standing-page copy, masthead, footer, and every interface label
  corrections.json the corrections log, append-only
  i18n/            one file per language, keyed by string, every translation empty
src/
  build.mjs        entry point: validate, render, gate, publish
  config.mjs       where this site lives, resolved in one place
  images.mjs       SVG to PNG, through the browser the build already opens
  data.mjs         six files to one object, shared by the build and the language tool
  i18n.mjs         every reader-facing string, addressed and translatable
  validate.mjs     all twelve gates
  render.mjs       data plus templates to HTML strings, and the sitemap and robots.txt
  util.mjs         dates, escaping, and the build's idea of today
  templates/       small functions returning HTML strings, and the share card SVG
  assets/          one stylesheet and one script, both inlined at build time
test/
  site.test.mjs    104 checks: the prototype's 34, plus offline, publication and the gates
  live-check.mjs   the checks that only mean anything against a site that is served
tools/
  serve.mjs        serves dist/ the way Pages serves it, for checking before publishing
  i18n.mjs         regenerates the language files without discarding a translation
.github/workflows/
  build.yml        every branch and every pull request
  deploy.yml       main and manual dispatch: build, test, deploy, then verify what went out
  weekly-check.yml Monday morning staleness issue
dist/              build output, gitignored
```

Node built-ins only in the build. Playwright and axe-core are the only dependencies, both dev
dependencies, used by gates 8 and 12 and by the tests. There is no framework, no bundler, no
CSS library and no runtime dependency of any kind in the output.

## Notes on the migration from the prototype

The full list of what changed and why is in the pull request description. Four things are
worth knowing while reading the code:

- **The content was extracted from the prototype programmatically**, by evaluating its own
  literals and re-serialising them, so no prose was retyped and none of it could drift.
- **The doors are separate pages now** rather than tabs in one document. Each has a stable
  address and works with JavaScript switched off. The offline single file keeps the
  prototype's tab behaviour, because there is nowhere for it to navigate to.
- **The prototype's `localStorage` door memory is gone.** With a real address per door the
  browser's own history does that job, and dropping it means the site now sets nothing at all
  in a reader's browser, which is a stronger version of what the commitment page promises.
- **Every card and every step is in the markup**, including the ones the current season hides.
  The script only hides and unhides what the build already wrote, which is why nothing on
  these pages can be left half-built by a script that stopped early.

`PTD_TODAY=2026-12-01 npm run build` overrides the build's idea of today. It exists so the
staleness gate can be tested. Do not use it to get a build through.
