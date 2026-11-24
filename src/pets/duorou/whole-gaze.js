export function createWholeGaze(pages,{origin,size,tiles,frames,samples,routes,hold,breath,keySample,alignment},nodAtlas,nod){
  const [width,height]=size;
  const [columns,rows]=tiles;
  const capacity=columns*rows;
  const canvas=document.createElement('canvas');
  canvas.width=width*2;
  canvas.height=height*2;
  const ctx=canvas.getContext('2d');
  const selectable=samples.map((sample,i)=>sample.settle?i:null).filter(i=>i!==null);
  const breathCycle=2*breath.length-2;
  let current=0,goal=0,shown=-1,previous=null,budget=0;
  let nodProgress=0,nodTarget=0,shownNod=null,nodActive=false;
  const lastNod=nod.frames.length-1;

  function paint(id){
    if(id===shown&&shownNod===null)return canvas;
    shownNod=null;
    shown=id;
    const index=id%capacity;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(pages[Math.floor(id/capacity)],index%columns*canvas.width,Math.floor(index/columns)*canvas.height,
      canvas.width,canvas.height,0,0,canvas.width,canvas.height);
    return canvas;
  }

  function paintNod(){
    const target=Math.round(nodProgress*lastNod);
    const index=shownNod===null?0:shownNod+Math.sign(target-shownNod);
    if(shownNod===index)return canvas;
    shownNod=index;
    const [w,h]=nod.size.map(value=>value*2);
    const column=index%nod.columns,row=Math.floor(index/nod.columns);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(nodAtlas,column*w,row*h,w,h,(nod.origin[0]-origin[0])*2,(nod.origin[1]-origin[1])*2,w,h);
    return canvas;
  }

  function matchesDirection(target,x,y){
    const pose=samples[target];
    const dx=pose.x-x;
    const dy=pose.y-y;
    const isOffSide=Math.abs(x)>.47&&Math.sign(x)*pose.x<.31;
    return (1+1.4*Math.abs(x))*dx*dx+1.22*dy*dy+(isOffSide?.31:0);
  }

  function destination(x,y){
    x*=.91;
    y*=.9;
    if(Math.hypot(x,y)<.055)return 0;
    // The source jumps from neutral to a deep centered nod. Bring the
    // supported lower diagonal range in as the pointer leaves the center.
    if(y>0){
      const diagonal=Math.max(0,Math.min(1,(Math.abs(x)-.11)/.18));
      y=Math.min(y,.33+.62*diagonal*diagonal*(3-2*diagonal));
    }
    if(Math.abs(y)<.14)y*=.55;
    let best=current,bestDistance=Infinity;
    for(const id of selectable){
      if(id!==current&&routes[current][id]===current)continue;
      const distance=matchesDirection(id,x,y);
      if(distance<bestDistance){best=id;bestDistance=distance;}
    }
    if((goal===current||routes[current][goal]!==current)&&matchesDirection(goal,x,y)<=bestDistance+.001)return goal;
    return best;
  }

  return {
    /** @param {number | null} breathElapsed */
    draw(x,y,now,breathElapsed=null,keyPose=false){
      const dt=previous===null?16:Math.min(30,Math.max(0,now-previous));
      previous=now;
      nodActive=!keyPose&&Math.abs(x)<(nodActive?.255:.18)&&y>(nodActive?.16:.25);
      nodTarget=nodActive?Math.max(0,Math.min(1,(y-.19)/.64)):0;
      goal=keyPose?keySample:(nodActive||nodProgress>0)?0:destination(x,y);
      if(current===0&&(nodTarget>0||nodProgress>0||shownNod>0)){
        const rate=Math.min(dt/335,1/lastNod);
        nodProgress+=Math.max(-rate,Math.min(rate,nodTarget-nodProgress));
        if(nodProgress>0||shownNod>0)return paintNod();
      }
      let next=routes[current][goal];
      if(current!==next){
        const difference=frames[next]-frames[current];
        const step=current+Math.sign(difference);
        const retainSourceFrames=Math.abs(difference)>=3&&Math.abs(difference)<=5&&frames[step]===frames[current]+Math.sign(difference);
        if(retainSourceFrames)next=step;
        budget+=dt;
        const duration=retainSourceFrames?20:hold[current][next];
        if(budget>=duration){
          current=next;
          budget=Math.min(24,budget-duration);
        }
      }else{
        budget=0;
      }
      if(breathElapsed!==null&&current===0&&goal===0){
        const phase=Math.floor(Math.max(0,breathElapsed)/115)%breathCycle;
        return paint(breath[phase<breath.length?phase:breathCycle-phase]);
      }
      return paint(current);
    },
    atKeyPose(){return current===keySample;},
    adoptKeyPose(){
      current=keySample;
      goal=keySample;
      budget=0;
      nodProgress=0;
      nodActive=false;
    },
    moving(){return routes[current][goal]!==current||Math.abs(nodProgress-nodTarget)>.001;},
    pose(){
      if(shownNod!==null){
        const target=Math.round(nodTarget*lastNod);
        return {ids:[shownNod,shownNod,target],sourceFrames:[nod.frames[shownNod],nod.frames[target]],
          sampled:[0,nodProgress],alignment:[0,0],source:'nod',nod:true};
      }
      return {ids:[shown,current,goal],sourceFrames:[frames[current],frames[goal]],
        sampled:[samples[current].x,samples[current].y],alignment:alignment[current],source:'ring'};
    },
  };
}
