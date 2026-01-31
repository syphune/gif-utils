# gif-utils

A lightweight, in‑browser GIF editor focused on fast trimming, cropping, previewing, and export — no uploads, everything stays local.

## Features

- **Trim timeline** with draggable handles
- **Drag playhead** to scrub frames
- **Zoom timeline** (Ctrl/Cmd/Alt + wheel)
- **Preview zoom & pan** like an editor
- **Crop tool** with live overlay and apply on Enter
- **Undo / Redo** for trim & crop
- **Export** trimmed/cropped GIF

## Quick Start

```bash
npm install
npm run dev
```

Open the URL shown in terminal (usually `http://localhost:5173`).

## Controls

**Preview**
- **Scroll / trackpad**: zoom in/out at cursor
- **Shift + scroll**: pan
- **Left‑drag**: pan (when not cropping)
- **Middle‑drag**: pan

**Timeline**
- Drag **handles** to set trim range
- Drag **yellow range** to move entire trim window
- Drag **playhead** to scrub
- Ctrl/Cmd/Alt + **wheel**: zoom timeline

**Crop**
- Select **Crop** tool
- Drag crop box
- Press **Enter** to apply (preview updates)

**Shortcuts**
- `Ctrl/Cmd + Z`: Undo
- `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y`: Redo
- `[` / `]`: Set trim start / end
- `←` / `→`: Step frame

## Release

Release automation uses **release-please** on `main`. Push commits and it will open a release PR and tag on merge.

## Tech

- React + Vite + TypeScript
- gifuct-js for decoding
- gif.js for encoding
n
## License

MIT
