import { NextRequest, NextResponse } from "next/server"
import { getDetailedAddress } from "@/lib/location-geocoding"

/**
 * Reverse Geocoding API Endpoint
 * Converts latitude/longitude to a detailed address using LocationIQ
 * 
 * GET /api/location/reverse-geocode?lat={latitude}&lon={longitude}
 */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const lat = parseFloat(searchParams.get('lat') || '0')
    const lon = parseFloat(searchParams.get('lon') || '0')

    if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
      return NextResponse.json({ 
        error: 'Invalid coordinates. Please provide valid lat and lon parameters.' 
      }, { status: 400 })
    }

    console.log('[ReverseGeocode] Requesting address for coordinates:', lat, lon)

    const address = await getDetailedAddress(lat, lon)
    
    console.log('[ReverseGeocode] Result:', address)

    return NextResponse.json({
      address,
      latitude: lat,
      longitude: lon,
      success: true
    })
  } catch (error) {
    console.error('[ReverseGeocode] API endpoint error:', error)
    return NextResponse.json({ 
      error: 'Failed to reverse geocode coordinates',
      success: false
    }, { status: 500 })
  }
}
