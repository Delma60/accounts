'use client'
// apps/accounts-ui/src/app/mfa/page.tsx
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthCard } from '@/components/auth-card'
import { Field } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { mfaCodeSchema } from '@/lib/schemas'
import { GATEWAY_URL } from '@/lib/env'

export default function MfaPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const challengeId = searchParams.get('challengeId') ?? ''
  const redirectTo = searchParams.get('redirect') ?? '/'

  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | undefined>()
  const [serverError, setServerError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (!challengeId) {
    // No challenge in URL — something went wrong, send back to login
    router.replace('/login')
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)

    const result = mfaCodeSchema.safeParse({ code })
    if (!result.success) {
      setCodeError(result.error.issues[0]?.message)
      return
    }
    setCodeError(undefined)

    setLoading(true)
    try {
      // MFA verify goes directly to the gateway via the BFF
      const res = await fetch(`${GATEWAY_URL}/auth/mfa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ challengeId, code }),
      })

      const data = await res.json()
      if (!res.ok) {
        setServerError(data.error_description ?? 'Invalid code. Please try again.')
        return
      }

      // Tokens are in the cookies — navigate to the final destination
      router.push(redirectTo)
    } catch {
      setServerError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard
      title="Two-factor verification"
      subtitle="Enter the 6-digit code from your authenticator app."
    >
      {serverError && <Alert variant="error">{serverError}</Alert>}

      <form className="form" onSubmit={handleSubmit} noValidate>
        <Field
          label="Verification code"
          type="text"
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => {
            // Strip non-digits as user types
            setCode(e.target.value.replace(/\D/g, ''))
            setCodeError(undefined)
          }}
          error={codeError as string}
          placeholder="000000"
          required
        />

        <Button type="submit" loading={loading}>
          Verify
        </Button>
      </form>

      <p className="form-footer">
        Lost your device?{' '}
        <a href="/support" style={{ color: 'var(--color-accent)' }}>
          Contact support
        </a>
      </p>
    </AuthCard>
  )
}