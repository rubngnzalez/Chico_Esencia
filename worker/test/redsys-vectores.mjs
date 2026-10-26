// Test de vectores: la firma del Worker (3DES en JS puro + HMAC Web Crypto)
// debe coincidir EXACTAMENTE con la del módulo Node servidor/src/redsys.js
// (des-ede3 de Node crypto). Ejecutar: node test/redsys-vectores.mjs

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const aqui = path.dirname(fileURLToPath(import.meta.url));
const raizRepo = path.resolve(aqui, '..', '..');

const rutaNode = path.join(raizRepo, 'servidor', 'src', 'redsys.js');
if (!fs.existsSync(rutaNode)) {
  console.error('No se encontró servidor/src/redsys.js (el test lo compara con el Worker).');
  process.exit(1);
}
const redsysNode = require(rutaNode);
const redsysWorker = await import(pathToFileURL(path.join(raizRepo, 'worker', 'src', 'redsys.js')).href);

const CLAVE_TEST = 'sq7HjrUOBf2m7spUjazlA'; // clave de pruebas de Redsys

const pedidos = [
  '261023120000',
  '1',
  'ABC123XYZ789',
  '999999999999',
  'A-1_B',
];

let ok = 0;
let total = 0;

function comparar(nombre, valorNode, valorWorker) {
  total++;
  const bn = Buffer.from(String(valorNode));
  const bw = Buffer.from(String(valorWorker));
  const igual = bn.length === bw.length && bn.equals(bw);
  if (igual) {
    ok++;
    console.log(`  ✓ ${nombre}`);
  } else {
    console.error(`  ✗ ${nombre}`);
    console.error(`    Node:   ${valorNode}`);
    console.error(`    Worker: ${valorWorker}`);
  }
}

console.log('Comprobando claves de operación (3DES-ECB + PKCS7)…');
for (const pedido of pedidos) {
  const node = redsysNode.claveDeOperacion(CLAVE_TEST, pedido);
  const worker = redsysWorker.claveDeOperacion(CLAVE_TEST, pedido);
  comparar(`claveDeOperacion(pedido=${pedido})`, node.toString('hex'), Buffer.from(worker).toString('hex'));
}

// Claves de longitudes distintas (normalización a 24 bytes)
console.log('Comprobando normalización de claves (24/16/otro bytes)…');
const claves = [
  Buffer.from('0123456789abcdef01234567').toString('base64'),
  Buffer.from('0123456789abcdef').toString('base64'),
  Buffer.from('0123456789abc').toString('base64'),
];
for (const clave of claves) {
  const node = redsysNode.claveDeOperacion(clave, 'PRUEBA1');
  const worker = redsysWorker.claveDeOperacion(clave, 'PRUEBA1');
  comparar(`claveDeOperacion(clave ${Buffer.from(clave, 'base64').length} bytes)`, node.toString('hex'), Buffer.from(worker).toString('hex'));
}

console.log('Comprobando firmas HMAC_SHA256_V1 completas…');
const parametros = {
  DS_MERCHANT_AMOUNT: '6090',
  DS_MERCHANT_ORDER: '261023120000',
  DS_MERCHANT_MERCHANTCODE: '999008889',
  DS_MERCHANT_CURRENCY: '978',
  DS_MERCHANT_TRANSACTIONTYPE: '0',
  DS_MERCHANT_TERMINAL: '1',
  DS_MERCHANT_PAYMETHODS: 'C',
};
for (const pedido of pedidos) {
  const copia = { ...parametros, DS_MERCHANT_ORDER: pedido };
  const b64 = Buffer.from(JSON.stringify(copia), 'utf8').toString('base64');
  const firmaNode = redsysNode.firmarParametros(b64, pedido, CLAVE_TEST);
  const firmaWorker = await redsysWorker.firmarParametros(b64, pedido, CLAVE_TEST);
  comparar(`firmarParametros(pedido=${pedido})`, firmaNode, firmaWorker);
}

// Verificación de notificaciones cruzada: el Worker verifica lo firmado por Node
console.log('Comprobando verificación cruzada de notificaciones…');
{
  const datos = { Ds_Order: '261023120000', Ds_Amount: '6090', Ds_Response: '0000', Ds_Date: '25/10/2026' };
  const b64 = Buffer.from(JSON.stringify(datos), 'utf8').toString('base64');
  const firma = redsysNode.firmarParametros(b64, datos.Ds_Order, CLAVE_TEST);
  const verificacion = await redsysWorker.verificarNotificacion(
    { Ds_Merchant_Parameters: b64, Ds_Signature: firma, Ds_Signature_Version: 'HMAC_SHA256_V1' },
    CLAVE_TEST
  );
  total++;
  if (verificacion.ok && verificacion.autorizado && verificacion.importe === 6090) {
    ok++;
    console.log('  ✓ notificación firmada por Node verificada por el Worker (autorizada)');
  } else {
    console.error('  ✗ notificación no verificada:', verificacion);
  }
}
{
  const datos = { Ds_Order: '261023120000', Ds_Amount: '6090', Ds_Response: '0180' };
  const b64 = Buffer.from(JSON.stringify(datos), 'utf8').toString('base64');
  const firma = redsysNode.firmarParametros(b64, datos.Ds_Order, CLAVE_TEST);
  const verificacion = await redsysWorker.verificarNotificacion(
    { Ds_Merchant_Parameters: b64, Ds_Signature: firma, Ds_Signature_Version: 'HMAC_SHA256_V1' },
    CLAVE_TEST
  );
  total++;
  if (verificacion.ok && !verificacion.autorizado) {
    ok++;
    console.log('  ✓ respuesta 0180 detectada como no autorizada');
  } else {
    console.error('  ✗ respuesta 0180 mal clasificada:', verificacion);
  }
}
{
  const verificacion = await redsysWorker.verificarNotificacion(
    { Ds_Merchant_Parameters: Buffer.from('{"Ds_Order":"X"}').toString('base64'), Ds_Signature: 'falsamente-firmada' },
    CLAVE_TEST
  );
  total++;
  if (!verificacion.ok && verificacion.motivo === 'La firma de la notificación no es válida.') {
    ok++;
    console.log('  ✓ firma inválida rechazada con el mensaje exacto');
  } else {
    console.error('  ✗ firma inválida no rechazada como se esperaba:', verificacion);
  }
}

console.log(`\nResultado: ${ok}/${total} comprobaciones correctas`);
process.exit(ok === total ? 0 : 1);
