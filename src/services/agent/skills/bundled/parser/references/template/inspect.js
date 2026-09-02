function inspect() {
  return {
    ok: true,
    host: location.host,
    path: location.pathname,
    page: 'unknown',
    frames: frames(window, 0).length,
  };
}
