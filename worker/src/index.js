// Worker SHADDAI · Esencia de Umbral — panel y API en Cloudflare.
// Reescritura de servidor/ con el MISMO contrato de API (ver servidor/README.md):
// mismas rutas, mismas formas de respuesta {datos,total}/{dato}/{error},
// mismos mensajes en español, roles admin/editor/lector idénticos.
//
// El panel (servidor/panel) se sirve por assets en /panel/* y /admin/*
// (reescribiendo el pathname). El blog se sirve dinámico desde D1 en
// /news/articulo/<slug> y /news/articulos.json. Las imágenes van a R2 y se
// sirven en /recursos/<clave>.

import { Router } from './router.js';
import { Coleccion, Ajustes } from './db.js';
import { asegurarSemilla } from './semilla.js';
import { adjuntarUsuario, requerirSinCambio } from './seguridad.js';
import { respuestaJson } from './utilidades.js';
import { articuloPublicado, indicePublicados, plantillaArticulo } from './blog.js';
import { servirRecurso } from './rutas/subir-imagen.js';

import * as rutasAuth from './rutas/auth.js';
import * as rutasInstalacion from './rutas/instalacion.js';
import * as rutasProductos from './rutas/productos.js';
import * as rutasCategorias from './rutas/categorias.js';
import * as rutasOfertas from './rutas/ofertas.js';
import * as rutasTestimonios from './rutas/testimonios.js';
import * as rutasArticulos from './rutas/articulos.js';
import * as rutasMensajes from './rutas/mensajes.js';
import * as rutasSuscriptores from './rutas/suscriptores.js';
import * as rutasCampanas from './rutas/campanas.js';
import * as rutasAjustes from './rutas/ajustes.js';
import * as rutasPedidos from './rutas/pedidos.js';
import * as rutasUsuarios from './rutas/usuarios.js';
import * as rutasPublico from './rutas/publico.js';
import * as rutasSubirImagen from './rutas/subir-imagen.js';

// CORS solo para pruebas locales (mismo dominio en producción)
const CORS_ORIGENES = ['https://omshaddai.com'];
const CORS_CABECERAS = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Max-Age': '86400',
};

function cabecerasCors(request, extras = {}) {
  const origen = request.headers.get('Origin');
  const cabeceras = { ...CORS_CABECERAS, ...extras };
  if (origen && (CORS_ORIGENES.includes(origen) || /^http:\/\/localhost(:\d+)?$/.test(origen))) {
    cabeceras['Access-Control-Allow-Origin'] = origen;
    cabeceras['Vary'] = 'Origin';
  }
  return cabeceras;
}

function construirColecciones(db) {
  return {
    coleccionUsuarios: new Coleccion(db, 'usuarios', [['email', 'email']]),
    coleccionProductos: new Coleccion(db, 'productos', [
      ['codigo', 'codigo'],
      ['slug', 'slug'],
    ]),
    coleccionCategorias: new Coleccion(db, 'categorias', [['slug', 'slug']]),
    coleccionOfertas: new Coleccion(db, 'ofertas', [['producto', 'producto']]),
    coleccionTestimonios: new Coleccion(db, 'testimonios'),
    coleccionArticulos: new Coleccion(db, 'articulos', [
      ['slug', 'slug'],
      ['estado', 'estado'],
    ]),
    coleccionMensajes: new Coleccion(db, 'mensajes'),
    coleccionSuscriptores: new Coleccion(db, 'suscriptores', [['email', 'email']]),
    coleccionCampanas: new Coleccion(db, 'campanas', [['estado', 'estado']]),
    coleccionPedidos: new Coleccion(db, 'pedidos', [
      ['numero', 'numero'],
      ['estado', 'estado'],
    ]),
  };
}

function construirEnrutador(colecciones) {
  const enrutador = new Router();
  const contexto = colecciones;
  rutasInstalacion.registrar(enrutador, contexto);
  rutasAuth.registrar(enrutador, contexto);
  rutasProductos.registrar(enrutador, contexto);
  rutasCategorias.registrar(enrutador, contexto);
  rutasOfertas.registrar(enrutador, contexto);
  rutasTestimonios.registrar(enrutador, contexto);
  rutasArticulos.registrar(enrutador, contexto);
  rutasMensajes.registrar(enrutador, contexto);
  rutasSuscriptores.registrar(enrutador, contexto);
  rutasCampanas.registrar(enrutador, contexto);
  rutasAjustes.registrar(enrutador, contexto);
  rutasPedidos.registrar(enrutador, contexto);
  rutasUsuarios.registrar(enrutador, contexto);
  rutasPublico.registrar(enrutador, contexto);
  rutasSubirImagen.registrar(enrutador, contexto);
  return enrutador;
}

async function leerCuerpo(request, limiteBytes) {
  const tipo = (request.headers.get('Content-Type') || '').toLowerCase();
  const crudo = await request.text();
  if (crudo.length > limiteBytes) {
    return { error: 'El cuerpo de la petición es demasiado grande.' };
  }
  if (tipo.includes('application/x-www-form-urlencoded')) {
    const formulario = {};
    for (const [clave, valor] of new URLSearchParams(crudo)) formulario[clave] = valor;
    return { formulario };
  }
  if (!crudo) return { objeto: {} };
  try {
    return { objeto: JSON.parse(crudo) };
  } catch {
    return { error: 'El cuerpo de la petición no es un JSON válido.' };
  }
}

