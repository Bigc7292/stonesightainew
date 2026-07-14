/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_API_URL: string;
  // add other env variables as needed...
  readonly MCP_ENV?: string;
  readonly MCP_TEST_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
