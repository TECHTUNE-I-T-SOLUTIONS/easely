"use client"

import { useEffect, useState } from "react"
import { ProtectedRoute } from "@/components/protected-route"
import { AnimatedSidebar } from "@/components/animated-sidebar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Loader, MessageSquare, Plus, RotateCcw, Send } from "lucide-react"
import { toast } from "sonner"

type Ticket = {
  id: string
  subject: string
  description: string
  category: string
  priority: string
  status: string
  created_at: string
  updated_at: string
}

type TicketMessage = {
  id: string
  message: string
  created_at: string
  sender_id?: string
  users?: {
    first_name?: string
    last_name?: string
    role?: string
  }
}

type Props = {
  category: "rider" | "driver"
}

function statusColor(status: string) {
  if (status === "closed" || status === "resolved") return "bg-emerald-100 text-emerald-800"
  if (status === "in_progress") return "bg-blue-100 text-blue-800"
  return "bg-amber-100 text-amber-800"
}

export function WebSupportChat({ category }: Props) {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null)
  const [messages, setMessages] = useState<TicketMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [creatingNew, setCreatingNew] = useState(false)
  const [subject, setSubject] = useState(category === "driver" ? "Driver Support Request" : "Rider Support Request")
  const [text, setText] = useState("")

  const loadTickets = async (preferredTicketId?: string) => {
    const response = await fetch("/api/support/tickets?includeClosed=true&limit=30")
    const data = await response.json()
    if (!response.ok) throw new Error(data?.error || "Failed to load tickets")

    const list = data.tickets || []
    setTickets(list)

    if (creatingNew) return
    const nextTicket =
      (preferredTicketId ? list.find((ticket: Ticket) => ticket.id === preferredTicketId) : null) ||
      (activeTicket ? list.find((ticket: Ticket) => ticket.id === activeTicket.id) : null) ||
      list[0] ||
      null

    setActiveTicket(nextTicket)
  }

  const loadThread = async (ticketId: string) => {
    const response = await fetch(`/api/support/tickets/${ticketId}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data?.error || "Failed to load ticket")
    setActiveTicket(data.ticket)
    setMessages(data.messages || [])
  }

  const refresh = async () => {
    try {
      setLoading(true)
      await loadTickets()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load support")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    if (!activeTicket?.id || creatingNew) {
      setMessages([])
      return
    }

    loadThread(activeTicket.id).catch((error) => {
      toast.error(error instanceof Error ? error.message : "Failed to load ticket")
    })
  }, [activeTicket?.id, creatingNew])

  const startNewTicket = () => {
    setCreatingNew(true)
    setActiveTicket(null)
    setMessages([])
    setSubject(category === "driver" ? "Driver Support Request" : "Rider Support Request")
    setText("")
  }

  const sendMessage = async () => {
    if (!text.trim()) return

    try {
      setSending(true)
      let ticket = activeTicket

      if (creatingNew || !ticket) {
        const response = await fetch("/api/support/tickets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: subject.trim() || (category === "driver" ? "Driver Support Request" : "Rider Support Request"),
            description: text.trim(),
            category,
            priority: "normal",
            initialMessage: text.trim(),
          }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data?.error || "Failed to create ticket")
        ticket = data.ticket
        setCreatingNew(false)
        setActiveTicket(ticket)
      } else {
        const response = await fetch(`/api/support/tickets/${ticket.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text.trim(), messageType: "text" }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data?.error || "Failed to send message")
      }

      setText("")
      await loadTickets(ticket?.id)
      if (ticket?.id) await loadThread(ticket.id)
      toast.success("Message sent")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send message")
    } finally {
      setSending(false)
    }
  }

  return (
    <ProtectedRoute allowedRoles={category === "driver" ? ["driver"] : ["user", "rider"]}>
      <div className="flex min-h-screen bg-background pb-24 lg:pb-0">
        <AnimatedSidebar />
        <main className="flex-1 pt-16 lg:pt-0">
          <div className="p-4 md:p-6 lg:p-8 space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h1 className="text-2xl md:text-3xl font-serif font-bold">Support</h1>
                <p className="text-muted-foreground">
                  Replies stay in the selected ticket thread. Use New Ticket only for a new issue.
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={refresh} variant="outline" className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  Refresh
                </Button>
                <Button onClick={startNewTicket} className="gap-2">
                  <Plus className="h-4 w-4" />
                  New Ticket
                </Button>
              </div>
            </div>

            {loading ? (
              <Card>
                <CardContent className="flex items-center justify-center p-10">
                  <Loader className="h-6 w-6 animate-spin" />
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Tickets</CardTitle>
                    <CardDescription>{tickets.length} recent support threads</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {creatingNew ? (
                      <div className="rounded-lg border border-primary bg-primary/10 p-3">
                        <p className="font-semibold">New ticket draft</p>
                        <p className="text-xs text-muted-foreground">Send a message to create it.</p>
                      </div>
                    ) : null}
                    {tickets.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No tickets yet.</p>
                    ) : (
                      tickets.map((ticket) => (
                        <button
                          key={ticket.id}
                          onClick={() => {
                            setCreatingNew(false)
                            setActiveTicket(ticket)
                          }}
                          className={`w-full rounded-lg border p-3 text-left transition hover:border-primary ${activeTicket?.id === ticket.id && !creatingNew ? "border-primary bg-primary/10" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="line-clamp-2 font-semibold">{ticket.subject}</p>
                            <Badge className={statusColor(ticket.status)}>{ticket.status}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {new Date(ticket.updated_at || ticket.created_at).toLocaleString()}
                          </p>
                        </button>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card className="min-h-[620px]">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MessageSquare className="h-5 w-5 text-primary" />
                      {creatingNew || !activeTicket ? "New support ticket" : activeTicket.subject}
                    </CardTitle>
                    <CardDescription>
                      {creatingNew || !activeTicket
                        ? "Describe the issue and send it to support."
                        : `Status: ${activeTicket.status}`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex min-h-[500px] flex-col gap-4">
                    {creatingNew || !activeTicket ? (
                      <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Ticket subject" />
                    ) : null}

                    <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border bg-muted/20 p-3">
                      {messages.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          {creatingNew || !activeTicket ? "No messages yet. Send the first message." : "No messages in this thread yet."}
                        </p>
                      ) : (
                        messages.map((message) => {
                          const isAdmin = message.users?.role === "admin" || message.users?.role === "super_admin"
                          return (
                            <div key={message.id} className={`flex ${isAdmin ? "justify-start" : "justify-end"}`}>
                              <div className={`max-w-[82%] rounded-xl border p-3 ${isAdmin ? "bg-card" : "bg-primary text-primary-foreground"}`}>
                                <p className="whitespace-pre-wrap text-sm">{message.message}</p>
                                <p className="mt-2 text-[11px] opacity-70">
                                  {message.users?.first_name || (isAdmin ? "Support" : "You")} • {new Date(message.created_at).toLocaleString()}
                                </p>
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>

                    <div className="flex flex-col gap-2 md:flex-row">
                      <Textarea
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        placeholder="Type your reply..."
                        className="min-h-24 flex-1"
                      />
                      <Button onClick={sendMessage} disabled={sending || !text.trim()} className="gap-2 md:self-end">
                        {sending ? <Loader className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Send
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </main>
      </div>
    </ProtectedRoute>
  )
}
