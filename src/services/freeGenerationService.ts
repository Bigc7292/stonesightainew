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
  conversionMethod: string;
  modelUrl: string;
  format: 'ply' | 'glb' | 'sog';
  modelVersion: string;
  converterOutput: Record<string, unknown>;
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
        conversionMethod: params.conversionMethod,
      },
      output_url: params.modelUrl,
      output_metadata: {
        format: params.format,
        conversionMethod: params.conversionMethod,
        modelVersion: params.modelVersion,
        converterOutput: params.converterOutput,
      },
      processing_time_ms: 0,
      model_used: params.conversionMethod,
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
    format: 'ply' | 'glb' | 'sog';
    viewerUrl: string;
    conversionMethod: string;
    message: string;
  };
  error?: string;
  details?: string;
}

export async function generate3DModelFree(params: ThreeDGenerationRequest): Promise<ThreeDGenerationResponse> {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
  const accessToken = localStorage.getItem('accessToken') || '';
  
  try {
    const response = await fetch(`${apiUrl}/api/3d-free/generate-free`, {
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

export async function get3DModelsFree(): Promise<ThreeDModelsResponse> {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
  const accessToken = localStorage.getItem('accessToken') || '';
  
  try {
    const response = await fetch(`${apiUrl}/api/3d-free/models`, {
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

// Free SuperSplat utilities for client-side use
export interface SuperSplatViewerOptions {
  splatUrl: string;
  posterUrl?: string;
  skyboxUrl?: string;
  collisionUrl?: string;
  noUi?: boolean;
  noAnim?: boolean;
  noFx?: boolean;
  webgl?: boolean;
  ministats?: boolean;
  colorize?: boolean;
  budget?: number;
}

export function generateSuperSplatViewerUrl(options: SuperSplatViewerOptions): string {
  const baseUrl = 'https://viewer.supersplat.ai';
  const params = new URLSearchParams({
    content: options.splatUrl,
  });

  if (options.posterUrl) params.set('poster', options.posterUrl);
  if (options.skyboxUrl) params.set('skybox', options.skyboxUrl);
  if (options.collisionUrl) params.set('collision', options.collisionUrl);
  if (options.noUi) params.set('noui', '1');
  if (options.noAnim) params.set('noanim', '1');
  if (options.noFx) params.set('nofx', '1');
  if (options.ministats) params.set('ministats', '1');
  if (options.colorize) params.set('colorize', '1');
  if (options.budget) params.set('budget', String(options.budget));
  
  return `${baseUrl}?${params.toString()}`;
}

export function generateSuperSplatEmbedCode(
  splatUrl: string,
  options?: {
    width?: string;
    height?: string;
    posterUrl?: string;
    skyboxUrl?: string;
  }
): string {
  const viewerUrl = generateSuperSplatViewerUrl({ splatUrl, ...options });
  const width = options?.width || '100%';
  const height = options?.height || '600px';
  
  return `<iframe 
    src="${viewerUrl}"
    width="${width}"
    height="${height}"
    frameborder="0"
    allow="xr-spatial-tracking; xr; fullscreen"
    allowfullscreen
    title="SuperSplat 3D Gaussian Splat Viewer"
    style="border: none; border-radius: 8px;"
  ></iframe>`;
}

export function generateStandaloneHtml(
  splatUrl: string,
  options?: {
    title?: string;
    posterUrl?: string;
    skyboxUrl?: string;
    backgroundColor?: string;
  }
): string {
  const viewerUrl = generateSuperSplatViewerUrl({ splatUrl, ...options });
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${options?.title || 'SuperSplat 3D Viewer'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; background: #0a0a0a; }
    iframe { width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>
  <iframe 
    src="${generateSuperSplatViewerUrl({ splatUrl, posterUrl: options?.posterUrl, skyboxUrl: options?.skyboxUrl })}"
    allow="xr-spatial-tracking; xr; fullscreen"
    allowfullscreen
    title="SuperSplat 3D Gaussian Splat Viewer"
  ></iframe>
  <script>
    const iframe = document.querySelector('iframe');
    function resize() {
      iframe.style.width = window.innerWidth + 'px';
      iframe.style.height = window.innerHeight + 'px';
    }
    window.addEventListener('resize', resize);
    resize();
  </script>
</body>
</html>`;
}