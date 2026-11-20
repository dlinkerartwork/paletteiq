'use client';

import { useId, useState } from 'react';

/** Lightweight, local, illustrative CSS/SVG style examples. No AI calls or downloads. */
export type ThumbnailStyleKind = 'lettering' | 'cover' | 'boldness' | 'background' | 'decoration';
export type ThumbnailStyleOption = { value: string; label: string; description: string };
type Props = {
  label: string; kind: ThumbnailStyleKind; value: string;
  options: readonly ThumbnailStyleOption[];
  onChange: (value: string) => void; disabled?: boolean;
};

function Miniature({ kind, variant }: { kind: ThumbnailStyleKind; variant: string }) {
  const pathId = useId();
  const isLettering = kind === 'lettering';
  const paper = {
    editorial: 'linear-gradient(145deg,#fff9ed 12%,#e7e4d9 100%)',
    boutique: 'radial-gradient(circle at 10% 80%,#ead2d2 0 25%,transparent 50%),linear-gradient(115deg,#fffbf5,#f0e3dd)',
    storybook: 'radial-gradient(circle at 20% 20%,#dfd6ae,transparent 55%),linear-gradient(110deg,#faf3d8,#e8e1c7)',
    modern: 'linear-gradient(132deg,#fcdbc7 0 35%,#f7faf1 35% 65%,#d5e6df 65%)',
    watercolor: 'radial-gradient(ellipse at 24% 36%,#ecb6ab99,transparent 55%),radial-gradient(ellipse at 88% 70%,#a4bcb099,transparent 55%),#fff8ed',
    paper: 'repeating-linear-gradient(90deg,#eee8d9 0px,#f6f0e3 2px,#f1eadc 4px)',
    gradient: 'linear-gradient(135deg,#f5bbc9,#f5e6b8 46%,#bad7ce)',
    botanical: 'radial-gradient(ellipse at 8% 10%,#b7c5ac 0 14%,transparent 42%),radial-gradient(ellipse at 94% 87%,#91ac9a 0 12%,transparent 43%),#f8f3e5',
    vintage: 'repeating-linear-gradient(0deg,#ede0c8,#ede0c8 3px,#e8d8ba 4px,#f5e8d0 8px)',
    soft: 'radial-gradient(ellipse at 20% 20%,#e7bfc166,transparent 70%),#fff9ed',
    balanced: 'radial-gradient(ellipse at 20% 20%,#e4aab3 0 11%,transparent 46%),radial-gradient(ellipse at 90% 90%,#a5c7b1,transparent 48%),#fff4e4',
    vibrant: 'radial-gradient(ellipse at 16% 16%,#dc7489,transparent 47%),radial-gradient(ellipse at 95% 85%,#7dab9a,transparent 55%),#f9d7aa',
  } as Record<string, string>;
  const bg = paper[variant] || (isLettering ? 'linear-gradient(145deg,#fff9ec,#f0e0d6)' : '#f8f0e6');
  const ink = variant === 'modern' ? '#263c45' : variant === 'bold' ? '#234733' : '#514237';
  const typeBold = variant === 'soft' ? 400 : variant === 'balanced' ? 650 : 800;
  return (
    <div aria-hidden="true" style={{ position: 'relative', width: 82, height: 57, flexShrink: 0, borderRadius: 6, border: '1px solid #e2dbd0', overflow: 'hidden', background: bg, display: 'grid', placeItems: 'center' }}>
      {kind === 'lettering' ? (
        variant === 'arched' ? (
          <svg viewBox="0 0 100 65" style={{ width: '94%', height: '94%' }}>
            <defs><path id={pathId} d="M 9 42 Q 50 -4 91 42" /></defs>
            <text fill="#314f45" fontSize="17" fontWeight="bold" fontFamily="Georgia,serif">
              <textPath href={'#'+pathId} startOffset="50%" textAnchor="middle">Dreamy</textPath>
            </text>
            <text x="50" y="58" textAnchor="middle" fontSize="8" fill="#b25b5d">collection</text>
          </svg>
        ) : (
          <div style={{ textAlign: 'center', color: '#31534a', transform: variant === 'flowing' ? 'rotate(-8deg)' : variant === 'hand-painted' ? 'rotate(-5deg)' : 'none' }}>
            <span style={{ display: 'block', fontSize: variant === 'stacked' ? 13 : 18, lineHeight: 1.05, fontWeight: variant === 'hand-painted' ? 800 : 650, fontStyle: variant === 'auto' || variant === 'flowing' ? 'italic' : 'normal', fontFamily: variant === 'stacked' ? 'Georgia,serif' : 'cursive', letterSpacing: variant === 'hand-painted' ? '-.8px' : 0 }}>
              {variant === 'stacked' ? <>Dreamy<br/>Art</> : variant === 'hand-painted' ? 'ARTWORK' : 'Dreamy'}
            </span>
            {variant !== 'stacked' && <span style={{ fontFamily: 'Georgia,serif', fontSize: 9, color: '#ad6164', letterSpacing: 1 }}>collection</span>}
          </div>
        )
      ) : (
        <>
          {(kind === 'decoration' || kind === 'background') && <div style={{ position: 'absolute', inset: 5, border: variant === 'vibrant' || variant === 'vintage' ? '2px double #b78b6c88' : '1px solid #cbbaa055', borderRadius: '45% 55% 50% 50%' }}/>}
          <div style={{ textAlign: 'center', color: ink, zIndex: 1, transform: variant === 'modern' ? 'rotate(-4deg)' : 'none' }}>
            <div style={{ fontFamily: variant === 'boutique' ? 'cursive' : 'Georgia,serif', fontStyle: variant === 'watercolor' || kind === 'decoration' ? 'italic' : 'normal', fontSize: kind === 'boldness' ? (variant === 'soft' ? 12 : variant === 'balanced' ? 16 : 19) : 15, fontWeight: kind === 'boldness' ? typeBold : variant === 'modern' ? 900 : 650, letterSpacing: kind === 'boldness' && variant === 'soft' ? 1.2 : '-.4px', lineHeight: 1.1 }}>Etsy Art</div>
            <div style={{ fontSize: 8, fontFamily: 'Georgia,serif', letterSpacing: variant === 'modern' ? 2 : .7 }}>COLLECTION</div>
          </div>
        </>
      )}
    </div>
  );
}

