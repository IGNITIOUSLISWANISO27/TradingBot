/* Signal engine shared by the bot page and the alert checker.
   Copied from signal_desk.html. If you update the bot, copy this file too
   (the bot's Alerts tab explains how). */
/* ============ Pure core: structure concepts, rules, parser, backtest, Pine export (no DOM) ============ */
const TFS=[["1m",60],["5m",300],["15m",900],["1h",3600],["4h",14400],["1d",86400]];
const OPTXT={xa:"crosses above",xb:"crosses below",gt:"is above",lt:"is below",rising:"is rising",falling:"is falling",on:""};
const OP_KEYS=Object.keys(OPTXT);
/* Concept events (fire on one candle) and states (true while they hold). */
const EVENTS={
  fvgbull:{label:"Price taps a bullish fair value gap",stop:1},
  fvgbear:{label:"Price taps a bearish fair value gap",stop:1},
  obbull:{label:"Price retests a bullish order block",stop:1},
  obbear:{label:"Price retests a bearish order block",stop:1},
  pdbull:{label:"Price taps a bullish FVG or order block",stop:1},
  pdbear:{label:"Price taps a bearish FVG or order block",stop:1},
  fibbull:{label:"Price bounces in the 0.5–0.618 Fibonacci zone of an up leg",stop:1},
  fibbear:{label:"Price rejects the 0.5–0.618 Fibonacci zone of a down leg",stop:1},
  srbull:{label:"Price rejects a support level",stop:1},
  srbear:{label:"Price rejects a resistance level",stop:1},
  bosup:{label:"Break of structure up (close above the last swing high)",stop:1},
  bosdown:{label:"Break of structure down (close below the last swing low)",stop:1},
  trendup:{label:"Market structure is bullish"},
  trenddown:{label:"Market structure is bearish"},
  gzbull:{label:"Price is in the golden zone (0.5–0.786) of an up leg"},
  gzbear:{label:"Price is in the golden zone (0.5–0.786) of a down leg"},
  atsup:{label:"Price is at a support level"},
  atres:{label:"Price is at a resistance level"},
};
const CONCEPT_KEYS=Object.keys(EVENTS);
const T_KEYS=["close","open","high","low","num",...CONCEPT_KEYS];
const SWING=3;

function atr(B,n){const out=new Array(B.length).fill(NaN);let a=NaN,s=0;for(let i=1;i<B.length;i++){const tr=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));if(i<=n){s+=tr;if(i===n){a=s/n;out[i]=a}}else{a=(a*(n-1)+tr)/n;out[i]=a}}return out}
const minNa=(a,b)=>isNaN(a)?b:isNaN(b)?a:Math.min(a,b);
const maxNa=(a,b)=>isNaN(a)?b:isNaN(b)?a:Math.max(a,b);

