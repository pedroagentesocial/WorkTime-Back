import type { ClockLocation } from './clock-location.js';

export interface WorkSiteRef {
  readonly id: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusMeters: number;
}

export type ZoneStatus = 'inside' | 'outside';

// Resultado de comparar donde marco la persona con las zonas de trabajo de su empresa
export interface ClockZone {
  readonly status: ZoneStatus;
  readonly siteId: string;
  readonly siteName: string;
  // Metros desde el punto hasta el centro de la zona mas cercana
  readonly distanceMeters: number;
}

const EARTH_RADIUS_METERS = 6_371_000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

// Distancia sobre la esfera entre dos puntos (haversine); sobra precision para zonas de decenas de metros
export function distanceMeters(
  a: Pick<ClockLocation, 'latitude' | 'longitude'>,
  b: Pick<ClockLocation, 'latitude' | 'longitude'>,
): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Dentro si el punto cae en alguna zona. La imprecision del dispositivo juega a favor de la persona:
// se acepta hasta radio + precision, para no bloquear a nadie por un error del GPS.
// Sin zonas activas no hay regla que evaluar y devuelve null
export function evaluateZone(
  location: ClockLocation,
  sites: readonly WorkSiteRef[],
): ClockZone | null {
  let best: { site: WorkSiteRef; distance: number; margin: number } | null = null;
  for (const site of sites) {
    const distance = distanceMeters(location, site);
    // Cuanto falta para entrar en la zona; negativo si ya esta dentro
    const margin = distance - (site.radiusMeters + location.accuracyMeters);
    if (best === null || margin < best.margin) best = { site, distance, margin };
  }
  if (best === null) return null;
  return {
    status: best.margin <= 0 ? 'inside' : 'outside',
    siteId: best.site.id,
    siteName: best.site.name,
    distanceMeters: Math.round(best.distance),
  };
}
