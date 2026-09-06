#!/usr/bin/env python3
"""Render pages through the shot proxy with headless chromium (WebDriver),
save screenshots + DOM text. Usage: shot.py <name> <path> [name path ...]"""
import base64
import json
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:9515"

# Optional --dark / --light flag forces prefers-color-scheme via CDP for this
# capture (headless chromium follows the host GTK scheme otherwise; the
# --force-prefers-color-scheme switch is ignored by some builds).
prefers = None
if "--dark" in sys.argv:
    sys.argv.remove("--dark")
    prefers = "dark"
elif "--light" in sys.argv:
    sys.argv.remove("--light")
    prefers = "light"


def req(m, p, b=None):
    d = json.dumps(b).encode() if b is not None else None
    r = urllib.request.Request(BASE + p, data=d, method=m)
    r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=40) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode())


def wait_text(sid, needle, tries=40):
    for _ in range(tries):
        v = req("POST", f"/session/{sid}/execute/sync",
                {"script": f"return document.querySelector('#app')?.innerHTML.includes({json.dumps(needle)})", "args": []})
        if v.get("value"):
            return True
        time.sleep(0.25)
    return False


ses = req("POST", "/session", {"capabilities": {"alwaysMatch": {"browserName": "chrome"}}})
sid = ses["value"]["sessionId"]
if prefers:
    req("POST", f"/session/{sid}/chromium/send_command_and_get_result",
        {"cmd": "Emulation.setEmulatedMedia",
         "params": {"features": [{"name": "prefers-color-scheme", "value": prefers}]}})
try:
    paths = sys.argv[1:]
    for i in range(0, len(paths), 3):
        name, path, needle = paths[i], paths[i + 1], paths[i + 2]
        req("POST", f"/session/{sid}/url", {"url": f"http://127.0.0.1:5180{path}"})
        if not wait_text(sid, needle):
            print(f"{name}: TIMEOUT waiting for {needle!r}")
        time.sleep(0.5)
        shot = req("GET", f"/session/{sid}/screenshot")
        with open(f".impeccable/shots/{name}.png", "wb") as f:
            f.write(base64.b64decode(shot["value"]))
        text = req("POST", f"/session/{sid}/execute/sync",
                   {"script": "return Array.from(document.querySelectorAll('#app *')).map(e=>e.textContent.trim()).filter(Boolean).slice(0,120).join('\\n')", "args": []})
        with open(f".impeccable/shots/{name}.txt", "w") as f:
            f.write(text.get("value") or "")
        print(f"{name}: ok ({len(shot['value'])}px)")
finally:
    req("DELETE", f"/session/{sid}")