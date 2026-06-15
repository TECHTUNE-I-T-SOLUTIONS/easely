"use client"

import Link from "next/link"
import Image from "next/image"
import { useState, useEffect } from "react"
import { Menu, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger, SheetClose, SheetHeader, SheetTitle } from "@/components/ui/sheet"

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/how-it-works", label: "Learn" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/install", label: "App" },
  { href: "/contact", label: "Contact" },
  { href: "https://system.charterkeke.com", label: "Status" },
]

export function Navbar() {
  const { theme, setTheme } = useTheme()
  const [isOpen, setIsOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    setMounted(true)
    const handleScroll = () => {
      setScrolled(window.scrollY > 20)
    }
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  return (
    <motion.header
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "glass border-b border-border/50 shadow-lg" : "bg-transparent"
        }`}
    >
      <nav className="container mx-auto px-4 h-16 flex items-center justify-between max-w-full pr-8 pl-8">
        <Link href="/" className="flex items-center gap-2 group">
          <motion.div whileHover={{ rotate: 10 }} transition={{ type: "spring", stiffness: 300 }}>
            <Image src="/charter keke.png" alt="Charter Keke" width={40} height={40} className="rounded-lg" />
          </motion.div>
          <span className="text-xl font-bold bg-gradient-to-r from-[#AF6401] to-[#EE8906] dark:bg-gradient-to-r dark:from-[#FCE6C9] dark:to-[#F0D1A8] bg-clip-text text-transparent group-hover:opacity-80 transition-opacity">
            CHARTER KEKE
          </span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link, index) => (
            <motion.div
              key={link.href}
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Link
                href={link.href}
                className="text-[#FF9100] dark:text-[#C1E8FF] hover:text-foreground transition-colors duration-300 text-sm font-medium relative group"
              >
                {link.label}
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-gradient-to-r from-primary to-secondary transition-all duration-300 group-hover:w-full" />
              </Link>
            </motion.div>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-4">
          {mounted && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="rounded-full text-[#FF9100] dark:text-[#C1E8FF] hover:text-foreground transition-colors duration-300"
            >
              <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">Toggle theme</span>
            </Button>
          )}
          <Link href="/auth/login">
            <Button variant="ghost" className="text-sm text-[#FF9100] dark:text-[#FFFFFF] hover:text-foreground transition-colors duration-300">
              Login
            </Button>
          </Link>
          <Link href="/auth/register">
            <Button className="bg-gradient-to-r from-[#AF6401] to-[#EE8906] dark:bg-gradient-to-r dark:from-[#C07C24] dark:to-[#8A673A] text-white hover:opacity-90 transition-opacity">
              Get Started
            </Button>
          </Link>
        </div>

        {/* Mobile Navigation */}
        <div className="flex md:hidden items-center gap-2">
          {mounted && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="rounded-full text-[#FF9100] dark:text-[#FFFFFF] hover:text-foreground transition-colors duration-300"
            >
              <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </Button>
          )}

          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-[#FF9100] dark:text-[#FFFFFF] hover:text-foreground transition-colors duration-300">
                <Menu className="h-6 w-6" />
                <span className="sr-only">Open menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[300px] sm:w-[300px] bg-background/95 backdrop-blur-xl">
              <SheetHeader>
                <SheetTitle className="sr-only">Menu</SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-8 mt-8 p-4">
                {navLinks.map((link, index) => (
                  <motion.div
                    key={link.href}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <SheetClose asChild>
                      <Link
                        href={link.href}
                        className="text-lg font-medium text-[#FF9100] dark:text-[#FFFFFF] hover:text-primary transition-colors flex items-center gap-2"
                      >
                        {link.label}
                      </Link>
                    </SheetClose>
                  </motion.div>
                ))}
                <div className="flex flex-col gap-4 mt-4">
                  <SheetClose asChild>
                    <Link href="/auth/login">
                      <Button variant="outline" className="w-full bg-[#FF9100] dark:bg-[#FF9100] text-black dark:text-white hover:opacity-90 transition-opacity">
                        Login
                      </Button>
                    </Link>
                  </SheetClose>
                  <SheetClose asChild>
                    <Link href="/auth/register">
                      <Button className="w-full bg-gradient-to-r from-[#AF6401] to-[#EE8906] dark:bg-gradient-to-r dark:from-[#C07C24] dark:to-[#8A673A] text-white hover:opacity-90 transition-opacity">
                        Get Started
                      </Button>
                    </Link>
                  </SheetClose>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </motion.header>
  )
}
