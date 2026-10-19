"""Mobile layout regression checks and before/after captures (test-only websockets).

Run: python tools/layout_smoke.py --capture before (then --capture after)
Uses the installed Chrome/Edge, a temporary profile and a local HTTP server.
"""
import argparse
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

parser=argparse.ArgumentParser()
parser.add_argument('--capture', choices=['before','after'], default='after')
args=parser.parse_args()
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
                if js("document.readyState==='complete' && !!document.querySelector('#primaryButton')"):
                    break
                time.sleep(.05)
            js("(async()=>{window.session=await import('./js/game.js');document.querySelector('#soundButton').click();document.querySelector('#primaryButton').click()})()")
            results={}
            for width,height,mobile in [(1280,800,False),(667,375,True),(844,390,True),(915,412,True),(390,844,True)]:
                call("Emulation.setDeviceMetricsOverride",dict(width=width,height=height,deviceScaleFactor=1,mobile=mobile))
                call("Emulation.setTouchEmulationEnabled",dict(enabled=mobile,maxTouchPoints=5))
                time.sleep(.15)
                js("document.querySelector('#restartButton').click()")
                time.sleep(.03)
                js("document.querySelector('#pauseButton').click();document.querySelector('#overlay').classList.add('hidden')")
                geometry=js("""(()=>{
                  const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
                  const selectors=['.game-shell','.game-header','.stage','canvas','footer','#pauseButton','#restartButton','[data-control=left]','[data-control=right]','[data-control=jump]'];
                  return Object.fromEntries(selectors.map(s=>{const e=document.querySelector(s),c=getComputedStyle(e);return [s,{...rect(e),display:c.display,fontSize:c.fontSize,padding:c.padding,borderRadius:c.borderRadius}];}));
                })()""")
                results[f'{width}x{height}']=geometry
                shot=call('Page.captureScreenshot',dict(format='png'))
                path=ROOT / f'screenshots/layout-{args.capture}-{width}x{height}.png'
                path.write_bytes(base64.b64decode(shot['data']))
                print(f"{width}x{height}: canvas {geometry['canvas']['width']:.1f} x {geometry['canvas']['height']:.1f}")
                if args.capture=='after':
                    canvas=geometry['canvas']
                    assert abs(canvas['width']/canvas['height']-12/7)<.01
                    check("document.querySelector('canvas').width===960 && document.querySelector('canvas').height===560")
                    if mobile:
                        check("[...document.querySelectorAll('[data-control],#pauseButton,#mobileMenuButton')].every(b=>{const r=b.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})")
                        if width>height:
                            for selector in ['[data-control=left]','[data-control=right]','[data-control=jump]','#pauseButton']:
                                r=geometry[selector]
                                assert r['x']+r['width']<=canvas['x'] or r['x']>=canvas['x']+canvas['width'] or r['y']>=canvas['y']+canvas['height'] or r['y']+r['height']<=canvas['y'], selector
                        js("document.querySelector('#mobileMenuButton').click()")
                        check("document.querySelector('#mobileMenuButton').getAttribute('aria-expanded')==='true'")
                        check("['levelsButton','restartButton','soundButton','helpButton','fullscreenButton'].every(id=>document.getElementById(id).getBoundingClientRect().height>=44)")
                        if width==844:
                            shot=call('Page.captureScreenshot',dict(format='png'))
                            (ROOT/'screenshots/layout-menu-844x390.png').write_bytes(base64.b64decode(shot['data']))
                        js("document.querySelector('#levelsButton').click()")
                        check("document.querySelector('#levelDialog').open")
                        js("document.querySelector('#levelDialog').close();document.querySelector('#mobileMenuButton').click();document.querySelector('#helpButton').click()")
                        check("document.querySelector('#helpDialog').open")
                        js("document.querySelector('#helpDialog').close();document.querySelector('#mobileMenuButton').click();document.querySelector('#restartButton').click()")
                        check("session.state==='playing' && session.world.player.x<100")
                        js("document.querySelector('#pauseButton').click();document.querySelector('#overlay').classList.add('hidden')")
                js("document.querySelector('#pauseButton').click()")
            if args.capture=='after':
                baseline=json.loads((ROOT/'screenshots/layout-before.json').read_text())
                assert results['1280x800']==baseline['1280x800'], 'Desktop geometry or styling changed'
                for key in ['667x375','844x390','915x412']:
                    assert results[key]['canvas']['width']>baseline[key]['canvas']['width']*1.15,key
                # Native fullscreen runs with a gesture; denied/unsupported paths are checked separately.
                js("document.querySelector('#mobileMenuButton').click()")
                if js('document.fullscreenEnabled'):
                    call('Runtime.evaluate',dict(expression="document.querySelector('#fullscreenButton').click()",userGesture=True))
                    time.sleep(.15)
                    check('!!document.fullscreenElement')
                    js('document.exitFullscreen()')
                    time.sleep(.1)
                js("Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:false});document.dispatchEvent(new Event('fullscreenchange'))")
                check("document.querySelector('#fullscreenButton').disabled && document.querySelector('#fullscreenStatus').textContent.includes('unavailable')")
                js("delete document.fullscreenEnabled;document.dispatchEvent(new Event('fullscreenchange'));window.requestOriginal=document.documentElement.requestFullscreen;document.documentElement.requestFullscreen=()=>Promise.reject(new Error('Restricted'))")
                js("document.querySelector('#fullscreenButton').click()")
                time.sleep(.03)
                check("document.querySelector('#fullscreenStatus').textContent.includes('could not open')")
                js('document.documentElement.requestFullscreen=window.requestOriginal')
                # Simulate a notched phone in Chromium without claiming physical-device coverage.
                protocol=json.load(urlopen(f"http://127.0.0.1:{port}/json/protocol"))
                emulation=next(d for d in protocol['domains'] if d['domain']=='Emulation')
                if any(c['name']=='setSafeAreaInsetsOverride' for c in emulation.get('commands',[])):
                    call('Emulation.setDeviceMetricsOverride',dict(width=667,height=375,deviceScaleFactor=1,mobile=True))
                    call('Emulation.setSafeAreaInsetsOverride',dict(insets=dict(top=0,left=44,right=44,bottom=21)))
                    time.sleep(.1)
                    js("document.body.classList.remove('mobile-menu-open')")
                    check("(()=>{const c=document.querySelector('canvas').getBoundingClientRect();return [...document.querySelectorAll('[data-control],#pauseButton,#mobileMenuButton')].every(b=>{const r=b.getBoundingClientRect();return r.left>=44&&r.right<=innerWidth-44&&r.bottom<=innerHeight-21&&(r.right<=c.left||r.left>=c.right||r.top>=c.bottom||r.bottom<=c.top)});})()")
                    call('Emulation.setSafeAreaInsetsOverride',dict(insets=dict(top=0,left=0,right=0,bottom=0)))
                    print('PASS: simulated 44px side safe areas and 21px bottom inset.')
                print('PASS: aspect ratio/backing resolution, no control overlap, menus, fullscreen + fallbacks, desktop unchanged, canvas enlargement.')
            (ROOT/f'screenshots/layout-{args.capture}.json').write_text(json.dumps(results,indent=2))
            assert not errors, errors
    finally:
        proc.terminate()
        proc.wait(timeout=15)
        server.shutdown()
