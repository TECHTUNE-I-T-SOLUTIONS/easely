"use client"

import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import { ProtectedRoute } from "@/components/protected-route"
import { AnimatedSidebar } from "@/components/animated-sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AlertTriangle, CheckCircle, Clock, CreditCard, Loader, ReceiptText, RotateCcw, Wallet } from "lucide-react"
import { toast } from "sonner"

type SettlementSummary = {
  id: string
  settlement_date: string
  total_rides: number
  total_platform_fees: number
  settlement_status?: string
  status?: string
  payment_due_date?: string
  paid_at?: string | null
}

type Payment = {
  id: string
  amount: number
  payment_method: string
  payment_reference: string
  status: string
  payment_date: string
  confirmed_at?: string | null
  description?: string
}

function money(value: number | string | null | undefined) {
  return `₦${Number(value || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`
}

function formatCountdown(ms: number) {
  const safe = Math.max(Number(ms || 0), 0)
  const hours = Math.floor(safe / 3_600_000)
  const minutes = Math.floor((safe % 3_600_000) / 60_000)
  return `${hours}h ${minutes}m`
}

function statusOf(settlement: SettlementSummary) {
  return settlement.status || settlement.settlement_status || "pending"
}

function badgeClass(status: string) {
  if (status === "paid") return "bg-emerald-100 text-emerald-800"
  if (status === "overdue") return "bg-red-100 text-red-800"
  return "bg-amber-100 text-amber-800"
}

