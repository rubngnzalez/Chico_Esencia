// Firma Redsys HMAC_SHA256_V1 para Supabase Edge Functions (Deno).
// Puerto del worker/src/redsys.js (idéntico al del servidor Node): Web Crypto
// no ofrece 3DES, así que el cifrado de la clave de operación (3DES-ECB con
// PKCS7) está implementado en JavaScript puro con las tablas de FIPS 46-3.

const IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
];

const IP_INV = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
  38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
  34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
];

const E = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9,
  8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17,
  16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25,
  24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
];

const P = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
  2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
];

const PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18,
  10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22,
  14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
];

const PC2 = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10,
  23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48,
  44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
];

const ROTACIONES = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

const S: number[][] = [
  [
    14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
    0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
    4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
    15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13,
  ],
  [
    15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
    3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5,
    0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
    13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9,
  ],
  [
    10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
    13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
    13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
    1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12,
  ],
  [
    7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
    13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
    10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
    3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14,
  ],
  [
    2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
    14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
    4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
    11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3,
  ],
  [
    12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
    10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
    9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
    4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13,
  ],
  [
    4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
    13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
    1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
    6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12,
  ],
  [
    13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
    1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
    7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
    2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11,
  ],
];

function bytesABits(bytes: Uint8Array): number[] {
  const bits = new Array<number>(bytes.length * 8);
  for (let i = 0; i < bytes.length; i++) {
    for (let j = 0; j < 8; j++) bits[i * 8 + j] = (bytes[i] >> (7 - j)) & 1;
  }
  return bits;
}

function bitsABytes(bits: number[]): Uint8Array {
  const bytes = new Uint8Array(bits.length / 8);
  for (let i = 0; i < bytes.length; i++) {
    let valor = 0;
    for (let j = 0; j < 8; j++) valor = (valor << 1) | (bits[i * 8 + j] & 1);
    bytes[i] = valor;
  }
  return bytes;
}

function permutar(entrada: number[], tabla: number[]): number[] {
  const salida = new Array<number>(tabla.length);
  for (let i = 0; i < tabla.length; i++) salida[i] = entrada[tabla[i] - 1];
  return salida;
}

function rotarIzquierda(bits: number[], posiciones: number): number[] {
  return bits.slice(posiciones).concat(bits.slice(0, posiciones));
}

function generarSubclavesDes(clave8: Uint8Array): number[][] {
  const claveBits = bytesABits(clave8);
  const pc1 = permutar(claveBits, PC1);
  let c = pc1.slice(0, 28);
  let d = pc1.slice(28, 56);
  const subclaves: number[][] = [];
  for (let ronda = 0; ronda < 16; ronda++) {
    c = rotarIzquierda(c, ROTACIONES[ronda]);
    d = rotarIzquierda(d, ROTACIONES[ronda]);
    subclaves.push(permutar(c.concat(d), PC2));
  }
  return subclaves;
}

function funcionF(rBits: number[], subclave: number[]): number[] {
  const expandida = permutar(rBits, E);
  const x = new Array<number>(48);
  for (let i = 0; i < 48; i++) x[i] = expandida[i] ^ subclave[i];
  const salida = new Array<number>(32);
  for (let caja = 0; caja < 8; caja++) {
    const fila = (x[caja * 6] << 1) | x[caja * 6 + 5];
    const columna =
      (x[caja * 6 + 1] << 3) | (x[caja * 6 + 2] << 2) | (x[caja * 6 + 3] << 1) | x[caja * 6 + 4];
    const valor = S[caja][fila * 16 + columna];
    salida[caja * 4] = (valor >> 3) & 1;
    salida[caja * 4 + 1] = (valor >> 2) & 1;
    salida[caja * 4 + 2] = (valor >> 1) & 1;
    salida[caja * 4 + 3] = valor & 1;
  }
  return permutar(salida, P);
}

function bloqueDes(bloque: Uint8Array, subclaves: number[][], cifrar: boolean): Uint8Array {
  const orden = cifrar ? subclaves : subclaves.slice().reverse();
  const bits = permutar(bytesABits(bloque), IP);
  let izquierda = bits.slice(0, 32);
  let derecha = bits.slice(32, 64);
  for (let ronda = 0; ronda < 16; ronda++) {
    const nuevaDerecha = new Array<number>(32);
    const f = funcionF(derecha, orden[ronda]);
    for (let i = 0; i < 32; i++) nuevaDerecha[i] = izquierda[i] ^ f[i];
    izquierda = derecha;
    derecha = nuevaDerecha;
  }
  return bitsABytes(permutar(derecha.concat(izquierda), IP_INV));
}

function pkcs7Pad(bytes: Uint8Array): Uint8Array {
  const relleno = 8 - (bytes.length % 8);
  const salida = new Uint8Array(bytes.length + relleno);
  salida.set(bytes);
  salida.fill(relleno, bytes.length);
  return salida;
}

