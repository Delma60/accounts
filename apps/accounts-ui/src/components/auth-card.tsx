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
        <div className="auth-card__logo" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <rect width="40" height="40" rx="8" fill="#f6f8fa" stroke="#d0d7de"/>
            <path d="M20 10L28 15V25L20 30L12 25V15L20 10Z" fill="none" stroke="#0969da" strokeWidth="1.5" strokeLinejoin="round"/>
            <circle cx="20" cy="20" r="3" fill="#0969da"/>
          </svg>
        </div>
        <h1 className="auth-card__title">{title}</h1>
        {subtitle && <p className="auth-card__subtitle">{subtitle}</p>}
        {children}
      </div>
    </main>
  )
}