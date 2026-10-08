'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function DeleteAccountPage() {
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [step, setStep] = useState<'form' | 'sending' | 'done' | 'error'>('form')
  const [errorMsg, setErrorMsg] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setStep('sending')
    setErrorMsg('')

    try {
      const res = await fetch('/api/account-deletion/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), reason: reason.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrorMsg(data?.error || 'Something went wrong. Please try again.')
        setStep('error')
      } else {
        setStep('done')
      }
    } catch {
      setErrorMsg('Network error. Please check your connection and try again.')
      setStep('error')
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f6f4ef',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      fontFamily: 'Arial, Helvetica, sans-serif',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 520,
        background: '#ffffff',
        borderRadius: 24,
        border: '1px solid #f1dfc6',
        overflow: 'hidden',
        boxShadow: '0 4px 32px rgba(0,0,0,0.08)',
      }}>
        {/* Header */}
        <div style={{ background: '#1a1a1a', padding: '28px 28px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#f5820b', marginBottom: 8 }}>
            Charter Keke
          </div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#ffffff', lineHeight: 1.2 }}>
            Delete Your Account
          </h1>
          <p style={{ margin: '10px 0 0', fontSize: 14, color: '#9ca3af', lineHeight: 1.5 }}>
            We'll send a confirmation link to your email to complete the process.
          </p>
        </div>

        <div style={{ padding: 28 }}>
          {step === 'done' ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>📬</div>
              <h2 style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 800, color: '#111827' }}>
                Check your inbox
              </h2>
              <p style={{ margin: '0 0 8px', fontSize: 14, color: '#6b7280', lineHeight: 1.65 }}>
                If an account exists for <strong>{email}</strong>, a confirmation email has been sent.
              </p>
              <p style={{ margin: '0 0 24px', fontSize: 13, color: '#6b7280', lineHeight: 1.65 }}>
                Click the link in the email to permanently delete your account. The link expires in 24 hours.
              </p>
              <a
                href="mailto:support@charterkeke.com"
                style={{
                  display: 'inline-block',
                  fontSize: 13,
                  color: '#c46400',
                  textDecoration: 'none',
                  fontWeight: 700,
                }}
              >
                Didn't receive it? Contact support →
              </a>
            </div>
          ) : (
            <>
              {/* Warning */}
              <div style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 12,
                padding: '14px 16px',
                marginBottom: 24,
              }}>
                <p style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 800, color: '#b91c1c' }}>
                  ⚠️ This action is permanent
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#7f1d1d', lineHeight: 1.7 }}>
                  <li>Your profile, rides, messages, and all personal data will be deleted</li>
                  <li>Your account cannot be recovered after confirmation</li>
                  <li>Any active rides or pending settlements must be resolved first</li>
                </ul>
              </div>

              {step === 'error' && (
                <div style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 10,
                  padding: '12px 14px',
                  marginBottom: 18,
                  fontSize: 13,
                  color: '#b91c1c',
                  fontWeight: 600,
                }}>
                  {errorMsg}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
                    Account email address *
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    disabled={step === 'sending'}
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      border: '1.5px solid #e5e7eb',
                      borderRadius: 10,
                      fontSize: 15,
                      color: '#111827',
                      background: '#f9fafb',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div style={{ marginBottom: 24 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
                    Reason for leaving <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span>
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Help us improve by sharing why you're leaving..."
                    disabled={step === 'sending'}
                    rows={3}
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      border: '1.5px solid #e5e7eb',
                      borderRadius: 10,
                      fontSize: 14,
                      color: '#111827',
                      background: '#f9fafb',
                      outline: 'none',
                      resize: 'vertical',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={step === 'sending' || !email.trim()}
                  style={{
                    width: '100%',
                    padding: '14px',
                    background: step === 'sending' ? '#9ca3af' : '#ef4444',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 12,
                    fontSize: 15,
                    fontWeight: 800,
                    cursor: step === 'sending' ? 'not-allowed' : 'pointer',
                    transition: 'background 0.2s',
                  }}
                >
                  {step === 'sending' ? 'Sending confirmation...' : 'Send Deletion Confirmation'}
                </button>
              </form>

              <p style={{ margin: '20px 0 0', fontSize: 12, color: '#9ca3af', textAlign: 'center', lineHeight: 1.6 }}>
                Changed your mind?{' '}
                <a href="charterkeke://rider/booking" style={{ color: '#c46400', fontWeight: 700, textDecoration: 'none' }}>
                  Open the app
                </a>{' '}
                or{' '}
                <a href="mailto:support@charterkeke.com" style={{ color: '#c46400', fontWeight: 700, textDecoration: 'none' }}>
                  contact support
                </a>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
