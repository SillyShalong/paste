// Tray icon redesign candidates — review only, not wired into the app.
const { deflateSync } = require("node:zlib");
const fs = require("fs");
const path = require("path");
const outDir = __dirname;

function crc32(buf){let t=crc32.t;if(!t){t=crc32.t=new Int32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c;}}let c=0xffffffff;for(let i=0;i<buf.length;i++)c=t[(c^buf[i])&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type,"ascii"),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body));return Buffer.concat([len,body,crc]);}
function encodePng(w,h,rgba){const sig=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;rgba.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);}return Buffer.concat([sig,chunk("IHDR",ihdr),chunk("IDAT",deflateSync(raw,{level:9})),chunk("IEND",Buffer.alloc(0))]);}

const sd=(x,y,cx,cy,hw,hh,r)=>{const qx=Math.abs(x-cx)-(hw-r),qy=Math.abs(y-cy)-(hh-r);const ax=Math.max(qx,0),ay=Math.max(qy,0);return Math.hypot(ax,ay)+Math.min(Math.max(qx,qy),0)-r;};
const cov=(buf,i,[r,g,b],a)=>{if(a<=0)return;buf[i]=Math.round(r*a+buf[i]*(1-a));buf[i+1]=Math.round(g*a+buf[i+1]*(1-a));buf[i+2]=Math.round(b*a+buf[i+2]*(1-a));buf[i+3]=Math.round(255*Math.min(1,a+buf[i+3]/255));};

// classic indigo->violet gradient tile
function tile(size, glyph) {
  const rgba = Buffer.alloc(size*size*4);
  const s = size/64, half = size/2;
  const bg = (x,y)=>{const t=Math.min(1,Math.max(0,(x+y)/(size*2)));return [0x4f+(0x93-0x4f)*t, 0x46+(0x33-0x46)*t, 0xe5+(0xea-0xe5)*t];};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4, px=x+0.5, py=y+0.5;
    const d=sd(px,py,half,half,half-1.5*s,half-1.5*s,12*s);
    const a=Math.min(1,Math.max(0,0.5-d));
    if(a<=0){rgba[i+3]=0;continue;}
    const [r,g,b]=bg(px,py);
    rgba[i]=Math.round(r);rgba[i+1]=Math.round(g);rgba[i+2]=Math.round(b);rgba[i+3]=Math.round(a*255);
    glyph(px,py,s,size,bg,(c,al)=>cov(rgba,i,c,al));
  }
  return encodePng(size,size,rgba);
}

const W=(c)=>c; // shorthand

// A: solid clipboard, tab inset INSIDE the body (no protrusion = no bottle)
const A=(px,py,s,size,bg,set)=>{const h=size/2;
  const dBody=sd(px,py,h,h+1*s,15*s,20*s,5*s);
  const aBody=Math.min(1,Math.max(0,0.5-dBody));
  set([255,255,255],aBody);
  // inset tab: bg-colored bar near the top, fully inside the body
  const dTab=sd(px,py,h,h-13*s,8*s,2.6*s,1.3*s);
  set(bg(px,py),Math.min(1,Math.max(0,0.5-dTab))*aBody);
  // three content lines
  for(const [cy,hw] of [[h-2*s,7.5*s],[h+5*s,7.5*s],[h+12*s,5*s]]){
    const dL=sd(px,py,h,cy,hw,1.6*s,0.8*s);
    set(bg(px,py),Math.min(1,Math.max(0,0.5-dL))*aBody);
  }
};

// B: layered cards (copy metaphor)
const B=(px,py,s,size,bg,set)=>{const h=size/2;
  // back card (up-right), slightly transparent white
  const dBack=sd(px,py,h+6*s,h-5*s,13*s,16*s,4*s);
  set([255,255,255],Math.min(1,Math.max(0,0.5-dBack))*0.55);
  // front card (down-left), solid white
  const dFront=sd(px,py,h-3*s,h+3*s,13*s,16*s,4*s);
  const aFront=Math.min(1,Math.max(0,0.5-dFront));
  set([255,255,255],aFront);
  for(const cy of [h-2*s,h+4*s,h+10*s]){
    const dL=sd(px,py,h-3*s,cy,7*s,1.5*s,0.75*s);
    set(bg(px,py),Math.min(1,Math.max(0,0.5-dL))*aFront);
  }
};

// C: bold P monogram
const C=(px,py,s,size,bg,set)=>{const h=size/2;
  const dStem=sd(px,py,h-8*s,h,5*s,17*s,2.5*s);
  set([255,255,255],Math.min(1,Math.max(0,0.5-dStem)));
  // bowl: ring clipped to right-upper area
  const dist=Math.hypot(px-(h+3*s),py-(h-9*s));
  const dRing=Math.abs(dist-10*s)-4.2*s;
  let a=Math.min(1,Math.max(0,0.5-dRing));
  // keep only the bowl part (clip: left edge of bowl >= stem right side, top half)
  if(px < h-6*s-2*s) a=0;
  if(py > h+2*s) a=0;
  set([255,255,255],a);
};

