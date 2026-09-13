/**
 * Location Geocoding Service
 * Uses multiple geocoding services for better reverse geocoding with full addresses
 */

interface ReverseGeocodeResult {
  displayName: string;
  road?: string;
  suburb?: string;
  neighbourhood?: string;
  city?: string;
  town?: string;
  village?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  formattedAddress: string;
}

interface ForwardGeocodeResult {
  address: string;
  lat: number;
  lon: number;
  placeId?: string;
  name?: string;
  source: string;
}

export async function reverseGeocodeWithLocationIQ(
  lat: number,
  lon: number
): Promise<ReverseGeocodeResult | null> {
  try {
    const apiKey = process.env.LOCATIONIQ_API_KEY;
    
    if (!apiKey) {
      console.warn('[LocationGeocoding] LocationIQ API key not configured, using fallback');
      return null;
    }

    const response = await fetch(
      `https://us1.locationiq.com/v1/reverse?key=${apiKey}&lat=${lat}&lon=${lon}&format=json&accept-language=en-US&addressdetails=1`
    );

    if (!response.ok) {
      console.error('[LocationGeocoding] LocationIQ API error:', response.status, response.statusText);
      return null;
    }

    const data = await response.json();

    if (data.error) {
      console.error('[LocationGeocoding] LocationIQ error:', data.error);
      return null;
    }

    // Build formatted address from components
    const address = data.address || {};
    const parts = [
      address.house_number,
      address.road,
      address.suburb || address.neighbourhood,
      address.city || address.town || address.village,
      address.state,
      address.country
    ]
      .filter(Boolean)
      .join(', ');

    const formattedAddress = parts || data.display_name || 'Unknown location';
    
    console.log('[LocationGeocoding] LocationIQ response:', {
      address,
      formattedAddress,
      display_name: data.display_name
    });

    return {
      displayName: data.display_name || parts,
      road: address.road,
      suburb: address.suburb || address.neighbourhood,
      city: address.city || address.town || address.village,
      state: address.state,
      country: address.country,
      postalCode: address.postcode,
      formattedAddress
    };
  } catch (error) {
    console.error('[LocationGeocoding] Reverse geocoding error:', error);
    return null;
  }
}

export async function reverseGeocodeWithOpenStreetMap(
  lat: number,
  lon: number
): Promise<ReverseGeocodeResult | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1&accept-language=en-US&zoom=18`,
      {
        headers: {
          'User-Agent': 'CharterKeke/1.0' // Required by OSM policy
        }
      }
    );

    if (!response.ok) {
      console.error('[LocationGeocoding] OSM API error:', response.status, response.statusText);
      return null;
    }

    const data = await response.json();

    if (data.error) {
      console.error('[LocationGeocoding] OSM error:', data.error);
      return null;
    }

    // Build formatted address from components
    const address = data.address || {};
    const parts = [
      address.house_number,
      address.road,
      address.suburb || address.neighbourhood || address.quarter,
      address.city || address.town || address.village,
      address.state || address.county,
      address.country
    ]
      .filter(Boolean)
      .join(', ');

    const formattedAddress = parts || data.display_name || 'Unknown location';
    
    console.log('[LocationGeocoding] OSM response:', {
      address,
      formattedAddress,
      display_name: data.display_name
    });

    return {
      displayName: data.display_name || parts,
      road: address.road,
      suburb: address.suburb || address.neighbourhood || address.quarter,
      city: address.city || address.town || address.village,
      state: address.state || address.county,
      country: address.country,
      postalCode: address.postcode,
      formattedAddress
    };
  } catch (error) {
    console.error('[LocationGeocoding] OSM reverse geocoding error:', error);
    return null;
  }
}

export async function reverseGeocodeWithBigDataCloud(
  lat: number,
  lon: number
): Promise<ReverseGeocodeResult | null> {
  try {
    const apiKey = process.env.BIGDATACLOUD_API_KEY;
    
    if (!apiKey) {
      console.warn('[LocationGeocoding] BigDataCloud API key not configured, skipping');
      return null;
    }

    const response = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&key=${apiKey}&localityLanguage=en`
    );

    if (!response.ok) {
      console.error('[LocationGeocoding] BigDataCloud API error:', response.status, response.statusText);
      return null;
    }

    const data = await response.json();

    if (data.error) {
      console.error('[LocationGeocoding] BigDataCloud error:', data.error);
      return null;
    }

    // Build formatted address from components
    const locality = data.locality || {};
    const parts = [
      locality.streetName,
      locality.buildingName,
      locality.suburb,
      locality.city,
      locality.principalSubdivision,
      locality.countryName
    ]
      .filter(Boolean)
      .join(', ');

    const formattedAddress = parts || data.formattedAddress || 'Unknown location';
    
    console.log('[LocationGeocoding] BigDataCloud response:', {
      locality,
      formattedAddress,
      formattedAddress_data: data.formattedAddress
    });

    return {
      displayName: data.formattedAddress || parts,
      road: locality.streetName,
      suburb: locality.suburb,
      city: locality.city,
      state: locality.principalSubdivision,
      country: locality.countryName,
      postalCode: locality.postcode,
      formattedAddress
    };
  } catch (error) {
    console.error('[LocationGeocoding] BigDataCloud reverse geocoding error:', error);
    return null;
  }
}

/**
 * Get detailed address from coordinates with multiple fallback options
 */