/* Walks the candles in order, using only what was known at each candle. */
function smc(B){
  const N=B.length,A=atr(B,14),L=SWING;
  const ev={},stp={};for(const k of CONCEPT_KEYS){ev[k]=new Array(N).fill(false);stp[k]=new Array(N).fill(NaN)}
  const zones=[],piv=[],swings=[];
  let lastSH=null,lastSL=null,shBroken=false,slBroken=false,trend=0,lastBos=null;
  let fvgB=null,fvgS=null,obB=null,obS=null,leg=null;
  const startZone=(old,z,i)=>{if(old&&old.i1==null){old.i1=i;old.replaced=true}zones.push(z);return z};
  for(let i=0;i<N;i++){
    const b=B[i],a=A[i],k=i-L;
    // 1. swing points, confirmed L candles later
    if(k>=L){
      let isH=true,isL=true;
      for(let j=k-L;j<=k+L;j++){if(j===k)continue;if(B[j].h>=B[k].h)isH=false;if(B[j].l<=B[k].l)isL=false}
      if(isH){lastSH={i:k,p:B[k].h};shBroken=false;piv.push(B[k].h);swings.push({i:k,p:B[k].h,hi:true})}
      if(isL){lastSL={i:k,p:B[k].l};slBroken=false;piv.push(B[k].l);swings.push({i:k,p:B[k].l,hi:false})}
      while(piv.length>30)piv.shift();
    }
    // 2. break of structure → order block and new Fibonacci leg
    if(lastSH&&!shBroken&&b.c>lastSH.p){
      shBroken=true;trend=1;ev.bosup[i]=true;lastBos={dir:1,i,p:lastSH.p};
      for(let j=i;j>=Math.max(0,i-10);j--)if(B[j].c<B[j].o){obB=startZone(obB,{kind:"ob",dir:1,top:B[j].h,bot:B[j].l,i0:j,born:i,i1:null},i);break}
      const from=Math.max(lastSL?lastSL.i:i-20,0,i-300);let lo=Infinity,iLo=i;for(let j=from;j<=i;j++)if(B[j].l<lo){lo=B[j].l;iLo=j}
      leg={dir:1,lo,hi:b.h,iLo,iHi:i,used:false,touched:false,alive:true};stp.bosup[i]=lo;
    }
    if(lastSL&&!slBroken&&b.c<lastSL.p){
      slBroken=true;trend=-1;ev.bosdown[i]=true;lastBos={dir:-1,i,p:lastSL.p};
      for(let j=i;j>=Math.max(0,i-10);j--)if(B[j].c>B[j].o){obS=startZone(obS,{kind:"ob",dir:-1,top:B[j].h,bot:B[j].l,i0:j,born:i,i1:null},i);break}
      const from=Math.max(lastSH?lastSH.i:i-20,0,i-300);let hi=-Infinity,iHi=i;for(let j=from;j<=i;j++)if(B[j].h>hi){hi=B[j].h;iHi=j}
      leg={dir:-1,lo:b.l,hi,iLo:i,iHi,used:false,touched:false,alive:true};stp.bosdown[i]=hi;
    }
    // 3. fair value gaps (three-candle imbalance at least 0.1 ATR wide)
    if(i>=2&&isFinite(a)){
      if(b.l>B[i-2].h&&b.l-B[i-2].h>=0.1*a)fvgB=startZone(fvgB,{kind:"fvg",dir:1,top:b.l,bot:B[i-2].h,i0:i-1,born:i,i1:null},i);
      if(b.h<B[i-2].l&&B[i-2].l-b.h>=0.1*a)fvgS=startZone(fvgS,{kind:"fvg",dir:-1,top:B[i-2].l,bot:b.h,i0:i-1,born:i,i1:null},i);
    }
    // 4. first return into the latest zone: a tap signals, a close through it cancels it
    const tapBull=(z,key)=>{if(!z||z.i1!=null||z.born>=i)return;if(b.c<z.bot){z.i1=i;z.broken=true;return}if(b.l<=z.top){ev[key][i]=true;stp[key][i]=z.bot;z.tapped=true;z.i1=i}};
    const tapBear=(z,key)=>{if(!z||z.i1!=null||z.born>=i)return;if(b.c>z.top){z.i1=i;z.broken=true;return}if(b.h>=z.bot){ev[key][i]=true;stp[key][i]=z.top;z.tapped=true;z.i1=i}};
    tapBull(fvgB,"fvgbull");tapBull(obB,"obbull");tapBear(fvgS,"fvgbear");tapBear(obS,"obbear");
    ev.pdbull[i]=ev.fvgbull[i]||ev.obbull[i];stp.pdbull[i]=minNa(stp.fvgbull[i],stp.obbull[i]);
    ev.pdbear[i]=ev.fvgbear[i]||ev.obbear[i];stp.pdbear[i]=maxNa(stp.fvgbear[i],stp.obbear[i]);
    // 5. Fibonacci retracement of the latest impulse leg
    if(leg&&leg.alive){
      if(leg.dir===1){
        if(b.h>leg.hi&&!leg.touched){leg.hi=b.h;leg.iHi=i}
        const r=leg.hi-leg.lo,f50=leg.hi-.5*r,f618=leg.hi-.618*r,f786=leg.hi-.786*r;
        if(b.c<leg.lo){leg.alive=false;leg.end=i}
        else if(i>leg.iHi){
          if(b.l<=f50&&b.l>=f786){leg.touched=true;ev.gzbull[i]=true}
          if(!leg.used&&b.l<=f50&&b.c>=f618&&b.c>b.o){ev.fibbull[i]=true;stp.fibbull[i]=f786;leg.used=true}
        }
      }else{
        if(b.l<leg.lo&&!leg.touched){leg.lo=b.l;leg.iLo=i}
        const r=leg.hi-leg.lo,f50=leg.lo+.5*r,f618=leg.lo+.618*r,f786=leg.lo+.786*r;
        if(b.c>leg.hi){leg.alive=false;leg.end=i}
        else if(i>leg.iLo){
          if(b.h>=f50&&b.h<=f786){leg.touched=true;ev.gzbear[i]=true}
          if(!leg.used&&b.h>=f50&&b.c<=f618&&b.c<b.o){ev.fibbear[i]=true;stp.fibbear[i]=f786;leg.used=true}
        }
      }
    }
    // 6. support and resistance: swing prices touched at least twice (within 0.25 ATR)
    if(isFinite(a)){
      const tol=0.25*a;let sB=NaN,sS=NaN;
      for(const p of piv){
        let t=0;for(const q of piv)if(Math.abs(q-p)<=tol)t++;
        if(t<2)continue;
        if(b.l<=p+tol&&b.l>=p-1.5*tol&&b.c>p){ev.atsup[i]=true;if(b.c>b.o&&(isNaN(sB)||p-tol>sB))sB=p-tol}
        if(b.h>=p-tol&&b.h<=p+1.5*tol&&b.c<p){ev.atres[i]=true;if(b.c<b.o&&(isNaN(sS)||p+tol<sS))sS=p+tol}
      }
      if(!isNaN(sB)){ev.srbull[i]=true;stp.srbull[i]=sB}
      if(!isNaN(sS)){ev.srbear[i]=true;stp.srbear[i]=sS}
    }
    ev.trendup[i]=trend===1;ev.trenddown[i]=trend===-1;
  }
  // levels for display: swing prices grouped within 0.25 ATR, at least two touches
  const levels=[];const aL=A[N-1];
  if(isFinite(aL)){
    const tol=0.25*aL,ps=[...piv].sort((x,y)=>x-y);let g=[];
    const flush=()=>{if(g.length>=2)levels.push({price:g.reduce((s,v)=>s+v,0)/g.length,touches:g.length});g=[]};
    for(const p of ps){if(g.length&&p-g[0]>tol)flush();g.push(p)}flush();
  }
  return{ev,stp,zones,leg,levels,lastBos,trend,swings,atr:A};
}

