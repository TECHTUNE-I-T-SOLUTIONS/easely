import { NextRequest, NextResponse } from "next/server"
import { searchAddresses } from "@/lib/location-geocoding"

/**
 * Address Search API Endpoint
 * Searches for addresses using multiple geocoding services as fallbacks
 * 
 * GET /api/location/search-address?q={search_query}
 */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q') || ''

    if (!query || query.length < 2) {
      return NextResponse.json({ 
        error: 'Invalid search query. Please provide at least 2 characters.' 
      }, { status: 400 })
    }

    console.log('[AddressSearch] Searching for:', query)

    const results = await searchAddresses(query)
    
    return NextResponse.json({
      results,
      query,
      success: true
    })
  } catch (error) {
    console.error('[AddressSearch] API endpoint error:', error)
    return NextResponse.json({ 
      error: 'Failed to search addresses',
      success: false
    }, { status: 500 })
  }
}
