import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SETTINGS } from '../config/settings.js';
import { damp } from '../utils/math.js';

/**
 * CRT display simulation. Runs after OutputPass so it receives sRGB pixels.
 * Barrel curvature, aperture-grille mask, scanlines, interlace shimmer,
 * chromatic fringing, vignette and a tiny mains flicker.
 */
const CRTShader = {
  name: 'CRTShader',
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    varying vec2 vUv;

    void main() {
      // Barrel curvature.
      vec2 curved = vUv * 2.0 - 1.0;
      vec2 curveOffset = abs(curved.yx) / vec2(6.0, 4.0);
      curved += curved * curveOffset * curveOffset * 0.085;
      vec2 uv = curved * 0.5 + 0.5;

      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      // Interlaced field shimmer.
      float line = floor(gl_FragCoord.y);
      uv.x += mod(line, 2.0) * 0.00045;

      // Chromatic fringing toward the edges.
      vec2 dir = uv - 0.5;
      vec2 fringe = dir * (0.0009 + 0.0018 * dot(dir, dir));
      float r = texture2D(tDiffuse, uv + fringe).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - fringe).b;
      vec3 color = vec3(r, g, b);

      // Scanlines + aperture grille.
      float scan = 0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159265);
      color *= mix(1.0, 0.82 + 0.18 * scan, 0.55);
      float grille = 0.965 + 0.035 * sin(gl_FragCoord.x * 2.0943951);
      color *= grille;

      // Soft tube vignette.
      vec2 edge = uv * (1.0 - uv.xy);
      float vig = clamp(pow(edge.x * edge.y * 18.0, 0.22), 0.0, 1.0);
      color *= mix(0.72, 1.0, vig);

      // Low-level tube flicker and a gentle brightness lift.
      color *= 1.0 + 0.012 * sin(time * 43.0);
      color = clamp(color * 1.04, 0.0, 1.0);

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

/**
 * Owns the renderer, scene, camera and the post-processing stack.
 * The camera is a steep perspective "2.5D" camera deliberately tuned to read
 * like an orthographic vertical-scroller while retaining real perspective.
 */
export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.maxPixelRatio = this.isCoarsePointer ? 1.5 : 1.8;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x0a0d08, 1);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8b9778);
    this.scene.fog = new THREE.FogExp2(0x879273, 0.0068);

    const fov = SETTINGS.camera.fov;
    this.camera = new THREE.PerspectiveCamera(
      fov,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.1,
      380
    );
    this.camera.position.set(0, SETTINGS.camera.height, -SETTINGS.camera.back);
    this.camera.lookAt(0, 0, SETTINGS.camera.lookAhead);
    this.camera.updateMatrixWorld(true);

    this.scene.add(this.camera);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio));
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.36,
      0.55,
      0.88
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.crtPass = new ShaderPass(CRTShader);
    this.crtPass.enabled = true;
    this.crtEnabled = true;
    this.composer.addPass(this.crtPass);

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.rayHit = new THREE.Vector3();
    this.projected = new THREE.Vector3();
    this._forward = new THREE.Vector3();

    this.scroll = 0;
    this.focusX = 0;
    this.aimLead = 0;
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    window.visualViewport?.addEventListener('resize', this.resize);

    this.canvas.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        console.warn('[Engine] WebGL context lost.');
      },
      false
    );
    this.canvas.addEventListener(
      'webglcontextrestored',
      () => {
        console.info('[Engine] WebGL context restored.');
        this.resize();
      },
      false
    );
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.bloomPass.setSize(width, height);
    this.viewportHeightPx = height * ratio;
    if (this.onResize) this.onResize(width, height, ratio);
  }

  /**
   * Update the chase camera. `scroll` is the gameplay scroll anchor; it only
   * ever increases, which is what gives the level its one-way momentum.
   */
  updateCamera({
    scroll,
    dt,
    shakeX = 0,
    shakeY = 0,
    shakeZ = 0,
    shakeRoll = 0,
    menuTime = 0,
    attract = false,
    focusX = 0,
  }) {
    this.scroll = damp(this.scroll, scroll, SETTINGS.camera.scrollSmoothing, dt);
    this.focusX = damp(
      this.focusX,
      focusX * SETTINGS.camera.lateralFollow,
      attract ? 2 : 4.2,
      dt
    );
    const driftX = attract ? Math.sin(menuTime * 0.21) * 1.25 : 0;
    const bob = attract ? Math.sin(menuTime * 0.5) * 0.18 : 0;
    this.camera.position.set(
      this.focusX + driftX * 0.55 + shakeX,
      SETTINGS.camera.height + bob + shakeY,
      this.scroll - SETTINGS.camera.back + shakeZ
    );
    this.camera.lookAt(
      this.focusX * 0.5 + driftX * 0.2,
      0,
      this.scroll + SETTINGS.camera.lookAhead
    );
    this.camera.rotateZ(shakeRoll);
    this.camera.updateMatrixWorld(true);
  }

  getGroundPoint(ndcX, ndcY, out = this.rayHit) {
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, out);
    return hit;
  }

  projectToScreen(position, out = { x: 0, y: 0 }) {
    this.projected.copy(position).project(this.camera);
    out.x = (this.projected.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-this.projected.y * 0.5 + 0.5) * window.innerHeight;
    out.behind = this.projected.z > 1;
    return out;
  }

  getViewportHeightPx() {
    return this.viewportHeightPx || window.innerHeight * this.renderer.getPixelRatio();
  }

  render() {
    if (this.crtPass?.enabled) {
      this.crtPass.uniforms.time.value = performance.now() * 0.001;
    }
    this.composer.render();
  }

  setCrtEnabled(enabled) {
    this.crtEnabled = Boolean(enabled);
    if (this.crtPass) this.crtPass.enabled = this.crtEnabled;
  }

  dispose() {
    window.removeEventListener('resize', this.resize);
    window.visualViewport?.removeEventListener('resize', this.resize);
    this.crtPass?.dispose?.();
    this.composer.dispose?.();
    this.renderer.dispose();
  }
}
