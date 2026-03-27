import { supabase } from '../lib/supabase';

export async function uploadFile(bucket: string, filePath: string, file: File) {
  return supabase.storage.from(bucket).upload(filePath, file, { upsert: true });
}

export async function uploadBase64(bucket: string, filePath: string, base64Data: string, contentType: string) {
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: contentType });

  return supabase.storage.from(bucket).upload(filePath, blob, {
    contentType,
    upsert: true,
  });
}

export function getPublicUrl(bucket: string, filePath: string) {
  return supabase.storage.from(bucket).getPublicUrl(filePath);
}

export async function listFiles(bucket: string, folder: string) {
  return supabase.storage.from(bucket).list(folder);
}

export async function deleteFile(bucket: string, filePath: string) {
  return supabase.storage.from(bucket).remove([filePath]);
}
