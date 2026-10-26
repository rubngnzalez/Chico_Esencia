// Conexión de la web con SUPABASE (panel estático sobre GitHub Pages).
// Rellena estos DOS valores con los datos del proyecto (Settings → API):
//   window.SUPABASE_URL = "https://TU_REF.supabase.co";
//   window.SUPABASE_ANON_KEY = "eyJhbGciOi...";  (clave «anon public»)
//
// Mientras estén VACÍOS, la web funciona en modo estático con los datos de
// datos-tienda.js (y pago.js firma en cliente con la clave de TEST de Redsys).
// La clave anon es pública por diseño: la seguridad la pone la RLS del esquema.
// Guía completa: supabase/LEEME-INSTALACION.md

window.SUPABASE_URL = "https://xtnzamagyztndpjhiqby.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0bnphbWFneXp0bmRwamhpcWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwMTIxNzUsImV4cCI6MjEwODU4ODE3NX0.cX5crIFMm-ei2L5BI45h75vmRRlFBbwHJXzwKeQZBeA";

// ¿Hay configuración? (helper compartido por panel y web)
window.SUPABASE_CONFIGURADO = () =>
  Boolean(window.SUPABASE_URL && window.SUPABASE_ANON_KEY);
