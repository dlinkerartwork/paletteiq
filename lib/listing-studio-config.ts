// A snapshot of the Reference & Assets configuration selected at launch.
// The chosen original collection PNGs remain authoritative for compositing.
export type ListingStudioConfig = {
  layoutMode: 'ai' | 'manual';
  analysisProvider: 'openai' | 'gemini';
  analysisModel: string;
  imageModel: string;
  quality: 'low' | 'medium' | 'high';
  typography: 'ai-artwork';
  boldness: 'soft' | 'balanced' | 'bold';
  hierarchy: 'soft' | 'medium' | 'dramatic';
  coverStyle: 'editorial' | 'boutique' | 'storybook' | 'modern' | 'watercolor';
  backgroundStyle: 'watercolor' | 'paper' | 'gradient' | 'botanical' | 'vintage';
  intensity: 'soft' | 'balanced' | 'vibrant';
  referenceStyle: 'creative' | 'similar' | 'palette';
  referenceImage?: string;
  headline?: string;
};
