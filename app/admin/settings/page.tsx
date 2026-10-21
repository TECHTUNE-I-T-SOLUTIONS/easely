"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { useSession } from "next-auth/react"
import { motion } from "framer-motion"
import { ProtectedRoute } from "@/components/protected-route"
import { DashboardSidebar } from "@/components/dashboard-sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { Bell, Shield, CreditCard, MessageSquare, Globe, Save } from "lucide-react"

function AdminSettingsContent() {
  const { data: session } = useSession()
  const [settings, setSettings] = useState({
    siteName: "Charter Keke",
    supportEmail: "support@charterkeke.com",
    supportPhone: "+234 808 319 1228",
    location: "Lagos, Nigeria",
    maintenanceMode: false,
    allowRegistration: true,
    requireEmailVerification: true,
    requirePhoneVerification: true,
    baseRidePrice: 300,
    pricePerKm: 50,
    driverCommission: 80,
    referralDiscount: 5,
    enablePushNotifications: true,
    enableSmsNotifications: true,
    enableEmailNotifications: true,
    paystackEnabled: true,
    termiiEnabled: true,
    cashlessEnabled: false,
  })
  const [loadingCashless, setLoadingCashless] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState("")
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(
    (session?.user as any)?.firstName || session?.user?.name || "Admin"
  )}&background=FF9101&color=000`

  const handleAvatarUpload = async (e: any) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setUploadingAvatar(true)
      const formData = new FormData()
      formData.append("profilePicture", file)

      const response = await fetch("/api/user/profile/avatar", {
        method: "POST",
        body: formData,
      })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result?.error || "Avatar upload failed")
      }

      setAvatarUrl(result?.user?.profile_picture_url || "")
      toast.success("Profile picture updated")
    } catch (error) {
      console.error("Admin avatar upload failed:", error)
      toast.error(error instanceof Error ? error.message : "Failed to upload avatar")
    } finally {
      setUploadingAvatar(false)
      e.target.value = ""
    }
  }

  const handleSave = () => {
    toast.success("Settings saved successfully")
  }

  // Load initial cashless state
  useEffect(() => {
    fetch("/api/settings/cashless-enabled")
      .then((res) => res.json())
      .then((data) => {
        if (typeof data.enabled === "boolean") {
          setSettings((prev) => ({ ...prev, cashlessEnabled: data.enabled }))
        }
      })
      .catch((err) => console.error("Failed to load cashless status:", err))
  }, [])

  const handleCashlessToggle = async (enabled: boolean) => {
    try {
      setLoadingCashless(true)
      const res = await fetch("/api/admin/cashless-toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      })
      const result = await res.json()
      if (res.ok) {
        setSettings((prev) => ({ ...prev, cashlessEnabled: enabled }))
        toast.success(result.message || `Cashless mode ${enabled ? "enabled" : "disabled"}`)
      } else {
        toast.error(result.message || "Failed to update cashless toggle")
      }
    } catch (err) {
      toast.error("Network error updating cashless toggle")
    } finally {
      setLoadingCashless(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      <DashboardSidebar />

      <main className="flex-1 lg:pl-0 pt-16 lg:pt-0">
        <div className="p-4 md:p-6 lg:p-8 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
          >
            <div>
              <h1 className="text-2xl md:text-3xl font-serif font-bold text-foreground">Admin Settings</h1>
              <p className="text-muted-foreground mt-1">Configure platform settings and preferences</p>
            </div>
            <Button onClick={handleSave} className="bg-gradient-to-r from-primary to-secondary hover:opacity-90">
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <Tabs defaultValue="general">
              <TabsList className="bg-muted/50 flex-wrap h-auto">
                <TabsTrigger value="general" className="gap-2">
                  <Globe className="h-4 w-4" />
                  <span className="hidden sm:inline">General</span>
                </TabsTrigger>
                <TabsTrigger value="pricing" className="gap-2">
                  <CreditCard className="h-4 w-4" />
                  <span className="hidden sm:inline">Pricing</span>
                </TabsTrigger>
                <TabsTrigger value="notifications" className="gap-2">
                  <Bell className="h-4 w-4" />
                  <span className="hidden sm:inline">Notifications</span>
                </TabsTrigger>
                <TabsTrigger value="integrations" className="gap-2">
                  <MessageSquare className="h-4 w-4" />
                  <span className="hidden sm:inline">Integrations</span>
                </TabsTrigger>
                <TabsTrigger value="security" className="gap-2">
                  <Shield className="h-4 w-4" />
                  <span className="hidden sm:inline">Security</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="general" className="mt-6 space-y-6">
                <Card className="bg-card/50 backdrop-blur border-primary/10">
                  <CardHeader>
                    <CardTitle>Admin Profile</CardTitle>
                    <CardDescription>Upload a new profile picture</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4">
                      <Image
                        src={avatarUrl || (session?.user as any)?.image || fallbackAvatar}
                        alt="Admin avatar"
                        width={72}
                        height={72}
                        className="h-[72px] w-[72px] rounded-full border-2 border-primary object-cover"
                      />
                      <div className="space-y-2 w-full max-w-sm">
                        <Label htmlFor="adminAvatar">Choose picture</Label>
                        <Input
                          id="adminAvatar"
                          type="file"
                          accept="image/*"
                          onChange={handleAvatarUpload}
                          disabled={uploadingAvatar}
                          className="bg-background/50 border-primary/20"
                        />
                        <p className="text-xs text-muted-foreground">
                          {uploadingAvatar ? "Uploading..." : "PNG, JPG or WEBP"}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-card/50 backdrop-blur border-primary/10">
                  <CardHeader>
                    <CardTitle>General Settings</CardTitle>
                    <CardDescription>Basic platform configuration</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="siteName">Platform Name</Label>
                        <Input
                          id="siteName"
                          value={settings.siteName}
                          onChange={(e) => setSettings({ ...settings, siteName: e.target.value })}
                          className="bg-background/50 border-primary/20"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="supportEmail">Support Email</Label>
                        <Input
                          id="supportEmail"
                          type="email"
                          value={settings.supportEmail}
                          onChange={(e) => setSettings({ ...settings, supportEmail: e.target.value })}
                          className="bg-background/50 border-primary/20"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="supportPhone">Support Phone</Label>
                        <Input
                          id="supportPhone"
                          value={settings.supportPhone}
                          onChange={(e) => setSettings({ ...settings, supportPhone: e.target.value })}
                          className="bg-background/50 border-primary/20"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="location">Location</Label>
                        <Input
                          id="location"
                          value={settings.location}
                          onChange={(e) => setSettings({ ...settings, location: e.target.value })}
                          className="bg-background/50 border-primary/20"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
                      <div>
                        <p className="font-medium text-foreground">Maintenance Mode</p>
                        <p className="text-sm text-muted-foreground">Disable access to the platform temporarily</p>
                      </div>
                      <Switch
                        checked={settings.maintenanceMode}
                        onCheckedChange={(checked) => setSettings({ ...settings, maintenanceMode: checked })}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="pricing" className="mt-6 space-y-6">
                <Card className="bg-card/50 backdrop-blur border-primary/10">
                  <CardHeader>
                    <CardTitle>Pricing Configuration</CardTitle>
                    <CardDescription>Set ride pricing and commission rates</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="basePrice">Base Ride Price (NGN)</Label>
                        <Input
                          id="basePrice"
                          type="number"
                          value={settings.baseRidePrice}
                          onChange={(e) => setSettings({ ...settings, baseRidePrice: Number(e.target.value) })}
                          className="bg-background/50 border-primary/20"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="pricePerKm">Price per KM (NGN)</Label>
                        <Input
                          id="pricePerKm"
                          type="number"
                          value={settings.pricePerKm}
                          onChange={(e) => setSettings({ ...settings, pricePerKm: Number(e.target.value) })}
                          className="bg-background/50 border-primary/20"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="commission">Driver Commission (%)</Label>
                        <Input
                          id="commission"
                          type="number"
                          value={settings.driverCommission}
                          onChange={(e) => setSettings({ ...settings, driverCommission: Number(e.target.value) })}
                          className="bg-background/50 border-primary/20"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="referralDiscount">Referral Discount (%)</Label>
                        <Input
                          id="referralDiscount"
                          type="number"
                          value={settings.referralDiscount}
                          onChange={(e) => setSettings({ ...settings, referralDiscount: Number(e.target.value) })}
                          className="bg-background/50 border-primary/20"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="notifications" className="mt-6 space-y-6">
                <Card className="bg-card/50 backdrop-blur border-primary/10">
                  <CardHeader>
                    <CardTitle>Notification Settings</CardTitle>
                    <CardDescription>Configure notification channels</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
                      <div>
                        <p className="font-medium text-foreground">Push Notifications</p>
                        <p className="text-sm text-muted-foreground">Send browser push notifications</p>
                      </div>
                      <Switch
                        checked={settings.enablePushNotifications}
                        onCheckedChange={(checked) => setSettings({ ...settings, enablePushNotifications: checked })}
                      />
                    </div>
                    <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
                      <div>
                        <p className="font-medium text-foreground">SMS Notifications</p>
                        <p className="text-sm text-muted-foreground">Send SMS via Termii</p>
                      </div>
                      <Switch
                        checked={settings.enableSmsNotifications}
                        onCheckedChange={(checked) => setSettings({ ...settings, enableSmsNotifications: checked })}
                      />
                    </div>
                    <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
                      <div>
                        <p className="font-medium text-foreground">Email Notifications</p>
                        <p className="text-sm text-muted-foreground">Send email notifications</p>
                      </div>
                      <Switch
                        checked={settings.enableEmailNotifications}
                        onCheckedChange={(checked) => setSettings({ ...settings, enableEmailNotifications: checked })}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="integrations" className="mt-6 space-y-6">
                <Card className="bg-card/50 backdrop-blur border-primary/10">
                  <CardHeader>
                    <CardTitle>Payment Integration</CardTitle>
                    <CardDescription>Paystack configuration</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
                      <div>
                        <p className="font-medium text-foreground">Enable Paystack</p>
                        <p className="text-sm text-muted-foreground">Process payments via Paystack</p>
                      </div>
                      <Switch
                        checked={settings.paystackEnabled}
                        onCheckedChange={(checked) => setSettings({ ...settings, paystackEnabled: checked })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Paystack Public Key</Label>
                      <Input type="password" placeholder="pk_live_..." className="bg-background/50 border-primary/20" />
                    </div>
                    <div className="space-y-2">
                      <Label>Paystack Secret Key</Label>
                      <Input type="password" placeholder="sk_live_..." className="bg-background/50 border-primary/20" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-card/50 backdrop-blur border-primary/10">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>Cashless Ecosystem (Wallets & Digital Payment)</span>
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-mono font-semibold ${settings.cashlessEnabled ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30" : "bg-amber-500/10 text-amber-500 border border-amber-500/30"}`}>
                        {settings.cashlessEnabled ? "ACTIVE" : "DORMANT"}
                      </span>
                    </CardTitle>
                    <CardDescription>
                      Master switch for in-app wallet balance, passenger fare auto-deduction, and driver payout credits. When disabled, the entire app defaults to standard cash & manual remittance.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border border-primary/20">
                      <div>
                        <p className="font-semibold text-foreground">Enable Cashless Mode</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Toggles in-app wallet payments across both Rider and Driver mobile apps.
                        </p>
                      </div>
                      <Switch
                        disabled={loadingCashless}
                        checked={settings.cashlessEnabled}
                        onCheckedChange={handleCashlessToggle}
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-card/50 backdrop-blur border-primary/10">
                  <CardHeader>
                    <CardTitle>SMS Integration</CardTitle>
                    <CardDescription>Termii configuration for SMS/OTP</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
                      <div>
                        <p className="font-medium text-foreground">Enable Termii</p>
                        <p className="text-sm text-muted-foreground">Send SMS and OTP via Termii</p>
                      </div>
                      <Switch
                        checked={settings.termiiEnabled}
                        onCheckedChange={(checked) => setSettings({ ...settings, termiiEnabled: checked })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Termii API Key</Label>
                      <Input
                        type="password"
                        placeholder="Enter API key..."
                        className="bg-background/50 border-primary/20"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Sender ID</Label>
                      <Input placeholder="Charter Keke" className="bg-background/50 border-primary/20" />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="security" className="mt-6 space-y-6">
                <Card className="bg-card/50 backdrop-blur border-primary/10">
                  <CardHeader>
                    <CardTitle>Security Settings</CardTitle>
                    <CardDescription>Authentication and verification options</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
                      <div>
                        <p className="font-medium text-foreground">Allow New Registrations</p>
                        <p className="text-sm text-muted-foreground">Enable new user sign-ups</p>
                      </div>
                      <Switch
                        checked={settings.allowRegistration}
                        onCheckedChange={(checked) => setSettings({ ...settings, allowRegistration: checked })}
                      />
                    </div>
                    <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
                      <div>
                        <p className="font-medium text-foreground">Email Verification</p>
                        <p className="text-sm text-muted-foreground">Require email verification for new accounts</p>
                      </div>
                      <Switch
                        checked={settings.requireEmailVerification}
                        onCheckedChange={(checked) => setSettings({ ...settings, requireEmailVerification: checked })}
                      />
                    </div>
                    <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
                      <div>
                        <p className="font-medium text-foreground">Phone Verification</p>
                        <p className="text-sm text-muted-foreground">Require phone verification via OTP</p>
                      </div>
                      <Switch
                        checked={settings.requirePhoneVerification}
                        onCheckedChange={(checked) => setSettings({ ...settings, requirePhoneVerification: checked })}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </motion.div>
        </div>
      </main>
    </div>
  )
}

export default function AdminSettingsPage() {
  return (
    <ProtectedRoute allowedRoles={["admin", "super_admin"]}>
      <AdminSettingsContent />
    </ProtectedRoute>
  )
}
