'use strict';

const fs = require('fs');
const path = require('path');

const CARPETA_DATOS = path.join(__dirname, '..', 'datos');
const CARPETA_SALIDA = path.join(CARPETA_DATOS, 'bandeja-salida');

const RUTA_SECRETO = path.join(CARPETA_DATOS, 'secreto-sesion.json');

const coleccionCache = new Map();

function asegurarCarpetas() {
  fs.mkdirSync(CARPETA_DATOS, { recursive: true });
  fs.mkdirSync(CARPETA_SALIDA, { recursive: true });
}

function escribirAtomico(ruta, contenido) {
  const temporal = `${ruta}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporal, contenido, 'utf8');
  fs.renameSync(temporal, ruta);
}

function leerJson(ruta, valorPorDefecto) {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch {
    return valorPorDefecto;
  }
}

function rutaArchivo(nombre) {
  return path.join(CARPETA_DATOS, `${nombre}.json`);
}

function fusionarProfundo(base, cambios) {
  const resultado = { ...base };
  for (const [clave, valor] of Object.entries(cambios || {})) {
    if (
      valor &&
      typeof valor === 'object' &&
      !Array.isArray(valor) &&
      base[clave] &&
      typeof base[clave] === 'object' &&
      !Array.isArray(base[clave])
    ) {
      resultado[clave] = fusionarProfundo(base[clave], valor);
    } else {
      resultado[clave] = valor;
    }
  }
  return resultado;
}

class Coleccion {
  constructor(nombre, valorInicial = []) {
    this.nombre = nombre;
    this.ruta = rutaArchivo(nombre);
    this.valorInicial = valorInicial;
  }

  leer() {
    if (coleccionCache.has(this.nombre)) return coleccionCache.get(this.nombre);
    const valor = leerJson(this.ruta, this.valorInicial);
    coleccionCache.set(this.nombre, valor);
    return valor;
  }

  guardar(valor) {
    coleccionCache.set(this.nombre, valor);
    escribirAtomico(this.ruta, JSON.stringify(valor, null, 2));
    return valor;
  }

  todo() {
    return this.leer().slice();
  }

  porId(id) {
    return this.leer().find((item) => item.id === id) || null;
  }

  insertar(objeto) {
    const lista = this.leer();
    lista.push(objeto);
    this.guardar(lista);
    return objeto;
  }

  modificar(id, cambios) {
    const lista = this.leer();
    const indice = lista.findIndex((item) => item.id === id);
    if (indice === -1) return null;
    lista[indice] = { ...lista[indice], ...cambios, id, actualizadoEn: new Date().toISOString() };
    this.guardar(lista);
    return lista[indice];
  }

  quitar(id) {
    const lista = this.leer();
    const indice = lista.findIndex((item) => item.id === id);
    if (indice === -1) return false;
    lista.splice(indice, 1);
    this.guardar(lista);
    return true;
  }
}

const ajustesRuta = rutaArchivo('ajustes');

class Ajustes {
  leer() {
    return leerJson(ajustesRuta, {});
  }

  guardar(valor) {
    escribirAtomico(ajustesRuta, JSON.stringify(valor, null, 2));
    return valor;
  }

  fusionar(seccion, cambios) {
    const actual = this.leer();
    const nuevo = fusionarProfundo(actual, { [seccion]: cambios });
    return this.guardar(nuevo);
  }
}

function guardarTexto(ruta, contenido) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  escribirAtomico(ruta, contenido);
}

function existeRuta(ruta) {
  return fs.existsSync(ruta);
}

function eliminarRuta(ruta) {
  fs.rmSync(ruta, { recursive: true, force: true });
}

function cargarOCrearSecreto() {
  const actual = leerJson(RUTA_SECRETO, null);
  if (actual && actual.valor) return actual.valor;
  const crypto = require('crypto');
  const valor = crypto.randomBytes(48).toString('hex');
  escribirAtomico(RUTA_SECRETO, JSON.stringify({ valor }, null, 2));
  return valor;
}

module.exports = {
  CARPETA_DATOS,
  CARPETA_SALIDA,
  asegurarCarpetas,
  escribirAtomico,
  leerJson,
  fusionarProfundo,
  Coleccion,
  Ajustes,
  guardarTexto,
  existeRuta,
  eliminarRuta,
  cargarOCrearSecreto,
};