function makeEngine(B){
  let R=null;const smcR=()=>R||(R=smc(B));
  const cache={};
  function series(o){
    if(EVENTS[o.t])return smcR().ev[o.t];
    if(o.t==="atr")return smcR().atr;
    if(cache[o.t])return cache[o.t];
    const k={close:"c",open:"o",high:"h",low:"l"}[o.t];
    return cache[o.t]=k?B.map(b=>b[k]):new Array(B.length).fill(NaN);
  }
  const val=(o,i)=>o.t==="num"?o.v:series(o)[i];
  function cond(c,i){
    if(c.op==="on")return!!series(c.a)[i];
    if(i<1)return false;
    const a=val(c.a,i),a1=val(c.a,i-1);
    if(!isFinite(a)||!isFinite(a1))return false;
    if(c.op==="rising")return a>a1;
    if(c.op==="falling")return a<a1;
    const b=val(c.b,i),b1=val(c.b,i-1);
    if(!isFinite(b)||!isFinite(b1))return false;
    switch(c.op){case"xa":return a1<=b1&&a>b;case"xb":return a1>=b1&&a<b;case"gt":return a>b;case"lt":return a<b}
    return false;
  }
  const stopAt=(c,i)=>c.op==="on"&&EVENTS[c.a.t]&&EVENTS[c.a.t].stop?smcR().stp[c.a.t][i]:NaN;
  function signals(st,last){
    const out=[];let pb=false,ps=false;
    for(let i=1;i<=last;i++){
      const b=st.buy.length>0&&st.buy.every(c=>cond(c,i));
      const s=st.sell.length>0&&st.sell.every(c=>cond(c,i));
      const fb=b&&!pb,fs=s&&!ps;
      if(fb&&!fs)out.push({i,dir:1,stop:st.buy.map(c=>stopAt(c,i)).reduce(minNa,NaN)});
      else if(fs&&!fb)out.push({i,dir:-1,stop:st.sell.map(c=>stopAt(c,i)).reduce(maxNa,NaN)});
      pb=b;ps=s;
    }
    return out;
  }
  return{series,val,cond,signals,smc:smcR};
}

function riskDist(r,price,a){return r.unit==="atr"?r.mult*a:r.unit==="pct"?price*r.mult/100:r.unit==="pts"?r.mult:1.5*a}
/* Stop and target for a trade entered at `entry`. Zone stops sit just beyond the signal's zone or level. */
function exitLevels(st,dir,entry,a,zoneStop){
  const sl=st.sl.unit==="zone"?(isFinite(zoneStop)?zoneStop-dir*st.sl.mult*a:entry-dir*1.5*a):entry-dir*riskDist(st.sl,entry,a);
  const risk=(entry-sl)*dir;if(!(risk>0)||!isFinite(risk))return null;
  const tp=st.tp.unit==="rr"?entry+dir*st.tp.mult*risk:entry+dir*riskDist(st.tp,entry,a);
  return{sl,tp,risk};
}

function backtest(B,eng,st,sigs,last,spread){
  const A=eng.series({t:"atr"});
  const at=new Map(sigs.map(s=>[s.i,s]));
  const trades=[];let pos=null,pEntry=null,pExit=false;
  const close=(px,i,why)=>{trades.push({dir:pos.dir,entry:pos.entry,exit:px,i0:pos.i,i1:i,why,pnl:(px-pos.entry)*pos.dir-spread});pos=null};
  for(let i=1;i<=last;i++){
    const b=B[i];
    if(pExit&&pos)close(b.o,i,"signal");
    pExit=false;
    if(pEntry&&!pos){const a=A[i-1];if(isFinite(a)){const lv=exitLevels(st,pEntry.dir,b.o,a,pEntry.stop);if(lv)pos={dir:pEntry.dir,entry:b.o,i,sl:lv.sl,tp:lv.tp}}}
    pEntry=null;
    if(pos){
      if(pos.dir===1){if(b.l<=pos.sl)close(pos.sl,i,"sl");else if(b.h>=pos.tp)close(pos.tp,i,"tp")}
      else{if(b.h>=pos.sl)close(pos.sl,i,"sl");else if(b.l<=pos.tp)close(pos.tp,i,"tp")}
    }
    const s=at.get(i);
    if(s){if(pos&&pos.dir!==s.dir){pExit=true;pEntry=s}else if(!pos)pEntry=s}
  }
  let eq=0,peak=0,dd=0,gw=0,gl=0,w=0;const curve=[0];
  for(const t of trades){eq+=t.pnl;curve.push(eq);peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);if(t.pnl>0){w++;gw+=t.pnl}else gl-=t.pnl}
  return{trades,n:trades.length,wins:w,winRate:trades.length?w/trades.length:NaN,net:eq,pf:gl>0?gw/gl:(gw>0?Infinity:NaN),dd,avg:trades.length?eq/trades.length:NaN,curve,open:pos};
}

/* ---------- labels ---------- */
function fmtN(v){return Math.abs(v)>=1000?v.toLocaleString("en-US",{maximumFractionDigits:2}):String(+v.toFixed(4))}
function opLabel(o){if(!o)return"";if(EVENTS[o.t])return EVENTS[o.t].label;switch(o.t){
  case"close":return"Price";case"open":return"Open";case"high":return"High";case"low":return"Low";
  case"num":return fmtN(o.v)}return o.t}
function condLabel(c){
  if(c.op==="on")return opLabel(c.a);
  if(c.a.t==="close"&&c.b&&c.b.t==="open"&&(c.op==="gt"||c.op==="lt"))return c.op==="gt"?"Bullish candle (close above open)":"Bearish candle (close below open)";
  return opLabel(c.a)+" "+OPTXT[c.op]+(c.b?" "+opLabel(c.b):"")}
function riskLabel(r){return r.unit==="zone"?`just beyond the zone or level (${r.mult}× ATR buffer)`:r.unit==="rr"?`1:${r.mult} risk-reward`:r.unit==="atr"?r.mult+"× ATR":r.unit==="pct"?r.mult+"%":fmtN(r.mult)+" points"}

/* ---------- mirror (for "opposite for sell") ---------- */
const MIRROR_T={};
[["fvgbull","fvgbear"],["obbull","obbear"],["pdbull","pdbear"],["fibbull","fibbear"],["srbull","srbear"],["bosup","bosdown"],["trendup","trenddown"],["gzbull","gzbear"],["atsup","atres"]].forEach(([x,y])=>{MIRROR_T[x]=y;MIRROR_T[y]=x});
const MIRROR_OP={xa:"xb",xb:"xa",gt:"lt",lt:"gt",rising:"falling",falling:"rising",on:"on"};
function mirrorOp(o){return o&&MIRROR_T[o.t]?{...o,t:MIRROR_T[o.t]}:o}
function mirrorCond(c){
  if(c.a.t==="close"&&c.b&&c.b.t==="open")return{a:c.a,op:MIRROR_OP[c.op],b:c.b};
  return{a:mirrorOp(c.a),op:MIRROR_OP[c.op],b:mirrorOp(c.b)};
}

