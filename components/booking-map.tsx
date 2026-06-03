"use client"

import { useEffect, useRef, useState } from "react"
import { MapPin, Navigation, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Location {
  lat: number
  lng: number
  address: string
}

interface BookingMapProps {
  pickupLocation: Location | null
  dropoffLocation: Location | null
  onPickupSet: (location: Location) => void
  onDropoffSet: (location: Location) => void
  activeLocationPicker: "pickup" | "dropoff" | null
  setActiveLocationPicker: (value: "pickup" | "dropoff" | null) => void
}

export function BookingMap({
  pickupLocation,
  dropoffLocation,
  onPickupSet,
  onDropoffSet,
  activeLocationPicker,
  setActiveLocationPicker,
}: BookingMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const pickupMarkerRef = useRef<any>(null)
  const dropoffMarkerRef = useRef<any>(null)
  const currentMarkerRef = useRef<any>(null)
  const routeLayerRef = useRef<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null)
  const activePickerRef = useRef<"pickup" | "dropoff" | null>(null)

  // Get user's current location
  useEffect(() => {
    if (navigator.geolocation) {
      const options: PositionOptions = {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }

      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          setUserLocation([position.coords.latitude, position.coords.longitude])
        },
        (error) => {
          console.log("Geolocation error:", error)
          setUserLocation((current) => current || [6.5244, 3.3792])
        },
        options
      )

      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation([position.coords.latitude, position.coords.longitude])
        },
        (error) => {
          console.log("Initial geolocation error:", error)
          setUserLocation((current) => current || [6.5244, 3.3792])
        },
        options
      )

      return () => navigator.geolocation.clearWatch(watchId)
    } else {
      // Default to Lagos
      setUserLocation([6.5244, 3.3792])
    }
  }, [])

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    let L: any
    let map: any

    const initMap = async () => {
      try {
        // Dynamically import Leaflet
        L = (await import("leaflet")).default
        ;(window as any).L = L
        await import("leaflet/dist/leaflet.css")

        // Fix marker icons
        delete (L.Icon.Default.prototype as any)._getIconUrl
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
          iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
          shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
        })

        // Create map
        map = L.map(mapRef.current, {
          center: userLocation || [6.5244, 3.3792],
          zoom: 13,
          zoomControl: true,
          attributionControl: true,
        })

        mapInstanceRef.current = map

        // Add tile layer
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        }).addTo(map)

        const currentIcon = L.divIcon({
          html: '<div style="background:#2563eb;width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 2px 10px rgba(0,0,0,.35);"></div>',
          className: "",
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        })
        if (userLocation) {
          currentMarkerRef.current = L.marker(userLocation, { icon: currentIcon })
            .addTo(map)
            .bindPopup("Your current location")
        }

        // Add click handler. Use a ref to read the latest picker state (avoids stale closure)
        map.on("click", async (e: any) => {
          const { lat, lng } = e.latlng
          const currentPicker = activePickerRef.current

          if (currentPicker) {
            // Reverse geocode to get address
            const address = await reverseGeocode(lat, lng)
            const location = { lat, lng, address }

            if (currentPicker === "pickup") {
              onPickupSet(location)

              // Add or update pickup marker
              if (pickupMarkerRef.current) {
                pickupMarkerRef.current.setLatLng([lat, lng])
              } else {
                const pickupIcon = L.divIcon({
                  html: '<div style="background: #22c55e; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">📍</div>',
                  className: "",
                  iconSize: [32, 32],
                  iconAnchor: [16, 16],
                })
                pickupMarkerRef.current = L.marker([lat, lng], { icon: pickupIcon })
                  .addTo(map)
                  .bindPopup(`<b>Pickup:</b><br/>${address}`)
              }
            } else if (currentPicker === "dropoff") {
              onDropoffSet(location)

              // Add or update dropoff marker
              if (dropoffMarkerRef.current) {
                dropoffMarkerRef.current.setLatLng([lat, lng])
              } else {
                const dropoffIcon = L.divIcon({
                  html: '<div style="background: #ef4444; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">🎯</div>',
                  className: "",
                  iconSize: [32, 32],
                  iconAnchor: [16, 16],
                })
                dropoffMarkerRef.current = L.marker([lat, lng], { icon: dropoffIcon })
                  .addTo(map)
                  .bindPopup(`<b>Destination:</b><br/>${address}`)
              }
            }

            // Clear picker state via callback
            setActiveLocationPicker(null)
            activePickerRef.current = null
          }
        })

        setIsLoading(false)
      } catch (error) {
        console.error("Map initialization error:", error)
        setIsLoading(false)
      }
    }

    initMap()

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!mapInstanceRef.current || !userLocation) return

    const L = (window as any).L
    if (!L) return

    if (currentMarkerRef.current) {
      currentMarkerRef.current.setLatLng(userLocation)
    } else {
      const currentIcon = L.divIcon({
        html: '<div style="background:#2563eb;width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 2px 10px rgba(0,0,0,.35);"></div>',
        className: "",
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      })
      currentMarkerRef.current = L.marker(userLocation, { icon: currentIcon })
        .addTo(mapInstanceRef.current)
        .bindPopup("Your current location")
    }
  }, [userLocation])

  // Keep a ref of the active picker so the map click handler sees latest value
  useEffect(() => {
    activePickerRef.current = activeLocationPicker

    // Change cursor to indicate picking mode
    if (mapRef.current) {
      mapRef.current.style.cursor = activeLocationPicker ? "crosshair" : ""
    }
  }, [activeLocationPicker])

  // Update markers when locations change
  useEffect(() => {
    if (!mapInstanceRef.current) return

    const L = (window as any).L
    if (!L) return

    // Update pickup marker
    if (pickupLocation) {
      if (pickupMarkerRef.current) {
        pickupMarkerRef.current.setLatLng([pickupLocation.lat, pickupLocation.lng])
      } else {
        const pickupIcon = L.divIcon({
          html: '<div style="background: #22c55e; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">📍</div>',
          className: "",
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        })
        pickupMarkerRef.current = L.marker([pickupLocation.lat, pickupLocation.lng], { icon: pickupIcon })
          .addTo(mapInstanceRef.current)
          .bindPopup(`<b>Pickup:</b><br/>${pickupLocation.address}`)
      }
    }

    // Update dropoff marker
    if (dropoffLocation) {
      if (dropoffMarkerRef.current) {
        dropoffMarkerRef.current.setLatLng([dropoffLocation.lat, dropoffLocation.lng])
      } else {
        const dropoffIcon = L.divIcon({
          html: '<div style="background: #ef4444; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">🎯</div>',
          className: "",
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        })
        dropoffMarkerRef.current = L.marker([dropoffLocation.lat, dropoffLocation.lng], { icon: dropoffIcon })
          .addTo(mapInstanceRef.current)
          .bindPopup(`<b>Destination:</b><br/>${dropoffLocation.address}`)
      }
    }

    // Draw simple route (polyline) if both locations are set
    if (pickupLocation && dropoffLocation) {
      // Remove old route
      if (routeLayerRef.current && mapInstanceRef.current) {
        try {
          mapInstanceRef.current.removeLayer(routeLayerRef.current)
        } catch (e) {
          // ignore
        }
        routeLayerRef.current = null
      }

      // Create new simple polyline route between pickup and dropoff
      const latlngs = [
        [pickupLocation.lat, pickupLocation.lng],
        [dropoffLocation.lat, dropoffLocation.lng],
      ]

      routeLayerRef.current = L.polyline(latlngs, { color: "#3b82f6", weight: 4, opacity: 0.7 }).addTo(
        mapInstanceRef.current
      )

      // Fit bounds to the route with padding
      try {
        mapInstanceRef.current.fitBounds(routeLayerRef.current.getBounds(), { padding: [50, 50] })
      } catch (e) {
        // ignore fit errors
      }
    }
  }, [pickupLocation, dropoffLocation])

  // Reverse geocode function
  const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
      )
      const data = await response.json()
      return data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`
    } catch (error) {
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`
    }
  }

  return (
    <div className="relative h-[450px] md:h-[500px] rounded-lg overflow-hidden">
      {/* Map container */}
      <div ref={mapRef} className="w-full h-full" />

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
            <p className="text-sm text-muted-foreground">Loading map...</p>
          </div>
        </div>
      )}

      {/* Location picker buttons */}
      <div className="absolute top-4 left-4 right-4 z-[1000] flex gap-2">
        <Button
          onClick={() => setActiveLocationPicker(activeLocationPicker === "pickup" ? null : "pickup")}
          variant={activeLocationPicker === "pickup" ? "default" : "secondary"}
          size="sm"
          className="flex-1 shadow-lg"
        >
          <MapPin className="h-4 w-4 mr-2" />
          {activeLocationPicker === "pickup" ? "Picking Pickup..." : "Pick Pickup"}
        </Button>
        <Button
          onClick={() => setActiveLocationPicker(activeLocationPicker === "dropoff" ? null : "dropoff")}
          variant={activeLocationPicker === "dropoff" ? "default" : "secondary"}
          size="sm"
          className="flex-1 shadow-lg"
        >
          <Navigation className="h-4 w-4 mr-2" />
          {activeLocationPicker === "dropoff" ? "Picking Dropoff..." : "Pick Dropoff"}
        </Button>
      </div>

      {/* Clear locations button */}
      {(pickupLocation || dropoffLocation) && (
        <div className="absolute bottom-4 right-4 z-[1000]">
          <Button
            onClick={() => {
              onPickupSet(null as any)
              onDropoffSet(null as any)
              if (pickupMarkerRef.current) {
                pickupMarkerRef.current.remove()
                pickupMarkerRef.current = null
              }
              if (dropoffMarkerRef.current) {
                dropoffMarkerRef.current.remove()
                dropoffMarkerRef.current = null
              }
              if (routeLayerRef.current && mapInstanceRef.current) {
                mapInstanceRef.current.removeControl(routeLayerRef.current)
                routeLayerRef.current = null
              }
            }}
            variant="destructive"
            size="sm"
            className="shadow-lg"
          >
            Clear Map
          </Button>
        </div>
      )}
    </div>
  )
}
