"use client"

import { Check, Users, Car } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"

const pricingOptions = [
  {
    title: "Standard Keke",
    price: "Varies/km",
    unit: "Charter",
    total: "Calculated during booking",
    features: [
      "Up to 3 passengers",
      "Comfortable keke ride",
      "Real-time tracking",
      "In-app messaging",
      "Secure payments",
    ],
    icon: Car,
    popular: true,
  },
  {
    title: "Premium Keke",
    price: "Varies/km",
    unit: "Charter",
    total: "Calculated during booking",
    features: ["Up to 4 passengers", "Spacious seating", "Real-time tracking", "In-app messaging", "Secure payments"],
    icon: Users,
    popular: false,
  },
]

export function PricingSection() {
  return (
    <section id="pricing" className="py-24">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Simple,{" "}
            <span className="bg-gradient-to-r from-[#6E3F01] to-[#E69935] bg-clip-text dark:bg-gradient-to-r dark:from-[#F0C081] dark:to-[#C7A273] text-transparent">
              Transparent
            </span>{" "}
            Pricing
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto dark:text-gray-100">
            No hidden fees. The more you share, the more you save.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {pricingOptions.map((option) => (
            <div
              key={option.title}
              className={`relative p-8 rounded-2xl border-2 transition-all duration-300 hover:shadow-xl ${
                option.popular
                  ? "border-primary bg-gradient-to-br from-primary/5 to-secondary/5"
                  : "border-border bg-card"
              }`}
            >
              {option.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-[#6E3F01] to-[#E69935] text-white text-sm font-medium">
                  Most Popular
                </div>
              )}

              <div className="flex items-center gap-4 mb-6">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#6E3F01] to-[#E69935] flex items-center justify-center text-white">
                  <option.icon className="h-7 w-7" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold">{option.title}</h3>
                  <p className="text-muted-foreground text-sm">{option.total}</p>
                </div>
              </div>

              <div className="mb-8">
                <span className="text-5xl font-bold text-primary">{option.price}</span>
                <span className="text-muted-foreground ml-2">{option.unit}</span>
              </div>

              <ul className="space-y-4 mb-8">
                {option.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
                      <Check className="h-3 w-3 text-primary" />
                    </div>
                    <span className="text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>

              <Link href="/auth/register">
                <Button
                  className={`w-full ${
                    option.popular ? "bg-gradient-to-r from-[#6E3F01] to-[#E69935] dark:bg-gradient-to-r dark:from-[#F0C081] dark:to-[#C7A273] text-white dark:hover:text-white hover:opacity-90" : ""
                  }`}
                  variant={option.popular ? "default" : "outline"}
                  size="lg"
                >
                  Get Started
                </Button>
              </Link>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <p className="text-muted-foreground dark:text-gray-100">
            Have a referral code?{" "}
            <Link href="/auth/register" className="text-primary hover:underline dark:text-secondary/light">
              Get 5% off your first ride!
            </Link>
          </p>
        </div>
      </div>
    </section>
  )
}
