#!/usr/bin/env python3
"""Tiny WebDriver driver: load page through the shot proxy, dump console logs."""
import json
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:9515"


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode())


def wait_ready():
    # poll instead of fixed sleep: chromedriver may still be booting
    deadline = time.time() + 20
    while time.time() < deadline:
        try:
            req("GET", "/status")
            return
        except Exception:
            time.sleep(0.2)


ses = req(
    "POST",
    "/session",
    {
        "capabilities": {
            "alwaysMatch": {
                "browserName": "chrome",
                "goog:loggingPrefs": {"browser": "ALL", "performance": "ALL"},
            }
        }
    },
)
sid = ses["value"]["sessionId"]
try:
    req("POST", f"/session/{sid}/url", {"url": "http://127.0.0.1:5180/"})
    wait_ready()
    time.sleep(3)
    logs = req("POST", f"/session/{sid}/log", {"type": "browser"})
    for entry in logs.get("value", []):
        print(entry.get("level"), "|", entry.get("message", "").split(" ", 1)[-1][:500])
    if not logs.get("value"):
        print("(no browser console output)")
finally:
    req("DELETE", f"/session/{sid}")