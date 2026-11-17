import inject from './virtualMouse.inject.js?raw'

/** 顶层虚拟鼠标。点 / 填 / 滚都走它，坐标换算到 top。 */
export const VIRTUAL_MOUSE_JS = String(inject)

export const showVirtualMouseAt = (kind: string, x: number, y: number, label = '') =>
  `(function(){ ${VIRTUAL_MOUSE_JS}
    var top = __zeMouseTop();
    var x = ${Number(x) || 0};
    var y = ${Number(y) || 0};
    try {
      var win = window;
      while (win && win !== top) {
        var f = win.frameElement;
        if (!f) break;
        var r = f.getBoundingClientRect();
        x += r.left; y += r.top;
        win = win.parent;
      }
    } catch (e) {}
    __zeEnsureMouse().act(${JSON.stringify(kind)}, x, y, ${JSON.stringify(label)});
    return true;
  })()`
