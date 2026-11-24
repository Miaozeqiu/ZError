using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;
using System.Text.Json;

class Program {
  [STAThread] static void Main() {
    ApplicationConfiguration.Initialize();
    var form = new Form { Width = 1000, Height = 650 };
    form.Shown += async (_,_) => {
      try {
        foreach (var mode in new[] { "visible", "hidden", "hidden-focus", "disabled-focus", "hidden-disabled-focus" }) {
          using var view = new WebView2 { Width = 960, Height = 540 };
          form.Controls.Add(view);
          var folder = Path.Combine(Path.GetTempPath(), "cdp-probe-" + Guid.NewGuid());
          var env = await CoreWebView2Environment.CreateAsync(null, folder);
          await view.EnsureCoreWebView2Async(env);
          var core = view.CoreWebView2;
          var loaded = new TaskCompletionSource();
          core.NavigationCompleted += (_,_) => loaded.TrySetResult();
          core.NavigateToString("<button id='b' onclick=\"this.textContent=event.isTrusted?'Trusted click':'Synthetic click'\">CLI button</button><input id='i' oninput=\"document.getElementById('b').textContent=event.isTrusted?'Trusted input':'Synthetic input'\">");
          await loaded.Task;
          await core.CallDevToolsProtocolMethodAsync("Emulation.setDeviceMetricsOverride", "{\"width\":1920,\"height\":1080,\"deviceScaleFactor\":0,\"mobile\":false,\"scale\":0.5,\"dontSetVisibleSize\":true}");
          if (mode.Contains("hidden")) view.Visible = false;
          if (mode.Contains("disabled")) view.Enabled = false;
          if (mode.Contains("focus")) await core.CallDevToolsProtocolMethodAsync("Emulation.setFocusEmulationEnabled", "{\"enabled\":true}");
          await Task.Delay(300);
          Console.WriteLine("MODE=" + mode + " STATE=" + await core.ExecuteScriptAsync("JSON.stringify({visibility:document.visibilityState,focus:document.hasFocus(),rect:document.getElementById('b').getBoundingClientRect().toJSON()})"));
          var raw = await core.ExecuteScriptAsync("JSON.stringify((()=>{const r=document.getElementById('b').getBoundingClientRect();return {x:(r.left+r.width/2)*0.5,y:(r.top+r.height/2)*0.5}})())");
          var point = JsonDocument.Parse(JsonSerializer.Deserialize<string>(raw)).RootElement;
          var x = point.GetProperty("x").GetDouble(); var y = point.GetProperty("y").GetDouble();
          foreach (var kind in mode.Contains("hidden") ? new[]{"mousePressed", "mouseReleased"} : new[]{"mouseMoved", "mousePressed", "mouseReleased"}) {
            var args = JsonSerializer.Serialize(new {type=kind,x,y,button=kind=="mouseMoved"?"none":"left",buttons=kind=="mousePressed"?1:0,clickCount=kind=="mouseMoved"?0:1});
            try {
              var task = core.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", args);
              await task.WaitAsync(TimeSpan.FromSeconds(3));
              Console.WriteLine(mode + " " + kind + " OK");
            } catch (Exception error) { Console.WriteLine(mode + " " + kind + " " + error.GetType().Name); }
          }
          Console.WriteLine("RESULT=" + mode + " " + await core.ExecuteScriptAsync("document.getElementById('b').textContent"));
          await core.ExecuteScriptAsync("document.getElementById('i').focus()");
          await core.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", "{\"type\":\"keyDown\",\"key\":\"a\",\"code\":\"KeyA\",\"windowsVirtualKeyCode\":65,\"modifiers\":2,\"text\":\"\"}").WaitAsync(TimeSpan.FromSeconds(3));
          await core.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", "{\"type\":\"keyUp\",\"key\":\"a\",\"code\":\"KeyA\",\"windowsVirtualKeyCode\":65,\"modifiers\":2}").WaitAsync(TimeSpan.FromSeconds(3));
          await core.CallDevToolsProtocolMethodAsync("Input.insertText", "{\"text\":\"Fixture typed\"}").WaitAsync(TimeSpan.FromSeconds(3));
          Console.WriteLine("INPUT=" + mode + " " + await core.ExecuteScriptAsync("JSON.stringify({value:document.getElementById('i').value,trust:document.getElementById('b').textContent})"));
          form.Controls.Remove(view);
        }
      } catch (Exception e) { Console.WriteLine(e); Environment.ExitCode=1; }
      form.Close();
    };
    Application.Run(form);
  }
}
