import { supabase } from '../lib/supabase';

export interface SaveGenerationParams {
  userId: string;
  generationType: 'image' | 'video' | '3d';
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

export async function save3DGeneration(params: {
  userId: string;
  inputPrompt: string;
  inputImageUrl: string;
  stoneName: string;
  stoneId: string;
  tripoTaskId: string;
  modelUrl: string;
  format: 'ply' | 'glb';
  modelVersion: string;
  tripoOutput: Record<string, unknown>;
}) {
  const { data, error } = await supabase
    .from('generations')
    .insert({
      user_id: params.userId,
      generation_type: '3d',
      input_prompt: params.inputPrompt,
      input_image_url: params.inputImageUrl,
      input_parameters: {
        stoneName: params.stoneName,
        stoneId: params.stoneId,
        tripoTaskId: params.tripoTaskId,
        modelVersion: params.modelVersion,
      },
      output_url: params.modelUrl,
      output_metadata: {
        taskId: params.tripoTaskId,
        modelVersion: params.modelVersion,
        format: params.format,
        tripoOutput: params.tripoOutput,
      },
      processing_time_ms: 0,
      model_used: 'tripo-v3.1',
      tags: ['3d', params.stoneName, params.stoneId].filter(Boolean) as string[],
    })
    .select()
    .single();

  return { data, error };
}

export async function get3DGenerations(userId: string, limit = 50, offset = 0) {
  const { data, error } = await supabase
    .from('generations')
    .select('*')
    .eq('user_id', userId)
    .eq('generation_type', '3d')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  return { data, error };
}

export interface ThreeDGenerationRequest {
  imageUrl: string;
  prompt?: string;
  userId?: string;
  stoneName?: string;
  stoneId?: string;
}

export interface ThreeDGenerationResponse {
  success: boolean;
  message?: string;
  data?: {
    id: string | null;
    modelUrl: string;
    format: 'ply' | 'glb';
    taskId: string;
    modelVersion: string;
    tripoOutput: Record<string, unknown>;
  };
  error?: string;
  details?: string;
}

export async function generate3DModel(params: ThreeDGenerationRequest): Promise<ThreeDGenerationResponse> {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
  const accessToken = localStorage.getItem('accessToken') || '';
  
  try {
    const response = await fetch(`${apiUrl}/api/3d/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(params),
    });

    const result = await response.json();
    return result;
  } catch (error) {
    return {
      success: false,
      error: 'Network error',
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export interface ThreeDStatusResponse {
  success: boolean;
  data?: {
    taskId: string;
    status: 'queued' | 'running' | 'success' | 'failed';
    progress: number;
    modelVersion: string;
    output: Record<string, unknown>;
  };
  error?: string;
  details?: string;
}

export async function check3DGenerationStatus(taskId: string): Promise<ThreeDStatusResponse> {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
  const accessToken = localStorage.getItem('accessToken') || '';
  
  try {
    const response = await fetch(`${apiUrl}/api/3d/status/${taskId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const result = await response.json();
    return result;
  } catch (error) {
    return {
      success: false,
      error: 'Network error',
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export interface ThreeDModelsResponse {
  success: boolean;
  models?: Array<{
    id: string;
    name: string;
    description: string;
    credits: string;
  }>;
  default?: string;
  error?: string;
  details?: string;
}

export async function get3DModels(): Promise<ThreeDModelsResponse> {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
  const accessToken = localStorage.getItem('accessToken') || '';
  
  try {
    const response = await fetch(`${apiUrl}/api/3d/models`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const result = await response.json();
    return result;
  } catch (error) {
    return {
      success: false,
      error: 'Network error',
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}