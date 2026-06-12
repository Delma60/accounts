'use client'
// apps/accounts-ui/src/app/password/forgot/page.tsx
import { useState } from 'react'
import Link from 'next/link'
import { AuthCard } from '@/components/auth-card'
import { Field } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { forgotPasswordSchema } from '@/lib/schemas'
import { GATEWAY_URL } from '@/lib/env'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)

    const result = forgotPasswordSchema.safeParse({ email })
    if (!result.success) {
      setEmailError(result.error.issues[0]?.message)
      return
    }
    setEmailError(undefined)
    setLoading(true)

    try {
      const res = await fetch(`${GATEWAY_URL}/auth/password/forgot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const data = await res.json()
        setServerError(data.error_description ?? 'Something went wrong.')
        return
      }
      // Always show the success message — the gateway never reveals if an email exists
      setSubmitted(true)
    } catch {
      setServerError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <AuthCard title="Check your inbox">
        <Alert variant="success">
          If that email is linked to an account, reset instructions have been sent.
          Check your spam folder if you don&apos;t see it within a few minutes.
        </Alert>
        <p className="form-footer" style={{ marginTop: '1.25rem' }}>
          <Link href="/login">Back to sign in</Link>
        </p>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter the email you signed up with and we'll send a reset link."
    >
      {serverError && <Alert variant="error">{serverError}</Alert>}

      <form className="form" onSubmit={handleSubmit} noValidate>
        <Field
          label="Email"
          type="email"
          id="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setEmailError(undefined)
          }}
          error={emailError as string}
          required
        />

        <Button type="submit" loading={loading}>
          Send reset link
        </Button>
      </form>

      <p className="form-footer">
        <Link href="/login">Back to sign in</Link>
      </p>
    </AuthCard>
  )
}