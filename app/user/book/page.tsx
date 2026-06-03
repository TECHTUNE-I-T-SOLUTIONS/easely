"use client"

// cSpell: disable-next-line dropoff Dropoff Keke keke
import { useState, useEffect, useRef, Suspense } from "react"
import Image from "next/image"
import { motion } from "framer-motion"
import { useAuth } from "@/lib/auth-context"
import { useRouter } from "next/navigation"
import { ProtectedRoute } from "@/components/protected-route"
import { AnimatedSidebar } from "@/components/animated-sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { BookingMap } from "@/components/booking-map"
import {
  MapPin,
  Navigation,
  Car,
  Loader2,
  ArrowRight,
  Search,
  Trash2,
  Route,
  Info,
} from "lucide-react"

// Base fare per kilometer
const BASE_FARE_PER_KM = 600
const PLATFORM_FEE_PERCENTAGE = 0.15 // 15% platform fee
const DRIVER_COMMISSION_PERCENTAGE = 0.85 // Driver gets 85%

interface Location {
  lat: number
  lng: number
  address: string
}

interface SearchResult {
  address: string
  lat: number
  lng: number
}


function BookRideContent() {
  const { user } = useAuth()
  const router = useRouter()
  const mapRef = useRef<HTMLDivElement>(null)

  const [pickupLocation, setPickupLocation] = useState<Location | null>(null)
  const [dropoffLocation, setDropoffLocation] = useState<Location | null>(null)
  const [pickupSearch, setPickupSearch] = useState("")
  const [dropoffSearch, setDropoffSearch] = useState("")
  const [estimatedDistance, setEstimatedDistance] = useState(0)
  const [estimatedFare, setEstimatedFare] = useState(0)
  const [platformFee, setPlatformFee] = useState(0)
  const [driverEarnings, setDriverEarnings] = useState(0)
  const [pickupTime, setPickupTime] = useState<string>(new Date().toISOString().slice(0, 16))
  const [seatsAvailable] = useState(4) // Booking entire keke (4 seats) - not user selectable
  const [activeLocationPicker, setActiveLocationPicker] = useState<"pickup" | "dropoff" | null>(null)
  const [pickupSearchResults, setPickupSearchResults] = useState<SearchResult[]>([])
  const [dropoffSearchResults, setDropoffSearchResults] = useState<SearchResult[]>([])
  const [showPickupResults, setShowPickupResults] = useState(false)
  const [showDropoffResults, setShowDropoffResults] = useState(false)
  const [isBooking, setIsBooking] = useState(false)
  const [locatingFor, setLocatingFor] = useState<"pickup" | "dropoff" | null>(null)

  // Calculate distance using Haversine formula
  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLng = ((lng2 - lng1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  // Update fare when locations change
  useEffect(() => {
    if (pickupLocation && dropoffLocation) {
      const distance = calculateDistance(
        pickupLocation.lat,
        pickupLocation.lng,
        dropoffLocation.lat,
        dropoffLocation.lng
      )
      
      // Calculate raw fare first
      let rawFare: number
      let displayDistance: number
      
      if (distance < 1) {
        // Minimum 1 km charge for distances under 1 km
        displayDistance = 1
        rawFare = 1 * BASE_FARE_PER_KM  // 600 naira
      } else {
        displayDistance = parseFloat(distance.toFixed(2))
        rawFare = distance * BASE_FARE_PER_KM
      }
      
      // Round the fare amount:
      // - If fare < 600 (below 1 km price), round up to nearest 100
      // - If fare >= 600, round up to nearest 10
      let roundedFare: number
      if (rawFare < 600) {
        roundedFare = Math.ceil(rawFare / 100) * 100
      } else {
        roundedFare = Math.ceil(rawFare / 10) * 10
      }
      
      // Calculate platform fee and driver earnings
      const platformFeeAmount = roundedFare * PLATFORM_FEE_PERCENTAGE
      const driverEarningsAmount = roundedFare * DRIVER_COMMISSION_PERCENTAGE
      
      setEstimatedDistance(displayDistance)
      setEstimatedFare(roundedFare)
      setPlatformFee(platformFeeAmount)
      setDriverEarnings(driverEarningsAmount)
    }
  }, [pickupLocation, dropoffLocation])

  // Search locations
  const handleSearch = async (query: string, type: "pickup" | "dropoff") => {
    if (!query || query.length < 2) {
      if (type === "pickup") {
        setPickupSearchResults([])
      } else {
        setDropoffSearchResults([])
      }
      return
    }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000) // 8 second timeout
      
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&bounded=1&viewbox=2.9,6.9,3.6,6.1`,
        { signal: controller.signal }
      )
      
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        throw new Error(`Search failed with status ${response.status}`)
      }
      
      const data = await response.json()

      const results = data.slice(0, 5).map((item: any) => ({
        address: item.display_name,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
      }))

      if (type === "pickup") {
        setPickupSearchResults(results)
        setShowPickupResults(true)
      } else {
        setDropoffSearchResults(results)
        setShowDropoffResults(true)
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          console.warn("Search request timed out")
        } else {
          console.warn("Search error:", error.message)
        }
      }
      // Silently fail - don't show error toast for search to avoid annoying users
      if (type === "pickup") {
        setPickupSearchResults([])
      } else {
        setDropoffSearchResults([])
      }
    }
  }

  // Reverse geocode coordinates to get address name
  const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
      )
      const data = await response.json()
      return data.address?.road || data.address?.suburb || data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`
    } catch (error) {
      console.error("Reverse geocoding error:", error)
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`
    }
  }

  const getFreshBrowserLocation = async (): Promise<{ lat: number; lng: number; accuracy?: number }> => {
    if (!navigator.geolocation) {
      throw new Error("Location is not supported by this browser")
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          })
        },
        () => reject(new Error("Unable to read your current location. Please check browser location permission.")),
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        }
      )
    })
  }

  const useCurrentLocation = async (type: "pickup" | "dropoff") => {
    try {
      setLocatingFor(type)
      const coords = await getFreshBrowserLocation()
      const address = await reverseGeocode(coords.lat, coords.lng)
      const location = { lat: coords.lat, lng: coords.lng, address }

      if (type === "pickup") {
        setPickupLocation(location)
        setPickupSearch("")
        setPickupSearchResults([])
        setShowPickupResults(false)
      } else {
        setDropoffLocation(location)
        setDropoffSearch("")
        setDropoffSearchResults([])
        setShowDropoffResults(false)
      }

      toast.success(`Current location set as ${type}`, {
        description: coords.accuracy ? `GPS accuracy: about ${Math.round(coords.accuracy)}m` : undefined,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to read current location")
    } finally {
      setLocatingFor(null)
    }
  }

  // Select from search result
  const selectSearchResult = (result: SearchResult, type: "pickup" | "dropoff") => {
    if (type === "pickup") {
      setPickupLocation(result)
      setPickupSearch("")
      setPickupSearchResults([])
      setShowPickupResults(false)
    } else {
      setDropoffLocation(result)
      setDropoffSearch("")
      setDropoffSearchResults([])
      setShowDropoffResults(false)
    }
    toast.success("Location selected!")
  }

  // Book ride
  const handleBookRide = async () => {
    if (!pickupLocation || !dropoffLocation) {
      toast.error("Please select both pickup and dropoff locations")
      return
    }

    setIsBooking(true)

    try {
      const response = await fetch("/api/user/book-ride", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickup_location: pickupLocation,
          dropoff_location: dropoffLocation,
          estimated_distance: estimatedDistance,
          number_of_seats: 1, // Always 1 for charter
          pickup_time: pickupTime,
          fare_amount: estimatedFare,
          platform_fee: platformFee,
          driver_earnings: driverEarnings,
          seats_available: seatsAvailable,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to book ride")
      }

      toast.success("Ride booked successfully! Finding drivers...")
      // Reset form
      setPickupLocation(null)
      setDropoffLocation(null)
      setEstimatedFare(0)
      setEstimatedDistance(0)
      setPlatformFee(0)
      setDriverEarnings(0)
      setPickupTime(new Date().toISOString().slice(0, 16))
      // Navigate to rides page so user can view their booking
      router.push("/user/rides")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to book ride")
    } finally {
      setIsBooking(false)
    }
  }


  return (
    <div className="flex min-h-screen bg-background">
      <AnimatedSidebar />

      <main className="flex-1 lg:pl-0 pt-16 lg:pt-0 pb-24 lg:pb-0">
        <div className="p-4 md:p-6 lg:p-8 space-y-6">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Image src="/charter keke.png" alt="Charter Keke" width={24} height={24} />
              <span className="text-sm text-primary font-medium">Charter Keke Rider</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-serif font-bold text-foreground">Book a Ride</h1>
            <p className="text-muted-foreground mt-1">Select pickup & dropoff on the map below</p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
            {/* Map Section - Shows first on mobile, second on desktop */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="lg:col-span-2"
            >
              <Card className="bg-card/50 backdrop-blur border-primary/10 h-full flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                        <Route className="h-5 w-5" />
                        Interactive Map
                      </CardTitle>
                      <CardDescription className="mt-1 text-xs md:text-sm">
                        {activeLocationPicker
                          ? `🎯 Click on the map to set your ${activeLocationPicker} location`
                          : "Click 'Pick on map' or search for locations to plan your route"}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0 pb-4 relative flex-1 flex flex-col">
                  <BookingMap
                    pickupLocation={pickupLocation}
                    dropoffLocation={dropoffLocation}
                    onPickupSet={setPickupLocation}
                    onDropoffSet={setDropoffLocation}
                    activeLocationPicker={activeLocationPicker}
                    setActiveLocationPicker={setActiveLocationPicker}
                  />

                  {/* Instructions */}
                  {!pickupLocation && !dropoffLocation && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="bg-card/95 backdrop-blur border border-border rounded-lg p-3 md:p-4 max-w-xs text-center">
                        <Info className="h-8 w-8 mx-auto mb-2 text-primary" />
                        <p className="text-sm font-medium mb-1">Get Started</p>
                        <p className="text-xs text-muted-foreground">Use the location selector to pick your journey on the map</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Trip Details - Shows second on mobile, first on desktop */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="lg:col-span-1"
            >
              <Card className="bg-card/50 backdrop-blur border-primary/10 h-full flex flex-col">
                <CardContent className="p-4 space-y-4 flex-1 flex flex-col">
                  {/* Pickup Time Section */}
                  <div className="space-y-2">
                    <Label htmlFor="pickupTime" className="text-sm font-semibold">
                      Preferred Pickup Time
                    </Label>
                    <Input
                      id="pickupTime"
                      type="datetime-local"
                      value={pickupTime}
                      onChange={(e) => setPickupTime(e.target.value)}
                      min={new Date().toISOString().slice(0, 16)}
                      className="bg-background/50 h-10 text-base"
                    />
                  </div>

                  {/* Divider */}
                  <div className="h-px bg-border" />

                  {/* Pickup Location Section */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-semibold">
                      <MapPin className="h-4 w-4 text-green-500" />
                      <span>Pickup Location</span>
                    </Label>
                    
                    {!pickupLocation ? (
                      <div className="space-y-2 relative">
                        <Input
                          placeholder="Search or pick on map..."
                          value={pickupSearch}
                          onChange={(e) => {
                            setPickupSearch(e.target.value)
                            handleSearch(e.target.value, "pickup")
                          }}
                          onFocus={() => setShowPickupResults(true)}
                          className="bg-background/50 h-10 text-base"
                        />
                        {/* Local Pickup Search Results */}
                        {showPickupResults && pickupSearchResults.length > 0 && pickupSearch && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-card border-2 border-primary/50 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                            <div className="sticky top-0 bg-card/95 backdrop-blur px-3 py-2 border-b border-border">
                              <p className="text-xs font-semibold text-muted-foreground">Pickup Locations</p>
                            </div>
                            {pickupSearchResults.map((result, idx) => (
                              <button
                                key={idx}
                                onClick={() => selectSearchResult(result, "pickup")}
                                className="w-full px-3 py-3 text-left hover:bg-primary/10 active:bg-primary/20 border-b border-border/20 last:border-b-0 transition-all text-sm sm:text-base"
                              >
                                <p className="font-medium line-clamp-1 text-foreground">{result.address}</p>
                                <p className="text-xs text-muted-foreground">{result.lat.toFixed(4)}, {result.lng.toFixed(4)}</p>
                              </button>
                            ))}
                          </div>
                        )}
                        <Button
                          onClick={() => useCurrentLocation("pickup")}
                          variant="secondary"
                          className="w-full h-10 text-sm font-medium"
                          disabled={locatingFor !== null}
                        >
                          {locatingFor === "pickup" ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Navigation className="h-4 w-4 mr-2" />
                          )}
                          Use current location
                        </Button>
                        <Button
                          onClick={() => setActiveLocationPicker("pickup")}
                          variant={activeLocationPicker === "pickup" ? "default" : "outline"}
                          className="w-full h-10 text-sm font-medium"
                        >
                          {activeLocationPicker === "pickup" ? "🎯 Tap on map..." : "📍 Pick on map"}
                        </Button>
                      </div>
                    ) : (
                      <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-green-700 dark:text-green-400 text-sm truncate">
                            {pickupLocation.address}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">{pickupLocation.lat.toFixed(4)}, {pickupLocation.lng.toFixed(4)}</p>
                        </div>
                        <Button
                          onClick={() => setPickupLocation(null)}
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 shrink-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Divider */}
                  <div className="h-px bg-border" />

                  {/* Dropoff Location Section */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-sm font-semibold">
                      <Navigation className="h-4 w-4 text-red-500" />
                      <span>Dropoff Location</span>
                    </Label>
                    
                    {!dropoffLocation ? (
                      <div className="space-y-2 relative">
                        <Input
                          placeholder="Search or pick on map..."
                          value={dropoffSearch}
                          onChange={(e) => {
                            setDropoffSearch(e.target.value)
                            handleSearch(e.target.value, "dropoff")
                          }}
                          onFocus={() => setShowDropoffResults(true)}
                          className="bg-background/50 h-10 text-base"
                        />
                        {/* Local Dropoff Search Results */}
                        {showDropoffResults && dropoffSearchResults.length > 0 && dropoffSearch && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-card border-2 border-primary/50 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                            <div className="sticky top-0 bg-card/95 backdrop-blur px-3 py-2 border-b border-border">
                              <p className="text-xs font-semibold text-muted-foreground">Dropoff Locations</p>
                            </div>
                            {dropoffSearchResults.map((result, idx) => (
                              <button
                                key={idx}
                                onClick={() => selectSearchResult(result, "dropoff")}
                                className="w-full px-3 py-3 text-left hover:bg-primary/10 active:bg-primary/20 border-b border-border/20 last:border-b-0 transition-all text-sm sm:text-base"
                              >
                                <p className="font-medium line-clamp-1 text-foreground">{result.address}</p>
                                <p className="text-xs text-muted-foreground">{result.lat.toFixed(4)}, {result.lng.toFixed(4)}</p>
                              </button>
                            ))}
                          </div>
                        )}
                        <Button
                          onClick={() => useCurrentLocation("dropoff")}
                          variant="secondary"
                          className="w-full h-10 text-sm font-medium"
                          disabled={locatingFor !== null}
                        >
                          {locatingFor === "dropoff" ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Navigation className="h-4 w-4 mr-2" />
                          )}
                          Use current location
                        </Button>
                        <Button
                          onClick={() => setActiveLocationPicker("dropoff")}
                          variant={activeLocationPicker === "dropoff" ? "default" : "outline"}
                          className="w-full h-10 text-sm font-medium"
                        >
                          {activeLocationPicker === "dropoff" ? "🎯 Tap on map..." : "🏁 Pick on map"}
                        </Button>
                      </div>
                    ) : (
                      <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-red-700 dark:text-red-400 text-sm truncate">
                            {dropoffLocation.address}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">{dropoffLocation.lat.toFixed(4)}, {dropoffLocation.lng.toFixed(4)}</p>
                        </div>
                        <Button
                          onClick={() => setDropoffLocation(null)}
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 shrink-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Divider */}
                  <div className="h-px bg-border" />

                  {/* Fare Estimate */}
                  {pickupLocation && dropoffLocation && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-3 p-4 rounded-lg bg-gradient-to-br from-primary/10 to-secondary/10 border border-primary/20"
                    >
                      <h3 className="font-semibold text-sm text-foreground">Fare Estimate</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Distance</span>
                          <span className="font-semibold">{estimatedDistance.toFixed(2)} km</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Rate/km</span>
                          <span className="font-semibold">₦{BASE_FARE_PER_KM}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Base Fare</span>
                          <span className="font-semibold">₦{estimatedFare.toLocaleString()}</span>
                        </div>
                        {/* <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Platform Fee (15%)</span>
                          <span className="font-semibold">₦{platformFee.toLocaleString(undefined, {maximumFractionDigits: 2})}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Driver Earning (85%)</span>
                          <span className="font-semibold text-green-600 dark:text-green-400">₦{driverEarnings.toLocaleString(undefined, {maximumFractionDigits: 2})}</span>
                        </div> */}
                        <div className="h-px bg-border" />
                        <div className="flex justify-between">
                          <span className="text-muted-foreground font-medium">Total Fare (You Pay)</span>
                          <span className="text-2xl font-bold text-primary">₦{estimatedFare.toLocaleString()}</span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">Pay directly to driver after ride</p>
                    </motion.div>
                  )}

                  {/* Book Button */}
                  <Button
                    onClick={handleBookRide}
                    disabled={isBooking || !pickupLocation || !dropoffLocation}
                    className="w-full bg-gradient-to-r from-primary to-secondary hover:opacity-90 py-6 h-12 text-base font-semibold"
                  >
                    {isBooking ? (
                      <>
                        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                        Booking...
                      </>
                    ) : (
                      <>
                        <Car className="h-5 w-5 mr-2" />
                        Book Ride
                        <ArrowRight className="h-5 w-5 ml-2" />
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default function BookRidePage() {
  return (
    <ProtectedRoute allowedRoles={["user"]}>
      <BookRideContent />
    </ProtectedRoute>
  )
}
