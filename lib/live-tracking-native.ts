/**
 * Native Live Tracking Notification Service
 * Uses emoji-based visual notifications without images
 * Similar to Bolt's approach - shows driver location, ETA, and progress
 */

import { sendPushNotification } from './push-service';

interface LiveTrackingData {
  rideId: string;
  riderId: string;
  driverName: string;
  driverLocation: { lat: number; lng: number };
  pickupLocation: { lat: number; lng: number; address: string };
  destinationLocation: { lat: number; lng: number; address: string };
  etaMinutes: number;
  distanceKm: number;
  status: 'accepted' | 'arrived' | 'in_progress' | 'completed';
  vehiclePlate?: string;
}

/**
 * Generate an emoji-based visual representation of the ride status
 * Creates a simple text-based progress indicator
 */
function generateVisualStatus(data: LiveTrackingData): {
  title: string;
  body: string;
  largeBody: string;
} {
  const { status, etaMinutes, distanceKm, driverName, vehiclePlate } = data;

  // Emoji icons for different elements
  const icons = {
    driver: '🛺',
    rider: '📍',
    road: '🛣️',
    clock: '⏱️',
    flag: '🏁',
    arrival: '🚨',
    started: '🚀',
    moving: '➡️',
    here: '✅',
    vehiclePlate: '🚗',
  };

  let title = '';
  let body = '';
  let largeBody = '';

  switch (status) {
    case 'accepted':
      title = `${icons.driver} Driver is on the way!`;
      body = `${driverName} (${vehiclePlate || 'Charter Keke'}) is heading to your pickup location.`;
      largeBody = `
${icons.driver} Your driver: ${driverName}
${icons.vehiclePlate || 'Plate: ' + (vehiclePlate || 'TBD')}
${icons.clock} ETA: ${Math.round(etaMinutes)} min
${icons.road} Distance: ${distanceKm.toFixed(1)} km

${icons.moving} ${icons.driver}📍➡️${icons.rider} ${icons.rider}

Tap to track live location
      `.trim();
      break;

    case 'arrived':
      title = `${icons.arrival} Driver has arrived!`;
      body = `${driverName} is waiting at your pickup location.`;
      largeBody = `
${icons.driver} Your driver: ${driverName}
${icons.vehiclePlate || 'Plate: ' + (vehiclePlate || 'TBD')}
${icons.here} Driver is at your location

${icons.driver} ${icons.here} ${icons.rider}

Head to your pickup spot now!
      `.trim();
      break;

    case 'in_progress':
      title = `${icons.started} Ride in progress`;
      body = `Heading to destination. ETA: ${Math.round(etaMinutes)} min`;
      largeBody = `
${icons.driver} Driver: ${driverName}
${icons.clock} ETA: ${Math.round(etaMinutes)} min
${icons.road} Distance remaining: ${distanceKm.toFixed(1)} km

${icons.moving} ${icons.driver}📍➡️${icons.flag} ${icons.flag}

Tap to see live tracking
      `.trim();
      break;

    case 'completed':
      title = `${icons.flag} Ride completed!`;
      body = `You've arrived at your destination.`;
      largeBody = `
${icons.here} Trip completed
${icons.driver} Driver: ${driverName}

${icons.flag} ${icons.here} ${icons.rider}

Please rate your driver
      `.trim();
      break;
  }

  return { title, body, largeBody };
}

/**
 * Generate a progress indicator string based on distance
 */
function generateProgressIndicator(distanceKm: number, totalDistance: number): string {
  const progress = Math.max(0, Math.min(1, 1 - (distanceKm / totalDistance)));
  const bars = 20;
  const filled = Math.round(progress * bars);
  const empty = bars - filled;

  const progressBar = '█'.repeat(filled) + '░'.repeat(empty);
  const percentage = Math.round(progress * 100);

  return `[${progressBar}] ${percentage}%`;
}

/**
 * Send a native live tracking notification
 * Uses emoji-based visuals instead of images
 */
export async function sendNativeLiveTrackingNotification(data: LiveTrackingData) {
  const { title, body, largeBody } = generateVisualStatus(data);

  // Calculate total distance for progress (rough estimate)
  const totalDistance = data.distanceKm + 2; // Assume 2km for pickup phase
  const progressIndicator = generateProgressIndicator(data.distanceKm, totalDistance);

  const notificationData = {
    title,
    body,
    type: 'live_tracking' as const,
    channelId: 'live-tracking',
    // Android-specific for expanded notification
    android: {
      channelId: 'live-tracking',
      priority: 'max',
      sticky: true,
      autoCancel: false,
      vibrate: [0, 200, 100, 200],
    },
    // iOS-specific
    ios: {
      sound: 'default',
      badge: 1,
    },
    data: {
      rideId: data.rideId,
      deeplink: `/rider/active-ride?rideId=${data.rideId}`,
      driverLocation: `${data.driverLocation.lat},${data.driverLocation.lng}`,
      pickupLocation: `${data.pickupLocation.lat},${data.pickupLocation.lng}`,
      destinationLocation: `${data.destinationLocation.lat},${data.destinationLocation.lng}`,
      eta: data.etaMinutes,
      distance: data.distanceKm,
      status: data.status,
      progress: progressIndicator,
      largeBody, // Include expanded text in data for custom handling
    },
  };

  try {
    await sendPushNotification([data.riderId], notificationData);
    console.log('✅ [LIVE-TRACKING] Native notification sent:', {
      rideId: data.rideId,
      status: data.status,
      eta: data.etaMinutes,
      distance: data.distanceKm,
    });
  } catch (error) {
    console.error('❌ [LIVE-TRACKING] Failed to send native notification:', error);
  }
}

/**
 * Send a simplified version for when frequent updates are needed
 * This is lighter and faster for real-time updates
 */
export async function sendQuickLiveUpdate(data: {
  rideId: string;
  riderId: string;
  etaMinutes: number;
  distanceKm: number;
  status: string;
}) {
  const { etaMinutes, distanceKm, status } = data;

  let title = '';
  let body = '';

  if (status === 'accepted') {
    title = '🛺 Driver on the way';
    body = `ETA: ${Math.round(etaMinutes)} min • ${distanceKm.toFixed(1)} km away`;
  } else if (status === 'arrived') {
    title = '🚨 Driver arrived';
    body = 'Your driver is waiting at pickup location';
  } else if (status === 'in_progress') {
    title = '🚀 En route to destination';
    body = `ETA: ${Math.round(etaMinutes)} min • ${distanceKm.toFixed(1)} km to go`;
  } else if (status === 'completed') {
    title = '🏁 Arrived!';
    body = 'You have reached your destination';
  }

  try {
    await sendPushNotification([data.riderId], {
      title,
      body,
      type: 'live_tracking' as const,
      channelId: 'live-tracking',
      android: {
        channelId: 'live-tracking',
        priority: 'high',
        vibrate: [0, 150, 100, 150],
      },
      ios: {
        sound: 'default',
        badge: 1,
      },
      data: {
        rideId: data.rideId,
        deeplink: `/rider/active-ride?rideId=${data.rideId}`,
        eta: etaMinutes,
        distance: distanceKm,
        status,
      },
    });
  } catch (error) {
    console.error('❌ [LIVE-TRACKING] Failed to send quick update:', error);
  }
}
