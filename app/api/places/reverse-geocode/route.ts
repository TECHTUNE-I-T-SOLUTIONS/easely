import { NextRequest, NextResponse } from "next/server";

const googleGeocodeError = async (response: Response) => {
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    return payload?.error_message || payload?.error?.message || payload?.status || text;
  } catch {
    return text;
  }
};

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Google Maps API key is not configured" }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const latitude = Number(body?.latitude);
    const longitude = Number(body?.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return NextResponse.json({ error: "Valid latitude and longitude are required" }, { status: 400 });
    }

    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${latitude},${longitude}`);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("language", "en");
    url.searchParams.set("region", "ng");
    url.searchParams.set("result_type", "street_address|premise|subpremise|route|neighborhood|sublocality|locality");

    const response = await fetch(url.toString());

    if (!response.ok) {
      const details = await googleGeocodeError(response);
      console.error("[Places Reverse Geocode] Google request failed:", response.status, details);
      return NextResponse.json({ error: "Google reverse geocoding failed", details }, { status: response.status });
    }

    const payload = await response.json();
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const bestResult = results.find((item: any) =>
      (item?.types || []).some((type: string) =>
        ["street_address", "premise", "subpremise", "route"].includes(type)
      )
    ) || results[0];

    if (payload?.status !== "OK" || !bestResult) {
      return NextResponse.json(
        {
          error: "No address found for this location",
          details: payload?.error_message || payload?.status,
        },
        { status: 404 }
      );
    }

    const location = bestResult?.geometry?.location || {};
    return NextResponse.json({
      address: bestResult.formatted_address,
      placeId: bestResult.place_id,
      name: bestResult.address_components?.[0]?.long_name || bestResult.formatted_address,
      lat: Number(location.lat) || latitude,
      lng: Number(location.lng) || longitude,
      source: "google",
      rawTypes: bestResult.types || [],
    });
  } catch (error: any) {
    console.error("[Places Reverse Geocode] Unexpected error:", error);
    return NextResponse.json(
      { error: "Google reverse geocoding failed", details: error?.message },
      { status: 500 }
    );
  }
}
