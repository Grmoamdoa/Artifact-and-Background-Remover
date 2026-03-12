# Artifact Remover

A free local web app with two image-cleanup tools for flat or gently shaded backgrounds.

## What it does

- Uploads PNG, JPEG, or WebP images
- Keeps one shared canvas so edits survive when you switch tools
- Offers two modes:
  - `Artifact Remover`
    - draw a rectangle over an object
    - replace it with a sampled solid fill or soft gradient fill
  - `Background Remover`
    - auto-detect flat backgrounds from corners and edges
    - add manual background sample points if needed
    - remove the background to true PNG transparency
    - restore accidentally removed details with a brush that paints from the original upload
- Exports the current result as a PNG at the original image resolution

## Why this works

For flat-background cleanup, you do not need a paid API. The artifact remover samples nearby pixels to reconstruct a simple backdrop, and the background remover uses local color matching plus connected-edge detection to cut away likely background pixels.

This is still not full AI segmentation or advanced inpainting, so it is strongest on:

- white walls
- studio backdrops
- product photos
- screenshots with flat areas
- skies or smooth gradients

It will be less accurate on:

- busy textures
- overlapping hair or fur on noisy backgrounds
- scenes with multiple similar colors touching the image edge
- detailed scenery that needs content reconstructed behind an object

## Run it

Because this is a plain browser app, you can run it with any simple local server.

### Option 1: Python

```bash
cd "/Users/gregggeorge/Downloads/Artifact Remover"
python3 -m http.server 4173
```

Then open [http://localhost:4173](http://localhost:4173).

### Option 2: Open the file directly

You can also try opening `index.html` directly in a browser, though a local server is usually more reliable.
