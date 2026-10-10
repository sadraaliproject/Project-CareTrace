/** Graph rendering only. Every node and edge comes from the data projection. */
export const graphColors = {Patient:'#5bc6ba',Condition:'#8faef8',CareGap:'#f1b769',Document:'#8c91b7',Barrier:'#b8a0ed',Intervention:'#6fcd96',Task:'#e2cf91'};
export function createGraph(container, graph, {onSelect, mode='population'}={}) {
  if (!globalThis.cytoscape) { container.innerHTML='<div class="graph-unavailable">Graph renderer unavailable. Use the accessible node list below.</div>'; return null; }
  const ids=new Set(graph.nodes.map(n=>n.id));
  const elements=[...graph.nodes.map(n=>({data:{...n,id:String(n.id),label:n.label||n.id,color:graphColors[n.type]||'#9caec0',size:n.type==='Patient'?22:n.type==='Document'?12:n.type==='CareGap'?16:42}})),...graph.edges.filter(e=>ids.has(e.from||e.source)&&ids.has(e.to||e.target)).map((e,i)=>({data:{...e,id:`edge:${e.id||i}`,source:e.from||e.source,target:e.to||e.target,label:e.type}}))];
  const patients=graph.nodes.filter(n=>n.type==='Patient');
  const patientPositions=new Map(patients.map((n,i)=>{const angle=i*Math.PI*2/Math.max(1,patients.length)-Math.PI/2;const radius=patients.length>12?350+(i%3)*105:230;return[n.id,{x:Math.cos(angle)*radius,y:Math.sin(angle)*radius}];}));
  const hubs=graph.nodes.filter(n=>!['Patient','Document','CareGap'].includes(n.type));
  for(const el of elements){if(el.data.source)continue;const n=el.data;if(patientPositions.has(n.id)){el.position=patientPositions.get(n.id);continue;}if(n.patientId&&patientPositions.has(n.patientId)){const p=patientPositions.get(n.patientId), siblings=graph.nodes.filter(x=>x.patientId===n.patientId),index=siblings.findIndex(x=>x.id===n.id),angle=index*2*Math.PI/Math.max(1,siblings.length);el.position={x:p.x+Math.cos(angle)*66,y:p.y+Math.sin(angle)*66};}else{const i=hubs.findIndex(x=>x.id===n.id),angle=i*2*Math.PI/Math.max(1,hubs.length);el.position={x:Math.cos(angle)*130,y:Math.sin(angle)*130};}}
  const cy=globalThis.cytoscape({container,elements,layout:{name:'preset',fit:true,padding:65},minZoom:.13,maxZoom:3,wheelSensitivity:.25,selectionType:'single',style:[
    {selector:'node',style:{'background-color':'data(color)',width:'data(size)',height:'data(size)','border-width':1.5,'border-color':'data(color)','border-opacity':.35,label:'data(label)',color:'#d5e2ee','font-size':10,'font-family':'Segoe UI, sans-serif','text-valign':'bottom','text-margin-y':9,'text-max-width':'100px','text-wrap':'ellipsis','min-zoomed-font-size':8,'text-outline-color':'#101d30','text-outline-width':2,'overlay-opacity':0}},
    {selector:'node[type="Document"]',style:{shape:'round-rectangle',label:'','background-opacity':.7}},
    {selector:'node[type="CareGap"]',style:{shape:'diamond',label:''}},
    {selector:'node[type="Intervention"]',style:{shape:'round-rectangle',width:34,height:28,'text-max-width':130}},
    {selector:'edge',style:{width:1,'line-color':'#6c87a5',opacity:.23,'curve-style':'bezier','target-arrow-shape':'triangle','target-arrow-color':'#6c87a5','arrow-scale':.5,'overlay-opacity':0}},
    {selector:'edge[status="resolved"]',style:{'line-style':'dashed','line-color':'#bcc1ce',opacity:.22}},
    {selector:'.faded',style:{opacity:.12}},
    {selector:'.path',style:{opacity:1,'border-width':3,'border-color':'#e4fff5','line-color':'#77e0c6','target-arrow-color':'#77e0c6',width:2}},
    {selector:'node.path',style:{width:'data(size)',height:'data(size)'}},
    {selector:'node:selected',style:{'border-width':4,'border-color':'#fff','overlay-opacity':.12,'overlay-color':'#82efd1','overlay-padding':10,label:'data(label)'}},
    {selector:'edge:selected',style:{opacity:1,width:3,'line-color':'#fff',label:'data(label)','font-size':9,color:'#fff','text-background-color':'#15283d','text-background-opacity':1,'text-background-padding':4}},
    {selector:'.tool-hit',style:{'border-width':4,'border-color':'#fff2b9','line-color':'#f1c474','target-arrow-color':'#f1c474',opacity:1}},
    {selector:'.hidden-type',style:{display:'none'}}
  ]});
  if(mode==='patient'||mode==='ontology'){
    cy.style().selector('node').style({'font-size':12,'text-wrap':'wrap','text-max-width':145,'text-margin-y':12,'min-zoomed-font-size':0}).selector('node[type="Document"], node[type="CareGap"]').style({label:'data(label)',width:23,height:23}).selector('edge').style({opacity:.55,label:el=>String(el.data('type')).toLowerCase().replaceAll('_',' '),'font-size':9,color:'#a9c4d8','text-background-color':'#101d30','text-background-opacity':1,'text-background-padding':3,'text-rotation':'autorotate'}).update();
    // Cytoscape treats a string root as a selector, not an element ID. Passing
    // "P0412" selected nothing and flattened every node into one unreadable row.
    const roots=cy.nodes().filter(node=>node.data('type')==='Patient');
    if(mode==='patient'&&roots.length===1){
      // Patient stories use semantic lanes: sources on the left, care facts on
      // the right, and the barrier-to-support path down the center.
      const lanes={Patient:{x:0,y:-190,step:0},Document:{x:-220,y:-80,step:120},Condition:{x:220,y:-190,step:100},CareGap:{x:220,y:-30,step:140},Barrier:{x:0,y:100,step:170},Intervention:{x:0,y:280,step:170}};
      const counts={};
      cy.nodes().forEach(node=>{const type=node.data('type'),index=counts[type]||0;counts[type]=index+1;const lane=lanes[type]||{x:0,y:0,step:100};node.position({x:lane.x+(type==='Barrier'||type==='Intervention'?index*lane.step:0),y:lane.y+(type==='Barrier'||type==='Intervention'?0:index*lane.step)});});
      cy.layout({name:'preset',padding:55,fit:true}).run();
    }else cy.layout({name:'breadthfirst',directed:true,roots,spacingFactor:1.25,padding:55,animate:false}).run();
  }
  const select=node=>{cy.elements().removeClass('faded path');if(node.isNode()){const neighborhood=node.closedNeighborhood();if(mode!=='patient')cy.elements().difference(neighborhood).addClass('faded');neighborhood.addClass('path');}onSelect?.(node.data(),node.isEdge());};
  cy.on('tap','node, edge',ev=>select(ev.target));
  cy.on('tap',ev=>{if(ev.target===cy){cy.elements().removeClass('faded path');cy.elements().unselect();onSelect?.(null);}});
  return {destroy:()=>cy.destroy(),fit:()=>{cy.elements().removeClass('faded path');cy.fit(cy.elements(':visible'),55);},zoom:delta=>cy.zoom({level:cy.zoom()*delta,renderedPosition:{x:cy.width()/2,y:cy.height()/2}}),select:id=>{const n=cy.getElementById(id);if(n.length){n.select();select(n);if(mode==='patient'||mode==='ontology')cy.fit(cy.elements(':visible'),55);else cy.animate({center:{eles:n},zoom:Math.max(cy.zoom(),.8)},{duration:250});return true;}return false;},filter:types=>{cy.nodes().forEach(n=>n.toggleClass('hidden-type',!types.has(n.data('type'))));cy.edges().forEach(ed=>ed.toggleClass('hidden-type',ed.source().hasClass('hidden-type')||ed.target().hasClass('hidden-type')));},highlight:event=>{cy.elements().removeClass('tool-hit');for(const item of event.nodes||[]){const id=typeof item==='string'?item:item.id;const found=cy.getElementById(id||'');if(found.length)found.addClass('tool-hit');else cy.nodes().filter(n=>n.data('type')===id||n.data('type')===item?.type).addClass('tool-hit');}for(const item of event.edges||[]){const type=typeof item==='string'?item:item.type;const id=typeof item==='string'?item:item.id;cy.edges().filter(ed=>ed.data('type')===type||ed.id()===id||ed.id()==='edge:'+id).addClass('tool-hit');}},resize:()=>cy.resize()};
}
