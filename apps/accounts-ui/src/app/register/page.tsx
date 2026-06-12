'use client'
// apps/accounts-ui/src/app/register/page.tsx
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AuthCard } from '@/components/auth-card'
import { Field } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { registerSchema } from '@/lib/schemas'
import type { RegisterFormData } from '@/lib/schemas'

type FieldErrors = Partial<Record<keyof RegisterFormData, string>>

export default function RegisterPage() {
  const router = useRouter()

  const [form, setForm] = useState<RegisterFormData>({
    email: '',
    name: '',
    password: '',
    confirmPassword: '',
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function setField(key: keyof RegisterFormData, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
    // Clear the field-level error as the user types
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function validate(): boolean {
    const result = registerSchema.safeParse(form)
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
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          name: form.name || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (res.status === 409) {
          setErrors((e) => ({ ...e, email: 'An account with this email already exists.' }))
          return
        }
        setServerError(data.error_description ?? 'Registration failed. Please try again.')
        return
      }

      // Registration succeeded — redirect to login with a success hint
      router.push('/login?registered=1')
    } catch {
      setServerError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="It only takes a moment."
    >
      {serverError && <Alert variant="error">{serverError}</Alert>}

      <form className="form" onSubmit={handleSubmit} noValidate>
        <Field
          label="Name"
          type="text"
          id="name"
          autoComplete="name"
          value={form.name ?? ''}
          onChange={(e) => setField('name', e.target.value)}
          error={errors.name as string}
          placeholder="Optional"
        />

        <Field
          label="Email"
          type="email"
          id="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => setField('email', e.target.value)}
          error={errors.email as string}
          required
        />

        <Field
          label="Password"
          type="password"
          id="password"
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => setField('password', e.target.value)}
          error={errors.password as string}
          hint="At least 12 characters"
          required
        />

        <Field
          label="Confirm password"
          type="password"
          id="confirmPassword"
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={(e) => setField('confirmPassword', e.target.value)}
          error={errors.confirmPassword as string}
          required
        />

        <Button type="submit" loading={loading}>
          Create account
        </Button>
      </form>

      <p className="form-footer">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </AuthCard>
  )
}