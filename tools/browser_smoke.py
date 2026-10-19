"""Headless Chrome integration checks; requires Python websockets (test-only).

Run: python tools/browser_smoke.py
Uses the installed Chrome/Edge, a temporary profile and a local HTTP server.
"""
import base64
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
from urllib.request import urlopen

from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parents[1]
BROWSER = next((p for p in [shutil.which("chromium"), shutil.which("google-chrome"),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"] if p and Path(p).exists()), None)
if not BROWSER:
    raise SystemExit("Install Chrome/Edge to run this optional integration check.")

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
errors = []
sequence = 0

with tempfile.TemporaryDirectory(prefix="coin-runner-chrome-") as profile:
    proc = subprocess.Popen([BROWSER, "--headless=new", "--remote-allow-origins=*", "--disable-gpu", "--in-process-gpu", "--no-first-run",
        "--no-default-browser-check", "--remote-debugging-port=0", f"--user-data-dir={profile}",
        "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    try:
        port_file = Path(profile) / "DevToolsActivePort"
        for _ in range(150):
            if port_file.exists():
                break
            time.sleep(.1)
        time.sleep(1)
        port = port_file.read_text().splitlines()[0]
        targets = json.load(urlopen(f"http://127.0.0.1:{port}/json"))
        with connect(next(t["webSocketDebuggerUrl"] for t in targets if t["type"] == "page"), max_size=10_000_000, proxy=None) as ws:
            def call(method, params=None):
                global sequence
                sequence += 1
                current = sequence
                ws.send(json.dumps(dict(id=current, method=method, params=params or {})))
                while True:
                    response = json.loads(ws.recv(timeout=30))
                    if response.get("method") == "Runtime.exceptionThrown":
                        errors.append(response["params"])
                    if response.get("id") == current:
                        if "error" in response:
                            raise AssertionError(response)
                        return response.get("result", {})

            def js(expression):
                result = call("Runtime.evaluate", dict(expression=expression, awaitPromise=True, returnByValue=True))
                if "exceptionDetails" in result:
                    raise AssertionError(result["exceptionDetails"])
                return result.get("result", {}).get("value")

            def check(expression):
                assert js(expression), expression

            call("Runtime.enable")
            call("Page.enable")
            call("Page.navigate", {"url": f"http://127.0.0.1:{server.server_port}/docs/"})
            for _ in range(100):
                if js("document.querySelector('#primaryButton') && document.readyState==='complete'"):
                    break
                time.sleep(.05)
            check("document.querySelector('#overlayTitle').textContent==='Ready to run?'")
            js("(async()=>{window.session=await import('./js/game.js');document.querySelector('#soundButton').click();document.querySelector('#primaryButton').click();window.initialX=session.world.player.x})()")
            call("Input.dispatchKeyEvent", {"type": "keyDown", "code": "KeyD", "key": "d"})
            time.sleep(.12)
            call("Input.dispatchKeyEvent", {"type": "keyUp", "code": "KeyD", "key": "d"})
            check("session.world.player.x>window.initialX")
            js("document.querySelector('#pauseButton').click();window.pausedX=session.world.player.x")
            time.sleep(.08)
            check("session.world.player.x===window.pausedX")
            check("document.querySelector('#overlayTitle').textContent==='Paused'")
            js("document.querySelector('#restartButton').click()")
            check("document.querySelector('#overlay').classList.contains('hidden')")
            js("document.querySelector('#levelsButton').click()")
            check("document.querySelectorAll('#levelGrid button').length===10 && document.querySelectorAll('#levelGrid button:disabled').length===9")
            js("document.querySelector('#levelDialog').close();document.querySelector('#primaryButton').click()")
            for width, height in [(1280,800),(667,375),(844,390),(915,412),(390,844)]:
                call("Emulation.setDeviceMetricsOverride", dict(width=width,height=height,deviceScaleFactor=1,mobile=width<1100))
                call("Emulation.setTouchEmulationEnabled", dict(enabled=width<1100,maxTouchPoints=5))
                time.sleep(.1)
                check("document.documentElement.scrollWidth <= innerWidth")
                check("Math.abs(document.querySelector('canvas').getBoundingClientRect().width/document.querySelector('canvas').getBoundingClientRect().height-12/7)<.02")
                if width<1100:
                    js("document.querySelector('#restartButton').click()")
                    time.sleep(.05)
                    check("[...document.querySelectorAll('[data-control],#pauseButton,#mobileMenuButton')].every(b=>{const r=b.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.top>=0&&r.bottom<=innerHeight})")
                    points=js("['right','jump'].map(name=>{const r=document.querySelector(`[data-control=${name}]`).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})")
                    call("Input.dispatchTouchEvent", dict(type="touchStart",touchPoints=[dict(id=i+1,**point) for i,point in enumerate(points)]))
                    time.sleep(.08)
                    check("document.querySelectorAll('.touch-button.active').length===2")
                    check("session.world.player.vx>0 && session.world.player.vy<0")
                    call("Input.dispatchTouchEvent", dict(type="touchCancel",touchPoints=[]))
                    check("document.querySelectorAll('.touch-button.active').length===0")
                    call("Input.dispatchTouchEvent", dict(type="touchStart",touchPoints=[dict(id=1,**points[0])]))
                    call("Input.dispatchTouchEvent", dict(type="touchMove",touchPoints=[dict(id=1,x=2,y=2)]))
                    call("Input.dispatchTouchEvent", dict(type="touchEnd",touchPoints=[]))
                    check("document.querySelectorAll('.touch-button.active').length===0")
                    js("window.dispatchEvent(new Event('blur'))")
                    check("session.state==='paused'")
                    js("document.querySelector('#primaryButton').click()")
                if width==390:
                    screenshot=call("Page.captureScreenshot",dict(format="png"))
                    (ROOT/'screenshots/browser-mobile.png').write_bytes(base64.b64decode(screenshot['data']))
            # Verify winning routes inside Chrome's actual JS engine too.
            result=js("""(async()=>{
              const {World}=await import('./js/world.js');const {LEVELS}=await import('./js/levels.js');
              const runs=await (await fetch('../tests/browser-replays.json')).json();
              return LEVELS.map(l=>{const w=new World(l);for(const [n,m,p,h]of runs[l.name])for(let i=0;i<n;i++)w.update(1/60,m,p&&i===0,h);return [l.name,w.status];});
            })()""")
            assert all(status == 'complete' for _,status in result), result
            # UI flow is checked independently of physics routes: force flags, then use actual menus.
            js("document.querySelector('#restartButton').click()")
            for index in range(10):
                check(f"session.levelIndex==={index} && session.state==='playing'")
                js("session.world.complete()")
                time.sleep(.04)
                check("session.state==='level_complete'")
                js("document.querySelector('#primaryButton').click()")
            check("session.state==='won' && document.querySelector('#overlayTitle').textContent==='You win!'")
            check("JSON.parse(localStorage.getItem('coinRunnerProgress')).unlocked===10")
            js("document.querySelector('#levelsButton').click()")
            check("document.querySelectorAll('#levelGrid button:disabled').length===0")
            assert not errors, errors
            print("PASS: Chrome, 5 viewports, two-finger controls/cancel, keyboard, pause/restart, locks, final victory/progression, 10 winning routes; no JS exceptions.")
    finally:
        proc.terminate()
        proc.wait(timeout=15)
        server.shutdown()
