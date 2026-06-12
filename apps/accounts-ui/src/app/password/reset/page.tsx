'use client'
// apps/accounts-ui/src/app/password/reset/page.tsx
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AuthCard } from '@/components/auth-card'
import { Field } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { resetPasswordSchema } from '@/lib/schemas'
import type { ResetPasswordFormData } from '@/lib/schemas'
import { GATEWAY_URL } from '@/lib/env'

type FieldErrors = Partial<Record<keyof ResetPasswordFormData, string>>

export default function ResetPasswordPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [form, setForm] = useState<ResetPasswordFormData>({
    password: '',
    confirmPassword: '',
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  if (!token) {
    return (
      <AuthCard title="Invalid link">
        <Alert variant="error">
          This password reset link is missing or malformed.
          Please request a new one.
        </Alert>
        <p className="form-footer" style={{ marginTop: '1.25rem' }}>
          <Link href="/password/forgot">Request new link</Link>
        </p>
      </AuthCard>
    )
  }

  function validate(): boolean {
    const result = resetPasswordSchema.safeParse(form)
    if (result.success) { setErrors({}); return true }
    const fieldErrors: FieldErrors = {}
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof FieldErrors
      if (!fieldErrors[key]) fieldErrors[key] = issue.message
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
      const res = await fetch(`${GATEWAY_URL}/auth/password/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: form.password }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 400) {
          setServerError('This reset link is invalid or has expired. Please request a new one.')
        } else {
          setServerError(data.error_description ?? 'Reset failed.')
        }
        return
      }
      setDone(true)
    } catch {
      setServerError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <AuthCard title="Password updated">
        <Alert variant="success">
          Your password has been reset. You can now sign in with your new password.
        </Alert>
        <div style={{ marginTop: '1.25rem' }}>
          <Button onClick={() => router.push('/login')}>Sign in</Button>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Choose a new password"
      subtitle="It must be at least 12 characters."
    >
      {serverError && <Alert variant="error">{serverError}</Alert>}

      <form className="form" onSubmit={handleSubmit} noValidate>
        <Field
          label="New password"
          type="password"
          id="password"
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => {
            setForm((f) => ({ ...f, password: e.target.value }))
            if (errors.password) setErrors((e) => ({ ...e, password: undefined }))
          }}
          error={errors.password as string}
          required
        />

        <Field
          label="Confirm new password"
          type="password"
          id="confirmPassword"
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={(e) => {
            setForm((f) => ({ ...f, confirmPassword: e.target.value }))
            if (errors.confirmPassword) setErrors((e) => ({ ...e, confirmPassword: undefined }))
          }}
          error={errors.confirmPassword as string}
          required
        />

        <Button type="submit" loading={loading}>
          Reset password
        </Button>
      </form>
    </AuthCard>
  )
}