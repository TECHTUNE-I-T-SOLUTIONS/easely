/**
 * Location Geocoding Service
 * Uses Google Places primarily with Mapbox as fallback
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
      return null;
    }

    const response = await fetch(
      `https://us1.locationiq.com/v1/reverse?key=${apiKey}&lat=${lat}&lon=${lon}&format=json&accept-language=en-US&addressdetails=1`
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data.error) {
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
          'User-Agent': 'CharterKeke/1.0'
        }
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data.error) {
      return null;
    }

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
    return null;
  }
}

export async function getDetailedAddress(
  lat: number,
  lon: number
): Promise<string> {
  try {
    // Try Google Places first (if API key is configured)
    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (googleApiKey) {
      try {
        const response = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${googleApiKey}`
        );
        
        if (response.ok) {
          const data = await response.json();
          if (data.results && data.results.length > 0) {
            const address = data.results[0].formatted_address;
            if (address && address.length > 10) {
              return address;
            }
          }
        }
      } catch (error) {
        // Silent fail, try next service
      }
    }

    // Fallback to LocationIQ for Nigeria
    const locationIQResult = await reverseGeocodeWithLocationIQ(lat, lon);
    if (locationIQResult?.formattedAddress && locationIQResult.formattedAddress.length > 10) {
      return locationIQResult.formattedAddress;
    }

    // Final fallback to coordinates
    return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  } catch (error) {
    return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  }
}

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

    return results;
  } catch (error) {
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
      return [];
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
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

    return results;
  } catch (error) {
    return [];
  }
}

/**
 * Search addresses using Google Places (primary) and Mapbox (fallback)
 */
export async function searchAddresses(
  query: string
): Promise<ForwardGeocodeResult[]> {
  try {
    if (!query || query.length < 2) {
      return [];
    }

    // Try Google Places first (if API key is configured)
    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (googleApiKey) {
      try {
        const response = await fetch(
          `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${googleApiKey}&components=country:ng`
        );
        
        if (response.ok) {
          const data = await response.json();
          if (data.predictions && data.predictions.length > 0) {
            const results = data.predictions.map((item: any) => ({
              address: item.description,
              lat: 0, // Will be resolved with place details
              lon: 0,
              placeId: item.place_id,
              name: item.structured_formatting?.main_text,
              source: 'google'
            }));
            return results;
          }
        }
      } catch (error) {
        // Silent fail, try next service
      }
    }

    // Fallback to LocationIQ for Nigeria
    const locationIQResults = await forwardGeocodeWithLocationIQ(query);
    if (locationIQResults.length > 0) {
      return locationIQResults;
    }

    return [];
  } catch (error) {
    return [];
  }
}
