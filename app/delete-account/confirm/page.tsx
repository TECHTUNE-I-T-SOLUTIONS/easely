'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function ConfirmPageInner() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') || ''

  const [tokenInfo, setTokenInfo] = useState<any>(null)
  const [step, setStep] = useState<'loading' | 'ready' | 'confirming' | 'done' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [result, setResult] = useState<{ deleted: boolean; message: string } | null>(null)

  useEffect(() => {
    if (!token) {
      setErrorMsg('No confirmation token found in this link. Please use the link from your email.')
      setStep('error')
      return
    }

    fetch(`/api/account-deletion/confirm?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) {
          setErrorMsg(data.error || 'This link is invalid or has expired.')
          setStep('error')
        } else if (data.status === 'confirmed') {
          setResult({ deleted: false, message: 'Your deletion request was already confirmed. Your account will be deleted within 24 hours.' })
          setStep('done')
        } else {
          setTokenInfo(data)
          setStep('ready')
        }
      })
      .catch(() => {
        setErrorMsg('Network error. Please try again.')
        setStep('error')
      })
  }, [token])

  const handleConfirm = async () => {
    setStep('confirming')
    try {
      const res = await fetch('/api/account-deletion/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrorMsg(data?.error || 'Something went wrong.')
        setStep('error')
      } else {
        setResult({ deleted: data.deleted, message: data.message })
        setStep('done')
      }
    } catch {
      setErrorMsg('Network error. Please try again.')
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
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#ffffff', lineHeight: 1.2 }}>
            Confirm Account Deletion
          </h1>
        </div>

        <div style={{ padding: 28 }}>
          {step === 'loading' && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>
              <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>Verifying your confirmation link...</p>
            </div>
          )}

          {step === 'error' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>❌</div>
              <h2 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 800, color: '#111827' }}>Link Invalid or Expired</h2>
              <p style={{ margin: '0 0 24px', fontSize: 14, color: '#6b7280', lineHeight: 1.65 }}>{errorMsg}</p>
              <a
                href="/delete-account"
                style={{
                  display: 'inline-block',
                  padding: '12px 24px',
                  background: '#1a1a1a',
                  color: '#fff',
                  borderRadius: 10,
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                Request a New Link
              </a>
            </div>
          )}

          {step === 'done' && result && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>{result.deleted ? '✅' : '📋'}</div>
              <h2 style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 800, color: '#111827' }}>
                {result.deleted ? 'Account Deleted' : 'Deletion Confirmed'}
              </h2>
              <p style={{ margin: '0 0 24px', fontSize: 14, color: '#6b7280', lineHeight: 1.65 }}>
                {result.message}
              </p>
              {result.deleted && (
                <p style={{ margin: '0 0 8px', fontSize: 13, color: '#9ca3af' }}>
                  We're sorry to see you go. Thank you for using Charter Keke.
                </p>
              )}
              <a
                href="mailto:support@charterkeke.com"
                style={{ fontSize: 13, color: '#c46400', fontWeight: 700, textDecoration: 'none' }}
              >
                Contact support if you need help
              </a>
            </div>
          )}

          {(step === 'ready' || step === 'confirming') && tokenInfo && (
            <>
              <div style={{ marginBottom: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
                <p style={{ margin: 0, fontSize: 14, color: '#374151', lineHeight: 1.65 }}>
                  You are about to permanently delete the Charter Keke account for:
                </p>
                <p style={{ margin: '8px 0 0', fontSize: 16, fontWeight: 800, color: '#111827' }}>
                  {tokenInfo.email}
                </p>
              </div>

              <div style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 12,
                padding: '14px 16px',
                marginBottom: 24,
              }}>
                <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 800, color: '#b91c1c' }}>
                  This will permanently:
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#7f1d1d', lineHeight: 1.8 }}>
                  <li>Delete your profile and personal information</li>
                  <li>Remove your ride history and all account data</li>
                  <li>Revoke your login access immediately</li>
                  <li>This <strong>cannot be undone</strong></li>
                </ul>
              </div>

              <p style={{ margin: '0 0 20px', fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
                Link expires: {new Date(tokenInfo.expiresAt).toLocaleString()}
              </p>

              <button
                onClick={handleConfirm}
                disabled={step === 'confirming'}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: step === 'confirming' ? '#9ca3af' : '#ef4444',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 800,
                  cursor: step === 'confirming' ? 'not-allowed' : 'pointer',
                  marginBottom: 12,
                }}
              >
                {step === 'confirming' ? 'Deleting account...' : 'Yes, Delete My Account Permanently'}
              </button>

              <a
                href="/delete-account"
                style={{
                  display: 'block',
                  textAlign: 'center',
                  padding: '12px',
                  border: '1.5px solid #e5e7eb',
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 700,
                  color: '#374151',
                  textDecoration: 'none',
                }}
              >
                Cancel — Keep My Account
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ConfirmDeletePage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f6f4ef', fontFamily: 'Arial' }}>
        <p style={{ color: '#6b7280' }}>Loading...</p>
      </div>
    }>
      <ConfirmPageInner />
    </Suspense>
  )
}
