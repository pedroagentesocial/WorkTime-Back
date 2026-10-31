import { describe, expect, it } from 'vitest';
import { distanceMeters, evaluateZone, type WorkSiteRef } from './work-zone.js';

const office: WorkSiteRef = {
  id: 'office',
  name: 'Oficina',
  latitude: 40.7608,
  longitude: -111.891,
  radiusMeters: 150,
};
const warehouse: WorkSiteRef = {
  id: 'warehouse',
  name: 'Bodega',
  latitude: 40.8,
  longitude: -111.95,
  radiusMeters: 100,
};

// Un grado de latitud son unos 111.2 km: sirve para poner un punto a una distancia conocida
const metersNorth = (site: WorkSiteRef, meters: number, accuracyMeters = 5) => ({
  latitude: site.latitude + meters / 111_195,
  longitude: site.longitude,
  accuracyMeters,
});

describe('distanceMeters', () => {
  it('es cero entre el mismo punto', () => {
    expect(distanceMeters(office, office)).toBe(0);
  });

  it('mide metros con buena precision', () => {
    expect(distanceMeters(office, metersNorth(office, 500))).toBeCloseTo(500, -1);
    expect(distanceMeters(office, metersNorth(office, 80))).toBeCloseTo(80, 0);
  });

  it('es simetrica', () => {
    expect(distanceMeters(office, warehouse)).toBeCloseTo(distanceMeters(warehouse, office), 6);
  });
});

describe('evaluateZone', () => {
  it('sin zonas activas no hay regla y devuelve null', () => {
    expect(evaluateZone(metersNorth(office, 0), [])).toBeNull();
  });

  it('dentro del radio es inside, con la zona y la distancia', () => {
    const zone = evaluateZone(metersNorth(office, 80), [office, warehouse]);
    expect(zone).toEqual({
      status: 'inside',
      siteId: 'office',
      siteName: 'Oficina',
      distanceMeters: 80,
    });
  });

  it('fuera del radio y de la precision es outside, con la zona mas cercana', () => {
    const zone = evaluateZone(metersNorth(office, 400, 10), [office, warehouse]);
    expect(zone?.status).toBe('outside');
    expect(zone?.siteId).toBe('office');
    expect(zone?.distanceMeters).toBeCloseTo(400, -1);
  });

  it('la imprecision del dispositivo juega a favor: radio mas precision cuenta como dentro', () => {
    // A 200 m con radio de 150: fuera si el dispositivo es preciso, dentro si falla por 80 m
    expect(evaluateZone(metersNorth(office, 200, 10), [office])?.status).toBe('outside');
    expect(evaluateZone(metersNorth(office, 200, 80), [office])?.status).toBe('inside');
  });

  it('el borde exacto cuenta como dentro', () => {
    expect(evaluateZone(metersNorth(office, 150, 0), [office])?.status).toBe('inside');
  });

  it('con varias zonas basta estar en una; elige la que mas conviene', () => {
    const atWarehouse = evaluateZone(metersNorth(warehouse, 30), [office, warehouse]);
    expect(atWarehouse).toMatchObject({ status: 'inside', siteId: 'warehouse' });
  });

  it('una zona de radio chico y otra grande: gana la que queda mas cerca de contener el punto', () => {
    const small: WorkSiteRef = { ...office, id: 'small', name: 'Chica', radiusMeters: 10 };
    const big: WorkSiteRef = { ...office, id: 'big', name: 'Grande', radiusMeters: 1000 };
    expect(evaluateZone(metersNorth(office, 300), [small, big])?.siteId).toBe('big');
  });
});
