import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SETTINGS } from '../config/settings.js';
import { damp } from '../utils/math.js';

/**
 * Distance-layered volumetric fog. Samples the scene depth buffer and fades
 * fog in from the player outward, so the near ground stays readable while
 * distant structures dissolve into haze. A height falloff keeps the fog
 * hugging the ground like real mist.
 */
const VolumetricFogShader = {
  name: 'VolumetricFogShader',
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    cameraProjectionInverse: { value: new THREE.Matrix4() },
    cameraMatrixWorld: { value: new THREE.Matrix4() },
    fogPlayer: { value: new THREE.Vector3() },
    fogColor: { value: new THREE.Color(0x879273) },
    fogDensity: { value: 0.0075 },
    nearStart: { value: 4.5 },
    nearEnd: { value: 24.0 },
    heightFalloff: { value: 0.16 },
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
    uniform sampler2D tDepth;
    uniform mat4 cameraProjectionInverse;
    uniform mat4 cameraMatrixWorld;
    uniform vec3 fogPlayer;
    uniform vec3 fogColor;
    uniform float fogDensity;
    uniform float nearStart;
    uniform float nearEnd;
    uniform float heightFalloff;
    uniform float time;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      float depth = texture2D(tDepth, vUv).x;

      vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec4 view = cameraProjectionInverse * clip;
      view.xyz /= max(view.w, 0.00001);
      vec3 world = (cameraMatrixWorld * vec4(view.xyz, 1.0)).xyz;

      float groundDistance = length(world.xz - fogPlayer.xz);
      if (depth > 0.99999) groundDistance = 120.0;

      float nearFade = smoothstep(nearStart, nearEnd, groundDistance);
      float heightTint = exp(-max(world.y, 0.0) * heightFalloff);
      float body = 1.0 - exp(-fogDensity * fogDensity * groundDistance * groundDistance);
      float amount = clamp(body * nearFade * mix(0.42, 1.0, heightTint), 0.0, 0.96);

      // Fine screen-space dithering hides 8-bit banding in the gradients.
      float dither = fract(sin(dot(vUv, vec2(12.9898, 78.233)) + time * 0.7) * 43758.5453);
      amount = clamp(amount + (dither - 0.5) * 0.012, 0.0, 0.96);

      gl_FragColor = vec4(mix(base.rgb, fogColor, amount), base.a);
    }
  `,
};

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

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      // Stronger barrel curvature.
      vec2 curved = vUv * 2.0 - 1.0;
      vec2 curveOffset = abs(curved.yx) / vec2(5.4, 3.8);
      curved += curved * curveOffset * curveOffset * 0.135;
      vec2 uv = curved * 0.5 + 0.5;

      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      // Interlaced field shimmer and a tiny horizontal tube jitter.
      float line = floor(gl_FragCoord.y);
      uv.x += mod(line, 2.0) * 0.00115;
      uv.x += (hash(vec2(line, floor(time * 18.0))) - 0.5) * 0.00045;

      // Stronger chromatic fringing toward the edges.
      vec2 dir = uv - 0.5;
      vec2 fringe = dir * (0.0018 + 0.0034 * dot(dir, dir));
      float r = texture2D(tDiffuse, uv + fringe).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - fringe).b;
      vec3 color = vec3(r, g, b);

      // Scanlines + aperture grille, with a slowly rolling refresh band.
      float scan = 0.5 + 0.5 * sin((gl_FragCoord.y + time * 9.0) * 3.14159265);
      color *= mix(1.0, 0.72 + 0.28 * scan, 0.82);
      float grille = 0.91 + 0.09 * sin(gl_FragCoord.x * 2.0943951);
      color *= grille;
      float roll = fract(uv.y + time * 0.035);
      float band = 1.0 - smoothstep(0.0, 0.045, abs(roll - 0.5));
      color *= 1.0 + band * 0.075;

      // Faint phosphor noise/grain.
      float grain = hash(gl_FragCoord.xy + floor(time * 60.0) * 17.0);
      color += (grain - 0.5) * 0.045;

      // Deeper tube vignette and a very slight cool phosphor cast.
      vec2 edge = uv * (1.0 - uv.xy);
      float vig = clamp(pow(edge.x * edge.y * 18.0, 0.19), 0.0, 1.0);
      color *= mix(0.52, 1.0, vig);
      color *= vec3(0.985, 0.995, 1.025);

      // Mains flicker and a gentle brightness lift.
      color *= 1.0 + 0.021 * sin(time * 43.0) + 0.007 * sin(time * 7.3);
      color = clamp(color * 1.06, 0.0, 1.0);

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
    this.isMobile =
      this.isCoarsePointer ||
      (window.innerWidth <= 820 && window.innerHeight <= 900) ||
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
    this.maxPixelRatio = this.isMobile
      ? Math.min(window.devicePixelRatio || 1, 1.35)
      : 1.8;

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
    this.renderer.shadowMap.enabled = !this.isMobile;
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

    const renderSize = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(renderSize);
    const depthTexture = new THREE.DepthTexture(
      Math.max(1, renderSize.x),
      Math.max(1, renderSize.y),
      THREE.UnsignedIntType
    );
    const composerTarget = new THREE.WebGLRenderTarget(
      Math.max(1, renderSize.x),
      Math.max(1, renderSize.y),
      {
        type: THREE.HalfFloatType,
        depthBuffer: true,
        depthTexture,
      }
    );
    this.composer = new EffectComposer(this.renderer, composerTarget);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio));
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.fogPass = new ShaderPass(VolumetricFogShader);
    this.fogPass.uniforms.fogDensity.value = 0.0075;
    this.composer.addPass(this.fogPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      this.isMobile ? 0.28 : 0.36,
      this.isMobile ? 0.48 : 0.55,
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
    if (this.fogPass?.enabled) {
      const uniforms = this.fogPass.uniforms;
      uniforms.tDepth.value = this.composer.readBuffer.depthTexture;
      uniforms.cameraProjectionInverse.value.copy(this.camera.projectionMatrixInverse);
      uniforms.cameraMatrixWorld.value.copy(this.camera.matrixWorld);
      uniforms.time.value = performance.now() * 0.001;
    }
    this.composer.render();
  }

  /**
   * Drive the distance-fog pass. Density is tuned in world metres so a dense
   * bank swallows the far end of the corridor while leaving a readable bubble
   * around the player.
   */
  setVolumetricFog({ density, color, playerX = 0, playerZ = 0, nearStart = 4.5, nearEnd = 24, heightFalloff = 0.16 } = {}) {
    if (!this.fogPass) return;
    const uniforms = this.fogPass.uniforms;
    if (Number.isFinite(density)) uniforms.fogDensity.value = density;
    if (color !== undefined) uniforms.fogColor.value.copy(color);
    uniforms.fogPlayer.value.set(playerX, 0, playerZ);
    uniforms.nearStart.value = nearStart;
    uniforms.nearEnd.value = nearEnd;
    uniforms.heightFalloff.value = heightFalloff;
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