export default function ThumbnailStylePreviewSelect({ label, kind, value, options, onChange, disabled = false }: Props) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const selected = options.find(item => item.value === value) || options[0];
  return (
    <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
      <button type="button" aria-label={label} aria-expanded={expanded} aria-controls={listId} aria-haspopup="listbox"
        disabled={disabled} onClick={() => setExpanded(v => !v)}
        style={{ width: '100%', border: '1px solid #d7c7b6', background: '#fff', borderRadius: 9, padding: 7, display: 'flex', textAlign: 'left', alignItems: 'center', gap: 8, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .55 : 1 }}>
        <Miniature kind={kind} variant={selected.value}/>
        <span style={{ minWidth: 0, flex: 1, display: 'grid', gap: 2 }}>
          <strong style={{ fontSize: 12, lineHeight: 1.2 }}>{selected.label}</strong>
          <span style={{ fontSize: 10, color: '#786d61', lineHeight: 1.25 }}>{selected.description}</span>
        </span>
        <span aria-hidden="true" style={{ fontSize: 13, color: '#a55a36' }}>{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && !disabled && (
        <div id={listId} role="listbox" aria-label={label + ' visual examples'} style={{ display: 'grid', gap: 5, maxHeight: 320, overflowY: 'auto', border: '1px solid #eadccd', borderRadius: 9, padding: 6, background: '#fffaf5' }}
          onKeyDown={event => { if (event.key === 'Escape') { setExpanded(false); event.stopPropagation(); } }}>
          {options.map(option => (
            <button key={option.value} type="button" role="option" aria-selected={value === option.value} onClick={() => { onChange(option.value); setExpanded(false); }}
              style={{ border: value === option.value ? '2px solid #d86c2b' : '1px solid #e8e1db', borderRadius: 8, textAlign: 'left', background: value === option.value ? '#fff3e6' : '#fff', padding: 6, display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <Miniature kind={kind} variant={option.value}/>
              <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                <strong style={{ fontSize: 12 }}>{option.label}</strong>
                <span style={{ fontSize: 10, lineHeight: 1.35, color: '#645b52' }}>{option.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <small style={{ fontSize: 10, color: '#776b61' }}>Contoh ilustratif (CSS/SVG), bukan hasil AI sebenarnya. Tidak menggunakan API.</small>
    </div>
  );
}
