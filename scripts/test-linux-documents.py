#!/usr/bin/env python3
"""Real WebKitGTK web-process tests; run under xvfb-run on Linux, no remote sites."""
import io
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import gi
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = (ROOT / "src-tauri/src/app_browser/document_script.js").read_text()


def pump_until(check, timeout=12):
    deadline = time.monotonic() + timeout
    context = GLib.MainContext.default()
    while time.monotonic() < deadline:
        while context.pending():
            context.iteration(False)
        value = check()
        if value:
            return value
        time.sleep(0.005)
    raise AssertionError("Timed out waiting for WebKitGTK")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path == "/audio.wav":
            stream = io.BytesIO()
            with wave.open(stream, "wb") as audio:
                audio.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
                audio.writeframes(b"\0" * 32000)
            data, mime = stream.getvalue(), "audio/wav"
        else:
            if self.path.startswith("/root"):
                html = f'''<h1>root</h1><iframe id="a" src="{CHILD}/child"></iframe>
                <iframe id="b" src="{CHILD}/child"></iframe>'''
            elif self.path.startswith("/child"):
                html = f'''<h1>child</h1><textarea id="answer">before</textarea>
                <button id="click" onclick="document.querySelector('h1').textContent='clicked'">click</button>
                <audio id="media" src="{CHILD}/audio.wav" preload="auto"></audio>
                <iframe id="nested" src="{TOP}/nested"></iframe>
                <script>document[Symbol.for('zerror.document.identity.v2')]='forged';</script>'''
            else:
                html = '<h1>nested</h1><input id="password" type="password" value="never-return-this">'
            data, mime = ("<!doctype html><meta charset=utf-8>" + html).encode(), "text/html"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


SERVERS = [ThreadingHTTPServer(("127.0.0.1", 0), Handler) for _ in range(2)]
TOP, CHILD = [f"http://127.0.0.1:{server.server_port}" for server in SERVERS]


