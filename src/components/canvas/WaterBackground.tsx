'use client';

import { useEffect, useRef } from 'react';

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main(){
  v_uv=a_pos*0.5+0.5;
  gl_Position=vec4(a_pos,0.,1.);
}`;

const FRAG = `
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_time;
uniform vec4 u_rp0;uniform vec4 u_rp1;
uniform vec4 u_rp2;uniform vec4 u_rp3;
uniform vec4 u_rp4;uniform vec4 u_rp5;
uniform vec4 u_rp6;uniform vec4 u_rp7;
varying vec2 v_uv;

vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec2 mod289(vec2 x){return x-floor(x*(1./289.))*289.;}
vec3 permute(vec3 x){return mod289(((x*34.)+1.)*x);}
float snoise(vec2 v){
  const vec4 C=vec4(.211324865,.366025403,-.577350269,.024390243);
  vec2 i=floor(v+dot(v,C.yy));
  vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1,0):vec2(0,1);
  vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;
  i=mod289(i);
  vec3 p=permute(permute(i.y+vec3(0,i1.y,1))+i.x+vec3(0,i1.x,1));
  vec3 m=max(.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.);
  m=m*m;m=m*m;
  vec3 x=2.*fract(p*C.www)-1.;
  vec3 h=abs(x)-.5;vec3 a0=x-floor(x+.5);
  m*=1.7928429-.8537347*(a0*a0+h*h);
  vec3 g;g.x=a0.x*x0.x+h.x*x0.y;
  g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.*dot(m,g);
}
float fbm(vec2 p){
  float v=0.,a=.5;
  for(int i=0;i<5;i++){v+=a*snoise(p);p*=2.;a*=.5;}
  return v;
}
vec2 ripple(vec2 uv,vec2 asp,vec2 cp,float age){
  if(age>3.5)return vec2(0);
  float radius=age*.5;
  vec2 cUV=cp*asp;
  float d=length(uv-cUV);
  float ring=exp(-pow((d-radius)*35.,2.));
  ring*=exp(-age*.45)*.09;
  return normalize(uv-cUV+.001)*ring;
}
void main(){
  vec2 uv=v_uv;
  vec2 asp=vec2(u_res.x/u_res.y,1.);
  vec2 uvs=uv*asp;
  float t=u_time;
  float r1=fbm(uvs*2.5+vec2(t*.12,t*.06))*.010;
  float r2=fbm(uvs*4.+vec2(-t*.08,t*.10))*.006;
  vec2 dist=vec2(r1+r2,r2-r1);
  dist+=vec2(sin(uv.y*8.+t*.3)*.0015,cos(uv.x*7.+t*.25)*.001);
  dist+=ripple(uvs,asp,u_rp0.xy,u_rp0.z)*u_rp0.w;
  dist+=ripple(uvs,asp,u_rp1.xy,u_rp1.z)*u_rp1.w;
  dist+=ripple(uvs,asp,u_rp2.xy,u_rp2.z)*u_rp2.w;
  dist+=ripple(uvs,asp,u_rp3.xy,u_rp3.z)*u_rp3.w;
  dist+=ripple(uvs,asp,u_rp4.xy,u_rp4.z)*u_rp4.w;
  dist+=ripple(uvs,asp,u_rp5.xy,u_rp5.z)*u_rp5.w;
  dist+=ripple(uvs,asp,u_rp6.xy,u_rp6.z)*u_rp6.w;
  dist+=ripple(uvs,asp,u_rp7.xy,u_rp7.z)*u_rp7.w;
  vec2 rUV=uv+dist;
  float ca=.004;
  vec2 caD=normalize(dist+.001);
  vec3 col;
  col.r=texture2D(u_tex,rUV+caD*ca).r;
  col.g=texture2D(u_tex,rUV).g;
  col.b=texture2D(u_tex,rUV-caD*ca).b;
  float shimmer=pow(snoise(uvs*3.+t*.2)*.5+.5,6.)*.035;
  col+=shimmer*.5;
  float caustic=pow(fbm(uvs*2.+t*.06)*.5+.5,4.)*.025;
  col+=vec3(.9,.95,1.)*caustic;
  float vig=1.-dot((uv-.5)*1.3,(uv-.5)*1.3);
  col*=mix(.7,1.,clamp(vig,0.,1.));
  gl_FragColor=vec4(col,1.);
}`;

interface Slot {
  x: number;
  y: number;
  age: number;
  on: boolean;
}

interface WaterBackgroundProps {
  disableInteraction?: boolean;
}

export default function WaterBackground({ disableInteraction }: WaterBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) return;

    const mkS = (t: number, s: string) => {
      const sh = gl.createShader(t)!;
      gl.shaderSource(sh, s);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };

    const vs = mkS(gl.VERTEX_SHADER, VERT);
    const fs = mkS(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    const pg = gl.createProgram()!;
    gl.attachShader(pg, vs);
    gl.attachShader(pg, fs);
    gl.linkProgram(pg);
    gl.useProgram(pg);

    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const ap = gl.getAttribLocation(pg, 'a_pos');
    gl.enableVertexAttribArray(ap);
    gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([10, 12, 16, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = '/backgrounds/bg.svg';
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    };

    const uR = gl.getUniformLocation(pg, 'u_res');
    const uT = gl.getUniformLocation(pg, 'u_time');
    const uRp = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => gl.getUniformLocation(pg, `u_rp${i}`));
    gl.uniform1i(gl.getUniformLocation(pg, 'u_tex'), 0);

    const slots: Slot[] = Array.from({ length: 8 }, () => ({ x: 0, y: 0, age: 99, on: false }));

    const addRipple = (x: number, y: number) => {
      for (const s of slots) if (s.on && s.age > 3.5) s.on = false;
      const idx = slots.findIndex((s) => !s.on);
      if (idx === -1) return;
      slots[idx].x = x;
      slots[idx].y = y;
      slots[idx].age = 0;
      slots[idx].on = true;
    };

    const onDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX;
      const cy = e.clientY;
      if (cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) return;
      addRipple((cx - rect.left) / rect.width, 1.0 - (cy - rect.top) / rect.height);
    };
    if (!disableInteraction) {
      document.addEventListener('mousedown', onDown, true);
    }

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      canvas.style.width = '100vw';
      canvas.style.height = '100vh';
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    let lastFrame = 0;
    let rafId = 0;

    const tick = (now: number) => {
      if (document.visibilityState === 'hidden') {
        rafId = 0;
        return;
      }
      if (!lastFrame) lastFrame = now;
      const dt = Math.min((now - lastFrame) / 1000, 0.1);
      lastFrame = now;

      for (const s of slots) {
        if (s.on) s.age += dt;
      }

      for (let i = 0; i < 8; i++) {
        const s = slots[i];
        gl.uniform4f(uRp[i]!, s.x, s.y, s.on ? s.age : 99, s.on ? 1 : 0);
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform2f(uR!, canvas.width, canvas.height);
      gl.uniform1f(uT!, now / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      rafId = window.requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (rafId) window.cancelAnimationFrame(rafId);
        rafId = 0;
      } else if (!rafId) {
        lastFrame = 0;
        rafId = window.requestAnimationFrame(tick);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    rafId = window.requestAnimationFrame(tick);

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibility);
      if (!disableInteraction) {
        document.removeEventListener('mousedown', onDown, true);
      }
      window.removeEventListener('resize', resize);
    };
  }, [disableInteraction]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full pointer-events-none" style={{ touchAction: 'none' }} />;
}
