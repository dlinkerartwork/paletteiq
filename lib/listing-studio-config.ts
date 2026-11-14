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

/** Defaults used when Listing Studio is opened directly without legacy Thumbnail Designer. */
export const DEFAULT_LISTING_STUDIO_CONFIG: ListingStudioConfig = {
  layoutMode: 'ai',
  analysisProvider: 'openai',
  analysisModel: 'gpt-4.1-mini',
  imageModel: 'gpt-image-1-mini',
  quality: 'medium',
  typography: 'ai-artwork',
  boldness: 'balanced',
  hierarchy: 'dramatic',
  coverStyle: 'watercolor',
  backgroundStyle: 'watercolor',
  intensity: 'balanced',
  referenceStyle: 'similar',
};
