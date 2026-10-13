# Native Live Tracking Notification Approach

## Problem
The previous image-based banner approach for live tracking notifications didn't work reliably:
- Images required Mapbox API tokens
- Image URLs from hosting services (ibb.co) were page URLs, not direct image URLs
- Android notification banners might not show due to channel configuration
- iOS doesn't support rich media in the same way as Android

## Solution: Native Emoji-Based Notifications

We've implemented a **native, cross-platform approach** that works like Bolt and other ride-hailing apps:

### Key Features

1. **Emoji-Based Visual Indicators**
   - 🛺 Driver/Keke icon
   - 📍 Rider/Location pin
   - 🛣️ Road/Route indicator
   - ⏱️ Clock/ETA
   - 🏁 Destination flag
   - 🚨 Arrival alert
   - 🚀 Ride started
   - ✅ Completed/Here

2. **Dynamic Status Messages**
   - Each ride stage has a specific title and body
   - Updates in real-time as driver moves
   - Shows ETA and distance clearly

3. **Progress Visualization**
   - Text-based progress bar: `[████████░░░░░░░░░░░░] 40%`
   - Visual ASCII art showing driver → rider → destination
   - Example: `🛺📍➡️📍` (driver to pickup) or `🛺📍➡️🏁` (to destination)

4. **Platform-Specific Enhancements**

   **Android:**
   - MAX importance for heads-up banners
   - Big text style for expanded notifications
   - Progress bar indicator
   - Sticky notifications (stays until dismissed)
   - Lock screen visibility

   **iOS:**
   - Mutable content for dynamic updates
   - Sound alerts
   - Badge count updates
   - Tap-to-action deeplinks

### Notification Stages

#### 1. **Accepted** (Driver on the way)
```
Title: 🛺 Driver is on the way!
Body: John Doe (ABC 123) is heading to your pickup location.

Expanded:
🛺 Your driver: John Doe
Plate: ABC 123
⏱️ ETA: 5 min
🛣️ Distance: 2.3 km

🛺📍➡️📍

Tap to track live location
```

#### 2. **Arrived** (Driver at pickup)
```
Title: 🚨 Driver has arrived!
Body: John Doe is waiting at your pickup location.

Expanded:
🛺 Your driver: John Doe
Plate: ABC 123
✅ Driver is at your location

🛺 ✅ 📍

Head to your pickup spot now!
```

#### 3. **In Progress** (En route to destination)
```
Title: 🚀 Ride in progress
Body: Heading to destination. ETA: 8 min

Expanded:
🛺 Driver: John Doe
⏱️ ETA: 8 min
🛣️ Distance remaining: 3.5 km

🛺📍➡️🏁

Tap to see live tracking
```

#### 4. **Completed** (Arrived at destination)
```
Title: 🏁 Ride completed!
Body: You've arrived at your destination.

Expanded:
✅ Trip completed
🛺 Driver: John Doe

🏁 ✅ 📍

Please rate your driver
```

### Technical Implementation

#### Backend
- **File**: `lib/live-tracking-native.ts`
- **Function**: `sendNativeLiveTrackingNotification(data)`
- **Function**: `sendQuickLiveUpdate(data)` (for frequent updates)

#### Mobile App
- **Android Channel**: `live-tracking` (MAX importance)
- **iOS Configuration**: Mutable content enabled
- **Deeplinks**: `/rider/active-ride?rideId={rideId}`

### Advantages Over Image-Based Approach

1. ✅ **No external dependencies** - No Mapbox tokens needed
2. ✅ **Faster delivery** - Text is lighter than images
3. ✅ **Cross-platform** - Works consistently on Android and iOS
4. ✅ **Dynamic updates** - Can update frequently without caching issues
5. ✅ **Battery efficient** - No image processing required
6. ✅ **Reliable** - Emoji rendering is native to both platforms
7. ✅ **Native feel** - Similar to Bolt, Uber, Lyft

### When to Use

- **sendNativeLiveTrackingNotification**: For major status changes (accepted, arrived, started, completed)
- **sendQuickLiveUpdate**: For frequent location updates (every 30-60 seconds during ride)

### Configuration

**Backend (.env.local):**
```env
# No additional tokens needed for native approach
# (Previously needed MAPBOX_SECRET_TOKEN for images)
```

**Mobile (app.json or config):**
```json
{
  "notification": {
    "android": {
      "channels": [
        {
          "id": "live-tracking",
          "name": "Live Tracking",
          "importance": "max",
          "vibration": true,
          "sound": true
        }
      ]
    }
  }
}
```

### Testing

1. **Android**: Use a standalone build (not Expo Go)
   - Settings → Apps → Charter Keke → Notifications
   - Ensure "Live Tracking" channel is enabled
   - Importance should be set to "High" or "Urgent"

2. **iOS**: Use TestFlight or development build
   - Settings → Notifications → Charter Keke
   - Enable "Allow Notifications"
   - Enable "Banners" and "Alerts"

### Migration from Image-Based

The image-based approach (`push-service-enhanced.ts`) is still available but deprecated:
- It requires Mapbox tokens
- Has reliability issues with hosted images
- Slower due to image generation/delivery

The native approach (`live-tracking-native.ts`) is now the recommended method.

### Future Enhancements

1. **Animated Emojis**: iOS supports animated emoji in notifications
2. **Custom Icons**: Can add app-specific icons via Expo config
3. **Location Maps**: Use native map view when user taps notification
4. **Rich Notifications**: iOS Actionable notifications (rate now, call driver)
5. **Grouped Notifications**: Group all ride updates under one thread

### Example Usage

```typescript
import { sendNativeLiveTrackingNotification } from '@/lib/live-tracking-native';

await sendNativeLiveTrackingNotification({
  rideId: 'abc-123',
  riderId: 'user-456',
  driverName: 'John Doe',
  driverLocation: { lat: 6.5244, lng: 3.3792 },
  pickupLocation: { lat: 6.5276, lng: 3.3810, address: '123 Main St' },
  destinationLocation: { lat: 6.5344, lng: 3.3920, address: '456 Oak Ave' },
  etaMinutes: 5,
  distanceKm: 2.3,
  status: 'accepted',
  vehiclePlate: 'ABC 123',
});
```

## Summary

This native emoji-based approach provides:
- ✅ Reliable cross-platform notifications
- ✅ Real-time status updates
- ✅ Visual progress indicators
- ✅ No external dependencies
- ✅ Battery and performance efficient
- ✅ User-friendly and familiar (like Bolt/Uber)

The system is production-ready and can be deployed via OTA update.
