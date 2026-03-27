import { supabase } from '../lib/supabase';

export async function storeMemory(
  memoryType: string,
  content: Record<string, unknown>,
  sourceGenerationId?: string,
  relevanceScore: number = 1.0
) {
  const { data, error } = await supabase
    .from('ai_memory')
    .insert({
      memory_type: memoryType,
      content,
      source_generation_id: sourceGenerationId,
      relevance_score: relevanceScore,
    })
    .select()
    .single();

  return { data, error };
}

export async function getMemories(memoryType: string, limit = 50) {
  const { data, error } = await supabase
    .from('ai_memory')
    .select('*')
    .eq('memory_type', memoryType)
    .order('relevance_score', { ascending: false })
    .limit(limit);

  return { data, error };
}

export async function getAllMemories(limit = 50) {
  const { data, error } = await supabase
    .from('ai_memory')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  return { data, error };
}

export async function extractAndStorePatterns(generation: {
  id: string;
  generation_type: string;
  input_parameters?: Record<string, unknown>;
  processing_time_ms?: number;
  model_used?: string;
  tags?: string[];
}) {
  const patterns: Record<string, unknown> = {};

  if (generation.input_parameters) {
    const params = generation.input_parameters;
    if (params.stoneName) patterns.stone_type = params.stoneName;
    if (params.stoneCategory) patterns.stone_category = params.stoneCategory;
    if (params.stoneTone) patterns.stone_tone = params.stoneTone;
  }

  if (generation.processing_time_ms) {
    patterns.processing_time_ms = generation.processing_time_ms;
  }
  if (generation.model_used) {
    patterns.model_used = generation.model_used;
  }
  if (generation.tags) {
    patterns.tags = generation.tags;
  }
  patterns.generation_type = generation.generation_type;

  return storeMemory('pattern', patterns, generation.id, 0.8);
}

export async function searchMemories(query: string) {
  const { data, error } = await supabase
    .from('ai_memory')
    .select('*')
    .textSearch('content', query)
    .order('relevance_score', { ascending: false });

  return { data, error };
}
