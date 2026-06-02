"use client"

import { motion } from "framer-motion"
import Link from "next/link"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { Particles } from "@/components/particles"
import { Button } from "@/components/ui/button"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  LifeBuoy,
  Mail,
  Navigation,
  CircleHelp,
  TriangleAlert,
  MessageCircle,
  ArrowRight,
  Smartphone,
} from "lucide-react"

const navigationGuides = [
  {
    title: "Open Help & Support in the mobile app",
    description: "Profile → Support → Help & Support",
  },
  {
    title: "Start a support conversation",
    description: "Send your message to create a ticket automatically.",
  },
  {
    title: "Share screenshots when needed",
    description: "Use the paperclip icon to attach an image to your ticket.",
  },
  {
    title: "Track your ticket status",
    description: "Statuses include open, in progress, resolved, and closed.",
  },
]

const supportFaqs = [
  {
    section: "Using Support in the App",
    items: [
      {
        q: "Where do I find support in the mobile app?",
        a: "Open your Profile screen, then go to the SUPPORT section and tap Help & Support.",
      },
      {
        q: "How do I open a new support ticket?",
        a: "Type your message in the support chat and send it. If no ticket exists yet, the app creates one automatically.",
      },
      {
        q: "Can I attach screenshots or images?",
        a: "Yes. Tap the paperclip icon in the support chat to choose an image and send it with your message.",
      },
      {
        q: "How do I know if my issue is resolved?",
        a: "When support marks a ticket as resolved, you will be prompted to confirm whether the issue is fixed before final closure.",
      },
    ],
  },
  {
    section: "Navigation & Common Tasks",
    items: [
      {
        q: "How do I book a ride from the mobile app?",
        a: "From the rider area, go to Booking, enter pickup and destination, review fare details, and confirm your ride.",
      },
      {
        q: "Where can I find my ride history?",
        a: "Open your rider screens and go to ride history/details to see previous rides and trip breakdowns.",
      },
      {
        q: "Where can I update my profile or payment methods?",
        a: "Open Profile to access Edit Profile, Payment Methods, referrals, privacy settings, and notifications.",
      },
      {
        q: "How do I contact support about account access issues?",
        a: "Use the in-app Help & Support screen first, then email support if you cannot access your account flow.",
      },
    ],
  },
  {
    section: "Troubleshooting",
    items: [
      {
        q: "Location permission is denied. What should I do?",
        a: "Enable location permission for Charter Keke in your device settings, then reopen the app and retry.",
      },
      {
        q: "The map is not showing properly.",
        a: "Check that your location services are enabled and your connection is stable, then restart the app.",
      },
      {
        q: "Requests keep failing or loading forever.",
        a: "Confirm your internet is active and retry. If it continues, submit a support ticket with a screenshot.",
      },
      {
        q: "Offline data is not syncing.",
        a: "Reconnect to the internet and reopen the app. If queued actions still do not sync, contact support.",
      },
    ],
  },
]

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-background">
      <Particles />
      <Navbar />

      <main className="pt-24 pb-16">
        <section className="container mx-auto px-4 py-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-4xl mx-auto"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-6">
              <LifeBuoy className="h-4 w-4" />
              <span className="text-sm font-medium">Public Support Center</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-6">
              Charter Keke <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">Help Center</span>
            </h1>
            <p className="text-lg text-muted-foreground mb-8">
              Find mobile app navigation guides, common issue fixes, and support answers in one place.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Badge variant="secondary" className="px-3 py-1.5 gap-1">
                <Smartphone className="h-3.5 w-3.5" /> Mobile App Support
              </Badge>
              <Badge variant="secondary" className="px-3 py-1.5 gap-1">
                <CircleHelp className="h-3.5 w-3.5" /> Common Questions
              </Badge>
              <Badge variant="secondary" className="px-3 py-1.5 gap-1">
                <TriangleAlert className="h-3.5 w-3.5" /> Troubleshooting
              </Badge>
            </div>
          </motion.div>
        </section>

        <section className="container mx-auto px-4 py-8 max-w-5xl">
          <motion.h2
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-2xl font-bold text-center mb-8"
          >
            Quick Navigation in the App
          </motion.h2>

          <div className="grid md:grid-cols-2 gap-4">
            {navigationGuides.map((guide, index) => (
              <motion.div
                key={guide.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Navigation className="h-4 w-4 text-primary" />
                      {guide.title}
                    </CardTitle>
                    <CardDescription>{guide.description}</CardDescription>
                  </CardHeader>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="container mx-auto px-4 py-10 max-w-5xl">
          <motion.h2
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-2xl font-bold text-center mb-8"
          >
            Support Questions & Answers
          </motion.h2>

          {supportFaqs.map((group, groupIndex) => (
            <motion.div
              key={group.section}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: groupIndex * 0.1 }}
              className="mb-8"
            >
              <h3 className="text-xl font-bold mb-4 text-primary">{group.section}</h3>
              <Accordion type="single" collapsible className="space-y-2">
                {group.items.map((item, itemIndex) => (
                  <AccordionItem
                    key={`${group.section}-${itemIndex}`}
                    value={`${groupIndex}-${itemIndex}`}
                    className="border border-border rounded-lg px-4 data-[state=open]:border-primary/30 transition-colors"
                  >
                    <AccordionTrigger className="text-left hover:no-underline hover:text-primary">{item.q}</AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">{item.a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </motion.div>
          ))}
        </section>

        <section className="container mx-auto px-4 py-8 max-w-5xl">
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
          >
            <Card className="border-primary/20 bg-gradient-to-r from-primary/10 to-secondary/10">
              <CardContent className="p-8 md:p-10 text-center">
                <MessageCircle className="h-10 w-10 mx-auto mb-4 text-primary" />
                <h2 className="text-2xl md:text-3xl font-bold mb-3">Need direct support?</h2>
                <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
                  Use in-app Help & Support first. For urgent questions, email the Charter Keke support team directly.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <a href="mailto:support@charterkeke.com">
                    <Button size="lg" className="gap-2">
                      <Mail className="h-4 w-4" />
                      Email support@charterkeke.com
                    </Button>
                  </a>
                  <Link href="/contact">
                    <Button size="lg" variant="outline" className="gap-2 bg-transparent">
                      Contact Page
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
