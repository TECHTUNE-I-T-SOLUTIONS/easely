import {
  sendPushNotification,
  broadcastToDrivers,
  broadcastToRiders,
} from "./push-service";

/**
 * Emit ride request to nearby drivers
 * Called when a new ride is created
 */
export async function emitRideRequest(
  rideId: string,
  pickupLocation: string,
  dropoffLocation: string,
  fare: number,
  estimatedDistance: number,
  originalFare?: number,
  cashbackDiscount?: number
) {
  try {
    const payload = {
      title: "🚗 New Ride Request",
      body: `${pickupLocation} → ${dropoffLocation} (₦${fare}${cashbackDiscount && cashbackDiscount > 0 ? ` - ₦${cashbackDiscount} cashback` : ''})`,
      type: "ride_request" as const,
       categoryId: "ride_request_action",
      data: {
        rideId,
        pickup: pickupLocation,
        dropoff: dropoffLocation,
        fare,
        originalFare: originalFare || fare,
        cashbackDiscount: cashbackDiscount || 0,
        distance: estimatedDistance.toString(),
        action: "ride_request_notification",
         actions: ["accept", "reject"],
      },
    };

    await broadcastToDrivers(payload);
    console.log("✅ [Emitter] Ride request broadcast to drivers. Ride ID:", rideId);
  } catch (error) {
    console.error("❌ [Emitter] Failed to emit ride request:", error);
  }
}

/**
 * Emit ride accepted notification to rider
 * Called when a driver accepts a ride
 */
export async function emitRideAccepted(
  riderId: string,
  driverUserId: string,
  rideId: string,
  driverName: string,
  driverPhone: string,
  vehicleDetails: string,
  estimatedArrival: number,
  pickup?: string,
  dropoff?: string,
  fare?: number
) {
  try {
    const riderPayload = {
      title: "🎉 Ride Accepted",
      body: `${driverName} accepted your ride. ETA ${estimatedArrival} min. ${vehicleDetails}`,
      type: "ride_accepted" as const,
      data: {
        rideId,
        driverName,
        driverPhone,
        vehicleDetails,
        pickup,
        dropoff,
        fare: fare?.toString() || "0",
        estimatedArrival: estimatedArrival.toString(),
        action: "ride_accepted_notification",
      },
    };

    const driverPayload = {
      title: "✅ Ride Accepted",
      body: `You accepted ride ${rideId.slice(0, 8)}${fare ? ` • ₦${fare}` : ""}`,
      type: "ride_update" as const,
      data: {
        rideId,
        action: "driver_accept_confirmation",
        pickup,
        dropoff,
        fare: fare?.toString() || "0",
      },
    };

    await sendPushNotification([riderId], riderPayload);
    await sendPushNotification([driverUserId], driverPayload as any);
    console.log("✅ [Emitter] Ride accepted notification sent to rider:", riderId);
  } catch (error) {
    console.error("❌ [Emitter] Failed to emit ride accepted:", error);
  }
}

/**
 * Emit driver arrival notification to rider
 * Called when driver arrives at pickup location
 */
export async function emitDriverArrived(
  riderId: string,
  rideId: string,
  driverName: string,
  vehicleDetails: string
) {
  try {
    const payload = {
      title: "🚗 Driver Arrived",
      body: `${driverName} is here. Please come out!`,
      type: "ride_update" as const,
      data: {
        rideId,
        driverName,
        vehicleDetails,
        updateType: "driver_arrived",
        action: "driver_arrived_notification",
      },
    };

    await sendPushNotification([riderId], payload);
    console.log("✅ [Emitter] Driver arrived notification sent to rider:", riderId);
  } catch (error) {
    console.error("❌ [Emitter] Failed to emit driver arrived:", error);
  }
}

/**
 * Emit ride update notification (live location, etc)
 * Called for status updates during ride
 */
export async function emitRideUpdate(
  userId: string,
  rideId: string,
  updateType: "in_transit" | "navigation" | "status",
  message: string
) {
  try {
    const payload = {
      title: "📍 Ride Update",
      body: message,
      type: "ride_update" as const,
      data: {
        updateType,
        rideId,
        action: "ride_update_notification",
      },
    };

    await sendPushNotification([userId], payload);
    console.log("✅ [Emitter] Ride update sent to user:", userId);
  } catch (error) {
    console.error("❌ [Emitter] Failed to emit ride update:", error);
  }
}

/**
 * Emit ride cancelled notification
 * Called when a ride is cancelled
 */