/* ---------- plain-English reader ---------- */
function conceptsIn(t,side){
  const bear=/\b(bear(ish)?|supply|premium)\b/.test(t),bull=/\b(bull(ish)?|demand|discount)\b/.test(t);
  const d=bull&&!bear?1:bear&&!bull?-1:(side==="sell"?-1:1);
  const P=(x,y)=>d>0?x:y,out=[];
  const hasF=/\b(fvgs?|fair[- ]value[- ]gaps?|imbalances?)\b/.test(t),hasO=/\b(order[- ]?blocks?|obs?)\b/.test(t);
  if(hasF&&hasO&&/\bor\b/.test(t))out.push(P("pdbull","pdbear"));
  else{if(hasF)out.push(P("fvgbull","fvgbear"));if(hasO)out.push(P("obbull","obbear"))}
  if(/\b(fib|fibs|fibonacci|golden (zone|pocket)|retracement)\b|0?\.618|61\.8/.test(t)){
    const state=out.length>0||(/\b(in|inside|within|into)\b/.test(t)&&!/\b(bounce[sd]?|bouncing|reject(s|ed|ion)?|reaction|react(s|ed)?|hold(s)?)\b/.test(t));
    out.push(state?P("gzbull","gzbear"):P("fibbull","fibbear"));
  }
  const hasSup=/\bsupports?\b/.test(t),hasRes=/\bresistances?\b/.test(t),brk=/\b(break(s|ing)?|broke|breakout|cross(es|ed)?|closes? (above|below))\b/.test(t);
  if(hasSup||hasRes){
    const sr=hasSup&&!hasRes?1:hasRes&&!hasSup?-1:d;
    if(brk)out.push(sr>0?"bosdown":"bosup");
    else out.push(out.length?(sr>0?"atsup":"atres"):(sr>0?"srbull":"srbear"));
  }
  if(/\b(bos|break of structure|structure break|market structure shift|mss|choch|change of character)\b/.test(t))out.push(P("bosup","bosdown"));
  if(/\b(uptrend|up trend|trend is up|bullish (structure|trend|market))\b/.test(t))out.push("trendup");
  else if(/\b(downtrend|down trend|trend is down|bearish (structure|trend|market))\b/.test(t))out.push("trenddown");
  return[...new Set(out)];
}
const OPERANDS=[
  [/\b(?:closing price|candle close|close|closes|closed|price)\b/,()=>({t:"close"})],
  [/\bopen(?:ing price)?\b/,()=>({t:"open"})],
  [/\b(?:candle\s+)?high\b/,()=>({t:"high"})],
  [/\b(?:candle\s+)?low\b/,()=>({t:"low"})],
  [/(-?\d+(?:\.\d+)?)/,m=>({t:"num",v:+m[1]})],
];
function findOperand(s){let best=null;OPERANDS.forEach(([re,f])=>{const m=s.match(re);if(m&&(best===null||m.index<best.idx))best={idx:m.index,o:f(m)}});return best?best.o:null}
const OP_RES=[
  ["xa",/\b(?:cross(?:es|ed|ing)?|break(?:s|ing)?|broke|moves?|moved)\s+(?:back\s+)?(?:above|over)\b/],
  ["xb",/\b(?:cross(?:es|ed|ing)?|break(?:s|ing)?|broke|moves?|moved|drops?|falls?)\s+(?:back\s+)?(?:below|under)\b/],
  ["gt",/>=?|\b(?:above|over|greater than|higher than)\b/],
  ["lt",/<=?|\b(?:below|under|less than|lower than)\b/],
];
function parseClause(c,side){
  const t=c.trim();if(!t)return null;
  const cs=conceptsIn(t,side);
  const out=cs.map(k=>({a:{t:k},op:"on"}));
  if(/\b(?:bullish|green)\s+(?:candle|bar)s?\b/.test(t))out.push({a:{t:"close"},op:"gt",b:{t:"open"}});
  if(/\b(?:bearish|red)\s+(?:candle|bar)s?\b/.test(t))out.push({a:{t:"close"},op:"lt",b:{t:"open"}});
  if(out.length)return out;
  for(const[op,re]of OP_RES){const m=t.match(re);if(m){const a=findOperand(t.slice(0,m.index))||{t:"close"},b=findOperand(t.slice(m.index+m[0].length));if(b)return[{a,op,b}]}}
  return null;
}
function extractRisk(s){
  const NUM="(\\d+(?:\\.\\d+)?)";
  const UNIT="\\s*(x\\s*atr|×\\s*atr|times\\s+(?:the\\s+)?atr|atr|points?|pts|pips?|ticks?|%|percent)?";
  const unit=u=>!u||/atr/.test(u)?"atr":/%|percent/.test(u)?"pct":"pts";
  let sl=null,tp=null,rr=null,m;
  const zoneRe=/\b(?:stop[- ]?loss|stop|sl)\b(?:\s+(?:is|at|goes|placed|go))?\s+(?:just\s+)?(?:below|above|beyond|under|behind|outside|past)\s+(?:the\s+)?(?:zone|order[- ]?block|ob|fvg|gap|level|swing|structure|fib(?:onacci)?|0?\.786|support|resistance)s?\b/;
  if((m=s.match(zoneRe))){sl={mult:0.1,unit:"zone"};s=s.replace(m[0]," ")}
  const rrRe=/\b(?:risk[- ]?(?:to[- ])?reward|rr|r:r|reward[- ]to[- ]risk|take[- ]?profit|tp|target)\b\s*(?:ratio\s*)?(?:of|=|:|is|at)?\s*1\s*(?::|\/|to)\s*(\d+(?:\.\d+)?)/;
  if((m=s.match(rrRe))){rr=+m[1];s=s.replace(m[0]," ")}
  const pre=new RegExp(NUM+"\\s*(x\\s*atr|×\\s*atr|atr|points?|pts|pips?|%)\\s+(stop[- ]?loss|stop|sl|take[- ]?profit|target|tp)\\b","g");
  s=s.replace(pre,(all,n,u,kind)=>{const r={mult:+n,unit:unit(u)};if(/stop|sl/.test(kind))sl=sl||r;else tp=r;return" "});
  const slRe=new RegExp("\\b(?:stop[- ]?loss|stop|sl)\\b\\s*(?:of|at|=|:|is|to|around|about)?\\s*"+NUM+UNIT);
  const tpRe=new RegExp("\\b(?:take[- ]?profit|profit target|target|tp)\\b\\s*(?:of|at|=|:|is|to|around|about)?\\s*"+NUM+UNIT);
  if(!sl&&(m=s.match(slRe))){sl={mult:+m[1],unit:unit(m[2])};s=s.replace(m[0]," ")}
  if((m=s.match(tpRe))){tp={mult:+m[1],unit:unit(m[2])};s=s.replace(m[0]," ")}
  if(rr)tp={mult:rr,unit:"rr"};
  return{s,sl,tp};
}
function parseDescription(raw){
  const notes=[],unread=[];
  let s=" "+String(raw||"").toLowerCase().replace(/(\d),(?=\d{3}\b)/g,"$1").replace(/[“”"]/g," ").replace(/\s+/g," ")+" ";
  s=s.replace(/\bas long as\b/g," while ");
  const risk=extractRisk(s);s=risk.s;
  const sentences=s.split(/(?<!\d)[.;\n!?]+|[.;\n!?]+(?!\d)/);
  const seg={buy:[],sell:[]};let side=null;const mirror={buy:false,sell:false};
  const MARK=/\b(buy(?:ing)?|long|go long|sell(?:ing)?|short|go short)\b/g;
  const sideOf=w=>/^(buy|long|go long)/.test(w)?"buy":"sell";
  const MW=/\b(?:and\s+)?(?:do\s+)?(?:the\s+)?(?:opposite|vice versa|reverse|mirror(?:ed)?|inverse)\b(?:\s+(?:for|to|on|with))?/;
  let sawMarker=false;
  for(let sen of sentences){
    if(!sen||!sen.trim())continue;
    if(/\b(?:exit|close (?:the |my |a )?(?:trade|position|long|short|buy|sell))\b/.test(sen)){notes.push("Exit rules in the text are replaced by the stop loss, take profit and opposite signal.");continue}
    const mm=sen.match(MW);
    if(mm){
      const before=sen.slice(0,mm.index),after=sen.slice(mm.index+mm[0].length);
      const am=after.match(/^\s*(?:the\s+|a\s+)?(buy(?:ing)?|long|sell(?:ing)?|short)s?\b/);
      if(am){mirror[sideOf(am[1])]=true;sen=before+after.slice(am[0].length)}
      else{const fm=before.match(/\b(buy(?:ing)?|long|sell(?:ing)?|short)\b/);const base=fm?sideOf(fm[1]):(side||"buy");mirror[base==="buy"?"sell":"buy"]=true;sen=before+" "+after}
      if(!sen.trim())continue;
    }
    const pf=sen.match(/^(.*?)\b(?:for|as|to)\s+(?:a\s+|the\s+)?(buy|long|sell|short)s?\b(?:\s+(?:signals?|entr(?:y|ies)|trades?))?\s*$/);
    if(pf&&!/\b(?:buy|long|sell|short)\b/.test(pf[1])){seg[sideOf(pf[2])].push(pf[1]);sawMarker=true;continue}
    const parts=[];let last=0,m;MARK.lastIndex=0;
    while((m=MARK.exec(sen))){parts.push({side,text:sen.slice(last,m.index)});side=sideOf(m[1]);sawMarker=true;last=m.index+m[0].length}
    parts.push({side,text:sen.slice(last)});
    for(const p of parts){if(p.text.trim())seg[p.side||"buy"].push(p.text)}
  }
  if(!sawMarker&&seg.buy.length)notes.push("No buy or sell words found, so these rules are read as buy rules.");
  function parseSide(texts,sd){
    const out=[];
    for(const tx of texts){
      const clauses=tx.split(/\s*(?:,|\band\b|\bwhile\b|\bplus\b|&|\balso\b|\bthen\b|\bafter\b)\s*/);
      for(let c of clauses){
        c=c.replace(/^\s*(?:(?:a|an|the|signal|entry|trade|position|order|when|whenever|if|once|only|on|at|:|-)\s*)+/,"").trim();
        if(!c||/^(?:when|if|only|enter|signal|trade|to|we get|there is)$/.test(c))continue;
        const r=parseClause(c,sd);
        if(r)out.push(...r);else if(c.length>2)unread.push(c);
      }
    }
    // "After a break of structure" next to another event means the structure has turned, not that both happen on one candle.
    const otherEvent=out.some(c=>c.op==="on"&&EVENTS[c.a.t].stop&&!/^bos/.test(c.a.t));
    if(otherEvent)for(const c of out)if(c.op==="on"&&/^bos/.test(c.a.t)){c.a={t:c.a.t==="bosup"?"trendup":"trenddown"};notes.push("“Break of structure” is read as the structure having turned in that direction.")}
    const seen=new Set();return out.filter(c=>{const k=JSON.stringify(c);if(seen.has(k))return false;seen.add(k);return true});
  }
  let buy=parseSide(seg.buy,"buy"),sell=parseSide(seg.sell,"sell");
  if(mirror.sell&&buy.length&&!sell.length)sell=buy.map(mirrorCond);
  if(mirror.buy&&sell.length&&!buy.length)buy=sell.map(mirrorCond);
  const usesZones=[...buy,...sell].some(c=>c.op==="on"&&EVENTS[c.a.t]&&EVENTS[c.a.t].stop);
  let sl=risk.sl,tp=risk.tp;
  if(!sl){sl=usesZones?{mult:0.1,unit:"zone"}:{mult:1.5,unit:"atr"};notes.push(usesZones?"No stop loss given, so the stop goes just beyond the zone or level.":"No stop loss given, so the bot uses 1.5× ATR.")}
  if(!tp){tp={mult:2,unit:"rr"};notes.push("No take profit given, so the bot uses 1:2 risk-reward.")}
  return{buy,sell,sl,tp,notes:[...new Set(notes)],unread};
}

function cleanOperand(o){
  if(!o||typeof o!=="object")return null;
  const t=String(o.t||"");if(!T_KEYS.includes(t))return null;
  if(t==="num"){const v=Number(o.v);return isFinite(v)?{t,v}:null}
  return{t};
}
function cleanRules(r){
  const side=a=>(Array.isArray(a)?a:[]).map(c=>{const a=cleanOperand(c&&c.a),op=String(c&&c.op||"");if(!a||!OP_KEYS.includes(op))return null;
    if(op==="on")return EVENTS[a.t]?{a,op}:null;if(EVENTS[a.t])return{a,op:"on"};
    if(op==="rising"||op==="falling")return{a,op};const b=cleanOperand(c.b);return b&&!EVENTS[b.t]?{a,op,b}:null}).filter(Boolean);
  const risk=(x,d)=>{const m=Number(x&&x.mult),u=String(x&&x.unit||"");return m>0&&["atr","pts","pct","zone","rr"].includes(u)?{mult:m,unit:u}:d};
  return{name:typeof r.name==="string"?r.name.slice(0,60):"",buy:side(r.buy),sell:side(r.sell),sl:risk(r.sl,{mult:0.1,unit:"zone"}),tp:risk(r.tp,{mult:2,unit:"rr"}),notes:(Array.isArray(r.notes)?r.notes:[]).map(String).slice(0,6),unread:(Array.isArray(r.unread)?r.unread:[]).map(String).slice(0,6)};
}

const ev=t=>({a:{t},op:"on"});
const ZONE={mult:0.1,unit:"zone"},RR2={mult:2,unit:"rr"};
const BUILTINS=[
  {id:"c-fvg",name:"Fair value gap retest",desc:"Buy the first return into a bullish FVG, sell the first return into a bearish one. A close through the gap cancels it.",
   buy:[ev("fvgbull")],sell:[ev("fvgbear")],sl:ZONE,tp:RR2},
  {id:"c-ob",name:"Order block retest",desc:"After a break of structure, the last opposite candle before the move becomes the order block. Trade the first retest.",
   buy:[ev("obbull")],sell:[ev("obbear")],sl:ZONE,tp:RR2},
  {id:"c-fib",name:"Fibonacci golden zone",desc:"After a break of structure, wait for a pullback into the 0.5–0.618 retracement and a candle that closes back in the trend's direction.",
   buy:[ev("fibbull")],sell:[ev("fibbear")],sl:ZONE,tp:RR2},
  {id:"c-sr",name:"Support and resistance rejection",desc:"Levels where swing points have turned at least twice. Buy a bullish rejection of support, sell a bearish rejection of resistance.",
   buy:[ev("srbull")],sell:[ev("srbear")],sl:ZONE,tp:RR2},
  {id:"c-conf",name:"Confluence: zone in the golden zone",desc:"An FVG or order block tap that happens inside the 0.5–0.786 Fibonacci retracement of the current leg.",
   buy:[ev("pdbull"),ev("gzbull")],sell:[ev("pdbear"),ev("gzbear")],sl:ZONE,tp:{mult:2.5,unit:"rr"}},
];

/* ---------- TradingView Pine Script export ---------- */
const PINE_VAR={fvgbull:["fvgBullTap","fvgBullStop"],fvgbear:["fvgBearTap","fvgBearStop"],obbull:["obBullTap","obBullStop"],obbear:["obBearTap","obBearStop"],
  pdbull:["pdBull","pdBullStop"],pdbear:["pdBear","pdBearStop"],fibbull:["fibBull","fibBullStop"],fibbear:["fibBear","fibBearStop"],
  srbull:["srBull","srBullStop"],srbear:["srBear","srBearStop"],bosup:["bosUp","bosUpStop"],bosdown:["bosDown","bosDownStop"],
  trendup:["trendUp"],trenddown:["trendDown"],gzbull:["gzBull"],gzbear:["gzBear"],atsup:["atSup"],atres:["atRes"]};
const PINE_CONCEPTS=`// ===== Market structure, order blocks, fair value gaps, Fibonacci, support and resistance =====
minNa(a, b) => na(a) ? b : na(b) ? a : math.min(a, b)
maxNa(a, b) => na(a) ? b : na(b) ? a : math.max(a, b)
swingLen = 3
ph = ta.pivothigh(high, swingLen, swingLen)
pl = ta.pivotlow(low, swingLen, swingLen)
var float lastSH = na
var int lastSHBar = na
var float lastSL = na
var int lastSLBar = na
var bool shBroken = false
var bool slBroken = false
var int trend = 0
var pivPrices = array.new_float()
if not na(ph)
    lastSH := ph
    lastSHBar := bar_index - swingLen
    shBroken := false
    array.push(pivPrices, ph)
if not na(pl)
    lastSL := pl
    lastSLBar := bar_index - swingLen
    slBroken := false
    array.push(pivPrices, pl)
while array.size(pivPrices) > 30
    array.shift(pivPrices)

var int legDir = 0
var float legLo = na
var float legHi = na
var int legLoBar = na
var int legHiBar = na
var bool legUsed = false
var bool legTouched = false
var float obBullTop = na
var float obBullBot = na
var int obBullBorn = na
var bool obBullDone = true
var float obBearTop = na
var float obBearBot = na
var int obBearBorn = na
var bool obBearDone = true
var float fvgBullTop = na
var float fvgBullBot = na
var int fvgBullBorn = na
var bool fvgBullDone = true
var float fvgBearTop = na
var float fvgBearBot = na
var int fvgBearBorn = na
var bool fvgBearDone = true

// Break of structure up: new bullish order block and Fibonacci leg
bosUp = not na(lastSH) and not shBroken and close > lastSH
bosUpStop = float(na)
if bosUp
    shBroken := true
    trend := 1
    for j = 0 to 10
        if close[j] < open[j]
            obBullTop := high[j]
            obBullBot := low[j]
            obBullBorn := bar_index
            obBullDone := false
            break
    fromBar = math.max(na(lastSLBar) ? bar_index - 20 : lastSLBar, 0)
    n = math.min(bar_index - fromBar, 300)
    lo = low
    for j = 0 to n
        if low[j] < lo
            lo := low[j]
    legDir := 1
    legLo := lo
    legHi := high
    legHiBar := bar_index
    legUsed := false
    legTouched := false
    bosUpStop := lo

// Break of structure down: new bearish order block and Fibonacci leg
bosDown = not na(lastSL) and not slBroken and close < lastSL
bosDownStop = float(na)
if bosDown
    slBroken := true
    trend := -1
    for j = 0 to 10
        if close[j] > open[j]
            obBearTop := high[j]
            obBearBot := low[j]
            obBearBorn := bar_index
            obBearDone := false
            break
    fromBar2 = math.max(na(lastSHBar) ? bar_index - 20 : lastSHBar, 0)
    n2 = math.min(bar_index - fromBar2, 300)
    hi = high
    for j = 0 to n2
        if high[j] > hi
            hi := high[j]
    legDir := -1
    legHi := hi
    legLo := low
    legLoBar := bar_index
    legUsed := false
    legTouched := false
    bosDownStop := hi

// Fair value gaps: three-candle imbalance at least 0.1 ATR wide
atrOk = not na(atr_14)
if atrOk and bar_index >= 2 and low > high[2] and low - high[2] >= 0.1 * atr_14
    fvgBullTop := low
    fvgBullBot := high[2]
    fvgBullBorn := bar_index
    fvgBullDone := false
if atrOk and bar_index >= 2 and high < low[2] and low[2] - high >= 0.1 * atr_14
    fvgBearTop := low[2]
    fvgBearBot := high
    fvgBearBorn := bar_index
    fvgBearDone := false

// First return into the latest zone. A close through the zone cancels it.
fvgBullTap = false
fvgBullStop = float(na)
if not fvgBullDone and bar_index > fvgBullBorn
    if close < fvgBullBot
        fvgBullDone := true
    else if low <= fvgBullTop
        fvgBullTap := true
        fvgBullStop := fvgBullBot
        fvgBullDone := true
obBullTap = false
obBullStop = float(na)
if not obBullDone and bar_index > obBullBorn
    if close < obBullBot
        obBullDone := true
    else if low <= obBullTop
        obBullTap := true
        obBullStop := obBullBot
        obBullDone := true
fvgBearTap = false
fvgBearStop = float(na)
if not fvgBearDone and bar_index > fvgBearBorn
    if close > fvgBearTop
        fvgBearDone := true
    else if high >= fvgBearBot
        fvgBearTap := true
        fvgBearStop := fvgBearTop
        fvgBearDone := true
obBearTap = false
obBearStop = float(na)
if not obBearDone and bar_index > obBearBorn
    if close > obBearTop
        obBearDone := true
    else if high >= obBearBot
        obBearTap := true
        obBearStop := obBearTop
        obBearDone := true
pdBull = fvgBullTap or obBullTap
pdBullStop = minNa(fvgBullStop, obBullStop)
pdBear = fvgBearTap or obBearTap
pdBearStop = maxNa(fvgBearStop, obBearStop)

// Fibonacci retracement of the latest leg
fibBull = false
fibBullStop = float(na)
fibBear = false
fibBearStop = float(na)
gzBull = false
gzBear = false
if legDir == 1
    if high > legHi and not legTouched
        legHi := high
        legHiBar := bar_index
    rng = legHi - legLo
    f50 = legHi - 0.5 * rng
    f618 = legHi - 0.618 * rng
    f786 = legHi - 0.786 * rng
    if close < legLo
        legDir := 0
    else if bar_index > legHiBar
        if low <= f50 and low >= f786
            legTouched := true
            gzBull := true
        if not legUsed and low <= f50 and close >= f618 and close > open
            fibBull := true
            fibBullStop := f786
            legUsed := true
else if legDir == -1
    if low < legLo and not legTouched
        legLo := low
        legLoBar := bar_index
    rng = legHi - legLo
    f50 = legLo + 0.5 * rng
    f618 = legLo + 0.618 * rng
    f786 = legLo + 0.786 * rng
    if close > legHi
        legDir := 0
    else if bar_index > legLoBar
        if high >= f50 and high <= f786
            legTouched := true
            gzBear := true
        if not legUsed and high >= f50 and close <= f618 and close < open
            fibBear := true
            fibBearStop := f786
            legUsed := true

// Support and resistance: swing prices touched at least twice (within 0.25 ATR)
tol = 0.25 * atr_14
srBull = false
srBullStop = float(na)
srBear = false
srBearStop = float(na)
atSup = false
atRes = false
nP = array.size(pivPrices)
if atrOk and nP > 1
    for x = 0 to nP - 1
        p = array.get(pivPrices, x)
        touches = 0
        for y = 0 to nP - 1
            if math.abs(array.get(pivPrices, y) - p) <= tol
                touches += 1
        if touches >= 2
            if low <= p + tol and low >= p - 1.5 * tol and close > p
                atSup := true
                if close > open and (na(srBullStop) or p - tol > srBullStop)
                    srBull := true
                    srBullStop := p - tol
            if high >= p - tol and high <= p + 1.5 * tol and close < p
                atRes := true
                if close < open and (na(srBearStop) or p + tol < srBearStop)
                    srBear := true
                    srBearStop := p + tol
trendUp = trend == 1
trendDown = trend == -1
`;
function toPine(st){
  const all=[...st.buy,...st.sell];
  const usesConcepts=all.some(c=>c.op==="on");
  const ref=o=>o.t==="num"?String(+o.v):["close","open","high","low"].includes(o.t)?o.t:"na";
  const cexpr=c=>{if(c.op==="on")return PINE_VAR[c.a.t][0];const a=ref(c.a);if(c.op==="rising")return`${a} > ${a}[1]`;if(c.op==="falling")return`${a} < ${a}[1]`;const b=ref(c.b);
    return c.op==="xa"?`ta.crossover(${a}, ${b})`:c.op==="xb"?`ta.crossunder(${a}, ${b})`:c.op==="gt"?`${a} > ${b}`:`${a} < ${b}`};
  const lines=[],side=(list,p)=>{if(!list.length){lines.push(`${p}Cond = false`);return}
    list.forEach((c,i)=>lines.push(`${p}${i+1} = ${cexpr(c)}   // ${condLabel(c)}`));
    lines.push(`${p}Cond = ${list.map((_,i)=>p+(i+1)).join(" and ")}`)};
  side(st.buy,"buy");side(st.sell,"sell");
  const zoneExpr=(list,fn)=>{const v=list.filter(c=>c.op==="on"&&EVENTS[c.a.t].stop).map(c=>PINE_VAR[c.a.t][1]);
    if(!v.length)return"float(na)";return v.reduce((acc,x)=>acc?`${fn}(${acc}, ${x})`:x,"")};
  const dist=r=>r.unit==="atr"?`atr_14 * ${r.mult}`:r.unit==="pct"?`close * ${r.mult} / 100`:r.unit==="pts"?String(r.mult):"atr_14 * 1.5";
  const stopLine=(d)=>{const z=d>0?"buyZone":"sellZone",sgn=d>0?"-":"+";
    return st.sl.unit==="zone"?`na(${z}) ? close ${sgn} atr_14 * 1.5 : ${z} ${sgn} atr_14 * ${st.sl.mult}`:`close ${sgn} ${dist(st.sl)}`};
  const tgtLine=(d)=>{const r=d>0?"longRisk":"shortRisk",s=d>0?"longStop":"shortStop",sgn=d>0?"+":"-";
    return st.tp.unit==="rr"?`close ${sgn} ${st.tp.mult} * ${r}`:`close ${sgn} ${dist(st.tp)}`};
  const name=String(st.name||"My strategy").replace(/["\\]/g,"'");
  const out=[];
  out.push("// Generated by Synthetic Signal Desk",`// ${name}`,"// Buy:  "+(st.buy.map(condLabel).join(" AND ")||"none"),"// Sell: "+(st.sell.map(condLabel).join(" AND ")||"none"),`// Stop: ${riskLabel(st.sl)}. Target: ${riskLabel(st.tp)}. An opposite signal also closes the trade.`,"//@version=5");
  out.push(`strategy("${name}", overlay = true, default_qty_type = strategy.fixed, default_qty_value = 1, pyramiding = 0, max_bars_back = 500)`,"");
  out.push("atr_14 = ta.atr(14)","");
  if(usesConcepts)out.push(PINE_CONCEPTS);
  out.push("// Rules",...lines,"","// A signal fires on the candle where all rules first become true",
    "buyNew = buyCond and not buyCond[1]","sellNew = sellCond and not sellCond[1]","buySignal = buyNew and not sellNew","sellSignal = sellNew and not buyNew","",
    "// Stops and targets, worked out on the signal candle",
    `buyZone = ${zoneExpr(st.buy,"minNa")}`,`sellZone = ${zoneExpr(st.sell,"maxNa")}`,
    `longStop = ${stopLine(1)}`,"longRisk = close - longStop",`longTarget = ${tgtLine(1)}`,
    `shortStop = ${stopLine(-1)}`,"shortRisk = shortStop - close",`shortTarget = ${tgtLine(-1)}`,"",
    "// Orders fill at the next candle's open. An opposite signal closes and reverses the trade.",
    "if buySignal and longRisk > 0",`    strategy.entry("Buy", strategy.long)`,`    strategy.exit("Buy exit", "Buy", stop = longStop, limit = longTarget)`,
    "if sellSignal and shortRisk > 0",`    strategy.entry("Sell", strategy.short)`,`    strategy.exit("Sell exit", "Sell", stop = shortStop, limit = shortTarget)`,"",
    `plotshape(buySignal, "Buy", shape.triangleup, location.belowbar, color.new(color.green, 0), size = size.small)`,
    `plotshape(sellSignal, "Sell", shape.triangledown, location.abovebar, color.new(color.red, 0), size = size.small)`,
    "","// Alerts: in TradingView create an alert on this strategy and choose \"alert() function calls only\"",
    "if buySignal",`    alert("${name}: BUY " + syminfo.ticker + " at " + str.tostring(close), alert.freq_once_per_bar_close)`,
    "if sellSignal",`    alert("${name}: SELL " + syminfo.ticker + " at " + str.tostring(close), alert.freq_once_per_bar_close)`);
  let code=out.join("\n")+"\n";
  if(!usesConcepts)code=code.replace(/minNa\(|maxNa\(/g,m=>m==="minNa("?"math.min(":"math.max(");
  return code;
}
if(typeof module!=="undefined")module.exports={toPine,parseDescription,makeEngine,backtest,smc,condLabel,riskLabel,BUILTINS,cleanRules,mirrorCond,exitLevels,EVENTS};
