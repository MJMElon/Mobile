# MJM Nursery AI — Mobile Ops Portal

`mobile.mjmnursery.com` — staff portal for issuing Collection DOs, recording
customer consent, and booking collection time slots.

Rebuilt from standalone static HTML pages into a **React + Vite + Tailwind**
app. Data + auth stay on **Supabase**; the build is published to **GitHub
Pages**. The same codebase also backs `scan.mjmnursery.com`.

## Why the rewrite

The old pages were single HTML files loading Tailwind/Supabase/jsPDF from CDNs,
with all logic inline. The biggest problem: the **Gemini API key was embedded
in client JavaScript** (`do_signing.html`, `consent.html`) — anyone could
"View Source" and steal it. The rewrite moves that key into a **Supabase Edge
Function** so it never reaches the browser.

| Concern | Before | After |
| --- | --- | --- |
| Framework | Inline HTML/JS per page | React components (Vite MPA) |
| Styling | Tailwind CDN | Tailwind compiled at build time |
| Gemini API key | Hardcoded in client JS 🔴 | Supabase Edge Function secret 🟢 |
| Supabase anon key | In client (OK — public by design, RLS-protected) | Same, via `VITE_` env with default |
| Hosting | GitHub Pages (raw files) | GitHub Pages (built `dist/` via Actions) |

## Project layout

```
index.html, auth.html, booking.html,        Vite entry HTML (one per page —
consent.html, do_signing.html               keeps existing public URLs)
src/
  entries/      one mount file per page
  pages/        Index, Auth, Booking, Consent, DoSigning
  components/    AuthGate, TopNav, SignaturePad, Toast
  lib/          supabase, auth (ops gate), gemini (Edge Function client), pdf
  styles/index.css   Tailwind + shared classes
supabase/functions/gemini-scan/   Edge Function holding the Gemini key
legacy/          original HTML kept for reference
.github/workflows/deploy.yml      build + deploy to GitHub Pages
public/CNAME      mobile.mjmnursery.com
```

The app is a **multi-page app**: each `*.html` is its own entry, so existing
links/bookmarks (`/booking.html`, `/consent.html`, …) keep working.

## Local development

```bash
npm install
npm run dev       # http://localhost:5173  (open /do_signing.html etc.)
npm run build     # outputs dist/
npm run preview   # serve the built dist/ locally
```

Optional `.env` (see `.env.example`) — the Supabase anon config has working
defaults baked in, so this is only needed to target a different project:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Deploying the Gemini Edge Function (required for AI scan/count)

The AI document scan (DO module) and sticker count (Consent) call a Supabase
Edge Function named `gemini-scan`. Deploy it once and set the secret:

```bash
# from this repo root, with the Supabase CLI logged in + linked to the project
supabase secrets set GEMINI_KEY=AIza...your-real-gemini-key...
supabase functions deploy gemini-scan
```

JWT verification is ON, so only signed-in staff can invoke it. The key lives
only as a Supabase secret and is never shipped to the browser.

> Rotate the old Gemini key: because it previously shipped in the static
> pages, treat it as compromised — generate a new key in Google AI Studio,
> set it via `supabase secrets set`, and revoke the old one.

## Deploying the site (GitHub Pages)

1. Repo **Settings → Pages → Source = "GitHub Actions"** (one time).
2. Push to `main`. `.github/workflows/deploy.yml` builds and publishes `dist/`.
3. The `CNAME` (`mobile.mjmnursery.com`) is shipped from `public/CNAME`.

To override the Supabase config at build time, set repo **Variables**
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (Settings → Secrets and
variables → Actions → Variables).

## scan.mjmnursery.com

Once verified on mobile, deploy the same build to `scan.mjmnursery.com`
(change `public/CNAME` accordingly, or add a second Pages site/repo pointing
at the same source).
