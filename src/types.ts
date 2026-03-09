export type StoneCategory = 'Quartz' | 'Dekton' | 'Marble' | 'Granite' | 'Quartzite';
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
