// apps/accounts-ui/src/components/auth-card.tsx
interface AuthCardProps {
  title: string
  subtitle?: string
  children: React.ReactNode
}

export function AuthCard({ title, subtitle, children }: AuthCardProps) {
  return (
    <main className="auth-shell">
      <div className="auth-card">
        {/* Wordmark */}
        <div className="auth-card__brand">
          <span className="brand-mark" aria-hidden="true">◆</span>
          <span className="brand-name">Accounts</span>
        </div>

        <h1 className="auth-card__title">{title}</h1>
        {subtitle && <p className="auth-card__subtitle">{subtitle}</p>}

        {children}
      </div>
    </main>
  )
}