async function gestionarApi(request, env, ctx, url, enrutador, colecciones) {
  const coincidencia = enrutador.resolver(request.method, url.pathname);
  if (!coincidencia) {
    return respuestaJson({ error: 'Ruta de la API no encontrada.' }, 404);
  }

  const limite =
    coincidencia.patron === '/api/subir-imagen' ? 9 * 1024 * 1024 : 2 * 1024 * 1024;
  const cuerpo = request.method === 'GET' || request.method === 'HEAD'
    ? {}
    : await leerCuerpo(request, limite);
  if (cuerpo.error) {
    return respuestaJson({ error: cuerpo.error }, 400);
  }

  const cx = {
    request,
    env,
    ctx,
    url,
    db: env.DB,
    params: coincidencia.params,
    query: url.searchParams,
    usuario: null,
    cuerpo: cuerpo.objeto,
    cuerpoFormulario: cuerpo.formulario || {},
    ...colecciones,
  };

  cx.usuario = await adjuntarUsuario(colecciones.coleccionUsuarios, env, request);

  // Igual que el Node: con cambio de contraseña pendiente, todo /api menos
  // /api/auth/* responde 403 { debeCambiarContrasena: true }.
  const bloqueo = requerirSinCambio(cx, url.pathname);
  if (bloqueo) return bloqueo;

  return coincidencia.manejador(cx);
}

async function servirBlog(request, env, url) {
  const ruta = url.pathname;
  if (ruta === '/news/articulos.json') {
    const indice = await indicePublicados(env.DB);
    return new Response(JSON.stringify({ articulos: indice }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
    });
  }
  let slug = ruta.replace(/^\/news\/articulo\//, '').replace(/\/+$/, '');
  try {
    slug = decodeURIComponent(slug);
  } catch {}
  const articulo = slug ? await articuloPublicado(env.DB, slug) : null;
  if (!articulo) {
    return new Response(
      `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>No encontrado — SHADDAI</title><link rel="stylesheet" href="https://omshaddai.com/css/estilos.css"></head><body style="background:#f3eee2;color:#16261b;font-family:Georgia,serif;text-align:center;padding:6rem 1.5rem;"><h1>Artículo no encontrado</h1><p><a href="/news/" style="color:#a3823f;">← Volver al diario</a></p></body></html>`,
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
  return new Response(plantillaArticulo(articulo), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=120',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const ruta = url.pathname;

    try {
      // ── Preflight CORS (solo /api/*) ─────────────────────────────────────
      if (request.method === 'OPTIONS' && ruta.startsWith('/api/')) {
        return new Response(null, { status: 204, headers: cabecerasCors(request) });
      }

      // ── /admin y /admin/* — el mismo panel, reescrito sobre los assets ──
      if (ruta === '/admin' || ruta === '/panel') {
        return Response.redirect(new URL(ruta + '/' + url.search, url), 308);
      }
      if (ruta.startsWith('/admin/') || ruta.startsWith('/panel/')) {
        const prefijo = ruta.startsWith('/admin/') ? '/admin' : '/panel';
        const nuevaUrl = new URL(request.url);
        nuevaUrl.pathname = ruta.slice(prefijo.length) || '/';
        return env.ASSETS.fetch(new Request(nuevaUrl, request));
      }

      // ── API ──────────────────────────────────────────────────────────────
      if (ruta.startsWith('/api/')) {
        await asegurarSemilla(env.DB);
        const respuesta = await gestionarApi(request, env, ctx, url, ENRUTADOR(env), COLECCIONES(env));
        const conCors = new Response(respuesta.body, respuesta);
        for (const [k, v] of Object.entries(cabecerasCors(request))) conCors.headers.set(k, v);
        return conCors;
      }

      // ── Imágenes en R2 ───────────────────────────────────────────────────
      if (ruta.startsWith('/recursos/')) {
        return servirRecurso(env, ruta.slice('/recursos/'.length));
      }

      // ── Blog dinámico ────────────────────────────────────────────────────
      if (ruta === '/news/articulos.json' || ruta.startsWith('/news/articulo/')) {
        return servirBlog(request, env, url);
      }

      // ── Resto: assets del panel (SPA) ────────────────────────────────────
      return env.ASSETS.fetch(request);
    } catch (error) {
      const estado = error.estado || error.status || 500;
      if (estado >= 500) console.error('Error inesperado:', error);
      return respuestaJson({ error: error.message || 'Error interno del servidor.' }, estado);
    }
  },
};

// El enrutador y las colecciones se construyen una vez por aislado
// (las instancias reciben el db de cada petición vía cx).

let _colecciones = null;
let _enrutador = null;

function COLECCIONES(env) {
  if (!_colecciones) _colecciones = construirColecciones(env.DB);
  return _colecciones;
}

function ENRUTADOR(env) {
  if (!_enrutador) _enrutador = construirEnrutador(_colecciones || COLECCIONES(env));
  return _enrutador;
}
