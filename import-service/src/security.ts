import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
export function isPublicAddress(value: string) {
  try {
    const address = ipaddr.process(value);
    return address.range() === 'unicast';
  } catch {
    return false;
  }
}
export async function approvedSource(raw: string, allowed: string[], resolver = lookup) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
    throw new Error('Solo se admiten fuentes HTTPS sin credenciales y puerto 443.');
  if (
    ['youtube.com', 'youtu.be', 'googlevideo.com', 'youtube-nocookie.com'].some(
      (d) => url.hostname === d || url.hostname.endsWith(`.${d}`),
    )
  )
    throw new Error(
      'La fuente debe ser un archivo de audio autorizado; este dominio no está disponible para descarga directa.',
    );
  if (!allowed.includes(url.hostname))
    throw new Error('El operador no ha autorizado este dominio de origen.');
  const addresses = await resolver(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error('La fuente resuelve a una dirección privada o no permitida.');
  return { url, address: addresses[0].address, family: addresses[0].family };
}
