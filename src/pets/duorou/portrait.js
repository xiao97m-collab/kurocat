const W=420,H=440;
const vertexSource=`
attribute vec2 aPosition;
varying vec2 vPixel;
void main(){
  vPixel=aPosition;
  gl_Position=vec4(aPosition.x*2.0-1.0,1.0-aPosition.y*2.0,0.0,1.0);
}`;
const fragmentSource=`
precision highp float;
uniform sampler2D uMotion;
uniform sampler2D uViews;
uniform sampler2D uHDPortrait;
uniform bool uUseHD;
uniform vec2 uHDOrigin;
uniform vec2 uHDSize;
uniform vec2 uIndex;
uniform vec2 uTiles;
uniform vec2 uFaceShift;
uniform vec2 uBodyShift;
uniform vec2 uPawShift;
uniform bool uStroke;
uniform bool uStableTorso;
varying vec2 vPixel;
const vec2 SIZE=vec2(420.0,440.0);

void main(){
  vec2 p=vPixel*SIZE;
  float neck=1.0-smoothstep(192.0,284.0,p.y);
  float brisket=1.0-smoothstep(193.0,304.0,p.y);
  float pivot=(1.0-smoothstep(7.0,54.0,abs(p.x-122.0)))*
    smoothstep(235.0,307.0,p.y)*(1.0-smoothstep(323.0,349.0,p.y));
  // The complete face region has one rigid screen-space translation.
  // Only the connection below the jaw shares its shift with the chest.
  vec2 faceUv=(p-uFaceShift*neck-uBodyShift*brisket)/SIZE;
  vec2 bodyUv=(p-uBodyShift*brisket-uPawShift*pivot)/SIZE;
  vec2 tile=(uIndex+clamp(faceUv,vec2(0.0016),vec2(0.9984)))/uTiles;
  vec4 photo=texture2D(uViews,tile);
  if(uUseHD){
    vec2 q=(p-uBodyShift*brisket-uHDOrigin)/uHDSize;
    photo=any(lessThan(q,vec2(0.0)))||any(greaterThan(q,vec2(1.0)))?
      vec4(0.0):texture2D(uHDPortrait,q);
  }
  if(uStroke){
    vec4 motion=texture2D(uMotion,bodyUv);
    float upper=1.0-smoothstep(190.0,270.0,p.y);
    gl_FragColor=mix(motion,photo,upper);
  }else if(uStableTorso){
    vec4 torso=texture2D(uViews,(vec2(4.0,1.0)+bodyUv)/uTiles);
    gl_FragColor=mix(photo,torso,smoothstep(213.0,282.0,p.y));
  }else{
    gl_FragColor=photo;
  }
}`;

export function createPortraitPainter(views,metadata){
  const canvas=document.createElement('canvas');
  canvas.width=W*2;
  canvas.height=H*2;
  const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true});
  if(!gl)return {draw:source=>source};
  const program=gl.createProgram();
  for(const [type,source] of [[gl.VERTEX_SHADER,vertexSource],[gl.FRAGMENT_SHADER,fragmentSource]]){
    const shader=gl.createShader(type);
    gl.shaderSource(shader,source);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program,shader);
  }
  gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const quadBuffer=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,1,1]),gl.STATIC_DRAW);
  const vertex=gl.getAttribLocation(program,'aPosition');
  gl.enableVertexAttribArray(vertex);
  gl.vertexAttribPointer(vertex,2,gl.FLOAT,false,0,0);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
  function setupTexture(unit,image){
    gl.activeTexture(gl.TEXTURE0+unit);
    gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    if(image)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
  }
  setupTexture(1,views);
  setupTexture(2);
  setupTexture(0);
  const location=name=>gl.getUniformLocation(program,name);
  gl.uniform1i(location('uMotion'),0);
  gl.uniform1i(location('uViews'),1);
  gl.uniform1i(location('uHDPortrait'),2);
  const {columns,rows,features}=metadata;
  gl.uniform2f(location('uTiles'),columns,rows+1);
  const uniforms=Object.fromEntries(['uIndex','uFaceShift','uBodyShift','uPawShift','uStroke','uStableTorso','uUseHD','uHDOrigin','uHDSize'].map(name=>[name,location(name)]));
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.clearColor(0,0,0,0);
  let uploaded=null;
  let selectedX=(columns-1)/2;
  let selectedY=(rows-1)/2;
  const bound=(value,min,max)=>Math.max(min,Math.min(max,value));
  function followIndex(value,current,max,threshold=.58){
    if(Math.abs(value-current)>threshold)return bound(Math.round(value),0,max);
    return current;
  }

  function nosePosition(x,y){
    // Use the same path through the original anchors for both frame counts.
    const x0=Math.min(columns-3,2*Math.floor(x/2)),y0=Math.min(rows-2,Math.floor(y));
    const u=(x-x0)/2,v=y-y0;
    const A=features[y0*columns+x0],B=features[y0*columns+x0+2];
    const C=features[(y0+1)*columns+x0],D=features[(y0+1)*columns+x0+2];
    return [0,1].map(i=>(A[i]*(1-u)+B[i]*u)*(1-v)+(C[i]*(1-u)+D[i]*u)*v);
  }

  return {
    draw(image,tag,look,{x:sway,y:hunch,mouseX,mouseY,stroke,dense,restFrame,hd}){
      if(uploaded!==tag){
        gl.activeTexture(gl.TEXTURE0);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
        uploaded=tag;
      }
      const x=bound((look.head[0]*.95+look.eye[0]*.05+1)*(columns-1)/2,0,columns-1);
      const y=bound((look.head[1]*.95+look.eye[1]*.05+1)*(rows-1)/2,0,rows-1);
      const stride=dense?1:2;
      const current=selectedX%stride===0?selectedX/stride:Math.round(x/stride);
      selectedX=stride*followIndex(x/stride,current,(columns-1)/stride,dense?.64:.58);
      selectedY=followIndex(y,selectedY,rows-1);
      const target=nosePosition(x,y);
      const actual=features[selectedY*columns+selectedX];
      const resting=restFrame>0&&selectedX===4&&selectedY===1;
      gl.uniform2f(uniforms.uIndex,resting?restFrame:selectedX,resting?rows:selectedY);
      const maxX=dense?20:6, maxY=dense?14:5;
      gl.uniform2f(uniforms.uFaceShift,bound(target[0]-actual[0],-maxX,maxX),bound(target[1]-actual[1],-maxY,maxY));
      gl.uniform1i(uniforms.uUseHD,Number(Boolean(hd)));
      if(hd){
        gl.activeTexture(gl.TEXTURE2);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,hd.image);
        gl.uniform2fv(uniforms.uHDOrigin,hd.origin);
        gl.uniform2fv(uniforms.uHDSize,hd.size);
      }
      gl.uniform2f(uniforms.uBodyShift,sway,hunch);
      gl.uniform2f(uniforms.uPawShift,mouseX,mouseY);
      gl.uniform1i(uniforms.uStroke,Number(stroke));
      gl.uniform1i(uniforms.uStableTorso,Number(dense));
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      return canvas;
    },
    pose(){return [selectedX,selectedY];}
  };
}
