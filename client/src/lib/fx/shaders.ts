/** GLSL for the 3D scenes. Kept as strings so they bundle without a loader. All animation runs on the GPU from a time uniform. */

/** Ashima/McEwan 3D simplex noise (MIT). */
export const SIMPLEX_3D = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`;

/**
 * Shared by node and edge shaders so a node and the edges attached to it always move together:
 * slow Lissajous drift per node plus a soft push away from the cursor.
 */
const FIELD_COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uMouse;          // world-space cursor position on the z=0 plane
uniform float uMouseStrength; // 0 when the cursor is idle or away
vec3 drift(vec3 p, float ph, float t){
  float a = ph * 6.2831853;
  return p + 0.32 * vec3(sin(t * 0.31 + a), cos(t * 0.27 + a * 1.7), sin(t * 0.23 + a * 2.3));
}
// Returns the displaced position; glow (0..1) is how close the cursor is.
vec3 react(vec3 p, out float glow){
  vec2 d = p.xy - uMouse.xy;
  float dist = length(d);
  float f = smoothstep(4.4, 0.0, dist) * uMouseStrength;
  glow = f;
  vec2 dir = d / (dist + 0.001);
  p.xy += dir * f * 1.25 + vec2(-dir.y, dir.x) * f * 0.35; // push out, with a little swirl
  p.z += f * 0.9;
  return p;
}
`;

export const NODE_VERT = /* glsl */ `
${FIELD_COMMON}
uniform float uPixelRatio;
uniform float uSize;
uniform float uScroll;
attribute float aPhase;
attribute float aSize;
attribute float aTint;
attribute float aHub;
varying float vTint;
varying float vGlow;
varying float vHub;
varying float vTwinkle;
void main(){
  float glow;
  vec3 p = react(drift(position, aPhase, uTime), glow);
  vGlow = glow;
  vHub = aHub;
  vTint = clamp(aTint + uScroll * 0.45, 0.0, 1.0);
  vTwinkle = 0.7 + 0.3 * sin(uTime * 1.25 + aPhase * 40.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uSize * (1.0 + glow * 0.9 + aHub * 0.8) * uPixelRatio / -mv.z;
}
`;

export const NODE_FRAG = /* glsl */ `
uniform vec3 uCyan;
uniform vec3 uViolet;
uniform vec3 uMagenta;
uniform float uAlpha;
varying float vTint;
varying float vGlow;
varying float vHub;
varying float vTwinkle;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float core = smoothstep(0.16, 0.0, d);
  float halo = pow(smoothstep(0.5, 0.0, d), 2.2);
  vec3 col = mix(uCyan, uViolet, vTint);
  col = mix(col, uMagenta, vHub * 0.5);
  vec3 rgb = col * (halo * 1.15) + vec3(1.0) * core * 0.85;
  float a = (halo * 0.9 + core) * vTwinkle * uAlpha * (1.0 + vGlow * 1.5);
  gl_FragColor = vec4(rgb, a);
}
`;

export const EDGE_VERT = /* glsl */ `
${FIELD_COMMON}
uniform float uScroll;
attribute float aPhase;
attribute float aAlong;
attribute float aSeed;
attribute float aTint;
varying float vAlong;
varying float vSeed;
varying float vTint;
varying float vGlow;
void main(){
  float glow;
  vec3 p = react(drift(position, aPhase, uTime), glow);
  vGlow = glow;
  vAlong = aAlong;
  vSeed = aSeed;
  vTint = clamp(aTint + uScroll * 0.45, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const EDGE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uPulse;      // 0 disables travelling pulses (low tier)
uniform float uAlpha;
uniform vec3 uCyan;
uniform vec3 uViolet;
varying float vAlong;
varying float vSeed;
varying float vTint;
varying float vGlow;
void main(){
  // A bright packet travels from endpoint a to b; only ~half of the edges carry one at a time.
  float head = fract(uTime * 0.16 + vSeed);
  float carries = step(0.5, fract(vSeed * 7.31));
  float pulse = smoothstep(0.14, 0.0, abs(vAlong - head)) * carries * uPulse;
  vec3 col = mix(uCyan, uViolet, vTint);
  float a = (0.11 + vGlow * 0.6 + pulse * 0.85) * uAlpha;
  gl_FragColor = vec4(col * (1.0 + pulse * 1.2), a);
}
`;

export const ORB_VERT = /* glsl */ `
${SIMPLEX_3D}
uniform float uTime;
uniform float uPulse;   // click ripple, decays 1 -> 0
uniform float uHover;   // 0..1, smoothed
varying vec3 vNormal;
varying vec3 vView;
varying float vNoise;
varying float vY;
void main(){
  float n = snoise(position * 1.25 + vec3(0.0, uTime * 0.28, uTime * 0.16));
  float n2 = snoise(position * 3.1 - vec3(uTime * 0.22));
  float ripple = uPulse * 0.07 * sin(position.y * 10.0 - uTime * 10.0);
  float disp = (n * 0.065 + n2 * 0.016) * (1.0 + uHover * 0.9) + ripple;
  vec3 p = position + normal * disp;
  vNoise = n;
  vY = p.y;
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

export const ORB_FRAG = /* glsl */ `
uniform float uTime;
uniform float uPulse;
uniform vec3 uCyan;
uniform vec3 uViolet;
uniform vec3 uMagenta;
varying vec3 vNormal;
varying vec3 vView;
varying float vNoise;
varying float vY;
void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vView);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.4);
  float tone = clamp(vNoise * 0.5 + 0.5, 0.0, 1.0);
  // Dark glassy core with slow violet/cyan energy moving through it.
  vec3 core = mix(vec3(0.012, 0.02, 0.05), mix(uViolet, uCyan, tone) * 0.34, 0.55 + 0.45 * tone);
  float bands = smoothstep(0.42, 0.5, abs(fract(vY * 2.6 - uTime * 0.22) - 0.5));
  core += uCyan * bands * 0.07;
  vec3 rim = mix(uCyan, uMagenta, smoothstep(-0.4, 0.9, N.x * 0.6 + N.y * 0.4 + vNoise * 0.35));
  vec3 col = core + rim * fres * 1.7 + uViolet * pow(fres, 6.0) * 0.9;
  col += uCyan * uPulse * 0.55 * fres;
  col *= 0.94 + 0.06 * sin(gl_FragCoord.y * 1.3); // faint scanlines
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SAT_VERT = /* glsl */ `
uniform float uPixelRatio;
attribute float aSize;
attribute float aTint;
varying float vTint;
void main(){
  vTint = aTint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * 46.0 * uPixelRatio / -mv.z;
}
`;

export const SAT_FRAG = /* glsl */ `
uniform vec3 uCyan;
uniform vec3 uViolet;
varying float vTint;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float core = smoothstep(0.2, 0.0, d);
  float halo = pow(smoothstep(0.5, 0.0, d), 2.0);
  vec3 col = mix(uCyan, uViolet, vTint);
  gl_FragColor = vec4(col * halo * 1.3 + vec3(core), halo * 0.95 + core);
}
`;
