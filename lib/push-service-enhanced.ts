/**
 * Enhanced Push Notification Service with Live Tracking
 * Generates map images and sends dynamic notifications with driver location
 */

import { sendPushNotification } from './push-service';

interface LiveTrackingNotificationData {
  rideId: string;
  riderId: string;
  driverLocation: { lat: number; lng: number };
  pickupLocation: { lat: number; lng: number; address: string };
  destinationLocation: { lat: number; lng: number; address: string };
  etaMinutes: number;
  distanceKm: number;
  status: 'accepted' | 'in_progress' | 'arrived';
}

/**
 * Generate a static map image URL using Mapbox Static Maps API
 * This creates a map showing driver location, pickup, and destination
 */
function generateMapImageUrl(data: LiveTrackingNotificationData): string {
  const { driverLocation, pickupLocation, destinationLocation, status } = data;

  // Mapbox Static Maps API format
  // Note: You'll need a Mapbox access token in your .env.local
  const mapboxToken = process.env.MAPBOX_SECRET_TOKEN || process.env.MAPBOX_PUBLIC_TOKEN;

  if (!mapboxToken) {
    console.warn('[PushService] Mapbox token not found, skipping map image');
    return '';
  }

  // Create markers for different locations
  const driverMarker = `pin-s-d+34D399(${driverLocation.lng},${driverLocation.lat})`;
  const pickupMarker = `pin-s-l+10B981(${pickupLocation.lng},${pickupLocation.lat})`;
  const destMarker = `pin-s-d+EF4444(${destinationLocation.lng},${destinationLocation.lat})`;

  // Draw route line from driver to pickup (if accepted) or pickup to destination (if in_progress)
  const routePath = status === 'accepted'
    ? `${driverLocation.lng},${driverLocation.lat};${pickupLocation.lng},${pickupLocation.lat}`
    : `${pickupLocation.lng},${pickupLocation.lat};${destinationLocation.lng},${destinationLocation.lat}`;

  const pathOverlay = `path-5+3B82F6-0.5(${routePath})`;

  // Calculate bounding box for the map
  const allLats = [driverLocation.lat, pickupLocation.lat, destinationLocation.lat];
  const allLngs = [driverLocation.lng, pickupLocation.lng, destinationLocation.lng];
  const minLat = Math.min(...allLats);
  const maxLat = Math.max(...allLats);
  const minLng = Math.min(...allLngs);
  const maxLng = Math.max(...allLngs);

  // Add padding to bounding box
  const latPadding = (maxLat - minLat) * 0.2;
  const lngPadding = (maxLng - minLng) * 0.2;

  const bbox = `${minLng - lngPadding},${minLat - latPadding},${maxLng + lngPadding},${maxLat + latPadding}`;

  // Build the static map URL
  const width = 600;
  const height = 300;
  const mapStyle = 'mapbox/streets-v12';

  const url = `https://api.mapbox.com/styles/v1/${mapStyle}/static/${driverMarker},${pickupMarker},${destMarker},${pathOverlay}/${bbox}/${width}x${height}@2x?access_token=${mapboxToken}`;

  return url;
}

/**
 * Get tracking image URL based on distance to destination
 * Returns the appropriate tracking banner image for the current progress
 */
function getTrackingImageUrl(distanceKm: number): string {
  // Determine which tracking image to use based on distance
  // These images are served from the public folder
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';

  if (distanceKm > 3) {
    // Just started - more than 3km away
    return `${baseUrl}/assets/tracking-just-started.png`;
  } else if (distanceKm > 2) {
    // Started - 2-3km away
    return `${baseUrl}/assets/tracking-started.png`;
  } else if (distanceKm > 1) {
    // Half way - 1-2km away
    return `${baseUrl}/assets/tracking-half-way.png`;
  } else if (distanceKm > 0.5) {
    // Very close - 0.5-1km away
    return `${baseUrl}/assets/tracking-very-close.png`;
  } else if (distanceKm > 0.3) {
    // Very close to finish - 0.3-0.5km away
    return `${baseUrl}/assets/tracking-very-close-to-finish.png`;
  } else if (distanceKm > 0.2) {
    // Almost finished - 0.2-0.3km away
    return `${baseUrl}/assets/tracking-almost-finished.png`;
  } else {
    // Ride completed - less than 0.2km
    return `${baseUrl}/assets/tracking-ride-completed.png`;
  }
}

/**
 * Send live tracking push notification to rider
 * Includes map image and ETA information
 */
export async function sendLiveTrackingNotification(data: LiveTrackingNotificationData) {
  const { riderId, etaMinutes, distanceKm, status } = data;

  // Use tracking banner image instead of map for better visual impact
  const trackingImageUrl = getTrackingImageUrl(distanceKm);

  // Also generate map image as fallback (if Mapbox token is available)
  const mapImageUrl = generateMapImageUrl(data);

  // Build notification content based on status
  let title = '';
  let body = '';

  switch (status) {
    case 'accepted':
      title = '🚗 Driver is on the way!';
      body = `Your driver is ${distanceKm.toFixed(1)} km away. ETA: ${etaMinutes} min`;
      break;
    case 'in_progress':
      title = '🎯 En route to destination';
      body = `Trip in progress. ETA: ${etaMinutes} min`;
      break;
    case 'arrived':
      title = '📍 Driver has arrived!';
      body = 'Your driver is waiting at the pickup location';
      break;
  }

  try {
    await sendPushNotification([riderId], {
      title,
      body,
      type: 'live_tracking',
      categoryId: 'live_tracking',
      channelId: 'live-tracking', // Android channel for MAX importance
      data: {
        rideId: data.rideId,
        status,
        etaMinutes: etaMinutes.toString(),
        distanceKm: distanceKm.toString(),
        deeplink: '/rider/active-ride',
      },
      // Use tracking banner image for visual impact
      imageUrl: trackingImageUrl || mapImageUrl || undefined,
      // Android specific for heads-up banner
      android: {
        channelId: 'live-tracking',
        priority: 'max',
        sticky: false,
        autoCancel: true,
        vibrate: [0, 200, 100, 200],
      },
      // iOS specific
      ios: {
        sound: 'default',
        badge: 1,
      },
    });

    console.log(`[PushService] Live tracking notification sent to rider ${riderId} with tracking image`);
  } catch (error) {
    console.error('[PushService] Failed to send live tracking notification:', error);
  }
}

/**
 * Send periodic live tracking updates
 * This should be called every 1-2 minutes from a backend job
 */
export async function sendPeriodicLiveTrackingUpdates(rideId: string) {
  // This would be called from a cron job or scheduled task
  // It would:
  // 1. Fetch current driver location from database
  // 2. Calculate ETA to pickup/destination
  // 3. Send live tracking notification
  // Implementation depends on your location tracking infrastructure
  console.log('[PushService] Periodic live tracking update for ride:', rideId);
}
