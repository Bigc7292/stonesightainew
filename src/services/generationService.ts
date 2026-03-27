import { supabase } from '../lib/supabase';

export interface SaveGenerationParams {
  userId: string;
  generationType: 'image' | 'video';
  inputPrompt?: string;
  inputImageUrl?: string;
  inputParameters?: Record<string, unknown>;
  outputUrl: string;
  outputMetadata?: Record<string, unknown>;
  processingTimeMs?: number;
  modelUsed?: string;
  tags?: string[];
}

export async function saveGeneration(params: SaveGenerationParams) {
  const { data, error } = await supabase
    .from('generations')
    .insert({
      user_id: params.userId,
      generation_type: params.generationType,
      input_prompt: params.inputPrompt,
      input_image_url: params.inputImageUrl,
      input_parameters: params.inputParameters,
      output_url: params.outputUrl,
      output_metadata: params.outputMetadata,
      processing_time_ms: params.processingTimeMs,
      model_used: params.modelUsed,
      tags: params.tags,
    })
    .select()
    .single();

  return { data, error };
}

export async function getUserGenerations(userId: string, limit = 50, offset = 0) {
  const { data, error } = await supabase
    .from('generations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  return { data, error };
}

export async function getAllGenerations(limit = 50, offset = 0) {
  const { data, error } = await supabase
    .from('generations')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  return { data, error };
}

export async function getGenerationById(id: string) {
  const { data, error } = await supabase
    .from('generations')
    .select('*')
    .eq('id', id)
    .single();

  return { data, error };
}

export async function deleteGeneration(id: string) {
  const { data, error } = await supabase
    .from('generations')
    .delete()
    .eq('id', id);

  return { data, error };
}
