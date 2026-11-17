// Start `npm run dev`, then run:
// swift -module-cache-path /tmp/zerror-swift-module-cache testdata/ui/site-graph-zoom-wk.swift
// Uses an isolated WKWebView and bundled graph data; no app accounts or conversations.
import AppKit
import WebKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let config = WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 500, height: 620), configuration: config)
let window = NSWindow(contentRect: web.frame, styleMask: [.titled], backing: .buffered, defer: false)
window.contentView = web
window.orderBack(nil)

class Runner: NSObject, WKNavigationDelegate {
    var passed = false
    func snapshot(_ path: String, completion: @escaping () -> Void) {
        let options = WKSnapshotConfiguration()
        options.rect = web.bounds
        web.takeSnapshot(with: options) { image, error in
            guard let data = image?.tiffRepresentation,
                  let bitmap = NSBitmapImageRep(data: data),
                  let png = bitmap.representation(using: .png, properties: [:]) else {
                print("Snapshot failed: \(String(describing: error))"); exit(1)
            }
            try! png.write(to: URL(fileURLWithPath: path))
            completion()
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        web.callAsyncJavaScript("""
          for(let i=0;i<100&&!window.graphZoomRegression;i++) await new Promise(r=>setTimeout(r,100));
          if(!window.graphZoomRegression) throw Error('Graph fixture did not load');
          return await window.graphZoomRegression.run();
          """, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value):
                guard let value = value as? [String: Any] else { print("No result"); exit(1) }
                self.passed = value["passed"] as? Bool ?? false
                let json = try! JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
                print(String(data: json, encoding: .utf8)!)
                web.callAsyncJavaScript("""
                  await window.graphZoomRegression.focus(.44);
                  const map=document.querySelector('.graph-map'), camera=document.querySelector('.graph-camera');
                  const rect=document.querySelector('.graph-scroll').getBoundingClientRect();
                  const scale=Number(map.style.zoom)*Number(map.style.transform.slice(6,-1));
                  camera.style.left=`${(rect.width-parseFloat(map.style.width)*scale)/2}px`;
                  camera.style.top=`${(rect.height-parseFloat(map.style.height)*scale)/2}px`;
                  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
                  return true;
                  """, arguments: [:], in: nil, in: .page) { _ in
                    self.snapshot("/tmp/zerror-graph-zoom-small.png") {
                        window.setContentSize(NSSize(width: 1440, height: 1000))
                        web.callAsyncJavaScript("await window.graphZoomRegression.focus(6); return true;", arguments: [:], in: nil, in: .page) { _ in
                            self.snapshot("/tmp/zerror-graph-zoom-large.png") { exit(self.passed ? 0 : 1) }
                        }
                    }
                }
            case .failure(let error): print(error); exit(1)
            }
        }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print(error); exit(1)
    }
}
let runner = Runner()
web.navigationDelegate = runner
let site = CommandLine.arguments.dropFirst().first == "zjooc" ? "zjooc" : "chaoxing"
web.load(URLRequest(url: URL(string: "http://localhost:1420/testdata/browser/fixtures/site-graph-zoom.html?site=\(site)")!))
DispatchQueue.main.asyncAfter(deadline: .now() + 55) { print("TIMEOUT"); exit(2) }
app.run()
