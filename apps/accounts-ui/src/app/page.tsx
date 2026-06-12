// apps/accounts-ui/src/app/page.tsx
import { redirect } from 'next/navigation'

// The root of accounts.yourdomain.com always redirects to login.
// Authenticated users are redirected away from login by the login page itself.
export default function RootPage() {
  redirect('/login')
}