export async function getDetailedAddress(
  lat: number,
  lon: number
): Promise<string> {
  try {
    // Try BigDataCloud first (good global coverage, free tier available)
    const bigDataCloudResult = await reverseGeocodeWithBigDataCloud(lat, lon);
    if (bigDataCloudResult?.formattedAddress && bigDataCloudResult.formattedAddress.length > 15) {
      console.log('[LocationGeocoding] Using BigDataCloud result:', bigDataCloudResult.formattedAddress);
      return bigDataCloudResult.formattedAddress;
    }

    // Try LocationIQ (good for Nigeria)
    const locationIQResult = await reverseGeocodeWithLocationIQ(lat, lon);
    if (locationIQResult?.formattedAddress && locationIQResult.formattedAddress.length > 15) {
      console.log('[LocationGeocoding] Using LocationIQ result:', locationIQResult.formattedAddress);
      return locationIQResult.formattedAddress;
    }

    // Fallback to OpenStreetMap Nominatim
    const osmResult = await reverseGeocodeWithOpenStreetMap(lat, lon);
    if (osmResult?.formattedAddress && osmResult.formattedAddress.length > 15) {
      console.log('[LocationGeocoding] Using OSM result:', osmResult.formattedAddress);
      return osmResult.formattedAddress;
    }

    // If all failed or returned too generic, return coordinates
    console.warn('[LocationGeocoding] All geocoding services failed or returned generic results');
    return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  } catch (error) {
    console.error('[LocationGeocoding] Failed to get detailed address:', error);
    return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  }
}

/**
 * Backend API endpoint for reverse geocoding
 * This can be called from the mobile app to get better addresses
 */
export async function reverseGeocodeEndpoint(
  request: Request
) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = parseFloat(searchParams.get('lat') || '0');
    const lon = parseFloat(searchParams.get('lon') || '0');

    if (!lat || !lon) {
      return Response.json({ error: 'Invalid coordinates' }, { status: 400 });
    }

    const result = await getDetailedAddress(lat, lon);
    
    return Response.json({
      address: result,
      latitude: lat,
      longitude: lon,
      success: true
    });
  } catch (error) {
    console.error('[LocationGeocoding] API endpoint error:', error);
    return Response.json({ error: 'Failed to reverse geocode', success: false }, { status: 500 });
  }
}

/**
 * Forward geocoding using LocationIQ
 */
export async function forwardGeocodeWithLocationIQ(
  query: string
): Promise<ForwardGeocodeResult[]> {
  try {
    const apiKey = process.env.LOCATIONIQ_API_KEY;
    
    if (!apiKey) {
      console.warn('[LocationGeocoding] LocationIQ API key not configured');
      return [];
    }

    const response = await fetch(
      `https://us1.locationiq.com/v1/search?key=${apiKey}&q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5&accept-language=en-US`
    );

    if (!response.ok) {
      console.error('[LocationGeocoding] LocationIQ forward geocode error:', response.status, response.statusText);
      return [];
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      console.warn('[LocationGeocoding] LocationIQ returned non-array result');
      return [];
    }

    const results = data.map((item: any) => ({
      address: item.display_name || '',
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
      placeId: item.place_id,
      name: item.address?.road || item.address?.name,
      source: 'locationiq'
    })).filter((result: ForwardGeocodeResult) => result.address && !isNaN(result.lat) && !isNaN(result.lon));

    console.log('[LocationGeocoding] LocationIQ forward geocode results:', results.length);
    return results;
  } catch (error) {
    console.error('[LocationGeocoding] LocationIQ forward geocoding error:', error);
    return [];
  }
}

/**
 * Forward geocoding using OpenStreetMap Nominatim
 */
export async function forwardGeocodeWithOSM(
  query: string
): Promise<ForwardGeocodeResult[]> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=5&accept-language=en-US`,
      {
        headers: {
          'User-Agent': 'CharterKeke/1.0'
        }
      }
    );

    if (!response.ok) {
      console.error('[LocationGeocoding] OSM forward geocode error:', response.status, response.statusText);
      return [];
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      console.warn('[LocationGeocoding] OSM returned non-array result');
      return [];
    }

    const results = data.map((item: any) => ({
      address: item.display_name || '',
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
      placeId: item.place_id,
      name: item.address?.road || item.name,
      source: 'osm'
    })).filter((result: ForwardGeocodeResult) => result.address && !isNaN(result.lat) && !isNaN(result.lon));

    console.log('[LocationGeocoding] OSM forward geocode results:', results.length);
    return results;
  } catch (error) {
    console.error('[LocationGeocoding] OSM forward geocoding error:', error);
    return [];
  }
}

/**
 * Search addresses with multiple fallback services
 */
export async function searchAddresses(
  query: string
): Promise<ForwardGeocodeResult[]> {
  try {
    if (!query || query.length < 2) {
      return [];
    }

    console.log('[LocationGeocoding] Searching addresses for:', query);

    // Try LocationIQ first
    const locationIQResults = await forwardGeocodeWithLocationIQ(query);
    if (locationIQResults.length > 0) {
      console.log('[LocationGeocoding] Using LocationIQ search results');
      return locationIQResults;
    }

    // Fallback to OSM
    const osmResults = await forwardGeocodeWithOSM(query);
    if (osmResults.length > 0) {
      console.log('[LocationGeocoding] Using OSM search results');
      return osmResults;
    }

    console.warn('[LocationGeocoding] No search results found from any service');
    return [];
  } catch (error) {
    console.error('[LocationGeocoding] Address search error:', error);
    return [];
  }
}
