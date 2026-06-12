'use client'
// apps/accounts-ui/src/app/login/page.tsx
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { z } from 'zod'
import { AuthCard } from '@/components/auth-card'
import { Field } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
// import { useSilentRefresh } from '@/hooks/use-silent-refresh'
import { loginSchema } from '@/lib/schemas'
import type { Metadata } from 'next'
import { useSilentRefresh } from '@/hooks/use-silent-refresh'

// Metadata is exported from a server component — this page is a client
// component so metadata lives in a sibling page-metadata file. Described
// here for documentation: title = "Sign in — Accounts"

type FieldErrors = Partial<Record<'email' | 'password', string>>

export default function LoginPage() {
  // Start silent refresh timer now that user is on an authenticated page
  useSilentRefresh()

  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect') ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function validate(): boolean {
    const result = loginSchema.safeParse({ email, password })
    if (result.success) { setErrors({}); return true }

    const fieldErrors: FieldErrors = {}
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof FieldErrors
      fieldErrors[key] = issue.message
    }
    setErrors(fieldErrors)
    return false
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)
    if (!validate()) return

    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (res.status === 202 && data.challengeId) {
        // MFA challenge issued — redirect to verification page
        router.push(
          `/mfa?challengeId=${encodeURIComponent(data.challengeId)}&redirect=${encodeURIComponent(redirectTo)}`,
        )
        return
      }

      if (!res.ok) {
        setServerError(data.error_description ?? 'Sign-in failed. Please try again.')
        return
      }

      // Successful login — tokens are in httpOnly cookies, redirect the user
      router.push(redirectTo)
    } catch {
      setServerError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to continue to your account."
    >
      {serverError && (
        <Alert variant="error">{serverError}</Alert>
      )}

      <form className="form" onSubmit={handleSubmit} noValidate>
        <Field
          label="Email"
          type="email"
          id="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email as string}
          required
        />

        <Field
          label="Password"
          type="password"
          id="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password as string}
          required
        />

        <div style={{ textAlign: 'right', marginTop: '-.5rem' }}>
          <Link
            href="/password/forgot"
            style={{ fontSize: '.8125rem', color: 'var(--color-accent)' }}
          >
            Forgot password?
          </Link>
        </div>

        <Button type="submit" loading={loading}>
          Sign in
        </Button>
      </form>

      <p className="form-footer">
        Don&apos;t have an account?{' '}
        <Link href="/register">Create one</Link>
      </p>
    </AuthCard>
  )
}