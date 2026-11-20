'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

type UpscaleCompareProps = { name: string; originalUrl: string; upscaledUrl: string; onClose: () => void };

export default function UpscaleCompare({ name, originalUrl, upscaledUrl, onClose }: UpscaleCompareProps) {
  const [imageSizes, setImageSizes] = useState<Record<string, { width: number; height: number } | null>>({});
  const sizeLabel = (url: string) => imageSizes[url] ? `${imageSizes[url].width} × ${imageSizes[url].height} px` : imageSizes[url] === null ? 'Unavailable' : 'Loading…';
  const [split, setSplit] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ kind: 'split' | 'pan'; pointerId: number; startX: number; startY: number; split: number; offset: { x: number; y: number } } | null>(null);

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const setMagnification = (next: number) => {
    const bounded = clamp(next, 1, 8);
    setZoom(bounded);
    if (bounded === 1) setOffset({ x: 0, y: 0 });
  };
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [onClose]);
  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const dividerX = bounds.left + bounds.width * split / 100;
    const kind = event.button === 0 && Math.abs(event.clientX - dividerX) <= 24 ? 'split' : 'pan';
    gesture.current = { kind, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, split, offset };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    if (current.kind === 'split') {
      setSplit(clamp(current.split + (event.clientX - current.startX) / bounds.width * 100, 0, 100));
    } else if (zoom > 1) {
      setOffset({ x: current.offset.x + event.clientX - current.startX, y: current.offset.y + event.clientY - current.startY });
    }
  };
  const endGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.pointerId === event.pointerId) gesture.current = null;
  };
  const imageStyle: React.CSSProperties = {
    position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain',
    transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
    transformOrigin: 'center center', pointerEvents: 'none', userSelect: 'none'
  };
  return <div role="presentation" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(15, 23, 42, 0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
    <div role="dialog" aria-modal="true" aria-label={`Compare original and upscaled: ${name}`} onClick={event => event.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(96vw, 1200px)', maxHeight: '96vh', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <strong>{name} · Original / Upscaled comparison</strong>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="outline-btn" type="button" onClick={() => setMagnification(zoom / 1.25)} aria-label="Zoom out">−</button>
          <span style={{ minWidth: 48, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button className="outline-btn" type="button" onClick={() => setMagnification(zoom * 1.25)} aria-label="Zoom in">+</button>
          <button className="outline-btn" type="button" onClick={() => { setMagnification(1); setOffset({ x: 0, y: 0 }); setSplit(50); }}>Reset</button>
          <button className="outline-btn" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
      <div aria-live="polite" style={{ display: 'flex', gap: 20, flexWrap: 'wrap', color: '#475569', fontSize: 13 }}>
        <span>Original: {sizeLabel(originalUrl)}</span>
        <span>Upscaled: {sizeLabel(upscaledUrl)}</span>
      </div>
      <div ref={canvasRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={endGesture} onPointerCancel={endGesture}
        onWheel={event => { if (event.deltaY !== 0) setMagnification(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15)); }}
        style={{ position: 'relative', height: 'min(75vh, 780px)', minHeight: 240, overflow: 'hidden', borderRadius: 8, backgroundColor: '#eee', backgroundImage: 'linear-gradient(45deg, #ddd 25%, transparent 25%), linear-gradient(-45deg, #ddd 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ddd 75%), linear-gradient(-45deg, transparent 75%, #ddd 75%)', backgroundSize: '24px 24px', backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0', touchAction: 'none', cursor: zoom > 1 ? 'grab' : 'col-resize' }}>
        <Image unoptimized src={originalUrl} onLoad={event => { const image = event.currentTarget; setImageSizes(old => ({ ...old, [originalUrl]: { width: image.naturalWidth, height: image.naturalHeight } })); }} onError={() => setImageSizes(old => ({ ...old, [originalUrl]: null }))} alt={`Original ${name}`} width={4096} height={4096} draggable={false} style={imageStyle}/>
        <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 0 0 ${split}%)`, pointerEvents: 'none' }}>
          <Image unoptimized src={upscaledUrl} onLoad={event => { const image = event.currentTarget; setImageSizes(old => ({ ...old, [upscaledUrl]: { width: image.naturalWidth, height: image.naturalHeight } })); }} onError={() => setImageSizes(old => ({ ...old, [upscaledUrl]: null }))} alt={`Upscaled ${name}`} width={4096} height={4096} draggable={false} style={imageStyle}/>
        </div>
        <div style={{ position: 'absolute', left: `${split}%`, top: 0, bottom: 0, width: 2, background: '#fff', boxShadow: '0 0 0 1px #444, 0 0 8px #222', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: '50%', border: '2px solid #fff', background: '#242424', color: '#fff', fontSize: 17 }}>↔</div>
        </div>
        <span style={{ position: 'absolute', top: 10, left: 10, padding: '4px 8px', borderRadius: 5, background: 'rgba(0,0,0,.7)', color: '#fff', pointerEvents: 'none' }}>Original</span>
        <span style={{ position: 'absolute', top: 10, right: 10, padding: '4px 8px', borderRadius: 5, background: 'rgba(0,0,0,.7)', color: '#fff', pointerEvents: 'none' }}>Upscaled</span>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <label htmlFor="upscale-compare-divider" style={{ whiteSpace: 'nowrap' }}>Compare</label>
        <input id="upscale-compare-divider" type="range" min="0" max="100" value={split} onChange={event => setSplit(Number(event.target.value))} aria-label="Comparison divider position" style={{ flex: 1 }}/>
      </div>
      <small style={{ color: '#64748b' }}>Drag the center line to compare · Zoom with buttons or mouse wheel · Drag the image to pan when zoomed · Esc to close</small>
    </div>
  </div>;
}

