import { OPEN, ROCK } from './navigation.js';
const TILE = 16;
const COLORS = { explore:'#e4b65e', return:'#cbb26c', share:'#83bca9', nurse:'#bdace6', soil:'#ce8862', rest:'#969b80', forage:'#e4b65e', dig:'#ce8862', feed:'#bdace6', feedQueen:'#bdace6', transport:'#bdace6', clean:'#83bca9', eat:'#d9cd94', eatLoose:'#d9cd94', idle:'#969b80', relocate:'#e3d39a' };
function noise(i) { const n = Math.sin(i * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); }

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.terrain = document.createElement('canvas');
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.layer = 'none';
    this.worldVersion = -1;
    this.selected = null;
    this.following = true;
    this.resize();
  }
  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
  }
  center(sim) {
    const w = sim.world;
    const p = w.center(w.chamber - w.width * 5);
    this.camera.zoom = Math.max(.5, Math.min(1.4, this.width / (w.width * TILE * .92)));
    this.camera.x = p.x * TILE - this.width / this.camera.zoom * .57;
    this.camera.y = p.y * TILE - this.height / this.camera.zoom * .51;
    this.following = true;
  }
  point(x, y) { return { x: (x / this.camera.zoom + this.camera.x) / TILE, y: (y / this.camera.zoom + this.camera.y) / TILE }; }
  zoomAt(x, y, scale) {
    const p = this.point(x, y);
    this.camera.zoom = Math.max(.28, Math.min(5, this.camera.zoom * scale));
    this.camera.x = p.x * TILE - x / this.camera.zoom;
    this.camera.y = p.y * TILE - y / this.camera.zoom;
    this.following = false;
  }
  rebuild(w) {
    this.terrain.width = w.width * TILE;
    this.terrain.height = w.height * TILE;
    const c = this.terrain.getContext('2d');
    for (let i = 0; i < w.grid.length; i++) {
      const x = i % w.width * TILE, y = Math.floor(i / w.width) * TILE;
      const surface = y < w.surface * TILE;
      const n = noise(i);
      c.fillStyle = w.grid[i] === ROCK ? '#253026' : w.grid[i] === OPEN
        ? (surface ? `hsl(${94+n*13} 22% ${24+n*4}%)` : `hsl(31 25% ${30+n*4}%)`)
        : `hsl(28 24% ${18+n*4}%)`;
      c.fillRect(x, y, TILE, TILE);
      c.fillStyle = surface ? '#a3b47618' : '#c49c6b14';
      const specks = surface ? 3 : 2;
      for (let s = 0; s < specks; s++) c.fillRect(x + noise(i+s*17)*13, y + noise(i+s*33)*13, 1+(s%2), surface ? 3 : 1);
      if (!surface && w.grid[i] === OPEN) {
        c.fillStyle = '#20180e55';
        if (w.grid[i - w.width] !== OPEN) c.fillRect(x, y, TILE, 3);
        if (w.grid[i - 1] !== OPEN) c.fillRect(x, y, 2, TILE);
      }
    }
    c.fillStyle = '#b6b47f4d';c.fillRect(TILE, w.surface*TILE-2, (w.width-2)*TILE, 2);
    this.worldVersion = w.version;
    this.worldRef = w;
  }
  drawAnt(a, selected) {
    const c = this.ctx, queen = a.type === 'queen';
    c.save(); c.translate(a.x*TILE, a.y*TILE); c.rotate(a.angle);
    const scale = queen ? 1.55 : .85;
    c.scale(scale, scale);
    if (this.layer === 'tasks' || selected) {
      c.fillStyle = selected ? '#f2e6bc55' : (COLORS[a.task?.kind] || '#aab391')+'44';
      c.beginPath(); c.arc(0,0,8,0,Math.PI*2); c.fill();
    }
    c.strokeStyle = queen ? '#201812' : '#191b13'; c.lineWidth = 1.1; c.lineCap = 'round';
    for (let side of [-1,1]) for (let leg=0;leg<3;leg++) {
      const stride = a.task?.path.length > a.task?.cursor ? Math.sin(a.distance*5+leg*2+side)*1.4 : .1;
      c.beginPath(); c.moveTo(leg*2-2, side*1.2);
      c.lineTo(leg*3-3+stride, side*4.4);
      c.lineTo(leg*4-4-stride, side*6.2);c.stroke();
    }
    c.fillStyle='#0003';c.beginPath();c.ellipse(-1,2,7,2.8,0,0,Math.PI*2);c.fill();
    c.fillStyle=queen?'#443021':'#28261b';c.beginPath();c.ellipse(-3.6,0,3.9,2.6,0,0,Math.PI*2);c.fill();
    c.fillStyle=queen?'#a07842':'#645334';c.beginPath();c.ellipse(1,0,2.4,1.6,0,0,Math.PI*2);c.fill();
    c.fillStyle=queen?'#bb9253':'#8c7148';c.beginPath();c.arc(4,0,1.9,0,Math.PI*2);c.fill();
    c.strokeStyle='#352819';c.lineWidth=.7;
    for(const side of [-1,1]) {c.beginPath();c.moveTo(4.5,side);c.lineTo(7,side*2.4);c.lineTo(8.4,side*3.1);c.stroke();}
    if (a.soil>0) {c.fillStyle='#ebcf85';c.beginPath();c.ellipse(8,0,2.2,1.5,.2,0,Math.PI*2);c.fill();}
    if (a.task?.kind === 'clean' && a.task.phase === 'dump') {c.fillStyle='#88816a';c.fillRect(6,-2,3,3);}
    if (a.carryingBrood!==null) {c.fillStyle='#f0ddbc';c.beginPath();c.ellipse(8,0,2.8,1.7,0,0,Math.PI*2);c.fill();}
    c.restore();
  }
  draw(sim) {
    const c=this.ctx,w=sim.world,cam=this.camera;
    if (this.worldVersion!==w.version || this.worldRef!==w) this.rebuild(w);
    c.setTransform(this.dpr,0,0,this.dpr,0,0);
    c.fillStyle='#15251c';c.fillRect(0,0,this.width,this.height);
    c.scale(cam.zoom,cam.zoom);c.translate(-cam.x,-cam.y);
    c.drawImage(this.terrain,0,0);
    const left=Math.max(0,Math.floor(cam.x/TILE)),right=Math.min(w.width,Math.ceil((cam.x+this.width/cam.zoom)/TILE));
    const top=Math.max(0,Math.floor(cam.y/TILE)),bottom=Math.min(w.height,Math.ceil((cam.y+this.height/cam.zoom)/TILE));
    for(let y=top;y<bottom;y++) for(let x=left;x<right;x++) {
      const i=w.index(x,y),px=x*TILE,py=y*TILE;
      if(w.food[i]>.05 || w.protein[i]>.05) {
        const amount=(w.food[i]+w.protein[i])/50;
        for(let s=0;s<Math.min(7,Math.ceil(amount));s++) {
          c.fillStyle=w.protein[i]>0?'#ce9275':'#cfb369';
          c.beginPath();c.ellipse(px+3+noise(i+s*11)*10,py+3+noise(i+s*7)*10,1.7,1,noise(s+i)*3,0,Math.PI*2);c.fill();
        }
      }
      if(w.depositedSoil[i]>0) {c.fillStyle='#8d8b6d';c.fillRect(px+6,py+6,Math.min(6,w.depositedSoil[i]*3),2);}
      const field=this.layer==='food'?w.trail:null;
      if(field && field[i]>.001 && w.grid[i]===OPEN) {
        c.fillStyle=`rgba(230,180,77,${Math.min(.65,field[i])})`;
        c.fillRect(px,py,TILE,TILE);
      }
    }
    for(const b of sim.brood) {
      if(b.carrier!==null) continue;
      const p=w.center(b.cell);c.fillStyle=b.stage==='egg'?'#f7ebd0':b.stage==='larva'?'#e2d4b2':'#ba9c6c';
      c.beginPath();c.ellipse(p.x*TILE+(b.id%3-1)*3,p.y*TILE, b.stage==='egg'?2:3.4,b.stage==='larva'?1.8:2.2,.5,0,Math.PI*2);c.fill();
    }
    for(const corpse of sim.corpses) {const p=w.center(corpse.cell);c.fillStyle='#24271e';c.fillRect(p.x*TILE-4,p.y*TILE-2,8,3);}
    for(const a of sim.ants) {
      if (this.layer==='tasks' && a.task) {
        c.strokeStyle=(COLORS[a.task.kind]||'#ccc')+'55';c.lineWidth=.65;c.beginPath();c.moveTo(a.x*TILE,a.y*TILE);
        for(const i of a.task.path.slice(a.task.cursor)) {const p=w.center(i);c.lineTo(p.x*TILE,p.y*TILE);}c.stroke();
      }
      this.drawAnt(a,this.selected===a.id);
    }
    c.fillStyle='#cad8ac';c.font='9px system-ui';c.letterSpacing='1px';
    const entrance=w.center(w.entrance);c.fillText('NEST ENTRANCE',entrance.x*TILE-38,(w.surface-2.7)*TILE);
    
    c.setTransform(this.dpr,0,0,this.dpr,0,0);
    const vignette=c.createRadialGradient(this.width*.55,this.height*.48,this.height*.2,this.width*.5,this.height*.5,this.width*.8);
    vignette.addColorStop(0,'#0000');vignette.addColorStop(1,'#07120c70');c.fillStyle=vignette;c.fillRect(0,0,this.width,this.height);
  }
}
