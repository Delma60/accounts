'use client'
// apps/accounts-ui/src/app/oauth/consent/page.tsx
//
// This page is rendered when the gateway's /auth/oauth/authorize endpoint
// determines the user is authenticated and consent must be collected.
// The user approves or denies, then the gateway redirects to the callback URI.

import { useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { AuthCard } from '@/components/auth-card'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { GATEWAY_URL } from '@/lib/env'

// Scopes this platform supports — kept in UI so labels can be human-readable
const SCOPE_LABELS: Record<string, { label: string; description: string }> = {
  openid:  { label: 'Identity',  description: 'Confirm who you are' },
  profile: { label: 'Profile',   description: 'Access your name and display information' },
  email:   { label: 'Email',     description: 'Read your email address' },
}

function parseScopeList(raw: string): string[] {
  return raw.split(' ').filter(Boolean)
}

export default function OAuthConsentPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const clientId     = searchParams.get('client_id') ?? ''
  const redirectUri  = searchParams.get('redirect_uri') ?? ''
  const scope        = searchParams.get('scope') ?? 'openid'
  const state        = searchParams.get('state') ?? ''
  const challenge    = searchParams.get('code_challenge') ?? ''
  const challengeMethod = searchParams.get('code_challenge_method') ?? 'S256'

  const scopes = parseScopeList(scope)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!clientId || !redirectUri || !challenge) {
    return (
      <AuthCard title="Invalid request">
        <Alert variant="error">
          This authorization request is incomplete or malformed. Please return to the
          application and try again.
        </Alert>
      </AuthCard>
    )
  }

  async function handleApprove() {
    setError(null)
    setLoading(true)
    try {
      // Direct browser to the gateway's authorize endpoint with credentials.
      // The gateway will verify the session cookie, create an auth code, and
      // redirect the browser to the app's redirect_uri.
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state,
        code_challenge: challenge,
        code_challenge_method: challengeMethod,
      })
      // Use window.location to let the gateway handle the redirect chain
      window.location.href = `${GATEWAY_URL}/auth/oauth/authorize?${params.toString()}`
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  function handleDeny() {
    // Redirect back to the app with access_denied
    const denyUrl = new URL(redirectUri)
    denyUrl.searchParams.set('error', 'access_denied')
    denyUrl.searchParams.set('error_description', 'The user denied the authorization request.')
    if (state) denyUrl.searchParams.set('state', state)
    window.location.href = denyUrl.toString()
  }

  return (
    <AuthCard
      title="Authorize access"
      subtitle={`${clientId} is requesting permission to access your account.`}
    >
      {error && <Alert variant="error">{error}</Alert>}

      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <p
          style={{
            fontSize: '.8125rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '.06em',
            color: 'var(--color-ink-muted)',
            margin: '0 0 .75rem',
          }}
        >
          This app will be able to:
        </p>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {scopes.map((s) => {
            const info = SCOPE_LABELS[s]
            return info ? (
              <li key={s} style={{ display: 'flex', gap: '.625rem', alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--color-success)', flexShrink: 0, marginTop: '.1em' }}>✓</span>
                <span>
                  <strong style={{ fontSize: '.9375rem' }}>{info.label}</strong>
                  <span style={{ display: 'block', fontSize: '.8125rem', color: 'var(--color-ink-muted)' }}>
                    {info.description}
                  </span>
                </span>
              </li>
            ) : (
              <li key={s} style={{ fontSize: '.9375rem' }}>{s}</li>
            )
          })}
        </ul>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
        <Button onClick={handleApprove} loading={loading}>
          Approve
        </Button>
        <Button variant="ghost" onClick={handleDeny} disabled={loading}>
          Deny
        </Button>
      </div>

      <p className="form-footer" style={{ marginTop: '1rem' }}>
        You can revoke this access at any time from your account settings.
      </p>
    </AuthCard>
  )
}