'use client'
// apps/accounts-ui/src/app/mfa/enroll/page.tsx
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AuthCard } from '@/components/auth-card'
import { Field } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { mfaCodeSchema } from '@/lib/schemas'
import { GATEWAY_URL } from '@/lib/env'

type EnrollState =
  | { step: 'loading' }
  | { step: 'setup'; secret: string; otpauthUrl: string; backupCodes: string[] }
  | { step: 'confirm' }
  | { step: 'done' }
  | { step: 'error'; message: string }

export default function MfaEnrollPage() {
  const router = useRouter()
  const [state, setState] = useState<EnrollState>({ step: 'loading' })
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | undefined>()
  const [activating, setActivating] = useState(false)
  const [copied, setCopied] = useState(false)

  // Kick off enrolment — fetch the TOTP secret from the gateway
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch(`${GATEWAY_URL}/auth/mfa/enroll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        })
        const data = await res.json()
        if (!res.ok) {
          setState({
            step: 'error',
            message: data.error_description ?? 'Failed to start MFA setup.',
          })
          return
        }
        setState({
          step: 'setup',
          secret: data.secret,
          otpauthUrl: data.otpauthUrl,
          backupCodes: data.backupCodes,
        })
      } catch {
        setState({ step: 'error', message: 'Unable to reach auth service.' })
      }
    })()
  }, [])

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault()
    const result = mfaCodeSchema.safeParse({ code })
    if (!result.success) {
      setCodeError(result.error.issues[0]?.message)
      return
    }
    setCodeError(undefined)
    setActivating(true)

    try {
      const res = await fetch(`${GATEWAY_URL}/auth/mfa/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCodeError(data.error_description ?? 'Invalid code.')
        return
      }
      setState({ step: 'done' })
    } catch {
      setCodeError('Something went wrong. Please try again.')
    } finally {
      setActivating(false)
    }
  }

  function copySecret() {
    if (state.step !== 'setup') return
    navigator.clipboard.writeText(state.secret).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (state.step === 'loading') {
    return (
      <AuthCard title="Setting up two-factor auth…">
        <p style={{ color: 'var(--color-ink-muted)', textAlign: 'center', padding: '1rem 0' }}>
          Loading…
        </p>
      </AuthCard>
    )
  }

  if (state.step === 'error') {
    return (
      <AuthCard title="Setup failed">
        <Alert variant="error">{state.message}</Alert>
        <div style={{ marginTop: '1.25rem' }}>
          <Button variant="ghost" onClick={() => router.push('/login')}>
            Back to sign in
          </Button>
        </div>
      </AuthCard>
    )
  }

  if (state.step === 'done') {
    return (
      <AuthCard title="Two-factor auth enabled">
        <Alert variant="success">
          Your authenticator app is now linked. You'll need it every time you sign in.
        </Alert>
        <div style={{ marginTop: '1.25rem' }}>
          <Button onClick={() => router.push('/')}>Continue</Button>
        </div>
      </AuthCard>
    )
  }

  if (state.step === 'setup') {
    return (
      <AuthCard
        title="Set up two-factor auth"
        subtitle="Scan the QR code with your authenticator app, then enter the code to confirm."
      >
        {/* QR Code — rendered via a well-known free QR API. In production,
            generate the QR image server-side to avoid leaking the secret to a
            third-party API. */}
        <div className="qr-container">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(state.otpauthUrl)}`}
            alt="QR code for authenticator app"
            width={180}
            height={180}
          />
        </div>

        <p style={{ fontSize: '.875rem', color: 'var(--color-ink-muted)', marginBottom: '.25rem' }}>
          Can&apos;t scan? Enter this key manually:
        </p>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '1.25rem' }}>
          <code
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '.875rem',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '.375rem .625rem',
              flex: 1,
              wordBreak: 'break-all',
            }}
          >
            {state.secret}
          </code>
          <Button variant="ghost" onClick={copySecret} style={{ flexShrink: 0 }}>
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>

        <details style={{ marginBottom: '1.25rem' }}>
          <summary
            style={{ fontSize: '.875rem', cursor: 'pointer', color: 'var(--color-ink-muted)', userSelect: 'none' }}
          >
            Show backup codes (save these somewhere safe)
          </summary>
          <div className="backup-codes" style={{ marginTop: '.75rem' }}>
            {state.backupCodes.map((c) => (
              <span key={c} className="backup-code">{c}</span>
            ))}
          </div>
          <p style={{ fontSize: '.8125rem', color: 'var(--color-ink-muted)', marginTop: '.5rem' }}>
            Each code can only be used once. Store them in a password manager.
          </p>
        </details>

        <form className="form" onSubmit={handleActivate} noValidate>
          <Field
            label="Confirmation code"
            type="text"
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, ''))
              setCodeError(undefined)
            }}
            error={codeError as string}
            placeholder="000000"
            hint="Enter the 6-digit code now showing in your app"
            required
          />
          <Button type="submit" loading={activating}>
            Enable two-factor auth
          </Button>
        </form>
      </AuthCard>
    )
  }

  return null
}