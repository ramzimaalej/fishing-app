import { mapGeocodingResults } from '../geocoding';

/**
 * GeoNames rows are wildly inconsistent in completeness, so this mapping is
 * where the defensiveness has to live: a result missing admin1, country or
 * timezone must still render, and one with unusable coordinates must be dropped
 * rather than defaulted.
 */
describe('mapGeocodingResults', () => {
  it('maps a complete row', () => {
    expect(
      mapGeocodingResults([
        {
          id: 2474583,
          name: 'Bizerte',
          latitude: 37.2744,
          longitude: 9.8739,
          admin1: 'Bizerte Governorate',
          country: 'Tunisia',
          country_code: 'TN',
          timezone: 'Africa/Tunis',
        },
      ]),
    ).toEqual([
      {
        id: '2474583',
        name: 'Bizerte',
        latitude: 37.2744,
        longitude: 9.8739,
        admin1: 'Bizerte Governorate',
        country: 'Tunisia',
        countryCode: 'TN',
        timezone: 'Africa/Tunis',
      },
    ]);
  });

  it('handles missing optional fields', () => {
    const [place] = mapGeocodingResults([{ id: 1, name: 'Nowhere', latitude: 1, longitude: 2 }]);
    expect(place).toMatchObject({ name: 'Nowhere', latitude: 1, longitude: 2 });
    expect(place!.admin1).toBeUndefined();
    expect(place!.country).toBeUndefined();
    expect(place!.timezone).toBeUndefined();
  });

  it('DROPS rows with unusable coordinates', () => {
    // Defaulting these to 0,0 would send someone fishing in the Gulf of Guinea.
    expect(
      mapGeocodingResults([
        { id: 1, name: 'No lat', longitude: 5 },
        { id: 2, name: 'No lon', latitude: 5 },
        { id: 3, name: 'NaN', latitude: NaN, longitude: 5 },
        { id: 4, name: 'Out of range lat', latitude: 91, longitude: 5 },
        { id: 5, name: 'Out of range lon', latitude: 5, longitude: 181 },
      ]),
    ).toEqual([]);
  });

  it('drops rows with no name', () => {
    expect(mapGeocodingResults([{ id: 1, latitude: 1, longitude: 2 }])).toEqual([]);
  });

  it('accepts the coordinate extremes', () => {
    expect(
      mapGeocodingResults([
        { id: 1, name: 'South pole', latitude: -90, longitude: -180 },
        { id: 2, name: 'North edge', latitude: 90, longitude: 180 },
      ]),
    ).toHaveLength(2);
  });

  it('falls back to a coordinate key when the row has no id', () => {
    // Needed so a React list key is always present.
    const [place] = mapGeocodingResults([{ name: 'Anon', latitude: 1.5, longitude: 2.5 }]);
    expect(place!.id).toBe('1.5,2.5');
  });

  it('treats empty strings as absent, not as content', () => {
    const [place] = mapGeocodingResults([
      { id: 1, name: 'X', latitude: 0, longitude: 0, admin1: '', country: '', timezone: '' },
    ]);
    expect(place!.admin1).toBeUndefined();
    expect(place!.country).toBeUndefined();
  });

  it('handles absent input', () => {
    expect(mapGeocodingResults(undefined)).toEqual([]);
    expect(mapGeocodingResults(null)).toEqual([]);
    expect(mapGeocodingResults([])).toEqual([]);
  });
});
