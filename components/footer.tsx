"use client"

import type React from "react"

import Link from "next/link"
import Image from "next/image"
import { motion } from "framer-motion"
import { Mail, Phone, MapPin, GraduationCap, Facebook, Twitter, Instagram, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { useState } from "react"

const footerLinks = {
  product: [
    { href: "/how-it-works", label: "How It Works" },
    { href: "/pricing", label: "Pricing" },
    { href: "/about", label: "About Us" },
    { href: "/safety", label: "Safety" },
  ],
  legal: [
    { href: "/privacy", label: "Privacy Policy" },
    { href: "/terms", label: "Terms of Use" },
    { href: "/cookies", label: "Cookie Policy" },
  ],
  support: [
    { href: "/faq", label: "FAQ" },
    { href: "/support", label: "Help Center" },
    { href: "/contact", label: "Contact Us" },
    { href: "https://system.charterkeke.com", label: "System Status" },
  ],
}

export function Footer() {
  const [email, setEmail] = useState("")

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) {
      toast.error("Please enter your email")
      return
    }
    toast.success("Subscribed!", {
      description: "You'll receive updates about Charter Keke.",
    })
    setEmail("")
  }

  return (
    <footer className="bg-gradient-to-b from-background to-muted/50 border-t border-border pb-10">
      <div className="container mx-auto px-4 py-16 max-w-full pr-8 pl-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-12">
          {/* Brand Section */}
          <div className="lg:col-span-2 space-y-6">
            <Link href="/" className="flex items-center gap-2">
              <motion.div whileHover={{ rotate: 10 }} transition={{ type: "spring", stiffness: 300 }}>
                <div className="w-12 h-12 bg-gradient-to-r from-[#AF6401] to-[#EE8906] rounded-lg flex items-center justify-center text-white font-bold text-2xl">
                  <Image src="/charter keke.png" alt="Charter Keke" width={40} height={40} className="rounded-lg" />
                </div>
              </motion.div>
              <span className="text-xl font-bold bg-gradient-to-r from-[#AF6401] to-[#EE8906] dark:bg-gradient-to-r dark:from-[#FCE6C9] dark:to-[#F0D1A8] bg-clip-text text-transparent group-hover:opacity-80 transition-opacity">
                CHARTER KEKE
              </span>
            </Link>
            <p className="text-muted-foreground dark:text-white max-w-sm">
              Fast, affordable, and reliable keke rides across Lagos. Serving Debari, Shomolu, and Yaba with 24/7
              service and community-focused transportation.
            </p>

            {/* Lagos Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20">
              <Image src="/charter keke.png" alt="Charter Keke" width={32} height={32} className="rounded-lg" />
              <span className="text-sm font-medium text-primary">Lagos Transport</span>
            </div>

            {/* Contact Info */}
            <div className="space-y-3">
              <a
                href="mailto:support@charterkeke.com"
                className="flex items-center gap-3 text-muted-foreground dark:text-white hover:text-foreground transition-colors group"
              >
                <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <Mail className="h-4 w-4 text-primary" />
                </div>
                <span>support@charterkeke.com</span>
              </a>
              <a
                href="tel:+2348083191228"
                className="flex items-center gap-3 text-muted-foreground dark:text-white hover:text-foreground transition-colors group"
              >
                <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <Phone className="h-4 w-4 text-primary" />
                </div>
                <span>+234 808 319 1228</span>
              </a>
              <div className="flex items-center gap-3 text-muted-foreground dark:text-white">
                <div className="p-2 rounded-lg bg-primary/10">
                  <MapPin className="h-4 w-4 text-primary" />
                </div>
                <span>Lagos, Nigeria</span>
              </div>
            </div>
          </div>

          {/* Product Links */}
          <div>
            <h4 className="font-semibold mb-6 text-foreground">Product</h4>
            <ul className="space-y-4">
              {footerLinks.product.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 group dark:text-white"
                  >
                    <span className="w-0 h-0.5 bg-primary transition-all group-hover:w-3" />
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal Links */}
          <div>
            <h4 className="font-semibold mb-6 text-foreground">Legal</h4>
            <ul className="space-y-4">
              {footerLinks.legal.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 group dark:text-white"
                  >
                    <span className="w-0 h-0.5 bg-primary transition-all group-hover:w-3" />
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Support Links */}
          <div>
            <h4 className="font-semibold mb-6 text-foreground">Support</h4>
            <ul className="space-y-4">
              {footerLinks.support.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 group dark:text-white"
                  >
                    <span className="w-0 h-0.5 bg-primary transition-all group-hover:w-3" />
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Newsletter */}
          <div>
            <h4 className="font-semibold mb-6 text-foreground dark:text-white">Stay Updated</h4>
            <p className="text-sm text-muted-foreground dark:text-white mb-4">Get the latest updates and offers.</p>
            <form onSubmit={handleSubscribe} className="space-y-3">
              <div className="relative">
                <Input
                  type="email"
                  placeholder="Your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-background/50 border-primary/20 pr-12 dark:bg-background/90 dark:border-primary/80"
                />
                <Button
                  type="submit"
                  size="icon"
                  className="absolute right-1 top-1 h-8 w-8 bg-primary hover:bg-primary/90"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </form>

            {/* Social Links */}
            <div className="flex gap-3 mt-6">
              {[
                { icon: Facebook, href: "#" },
                { icon: Twitter, href: "#" },
                { icon: Instagram, href: "#" },
              ].map((social, index) => (
                <motion.a
                  key={index}
                  href={social.href}
                  whileHover={{ scale: 1.1, y: -2 }}
                  className="p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  <social.icon className="h-5 w-5" />
                </motion.a>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-border mt-12 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-muted-foreground text-sm dark:text-white">
            &copy; {new Date().getFullYear()} Charter Keke. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
