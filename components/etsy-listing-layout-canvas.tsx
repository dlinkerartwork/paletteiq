'use client';

import { useRef } from 'react';
import type { ListingAsset, ListingPlacement } from '@/lib/etsy-listing-image-plan';

type Props = {
  assets: ListingAsset[];
  placements: ListingPlacement[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onChange: (positions: ListingPlacement[]) => void;
  backgroundUrl?: string;
  disabled?: boolean;
};
type DragData = {
  pointerId: number; index: number; mode: 'move' | 'resize' | 'rotate';
  startX: number; startY: number; rect: DOMRect; item: ListingPlacement;
  centerX: number; centerY: number; startAngle: number;
};
const clamp = (x:number,a:number,b:number) => Math.max(a,Math.min(b,x));
const normalizeAngle = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180;

/** One editor for the white pre-layout AND the post-generation layers.
 * Only source image URLs are drawn: never AI-generated replacement clipart.
 */
export default function EtsyListingLayoutCanvas({
  assets,placements,selectedIndex,onSelect,onChange,backgroundUrl,disabled=false
}:Props) {
  const drag = useRef<DragData|null>(null);
  const assetMap = new Map(assets.map(a => [a.id,a]));
  const begin = (event:React.PointerEvent<HTMLDivElement>, index:number, mode:'move'|'resize'|'rotate') => {
    if(disabled || event.button!==0) return;
    const rect = (mode==='move' ? event.currentTarget.parentElement : event.currentTarget.parentElement?.parentElement)?.getBoundingClientRect();
    const item = placements[index];
    if(!rect || !item || !rect.width || !rect.height) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(index);
    const centerX=rect.left+(item.x+item.width/2)*rect.width/100;
    const centerY=rect.top+(item.y+item.height/2)*rect.height/100;
    const startAngle=Math.atan2(event.clientY-centerY,event.clientX-centerX)*180/Math.PI;
    drag.current={pointerId:event.pointerId,index,mode,startX:event.clientX,startY:event.clientY,rect,item,centerX,centerY,startAngle};
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const update = (event:React.PointerEvent<HTMLDivElement>) => {
    const d=drag.current;
    if(!d || d.pointerId!==event.pointerId || disabled) return;
    event.preventDefault();
    const dx=100*(event.clientX-d.startX)/d.rect.width;
    const dy=100*(event.clientY-d.startY)/d.rect.height;
    const value=d.mode==='rotate'
      ? {...d.item, rotation:Math.round(normalizeAngle((d.item.rotation||0) +
          Math.atan2(event.clientY-d.centerY,event.clientX-d.centerX)*180/Math.PI-d.startAngle))}
      : d.mode==='resize'
        ? {...d.item,width:clamp(d.item.width+dx,2,100),height:clamp(d.item.height+dy,2,100)}
        : {...d.item,x:clamp(d.item.x+dx,0,100),y:clamp(d.item.y+dy,0,100)};
    onChange(placements.map((item,i)=>i===d.index?value:item));
  };
  const finish = (event:React.PointerEvent<HTMLDivElement>) => {
    if(drag.current?.pointerId===event.pointerId) drag.current=null;
  };
  return (
    <div>
      <div aria-label={backgroundUrl ? 'Editable composition over generated background' : 'White pre-layout canvas'}
        data-listing-layout-canvas="true"
        style={{
          position:'relative',aspectRatio:'1 / 1',width:'100%',boxSizing:'border-box',
          backgroundColor:'#fff', overflow:'hidden', border:'1px solid #dcd5cb',
          borderRadius:9, touchAction:'none', userSelect:'none',
          boxShadow:'0 2px 18px rgba(0,0,0,.06)'
        }}>
        {backgroundUrl && <img src={backgroundUrl} alt="Generated background and typography, separate from editable original clipart"
          draggable={false} style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',pointerEvents:'none'}}/>}
        {placements.map((p,i)=>{
          const source=assetMap.get(p.assetId);
          if(!source?.imageUrl) return null;
          const picked=selectedIndex===i;
          return <div key={p.assetId} data-original-asset-id={p.assetId}
            role="button" tabIndex={0} aria-label={'Select and drag '+source.name}
            onClick={()=>onSelect(i)}
            onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect(i);}}}
            onPointerDown={event=>begin(event,i,'move')}
            onPointerMove={update} onPointerUp={finish} onPointerCancel={finish}
            style={{
              position:'absolute',left:p.x+'%',top:p.y+'%',width:p.width+'%',height:p.height+'%',
              transform:'rotate('+(p.rotation||0)+'deg)',transformOrigin:'center',
              cursor:disabled?'default':'grab',touchAction:'none',
              border:picked?'2px dashed #dc6223':'1px solid transparent',
              boxSizing:'border-box', zIndex:picked?3:2
            }}>
            <img src={source.imageUrl} alt="" draggable={false} loading="lazy"
              style={{width:'100%',height:'100%',objectFit:'contain',pointerEvents:'none'}}/>
            {picked && !disabled && <div role="button" tabIndex={0} aria-label={'Rotate '+source.name}
              title="Drag to rotate original clipart"
              onPointerDown={e=>begin(e,i,'rotate')}
              onPointerMove={update} onPointerUp={finish} onPointerCancel={finish}
              style={{
                position:'absolute',top:-31,left:'50%',transform:'translateX(-50%)',
                width:26,height:26,display:'grid',placeItems:'center',fontSize:21,
                border:'2px solid white',borderRadius:'50%',background:'#216f65',color:'#fff',
                boxShadow:'0 2px 6px #3337',cursor:'grab',touchAction:'none',zIndex:5
              }}>⟳</div>}
            {picked && !disabled && <div aria-label={'Resize '+source.name}
              onPointerDown={e=>begin(e,i,'resize')}
              onPointerMove={update} onPointerUp={finish} onPointerCancel={finish}
              style={{
                position:'absolute',bottom:-6,right:-6,width:16,height:16,
                border:'2px solid white',borderRadius:4,background:'#db6326',
                boxShadow:'0 1px 4px #3337',cursor:'nwse-resize',touchAction:'none'
              }}/>}
          </div>;
        })}
        {!backgroundUrl && <div style={{position:'absolute',left:8,bottom:6,background:'#ffffffd9',
          borderRadius:5,padding:'3px 7px',pointerEvents:'none',fontSize:11,color:'#827769'}}>
          White pre-layout · 1024 × 1024
        </div>}
      </div>
      <small style={{display:'block',marginTop:6,color:'#74695f'}}>
        Drag original clipart to move, use the orange corner to resize, and drag the teal ⟳ handle to rotate (up to ±180°). Numeric placement controls also allow precise rotation. No AI call for canvas editing.
      </small>
    </div>
  );
}
