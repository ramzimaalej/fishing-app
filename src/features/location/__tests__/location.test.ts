import {
  type DeviceFix,
  FIX_STALE_MS,
  formatCoords,
  formatPlace,
  type GeoPlace,
  hasLocation,
  isFixStale,
  resolveCoords,
} from '../location';

const bizerte: GeoPlace = {
  id: '2474583',
  name: 'Bizerte',
  admin1: 'Bizerte Governorate',
  country: 'Tunisia',
  countryCode: 'TN',
  latitude: 37.2744,
  longitude: 9.8739,
};

const fix: DeviceFix = { coords: { latitude: 51.5, longitude: -0.12 }, capturedAt: 1_000_000 };

describe('resolveCoords', () => {
  it('uses the device fix in device mode', () => {
    expect(resolveCoords('device', fix, bizerte)).toEqual(fix.coords);
  });

  it('uses the pinned place in manual mode', () => {
    expect(resolveCoords('manual', fix, bizerte)).toEqual({
      latitude: bizerte.latitude,
      longitude: bizerte.longitude,
    });
  });

  it('returns null rather than falling back when the mode has no data', () => {
    // This is the whole point. A default coordinate is what silently served
    // Californian tides to anglers on other continents.
    expect(resolveCoords('device', null, bizerte)).toBeNull();
    expect(resolveCoords('manual', fix, null)).toBeNull();
    expect(resolveCoords('device', null, null)).toBeNull();
  });

  it('never crosses the modes', () => {
    // Device mode must not silently use a pinned city, or vice versa.
    expect(resolveCoords('device', null, bizerte)).toBeNull();
    expect(resolveCoords('manual', fix, null)).toBeNull();
  });
});

describe('hasLocation', () => {
  it('mirrors resolveCoords', () => {
    expect(hasLocation('device', fix, null)).toBe(true);
    expect(hasLocation('manual', null, bizerte)).toBe(true);
    expect(hasLocation('device', null, null)).toBe(false);
  });
});

describe('formatPlace', () => {
  it('includes region and country', () => {
    expect(formatPlace(bizerte)).toBe('Bizerte, Bizerte Governorate, Tunisia');
  });

  it('omits a region that merely repeats the name', () => {
    // "Valencia, Valencia, Spain" reads as a bug.
    expect(formatPlace({ ...bizerte, name: 'Valencia', admin1: 'Valencia', country: 'Spain' })).toBe(
      'Valencia, Spain',
    );
  });

  it('copes with rows missing region or country', () => {
    expect(formatPlace({ id: '1', name: 'Nowhere', latitude: 0, longitude: 0 })).toBe('Nowhere');
  });
});

describe('formatCoords', () => {
  it('labels each hemisphere', () => {
    expect(formatCoords({ latitude: 37.2744, longitude: 9.8739 })).toBe('37.274°N 9.874°E');
    expect(formatCoords({ latitude: -33.87, longitude: -70.5 })).toBe('33.870°S 70.500°W');
  });

  it('treats the equator and prime meridian as N/E', () => {
    expect(formatCoords({ latitude: 0, longitude: 0 })).toBe('0.000°N 0.000°E');
  });
});

describe('isFixStale', () => {
  it('treats a missing fix as stale', () => {
    expect(isFixStale(null, 0)).toBe(true);
  });

  it('is false inside the window and true past it', () => {
    expect(isFixStale(fix, fix.capturedAt + FIX_STALE_MS - 1)).toBe(false);
    expect(isFixStale(fix, fix.capturedAt + FIX_STALE_MS + 1)).toBe(true);
  });
});
