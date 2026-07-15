// Particle infinity (lemniscate of Bernoulli) renderer.
// White glowing particles tracing an ∞ symbol that slowly warps, optionally
// rotates, flows along its path, and sheds drifting particles from its edges.
//
// Drives EVERY `.auth-infinity-canvas` on the page as an independent instance.
// Per-canvas tuning via data attributes:
//   data-body   particle count along the curve            (default 560)
//   data-drift  edge-shed particle pool size, 0 = off      (default 160)
//   data-spawn  drift particles spawned per second         (default 55)
//   data-rotate revolutions-driver; 0 = fixed horizontal   (default 0.16)
//   data-fill   fraction of the stage the symbol fills     (default 0.82)
(function () {
  const reduce =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Shared pre-rendered glow sprite: hard bright core + short feather.
  const sprite = document.createElement("canvas");
  sprite.width = 24;
  sprite.height = 24;
  const sctx = sprite.getContext("2d");
  const grd = sctx.createRadialGradient(12, 12, 0, 12, 12, 12);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.18, "rgba(255,255,255,1)");
  grd.addColorStop(0.4, "rgba(255,255,255,0.6)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  sctx.fillStyle = grd;
  sctx.fillRect(0, 0, 24, 24);

  // Point on the lemniscate of Bernoulli at parameter t.
  function lem(t) {
    const s = Math.sin(t);
    const c = Math.cos(t);
    const d = 1 + s * s;
    return { x: c / d, y: (s * c) / d };
  }

  function num(el, key, fallback) {
    const v = parseFloat(el.dataset[key]);
    return Number.isFinite(v) ? v : fallback;
  }

  function createInstance(canvas) {
    const ctx = canvas.getContext("2d");
    const DPR = Math.min(window.devicePixelRatio || 1, 2);

    const BODY = Math.max(20, Math.round(num(canvas, "body", 560)));
    const DRIFT = Math.max(0, Math.round(num(canvas, "drift", 160)));
    const SPAWN = num(canvas, "spawn", 55);
    const ROT = num(canvas, "rotate", 0.16);
    const FILL = num(canvas, "fill", 0.82);
    // particle sizing scales down a touch for tiny canvases (e.g. the logo).
    const sizeScale = num(canvas, "psize", 1);

    let W = 0;
    let H = 0;
    let cx = 0;
    let cy = 0;
    let scale = 0;
    // half-height of the ∞ incl. thickness/drift, used to keep it unclipped.
    const HALF_H = 0.46;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      W = Math.max(1, rect.width);
      H = Math.max(1, rect.height);
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      cx = W / 2;
      cy = H / 2;
      if (ROT !== 0) {
        // rotating: must fit the symbol's bounding circle at every angle.
        scale = (Math.min(W, H) / 2) * FILL;
      } else {
        // fixed horizontal: fill the width but never overflow the height.
        scale = Math.min((W / 2) * FILL, H / 2 / HALF_H);
      }
    }

    const body = [];
    const edge = [];
    for (let i = 0; i < BODY; i++) {
      const p = {
        t: (i / BODY) * Math.PI * 2,
        rad: Math.pow(Math.random(), 1.7) * 0.055,
        ang: Math.random() * Math.PI * 2,
        phase: Math.random() * Math.PI * 2,
        twk: 0.5 + Math.random(),
        size: (1.4 + Math.random() * 2.4) * sizeScale,
        base: 0.6 + Math.random() * 0.4,
        sx: 0,
        sy: 0,
      };
      body.push(p);
      if (p.rad > 0.03) edge.push(p);
    }

    const drift = [];
    for (let i = 0; i < DRIFT; i++) {
      drift.push({ life: 0, max: 1, x: 0, y: 0, vx: 0, vy: 0, size: 1 });
    }
    let driftIdx = 0;
    let spawnAcc = 0;

    function spawnDrift(x, y) {
      const p = drift[driftIdx];
      driftIdx = (driftIdx + 1) % DRIFT;
      const a = Math.random() * Math.PI * 2;
      const sp = 8 + Math.random() * 22;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 5;
      p.life = 0;
      p.max = 1.4 + Math.random() * 2.0;
      p.size = (1 + Math.random() * 1.8) * sizeScale;
    }

    function drawBody(time) {
      const rot = time * ROT;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const twist = Math.sin(time * 0.23) * 0.18;
      const flow = time * 0.1;

      for (let i = 0; i < BODY; i++) {
        const p = body[i];
        const t = p.t + flow;
        const pt = lem(t);
        const wx =
          Math.sin(t * 3 + time * 0.8 + p.phase) * 0.038 +
          Math.sin(t * 6 - time * 0.5) * 0.018;
        const wy = Math.cos(t * 2 + time * 0.6 + p.phase) * 0.032;
        const r = p.rad * (1 + 0.45 * Math.sin(time * p.twk + p.phase));
        let x = pt.x + wx + Math.cos(p.ang) * r;
        let y = pt.y + wy + Math.sin(p.ang) * r;
        x += y * twist;
        const rx = x * cosR - y * sinR;
        const ry = x * sinR + y * cosR;
        p.sx = cx + rx * scale;
        p.sy = cy + ry * scale;

        ctx.globalAlpha = p.base * (0.78 + 0.22 * Math.sin(time * 1.4 + p.phase));
        const s = p.size;
        ctx.drawImage(sprite, p.sx - s, p.sy - s, s * 2, s * 2);
      }
    }

    function render(time, dt) {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";

      drawBody(time);

      if (reduce || DRIFT === 0 || SPAWN <= 0) return;

      spawnAcc += dt * SPAWN;
      while (spawnAcc >= 1 && edge.length) {
        spawnAcc -= 1;
        const e = edge[(Math.random() * edge.length) | 0];
        spawnDrift(e.sx, e.sy);
      }

      for (let i = 0; i < DRIFT; i++) {
        const p = drift[i];
        if (p.life >= p.max) continue;
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const damp = 1 - 0.7 * dt;
        p.vx *= damp;
        p.vy *= damp;
        const k = p.life / p.max;
        ctx.globalAlpha = (1 - k) * 0.7;
        const s = p.size * (1 - 0.4 * k);
        ctx.drawImage(sprite, p.x - s, p.y - s, s * 2, s * 2);
      }
    }

    let t0 = 0;
    let last = 0;
    function loop(now) {
      if (!t0) {
        t0 = now;
        last = now;
      }
      const time = (now - t0) / 1000;
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.05) dt = 0.05;
      render(time, dt);
      requestAnimationFrame(loop);
    }

    resize();
    window.addEventListener("resize", resize);
    if (reduce || canvas.dataset.static !== undefined) {
      // static frame: render once, no animation loop.
      render(0, 0);
      window.addEventListener("resize", function () {
        render(0, 0);
      });
    } else {
      requestAnimationFrame(loop);
    }
  }

  const canvases = document.querySelectorAll(".auth-infinity-canvas");
  canvases.forEach(createInstance);
})();
