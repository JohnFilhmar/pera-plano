PeraPlano animated SVG assets
=============================
Each file here is a complete, self-contained SVG. Animation is SMIL
(<animate> / <animateTransform>), so the files need no CSS and no JavaScript
and run in <img>, as a CSS background, or inlined.

Rename before use: drop the trailing .txt
  peraplano-bg-planes.svg.txt  ->  peraplano-bg-planes.svg

  macOS / Linux:  for f in *.svg.txt; do mv "$f" "${f%.txt}"; done
  Windows:        ren *.svg.txt *.svg

Files
  peraplano-bg-planes.svg   1600x900 background, 7 planes on mixed routes
  peraplano-idle-loop.svg   loading / busy spinner, infinite
  peraplano-idle-logo.svg   logo idling in place, infinite
  peraplano-launch.svg      one-shot takeoff for a click action
  peraplano-logo-static.svg the resting logo (use as the button face)
  nav-n / ne / e / se / s / sw / w / nw .svg   8-direction pagination icons

Notes
  Replay the one-shot:  img.src = 'peraplano-launch.svg?' + Date.now()
  Inlined instead:      svg.setCurrentTime(0)
  Brand greens:         #22C55E (light face), #15803D (shadow face)