// D: outline clipboard (stroke style, tab notch integrated)
const D=(px,py,s,size,bg,set)=>{const h=size/2;
  const dBody=sd(px,py,h,h+1*s,16*s,20*s,5*s);
  const ring=Math.abs(dBody)-2.6*s;
  const aBody=Math.min(1,Math.max(0,0.5-ring));
  set([255,255,255],aBody);
  // tab: solid white notch bridging the top border (no protrusion above)
  const dTab=sd(px,py,h,h-20*s,7*s,3*s,1.5*s);
  set([255,255,255],Math.min(1,Math.max(0,0.5-dTab)));
  // two content lines
  for(const cy of [h-3*s,h+4*s]){
    const dL=sd(px,py,h,cy,8*s,1.8*s,0.9*s);
    set([255,255,255],Math.min(1,Math.max(0,0.5-dL)));
  }
};

const designs = { A_inset_tab: A, B_layered_cards: B, C_p_monogram: C, D_outline_clipboard: D };
const files = {};
for (const [name, glyph] of Object.entries(designs)) {
  files[name] = tile(64, glyph);
  fs.writeFileSync(path.join(outDir, name + ".png"), files[name]);
}

// contact sheet: two rows (dark/light bg) x four designs at 64px, plus 16px row
const names = Object.keys(designs);
const size=64, pad=14, label=26;
const W2 = pad + names.length*(size+pad), H2 = pad*2 + (size+pad)*2 + 16 + label;
function sheet(bgRGB, out){
  const canvas = Buffer.alloc(W2*H2*4);
  canvas.fill(bgRGB[0],0,canvas.length);canvas.fill(bgRGB[1],1,canvas.length);canvas.fill(bgRGB[2],2,canvas.length);canvas.fill(255,3,canvas.length,4);
  const { inflateSync } = require("node:zlib");
  function readPx(file){const png=fs.readFileSync(file);let off=8,idat=[];while(off<png.length){const len=png.readUInt32BE(off);const t=png.toString("ascii",off+4,off+8);if(t==="IDAT")idat.push(png.subarray(off+8,off+8+len));off+=12+len;}return inflateSync(Buffer.concat(idat));}
  names.forEach((n,idx)=>{
    const raw=readPx(path.join(outDir,n+".png"));
    const ox=pad+idx*(size+pad);
    for(let row=0;row<2;row++){
      const oy=pad+row*(size+pad);
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const si=y*(size*4+1)+1+x*4, di=((oy+y)*W2+ox+x)*4;
        canvas[di]=raw[si];canvas[di+1]=raw[si+1];canvas[di+2]=raw[si+2];
        canvas[di+3]=Math.max(canvas[di+3],raw[si+3]);
      }
    }
    // 16px readability row (nearest-neighbor downscale)
    const small=8;
    fs.writeFileSync(path.join(outDir,n+"-16.png"), (()=>{ return encodePng(16,16,(()=>{const b=Buffer.alloc(16*16*4);for(let y=0;y<16;y++)for(let x=0;x<16;x++){const sx=Math.min(63,Math.floor(x*4));const sy=Math.min(63,Math.floor(y*4));const si=sy*(size*4+1)+1+sx*4;const di=(y*16+x)*4;b[di]=raw[si];b[di+1]=raw[si+1];b[di+2]=raw[si+2];b[di+3]=raw[si+3];}return b;})()); })());
    const raw16=readPx(path.join(outDir,n+"-16.png"));
    const oy3=pad*2+(size+pad)*2;
    for(let y=0;y<16;y++)for(let x=0;x<16;x++){
      const si=y*(16*4+1)+1+x*4, di=((oy3+y)+0)*W2*4 + (ox+x)*4;
      const base=(oy3+y)*W2*4+(ox+x)*4;
      canvas[base]=raw16[si];canvas[base+1]=raw16[si+1];canvas[base+2]=raw16[si+2];
      canvas[base+3]=Math.max(canvas[base+3],raw16[si+3]);
    }
  });
  const rawRows=(()=>{const r=Buffer.alloc((W2*4+1)*H2);for(let y=0;y<H2;y++){r[y*(W2*4+1)]=0;canvas.copy(r,y*(W2*4+1)+1,y*W2*4,(y+1)*W2*4);}return r;})();
  fs.writeFileSync(out, Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk("IHDR",(()=>{const b=Buffer.alloc(13);b.writeUInt32BE(W2,0);b.writeUInt32BE(H2,4);b[8]=8;b[9]=6;return b;})()),
    chunk("IDAT",deflateSync(rawRows,{level:9})),
    chunk("IEND",Buffer.alloc(0)),
  ]));
}
sheet([22,22,26], path.join(outDir, "preview-dark.png"));
sheet([240,240,244], path.join(outDir, "preview-light.png"));
console.log("design candidates written:", names.join(", "));
