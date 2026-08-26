#!/usr/bin/env python
"""Load the game headless, drive it, and fail on anything the console complains about.

The game has no tests and mostly cannot have the useful kind: what is being built
is whether a dusk island reads at a glance, and no assertion covers that. What an
assertion *can* cover is the half that silently rots - a module that stopped
parsing, a component whose start() throws, a wire in main.js connected to
something that no longer exists - and none of that is visible until the page is
actually loaded. So this loads it.

Everything on `window.hex` (game/debug.js) is reachable from --eval, which is why
the debug console is worth keeping honest: a play sequence that would take a
minute of clicking is one line here.

    python tools/check.py
    python tools/check.py --shot look.png --at 0,4 --dist 6 --reveal
    python tools/check.py --eval "hex.card(); hex.teleport(-1,4)" --shot hand.png
    python tools/check.py --click=-3,5 --shot placed.png
    python tools/check.py --print --eval "return hex.control.units.length"

Negative coordinates need the `=` form - `--at=-3,4`, not `--at -3,4` - or argparse
reads the leading minus as another flag. `--eval` is a function body, so anything
you want back has to be `return`ed.

Needs `playwright` and its Chromium (`pip install playwright && playwright
install chromium`). Nothing else in the project depends on it: this is a tool,
not a dependency.
"""
import argparse
import http.server
import socket
import socketserver
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Warnings three.js emits that say nothing about this project. Anything not on
# this list is treated as a failure, because a console that is allowed to be
# noisy is a console nobody reads.
IGNORE = (
    'Multiple instances of Three.js',
    'THREE.WebGLRenderer: A WebGL context could not be created',
)


def serve(directory):
    """A static server on a free port, in a daemon thread."""
    handler = type('Handler', (http.server.SimpleHTTPRequestHandler,), {
        '__init__': lambda self, *a, **k: http.server.SimpleHTTPRequestHandler.__init__(
            self, *a, directory=str(directory), **k),
        'log_message': lambda *a: None,
    })
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    httpd = socketserver.TCPServer(('127.0.0.1', port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, port


def hex_to_screen(page, q, r):
    """Where a hex is on screen, so a click can be a real click.

    Driving the picker through synthetic mouse events rather than calling the
    handlers is the whole point of doing this in a browser: the routing between
    the camp, the force and the picker lives in main.js, and calling the
    components directly is the one arrangement that would never catch a wire
    connected to the wrong thing.
    """
    return page.evaluate("""([q, r]) => {
      const h = window.hex, cam = h.game.camera;
      const w = h.grid.hexToWorld(q, r);
      const V = Object.getPrototypeOf(cam.position).constructor;
      const v = new V(w.x, h.ground ? h.ground.topY(q, r) : 0, w.z);
      v.project(cam);
      const el = h.game.renderer.domElement, b = el.getBoundingClientRect();
      return { x: b.left + (v.x * 0.5 + 0.5) * b.width, y: b.top + (-v.y * 0.5 + 0.5) * b.height };
    }""", [q, r])


def hexarg(text):
    q, r = text.split(',')
    return int(q), int(r)


class Step(argparse.Action):
    """Collects --eval / --click / --order into one list in the order written.

    argparse groups by flag, which would run every --eval before the first
    --click however the command line reads. That is exactly wrong for a tool
    whose whole job is playing a sequence: arming a card and then clicking a hex
    is one order, and the reverse is nothing happening twice.
    """
    def __call__(self, parser, ns, value, option):
        ns.steps = getattr(ns, 'steps', None) or []
        ns.steps.append((self.dest, value))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--shot', help='write a screenshot here')
    ap.add_argument('--eval', dest='eval', action=Step,
                    help='JS body to run once loaded; repeatable')
    ap.add_argument('--click', type=hexarg, action=Step,
                    metavar='Q,R', help='left-click this hex (a real mouse event)')
    ap.add_argument('--order', type=hexarg, action=Step,
                    metavar='Q,R', help='right-click this hex - the order button')
    # --settle is one number for every step; this is a wait you can put *between*
    # two of them, which is what watching something play out actually needs.
    ap.add_argument('--pause', type=float, action=Step,
                    metavar='SECONDS', help='wait here, in sequence with the other steps')
    ap.add_argument('--at', type=hexarg, metavar='Q,R', help='point the camera at a hex')
    ap.add_argument('--dist', type=float, help='camera distance (default is the game\'s 21)')
    ap.add_argument('--reveal', action='store_true', help='lift the fog off the whole board')
    ap.add_argument('--wait', type=float, default=3.5, help='seconds to settle after load')
    ap.add_argument('--settle', type=float, default=1.5, help='seconds after each action')
    ap.add_argument('--print', dest='show', action='store_true',
                    help='print what the last --eval returned')
    ap.add_argument('--width', type=int, default=1280)
    ap.add_argument('--height', type=int, default=800)
    ap.add_argument('--head', action='store_true', help='show the browser')
    args = ap.parse_args()
    steps = getattr(args, 'steps', None) or []

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit('needs playwright: pip install playwright && playwright install chromium')

    httpd, port = serve(ROOT)
    problems, last = [], None

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.head, args=[
            # Software GL, so this runs the same on a machine with no GPU and in
            # whatever CI eventually exists.
            '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        ])
        page = browser.new_page(viewport={'width': args.width, 'height': args.height})
        page.on('pageerror', lambda e: problems.append(f'uncaught: {e}'))
        page.on('console', lambda m: (
            m.type in ('error', 'warning')
            and not any(skip in m.text for skip in IGNORE)
            and problems.append(f'{m.type}: {m.text}')))

        page.goto(f'http://127.0.0.1:{port}/index.html')
        page.wait_for_timeout(args.wait * 1000)

        # The debug API is the contract this whole script rests on. If it is not
        # there the page did not finish building, whatever the console said.
        if not page.evaluate('() => !!window.hex'):
            problems.append('window.hex missing - main.js did not finish')

        if not problems:
            if args.reveal:
                page.evaluate('() => window.hex.revealAll()')
            if args.at:
                page.evaluate('([q, r]) => window.hex.lookAt(q, r)', list(args.at))
            if args.dist:
                page.evaluate("""(d) => {
                  const cam = window.hex.game.gameObjects.find(g => g.name === 'Camera');
                  cam.components[0]._distGo = d;
                }""", args.dist)
            if args.reveal or args.at or args.dist:
                page.wait_for_timeout(args.settle * 1000)

            # In the order they were written, because that is the sequence
            # being tested.
            for kind, value in steps:
                if kind == 'eval':
                    last = page.evaluate(f'() => {{ {value} }}')
                elif kind == 'pause':
                    page.wait_for_timeout(value * 1000)
                else:
                    xy = hex_to_screen(page, *value)
                    page.mouse.move(xy['x'], xy['y'])
                    page.wait_for_timeout(200)
                    page.mouse.click(xy['x'], xy['y'],
                                     button='right' if kind == 'order' else 'left')
                page.wait_for_timeout(args.settle * 1000)

            if args.shot:
                page.screenshot(path=args.shot)

        browser.close()

    httpd.shutdown()

    if args.show:
        print(last)
    if problems:
        print(f'{len(problems)} problem(s):', file=sys.stderr)
        for p in problems:
            print(f'  {p}', file=sys.stderr)
        sys.exit(1)
    print('clean' + (f' - {args.shot}' if args.shot else ''))


if __name__ == '__main__':
    main()
