// Utilidades del Worker: validaciones, slugs, ids y respuestas de error.
// Puerto fiel de servidor/src/utilidades.js (mismos mensajes en español).

export const ahora = () => new Date().toISOString();

const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function nuevoId(prefijo) {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return (prefijo ? prefijo + '_' : '') + hex;
}

export function tokenAleatorio(longitud = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(longitud));
  let resultado = '';
  for (let i = 0; i < longitud; i++) resultado += alfabeto[bytes[i] % alfabeto.length];
  return resultado;
}

export function slugificar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

export const limpiarTexto = (valor) => (typeof valor === 'string' ? valor.trim() : '');

export const esEmail = (valor) =>
  typeof valor === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor.trim());

export const esFechaISO = (valor) =>
  typeof valor === 'string' && valor.length >= 10 && !Number.isNaN(Date.parse(valor));

export function formatearEuro(valor) {
  const numero = Number(valor) || 0;
  try {
    return numero.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  } catch {
    return numero.toFixed(2) + ' €';
  }
}

// Comparación en tiempo constante sobre cadenas/texto
export function comparacionSegura(a, b) {
  const bufA = new TextEncoder().encode(String(a));
  const bufB = new TextEncoder().encode(String(b));
  if (bufA.length !== bufB.length) return false;
  let diferencia = 0;
  for (let i = 0; i < bufA.length; i++) diferencia |= bufA[i] ^ bufB[i];
  return diferencia === 0;
}

export function validar(esquema, entrada) {
  const errores = [];
  const datos = {};
  const cuerpo = entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {};

  for (const [campo, regla] of Object.entries(esquema)) {
    let valor = cuerpo[campo];
    const vacio =
      valor === undefined ||
      valor === null ||
      (typeof valor === 'string' && valor.trim() === '') ||
      (Array.isArray(valor) && valor.length === 0);

    if (vacio) {
      if (regla.defecto !== undefined) datos[campo] = regla.defecto;
      else if (regla.requerido) errores.push(`El campo «${campo}» es obligatorio.`);
      continue;
    }

    const etiqueta = regla.etiqueta || `«${campo}»`;

    switch (regla.tipo) {
      case 'texto': {
        if (typeof valor !== 'string') {
          errores.push(`El campo ${etiqueta} debe ser un texto.`);
          continue;
        }
        valor = valor.trim();
        if (regla.min && valor.length < regla.min) {
          errores.push(`El campo ${etiqueta} debe tener al menos ${regla.min} caracteres.`);
          continue;
        }
        if (regla.max && valor.length > regla.max) {
          errores.push(`El campo ${etiqueta} no puede superar ${regla.max} caracteres.`);
          continue;
        }
        datos[campo] = valor;
        break;
      }
      case 'email': {
        if (!esEmail(valor)) {
          errores.push(`El campo ${etiqueta} debe ser un correo electrónico válido.`);
          continue;
        }
        datos[campo] = valor.trim().toLowerCase();
        break;
      }
      case 'numero': {
        const numero = typeof valor === 'string' ? Number(valor.replace(',', '.')) : Number(valor);
        if (typeof valor === 'boolean' || !Number.isFinite(numero)) {
          errores.push(`El campo ${etiqueta} debe ser un número.`);
          continue;
        }
        if (regla.min !== undefined && numero < regla.min) {
          errores.push(`El campo ${etiqueta} debe ser mayor o igual que ${regla.min}.`);
          continue;
        }
        if (regla.max !== undefined && numero > regla.max) {
          errores.push(`El campo ${etiqueta} debe ser menor o igual que ${regla.max}.`);
          continue;
        }
        datos[campo] = Math.round(numero * 100) / 100;
        break;
      }
      case 'entero': {
        const numero = typeof valor === 'string' ? Number(valor) : valor;
        if (typeof numero !== 'number' || !Number.isFinite(numero) || !Number.isInteger(numero)) {
          errores.push(`El campo ${etiqueta} debe ser un número entero.`);
          continue;
        }
        if (regla.min !== undefined && numero < regla.min) {
          errores.push(`El campo ${etiqueta} debe ser mayor o igual que ${regla.min}.`);
          continue;
        }
        if (regla.max !== undefined && numero > regla.max) {
          errores.push(`El campo ${etiqueta} debe ser menor o igual que ${regla.max}.`);
          continue;
        }
        datos[campo] = numero;
        break;
      }
      case 'booleano': {
        if (typeof valor === 'boolean') datos[campo] = valor;
        else if (valor === 'true' || valor === 'false') datos[campo] = valor === 'true';
        else errores.push(`El campo ${etiqueta} debe ser verdadero o falso.`);
        break;
      }
      case 'matriz': {
        if (!Array.isArray(valor)) {
          errores.push(`El campo ${etiqueta} debe ser una lista.`);
          continue;
        }
        if (regla.tipoItems === 'texto') {
          const limpios = valor.map((item) => (typeof item === 'string' ? item.trim() : null));
          if (limpios.some((item) => item === null || item === '')) {
            errores.push(`El campo ${etiqueta} debe contener textos válidos.`);
            continue;
          }
          datos[campo] = limpios;
        } else if (regla.tipoItems === 'objeto') {
          if (valor.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
            errores.push(`El campo ${etiqueta} debe contener objetos válidos.`);
            continue;
          }
          datos[campo] = valor;
        } else {
          datos[campo] = valor;
        }
        break;
      }
      case 'objeto': {
        if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
          errores.push(`El campo ${etiqueta} debe ser un objeto.`);
          continue;
        }
        datos[campo] = valor;
        break;
      }
      case 'fecha': {
        if (!esFechaISO(valor)) {
          errores.push(`El campo ${etiqueta} debe ser una fecha válida.`);
          continue;
        }
        datos[campo] = new Date(valor).toISOString();
        break;
      }
      default: {
        datos[campo] = valor;
      }
    }

    if (regla.opciones && datos[campo] !== undefined && !regla.opciones.includes(datos[campo])) {
      errores.push(`El campo ${etiqueta} debe ser uno de: ${regla.opciones.join(', ')}.`);
    }
  }

  return { ok: errores.length === 0, datos, errores };
}

export function error400(errores) {
  return respuestaJson(
    { error: Array.isArray(errores) ? errores.join(' ') : String(errores) },
    400
  );
}

export function error401(mensaje = 'Debes iniciar sesión para realizar esta acción.') {
  return respuestaJson({ error: mensaje }, 401);
}

export function error403(mensaje = 'No tienes permisos para realizar esta acción.', extra = {}) {
  return respuestaJson({ error: mensaje, ...extra }, 403);
}

export function error404(mensaje = 'Recurso no encontrado.') {
  return respuestaJson({ error: mensaje }, 404);
}

export function respuestaJson(datos, estado = 200, cabeceras = {}) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cabeceras },
  });
}

// Clase de error con estado HTTP para errores de negocio (igual que el Node)
export class ErrorEstado extends Error {
  constructor(mensaje, estado = 400) {
    super(mensaje);
    this.estado = estado;
  }
}
