import { createClient } from '@supabase/supabase-js';

// The Supabase URL + anon key are public by design (protected by Row Level
// Security). They are safe to ship in the static bundle. Override via
// VITE_SUPABASE_* env vars when targeting a different project.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://kibqjztozokohqmhqqqf.supabase.co';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpYnFqenRvem9rb2hxbWhxcXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzQzNjIsImV4cCI6MjA4OTgxMDM2Mn0.J7qJUZhWXYf5b9oey4wXJkjdi66jomEMw_NeV9NWF7M';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
