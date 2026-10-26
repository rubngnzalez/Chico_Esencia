// Capa de datos del panel sobre Supabase (js/supabase.js vendido).
// El cliente se crea perezosamente: si js/config-supabase.js está vacío,
// panel.js ya muestra el aviso de configuración antes de usarlo.

export function configurado() {
  return typeof window.SUPABASE_CONFIGURADO === 'function' && window.SUPABASE_CONFIGURADO();
}

let cliente = null;

export function sb() {
  if (!configurado()) {
    throw new Error('La conexión con Supabase no está configurada: rellena js/config-supabase.js.');
  }
  if (!cliente) {
    cliente = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  }
  return cliente;
}

// Traduce errores de Supabase/PostgREST a mensajes claros en español
export function mensajeError(error) {
  if (!error) return 'Error desconocido.';
  const codigo = error.code || error.details || '';
  if (error.code === '23505') return 'Ya existe un registro con ese valor único (email o slug repetido).';
  if (error.code === '23503') return 'Ese valor apunta a un registro que no existe (categoría o producto borrado).';
  if (error.code === '42501' || error.message?.includes('row-level security')) {
    return 'Tu rol no tiene permiso para esta operación.';
  }
  return `${error.message || 'Error de conexión.'}${codigo && !error.message ? ` (${codigo})` : ''}`;
}

// Ejecuta una consulta y lanza un Error legible si falla
export async function asegurar(promesa) {
  const { data, error } = await promesa;
  if (error) throw new Error(mensajeError(error));
  return data;
}

// ---- uploads al bucket «recursos» (devuelve la URL pública COMPLETA) ----

const EXTENSION_PERMITIDAS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function subirImagen(archivo) {
  if (archivo.size > 5 * 1024 * 1024) {
    throw new Error(`«${archivo.name}» supera el límite de 5 MB.`);
  }
  const tipo = EXTENSION_PERMITIDAS[archivo.type];
  if (!tipo) {
    throw new Error(`«${archivo.name}» no es JPEG, PNG ni WebP.`);
  }
  const aleatorio = crypto.getRandomValues(new Uint32Array(2)).join('');
  const ruta = `subidas/${Date.now()}-${aleatorio}.${tipo}`;
  const respuesta = await sb().storage
    .from('recursos')
    .upload(ruta, archivo, { contentType: archivo.type, upsert: false });
  if (respuesta.error) throw new Error(mensajeError(respuesta.error));
  const { data } = sb().storage.from('recursos').getPublicUrl(ruta);
  return data.publicUrl; // se guarda en productos.imagenes / articulos.imagen_portada
}

export function urlImagen(ruta) {
  if (!ruta) return '';
  if (/^(https?:)?\/\//.test(ruta) || ruta.startsWith('data:')) return ruta;
  return '/' + String(ruta).replace(/^\/+/, '');
}

// ---- helpers de sesión/rol ----

export async function perfilDe(uid) {
  const datos = await asegurar(sb().from('usuarios').select('id, nombre, email, rol, activo').eq('id', uid).maybeSingle());
  return datos;
}

// Llama a una Edge Function con la sesión actual (fase 2; opcional)
export async function invocarFuncion(nombre, cuerpo) {
  const { data, error } = await sb().functions.invoke(nombre, { body: cuerpo });
  if (error) throw new Error(mensajeError(error));
  return data;
}
