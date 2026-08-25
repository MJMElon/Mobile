import { signOutLocal } from '../lib/auth';
import PortalBar from './PortalBar.jsx';

// Sticky top bar for the interior pages (DO, booking, consent).
//
// The same 555 ribbon the dashboard wears — and the Auditor and FC portals
// with it. The page's own name is the caption under the wordmark, which is
// where those portals put it too.
export default function TopNav({ title, userName, backHref = 'index.html' }) {
  async function handleSignOut() {
    await signOutLocal();
    window.location.href = 'index.html';
  }
  return (
    <PortalBar
      sub={title}
      back={backHref}
      backLabel="Back to Main Page"
      user={userName}
      onSignOut={handleSignOut}
    />
  );
}