function RemittancePageContent() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [processingPayment, setProcessingPayment] = useState(false)
  const [processingRideId, setProcessingRideId] = useState<string | null>(null)
  const [status, setStatus] = useState<any>(null)
  const [daily, setDaily] = useState<any>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [now, setNow] = useState(Date.now())

  const outstanding: SettlementSummary[] = status?.outstandingSettlements || []
  const totalOutstanding = Number(status?.totalOutstanding || 0)
  const todayUnremitted = Number(daily?.totals?.unremittedPlatformFee || daily?.settlement?.outstandingPlatformFees || 0)
  const totalDueNow = Number(status?.totalDueNow ?? (totalOutstanding + todayUnremitted))
  const todayDate = daily?.date || new Date().toISOString().slice(0, 10)
  const dueAt = daily?.due?.dueAt || status?.todayRemittance?.dueAt
  const countdownMs = dueAt ? Math.max(new Date(dueAt).getTime() - now, 0) : Number(daily?.due?.millisecondsRemaining || 0)
  const remittableRides = useMemo(
    () => (daily?.rides || []).filter((ride: any) => !ride.remitted && Number(ride.platform_fee || 0) > 0),
    [daily?.rides]
  )

  const fetchData = async () => {
    try {
      setRefreshing(true)
      const [statusRes, dailyRes, paymentsRes] = await Promise.all([
        fetch("/api/driver/settlement/status"),
        fetch("/api/driver/settlement/daily"),
        fetch("/api/driver/payments/history?limit=30"),
      ])

      const [statusData, dailyData, paymentsData] = await Promise.all([
        statusRes.json(),
        dailyRes.json(),
        paymentsRes.json(),
      ])

      if (!statusRes.ok) throw new Error(statusData?.error || "Failed to fetch settlement status")
      if (!dailyRes.ok) throw new Error(dailyData?.error || "Failed to fetch today's settlement")
      if (!paymentsRes.ok) throw new Error(paymentsData?.error || "Failed to fetch payment history")

      setStatus(statusData)
      setDaily(dailyData)
      setPayments(paymentsData.payments || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load remittance data")
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])

  const initiatePayment = async (date?: string, rideId?: string) => {
    try {
      if (rideId) setProcessingRideId(rideId)
      setProcessingPayment(true)
      const response = await fetch("/api/driver/settlement/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          rideId,
          includeToday: !date && !rideId,
          returnUrl: `${window.location.origin}/driver/payments`,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data?.authUrl) {
        throw new Error(data?.error || "Unable to start payment")
      }
      window.location.href = data.authUrl
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start payment")
    } finally {
      setProcessingPayment(false)
      setProcessingRideId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background pb-24 lg:pb-0">
      <AnimatedSidebar />
      <main className="flex-1 pt-16 lg:pt-0">
        <div className="p-4 md:p-6 lg:p-8 space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-serif font-bold">Remittance</h1>
              <p className="text-muted-foreground">
                Track platform fees, reminders, payments, and availability locks.
              </p>
            </div>
            <Button onClick={fetchData} disabled={refreshing} variant="outline" className="gap-2">
              <RotateCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {status?.blocked ? (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-1 h-5 w-5 text-red-600" />
                    <div>
                      <h2 className="font-semibold text-red-900">Availability locked by remittance</h2>
                      <p className="text-sm text-red-700">
                        Pay {money(totalDueNow)} before accepting new rides.
                      </p>
                    </div>
                  </div>
                  <Button onClick={() => initiatePayment()} disabled={processingPayment || !totalDueNow}>
                    {processingPayment ? "Starting payment..." : "Pay Remittance"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-5">
                <Wallet className="mb-3 h-5 w-5 text-primary" />
                <p className="text-sm text-muted-foreground">Today's gross rides</p>
                <p className="mt-1 text-2xl font-bold">{money(daily?.totals?.grossAmount)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <CreditCard className="mb-3 h-5 w-5 text-primary" />
                <p className="text-sm text-muted-foreground">Today's platform fee</p>
                <p className="mt-1 text-2xl font-bold">{money(todayUnremitted)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Due in {formatCountdown(countdownMs)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <AlertTriangle className="mb-3 h-5 w-5 text-red-500" />
                <p className="text-sm text-muted-foreground">Overdue lock amount</p>
                <p className="mt-1 text-2xl font-bold text-red-600">{money(totalOutstanding)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <CheckCircle className="mb-3 h-5 w-5 text-emerald-500" />
                <p className="text-sm text-muted-foreground">Availability</p>
                <p className="mt-1 text-2xl font-bold">{status?.blocked ? "Locked" : "Clear"}</p>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="today" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="today">Today ({remittableRides.length})</TabsTrigger>
              <TabsTrigger value="outstanding">Outstanding ({outstanding.length})</TabsTrigger>
              <TabsTrigger value="history">Payments</TabsTrigger>
            </TabsList>

            <TabsContent value="today" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Today's Accepted Rides</CardTitle>
                  <CardDescription>Used to calculate daily platform remittance.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {remittableRides.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No unremitted rides recorded for today.</p>
                  ) : (
                    <>
                      <div className="flex flex-col gap-3 rounded-lg border bg-primary/5 p-4 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="font-semibold">Pay all today's ride remittance</p>
                          <p className="text-sm text-muted-foreground">
                            {remittableRides.length} rides • due in {formatCountdown(countdownMs)}
                          </p>
                        </div>
                        <Button onClick={() => initiatePayment(todayDate)} disabled={processingPayment}>
                          Pay {money(todayUnremitted)}
                        </Button>
                      </div>
                      {remittableRides.map((ride: any) => (
                      <div key={ride.id} className="rounded-lg border p-4">
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="font-semibold">{ride.pickup_zone} → {ride.destination_zone}</p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {ride.status} • {ride.remitted ? "remitted" : "not remitted"}
                            </p>
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4 md:items-center">
                            <span>{money(ride.fare_amount)}</span>
                            <span className="text-red-600">Fee {money(ride.platform_fee)}</span>
                            <span className="text-emerald-600">Earn {money(ride.driver_earnings)}</span>
                            <Button
                              size="sm"
                              onClick={() => initiatePayment(undefined, ride.id)}
                              disabled={processingPayment}
                            >
                              {processingRideId === ride.id ? "Starting..." : "Pay ride"}
                            </Button>
                          </div>
                        </div>
                      </div>
                      ))}
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="outstanding" className="space-y-4">
              {outstanding.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <CheckCircle className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
                    <p className="font-semibold">No outstanding remittance</p>
                    <p className="text-sm text-muted-foreground">You are clear to accept rides.</p>
                  </CardContent>
                </Card>
              ) : (
                outstanding.map((settlement) => (
                  <motion.div key={settlement.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                    <Card>
                      <CardContent className="p-5">
                        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold">
                                {new Date(settlement.settlement_date).toLocaleDateString()}
                              </h3>
                              <Badge className={badgeClass(statusOf(settlement))}>{statusOf(settlement)}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {settlement.total_rides || 0} rides • due {settlement.payment_due_date ? new Date(settlement.payment_due_date).toLocaleDateString() : "soon"}
                            </p>
                          </div>
                          <div className="flex flex-col gap-2 md:items-end">
                            <p className="text-2xl font-bold">{money(settlement.total_platform_fees)}</p>
                            <Button onClick={() => initiatePayment(settlement.settlement_date)} disabled={processingPayment}>
                              Pay this day
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))
              )}
            </TabsContent>

            <TabsContent value="history" className="space-y-4">
              {payments.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <ReceiptText className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                    <p className="font-semibold">No remittance payments yet</p>
                  </CardContent>
                </Card>
              ) : (
                payments.map((payment) => (
                  <Card key={payment.id}>
                    <CardContent className="p-5">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-start gap-3">
                          <Clock className="mt-1 h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="font-semibold">{payment.description || "Settlement payment"}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(payment.payment_date).toLocaleString()} • {payment.payment_reference}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className="font-bold">{money(payment.amount)}</p>
                          <Badge className={payment.status === "completed" ? "bg-emerald-100 text-emerald-800" : payment.status === "failed" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}>
                            {payment.status}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  )
}

export default function DriverPaymentsPage() {
  return (
    <ProtectedRoute allowedRoles={["driver"]}>
      <RemittancePageContent />
    </ProtectedRoute>
  )
}
