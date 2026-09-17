'use client';
import { useEffect, useRef } from 'react';

const vertex = `
attribute vec3 aPosition;
attribute vec3 aColor;
attribute float aSeed;
uniform float uMorph;
uniform float uTime;
uniform float uAspect;
uniform float uDpr;
uniform vec2 uPointer;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float loose = 1.0 - uMorph;
  vec3 p = aPosition;
  float radial = length(p.xy * vec2(1.0,1.64));
  float edge = smoothstep(0.65,1.25,radial);
  p.xy += vec2(sin(aSeed*187.0),cos(aSeed*113.0)) * (0.015+edge*0.15) * loose;
  p.z = (p.z + sin(p.x*3.7+p.y*4.0)*0.16 + cos(p.y*7.0)*0.06) * loose;
  float ax = (0.52 + uPointer.y*0.18 + sin(uTime*0.3)*0.025) * loose;
  float ay = (-0.3 + uPointer.x*0.3) * loose;
  float az = -0.12 * loose;
  p.yz = mat2(cos(ax),-sin(ax),sin(ax),cos(ax)) * p.yz;
  p.xz = mat2(cos(ay),-sin(ay),sin(ay),cos(ay)) * p.xz;
  p.xy = mat2(cos(az),-sin(az),sin(az),cos(az)) * p.xy;
  p.y += sin(uTime*0.6)*0.018*loose;
  float perspective = 2.5 / (2.5-p.z);
  gl_Position = vec4(p.x*0.91*perspective,p.y*0.91*uAspect*perspective,0.0,1.0);
  gl_PointSize = mix(3.6,1.7,uMorph)*uDpr*perspective;
  vColor = aColor * mix(0.62,1.0,uMorph);
  vAlpha = mix((1.0-edge*0.82)*0.86,1.0,uMorph);
}
`;
const fragment = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float r = length(gl_PointCoord-vec2(0.5))*2.0;
  float alpha = exp(-r*r*1.8)*vAlpha;
  if (r>1.0) discard;
  gl_FragColor = vec4(vColor,alpha);
}
`;

export default function ParticleSurface({ morph, paused, onReady, onFailure }: { morph:number; paused:boolean; onReady:(points:number)=>void; onFailure:()=>void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const input = useRef({morph, paused});
  input.current = {morph, paused};
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', {alpha:true, antialias:false, powerPreference:'low-power'});
    if (!gl) { onFailure(); return; }
    let gone=false, raf=0, inView=true, ready=false, last=0, clock=0, smoothed=0,dragging=false;
    let width=0, height=0;
    const pointer={x:0,y:0}, target={x:0,y:0};
    const shaders:WebGLShader[]=[];
    const buffers:WebGLBuffer[]=[];
    const shader=(type:number, source:string) => {
      const s=gl.createShader(type);
      if(!s) throw new Error('Shader unavailable');
      shaders.push(s); gl.shaderSource(s,source); gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error('Shader failed');
      return s;
    };
    const program=gl.createProgram();
    if(!program) {onFailure();return;}
    try { gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex)); gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment)); gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error('Program failed');
    } catch {onFailure(); shaders.forEach(s=>gl.deleteShader(s));gl.deleteProgram(program);return;}
    gl.useProgram(program);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    const uniforms=Object.fromEntries(['uMorph','uTime','uAspect','uDpr','uPointer'].map(n=>[n,gl.getUniformLocation(program,n)]));
    const mobile=window.matchMedia('(max-width:760px), (pointer:coarse)').matches;
    const dpr=Math.min(window.devicePixelRatio||1,mobile?1.5:2);
    const nx=mobile?115:205, ny=Math.round(nx*1704/2800);
    let count=0;
    const attribute=(name:string, data:number[],size:number) => {
      const buffer=gl.createBuffer(); if(!buffer) return;
      buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
      const loc=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,0,0);
    };
    const draw=(time:number) => {
      raf=0;
      if(gone||!ready||!inView||document.hidden) return;
      const dt=last?Math.min(time-last,60):16;last=time;
      const changed=Math.abs(smoothed-input.current.morph)>.001;
      if(!input.current.paused) clock+=dt/1000;
      smoothed += (input.current.morph-smoothed)*Math.min(dt/120,1);
      pointer.x+=(target.x-pointer.x)*.08;pointer.y+=(target.y-pointer.y)*.08;
      const rect=canvas.getBoundingClientRect();
      const w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);
      if(w!==width||h!==height){width=w;height=h;canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);}
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uniforms.uMorph,smoothed);gl.uniform1f(uniforms.uTime,clock);gl.uniform1f(uniforms.uAspect,width/Math.max(height,1));
      gl.uniform1f(uniforms.uDpr,dpr);gl.uniform2f(uniforms.uPointer,pointer.x,pointer.y);
      gl.drawArrays(gl.POINTS,0,count);
      canvas.dataset.points=String(count);
      // A sleeping loop is woken by controls, scroll, resize or visibility.
      if(!input.current.paused||changed) raf=requestAnimationFrame(draw);
    };
    const wake=()=>{if(!raf&&ready&&!gone)raf=requestAnimationFrame(draw)};
    const move=(e:PointerEvent)=>{if(e.pointerType==='touch'&&!dragging)return;const r=canvas.getBoundingClientRect(),gain=dragging?1.65:1;target.x=Math.max(-.8,Math.min(.8,((e.clientX-r.left)/r.width-.5)*gain));target.y=Math.max(-.8,Math.min(.8,((e.clientY-r.top)/r.height-.5)*gain));canvas.dataset.interaction=dragging?'drag':'pointer';wake()};
    const down=(e:PointerEvent)=>{dragging=true;canvas.setPointerCapture(e.pointerId);move(e)};
    const up=(e:PointerEvent)=>{dragging=false;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId)};
    const leave=()=>{if(!dragging){target.x=0;target.y=0;wake()}};
    const observer=new IntersectionObserver(([e])=>{inView=e.isIntersecting;if(inView)wake();else{cancelAnimationFrame(raf);raf=0;}});
    observer.observe(canvas);
    const resize=new ResizeObserver(wake);resize.observe(canvas);
    const source=new Image();source.src='/projects/rfpi/m24-visible-640.webp';
    source.onload=()=>{
      if(gone)return;
      try {
        const sample=document.createElement('canvas');sample.width=nx;sample.height=ny;
        const ctx=sample.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('No image context');
        ctx.drawImage(source,0,0,nx,ny);const data=ctx.getImageData(0,0,nx,ny).data;
        const positions:number[]=[],colors:number[]=[],seeds:number[]=[];
        for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
          const i=(y*nx+x)*4,r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255;
          positions.push((x/(nx-1)-.5)*2,(.5-y/(ny-1))*2*(1704/2800),((r+g+b)/3-.45)*.33);
          colors.push(r,g,b);seeds.push(((x*73+y*179)%997)/997);
        }
        count=nx*ny;attribute('aPosition',positions,3);attribute('aColor',colors,3);attribute('aSeed',seeds,1);
        ready=true;onReady(count);wake();
      } catch {onFailure();}
    };
    source.onerror=onFailure;
    const lost=(e:Event)=>{e.preventDefault();onFailure();cancelAnimationFrame(raf);raf=0};
    canvas.addEventListener('webglcontextlost',lost);
    canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);canvas.addEventListener('pointerleave',leave);
    window.addEventListener('scroll',wake,{passive:true});window.addEventListener('rfpi-render',wake);
    document.addEventListener('visibilitychange',wake);
    return ()=>{gone=true;cancelAnimationFrame(raf);observer.disconnect();resize.disconnect();canvas.removeEventListener('webglcontextlost',lost);canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);canvas.removeEventListener('pointerleave',leave);window.removeEventListener('scroll',wake);window.removeEventListener('rfpi-render',wake);document.removeEventListener('visibilitychange',wake);buffers.forEach(b=>gl.deleteBuffer(b));shaders.forEach(s=>gl.deleteShader(s));gl.deleteProgram(program);};
  },[onReady,onFailure]);
  useEffect(()=>{window.dispatchEvent(new Event('rfpi-render'))},[morph,paused]);
  return <canvas ref={ref} aria-hidden="true" style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'pan-y'}} />;
}
