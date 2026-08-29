REEL FACTORY — batch reel generator
=====================================

WHAT THIS IS
One raw video in, a whole batch of ready-to-post reels out — each one a
different background / caption / font combo, generated in a single click.
Everything runs on your own computer in the browser. Nothing is uploaded
anywhere.

HOW TO OPEN IT
This has to run through a tiny local web server (a browser security rule
for the video engine) — you can't just double-click index.html directly.

  Mac:      double-click "Start on Mac.command"
            (first time only: right-click it -> Open, to bypass the
            "unidentified developer" warning)

  Windows:  double-click "Start on Windows.bat"

Either one opens your browser to the app automatically. Leave that black
terminal window running in the background while you use it — closing it
shuts the app down. To use it again later, just double-click the starter
file again.

If it says Python isn't installed: install it from python.org (the free
"Python 3" installer, default options are fine), then double-click the
starter file again.

HOW TO USE IT
  1. Drop in your raw video (any size/orientation).
  2. Pick the output format — Reel/Story, Portrait post, or Square post.
  3. Add every background you want in the mix — solid colors and/or your
     own images. Each one becomes its own version of the video.
  4. Add every caption you want tested — pick a font, color, position on
     screen, and style for each.
  5. Hit "Generate all videos." It'll make one video for every
     background × caption combination, then let you download them all
     as a single .zip.

TIPS
  - More backgrounds/captions = more videos, but also more time to render.
    20 short reels usually takes a few minutes on a normal laptop.
  - The first click of "Generate" takes a bit longer — it's loading the
    video engine (about 30MB) into the browser once. After that it's fast.
  - Keep the browser tab open and awake while it's rendering.
