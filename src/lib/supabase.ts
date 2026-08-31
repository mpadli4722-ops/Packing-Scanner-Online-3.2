import { createClient } from "@supabase/supabase-js";

// Helper to safely extract Supabase environment variables in browser/Vite or Node environments
const supabaseUrl: string =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) ||
  (typeof import.meta !== "undefined" && import.meta.env?.SUPABASE_URL) ||
  (typeof process !== "undefined" && process.env?.SUPABASE_URL) ||
  "https://enfhcycilaambdkhdnjy.supabase.co";

const supabaseAnonKey: string =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  (typeof import.meta !== "undefined" && import.meta.env?.SUPABASE_ANON_KEY) ||
  (typeof process !== "undefined" && process.env?.SUPABASE_ANON_KEY) ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuZmhjeWNpbGFhbWJka2hkbmp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NTM3NTksImV4cCI6MjEwMzMyOTc1OX0.tDod26wLTqQAshq_6kIQv1myQKNTAUz2gS38Umppl_8";

/**
 * Official Supabase Client instance initialized for client-side and fullstack integration.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export default supabase;
