"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./hero_field.module.css";

/**
 * The one WebGL surface on the site: slow route arcs drifting behind the hero, parallaxed a
 * little by the pointer. It is atmosphere, never information — nothing here is readable and
 * nothing depends on it.
 *
 * It fails soft in every direction that matters. `peraplano-bg-planes.svg` (the 1600x900
 * seven-plane background that shipped with the brand set and had no consumer until now) is
 * painted underneath as a CSS background, so the band is never empty; the canvas fades in on
 * top only once a context exists. No WebGL, no `ogl` chunk, an old GPU, or
 * `prefers-reduced-motion: reduce` all land on that same static artwork rather than on a
 * blank rectangle. The import is dynamic so the library is not in the initial bundle and
 * cannot delay first paint of the headline above it.
 */
export function HeroField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;

    let disposed = false;
    let frame = 0;
    let stop: (() => void) | undefined;

    void (async () => {
      try {
        const { Renderer, Program, Mesh, Triangle, Vec2 } = await import("ogl");
        if (disposed) return;

        const renderer = new Renderer({
          canvas,
          alpha: true,
          antialias: false,
          dpr: Math.min(window.devicePixelRatio, 2),
        });
        const gl = renderer.gl;
        const geometry = new Triangle(gl);
        const pointer = new Vec2(0, 0);
        const resolution = new Vec2(1, 1);

        // Held as local objects rather than reached for through `program.uniforms`, which
        // ogl types as `any` — the render loop writes to `uTime` every frame and a typo in
        // that path would silently animate nothing.
        const uTime = { value: 0 };
        const program = new Program(gl, {
          vertex: VERTEX,
          fragment: FRAGMENT,
          transparent: true,
          uniforms: {
            uTime,
            uResolution: { value: resolution },
            uPointer: { value: pointer },
          },
        });
        const mesh = new Mesh(gl, { geometry, program });

        const resize = () => {
          const parent = canvas.parentElement;
          if (parent === null) return;
          renderer.setSize(parent.clientWidth, parent.clientHeight);
          resolution.set(parent.clientWidth, parent.clientHeight);
        };
        resize();
        window.addEventListener("resize", resize);

        // Pointer parallax is eased towards the cursor rather than tracking it, so a fast
        // mouse does not whip the whole field across the band.
        const target = { x: 0, y: 0 };
        const onPointer = (event: PointerEvent) => {
          target.x = (event.clientX / window.innerWidth) * 2 - 1;
          target.y = (event.clientY / window.innerHeight) * 2 - 1;
        };
        window.addEventListener("pointermove", onPointer, { passive: true });

        const start = performance.now();
        const loop = (now: number) => {
          frame = requestAnimationFrame(loop);
          pointer.x += (target.x - pointer.x) * 0.045;
          pointer.y += (target.y - pointer.y) * 0.045;
          uTime.value = (now - start) / 1000;
          renderer.render({ scene: mesh });
        };
        frame = requestAnimationFrame(loop);
        setLive(true);

        stop = () => {
          cancelAnimationFrame(frame);
          window.removeEventListener("resize", resize);
          window.removeEventListener("pointermove", onPointer);
          gl.getExtension("WEBGL_lose_context")?.loseContext();
        };
      } catch {
        // No WebGL, a blocked chunk, or a driver that refuses the context. The background
        // artwork is already on screen; there is nothing to report and nothing to retry.
      }
    })();

    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  return (
    <div className={styles.field} aria-hidden="true">
      <canvas ref={canvasRef} className={styles.canvas} data-live={live} />
    </div>
  );
}

const VERTEX = /* glsl */ `
  attribute vec2 uv;
  attribute vec2 position;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

/**
 * Five arcs, each a sine of the horizontal axis with a second harmonic so they read as
 * flight paths rather than as a waveform. Colours are the brand pair from
 * assets/brand/README.md, #15803D shadow face to #22C55E light face, as linear RGB.
 */
const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec2 uPointer;
  varying vec2 vUv;

  float arc(vec2 uv, float phase, float amp, float thickness) {
    float y = 0.5
      + sin(uv.x * 2.2 + phase) * amp
      + sin(uv.x * 5.1 + phase * 1.7) * amp * 0.3;
    return smoothstep(thickness, 0.0, abs(uv.y - y));
  }

  void main() {
    vec2 uv = vUv;
    uv.x *= max(uResolution.x, 1.0) / max(uResolution.y, 1.0);

    float t = uTime * 0.06;
    vec3 colour = vec3(0.0);
    float alpha = 0.0;

    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      vec2 offset = uPointer * (0.012 + fi * 0.006);
      float glow = arc(uv + offset, t + fi * 1.7, 0.055 + fi * 0.014, 0.0055 + fi * 0.0015);
      vec3 tint = mix(vec3(0.082, 0.502, 0.239), vec3(0.133, 0.773, 0.369), fi / 4.0);
      colour += tint * glow;
      alpha += glow * 0.5;
    }

    // Fades out towards the bottom of the band so the headline never sits on a bright line.
    float falloff = smoothstep(0.0, 0.45, vUv.y);
    gl_FragColor = vec4(colour, clamp(alpha, 0.0, 0.6) * falloff);
  }
`;
