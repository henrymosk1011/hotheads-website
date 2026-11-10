# Hotheads Salon — 3D scroll-film concept

A concept redesign of [hotheadspasadena.com](https://www.hotheadspasadena.com/) built around a
real-time 3D "film" that plays as you scroll. The live Webflow site is untouched; this is a
standalone static site you can preview, tweak and launch whenever you're ready.

![Hero](docs/hero.jpg)

## The film

The star of the site is a lock of hair: about 2,800 individually shaded strands rendered on the
GPU. It's inspired by the purple-haired muse painted on the salon's wall. Every chapter of the page
does something to it:

| Scroll | Chapter | What happens in 3D |
| --- | --- | --- |
| 0 | **Hero** | The purple lock flows across the screen like silk in slow motion |
| 1 | **01 · The Cut** | Rose-gold shears fly in, open, and *snip*. The cut length drops away and leaves a blunt bob |
| 2 | **02 · The Color** | Dye drops fall into the hair and a balayage paints from the tips up: violet roots, magenta mids, ember/gold ends |
| 3 | **03 · The Finish** | The lock curls into volume while heat sparks rise off it |
| 4 | **04 · The Salon** | The salon's real photos orbit the hair on a curved, spinning ring |
| 5–6 | Stylists / Menu | The hair settles into the background behind the content |
| 7 | **Book** | The whole lock wraps into a glowing halo around "Your chair is waiting" |
| 8 | Visit | Address, hours, contact |

Everything is driven by one number, the film position **T** (scroll position mapped through the
page's sections). Scrolling back rewinds the film: the hair un-cuts and the dye un-paints.

## Run it locally

No build step. Any static file server works, because ES modules won't load from `file://`:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

## Deploy

It's plain static files, so it works on any static host: GitHub Pages, Netlify, Vercel or
Cloudflare Pages. Serve the repository root. All libraries and fonts are vendored in
`assets/vendor` and `assets/fonts`, so there are no third-party CDN calls at runtime.

## Editing content

All copy, prices, stylists and contact details are plain HTML in `index.html`. They were carried
over from the current site:

- **Prices:** the chapter "chips" and the `#menu` section
- **Stylists:** the `#stylists` list (photo, specialty, call/text links)
- **Address / hours / email:** the `#visit` footer and the JSON-LD block in `<head>`

Photos are in `assets/img/` (optimized WebP versions of the images on the current site). The 3D
photo ring loads the files listed in `SALON_PHOTOS` in `assets/js/world.js`.

## Tuning the film

`assets/js/world.js` holds a keyframe list (`KEYS`). Each key sets values at a film position
`t`: camera position and target, where the hair sits, and how wavy, curly, spread out or bright it
is. Values in between are interpolated with a monotone cubic, so motion is smooth and never
overshoots. The one-off moments (the snip timing, dye drops, gallery spin) are short, commented
blocks in `update()`.

Handy knobs:

- `OPACITY_SCALE` / `BLOOM_SCALE` — overall hair brightness and glow
- hair colours — `uRootA/uMidA/uTipA` (before) and `uRootB/uMidB/uTipB` (after the dye) in `assets/js/hair.js`
- strand count — `createHair({ strands })` in `world.js` (lower automatically on phones)

## How it's built

```
index.html            semantic page — every word is real, crawlable HTML
assets/css/style.css  layout, type, scroll-linked reveals
assets/js/main.js     smooth scroll (Lenis) → film position T → DOM + 3D
assets/js/world.js    renderer, post-processing, timeline, choreography
assets/js/hair.js     GPU hair: ribbons + Kajiya-Kay sheen, cut / dye / curl / halo
assets/js/scissors.js procedural rose-gold shears (no model files)
assets/js/gallery.js  curved photo panels with velocity-based RGB split
assets/js/particles.js light dust + heat sparks
```

- **Rendering:** three.js r187 with MSAA, an HDR pipeline, bloom, a film-grain/vignette pass and neutral tone mapping
- **Performance:** fewer strands and particles on phones; quality steps down automatically if
  the frame rate drops; DPR capped at 1.75
- **Accessibility:** the canvas is decorative (`aria-hidden`) and all content is HTML; there's a
  skip link and visible focus states. `prefers-reduced-motion` turns off smooth scrolling and
  inertia and slows the ambient motion. Without WebGL or JavaScript the page still reads top to
  bottom.
- **SEO:** title/description/Open Graph tags plus `HairSalon` structured data

## Credits

- [three.js](https://threejs.org) (MIT) and [Lenis](https://github.com/darkroomengineering/lenis) (MIT), vendored in `assets/vendor`
- Fonts: Instrument Serif and Inter Tight (SIL OFL), self-hosted from Fontsource
- Photography and logo: Hotheads Salon (from the current site)
