'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'

export default function LiveTrackingTestPage() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const [users, setUsers] = useState<any[]>([])
  const [selectedUser, setSelectedUser] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/admin/login')
    }
  }, [status, router])

  const fetchUsers = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/users-with-push-tokens')
      if (!response.ok) throw new Error('Failed to fetch users')
      const data = await response.json()
      setUsers(data.users || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const sendTestNotification = async () => {
    if (!selectedUser) {
      setError('Please select a user')
      return
    }

    setSending(true)
    setError('')
    setResult(null)

    try {
      const response = await fetch('/api/admin/test-live-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser,
          driverLocation: { lat: 6.5244, lng: 3.3792 },
          pickupLocation: { lat: 6.5300, lng: 3.3800, address: 'Test Pickup' },
          destinationLocation: { lat: 6.5400, lng: 3.3900, address: 'Test Destination' },
          etaMinutes: 5,
          distanceKm: 2.5,
          status: 'accepted',
        }),
      })

      if (!response.ok) throw new Error('Failed to send notification')

      const data = await response.json()
      setResult(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  if (status === 'loading') {
    return <div className="p-8">Loading...</div>
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Live Tracking Push Notification Test</h1>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Test Configuration</h2>

        <div className="mb-4">
          <button
            onClick={fetchUsers}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load Users with Push Tokens'}
          </button>
        </div>

        {users.length > 0 && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Select User</label>
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
            >
              <option value="">-- Select a user --</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.email} ({user.first_name} {user.last_name})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Status</label>
          <select
            defaultValue="accepted"
            className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
          >
            <option value="accepted">Driver on the way</option>
            <option value="in_progress">En route to destination</option>
            <option value="arrived">Driver arrived</option>
          </select>
        </div>

        <button
          onClick={sendTestNotification}
          disabled={!selectedUser || sending}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
        >
          {sending ? 'Sending...' : 'Send Test Notification'}
        </button>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-6">
          <h3 className="font-bold mb-2">Success!</h3>
          <pre className="text-sm overflow-auto">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}

      <div className="bg-gray-100 dark:bg-gray-700 rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Test Parameters</h2>
        <div className="space-y-2 text-sm">
          <p><strong>Driver Location:</strong> 6.5244, 3.3792 (Lagos)</p>
          <p><strong>Pickup Location:</strong> 6.5300, 3.3800</p>
          <p><strong>Destination Location:</strong> 6.5400, 3.3900</p>
          <p><strong>ETA:</strong> 5 minutes</p>
          <p><strong>Distance:</strong> 2.5 km</p>
        </div>
      </div>
    </div>
  )
}
