import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {SparkRenderer,SplatMesh} from '@sparkjsdev/spark';

export type GaussianOptions={grid?:boolean;background?:string;interactive?:boolean;camera?:[number,number,number];target?:[number,number,number];fov?:number};

export async function mountGaussian(container:HTMLDivElement,initialPass:string,onStatus:(text:string)=>void,options:GaussianOptions={}){
  const {grid:showGrid=true,background='#111512',interactive=true,camera:camPos=[.4,-1.7,6.4],target=[0,0,-.15],fov=46}=options;
  const renderer=new THREE.WebGLRenderer({antialias:false,alpha:false,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  renderer.setClearColor(background);
  container.appendChild(renderer.domElement);
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(fov,1,.01,100);
  camera.position.set(...camPos);camera.up.set(0,1,0);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.target.set(...target);controls.enableDamping=false;controls.enablePan=false;controls.enabled=interactive;
  controls.minDistance=1.8;controls.maxDistance=12;controls.zoomSpeed=.5;
  // Single-finger vertical movement stays available for page scrolling on mobile.
  controls.touches.ONE=THREE.TOUCH.ROTATE;controls.touches.TWO=THREE.TOUCH.DOLLY_PAN;
  let disposed=false,visible=true,frame=0,version=0,mesh:SplatMesh|null=null;
  function draw(){frame=0;if(disposed||!visible||document.hidden)return;renderer.render(scene,camera);container.dataset.draws=String(Number(container.dataset.draws||0)+1);}
  function invalidate(){if(!disposed&&visible&&!document.hidden&&!frame)frame=requestAnimationFrame(draw);}
  const spark=new SparkRenderer({renderer,onDirty:invalidate,enableLod:false,minSortIntervalMs:30,maxStdDev:Math.sqrt(8)});
  scene.add(spark);
  function enu(lon:number,lat:number){
    const la=lat*Math.PI/180,lo=lon*Math.PI/180,l0=-106*Math.PI/180,p0=42*Math.PI/180,R=6.3710088;
    const point=new THREE.Vector3(R*Math.cos(la)*Math.cos(lo),R*Math.cos(la)*Math.sin(lo),R*Math.sin(la));
    const origin=new THREE.Vector3(R*Math.cos(p0)*Math.cos(l0),R*Math.cos(p0)*Math.sin(l0),R*Math.sin(p0));point.sub(origin);
    return new THREE.Vector3(point.dot(new THREE.Vector3(-Math.sin(l0),Math.cos(l0),0)),point.dot(new THREE.Vector3(-Math.sin(p0)*Math.cos(l0),-Math.sin(p0)*Math.sin(l0),Math.cos(p0))),point.dot(new THREE.Vector3(Math.cos(p0)*Math.cos(l0),Math.cos(p0)*Math.sin(l0),Math.sin(p0))));
  }
  const gridMaterial=new THREE.LineBasicMaterial({color:'#7895ad',transparent:true,opacity:.24});
  const grid:THREE.BufferGeometry[]=[];
  if(showGrid)for(let lat=25;lat<=60;lat+=5){const geometry=new THREE.BufferGeometry().setFromPoints(Array.from({length:101},(_,i)=>enu(-132+i*.52,lat)));grid.push(geometry);scene.add(new THREE.Line(geometry,gridMaterial));}
  if(showGrid)for(let lon=-130;lon<=-80;lon+=10){const geometry=new THREE.BufferGeometry().setFromPoints(Array.from({length:71},(_,i)=>enu(lon,25+i*.5)));grid.push(geometry);scene.add(new THREE.Line(geometry,gridMaterial));}
  function resize(){const box=container.getBoundingClientRect();renderer.setSize(box.width,box.height);camera.aspect=box.width/box.height;camera.updateProjectionMatrix();invalidate();}
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(container);
  const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)invalidate();else if(frame){cancelAnimationFrame(frame);frame=0;}},{threshold:0});intersection.observe(container);
  const visibility=()=>{if(!document.hidden)invalidate();};document.addEventListener('visibilitychange',visibility);
  controls.addEventListener('change',invalidate);resize();controls.update();
  async function load(pass:string){
    const own=++version;onStatus('Loading Gaussian splats…');
    const mobile=matchMedia('(max-width:760px)').matches;
    const candidate=new SplatMesh({url:`/projects/rfpi/gaussian/${pass}-earth${mobile?'-mobile':''}.splat`,enableLod:false,raycastable:false});
    try{await candidate.initialized;}catch(error){candidate.dispose();throw error;}
    if(disposed||own!==version){candidate.dispose();return;}
    if(mesh){scene.remove(mesh);mesh.dispose();}mesh=candidate;scene.add(mesh);
    container.dataset.splats=String(mesh.numSplats);container.dataset.pass=pass;
    onStatus(`${mesh.numSplats.toLocaleString('en-US')} Gaussian splats · ${mobile?'mobile':'full'} sample set`);invalidate();
  }
  const api={
    load,
    reset(){camera.position.set(...camPos);controls.target.set(...target);controls.update();invalidate();},
    // Absolute pose from a yaw offset (radians) and distance multiplier around the configured view; used by the hero's pointer parallax.
    pose(yaw:number,pitch:number,distance:number){const base=new THREE.Vector3(...camPos).sub(new THREE.Vector3(...target));base.multiplyScalar(distance).applyAxisAngle(new THREE.Vector3(1,0,0),pitch).applyAxisAngle(new THREE.Vector3(0,1,0),yaw);camera.position.copy(controls.target).add(base);camera.lookAt(controls.target);invalidate();},
    rotate(direction:number){camera.position.sub(controls.target).applyAxisAngle(new THREE.Vector3(0,1,0),direction*Math.PI/9).add(controls.target);controls.update();invalidate();},
    zoom(factor:number){const offset=camera.position.clone().sub(controls.target);offset.setLength(Math.max(controls.minDistance,Math.min(controls.maxDistance,offset.length()*factor)));camera.position.copy(controls.target).add(offset);controls.update();invalidate();},
    dispose(){disposed=true;version++;cancelAnimationFrame(frame);controls.dispose();resizeObserver.disconnect();intersection.disconnect();document.removeEventListener('visibilitychange',visibility);mesh?.dispose();spark.dispose();grid.forEach(g=>g.dispose());gridMaterial.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}
  };
  try{await load(initialPass);}catch(error){api.dispose();throw error;}
  return api;
}