export async function emitRideCancelled(
  recipientId: string,
  rideId: string,
  reason: string
) {
  try {
    const payload = {
      title: "❌ Ride Cancelled",
      body: `Your ride was cancelled. Reason: ${reason}`,
      type: "ride_update" as const,
      data: {
        rideId,
        reason,
        action: "ride_cancelled_notification",
      },
    };

    await sendPushNotification([recipientId], payload);
    console.log("✅ [Emitter] Ride cancelled notification sent to:", recipientId);
  } catch (error) {
    console.error("❌ [Emitter] Failed to emit ride cancelled:", error);
  }
}

/**
 * Emit ride completed notification
 * Called when ride is completed
 */
export async function emitRideCompleted(
  riderId: string,
  driverUserId: string,
  rideId: string,
  fare: number,
  rating?: number
) {
  try {
    const riderPayload = {
      title: "✅ Ride Completed",
      body: `Ride completed. Total fare: ₦${fare}`,
      type: "ride_update" as const,
      data: {
        rideId,
        fare: fare.toString(),
        rating: rating?.toString() || "0",
        action: "ride_completed_notification",
      },
    };

    const driverPayload = {
      title: "🏁 Trip Completed",
      body: `You completed ride ${rideId.slice(0, 8)}. Fare: ₦${fare}`,
      type: "ride_update" as const,
      data: {
        rideId,
        fare: fare.toString(),
        action: "driver_ride_completed_notification",
      },
    };

    await sendPushNotification([riderId], riderPayload);
    await sendPushNotification([driverUserId], driverPayload as any);
    console.log("✅ [Emitter] Ride completed notification sent to rider and driver");
  } catch (error) {
    console.error("❌ [Emitter] Failed to emit ride completed:", error);
  }
}

/**
 * Emit payment received notification
 * Called when payment is processed
 */
export async function emitPaymentReceived(
  userId: string,
  amount: number,
  method: string,
  transactionId: string
) {
  try {
    const payload = {
      title: "💰 Payment Received",
      body: `Payment of ₹${amount} received via ${method}`,
      type: "payment_received" as const,
      data: {
        amount: amount.toString(),
        method,
        transactionId,
        action: "payment_notification",
      },
    };

    await sendPushNotification([userId], payload);
    console.log("✅ [Emitter] Payment notification sent to:", userId);
  } catch (error) {
    console.error("❌ [Emitter] Failed to emit payment received:", error);
  }
}

/**
 * Emit support message notification
 * Called when support sends a message
 */
export async function emitSupportMessage(
  userId: string,
  message: string,
  ticketId: string
) {
  try {
    const payload = {
      title: "💬 Support Message",
      body: message.substring(0, 100), // Truncate long messages
      type: "support_message" as const,
      data: {
        ticketId,
        message,
        action: "support_message_notification",
      },
    };

    await sendPushNotification([userId], payload);
    console.log("✅ [Emitter] Support message sent to:", userId);
  } catch (error) {
    console.error("❌ [Emitter] Failed to emit support message:", error);
  }
}

/**
 * Emit ride request accepted by driver (to other drivers)
 * Called to notify other drivers that ride is taken
 */
export async function emitRideTaken(rideId: string) {
  try {
    const payload = {
      title: "ℹ️ Ride Taken",
      body: "Another driver accepted this ride",
      type: "ride_update" as const,
      data: {
        rideId,
        action: "ride_taken_notification",
      },
    };

    await broadcastToDrivers(payload);
    console.log("✅ [Emitter] Ride taken broadcast to drivers. Ride ID:", rideId);
  } catch (error) {
    console.error("❌ [Emitter] Failed to emit ride taken:", error);
  }
}

/**
 * Emit admin broadcast notification
 * Called for system-wide announcements
 */
export async function emitAdminBroadcast(
  message: string,
  targetUserIds?: string[]
) {
  try {
    const payload = {
      title: "📢 System Update",
      body: message,
      type: "ride_update" as const,
      data: {
        action: "admin_notification",
      },
    };

    if (targetUserIds && targetUserIds.length > 0) {
      // Send to specific users
      await sendPushNotification(targetUserIds, payload);
      console.log("✅ [Emitter] Admin broadcast sent to", targetUserIds.length, "users");
    } else {
      // Broadcast to all
      await broadcastToDrivers(payload);
      await broadcastToRiders(payload);
      console.log("✅ [Emitter] Admin broadcast sent to all users");
    }
  } catch (error) {
    console.error("❌ [Emitter] Failed to emit admin broadcast:", error);
  }
}
