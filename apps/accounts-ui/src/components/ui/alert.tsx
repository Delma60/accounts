// apps/accounts-ui/src/components/ui/alert.tsx
interface AlertProps {
  variant: 'error' | 'success' | 'info'
  children: React.ReactNode
}

export function Alert({ variant, children }: AlertProps) {
  return (
    <div className={`alert alert--${variant}`} role="alert">
      {children}
    </div>
  )
}