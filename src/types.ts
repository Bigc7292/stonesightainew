export type StoneCategory = 'Quartz' | 'Dekton' | 'Marble' | 'Granite';
export type StoneTone = 'Light' | 'Dark' | 'Warm';

export interface Stone {
  id: string;
  name: string;
  category: StoneCategory;
  tone: StoneTone;
  description: string;
  promptDescription?: string;
  swatchUrl: string;
}