class NativeFrames(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix="zerror-webkit-test-")
        flags = shlex.split(subprocess.check_output(
            ["pkg-config", "--cflags", "--libs", "webkit2gtk-web-extension-4.1"], text=True))
        subprocess.run([os.environ.get("CC", "cc"), "-shared", "-fPIC", "-fvisibility=hidden",
                        "-Wall", "-Wextra", "-Werror", str(ROOT / "src-tauri/src/linux_documents/extension.c"),
                        "-o", str(Path(cls.directory.name) / "libzerror-documents.so"), *flags], check=True)
        for server in SERVERS:
            threading.Thread(target=server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        for server in SERVERS:
            server.shutdown()
        cls.directory.cleanup()

    def setUp(self):
        self.context = WebKit2.WebContext.new_ephemeral()
        self.context.set_web_extensions_directory(self.directory.name)
        self.view = WebKit2.WebView.new_with_context(self.context)
        self.window = Gtk.Window()
        self.window.add(self.view)
        self.window.set_default_size(900, 700)
        self.window.show_all()
        self.view.load_uri(TOP + "/root")
        pump_until(lambda: not self.view.is_loading())
        self.rows = self.wait_rows(5)
        self.root = self.rows[0]
        self.a = self.by_selector(self.root, "#a")
        self.b = self.by_selector(self.root, "#b")

    def tearDown(self):
        self.window.destroy()
        context = GLib.MainContext.default()
        while context.pending():
            context.iteration(False)

    def begin(self, kind, document=None, payload="", view=None):
        document = document or {}
        parameters = GLib.Variant("(ssss)", tuple(document.get(key, "") for key in
            ("frameId", "loaderId", "url")) + (payload,))
        message = WebKit2.UserMessage.new("zerror.documents." + kind, parameters)
        result = []

        def done(target, response, *_args):
            try:
                reply = target.send_message_to_page_finish(response)
                self.assertEqual(reply.get_name(), "zerror.documents.reply")
                ok, text = reply.get_parameters().unpack()
                result.append((ok, json.loads(text) if ok else text))
            except Exception as error:
                result.append((False, str(error)))
        (view or self.view).send_message_to_page(message, None, done, None)
        return result

    def rpc(self, kind, document=None, payload="", view=None):
        pending = self.begin(kind, document, payload, view)
        ok, result = pump_until(lambda: pending[0] if pending else None)
        if not ok:
            raise RuntimeError(result)
        return result

    def wait_rows(self, count):
        return pump_until(lambda: rows if len(rows := self.rpc("list")) == count else None)

    def by_selector(self, parent, selector):
        child = self.rpc("child", parent, selector)
        return next(row for row in self.rpc("list") if row["frameId"] == child)

    def run_fixed(self, document, **args):
        expression = f"({SCRIPT})({json.dumps(document)}, {json.dumps(args)})"
        return self.rpc("evaluate", document, expression)["value"]

    def test_cross_origin_owner_binding_and_isolation(self):
        self.assertEqual(self.a["url"], self.b["url"])
        self.assertNotEqual(self.a["frameId"], self.b["frameId"])
        nested = self.by_selector(self.a, "#nested")
        self.assertEqual(self.run_fixed(nested, action="query", selector="h1", limit=1)["nodes"][0]["text"], "nested")
        self.assertIsNone(self.rpc("child", self.root, "iframe"))  # ambiguous owner
        self.assertIsNone(self.rpc("child", self.root, "h1"))
        self.run_fixed(self.a, action="fill", selector="#answer", text="after")
        self.assertEqual(self.run_fixed(self.a, action="value", selector="#answer")["value"], "after")
        self.assertEqual(self.run_fixed(self.b, action="value", selector="#answer")["value"], "before")
        self.run_fixed(self.a, action="click", selector="#click")
        self.assertEqual(self.run_fixed(self.a, action="query", selector="h1", limit=1)["nodes"][0]["text"], "clicked")
        self.assertNotIn("never-return-this", json.dumps(self.run_fixed(nested, action="query", selector="input", limit=1)))
        self.assertFalse(self.run_fixed(nested, action="fill", selector="#password", text="denied")["ok"])
        # Page-world symbols cannot forge native identities or interfere with the isolated world.
        with self.assertRaises(RuntimeError):
            self.run_fixed({**self.a, "loaderId": "forged"}, action="query", selector="h1", limit=1)

    def test_reload_detach_and_pending_results_invalidate(self):
        # Fixed clicks trigger real same-URL iframe navigation from the page world.
        self.view.evaluate_javascript("document.querySelector('#a').src += '?reload=1'", -1, None, None, None, None, None)
        pump_until(lambda: next((row for row in self.rpc("list") if row["frameId"] == self.a["frameId"]
                                 and row["loaderId"] != self.a["loaderId"]), None))
        with self.assertRaises(RuntimeError):
            self.run_fixed(self.a, action="query", selector="h1", limit=1)
        self.a = self.by_selector(self.root, "#a")
        # A promise that resolves after removal must never return a stale observation.
        pending = self.begin("evaluate", self.a, "new Promise(resolve=>setTimeout(()=>resolve('stale'),250))")
        self.view.evaluate_javascript("document.querySelector('#a').remove()", -1, None, None, None, None, None)
        self.assertFalse(pump_until(lambda: pending[0] if pending else None)[0])
        self.wait_rows(3)
        with self.assertRaises(RuntimeError):
            self.run_fixed(self.a, action="click", selector="#click")
        old_root, old_b = self.root, self.b
        self.view.reload()
        pump_until(lambda: not self.view.is_loading())
        self.wait_rows(5)
        for old in (old_root, old_b):
            with self.assertRaises(RuntimeError):
                self.run_fixed(old, action="query", selector="h1", limit=1)

    def test_media_wait_cancel_and_reply_limit(self):
        self.assertTrue(self.run_fixed(self.a, action="media_mute", selector="#media", muted=True)["ok"])
        state = self.run_fixed(self.a, action="media_read", selector="#media")
        self.assertTrue(state["muted"])
        expression = f"({SCRIPT})({json.dumps(self.a)}," + json.dumps({
            "action": "media_wait", "selector": "#media", "until": "ended", "timeoutMs": 2000,
            "wait_id": "cancel-me"}) + ")"
        pending = self.begin("evaluate", self.a, expression)
        self.run_fixed(self.a, action="media_cancel", selector="#media", wait_id="cancel-me")
        result = pump_until(lambda: pending[0] if pending else None)
        self.assertTrue(result[0])
        self.assertEqual(result[1]["value"]["event"], "cancelled")
        with self.assertRaisesRegex(RuntimeError, "大小限制"):
            self.rpc("evaluate", self.a, "'x'.repeat(140000)")


if __name__ == "__main__":
    unittest.main(verbosity=2)
