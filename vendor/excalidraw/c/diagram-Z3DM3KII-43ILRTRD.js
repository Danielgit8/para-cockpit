import{a as F}from"./chunk-ZFO6P6HJ.js";import{a as E}from"./chunk-6PGNC5K5.js";import{a as A}from"./chunk-O2Q4AFIZ.js";import"./chunk-F7VMZZAI.js";import"./chunk-BTRZSQGE.js";import"./chunk-C7QSZNIR.js";import"./chunk-4OIVK4QI.js";import"./chunk-M47WBAUQ.js";import"./chunk-QRHJR7DC.js";import"./chunk-ODSPCSNV.js";import"./chunk-KHB6Z2MR.js";import"./chunk-W5F3UNGB.js";import"./chunk-Q3VZCE5O.js";import"./chunk-WV3MOXR4.js";import"./chunk-RWII3XGE.js";import"./chunk-X2A2UZAJ.js";import"./chunk-TRDKWG7T.js";import"./chunk-GEE5WW2J.js";import"./chunk-JWKKDGA5.js";import{o as w}from"./chunk-MUQNTMBP.js";import"./chunk-YA2WNLNW.js";import{O as $,T as B,U as C,V as S,W as D,X as T,Y as P,Z as z,k as x,u as y}from"./chunk-QZ535KWU.js";import{b as u}from"./chunk-2VUCITPG.js";import{a as h}from"./chunk-46FUZDBZ.js";import{e as v}from"./chunk-LL4AVGUQ.js";v();var M=x.packet,b,W=(b=class{constructor(){this.packet=[],this.setAccTitle=C,this.getAccTitle=S,this.setDiagramTitle=P,this.getDiagramTitle=z,this.getAccDescription=T,this.setAccDescription=D}getConfig(){let t=w({...M,...y().packet});return t.showBits&&(t.paddingY+=10),t}getPacket(){return this.packet}pushWord(t){t.length>0&&this.packet.push(t)}clear(){B(),this.packet=[]}},h(b,"PacketDB"),b),Y=1e4,I=h((e,t)=>{F(e,t);let a=-1,o=[],n=1,{bitsPerRow:l}=t.getConfig();for(let{start:r,end:s,bits:d,label:c}of e.blocks){if(r!==void 0&&s!==void 0&&s<r)throw new Error(`Packet block ${r} - ${s} is invalid. End must be greater than start.`);if(r??(r=a+1),r!==a+1)throw new Error(`Packet block ${r} - ${s??r} is not contiguous. It should start from ${a+1}.`);if(d===0)throw new Error(`Packet block ${r} is invalid. Cannot have a zero bit field.`);for(s??(s=r+(d??1)-1),d??(d=s-r+1),a=s,u.debug(`Packet block ${r} - ${a} with label ${c}`);o.length<=l+1&&t.getPacket().length<Y;){let[p,i]=O({start:r,end:s,bits:d,label:c},n,l);if(o.push(p),p.end+1===n*l&&(t.pushWord(o),o=[],n++),!i)break;({start:r,end:s,bits:d,label:c}=i)}}t.pushWord(o)},"populate"),O=h((e,t,a)=>{if(e.start===void 0)throw new Error("start should have been set during first phase");if(e.end===void 0)throw new Error("end should have been set during first phase");if(e.start>e.end)throw new Error(`Block start ${e.start} is greater than block end ${e.end}.`);if(e.end+1<=t*a)return[e,void 0];let o=t*a-1,n=t*a;return[{start:e.start,end:o,label:e.label,bits:o-e.start},{start:n,end:e.end,label:e.label,bits:e.end-n}]},"getNextFittingBlock"),_={parser:{yy:void 0},parse:h(async e=>{let t=await A("packet",e),a=_.parser?.yy;if(!(a instanceof W))throw new Error("parser.parser?.yy was not a PacketDB. This is due to a bug within Mermaid, please report this issue at https://github.com/mermaid-js/mermaid/issues.");u.debug(t),I(t,a)},"parse")},j=h((e,t,a,o)=>{let n=o.db,l=n.getConfig(),{rowHeight:r,paddingY:s,bitWidth:d,bitsPerRow:c}=l,p=n.getPacket(),i=n.getDiagramTitle(),f=r+s,g=f*(p.length+1)-(i?0:r),k=d*c+2,m=E(t);m.attr("viewBox",`0 0 ${k} ${g}`),$(m,g,k,l.useMaxWidth);for(let[N,L]of p.entries())G(m,L,N,l);m.append("text").text(i).attr("x",k/2).attr("y",g-f/2).attr("dominant-baseline","middle").attr("text-anchor","middle").attr("class","packetTitle")},"draw"),G=h((e,t,a,{rowHeight:o,paddingX:n,paddingY:l,bitWidth:r,bitsPerRow:s,showBits:d})=>{let c=e.append("g"),p=a*(o+l)+l;for(let i of t){let f=i.start%s*r+1,g=(i.end-i.start+1)*r-n;if(c.append("rect").attr("x",f).attr("y",p).attr("width",g).attr("height",o).attr("class","packetBlock"),c.append("text").attr("x",f+g/2).attr("y",p+o/2).attr("class","packetLabel").attr("dominant-baseline","middle").attr("text-anchor","middle").text(i.label),!d)continue;let k=i.end===i.start,m=p-2;c.append("text").attr("x",f+(k?g/2:0)).attr("y",m).attr("class","packetByte start").attr("dominant-baseline","auto").attr("text-anchor",k?"middle":"start").text(i.start),k||c.append("text").attr("x",f+g).attr("y",m).attr("class","packetByte end").attr("dominant-baseline","auto").attr("text-anchor","end").text(i.end)}},"drawWord"),H={draw:j},K={byteFontSize:"10px",startByteColor:"black",endByteColor:"black",labelColor:"black",labelFontSize:"12px",titleColor:"black",titleFontSize:"14px",blockStrokeColor:"black",blockStrokeWidth:"1",blockFillColor:"#efefef"},R=h(({packet:e}={})=>{let t=w(K,e);return`
	.packetByte {
		font-size: ${t.byteFontSize};
	}
	.packetByte.start {
		fill: ${t.startByteColor};
	}
	.packetByte.end {
		fill: ${t.endByteColor};
	}
	.packetLabel {
		fill: ${t.labelColor};
		font-size: ${t.labelFontSize};
	}
	.packetTitle {
		fill: ${t.titleColor};
		font-size: ${t.titleFontSize};
	}
	.packetBlock {
		stroke: ${t.blockStrokeColor};
		stroke-width: ${t.blockStrokeWidth};
		fill: ${t.blockFillColor};
	}
	`},"styles"),et={parser:_,get db(){return new W},renderer:H,styles:R};export{et as diagram};
