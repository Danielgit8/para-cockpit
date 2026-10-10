import{a as nt}from"./chunk-ZFO6P6HJ.js";import{a as rt}from"./chunk-6PGNC5K5.js";import{a as lt}from"./chunk-O2Q4AFIZ.js";import"./chunk-F7VMZZAI.js";import"./chunk-BTRZSQGE.js";import"./chunk-C7QSZNIR.js";import"./chunk-4OIVK4QI.js";import"./chunk-M47WBAUQ.js";import"./chunk-QRHJR7DC.js";import"./chunk-ODSPCSNV.js";import"./chunk-KHB6Z2MR.js";import"./chunk-W5F3UNGB.js";import"./chunk-Q3VZCE5O.js";import"./chunk-WV3MOXR4.js";import"./chunk-RWII3XGE.js";import"./chunk-X2A2UZAJ.js";import"./chunk-TRDKWG7T.js";import"./chunk-GEE5WW2J.js";import"./chunk-JWKKDGA5.js";import{n as it,o as ot}from"./chunk-MUQNTMBP.js";import"./chunk-YA2WNLNW.js";import{O as X,T as Z,U as j,V as q,W as J,X as K,Y as Q,Z as Y,_ as tt,k as V}from"./chunk-QZ535KWU.js";import{F as R,I as at,b as T,m as et}from"./chunk-2VUCITPG.js";import{a as l}from"./chunk-46FUZDBZ.js";import{e as U}from"./chunk-LL4AVGUQ.js";U();var st=V.pie,L={sections:new Map,showData:!1,config:st},b=L.sections,O=L.showData,xt=structuredClone(st),wt=l(()=>structuredClone(xt),"getConfig"),Ct=l(()=>{b=new Map,O=L.showData,Z()},"clear"),$t=l(({label:t,value:a})=>{if(a<0)throw new Error(`"${t}" has invalid value: ${a}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);b.has(t)||(b.set(t,a),T.debug(`added new section: ${t}, with value: ${a}`))},"addSection"),Dt=l(()=>b,"getSections"),yt=l(t=>{O=t},"setShowData"),Tt=l(()=>O,"getShowData"),ct={getConfig:wt,clear:Ct,setDiagramTitle:Q,getDiagramTitle:Y,setAccTitle:j,getAccTitle:q,setAccDescription:J,getAccDescription:K,addSection:$t,getSections:Dt,setShowData:yt,getShowData:Tt},bt=l((t,a)=>{nt(t,a),a.setShowData(t.showData),t.sections.map(a.addSection)},"populateDb"),At={parse:l(async t=>{let a=await lt("pie",t);T.debug(a),bt(a,ct)},"parse")},kt=l(t=>`
  .pieCircle{
    stroke: ${t.pieStrokeColor};
    stroke-width : ${t.pieStrokeWidth};
    opacity : ${t.pieOpacity};
  }
  .pieCircle.highlighted{
    scale: 1.05;
    opacity: 1;
  }
  .pieCircle.highlightedOnHover:hover{
    transition-duration: 250ms;
    scale: 1.05;
    opacity: 1;
  }
  .pieOuterCircle{
    stroke: ${t.pieOuterStrokeColor};
    stroke-width: ${t.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${t.pieTitleTextSize};
    fill: ${t.pieTitleTextColor};
    font-family: ${t.fontFamily};
  }
  .slice {
    font-family: ${t.fontFamily};
    fill: ${t.pieSectionTextColor};
    font-size:${t.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${t.pieLegendTextColor};
    font-family: ${t.fontFamily};
    font-size: ${t.pieLegendTextSize};
  }
`,"getStyles"),_t=kt,zt=l(t=>{let a=[...t.values()].reduce((n,m)=>n+m,0),W=[...t.entries()].map(([n,m])=>({label:n,value:m})).filter(n=>n.value/a*100>=1);return at().value(n=>n.value).sort(null)(W)},"createPieArcs"),Et=l((t,a,W,F)=>{T.debug(`rendering pie chart
`+t);let n=F.db,m=tt(),h=ot(n.getConfig(),m.pie),H=40,i=18,c=4,S=450,x=S,A=rt(a),$=A.append("g");$.attr("transform","translate("+x/2+","+S/2+")");let{themeVariables:o}=m,[M]=it(o.pieOuterStrokeWidth);M??(M=2);let dt=h.legendPosition,P=h.textPosition,gt=h.donutHole>0&&h.donutHole<=.9?h.donutHole:0,f=Math.min(x,S)/2-H,pt=R().innerRadius(gt*f).outerRadius(f),ht=R().innerRadius(f*P).outerRadius(f*P),w=$.append("g");w.append("circle").attr("cx",0).attr("cy",0).attr("r",f+M/2).attr("class","pieOuterCircle");let D=n.getSections(),ft=zt(D),ut=[o.pie1,o.pie2,o.pie3,o.pie4,o.pie5,o.pie6,o.pie7,o.pie8,o.pie9,o.pie10,o.pie11,o.pie12],k=0;D.forEach(e=>{k+=e});let G=ft.filter(e=>(e.data.value/k*100).toFixed(0)!=="0"),_=et(ut).domain([...D.keys()]);w.selectAll("mySlices").data(G).enter().append("path").attr("d",pt).attr("fill",e=>_(e.data.label)).attr("class",e=>{let r="pieCircle";return h.highlightSlice==="hover"?r+=" highlightedOnHover":h.highlightSlice===e.data.label&&(r+=" highlighted"),r}),w.selectAll("mySlices").data(G).enter().append("text").text(e=>(e.data.value/k*100).toFixed(0)+"%").attr("transform",e=>"translate("+ht.centroid(e)+")").style("text-anchor","middle").attr("class","slice");let mt=$.append("text").text(n.getDiagramTitle()).attr("x",0).attr("y",-(S-50)/2).attr("class","pieTitleText"),C=[...D.entries()].map(([e,r])=>({label:e,value:r})),u=$.selectAll(".legend").data(C).enter().append("g").attr("class","legend");u.append("rect").attr("width",i).attr("height",i).style("fill",e=>_(e.label)).style("stroke",e=>_(e.label)),u.append("text").attr("x",i+c).attr("y",i-c).text(e=>n.getShowData()?`${e.label} [${e.value}]`:e.label);let v=Math.max(...u.selectAll("text").nodes().map(e=>e?.getBoundingClientRect().width??0)),y=S,z=x+H,s=i+c,E=C.length*s;switch(dt){case"center":u.attr("transform",(e,r)=>{let d=s*C.length/2,g=-v/2-(i+c),p=r*s-d;return"translate("+g+","+p+")"});break;case"top":y+=E,u.attr("transform",(e,r)=>{let d=f,g=-v/2-(i+c),p=r*s-d;return`translate(${g}, ${p})`}),w.attr("transform",()=>`translate(0, ${E+s})`);break;case"bottom":y+=E,u.attr("transform",(e,r)=>{let d=-f-s,g=-v/2-(i+c),p=r*s-d;return"translate("+g+","+p+")"});break;case"left":z+=i+c+v,u.attr("transform",(e,r)=>{let d=s*C.length/2,g=-f-(i+c),p=r*s-d;return"translate("+g+","+p+")"}),w.attr("transform",()=>`translate(${v+i+c}, 0)`);break;case"right":default:z+=i+c+v,u.attr("transform",(e,r)=>{let d=s*C.length/2,g=12*i,p=r*s-d;return"translate("+g+","+p+")"});break}let B=mt.node()?.getBoundingClientRect().width??0,vt=x/2-B/2,St=x/2+B/2,N=Math.min(0,vt),I=Math.max(z,St)-N;A.attr("viewBox",`${N} 0 ${I} ${y}`),X(A,y,I,h.useMaxWidth)},"draw"),Rt={draw:Et},It={parser:At,db:ct,renderer:Rt,styles:_t};export{It as diagram};