// 3DES-ECB con PKCS7 (equivalente a createCipheriv('des-ede3', …) de Node)
export function tripleDesEcbCifrar(datos: Uint8Array, clave24: Uint8Array): Uint8Array {
  if (clave24.length !== 24) throw new Error('La clave 3DES debe tener 24 bytes.');
  const k1 = generarSubclavesDes(clave24.slice(0, 8));
  const k2 = generarSubclavesDes(clave24.slice(8, 16));
  const k3 = generarSubclavesDes(clave24.slice(16, 24));
  const entrada = pkcs7Pad(datos);
  const salida = new Uint8Array(entrada.length);
  for (let i = 0; i < entrada.length; i += 8) {
    const bloque = entrada.slice(i, i + 8);
    const paso1 = bloqueDes(bloque, k1, true);
    const paso2 = bloqueDes(paso1, k2, false);
    salida.set(bloqueDes(paso2, k3, true), i);
  }
  return salida;
}

async function hmacSha256Base64(claveBytes: Uint8Array, datosTexto: string): Promise<string> {
  const clave = await crypto.subtle.importKey(
    'raw',
    claveBytes as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const firma = await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(datosTexto));
  const bytes = new Uint8Array(firma);
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

function base64ABytes(texto: string): Uint8Array {
  let limpio = String(texto || '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  // Node (Buffer.from lenient) descarta un último carácter suelto de 6 bits
  // sin bytes completos: p. ej. la clave de pruebas de Redsys tiene 21 chars.
  if (limpio.length % 4 === 1) limpio = limpio.slice(0, -1);
  const resto = limpio.length % 4;
  if (resto === 2) limpio += '==';
  else if (resto === 3) limpio += '=';
  const binario = atob(limpio);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function normalizarClave(claveBase64: string): Uint8Array {
  let clave = base64ABytes(claveBase64);
  if (clave.length === 0) throw new Error('La clave secreta de Redsys no está configurada.');
  if (clave.length > 24) clave = clave.slice(0, 24);
  if (clave.length < 24) {
    const completa = new Uint8Array(24);
    completa.set(clave, 0);
    if (clave.length === 16) completa.set(clave.slice(0, 8), 16);
    else completa.fill(0, clave.length);
    clave = completa;
  }
  return clave;
}

export function claveDeOperacion(claveBase64: string, numeroPedido: string): Uint8Array {
  if (!claveBase64) throw new Error('La clave secreta de Redsys no está configurada.');
  const clave = normalizarClave(claveBase64);
  return tripleDesEcbCifrar(new TextEncoder().encode(String(numeroPedido)), clave);
}

export async function firmarParametros(
  parametrosB64: string,
  numeroPedido: string,
  claveBase64: string
): Promise<string> {
  const derivada = claveDeOperacion(claveBase64, numeroPedido);
  return hmacSha256Base64(derivada, String(parametrosB64) + String(numeroPedido));
}

export function normalizarFirma(firma: string): string {
  return String(firma || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
}

export interface Verificacion {
  ok: boolean;
  motivo?: string;
  datos?: Record<string, unknown>;
  autorizado?: boolean;
  respuesta?: number;
  pedido?: string;
  importe?: number;
  autorizacion?: string;
}

export async function verificarNotificacion(
  cuerpo: Record<string, string>,
  claveBase64: string
): Promise<Verificacion> {
  const parametrosRecibidos = cuerpo['Ds_Merchant_Parameters'] || cuerpo['DS_MERCHANT_PARAMETERS'];
  const firmaRecibida = normalizarFirma(cuerpo['Ds_Signature'] || cuerpo['DS_MERCHANT_SIGNATURE'] || '');
  const version = cuerpo['Ds_Signature_Version'] || cuerpo['DS_MERCHANT_SIGNATUREVERSION'];

  if (!parametrosRecibidos || !firmaRecibida) {
    return { ok: false, motivo: 'Faltan parámetros de la notificación.' };
  }
  if (version && version !== 'HMAC_SHA256_V1') {
    return { ok: false, motivo: 'Versión de firma no soportada.' };
  }

  let datos: Record<string, unknown>;
  try {
    const json = atob(parametrosRecibidos.replace(/-/g, '+').replace(/_/g, '/'));
    datos = JSON.parse(json);
  } catch {
    return { ok: false, motivo: 'Los parámetros recibidos no son válidos.' };
  }

  const pedido = String(datos['Ds_Order'] ?? datos['DS_MERCHANT_ORDER'] ?? '');
  if (!pedido) {
    return { ok: false, motivo: 'La notificación no incluye número de pedido.' };
  }

  const firmaEsperada = await firmarParametros(parametrosRecibidos, pedido, claveBase64);
  const valida = comparacionSeguraCadena(normalizarFirma(firmaEsperada), firmaRecibida);
  if (!valida) {
    return { ok: false, motivo: 'La firma de la notificación no es válida.' };
  }

  const respuesta = parseInt(String(datos['Ds_Response'] ?? datos['DS_RESPONSE'] ?? '99999'), 10);
  return {
    ok: true,
    datos,
    autorizado: Number.isFinite(respuesta) && respuesta >= 0 && respuesta < 100,
    respuesta,
    pedido,
    importe: parseInt(String(datos['Ds_Amount'] ?? '0'), 10) || 0,
    autorizacion: String(datos['Ds_AuthorisationCode'] ?? ''),
  };
}

function comparacionSeguraCadena(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

export function generarNumeroPedido(): string {
  const d = new Date();
  const dos = (n: number) => String(n).padStart(2, '0');
  return (
    String(d.getFullYear()).slice(2) +
    dos(d.getMonth() + 1) +
    dos(d.getDate()) +
    dos(d.getHours()) +
    dos(d.getMinutes()) +
    dos(d.getSeconds())
  );
}
